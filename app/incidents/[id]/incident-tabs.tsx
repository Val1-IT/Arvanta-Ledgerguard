'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type { IncidentDetailViewModel } from '../../../src/ui/view-models/incident-detail';
import { ActivityLogTable } from '../../../src/ui/components/activity-log-table';
import { ImpactGraph } from '../../../src/ui/components/impact-graph';
import { Panel } from '../../../src/ui/components/panel';
import { PlanDetailDialog, type PlanDetailView } from '../../../src/ui/components/plan-detail-dialog';
import { StatusBadge, toneForTerminalState } from '../../../src/ui/components/status-badge';
import { UrnLineage, UrnList } from '../../../src/ui/components/urn-list';
import { formatDecimalDisplay, formatIdrDisplay, formatIsoDateTime, formatPercentDisplay } from '../../../src/ui/lib/format-display';
import {
  labelApprovalAction,
  labelCorrectionAction,
  labelExecutionFailure,
  labelExposureMethod,
  labelField,
  labelInvestigationState,
  labelModelSource,
  labelPlanState,
  labelProvenanceType,
  labelTable,
  labelVerification,
  labelWriteback,
  humanizeToken
} from '../../../src/ui/lib/status-labels';
import { RemediationControls } from './remediation-controls';

const TABS = ['Investigation', 'Impact', 'Remediation', 'Resolution'] as const;
type Tab = (typeof TABS)[number];

export function IncidentTabs({ vm }: { vm: IncidentDetailViewModel }) {
  const [tab, setTab] = useState<Tab>('Investigation');
  const [hydrated, setHydrated] = useState(false);
  const [viewingPlanId, setViewingPlanId] = useState<string | null>(null);
  useEffect(() => {
    setHydrated(true);
  }, []);
  const viewingPlan: PlanDetailView | null = useMemo(() => {
    if (!viewingPlanId) return null;
    const entry = vm.remediation.planHistory.find((plan) => plan.planId === viewingPlanId);
    if (!entry) return null;
    return {
      planId: entry.planId,
      state: entry.state,
      version: entry.version,
      approvalAction: entry.approvalAction,
      createdAt: entry.createdAt,
      executedAt: entry.executedAt,
      verificationStatus: entry.verificationStatus,
      isActive: entry.isActive,
      proposedCorrections: entry.proposedCorrections
    };
  }, [viewingPlanId, vm.remediation.planHistory]);
  const currency = vm.currency ?? 'IDR';
  const fi = vm.impact.financialImpact;
  const ri = vm.impact.recordImpact;

  const evidenceMovementCount = vm.impact.evidenceMovements.length;
  const evidenceJournalCount = vm.impact.evidenceJournals.length;

  const tabPanels = useMemo(() => {
    return {
      Investigation: (
        <div className="space-y-5">
          {vm.uiFlags.showFailurePanel && vm.investigation.failure ? (
            <Panel title={`Failure: ${vm.investigation.failure.failureState}`} tone="risk">
              <p className="text-sm text-ink-muted">{vm.investigation.failure.message}</p>
              <p className="mt-2 text-xs text-ink-muted">
                Occurred at {formatIsoDateTime(vm.investigation.failure.occurredAt)}
              </p>
            </Panel>
          ) : null}

          <Panel title="Root cause" subtitle="Deterministic engine finding (when available) plus agent explanation.">
            <p className="text-sm text-ink">
              {vm.investigation.rootCauseSummary ?? 'No root cause was recorded for this run.'}
            </p>
            {vm.investigation.expectedValueProvenance ? (
              <dl className="mt-4 grid gap-2 text-sm sm:grid-cols-2">
                <div>
                  <dt className="text-ink-muted">Provenance type</dt>
                  <dd>{labelProvenanceType(vm.investigation.expectedValueProvenance.type)}</dd>
                </div>
                <div>
                  <dt className="text-ink-muted">Evidence reference</dt>
                  <dd className="break-all font-mono text-xs">
                    {vm.investigation.expectedValueProvenance.evidenceReference}
                  </dd>
                </div>
                <div>
                  <dt className="text-ink-muted">Expected</dt>
                  <dd className="font-mono">
                    {formatDecimalDisplay(
                      vm.investigation.expectedValueProvenance.expectedValue ?? ''
                    )}
                  </dd>
                </div>
                <div>
                  <dt className="text-ink-muted">Actual</dt>
                  <dd className="font-mono">
                    {formatDecimalDisplay(vm.investigation.expectedValueProvenance.actualValue ?? '')}
                  </dd>
                </div>
                <div>
                  <dt className="text-ink-muted">Captured at</dt>
                  <dd className="font-mono text-xs">
                    {formatIsoDateTime(vm.investigation.expectedValueProvenance.capturedAt)}
                  </dd>
                </div>
              </dl>
            ) : (
              <p className="mt-3 text-xs text-ink-muted">
                Expected-value provenance is available when the live engine report includes a root cause.
              </p>
            )}
          </Panel>

          <Panel title="Evidence sufficiency">
            {vm.investigation.evidenceSufficiency ? (
              <div className="space-y-2 text-sm">
                <div className="flex flex-wrap gap-2">
                  <StatusBadge
                    label={vm.investigation.evidenceSufficiency.sufficient ? 'Sufficient' : 'Insufficient'}
                    tone={vm.investigation.evidenceSufficiency.sufficient ? 'healthy' : 'warn'}
                  />
                  <StatusBadge
                    label={`Confidence ${vm.investigation.evidenceSufficiency.confidence}`}
                    tone="neutral"
                  />
                </div>
                {vm.investigation.evidenceSufficiency.missingEvidence.length > 0 ? (
                  <ul className="list-disc space-y-1 pl-5 text-ink-muted">
                    {vm.investigation.evidenceSufficiency.missingEvidence.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-ink-muted">No missing evidence reported.</p>
                )}
              </div>
            ) : (
              <p className="text-sm text-ink-muted">
                Evidence sufficiency is only present on completed investigation output.
              </p>
            )}
          </Panel>

          <Panel title="DataHub context" subtitle="Raw URNs remain available via tooltip on each chip.">
            <div className="space-y-4 text-sm">
              {vm.investigation.provenance ? (
                <dl className="grid gap-2 border-b border-ink/15 pb-4 text-xs sm:grid-cols-3">
                  <div>
                    <dt className="text-ink-muted">DataHub context</dt>
                    <dd className="font-semibold">
                      {vm.investigation.provenance.datahubSource === 'LIVE_MCP'
                        ? 'Live MCP'
                        : 'Demo context fallback'}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-ink-muted">Model narration</dt>
                    <dd className="font-semibold">
                      {labelModelSource(vm.investigation.provenance.modelSource)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-ink-muted">Fallback used</dt>
                    <dd className="font-semibold">{vm.investigation.provenance.fallbackUsed ? 'Yes' : 'No'}</dd>
                  </div>
                </dl>
              ) : (
                <p className="text-xs text-ink-muted">Runtime provenance is unavailable for this legacy record.</p>
              )}
              <div>
                <h3 className="mb-2 font-semibold">Assets</h3>
                <UrnList urns={vm.investigation.datahubContext.assets.map((x) => x.urn)} />
              </div>
              <div>
                <h3 className="mb-2 font-semibold">Owners</h3>
                <UrnList urns={vm.investigation.datahubContext.owners.map((x) => x.urn)} />
              </div>
              <div>
                <h3 className="mb-2 font-semibold">Tags</h3>
                <UrnList urns={vm.investigation.datahubContext.tags.map((x) => x.urn)} />
              </div>
              <div>
                <h3 className="mb-2 font-semibold">Glossary</h3>
                <UrnList urns={vm.investigation.datahubContext.glossary.map((x) => x.urn)} />
              </div>
              <div>
                <h3 className="mb-2 font-semibold">Lineage</h3>
                <UrnLineage urns={vm.investigation.datahubContext.lineage.map((x) => x.urn)} />
              </div>
            </div>
          </Panel>

          <Panel title="Agent explanation" subtitle="Reconciled prose only — never shown for unverified model output.">
            {!vm.uiFlags.showCompletionPanels ? (
              <p className="text-sm text-ink-muted">
                No completed investigation output is available. Failure details are shown above; unverified
                explanations are intentionally omitted.
              </p>
            ) : (
              <div className="space-y-4 text-sm">
                <div>
                  <h3 className="font-semibold">Root cause</h3>
                  <p className="text-ink-muted">{vm.investigation.explanations.rootCause}</p>
                </div>
                <div>
                  <h3 className="font-semibold">Business impact</h3>
                  <p className="text-ink-muted">{vm.investigation.explanations.businessImpact}</p>
                </div>
                <div>
                  <h3 className="font-semibold">Remediation rationale</h3>
                  <p className="text-ink-muted">{vm.investigation.explanations.remediationRationale}</p>
                </div>
              </div>
            )}
          </Panel>

          <Panel title="State history">
            <ol className="flex flex-wrap gap-2">
              {vm.investigation.stateHistory.map((entry, index) => (
                <li key={`${entry.state}-${index}`}>
                  <StatusBadge
                    label={`${index + 1}. ${labelInvestigationState(entry.state)}`}
                    tone={toneForTerminalState(entry.state)}
                    title={formatIsoDateTime(entry.at)}
                  />
                </li>
              ))}
            </ol>
          </Panel>

          <Panel title="Activity log">
            <ActivityLogTable
              entries={vm.investigation.activityLog}
              note={vm.investigation.activityLogNote}
            />
          </Panel>
        </div>
      ),
      Impact: (
        <div className="space-y-5">
          {!vm.impact.engineAvailable || !fi || !ri ? (
            <Panel title="Impact unavailable" tone="warn">
              <p className="text-sm text-ink-muted">
                The read-only engine report could not be loaded for this page. Counts and corrections below may be
                incomplete until the demo database is available.
              </p>
            </Panel>
          ) : null}

          <Panel
            title="Primary exposure"
            subtitle={vm.impact.primaryExposureTooltip}
          >
            <p className="text-3xl font-bold tracking-tight text-ink">
              {vm.primaryExposure ? formatIdrDisplay(vm.primaryExposure) : '—'}{' '}
              <span className="text-base font-semibold text-ink-muted">{currency}</span>
            </p>
            {fi ? (
              <p className="mt-2 text-xs text-ink-muted">
                Gross statement footprint (not headline exposure): {formatIdrDisplay(fi.grossStatementFootprint)}{' '}
                {fi.currency}
              </p>
            ) : null}
          </Panel>

          <Panel title="Financial statement effects">
            {fi ? (
              <dl className="grid gap-3 text-sm sm:grid-cols-2">
                <div>
                  <dt className="text-ink-muted">Inventory balance mis-statement</dt>
                  <dd className="font-mono">{formatIdrDisplay(fi.inventoryValueDelta)}</dd>
                </div>
                <div>
                  <dt className="text-ink-muted">Realized COGS mis-statement</dt>
                  <dd className="font-mono">{formatIdrDisplay(fi.cogsDelta)}</dd>
                </div>
                <div>
                  <dt className="text-ink-muted">Gross-profit impact</dt>
                  <dd className="font-mono">{formatIdrDisplay(fi.grossProfitDelta)}</dd>
                </div>
                <div>
                  <dt className="text-ink-muted">Gross-margin percentage impact</dt>
                  <dd className="font-mono">{formatPercentDisplay(fi.grossMarginPercentageDelta)}</dd>
                </div>
                <div className="sm:col-span-2">
                  <dt className="text-ink-muted">Gross statement footprint</dt>
                  <dd className="font-mono">{formatIdrDisplay(fi.grossStatementFootprint)}</dd>
                </div>
              </dl>
            ) : (
              <p className="text-sm text-ink-muted">Financial impact is not available.</p>
            )}
          </Panel>

          <Panel title="Disjoint population proof">
            {fi ? (
              <dl className="grid gap-3 text-sm sm:grid-cols-2">
                <div>
                  <dt className="text-ink-muted">On-hand affected units</dt>
                  <dd className="font-mono">{formatDecimalDisplay(fi.onHandAffectedUnits)}</dd>
                </div>
                <div>
                  <dt className="text-ink-muted">Sold affected units</dt>
                  <dd className="font-mono">{formatDecimalDisplay(fi.soldAffectedUnits)}</dd>
                </div>
                <div>
                  <dt className="text-ink-muted">Populations proven disjoint</dt>
                  <dd>
                    <StatusBadge
                      label={fi.populationsProvenDisjoint ? 'Yes' : 'No'}
                      tone={fi.populationsProvenDisjoint ? 'healthy' : 'warn'}
                    />
                  </dd>
                </div>
                <div>
                  <dt className="text-ink-muted">Exposure method</dt>
                  <dd className="text-sm">{labelExposureMethod(fi.exposureMethod)}</dd>
                </div>
                <div className="sm:col-span-2">
                  <dt className="text-ink-muted">Reconciliation invariant</dt>
                  <dd className="text-ink-muted">{fi.reconciliationInvariant}</dd>
                </div>
              </dl>
            ) : (
              <p className="text-sm text-ink-muted">Population proof is not available.</p>
            )}
          </Panel>

          <Panel title="Impact graph">
            <ImpactGraph nodes={vm.impact.lineageNodes} />
          </Panel>

          <Panel
            title="Record classification"
            subtitle="Evidence proves the incident. Correction targets are what remediation would mutate."
          >
            <div className="mb-4 flex flex-wrap gap-2">
              <StatusBadge label={`Evidence ${ri?.evidenceRecordCount ?? evidenceMovementCount + evidenceJournalCount}`} tone="neutral" />
              <StatusBadge label={`Correction targets ${ri?.correctionTargetCount ?? vm.impact.correctionTargets.length}`} tone="warn" />
              <StatusBadge label={`Downstream ${ri?.downstreamAffectedRecordCount ?? 0}`} tone="neutral" />
              <StatusBadge label={`Unique ${ri?.uniqueRecordCount ?? '—'}`} tone="neutral" />
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <div className="lg-panel-sm space-y-3 p-4">
                <h3 className="font-bold">Evidence records</h3>
                <p className="text-xs text-ink-muted">
                  Inventory movement evidence ({evidenceMovementCount}) and journal comparison evidence (
                  {evidenceJournalCount}). Journals here are not correction targets.
                </p>
                <div>
                  <h4 className="text-xs font-bold uppercase tracking-wide text-ink-muted">
                    Inventory movements ({evidenceMovementCount})
                  </h4>
                  <ul className="mt-2 max-h-40 space-y-1 overflow-y-auto font-mono text-xs">
                    {vm.impact.evidenceMovements.map((ref) => (
                      <li key={ref.recordId}>{ref.recordId}</li>
                    ))}
                  </ul>
                </div>
                <div>
                  <h4 className="text-xs font-bold uppercase tracking-wide text-ink-muted">
                    Journal comparison ({evidenceJournalCount})
                  </h4>
                  <ul className="mt-2 max-h-40 space-y-1 overflow-y-auto font-mono text-xs">
                    {vm.impact.evidenceJournals.map((ref) => (
                      <li key={ref.recordId}>{ref.recordId}</li>
                    ))}
                  </ul>
                </div>
              </div>

              <div className="lg-panel-sm space-y-3 border-warn p-4">
                <h3 className="font-bold">Correction targets</h3>
                <p className="text-xs text-ink-muted">
                  These records would be restored or regenerated. Evidence-only journals are excluded.
                </p>
                <ul className="space-y-2">
                  {vm.impact.correctionTargets.map((ref) => (
                    <li key={`${ref.table}:${ref.recordId}`} className="lg-tag border-ink text-ink">
                      {labelTable(ref.table)} · {ref.recordId}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </Panel>

          <Panel title="Before / after preview" subtitle="Read-only proposed corrections from the engine or remediation plan.">
            {vm.impact.proposedCorrections.length === 0 ? (
              <p className="text-sm text-ink-muted">No proposed corrections are available.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[760px] border-collapse text-left text-sm">
                  <caption className="sr-only">Proposed correction before and after values</caption>
                  <thead>
                    <tr className="border-b-2 border-ink">
                      <th className="py-2 pr-3">#</th>
                      <th className="py-2 pr-3">Asset</th>
                      <th className="py-2 pr-3">Record</th>
                      <th className="py-2 pr-3">Field</th>
                      <th className="py-2 pr-3">Current</th>
                      <th className="py-2 pr-3">Proposed</th>
                      <th className="py-2 pr-3">Reason</th>
                    </tr>
                  </thead>
                  <tbody>
                    {vm.impact.proposedCorrections.map((step) => (
                      <tr key={step.sequence} className="border-b border-ink/20 align-top">
                        <td className="py-2 pr-3 font-mono">{step.sequence}</td>
                        <td className="py-2 pr-3 text-xs">{labelTable(step.table)}</td>
                        <td className="py-2 pr-3 font-mono text-xs">{step.recordId}</td>
                        <td className="py-2 pr-3 text-xs">{labelField(step.field)}</td>
                        <td className="py-2 pr-3 font-mono text-xs">{formatDecimalDisplay(step.beforeValue)}</td>
                        <td className="py-2 pr-3 font-mono text-xs">{formatDecimalDisplay(step.afterValue)}</td>
                        <td className="max-w-xs py-2 pr-3 text-xs text-ink-muted">
                          {labelCorrectionAction(step.action)}
                          {step.action === 'RECONCILE_JOURNAL_ENTRIES'
                            ? ' — read-only reconciliation; journals are not rewritten.'
                            : ''}
                          {step.rollbackAssumption ? ` ${step.rollbackAssumption}` : ''}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="mt-3 text-xs text-ink-muted">
              Mutating execute controls live on the Remediation and Resolution tabs after a plan is approved.
            </p>
          </Panel>
        </div>
      ),
      Remediation: (
        <div className="space-y-5">
          <RemediationControls vm={vm} surface="remediation" />
          <Panel
            title="Latest remediation plan"
            subtitle={
              vm.remediation.planId
                ? 'Click View plan to inspect every proposed correction before approval.'
                : undefined
            }
          >
            <dl className="grid gap-3 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-ink-muted">Status</dt>
                <dd>
                  <StatusBadge
                    label={labelPlanState(vm.remediation.state)}
                    tone={toneForTerminalState(vm.remediation.state ?? 'NO_PLAN')}
                  />
                </dd>
              </div>
              <div>
                <dt className="text-ink-muted">Version</dt>
                <dd className="font-mono text-base font-bold" data-testid="plan-version">
                  v{vm.remediation.version ?? '—'}
                </dd>
              </div>
              <div>
                <dt className="text-ink-muted">Approval decision</dt>
                <dd>{labelApprovalAction(vm.remediation.approvalAction)}</dd>
              </div>
              <div>
                <dt className="text-ink-muted">Created</dt>
                <dd className="font-mono text-xs">
                  {vm.remediation.planHistory[0]
                    ? formatIsoDateTime(vm.remediation.planHistory[0].createdAt)
                    : '—'}
                </dd>
              </div>
              <div>
                <dt className="text-ink-muted">Executed</dt>
                <dd className="font-mono text-xs">
                  {vm.remediation.planHistory[0]?.executedAt
                    ? formatIsoDateTime(vm.remediation.planHistory[0].executedAt)
                    : '—'}
                </dd>
              </div>
              <div>
                <dt className="text-ink-muted">Verification</dt>
                <dd>{labelVerification(vm.remediation.planHistory[0]?.verificationStatus)}</dd>
              </div>
              <div className="sm:col-span-2">
                <dt className="text-ink-muted">Current available decision</dt>
                <dd className="text-ink-muted">{vm.remediation.availableDecision}</dd>
              </div>
            </dl>
            {vm.remediation.planId ? (
              <div className="mt-4">
                <button
                  type="button"
                  className="lg-btn-gold"
                  data-testid="view-active-plan"
                  onClick={() => setViewingPlanId(vm.remediation.planId)}
                >
                  View plan
                </button>
              </div>
            ) : null}
          </Panel>
          {vm.remediation.planHistory.length > 0 ? (
            <Panel title="Plan history" subtitle="Newest first. Click a row to view that plan’s corrections.">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[720px] border-collapse text-left text-sm">
                  <caption className="sr-only">Remediation plan history</caption>
                  <thead>
                    <tr className="border-b-2 border-ink">
                      <th className="py-2 pr-3">Status</th>
                      <th className="py-2 pr-3">Version</th>
                      <th className="py-2 pr-3">Steps</th>
                      <th className="py-2 pr-3">Created</th>
                      <th className="py-2 pr-3">Decision</th>
                      <th className="py-2 pr-3">Executed</th>
                      <th className="py-2 pr-3">Verification</th>
                      <th className="py-2 pr-3">
                        <span className="sr-only">View</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {vm.remediation.planHistory.map((entry) => (
                      <tr
                        key={entry.planId}
                        className="border-b border-ink/20 align-top transition-colors hover:bg-cream/60"
                      >
                        <td className="py-2 pr-3">
                          <div className="flex flex-wrap gap-1">
                            <StatusBadge
                              label={labelPlanState(entry.state)}
                              tone={toneForTerminalState(entry.state)}
                            />
                            {entry.isActive ? <StatusBadge label="Active" tone="warn" /> : null}
                          </div>
                        </td>
                        <td className="py-2 pr-3 font-mono font-bold">v{entry.version}</td>
                        <td className="py-2 pr-3 font-mono">{entry.proposedCorrections.length}</td>
                        <td className="py-2 pr-3 font-mono text-xs">{formatIsoDateTime(entry.createdAt)}</td>
                        <td className="py-2 pr-3">{labelApprovalAction(entry.approvalAction)}</td>
                        <td className="py-2 pr-3 font-mono text-xs">
                          {entry.executedAt ? formatIsoDateTime(entry.executedAt) : '—'}
                        </td>
                        <td className="py-2 pr-3">{labelVerification(entry.verificationStatus)}</td>
                        <td className="py-2 pr-3">
                          <button
                            type="button"
                            className="lg-btn"
                            data-testid={`view-plan-${entry.planId}`}
                            onClick={() => setViewingPlanId(entry.planId)}
                          >
                            View
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Panel>
          ) : null}
          <Panel title="Ordered remediation steps">
            {vm.remediation.steps.length === 0 ? (
              <p className="text-sm text-ink-muted">No proposed steps yet. Generate a plan to snapshot corrections.</p>
            ) : (
              <>
                <ol className="space-y-2">
                  {vm.remediation.steps.map((step) => (
                    <li key={step.sequence} className="lg-panel-sm px-3 py-2 text-sm">
                      <span className="font-mono text-xs text-ink-muted">#{step.sequence}</span>{' '}
                      <span className="font-semibold">{labelCorrectionAction(step.action)}</span> on{' '}
                      <span className="text-xs">
                        {labelTable(step.table)} · {step.recordId} · {labelField(step.field)}
                      </span>
                      <span className="mt-1 block font-mono text-xs text-ink-muted">
                        {formatDecimalDisplay(step.beforeValue)} → {formatDecimalDisplay(step.afterValue)}
                      </span>
                      {step.action === 'RECONCILE_JOURNAL_ENTRIES' ? (
                        <span className="ml-0 text-xs text-ink-muted">(read-only reconcile)</span>
                      ) : null}
                    </li>
                  ))}
                </ol>
                {vm.remediation.planId ? (
                  <button
                    type="button"
                    className="lg-btn mt-3"
                    onClick={() => setViewingPlanId(vm.remediation.planId)}
                  >
                    Open full plan view
                  </button>
                ) : null}
              </>
            )}
          </Panel>
          <Panel title="Correction targets">
            <ul className="flex flex-wrap gap-2">
              {vm.remediation.correctionTargets.map((ref) => (
                <li key={`${ref.table}:${ref.recordId}`}>
                  <StatusBadge label={`${labelTable(ref.table)} · ${ref.recordId}`} tone="warn" />
                </li>
              ))}
            </ul>
          </Panel>
          <Panel title="Safety notes">
            <p className="text-sm text-ink-muted">{vm.remediation.transactionSafetyNote}</p>
            <p className="mt-2 text-sm text-ink-muted">{vm.remediation.journalPolicyNote}</p>
          </Panel>
        </div>
      ),
      Resolution: (
        <div className="space-y-5">
          <RemediationControls vm={vm} surface="resolution" />
          <Panel
            title="Resolution status"
            subtitle="ERP integrity, verification, and DataHub metadata are tracked separately."
            tone={
              vm.resolution.semantics.datahubStale && vm.resolution.semantics.erpRestored
                ? 'warn'
                : vm.resolution.semantics.erpRestored && vm.resolution.semantics.datahubSynced
                  ? 'healthy'
                  : undefined
            }
          >
            <p className="text-sm font-semibold text-ink" data-testid="resolution-headline">
              {vm.resolution.semantics.headline}
            </p>
            {vm.resolution.semantics.detail ? (
              <p className="mt-2 text-sm text-ink-muted">{vm.resolution.semantics.detail}</p>
            ) : null}
            <div className="mt-4 flex flex-wrap gap-2">
              <StatusBadge
                label={`ERP ${vm.resolution.semantics.erpRestored ? 'restored' : 'not restored'}`}
                tone={vm.resolution.semantics.erpRestored ? 'healthy' : 'warn'}
              />
              <StatusBadge
                label={`Verification ${labelVerification(vm.resolution.verification?.overallStatus)}`}
                tone={
                  vm.resolution.verification?.overallStatus === 'PASS'
                    ? 'healthy'
                    : vm.resolution.verification?.overallStatus === 'FAIL'
                      ? 'risk'
                      : 'neutral'
                }
              />
              <StatusBadge
                label={`DataHub ${labelWriteback(vm.resolution.datahubWriteback?.outcome)}`}
                tone={
                  vm.resolution.datahubWriteback?.outcome === 'SYNCED'
                    ? 'healthy'
                    : vm.resolution.datahubWriteback?.outcome === 'FAILED' ||
                        vm.resolution.semantics.datahubStale
                      ? 'warn'
                      : 'neutral'
                }
              />
              <StatusBadge
                label={labelPlanState(vm.resolution.remediationState)}
                tone={toneForTerminalState(vm.resolution.remediationState ?? 'NONE')}
              />
            </div>
            {vm.resolution.placeholder ? (
              <p className="mt-3 text-sm text-ink-muted">{vm.resolution.placeholder}</p>
            ) : null}
            {vm.resolution.executionFailureReason ? (
              <p className="mt-3 text-sm text-risk" role="alert">
                Execution failure: {labelExecutionFailure(vm.resolution.executionFailureReason)}
                {vm.resolution.executionFailureDetail
                  ? ` — ${vm.resolution.executionFailureDetail}`
                  : ''}
              </p>
            ) : null}
          </Panel>
          {vm.resolution.executionSteps.length > 0 ? (
            <Panel title="Execution steps">
              <ol className="space-y-2 text-sm">
                {vm.resolution.executionSteps.map((step) => (
                  <li key={step.sequence} className="flex flex-wrap items-center gap-2">
                    <StatusBadge
                      label={step.status}
                      tone={
                        step.status === 'FAILED' ? 'risk' : step.status === 'APPLIED' ? 'healthy' : 'neutral'
                      }
                    />
                    <span className="text-xs">
                      #{step.sequence} {labelCorrectionAction(step.action)} · {labelTable(step.table)} ·{' '}
                      {step.recordId}
                    </span>
                    <span className="text-ink-muted">{step.detail}</span>
                  </li>
                ))}
              </ol>
            </Panel>
          ) : null}
          {vm.resolution.verification ? (
            <Panel title="Verification checks">
              <ul className="space-y-2 text-sm">
                {vm.resolution.verification.checks.map((check) => (
                  <li key={check.checkId} className="flex flex-wrap items-center gap-2">
                    <StatusBadge
                      label={check.status}
                      tone={check.status === 'PASS' ? 'healthy' : 'risk'}
                    />
                    <span className="text-xs">{humanizeToken(check.checkId)}</span>
                    <span className="text-ink-muted">{check.remediationHint}</span>
                  </li>
                ))}
              </ul>
            </Panel>
          ) : null}
          {vm.resolution.datahubWriteback ? (
            <Panel title="DataHub write-back">
              <dl className="grid gap-2 text-sm sm:grid-cols-2">
                <div>
                  <dt className="text-ink-muted">Attempted at</dt>
                  <dd className="font-mono text-xs">
                    {formatIsoDateTime(vm.resolution.datahubWriteback.attemptedAt)}
                  </dd>
                </div>
                <div>
                  <dt className="text-ink-muted">Outcome</dt>
                  <dd>{vm.resolution.datahubWriteback.outcome}</dd>
                </div>
                <div>
                  <dt className="text-ink-muted">At Risk removed</dt>
                  <dd>{vm.resolution.datahubWriteback.atRiskTagRemoved ? 'Yes' : 'No'}</dd>
                </div>
                <div>
                  <dt className="text-ink-muted">Trusted added</dt>
                  <dd>{vm.resolution.datahubWriteback.trustedTagAdded ? 'Yes' : 'No'}</dd>
                </div>
                {vm.resolution.datahubWriteback.message ? (
                  <div className="sm:col-span-2">
                    <dt className="text-ink-muted">Message</dt>
                    <dd className="text-ink-muted">{vm.resolution.datahubWriteback.message}</dd>
                  </div>
                ) : null}
              </dl>
            </Panel>
          ) : null}
        </div>
      )
    } satisfies Record<Tab, ReactNode>;
  }, [vm, currency, fi, ri, evidenceMovementCount, evidenceJournalCount]);

  return (
    <div className="space-y-5" data-testid="incident-tabs" data-hydrated={hydrated ? 'true' : 'false'}>
      <div className="-mx-1 overflow-x-auto px-1" role="tablist" aria-label="Incident sections">
        <div className="flex min-w-max gap-2">
          {TABS.map((name) => {
            const selected = tab === name;
            return (
              <button
                key={name}
                type="button"
                role="tab"
                aria-selected={selected}
                className={`rounded-lg border-2 px-4 py-2 text-sm font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink ${
                  selected
                    ? 'border-ink bg-gold text-ink shadow-brutal-sm'
                    : 'border-ink bg-cream-panel text-ink-muted hover:text-ink'
                }`}
                onClick={() => setTab(name)}
              >
                {name}
              </button>
            );
          })}
        </div>
      </div>
      <div role="tabpanel" aria-label={tab}>
        {tabPanels[tab]}
      </div>
      <PlanDetailDialog
        open={viewingPlan !== null}
        plan={viewingPlan}
        onClose={() => setViewingPlanId(null)}
      />
    </div>
  );
}
