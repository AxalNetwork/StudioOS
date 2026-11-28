/**
 * D6913 part 4 (#6913, canvas `Investor Research v2 Data Room to Library`, RS-18 to RS-21 and Eadwyn's proposal): one
 * data room and the Library at 1440 and 390, light and dark, with every read stubbed. The room shows Eadwyn's proposal
 * of its open files not yet added (never an NDA file) and, on a phone, each row's ⋯ bottom sheet; a failed Add keeps
 * the selection; the Library draws room rows as phone cards with the chip, Read-only and No longer available; From data
 * rooms with nothing added says so, and with no live grant says no room is open. Every name and figure is made up.
 *
 *   npm run build   (repo root)
 *   cd frontend && npx --no-install playwright test -c tests/visual/playwright.config.mjs research_room_library_6913.spec.mjs
 */
import { test, expect } from '@playwright/test';
import { prepare } from './_editor.mjs';
test.setTimeout(90_000);

const ROOM = {
  grant: { uid: 'g-1', created_at: '2026-10-12 09:00:00', expires_at: '2027-01-12 00:00:00' },
  project: { uid: 'p-1', name: 'Example Room Co' },
  nda_signed: true, nda: { status: 'on_file', until: '2027-06-01' },
  file_total: 4, file_open: 4, withheld_behind_nda: 0, last_opened_at: '2026-11-10 09:00:00',
  folders: [{ uid: 'fo-1', name: 'Financials', visibility: 'open' }],
  files: [
    { uid: 'f-1', name: 'Sample pricing model.pdf', content_type: 'application/pdf', size_bytes: 1200000, visibility: 'open', folder_uid: 'fo-1', created_at: '2026-10-02 09:00:00', last_downloaded_at: null },
    { uid: 'f-2', name: 'Sample customer list.csv', content_type: 'text/csv', size_bytes: 62000, visibility: 'open', folder_uid: 'fo-1', created_at: '2026-10-05 09:00:00', last_downloaded_at: null },
    { uid: 'f-3', name: 'Sample cap table.xlsx', content_type: 'application/vnd.ms-excel', size_bytes: 48000, visibility: 'nda', folder_uid: 'fo-1', created_at: '2026-09-28 09:00:00', last_downloaded_at: null },
    { uid: 'f-4', name: 'Sample cohort retention.xlsx', content_type: 'application/vnd.ms-excel', size_bytes: 184000, visibility: 'open', folder_uid: 'fo-1', created_at: '2026-10-02 09:00:00', last_downloaded_at: '2026-11-09 16:20:00' },
  ],
  activity: [], download_note: 'Links are issued to you alone.', deals: [], deal_stage_note: 'No deal on this company is open to you.',
};
const ROOM_LIB = { allowed: true, items: [{ file_uid: 'f-4', document_uid: 'd-1', added_at: '2026-11-02 09:00:00' }] };
const room = (over) => ({ project_uid: 'p-1', project_name: 'Example Room Co', added_at: '2026-11-02 09:00:00', lost_at: null, lost_reason: null, access: { until: '2027-01-12 00:00:00' }, ...over });
const doc = (uid, title, extra) => ({ uid, title, kind: 'document', source: 'own', read_only: false, in_ask: true, index_state: 'indexed', chunk_count: 12, source_year: null, created_at: '2026-11-02 09:00:00', size_bytes: 1000, room: null, ...extra });
const LIBRARY = {
  items: [
    doc('d-1', 'Sample cohort retention.xlsx', { read_only: true, size_bytes: null, room: room() }),
    doc('d-2', 'Sample board pack.pdf', { read_only: true, in_ask: false, index_state: 'source_lost', size_bytes: null, room: room({ lost_at: '2026-11-20 00:00:00', lost_reason: 'nda_lapsed', access: null }) }),
    doc('d-3', 'Sample product overview.pdf', { read_only: true, in_ask: false, index_state: 'source_lost', size_bytes: null, room: room({ lost_at: '2026-11-20 00:00:00', lost_reason: 'revoked', access: null }) }),
    doc('d-4', 'Sample benchmarks 2026.pdf', { kind: 'report', source_year: 2026 }),
  ],
  answerable: 2, not_answerable: 2, indexed: 2, from_clients: 0, from_rooms: 3,
};
const OWN_ONLY = { ...LIBRARY, items: [LIBRARY.items[3]], answerable: 1, not_answerable: 0, from_rooms: 0 };

async function open(page, request, { width, dark = false, path, library = LIBRARY, rooms = [{ grant_uid: 'g-1' }], failAdd = false }) {
  const m = await prepare(page, request, { as: 'security' });
  const user = { ...m.security.user, role: 'investor', is_superadmin: false, kyc_status: 'approved' };
  await page.addInitScript((u) => { localStorage.setItem('user', JSON.stringify(u)); localStorage.setItem('viewMode', 'investor'); }, user);
  await page.setViewportSize({ width, height: 900 });
  const posts = [];
  await page.route('**/api/**', async (route) => {
    const req = route.request();
    const p = new URL(req.url()).pathname;
    if (p === '/api/auth/me') return route.fulfill({ json: user });
    if (p === '/api/onboarding/progress') return route.fulfill({ json: { flow: 'investor', completed_at: '2026-10-01' } });
    if (p === '/api/settings/appearance') return route.fulfill({ json: { theme: dark ? 'dark' : 'light' } });
    if (p === '/api/research/diligence/g-1') return route.fulfill({ json: ROOM });
    if (p === '/api/research/diligence') return route.fulfill({ json: { items: rooms, requests: [], granted_count: rooms.length, partial_count: 0 } });
    if (p === '/api/room-library/rooms/p-1') return route.fulfill({ json: ROOM_LIB });
    if (p === '/api/room-library/items' && req.method() === 'POST') {
      posts.push(req.postDataJSON());
      return failAdd ? route.fulfill({ status: 500, json: { error: 'server_error' } }) : route.fulfill({ json: { document_uid: 'd-9' } });
    }
    if (p === '/api/research/documents') return route.fulfill({ json: library });
    return route.fulfill({ json: {} });
  });
  await page.goto(path);
  if (dark) await expect(page.locator('html')).toHaveClass(/dark/);
  return posts;
}
const noSideScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

for (const width of [1440, 390]) {
  for (const dark of [false, true]) {
    const tag = `${width}${dark ? '-dark' : ''}`;
    test(`room: Eadwyn proposes the open files not yet added, at ${tag}`, async ({ page, request }, testInfo) => {
      await open(page, request, { width, dark, path: '/research/diligence/g-1' });
      const card = page.getByTestId('room-library-proposal');
      await expect(card).toBeVisible({ timeout: 60_000 });
      await expect(card).toContainText('2 files open to every invited investor in this room are not in your Library: Sample pricing model.pdf, Sample customer list.csv. Add them?');
      await expect(card).not.toContainText('Sample cap table');
      expect(await noSideScroll(page)).toBe(true);
      await page.screenshot({ path: testInfo.outputPath(`room-proposal-${tag}.png`), fullPage: true });
      await card.screenshot({ path: testInfo.outputPath(`room-proposal-card-${tag}.png`) });
      if (width < 640) {
        await page.getByTestId('room-file-more-f-1').click();
        const sheet = page.getByRole('dialog', { name: 'Sample pricing model.pdf' });
        await expect(sheet).toBeVisible();
        await expect(sheet).toContainText('Add to my Library');
        await expect(sheet).toContainText('Download');
        await page.screenshot({ path: testInfo.outputPath(`room-row-sheet-${tag}.png`) });
        await sheet.getByRole('button', { name: 'Add to my Library' }).click();
        await expect(page.getByTestId('room-library-confirm')).toBeVisible();
        await page.screenshot({ path: testInfo.outputPath(`room-confirm-${tag}.png`) });
      }
    });

    test(`Library with room files as rows and phone cards, at ${tag}`, async ({ page, request }, testInfo) => {
      await open(page, request, { width, dark, path: '/research/library' });
      const scope = width < 640 ? page.getByTestId('library-cards') : page.getByTestId('library-documents');
      await expect(scope).toBeVisible({ timeout: 60_000 });
      await expect(scope).toContainText('A file behind the NDA');
      await expect(scope).not.toContainText('Sample board pack');
      await expect(scope).toContainText('Entries deleted');
      if (width < 640) {
        await expect(page.getByTestId('library-card-room-d-1')).toContainText('Read-only');
        await expect(page.getByTestId('library-card-gone-d-3')).toContainText('The founder ended your access to this room.');
        await expect(page.getByTestId('library-card-open-room-d-3')).toHaveCount(0);
      }
      expect(await noSideScroll(page)).toBe(true);
      await page.screenshot({ path: testInfo.outputPath(`library-${tag}.png`), fullPage: true });
      await scope.screenshot({ path: testInfo.outputPath(`library-rows-${tag}.png`) });
    });
  }
}

test('a failed Add keeps the selection, with Try again (RS-19)', async ({ page, request }, testInfo) => {
  const posts = await open(page, request, { width: 1440, path: '/research/diligence/g-1', failAdd: true });
  await page.getByTestId('room-library-proposal-add').click();
  const failed = page.getByTestId('room-library-proposal-failed');
  await expect(failed).toContainText('The 2 files weren’t added');
  await expect(failed).toContainText('Nothing changed. Your selection is kept.');
  await expect(page.getByTestId('room-library-proposal-add')).toHaveText('Try again');
  expect(posts.map((b) => b.file_uid)).toEqual(['f-1', 'f-2']);
  await page.getByTestId('room-library-proposal').screenshot({ path: testInfo.outputPath('proposal-failed.png') });
});

for (const [name, rooms] of [['no room files yet', [{ grant_uid: 'g-1' }]], ['no live grant', []]]) {
  for (const width of [1440, 390]) {
    test(`RS-18 From data rooms with ${name}, at ${width}`, async ({ page, request }, testInfo) => {
      await open(page, request, { width, path: '/research/library?source=rooms', library: OWN_ONLY, rooms });
      const id = rooms.length ? 'library-rooms-empty-no-room-files' : 'library-rooms-empty-no-rooms';
      await expect(page.getByTestId(id)).toBeVisible({ timeout: 60_000 });
      await expect(page.getByTestId('library-no-match')).toHaveCount(0);
      expect(await noSideScroll(page)).toBe(true);
      await page.getByTestId(id).screenshot({ path: testInfo.outputPath(`rs18-${rooms.length ? 'nothing' : 'no-rooms'}-${width}.png`) });
    });
  }
}
