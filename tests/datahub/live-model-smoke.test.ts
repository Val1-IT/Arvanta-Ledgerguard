import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { makePool } from '../../src/db/client';
import { seedDatabase } from '../../src/db/seed';
import { applyConversionError } from '../../demo-data/scenarios/conversion-error';
import { runInvestigation } from '../../src/agent/orchestrator';
import { AnthropicInvestigationModel } from '../../src/agent/model-anthropic';
import { datasetUrn } from './helpers';

// ---------------------------------------------------------------------------
// FASE 6 pre-flight #2 — live model smoke test.
//
// Every other test in this repo deliberately avoids AnthropicInvestigationModel
// (via DeterministicTestModel instead): it costs money, needs network access,
// and is non-deterministic. This is the one intentional exception — a single,
// tightly-scoped run of the real Anthropic model against a real engine result
// and real DataHub MCP context, proving the previously-unexercised code path
// in src/agent/model-anthropic.ts actually works end to end and stays inside
// every guarantee the orchestrator/reconciliation layer already enforce.
//
// Opt-in only:
//   RUN_LIVE_MODEL_TEST=true npm run test:agent
//
// Without RUN_LIVE_MODEL_TEST=true, the whole suite below is SKIPPED at the
// describe level. With it set but no ANTHROPIC_API_KEY configured, the single
// test is SKIPPED at the it level. Either way this reports SKIPPED, never
// FAILED, and must never block starting FASE 6. The API key itself is never
// logged, printed, or persisted here or by any code this test exercises (see
// src/agent/activity-log.ts's sanitizeError / the assertions below).
// ---------------------------------------------------------------------------

const RUN_LIVE_MODEL_TEST = process.env.RUN_LIVE_MODEL_TEST === 'true';
const HAS_CREDENTIAL = Boolean(process.env.ANTHROPIC_API_KEY?.trim());
const TRIGGER_ASSET = 'inventory_valuation';

describe.skipIf(!RUN_LIVE_MODEL_TEST)(
  'live Anthropic model smoke test (opt-in, real API + real Postgres + real DataHub)',
  () => {
    let pool: Pool;

    beforeAll(async () => {
      pool = makePool();
    });

    afterAll(async () => {
      await seedDatabase(pool);
      await pool.end();
    });

    it.skipIf(!HAS_CREDENTIAL)(
      'produces a schema-valid, reconciled investigation using the real Anthropic model on a real conversion-factor incident',
      async () => {
        await seedDatabase(pool);
        await applyConversionError(pool);

        const model = new AnthropicInvestigationModel();
        const record = await runInvestigation(
          {
            incidentId: 'incident-live-model-smoke-test',
            productId: 'prod-cement-40',
            triggerAsset: TRIGGER_ASSET,
            requestedBy: 'live-model-smoke-test',
            mode: 'TEST'
          },
          { pool, model }
        );

        // The orchestrator only reaches INVESTIGATION_COMPLETED after: (1) Zod
        // schema validation inside AnthropicInvestigationModel.generateInvestigation
        // — a malformed tool_use block throws ModelOutputParseError, surfacing as
        // MODEL_OUTPUT_INVALID; (2) reconcile() passing all 7 rules in
        // src/agent/reconciliation.ts — any fabricated asset, owner, tag, glossary
        // term, lineage hop, nominal figure, record count, or correction target
        // fails the run the same way; (3) a verified DataHub write-back. So
        // asserting the final state alone already proves "structured output
        // passes schema", "reconciliation passes", "figures/owners/assets/
        // glossary/tags/lineage come from MCP", and "no fabricated correction
        // target" — the remaining pre-flight requirements are checked explicitly
        // below.
        if (record.finalState !== 'INVESTIGATION_COMPLETED') {
          throw new Error(
            `Live model run did not complete: finalState=${record.finalState} error=${JSON.stringify(record.error)}`
          );
        }

        expect(record.output).not.toBeNull();
        const output = record.output!;
        expect(output.schemaVersion).toBe('1.0');
        expect(output.engineResultReference.incidentType).toBe('UNIT_CONVERSION_MISMATCH');
        expect(output.engineResultReference.primaryExposure).toBe('28800000.00');

        // recommendedNextStep is a valid enum value (already Zod-gated, checked
        // again here as a direct assertion per the pre-flight requirement).
        expect(['REQUEST_APPROVAL', 'COLLECT_MORE_EVIDENCE', 'ESCALATE_TO_OWNER', 'NO_ACTION_REQUIRED']).toContain(
          output.recommendedNextStep
        );

        // DataHub context came from a live MCP read, not the model.
        expect(output.datahubContext.assetsRead).toEqual([datasetUrn(TRIGGER_ASSET)]);
        expect(output.datahubContext.owners.length).toBeGreaterThan(0);

        // Latency is logged, and no chain-of-thought or raw model response text
        // is stored anywhere: the activity log only ever holds JSON.stringify()
        // of the already-Zod-parsed ModelInvestigationOutput (see
        // ActivityLogger.record() / summarize() in src/agent/activity-log.ts),
        // never the raw Anthropic response object — and ModelInvestigationOutputSchema
        // (src/agent/types.ts) has no free-text reasoning-transcript field for a
        // model to smuggle one into.
        const modelEntry = output.activityLog.find((e) => e.tool === 'model.generateInvestigation');
        expect(modelEntry).toBeDefined();
        expect(modelEntry!.status).toBe('OK');
        expect(modelEntry!.durationMs).toBeGreaterThanOrEqual(0);

        // The API key is never logged or persisted, by this test or by the code
        // it exercises.
        const loggedText = JSON.stringify(output.activityLog);
        expect(loggedText).not.toContain(process.env.ANTHROPIC_API_KEY);
        expect(loggedText.toLowerCase()).not.toContain('sk-ant-');
      },
      60_000
    );
  }
);
