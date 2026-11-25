/**
 * D8524 (#8524) — the signer's own journey through the native eSign flow, in a
 * real browser at 1280 and at 390 px:
 *
 *   open the signing link → read → consent → adopt a signature → confirm →
 *   done → download the signed PDF.
 *
 *   · one external signer (no account, the link is the credential) completes the
 *     envelope; the download is a PDF (content type, `%PDF` header, a filename
 *     that names the envelope); a second visit to the same link shows the
 *     completed state and a second signature is refused, not recorded;
 *   · a staged envelope (company, then investor, each an account): before the
 *     company signs there is no link for the investor at all; once it signs, the
 *     investor's link exists and signs; the company's link then reads signed;
 *   · axe finds no WCAG 2.0, 2.1 or 2.2 A/AA violation on the signing page.
 *
 * ISOLATED FIXTURES. The spec starts `cloudflare-worker/test/_esign_e2e_server.mjs`
 * as a child process: the REAL e-sign router on real SQLite behind the built SPA
 * (`docs/`, from `npm run build` at the repo root). R2 is a Map, the mailer has no
 * credentials and `fetch` throws, so no email is sent and nothing leaves the
 * machine; the spec asserts that at the end of each test. Accounts and names are
 * synthetic. Anything off the local origin is aborted by the browser context.
 *
 *   npm run build                                   (repo root)
 *   cd frontend && npx --no-install playwright test -c playwright.config.js tests/e2e/esign_signer_journey.spec.js --trace off
 *
 * It complements the Worker's own e-sign tests (`cloudflare-worker/test/esign_*`),
 * which do not drive the signer page.
 */
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CONSENT_VERSION } from '../../src/lib/cookieConsent.js';

const ROOT = resolve(fileURLToPath(new URL('../../../', import.meta.url)));
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
const WIDTHS = [{ name: 'desktop', width: 1280, height: 800 }, { name: 'phone', width: 390, height: 844 }];
const FOUNDER = 2, INVESTOR = 3;

let child; let origin;
test.beforeEach(async () => {
  if (!existsSync(resolve(ROOT, 'docs/index.html'))) throw new Error('docs/index.html is missing: run `npm run build` at the repo root first.');
  child = spawn(process.execPath, [
    '--experimental-strip-types', '--no-warnings', '--import', './cloudflare-worker/test/_ts-loader.mjs',
    'cloudflare-worker/test/_esign_e2e_server.mjs',
  ], { cwd: ROOT, stdio: ['ignore', 'pipe', 'inherit'] });
  const port = await new Promise((ok, fail) => {
    let buf = '';
    child.stdout.on('data', (d) => { buf += d; const m = /\{"port":(\d+)\}/.exec(buf); if (m) ok(Number(m[1])); });
    child.on('exit', (code) => fail(new Error(`the fixture server exited early (${code})`)));
  });
  origin = `http://127.0.0.1:${port}`;
});
test.afterEach(async () => {
  // No email, nothing off the machine: the server counts every attempt.
  const seen = await fetch(`${origin}/__e2e/fetches`).then((r) => r.json()).catch(() => ({ fetches: -1 }));
  child?.kill();
  expect(seen.fetches, 'nothing tried to leave the machine').toBe(0);
});

const api = async (path) => (await fetch(`${origin}${path}`)).json();

/** A signer's browser: a fixed viewport, the cookie banner answered, only the local origin reachable, and the link opened. */
async function arrive(context, page, size, token, asUser) {
  await page.setViewportSize({ width: size.width, height: size.height });
  await context.addInitScript((v) => {
    localStorage.setItem('axal_cookie_consent_v1', JSON.stringify({ version: v, decided: true, categories: { essential: true } }));
  }, CONSENT_VERSION);
  await page.route((url) => url.origin !== origin, (route) => route.abort('blockedbyclient'));
  if (asUser) {
    const { token: jwt } = await api(`/__e2e/session/${asUser}`);
    await context.addCookies([{ name: 'studioos_auth', value: jwt, url: origin }]);
  }
  await page.goto(`${origin}/esign/${token}`);
}

async function open(browser, size, token, asUser) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await arrive(context, page, size, token, asUser);
  return { context, page };
}

/** Read → consent → adopt a typed signature → confirm → Sign. Resolves on the Done screen. */
async function sign(page, name) {
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByLabel('Full legal name').fill(name);
  await page.getByRole('button', { name: 'Adopt and sign' }).click();
  const dialog = page.getByRole('dialog', { name: /Apply this signature/ });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText(`Name: ${name}`)).toBeVisible();
  await dialog.getByRole('button', { name: 'Sign', exact: true }).click();
}

async function noScroll(page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'no horizontal scroll').toBe(true);
}

for (const size of WIDTHS) {
  test.describe(`${size.name} (${size.width}px)`, () => {
    test('one signer: completes, downloads a PDF that names the envelope, and a second visit does not sign again', async ({ context, page }) => {
      const { token, envelope_uuid: uuid } = await api('/__e2e/single');
      await arrive(context, page, size, token);

      // Read: the document title is the page's h1, and axe finds nothing on it.
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      await noScroll(page);
      const readScan = await new AxeBuilder({ page }).withTags(TAGS).exclude('iframe').analyze();
      expect(readScan.violations.map((v) => `${v.id}: ${v.nodes.length}`), 'axe on the read step').toEqual([]);

      await sign(page, 'Cass Counsel');
      await expect(page.getByRole('heading', { level: 1, name: /You signed/ })).toBeVisible();
      await expect(page.getByText('Completed.')).toBeVisible();
      await expect(page.getByText(uuid.slice(0, 8), { exact: false })).toBeVisible();
      await noScroll(page);
      const doneScan = await new AxeBuilder({ page }).withTags(TAGS).exclude('iframe').analyze();
      expect(doneScan.violations.map((v) => `${v.id}: ${v.nodes.length}`), 'axe on the done screen').toEqual([]);

      // The signed PDF, by the same link.
      const pdf = await page.request.get(`${origin}/api/legal/esign/sign/${token}/document`);
      expect(pdf.status()).toBe(200);
      expect(pdf.headers()['content-type']).toBe('application/pdf');
      expect(pdf.headers()['content-disposition']).toContain(`axal-${uuid}.pdf`);
      const bytes = await pdf.body();
      expect(bytes.subarray(0, 5).toString('latin1')).toBe('%PDF-');
      expect(bytes.length).toBeGreaterThan(1000);

      // A second visit to the same link: the completed state, and no way to sign.
      await page.goto(`${origin}/esign/${token}`);
      await expect(page.getByRole('heading', { name: 'Already signed' })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Continue' })).toHaveCount(0);
      const again = await page.request.post(`${origin}/api/legal/esign/sign/${token}`, {
        data: { accepted: true, typed_name: 'Cass Counsel', signature_data_url: 'data:image/png;base64,iVBORw0KGgo=' },
      });
      expect(again.status()).toBe(409);
    });
  });
}

test('staged: the second signer has no link until the first signs, then signs; the first link reads signed', async ({ browser }) => {
  const size = WIDTHS[0];
  const { first } = await api('/__e2e/staged');
  expect((await api('/__e2e/token/2')).token, 'the investor has no link yet').toBeNull();

  // A guessed link for the investor's stage opens nothing.
  const probe = await open(browser, size, 'f'.repeat(64));
  await expect(probe.page.getByText('Unable to load signing envelope')).toBeVisible();
  await probe.context.close();

  // The company signs (an account: its own session is what the Worker checks).
  const company = await open(browser, size, first, FOUNDER);
  await sign(company.page, 'Fay Founder');
  await expect(company.page.getByRole('heading', { level: 1, name: /You signed/ })).toBeVisible();

  // Now the investor's link exists and is theirs alone.
  const second = (await api('/__e2e/token/2')).token;
  expect(second, 'the investor is sent when the company signs').toMatch(/^[A-Za-z0-9_-]{32,}$/);
  const stranger = await open(browser, size, second, FOUNDER);
  await stranger.page.getByRole('button', { name: 'Continue' }).click();
  await stranger.page.getByRole('checkbox').check();
  await stranger.page.getByRole('button', { name: 'Continue' }).click();
  await stranger.page.getByRole('button', { name: 'Adopt and sign' }).click();
  await stranger.page.getByRole('dialog', { name: /Apply this signature/ }).getByRole('button', { name: 'Sign', exact: true }).click();
  await expect(stranger.page.getByRole('alert')).toContainText('signed in as the intended recipient');
  await stranger.context.close();

  const investor = await open(browser, size, second, INVESTOR);
  await sign(investor.page, 'Ivy Investor');
  await expect(investor.page.getByRole('heading', { level: 1, name: /You signed/ })).toBeVisible();

  // The company's own link now reads signed, not signable.
  await company.page.goto(`${origin}/esign/${first}`);
  await expect(company.page.getByRole('heading', { name: 'Already signed' })).toBeVisible();
  await company.context.close();
  await investor.context.close();
});
