import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ProposedCorrection } from '@ledgerguard/core';
import type { AllowlistConfig } from '@ledgerguard/postgres';
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
    expect(sql).toContain('update "product_units"');
    expect(sql).toContain('"conversion_factor" = $1::numeric');
    expect(sql).toContain('where id = $');
    expect(sql).toContain('"conversion_factor" = $');
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
    expect(db.queries[0]?.sql).toContain('update "warehouse_bins"');
    expect(db.queries[0]?.sql).toContain('"qty" = $1::numeric');
    expect(db.queries[0]?.sql).toContain('"updated_at" = $');
  });

  it.each([
    ['Warehouse_Bins', 'Quantity', 'Updated_At'],
    ['order', 'select', 'from']
  ])('quotes configured identifiers for %s without changing their case', async (table, field, touch) => {
    const db = new FakeQueryable();
    const now = new Date('2026-03-01T00:00:00.000Z');
    const allowlist = {
      writableColumns: { [table]: [field] },
      touchTimestamps: { [table]: touch }
    };

    await applyAllowlistedCorrection(db, correction({ table, field }), now, { allowlist });

    expect(db.queries).toEqual([{
      sql: `update "${table}" set "${field}" = $1::numeric, "${touch}" = $2\n     where id = $3 and "${field}" = $4::numeric`,
      params: ['12.0000', now, 'pu-carton', '10.0000']
    }]);
  });

  it('does not grant the lower-case sibling of a configured mixed-case identifier', async () => {
    const db = new FakeQueryable();
    const allowlist = { writableColumns: { Warehouse_Bins: ['Quantity'] } };
    expect(isWritableColumn('warehouse_bins', 'Quantity', allowlist)).toBe(false);
    expect(isWritableColumn('Warehouse_Bins', 'quantity', allowlist)).toBe(false);
    await expect(applyAllowlistedCorrection(
      db, correction({ table: 'warehouse_bins', field: 'Quantity' }), new Date(), { allowlist }
    )).rejects.toBeInstanceOf(UnallowlistedMutationError);
    expect(db.queries).toEqual([]);
  });

  const invalidIdentifiers = [
    '', 'warehouse bins', 'public.warehouse_bins', 'bins; DROP TABLE products; --',
    'bins"', 'bins\n', 'bins\0', '1bins', 'x'.repeat(64)
  ];

  for (const identifier of invalidIdentifiers) {
    it.each([
      ['table', { writableColumns: { [identifier]: ['qty'] } }],
      ['field', { writableColumns: { warehouse_bins: [identifier] } }],
      ['touch table', { writableColumns: { warehouse_bins: ['qty'] }, touchTimestamps: { [identifier]: 'updated_at' } }],
      ['touch column', { writableColumns: { warehouse_bins: ['qty'] }, touchTimestamps: { warehouse_bins: identifier } }]
    ])(`rejects invalid %s identifier ${JSON.stringify(identifier)} in JSON and code configs`, async (_kind, raw) => {
      expect(() => parseAllowlistConfig(raw)).toThrow(/identifier/i);
      expect(() => resolveAllowlist(raw as AllowlistConfig)).toThrow(/identifier/i);
      const db = new FakeQueryable();
      await expect(applyAllowlistedCorrection(
        db, correction({ table: 'warehouse_bins', field: 'qty' }), new Date(),
        { allowlist: raw as AllowlistConfig }
      )).rejects.toThrow(/identifier/i);
      expect(db.queries).toEqual([]);
    });
  }

  it.each([
    { writableColumns: 'warehouse_bins' },
    { writableColumns: { warehouse_bins: 'qty' } },
    { writableColumns: { warehouse_bins: [42] } },
    { writableColumns: { warehouse_bins: ['qty'] }, touchTimestamps: [] },
    { writableColumns: { warehouse_bins: ['qty'] }, touchTimestamps: { warehouse_bins: 42 } }
  ])('validates runtime code config shapes before any SQL', async (raw) => {
    const db = new FakeQueryable();
    await expect(applyAllowlistedCorrection(
      db, correction({ table: 'warehouse_bins', field: 'qty' }), new Date(),
      { allowlist: raw as unknown as AllowlistConfig }
    )).rejects.toThrow(/fail-closed/i);
    expect(db.queries).toEqual([]);
  });

  it('validates touch identifiers even when no writable columns are configured', () => {
    const raw = { writableColumns: {}, touchTimestamps: { product_units: 'updated_at; DROP TABLE products' } };
    expect(() => parseAllowlistConfig(raw)).toThrow(/identifier/i);
    expect(() => resolveAllowlist(raw)).toThrow(/identifier/i);
  });

  it('snapshots parsed column arrays instead of retaining caller-owned data', () => {
    const input = { writableColumns: { warehouse_bins: ['qty'] }, touchTimestamps: { warehouse_bins: 'updated_at' } };
    const parsed = parseAllowlistConfig(input);
    const resolved = resolveAllowlist(input);
    input.writableColumns.warehouse_bins.push('secret');
    input.touchTimestamps.warehouse_bins = 'secret';
    expect(parsed.writableColumns.warehouse_bins).toEqual(['qty']);
    expect(parsed.touchTimestamps?.warehouse_bins).toBe('updated_at');
    expect([...resolved.writableColumns.warehouse_bins!]).toEqual(['qty']);
    expect(resolved.touchTimestamps.warehouse_bins).toBe('updated_at');
  });

  it('validates the same column snapshot that it resolves when a caller supplies an accessor', () => {
    let reads = 0;
    const columns = ['qty'];
    Object.defineProperty(columns, 0, { get: () => ++reads === 1 ? 'qty' : 'qty; DROP TABLE products' });
    const parsed = parseAllowlistConfig({ writableColumns: { warehouse_bins: columns } });
    const resolved = resolveAllowlist(parsed);
    expect([...resolved.writableColumns.warehouse_bins!]).toEqual(['qty']);
    expect(reads).toBe(1);
  });

  it('uses the same correction field for authorization and SQL when supplied by an accessor', async () => {
    const db = new FakeQueryable();
    const proposal = correction({ table: 'warehouse_bins', field: 'qty' });
    let reads = 0;
    Object.defineProperty(proposal, 'field', { get: () => ++reads === 1 ? 'qty' : 'secret' });

    await applyAllowlistedCorrection(db, proposal, new Date(), {
      allowlist: { writableColumns: { warehouse_bins: ['qty'] } }
    });

    expect(db.queries[0]?.sql).toContain('"qty" = $1::numeric');
    expect(db.queries[0]?.sql).not.toContain('secret');
    expect(reads).toBe(1);
  });

  it('handles object-prototype names as exact own identifiers', () => {
    const parsed = parseAllowlistConfig(JSON.parse('{"writableColumns":{"__proto__":["qty"]},"touchTimestamps":{"__proto__":"updated_at"}}'));
    const resolved = resolveAllowlist(parsed);
    expect(Object.keys(resolved.writableColumns)).toEqual(['__proto__']);
    expect(isWritableColumn('__proto__', 'qty', parsed)).toBe(true);
    expect(isWritableColumn('constructor', 'qty', parsed)).toBe(false);
    expect(isWritableColumn('toString', 'qty', parsed)).toBe(false);
    expect(resolved.touchTimestamps.__proto__).toBe('updated_at');
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
