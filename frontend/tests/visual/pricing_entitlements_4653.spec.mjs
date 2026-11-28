/** D4653: real Worker catalogue defaults reach Pricing and the selected-plan signup; prices are synthetic, and no payment or external request is made.
 *
 * From frontend/tests/visual/README.md (moved by #6472): D4653: actual public catalogue capacity
 * defaults in desktop/phone comparisons and FAQ, and the per-licence charging unit carried into
 * signup; synthetic prices and no payment.
 */
import { test, expect } from '@playwright/test';
import { CONSENT_VERSION } from '../../src/lib/cookieConsent.js';

// #7247: a handler here awaits `route.fetch()`; if the test ends while that request is in flight, the await throws
// "route.fetch: Test ended" and fails a passing test. Unrouting waits for running handlers and drops that error.
test.afterEach(async ({ page }) => {
  // A test that closed its own tab has no routes left to wait for.
  if (!page.isClosed()) await page.unrouteAll({ behavior: 'ignoreErrors' });
});

for (const width of [1440, 390]) {
  test(`Investor capacity and licence unit follow the catalogue at ${width}px`, async ({ page, request }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    const response = await request.get('/api/public/plans-and-packs');
    expect(response.ok()).toBeTruthy();
    const catalogue = (await response.json()).catalogue;
    const plus = catalogue.find(row => row.key === 'investor:plus').entitlements.investor_defaults;
    const institutional = catalogue.find(row => row.key === 'investor:institutional').entitlements.investor_defaults;
    await page.addInitScript(version => localStorage.setItem('axal_cookie_consent_v1', JSON.stringify({
      version, decided: true, updatedAt: '2026-10-20T00:00:00Z', categories: { essential: true },
    })), CONSENT_VERSION);
    await page.route(url => url.hostname !== '127.0.0.1', route => route.abort('blockedbyclient'));
    await page.route('**/api/auth/me', route => route.fulfill({ status: 401, json: { detail: 'Unauthorized' } }));
    await page.route('**/api/public/plans-and-packs', async route => {
      const read = await route.fetch();
      const body = await read.json();
      for (const plan of body.plans) {
        if (!['investor:plus', 'investor:professional'].includes(plan.licence_key)) continue;
        plan.prices = ['month', 'year'].map(interval => ({ price_id: `price_synthetic${plan.licence_key.replace(/[^a-z]/g, '')}${interval}`,
          unit_amount: interval === 'month' ? 3700 : 36000, currency: 'usd', interval, interval_count: 1, allowance_microusd: 0 }));
        plan.monthly = { unit_amount: 3700, currency: 'usd', allowance_microusd: 0 };
        plan.yearly = { unit_amount: 36000, currency: 'usd', allowance_microusd: 0 };
      }
      await route.fulfill({ response: read, json: body });
    });
    await page.goto('/pricing?for=investor');
    const table = page.getByRole('table', { name: width === 390 ? 'Investor Plus plan features' : 'Compare plans', exact: true });
    const row = label => table.getByRole('row').filter({ has: page.getByRole('rowheader', { name: label, exact: true }) });
    await expect(row('Active deal rooms (default)').getByRole('cell').nth(width === 390 ? 0 : 1)).toHaveText(String(plus.active_deal_rooms));
    await expect(row('Introduction requests per UTC quarter').getByRole('cell').nth(width === 390 ? 0 : 1)).toHaveText(String(plus.introduction_requests_per_quarter));
    if (width === 390) {
      await page.getByRole('tablist', { name: 'Plan', exact: true }).getByRole('tab', { name: 'Institutional', exact: true }).click();
      const custom = page.getByRole('table', { name: 'Institutional plan features', exact: true });
      await expect(custom.getByRole('row').filter({ has: page.getByRole('rowheader', { name: 'Active deal rooms (default)', exact: true }) }).getByRole('cell')).toHaveText('Agreed with Axal VC');
      await expect(custom.getByRole('row').filter({ has: page.getByRole('rowheader', { name: 'Colleague seats (default)', exact: true }) }).getByRole('cell')).toHaveText(String(institutional.colleague_seats));
    } else {
      await expect(row('Active deal rooms (default)').getByRole('cell').nth(3)).toHaveText('Agreed with Axal VC');
      await expect(row('Colleague seats (default)').getByRole('cell').nth(3)).toHaveText(String(institutional.colleague_seats));
    }
    for (const [name, policy] of [
      ['Who pays for a licence?', /No additional Institutional colleague seats are offered for purchase/],
      ['Does the plan include human services and other charges?', /require a separate agreed quote/],
      ['What support and onboarding are included?', /no guaranteed response-time SLA or onboarding bundle/],
      ['Which capabilities are available during alpha?', /planned or unverified capabilities are not guaranteed/],
    ]) {
      const disclosure = page.getByRole('button', { name, exact: true });
      await disclosure.click();
      await expect(page.locator('.axp-faq-item').filter({ has: disclosure })).toContainText(policy);
      await disclosure.click();
    }
    const question = page.getByRole('button', { name: 'What capacity differs between Investor plans?', exact: true });
    await question.click();
    await expect(question).toHaveAttribute('aria-expanded', 'true');
    await expect(page.locator('.axp-faq-item').filter({ has: question })).toContainText(`Investor Plus: ${plus.active_deal_rooms} active deal rooms`);
    await page.screenshot({ path: testInfo.outputPath('investor-capacity-disclosure.png') });
    await page.getByRole('group', { name: 'Billing', exact: true }).getByRole('button', { name: 'Yearly', exact: true }).click();
    await expect(page.getByTestId('pricing-card-plus').locator('.axp-price')).toContainText('per licence');
    await page.getByTestId('pricing-card-plus').getByRole('link').click();
    await expect(page).toHaveURL(/\/register\?/);
    await expect(page.getByTestId('register-plan-price')).toContainText('per licence');
    await expect(page.getByTestId('register-plan-price')).toContainText('billed yearly');
    await page.screenshot({ path: testInfo.outputPath('investor-licence-signup.png') });
  });
}
