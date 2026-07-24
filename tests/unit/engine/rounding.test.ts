import { describe, expect, it } from 'vitest';
import { formatMoney } from '../../../src/engine/decimal';
import { expectedFactorMap, recomputeMovements, recomputeValuations } from '../../../src/engine/inventory-impact';
import type { BaselineSnapshot, InventoryMovementRecord } from '../../../src/engine/types';

// ---------------------------------------------------------------------------
// Case 8 — rounding edge case. A single CARTON factor of 3 turns a purchase
// of 100.00 into an average cost of 100/3, a repeating decimal. If average
// cost were rounded to 2 decimal places (33.33) BEFORE being multiplied back
// by the recomputed base quantity (3), the result would be 99.99 — a one-cent
// loss purely from premature rounding. The engine must instead carry full
// Decimal precision through every intermediate step and round only once, at
// the formatting boundary, so quantity * (totalValue / quantity) reproduces
// totalValue exactly.
// ---------------------------------------------------------------------------

describe('rounding edge case (case 8)', () => {
  it('recovers exact inventory value from a repeating-decimal average cost', () => {
    const baseline: BaselineSnapshot = {
      conversionFactor: { CARTON: 3 },
      movements: { totalBaseIn: 3, totalBaseOut: 0, quantityOnHand: 3 },
      valuation: { averageCost: 100 / 3, inventoryValue: 100, quantityOnHand: 3 },
      margin: { revenue: 0, costOfGoodsSold: 0, grossProfit: 0, grossMarginPercentage: 0 }
    };

    const movement: InventoryMovementRecord = {
      id: 'mov-round-1',
      productId: 'prod-round',
      movementType: 'in',
      quantity: '1.000',
      unitName: 'CARTON',
      baseQuantity: '3.000',
      unitCost: '33.33',
      totalValue: '100.00',
      occurredAt: new Date('2026-01-01T00:00:00.000Z')
    };

    const factors = expectedFactorMap(baseline);
    const recomputed = recomputeMovements([movement], factors, new Set(['CARTON']));
    const movementsById = new Map([[movement.id, movement]]);
    const [valuation] = recomputeValuations(recomputed, movementsById);

    // Naively rounding average cost to 2dp first (33.33) and multiplying by 3
    // would give 99.99. Full-precision computation must give exactly 100.00.
    expect(formatMoney(valuation.inventoryValue)).toBe('100.00');
    expect(formatMoney(valuation.totalPurchaseValue)).toBe('100.00');
  });
});
