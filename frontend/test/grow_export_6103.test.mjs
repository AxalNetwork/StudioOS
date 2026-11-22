/**
 * D6103 (#6103) — Grow's Feedback and KPI exports, on the page D6124 (#6124)
 * built: the Worker's `records.exportable` hands `onExport`, `ExportButton`
 * draws it, and `cyclesApi.growExport` reads the Worker's export route. These
 * check the two D6103 modules through that path, and that the row cap's
 * sentence is what the person sees.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/grow_export_6103.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { h, mountForm } from './_form_d695.mjs';
import CycleModulePage, { ExportButton } from '../src/pages/cycles/CycleModulePage.jsx';
import { api } from '../src/lib/api.js';
import { cyclesApi } from '../src/lib/api/cycles.js';

const ssr = (el) => renderToStaticMarkup(h(MemoryRouter, null, el));
const RECS = { cols: [{ key: 'body', label: 'Feedback' }], rows: [{ id: 'a', cells: { body: 'Make setup easier' } }], total: 1, page: 1, page_size: 25 };

test('D6103: Feedback and KPIs draw Export like any Grow table the Worker marks exportable', () => {
  for (const slug of ['product-improvement', 'revenue-and-traction']) {
    const data = { module: { slug, name: slug }, card: null, records: RECS };
    const props = { cycle: 'grow', slug, data, status: 'ready', records: RECS, query: {} };
    assert.match(ssr(h(CycleModulePage, { ...props, onExport: () => {} })), /data-testid="records-export"[^>]*>Export</, slug);
    assert.doesNotMatch(ssr(h(CycleModulePage, props)), /records-export/, `${slug}: no onExport, no Export`);
  }
});

test('D6103: the client sends the table\'s search, filter and sort for both modules, never a page', async () => {
  const calls = [];
  const was = api._downloadCsv;
  api._downloadCsv = async (path, name) => { calls.push([path, name]); return { filename: name, rows: 3 }; };
  try {
    await cyclesApi.growExport(7, 'product-improvement', { q: 'setup', filter: 'status:shipped', sort: 'created_at', page: 4 });
    await cyclesApi.growExport(7, 'revenue-and-traction', {});
  } finally { api._downloadCsv = was; }
  assert.deepEqual(calls, [
    ['/cycles/grow/modules/product-improvement/export?project=7&q=setup&filter=status%3Ashipped&sort=created_at', 'product-improvement.csv'],
    ['/cycles/grow/modules/revenue-and-traction/export?project=7', 'revenue-and-traction.csv'],
  ]);
  // The drift check reads request() calls only, so the route is held here: the Worker mounts it.
  assert.match(readFileSync(new URL('../../cloudflare-worker/src/routes/cycle_grow.ts', import.meta.url), 'utf8'), /r\.get\('\/modules\/:slug\/export',/);
});

test('D6103: past the row cap the person sees the Worker\'s sentence, not a short file', async () => {
  const sentence = 'This export holds at most 5,000 rows and 5,001 feedback rows match. Narrow the search or a filter, then export again.';
  const ui = await mountForm(h(ExportButton, { onExport: async () => { throw new Error(sentence); } }));
  await ui.click('Export');
  await ui.flush();
  assert.equal(ui.props(ui.by('records-export-error')).role, 'alert');
  assert.ok(ui.text().includes(sentence), ui.text());
  await ui.unmount();
});
