/**
 * D6103 (#6103) — Grow's Export: the client method (`lib/api/cycles.js`
 * `exportCsv`), its path against the Worker route, and the opt-in Export
 * control on the shared module page (`CycleModulePage.jsx`).
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/grow_export_6103.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';

import { api } from '../src/lib/api.js';
import { canExport, cyclesApi } from '../src/lib/api/cycles.js';
import CycleModulePage, { RecordsTable } from '../src/pages/cycles/CycleModulePage.jsx';
import { mountContracts } from './_contracts_dom.mjs';

const source = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const html = (el) => renderToStaticMarkup(h(MemoryRouter, { initialEntries: ['/grow/product-improvement'] }, el));
const records = { cols: [{ key: 'body', label: 'Feedback' }], rows: [{ id: 'a', cells: { body: 'Make setup easier' } }], total: 1, page: 1, page_size: 25, filters: [], sorts: [] };

test('only Feedback and KPIs have an export; every other module, in every cycle, has none', async () => {
  assert.equal(canExport('grow', 'product-improvement'), true);
  assert.equal(canExport('grow', 'revenue-and-traction'), true);
  for (const [cycle, slug] of [['grow', 'distribution'], ['grow', 'partner-network'], ['validate', 'product-improvement'], ['build', 'solution-design'], ['raise', 'cap-table']]) {
    assert.equal(canExport(cycle, slug), false, `${cycle}/${slug}`);
  }
  await assert.rejects(cyclesApi.exportCsv('grow', 7, 'distribution', {}), /no export/);
});

test('the client sends the table\'s search, filter and sort to the Worker\'s export route, from the first row', async () => {
  const calls = [];
  const was = api._downloadCsv;
  api._downloadCsv = async (path, name) => { calls.push([path, name]); return { filename: name, rows: 3 }; };
  try {
    const out = await cyclesApi.exportCsv('grow', 7, 'product-improvement', { q: 'setup', filter: 'status:shipped', sort: 'created_at', page: 4 });
    assert.deepEqual(out, { filename: 'feedback.csv', rows: 3 });
    await cyclesApi.exportCsv('grow', 7, 'revenue-and-traction', {});
  } finally { api._downloadCsv = was; }
  assert.deepEqual(calls, [
    ['/cycles/grow/modules/product-improvement/export?project=7&q=setup&filter=status%3Ashipped&sort=created_at', 'feedback.csv'],
    ['/cycles/grow/modules/revenue-and-traction/export?project=7', 'kpis.csv'],
  ], 'a page number is never sent: the file is every matching row');
  // The drift check reads request() calls only, so the route is held here: the Worker mounts it.
  assert.match(source('../../cloudflare-worker/src/routes/cycle_grow.ts'), /r\.get\('\/modules\/:slug\/export',/);
});

test('Export is opt-in: the shared page draws it only when the caller passes onExport', () => {
  const without = html(h(CycleModulePage, { cycle: 'grow', slug: 'product-improvement', data: { card: null, module: { name: 'Product improvement', records_title: 'Feedback' }, records } }));
  assert.doesNotMatch(without, /records-export/);
  const withIt = html(h(CycleModulePage, { cycle: 'grow', slug: 'product-improvement', onExport: async () => ({}), data: { card: null, module: { name: 'Product improvement', records_title: 'Feedback' }, records } }));
  assert.match(withIt, /data-testid="records-export"[^>]*>Export CSV</);
  assert.doesNotMatch(html(h(RecordsTable, { title: 'Feedback', records, status: 'loading', onExport: async () => ({}) })), /records-export/, 'not while the table loads');
});

test('the route passes onExport only where the module has one and the read says this viewer may', () => {
  const route = source('../src/pages/cycles/CycleRoute.jsx');
  assert.match(route, /onExport=\{!narrativeAdmin && projectId && canExport\(cycle, slug\) && read\?\.can_export === true/);
});

test('pressing Export saves the file and says how many rows; a refusal shows the Worker\'s sentence', async () => {
  let n = 0;
  const ok = await mountContracts(h(RecordsTable, { title: 'Feedback', records, onExport: async () => { n++; return { rows: 3 }; } }), '/grow/product-improvement');
  try {
    await ok.click('Export CSV');
    await ok.flush();
    assert.equal(n, 1);
    assert.match(ok.text(), /Exported 3 rows\./);
  } finally { await ok.unmount(); }
  const sentence = 'This export holds at most 5,000 rows and 5,001 feedback rows match. Narrow the search or a filter, then export again.';
  const refused = await mountContracts(h(RecordsTable, { title: 'Feedback', records, onExport: async () => { throw new Error(sentence); } }), '/grow/product-improvement');
  try {
    await refused.click('Export CSV');
    await refused.flush();
    assert.ok(refused.text().includes(sentence), refused.text());
    assert.doesNotMatch(refused.text(), /Exported/);
  } finally { await refused.unmount(); }
});
