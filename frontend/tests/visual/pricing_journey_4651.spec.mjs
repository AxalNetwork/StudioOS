/**
 * #4651 (Pricing audit 1/5, acceptance criterion 7) — the plan chosen on /pricing survives registration and both
 * sign-in returns, in a real browser on the built SPA, at desktop and phone width.
 *
 * The server is this folder's (`server.ts`: the built `docs/` and the real Worker). Three answers are the test's own,
 * because the local Worker cannot give them: the public catalogue has no Stripe prices here, so the paid plans get
 * synthetic ones (the seeded founder holds Raise + Grow, so the journeys check out Validate + Build); the verification-email endpoints stand in for the link in a member's inbox; and `/api/auth/me`
 * answers the account that link or Google signed in. Everything else is the SPA's own code: the card's address,
 * `?next=` kept in localStorage, the full page loads, RequireAuth's return and Pricing's checkout sheet. The Google
 * callback's own redirect to the Pricing return is held by the Worker test `pricing_google_return_4651.test.ts`.
 *
 *   · Back from registration to Pricing, and choosing another plan before signing up, carries the new plan only;
 *   · the email link (verify, then Continue, a full load of /dashboard) lands on the checkout sheet of that plan;
 *   · the Google return (`/pricing?…&google=ok`) opens the same sheet once the session is read, never "no longer offered";
 *   · a failed catalogue read on registration says so, and Try again reads it.
 */
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { CONSENT_VERSION } from '../../src/lib/cookieConsent.js';

const PAID = {
  'founder:growth': { month: 5000, year: 48000 },
  'founder:studio': { month: 10000, year: 96000 },
  advisor: { month: 4900, year: null },
};
const price = (unit_amount, interval) => ({ price_id: `price_syn_${unit_amount}_${interval}`, unit_amount, currency: 'usd', interval, interval_count: 1, allowance_microusd: 1_000_000 });

/** The real catalogue with synthetic prices on the paid plans this journey uses. */
function priced(body) {
  for (const p of body.plans || []) {
    const syn = PAID[p.licence_key];
    if (!syn || p.free) continue;
    p.prices = [syn.month && price(syn.month, 'month'), syn.year && price(syn.year, 'year')].filter(Boolean);
    p.monthly = syn.month ? { unit_amount: syn.month, currency: 'usd', allowance_microusd: 1_000_000 } : null;
    p.yearly = syn.year ? { unit_amount: syn.year, currency: 'usd', allowance_microusd: 1_000_000 } : null;
  }
  return body;
}

/**
 * The page's network: off-host requests aborted, the catalogue priced, and the session the test's to give.
 * `state.signedIn` flips when the email link is confirmed or Google returns.
 */
async function wire(page, request, manifest, state) {
  // Read the real catalogue before navigation. A request from a page the test
  // has already left must not leave a Worker fetch waiting during teardown.
  const response = await request.get('/api/public/plans-and-packs');
  expect(response.ok(), 'the visual Worker serves the public catalogue').toBeTruthy();
  const catalogue = priced(await response.json());
  await page.addInitScript((consentVersion) => {
    try {
      localStorage.setItem('axal_cookie_consent_v1', JSON.stringify({ version: consentVersion, decided: true, updatedAt: '2026-10-20T00:00:00Z', categories: { essential: true } }));
    } catch { /* storage off: the journey fails loudly on its first check */ }
  }, CONSENT_VERSION);
  await page.route((url) => url.hostname !== '127.0.0.1', (route) => route.abort('blockedbyclient'));
  await page.route('**/api/public/plans-and-packs', (route) => {
    if (state.catalogueDown > 0) { state.catalogueDown -= 1; return route.fulfill({ status: 503, contentType: 'application/json', body: '{"detail":"Unavailable"}' }); }
    return route.fulfill({ json: catalogue });
  });
  await page.route('**/api/auth/me', async (route) => {
    // The session probe after Google is a real round trip; the catalogue can answer first.
    if (state.meDelayMs) await new Promise((r) => setTimeout(r, state.meDelayMs));
    return state.signedIn
      ? route.fulfill({ status: 200, contentType: 'application/json', json: manifest.user })
      : route.fulfill({ status: 401, contentType: 'application/json', body: '{"detail":"Unauthorized"}' });
  });
  await page.route('**/api/auth/verify-email?*', (route) => route.fulfill({ status: 200, contentType: 'application/json', json: { ok: true, valid: true } }));
  await page.route('**/api/auth/confirm-verify-email', (route) => {
    state.signedIn = true;
    return route.fulfill({ status: 200, contentType: 'application/json', json: { ok: true, token: manifest.token, user: manifest.user } });
  });
}

async function manifestOf(request) {
  const res = await request.get('/__visual/manifest');
  expect(res.ok()).toBeTruthy();
  return res.json();
}

/** The Pricing return a plan link carries, read from the address the card sent the visitor to. */
const returnOf = (url) => new URL(url).searchParams.get('next');
const kept = (page) => page.evaluate(() => { try { return JSON.parse(localStorage.getItem('gvpn:next') || 'null')?.path ?? null; } catch { return null; } });

/** Focus stays inside clipped tab strips and contrasts with the selected fill. */
async function expectVisibleTabFocus(tab) {
  await expect(tab).toBeFocused();
  const indicator = await tab.evaluate(element => {
    const style = getComputedStyle(element);
    const luminance = color => {
      const rgb = color.match(/\d+(?:\.\d+)?/g).slice(0, 3).map(value => {
        const channel = Number(value) / 255;
        return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
      });
      return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
    };
    const outline = luminance(style.outlineColor), background = luminance(style.backgroundColor);
    return { width: parseFloat(style.outlineWidth), offset: parseFloat(style.outlineOffset),
      contrast: (Math.max(outline, background) + 0.05) / (Math.min(outline, background) + 0.05) };
  });
  expect(indicator.width).toBeGreaterThanOrEqual(2);
  expect(indicator.offset).toBeLessThan(0);
  expect(indicator.contrast).toBeGreaterThanOrEqual(3);
}

for (const [width, height, label] of [[1440, 900, 'desktop'], [390, 844, 'phone']]) {
  test.describe(`${label} (${width}px)`, () => {
    test.use({ viewport: { width, height } });

    test('pricing exposes the active comparison and keeps audience choices visible', async ({ page, request }, testInfo) => {
      await wire(page, request, await manifestOf(request), { signedIn: false, catalogueDown: 0 });
      await page.goto('/pricing?for=founder');
      const comparison = page.getByRole('table', { name: width === 390 ? /plan features/ : 'Compare plans' });
      await expect(comparison.getByRole('rowheader', { name: 'Customer interviews' })).toBeVisible();
      await expect(comparison.getByRole('columnheader', { name: 'Feature', exact: true })).toBeVisible();
      await expect(comparison.getByRole('columnheader', { name: 'Validate + Build' })).toBeVisible();
      await expect(page.getByRole('tabpanel', { name: 'Founder', exact: true })).toBeVisible();
      const accessibility = await new AxeBuilder({ page }).include('.axp').withTags(['wcag2a', 'wcag2aa']).analyze();
      expect(accessibility.violations).toEqual([]);
      await page.screenshot({ path: testInfo.outputPath('pricing-comparison.png'), fullPage: true });
      await expect(page.getByRole('tab', { name: 'Founder', exact: true })).toHaveAttribute('aria-selected', 'true');
      const models = page.getByRole('tab', { name: 'Models', exact: true });
      await expect(models).toBeInViewport({ ratio: 1 });
      await page.locator('.axp-compare').evaluate(element => window.scrollTo({ top: element.getBoundingClientRect().top + scrollY - 120, behavior: 'instant' }));
      await page.screenshot({ path: testInfo.outputPath('pricing-comparison-detail.png') });
      await page.getByRole('tab', { name: 'Founder', exact: true }).focus();
      await page.keyboard.press('Control+ArrowRight');
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      await expect(page.getByRole('tab', { name: 'Founder', exact: true })).toHaveAttribute('aria-selected', 'true');
      await page.keyboard.press('End');
      await expect(models).toBeFocused();
      await expect(models).toHaveAttribute('aria-selected', 'true');
      await expect(page.getByRole('tabpanel', { name: 'Models', exact: true })).toBeVisible();
      await expectVisibleTabFocus(models);
      await page.screenshot({ path: testInfo.outputPath('pricing-audience-focus.png') });
      await page.keyboard.press('ArrowRight');
      await expect(page.getByRole('tab', { name: 'Founder', exact: true })).toBeFocused();
      await expect(page.getByRole('tab', { name: 'Founder', exact: true })).toHaveAttribute('aria-selected', 'true');
    });

    test('pricing control states, phone comparison and shared signup labels survive keyboard navigation', async ({ page, request }, testInfo) => {
      await wire(page, request, await manifestOf(request), { signedIn: false, catalogueDown: 0 });
      await page.goto('/pricing?for=founder');
      const billing = page.getByRole('group', { name: 'Billing', exact: true });
      await billing.getByRole('button', { name: 'Yearly', exact: true }).click();
      await expect(billing.getByRole('button', { name: 'Yearly', exact: true })).toHaveAttribute('aria-pressed', 'true');
      await expect(billing.getByRole('button', { name: 'Monthly', exact: true })).toHaveAttribute('aria-pressed', 'false');

      if (width === 390) {
        const plans = page.getByRole('tablist', { name: 'Plan', exact: true });
        await plans.getByRole('tab', { name: 'Validate + Build', exact: true }).focus();
        await page.keyboard.press('End');
        await expect(plans.getByRole('tab', { name: 'Raise + Grow', exact: true })).toBeFocused();
        await expectVisibleTabFocus(plans.getByRole('tab', { name: 'Raise + Grow', exact: true }));
        await expect(plans.getByRole('tab', { name: 'Raise + Grow', exact: true })).toHaveAttribute('aria-selected', 'true');
        const panel = page.getByRole('tabpanel', { name: 'Raise + Grow', exact: true });
        await expect(panel.getByRole('columnheader', { name: 'Raise + Grow', exact: true })).toBeVisible();
        await page.keyboard.press('Home');
        await expect(page.getByRole('table', { name: 'Free plan features', exact: true }).getByRole('row', { name: 'Customer interviews 5', exact: true })).toBeVisible();
      }

      const faq = page.locator('.axp-faq button').first();
      const answer = page.locator(`#${await faq.getAttribute('aria-controls')}`);
      await faq.focus();
      await expect(faq).toHaveAttribute('aria-expanded', 'true');
      await expect(answer).toBeVisible();
      await page.keyboard.press('Enter');
      await expect(faq).toHaveAttribute('aria-expanded', 'false');
      await expect(answer).toBeHidden();
      await page.keyboard.press('Enter');
      await expect(answer).toBeVisible();
      await page.screenshot({ path: testInfo.outputPath('pricing-faq-open.png') });

      // 320 CSS pixels exercises the reflow width of a 1280px viewport at 400% zoom.
      await page.setViewportSize({ width: 320, height: 900 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      for (const name of ['Founder', 'Investor', 'Advisors', 'Operating Partners', 'Models']) {
        const tab = page.getByRole('tab', { name, exact: true });
        const rect = await tab.boundingBox();
        expect(rect.x).toBeGreaterThanOrEqual(0);
        expect(rect.x + rect.width).toBeLessThanOrEqual(320);
      }
      await page.screenshot({ path: testInfo.outputPath('pricing-reflow-320.png'), fullPage: true });
      await page.locator('a[href*="plan=founder%3Agrowth"], a[href*="plan=founder:growth"]').first().click();
      await expect(page).toHaveURL(/\/register\?/);
      for (const label of [/Full name/i, /Email/i]) {
        const field = page.getByRole('textbox', { name: label });
        await expect(field).toBeVisible();
        const id = await field.getAttribute('id');
        expect(id).toBeTruthy();
        await page.locator(`label[for="${id}"]`).click();
        await expect(field).toBeFocused();
      }
      await page.screenshot({ path: testInfo.outputPath('pricing-origin-signup-labels.png'), fullPage: true });
    });

    test('Back and choosing another plan before signing up carry the new plan only; the email link opens its checkout', async ({ page, request }) => {
      const manifest = await manifestOf(request);
      const state = { signedIn: false, catalogueDown: 0 };
      await wire(page, request, manifest, state);

      await page.goto('/pricing?for=founder');
      await page.getByRole('button', { name: 'Yearly' }).click();
      await page.locator('a[href*="plan=founder%3Agrowth"], a[href*="plan=founder:growth"]').first().waitFor();
      await page.locator('a[href*="plan=founder%3Astudio"], a[href*="plan=founder:studio"]').first().click();
      await expect(page).toHaveURL(/\/register\?/);
      const first = new URL(page.url()).searchParams;
      expect([first.get('plan'), first.get('interval')]).toEqual(['founder:studio', 'yearly']);
      await expect(page.getByTestId('register-plan-price')).toContainText('$960 billed yearly');
      await expect.poll(() => kept(page)).toBe(returnOf(page.url()));

      // Browser Back to Pricing, then the other plan, monthly this time.
      await page.goBack();
      await expect(page).toHaveURL(/\/pricing/);
      await page.getByRole('button', { name: 'Monthly' }).click();
      await page.locator('a[href*="plan=founder%3Agrowth"], a[href*="plan=founder:growth"]').first().click();
      await expect(page).toHaveURL(/\/register\?/);
      const second = new URL(page.url()).searchParams;
      expect([second.get('plan'), second.get('interval')]).toEqual(['founder:growth', 'monthly']);
      await expect(page.getByTestId('register-plan-price')).toContainText('billed every month');
      const growthReturn = returnOf(page.url());
      expect(growthReturn).toContain('checkout=founder%3Agrowth');
      await expect.poll(() => kept(page), { message: 'the kept return is the new plan\'s, not the abandoned one' }).toBe(growthReturn);

      // The member's inbox: the verification link, a full page load in the same browser.
      await page.goto('/verify-email?token=synthetic-4651-link');
      await page.getByRole('button', { name: /Continue/ }).first().click();
      await expect(page).toHaveURL(/\/pricing\?/, { timeout: 15_000 });
      const sheet = page.getByRole('dialog');
      await expect(sheet).toBeVisible();
      await expect(sheet).toContainText('Validate + Build');
      await expect(page.getByText('no longer offered', { exact: false })).toHaveCount(0);
      expect(new URL(page.url()).searchParams.get('checkout'), 'the address drops the ask so Back does not reopen it').toBeNull();
      expect(await kept(page), 'the return is spent once').toBeNull();
    });

    test('the Google return lands on the Pricing return and opens that plan once the session is read', async ({ page, request }) => {
      const manifest = await manifestOf(request);
      const state = { signedIn: false, catalogueDown: 0 };
      await wire(page, request, manifest, state);

      await page.goto('/pricing?for=founder');
      await page.getByRole('button', { name: 'Yearly' }).click();
      await page.locator('a[href*="plan=founder%3Agrowth"], a[href*="plan=founder:growth"]').first().click();
      await expect(page).toHaveURL(/\/register\?/);
      const back = returnOf(page.url());
      expect(back).toContain('interval=yearly');

      // What the Worker's Google callback answers for that redirect (auth_google.ts): the return, then `google=ok`.
      // The session cookie is read by a forced /me; it answers after the catalogue here, as it can in production.
      state.signedIn = true;
      state.meDelayMs = 1500;
      await page.goto(`${back}&google=ok&google_signup=1`);
      const sheet = page.getByRole('dialog');
      await expect(sheet).toBeVisible({ timeout: 15_000 });
      await expect(sheet).toContainText('Validate + Build');
      await expect(page.getByText('no longer offered', { exact: false })).toHaveCount(0);
      await expect(page.getByRole('group', { name: 'Billing' }).first().getByRole('button', { name: 'Yearly' })).toHaveAttribute('aria-pressed', 'true');
    });

    test('a catalogue that cannot be read on registration says so, and Try again reads it', async ({ page, request }) => {
      const manifest = await manifestOf(request);
      const state = { signedIn: false, catalogueDown: 0 };
      await wire(page, request, manifest, state);

      await page.goto('/pricing?for=founder');
      await page.getByRole('button', { name: 'Yearly' }).click();
      const href = await page.locator('a[href*="plan=founder%3Astudio"], a[href*="plan=founder:studio"]').first().getAttribute('href');
      state.catalogueDown = 1;
      await page.goto(href);
      await expect(page.getByTestId('register-plan')).toHaveAttribute('data-state', 'unreadable');
      await page.getByTestId('register-plan-retry').click();
      await expect(page.getByTestId('register-plan')).toHaveAttribute('data-state', 'ready');
      await expect(page.getByTestId('register-plan-price')).toContainText('$960 billed yearly');
    });
  });
}
