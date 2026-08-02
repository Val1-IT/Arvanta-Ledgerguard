import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { InvestigationRunRecord } from '../../../src/agent/types';
import type { IncidentInvestigationReport } from '../../../src/engine/types';
import { buildIncidentDetailViewModel } from '../../../src/ui/server/incident-detail';

const root = resolve(process.cwd());

function loadJson<T>(relativePath: string): T {
  return JSON.parse(readFileSync(resolve(root, relativePath), 'utf8')) as T;
}

describe('incident detail view model', () => {
  const run = loadJson<InvestigationRunRecord>('examples/agent/conversion-error-investigation-run.json');
  const engine = loadJson<IncidentInvestigationReport>(
    'examples/investigations/conversion-error-investigation.json'
  );

  it('renders a completed investigation without inventing completion for failures', () => {
    const vm = buildIncidentDetailViewModel({ run, engineReport: engine, remediationPlan: null });
    expect(vm.investigationCompleted).toBe(true);
    expect(vm.uiFlags.showCompletionPanels).toBe(true);
    expect(vm.uiFlags.showFailurePanel).toBe(false);
    expect(vm.primaryExposure).toBe(run.output?.engineResultReference.primaryExposure);
    expect(vm.primaryExposure).toBe('28800000.00');
  });

  it('keeps primary exposure as backend value and footprint out of the headline field', () => {
    const vm = buildIncidentDetailViewModel({ run, engineReport: engine, remediationPlan: null });
    expect(vm.primaryExposure).toBe(engine.financialImpact.primaryExposure);
    expect(vm.primaryExposure).not.toBe(engine.financialImpact.grossStatementFootprint);
    expect(vm.impact.financialImpact?.grossStatementFootprint).toBe('43200000.00');
    expect(vm.impact.primaryExposureTooltip.toLowerCase()).toContain('not additional exposure');
  });

  it('separates evidence records from correction targets (24 movements + 36 journals vs 3 targets)', () => {
    const vm = buildIncidentDetailViewModel({ run, engineReport: engine, remediationPlan: null });
    expect(vm.impact.evidenceMovements).toHaveLength(24);
    expect(vm.impact.evidenceJournals).toHaveLength(36);
    expect(vm.impact.recordImpact?.evidenceRecordCount).toBe(60);
    expect(vm.impact.correctionTargets).toHaveLength(3);
    expect(vm.impact.correctionTargets.map((t) => t.table).sort()).toEqual([
      'gross_margin_report',
      'inventory_valuation',
      'product_units'
    ]);
    expect(vm.impact.correctionTargets.some((t) => t.table === 'journal_entries')).toBe(false);
    expect(vm.impact.recordImpact?.uniqueRecordCount).toBe(63);
  });

  it('renders activity log from completed output', () => {
    const vm = buildIncidentDetailViewModel({ run, engineReport: engine, remediationPlan: null });
    expect(vm.investigation.activityLogSource).toBe('output');
    expect(vm.investigation.activityLog.length).toBeGreaterThan(0);
    expect(vm.investigation.activityLog[0]?.seq).toBe(1);
  });

  it('failed run does not show completion panels and uses state-history fallback for activity', () => {
    const failed: InvestigationRunRecord = {
      ...run,
      finalState: 'MCP_UNAVAILABLE',
      output: null,
      error: {
        failureState: 'MCP_UNAVAILABLE',
        message: 'DataHub is currently unreachable — try again shortly.',
        occurredAt: '2026-07-24T12:00:00.000Z'
      },
      stateHistory: [
        { state: 'INCIDENT_RECEIVED', at: '2026-07-24T12:00:00.000Z' },
        { state: 'MCP_UNAVAILABLE', at: '2026-07-24T12:00:01.000Z' }
      ]
    };

    const vm = buildIncidentDetailViewModel({
      run: failed,
      engineReport: engine,
      remediationPlan: null
    });

    expect(vm.investigationCompleted).toBe(false);
    expect(vm.uiFlags.showCompletionPanels).toBe(false);
    expect(vm.uiFlags.showFailurePanel).toBe(true);
    expect(vm.investigation.explanations.rootCause).toBeNull();
    expect(vm.investigation.activityLogSource).toBe('state_history_fallback');
    expect(vm.investigation.activityLogNote?.toLowerCase()).toContain('did not persist');
    expect(vm.investigation.activityLog.at(-1)?.status).toBe('ERROR');
  });

  it('labels DataHub URNs for display while preserving raw values', () => {
    const vm = buildIncidentDetailViewModel({ run, engineReport: engine, remediationPlan: null });
    const owner = vm.investigation.datahubContext.owners.find((o) =>
      o.urn.includes('finance-controller')
    );
    expect(owner?.label.toLowerCase()).toContain('finance');
    expect(owner?.urn).toContain('urn:li:corpGroup:finance-controller');
  });

  it('exposes stored provenance and never infers Live MCP for a fallback record', () => {
    const fallback: InvestigationRunRecord = {
      ...run,
      output: run.output
        ? {
            ...run.output,
            provenance: {
              datahubSource: 'STATIC_DEMO_CONTEXT',
              modelSource: 'DETERMINISTIC_TEMPLATE',
              fallbackUsed: true
            }
          }
        : null
    };
    const vm = buildIncidentDetailViewModel({ run: fallback, engineReport: engine, remediationPlan: null });
    expect(vm.investigation.provenance?.datahubSource).toBe('STATIC_DEMO_CONTEXT');
    expect(vm.investigation.provenance?.fallbackUsed).toBe(true);
  });

  it('enables generate-plan action for completed REQUEST_APPROVAL runs in demo mode', () => {
    const vm = buildIncidentDetailViewModel({
      run,
      engineReport: engine,
      remediationPlan: null,
      demoModeEnabled: true
    });
    expect(vm.recommendedNextStep).toBe('REQUEST_APPROVAL');
    expect(vm.remediation.availableActions.canGeneratePlan).toBe(true);
    expect(vm.remediation.actionsEnabled).toBe(true);
    expect(vm.remediation.actionsDisabledReason).toBeNull();
  });

  it('exposes plan history with the latest plan marked active', () => {
    const older = {
      schemaVersion: '1.0' as const,
      id: 'plan-old',
      investigationId: run.investigationId,
      incidentId: run.incidentId,
      productId: 'prod-cement-40',
      triggerAsset: 'inventory_valuation',
      requestedBy: 'test',
      state: 'REJECTED' as const,
      version: 2,
      proposedCorrections: [],
      verificationExpectations: [],
      approvalAction: 'REJECT' as const,
      approvedBy: 'test',
      approvalNote: null,
      approvedAt: '2026-07-24T01:00:00.000Z',
      executionResult: null,
      executedAt: null,
      verification: null,
      datahubWriteback: null,
      createdAt: '2026-07-24T00:00:00.000Z',
      updatedAt: '2026-07-24T01:00:00.000Z'
    };
    const sampleCorrection = engine.proposedCorrections[0];
    const latest = {
      ...older,
      id: 'plan-new',
      state: 'DRAFT' as const,
      version: 1,
      approvalAction: null,
      approvedBy: null,
      approvedAt: null,
      createdAt: '2026-07-24T02:00:00.000Z',
      updatedAt: '2026-07-24T02:00:00.000Z',
      proposedCorrections: sampleCorrection ? [sampleCorrection] : []
    };
    const vm = buildIncidentDetailViewModel({
      run,
      engineReport: engine,
      remediationPlan: latest,
      remediationPlanHistory: [latest, older],
      demoModeEnabled: true
    });
    expect(vm.remediation.planHistory).toHaveLength(2);
    expect(vm.remediation.planHistory[0]?.planId).toBe('plan-new');
    expect(vm.remediation.planHistory[0]?.isActive).toBe(true);
    expect(vm.remediation.planHistory[0]?.proposedCorrections).toHaveLength(1);
    expect(vm.remediation.planHistory[0]?.proposedCorrections[0]?.action).toBe(sampleCorrection?.action);
    expect(vm.remediation.planHistory[1]?.isActive).toBe(false);
    expect(vm.remediation.planHistory[1]?.proposedCorrections).toHaveLength(0);
    expect(vm.resolution.semantics.erpRestored).toBe(false);
  });

  it('keeps DataHub stale semantics when ERP is RESOLVED but write-back failed', () => {
    const resolved = {
      schemaVersion: '1.0' as const,
      id: 'plan-resolved',
      investigationId: run.investigationId,
      incidentId: run.incidentId,
      productId: 'prod-cement-40',
      triggerAsset: 'inventory_valuation',
      requestedBy: 'test',
      state: 'RESOLVED' as const,
      version: 4,
      proposedCorrections: [],
      verificationExpectations: [],
      approvalAction: 'APPROVE' as const,
      approvedBy: 'test',
      approvalNote: null,
      approvedAt: '2026-07-24T03:00:00.000Z',
      executionResult: null,
      executedAt: '2026-07-24T03:05:00.000Z',
      verification: {
        verifiedAt: '2026-07-24T03:05:01.000Z',
        result: {
          overallStatus: 'PASS' as const,
          checks: []
        }
      },
      datahubWriteback: {
        attemptedAt: '2026-07-24T03:05:02.000Z',
        outcome: 'FAILED' as const,
        atRiskTagRemoved: false,
        trustedTagAdded: false,
        message: 'bridge down'
      },
      createdAt: '2026-07-24T02:00:00.000Z',
      updatedAt: '2026-07-24T03:05:02.000Z'
    };
    const vm = buildIncidentDetailViewModel({
      run,
      engineReport: engine,
      remediationPlan: resolved,
      remediationPlanHistory: [resolved],
      demoModeEnabled: true
    });
    expect(vm.resolution.semantics.erpRestored).toBe(true);
    expect(vm.resolution.semantics.datahubStale).toBe(true);
    expect(vm.resolution.semantics.headline).toMatch(/DataHub metadata still requires synchronization/i);
    expect(vm.remediation.planHistory[0]?.executedAt).toBe('2026-07-24T03:05:00.000Z');
    expect(vm.remediation.planHistory[0]?.verificationStatus).toBe('PASS');
  });
});
