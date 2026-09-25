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
  occurredAt: isoDate,
  sourceReceiptId: z.string().nullable().optional(),
  eventIdentity: z.string().nullable().optional(),
  reversedAt: z.union([isoDate, z.null()]).optional(),
  reversesId: z.string().nullable().optional()
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
// capturedAt comes from the baseline_snapshot.captured_at column (not the JSON
// blob itself) — it is the provenance timestamp for every "expected" value the
// engine cites as the reference point once live data has diverged from it.
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
  }),
  capturedAt: isoDate
});
export type BaselineSnapshot = z.infer<typeof BaselineSnapshotSchema>;

// ---------------------------------------------------------------------------
// Pure-engine input. Everything the deterministic core needs, already fetched.
// No Pool, no Drizzle client, no HTTP, no DataHub, no LLM — just data.
// ---------------------------------------------------------------------------

export const PurchaseReceiptRecordSchema = z.object({
  id: z.string(),
  number: z.string(),
  purchaseOrderId: z.string(),
  productId: z.string(),
  quantity: decimalString,
  receivedAt: isoDate
});
export type PurchaseReceiptRecord = z.infer<typeof PurchaseReceiptRecordSchema>;

export interface InvestigationInput {
  products: ProductRecord[];
  productUnits: ProductUnitRecord[];
  movements: InventoryMovementRecord[];
  valuations: InventoryValuationRecord[];
  journalEntries: JournalEntryRecord[];
  marginReports: GrossMarginReportRecord[];
  receipts?: PurchaseReceiptRecord[];
  baseline: BaselineSnapshot;
  /**
   * Account code whose debit−credit net is treated as posted COGS.
   * When omitted, investigate() uses CONVERSION_MISMATCH_EXAMPLE.cogsAccountCode
   * so the existing conversion-mismatch scenario stays compatible.
   */
  cogsAccountCode?: string;
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

// Provenance for `expectedValue`: where it came from, and as-of when it was
// true, so the engine can explain *why* the expected value is trusted rather
// than asserting it as a bare number. MVP sources this from baseline_snapshot
// only (see docs/architecture/financial-integrity-engine.md); a future
// multi-version product_units history could add a 'product_unit_record' type.
export const ExpectedValueSourceSchema = z.object({
  type: z.string().min(1),
  recordId: z.string(),
  capturedAt: isoDate,
  evidenceReference: z.string()
});
export type ExpectedValueSource = z.infer<typeof ExpectedValueSourceSchema>;

export const RootCauseSchema = z.object({
  asset: z.string().min(1),
  field: z.string().min(1),
  productId: z.string(),
  unitId: z.string(),
  unitName: z.string(),
  expectedValue: z.string(),
  actualValue: z.string(),
  delta: z.string(),
  expectedValueSource: ExpectedValueSourceSchema
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
// Record-impact classification. Distinct from blastRadius (which counts at
// asset/table granularity): this classifies individual records into what
// happens to them, so a UI or remediation step never has to guess whether a
// record is proof, a mutation target, or neither. See
// src/engine/record-impact.ts and docs/architecture/financial-integrity-engine.md.
// ---------------------------------------------------------------------------

export const RecordRefSchema = z.object({
  table: z.string(),
  recordId: z.string()
});
export type RecordRef = z.infer<typeof RecordRefSchema>;

export const RecordImpactSchema = z.object({
  evidenceRecords: z.array(RecordRefSchema),
  correctionTargets: z.array(RecordRefSchema),
  downstreamAffectedRecords: z.array(RecordRefSchema),
  evidenceRecordCount: z.number().int().nonnegative(),
  correctionTargetCount: z.number().int().nonnegative(),
  downstreamAffectedRecordCount: z.number().int().nonnegative(),
  uniqueRecordCount: z.number().int().nonnegative()
});
export type RecordImpact = z.infer<typeof RecordImpactSchema>;

// ---------------------------------------------------------------------------
// Financial impact. See src/engine/financial-exposure.ts for the formula and
// docs/architecture/financial-integrity-engine.md for the full rationale.
//
// primaryExposure is the single dollar figure a business would report as "how
// much is wrong" — never a sum of statement lines that describe the same
// misstatement twice. inventoryValueDelta (balance-sheet, on-hand units) and
// cogsDelta (income-statement, already-sold units) are proven disjoint by the
// reconciliationInvariant (on-hand + sold = correct total base-in), so they
// are genuinely two distinct misstatements and primaryExposure sums their
// absolute components. grossProfitDelta is NOT included anywhere in
// primaryExposure: it is mathematically -cogsDelta by construction (revenue is
// never touched by this incident type), so it is a restatement of the same
// number, not independent exposure. grossStatementFootprint is the raw sum of
// every statement line's absolute movement (including grossProfitDelta) —
// useful for "how many statement lines moved and by how much in total"
// transparency, but must never be read as "the" exposure figure.
// ---------------------------------------------------------------------------

export const ExposureMethodSchema = z.enum(['DISJOINT_POPULATION_SUM', 'MAX_STATEMENT_LINE']);
export type ExposureMethod = z.infer<typeof ExposureMethodSchema>;

export const FinancialImpactSchema = z.object({
  inventoryValueDelta: z.string(),
  cogsDelta: z.string(),
  grossProfitDelta: z.string(),
  grossMarginPercentageDelta: z.string(),
  onHandAffectedUnits: z.string(),
  soldAffectedUnits: z.string(),
  inventoryExposureComponent: z.string(),
  realizedCogsExposureComponent: z.string(),
  populationsProvenDisjoint: z.boolean(),
  reconciliationInvariant: z.string(),
  exposureMethod: ExposureMethodSchema,
  primaryExposure: z.string(),
  grossStatementFootprint: z.string(),
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
  'RECONCILE_JOURNAL_ENTRIES',
  'REVERSE_INVENTORY_MOVEMENT'
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

// incidentType names a *specific detected incident category*, or null when no
// incident was detected — it is never used to say "everything is fine"
// (that is overallStatus's job). Today there is exactly one incident category;
// more will be added to this enum as new detectors are built.
export const IncidentTypeSchema = z.enum(['UNIT_CONVERSION_MISMATCH', 'DUPLICATE_INVENTORY_MOVEMENT']).nullable();
export type IncidentType = z.infer<typeof IncidentTypeSchema>;

// overallStatus is the system's aggregate health, derived from qualityChecks
// severities and independent of whether a *named* incidentType was detected —
// a pre-existing structural problem (e.g. an unbalanced journal with no
// conversion-factor incident) can degrade or critically fail overallStatus
// while incidentType stays null. Do not confuse this with
// VerificationResult.overallStatus (src/engine/verify.ts), which is an
// unrelated PASS/FAIL result for post-remediation re-checks.
export const OverallHealthStatusSchema = z.enum(['HEALTHY', 'DEGRADED', 'CRITICAL']);
export type OverallHealthStatus = z.infer<typeof OverallHealthStatusSchema>;

export const IncidentInvestigationReportSchema = z.object({
  incidentType: IncidentTypeSchema,
  overallStatus: OverallHealthStatusSchema,
  rootCause: RootCauseSchema.nullable(),
  affectedRecords: AffectedRecordsSchema,
  blastRadius: BlastRadiusSchema,
  recordImpact: RecordImpactSchema,
  financialImpact: FinancialImpactSchema,
  evidence: z.array(EvidenceItemSchema),
  qualityChecks: z.array(QualityCheckResultSchema),
  proposedCorrections: z.array(ProposedCorrectionSchema),
  verificationExpectations: z.array(VerificationExpectationSchema)
});
export type IncidentInvestigationReport = z.infer<typeof IncidentInvestigationReportSchema>;
