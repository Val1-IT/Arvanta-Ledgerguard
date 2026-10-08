import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@ledgerguard/odoo': fileURLToPath(new URL('./packages/odoo/src/index.ts', import.meta.url)),
      '@ledgerguard/core': fileURLToPath(new URL('./packages/core/src/index.ts', import.meta.url)),
      '@ledgerguard/postgres': fileURLToPath(new URL('./packages/postgres/src/index.ts', import.meta.url)),
      '@ledgerguard/policy': fileURLToPath(new URL('./packages/policy/src/index.ts', import.meta.url))
    }
  },
  test: {
    include: ['tests/integration-odoo/**/*.test.ts'],
    environment: 'node',
    globals: false,
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 60_000
  }
});
