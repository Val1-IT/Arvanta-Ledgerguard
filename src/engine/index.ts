// Public engine API — the only import surface downstream code (repositories,
// scripts, and eventually the agent layer) should use. Everything under
// src/engine is pure: no Pool, no Drizzle client, no HTTP, no DataHub, no LLM.

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
  ALL_QUALITY_CHECKS
} from './quality-checks';
export { buildRemediationPreview, type RemediationPreviewInput } from './remediation-preview';
export { verifyState } from './verify';
export { investigate } from './investigate';
