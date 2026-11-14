/**
 * D6043 (#6043) — Export on a Build module's records list: shown from the
 * 'few' stage on (never at zero) on desktop and phone, only where the caller
 * hands an exporter, sending the table's own search, filters and sort; a
 * refusal is its sentence under the button. The Worker side is
 * cloudflare-worker/test/build_module_export_d6043.test.ts.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/build_module_export_6043.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';

import CycleModulePage from '../src/pages/cycles/CycleModulePage.jsx';
import PhoneModulePage from '../src/pages/cycles/PhoneModulePage.jsx';
import RecordsExport from '../src/pages/cycles/RecordsExport.jsx';
import { buildExportPath } from '../src/lib/api/buildModuleExport.js';
import { LIST_CONTROLS_FROM } from '../src/pages/cycles/progressiveList.js';

const h = React.createElement;
const read = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const html = (el) => renderToStaticMarkup(h(MemoryRouter, { initialEntries: ['/build/product-roadmap'] }, el));
const cols = [{ key: 'item', label: 'Item' }];
const recs = (n) => ({ cols, rows: Array.from({ length: Math.min(n, 25) }, (_, i) => ({ id: i + 1, cells: { item: `Item ${i + 1}` } })), total: n, page: 1, page_size: 25, filters: [], sorts: [] });
const data = (n) => ({ module: { slug: 'product-roadmap', name: 'Product roadmap', records_title: 'Roadmap items' }, card: { slug: 'product-roadmap', name: 'Product roadmap', state: 'ok', series: [] }, records: recs(n) });
const onExport = async () => ({ rows: 1 });
const EXPORT = /data-testid="records-export"/g;

for (const [label, Page] of [['desktop', CycleModulePage], ['phone', PhoneModulePage]]) {
  test(`${label}: no Export at zero; Export at few and at many; none without an exporter`, () => {
    const page = (n, props = {}) => html(h(Page, { cycle: 'build', slug: 'product-roadmap', data: data(n), query: {}, add: [{ text: 'Add item', href: '/build/product-roadmap/new' }], ...props }));
    assert.equal((page(0, { onExport }).match(EXPORT) || []).length, 0, 'zero: the one first action only');
    assert.equal((page(1, { onExport }).match(EXPORT) || []).length, 1, 'few');
    assert.equal((page(LIST_CONTROLS_FROM, { onExport }).match(EXPORT) || []).length, 1, 'many');
    assert.equal((page(3).match(EXPORT) || []).length, 0, 'a cycle that hands no exporter has no Export');
    assert.equal((page(3, { onExport, recordsStatus: 'unreadable' }).match(EXPORT) || []).length, 0, 'an unreadable list exports nothing');
  });
}

test('the phone button is a full-width 44px target', () => {
  const out = html(h(RecordsExport, { onExport, phone: true }));
  assert.match(out, /min-h-\[44px\] w-full/);
  assert.match(out, />Export CSV</);
});

test('the client path carries the table\'s search, filters and sort, never a page, and escapes the slug', () => {
  assert.equal(buildExportPath(7, 'product-roadmap', { q: 'pricing page', filter: 'column:now,kpi:mrr', sort: '-column' }),
    '/cycles/build/modules/product-roadmap/export?project=7&q=pricing+page&filter=column%3Anow%2Ckpi%3Amrr&sort=-column');
  assert.equal(buildExportPath(7, 'a/b'), '/cycles/build/modules/a%2Fb/export?project=7');
  assert.doesNotMatch(buildExportPath(7, 'x', { q: '', page: 3 }), /page=/);
});

test('only Build names an exporter, and CycleRoute hands it the table\'s query through filterString', async () => {
  const src = read('frontend/src/pages/cycles/CycleRoute.jsx');
  assert.match(src, /onExport=\{def\.exportRecords && projectId && !narrativeAdmin\s*\? \(\) => def\.exportRecords\(projectId, slug, \{ q: query\.q, filter: filterString\(query\.filter\), sort: query\.sort \}\) : null\}/);
  assert.match(read('frontend/src/pages/cycles/defs/build.jsx'), /exportRecords: \(projectId, slug, query\) => buildModuleExportApi\.exportCsv\(projectId, slug, query\)/);
  for (const c of ['validate', 'raise', 'grow']) assert.doesNotMatch(read(`frontend/src/pages/cycles/defs/${c}.jsx`), /exportRecords/, c);
});

async function mount(node) {
  const restore = installDocument();
  const container = document.createElement('div');
  const root = createRoot(container);
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const text = (n) => (!n ? '' : n.childNodes?.length ? n.childNodes.map(text).join('') : n.textContent || '');
  const props = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const byId = (id) => walk(container).find((n) => props(n)['data-testid'] === id);
  const settle = async () => { for (let i = 0; i < 6; i += 1) await act(async () => { await Promise.resolve(); }); };
  await act(async () => root.render(node));
  return {
    byId, props: (id) => props(byId(id)), text: (id) => text(byId(id)),
    async click(id) { await act(async () => { props(byId(id)).onClick(); }); await settle(); },
    async close() { await act(async () => root.unmount()); restore(); },
  };
}

test('a refusal is its sentence under the button, and the next try clears it', async () => {
  let calls = 0;
  const answers = [new Error('This list has 5003 matching rows; an export writes at most 5000. Narrow it with a search or a filter.'), { rows: 2 }];
  const m = await mount(h(RecordsExport, { onExport: async () => { const a = answers[calls++]; if (a instanceof Error) throw a; return a; } }));
  await m.click('records-export');
  assert.equal(calls, 1);
  assert.match(m.text('records-export-error'), /at most 5000\. Narrow it/);
  assert.equal(m.props('records-export').disabled, false);
  await m.click('records-export');
  assert.equal(calls, 2);
  assert.equal(m.byId('records-export-error'), undefined);
  assert.equal(m.props('records-export').disabled, false, 'a finished export frees the button');
  assert.equal(m.text('records-export'), 'Export CSV');
  await m.close();
});
