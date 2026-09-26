import { describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { investigate, type SystemOfRecordAdapter, type SystemOfRecordSession } from '@ledgerguard/core';
import type { PostgresExecutionKeyStore } from '@ledgerguard/postgres';
import { ConcurrentExecutionError } from '@ledgerguard/policy';
import { executeRemediationPlan } from '../../../src/remediation/execute';
import { testHarnessAuthority } from '../../../src/remediation/trusted-authority';
import { duplicateIncidentInput } from '../../../packages/core/test/duplicate-fixtures';

function planRow(state: string, version: number) {
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
    executionResultJson: null,
    executedAt: null,
    verificationJson: null,
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

function unusedAdapter(): SystemOfRecordAdapter {
  return {
    meta: { systemId: 'test', systemType: 'memory' },
    async runInTransaction<T>(): Promise<T> {
      throw new Error('must not open a mutation transaction');
    }
  };
}

describe('stale reserved idempotency recovery', () => {
  it('returns ALREADY_EXECUTED when an expired reserved key is classified as already applied', async () => {
    const adapter: SystemOfRecordAdapter = {
      meta: { systemId: 'test', systemType: 'memory' },
      async runInTransaction<T>(work: (session: SystemOfRecordSession) => Promise<T>): Promise<T> {
        return work({
          loadInvestigationInput: async () => duplicateIncidentInput(),
          applyCorrection: async () => {
            throw new Error('recovery path must not mutate');
          }
        });
      }
    };
    const keys = {
      get: async () => ({ key: 'k1', planId: 'plan-dup-1', planVersion: 2, state: 'reserved' as const }),
      reserve: async () => 'in_flight' as const,
      isLeaseExpired: () => true,
      recoverExpiredReservation: async () => 'completed' as const,
      complete: async () => {
        throw new Error('must not complete again');
      },
      failRetryable: async () => {
        throw new Error('must not fail retryable');
      }
    } as unknown as PostgresExecutionKeyStore;

    const result = await executeRemediationPlan(
      { planId: 'plan-dup-1', expectedVersion: 2, idempotencyKey: 'k1' },
      {
        pool: poolReturning(planRow('APPROVED', 2)),
        authority: testHarnessAuthority(),
        adapter,
        executionKeys: keys
      }
    );

    expect(result.outcome).toBe('ALREADY_EXECUTED');
  });

  it('returns RECOVERY_REQUIRED instead of mutating when expired reserved state is ambiguous', async () => {
    let mutated = 0;
    const adapter: SystemOfRecordAdapter = {
      meta: { systemId: 'test', systemType: 'memory' },
      async runInTransaction<T>(work: (session: SystemOfRecordSession) => Promise<T>): Promise<T> {
        mutated += 1;
        return work({
          loadInvestigationInput: async () => duplicateIncidentInput(),
          applyCorrection: async () => {
            throw new Error('recovery path must not mutate');
          }
        });
      }
    };
    const keys = {
      get: async () => ({ key: 'k1', planId: 'plan-dup-1', planVersion: 2, state: 'reserved' as const }),
      reserve: async () => 'in_flight' as const,
      isLeaseExpired: () => true,
      recoverExpiredReservation: async () => 'recovery_required' as const,
      complete: async () => undefined,
      failRetryable: async () => undefined
    } as unknown as PostgresExecutionKeyStore;

    const result = await executeRemediationPlan(
      { planId: 'plan-dup-1', expectedVersion: 2, idempotencyKey: 'k1' },
      {
        pool: poolReturning(planRow('APPROVED', 2)),
        authority: testHarnessAuthority(),
        adapter,
        executionKeys: keys
      }
    );

    expect(result.outcome).toBe('RECOVERY_REQUIRED');
    expect(mutated).toBe(1);
  });

  it('keeps an unexpired reservation concurrent rather than stealing it', async () => {
    const keys = {
      get: async () => ({ key: 'k1', planId: 'plan-dup-1', planVersion: 2, state: 'reserved' as const }),
      reserve: async () => 'in_flight' as const,
      isLeaseExpired: () => false,
      recoverExpiredReservation: async () => 'in_flight' as const,
      complete: async () => undefined,
      failRetryable: async () => undefined
    } as unknown as PostgresExecutionKeyStore;

    await expect(
      executeRemediationPlan(
        { planId: 'plan-dup-1', expectedVersion: 2, idempotencyKey: 'k1' },
        {
          pool: poolReturning(planRow('APPROVED', 2)),
          authority: testHarnessAuthority(),
          adapter: unusedAdapter(),
          executionKeys: keys
        }
      )
    ).rejects.toBeInstanceOf(ConcurrentExecutionError);
  });
});
