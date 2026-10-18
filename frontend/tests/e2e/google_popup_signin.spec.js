import { test, expect } from '@playwright/test';
import { requirePreview } from './_helpers.js';

/**
 * D722 — "Continue with Google" through Google's own window on /login.
 *
 * Google is not reached. `page.route` serves a stand-in for
 * https://accounts.google.com/gsi/client whose `initCodeClient` records the
 * config the page passed and answers the way the test asks (`window.__gisMode`):
 * a code, a blocked window, or a closed one. `/api/auth/google/*` is stubbed
 * too, so the preview's own Google client and switch do not matter; what is
 * under test is the page: that it opens the window only once the library is
 * there, that the POST carries the header and the cookie equal to its state,
 * where a success lands, and that every other path still ends on the
 * same-tab redirect.
 *
 * Runs against the PR preview (skips locally when PLAYWRIGHT_BASE_URL is unset).
 */

const GIS_SRC = 'https://accounts.google.com/gsi/client';

// The stand-in library. `requestCode()` answers on the next tick, as Google's
// window does after a click, with the state the page handed it.
const FAKE_GIS = `
  window.__gisConfigs = [];
  window.google = { accounts: { oauth2: { initCodeClient: function (cfg) {
    window.__gisConfigs.push({ client_id: cfg.client_id, scope: cfg.scope, ux_mode: cfg.ux_mode, state: cfg.state, select_account: cfg.select_account });
    return { requestCode: function () {
      var mode = window.__gisMode || 'code';
      setTimeout(function () {
        if (mode === 'code') cfg.callback({ code: '4/e2e-fake-code', state: cfg.state, scope: cfg.scope });
        else if (mode === 'blocked') cfg.error_callback({ type: 'popup_failed_to_open' });
        else if (mode === 'closed') cfg.error_callback({ type: 'popup_closed' });
      }, 30);
    } };
  } } } };
`;

const SIGNED_IN = {
  token: 'e2e-google-popup-token',
  csrf_token: 'e2e-csrf',
  user: { id: 9722, email: 'e2e.google@example.test', name: 'E2E Google', role: 'founder' },
  expires_in: 86400,
  new_signup: false,
};

async function stubGoogle(page, { mode = 'code', config = 'on' } = {}) {
  const seen = { popup: [], start: 0 };
  await page.addInitScript((m) => { window.__gisMode = m; }, mode);
  await page.route(GIS_SRC, (route) => route.fulfill({ contentType: 'text/javascript', body: FAKE_GIS }));
  await page.route('**/api/auth/google/config', (route) => {
    if (config === 'fail') return route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"boom"}' });
    return route.fulfill({
      contentType: 'application/json',
      headers: { 'cache-control': 'no-store' },
      body: JSON.stringify({ configured: true, popup: config === 'on', client_id: config === 'on' ? 'e2e-client-id' : null }),
    });
  });
  await page.route('**/api/auth/google/popup', async (route) => {
    const req = route.request();
    seen.popup.push({ headers: await req.allHeaders(), body: req.postDataJSON() });
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify(SIGNED_IN) });
  });
  // The redirect fallback: answer /start with a same-origin URL so the test
  // never leaves the preview, and count the call.
  await page.route('**/api/auth/google/start**', (route) => {
    seen.start += 1;
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ url: '/e2e-google-redirect' }) });
  });
  await page.route((url) => url.pathname === '/e2e-google-redirect' || url.pathname === '/studio', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>landed</title><p id="landed">landed</p>' }));
  return seen;
}

async function gisLoaded(page) {
  // The page asks /config at idle and then loads the library; hovering the
  // button primes both, as a person's pointer would.
  await page.getByTestId('login-google').hover();
  await page.waitForFunction(() => typeof window.google?.accounts?.oauth2?.initCodeClient === 'function', null, { timeout: 10_000 });
}

test.describe('Continue with Google opens Google’s window on /login (D722)', () => {
  test.beforeEach(() => requirePreview(test));

  test('a code from the window signs in and lands on /studio, with the header and the state cookie on the POST', async ({ page }) => {
    const seen = await stubGoogle(page, { mode: 'code' });
    await page.goto('/login');
    await gisLoaded(page);
    await page.getByTestId('login-google').click();
    await page.waitForURL((url) => url.pathname === '/studio', { timeout: 10_000 });

    expect(seen.popup.length, 'the page never posted the code').toBe(1);
    const [{ headers, body }] = seen.popup;
    expect(headers['x-requested-with']).toBe('XmlHttpRequest');
    expect(body.code).toBe('4/e2e-fake-code');
    expect(body.state).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(headers.cookie || '', 'the state cookie did not ride on the POST').toContain(`studioos_google_popup=${body.state}`);

    const stored = await page.evaluate(() => ({ token: localStorage.getItem('token'), user: localStorage.getItem('user') }));
    expect(stored.token).toBe(SIGNED_IN.token);
    expect(JSON.parse(stored.user || '{}').id).toBe(SIGNED_IN.user.id);
    expect(seen.start, 'a successful window also started the redirect').toBe(0);
  });

  test('the page hands Google the sign-in scope in popup mode, with the attempt’s state', async ({ page }) => {
    await stubGoogle(page, { mode: 'closed' });
    await page.goto('/login');
    await gisLoaded(page);
    await page.getByTestId('login-google').click();
    await expect(page.getByText('Google sign-in was cancelled. Nothing was changed.')).toBeVisible();
    const cfgs = await page.evaluate(() => window.__gisConfigs);
    expect(cfgs.length).toBe(1);
    expect(cfgs[0]).toMatchObject({ client_id: 'e2e-client-id', scope: 'openid email profile', ux_mode: 'popup', select_account: true });
    expect(cfgs[0].state).toMatch(/^[A-Za-z0-9_-]{43}$/);
    // The button is live again: a second press is a fresh attempt.
    await expect(page.getByTestId('login-google')).toBeEnabled();
  });

  test('a blocked window continues in this tab through /start', async ({ page }) => {
    const seen = await stubGoogle(page, { mode: 'blocked' });
    await page.goto('/login');
    await gisLoaded(page);
    const start = page.waitForRequest((r) => new URL(r.url()).pathname === '/api/auth/google/start', { timeout: 10_000 });
    await page.getByTestId('login-google').click();
    await start;
    await page.waitForURL((url) => url.pathname === '/e2e-google-redirect', { timeout: 10_000 });
    expect(seen.start).toBe(1);
    expect(seen.popup.length).toBe(0);
  });

  test('a config that fails still shows the button, and the click redirects', async ({ page }) => {
    const seen = await stubGoogle(page, { config: 'fail' });
    const asked = page.waitForResponse((r) => new URL(r.url()).pathname === '/api/auth/google/config', { timeout: 10_000 });
    await page.goto('/login');
    const button = page.getByTestId('login-google');
    await expect(button).toBeVisible();
    await expect(button).toHaveText(/Continue with Google/);
    await button.hover();
    expect((await asked).status()).toBe(500);
    expect(await page.evaluate(() => typeof window.google), 'Google’s library was loaded although the config failed').toBe('undefined');
    await button.click();
    await page.waitForURL((url) => url.pathname === '/e2e-google-redirect', { timeout: 10_000 });
    expect(seen.start).toBe(1);
    expect(seen.popup.length).toBe(0);
  });
});
