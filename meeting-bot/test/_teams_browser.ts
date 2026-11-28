/**
 * D5812 (#5812): Chromium serving the constructed Teams fixture, for the
 * Teams driver tests.
 *
 * Every request to a Teams host (teams.microsoft.com, teams.cloud.microsoft,
 * teams.live.com) is answered from `fixtures/teams.html`; any other request is
 * aborted, so nothing leaves the machine. The browser is the one the Meet
 * tests use (`_meet_browser.ts`): headless, at `CHROMIUM_PATH` or
 * `PW_CHROMIUM_PATH`, else Playwright's own. Where there is none, `NO_BROWSER`
 * holds the reason and the browser tests skip by name.
 */
import { readFileSync } from 'node:fs';
import type { Browser, Page } from 'playwright';
import { NO_BROWSER, launchBrowser } from './_meet_browser.ts';

export { NO_BROWSER, launchBrowser };

const FIXTURE = readFileSync(new URL('./fixtures/teams.html', import.meta.url), 'utf8');
const HOSTS = ['https://teams.microsoft.com/', 'https://teams.cloud.microsoft/', 'https://teams.live.com/'];

/** Answers the Teams hosts with the fixture on `page`, aborts everything else, and collects the fixture's notes. */
export async function routeTeams(page: Page, notes: string[] = []): Promise<string[]> {
  await page.route('**/*', async (route) => {
    const url = route.request().url();
    if (HOSTS.some((h) => url.startsWith(h))) await route.fulfill({ status: 200, contentType: 'text/html', body: FIXTURE });
    else await route.abort();
  });
  await page.exposeFunction('__fixtureNote', (what: string) => { notes.push(String(what)); });
  return notes;
}

export interface TeamsBrowser {
  readonly browser: Browser;
  /** Every page the factory opened, routed to the fixture. */
  readonly pages: Page[];
  /** The fixture's notes, in order, kept after the page closes. */
  readonly notes: string[];
}

/**
 * A fixture browser for the packaged factory's `launch`: each page it opens
 * answers the Teams hosts locally before the factory sees it.
 */
export async function teamsBrowser(): Promise<TeamsBrowser> {
  const browser = await launchBrowser();
  const pages: Page[] = [];
  const notes: string[] = [];
  const newPage = browser.newPage.bind(browser);
  Object.defineProperty(browser, 'newPage', {
    value: async (options?: Parameters<Browser['newPage']>[0]) => {
      const page = await newPage(options);
      await routeTeams(page, notes);
      pages.push(page);
      return page;
    },
  });
  return { browser, pages, notes };
}
