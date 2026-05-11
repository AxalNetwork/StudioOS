/**
 * Task #10 (AP) — Shared helpers for the post-AO verification smoke.
 *
 * Every spec calls `requirePreview(test)` at the top of its describe
 * block so the entire suite no-ops cleanly when PLAYWRIGHT_BASE_URL is
 * unset (local dev / first-time CI before the preview env is ready).
 *
 * Auth strategy: a seeded admin + founder live in the preview D1 with
 * fixed credentials provided via PLAYWRIGHT_ADMIN_EMAIL / _PASSWORD and
 * PLAYWRIGHT_FOUNDER_EMAIL / _PASSWORD secrets. Each spec calls
 * `loginAs(page, 'admin'|'founder')` which performs a real /api/auth/login
 * and stores the session via cookie + localStorage so subsequent
 * navigations skip the login page.
 */

export function requirePreview(test) {
  const url = process.env.PLAYWRIGHT_BASE_URL;
  if (!url) {
    test.skip(true, 'PLAYWRIGHT_BASE_URL not set — preview env not provisioned (Task #15 follow-up).');
  }
}

export async function loginAs(page, who = 'founder') {
  const email = who === 'admin'
    ? process.env.PLAYWRIGHT_ADMIN_EMAIL
    : process.env.PLAYWRIGHT_FOUNDER_EMAIL;
  const password = who === 'admin'
    ? process.env.PLAYWRIGHT_ADMIN_PASSWORD
    : process.env.PLAYWRIGHT_FOUNDER_PASSWORD;
  if (!email || !password) {
    throw new Error(`Missing PLAYWRIGHT_${who.toUpperCase()}_EMAIL/_PASSWORD secret`);
  }
  // Use the API directly (bypasses the visual login page so spec failures
  // are isolated to the surface under test, not the login UI). The
  // worker sets the auth cookie and returns a Bearer token; mirror the
  // token into localStorage so the SPA's getAuthHeaders() picks it up.
  const res = await page.request.post('/api/auth/login', {
    data: { email, password },
  });
  if (!res.ok()) {
    throw new Error(`Login failed for ${who}: ${res.status()} ${await res.text()}`);
  }
  const body = await res.json();
  await page.addInitScript((token) => {
    localStorage.setItem('token', token);
  }, body.access_token || body.token || '');
}
