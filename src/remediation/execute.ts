import type { Pool } from 'pg';
import {
  executeConstrainedRemediation,
  type SystemOfRecordAdapter
} from '@ledgerguard/core';
import { PostgresSystemOfRecordAdapter } from '@ledgerguard/postgres';
import { applyRemediationPlanTransition, loadRemediationPlan } from '../db/repositories/remediation-plans';
import {
  InvalidTransitionError,
  RemediationPlanNotFoundError,
  isTransitionAllowed,
  type ExecutionFailureReason,
  type RemediationExecutionResult,
  type RemediationPlanRecord
} from './types';

export interface ExecuteRemediationPlanInput {
  planId: string;
  expectedVersion: number;
}

export interface ExecuteRemediationPlanDeps {
  pool: Pool;
  now?: () => Date;
  adapter?: SystemOfRecordAdapter;
}

export async function executeRemediationPlan(
  input: ExecuteRemediationPlanInput,
  deps: ExecuteRemediationPlanDeps
): Promise<RemediationPlanRecord> {
  const { pool } = deps;
  const now = deps.now ?? (() => new Date());
  const adapter = deps.adapter ?? new PostgresSystemOfRecordAdapter(pool);

  const plan = await loadRemediationPlan(pool, input.planId);
  if (!plan) throw new RemediationPlanNotFoundError(input.planId);
  if (!isTransitionAllowed(plan.state, 'EXECUTING')) {
    throw new InvalidTransitionError(input.planId, plan.state, 'EXECUTING');
  }

  let currentRecord = await applyRemediationPlanTransition(pool, input.planId, input.expectedVersion, {
    state: 'EXECUTING',
    updatedAt: now().toISOString()
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
    failureDetail: result.failureDetail
  };

  if (result.committed && result.verification) {
    return applyRemediationPlanTransition(pool, input.planId, currentRecord.version, {
      state: 'RESOLVED',
      updatedAt: finishedAt,
      executionResultJson: JSON.stringify(executionResult),
      executedAt: finishedAt,
      verificationJson: JSON.stringify({ verifiedAt: finishedAt, result: result.verification })
    });
  }

  const terminalState =
    result.failureReason === 'VERIFICATION_FAILED' || currentRecord.state === 'VERIFYING'
      ? 'VERIFICATION_FAILED'
      : 'EXECUTION_FAILED';

  return applyRemediationPlanTransition(pool, input.planId, currentRecord.version, {
    state: terminalState,
    updatedAt: finishedAt,
    executionResultJson: JSON.stringify(executionResult),
    executedAt: finishedAt,
    ...(result.verification
      ? { verificationJson: JSON.stringify({ verifiedAt: finishedAt, result: result.verification }) }
      : {})
  });
}
