import { z } from 'zod';

// ---------------------------------------------------------------------------
// Boundary schemas for raw database rows. Money/quantity/factor/percentage
// columns come back from node-postgres as decimal strings — these schemas
// validate that shape at the boundary instead of trusting it silently, per
// the "safe parsing" requirement. The engine core never touches a Pool; it
// only ever sees data already shaped like this.
// ---------------------------------------------------------------------------

const decimalString = z.string().regex(/^-?\d+(\.\d+)?$/, 'expected a plain decimal string');
const isoDate = z.union([z.date(), z.string()]).transform((v) => (v instanceof Date ? v : new Date(v)));

export const ProductRecordSchema = z.object({
  id: z.string(),
  sku: z.string(),
  name: z.string(),
  baseUnit: z.string(),
  standardCost: decimalString
});
export type ProductRecord = z.infer<typeof ProductRecordSchema>;

export const ProductUnitRecordSchema = z.object({
  id: z.string(),
  productId: z.string(),
  unitName: z.string(),
  conversionFactor: decimalString,
  validFrom: isoDate,
  updatedAt: isoDate
});
export type ProductUnitRecord = z.infer<typeof ProductUnitRecordSchema>;

export const InventoryMovementRecordSchema = z.object({
  id: z.string(),
  productId: z.string(),
  movementType: z.enum(['in', 'out']),
  quantity: decimalString,
  unitName: z.string(),
  baseQuantity: decimalString,
  unitCost: decimalString,
  totalValue: decimalString,
  occurredAt: isoDate
});
export type InventoryMovementRecord = z.infer<typeof InventoryMovementRecordSchema>;

export const InventoryValuationRecordSchema = z.object({
  id: z.string(),
  productId: z.string(),
  quantityOnHand: decimalString,
  averageCost: decimalString,
  inventoryValue: decimalString,
  calculatedAt: isoDate
});
export type InventoryValuationRecord = z.infer<typeof InventoryValuationRecordSchema>;

export const JournalEntryRecordSchema = z.object({
  id: z.string(),
  sourceType: z.string(),
  sourceId: z.string(),
  accountCode: z.string(),
  debit: decimalString,
  credit: decimalString,
  postedAt: isoDate
});
export type JournalEntryRecord = z.infer<typeof JournalEntryRecordSchema>;

export const GrossMarginReportRecordSchema = z.object({
  id: z.string(),
  period: z.string(),
  revenue: decimalString,
  costOfGoodsSold: decimalString,
  grossProfit: decimalString,
  grossMarginPercentage: decimalString,
  generatedAt: isoDate
});
export type GrossMarginReportRecord = z.infer<typeof GrossMarginReportRecordSchema>;

// The JSON payload captured once at seed time into baseline_snapshot.value_json.
// conversionFactor is keyed by unit name; this demo has a single product, so it
// is not further keyed by productId (documented limitation, see architecture doc).
export const BaselineSnapshotSchema = z.object({
  conversionFactor: z.record(z.string(), z.number()),
  movements: z.object({
    totalBaseIn: z.number(),
    totalBaseOut: z.number(),
    quantityOnHand: z.number()
  }),
  valuation: z.object({
    averageCost: z.number(),
    inventoryValue: z.number(),
    quantityOnHand: z.number()
  }),
  margin: z.object({
    revenue: z.number(),
    costOfGoodsSold: z.number(),
    grossProfit: z.number(),
    grossMarginPercentage: z.number()
  })
});
export type BaselineSnapshot = z.infer<typeof BaselineSnapshotSchema>;

// ---------------------------------------------------------------------------
// Pure-engine input. Everything the deterministic core needs, already fetched.
// No Pool, no Drizzle client, no HTTP, no DataHub, no LLM — just data.
// ---------------------------------------------------------------------------

export interface InvestigationInput {
  products: ProductRecord[];
  productUnits: ProductUnitRecord[];
  movements: InventoryMovementRecord[];
  valuations: InventoryValuationRecord[];
  journalEntries: JournalEntryRecord[];
  marginReports: GrossMarginReportRecord[];
  baseline: BaselineSnapshot;
}

// Quality checks only need the slice of InvestigationInput relevant to
// structural/consistency evaluation — same shape, kept as an alias so check
// implementations declare their real dependency rather than "the whole input".
export type QualityCheckInput = InvestigationInput;

// ---------------------------------------------------------------------------
// Evidence model — every finding must be traceable to a table/record/field.
// ---------------------------------------------------------------------------

export const EvidenceItemSchema = z.object({
  table: z.string(),
  recordId: z.string(),
  field: z.string(),
  expectedValue: z.string(),
  actualValue: z.string(),
  delta: z.string(),
  reason: z.string()
});
export type EvidenceItem = z.infer<typeof EvidenceItemSchema>;

// ---------------------------------------------------------------------------
// Root cause
// ---------------------------------------------------------------------------

export const RootCauseSchema = z.object({
  asset: z.literal('product_units'),
  field: z.literal('conversion_factor'),
  productId: z.string(),
  unitId: z.string(),
  unitName: z.string(),
  expectedValue: z.string(),
  actualValue: z.string(),
  delta: z.string()
});
export type RootCause = z.infer<typeof RootCauseSchema>;

// ---------------------------------------------------------------------------
// Affected records / blast radius
// ---------------------------------------------------------------------------

export const AffectedRecordsSchema = z.object({
  inventoryMovements: z.array(z.string()),
  inventoryValuations: z.array(z.string()),
  journalEntries: z.array(z.string()),
  reports: z.array(z.string())
});
export type AffectedRecords = z.infer<typeof AffectedRecordsSchema>;

export const AssetRoleSchema = z.enum(['root_cause', 'requires_correction', 'evidence_only']);
export type AssetRole = z.infer<typeof AssetRoleSchema>;

export const AffectedAssetSchema = z.object({
  asset: z.string(),
  role: AssetRoleSchema,
  recordCount: z.number().int().nonnegative()
});
export type AffectedAsset = z.infer<typeof AffectedAssetSchema>;

export const BlastRadiusSchema = z.object({
  affectedAssetCount: z.number().int().nonnegative(),
  affectedRecordCount: z.number().int().nonnegative(),
  assets: z.array(AffectedAssetSchema)
});
export type BlastRadius = z.infer<typeof BlastRadiusSchema>;

// ---------------------------------------------------------------------------
// Financial impact. See src/engine/financial-exposure.ts for the formula and
// docs/architecture/financial-integrity-engine.md for the full rationale.
// ---------------------------------------------------------------------------

export const FinancialImpactSchema = z.object({
  inventoryValueDelta: z.string(),
  cogsDelta: z.string(),
  grossProfitDelta: z.string(),
  grossMarginPercentageDelta: z.string(),
  totalExposure: z.string(),
  currency: z.literal('IDR')
});
export type FinancialImpact = z.infer<typeof FinancialImpactSchema>;

// ---------------------------------------------------------------------------
// Quality checks
// ---------------------------------------------------------------------------

export const QualityCheckStatusSchema = z.enum(['PASS', 'FAIL']);
export type QualityCheckStatus = z.infer<typeof QualityCheckStatusSchema>;

export const QualityCheckSeveritySchema = z.enum(['info', 'warning', 'critical']);
export type QualityCheckSeverity = z.infer<typeof QualityCheckSeveritySchema>;

export const QualityCheckResultSchema = z.object({
  checkId: z.string(),
  status: QualityCheckStatusSchema,
  severity: QualityCheckSeveritySchema,
  expected: z.string(),
  actual: z.string(),
  affectedRecordIds: z.array(z.string()),
  evidence: z.array(EvidenceItemSchema),
  remediationHint: z.string()
});
export type QualityCheckResult = z.infer<typeof QualityCheckResultSchema>;

export interface QualityCheckEvaluator {
  readonly checkId: string;
  evaluate(input: QualityCheckInput): QualityCheckResult;
}

// ---------------------------------------------------------------------------
// Remediation preview (FASE 4 output only — no execution until FASE 6).
// ---------------------------------------------------------------------------

export const ProposedCorrectionActionSchema = z.enum([
  'RESTORE_CONVERSION_FACTOR',
  'RECOMPUTE_INVENTORY_MOVEMENT',
  'REGENERATE_INVENTORY_VALUATION',
  'REGENERATE_GROSS_MARGIN_REPORT',
  'RECONCILE_JOURNAL_ENTRIES'
]);
export type ProposedCorrectionAction = z.infer<typeof ProposedCorrectionActionSchema>;

export const ProposedCorrectionSchema = z.object({
  sequence: z.number().int().positive(),
  action: ProposedCorrectionActionSchema,
  table: z.string(),
  recordId: z.string(),
  field: z.string(),
  beforeValue: z.string(),
  afterValue: z.string(),
  financialDelta: z.string().nullable(),
  rollbackAssumption: z.string()
});
export type ProposedCorrection = z.infer<typeof ProposedCorrectionSchema>;

export const VerificationExpectationSchema = z.object({
  checkId: z.string(),
  expectedStatus: QualityCheckStatusSchema,
  description: z.string()
});
export type VerificationExpectation = z.infer<typeof VerificationExpectationSchema>;

export const VerificationResultSchema = z.object({
  overallStatus: QualityCheckStatusSchema,
  checks: z.array(QualityCheckResultSchema)
});
export type VerificationResult = z.infer<typeof VerificationResultSchema>;

// ---------------------------------------------------------------------------
// Full report
// ---------------------------------------------------------------------------

export const IncidentTypeSchema = z.enum(['HEALTHY', 'UNIT_CONVERSION_MISMATCH']);
export type IncidentType = z.infer<typeof IncidentTypeSchema>;

export const IncidentInvestigationReportSchema = z.object({
  incidentType: IncidentTypeSchema,
  rootCause: RootCauseSchema.nullable(),
  affectedRecords: AffectedRecordsSchema,
  blastRadius: BlastRadiusSchema,
  financialImpact: FinancialImpactSchema,
  evidence: z.array(EvidenceItemSchema),
  qualityChecks: z.array(QualityCheckResultSchema),
  proposedCorrections: z.array(ProposedCorrectionSchema),
  verificationExpectations: z.array(VerificationExpectationSchema)
});
export type IncidentInvestigationReport = z.infer<typeof IncidentInvestigationReportSchema>;
