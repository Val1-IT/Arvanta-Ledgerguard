import 'dotenv/config';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema';

const DEFAULT_URL = 'postgres://ledgerguard:ledgerguard@localhost:5433/ledgerguard';

export function getDatabaseUrl(): string {
  return process.env.DATABASE_URL ?? DEFAULT_URL;
}

export function makePool(url: string = getDatabaseUrl()): Pool {
  return new Pool({ connectionString: url });
}

export function makeDb(pool: Pool) {
  return drizzle(pool, { schema });
}

export type Db = ReturnType<typeof makeDb>;
