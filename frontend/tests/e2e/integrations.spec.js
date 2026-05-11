import { test, expect } from '@playwright/test';
import { requirePreview, loginAs } from './_helpers.js';

// /integrations is admin/partner/investor only — founders are denied,
// so we authenticate as admin for this surface.
test.describe('Integrations marketplace (post-AO verification)', () => {
  test.beforeEach(() => requirePreview(test));

  test('marketplace renders provider cards (≥1)', async ({ page }) => {
    await loginAs(page, 'admin');
    await page.goto('/integrations');
    await expect(page.getByTestId('integrations-page')).toBeVisible();
    const cards = page.getByTestId('integration-provider-card');
    await expect(cards.first()).toBeVisible();
    // At least one provider card is rendered.
    expect(await cards.count()).toBeGreaterThanOrEqual(1);
  });
});
