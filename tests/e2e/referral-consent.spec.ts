import { expect, test, type Page } from '@playwright/test';

const live = '/@fixture_handle/yt';
const refCookie = 'axal_ref';
const visitorKey = 'axal_vid';

async function mockReferralApi(page: Page) {
  const measurements: string[] = [];
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === '/api/track') measurements.push('funnel');
    if (path.startsWith('/api/public/handle/')) {
      if (request.headers()['x-axal-visitor']) measurements.push('handle');
      return path.endsWith('/fixture_handle/yt')
        ? route.fulfill({ json: { state: 'live', name: 'Fixture Handle', ref: 'h:fixture_handle:yt' } })
        : route.fulfill({ status: 404, json: { state: 'unknown' } });
    }
    return route.fulfill({ json: {} });
  });
  return measurements;
}

async function expectNoReferralIdentifiers(page: Page) {
  expect((await page.context().cookies()).some((c) => c.name === refCookie)).toBe(false);
  expect(await page.evaluate((key) => [localStorage.getItem(key), sessionStorage.getItem(key)], visitorKey))
    .toEqual([null, null]);
}

test('referral pages and signup work before consent and after rejection', async ({ page }) => {
  const measurements = await mockReferralApi(page);
  // This flow uses a synthetic verification token and a mocked signup API.
  await page.addInitScript(() => {
    Object.defineProperty(window, 'turnstile', {
      value: {
        render(_element: HTMLElement, options: { callback: (token: string) => void }) {
          queueMicrotask(() => options.callback('synthetic-test-token'));
          return 'synthetic-widget';
        },
        remove() {},
      },
    });
  });
  await page.goto('/register?ref=FIXTURECODE');
  await expect(page.getByRole('button', { name: 'Reject all' })).toBeVisible();
  await expectNoReferralIdentifiers(page);
  await page.goto('/@fixture_unknown');
  await expect(page.getByTestId('handle-unknown')).toBeVisible();
  await expectNoReferralIdentifiers(page);
  await page.goto(live);
  await expect(page.getByTestId('handle-live')).toBeVisible();
  await expectNoReferralIdentifiers(page);
  await page.getByRole('button', { name: 'Reject all' }).click();
  await page.reload();
  await expect(page.getByTestId('handle-live')).toBeVisible();
  await expectNoReferralIdentifiers(page);
  await page.goto('/@fixture_unknown');
  await expect(page.getByTestId('handle-unknown')).toBeVisible();
  await expectNoReferralIdentifiers(page);
  await page.goto('/register?ref=FIXTURECODE');
  await expect(page.getByText('Joining via referral code')).toHaveCount(0);
  await page.getByLabel('Full Name').fill('Synthetic Visitor');
  await page.getByLabel('Email', { exact: true }).fill('visitor@example.test');
  const signup = page.waitForRequest((request) => new URL(request.url()).pathname === '/api/auth/register');
  await page.locator('form button[type=submit]').click();
  expect((await signup).postDataJSON()).not.toHaveProperty('ref_code');
  await expectNoReferralIdentifiers(page);
  expect(measurements).toEqual([]);
});

test('opt-in keeps the first referral through refresh and clears it on withdrawal', async ({ page }) => {
  const measurements = await mockReferralApi(page);
  const start = Date.now() / 1000;
  await page.goto(live);
  await expect(page.getByTestId('handle-live')).toBeVisible();
  await page.getByRole('button', { name: 'Accept all' }).click();
  await expect.poll(() => measurements.filter((kind) => kind === 'handle').length).toBe(1);
  const first = (await page.context().cookies()).find((c) => c.name === refCookie);
  expect(first?.value).toBe('h%3Afixture_handle%3Ayt');
  expect(first?.expires).toBeGreaterThan(start + 90 * 86400 - 2);
  expect(first?.expires).toBeLessThan(Date.now() / 1000 + 90 * 86400 + 2);
  const id = await page.evaluate((key) => sessionStorage.getItem(key), visitorKey);
  expect(id).toBeTruthy();
  await page.reload();
  await expect.poll(() => measurements.filter((kind) => kind === 'handle').length).toBe(2);
  expect(await page.evaluate((key) => sessionStorage.getItem(key), visitorKey)).toBe(id);
  await page.goto('/register?ref=FIXTURECODE');
  await expect(page.getByText('h:fixture_handle:yt', { exact: true })).toBeVisible();
  expect((await page.context().cookies()).find((c) => c.name === refCookie)?.expires).toBe(first?.expires);

  await page.goto(live);
  await expect.poll(() => measurements.filter((kind) => kind === 'handle').length).toBe(3);
  await page.getByRole('button', { name: 'Cookie preferences', exact: true }).first().click();
  await page.locator('[data-category="analytics"]').getByRole('switch').click();
  await page.locator('[data-category="advertising"]').getByRole('switch').click();
  await page.getByRole('button', { name: 'Save preferences' }).click();
  await expectNoReferralIdentifiers(page);
  await page.reload();
  await expect(page.getByTestId('handle-live')).toBeVisible();
  await expectNoReferralIdentifiers(page);
  expect(measurements.filter((kind) => kind === 'handle')).toHaveLength(3);
  await page.getByTestId('handle-join').click();
  await expect(page.getByText('Joining via referral code')).toHaveCount(0);
});

test('old preferences are re-prompted and a code expires after 30 days', async ({ page, baseURL }) => {
  const measurements = await mockReferralApi(page);
  await page.context().addCookies([{ name: refCookie, value: 'OLDCODE', url: baseURL! }]);
  await page.addInitScript(() => {
    if (localStorage.getItem('axal_cookie_consent_v1')) return;
    localStorage.setItem('axal_cookie_consent_v1', JSON.stringify({
      version: 1, decided: true, categories: { essential: true, analytics: true },
    }));
    localStorage.setItem('axal_vid', 'oldfixture');
    sessionStorage.setItem('essential-fixture', 'kept');
  });
  const start = Date.now() / 1000;
  await page.goto('/register?ref=FIXTURECODE');
  await expect(page.getByRole('button', { name: 'More choices' })).toBeVisible();
  await expectNoReferralIdentifiers(page);
  await page.getByRole('button', { name: 'More choices' }).click();
  await page.locator('[data-category="advertising"]').getByRole('switch').click();
  await page.getByRole('button', { name: 'Save preferences' }).click();
  const code = (await page.context().cookies()).find((c) => c.name === refCookie);
  expect(code?.value).toBe('FIXTURECODE');
  expect(code?.expires).toBeGreaterThan(start + 30 * 86400 - 2);
  expect(code?.expires).toBeLessThan(Date.now() / 1000 + 30 * 86400 + 2);
  await page.goto(live);
  await expect(page.getByTestId('handle-live')).toBeVisible();
  expect(await page.evaluate(() => sessionStorage.getItem('essential-fixture'))).toBe('kept');
  expect(await page.evaluate((key) => sessionStorage.getItem(key), visitorKey)).toBeNull();
  expect(measurements).toEqual([]);
});
