import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { makePool } from '../../src/db/client';
import { seedDatabase } from '../../src/db/seed';
import { applyConversionError } from '../../demo-data/scenarios/conversion-error';
import { loadInvestigationInput } from '../../src/db/repositories/investigation';
import { investigate } from '../../src/engine/investigate';

// ---------------------------------------------------------------------------
// Integration test: runs the actual deterministic engine (src/engine/*)
// against a real Postgres instance (ledgerguard-postgres, the demo database
// for Arvanta LedgerGuard) — not fixtures. Complements tests/integration/
// db.test.ts (which checks raw SQL integrity) and tests/unit/engine/*
// (which check the pure engine against in-memory fixtures).
//
// Verifies:
//   - the engine reaches the same figures against real data as the unit
//     tests reach against fixtures built from the same domain constants
//   - loadInvestigationInput + investigate() never mutate the database
//   - running the investigation twice on the same DB state is idempotent
// ---------------------------------------------------------------------------

async function snapshotState(pool: Pool) {
  const [units, movements, valuations, journals, reports] = await Promise.all([
    pool.query('select id, conversion_factor from product_units order by id'),
    pool.query('select count(*)::int as n from inventory_movements'),
    pool.query('select id, quantity_on_hand, average_cost, inventory_value from inventory_valuation order by id'),
    pool.query('select count(*)::int as n from journal_entries'),
    pool.query('select id, cost_of_goods_sold, gross_profit, gross_margin_percentage from gross_margin_report order by id')
  ]);
  return {
    units: units.rows,
    movementCount: movements.rows[0].n,
    valuations: valuations.rows,
    journalCount: journals.rows[0].n,
    reports: reports.rows
  };
}

describe('financial integrity engine against real Postgres', () => {
  let pool: Pool;

  beforeAll(async () => {
    pool = makePool();
  });

  afterAll(async () => {
    // Leave the demo database in the healthy baseline for other consumers.
    await seedDatabase(pool);
    await pool.end();
  });

  it('reports HEALTHY with zero exposure on the freshly seeded baseline', async () => {
    await seedDatabase(pool);

    const input = await loadInvestigationInput(pool);
    const report = investigate(input);

    expect(report.incidentType).toBeNull();
    expect(report.overallStatus).toBe('HEALTHY');
    expect(report.rootCause).toBeNull();
    expect(report.financialImpact.primaryExposure).toBe('0.00');
    expect(report.financialImpact.grossStatementFootprint).toBe('0.00');
    expect(report.proposedCorrections).toEqual([]);
    expect(report.recordImpact.uniqueRecordCount).toBe(0);
    for (const check of report.qualityChecks) {
      expect(check.status).toBe('PASS');
    }
  });

  it('identifies the exact conversion-error impact against live data', async () => {
    await seedDatabase(pool);
    await applyConversionError(pool);

    const input = await loadInvestigationInput(pool);
    const report = investigate(input);

    expect(report.incidentType).toBe('UNIT_CONVERSION_MISMATCH');
    expect(report.overallStatus).toBe('CRITICAL');
    expect(report.rootCause).toMatchObject({
      asset: 'product_units',
      field: 'conversion_factor',
      unitName: 'CARTON',
      expectedValue: '12.0000',
      actualValue: '10.0000',
      delta: '-2.0000',
      expectedValueSource: {
        type: 'baseline_snapshot',
        recordId: 'baseline',
        evidenceReference: 'baseline_snapshot.conversionFactor.CARTON'
      }
    });

    // Cross-checked against tests/integration/db.test.ts's raw-SQL assertions
    // and tests/unit/engine/investigate.test.ts's fixture-based assertions —
    // same demo scenario, same numbers, now reached by fetching from Postgres.
    expect(report.affectedRecords.inventoryMovements).toHaveLength(24);
    expect(report.affectedRecords.inventoryValuations).toEqual(['val-cement-40']);
    expect(report.affectedRecords.journalEntries).toHaveLength(36);
    expect(report.affectedRecords.reports).toEqual(['gmr-2026-01']);

    expect(report.financialImpact.inventoryValueDelta).toBe('14400000.00');
    expect(report.financialImpact.cogsDelta).toBe('-14400000.00');
    // primaryExposure sums the two proven-disjoint components; it is not the
    // raw sum of every statement line (see grossStatementFootprint below).
    expect(report.financialImpact.populationsProvenDisjoint).toBe(true);
    expect(report.financialImpact.exposureMethod).toBe('DISJOINT_POPULATION_SUM');
    expect(report.financialImpact.primaryExposure).toBe('28800000.00');
    expect(report.financialImpact.grossStatementFootprint).toBe('43200000.00');

    expect(report.recordImpact.evidenceRecordCount).toBe(60);
    expect(report.recordImpact.correctionTargetCount).toBe(3);
    expect(report.recordImpact.uniqueRecordCount).toBe(report.blastRadius.affectedRecordCount);

    expect(report.proposedCorrections[0]).toMatchObject({
      action: 'RESTORE_CONVERSION_FACTOR',
      table: 'product_units',
      recordId: 'pu-carton',
      beforeValue: '10.0000',
      afterValue: '12.0000'
    });
  });

  it('never mutates the database while investigating', async () => {
    await seedDatabase(pool);
    await applyConversionError(pool);

    const before = await snapshotState(pool);
    const input = await loadInvestigationInput(pool);
    investigate(input);
    const after = await snapshotState(pool);

    expect(after).toEqual(before);
  });

  it('produces identical output when investigating the same state twice', async () => {
    await seedDatabase(pool);
    await applyConversionError(pool);

    const firstInput = await loadInvestigationInput(pool);
    const firstReport = investigate(firstInput);

    const secondInput = await loadInvestigationInput(pool);
    const secondReport = investigate(secondInput);

    expect(JSON.stringify(secondReport)).toBe(JSON.stringify(firstReport));
  });

  it('returns to HEALTHY after reseeding restores the baseline', async () => {
    await applyConversionError(pool);
    await seedDatabase(pool);

    const input = await loadInvestigationInput(pool);
    const report = investigate(input);

    expect(report.incidentType).toBeNull();
    expect(report.overallStatus).toBe('HEALTHY');
    expect(report.financialImpact.primaryExposure).toBe('0.00');
  });
});
