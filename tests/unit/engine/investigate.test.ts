import { describe, expect, it } from 'vitest';
import { investigate } from '../../../src/engine/investigate';
import { applyConversionErrorToFixture, buildHealthyFixture, toInvestigationInput } from './fixtures';

describe('investigate — healthy baseline (case 1)', () => {
  it('reports HEALTHY with zero exposure and no proposed corrections', () => {
    const input = toInvestigationInput(buildHealthyFixture());
    const report = investigate(input);

    expect(report.incidentType).toBe('HEALTHY');
    expect(report.rootCause).toBeNull();
    expect(report.financialImpact.totalExposure).toBe('0.00');
    expect(report.financialImpact.inventoryValueDelta).toBe('0.00');
    expect(report.financialImpact.cogsDelta).toBe('0.00');
    expect(report.proposedCorrections).toEqual([]);
    expect(report.verificationExpectations).toEqual([]);
    expect(report.evidence).toEqual([]);
    expect(report.blastRadius).toEqual({ affectedAssetCount: 0, affectedRecordCount: 0, assets: [] });
    for (const check of report.qualityChecks) {
      expect(check.status).toBe('PASS');
    }
  });
});

describe('investigate — conversion factor 12 -> 10 (case 2)', () => {
  it('identifies the root cause, affected records, and exact financial deltas', () => {
    const input = toInvestigationInput(applyConversionErrorToFixture(buildHealthyFixture()));
    const report = investigate(input);

    expect(report.incidentType).toBe('UNIT_CONVERSION_MISMATCH');
    expect(report.rootCause).toEqual({
      asset: 'product_units',
      field: 'conversion_factor',
      productId: 'prod-cement-40',
      unitId: 'pu-carton',
      unitName: 'CARTON',
      expectedValue: '12.0000',
      actualValue: '10.0000',
      delta: '-2.0000'
    });

    // Deterministic figures cross-checked against tests/integration/db.test.ts.
    expect(report.affectedRecords.inventoryMovements).toHaveLength(24);
    expect(report.affectedRecords.inventoryValuations).toEqual(['val-cement-40']);
    expect(report.affectedRecords.journalEntries).toHaveLength(36);
    expect(report.affectedRecords.reports).toEqual(['gmr-2026-01']);

    expect(report.blastRadius.affectedAssetCount).toBe(5);
    expect(report.blastRadius.affectedRecordCount).toBe(1 + 24 + 1 + 36 + 1);

    expect(report.financialImpact.inventoryValueDelta).toBe('14400000.00');
    expect(report.financialImpact.cogsDelta).toBe('-14400000.00');
    expect(report.financialImpact.grossProfitDelta).toBe('14400000.00');
    expect(report.financialImpact.grossMarginPercentageDelta).toBe('13.3333');
    expect(report.financialImpact.totalExposure).toBe('28800000.00');

    expect(report.proposedCorrections.length).toBeGreaterThan(0);
    expect(report.proposedCorrections[0]).toMatchObject({
      sequence: 1,
      action: 'RESTORE_CONVERSION_FACTOR',
      table: 'product_units',
      recordId: 'pu-carton',
      beforeValue: '10.0000',
      afterValue: '12.0000'
    });
    // Sequence numbers are contiguous and start at 1.
    report.proposedCorrections.forEach((c, i) => expect(c.sequence).toBe(i + 1));

    expect(report.verificationExpectations.length).toBe(5);
    expect(report.verificationExpectations.every((v) => v.expectedStatus === 'PASS')).toBe(true);
  });
});

describe('investigate — repeated investigation (case 3)', () => {
  it('produces byte-identical output on the same input', () => {
    const input = toInvestigationInput(applyConversionErrorToFixture(buildHealthyFixture()));
    const first = investigate(input);
    const second = investigate(input);

    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
    // No duplicate incident-side data: exactly one root cause, one set of affected records.
    expect(second.rootCause).toEqual(first.rootCause);
    expect(second.affectedRecords).toEqual(first.affectedRecords);
  });
});

describe('investigate — factor change with no affected movements (case 6)', () => {
  it('detects the incident but reports zero exposure and no fabricated movement corrections', () => {
    const healthy = buildHealthyFixture();

    // Register a third unit that no movement ever references, present in the
    // baseline at its correct value, then corrupt it — exactly like the
    // CARTON incident, but with zero downstream usage.
    const withExtraUnit = {
      ...healthy,
      productUnits: [
        ...healthy.productUnits,
        {
          id: 'pu-box',
          productId: healthy.product.id,
          unitName: 'BOX',
          conversionFactor: '5.0000',
          validFrom: new Date('2026-01-01T00:00:00.000Z'),
          updatedAt: new Date('2026-01-01T00:00:00.000Z')
        }
      ],
      baseline: { ...healthy.baseline, conversionFactor: { ...healthy.baseline.conversionFactor, BOX: 5 } }
    };
    const corrupted = {
      ...withExtraUnit,
      productUnits: withExtraUnit.productUnits.map((u) => (u.unitName === 'BOX' ? { ...u, conversionFactor: '6.0000' } : u))
    };

    const report = investigate(toInvestigationInput(corrupted));

    expect(report.incidentType).toBe('UNIT_CONVERSION_MISMATCH');
    expect(report.rootCause?.unitName).toBe('BOX');
    expect(report.affectedRecords.inventoryMovements).toEqual([]);
    expect(report.financialImpact.totalExposure).toBe('0.00');
    // Only the factor restoration itself is proposed — no REGENERATE_* actions
    // since nothing downstream actually diverged.
    expect(report.proposedCorrections).toHaveLength(1);
    expect(report.proposedCorrections[0].action).toBe('RESTORE_CONVERSION_FACTOR');
  });
});

describe('investigate — reset to baseline (case 9)', () => {
  it('returns to HEALTHY with zero exposure after the incident is reset', () => {
    const healthy = buildHealthyFixture();
    const corrupted = applyConversionErrorToFixture(healthy);

    const incidentReport = investigate(toInvestigationInput(corrupted));
    expect(incidentReport.incidentType).toBe('UNIT_CONVERSION_MISMATCH');

    const resetReport = investigate(toInvestigationInput(healthy));
    expect(resetReport.incidentType).toBe('HEALTHY');
    expect(resetReport.financialImpact.totalExposure).toBe('0.00');
    expect(resetReport.proposedCorrections).toEqual([]);
  });
});
