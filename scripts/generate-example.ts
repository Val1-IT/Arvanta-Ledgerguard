import 'dotenv/config';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { makePool } from '../src/db/client';
import { seedDatabase } from '../src/db/seed';
import { applyConversionError } from '../demo-data/scenarios/conversion-error';
import { loadInvestigationInput } from '../src/db/repositories/investigation';
import { investigate } from '../src/engine/investigate';

// ---------------------------------------------------------------------------
// Generates the FASE 4 example artifacts by actually running the engine
// against the seeded demo database (ledgerguard-postgres) — the JSON files
// below are real engine output, not hand-written samples. Run with:
//   npm run example
// Requires the demo database to be up (npm run db:up && npm run db:migrate).
// Leaves the demo database re-seeded to the healthy baseline on exit.
// ---------------------------------------------------------------------------

const ROOT = path.resolve(__dirname, '..');

async function writeJson(relativePath: string, data: unknown): Promise<void> {
  const fullPath = path.join(ROOT, relativePath);
  await mkdir(path.dirname(fullPath), { recursive: true });
  await writeFile(fullPath, JSON.stringify(data, null, 2) + '\n', 'utf8');
  console.log(`wrote ${relativePath}`);
}

async function main(): Promise<void> {
  const pool = makePool();
  try {
    await seedDatabase(pool);
    await applyConversionError(pool);

    const input = await loadInvestigationInput(pool);
    const report = investigate(input);

    await writeJson('examples/investigations/conversion-error-investigation.json', report);

    // The remediation artifact is the safe-remediation-input slice of the same
    // engine report (FASE 4 only previews corrections; FASE 6 executes them
    // after human approval) — pulled from the identical run, not fabricated.
    // recordImpact is included so remediation consumers can see which records
    // are correctionTargets (the only ones proposedCorrections may mutate) as
    // distinct from evidenceRecords/downstreamAffectedRecords, which are not.
    const remediation = {
      incidentType: report.incidentType,
      overallStatus: report.overallStatus,
      rootCause: report.rootCause,
      financialImpact: report.financialImpact,
      recordImpact: report.recordImpact,
      proposedCorrections: report.proposedCorrections,
      verificationExpectations: report.verificationExpectations
    };
    await writeJson('examples/remediations/conversion-error-remediation.json', remediation);
  } finally {
    await seedDatabase(pool); // restore the healthy baseline for other consumers
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
