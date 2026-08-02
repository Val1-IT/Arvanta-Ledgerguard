import { expect, type Page } from '@playwright/test';

export async function gotoOverview(page: Page) {
  await page.goto('/overview', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible({ timeout: 60_000 });
}

export async function resetDemoViaUi(page: Page) {
  await gotoOverview(page);
  await expect(page.getByTestId('demo-controls')).toHaveAttribute('data-hydrated', 'true', {
    timeout: 30_000
  });
  const resetBtn = page.getByTestId('reset-demo');
  await expect(resetBtn).toBeEnabled({ timeout: 30_000 });
  await resetBtn.click();
  const dialog = page.getByRole('alertdialog');
  await expect(dialog).toBeVisible({ timeout: 15_000 });
  await dialog.getByRole('button', { name: /^Reset demo$/i }).click();
  await expect(dialog).toBeHidden({ timeout: 60_000 });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible();
}

export async function expectHealthyOverview(page: Page) {
  await expect(page.getByText('Data Health', { exact: true })).toBeVisible();
  await expect(page.getByText(/Healthy/i).first()).toBeVisible();
  await expect(page.getByText('Demo environment — synthetic ERP data only.')).toBeVisible();
}

export async function simulateConversionErrorViaUi(page: Page): Promise<string> {
  await gotoOverview(page);
  await page.getByRole('button', { name: /Simulate Conversion Error/i }).click();
  await page.waitForURL(/\/incidents\/[0-9a-f-]+/i, { timeout: 120_000 });
  const match = page.url().match(/\/incidents\/([0-9a-f-]+)/i);
  if (!match?.[1]) throw new Error(`Simulate did not land on incident URL: ${page.url()}`);
  return match[1];
}

export async function openTab(page: Page, name: 'Investigation' | 'Impact' | 'Remediation' | 'Resolution') {
  await expect(page.getByTestId('incident-tabs')).toHaveAttribute('data-hydrated', 'true', {
    timeout: 30_000
  });
  const tab = page.getByRole('tab', { name });
  await expect(tab).toBeVisible({ timeout: 30_000 });
  await tab.click();
  if ((await tab.getAttribute('aria-selected')) !== 'true') {
    await tab.click({ force: true });
  }
  await expect(tab).toHaveAttribute('aria-selected', 'true', { timeout: 10_000 });
}

export async function generateSubmitApprove(page: Page) {
  await openTab(page, 'Remediation');
  await expect(page.getByTestId('remediation-controls')).toHaveAttribute('data-hydrated', 'true', {
    timeout: 30_000
  });
  const generate = page.getByRole('button', { name: /Generate remediation plan|Generate new plan/i });
  await expect(generate).toBeEnabled({ timeout: 30_000 });
  await generate.click();
  await expect(page.getByRole('button', { name: /Submit for approval/i })).toBeEnabled({ timeout: 60_000 });

  await page.getByRole('button', { name: /Submit for approval/i }).click();
  await expect(page.getByRole('button', { name: /^Approve$/i })).toBeEnabled({ timeout: 60_000 });

  await page.getByRole('button', { name: /^Approve$/i }).click();
  const dialog = page.getByRole('alertdialog');
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: /Approve plan/i }).click();
  await expect(dialog).toBeHidden({ timeout: 60_000 });
  await expect(page.getByTestId('plan-version')).toBeVisible({ timeout: 60_000 });
  await openTab(page, 'Resolution');
  await expect(page.getByRole('button', { name: /Execute remediation/i })).toBeVisible({ timeout: 60_000 });
}

export async function executeRemediation(page: Page) {
  await openTab(page, 'Resolution');
  await expect(page.getByTestId('remediation-controls')).toHaveAttribute('data-hydrated', 'true', {
    timeout: 30_000
  });
  await page.getByRole('button', { name: /Execute remediation/i }).click();
  const dialog = page.getByRole('alertdialog');
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: /Execute now/i }).click();
  await expect(dialog).toBeHidden({ timeout: 90_000 });
  await expect(page.getByTestId('resolution-headline')).toContainText(/restored|Resolved/i, {
    timeout: 90_000
  });
}
