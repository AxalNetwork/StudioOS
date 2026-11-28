/**
 * #5310 (D5310, D5310-p4): the founder Network overview (NW1, NW1.2, NW5) at 1440 and 390, light and dark,
 * its reads stubbed. The 390 runs are the phone board (NW8) and the dark runs the dark board (NW10).
 * The harness clock is 2026-10-20, so every overdue follow-up is due before it.
 */
import { test, expect } from '@playwright/test';
import { prepare } from './_editor.mjs';
test.setTimeout(60_000);

const req = (o) => ({ uid: 'r1', status: 'pending', requester: { id: 5, name: 'Example Dev' }, teammate: { id: 6, name: 'Example Iris' }, person: { name: 'Example Lena' }, created_at: '2026-11-05 09:00:00', outcome: { label: 'Not recorded' }, ...o });
const log = (s, r, t = {}) => ({ sent: s, received: r, totals: { sent: s.length, received: r.length, sent_pending: 0, received_pending: 0, ...t } });
function reads(mode) {
  const empty = mode === 'empty';
  return [
    [/\/api\/contacts\/book\/follow-ups-due/, empty ? { total: 0, items: [] } : { total: 3, items: [
      { task_uid: 't1', task_title: 'Send Q3 update', due_on: '2026-10-08', contact: { name: 'Example Ada', title: 'Partner', company: 'Example Seed', sources: [] }, last_note_at: '2026-10-04T10:00:00Z' },
      { task_uid: 't2', task_title: 'Ask about pilot', due_on: '2026-10-15', contact: { name: 'Example Ben', title: 'Head of Ops', company: 'Example Analytics', sources: [] }, last_note_at: null },
      { task_uid: 't3', task_title: 'Coffee', due_on: '2026-10-18', contact: { name: 'Example Cleo', sources: ['linkedin_csv'] }, last_note_at: null }] }],
    [/\/api\/contacts\/book/, { total: empty ? 0 : 142, page: 1, page_size: 50, contacts: [] }],
    [/\/api\/relationships\/summary/, { sharing: { opted_in: !empty, teams_shared: empty ? 0 : 1, teams_total: 1 }, requests: { sent_pending: 2, received_pending: 1, made_90d: 1 }, recording: {} }],
    [/intro-requests\?status=pending/, empty ? log([], []) : log([req({ uid: 's1' })], [req({ uid: 'd1' })], { sent_pending: 2, received_pending: 1 })],
    [/intro-requests\?status=accepted/, empty ? log([], []) : log([req({ uid: 'a1', status: 'accepted', accepted_at: '2026-11-03', person: { name: 'Example Priya' }, teammate: { name: 'Example Tom' } })], [])],
    [/intro-requests\?status=made/, empty ? log([], []) : log([req({ uid: 'm1', status: 'made', made_at: '2026-11-01T10:00:00Z', person: { name: 'Example Sara' }, outcome: { label: 'Meeting held' } })], [])],
    [/\/api\/relationships\/activity/, { complete: true, sources: { follow_ups: { state: 'readable' }, introductions: { state: 'readable' }, imports: { state: 'readable' }, duplicate_reviews: { state: 'readable' } },
      events: empty ? [] : [
        { kind: 'follow_up_completed', at: '2026-10-19 16:20:00', label_parts: { action: 'Follow-up completed' } },
        { kind: 'intro_requested', at: '2026-10-17 09:12:00', label_parts: { action: 'Introduction requested' } },
        { kind: 'intro_accepted', at: '2026-10-16 11:04:00', label_parts: { action: 'Introduction accepted' } },
        { kind: 'duplicate_merged', at: '2026-10-12 18:52:00', label_parts: { action: 'Duplicate merged' } },
        { kind: 'contacts_imported', at: '2026-10-12 18:47:00', label_parts: { action: 'Contacts imported', count: 118 } }] }],
    [/\/api\/introductions\/propositions/, { propositions: empty ? [] : [{ uid: 'p1', status: 'pending', expires_at: '2026-11-20', target: { name: 'Example Kim', headline: 'GP, Example Fund' }, breakdown: { reasons: ['Invests pre-seed B2B SaaS'] } }], credits: { balance: empty ? 2 : 4 } }],
  ];
}
async function open(page, request, { width, mode, dark = false }) {
  await prepare(page, request);
  await page.setViewportSize({ width, height: 900 });
  // The member's saved appearance (SettingsContext reads it): dark for the dark boards (NW10).
  if (dark) await page.route(/\/api\/settings\/appearance/, (route) => route.fulfill({ status: 200, json: { theme: 'dark' } }));
  const table = reads(mode);
  await page.route(/\/api\/(contacts\/book|relationships\/summary|relationships\/intro-requests|relationships\/activity|introductions\/propositions)/, (route) => {
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
      await expect(page.getByTestId('row-attention-t1')).toContainText('Overdue 12 d');
      // The tiles that ask for something carry the amber edge and a glyph (NW1, NW8, NW10); the others do not.
      await expect(page.getByTestId('tile-network-attention')).toHaveClass(/is-marked/);
      await expect(page.getByTestId('tile-network-decide')).toHaveClass(/is-marked/);
      await expect(page.getByTestId('tile-network-connections')).not.toHaveClass(/is-marked/);
      // Accept on a curated match is the primary action, in both themes.
      expect(await page.getByTestId('button-match-accept-p1').evaluate((b) => getComputedStyle(b).backgroundColor)).toMatch(/rgb\((109, 40, 217|124, 58, 237)\)/);
      // D5310-p5: Recent network activity is the recorded events, with their times.
      await expect(page.getByTestId('row-network-activity')).toHaveCount(5);
      await expect(page.getByTestId('card-network-activity')).toContainText('Contacts imported · 118 added');
      await expect(page.getByTestId('card-network-activity')).toContainText('2026-10-19 16:20');
      // NW8: one Section picker on the phone in place of the pill row; the pills on a desktop.
      await expect(page.getByTestId('select-network-section')).toBeVisible({ visible: width < 600 });
      await expect(page.getByTestId('link-network-relationships-anchor')).toBeVisible({ visible: width >= 600 });
      if (width < 600) {
        const action = await page.getByTestId('link-network-request-intro').boundingBox();
        const title = await page.getByRole('heading', { name: 'Your network' }).boundingBox();
        expect(action.y).toBeGreaterThan(title.y + title.height);
        expect(action.width).toBeGreaterThan(200);
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      // The app scrolls inside its shell, so a tall viewport is what shows the whole board.
      await page.setViewportSize({ width, height: width < 600 ? 3600 : 1800 });
      await page.screenshot({ path: testInfo.outputPath(`nw1-${width}${dark ? '-dark' : ''}.png`) });
    });
  }
  if (width < 600) test('NW8 the Section picker opens a zone, as its pill does', async ({ page, request }) => {
    await open(page, request, { width, mode: 'full' });
    await expect(page.getByTestId('select-network-section').locator('option')).toHaveText(['Overview', 'People', 'Relationships · 142', 'Introductions · 3', 'Organizations']);
    await page.getByTestId('select-network-section').selectOption({ label: 'Relationships · 142' });
    await expect(page.getByTestId('nw2-book')).toBeVisible();
  });
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
    await expect(page.getByTestId('card-network-activity')).toContainText('This is not an empty history');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`nw5-${width}.png`), fullPage: true });
  });
}
