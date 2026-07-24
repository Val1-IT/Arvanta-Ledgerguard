import { ARTIFACTS, runPython } from './helpers';

// ---------------------------------------------------------------------------
// The DataHub suite drives real processes: the metadata bootstrap (twice, to
// prove idempotency), the MCP read proof, and the MCP write-back proof. Running
// them here once keeps the individual test files fast and lets every assertion
// work against the same artifacts.
//
// Teardown restores the demo dataset the write-back proof modified, so the suite
// leaves DataHub exactly as it found it.
// ---------------------------------------------------------------------------

export async function setup(): Promise<void> {
  await runPython(['-m', 'src.datahub.bootstrap', '--quiet', '--report', ARTIFACTS.bootstrapRun1]);
  await runPython(['-m', 'src.datahub.bootstrap', '--quiet', '--report', ARTIFACTS.bootstrapRun2]);
  await runPython(['-m', 'src.datahub.mcp.proof']);
  // Runs before the write-back proof: the mutation proof requires (and leaves
  // behind) a pristine baseline, restoring it itself as its own step D/E. The
  // write-back proof's tag + note are meant to persist in GMS until its own
  // teardown restore, so it must run after this, not before.
  await runPython(['-m', 'src.datahub.mcp.mutation_proof']);
  await runPython(['-m', 'src.datahub.mcp.writeback']);
}

export async function teardown(): Promise<void> {
  await runPython(['-m', 'src.datahub.mcp.writeback', '--restore']);
}
