import { test, expect, type APIRequestContext, type Page } from '@playwright/test';

/**
 * Task #41 — investor Trust Center end-to-end (Y-2 LockedFounderCard).
 *
 * Drives the dev FastAPI backend on http://localhost:5000 (the
 * playwright.config.ts default `baseURL`) using the dev-only
 * `/api/auth/dev/quick-login` endpoint added in Task #41 — no env
 * vars, no TOTP secrets, no Turnstile required.
 *
 * Flow:
 *   1. POST /api/auth/dev/quick-login → JWT for `demo-investor@axal.test`.
 *   2. Seed `localStorage` with the token + user shape the frontend
 *      AuthProvider expects, then navigate to /deals.
 *   3. Find the seeded "Demo Trust Center Co." deal, expand it.
 *   4. Assert the LockedFounderCard renders with the "Request intro"
 *      button.
 *   5. Click "Request intro" → assert the card flips to
 *      "Intro pending — sign NDA".
 *
 * The seed (backend/app/services/demo_seed.py) runs on every FastAPI
 * startup so the demo user + founder + project + deal always exist
 * locally. The trust intro flow is backed by the dev-only
 * `/trust/intro/{request,status}` stub in backend/app/api/routes/trust.py
 * which writes to the `dev_pairwise_ndas` table — a real 3-way
 * envelope creation is not exercised here (that is covered by the
 * worker-side `cloudflare-worker/test/trust_intro.test.mjs`).
 */

const DEMO_PROJECT_NAME = 'Demo Trust Center Co.';

async function devQuickLoginAsInvestor(request: APIRequestContext, page: Page) {
  const res = await request.post('/api/auth/dev/quick-login', {
    data: {},
    headers: { 'content-type': 'application/json' },
  });
  expect(
    res.ok(),
    `dev/quick-login failed (${res.status()}): ${await res.text().catch(() => '')}`,
  ).toBeTruthy();
  const body = await res.json();
  expect(body?.token, 'no token returned').toBeTruthy();
  expect(String(body?.user?.role || '').toLowerCase()).toBe('investor');

  // Seed localStorage BEFORE the SPA mounts so AuthProvider picks up
  // the token on first render. The frontend reads `token` + `user`
  // from localStorage (see frontend/src/lib/api.js + useAuthSync.jsx).
  // We do this by navigating to a tiny sentinel page first — the
  // LoginPage renders without auth and is cheapest.
  await page.goto('/login');
  await page.evaluate(({ token, user }) => {
    localStorage.setItem('token', token);
    localStorage.setItem('user', JSON.stringify(user));
  }, { token: body.token, user: body.user });
}

// Opt-in gate. Chromium needs system libs (libglib-2.0.so.0 et al)
// that the Replit/NixOS shell does not expose to Playwright's bundled
// browser binary, so by default we skip rather than fail noisily.
// Set E2E_RUN_INVESTOR_DEMO=1 in any environment with a working
// chromium (CI, a local Linux box, etc.) to actually execute. The
// dev FastAPI backend must be reachable at the playwright `baseURL`
// (defaults to http://localhost:5000); no other env vars are required
// — Task #41 added a dev-only quick-login that bypasses TOTP/Turnstile.
const RUN_LOCAL = process.env.E2E_RUN_INVESTOR_DEMO === '1';

test.describe('Investor · Trust Center — LockedFounderCard intro flow', () => {
  test.skip(
    !RUN_LOCAL,
    'Set E2E_RUN_INVESTOR_DEMO=1 to run. Replit/NixOS shells lack the ' +
      "system libs Playwright's bundled chromium needs (libglib-2.0.so.0); " +
      'run from CI or a Linux box with `npx playwright install --with-deps`. ' +
      'Backend smoke-tested via curl: /api/auth/dev/quick-login returns a ' +
      'JWT, /api/trust/intro/{request,status} drive the dev_pairwise_ndas ' +
      'state machine the LockedFounderCard reads.',
  );

  test('demo investor signs in, expands a deal, requests intro, sees Intro pending', async ({
    page,
    request,
  }) => {
    await devQuickLoginAsInvestor(request, page);

    // Reset any pre-existing pending row so the test is reproducible
    // across local re-runs. We do this via the worker auth header
    // attached automatically by the dev backend's session cookie.
    // (No reset endpoint exists; instead we tolerate either button
    // text below — fresh run shows "Request intro", repeat run may
    // start at "Intro pending — sign NDA".)

    await page.goto('/deals');

    // The deal row uses the project name as its label.
    const dealRow = page.locator('div', { hasText: DEMO_PROJECT_NAME }).first();
    await expect(
      dealRow,
      `Demo deal "${DEMO_PROJECT_NAME}" not found on /deals — is the FastAPI lifespan seeder running?`,
    ).toBeVisible({ timeout: 15_000 });

    // Click the row's expand chevron. The button has aria-label
    // "Expand" / "Collapse" (DealsPage.jsx:163). Find the closest one
    // inside the deal row's container.
    const dealCard = dealRow.locator('xpath=ancestor::div[contains(@class,"rounded-xl")][1]');
    const expandBtn = dealCard.getByRole('button', { name: /Expand|Collapse/ }).first();
    await expandBtn.click();

    // The LockedFounderCard renders inside the expanded section. It
    // shows either "Request intro" (idle) or "Intro pending — sign NDA"
    // (already requested). Accept both for re-run resilience and
    // assert the post-click state matches "Intro pending".
    const requestBtn = dealCard.getByRole('button', { name: /Request intro/ });
    const pendingBtn = dealCard.getByRole('button', { name: /Intro pending — sign NDA/ });

    await expect(requestBtn.or(pendingBtn)).toBeVisible({ timeout: 10_000 });

    if (await requestBtn.isVisible().catch(() => false)) {
      await requestBtn.click();
    }

    await expect(
      pendingBtn,
      'card did not flip to "Intro pending — sign NDA" after Request intro click',
    ).toBeVisible({ timeout: 10_000 });
  });
});
