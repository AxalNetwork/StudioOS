/**
 * #8537 (D8537): the public journey in a real browser, at 1440 and at 390 px — a new visitor from the landing page to
 * a plan and back to it after signing up, a signed-out founder from a shared Grow action through sign-in and back to
 * that action, and a founder whose session ended getting back in by the email link to the page they were on.
 *
 * On every page the journey opens: nothing is wider than the window, axe finds no serious or critical WCAG 2.0/2.1
 * A or AA violation (as `axe-top-routes.spec.js` gates), and where the page moves focus or shows an error it is
 * checked: the sign-in steps put focus on their heading, a refused field is `aria-invalid` and names its message with
 * `aria-describedby`, the message is `role="alert"` text, and one failed read (one request answered 503) leaves a
 * readable error with a retry that works, never a blank page.
 *
 * NO PREVIEW, NO ACCOUNT, NO EMAIL. `startLocalWorker()` (`_helpers.js`) serves the built SPA and answers the email-link
 * sign-in as `cloudflare-worker/src/routes/auth.ts` does, with the link written to its in-memory outbox; the spec reads
 * the link there and opens it, as the person would from their inbox. Its accounts and every other answer are invented
 * fixtures; off-origin requests are aborted. Nothing here runs against production.
 *
 * What is NOT in the app is a skipped test that names the gap (D8537 lists them): focus is not moved on arrival at the
 * public pages, and the Account recovery email link does not return to the page the person started from.
 *
 *   npm run build                                   (repo root)
 *   cd frontend && npx --no-install playwright test -c playwright.config.js tests/e2e/public_journey.spec.js --trace off
 */
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { CONSENT_VERSION } from '../../src/lib/cookieConsent.js';
import { MAGIC_LANDING, controlledBrowser, startLocalWorker } from './_helpers.js';

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];
const usd = (unit_amount) => ({ unit_amount, currency: 'usd', allowance_microusd: 1_000_000 });
const price = (unit_amount, interval) => ({ ...usd(unit_amount), interval, interval_count: 1 });
/** The public catalogue, with synthetic prices on the two paid Founder plans. */
const CATALOGUE = {
  plans: [
    { family: 'founder', licence_key: 'founder:free', free: true, prices: [] },
    { family: 'founder', licence_key: 'founder:growth', catalogue: { key: 'founder:growth' }, product_id: 'prod_synthetic_growth', prices: [price(5000, 'month'), price(48000, 'year')], monthly: usd(5000), yearly: usd(48000) },
    { family: 'founder', licence_key: 'founder:studio', catalogue: { key: 'founder:studio' }, product_id: 'prod_synthetic_studio', prices: [price(10000, 'month')], monthly: usd(10000) },
  ],
  packs: [],
};
const VENTURE = { id: 8537, uid: 'p8537', name: 'Synthetic Venture', role: 'owner', is_owner: true };
const answers = ({ path, user }) => {
  if (path === '/api/public/plans-and-packs') return { json: CATALOGUE };
  if (path === '/api/projects' && user?.role === 'founder') return { json: [VENTURE] };
  return null;
};

const kept = (page) => page.evaluate(() => { try { return JSON.parse(localStorage.getItem('gvpn:next') || 'null')?.path ?? null; } catch { return null; } });
const pathOf = (page) => { const u = new URL(page.url()); return u.pathname; };

/**
 * Serious axe findings the app has today, each named in D8537 (G3) to be filed separately. Matched by rule and
 * element, so any other finding, or the same rule on another element, still fails the page.
 */
const KNOWN = [
  // The public header's logo link: named "Axal VC home", shows "Axal VC alpha".
  { id: 'label-content-name-mismatch', html: 'aria-label="Axal VC home"' },
  // The signed-in phone header's account button: named "Account", shows the member's initials.
  { id: 'label-content-name-mismatch', html: 'aria-label="Account"' },
  // Register's field error: red-600 on red-50, 4.36:1 at 12px.
  { id: 'color-contrast', html: 'id="register-error"' },
  // Grow's "Period" label (text-axal-faint); the phone cycle tabs' inactive labels and More (2.9:1); the signed-in
  // footer's copyright line and its Terms and Privacy links (gray-400 on white, 2.6:1).
  { id: 'color-contrast', html: 'text-axal-faint' },
  { id: 'color-contrast', target: 'link-mobile-tab-' },
  { id: 'color-contrast', target: 'More: open the menu' },
  { id: 'color-contrast', html: '© Copyright' },
  // The signed-in desktop sidebar's "Account" group label (gray-400 at 10px, 2.6:1).
  { id: 'color-contrast', html: '<span>Account</span>' },
  { id: 'color-contrast', html: 'hover:text-gray-700 dark:hover:text-gray-300 transition-colors' },
  // The Share an update steps list scrolls sideways at 390 and cannot be reached by keyboard.
  { id: 'scrollable-region-focusable', html: 'aria-label="Steps"' },
];
const known = (id, node) => KNOWN.some((k) => k.id === id && (!k.html || node.html.includes(k.html)) && (!k.target || node.target.join(' ').includes(k.target)));

/** No sideways scroll, and no serious or critical axe violation on the page as it stands beyond KNOWN. */
async function pageHolds(page, where) {
  const wider = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(wider, `${where}: the page is ${wider}px wider than the window`).toBeLessThanOrEqual(0);
  const { violations } = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  const blocking = violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .flatMap((v) => v.nodes.filter((n) => !known(v.id, n)).map((n) => `${v.impact} ${v.id}: ${n.target.join(' ')}`));
  expect(blocking, `${where}: axe`).toEqual([]);
}

/** A refused field: its message is alert text, and the field is invalid and names it. */
async function refused(page, label, errorId, text) {
  const field = page.getByLabel(label, { exact: true });
  await expect(page.locator(`#${errorId}`)).toHaveText(text);
  await expect(page.locator(`#${errorId}`)).toHaveAttribute('role', 'alert');
  await expect(field).toHaveAttribute('aria-invalid', 'true');
  expect((await field.getAttribute('aria-describedby') || '').split(/\s+/)).toContain(errorId);
}

/**
 * A read that fails: requests to `glob` answer 503 until `end()` (or only the first one, with `once`). A page may ask
 * for the same read from more than one component, so "one failed read" is the read, not one HTTP request.
 */
async function outage(page, glob, { once = false } = {}) {
  const state = { refused: 0, on: true, end() { state.on = false; } };
  await page.route(glob, async (route) => {
    if (!state.on) return route.fallback();
    state.refused += 1;
    if (once) state.on = false;
    return route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"Synthetic outage"}' });
  });
  return state;
}

/** The sign-in page's email-link steps, from its first step; returns once the link is in the outbox. */
async function emailLinkSignIn(page, worker, email, { checkSteps = false } = {}) {
  await page.getByRole('button', { name: 'Continue with Email', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Sign in with email' })).toBeFocused();
  if (checkSteps) await pageHolds(page, 'sign-in: choose a method');
  await page.locator('#signin-method-link').click();
  await expect(page.getByRole('heading', { level: 1, name: 'Email me a sign-in link' })).toBeFocused();
  if (checkSteps) {
    await pageHolds(page, 'sign-in: the link form');
    await page.getByRole('button', { name: 'Send sign-in link', exact: true }).click();
    await refused(page, 'Email', 'login-error', 'Enter your email.');
    await page.getByLabel('Email', { exact: true }).fill('not-an-address');
    await page.getByLabel('Email', { exact: true }).press('Enter');
    await refused(page, 'Email', 'login-error', 'Enter a valid email address (e.g. you@example.com).');
    await pageHolds(page, 'sign-in: a refused address');
    // One failed send: the reason is read out, and the same button sends again.
    const down = await outage(page, '**/api/auth/magic/start', { once: true });
    await page.getByLabel('Email', { exact: true }).fill(email);
    await page.getByRole('button', { name: 'Send sign-in link', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('Synthetic outage');
    expect(down.refused).toBe(1);
    expect(worker.outbox).toEqual([]);
  } else {
    await page.getByLabel('Email', { exact: true }).fill(email);
  }
  await page.getByRole('button', { name: 'Send sign-in link', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Check your email' })).toBeFocused();
  await expect(page.getByText(`Sign-in link sent to ${email}.`, { exact: true })).toBeVisible();
  if (checkSteps) await pageHolds(page, 'sign-in: check your email');
  return worker.linkFor(email);
}

test('the local Worker lands the email link where auth.ts does', () => {
  // The harness copies two facts from the Worker; if the Worker moves either, the journeys below test the wrong thing.
  const auth = readFileSync(fileURLToPath(new URL('../../../cloudflare-worker/src/routes/auth.ts', import.meta.url)), 'utf8');
  expect(auth).toContain("const landing = newSignup ? '/onboarding/chat' : '/dashboard';");
  expect(auth).toContain('return c.redirect(`${base}${landing}?magic=ok`, 302);');
  expect(MAGIC_LANDING).toEqual({ signup: '/onboarding/chat?magic=ok', signin: '/dashboard?magic=ok' });
});

for (const [width, height, label] of [[1440, 900, 'desktop'], [390, 844, 'phone']]) {
  test.describe(`${label} (${width}px)`, () => {
    // Reduced motion: the landing page fades its sections in, and axe reads a half-faded colour as a contrast failure.
    test.use({ viewport: { width, height }, reducedMotion: 'reduce' });
    test.setTimeout(90_000);
    let worker;
    test.beforeEach(async ({ context }) => {
      worker = await startLocalWorker({ handle: answers });
      await controlledBrowser(context, worker.origin, CONSENT_VERSION);
    });
    test.afterEach(async ({ page }) => {
      if (!page.isClosed()) await page.unrouteAll({ behavior: 'ignoreErrors' });
      await worker?.close();
    });

    test('landing → Pricing → a plan → sign-up by the email link → back on that plan\'s checkout', async ({ page }) => {
      const email = `visitor.${width}@example.test`;
      await page.goto(`${worker.origin}/`);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      await pageHolds(page, 'landing');

      // The landing page links Pricing through the Founders page (its plans band and "See the token packs").
      await page.getByRole('link', { name: 'Founders', exact: true }).first().click();
      await expect(page).toHaveURL(/\/for-founders$/);
      await pageHolds(page, 'Founders');

      const down = await outage(page, '**/api/public/plans-and-packs');
      await page.getByRole('link', { name: 'See the token packs', exact: true }).click();
      await expect(page).toHaveURL(/\/pricing\?for=models/);
      await expect(page.getByRole('heading', { level: 1, name: 'Pricing' })).toBeVisible();
      await page.getByRole('tab', { name: 'Founder', exact: true }).click();
      // One failed catalogue read: said in words, with a Try again that reads it.
      await expect(page.getByRole('alert').filter({ hasText: 'Prices unavailable. Try again.' })).toBeVisible();
      expect(down.refused).toBeGreaterThan(0);
      await pageHolds(page, 'Pricing, catalogue unreadable');
      down.end();
      await page.getByRole('alert').filter({ hasText: 'Prices unavailable' }).getByRole('button', { name: 'Try again' }).click();
      const growth = page.locator('a[href*="plan=founder%3Agrowth"]').first();
      await expect(growth).toBeVisible();
      await pageHolds(page, 'Pricing');

      await growth.click();
      await expect(page).toHaveURL(/\/register\?/);
      const next = new URL(page.url()).searchParams.get('next');
      expect(next).toBe('/pricing?for=founder&checkout=founder%3Agrowth&interval=monthly&seen=5000');
      await expect(page.getByRole('heading', { name: 'Create your account to get Validate + Build' })).toBeVisible();
      await pageHolds(page, 'Register');
      const send = page.getByRole('button', { name: 'Email me a link to create my account', exact: true });
      await send.click();
      await refused(page, 'Full Name', 'register-error', 'Please enter your full name');
      await page.getByLabel('Full Name', { exact: true }).fill('Synthetic Visitor');
      await page.getByLabel('Email', { exact: true }).fill('not-an-address');
      await send.click();
      await refused(page, 'Email', 'register-error', 'Please enter a valid email address (e.g. you@example.com)');
      await pageHolds(page, 'Register, a refused field');
      expect(worker.requests.filter((r) => r.path === '/api/auth/register' || r.path === '/api/auth/magic/start')).toEqual([]);

      await page.getByLabel('Email', { exact: true }).fill(email);
      await send.click();
      await expect.poll(() => worker.outbox.length).toBe(1);
      expect(worker.outbox[0]).toMatchObject({ to: email, purpose: 'signup' });
      expect(await kept(page), 'the plan\'s return is kept through the email round trip').toBe(next);
      await pageHolds(page, 'Register, link sent');

      // The inbox: the link, opened in the same browser. auth.ts 302s to /dashboard?magic=ok with the cookie only.
      await page.goto(worker.linkFor(email));
      await expect(page).toHaveURL(/\/pricing\?for=founder/, { timeout: 15_000 });
      const sheet = page.getByRole('dialog');
      await expect(sheet).toBeVisible({ timeout: 15_000 });
      await expect(sheet).toContainText('Validate + Build');
      await expect(page).toHaveURL(/\/pricing\?for=founder$/); // the sheet is open and the ask is spent
      expect(await kept(page), 'the return is spent once').toBeNull();
      expect(worker.account(email)?.role).toBe('exploring');
      await pageHolds(page, 'Pricing, the chosen plan\'s checkout');
    });

    test('landing → a Grow action → sign-in by the email link → back on that action', async ({ page }) => {
      const email = `founder.${width}@example.test`;
      worker.addAccount({ email, name: 'Synthetic Founder', role: 'founder' });
      await page.goto(`${worker.origin}/`);
      await pageHolds(page, 'landing');

      // "Share an update", Grow's gated action, opened from a shared link while signed out.
      await page.goto(`${worker.origin}/grow/update`);
      await expect(page).toHaveURL(/\/login\?next=%2Fgrow%2Fupdate$/);
      await expect(page.getByRole('heading', { level: 1, name: 'Sign in to continue to Grow' })).toBeVisible();
      await pageHolds(page, 'sign-in for Grow');
      const link = await emailLinkSignIn(page, worker, email, { checkSteps: true });
      expect(await kept(page)).toBe('/grow/update');

      await page.goto(link);
      await expect.poll(() => pathOf(page), { timeout: 15_000 }).toBe('/grow/update');
      await expect(page.getByRole('heading', { name: 'Share an update' }).first()).toBeVisible({ timeout: 15_000 });
      expect(await kept(page)).toBeNull();
      await pageHolds(page, 'Grow, Share an update');

      // The action's own read (the venture's update context, read on Next) fails once: said in words, and Next again reads it.
      const down = await outage(page, '**/api/portfolio-updates/share/context*', { once: true });
      await page.getByRole('button', { name: 'Next', exact: true }).click();
      await expect(page.getByRole('alert').filter({ hasText: 'Synthetic outage' })).toBeVisible();
      await expect(page.getByText('Step 1 of 6', { exact: true })).toBeVisible();
      expect(down.refused).toBe(1);
      await pageHolds(page, 'Grow, Share an update, one read refused');
      await page.getByRole('button', { name: 'Next', exact: true }).click();
      await expect(page.getByText('Step 2 of 6', { exact: true })).toBeVisible();
      await expect(page.getByRole('alert').filter({ hasText: 'Synthetic outage' })).toHaveCount(0);
      await pageHolds(page, 'Grow, Share an update, step 2');
    });

    test('a session that ended → the email link → signed in again on the page the person was on', async ({ page }) => {
      const email = `returning.${width}@example.test`;
      worker.addAccount({ email, name: 'Synthetic Founder', role: 'founder' });
      await page.goto(`${worker.origin}/login?next=${encodeURIComponent('/grow/update')}`);
      await page.goto(await emailLinkSignIn(page, worker, email));
      await expect(page.getByRole('heading', { name: 'Share an update' }).first()).toBeVisible({ timeout: 15_000 });

      // The session ends on the server (an expiry, a sign-out elsewhere); the next read finds out.
      worker.endSessions(email);
      await page.reload();
      await expect(page).toHaveURL(/\/login\?next=%2Fgrow%2Fupdate(%3Fproject_id%3D8537)?&ended=1$/, { timeout: 15_000 });
      await expect(page.getByText('Your session ended. Sign in again to go back to Grow.', { exact: true })).toBeVisible();
      await pageHolds(page, 'sign-in after the session ended');
      // The way back in when the person cannot sign in another way: the email link, read from the outbox.
      const link = await emailLinkSignIn(page, worker, email);
      expect(worker.outbox.filter((m) => m.to === email)).toHaveLength(2);
      await page.goto(link);
      await expect.poll(() => pathOf(page), { timeout: 15_000 }).toBe('/grow/update');
      await expect(page.getByRole('heading', { name: 'Share an update' }).first()).toBeVisible({ timeout: 15_000 });
      await pageHolds(page, 'Grow, after recovery');
    });

    // ── Gaps: the step does not exist in the app. Each is listed in D8537 to be filed separately. ──────────────────

    test.skip('GAP (D8537 G1): arriving at a public page moves focus to its main heading or first field', async ({ page }) => {
      // Today focus stays on <body> after both a full load and an in-app link on /, /for-founders, /pricing and
      // /register, and /register has no <h1> (its title is an <h2>). Only the sign-in steps move focus (checked above).
      for (const path of ['/', '/for-founders', '/pricing?for=founder', '/register?lane=founder']) {
        await page.goto(`${worker.origin}${path}`);
        const focused = await page.evaluate(() => document.activeElement?.matches('h1, input, select, textarea'));
        expect(focused, path).toBe(true);
      }
    });

    test.skip('GAP (D8537 G2): Account recovery by email returns to the page the person started from', async ({ page }) => {
      // `/auth/recover` (linked as "Can't sign in? Account recovery") ends every method, the email link included, at
      // `/account#security` (RecoverPage.jsx), and keeps no `?next=`. There is no `/forgot-password` page: sign-in has
      // no password. The journey above recovers through the sign-in email link, which does keep the page.
      await page.goto(`${worker.origin}/auth/recover?next=${encodeURIComponent('/grow/update')}`);
      expect(new URL(page.url()).searchParams.get('next')).toBe('/grow/update');
      throw new Error('not built: Account recovery keeps no return destination');
    });
  });
}
