import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { makePool } from '../../src/db/client';
import { seedDatabase } from '../../src/db/seed';
import { applyConversionError } from '../../demo-data/scenarios/conversion-error';
import { PRODUCT } from '../../src/domain/constants';
import { SCHEMA_VERSION as AGENT_SCHEMA_VERSION, type InvestigationRunRecord } from '../../src/agent/types';
import { saveInvestigationRun } from '../../src/db/repositories/investigation-runs';
import {
  createRemediationPlan,
  decideRemediationPlan,
  submitRemediationPlanForApproval
} from '../../src/remediation/approve';
import { NoRemediableIncidentError, generateRemediationPlan } from '../../src/remediation/generate-plan';
import { executeRemediationPlan } from '../../src/remediation/execute';
import {
  applyRemediationPlanTransition,
  loadRemediationPlan
} from '../../src/db/repositories/remediation-plans';
import {
  InvalidTransitionError,
  OptimisticConcurrencyError,
  RemediationPlanNotFoundError
} from '../../src/remediation/types';

// ---------------------------------------------------------------------------
// FASE 6 test checklist items 2-13/14 — the full remediation workflow
// (generate -> approve/reject -> execute -> verify) against a real Postgres
// instance (ledgerguard-postgres). Item 1 (pure state-machine matrix) lives in
// tests/unit/remediation/state-machine.test.ts; item 14 (live DataHub
// resolution write-back) lives in tests/datahub/remediation-resolve.test.ts.
//
// seedDatabase() truncates remediation_plans and investigation_runs along
// with every ERP table (see src/db/seed.ts), so calling it at the top of
// every test gives each test a fully isolated, deterministic starting state
// -- no shared fixtures leak between tests in this file.
// ---------------------------------------------------------------------------

async function seedCompletedInvestigation(pool: Pool, overrides: Partial<InvestigationRunRecord> = {}): Promise<string> {
  const investigationId = overrides.investigationId ?? randomUUID();
  const incidentId = overrides.incidentId ?? `incident-${investigationId}`;
  const record: InvestigationRunRecord = {
    investigationId,
    incidentId,
    input: {
      incidentId,
      productId: PRODUCT.id,
      triggerAsset: 'product_units',
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
      rootCauseExplanation: 'fixture root cause explanation',
      businessImpactExplanation: 'fixture business impact explanation',
      datahubContext: { assetsRead: [], owners: [], glossaryTerms: [], tags: [], lineagePath: [] },
      engineResultReference: {
        incidentType: 'UNIT_CONVERSION_MISMATCH',
        overallStatus: 'CRITICAL',
        primaryExposure: '0.00',
        currency: 'IDR',
        affectedRecordCount: 0,
        correctionTargetCount: 0
      },
      remediationRationale: 'fixture remediation rationale',
      recommendedNextStep: 'REQUEST_APPROVAL',
      activityLog: []
    },
    error: null,
    stateHistory: [{ state: 'INVESTIGATION_COMPLETED', at: new Date().toISOString() }],
    createdAt: new Date().toISOString(),
    ...overrides
  };
  await saveInvestigationRun(pool, record);
  return investigationId;
}

async function snapshotErp(pool: Pool) {
  const [unit, valuation, report, journalCount] = await Promise.all([
    pool.query(`select conversion_factor from product_units where id = 'pu-carton'`),
    pool.query(`select quantity_on_hand, average_cost, inventory_value from inventory_valuation where id = 'val-cement-40'`),
    pool.query(`select cost_of_goods_sold, gross_profit, gross_margin_percentage from gross_margin_report where id = 'gmr-2026-01'`),
    pool.query(`select count(*)::int as n from journal_entries`)
  ]);
  return { unit: unit.rows[0], valuation: valuation.rows[0], report: report.rows[0], journalCount: journalCount.rows[0].n };
}

describe('FASE 6 remediation workflow against real Postgres', () => {
  let pool: Pool;

  beforeAll(async () => {
    pool = makePool();
  });

  afterAll(async () => {
    await seedDatabase(pool);
    await pool.end();
  });

  // -- generateRemediationPlan guards ---------------------------------------

  it('throws NoRemediableIncidentError when live data is healthy (no incident to remediate)', async () => {
    await seedDatabase(pool);
    const investigationId = await seedCompletedInvestigation(pool);

    await expect(generateRemediationPlan({ investigationId, requestedBy: 'tester' }, { pool })).rejects.toThrow(
      NoRemediableIncidentError
    );
  });

  it('throws when the referenced investigation does not exist', async () => {
    await seedDatabase(pool);

    await expect(generateRemediationPlan({ investigationId: randomUUID(), requestedBy: 'tester' }, { pool })).rejects.toThrow(
      /Investigation not found/
    );
  });

  it('throws when the referenced investigation has not completed', async () => {
    await seedDatabase(pool);
    await applyConversionError(pool);
    const investigationId = await seedCompletedInvestigation(pool, { finalState: 'ENGINE_ANALYSIS_STARTED', output: null });

    await expect(generateRemediationPlan({ investigationId, requestedBy: 'tester' }, { pool })).rejects.toThrow(
      /did not complete/
    );
  });

  it('generates a DRAFT plan whose proposedCorrections are copied verbatim from a fresh investigate() run', async () => {
    await seedDatabase(pool);
    await applyConversionError(pool);
    const investigationId = await seedCompletedInvestigation(pool);

    const plan = await createRemediationPlan({ investigationId, requestedBy: 'tester' }, { pool });

    expect(plan.state).toBe('DRAFT');
    expect(plan.version).toBe(1);
    expect(plan.triggerAsset).toBe('product_units');
    expect(plan.proposedCorrections[0]).toMatchObject({
      action: 'RESTORE_CONVERSION_FACTOR',
      table: 'product_units',
      recordId: 'pu-carton',
      beforeValue: '10.0000',
      afterValue: '12.0000'
    });

    const persisted = await loadRemediationPlan(pool, plan.id);
    expect(persisted).toEqual(plan);
  });

  // -- approval workflow -----------------------------------------------------

  it('submitRemediationPlanForApproval moves DRAFT->PENDING_APPROVAL, and rejects a second submit', async () => {
    await seedDatabase(pool);
    await applyConversionError(pool);
    const investigationId = await seedCompletedInvestigation(pool);
    const plan = await createRemediationPlan({ investigationId, requestedBy: 'tester' }, { pool });

    const submitted = await submitRemediationPlanForApproval(pool, { planId: plan.id, expectedVersion: plan.version });
    expect(submitted.state).toBe('PENDING_APPROVAL');
    expect(submitted.version).toBe(2);

    await expect(
      submitRemediationPlanForApproval(pool, { planId: plan.id, expectedVersion: submitted.version })
    ).rejects.toThrow(InvalidTransitionError);
  });

  it('decideRemediationPlan APPROVE moves to APPROVED and records the action', async () => {
    await seedDatabase(pool);
    await applyConversionError(pool);
    const investigationId = await seedCompletedInvestigation(pool);
    const plan = await createRemediationPlan({ investigationId, requestedBy: 'tester' }, { pool });
    const pending = await submitRemediationPlanForApproval(pool, { planId: plan.id, expectedVersion: plan.version });

    const approved = await decideRemediationPlan(pool, {
      planId: plan.id,
      expectedVersion: pending.version,
      action: 'APPROVE',
      decidedBy: 'approver-1'
    });

    expect(approved.state).toBe('APPROVED');
    expect(approved.approvalAction).toBe('APPROVE');
    expect(approved.approvedBy).toBe('approver-1');
  });

  it('decideRemediationPlan REJECT and KEEP_REPORTS_FROZEN both land on REJECTED, distinguished by approvalAction, and never touch ERP data', async () => {
    await seedDatabase(pool);
    await applyConversionError(pool);
    const before = await snapshotErp(pool);

    const investigationIdA = await seedCompletedInvestigation(pool);
    const planA = await createRemediationPlan({ investigationId: investigationIdA, requestedBy: 'tester' }, { pool });
    const pendingA = await submitRemediationPlanForApproval(pool, { planId: planA.id, expectedVersion: planA.version });
    const rejectedA = await decideRemediationPlan(pool, {
      planId: planA.id,
      expectedVersion: pendingA.version,
      action: 'REJECT',
      decidedBy: 'approver-1',
      note: 'plan is wrong'
    });
    expect(rejectedA.state).toBe('REJECTED');
    expect(rejectedA.approvalAction).toBe('REJECT');

    const investigationIdB = await seedCompletedInvestigation(pool);
    const planB = await createRemediationPlan({ investigationId: investigationIdB, requestedBy: 'tester' }, { pool });
    const pendingB = await submitRemediationPlanForApproval(pool, { planId: planB.id, expectedVersion: planB.version });
    const rejectedB = await decideRemediationPlan(pool, {
      planId: planB.id,
      expectedVersion: pendingB.version,
      action: 'KEEP_REPORTS_FROZEN',
      decidedBy: 'approver-1'
    });
    expect(rejectedB.state).toBe('REJECTED');
    expect(rejectedB.approvalAction).toBe('KEEP_REPORTS_FROZEN');

    const after = await snapshotErp(pool);
    expect(after).toEqual(before);
  });

  // -- optimistic concurrency --------------------------------------------------

  it('applyRemediationPlanTransition rejects a stale version and an unknown plan id', async () => {
    await seedDatabase(pool);
    await applyConversionError(pool);
    const investigationId = await seedCompletedInvestigation(pool);
    const plan = await createRemediationPlan({ investigationId, requestedBy: 'tester' }, { pool });

    const first = await applyRemediationPlanTransition(pool, plan.id, plan.version, {
      state: 'PENDING_APPROVAL',
      updatedAt: new Date().toISOString()
    });
    expect(first.version).toBe(2);

    await expect(
      applyRemediationPlanTransition(pool, plan.id, plan.version, { state: 'APPROVED', updatedAt: new Date().toISOString() })
    ).rejects.toThrow(OptimisticConcurrencyError);

    await expect(
      applyRemediationPlanTransition(pool, randomUUID(), 1, { state: 'APPROVED', updatedAt: new Date().toISOString() })
    ).rejects.toThrow(RemediationPlanNotFoundError);
  });

  // -- execution ---------------------------------------------------------------

  it('executeRemediationPlan refuses to run a plan that is not APPROVED, and touches no ERP data', async () => {
    await seedDatabase(pool);
    await applyConversionError(pool);
    const before = await snapshotErp(pool);
    const investigationId = await seedCompletedInvestigation(pool);
    const plan = await createRemediationPlan({ investigationId, requestedBy: 'tester' }, { pool });

    await expect(executeRemediationPlan({ planId: plan.id, expectedVersion: plan.version }, { pool })).rejects.toThrow(
      InvalidTransitionError
    );

    const after = await snapshotErp(pool);
    expect(after).toEqual(before);
  });

  it('happy path: DRAFT->PENDING_APPROVAL->APPROVED->RESOLVED actually restores ERP data to the pre-incident baseline and never touches journal_entries', async () => {
    await seedDatabase(pool);
    const baseline = await snapshotErp(pool);
    await applyConversionError(pool);

    const investigationId = await seedCompletedInvestigation(pool);
    const plan = await createRemediationPlan({ investigationId, requestedBy: 'tester' }, { pool });
    const pending = await submitRemediationPlanForApproval(pool, { planId: plan.id, expectedVersion: plan.version });
    const approved = await decideRemediationPlan(pool, {
      planId: plan.id,
      expectedVersion: pending.version,
      action: 'APPROVE',
      decidedBy: 'approver-1'
    });

    const resolved = await executeRemediationPlan({ planId: plan.id, expectedVersion: approved.version }, { pool });

    expect(resolved.state).toBe('RESOLVED');
    expect(resolved.verification?.result.overallStatus).toBe('PASS');
    expect(resolved.executionResult?.failureReason).toBeNull();
    expect(resolved.executionResult?.steps.every((s) => s.status === 'APPLIED')).toBe(true);
    expect(resolved.executionResult?.steps.map((s) => s.sequence)).toEqual(
      [...resolved.executionResult!.steps].map((s) => s.sequence).sort((a, b) => a - b)
    );

    const after = await snapshotErp(pool);
    expect(after).toEqual(baseline);
  });

  it('aborts with EXECUTION_FAILED/DRIFT_DETECTED and rolls back fully when data drifts after approval', async () => {
    await seedDatabase(pool);
    await applyConversionError(pool);

    const investigationId = await seedCompletedInvestigation(pool);
    const plan = await createRemediationPlan({ investigationId, requestedBy: 'tester' }, { pool });
    const pending = await submitRemediationPlanForApproval(pool, { planId: plan.id, expectedVersion: plan.version });
    const approved = await decideRemediationPlan(pool, {
      planId: plan.id,
      expectedVersion: pending.version,
      action: 'APPROVE',
      decidedBy: 'approver-1'
    });

    // Simulate a concurrent change to the same conversion factor after
    // approval but before execution — the plan's approved snapshot no longer
    // matches live data.
    await pool.query(`update product_units set conversion_factor = '8.0000' where id = 'pu-carton'`);
    const drifted = await snapshotErp(pool);

    const failed = await executeRemediationPlan({ planId: plan.id, expectedVersion: approved.version }, { pool });

    expect(failed.state).toBe('EXECUTION_FAILED');
    expect(failed.executionResult?.failureReason).toBe('DRIFT_DETECTED');

    const after = await snapshotErp(pool);
    expect(after).toEqual(drifted);
  });
});
