/**
 * D6124 (#6124): a Grow table's Export. It is drawn beside Add only when the
 * page hands `onExport` (the Worker's `records.exportable`) and the table has
 * rows, on the desktop and the phone page; it says it is working and shows a
 * refusal's sentence. The client method reads the Worker's export route.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/grow_export_6124.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { h, mountForm } from './_form_d695.mjs';
import CycleModulePage, { ExportButton } from '../src/pages/cycles/CycleModulePage.jsx';
import PhoneModulePage from '../src/pages/cycles/PhoneModulePage.jsx';
import { api } from '../src/lib/api.js';
import { cyclesApi } from '../src/lib/api/cycles.js';

const ssr = (el) => renderToStaticMarkup(h(MemoryRouter, null, el));
const RECS = { cols: [{ key: 'partner', label: 'Partner' }], rows: [{ id: 'gp1', cells: { partner: 'Acme' } }], total: 1, page: 1, page_size: 25 };
const DATA = { module: { slug: 'partner-network', name: 'Partner network' }, card: null, records: RECS };
const props = (extra = {}) => ({ cycle: 'grow', slug: 'partner-network', data: DATA, status: 'ready', records: RECS, query: {}, ...extra });

test('D6124: Export is drawn only with onExport and rows, on both pages', () => {
  const onExport = () => {};
  for (const Page of [CycleModulePage, PhoneModulePage]) {
    assert.match(ssr(h(Page, props({ onExport }))), /data-testid="records-export"[^>]*>Export</, Page.name);
    assert.doesNotMatch(ssr(h(Page, props())), /records-export/, `${Page.name}: no onExport, no Export`);
    const empty = { ...RECS, rows: [], total: 0 };
    assert.doesNotMatch(ssr(h(Page, props({ onExport, records: empty, data: { ...DATA, records: empty } }))), /records-export/, `${Page.name}: no rows, no Export`);
    assert.doesNotMatch(ssr(h(Page, props({ onExport, recordsStatus: 'unreadable' }))), /records-export/, `${Page.name}: unreadable rows, no Export`);
  }
});

test('D6124: a refused export shows the Worker’s own sentence, and Export can be pressed again', async () => {
  let calls = 0;
  const ui = await mountForm(h(ExportButton, { onExport: async () => { calls += 1; throw new Error('You can read this venture but not change it'); } }));
  await ui.click('Export');
  await ui.flush();
  assert.equal(ui.props(ui.by('records-export-error')).role, 'alert');
  assert.equal(ui.text(), 'ExportYou can read this venture but not change it');
  await ui.click('Export');
  assert.equal(calls, 2);
  await ui.unmount();
});

test('D6124: the client reads the export route with the table’s query, from page one', async () => {
  const calls = [];
  const original = api._downloadCsv;
  api._downloadCsv = async (path, name) => { calls.push([path, name]); return { filename: name, rows: 1 }; };
  try {
    await cyclesApi.growExport(7, 'partner-network', { q: 'acme', filter: 'stage:signed', sort: '-name', page: 3 });
  } finally { api._downloadCsv = original; }
  assert.deepEqual(calls, [['/cycles/grow/modules/partner-network/export?project=7&q=acme&filter=stage%3Asigned&sort=-name', 'partner-network.csv']]);
});

test('D6124: the route hands Export only where the Worker says this viewer may export', () => {
  const route = readFileSync(new URL('../src/pages/cycles/CycleRoute.jsx', import.meta.url), 'utf8');
  assert.match(route, /onExport=\{cycle === 'grow' && projectId && read\?\.exportable === true\s*\? \(\) => cyclesApi\.growExport\(projectId, slug, \{ q: query\.q, filter: filterString\(query\.filter\), sort: query\.sort \}\) : undefined\}/);
});
