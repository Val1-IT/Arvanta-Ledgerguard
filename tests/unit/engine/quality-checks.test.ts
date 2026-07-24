import { describe, expect, it } from 'vitest';
import { investigate } from '../../../src/engine/investigate';
import { ConversionFactorPositiveCheck, JournalBalanceCheck } from '../../../src/engine/quality-checks';
import { verifyState } from '../../../src/engine/verify';
import { buildHealthyFixture, toInvestigationInput } from './fixtures';

describe('ConversionFactorPositiveCheck — zero factor (case 4)', () => {
  it('flags critical without dividing by zero anywhere downstream', () => {
    const healthy = buildHealthyFixture();
    const zeroed = {
      ...healthy,
      productUnits: healthy.productUnits.map((u) => (u.unitName === 'CARTON' ? { ...u, conversionFactor: '0.0000' } : u))
    };
    const input = toInvestigationInput(zeroed);

    const result = new ConversionFactorPositiveCheck().evaluate(input);
    expect(result.status).toBe('FAIL');
    expect(result.severity).toBe('critical');
    expect(result.affectedRecordIds).toEqual(['pu-carton']);

    // The whole pipeline must run to completion — no NaN/Infinity anywhere,
    // because impact recomputation always uses the baseline (expected) factor,
    // never the corrupted current one, for multiplication.
    expect(() => investigate(input)).not.toThrow();
    const report = investigate(input);
    expect(report.rootCause).not.toBeNull();
    expect(Number.isFinite(Number(report.financialImpact.totalExposure))).toBe(true);

    const restoreCorrection = report.proposedCorrections.find((c) => c.action === 'RESTORE_CONVERSION_FACTOR');
    expect(restoreCorrection).toMatchObject({ beforeValue: '0.0000', afterValue: '12.0000' });
  });
});

describe('ConversionFactorPositiveCheck — negative factor (case 5)', () => {
  it('rejects a negative conversion_factor as critical', () => {
    const healthy = buildHealthyFixture();
    const negative = {
      ...healthy,
      productUnits: healthy.productUnits.map((u) => (u.unitName === 'CARTON' ? { ...u, conversionFactor: '-12.0000' } : u))
    };
    const input = toInvestigationInput(negative);

    const result = new ConversionFactorPositiveCheck().evaluate(input);
    expect(result.status).toBe('FAIL');
    expect(result.severity).toBe('critical');
    expect(result.evidence[0].actualValue).toBe('-12.0000');

    expect(() => investigate(input)).not.toThrow();
  });
});

describe('JournalBalanceCheck — pre-existing imbalance independent of the incident (case 7)', () => {
  it('fails on a structural imbalance even when no conversion-factor incident exists', () => {
    const healthy = buildHealthyFixture();
    // Corrupt one purchase journal entry's debit so its source no longer balances.
    // The conversion factor itself is untouched — this must NOT be reported as
    // a conversion incident, but the journal check must still fail.
    const brokenJournals = healthy.journalEntries.map((e) =>
      e.id === 'je-p-1-inv' ? { ...e, debit: '999999.00' } : e
    );
    const input = toInvestigationInput({ ...healthy, journalEntries: brokenJournals });

    const journalResult = new JournalBalanceCheck().evaluate(input);
    expect(journalResult.status).toBe('FAIL');
    expect(journalResult.severity).toBe('critical');

    const report = investigate(input);
    expect(report.incidentType).toBe('HEALTHY'); // no conversion-factor change was introduced
    expect(report.rootCause).toBeNull();

    const journalCheckInReport = report.qualityChecks.find((c) => c.checkId === 'JOURNAL_BALANCE');
    expect(journalCheckInReport?.status).toBe('FAIL');
    // Every other check is unaffected by this unrelated, pre-existing problem.
    for (const check of report.qualityChecks.filter((c) => c.checkId !== 'JOURNAL_BALANCE')) {
      expect(check.status).toBe('PASS');
    }
  });
});

describe('verifyState — pass/fail aggregation (case 10)', () => {
  it('reports PASS when every check passes and FAIL when one residual mismatch remains', () => {
    const healthy = toInvestigationInput(buildHealthyFixture());
    const healthyResult = verifyState(healthy);
    expect(healthyResult.overallStatus).toBe('PASS');
    expect(healthyResult.checks.every((c) => c.status === 'PASS')).toBe(true);

    const fixture = buildHealthyFixture();
    const residualMismatch = {
      ...fixture,
      valuation: { ...fixture.valuation, inventoryValue: '1.00' } // now internally inconsistent
    };
    const failResult = verifyState(toInvestigationInput(residualMismatch));
    expect(failResult.overallStatus).toBe('FAIL');
    expect(failResult.checks.find((c) => c.checkId === 'INVENTORY_VALUATION_CONSISTENCY')?.status).toBe('FAIL');
  });
});
