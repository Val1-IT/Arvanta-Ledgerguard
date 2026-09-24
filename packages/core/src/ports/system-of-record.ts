import type { InvestigationInput, ProposedCorrection, VerificationResult } from '../types';

export interface SystemOfRecordMeta {
  systemId: string;
  systemType: string;
}

export const CorrectionStepStatus = {
  applied: 'APPLIED',
  skippedNoWrite: 'SKIPPED_NO_WRITE',
  failed: 'FAILED'
} as const;

export type CorrectionStepStatusName =
  (typeof CorrectionStepStatus)[keyof typeof CorrectionStepStatus];

export interface CorrectionStepResult {
  sequence: number;
  action: ProposedCorrection['action'];
  table: string;
  recordId: string;
  status: CorrectionStepStatusName;
  detail: string;
}

export interface SystemOfRecordSession {
  loadInvestigationInput(): Promise<InvestigationInput>;
  applyCorrection(correction: ProposedCorrection, now: Date): Promise<CorrectionStepResult>;
}

/**
 * Provider-neutral execution boundary. Adapters perform constrained mutations
 * inside a transaction; core never sees SQL, clients, or table allowlists.
 */
export interface SystemOfRecordAdapter {
  readonly meta: SystemOfRecordMeta;
  runInTransaction<T>(work: (session: SystemOfRecordSession) => Promise<T>): Promise<T>;
}

export type ConstrainedRemediationFailureReason =
  | 'DRIFT_DETECTED'
  | 'MUTATION_REJECTED'
  | 'VERIFICATION_FAILED';

export interface ConstrainedRemediationResult {
  committed: boolean;
  steps: CorrectionStepResult[];
  verification: VerificationResult | null;
  failureReason: ConstrainedRemediationFailureReason | null;
  failureDetail: string | null;
}
