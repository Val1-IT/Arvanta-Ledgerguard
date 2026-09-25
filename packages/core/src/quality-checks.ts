import { findDuplicateMovementGroups } from './detectors/duplicate-inventory-movement';
import { checkJournalBalance } from './journal-impact';
import { formatFactor, formatMoney, formatPercentage, formatQuantity, safeDiv, toDecimal } from './decimal';
import type { EvidenceItem, QualityCheckEvaluator, QualityCheckInput, QualityCheckResult } from './types';

// ---------------------------------------------------------------------------
// The five required QualityCheckEvaluator implementations. Each is a pure
// function of QualityCheckInput — runnable before an incident, after an
// incident, and after remediation (verify.ts reuses the same evaluators).
//
// Design note on scope: ConversionFactorPositiveCheck and JournalBalanceCheck
// are purely structural — they can fail for reasons that have nothing to do
// with the conversion-error incident (a pre-existing bad journal, a bad
// factor typed in directly). BaseQuantityConsistencyCheck cross-references
// movements against the CURRENT (possibly corrupted) factor, which is what
// makes it the check that actually goes red during this incident.
// InventoryValuationConsistencyCheck and GrossMarginConsistencyCheck are
// self-consistency checks (does the stored arithmetic add up internally) —
// they intentionally do NOT compare against the baseline, so they stay green
// even while the reported numbers are wrong; catching "wrong vs baseline" is
// the job of the impact modules (inventory-impact.ts, margin-impact.ts), not
// these structural checks.
// ---------------------------------------------------------------------------

const TOLERANCE = '0.01';

function exceeds(a: ReturnType<typeof toDecimal>, b: ReturnType<typeof toDecimal>): boolean {
  return a.minus(b).abs().greaterThan(TOLERANCE);
}

export class ConversionFactorPositiveCheck implements QualityCheckEvaluator {
  readonly checkId = 'CONVERSION_FACTOR_POSITIVE';

  evaluate(input: QualityCheckInput): QualityCheckResult {
    const violations = input.productUnits.filter((unit) => toDecimal(unit.conversionFactor).lessThanOrEqualTo(0));

    if (violations.length === 0) {
      return {
        checkId: this.checkId,
        status: 'PASS',
        severity: 'info',
        expected: 'all product_units.conversion_factor > 0',
        actual: 'all product_units.conversion_factor > 0',
        affectedRecordIds: [],
        evidence: [],
        remediationHint: 'no action required'
      };
    }

    const evidence: EvidenceItem[] = violations.map((unit) => ({
      table: 'product_units',
      recordId: unit.id,
      field: 'conversion_factor',
      expectedValue: '> 0',
      actualValue: formatFactor(toDecimal(unit.conversionFactor)),
      delta: formatFactor(toDecimal(unit.conversionFactor)),
      reason: 'conversion_factor must be strictly positive; zero or negative values make base-quantity conversion meaningless or invert it'
    }));

    return {
      checkId: this.checkId,
      status: 'FAIL',
      severity: 'critical',
      expected: '> 0',
      actual: violations.map((u) => `${u.unitName}=${u.conversionFactor}`).join(', '),
      affectedRecordIds: violations.map((u) => u.id),
      evidence,
      remediationHint: 'restore a valid positive conversion_factor (see baseline_snapshot) before recomputing anything downstream'
    };
  }
}

export class BaseQuantityConsistencyCheck implements QualityCheckEvaluator {
  readonly checkId = 'BASE_QUANTITY_CONSISTENCY';

  evaluate(input: QualityCheckInput): QualityCheckResult {
    const currentFactor = new Map<string, ReturnType<typeof toDecimal>>();
    for (const unit of input.productUnits) {
      currentFactor.set(`${unit.productId}:${unit.unitName}`, toDecimal(unit.conversionFactor));
    }

    const mismatches: EvidenceItem[] = [];
    for (const movement of input.movements) {
      const factor = currentFactor.get(`${movement.productId}:${movement.unitName}`);
      if (!factor) continue; // unit not registered: nothing to cross-check against

      const quantity = toDecimal(movement.quantity);
      const expected = quantity.times(factor);
      const actual = toDecimal(movement.baseQuantity);

      if (exceeds(expected, actual)) {
        mismatches.push({
          table: 'inventory_movements',
          recordId: movement.id,
          field: 'base_quantity',
          expectedValue: formatQuantity(expected),
          actualValue: formatQuantity(actual),
          delta: formatQuantity(expected.minus(actual)),
          reason: `base_quantity does not equal quantity (${formatQuantity(quantity)}) times the current conversion_factor (${formatFactor(factor)}) for unit ${movement.unitName}`
        });
      }
    }

    if (mismatches.length === 0) {
      return {
        checkId: this.checkId,
        status: 'PASS',
        severity: 'info',
        expected: 'base_quantity = quantity * current conversion_factor',
        actual: 'base_quantity = quantity * current conversion_factor',
        affectedRecordIds: [],
        evidence: [],
        remediationHint: 'no action required'
      };
    }

    return {
      checkId: this.checkId,
      status: 'FAIL',
      severity: 'critical',
      expected: 'base_quantity = quantity * current conversion_factor',
      actual: `${mismatches.length} movement(s) inconsistent with the current conversion_factor`,
      affectedRecordIds: mismatches.map((m) => m.recordId),
      evidence: mismatches,
      remediationHint: 'the current conversion_factor likely changed after these movements were posted; restore the factor that was in effect when they were recorded, not the movements themselves'
    };
  }
}

export class InventoryValuationConsistencyCheck implements QualityCheckEvaluator {
  readonly checkId = 'INVENTORY_VALUATION_CONSISTENCY';

  evaluate(input: QualityCheckInput): QualityCheckResult {
    const mismatches: EvidenceItem[] = [];

    for (const valuation of input.valuations) {
      const quantityOnHand = toDecimal(valuation.quantityOnHand);
      const averageCost = toDecimal(valuation.averageCost);
      const inventoryValue = toDecimal(valuation.inventoryValue);
      const expected = quantityOnHand.times(averageCost);

      if (exceeds(expected, inventoryValue)) {
        mismatches.push({
          table: 'inventory_valuation',
          recordId: valuation.id,
          field: 'inventory_value',
          expectedValue: formatMoney(expected),
          actualValue: formatMoney(inventoryValue),
          delta: formatMoney(expected.minus(inventoryValue)),
          reason: 'inventory_value does not equal quantity_on_hand * average_cost'
        });
      }
    }

    if (mismatches.length === 0) {
      return {
        checkId: this.checkId,
        status: 'PASS',
        severity: 'info',
        expected: 'inventory_value = quantity_on_hand * average_cost',
        actual: 'inventory_value = quantity_on_hand * average_cost',
        affectedRecordIds: [],
        evidence: [],
        remediationHint: 'no action required'
      };
    }

    return {
      checkId: this.checkId,
      status: 'FAIL',
      severity: 'warning',
      expected: 'inventory_value = quantity_on_hand * average_cost',
      actual: `${mismatches.length} valuation row(s) internally inconsistent`,
      affectedRecordIds: mismatches.map((m) => m.recordId),
      evidence: mismatches,
      remediationHint: 'regenerate inventory_valuation from inventory_movements rather than patching the row directly'
    };
  }
}

export class JournalBalanceCheck implements QualityCheckEvaluator {
  readonly checkId = 'JOURNAL_BALANCE';

  evaluate(input: QualityCheckInput): QualityCheckResult {
    const balance = checkJournalBalance(input.journalEntries);

    if (balance.balanced) {
      return {
        checkId: this.checkId,
        status: 'PASS',
        severity: 'info',
        expected: 'total debit = total credit',
        actual: `debit=${formatMoney(balance.totalDebit)}, credit=${formatMoney(balance.totalCredit)}`,
        affectedRecordIds: [],
        evidence: [],
        remediationHint: 'no action required'
      };
    }

    const unbalancedKeys = new Set(balance.unbalancedSources.map((s) => `${s.sourceType}:${s.sourceId}`));
    const affectedEntries = input.journalEntries.filter((e) => unbalancedKeys.has(`${e.sourceType}:${e.sourceId}`));

    const evidence: EvidenceItem[] = balance.unbalancedSources.map((s) => ({
      table: 'journal_entries',
      recordId: `${s.sourceType}:${s.sourceId}`,
      field: 'debit/credit',
      expectedValue: '0.00',
      actualValue: s.difference,
      delta: s.difference,
      reason: `entries for source ${s.sourceType}:${s.sourceId} do not balance (debit=${s.debit}, credit=${s.credit})`
    }));

    return {
      checkId: this.checkId,
      status: 'FAIL',
      severity: 'critical',
      expected: 'total debit = total credit',
      actual: `difference=${formatMoney(balance.difference)}`,
      affectedRecordIds: affectedEntries.map((e) => e.id),
      evidence,
      remediationHint: 'reconcile the unbalanced source — this is a structural bookkeeping issue independent of any conversion-factor incident'
    };
  }
}

export class GrossMarginConsistencyCheck implements QualityCheckEvaluator {
  readonly checkId = 'GROSS_MARGIN_CONSISTENCY';

  evaluate(input: QualityCheckInput): QualityCheckResult {
    const mismatches: EvidenceItem[] = [];

    for (const report of input.marginReports) {
      const revenue = toDecimal(report.revenue);
      const cogs = toDecimal(report.costOfGoodsSold);
      const grossProfit = toDecimal(report.grossProfit);
      const grossMarginPercentage = toDecimal(report.grossMarginPercentage);

      const impliedGrossProfit = revenue.minus(cogs);
      if (exceeds(impliedGrossProfit, grossProfit)) {
        mismatches.push({
          table: 'gross_margin_report',
          recordId: report.id,
          field: 'gross_profit',
          expectedValue: formatMoney(impliedGrossProfit),
          actualValue: formatMoney(grossProfit),
          delta: formatMoney(impliedGrossProfit.minus(grossProfit)),
          reason: 'gross_profit does not equal revenue - cost_of_goods_sold'
        });
      }

      const impliedMarginPercentage = safeDiv(grossProfit, revenue).times(100);
      if (exceeds(impliedMarginPercentage, grossMarginPercentage)) {
        mismatches.push({
          table: 'gross_margin_report',
          recordId: report.id,
          field: 'gross_margin_percentage',
          expectedValue: formatPercentage(impliedMarginPercentage),
          actualValue: formatPercentage(grossMarginPercentage),
          delta: formatPercentage(impliedMarginPercentage.minus(grossMarginPercentage)),
          reason: 'gross_margin_percentage does not equal gross_profit / revenue * 100'
        });
      }
    }

    if (mismatches.length === 0) {
      return {
        checkId: this.checkId,
        status: 'PASS',
        severity: 'info',
        expected: 'gross_profit = revenue - cost_of_goods_sold; gross_margin_percentage = gross_profit / revenue * 100',
        actual: 'gross_profit = revenue - cost_of_goods_sold; gross_margin_percentage = gross_profit / revenue * 100',
        affectedRecordIds: [],
        evidence: [],
        remediationHint: 'no action required'
      };
    }

    return {
      checkId: this.checkId,
      status: 'FAIL',
      severity: 'warning',
      expected: 'gross_profit and gross_margin_percentage internally consistent with revenue and cost_of_goods_sold',
      actual: `${mismatches.length} inconsistency(ies) found`,
      affectedRecordIds: Array.from(new Set(mismatches.map((m) => m.recordId))),
      evidence: mismatches,
      remediationHint: 'regenerate gross_margin_report rather than patching individual fields'
    };
  }
}

export class DuplicateReceiptMovementCheck implements QualityCheckEvaluator {
  readonly checkId = 'DUPLICATE_RECEIPT_MOVEMENT';

  evaluate(input: QualityCheckInput): QualityCheckResult {
    const groups = findDuplicateMovementGroups(input);
    if (groups.length === 0) {
      return {
        checkId: this.checkId,
        status: 'PASS',
        severity: 'info',
        expected: 'at most one active inbound movement per receipt event identity',
        actual: 'at most one active inbound movement per receipt event identity',
        affectedRecordIds: [],
        evidence: [],
        remediationHint: 'no action required'
      };
    }

    const affected = groups.flatMap((group) => [group.legitimate.id, ...group.duplicates.map((item) => item.id)]);
    return {
      checkId: this.checkId,
      status: 'FAIL',
      severity: 'critical',
      expected: 'at most one active inbound movement per receipt event identity',
      actual: `${groups.length} duplicate event group(s)`,
      affectedRecordIds: affected,
      evidence: groups.map((group) => ({
        table: 'inventory_movements',
        recordId: group.duplicates[0]?.id ?? group.legitimate.id,
        field: 'event_identity',
        expectedValue: group.legitimate.id,
        actualValue: group.duplicates.map((item) => item.id).join(','),
        delta: String(group.duplicates.length),
        reason: `event ${group.eventIdentity} produced ${group.duplicates.length + 1} active movements`
      })),
      remediationHint: 'reverse the later duplicate movement; do not reverse the earliest legitimate movement'
    };
  }
}

export const ALL_QUALITY_CHECKS: QualityCheckEvaluator[] = [
  new ConversionFactorPositiveCheck(),
  new BaseQuantityConsistencyCheck(),
  new InventoryValuationConsistencyCheck(),
  new JournalBalanceCheck(),
  new GrossMarginConsistencyCheck(),
  new DuplicateReceiptMovementCheck()
];
