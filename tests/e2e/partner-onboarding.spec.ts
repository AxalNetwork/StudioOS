import { test, expect, type APIRequestContext, type Page } from '@playwright/test';

/**
 * Task #35 — Partner onboarding chatbot end-to-end.
 *
 * Walks the full happy-path the X-2 spec ships:
 *
 *   1. Admin signs in, opens /admin/partners, opens "New Invitation",
 *      enters a unique recipient email, leaves the default
 *      `equity_partnership` deal-type checked, submits.
 *   2. Captures the magic link from the success-state input.
 *   3. Opens the magic link in a fresh, cookie-less context (the
 *      `/partner-onboarding/:token` route is unauthenticated).
 *   4. Walks the partner through the chatbot — answers every
 *      question the composer presents (the question count is
 *      6–10 depending on which deal types the admin allowed).
 *   5. Picks the first proposal and clicks "Send for e-signature".
 *   6. Asserts the signing redirect appears (the "Open signing page"
 *      link rendered after /finalize returns).
 *   7. Goes back to the admin panel, revokes the invitation, and
 *      asserts the cascade — the in-flight deal + the e-sign
 *      envelope are voided too (worker
 *      cloudflare-worker/src/routes/admin_partners.ts:159 returns
 *      `voided_deals` + `voided_envelopes` in the JSON body).
 *
 * The terminate cascade (a separate state-machine path, only
 * reachable AFTER the partner_msa_v1 envelope is signed) is
 * covered by a second test in this file. That test drives the
 * onboarding flow via the worker API (faster + deterministic),
 * POSTs a real PNG signature to /api/legal/esign/sign/<token>
 * — which triggers `activatePartnerDealOnSignature` and flips
 * the deal to status='active' — then drives Terminate through
 * the admin UI and asserts `tiers_revoked` came back true on
 * the JSON response (admin_partners.ts:423).
 *
 * IMPORTANT — exercises real worker routes the dev FastAPI does
 * NOT host (`/api/admin/partners/*`, `/api/partner-onboard/*`,
 * `/api/legal/esign/*`). Run against a worker:
 *
 *   E2E_BASE_URL=https://axal.vc \
 *   E2E_ADMIN_EMAIL=admin@example.com \
 *   E2E_ADMIN_PASSWORD=... \
 *   npx playwright test tests/e2e/partner-onboarding.spec.ts
 *
 * If the env vars are missing the test is skipped with a clear
 * message rather than failing noisily.
 */

const BASE_URL = process.env.E2E_BASE_URL || '';
const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL || '';
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD || '';

function uniqueRecipient(): string {
  const stamp = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 8);
  return `e2e-task35-${stamp}-${rand}@example.test`;
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

/**
 * Walk the chatbot until the composer is no longer present. We don't
 * hard-code the question count because it's adaptive (6–10 questions
 * keyed off the admin-allowed deal types — see PartnerOnboardPage.jsx
 * `pickQuestionsFor`). For each step, fills the visible input/textarea
 * and clicks Send. Caps the loop at 12 to avoid infinite runs if a UI
 * regression ever fails to advance the step.
 */
async function answerEntireChat(page: Page) {
  const sendButton = page.getByRole('button', { name: /^Send$/ });
  for (let i = 0; i < 12; i++) {
    if (!(await sendButton.isVisible().catch(() => false))) return;
    // The composer is the only enabled, visible text input/textarea on
    // the wizard page. Look it up fresh each iteration since the
    // element type alternates between <input> and <textarea> per
    // QUESTION_BANK[step].textarea.
    const field = page
      .locator('textarea:visible:enabled, input[type="text"]:visible:enabled, input[type="number"]:visible:enabled')
      .first();
    await expect(field).toBeVisible();
    // Use deterministic answers per question — values don't matter for
    // the cron/proposal logic but must be non-empty so the chatbot
    // accepts the turn. Numeric questions get a number; everything
    // else gets a short text answer.
    const isNumeric = (await field.getAttribute('type')) === 'number';
    await field.fill(isNumeric ? '250000' : `e2e answer ${i + 1}`);
    await sendButton.click();
    // Tiny settle for the next turn to render before re-querying.
    await page.waitForTimeout(150);
  }
  // If we got here the chatbot never finished — fail loudly with the
  // current chat-bubble count to make the regression obvious.
  const bubbles = await page.locator('[aria-live="polite"] > *').count();
  throw new Error(`chatbot did not finish after 12 turns (chat bubbles: ${bubbles})`);
}

test.describe('Partner onboarding — admin → chatbot → finalize → revoke cascade', () => {
  test.skip(
    !BASE_URL || !ADMIN_EMAIL || !ADMIN_PASSWORD,
    'Set E2E_BASE_URL, E2E_ADMIN_EMAIL, E2E_ADMIN_PASSWORD to run this test ' +
      'against a worker (prod or `wrangler dev`). The dev FastAPI backend ' +
      'does not host /api/admin/partners/* or /api/partner-onboard/*.',
  );

  test('admin invites partner, partner completes wizard through e-sign, admin revokes cascading void', async ({
    page,
    browser,
    request,
  }) => {
    const recipient = uniqueRecipient();

    /* ----- 1. Admin: open the partner-invitations panel ------------- */
    await loginAsAdmin(request, page);
    await page.goto('/admin/partners');
    await expect(
      page.getByRole('heading', { name: /Partner Invitations/i }),
    ).toBeVisible();

    /* ----- 2. Admin: create a new invitation ------------------------ */
    await page.getByRole('button', { name: /New Invitation/i }).click();
    const modal = page.getByRole('heading', { name: /New Partner Invitation/i });
    await expect(modal).toBeVisible();
    // Recipient email is the only required field; equity_partnership
    // is checked by default.
    await page.locator('input[type="email"]').first().fill(recipient);

    const createResponse = page.waitForResponse(
      (r) =>
        r.url().includes('/api/admin/partners/invitations') &&
        r.request().method() === 'POST',
    );
    await page.getByRole('button', { name: /Send Invitation/i }).click();
    const created = await createResponse;
    expect(
      created.ok(),
      `createInvitation failed (${created.status()}): ${await created.text().catch(() => '')}`,
    ).toBeTruthy();

    // Modal flips to a success view containing a readonly input with
    // the magic link. Capture it before the modal auto-closes (1.5s).
    const linkInput = page.locator('input[readonly]').first();
    await expect(linkInput).toBeVisible({ timeout: 5_000 });
    const magicLink = await linkInput.inputValue();
    expect(magicLink, 'magic link should be a partners/onboard URL').toMatch(
      /\/partners\/onboard\?token=[0-9a-f]{16,}/,
    );

    /* ----- 3. Partner: open the magic link in a fresh context ------- */
    // Fresh context = no admin cookies. The onboarding route is
    // public token-gated; auth headers would not affect it but using
    // a clean context proves the token alone authenticates.
    const partnerContext = await browser.newContext({ baseURL: BASE_URL });
    const partnerPage = await partnerContext.newPage();
    await partnerPage.goto(magicLink);

    // Wizard header proves the invitation loaded (GET /:token flips
    // status sent → viewed and renders the chatbot).
    await expect(
      partnerPage.getByRole('heading', { name: /Partner Onboarding/i }),
    ).toBeVisible({ timeout: 10_000 });

    /* ----- 4. Partner: walk the chatbot end-to-end ------------------ */
    await answerEntireChat(partnerPage);

    /* ----- 5. Partner: select the first proposal -------------------- */
    // Proposals auto-fetch once the profile is saved (useEffect on
    // profileDone). Wait for at least one ProposalCard to render.
    const chooseButton = partnerPage
      .getByRole('button', { name: /Choose this/i })
      .first();
    await expect(chooseButton).toBeVisible({ timeout: 15_000 });
    const selectResponse = partnerPage.waitForResponse(
      (r) =>
        r.url().includes('/api/partner-onboard/') &&
        r.url().endsWith('/select') &&
        r.request().method() === 'POST',
    );
    await chooseButton.click();
    expect((await selectResponse).ok()).toBeTruthy();

    /* ----- 6. Partner: finalize → e-sign envelope ------------------- */
    const sendForSig = partnerPage.getByRole('button', {
      name: /Send for e-signature/i,
    });
    await expect(sendForSig).toBeVisible();
    const finalizeResponse = partnerPage.waitForResponse(
      (r) =>
        r.url().includes('/api/partner-onboard/') &&
        r.url().endsWith('/finalize') &&
        r.request().method() === 'POST',
    );
    await sendForSig.click();
    const finalized = await finalizeResponse;
    expect(
      finalized.ok(),
      `finalize failed (${finalized.status()}): ${await finalized.text().catch(() => '')}`,
    ).toBeTruthy();

    // The signing redirect — either the in-page link or the
    // "Envelope sent" success block. The link is the strongest
    // signal that the partner has somewhere to go to sign.
    const signingLink = partnerPage.getByRole('link', {
      name: /Open signing page/i,
    });
    await expect(signingLink).toBeVisible({ timeout: 10_000 });
    const signingHref = await signingLink.getAttribute('href');
    expect(signingHref, 'signing href must point at /esign/<token>').toMatch(
      /\/esign\/[0-9a-f-]{8,}/,
    );

    await partnerContext.close();

    /* ----- 7. Admin: revoke + assert cascade ------------------------ */
    // The deal is in status='awaiting_signature' and the envelope is
    // in status='sent' — both should be voided by the revoke path.
    await page.goto('/admin/partners');
    // Filter to this recipient so the row is unambiguous.
    await page
      .getByPlaceholder(/email/i)
      .first()
      .fill(recipient);
    // Wait a tick for the debounce / re-render.
    await page.waitForTimeout(500);

    // Each row carries a Revoke button (Ban icon). We narrow by the
    // recipient email to the right row, then trigger revoke.
    const row = page.locator('div', { hasText: recipient }).first();
    await expect(row).toBeVisible();
    await page.getByRole('button', { name: /^Revoke$/i }).first().click();

    const revokeModal = page.getByRole('heading', { name: /Revoke invitation/i });
    await expect(revokeModal).toBeVisible();

    const revokeResponse = page.waitForResponse(
      (r) =>
        /\/api\/admin\/partners\/invitations\/\d+\/revoke$/.test(r.url()) &&
        r.request().method() === 'POST',
    );
    // The confirm button inside the revoke modal — the only red
    // primary CTA in the modal.
    await page
      .getByRole('button', { name: /^Revoke$/i })
      .last()
      .click();
    const revoked = await revokeResponse;
    expect(
      revoked.ok(),
      `revoke failed (${revoked.status()}): ${await revoked.text().catch(() => '')}`,
    ).toBeTruthy();

    // Cascade assertion: voided_deals ≥ 1 (the just-finalized deal)
    // and voided_envelopes ≥ 1 (the just-sent envelope). This is the
    // contract admin_partners.ts:212 returns to the UI.
    const revokedBody = await revoked.json();
    expect(revokedBody.ok).toBe(true);
    expect(revokedBody.voided_deals,
      'revoke should void the in-flight deal').toBeGreaterThanOrEqual(1);
    expect(revokedBody.voided_envelopes,
      'revoke should void the just-started envelope').toBeGreaterThanOrEqual(1);
  });

  /* ================================================================ */
  /* Terminate cascade — separate test because terminate requires the */
  /* deal to be in status='active', which requires a fully-signed     */
  /* partner_msa_v1 envelope. Drives the onboarding flow over the    */
  /* worker API (faster + deterministic — the chatbot UI is already  */
  /* exercised by the test above), POSTs a real PNG signature, and   */
  /* asserts the terminate JSON cascade contract (tiers_revoked).    */
  /* ================================================================ */

  // 1×1 transparent PNG (smallest valid PNG that passes the
  // SIGNATURE_DATAURL_PREFIX check + size cap in esign.ts:717).
  const TINY_PNG_DATA_URL =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkAAIAAAoAAv/lxKUAAAAASUVORK5CYII=';

  test('admin terminate cascades on a signed (active) partner deal', async ({
    page,
    request,
  }) => {
    const recipient = uniqueRecipient();
    await loginAsAdmin(request, page);

    // ---- Drive the partner-onboarding flow via the worker API ---------
    // (each step calls the SAME public route the wizard UI hits; the
    // chatbot path is covered visually by the test above.)
    const inv = await (await request.post('/api/admin/partners/invitations', {
      data: {
        recipient_email: recipient,
        recipient_name: 'E2E Partner',
        // equity_partnership grants a tier on activation so we have
        // something for terminate to revoke.
        allowed_deal_types: ['equity_partnership'],
      },
      headers: { 'content-type': 'application/json' },
    })).json();
    const token = inv.token as string;
    expect(token, 'admin create returned a token').toBeTruthy();

    // Profile (chatbot answers) — minimum that buildProposals expects.
    const profileRes = await request.post(`/api/partner-onboard/${token}/profile`, {
      data: {
        full_name: 'E2E Partner',
        organization: 'E2E Test LLC',
        role_title: 'Operating Partner',
        expertise: 'B2B SaaS GTM',
        sectors: 'AI, Climate',
        capacity_per_month: '5-10 hours / month',
        motivation: 'e2e coverage',
        raw_chat_json: { e2e: true },
      },
      headers: { 'content-type': 'application/json' },
    });
    expect(profileRes.ok(), `profile failed: ${await profileRes.text()}`).toBeTruthy();

    const proposeRes = await request.post(`/api/partner-onboard/${token}/propose`, {
      data: {},
      headers: { 'content-type': 'application/json' },
    });
    expect(proposeRes.ok()).toBeTruthy();
    const propose = await proposeRes.json();
    expect(propose.proposals?.length, 'at least one proposal').toBeGreaterThan(0);

    const selectRes = await request.post(`/api/partner-onboard/${token}/select`, {
      data: { proposal_id: 1 },
      headers: { 'content-type': 'application/json' },
    });
    expect(selectRes.ok()).toBeTruthy();

    const finalizeRes = await request.post(`/api/partner-onboard/${token}/finalize`, {
      data: {},
      headers: { 'content-type': 'application/json' },
    });
    expect(
      finalizeRes.ok(),
      `finalize failed (${finalizeRes.status()}): ${await finalizeRes.text()}`,
    ).toBeTruthy();
    const finalize = await finalizeRes.json();
    // signing_url is `${appUrl}/esign/<sign-token>`. Pull the sign-token.
    const signMatch = String(finalize.signing_url || '').match(/\/esign\/([0-9a-f-]+)/i);
    expect(signMatch, 'finalize returned a sign token').not.toBeNull();
    const signToken = signMatch![1];

    // POST the partner's signature — the recipient row has user_id IS
    // NULL (createAndSendEnvelope was called with recipientUserId:null
    // per partner_onboarding.ts:321), so the signer-identity gate
    // doesn't apply and anonymous bearer access is allowed.
    const signRes = await request.post(`/api/legal/esign/sign/${signToken}`, {
      data: {
        signature_data_url: TINY_PNG_DATA_URL,
        accepted: true,
        typed_name: 'E2E Partner',
      },
      headers: { 'content-type': 'application/json' },
    });
    expect(
      signRes.ok(),
      `signature submit failed (${signRes.status()}): ${await signRes.text()}`,
    ).toBeTruthy();
    // After this returns 2xx, esign.ts:882 has run
    // activatePartnerDealOnSignature → partner_deals.status = 'active'.

    // Sanity: the deal is now visible in the active-deals list.
    const dealsRes = await request.get('/api/admin/partners/deals?status=active');
    expect(dealsRes.ok()).toBeTruthy();
    const deals = await dealsRes.json();
    const myDeal = (deals.items || []).find(
      (d: any) => String(d.partner_email || '').toLowerCase() === recipient.toLowerCase(),
    );
    expect(myDeal, 'just-signed deal should appear under status=active').toBeTruthy();

    // ---- Drive Terminate from the admin UI ---------------------------
    await page.goto('/admin/partners');
    await page.getByRole('button', { name: /^Deals/i }).first().click();
    // The Terminate button on the row carries a Ban icon + "Terminate" text.
    const terminateRow = page
      .getByRole('button', { name: /^Terminate$/i })
      .first();
    await expect(terminateRow).toBeVisible({ timeout: 10_000 });
    await terminateRow.click();

    await expect(
      page.getByRole('heading', { name: /Terminate deal/i }),
    ).toBeVisible();
    // Reason is required — the modal disables the confirm CTA when blank.
    await page
      .getByPlaceholder(/Reason \(required/i)
      .fill('e2e termination');

    const terminateResponse = page.waitForResponse(
      (r) =>
        /\/api\/admin\/partners\/deals\/\d+\/terminate$/.test(r.url()) &&
        r.request().method() === 'POST',
    );
    await page
      .getByRole('button', { name: /^Terminate Deal$/i })
      .click();
    const terminated = await terminateResponse;
    expect(
      terminated.ok(),
      `terminate failed (${terminated.status()}): ${await terminated.text()}`,
    ).toBeTruthy();

    // Cascade contract: tiers_revoked is true when the deal carries
    // any granted tier (equity_partnership grants founder_pro +
    // professional — see partnerDeals.ts:89-90), and redemptions_revoked
    // counts downstream redeemers (zero in this fresh test).
    const terminatedBody = await terminated.json();
    expect(terminatedBody.ok).toBe(true);
    expect(
      terminatedBody.tiers_revoked,
      'terminate should revoke the equity_partnership tier grants',
    ).toBe(true);
    expect(
      typeof terminatedBody.redemptions_revoked,
      'redemptions_revoked is part of the cascade contract',
    ).toBe('number');
  });
});
