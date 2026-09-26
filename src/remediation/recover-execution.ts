import { randomUUID } from 'node:crypto';
import {
  adapterCapabilitiesOrDefault,
  buildExecutionReceipt,
  classifyStaleReservation,
  ExecutionStatus,
  sourceStateFingerprint,
  verifyState,
  type StaleReservationClassification,
  type SystemOfRecordAdapter
} from '@ledgerguard/core';
import type { PostgresExecutionKeyStore } from '@ledgerguard/postgres';
import { ConcurrentExecutionError, type SafetyAuditLog } from '@ledgerguard/policy';
import { applyRemediationPlanTransition } from '../db/repositories/remediation-plans';
import {
  InvalidTransitionError,
  OptimisticConcurrencyError,
  isRecoveryTransitionAllowed,
  type ExecuteRemediationPlanResult,
  type RemediationPlanRecord,
  type RemediationPlanState
} from './types';
import { loadRemediationPlan } from '../db/repositories/remediation-plans';
import type { Queryable } from '../db/queryable';

function receiptAdapter(adapter: SystemOfRecordAdapter) {
  return {
    systemId: adapter.meta.systemId,
    systemType: adapter.meta.systemType,
    ...adapterCapabilitiesOrDefault(adapter.meta.capabilities)
  };
}

async function recoveryTransition(
  db: Queryable,
  plan: RemediationPlanRecord,
  to: RemediationPlanState,
  patch: {
    updatedAt: string;
    executionResultJson?: string;
    executedAt?: string;
    verificationJson?: string;
  }
): Promise<RemediationPlanRecord> {
  if (!isRecoveryTransitionAllowed(plan.state, to)) {
    throw new InvalidTransitionError(plan.id, plan.state, to);
  }
  return applyRemediationPlanTransition(db, plan.id, plan.version, {
    state: to,
    ...patch
  });
}

export async function reconcileCompletedExecution(input: {
  db: Queryable;
  keys: PostgresExecutionKeyStore;
  adapter: SystemOfRecordAdapter;
  plan: RemediationPlanRecord;
  idempotencyKey: string;
  authorityActorId: string;
  now: Date;
  audit: SafetyAuditLog;
}): Promise<ExecuteRemediationPlanResult> {
  const { plan, audit, now } = input;
  audit.append({
    occurredAt: now.toISOString(),
    type: 'idempotency.duplicate',
    actorId: input.authorityActorId,
    planId: plan.id,
    payload: { idempotencyKey: input.idempotencyKey, outcome: 'ALREADY_EXECUTED' }
  });

  if (plan.state === 'RESOLVED' || plan.state === 'REJECTED' || plan.state === 'EXECUTION_FAILED' || plan.state === 'VERIFICATION_FAILED') {
    return { plan, outcome: 'ALREADY_EXECUTED' };
  }

  if (plan.state !== 'EXECUTING' && plan.state !== 'VERIFYING' && plan.state !== 'APPROVED') {
    return { plan, outcome: 'ALREADY_EXECUTED' };
  }

  let snapshot;
  try {
    snapshot = await input.adapter.runInTransaction((session) => session.loadInvestigationInput());
  } catch {
    return { plan, outcome: 'RECOVERY_REQUIRED' };
  }

  const classification = classifyStaleReservation({
    snapshot,
    approvedCorrections: plan.proposedCorrections,
    verificationExpectations: plan.verificationExpectations
  });
  if (classification !== 'applied') {
    return { plan, outcome: 'RECOVERY_REQUIRED' };
  }

  const verification = verifyState(snapshot);
  const existing = await input.keys.get(input.idempotencyKey);
  const receipt = buildExecutionReceipt({
    executionId: `recover:${randomUUID()}`,
    planId: plan.id,
    planVersion: plan.version,
    idempotencyKey: input.idempotencyKey,
    status: ExecutionStatus.alreadyExecuted,
    sourceStateFingerprint: sourceStateFingerprint(plan.proposedCorrections),
    adapter: receiptAdapter(input.adapter),
    verificationOverallStatus: verification.overallStatus,
    committed: true,
    recovered: true,
    recoveryClassification: 'applied',
    occurredAt: now.toISOString()
  });

  try {
    await input.keys.appendJournal({
      id: `journal:${receipt.executionId}`,
      key: input.idempotencyKey,
      planId: plan.id,
      planVersion: plan.version,
      status: receipt.status,
      sourceStateFingerprint: receipt.sourceStateFingerprint,
      receipt,
      now
    });
  } catch {
    // journal is best-effort when reconciling a key that is already completed
  }

  const resolved = await recoveryTransition(input.db, plan, 'RESOLVED', {
    updatedAt: now.toISOString(),
    executedAt: now.toISOString(),
    executionResultJson: JSON.stringify({
      startedAt: now.toISOString(),
      finishedAt: now.toISOString(),
      steps: [],
      failureReason: null,
      failureDetail: null,
      outcome: 'ALREADY_EXECUTED',
      receipt
    }),
    verificationJson: JSON.stringify({ verifiedAt: now.toISOString(), result: verification })
  });
  audit.append({
    occurredAt: now.toISOString(),
    type: 'execution.reconciled',
    actorId: input.authorityActorId,
    planId: plan.id,
    payload: { idempotencyKey: input.idempotencyKey, priorKeyState: existing?.state, receipt }
  });
  return { plan: resolved, outcome: 'ALREADY_EXECUTED', receipt };
}

export async function recoverExpiredReservation(input: {
  db: Queryable;
  keys: PostgresExecutionKeyStore;
  adapter: SystemOfRecordAdapter;
  plan: RemediationPlanRecord;
  idempotencyKey: string;
  authorityActorId: string;
  now: Date;
  audit: SafetyAuditLog;
}): Promise<ExecuteRemediationPlanResult> {
  const existing = await input.keys.get(input.idempotencyKey);
  if (!existing || existing.state !== 'reserved') {
    if (existing?.state === 'completed') {
      return reconcileCompletedExecution(input);
    }
    throw new ConcurrentExecutionError();
  }
  if (!input.keys.isLeaseExpired(existing, input.now)) {
    throw new ConcurrentExecutionError();
  }

  input.audit.append({
    occurredAt: input.now.toISOString(),
    type: 'execution.recovery_started',
    actorId: input.authorityActorId,
    planId: input.plan.id,
    payload: { idempotencyKey: input.idempotencyKey, planState: input.plan.state }
  });

  let snapshot;
  try {
    snapshot = await input.adapter.runInTransaction((session) => session.loadInvestigationInput());
  } catch {
    input.audit.append({
      occurredAt: input.now.toISOString(),
      type: 'execution.recovery_ambiguous',
      actorId: input.authorityActorId,
      planId: input.plan.id,
      payload: { reason: 'snapshot_unavailable' }
    });
    return { plan: input.plan, outcome: 'RECOVERY_REQUIRED' };
  }

  const classification = classifyStaleReservation({
    snapshot,
    approvedCorrections: input.plan.proposedCorrections,
    verificationExpectations: input.plan.verificationExpectations
  });

  if (classification === 'applied') {
    return finishAppliedRecovery({ ...input, snapshot, classification });
  }
  if (classification === 'not_applied') {
    return finishNotAppliedRecovery(input);
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

async function finishAppliedRecovery(input: {
  db: Queryable;
  keys: PostgresExecutionKeyStore;
  adapter: SystemOfRecordAdapter;
  plan: RemediationPlanRecord;
  idempotencyKey: string;
  authorityActorId: string;
  now: Date;
  audit: SafetyAuditLog;
  snapshot: import('@ledgerguard/core').InvestigationInput;
  classification: StaleReservationClassification;
}): Promise<ExecuteRemediationPlanResult> {
  const verification = verifyState(input.snapshot);
  const receipt = buildExecutionReceipt({
    executionId: `recover:${randomUUID()}`,
    planId: input.plan.id,
    planVersion: input.plan.version,
    idempotencyKey: input.idempotencyKey,
    status: ExecutionStatus.alreadyExecuted,
    sourceStateFingerprint: sourceStateFingerprint(input.plan.proposedCorrections),
    adapter: receiptAdapter(input.adapter),
    verificationOverallStatus: verification.overallStatus,
    committed: true,
    recovered: true,
    recoveryClassification: 'applied',
    occurredAt: input.now.toISOString()
  });

  const recovered = await input.keys.recoverExpiredReservation({
    key: input.idempotencyKey,
    classification: 'applied',
    now: input.now,
    receipt
  });
  if (recovered === 'in_flight') {
    throw new ConcurrentExecutionError();
  }
  if (recovered === 'recovery_required') {
    return { plan: input.plan, outcome: 'RECOVERY_REQUIRED', receipt };
  }
  if (recovered !== 'completed') {
    const current = await input.keys.get(input.idempotencyKey);
    if (current?.state !== 'completed') {
      return { plan: input.plan, outcome: 'RECOVERY_REQUIRED', receipt };
    }
  }

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
    // journal persistence should not undo a completed key; plan reconcile still proceeds
  }

  try {
    const resolved = await recoveryTransition(input.db, input.plan, 'RESOLVED', {
      updatedAt: input.now.toISOString(),
      executedAt: input.now.toISOString(),
      executionResultJson: JSON.stringify({
        startedAt: input.now.toISOString(),
        finishedAt: input.now.toISOString(),
        steps: [],
        failureReason: null,
        failureDetail: null,
        outcome: 'ALREADY_EXECUTED',
        receipt
      }),
      verificationJson: JSON.stringify({ verifiedAt: input.now.toISOString(), result: verification })
    });
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
      const latest = await loadRemediationPlan(input.db, input.plan.id);
      if (latest?.state === 'RESOLVED') {
        return { plan: latest, outcome: 'ALREADY_EXECUTED', receipt };
      }
    }
    throw error;
  }
}

async function finishNotAppliedRecovery(input: {
  db: Queryable;
  keys: PostgresExecutionKeyStore;
  adapter: SystemOfRecordAdapter;
  plan: RemediationPlanRecord;
  idempotencyKey: string;
  authorityActorId: string;
  now: Date;
  audit: SafetyAuditLog;
}): Promise<ExecuteRemediationPlanResult> {
  const receipt = buildExecutionReceipt({
    executionId: `recover:${randomUUID()}`,
    planId: input.plan.id,
    planVersion: input.plan.version,
    idempotencyKey: input.idempotencyKey,
    status: ExecutionStatus.rolledBack,
    sourceStateFingerprint: sourceStateFingerprint(input.plan.proposedCorrections),
    adapter: receiptAdapter(input.adapter),
    verificationOverallStatus: null,
    committed: false,
    recovered: true,
    recoveryClassification: 'not_applied',
    occurredAt: input.now.toISOString()
  });

  await input.keys.recoverExpiredReservation({
    key: input.idempotencyKey,
    classification: 'not_applied',
    now: input.now,
    receipt
  });

  if (input.plan.state === 'APPROVED') {
    input.audit.append({
      occurredAt: input.now.toISOString(),
      type: 'execution.recovery_not_applied',
      actorId: input.authorityActorId,
      planId: input.plan.id,
      payload: { planState: input.plan.state, receipt }
    });
    return { plan: input.plan, outcome: 'INTERRUPTED', receipt };
  }

  const interrupted = await recoveryTransition(input.db, input.plan, 'INTERRUPTED', {
    updatedAt: input.now.toISOString(),
    executionResultJson: JSON.stringify({
      startedAt: input.now.toISOString(),
      finishedAt: input.now.toISOString(),
      steps: [],
      failureReason: null,
      failureDetail: 'Stale reservation expired before mutation committed',
      outcome: 'INTERRUPTED',
      receipt
    })
  });
  input.audit.append({
    occurredAt: input.now.toISOString(),
    type: 'execution.recovery_not_applied',
    actorId: input.authorityActorId,
    planId: input.plan.id,
    payload: { planState: interrupted.state, receipt }
  });
  return { plan: interrupted, outcome: 'INTERRUPTED', receipt };
}
