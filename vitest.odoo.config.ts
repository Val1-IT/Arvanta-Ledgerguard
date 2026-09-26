import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/integration-odoo/**/*.test.ts'],
    environment: 'node',
    globals: false,
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 60_000
  }
});
