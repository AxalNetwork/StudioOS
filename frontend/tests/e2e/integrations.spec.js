import { test, expect } from '@playwright/test';
import { requirePreview, loginAs } from './_helpers.js';

// /integrations now redirects into Settings → Integrations (available to every
// authenticated role); the marketplace renders embedded there and still exposes
// the same integrations-page + provider-card testids. We log in as admin so the
// full marketplace renders for this verification.
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
