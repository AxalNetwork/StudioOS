/**
 * D7808 (#7808): two shell fixes in a real browser, which until now only unit
 * tests pinned.
 *
 *   · THE SWITCHER'S NAME (#7661, D7661). The expanded `switcher-trigger`
 *     carries no `aria-label`; Chromium names it by its one screen-reader
 *     sentence, `switcherTriggerName()` in `src/ui/CompanySwitcher.jsx`: the
 *     visible words in the order drawn, then "switch company or project". With
 *     no company it is "No company, switch company or project"; after a failed
 *     read, "Unavailable, …"; with a company, "Example Ventures, Company, …".
 *     axe under the WCAG A and AA tags finds nothing on the trigger.
 *   · THE RAIL'S ABSENT LINE (#7662, D7662). At 1440 the Worker rail draws its
 *     "Not recorded. …" line (`.fwr-absent`, coloured by `--fwr-absent` in
 *     `src/ui/workerRail.css`). axe scans the whole rail under the same tags,
 *     in light and dark, and finds no violation; its `color-contrast` rule
 *     measured the absent line and passed it, rather than leaving it
 *     undecided. No axe rule is disabled.
 *
 * NO PREVIEW, NO ACCOUNT. The set-up is `expertise_axe_7517.spec.js`'s: the
 * spec serves the built SPA (`docs/`, from `npm run build` at the repo root)
 * with the Workers SPA fallback, signs in an invented advisor, answers
 * `/api/*` with invented fixtures in the Worker's shapes, aborts anything off
 * its origin and pins the clock. The rail's model list is answered 404, which
 * is the rail's "no row for this page yet" (railModels.js), so the absent
 * line is drawn. It does not prove the Worker's answers; the Worker's own
 * tests do.
 *
 *   npm run build                                   (repo root)
 *   cd frontend && npx --no-install playwright test -c playwright.config.js tests/e2e/switcher_rail_7808.spec.js --trace off
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
  id: 7808, name: 'Synthetic Advisor', email: 'advisor@example.test', role: 'advisor', roles: ['advisor'], licences: ['advisor'],
  is_super_admin: 0, kyc_status: 'approved',
};
const STAMP = '2026-11-10 09:00:00';
const PROFILE = {
  id: 31, uid: 'adv-7808', user_id: 7808, display_name: 'Synthetic Advisor', email: 'advisor@example.test',
  bio: 'Helps seed founders find their first ten customers.', expertise: ['Pricing'], sectors: ['SaaS'],
  linkedin_url: null, hourly_rate_usd: null, is_active: true, created_at: STAMP, updated_at: STAMP,
  headline: 'Go-to-market for seed SaaS', stages: ['seed'], languages: ['English'], country: 'GB', timezone: 'Europe/London',
  availability_note: null, headshot_url: null,
};
/** One `/company/memberships` entry: a company the advisor belongs to. */
const COMPANY = {
  id: 41, uid: 'co-7808', company_name: 'Example Ventures', created_at: STAMP, archived_at: null,
  my_role: 'admin', is_primary_admin: true, cycles_active: 0, last_opened: null,
};

/**
 * Signs the fixture advisor in, in `theme`, answers `/api/*`, aborts every
 * other origin and opens `path`. `memberships` is what `/api/company/memberships`
 * answers: an array, or a status for a failed read. Returns every write (none
 * is made).
 */
async function visit(page, path, { theme = 'light', memberships = [] } = {}) {
  const writes = [];
  await page.clock.setFixedTime(new Date(NOW));
  await page.addInitScript(({ user, consentVersion, t }) => {
    localStorage.setItem('token', 'synthetic-shell-session');
    localStorage.setItem('user', JSON.stringify(user));
    localStorage.setItem('viewMode', 'advisor');
    localStorage.setItem('axal_appearance_v1', JSON.stringify({ theme: t }));
    localStorage.setItem('axal_cookie_consent_v1', JSON.stringify({ version: consentVersion, decided: true, categories: { essential: true } }));
  }, { user: ADVISOR_USER, consentVersion: CONSENT_VERSION, t: theme });
  await page.routeWebSocket(() => true, (ws) => ws.close());
  await page.route((u) => u.origin !== origin, (route) => route.abort());
  await page.route((u) => u.pathname.startsWith('/api/'), (route) => {
    const req = route.request();
    const p = new URL(req.url()).pathname;
    if (p === '/api/client-error') return route.fulfill({ status: 204, body: '' });
    if (req.method() !== 'GET') { writes.push(`${req.method()} ${p}`); return route.fulfill({ status: 500, json: { error: 'unexpected_write' } }); }
    if (p === '/api/auth/me' || p === '/api/me') return route.fulfill({ json: ADVISOR_USER });
    if (p === '/api/settings/appearance') return route.fulfill({ json: { theme } });
    if (p === '/api/onboarding/progress') return route.fulfill({ json: { flow: 'advisor', completed_at: NOW } });
    if (p === '/api/company/memberships') {
      return Array.isArray(memberships)
        ? route.fulfill({ json: memberships })
        : route.fulfill({ status: memberships, json: { error: 'unavailable' } });
    }
    if (p === '/api/advisors/me') return route.fulfill({ json: PROFILE });
    // Every other read, the rail's model list among them, is answered "not
    // found", which each one handles; for the rail that is its Not recorded line.
    return route.fulfill({ status: 404, json: { error: 'not_found' } });
  });
  await page.goto(`${origin}${path}`);
  return { writes };
}

/** Every axe violation under the WCAG A and AA tags inside `selector`, one line each, and the full result. */
async function axe(page, selector) {
  const r = await new AxeBuilder({ page }).withTags(TAGS).include(selector).analyze();
  return { r, lines: r.violations.map((v) => `${v.impact} ${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`) };
}

const isDark = (page, theme) => (theme === 'dark'
  ? expect(page.locator('html')).toHaveClass(/(^|\s)dark(\s|$)/)
  : expect(page.locator('html')).not.toHaveClass(/(^|\s)dark(\s|$)/));

test.describe('The company switcher is named by the words it shows (D7661)', () => {
  test.use({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
  const STATES = [
    { what: 'no company', memberships: [], shown: 'No company', name: 'No company, switch company or project' },
    { what: 'a failed read', memberships: 500, shown: 'Unavailable', name: 'Unavailable, switch company or project' },
    { what: 'a selected company', memberships: [COMPANY], shown: 'Example Ventures', name: 'Example Ventures, Company, switch company or project' },
  ];
  for (const theme of ['light', 'dark']) {
    for (const s of STATES) {
      test(`${s.what} (${theme}): "${s.name}"`, async ({ page }) => {
        const { writes } = await visit(page, '/expertise', { theme, memberships: s.memberships });
        const trigger = page.getByTestId('switcher-trigger');
        await expect(trigger).toBeVisible();
        await expect(trigger).toContainText(s.shown);
        await page.waitForLoadState('networkidle');
        await isDark(page, theme);
        // The name is the sentence, exactly; it comes from the content, not an aria-label.
        await expect(trigger).toHaveAccessibleName(s.name);
        await expect(trigger).not.toHaveAttribute('aria-label', /./);
        await expect(page.getByRole('button', { name: s.name, exact: true })).toHaveCount(1);
        // Label in Name: every word drawn on the button opens the name, in order.
        const drawn = (await trigger.locator('[aria-hidden="true"] [data-testid], [aria-hidden="true"] .truncate').allInnerTexts())
          .map((t) => t.trim()).filter(Boolean);
        expect(drawn.length).toBeGreaterThan(0);
        expect(s.name.startsWith(`${drawn.join(', ')}, `), `${JSON.stringify(drawn)} does not open "${s.name}"`).toBe(true);
        const { lines } = await axe(page, '[data-testid="switcher-trigger"]');
        expect(lines).toEqual([]);
        expect(writes).toEqual([]);
      });
    }
  }
});

test.describe('The Worker rail\'s absent line passes colour contrast (D7662)', () => {
  test.use({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
  for (const theme of ['light', 'dark']) {
    test(`${theme}: axe finds no violation in the rail, and color-contrast passed its Not recorded line`, async ({ page }) => {
      const { writes } = await visit(page, '/expertise', { theme });
      const rail = page.locator('aside.fwr');
      await expect(rail).toHaveCount(1);
      const absent = rail.getByTestId('text-worker-rail-model-none');
      await expect(absent).toBeVisible();
      await expect(absent).toHaveClass(/(^|\s)fwr-absent(\s|$)/);
      await expect(absent).toHaveText(/^Not recorded\. /);
      await page.waitForLoadState('networkidle');
      await isDark(page, theme);
      const { r, lines } = await axe(page, 'aside.fwr');
      expect(lines).toEqual([]);
      // The rule ran on the absent line and decided it: a pass, not "incomplete".
      const decided = (bucket) => (bucket.find((x) => x.id === 'color-contrast')?.nodes || [])
        .filter((n) => n.html.includes('data-testid="text-worker-rail-model-none"')).length;
      expect(decided(r.passes), 'color-contrast did not pass the Not recorded line').toBe(1);
      expect(decided(r.incomplete)).toBe(0);
      expect(writes).toEqual([]);
    });
  }
});
