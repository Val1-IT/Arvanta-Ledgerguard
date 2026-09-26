import { z } from 'zod';
import {
  ProposedCorrectionSchema,
  VerificationExpectationSchema,
  VerificationResultSchema,
  type ExecutionReceipt
} from '@ledgerguard/core';

// ---------------------------------------------------------------------------
// FASE 6 — approval + verified remediation workflow. Types only: no I/O, no
// SQL, no DataHub calls here.
//
// A remediation plan is never authored by hand or by an LLM: its
// `proposedCorrections`/`verificationExpectations` are always a snapshot
// copied verbatim from a real IncidentInvestigationReport
// (src/engine/investigate.ts + src/engine/remediation-preview.ts). This file
// only defines the workflow wrapped around that snapshot — who approved it,
// what happened when it executed, and what was verified afterward.
// ---------------------------------------------------------------------------

export const SCHEMA_VERSION = '1.0' as const;

// ---------------------------------------------------------------------------
// State machine. Every mutating transition is guarded by ALLOWED_TRANSITIONS
// below and by an optimistic-concurrency version check at the persistence
// layer — never inferred implicitly from which fields happen to be set.
// ---------------------------------------------------------------------------

export const RemediationPlanStateSchema = z.enum([
  'DRAFT',
  'PENDING_APPROVAL',
  'APPROVED',
  'REJECTED',
  'EXECUTING',
  'EXECUTION_FAILED',
  'VERIFYING',
  'VERIFICATION_FAILED',
  'INTERRUPTED',
  'RESOLVED'
]);
export type RemediationPlanState = z.infer<typeof RemediationPlanStateSchema>;

export const TERMINAL_STATES: ReadonlySet<RemediationPlanState> = new Set([
  'REJECTED',
  'EXECUTION_FAILED',
  'VERIFICATION_FAILED',
  'RESOLVED'
]);

// Explicit allowed-transition map. Anything not listed here is forbidden,
// including every transition out of a terminal state.
export const ALLOWED_TRANSITIONS: Readonly<Record<RemediationPlanState, readonly RemediationPlanState[]>> = {
  DRAFT: ['PENDING_APPROVAL'],
  PENDING_APPROVAL: ['APPROVED', 'REJECTED'],
  APPROVED: ['EXECUTING'],
  REJECTED: [],
  EXECUTING: ['EXECUTION_FAILED', 'VERIFYING'],
  EXECUTION_FAILED: [],
  VERIFYING: ['VERIFICATION_FAILED', 'RESOLVED'],
  VERIFICATION_FAILED: [],
  INTERRUPTED: ['EXECUTING'],
  RESOLVED: []
};

export function isTransitionAllowed(from: RemediationPlanState, to: RemediationPlanState): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

export const RECOVERY_ONLY_TRANSITIONS: Readonly<
  Partial<Record<RemediationPlanState, readonly RemediationPlanState[]>>
> = {
  APPROVED: ['RESOLVED'],
  EXECUTING: ['RESOLVED', 'INTERRUPTED'],
  VERIFYING: ['RESOLVED', 'INTERRUPTED']
};

export function isRecoveryTransitionAllowed(from: RemediationPlanState, to: RemediationPlanState): boolean {
  return RECOVERY_ONLY_TRANSITIONS[from]?.includes(to) === true;
}

// ---------------------------------------------------------------------------
// Approval. REJECT and KEEP_REPORTS_FROZEN both terminate the plan at
// REJECTED — the distinction is preserved so downstream audit/write-back
// logic can tell "the plan itself was judged wrong" apart from "the incident
// is acknowledged but remediation is deliberately deferred, reports must
// stay flagged untrusted in DataHub". In both cases execution never starts.
// ---------------------------------------------------------------------------

export const ApprovalActionSchema = z.enum(['APPROVE', 'REJECT', 'KEEP_REPORTS_FROZEN']);
export type ApprovalAction = z.infer<typeof ApprovalActionSchema>;

// ---------------------------------------------------------------------------
// Execution. One ExecutionStepResult per ProposedCorrection, same sequence
// order. RECONCILE_JOURNAL_ENTRIES never issues a write (see
// src/engine/remediation-preview.ts's rollbackAssumption for that action) —
// its step status is APPLIED regardless, and it is included here only so the
// execution record shows every proposed step was accounted for in order.
// ---------------------------------------------------------------------------

export const ExecutionStepStatusSchema = z.enum(['APPLIED', 'SKIPPED_NO_WRITE', 'FAILED']);
export type ExecutionStepStatus = z.infer<typeof ExecutionStepStatusSchema>;

export const ExecutionStepResultSchema = z.object({
  sequence: z.number().int().positive(),
  action: ProposedCorrectionSchema.shape.action,
  table: z.string(),
  recordId: z.string(),
  status: ExecutionStepStatusSchema,
  detail: z.string()
});
export type ExecutionStepResult = z.infer<typeof ExecutionStepResultSchema>;

// DRIFT: the fresh investigate() re-run immediately before execution no
// longer matches the approved snapshot (e.g. someone else changed the data
// out from under the plan between approval and execution). SQL_ERROR: a step
// failed at the database. Either reason aborts before any commit.
export const ExecutionFailureReasonSchema = z.enum(['DRIFT_DETECTED', 'SQL_ERROR']);
export type ExecutionFailureReason = z.infer<typeof ExecutionFailureReasonSchema>;

export const RemediationExecutionOutcomeSchema = z.enum([
  'EXECUTED',
  'ALREADY_EXECUTED',
  'FAILED',
  'RECOVERY_REQUIRED',
  'INTERRUPTED'
]);
export type RemediationExecutionOutcome = z.infer<typeof RemediationExecutionOutcomeSchema>;

export const RemediationExecutionResultSchema = z.object({
  startedAt: z.string(),
  finishedAt: z.string(),
  steps: z.array(ExecutionStepResultSchema),
  failureReason: ExecutionFailureReasonSchema.nullable(),
  failureDetail: z.string().nullable(),
  outcome: RemediationExecutionOutcomeSchema.optional()
});
export type RemediationExecutionResult = z.infer<typeof RemediationExecutionResultSchema>;

// ---------------------------------------------------------------------------
// Post-execution verification. This is the same VerificationResult shape
// produced by src/engine/verify.ts, re-run against the transaction's own
// in-progress writes before COMMIT — a FAIL here rolls the whole data
// transaction back, so VERIFICATION_FAILED always means "nothing was
// persisted", never "persisted but wrong".
// ---------------------------------------------------------------------------

export const RemediationVerificationSchema = z.object({
  verifiedAt: z.string(),
  result: VerificationResultSchema
});
export type RemediationVerification = z.infer<typeof RemediationVerificationSchema>;

// ---------------------------------------------------------------------------
// DataHub resolution write-back. Only attempted after the data transaction
// has already committed and verification PASSed (state RESOLVED). This is a
// best-effort sync to a separate system: its outcome is recorded on the plan
// but never changes the plan's own state, since the ERP data is already
// correct and committed regardless of whether DataHub metadata sync
// succeeds.
// ---------------------------------------------------------------------------

export const DataHubWritebackOutcomeSchema = z.enum(['SYNCED', 'FAILED', 'NOT_CONFIGURED']);
export type DataHubWritebackOutcome = z.infer<typeof DataHubWritebackOutcomeSchema>;

export const RemediationWritebackResultSchema = z.object({
  attemptedAt: z.string(),
  outcome: DataHubWritebackOutcomeSchema,
  atRiskTagRemoved: z.boolean(),
  trustedTagAdded: z.boolean(),
  message: z.string().nullable()
});
export type RemediationWritebackResult = z.infer<typeof RemediationWritebackResultSchema>;

// ---------------------------------------------------------------------------
// The full plan record. investigationId links to investigation_runs.id,
// where the reconciled engineResultReference/DataHub context from FASE 5
// live; incidentId/productId/triggerAsset/requestedBy are denormalized from
// that same investigation for convenient querying, mirroring
// investigation_runs' own denormalization pattern.
// ---------------------------------------------------------------------------

export const RemediationPlanRecordSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  id: z.string(),
  investigationId: z.string(),
  incidentId: z.string(),
  productId: z.string(),
  triggerAsset: z.string(),
  requestedBy: z.string(),

  state: RemediationPlanStateSchema,
  version: z.number().int().positive(),

  // Snapshot taken at plan-creation time, never re-derived implicitly later —
  // execution re-runs investigate() fresh and compares against exactly this.
  proposedCorrections: z.array(ProposedCorrectionSchema),
  verificationExpectations: z.array(VerificationExpectationSchema),

  approvalAction: ApprovalActionSchema.nullable(),
  approvedBy: z.string().nullable(),
  approvalNote: z.string().nullable(),
  approvedAt: z.string().nullable(),

  executionResult: RemediationExecutionResultSchema.nullable(),
  executedAt: z.string().nullable(),

  verification: RemediationVerificationSchema.nullable(),

  datahubWriteback: RemediationWritebackResultSchema.nullable(),

  createdAt: z.string(),
  updatedAt: z.string()
});
export type RemediationPlanRecord = z.infer<typeof RemediationPlanRecordSchema>;

export interface ExecuteRemediationPlanResult {
  plan: RemediationPlanRecord;
  outcome: RemediationExecutionOutcome;
  receipt?: ExecutionReceipt;
}

// ---------------------------------------------------------------------------
// Errors thrown by the workflow modules (approval/execution). Kept here so
// callers can `instanceof`-check without importing across module boundaries.
// ---------------------------------------------------------------------------

export class RemediationPlanNotFoundError extends Error {
  constructor(public readonly planId: string) {
    super(`Remediation plan not found: ${planId}`);
    this.name = 'RemediationPlanNotFoundError';
  }
}

export class OptimisticConcurrencyError extends Error {
  constructor(
    public readonly planId: string,
    public readonly expectedVersion: number
  ) {
    super(`Remediation plan ${planId} was modified concurrently (expected version ${expectedVersion})`);
    this.name = 'OptimisticConcurrencyError';
  }
}

export class InvalidTransitionError extends Error {
  constructor(
    public readonly planId: string,
    public readonly from: RemediationPlanState,
    public readonly to: RemediationPlanState
  ) {
    super(`Remediation plan ${planId} cannot transition from ${from} to ${to}`);
    this.name = 'InvalidTransitionError';
  }
}
