import { describe, expect, it } from 'vitest';
import { resolveDataHubIncident } from '../../src/agent/datahub-client';
import { datasetUrn, gmsGraphql } from './helpers';

// ---------------------------------------------------------------------------
// FASE 6 test checklist item 14/14 — live DataHub resolution write-back
// (src/remediation/writeback.ts -> resolveDataHubIncident() -> the `resolve`
// subcommand of src/datahub/mcp/agent_bridge.py). This is the only step that
// runs after a remediation plan reaches RESOLVED: it removes the `At Risk`
// tag and, since verification already PASSed, adds `Trusted` on top.
//
// Deliberately targets `gross_margin_report` rather than `inventory_valuation`
// (the asset tests/datahub/writeback.test.ts and writeback-idempotency.test.ts
// exercise) so this file has no shared mutable state with those tests and no
// dependency on cross-file execution order. gross_margin_report's bootstrap
// baseline (src/datahub/bootstrap/assets.py) carries no `At Risk` tag, so
// removal here is a no-op remove_tags call — verified by _try_call succeeding
// even when the tag was never present — which is exactly the same code path a
// real resolution hits.
//
// No afterAll restore: the next full suite run's global setup re-bootstraps
// every asset from its static definition (see global-setup.ts), which
// overwrites this test's mutation regardless; nothing else in this suite reads
// gross_margin_report's tags or description.
// ---------------------------------------------------------------------------

const TARGET_ASSET = 'gross_margin_report';

interface ReadAfterResolve {
  dataset: {
    properties: { description: string | null } | null;
    editableProperties: { description: string | null } | null;
    tags: { tags: { tag: { urn: string } }[] } | null;
  } | null;
}

const QUERY = `
  query readAfterResolve($urn: String!) {
    dataset(urn: $urn) {
      properties { description }
      editableProperties { description }
      tags { tags { tag { urn } } }
    }
  }
`;

describe('DataHub resolution write-back (live MCP, post-verification RESOLVED path)', () => {
  it('removes At Risk, adds Trusted, and writes a resolution note — verified independently via GMS', async () => {
    const summaryText = [
      'LedgerGuard remediation resolution note',
      'Incident incident-remediation-resolve-test has been remediated and verified.',
      'Remediation plan ID: plan-remediation-resolve-test.',
      'Status: resolved — the At Risk flag has been cleared.'
    ].join('\n');

    const result = await resolveDataHubIncident(TARGET_ASSET, true, summaryText);

    expect(result.atRiskTagRemoved).toBe(true);
    expect(result.trustedTagAdded).toBe(true);
    expect(result.noteWritten).toBe(true);
    expect(['mcp', 'sdk']).toContain(result.writePath);

    const data = await gmsGraphql<ReadAfterResolve>(QUERY, { urn: datasetUrn(TARGET_ASSET) });
    const tags = data.dataset?.tags?.tags.map((t) => t.tag.urn) ?? [];
    expect(tags).not.toContain('urn:li:tag:At Risk');
    expect(tags).toContain('urn:li:tag:Trusted');

    const description =
      data.dataset?.editableProperties?.description ?? data.dataset?.properties?.description ?? '';
    expect(description).toContain('LedgerGuard remediation resolution note');
    expect(description).toContain('plan-remediation-resolve-test');
  });

  it('is idempotent: resolving an already-resolved asset again reports success without duplicating the note', async () => {
    const summaryText = [
      'LedgerGuard remediation resolution note',
      'Incident incident-remediation-resolve-test has been remediated and verified.',
      'Remediation plan ID: plan-remediation-resolve-test-second.',
      'Status: resolved — the At Risk flag has been cleared.'
    ].join('\n');

    const result = await resolveDataHubIncident(TARGET_ASSET, true, summaryText);
    expect(result.atRiskTagRemoved).toBe(true);
    expect(result.trustedTagAdded).toBe(true);

    const data = await gmsGraphql<ReadAfterResolve>(QUERY, { urn: datasetUrn(TARGET_ASSET) });
    const tags = data.dataset?.tags?.tags.map((t) => t.tag.urn) ?? [];
    const trustedOccurrences = tags.filter((t) => t === 'urn:li:tag:Trusted').length;
    expect(trustedOccurrences).toBe(1);

    const description =
      data.dataset?.editableProperties?.description ?? data.dataset?.properties?.description ?? '';
    expect(description).toContain('plan-remediation-resolve-test-second');
    expect(description).not.toContain('plan-remediation-resolve-test.');
  });
});
