/** #4580: isolated browser checks for auth labels, accessible validation and Grow return intent.
 * API answers are synthetic; this does not verify provider authentication, email delivery or live membership.
 * Run against Vite: npx playwright test -c frontend/playwright.config.js grow_return_4580
 */
import { test, expect } from '@playwright/test';

const destination = '/grow/talent?tab=open#roles';
const next = `?next=${encodeURIComponent(destination)}`;
for (const width of [1440, 390]) {
  test.describe(`Grow auth at ${width}px`, () => {
    test.use({ viewport: { width, height: 1000 } });
    let calls;
    test.beforeEach(async ({ page, baseURL }) => {
      calls = [];
      await page.route('**/*', async route => {
        const request = route.request();
        const url = new URL(request.url());
        if (url.origin !== new URL(baseURL).origin) return route.abort();
        if (!url.pathname.startsWith('/api/')) return route.continue();
        calls.push({ path: url.pathname, query: url.searchParams, body: request.postDataJSON() });
        if (url.pathname === '/api/auth/me' || url.pathname === '/api/me') return route.fulfill({ status: 401, json: { detail: 'Not authenticated' } });
        if (url.pathname === '/api/auth/google/config') return route.fulfill({ json: { popup: false } });
        if (url.pathname === '/api/auth/login') return route.fulfill({ json: { token: 'synthetic-browser-session', user: { id: 'synthetic-founder', role: 'founder' } } });
        if (url.pathname === '/api/auth/google/start') return route.fulfill({ json: { url: `${url.origin}/login${next}&google_error=cancelled` } });
        if (url.pathname === '/api/auth/passkey/auth-options') return route.fulfill({ status: 400, json: { detail: 'Synthetic passkey cancellation. Try another sign-in method.' } });
        return route.fulfill({ json: {} });
      });
    });
    const visit = async (page, path) => {
      await page.goto(path);
      const reject = page.getByRole('button', { name: 'Reject all', exact: true });
      if (await reject.isVisible()) await reject.click();
    };
    const invalid = async (page, label, errorId, text) => {
      const input = page.getByLabel(label, { exact: true });
      await expect(input).toHaveAttribute('aria-invalid', 'true');
      await expect(input).toHaveAttribute('aria-describedby', errorId);
      await expect(page.locator(`#${errorId}`)).toHaveText(text);
      await expect(page.locator(`#${errorId}`)).toHaveAttribute('role', 'alert');
    };
    test('login labels focus and invalid email/code never submit', async ({ page }) => {
      await visit(page, `/login${next}`);
      await page.locator('label[for="login-email"]').click();
      await expect(page.getByLabel('Email', { exact: true })).toBeFocused();
      await page.getByRole('button', { name: 'Email me a sign-in link', exact: true }).click();
      await invalid(page, 'Email', 'login-error', 'Enter your email above, then request a sign-in link.');
      await page.getByLabel('Email', { exact: true }).fill('bad-address');
      await page.getByLabel('Email', { exact: true }).press('Enter');
      await invalid(page, 'Email', 'login-error', 'Enter a valid email address (e.g. you@example.com).');
      await page.getByRole('button', { name: 'Passkey or authenticator code', exact: true }).click();
      await page.locator('label[for="login-totp"]').click();
      await expect(page.getByLabel('Authenticator code', { exact: true })).toBeFocused();
      await page.getByLabel('Authenticator code', { exact: true }).fill('123456');
      await page.getByRole('button', { name: 'Sign in with code', exact: true }).click();
      await invalid(page, 'Email', 'login-error', 'Enter a valid email address (e.g. you@example.com).');
      await page.getByLabel('Email', { exact: true }).fill('synthetic@example.test');
      await page.getByLabel('Authenticator code', { exact: true }).fill('12');
      await page.getByLabel('Authenticator code', { exact: true }).press('Enter');
      await invalid(page, 'Authenticator code', 'login-error', 'Enter the 6-digit code from your authenticator.');
      expect(calls.filter(c => ['/api/auth/login', '/api/auth/magic/start'].includes(c.path))).toEqual([]);
      await page.screenshot({ path: test.info().outputPath('login-validation.png'), fullPage: true });
    });
    test('registration labels, validation and signup request preserve Grow', async ({ page }) => {
      await visit(page, `/register${next}`);
      for (const [id, label] of [['register-name', 'Full Name'], ['register-email', 'Email']]) {
        await page.locator(`label[for="${id}"]`).click();
        await expect(page.getByLabel(label, { exact: true })).toBeFocused();
      }
      const send = page.getByRole('button', { name: 'Email me a link to create my account', exact: true });
      await send.click();
      await invalid(page, 'Full Name', 'register-error', 'Please enter your full name');
      await page.getByLabel('Full Name', { exact: true }).fill('Synthetic Browser');
      await page.getByLabel('Email', { exact: true }).fill('bad-address');
      await send.click();
      await invalid(page, 'Email', 'register-error', 'Please enter a valid email address (e.g. you@example.com)');
      expect(calls.filter(c => c.path === '/api/auth/register' || c.path === '/api/auth/magic/start')).toEqual([]);
      await page.screenshot({ path: test.info().outputPath('register-validation.png'), fullPage: true });
      await page.getByLabel('Email', { exact: true }).fill('synthetic@example.test');
      await send.click();
      await expect.poll(() => calls.filter(c => c.path === '/api/auth/magic/start').length).toBe(1);
      expect(calls.find(c => c.path === '/api/auth/magic/start').body).toEqual({ email: 'synthetic@example.test', purpose: 'signup' });
      expect(await page.evaluate(() => JSON.parse(localStorage.getItem('gvpn:next')).path)).toBe(destination);
    });
    test('existing registration requests returning-member email', async ({ page }) => {
      await page.route('**/api/auth/register', route => route.fulfill({ status: 409, json: { code: 'email_already_registered', detail: 'Already registered' } }));
      await visit(page, `/register${next}`);
      await page.getByLabel('Full Name', { exact: true }).fill('Synthetic Browser');
      await page.getByLabel('Email', { exact: true }).fill('synthetic@example.test');
      await page.getByRole('button', { name: 'Email me a link to create my account', exact: true }).click();
      await expect.poll(() => calls.filter(c => c.path === '/api/auth/magic/start').length).toBe(1);
      expect(calls.find(c => c.path === '/api/auth/magic/start').body).toEqual({ email: 'synthetic@example.test' });
    });
    test('expired links and cancelled Google keep destination and offer retry', async ({ page }) => {
      await visit(page, `/login${next}&magic_error=expired`);
      await expect(page.getByRole('alert')).toContainText('expired or was already used');
      await expect(page).toHaveURL(new RegExp(`next=${encodeURIComponent(destination)}`));
      await page.getByLabel('Email', { exact: true }).fill('synthetic@example.test');
      await page.getByRole('button', { name: 'Email me a sign-in link', exact: true }).click();
      await expect(page.getByText('Sign-in link sent to synthetic@example.test.', { exact: true })).toBeVisible();
      await visit(page, `/login${next}`);
      await page.getByRole('button', { name: 'Continue with Google', exact: true }).click();
      await expect(page.getByRole('alert')).toHaveText('Google sign-in was cancelled.');
      expect(calls.find(c => c.path === '/api/auth/google/start').query.get('redirect')).toBe(destination);
      await expect(page.getByRole('button', { name: 'Continue with Google', exact: true })).toBeEnabled();
      expect(await page.evaluate(() => JSON.parse(localStorage.getItem('gvpn:next')).path)).toBe(destination);
    });
    test('successful synthetic authenticator answer navigates to exact Grow destination', async ({ page }) => {
      // Stop at navigation: this verifies the sign-in handler, not Grow authorization or a live session.
      await page.route('**/grow/talent?*', route => route.fulfill({ contentType: 'text/html', body: '<h1>Synthetic navigation target</h1>' }));
      await visit(page, `/login${next}`);
      await page.getByLabel('Email', { exact: true }).fill('synthetic@example.test');
      await page.getByRole('button', { name: 'Passkey or authenticator code', exact: true }).click();
      await page.getByLabel('Authenticator code', { exact: true }).fill('123456');
      await page.getByRole('button', { name: 'Sign in with code', exact: true }).click();
      await expect(page.getByRole('heading', { name: 'Synthetic navigation target' })).toBeVisible();
      expect(new URL(page.url()).pathname + new URL(page.url()).search + new URL(page.url()).hash).toBe(destination);
    });
    test('passkey refusal leaves email retry available', async ({ page }) => {
      await visit(page, `/login${next}`);
      await page.getByRole('button', { name: 'Passkey or authenticator code', exact: true }).click();
      await page.getByRole('button', { name: 'Sign in with a passkey', exact: true }).click();
      await expect(page.getByRole('alert')).toContainText('Synthetic passkey cancellation');
      await expect(page.getByRole('button', { name: 'Sign in with a passkey', exact: true })).toBeEnabled();
      await page.getByLabel('Email', { exact: true }).fill('synthetic@example.test');
      await page.getByRole('button', { name: 'Email me a sign-in link', exact: true }).click();
      await expect(page.getByText('Sign-in link sent to synthetic@example.test.', { exact: true })).toBeVisible();
    });
  });
}
