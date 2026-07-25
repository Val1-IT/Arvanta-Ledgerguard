import type { IncidentDetailViewModel } from '../view-models/incident-detail';
import { StatusBadge } from './status-badge';

type Entry = IncidentDetailViewModel['investigation']['activityLog'][number];

export function ActivityLogTable({
  entries,
  note
}: {
  entries: Entry[];
  note?: string | null;
}) {
  return (
    <div className="space-y-3">
      {note ? <p className="text-xs text-ink-muted">{note}</p> : null}
      {entries.length === 0 ? (
        <p className="text-sm text-ink-muted">No activity log entries were recorded.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] border-collapse text-left text-sm">
            <caption className="sr-only">Investigation activity log</caption>
            <thead>
              <tr className="border-b-2 border-ink">
                <th scope="col" className="py-2 pr-3">#</th>
                <th scope="col" className="py-2 pr-3">Tool</th>
                <th scope="col" className="py-2 pr-3">Status</th>
                <th scope="col" className="py-2 pr-3">Duration</th>
                <th scope="col" className="py-2 pr-3">Input</th>
                <th scope="col" className="py-2 pr-3">Output / Error</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <tr key={entry.seq} className="border-b border-ink/20 align-top">
                  <td className="py-2 pr-3 font-mono">{entry.seq}</td>
                  <td className="py-2 pr-3 font-mono">{entry.tool}</td>
                  <td className="py-2 pr-3">
                    <StatusBadge
                      label={entry.status}
                      tone={entry.status === 'OK' ? 'healthy' : 'risk'}
                    />
                  </td>
                  <td className="py-2 pr-3 font-mono">{entry.durationMs}ms</td>
                  <td className="max-w-xs break-words py-2 pr-3 font-mono text-xs text-ink-muted">
                    {entry.inputSummary}
                  </td>
                  <td className="max-w-xs break-words py-2 pr-3 font-mono text-xs text-ink-muted">
                    {entry.status === 'OK' ? entry.outputSummary : entry.errorSanitized}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
