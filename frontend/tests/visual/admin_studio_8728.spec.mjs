/**
 * D8728 (#8728, part 3) — Admin Studio in a real browser, at a desk (1440 × 900)
 * and on a phone (390 × 844), as the canvas draws it (SAD01, SAD01P, SAD03,
 * SAD03P, SAD04, SAD04P, SAD10, SAD10P, SAD11, SAD14).
 *
 * The acceptance fixture: a branch admin of a made-up territory whose inbox
 * holds one overdue Spin-Out Lab application and two on time, with 0 of 11
 * admin-bank answers recorded; then the same territory with nothing waiting,
 * and with the queue unreadable. What it holds:
 *   · "Needs a decision" and its one action are in the first screen, ahead of
 *     Setup, at both widths (the walkthrough measured 1,293 px and 1,866 px);
 *   · the action opens /admin/approvals?age=past with the Studio crumb ("‹
 *     Studio" on a phone), the Age chip and the result count, and on a branch
 *     the sidebar's Approvals row is lit there (⚑2 A);
 *   · browser Back returns to Studio with focus on the action that left;
 *   · all clear and unavailable are never drawn as each other or as 0;
 *   · no page is wider than the phone, in light or dark.
 *
 * Every read is answered here; the page is the built SPA that `server.ts`
 * serves. Every name and figure is made up. No baseline is drawn.
 */
import { test, expect } from '@playwright/test';
import { prepare } from './_editor.mjs';

test.setTimeout(120_000);

const DESK = { width: 1440, height: 900 };
const PHONE = { width: 390, height: 844 };
const TERR = '[Lisbon Studio]';
const USER = {
  id: 7, role: 'admin', is_super_admin: 0, name: 'Admin A', email: 'a@example.test', email_verified: true, is_active: true,
  branch: { code: 'pt', name: TERR, territories: ['[Portugal]', '[Galicia]'], status: 'active' },
};

const LANES = [
  { key: 'cohort', label: 'Spin-Out Lab applications', group: 'programs', count: 1, bands: { ok: 0, due_soon: 0, past: 1, unknown: 0 } },
  { key: 'kyc', label: 'KYC', group: 'people', count: 1, bands: { ok: 0, due_soon: 1, past: 0, unknown: 0 } },
  { key: 'events', label: 'Events', group: 'community', count: 1, bands: { ok: 1, due_soon: 0, past: 0, unknown: 0 } },
];
const OVERDUE = { lane: 'cohort', lane_label: 'Spin-Out Lab applications', id: 219, who: '[Rui Matos]', what: 'Spin-Out Lab application', created_at: '2026-11-22 06:10:00', age_hours: 98, sla: 'past', assignee: null };
const PAST = { items: [OVERDUE], total: 1, unfiltered_total: 3, page: 1, page_size: 25, lanes: LANES, unreadable: [], tiles: { over_72h: 1, unassigned: 2 }, reviewers: [{ id: 7, name: 'Admin A' }] };
const ALL = {
  ...PAST,
  items: [OVERDUE,
    { lane: 'kyc', lane_label: 'KYC', id: 4, who: '[Inês Duarte]', what: 'KYC · founder', age_hours: 30, sla: 'due_soon', assignee: { user_id: 7, name: 'Admin A' } },
    { lane: 'events', lane_label: 'Events', id: 9, who: '[Marta Silva]', what: 'Event', age_hours: 5, sla: 'ok', assignee: null }],
  total: 3,
  unfiltered_total: undefined,
};
const EMPTY = { ...PAST, items: [], total: 0, unfiltered_total: 0, tiles: { over_72h: 0, unassigned: 0 }, lanes: LANES.map((l) => ({ ...l, count: 0, bands: { ok: 0, due_soon: 0, past: 0, unknown: 0 } })) };
const GLANCE = (open) => ({
  tier: 'branch',
  seats: { recorded: true, seats_used_by_type: { founder: 18, investor: 0, advisor: 0, partner: 0 }, seats: { founder: 25, investor: 1, advisor: 1, partner: 1 } },
  approvals: { recorded: true, lanes: open ? [{ key: 'cohort', label: 'Spin-Out Lab applications', count: 1, oldest_age_hours: 98, sla: 'past' }] : [] },
  programme: { recorded: true, open_week: 4, zone: 'Europe/Lisbon', week_closes_at: '2026-11-30T18:00:00.000Z', hours_to_close: 90 },
  agreements: { recorded: true, expiring: 0, window_days: 60, undated: { reason: 'Not dated.' } },
  revenue: { recorded: true, share_bps: 2000 },
  licence: { recorded: true, revenue_share_bps: 2000, status: 'active', kind: 'subsidiary', domain_available: false, domain_reason: 'hq' },
  templates: { recorded: true, available: true, items: [{ slug: 'a' }], pushed_at: null },
  insights: { recorded: true, benchmarks_available: true, benchmarks: [] },
});
const POSTURE = {
  available: true, bank_size: 11, recorded: 0,
  fields: Array.from({ length: 11 }, (_, i) => ({ id: `admin.q${i}`, section: ['OVERSIGHT', 'OPERATIONS', 'GOVERNANCE', 'PREFS'][i % 4], label: `Question ${i + 1}`, state: 'not_recorded', value: null })),
};

/** Signs in as the branch admin and answers every read; `queue` is 'one' | 'empty' | 'down'. */
async function open(page, request, { viewport = DESK, queue = 'one', theme = 'light', path = '/studio' } = {}) {
  await page.setViewportSize(viewport);
  await prepare(page, request);
  await page.addInitScript((u) => { try { localStorage.setItem('user', JSON.stringify(u)); } catch { /* storage off */ } }, USER);
  await page.route((u) => u.hostname === '127.0.0.1' && u.pathname.startsWith('/api/'), async (route) => {
    const x = new URL(route.request().url());
    const p = x.pathname;
    const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (p === '/api/auth/me') return json(USER);
    if (p === '/api/settings/appearance') return json({ theme });
    // The first-login tour has been seen, so it does not make the page inert.
    if (p === '/api/onboarding/checklist') return json({ meta: { tour_seen_at: '2026-11-01 09:00:00' } });
    if (p === '/api/admin/studio/glance') return json(GLANCE(queue === 'one'));
    if (p === '/api/advisor/admin-posture') return json(POSTURE);
    if (p === '/api/admin/approvals') {
      if (queue === 'down') return json({ detail: 'down' }, 503);
      if (queue === 'empty') return json(EMPTY);
      return json(x.searchParams.get('age') === 'past' ? PAST : ALL);
    }
    return json({});
  });
  await page.goto(path);
  if (theme === 'dark') await expect(page.locator('html')).toHaveClass(/dark/);
  await expect(page.getByTestId('admin-studio-home')).toBeVisible();
  await page.waitForLoadState('networkidle');
  await expect(page.getByTestId('product-tour')).toHaveCount(0);
}

/** Where an element sits in the page, read in the page (a box Playwright would wait on scrolling for). */
const top = (locator) => locator.evaluate((el) => el.getBoundingClientRect().top + window.scrollY);
const bottom = (locator) => locator.evaluate((el) => el.getBoundingClientRect().bottom + window.scrollY);
const wide = (page) => page.evaluate(() => document.documentElement.scrollWidth);

for (const [name, viewport] of [['desk', DESK], ['phone', PHONE]]) {
  test.describe(`at ${name} width`, () => {
    test('the overdue decision and its one action are in the first screen, ahead of Setup', async ({ page, request }) => {
      await open(page, request, { viewport });
      const heading = page.locator('#studio-decide-heading');
      const action = page.getByTestId('studio-overdue-review');
      await expect(page.getByTestId('studio-overdue-count')).toHaveText(/1\s*overdue · over 72 hours/);
      await expect(action).toBeVisible();
      expect(await bottom(action), 'the action is below the first screen').toBeLessThanOrEqual(viewport.height);
      expect(await top(heading)).toBeLessThan(await top(page.locator('#studio-setup-heading')));
      await expect(heading).toHaveText('Needs a decision');
      await expect(page.getByTestId('studio-setup-row')).toContainText('11 answers remaining');
      await expect(page.getByText('Continue in the chat')).toHaveCount(0);
      // SAD21: the totals carry no urgency; "past the window" is retired on Studio.
      await expect(page.getByTestId('admin-studio-home')).not.toContainText(/past the window/i);
      expect(await wide(page)).toBeLessThanOrEqual(viewport.width);
      if (process.env.SHOTS_DIR) await page.screenshot({ path: `${process.env.SHOTS_DIR}/studio-${name}.png`, fullPage: true });
    });

    test('the action opens the filtered Approvals with the Studio crumb, and Back returns focus to it', async ({ page, request }) => {
      await open(page, request, { viewport });
      await page.getByTestId('studio-overdue-review').click();
      await expect(page).toHaveURL(/\/admin\/approvals\?age=past$/);
      await expect(page.getByTestId(name === 'desk' ? 'admin-page-crumb' : 'admin-page-back')).toBeVisible();
      await expect(page.getByTestId('approvals-chip-age')).toContainText('Age: Over 72 hours');
      await expect(page.getByTestId('approvals-result-count')).toHaveText('1 result');
      await expect(page.getByTestId('admin-page-scope')).toHaveText(`${TERR} · this territory`);
      if (name === 'desk') {
        // ⚑2 A: on a branch the sidebar's Approvals row lights on the landing.
        await expect(page.locator('nav a[href="/branch/approvals"]').first()).toHaveClass(/bg-violet-50/);
      }
      expect(await wide(page)).toBeLessThanOrEqual(viewport.width);
      if (process.env.SHOTS_DIR) await page.screenshot({ path: `${process.env.SHOTS_DIR}/approvals-${name}.png`, fullPage: true });
      await page.goBack();
      await expect(page).toHaveURL(/\/studio$/);
      await expect(page.getByTestId('studio-overdue-review')).toBeFocused();
    });

    test('a territory with nothing waiting is all clear; an unreadable queue is never 0 or all clear', async ({ page, request }) => {
      await open(page, request, { viewport, queue: 'empty' });
      await expect(page.getByTestId('studio-overdue-all-clear')).toBeVisible();
      await expect(page.getByTestId('studio-overdue')).toContainText('nothing needs a decision');
      if (process.env.SHOTS_DIR) await page.screenshot({ path: `${process.env.SHOTS_DIR}/clear-${name}.png`, fullPage: true });
      await open(page, request, { viewport, queue: 'down' });
      const card = page.getByTestId('studio-overdue-unavailable');
      await expect(card).toContainText('Approvals could not be read');
      await expect(card).not.toContainText(/nothing needs a decision|Every lane answered|0 overdue/);
      if (process.env.SHOTS_DIR) await page.screenshot({ path: `${process.env.SHOTS_DIR}/unavailable-${name}.png`, fullPage: true });
    });

    test('dark: the first screen still leads with the decision and fits the width', async ({ page, request }) => {
      await open(page, request, { viewport, theme: 'dark' });
      expect(await bottom(page.getByTestId('studio-overdue-review'))).toBeLessThanOrEqual(viewport.height);
      expect(await wide(page)).toBeLessThanOrEqual(viewport.width);
      if (process.env.SHOTS_DIR) await page.screenshot({ path: `${process.env.SHOTS_DIR}/studio-dark-${name}.png`, fullPage: true });
    });
  });
}
