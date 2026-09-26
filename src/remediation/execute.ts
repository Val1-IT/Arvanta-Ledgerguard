import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import {
  adapterCapabilitiesOrDefault,
  buildExecutionReceipt,
  classifyStaleReservation,
  executeConstrainedRemediation,
  ExecutionStatus,
  sourceStateFingerprint,
  type ExecutionReceipt,
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
  receipt?: ExecutionReceipt;
}

export async function executeRemediationPlan(
  input: ExecuteRemediationPlanInput,
  deps: ExecuteRemediationPlanDeps
): Promise<ExecuteRemediationPlanResult> {
  const { pool } = deps;
  const now = deps.now ?? (() => new Date());
  const authority = assertTrustedExecutor(deps.authority);
  const readAdapter = deps.adapter ?? new PostgresSystemOfRecordAdapter(pool);
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

  let reservation = await keys.reserve({
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
    const recovered = await recoverStaleReservation({
      keys,
      adapter: readAdapter,
      plan,
      idempotencyKey,
      now: now()
    });
    if (recovered === 'completed') {
      return { plan: (await loadRemediationPlan(pool, plan.id)) ?? plan, outcome: 'ALREADY_EXECUTED' };
    }
    if (recovered === 'recovery_required') {
      return { plan, outcome: 'RECOVERY_REQUIRED' };
    }
    if (recovered === 'failed_retryable') {
      reservation = await keys.reserve({
        key: idempotencyKey,
        planId: plan.id,
        planVersion: input.expectedVersion,
        now: now()
      });
    }
    if (reservation === 'in_flight') {
      throw new ConcurrentExecutionError();
    }
    if (reservation === 'already_completed') {
      return { plan: (await loadRemediationPlan(pool, plan.id)) ?? plan, outcome: 'ALREADY_EXECUTED' };
    }
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
  const executionId = randomUUID();
  const fingerprint = sourceStateFingerprint(plan.proposedCorrections);
  const capabilities = adapterCapabilitiesOrDefault(readAdapter.meta.capabilities);
  let completedInTransaction = false;
  let inTransactionReceipt: ExecutionReceipt | undefined;

  const mutationAdapter =
    deps.adapter ??
    new PostgresSystemOfRecordAdapter(pool, {
      beforeCommit: async (client, verified) => {
        const verification = (verified as { verification?: { overallStatus?: 'PASS' | 'FAIL' } }).verification;
        const receipt = buildExecutionReceipt({
          executionId,
          planId: plan.id,
          planVersion: input.expectedVersion,
          idempotencyKey,
          status: ExecutionStatus.committed,
          sourceStateFingerprint: fingerprint,
          adapter: {
            systemId: readAdapter.meta.systemId,
            systemType: readAdapter.meta.systemType,
            ...capabilities,
            nativeTransactions: true,
            idempotencyInNativeTransaction: true
          },
          verificationOverallStatus: verification?.overallStatus ?? 'PASS',
          committed: true,
          occurredAt: now().toISOString()
        });
        const txKeys = new PostgresExecutionKeyStore(client);
        await txKeys.complete(idempotencyKey, now(), receipt);
        await txKeys.appendJournal({
          id: `journal:${executionId}`,
          key: idempotencyKey,
          planId: plan.id,
          planVersion: input.expectedVersion,
          status: receipt.status,
          sourceStateFingerprint: fingerprint,
          receipt,
          now: now()
        });
        completedInTransaction = true;
        inTransactionReceipt = receipt;
      }
    });

  const result = await executeConstrainedRemediation(mutationAdapter, {
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
    const receipt =
      inTransactionReceipt ??
      buildExecutionReceipt({
        executionId,
        planId: plan.id,
        planVersion: input.expectedVersion,
        idempotencyKey,
        status: ExecutionStatus.committed,
        sourceStateFingerprint: result.sourceStateFingerprint,
        adapter: {
          systemId: mutationAdapter.meta.systemId,
          systemType: mutationAdapter.meta.systemType,
          ...adapterCapabilitiesOrDefault(mutationAdapter.meta.capabilities)
        },
        verificationOverallStatus: result.verification.overallStatus,
        committed: true,
        occurredAt: finishedAt
      });
    if (!completedInTransaction) {
      await keys.complete(idempotencyKey, now(), receipt);
    }
    audit.append({
      occurredAt: finishedAt,
      type: 'execution.committed',
      actorId: authority.actorId,
      planId: plan.id,
      payload: { verification: result.verification.overallStatus, receipt }
    });
    const resolved = await applyRemediationPlanTransition(pool, input.planId, currentRecord.version, {
      state: 'RESOLVED',
      updatedAt: finishedAt,
      executionResultJson: JSON.stringify({ ...executionResult, outcome: 'EXECUTED', receipt }),
      executedAt: finishedAt,
      verificationJson: JSON.stringify({ verifiedAt: finishedAt, result: result.verification })
    });
    return { plan: resolved, outcome: 'EXECUTED', receipt };
  }

  const failedReceipt = buildExecutionReceipt({
    executionId,
    planId: plan.id,
    planVersion: input.expectedVersion,
    idempotencyKey,
    status:
      result.failureReason === 'DRIFT_DETECTED'
        ? ExecutionStatus.stale
        : result.failureReason === 'VERIFICATION_FAILED'
          ? ExecutionStatus.verificationFailed
          : ExecutionStatus.rolledBack,
    sourceStateFingerprint: result.sourceStateFingerprint,
    adapter: {
      systemId: mutationAdapter.meta.systemId,
      systemType: mutationAdapter.meta.systemType,
      ...adapterCapabilitiesOrDefault(mutationAdapter.meta.capabilities)
    },
    verificationOverallStatus: result.verification?.overallStatus ?? null,
    committed: false,
    occurredAt: finishedAt
  });

  await keys.failRetryable(idempotencyKey, now(), failedReceipt);
  audit.append({
    occurredAt: finishedAt,
    type: 'execution.rolled_back',
    actorId: authority.actorId,
    planId: plan.id,
    payload: { failureReason: result.failureReason, receipt: failedReceipt }
  });

  const terminalState =
    result.failureReason === 'VERIFICATION_FAILED' || currentRecord.state === 'VERIFYING'
      ? 'VERIFICATION_FAILED'
      : 'EXECUTION_FAILED';

  const failed = await applyRemediationPlanTransition(pool, input.planId, currentRecord.version, {
    state: terminalState,
    updatedAt: finishedAt,
    executionResultJson: JSON.stringify({ ...executionResult, receipt: failedReceipt }),
    executedAt: finishedAt,
    ...(result.verification
      ? { verificationJson: JSON.stringify({ verifiedAt: finishedAt, result: result.verification }) }
      : {})
  });
  return { plan: failed, outcome: 'FAILED', receipt: failedReceipt };
}

async function recoverStaleReservation(input: {
  keys: PostgresExecutionKeyStore;
  adapter: SystemOfRecordAdapter;
  plan: RemediationPlanRecord;
  idempotencyKey: string;
  now: Date;
}): Promise<'completed' | 'failed_retryable' | 'recovery_required' | 'in_flight'> {
  const existing = await input.keys.get(input.idempotencyKey);
  if (!existing || !input.keys.isLeaseExpired(existing, input.now)) {
    return 'in_flight';
  }

  let snapshot;
  try {
    snapshot = await input.adapter.runInTransaction((session) => session.loadInvestigationInput());
  } catch {
    return 'recovery_required';
  }

  const classification = classifyStaleReservation({
    snapshot,
    approvedCorrections: input.plan.proposedCorrections
  });
  return input.keys.recoverExpiredReservation({
    key: input.idempotencyKey,
    classification,
    now: input.now,
    receipt: { status: 'STALE_RESERVED_RECOVERY', classification }
  });
}
