import { describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import {
  investigate,
  type InvestigationInput,
  type ProposedCorrection,
  type SystemOfRecordAdapter,
  type SystemOfRecordSession
} from '@ledgerguard/core';
import { PostgresExecutionKeyStore, type Queryable } from '@ledgerguard/postgres';
import { ConcurrentExecutionError } from '@ledgerguard/policy';
import { executeRemediationPlan } from '../../../src/remediation/execute';
import { testHarnessAuthority } from '../../../src/remediation/trusted-authority';
import type { RemediationPlanRecord } from '../../../src/remediation/types';
import { duplicateIncidentInput } from '../../../packages/core/test/duplicate-fixtures';

const KEY = 'remediation:plan-dup-1:2';
const NOW = new Date('2026-03-02T18:00:00.000Z');

function repairedSnapshot(): InvestigationInput {
  const snapshot = duplicateIncidentInput();
  snapshot.movements = snapshot.movements.map((movement) =>
    movement.id === 'MOV-002' ? { ...movement, reversedAt: new Date('2026-03-02T16:00:00.000Z') } : movement
  );
  snapshot.valuations = snapshot.valuations.map((row) => ({
    ...row,
    quantityOnHand: '10.000',
    inventoryValue: '850000.00'
  }));
  return snapshot;
}

function partialRepairSnapshot(): InvestigationInput {
  const snapshot = duplicateIncidentInput();
  snapshot.movements = snapshot.movements.map((movement) =>
    movement.id === 'MOV-002' ? { ...movement, reversedAt: new Date('2026-03-02T16:00:00.000Z') } : movement
  );
  return snapshot;
}

function planRecord(state: RemediationPlanRecord['state'], version: number): RemediationPlanRecord {
  const report = investigate(duplicateIncidentInput());
  return {
    schemaVersion: '1.0',
    id: 'plan-dup-1',
    investigationId: 'inv-1',
    incidentId: 'incident-1',
    productId: 'ITEM-001',
    triggerAsset: 'inventory_movements',
    requestedBy: 'tester',
    state,
    version,
    proposedCorrections: report.proposedCorrections,
    verificationExpectations: report.verificationExpectations,
    approvalAction: 'APPROVE',
    approvedBy: 'controller',
    approvalNote: null,
    approvedAt: '2026-03-02T15:00:00.000Z',
    executionResult: null,
    executedAt: null,
    verification: null,
    datahubWriteback: null,
    createdAt: '2026-03-02T14:00:00.000Z',
    updatedAt: '2026-03-02T15:00:00.000Z'
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
          executionResult: typeof params?.[7] === 'string' ? JSON.parse(String(params[7])) : plan.executionResult,
          executedAt: typeof params?.[8] === 'string' ? String(params[8]) : plan.executedAt,
          verification: typeof params?.[9] === 'string' ? JSON.parse(String(params[9])) : plan.verification,
          updatedAt: String(params?.[11] ?? plan.updatedAt)
        };
        return { rows: [toRow(plan)], rowCount: 1 };
      }
      return { rows: [toRow(plan)], rowCount: 1 };
    }
  } as unknown as Pool;
  return {
    pool,
    current: () => plan
  };
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
      if (this.rows.has(key)) {
        return { rows: [], rowCount: 0 };
      }
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
        row.result_json = values[2];
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
    if (sql.includes("set state = 'reserved'") && sql.includes("failed_retryable")) {
      const row = this.rows.get(String(values[0]));
      if (row && row.state === 'failed_retryable') {
        row.state = 'reserved';
        row.planId = values[1];
        row.planVersion = values[2];
        row.leaseExpiresAt = values[4];
        return { rows: [{ key: values[0] }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    }
    return { rows: [], rowCount: 0 };
  }
}

function trackingAdapter(snapshot: InvestigationInput) {
  let mutations = 0;
  const adapter: SystemOfRecordAdapter = {
    meta: { systemId: 'test', systemType: 'memory' },
    async runInTransaction<T>(work: (session: SystemOfRecordSession) => Promise<T>): Promise<T> {
      return work({
        loadInvestigationInput: async () => structuredClone(snapshot),
        applyCorrection: async (correction: ProposedCorrection) => {
          mutations += 1;
          throw new Error(`recovery must not mutate ${correction.recordId}`);
        }
      });
    }
  };
  return { adapter, mutationCount: () => mutations };
}

async function reservedStore(expired: boolean) {
  const db = new MemoryKeys();
  const keys = new PostgresExecutionKeyStore(db as unknown as Queryable);
  const reservedAt = expired ? new Date('2026-03-02T17:00:00.000Z') : NOW;
  await keys.reserve({
    key: KEY,
    planId: 'plan-dup-1',
    planVersion: 2,
    now: reservedAt,
    leaseMs: expired ? 1000 : 60_000
  });
  return { db, keys };
}

describe('crash-window execution recovery', () => {
  it('APPROVED leftover reserved key recovers without requiring another approval cycle', async () => {
    const { pool, current } = createPlanPool(planRecord('APPROVED', 2));
    const { keys } = await reservedStore(true);
    const { adapter, mutationCount } = trackingAdapter(repairedSnapshot());

    const result = await executeRemediationPlan(
      { planId: 'plan-dup-1', expectedVersion: 2, idempotencyKey: KEY },
      { pool, authority: testHarnessAuthority(), adapter, executionKeys: keys, now: () => NOW }
    );

    expect(result.outcome).toBe('ALREADY_EXECUTED');
    expect(current().state).toBe('RESOLVED');
    expect(mutationCount()).toBe(0);
  });

  it('A: VERIFYING + expired reserved + repaired SoR recovers without a fresh approval or mutation', async () => {
    const { pool, current } = createPlanPool(planRecord('VERIFYING', 4));
    const { db, keys } = await reservedStore(true);
    const { adapter, mutationCount } = trackingAdapter(repairedSnapshot());

    const result = await executeRemediationPlan(
      { planId: 'plan-dup-1', expectedVersion: 2, idempotencyKey: KEY },
      { pool, authority: testHarnessAuthority(), adapter, executionKeys: keys, now: () => NOW }
    );

    expect(result.outcome).toBe('ALREADY_EXECUTED');
    expect(result.plan.state).toBe('RESOLVED');
    expect(result.receipt?.recovered).toBe(true);
    expect(result.receipt?.recoveryClassification).toBe('applied');
    expect(mutationCount()).toBe(0);
    expect(db.rows.get(KEY)?.state).toBe('completed');
    expect(db.journal.length).toBeGreaterThan(0);
    expect(current().state).toBe('RESOLVED');

    const replay = await executeRemediationPlan(
      { planId: 'plan-dup-1', expectedVersion: 2, idempotencyKey: KEY },
      { pool, authority: testHarnessAuthority(), adapter, executionKeys: keys, now: () => NOW }
    );
    expect(replay.outcome).toBe('ALREADY_EXECUTED');
    expect(mutationCount()).toBe(0);
  });

  it('B: EXECUTING + expired reserved + original incident becomes INTERRUPTED and can resume once', async () => {
    const { pool, current } = createPlanPool(planRecord('EXECUTING', 3));
    const { db, keys } = await reservedStore(true);
    const broken = duplicateIncidentInput();
    let mutations = 0;
    const adapter: SystemOfRecordAdapter = {
      meta: { systemId: 'test', systemType: 'memory' },
      async runInTransaction<T>(work: (session: SystemOfRecordSession) => Promise<T>): Promise<T> {
        const working = structuredClone(broken);
        return work({
          loadInvestigationInput: async () => structuredClone(working),
          applyCorrection: async (correction) => {
            mutations += 1;
            if (correction.table === 'inventory_movements') {
              working.movements = working.movements.map((movement) =>
                movement.id === correction.recordId
                  ? { ...movement, reversedAt: new Date(correction.afterValue) }
                  : movement
              );
            }
            if (correction.table === 'inventory_valuation') {
              working.valuations = working.valuations.map((row) => {
                if (row.id !== correction.recordId) return row;
                if (correction.field === 'quantity_on_hand') return { ...row, quantityOnHand: correction.afterValue };
                if (correction.field === 'inventory_value') return { ...row, inventoryValue: correction.afterValue };
                return row;
              });
            }
            return {
              sequence: correction.sequence,
              action: correction.action,
              table: correction.table,
              recordId: correction.recordId,
              status: 'APPLIED',
              detail: correction.field
            };
          }
        });
      }
    };

    const recovered = await executeRemediationPlan(
      { planId: 'plan-dup-1', expectedVersion: 2, idempotencyKey: KEY },
      { pool, authority: testHarnessAuthority(), adapter, executionKeys: keys, now: () => NOW }
    );
    expect(recovered.outcome).toBe('INTERRUPTED');
    expect(recovered.plan.state).toBe('INTERRUPTED');
    expect(db.rows.get(KEY)?.state).toBe('failed_retryable');
    expect(mutations).toBe(0);

    const resumed = await executeRemediationPlan(
      { planId: 'plan-dup-1', expectedVersion: current().version, idempotencyKey: KEY },
      { pool, authority: testHarnessAuthority(), adapter, executionKeys: keys, now: () => NOW }
    );
    expect(resumed.outcome).toBe('EXECUTED');
    expect(resumed.plan.state).toBe('RESOLVED');
    expect(mutations).toBeGreaterThan(0);
  });

  it('C: VERIFYING + expired reserved + ambiguous SoR returns RECOVERY_REQUIRED without completing the key', async () => {
    const { pool, current } = createPlanPool(planRecord('VERIFYING', 4));
    const { db, keys } = await reservedStore(true);
    const { adapter, mutationCount } = trackingAdapter(partialRepairSnapshot());

    const result = await executeRemediationPlan(
      { planId: 'plan-dup-1', expectedVersion: 2, idempotencyKey: KEY },
      { pool, authority: testHarnessAuthority(), adapter, executionKeys: keys, now: () => NOW }
    );

    expect(result.outcome).toBe('RECOVERY_REQUIRED');
    expect(current().state).toBe('VERIFYING');
    expect(db.rows.get(KEY)?.state).toBe('reserved');
    expect(mutationCount()).toBe(0);
  });

  it('D: unexpired reserved key is concurrent execution, not recovery', async () => {
    const { pool } = createPlanPool(planRecord('VERIFYING', 4));
    const { keys } = await reservedStore(false);
    const { adapter, mutationCount } = trackingAdapter(repairedSnapshot());

    await expect(
      executeRemediationPlan(
        { planId: 'plan-dup-1', expectedVersion: 2, idempotencyKey: KEY },
        { pool, authority: testHarnessAuthority(), adapter, executionKeys: keys, now: () => NOW }
      )
    ).rejects.toBeInstanceOf(ConcurrentExecutionError);
    expect(mutationCount()).toBe(0);
  });

  it('E: completed key with VERIFYING plan reconciles to RESOLVED without mutation', async () => {
    const { pool, current } = createPlanPool(planRecord('VERIFYING', 4));
    const { db, keys } = await reservedStore(true);
    await keys.complete(KEY, NOW, { status: 'EXECUTED' });
    const { adapter, mutationCount } = trackingAdapter(repairedSnapshot());

    const result = await executeRemediationPlan(
      { planId: 'plan-dup-1', expectedVersion: 2, idempotencyKey: KEY },
      { pool, authority: testHarnessAuthority(), adapter, executionKeys: keys, now: () => NOW }
    );

    expect(result.outcome).toBe('ALREADY_EXECUTED');
    expect(current().state).toBe('RESOLVED');
    expect(db.rows.get(KEY)?.state).toBe('completed');
    expect(mutationCount()).toBe(0);
  });

  it('F: partial repair that fails verification is RECOVERY_REQUIRED', async () => {
    const { pool, current } = createPlanPool(planRecord('EXECUTING', 3));
    const { db, keys } = await reservedStore(true);
    const { adapter, mutationCount } = trackingAdapter(partialRepairSnapshot());

    const result = await executeRemediationPlan(
      { planId: 'plan-dup-1', expectedVersion: 2, idempotencyKey: KEY },
      { pool, authority: testHarnessAuthority(), adapter, executionKeys: keys, now: () => NOW }
    );

    expect(result.outcome).toBe('RECOVERY_REQUIRED');
    expect(current().state).toBe('EXECUTING');
    expect(db.rows.get(KEY)?.state).toBe('reserved');
    expect(mutationCount()).toBe(0);
  });

  it('G: concurrent recovery reconciles once', async () => {
    const { pool, current } = createPlanPool(planRecord('VERIFYING', 4));
    const { keys } = await reservedStore(true);
    const { adapter, mutationCount } = trackingAdapter(repairedSnapshot());
    const deps = { pool, authority: testHarnessAuthority(), adapter, executionKeys: keys, now: () => NOW };

    const [first, second] = await Promise.all([
      executeRemediationPlan({ planId: 'plan-dup-1', expectedVersion: 2, idempotencyKey: KEY }, deps),
      executeRemediationPlan({ planId: 'plan-dup-1', expectedVersion: 2, idempotencyKey: KEY }, deps)
    ]);

    expect([first.outcome, second.outcome].every((outcome) => outcome === 'ALREADY_EXECUTED')).toBe(true);
    expect(current().state).toBe('RESOLVED');
    expect(mutationCount()).toBe(0);
  });
});
