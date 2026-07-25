import { execSync } from 'node:child_process';
import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
import { e2ePool, resetDemoBaseline } from './helpers/db';

async function waitForDb(retries = 30): Promise<void> {
  const pool = e2ePool();
  for (let i = 0; i < retries; i += 1) {
    try {
      await pool.query('select 1');
      await pool.end();
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  await pool.end().catch(() => undefined);
  throw new Error('Postgres is not reachable for Playwright global setup (expected localhost:5433)');
}

export default async function globalSetup() {
  loadEnv({ path: resolve(process.cwd(), '.env') });
  process.env.DEMO_MODE = 'true';
  process.env.LLM_USE_TEMPLATE_FALLBACK = 'true';

  try {
    execSync('npm run db:up', { stdio: 'inherit', cwd: process.cwd() });
  } catch {
    // docker may already be running
  }

  await waitForDb();
  try {
    execSync('npm run db:migrate', { stdio: 'inherit', cwd: process.cwd() });
  } catch {
    // migrations may already be applied
  }

  const pool = e2ePool();
  try {
    await resetDemoBaseline(pool);
  } finally {
    await pool.end();
  }
}
