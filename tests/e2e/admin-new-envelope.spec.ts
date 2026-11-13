import { test, expect, type APIRequestContext, type Page } from '@playwright/test';

/**
 * Task #21 — admins can send any new template end-to-end.
 *
 * Flow under test (matches `frontend/src/pages/AdminPage.jsx`
 * NewEnvelopeWizard + LegalPanel and the worker route
 * `cloudflare-worker/src/routes/admin_contracts.ts`):
 *
 *   1. sign in as admin
 *   2. navigate to Admin > Legal
 *   3. open "New envelope" wizard
 *   4. pick the `investor_nda_axal` template (rendered as
 *      "Investor NDA (Axal) v1" in the catalog)
 *   5. enter a unique recipient email and submit
 *   6. assert the row appears in the unified list with the
 *      friendly label "Investor NDA (Axal)"
 *   7. switch the party-role chip to `investor` and assert the
 *      same row is still visible
 *
 * IMPORTANT — this test exercises real worker routes that the
 * dev FastAPI backend does NOT host:
 *   - GET  /api/admin/contracts/templates/legal  (catalog)
 *   - POST /api/legal/esign/send                 (create envelope)
 *
 * Run it against either the production worker or `wrangler dev`:
 *
 *   E2E_BASE_URL=https://axal.vc \
 *   E2E_ADMIN_EMAIL=admin@example.com \
 *   E2E_ADMIN_PASSWORD=... \
 *   npx playwright test
 *
 * Task #44 — both endpoints are now stubbed in the dev FastAPI backend
 * so the wizard works against the local stack on `http://localhost:5000`
 * (the playwright.config.ts default `baseURL`) without setting
 * `E2E_BASE_URL`. Admin credentials are still required to actually run
 * the test — if `E2E_ADMIN_EMAIL`/`E2E_ADMIN_PASSWORD` are missing we
 * skip cleanly rather than failing noisily.
 */

const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL || '';
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD || '';
const TEMPLATE_DOC_TYPE = 'investor_nda_axal';
const TEMPLATE_LABEL = 'Investor NDA (Axal)';

function uniqueRecipient(): string {
  const stamp = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 8);
  return `e2e-task21-${stamp}-${rand}@example.test`;
}

async function loginAsAdmin(request: APIRequestContext, page: Page) {
  // Hit the worker login endpoint directly so we land on /app already
  // authenticated; this avoids brittle homepage/login-form selectors.
  const res = await request.post('/api/auth/login', {
    data: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
    headers: { 'content-type': 'application/json' },
  });
  expect(
    res.ok(),
    `login failed (${res.status()}): ${await res.text().catch(() => '')}`,
  ).toBeTruthy();

  // /api/auth/me must report the admin role — otherwise the Admin tab
  // won't render and the rest of the test is meaningless.
  const me = await request.get('/api/auth/me');
  expect(me.ok(), 'auth/me failed after login').toBeTruthy();
  const meBody = await me.json();
  expect(
    String(meBody?.role || '').toLowerCase(),
    'logged-in user is not an admin',
  ).toBe('admin');

  // Hand the auth cookies to the browser context.
  const storage = await request.storageState();
  await page.context().addCookies(storage.cookies);
}

test.describe('Admin · Legal — New envelope wizard', () => {
  test.skip(
    !ADMIN_EMAIL || !ADMIN_PASSWORD,
    'Set E2E_ADMIN_EMAIL and E2E_ADMIN_PASSWORD to run this test. ' +
      'Defaults to baseURL=http://localhost:5000 (Task #44 stubbed both ' +
      'wizard endpoints in the dev FastAPI backend); set E2E_BASE_URL to ' +
      'override (e.g. https://axal.vc or wrangler dev).',
  );

  test('admin can send investor_nda_axal template and see it in the unified list', async ({
    page,
    request,
  }) => {
    const recipient = uniqueRecipient();

    await loginAsAdmin(request, page);

    // Navigate to Admin > Legal. AdminPage doesn't sync the active tab from
    // the URL query, so click the Legal tab explicitly to open its panel.
    await page.goto('/admin?tab=legal');
    await page.getByTestId('admin-tab-legal').click();
    await expect(
      page.getByRole('button', { name: 'New envelope' }),
    ).toBeVisible();

    // 1. Open the wizard.
    await page.getByRole('button', { name: 'New envelope' }).click();
    const wizard = page.getByRole('heading', { name: 'New envelope (admin)' });
    await expect(wizard).toBeVisible();

    // 2. Pick the investor_nda_axal template by its option value
    //    (avoids depending on the exact catalog title text).
    const templateSelect = page.locator('select').first();
    await expect(templateSelect).toBeEnabled();
    await templateSelect.selectOption(TEMPLATE_DOC_TYPE);

    // 3. Fill the first recipient row.
    await page
      .locator('input[type="email"]')
      .first()
      .fill(recipient);

    // 4. Submit and wait for the POST to /api/legal/esign/send.
    const sendResponse = page.waitForResponse(
      (r) =>
        r.url().includes('/api/legal/esign/send') && r.request().method() === 'POST',
    );
    await page
      .getByRole('button', { name: /^Send \d+ envelope/i })
      .click();
    const sent = await sendResponse;
    expect(
      sent.ok(),
      `esign/send failed (${sent.status()}): ${await sent.text().catch(() => '')}`,
    ).toBeTruthy();

    // The wizard auto-closes via onSent() and the list reloads.
    await expect(wizard).toBeHidden();

    // 5. The new row should appear in "All Contracts" with the friendly
    //    label rendered through ContractRow's title (worker decorates the
    //    row with `doc_type_label = 'Investor NDA (Axal)'` for that
    //    doc_type — see `cloudflare-worker/src/routes/admin_contracts.ts`).
    await page
      .getByPlaceholder(/Search title, recipient, project, template/i)
      .fill(recipient);
    await page.getByRole('button', { name: 'Search' }).click();

    const row = page.locator('button', { hasText: recipient }).first();
    await expect(row).toBeVisible();
    await expect(row).toContainText(TEMPLATE_LABEL);

    // 6. Switch the party-role filter to `investor` and assert the row
    //    is still visible. The party-role <select> is the second select
    //    in the filters row (after the doc-type filter).
    const partyRoleSelect = page.locator(
      'form select[title*="Filter by which party"]',
    );
    await partyRoleSelect.selectOption('investor');
    await expect(
      page.locator('button', { hasText: recipient }).first(),
    ).toBeVisible();

    // Negative control: switching to `founder` should hide it (an
    // investor_nda_axal envelope has party_roles=[investor, axal]).
    await partyRoleSelect.selectOption('founder');
    await expect(
      page.locator('button', { hasText: recipient }),
    ).toHaveCount(0);
  });
});
