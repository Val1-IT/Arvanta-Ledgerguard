import { describe, expect, it } from 'vitest';
import { PostgresSystemOfRecordAdapter } from '@ledgerguard/postgres';
import type { Pool } from 'pg';

describe('PostgresSystemOfRecordAdapter transactions', () => {
  it('commits on success and rolls back on failure', async () => {
    const statements: string[] = [];
    const client = {
      query: async (sql: string) => {
        statements.push(sql.split('\n')[0]?.trim() ?? sql);
        return { rows: [], rowCount: 0 };
      },
      release() {}
    };
    const pool = {
      connect: async () => client
    } as unknown as Pool;

    const adapter = new PostgresSystemOfRecordAdapter(pool);

    await adapter.runInTransaction(async () => 'ok');
    expect(statements).toEqual(['BEGIN', 'COMMIT']);

    statements.length = 0;
    await expect(
      adapter.runInTransaction(async () => {
        throw new Error('boom');
      })
    ).rejects.toThrow('boom');
    expect(statements).toEqual(['BEGIN', 'ROLLBACK']);
  });

  it('runs beforeCommit on the same client before COMMIT and rolls back if it fails', async () => {
    const statements: string[] = [];
    const client = {
      query: async (sql: string) => {
        statements.push(sql.split('\n')[0]?.trim() ?? sql);
        return { rows: [], rowCount: 0 };
      },
      release() {}
    };
    const pool = {
      connect: async () => client
    } as unknown as Pool;

    const order: string[] = [];
    const adapter = new PostgresSystemOfRecordAdapter(pool, {
      beforeCommit: async () => {
        order.push('beforeCommit');
        throw new Error('receipt persist failed');
      }
    });

    await expect(
      adapter.runInTransaction(async () => {
        order.push('work');
        return { verification: { overallStatus: 'PASS' } };
      })
    ).rejects.toThrow('receipt persist failed');
    expect(order).toEqual(['work', 'beforeCommit']);
    expect(statements).toEqual(['BEGIN', 'ROLLBACK']);
  });

  it('declares native transaction capabilities so callers do not assume HTTP 200 is commit', () => {
    const adapter = new PostgresSystemOfRecordAdapter({ connect: async () => ({}) } as unknown as Pool);
    expect(adapter.meta.capabilities).toEqual({
      nativeTransactions: true,
      idempotencyInNativeTransaction: true
    });
  });
});
