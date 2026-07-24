import { sql } from 'drizzle-orm';
import {
  integer,
  numeric,
  pgTable,
  text,
  timestamp
} from 'drizzle-orm/pg-core';

// ---------------------------------------------------------------------------
// Demo ERP domain tables. Deterministic synthetic data only.
// Money columns use numeric(18,2); quantities numeric(18,3); conversion factor
// numeric(12,4). numeric values are returned as strings by node-postgres and
// converted with Number()/toNumber helpers at the edges.
// ---------------------------------------------------------------------------

export const products = pgTable('products', {
  id: text('id').primaryKey(),
  sku: text('sku').notNull().unique(),
  name: text('name').notNull(),
  baseUnit: text('base_unit').notNull(),
  standardCost: numeric('standard_cost', { precision: 18, scale: 2 }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull()
});

export const productUnits = pgTable('product_units', {
  id: text('id').primaryKey(),
  productId: text('product_id')
    .notNull()
    .references(() => products.id),
  unitName: text('unit_name').notNull(),
  conversionFactor: numeric('conversion_factor', { precision: 12, scale: 4 }).notNull(),
  validFrom: timestamp('valid_from', { withTimezone: true }).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull()
});

export const inventoryMovements = pgTable('inventory_movements', {
  id: text('id').primaryKey(),
  productId: text('product_id')
    .notNull()
    .references(() => products.id),
  movementType: text('movement_type').notNull(), // 'in' | 'out'
  quantity: numeric('quantity', { precision: 18, scale: 3 }).notNull(),
  unitName: text('unit_name').notNull(),
  baseQuantity: numeric('base_quantity', { precision: 18, scale: 3 }).notNull(),
  unitCost: numeric('unit_cost', { precision: 18, scale: 2 }).notNull(),
  totalValue: numeric('total_value', { precision: 18, scale: 2 }).notNull(),
  occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull()
});

export const inventoryValuation = pgTable('inventory_valuation', {
  id: text('id').primaryKey(),
  productId: text('product_id')
    .notNull()
    .references(() => products.id),
  quantityOnHand: numeric('quantity_on_hand', { precision: 18, scale: 3 }).notNull(),
  averageCost: numeric('average_cost', { precision: 18, scale: 2 }).notNull(),
  inventoryValue: numeric('inventory_value', { precision: 18, scale: 2 }).notNull(),
  calculatedAt: timestamp('calculated_at', { withTimezone: true }).notNull()
});

export const journalEntries = pgTable('journal_entries', {
  id: text('id').primaryKey(),
  sourceType: text('source_type').notNull(), // 'purchase' | 'sale'
  sourceId: text('source_id').notNull(),
  accountCode: text('account_code').notNull(),
  debit: numeric('debit', { precision: 18, scale: 2 }).notNull(),
  credit: numeric('credit', { precision: 18, scale: 2 }).notNull(),
  postedAt: timestamp('posted_at', { withTimezone: true }).notNull()
});

export const grossMarginReport = pgTable('gross_margin_report', {
  id: text('id').primaryKey(),
  period: text('period').notNull(),
  revenue: numeric('revenue', { precision: 18, scale: 2 }).notNull(),
  costOfGoodsSold: numeric('cost_of_goods_sold', { precision: 18, scale: 2 }).notNull(),
  grossProfit: numeric('gross_profit', { precision: 18, scale: 2 }).notNull(),
  grossMarginPercentage: numeric('gross_margin_percentage', { precision: 7, scale: 4 }).notNull(),
  generatedAt: timestamp('generated_at', { withTimezone: true }).notNull()
});

// Canonical correct baseline, captured at seed time. Used by reset and by the
// financial engine as the "expected" reference once live data is corrupted.
export const baselineSnapshot = pgTable('baseline_snapshot', {
  key: text('key').primaryKey(),
  valueJson: text('value_json').notNull(),
  capturedAt: timestamp('captured_at', { withTimezone: true }).notNull()
});

// ---------------------------------------------------------------------------
// LedgerGuard operational tables (runtime).
// ---------------------------------------------------------------------------

export const ledgerguardIncidents = pgTable('ledgerguard_incidents', {
  id: text('id')
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  incidentType: text('incident_type').notNull(),
  severity: text('severity').notNull(),
  status: text('status').notNull(),
  rootAsset: text('root_asset').notNull(),
  detectedAt: timestamp('detected_at', { withTimezone: true }).notNull(),
  resolvedAt: timestamp('resolved_at', { withTimezone: true })
});

export const investigationRuns = pgTable('investigation_runs', {
  id: text('id')
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  incidentId: text('incident_id')
    .notNull()
    .references(() => ledgerguardIncidents.id),
  rootCause: text('root_cause'),
  affectedAssetCount: integer('affected_asset_count'),
  affectedRecordCount: integer('affected_record_count'),
  estimatedFinancialExposure: numeric('estimated_financial_exposure', {
    precision: 18,
    scale: 2
  }),
  confidence: numeric('confidence', { precision: 5, scale: 4 }),
  resultJson: text('result_json'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull()
});

export const remediationPlans = pgTable('remediation_plans', {
  id: text('id')
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  incidentId: text('incident_id')
    .notNull()
    .references(() => ledgerguardIncidents.id),
  status: text('status').notNull(),
  proposedActions: text('proposed_actions'),
  remediationSql: text('remediation_sql'),
  approvedBy: text('approved_by'),
  approvedAt: timestamp('approved_at', { withTimezone: true }),
  executedAt: timestamp('executed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull()
});

export type ProductRow = typeof products.$inferSelect;
export type ProductUnitRow = typeof productUnits.$inferSelect;
export type InventoryMovementRow = typeof inventoryMovements.$inferSelect;
