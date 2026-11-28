/** #4705: keyboard/focus and phone checks against a local Vite fixture; no live account. */
import { test as base, expect } from '@playwright/test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

// #9039: the spec starts its own Vite server on a free port, so CI runs it with no preview and no account.
// pipeline_4705.html imports the real src/pages/PipelinePage.jsx, which only Vite can serve: docs/ does not carry it.
// Its cache goes to the temp dir, one per Playwright worker, never into a node_modules another checkout may share. Vite
// transforms the page's module graph on its first visit (about 35s cold), so the fixture opens it once, under its own
// time limit, before any test's 30s starts; a request off the Vite origin is aborted there as in the test.
const FRONTEND = fileURLToPath(new URL('../..', import.meta.url));
const FIXTURE = '/tests/e2e/pipeline_4705.html';
const test = base.extend({
  localVite: [async ({ browser }, use, workerInfo) => {
    const server = await createServer({
      root: FRONTEND, configFile: join(FRONTEND, 'vite.config.js'), cacheDir: join(tmpdir(), `pipeline-4705-vite-${workerInfo.workerIndex}`),
      logLevel: 'error', clearScreen: false, server: { host: '127.0.0.1', port: 0, strictPort: false, hmr: false, proxy: {} },
    });
    await server.listen();
    const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
    const warm = await browser.newPage();
    await warm.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
    await warm.goto(`${origin}${FIXTURE}`, { timeout: 150_000 });
    await warm.getByRole('button', { name: 'New Pipeline Startup', exact: true }).waitFor({ timeout: 150_000 });
    await warm.close();
    await use(origin);
    await server.close();
  }, { scope: 'worker', timeout: 180_000 }],
  baseURL: async ({ localVite }, use) => use(localVite),
});
// Both widths in one worker, so one Vite server pays the cold start (the config runs files fully parallel).
test.describe.configure({ mode: 'default' });
for (const width of [1440, 390]) test(`studio creation recovery and keyboard entry at ${width}px`, async ({ page, baseURL }) => {
  await page.setViewportSize({ width, height: 1000 });
  await page.route('**/*', route => new URL(route.request().url()).origin === new URL(baseURL).origin ? route.continue() : route.abort());
  await page.goto(FIXTURE);
  const opener = page.getByRole('button', { name: 'New Pipeline Startup', exact: true });
  await opener.focus();
  await page.keyboard.press('Enter');
  const sheet = page.getByRole('dialog', { name: 'New Pipeline Startup', exact: true });
  await expect(sheet).toBeVisible();
  await expect.poll(() => sheet.evaluate(el => el.contains(document.activeElement))).toBe(true);
  for (const [label, value] of [['Name *', 'Keep startup'], ['Sector', 'health'], ['Description', 'Draft description'], ['Problem', 'Draft problem'], ['Solution', 'Draft solution']]) {
    await sheet.getByText(label, { exact: true }).click();
    await expect(sheet.getByLabel(label, { exact: true })).toBeFocused();
    await sheet.getByLabel(label, { exact: true }).fill(value);
  }
  await sheet.getByRole('button', { name: 'Create', exact: true }).click();
  await expect(sheet.getByRole('alert')).toContainText('The startup could not be created.');
  await expect(sheet.getByText('synthetic-raw-detail')).toHaveCount(0);
  await expect(sheet.getByLabel('Name *', { exact: true })).toHaveValue('Keep startup');
  await expect(sheet.getByRole('textbox', { name: 'Solution', exact: true })).toHaveValue('Draft solution');
  await sheet.getByRole('button', { name: 'Create', exact: true }).focus();
  await page.keyboard.press('Tab');
  await expect.poll(() => sheet.evaluate(el => el.contains(document.activeElement))).toBe(true);
  await page.screenshot({ path: test.info().outputPath(`creation-${width}.png`), fullPage: true });
  await page.keyboard.press('Escape');
  await expect(sheet).toHaveCount(0);
  await expect(opener).toBeFocused();
  const startup = page.getByRole('button', { name: 'Open Synthetic startup', exact: true });
  await startup.focus();
  await page.keyboard.press('Space');
  const detail = page.getByRole('dialog', { name: 'Synthetic startup', exact: true });
  await expect(detail).toBeVisible();
  await expect(detail.getByRole('button', { name: 'MVP Dev', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(startup).toBeFocused();
});
