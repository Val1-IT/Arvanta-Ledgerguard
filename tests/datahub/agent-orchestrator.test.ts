import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { makePool } from '../../src/db/client';
import { seedDatabase } from '../../src/db/seed';
import { applyConversionError } from '../../demo-data/scenarios/conversion-error';
import { runInvestigation } from '../../src/agent/orchestrator';
import { loadInvestigationRun } from '../../src/db/repositories/investigation-runs';
import { DeterministicTestModel } from '../../src/agent/model-test';
import { datasetUrn, gmsGraphql } from './helpers';

// ---------------------------------------------------------------------------
// End-to-end integration test for FASE 5: runInvestigation() wired to the
// real deterministic engine (real Postgres), the real DataHub MCP bridge
// (real DataHub OSS + MCP server, via src/agent/datahub-client.ts), and the
// DeterministicTestModel (no network, mode=TEST). Nothing here is mocked —
// this is the only test exercising the full 13-state orchestrator against
// live infrastructure end to end. Complements:
//   - tests/unit/agent/*               (pure logic against fixtures)
//   - tests/integration/engine.test.ts (engine against real Postgres alone)
//   - tests/datahub/*.test.ts          (DataHub MCP alone, via Python proofs)
// ---------------------------------------------------------------------------

const TRIGGER_ASSET = 'inventory_valuation';

interface ReadAfterWrite {
  dataset: {
    properties: { description: string | null } | null;
    editableProperties: { description: string | null } | null;
    tags: { tags: { tag: { urn: string } }[] } | null;
  } | null;
}

const QUERY = `
  query readAfterWrite($urn: String!) {
    dataset(urn: $urn) {
      properties { description }
      editableProperties { description }
      tags { tags { tag { urn } } }
    }
  }
`;

describe('investigation agent orchestrator against live Postgres + live DataHub', () => {
  let pool: Pool;

  beforeAll(async () => {
    pool = makePool();
  });

  afterAll(async () => {
    // Leave the demo database in the healthy baseline for other consumers;
    // DataHub itself is restored by tests/datahub/global-setup.ts's teardown.
    await seedDatabase(pool);
    await pool.end();
  });

  it('completes with NO_ACTION_REQUIRED on the healthy baseline, reading live DataHub context', async () => {
    await seedDatabase(pool);

    const record = await runInvestigation(
      {
        incidentId: 'incident-healthy-baseline',
        productId: 'prod-cement-40',
        triggerAsset: TRIGGER_ASSET,
        requestedBy: 'integration-test',
        mode: 'TEST'
      },
      { pool, model: new DeterministicTestModel() }
    );

    expect(record.finalState).toBe('INVESTIGATION_COMPLETED');
    expect(record.error).toBeNull();
    expect(record.output?.status).toBe('COMPLETED');
    expect(record.output?.engineResultReference.incidentType).toBeNull();
    expect(record.output?.engineResultReference.primaryExposure).toBe('0.00');
    expect(record.output?.recommendedNextStep).toBe('NO_ACTION_REQUIRED');
    expect(record.output?.evidenceSufficiency.sufficient).toBe(true);

    // DataHub context was fetched live, not fabricated: it must be the real
    // dataset URN for inventory_valuation, with a real owner and a real
    // lineage path reaching beyond the trigger asset itself.
    expect(record.output?.datahubContext.assetsRead).toEqual([datasetUrn(TRIGGER_ASSET)]);
    expect(record.output?.datahubContext.owners.length).toBeGreaterThan(0);
    expect(record.output?.datahubContext.lineagePath.length).toBeGreaterThan(1);

    const persisted = await loadInvestigationRun(pool, record.investigationId);
    expect(persisted).toEqual(record);
  });

  it('completes with REQUEST_APPROVAL and writes back to DataHub on a real conversion-factor incident', async () => {
    await seedDatabase(pool);
    await applyConversionError(pool);

    const record = await runInvestigation(
      {
        incidentId: 'incident-conversion-error',
        productId: 'prod-cement-40',
        triggerAsset: TRIGGER_ASSET,
        requestedBy: 'integration-test',
        mode: 'TEST'
      },
      { pool, model: new DeterministicTestModel() }
    );

    expect(record.finalState).toBe('INVESTIGATION_COMPLETED');
    expect(record.error).toBeNull();
    expect(record.output?.status).toBe('COMPLETED');
    expect(record.output?.engineResultReference.incidentType).toBe('UNIT_CONVERSION_MISMATCH');
    expect(record.output?.engineResultReference.primaryExposure).toBe('28800000.00');
    expect(record.output?.recommendedNextStep).toBe('REQUEST_APPROVAL');
    expect(record.output?.evidenceSufficiency.sufficient).toBe(true);

    // The activity log interleaves the in-process engine call with the
    // externally-supplied DataHub bridge entries (read, then write-back),
    // resequenced chronologically by ActivityLogger.finalize(). The write-back
    // bridge probes a few argument shapes on the real add_tags/update_description
    // MCP tools before one validates (see src/datahub/mcp/writeback.py's
    // _try_call and tests/datahub/writeback.test.ts, which tolerates the same
    // thing) — those rejected probes are logged as real ERROR entries, so only
    // the overall run outcome and monotonic sequencing are asserted here.
    const activityLog = record.output?.activityLog ?? [];
    expect(activityLog.map((e) => e.tool)).toContain('engine.investigate');
    expect(activityLog.some((e) => e.status === 'OK')).toBe(true);
    expect(activityLog.map((e) => e.seq)).toEqual(activityLog.map((_, i) => i + 1));

    const persisted = await loadInvestigationRun(pool, record.investigationId);
    expect(persisted).toEqual(record);

    // Independent proof the write-back really landed in DataHub itself, not
    // just in the bridge's own self-reported result — same pattern as
    // tests/datahub/writeback.test.ts's read-after-write check.
    const data = await gmsGraphql<ReadAfterWrite>(QUERY, { urn: datasetUrn(TRIGGER_ASSET) });
    const tags = data.dataset?.tags?.tags.map((t) => t.tag.urn) ?? [];
    expect(tags).toContain('urn:li:tag:At Risk');
    const description = data.dataset?.editableProperties?.description ?? data.dataset?.properties?.description ?? '';
    expect(description).toContain('LedgerGuard investigation note');
    expect(description).toContain(record.investigationId);
  });

  it('produces a DATASET_NOT_FOUND failure state instead of a fake completion when the trigger asset is not a real DataHub dataset', async () => {
    await seedDatabase(pool);

    // Every table in src/datahub/bootstrap/assets.py's DATASETS has at least one
    // owner, so the only naturally-reachable failure path against a live,
    // correctly-bootstrapped DataHub instance is an unknown asset — the real
    // bridge (src/datahub/mcp/agent_bridge.py) rejects it before opening an MCP
    // session, and the orchestrator must surface that as a named failure state,
    // never a fake INVESTIGATION_COMPLETED.
    const record = await runInvestigation(
      {
        incidentId: 'incident-unknown-asset',
        productId: 'prod-cement-40',
        triggerAsset: 'not_a_real_dataset',
        requestedBy: 'integration-test',
        mode: 'TEST'
      },
      { pool, model: new DeterministicTestModel() }
    );

    expect(record.finalState).toBe('DATASET_NOT_FOUND');
    expect(record.error?.failureState).toBe('DATASET_NOT_FOUND');
    expect(record.error?.message).toContain('not_a_real_dataset');
    expect(record.output).toBeNull();

    const persisted = await loadInvestigationRun(pool, record.investigationId);
    expect(persisted).toEqual(record);
  });
});
