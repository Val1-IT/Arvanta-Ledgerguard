import { describe, expect, it } from 'vitest';
import { ARTIFACTS, datasetUrn, gmsGraphql, readJson } from './helpers';

// Write-back proof: the `At Risk` tag and the investigation note must be
// verifiable *after* the write, both through MCP (the agent's own interface) and
// independently through GMS, so persistence is not taken on trust.

interface WritebackReport {
  target_urn: string;
  write_path: string;
  mutation_tools_available: string[];
  tag_written: boolean;
  note_written: boolean;
  tag_verified_via_mcp: boolean;
  note_verified_via_mcp: boolean;
  activity_log: string;
  notes: string[];
  passed: boolean;
}

interface ReadAfterWrite {
  dataset: {
    properties: { description: string | null } | null;
    editableProperties: { description: string | null } | null;
    tags: { tags: { tag: { urn: string } }[] } | null;
  } | null;
}

const QUERY = `
  query readAfterWrite($urn: String!) {
    dataset(urn: $urn) {
      properties { description }
      editableProperties { description }
      tags { tags { tag { urn } } }
    }
  }
`;

const report = readJson<WritebackReport>(ARTIFACTS.writeback);

describe('datahub write-back', () => {
  it('targets the demo dataset, never a production asset', () => {
    expect(report.target_urn).toBe(datasetUrn('inventory_valuation'));
  });

  it('records which write path was used', () => {
    expect(['mcp', 'sdk']).toContain(report.write_path);
    if (report.write_path === 'sdk') {
      // The user's brief allows the SDK as a supporting operation, but only if
      // the fallback is documented rather than silent.
      expect(report.notes.join(' ')).toMatch(/SDK/i);
    }
  });

  it('writes the At Risk tag and the investigation note', () => {
    expect(report.tag_written).toBe(true);
    expect(report.note_written).toBe(true);
  });

  it('verifies both writes by reading the asset back through MCP', () => {
    expect(report.tag_verified_via_mcp).toBe(true);
    expect(report.note_verified_via_mcp).toBe(true);
    expect(report.passed).toBe(true);
  });

  it('persists in DataHub itself (independent GMS read-after-write)', async () => {
    const data = await gmsGraphql<ReadAfterWrite>(QUERY, {
      urn: datasetUrn('inventory_valuation')
    });
    const tags = data.dataset?.tags?.tags.map((t) => t.tag.urn) ?? [];
    expect(tags).toContain('urn:li:tag:At Risk');
    const description =
      data.dataset?.editableProperties?.description ?? data.dataset?.properties?.description ?? '';
    expect(description).toContain('LedgerGuard investigation note');
  });
});
