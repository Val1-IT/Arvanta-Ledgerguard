import { describe, expect, it } from 'vitest';
import type { ProposedCorrection } from '@ledgerguard/core';
import { applyAllowlistedCorrection, isWritableColumn, UnallowlistedMutationError } from '@ledgerguard/postgres';
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
});
