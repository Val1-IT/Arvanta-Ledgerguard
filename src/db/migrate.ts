import 'dotenv/config';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { makeDb, makePool } from './client';

// ---------------------------------------------------------------------------
// Fully non-interactive migration runner.
//
// Applies the committed SQL migrations in ./drizzle using drizzle-orm's
// migrator. Unlike `drizzle-kit push`, this never prompts for confirmation and
// never diffs against a live database — it replays the versioned SQL files that
// are checked into the repository. Applied migrations are tracked in the
// __drizzle_migrations table, so running it repeatedly is idempotent.
//
// Usage: npm run db:migrate
// ---------------------------------------------------------------------------

export async function migrateDatabase(): Promise<void> {
  const pool = makePool();
  try {
    const db = makeDb(pool);
    await migrate(db, { migrationsFolder: './drizzle' });
  } finally {
    await pool.end();
  }
}

async function main(): Promise<void> {
  await migrateDatabase();
  console.log('Migrations applied: schema is up to date.');
}

const invokedDirectly = process.argv[1]?.replace(/\\/g, '/').endsWith('src/db/migrate.ts');
if (invokedDirectly) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
