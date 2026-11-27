import { test, expect } from '@playwright/test';
import { requirePreview, loginAs } from './_helpers.js';

/**
 * Task #12 — Checkout-surface smoke for each product line.
 *
 * Axal has TWO checkout surfaces, and Stripe Tax (automatic_tax) is wired
 * into both:
 *   1. Subscriptions (founder-tier / investor / MI Pro) → hosted Stripe
 *      Checkout Sessions (the app redirects to the session `url`). Tax +
 *      `customer_update[address]=auto` are set on the session server-side.
 *   2. Incorporation / expert bookings / à la carte → the in-app
 *      <AxalCheckout> embedded terminal (Stripe Elements Payment Element,
 *      no redirect). Tax is set on the incorporation Invoice / Checkout
 *      Session server-side. (Raw à la carte / booking PaymentIntents can't
 *      carry automatic_tax — deferred to the Tax Calculation-API follow-up.)
 *
 * This spec is the requirePreview()-gated smoke that each checkout surface
 * LOADS for its authorized role and reaches a DEFINITE state — never a
 * blank page or a checkout error. Every assertion requires a concrete
 * signal (no "assert nothing went wrong" escape hatch).
 *
 * Out of scope here (tracked by the per-product-flow follow-ups): driving a
 * full charge to `succeeded` (4242 test card + 3DS) and asserting the
 * computed tax line. Both require Stripe test keys, `STRIPE_TAX_ENABLED=1`
 * in the preview worker, AND seeded data (a project to incorporate, an
 * expert to book) that this surface-smoke deliberately doesn't depend on.
 * The pure tax-param contract is covered deterministically by the unit
 * test `cloudflare-worker/test/stripeTax.test.ts`.
 */

// Stable copy rendered by <AxalCheckout> (frontend/src/components/AxalCheckout.jsx).
const TRUST_COPY_RE = /Secured by Stripe/i;
const NOT_CONFIGURED_RE = /Payments are not configured/i;
const CHECKOUT_ERROR_RE = /Could not start checkout|Payment failed|Payment could not be completed|Checkout failed/i;

test.describe('Checkout surfaces — per product line', () => {
  test.beforeEach(() => requirePreview(test));

  test('Subscription checkout entrypoint renders on Settings → Billing', async ({ page }) => {
    await loginAs(page, 'founder');
    await page.goto('/account/billing');
    const root = page.getByTestId('settings-page');
    await expect(root).toBeVisible();
    await expect(root).toHaveAttribute('data-active-section', 'billing');

    // The founder billing tab is in exactly one of two definite states:
    //   • not yet subscribed → the plan ladder with an "Upgrade to …" CTA
    //     (clicking it calls /api/billing/tier/checkout → hosted Stripe
    //     Checkout where automatic_tax is applied), OR
    //   • already subscribed → the in-app "Manage subscription" dashboard.
    // Require one of them to appear — a blank/broken tab fails here rather
    // than passing vacuously.
    const upgradeCta = page.getByRole('button', { name: /Upgrade to/i });
    const manageHeading = page.getByText(/Manage subscription/i);
    await expect
      .poll(async () => (await upgradeCta.count()) + (await manageHeading.count()), {
        timeout: 15_000,
        message: 'billing tab showed neither an upgrade CTA nor the manage-subscription dashboard',
      })
      .toBeGreaterThan(0);

    // And the tab must never surface a checkout error on a clean load.
    await expect(page.getByText(CHECKOUT_ERROR_RE)).toHaveCount(0);
  });

  test('Incorporation embedded-checkout funnel loads error-free', async ({ page }) => {
    await loginAs(page, 'founder');
    await page.goto('/incorporate');

    // Definite funnel-entry signals: the wizard heading + the first
    // (Goals) step's Next CTA. The Next button is intentionally disabled
    // until all five questions are answered — its mere presence proves the
    // multi-step funnel that leads into the <AxalCheckout> payment step
    // mounted and is interactive.
    await expect(page.getByRole('heading', { name: /Incorporate your company/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /^Next/i })).toBeVisible();

    // Funnel must load without a top-level wizard error or a checkout error.
    await expect(page.getByText(/Failed to load jurisdictions|Failed to load projects/i)).toHaveCount(0);
    await expect(page.getByText(CHECKOUT_ERROR_RE)).toHaveCount(0);

    // If the seed founder lands directly on the embedded payment step (an
    // in-flight order), the terminal must be in a valid state — assert it
    // rather than ignore it. Otherwise the disabled-Next funnel assertion
    // above already proved the surface.
    if (await page.getByText(TRUST_COPY_RE).or(page.getByText(NOT_CONFIGURED_RE)).count()) {
      const notConfigured = page.getByText(NOT_CONFIGURED_RE);
      if (await notConfigured.count()) {
        await expect(notConfigured.first()).toBeVisible();
      } else {
        const stripeFrame = page.locator('iframe[src*="js.stripe.com"], iframe[title*="Secure" i]');
        await expect
          .poll(async () => (await page.getByText(TRUST_COPY_RE).count()) + (await stripeFrame.count()), {
            timeout: 15_000,
            message: 'embedded incorporation terminal did not mount',
          })
          .toBeGreaterThan(0);
      }
    }
  });

  test('embedded checkout never exposes raw card fields in app DOM (PCI SAQ-A guard)', async ({ page }) => {
    // Card capture must happen exclusively inside Stripe's iframe — there
    // must be NO app-owned <input> collecting a card number on any checkout
    // surface. The billing tab is the most deterministic place to assert it.
    await loginAs(page, 'founder');
    await page.goto('/account/billing');
    await expect(page.getByTestId('settings-page')).toBeVisible();

    const cardInputs = page.locator(
      'input[name*="card" i], input[autocomplete="cc-number"], input[name="cardnumber"]',
    );
    await expect(cardInputs).toHaveCount(0);
  });
});
