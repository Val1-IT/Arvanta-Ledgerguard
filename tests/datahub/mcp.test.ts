import { describe, expect, it } from 'vitest';
import { ARTIFACTS, readJson, readJsonl } from './helpers';

// Smoke test for the self-hosted DataHub MCP server. The proof itself runs in
// global setup; here we assert that all seven required steps passed against the
// live server and that the activity log is a real record of the calls made.

interface ProofStep {
  number: number;
  name: string;
  tool: string;
  passed: boolean;
  detail: string;
  evidence: string;
}

interface ProofReport {
  gms_reachable: boolean;
  mcp_server: string;
  available_tools: string[];
  steps: ProofStep[];
  activity_log: string;
  activity_entries: number;
  passed: boolean;
}

interface ActivityEntry {
  seq: number;
  timestamp: string;
  tool: string;
  input: string;
  result: string;
  ok: boolean;
  duration_ms: number;
}

const report = readJson<ProofReport>(ARTIFACTS.mcpProof);
const log = readJsonl<ActivityEntry>(ARTIFACTS.mcpActivityLog);

describe('datahub mcp connectivity', () => {
  it('connects to the self-hosted MCP server and exposes tools', () => {
    expect(report.gms_reachable).toBe(true);
    expect(report.available_tools.length).toBeGreaterThan(0);
  });

  it('completes all seven proof steps', () => {
    expect(report.steps.map((s) => s.number)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    const failed = report.steps.filter((s) => !s.passed);
    expect(failed.map((s) => `${s.number}. ${s.name}: ${s.detail}`)).toEqual([]);
    expect(report.passed).toBe(true);
  });

  it('reads conversion_factor, an owner, tags and terms through MCP', () => {
    const byNumber = new Map(report.steps.map((s) => [s.number, s]));
    expect(byNumber.get(3)!.evidence).toContain('conversion_factor');
    expect(byNumber.get(4)!.evidence).toContain('urn:li:corpGroup:');
    expect(byNumber.get(5)!.evidence).toContain('urn:li:glossaryTerm:');
    expect(byNumber.get(5)!.evidence).toContain('urn:li:tag:');
  });

  it('traverses lineage to gross_margin_report through MCP', () => {
    const step = report.steps.find((s) => s.number === 6)!;
    expect(step.passed).toBe(true);
    // `evidence` is a 700-char truncated sample of the raw MCP response (which
    // lists facets/aggregations before the matching search result), so the
    // reliable assertion is against `detail`, the step's own summary of which
    // downstream assets were actually found.
    expect(step.detail).toContain('gross_margin_report');
  });

  it('writes a real activity log with tool, time, input and result', () => {
    // Steps 4 and 5 read owner/tags/terms from the same entity fetch made in
    // step 2 rather than issuing their own MCP calls, so the log is shorter
    // than the step count — what matters is that it's non-empty and internally
    // consistent with the report.
    expect(log.length).toBeGreaterThan(0);
    expect(log.length).toBe(report.activity_entries);

    for (const entry of log) {
      expect(entry.tool).not.toHaveLength(0);
      expect(Number.isNaN(Date.parse(entry.timestamp))).toBe(false);
      expect(entry.input).not.toHaveLength(0);
      expect(entry.result).not.toHaveLength(0);
      expect(entry.duration_ms).toBeGreaterThanOrEqual(0);
    }

    // Every tool the log names must be one the live server actually advertised.
    for (const entry of log) {
      expect(report.available_tools).toContain(entry.tool);
    }
  });
});
