import type { IncidentInvestigationReport, RecordRef } from '@ledgerguard/core';
import { SCHEMA_VERSION, type DataHubContext, type ModelInvestigationOutput } from '../../../src/agent/types';

// ---------------------------------------------------------------------------
// Minimal, schema-valid IncidentInvestigationReport / DataHubContext /
// ModelInvestigationOutput fixtures for the FASE 5 agent unit tests
// (reconciliation.test.ts, model-test.test.ts). Every field the reconciliation
// checks (src/agent/reconciliation.ts) actually read is populated with a real
// value so tests can mutate exactly the field under test instead of hand-
// building the whole report per test.
// ---------------------------------------------------------------------------

export function buildEngineResultFixture(): IncidentInvestigationReport {
  const correctionTarget: RecordRef = { table: 'product_units', recordId: 'pu-carton' };
  const evidenceRecord: RecordRef = { table: 'inventory_movements', recordId: 'mov-1' };

  return {
    incidentType: 'UNIT_CONVERSION_MISMATCH',
    overallStatus: 'CRITICAL',
    rootCause: {
      asset: 'product_units',
      field: 'conversion_factor',
      productId: 'prod-cement-40',
      unitId: 'unit-carton',
      unitName: 'CARTON',
      expectedValue: '40',
      actualValue: '35',
      delta: '-5',
      expectedValueSource: {
        type: 'baseline_snapshot',
        recordId: 'baseline-1',
        capturedAt: new Date('2026-01-01T00:00:00.000Z'),
        evidenceReference: 'baseline_snapshot.value_json.conversionFactor.CARTON'
      }
    },
    affectedRecords: {
      inventoryMovements: ['mov-1'],
      inventoryValuations: ['val-cement-40'],
      journalEntries: [],
      reports: []
    },
    blastRadius: {
      affectedAssetCount: 2,
      affectedRecordCount: 2,
      assets: [
        { asset: 'product_units', role: 'root_cause', recordCount: 1 },
        { asset: 'inventory_valuation', role: 'requires_correction', recordCount: 1 }
      ]
    },
    recordImpact: {
      evidenceRecords: [evidenceRecord],
      correctionTargets: [correctionTarget],
      downstreamAffectedRecords: [],
      evidenceRecordCount: 1,
      correctionTargetCount: 1,
      downstreamAffectedRecordCount: 0,
      uniqueRecordCount: 2
    },
    financialImpact: {
      inventoryValueDelta: '-500000.00',
      cogsDelta: '500000.00',
      grossProfitDelta: '-500000.00',
      grossMarginPercentageDelta: '-1.25',
      onHandAffectedUnits: '100',
      soldAffectedUnits: '200',
      inventoryExposureComponent: '200000.00',
      realizedCogsExposureComponent: '300000.00',
      populationsProvenDisjoint: true,
      reconciliationInvariant: '100 + 200 = 300',
      exposureMethod: 'DISJOINT_POPULATION_SUM',
      primaryExposure: '500000.00',
      grossStatementFootprint: '1500000.00',
      currency: 'IDR'
    },
    evidence: [],
    qualityChecks: [],
    proposedCorrections: [
      {
        sequence: 1,
        action: 'RESTORE_CONVERSION_FACTOR',
        table: 'product_units',
        recordId: 'pu-carton',
        field: 'conversion_factor',
        beforeValue: '35',
        afterValue: '40',
        financialDelta: '500000.00',
        rollbackAssumption: 'restores the baseline-proven factor'
      }
    ],
    verificationExpectations: []
  };
}

export function buildDataHubContextFixture(): DataHubContext {
  return {
    assetsRead: ['product_units', 'inventory_valuation'],
    owners: ['owner:data-team'],
    glossaryTerms: ['term:inventory-valuation'],
    tags: ['tag:financial-integrity'],
    lineagePath: ['product_units', 'inventory_movements', 'inventory_valuation', 'gross_margin_report']
  };
}

/** Mirrors what DeterministicTestModel produces: every "cited*" field is copied verbatim from the facts it was given. */
export function buildModelOutputFixture(
  engineResult: IncidentInvestigationReport,
  datahub: DataHubContext
): ModelInvestigationOutput {
  return {
    schemaVersion: SCHEMA_VERSION,
    evidenceSufficiency: { sufficient: true, confidence: 0.95, missingEvidence: [] },
    rootCauseExplanation: 'Root cause explanation for the fixture incident.',
    businessImpactExplanation: 'Business impact explanation for the fixture incident.',
    remediationRationale: 'Remediation rationale for the fixture incident.',
    recommendedNextStep: 'REQUEST_APPROVAL',
    citedAssets: [...datahub.assetsRead],
    citedOwners: [...datahub.owners],
    citedGlossaryTerms: [...datahub.glossaryTerms],
    citedTags: [...datahub.tags],
    citedLineagePath: [...datahub.lineagePath],
    citedNominalFigures: [{ label: 'primaryExposure', value: engineResult.financialImpact.primaryExposure }],
    citedRecordCounts: [{ label: 'correctionTargetCount', value: engineResult.recordImpact.correctionTargetCount }],
    citedCorrectionTargets: [...engineResult.recordImpact.correctionTargets],
    citedEvidenceRecords: [...engineResult.recordImpact.evidenceRecords]
  };
}
