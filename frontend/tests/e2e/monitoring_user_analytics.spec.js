import { test, expect } from '@playwright/test';
import { requirePreview, loginAs } from './_helpers.js';

test.describe('Monitoring > User Analytics (post-AO verification)', () => {
  test.beforeEach(() => requirePreview(test));

  test('analytics panel mounts with no RetryCard error', async ({ page }) => {
    await loginAs(page, 'admin');
    await page.goto('/monitoring?tab=analytics');
    await expect(page.getByTestId('monitoring-page')).toBeVisible();
    for (const id of ['overview', 'analytics', 'integrity', 'infra']) {
      await expect(page.getByTestId(`monitoring-tab-${id}`)).toBeVisible();
    }
    const panel = page.getByTestId('monitoring-analytics-panel');
    await expect(panel).toBeVisible();
    // AnalyticsTab renders a `RetryCard` headline like "Couldn't load <tab>"
    // on any backend error — assert that no such card is visible after mount.
    await expect(panel.getByText(/Couldn't load/i)).toHaveCount(0, { timeout: 10_000 });
  });
});
