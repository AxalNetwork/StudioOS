/**
 * D4815 DX10 (#5907, board DE10) — the Data room tab's access states, each
 * its own: A not opened (Ask for access), B access with files that require an
 * NDA (Sign NDA), C the NDA out for signature (Waiting for signatures), D open
 * (folders, search, files with Name, Type, Size, Added and Open), and E access
 * that could not be confirmed (Try again, never Ask).
 *
 * The mounted harness is copied from `deal_work_d1153.test.mjs`.
 *
 * Run with:
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/deals_v2_data_room_states_5907.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import { AuthProvider } from '../src/hooks/useAuthSync.jsx';
import DealRoomPage from '../src/pages/DealRoomPage.jsx';
import { forgetVisits } from '../src/pages/deal/dealVisit.js';
import { fileTypeOf, roomListing, roomStateOf } from '../src/pages/deal/dealWorkModel.js';

const h = React.createElement;
const response = (body, status = 200) => ({ ok: status < 400, status, headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body) });
const ready = (data) => ({ status: 'ready', data });

const DEAL = { id: 4, project_id: 7, project_name: 'Harbor Ledger', project_sector: 'Fintech', status: 'active', currency: 'USD', target_raise: 1000000, capital_committed: 250000, minimum_check: 25000, instrument: 'Post-money SAFE', valuation_cap: 12000000, closing_deadline: '2026-12-01' };
const INVESTOR = { id: 21, role: 'investor', name: 'Ada', email: 'ada@example.com', subscription_tier: 'professional' };
const ROOM = {
  project: { uid: 'harbor', name: 'Harbor Ledger' }, nda_signed: false,
  folders: [{ uid: 'f1', name: 'Legal' }], files: [{ uid: 'a', name: 'Certificate of incorporation.pdf', folder_uid: 'f1', size_bytes: 245760, created_at: '2026-01-14 09:00:00' }, { uid: 'b', name: 'Product overview.pdf', folder_uid: null, size_bytes: 400, created_at: null }],
  withheld_behind_nda: 6,
};

/* ------------------------------------------------------------------ *
 * The model
 * ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ *
 * Mounted
 * ------------------------------------------------------------------ */

function handlerWith(over = {}) {
  return (url, init = {}) => {
    const m = (init.method || 'GET').toUpperCase();
    for (const [re, fn] of Object.entries(over)) if (new RegExp(re).test(url)) { const r = fn(url, m, init); if (r) return r; }
    if (/\/api\/deals\/4\/stage/.test(url)) return response({ my_stage: 'Diligence', reason: null, next_action: { label: 'Open the diligence case', href: '/x', kind: 'navigate' }, ic: { state: 'used' } });
    if (/\/api\/deals\/4\/commitments/.test(url)) return response([]);
    if (/\/api\/deals\/4\/round/.test(url)) return response({ investors: 2, confirmed_total: 250000, pending_total: 0, currency: 'USD' });
    if (/\/api\/deals\/4\/room-access/.test(url)) return response({ project_uid: 'harbor', founder_user_id: 9, granted: { expires_at: null }, nda: null, request: null });
    if (/\/api\/data-room\/shared\/harbor/.test(url)) return response(ROOM);
    if (/\/api\/legal\/esign/.test(url)) return response({ envelopes: [] });
    if (/\/api\/dd\/cases/.test(url)) return response({ items: [], total: 0 });
    if (/\/api\/networkfx\/syndicates/.test(url)) return response([]);
    if (/\/api\/deals\/4(\?|$)/.test(url)) return response(DEAL);
    return response({});
  };
}

async function mounted(url, user, handler = handlerWith()) {
  forgetVisits();
  const restore = installDocument();
  const previous = { fetch: globalThis.fetch, matchMedia: globalThis.matchMedia };
  const requests = [];
  globalThis.fetch = async (u, init) => { requests.push({ line: `${(init?.method || 'GET').toUpperCase()} ${String(u)}`, body: init?.body ? JSON.parse(init.body) : null }); return handler(String(u), init); };
  globalThis.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  localStorage.setItem('user', JSON.stringify(user));
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => root.render(h(MemoryRouter, { initialEntries: [url] }, h(AuthProvider, null,
    h(Routes, null,
      h(Route, { path: '/deals/:dealId', element: h(DealRoomPage) }),
      h(Route, { path: '/deals/:dealId/:tab', element: h(DealRoomPage) }))))));
  const settle = async () => { await act(async () => { for (let i = 0; i < 14; i += 1) await new Promise((r) => setImmediate(r)); }); };
  await settle();
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const nodes = () => walk(document.body);
  const text = (n) => (n?.nodeType === 3 ? n.textContent : n?.childNodes?.length ? n.childNodes.map(text).join('') : n?.textContent || '');
  const props = (n) => Object.entries(n).find(([key]) => key.startsWith('__reactProps$'))?.[1] || {};
  const byId = (id) => nodes().filter((n) => props(n)['data-testid'] === id);
  return {
    requests, text: () => text(document.body), byId,
    has: (id) => byId(id).length > 0,
    textOf: (id) => text(byId(id)[0]),
    textOfNode: (n) => text(n),
    posts: (re) => requests.filter((r) => r.line.startsWith('POST') && re.test(r.line)),
    async click(id) { const n = byId(id)[0]; assert.ok(n, `no ${id}`); await act(async () => { props(n).onClick?.({ preventDefault() {}, stopPropagation() {} }); }); await settle(); },
    async type(id, value) { const n = byId(id)[0]; assert.ok(n, `no ${id}`); await act(async () => { props(n).onChange?.({ target: { value } }); }); },
    async close() { await act(async () => root.unmount()); Object.assign(globalThis, previous); localStorage.removeItem('user'); restore(); },
  };
}

const accessOf = (o = {}) => ({ project_uid: 'harbor', founder_user_id: 9, granted: { expires_at: null }, nda: null, request: null, ...o });

/* ------------------------------------------------------------------ *
 * The model
 * ------------------------------------------------------------------ */

test('roomStateOf: A, B, C, D and E are five states, each in DE10\'s words', () => {
  const a = roomStateOf(ready(accessOf({ granted: null })));
  assert.deepEqual([a.state, a.line, a.canAsk], ['not_opened', 'The founder has not opened the data room to you.', true]);

  const b = roomStateOf(ready(accessOf()), ready(ROOM));
  assert.deepEqual([b.state, b.line, b.canSign, b.ndaPending], ['behind_nda', 'You have access. 6 files require an NDA.', true, false]);
  const one = roomStateOf(ready(accessOf()), ready({ ...ROOM, withheld_behind_nda: 1 }));
  assert.equal(one.line, 'You have access. 1 file requires an NDA.');

  const c = roomStateOf(ready(accessOf({ nda: { status: 'out_for_signature' } })), ready(ROOM));
  assert.deepEqual([c.state, c.line, c.canSign, c.withheld], ['nda_pending', 'Waiting for signatures.', false, 6]);
  assert.equal(c.sub, '6 files open once every party has signed.');
  const until = roomStateOf(ready(accessOf({ granted: { expires_at: '2027-01-31 00:00:00' }, nda: { status: 'out_for_signature' } })), ready({ ...ROOM, withheld_behind_nda: 1 }));
  assert.match(until.sub, /^1 file opens once every party has signed\. Your access ends 31 Jan 2027\.$/);

  const d = roomStateOf(ready(accessOf()), ready({ ...ROOM, withheld_behind_nda: 0 }));
  assert.equal(d.state, 'open');
  const signed = roomStateOf(ready(accessOf({ nda: { status: 'on_file', valid_until: null } })), ready({ ...ROOM, nda_signed: true, withheld_behind_nda: 0 }));
  assert.equal(signed.state, 'nda_on_file');

  const e = roomStateOf({ status: 'unreadable' });
  assert.deepEqual([e.state, e.line, e.canAsk], ['unreadable', 'Data room access could not be confirmed.', undefined]);
  // An out-for-signature NDA with nothing withheld is not C: there is nothing to wait for.
  assert.equal(roomStateOf(ready(accessOf({ nda: { status: 'out_for_signature' } })), ready({ ...ROOM, withheld_behind_nda: 0 })).state, 'open');
});

test('fileTypeOf: a reader\'s word from the content type, else the extension; neither is Not recorded', () => {
  assert.equal(fileTypeOf('application/pdf', 'x'), 'PDF');
  assert.equal(fileTypeOf('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Model.xlsx'), 'Spreadsheet');
  assert.equal(fileTypeOf('text/csv; charset=utf-8', 'a.csv'), 'Spreadsheet');
  assert.equal(fileTypeOf('application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'a'), 'Document');
  assert.equal(fileTypeOf('application/vnd.ms-powerpoint', 'a'), 'Slides');
  assert.equal(fileTypeOf('application/zip', 'Pilot contracts.zip'), 'Archive');
  assert.equal(fileTypeOf('application/x-7z-compressed', 'bundle'), 'Archive', 'from the type alone, with no extension');
  assert.equal(fileTypeOf('image/png', 'a'), 'Image');
  assert.equal(fileTypeOf(null, 'Cap table.PDF'), 'PDF', 'the extension when no type is stored');
  assert.equal(fileTypeOf('', 'deck.key'), 'Slides');
  assert.equal(fileTypeOf('application/x-unknown-thing', 'blob.bin'), 'File', 'a stored type with no word');
  assert.equal(fileTypeOf(null, 'no-extension'), 'Not recorded');
  assert.equal(roomListing({ files: [{ uid: 'a', name: 'Model.xlsx', content_type: null }] }).files[0].type, 'Spreadsheet');
});

/* ------------------------------------------------------------------ *
 * Mounted
 * ------------------------------------------------------------------ */

const DATA_ROOM = '/deals/4/data-room';

test('A · not opened: the line, Ask for access, and no room read', async () => {
  const v = await mounted(DATA_ROOM, INVESTOR, handlerWith({ 'room-access(\\?|$)': (u, m) => (m === 'GET' ? response(accessOf({ granted: null })) : null) }));
  try {
    assert.ok(v.has('deal-room-state-not_opened'));
    assert.match(v.textOf('deal-room-state-not_opened'), /^Not opened to youThe founder has not opened the data room to you\.Ask for access$/);
    assert.equal(v.requests.filter((r) => /data-room\/shared/.test(r.line)).length, 0);
  } finally { await v.close(); }
});

test('B · NDA required: the count, Sign NDA, and the withheld files never named', async () => {
  const v = await mounted(DATA_ROOM, INVESTOR);
  try {
    assert.match(v.textOf('deal-room-state-behind_nda'), /^NDA requiredYou have access\. 6 files require an NDA\.Sign NDA$/);
    assert.ok(v.has('deal-room-nda'));
    assert.equal(v.has('deal-room-nda-pending'), false);
  } finally { await v.close(); }
});

test('C · out for signature: Waiting for signatures, its own state, and no second Sign NDA', async () => {
  const v = await mounted(DATA_ROOM, INVESTOR, handlerWith({ 'room-access(\\?|$)': (u, m) => (m === 'GET' ? response(accessOf({ nda: { status: 'out_for_signature' } })) : null) }));
  try {
    assert.ok(v.has('deal-room-state-nda_pending'));
    assert.equal(v.has('deal-room-state-behind_nda'), false);
    assert.match(v.textOf('deal-room-state-nda_pending'), /^Waiting for signaturesWaiting for signatures\.6 files open once every party has signed\.$/);
    assert.equal(v.has('deal-room-nda'), false, 'the NDA is not asked for twice');
    assert.equal(v.has('deal-room-ask'), false);
  } finally { await v.close(); }
});

test('D · open: folders, search, and each file with its type, size, added and Open; no implementation wording', async () => {
  const room = { ...ROOM, withheld_behind_nda: 0, files: [
    { uid: 'a', name: 'Certificate of incorporation.pdf', folder_uid: 'f1', content_type: 'application/pdf', size_bytes: 245760, created_at: '2026-01-14 09:00:00' },
    { uid: 'b', name: 'Financial model v3.xlsx', folder_uid: null, content_type: null, size_bytes: 1258291, created_at: '2026-11-07 09:00:00' },
  ] };
  const v = await mounted(DATA_ROOM, INVESTOR, handlerWith({ 'data-room/shared/harbor': () => response(room) }));
  try {
    assert.match(v.textOf('deal-room-state-open'), /^Open to youYou have access\. No file you can open here needs an NDA\.$/);
    assert.ok(v.has('deal-room-folders'));
    assert.ok(v.has('room-name-filter'));
    const metas = v.byId('deal-room-file-meta').map((n) => v.textOfNode(n));
    assert.deepEqual(metas.sort(), ['PDF · 240 KB · 14 Jan 2026', 'Spreadsheet · 1.2 MB · 7 Nov 2026']);
    assert.equal(v.byId('deal-room-file').length, 2);
    for (const word of ['existing', 'logged', 'listing', 'read', 'Worker']) assert.doesNotMatch(v.textOf('deal-room-files'), new RegExp(`\\b${word}\\b`), `no "${word}" in the room's copy`);
  } finally { await v.close(); }
});

test('E · access unreadable: could not be confirmed, Try again, never Ask for access', async () => {
  const v = await mounted(DATA_ROOM, INVESTOR, handlerWith({ 'room-access(\\?|$)': (u, m) => (m === 'GET' ? response({ error: 'boom' }, 500) : null) }));
  try {
    assert.ok(v.has('deal-room-state-unreadable'));
    assert.match(v.textOf('deal-room-state-unreadable'), /^UnreadableData room access could not be confirmed\.Try againThat is not a claim that the room is closed to you\.$/);
    assert.equal(v.has('deal-room-ask'), false, 'an unreadable state never offers Ask for access');
    assert.equal(v.has('deal-room-nda'), false);
    const asked = v.requests.filter((r) => /GET .*room-access/.test(r.line)).length;
    await v.click('deal-room-retry');
    assert.equal(v.requests.filter((r) => /GET .*room-access/.test(r.line)).length, asked + 1, 'Try again reads the access again');
  } finally { await v.close(); }
});

test('a room that cannot be read after access is confirmed is the room\'s Unreadable, not E', async () => {
  const v = await mounted(DATA_ROOM, INVESTOR, handlerWith({ 'data-room/shared/harbor': () => response({ error: 'boom' }, 500) }));
  try {
    assert.equal(v.has('deal-room-state-unreadable'), false);
    assert.match(v.text(), /The data room could not be read\. That is not a claim that the room is closed to you\./);
    assert.equal(v.has('deal-room-ask'), false);
  } finally { await v.close(); }
});
