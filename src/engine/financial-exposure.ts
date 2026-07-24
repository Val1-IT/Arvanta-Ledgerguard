import { Decimal, formatMoney, formatPercentage, formatQuantity } from './decimal';
import type { FinancialImpact } from './types';

// ---------------------------------------------------------------------------
// Financial exposure formula (reworked per FASE 4.1 hardening).
//
// FASE 4 originally summed abs(inventoryValueDelta) + abs(cogsDelta) into a
// single `totalExposure`, on the theory that inventory value (balance sheet)
// and COGS (income statement) are two distinct ledger positions. That is
// true, but the FASE 4 report did not PROVE it — it just asserted it. FASE
// 4.1 makes the proof explicit and structural instead of assumed:
//
//   quantityOnHand = totalBaseIn - totalBaseOut
//
// This is not a coincidence of this scenario, it is how inventory accounting
// works: a base unit that was ever received is, at any point in time, either
// still on hand or already sold — never both, never neither. So the
// "on-hand" population (onHandAffectedUnits, driving inventoryValueDelta)
// and the "sold" population (soldAffectedUnits, driving cogsDelta) are
// disjoint subsets of totalBaseIn by construction. Because they are
// disjoint, summing their monetary exposure does not double-count any unit,
// and the reconciliation invariant below re-derives the identity numerically
// on every run so a future scenario that breaks the assumption is caught
// automatically instead of silently mis-stating exposure.
//
// grossProfitDelta is still deliberately EXCLUDED from primaryExposure: with
// revenue untouched (see margin-impact.ts), grossProfitDelta = -cogsDelta by
// construction, so it is a restatement of the same misstatement already
// counted via realizedCogsExposureComponent, not a third independent one.
//
// If a future scenario's reconciliation check ever fails (the two
// populations turn out NOT to be provably disjoint), this function falls
// back to `MAX_STATEMENT_LINE`: the largest single statement-line exposure,
// per FASE 4.1's requirement 1 fallback option, rather than silently
// resuming an unproven sum.
//
// `grossStatementFootprint` is the sum of every absolute statement-line
// delta (inventory + COGS + gross profit). It is deliberately NOT named or
// used as the primary exposure — it is a supplementary, human-readable
// "how many statement lines moved and by how much in total" figure that
// intentionally allows the same misstatement to appear more than once.
// ---------------------------------------------------------------------------

const RECONCILIATION_TOLERANCE = '0.001';

export interface FinancialImpactInputs {
  inventoryValueDelta: Decimal;
  cogsDelta: Decimal;
  grossProfitDelta: Decimal;
  grossMarginPercentageDelta: Decimal;
  /** Correct (recomputed) base units currently on hand, across every product touched by this incident. */
  onHandAffectedUnits: Decimal;
  /** Correct (recomputed) base units already sold, across every product touched by this incident. */
  soldAffectedUnits: Decimal;
  /** Correct (recomputed) total base units ever received, across every product touched by this incident. */
  totalBaseInAffected: Decimal;
}

export function buildFinancialImpact(inputs: FinancialImpactInputs): FinancialImpact {
  const { inventoryValueDelta, cogsDelta, grossProfitDelta, grossMarginPercentageDelta } = inputs;
  const { onHandAffectedUnits, soldAffectedUnits, totalBaseInAffected } = inputs;

  const inventoryExposureComponent = inventoryValueDelta.abs();
  const realizedCogsExposureComponent = cogsDelta.abs();

  const reconciledTotal = onHandAffectedUnits.plus(soldAffectedUnits);
  const populationsProvenDisjoint = reconciledTotal.minus(totalBaseInAffected).abs().lessThanOrEqualTo(RECONCILIATION_TOLERANCE);

  const reconciliationInvariant = populationsProvenDisjoint
    ? `onHandAffectedUnits (${formatQuantity(onHandAffectedUnits)}) + soldAffectedUnits (${formatQuantity(soldAffectedUnits)}) = totalBaseIn (${formatQuantity(totalBaseInAffected)}); quantityOnHand = totalBaseIn - totalBaseOut is a structural accounting identity, so a base unit is either on hand or sold, never both — the two exposure components are proven disjoint`
    : `onHandAffectedUnits (${formatQuantity(onHandAffectedUnits)}) + soldAffectedUnits (${formatQuantity(soldAffectedUnits)}) != totalBaseIn (${formatQuantity(totalBaseInAffected)}); the disjoint-population identity did not reconcile for this incident, so primaryExposure falls back to the largest single statement-line exposure instead of summing`;

  const exposureMethod = populationsProvenDisjoint ? 'DISJOINT_POPULATION_SUM' : 'MAX_STATEMENT_LINE';

  const primaryExposure = populationsProvenDisjoint
    ? inventoryExposureComponent.plus(realizedCogsExposureComponent)
    : Decimal.max(inventoryExposureComponent, realizedCogsExposureComponent, grossProfitDelta.abs());

  const grossStatementFootprint = inventoryExposureComponent.plus(realizedCogsExposureComponent).plus(grossProfitDelta.abs());

  return {
    inventoryValueDelta: formatMoney(inventoryValueDelta),
    cogsDelta: formatMoney(cogsDelta),
    grossProfitDelta: formatMoney(grossProfitDelta),
    grossMarginPercentageDelta: formatPercentage(grossMarginPercentageDelta),
    onHandAffectedUnits: formatQuantity(onHandAffectedUnits),
    soldAffectedUnits: formatQuantity(soldAffectedUnits),
    inventoryExposureComponent: formatMoney(inventoryExposureComponent),
    realizedCogsExposureComponent: formatMoney(realizedCogsExposureComponent),
    populationsProvenDisjoint,
    reconciliationInvariant,
    exposureMethod,
    primaryExposure: formatMoney(primaryExposure),
    grossStatementFootprint: formatMoney(grossStatementFootprint),
    currency: 'IDR'
  };
}

export const ZERO_FINANCIAL_IMPACT: FinancialImpact = {
  inventoryValueDelta: formatMoney(new Decimal(0)),
  cogsDelta: formatMoney(new Decimal(0)),
  grossProfitDelta: formatMoney(new Decimal(0)),
  grossMarginPercentageDelta: formatPercentage(new Decimal(0)),
  onHandAffectedUnits: formatQuantity(new Decimal(0)),
  soldAffectedUnits: formatQuantity(new Decimal(0)),
  inventoryExposureComponent: formatMoney(new Decimal(0)),
  realizedCogsExposureComponent: formatMoney(new Decimal(0)),
  populationsProvenDisjoint: true,
  reconciliationInvariant: 'no incident detected — 0 on-hand + 0 sold = 0 total base-in; disjointness trivially holds',
  exposureMethod: 'DISJOINT_POPULATION_SUM',
  primaryExposure: formatMoney(new Decimal(0)),
  grossStatementFootprint: formatMoney(new Decimal(0)),
  currency: 'IDR'
};
