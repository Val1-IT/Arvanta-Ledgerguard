import type { Queryable } from './queryable';

export type ExecutionKeyState = 'reserved' | 'completed' | 'failed_retryable';

export type ExecutionKeyReservation = 'reserved' | 'already_completed' | 'in_flight';

export interface ExecutionKeyRecord {
  key: string;
  planId: string;
  planVersion: number;
  state: ExecutionKeyState;
}

export class PostgresExecutionKeyStore {
  constructor(private readonly db: Queryable) {}

  async get(key: string): Promise<ExecutionKeyRecord | null> {
    const { rows } = await this.db.query(
      `select key, plan_id as "planId", plan_version as "planVersion", state
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
  }): Promise<ExecutionKeyReservation> {
    const inserted = await this.db.query(
      `insert into ledgerguard_execution_keys (key, plan_id, plan_version, state, created_at)
       values ($1, $2, $3, 'reserved', $4)
       on conflict (key) do nothing
       returning key`,
      [input.key, input.planId, input.planVersion, input.now]
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
          set state = 'reserved', plan_id = $2, plan_version = $3, created_at = $4, completed_at = null, result_json = null
        where key = $1 and state = 'failed_retryable'
        returning key`,
      [input.key, input.planId, input.planVersion, input.now]
    );
    return (retried.rowCount ?? retried.rows.length) > 0 ? 'reserved' : 'in_flight';
  }

  async complete(key: string, now: Date, result: unknown): Promise<void> {
    await this.db.query(
      `update ledgerguard_execution_keys
          set state = 'completed', completed_at = $2, result_json = $3
        where key = $1`,
      [key, now, JSON.stringify(result)]
    );
  }

  async failRetryable(key: string, now: Date, result: unknown): Promise<void> {
    await this.db.query(
      `update ledgerguard_execution_keys
          set state = 'failed_retryable', completed_at = $2, result_json = $3
        where key = $1 and state = 'reserved'`,
      [key, now, JSON.stringify(result)]
    );
  }
}

export function defaultExecutionKey(planId: string, planVersion: number): string {
  return `remediation:${planId}:${planVersion}`;
}
