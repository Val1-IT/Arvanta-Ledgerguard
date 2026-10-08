import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { makePool } from '../../src/db/client';
import { applyRemediationPlanTransition, createRemediationPlan, loadRemediationPlan } from '../../src/db/repositories/remediation-plans';
import type { ConstrainedAction, ConstrainedActionAdapter } from '@ledgerguard/core';
import { defaultExecutionKey, PostgresExecutionKeyStore } from '@ledgerguard/postgres';
import { submitRemediationPlanForApproval, decideRemediationPlan } from '../../src/remediation/approve';
import { prepareRemoteActionBinding } from '../../src/remediation/remote-action-binding';
import { executeRemoteConstrainedAction } from '../../src/remediation/execute-remote-action';
import { testHarnessAuthority } from '../../src/remediation/trusted-authority';
import { adapterFromTransport, inventoryAdjustmentAction } from '../../packages/odoo/src/adapter';
import { FakeOdoo, DEMO_QUANT } from '../../packages/odoo/test/fake-odoo';
import { ApprovalRequiredError } from '@ledgerguard/policy';

// Real PostgreSQL persistence + explicitly simulated remote system. This is not
// evidence of Odoo atomicity; the separate Odoo suite tests the real JSON-2 API.
describe('remote execution with real PostgreSQL control plane', () => {
  const pool = makePool();
  afterAll(() => pool.end());
  it('persists the approved binding and verified receipt, then replays without a write', async () => {
    const odoo = new FakeOdoo(DEMO_QUANT);
    const adapter = adapterFromTransport(odoo.transport, 'isolated-odoo');
    const action = inventoryAdjustmentAction({ quantId: 42, productId: 7, locationId: 8, companyId: 1,
      expectedQuantity: 20, targetQuantity: 10, expectedWriteDate: DEMO_QUANT.writeDate });
    const binding = await prepareRemoteActionBinding(adapter, action);
    const id = `remote-pg-${randomUUID()}`;
    const stamp = new Date().toISOString();
    await createRemediationPlan(pool, {
      schemaVersion: '1.0', id, investigationId: id, incidentId: id, productId: 'fixture',
      triggerAsset: 'stock.quant', requestedBy: 'isolated-tester', state: 'DRAFT', version: 1,
      proposedCorrections: [], verificationExpectations: [], remoteActionBinding: binding,
      approvalAction: null, approvedBy: null, approvalNote: null, approvedAt: null,
      executionResult: null, executedAt: null, verification: null, datahubWriteback: null,
      createdAt: stamp, updatedAt: stamp
    });
    const pending = await submitRemediationPlanForApproval(pool, { planId: id, expectedVersion: 1 });
    const approved = await decideRemediationPlan(pool, { planId: id, expectedVersion: pending.version,
      action: 'APPROVE', decidedBy: 'isolated-tester' }, { authority: testHarnessAuthority() });
    expect(approved.remoteActionBinding).toEqual(binding);
    const input = { planId: id, expectedVersion: approved.version, action, expectedFingerprint: binding.expectedFingerprint };
    const deps = { pool, authority: testHarnessAuthority(), adapter };
    const alteredAction = { ...action, targetQuantity: 0 };
    await expect(executeRemoteConstrainedAction({ ...input, action: alteredAction }, deps))
      .rejects.toBeInstanceOf(ApprovalRequiredError);
    expect(odoo.calls.filter((call) => call.method === 'write')).toHaveLength(0);
    const executed = await executeRemoteConstrainedAction(input, deps);
    expect(executed.outcome).toBe('EXECUTED');
    const persisted = await loadRemediationPlan(pool, id);
    expect(persisted?.state).toBe('RESOLVED');
    expect(persisted?.executionResult?.outcome).toBe('EXECUTED');
    expect(persisted?.executionResult?.receipt).toEqual(executed.receipt);
    expect(persisted?.executionResult?.fingerprintAfter).toBe(await adapter.fingerprint(action));
    expect(persisted?.verification?.result.overallStatus).toBe('PASS');
    expect((await executeRemoteConstrainedAction(input, deps)).outcome).toBe('ALREADY_EXECUTED');
    expect(odoo.calls.filter((call) => call.method === 'write')).toHaveLength(1);
  });

  async function approvedRemoteFixture() {
    const action: ConstrainedAction = {
      type: 'TEST_ADJUSTMENT', target: { systemType: 'test', resourceType: 'stock', resourceId: '42' }
    };
    const adapter: ConstrainedActionAdapter = {
      meta: { systemId: 'remote-provenance', systemType: 'test' },
      validate: async () => ({ ok: true }), fingerprint: async () => 'approved-state',
      execute: async () => ({ httpSucceeded: true, detail: 'applied', remoteWriteAttempted: true }),
      verify: async () => ({ pass: true, detail: 'postcondition holds' }),
      classifyRecovery: async () => 'applied'
    };
    const binding = await prepareRemoteActionBinding(adapter, action);
    const id = `remote-recovery-${randomUUID()}`;
    const stamp = new Date().toISOString();
    await createRemediationPlan(pool, {
      schemaVersion: '1.0', id, investigationId: id, incidentId: id, productId: 'fixture',
      triggerAsset: 'stock', requestedBy: 'isolated-tester', state: 'DRAFT', version: 1,
      proposedCorrections: [], verificationExpectations: [], remoteActionBinding: binding,
      approvalAction: null, approvedBy: null, approvalNote: null, approvedAt: null,
      executionResult: null, executedAt: null, verification: null, datahubWriteback: null,
      createdAt: stamp, updatedAt: stamp
    });
    const pending = await submitRemediationPlanForApproval(pool, { planId: id, expectedVersion: 1 });
    const approved = await decideRemediationPlan(pool, { planId: id, expectedVersion: pending.version,
      action: 'APPROVE', decidedBy: 'isolated-tester' }, { authority: testHarnessAuthority() });
    const input = { planId: id, expectedVersion: approved.version, action,
      expectedFingerprint: binding.expectedFingerprint, idempotencyKey: defaultExecutionKey(id, approved.version) };
    return { adapter, approved, input, keys: new PostgresExecutionKeyStore(pool) };
  }

  it.each(['reserved', 'completed'] as const)('keeps key-owned provenance when recovering a %s key', async (keyState) => {
    const { adapter, approved, input, keys } = await approvedRemoteFixture();
    await keys.reserve({ key: input.idempotencyKey, planId: approved.id,
      planVersion: approved.version, now: new Date(0), leaseMs: 1 });
    if (keyState === 'completed') await keys.complete(input.idempotencyKey, new Date(), { status: 'COMMITTED' });
    const executing = await applyRemediationPlanTransition(pool, approved.id, approved.version,
      { state: 'EXECUTING', updatedAt: new Date().toISOString() });
    const verifying = await applyRemediationPlanTransition(pool, approved.id, executing.version,
      { state: 'VERIFYING', updatedAt: new Date().toISOString() });
    let writes = 0;
    adapter.execute = async () => { writes += 1; throw new Error('recovery must not mutate'); };
    adapter.fingerprint = async () => 'after-state';
    const result = await executeRemoteConstrainedAction(input,
      { pool, adapter, authority: testHarnessAuthority(), executionKeys: keys });
    expect(result.outcome).toBe('ALREADY_EXECUTED');
    expect(result.receipt).toMatchObject({ planVersion: approved.version,
      sourceStateFingerprint: 'approved-state', recovered: true });
    const reloaded = await loadRemediationPlan(pool, approved.id);
    expect(reloaded?.version).toBe(verifying.version + 1);
    expect(reloaded?.executionResult?.receipt).toEqual(result.receipt);
    const journal = await pool.query(
      'select plan_version, source_state_fingerprint, receipt_json from ledgerguard_execution_journal where idempotency_key = $1',
      [input.idempotencyKey]);
    expect(journal.rows).toHaveLength(1);
    expect(journal.rows[0].plan_version).toBe(approved.version);
    expect(journal.rows[0].source_state_fingerprint).toBe('approved-state');
    expect(JSON.parse(journal.rows[0].receipt_json)).toEqual(result.receipt);
    expect(writes).toBe(0);
  });

  it('keeps an expired remote request reserved until its original worker finishes', async () => {
    const { adapter, input, keys } = await approvedRemoteFixture();
    let clock = new Date();
    let began!: () => void;
    let finish!: () => void;
    const started = new Promise<void>((resolve) => { began = resolve; });
    const pending = new Promise<void>((resolve) => { finish = resolve; });
    let writes = 0;
    adapter.execute = async () => {
      writes += 1;
      began();
      await pending;
      return { httpSucceeded: true, remoteWriteAttempted: true, detail: 'applied' };
    };
    adapter.classifyRecovery = async () => 'not_applied';
    const deps = { pool, adapter, authority: testHarnessAuthority(), executionKeys: keys, now: () => clock };
    const original = executeRemoteConstrainedAction(input, deps);
    await started;
    try {
      clock = new Date(clock.getTime() + 61_000);
      expect((await executeRemoteConstrainedAction(input, deps)).outcome).toBe('RECOVERY_REQUIRED');
      const persisted = await loadRemediationPlan(pool, input.planId);
      expect(persisted?.state).toBe('EXECUTING');
      expect((await keys.get(input.idempotencyKey))?.state).toBe('reserved');
      await expect(executeRemoteConstrainedAction({ ...input, expectedVersion: persisted!.version,
        idempotencyKey: `replacement:${input.idempotencyKey}` }, deps)).rejects.toBeInstanceOf(ApprovalRequiredError);
      expect(writes).toBe(1);
    } finally {
      finish();
      await original.catch(() => undefined);
    }
    expect((await original).outcome).toBe('EXECUTED');
    expect((await keys.get(input.idempotencyKey))?.state).toBe('completed');
    expect((await loadRemediationPlan(pool, input.planId))?.state).toBe('RESOLVED');
  });
});
