import Link from 'next/link';
import { getServerPool } from '../../src/agent/server-pool';
import { CopyIdButton } from '../../src/ui/components/copy-id-button';
import { EmptyState } from '../../src/ui/components/empty-state';
import { MetricCard } from '../../src/ui/components/metric-card';
import { PageHeader } from '../../src/ui/components/page-header';
import { Panel } from '../../src/ui/components/panel';
import { StatusBadge, toneForHealth, toneForTerminalState } from '../../src/ui/components/status-badge';
import { formatIdrDisplay, formatIsoDateTime } from '../../src/ui/lib/format-display';
import {
  humanizeToken,
  labelDatahubStatus,
  labelHealth,
  labelInvestigationState,
  labelLineageStep,
  labelVerification
} from '../../src/ui/lib/status-labels';
import { loadOverviewViewModel } from '../../src/ui/server/overview';
import { DemoControls } from './demo-controls';

export const dynamic = 'force-dynamic';

export default async function OverviewPage() {
  const vm = await loadOverviewViewModel(getServerPool());

  return (
    <div className="space-y-6">
      <PageHeader
        title="Overview"
        description="Financial-integrity health of the demo ERP dataset. Numbers come from the deterministic engine; DataHub status is a lightweight GMS probe."
        meta={
          <>
            <StatusBadge
              label={`Data health · ${labelHealth(vm.dataHealth)}`}
              tone={toneForHealth(vm.dataHealth)}
            />
            <StatusBadge
              label={`DataHub · ${labelDatahubStatus(vm.datahubStatus)}`}
              tone={
                vm.datahubStatus === 'CONNECTED'
                  ? 'healthy'
                  : vm.datahubStatus === 'NOT_CONFIGURED'
                    ? 'neutral'
                    : 'warn'
              }
              title={vm.datahubStatusDetail}
            />
            <StatusBadge
              label={vm.demoModeEnabled ? 'Demo mode on' : 'Demo mode off'}
              tone={vm.demoModeEnabled ? 'warn' : 'neutral'}
              title={
                vm.demoModeEnabled
                  ? 'Simulate, reset, and remediation mutations are enabled.'
                  : 'Mutating demo actions are disabled until demo mode is enabled.'
              }
            />
            {!vm.backendAvailable ? (
              <StatusBadge label="Backend unavailable" tone="risk" title={vm.backendError ?? undefined} />
            ) : null}
          </>
        }
        actions={<DemoControls simulateDisabledReason={vm.simulateDisabledReason} resetDisabledReason={vm.resetDisabledReason} />}
      />

      {vm.backendError ? (
        <Panel title="Backend notice" tone="warn">
          <p className="text-sm text-ink-muted">{vm.backendError}</p>
        </Panel>
      ) : null}

      <section aria-label="Health metrics" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="Data Health"
          value={labelHealth(vm.dataHealth)}
          tone={toneForHealth(vm.dataHealth)}
          badge={labelHealth(vm.dataHealth)}
          hint="Derived from the live deterministic integrity engine."
        />
        <MetricCard
          label="Active Incidents"
          value={vm.activeIncidentCount}
          tone={vm.activeIncidentCount > 0 ? 'risk' : 'healthy'}
          badge={vm.activeIncidentCount > 0 ? 'At risk' : 'Clear'}
          hint="Completed or degraded investigation runs with non-healthy status."
        />
        <MetricCard
          label="Inventory Value"
          value={<span className="whitespace-nowrap">{vm.inventoryValueLabel}</span>}
          hint="Current inventory value from the demo database."
        />
        <MetricCard
          label="Gross Margin"
          value={<span className="whitespace-nowrap">{vm.grossMarginLabel}</span>}
          hint="Current gross margin percentage from the demo database."
        />
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <Panel title="DataHub status" subtitle={vm.datahubStatusDetail}>
          <StatusBadge
            label={labelDatahubStatus(vm.datahubStatus)}
            tone={
              vm.datahubStatus === 'CONNECTED' ? 'healthy' : vm.datahubStatus === 'NOT_CONFIGURED' ? 'neutral' : 'warn'
            }
          />
        </Panel>
        <Panel
          title="Last verification"
          subtitle={`Checked at ${formatIsoDateTime(vm.lastVerificationAt)}`}
        >
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge
              label={labelVerification(vm.lastVerificationStatus)}
              tone={vm.lastVerificationStatus === 'PASS' ? 'healthy' : 'risk'}
            />
            {vm.lastVerificationFailingChecks.length > 0 ? (
              <span className="text-xs text-ink-muted">
                Failing: {vm.lastVerificationFailingChecks.map((check) => humanizeToken(check)).join(', ')}
              </span>
            ) : (
              <span className="text-xs text-ink-muted">All quality checks currently pass.</span>
            )}
          </div>
        </Panel>
      </section>

      <Panel title="Workflow lineage" subtitle="Conversion-factor blast path used by the demo scenario.">
        <ol className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
          {vm.lineageSteps.map((step, index) => (
            <li key={step} className="flex items-center gap-2">
              {index > 0 ? <span className="hidden text-ink-muted sm:inline">→</span> : null}
              <span className="lg-tag border-ink text-ink">{labelLineageStep(step)}</span>
              {index < vm.lineageSteps.length - 1 ? (
                <span className="text-ink-muted sm:hidden" aria-hidden="true">
                  ↓
                </span>
              ) : null}
            </li>
          ))}
        </ol>
      </Panel>

      <Panel
        title="Recent incidents"
        subtitle="Each row is a persisted investigation run. Open one to inspect Investigation and Impact."
        actions={
          <Link href="/incidents" className="text-sm font-semibold text-gold-strong hover:underline">
            View all
          </Link>
        }
      >
        {vm.recentIncidents.length === 0 ? (
          <EmptyState
            title="No investigation runs yet"
            description="Use Simulate Conversion Error to create the first incident investigation."
          />
        ) : (
          <ul className="divide-y divide-ink/15">
            {vm.recentIncidents.map((incident) => (
              <li key={incident.id} className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0 space-y-1">
                  <Link
                    href={`/incidents/${incident.id}`}
                    className="font-bold text-ink hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
                  >
                    {incident.title}
                  </Link>
                  <p className="text-xs text-ink-muted">
                    Detected {formatIsoDateTime(incident.createdAt)} · incident {incident.incidentId}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <StatusBadge
                      label={labelHealth(incident.overallStatus)}
                      tone={toneForHealth(incident.overallStatus === 'UNKNOWN' ? 'DEGRADED' : incident.overallStatus)}
                    />
                    <StatusBadge
                      label={labelInvestigationState(incident.finalState)}
                      tone={toneForTerminalState(incident.finalState)}
                    />
                    {incident.primaryExposure ? (
                      <StatusBadge
                        label={formatIdrDisplay(incident.primaryExposure)}
                        tone="warn"
                        title="Primary exposure from investigation output"
                      />
                    ) : null}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <CopyIdButton value={incident.id} label="Copy run ID" />
                  <Link href={`/incidents/${incident.id}`} className="lg-btn text-sm">
                    Open
                  </Link>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}
