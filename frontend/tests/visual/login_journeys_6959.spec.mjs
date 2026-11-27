/**
 * #6959 — the Sign In v2 journeys of /login (#6958, canvas D6956; Apple D6957) in a real browser on the built SPA,
 * on the desktop card and the phone sheet.
 *
 * WHAT RUNS. Chromium only, five layouts: the desktop card at 1440×900, and the phone sheet under Playwright's
 * `iPhone 13` (390), `iPhone SE` (320) and `Pixel 7` (resized to 390 and 320) descriptors: their viewport, user agent,
 * touch and `isMobile`, with the descriptor's WebKit default dropped. So the iPhone rows are iOS-shaped Chromium, NOT
 * Safari, and no row is a real device: the live iOS Safari and Android Chrome runs of #6959 are not this file.
 *
 * WHAT IS MOCKED. The server is this folder's (`server.ts`: the built `docs/` and the real Worker), and every request
 * the sign-in methods make is answered here with `page.route`: Apple's and Google's config, start, callback landing
 * and Google's window (a stand-in for `accounts.google.com/gsi/client`), `/auth/magic/start`, `/auth/login`, the two
 * passkey calls, and Turnstile (a stand-in `window.turnstile` that answers a token). WebAuthn is a stand-in
 * `navigator.credentials.get`. No request leaves 127.0.0.1. These are mocked callbacks: they prove what the page
 * sends and how it reads every answer a provider can return, never that Apple or Google answer that way. The Worker
 * halves are `cloudflare-worker/test/auth_apple_6957.test.ts`, `auth_google.test.ts` and `auth_google_popup_d722.test.ts`; the live provider runs are not
 * this file.
 *
 * APPROXIMATIONS, stated where they are used:
 *   · an open keyboard is the layout viewport made shorter (Chromium's `visualViewport` follows it);
 *   · 200% text on a phone is `text-size-adjust: 200%` on the root, which `isMobile` Chromium honours as Android's
 *     font scale does; on the desktop it is browser zoom, i.e. the same card at half the CSS viewport (720×450);
 *   · `env(safe-area-inset-bottom)` is 0 in Chromium, so the check reads the sheet's padding at a zero inset.
 *
 * The protected Grow return is also #4580's `frontend/tests/e2e/grow_return_4580.spec.js` (owned there, not edited
 * here). Screenshots are written only when LOGIN_EVIDENCE_DIR is set (the owner's evidence for #6959); there are no
 * baselines.
 *
 *   npm run build                      (repo root)
 *   cd frontend && npx playwright test -c tests/visual/playwright.config.mjs login_journeys_6959
 *
 * From frontend/tests/visual/README.md (moved by #6472): #6959: /login's Sign In v2 journeys
 * (#6958, D6957) on the desktop card at 1440 and the phone sheet under the iPhone 13, iPhone SE
 * and Pixel 7 descriptors at 390 and 320 (Chromium, not Safari): three actions, the Email methods,
 * Apple and Google returns through mocked callbacks, the sheet's focus, axe, keyboard-open and
 * 200% text, destination continuity; screenshots only to `LOGIN_EVIDENCE_DIR`, no baselines.
 */
import { test, expect, devices } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { CONSENT_VERSION } from '../../src/lib/cookieConsent.js';

const EVIDENCE = process.env.LOGIN_EVIDENCE_DIR || '';
if (EVIDENCE) mkdirSync(EVIDENCE, { recursive: true });

/** A Playwright device descriptor without its browser: everything here runs in this suite's Chromium. */
const phoneOf = (name, viewport) => {
  const { defaultBrowserType, ...rest } = devices[name];
  return { ...rest, ...(viewport ? { viewport, screen: viewport } : {}), deviceScaleFactor: 2 };
};

const LAYOUTS = [
  { id: 'desktop-1440', label: 'Desktop Chromium 1440×900', phone: false, use: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 } },
  { id: 'iphone13-390', label: 'iPhone 13 descriptor (Chromium) 390×664', phone: true, use: phoneOf('iPhone 13') },
  { id: 'iphonese-320', label: 'iPhone SE descriptor (Chromium) 320×568', phone: true, use: phoneOf('iPhone SE') },
  { id: 'pixel7-390', label: 'Pixel 7 descriptor (Chromium) 390×844', phone: true, use: phoneOf('Pixel 7', { width: 390, height: 844 }) },
  { id: 'pixel7-320', label: 'Pixel 7 descriptor (Chromium) 320×658', phone: true, use: phoneOf('Pixel 7', { width: 320, height: 658 }) },
];

const USER = { id: 96959, email: 'synthetic.6959@example.test', name: 'Synthetic Member', role: 'founder' };
const SESSION = { token: 'synthetic-6959-session', user: USER };
const GIS_SRC = 'https://accounts.google.com/gsi/client';
const GROW = '/grow/talent?tab=open';

// Google's window, answering as `window.__gisMode` says. A blocked window is reported inside requestCode(), as gsi does.
const FAKE_GIS = `
  window.google = { accounts: { oauth2: { initCodeClient: function (cfg) {
    return { requestCode: function () {
      var mode = window.__gisMode || 'code';
      if (mode === 'blocked') { cfg.error_callback({ type: 'popup_failed_to_open' }); return; }
      setTimeout(function () {
        if (mode === 'code') cfg.callback({ code: '4/synthetic-6959', state: cfg.state, scope: cfg.scope });
        else cfg.error_callback({ type: mode });
      }, 30);
    } };
  } } } };
`;

test.afterEach(async ({ page }) => {
  if (!page.isClosed()) await page.unrouteAll({ behavior: 'ignoreErrors' });
});

/**
 * The page's network. `opts` picks each provider's answer; the returned `seen` records every auth request the page
 * made, so a test can say what was (and was not) sent.
 */
async function wire(page, opts = {}) {
  const o = {
    apple: 'on', appleStart: 'ok', google: 'redirect', gisMode: 'code', googlePopup: 'ok',
    turnstileDelayMs: 20, magic: 'ok', login: 'ok', passkeyOptions: 'ok', passkeyVerify: 'ok', webauthn: 'ok', webauthnSupported: true,
    ...opts,
  };
  const seen = [];
  await page.addInitScript(({ consentVersion, gisMode, webauthn, webauthnSupported, turnstileDelayMs }) => {
    try {
      localStorage.setItem('axal_cookie_consent_v1', JSON.stringify({ version: consentVersion, decided: true, updatedAt: '2026-11-19T00:00:00Z', categories: { essential: true } }));
    } catch { /* storage off: the first check fails loudly */ }
    window.__gisMode = gisMode;
    // Turnstile, answering a token as an invisible `interaction-only` widget does.
    window.turnstile = {
      render(el, cfg) {
        setTimeout(() => {
          cfg.callback('synthetic-turnstile-token');
          el.dataset.fixtureTurnstileReady = 'true';
        }, turnstileDelayMs);
        return 'w';
      },
      remove() {},
      reset() {},
    };
    if (!webauthnSupported) { try { delete window.PublicKeyCredential; } catch { /* configurable in Chromium */ } return; }
    const b64 = (s) => new TextEncoder().encode(s).buffer;
    // WebAuthn: the person cancels (NotAllowedError), or a discoverable passkey answers.
    navigator.credentials.get = async () => {
      if (webauthn === 'cancel') throw new DOMException('The operation either timed out or was not allowed.', 'NotAllowedError');
      return {
        id: 'c3ludGhldGljLWNyZWQ', rawId: b64('synthetic-cred'), type: 'public-key', authenticatorAttachment: 'platform',
        response: { authenticatorData: b64('ad'), clientDataJSON: b64('{}'), signature: b64('sig'), userHandle: b64('u96959') },
        getClientExtensionResults: () => ({}),
      };
    };
  }, { consentVersion: CONSENT_VERSION, gisMode: o.gisMode, webauthn: o.webauthn, webauthnSupported: o.webauthnSupported, turnstileDelayMs: o.turnstileDelayMs });

  await page.route((url) => url.hostname !== '127.0.0.1', (route) => route.abort('blockedbyclient'));
  await page.route(GIS_SRC, (route) => route.fulfill({ contentType: 'text/javascript', body: FAKE_GIS }));
  const json = (route, status, body) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  const record = (route) => {
    const r = route.request();
    const url = new URL(r.url());
    let body = null;
    try { body = r.postDataJSON(); } catch { body = r.postData(); }
    seen.push({ path: url.pathname, query: Object.fromEntries(url.searchParams), body });
    return url;
  };

  await page.route('**/api/auth/apple/config', (route) => { record(route); return json(route, 200, { configured: o.apple === 'on' }); });
  await page.route('**/api/auth/apple/start*', (route) => {
    const url = record(route);
    if (o.appleStart === 'unavailable') return json(route, 503, { error: 'Sign in with Apple is not configured.', code: 'not_configured' });
    const back = new URL('/__provider/apple', url.origin);
    back.searchParams.set('redirect', url.searchParams.get('redirect') || '');
    return json(route, 200, { url: back.toString() });
  });
  await page.route('**/api/auth/google/config*', (route) => {
    record(route);
    return json(route, 200, o.google === 'popup' ? { popup: true, client_id: 'synthetic-6959.example.test' } : { popup: false });
  });
  await page.route('**/api/auth/google/start*', (route) => {
    const url = record(route);
    const back = new URL('/__provider/google', url.origin);
    back.searchParams.set('redirect', url.searchParams.get('redirect') || '');
    return json(route, 200, { url: back.toString() });
  });
  await page.route('**/api/auth/google/popup', (route) => {
    record(route);
    if (o.googlePopup === 'exchange_failed') return json(route, 502, { error: "Google didn't confirm.", code: 'exchange_failed' });
    return json(route, 200, { ...SESSION, csrf_token: 'synthetic', expires_in: 86400, new_signup: false });
  });
  // The provider's page, answering for the person: `outcome` is what the Worker's callback would redirect with.
  await page.route('**/__provider/*', (route) => {
    const url = new URL(route.request().url());
    const provider = url.pathname.endsWith('apple') ? 'apple' : 'google';
    const redirect = url.searchParams.get('redirect') || '/dashboard';
    const outcome = o[`${provider}Outcome`] || 'ok';
    const location = outcome === 'ok'
      ? `${redirect}${redirect.includes('?') ? '&' : '?'}${provider}=ok`
      : `/login?${provider}_error=${outcome}${redirect.startsWith('/grow') ? `&next=${encodeURIComponent(redirect)}` : ''}`;
    return route.fulfill({ status: 303, headers: { location } });
  });
  await page.route('**/api/auth/magic/start', (route) => {
    record(route);
    if (o.magic === 'fail') return json(route, 503, { error: "We couldn't send your sign-in link. Try again in a moment." });
    return json(route, 200, { ok: true });
  });
  await page.route('**/api/auth/login', (route) => {
    record(route);
    const code = route.request().postDataJSON()?.totp_code;
    if (o.login === 'ok' && (code === '482913' || code === 'ABCD-EFGH-1234')) return json(route, 200, SESSION);
    return json(route, 401, { error: 'Invalid TOTP code' });
  });
  await page.route('**/api/auth/passkey/auth-options', (route) => {
    record(route);
    if (o.passkeyOptions === 'fail') { o.passkeyOptions = 'ok'; return json(route, 503, { error: 'Passkey sign-in is unavailable right now.' }); }
    return json(route, 200, { challenge: 'c3ludGhldGljLWNoYWxsZW5nZQ', rpId: '127.0.0.1', timeout: 60000, userVerification: 'preferred', allowCredentials: [] });
  });
  await page.route('**/api/auth/passkey/auth-verify', (route) => { record(route); return json(route, 200, SESSION); });
  return { seen, o };
}

/** Auth requests other than the two env-only config reads. */
const actions = (seen) => seen.filter((s) => !/\/config$/.test(s.path));

/** Hold the landing document so a sign-in's full-page navigation stops there instead of booting a signed-in app. */
async function holdLanding(page, pathname) {
  await page.route((url) => url.pathname === pathname, (route) => (route.request().resourceType() === 'document'
    ? route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>landed</title><p>landed</p>' })
    : route.fallback()));
}

const surface = (page) => page.getByTestId('signin-surface');
const heading = (page) => surface(page).getByRole('heading', { level: 1 });
const signInActions = (page) => surface(page).getByRole('button', { name: /^Continue with / });

async function open(page, path = '/login', { apple = true } = {}) {
  await page.goto(path);
  await expect(heading(page)).toBeVisible();
  // The first view waits for Apple's idle config read, so the three actions are all there before a test reads them.
  if (apple && !/[?&](step|magic_error)=/.test(path)) await expect(surface(page).getByRole('button', { name: 'Continue with Apple' })).toBeVisible();
}

async function shot(page, layout, name) {
  if (!EVIDENCE) return;
  await page.screenshot({ path: join(EVIDENCE, `${layout.id}-${name}.png`), animations: 'disabled', caret: 'initial' });
}

/** The element's box lies inside the visual viewport. */
async function inViewport(locator) {
  return locator.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const vv = window.visualViewport;
    const h = vv ? vv.height : window.innerHeight;
    const w = vv ? vv.width : window.innerWidth;
    return r.top >= -0.5 && r.left >= -0.5 && r.bottom <= h + 0.5 && r.right <= w + 0.5 && r.height > 0;
  });
}

const noHorizontalScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);

for (const layout of LAYOUTS) {
  test.describe(`${layout.label}`, () => {
    test.use(layout.use);

    test('landing: artwork, wordmark, exactly three sign-in actions in order, nothing asked for, Create an account secondary', async ({ page }) => {
      const { seen } = await wire(page);
      const art = page.waitForResponse((r) => r.url().endsWith('/auth/login-background.webp'));
      await open(page);
      expect((await art).status(), 'the city artwork is served').toBe(200);
      await expect(page.locator('.signin-root')).toHaveCSS('background-image', /login-background\.webp/);
      const wordmark = page.getByRole('link', { name: 'Axal VC home' });
      await expect(wordmark).toBeVisible();
      expect(await inViewport(wordmark), 'the wordmark is on screen').toBe(true);
      await expect(heading(page)).toHaveText('Sign in to Axal VC');
      await expect(signInActions(page)).toHaveText(['Continue with Email', 'Continue with Apple', 'Continue with Google']);
      expect(await surface(page).getByRole('button').evaluateAll((els) => els.map((e) => e.textContent.trim()).filter((t) => /^Continue with /.test(t)).length)).toBe(3);
      // The chooser asks for nothing: no field, no code input, no Turnstile.
      await expect(surface(page).locator('input, textarea, select, iframe')).toHaveCount(0);
      await expect(page.getByTestId('login-turnstile')).toHaveCount(0);
      const create = surface(page).getByRole('link', { name: 'Create an account' });
      await expect(create).toHaveAttribute('href', '/register');
      expect(await create.evaluate((el) => el.closest('.signin-stack') === null && !el.classList.contains('signin-b'))).toBe(true);
      expect(actions(seen), 'the chooser sends nothing before a press').toEqual([]);
      expect(await noHorizontalScroll(page)).toBe(true);
      if (layout.phone) {
        const sheet = page.getByRole('dialog', { name: 'Sign in to Axal VC' });
        await expect(sheet).toHaveAttribute('aria-modal', 'true');
        const box = await sheet.boundingBox();
        const vh = page.viewportSize().height;
        expect(Math.abs(box.y + box.height - vh), 'the sheet starts at the bottom edge').toBeLessThanOrEqual(1);
        const mark = await wordmark.boundingBox();
        expect(mark.y + mark.height, 'the wordmark and skyline stay above the sheet').toBeLessThanOrEqual(box.y);
      } else {
        await expect(page.getByRole('dialog')).toHaveCount(0);
        await expect(page.locator('.signin-card')).toBeVisible();
      }
      await shot(page, layout, 'chooser');
    });

    test('Apple unconfigured: no Apple button, Email and Google remain', async ({ page }) => {
      await wire(page, { apple: 'off' });
      await open(page, '/login', { apple: false });
      await page.waitForTimeout(400);
      await expect(signInActions(page)).toHaveText(['Continue with Email', 'Continue with Google']);
    });

    test('Email branch: opening it sends nothing; Back returns one step with focus restored; browser Back too', async ({ page }) => {
      const { seen } = await wire(page);
      await open(page);
      const email = surface(page).getByRole('button', { name: 'Continue with Email' });
      await email.click();
      await expect(heading(page)).toHaveText('Sign in with email');
      await expect(heading(page)).toBeFocused();
      await expect(page).toHaveURL(/[?&]step=email/);
      const methods = surface(page).getByRole('list', { name: 'Email sign-in methods' }).getByRole('button');
      await expect(methods).toHaveCount(3);
      await expect(methods.nth(0)).toContainText('Email me a sign-in link');
      await expect(methods.nth(1)).toContainText('Use a passkey');
      await expect(methods.nth(2)).toContainText('Use an authenticator code');
      await expect(surface(page).locator('input')).toHaveCount(0);
      await expect(surface(page).getByRole('link', { name: /Account recovery/ })).toHaveAttribute('href', '/auth/recover');
      expect(actions(seen)).toEqual([]);
      await shot(page, layout, 'email-branch');
      await surface(page).getByRole('button', { name: 'Back', exact: true }).click();
      await expect(heading(page)).toHaveText('Sign in to Axal VC');
      await expect(email).toBeFocused();
      await expect(page).not.toHaveURL(/step=/);
      // The browser's (and Android's) Back goes one step too.
      await email.click();
      await surface(page).getByRole('button', { name: /Use an authenticator code/ }).click();
      await expect(heading(page)).toHaveText('Use an authenticator code');
      await page.goBack();
      await expect(heading(page)).toHaveText('Sign in with email');
      await expect(surface(page).getByRole('button', { name: /Use an authenticator code/ })).toBeFocused();
      // Escape inside a step is Back.
      await page.keyboard.press('Escape');
      await expect(heading(page)).toHaveText('Sign in to Axal VC');
    });

    test('email link: sends only on explicit submit, says sent, resends after the cooldown, and an expired link retries', async ({ page }) => {
      await page.clock.install();
      const { seen } = await wire(page);
      await open(page, '/login?step=link');
      await expect(heading(page)).toHaveText('Email me a sign-in link');
      const field = surface(page).getByLabel('Email', { exact: true });
      await field.fill('synthetic.6959@example.test');
      await field.blur();
      await page.waitForTimeout(300);
      expect(actions(seen).filter((s) => s.path.endsWith('/magic/start')), 'typing sends nothing').toEqual([]);
      await expect(page.getByTestId('login-turnstile')).toHaveCount(1);
      await surface(page).getByRole('button', { name: 'Send sign-in link' }).click();
      await expect(heading(page)).toHaveText('Check your email');
      await expect(heading(page)).toBeFocused();
      const sends = () => actions(seen).filter((s) => s.path.endsWith('/magic/start'));
      expect(sends()).toEqual([{ path: '/api/auth/magic/start', query: {}, body: { email: 'synthetic.6959@example.test' } }]);
      await expect(surface(page).getByRole('status').first()).toHaveText('Sign-in link sent to synthetic.6959@example.test.');
      const resend = surface(page).getByRole('button', { name: /Resend link/ });
      await expect(resend).toBeDisabled();
      await expect(resend).toHaveText(/Resend link in \d+s/);
      // The countdown is one 1 s timer per render, so the clock moves a second at a time (React renders in between).
      for (let i = 0; i < 70 && (await resend.textContent()) !== 'Resend link'; i += 1) {
        await page.clock.runFor(1000);
        await page.waitForTimeout(5);
      }
      await expect(resend).toHaveText('Resend link');
      await expect(surface(page).locator('[role="status"][aria-live="polite"]')).toHaveText('You can resend the link now.');
      await expect(resend).toBeEnabled();
      await resend.click();
      await expect.poll(() => sends().length, 'Resend sends a second link').toBe(2);
      await expect(surface(page).getByRole('alert')).toHaveCount(0);
      // An expired link returns to the link step, ready to send another, with the address step's retry sentence.
      await page.goto('/login?magic_error=expired');
      await expect(heading(page)).toHaveText('Email me a sign-in link');
      await expect(surface(page).getByRole('alert')).toHaveText('That sign-in link has expired or was already used. Send a new one.');
      await expect(page).toHaveURL(/\/login\?step=link$/);
    });

    test('email link: a failed send stays on the form and says so', async ({ page }) => {
      await wire(page, { magic: 'fail' });
      await open(page, '/login?step=link');
      await surface(page).getByLabel('Email', { exact: true }).fill('synthetic.6959@example.test');
      await surface(page).getByRole('button', { name: 'Send sign-in link' }).click();
      await expect(surface(page).getByRole('alert')).toHaveText("We couldn't send your sign-in link. Try again in a moment.");
      await expect(heading(page)).toHaveText('Email me a sign-in link');
      await expect(surface(page).getByRole('button', { name: 'Send sign-in link' })).toBeEnabled();
    });

    test('authenticator: a pasted six-digit code, a refused code cleared, recovery reachable, codes cleared on leaving', async ({ page }) => {
      const { seen } = await wire(page, { login: 'refuse' });
      await open(page, '/login?step=code');
      await expect(heading(page)).toHaveText('Use an authenticator code');
      await surface(page).getByLabel('Email', { exact: true }).fill('synthetic.6959@example.test');
      const code = surface(page).getByLabel('6-digit code');
      await expect(code).toHaveAttribute('autocomplete', 'one-time-code');
      await code.evaluate((el) => {
        const data = new DataTransfer();
        data.setData('text/plain', ' 482 913 ');
        el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
      });
      await expect(code).toHaveValue('482913');
      await expect(surface(page).getByRole('link', { name: 'Lost your authenticator? Account recovery' })).toHaveAttribute('href', '/auth/recover');
      await expect(surface(page).getByText('A recovery code works here too.')).toBeVisible();
      const submit = surface(page).getByRole('button', { name: 'Sign in', exact: true });
      await expect(submit).toBeEnabled();
      await submit.click();
      await expect(surface(page).getByRole('alert')).toHaveText('Invalid TOTP code');
      await expect(code).toHaveValue('');
      await expect(code).toHaveAttribute('aria-invalid', 'true');
      const login = actions(seen).filter((s) => s.path === '/api/auth/login');
      expect(login).toHaveLength(1);
      expect(login[0].body).toMatchObject({ email: 'synthetic.6959@example.test', totp_code: '482913', turnstileToken: 'synthetic-turnstile-token' });
      // A code typed, then the step left: it is gone on return; the address is kept.
      await code.fill('123456');
      await surface(page).getByRole('button', { name: 'Back', exact: true }).click();
      await expect(heading(page)).toHaveText('Sign in with email');
      await surface(page).getByRole('button', { name: /Use an authenticator code/ }).click();
      await expect(surface(page).getByLabel('6-digit code')).toHaveValue('');
      await expect(surface(page).getByLabel('Email', { exact: true })).toHaveValue('synthetic.6959@example.test');
    });

    test('passkey: no typed address needed; a cancellation returns to the methods; a failure retries in place', async ({ page }) => {
      const { seen } = await wire(page, { webauthn: 'cancel', passkeyOptions: 'fail' });
      await holdLanding(page, '/studio');
      await open(page);
      await surface(page).getByRole('button', { name: 'Continue with Email' }).click();
      // Failure: the options read fails. The step stays, says why, and offers a retry.
      await surface(page).getByRole('button', { name: /Use a passkey/ }).click();
      await expect(heading(page)).toHaveText('Use your passkey');
      await expect(surface(page).getByRole('alert')).toHaveText('Passkey sign-in is unavailable right now.');
      const retry = surface(page).getByRole('button', { name: 'Try passkey again' });
      await expect(retry).toBeVisible();
      // Cancellation: the device prompt is dismissed. Back to the methods, as information, not an error.
      await retry.click();
      await expect(heading(page)).toHaveText('Sign in with email');
      await expect(surface(page).getByRole('status').filter({ hasText: 'Passkey sign-in was cancelled. Nothing was changed.' })).toBeVisible();
      await expect(surface(page).getByRole('alert')).toHaveCount(0);
      // Success: a discoverable passkey, no address typed anywhere.
      await page.evaluate(() => {
        const b = (s) => new TextEncoder().encode(s).buffer;
        navigator.credentials.get = async () => ({
          id: 'c3ludGhldGljLWNyZWQ', rawId: b('synthetic-cred'), type: 'public-key', authenticatorAttachment: 'platform',
          response: { authenticatorData: b('ad'), clientDataJSON: b('{}'), signature: b('sig'), userHandle: b('u') },
          getClientExtensionResults: () => ({}),
        });
      });
      await surface(page).getByRole('button', { name: /Use a passkey/ }).click();
      await page.waitForURL((u) => u.pathname === '/studio');
      const opts = actions(seen).filter((s) => s.path === '/api/auth/passkey/auth-options');
      expect(opts.length).toBe(3);
      for (const s of opts) expect(s.body, 'no address is sent for a discoverable passkey').toEqual({});
      expect(actions(seen).filter((s) => s.path === '/api/auth/passkey/auth-verify')).toHaveLength(1);
    });

    test('passkey unsupported: the row is not offered and the other methods remain', async ({ page }) => {
      await wire(page, { webauthnSupported: false });
      await open(page);
      await surface(page).getByRole('button', { name: 'Continue with Email' }).click();
      const methods = surface(page).getByRole('list', { name: 'Email sign-in methods' }).getByRole('button');
      await expect(methods).toHaveCount(2);
      await expect(methods.nth(0)).toContainText('Email me a sign-in link');
      await expect(methods.nth(1)).toContainText('Use an authenticator code');
      await methods.nth(1).click();
      await expect(heading(page)).toHaveText('Use an authenticator code');
    });

    test('Apple: launches directly and returns on success, cancel, denial and transient failure (mocked callbacks)', async ({ page }) => {
      const { seen, o } = await wire(page);
      await holdLanding(page, '/studio');
      await open(page);
      await surface(page).getByRole('button', { name: 'Continue with Apple' }).click();
      await page.waitForURL((u) => u.pathname === '/studio' && u.searchParams.get('apple') === 'ok');
      expect(actions(seen).filter((s) => s.path === '/api/auth/apple/start')[0].query).toEqual({ action: 'signin', redirect: '/studio' });
      // The Worker's own codes for each way back (routes/auth_apple.ts backWithError).
      for (const [code, role, text] of [
        ['cancelled', 'status', 'Apple sign-in was cancelled. Nothing was changed.'],
        ['provider_error', 'alert', "Apple didn't confirm your sign-in. Try again, or use Continue with Email."],
        ['exchange_failed', 'alert', "Apple didn't confirm your sign-in. Try again, or use Continue with Email."],
        ['bad_state', 'alert', 'This sign-in attempt expired. Press Continue with Apple again.'],
      ]) {
        o.appleOutcome = code;
        await open(page);
        await surface(page).getByRole('button', { name: 'Continue with Apple' }).click();
        await expect(surface(page).getByRole(role).filter({ hasText: text })).toBeVisible();
        await expect(page).toHaveURL(/\/login$/);
        await expect(surface(page).getByRole('button', { name: 'Continue with Apple' })).toBeEnabled();
      }
      // A start the Worker refuses stays on the chooser and says so.
      o.appleStart = 'unavailable';
      await surface(page).getByRole('button', { name: 'Continue with Apple' }).click();
      await expect(surface(page).getByRole('alert')).toHaveText("Sign in with Apple isn't available here yet. Use Continue with Email or Google.");
      await expect(surface(page).getByRole('button', { name: 'Continue with Apple' })).toBeEnabled();
    });

    test('Google redirect: launches directly and returns on success, cancel, denial and transient failure (mocked callbacks)', async ({ page }) => {
      const { seen, o } = await wire(page, { google: 'redirect' });
      await holdLanding(page, '/studio');
      await open(page);
      await surface(page).getByRole('button', { name: 'Continue with Google' }).click();
      await page.waitForURL((u) => u.pathname === '/studio' && u.searchParams.get('google') === 'ok');
      expect(actions(seen).filter((s) => s.path === '/api/auth/google/start')[0].query).toMatchObject({ redirect: '/studio' });
      for (const [code, role, text] of [
        ['cancelled', 'status', 'Google sign-in was cancelled. Nothing was changed.'],
        ['access_denied', 'status', 'Google sign-in was cancelled. Nothing was changed.'],
        ['exchange_failed', 'alert', "Google didn't confirm your sign-in. Please try again."],
      ]) {
        o.googleOutcome = code;
        await open(page);
        await surface(page).getByRole('button', { name: 'Continue with Google' }).click();
        await expect(surface(page).getByRole(role).filter({ hasText: text })).toBeVisible();
        await expect(page).toHaveURL(/\/login$/);
        await expect(surface(page).getByRole('button', { name: 'Continue with Google' })).toBeEnabled();
      }
    });

    test('Google window: success, closed window, refused exchange, and a blocked window falling back to the redirect', async ({ page }) => {
      const { seen } = await wire(page, { google: 'popup' });
      await holdLanding(page, '/studio');
      const ready = async () => {
        await open(page);
        await surface(page).getByRole('button', { name: 'Continue with Google' }).hover();
        await page.waitForFunction(() => typeof window.google?.accounts?.oauth2?.initCodeClient === 'function');
      };
      const google = () => surface(page).getByRole('button', { name: /Google|Waiting|Signing|Redirecting/ });
      // Closed window: information, and the button works again.
      await ready();
      await page.evaluate(() => { window.__gisMode = 'popup_closed'; });
      await google().click();
      await expect(surface(page).getByRole('status').filter({ hasText: 'Google sign-in was cancelled. Nothing was changed.' })).toBeVisible();
      await expect(google()).toHaveText('Continue with Google');
      // A refused exchange (transient): an alert, and the button works again.
      await page.unroute('**/api/auth/google/popup');
      await page.route('**/api/auth/google/popup', (route) => route.fulfill({ status: 502, contentType: 'application/json', body: JSON.stringify({ error: 'x', code: 'exchange_failed' }) }));
      await page.evaluate(() => { window.__gisMode = 'code'; });
      await google().click();
      await expect(surface(page).getByRole('alert')).toHaveText("Google didn't confirm your sign-in. Please try again.");
      await expect(google()).toBeEnabled();
      // Blocked window: the same-tab redirect takes over and says why.
      await page.evaluate(() => { window.__gisMode = 'blocked'; });
      const starts = () => actions(seen).filter((s) => s.path === '/api/auth/google/start').length;
      await google().click();
      await page.waitForURL((u) => u.pathname === '/studio' && u.searchParams.get('google') === 'ok');
      expect(starts()).toBe(1);
      // Success through the window.
      await page.unroute('**/api/auth/google/popup');
      await page.route('**/api/auth/google/popup', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ...SESSION, new_signup: false }) }));
      await ready();
      await page.evaluate(() => { window.__gisMode = 'code'; });
      await google().click();
      await page.waitForURL((u) => u.pathname === '/studio' && !u.searchParams.has('google'));
      expect(starts(), 'a window that answered needs no redirect').toBe(1);
    });

    test('destination continuity: a protected path with query parameters, the contextual Create an account, direct login', async ({ page }) => {
      const { seen } = await wire(page);
      await holdLanding(page, '/grow/talent');
      await page.goto(`/login?next=${encodeURIComponent(GROW)}`);
      await expect(heading(page)).toHaveText('Sign in to continue to Grow');
      await expect(surface(page).getByRole('link', { name: 'Create an account' })).toHaveAttribute('href', `/register?next=${encodeURIComponent(GROW)}`);
      // The kept destination survives every step and every provider launch.
      await surface(page).getByRole('button', { name: 'Continue with Email' }).click();
      expect(new URL(page.url()).searchParams.get('next')).toBe(GROW);
      await expect(surface(page).getByTestId('login-destination-short')).toContainText('After sign-in: Grow');
      await surface(page).getByRole('button', { name: /Use an authenticator code/ }).click();
      await surface(page).getByLabel('Email', { exact: true }).fill('synthetic.6959@example.test');
      await surface(page).getByLabel('6-digit code').fill('482913');
      await surface(page).getByRole('button', { name: 'Sign in', exact: true }).click();
      await page.waitForURL((u) => u.pathname === '/grow/talent' && u.searchParams.get('tab') === 'open');
      // Apple and Google carry the same destination to the Worker.
      await page.goto(`/login?next=${encodeURIComponent(GROW)}`);
      await expect(surface(page).getByRole('button', { name: 'Continue with Apple' })).toBeVisible();
      await surface(page).getByRole('button', { name: 'Continue with Apple' }).click();
      await page.waitForURL((u) => u.pathname === '/grow/talent' && u.searchParams.get('apple') === 'ok');
      await page.goto(`/login?next=${encodeURIComponent(GROW)}`);
      await surface(page).getByRole('button', { name: 'Continue with Google' }).click();
      await page.waitForURL((u) => u.pathname === '/grow/talent' && u.searchParams.get('google') === 'ok');
      for (const p of ['/api/auth/apple/start', '/api/auth/google/start']) {
        expect(actions(seen).filter((s) => s.path === p).at(-1).query.redirect, p).toBe(GROW);
      }
      // A provider's refusal comes back to the same contextual chooser.
      await page.goto(`/login?apple_error=cancelled&next=${encodeURIComponent(GROW)}`);
      await expect(heading(page)).toHaveText('Sign in to continue to Grow');
      // Direct login lands on the default.
      await holdLanding(page, '/studio');
      await page.goto('/login?step=code');
      await surface(page).getByLabel('Email', { exact: true }).fill('synthetic.6959@example.test');
      await surface(page).getByLabel('6-digit code').fill('482913');
      await surface(page).getByRole('button', { name: 'Sign in', exact: true }).click();
      await page.waitForURL((u) => u.pathname === '/studio');
    });

    test('accessibility: axe, keyboard path with visible focus, status announcements, touch targets, reduced motion', async ({ page }) => {
      // Keep verification asynchronous and slow enough to exercise the readiness wait.
      await wire(page, { turnstileDelayMs: 2000 });
      await open(page);
      for (const step of ['first', 'email', 'link', 'code']) {
        if (step !== 'first') await page.goto(`/login?step=${step}`);
        await expect(heading(page)).toBeVisible();
        await page.waitForTimeout(250);
        const { violations } = await new AxeBuilder({ page }).include('[data-testid="signin-surface"]').withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
        const bad = violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`);
        expect(bad, `axe on the ${step} step`).toEqual([]);
      }
      // Keyboard only: Tab reaches Continue with Email, its focus ring shows, Enter opens the branch.
      await open(page);
      const email = surface(page).getByRole('button', { name: 'Continue with Email' });
      for (let i = 0; i < 12 && !(await email.evaluate((el) => el === document.activeElement)); i += 1) await page.keyboard.press('Tab');
      await expect(email).toBeFocused();
      expect(await email.evaluate((el) => el.matches(':focus-visible') && getComputedStyle(el).boxShadow !== 'none'), 'a visible focus ring').toBe(true);
      await page.keyboard.press('Enter');
      await expect(heading(page)).toHaveText('Sign in with email');
      await expect(heading(page)).toBeFocused();
      // One polite live region carries what is happening now.
      const live = surface(page).locator('[role="status"][aria-live="polite"]');
      await expect(live).toHaveCount(1);
      await surface(page).getByRole('button', { name: /Email me a sign-in link/ }).click();
      await surface(page).getByLabel('Email', { exact: true }).fill('synthetic.6959@example.test');
      // Enter does not auto-wait for the asynchronous verification callback.
      // Wait for this mounted fixture's token, not a fixed number of ticks.
      await expect(surface(page).getByTestId('login-turnstile')).toHaveAttribute('data-fixture-turnstile-ready', 'true');
      await surface(page).getByLabel('Email', { exact: true }).press('Enter');
      await expect(live).toHaveText('Sign-in link sent to synthetic.6959@example.test.');
      if (!layout.phone) return;
      // Touch targets: every control in the sheet is at least 44px tall, or is inline text in a sentence.
      await open(page);
      const small = await surface(page).locator('button, a, input').evaluateAll((els) => els
        .filter((el) => el.offsetParent !== null)
        .map((el) => ({ name: (el.textContent || el.getAttribute('aria-label') || '').trim(), h: el.getBoundingClientRect().height, inline: getComputedStyle(el).display === 'inline' }))
        .filter((t) => t.h < 44 && !t.inline));
      expect(small, 'controls under 44px').toEqual([]);
      // Safe area: the sheet's bottom padding is max(16px, inset) + 16px; Chromium's inset is 0.
      await expect(page.getByTestId('signin-sheet')).toHaveCSS('padding-bottom', '32px');
      // Reduced motion: no rise. The sheet's own 120 ms fade is shortened further by index.css's global
      // reduced-motion rule (0.001ms !important), so the sheet simply appears.
      await expect(page.getByTestId('signin-sheet')).toHaveCSS('animation-name', 'signin-fade');
      expect(parseFloat(await page.getByTestId('signin-sheet').evaluate((el) => getComputedStyle(el).animationDuration))).toBeLessThanOrEqual(0.12);
      await page.emulateMedia({ reducedMotion: 'no-preference' });
      await page.reload();
      await expect(page.getByTestId('signin-sheet')).toHaveCSS('animation-name', 'signin-rise');
      await expect(page.getByTestId('signin-sheet')).toHaveCSS('animation-duration', '0.28s');
    });

    if (layout.phone) {
      test('sheet: named dialog, focus contained, Close and reopen move focus, Escape closes the first view', async ({ page }) => {
        await wire(page);
        await open(page);
        const sheet = page.getByRole('dialog', { name: 'Sign in to Axal VC' });
        await expect(sheet).toBeVisible();
        const close = sheet.getByRole('button', { name: 'Close sign-in' });
        const create = sheet.getByRole('link', { name: 'Create an account' });
        // Containment: Tab from the last control wraps to the first, Shift+Tab from the first wraps to the last.
        await create.focus();
        await page.keyboard.press('Tab');
        await expect(close).toBeFocused();
        await page.keyboard.press('Shift+Tab');
        await expect(create).toBeFocused();
        for (let i = 0; i < 8; i += 1) {
          await page.keyboard.press('Tab');
          expect(await sheet.evaluate((el) => el.contains(document.activeElement)), 'focus left the sheet').toBe(true);
        }
        await close.click();
        await expect(sheet).toHaveCount(0);
        const reopen = page.getByRole('button', { name: 'Sign in', exact: true });
        await expect(reopen).toBeFocused();
        expect(await inViewport(reopen)).toBe(true);
        await reopen.click();
        await expect(heading(page)).toBeFocused();
        await page.keyboard.press('Escape');
        await expect(page.getByRole('dialog')).toHaveCount(0);
        await expect(reopen).toBeFocused();
        await page.keyboard.press('Enter');
        await expect(page.getByRole('dialog', { name: 'Sign in to Axal VC' })).toBeVisible();
        // Within a step the dialog takes that step's name.
        await page.getByRole('button', { name: 'Continue with Email' }).click();
        await expect(page.getByRole('dialog', { name: 'Sign in with email' })).toBeVisible();
      });
    }

    test('keyboard open and 200% text: the focused field and its submit stay reachable', async ({ page }) => {
      await wire(page);
      const full = page.viewportSize();
      await open(page, '/login?step=link');
      if (!layout.phone) {
        await surface(page).getByLabel('Email', { exact: true }).focus();
        await shot(page, layout, 'form-focused');
      }
      for (const step of ['link', 'code']) {
        if (layout.phone) {
          // The keyboard takes about 45% of a phone's height; the layout viewport shrinks as visualViewport does on iOS.
          await page.setViewportSize({ width: full.width, height: Math.round(full.height * 0.55) });
        }
        await page.goto(`/login?step=${step}`);
        const field = surface(page).getByLabel('Email', { exact: true });
        await field.focus();
        await page.waitForTimeout(400);
        expect(await inViewport(field), `${step}: the focused field is visible`).toBe(true);
        const submit = surface(page).getByRole('button', { name: step === 'link' ? 'Send sign-in link' : 'Sign in', exact: true });
        await submit.scrollIntoViewIfNeeded();
        expect(await inViewport(submit), `${step}: the submit action is reachable`).toBe(true);
        if (layout.phone) {
          // The sheet fits above the keyboard and scrolls inside itself, so nothing in it is cut off at the top.
          const sheet = await page.getByTestId('signin-sheet').evaluate((el) => {
            const r = el.getBoundingClientRect();
            return { top: r.top, bottom: r.bottom, scrolls: el.scrollHeight > el.clientHeight ? getComputedStyle(el).overflowY : 'fits' };
          });
          expect(sheet.top, `${step}: the sheet's top is on screen`).toBeGreaterThanOrEqual(-0.5);
          expect(sheet.bottom).toBeLessThanOrEqual(page.viewportSize().height + 1);
          expect(['auto', 'scroll', 'fits']).toContain(sheet.scrolls);
          if (step === 'link') {
            await field.focus();
            await page.waitForTimeout(400);
            await shot(page, layout, 'keyboard-open');
          }
          await page.setViewportSize(full);
        }
        expect(await noHorizontalScroll(page)).toBe(true);
      }
      // 200% text: Android's font scale on a phone, browser zoom (half the CSS viewport) on the desktop.
      if (!layout.phone) await page.setViewportSize({ width: full.width / 2, height: full.height / 2 });
      for (const step of ['first', 'link', 'code']) {
        await page.goto(step === 'first' ? '/login' : `/login?step=${step}`);
        if (layout.phone) await page.addStyleTag({ content: 'html { -webkit-text-size-adjust: 200% !important; text-size-adjust: 200% !important; }' });
        await expect(heading(page)).toBeVisible();
        if (layout.phone) expect(await heading(page).evaluate((el) => parseFloat(getComputedStyle(el).fontSize)), 'text is doubled').toBeGreaterThanOrEqual(40);
        expect(await noHorizontalScroll(page), `${step}: no sideways scroll at 200%`).toBe(true);
        if (layout.phone) expect(await page.getByTestId('signin-sheet').evaluate((el) => el.getBoundingClientRect().top), `${step}: the sheet's top is on screen at 200%`).toBeGreaterThanOrEqual(-0.5);
        const target = step === 'first'
          ? surface(page).getByRole('button', { name: 'Continue with Google' })
          : surface(page).getByRole('button', { name: step === 'link' ? 'Send sign-in link' : 'Sign in', exact: true });
        if (step !== 'first') {
          await surface(page).getByLabel('Email', { exact: true }).focus();
          await page.waitForTimeout(400);
          expect(await inViewport(surface(page).getByLabel('Email', { exact: true })), `${step}: field visible at 200%`).toBe(true);
        }
        await target.scrollIntoViewIfNeeded();
        expect(await inViewport(target), `${step}: last action reachable at 200%`).toBe(true);
        if (step === 'link') await shot(page, layout, 'text-200');
      }
    });
  });
}
