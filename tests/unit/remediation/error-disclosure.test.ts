import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Pool } from 'pg';
import {
  applyRemediationPlanTransition,
  createRemediationPlan,
  loadRemediationPlan
} from '../../../src/db/repositories/remediation-plans';
import type { RemediationPlanRecord } from '../../../src/remediation/types';
import { writebackRemediationResolution } from '../../../src/remediation/writeback';
import {
  listRemediationPlansForInvestigation,
  loadLatestRemediationPlanForInvestigation
} from '../../../src/ui/server/queries';
import { buildIncidentDetailViewModel } from '../../../src/ui/server/incident-detail';

const marker = 'synthetic-remediation-secret';
const now = '2026-10-08T00:00:00.000Z';
const errors = [
  new Error(`password=${marker}`),
  new Error(`postgres://user:${marker}@example.invalid/db`),
  new Error(`unexpected response body: ${marker}`),
  { message: marker, cause: { token: marker } },
  marker
];

function legacyPlan(): RemediationPlanRecord {
  return {
    schemaVersion: '1.0', id: 'plan', investigationId: 'run', incidentId: 'incident',
    productId: 'product', triggerAsset: 'inventory_valuation', requestedBy: 'tester',
    state: 'RESOLVED', version: 5, proposedCorrections: [], verificationExpectations: [],
    approvalAction: 'APPROVE', approvedBy: 'controller', approvalNote: 'Business approval evidence', approvedAt: now,
    executionResult: {
      startedAt: now, finishedAt: now, failureReason: 'SQL_ERROR', failureDetail: marker,
      steps: [
        { sequence: 1, action: 'REGENERATE_INVENTORY_VALUATION', table: 'inventory_valuation', recordId: 'row', status: 'FAILED', detail: marker },
        { sequence: 2, action: 'RECONCILE_JOURNAL_ENTRIES', table: 'journal_entries', recordId: 'journal', status: 'SKIPPED_NO_WRITE', detail: 'Business reconciliation evidence' }
      ]
    },
    executedAt: now, verification: { verifiedAt: now, result: { overallStatus: 'PASS', checks: [] } },
    datahubWriteback: { attemptedAt: now, outcome: 'FAILED', atRiskTagRemoved: false, trustedTagAdded: false, message: marker },
    createdAt: now, updatedAt: now
  };
}

function toRow(plan: RemediationPlanRecord): Record<string, unknown> {
  return {
    ...plan,
    proposedCorrectionsJson: JSON.stringify(plan.proposedCorrections),
    verificationExpectationsJson: JSON.stringify(plan.verificationExpectations),
    executionResultJson: JSON.stringify(plan.executionResult),
    verificationJson: JSON.stringify(plan.verification),
    datahubWritebackJson: JSON.stringify(plan.datahubWriteback)
  };
}

// The transport alone is fake; all write serialization, repository parsing,
// workflow calls and UI projections use their production implementations.
function recordingPool(initial = legacyPlan()) {
  let row = toRow(initial);
  const writes: unknown[][] = [];
  const pool = {
    query: async (sql: string, values: unknown[] = []) => {
      if (sql.startsWith('insert into remediation_plans')) {
        writes.push(values);
        row = {
          ...row, executionResultJson: values[14], datahubWritebackJson: values[17]
        };
      } else if (sql.startsWith('update remediation_plans')) {
        writes.push(values);
        row = {
          ...row, state: values[2], version: Number(row.version) + 1,
          executionResultJson: values[7] ?? row.executionResultJson,
          datahubWritebackJson: values[10] ?? row.datahubWritebackJson,
          updatedAt: values[11]
        };
      }
      return { rows: [row] };
    }
  } as unknown as Pool;
  return { pool, persisted: () => JSON.stringify(writes) };
}

afterEach(() => vi.unstubAllEnvs());

describe('remediation error disclosure boundaries', () => {
  it.each(errors)('does not persist or return upstream write-back error prose (%#)', async (upstream) => {
    vi.stubEnv('DATAHUB_GMS_URL', 'https://example.invalid');
    const initial = legacyPlan();
    initial.executionResult = null;
    initial.datahubWriteback = null;
    const database = recordingPool(initial);
    const result = await writebackRemediationResolution({ planId: 'plan' }, {
      pool: database.pool, now: () => new Date(now),
      publisher: {
        publishInvestigationNote: async () => { throw new Error('unused'); },
        publishResolution: async () => { throw upstream; }
      }
    });
    expect(result.state).toBe('RESOLVED');
    expect(result.datahubWriteback).toMatchObject({ outcome: 'FAILED', atRiskTagRemoved: false, trustedTagAdded: false });
    expect(result.datahubWriteback?.message).toMatch(/retry.*write-back/i);
    expect(database.persisted()).not.toContain(marker);
    expect(JSON.stringify(result)).not.toContain(marker);
  });

  it.each(['single', 'latest', 'history'] as const)('sanitizes legacy error fields on %s reads without rewriting history', async (kind) => {
    const database = recordingPool();
    const plan = kind === 'single' ? await loadRemediationPlan(database.pool, 'plan')
      : kind === 'latest' ? await loadLatestRemediationPlanForInvestigation(database.pool, 'run')
        : (await listRemediationPlansForInvestigation(database.pool, 'run'))[0];
    expect(plan?.datahubWriteback?.outcome).toBe('FAILED');
    expect(plan?.executionResult?.failureReason).toBe('SQL_ERROR');
    expect(plan?.executionResult?.steps[0].status).toBe('FAILED');
    expect(plan?.executionResult?.steps[1].detail).toBe('Business reconciliation evidence');
    expect(plan?.approvalNote).toBe('Business approval evidence');
    expect(JSON.stringify(plan)).not.toContain(marker);
    expect(database.persisted()).toBe('[]');
  });

  it.each(['insert', 'transition'] as const)('sanitizes error prose at the %s persistence boundary', async (operation) => {
    const database = recordingPool();
    const plan = legacyPlan();
    if (operation === 'insert') await createRemediationPlan(database.pool, plan);
    else await applyRemediationPlanTransition(database.pool, plan.id, plan.version, {
      state: plan.state, updatedAt: now,
      executionResultJson: JSON.stringify(plan.executionResult),
      datahubWritebackJson: JSON.stringify(plan.datahubWriteback)
    });
    expect(database.persisted()).not.toContain(marker);
    expect((await loadRemediationPlan(database.pool, 'plan'))?.executionResult?.failureReason).toBe('SQL_ERROR');
    expect(plan.executionResult?.failureDetail).toBe(marker);
    expect(plan.datahubWriteback?.message).toBe(marker);
  });

  it.each(['RESOLVED', 'EXECUTION_FAILED'] as const)('sanitizes legacy %s errors in direct incident view projections', (state) => {
    const plan = { ...legacyPlan(), state };
    const vm = buildIncidentDetailViewModel({
      run: {
        investigationId: 'run', incidentId: 'incident',
        input: { incidentId: 'incident', productId: 'product', triggerAsset: 'inventory_valuation', requestedBy: 'tester', mode: 'TEST' },
        finalState: 'ENGINE_FAILED', output: null, error: null, stateHistory: [], createdAt: now
      },
      engineReport: null, remediationPlan: plan
    });
    expect(vm.resolution.remediationState).toBe(state);
    expect(vm.resolution.executionFailureReason).toBe('SQL_ERROR');
    expect(vm.resolution.executionSteps[1].detail).toBe('Business reconciliation evidence');
    expect(JSON.stringify(vm)).not.toContain(marker);
  });

  it('preserves deterministic drift and verification evidence', async () => {
    const plan = legacyPlan();
    plan.executionResult = {
      startedAt: now, finishedAt: now, steps: [], failureReason: 'DRIFT_DETECTED',
      failureDetail: 'Source state changed after approval; re-investigation required'
    };
    plan.datahubWriteback = null;
    const loaded = await loadRemediationPlan(recordingPool(plan).pool, 'plan');
    expect(loaded?.executionResult).toEqual(plan.executionResult);
    expect(loaded?.verification).toEqual(plan.verification);
  });
});
