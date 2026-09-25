// Public engine API — the only import surface downstream code should use.
// @ledgerguard/core is pure: no Pool, no Drizzle, no HTTP, no DataHub, no LLM, no UI.

export * from './types';
export * from './decimal';
export { detectConversionFactorChanges, selectRootCause, type ConversionFactorChange } from './conversion-impact';
export {
  expectedFactorMap,
  recomputeMovements,
  recomputeValuations,
  compareValuations,
  formatValuationComparison,
  type MovementRecompute,
  type CorrectValuation,
  type ValuationComparison
} from './inventory-impact';
export { CONVERSION_MISMATCH_EXAMPLE } from './example-config';
export { checkJournalBalance, summarizeJournalCogs, type JournalBalanceResult, type JournalCogsSummary } from './journal-impact';
export { compareMarginReports, formatMarginComparison, type MarginComparison } from './margin-impact';
export { buildBlastRadius, type BlastRadiusInput } from './blast-radius';
export { buildRecordImpact, ZERO_RECORD_IMPACT, type RecordImpactInput } from './record-impact';
export { buildFinancialImpact, ZERO_FINANCIAL_IMPACT, type FinancialImpactInputs } from './financial-exposure';
export {
  ConversionFactorPositiveCheck,
  BaseQuantityConsistencyCheck,
  InventoryValuationConsistencyCheck,
  JournalBalanceCheck,
  GrossMarginConsistencyCheck,
  DuplicateReceiptMovementCheck,
  ALL_QUALITY_CHECKS
} from './quality-checks';
export { buildRemediationPreview, type RemediationPreviewInput } from './remediation-preview';
export { verifyState } from './verify';
export { investigate } from './investigate';
export { duplicateInventoryMovementDetector, findDuplicateMovementGroups } from './detectors/duplicate-inventory-movement';
export type { IncidentDetector, DetectorHit } from './detectors/types';
export { DETECTORS } from './detectors/registry';
export { correctionsMatch, correctionKey } from './lifecycle/corrections-match';
export {
  executeConstrainedRemediation,
  DriftDetectedError,
  VerificationFailedError,
  type ExecuteConstrainedRemediationInput
} from './lifecycle/execute-constrained-remediation';
export type {
  SystemOfRecordAdapter,
  SystemOfRecordSession,
  SystemOfRecordMeta,
  CorrectionStepResult,
  ConstrainedRemediationResult,
  ConstrainedRemediationFailureReason
} from './ports/system-of-record';
export { CorrectionStepStatus } from './ports/system-of-record';
