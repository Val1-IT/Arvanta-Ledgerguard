import { Client } from 'pg';
import journal from '../../drizzle/meta/_journal.json';
import { getDatabaseUrl } from './client';

export const REQUIRED_MIGRATION_TIMES = journal.entries.map((entry) => entry.when);

/** Minimal read-only availability/schema gate, not a production security audit. */
export async function databaseReady(client = new Client({
  connectionString: getDatabaseUrl(),
  connectionTimeoutMillis: 2000,
  query_timeout: 2000,
  statement_timeout: 2000
})): Promise<boolean> {
  try {
    await client.connect();
    const applied = await client.query(
      'select count(distinct created_at)::int as count from drizzle.__drizzle_migrations where created_at = any($1::bigint[])',
      [REQUIRED_MIGRATION_TIMES]
    );
    if (Number(applied.rows[0]?.count) !== REQUIRED_MIGRATION_TIMES.length) return false;
    // LIMIT 0 validates required relations/columns without reading business rows.
    await client.query(`select id from products limit 0;
      select id from product_units limit 0;
      select reversed_at from inventory_movements limit 0;
      select id from purchase_orders limit 0;
      select id from purchase_receipts limit 0;
      select id from inventory_valuation limit 0;
      select id from journal_entries limit 0;
      select id from gross_margin_report limit 0;
      select key from baseline_snapshot limit 0;
      select id from ledgerguard_incidents limit 0;
      select id from investigation_runs limit 0;
      select remote_action_binding_json from remediation_plans limit 0;
      select lease_expires_at from ledgerguard_execution_keys limit 0;
      select receipt_json from ledgerguard_execution_journal limit 0`);
    return true;
  } catch {
    // Never reflect database URLs, credentials, SQL diagnostics, or schema names.
    return false;
  } finally {
    await client.end().catch(() => {});
  }
}
