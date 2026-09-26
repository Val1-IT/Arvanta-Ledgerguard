import {
  BaseQuantityConsistencyCheck,
  ConversionFactorPositiveCheck,
  DuplicateReceiptMovementCheck,
  GrossMarginConsistencyCheck,
  InventoryValuationConsistencyCheck,
  JournalBalanceCheck,
  ALL_QUALITY_CHECKS
} from './quality-checks';
import type { QualityCheckEvaluator } from './types';

export const InventoryInvariants = {
  conversionFactorPositive: ConversionFactorPositiveCheck,
  baseQuantityConsistency: BaseQuantityConsistencyCheck,
  valuationConsistency: InventoryValuationConsistencyCheck,
  duplicateReceiptMovement: DuplicateReceiptMovementCheck
} as const;

export const FinanceInvariants = {
  journalBalance: JournalBalanceCheck,
  grossMarginConsistency: GrossMarginConsistencyCheck
} as const;

export const DETERMINISTIC_INVARIANTS: QualityCheckEvaluator[] = ALL_QUALITY_CHECKS;
