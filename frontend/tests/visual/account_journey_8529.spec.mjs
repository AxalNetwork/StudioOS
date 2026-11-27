/**
 * D8529 (#8529) — the whole account journey, end to end, in a real browser on the real Worker (`server.ts`), at
 * 1440 and 390 px: A creates a company, a project in it and a standalone project, and invites B; B opens the
 * invitation link from the harness's outbox (`_outbox.ts`; no email is sent), signs in, is returned to the
 * invitation, accepts it (exactly one seat), and opens the right project's settings; a reload keeps B there; A
 * changes the project's address and moves it into the company, and B's old link resolves to the new address; A
 * revokes B's seat, and B's tab shows no access.
 *
 * A acts through the real routes in A's own browser context, with A's session, as the app's client does. B's
 * sign-in is the harness's controlled one: the app sends B to `/login?next=…`, B's session is put in place on a page
 * no app runs on (D8785), and the `next` the app wrote is followed, so the deep link the app carried is what returns
 * B to the invitation. No outside provider,
 * no production account; every request off 127.0.0.1 is aborted.
 *
 *   npm run build                                                   (repo root)
 *   cd frontend && npx playwright test -c tests/visual/playwright.config.mjs account_journey_8529
 */
import { test, expect } from '@playwright/test';
import { CONSENT_VERSION } from '../../src/lib/cookieConsent.js';

const NOW = new Date('2026-10-20T10:00:00Z');
let journeys = null;
async function journeyFor(request, width) {
  if (!journeys) journeys = (await (await request.get('/__visual/manifest')).json()).journey;
  const j = journeys.find((x) => x.width === width);
  if (!j) throw new Error(`D8529: no seeded journey at ${width}`);
  return j;
}

/** A context with the cookie banner decided and every outside request aborted; signed in as `account` if given. */
async function contextFor(browser, width, account = null) {
  const context = await browser.newContext({ viewport: { width, height: 900 }, baseURL: test.info().project.use.baseURL, serviceWorkers: 'block', reducedMotion: 'reduce', locale: 'en-US', timezoneId: 'UTC' });
  await context.addInitScript(({ account, consentVersion }) => {
    try {
      if (account && !localStorage.getItem('token')) {
        localStorage.setItem('token', account.token);
        localStorage.setItem('user', JSON.stringify(account.user));
      }
      localStorage.setItem('axal_cookie_consent_v1', JSON.stringify({ version: consentVersion, decided: true, updatedAt: '2026-10-20T00:00:00Z', categories: { essential: true } }));
    } catch { /* storage off: the spec fails on sign-in, loudly */ }
  }, { account, consentVersion: CONSENT_VERSION });
  await context.route((url) => url.hostname !== '127.0.0.1', (route) => route.abort('blockedbyclient'));
  const page = await context.newPage();
  await page.clock.setFixedTime(NOW);
  return { context, page };
}

/** One of A's acts through the real route, with A's session. */
async function asA(ctx, j, method, path, body, company = null) {
  const headers = { Authorization: `Bearer ${j.a.token}`, 'Content-Type': 'application/json', ...(company ? { 'X-Company-Id': String(company) } : {}) };
  const r = await ctx.request.fetch(path, { method, headers, ...(body ? { data: body } : {}) });
  const text = await r.text();
  expect(r.status(), `${method} ${path}: ${text}`).toBeLessThan(300);
  try { return JSON.parse(text); } catch { return text; }
}

for (const width of [1440, 390]) {
  test(`the account journey at ${width}px: sign-in, company, projects, an accepted invitation, the right settings, a moved address and a revoked seat`, async ({ browser, request }) => {
    const j = await journeyFor(request, width);
    const A = await contextFor(browser, width, j.a);
    const B = await contextFor(browser, width);
    try {
      // D8691 (#8691): both accounts finished onboarding, the Terms included. Reading the trust record seeds what an
      // account owes, as the Account page's trust strip does at 1440px; after it neither account owes the Terms, so
      // no page of the journey can be replaced by the terms screen, at either width, however long a page lives.
      for (const who of [j.a, j.b]) {
        const headers = { Authorization: `Bearer ${who.token}` };
        expect((await request.get('/api/trust/me', { headers })).status(), 'the trust record reads').toBe(200);
        const me = await (await request.get('/api/auth/me', { headers })).json();
        expect(me.terms_acceptance_pending, `${who.user.email} owes no acceptance of the Terms`).toBe(false);
      }

      // 1. A creates a company, a project inside it and a standalone project.
      const created = await asA(A.context, j, 'POST', '/api/company/create', { company_name: `Journey Company ${width}` });
      const company = created.company ?? created;
      expect(company.id ?? company.company_id, JSON.stringify(created)).toBeTruthy();
      const companyId = Number(company.id ?? company.company_id);
      const inside = await asA(A.context, j, 'POST', '/api/projects', { name: `Journey Inside ${width}` }, companyId);
      const solo = await asA(A.context, j, 'POST', '/api/projects', { name: `Journey Solo ${width}` });
      const soloId = Number((solo.project ?? solo).id);
      const insideRow = await asA(A.context, j, 'GET', `/api/projects/${Number((inside.project ?? inside).id)}`);
      expect(Number(insideRow.company_id), 'the project inside the company sits in it').toBe(companyId);
      const soloRow = await asA(A.context, j, 'GET', `/api/projects/${soloId}`);
      expect(soloRow.company_id ?? null, 'the standalone project sits in no company').toBeNull();

      // 2. A invites B by email; the link is read from the harness's outbox.
      const invited = await asA(A.context, j, 'POST', `/api/projects/${soloId}/invitations`, { mode: 'email', email: j.b.user.email, role: 'cofounder' });
      expect(invited.email_sent, 'the mailer ran into the outbox').toBe(true);
      const mail = await (await request.get(`/__visual/outbox?to=${encodeURIComponent(j.b.user.email)}`)).json();
      const link = mail.flatMap((m) => m.links).find((l) => l.includes('/projects/invitations/accept?token='));
      expect(link, JSON.stringify(mail)).toBeTruthy();
      const linkPath = new URL(link).pathname + new URL(link).search;

      // 3. B opens the link signed out, signs in, and the deep link returns B to the invitation, which is accepted.
      await B.page.goto(linkPath);
      await B.page.getByRole('link', { name: /Sign in to accept/ }).click();
      await expect(B.page).toHaveURL(/\/login\?/);
      const next = new URL(B.page.url()).searchParams.get('next');
      expect(next, 'the app carried the invitation to sign-in').toBe(linkPath.replace(/token=([^&]+)/, (_m, t) => `token=${encodeURIComponent(decodeURIComponent(t))}`));
      // D8785 (#8785): B's session is put in place on a page no app runs on, never on the live /login. The router
      // commits /login in a transition, after the address has changed, so the URL check above can pass first; a
      // session written before that commit is a signed-in visitor arriving at /login, whom AuthScreen signs out
      // (`clearSession`, then `POST /api/auth/logout`). B then reached the invitation signed out, and the journey
      // waited 60 s for an Open button the page never draws.
      await B.page.goto('/__visual/manifest');
      await B.page.evaluate(({ token, user }) => { localStorage.setItem('token', token); localStorage.setItem('user', JSON.stringify(user)); }, { token: j.b.token, user: j.b.user });
      await B.page.goto(next);
      const open = B.page.getByRole('button', { name: /Open project|Go to project|Open/ });
      const signedOut = B.page.getByRole('link', { name: /Sign in to accept/ });
      const refused = B.page.getByRole('link', { name: 'Go to dashboard' });
      // Whichever the page settles on: a signed-out or refused arrival fails here at once, by name, not on a timeout.
      await expect(open.or(signedOut).or(refused)).toBeVisible({ timeout: 60_000 });
      await expect(signedOut, 'B arrives at the invitation signed in').toHaveCount(0);
      await expect(refused, 'the invitation is accepted, not refused').toHaveCount(0);
      await expect(open).toBeVisible();
      const roster = await asA(A.context, j, 'GET', `/api/projects/${soloId}/members`);
      expect(roster.members.filter((m) => Number(m.user_id) === Number(j.b.user.id)).length, 'exactly one seat').toBe(1);
      await open.click();
      await expect(B.page).toHaveURL(new RegExp(`/projects/${soloId}(?:$|[/?#])`));

      // B opens the right project's settings; a reload keeps B in the same place.
      await B.page.goto(`/projects/${soloId}/settings`);
      await expect(B.page.getByTestId('project-settings-general')).toContainText(`Journey Solo ${width}`, { timeout: 60_000 });
      await B.page.reload();
      await expect(B.page).toHaveURL(new RegExp(`/projects/${soloId}/settings`));
      await expect(B.page.getByTestId('project-settings-general')).toContainText(`Journey Solo ${width}`, { timeout: 60_000 });

      // 4. A changes the project's address and moves it into the company; B's old link resolves to the new address.
      // B's old link is the project's first address, which B opens while it is still standalone.
      const oldSlug = `journey-solo-${width}`;
      await asA(A.context, j, 'PUT', `/api/projects/${soloId}/slug`, { slug: oldSlug });
      await B.page.goto(`/p/${oldSlug}`);
      await expect(B.page).toHaveURL(new RegExp(`/projects/${soloId}(?:$|[/?#])`), { timeout: 60_000 });
      const before = await asA(A.context, j, 'GET', `/api/projects/${soloId}`);
      expect(before.slug).toBe(oldSlug);
      const renamed = await asA(A.context, j, 'PUT', `/api/projects/${soloId}/slug`, { slug: `journey-renamed-${width}` });
      await asA(A.context, j, 'POST', `/api/projects/${soloId}/move`, { company_id: companyId });
      expect(renamed.previous_slug ?? null).toBe(before.slug ?? null);
      // The app resolves an address (`PortfolioAddress`) to the venture's page; the old one must land on the same
      // venture as the new one, now that it has another slug and sits in the company.
      const after = await asA(A.context, j, 'GET', `/api/projects/${soloId}`);
      expect(Number(after.company_id), 'moved into the company').toBe(companyId);
      const landing = new RegExp(`/projects/${soloId}(?:$|[/?#])`);
      await B.page.goto(renamed.path);
      await expect(B.page).toHaveURL(landing, { timeout: 60_000 });
      await B.page.goto(`/p/${oldSlug}`);
      await expect(B.page, 'the old link resolves to the venture at its new address').toHaveURL(landing, { timeout: 60_000 });

      // 5. A revokes B's seat; B's tab shows no access on its next read.
      await asA(A.context, j, 'DELETE', `/api/projects/${soloId}/members/${j.b.user.id}`);
      await B.page.goto(`/projects/${soloId}/settings`);
      await expect(B.page.getByRole('alert')).toContainText('could not be read', { timeout: 60_000 });
      await expect(B.page.getByTestId('project-settings-no-access'), 'a refusal, not a failed read').toHaveAttribute('data-no-access', 'true');
      await expect(B.page.getByTestId('project-settings-general')).toHaveCount(0);
    } finally { await A.context.close(); await B.context.close(); }
  });
}
