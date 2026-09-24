import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { IncidentInvestigationReport } from '@ledgerguard/core';
import { buildUserPrompt } from '../../../src/agent/prompts/investigation-v1';
import { buildDataHubContextFixture } from './fixtures';

const root = resolve(process.cwd());

describe('buildUserPrompt', () => {
  it('includes ALLOWED_CITATIONS and does not truncate the conversion-error engine report', () => {
    const engineResult = JSON.parse(
      readFileSync(resolve(root, 'examples/investigations/conversion-error-investigation.json'), 'utf8')
    ) as IncidentInvestigationReport;
    const datahubContext = buildDataHubContextFixture();

    const prompt = buildUserPrompt({
      incidentId: 'incident-prompt-pack',
      triggerAsset: 'inventory_valuation',
      engineResult,
      datahubContext
    });

    expect(prompt).toContain('ALLOWED_CITATIONS');
    expect(prompt).not.toContain('(truncated)');
    expect(prompt).toContain(datahubContext.assetsRead[0]);
    expect(prompt).toContain('"label": "primaryExposure"');
    expect(prompt).toContain('"label": "evidenceRecordCount"');
    // Compact projection keeps a sample, not the full evidence list dump.
    expect(prompt).toContain('evidenceRecordsSample');
    expect(prompt.length).toBeLessThan(100000);
  });
});
