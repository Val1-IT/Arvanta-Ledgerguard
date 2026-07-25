import path from 'node:path';
import { expect, test } from '@playwright/test';
import {
  approvePlanFromServer,
  e2ePool,
  loadLatestPlan,
  markWritebackFailed,
  resetDemoBaseline,
  seedCompletedConversionInvestigation
} from './helpers/db';
import { gotoOverview, openTab, resetDemoViaUi } from './helpers/ui';

const shotDir = path.join('docs', 'ui-audit', 'screenshots');

test.describe.configure({ mode: 'serial' });

test.describe('Visual QA screenshots', () => {
  test('capture key demo states', async ({ page }, testInfo) => {
    test.setTimeout(360_000);
    const project = testInfo.project.name;
    const suffix = project === 'mobile' ? 'mobile' : project === 'tablet' ? 'tablet' : 'desktop';
    const pool = e2ePool();

    try {
      await resetDemoViaUi(page);
      await gotoOverview(page);
      await page.screenshot({ path: path.join(shotDir, `healthy-overview-${suffix}.png`), fullPage: true });

      const investigationId = await seedCompletedConversionInvestigation(pool);
      await gotoOverview(page);
      await page.screenshot({ path: path.join(shotDir, `at-risk-overview-${suffix}.png`), fullPage: true });

      await page.goto(`/incidents/${investigationId}`, { waitUntil: 'domcontentloaded' });
      await openTab(page, 'Investigation');
      await page.screenshot({
        path: path.join(shotDir, `incident-investigation-${suffix}.png`),
        fullPage: true
      });

      await openTab(page, 'Impact');
      await page.screenshot({ path: path.join(shotDir, `incident-impact-${suffix}.png`), fullPage: true });

      await openTab(page, 'Remediation');
      await page.getByRole('button', { name: /Generate remediation plan/i }).click();
      await page.getByRole('button', { name: /Submit for approval/i }).click();
      await expect(page.getByRole('button', { name: /^Approve$/i })).toBeVisible({ timeout: 60_000 });
      await page.screenshot({ path: path.join(shotDir, `pending-approval-${suffix}.png`), fullPage: true });

      const pending = await loadLatestPlan(pool, investigationId);
      await approvePlanFromServer(pool, pending!.id, pending!.version);
      await page.reload({ waitUntil: 'domcontentloaded' });
      await openTab(page, 'Resolution');
      await page.screenshot({ path: path.join(shotDir, `approved-${suffix}.png`), fullPage: true });

      await page.getByRole('button', { name: /Execute remediation/i }).click();
      await page.screenshot({
        path: path.join(shotDir, `executing-verifying-${suffix}.png`),
        fullPage: true
      });
      await page.getByRole('alertdialog').getByRole('button', { name: /Execute now/i }).click();
      await expect(page.getByText(/Resolved|restored|Execution finished/i).first()).toBeVisible({
        timeout: 90_000
      });
      await page.screenshot({ path: path.join(shotDir, `resolved-${suffix}.png`), fullPage: true });

      const resolved = await loadLatestPlan(pool, investigationId);
      await markWritebackFailed(pool, resolved!.id);
      await page.reload({ waitUntil: 'domcontentloaded' });
      await openTab(page, 'Resolution');
      await page.screenshot({
        path: path.join(shotDir, `datahub-writeback-failed-${suffix}.png`),
        fullPage: true
      });

      if (suffix === 'mobile') {
        await page.screenshot({
          path: path.join(shotDir, 'mobile-incident-detail.png'),
          fullPage: true
        });
      }

      const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
      const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
      expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 2);
    } finally {
      await resetDemoBaseline(pool).catch(() => undefined);
      await pool.end();
    }
  });
});
