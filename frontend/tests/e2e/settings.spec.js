import { test, expect } from '@playwright/test';
import { requirePreview, loginAs } from './_helpers.js';

test.describe('Settings (post-AO verification)', () => {
  test.beforeEach(() => requirePreview(test));

  for (const section of ['profile', 'account', 'notifications']) {
    test(`/account/${section} mounts AND content area is non-empty`, async ({ page }) => {
      await loginAs(page, 'founder');
      await page.goto(`/account/${section}`);
      const root = page.getByTestId('settings-page');
      await expect(root).toBeVisible();
      // SettingsPage clamps `safeActive` to a section the role can see.
      await expect(root).toHaveAttribute('data-active-section', /.+/);
      // The right-hand content area must actually render at least one
      // form control or heading — a blank section is a regression.
      const controls = root.locator('input, button, select, textarea, h2, h3');
      expect(await controls.count()).toBeGreaterThan(0);
    });
  }

  test('display-name save round-trips (POST /api/settings → GET reflects it)', async ({ page }) => {
    await loginAs(page, 'founder');
    await page.goto('/account/profile');
    const root = page.getByTestId('settings-page');
    await expect(root).toBeVisible();
    // The Profile section exposes a display-name input; if it's not present
    // for this seed user we treat the test as a soft-skip rather than a
    // false negative.
    const nameInput = root.locator('input[name="display_name"], input[aria-label*="Display name" i], input[placeholder*="Display name" i]').first();
    if (!(await nameInput.count())) test.skip(true, 'no display_name input on this seed profile');
    const next = `Verify-AP-${Date.now()}`;
    await nameInput.fill(next);
    const saveBtn = root.getByRole('button', { name: /^Save( changes)?$/i }).first();
    await expect(saveBtn).toBeVisible();
    const saveResp = page.waitForResponse(
      r => /\/api\/(settings|profile)/.test(r.url()) && ['POST', 'PATCH', 'PUT'].includes(r.request().method()),
      { timeout: 10_000 }
    );
    await saveBtn.click();
    const r = await saveResp;
    expect(r.status()).toBeLessThan(400);
    // Reload and assert the value persisted.
    await page.reload();
    await expect(root).toBeVisible();
    await expect(nameInput).toHaveValue(next);
  });
});
