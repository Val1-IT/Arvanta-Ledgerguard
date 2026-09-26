import { describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { PostgresExecutionKeyStore, type Queryable } from '@ledgerguard/postgres';
import { inventoryAdjustmentAction, OdooInventoryAdapter, odooQuantFingerprint } from '@ledgerguard/odoo';
import { executeRemoteConstrainedAction } from '../../src/remediation/execute-remote-action';
import { testHarnessAuthority } from '../../src/remediation/trusted-authority';
import type { RemediationPlanRecord } from '../../src/remediation/types';
import { liveConfig, seedDemoQuant } from '../../packages/odoo/test/live-bootstrap';

const config = liveConfig();
const KEY = 'remediation:plan-odoo-live:2';
const NOW = new Date();

function planRecord(state: RemediationPlanRecord['state'], version: number): RemediationPlanRecord {
  return {
    schemaVersion: '1.0',
    id: 'plan-odoo-live',
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
        action: 'REGENERATE_INVENTORY_VALUATION',
        table: 'inventory_valuation',
        recordId: 'val-item-001',
        field: 'quantity_on_hand',
        beforeValue: '20',
        afterValue: '10',
        financialDelta: null,
        rollbackAssumption: 'odoo live fixture'
      }
    ],
    verificationExpectations: [
      { checkId: 'INVENTORY_VALUATION_CONSISTENCY', expectedStatus: 'PASS', description: 'on-hand 10' }
    ],
    approvalAction: 'APPROVE',
    approvedBy: 'controller',
    approvalNote: null,
    approvedAt: NOW.toISOString(),
    executionResult: null,
    executedAt: null,
    verification: null,
    datahubWriteback: null,
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString()
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
        if (plan.version !== expectedVersion) return { rows: [], rowCount: 0 };
        plan = {
          ...plan,
          state: String(params?.[2]) as RemediationPlanRecord['state'],
          version: plan.version + 1
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
    return { rows: [], rowCount: 0 };
  }
}

describe.skipIf(!config)('Odoo 19 control-plane lifecycle', () => {
  it('D/E: approved 20→10 then completed replay does not write again', async () => {
    const seeded = await seedDemoQuant(config!, 20);
    const adapter = new OdooInventoryAdapter(config!);
    const action = inventoryAdjustmentAction({
      quantId: seeded.quantId,
      productId: seeded.productId,
      locationId: seeded.locationId,
      companyId: seeded.companyId,
      expectedQuantity: seeded.quantity,
      targetQuantity: 10,
      expectedWriteDate: seeded.writeDate
    });
    const { pool, current } = createPlanPool(planRecord('APPROVED', 2));
    const db = new MemoryKeys();
    const keys = new PostgresExecutionKeyStore(db as unknown as Queryable);
    const first = await executeRemoteConstrainedAction(
      {
        planId: 'plan-odoo-live',
        expectedVersion: 2,
        action,
        expectedFingerprint: odooQuantFingerprint({
          id: seeded.quantId,
          productId: seeded.productId,
          locationId: seeded.locationId,
          companyId: seeded.companyId,
          quantity: seeded.quantity,
          writeDate: seeded.writeDate
        }),
        idempotencyKey: KEY
      },
      { pool, authority: testHarnessAuthority(), adapter, executionKeys: keys, now: () => NOW }
    );
    expect(first.outcome).toBe('EXECUTED');
    expect(current().state).toBe('RESOLVED');
    expect((await adapter.readQuant(seeded.quantId)).quantity).toBe(10);

    const replay = await executeRemoteConstrainedAction(
      {
        planId: 'plan-odoo-live',
        expectedVersion: 2,
        action,
        expectedFingerprint: 'ignored',
        idempotencyKey: KEY
      },
      { pool, authority: testHarnessAuthority(), adapter, executionKeys: keys, now: () => NOW }
    );
    expect(replay.outcome).toBe('ALREADY_EXECUTED');
    expect((await adapter.readQuant(seeded.quantId)).quantity).toBe(10);
  });

  it('F: reserved leftover after Odoo is already 10 recovers without a second write', async () => {
    const seeded = await seedDemoQuant(config!, 10);
    const adapter = new OdooInventoryAdapter(config!);
    const action = inventoryAdjustmentAction({
      quantId: seeded.quantId,
      productId: seeded.productId,
      locationId: seeded.locationId,
      companyId: seeded.companyId,
      expectedQuantity: 20,
      targetQuantity: 10,
      expectedWriteDate: seeded.writeDate
    });
    const { pool, current } = createPlanPool(planRecord('VERIFYING', 4));
    const db = new MemoryKeys();
    const keys = new PostgresExecutionKeyStore(db as unknown as Queryable);
    await keys.reserve({
      key: KEY + ':crash',
      planId: 'plan-odoo-live',
      planVersion: 2,
      now: new Date(NOW.getTime() - 120_000),
      leaseMs: 1000
    });
    const recovered = await executeRemoteConstrainedAction(
      {
        planId: 'plan-odoo-live',
        expectedVersion: 2,
        action,
        expectedFingerprint: 'stale-approved',
        idempotencyKey: KEY + ':crash'
      },
      { pool, authority: testHarnessAuthority(), adapter, executionKeys: keys, now: () => NOW }
    );
    expect(recovered.outcome).toBe('ALREADY_EXECUTED');
    expect(current().state).toBe('RESOLVED');
    expect((await adapter.readQuant(seeded.quantId)).quantity).toBe(10);
  });
});
