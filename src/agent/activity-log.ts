import type { ActivityLogEntry } from './types';

// ---------------------------------------------------------------------------
// One activity log per investigation run. DataHub MCP calls arrive already
// formed (mapped in datahub-client.ts from the Python bridge's own timing) and
// are ingested verbatim; engine and model calls are timed here directly via
// record(). Sequence numbers are only assigned at finalize() time, by sorted
// start time, so entries from multiple sources (two separate bridge
// subprocesses plus in-process engine/model calls) merge into one coherent,
// chronologically ordered log instead of colliding on their per-source seq.
//
// Per FASE 5: never persist a token, credential, or chain-of-thought here —
// sanitizeError() redacts anything shaped like a secret before it is stored.
// ---------------------------------------------------------------------------

const MAX_SUMMARY_CHARS = 600;
const MAX_ERROR_CHARS = 300;
const MIN_REDACTED_TOKEN_LENGTH = 32;

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max)}…(truncated)` : value;
}

function summarize(value: unknown, max = MAX_SUMMARY_CHARS): string {
  if (typeof value === 'string') return truncate(value, max);
  try {
    return truncate(JSON.stringify(value), max);
  } catch {
    return truncate(String(value), max);
  }
}

function sanitizeError(err: unknown): string {
  const raw = err instanceof Error ? `${err.name}: ${err.message}` : summarize(err, MAX_ERROR_CHARS);
  const redacted = raw
    .replace(/(Bearer|Authorization:?)\s+\S+/gi, '$1 [redacted]')
    .replace(/([A-Za-z0-9_-]*(?:key|token|secret|password|credential)[A-Za-z0-9_-]*\s*[:=]\s*)("[^"]*"|'[^']*'|\S+)/gi, '$1[redacted]')
    .replace(new RegExp(`\\b[A-Za-z0-9_-]{${MIN_REDACTED_TOKEN_LENGTH},}\\b`, 'g'), '[redacted]');
  return truncate(redacted, MAX_ERROR_CHARS);
}

export interface ActivityRecordOptions {
  input?: unknown;
}

export class ActivityLogger {
  private readonly entries: ActivityLogEntry[] = [];

  ingest(entries: ActivityLogEntry[]): void {
    this.entries.push(...entries);
  }

  async record<T>(tool: string, fn: () => Promise<T> | T, options: ActivityRecordOptions = {}): Promise<T> {
    const startedAt = new Date();
    try {
      const result = await fn();
      this.entries.push({
        seq: 0,
        tool,
        startedAt: startedAt.toISOString(),
        finishedAt: new Date().toISOString(),
        durationMs: Date.now() - startedAt.getTime(),
        inputSummary: summarize(options.input),
        outputSummary: summarize(result),
        status: 'OK',
        errorSanitized: null
      });
      return result;
    } catch (err) {
      this.entries.push({
        seq: 0,
        tool,
        startedAt: startedAt.toISOString(),
        finishedAt: new Date().toISOString(),
        durationMs: Date.now() - startedAt.getTime(),
        inputSummary: summarize(options.input),
        outputSummary: '',
        status: 'ERROR',
        errorSanitized: sanitizeError(err)
      });
      throw err;
    }
  }

  finalize(): ActivityLogEntry[] {
    return [...this.entries]
      .sort((a, b) => new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime())
      .map((entry, index) => ({ ...entry, seq: index + 1 }));
  }
}
