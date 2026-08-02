import type { Pool } from 'pg';
import { loadInvestigationInput } from '../../db/repositories/investigation';
import { investigate } from '../../engine/investigate';
import { verifyState } from '../../engine/verify';
import { isDemoModeEnabled } from '../lib/demo-mode';
import { formatIdrDisplay, formatPercentDisplay } from '../lib/format-display';
import {
  OverviewViewModelSchema,
  type OverviewIncidentSummary,
  type OverviewViewModel
} from '../view-models/overview';
import { probeDatahubStatus } from './datahub-status';
import { hasBlockingRemediationPlan, listInvestigationRuns } from './queries';

const LINEAGE_STEPS = [
  'product_units.conversion_factor',
  'inventory_movements.base_quantity',
  'inventory_valuation.inventory_value',
  'journal_entries',
  'gross_margin_report'
] as const;

export function buildOverviewViewModel(parts: {
  generatedAt?: string;
  dataHealth: OverviewViewModel['dataHealth'];
  inventoryValue: string;
  grossMarginPercentage: string;
  datahubStatus: OverviewViewModel['datahubStatus'];
  datahubStatusDetail: string;
  lastVerificationStatus: OverviewViewModel['lastVerificationStatus'];
  lastVerificationAt: string;
  lastVerificationFailingChecks: string[];
  recentIncidents: OverviewIncidentSummary[];
  demoModeEnabled: boolean;
  resetDisabledReason: string | null;
  simulateDisabledReason: string | null;
  backendAvailable: boolean;
  backendError: string | null;
}): OverviewViewModel {
  const activeIncidentCount = parts.recentIncidents.filter(
    (row) => row.overallStatus === 'CRITICAL' || row.overallStatus === 'DEGRADED'
  ).length;

  return OverviewViewModelSchema.parse({
    schemaVersion: '1.0',
    generatedAt: parts.generatedAt ?? new Date().toISOString(),
    dataHealth: parts.dataHealth,
    activeIncidentCount,
    inventoryValue: parts.inventoryValue,
    inventoryValueLabel: formatIdrDisplay(parts.inventoryValue),
    grossMarginPercentage: parts.grossMarginPercentage,
    grossMarginLabel: formatPercentDisplay(parts.grossMarginPercentage),
    datahubStatus: parts.datahubStatus,
    datahubStatusDetail: parts.datahubStatusDetail,
    lastVerificationStatus: parts.lastVerificationStatus,
    lastVerificationAt: parts.lastVerificationAt,
    lastVerificationFailingChecks: parts.lastVerificationFailingChecks,
    lineageSteps: [...LINEAGE_STEPS],
    recentIncidents: parts.recentIncidents,
    demoModeEnabled: parts.demoModeEnabled,
    resetDisabledReason: parts.resetDisabledReason,
    simulateDisabledReason: parts.simulateDisabledReason,
    backendAvailable: parts.backendAvailable,
    backendError: parts.backendError
  });
}

function summarizeRuns(runs: Awaited<ReturnType<typeof listInvestigationRuns>>): OverviewIncidentSummary[] {
  return runs.map((run) => {
    const overall =
      run.output?.engineResultReference.overallStatus ??
      (run.finalState === 'INVESTIGATION_COMPLETED' ? 'UNKNOWN' : 'CRITICAL');
    return {
      id: run.investigationId,
      incidentId: run.incidentId,
      title:
        run.output?.engineResultReference.incidentType === 'UNIT_CONVERSION_MISMATCH'
          ? 'Unit conversion mismatch'
          : run.error
            ? `Investigation failed (${run.error.failureState})`
            : 'Investigation run',
      overallStatus: overall === 'HEALTHY' || overall === 'DEGRADED' || overall === 'CRITICAL' ? overall : 'UNKNOWN',
      finalState: run.finalState,
      primaryExposure: run.output?.engineResultReference.primaryExposure ?? null,
      currency: run.output?.engineResultReference.currency ?? null,
      createdAt: run.createdAt,
      recommendedNextStep: run.output?.recommendedNextStep ?? null
    };
  });
}

export async function loadOverviewViewModel(pool: Pool): Promise<OverviewViewModel> {
  const generatedAt = new Date().toISOString();
  const demoModeEnabled = isDemoModeEnabled();
  const datahub = await probeDatahubStatus();

  try {
    const [input, runs, blocking] = await Promise.all([
      loadInvestigationInput(pool),
      listInvestigationRuns(pool, 8),
      hasBlockingRemediationPlan(pool)
    ]);

    const report = investigate(input);
    const verification = verifyState(input);
    const inventoryValue = input.valuations[0]?.inventoryValue ?? '0.00';
    const grossMarginPercentage = input.marginReports[0]?.grossMarginPercentage ?? '0.0000';

    return buildOverviewViewModel({
      generatedAt,
      dataHealth: report.overallStatus,
      inventoryValue,
      grossMarginPercentage,
      datahubStatus: datahub.status,
      datahubStatusDetail: datahub.detail,
      lastVerificationStatus: verification.overallStatus,
      lastVerificationAt: generatedAt,
      lastVerificationFailingChecks: verification.checks
        .filter((check) => check.status === 'FAIL')
        .map((check) => check.checkId),
      recentIncidents: summarizeRuns(runs),
      demoModeEnabled,
      resetDisabledReason: !demoModeEnabled
        ? 'Reset requires demo mode to be enabled.'
        : blocking
          ? 'Reset is disabled while a remediation plan is executing or verifying.'
          : null,
      simulateDisabledReason: !demoModeEnabled ? 'Simulate requires demo mode to be enabled.' : null,
      backendAvailable: true,
      backendError: null
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Backend unavailable';
    return buildOverviewViewModel({
      generatedAt,
      dataHealth: 'DEGRADED',
      inventoryValue: '0.00',
      grossMarginPercentage: '0.0000',
      datahubStatus: datahub.status,
      datahubStatusDetail: datahub.detail,
      lastVerificationStatus: 'FAIL',
      lastVerificationAt: generatedAt,
      lastVerificationFailingChecks: ['BACKEND_UNAVAILABLE'],
      recentIncidents: [],
      demoModeEnabled,
      resetDisabledReason: 'Backend unavailable.',
      simulateDisabledReason: 'Backend unavailable.',
      backendAvailable: false,
      backendError: message
    });
  }
}
