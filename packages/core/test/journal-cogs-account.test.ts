import { describe, expect, it } from 'vitest';
import { CONVERSION_MISMATCH_EXAMPLE, investigate, summarizeJournalCogs } from '@ledgerguard/core';
import { ACCOUNT } from './scenario-constants';
import { applyConversionErrorToFixture, buildHealthyFixture, toInvestigationInput } from './fixtures';

describe('COGS account is caller-supplied', () => {
  it('conversion-mismatch example account remains 5110 for compatibility', () => {
    expect(CONVERSION_MISMATCH_EXAMPLE.cogsAccountCode).toBe('5110');
    expect(CONVERSION_MISMATCH_EXAMPLE.cogsAccountCode).toBe(ACCOUNT.COGS);
  });

  it('summarizeJournalCogs only includes the supplied account', () => {
    const input = toInvestigationInput(buildHealthyFixture());
    const cogs = summarizeJournalCogs(input.journalEntries, ACCOUNT.COGS);
    const sales = summarizeJournalCogs(input.journalEntries, ACCOUNT.SALES);

    expect(cogs.entryIds.length).toBeGreaterThan(0);
    expect(cogs.postedCogs.isZero()).toBe(false);
    expect(sales.entryIds.length).toBeGreaterThan(0);
    expect(sales.postedCogs.toString()).not.toBe(cogs.postedCogs.toString());
  });

  it('investigate without cogsAccountCode matches explicit conversion-mismatch example code', () => {
    const input = toInvestigationInput(applyConversionErrorToFixture(buildHealthyFixture()));
    const implicit = investigate(input);
    const explicit = investigate({
      ...input,
      cogsAccountCode: CONVERSION_MISMATCH_EXAMPLE.cogsAccountCode
    });

    expect(implicit.financialImpact.primaryExposure).toBe(explicit.financialImpact.primaryExposure);
    expect(implicit.incidentType).toBe('UNIT_CONVERSION_MISMATCH');
  });
});
