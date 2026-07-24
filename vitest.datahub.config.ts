import { defineConfig } from 'vitest/config';

// ---------------------------------------------------------------------------
// Tests that require a live DataHub OSS instance (and, for the MCP suite, the
// self-hosted DataHub MCP server). Kept out of the default `npm test` run so the
// offline unit suite stays fast and CI-friendly.
//
//   npm run test:datahub
// ---------------------------------------------------------------------------

export default defineConfig({
  test: {
    include: ['tests/datahub/**/*.test.ts'],
    globalSetup: ['tests/datahub/global-setup.ts'],
    environment: 'node',
    globals: false,
    fileParallelism: false,
    testTimeout: 180_000,
    hookTimeout: 180_000
  }
});
