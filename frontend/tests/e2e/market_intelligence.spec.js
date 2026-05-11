import { test, expect } from '@playwright/test';
import { requirePreview, loginAs } from './_helpers.js';

const MI_TAB_KEYS = ['compass', 'pulse', 'macro', 'private', 'studio', 'investor_signals'];

test.describe('Market Intelligence (post-AO verification)', () => {
  test.beforeEach(() => requirePreview(test));

  test('every visible tab renders content or an explicit empty state', async ({ page }) => {
    await loginAs(page, 'admin');
    await page.goto('/market-intel');
    const root = page.getByTestId('market-intel-page');
    await expect(root).toBeVisible();

    for (const key of MI_TAB_KEYS) {
      const btn = page.getByTestId(`mi-tab-${key}`);
      if (!(await btn.count())) continue; // role-gated tab not visible to caller
      await btn.first().click();
      await expect(root).toHaveAttribute('data-active-tab', key);
      // The page must either show data (a table/heading/section) OR an
      // explicit "no data" message. A thrown error component (or a blank
      // tab) should fail the assertion.
      const hasContent = await root.locator('h1, h2, h3, table, [role="table"]').count();
      const hasEmpty = await root.getByText(/No data|Insufficient|coming soon|No results|nothing here/i).count();
      const hasError = await root.getByText(/error loading|failed to load|something went wrong/i).count();
      expect(hasError, `MI tab ${key} surfaced an error`).toBe(0);
      expect(hasContent + hasEmpty, `MI tab ${key} rendered nothing`).toBeGreaterThan(0);
    }
  });
});
