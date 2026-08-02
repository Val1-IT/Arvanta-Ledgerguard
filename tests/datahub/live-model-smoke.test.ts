import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { makePool } from '../../src/db/client';
import { seedDatabase } from '../../src/db/seed';
import { applyConversionError } from '../../demo-data/scenarios/conversion-error';
import { runInvestigation } from '../../src/agent/orchestrator';
import { createInvestigationModel } from '../../src/agent/model-factory';
import { datasetUrn } from './helpers';

// ---------------------------------------------------------------------------
// Live model smoke test (opt-in).
//
// Uses whichever live provider createInvestigationModel() selects from
// LLM_PROVIDER + credentials. Costs money / needs network — skipped unless
// RUN_LIVE_MODEL_TEST=true and the active provider credential is present.
// Never logs API keys or raw model responses.
// ---------------------------------------------------------------------------

const RUN_LIVE_MODEL_TEST = process.env.RUN_LIVE_MODEL_TEST === 'true';
const TRIGGER_ASSET = 'inventory_valuation';

function activeLiveCredentialPresent(): boolean {
  try {
    const selection = createInvestigationModel({
      judgeMode: false,
      allowDemoFallback: false,
      requireLiveModel: true
    });
    return selection.modelSource === 'ANTHROPIC' || selection.modelSource === 'OPENAI';
  } catch {
    return false;
  }
}

const HAS_CREDENTIAL = activeLiveCredentialPresent();

describe.skipIf(!RUN_LIVE_MODEL_TEST)(
  'live model smoke test (opt-in, real API + real Postgres + real DataHub)',
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
      'produces a schema-valid, reconciled investigation using the configured live model',
      async () => {
        await seedDatabase(pool);
        await applyConversionError(pool);

        const selection = createInvestigationModel({
          judgeMode: false,
          allowDemoFallback: false,
          requireLiveModel: true
        });
        expect(['ANTHROPIC', 'OPENAI']).toContain(selection.modelSource);

        const record = await runInvestigation(
          {
            incidentId: 'incident-live-model-smoke-test',
            productId: 'prod-cement-40',
            triggerAsset: TRIGGER_ASSET,
            requestedBy: 'live-model-smoke-test',
            mode: 'TEST'
          },
          { pool, ...selection }
        );

        if (record.finalState !== 'INVESTIGATION_COMPLETED') {
          throw new Error(
            `Live model run did not complete: finalState=${record.finalState} error=${JSON.stringify(record.error)}`
          );
        }

        expect(record.output).not.toBeNull();
        const output = record.output!;
        expect(output.schemaVersion).toBe('1.0');
        expect(output.provenance?.modelSource).toBe(selection.modelSource);
        expect(output.engineResultReference.incidentType).toBe('UNIT_CONVERSION_MISMATCH');
        expect(output.engineResultReference.primaryExposure).toBe('28800000.00');

        expect(['REQUEST_APPROVAL', 'COLLECT_MORE_EVIDENCE', 'ESCALATE_TO_OWNER', 'NO_ACTION_REQUIRED']).toContain(
          output.recommendedNextStep
        );

        expect(output.datahubContext.assetsRead).toEqual([datasetUrn(TRIGGER_ASSET)]);
        expect(output.datahubContext.owners.length).toBeGreaterThan(0);

        const modelEntry = output.activityLog.find((e) => e.tool === 'model.generateInvestigation');
        expect(modelEntry).toBeDefined();
        expect(modelEntry!.status).toBe('OK');
        expect(modelEntry!.durationMs).toBeGreaterThanOrEqual(0);

        const loggedText = JSON.stringify(output.activityLog);
        if (process.env.ANTHROPIC_API_KEY) {
          expect(loggedText).not.toContain(process.env.ANTHROPIC_API_KEY);
        }
        if (process.env.OPENAI_API_KEY) {
          expect(loggedText).not.toContain(process.env.OPENAI_API_KEY);
        }
        expect(loggedText.toLowerCase()).not.toContain('sk-ant-');
        expect(loggedText).not.toMatch(/sk-[a-zA-Z0-9]{10,}/);
      },
      60_000
    );
  }
);
