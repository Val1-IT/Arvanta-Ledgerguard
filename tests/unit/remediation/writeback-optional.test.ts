import { describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { writebackRemediationResolution } from '../../../src/remediation/writeback';

function planRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'plan-1',
    investigationId: 'inv-1',
    incidentId: 'incident-1',
    productId: 'prod-cement-40',
    triggerAsset: 'product_units',
    requestedBy: 'tester',
    state: 'RESOLVED',
    version: 4,
    proposedCorrectionsJson: '[]',
    verificationExpectationsJson: '[]',
    approvalAction: 'APPROVE',
    approvedBy: 'controller',
    approvalNote: null,
    approvedAt: '2026-01-01T00:00:00.000Z',
    executionResultJson: JSON.stringify({
      startedAt: '2026-01-01T00:00:00.000Z',
      finishedAt: '2026-01-01T00:00:01.000Z',
      steps: [],
      failureReason: null,
      failureDetail: null
    }),
    executedAt: '2026-01-01T00:00:01.000Z',
    verificationJson: JSON.stringify({
      verifiedAt: '2026-01-01T00:00:01.000Z',
      result: { overallStatus: 'PASS', checks: [] }
    }),
    datahubWritebackJson: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:01.000Z',
    ...overrides
  };
}

describe('optional DataHub remediation write-back', () => {
  it('records NOT_CONFIGURED without changing RESOLVED state', async () => {
    const writebackJson = JSON.stringify({
      attemptedAt: '2026-01-01T00:00:02.000Z',
      outcome: 'NOT_CONFIGURED',
      atRiskTagRemoved: false,
      trustedTagAdded: false,
      message: 'DataHub is not configured; system-of-record verification is unchanged.'
    });
    const pool = {
      query: async (sql: string) => {
        if (sql.trim().startsWith('select') || sql.includes('from remediation_plans where id')) {
          return { rows: [planRow()] };
        }
        return {
          rows: [planRow({ version: 5, datahubWritebackJson: writebackJson, updatedAt: '2026-01-01T00:00:02.000Z' })]
        };
      }
    } as unknown as Pool;

    const result = await writebackRemediationResolution(
      { planId: 'plan-1' },
      { pool, publisher: null, now: () => new Date('2026-01-01T00:00:02.000Z') }
    );

    expect(result.state).toBe('RESOLVED');
    expect(result.datahubWriteback?.outcome).toBe('NOT_CONFIGURED');
  });
});
