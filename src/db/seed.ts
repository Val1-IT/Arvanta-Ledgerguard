import 'dotenv/config';
import type { Pool } from 'pg';
import { makePool } from './client';
import {
  ACCOUNT,
  BASE_DATE,
  PRODUCT,
  SCENARIO,
  UNIT,
  cf,
  dayOffset,
  money,
  pct,
  qty
} from '../domain/constants';

// ---------------------------------------------------------------------------
// Deterministic healthy baseline.
//
// Purchases: 24 CARTON inbound movements, 10 cartons each, 1 CARTON = 12 PCS,
//            cost basis 50,000 / PCS.
//   total base_quantity in = 24 * 10 * 12 = 2,880 PCS
//   total purchase value   = 2,880 * 50,000 = 144,000,000  (real invoiced money)
// Sales: 36 PCS outbound movements, 40 PCS each, sale price 75,000 / PCS.
//   total base_quantity out = 36 * 40 = 1,440 PCS
//   revenue                 = 1,440 * 75,000 = 108,000,000
// Weighted-average cost = 144,000,000 / 2,880 = 50,000 / PCS
//   quantity_on_hand = 2,880 - 1,440 = 1,440 PCS
//   inventory_value  = 1,440 * 50,000 = 72,000,000
//   COGS             = 1,440 * 50,000 = 72,000,000
//   gross_profit     = 108,000,000 - 72,000,000 = 36,000,000
//   gross_margin_%   = 33.3333
// All journals are balanced (debit = credit per source).
// ---------------------------------------------------------------------------

async function truncateAll(pool: Pool): Promise<void> {
  await pool.query(`
    truncate table
      ledgerguard_execution_keys,
      remediation_plans,
      investigation_runs,
      ledgerguard_incidents,
      baseline_snapshot,
      gross_margin_report,
      journal_entries,
      inventory_valuation,
      inventory_movements,
      purchase_receipts,
      purchase_orders,
      product_units,
      products
    restart identity cascade;
  `);
}

export async function seedDatabase(pool: Pool): Promise<void> {
  const s = SCENARIO;
  const correctFactor = UNIT.CARTON.correctFactor;

  // Derived baseline figures.
  const baseInPerPurchase = s.cartonsPerPurchase * correctFactor; // 120 PCS
  const totalBaseIn = s.purchaseCount * baseInPerPurchase; // 2,880
  const purchaseValuePer = baseInPerPurchase * s.unitCostPerPcs; // 6,000,000
  const totalPurchaseValue = s.purchaseCount * purchaseValuePer; // 144,000,000

  const totalBaseOut = s.saleCount * s.pcsPerSale; // 1,440
  const revenuePerSale = s.pcsPerSale * s.salePricePerPcs; // 3,000,000
  const totalRevenue = s.saleCount * revenuePerSale; // 108,000,000

  const averageCost = totalPurchaseValue / totalBaseIn; // 50,000
  const cogsPerSale = s.pcsPerSale * averageCost; // 2,000,000
  const totalCogs = s.saleCount * cogsPerSale; // 72,000,000
  const quantityOnHand = totalBaseIn - totalBaseOut; // 1,440
  const inventoryValue = quantityOnHand * averageCost; // 72,000,000
  const grossProfit = totalRevenue - totalCogs; // 36,000,000
  const grossMarginPct = (grossProfit / totalRevenue) * 100; // 33.3333

  await truncateAll(pool);

  // products
  await pool.query(
    `insert into products (id, sku, name, base_unit, standard_cost, created_at)
     values ($1,$2,$3,$4,$5,$6)`,
    [PRODUCT.id, PRODUCT.sku, PRODUCT.name, PRODUCT.baseUnit, money(PRODUCT.standardCost), BASE_DATE]
  );

  // product_units
  await pool.query(
    `insert into product_units (id, product_id, unit_name, conversion_factor, valid_from, updated_at)
     values ($1,$2,$3,$4,$5,$6),($7,$8,$9,$10,$11,$12)`,
    [
      UNIT.PCS.id, PRODUCT.id, UNIT.PCS.name, cf(UNIT.PCS.factor), BASE_DATE, BASE_DATE,
      UNIT.CARTON.id, PRODUCT.id, UNIT.CARTON.name, cf(correctFactor), BASE_DATE, BASE_DATE
    ]
  );

  // inventory_movements + journals
  for (let i = 0; i < s.purchaseCount; i++) {
    const movId = `mov-p-${String(i + 1).padStart(4, '0')}`;
    const occurredAt = dayOffset(i);
    await pool.query(
      `insert into inventory_movements
         (id, product_id, movement_type, quantity, unit_name, base_quantity, unit_cost, total_value, occurred_at)
       values ($1,$2,'in',$3,$4,$5,$6,$7,$8)`,
      [
        movId, PRODUCT.id,
        qty(s.cartonsPerPurchase), UNIT.CARTON.name,
        qty(baseInPerPurchase), money(s.unitCostPerPcs), money(purchaseValuePer), occurredAt
      ]
    );
    // Balanced purchase journal: Dr Inventory / Cr Accounts Payable.
    await pool.query(
      `insert into journal_entries (id, source_type, source_id, account_code, debit, credit, posted_at)
       values ($1,'purchase',$2,$3,$4,'0.00',$5),
              ($6,'purchase',$2,$7,'0.00',$8,$5)`,
      [
        `je-p-${i + 1}-inv`, movId, ACCOUNT.INVENTORY, money(purchaseValuePer), occurredAt,
        `je-p-${i + 1}-ap`, ACCOUNT.AP, money(purchaseValuePer)
      ]
    );
  }

  for (let i = 0; i < s.saleCount; i++) {
    const movId = `mov-s-${String(i + 1).padStart(4, '0')}`;
    const occurredAt = dayOffset(30 + i);
    await pool.query(
      `insert into inventory_movements
         (id, product_id, movement_type, quantity, unit_name, base_quantity, unit_cost, total_value, occurred_at)
       values ($1,$2,'out',$3,$4,$5,$6,$7,$8)`,
      [
        movId, PRODUCT.id,
        qty(s.pcsPerSale), UNIT.PCS.name,
        qty(s.pcsPerSale), money(averageCost), money(cogsPerSale), occurredAt
      ]
    );
    // Balanced sale journals: revenue pair + COGS pair.
    await pool.query(
      `insert into journal_entries (id, source_type, source_id, account_code, debit, credit, posted_at)
       values ($1,'sale',$2,$3,$4,'0.00',$9),
              ($5,'sale',$2,$6,'0.00',$4,$9),
              ($7,'sale',$2,$8,$10,'0.00',$9),
              ($11,'sale',$2,$12,'0.00',$10,$9)`,
      [
        `je-s-${i + 1}-ar`, movId, ACCOUNT.AR, money(revenuePerSale),
        `je-s-${i + 1}-rev`, ACCOUNT.SALES,
        `je-s-${i + 1}-cogs`, ACCOUNT.COGS,
        occurredAt, money(cogsPerSale),
        `je-s-${i + 1}-inv`, ACCOUNT.INVENTORY
      ]
    );
  }

  // inventory_valuation
  await pool.query(
    `insert into inventory_valuation (id, product_id, quantity_on_hand, average_cost, inventory_value, calculated_at)
     values ($1,$2,$3,$4,$5,$6)`,
    ['val-cement-40', PRODUCT.id, qty(quantityOnHand), money(averageCost), money(inventoryValue), dayOffset(66)]
  );

  // gross_margin_report
  await pool.query(
    `insert into gross_margin_report
       (id, period, revenue, cost_of_goods_sold, gross_profit, gross_margin_percentage, generated_at)
     values ($1,$2,$3,$4,$5,$6,$7)`,
    [
      `gmr-${s.period}`, s.period,
      money(totalRevenue), money(totalCogs), money(grossProfit), pct(grossMarginPct), dayOffset(66)
    ]
  );

  // Canonical baseline snapshot (used by reset semantics and by the engine as
  // the "expected" reference once live data is corrupted).
  const baseline = {
    conversionFactor: { CARTON: correctFactor, PCS: UNIT.PCS.factor },
    movements: { totalBaseIn, totalBaseOut, quantityOnHand },
    valuation: { averageCost, inventoryValue, quantityOnHand },
    margin: {
      revenue: totalRevenue,
      costOfGoodsSold: totalCogs,
      grossProfit,
      grossMarginPercentage: Number(pct(grossMarginPct))
    }
  };
  await pool.query(
    `insert into baseline_snapshot (key, value_json, captured_at) values ($1,$2,$3)`,
    ['baseline', JSON.stringify(baseline), BASE_DATE]
  );
}

async function main(): Promise<void> {
  const pool = makePool();
  try {
    await seedDatabase(pool);
    console.log('Seed complete: healthy baseline loaded.');
  } finally {
    await pool.end();
  }
}

const invokedDirectly = process.argv[1]?.replace(/\\/g, '/').endsWith('src/db/seed.ts');
if (invokedDirectly) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
