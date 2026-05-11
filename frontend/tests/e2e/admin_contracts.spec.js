import { test, expect } from '@playwright/test';
import { requirePreview, loginAs } from './_helpers.js';

const FILTERS = ['all', 'pending', 'signed', 'voided', 'pairwise', 'partner', 'templates'];

test.describe('Admin > Contracts (post-AO verification)', () => {
  test.beforeEach(() => requirePreview(test));

  test('every sub-filter renders rows OR a non-error empty state', async ({ page }) => {
    await loginAs(page, 'admin');
    await page.goto('/admin?tab=contracts');
    const panel = page.getByTestId('admin-contracts-panel');
    await expect(panel).toBeVisible();

    for (const k of FILTERS) {
      const btn = page.getByTestId(`contracts-sub-${k}`);
      await expect(btn).toBeVisible();
      // Capture the underlying API call so we can assert non-error.
      const respPromise = page.waitForResponse(
        r => r.url().includes('/api/') && r.request().method() === 'GET',
        { timeout: 10_000 }
      ).catch(() => null);
      await btn.click();
      const resp = await respPromise;
      if (resp) expect(resp.status(), `${k} list endpoint`).toBeLessThan(500);
      // Either at least one row is rendered, or an explicit empty-state copy.
      // Both are acceptable; a thrown error or missing panel is not.
      await expect(panel).toBeVisible();
      const empty = panel.getByText(/No contracts|No pairwise|No partner|No templates/i);
      const rows = panel.locator('table tr, [role="row"]');
      const ok = (await empty.count()) > 0 || (await rows.count()) > 0;
      expect(ok, `filter ${k}: rows or empty-state must render`).toBeTruthy();
    }
  });
});
