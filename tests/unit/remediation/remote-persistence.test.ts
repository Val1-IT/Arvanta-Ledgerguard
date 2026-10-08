import { describe, expect, it, vi } from 'vitest';
import type { Pool } from 'pg';
import type { ConstrainedAction, ConstrainedActionAdapter } from '@ledgerguard/core';
import type { ExecutionKeyRecord, PostgresExecutionKeyStore, StaleReservationRecovery } from '@ledgerguard/postgres';
import { ConcurrentExecutionError } from '@ledgerguard/policy';
import { loadRemediationPlan } from '../../../src/db/repositories/remediation-plans';
import { executeRemoteConstrainedAction } from '../../../src/remediation/execute-remote-action';
import { testHarnessAuthority } from '../../../src/remediation/trusted-authority';
import { isTransitionAllowed, type RemediationPlanState } from '../../../src/remediation/types';

const NOW = new Date('2026-09-26T18:00:00.000Z');
const action: ConstrainedAction = {
  type: 'TEST_ADJUSTMENT',
  target: { systemType: 'test', resourceType: 'stock', resourceId: '42' }
};

// Exercise the real repository parser on every UPDATE RETURNING and reload.
// In particular, do not discard execution_result_json or verification_json:
// that omission allowed malformed terminal records to pass earlier tests.
function fixture(state: RemediationPlanState = 'APPROVED') {
  const row: Record<string, unknown> = {
    id: 'remote-persistence', investigationId: 'inv', incidentId: 'incident',
    productId: 'product', triggerAsset: 'stock', requestedBy: 'tester', state,
    version: state === 'APPROVED' ? 2 : 3,
    proposedCorrectionsJson: JSON.stringify([{
      sequence: 1, action: 'REGENERATE_INVENTORY_VALUATION', table: 'inventory_valuation',
      recordId: '42', field: 'quantity_on_hand', beforeValue: '20', afterValue: '10',
      financialDelta: null, rollbackAssumption: 'No remote rollback is supported'
    }]),
    verificationExpectationsJson: JSON.stringify([{
      checkId: 'REMOTE_POSTCONDITION', expectedStatus: 'PASS', description: 'quantity is 10'
    }]),
    approvalAction: 'APPROVE', approvedBy: 'controller', approvalNote: null,
    approvedAt: NOW.toISOString(), executionResultJson: null, executedAt: null,
    verificationJson: null, datahubWritebackJson: null,
    remoteActionBindingJson: JSON.stringify({ systemId: 'test-remote', systemType: 'test',
      actionJson: JSON.stringify(action), expectedFingerprint: 'approved-state' }),
    createdAt: NOW.toISOString(), updatedAt: NOW.toISOString()
  };
  const transitions: Array<[RemediationPlanState, RemediationPlanState]> = [];
  const pool = {
    query: async (sql: string, params: unknown[] = []) => {
      if (sql.includes('update remediation_plans')) {
        if (row.id !== params[0] || row.version !== params[1]) return { rows: [], rowCount: 0 };
        transitions.push([row.state as RemediationPlanState, params[2] as RemediationPlanState]);
        row.state = params[2];
        row.version = Number(row.version) + 1;
        const fields = ['approvalAction', 'approvedBy', 'approvalNote', 'approvedAt',
          'executionResultJson', 'executedAt', 'verificationJson', 'datahubWritebackJson', 'updatedAt'];
        fields.forEach((field, index) => {
          if (params[index + 3] != null) row[field] = params[index + 3];
        });
      }
      return { rows: [{ ...row }], rowCount: 1 };
    }
  } as unknown as Pool;
  let key: ExecutionKeyRecord | null = null;
  const keys = {
    get: vi.fn(async () => key),
    reserve: vi.fn(async () => {
      key = { key: 'remote-key', planId: 'remote-persistence', planVersion: 2, state: 'reserved',
        createdAt: NOW, leaseExpiresAt: new Date(NOW.getTime() + 60_000) };
      return 'reserved';
    }),
    complete: vi.fn(async () => { if (key) key.state = 'completed'; }),
    failRetryable: vi.fn(async () => { if (key) key.state = 'failed_retryable'; }),
    appendJournal: vi.fn(async () => {}),
    isLeaseExpired: vi.fn(() => true),
    recoverExpiredReservation: vi.fn(async ({ classification }: { classification: string }): Promise<StaleReservationRecovery> => {
      const result = classification === 'applied' ? 'completed' : 'failed_retryable';
      if (key) key.state = result;
      return result;
    })
  };
  const adapter: ConstrainedActionAdapter = {
    meta: { systemId: 'test-remote', systemType: 'test' },
    validate: async () => ({ ok: true }), fingerprint: async () => 'approved-state',
    execute: async () => ({ httpSucceeded: true, remoteWriteAttempted: true, detail: 'applied' }),
    verify: async () => ({ pass: true, detail: 'quantity is 10' }),
    classifyRecovery: async () => 'applied'
  };
  const execute = () => executeRemoteConstrainedAction({
    planId: 'remote-persistence', expectedVersion: 2, action,
    expectedFingerprint: 'approved-state', idempotencyKey: 'remote-key'
  }, { pool, adapter, authority: testHarnessAuthority(), now: () => NOW,
    executionKeys: keys as unknown as PostgresExecutionKeyStore });
  return { row, pool, keys, adapter, execute, transitions, key: () => key,
    expire: () => { key = { key: 'remote-key', planId: 'remote-persistence', planVersion: 2,
      state: 'reserved', createdAt: new Date(0), leaseExpiresAt: new Date(1) }; } };
}

describe('remote execution persistence round trips', () => {
  it('persists and reloads a schema-valid successful execution and verification', async () => {
    const test = fixture();
    const result = await test.execute();
    const reloaded = await loadRemediationPlan(test.pool, 'remote-persistence');
    expect(result.outcome).toBe('EXECUTED');
    expect(reloaded?.state).toBe('RESOLVED');
    expect(reloaded?.executionResult).toMatchObject({ outcome: 'EXECUTED', startedAt: NOW.toISOString(),
      finishedAt: NOW.toISOString(), failureReason: null, failureDetail: null });
    expect(reloaded?.verification?.result.overallStatus).toBe('PASS');
    expect(reloaded?.verification?.result.checks).toHaveLength(1);
    expect(test.transitions.every(([from, to]) => isTransitionAllowed(from, to))).toBe(true);
  });

  it('persists a stale rejection without poisoning subsequent plan loads', async () => {
    const test = fixture();
    test.adapter.fingerprint = async () => 'changed-state';
    expect((await test.execute()).outcome).toBe('FAILED');
    const reloaded = await loadRemediationPlan(test.pool, 'remote-persistence');
    expect(reloaded?.state).toBe('EXECUTION_FAILED');
    expect(reloaded?.executionResult?.failureReason).toBe('DRIFT_DETECTED');
    expect(reloaded?.executionResult?.failureDetail).toContain('Source state changed');
  });

  it('persists a validation failure with its real failure detail', async () => {
    const test = fixture();
    test.adapter.validate = async () => ({ ok: false, reason: 'unsupported action' });
    expect((await test.execute()).outcome).toBe('FAILED');
    const reloaded = await loadRemediationPlan(test.pool, 'remote-persistence');
    expect(reloaded?.state).toBe('EXECUTION_FAILED');
    expect(reloaded?.executionResult?.failureDetail).toBe('unsupported action');
  });

  it('keeps a durable verification failure recoverable without retrying the write', async () => {
    const test = fixture();
    test.adapter.verify = async () => ({ pass: false, detail: 'quantity is 15, expected 10' });
    expect((await test.execute()).outcome).toBe('RECOVERY_REQUIRED');
    const reloaded = await loadRemediationPlan(test.pool, 'remote-persistence');
    expect(reloaded?.state).toBe('VERIFYING');
    expect(reloaded?.verification?.result.overallStatus).toBe('FAIL');
    expect(reloaded?.verification?.result.checks[0].actual).toContain('quantity is 15');
    expect(test.transitions.every(([from, to]) => isTransitionAllowed(from, to))).toBe(true);
    expect(test.keys.failRetryable).not.toHaveBeenCalled();
    test.expire();
    expect((await test.execute()).outcome).toBe('ALREADY_EXECUTED');
    expect((await loadRemediationPlan(test.pool, 'remote-persistence'))?.state).toBe('RESOLVED');
  });

  it('persists recovered applied state through the real repository parser', async () => {
    const test = fixture('EXECUTING');
    test.expire();
    expect((await test.execute()).outcome).toBe('ALREADY_EXECUTED');
    const reloaded = await loadRemediationPlan(test.pool, 'remote-persistence');
    expect(reloaded?.state).toBe('RESOLVED');
    expect(reloaded?.executionResult?.outcome).toBe('ALREADY_EXECUTED');
    expect(reloaded?.verification?.result.checks).toHaveLength(1);
  });

  it.each(['applied', 'not_applied'] as const)('does not transition %s recovery after a concurrent claim', async (classification) => {
    const test = fixture('EXECUTING');
    test.expire();
    test.adapter.classifyRecovery = async () => classification;
    test.keys.recoverExpiredReservation.mockResolvedValue('in_flight');
    await expect(test.execute()).rejects.toBeInstanceOf(ConcurrentExecutionError);
    expect((await loadRemediationPlan(test.pool, 'remote-persistence'))?.state).toBe('EXECUTING');
    expect(test.transitions).toHaveLength(0);
    expect(test.keys.appendJournal).not.toHaveBeenCalled();
  });

  it.each([
    ['applied', 'failed_retryable'], ['not_applied', 'completed'], ['not_applied', 'recovery_required']
  ] as const)('keeps %s recovery open when the key store returns %s', async (classification, storeOutcome) => {
    const test = fixture('EXECUTING');
    test.expire();
    test.adapter.classifyRecovery = async () => classification;
    test.keys.recoverExpiredReservation.mockResolvedValue(storeOutcome);
    expect((await test.execute()).outcome).toBe('RECOVERY_REQUIRED');
    expect((await loadRemediationPlan(test.pool, 'remote-persistence'))?.state).toBe('EXECUTING');
    expect(test.transitions).toHaveLength(0);
  });

  it('interrupts only after the key store confirms not-applied recovery', async () => {
    const test = fixture('EXECUTING');
    test.expire();
    test.adapter.classifyRecovery = async () => 'not_applied';
    expect((await test.execute()).outcome).toBe('INTERRUPTED');
    expect((await loadRemediationPlan(test.pool, 'remote-persistence'))?.state).toBe('INTERRUPTED');
    expect(test.key()?.state).toBe('failed_retryable');
  });

  it.each(['execute', 'verify'] as const)('keeps an uncertain %s failure reserved for recovery', async (stage) => {
    const test = fixture();
    test.adapter[stage] = async () => { throw new Error('response lost'); };
    expect((await test.execute()).outcome).toBe('RECOVERY_REQUIRED');
    expect((await loadRemediationPlan(test.pool, 'remote-persistence'))?.state).toBe('EXECUTING');
    expect(test.key()?.state).toBe('reserved');
    expect(test.keys.complete).not.toHaveBeenCalled();
    expect(test.keys.failRetryable).not.toHaveBeenCalled();
  });
});
