import { expect, test } from '@playwright/test';
import { e2ePool, resetDemoBaseline, seedCompletedConversionInvestigation } from './helpers/db';
import { expectHealthyOverview, gotoOverview, openTab, resetDemoViaUi } from './helpers/ui';

test.describe('LedgerGuard UI smoke', () => {
  test('overview renders health metrics and demo controls', async ({ page }) => {
    await resetDemoViaUi(page);
    await expectHealthyOverview(page);
    await expect(page.getByRole('button', { name: /Simulate Conversion Error/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /Reset Demo/i })).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Primary' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Agent' })).toHaveCount(0);
  });

  test('incident page tabs include investigation, impact, remediation, resolution', async ({ page }) => {
    test.setTimeout(180_000);
    const pool = e2ePool();
    try {
      await resetDemoBaseline(pool);
      const investigationId = await seedCompletedConversionInvestigation(pool);
      await page.goto(`/incidents/${investigationId}`, { waitUntil: 'domcontentloaded' });
      await expect(page.getByRole('tab', { name: 'Investigation' })).toBeVisible({ timeout: 60_000 });
      await expect(page.getByRole('tab', { name: 'Impact' })).toBeVisible();

      await openTab(page, 'Impact');
      await expect(page.getByRole('heading', { name: 'Primary exposure' })).toBeVisible();
      await expect(page.getByRole('heading', { name: 'Evidence records' })).toBeVisible();
      await expect(page.getByRole('heading', { name: 'Correction targets' })).toBeVisible();
      await expect(page.getByText('Gross statement footprint (not headline exposure)')).toBeVisible();

      await openTab(page, 'Remediation');
      await expect(page.getByRole('heading', { name: 'Remediation actions' })).toBeVisible();
      await expect(page.getByRole('button', { name: /Generate remediation plan|Generate new plan/i })).toBeVisible();

      await openTab(page, 'Resolution');
      await expect(page.getByRole('heading', { name: 'Resolution actions' })).toBeVisible();
    } finally {
      await pool.end();
    }
  });

  test('mobile overview stacks without horizontal page overflow', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile', 'Mobile project only');
    await gotoOverview(page);
    await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible({ timeout: 45_000 });
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 1);
  });
});
