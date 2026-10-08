import { readMigrationFiles } from 'drizzle-orm/migrator';
import type { Pool } from 'pg';
import { insertSeedData } from '../src/db/seed';
import { applyDuplicateInventoryError } from '../demo-data/scenarios/duplicate-inventory';

export class DemoSafetyError extends Error {}

export function validateDemoTarget(value: string | undefined): { url: string; database: string; label: string } {
  const message = 'DATABASE_URL must identify a local, dedicated ledgerguard_demo_ database with no query parameters or fragment. See docs/testing/postgres-demo.md.';
  let url: URL;
  try { url = new URL(value ?? ''); } catch { throw new DemoSafetyError(message); }
  const database = url.pathname.slice(1);
  if (
    !['postgres:', 'postgresql:'].includes(url.protocol) ||
    !['localhost', '127.0.0.1'].includes(url.hostname) ||
    !/^ledgerguard_demo_[a-z0-9_]+$/.test(database) || database.length > 63 ||
    url.search || url.hash || /[?#]/.test(value ?? '')
  ) throw new DemoSafetyError(message);
  // pg otherwise inherits PGPORT even though the consent label shows 5432.
  url.port ||= '5432';
  return { url: url.href, database, label: `${url.hostname}:${url.port}/${database}` };
}

// Only the committed migration SQL is used. Ordinary migrations allow existing
// tables; initialization must instead fail on a raced-in table rather than ever
// ALTER, DROP, or seed it. This also covers multi-statement migration chunks.
export function strictFreshMigration(sql: string): string {
  return sql.replace(/\b(CREATE\s+(?:TABLE|INDEX|SCHEMA))\s+IF\s+NOT\s+EXISTS\b/gi, '$1');
}

export async function initializeDemoDatabase(pool: Pool, database: string): Promise<void> {
  const migrations = readMigrationFiles({ migrationsFolder: './drizzle' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SET LOCAL lock_timeout = '5s'");
    await client.query("SET LOCAL statement_timeout = '15s'");
    await client.query('SET LOCAL search_path = public');
    // Serializes this demo's initializers. Strict CREATE below is the protection
    // against other writers, which do not honor this advisory lock.
    await client.query('SELECT pg_catalog.pg_advisory_xact_lock(716231, 1301)');
    const inspection = await client.query<{ safe: boolean }>(`
      SELECT
        pg_catalog.current_database() = $1
        AND EXISTS (SELECT 1 FROM pg_catalog.pg_database WHERE datname = pg_catalog.current_database() AND pg_catalog.pg_get_userbyid(datdba) = current_user)
        AND EXISTS (SELECT 1 FROM pg_catalog.pg_namespace WHERE nspname = 'public')
        AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_namespace WHERE nspname !~ '^pg_' AND nspname NOT IN ('public', 'information_schema'))
        AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname !~ '^pg_' AND n.nspname <> 'information_schema')
        AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname !~ '^pg_' AND n.nspname <> 'information_schema')
        AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_type t JOIN pg_catalog.pg_namespace n ON n.oid = t.typnamespace WHERE n.nspname !~ '^pg_' AND n.nspname <> 'information_schema')
        AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_collation o JOIN pg_catalog.pg_namespace n ON n.oid = o.collnamespace WHERE n.nspname !~ '^pg_' AND n.nspname <> 'information_schema')
        AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_operator o JOIN pg_catalog.pg_namespace n ON n.oid = o.oprnamespace WHERE n.nspname !~ '^pg_' AND n.nspname <> 'information_schema')
        AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_opclass o JOIN pg_catalog.pg_namespace n ON n.oid = o.opcnamespace WHERE n.nspname !~ '^pg_' AND n.nspname <> 'information_schema')
        AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_opfamily o JOIN pg_catalog.pg_namespace n ON n.oid = o.opfnamespace WHERE n.nspname !~ '^pg_' AND n.nspname <> 'information_schema')
        AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_conversion o JOIN pg_catalog.pg_namespace n ON n.oid = o.connamespace WHERE n.nspname !~ '^pg_' AND n.nspname <> 'information_schema')
        AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_ts_config o JOIN pg_catalog.pg_namespace n ON n.oid = o.cfgnamespace WHERE n.nspname !~ '^pg_' AND n.nspname <> 'information_schema')
        AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_ts_dict o JOIN pg_catalog.pg_namespace n ON n.oid = o.dictnamespace WHERE n.nspname !~ '^pg_' AND n.nspname <> 'information_schema')
        AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_ts_parser o JOIN pg_catalog.pg_namespace n ON n.oid = o.prsnamespace WHERE n.nspname !~ '^pg_' AND n.nspname <> 'information_schema')
        AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_ts_template o JOIN pg_catalog.pg_namespace n ON n.oid = o.tmplnamespace WHERE n.nspname !~ '^pg_' AND n.nspname <> 'information_schema')
        AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_extension WHERE extname <> 'plpgsql')
        AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_event_trigger)
        AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_foreign_data_wrapper)
        AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_foreign_server)
        AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_largeobject_metadata)
        AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_publication)
        AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_subscription WHERE subdbid = (SELECT oid FROM pg_catalog.pg_database WHERE datname = pg_catalog.current_database()))
      AS safe
    `, [database]);
    if (inspection.rows.length !== 1 || inspection.rows[0]?.safe !== true) {
      throw new DemoSafetyError('Target is not an empty disposable database owned by the connected role. No initialization changes were made. Create a new database; this demo never resets one.');
    }

    // Keep the migration journal, migrations, baseline and scenario in exactly
    // one transaction on this client. Do not call Drizzle's migrate() here: its
    // own BEGIN/COMMIT would break the outer initialization transaction.
    await client.query('CREATE SCHEMA drizzle');
    await client.query('CREATE TABLE drizzle.__drizzle_migrations (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at bigint)');
    for (const migration of migrations) {
      for (const statement of migration.sql) await client.query(strictFreshMigration(statement));
      await client.query('INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ($1, $2)', [migration.hash, migration.folderMillis]);
    }
    await insertSeedData(client);
    await applyDuplicateInventoryError(client);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
