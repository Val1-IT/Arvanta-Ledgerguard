import type { Queryable } from '../queryable';
import {
  InventoryMovementRecordSchema,
  InventoryValuationRecordSchema,
  type InventoryMovementRecord,
  type InventoryValuationRecord
} from '@ledgerguard/core';

export async function fetchInventoryMovements(pool: Queryable): Promise<InventoryMovementRecord[]> {
  const { rows } = await pool.query(
    `select id, product_id as "productId", movement_type as "movementType", quantity, unit_name as "unitName",
            base_quantity as "baseQuantity", unit_cost as "unitCost", total_value as "totalValue",
            occurred_at as "occurredAt",
            source_receipt_id as "sourceReceiptId", event_identity as "eventIdentity",
            reversed_at as "reversedAt", reverses_id as "reversesId"
       from inventory_movements
      order by occurred_at, id`
  );
  return rows.map((row) => InventoryMovementRecordSchema.parse(row));
}

export async function fetchInventoryValuations(pool: Queryable): Promise<InventoryValuationRecord[]> {
  const { rows } = await pool.query(
    `select id, product_id as "productId", quantity_on_hand as "quantityOnHand", average_cost as "averageCost",
            inventory_value as "inventoryValue", calculated_at as "calculatedAt"
       from inventory_valuation
      order by id`
  );
  return rows.map((row) => InventoryValuationRecordSchema.parse(row));
}
