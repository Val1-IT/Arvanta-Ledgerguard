import type { Pool } from 'pg';
import type { InvestigationRunRecord } from '../../agent/types';
import { loadInvestigationRun } from '../../db/repositories/investigation-runs';
import { loadInvestigationInput } from '../../db/repositories/investigation';
import { investigate } from '../../engine/investigate';
import type { IncidentInvestigationReport, ProposedCorrection, RecordRef } from '../../engine/types';
import type { RemediationPlanRecord } from '../../remediation/types';
import { isDemoModeEnabled } from '../lib/demo-mode';
import { urnDisplayLabel } from '../lib/urn';
import {
  IncidentDetailViewModelSchema,
  type IncidentDetailViewModel
} from '../view-models/incident-detail';
import { listRemediationPlansForInvestigation } from './queries';
import {
  remediationActionsDisabledReason,
  remediationDecisionCopy,
  resolveRemediationAvailableActions
} from './remediation-actions-policy';

const IMPACT_LINEAGE_NODES = [
  'product_units.conversion_factor',
  'inventory_movements.base_quantity',
  'inventory_valuation.inventory_value',
  'journal_entries',
  'gross_margin_report'
] as const;

const PRIMARY_EXPOSURE_TOOLTIP =
  'Primary exposure represents unique economic exposure. Gross statement footprint represents presentation across affected statement lines and is not additional exposure.';

const TRANSACTION_SAFETY_NOTE =
  'Execute applies proposed corrections inside a single database transaction with full rollback on SQL error or failed verification. Posted journal entries are never rewritten.';

const JOURNAL_POLICY_NOTE =
  'Journal comparison rows are evidence / reconciliation only. RECONCILE_JOURNAL_ENTRIES confirms ledger-posted COGS still matches; it does not modify journal_entries.';

function toIsoString(value: string | Date | null | undefined): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string') return value;
  return '';
}

function labeled(urns: string[]) {
  return urns.map((urn) => ({ urn, label: urnDisplayLabel(urn) }));
}

function splitEvidence(recordImpact: IncidentInvestigationReport['recordImpact'] | null) {
  const evidenceMovements: RecordRef[] = [];
  const evidenceJournals: RecordRef[] = [];
  for (const ref of recordImpact?.evidenceRecords ?? []) {
    if (ref.table === 'inventory_movements') evidenceMovements.push(ref);
    else if (ref.table === 'journal_entries') evidenceJournals.push(ref);
  }
  return { evidenceMovements, evidenceJournals };
}

function uniqueCorrectionTargets(
  recordImpact: IncidentInvestigationReport['recordImpact'] | null,
  corrections: ProposedCorrection[]
): RecordRef[] {
  if (recordImpact) return recordImpact.correctionTargets;
  const seen = new Set<string>();
  const out: RecordRef[] = [];
  for (const step of corrections) {
    if (step.action === 'RECONCILE_JOURNAL_ENTRIES') continue;
    const key = `${step.table}:${step.recordId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ table: step.table, recordId: step.recordId });
  }
  return out;
}

function buildActivityLog(run: InvestigationRunRecord): {
  activityLog: IncidentDetailViewModel['investigation']['activityLog'];
  activityLogSource: IncidentDetailViewModel['investigation']['activityLogSource'];
  activityLogNote: string | null;
} {
  if (run.output?.activityLog?.length) {
    return {
      activityLog: run.output.activityLog,
      activityLogSource: 'output',
      activityLogNote:
        'Individual ERROR rows may be expected MCP argument-shape probes. Terminal investigation status comes from finalState, not from activity-log row status.'
    };
  }

  if (run.stateHistory.length > 0) {
    const fallback = run.stateHistory.map((entry, index) => ({
      seq: index + 1,
      tool: 'orchestrator.state',
      startedAt: entry.at,
      finishedAt: entry.at,
      durationMs: 0,
      inputSummary: entry.state,
      outputSummary: run.error && index === run.stateHistory.length - 1 ? run.error.message : entry.state,
      status: (run.error && index === run.stateHistory.length - 1 ? 'ERROR' : 'OK') as 'OK' | 'ERROR',
      errorSanitized: run.error && index === run.stateHistory.length - 1 ? run.error.message : null
    }));
    return {
      activityLog: fallback,
      activityLogSource: 'state_history_fallback',
      activityLogNote:
        'This failed run did not persist a full tool activity log (output was null). Showing state-history transitions and the terminal failure event instead — no synthetic tool calls were invented.'
    };
  }

  return {
    activityLog: [],
    activityLogSource: 'none',
    activityLogNote: 'No activity log or state history is available for this run.'
  };
}

function buildResolutionSemantics(plan: RemediationPlanRecord | null): {
  erpRestored: boolean;
  verificationPassed: boolean;
  datahubSynced: boolean;
  datahubStale: boolean;
  headline: string;
  detail: string | null;
} {
  if (!plan) {
    return {
      erpRestored: false,
      verificationPassed: false,
      datahubSynced: false,
      datahubStale: false,
      headline: 'No remediation plan has been executed yet.',
      detail: null
    };
  }

  const verificationPassed = plan.verification?.result.overallStatus === 'PASS';
  const erpRestored = plan.state === 'RESOLVED';
  const datahubSynced = plan.datahubWriteback?.outcome === 'SYNCED';
  const datahubStale =
    erpRestored && (!plan.datahubWriteback || plan.datahubWriteback.outcome === 'FAILED');

  if (plan.state === 'VERIFICATION_FAILED') {
    return {
      erpRestored: false,
      verificationPassed: false,
      datahubSynced: false,
      datahubStale: true,
      headline: 'Verification failed — ERP data was not changed.',
      detail:
        'The remediation transaction rolled back. At-risk financial figures remain until a new plan is generated and executed successfully.'
    };
  }

  if (plan.state === 'EXECUTION_FAILED') {
    return {
      erpRestored: false,
      verificationPassed: false,
      datahubSynced: false,
      datahubStale: true,
      headline: 'Execution failed — ERP data was not changed.',
      detail: plan.executionResult?.failureDetail ?? plan.executionResult?.failureReason ?? null
    };
  }

  if (erpRestored && datahubSynced) {
    return {
      erpRestored: true,
      verificationPassed: true,
      datahubSynced: true,
      datahubStale: false,
      headline: 'ERP data integrity restored and DataHub metadata synchronized.',
      detail: null
    };
  }

  if (erpRestored && datahubStale) {
    return {
      erpRestored: true,
      verificationPassed: verificationPassed,
      datahubSynced: false,
      datahubStale: true,
      headline: 'ERP data integrity has been restored. DataHub metadata still requires synchronization.',
      detail:
        plan.datahubWriteback?.message ??
        'Retry DataHub write-back when the metadata bridge is available. ERP RESOLVED state does not change.'
    };
  }

  if (plan.state === 'APPROVED') {
    return {
      erpRestored: false,
      verificationPassed: false,
      datahubSynced: false,
      datahubStale: false,
      headline: 'Plan approved — awaiting execution.',
      detail: 'Execute applies corrections in one transaction and verifies before commit.'
    };
  }

  return {
    erpRestored: false,
    verificationPassed: false,
    datahubSynced: false,
    datahubStale: false,
    headline: `Plan is ${plan.state.replaceAll('_', ' ').toLowerCase()}.`,
    detail: null
  };
}

export function buildIncidentDetailViewModel(parts: {
  run: InvestigationRunRecord;
  engineReport: IncidentInvestigationReport | null;
  remediationPlan: RemediationPlanRecord | null;
  remediationPlanHistory?: RemediationPlanRecord[];
  generatedAt?: string;
  backendUnavailable?: boolean;
  demoModeEnabled?: boolean;
}): IncidentDetailViewModel {
  const { run, engineReport, remediationPlan } = parts;
  const completed = run.finalState === 'INVESTIGATION_COMPLETED' && run.output !== null;
  const activity = buildActivityLog(run);
  const demoModeEnabled = parts.demoModeEnabled ?? isDemoModeEnabled();
  const recommendedNextStep = run.output?.recommendedNextStep ?? null;
  const availableActions = resolveRemediationAvailableActions({
    investigationCompleted: completed,
    recommendedNextStep,
    plan: remediationPlan,
    demoModeEnabled
  });
  const actionsEnabled = Object.values(availableActions).some(Boolean);
  const actionsDisabledReason = remediationActionsDisabledReason({
    demoModeEnabled,
    investigationCompleted: completed,
    recommendedNextStep,
    plan: remediationPlan,
    actions: availableActions
  });
  const planHistorySource =
    parts.remediationPlanHistory ?? (remediationPlan ? [remediationPlan] : []);

  const proposedCorrections =
    remediationPlan?.proposedCorrections ?? engineReport?.proposedCorrections ?? [];
  const recordImpact = engineReport?.recordImpact ?? null;
  const { evidenceMovements, evidenceJournals } = splitEvidence(recordImpact);
  const correctionTargets = uniqueCorrectionTargets(recordImpact, proposedCorrections);

  const severity =
    run.output?.engineResultReference.overallStatus ??
    (engineReport?.overallStatus ?? (completed ? 'UNKNOWN' : 'CRITICAL'));

  const owners = run.output?.datahubContext.owners ?? [];
  const rootCause = engineReport?.rootCause ?? null;

  return IncidentDetailViewModelSchema.parse({
    schemaVersion: '1.0',
    generatedAt: parts.generatedAt ?? new Date().toISOString(),
    id: run.investigationId,
    incidentId: run.incidentId,
    title:
      run.output?.engineResultReference.incidentType === 'UNIT_CONVERSION_MISMATCH' ||
      engineReport?.incidentType === 'UNIT_CONVERSION_MISMATCH'
        ? 'Unit conversion mismatch'
        : run.error
          ? `Investigation failed (${run.error.failureState})`
          : 'Investigation',
    severity: severity === 'HEALTHY' || severity === 'DEGRADED' || severity === 'CRITICAL' ? severity : 'UNKNOWN',
    status: run.finalState,
    investigationCompleted: completed,
    detectedAt: run.createdAt,
    ownerLabels: owners.map(urnDisplayLabel),
    recommendedNextStep: run.output?.recommendedNextStep ?? null,
    primaryExposure:
      run.output?.engineResultReference.primaryExposure ??
      engineReport?.financialImpact.primaryExposure ??
      null,
    currency:
      run.output?.engineResultReference.currency ??
      engineReport?.financialImpact.currency ??
      null,

    investigation: {
      finalState: run.finalState,
      outputStatus: run.output?.status ?? null,
      rootCauseSummary: rootCause
        ? `${rootCause.asset}.${rootCause.field} for ${rootCause.unitName}: expected ${rootCause.expectedValue}, actual ${rootCause.actualValue}`
        : run.output?.rootCauseExplanation ?? null,
      expectedValueProvenance: rootCause
        ? {
            type: rootCause.expectedValueSource.type,
            recordId: rootCause.expectedValueSource.recordId,
            capturedAt: toIsoString(rootCause.expectedValueSource.capturedAt),
            evidenceReference: rootCause.expectedValueSource.evidenceReference,
            expectedValue: rootCause.expectedValue,
            actualValue: rootCause.actualValue,
            field: rootCause.field,
            asset: rootCause.asset
          }
        : null,
      evidenceSufficiency: run.output?.evidenceSufficiency ?? null,
      explanations: {
        rootCause: run.output?.rootCauseExplanation ?? null,
        businessImpact: run.output?.businessImpactExplanation ?? null,
        remediationRationale: run.output?.remediationRationale ?? null
      },
      datahubContext: {
        assets: labeled(run.output?.datahubContext.assetsRead ?? []),
        owners: labeled(run.output?.datahubContext.owners ?? []),
        tags: labeled(run.output?.datahubContext.tags ?? []),
        glossary: labeled(run.output?.datahubContext.glossaryTerms ?? []),
        lineage: labeled(run.output?.datahubContext.lineagePath ?? [])
      },
      stateHistory: run.stateHistory,
      activityLog: activity.activityLog,
      activityLogSource: activity.activityLogSource,
      activityLogNote: activity.activityLogNote,
      failure: run.error
    },

    impact: {
      engineAvailable: engineReport !== null,
      financialImpact: engineReport?.financialImpact ?? null,
      recordImpact,
      evidenceMovements,
      evidenceJournals,
      correctionTargets,
      proposedCorrections,
      lineageNodes: [...IMPACT_LINEAGE_NODES],
      primaryExposureTooltip: PRIMARY_EXPOSURE_TOOLTIP
    },

    remediation: {
      planAvailable: remediationPlan !== null,
      planId: remediationPlan?.id ?? null,
      state: remediationPlan?.state ?? null,
      version: remediationPlan?.version ?? null,
      approvalAction: remediationPlan?.approvalAction ?? null,
      steps: proposedCorrections,
      correctionTargets,
      transactionSafetyNote: TRANSACTION_SAFETY_NOTE,
      journalPolicyNote: JOURNAL_POLICY_NOTE,
      availableDecision: remediationDecisionCopy(
        remediationPlan,
        recommendedNextStep,
        availableActions
      ),
      actionsEnabled,
      actionsDisabledReason,
      availableActions,
      planHistory: planHistorySource.map((plan) => ({
        planId: plan.id,
        state: plan.state,
        version: plan.version,
        approvalAction: plan.approvalAction,
        createdAt: plan.createdAt,
        updatedAt: plan.updatedAt,
        executedAt: plan.executedAt,
        verificationStatus: plan.verification?.result.overallStatus ?? null,
        isActive: remediationPlan?.id === plan.id
      }))
    },

    resolution: {
      remediationState: remediationPlan?.state ?? null,
      verification: remediationPlan?.verification?.result ?? null,
      executionFailureReason: remediationPlan?.executionResult?.failureReason ?? null,
      executionFailureDetail: remediationPlan?.executionResult?.failureDetail ?? null,
      executionSteps: (remediationPlan?.executionResult?.steps ?? []).map((step) => ({
        sequence: step.sequence,
        action: step.action,
        table: step.table,
        recordId: step.recordId,
        status: step.status,
        detail: step.detail
      })),
      datahubWriteback: remediationPlan?.datahubWriteback ?? null,
      placeholder:
        remediationPlan?.state === 'RESOLVED'
          ? null
          : remediationPlan?.state === 'APPROVED'
            ? 'Plan is approved. Use Execute on this tab to apply corrections transactionally.'
            : remediationPlan?.state === 'VERIFICATION_FAILED'
              ? 'Verification failed and the ERP transaction was rolled back. Data remains at risk until a new plan succeeds.'
              : remediationPlan?.state === 'EXECUTION_FAILED'
                ? 'Execution failed and changes were rolled back. Generate a new plan to retry.'
                : 'Resolution details appear after a remediation plan is executed and verified.',
      semantics: buildResolutionSemantics(remediationPlan)
    },

    uiFlags: {
      showCompletionPanels: completed,
      showFailurePanel: run.error !== null,
      resetBlocked:
        remediationPlan?.state === 'EXECUTING' || remediationPlan?.state === 'VERIFYING',
      backendUnavailable: Boolean(parts.backendUnavailable)
    }
  });
}

/**
 * Read-only incident detail adapter for `/incidents/[id]`.
 * Combines investigation run + live engine investigate() + latest remediation plan.
 * Never mutates the database and never runs remediation.
 */
export async function loadIncidentDetailViewModel(
  pool: Pool,
  investigationId: string
): Promise<IncidentDetailViewModel | null> {
  const run = await loadInvestigationRun(pool, investigationId);
  if (!run) return null;

  let engineReport: IncidentInvestigationReport | null = null;
  try {
    const input = await loadInvestigationInput(pool);
    engineReport = investigate(input);
  } catch {
    engineReport = null;
  }

  const remediationPlanHistory = await listRemediationPlansForInvestigation(pool, investigationId);
  const remediationPlan = remediationPlanHistory[0] ?? null;
  return buildIncidentDetailViewModel({
    run,
    engineReport,
    remediationPlan,
    remediationPlanHistory
  });
}
