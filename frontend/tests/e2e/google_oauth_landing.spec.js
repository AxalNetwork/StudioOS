import { test, expect } from '@playwright/test';
import { requirePreview } from './_helpers.js';

/**
 * Regression: "Continue with Google" must NOT bounce the user back to the
 * sign-in page.
 *
 * The bug: the Worker's /api/auth/google/callback sets the session cookie
 * entirely server-side (httpOnly) and 302's to `/dashboard?google=ok`, so the
 * SPA boots with a valid cookie but EMPTY localStorage. RequireAuth used to
 * see no cached `user` and immediately <Navigate to="/login">. That landed the
 * user on AuthScreen, which treats any authenticated user on /login as an
 * "account switch" and tears the freshly-minted session down (clearSession ->
 * POST /api/auth/logout). Net effect: a successful Google round-trip dumped the
 * user straight back onto the login form.
 *
 * This reproduces the exact landing condition (cookie present, localStorage
 * empty, ?google=ok marker) and asserts the user is NOT bounced to /login and
 * that the session is NOT torn down. Prod-only path, so it runs against the
 * deployed preview worker (skips locally when PLAYWRIGHT_BASE_URL is unset).
 */
test.describe('Google sign-in landing (post-OAuth, server-cookie only)', () => {
  test.beforeEach(() => requirePreview(test));

  test('landing on /dashboard?google=ok with cookie + empty localStorage does not bounce to /login or log out', async ({ page }) => {
    const email = process.env.PLAYWRIGHT_FOUNDER_EMAIL;
    const password = process.env.PLAYWRIGHT_FOUNDER_PASSWORD;
    if (!email || !password) {
      throw new Error('Missing PLAYWRIGHT_FOUNDER_EMAIL/_PASSWORD secret');
    }

    // Establish ONLY the session cookie (no localStorage token) — this is how
    // the Google callback signs a user in: the cookie is minted server-side
    // and the SPA's localStorage starts empty. page.request shares the browser
    // context cookie jar, so the cookie rides along on the subsequent goto.
    const res = await page.request.post('/api/auth/login', { data: { email, password } });
    expect(res.ok(), `seed login failed: ${res.status()}`).toBeTruthy();

    // Belt-and-braces: guarantee localStorage is empty on the landing nav so
    // we exercise the cookie-only post-OAuth path, not a cached-user fast path.
    await page.addInitScript(() => { try { localStorage.clear(); } catch { /* ignore */ } });

    // Fail the test if the SPA tears the session down (the old bug's tell).
    let logoutCalled = false;
    page.on('request', (r) => {
      if (/\/api\/auth\/logout/i.test(r.url())) logoutCalled = true;
    });

    await page.goto('/dashboard?google=ok');
    // Give useAuthSync's forced /me probe + any onboarding/role gate time to
    // settle (the "Signing you in…" spinner shows during this window).
    await page.waitForLoadState('networkidle').catch(() => {});
    await page.waitForTimeout(2_000);

    expect(page.url(), 'user was bounced back to the sign-in page').not.toContain('/login');
    expect(logoutCalled, 'the freshly-minted Google session was torn down (clearSession -> logout)').toBeFalsy();
  });
});
