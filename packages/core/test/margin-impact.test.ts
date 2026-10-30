import { describe, expect, it } from 'vitest';
import {
  compareMarginReports,
  formatMarginComparison,
  toDecimal,
  type CorrectValuation,
  type GrossMarginReportRecord
} from '@ledgerguard/core';

function valuation(productId: string, totalBaseOut: string, averageCost: string): CorrectValuation {
  return {
    productId,
    totalBaseIn: toDecimal(0),
    totalBaseOut: toDecimal(totalBaseOut),
    totalPurchaseValue: toDecimal(0),
    quantityOnHand: toDecimal(0),
    averageCost: toDecimal(averageCost),
    inventoryValue: toDecimal(0)
  };
}

function report(id: string, revenue: string, cogs: string, grossProfit: string, margin: string): GrossMarginReportRecord {
  return { id, period: '2026-10', revenue, costOfGoodsSold: cogs, grossProfit, grossMarginPercentage: margin, generatedAt: '2026-10-31T00:00:00.000Z' };
}

// Correct COGS = 36 * 2.50 + 4 * 10.00 = 130.00
const valuations = [valuation('p1', '36', '2.50'), valuation('p2', '4', '10.00')];

describe('compareMarginReports', () => {
  it('reports no mismatch when stored figures match the recomputed COGS', () => {
    const [m] = compareMarginReports([report('r1', '200.00', '130.00', '70.00', '35.00')], valuations);
    expect(m!.mismatch).toBe(false);
    expect(m!.correctCogs.toFixed(2)).toBe('130.00');
    expect(m!.correctGrossProfit.toFixed(2)).toBe('70.00');
    expect(m!.correctGrossMarginPercentage.toFixed(2)).toBe('35.00');
    expect(m!.cogsDelta.isZero()).toBe(true);
  });

  it('gives a positive cogsDelta when stored COGS is understated', () => {
    const [m] = compareMarginReports([report('r1', '200.00', '30.00', '170.00', '85.00')], valuations);
    expect(m!.mismatch).toBe(true);
    expect(m!.cogsDelta.toFixed(2)).toBe('100.00');
    expect(m!.grossProfitDelta.toFixed(2)).toBe('-100.00');
    expect(m!.grossMarginPercentageDelta.toFixed(2)).toBe('-50.00');
  });

  it('uses the safeDiv path for zero revenue without throwing', () => {
    let result: ReturnType<typeof compareMarginReports> = [];
    expect(() => { result = compareMarginReports([report('r0', '0', '130.00', '-130.00', '0')], valuations); }).not.toThrow();
    const [m] = result;
    expect(m!.correctGrossProfit.toFixed(2)).toBe('-130.00');
    expect(m!.correctGrossMarginPercentage.isZero()).toBe(true);
    expect(m!.correctGrossMarginPercentage.isFinite()).toBe(true);
    expect(m!.mismatch).toBe(false);
  });

  it('compares multiple reports in one call, preserving order and ids', () => {
    const results = compareMarginReports([
      report('r1', '200.00', '130.00', '70.00', '35.00'),
      report('r2', '400.00', '100.00', '300.00', '75.00')
    ], valuations);
    expect(results.map((r) => r.reportId)).toEqual(['r1', 'r2']);
    expect(results.map((r) => r.mismatch)).toEqual([false, true]);
    expect(results[1]!.correctGrossMarginPercentage.toFixed(2)).toBe('67.50');
  });

  it('returns an empty list for no reports', () => {
    expect(compareMarginReports([], valuations)).toEqual([]);
  });
});

describe('formatMarginComparison', () => {
  it('prints the key fields as fixed-precision strings', () => {
    const [m] = compareMarginReports([report('r1', '200.00', '30.00', '170.00', '85.00')], valuations);
    const f = formatMarginComparison(m!);
    expect(f.reportId).toBe('r1');
    expect(f.period).toBe('2026-10');
    expect(f.revenue).toBe('200.00');
    expect(f.storedCogs).toBe('30.00');
    expect(f.correctCogs).toBe('130.00');
    expect(f.cogsDelta).toBe('100.00');
    expect(f.grossProfitDelta).toBe('-100.00');
    expect(f.correctGrossProfit).toBe('70.00');
    expect(f.correctGrossMarginPercentage).toMatch(/^35\.0+$/);
    expect(f.storedGrossMarginPercentage).toMatch(/^85\.0+$/);
    expect(f.grossMarginPercentageDelta).toMatch(/^-50\.0+$/);
    expect(f.mismatch).toBe(true);
    for (const key of ['revenue', 'storedCogs', 'correctCogs', 'cogsDelta'] as const) expect(typeof f[key]).toBe('string');
  });
});
