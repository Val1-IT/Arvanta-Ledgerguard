import type { InvestigationFactsForModel } from './prompts/investigation-v1';
import type { InvestigationModel } from './model';
import { ModelInvestigationOutputSchema, SCHEMA_VERSION, type ModelInvestigationOutput, type RecommendedNextStep } from './types';

// ---------------------------------------------------------------------------
// Deterministic test provider — no network call, no API key. Allowed by the
// FASE 5 spec for unit tests only; "mode": "TEST" in the agent input routes
// here instead of the real Anthropic-backed provider. Every cited fact is
// copied verbatim from the facts it was given, so it always passes
// reconciliation by construction — its purpose is to exercise the
// orchestrator/reconciliation/persistence pipeline deterministically, not to
// simulate model failure modes (tests #2-#6 and #8 construct bad output by
// hand instead, see tests/unit/agent/reconciliation.test.ts).
// ---------------------------------------------------------------------------

function decideRecommendedNextStep(
  facts: InvestigationFactsForModel,
  sufficient: boolean
): RecommendedNextStep {
  if (!sufficient) return 'COLLECT_MORE_EVIDENCE';
  const { incidentType, overallStatus } = facts.engineResult;
  if (incidentType !== null) return 'REQUEST_APPROVAL';
  if (overallStatus === 'HEALTHY') return 'NO_ACTION_REQUIRED';
  return 'ESCALATE_TO_OWNER';
}

function missingEvidenceFor(facts: InvestigationFactsForModel): string[] {
  const missing: string[] = [];
  if (facts.datahubContext.assetsRead.length === 0) missing.push('no DataHub assets were read');
  if (facts.datahubContext.owners.length === 0) missing.push('no dataset owner was found in DataHub');
  if (facts.engineResult.incidentType !== null && facts.engineResult.rootCause === null) {
    missing.push('engine detected an incident type but produced no rootCause');
  }
  return missing;
}

export class DeterministicTestModel implements InvestigationModel {
  async generateInvestigation(facts: InvestigationFactsForModel): Promise<ModelInvestigationOutput> {
    const { engineResult, datahubContext } = facts;
    const missingEvidence = missingEvidenceFor(facts);
    const sufficient = missingEvidence.length === 0;
    const recommendedNextStep = decideRecommendedNextStep(facts, sufficient);

    const rootCauseExplanation = engineResult.rootCause
      ? `The root cause is a mismatch on ${engineResult.rootCause.asset}.${engineResult.rootCause.field} for unit "${engineResult.rootCause.unitName}" (product ${engineResult.rootCause.productId}): the value on record is ${engineResult.rootCause.actualValue}, but the value captured in the baseline snapshot at seed time was ${engineResult.rootCause.expectedValue} (source: ${engineResult.rootCause.expectedValueSource.evidenceReference}, captured ${engineResult.rootCause.expectedValueSource.capturedAt.toISOString()}). The difference is ${engineResult.rootCause.delta}.`
      : `No root cause was identified by the deterministic engine; overall status is ${engineResult.overallStatus}.`;

    const businessImpactExplanation = `The reconciled primary exposure is ${engineResult.financialImpact.primaryExposure} ${engineResult.financialImpact.currency}, computed as the sum of two disjoint components proven not to overlap (${engineResult.financialImpact.reconciliationInvariant}): an inventory-value component of ${engineResult.financialImpact.inventoryExposureComponent} on ${engineResult.financialImpact.onHandAffectedUnits} units still on hand, and a realized-COGS component of ${engineResult.financialImpact.realizedCogsExposureComponent} on ${engineResult.financialImpact.soldAffectedUnits} units already sold. The raw statement footprint (${engineResult.financialImpact.grossStatementFootprint} ${engineResult.financialImpact.currency}) is a separate, larger figure that sums every affected statement line including a restatement of the same delta as gross profit — it is reported for transparency only and must not be read as the exposure.`;

    const correctionSummary = engineResult.proposedCorrections
      .map((c) => `${c.action} on ${c.table}:${c.recordId}.${c.field} (${c.beforeValue} -> ${c.afterValue})`)
      .join('; ');
    const remediationRationale = engineResult.proposedCorrections.length
      ? `The proposed corrections (${correctionSummary}) restore the conversion factor to its baseline-proven value and regenerate every downstream figure that depended on it, without touching any already-posted journal entry directly; RECONCILE_JOURNAL_ENTRIES only re-confirms the ledger matches the recomputed COGS.`
      : 'No corrections are proposed because no incident requiring correction was detected.';

    const output: ModelInvestigationOutput = {
      schemaVersion: SCHEMA_VERSION,
      evidenceSufficiency: {
        sufficient,
        confidence: sufficient ? 0.95 : 0.4,
        missingEvidence
      },
      rootCauseExplanation,
      businessImpactExplanation,
      remediationRationale,
      recommendedNextStep,
      citedAssets: [...datahubContext.assetsRead],
      citedOwners: [...datahubContext.owners],
      citedGlossaryTerms: [...datahubContext.glossaryTerms],
      citedTags: [...datahubContext.tags],
      citedLineagePath: [...datahubContext.lineagePath],
      citedNominalFigures: [
        { label: 'primaryExposure', value: engineResult.financialImpact.primaryExposure },
        { label: 'grossStatementFootprint', value: engineResult.financialImpact.grossStatementFootprint },
        { label: 'inventoryValueDelta', value: engineResult.financialImpact.inventoryValueDelta },
        { label: 'cogsDelta', value: engineResult.financialImpact.cogsDelta },
        { label: 'grossProfitDelta', value: engineResult.financialImpact.grossProfitDelta }
      ],
      citedRecordCounts: [
        { label: 'evidenceRecordCount', value: engineResult.recordImpact.evidenceRecordCount },
        { label: 'correctionTargetCount', value: engineResult.recordImpact.correctionTargetCount },
        { label: 'downstreamAffectedRecordCount', value: engineResult.recordImpact.downstreamAffectedRecordCount }
      ],
      citedCorrectionTargets: [...engineResult.recordImpact.correctionTargets],
      citedEvidenceRecords: [...engineResult.recordImpact.evidenceRecords]
    };

    return ModelInvestigationOutputSchema.parse(output);
  }
}
