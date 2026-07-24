import { describe, expect, it } from 'vitest';
import { writeInvestigationSummary } from '../../src/agent/datahub-client';
import { datasetUrn, gmsGraphql } from './helpers';

// ---------------------------------------------------------------------------
// FASE 6 pre-flight #1 — write-back idempotency.
//
// src/agent/orchestrator.ts calls writeInvestigationSummary() unconditionally
// once evidence is judged sufficient, regardless of whether this is the first
// time an asset was investigated or a retry after a prior attempt. Without a
// safeguard, N calls against the same asset would concatenate N notes onto the
// dataset description. src/datahub/mcp/agent_bridge.py::_compose_note_text()
// prevents this by always rebuilding the note region from the static,
// version-controlled baseline description (never a live read) and wrapping it
// in a fixed marker pair that is fully replaced -- never appended to -- on
// every write. These constants mirror agent_bridge.py's NOTE_MARKER_START /
// NOTE_MARKER_END and must be kept in sync with that file.
// ---------------------------------------------------------------------------

const NOTE_MARKER_START = '<!-- ledgerguard:investigation-note:start -->';
const TARGET_ASSET = 'inventory_valuation';

interface ReadDescription {
  dataset: {
    properties: { description: string | null } | null;
    editableProperties: { description: string | null } | null;
  } | null;
}

const QUERY = `
  query readDescription($urn: String!) {
    dataset(urn: $urn) {
      properties { description }
      editableProperties { description }
    }
  }
`;

async function readLiveDescription(): Promise<string> {
  const data = await gmsGraphql<ReadDescription>(QUERY, { urn: datasetUrn(TARGET_ASSET) });
  return data.dataset?.editableProperties?.description ?? data.dataset?.properties?.description ?? '';
}

function markerOccurrences(description: string): number {
  return description.split(NOTE_MARKER_START).length - 1;
}

describe('DataHub write-back idempotency (live DataHub, no accumulation across repeated write-backs)', () => {
  it('a second write-back for a different investigation replaces the first note instead of appending to it', async () => {
    const firstSummary = [
      'LedgerGuard investigation note',
      'Root cause: none detected by the deterministic engine.',
      'Investigation ID: idempotency-test-first-00000000.',
      'Status: pending human approval — no remediation has been executed.'
    ].join('\n');

    await writeInvestigationSummary(TARGET_ASSET, firstSummary);
    const afterFirst = await readLiveDescription();
    expect(markerOccurrences(afterFirst)).toBe(1);
    expect(afterFirst).toContain('idempotency-test-first-00000000');

    const secondSummary = [
      'LedgerGuard investigation note',
      'Root cause: unit conversion mismatch on CARTON (product_units.conversion_factor expected 12, actual 10).',
      'Investigation ID: idempotency-test-second-11111111.',
      'Status: pending human approval — no remediation has been executed.'
    ].join('\n');

    await writeInvestigationSummary(TARGET_ASSET, secondSummary);
    const afterSecond = await readLiveDescription();

    // Repeated write-back does not duplicate: exactly one note region exists,
    // and it belongs entirely to the latest investigation.
    expect(markerOccurrences(afterSecond)).toBe(1);
    expect(afterSecond).toContain('idempotency-test-second-11111111');
    expect(afterSecond).not.toContain('idempotency-test-first-00000000');

    // Different investigations still produce distinguishably different notes:
    // the root-cause line the second write carried is present verbatim, and it
    // differs from the first investigation's root-cause line.
    expect(afterSecond).toContain('unit conversion mismatch on CARTON');
  });

  it('writing the same summary twice in a row (simulating a retry after a transient failure) converges to one clean note, never a half-written or doubled one', async () => {
    const summary = [
      'LedgerGuard investigation note',
      'Root cause: unit conversion mismatch on CARTON (product_units.conversion_factor expected 12, actual 10).',
      'Investigation ID: idempotency-test-retry-22222222.',
      'Status: pending human approval — no remediation has been executed.'
    ].join('\n');

    // There is no fault-injection hook into the real MCP bridge, so a genuine
    // mid-write crash cannot be simulated against live infrastructure. What can
    // be proven directly is the property that makes retries safe in the first
    // place: _compose_note_text() always performs a full-region replace from a
    // static baseline, never an incremental append. So two writes of the exact
    // same content -- the original attempt, then a retry -- must land in
    // exactly the same final state as one write, with no duplication and no
    // partial marker left behind.
    await writeInvestigationSummary(TARGET_ASSET, summary);
    const afterOriginal = await readLiveDescription();

    await writeInvestigationSummary(TARGET_ASSET, summary);
    const afterRetry = await readLiveDescription();

    expect(markerOccurrences(afterRetry)).toBe(1);
    expect(afterRetry).toBe(afterOriginal);
    expect(afterRetry).toContain('idempotency-test-retry-22222222');
  });
});
