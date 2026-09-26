import { describe, expect, it } from 'vitest';
import { PostgresExecutionKeyStore } from '@ledgerguard/postgres';
import type { Queryable } from '../src/queryable';

class MemoryKeys implements Queryable {
  rows = new Map<string, Record<string, unknown>>();

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
        state: 'reserved',
        createdAt: values[3],
        leaseExpiresAt: values[4]
      });
      return { rows: [{ key }], rowCount: 1 };
    }
    if (sql.includes('from ledgerguard_execution_keys where key')) {
      const row = this.rows.get(String(values[0]));
      return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
    }
    if (sql.includes("set state = 'completed'")) {
      const row = this.rows.get(String(values[0]));
      if (row && row.state === 'reserved') {
        row.state = 'completed';
        return { rows: [], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    }
    if (sql.includes("set state = 'failed_retryable'")) {
      const row = this.rows.get(String(values[0]));
      if (row && row.state === 'reserved') {
        row.state = 'failed_retryable';
        return { rows: [], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    }
    if (sql.includes("state = 'failed_retryable'") && sql.includes("set state = 'reserved'")) {
      const row = this.rows.get(String(values[0]));
      if (row && row.state === 'failed_retryable') {
        row.state = 'reserved';
        row.planId = values[1];
        row.leaseExpiresAt = values[4];
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

  it('does not complete a key that is no longer reserved', async () => {
    const db = new MemoryKeys();
    const store = new PostgresExecutionKeyStore(db);
    const now = new Date('2026-01-01T00:00:00.000Z');
    await store.reserve({ key: 'k1', planId: 'plan-1', planVersion: 1, now });
    await store.complete('k1', now, { status: 'EXECUTED' });
    db.rows.get('k1')!.state = 'failed_retryable';
    await store.complete('k1', now, { status: 'SHOULD_NOT_APPLY' });
    expect(db.rows.get('k1')!.state).toBe('failed_retryable');
  });

  it('recovers an expired reserved key whose mutation never applied as retryable', async () => {
    const db = new MemoryKeys();
    const store = new PostgresExecutionKeyStore(db);
    const reservedAt = new Date('2026-01-01T00:00:00.000Z');
    await store.reserve({ key: 'k1', planId: 'plan-1', planVersion: 1, now: reservedAt, leaseMs: 1000 });
    const later = new Date('2026-01-01T00:00:02.000Z');
    const recovered = await store.recoverExpiredReservation({
      key: 'k1',
      classification: 'not_applied',
      now: later
    });
    expect(recovered).toBe('failed_retryable');
    expect(db.rows.get('k1')!.state).toBe('failed_retryable');
  });

  it('recovers an expired reserved key whose mutation is already visible as completed', async () => {
    const store = new PostgresExecutionKeyStore(new MemoryKeys());
    const reservedAt = new Date('2026-01-01T00:00:00.000Z');
    await store.reserve({ key: 'k1', planId: 'plan-1', planVersion: 1, now: reservedAt, leaseMs: 1000 });
    const recovered = await store.recoverExpiredReservation({
      key: 'k1',
      classification: 'applied',
      now: new Date('2026-01-01T00:00:02.000Z')
    });
    expect(recovered).toBe('completed');
  });

  it('refuses to guess when expired reserved state is ambiguous', async () => {
    const store = new PostgresExecutionKeyStore(new MemoryKeys());
    const reservedAt = new Date('2026-01-01T00:00:00.000Z');
    await store.reserve({ key: 'k1', planId: 'plan-1', planVersion: 1, now: reservedAt, leaseMs: 1000 });
    const recovered = await store.recoverExpiredReservation({
      key: 'k1',
      classification: 'ambiguous',
      now: new Date('2026-01-01T00:00:02.000Z')
    });
    expect(recovered).toBe('recovery_required');
  });

  it('keeps an unexpired reservation in-flight', async () => {
    const store = new PostgresExecutionKeyStore(new MemoryKeys());
    const now = new Date('2026-01-01T00:00:00.000Z');
    await store.reserve({ key: 'k1', planId: 'plan-1', planVersion: 1, now, leaseMs: 60_000 });
    const recovered = await store.recoverExpiredReservation({
      key: 'k1',
      classification: 'not_applied',
      now: new Date('2026-01-01T00:00:01.000Z')
    });
    expect(recovered).toBe('in_flight');
  });
});
