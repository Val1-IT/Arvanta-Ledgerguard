import { Decimal, formatMoney, formatPercentage, safeDiv, toDecimal } from './decimal';
import type { GrossMarginReportRecord } from './types';
import type { CorrectValuation } from './inventory-impact';

// ---------------------------------------------------------------------------
// Revenue is trusted as reported: the conversion-error scenario never touches
// it (see demo-data/scenarios/conversion-error.ts — only cost_of_goods_sold,
// gross_profit, and gross_margin_percentage are corrupted). The only figure
// this module recomputes independently is COGS, derived from the correct
// (baseline-factor) valuation: quantity actually sold (total base out) times
// the correct average cost. Gross profit and margin % are then derived from
// that recomputed COGS plus the trusted revenue, never taken from storage.
// ---------------------------------------------------------------------------

export interface MarginComparison {
  reportId: string;
  period: string;
  revenue: Decimal; // trusted as-is
  storedCogs: Decimal;
  correctCogs: Decimal;
  storedGrossProfit: Decimal;
  correctGrossProfit: Decimal;
  storedGrossMarginPercentage: Decimal;
  correctGrossMarginPercentage: Decimal;
  /** correct - stored: positive means the stored COGS understated the truth. */
  cogsDelta: Decimal;
  grossProfitDelta: Decimal;
  grossMarginPercentageDelta: Decimal;
  mismatch: boolean;
}

export function compareMarginReports(
  reports: GrossMarginReportRecord[],
  correctValuations: CorrectValuation[]
): MarginComparison[] {
  const correctCogsTotal = correctValuations.reduce(
    (sum, v) => sum.plus(v.totalBaseOut.times(v.averageCost)),
    toDecimal(0)
  );

  return reports.map((report) => {
    const revenue = toDecimal(report.revenue);
    const storedCogs = toDecimal(report.costOfGoodsSold);
    const storedGrossProfit = toDecimal(report.grossProfit);
    const storedGrossMarginPercentage = toDecimal(report.grossMarginPercentage);

    const correctCogs = correctCogsTotal;
    const correctGrossProfit = revenue.minus(correctCogs);
    const correctGrossMarginPercentage = safeDiv(correctGrossProfit, revenue).times(100);

    const cogsDelta = correctCogs.minus(storedCogs);
    const grossProfitDelta = correctGrossProfit.minus(storedGrossProfit);
    const grossMarginPercentageDelta = correctGrossMarginPercentage.minus(storedGrossMarginPercentage);

    return {
      reportId: report.id,
      period: report.period,
      revenue,
      storedCogs,
      correctCogs,
      storedGrossProfit,
      correctGrossProfit,
      storedGrossMarginPercentage,
      correctGrossMarginPercentage,
      cogsDelta,
      grossProfitDelta,
      grossMarginPercentageDelta,
      mismatch: cogsDelta.abs().greaterThan('0.001') || grossProfitDelta.abs().greaterThan('0.001')
    };
  });
}

export function formatMarginComparison(m: MarginComparison) {
  return {
    reportId: m.reportId,
    period: m.period,
    revenue: formatMoney(m.revenue),
    storedCogs: formatMoney(m.storedCogs),
    correctCogs: formatMoney(m.correctCogs),
    storedGrossProfit: formatMoney(m.storedGrossProfit),
    correctGrossProfit: formatMoney(m.correctGrossProfit),
    storedGrossMarginPercentage: formatPercentage(m.storedGrossMarginPercentage),
    correctGrossMarginPercentage: formatPercentage(m.correctGrossMarginPercentage),
    cogsDelta: formatMoney(m.cogsDelta),
    grossProfitDelta: formatMoney(m.grossProfitDelta),
    grossMarginPercentageDelta: formatPercentage(m.grossMarginPercentageDelta),
    mismatch: m.mismatch
  };
}
