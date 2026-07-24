import 'dotenv/config';
import { execFile } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { makePool } from '../src/db/client';
import { seedDatabase } from '../src/db/seed';
import { applyConversionError } from '../demo-data/scenarios/conversion-error';
import { runInvestigation } from '../src/agent/orchestrator';
import { DeterministicTestModel } from '../src/agent/model-test';

// ---------------------------------------------------------------------------
// Generates the FASE 5 example artifact by actually running the full 13-state
// investigation agent orchestrator (src/agent/orchestrator.ts) against the
// seeded demo database and a live DataHub instance — the JSON file below is
// real orchestrator output (engine result, DataHub context, reconciliation,
// activity log, write-back), not a hand-written sample. Run with:
//   npm run example:agent
// Requires the demo database (npm run db:up && npm run db:migrate) AND a
// running, bootstrapped DataHub instance with its MCP server available
// (npm run datahub:up && npm run datahub:bootstrap), since the agent reads
// and writes real DataHub metadata as part of the investigation. The tag and
// note this leaves on inventory_valuation are restored afterward, the same
// way the DataHub test suite's own teardown does
// (tests/datahub/global-setup.ts).
// ---------------------------------------------------------------------------

const execFileAsync = promisify(execFile);
const ROOT = path.resolve(__dirname, '..');

async function writeJson(relativePath: string, data: unknown): Promise<void> {
  const fullPath = path.join(ROOT, relativePath);
  await mkdir(path.dirname(fullPath), { recursive: true });
  await writeFile(fullPath, JSON.stringify(data, null, 2) + '\n', 'utf8');
  console.log(`wrote ${relativePath}`);
}

async function restoreDataHub(): Promise<void> {
  await execFileAsync(
    process.execPath,
    [path.join(ROOT, 'scripts', 'py.mjs'), '-m', 'src.datahub.mcp.writeback', '--restore'],
    { cwd: ROOT, maxBuffer: 32 * 1024 * 1024 }
  );
}

async function main(): Promise<void> {
  const pool = makePool();
  try {
    await seedDatabase(pool);
    await applyConversionError(pool);

    const record = await runInvestigation(
      {
        incidentId: 'example-conversion-error',
        productId: 'prod-cement-40',
        triggerAsset: 'inventory_valuation',
        requestedBy: 'example-generator',
        mode: 'TEST'
      },
      { pool, model: new DeterministicTestModel() }
    );

    await writeJson('examples/agent/conversion-error-investigation-run.json', record);
  } finally {
    await seedDatabase(pool); // restore the healthy baseline for other consumers
    await pool.end();
    await restoreDataHub(); // undo the write-back tag/note this run left on DataHub
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
