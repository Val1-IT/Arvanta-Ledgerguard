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
});
