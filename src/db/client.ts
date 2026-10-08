import 'dotenv/config';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema';

const DEFAULT_URL = 'postgres://ledgerguard:ledgerguard@localhost:5433/ledgerguard';

export function getDatabaseUrl(): string {
  return process.env.DATABASE_URL ?? DEFAULT_URL;
}

export function makePool(url: string = getDatabaseUrl()): Pool {
  const pool = new Pool({ connectionString: url });
  // Idle clients can fail during a database restart. A listener prevents an
  // unhandled EventEmitter error from terminating the app; pg removes the failed
  // client and reconnects for later requests. Never log raw connection details.
  pool.on('error', () => {
    console.error('A background database connection failed; the pool will reconnect on demand.');
  });
  return pool;
}

export function makeDb(pool: Pool) {
  return drizzle(pool, { schema });
}

export type Db = ReturnType<typeof makeDb>;
