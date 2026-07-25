import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { SCHEMA_VERSION as AGENT_SCHEMA_VERSION, type InvestigationRunRecord } from '../../../src/agent/types';
import { applyConversionError } from '../../../demo-data/scenarios/conversion-error';
import { makePool } from '../../../src/db/client';
import { seedDatabase } from '../../../src/db/seed';
import { saveInvestigationRun } from '../../../src/db/repositories/investigation-runs';
import {
  applyRemediationPlanTransition,
  loadRemediationPlan
} from '../../../src/db/repositories/remediation-plans';
import {
  createRemediationPlan,
  decideRemediationPlan,
  submitRemediationPlanForApproval
} from '../../../src/remediation/approve';
import { PRODUCT } from '../../../src/domain/constants';
import { listRemediationPlansForInvestigation } from '../../../src/ui/server/queries';

loadEnv({ path: resolve(process.cwd(), '.env') });

export function e2ePool(): Pool {
  return makePool();
}

export async function resetDemoBaseline(pool: Pool): Promise<void> {
  await seedDatabase(pool);
}

export async function seedCompletedConversionInvestigation(pool: Pool): Promise<string> {
  await applyConversionError(pool);
  const investigationId = randomUUID();
  const incidentId = `incident-e2e-${investigationId.slice(0, 8)}`;
  const now = new Date().toISOString();
  const record: InvestigationRunRecord = {
    investigationId,
    incidentId,
    input: {
      incidentId,
      productId: PRODUCT.id,
      triggerAsset: 'inventory_valuation',
      requestedBy: 'e2e-harness',
      mode: 'TEST'
    },
    finalState: 'INVESTIGATION_COMPLETED',
    output: {
      schemaVersion: AGENT_SCHEMA_VERSION,
      investigationId,
      incidentId,
      status: 'COMPLETED',
      evidenceSufficiency: { sufficient: true, confidence: 0.95, missingEvidence: [] },
      rootCauseExplanation: 'E2E fixture root cause for conversion mismatch.',
      businessImpactExplanation: 'E2E fixture business impact.',
      datahubContext: {
        assetsRead: [
          'urn:li:dataset:(urn:li:dataPlatform:postgres,ledgerguard.public.inventory_valuation,PROD)'
        ],
        owners: ['urn:li:corpGroup:finance-controller'],
        glossaryTerms: ['urn:li:glossaryTerm:InventoryValuation'],
        tags: ['urn:li:tag:Finance'],
        lineagePath: [
          'urn:li:dataset:(urn:li:dataPlatform:postgres,ledgerguard.public.inventory_valuation,PROD)',
          'urn:li:dataset:(urn:li:dataPlatform:postgres,ledgerguard.public.gross_margin_report,PROD)'
        ]
      },
      engineResultReference: {
        incidentType: 'UNIT_CONVERSION_MISMATCH',
        overallStatus: 'CRITICAL',
        primaryExposure: '28800000.00',
        currency: 'IDR',
        affectedRecordCount: 63,
        correctionTargetCount: 3
      },
      remediationRationale: 'E2E fixture remediation rationale.',
      recommendedNextStep: 'REQUEST_APPROVAL',
      activityLog: []
    },
    error: null,
    stateHistory: [{ state: 'INVESTIGATION_COMPLETED', at: now }],
    createdAt: now
  };
  await saveInvestigationRun(pool, record);
  return investigationId;
}

export async function loadLatestPlan(pool: Pool, investigationId: string) {
  const plans = await listRemediationPlansForInvestigation(pool, investigationId, 1);
  return plans[0] ?? null;
}

export async function approvePlanFromServer(pool: Pool, planId: string, expectedVersion: number) {
  return decideRemediationPlan(pool, {
    planId,
    expectedVersion,
    action: 'APPROVE',
    decidedBy: 'e2e-harness',
    note: 'server-side approve for concurrency fixture'
  });
}

export async function createPendingPlan(pool: Pool, investigationId: string) {
  const draft = await createRemediationPlan(
    { investigationId, requestedBy: 'e2e-harness' },
    { pool }
  );
  return submitRemediationPlanForApproval(pool, {
    planId: draft.id,
    expectedVersion: draft.version
  });
}

export async function seedVerificationFailedPlan(pool: Pool, investigationId: string) {
  const pending = await createPendingPlan(pool, investigationId);
  const approved = await decideRemediationPlan(pool, {
    planId: pending.id,
    expectedVersion: pending.version,
    action: 'APPROVE',
    decidedBy: 'e2e-harness',
    note: null
  });
  const now = new Date().toISOString();
  return applyRemediationPlanTransition(pool, approved.id, approved.version, {
    state: 'VERIFICATION_FAILED',
    updatedAt: now,
    executedAt: now,
    executionResultJson: JSON.stringify({
      startedAt: now,
      finishedAt: now,
      steps: [],
      failureReason: null,
      failureDetail: 'E2E verification failure fixture'
    }),
    verificationJson: JSON.stringify({
      verifiedAt: now,
      result: {
        overallStatus: 'FAIL',
        checks: [
          {
            checkId: 'conversion_factor_matches_baseline',
            status: 'FAIL',
            severity: 'critical',
            expected: '12.0000',
            actual: '10.0000',
            affectedRecordIds: ['pu-carton'],
            evidence: [],
            remediationHint: 'Restore conversion factor'
          }
        ]
      }
    })
  });
}

export async function markWritebackFailed(pool: Pool, planId: string) {
  const plan = await loadRemediationPlan(pool, planId);
  if (!plan) throw new Error(`plan not found: ${planId}`);
  const now = new Date().toISOString();
  return applyRemediationPlanTransition(pool, planId, plan.version, {
    state: plan.state,
    updatedAt: now,
    datahubWritebackJson: JSON.stringify({
      attemptedAt: now,
      outcome: 'FAILED',
      atRiskTagRemoved: false,
      trustedTagAdded: false,
      message: 'E2E forced DataHub write-back failure'
    })
  });
}
