import type { Pool } from 'pg';
import { DataHubBridgeError, isDataHubConfigured } from '@ledgerguard/datahub';
import { createDataHubStatusPublisher, type InvestigationStatusPublisher } from '../agent/catalog';
import { getRuntimePolicy } from '../runtime/runtime-policy';
import { applyRemediationPlanTransition, loadRemediationPlan } from '../db/repositories/remediation-plans';
import { RemediationPlanNotFoundError, type RemediationPlanRecord, type RemediationWritebackResult } from './types';

// ---------------------------------------------------------------------------
// FASE 6 — DataHub resolution write-back. Only ever called after a plan's ERP
// data transaction has already committed and post-write verification PASSed
// (state RESOLVED — see src/remediation/execute.ts, the only place a plan
// reaches that state). This module never runs against APPROVED/EXECUTING or
// any failure state, and it never touches the ERP database itself: the data
// is already correct and committed regardless of what happens here.
//
// The write-back's own outcome (SYNCED or FAILED) is recorded on the plan for
// audit purposes, but it never changes the plan's `state` — RESOLVED already
// means the incident is fixed and verified; a DataHub metadata-sync hiccup on
// top of that is a separate, best-effort concern. Because `state` never
// changes here, this is the one legitimate case of a "same-state patch":
// RESOLVED -> RESOLVED is intentionally absent from ALLOWED_TRANSITIONS (see
// src/remediation/types.ts), so this function calls
// applyRemediationPlanTransition directly with the plan's current state
// rather than routing through isTransitionAllowed, which would incorrectly
// reject it.
// ---------------------------------------------------------------------------

function buildResolutionSummary(plan: RemediationPlanRecord, timestamp: string): string {
  const stepCount = plan.executionResult?.steps.length ?? plan.proposedCorrections.length;
  return [
    'LedgerGuard remediation resolution note',
    `Incident ${plan.incidentId} has been remediated and verified.`,
    `Remediation plan ID: ${plan.id}.`,
    `Corrections applied: ${stepCount} step(s).`,
    `Executed at: ${plan.executedAt ?? 'unknown'}.`,
    `Verified at: ${plan.verification?.verifiedAt ?? 'unknown'} — all integrity checks passed.`,
    `Approved by: ${plan.approvedBy ?? 'unknown'}.`,
    `Generated at: ${timestamp}.`,
    'Status: resolved — the At Risk flag has been cleared.'
  ].join('\n');
}

export interface WritebackRemediationResolutionInput {
  planId: string;
}

export interface WritebackRemediationResolutionDeps {
  pool: Pool;
  now?: () => Date;
  publisher?: InvestigationStatusPublisher | null;
}

/**
 * Removes the `At Risk` DataHub tag from the plan's triggerAsset and adds
 * `Trusted` on top (verification PASSing, the only way a plan reaches
 * RESOLVED, already establishes that every integrity check currently
 * passes — there is no weaker "resolved but not fully trusted" case to
 * distinguish). Never callable on a plan that has not reached RESOLVED with
 * a PASSing verification recorded.
 */
export async function writebackRemediationResolution(
  input: WritebackRemediationResolutionInput,
  deps: WritebackRemediationResolutionDeps
): Promise<RemediationPlanRecord> {
  const { pool } = deps;
  const now = deps.now ?? (() => new Date());

  const plan = await loadRemediationPlan(pool, input.planId);
  if (!plan) throw new RemediationPlanNotFoundError(input.planId);
  if (plan.state !== 'RESOLVED' || !plan.verification || plan.verification.result.overallStatus !== 'PASS') {
    throw new Error(
      `DataHub resolution write-back is only valid for a RESOLVED plan with a PASSing verification (planId=${input.planId}, state=${plan.state})`
    );
  }

  const attemptedAt = now().toISOString();
  const summaryText = buildResolutionSummary(plan, attemptedAt);
  const publisher = deps.publisher === undefined ? createDataHubStatusPublisher() : deps.publisher;

  let writebackResult: RemediationWritebackResult;
  if (!publisher || !isDataHubConfigured()) {
    writebackResult = {
      attemptedAt,
      outcome: 'NOT_CONFIGURED',
      atRiskTagRemoved: false,
      trustedTagAdded: false,
      message: 'DataHub is not configured; system-of-record verification is unchanged.'
    };
  } else {
    try {
      const resolution = await publisher.publishResolution(plan.triggerAsset, true, summaryText);
      if (getRuntimePolicy().judgeMode && resolution.writePath !== 'mcp') {
        throw new DataHubBridgeError(
          'WRITEBACK_FAILED',
          'Live DataHub MCP resolution write-back is required in judge mode; SDK fallback is not accepted.',
          resolution.activityLog
        );
      }
      writebackResult = {
        attemptedAt,
        outcome: 'SYNCED',
        atRiskTagRemoved: resolution.atRiskTagRemoved,
        trustedTagAdded: resolution.trustedTagAdded,
        message: null
      };
    } catch (error) {
      writebackResult = {
        attemptedAt,
        outcome: 'FAILED',
        atRiskTagRemoved: false,
        trustedTagAdded: false,
        message: error instanceof Error ? error.message : String(error)
      };
    }
  }

  return applyRemediationPlanTransition(pool, input.planId, plan.version, {
    state: plan.state,
    updatedAt: now().toISOString(),
    datahubWritebackJson: JSON.stringify(writebackResult)
  });
}
