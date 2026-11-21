/** #5310 part 2 (D5310-p2): Network › Relationships, NW2 and the Person Sheet (NW2.1), at 1440 and 390, light and dark, its reads stubbed. */
import { test, expect } from '@playwright/test';
import { prepare } from './_editor.mjs';
test.setTimeout(60_000);

const ADA = {
  id: 21, name: 'Example Ada', company: 'Example Seed', title: 'Partner', linkedin_url: 'https://www.linkedin.com/in/example-ada', connected_on: '2021-03-14',
  created_at: '2026-10-30 09:00:00', sources: ['linkedin_csv'], notes: 1, open_tasks: 1, overdue_tasks: 1, next_due_on: '2020-10-28', last_note_at: '2026-09-28 10:00:00', last_done_at: '2026-09-30 08:00:00',
};
const BEN = { id: 22, name: 'Example Ben', company: 'Example Analytics', title: 'Head of Ops', created_at: '2026-09-01 10:00:00', sources: ['typed'], notes: 0, open_tasks: 1, overdue_tasks: 0, next_due_on: '2026-11-20', last_note_at: '2026-11-05 12:00:00', last_done_at: null };
const CARA = { id: 23, name: 'Example Chloé', company: null, title: 'Angel', created_at: '2026-10-30 09:00:00', sources: ['linkedin_csv'], notes: 0, open_tasks: 0, overdue_tasks: 0, next_due_on: null, last_note_at: null, last_done_at: null };

async function open(page, request, { width, dark = false, fail = false }) {
  await prepare(page, request);
  await page.setViewportSize({ width, height: 900 });
  if (dark) await page.route(/\/api\/settings\/appearance/, (route) => route.fulfill({ status: 200, json: { theme: 'dark' } }));
  await page.route(/\/api\/contacts\/book/, (route) => {
    const url = route.request().url();
    if (/\/book\/21\/notes/.test(url)) return route.fulfill({ status: 200, json: { notes: [{ uid: 'n1', body: 'Met at Web Summit, wants quarterly updates.', created_at: '2026-09-28 10:00:00' }] } });
    if (/\/book\/21\/tasks/.test(url)) return route.fulfill({ status: 200, json: { tasks: [{ uid: 't1', title: 'Send Q3 update', due_on: '2020-10-28', done_at: null }, { uid: 't2', title: 'Thank-you after intro', due_on: '2026-09-29', done_at: '2026-09-30 08:00:00' }] } });
    if (fail) return route.fulfill({ status: 503, json: { detail: 'Synthetic read failure' } });
    return route.fulfill({ status: 200, json: { total: 142, page: 1, page_size: 50, contacts: [ADA, BEN, CARA] } });
  });
  await page.route(/\/api\/relationships\/who-knows/, (route) => route.fulfill({ status: 200, json: { query: {}, people: [] } }));
  await page.goto('/network/relationships');
  await expect(page.getByTestId('nw2-book')).toBeVisible();
}

for (const width of [1440, 390]) {
  for (const dark of [false, true]) {
    test(`NW2 table and NW2.1 sheet at ${width}px${dark ? ', dark' : ''}`, async ({ page, request }, testInfo) => {
      await open(page, request, { width, dark });
      if (dark) await expect(page.locator('html')).toHaveClass(/dark/);
      await expect(page.getByTestId('nw2-book-count')).toHaveText('142 people · private to you');
      await expect(page.getByTestId(width < 640 ? 'nw2-card-21' : 'nw2-row-21')).toContainText('1 overdue');
      await expect(page.getByTestId('nw2-add-person')).toBeDisabled();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await page.screenshot({ path: testInfo.outputPath(`nw2-${width}${dark ? '-dark' : ''}.png`), fullPage: true });
      await page.getByTestId(width < 640 ? 'nw2-card-21' : 'nw2-open-21').click();
      await expect(page.getByTestId('nw2-sheet-follow')).toContainText('Overdue · due 2020-10-28');
      await expect(page.getByTestId('nw2-sheet-history')).toContainText('Connected on LinkedIn');
      await page.screenshot({ path: testInfo.outputPath(`nw2-1-${width}${dark ? '-dark' : ''}.png`) });
    });
  }
  test(`NW2 book unreadable at ${width}px`, async ({ page, request }) => {
    await open(page, request, { width, fail: true });
    await expect(page.getByTestId('nw2-unreadable')).toContainText('This is not an empty book');
  });
}
