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
  occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
  sourceReceiptId: text('source_receipt_id'),
  eventIdentity: text('event_identity'),
  reversedAt: timestamp('reversed_at', { withTimezone: true }),
  reversesId: text('reverses_id')
});

export const purchaseOrders = pgTable('purchase_orders', {
  id: text('id').primaryKey(),
  number: text('number').notNull(),
  vendorName: text('vendor_name').notNull(),
  productId: text('product_id').notNull(),
  quantity: numeric('quantity', { precision: 18, scale: 3 }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull()
});

export const purchaseReceipts = pgTable('purchase_receipts', {
  id: text('id').primaryKey(),
  number: text('number').notNull(),
  purchaseOrderId: text('purchase_order_id').notNull(),
  productId: text('product_id').notNull(),
  quantity: numeric('quantity', { precision: 18, scale: 3 }).notNull(),
  receivedAt: timestamp('received_at', { withTimezone: true }).notNull()
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

// FASE 5 — DataHub-aware investigation agent run record (src/agent/orchestrator.ts).
// incidentId is caller-supplied (InvestigationAgentInput) and is NOT required to
// pre-exist in ledgerguard_incidents, so there is deliberately no FK here — a
// TEST-mode or example-generation run can use any incident identifier.
// input/output/error/stateHistory are the exact InvestigationRunRecord slices
// (src/agent/types.ts), stored as JSON text the same way baseline_snapshot
// stores value_json elsewhere in this file. Never store chain-of-thought here —
// only the already-schema-validated, reconciled InvestigationOutput.
export const investigationRuns = pgTable('investigation_runs', {
  id: text('id').primaryKey(),
  incidentId: text('incident_id').notNull(),
  productId: text('product_id').notNull(),
  triggerAsset: text('trigger_asset').notNull(),
  requestedBy: text('requested_by').notNull(),
  mode: text('mode').notNull(),
  finalState: text('final_state').notNull(),
  status: text('status'),
  inputJson: text('input_json').notNull(),
  outputJson: text('output_json'),
  errorJson: text('error_json'),
  stateHistoryJson: text('state_history_json').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull()
});

// FASE 6 — approval + verified remediation workflow (src/remediation/*).
// investigationId references investigation_runs.id, where the reconciled
// engineResultReference/DataHub context from FASE 5 live; incidentId/
// productId/triggerAsset/requestedBy are denormalized from that same
// investigation for convenient querying, mirroring investigationRuns' own
// denormalization pattern above. Deliberately no FK to either
// investigationRuns or ledgerguardIncidents, for the same TEST-mode
// flexibility reason investigationRuns itself has none. `version` backs
// optimistic-concurrency checks on every state transition (see
// src/remediation/types.ts's ALLOWED_TRANSITIONS). proposedCorrections/
// verificationExpectations are a snapshot taken at plan-generation time
// (src/remediation/generate-plan.ts) — a verbatim copy of a real
// IncidentInvestigationReport's fields, never hand-authored or LLM-authored.
export const remediationPlans = pgTable('remediation_plans', {
  id: text('id').primaryKey(),
  investigationId: text('investigation_id').notNull(),
  incidentId: text('incident_id').notNull(),
  productId: text('product_id').notNull(),
  triggerAsset: text('trigger_asset').notNull(),
  requestedBy: text('requested_by').notNull(),

  state: text('state').notNull(),
  version: integer('version').notNull().default(1),

  proposedCorrectionsJson: text('proposed_corrections_json').notNull(),
  verificationExpectationsJson: text('verification_expectations_json').notNull(),

  approvalAction: text('approval_action'),
  approvedBy: text('approved_by'),
  approvalNote: text('approval_note'),
  approvedAt: timestamp('approved_at', { withTimezone: true }),

  executionResultJson: text('execution_result_json'),
  executedAt: timestamp('executed_at', { withTimezone: true }),

  verificationJson: text('verification_json'),

  datahubWritebackJson: text('datahub_writeback_json'),

  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull()
});

export const ledgerguardExecutionKeys = pgTable('ledgerguard_execution_keys', {
  key: text('key').primaryKey(),
  planId: text('plan_id').notNull(),
  planVersion: integer('plan_version').notNull(),
  state: text('state').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  resultJson: text('result_json'),
  leaseExpiresAt: timestamp('lease_expires_at', { withTimezone: true })
});

export const ledgerguardExecutionJournal = pgTable('ledgerguard_execution_journal', {
  id: text('id').primaryKey(),
  idempotencyKey: text('idempotency_key').notNull(),
  planId: text('plan_id').notNull(),
  planVersion: integer('plan_version').notNull(),
  status: text('status').notNull(),
  sourceStateFingerprint: text('source_state_fingerprint').notNull(),
  receiptJson: text('receipt_json').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull()
});

export type ProductRow = typeof products.$inferSelect;
export type ProductUnitRow = typeof productUnits.$inferSelect;
export type InventoryMovementRow = typeof inventoryMovements.$inferSelect;
