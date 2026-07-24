import type { Pool } from 'pg';
import {
  createRemediationPlan as persistRemediationPlan,
  applyRemediationPlanTransition,
  loadRemediationPlan
} from '../db/repositories/remediation-plans';
import { generateRemediationPlan, type GenerateRemediationPlanDeps, type GenerateRemediationPlanInput } from './generate-plan';
import {
  ApprovalActionSchema,
  InvalidTransitionError,
  RemediationPlanNotFoundError,
  isTransitionAllowed,
  type ApprovalAction,
  type RemediationPlanRecord
} from './types';

// ---------------------------------------------------------------------------
// FASE 6 — plan creation + approval workflow. Every mutating call here is
// guarded twice: once by isTransitionAllowed (business rule — is this state
// change even meaningful) and once by applyRemediationPlanTransition's
// version check (concurrency — is the caller acting on the plan's current
// state, not a stale copy). Both must pass or nothing is written.
// ---------------------------------------------------------------------------

export async function createRemediationPlan(
  input: GenerateRemediationPlanInput,
  deps: GenerateRemediationPlanDeps
): Promise<RemediationPlanRecord> {
  const plan = await generateRemediationPlan(input, deps);
  await persistRemediationPlan(deps.pool, plan);
  return plan;
}

export interface SubmitForApprovalInput {
  planId: string;
  expectedVersion: number;
}

export async function submitRemediationPlanForApproval(
  pool: Pool,
  input: SubmitForApprovalInput,
  now: () => Date = () => new Date()
): Promise<RemediationPlanRecord> {
  const plan = await loadRemediationPlan(pool, input.planId);
  if (!plan) throw new RemediationPlanNotFoundError(input.planId);
  if (!isTransitionAllowed(plan.state, 'PENDING_APPROVAL')) {
    throw new InvalidTransitionError(input.planId, plan.state, 'PENDING_APPROVAL');
  }

  return applyRemediationPlanTransition(pool, input.planId, input.expectedVersion, {
    state: 'PENDING_APPROVAL',
    updatedAt: now().toISOString()
  });
}

export interface DecideRemediationPlanInput {
  planId: string;
  expectedVersion: number;
  action: ApprovalAction;
  decidedBy: string;
  note?: string | null;
}

// APPROVE moves the plan to APPROVED, where the execution engine (execute.ts)
// may pick it up. REJECT and KEEP_REPORTS_FROZEN both land on REJECTED —
// execution never starts either way — but the chosen action is preserved on
// the record (approvalAction) so downstream audit/write-back logic can tell
// "the plan itself was judged wrong" apart from "the incident is
// acknowledged but remediation is deliberately deferred, DataHub's At Risk
// tag must stay in place". Neither REJECT path touches DataHub here; the
// existing FASE 5 "At Risk" tag is simply left as-is.
export async function decideRemediationPlan(
  pool: Pool,
  input: DecideRemediationPlanInput,
  now: () => Date = () => new Date()
): Promise<RemediationPlanRecord> {
  ApprovalActionSchema.parse(input.action);

  const plan = await loadRemediationPlan(pool, input.planId);
  if (!plan) throw new RemediationPlanNotFoundError(input.planId);

  const nextState = input.action === 'APPROVE' ? 'APPROVED' : 'REJECTED';
  if (!isTransitionAllowed(plan.state, nextState)) {
    throw new InvalidTransitionError(input.planId, plan.state, nextState);
  }

  const timestamp = now().toISOString();
  return applyRemediationPlanTransition(pool, input.planId, input.expectedVersion, {
    state: nextState,
    updatedAt: timestamp,
    approvalAction: input.action,
    approvedBy: input.decidedBy,
    approvalNote: input.note ?? null,
    approvedAt: timestamp
  });
}
