import { describe, expect, it } from 'vitest';
import { ARTIFACTS, datasetUrn, readJson } from './helpers';

// FASE 3C — MCP mutation proof. Unlike the FASE 3B write-back proof (which
// tolerated an SDK fallback), this suite requires the full add -> verify ->
// restore -> verify cycle to happen entirely through the MCP server's own
// mutation tools. A silent SDK fallback here is treated as a failure, not a
// pass — the acceptance path must be BLOCKED instead if MCP mutation fails.

interface MutationToolsArtifact {
  mcp_server_tools: string[];
  required_mutation_tools: string[];
  missing_required_tools: string[];
  required_tools_present: boolean;
}

interface MutationProofReport {
  target_urn: string;
  mcp_server_tools: string[];
  required_tools_present: boolean;
  missing_required_tools: string[];
  baseline_tags: string[];
  baseline_description: string;
  tag_added_via_mcp: boolean;
  note_updated_via_mcp: boolean;
  tag_verified_after_write: boolean;
  note_verified_after_write: boolean;
  tag_removed_via_mcp: boolean;
  description_restored_via_mcp: boolean;
  final_tags: string[];
  final_description: string;
  final_clean: boolean;
  write_path: string;
  verdict: string;
  activity_log: string;
  activity_entries: number;
  notes: string[];
  passed: boolean;
}

const tools = readJson<MutationToolsArtifact>(ARTIFACTS.mutationTools);
const report = readJson<MutationProofReport>(ARTIFACTS.mutationProof);

describe('datahub mcp mutation tools', () => {
  it('exposes the minimum required mutation tools', () => {
    expect(tools.mcp_server_tools).toContain('add_tags');
    expect(tools.mcp_server_tools).toContain('remove_tags');
    expect(tools.mcp_server_tools).toContain('update_description');
    expect(tools.missing_required_tools).toEqual([]);
    expect(tools.required_tools_present).toBe(true);
  });
});

describe('datahub mcp mutation proof', () => {
  it('targets the demo dataset, never a production asset', () => {
    expect(report.target_urn).toBe(datasetUrn('inventory_valuation'));
  });

  it('confirms mutation tools were enabled for this run', () => {
    expect(report.required_tools_present).toBe(true);
    expect(report.missing_required_tools).toEqual([]);
  });

  it('adds the At Risk tag through MCP (add_tags)', () => {
    expect(report.tag_added_via_mcp).toBe(true);
  });

  it('writes the investigation note through MCP (update_description)', () => {
    expect(report.note_updated_via_mcp).toBe(true);
  });

  it('verifies the write by reading the asset back through MCP', () => {
    expect(report.tag_verified_after_write).toBe(true);
    expect(report.note_verified_after_write).toBe(true);
  });

  it('restores the baseline through MCP (remove_tags, update_description)', () => {
    expect(report.tag_removed_via_mcp).toBe(true);
    expect(report.description_restored_via_mcp).toBe(true);
  });

  it('confirms the final state is byte-identical to baseline, nothing else changed', () => {
    expect(report.final_clean).toBe(true);
    expect(report.final_tags).toEqual(report.baseline_tags);
    expect(report.final_description).toBe(report.baseline_description);
    expect(report.final_tags).not.toContain('urn:li:tag:At Risk');
    expect(report.final_description).not.toContain('LedgerGuard MCP mutation proof');
  });

  it('never falls back to the SDK for the acceptance path', () => {
    expect(report.write_path).toBe('mcp');
    expect(report.verdict).toBe('OK');
  });

  it('passes overall, with a real activity log to back it up', () => {
    expect(report.passed).toBe(true);
    expect(report.activity_entries).toBeGreaterThan(0);
    expect(report.activity_log).toContain('mutation-activity-log.jsonl');
  });
});
