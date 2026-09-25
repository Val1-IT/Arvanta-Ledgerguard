import Link from 'next/link';
import { loadInvestigationRun } from '../../../../src/db/repositories/investigation-runs';
import { getServerPool } from '../../../../src/agent/server-pool';
import type { ActivityLogEntry } from '../../../../src/agent/types';
import { labelModelSource } from '../../../../src/ui/lib/status-labels';

// ---------------------------------------------------------------------------
// Read-only view of one persisted investigation run (src/agent/orchestrator.ts
// via saveInvestigationRun). Renders the state history, the activity log
// entries, and — when present — the reconciled output or the recorded
// failure. Nothing here executes remediation or writes anything back; it only
// reads investigation_runs (src/db/repositories/investigation-runs.ts).
// ---------------------------------------------------------------------------

const FAILURE_STATES = new Set([
  'MCP_UNAVAILABLE',
  'DATASET_NOT_FOUND',
  'LINEAGE_INCOMPLETE',
  'ENGINE_FAILED',
  'MODEL_OUTPUT_INVALID',
  'EVIDENCE_INSUFFICIENT',
  'WRITEBACK_FAILED'
]);

function stateTagClass(state: string): string {
  if (state === 'INVESTIGATION_COMPLETED') return 'border-healthy text-healthy';
  if (FAILURE_STATES.has(state)) return 'border-risk text-risk';
  return 'border-ink text-ink-muted';
}

function overallStatusClass(status: string): string {
  if (status === 'HEALTHY') return 'border-healthy text-healthy';
  if (status === 'DEGRADED') return 'border-warn text-warn';
  return 'border-risk text-risk';
}

function ActivityLogTable({ entries }: { entries: ActivityLogEntry[] }) {
  if (entries.length === 0) {
    return <p className="text-sm text-ink-muted">No activity log entries were recorded.</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[720px] border-collapse text-left text-sm">
        <thead>
          <tr className="border-b-2 border-ink">
            <th className="py-2 pr-3">#</th>
            <th className="py-2 pr-3">Tool</th>
            <th className="py-2 pr-3">Status</th>
            <th className="py-2 pr-3">Duration</th>
            <th className="py-2 pr-3">Input</th>
            <th className="py-2 pr-3">Output / Error</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((entry) => (
            <tr key={entry.seq} className="border-b border-ink/20 align-top">
              <td className="py-2 pr-3 font-mono">{entry.seq}</td>
              <td className="py-2 pr-3 font-mono">{entry.tool}</td>
              <td className="py-2 pr-3">
                <span className={`lg-tag ${entry.status === 'OK' ? 'border-healthy text-healthy' : 'border-risk text-risk'}`}>
                  {entry.status}
                </span>
              </td>
              <td className="py-2 pr-3 font-mono">{entry.durationMs}ms</td>
              <td className="max-w-xs break-words py-2 pr-3 font-mono text-xs text-ink-muted">{entry.inputSummary}</td>
              <td className="max-w-xs break-words py-2 pr-3 font-mono text-xs text-ink-muted">
                {entry.status === 'OK' ? entry.outputSummary : entry.errorSanitized}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default async function InvestigationRunPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const record = await loadInvestigationRun(getServerPool(), id);

  if (!record) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold tracking-tight">Investigation not found</h1>
        <div className="lg-panel p-6">
          <p className="text-ink-muted">
            No investigation run with ID <span className="font-mono">{id}</span> exists.
          </p>
          <Link href="/agent" className="lg-btn mt-4 inline-flex">
            Back to agent
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            Investigation <span className="font-mono text-gold-strong">{record.investigationId}</span>
          </h1>
          <p className="mt-1 text-ink-muted">
            Incident <span className="font-mono">{record.incidentId}</span> · requested by{' '}
            <span className="font-mono">{record.input.requestedBy}</span> · mode {record.input.mode} · created{' '}
            {record.createdAt}
          </p>
        </div>
        <span className={`lg-tag ${stateTagClass(record.finalState)}`}>{record.finalState}</span>
      </div>

      <div className="lg-panel space-y-3 p-6">
        <h2 className="font-bold">State history</h2>
        <ol className="flex flex-wrap gap-2 text-xs">
          {record.stateHistory.map((entry, index) => (
            <li key={`${entry.state}-${index}`} className={`lg-tag ${stateTagClass(entry.state)}`}>
              {index + 1}. {entry.state}
            </li>
          ))}
        </ol>
      </div>

      {record.error && (
        <div className="lg-panel space-y-2 border-risk p-6">
          <h2 className="font-bold text-risk">Failure: {record.error.failureState}</h2>
          <p className="text-sm text-ink-muted">{record.error.message}</p>
          <p className="text-xs text-ink-muted">Occurred at {record.error.occurredAt}</p>
        </div>
      )}

      {record.output && (
        <div className="lg-panel space-y-4 p-6">
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="font-bold">Output</h2>
            <span className="lg-tag border-ink text-ink-muted">{record.output.status}</span>
            <span className={`lg-tag ${overallStatusClass(record.output.engineResultReference.overallStatus)}`}>
              {record.output.engineResultReference.overallStatus}
            </span>
            <span className="lg-tag border-ink text-ink-muted">
              Evidence {record.output.evidenceSufficiency.sufficient ? 'sufficient' : 'insufficient'} (
              {record.output.evidenceSufficiency.confidence})
            </span>
          </div>

          <div>
            <h3 className="text-sm font-semibold">Root cause</h3>
            <p className="text-sm text-ink-muted">{record.output.rootCauseExplanation}</p>
          </div>
          <div>
            <h3 className="text-sm font-semibold">Business impact</h3>
            <p className="text-sm text-ink-muted">{record.output.businessImpactExplanation}</p>
          </div>
          <div>
            <h3 className="text-sm font-semibold">Remediation rationale (not executed)</h3>
            <p className="text-sm text-ink-muted">{record.output.remediationRationale}</p>
            <p className="mt-1 text-xs text-ink-muted">Recommended next step: {record.output.recommendedNextStep}</p>
          </div>

          <div className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
            <div>
              <div className="text-xs text-ink-muted">Primary exposure</div>
              <div className="font-mono">
                {record.output.engineResultReference.primaryExposure} {record.output.engineResultReference.currency}
              </div>
            </div>
            <div>
              <div className="text-xs text-ink-muted">Affected records</div>
              <div className="font-mono">{record.output.engineResultReference.affectedRecordCount}</div>
            </div>
            <div>
              <div className="text-xs text-ink-muted">Correction targets</div>
              <div className="font-mono">{record.output.engineResultReference.correctionTargetCount}</div>
            </div>
            <div>
              <div className="text-xs text-ink-muted">Incident type</div>
              <div className="font-mono">{record.output.engineResultReference.incidentType ?? 'none'}</div>
            </div>
          </div>

          <div>
            <h3 className="text-sm font-semibold">DataHub context</h3>
            {record.output.provenance ? (
              <p className="mb-2 text-xs text-ink-muted">
                DataHub context:{' '}
                {record.output.provenance.datahubSource === 'LIVE_MCP'
                  ? 'Live MCP'
                  : record.output.provenance.datahubSource === 'STATIC_DEMO_CONTEXT'
                    ? 'Demo context fallback'
                    : record.output.provenance.datahubSource === 'NOT_CONFIGURED'
                      ? 'Not configured'
                      : 'Unavailable'}
                {' · '}Model narration: {labelModelSource(record.output.provenance.modelSource)}
                {' · '}Fallback used: {record.output.provenance.fallbackUsed ? 'Yes' : 'No'}
              </p>
            ) : null}
            <dl className="grid grid-cols-1 gap-2 text-xs sm:grid-cols-2">
              <div>
                <dt className="text-ink-muted">Assets read</dt>
                <dd className="font-mono">{record.output.datahubContext.assetsRead.join(', ') || '(none)'}</dd>
              </div>
              <div>
                <dt className="text-ink-muted">Owners</dt>
                <dd className="font-mono">{record.output.datahubContext.owners.join(', ') || '(none)'}</dd>
              </div>
              <div>
                <dt className="text-ink-muted">Glossary terms</dt>
                <dd className="font-mono">{record.output.datahubContext.glossaryTerms.join(', ') || '(none)'}</dd>
              </div>
              <div>
                <dt className="text-ink-muted">Tags</dt>
                <dd className="font-mono">{record.output.datahubContext.tags.join(', ') || '(none)'}</dd>
              </div>
              <div className="sm:col-span-2">
                <dt className="text-ink-muted">Lineage path</dt>
                <dd className="font-mono">{record.output.datahubContext.lineagePath.join(' -> ') || '(none)'}</dd>
              </div>
            </dl>
          </div>
        </div>
      )}

      <div className="lg-panel space-y-4 p-6">
        <h2 className="font-bold">Activity log</h2>
        <ActivityLogTable entries={record.output?.activityLog ?? []} />
      </div>

      <Link href="/agent" className="lg-btn inline-flex">
        Run another investigation
      </Link>
    </div>
  );
}
