import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Pool, PoolClient } from 'pg';
import type { ProposedCorrection } from '@ledgerguard/core';
import { applyAllowlistedCorrection, UnallowlistedMutationError } from '@ledgerguard/postgres';
import { makePool } from '../../src/db/client';

function correction(table: string, field = 'qty'): ProposedCorrection {
  return {
    sequence: 1,
    action: 'RECOMPUTE_INVENTORY_MOVEMENT',
    table,
    field,
    recordId: 'bin-1',
    beforeValue: '10',
    afterValue: '12',
    financialDelta: null,
    rollbackAssumption: 'test',
  };
}

// Use transaction-local temporary tables: no fixture reset or persistent writes.
describe('PostgreSQL allowlist identifier boundaries', () => {
  let pool: Pool;
  let client: PoolClient;
  const now = new Date('2026-03-01T00:00:00.000Z');

  beforeAll(() => { pool = makePool(); });
  afterAll(async () => { await pool.end(); });
  beforeEach(async () => {
    client = await pool.connect();
    await client.query('BEGIN');
  });
  afterEach(async () => {
    if (client) {
      try { await client.query('ROLLBACK'); } finally { client.release(); }
    }
  });

  it('updates the allowlisted mixed-case table and leaves its lower-case sibling untouched', async () => {
    await client.query(`
      CREATE TEMP TABLE "Warehouse_Bins" (id text PRIMARY KEY, qty numeric);
      CREATE TEMP TABLE warehouse_bins (id text PRIMARY KEY, qty numeric);
      INSERT INTO "Warehouse_Bins" VALUES ('bin-1', 10);
      INSERT INTO warehouse_bins VALUES ('bin-1', 10);
    `);
    const allowlist = { writableColumns: { Warehouse_Bins: ['qty'] } };

    await applyAllowlistedCorrection(client, correction('Warehouse_Bins'), now, { allowlist });

    const configured = await client.query('SELECT qty FROM "Warehouse_Bins"');
    const sibling = await client.query('SELECT qty FROM warehouse_bins');
    expect(configured.rows).toEqual([{ qty: '12' }]);
    expect(sibling.rows).toEqual([{ qty: '10' }]);
    await expect(applyAllowlistedCorrection(client, correction('warehouse_bins'), now, { allowlist }))
      .rejects.toBeInstanceOf(UnallowlistedMutationError);
    expect((await client.query('SELECT qty FROM warehouse_bins')).rows).toEqual([{ qty: '10' }]);
  });

  it('preserves exact case for writable and touch columns without changing sibling columns', async () => {
    await client.query(`
      CREATE TEMP TABLE warehouse_bins (
        id text PRIMARY KEY, "Quantity" numeric, quantity numeric,
        "Updated_At" timestamptz, updated_at timestamptz
      );
      INSERT INTO warehouse_bins VALUES ('bin-1', 10, 10, NULL, NULL);
    `);
    const allowlist = {
      writableColumns: { warehouse_bins: ['Quantity'] },
      touchTimestamps: { warehouse_bins: 'Updated_At' }
    };

    await applyAllowlistedCorrection(client, correction('warehouse_bins', 'Quantity'), now, { allowlist });

    expect((await client.query('SELECT "Quantity", quantity, "Updated_At", updated_at FROM warehouse_bins')).rows)
      .toEqual([{ Quantity: '12', quantity: '10', Updated_At: now, updated_at: null }]);
    await expect(applyAllowlistedCorrection(client, correction('warehouse_bins', 'quantity'), now, { allowlist }))
      .rejects.toBeInstanceOf(UnallowlistedMutationError);
  });

  it('supports reserved words as configured table, field and touch identifiers', async () => {
    await client.query(`
      CREATE TEMP TABLE "order" (id text PRIMARY KEY, "select" numeric, "from" timestamptz);
      INSERT INTO "order" VALUES ('bin-1', 10, NULL);
    `);

    await applyAllowlistedCorrection(client, correction('order', 'select'), now, {
      allowlist: { writableColumns: { order: ['select'] }, touchTimestamps: { order: 'from' } }
    });

    expect((await client.query('SELECT "select", "from" FROM "order"')).rows)
      .toEqual([{ select: '12', from: now }]);
  });

  it('rejects unsafe code config before a write and keeps the transaction usable', async () => {
    await client.query(`
      CREATE TEMP TABLE warehouse_bins (id text PRIMARY KEY, qty numeric);
      INSERT INTO warehouse_bins VALUES ('bin-1', 10);
    `);

    await expect(applyAllowlistedCorrection(client, correction('warehouse_bins'), now, {
      allowlist: {
        writableColumns: { warehouse_bins: ['qty'] },
        touchTimestamps: { warehouse_bins: 'qty = 0; DROP TABLE warehouse_bins; --' }
      }
    })).rejects.toThrow(/identifier/i);

    expect((await client.query('SELECT qty FROM warehouse_bins')).rows).toEqual([{ qty: '10' }]);
  });
});
