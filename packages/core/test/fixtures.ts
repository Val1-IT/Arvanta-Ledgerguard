import { ACCOUNT, BASE_DATE, PRODUCT, SCENARIO, UNIT, cf, dayOffset, money, pct, qty } from './scenario-constants';
import type {
  BaselineSnapshot,
  GrossMarginReportRecord,
  InventoryMovementRecord,
  InventoryValuationRecord,
  InvestigationInput,
  JournalEntryRecord,
  ProductRecord,
  ProductUnitRecord
} from '@ledgerguard/core';

// ---------------------------------------------------------------------------
// Builds the conversion-mismatch healthy baseline as in-memory objects so
// unit tests exercise the pure engine without Postgres or application source.
// ---------------------------------------------------------------------------

export interface HealthyFixture {
  product: ProductRecord;
  productUnits: ProductUnitRecord[];
  movements: InventoryMovementRecord[];
  valuation: InventoryValuationRecord;
  journalEntries: JournalEntryRecord[];
  marginReport: GrossMarginReportRecord;
  baseline: BaselineSnapshot;
}

export function buildHealthyFixture(): HealthyFixture {
  const s = SCENARIO;
  const correctFactor = UNIT.CARTON.correctFactor;

  const baseInPerPurchase = s.cartonsPerPurchase * correctFactor;
  const totalBaseIn = s.purchaseCount * baseInPerPurchase;
  const purchaseValuePer = baseInPerPurchase * s.unitCostPerPcs;
  const totalPurchaseValue = s.purchaseCount * purchaseValuePer;

  const totalBaseOut = s.saleCount * s.pcsPerSale;
  const revenuePerSale = s.pcsPerSale * s.salePricePerPcs;
  const totalRevenue = s.saleCount * revenuePerSale;

  const averageCost = totalPurchaseValue / totalBaseIn;
  const cogsPerSale = s.pcsPerSale * averageCost;
  const totalCogs = s.saleCount * cogsPerSale;
  const quantityOnHand = totalBaseIn - totalBaseOut;
  const inventoryValue = quantityOnHand * averageCost;
  const grossProfit = totalRevenue - totalCogs;
  const grossMarginPct = (grossProfit / totalRevenue) * 100;

  const product: ProductRecord = {
    id: PRODUCT.id,
    sku: PRODUCT.sku,
    name: PRODUCT.name,
    baseUnit: PRODUCT.baseUnit,
    standardCost: money(PRODUCT.standardCost)
  };

  const productUnits: ProductUnitRecord[] = [
    {
      id: UNIT.PCS.id,
      productId: PRODUCT.id,
      unitName: UNIT.PCS.name,
      conversionFactor: cf(UNIT.PCS.factor),
      validFrom: BASE_DATE,
      updatedAt: BASE_DATE
    },
    {
      id: UNIT.CARTON.id,
      productId: PRODUCT.id,
      unitName: UNIT.CARTON.name,
      conversionFactor: cf(correctFactor),
      validFrom: BASE_DATE,
      updatedAt: BASE_DATE
    }
  ];

  const movements: InventoryMovementRecord[] = [];
  const journalEntries: JournalEntryRecord[] = [];

  for (let i = 0; i < s.purchaseCount; i++) {
    const movId = `mov-p-${String(i + 1).padStart(4, '0')}`;
    const occurredAt = dayOffset(i);
    movements.push({
      id: movId,
      productId: PRODUCT.id,
      movementType: 'in',
      quantity: qty(s.cartonsPerPurchase),
      unitName: UNIT.CARTON.name,
      baseQuantity: qty(baseInPerPurchase),
      unitCost: money(s.unitCostPerPcs),
      totalValue: money(purchaseValuePer),
      occurredAt
    });
    journalEntries.push(
      {
        id: `je-p-${i + 1}-inv`,
        sourceType: 'purchase',
        sourceId: movId,
        accountCode: ACCOUNT.INVENTORY,
        debit: money(purchaseValuePer),
        credit: '0.00',
        postedAt: occurredAt
      },
      {
        id: `je-p-${i + 1}-ap`,
        sourceType: 'purchase',
        sourceId: movId,
        accountCode: ACCOUNT.AP,
        debit: '0.00',
        credit: money(purchaseValuePer),
        postedAt: occurredAt
      }
    );
  }

  for (let i = 0; i < s.saleCount; i++) {
    const movId = `mov-s-${String(i + 1).padStart(4, '0')}`;
    const occurredAt = dayOffset(30 + i);
    movements.push({
      id: movId,
      productId: PRODUCT.id,
      movementType: 'out',
      quantity: qty(s.pcsPerSale),
      unitName: UNIT.PCS.name,
      baseQuantity: qty(s.pcsPerSale),
      unitCost: money(averageCost),
      totalValue: money(cogsPerSale),
      occurredAt
    });
    journalEntries.push(
      {
        id: `je-s-${i + 1}-ar`,
        sourceType: 'sale',
        sourceId: movId,
        accountCode: ACCOUNT.AR,
        debit: money(revenuePerSale),
        credit: '0.00',
        postedAt: occurredAt
      },
      {
        id: `je-s-${i + 1}-rev`,
        sourceType: 'sale',
        sourceId: movId,
        accountCode: ACCOUNT.SALES,
        debit: '0.00',
        credit: money(revenuePerSale),
        postedAt: occurredAt
      },
      {
        id: `je-s-${i + 1}-cogs`,
        sourceType: 'sale',
        sourceId: movId,
        accountCode: ACCOUNT.COGS,
        debit: money(cogsPerSale),
        credit: '0.00',
        postedAt: occurredAt
      },
      {
        id: `je-s-${i + 1}-inv`,
        sourceType: 'sale',
        sourceId: movId,
        accountCode: ACCOUNT.INVENTORY,
        debit: '0.00',
        credit: money(cogsPerSale),
        postedAt: occurredAt
      }
    );
  }

  const valuation: InventoryValuationRecord = {
    id: 'val-cement-40',
    productId: PRODUCT.id,
    quantityOnHand: qty(quantityOnHand),
    averageCost: money(averageCost),
    inventoryValue: money(inventoryValue),
    calculatedAt: dayOffset(66)
  };

  const marginReport: GrossMarginReportRecord = {
    id: `gmr-${s.period}`,
    period: s.period,
    revenue: money(totalRevenue),
    costOfGoodsSold: money(totalCogs),
    grossProfit: money(grossProfit),
    grossMarginPercentage: pct(grossMarginPct),
    generatedAt: dayOffset(66)
  };

  const baseline: BaselineSnapshot = {
    conversionFactor: { CARTON: correctFactor, PCS: UNIT.PCS.factor },
    movements: { totalBaseIn, totalBaseOut, quantityOnHand },
    valuation: { averageCost, inventoryValue, quantityOnHand },
    margin: {
      revenue: totalRevenue,
      costOfGoodsSold: totalCogs,
      grossProfit,
      grossMarginPercentage: Number(pct(grossMarginPct))
    },
    capturedAt: BASE_DATE
  };

  return { product, productUnits, movements, valuation, journalEntries, marginReport, baseline };
}

export function toInvestigationInput(fixture: HealthyFixture): InvestigationInput {
  return {
    products: [fixture.product],
    productUnits: fixture.productUnits,
    movements: fixture.movements,
    valuations: [fixture.valuation],
    journalEntries: fixture.journalEntries,
    marginReports: [fixture.marginReport],
    baseline: fixture.baseline
  };
}

/** Mirrors demo-data/scenarios/conversion-error.ts exactly, operating on in-memory objects. */
export function applyConversionErrorToFixture(fixture: HealthyFixture): HealthyFixture {
  const s = SCENARIO;
  const wrong = UNIT.CARTON.wrongFactor;

  const productUnits = fixture.productUnits.map((u) =>
    u.unitName === UNIT.CARTON.name ? { ...u, conversionFactor: cf(wrong), updatedAt: dayOffset(67) } : u
  );

  const totalBaseIn = s.purchaseCount * s.cartonsPerPurchase * wrong;
  const totalPurchaseValue = s.purchaseCount * s.cartonsPerPurchase * UNIT.CARTON.correctFactor * s.unitCostPerPcs;
  const totalBaseOut = s.saleCount * s.pcsPerSale;
  const totalRevenue = s.saleCount * s.pcsPerSale * s.salePricePerPcs;

  const averageCost = totalPurchaseValue / totalBaseIn;
  const quantityOnHand = totalBaseIn - totalBaseOut;
  const inventoryValue = quantityOnHand * averageCost;
  const totalCogs = totalBaseOut * averageCost;
  const grossProfit = totalRevenue - totalCogs;
  const grossMarginPct = (grossProfit / totalRevenue) * 100;

  const valuation: InventoryValuationRecord = {
    ...fixture.valuation,
    quantityOnHand: qty(quantityOnHand),
    averageCost: money(averageCost),
    inventoryValue: money(inventoryValue),
    calculatedAt: dayOffset(67)
  };

  const marginReport: GrossMarginReportRecord = {
    ...fixture.marginReport,
    costOfGoodsSold: money(totalCogs),
    grossProfit: money(grossProfit),
    grossMarginPercentage: pct(grossMarginPct),
    generatedAt: dayOffset(67)
  };

  return { ...fixture, productUnits, valuation, marginReport };
}
