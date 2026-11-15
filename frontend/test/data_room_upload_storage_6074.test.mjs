// D6074 (#6074) — Data room Upload, DR4s and DR23: storage used and left on
// the plan the files count to, from Usage › Storage's own read; the amber
// line near the limit; a queue that would pass the limit refused before
// anything is sent, with the door to Usage › Storage; an unreadable figure
// says Unreadable (never 0) and does not block; a missing one is Not recorded.
//
// Run with:
//   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/data_room_upload_storage_6074.test.mjs
import './_cycleSteps.mjs'; // D4574: CycleRoute's lazy steps, loaded before it mounts
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import CycleRoute from '../src/pages/cycles/CycleRoute.jsx';
import { ROOM_CAPS } from './_data_room_capabilities.mjs';
import { STORAGE_UNREADABLE, queueEntry, queueStorage, uploadStorage } from '../src/pages/raise/dataroom/filesModel.js';

const h = React.createElement;
const MB = 1024 ** 2;
const GB = 1024 ** 3;
const response = (body, status = 200) => ({ ok: status < 400, status, headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body) });

const ROOM = {
  project: { uid: 'p3uid', name: 'Harbor Ledger' },
  role: 'owner', capabilities: ROOM_CAPS.owner,
  folders: [], files: [{ id: 11, uid: 'a1', name: 'Model.xlsx', folder_id: null, visibility: 'nda', access_tier: 'invited', size_bytes: 2048, created_at: '2026-10-20 10:00:00' }],
  grants: [], report_shares: [], recent_access: [], week: { opened: 0, downloaded: 0, blocked: 0 },
};
const OWNED = [{ uid: 'c1', name: 'Harbor', personal: false, ventures: [{ uid: 'p3uid', name: 'Harbor Ledger' }] }];
/** The Worker's `GET /api/usage/storage` (D1169), as much of it as Upload reads. */
const storage = (over = {}) => ({ plan_key: 'founder:growth', plan_recorded: true, measured_bytes: 1 * GB, allowance_bytes: 5 * GB, unknown_size_files: 0, state: 'ok', kinds: [], companies: OWNED, ...over });
const ready = (over) => ({ status: 'ready', data: storage(over) });

/* ------------------------------------------------------------------ *
 * The model
 * ------------------------------------------------------------------ */

test('uploadStorage: used and left from the Usage read; DR23 near the limit; Unreadable and Not recorded never a 0', () => {
  const ok = uploadStorage(ready(), 'p3uid');
  assert.equal(ok.mode, 'meter');
  assert.equal(ok.line, 'Storage: 1 GB of 5 GB used · 4 GB left.');
  assert.equal(ok.near, null, 'below 80% there is no near-limit line');
  assert.equal(ok.left, 4 * GB);

  const near = uploadStorage(ready({ measured_bytes: Math.round(4.6 * GB), state: 'near_80' }), 'p3uid');
  assert.equal(near.tone, 'amber');
  assert.deepEqual(near.near, { text: 'Your files use 4.6 GB of 5 GB. Versions count too.', link: { label: 'Open Storage', to: '/account/usage/storage' } });
  assert.ok(uploadStorage(ready({ measured_bytes: Math.round(4.8 * GB), state: 'near_95' }), 'p3uid').near, '95% is near too');
  const full = uploadStorage(ready({ measured_bytes: 5 * GB, state: 'full' }), 'p3uid');
  assert.equal(full.line, 'Storage: 5 GB of 5 GB used · None left.');
  assert.equal(full.tone, 'red');

  for (const [why, read] of [
    ['the read failed', { status: 'error' }],
    ['a place could not be read', ready({ measured_bytes: null, kinds: [{ key: 'data_room', recorded: false }] })],
    ['the plan could not be read', ready({ allowance_bytes: null, plan_recorded: false })],
    ['whose plan could not be read', ready({ companies: null })],
  ]) {
    const v = uploadStorage(read, 'p3uid');
    assert.equal(v.mode, 'unreadable', why);
    assert.equal(v.line, STORAGE_UNREADABLE, why);
    assert.doesNotMatch(v.line, /\b0\b|0 B/, `${why}: never drawn as 0`);
  }
  assert.match(STORAGE_UNREADABLE, /^Storage left: Unreadable\. Your storage could not be read\./);

  const negotiated = uploadStorage(ready({ allowance_bytes: null, allowance_reason: 'Your plan’s allowance is set in your agreement' }), 'p3uid');
  assert.equal(negotiated.mode, 'none');
  assert.match(negotiated.line, /^Storage left: Not recorded\. Your plan’s allowance is set in your agreement\./);
  assert.match(uploadStorage(ready({ plan_key: 'admin', allowance_bytes: null }), 'p3uid').line, /^Storage left: Not recorded\. Staff accounts have no storage allowance/);

  const other = uploadStorage(ready(), 'someone-elses-venture');
  assert.equal(other.mode, 'elsewhere', 'a room not among the caller’s ventures counts to the company owner (D1170 §2)');
  assert.match(other.line, /count to the company owner’s storage/);
  assert.equal(uploadStorage({ status: 'loading' }, 'p3uid').mode, 'loading');
});

test('queueStorage: the waiting files’ total against what is left, by the Worker’s rule', () => {
  const view = uploadStorage(ready({ measured_bytes: 5 * GB - 3 * MB }), 'p3uid');
  const entry = (bytes, i) => queueEntry({ name: `f${i}.pdf`, size: bytes }, i);
  assert.equal(queueStorage(view, [entry(2 * MB, 0)]), null, 'a queue that fits is not refused');
  assert.equal(queueStorage(view, [entry(1 * MB, 0), entry(2 * MB, 1)]), null, 'exactly what is left still fits');
  const over = queueStorage(view, [entry(2 * MB, 0), entry(2 * MB, 1)]);
  assert.equal(over.text, 'These 2 files need 4 MB. You have 3 MB left on your plan. Nothing was sent; remove some or make room first.');
  assert.deepEqual(over.links, [{ label: 'Open Storage', to: '/account/usage/storage' }, { label: 'Compare plans', to: '/pricing' }]);
  assert.equal(queueStorage(view, [entry(2 * MB, 0), entry(21 * MB, 1)]), null, 'a file already refused for its size is not counted');
  assert.equal(queueStorage(view, [{ ...entry(4 * MB, 0), state: 'done' }]), null, 'a file already in the room is not counted again');
  const fullView = uploadStorage(ready({ measured_bytes: 5 * GB, state: 'full' }), 'p3uid');
  assert.match(queueStorage(fullView, [entry(0, 0)]).text, /^Storage full\./, 'an empty file on a full plan is refused, as the Worker does');
  for (const read of [{ status: 'error' }, ready({ allowance_bytes: null }), ready({ companies: [] })]) {
    assert.equal(queueStorage(uploadStorage(read, 'p3uid'), [entry(40 * GB, 0)]), null, 'no measured figure never blocks');
  }
});

test('the stale comment is gone: the plan’s limit is read here', () => {
  const model = readFileSync('frontend/src/pages/raise/dataroom/filesModel.js', 'utf8');
  assert.doesNotMatch(model, /no store totals a plan's limit/);
  assert.match(readFileSync('frontend/src/pages/raise/dataroom/DataRoomUpload.jsx', 'utf8'), /usageApi\.storage\(\)/, 'the same read as Usage › Storage');
});

/* ------------------------------------------------------------------ *
 * Mounted
 * ------------------------------------------------------------------ */

function handlerFor({ usage = storage(), usageStatus = 200 } = {}) {
  return (url, opts = {}) => {
    const method = opts.method || 'GET';
    if (method !== 'GET') return response({ ok: true });
    if (/\/api\/usage\/storage$/.test(url)) return response(usageStatus < 400 ? usage : { detail: 'x' }, usageStatus);
    if (/\/api\/projects(\?|$)/.test(url)) return response([{ id: 3, uid: 'p3uid', name: 'Harbor Ledger' }]);
    if (/\/data-room\/p3uid(\?|$)/.test(url)) return response(ROOM);
    if (/\/form-options/.test(url)) return response({ project_uid: 'p3uid', folders: [], requests: [], checklist: [] });
    if (url.includes('/cycles/raise/modules/')) return response({ module: { slug: 'data-room', name: 'Data room', records_title: 'Files' }, card: { state: 'empty', reason: 'No files yet.' }, records: { cols: [], rows: [], total: 0, page: 1, page_size: 25 } });
    return response({});
  };
}

async function mounted(handle) {
  const restore = installDocument();
  const previous = { fetch: globalThis.fetch, matchMedia: globalThis.matchMedia };
  const calls = [];
  globalThis.fetch = async (u, options = {}) => { calls.push({ url: String(u), method: options.method || 'GET', body: options.body }); return handle(String(u), options); };
  globalThis.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  const create = document.createElement.bind(document);
  document.createElement = (tag) => { const node = create(tag); node.querySelector = () => null; node.querySelectorAll = () => []; node.focus = () => {}; node.children = []; return node; };
  document.body.style = { overflow: 'auto', paddingRight: '' };
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => root.render(h(MemoryRouter, { initialEntries: ['/raise/data-room/new?project_id=3'] }, h(Routes, null,
    h(Route, { path: '/raise/:slug/new', element: h(CycleRoute, { cycle: 'raise', adding: true }) }),
  ))));
  const flush = () => act(async () => { for (let i = 0; i < 8; i += 1) await new Promise((r) => setImmediate(r)); });
  await flush();
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const text = (n) => (n?.nodeType === 3 ? n.textContent : n?.childNodes?.length ? n.childNodes.map(text).join('') : n?.textContent || '');
  const props = (n) => Object.entries(n).find(([key]) => key.startsWith('__reactProps$'))?.[1] || {};
  const all = (id) => walk(container).filter((x) => props(x)['data-testid'] === id);
  const find = (id) => { const n = all(id)[0]; assert.ok(n, `no ${id}`); return n; };
  return {
    has: (id) => all(id).length > 0,
    of: (id) => text(find(id)),
    prop: (id, k) => props(find(id))[k],
    hrefs: (id) => walk(find(id)).map((n) => props(n).href).filter(Boolean),
    async click(id, at = 0) { await act(async () => { props(all(id)[at]).onClick(); }); await flush(); },
    async change(id, target) { await act(async () => { props(find(id)).onChange({ target, preventDefault() {} }); }); await flush(); },
    posts: () => calls.filter((c) => c.method === 'POST').map((c) => JSON.parse(c.body).name),
    async close() { await act(async () => root.unmount()); Object.assign(globalThis, { fetch: previous.fetch, matchMedia: previous.matchMedia }); restore(); },
  };
}

const fake = (name, bytes) => ({ name, size: bytes, type: 'application/pdf', arrayBuffer: async () => new ArrayBuffer(0) });

test('Upload shows used and left, and the amber DR23 line near the limit with its door to Usage › Storage', async () => {
  const v = await mounted(handlerFor({ usage: storage({ measured_bytes: Math.round(4.6 * GB), state: 'near_80' }) }));
  try {
    assert.equal(v.of('dataroom-upload-plan-meter'), 'Storage: 4.6 GB of 5 GB used · 410 MB left.');
    assert.match(v.of('dataroom-upload-near'), /Your files use 4\.6 GB of 5 GB\. Versions count too\./);
    assert.equal(v.prop('dataroom-upload-near-open', 'href'), '/account/usage/storage');
    await v.change('dataroom-upload-pick', { files: [fake('Deck.pdf', 2 * MB)] });
    assert.ok(!v.has('dataroom-upload-over'), 'a file that fits is not refused');
    assert.equal(v.prop('dataroom-upload-go', 'disabled'), false);
    await v.click('dataroom-upload-go');
    assert.deepEqual(v.posts(), ['Deck.pdf']);
  } finally { await v.close(); }
  const ok = await mounted(handlerFor());
  try {
    assert.equal(ok.of('dataroom-upload-plan-meter'), 'Storage: 1 GB of 5 GB used · 4 GB left.');
    assert.ok(!ok.has('dataroom-upload-near'), 'below 80% there is no near-limit line');
  } finally { await ok.close(); }
});

test('a queue that would pass the limit is refused before sending, with a link to Usage; removing a file lets the rest go', async () => {
  const v = await mounted(handlerFor({ usage: storage({ measured_bytes: 5 * GB - 3 * MB, state: 'near_95' }) }));
  try {
    await v.change('dataroom-upload-pick', { files: [fake('A.pdf', 2 * MB), fake('B.pdf', 2 * MB)] });
    assert.match(v.of('dataroom-upload-over'), /These 2 files need 4 MB\. You have 3 MB left on your plan\. Nothing was sent/);
    assert.ok(v.hrefs('dataroom-upload-over').includes('/account/usage/storage'), 'the refusal links to Usage › Storage');
    assert.equal(v.prop('dataroom-upload-go', 'disabled'), true);
    await v.click('dataroom-upload-go');
    assert.deepEqual(v.posts(), [], 'nothing is sent');
    await v.click('dataroom-upload-remove', 1);
    assert.ok(!v.has('dataroom-upload-over'), 'the queue fits once a file is out');
    await v.click('dataroom-upload-go');
    assert.deepEqual(v.posts(), ['A.pdf'], 'the file that stayed is the one sent');
  } finally { await v.close(); }
});

test('an unreadable figure says Unreadable, never 0, and does not block uploading', async () => {
  const v = await mounted(handlerFor({ usageStatus: 500 }));
  try {
    assert.match(v.of('dataroom-upload-plan-unreadable'), /^Storage left: Unreadable\. Your storage could not be read\./);
    assert.doesNotMatch(v.of('dataroom-upload-plan-unreadable'), /\b0 B\b|0 MB|0 GB/);
    assert.ok(v.has('dataroom-upload-plan-retry'));
    await v.change('dataroom-upload-pick', { files: [fake('Huge.pdf', 19 * MB)] });
    assert.ok(!v.has('dataroom-upload-over'));
    assert.equal(v.prop('dataroom-upload-go', 'disabled'), false);
    await v.click('dataroom-upload-go');
    assert.deepEqual(v.posts(), ['Huge.pdf'], 'the Worker answers for the plan at upload');
  } finally { await v.close(); }
  const none = await mounted(handlerFor({ usage: storage({ allowance_bytes: null, allowance_reason: null }) }));
  try {
    assert.match(none.of('dataroom-upload-plan-none'), /^Storage left: Not recorded\./);
  } finally { await none.close(); }
});
