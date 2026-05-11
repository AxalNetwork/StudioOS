import { test, expect } from '@playwright/test';
import { requirePreview, loginAs } from './_helpers.js';

test.describe('Admin > Integration Keys (post-AO verification)', () => {
  test.beforeEach(() => requirePreview(test));

  test('panel lists providers and exposes per-row actions', async ({ page }) => {
    await loginAs(page, 'admin');
    await page.goto('/admin?tab=integration-keys');
    await expect(page.getByTestId('admin-tab-integration-keys')).toBeVisible();
    const panel = page.getByTestId('admin-integration-keys-panel');
    await expect(panel).toBeVisible();

    // The panel always renders the OAuth-keys warning banner once
    // /api/admin/integration-keys responds — this is the deterministic
    // "panel rendered without error" signal.
    await expect(panel.getByText(/OAuth client credentials are sensitive/i)).toBeVisible();
    await expect(panel.locator('text=Loading providers')).toHaveCount(0, { timeout: 10_000 });

    // Each provider exposes at least one action button (Test / Edit / Remove).
    // Assert at least one of these labels is present so an empty render fails fast.
    const actionable = panel.getByRole('button', { name: /Test|Edit|Save|Remove/i });
    expect(await actionable.count()).toBeGreaterThan(0);
  });
});
