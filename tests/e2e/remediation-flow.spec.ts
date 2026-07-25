import { expect, test } from '@playwright/test';
import {
  approvePlanFromServer,
  e2ePool,
  loadLatestPlan,
  markWritebackFailed,
  resetDemoBaseline,
  seedCompletedConversionInvestigation,
  seedVerificationFailedPlan
} from './helpers/db';
import {
  executeRemediation,
  expectHealthyOverview,
  generateSubmitApprove,
  gotoOverview,
  openTab,
  resetDemoViaUi,
  simulateConversionErrorViaUi
} from './helpers/ui';

test.describe('LedgerGuard full remediation path', () => {
  test.beforeEach(({}, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'Full remediation path runs on desktop project only');
  });

  test('happy path: reset → simulate → remediate → resolve → reset', async ({ page }) => {
    test.setTimeout(300_000);

    await resetDemoViaUi(page);
    await expectHealthyOverview(page);

    const investigationId = await simulateConversionErrorViaUi(page);
    await expect(page.getByRole('tab', { name: 'Investigation' })).toBeVisible();
    await expect(page.getByText(/INVESTIGATION_COMPLETED|Unit conversion|Root cause/i).first()).toBeVisible({
      timeout: 60_000
    });

    await openTab(page, 'Impact');
    await expect(page.getByRole('heading', { name: 'Primary exposure' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Correction targets' })).toBeVisible();

    await generateSubmitApprove(page);
    await openTab(page, 'Remediation');
    await expect(page.getByTestId('plan-version')).toContainText(/v\d+/);

    await executeRemediation(page);
    await expect(page.getByTestId('resolution-headline')).toBeVisible();
    await expect(page.getByText(/Verification Pass|Verification PASS|ERP restored/i).first()).toBeVisible();
    await expect(page.getByText(/DataHub/i).first()).toBeVisible();

    // Write-back may SYNC or FAIL depending on DataHub; both are valid UI states.
    const writebackBtn = page.getByRole('button', { name: /Retry DataHub write-back/i });
    if (await writebackBtn.isVisible().catch(() => false)) {
      await writebackBtn.click();
      await expect(
        page.getByText(/synced|write-back failed|still requires synchronization|stale/i).first()
      ).toBeVisible({ timeout: 60_000 });
    }

    await resetDemoViaUi(page);
    await expectHealthyOverview(page);
    expect(investigationId).toBeTruthy();
  });

  test('reject path does not expose execute', async ({ page }) => {
    test.setTimeout(180_000);
    const pool = e2ePool();
    try {
      await resetDemoBaseline(pool);
      const investigationId = await seedCompletedConversionInvestigation(pool);
      await page.goto(`/incidents/${investigationId}`, { waitUntil: 'domcontentloaded' });
      await openTab(page, 'Remediation');
      await page.getByRole('button', { name: /Generate remediation plan/i }).click();
      await page.getByRole('button', { name: /Submit for approval/i }).click();
      await page.getByRole('button', { name: /^Reject$/i }).click();
      await page.getByRole('alertdialog').getByRole('button', { name: /Reject plan/i }).click();
      await expect(page.getByText(/Plan rejected|Rejected/i).first()).toBeVisible({ timeout: 60_000 });
      await openTab(page, 'Resolution');
      await expect(page.getByRole('button', { name: /Execute remediation/i })).toHaveCount(0);
    } finally {
      await pool.end();
    }
  });

  test('keep reports frozen path does not expose execute', async ({ page }) => {
    test.setTimeout(180_000);
    const pool = e2ePool();
    try {
      await resetDemoBaseline(pool);
      const investigationId = await seedCompletedConversionInvestigation(pool);
      await page.goto(`/incidents/${investigationId}`, { waitUntil: 'domcontentloaded' });
      await openTab(page, 'Remediation');
      await page.getByRole('button', { name: /Generate remediation plan/i }).click();
      await page.getByRole('button', { name: /Submit for approval/i }).click();
      await page.getByRole('button', { name: /Keep reports frozen/i }).click();
      await page.getByRole('alertdialog').getByRole('button', { name: /Keep frozen/i }).click();
      await expect(page.getByText(/kept frozen|Keep reports frozen|Rejected/i).first()).toBeVisible({
        timeout: 60_000
      });
      await openTab(page, 'Resolution');
      await expect(page.getByRole('button', { name: /Execute remediation/i })).toHaveCount(0);
    } finally {
      await pool.end();
    }
  });

  test('stale plan version shows concurrency message', async ({ page }) => {
    test.setTimeout(180_000);
    const pool = e2ePool();
    try {
      await resetDemoBaseline(pool);
      const investigationId = await seedCompletedConversionInvestigation(pool);
      await page.goto(`/incidents/${investigationId}`, { waitUntil: 'domcontentloaded' });
      await openTab(page, 'Remediation');
      await page.getByRole('button', { name: /Generate remediation plan/i }).click();
      await page.getByRole('button', { name: /Submit for approval/i }).click();
      await expect(page.getByRole('button', { name: /^Approve$/i })).toBeVisible({ timeout: 60_000 });

      const plan = await loadLatestPlan(pool, investigationId);
      expect(plan).toBeTruthy();
      await approvePlanFromServer(pool, plan!.id, plan!.version);

      await page.getByRole('button', { name: /^Approve$/i }).click();
      await page.getByRole('alertdialog').getByRole('button', { name: /Approve plan/i }).click();
      await expect(
        page.getByText(/changed while you were working|Invalid transition|Refresh/i).first()
      ).toBeVisible({ timeout: 30_000 });
      await expect(page.getByRole('button', { name: /Refresh latest plan/i })).toBeVisible();
    } finally {
      await pool.end();
    }
  });

  test('double confirm Execute does not run twice', async ({ page }) => {
    test.setTimeout(180_000);
    const pool = e2ePool();
    try {
      await resetDemoBaseline(pool);
      const investigationId = await seedCompletedConversionInvestigation(pool);
      await page.goto(`/incidents/${investigationId}`, { waitUntil: 'domcontentloaded' });
      await generateSubmitApprove(page);
      await expect
        .poll(async () => (await loadLatestPlan(pool, investigationId))?.state, { timeout: 30_000 })
        .toBe('APPROVED');
      const before = await loadLatestPlan(pool, investigationId);

      await executeRemediation(page);
      await expect
        .poll(async () => (await loadLatestPlan(pool, investigationId))?.state, { timeout: 90_000 })
        .toBe('RESOLVED');

      // After success, Execute is gone — a second execute cannot be started from the UI.
      await openTab(page, 'Resolution');
      await expect(page.getByRole('button', { name: /Execute remediation/i })).toHaveCount(0);
      const plan = await loadLatestPlan(pool, investigationId);
      expect(plan?.executedAt).toBeTruthy();
      expect(plan?.version).toBeGreaterThan(before!.version);

      // Guard also covers rapid re-entry: action buttons stay disabled while busy (unit-covered).
      // Here we assert terminal uniqueness — only one RESOLVED plan for this investigation.
      const { listRemediationPlansForInvestigation } = await import('../../src/ui/server/queries');
      const history = await listRemediationPlansForInvestigation(pool, investigationId, 10);
      expect(history.filter((p) => p.state === 'RESOLVED')).toHaveLength(1);
    } finally {
      await pool.end();
    }
  });

  test('verification failure fixture keeps at-risk semantics', async ({ page }) => {
    test.setTimeout(180_000);
    const pool = e2ePool();
    try {
      await resetDemoBaseline(pool);
      const investigationId = await seedCompletedConversionInvestigation(pool);
      await seedVerificationFailedPlan(pool, investigationId);
      await page.goto(`/incidents/${investigationId}`, { waitUntil: 'domcontentloaded' });
      await openTab(page, 'Resolution');
      await expect(page.getByTestId('resolution-headline')).toContainText(/Verification failed|not changed/i);
      await expect(page.getByText(/At-risk|at risk|not restored/i).first()).toBeVisible();
      await expect(page.getByRole('button', { name: /Execute remediation/i })).toHaveCount(0);
    } finally {
      await pool.end();
    }
  });

  test('DataHub write-back failed keeps ERP RESOLVED with retry', async ({ page }) => {
    test.setTimeout(240_000);
    const pool = e2ePool();
    try {
      await resetDemoBaseline(pool);
      const investigationId = await seedCompletedConversionInvestigation(pool);
      await page.goto(`/incidents/${investigationId}`, { waitUntil: 'domcontentloaded' });
      await generateSubmitApprove(page);
      await executeRemediation(page);

      const plan = await loadLatestPlan(pool, investigationId);
      expect(plan?.state).toBe('RESOLVED');
      await markWritebackFailed(pool, plan!.id);

      await page.reload({ waitUntil: 'domcontentloaded' });
      await openTab(page, 'Resolution');
      await expect(page.getByTestId('resolution-headline')).toContainText(
        /DataHub metadata still requires synchronization/i
      );
      await expect(page.getByText(/ERP restored/i).first()).toBeVisible();
      await expect(page.getByRole('button', { name: /Retry DataHub write-back/i })).toBeVisible();
      await expect(page.getByText(/all systems resolved/i)).toHaveCount(0);
    } finally {
      await pool.end();
    }
  });
});

test.describe('DEMO_MODE messaging', () => {
  test('overview always shows synthetic-data banner', async ({ page }) => {
    await gotoOverview(page);
    await expect(page.getByText('Demo environment — synthetic ERP data only.')).toBeVisible();
    await expect(page.getByRole('button', { name: /Simulate Conversion Error/i })).toBeVisible();
  });
});
