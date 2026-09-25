import { describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { executeConstrainedRemediation, investigate } from '@ledgerguard/core';
import type { SystemOfRecordAdapter, SystemOfRecordSession } from '@ledgerguard/core';
import type { PostgresExecutionKeyStore } from '@ledgerguard/postgres';
import { executeRemediationPlan } from '../../../src/remediation/execute';
import { testHarnessAuthority } from '../../../src/remediation/trusted-authority';
import { duplicateIncidentInput } from '../../../packages/core/test/duplicate-fixtures';

function planRow(state: string, version: number, extra: Record<string, unknown> = {}) {
  const report = investigate(duplicateIncidentInput());
  return {
    id: 'plan-dup-1',
    investigationId: 'inv-1',
    incidentId: 'incident-1',
    productId: 'ITEM-001',
    triggerAsset: 'inventory_movements',
    requestedBy: 'tester',
    state,
    version,
    proposedCorrectionsJson: JSON.stringify(report.proposedCorrections),
    verificationExpectationsJson: JSON.stringify(report.verificationExpectations),
    approvalAction: 'APPROVE',
    approvedBy: 'controller',
    approvalNote: null,
    approvedAt: '2026-03-02T15:00:00.000Z',
    executionResultJson: extra.executionResultJson ?? null,
    executedAt: extra.executedAt ?? null,
    verificationJson: extra.verificationJson ?? null,
    datahubWritebackJson: null,
    createdAt: '2026-03-02T14:00:00.000Z',
    updatedAt: '2026-03-02T15:00:00.000Z'
  };
}

function poolReturning(row: Record<string, unknown>): Pool {
  return {
    query: async () => ({ rows: [row], rowCount: 1 })
  } as unknown as Pool;
}

describe('idempotency replay vs drift', () => {
  it('returns ALREADY_EXECUTED for a completed key without opening a system-of-record transaction', async () => {
    let adapterCalled = 0;
    const adapter: SystemOfRecordAdapter = {
      meta: { systemId: 'test', systemType: 'memory' },
      async runInTransaction<T>(work: (session: SystemOfRecordSession) => Promise<T>): Promise<T> {
        adapterCalled += 1;
        throw new Error('replay must not start a transaction');
        return work({} as SystemOfRecordSession);
      }
    };
    const keys = {
      get: async () => ({ key: 'k1', planId: 'plan-dup-1', planVersion: 2, state: 'completed' as const }),
      reserve: async () => {
        throw new Error('completed replay must not reserve');
      },
      complete: async () => undefined,
      failRetryable: async () => undefined
    } as unknown as PostgresExecutionKeyStore;

    const result = await executeRemediationPlan(
      { planId: 'plan-dup-1', expectedVersion: 2, idempotencyKey: 'k1' },
      {
        pool: poolReturning(planRow('RESOLVED', 2)),
        authority: testHarnessAuthority(),
        adapter,
        executionKeys: keys
      }
    );

    expect(result.outcome).toBe('ALREADY_EXECUTED');
    expect(adapterCalled).toBe(0);
  });

  it('reports DRIFT_DETECTED when live state changed and the key is not completed', async () => {
    const repaired = duplicateIncidentInput();
    repaired.movements = repaired.movements.map((movement) =>
      movement.id === 'MOV-002' ? { ...movement, reversedAt: new Date('2026-03-02T16:00:00.000Z') } : movement
    );
    const adapter: SystemOfRecordAdapter = {
      meta: { systemId: 'test', systemType: 'memory' },
      async runInTransaction<T>(work: (session: SystemOfRecordSession) => Promise<T>): Promise<T> {
        return work({
          loadInvestigationInput: async () => repaired,
          applyCorrection: async () => {
            throw new Error('drift path must not mutate');
          }
        });
      }
    };
    const keys = {
      get: async () => null,
      reserve: async () => 'reserved' as const,
      complete: async () => undefined,
      failRetryable: async () => undefined
    } as unknown as PostgresExecutionKeyStore;

    let version = 2;
    const pool = {
      query: async (sql: string, params?: unknown[]) => {
        if (sql.includes('update remediation_plans')) {
          version += 1;
          const state = String(params?.[2] ?? 'EXECUTION_FAILED');
          return {
            rows: [
              planRow(state, version, {
                executionResultJson: typeof params?.[7] === 'string' ? params[7] : null,
                executedAt: typeof params?.[8] === 'string' ? params[8] : null
              })
            ],
            rowCount: 1
          };
        }
        return { rows: [planRow('APPROVED', 2)], rowCount: 1 };
      }
    } as unknown as Pool;

    const result = await executeRemediationPlan(
      { planId: 'plan-dup-1', expectedVersion: 2 },
      { pool, authority: testHarnessAuthority(), adapter, executionKeys: keys }
    );

    expect(result.outcome).toBe('FAILED');
    expect(result.plan.executionResult?.failureReason).toBe('DRIFT_DETECTED');
  });

  it('keeps adapter-level replay without a completed key as drift, not ALREADY_EXECUTED', async () => {
    const broken = duplicateIncidentInput();
    const approved = investigate(broken).proposedCorrections;
    const result = await executeConstrainedRemediation(
      {
        meta: { systemId: 'test', systemType: 'memory' },
        async runInTransaction(work) {
          return work({
            loadInvestigationInput: async () => {
              const repaired = duplicateIncidentInput();
              repaired.movements = repaired.movements.map((movement) =>
                movement.id === 'MOV-002' ? { ...movement, reversedAt: new Date() } : movement
              );
              return repaired;
            },
            applyCorrection: async () => {
              throw new Error('must not mutate');
            }
          });
        }
      },
      { approvedCorrections: approved }
    );
    expect(result.failureReason).toBe('DRIFT_DETECTED');
    expect(result.committed).toBe(false);
  });
});
