import 'dotenv/config';
import { makePool } from './client';
import { seedDatabase } from './seed';

// Deterministic reset: re-seeds the demo database back to the canonical healthy
// baseline. seedDatabase truncates all domain and runtime tables first, so this
// also clears any incidents, investigation runs, and remediation plans.
export async function resetDatabase(): Promise<void> {
  const pool = makePool();
  try {
    await seedDatabase(pool);
  } finally {
    await pool.end();
  }
}

async function main(): Promise<void> {
  await resetDatabase();
  console.log('Reset complete: demo database restored to healthy baseline.');
}

const invokedDirectly = process.argv[1]?.replace(/\\/g, '/').endsWith('src/db/reset.ts');
if (invokedDirectly) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
