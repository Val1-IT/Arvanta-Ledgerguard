import { formatFactor, formatMoney, formatPercentage, formatQuantity } from './decimal';
import { ALL_QUALITY_CHECKS } from './quality-checks';
import type {
  ProposedCorrection,
  ProposedCorrectionAction,
  RootCause,
  VerificationExpectation
} from './types';
import type { MovementRecompute, ValuationComparison } from './inventory-impact';
import type { MarginComparison } from './margin-impact';
import type { JournalCogsSummary } from './journal-impact';

// ---------------------------------------------------------------------------
// FASE 4 produces a PREVIEW ONLY. Nothing here executes against the database
// — see src/db/repositories for the only place SQL is issued, and note that
// no repository in this codebase currently writes remediation changes.
// Execution is explicitly deferred to FASE 6, after human approval.
//
// Sequencing rationale: the conversion factor must be restored first (it is
// the root cause everything else is recomputed from); inventory valuation is
// regenerated next (it depends only on movements + the restored factor);
// journal reconciliation runs as a read-only cross-check against the
// ledger's own untouched COGS postings; the gross margin report is
// regenerated last since it is the most downstream figure.
//
// RECOMPUTE_INVENTORY_MOVEMENT rows are only emitted for movements whose
// recomputed base_quantity (using the baseline/expected factor) actually
// differs from what's stored. In the UNIT_CONVERSION_MISMATCH demo scenario
// this is zero, because inventory_movements were never touched by the
// incident (see demo-data/scenarios/conversion-error.ts) — the correct
// number of corrections is zero, not a fabricated non-empty list.
// ---------------------------------------------------------------------------

function makeCorrectionBuilder() {
  let sequence = 0;
  return (
    action: ProposedCorrectionAction,
    table: string,
    recordId: string,
    field: string,
    beforeValue: string,
    afterValue: string,
    financialDelta: string | null,
    rollbackAssumption: string
  ): ProposedCorrection => {
    sequence += 1;
    return { sequence, action, table, recordId, field, beforeValue, afterValue, financialDelta, rollbackAssumption };
  };
}

export interface RemediationPreviewInput {
  rootCause: RootCause;
  movementRecomputes: MovementRecompute[];
  valuationComparisons: ValuationComparison[];
  marginComparisons: MarginComparison[];
  journalCogsSummary: JournalCogsSummary;
}

export function buildRemediationPreview(input: RemediationPreviewInput): {
  proposedCorrections: ProposedCorrection[];
  verificationExpectations: VerificationExpectation[];
} {
  const correction = makeCorrectionBuilder();
  const corrections: ProposedCorrection[] = [];

  corrections.push(
    correction(
      'RESTORE_CONVERSION_FACTOR',
      'product_units',
      input.rootCause.unitId,
      'conversion_factor',
      input.rootCause.actualValue,
      input.rootCause.expectedValue,
      null,
      'reverts conversion_factor to the value captured in baseline_snapshot at seed time; safe to re-apply the current value if this needs to be undone'
    )
  );

  const inconsistentMovements = input.movementRecomputes.filter((m) => !m.consistent);
  for (const movement of inconsistentMovements) {
    corrections.push(
      correction(
        'RECOMPUTE_INVENTORY_MOVEMENT',
        'inventory_movements',
        movement.movementId,
        'base_quantity',
        formatQuantity(movement.storedBaseQuantity),
        formatQuantity(movement.recomputedBaseQuantity),
        null,
        'recomputed using the restored conversion_factor; original stored value is retained above for rollback'
      )
    );
  }

  for (const valuation of input.valuationComparisons.filter((v) => v.mismatch)) {
    corrections.push(
      correction(
        'REGENERATE_INVENTORY_VALUATION',
        'inventory_valuation',
        valuation.valuationId,
        'quantity_on_hand',
        formatQuantity(valuation.storedQuantityOnHand),
        formatQuantity(valuation.correctQuantityOnHand),
        null,
        'previous value retained above for rollback'
      )
    );
    corrections.push(
      correction(
        'REGENERATE_INVENTORY_VALUATION',
        'inventory_valuation',
        valuation.valuationId,
        'average_cost',
        formatMoney(valuation.storedAverageCost),
        formatMoney(valuation.correctAverageCost),
        null,
        'previous value retained above for rollback'
      )
    );
    corrections.push(
      correction(
        'REGENERATE_INVENTORY_VALUATION',
        'inventory_valuation',
        valuation.valuationId,
        'inventory_value',
        formatMoney(valuation.storedInventoryValue),
        formatMoney(valuation.correctInventoryValue),
        formatMoney(valuation.inventoryValueDelta),
        'previous value retained above for rollback'
      )
    );
  }

  if (input.marginComparisons.some((m) => m.mismatch)) {
    corrections.push(
      correction(
        'RECONCILE_JOURNAL_ENTRIES',
        'journal_entries',
        input.marginComparisons[0]?.period ?? 'unknown-period',
        'cost_of_goods_sold_reconciliation',
        formatMoney(input.journalCogsSummary.postedCogs),
        formatMoney(input.journalCogsSummary.postedCogs),
        null,
        'journal entries are not modified by this step; it only confirms the recomputed COGS matches the ledger-posted COGS before the margin report is regenerated'
      )
    );
  }

  for (const margin of input.marginComparisons.filter((m) => m.mismatch)) {
    corrections.push(
      correction(
        'REGENERATE_GROSS_MARGIN_REPORT',
        'gross_margin_report',
        margin.reportId,
        'cost_of_goods_sold',
        formatMoney(margin.storedCogs),
        formatMoney(margin.correctCogs),
        formatMoney(margin.cogsDelta),
        'previous value retained above for rollback'
      )
    );
    corrections.push(
      correction(
        'REGENERATE_GROSS_MARGIN_REPORT',
        'gross_margin_report',
        margin.reportId,
        'gross_profit',
        formatMoney(margin.storedGrossProfit),
        formatMoney(margin.correctGrossProfit),
        formatMoney(margin.grossProfitDelta),
        'previous value retained above for rollback'
      )
    );
    corrections.push(
      correction(
        'REGENERATE_GROSS_MARGIN_REPORT',
        'gross_margin_report',
        margin.reportId,
        'gross_margin_percentage',
        formatPercentage(margin.storedGrossMarginPercentage),
        formatPercentage(margin.correctGrossMarginPercentage),
        null,
        'previous value retained above for rollback'
      )
    );
  }

  const verificationExpectations: VerificationExpectation[] = ALL_QUALITY_CHECKS.map((check) => ({
    checkId: check.checkId,
    expectedStatus: 'PASS',
    description: `after remediation is executed (FASE 6), ${check.checkId} must evaluate to PASS against the corrected state`
  }));

  return { proposedCorrections: corrections, verificationExpectations };
}

// re-exported purely so callers constructing evidence strings can format a
// factor consistently with the rest of the remediation preview
export { formatFactor };
