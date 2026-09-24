import { Decimal, formatMoney, formatQuantity, safeDiv, toDecimal, ZERO } from './decimal';
import type { BaselineSnapshot, InventoryMovementRecord, InventoryValuationRecord } from './types';

// ---------------------------------------------------------------------------
// Recomputes what inventory movements and valuation SHOULD be, using the
// baseline (healthy) conversion factor per unit — never the currently stored
// (possibly corrupted) factor. This is deliberate: the baseline factor is the
// one that was in effect when the historical movements were actually posted,
// so it is the only trustworthy multiplier for reconstructing base_quantity.
// See docs/architecture/financial-integrity-engine.md for the full rationale.
// ---------------------------------------------------------------------------

export function expectedFactorMap(baseline: BaselineSnapshot): Map<string, Decimal> {
  const map = new Map<string, Decimal>();
  for (const [unitName, factor] of Object.entries(baseline.conversionFactor)) {
    map.set(unitName, toDecimal(factor));
  }
  return map;
}

export interface MovementRecompute {
  movementId: string;
  productId: string;
  unitName: string;
  storedBaseQuantity: Decimal;
  recomputedBaseQuantity: Decimal;
  consistent: boolean;
  /** True when this movement's unit is one of the units whose factor changed (blast-radius membership). */
  affectedByUnitChange: boolean;
}

export function recomputeMovements(
  movements: InventoryMovementRecord[],
  factors: Map<string, Decimal>,
  changedUnitNames: ReadonlySet<string>
): MovementRecompute[] {
  return movements.map((movement) => {
    const factor = factors.get(movement.unitName);
    const quantity = toDecimal(movement.quantity);
    const stored = toDecimal(movement.baseQuantity);
    // Unit missing from baseline (never recorded there): fall back to the
    // stored factor rather than fabricate an expectation for it.
    const recomputed = factor ? quantity.times(factor) : stored;

    return {
      movementId: movement.id,
      productId: movement.productId,
      unitName: movement.unitName,
      storedBaseQuantity: stored,
      recomputedBaseQuantity: recomputed,
      consistent: stored.minus(recomputed).abs().lessThanOrEqualTo('0.001'),
      affectedByUnitChange: changedUnitNames.has(movement.unitName)
    };
  });
}

export interface CorrectValuation {
  productId: string;
  totalBaseIn: Decimal;
  totalBaseOut: Decimal;
  totalPurchaseValue: Decimal;
  quantityOnHand: Decimal;
  averageCost: Decimal;
  inventoryValue: Decimal;
}

/**
 * Recomputes the correct aggregate valuation per product straight from
 * movement rows (trustworthy inputs: total_value is the real invoiced money,
 * unaffected by any conversion-factor error; base quantities come from
 * recomputeMovements above, using the baseline factor).
 */
export function recomputeValuations(recomputed: MovementRecompute[], movementsById: Map<string, InventoryMovementRecord>): CorrectValuation[] {
  const byProduct = new Map<string, MovementRecompute[]>();
  for (const m of recomputed) {
    const list = byProduct.get(m.productId) ?? [];
    list.push(m);
    byProduct.set(m.productId, list);
  }

  const results: CorrectValuation[] = [];
  for (const [productId, rows] of byProduct) {
    let totalBaseIn = ZERO;
    let totalBaseOut = ZERO;
    let totalPurchaseValue = ZERO;

    for (const row of rows) {
      const source = movementsById.get(row.movementId);
      if (!source) continue;
      if (source.movementType === 'in') {
        totalBaseIn = totalBaseIn.plus(row.recomputedBaseQuantity);
        totalPurchaseValue = totalPurchaseValue.plus(toDecimal(source.totalValue));
      } else {
        totalBaseOut = totalBaseOut.plus(row.recomputedBaseQuantity);
      }
    }

    const averageCost = safeDiv(totalPurchaseValue, totalBaseIn);
    const quantityOnHand = totalBaseIn.minus(totalBaseOut);
    const inventoryValue = quantityOnHand.times(averageCost);

    results.push({ productId, totalBaseIn, totalBaseOut, totalPurchaseValue, quantityOnHand, averageCost, inventoryValue });
  }
  return results;
}

export interface ValuationComparison {
  valuationId: string;
  productId: string;
  storedQuantityOnHand: Decimal;
  correctQuantityOnHand: Decimal;
  storedAverageCost: Decimal;
  correctAverageCost: Decimal;
  storedInventoryValue: Decimal;
  correctInventoryValue: Decimal;
  /** correct - stored: positive means the stored figure understates the truth. */
  inventoryValueDelta: Decimal;
  mismatch: boolean;
}

export function compareValuations(
  stored: InventoryValuationRecord[],
  correctByProduct: Map<string, CorrectValuation>
): ValuationComparison[] {
  return stored.map((row) => {
    const correct = correctByProduct.get(row.productId);
    const storedQuantityOnHand = toDecimal(row.quantityOnHand);
    const storedAverageCost = toDecimal(row.averageCost);
    const storedInventoryValue = toDecimal(row.inventoryValue);

    const correctQuantityOnHand = correct?.quantityOnHand ?? storedQuantityOnHand;
    const correctAverageCost = correct?.averageCost ?? storedAverageCost;
    const correctInventoryValue = correct?.inventoryValue ?? storedInventoryValue;

    const inventoryValueDelta = correctInventoryValue.minus(storedInventoryValue);

    return {
      valuationId: row.id,
      productId: row.productId,
      storedQuantityOnHand,
      correctQuantityOnHand,
      storedAverageCost,
      correctAverageCost,
      storedInventoryValue,
      correctInventoryValue,
      inventoryValueDelta,
      mismatch: inventoryValueDelta.abs().greaterThan('0.001') || storedQuantityOnHand.minus(correctQuantityOnHand).abs().greaterThan('0.001')
    };
  });
}

export function formatValuationComparison(v: ValuationComparison) {
  return {
    valuationId: v.valuationId,
    productId: v.productId,
    storedQuantityOnHand: formatQuantity(v.storedQuantityOnHand),
    correctQuantityOnHand: formatQuantity(v.correctQuantityOnHand),
    storedAverageCost: formatMoney(v.storedAverageCost),
    correctAverageCost: formatMoney(v.correctAverageCost),
    storedInventoryValue: formatMoney(v.storedInventoryValue),
    correctInventoryValue: formatMoney(v.correctInventoryValue),
    inventoryValueDelta: formatMoney(v.inventoryValueDelta),
    mismatch: v.mismatch
  };
}
