// D1089 (#2954, #2405 part 5) — From Notion on Raise: Capital relationships'
// CRM rows to add or link (immediate Accept, the Worker's wording), and the
// Data room's page snapshots, NDA by default, through "Add a snapshot".
// Mounted against a fake `notionApi`; no test reaches Notion.
//
//   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/notion_raise_d1089.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import FromNotion from '../src/pages/cycles/FromNotion.jsx';
import NotionSnapshotImport, { GATE_WORDS, isUpdate, snapshotBody } from '../src/pages/cycles/NotionSnapshotImport.jsx';

const h = React.createElement;
const read = (p) => readFileSync(p, 'utf8');

async function mount(el) {
  const restore = installDocument();
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  const settle = () => act(async () => { for (let i = 0; i < 6; i += 1) await new Promise((r) => setTimeout(r, 0)); });
  await act(async () => root.render(h(MemoryRouter, null, el)));
  await settle();
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const pr = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const by = (id) => walk(container).find((n) => pr(n)['data-testid'] === id);
  const txt = (n) => (!n ? '' : n.nodeType === 3 ? n.textContent || '' : n.childNodes?.length ? n.childNodes.map(txt).join('') : n.textContent || '');
  return {
    by, pr, text: (id) => txt(id ? by(id) : container).replace(/\s+/g, ' '),
    async click(id) { const n = by(id); if (!n) throw new Error(`Missing ${id}`); await act(async () => { await pr(n).onClick?.({ preventDefault() {} }); }); await settle(); },
    async pick(id) { const n = by(id); await act(async () => { pr(n).onChange({ target: { checked: true } }); }); await settle(); },
    async unmount() { await act(async () => root.unmount()); restore(); },
  };
}

const read_ = (proposals, module) => ({
  module, label: module, lands: 'proposal', connected: true, can_sync: true, writer_ready: false, fields: [],
  sources: [{ uid: 's1', module, title: 'Notion', status: 'active', last_synced_at: '2026-10-21T09:00:00Z' }],
  facts: [], kept_deleted: 0, proposals,
});
function fakeApi(data) {
  const calls = [];
  return {
    calls,
    async fromNotion() { return data; },
    async sync() { return { sources: [] }; },
    async accept(...a) { calls.push(['accept', ...a]); return { ok: true }; },
    async dismiss() { return { ok: true }; },
    async deleteFact() { return { ok: true }; },
  };
}

const ADD = { id: 4, mine: true, kind: 'data_room_snapshot', title: 'Add a snapshot of “Investor memo v3”?', extract: '# Memo', url: null, status: 'pending', changed: false };
const UPDATE = { ...ADD, id: 5, title: 'Update the snapshot of “Investor memo v3”', changed: true };

test('the snapshot body: NDA unless Open is chosen; an update keeps the file\'s gate and sends none', () => {
  assert.deepEqual(snapshotBody(ADD, undefined), { visibility: 'nda' });
  assert.deepEqual(snapshotBody(ADD, 'open'), { visibility: 'open' });
  assert.deepEqual(snapshotBody(UPDATE, 'open'), {});
  assert.equal(isUpdate(UPDATE), true); assert.equal(isUpdate(ADD), false);
  assert.deepEqual(GATE_WORDS.map(([v]) => v), ['nda', 'open'], 'the Worker\'s SNAPSHOT_VISIBILITY');
  assert.match(read('cloudflare-worker/src/services/notion/raise.ts'), /SNAPSHOT_VISIBILITY = Object\.freeze\(\['nda', 'open'\]/);
});

test('Data room: Accept opens Add a snapshot with NDA chosen; Add sends it; Open can be chosen instead', async () => {
  let api = fakeApi(read_([ADD], 'data_room'));
  let v = await mount(h(FromNotion, { section: 'raise', projectId: 701, module: 'data_room', api, acceptDialog: NotionSnapshotImport }));
  try {
    await v.click('notion-accept-4');
    assert.ok(v.by('notion-snapshot-import'));
    assert.equal(v.pr(v.by('notion-snapshot-nda')).checked, true, 'NDA by default');
    assert.equal(v.pr(v.by('notion-snapshot-open')).checked, false);
    await v.click('notion-snapshot-confirm');
    assert.deepEqual(api.calls[0].slice(1), ['raise', 701, 4, { visibility: 'nda' }]);
  } finally { await v.unmount(); }
  api = fakeApi(read_([ADD], 'data_room'));
  v = await mount(h(FromNotion, { section: 'raise', projectId: 701, module: 'data_room', api, acceptDialog: NotionSnapshotImport }));
  try {
    await v.click('notion-accept-4');
    await v.pick('notion-snapshot-open');
    await v.click('notion-snapshot-confirm');
    assert.deepEqual(api.calls[0][4], { visibility: 'open' });
  } finally { await v.unmount(); }
});

test('Update the snapshot says a version is added and the gate kept, and asks nothing more', async () => {
  const api = fakeApi(read_([UPDATE], 'data_room'));
  const v = await mount(h(FromNotion, { section: 'raise', projectId: 701, module: 'data_room', api, acceptDialog: NotionSnapshotImport }));
  try {
    await v.click('notion-accept-5');
    assert.match(v.text('notion-snapshot-what'), /newest version\. The earlier snapshot stays as a version, and the file keeps who can open it\./);
    assert.ok(!v.by('notion-snapshot-gate'), 'no gate to choose');
    await v.click('notion-snapshot-confirm');
    assert.deepEqual(api.calls[0][4], {});
  } finally { await v.unmount(); }
});

test('Capital relationships: the Worker\'s words, Add or Link, and an immediate Accept', async () => {
  const api = fakeApi(read_([
    { id: 7, mine: true, kind: 'prospect', title: 'Add Northwind Ventures at Meeting?', status: 'pending', changed: false },
    { id: 8, mine: true, kind: 'prospect', title: 'Link to Acme Capital', status: 'pending', changed: false },
  ], 'capital_relationships'));
  const v = await mount(h(FromNotion, { section: 'raise', projectId: 701, module: 'capital_relationships', api }));
  try {
    assert.match(v.text('notion-proposal-7'), /Add Northwind Ventures at Meeting\?/);
    assert.match(v.text('notion-proposal-8'), /Link to Acme Capital/);
    await v.click('notion-accept-8');
    assert.deepEqual(api.calls[0].slice(1, 4), ['raise', 701, 8]);
  } finally { await v.unmount(); }
});

test('the wiring: From Notion on Capital relationships and on the Data room with its dialog', () => {
  const route = read('frontend/src/pages/cycles/CycleRoute.jsx');
  assert.match(route, /<FromNotion section="raise" projectId=\{ctx\.projectId\} module="capital_relationships" \/>/);
  assert.match(route, /<FromNotion section="raise" projectId=\{ctx\.projectId\} module="data_room" acceptDialog=\{NotionSnapshotImport\} \/>/);
  const dialog = read('frontend/src/pages/cycles/NotionSnapshotImport.jsx');
  assert.doesNotMatch(dialog, /window\.(alert|confirm|prompt)/);
  for (const m of dialog.matchAll(/className=\{?[`"]([^`"]*)[`"]/g)) if (/\bbg-white\b/.test(m[1])) assert.match(m[1], /dark:bg-/, m[1]);
});
