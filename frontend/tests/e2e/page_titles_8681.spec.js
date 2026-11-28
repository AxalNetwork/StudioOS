/**
 * D8681 (#8681): the browser tab title names the screen, in a real browser.
 *
 *   · A COLD VISIT to each screen the issue names settles on its own title
 *     ("Contracts · Axal VC", "Companies · Research · Axal VC", …), not the
 *     shell's "StudioOS, the founder workspace — Axal VC StudioOS".
 *   · SAME-TAB NAVIGATION, BACK AND FORWARD each settle on the destination's
 *     title, and the Deals → HQ case the issue saw never leaves "Deal flow".
 *   · A public route (Terms) keeps the title its prerendered HTML carries.
 *   · Every title change is logged with its time since the navigation began
 *     (a MutationObserver on <head>), attached to the test as an annotation,
 *     and the title must not change again once the screen has settled.
 *
 * NO PREVIEW, NO ACCOUNT. The set-up is `licences_console_5933.spec.js`'s: the
 * spec serves the built SPA (`docs/`, from `npm run build` at the repo root)
 * with the Workers SPA fallback, signs in an invented Super Admin, answers
 * every `/api/*` read "not found" (each screen handles that), aborts anything
 * off its origin and pins the clock. It proves the title, not the screens' data.
 *
 *   npm run build                                   (repo root)
 *   cd frontend && npx --no-install playwright test -c playwright.config.js tests/e2e/page_titles_8681.spec.js --trace off
 *
 * Screen-reader title announcements and two-tab switching are manual checks,
 * listed in documentation/architecture/decisions/D8681.md.
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
const NOW = '2026-11-27T12:00:00Z';
const SHELL_TITLE = 'StudioOS, the founder workspace — Axal VC StudioOS';

let server; let origin;
test.beforeAll(async () => {
  if (!existsSync(join(DOCS, 'index.html'))) throw new Error('docs/index.html is missing: run `npm run build` at the repo root first.');
  server = createServer((req, res) => {
    const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    let file = join(DOCS, path);
    if (!(file === DOCS || file.startsWith(DOCS + sep)) || !existsSync(file) || statSync(file).isDirectory()) {
      // A prerendered public route has its own index.html; anything else is the shell.
      const own = join(DOCS, path, 'index.html');
      file = (own.startsWith(DOCS + sep) && existsSync(own)) ? own : join(DOCS, 'index.html');
    }
    res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream' });
    res.end(readFileSync(file));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  origin = `http://127.0.0.1:${server.address().port}`;
});
test.afterAll(() => new Promise((r) => (server ? server.close(r) : r())));

const OPERATOR = { id: 8681, name: 'Synthetic HQ operator', email: 'hq@example.test', role: 'admin', is_super_admin: 1, kyc_status: 'approved' };

// The screens the issue names, the title each settles on, and the main heading it is checked against
// (HQ Home's h1 is "Platform" under the crumb "HQ · Home"; the tab names the HQ landing page).
const SCREENS = [
  ['/hq', 'HQ · Axal VC', /^Platform$/],
  ['/admin/hq-team', 'Team · HQ · Axal VC', /^Team$/],
  ['/admin/contracts', 'Contracts · Axal VC', /^Contracts$/],
  ['/admin/security', 'Security · Axal VC', /^Security$/],
  ['/admin/approvals', 'Approvals · Axal VC', /^Approvals$/],
  ['/research/companies', 'Companies · Research · Axal VC', /^Companies$/],
  ['/research/funds', 'Funds · Research · Axal VC', /^Funds$/],
  ['/help/tickets', 'Support tickets · Help · Axal VC', /tickets/i],
  ['/studio', 'Studio · Axal VC', /^Studio$/],
];

async function signIn(page) {
  await page.clock.setFixedTime(new Date(NOW));
  await page.addInitScript(({ user, consentVersion }) => {
    localStorage.setItem('token', 'synthetic-title-session');
    localStorage.setItem('user', JSON.stringify(user));
    localStorage.setItem('hqView', '1');
    localStorage.setItem('axal_cookie_consent_v1', JSON.stringify({ version: consentVersion, decided: true, categories: { essential: true } }));
    // Every title change, with its time since this document began (performance.now is not pinned by setFixedTime).
    window.__navAt = performance.now();
    window.__titles = [];
    const log = () => window.__titles.push({ at: performance.now(), title: document.title });
    new MutationObserver(log).observe(document, { subtree: true, childList: true, characterData: true });
  }, { user: OPERATOR, consentVersion: CONSENT_VERSION });
  await page.routeWebSocket(() => true, (ws) => ws.close());
  await page.route((u) => u.origin !== origin, (route) => route.abort());
  await page.route((u) => u.pathname.startsWith('/api/'), (route) => {
    const req = route.request();
    const p = new URL(req.url()).pathname;
    if (p === '/api/client-error') return route.fulfill({ status: 204, body: '' });
    // The shell's own writes (the pageview beacon, a ticket sync) are answered and not judged: this spec is about the title.
    if (req.method() !== 'GET') return route.fulfill({ status: 204, body: '' });
    if (p === '/api/auth/me' || p === '/api/me') return route.fulfill({ json: OPERATOR });
    if (p === '/api/onboarding/progress') return route.fulfill({ json: { completed_at: NOW } });
    return route.fulfill({ status: 404, json: { error: 'not_found' } });
  });
}

/** Same-tab navigation as the router's own links do it: push the address and let the router read it. */
const pushTo = (page, path) => page.evaluate((to) => {
  window.__navAt = performance.now();
  window.history.pushState({}, '', to);
  window.dispatchEvent(new PopStateEvent('popstate', { state: {} }));
}, path);

/**
 * Waits for `title`, then for the screen to settle (no request in flight and a
 * further 400 ms), and asserts the title did not move after it first arrived.
 * Returns the ms from `since` to the change, for the annotation.
 */
async function settlesOn(page, title, label) {
  await expect(page).toHaveTitle(title);
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(400);
  await expect(page).toHaveTitle(title);
  const ms = await page.evaluate((t) => {
    const since = window.__navAt ?? 0;
    const hit = window.__titles.find((e) => e.at >= since && e.title === t);
    const after = window.__titles.filter((e) => hit && e.at > hit.at && e.title !== t);
    return { ms: hit ? Math.round(hit.at - since) : null, moved: after.map((e) => e.title) };
  }, title);
  expect(ms.moved, `${label}: the title moved after it settled`).toEqual([]);
  const heading = (await page.locator('h1').first().textContent({ timeout: 2000 }).catch(() => null))?.trim() || 'no h1';
  test.info().annotations.push({ type: 'title-change', description: `${label} → "${title}" at ${ms.ms ?? 'load'} ms; h1 "${heading}"` });
  return heading;
}

test('a cold visit to each named screen settles on its own title', async ({ page }) => {
  await signIn(page);
  const seen = new Set();
  for (const [path, title, heading] of SCREENS) {
    await page.goto(`${origin}${path}`);
    expect(new URL(page.url()).pathname, `${path} was not redirected`).toBe(path);
    expect(await settlesOn(page, title, `cold ${path}`), `${path}: the main heading`).toMatch(heading);
    expect(title).not.toBe(SHELL_TITLE);
    seen.add(title);
  }
  expect(seen.size, 'no two named screens share a title').toBe(SCREENS.length);
});

test('same-tab navigation, Back and Forward, and Deals → HQ leave no stale title', async ({ page }) => {
  await signIn(page);
  await page.goto(`${origin}/admin/contracts`);
  await settlesOn(page, 'Contracts · Axal VC', 'cold /admin/contracts');
  await pushTo(page, '/admin/security');
  await settlesOn(page, 'Security · Axal VC', 'push /admin/security');
  await pushTo(page, '/deals');
  await settlesOn(page, 'Deal flow · Axal VC', 'push /deals');
  // The issue's case: HQ drew its own content under "Deal flow · Axal VC".
  await pushTo(page, '/hq');
  await settlesOn(page, 'HQ · Axal VC', 'push /hq after /deals');
  await pushTo(page, '/research/companies');
  await settlesOn(page, 'Companies · Research · Axal VC', 'push /research/companies');
  await pushTo(page, '/research/funds');
  await settlesOn(page, 'Funds · Research · Axal VC', 'push /research/funds');

  await page.evaluate(() => { window.__navAt = performance.now(); });
  await page.goBack();
  await settlesOn(page, 'Companies · Research · Axal VC', 'back to /research/companies');
  await page.evaluate(() => { window.__navAt = performance.now(); });
  await page.goBack();
  await settlesOn(page, 'HQ · Axal VC', 'back to /hq');
  await page.evaluate(() => { window.__navAt = performance.now(); });
  await page.goBack();
  await settlesOn(page, 'Deal flow · Axal VC', 'back to /deals');
  await page.evaluate(() => { window.__navAt = performance.now(); });
  await page.goForward();
  await settlesOn(page, 'HQ · Axal VC', 'forward to /hq');

  // A public page reached in the same tab takes the title its own HTML carries.
  await pushTo(page, '/terms');
  await settlesOn(page, 'Terms of Service — Axal VC StudioOS', 'push /terms');
  await pushTo(page, '/admin/contracts');
  await settlesOn(page, 'Contracts · Axal VC', 'push /admin/contracts after /terms');
});

test('a cold visit to a public route keeps its prerendered title; an unknown address names no screen', async ({ page }) => {
  await signIn(page);
  const res = await page.request.get(`${origin}/terms`);
  expect(await res.text()).toContain('<title>Terms of Service — Axal VC StudioOS</title>');
  await page.goto(`${origin}/privacy`);
  await settlesOn(page, 'Privacy Policy — Axal VC StudioOS', 'cold /privacy');
  // A redirect: the signed-in home forwards to the licence's landing page, which names itself.
  await page.goto(`${origin}/`);
  await expect(page).toHaveURL(`${origin}/studio`);
  await settlesOn(page, 'Studio · Axal VC', 'cold / redirected to /studio');
  await page.goto(`${origin}/no-such-screen-8681`);
  await settlesOn(page, 'Axal VC', 'cold unknown address');
});
