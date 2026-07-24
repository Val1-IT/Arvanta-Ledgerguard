import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { investigate } from '../engine/investigate';
import type { IncidentInvestigationReport } from '../engine/types';
import { loadInvestigationInput } from '../db/repositories/investigation';
import { saveInvestigationRun } from '../db/repositories/investigation-runs';
import { ActivityLogger } from './activity-log';
import { DataHubBridgeError, readDataHubContext, writeInvestigationSummary } from './datahub-client';
import type { InvestigationModel } from './model';
import { reconcile } from './reconciliation';
import {
  InvestigationAgentInputSchema,
  type ActivityLogEntry,
  type DataHubContext,
  type EngineResultReference,
  type ErrorState,
  type FailureState,
  type InvestigationAgentInput,
  type InvestigationOutput,
  type InvestigationRunRecord,
  type InvestigationStatus,
  type ModelInvestigationOutput,
  type WorkflowState
} from './types';

// ---------------------------------------------------------------------------
// The orchestrator: the only place that sequences engine, DataHub, model, and
// reconciliation into one investigation run. It never invents a number, an
// owner, or a lineage hop itself — every fact either comes from investigate()
// (src/engine), from readDataHubContext() (real MCP), or is a citation the
// model made that reconcile() has independently verified. A failing
// reconciliation, an insufficient-evidence verdict, or any technical failure
// all terminate the run in one of the 7 named failure states — never a fake
// INVESTIGATION_COMPLETED (see docs/architecture/investigation-agent.md).
//
// `mode` (LIVE|TEST) is carried through to the persisted run record as
// caller-supplied context about the incident itself; it does not branch any
// orchestration logic here — FASE 5's DataHub reads/writes are always real,
// and swapping in a deterministic model for tests is done by the caller
// choosing which InvestigationModel to inject, not by this function.
// ---------------------------------------------------------------------------

export interface OrchestratorDeps {
  pool: Pool;
  model: InvestigationModel;
  now?: () => Date;
  idGenerator?: () => string;
}

function buildEngineResultReference(engineResult: IncidentInvestigationReport): EngineResultReference {
  return {
    incidentType: engineResult.incidentType,
    overallStatus: engineResult.overallStatus,
    primaryExposure: engineResult.financialImpact.primaryExposure,
    currency: engineResult.financialImpact.currency,
    affectedRecordCount: engineResult.blastRadius.affectedRecordCount,
    correctionTargetCount: engineResult.recordImpact.correctionTargetCount
  };
}

function buildWritebackSummary(
  investigationId: string,
  engineResult: IncidentInvestigationReport,
  engineResultReference: EngineResultReference,
  modelOutput: ModelInvestigationOutput,
  timestamp: string
): string {
  const rootCauseText = engineResult.rootCause
    ? `Root cause: unit conversion mismatch on ${engineResult.rootCause.unitName} (product_units.conversion_factor expected ${engineResult.rootCause.expectedValue}, actual ${engineResult.rootCause.actualValue}).`
    : 'Root cause: none detected by the deterministic engine.';
  return [
    'LedgerGuard investigation note',
    rootCauseText,
    `Primary exposure: ${engineResultReference.primaryExposure} ${engineResultReference.currency}.`,
    `Correction targets: ${engineResultReference.correctionTargetCount} record(s).`,
    `Evidence sufficiency: ${modelOutput.evidenceSufficiency.sufficient ? 'sufficient' : 'insufficient'} (confidence ${modelOutput.evidenceSufficiency.confidence}).`,
    `Investigation ID: ${investigationId}.`,
    `Generated at: ${timestamp}.`,
    'Status: pending human approval — no remediation has been executed.'
  ].join('\n');
}

function buildOutput(
  investigationId: string,
  input: InvestigationAgentInput,
  status: InvestigationStatus,
  modelOutput: ModelInvestigationOutput,
  engineResultReference: EngineResultReference,
  datahubContext: DataHubContext,
  activityLog: ActivityLogEntry[]
): InvestigationOutput {
  return {
    schemaVersion: modelOutput.schemaVersion,
    investigationId,
    incidentId: input.incidentId,
    status,
    evidenceSufficiency: modelOutput.evidenceSufficiency,
    rootCauseExplanation: modelOutput.rootCauseExplanation,
    businessImpactExplanation: modelOutput.businessImpactExplanation,
    datahubContext,
    engineResultReference,
    remediationRationale: modelOutput.remediationRationale,
    recommendedNextStep: modelOutput.recommendedNextStep,
    activityLog
  };
}

export async function runInvestigation(rawInput: unknown, deps: OrchestratorDeps): Promise<InvestigationRunRecord> {
  const parsedInput = InvestigationAgentInputSchema.safeParse(rawInput);
  if (!parsedInput.success) {
    throw new Error(`Invalid investigation input: ${parsedInput.error.message}`);
  }
  const input = parsedInput.data;

  const now = deps.now ?? (() => new Date());
  const idGenerator = deps.idGenerator ?? randomUUID;
  const investigationId = idGenerator();
  const createdAt = now().toISOString();
  const logger = new ActivityLogger();
  const stateHistory: InvestigationRunRecord['stateHistory'] = [];

  function transition(state: WorkflowState | FailureState): void {
    stateHistory.push({ state, at: now().toISOString() });
  }

  async function fail(
    failureState: FailureState,
    message: string,
    options: { output?: InvestigationOutput | null } = {}
  ): Promise<InvestigationRunRecord> {
    transition(failureState);
    const error: ErrorState = { failureState, message, occurredAt: now().toISOString() };
    const record: InvestigationRunRecord = {
      investigationId,
      incidentId: input.incidentId,
      input,
      finalState: failureState,
      output: options.output ?? null,
      error,
      stateHistory,
      createdAt
    };
    await saveInvestigationRun(deps.pool, record);
    return record;
  }

  transition('INCIDENT_RECEIVED');

  // -------------------------------------------------------------------
  // Deterministic engine — the sole source of every number and record ID.
  // -------------------------------------------------------------------
  let engineResult: IncidentInvestigationReport;
  try {
    transition('ENGINE_ANALYSIS_STARTED');
    const engineInput = await logger.record('engine.loadInvestigationInput', () => loadInvestigationInput(deps.pool));
    engineResult = await logger.record(
      'engine.investigate',
      () => investigate(engineInput),
      { input: { incidentId: input.incidentId, productId: input.productId } }
    );
    transition('ENGINE_ANALYSIS_COMPLETED');
  } catch (err) {
    return fail('ENGINE_FAILED', err instanceof Error ? err.message : String(err));
  }

  // -------------------------------------------------------------------
  // DataHub MCP — the sole source of schema/owner/tag/glossary/lineage.
  // readDataHubContext performs search -> schema read -> owner/tag/term
  // extraction -> lineage traversal to gross_margin_report as one bridge
  // call; on success all four intermediate states are known to have
  // succeeded, so they are recorded immediately after.
  // -------------------------------------------------------------------
  let datahubContext: DataHubContext;
  try {
    transition('DATAHUB_ASSET_SEARCH');
    const read = await readDataHubContext(input.triggerAsset);
    logger.ingest(read.activityLog);
    datahubContext = read.datahubContext;
    transition('DATAHUB_SCHEMA_READ');
    transition('DATAHUB_OWNER_READ');
    transition('DATAHUB_GLOSSARY_READ');
    transition('DATAHUB_LINEAGE_TRAVERSED');
  } catch (err) {
    if (err instanceof DataHubBridgeError) {
      logger.ingest(err.activityLog);
      return fail(err.failureState, err.message);
    }
    return fail('MCP_UNAVAILABLE', err instanceof Error ? err.message : String(err));
  }

  // -------------------------------------------------------------------
  // Merge DataHub evidence with the engine result into the fact set the
  // model is allowed to see and cite. No new figures or classifications
  // are produced here — this step only assembles what already exists.
  // -------------------------------------------------------------------
  const facts = await logger.record(
    'orchestrator.mergeEvidence',
    () => ({ incidentId: input.incidentId, triggerAsset: input.triggerAsset, engineResult, datahubContext }),
    { input: { incidentId: input.incidentId, triggerAsset: input.triggerAsset } }
  );
  transition('EVIDENCE_RECONCILED');

  // -------------------------------------------------------------------
  // Model — explanation, evidence-sufficiency judgment, remediation
  // rationale. Every claim it makes is checked against engineResult /
  // datahubContext by reconcile() before anything is trusted.
  // -------------------------------------------------------------------
  let modelOutput: ModelInvestigationOutput;
  try {
    transition('MODEL_ANALYSIS_STARTED');
    modelOutput = await logger.record('model.generateInvestigation', () => deps.model.generateInvestigation(facts));
  } catch (err) {
    return fail('MODEL_OUTPUT_INVALID', err instanceof Error ? err.message : String(err));
  }

  const reconciliation = reconcile(modelOutput, engineResult, datahubContext);
  if (!reconciliation.passed) {
    const failing = reconciliation.checks.filter((c) => !c.passed).map((c) => `${c.rule}: ${c.detail}`);
    return fail('MODEL_OUTPUT_INVALID', `Reconciliation failed: ${failing.join(' | ')}`);
  }

  const engineResultReference = buildEngineResultReference(engineResult);

  if (!modelOutput.evidenceSufficiency.sufficient) {
    const output = buildOutput(
      investigationId,
      input,
      'NEEDS_REVIEW',
      modelOutput,
      engineResultReference,
      datahubContext,
      logger.finalize()
    );
    return fail(
      'EVIDENCE_INSUFFICIENT',
      `Model judged evidence insufficient: ${modelOutput.evidenceSufficiency.missingEvidence.join(', ') || 'no detail provided'}`,
      { output }
    );
  }

  transition('MODEL_ANALYSIS_VALIDATED');

  // -------------------------------------------------------------------
  // Write-back — metadata only ("At Risk" tag + investigation note), never
  // an incident close and never a tag removal. Failure here still yields a
  // trustworthy, already-reconciled output; only the write-back itself
  // did not complete.
  // -------------------------------------------------------------------
  const writtenAt = now().toISOString();
  const summaryText = buildWritebackSummary(investigationId, engineResult, engineResultReference, modelOutput, writtenAt);
  try {
    const writeback = await writeInvestigationSummary(input.triggerAsset, summaryText);
    logger.ingest(writeback.activityLog);
  } catch (err) {
    if (err instanceof DataHubBridgeError) {
      logger.ingest(err.activityLog);
    }
    const output = buildOutput(
      investigationId,
      input,
      'NEEDS_REVIEW',
      modelOutput,
      engineResultReference,
      datahubContext,
      logger.finalize()
    );
    return fail('WRITEBACK_FAILED', err instanceof Error ? err.message : String(err), { output });
  }

  transition('INVESTIGATION_SUMMARY_WRITTEN');
  transition('INVESTIGATION_COMPLETED');

  const output = buildOutput(
    investigationId,
    input,
    'COMPLETED',
    modelOutput,
    engineResultReference,
    datahubContext,
    logger.finalize()
  );

  const record: InvestigationRunRecord = {
    investigationId,
    incidentId: input.incidentId,
    input,
    finalState: 'INVESTIGATION_COMPLETED',
    output,
    error: null,
    stateHistory,
    createdAt
  };
  await saveInvestigationRun(deps.pool, record);
  return record;
}
