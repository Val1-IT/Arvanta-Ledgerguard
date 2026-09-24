import {
  CONVERSION_MISMATCH_EXAMPLE,
  type SystemOfRecordAdapter,
  type SystemOfRecordSession
} from '@ledgerguard/core';
import type { Pool, PoolClient } from 'pg';
import { applyAllowlistedCorrection } from './apply-correction';
import { loadInvestigationInput } from './repositories/investigation';

export interface PostgresSystemOfRecordAdapterOptions {
  cogsAccountCode?: string;
  systemId?: string;
}

class PostgresSession implements SystemOfRecordSession {
  constructor(
    private readonly client: PoolClient,
    private readonly cogsAccountCode: string
  ) {}

  async loadInvestigationInput() {
    return loadInvestigationInput(this.client, { cogsAccountCode: this.cogsAccountCode });
  }

  async applyCorrection(correction: Parameters<SystemOfRecordSession['applyCorrection']>[0], now: Date) {
    return applyAllowlistedCorrection(this.client, correction, now, {
      cogsAccountCode: this.cogsAccountCode
    });
  }
}

export class PostgresSystemOfRecordAdapter implements SystemOfRecordAdapter {
  readonly meta: { systemId: string; systemType: 'postgres' };
  private readonly cogsAccountCode: string;

  constructor(
    private readonly pool: Pool,
    options: PostgresSystemOfRecordAdapterOptions = {}
  ) {
    this.cogsAccountCode = options.cogsAccountCode ?? CONVERSION_MISMATCH_EXAMPLE.cogsAccountCode;
    this.meta = {
      systemId: options.systemId ?? 'postgres-inventory-ledger',
      systemType: 'postgres'
    };
  }

  async runInTransaction<T>(work: (session: SystemOfRecordSession) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await work(new PostgresSession(client, this.cogsAccountCode));
      await client.query('COMMIT');
      return result;
    } catch (error) {
      try {
        await client.query('ROLLBACK');
      } catch {
        // connection may already be unusable; the ERP transaction was not committed.
      }
      throw error;
    } finally {
      client.release();
    }
  }
}
