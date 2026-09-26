import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import {
  adapterCapabilitiesOrDefault,
  buildExecutionReceipt,
  executeConstrainedAction,
  ExecutionStatus,
  type ConstrainedAction,
  type ConstrainedActionAdapter,
  type ExecutionReceipt
} from '@ledgerguard/core';
import { defaultExecutionKey, PostgresExecutionKeyStore } from '@ledgerguard/postgres';
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
  OptimisticConcurrencyError,
  RemediationPlanNotFoundError,
  isRecoveryTransitionAllowed,
  isTransitionAllowed,
  type ExecuteRemediationPlanResult,
  type RemediationPlanRecord,
  type RemediationPlanState
} from './types';

export interface ExecuteRemoteActionInput {
  planId: string;
  expectedVersion: number;
  action: ConstrainedAction;
  expectedFingerprint: string;
  idempotencyKey?: string;
}

export interface ExecuteRemoteActionDeps {
  pool: Pool;
  authority: AuthorityContext;
  adapter: ConstrainedActionAdapter;
  now?: () => Date;
  policyConfig?: PolicyConfig;
  audit?: SafetyAuditLog;
  executionKeys?: PostgresExecutionKeyStore;
}

export async function executeRemoteConstrainedAction(
  input: ExecuteRemoteActionInput,
  deps: ExecuteRemoteActionDeps
): Promise<ExecuteRemediationPlanResult> {
  const now = deps.now ?? (() => new Date());
  const authority = assertTrustedExecutor(deps.authority);
  const audit = deps.audit ?? createMemoryAuditLog();
  const keys = deps.executionKeys ?? new PostgresExecutionKeyStore(deps.pool);
  const policyConfig = deps.policyConfig ?? DEFAULT_POLICY_CONFIG;
  const plan = await loadRemediationPlan(deps.pool, input.planId);
  if (!plan) throw new RemediationPlanNotFoundError(input.planId);

  const idempotencyKey = input.idempotencyKey ?? defaultExecutionKey(plan.id, input.expectedVersion);
  const existingKey = await keys.get(idempotencyKey);

  if (existingKey?.state === 'completed') {
    return reconcileRemoteCompleted({
      pool: deps.pool,
      keys,
      adapter: deps.adapter,
      action: input.action,
      plan,
      idempotencyKey,
      authorityActorId: authority.actorId,
      now: now(),
      audit
    });
  }

  if (existingKey?.state === 'reserved') {
    if (!keys.isLeaseExpired(existingKey, now())) {
      throw new ConcurrentExecutionError();
    }
    return recoverRemoteReserved({
      pool: deps.pool,
      keys,
      adapter: deps.adapter,
      action: input.action,
      plan,
      idempotencyKey,
      authorityActorId: authority.actorId,
      now: now(),
      audit
    });
  }

  if (plan.state === 'INTERRUPTED') {
    if (plan.version !== input.expectedVersion || plan.approvalAction !== 'APPROVE') {
      throw new ApprovalRequiredError('Interrupted remote execution cannot resume without the original approval', {
        planState: plan.state,
        expectedVersion: input.expectedVersion
      });
    }
  } else {
    const decision = evaluateExecutionPolicy({
      evidenceCount: Math.max(plan.proposedCorrections.length, 1),
      verificationExpectationCount: Math.max(plan.verificationExpectations.length, 1),
      impactAmount: 0,
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
    if (decision.outcome === 'DENY') {
      throw new PolicyDeniedError('Policy denied remote execution', decision);
    }
    if (decision.outcome === 'REQUIRE_APPROVAL') {
      throw new ApprovalRequiredError('Human approval is required before remote execution', decision);
    }
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
    return { plan, outcome: 'ALREADY_EXECUTED' };
  }
  if (reservation === 'in_flight') {
    throw new ConcurrentExecutionError();
  }

  let current = await applyRemediationPlanTransition(deps.pool, input.planId, input.expectedVersion, {
    state: 'EXECUTING',
    updatedAt: now().toISOString()
  });

  const executionId = randomUUID();
  const result = await executeConstrainedAction(deps.adapter, input.action, input.expectedFingerprint);

  if (result.outcome === 'STALE') {
    await keys.failRetryable(idempotencyKey, now(), { status: 'STALE', detail: result.detail });
    const failed = await applyRemediationPlanTransition(deps.pool, input.planId, current.version, {
      state: 'EXECUTION_FAILED',
      updatedAt: now().toISOString(),
      executionResultJson: JSON.stringify({ outcome: 'FAILED', failureReason: 'DRIFT_DETECTED', detail: result.detail })
    });
    return { plan: failed, outcome: 'FAILED' };
  }

  if (result.outcome === 'RECOVERY_REQUIRED') {
    audit.append({
      occurredAt: now().toISOString(),
      type: 'execution.recovery_ambiguous',
      actorId: authority.actorId,
      planId: plan.id,
      payload: { detail: result.detail, remoteWriteAttempted: result.remoteWriteAttempted }
    });
    return { plan: current, outcome: 'RECOVERY_REQUIRED' };
  }

  const receipt = buildExecutionReceipt({
    executionId,
    planId: plan.id,
    planVersion: input.expectedVersion,
    idempotencyKey,
    status: result.verified ? ExecutionStatus.committed : ExecutionStatus.verificationFailed,
    sourceStateFingerprint: result.fingerprintBefore ?? input.expectedFingerprint,
    adapter: {
      systemId: deps.adapter.meta.systemId,
      systemType: deps.adapter.meta.systemType,
      ...adapterCapabilitiesOrDefault(deps.adapter.meta.capabilities)
    },
    verificationOverallStatus: result.verified ? 'PASS' : 'FAIL',
    committed: result.verified,
    recovered: false,
    occurredAt: now().toISOString()
  });

  if (result.verified) {
    await keys.complete(idempotencyKey, now(), receipt);
    await keys.appendJournal({
      id: `journal:${executionId}`,
      key: idempotencyKey,
      planId: plan.id,
      planVersion: input.expectedVersion,
      status: receipt.status,
      sourceStateFingerprint: receipt.sourceStateFingerprint,
      receipt,
      now: now()
    });
    current = await applyRemediationPlanTransition(deps.pool, input.planId, current.version, {
      state: 'VERIFYING',
      updatedAt: now().toISOString()
    });
    const resolved = await applyRemediationPlanTransition(deps.pool, input.planId, current.version, {
      state: 'RESOLVED',
      updatedAt: now().toISOString(),
      executedAt: now().toISOString(),
      executionResultJson: JSON.stringify({ outcome: 'EXECUTED', receipt, fingerprintAfter: result.fingerprintAfter }),
      verificationJson: JSON.stringify({ verifiedAt: now().toISOString(), result: { overallStatus: 'PASS' } })
    });
    return { plan: resolved, outcome: 'EXECUTED', receipt };
  }

  await keys.failRetryable(idempotencyKey, now(), receipt);
  const failed = await applyRemediationPlanTransition(deps.pool, input.planId, current.version, {
    state: result.outcome === 'VERIFICATION_FAILED' ? 'VERIFICATION_FAILED' : 'EXECUTION_FAILED',
    updatedAt: now().toISOString(),
    executionResultJson: JSON.stringify({ outcome: 'FAILED', receipt, detail: result.detail })
  });
  return { plan: failed, outcome: 'FAILED', receipt };
}

async function recoverRemoteReserved(input: {
  pool: Pool;
  keys: PostgresExecutionKeyStore;
  adapter: ConstrainedActionAdapter;
  action: ConstrainedAction;
  plan: RemediationPlanRecord;
  idempotencyKey: string;
  authorityActorId: string;
  now: Date;
  audit: SafetyAuditLog;
}): Promise<ExecuteRemediationPlanResult> {
  input.audit.append({
    occurredAt: input.now.toISOString(),
    type: 'execution.recovery_started',
    actorId: input.authorityActorId,
    planId: input.plan.id,
    payload: { idempotencyKey: input.idempotencyKey }
  });
  const classification = await input.adapter.classifyRecovery(input.action);
  if (classification === 'applied') {
    return finishRemoteApplied(input, classification);
  }
  if (classification === 'not_applied') {
    await input.keys.recoverExpiredReservation({
      key: input.idempotencyKey,
      classification: 'not_applied',
      now: input.now
    });
    if (input.plan.state === 'APPROVED') {
      return { plan: input.plan, outcome: 'INTERRUPTED' };
    }
    const interrupted = await recoveryTransition(input.pool, input.plan, 'INTERRUPTED', input.now);
    return { plan: interrupted, outcome: 'INTERRUPTED' };
  }
  input.audit.append({
    occurredAt: input.now.toISOString(),
    type: 'execution.recovery_ambiguous',
    actorId: input.authorityActorId,
    planId: input.plan.id,
    payload: { classification }
  });
  return { plan: input.plan, outcome: 'RECOVERY_REQUIRED' };
}

async function reconcileRemoteCompleted(input: {
  pool: Pool;
  keys: PostgresExecutionKeyStore;
  adapter: ConstrainedActionAdapter;
  action: ConstrainedAction;
  plan: RemediationPlanRecord;
  idempotencyKey: string;
  authorityActorId: string;
  now: Date;
  audit: SafetyAuditLog;
}): Promise<ExecuteRemediationPlanResult> {
  if (input.plan.state === 'RESOLVED') {
    return { plan: input.plan, outcome: 'ALREADY_EXECUTED' };
  }
  const classification = await input.adapter.classifyRecovery(input.action);
  if (classification !== 'applied') {
    return { plan: input.plan, outcome: 'RECOVERY_REQUIRED' };
  }
  return finishRemoteApplied(input, 'applied');
}

async function finishRemoteApplied(
  input: {
    pool: Pool;
    keys: PostgresExecutionKeyStore;
    adapter: ConstrainedActionAdapter;
    action: ConstrainedAction;
    plan: RemediationPlanRecord;
    idempotencyKey: string;
    authorityActorId: string;
    now: Date;
    audit: SafetyAuditLog;
  },
  classification: 'applied'
): Promise<ExecuteRemediationPlanResult> {
  const receipt = buildExecutionReceipt({
    executionId: `recover:${randomUUID()}`,
    planId: input.plan.id,
    planVersion: input.plan.version,
    idempotencyKey: input.idempotencyKey,
    status: ExecutionStatus.alreadyExecuted,
    sourceStateFingerprint: await input.adapter.fingerprint(input.action),
    adapter: {
      systemId: input.adapter.meta.systemId,
      systemType: input.adapter.meta.systemType,
      ...adapterCapabilitiesOrDefault(input.adapter.meta.capabilities)
    },
    verificationOverallStatus: 'PASS',
    committed: true,
    recovered: true,
    recoveryClassification: classification,
    occurredAt: input.now.toISOString()
  });
  await input.keys.recoverExpiredReservation({
    key: input.idempotencyKey,
    classification: 'applied',
    now: input.now,
    receipt
  });
  try {
    await input.keys.appendJournal({
      id: `journal:${receipt.executionId}`,
      key: input.idempotencyKey,
      planId: input.plan.id,
      planVersion: input.plan.version,
      status: receipt.status,
      sourceStateFingerprint: receipt.sourceStateFingerprint,
      receipt,
      now: input.now
    });
  } catch {
    // journal is best-effort after key completion
  }
  if (input.plan.state === 'RESOLVED') {
    return { plan: input.plan, outcome: 'ALREADY_EXECUTED', receipt };
  }
  try {
    const resolved = await recoveryTransition(input.pool, input.plan, 'RESOLVED', input.now, receipt);
    input.audit.append({
      occurredAt: input.now.toISOString(),
      type: 'execution.recovery_applied_verified',
      actorId: input.authorityActorId,
      planId: input.plan.id,
      payload: { receipt }
    });
    return { plan: resolved, outcome: 'ALREADY_EXECUTED', receipt };
  } catch (error) {
    if (error instanceof OptimisticConcurrencyError) {
      const latest = await loadRemediationPlan(input.pool, input.plan.id);
      if (latest?.state === 'RESOLVED') {
        return { plan: latest, outcome: 'ALREADY_EXECUTED', receipt };
      }
    }
    throw error;
  }
}

async function recoveryTransition(
  pool: Pool,
  plan: RemediationPlanRecord,
  to: RemediationPlanState,
  now: Date,
  receipt?: ExecutionReceipt
): Promise<RemediationPlanRecord> {
  if (!isRecoveryTransitionAllowed(plan.state, to)) {
    throw new InvalidTransitionError(plan.id, plan.state, to);
  }
  return applyRemediationPlanTransition(pool, plan.id, plan.version, {
    state: to,
    updatedAt: now.toISOString(),
    ...(to === 'RESOLVED'
      ? {
          executedAt: now.toISOString(),
          executionResultJson: JSON.stringify({ outcome: 'ALREADY_EXECUTED', receipt }),
          verificationJson: JSON.stringify({ verifiedAt: now.toISOString(), result: { overallStatus: 'PASS' } })
        }
      : {})
  });
}
