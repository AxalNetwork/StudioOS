/**
 * D886 B3 (#2581): Chromium serving the constructed Meet fixture, for the Meet tests.
 *
 * Every request to https://meet.google.com/... is answered from
 * `fixtures/meet.html`; any other request is aborted, so nothing leaves the
 * machine. The browser is the one at `CHROMIUM_PATH`, else Playwright's own.
 * Where neither exists (the drift job installs no browser), `NO_BROWSER` holds
 * the reason and the browser tests skip by name; the pure tests still run.
 */
import { existsSync, readFileSync } from 'node:fs';
import type { Browser, Page } from 'playwright';
import type { MeetPage } from '../src/adapters/meet.ts';

const FIXTURE = readFileSync(new URL('./fixtures/meet.html', import.meta.url), 'utf8');

async function findChromium(): Promise<{ launch: () => Promise<Browser> } | string> {
  let pw: typeof import('playwright');
  try { pw = await import('playwright'); } catch { return 'Playwright is not installed'; }
  const exe = process.env.CHROMIUM_PATH || pw.chromium.executablePath();
  if (!exe || !existsSync(exe)) return 'no Chromium (set CHROMIUM_PATH)';
  const args = ['--lang=en-US', '--autoplay-policy=no-user-gesture-required', '--use-fake-ui-for-media-stream'];
  return { launch: () => pw.chromium.launch({ executablePath: exe, args }) };
}

const found = await findChromium();
export const NO_BROWSER: string | false = typeof found === 'string' ? found : false;

/** Runs `fn` with a fresh fixture page, and closes the browser after. */
export async function withMeetPage<T>(fn: (page: MeetPage, raw: Page) => Promise<T>): Promise<T> {
  if (typeof found === 'string') throw new Error(found);
  const browser = await found.launch();
  try {
    const page = await browser.newPage();
    await page.route('**/*', async (route) => {
      if (route.request().url().startsWith('https://meet.google.com/')) await route.fulfill({ status: 200, contentType: 'text/html', body: FIXTURE });
      else await route.abort();
    });
    return await fn(page as unknown as MeetPage, page);
  } finally {
    await browser.close();
  }
}
