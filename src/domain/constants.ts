// Deterministic constants for the single primary demo scenario.
// Every figure below is fixed so the healthy baseline, the conversion-error
// state, and the resulting financial exposure are fully reproducible.

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

// Chart of accounts (demo).
export const ACCOUNT = {
  AR: '1110', // Accounts Receivable
  INVENTORY: '1140',
  AP: '2110', // Accounts Payable
  SALES: '4110',
  COGS: '5110'
} as const;

// Scenario volumes.
export const SCENARIO = {
  period: '2026-01',
  purchaseCount: 24, // CARTON inbound movements
  cartonsPerPurchase: 10, // cartons per purchase
  unitCostPerPcs: 50_000, // real cost basis per PCS
  saleCount: 36, // PCS outbound movements
  pcsPerSale: 40,
  salePricePerPcs: 75_000
} as const;

// Deterministic timestamps (no wall-clock reads in seed/scenario).
export const BASE_DATE = new Date('2026-01-01T00:00:00.000Z');

export function dayOffset(days: number): Date {
  return new Date(BASE_DATE.getTime() + days * 24 * 60 * 60 * 1000);
}

// numeric() formatting helpers — node-postgres round-trips numeric as strings.
export const money = (n: number): string => n.toFixed(2);
export const qty = (n: number): string => n.toFixed(3);
export const cf = (n: number): string => n.toFixed(4);
export const pct = (n: number): string => n.toFixed(4);
