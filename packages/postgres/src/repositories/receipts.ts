import { PurchaseReceiptRecordSchema, type PurchaseReceiptRecord } from '@ledgerguard/core';
import type { Queryable } from '../queryable';

export async function fetchPurchaseReceipts(pool: Queryable): Promise<PurchaseReceiptRecord[]> {
  const { rows } = await pool.query(
    `select id, number, purchase_order_id as "purchaseOrderId", product_id as "productId",
            quantity, received_at as "receivedAt"
       from purchase_receipts
      order by received_at, id`
  );
  return rows.map((row) => PurchaseReceiptRecordSchema.parse(row));
}
