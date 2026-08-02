import 'dotenv/config';
import { execFile } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { describeLiveModelCredentialStatus } from '../src/agent/model-factory';
import { makePool } from '../src/db/client';
import { getRuntimePolicy } from '../src/runtime/runtime-policy';

const execFileAsync = promisify(execFile);
const root = path.resolve(__dirname, '..');
type Check = { label: string; ok: boolean; detail: string };
const checks: Check[] = [];

function record(label: string, ok: boolean, detail: string): void {
  checks.push({ label, ok, detail });
}

async function runMcpProof(moduleName: string): Promise<void> {
  await execFileAsync(process.execPath, [path.join(root, 'scripts', 'py.mjs'), '-m', moduleName], {
    cwd: root,
    maxBuffer: 8 * 1024 * 1024
  });
}

function mcpExecutableExists(): boolean {
  if (process.env.DATAHUB_MCP_COMMAND?.trim()) return true;
  return [
    path.join(root, '.venv', 'Scripts', 'mcp-server-datahub.exe'),
    path.join(root, '.venv', 'bin', 'mcp-server-datahub')
  ].some(existsSync);
}

async function main(): Promise<void> {
  const policy = getRuntimePolicy();
  record('Judge mode enabled', policy.judgeMode, 'Set JUDGE_MODE=true.');
  record('Demo fallback disabled', !policy.allowDemoFallback, 'Judge mode must override ALLOW_DEMO_FALLBACK.');

  // Do not touch even the isolated demo services until the operator has
  // explicitly selected judge mode. This keeps a misconfigured preflight
  // read-only with respect to PostgreSQL and DataHub.
  if (!policy.judgeMode || policy.allowDemoFallback) {
    for (const check of checks) {
      console.log(`[${check.ok ? 'PASS' : 'FAIL'}] ${check.label}${check.ok ? '' : ` — ${check.detail}`}`);
    }
    process.exitCode = 1;
    return;
  }

  const pool = makePool();
  try {
    await pool.query('select 1');
    record('PostgreSQL connected', true, 'Demo PostgreSQL accepted a query.');

    const requiredTables = ['products', 'product_units', 'inventory_valuation', 'gross_margin_report', 'investigation_runs', 'remediation_plans'];
    const tables = await pool.query<{ table_name: string }>(
      `select table_name from information_schema.tables where table_schema = 'public' and table_name = any($1::text[])`,
      [requiredTables]
    );
    const found = new Set(tables.rows.map((row) => row.table_name));
    record('Seed/demo tables available', requiredTables.every((table) => found.has(table)), `Found ${found.size}/${requiredTables.length} required tables.`);

    const migrationFiles = readdirSync(path.join(root, 'drizzle')).filter((file) => /^\d+_.*\.sql$/.test(file));
    // drizzle-orm/node-postgres migrator records history in schema "drizzle"
    // (table drizzle.__drizzle_migrations), not public.__drizzle_migrations.
    const applied = await pool.query<{ count: string }>(
      'select count(*)::text as count from drizzle.__drizzle_migrations'
    );
    const appliedCount = Number(applied.rows[0]?.count ?? 0);
    record(
      'Migrations available and applied',
      migrationFiles.length > 0 && appliedCount >= migrationFiles.length,
      `${appliedCount}/${migrationFiles.length} committed migrations recorded.`
    );
  } catch (error) {
    record('PostgreSQL connected', false, error instanceof Error ? error.message : String(error));
  } finally {
    await pool.end().catch(() => undefined);
  }

  record('DataHub GMS configured', Boolean(process.env.DATAHUB_GMS_URL?.trim()), 'Set DATAHUB_GMS_URL to the judge DataHub GMS endpoint.');
  record('DataHub MCP server available', mcpExecutableExists(), 'Install mcp-server-datahub in .venv or set DATAHUB_MCP_COMMAND.');

  try {
    await runMcpProof('src.datahub.mcp.proof');
    record('MCP session, dataset, field, and lineage', true, 'MCP read proof found product_units.conversion_factor and downstream gross_margin_report.');
  } catch (error) {
    record('MCP session, dataset, field, and lineage', false, error instanceof Error ? error.message : String(error));
  }

  try {
    await runMcpProof('src.datahub.mcp.mutation_proof');
    record('MCP mutations and safe restore', true, 'Mutation proof performed read-back and restored the dedicated demo metadata target.');
  } catch (error) {
    record('MCP mutations and safe restore', false, error instanceof Error ? error.message : String(error));
  }

  if (policy.requireLiveModel) {
    const liveModel = describeLiveModelCredentialStatus(policy);
    record('Live model configured', liveModel.ok, liveModel.detail);
  } else {
    record('Model policy', true, 'Live model is optional; proof artifacts will state the selected model source.');
  }

  for (const check of checks) {
    console.log(`[${check.ok ? 'PASS' : 'FAIL'}] ${check.label}${check.ok ? '' : ` — ${check.detail}`}`);
  }
  if (checks.every((check) => check.ok)) {
    console.log('\nREADY FOR JUDGING');
    return;
  }
  process.exitCode = 1;
}

main().catch((error) => {
  console.error(`[FAIL] Judge preflight could not complete — ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
