import { defineConfig } from 'vitest/config';

// Default config: unit tests only. These run fully offline with no database.
// Integration tests (which require a running Postgres) live in a separate
// config, vitest.integration.config.ts, run via `npm run test:integration`.
export default defineConfig({
  test: {
    include: ['tests/unit/**/*.test.ts'],
    environment: 'node',
    globals: false
  }
});
