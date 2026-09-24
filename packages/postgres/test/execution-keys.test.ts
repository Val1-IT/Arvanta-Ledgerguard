import { describe, expect, it } from 'vitest';
import { PostgresExecutionKeyStore } from '@ledgerguard/postgres';
import type { Queryable } from '../src/queryable';

class MemoryKeys implements Queryable {
  private rows = new Map<string, Record<string, unknown>>();

  async query(sql: string, params?: unknown[]) {
    const values = params ?? [];
    if (sql.includes('insert into ledgerguard_execution_keys') && sql.includes('on conflict')) {
      const key = String(values[0]);
      if (this.rows.has(key)) {
        return { rows: [], rowCount: 0 };
      }
      this.rows.set(key, {
        key,
        planId: values[1],
        planVersion: values[2],
        state: 'reserved'
      });
      return { rows: [{ key }], rowCount: 1 };
    }
    if (sql.includes('from ledgerguard_execution_keys where key')) {
      const row = this.rows.get(String(values[0]));
      return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
    }
    if (sql.includes("set state = 'completed'")) {
      const row = this.rows.get(String(values[0]));
      if (row) row.state = 'completed';
      return { rows: [], rowCount: row ? 1 : 0 };
    }
    if (sql.includes("state = 'failed_retryable'")) {
      const row = this.rows.get(String(values[0]));
      if (row && row.state === 'reserved') {
        row.state = 'reserved';
        row.planId = values[1];
        return { rows: [{ key: values[0] }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    }
    return { rows: [], rowCount: 0 };
  }
}

describe('PostgresExecutionKeyStore', () => {
  it('reserves a new key and treats a second insert as in-flight until completed', async () => {
    const store = new PostgresExecutionKeyStore(new MemoryKeys());
    const now = new Date('2026-01-01T00:00:00.000Z');
    const first = await store.reserve({ key: 'remediation:plan-1:3', planId: 'plan-1', planVersion: 3, now });
    const second = await store.reserve({ key: 'remediation:plan-1:3', planId: 'plan-1', planVersion: 3, now });
    expect(first).toBe('reserved');
    expect(second).toBe('in_flight');
  });

  it('returns already_completed after success so a retry cannot mutate again', async () => {
    const db = new MemoryKeys();
    const store = new PostgresExecutionKeyStore(db);
    const now = new Date('2026-01-01T00:00:00.000Z');
    await store.reserve({ key: 'k1', planId: 'plan-1', planVersion: 1, now });
    await store.complete('k1', now, { status: 'EXECUTED' });
    const again = await store.reserve({ key: 'k1', planId: 'plan-1', planVersion: 1, now });
    expect(again).toBe('already_completed');
  });
});
