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
  /**
   * Lease generation (fencing token). 1 on first reserve; +1 on every
   * re-reservation and lease takeover. Remote systems that support fencing
   * reject calls carrying a lower generation for the same key.
   */
  fenceGeneration?: number;
}

export interface ExecutionKeyOwner {
  planId: string;
  planVersion: number;
}

export class ExecutionKeyConflictError extends Error {
  readonly key: string;
  readonly existingPlanId: string;
  readonly existingPlanVersion: number;
  readonly requestedPlanId: string;
  readonly requestedPlanVersion: number;

  constructor(existing: ExecutionKeyRecord, requested: ExecutionKeyOwner) {
    super(`Execution key ${existing.key} belongs to a different plan or version`);
    this.name = 'ExecutionKeyConflictError';
    this.key = existing.key;
    this.existingPlanId = existing.planId;
    this.existingPlanVersion = existing.planVersion;
    this.requestedPlanId = requested.planId;
    this.requestedPlanVersion = requested.planVersion;
  }
}

/** Validate immutable key ownership before interpreting a prior execution's state. */
export function assertExecutionKeyOwnership(existing: ExecutionKeyRecord, requested: ExecutionKeyOwner): void {
  if (existing.planId !== requested.planId || existing.planVersion !== requested.planVersion) {
    throw new ExecutionKeyConflictError(existing, requested);
  }
}

export class PostgresExecutionKeyStore {
  constructor(private readonly db: Queryable) {}

  async get(key: string): Promise<ExecutionKeyRecord | null> {
    const { rows } = await this.db.query(
      `select key, plan_id as "planId", plan_version as "planVersion", state,
              created_at as "createdAt", lease_expires_at as "leaseExpiresAt",
              fence_generation as "fenceGeneration"
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
    assertExecutionKeyOwnership(existing, input);
    if (existing.state === 'completed') {
      return 'already_completed';
    }
    if (existing.state === 'reserved') {
      return 'in_flight';
    }

    const retried = await this.db.query(
      `update ledgerguard_execution_keys
          set state = 'reserved', created_at = $4,
              completed_at = null, result_json = null, lease_expires_at = $5,
              fence_generation = fence_generation + 1
        where key = $1 and state = 'failed_retryable' and plan_id = $2 and plan_version = $3
        returning key`,
      [input.key, input.planId, input.planVersion, input.now, leaseExpiresAt]
    );
    return (retried.rowCount ?? retried.rows.length) > 0 ? 'reserved' : 'in_flight';
  }

  /**
   * Pass the generation the caller reserved with so a worker whose lease was
   * taken over cannot settle a key it no longer owns. Returns false when no row
   * was updated.
   */
  async complete(key: string, now: Date, result: unknown, fenceGeneration?: number): Promise<boolean> {
    const updated = await this.db.query(
      `update ledgerguard_execution_keys
          set state = 'completed', completed_at = $2, result_json = $3, lease_expires_at = null
        where key = $1 and state = 'reserved'
          and ($4::integer is null or fence_generation = $4)`,
      [key, now, JSON.stringify(result), fenceGeneration ?? null]
    );
    return (updated.rowCount ?? updated.rows.length) > 0;
  }

  async failRetryable(key: string, now: Date, result: unknown, fenceGeneration?: number): Promise<boolean> {
    const updated = await this.db.query(
      `update ledgerguard_execution_keys
          set state = 'failed_retryable', completed_at = $2, result_json = $3, lease_expires_at = null
        where key = $1 and state = 'reserved'
          and ($4::integer is null or fence_generation = $4)`,
      [key, now, JSON.stringify(result), fenceGeneration ?? null]
    );
    return (updated.rowCount ?? updated.rows.length) > 0;
  }

  /**
   * Take over an expired reservation by advancing its fence generation. The
   * lease deadline and state are unchanged; only one caller can win a given
   * generation. The returned generation must then be raised on the remote
   * system before its state is trusted.
   */
  async takeOverExpiredLease(input: { key: string; now: Date }): Promise<
    { outcome: 'taken_over'; fenceGeneration: number } | { outcome: 'in_flight' | 'not_reserved' }
  > {
    const existing = await this.get(input.key);
    if (!existing || existing.state !== 'reserved') return { outcome: 'not_reserved' };
    if (!this.isLeaseExpired(existing, input.now)) return { outcome: 'in_flight' };
    const generation = Number(existing.fenceGeneration ?? 1);
    const advanced = await this.db.query(
      `update ledgerguard_execution_keys
          set fence_generation = fence_generation + 1
        where key = $1 and state = 'reserved' and fence_generation = $2
          and lease_expires_at is not distinct from $3
        returning fence_generation as "fenceGeneration"`,
      [input.key, generation, existing.leaseExpiresAt]
    );
    const row = advanced.rows[0] as { fenceGeneration?: number } | undefined;
    if ((advanced.rowCount ?? advanced.rows.length) === 0 || row?.fenceGeneration === undefined) return { outcome: 'in_flight' };
    return { outcome: 'taken_over', fenceGeneration: Number(row.fenceGeneration) };
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
    /** When set, only settle the key if it is still at this generation. */
    fenceGeneration?: number;
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

    if (input.classification !== 'applied' && input.classification !== 'not_applied') {
      return 'recovery_required';
    }

    const state = input.classification === 'applied' ? 'completed' : 'failed_retryable';
    const receipt = input.receipt ?? {
      status: input.classification === 'applied' ? 'RECOVERED_APPLIED' : 'STALE_RESERVED_NOT_APPLIED'
    };
    const recovered = await this.db.query(
      `update ledgerguard_execution_keys
          set state = '${state}', completed_at = $2, result_json = $3, lease_expires_at = null
        where key = $1 and state = 'reserved'
          and plan_id = $4 and plan_version = $5
          and created_at is not distinct from $6
          and lease_expires_at is not distinct from $7
          and ($8::integer is null or fence_generation = $8)
        returning key`,
      [
        input.key,
        input.now,
        JSON.stringify(receipt),
        existing.planId,
        existing.planVersion,
        existing.createdAt,
        existing.leaseExpiresAt,
        input.fenceGeneration ?? null
      ]
    );
    if ((recovered.rowCount ?? recovered.rows.length) > 0) {
      return state;
    }

    const raced = await this.get(input.key);
    if (raced) assertExecutionKeyOwnership(raced, existing);
    return raced?.state === 'completed' || raced?.state === 'failed_retryable' ? raced.state : 'in_flight';
  }
}

export function defaultExecutionKey(planId: string, planVersion: number): string {
  return `remediation:${planId}:${planVersion}`;
}
