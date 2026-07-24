import { describe, expect, it } from 'vitest';
import { ActivityLogger } from '../../../src/agent/activity-log';
import type { ActivityLogEntry } from '../../../src/agent/types';

// ---------------------------------------------------------------------------
// ActivityLogger (src/agent/activity-log.ts) is what makes the agent's
// activity log auditable and safe to persist: every tool call is timed and
// captured (success or failure), errors are sanitized before storage, and
// entries ingested from other sources (the DataHub Python bridge) merge with
// in-process calls into one chronologically ordered, resequenced log.
// ---------------------------------------------------------------------------

describe('ActivityLogger.record — success path', () => {
  it('captures a successful call with timing, input/output summaries, OK status, and seq starting at 1', async () => {
    const logger = new ActivityLogger();

    const result = await logger.record('engine.investigate', () => ({ ok: true, count: 3 }), {
      input: { incidentId: 'inc-1' }
    });

    expect(result).toEqual({ ok: true, count: 3 });
    const [entry] = logger.finalize();
    expect(entry.tool).toBe('engine.investigate');
    expect(entry.status).toBe('OK');
    expect(entry.errorSanitized).toBeNull();
    expect(entry.inputSummary).toContain('inc-1');
    expect(entry.outputSummary).toContain('"count":3');
    expect(entry.seq).toBe(1);
    expect(entry.durationMs).toBeGreaterThanOrEqual(0);
  });
});

describe('ActivityLogger.record — failure path', () => {
  it('records an ERROR entry with a sanitized message and still rethrows the original error', async () => {
    const logger = new ActivityLogger();
    const secretToken = 'A'.repeat(40);

    await expect(
      logger.record('model.generateInvestigation', () => {
        throw new Error(`upstream rejected apiKey=${secretToken}`);
      })
    ).rejects.toThrow(`upstream rejected apiKey=${secretToken}`);

    const [entry] = logger.finalize();
    expect(entry.status).toBe('ERROR');
    expect(entry.outputSummary).toBe('');
    expect(entry.errorSanitized).not.toBeNull();
    expect(entry.errorSanitized).not.toContain(secretToken);
    expect(entry.errorSanitized).toContain('[redacted]');
  });
});

describe('ActivityLogger.ingest + finalize — merges and reorders across sources', () => {
  it('merges externally-supplied entries with in-process record() calls into one chronologically ordered, resequenced log', async () => {
    const logger = new ActivityLogger();
    const earlier: ActivityLogEntry = {
      seq: 99,
      tool: 'datahub.search',
      startedAt: '2026-01-01T00:00:00.000Z',
      finishedAt: '2026-01-01T00:00:01.000Z',
      durationMs: 1000,
      inputSummary: '{}',
      outputSummary: '{}',
      status: 'OK',
      errorSanitized: null
    };

    logger.ingest([earlier]);
    await logger.record('engine.investigate', () => 'done'); // starts well after 2026-01-01

    const finalized = logger.finalize();
    expect(finalized).toHaveLength(2);
    expect(finalized[0].tool).toBe('datahub.search');
    expect(finalized[0].seq).toBe(1);
    expect(finalized[1].tool).toBe('engine.investigate');
    expect(finalized[1].seq).toBe(2);
  });
});
