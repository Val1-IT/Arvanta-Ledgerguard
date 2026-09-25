import type { IncidentInvestigationReport, RecordRef } from '@ledgerguard/core';
import type {
  DataHubContext,
  ModelInvestigationOutput,
  ReconciliationCheck,
  ReconciliationResult
} from './types';

// ---------------------------------------------------------------------------
// The gate between "what the model said" and "what gets persisted or written
// back". Every rule below is a structural comparison against the real engine
// result and the real DataHub context — never a re-judgment of the model's
// prose. A single failing check fails the whole reconciliation; the
// orchestrator (src/agent/orchestrator.ts) is the only caller allowed to act
// on the result, and it must never proceed to write-back when passed=false.
// ---------------------------------------------------------------------------

function recordKey(ref: RecordRef): string {
  return `${ref.table}:${ref.recordId}`;
}

function collectKnownNominalFigures(engineResult: IncidentInvestigationReport): Set<string> {
  const fi = engineResult.financialImpact;
  const values = new Set<string>([
    fi.inventoryValueDelta,
    fi.cogsDelta,
    fi.grossProfitDelta,
    fi.grossMarginPercentageDelta,
    fi.onHandAffectedUnits,
    fi.soldAffectedUnits,
    fi.inventoryExposureComponent,
    fi.realizedCogsExposureComponent,
    fi.reconciliationInvariant,
    fi.primaryExposure,
    fi.grossStatementFootprint
  ]);
  if (engineResult.rootCause) {
    values.add(engineResult.rootCause.expectedValue);
    values.add(engineResult.rootCause.actualValue);
    values.add(engineResult.rootCause.delta);
  }
  return values;
}

function collectKnownRecordCounts(engineResult: IncidentInvestigationReport): Set<number> {
  const ri = engineResult.recordImpact;
  const br = engineResult.blastRadius;
  return new Set<number>([
    ri.evidenceRecordCount,
    ri.correctionTargetCount,
    ri.downstreamAffectedRecordCount,
    ri.uniqueRecordCount,
    br.affectedAssetCount,
    br.affectedRecordCount
  ]);
}

function checkAssetsExistInMcp(model: ModelInvestigationOutput, datahub: DataHubContext): ReconciliationCheck {
  const known = new Set<string>([...datahub.assetsRead, ...datahub.lineagePath]);
  const knownTags = new Set(datahub.tags);
  const knownTerms = new Set(datahub.glossaryTerms);

  const fabricatedAssets = model.citedAssets.filter((a) => !known.has(a));
  const fabricatedTags = model.citedTags.filter((t) => !knownTags.has(t));
  const fabricatedTerms = model.citedGlossaryTerms.filter((t) => !knownTerms.has(t));

  const passed = fabricatedAssets.length === 0 && fabricatedTags.length === 0 && fabricatedTerms.length === 0;
  return {
    rule: 'ASSETS_EXIST_IN_MCP',
    passed,
    detail: passed
      ? `All ${model.citedAssets.length} cited asset(s), ${model.citedTags.length} tag(s), and ${model.citedGlossaryTerms.length} glossary term(s) were actually read via MCP.`
      : `Fabricated citations not present in the DataHub context: assets=[${fabricatedAssets.join(', ')}] tags=[${fabricatedTags.join(', ')}] terms=[${fabricatedTerms.join(', ')}]`
  };
}

function checkOwnersFromDatahub(model: ModelInvestigationOutput, datahub: DataHubContext): ReconciliationCheck {
  const known = new Set(datahub.owners);
  const fabricated = model.citedOwners.filter((o) => !known.has(o));
  const passed = fabricated.length === 0;
  return {
    rule: 'OWNERS_FROM_DATAHUB',
    passed,
    detail: passed
      ? `All ${model.citedOwners.length} cited owner(s) came from DataHub.`
      : `Fabricated owner(s) not present in the DataHub context: [${fabricated.join(', ')}]`
  };
}

function checkNominalFiguresMatchEngine(
  model: ModelInvestigationOutput,
  engineResult: IncidentInvestigationReport
): ReconciliationCheck {
  const known = collectKnownNominalFigures(engineResult);
  const fabricated = model.citedNominalFigures.filter((f) => !known.has(f.value));
  const passed = fabricated.length === 0;
  return {
    rule: 'NOMINAL_FIGURES_MATCH_ENGINE',
    passed,
    detail: passed
      ? `All ${model.citedNominalFigures.length} cited nominal figure(s) equal a value in the engine result.`
      : `Figure(s) not found in the engine result: [${fabricated.map((f) => `${f.label}=${f.value}`).join(', ')}]`
  };
}

function checkRecordCountsMatchEngine(
  model: ModelInvestigationOutput,
  engineResult: IncidentInvestigationReport
): ReconciliationCheck {
  const known = collectKnownRecordCounts(engineResult);
  const fabricated = model.citedRecordCounts.filter((c) => !known.has(c.value));
  const passed = fabricated.length === 0;
  return {
    rule: 'RECORD_COUNTS_MATCH_ENGINE',
    passed,
    detail: passed
      ? `All ${model.citedRecordCounts.length} cited record count(s) equal a count in the engine result.`
      : `Count(s) not found in the engine result: [${fabricated.map((c) => `${c.label}=${c.value}`).join(', ')}]`
  };
}

function checkLineageMatchesMcp(model: ModelInvestigationOutput, datahub: DataHubContext): ReconciliationCheck {
  const real = datahub.lineagePath;
  let cursor = -1;
  const outOfOrderOrMissing: string[] = [];
  for (const hop of model.citedLineagePath) {
    const idx = real.indexOf(hop, cursor + 1);
    if (idx === -1) {
      outOfOrderOrMissing.push(hop);
    } else {
      cursor = idx;
    }
  }
  const passed = outOfOrderOrMissing.length === 0;
  return {
    rule: 'LINEAGE_MATCHES_MCP',
    passed,
    detail: passed
      ? `Cited lineage path (${model.citedLineagePath.length} hop(s)) is a valid, order-preserving subsequence of the real MCP lineage path.`
      : `Lineage hop(s) missing from, or out of order in, the real MCP lineage path: [${outOfOrderOrMissing.join(', ')}]`
  };
}

function checkCorrectionTargetsMatchEngine(
  model: ModelInvestigationOutput,
  engineResult: IncidentInvestigationReport
): ReconciliationCheck {
  const known = new Set(engineResult.recordImpact.correctionTargets.map(recordKey));
  const fabricated = model.citedCorrectionTargets.filter((r) => !known.has(recordKey(r)));
  const passed = fabricated.length === 0;
  return {
    rule: 'CORRECTION_TARGETS_MATCH_ENGINE',
    passed,
    detail: passed
      ? `All ${model.citedCorrectionTargets.length} cited correction target(s) were actually classified as correction targets by the engine.`
      : `Record(s) cited as correction targets that the engine did not classify as such: [${fabricated.map(recordKey).join(', ')}]`
  };
}

function checkNoEvidenceMisclassifiedAsCorrection(
  model: ModelInvestigationOutput,
  engineResult: IncidentInvestigationReport
): ReconciliationCheck {
  const evidenceKeys = new Set(engineResult.recordImpact.evidenceRecords.map(recordKey));
  const correctionKeys = new Set(engineResult.recordImpact.correctionTargets.map(recordKey));

  const notActuallyEvidence = model.citedEvidenceRecords.filter((r) => !evidenceKeys.has(recordKey(r)));
  const evidenceCitedAsCorrection = model.citedCorrectionTargets.filter((r) => evidenceKeys.has(recordKey(r)));
  const correctionCitedAsEvidence = model.citedEvidenceRecords.filter((r) => correctionKeys.has(recordKey(r)));

  const passed =
    notActuallyEvidence.length === 0 && evidenceCitedAsCorrection.length === 0 && correctionCitedAsEvidence.length === 0;
  return {
    rule: 'NO_EVIDENCE_MISCLASSIFIED_AS_CORRECTION',
    passed,
    detail: passed
      ? `All ${model.citedEvidenceRecords.length} cited evidence record(s) and ${model.citedCorrectionTargets.length} cited correction target(s) match the engine's own classification, with no crossover.`
      : [
          notActuallyEvidence.length ? `cited as evidence but not classified as evidence by the engine: [${notActuallyEvidence.map(recordKey).join(', ')}]` : '',
          evidenceCitedAsCorrection.length ? `evidence record(s) miscited as correction targets: [${evidenceCitedAsCorrection.map(recordKey).join(', ')}]` : '',
          correctionCitedAsEvidence.length ? `correction target(s) miscited as evidence: [${correctionCitedAsEvidence.map(recordKey).join(', ')}]` : ''
        ]
          .filter(Boolean)
          .join('; ')
  };
}

export function reconcile(
  modelOutput: ModelInvestigationOutput,
  engineResult: IncidentInvestigationReport,
  datahubContext: DataHubContext
): ReconciliationResult {
  const checks: ReconciliationCheck[] = [
    checkAssetsExistInMcp(modelOutput, datahubContext),
    checkOwnersFromDatahub(modelOutput, datahubContext),
    checkNominalFiguresMatchEngine(modelOutput, engineResult),
    checkRecordCountsMatchEngine(modelOutput, engineResult),
    checkLineageMatchesMcp(modelOutput, datahubContext),
    checkCorrectionTargetsMatchEngine(modelOutput, engineResult),
    checkNoEvidenceMisclassifiedAsCorrection(modelOutput, engineResult)
  ];
  return { passed: checks.every((c) => c.passed), checks };
}
