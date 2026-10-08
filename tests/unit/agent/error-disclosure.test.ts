import { describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { runInvestigation, type OrchestratorDeps } from '../../../src/agent/orchestrator';
import { DeterministicTestModel } from '../../../src/agent/model-test';
import { loadInvestigationRun, saveInvestigationRun } from '../../../src/db/repositories/investigation-runs';
import type { InvestigationRunRecord } from '../../../src/agent/types';
import { listInvestigationRuns } from '../../../src/ui/server/queries';
import { buildHealthyFixture, toInvestigationInput } from '../../../packages/core/test/fixtures';

const request = {
  incidentId: 'incident-error-boundary', productId: 'prod-cement-40',
  triggerAsset: 'product_units', requestedBy: 'tester', mode: 'TEST'
};
const marker = 'synthetic-private-value';
const upstreamErrors = [
  new Error(`password=${marker}`),
  new Error(`upstream response: {"api_key":"${marker}"}`),
  new Error(`connect postgres://user:${marker}@example.invalid/database`),
  new Error(`unexpected private response: ${marker}`),
  { message: marker, cause: { authorization: marker } },
  marker
];

// Only the database transport is replaced. The real orchestrator, formatter,
// serialization and row parser run, with no database or external services.
function recordingPool(legacyRecord?: InvestigationRunRecord) {
  let row: Record<string, unknown> | undefined = legacyRecord ? {
    investigationId: legacyRecord.investigationId, incidentId: legacyRecord.incidentId,
    finalState: legacyRecord.finalState, inputJson: JSON.stringify(legacyRecord.input),
    outputJson: legacyRecord.output ? JSON.stringify(legacyRecord.output) : null,
    errorJson: legacyRecord.error ? JSON.stringify(legacyRecord.error) : null,
    stateHistoryJson: JSON.stringify(legacyRecord.stateHistory), createdAt: legacyRecord.createdAt
  } : undefined;
  let writtenValues: unknown[] = [];
  const pool = {
    query: async (sql: string, values: unknown[]) => {
      if (sql.startsWith('insert into investigation_runs')) {
        writtenValues = values;
        row = {
          investigationId: values[0], incidentId: values[1], finalState: values[6],
          inputJson: values[8], outputJson: values[9], errorJson: values[10],
          stateHistoryJson: values[11], createdAt: values[12]
        };
        return { rows: [] };
      }
      return { rows: row ? [row] : [] };
    }
  } as unknown as Pool;
  return { pool, persistedText: () => JSON.stringify(writtenValues) };
}

function dependencies(pool: Pool): OrchestratorDeps {
  return {
    pool,
    model: new DeterministicTestModel(),
    loadInvestigationInput: async () => toInvestigationInput(buildHealthyFixture()),
    contextProvider: {
      readContext: async () => ({
        context: { assetsRead: ['product_units'], owners: ['owner'], glossaryTerms: [], tags: [], lineagePath: [] },
        source: 'LIVE_MCP', activityLog: []
      })
    },
    statusPublisher: null
  };
}

describe('investigation failure disclosure boundary', () => {
  const legacyRecord: InvestigationRunRecord = {
    investigationId: 'legacy-run', incidentId: request.incidentId,
    input: { ...request, mode: 'TEST' }, finalState: 'ENGINE_FAILED', output: null,
    error: { failureState: 'ENGINE_FAILED', message: marker, occurredAt: '2026-10-08T00:00:00.000Z' },
    stateHistory: [], createdAt: '2026-10-08T00:00:00.000Z'
  };

  it('protects every read consumer from legacy unsanitized error records without rewriting history', async () => {
    const database = recordingPool(legacyRecord);
    const record = await loadInvestigationRun(database.pool, legacyRecord.investigationId);
    expect(record?.error?.failureState).toBe('ENGINE_FAILED');
    expect(JSON.stringify(record)).not.toContain(marker);
    expect(database.persistedText()).toBe('[]');
  });

  it('protects list consumers from legacy unsanitized error records', async () => {
    const database = recordingPool(legacyRecord);
    const records = await listInvestigationRuns(database.pool);
    expect(records[0].error?.failureState).toBe('ENGINE_FAILED');
    expect(JSON.stringify(records)).not.toContain(marker);
  });

  it('does not persist raw error text when a caller bypasses the orchestrator', async () => {
    const database = recordingPool();
    await saveInvestigationRun(database.pool, legacyRecord);
    expect(database.persistedText()).not.toContain(marker);
    expect(legacyRecord.error?.message).toBe(marker);
    expect((await loadInvestigationRun(database.pool, legacyRecord.investigationId))?.error?.failureState).toBe('ENGINE_FAILED');
  });

  it('removes diagnostic copies in stored activity errors on both read and write', async () => {
    const run = await runInvestigation(request, dependencies(recordingPool().pool));
    run.output!.activityLog = [{
      seq: 1, tool: 'datahub.search', status: 'ERROR', inputSummary: '{}',
      outputSummary: marker, errorSanitized: marker, durationMs: 1,
      startedAt: run.createdAt, finishedAt: run.createdAt
    }];
    const legacyDatabase = recordingPool(run);
    const read = await loadInvestigationRun(legacyDatabase.pool, run.investigationId);
    expect(JSON.stringify(read)).not.toContain(marker);
    expect(read?.output?.activityLog[0].tool).toBe('datahub.search');
    const newDatabase = recordingPool();
    await saveInvestigationRun(newDatabase.pool, run);
    expect(newDatabase.persistedText()).not.toContain(marker);
    expect(run.output?.activityLog[0].errorSanitized).toBe(marker);
  });

  it.each(['ENGINE_FAILED', 'MODEL_OUTPUT_INVALID', 'WRITEBACK_FAILED'] as const)(
    '%s never returns or persists upstream diagnostics in any error representation', async (state) => {
      for (const upstream of upstreamErrors) {
        const database = recordingPool();
        const deps = dependencies(database.pool);
        const reject = async () => { throw upstream; };
        if (state === 'ENGINE_FAILED') deps.loadInvestigationInput = reject;
        if (state === 'MODEL_OUTPUT_INVALID') deps.model = { generateInvestigation: reject };
        if (state === 'WRITEBACK_FAILED') {
          deps.statusPublisher = { publishInvestigationNote: reject, publishResolution: reject };
        }

        const record = await runInvestigation(request, deps);
        expect(record.finalState).toBe(state);
        expect(record.error?.failureState).toBe(state);
        expect(record.error?.message).toBeTruthy();
        expect(record.stateHistory.at(-1)?.state).toBe(state);
        expect(JSON.stringify(record)).not.toContain(marker);
        expect(database.persistedText()).not.toContain(marker);
        expect(await loadInvestigationRun(database.pool, record.investigationId)).toEqual(record);
      }
    }
  );

  it('does not copy rejected model citations into its failure diagnostic', async () => {
    const database = recordingPool();
    const deps = dependencies(database.pool);
    const validModel = deps.model;
    deps.model = {
      generateInvestigation: async (facts) => ({
        ...await validModel.generateInvestigation(facts), citedOwners: [marker]
      })
    };
    const record = await runInvestigation(request, deps);
    expect(record.finalState).toBe('MODEL_OUTPUT_INVALID');
    expect(JSON.stringify(record)).not.toContain(marker);
    expect(database.persistedText()).not.toContain(marker);
  });

  it('preserves successful investigation output and persistence', async () => {
    const database = recordingPool();
    const record = await runInvestigation(request, dependencies(database.pool));
    expect(record.finalState).toBe('INVESTIGATION_COMPLETED');
    expect(record.error).toBeNull();
    expect(record.output?.status).toBe('COMPLETED');
    expect(record.output?.engineResultReference.overallStatus).toBe('HEALTHY');
    expect(await loadInvestigationRun(database.pool, record.investigationId)).toEqual(record);
  });
});
