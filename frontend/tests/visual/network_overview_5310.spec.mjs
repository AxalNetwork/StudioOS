/** #5310 (D5310): the founder Network overview (NW1, NW1.2, NW5) at 1440 and 390, light and dark, its reads stubbed. */
import { test, expect } from '@playwright/test';
import { prepare } from './_editor.mjs';
test.setTimeout(60_000);

const req = (o) => ({ uid: 'r1', status: 'pending', requester: { id: 5, name: 'Example Dev' }, teammate: { id: 6, name: 'Example Iris' }, person: { name: 'Example Lena' }, created_at: '2026-11-05 09:00:00', outcome: { label: 'Not recorded' }, ...o });
const log = (s, r, t = {}) => ({ sent: s, received: r, totals: { sent: s.length, received: r.length, sent_pending: 0, received_pending: 0, ...t } });
function reads(mode) {
  const empty = mode === 'empty';
  return [
    [/\/api\/contacts\/book\/follow-ups-due/, empty ? { total: 0, items: [] } : { total: 3, items: [
      { task_uid: 't1', task_title: 'Send Q3 update', due_on: '2026-10-28', contact: { name: 'Example Ada', title: 'Partner', company: 'Example Seed', sources: [] }, last_note_at: '2026-10-04T10:00:00Z' },
      { task_uid: 't2', task_title: 'Ask about pilot', due_on: '2026-11-02', contact: { name: 'Example Ben', title: 'Head of Ops', company: 'Example Analytics', sources: [] }, last_note_at: null },
      { task_uid: 't3', task_title: 'Coffee', due_on: '2026-11-05', contact: { name: 'Example Cleo', sources: ['linkedin_csv'] }, last_note_at: null }] }],
    [/\/api\/contacts\/book/, { total: empty ? 0 : 142, page: 1, page_size: 50, contacts: [] }],
    [/\/api\/relationships\/summary/, { sharing: { opted_in: !empty, teams_shared: empty ? 0 : 1, teams_total: 1 }, requests: { sent_pending: 2, received_pending: 1, made_90d: 1 }, recording: {} }],
    [/intro-requests\?status=pending/, empty ? log([], []) : log([req({ uid: 's1' })], [req({ uid: 'd1' })], { sent_pending: 2, received_pending: 1 })],
    [/intro-requests\?status=accepted/, empty ? log([], []) : log([req({ uid: 'a1', status: 'accepted', accepted_at: '2026-11-03', person: { name: 'Example Priya' }, teammate: { name: 'Example Tom' } })], [])],
    [/intro-requests\?status=made/, empty ? log([], []) : log([req({ uid: 'm1', status: 'made', made_at: '2026-11-01T10:00:00Z', person: { name: 'Example Sara' }, outcome: { label: 'Meeting held' } })], [])],
    [/\/api\/introductions\/propositions/, { propositions: empty ? [] : [{ uid: 'p1', status: 'pending', expires_at: '2026-11-20', target: { name: 'Example Kim', headline: 'GP, Example Fund' }, breakdown: { reasons: ['Invests pre-seed B2B SaaS'] } }], credits: { balance: empty ? 2 : 4 } }],
  ];
}
async function open(page, request, { width, mode, dark = false }) {
  await prepare(page, request);
  await page.setViewportSize({ width, height: 900 });
  // The member's saved appearance (SettingsContext reads it): dark for the dark boards (NW10).
  if (dark) await page.route(/\/api\/settings\/appearance/, (route) => route.fulfill({ status: 200, json: { theme: 'dark' } }));
  const table = reads(mode);
  await page.route(/\/api\/(contacts\/book|relationships\/summary|relationships\/intro-requests|introductions\/propositions)/, (route) => {
    if (mode === 'fail') return route.fulfill({ status: 503, json: { detail: 'Synthetic read failure' } });
    const hit = table.find(([re]) => re.test(route.request().url()));
    return hit ? route.fulfill({ status: 200, json: hit[1] }) : route.continue();
  });
  await page.goto('/network');
  await expect(page.getByTestId('founder-network-desk')).toBeVisible();
}

for (const width of [1440, 390]) {
  for (const dark of [false, true]) {
    test(`NW1 populated at ${width}px${dark ? ', dark' : ''}`, async ({ page, request }, testInfo) => {
      await open(page, request, { width, mode: 'full', dark });
      await expect(page.getByTestId('tile-network-connections')).toContainText('142');
      if (dark) await expect(page.locator('html')).toHaveClass(/dark/);
      await expect(page.getByTestId('tile-network-active')).toContainText('2 waiting · 1 accepted, not yet made');
      await expect(page.getByTestId('row-attention-t1')).toContainText('Send Q3 update');
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await page.screenshot({ path: testInfo.outputPath(`nw1-${width}${dark ? '-dark' : ''}.png`), fullPage: true });
    });
  }
  test(`NW1.2 first run at ${width}px`, async ({ page, request }, testInfo) => {
    await open(page, request, { width, mode: 'empty' });
    await expect(page.getByTestId('network-first-run')).toBeVisible();
    await expect(page.getByTestId('button-network-add-person')).toBeDisabled();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`nw1-2-${width}.png`), fullPage: true });
  });
  test(`NW5 every read failing at ${width}px`, async ({ page, request }, testInfo) => {
    await open(page, request, { width, mode: 'fail' });
    await expect(page.getByTestId('tile-network-connections')).toContainText('Could not be read');
    await expect(page.getByTestId('card-network-introductions')).toContainText('Nothing is shown as zero');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`nw5-${width}.png`), fullPage: true });
  });
}
