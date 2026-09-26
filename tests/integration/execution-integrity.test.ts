import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { investigate, type SystemOfRecordAdapter, type SystemOfRecordSession } from '@ledgerguard/core';
import { defaultExecutionKey, PostgresSystemOfRecordAdapter } from '@ledgerguard/postgres';
import { makePool } from '../../src/db/client';
import { seedDatabase } from '../../src/db/seed';
import { applyDuplicateInventoryError } from '../../demo-data/scenarios/duplicate-inventory';
import { loadInvestigationInput } from '../../src/db/repositories/investigation';
import { saveInvestigationRun } from '../../src/db/repositories/investigation-runs';
import { SCHEMA_VERSION as AGENT_SCHEMA_VERSION, type InvestigationRunRecord } from '../../src/agent/types';
import {
  createRemediationPlan,
  decideRemediationPlan,
  submitRemediationPlanForApproval
} from '../../src/remediation/approve';
import { executeRemediationPlan } from '../../src/remediation/execute';
import { testHarnessAuthority } from '../../src/remediation/trusted-authority';
import { loadRemediationPlan } from '../../src/db/repositories/remediation-plans';

async function seedCompletedInvestigation(pool: Pool): Promise<string> {
  const investigationId = randomUUID();
  const incidentId = `incident-${investigationId}`;
  const record: InvestigationRunRecord = {
    investigationId,
    incidentId,
    input: {
      incidentId,
      productId: 'ITEM-001',
      triggerAsset: 'inventory_movements',
      requestedBy: 'test-harness',
      mode: 'TEST'
    },
    finalState: 'INVESTIGATION_COMPLETED',
    output: {
      schemaVersion: AGENT_SCHEMA_VERSION,
      investigationId,
      incidentId,
      status: 'COMPLETED',
      evidenceSufficiency: { sufficient: true, confidence: 0.95, missingEvidence: [] },
      rootCauseExplanation: 'duplicate inventory movement fixture',
      businessImpactExplanation: 'quantity 20 instead of 10',
      datahubContext: { assetsRead: [], owners: [], glossaryTerms: [], tags: [], lineagePath: [] },
      engineResultReference: {
        incidentType: 'DUPLICATE_INVENTORY_MOVEMENT',
        overallStatus: 'CRITICAL',
        primaryExposure: '850000.00',
        currency: 'IDR',
        affectedRecordCount: 3,
        correctionTargetCount: 2
      },
      remediationRationale: 'reverse MOV-002 only',
      recommendedNextStep: 'REQUEST_APPROVAL',
      activityLog: []
    },
    error: null,
    stateHistory: [{ state: 'INVESTIGATION_COMPLETED', at: new Date().toISOString() }],
    createdAt: new Date().toISOString()
  };
  await saveInvestigationRun(pool, record);
  return investigationId;
}

async function approveDuplicatePlan(pool: Pool) {
  await seedDatabase(pool);
  await applyDuplicateInventoryError(pool);
  const investigationId = await seedCompletedInvestigation(pool);
  const draft = await createRemediationPlan(
    { investigationId, requestedBy: 'tester' },
    { pool, authority: testHarnessAuthority() }
  );
  const pending = await submitRemediationPlanForApproval(pool, {
    planId: draft.id,
    expectedVersion: draft.version
  });
  return decideRemediationPlan(
    pool,
    {
      planId: pending.id,
      expectedVersion: pending.version,
      action: 'APPROVE',
      decidedBy: 'controller'
    },
    { authority: testHarnessAuthority() }
  );
}

function skipReverseWrites(inner: PostgresSystemOfRecordAdapter): SystemOfRecordAdapter {
  return {
    meta: inner.meta,
    runInTransaction<T>(work: (session: SystemOfRecordSession) => Promise<T>): Promise<T> {
      return inner.runInTransaction(async (session) =>
        work({
          loadInvestigationInput: () => session.loadInvestigationInput(),
          applyCorrection: async (correction, now) => {
            if (correction.action === 'REVERSE_INVENTORY_MOVEMENT') {
              return {
                sequence: correction.sequence,
                action: correction.action,
                table: correction.table,
                recordId: correction.recordId,
                status: 'APPLIED',
                detail: 'intentionally skipped so duplicate remains and verification fails'
              };
            }
            return session.applyCorrection(correction, now);
          }
        })
      );
    }
  };
}

describe('PostgreSQL execution-integrity atomicity', () => {
  let pool: Pool;

  beforeAll(() => {
    pool = makePool();
  });

  afterAll(async () => {
    await pool.end();
  });

  it('applies 0005 execution journal schema', async () => {
    const lease = await pool.query(
      `select 1 from information_schema.columns
        where table_name = 'ledgerguard_execution_keys' and column_name = 'lease_expires_at'`
    );
    const journal = await pool.query(
      `select 1 from information_schema.tables
        where table_name = 'ledgerguard_execution_journal'`
    );
    const idx = await pool.query(
      `select 1 from pg_indexes
        where tablename = 'ledgerguard_execution_journal'
          and indexname = 'ledgerguard_execution_journal_key_idx'`
    );
    expect(lease.rowCount).toBe(1);
    expect(journal.rowCount).toBe(1);
    expect(idx.rowCount).toBe(1);
  });

  it('commits mutation, completed key, journal, receipt, and RESOLVED plan together', async () => {
    const approved = await approveDuplicatePlan(pool);
    const executed = await executeRemediationPlan(
      { planId: approved.id, expectedVersion: approved.version },
      { pool, authority: testHarnessAuthority() }
    );

    expect(executed.outcome).toBe('EXECUTED');
    expect(executed.plan.state).toBe('RESOLVED');
    expect(executed.plan.verification?.result.overallStatus).toBe('PASS');
    expect(executed.receipt?.committed).toBe(true);
    expect(executed.receipt?.recovered).toBe(false);
    expect(executed.receipt?.verificationOverallStatus).toBe('PASS');

    const movements = await pool.query(
      `select id, reversed_at as "reversedAt" from inventory_movements where id in ('MOV-001','MOV-002') order by id`
    );
    expect(movements.rows.find((row) => row.id === 'MOV-001')?.reversedAt).toBeNull();
    expect(movements.rows.find((row) => row.id === 'MOV-002')?.reversedAt).not.toBeNull();
    const valuation = await pool.query(
      `select quantity_on_hand as qty, inventory_value as value from inventory_valuation where id = 'val-item-001'`
    );
    expect(Number(valuation.rows[0]?.qty)).toBe(10);
    expect(Number(valuation.rows[0]?.value)).toBe(850000);

    const key = defaultExecutionKey(approved.id, approved.version);
    const keys = await pool.query(`select state from ledgerguard_execution_keys where key = $1`, [key]);
    expect(keys.rows[0]?.state).toBe('completed');
    const journal = await pool.query(
      `select status, source_state_fingerprint as fingerprint, receipt_json as receipt
         from ledgerguard_execution_journal where idempotency_key = $1`,
      [key]
    );
    expect(journal.rowCount).toBe(1);
    expect(journal.rows[0]?.status).toBe('COMMITTED');
    const receipt = JSON.parse(String(journal.rows[0]?.receipt));
    expect(receipt.committed).toBe(true);
    expect(receipt.planId).toBe(approved.id);
    expect(String(journal.rows[0]?.fingerprint)).toHaveLength(64);
  });

  it('rolls back mutation and integrity bookkeeping when beforeCommit fails', async () => {
    const approved = await approveDuplicatePlan(pool);
    const failed = await executeRemediationPlan(
      { planId: approved.id, expectedVersion: approved.version },
      {
        pool,
        authority: testHarnessAuthority(),
        afterIntegrityBookkeeping: async () => {
          throw new Error('injected pre-commit failure');
        }
      }
    );

    expect(failed.outcome).toBe('FAILED');
    const plan = await loadRemediationPlan(pool, approved.id);
    expect(plan?.state).not.toBe('RESOLVED');

    const movements = await pool.query(
      `select reversed_at as "reversedAt" from inventory_movements where id = 'MOV-002'`
    );
    expect(movements.rows[0]?.reversedAt).toBeNull();
    const valuation = await pool.query(
      `select quantity_on_hand as qty from inventory_valuation where id = 'val-item-001'`
    );
    expect(Number(valuation.rows[0]?.qty)).toBe(20);

    const key = defaultExecutionKey(approved.id, approved.version);
    const keys = await pool.query(`select state from ledgerguard_execution_keys where key = $1`, [key]);
    expect(keys.rows[0]?.state).not.toBe('completed');
    const journal = await pool.query(
      `select 1 from ledgerguard_execution_journal where idempotency_key = $1`,
      [key]
    );
    expect(journal.rowCount).toBe(0);
  });

  it('rolls back on verification failure without completing the key or journal', async () => {
    const approved = await approveDuplicatePlan(pool);
    const failed = await executeRemediationPlan(
      { planId: approved.id, expectedVersion: approved.version },
      {
        pool,
        authority: testHarnessAuthority(),
        adapter: skipReverseWrites(new PostgresSystemOfRecordAdapter(pool))
      }
    );

    expect(failed.outcome).toBe('FAILED');
    expect(failed.receipt?.committed).not.toBe(true);
    const movements = await pool.query(
      `select reversed_at as "reversedAt" from inventory_movements where id = 'MOV-002'`
    );
    expect(movements.rows[0]?.reversedAt).toBeNull();
    const key = defaultExecutionKey(approved.id, approved.version);
    const keys = await pool.query(`select state from ledgerguard_execution_keys where key = $1`, [key]);
    expect(keys.rows[0]?.state).not.toBe('completed');
    const journal = await pool.query(
      `select 1 from ledgerguard_execution_journal where idempotency_key = $1`,
      [key]
    );
    expect(journal.rowCount).toBe(0);
  });

  it('replays a completed PostgreSQL execution as ALREADY_EXECUTED with zero second mutation', async () => {
    const approved = await approveDuplicatePlan(pool);
    const first = await executeRemediationPlan(
      { planId: approved.id, expectedVersion: approved.version },
      { pool, authority: testHarnessAuthority() }
    );
    expect(first.outcome).toBe('EXECUTED');

    const replay = await executeRemediationPlan(
      { planId: approved.id, expectedVersion: approved.version },
      { pool, authority: testHarnessAuthority() }
    );
    expect(replay.outcome).toBe('ALREADY_EXECUTED');

    const report = investigate(await loadInvestigationInput(pool));
    expect(report.incidentType).toBeNull();
    const valuation = await pool.query(
      `select quantity_on_hand as qty from inventory_valuation where id = 'val-item-001'`
    );
    expect(Number(valuation.rows[0]?.qty)).toBe(10);
    const journal = await pool.query(
      `select count(*)::int as n from ledgerguard_execution_journal
        where idempotency_key = $1`,
      [defaultExecutionKey(approved.id, approved.version)]
    );
    expect(journal.rows[0]?.n).toBe(1);
  });
});
