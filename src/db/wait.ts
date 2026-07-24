import 'dotenv/config';
import { makePool } from './client';

// ---------------------------------------------------------------------------
// Waits until Postgres accepts connections. `docker compose up -d` returns as
// soon as the container starts, which is before the server is ready, so the
// documented setup flow polls here instead of relying on a fixed sleep.
//
// Usage: npm run db:wait
// ---------------------------------------------------------------------------

const TIMEOUT_MS = 60_000;
const INTERVAL_MS = 1_000;

export async function waitForDatabase(timeoutMs: number = TIMEOUT_MS): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;

  while (Date.now() < deadline) {
    const pool = makePool();
    try {
      await pool.query('select 1');
      await pool.end();
      return;
    } catch (err) {
      lastError = err;
      await pool.end().catch(() => undefined);
      await new Promise((resolve) => setTimeout(resolve, INTERVAL_MS));
    }
  }

  throw new Error(
    `Database not reachable after ${timeoutMs}ms. Last error: ${String(lastError)}`
  );
}

async function main(): Promise<void> {
  await waitForDatabase();
  console.log('Database is accepting connections.');
}

const invokedDirectly = process.argv[1]?.replace(/\\/g, '/').endsWith('src/db/wait.ts');
if (invokedDirectly) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
