/**
 * #5933 (D4819-p5933, moved from #4707): the HQ Licences console in a real
 * browser at 390px and at 1280px — the ledger, a licence opened from its URL,
 * the section tab strip (no sideways page scroll, reachable by keyboard) and
 * one reason dialog (focus held inside, Escape returns focus to its opener).
 *
 * NO PREVIEW, NO ACCOUNT. The spec serves the built SPA (`docs/`, from
 * `npm run build` at the repo root) from its own local server with the
 * Workers SPA fallback, and answers every `/api/*` call in the page with
 * invented fixtures (`page.route`); the signed-in Super Admin is a fixture
 * too. Anything off that origin is aborted, and the clock is pinned, so the
 * renewal and freshness lines read the same on every run. It does not prove
 * the Worker's answers; the Worker's own tests do (D4707, D4819).
 *
 *   npm run build                                   (repo root)
 *   cd frontend && npx playwright test tests/e2e/licences_console_5933.spec.js
 *
 * CI runs it in the `visual` job of `.github/workflows/ci.yml`, after that job
 * builds the SPA, with the job's pinned Chromium (`PW_CHROMIUM_PATH`).
 */
import { test, expect } from '@playwright/test';
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
const NOW = '2026-11-09T12:00:00Z';

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

// ── invented fixtures, in the Worker's shapes (admin_licences*.ts) ───────────
const operator = { id: 5933, name: 'Synthetic HQ operator', email: 'hq@example.test', role: 'admin', is_super_admin: 1 };
const sync = (rev) => ({
  available: true, hq_revision: rev, branch_revision: rev, last_success_at: '2026-11-09 11:56:00',
  pending: null, pending_available: true, termination: null, termination_available: true,
});
const FRANCE = {
  uid: 'lic_fr', licence_ref: 'SYN-FR-001', brand_name: 'Synthetic France', legal_entity_name: 'Synthetic France SAS', kind: 'subsidiary',
  status: 'active', territories: ['FR'], seats: { founder: 25, investor: 10, advisor: 5 }, seats_licensed: 40,
  annual_fee_cents: 10000000, currency: 'EUR', revenue_share_bps: 1200, token_split_bps: 5000, term_years: 3,
  starts_on: '2026-03-02', renews_on: '2027-03-01', terms_revision: 4, status_note: null,
  deployment: { hostname: 'fr.example.test', status: 'linked' }, deployment_available: true,
  domain: null, domain_available: true, sync: sync(4), blockers: [], events: [],
};
const NORDICS = {
  ...FRANCE, uid: 'lic_no', licence_ref: 'SYN-NO-002', brand_name: 'Synthetic Nordics', legal_entity_name: 'Synthetic Nordics AS',
  status: 'suspended', territories: ['NO', 'SE'], renews_on: '2026-12-01', sync: sync(2),
};
const LICENCES = [FRANCE, NORDICS];
const UNREADABLE = Symbol('unreadable');
const ADMIN = { user_id: 41, name: 'Camille Synthetic', email: 'camille@example.test', role: 'admin', admin_role: 'principal', is_active: 1 };
const reads = (l) => ({
  '': l,
  '/contract': { contracts_available: true, templates: [], contracts: [{ uid: `c_${l.uid}`, status: 'signed', template_title: 'Subsidiary Licence Agreement', template_version: 4, signed_at: '2026-03-02', superseded_at: null }] },
  '/deployment': { deployment: { phase: 'committed', last_failure: null } },
  '/fee-invoices': { annual_fee_cents: l.annual_fee_cents, currency: l.currency, starts_on: l.starts_on, invoices: [] },
  '/requests': { available: true, items: [], total: l.uid === 'lic_no' ? 1 : 0, next_cursor: null, branch_readable: true },
  '/admins': { items: [ADMIN] },
  '/terms': { licence_uid: l.uid, terms: null, sections: {}, revision: 0 },
  // Country pricing (D5017) under the Terms read is not under test: it answers that it cannot be read.
  '/pricing': UNREADABLE,
  '/events': { items: [], next_before: null },
});
const LEDGER = {
  '/admin/licences': { items: LICENCES, total: LICENCES.length, next_cursor: null, limit: 50, seats_used_available: true },
  '/admin/licences/summary': {
    coverage: [], renewals: { items: [], total: 0, complete: true },
    counts: { total: 2, by_status: { active: 1, suspended: 1 }, by_kind: { subsidiary: 2 } },
  },
  '/admin/licences/territories': { items: [{ country: 'FR', uid: 'lic_fr', status: 'active' }, { country: 'NO', uid: 'lic_no', status: 'suspended' }, { country: 'SE', uid: 'lic_no', status: 'suspended' }] },
};
function licenceRead(path) {
  if (LEDGER[path]) return LEDGER[path];
  const m = path.match(/^\/admin\/licences\/(lic_[a-z]+)(\/[a-z-]+)?$/);
  const l = m && LICENCES.find((x) => x.uid === m[1]);
  return l ? reads(l)[m[2] || ''] : undefined;
}

/**
 * Signs the fixture operator in, answers `/api/*`, aborts every other origin
 * and opens `path`. Returns what the page asked that the fixtures do not
 * answer under `/api/admin/licences` (it must stay empty) and every write.
 */
async function visit(page, path) {
  const unanswered = [];
  const writes = [];
  await page.clock.setFixedTime(new Date(NOW));
  await page.addInitScript(({ user, consentVersion }) => {
    localStorage.setItem('token', 'synthetic-licences-session');
    localStorage.setItem('user', JSON.stringify(user));
    localStorage.setItem('hqView', '1');
    localStorage.setItem('axal_cookie_consent_v1', JSON.stringify({ version: consentVersion, decided: true, categories: { essential: true } }));
  }, { user: operator, consentVersion: CONSENT_VERSION });
  await page.routeWebSocket(() => true, (ws) => ws.close());
  await page.route((u) => u.origin !== origin, (route) => route.abort());
  await page.route((u) => u.pathname.startsWith('/api/'), (route) => {
    const req = route.request();
    const p = new URL(req.url()).pathname;
    if (p === '/api/client-error') return route.fulfill({ status: 204, body: '' });
    if (req.method() !== 'GET') { writes.push(`${req.method()} ${p}`); return route.fulfill({ status: 500, json: { error: 'unexpected_write' } }); }
    if (p === '/api/auth/me' || p === '/api/me') return route.fulfill({ json: operator });
    if (p === '/api/onboarding/progress') return route.fulfill({ json: { completed_at: NOW } });
    if (p.startsWith('/api/admin/licences')) {
      const body = licenceRead(p.slice('/api'.length));
      if (body === UNREADABLE) return route.fulfill({ status: 503, json: { error: 'unavailable' } });
      if (body !== undefined) return route.fulfill({ json: body });
      unanswered.push(p);
    }
    // The shell's own reads (notifications, the AI rail, settings) are not
    // the console's: they are answered "not found", which every one handles.
    return route.fulfill({ status: 404, json: { error: 'not_found' } });
  });
  await page.goto(`${origin}${path}`);
  return { unanswered, writes };
}

/** How far the page itself scrolls sideways: 0 when nothing is wider than the window. */
const sideways = (page) => page.evaluate(() => {
  const el = document.scrollingElement || document.documentElement;
  return Math.max(0, el.scrollWidth - el.clientWidth, document.body.scrollWidth - document.documentElement.clientWidth);
});

/** Presses Tab until focus lands on a tab of `tablist`, at most `limit` times; returns how many it took, or -1. */
async function tabInto(page, tablist, limit = 40) {
  for (let i = 1; i <= limit; i += 1) {
    await page.keyboard.press('Tab');
    if (await tablist.evaluate((el) => el.contains(document.activeElement) && document.activeElement.getAttribute('role') === 'tab')) return i;
  }
  return -1;
}

/** The six-section tablist (a section with views draws a second one under it). */
const strip = (page) => page.getByRole('tablist', { name: 'Licence sections' });
const inside = (locator) => locator.evaluate((el) => el.contains(document.activeElement));

for (const width of [390, 1280]) {
  const phone = width < 768;
  test.describe(`Licences console at ${width}px`, () => {
    test.use({ viewport: { width, height: 900 } });

    test('the ledger lists every licence, fits the window and opens a row in place', async ({ page }) => {
      const { unanswered, writes } = await visit(page, '/admin/licences');
      await expect(page.getByRole('heading', { level: 1, name: 'Licences' })).toBeVisible();
      await expect(page.getByTestId('licence-counts')).toContainText('2 licences');
      // Below `md` the ledger is a stacked list, from `md` up the nine-column table (D4819 part 1).
      const table = page.getByTestId('licence-ledger-table');
      const list = page.getByTestId('licence-ledger-list');
      if (phone) {
        await expect(table).toBeHidden();
        await expect(list.getByTestId('licence-list-row')).toHaveCount(2);
      } else {
        await expect(list).toBeHidden();
        await expect(table.getByTestId('licence-row')).toHaveCount(2);
        await expect(table.getByRole('columnheader')).toHaveCount(9);
        // Read against the pinned clock: 2026-11-09 to 2026-12-01.
        await expect(table.getByTestId('licence-row').nth(1)).toContainText('2026-12-01 · in 22d');
      }
      const shown = phone ? list : table;
      await expect(shown).toContainText('Synthetic Nordics');
      await expect(shown).toContainText(/suspended/i);
      expect(await sideways(page)).toBe(0);

      const row = shown.getByRole('link', { name: 'Synthetic France' });
      await expect(row).toHaveAttribute('href', '/admin/licences/lic_fr');
      await row.focus();
      await page.keyboard.press('Enter');
      await expect(page).toHaveURL(/\/admin\/licences\?licence=lic_fr$/);
      await expect(page.getByTestId('licence-breadcrumb').locator('[aria-current="page"]')).toHaveText('Synthetic France');
      await expect(strip(page).getByRole('tab', { name: 'Overview', exact: true })).toHaveAttribute('aria-selected', 'true');
      expect(await sideways(page)).toBe(0);
      expect(unanswered).toEqual([]);
      expect(writes).toEqual([]);
    });

    test('a licence opens from its URL on the section the URL names, and again after a reload', async ({ page }) => {
      const { unanswered, writes } = await visit(page, '/admin/licences/lic_fr/access');
      await expect(page).toHaveURL(/\/admin\/licences\?licence=lic_fr&tab=admins$/);
      await expect(page.getByTestId('licence-breadcrumb').locator('[aria-current="page"]')).toHaveText('Synthetic France');
      await expect(strip(page).getByRole('tab', { name: 'Access', exact: true })).toHaveAttribute('aria-selected', 'true');
      await expect(page.getByRole('tab', { name: 'Administrators', exact: true })).toHaveAttribute('aria-selected', 'true');
      await expect(page.getByRole('tabpanel')).toContainText('Camille Synthetic');
      expect(await sideways(page)).toBe(0);

      await page.reload();
      await expect(strip(page).getByRole('tab', { name: 'Access', exact: true })).toHaveAttribute('aria-selected', 'true');
      await expect(page.getByRole('tabpanel')).toContainText('Camille Synthetic');
      expect(unanswered).toEqual([]);
      expect(writes).toEqual([]);
    });

    test('the tab strip fits the window and is reached and driven by keyboard', async ({ page }) => {
      const { unanswered } = await visit(page, '/admin/licences/lic_fr');
      const sections = strip(page);
      const tabs = sections.getByRole('tab');
      await expect(tabs).toHaveCount(6);
      await expect(tabs.first()).toHaveAttribute('aria-selected', 'true');
      // No sideways page scroll, and every tab inside the window.
      expect(await sideways(page)).toBe(0);
      const box = await sections.boundingBox();
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(width);
      if (phone) {
        for (const t of await tabs.all()) {
          const b = await t.boundingBox();
          expect(b.x + b.width).toBeLessThanOrEqual(width);
          expect(b.height).toBeGreaterThanOrEqual(44);
        }
      }

      // Reached by Tab from the breadcrumb: focus lands on the selected tab
      // (roving tabIndex), then the arrow, End and Home keys move it and the URL.
      await page.getByTestId('licence-breadcrumb').getByRole('link', { name: 'Licences' }).focus();
      expect(await tabInto(page, sections)).toBeGreaterThan(0);
      await expect(strip(page).getByRole('tab', { name: 'Overview', exact: true })).toBeFocused();
      await page.keyboard.press('ArrowRight');
      await expect(strip(page).getByRole('tab', { name: 'Terms', exact: true })).toBeFocused();
      await expect(strip(page).getByRole('tab', { name: 'Terms', exact: true })).toHaveAttribute('aria-selected', 'true');
      await expect(page).toHaveURL(/[?&]tab=terms(&|$)/);
      await page.keyboard.press('End');
      await expect(strip(page).getByRole('tab', { name: 'History', exact: true })).toBeFocused();
      await expect(strip(page).getByRole('tab', { name: 'History', exact: true })).toHaveAttribute('aria-selected', 'true');
      await page.keyboard.press('Home');
      await expect(strip(page).getByRole('tab', { name: 'Overview', exact: true })).toBeFocused();
      await expect(strip(page).getByRole('tab', { name: 'Overview', exact: true })).toHaveAttribute('aria-selected', 'true');
      // One Tab stop: Tab leaves the strip rather than walking its tabs.
      await page.keyboard.press('Tab');
      expect(await inside(sections)).toBe(false);
      expect(await sideways(page)).toBe(0);
      expect(unanswered).toEqual([]);
    });

    test('a reason dialog holds focus, and Escape closes it and returns focus to its opener', async ({ page }) => {
      const { unanswered, writes } = await visit(page, '/admin/licences/lic_fr/access');
      const remove = page.getByRole('button', { name: 'Remove…' });
      await remove.focus();
      await page.keyboard.press('Enter');
      // #6937 made every licence write one consequence sheet, titled with the account it acts on.
      const dialog = page.getByRole('dialog', { name: 'Remove Camille Synthetic' });
      await expect(dialog).toBeVisible();
      const reason = dialog.getByLabel('Why is this administrator being removed? It is recorded in the audit log.');
      await expect(reason).toBeFocused();
      await expect(dialog.getByRole('button', { name: 'Remove administrator' })).toBeDisabled();
      expect(await sideways(page)).toBe(0);
      // Focus held: Tab and Shift+Tab, more times than the dialog has controls, never leave it.
      for (let i = 0; i < 8; i += 1) {
        await page.keyboard.press('Tab');
        expect(await inside(dialog)).toBe(true);
      }
      for (let i = 0; i < 8; i += 1) {
        await page.keyboard.press('Shift+Tab');
        expect(await inside(dialog)).toBe(true);
      }
      await reason.focus();
      await page.keyboard.type('Synthetic reason long enough');
      await expect(dialog.getByRole('button', { name: 'Remove administrator' })).toBeEnabled();
      await page.keyboard.press('Escape');
      await expect(dialog).toHaveCount(0);
      await expect(remove).toBeFocused();
      expect(writes).toEqual([]);
      expect(unanswered).toEqual([]);
    });
  });
}
