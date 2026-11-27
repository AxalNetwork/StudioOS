/**
 * D6028 (#6028): Build Overview V2 (BD1, BD2) at a desk, a tablet and a phone,
 * in light and dark: one dominant action, no header Connect a tool, no page
 * wider than the screen, and a failed part retrying alone. The overview read
 * is answered here in D6027's shape; every name and count is made up.
 *
 *   npm run build   (repo root)
 *   cd frontend && npx --no-install playwright test -c tests/visual/playwright.config.mjs build_overview_6028.spec.mjs
 *
 * From frontend/tests/visual/README.md (moved by #6472): D6028 (#6028): Build Overview V2 at 1440,
 * 768 and 390 in light and dark: one primary, no header Connect a tool, no horizontal scroll, and
 * a failed part retrying alone.
 */
import { test, expect } from '@playwright/test';
import { prepare } from './_editor.mjs';
test.setTimeout(90_000);

function overview(id, mode) {
  const href = (slug) => `/build/${slug}?project=${id}`;
  const card = (slug, name, extra = {}) => ({ slug, name, state: 'empty', range: 'Now', caption: `${name}.`, series: [], next: null, reason: `No ${name} records yet.`, ...extra });
  const bad = mode === 'partial';
  return {
    cycle: 'build', question: 'Can this become a real company?',
    focus: { rule: 'set_mvp_date', eyebrow: 'Build · Next', headline: 'Set the MVP target date.', why: 'No MVP target date is recorded, so Build cannot count the days to it. 2 of 5 must-haves done.', cta: { label: 'Set target', href: `${href('prototype-mvp')}#mvp-target-date` }, then: null },
    meter: null,
    figures: [
      { key: 'must_haves_done', label: 'Must-haves done', value: [2, 5], unit: 'of', state: 'ok', module: 'prototype-mvp', spark: [] },
      { key: 'days_to_mvp', label: 'Days to the MVP date', value: null, unit: 'days', state: 'not_recorded', module: 'prototype-mvp', reason: 'No MVP target date has been recorded.', spark: [] },
      { key: 'roadmap_shipped', label: 'Roadmap shipped this month', value: 0, unit: 'items', state: 'ok', module: 'product-roadmap', spark: [] },
      bad ? { key: 'systems_connected', label: 'Systems connected', value: null, unit: 'of', state: 'unreadable', module: 'operating-systems', spark: [] }
        : { key: 'systems_connected', label: 'Systems connected', value: [2, 5], unit: 'of', state: 'ok', module: 'operating-systems', spark: [] },
    ],
    cards: [
      card('solution-design', 'Solution design'), card('prototype-mvp', 'Prototype / MVP'), card('product-roadmap', 'Product roadmap'),
      card('founding-team', 'Founding team'), card('company-creation', 'Company creation'),
      bad ? card('operating-systems', 'Operating systems', { state: 'unreadable', reason: 'Operating systems could not be read.' }) : card('operating-systems', 'Operating systems'),
    ],
    index: [],
    attention: {
      state: bad ? 'partial' : 'ready', unreadable: bad ? ['operating-systems'] : [],
      items: [
        { key: 'must_haves', tone: 'blocked', title: '2 must-haves need unblocking', detail: '2 blocked', module: 'prototype-mvp', href: href('prototype-mvp'), action: { label: 'Open must-haves', href: href('prototype-mvp') } },
        { key: 'mvp_date', tone: 'not_recorded', title: 'MVP target date not recorded', detail: 'The overview counts days to the MVP from this date.', module: 'prototype-mvp', href: href('prototype-mvp'), action: { label: 'Set target', href: `${href('prototype-mvp')}#mvp-target-date` } },
        ...(bad ? [{ key: 'operating-systems_unreadable', tone: 'unreadable', title: 'Operating systems could not be read', detail: 'This does not mean nothing needs attention there.', module: 'operating-systems', href: href('operating-systems'), action: null }] : []),
      ],
    },
    plan: { state: 'ready', status: 'open', accepted: 4, waiting: 2, href: `/build/plan?project=${id}`, items: [
      { uid: 'a', title: 'Guided import for existing accounts', kind: 'feature', module: 'prototype-mvp', module_label: 'Prototype / MVP' },
      { uid: 'b', title: 'Test: assisted setup against self-serve', kind: 'test', module: 'solution-design', module_label: 'Solution design' },
    ] },
  };
}

async function open(page, request, width, theme, mode = 'ready') {
  const m = await prepare(page, request);
  await page.setViewportSize({ width, height: 900 });
  if (theme === 'dark') await page.route('**/api/settings/appearance', (route) => (route.request().method() === 'GET' ? route.fulfill({ json: { theme: 'dark' } }) : route.continue()));
  await page.route('**/api/cycles/build/overview*', (route) => route.fulfill({ json: overview(m.oneClick.projectId, mode) }));
  await page.goto(`/build?project_id=${m.oneClick.projectId}`);
  // D4846 part 2 (#6032): Build draws its desktop overview from 768px (its
  // tablet tier, ui/phone/tabletTier.js); the phone page is below 768px only.
  await expect(page.getByTestId(width < 768 ? 'phone-root' : 'build-overview-v2')).toBeVisible();
  if (theme === 'dark') await expect(page.locator('html')).toHaveClass(/dark/);
  return m;
}

for (const width of [1440, 768, 390]) {
  for (const theme of ['light', 'dark']) {
    test(`Build overview at ${width}px in ${theme}: one primary, no header Connect a tool, no horizontal scroll`, async ({ page, request }, testInfo) => {
      await open(page, request, width, theme);
      await expect(page.getByTestId('cycle-action')).toHaveCount(0);
      await expect(page.getByText('Connect a tool')).toHaveCount(0);
      if (width < 768) {
        await expect(page.getByTestId('phone-focus-cta')).toHaveText('Set target');
        await expect(page.getByTestId('build-attention-must_haves')).toBeVisible();
        await expect(page.getByTestId('phone-index-build-plan')).toContainText('4 accepted · 2 waiting for decision');
      } else {
        await expect(page.getByTestId('build-next-cta')).toHaveText('Set target →');
        await expect(page.getByTestId('build-status-days_to_mvp')).toContainText('Not recorded');
        await expect(page.getByTestId('build-plan-line')).toHaveText('4 accepted · 2 waiting for decision');
        await expect(page.getByTestId('build-modules').locator('article')).toHaveCount(6);
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await page.screenshot({ path: testInfo.outputPath(`build-overview-${width}-${theme}.png`), fullPage: true });
    });
  }
}

test('a failed part says so alone and retries on its own at 1440px', async ({ page, request }, testInfo) => {
  await open(page, request, 1440, 'light', 'partial');
  await expect(page.getByTestId('build-attention-retry-operating-systems_unreadable')).toBeVisible();
  await expect(page.getByTestId('build-attention-must_haves')).toBeVisible();
  const module = page.getByTestId('build-module-operating-systems');
  await expect(module).toHaveAttribute('data-state', 'unreadable');
  await expect(page.getByTestId('build-module-prototype-mvp')).toHaveAttribute('data-state', 'empty');
  const retried = page.waitForRequest((r) => r.url().includes('/api/cycles/build/modules/operating-systems'));
  await module.getByRole('button', { name: 'Try again' }).click();
  await retried;
  await page.screenshot({ path: testInfo.outputPath('build-overview-partial-1440.png'), fullPage: true });
});
