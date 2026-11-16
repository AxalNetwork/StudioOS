/** #5310 part 3 (D5310-p3): one introduction request's record (NW3.2 / NW3.4), opened from Introductions, at 1440 and 390, light and dark. */
import { test, expect } from '@playwright/test';
import { prepare } from './_editor.mjs';
test.setTimeout(60_000);

const REQ = {
  uid: 'r1', kind: 'intro_requested', requester_user_id: 4, teammate_user_id: 2, team_key: 'project:1',
  requester: { id: 4, name: 'Example Maya' }, teammate: { id: 2, name: 'Example Tom' },
  person: { name: 'Example Priya', company: 'Example Bio' }, note: 'We are piloting with two labs; Priya runs partnerships.', context_note: null,
  decision_note: 'Happy to — I will send it this week.', status: 'accepted', parent_uid: null,
  decided_at: '2026-11-03 11:04:00', accepted_at: '2026-11-03 11:04:00', made_at: null, withdrawn_at: null,
  outcome: { value: null, label: 'Not recorded', note: null, recorded_by_user_id: null, recorded_at: null },
  follow_up: null, mail_sent_uid: null, delivery: null, created_at: '2026-10-31 10:02:00',
};
const log = { sent: [REQ], received: [], follow_ups_due: 0, totals: { sent: 1, received: 0, sent_pending: 0, received_pending: 0 } };

async function open(page, request, { width, dark = false }) {
  await prepare(page, request);
  await page.setViewportSize({ width, height: 900 });
  if (dark) await page.route(/\/api\/settings\/appearance/, (route) => route.fulfill({ status: 200, json: { theme: 'dark' } }));
  await page.route(/\/api\/relationships\/intro-requests\/r1(\?|$)/, (route) => route.fulfill({ status: 200, json: { request: REQ } }));
  await page.route(/\/api\/relationships\/intro-requests(\?|$)/, (route) => route.fulfill({ status: 200, json: log }));
  await page.goto('/network/introductions');
  await expect(page.getByTestId('introductions-row-r1-open')).toBeVisible();
}

for (const width of [1440, 390]) {
  for (const dark of [false, true]) {
    test(`NW3.2 record at ${width}px${dark ? ', dark' : ''}`, async ({ page, request }, testInfo) => {
      await open(page, request, { width, dark });
      if (dark) await expect(page.locator('html')).toHaveClass(/dark/);
      await page.getByTestId('introductions-row-r1-open').click();
      await expect(page.getByTestId('intro-record-banner-wait')).toContainText('Example accepted this introduction. It has not been made yet.');
      await expect(page.getByTestId('intro-record-step-made')).toHaveAttribute('data-state', 'todo');
      await expect(page.getByTestId('intro-record-entry-accepted')).toContainText('Accepted by Example Tom');
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await page.screenshot({ path: testInfo.outputPath(`nw3-2-${width}${dark ? '-dark' : ''}.png`) });
    });
  }
}
