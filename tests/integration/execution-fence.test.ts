import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { PostgresExecutionKeyStore } from '@ledgerguard/postgres';
import { ConcurrentExecutionError } from '@ledgerguard/policy';
import { inventoryAdjustmentAction, odooQuantFingerprint } from '@ledgerguard/odoo';
import { adapterFromTransport } from '../../packages/odoo/src/adapter';
import { DEMO_QUANT } from '../../packages/odoo/test/fake-odoo';
import { FakeAtomicOdoo } from '../../packages/odoo/test/fake-atomic-odoo';
import { makePool } from '../../src/db/client';
import { executeRemoteConstrainedAction } from '../../src/remediation/execute-remote-action';
import { testHarnessAuthority } from '../../src/remediation/trusted-authority';
import type { RemediationPlanRecord } from '../../src/remediation/types';

const T0 = new Date('2026-11-03T08:00:00.000Z');
const AFTER_LEASE = new Date(T0.getTime() + 120_000);

let pool: Pool;
let keys: PostgresExecutionKeyStore;
beforeAll(() => {
  pool = makePool();
  keys = new PostgresExecutionKeyStore(pool);
});
afterAll(async () => {
  await pool.query("delete from ledgerguard_execution_keys where key like 'fence-test:%'");
  await pool.end();
});

const newKey = () => `fence-test:${randomUUID()}`;

describe('execution key fence generation (PostgreSQL)', () => {
  it('starts at 1, advances only on takeover of an expired lease, and only once per generation', async () => {
    const key = newKey();
    expect(await keys.reserve({ key, planId: 'p', planVersion: 1, now: T0, leaseMs: 60_000 })).toBe('reserved');
    expect((await keys.get(key))?.fenceGeneration).toBe(1);
    expect(await keys.takeOverExpiredLease({ key, now: new Date(T0.getTime() + 1000) })).toEqual({ outcome: 'in_flight' });
    const [left, right] = await Promise.all([
      keys.takeOverExpiredLease({ key, now: AFTER_LEASE }),
      keys.takeOverExpiredLease({ key, now: AFTER_LEASE })
    ]);
    // Each successful takeover owns a distinct, higher generation; none share one.
    const won = [left, right].flatMap((r) => (r.outcome === 'taken_over' ? [r.fenceGeneration] : []));
    expect(won.length).toBeGreaterThanOrEqual(1);
    expect(new Set(won).size).toBe(won.length);
    expect((await keys.get(key))?.fenceGeneration).toBe(Math.max(...won));
    expect(Math.max(...won)).toBe(1 + won.length);
  });

  it('a superseded generation cannot complete or release the key', async () => {
    const key = newKey();
    await keys.reserve({ key, planId: 'p', planVersion: 1, now: T0, leaseMs: 1000 });
    await keys.takeOverExpiredLease({ key, now: AFTER_LEASE });
    expect(await keys.complete(key, AFTER_LEASE, { late: true }, 1)).toBe(false);
    expect(await keys.failRetryable(key, AFTER_LEASE, { late: true }, 1)).toBe(false);
    expect(await keys.recoverExpiredReservation({ key, classification: 'not_applied', now: AFTER_LEASE, fenceGeneration: 1 })).toBe('in_flight');
    expect((await keys.get(key))?.state).toBe('reserved');
    expect(await keys.recoverExpiredReservation({ key, classification: 'not_applied', now: AFTER_LEASE, fenceGeneration: 2 })).toBe('failed_retryable');
  });

  it('re-reserving a released key moves to a higher generation', async () => {
    const key = newKey();
    await keys.reserve({ key, planId: 'p', planVersion: 1, now: T0 });
    expect(await keys.failRetryable(key, T0, {}, 1)).toBe(true);
    expect(await keys.reserve({ key, planId: 'p', planVersion: 1, now: AFTER_LEASE })).toBe('reserved');
    expect((await keys.get(key))?.fenceGeneration).toBe(2);
    expect(await keys.complete(key, AFTER_LEASE, {}, 2)).toBe(true);
  });

  it('keeps the generation-less calls working for unfenced adapters', async () => {
    const key = newKey();
    await keys.reserve({ key, planId: 'p', planVersion: 1, now: T0 });
    expect(await keys.complete(key, T0, {})).toBe(true);
  });
});

function action() {
  return inventoryAdjustmentAction({
    quantId: DEMO_QUANT.id, productId: DEMO_QUANT.productId, locationId: DEMO_QUANT.locationId,
    companyId: DEMO_QUANT.companyId, expectedQuantity: 20, targetQuantity: 10, expectedWriteDate: DEMO_QUANT.writeDate
  });
}

function planPool(planId: string) {
  let plan: RemediationPlanRecord = {
    schemaVersion: '1.0', id: planId, investigationId: 'inv', incidentId: 'inc', productId: 'LEDGERGUARD-DEMO-001',
    triggerAsset: 'stock.quant', requestedBy: 'tester', state: 'APPROVED', version: 2,
    remoteActionBinding: { systemId: 'odoo-19', systemType: 'odoo', actionJson: JSON.stringify(action()), expectedFingerprint: odooQuantFingerprint(DEMO_QUANT) },
    proposedCorrections: [{ sequence: 1, action: 'REGENERATE_INVENTORY_VALUATION', table: 'inventory_valuation', recordId: 'v', field: 'quantity_on_hand', beforeValue: '20', afterValue: '10', financialDelta: null, rollbackAssumption: 'fixture' }],
    verificationExpectations: [{ checkId: 'INVENTORY_VALUATION_CONSISTENCY', expectedStatus: 'PASS', description: 'on-hand 10' }],
    approvalAction: 'APPROVE', approvedBy: 'controller', approvalNote: null, approvedAt: T0.toISOString(),
    executionResult: null, executedAt: null, verification: null, datahubWriteback: null,
    createdAt: T0.toISOString(), updatedAt: T0.toISOString()
  };
  const row = () => ({
    id: plan.id, investigationId: plan.investigationId, incidentId: plan.incidentId, productId: plan.productId,
    triggerAsset: plan.triggerAsset, requestedBy: plan.requestedBy, state: plan.state, version: plan.version,
    remoteActionBindingJson: JSON.stringify(plan.remoteActionBinding),
    proposedCorrectionsJson: JSON.stringify(plan.proposedCorrections),
    verificationExpectationsJson: JSON.stringify(plan.verificationExpectations),
    approvalAction: plan.approvalAction, approvedBy: plan.approvedBy, approvalNote: plan.approvalNote, approvedAt: plan.approvedAt,
    executionResultJson: null, executedAt: plan.executedAt, verificationJson: null, datahubWritebackJson: null,
    createdAt: plan.createdAt, updatedAt: plan.updatedAt
  });
  const fake = {
    query: async (sql: string, params?: unknown[]) => {
      if (sql.includes('update remediation_plans')) {
        if (plan.version !== Number(params?.[1])) return { rows: [], rowCount: 0 };
        plan = { ...plan, state: String(params?.[2]) as RemediationPlanRecord['state'], version: plan.version + 1 };
      }
      return { rows: [row()], rowCount: 1 };
    }
  } as unknown as Pool;
  return { pool: fake, current: () => plan };
}

describe('remote execution fence (PostgreSQL keys + addon model)', () => {
  it('rejects a stale worker call that was already in flight when its lease expired', async () => {
    const odoo = new FakeAtomicOdoo(DEMO_QUANT);
    const adapter = adapterFromTransport(odoo.transport, 'odoo-19', { executionMode: 'atomic-addon' });
    const planId = `fence-plan-${randomUUID()}`;
    const plans = planPool(planId);
    const key = `fence-test:${planId}`;
    const input = { planId, expectedVersion: 2, action: action(), expectedFingerprint: odooQuantFingerprint(DEMO_QUANT), idempotencyKey: key };

    odoo.holdNextApply();
    const staleWorker = executeRemoteConstrainedAction(input, { pool: plans.pool, authority: testHarnessAuthority(), adapter, executionKeys: keys, now: () => T0 });
    await expect.poll(() => odoo.applyInFlight).toBe(true);

    const recovery = await executeRemoteConstrainedAction(input, { pool: plans.pool, authority: testHarnessAuthority(), adapter, executionKeys: keys, now: () => AFTER_LEASE });
    expect(recovery.outcome).toBe('INTERRUPTED');
    expect(odoo.fences.get(key)).toBe(2);
    expect(await keys.get(key)).toMatchObject({ state: 'failed_retryable', fenceGeneration: 2 });

    odoo.release();
    await expect(staleWorker).rejects.toBeInstanceOf(ConcurrentExecutionError);
    expect(odoo.calls.filter((c) => c.method === 'ledgerguard_apply_inventory').map((c) => c.request?.fence_generation)).toEqual([1]);
    expect(odoo.writes).toBe(0);
    expect(odoo.quant.quantity).toBe(20);
    expect(await keys.get(key)).toMatchObject({ state: 'failed_retryable', fenceGeneration: 2 });
    expect(plans.current().state).toBe('INTERRUPTED');

    // A later retry re-reserves above the fence and may write exactly once.
    expect(await keys.reserve({ key, planId, planVersion: 2, now: AFTER_LEASE })).toBe('reserved');
    expect((await keys.get(key))?.fenceGeneration).toBe(3);
    const retry = await adapter.withExecutionFence({ executionKey: key, generation: 3 }).execute(action());
    expect(retry).toMatchObject({ httpSucceeded: true, remoteWriteAttempted: true });
    expect(odoo.writes).toBe(1);
  });

  it('settles as applied when the stale worker committed before the fence, and fences its duplicate', async () => {
    const odoo = new FakeAtomicOdoo(DEMO_QUANT);
    const adapter = adapterFromTransport(odoo.transport, 'odoo-19', { executionMode: 'atomic-addon' });
    const planId = `fence-plan-${randomUUID()}`;
    const plans = planPool(planId);
    const key = `fence-test:${planId}`;
    // Worker reserved and its call committed in Odoo, then it died before settling the key.
    await keys.reserve({ key, planId, planVersion: 2, now: T0 });
    await plans.pool.query('update remediation_plans', [planId, 2, 'EXECUTING']);
    expect(await adapter.withExecutionFence({ executionKey: key, generation: 1 }).execute(action())).toMatchObject({ httpSucceeded: true });

    const recovery = await executeRemoteConstrainedAction(
      { planId, expectedVersion: 2, action: action(), expectedFingerprint: odooQuantFingerprint(DEMO_QUANT), idempotencyKey: key },
      { pool: plans.pool, authority: testHarnessAuthority(), adapter, executionKeys: keys, now: () => AFTER_LEASE }
    );
    expect(recovery.outcome).toBe('ALREADY_EXECUTED');
    expect(await keys.get(key)).toMatchObject({ state: 'completed', fenceGeneration: 2 });
    expect(await adapter.withExecutionFence({ executionKey: key, generation: 1 }).execute(action())).toMatchObject({ httpSucceeded: false, stale: true, remoteWriteAttempted: false });
    expect(odoo.writes).toBe(1);
  });
});
