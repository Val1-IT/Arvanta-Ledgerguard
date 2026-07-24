import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { makePool } from '../../src/db/client';
import { seedDatabase } from '../../src/db/seed';
import { applyConversionError } from '../../demo-data/scenarios/conversion-error';

// ---------------------------------------------------------------------------
// Integration test: verifies the deterministic healthy baseline and the
// conversion-error scenario against a real Postgres instance.
//
// Requires a running database (see docker-compose.yml / `npm run db:up`).
// Run with: npm run test:integration
//
// The five integrity checks below are the same ones the engine will evaluate
// deterministically. Here we assert:
//   - baseline  -> all five checks pass
//   - scenario  -> checks 2, 4, 5 fail (1 and 3 still pass)
//   - reset     -> all five checks pass again
// ---------------------------------------------------------------------------

type CheckResult = { failing: number };

/** check 1: every conversion factor must be strictly positive. */
async function check1Failing(pool: Pool): Promise<number> {
  const { rows } = await pool.query<CheckResult>(
    `select count(*)::int as failing from product_units where conversion_factor <= 0`
  );
  return rows[0].failing;
}

/**
 * check 2: for each movement, base_quantity must equal quantity * factor of the
 * movement's unit. After the conversion error the stored CARTON movements keep
 * base_quantity = qty*12 while the factor is now 10, so they diverge.
 */
async function check2Failing(pool: Pool): Promise<number> {
  const { rows } = await pool.query<CheckResult>(
    `select count(*)::int as failing
       from inventory_movements m
       join product_units u
         on u.product_id = m.product_id and u.unit_name = m.unit_name
      where abs(m.base_quantity - (m.quantity * u.conversion_factor)) > 0.001`
  );
  return rows[0].failing;
}

/** check 3: debit total must equal credit total per journal source. */
async function check3Failing(pool: Pool): Promise<number> {
  const { rows } = await pool.query<CheckResult>(
    `select count(*)::int as failing from (
       select source_type, source_id
         from journal_entries
        group by source_type, source_id
       having abs(sum(debit) - sum(credit)) > 0.001
     ) unbalanced`
  );
  return rows[0].failing;
}

/**
 * check 4: stored valuation quantity_on_hand must match the aggregation of
 * movement base quantities (in minus out). After the error the recomputed
 * valuation (factor 10 -> 960) no longer matches stored movements (1,440).
 */
async function check4Failing(pool: Pool): Promise<number> {
  const { rows } = await pool.query<CheckResult>(
    `with agg as (
       select product_id,
              sum(case when movement_type = 'in' then base_quantity else -base_quantity end) as net_qty
         from inventory_movements
        group by product_id
     )
     select count(*)::int as failing
       from inventory_valuation v
       join agg a on a.product_id = v.product_id
      where abs(v.quantity_on_hand - a.net_qty) > 0.001`
  );
  return rows[0].failing;
}

/**
 * check 5: the gross margin report COGS must tie to the posted COGS journals.
 * After the error the report is recomputed (factor 10 -> 86,400,000) while the
 * journals still hold the original 72,000,000.
 */
async function check5Failing(pool: Pool): Promise<number> {
  const { rows } = await pool.query<CheckResult>(
    `with journal_cogs as (
       select coalesce(sum(debit - credit), 0) as cogs
         from journal_entries
        where account_code = '5110'
     )
     select count(*)::int as failing
       from gross_margin_report r, journal_cogs j
      where abs(r.cost_of_goods_sold - j.cogs) > 0.001`
  );
  return rows[0].failing;
}

async function allChecks(pool: Pool) {
  return {
    check1: await check1Failing(pool),
    check2: await check2Failing(pool),
    check3: await check3Failing(pool),
    check4: await check4Failing(pool),
    check5: await check5Failing(pool)
  };
}

describe('conversion-error integrity checks', () => {
  let pool: Pool;

  beforeAll(async () => {
    pool = makePool();
  });

  afterAll(async () => {
    await pool.end();
  });

  it('healthy baseline passes all five checks', async () => {
    await seedDatabase(pool);
    const checks = await allChecks(pool);
    expect(checks).toEqual({ check1: 0, check2: 0, check3: 0, check4: 0, check5: 0 });
  });

  it('conversion error trips checks 2, 4, and 5 while 1 and 3 still pass', async () => {
    await seedDatabase(pool);
    await applyConversionError(pool);
    const checks = await allChecks(pool);

    expect(checks.check1).toBe(0);
    expect(checks.check3).toBe(0);
    expect(checks.check2).toBeGreaterThan(0);
    expect(checks.check4).toBeGreaterThan(0);
    expect(checks.check5).toBeGreaterThan(0);

    // Concretely: 24 stored CARTON purchase movements diverge on check 2.
    expect(checks.check2).toBe(24);
    expect(checks.check4).toBe(1);
    expect(checks.check5).toBe(1);
  });

  it('recomputed figures match the deterministic expectation', async () => {
    await seedDatabase(pool);
    await applyConversionError(pool);

    const { rows: valuation } = await pool.query(
      `select quantity_on_hand, average_cost, inventory_value from inventory_valuation where id = 'val-cement-40'`
    );
    expect(Number(valuation[0].quantity_on_hand)).toBe(960);
    expect(Number(valuation[0].average_cost)).toBe(60_000);
    expect(Number(valuation[0].inventory_value)).toBe(57_600_000);

    const { rows: margin } = await pool.query(
      `select cost_of_goods_sold, gross_profit, gross_margin_percentage from gross_margin_report where id = 'gmr-2026-01'`
    );
    expect(Number(margin[0].cost_of_goods_sold)).toBe(86_400_000);
    expect(Number(margin[0].gross_profit)).toBe(21_600_000);
    expect(Number(margin[0].gross_margin_percentage)).toBe(20);
  });

  it('reseeding restores the healthy baseline', async () => {
    await applyConversionError(pool);
    await seedDatabase(pool);
    const checks = await allChecks(pool);
    expect(checks).toEqual({ check1: 0, check2: 0, check3: 0, check4: 0, check5: 0 });
  });
});
