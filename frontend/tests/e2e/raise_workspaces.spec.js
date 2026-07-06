import { test, expect } from '@playwright/test';
import { requirePreview, loginAs } from './_helpers.js';

// Task #1 — RAISE Workspaces. Frontend-only IA change collapsing the founder
// "Raise" nav from 10 items into 3 workspaces (Pitch / Capital / Legal Engine)
// that compose the existing pages via an `embedded` prop. These smokes verify
// the three workspaces render, tab/card navigation is URL-driven, and the legacy
// deep links redirect into the right workspace tab.
//
// Assertions stay tier-independent: the seeded founder's subscription tier is
// unknown, so we only touch the workspace chrome (always rendered) and the
// ungated Capital tabs and the ungated Incorporation card. The growth gate on
// the deck editor and the studio gates on the Founders/Equity cards are exercised
// by their own unit-level behaviour, not here.

test.describe('RAISE Workspaces (Task #1)', () => {
  test.beforeEach(() => requirePreview(test));

  test('legacy deep links redirect into the new workspaces', async ({ page }) => {
    await loginAs(page, 'founder');

    await page.goto('/build/deck');
    await page.waitForURL(/\/raise\/pitch$/, { timeout: 10_000 });
    await expect(page.getByTestId('pitch-workspace')).toBeVisible();

    await page.goto('/build/deck-reviewer');
    await page.waitForURL(/\/raise\/pitch\/review$/, { timeout: 10_000 });
    await expect(page.getByTestId('pitch-workspace')).toBeVisible();

    await page.goto('/raise');
    await page.waitForURL(/\/raise\/capital\/pipeline$/, { timeout: 10_000 });
    await expect(page.getByTestId('capital-workspace')).toBeVisible();
  });

  test('Pitch workspace renders and tabs are URL-driven', async ({ page }) => {
    await loginAs(page, 'founder');
    await page.goto('/raise/pitch');

    await expect(page.getByTestId('pitch-workspace')).toBeVisible();
    await expect(page.getByTestId('pitch-tab-deck')).toBeVisible();
    await expect(page.getByTestId('pitch-tab-review')).toBeVisible();

    await page.getByTestId('pitch-tab-review').click();
    await page.waitForURL(/\/raise\/pitch\/review$/, { timeout: 10_000 });

    await page.getByTestId('pitch-tab-deck').click();
    await page.waitForURL(/\/raise\/pitch$/, { timeout: 10_000 });
  });

  test('Capital workspace tabs navigate between model / cap-table / pipeline', async ({ page }) => {
    await loginAs(page, 'founder');
    await page.goto('/raise/capital');

    await expect(page.getByTestId('capital-workspace')).toBeVisible();
    await expect(page.getByTestId('capital-tab-model')).toBeVisible();
    await expect(page.getByTestId('capital-tab-cap-table')).toBeVisible();
    await expect(page.getByTestId('capital-tab-pipeline')).toBeVisible();

    await page.getByTestId('capital-tab-cap-table').click();
    await page.waitForURL(/\/raise\/capital\/cap-table$/, { timeout: 10_000 });

    await page.getByTestId('capital-tab-pipeline').click();
    await page.waitForURL(/\/raise\/capital\/pipeline$/, { timeout: 10_000 });

    await page.getByTestId('capital-tab-model').click();
    await page.waitForURL(/\/raise\/capital\/model$/, { timeout: 10_000 });
  });

  test('Legal Engine renders four cards and opens the ungated Incorporation detail', async ({ page }) => {
    await loginAs(page, 'founder');
    await page.goto('/raise/legal-engine');

    await expect(page.getByTestId('legal-engine-workspace')).toBeVisible();
    await expect(page.getByTestId('legal-engine-jurisdiction')).toBeVisible();
    for (const id of ['incorporation', 'founders', 'compliance', 'equity']) {
      await expect(page.getByTestId(`legal-card-${id}`)).toBeVisible();
    }

    // Incorporation is ungated for founders — selecting it opens the embedded
    // master-detail below the cards.
    await page.getByTestId('legal-card-incorporation').click();
    await page.waitForURL(/\/raise\/legal-engine\/incorporation$/, { timeout: 10_000 });
    await expect(page.getByTestId('legal-engine-detail')).toBeVisible();

    // Back returns to the card grid.
    await page.getByRole('button', { name: /Back to Legal Engine/i }).click();
    await page.waitForURL(/\/raise\/legal-engine$/, { timeout: 10_000 });
    await expect(page.getByTestId('legal-engine-detail')).toHaveCount(0);
  });
});
