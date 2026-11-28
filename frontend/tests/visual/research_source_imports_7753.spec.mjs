/**
 * D7753 (#7753, canvas D7738 boards FND-I01 to FND-I06): the source import console at a desk and a phone, light and
 * dark. Signed in as the security scenario's Super Admin; every /api/research-source-imports call is answered here
 * by an in-memory stand-in for the Worker, and the chosen file is an invented package generated in this spec (two
 * sources, a contact column and a record about a person). No baseline is committed: the pictures are test output.
 *
 *   npm run build   (repo root)
 *   cd frontend && npx --no-install playwright test -c tests/visual/playwright.config.mjs research_source_imports_7753.spec.mjs
 */
import { createHash } from 'node:crypto';
import { test, expect } from '@playwright/test';
import { prepare } from './_editor.mjs';
test.setTimeout(150_000);

const sha = (s) => createHash('sha256').update(s).digest('hex');
const digest = (records) => sha(records.map((r) => `${r.provider_record_id}:${r.stated_row_hash}`).sort().join('\n'));

/** An invented package: every value is made up. */
function inventedPackage() {
  const shape = [{ key: 'sample_funds', n: 60, columns: ['field_0', 'field_1', 'field_2'] }, { key: 'sample_people', n: 10, columns: ['contact_0', 'field_1'] }];
  const records = [];
  for (const s of shape) for (let i = 0; i < s.n; i++) {
    const id = `${s.key.slice(7, 10)}-${String(i).padStart(4, '0')}`;
    records.push({
      source_key: s.key, provider_record_id: id, stated_row_hash: sha(`${id}|invented`),
      cells: s.columns.map((c) => [c, c.startsWith('contact_') ? `someone${i}@example.invalid` : `Invented ${c} ${i}`]),
      ...(s.key === 'sample_people' && i === 0 ? { about_person: true } : {}),
    });
  }
  const manifest = { sources: shape.map((s) => {
    const mine = records.filter((r) => r.source_key === s.key);
    return { source_key: s.key, columns: s.columns, expected_records: s.n, expected_cells: s.n * s.columns.length, digest: digest(mine) };
  }) };
  return Buffer.from(JSON.stringify({ manifest, records }));
}

const RUN_A = '6a0e0d0c-0000-4000-8000-00000000000a';
const RUN_B = '7b0e0d0c-0000-4000-8000-00000000000b';
const summary = (uid, status, sources = null) => ({
  uid, status, acted_by_user_id: 9001, worker_version: 'a41c09e2f1', started_at: '2026-10-19T10:05:00.000Z',
  verified_at: status === 'complete' ? '2026-10-19T10:06:00.000Z' : null,
  counts: { outcomes: { new: 120, unchanged: 3500, new_version: 14, refused: 2 }, cells: { sample_funds: { field_0: { stored: 3620, withheld: 0, blank: 16 } } } },
  uncertain_chunks: [], file_digest: { sha256: sha('invented file'), status: 'declared_not_checked' }, row_hashes: 'declared_not_checked',
  ...(sources ? { sources } : {}),
});

/** The Worker, in memory, for one page. */
async function answerImports(page) {
  const runs = [summary(RUN_A, 'complete'), summary(RUN_B, 'failed')];
  let current = null;
  await page.route(/\/api\/research-source-imports\//, async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const path = url.pathname.replace('/api/research-source-imports', '');
    const body = req.method() === 'POST' ? JSON.parse(req.postData() || '{}') : null;
    if (path === '/preview') {
      return route.fulfill({ json: { writes: 'none', sources: body.manifest.sources.map((s) => ({ source_key: s.source_key, expected_records: s.expected_records, sent: s.expected_records, new: s.expected_records, unchanged: 0, changed: 0, removed: 0, private_fields_removed: 0, list_digest_matches: true })) } });
    }
    if (path === '/runs' && req.method() === 'GET') return route.fulfill({ json: { runs: current ? [current.summary(), ...runs] : runs, limit: 50 } });
    if (path === '/runs' && req.method() === 'POST') {
      const uid = '0f0e0d0c-0000-4000-8000-00000000000c';
      const members = [];
      const cells = {};
      current = {
        uid, manifest: body.manifest, classes: body.column_classes, chunks: [], members, cells, status: 'running',
        summary() { return { ...summary(uid, this.status), counts: { outcomes: { new: members.length }, cells }, file_digest: { sha256: body.file_sha256, status: 'declared_not_checked' }, sources: body.manifest.sources.map((s) => ({ source_key: s.source_key, columns: s.columns.length, expected_records: s.expected_records, expected_cells: s.expected_cells, list_digest: { sha256: s.digest, status: 'declared_checked_at_seal' }, excluded_person_records: s.excluded_person_records ?? null })) }; },
      };
      return route.fulfill({ status: 201, json: { run: current.summary(), replayed: false, chunk_bound: { records: 50, bytes: 600000 } } });
    }
    const one = /^\/runs\/([^/]+)(\/(chunks|seal|reconcile))?$/.exec(path);
    if (one && current && decodeURIComponent(one[1]) === current.uid) {
      if (one[3] === 'chunks') {
        current.chunks.push(body.chunk_index);
        for (const r of body.records) {
          current.members.push({ source_key: r.source_key, provider_record_id: r.provider_record_id, stated_row_hash: r.stated_row_hash, outcome: 'new', refusal_code: null, chunk_index: body.chunk_index });
          const src = current.manifest.sources.find((s) => s.source_key === r.source_key);
          const present = new Map(r.cells);
          for (const c of src.columns) {
            const t = ((current.cells[r.source_key] ??= {})[c] ??= { stored: 0, withheld: 0, blank: 0 });
            if (current.classes[r.source_key][c].class === 'contact') t.withheld += 1; else if (present.get(c)) t.stored += 1; else t.blank += 1;
          }
        }
        return route.fulfill({ json: { run_uid: current.uid, chunk_index: body.chunk_index, status: 'written', written: true, counts: {}, refused: [], refused_count: 0 } });
      }
      if (one[3] === 'seal') { current.status = 'complete'; return route.fulfill({ json: { run_uid: current.uid, status: 'complete', sources: {}, uncertain_chunks: [], named: {} } }); }
      const list = {};
      for (const s of current.manifest.sources) {
        const kept = current.members.filter((m) => m.source_key === s.source_key);
        list[s.source_key] = { declared: s.digest, recomputed: digest(kept), matches: digest(kept) === s.digest, members: kept.length };
      }
      return route.fulfill({ json: { run: current.summary(), held_chunks: current.chunks, list_digests: list, members: current.members, members_total: current.members.length, offset: 0, next_offset: null } });
    }
    if (one) {
      const uid = decodeURIComponent(one[1]);
      const sources = [{ source_key: 'sample_funds', columns: 3, expected_records: 3620, expected_cells: 10860, list_digest: { sha256: sha('a'), status: 'declared_checked_at_seal' }, excluded_person_records: 0 }];
      return route.fulfill({ json: {
        run: summary(uid, uid === RUN_A ? 'complete' : 'failed', sources), held_chunks: [0, 1, 2], list_digests: { sample_funds: { declared: sha('a'), recomputed: sha('a'), matches: true, members: 3620 } },
        members: [
          { source_key: 'sample_funds', provider_record_id: 'fun-0001', stated_row_hash: sha('x'), outcome: 'refused', refusal_code: 'duplicate_in_chunk', chunk_index: 0 },
          { source_key: 'sample_funds', provider_record_id: 'fun-0002', stated_row_hash: sha('y'), outcome: 'new', refusal_code: null, chunk_index: 0 },
        ], members_total: 2, offset: 0, next_offset: null,
      } });
    }
    return route.fulfill({ status: 404, json: { code: 'run_not_found' } });
  });
}

async function open(page, request, width, theme) {
  await prepare(page, request, { as: 'security' });
  await page.setViewportSize({ width, height: 900 });
  if (theme === 'dark') await page.route('**/api/settings/appearance', (route) => (route.request().method() === 'GET' ? route.fulfill({ json: { theme: 'dark' } }) : route.continue()));
  await answerImports(page);
  await page.goto('/research/source-imports');
  await expect(page.getByTestId('source-imports')).toBeVisible({ timeout: 60_000 });
  if (theme === 'dark') await expect(page.locator('html')).toHaveClass(/dark/);
}

const noSideScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

for (const width of [1440, 390]) {
  for (const theme of ['light', 'dark']) {
    test(`source imports at ${width}px in ${theme}: runs, choose a file, preview, apply to Complete, one run`, async ({ page, request }, testInfo) => {
      await open(page, request, width, theme);
      await expect(page.getByRole('heading', { name: 'Source imports', level: 1 })).toBeVisible();
      await expect(page.getByTestId('source-imports-runs')).toContainText('6a0e0d0c');
      expect(await noSideScroll(page)).toBe(true);
      await page.screenshot({ path: testInfo.outputPath(`runs-${width}-${theme}.png`), fullPage: true });

      await page.getByRole('button', { name: 'Choose a file' }).first().click();
      const sheet = page.getByTestId('source-imports-run-sheet');
      await expect(sheet).toBeVisible();
      await page.getByTestId('source-imports-file').setInputFiles({ name: 'invented.json', mimeType: 'application/json', buffer: inventedPackage() });
      await expect(page.getByTestId('source-imports-manifest')).toBeVisible();
      await expect(page.getByTestId('source-imports-gap')).toBeVisible();
      for (const select of await sheet.locator('select').all()) {
        const label = await select.evaluate((el) => el.closest('label')?.querySelector('span')?.textContent || '');
        await select.selectOption(label.startsWith('contact_') ? 'contact' : 'fact');
      }
      await expect(page.getByTestId('source-imports-gap')).toHaveCount(0);
      await page.screenshot({ path: testInfo.outputPath(`check-${width}-${theme}.png`), fullPage: true });
      await sheet.getByRole('button', { name: 'Preview' }).click();
      await expect(page.getByTestId('source-imports-preview').first()).toBeVisible();
      await expect(sheet).toContainText('Nothing has been written.');
      expect(await noSideScroll(page)).toBe(true);
      await page.screenshot({ path: testInfo.outputPath(`preview-${width}-${theme}.png`), fullPage: true });
      await sheet.getByRole('button', { name: /^Apply 69 records/ }).click();
      await expect(sheet).toContainText('Complete · counts verified', { timeout: 60_000 });
      await expect(page.getByTestId('source-imports-readback').first()).toBeVisible();
      await page.screenshot({ path: testInfo.outputPath(`complete-${width}-${theme}.png`), fullPage: true });

      await page.goto(`/research/source-imports/runs/${RUN_A}`);
      await expect(page.getByTestId('source-import-run')).toBeVisible({ timeout: 60_000 });
      await expect(page.getByTestId('source-import-run-refused')).toContainText('duplicate_in_chunk');
      await page.getByTestId('source-import-remove-typed').fill('remove source sample_funds');
      expect(await noSideScroll(page)).toBe(true);
      await page.screenshot({ path: testInfo.outputPath(`run-${width}-${theme}.png`), fullPage: true });
    });
  }
}
