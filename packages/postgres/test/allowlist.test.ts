import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ProposedCorrection } from '@ledgerguard/core';
import {
  applyAllowlistedCorrection,
  isWritableColumn,
  loadAllowlistConfig,
  parseAllowlistConfig,
  resolveAllowlist,
  UnallowlistedMutationError
} from '@ledgerguard/postgres';
import type { Queryable } from '../src/queryable';

function correction(overrides: Partial<ProposedCorrection>): ProposedCorrection {
  return {
    sequence: 1,
    action: 'RESTORE_CONVERSION_FACTOR',
    table: 'product_units',
    recordId: 'pu-carton',
    field: 'conversion_factor',
    beforeValue: '10.0000',
    afterValue: '12.0000',
    financialDelta: null,
    rollbackAssumption: 'test',
    ...overrides
  };
}

class FakeQueryable implements Queryable {
  queries: Array<{ sql: string; params: unknown[] }> = [];
  rowCount = 1;

  async query(sql: string, params?: unknown[]) {
    this.queries.push({ sql, params: params ?? [] });
    return { rows: [], rowCount: this.rowCount };
  }
}

describe('PostgreSQL allowlisted mutations', () => {
  it('rejects journal_entries and unknown columns', () => {
    expect(isWritableColumn('journal_entries', 'debit')).toBe(false);
    expect(isWritableColumn('product_units', 'id')).toBe(false);
    expect(isWritableColumn('product_units', 'conversion_factor')).toBe(true);
    expect(isWritableColumn('inventory_movements', 'reversed_at')).toBe(true);
  });

  it('throws UnallowlistedMutationError before issuing SQL', async () => {
    const db = new FakeQueryable();
    await expect(
      applyAllowlistedCorrection(
        db,
        correction({ table: 'journal_entries', field: 'debit', action: 'RECOMPUTE_INVENTORY_MOVEMENT' }),
        new Date('2026-01-01T00:00:00.000Z')
      )
    ).rejects.toBeInstanceOf(UnallowlistedMutationError);
    expect(db.queries).toEqual([]);
  });

  it('issues a guarded update for an allowlisted conversion-factor restore', async () => {
    const db = new FakeQueryable();
    const now = new Date('2026-03-01T00:00:00.000Z');
    const result = await applyAllowlistedCorrection(db, correction({}), now);

    expect(result.status).toBe('APPLIED');
    expect(db.queries).toHaveLength(1);
    const sql = db.queries[0]?.sql ?? '';
    expect(sql).toContain('update product_units');
    expect(sql).toContain('conversion_factor = $1::numeric');
    expect(sql).toContain('where id = $');
    expect(sql).toContain('conversion_factor = $');
    expect(db.queries[0]?.params[0]).toBe('12.0000');
  });

  it('uses demo defaults when the allowlist is omitted', () => {
    const resolved = resolveAllowlist();
    expect(resolved.writableColumns.product_units?.has('conversion_factor')).toBe(true);
    expect(isWritableColumn('product_units', 'conversion_factor')).toBe(true);
  });

  it('fails closed when nothing is configured', async () => {
    expect(resolveAllowlist(null).writableColumns).toEqual({});
    expect(resolveAllowlist({ writableColumns: {} }).writableColumns).toEqual({});
    expect(isWritableColumn('product_units', 'conversion_factor', null)).toBe(false);
    expect(isWritableColumn('product_units', 'conversion_factor', { writableColumns: {} })).toBe(false);

    const db = new FakeQueryable();
    await expect(
      applyAllowlistedCorrection(db, correction({}), new Date('2026-01-01T00:00:00.000Z'), {
        allowlist: null
      })
    ).rejects.toBeInstanceOf(UnallowlistedMutationError);
    expect(db.queries).toEqual([]);
  });

  it('uses a caller-supplied table instead of merging demo tables', async () => {
    const db = new FakeQueryable();
    const allowlist = {
      writableColumns: { warehouse_bins: ['qty'] },
      touchTimestamps: { warehouse_bins: 'updated_at' }
    };
    expect(isWritableColumn('product_units', 'conversion_factor', allowlist)).toBe(false);
    expect(isWritableColumn('warehouse_bins', 'qty', allowlist)).toBe(true);

    const result = await applyAllowlistedCorrection(
      db,
      correction({ table: 'warehouse_bins', field: 'qty', recordId: 'bin-1' }),
      new Date('2026-03-01T00:00:00.000Z'),
      { allowlist }
    );
    expect(result.status).toBe('APPLIED');
    expect(db.queries[0]?.sql).toContain('update warehouse_bins');
    expect(db.queries[0]?.sql).toContain('qty = $1::numeric');
    expect(db.queries[0]?.sql).toContain('updated_at = $');
  });

  it('loads a JSON allowlist file and refuses a missing file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ledgerguard-allowlist-'));
    const path = join(dir, 'allowlist.json');
    writeFileSync(
      path,
      JSON.stringify({
        writableColumns: { sales_orders: ['qty_ordered'] },
        touchTimestamps: { sales_orders: 'updated_at' }
      })
    );
    const loaded = loadAllowlistConfig(path);
    expect(loaded.writableColumns.sales_orders).toEqual(['qty_ordered']);
    expect(parseAllowlistConfig({}).writableColumns).toEqual({});
    expect(() => loadAllowlistConfig(join(dir, 'missing.json'))).toThrow(/Fail-closed|not found/i);
  });
});
