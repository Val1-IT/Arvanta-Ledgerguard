import Link from 'next/link';
import { getServerPool } from '../../src/agent/server-pool';
import { CopyIdButton } from '../../src/ui/components/copy-id-button';
import { EmptyState } from '../../src/ui/components/empty-state';
import { ErrorState } from '../../src/ui/components/error-state';
import { PageHeader } from '../../src/ui/components/page-header';
import { Panel } from '../../src/ui/components/panel';
import { StatusBadge, toneForTerminalState } from '../../src/ui/components/status-badge';
import { formatIdrDisplay, formatIsoDateTime } from '../../src/ui/lib/format-display';
import { listInvestigationRuns } from '../../src/ui/server/queries';

export const dynamic = 'force-dynamic';

export default async function IncidentsPage() {
  try {
    const runs = await listInvestigationRuns(getServerPool(), 50);
    return (
      <div className="space-y-6">
        <PageHeader
          title="Incidents"
          description="Persisted investigation runs from the LedgerGuard agent. Route id is the investigation run id."
        />
        <Panel title={`${runs.length} run(s)`}>
          {runs.length === 0 ? (
            <EmptyState
              title="No incidents yet"
              description="Simulate a conversion error from Overview to create one."
              action={
                <Link href="/overview" className="lg-btn-gold">
                  Go to Overview
                </Link>
              }
            />
          ) : (
            <ul className="divide-y divide-ink/15">
              {runs.map((run) => (
                <li key={run.investigationId} className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="space-y-2">
                    <Link
                      href={`/incidents/${run.investigationId}`}
                      className="font-bold hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
                    >
                      {run.incidentId}
                    </Link>
                    <div className="flex flex-wrap gap-2">
                      <StatusBadge label={run.finalState} tone={toneForTerminalState(run.finalState)} />
                      {run.output?.engineResultReference.primaryExposure ? (
                        <StatusBadge
                          label={formatIdrDisplay(run.output.engineResultReference.primaryExposure)}
                          tone="warn"
                        />
                      ) : null}
                    </div>
                    <p className="text-xs text-ink-muted">{formatIsoDateTime(run.createdAt)}</p>
                  </div>
                  <div className="flex gap-2">
                    <CopyIdButton value={run.investigationId} />
                    <Link href={`/incidents/${run.investigationId}`} className="lg-btn text-sm">
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
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to load incidents';
    return (
      <div className="space-y-6">
        <PageHeader title="Incidents" />
        <ErrorState title="Incidents unavailable" message={message} />
      </div>
    );
  }
}
