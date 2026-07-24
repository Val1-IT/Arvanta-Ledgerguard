import { describe, expect, it } from 'vitest';
import { toDecimal, ZERO } from '../../../src/engine/decimal';
import { expectedFactorMap, recomputeMovements, recomputeValuations } from '../../../src/engine/inventory-impact';
import { buildFinancialImpact } from '../../../src/engine/financial-exposure';
import type { BaselineSnapshot, InventoryMovementRecord } from '../../../src/engine/types';

// ---------------------------------------------------------------------------
// FASE 5 pre-flight requirement: before any DataHub-aware orchestration is
// built on top of the disjoint-population proof, confirm that
// onHandAffectedUnits / soldAffectedUnits / totalBaseInAffected (consumed by
// buildFinancialImpact, see financial-exposure.test.ts) are genuinely
// *derived* from movement rows — not merely two numbers that happen to add
// up in the single fixed demo scenario (24 purchases in, 36 sales out).
//
// This file exercises recomputeValuations() directly against a synthetic
// movement set that is richer than the demo scenario: it mixes ordinary
// purchases/sales with a supplier return (an 'out' movement not tied to a
// sale) and a customer return (an 'in' movement not tied to a purchase).
// The current schema (src/engine/types.ts) models exactly two movement
// directions — 'in' and 'out' — so any return or adjustment MUST be posted
// as one of those two; recomputeValuations() classifies purely on
// movementType, so a return is folded into the correct bucket automatically,
// with no special-case branch that could silently misclassify it.
// ---------------------------------------------------------------------------

const baseline: BaselineSnapshot = {
  conversionFactor: { CARTON: 12, PCS: 1 },
  movements: { totalBaseIn: 0, totalBaseOut: 0, quantityOnHand: 0 },
  valuation: { averageCost: 0, inventoryValue: 0, quantityOnHand: 0 },
  margin: { revenue: 0, costOfGoodsSold: 0, grossProfit: 0, grossMarginPercentage: 0 },
  capturedAt: new Date('2026-01-01T00:00:00.000Z')
};

function movement(partial: Partial<InventoryMovementRecord> & Pick<InventoryMovementRecord, 'id' | 'movementType' | 'baseQuantity'>): InventoryMovementRecord {
  return {
    productId: 'prod-cement-40',
    unitName: 'PCS',
    quantity: partial.baseQuantity,
    unitCost: '50000.00',
    totalValue: '0.00',
    occurredAt: new Date('2026-01-01T00:00:00.000Z'),
    ...partial
  };
}

describe('recomputeValuations — on-hand/sold populations are derived from movement rows, including returns', () => {
  it('folds a supplier return (out) and a customer return (in) into the correct bucket purely by movementType', () => {
    const movements: InventoryMovementRecord[] = [
      // ordinary purchase: 100 in
      movement({ id: 'mov-1', movementType: 'in', baseQuantity: '100.000', totalValue: '5000000.00' }),
      // ordinary sale: 40 out
      movement({ id: 'mov-2', movementType: 'out', baseQuantity: '40.000' }),
      // supplier return: goods sent back out, not a sale — still movementType 'out'
      movement({ id: 'mov-3', movementType: 'out', baseQuantity: '10.000' }),
      // customer return: goods received back, not a purchase — still movementType 'in'
      movement({ id: 'mov-4', movementType: 'in', baseQuantity: '5.000', totalValue: '0.00' })
    ];

    const factors = expectedFactorMap(baseline);
    const recomputed = recomputeMovements(movements, factors, new Set());
    const movementsById = new Map(movements.map((m) => [m.id, m]));
    const [valuation] = recomputeValuations(recomputed, movementsById);

    // totalBaseIn includes BOTH the purchase and the customer return (105),
    // totalBaseOut includes BOTH the sale and the supplier return (50) —
    // classification is by movementType alone, never by business label.
    expect(valuation.totalBaseIn.toString()).toBe('105');
    expect(valuation.totalBaseOut.toString()).toBe('50');

    // The structural identity this proof depends on: quantityOnHand is
    // DEFINED as totalBaseIn - totalBaseOut (src/engine/inventory-impact.ts),
    // so on-hand and sold/out populations can never overlap regardless of
    // how many distinct movement reasons (purchase, sale, return, adjustment)
    // feed into the two buckets.
    expect(valuation.quantityOnHand.toString()).toBe('55');

    const onHandAffectedUnits = valuation.quantityOnHand;
    const soldAffectedUnits = valuation.totalBaseOut;
    const totalBaseInAffected = valuation.totalBaseIn;

    const impact = buildFinancialImpact({
      inventoryValueDelta: toDecimal('1000'),
      cogsDelta: toDecimal('-1000'),
      grossProfitDelta: toDecimal('1000'),
      grossMarginPercentageDelta: ZERO,
      onHandAffectedUnits,
      soldAffectedUnits,
      totalBaseInAffected
    });

    // The reconciliation invariant is re-derived from these movement-sourced
    // figures, not asserted from hand-picked numbers — with returns mixed
    // into both directions, disjointness must still hold exactly.
    expect(impact.populationsProvenDisjoint).toBe(true);
    expect(impact.exposureMethod).toBe('DISJOINT_POPULATION_SUM');
  });
});
