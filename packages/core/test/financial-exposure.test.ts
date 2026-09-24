import { describe, expect, it } from 'vitest';
import { buildFinancialImpact, Decimal, ZERO_FINANCIAL_IMPACT } from '@ledgerguard/core';

// ---------------------------------------------------------------------------
// FASE 4.1 requirement 1 — financial exposure must not double-count a single
// accounting misstatement across inventoryValueDelta, cogsDelta, and
// grossProfitDelta. These tests exercise buildFinancialImpact() directly
// (not through the full investigate() pipeline) so the disjoint-population
// proof and its MAX_STATEMENT_LINE fallback can both be verified in
// isolation, including the fallback branch that never occurs naturally in
// the current single-incident demo scenario.
// ---------------------------------------------------------------------------

const d = (v: string | number) => new Decimal(v);

describe('buildFinancialImpact — linked inventory/COGS misstatement is not double-counted', () => {
  it('sums the two disjoint components into primaryExposure, matching the real seed figures', () => {
    const impact = buildFinancialImpact({
      inventoryValueDelta: d('14400000'),
      cogsDelta: d('-14400000'),
      grossProfitDelta: d('14400000'),
      grossMarginPercentageDelta: d('13.3333'),
      onHandAffectedUnits: d(1440),
      soldAffectedUnits: d(1440),
      totalBaseInAffected: d(2880)
    });

    expect(impact.populationsProvenDisjoint).toBe(true);
    expect(impact.exposureMethod).toBe('DISJOINT_POPULATION_SUM');
    expect(impact.inventoryExposureComponent).toBe('14400000.00');
    expect(impact.realizedCogsExposureComponent).toBe('14400000.00');
    // primaryExposure sums the two disjoint components only — never adds
    // grossProfitDelta, which is -cogsDelta by construction (same misstatement).
    expect(impact.primaryExposure).toBe('28800000.00');
  });
});

describe('buildFinancialImpact — gross statement footprint is separate from primary exposure', () => {
  it('grossStatementFootprint includes grossProfitDelta; primaryExposure does not', () => {
    const impact = buildFinancialImpact({
      inventoryValueDelta: d('14400000'),
      cogsDelta: d('-14400000'),
      grossProfitDelta: d('14400000'),
      grossMarginPercentageDelta: d('13.3333'),
      onHandAffectedUnits: d(1440),
      soldAffectedUnits: d(1440),
      totalBaseInAffected: d(2880)
    });

    // 14.4M (inventory) + 14.4M (cogs) + 14.4M (gross profit) = 43.2M — the raw
    // sum of every statement line, deliberately allowing the same misstatement
    // to appear more than once. Must never equal or be mistaken for primaryExposure.
    expect(impact.grossStatementFootprint).toBe('43200000.00');
    expect(impact.primaryExposure).toBe('28800000.00');
    expect(impact.grossStatementFootprint).not.toBe(impact.primaryExposure);
  });
});

describe('buildFinancialImpact — disjoint population sum requires a proven non-overlap', () => {
  it('falls back to MAX_STATEMENT_LINE when on-hand + sold does not reconcile to total base-in', () => {
    const impact = buildFinancialImpact({
      inventoryValueDelta: d('14400000'),
      cogsDelta: d('-14400000'),
      grossProfitDelta: d('14400000'),
      grossMarginPercentageDelta: d('13.3333'),
      onHandAffectedUnits: d(1440),
      soldAffectedUnits: d(1440),
      // Deliberately broken invariant: 1440 + 1440 != 5000, so the two
      // populations are not proven disjoint for this (synthetic) input.
      totalBaseInAffected: d(5000)
    });

    expect(impact.populationsProvenDisjoint).toBe(false);
    expect(impact.exposureMethod).toBe('MAX_STATEMENT_LINE');
    // The largest single statement-line absolute value (all three tie at 14.4M here).
    expect(impact.primaryExposure).toBe('14400000.00');
    expect(impact.reconciliationInvariant).toMatch(/did not reconcile/);
  });

  it('reconciles a healthy (zero-delta) baseline as trivially disjoint', () => {
    expect(ZERO_FINANCIAL_IMPACT.populationsProvenDisjoint).toBe(true);
    expect(ZERO_FINANCIAL_IMPACT.exposureMethod).toBe('DISJOINT_POPULATION_SUM');
    expect(ZERO_FINANCIAL_IMPACT.primaryExposure).toBe('0.00');
  });
});
