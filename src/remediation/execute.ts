import type { Pool } from 'pg';
import {
  executeConstrainedRemediation,
  type SystemOfRecordAdapter
} from '@ledgerguard/core';
import {
  defaultExecutionKey,
  PostgresExecutionKeyStore,
  PostgresSystemOfRecordAdapter
} from '@ledgerguard/postgres';
import {
  ApprovalRequiredError,
  ConcurrentExecutionError,
  createMemoryAuditLog,
  evaluateExecutionPolicy,
  PolicyDeniedError,
  assertTrustedExecutor,
  type AuthorityContext,
  type PolicyConfig,
  type SafetyAuditLog,
  DEFAULT_POLICY_CONFIG
} from '@ledgerguard/policy';
import { applyRemediationPlanTransition, loadRemediationPlan } from '../db/repositories/remediation-plans';
import {
  InvalidTransitionError,
  RemediationPlanNotFoundError,
  isTransitionAllowed,
  type ExecutionFailureReason,
  type RemediationExecutionOutcome,
  type RemediationExecutionResult,
  type RemediationPlanRecord
} from './types';

export interface ExecuteRemediationPlanInput {
  planId: string;
  expectedVersion: number;
  idempotencyKey?: string;
}

export interface ExecuteRemediationPlanDeps {
  pool: Pool;
  authority: AuthorityContext;
  now?: () => Date;
  adapter?: SystemOfRecordAdapter;
  policyConfig?: PolicyConfig;
  audit?: SafetyAuditLog;
  executionKeys?: PostgresExecutionKeyStore;
}

function impactFromPlan(plan: RemediationPlanRecord): number {
  return plan.proposedCorrections.reduce((sum, correction) => {
    if (!correction.financialDelta) return sum;
    const amount = Number(correction.financialDelta);
    return Number.isFinite(amount) ? sum + Math.abs(amount) : sum;
  }, 0);
}

export interface ExecuteRemediationPlanResult {
  plan: RemediationPlanRecord;
  outcome: RemediationExecutionOutcome;
}

export async function executeRemediationPlan(
  input: ExecuteRemediationPlanInput,
  deps: ExecuteRemediationPlanDeps
): Promise<ExecuteRemediationPlanResult> {
  const { pool } = deps;
  const now = deps.now ?? (() => new Date());
  const authority = assertTrustedExecutor(deps.authority);
  const adapter = deps.adapter ?? new PostgresSystemOfRecordAdapter(pool);
  const audit = deps.audit ?? createMemoryAuditLog();
  const keys = deps.executionKeys ?? new PostgresExecutionKeyStore(pool);
  const policyConfig = deps.policyConfig ?? DEFAULT_POLICY_CONFIG;

  const plan = await loadRemediationPlan(pool, input.planId);
  if (!plan) throw new RemediationPlanNotFoundError(input.planId);

  const idempotencyKey = input.idempotencyKey ?? defaultExecutionKey(plan.id, input.expectedVersion);
  const existingKey = await keys.get(idempotencyKey);

  if (existingKey?.state === 'completed') {
    audit.append({
      occurredAt: now().toISOString(),
      type: 'idempotency.duplicate',
      actorId: authority.actorId,
      planId: plan.id,
      payload: { idempotencyKey, outcome: 'ALREADY_EXECUTED' }
    });
    return { plan, outcome: 'ALREADY_EXECUTED' };
  }

  const decision = evaluateExecutionPolicy({
    evidenceCount: plan.proposedCorrections.length,
    verificationExpectationCount: plan.verificationExpectations.length,
    impactAmount: impactFromPlan(plan),
    authority,
    plan: {
      state: plan.state,
      version: plan.version,
      approvalAction: plan.approvalAction,
      approvedBy: plan.approvedBy
    },
    expectedVersion: input.expectedVersion,
    config: policyConfig,
    idempotencyCompleted: false
  });

  audit.append({
    occurredAt: now().toISOString(),
    type: 'policy.evaluated',
    actorId: authority.actorId,
    planId: plan.id,
    payload: { decision, idempotencyKey }
  });
  audit.append({
    occurredAt: now().toISOString(),
    type: 'authority.checked',
    actorId: authority.actorId,
    planId: plan.id,
    payload: { actorType: authority.actorType, capabilities: authority.capabilities, source: authority.source }
  });

  if (decision.outcome === 'DENY') {
    throw new PolicyDeniedError('Policy denied execution', decision);
  }
  if (decision.outcome === 'REQUIRE_APPROVAL') {
    throw new ApprovalRequiredError('Human approval is required before execution', decision);
  }

  if (!isTransitionAllowed(plan.state, 'EXECUTING')) {
    throw new InvalidTransitionError(input.planId, plan.state, 'EXECUTING');
  }

  const reservation = await keys.reserve({
    key: idempotencyKey,
    planId: plan.id,
    planVersion: input.expectedVersion,
    now: now()
  });
  if (reservation === 'already_completed') {
    audit.append({
      occurredAt: now().toISOString(),
      type: 'idempotency.duplicate',
      actorId: authority.actorId,
      planId: plan.id,
      payload: { idempotencyKey, outcome: 'ALREADY_EXECUTED' }
    });
    return { plan: (await loadRemediationPlan(pool, plan.id)) ?? plan, outcome: 'ALREADY_EXECUTED' };
  }
  if (reservation === 'in_flight') {
    throw new ConcurrentExecutionError();
  }

  audit.append({
    occurredAt: now().toISOString(),
    type: 'idempotency.reserved',
    actorId: authority.actorId,
    planId: plan.id,
    payload: { idempotencyKey }
  });

  let currentRecord = await applyRemediationPlanTransition(pool, input.planId, input.expectedVersion, {
    state: 'EXECUTING',
    updatedAt: now().toISOString()
  });

  audit.append({
    occurredAt: now().toISOString(),
    type: 'execution.started',
    actorId: authority.actorId,
    planId: plan.id,
    payload: { version: currentRecord.version }
  });

  const startedAt = now().toISOString();
  const result = await executeConstrainedRemediation(adapter, {
    approvedCorrections: plan.proposedCorrections,
    now,
    onWritesApplied: async () => {
      currentRecord = await applyRemediationPlanTransition(pool, input.planId, currentRecord.version, {
        state: 'VERIFYING',
        updatedAt: now().toISOString()
      });
    }
  });

  const finishedAt = now().toISOString();
  const failureReason: ExecutionFailureReason | null =
    result.failureReason === 'DRIFT_DETECTED'
      ? 'DRIFT_DETECTED'
      : result.failureReason === 'MUTATION_REJECTED'
        ? 'SQL_ERROR'
        : null;
  const executionResult: RemediationExecutionResult = {
    startedAt,
    finishedAt,
    steps: result.steps,
    failureReason,
    failureDetail: result.failureDetail,
    outcome: result.committed ? 'EXECUTED' : undefined
  };

  if (result.committed && result.verification) {
    await keys.complete(idempotencyKey, now(), { status: 'EXECUTED', planId: plan.id });
    audit.append({
      occurredAt: finishedAt,
      type: 'execution.committed',
      actorId: authority.actorId,
      planId: plan.id,
      payload: { verification: result.verification.overallStatus }
    });
    const resolved = await applyRemediationPlanTransition(pool, input.planId, currentRecord.version, {
      state: 'RESOLVED',
      updatedAt: finishedAt,
      executionResultJson: JSON.stringify({ ...executionResult, outcome: 'EXECUTED' }),
      executedAt: finishedAt,
      verificationJson: JSON.stringify({ verifiedAt: finishedAt, result: result.verification })
    });
    return { plan: resolved, outcome: 'EXECUTED' };
  }

  await keys.failRetryable(idempotencyKey, now(), { status: 'FAILED_RETRYABLE', failureReason });
  audit.append({
    occurredAt: finishedAt,
    type: 'execution.rolled_back',
    actorId: authority.actorId,
    planId: plan.id,
    payload: { failureReason: result.failureReason }
  });

  const terminalState =
    result.failureReason === 'VERIFICATION_FAILED' || currentRecord.state === 'VERIFYING'
      ? 'VERIFICATION_FAILED'
      : 'EXECUTION_FAILED';

  const failed = await applyRemediationPlanTransition(pool, input.planId, currentRecord.version, {
    state: terminalState,
    updatedAt: finishedAt,
    executionResultJson: JSON.stringify(executionResult),
    executedAt: finishedAt,
    ...(result.verification
      ? { verificationJson: JSON.stringify({ verifiedAt: finishedAt, result: result.verification }) }
      : {})
  });
  return { plan: failed, outcome: 'FAILED' };
}
