/**
 * D7166 part 2 (#7166, canvas D7031 boards RFD-02, RFD-03, RFD-04B): the Funds
 * directory at a desk and a phone, light and dark. At 390 Sort and Filters sit
 * in a bar in thumb reach and Filters opens a full-height sheet that closes
 * back to its button; "Show them" asks for the funds the size filter left out;
 * arriving at a remembered Directory link says "Signed in. This is the search
 * you opened." and focuses the results heading; no page is wider than the
 * screen. Every /api/research/fund-directory read is answered here; every name
 * and figure is made up.
 *
 *   npm run build   (repo root)
 *   cd frontend && npx --no-install playwright test -c tests/visual/playwright.config.mjs research_funds_directory_7166.spec.mjs
 */
import { test, expect } from '@playwright/test';
import { prepare } from './_editor.mjs';
test.setTimeout(90_000);

const M = 100_000_000;
const EUR = 'EuroTech VC Funds (public spreadsheet)';
const row = (uid, name, fund_number, cents, currency) => ({
  uid, name, fund_number, fund_size_cents: cents, size_currency: currency, size_reason: cents == null ? 'Not recorded' : null,
  fund_year: 2023, hq: 'Sample City', sector_focus: 'Sample focus', notable_lps: null, eif: null, eifo: null,
  source_name: EUR, source_url: 'https://list.example/', as_of: '2026-11-18', website: null, linkedin: null,
});
const SIZED = [row('sample-a-ii', 'Sample Manager A', 'II', 120 * M, 'EUR'), row('sample-b-i', 'Sample Manager B', 'I', 64 * M, 'EUR')];
const UNSIZED = [row('sample-c-i', 'Sample Manager C', 'I', null, null)];
const answer = (items, url) => ({
  items, total: items.length, limit: 25, offset: 0, sort: url.searchParams.get('sort') || 'name', size_currency: 'EUR',
  coverage: { total: 40, as_of: '2026-11-18', fields: { size_eur: 30, size_usd: 0, hq: 40, website: 10, sector_focus: 20, fund_year: 30, notable_lps: 5 } },
  sources: [{ name: EUR, title: 'Sample list', rows: 40, size_currency: 'EUR', as_of: '2026-11-18' }],
  facets: { hq_country: [{ value: 'GB', label: 'United Kingdom', count: 3 }], focus: [], vintage: [{ value: '2023', label: '2023', count: 3 }],
    size_band: [{ value: '50-100', label: '€50–100M', count: 1 }, { value: '100-250', label: '€100–250M', count: 1 }],
    size_not_comparable: UNSIZED.length, eif: { backed: 0, not_backed: 0, unknown: 3 }, eifo: { backed: 0, not_backed: 0, unknown: 3 } },
});

async function open(page, request, width, theme, path, { remember = false } = {}) {
  await prepare(page, request);
  await page.setViewportSize({ width, height: 844 });
  if (theme === 'dark') await page.route('**/api/settings/appearance', (route) => (route.request().method() === 'GET' ? route.fulfill({ json: { theme: 'dark' } }) : route.continue()));
  if (remember) {
    await page.addInitScript((p) => { try { localStorage.setItem('gvpn:funds-return', JSON.stringify({ path: p, ts: Date.now() })); } catch { /* ignore */ } }, path);
  }
  const asked = [];
  await page.route(/\/api\/research\/fund-directory(\?|$)/, (route) => {
    const url = new URL(route.request().url());
    asked.push(url.search);
    return route.fulfill({ json: answer(url.searchParams.get('size_band') === 'none' ? UNSIZED : SIZED, url) });
  });
  await page.goto(path);
  await expect(page.getByTestId('fund-directory')).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('#fd-results')).toBeVisible();
  if (theme === 'dark') await expect(page.locator('html')).toHaveClass(/dark/);
  return asked;
}

const noSideScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
const LINK = '/research/funds?view=directory&hq_country=GB&size_min=50&sort=-size';

for (const width of [1440, 390]) {
  for (const theme of ['light', 'dark']) {
    test(`funds directory at ${width}px in ${theme}: the signed-in line, Show them, and the phone's filter sheet`, async ({ page, request }, testInfo) => {
      const asked = await open(page, request, width, theme, LINK, { remember: true });
      const restored = page.getByTestId('fund-directory-restored');
      await expect(restored).toContainText('Signed in. This is the search you opened.');
      await expect(restored).toContainText('2 filters · Size, largest first · page 1 of 1');
      await expect(page.locator('#fd-results')).toBeFocused();
      expect(await noSideScroll(page)).toBe(true);
      await page.screenshot({ path: testInfo.outputPath(`directory-${width}-${theme}.png`), fullPage: true });

      const phone = width < 640;
      await expect(page.getByTestId('fund-directory-phone-bar')).toBeVisible({ visible: phone });
      await expect(page.locator('#fd-sort')).toBeVisible({ visible: !phone });
      if (phone) {
        const filters = page.getByRole('button', { name: 'Filters · 2' });
        await filters.click();
        const sheet = page.getByRole('dialog', { name: 'Filters' });
        await expect(sheet).toBeVisible();
        const box = await sheet.boundingBox();
        expect(box.height).toBeGreaterThanOrEqual(800);
        await expect(sheet.getByRole('button', { name: 'Show 2 fund vehicles' })).toBeVisible();
        await expect(sheet.getByRole('radiogroup', { name: 'Size currency' })).toBeVisible();
        expect(await noSideScroll(page)).toBe(true);
        await page.screenshot({ path: testInfo.outputPath(`filter-sheet-${width}-${theme}.png`) });
        await sheet.getByRole('button', { name: 'Show 2 fund vehicles' }).click();
        await expect(sheet).toHaveCount(0);
        await expect(filters).toBeFocused();
        await page.getByRole('button', { name: /^Sort · Size ↓/ }).click();
        await expect(page.getByRole('dialog', { name: 'Sort' })).toBeVisible();
        await page.screenshot({ path: testInfo.outputPath(`sort-sheet-${width}-${theme}.png`) });
        await page.keyboard.press('Escape');
      }

      // "Show them": the size filter's other side, every other filter kept.
      await page.getByRole('button', { name: /^Show them: the 1 fund with no size in euros/ }).click();
      await expect(page.locator('#fd-results')).toHaveText('1 fund vehicle matches');
      expect(asked.at(-1)).toContain('size_band=none');
      expect(asked.at(-1)).toContain('hq_country=GB');
      await expect(page.getByRole('button', { name: 'Remove filter Size: not recorded in EUR' })).toBeVisible();
      await expect(page.locator('#fd-results')).toBeFocused();
      await page.screenshot({ path: testInfo.outputPath(`show-them-${width}-${theme}.png`), fullPage: true });
    });
  }
}
