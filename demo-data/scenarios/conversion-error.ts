import 'dotenv/config';
import type { Pool } from 'pg';
import { makePool } from '../../src/db/client';
import { ACCOUNT, SCENARIO, UNIT, cf, dayOffset, money, pct, qty } from '../../src/domain/constants';

// ---------------------------------------------------------------------------
// Conversion-error scenario.
//
// A user wrongly changes 1 CARTON = 12 PCS to 1 CARTON = 10 PCS, then a
// recalculation regenerates the valuation and margin reports from the new
// (wrong) factor WITHOUT recomputing the historical movement rows and WITHOUT
// touching the posted journals. This mirrors a real silent-corruption incident.
//
// Effect on the five integrity checks:
//   1. conversion_factor > 0                     -> still passes (10 > 0)
//   2. base_quantity = quantity * factor         -> FAILS: stored CARTON rows
//        keep base_quantity = qty*12 while factor is now 10
//   3. debit = credit per journal source         -> still passes (structural)
//   4. valuation matches movement aggregation    -> FAILS: recomputed valuation
//        (factor 10) no longer matches stored movements (factor 12)
//   5. report COGS ties to journal COGS          -> FAILS: report recomputed
//        (factor 10) diverges from journals (factor 12)
//
// Deterministic recomputed figures (factor 10):
//   total base in = 24*10*10 = 2,400 ; purchase money unchanged = 144,000,000
//   average cost  = 144,000,000 / 2,400 = 60,000
//   qty on hand   = 2,400 - 1,440 = 960 ; inventory value = 960*60,000 = 57,600,000
//   COGS          = 1,440 * 60,000 = 86,400,000 (baseline 72,000,000)
//   gross profit  = 108,000,000 - 86,400,000 = 21,600,000 (baseline 36,000,000)
//   gross margin  = 20.0000% (baseline 33.3333%)
// ---------------------------------------------------------------------------

export async function applyConversionError(pool: Pool): Promise<void> {
  const s = SCENARIO;
  const wrong = UNIT.CARTON.wrongFactor; // 10

  // Step 1 — corrupt the conversion factor. Historical movements untouched.
  await pool.query(
    `update product_units set conversion_factor = $1, updated_at = $2 where unit_name = $3`,
    [cf(wrong), dayOffset(67), UNIT.CARTON.name]
  );

  // Step 2 — recompute reports from the current (wrong) factor.
  const totalBaseIn = s.purchaseCount * s.cartonsPerPurchase * wrong; // 2,400
  const totalPurchaseValue =
    s.purchaseCount * s.cartonsPerPurchase * UNIT.CARTON.correctFactor * s.unitCostPerPcs; // 144,000,000 (real money, unchanged)
  const totalBaseOut = s.saleCount * s.pcsPerSale; // 1,440
  const totalRevenue = s.saleCount * s.pcsPerSale * s.salePricePerPcs; // 108,000,000

  const averageCost = totalPurchaseValue / totalBaseIn; // 60,000
  const quantityOnHand = totalBaseIn - totalBaseOut; // 960
  const inventoryValue = quantityOnHand * averageCost; // 57,600,000
  const totalCogs = totalBaseOut * averageCost; // 86,400,000
  const grossProfit = totalRevenue - totalCogs; // 21,600,000
  const grossMarginPct = (grossProfit / totalRevenue) * 100; // 20.0000

  await pool.query(
    `update inventory_valuation
       set quantity_on_hand = $1, average_cost = $2, inventory_value = $3, calculated_at = $4
     where id = 'val-cement-40'`,
    [qty(quantityOnHand), money(averageCost), money(inventoryValue), dayOffset(67)]
  );

  await pool.query(
    `update gross_margin_report
       set cost_of_goods_sold = $1, gross_profit = $2, gross_margin_percentage = $3, generated_at = $4
     where id = $5`,
    [money(totalCogs), money(grossProfit), pct(grossMarginPct), dayOffset(67), `gmr-${s.period}`]
  );

  // Note: inventory_movements and journal_entries are intentionally left as-is.
  // The mismatch between them and the recomputed reports is exactly what the
  // integrity checks detect. (ACCOUNT is imported so remediation tooling can
  // reference the affected accounts consistently.)
  void ACCOUNT;
}

async function main(): Promise<void> {
  const pool = makePool();
  try {
    await applyConversionError(pool);
    console.log('Conversion error applied: 1 CARTON changed from 12 to 10 PCS; reports recomputed.');
  } finally {
    await pool.end();
  }
}

const invokedDirectly = process.argv[1]?.replace(/\\/g, '/').endsWith('conversion-error.ts');
if (invokedDirectly) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
