import { z } from 'zod';
import { IncidentTypeSchema, OverallHealthStatusSchema, RecordRefSchema } from '@ledgerguard/core';

// ---------------------------------------------------------------------------
// FASE 5 — DataHub-aware investigation agent. Types only: no I/O, no engine
// logic, no MCP calls here. Every schema below is the contract the
// orchestrator (src/agent/orchestrator.ts) enforces at each boundary —
// client input, model output (untrusted), and the final validated output
// that gets persisted and written back to DataHub.
//
// Division of responsibility (see docs/architecture/investigation-agent.md):
//   - the deterministic engine (src/engine/*) owns every numeric figure,
//     record ID, and classification;
//   - DataHub MCP owns schema/owners/tags/glossary/lineage/metadata;
//   - the model (src/agent/model.ts) owns explanation, planning, and
//     evidence-sufficiency judgment — it may only CITE facts it was given,
//     never invent one. The "cited*" fields below exist so the reconciliation
//     layer (src/agent/reconciliation.ts) can verify every citation against
//     the engine result and the real MCP context before anything is trusted.
// ---------------------------------------------------------------------------

export const SCHEMA_VERSION = '1.0' as const;

// ---------------------------------------------------------------------------
// Input (client-facing). Deliberately carries no financial figures — the
// agent fetches incident state and financial data from the database itself
// (see loadInvestigationInput / ledgerguard_incidents), never trusting
// numbers supplied by the caller.
// ---------------------------------------------------------------------------

export const InvestigationModeSchema = z.enum(['LIVE', 'TEST']);
export type InvestigationMode = z.infer<typeof InvestigationModeSchema>;

export const InvestigationAgentInputSchema = z.object({
  incidentId: z.string().min(1),
  productId: z.string().min(1),
  triggerAsset: z.string().min(1),
  requestedBy: z.string().min(1),
  mode: InvestigationModeSchema
});
export type InvestigationAgentInput = z.infer<typeof InvestigationAgentInputSchema>;

// ---------------------------------------------------------------------------
// Workflow state machine (13 success states + 7 failure states). The
// orchestrator transitions through these in order and persists every
// transition — a failure state is a first-class outcome, never converted
// into a fake COMPLETED.
// ---------------------------------------------------------------------------

export const WorkflowStateSchema = z.enum([
  'INCIDENT_RECEIVED',
  'ENGINE_ANALYSIS_STARTED',
  'ENGINE_ANALYSIS_COMPLETED',
  'DATAHUB_ASSET_SEARCH',
  'DATAHUB_SCHEMA_READ',
  'DATAHUB_OWNER_READ',
  'DATAHUB_GLOSSARY_READ',
  'DATAHUB_LINEAGE_TRAVERSED',
  'EVIDENCE_RECONCILED',
  'MODEL_ANALYSIS_STARTED',
  'MODEL_ANALYSIS_VALIDATED',
  'INVESTIGATION_SUMMARY_WRITTEN',
  'INVESTIGATION_COMPLETED'
]);
export type WorkflowState = z.infer<typeof WorkflowStateSchema>;

export const FailureStateSchema = z.enum([
  'MCP_UNAVAILABLE',
  'DATASET_NOT_FOUND',
  'LINEAGE_INCOMPLETE',
  'ENGINE_FAILED',
  'MODEL_OUTPUT_INVALID',
  'EVIDENCE_INSUFFICIENT',
  'WRITEBACK_FAILED'
]);
export type FailureState = z.infer<typeof FailureStateSchema>;

export const RecommendedNextStepSchema = z.enum([
  'REQUEST_APPROVAL',
  'COLLECT_MORE_EVIDENCE',
  'ESCALATE_TO_OWNER',
  'NO_ACTION_REQUIRED'
]);
export type RecommendedNextStep = z.infer<typeof RecommendedNextStepSchema>;

export const InvestigationStatusSchema = z.enum(['COMPLETED', 'NEEDS_REVIEW', 'FAILED']);
export type InvestigationStatus = z.infer<typeof InvestigationStatusSchema>;

// ---------------------------------------------------------------------------
// Activity log — one entry per tool call (engine run, each MCP call, model
// call, write-back). Never carries a token, credential, or raw environment
// value; inputSummary/outputSummary are truncated, sanitized text.
// ---------------------------------------------------------------------------

export const ActivityLogStatusSchema = z.enum(['OK', 'ERROR']);
export type ActivityLogStatus = z.infer<typeof ActivityLogStatusSchema>;

export const ActivityLogEntrySchema = z.object({
  seq: z.number().int().nonnegative(),
  tool: z.string(),
  startedAt: z.string(),
  finishedAt: z.string(),
  durationMs: z.number().int().nonnegative(),
  inputSummary: z.string(),
  outputSummary: z.string(),
  status: ActivityLogStatusSchema,
  errorSanitized: z.string().nullable()
});
export type ActivityLogEntry = z.infer<typeof ActivityLogEntrySchema>;

// ---------------------------------------------------------------------------
// DataHub context — authoritative, built by the orchestrator directly from
// real MCP responses (src/agent/datahub-client.ts). The model never
// generates this; it only cites a subset of it (see ModelInvestigationOutput
// below), and the reconciliation layer checks every citation lands inside
// this set before the investigation is allowed to complete.
// ---------------------------------------------------------------------------

export const DataHubContextSchema = z.object({
  assetsRead: z.array(z.string()),
  owners: z.array(z.string()),
  glossaryTerms: z.array(z.string()),
  tags: z.array(z.string()),
  lineagePath: z.array(z.string())
});
export type DataHubContext = z.infer<typeof DataHubContextSchema>;

// Persisted provenance is assigned by runtime code, never by the model. It is
// intentionally separate from DataHubContext so a static development fallback
// cannot be rendered as a successful live MCP read.
export const DataHubSourceSchema = z.enum(['LIVE_MCP', 'STATIC_DEMO_CONTEXT']);
export type DataHubSource = z.infer<typeof DataHubSourceSchema>;

export const ModelSourceSchema = z.enum(['ANTHROPIC', 'OPENAI', 'DETERMINISTIC_TEMPLATE']);
export type ModelSource = z.infer<typeof ModelSourceSchema>;

export const InvestigationProvenanceSchema = z.object({
  datahubSource: DataHubSourceSchema,
  modelSource: ModelSourceSchema,
  fallbackUsed: z.boolean()
});
export type InvestigationProvenance = z.infer<typeof InvestigationProvenanceSchema>;

// ---------------------------------------------------------------------------
// Engine result reference — copied programmatically from
// IncidentInvestigationReport after the model finishes. The model never
// writes these fields; the orchestrator overwrites whatever the model
// produced for this slice with the real engine values before persisting.
// ---------------------------------------------------------------------------

export const EngineResultReferenceSchema = z.object({
  incidentType: IncidentTypeSchema,
  overallStatus: OverallHealthStatusSchema,
  primaryExposure: z.string(),
  currency: z.literal('IDR'),
  affectedRecordCount: z.number().int().nonnegative(),
  correctionTargetCount: z.number().int().nonnegative()
});
export type EngineResultReference = z.infer<typeof EngineResultReferenceSchema>;

// ---------------------------------------------------------------------------
// Evidence sufficiency — the model's judgment call, reconciled only insofar
// as `sufficient: false` must be consistent with a non-empty missingEvidence
// list (checked in reconciliation.ts, not by the schema alone).
// ---------------------------------------------------------------------------

export const EvidenceSufficiencySchema = z.object({
  sufficient: z.boolean(),
  confidence: z.number().min(0).max(1),
  missingEvidence: z.array(z.string())
});
export type EvidenceSufficiency = z.infer<typeof EvidenceSufficiencySchema>;

// ---------------------------------------------------------------------------
// Model output (untrusted). This is the raw shape the InvestigationModel
// implementation must return, before reconciliation. "cited*" fields are the
// model's claims about which engine/DataHub facts it used — every one of
// them is checked against the real engine result and DataHub context in
// src/agent/reconciliation.ts. The model must NOT compute its own nominal
// figures: citedNominalFigures/citedRecordCounts are for citing (echoing)
// engine-provided numbers back for reconciliation, never for inventing new
// ones — any value that fails to match an engine-provided figure is rejected.
// ---------------------------------------------------------------------------

export const CitedNominalFigureSchema = z.object({
  label: z.string(),
  value: z.string()
});
export type CitedNominalFigure = z.infer<typeof CitedNominalFigureSchema>;

export const CitedRecordCountSchema = z.object({
  label: z.string(),
  value: z.number().int().nonnegative()
});
export type CitedRecordCount = z.infer<typeof CitedRecordCountSchema>;

export const ModelInvestigationOutputSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  evidenceSufficiency: EvidenceSufficiencySchema,
  rootCauseExplanation: z.string().min(1),
  businessImpactExplanation: z.string().min(1),
  remediationRationale: z.string().min(1),
  recommendedNextStep: RecommendedNextStepSchema,
  citedAssets: z.array(z.string()),
  citedOwners: z.array(z.string()),
  citedGlossaryTerms: z.array(z.string()),
  citedTags: z.array(z.string()),
  citedLineagePath: z.array(z.string()),
  citedNominalFigures: z.array(CitedNominalFigureSchema),
  citedRecordCounts: z.array(CitedRecordCountSchema),
  citedCorrectionTargets: z.array(RecordRefSchema),
  citedEvidenceRecords: z.array(RecordRefSchema)
});
export type ModelInvestigationOutput = z.infer<typeof ModelInvestigationOutputSchema>;

// ---------------------------------------------------------------------------
// Final, validated output — the exact contract required by the FASE 5 spec.
// engineResultReference and datahubContext are always copied programmatically
// from the real engine/MCP results, never taken from the model's output.
// ---------------------------------------------------------------------------

export const InvestigationOutputSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  investigationId: z.string(),
  incidentId: z.string(),
  status: InvestigationStatusSchema,
  evidenceSufficiency: EvidenceSufficiencySchema,
  rootCauseExplanation: z.string(),
  businessImpactExplanation: z.string(),
  datahubContext: DataHubContextSchema,
  provenance: InvestigationProvenanceSchema.optional(),
  engineResultReference: EngineResultReferenceSchema,
  remediationRationale: z.string(),
  recommendedNextStep: RecommendedNextStepSchema,
  activityLog: z.array(ActivityLogEntrySchema)
});
export type InvestigationOutput = z.infer<typeof InvestigationOutputSchema>;

// ---------------------------------------------------------------------------
// Reconciliation — the gate between "what the model said" and "what gets
// persisted/written back". A failed reconciliation never proceeds to
// write-back; it downgrades status to NEEDS_REVIEW/FAILED and records why.
// ---------------------------------------------------------------------------

export const ReconciliationRuleIdSchema = z.enum([
  'ASSETS_EXIST_IN_MCP',
  'OWNERS_FROM_DATAHUB',
  'NOMINAL_FIGURES_MATCH_ENGINE',
  'RECORD_COUNTS_MATCH_ENGINE',
  'LINEAGE_MATCHES_MCP',
  'CORRECTION_TARGETS_MATCH_ENGINE',
  'NO_EVIDENCE_MISCLASSIFIED_AS_CORRECTION'
]);
export type ReconciliationRuleId = z.infer<typeof ReconciliationRuleIdSchema>;

export const ReconciliationCheckSchema = z.object({
  rule: ReconciliationRuleIdSchema,
  passed: z.boolean(),
  detail: z.string()
});
export type ReconciliationCheck = z.infer<typeof ReconciliationCheckSchema>;

export const ReconciliationResultSchema = z.object({
  passed: z.boolean(),
  checks: z.array(ReconciliationCheckSchema)
});
export type ReconciliationResult = z.infer<typeof ReconciliationResultSchema>;

// ---------------------------------------------------------------------------
// Error state — persisted whenever the run lands in a failure state instead
// of a success state. Never contains chain-of-thought, only a short,
// sanitized diagnostic.
// ---------------------------------------------------------------------------

export const ErrorStateSchema = z.object({
  failureState: FailureStateSchema,
  message: z.string(),
  occurredAt: z.string()
});
export type ErrorState = z.infer<typeof ErrorStateSchema>;

// ---------------------------------------------------------------------------
// Full run record — the complete internal record the orchestrator builds and
// persists, success or failure. `investigate()` result is stored only as the
// slice needed for engineResultReference plus the pieces evidence/record
// classification needs for reconciliation — never the whole report blindly.
// ---------------------------------------------------------------------------

export const InvestigationRunRecordSchema = z.object({
  investigationId: z.string(),
  incidentId: z.string(),
  input: InvestigationAgentInputSchema,
  finalState: z.union([WorkflowStateSchema, FailureStateSchema]),
  output: InvestigationOutputSchema.nullable(),
  error: ErrorStateSchema.nullable(),
  stateHistory: z.array(z.object({ state: z.union([WorkflowStateSchema, FailureStateSchema]), at: z.string() })),
  createdAt: z.string()
});
export type InvestigationRunRecord = z.infer<typeof InvestigationRunRecordSchema>;
