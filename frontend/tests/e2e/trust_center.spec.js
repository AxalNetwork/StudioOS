import { test, expect } from '@playwright/test';
import { requirePreview, loginAs } from './_helpers.js';

test.describe('Trust Center > Pairwise + Sanctions (post-AO verification)', () => {
  test.beforeEach(() => requirePreview(test));

  test('founder sees Agreements tab with pairwise NDAs', async ({ page }) => {
    await loginAs(page, 'founder');
    await page.goto('/trust');
    await expect(page.getByTestId('trust-center-page')).toBeVisible();
    await page.getByTestId('trust-tab-agreements').click();
    await expect(page.getByTestId('trust-agreements-panel')).toBeVisible();
  });

  test('admin sees Sanctions tab', async ({ page }) => {
    await loginAs(page, 'admin');
    await page.goto('/trust');
    await expect(page.getByTestId('trust-center-page')).toBeVisible();
    const sanctions = page.getByTestId('trust-tab-sanctions');
    await expect(sanctions).toBeVisible();
    await sanctions.click();
    await expect(page.getByTestId('trust-sanctions-panel')).toBeVisible();
  });
});
