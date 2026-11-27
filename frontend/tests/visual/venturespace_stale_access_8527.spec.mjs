/**
 * D8527 (#8527) — a member's access changes while a VentureSpace's settings are open, in a real browser on the real
 * Worker (`server.ts`, seeded by `_venturespace_seed.ts`), at 1440 and 390 px. Two accounts, two browser contexts:
 * A owns the company and the venture; B is a member of the company with a co-founder seat, and opens the venture's
 * settings (`/projects/:id/settings`). C is a third account with no access.
 *
 *   revoke   A removes B's seat. Without a reload, B's next read (coming back to the tab) shows no access and the
 *            settings are gone; a write B sends from the open page is refused, and so is the download B had open.
 *   late     one of B's settings reads leaves before the revocation and is held; B's next read, after it, shows no
 *            access; the held answer is then released and must not bring the old view back.
 *   archive  A archives the company; B's next read shows what the Worker now grants, whatever company B selected.
 *   move     A moves the venture to the other company; the same.
 *   switch   in one context B signs out and C signs in: C sees none of B's company selection or cached data, and B's
 *            read still in flight never lands in C's view.
 *   back     B leaves the settings, A removes the seat, and Browser Back does not show the cached settings.
 *
 * No production account, no email, no network: every request off 127.0.0.1 is aborted.
 *
 *   npm run build                                                   (repo root)
 *   cd frontend && npx playwright test -c tests/visual/playwright.config.mjs venturespace_stale_access_8527
 */
import { test, expect } from '@playwright/test';
import { CONSENT_VERSION } from '../../src/lib/cookieConsent.js';

const NOW = new Date('2026-10-20T10:00:00Z');
let cases = null;
async function caseOf(request, scenario, width) {
  if (!cases) cases = (await (await request.get('/__visual/manifest')).json()).venturespace;
  const c = cases.find((x) => x.scenario === scenario && x.width === width);
  if (!c) throw new Error(`D8527: no seeded case for ${scenario} at ${width}`);
  return c;
}

/** A browser context signed in as `account`, with the cookie banner decided and every outside request aborted. */
async function signedIn(browser, account, width, { company = null } = {}) {
  const context = await browser.newContext({ viewport: { width, height: 900 }, baseURL: test.info().project.use.baseURL, serviceWorkers: 'block', reducedMotion: 'reduce', locale: 'en-US', timezoneId: 'UTC' });
  await context.addInitScript(({ token, user, consentVersion, company }) => {
    try {
      if (!localStorage.getItem('d8527-signed-out')) {
        localStorage.setItem('token', token);
        localStorage.setItem('user', JSON.stringify(user));
        if (company != null && !localStorage.getItem('active_company_id')) localStorage.setItem('active_company_id', String(company));
      }
      localStorage.setItem('axal_cookie_consent_v1', JSON.stringify({ version: consentVersion, decided: true, updatedAt: '2026-10-20T00:00:00Z', categories: { essential: true } }));
    } catch { /* storage off: the spec fails on sign-in, loudly */ }
  }, { token: account.token, user: account.user, consentVersion: CONSENT_VERSION, company });
  await context.route((url) => url.hostname !== '127.0.0.1', (route) => route.abort('blockedbyclient'));
  const page = await context.newPage();
  await page.clock.setFixedTime(NOW);
  return { context, page };
}

/** A's own act, through the real route with A's session (A's context). */
async function asA(ctx, c, method, path, body) {
  const r = await ctx.request.fetch(path, { method, headers: { Authorization: `Bearer ${c.a.token}`, 'Content-Type': 'application/json' }, ...(body ? { data: body } : {}) });
  expect(r.status(), `${method} ${path}: ${await r.text()}`).toBeLessThan(300);
}
const revoke = (ctx, c) => asA(ctx, c, 'DELETE', `/api/projects/${c.projectId}/members/${c.b.user.id}`);

/** What the Worker grants B on the venture right now: the settings read, sent as the page sends it. */
async function grantedNow(page, c) {
  return page.evaluate(async (id) => {
    const h = { Authorization: `Bearer ${localStorage.getItem('token')}` };
    const co = localStorage.getItem('active_company_id');
    if (co) h['X-Company-Id'] = co;
    return (await fetch(`/api/projects/${id}`, { headers: h })).status === 200;
  }, c.projectId);
}

/** A write and a download sent from B's open page, with B's session and selection, as the app sends them. */
async function fromPage(page, method, path, body) {
  return page.evaluate(async ({ method, path, body }) => {
    const h = { Authorization: `Bearer ${localStorage.getItem('token')}`, 'Content-Type': 'application/json' };
    const co = localStorage.getItem('active_company_id');
    if (co) h['X-Company-Id'] = co;
    return (await fetch(path, { method, headers: h, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })).status;
  }, { method, path, body });
}

const settings = (page) => page.getByTestId('project-settings');
const noAccess = (page) => page.getByTestId('project-settings-no-access');
async function openSettings(page, c) {
  await page.goto(`/projects/${c.projectId}/settings`);
  await expect(settings(page)).toHaveAttribute('data-scope', 'company_project', { timeout: 60_000 });
  await expect(page.getByTestId('project-settings-general')).toContainText(c.projectName);
}
/** Coming back to the tab: the page's next read. */
const nextRead = (page) => page.evaluate(() => window.dispatchEvent(new Event('focus')));
async function shownNoAccess(page, c) {
  await expect(noAccess(page)).toHaveAttribute('data-no-access', 'true');
  await expect(settings(page)).toHaveCount(0);
  await expect(page.getByText(c.projectName, { exact: false })).toHaveCount(0);
}
/** Holds the next settings read: its answer is taken from the Worker now and released when asked. */
async function holdNextRead(page, c) {
  let release; const released = new Promise((r) => { release = r; });
  let armed = true; let held = null;
  const caught = new Promise((resolve) => {
    page.route(`**/api/projects/${c.projectId}`, async (route) => {
      if (!armed || route.request().method() !== 'GET') return route.continue();
      armed = false;
      held = await route.fetch();
      resolve();
      await released;
      await route.fulfill({ response: held });
    });
  });
  return { caught, release: () => release(), status: () => held?.status() };
}

for (const width of [1440, 390]) {
  test.describe(`stale VentureSpace access at ${width}px`, () => {
    test('revoke: the next read shows no access, and a write and a download from the open page are refused', async ({ browser, request }) => {
      const c = await caseOf(request, 'revoke', width);
      const A = await signedIn(browser, c.a, width);
      const B = await signedIn(browser, c.b, width, { company: c.north.id });
      try {
        await openSettings(B.page, c);
        expect(await fromPage(B.page, 'POST', `/api/data-room/${c.projectUid}/files/${c.fileUid}/download`)).toBe(200);
        await revoke(A.context, c);
        expect(await fromPage(B.page, 'POST', `/api/captable/record/${c.projectId}/proposals`, {}), 'the write B sends after the revoke').toBeGreaterThanOrEqual(403);
        expect(await fromPage(B.page, 'POST', `/api/data-room/${c.projectUid}/files/${c.fileUid}/download`), 'the download B had open').toBe(404);
        await nextRead(B.page);
        await shownNoAccess(B.page, c);
      } finally { await A.context.close(); await B.context.close(); }
    });

    test('late: a read that left before the revoke never repaints the old view', async ({ browser, request }) => {
      const c = await caseOf(request, 'late', width);
      const A = await signedIn(browser, c.a, width);
      const B = await signedIn(browser, c.b, width, { company: c.north.id });
      try {
        await openSettings(B.page, c);
        const late = await holdNextRead(B.page, c);
        await nextRead(B.page);
        await late.caught;
        expect(late.status(), 'the held read was answered before the revoke').toBe(200);
        await revoke(A.context, c);
        await nextRead(B.page);
        await shownNoAccess(B.page, c);
        late.release();
        // The old answer arrives now. Give it every chance to land, then hold the page to the no-access view.
        await B.page.waitForTimeout(500);
        await B.page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
        await shownNoAccess(B.page, c);
      } finally { await A.context.close(); await B.context.close(); }
    });

    for (const [scenario, act] of [
      ['archive', (ctx, c) => asA(ctx, c, 'POST', `/api/company/${c.north.uid}/archive`)],
      ['move', (ctx, c) => asA(ctx, c, 'POST', `/api/projects/${c.projectId}/move`, { company_id: c.south.id })],
    ]) {
      test(`${scenario}: the next read shows what the Worker now grants, whatever company B selected`, async ({ browser, request }) => {
        const c = await caseOf(request, scenario, width);
        const A = await signedIn(browser, c.a, width);
        const B = await signedIn(browser, c.b, width, { company: c.north.id });
        try {
          await openSettings(B.page, c);
          await act(A.context, c);
          const granted = await grantedNow(B.page, c);
          await nextRead(B.page);
          if (granted) await expect(settings(B.page)).toBeVisible();
          else await shownNoAccess(B.page, c);
          // Revoking the seat afterwards is refused on the very next read, whatever the selection still names.
          await revoke(A.context, c);
          await nextRead(B.page);
          await shownNoAccess(B.page, c);
        } finally { await A.context.close(); await B.context.close(); }
      });
    }

    test('switch: B signs out and C signs in: none of B\'s selection, data or late reads reach C', async ({ browser, request }) => {
      const c = await caseOf(request, 'switch', width);
      const B = await signedIn(browser, c.b, width, { company: c.north.id });
      try {
        await openSettings(B.page, c);
        const late = await holdNextRead(B.page, c);
        await nextRead(B.page);
        await late.caught;
        // B signs out the way the app does (App.jsx `logout`), then C signs in on the same browser.
        await B.page.evaluate(({ token, user }) => {
          localStorage.setItem('d8527-signed-out', '1');
          for (const k of ['token', 'user', 'realUser', 'realToken', 'viewMode', 'active_company_id']) localStorage.removeItem(k);
          localStorage.setItem('token', token);
          localStorage.setItem('user', JSON.stringify(user));
        }, { token: c.c.token, user: c.c.user });
        await B.page.goto(`/projects/${c.projectId}/settings`);
        late.release();
        await expect(noAccess(B.page)).toHaveAttribute('data-no-access', 'true', { timeout: 60_000 });
        await B.page.waitForTimeout(500);
        await shownNoAccess(B.page, c);
        expect(await B.page.evaluate(() => localStorage.getItem('active_company_id'))).toBeNull();
        expect(await B.page.evaluate(() => JSON.parse(localStorage.getItem('user') || 'null')?.id)).toBe(c.c.user.id);
      } finally { await B.context.close(); }
    });

    test('back: Browser Back after the revocation does not show the cached settings', async ({ browser, request }) => {
      const c = await caseOf(request, 'back', width);
      const A = await signedIn(browser, c.a, width);
      const B = await signedIn(browser, c.b, width, { company: c.north.id });
      try {
        await openSettings(B.page, c);
        await B.page.getByTestId('project-settings-open-work').click();
        await expect(B.page).toHaveURL(new RegExp(`/projects/${c.projectId}/work`));
        // Work is a lazy route: React keeps the settings on screen until its chunk is in. Only once Work is drawn has
        // B really left the settings, which is what Back must not bring back unread.
        await expect(B.page.getByTestId('work-page')).toBeVisible({ timeout: 60_000 });
        await expect(settings(B.page)).toHaveCount(0);
        await revoke(A.context, c);
        await B.page.goBack();
        await expect(B.page).toHaveURL(new RegExp(`/projects/${c.projectId}/settings`));
        await shownNoAccess(B.page, c);
      } finally { await A.context.close(); await B.context.close(); }
    });
  });
}
