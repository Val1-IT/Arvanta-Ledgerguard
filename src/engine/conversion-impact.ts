import { formatFactor, toDecimal } from './decimal';
import type { BaselineSnapshot, ProductUnitRecord, RootCause } from './types';

export interface ConversionFactorChange {
  productId: string;
  unitId: string;
  unitName: string;
  expectedValue: string; // baseline (healthy) factor
  actualValue: string; // currently stored factor
  delta: string; // actualValue - expectedValue
}

/**
 * Diffs every product_units row against the healthy baseline snapshot's
 * conversionFactor map. A change is reported whenever the two differ,
 * regardless of direction or magnitude — severity/positivity judgement is a
 * separate concern (see quality-checks.ts).
 */
export function detectConversionFactorChanges(
  productUnits: ProductUnitRecord[],
  baseline: BaselineSnapshot
): ConversionFactorChange[] {
  const changes: ConversionFactorChange[] = [];

  for (const unit of productUnits) {
    const expected = baseline.conversionFactor[unit.unitName];
    if (expected === undefined) continue; // unit not present in baseline: nothing to diff against

    const expectedDecimal = toDecimal(expected);
    const actualDecimal = toDecimal(unit.conversionFactor);
    if (!expectedDecimal.equals(actualDecimal)) {
      changes.push({
        productId: unit.productId,
        unitId: unit.id,
        unitName: unit.unitName,
        expectedValue: formatFactor(expectedDecimal),
        actualValue: formatFactor(actualDecimal),
        delta: formatFactor(actualDecimal.minus(expectedDecimal))
      });
    }
  }

  return changes;
}

/**
 * Picks the single root cause from detected changes. FASE 4 supports one
 * conversion-error incident type at a time (scope guardrail: no multiple
 * incident scenarios yet) — when more than one unit has changed, the one
 * with the largest absolute factor delta is reported as the root cause and
 * the rest are still visible in the returned `changes` array for evidence.
 */
export function selectRootCause(changes: ConversionFactorChange[]): RootCause | null {
  if (changes.length === 0) return null;

  const primary = changes.reduce((biggest, candidate) =>
    toDecimal(candidate.delta).abs().greaterThan(toDecimal(biggest.delta).abs()) ? candidate : biggest
  );

  return {
    asset: 'product_units',
    field: 'conversion_factor',
    productId: primary.productId,
    unitId: primary.unitId,
    unitName: primary.unitName,
    expectedValue: primary.expectedValue,
    actualValue: primary.actualValue,
    delta: primary.delta
  };
}
