/**
 * #8717 — browser Back from an annual signup must not return Pricing to Monthly. In Chromium on the built SPA and the
 * real Worker (this folder's `server.ts`), at 1440 and 390 px, for every audience with a paid card (Founder, Investor,
 * Advisor, Operating Partner):
 *
 *   · Yearly → the card's signup → browser Back: the audience and Yearly are restored, with the same figure, annual
 *     total and signup destination; Forward returns to the same yearly quote;
 *   · a deliberate Monthly then persists through signup and Back; the billing switch adds no history entry;
 *   · a yearly deep link and its reload open on Yearly, and a new visit with no interval on Monthly.
 *
 * The public catalogue has no Stripe prices locally, so the paid plans get synthetic ones (distinct per plan). Every
 * expected figure is computed from that priced catalogue as the page receives it, never typed in. No payment and no
 * request off 127.0.0.1. Screenshots go to the test's output folder only: no baselines.
 */
import { test, expect } from '@playwright/test';
import { CONSENT_VERSION } from '../../src/lib/cookieConsent.js';

// #7247: unrouting waits for running handlers and drops the error of one the test's end cut off.
test.afterEach(async ({ page }) => {
  if (!page.isClosed()) await page.unrouteAll({ behavior: 'ignoreErrors' });
});

/** The paid cards per audience: the card's id on the page, the catalogue row's `licence_key`, the plan key it carries. */
const PAID = {
  founder: [['growth', 'founder:growth', 'founder:growth'], ['studio', 'founder:studio', 'founder:studio']],
  investor: [['plus', 'investor:plus', 'investor:plus'], ['professional', 'investor:professional', 'investor:professional']],
  advisor: [['pro', 'advisor', 'advisor:pro']],
  'operating-partner': [['pro', 'partner', 'partner:pro']],
};
const TAB_NAMES = { founder: 'Founder', investor: 'Investor', advisor: 'Advisors', 'operating-partner': 'Operating Partners' };

/** As Pricing writes an amount (`pricingModel.usd`): whole dollars for a whole amount, else two decimals. */
const usd = (cents) => {
  const whole = cents % 100 === 0;
  return `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: whole ? 0 : 2 })}`;
};
const price = (unit_amount, interval) => ({ price_id: `price_syn_${unit_amount}_${interval}`, unit_amount, currency: 'usd', interval, interval_count: 1, allowance_microusd: 1_000_000 });

/** The real catalogue with a synthetic monthly and yearly price on every paid plan above, distinct per plan. */
function priced(body) {
  const licences = Object.values(PAID).flat().map(([, licence]) => licence);
  licences.forEach((licence, i) => {
    const plan = (body.plans || []).find((p) => p && p.licence_key === licence && !p.free);
    expect(plan, `the visual Worker's catalogue has ${licence}`).toBeTruthy();
    const month = 1900 + i * 1000;
    const year = month * 10 + i * 100;
    plan.prices = [price(month, 'month'), price(year, 'year')];
    plan.monthly = { unit_amount: month, currency: 'usd', allowance_microusd: 1_000_000 };
    plan.yearly = { unit_amount: year, currency: 'usd', allowance_microusd: 1_000_000 };
  });
  return body;
}

async function wire(page, request) {
  const response = await request.get('/api/public/plans-and-packs');
  expect(response.ok(), 'the visual Worker serves the public catalogue').toBeTruthy();
  const catalogue = priced(await response.json());
  await page.addInitScript((consentVersion) => {
    try {
      localStorage.setItem('axal_cookie_consent_v1', JSON.stringify({ version: consentVersion, decided: true, updatedAt: '2026-10-20T00:00:00Z', categories: { essential: true } }));
    } catch { /* storage off: the journey fails loudly on its first check */ }
  }, CONSENT_VERSION);
  await page.route((url) => url.hostname !== '127.0.0.1', (route) => route.abort('blockedbyclient'));
  await page.route('**/api/public/plans-and-packs', (route) => route.fulfill({ json: catalogue }));
  await page.route('**/api/auth/me', (route) => route.fulfill({ status: 401, contentType: 'application/json', body: '{"detail":"Unauthorized"}' }));
  return catalogue;
}

/** What the catalogue says a card shows and where its signup goes, for one interval. */
function quoteOf(catalogue, licence, interval) {
  const plan = catalogue.plans.find((p) => p.licence_key === licence && !p.free);
  const amount = interval === 'yearly' ? plan.yearly.unit_amount : plan.monthly.unit_amount;
  return interval === 'yearly'
    ? { amount, price: usd(Math.round(amount / 12)), note: `${usd(amount)} billed yearly` }
    : { amount, price: usd(amount), note: '' };
}

/** Each paid card of the audience shows the catalogue's figure and total, and links to signup with that plan and interval. */
async function expectCards(page, tab, catalogue, interval) {
  for (const [id, licence, planKey] of PAID[tab]) {
    const q = quoteOf(catalogue, licence, interval);
    const card = page.getByTestId(`pricing-card-${id}`);
    await expect(card.getByTestId(`pricing-price-${id}`)).toHaveText(q.price);
    await expect(card.locator('.axp-price-note')).toHaveText(q.note);
    const to = new URL(await card.getByRole('link').getAttribute('href'), 'http://x.test');
    expect(to.pathname).toBe('/register');
    expect([to.searchParams.get('plan'), to.searchParams.get('interval')]).toEqual([planKey, interval]);
    // The Pricing return the signup keeps: this audience, this plan, this interval and the amount the card showed.
    const next = new URL(to.searchParams.get('next'), 'http://x.test');
    expect([next.pathname, next.searchParams.get('for'), next.searchParams.get('checkout'), next.searchParams.get('interval'), next.searchParams.get('seen')])
      .toEqual(['/pricing', tab, planKey, interval, String(q.amount)]);
  }
}

async function expectBilling(page, tab, interval) {
  const url = new URL(page.url());
  expect(url.pathname).toBe('/pricing');
  expect(url.searchParams.get('for')).toBe(tab);
  await expect(page.getByRole('tab', { name: TAB_NAMES[tab], exact: true })).toHaveAttribute('aria-selected', 'true');
  const billing = page.getByRole('group', { name: 'Billing', exact: true });
  await expect(billing.getByRole('button', { name: interval === 'yearly' ? 'Yearly' : 'Monthly', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(billing.getByRole('button', { name: interval === 'yearly' ? 'Monthly' : 'Yearly', exact: true })).toHaveAttribute('aria-pressed', 'false');
}

for (const [width, height, label] of [[1440, 900, 'desktop'], [390, 844, 'phone']]) {
  test.describe(`${label} (${width}px)`, () => {
    test.use({ viewport: { width, height } });

    for (const tab of Object.keys(PAID)) {
      test(`${TAB_NAMES[tab]}: Back from a yearly signup restores Yearly, Forward returns to it, and a deliberate Monthly persists`, async ({ page, request }, testInfo) => {
        const catalogue = await wire(page, request);
        const [firstId, firstLicence] = PAID[tab][0];
        const billing = page.getByRole('group', { name: 'Billing', exact: true });

        // A new visit: the documented default, Monthly, with no interval in the address.
        await page.goto(`/pricing?for=${tab}`);
        await expectBilling(page, tab, 'monthly');
        await expectCards(page, tab, catalogue, 'monthly');

        await billing.getByRole('button', { name: 'Yearly', exact: true }).click();
        await expect(page).toHaveURL(/[?&]interval=yearly(&|$)/);
        await expectBilling(page, tab, 'yearly');
        await expectCards(page, tab, catalogue, 'yearly');

        const yearly = quoteOf(catalogue, firstLicence, 'yearly');
        await page.getByTestId(`pricing-card-${firstId}`).getByRole('link').click();
        await expect(page).toHaveURL(/\/register\?/);
        const signup = page.url();
        expect(new URL(signup).searchParams.get('interval')).toBe('yearly');
        await expect(page.getByTestId('register-plan-price')).toContainText(yearly.note);
        await page.screenshot({ path: testInfo.outputPath(`${tab}-signup-yearly.png`), fullPage: true });

        // Browser Back: the audience and the interval that produced the quote.
        await page.goBack();
        await expectBilling(page, tab, 'yearly');
        await expectCards(page, tab, catalogue, 'yearly');
        await page.screenshot({ path: testInfo.outputPath(`${tab}-pricing-after-back.png`), fullPage: true });

        // Forward: the same plan and cadence.
        await page.goForward();
        await expect(page).toHaveURL(signup);
        await expect(page.getByTestId('register-plan-price')).toContainText(yearly.note);

        // Back again, then a deliberate Monthly, which persists through the same journey.
        await page.goBack();
        await expectBilling(page, tab, 'yearly');
        await billing.getByRole('button', { name: 'Monthly', exact: true }).click();
        await expectBilling(page, tab, 'monthly');
        await expect(page).toHaveURL(/[?&]interval=monthly(&|$)/);
        await expectCards(page, tab, catalogue, 'monthly');
        await page.getByTestId(`pricing-card-${firstId}`).getByRole('link').click();
        await expect(page).toHaveURL(/\/register\?/);
        expect(new URL(page.url()).searchParams.get('interval')).toBe('monthly');
        await expect(page.getByTestId('register-plan-price')).toContainText('billed every month');
        await page.goBack();
        await expectBilling(page, tab, 'monthly');
        await expectCards(page, tab, catalogue, 'monthly');

        // Three presses of the switch replaced the Pricing entry: one more Back leaves Pricing.
        await page.goBack();
        await expect(page).not.toHaveURL(/\/pricing/);
      });
    }

    test('a yearly deep link and its reload open on Yearly; a new visit with no interval opens on Monthly', async ({ page, request }) => {
      const catalogue = await wire(page, request);
      await page.goto('/pricing?for=advisor&interval=yearly');
      await expectBilling(page, 'advisor', 'yearly');
      await expectCards(page, 'advisor', catalogue, 'yearly');
      await page.reload();
      await expectBilling(page, 'advisor', 'yearly');
      await expectCards(page, 'advisor', catalogue, 'yearly');
      await page.goto('/pricing?for=operating-partner&interval=monthly');
      await expectBilling(page, 'operating-partner', 'monthly');
      await page.goto('/pricing?for=advisor');
      await expectBilling(page, 'advisor', 'monthly');
      expect(new URL(page.url()).searchParams.get('interval'), 'opening the page writes no interval').toBeNull();
      await expectCards(page, 'advisor', catalogue, 'monthly');
    });
  });
}
