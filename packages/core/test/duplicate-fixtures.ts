import type {
  BaselineSnapshot,
  InventoryMovementRecord,
  InventoryValuationRecord,
  InvestigationInput,
  ProductRecord,
  ProductUnitRecord,
  PurchaseReceiptRecord
} from '../src/types';

const capturedAt = new Date('2026-03-01T09:00:00.000Z');
const receivedAt = new Date('2026-03-02T14:15:00.000Z');
const duplicateAt = new Date('2026-03-02T14:15:00.250Z');

export const DUPLICATE_UNIT_COST = '85000.00';
export const DUPLICATE_QTY = '10.000';

export function duplicateReceipt(): PurchaseReceiptRecord {
  return {
    id: 'RCP-001',
    number: 'RCP-001',
    purchaseOrderId: 'PO-001',
    productId: 'ITEM-001',
    quantity: DUPLICATE_QTY,
    receivedAt
  };
}

export function duplicateItem(): ProductRecord {
  return {
    id: 'ITEM-001',
    sku: 'WDG-001',
    name: 'Industrial Widget',
    baseUnit: 'PCS',
    standardCost: DUPLICATE_UNIT_COST
  };
}

export function duplicateUnit(): ProductUnitRecord {
  return {
    id: 'pu-item-001-pcs',
    productId: 'ITEM-001',
    unitName: 'PCS',
    conversionFactor: '1.0000',
    validFrom: capturedAt,
    updatedAt: capturedAt
  };
}

function movement(id: string, occurredAt: Date): InventoryMovementRecord {
  return {
    id,
    productId: 'ITEM-001',
    movementType: 'in',
    quantity: DUPLICATE_QTY,
    unitName: 'PCS',
    baseQuantity: DUPLICATE_QTY,
    unitCost: DUPLICATE_UNIT_COST,
    totalValue: '850000.00',
    occurredAt,
    sourceReceiptId: 'RCP-001',
    eventIdentity: 'receipt:RCP-001:ITEM-001',
    reversedAt: null,
    reversesId: null
  };
}

export function duplicateBrokenValuation(): InventoryValuationRecord {
  return {
    id: 'val-item-001',
    productId: 'ITEM-001',
    quantityOnHand: '20.000',
    averageCost: DUPLICATE_UNIT_COST,
    inventoryValue: '1700000.00',
    calculatedAt: duplicateAt
  };
}

export function duplicateBaseline(): BaselineSnapshot {
  return {
    conversionFactor: { PCS: 1 },
    movements: { totalBaseIn: 10, totalBaseOut: 0, quantityOnHand: 10 },
    valuation: { averageCost: 85000, inventoryValue: 850000, quantityOnHand: 10 },
    margin: { revenue: 0, costOfGoodsSold: 0, grossProfit: 0, grossMarginPercentage: 0 },
    capturedAt
  };
}

export function duplicateIncidentInput(overrides: Partial<InvestigationInput> = {}): InvestigationInput {
  return {
    products: [duplicateItem()],
    productUnits: [duplicateUnit()],
    movements: [movement('MOV-001', receivedAt), movement('MOV-002', duplicateAt)],
    valuations: [duplicateBrokenValuation()],
    journalEntries: [],
    marginReports: [],
    receipts: [duplicateReceipt()],
    baseline: duplicateBaseline(),
    ...overrides
  };
}
