/**
 * #4580 (D4580, part 2): the return to Grow after each Sign In v2 method (#6958, D6957), in a real browser at 1440
 * and 390 px. A signed-out visitor opens a Grow page with a query and a fragment, `/grow/talent?tab=open#roles`, and
 * comes back to exactly that page after: the email link (returning member, and a new member who must finish setup
 * first), an authenticator code, a passkey, Apple and Google, and after an expired link, a refused code, a cancelled
 * passkey and a cancelled provider, each retried.
 *
 * NO PREVIEW, NO ACCOUNT, NO EMAIL. `startLocalWorker()` (`_helpers.js`, #8537) serves the built SPA and answers the
 * email link as `cloudflare-worker/src/routes/auth.ts` does, with the link written to its in-memory outbox; the spec
 * opens it as the person would from their inbox, so that return is the app's own, end to end. The other methods are
 * answered here with `page.route`: `/api/auth/login`, the two passkey calls, Apple's and Google's config and start,
 * and each provider's callback (a `/__provider/<name>` page that redirects as the Worker's callback does, with
 * `routes/auth_apple.ts`' and `routes/auth_google.ts`' error shapes). When one of them succeeds, the browser is given
 * a real session of the local Worker (an email link spent in Node, never shown to the page), so the landing is the
 * signed-in app, not a placeholder. WebAuthn is a stand-in `navigator.credentials.get`; Turnstile is
 * `controlledBrowser`'s. These prove what the page sends and where it goes with each answer, never that Apple, Google
 * or a mailbox answer that way: the live checks stay deferred on #4580 (owner, 2026-11-15, answer B).
 *
 *   npm run build                                   (repo root)
 *   cd frontend && npx --no-install playwright test -c playwright.config.js tests/e2e/grow_return_4580.spec.js --trace off
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { CONSENT_VERSION } from '../../src/lib/cookieConsent.js';
import { MAGIC_LANDING, controlledBrowser, startLocalWorker } from './_helpers.js';

const DESTINATION = '/grow/talent?tab=open#roles';
const NEXT = `next=${encodeURIComponent(DESTINATION)}`;
const ROLES = { roles: [], applicants: [], items: [] };

/**
 * Where a provider's callback lands: `routes/auth_google.ts` `withLandingMarker` (D4580 part 2), used by both
 * callbacks. The marker goes in the query and the fragment stays last; the first test reads the Worker to hold this.
 */
const withLandingMarker = (landing, marker) => {
  const at = landing.indexOf('#');
  const path = at === -1 ? landing : landing.slice(0, at);
  return `${path}${path.includes('?') ? '&' : '?'}${marker}${at === -1 ? '' : landing.slice(at)}`;
};

const here = (page) => { const u = new URL(page.url()); return u.pathname + u.search + u.hash; };
const kept = (page) => page.evaluate(() => { try { return JSON.parse(localStorage.getItem('gvpn:next') || 'null')?.path ?? null; } catch { return null; } });
const keptForSetup = (page) => page.evaluate(() => { try { return JSON.parse(localStorage.getItem('gvpn:after-setup') || 'null')?.path ?? null; } catch { return null; } });
const surface = (page) => page.getByTestId('signin-surface');
const heading = (page) => surface(page).getByRole('heading', { level: 1 });

/** A refused field: its message is alert text, and the field is invalid and names it. */
async function refused(page, label, text) {
  const field = surface(page).getByLabel(label, { exact: true });
  await expect(page.locator('#login-error')).toHaveText(text);
  await expect(page.locator('#login-error')).toHaveAttribute('role', 'alert');
  await expect(field).toHaveAttribute('aria-invalid', 'true');
  expect((await field.getAttribute('aria-describedby') || '').split(/\s+/)).toContain('login-error');
}

/**
 * Signed in on Grow's Talent page at the exact destination (path, query and fragment; a provider's marker in the
 * query), the page drawn by the signed-in app, still there once it has settled, and the kept copy spent.
 */
async function arrived(page, expected = DESTINATION) {
  await expect.poll(() => here(page), { timeout: 15_000 }).toBe(expected);
  await expect(page.getByRole('heading', { level: 1, name: 'Talent', exact: true })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('navigation', { name: 'Grow sections' })).toBeVisible();
  await expect(page.locator('#login-email')).toHaveCount(0);
  expect(here(page), 'not sent away once the app settled').toBe(expected);
  expect(await kept(page), 'the kept destination is spent once').toBeNull();
}

test('the provider landings mirrored here are the Worker\'s', () => {
  const read = (f) => readFileSync(fileURLToPath(new URL(`../../../cloudflare-worker/src/routes/${f}`, import.meta.url)), 'utf8');
  const google = read('auth_google.ts');
  const apple = read('auth_apple.ts');
  expect(google).toContain("withLandingMarker(landing, `google=ok${newSignup ? '&google_signup=1' : ''}`)");
  expect(apple).toContain("withLandingMarker(landing, `apple=ok${resolved.newSignup ? '&apple_signup=1' : ''}`)");
  // auth_apple.ts backWithError keeps the destination as `next`; auth_google.ts callbackError keeps none.
  expect(apple).toContain("if (action === 'signin' && redirect && redirect !== '/dashboard') qs.set('next', redirect);");
  expect(google).toContain('const url = `${appUrl(env)}${path}?google_error=${encodeURIComponent(code)}`;');
  expect(withLandingMarker(DESTINATION, 'google=ok')).toBe('/grow/talent?tab=open&google=ok#roles');
  expect(MAGIC_LANDING.signin).toBe('/dashboard?magic=ok');
});

for (const [width, height, label] of [[1440, 900, 'desktop'], [390, 844, 'phone']]) {
  test.describe(`Grow return, ${label} (${width}px)`, () => {
    test.use({ viewport: { width, height }, reducedMotion: 'reduce' });
    test.setTimeout(90_000);
    let worker;
    let seen;
    let o;
    const email = `member.${width}@example.test`;

    /**
     * A session of the local Worker for `address`, put in the browser: what a provider's callback or `/auth/login`
     * sets when it succeeds. The link is spent here in Node and never reaches the page or its outbox reads.
     */
    async function signInBrowser(context, address) {
      await fetch(`${worker.origin}/api/auth/magic/start`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: address }) });
      const res = await fetch(worker.linkFor(address), { redirect: 'manual' });
      worker.outbox.length = 0;
      const cookies = res.headers.getSetCookie().map((c) => c.split(';')[0].split('='));
      await context.addCookies(cookies.map(([name, value]) => ({ name, value, url: worker.origin })));
    }

    test.beforeEach(async ({ context, page }) => {
      worker = await startLocalWorker({ handle: ({ path, user }) => (user && path.startsWith('/api/') && /talent|roles|jobs/.test(path) ? { json: ROLES } : null) });
      await controlledBrowser(context, worker.origin, CONSENT_VERSION);
      worker.addAccount({ email, name: 'Synthetic Founder', role: 'founder' });
      seen = [];
      const json = (route, status, body) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
      const record = (route) => {
        const r = route.request();
        const url = new URL(r.url());
        let body = null;
        try { body = r.postDataJSON(); } catch { body = null; }
        seen.push({ path: url.pathname, query: Object.fromEntries(url.searchParams), body });
        return url;
      };
      o = { appleOutcome: 'ok', googleOutcome: 'ok', totp: '482913' };
      await page.addInitScript(() => {
        const b = (s) => new TextEncoder().encode(s).buffer;
        navigator.credentials.get = async () => {
          if (window.__passkey === 'cancel') throw new DOMException('The operation either timed out or was not allowed.', 'NotAllowedError');
          return {
            id: 'c3ludGhldGljLWNyZWQ', rawId: b('synthetic-cred'), type: 'public-key', authenticatorAttachment: 'platform',
            response: { authenticatorData: b('ad'), clientDataJSON: b('{}'), signature: b('sig'), userHandle: b('u4580') },
            getClientExtensionResults: () => ({}),
          };
        };
      });
      await page.route('**/api/auth/apple/config', (route) => { record(route); return json(route, 200, { configured: true }); });
      await page.route('**/api/auth/google/config*', (route) => { record(route); return json(route, 200, { popup: false }); });
      for (const provider of ['apple', 'google']) {
        await page.route(`**/api/auth/${provider}/start*`, (route) => {
          const url = record(route);
          const back = new URL(`/__provider/${provider}`, url.origin);
          back.searchParams.set('redirect', url.searchParams.get('redirect') || '');
          return json(route, 200, { url: back.toString() });
        });
      }
      // The provider answers for the person; the Worker's callback then redirects as its route does.
      await page.route('**/__provider/*', async (route) => {
        const url = new URL(route.request().url());
        const provider = url.pathname.endsWith('apple') ? 'apple' : 'google';
        const redirect = url.searchParams.get('redirect') || '/dashboard';
        const outcome = o[`${provider}Outcome`];
        if (outcome === 'ok') {
          await signInBrowser(page.context(), email);
          return route.fulfill({ status: 303, headers: { location: withLandingMarker(redirect, `${provider}=ok`) } });
        }
        // auth_apple.ts backWithError keeps the destination as `next`; auth_google.ts callbackError keeps none.
        const qs = new URLSearchParams({ [`${provider}_error`]: outcome });
        if (provider === 'apple' && redirect !== '/dashboard') qs.set('next', redirect);
        return route.fulfill({ status: 303, headers: { location: `/login?${qs}` } });
      });
      await page.route('**/api/auth/login', async (route) => {
        record(route);
        if (route.request().postDataJSON()?.totp_code !== o.totp) return json(route, 401, { error: 'Invalid TOTP code' });
        await signInBrowser(page.context(), email);
        return json(route, 200, { token: 'synthetic-4580-session', user: worker.account(email) });
      });
      await page.route('**/api/auth/passkey/auth-options', (route) => {
        record(route);
        return json(route, 200, { challenge: 'c3ludGhldGljLWNoYWxsZW5nZQ', rpId: '127.0.0.1', timeout: 60000, userVerification: 'preferred', allowCredentials: [] });
      });
      await page.route('**/api/auth/passkey/auth-verify', async (route) => {
        record(route);
        await signInBrowser(page.context(), email);
        return json(route, 200, { token: 'synthetic-4580-session', user: worker.account(email) });
      });
    });
    test.afterEach(async ({ page }) => {
      if (!page.isClosed()) await page.unrouteAll({ behavior: 'ignoreErrors' });
      await worker?.close();
    });

    /** Grow, signed out: the guard keeps the whole destination and the chooser says where it leads. */
    async function openGrowSignedOut(page) {
      await page.goto(`${worker.origin}${DESTINATION}`);
      await expect(page).toHaveURL(`${worker.origin}/login?${NEXT}`);
      await expect(heading(page)).toHaveText('Sign in to continue to Grow');
      await expect(surface(page).getByRole('button', { name: 'Continue with Apple' })).toBeVisible();
      await expect(surface(page).getByRole('button', { name: /^Continue with / })).toHaveText(['Continue with Email', 'Continue with Apple', 'Continue with Google']);
      expect(await kept(page)).toBe(DESTINATION);
    }

    test('email link: Continue with Email → link → the address refused until valid → the link returns to Grow', async ({ page }) => {
      await openGrowSignedOut(page);
      await surface(page).getByRole('button', { name: 'Continue with Email' }).click();
      await expect(heading(page)).toHaveText('Sign in with email');
      expect(new URL(page.url()).searchParams.get('next')).toBe(DESTINATION);
      await expect(surface(page).getByTestId('login-destination-short')).toContainText('After sign-in: Grow');
      await page.locator('#signin-method-link').click();
      await expect(heading(page)).toHaveText('Email me a sign-in link');
      const send = surface(page).getByRole('button', { name: 'Send sign-in link', exact: true });
      await send.click();
      await refused(page, 'Email', 'Enter your email.');
      await surface(page).getByLabel('Email', { exact: true }).fill('not-an-address');
      await surface(page).getByLabel('Email', { exact: true }).press('Enter');
      await refused(page, 'Email', 'Enter a valid email address (e.g. you@example.com).');
      expect(worker.requests.filter((r) => r.path === '/api/auth/magic/start'), 'a refused address sends nothing').toEqual([]);
      await surface(page).getByLabel('Email', { exact: true }).fill(email);
      await send.click();
      await expect(heading(page)).toHaveText('Check your email');
      await expect(surface(page).getByText(`Sign-in link sent to ${email}.`, { exact: true })).toBeVisible();
      expect(worker.outbox).toEqual([expect.objectContaining({ to: email, purpose: 'signin' })]);
      // The inbox: auth.ts lands every link on /dashboard?magic=ok; the kept copy takes it on to Grow.
      await page.goto(worker.linkFor(email));
      await arrived(page);
      expect(worker.requests.some((r) => r.path === '/api/auth/me' && r.signedIn)).toBe(true);
      await page.screenshot({ path: test.info().outputPath('grow-after-email-link.png'), fullPage: true });
    });

    test('expired link: the retry view keeps Grow, and the new link returns there', async ({ page }) => {
      await openGrowSignedOut(page);
      await surface(page).getByRole('button', { name: 'Continue with Email' }).click();
      await page.locator('#signin-method-link').click();
      await surface(page).getByLabel('Email', { exact: true }).fill(email);
      await surface(page).getByRole('button', { name: 'Send sign-in link', exact: true }).click();
      await expect(heading(page)).toHaveText('Check your email');
      const link = worker.linkFor(email);
      // Spent elsewhere first (another tab, a mail scanner): opening it here is an expired link.
      await fetch(link, { redirect: 'manual' });
      await page.goto(link);
      await expect(page).toHaveURL(`${worker.origin}/login?step=link`);
      await expect(heading(page)).toHaveText('Email me a sign-in link');
      await expect(surface(page).getByRole('alert')).toHaveText('That sign-in link has expired or was already used. Send a new one.');
      expect(await kept(page), 'the Worker drops ?next=, the kept copy does not').toBe(DESTINATION);
      await surface(page).getByLabel('Email', { exact: true }).fill(email);
      await surface(page).getByRole('button', { name: 'Send sign-in link', exact: true }).click();
      await expect(heading(page)).toHaveText('Check your email');
      expect(worker.outbox.filter((m) => m.to === email)).toHaveLength(2);
      await page.goto(worker.linkFor(email));
      await arrived(page);
      await page.screenshot({ path: test.info().outputPath('grow-after-expired-link.png'), fullPage: true });
    });

    test('authenticator code: refused until complete, a wrong code retried, then Grow', async ({ page }) => {
      await openGrowSignedOut(page);
      await surface(page).getByRole('button', { name: 'Continue with Email' }).click();
      await surface(page).getByRole('button', { name: /Use an authenticator code/ }).click();
      await expect(heading(page)).toHaveText('Use an authenticator code');
      const code = surface(page).getByLabel('6-digit code');
      const submit = surface(page).getByRole('button', { name: 'Sign in', exact: true });
      await surface(page).getByLabel('Email', { exact: true }).fill('not-an-address');
      await code.fill('482913');
      await submit.click();
      await refused(page, 'Email', 'Enter a valid email address (e.g. you@example.com).');
      await surface(page).getByLabel('Email', { exact: true }).fill(email);
      await code.fill('12');
      await expect(submit, 'a short code cannot be sent').toBeDisabled();
      await code.press('Enter');
      expect(seen.filter((s) => s.path === '/api/auth/login'), 'nothing is sent until the form is complete').toEqual([]);
      await code.fill('111111');
      await submit.click();
      await expect(surface(page).getByRole('alert')).toHaveText('Invalid TOTP code');
      await expect(code).toHaveValue('');
      expect(new URL(page.url()).searchParams.get('next')).toBe(DESTINATION);
      await code.fill('482913');
      await submit.click();
      await arrived(page);
      expect(seen.filter((s) => s.path === '/api/auth/login').map((s) => s.body.totp_code)).toEqual(['111111', '482913']);
    });

    test('passkey: a cancelled prompt returns to the methods with Grow kept, the next try returns to Grow', async ({ page }) => {
      await page.addInitScript(() => { window.__passkey = 'cancel'; });
      await openGrowSignedOut(page);
      await surface(page).getByRole('button', { name: 'Continue with Email' }).click();
      await surface(page).getByRole('button', { name: /Use a passkey/ }).click();
      await expect(heading(page)).toHaveText('Sign in with email');
      await expect(surface(page).getByRole('status').filter({ hasText: 'Passkey sign-in was cancelled. Nothing was changed.' })).toBeVisible();
      await expect(surface(page).getByTestId('login-destination-short')).toContainText('After sign-in: Grow');
      expect(new URL(page.url()).searchParams.get('next')).toBe(DESTINATION);
      await page.evaluate(() => { window.__passkey = 'ok'; });
      await surface(page).getByRole('button', { name: /Use a passkey/ }).click();
      await arrived(page);
      expect(seen.filter((s) => s.path === '/api/auth/passkey/auth-verify')).toHaveLength(1);
    });

    test('Apple: a cancelled return comes back to the Grow chooser, the retry returns to Grow', async ({ page }) => {
      o.appleOutcome = 'cancelled';
      await openGrowSignedOut(page);
      await surface(page).getByRole('button', { name: 'Continue with Apple' }).click();
      await expect(page).toHaveURL(`${worker.origin}/login?${NEXT}`);
      await expect(heading(page)).toHaveText('Sign in to continue to Grow');
      await expect(surface(page).getByRole('status').filter({ hasText: 'Apple sign-in was cancelled. Nothing was changed.' })).toBeVisible();
      o.appleOutcome = 'ok';
      await surface(page).getByRole('button', { name: 'Continue with Apple' }).click();
      await arrived(page, withLandingMarker(DESTINATION, 'apple=ok'));
      expect(seen.filter((s) => s.path === '/api/auth/apple/start').map((s) => s.query)).toEqual([
        { action: 'signin', redirect: DESTINATION }, { action: 'signin', redirect: DESTINATION },
      ]);
    });

    test('Google: success returns to Grow; a cancelled return keeps Grow in the tab and the next sign-in still lands there', async ({ page }) => {
      await openGrowSignedOut(page);
      await surface(page).getByRole('button', { name: 'Continue with Google' }).click();
      await arrived(page, withLandingMarker(DESTINATION, 'google=ok'));
      expect(seen.filter((s) => s.path === '/api/auth/google/start').at(-1).query.redirect).toBe(DESTINATION);

      // A second visitor in a fresh tab cancels at Google. auth_google.ts' callbackError returns to a bare
      // /login?google_error=…, so the chooser is the generic one; the destination survives in the tab's kept copy.
      await page.context().clearCookies();
      await page.evaluate(() => localStorage.clear());
      o.googleOutcome = 'cancelled';
      await openGrowSignedOut(page);
      await surface(page).getByRole('button', { name: 'Continue with Google' }).click();
      await expect(page).toHaveURL(`${worker.origin}/login`);
      await expect(surface(page).getByRole('status').filter({ hasText: 'Google sign-in was cancelled. Nothing was changed.' })).toBeVisible();
      await expect(surface(page).getByRole('button', { name: 'Continue with Google' })).toBeEnabled();
      expect(await kept(page)).toBe(DESTINATION);
      // Retried with Google: the start no longer carries Grow; the callback lands on /studio?google=ok and the kept
      // copy takes the signed-in app on to Grow.
      o.googleOutcome = 'ok';
      await surface(page).getByRole('button', { name: 'Continue with Google' }).click();
      await arrived(page);
      expect(seen.filter((s) => s.path === '/api/auth/google/start').at(-1).query.redirect).toBe('/studio');
    });

    test('new member: sign-up from the Grow chooser keeps Grow through setup', async ({ page }) => {
      const newcomer = `newcomer.${width}@example.test`;
      await openGrowSignedOut(page);
      await surface(page).getByRole('link', { name: 'Create an account' }).click();
      await expect(page).toHaveURL(`${worker.origin}/register?${NEXT}`);
      const send = page.getByRole('button', { name: 'Email me a link to create my account', exact: true });
      await page.getByLabel('Full Name', { exact: true }).fill('Synthetic Newcomer');
      await page.getByLabel('Email', { exact: true }).fill(newcomer);
      await send.click();
      await expect.poll(() => worker.outbox.length).toBe(1);
      expect(worker.outbox[0]).toMatchObject({ to: newcomer, purpose: 'signup' });
      expect(await kept(page)).toBe(DESTINATION);
      await page.goto(worker.linkFor(newcomer));
      // A Grow page needs a finished account: setup runs first and holds the destination until it finishes.
      await expect.poll(() => new URL(page.url()).pathname, { timeout: 15_000 }).not.toBe('/login');
      expect(new URL(page.url()).pathname.startsWith('/grow')).toBe(false);
      await expect.poll(() => keptForSetup(page), { timeout: 15_000 }).toBe(DESTINATION);
    });

    test('existing member signing up from the Grow chooser is sent a sign-in link and returns to Grow', async ({ page }) => {
      await openGrowSignedOut(page);
      await surface(page).getByRole('link', { name: 'Create an account' }).click();
      await page.getByLabel('Full Name', { exact: true }).fill('Synthetic Founder');
      await page.getByLabel('Email', { exact: true }).fill(email);
      await page.getByRole('button', { name: 'Email me a link to create my account', exact: true }).click();
      await expect.poll(() => worker.outbox.length).toBe(1);
      expect(worker.outbox[0]).toMatchObject({ to: email, purpose: 'signin' });
      await page.goto(worker.linkFor(email));
      expect(MAGIC_LANDING.signin.startsWith('/dashboard')).toBe(true);
      await arrived(page);
    });
  });
}
