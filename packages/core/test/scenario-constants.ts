// Synthetic conversion-mismatch figures for core engine tests only.
// Keep numeric values aligned with the demo constants in src/domain/constants.ts
// so investigate() unit tests match the seeded conversion-mismatch scenario.
// Core must not import application source.

export const PRODUCT = {
  id: 'prod-cement-40',
  sku: 'CEM-40',
  name: 'Cement Premium 40kg',
  baseUnit: 'PCS',
  standardCost: 50_000
} as const;

export const UNIT = {
  PCS: { id: 'pu-pcs', name: 'PCS', factor: 1 },
  CARTON: { id: 'pu-carton', name: 'CARTON', correctFactor: 12, wrongFactor: 10 }
} as const;

export const ACCOUNT = {
  AR: '1110',
  INVENTORY: '1140',
  AP: '2110',
  SALES: '4110',
  COGS: '5110'
} as const;

export const SCENARIO = {
  period: '2026-01',
  purchaseCount: 24,
  cartonsPerPurchase: 10,
  unitCostPerPcs: 50_000,
  saleCount: 36,
  pcsPerSale: 40,
  salePricePerPcs: 75_000
} as const;

export const BASE_DATE = new Date('2026-01-01T00:00:00.000Z');

export function dayOffset(days: number): Date {
  return new Date(BASE_DATE.getTime() + days * 24 * 60 * 60 * 1000);
}

export const money = (n: number): string => n.toFixed(2);
export const qty = (n: number): string => n.toFixed(3);
export const cf = (n: number): string => n.toFixed(4);
export const pct = (n: number): string => n.toFixed(4);
