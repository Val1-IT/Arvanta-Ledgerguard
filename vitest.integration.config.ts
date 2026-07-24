import { defineConfig } from 'vitest/config';

// Integration tests talk to a real Postgres instance (see docker-compose.yml).
// They are kept out of the default `npm test` run so unit tests stay offline.
// Files run serially to keep database state deterministic across suites.
export default defineConfig({
  test: {
    include: ['tests/integration/**/*.test.ts'],
    environment: 'node',
    globals: false,
    fileParallelism: false,
    // Seeding + scenario + reset can take a moment against a real DB.
    testTimeout: 30_000,
    hookTimeout: 30_000
  }
});
