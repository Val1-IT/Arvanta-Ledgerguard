import type { IncidentInvestigationReport } from '@ledgerguard/core';
import { SCHEMA_VERSION, type DataHubContext } from '../types';

// ---------------------------------------------------------------------------
// FASE 5 — versioned system prompt for the DataHub-aware investigation model.
// Bump PROMPT_VERSION and add a new file (investigation-v2.ts, ...) instead
// of editing this text in place once it has been used for a real run — the
// prompt is part of the reconciliation contract's provenance trail.
// ---------------------------------------------------------------------------

export const PROMPT_VERSION = 'investigation-v1' as const;

// Only the five actions the engine itself knows how to express as a
// correction (ProposedCorrectionAction in src/engine/types.ts). The model
// must never invent a sixth action — reconciliation rule 7 rejects it.
const ALLOWED_ACTIONS = [
  'RESTORE_CONVERSION_FACTOR',
  'RECOMPUTE_INVENTORY_MOVEMENT',
  'REGENERATE_INVENTORY_VALUATION',
  'REGENERATE_GROSS_MARGIN_REPORT',
  'RECONCILE_JOURNAL_ENTRIES'
] as const;

export const SYSTEM_PROMPT = `You are the analysis component of the LedgerGuard DataHub-aware investigation agent.

You are an ANALYST, not a source of numbers. Two other systems already produced every fact you are given:

1. The DETERMINISTIC FINANCIAL INTEGRITY ENGINE is the sole source of truth for every number: root-cause values, expected/actual values, record IDs, inventory impact, COGS impact, gross-profit impact, primary exposure, statement footprint, blast radius, and correction targets. You will receive its output as JSON. You must never recompute, round differently, adjust, or restate any of these numbers as if you derived them — you may only CITE them back verbatim in the "cited*" fields of your output.

2. DATAHUB is the sole source of truth for metadata: dataset schema, field definitions, owners, tags, glossary terms, descriptions, and lineage. You must never invent an owner, a tag, a glossary term, or a lineage hop that was not given to you in the DataHub context JSON. You may only CITE assets/owners/terms/tags/lineage hops that actually appear in that JSON.

Your job is to:
- explain the root cause in plain language, grounded only in the engine's RootCause and the DataHub schema/glossary context;
- explain the blast radius (who/what is affected) using the engine's recordImpact classification;
- explain the financial impact in business terms, using the engine's financialImpact numbers exactly as given;
- produce a remediation rationale — WHY the proposed corrections make sense, not new correction actions. Any action you refer to must be one of: ${ALLOWED_ACTIONS.join(', ')}. Do not propose or imply any other kind of action.
- judge whether the assembled evidence (engine result + DataHub context) is sufficient to proceed, and if not, say exactly what is missing;
- recommend exactly one next step from the fixed set: REQUEST_APPROVAL, COLLECT_MORE_EVIDENCE, ESCALATE_TO_OWNER, NO_ACTION_REQUIRED.

Hard rules — violating any of these causes your entire output to be rejected by an automated reconciliation check before anything is persisted or written back:

- Never fabricate a nominal figure. Every number you cite in citedNominalFigures must equal a number that appears in the engine result you were given, exactly as formatted.
- Never fabricate a record count. Every count you cite in citedRecordCounts must equal a count that appears in the engine's recordImpact or blastRadius (use the exact integers from ALLOWED_CITATIONS when provided).
- Never fabricate an asset, owner, glossary term, tag, or lineage hop. Every entry in citedAssets/citedOwners/citedGlossaryTerms/citedTags/citedLineagePath must be copied character-for-character from the DataHub context / ALLOWED_CITATIONS — full URNs only, never short table names like "product_units".
- Never call the "grossStatementFootprint" the primary exposure. They are different numbers with different meanings: grossStatementFootprint is a raw, potentially double-counted sum across every affected statement line; primaryExposure is the reconciled, disjoint-population figure that is actually the financial exposure. If you mention grossStatementFootprint at all, you must explicitly label it as a raw footprint figure, not as the exposure.
- Never explain primary exposure in a way that double-counts on-hand inventory value and realized COGS as if they were separate additive exposures on top of each other — the engine has already proven them disjoint; explain them as two non-overlapping components of one number.
- Never suggest directly editing, deleting, or overwriting a posted journal entry. Journal entries that are correct and used only as comparison evidence must be classified as comparison evidence, not as correction targets. Only when the engine's own output indicates a journal value is itself wrong may you suggest an adjusting or reversal entry (via RECONCILE_JOURNAL_ENTRIES) — never a direct edit to what was already posted.
- Every record you cite in citedCorrectionTargets must be one the engine actually classified as a correction target, not a record the engine classified as evidence. Every record you cite in citedEvidenceRecords must be one the engine actually classified as evidence, not a correction target. Do not reclassify a record yourself.
- If you are missing information you would need to be confident (e.g. a DataHub read failed, an owner is unknown, lineage is incomplete), set evidenceSufficiency.sufficient to false and list the specific missing evidence — do not paper over a gap with a confident-sounding explanation.
- Do not include chain-of-thought, private reasoning, or step-by-step deliberation in any field. Every field is persisted as-is; write only the final, concise explanation.
- Do not reference credentials, tokens, connection strings, or raw environment values under any circumstances — you will never be given any, and you must never claim to have used one.

You must always respond using the structured output tool you are given, matching its schema exactly, including schemaVersion "${SCHEMA_VERSION}".`;

export interface InvestigationFactsForModel {
  incidentId: string;
  triggerAsset: string;
  engineResult: IncidentInvestigationReport;
  datahubContext: DataHubContext;
}

function truncate(value: string, max = 4000): string {
  return value.length > max ? `${value.slice(0, max)}…(truncated)` : value;
}

/**
 * Compact engine projection for the model prompt. Full evidenceRecords arrays
 * are huge and previously truncated the prompt mid-JSON (cutting DataHub URNs),
 * which caused live models to invent short table names. Counts + a small
 * evidence sample remain; reconciliation still gates every citation.
 */
function buildCompactEngineResult(engineResult: IncidentInvestigationReport) {
  const evidenceSample = engineResult.recordImpact.evidenceRecords.slice(0, 8);
  return {
    incidentType: engineResult.incidentType,
    overallStatus: engineResult.overallStatus,
    rootCause: engineResult.rootCause,
    blastRadius: engineResult.blastRadius,
    recordImpact: {
      evidenceRecordCount: engineResult.recordImpact.evidenceRecordCount,
      correctionTargetCount: engineResult.recordImpact.correctionTargetCount,
      downstreamAffectedRecordCount: engineResult.recordImpact.downstreamAffectedRecordCount,
      uniqueRecordCount: engineResult.recordImpact.uniqueRecordCount,
      correctionTargets: engineResult.recordImpact.correctionTargets,
      evidenceRecordsSample: evidenceSample,
      evidenceRecordsSampleNote: `Showing ${evidenceSample.length} of ${engineResult.recordImpact.evidenceRecords.length} evidence records. Prefer citing these or leave citedEvidenceRecords empty rather than inventing IDs.`
    },
    financialImpact: engineResult.financialImpact,
    proposedCorrections: engineResult.proposedCorrections,
    qualityChecks: engineResult.qualityChecks.map((check) => ({
      checkId: check.checkId,
      status: check.status,
      severity: check.severity,
      expected: check.expected,
      actual: check.actual,
      remediationHint: check.remediationHint
    }))
  };
}

function buildAllowedCitations(
  engineResult: IncidentInvestigationReport,
  datahubContext: DataHubContext
) {
  const fi = engineResult.financialImpact;
  const ri = engineResult.recordImpact;
  const br = engineResult.blastRadius;
  return {
    citedAssets: [...datahubContext.assetsRead, ...datahubContext.lineagePath],
    citedOwners: [...datahubContext.owners],
    citedGlossaryTerms: [...datahubContext.glossaryTerms],
    citedTags: [...datahubContext.tags],
    citedLineagePath: [...datahubContext.lineagePath],
    citedNominalFigures: [
      { label: 'primaryExposure', value: fi.primaryExposure },
      { label: 'grossStatementFootprint', value: fi.grossStatementFootprint },
      { label: 'inventoryValueDelta', value: fi.inventoryValueDelta },
      { label: 'cogsDelta', value: fi.cogsDelta },
      { label: 'grossProfitDelta', value: fi.grossProfitDelta },
      { label: 'inventoryExposureComponent', value: fi.inventoryExposureComponent },
      { label: 'realizedCogsExposureComponent', value: fi.realizedCogsExposureComponent }
    ],
    citedRecordCounts: [
      { label: 'evidenceRecordCount', value: ri.evidenceRecordCount },
      { label: 'correctionTargetCount', value: ri.correctionTargetCount },
      { label: 'downstreamAffectedRecordCount', value: ri.downstreamAffectedRecordCount },
      { label: 'uniqueRecordCount', value: ri.uniqueRecordCount },
      { label: 'affectedAssetCount', value: br.affectedAssetCount },
      { label: 'affectedRecordCount', value: br.affectedRecordCount }
    ],
    citedCorrectionTargets: [...ri.correctionTargets],
    citedEvidenceRecords: ri.evidenceRecords.slice(0, 8)
  };
}

export function buildUserPrompt(facts: InvestigationFactsForModel): string {
  const allowedCitations = buildAllowedCitations(facts.engineResult, facts.datahubContext);
  const payload = {
    incidentId: facts.incidentId,
    triggerAsset: facts.triggerAsset,
    engineResult: buildCompactEngineResult(facts.engineResult),
    datahubContext: facts.datahubContext
  };
  return truncate(
    [
      'Investigate the following incident using only the facts below.',
      '',
      'ALLOWED_CITATIONS (copy these strings/numbers verbatim into cited* fields; do not invent short names or other counts):',
      JSON.stringify(allowedCitations, null, 2),
      '',
      'ENGINE RESULT AND DATAHUB CONTEXT (JSON):',
      JSON.stringify(payload, null, 2),
      '',
      'Produce your structured investigation output now. For citedAssets/citedOwners/citedGlossaryTerms/citedTags/citedLineagePath/citedNominalFigures/citedRecordCounts/citedCorrectionTargets, prefer the ALLOWED_CITATIONS values above.'
    ].join('\n'),
    100000
  );
}
