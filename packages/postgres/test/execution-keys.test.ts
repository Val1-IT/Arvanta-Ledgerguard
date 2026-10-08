import { describe, expect, it } from 'vitest';
import {
  ExecutionKeyConflictError,
  PostgresExecutionKeyStore,
  assertExecutionKeyOwnership,
  type ExecutionKeyRecord,
  type StaleReservationClassification
} from '@ledgerguard/postgres';
import type { Queryable } from '../src/queryable';

class MemoryKeys implements Queryable {
  rows = new Map<string, Record<string, unknown>>();
  beforeUpdate?: () => void;

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
      return { rows: row ? [structuredClone(row)] : [], rowCount: row ? 1 : 0 };
    }
    if (sql.includes('update ledgerguard_execution_keys')) {
      const beforeUpdate = this.beforeUpdate;
      this.beforeUpdate = undefined;
      beforeUpdate?.();
      const row = this.rows.get(String(values[0]));
      if (row && !matchesOwnershipAndLease(sql, values, row)) {
        return { rows: [], rowCount: 0 };
      }
    }
    if (sql.includes("set state = 'completed'")) {
      const row = this.rows.get(String(values[0]));
      if (row && row.state === 'reserved') {
        row.state = 'completed';
        row.leaseExpiresAt = null;
        return { rows: [], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    }
    if (sql.includes("set state = 'failed_retryable'")) {
      const row = this.rows.get(String(values[0]));
      if (row && row.state === 'reserved') {
        row.state = 'failed_retryable';
        row.leaseExpiresAt = null;
        return { rows: [], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    }
    if (sql.includes("state = 'failed_retryable'") && sql.includes("set state = 'reserved'")) {
      const row = this.rows.get(String(values[0]));
      if (row && row.state === 'failed_retryable') {
        row.state = 'reserved';
        row.createdAt = values[3];
        row.leaseExpiresAt = values[4];
        return { rows: [{ key: values[0] }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    }
    return { rows: [], rowCount: 0 };
  }
}

// Model the ownership/lease predicates used by the key store's SQL compare-and-set.
function matchesOwnershipAndLease(sql: string, values: unknown[], row: Record<string, unknown>): boolean {
  const fields: Record<string, string> = {
    plan_id: 'planId',
    plan_version: 'planVersion',
    created_at: 'createdAt',
    lease_expires_at: 'leaseExpiresAt'
  };
  const where = sql.slice(sql.indexOf('where'));
  for (const match of where.matchAll(/(plan_id|plan_version|created_at|lease_expires_at)\s+(?:=|is not distinct from)\s+\$(\d+)/gi)) {
    const actual = row[fields[match[1]]];
    const expected = values[Number(match[2]) - 1];
    const normalize = (value: unknown) => value instanceof Date ? value.getTime() : value;
    if (normalize(actual) !== normalize(expected)) return false;
  }
  return true;
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

  for (const state of ['reserved', 'completed', 'failed_retryable'] as const) {
    for (const requested of [
      { planId: 'plan-2', planVersion: 1 },
      { planId: 'plan-1', planVersion: 2 }
    ]) {
      it(`rejects ${state} key reuse by ${requested.planId} version ${requested.planVersion}`, async () => {
        const db = new MemoryKeys();
        const store = new PostgresExecutionKeyStore(db);
        const now = new Date('2026-01-01T00:00:00.000Z');
        await store.reserve({ key: 'shared-key', planId: 'plan-1', planVersion: 1, now });
        if (state === 'completed') await store.complete('shared-key', now, { status: 'EXECUTED' });
        if (state === 'failed_retryable') await store.failRetryable('shared-key', now, { status: 'FAILED' });
        const original = structuredClone(db.rows.get('shared-key'));

        await expect(store.reserve({ key: 'shared-key', ...requested, now })).rejects.toMatchObject({
          name: 'ExecutionKeyConflictError',
          key: 'shared-key',
          existingPlanId: 'plan-1',
          existingPlanVersion: 1,
          requestedPlanId: requested.planId,
          requestedPlanVersion: requested.planVersion
        });
        await expect(store.reserve({ key: 'shared-key', ...requested, now })).rejects.toBeInstanceOf(ExecutionKeyConflictError);

        expect(db.rows.get('shared-key')).toEqual(original);
      });
    }
  }

  it('allows a retry by the original plan and version without changing key ownership', async () => {
    const db = new MemoryKeys();
    const store = new PostgresExecutionKeyStore(db);
    const now = new Date('2026-01-01T00:00:00.000Z');
    const owner = { key: 'shared-key', planId: 'plan-1', planVersion: 1 };
    await store.reserve({ ...owner, now });
    await store.failRetryable(owner.key, now, { status: 'FAILED' });

    expect(await store.reserve({ ...owner, now: new Date(now.getTime() + 1000) })).toBe('reserved');
    expect(db.rows.get(owner.key)).toMatchObject({ ...owner, state: 'reserved' });
  });

  it('exposes the same ownership assertion for reconciliation and recovery callers', async () => {
    const store = new PostgresExecutionKeyStore(new MemoryKeys());
    const owner = { planId: 'plan-1', planVersion: 1 };
    await store.reserve({ key: 'shared-key', ...owner, now: new Date('2026-01-01T00:00:00.000Z') });
    const existing = await store.get('shared-key') as ExecutionKeyRecord;

    expect(() => assertExecutionKeyOwnership(existing, owner)).not.toThrow();
    expect(() => assertExecutionKeyOwnership(existing, { ...owner, planId: 'plan-2' })).toThrow(ExecutionKeyConflictError);
    expect(() => assertExecutionKeyOwnership(existing, { ...owner, planVersion: 2 })).toThrow(ExecutionKeyConflictError);
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

  it('fails closed for an unknown recovery classification at runtime', async () => {
    const db = new MemoryKeys();
    const store = new PostgresExecutionKeyStore(db);
    await store.reserve({ key: 'k1', planId: 'plan-1', planVersion: 1, now: new Date('2026-01-01T00:00:00.000Z'), leaseMs: 1000 });

    const recovered = await store.recoverExpiredReservation({
      key: 'k1',
      classification: 'unknown' as StaleReservationClassification,
      now: new Date('2026-01-01T00:00:02.000Z')
    });

    expect(recovered).toBe('recovery_required');
    expect(db.rows.get('k1')!.state).toBe('reserved');
  });

  for (const classification of ['applied', 'not_applied'] as const) {
    it(`does not mark a renewed reservation ${classification} using a stale lease observation`, async () => {
      const db = new MemoryKeys();
      const store = new PostgresExecutionKeyStore(db);
      const reservedAt = new Date('2026-01-01T00:00:00.000Z');
      const later = new Date('2026-01-01T00:00:02.000Z');
      await store.reserve({ key: 'k1', planId: 'plan-1', planVersion: 1, now: reservedAt, leaseMs: 1000 });
      const renewed = {
        ...db.rows.get('k1'),
        createdAt: later,
        leaseExpiresAt: new Date(later.getTime() + 60_000)
      };
      // Another worker recovers and re-reserves between this worker's read and write.
      db.beforeUpdate = () => db.rows.set('k1', renewed);

      const recovered = await store.recoverExpiredReservation({ key: 'k1', classification, now: later });

      expect(recovered).toBe('in_flight');
      expect(db.rows.get('k1')).toEqual({ ...renewed, state: 'reserved' });
    });
  }

  it('returns completed when another worker completes before a not-applied recovery writes', async () => {
    const db = new MemoryKeys();
    const store = new PostgresExecutionKeyStore(db);
    await store.reserve({ key: 'k1', planId: 'plan-1', planVersion: 1, now: new Date('2026-01-01T00:00:00.000Z'), leaseMs: 1000 });
    db.beforeUpdate = () => { db.rows.get('k1')!.state = 'completed'; };

    const recovered = await store.recoverExpiredReservation({
      key: 'k1',
      classification: 'not_applied',
      now: new Date('2026-01-01T00:00:02.000Z')
    });

    expect(recovered).toBe('completed');
    expect(db.rows.get('k1')!.state).toBe('completed');
  });
});
