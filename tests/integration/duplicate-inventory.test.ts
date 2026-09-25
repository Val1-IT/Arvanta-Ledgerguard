import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { investigate } from '@ledgerguard/core';
import type { SystemOfRecordAdapter, SystemOfRecordSession } from '@ledgerguard/core';
import { PostgresSystemOfRecordAdapter } from '@ledgerguard/postgres';
import { Capability, PolicyDeniedError, trustedRuntimeAuthority } from '@ledgerguard/policy';
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

describe('duplicate inventory movement against real Postgres', () => {
  let pool: Pool;

  beforeAll(() => {
    pool = makePool();
  });

  afterAll(async () => {
    await pool.end();
  });

  it('detects the duplicate, remediates MOV-002 only, and replays as ALREADY_EXECUTED', async () => {
    await seedDatabase(pool);
    await applyDuplicateInventoryError(pool);

    const report = investigate(await loadInvestigationInput(pool));
    expect(report.incidentType).toBe('DUPLICATE_INVENTORY_MOVEMENT');
    expect(report.proposedCorrections[0]?.recordId).toBe('MOV-002');

    const investigationId = await seedCompletedInvestigation(pool);
    const draft = await createRemediationPlan(
      { investigationId, requestedBy: 'tester' },
      { pool, authority: testHarnessAuthority() }
    );
    const pending = await submitRemediationPlanForApproval(pool, {
      planId: draft.id,
      expectedVersion: draft.version
    });
    const approved = await decideRemediationPlan(
      pool,
      {
        planId: pending.id,
        expectedVersion: pending.version,
        action: 'APPROVE',
        decidedBy: 'controller'
      },
      { authority: testHarnessAuthority() }
    );

    await expect(
      executeRemediationPlan(
        { planId: approved.id, expectedVersion: approved.version },
        {
          pool,
          authority: trustedRuntimeAuthority({
            actorId: 'reader',
            actorType: 'human',
            capabilities: [Capability.investigationRead]
          })
        }
      )
    ).rejects.toThrow(PolicyDeniedError);

    const executed = await executeRemediationPlan(
      { planId: approved.id, expectedVersion: approved.version },
      { pool, authority: testHarnessAuthority() }
    );
    expect(executed.outcome).toBe('EXECUTED');
    expect(executed.plan.state).toBe('RESOLVED');
    expect(executed.plan.verification?.result.overallStatus).toBe('PASS');

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

    const replay = await executeRemediationPlan(
      { planId: approved.id, expectedVersion: approved.version },
      { pool, authority: testHarnessAuthority() }
    );
    expect(replay.outcome).toBe('ALREADY_EXECUTED');
    const valuationAfterReplay = await pool.query(
      `select quantity_on_hand as qty from inventory_valuation where id = 'val-item-001'`
    );
    expect(Number(valuationAfterReplay.rows[0]?.qty)).toBe(10);
  });

  it('rolls back when verification fails after a partial mutation', async () => {
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
    const approved = await decideRemediationPlan(
      pool,
      {
        planId: pending.id,
        expectedVersion: pending.version,
        action: 'APPROVE',
        decidedBy: 'controller'
      },
      { authority: testHarnessAuthority() }
    );

    const adapter = skipReverseWrites(new PostgresSystemOfRecordAdapter(pool));
    const failed = await executeRemediationPlan(
      { planId: approved.id, expectedVersion: approved.version },
      { pool, authority: testHarnessAuthority(), adapter }
    );
    expect(failed.outcome).toBe('FAILED');

    const movements = await pool.query(
      `select reversed_at as "reversedAt" from inventory_movements where id = 'MOV-002'`
    );
    expect(movements.rows[0]?.reversedAt).toBeNull();
    const valuation = await pool.query(
      `select quantity_on_hand as qty from inventory_valuation where id = 'val-item-001'`
    );
    expect(Number(valuation.rows[0]?.qty)).toBe(20);
  });
});
