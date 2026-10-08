import { describe, expect, it, vi } from 'vitest';
import type { Pool } from 'pg';
import type { ConstrainedAction, ConstrainedActionAdapter } from '@ledgerguard/core';
import type { ExecutionKeyRecord, PostgresExecutionKeyStore, StaleReservationRecovery } from '@ledgerguard/postgres';
import { ApprovalRequiredError, ConcurrentExecutionError } from '@ledgerguard/policy';
import { loadRemediationPlan } from '../../../src/db/repositories/remediation-plans';
import { executeRemoteConstrainedAction, type ExecuteRemoteActionInput } from '../../../src/remediation/execute-remote-action';
import { testHarnessAuthority } from '../../../src/remediation/trusted-authority';
import { isTransitionAllowed, RemediationExecutionResultSchema, type RemediationPlanState } from '../../../src/remediation/types';

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
  let clock = NOW;
  const keys = {
    get: vi.fn(async (requestedKey: string) => key?.key === requestedKey ? key : null),
    reserve: vi.fn(async (owner: { key: string; planId: string; planVersion: number }) => {
      key = { ...owner, state: 'reserved',
        createdAt: clock, leaseExpiresAt: new Date(clock.getTime() + 60_000) };
      return 'reserved';
    }),
    complete: vi.fn(async () => { if (key) key.state = 'completed'; }),
    failRetryable: vi.fn(async () => { if (key) key.state = 'failed_retryable'; }),
    appendJournal: vi.fn(async () => {}),
    isLeaseExpired: vi.fn((record: ExecutionKeyRecord, now: Date) =>
      record.state === 'reserved' && new Date(record.leaseExpiresAt!).getTime() <= now.getTime()),
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
  const input: ExecuteRemoteActionInput = {
    planId: 'remote-persistence', expectedVersion: 2, action: structuredClone(action),
    expectedFingerprint: 'approved-state', idempotencyKey: 'remote-key'
  };
  const execute = (request = input) => executeRemoteConstrainedAction(request,
    { pool, adapter, authority: testHarnessAuthority(), now: () => clock,
    executionKeys: keys as unknown as PostgresExecutionKeyStore });
  return { row, pool, keys, adapter, input, execute, transitions, key: () => key,
    setClock: (value: Date) => { clock = value; },
    expire: () => { key = { key: 'remote-key', planId: 'remote-persistence', planVersion: 2,
      state: 'reserved', createdAt: new Date(0), leaseExpiresAt: new Date(1) }; } };
}

describe('remote execution persistence round trips', () => {
  it('executes the JSON-approved representation without caller-only Map contents', async () => {
    const test = fixture();
    const approvedAction = { ...action, adjustments: {} };
    const binding = JSON.parse(String(test.row.remoteActionBindingJson));
    test.row.remoteActionBindingJson = JSON.stringify({ ...binding, actionJson: JSON.stringify(approvedAction) });
    Object.assign(test.input.action, { adjustments: new Map([['quantity', 999]]) });
    let executedAction: ConstrainedAction | undefined;
    test.adapter.execute = async (requested) => {
      executedAction = requested;
      return { httpSucceeded: true, remoteWriteAttempted: true, detail: 'applied' };
    };
    expect((await test.execute()).outcome).toBe('EXECUTED');
    expect(executedAction).toEqual(approvedAction);
  });

  it.each(['reserved', 'completed'] as const)('preserves approved provenance when recovering a %s key', async (keyState) => {
    const test = fixture('VERIFYING');
    test.row.version = 4;
    test.expire();
    test.key()!.state = keyState;
    test.adapter.fingerprint = async () => 'remote-after-state';
    const result = await test.execute();
    expect(result.outcome).toBe('ALREADY_EXECUTED');
    expect(result.receipt).toMatchObject({ planVersion: 2, sourceStateFingerprint: 'approved-state' });
    expect(test.keys.appendJournal).toHaveBeenCalledWith(expect.objectContaining({
      planVersion: 2, sourceStateFingerprint: 'approved-state'
    }));
    const reloaded = await loadRemediationPlan(test.pool, 'remote-persistence');
    expect(reloaded?.version).toBe(5);
    expect(reloaded?.executionResult?.receipt).toEqual(result.receipt);
  });

  it.each(['planId', 'expectedVersion', 'idempotencyKey', 'action'] as const)(
    'snapshots %s before the awaited plan read', async (field) => {
      const test = fixture();
      const query = test.pool.query.bind(test.pool);
      test.pool.query = (async (...args: unknown[]) => {
        if (String(args[0]).includes('from remediation_plans')) {
          if (field === 'planId') test.input.planId = 'different-plan';
          if (field === 'expectedVersion') test.input.expectedVersion = 99;
          if (field === 'idempotencyKey') test.input.idempotencyKey = 'different-key';
          if (field === 'action') test.input.action.target.resourceId = 'different-row';
        }
        return (query as (...args: unknown[]) => unknown)(...args);
      }) as Pool['query'];
      const result = await test.execute();
      expect(result.outcome).toBe('EXECUTED');
      expect(result.receipt).toMatchObject({ planId: 'remote-persistence', planVersion: 2,
        idempotencyKey: 'remote-key' });
      expect(test.key()).toMatchObject({ key: 'remote-key', planId: 'remote-persistence', planVersion: 2 });
    }
  );

  it('does not accept a caller-replaced fingerprint after checking the approved binding', async () => {
    const test = fixture();
    test.keys.get.mockImplementation(async () => {
      test.input.expectedFingerprint = 'unapproved-state';
      return null;
    });
    test.adapter.fingerprint = async () => 'unapproved-state';
    let writes = 0;
    test.adapter.execute = async () => { writes += 1; return { httpSucceeded: true, detail: 'applied' }; };
    const result = await test.execute();
    expect(result.outcome).toBe('FAILED');
    expect(result.plan.executionResult?.failureReason).toBe('DRIFT_DETECTED');
    expect(writes).toBe(0);
  });

  it('preserves the reserved owner version if the caller changes it during remote execution', async () => {
    const test = fixture();
    test.adapter.execute = async () => {
      test.input.expectedVersion = 99;
      return { httpSucceeded: true, detail: 'applied' };
    };
    const result = await test.execute();
    expect(result.receipt?.planVersion).toBe(2);
    expect(test.keys.appendJournal).toHaveBeenCalledWith(expect.objectContaining({ planVersion: 2 }));
  });

  it('keeps contradictory stale/write-attempted results recoverable', async () => {
    const test = fixture();
    test.adapter.execute = async () => ({ httpSucceeded: false, stale: true,
      remoteWriteAttempted: true, detail: 'stale after sending request' });
    expect((await test.execute()).outcome).toBe('RECOVERY_REQUIRED');
    expect(test.key()?.state).toBe('reserved');
    expect((await loadRemediationPlan(test.pool, 'remote-persistence'))?.state).toBe('EXECUTING');
  });

  it('does not start a second mutation while the expired original remote request can still complete', async () => {
    const test = fixture();
    let began!: () => void;
    let finish!: () => void;
    const started = new Promise<void>((resolve) => { began = resolve; });
    const pending = new Promise<void>((resolve) => { finish = resolve; });
    let writes = 0;
    test.adapter.execute = async () => {
      writes += 1;
      began();
      await pending;
      return { httpSucceeded: true, remoteWriteAttempted: true, detail: 'applied' };
    };
    test.adapter.classifyRecovery = async () => 'not_applied';
    const original = test.execute();
    await started;
    try {
      test.setClock(new Date(NOW.getTime() + 61_000));
      expect((await test.execute()).outcome).toBe('RECOVERY_REQUIRED');
      expect(test.key()?.state).toBe('reserved');
      await expect(test.execute({ ...test.input, expectedVersion: Number(test.row.version),
        idempotencyKey: 'replacement-key' })).rejects.toBeInstanceOf(ApprovalRequiredError);
      expect(writes).toBe(1);
    } finally {
      finish();
      await original.catch(() => undefined);
    }
    expect((await original).outcome).toBe('EXECUTED');
    expect((await loadRemediationPlan(test.pool, 'remote-persistence'))?.state).toBe('RESOLVED');
  });

  it('rejects malformed persisted receipt evidence instead of silently dropping it', () => {
    const base = { startedAt: NOW.toISOString(), finishedAt: NOW.toISOString(), steps: [],
      failureReason: null, failureDetail: null };
    expect(RemediationExecutionResultSchema.safeParse(base).success).toBe(true);
    expect(RemediationExecutionResultSchema.safeParse({ ...base, receipt: { committed: true } }).success).toBe(false);
    expect(RemediationExecutionResultSchema.safeParse({ ...base, fingerprintAfter: 42 }).success).toBe(false);
  });

  it('persists and reloads a schema-valid successful execution and verification', async () => {
    const test = fixture();
    const result = await test.execute();
    const reloaded = await loadRemediationPlan(test.pool, 'remote-persistence');
    expect(result.outcome).toBe('EXECUTED');
    expect(reloaded?.state).toBe('RESOLVED');
    expect(reloaded?.executionResult).toMatchObject({ outcome: 'EXECUTED', startedAt: NOW.toISOString(),
      finishedAt: NOW.toISOString(), failureReason: null, failureDetail: null });
    expect(reloaded?.executionResult?.receipt).toEqual(result.receipt);
    expect(reloaded?.executionResult?.fingerprintAfter).toBe('approved-state');
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

  it('does not transition applied recovery after a concurrent claim', async () => {
    const test = fixture('EXECUTING');
    test.expire();
    test.adapter.classifyRecovery = async () => 'applied';
    test.keys.recoverExpiredReservation.mockResolvedValue('in_flight');
    await expect(test.execute()).rejects.toBeInstanceOf(ConcurrentExecutionError);
    expect((await loadRemediationPlan(test.pool, 'remote-persistence'))?.state).toBe('EXECUTING');
    expect(test.transitions).toHaveLength(0);
    expect(test.keys.appendJournal).not.toHaveBeenCalled();
  });

  it.each(['failed_retryable', 'recovery_required'] as const)(
    'keeps applied recovery open when the key store returns %s', async (storeOutcome) => {
      const test = fixture('EXECUTING');
      test.expire();
      test.adapter.classifyRecovery = async () => 'applied';
      test.keys.recoverExpiredReservation.mockResolvedValue(storeOutcome);
      expect((await test.execute()).outcome).toBe('RECOVERY_REQUIRED');
      expect((await loadRemediationPlan(test.pool, 'remote-persistence'))?.state).toBe('EXECUTING');
      expect(test.transitions).toHaveLength(0);
    }
  );

  it('does not release an expired remote reservation based only on not-applied state', async () => {
    const test = fixture('EXECUTING');
    test.expire();
    test.adapter.classifyRecovery = async () => 'not_applied';
    expect((await test.execute()).outcome).toBe('RECOVERY_REQUIRED');
    expect((await loadRemediationPlan(test.pool, 'remote-persistence'))?.state).toBe('EXECUTING');
    expect(test.key()?.state).toBe('reserved');
    expect(test.keys.recoverExpiredReservation).not.toHaveBeenCalled();
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
