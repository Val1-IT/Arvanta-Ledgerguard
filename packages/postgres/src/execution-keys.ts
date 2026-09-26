import type { Queryable } from './queryable';

export type ExecutionKeyState = 'reserved' | 'completed' | 'failed_retryable';

export type ExecutionKeyReservation = 'reserved' | 'already_completed' | 'in_flight';

export type StaleReservationRecovery = 'completed' | 'failed_retryable' | 'recovery_required' | 'in_flight';

export type StaleReservationClassification = 'applied' | 'not_applied' | 'ambiguous';

export const DEFAULT_RESERVATION_LEASE_MS = 60_000;

export interface ExecutionKeyRecord {
  key: string;
  planId: string;
  planVersion: number;
  state: ExecutionKeyState;
  createdAt: Date | string | null;
  leaseExpiresAt: Date | string | null;
}

export class PostgresExecutionKeyStore {
  constructor(private readonly db: Queryable) {}

  async get(key: string): Promise<ExecutionKeyRecord | null> {
    const { rows } = await this.db.query(
      `select key, plan_id as "planId", plan_version as "planVersion", state,
              created_at as "createdAt", lease_expires_at as "leaseExpiresAt"
         from ledgerguard_execution_keys where key = $1`,
      [key]
    );
    const row = rows[0] as ExecutionKeyRecord | undefined;
    return row ?? null;
  }

  async reserve(input: {
    key: string;
    planId: string;
    planVersion: number;
    now: Date;
    leaseMs?: number;
  }): Promise<ExecutionKeyReservation> {
    const leaseExpiresAt = new Date(input.now.getTime() + (input.leaseMs ?? DEFAULT_RESERVATION_LEASE_MS));
    const inserted = await this.db.query(
      `insert into ledgerguard_execution_keys (key, plan_id, plan_version, state, created_at, lease_expires_at)
       values ($1, $2, $3, 'reserved', $4, $5)
       on conflict (key) do nothing
       returning key`,
      [input.key, input.planId, input.planVersion, input.now, leaseExpiresAt]
    );
    if ((inserted.rowCount ?? inserted.rows.length) > 0) {
      return 'reserved';
    }

    const existing = await this.get(input.key);
    if (!existing) {
      return 'in_flight';
    }
    if (existing.state === 'completed') {
      return 'already_completed';
    }
    if (existing.state === 'reserved') {
      return 'in_flight';
    }

    const retried = await this.db.query(
      `update ledgerguard_execution_keys
          set state = 'reserved', plan_id = $2, plan_version = $3, created_at = $4,
              completed_at = null, result_json = null, lease_expires_at = $5
        where key = $1 and state = 'failed_retryable'
        returning key`,
      [input.key, input.planId, input.planVersion, input.now, leaseExpiresAt]
    );
    return (retried.rowCount ?? retried.rows.length) > 0 ? 'reserved' : 'in_flight';
  }

  async complete(key: string, now: Date, result: unknown): Promise<void> {
    await this.db.query(
      `update ledgerguard_execution_keys
          set state = 'completed', completed_at = $2, result_json = $3, lease_expires_at = null
        where key = $1 and state = 'reserved'`,
      [key, now, JSON.stringify(result)]
    );
  }

  async failRetryable(key: string, now: Date, result: unknown): Promise<void> {
    await this.db.query(
      `update ledgerguard_execution_keys
          set state = 'failed_retryable', completed_at = $2, result_json = $3, lease_expires_at = null
        where key = $1 and state = 'reserved'`,
      [key, now, JSON.stringify(result)]
    );
  }

  async appendJournal(input: {
    id: string;
    key: string;
    planId: string;
    planVersion: number;
    status: string;
    sourceStateFingerprint: string;
    receipt: unknown;
    now: Date;
  }): Promise<void> {
    await this.db.query(
      `insert into ledgerguard_execution_journal
         (id, idempotency_key, plan_id, plan_version, status, source_state_fingerprint, receipt_json, created_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        input.id,
        input.key,
        input.planId,
        input.planVersion,
        input.status,
        input.sourceStateFingerprint,
        JSON.stringify(input.receipt),
        input.now
      ]
    );
  }

  isLeaseExpired(record: ExecutionKeyRecord, now: Date): boolean {
    if (record.state !== 'reserved') {
      return false;
    }
    const lease = record.leaseExpiresAt ? new Date(record.leaseExpiresAt) : null;
    if (lease && !Number.isNaN(lease.getTime())) {
      return now.getTime() >= lease.getTime();
    }
    const created = record.createdAt ? new Date(record.createdAt) : null;
    if (created && !Number.isNaN(created.getTime())) {
      return now.getTime() >= created.getTime() + DEFAULT_RESERVATION_LEASE_MS;
    }
    return false;
  }

  async recoverExpiredReservation(input: {
    key: string;
    classification: StaleReservationClassification;
    now: Date;
    receipt?: unknown;
  }): Promise<StaleReservationRecovery> {
    const existing = await this.get(input.key);
    if (!existing) {
      return 'failed_retryable';
    }
    if (existing.state === 'completed') {
      return 'completed';
    }
    if (existing.state !== 'reserved') {
      return existing.state === 'failed_retryable' ? 'failed_retryable' : 'in_flight';
    }
    if (!this.isLeaseExpired(existing, input.now)) {
      return 'in_flight';
    }

    if (input.classification === 'applied') {
      const completed = await this.db.query(
        `update ledgerguard_execution_keys
            set state = 'completed', completed_at = $2, result_json = $3, lease_expires_at = null
          where key = $1 and state = 'reserved'
          returning key`,
        [input.key, input.now, JSON.stringify(input.receipt ?? { status: 'RECOVERED_APPLIED' })]
      );
      if ((completed.rowCount ?? completed.rows.length) > 0) {
        return 'completed';
      }
      const raced = await this.get(input.key);
      return raced?.state === 'completed' ? 'completed' : 'in_flight';
    }

    if (input.classification === 'not_applied') {
      await this.failRetryable(input.key, input.now, input.receipt ?? { status: 'STALE_RESERVED_NOT_APPLIED' });
      return 'failed_retryable';
    }

    return 'recovery_required';
  }
}

export function defaultExecutionKey(planId: string, planVersion: number): string {
  return `remediation:${planId}:${planVersion}`;
}
