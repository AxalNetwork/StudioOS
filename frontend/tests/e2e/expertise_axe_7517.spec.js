/**
 * D7517 (#7517, split from #4828): Advisor › Expertise in a real browser —
 * the Overview at `/expertise` and its five zones (Profile, Services, Proof,
 * Thinking, Visibility) at 390, 768 and 1440 px, light and dark.
 *
 *   · axe-core finds NO violation, of any impact, under the WCAG 2.0, 2.1 and
 *     2.2 A and AA rules, in Expertise's own column: the h1, the section row
 *     and the zone or Overview body, plus any open dialog. The app around it
 *     (the sidebar, the crumb row WorkspaceShell draws for every workspace,
 *     the Worker rail) is not scanned here; D7517 lists what it fails today;
 *   · no page is wider than its window;
 *   · at 390 the section row is Overview · Profile · Services · Proof · More,
 *     every one a 44 px target inside the window, Thinking and Visibility are
 *     folded under More; More opens them as 44 px rows, names the folded section
 *     that is current, and each row opens its zone (D4828, EX-04a).
 *
 * NO PREVIEW, NO ACCOUNT. Like `licences_console_5933.spec.js`, the spec serves
 * the built SPA (`docs/`, from `npm run build` at the repo root) from its own
 * local server with the Workers SPA fallback, and answers every `/api/*` call
 * with invented fixtures in the Worker's shapes (`advisorDto`, `serviceDto`,
 * `proofDto`, the thinking shelf, `advisorVisibility`); the signed-in advisor is
 * a fixture too. Anything off that origin is aborted and the clock is pinned.
 * It does not prove the Worker's answers; the Worker's own tests do.
 *
 *   npm run build                                   (repo root)
 *   cd frontend && npx --no-install playwright test -c playwright.config.js tests/e2e/expertise_axe_7517.spec.js --trace off
 *
 * CI runs it in the `visual` job of `.github/workflows/ci.yml`, after that job
 * builds the SPA, with the job's pinned Chromium (`PW_CHROMIUM_PATH`).
 */
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { createServer } from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CONSENT_VERSION } from '../../src/lib/cookieConsent.js';

const DOCS = resolve(fileURLToPath(new URL('../../../docs', import.meta.url)));
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp',
  '.woff2': 'font/woff2', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json', '.txt': 'text/plain',
};
const NOW = '2026-11-18T12:00:00Z';
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

// The built SPA, with the Workers assets binding's single-page-application
// fallback: a file under docs/ when there is one, else the shell.
let server; let origin;
test.beforeAll(async () => {
  if (!existsSync(join(DOCS, 'index.html'))) throw new Error('docs/index.html is missing: run `npm run build` at the repo root first.');
  server = createServer((req, res) => {
    const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    let file = join(DOCS, path);
    if (!(file === DOCS || file.startsWith(DOCS + sep)) || !existsSync(file) || statSync(file).isDirectory()) file = join(DOCS, 'index.html');
    res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream' });
    res.end(readFileSync(file));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  origin = `http://127.0.0.1:${server.address().port}`;
});
test.afterAll(() => new Promise((r) => (server ? server.close(r) : r())));

// ── invented fixtures, in the Worker's shapes ────────────────────────────────
const ADVISOR_USER = {
  id: 7517, name: 'Synthetic Advisor', email: 'advisor@example.test', role: 'advisor', roles: ['advisor'], licences: ['advisor'],
  is_super_admin: 0, kyc_status: 'approved',
};
const STAMP = '2026-11-10 09:00:00';
const PROFILE = {
  id: 31, uid: 'adv-7517', user_id: 7517, display_name: 'Synthetic Advisor', email: 'advisor@example.test',
  bio: 'Helps seed founders find their first ten customers.', expertise: ['Go-to-market', 'Pricing'], sectors: ['SaaS'],
  linkedin_url: null, hourly_rate_usd: null, is_active: true, created_at: STAMP, updated_at: STAMP,
  headline: 'Go-to-market for seed SaaS', stages: ['seed'], languages: ['English'], country: 'GB', timezone: 'Europe/London',
  availability_note: null, headshot_url: null,
};
const page1 = (n) => ({ offset: 0, limit: 200, total: n, next_offset: null });
const service = (id, o) => ({
  id, uid: `svc-${id}`, advisor_id: 31, title: 'Synthetic service', kind: 'fixed', duration_note: null, price_cents: null, currency: 'USD',
  scope: null, is_active: false, publication_state: 'draft', units_sold: null, created_at: STAMP, updated_at: STAMP, ...o,
});
const SERVICES = [
  service(1, { title: 'Pricing teardown', price_cents: 150000, duration_note: 'Two weeks', scope: 'One pricing page, rewritten.', is_active: true, publication_state: 'published' }),
  service(2, { title: 'Go-to-market sprint', kind: 'package', price_cents: 600000 }),
  service(3, { title: 'Monthly office hours', kind: 'retainer', publication_state: 'hidden' }),
];
const consent = (id, o) => ({
  id, uid: `con-${id}`, proof_item_id: 0, attester_name: 'Sam Example', attester_email: 'sam@example.test', attester_role: 'CEO',
  relationship: 'client', requested_at: STAMP, state: 'confirmed', consent_given: true, consent_given_at: STAMP,
  statement: 'Confirmed: the rebuild happened as described.', withdrawn_at: null, cancelled_at: null, invite_token: null, created_at: STAMP, ...o,
});
const PROOF = [
  { id: 8, uid: 'p-8', advisor_id: 31, kind: 'engagement', title: 'Led a synthetic pricing rebuild', detail: 'Moved to usage pricing.', organization: 'Example Co',
    period_note: '2025', is_public: true, published: true, attested: true, status: 'attested', consents: [consent(1, { proof_item_id: 8 })], created_at: STAMP, updated_at: STAMP },
  { id: 9, uid: 'p-9', advisor_id: 31, kind: 'outcome', title: 'Synthetic first ten customers', detail: null, organization: null,
    period_note: null, is_public: false, published: false, attested: false, status: 'self_stated', consents: [], created_at: STAMP, updated_at: STAMP },
];
const article = (id, o) => ({
  id, slug: `piece-${id}`, title: 'Synthetic piece', subtitle: null, status: 'draft', published_at: null, publish_at: null, word_count: 900,
  read_minutes: 4, views: 0, sector: null, created_at: STAMP, updated_at: STAMP, ...o,
});
const THINKING = [
  article(21, { title: 'Price before you pitch', status: 'published', published_at: '2026-10-01 09:00:00', views: 186 }),
  article(22, { title: 'Three numbers your board wants', status: 'changes_requested' }),
  article(23, { title: 'A scheduled synthetic piece', status: 'approved', publish_at: '2026-12-01T09:00:00Z' }),
];
const VISIBILITY = (days) => ({
  window: { days, from: '2026-10-19 12:00:00', until: '2026-11-18 12:00:00' },
  surfaces: [
    { key: 'link:a', kind: 'booking_link', name: '/b/intro', audience: 'public', is_active: true, requests: 3, by_status: { confirmed: 3 }, views: null },
    { key: 'no_link', kind: 'no_link', name: 'Booked without a link', requests: 1, by_status: { pending: 1 }, views: null, note: 'A booking made without a link.' },
  ],
  links: { offset: 0, limit: 100, total: 1, next_offset: null },
  requests: { total: 4, by_status: { confirmed: 3, pending: 1 } },
  writing: {
    published: 1, opens: 186, opens_note: 'Times your pieces were opened here.', requests: null, requests_note: 'A booking does not record which piece led to it.',
    top: [{ slug: 'piece-21', title: 'Price before you pitch', opens: 186 }], others: { count: 0, opens: 0 },
  },
  unlinked_services: { items: [{ uid: 't-1', name: 'Fundraising strategy' }], more: false },
  unreadable: false,
  engagements: null, engagements_note: 'No engagement records the link or piece it came through.',
  views: null, views_note: 'No profile view is recorded anywhere in the product.',
});

/** The Expertise reads, by path. */
function expertiseRead(path, params) {
  if (path === '/api/advisors/me') return PROFILE;
  if (path === '/api/advisors/me/services') {
    const live = SERVICES.filter((s) => s.is_active).length;
    return { items: SERVICES, page: page1(SERVICES.length),
      counts: { total: SERVICES.length, live, draft: SERVICES.length - live, priced: 2, unpriced: 1 },
      publication_counts: { draft: 1, published: 1, hidden: 1 } };
  }
  if (path === '/api/advisors/me/proof') return { items: PROOF, page: page1(PROOF.length), counts: { total: 2, attested: 1, self_stated: 1 } };
  if (path === '/api/advisors/me/thinking') {
    return { items: THINKING, page: { ...page1(THINKING.length), limit: 100 },
      counts: { total: 3, needs_you: 1, with_editors: 0, published: 1, drafts: 2, best_reach: 186, total_reach: 186, talk_reach: null } };
  }
  if (path === '/api/advisors/me/visibility') return VISIBILITY(Number(params.get('days')) || 30);
  return undefined;
}

/**
 * Signs the fixture advisor in, in `theme`, answers `/api/*`, aborts every
 * other origin and opens `path`. Returns the Expertise reads the fixtures do
 * not answer (it must stay empty) and every write (none is made).
 */
async function visit(page, path, theme) {
  const unanswered = [];
  const writes = [];
  await page.clock.setFixedTime(new Date(NOW));
  await page.addInitScript(({ user, consentVersion, t }) => {
    localStorage.setItem('token', 'synthetic-expertise-session');
    localStorage.setItem('user', JSON.stringify(user));
    localStorage.setItem('viewMode', 'advisor');
    localStorage.setItem('axal_appearance_v1', JSON.stringify({ theme: t }));
    localStorage.setItem('axal_cookie_consent_v1', JSON.stringify({ version: consentVersion, decided: true, categories: { essential: true } }));
  }, { user: ADVISOR_USER, consentVersion: CONSENT_VERSION, t: theme });
  await page.routeWebSocket(() => true, (ws) => ws.close());
  await page.route((u) => u.origin !== origin, (route) => route.abort());
  await page.route((u) => u.pathname.startsWith('/api/'), (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const p = url.pathname;
    if (p === '/api/client-error') return route.fulfill({ status: 204, body: '' });
    if (req.method() !== 'GET') { writes.push(`${req.method()} ${p}`); return route.fulfill({ status: 500, json: { error: 'unexpected_write' } }); }
    if (p === '/api/auth/me' || p === '/api/me') return route.fulfill({ json: ADVISOR_USER });
    if (p === '/api/settings/appearance') return route.fulfill({ json: { theme } });
    if (p === '/api/onboarding/progress') return route.fulfill({ json: { flow: 'advisor', completed_at: NOW } });
    const body = expertiseRead(p, url.searchParams);
    if (body !== undefined) return route.fulfill({ json: body });
    if (p.startsWith('/api/advisors/me')) unanswered.push(p);
    // The shell's own reads (notifications, the AI rail, settings) are not
    // Expertise's: they are answered "not found", which every one handles.
    return route.fulfill({ status: 404, json: { error: 'not_found' } });
  });
  await page.goto(`${origin}${path}`);
  return { unanswered, writes };
}

/**
 * Expertise's column: the WorkspaceShell block that holds the h1, the section
 * row and the body, less its crumb row (shared by every workspace).
 */
const COLUMN = 'div:has(> nav[aria-label="Expertise sections"])';
const CRUMB = 'div:has(> a[data-testid="link-workspace-crumb"])';

/** Every axe violation under the WCAG A and AA tags in that column and any open dialog, one line each. */
async function violations(page) {
  await expect(page.locator(COLUMN)).toHaveCount(1);
  const builder = new AxeBuilder({ page }).withTags(TAGS).include(COLUMN).exclude(CRUMB);
  if (await page.locator('[role="dialog"]').count()) builder.include('[role="dialog"]');
  const r = await builder.analyze();
  return r.violations.map((v) => `${v.impact} ${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`);
}

/** How far the page itself scrolls sideways: 0 when nothing is wider than the window. */
const sideways = (page) => page.evaluate(() => {
  const el = document.scrollingElement || document.documentElement;
  return Math.max(0, el.scrollWidth - el.clientWidth, document.body.scrollWidth - document.documentElement.clientWidth);
});

const nav = (page) => page.getByRole('navigation', { name: 'Expertise sections' });

/** The zones, each with what its body draws once its read has answered. */
const PAGES = [
  { path: '/expertise', name: 'Overview', ready: (page) => expect(page.getByText('Led a synthetic pricing rebuild').filter({ visible: true }).first()).toBeVisible() },
  { path: '/expertise/profile', name: 'Profile', ready: (page) => expect(page.getByText('Go-to-market for seed SaaS').filter({ visible: true }).first()).toBeVisible() },
  { path: '/expertise/services', name: 'Services', ready: (page) => expect(page.getByText('Pricing teardown').filter({ visible: true }).first()).toBeVisible() },
  { path: '/expertise/proof', name: 'Proof', ready: (page) => expect(page.getByText('Led a synthetic pricing rebuild').filter({ visible: true }).first()).toBeVisible() },
  { path: '/expertise/thinking', name: 'Thinking', ready: (page) => expect(page.getByText('Price before you pitch').filter({ visible: true }).first()).toBeVisible() },
  { path: '/expertise/visibility', name: 'Visibility', ready: (page) => expect(page.getByText('/b/intro').filter({ visible: true }).first()).toBeVisible() },
];

for (const width of [390, 768, 1440]) {
  for (const theme of ['light', 'dark']) {
    test.describe(`Expertise at ${width}px in ${theme}`, () => {
      test.use({ viewport: { width, height: 900 }, colorScheme: theme, reducedMotion: 'reduce' });
      for (const z of PAGES) {
        test(`${z.path}: no WCAG 2.2 AA violation and no sideways scroll`, async ({ page }) => {
          const { unanswered, writes } = await visit(page, z.path, theme);
          await z.ready(page);
          await expect(nav(page)).toBeVisible();
          await page.waitForLoadState('networkidle');
          if (theme === 'dark') await expect(page.locator('html')).toHaveClass(/(^|\s)dark(\s|$)/);
          else await expect(page.locator('html')).not.toHaveClass(/(^|\s)dark(\s|$)/);
          expect(await violations(page)).toEqual([]);
          expect(await sideways(page)).toBe(0);
          expect(unanswered).toEqual([]);
          expect(writes).toEqual([]);
        });
      }
    });
  }
}

test.describe('Expertise section navigation on a 390px phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
  const SHOWN = ['Overview', 'Profile', 'Services', 'Proof'];
  const FOLDED = [['Thinking', '/expertise/thinking'], ['Visibility', '/expertise/visibility']];

  for (const theme of ['light', 'dark']) {
    test(`the row is ${SHOWN.join(' · ')} · More, each a 44px target inside the window (${theme})`, async ({ page }) => {
      await visit(page, '/expertise/services', theme);
      await expect(page.getByText('Pricing teardown').filter({ visible: true }).first()).toBeVisible();
      const row = nav(page);
      const visible = row.locator('a:visible, button:visible');
      await expect(visible).toHaveCount(SHOWN.length + 1);
      const names = (await visible.allInnerTexts()).map((s) => s.replace(/\s+/g, ' ').trim());
      expect(names).toEqual([...SHOWN, 'More ▾']);
      for (const [label] of FOLDED) await expect(row.getByRole('link', { name: label, exact: true })).toBeHidden();
      await expect(row.getByRole('link', { name: 'Services', exact: true })).toHaveAttribute('aria-current', 'page');
      for (const el of await visible.all()) {
        const b = await el.boundingBox();
        expect(b.height, `${await el.innerText()} is shorter than 44px`).toBeGreaterThanOrEqual(44);
        expect(b.width, `${await el.innerText()} is narrower than 44px`).toBeGreaterThanOrEqual(44);
        expect(b.x).toBeGreaterThanOrEqual(0);
        expect(b.x + b.width, `${await el.innerText()} runs past the window`).toBeLessThanOrEqual(390);
      }
      expect(await sideways(page)).toBe(0);
    });
  }

  test('More opens Thinking and Visibility as 44px rows, by keyboard, and each row opens its zone', async ({ page }) => {
    const { writes } = await visit(page, '/expertise/profile', 'light');
    await expect(page.getByText('Go-to-market for seed SaaS').filter({ visible: true }).first()).toBeVisible();
    const more = nav(page).getByRole('button', { name: 'More' });
    await expect(more).toHaveAttribute('aria-expanded', 'false');
    await expect(page.getByTestId('zone-nav-more-panel')).toHaveCount(0);
    await more.focus();
    await page.keyboard.press('Enter');
    await expect(more).toHaveAttribute('aria-expanded', 'true');
    const panel = page.getByTestId('zone-nav-more-panel');
    await expect(panel).toBeVisible();
    await expect(more).toHaveAttribute('aria-controls', await panel.getAttribute('id'));
    const rows = panel.getByRole('link');
    await expect(rows).toHaveCount(FOLDED.length);
    for (const [i, [label, href]] of FOLDED.entries()) {
      await expect(rows.nth(i)).toHaveText(label);
      await expect(rows.nth(i)).toHaveAttribute('href', href);
      const b = await rows.nth(i).boundingBox();
      expect(b.height, `${label} row is shorter than 44px`).toBeGreaterThanOrEqual(44);
      expect(b.x + b.width).toBeLessThanOrEqual(390);
    }
    // The open panel passes axe too, and the page still fits.
    expect(await violations(page)).toEqual([]);
    expect(await sideways(page)).toBe(0);
    // Tab reaches the first row; Enter opens Thinking, closes the panel and More now names it.
    await page.keyboard.press('Tab');
    await expect(rows.first()).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.getByText('Price before you pitch').filter({ visible: true }).first()).toBeVisible();
    await expect(panel).toHaveCount(0);
    await expect(more).toHaveAccessibleName(/^More: Thinking/);
    await expect(more).toHaveText(/Thinking/);
    // Opened again, the current section says so; Visibility opens from its row.
    await more.click();
    await expect(panel.getByRole('link', { name: /Thinking/ })).toHaveAttribute('aria-current', 'page');
    await expect(panel.getByRole('link', { name: /Thinking/ })).toContainText('Current');
    await panel.getByRole('link', { name: 'Visibility', exact: true }).click();
    await expect(page.getByText('/b/intro').filter({ visible: true }).first()).toBeVisible();
    await expect(more).toHaveAccessibleName(/^More: Visibility/);
    expect(await violations(page)).toEqual([]);
    expect(writes).toEqual([]);
  });

  test('from 1024px there is no More: all five zones are pills', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await visit(page, '/expertise', 'light');
    await expect(nav(page)).toBeVisible();
    await expect(nav(page).getByRole('button', { name: 'More' })).toBeHidden();
    for (const label of ['Overview', 'Profile', 'Services', 'Proof', 'Thinking', 'Visibility']) {
      await expect(nav(page).getByRole('link', { name: label, exact: true })).toBeVisible();
    }
    await expect(nav(page).getByRole('link', { name: 'Overview', exact: true })).toHaveAttribute('aria-current', 'page');
  });
});
