import { Decimal, formatMoney, formatPercentage } from './decimal';
import type { FinancialImpact } from './types';

// ---------------------------------------------------------------------------
// Financial exposure formula (documented per FASE 4 requirement):
//
//   totalExposure = abs(inventoryValueDelta) + abs(cogsDelta)
//
// What this counts: the balance-sheet misstatement (inventory value) plus
// the income-statement misstatement (COGS) — two distinct ledger positions
// that are each wrong by their own amount.
//
// What this deliberately excludes: grossProfitDelta. Gross profit is
// revenue minus COGS; when revenue is untouched (as in this scenario),
// grossProfitDelta is mathematically the same misstatement as cogsDelta
// with the opposite sign. Adding it into totalExposure would double-count
// the same underlying error. grossProfitDelta is still reported in
// FinancialImpact as a business-readable figure — it is exposure
// *representation*, not additional exposure.
//
// grossMarginPercentageDelta is likewise business context, not part of the
// monetary exposure sum (it is a ratio, not a currency amount).
//
// Limitation: this formula assumes a single incident touching a single
// product/period. It does not attempt to net exposures across multiple,
// possibly-offsetting incidents — see docs/architecture/financial-integrity-engine.md.
// ---------------------------------------------------------------------------

export function buildFinancialImpact(
  inventoryValueDelta: Decimal,
  cogsDelta: Decimal,
  grossProfitDelta: Decimal,
  grossMarginPercentageDelta: Decimal
): FinancialImpact {
  const totalExposure = inventoryValueDelta.abs().plus(cogsDelta.abs());

  return {
    inventoryValueDelta: formatMoney(inventoryValueDelta),
    cogsDelta: formatMoney(cogsDelta),
    grossProfitDelta: formatMoney(grossProfitDelta),
    grossMarginPercentageDelta: formatPercentage(grossMarginPercentageDelta),
    totalExposure: formatMoney(totalExposure),
    currency: 'IDR'
  };
}

export const ZERO_FINANCIAL_IMPACT: FinancialImpact = {
  inventoryValueDelta: formatMoney(new Decimal(0)),
  cogsDelta: formatMoney(new Decimal(0)),
  grossProfitDelta: formatMoney(new Decimal(0)),
  grossMarginPercentageDelta: formatPercentage(new Decimal(0)),
  totalExposure: formatMoney(new Decimal(0)),
  currency: 'IDR'
};
