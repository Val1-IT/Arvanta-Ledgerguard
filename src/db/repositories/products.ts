import type { Queryable } from '../queryable';
import { ProductRecordSchema, ProductUnitRecordSchema, type ProductRecord, type ProductUnitRecord } from '../../engine/types';

// ---------------------------------------------------------------------------
// Repository adapters: thin, injected-Pool query functions that map snake_case
// rows to the camelCase, Zod-validated shapes the engine core consumes. The
// engine never imports `pg` or a Drizzle client directly — only this layer
// does, and only via a Pool (or PoolClient, mid-transaction) passed in by the
// caller (never a module-level global connection).
// ---------------------------------------------------------------------------

export async function fetchProducts(pool: Queryable): Promise<ProductRecord[]> {
  const { rows } = await pool.query(
    `select id, sku, name, base_unit as "baseUnit", standard_cost as "standardCost" from products order by id`
  );
  return rows.map((row) => ProductRecordSchema.parse(row));
}

export async function fetchProductUnits(pool: Queryable): Promise<ProductUnitRecord[]> {
  const { rows } = await pool.query(
    `select id, product_id as "productId", unit_name as "unitName",
            conversion_factor as "conversionFactor", valid_from as "validFrom", updated_at as "updatedAt"
       from product_units
      order by id`
  );
  return rows.map((row) => ProductUnitRecordSchema.parse(row));
}
