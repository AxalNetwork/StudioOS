import { test, expect } from '@playwright/test';
import { requirePreview } from './_helpers.js';

/**
 * D753 (#1992) — Connectors: the hub, its filter menu and one connector's page.
 *
 * Replaces the pre-D651 marketplace spec, whose testids (`integrations-page`,
 * `integration-provider-card`) no longer exist anywhere.
 *
 * Every `/api/*` call is stubbed, as the D722 spec does: the PR preview has no
 * API, and what is under test is the page. The signed-in founder is put in
 * storage the way a sign-in leaves it (`token`, `user`); `/api/auth/me` and
 * `/api/settings` answer for them; the catalogue is four providers in four
 * categories; every other route is the preview's own 404, which the pages
 * already read as "could not be read".
 *
 * The 390×844 check covers the routes the issue names. It asserts no
 * horizontal scroll. The 44px targets and the header button's full width are
 * asserted once the header action (#1908) and the side-sheet removal (#1992
 * step 1) land; the controls that miss 44px today are listed on #1992.
 *
 * Runs against the PR preview (`pr-preview.yml`, the `login-e2e` job); skips
 * locally when PLAYWRIGHT_BASE_URL is unset.
 */

const USER = { id: 9753, email: 'e2e.connectors@example.test', name: 'E2E Founder', role: 'founder', tier: 'growth' };

const provider = (key, display_name, category, auth_type, extra = {}) => ({
  key, display_name, category, auth_type, status: 'live', has_implementation: true, feeds: [],
  description: `${display_name}, as the E2E catalogue describes it.`, tagline: `${display_name} in StudioOS.`, ...extra,
});

const PROVIDERS = [
  provider('github', 'GitHub', 'Engineering', 'oauth2'),
  provider('hubspot', 'HubSpot', 'CRM', 'oauth2'),
  provider('stripe', 'Stripe', 'Finance', 'api_key'),
  provider('notion', 'Notion', 'Docs', 'oauth2', { status: 'coming_soon', has_implementation: false }),
];

const PAGE_BODY = {
  long_description: ['What this connector does, in the E2E catalogue.'],
  tools: [], prompts: [], prompts_reason: 'none', links: {}, endpoints: {},
  trust: { built_by: 'Axal VC', reads: [], writes: [], read_only: true, moves_money: false, sentence: 'Read-only.' },
};

const ANSWERS = {
  '/api/auth/me': USER,
  '/api/settings': {},
  '/api/connectors/available': { providers: PROVIDERS },
  '/api/connectors': { items: [] },
  '/api/connectors/waitlist': { items: [] },
  '/api/connectors/suggestions': { items: [] },
};

function answerFor(pathname) {
  const page = pathname.match(/^\/api\/connectors\/directory\/([^/]+)$/);
  if (page) {
    const p = PROVIDERS.find((x) => x.key === page[1]);
    return p ? { ok: true, connector: { ...p, ...PAGE_BODY } } : null;
  }
  return ANSWERS[pathname] || null;
}

async function signedInWithCatalogue(page) {
  await page.addInitScript((u) => {
    localStorage.setItem('token', 'e2e-connectors-token');
    localStorage.setItem('user', JSON.stringify(u));
  }, USER);
  await page.route('**/api/**', (route) => {
    const body = answerFor(new URL(route.request().url()).pathname);
    return body
      ? route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) })
      : route.fulfill({ status: 404, contentType: 'application/json', body: '{"error":"not_found"}' });
  });
}

// No sideways scroll, and nothing in <main> running past the right edge: a
// parent that clips its overflow hides the scroll but still cuts the content off.
async function hasNoHorizontalScroll(page) {
  const { scrollW, clientW, past } = await page.evaluate(() => {
    const clientW = document.documentElement.clientWidth;
    const past = [...document.querySelectorAll('main *')]
      .filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.right > clientW + 1; })
      .map((e) => e.getAttribute('data-testid') || e.tagName.toLowerCase())
      .slice(0, 5);
    return { scrollW: document.documentElement.scrollWidth, clientW, past };
  });
  expect(scrollW, `the page scrolls sideways: ${scrollW}px in a ${clientW}px viewport`).toBeLessThanOrEqual(clientW);
  expect(past, 'these run past the right edge').toEqual([]);
}

test.describe('Connectors: the hub, the filter menu and a connector\'s page (D753)', () => {
  test.beforeEach(async ({ page }) => {
    requirePreview(test);
    await signedInWithCatalogue(page);
  });

  test('the hub lists the catalogue on Discover, and search narrows it', async ({ page }) => {
    await page.goto('/account/connectors?tab=discover');
    await expect(page.getByTestId('tab-connectors-discover')).toHaveAttribute('aria-selected', 'true');
    for (const p of PROVIDERS) await expect(page.getByTestId(`connector-card-${p.key}`)).toBeVisible();
    await page.getByTestId('input-connectors-search').fill('stripe');
    await expect(page.getByTestId('connector-card-stripe')).toBeVisible();
    for (const k of ['github', 'hubspot', 'notion']) await expect(page.getByTestId(`connector-card-${k}`)).toHaveCount(0);
  });

  test('the filter menu narrows Discover to one category', async ({ page }) => {
    await page.goto('/account/connectors?tab=discover');
    await page.getByTestId('button-connectors-filter').click();
    const menu = page.getByTestId('connectors-filter-menu');
    await expect(menu).toBeVisible();
    await expect(menu).toHaveAttribute('role', 'menu');
    for (const c of ['CRM', 'Docs', 'Engineering', 'Finance']) await expect(page.getByTestId(`filter-where-category:${c}`)).toBeVisible();
    await page.getByTestId('filter-where-category:CRM').click();
    await expect(page.getByTestId('connector-card-hubspot')).toBeVisible();
    for (const k of ['github', 'stripe', 'notion']) await expect(page.getByTestId(`connector-card-${k}`)).toHaveCount(0);
  });

  test('a card opens the connector\'s own page, and its back link returns to the tab it came from', async ({ page }) => {
    await page.goto('/account/connectors?tab=discover');
    await page.getByTestId('connector-open-github').click();
    await expect(page).toHaveURL(/\/account\/connectors\/github$/);
    const view = page.getByTestId('connector-page');
    await expect(view).toHaveAttribute('data-key', 'github');
    await expect(page.getByTestId('connector-page-band')).toContainText('GitHub');
    await expect(page.getByTestId('connector-page-connect')).toBeVisible();
    await expect(page.getByTestId('connector-page-about')).toContainText('What this connector does');
    await page.getByTestId('connector-page-back').click();
    await expect(page).toHaveURL(/\/account\/connectors\?tab=discover$/);
  });

  test.describe('at 390×844', () => {
    test.use({ viewport: { width: 390, height: 844 } });

    test('the hub with its filter open does not scroll sideways', async ({ page }) => {
      await page.goto('/account/connectors');
      await page.getByTestId('button-connectors-filter').click();
      // On a phone the filter is a sheet, not the desktop menu.
      await expect(page.getByTestId('connectors-filter-sheet')).toBeVisible();
      await hasNoHorizontalScroll(page);
    });

    for (const key of ['github', 'mercury', 'hubspot']) {
      test(`/account/connectors/${key} does not scroll sideways`, async ({ page }) => {
        await page.goto(`/account/connectors/${key}`);
        await expect(page.getByTestId('connector-page')).toBeVisible();
        await hasNoHorizontalScroll(page);
      });
    }
  });
});
