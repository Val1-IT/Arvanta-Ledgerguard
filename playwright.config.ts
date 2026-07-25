import { defineConfig, devices } from '@playwright/test';
import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';

loadEnv({ path: resolve(process.cwd(), '.env') });

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:3010';
const port = Number(new URL(baseURL).port || 3010);

export default defineConfig({
  testDir: 'tests/e2e',
  globalSetup: './tests/e2e/global-setup.ts',
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: 'list',
  timeout: 120_000,
  expect: { timeout: 20_000 },
  use: {
    baseURL,
    trace: 'on-first-retry',
    navigationTimeout: 60_000
  },
  webServer: {
    command: `npx next dev -H 127.0.0.1 -p ${port}`,
    url: `${baseURL}/overview`,
    // Always boot a fresh Next server so E2E hits the latest UI (confirm dialogs, banners).
    reuseExistingServer: false,
    timeout: 180_000,
    env: {
      ...process.env,
      DEMO_MODE: 'true',
      LLM_USE_TEMPLATE_FALLBACK: 'true',
      PORT: String(port)
    }
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
    {
      name: 'tablet',
      use: { ...devices['iPad Mini'], browserName: 'chromium', viewport: { width: 768, height: 1024 } }
    },
    {
      name: 'mobile',
      use: {
        ...devices['Pixel 5'],
        browserName: 'chromium',
        viewport: { width: 390, height: 844 }
      }
    }
  ]
});
