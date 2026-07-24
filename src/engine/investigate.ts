import { detectConversionFactorChanges, selectRootCause } from './conversion-impact';
import {
  compareValuations,
  expectedFactorMap,
  recomputeMovements,
  recomputeValuations,
  type ValuationComparison
} from './inventory-impact';
import { compareMarginReports, type MarginComparison } from './margin-impact';
import { summarizeJournalCogs } from './journal-impact';
import { buildBlastRadius } from './blast-radius';
import { buildFinancialImpact, ZERO_FINANCIAL_IMPACT } from './financial-exposure';
import { ALL_QUALITY_CHECKS } from './quality-checks';
import { buildRemediationPreview } from './remediation-preview';
import { formatMoney, formatQuantity, ZERO } from './decimal';
import type { EvidenceItem, IncidentInvestigationReport, InventoryMovementRecord, InvestigationInput, RootCause } from './types';

// ---------------------------------------------------------------------------
// The pure orchestrator. Takes an already-fetched InvestigationInput (see
// src/db/repositories/investigation.ts for the DB-wiring caller) and returns
// a fully-populated, schema-validated report. No I/O of any kind happens
// here — calling this function twice on the same input always returns the
// same output (idempotency requirement), because it contains no timestamp,
// no random ID generation, and no hidden mutable state between calls.
// ---------------------------------------------------------------------------

function buildEvidence(
  rootCause: RootCause | null,
  valuationComparisons: ValuationComparison[],
  marginComparisons: MarginComparison[]
): EvidenceItem[] {
  const evidence: EvidenceItem[] = [];

  if (rootCause) {
    evidence.push({
      table: 'product_units',
      recordId: rootCause.unitId,
      field: 'conversion_factor',
      expectedValue: rootCause.expectedValue,
      actualValue: rootCause.actualValue,
      delta: rootCause.delta,
      reason: `conversion_factor for unit ${rootCause.unitName} diverged from the healthy baseline captured in baseline_snapshot`
    });
  }

  for (const v of valuationComparisons.filter((c) => c.mismatch)) {
    evidence.push({
      table: 'inventory_valuation',
      recordId: v.valuationId,
      field: 'inventory_value',
      expectedValue: formatMoney(v.correctInventoryValue),
      actualValue: formatMoney(v.storedInventoryValue),
      delta: formatMoney(v.inventoryValueDelta),
      reason: 'inventory_value recomputed from movement history using the baseline conversion_factor does not match the stored value'
    });
    if (v.storedQuantityOnHand.minus(v.correctQuantityOnHand).abs().greaterThan('0.001')) {
      evidence.push({
        table: 'inventory_valuation',
        recordId: v.valuationId,
        field: 'quantity_on_hand',
        expectedValue: formatQuantity(v.correctQuantityOnHand),
        actualValue: formatQuantity(v.storedQuantityOnHand),
        delta: formatQuantity(v.correctQuantityOnHand.minus(v.storedQuantityOnHand)),
        reason: 'quantity_on_hand recomputed from movement history using the baseline conversion_factor does not match the stored value'
      });
    }
  }

  for (const m of marginComparisons.filter((c) => c.mismatch)) {
    evidence.push({
      table: 'gross_margin_report',
      recordId: m.reportId,
      field: 'cost_of_goods_sold',
      expectedValue: formatMoney(m.correctCogs),
      actualValue: formatMoney(m.storedCogs),
      delta: formatMoney(m.cogsDelta),
      reason: 'cost_of_goods_sold recomputed from correct inventory valuation does not match the stored value'
    });
  }

  return evidence;
}

export function investigate(input: InvestigationInput): IncidentInvestigationReport {
  const changes = detectConversionFactorChanges(input.productUnits, input.baseline);
  const rootCause = selectRootCause(changes);
  const changedUnitNames = new Set(changes.map((c) => c.unitName));

  const factors = expectedFactorMap(input.baseline);
  const movementRecomputes = recomputeMovements(input.movements, factors, changedUnitNames);
  const movementsById = new Map<string, InventoryMovementRecord>(input.movements.map((m) => [m.id, m]));
  const correctValuations = recomputeValuations(movementRecomputes, movementsById);
  const correctByProduct = new Map(correctValuations.map((v) => [v.productId, v]));

  const valuationComparisons = compareValuations(input.valuations, correctByProduct);
  const marginComparisons = compareMarginReports(input.marginReports, correctValuations);
  const journalCogsSummary = summarizeJournalCogs(input.journalEntries);

  const qualityChecks = ALL_QUALITY_CHECKS.map((check) => check.evaluate(input));

  const affectedMovementIds = movementRecomputes.filter((m) => m.affectedByUnitChange).map((m) => m.movementId);
  const affectedValuationIds = valuationComparisons.filter((v) => v.mismatch).map((v) => v.valuationId);
  const affectedReportIds = marginComparisons.filter((m) => m.mismatch).map((m) => m.reportId);
  const affectedJournalEntryIds = affectedReportIds.length > 0 ? journalCogsSummary.entryIds : [];

  const { affectedRecords, blastRadius } = buildBlastRadius({
    rootCause,
    affectedMovementIds,
    affectedValuationIds,
    affectedJournalEntryIds,
    affectedReportIds
  });

  const inventoryValueDelta = valuationComparisons
    .filter((v) => v.mismatch)
    .reduce((sum, v) => sum.plus(v.inventoryValueDelta), ZERO);
  const cogsDelta = marginComparisons.filter((m) => m.mismatch).reduce((sum, m) => sum.plus(m.cogsDelta), ZERO);
  const grossProfitDelta = marginComparisons
    .filter((m) => m.mismatch)
    .reduce((sum, m) => sum.plus(m.grossProfitDelta), ZERO);
  const grossMarginPercentageDelta = marginComparisons
    .filter((m) => m.mismatch)
    .reduce((sum, m) => sum.plus(m.grossMarginPercentageDelta), ZERO);

  const financialImpact = rootCause
    ? buildFinancialImpact(inventoryValueDelta, cogsDelta, grossProfitDelta, grossMarginPercentageDelta)
    : ZERO_FINANCIAL_IMPACT;

  const evidence = buildEvidence(rootCause, valuationComparisons, marginComparisons);

  const remediation = rootCause
    ? buildRemediationPreview({
        rootCause,
        movementRecomputes,
        valuationComparisons,
        marginComparisons,
        journalCogsSummary
      })
    : { proposedCorrections: [], verificationExpectations: [] };

  return {
    incidentType: rootCause ? 'UNIT_CONVERSION_MISMATCH' : 'HEALTHY',
    rootCause,
    affectedRecords,
    blastRadius,
    financialImpact,
    evidence,
    qualityChecks,
    proposedCorrections: remediation.proposedCorrections,
    verificationExpectations: remediation.verificationExpectations
  };
}
