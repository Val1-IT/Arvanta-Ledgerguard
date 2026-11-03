import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import {
  adapterCapabilitiesOrDefault,
  buildExecutionReceipt,
  executeConstrainedAction,
  ExecutionStatus,
  type AdapterCapabilities,
  type ConstrainedAction,
  type ConstrainedActionAdapter,
  type ConstrainedActionExecutionResult,
  type ExecutionReceipt
} from '@ledgerguard/core';
import { assertExecutionKeyOwnership, defaultExecutionKey, PostgresExecutionKeyStore } from '@ledgerguard/postgres';
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
import { assertRemoteActionBinding } from './remote-action-binding';
import { supportsExecutionFencing, type ExecutionFence, type FencedRemoteAdapter } from './execution-fence';
import {
  InvalidTransitionError,
  OptimisticConcurrencyError,
  RemediationPlanNotFoundError,
  isRecoveryTransitionAllowed,
  isTransitionAllowed,
  type ExecuteRemediationPlanResult,
  type RemediationExecutionResult,
  type RemediationPlanRecord,
  type RemediationPlanState,
  type RemediationVerification
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
  // Snapshot scalars before awaiting I/O and use the same JSON representation as
  // the persisted approval binding. Caller-only Map/Date/etc. semantics must not
  // reach the adapter after a comparison that approved only their JSON form.
  input = { ...input, action: JSON.parse(JSON.stringify(input.action)) as ConstrainedAction };
  const action = input.action;
  const now = deps.now ?? (() => new Date());
  const authority = assertTrustedExecutor(deps.authority);
  const audit = deps.audit ?? createMemoryAuditLog();
  const keys = deps.executionKeys ?? new PostgresExecutionKeyStore(deps.pool);
  const policyConfig = deps.policyConfig ?? DEFAULT_POLICY_CONFIG;
  const plan = await loadRemediationPlan(deps.pool, input.planId);
  if (!plan) throw new RemediationPlanNotFoundError(input.planId);
  assertRemoteActionBinding(plan, deps.adapter, action, input.expectedFingerprint);

  const idempotencyKey = input.idempotencyKey ?? defaultExecutionKey(plan.id, input.expectedVersion);
  const existingKey = await keys.get(idempotencyKey);
  if (existingKey) {
    assertExecutionKeyOwnership(existingKey, { planId: plan.id, planVersion: input.expectedVersion });
  }

  if (existingKey?.state === 'completed') {
    return reconcileRemoteCompleted({
      pool: deps.pool,
      keys,
      adapter: deps.adapter,
      action,
      plan,
      executionPlanVersion: existingKey.planVersion,
      idempotencyKey,
      authorityActorId: authority.actorId,
      now: now(),
      audit,
      fenceGeneration: existingKey.fenceGeneration
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
      action,
      plan,
      executionPlanVersion: existingKey.planVersion,
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

  if (supportsExecutionFencing(deps.adapter)) {
    // Reject a key the remote fence cannot carry before reserving anything.
    deps.adapter.withExecutionFence({ executionKey: idempotencyKey, generation: 1 });
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

  // Fenced adapters carry (key, lease generation) on every remote call so the
  // remote system can reject this call if our lease is taken over meanwhile.
  let fence: ExecutionFence | undefined;
  let executionAdapter: ConstrainedActionAdapter = deps.adapter;
  if (supportsExecutionFencing(deps.adapter)) {
    const reserved = await keys.get(idempotencyKey);
    if (!reserved || reserved.state !== 'reserved') throw new ConcurrentExecutionError();
    fence = { executionKey: idempotencyKey, generation: Number(reserved.fenceGeneration ?? 1) };
    executionAdapter = deps.adapter.withExecutionFence(fence);
  }

  let current = await applyRemediationPlanTransition(deps.pool, input.planId, input.expectedVersion, {
    state: 'EXECUTING',
    updatedAt: now().toISOString()
  });

  const executionId = randomUUID();
  const startedAt = current.updatedAt;
  let result: ConstrainedActionExecutionResult;
  try {
    result = await executeConstrainedAction(executionAdapter, action, input.expectedFingerprint);
  } catch {
    // A rejected transport promise does not establish whether its remote transaction
    // committed. Keep the reservation and never automatically replay the mutation.
    audit.append({
      occurredAt: now().toISOString(),
      type: 'execution.recovery_ambiguous',
      actorId: authority.actorId,
      planId: plan.id,
      payload: { detail: 'Remote execution or verification failed; remote state must be recovered' }
    });
    return { plan: current, outcome: 'RECOVERY_REQUIRED' };
  }

  if (result.outcome === 'STALE') {
    const released = await keys.failRetryable(idempotencyKey, now(), { status: 'STALE', detail: result.detail }, fence?.generation);
    if (fence && !released) {
      // Our lease was taken over (and, for a fenced remote, our call was
      // rejected). The new generation owns the key and the plan; change nothing.
      throw new ConcurrentExecutionError();
    }
    const failed = await applyRemediationPlanTransition(deps.pool, input.planId, current.version, {
      state: 'EXECUTION_FAILED',
      updatedAt: now().toISOString(),
      executionResultJson: JSON.stringify(executionRecord({
        outcome: 'FAILED', startedAt, finishedAt: now().toISOString(),
        failureReason: 'DRIFT_DETECTED', failureDetail: result.detail
      }))
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
    status: result.verified ? ExecutionStatus.committed :
      result.outcome === 'VERIFICATION_FAILED' ? ExecutionStatus.verificationFailed : ExecutionStatus.denied,
    sourceStateFingerprint: result.fingerprintBefore ?? input.expectedFingerprint,
    adapter: {
      systemId: deps.adapter.meta.systemId,
      systemType: deps.adapter.meta.systemType,
      ...adapterCapabilitiesOrDefault(deps.adapter.meta.capabilities as AdapterCapabilities | undefined)
    },
    verificationOverallStatus: result.verified ? 'PASS' : 'FAIL',
    committed: result.verified,
    recovered: false,
    occurredAt: now().toISOString()
  });

  if (result.verified) {
    const completed = await keys.complete(idempotencyKey, now(), receipt, fence?.generation);
    if (fence && !completed) {
      // Applied before the fence was raised; the recovering generation observes
      // the receipt via raiseExecutionFence and settles the key and plan.
      throw new ConcurrentExecutionError();
    }
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
      executionResultJson: JSON.stringify({
        ...executionRecord({ outcome: 'EXECUTED', startedAt, finishedAt: now().toISOString() }),
        receipt, fingerprintAfter: result.fingerprintAfter
      }),
      verificationJson: JSON.stringify(verificationRecord(action, true, result.detail, now()))
    });
    return { plan: resolved, outcome: 'EXECUTED', receipt };
  }

  if (result.remoteWriteAttempted) {
    // The remote write may already be committed. Preserve a recoverable state
    // rather than a terminal SQL-style rollback failure.
    current = await applyRemediationPlanTransition(deps.pool, input.planId, current.version, {
      state: 'VERIFYING', updatedAt: now().toISOString(),
      executionResultJson: JSON.stringify({
        ...executionRecord({ outcome: 'RECOVERY_REQUIRED', startedAt, finishedAt: now().toISOString(), failureDetail: result.detail }),
        receipt
      }),
      verificationJson: JSON.stringify(verificationRecord(action, false, result.detail, now()))
    });
    return { plan: current, outcome: 'RECOVERY_REQUIRED', receipt };
  }

  // Only a known no-write rejection is retryable. Failed verification is not a
  // rollback on a remote system, so do not release its execution reservation.
  if (!result.remoteWriteAttempted) {
    const released = await keys.failRetryable(idempotencyKey, now(), receipt, fence?.generation);
    if (fence && !released) throw new ConcurrentExecutionError();
  }
  const failed = await applyRemediationPlanTransition(deps.pool, input.planId, current.version, {
    state: 'EXECUTION_FAILED',
    updatedAt: now().toISOString(),
    executionResultJson: JSON.stringify({
      ...executionRecord({ outcome: 'FAILED', startedAt, finishedAt: now().toISOString(), failureDetail: result.detail }),
      receipt
    })
  });
  return { plan: failed, outcome: 'FAILED', receipt };
}

async function recoverRemoteReserved(input: {
  pool: Pool;
  keys: PostgresExecutionKeyStore;
  adapter: ConstrainedActionAdapter;
  action: ConstrainedAction;
  plan: RemediationPlanRecord;
  executionPlanVersion: number;
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
  if (supportsExecutionFencing(input.adapter)) {
    return recoverFencedReserved(input, input.adapter);
  }
  const classification = await input.adapter.classifyRecovery(input.action);
  if (classification === 'applied') {
    return finishRemoteApplied(input, classification);
  }
  // A remote pre-state observation is not a fence: an expired worker or its
  // request can still commit later. Without termination/fencing evidence, never
  // release the reservation or authorize another mutation from this snapshot.
  input.audit.append({
    occurredAt: input.now.toISOString(),
    type: 'execution.recovery_ambiguous',
    actorId: input.authorityActorId,
    planId: input.plan.id,
    payload: { classification }
  });
  return { plan: input.plan, outcome: 'RECOVERY_REQUIRED' };
}

/**
 * Lease takeover for a fenced remote: advance the key's generation, raise the
 * remote fence to it (which waits for any in-flight call holding the remote
 * lock), then trust the remote answer. After the raise, the expired worker's
 * call - even one already on the wire - is rejected by the remote system.
 */
async function recoverFencedReserved(
  input: Parameters<typeof recoverRemoteReserved>[0],
  adapter: FencedRemoteAdapter
): Promise<ExecuteRemediationPlanResult> {
  const takeover = await input.keys.takeOverExpiredLease({ key: input.idempotencyKey, now: input.now });
  if (takeover.outcome !== 'taken_over') throw new ConcurrentExecutionError();
  const fence: ExecutionFence = { executionKey: input.idempotencyKey, generation: takeover.fenceGeneration };
  let classification: Awaited<ReturnType<typeof adapter.raiseExecutionFence>>;
  try {
    classification = await adapter.raiseExecutionFence(input.action, fence);
  } catch {
    classification = 'ambiguous';
  }
  if (classification === 'applied') {
    return finishRemoteApplied({ ...input, fenceGeneration: fence.generation }, 'applied');
  }
  if (classification !== 'not_applied') {
    // The fence may or may not be raised; keep the key reserved.
    input.audit.append({
      occurredAt: input.now.toISOString(),
      type: 'execution.recovery_ambiguous',
      actorId: input.authorityActorId,
      planId: input.plan.id,
      payload: { classification, fenceGeneration: fence.generation }
    });
    return { plan: input.plan, outcome: 'RECOVERY_REQUIRED' };
  }
  // The remote system confirmed that no earlier generation wrote, and none can
  // write from now on. Releasing the key is safe; a retry re-reserves it at a
  // higher generation.
  const released = await input.keys.recoverExpiredReservation({
    key: input.idempotencyKey,
    classification: 'not_applied',
    now: input.now,
    fenceGeneration: fence.generation,
    receipt: { status: 'FENCED_NOT_APPLIED', fenceGeneration: fence.generation }
  });
  if (released === 'in_flight') throw new ConcurrentExecutionError();
  if (released !== 'failed_retryable') return { plan: input.plan, outcome: 'RECOVERY_REQUIRED' };
  if (!isRecoveryTransitionAllowed(input.plan.state, 'INTERRUPTED')) {
    return { plan: input.plan, outcome: 'INTERRUPTED' };
  }
  const interrupted = await recoveryTransition(input.pool, input.plan, 'INTERRUPTED', input.now);
  return { plan: interrupted, outcome: 'INTERRUPTED' };
}

async function reconcileRemoteCompleted(input: {
  pool: Pool;
  keys: PostgresExecutionKeyStore;
  adapter: ConstrainedActionAdapter;
  action: ConstrainedAction;
  plan: RemediationPlanRecord;
  executionPlanVersion: number;
  idempotencyKey: string;
  authorityActorId: string;
  now: Date;
  audit: SafetyAuditLog;
  fenceGeneration?: number;
}): Promise<ExecuteRemediationPlanResult> {
  if (input.plan.state === 'RESOLVED') {
    return { plan: input.plan, outcome: 'ALREADY_EXECUTED' };
  }
  // A fenced remote binds receipts to the execution key, so ask with it.
  const observer = supportsExecutionFencing(input.adapter)
    ? input.adapter.withExecutionFence({ executionKey: input.idempotencyKey, generation: Number(input.fenceGeneration ?? 1) })
    : input.adapter;
  const classification = await observer.classifyRecovery(input.action);
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
    executionPlanVersion: number;
    idempotencyKey: string;
    authorityActorId: string;
    now: Date;
    audit: SafetyAuditLog;
    fenceGeneration?: number;
  },
  classification: 'applied'
): Promise<ExecuteRemediationPlanResult> {
  const receipt = buildExecutionReceipt({
    executionId: `recover:${randomUUID()}`,
    planId: input.plan.id,
    planVersion: input.executionPlanVersion,
    idempotencyKey: input.idempotencyKey,
    status: ExecutionStatus.alreadyExecuted,
    sourceStateFingerprint: input.plan.remoteActionBinding!.expectedFingerprint,
    adapter: {
      systemId: input.adapter.meta.systemId,
      systemType: input.adapter.meta.systemType,
      ...adapterCapabilitiesOrDefault(input.adapter.meta.capabilities as AdapterCapabilities | undefined)
    },
    verificationOverallStatus: 'PASS',
    committed: true,
    recovered: true,
    recoveryClassification: classification,
    occurredAt: input.now.toISOString()
  });
  const recovery = await input.keys.recoverExpiredReservation({
    key: input.idempotencyKey,
    classification: 'applied',
    now: input.now,
    receipt,
    fenceGeneration: input.fenceGeneration
  });
  if (recovery === 'in_flight') throw new ConcurrentExecutionError();
  if (recovery !== 'completed') return { plan: input.plan, outcome: 'RECOVERY_REQUIRED' };
  try {
    await input.keys.appendJournal({
      id: `journal:${receipt.executionId}`,
      key: input.idempotencyKey,
      planId: input.plan.id,
      planVersion: input.executionPlanVersion,
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
    const resolved = await recoveryTransition(input.pool, input.plan, 'RESOLVED', input.now, receipt, input.action);
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
  receipt?: ExecutionReceipt,
  action?: ConstrainedAction
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
          executionResultJson: JSON.stringify({
            ...executionRecord({ outcome: 'ALREADY_EXECUTED', startedAt: plan.updatedAt, finishedAt: now.toISOString() }),
            receipt
          }),
          verificationJson: JSON.stringify(verificationRecord(action!, true, 'Remote postcondition verified during recovery', now))
        }
      : {})
  });
}

function executionRecord(input: {
  outcome: 'EXECUTED' | 'ALREADY_EXECUTED' | 'FAILED' | 'RECOVERY_REQUIRED';
  startedAt: string;
  finishedAt: string;
  failureReason?: RemediationExecutionResult['failureReason'];
  failureDetail?: string;
}): RemediationExecutionResult {
  return {
    outcome: input.outcome,
    startedAt: input.startedAt,
    finishedAt: input.finishedAt,
    // Remote actions do not execute the SQL correction steps stored on legacy plans.
    steps: [],
    failureReason: input.failureReason ?? null,
    failureDetail: input.failureDetail ?? null
  };
}

function verificationRecord(action: ConstrainedAction, pass: boolean, detail: string, now: Date): RemediationVerification {
  return {
    verifiedAt: now.toISOString(),
    result: {
      overallStatus: pass ? 'PASS' : 'FAIL',
      checks: [{
        checkId: 'REMOTE_ACTION_POSTCONDITION',
        status: pass ? 'PASS' : 'FAIL',
        severity: pass ? 'info' : 'critical',
        expected: 'Approved remote action postcondition',
        actual: detail,
        affectedRecordIds: [action.target.resourceId],
        evidence: [],
        remediationHint: pass ? 'No further action required' : 'Inspect remote state before authorizing another mutation'
      }]
    }
  };
}
