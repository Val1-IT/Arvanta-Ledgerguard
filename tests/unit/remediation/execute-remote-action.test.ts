import { describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { executeConstrainedAction, type ConstrainedActionAdapter } from '@ledgerguard/core';
import { PostgresExecutionKeyStore, type Queryable } from '@ledgerguard/postgres';
import { ApprovalRequiredError, ConcurrentExecutionError } from '@ledgerguard/policy';
import { inventoryAdjustmentAction } from '@ledgerguard/odoo';
import { adapterFromTransport } from '../../../packages/odoo/src/adapter';
import { executeRemoteConstrainedAction } from '../../../src/remediation/execute-remote-action';
import { testHarnessAuthority } from '../../../src/remediation/trusted-authority';
import type { RemediationPlanRecord } from '../../../src/remediation/types';
import { DEMO_QUANT, FakeOdoo } from '../../../packages/odoo/test/fake-odoo';
import { odooQuantFingerprint } from '@ledgerguard/odoo';

const KEY = 'remediation:plan-odoo-1:2';
const NOW = new Date('2026-09-26T18:00:00.000Z');

function action() {
  return inventoryAdjustmentAction({
    quantId: DEMO_QUANT.id,
    productId: DEMO_QUANT.productId,
    locationId: DEMO_QUANT.locationId,
    companyId: DEMO_QUANT.companyId,
    expectedQuantity: 20,
    targetQuantity: 10,
    expectedWriteDate: DEMO_QUANT.writeDate
  });
}

function planRecord(state: RemediationPlanRecord['state'], version: number): RemediationPlanRecord {
  return {
    schemaVersion: '1.0',
    id: 'plan-odoo-1',
    investigationId: 'inv-odoo',
    incidentId: 'incident-odoo',
    productId: 'LEDGERGUARD-DEMO-001',
    triggerAsset: 'stock.quant',
    requestedBy: 'tester',
    state,
    version,
    proposedCorrections: [
      {
        sequence: 1,
        action: 'UPDATE_INVENTORY_VALUATION',
        table: 'inventory_valuation',
        recordId: 'val-item-001',
        field: 'quantity_on_hand',
        beforeValue: '20',
        afterValue: '10',
        reason: 'odoo inventory fixture'
      }
    ],
    verificationExpectations: [{ checkId: 'INVENTORY_VALUATION_CONSISTENCY', expectedStatus: 'PASS' }],
    approvalAction: state === 'APPROVED' || state === 'EXECUTING' || state === 'VERIFYING' || state === 'INTERRUPTED' ? 'APPROVE' : null,
    approvedBy: 'controller',
    approvalNote: null,
    approvedAt: '2026-09-26T15:00:00.000Z',
    executionResult: null,
    executedAt: null,
    verification: null,
    datahubWriteback: null,
    createdAt: '2026-09-26T14:00:00.000Z',
    updatedAt: '2026-09-26T15:00:00.000Z'
  };
}

function toRow(plan: RemediationPlanRecord) {
  return {
    id: plan.id,
    investigationId: plan.investigationId,
    incidentId: plan.incidentId,
    productId: plan.productId,
    triggerAsset: plan.triggerAsset,
    requestedBy: plan.requestedBy,
    state: plan.state,
    version: plan.version,
    proposedCorrectionsJson: JSON.stringify(plan.proposedCorrections),
    verificationExpectationsJson: JSON.stringify(plan.verificationExpectations),
    approvalAction: plan.approvalAction,
    approvedBy: plan.approvedBy,
    approvalNote: plan.approvalNote,
    approvedAt: plan.approvedAt,
    executionResultJson: plan.executionResult ? JSON.stringify(plan.executionResult) : null,
    executedAt: plan.executedAt,
    verificationJson: plan.verification ? JSON.stringify(plan.verification) : null,
    datahubWritebackJson: plan.datahubWriteback ? JSON.stringify(plan.datahubWriteback) : null,
    createdAt: plan.createdAt,
    updatedAt: plan.updatedAt
  };
}

function createPlanPool(initial: RemediationPlanRecord) {
  let plan = initial;
  const pool = {
    query: async (sql: string, params?: unknown[]) => {
      if (sql.includes('update remediation_plans')) {
        const expectedVersion = Number(params?.[1]);
        if (plan.version !== expectedVersion) {
          return { rows: [], rowCount: 0 };
        }
        plan = {
          ...plan,
          state: String(params?.[2]) as RemediationPlanRecord['state'],
          version: plan.version + 1,
          updatedAt: String(params?.[11] ?? plan.updatedAt)
        };
        return { rows: [toRow(plan)], rowCount: 1 };
      }
      return { rows: [toRow(plan)], rowCount: 1 };
    }
  } as unknown as Pool;
  return { pool, current: () => plan };
}

class MemoryKeys {
  rows = new Map<string, Record<string, unknown>>();
  journal: unknown[] = [];
  async query(sql: string, params?: unknown[]) {
    const values = params ?? [];
    if (sql.includes('insert into ledgerguard_execution_journal')) {
      this.journal.push(values);
      return { rows: [{ id: values[0] }], rowCount: 1 };
    }
    if (sql.includes('insert into ledgerguard_execution_keys') && sql.includes('on conflict')) {
      const key = String(values[0]);
      if (this.rows.has(key)) return { rows: [], rowCount: 0 };
      this.rows.set(key, {
        key,
        planId: values[1],
        planVersion: values[2],
        state: 'reserved',
        createdAt: values[3],
        leaseExpiresAt: values[4]
      });
      return { rows: [{ key }], rowCount: 1 };
    }
    if (sql.includes('from ledgerguard_execution_keys where key')) {
      const row = this.rows.get(String(values[0]));
      return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
    }
    if (sql.includes("set state = 'completed'")) {
      const row = this.rows.get(String(values[0]));
      if (row && row.state === 'reserved') {
        row.state = 'completed';
        return { rows: [{ key: values[0] }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    }
    if (sql.includes("set state = 'failed_retryable'")) {
      const row = this.rows.get(String(values[0]));
      if (row && row.state === 'reserved') {
        row.state = 'failed_retryable';
        return { rows: [], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    }
    if (sql.includes("set state = 'reserved'") && sql.includes('failed_retryable')) {
      const row = this.rows.get(String(values[0]));
      if (row && row.state === 'failed_retryable') {
        row.state = 'reserved';
        return { rows: [{ key: values[0] }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    }
    return { rows: [], rowCount: 0 };
  }
}

async function keys(expired = false) {
  const db = new MemoryKeys();
  const store = new PostgresExecutionKeyStore(db as unknown as Queryable);
  await store.reserve({
    key: KEY,
    planId: 'plan-odoo-1',
    planVersion: 2,
    now: expired ? new Date('2026-09-26T17:00:00.000Z') : NOW,
    leaseMs: expired ? 1000 : 60_000
  });
  return { db, store };
}

describe('executeRemoteConstrainedAction', () => {
  it('rejects unapproved plans before any Odoo mutation', async () => {
    const { pool } = createPlanPool(planRecord('PENDING_APPROVAL', 2));
    const odoo = new FakeOdoo(DEMO_QUANT);
    await expect(
      executeRemoteConstrainedAction(
        {
          planId: 'plan-odoo-1',
          expectedVersion: 2,
          action: action(),
          expectedFingerprint: odooQuantFingerprint(DEMO_QUANT),
          idempotencyKey: KEY
        },
        {
          pool,
          authority: testHarnessAuthority(),
          adapter: adapterFromTransport(odoo.transport) as ConstrainedActionAdapter,
          executionKeys: new PostgresExecutionKeyStore(new MemoryKeys() as unknown as Queryable),
          now: () => NOW
        }
      )
    ).rejects.toBeInstanceOf(ApprovalRequiredError);
    expect(odoo.calls.some((call) => call.method === 'write')).toBe(false);
  });

  it('executes an approved action through reservation, verify, journal, and RESOLVED', async () => {
    const { pool, current } = createPlanPool(planRecord('APPROVED', 2));
    const odoo = new FakeOdoo(DEMO_QUANT);
    const db = new MemoryKeys();
    const result = await executeRemoteConstrainedAction(
      {
        planId: 'plan-odoo-1',
        expectedVersion: 2,
        action: action(),
        expectedFingerprint: odooQuantFingerprint(DEMO_QUANT),
        idempotencyKey: KEY
      },
      {
        pool,
        authority: testHarnessAuthority(),
        adapter: adapterFromTransport(odoo.transport),
        executionKeys: new PostgresExecutionKeyStore(db as unknown as Queryable),
        now: () => NOW
      }
    );
    expect(result.outcome).toBe('EXECUTED');
    expect(current().state).toBe('RESOLVED');
    expect(odoo.quant.quantity).toBe(10);
    expect(db.rows.get(KEY)?.state).toBe('completed');
    expect(db.journal.length).toBeGreaterThan(0);
  });

  it('replays a completed key without a second Odoo write', async () => {
    const { pool } = createPlanPool(planRecord('RESOLVED', 4));
    const { db, store } = await keys(true);
    await store.complete(KEY, NOW, { status: 'EXECUTED' });
    const odoo = new FakeOdoo({ ...DEMO_QUANT, quantity: 10, writeDate: '2026-09-26 12:00:00' });
    const result = await executeRemoteConstrainedAction(
      {
        planId: 'plan-odoo-1',
        expectedVersion: 2,
        action: action(),
        expectedFingerprint: odooQuantFingerprint(DEMO_QUANT),
        idempotencyKey: KEY
      },
      { pool, authority: testHarnessAuthority(), adapter: adapterFromTransport(odoo.transport), executionKeys: store, now: () => NOW }
    );
    expect(result.outcome).toBe('ALREADY_EXECUTED');
    expect(odoo.calls.some((call) => call.method === 'write')).toBe(false);
  });

  it('recovers an expired reserved key when Odoo already shows quantity 10', async () => {
    const { pool, current } = createPlanPool(planRecord('VERIFYING', 4));
    const { store } = await keys(true);
    const odoo = new FakeOdoo({ ...DEMO_QUANT, quantity: 10, writeDate: '2026-09-26 12:00:00' });
    const result = await executeRemoteConstrainedAction(
      {
        planId: 'plan-odoo-1',
        expectedVersion: 2,
        action: action(),
        expectedFingerprint: odooQuantFingerprint(DEMO_QUANT),
        idempotencyKey: KEY
      },
      { pool, authority: testHarnessAuthority(), adapter: adapterFromTransport(odoo.transport), executionKeys: store, now: () => NOW }
    );
    expect(result.outcome).toBe('ALREADY_EXECUTED');
    expect(current().state).toBe('RESOLVED');
    expect(odoo.calls.some((call) => call.method === 'write')).toBe(false);
  });

  it('returns RECOVERY_REQUIRED for an unexpected Odoo quantity', async () => {
    const { pool, current } = createPlanPool(planRecord('EXECUTING', 3));
    const { store } = await keys(true);
    const odoo = new FakeOdoo({ ...DEMO_QUANT, quantity: 15, writeDate: '2026-09-26 11:30:00' });
    const result = await executeRemoteConstrainedAction(
      {
        planId: 'plan-odoo-1',
        expectedVersion: 2,
        action: action(),
        expectedFingerprint: odooQuantFingerprint(DEMO_QUANT),
        idempotencyKey: KEY
      },
      { pool, authority: testHarnessAuthority(), adapter: adapterFromTransport(odoo.transport), executionKeys: store, now: () => NOW }
    );
    expect(result.outcome).toBe('RECOVERY_REQUIRED');
    expect(current().state).toBe('EXECUTING');
    expect(odoo.calls.some((call) => call.method === 'write')).toBe(false);
  });

  it('keeps an unexpired reservation concurrent', async () => {
    const { pool } = createPlanPool(planRecord('EXECUTING', 3));
    const { store } = await keys(false);
    const odoo = new FakeOdoo(DEMO_QUANT);
    await expect(
      executeRemoteConstrainedAction(
        {
          planId: 'plan-odoo-1',
          expectedVersion: 2,
          action: action(),
          expectedFingerprint: odooQuantFingerprint(DEMO_QUANT),
          idempotencyKey: KEY
        },
        { pool, authority: testHarnessAuthority(), adapter: adapterFromTransport(odoo.transport), executionKeys: store, now: () => NOW }
      )
    ).rejects.toBeInstanceOf(ConcurrentExecutionError);
    expect(odoo.calls.some((call) => call.method === 'write')).toBe(false);
  });
});

describe('executeConstrainedAction recoveryRequired', () => {
  it('maps adapter recoveryRequired to RECOVERY_REQUIRED with remoteWriteAttempted', async () => {
    const result = await executeConstrainedAction(
      {
        meta: { systemId: 't', systemType: 't' },
        fingerprint: async () => 'abc',
        validate: async () => ({ ok: true }),
        execute: async () => ({
          httpSucceeded: false,
          recoveryRequired: true,
          remoteWriteAttempted: true,
          detail: 'conflict'
        }),
        verify: async () => ({ pass: true, detail: 'ok' }),
        classifyRecovery: async () => 'ambiguous'
      },
      { type: 'TEST', target: { systemType: 't', resourceType: 'row', resourceId: '1' } }
    );
    expect(result.outcome).toBe('RECOVERY_REQUIRED');
    expect(result.remoteWriteAttempted).toBe(true);
  });
});
