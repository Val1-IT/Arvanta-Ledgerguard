import 'dotenv/config';
import type { Pool } from 'pg';
import { investigate } from '@ledgerguard/core';
import { makePool } from '../../src/db/client';
import { loadInvestigationInput } from '../../src/db/repositories/investigation';

const RECEIVED_AT = new Date('2026-03-02T14:15:00.000Z');
const DUPLICATE_AT = new Date('2026-03-02T14:15:00.250Z');

export async function applyDuplicateInventoryError(pool: Pool): Promise<void> {
  await pool.query(
    `insert into products (id, sku, name, base_unit, standard_cost, created_at)
     values ('ITEM-001', 'WDG-001', 'Industrial Widget', 'PCS', '85000.00', $1)
     on conflict (id) do nothing`,
    [RECEIVED_AT]
  );

  await pool.query(
    `insert into product_units (id, product_id, unit_name, conversion_factor, valid_from, updated_at)
     values ('pu-item-001-pcs', 'ITEM-001', 'PCS', '1.0000', $1, $1)
     on conflict (id) do nothing`,
    [RECEIVED_AT]
  );

  await pool.query(
    `insert into purchase_orders (id, number, vendor_name, product_id, quantity, created_at)
     values ('PO-001', 'PO-001', 'Acme Supplies Co.', 'ITEM-001', '10.000', $1)
     on conflict (id) do nothing`,
    [RECEIVED_AT]
  );

  await pool.query(
    `insert into purchase_receipts (id, number, purchase_order_id, product_id, quantity, received_at)
     values ('RCP-001', 'RCP-001', 'PO-001', 'ITEM-001', '10.000', $1)
     on conflict (id) do nothing`,
    [RECEIVED_AT]
  );

  await pool.query(
    `insert into inventory_movements
       (id, product_id, movement_type, quantity, unit_name, base_quantity, unit_cost, total_value, occurred_at,
        source_receipt_id, event_identity)
     values
       ('MOV-001', 'ITEM-001', 'in', '10.000', 'PCS', '10.000', '85000.00', '850000.00', $1, 'RCP-001', 'receipt:RCP-001:ITEM-001'),
       ('MOV-002', 'ITEM-001', 'in', '10.000', 'PCS', '10.000', '85000.00', '850000.00', $2, 'RCP-001', 'receipt:RCP-001:ITEM-001')
     on conflict (id) do nothing`,
    [RECEIVED_AT, DUPLICATE_AT]
  );

  await pool.query(
    `insert into inventory_valuation (id, product_id, quantity_on_hand, average_cost, inventory_value, calculated_at)
     values ('val-item-001', 'ITEM-001', '20.000', '85000.00', '1700000.00', $1)
     on conflict (id) do update set
       quantity_on_hand = excluded.quantity_on_hand,
       average_cost = excluded.average_cost,
       inventory_value = excluded.inventory_value,
       calculated_at = excluded.calculated_at`,
    [DUPLICATE_AT]
  );
}

async function main(): Promise<void> {
  const pool = makePool();
  try {
    await applyDuplicateInventoryError(pool);
    const report = investigate(await loadInvestigationInput(pool));
    console.log('Duplicate inventory scenario applied.');
    console.log(`incidentType=${report.incidentType}`);
    console.log(`quantity=${report.evidence.find((item) => item.field === 'quantity_on_hand')?.actualValue}`);
    console.log(`proposed=${report.proposedCorrections.map((item) => `${item.action}:${item.recordId}`).join(', ')}`);
  } finally {
    await pool.end();
  }
}

const invokedDirectly = process.argv[1]?.replace(/\\/g, '/').endsWith('duplicate-inventory.ts');
if (invokedDirectly) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

