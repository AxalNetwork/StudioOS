// D5081 part 4 (#5081, RA-19) — Data room's Home owns its page: no generic Last 90 days card or Files records
// under the tool's blocks; the header's one primary is the module's own (Complete data room, opening Checklist),
// chosen from the room read Home draws and only for a viewer the room's capability map lets upload; Home shows
// the diligence checklist's coverage from D1105's read; first use collapses to one card and its set-up actions.
//
// Run with:
//   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/dataroom_owns_home_d5081.test.mjs
import './_cycleSteps.mjs'; // D4574 (#4574, H5): CycleRoute's lazy steps, loaded before it mounts
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import CycleRoute from '../src/pages/cycles/CycleRoute.jsx';
import { ROOM_CAPS } from './_data_room_capabilities.mjs';
import {
  CHECKLIST_ACTION, COMPLETE_ACTION, UPLOAD_ACTION, checklistNeed, homeAction, isFirstUse, setupActions,
} from '../src/pages/raise/dataroom/dataRoomModel.js';
import { READINESS_WAIT } from '../src/pages/raise/dataroom/checklistModel.js';

const h = React.createElement;
const NOW = Date.parse('2026-11-16T12:00:00Z');
const response = (body, status = 200) => ({ ok: status < 400, status, headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body) });

const ROOM = {
  project: { uid: 'p3uid', name: 'Harbor Ledger' }, role: 'owner', capabilities: ROOM_CAPS.owner,
  folders: [{ id: 1, uid: 'f1', name: 'Financials', parent_id: null, visibility: 'nda', display_order: 0 }],
  files: [{ id: 11, uid: 'a1', name: 'Model.xlsx', folder_id: 1, visibility: 'nda', access_tier: 'invited', access_expires_at: null, downloads: 4, size_bytes: 2048, created_at: '2026-11-10 10:00:00', checklist_item: 'financial_model' }],
  grants: [], report_shares: [], recent_access: [], week: { opened: 0, downloaded: 0, blocked: 0 },
};
const EMPTY_ROOM = { ...ROOM, folders: [], files: [] };
const CHECKLIST = {
  grants_in_force: 0, totals: { items: 12, answered: 2, openable: 1 },
  items: [
    { key: 'financial_model', area: 'Financials', label: 'Financial model', state: 'open', files: [] },
    { key: 'cap_table', area: 'Legal', label: 'Cap table', state: 'no_one_can_open', reason: 'No grant opens it', files: [] },
    { key: 'contracts', area: 'Commercial', label: 'Customer contracts', state: 'no_file', files: [] },
    { key: 'ip', area: 'Legal', label: 'IP assignments', state: 'no_file', files: [] },
  ],
};
// The generic layer's module read: a card and a records table a non-owned page would draw.
const MODULE = {
  module: { slug: 'data-room', name: 'Data room', records_title: 'Files' },
  card: { slug: 'data-room', name: 'Data room', state: 'ok', series: [{ kind: 'rows', items: [{ label: 'Opens in the last 90 days', value: 0 }] }], next: null, reason: null, caption: 'GENERIC-CARD' },
  records: { cols: [{ key: 'file', label: 'File' }], rows: [{ id: 11, cells: { file: 'GENERIC-ROW' } }], total: 1, page: 1, page_size: 25, add: { text: 'Upload', href: '/raise/data-room/new' } },
};
const ready = (room) => ({ status: 'ready', room, uid: 'p3uid', projectId: 3 });

/* ------------------------------------------------------------------ *
 * The model
 * ------------------------------------------------------------------ */

test('first use is a read room with no file and no folder; a room not read, refused or a summary is never first use', () => {
  // Mutation checked: `roomRead` dropped → a failed read claims an empty room; the folders check dropped → a room of empty folders collapses.
  assert.equal(isFirstUse(ready(EMPTY_ROOM)), true);
  assert.equal(isFirstUse(ready(ROOM)), false);
  assert.equal(isFirstUse(ready({ ...EMPTY_ROOM, folders: ROOM.folders })), false, 'a folder is set-up already done');
  for (const status of ['loading', 'error', 'refused']) assert.equal(isFirstUse({ status, room: EMPTY_ROOM }), false, status);
  assert.equal(isFirstUse(ready({ mode: 'summary', files: [] })), false, 'an admin\'s summary is not the room');
  assert.equal(isFirstUse(ready({ ...EMPTY_ROOM, files: undefined })), false, 'a room without a file list is not empty');
});

test('the header\'s primary is Complete data room, opening Checklist with the venture, for a viewer who can upload', () => {
  // Mutation checked: the upload check dropped → a support reader gets the action; the Checklist exclusion dropped → it points at itself.
  assert.deepEqual(homeAction(ready(ROOM), { search: '?project_id=3&x=1' }), { label: COMPLETE_ACTION, href: '/raise/data-room/checklist?project_id=3' });
  assert.deepEqual(homeAction(ready({ ...ROOM, role: 'cofounder', capabilities: ROOM_CAPS.cofounder }), { search: '?project_id=3' })?.label, COMPLETE_ACTION);
  assert.equal(homeAction(ready(ROOM), { search: '?project_id=3', tab: 'checklist' }), null, 'none on Checklist, where it leads');
  assert.deepEqual(homeAction(ready(ROOM), { search: '?project_id=3', tab: 'files' })?.label, COMPLETE_ACTION);
  assert.equal(homeAction(ready(EMPTY_ROOM)), null, 'first use: the empty card carries the page\'s one primary (D5076)');
  assert.equal(homeAction(ready({ ...ROOM, capabilities: ROOM_CAPS.support })), null, 'a reader is given none');
  assert.equal(homeAction(ready({ ...ROOM, capabilities: undefined })), null, 'no capability map allows nothing');
  assert.equal(homeAction(ready({ mode: 'summary', capabilities: ROOM_CAPS.summary })), null);
  for (const status of ['loading', 'error', 'refused']) assert.equal(homeAction({ status, room: ROOM }), null, status);
});

test('first use offers Upload files and the checklist, the first the page\'s primary; none for a reader', () => {
  const owner = setupActions(ready(EMPTY_ROOM), { search: '?project_id=3' });
  assert.deepEqual(owner.map((a) => a.label), [UPLOAD_ACTION, CHECKLIST_ACTION]);
  assert.deepEqual(owner.map((a) => a.href), ['/raise/data-room/new?project_id=3', '/raise/data-room/checklist?project_id=3']);
  assert.ok(owner.length <= 3);
  assert.deepEqual(setupActions(ready({ ...EMPTY_ROOM, capabilities: ROOM_CAPS.support })), []);
  assert.deepEqual(setupActions(ready(ROOM)), [], 'not first use');
  assert.deepEqual(setupActions({ status: 'error', room: null }), []);
});

test('the checklist block: answered of items, the missing named, answered items no one can open; a read without totals is unreadable', () => {
  // Mutation checked: missing totals read as 0 of 0 → "0 of 0" drawn for a read that said nothing.
  const need = checklistNeed(CHECKLIST);
  assert.equal(need.figure, '2 of 12');
  assert.equal(need.missing, 'Missing: Customer contracts · IP assignments');
  assert.equal(need.shut, '1 answered item no investor can open yet');
  assert.equal(checklistNeed({ ...CHECKLIST, items: CHECKLIST.items.filter((i) => i.state !== 'no_file') }).missing, 'Every checklist item has a file.');
  for (const bad of [{}, null, { items: [] }, { totals: { items: 12, answered: 2 } }, { totals: { items: '12', answered: 2 }, items: [] }]) {
    assert.deepEqual(checklistNeed(bad), { state: 'unreadable' }, JSON.stringify(bad));
  }
});

test('no implementation-stage words: the readiness card names Fundraising readiness and links there', () => {
  assert.doesNotMatch(READINESS_WAIT, /not read here yet|not carried/i);
  assert.match(READINESS_WAIT, /Fundraising readiness/);
});

/* ------------------------------------------------------------------ *
 * The page
 * ------------------------------------------------------------------ */

function handlerFor(o = {}) {
  const at = { room: ROOM, checklist: CHECKLIST, ...o };
  const send = (v) => (typeof v === 'number' ? response({ detail: 'x' }, v) : response(v));
  return (url) => {
    if (/\/api\/projects(\?|$)/.test(url)) return response([{ id: 3, uid: 'p3uid', name: 'Harbor Ledger' }]);
    if (/\/data-room\/p3uid\/checklist/.test(url)) return send(at.checklist);
    if (/\/data-room\/p3uid\/requests$/.test(url)) return response({ requests: [], open: 0, can_answer: true });
    if (/\/data-room\/p3uid\/proposals/.test(url)) return response({ proposals: [] });
    if (/\/data-room\/p3uid(\?|$)/.test(url)) return send(at.room);
    if (url.includes('/cycles/raise/modules/')) return response(MODULE);
    return response({});
  };
}

async function mounted(url, o = {}) {
  const restore = installDocument();
  const previous = { fetch: globalThis.fetch, matchMedia: globalThis.matchMedia, now: Date.now };
  const requests = [];
  const handle = handlerFor(o);
  globalThis.fetch = async (u) => { requests.push(String(u)); return handle(String(u)); };
  globalThis.matchMedia = () => ({ matches: !!o.phone, addEventListener() {}, removeEventListener() {} });
  Date.now = () => NOW;
  const create = document.createElement.bind(document);
  document.createElement = (tag) => { const node = create(tag); node.querySelector = () => null; node.querySelectorAll = () => []; node.focus = () => {}; node.children = []; return node; };
  document.body.style = { overflow: 'auto', paddingRight: '' };
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => root.render(h(MemoryRouter, { initialEntries: [url] }, h(Routes, null,
    h(Route, { path: '/raise/:slug', element: h(CycleRoute, { cycle: 'raise' }) }),
    h(Route, { path: '/raise/:slug/:id', element: h(CycleRoute, { cycle: 'raise', record: true }) }),
  ))));
  const flush = () => act(async () => { for (let i = 0; i < 10; i += 1) await new Promise((r) => setImmediate(r)); });
  await flush();
  const nodes = () => { const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)]; return walk(container); };
  const text = (n) => (n?.nodeType === 3 ? n.textContent : n?.childNodes?.length ? n.childNodes.map(text).join(' ') : n?.textContent || '');
  const props = (n) => Object.entries(n).find(([key]) => key.startsWith('__reactProps$'))?.[1] || {};
  const all = (id) => nodes().filter((n) => props(n)['data-testid'] === id);
  return {
    requests, props, all, by: (id) => all(id)[0],
    text: (n = container) => text(n).replace(/\s+/g, ' '),
    async close() { await act(async () => root.unmount()); Object.assign(globalThis, { fetch: previous.fetch, matchMedia: previous.matchMedia }); Date.now = previous.now; restore(); },
  };
}

const roomReads = (v) => v.requests.filter((u) => /\/data-room\/p3uid(\?|$)/.test(u)).length;

test('Home owns the page: the tool\'s blocks, no generic card or Files records, and Complete data room in the header', async () => {
  // Mutation checked: `owned` not passed for Data room → GENERIC-CARD and GENERIC-ROW drawn; `onAction` not wired → the header shows nothing.
  const v = await mounted('/raise/data-room?project_id=3');
  try {
    assert.ok(v.by('dataroom-home') && v.by('cycle-module'));
    assert.doesNotMatch(v.text(), /GENERIC-CARD|GENERIC-ROW|· at a glance/, 'nothing generic under the tool');
    assert.equal(v.all('records-add').length, 0);
    const actions = v.all('cycle-action');
    assert.equal(actions.length, 1);
    assert.equal(v.text(actions[0]), COMPLETE_ACTION);
    assert.equal(v.props(actions[0]).href, '/raise/data-room/checklist?project_id=3');
    assert.doesNotMatch(v.text(), /Build your deck/);
    assert.match(v.text(v.by('dataroom-coverage')), /2 of 12 checklist items have a file.*Missing: Customer contracts · IP assignments.*1 answered item no investor can open yet/);
    assert.equal(roomReads(v), 1, 'one room read for Home and the header');
    assert.ok(!v.by('dataroom-home-action'), 'a desktop draws the action once, in the header');
  } finally { await v.close(); }
});

test('a failed checklist read blanks only its block; the rest of Home stands', async () => {
  const v = await mounted('/raise/data-room?project_id=3', { checklist: 500 });
  try {
    assert.ok(v.by('dataroom-coverage-unreadable'));
    assert.ok(v.by('dataroom-needs') && v.by('dataroom-who'));
    assert.equal(v.text(v.by('cycle-action')), COMPLETE_ACTION);
  } finally { await v.close(); }
});

test('first use is one card with its set-up actions and no header action; a reader gets a sentence and nothing to press', async () => {
  const v = await mounted('/raise/data-room?project_id=3', { room: EMPTY_ROOM });
  try {
    assert.ok(v.by('dataroom-first-use') && !v.by('dataroom-home'), 'no tiles, lists or checklist block');
    assert.deepEqual(['dataroom-setup-upload', 'dataroom-setup-checklist'].map((id) => v.props(v.by(id)).href), ['/raise/data-room/new?project_id=3', '/raise/data-room/checklist?project_id=3']);
    assert.equal(v.all('cycle-action').length, 0, 'the empty card carries the page\'s one primary');
    assert.doesNotMatch(v.text(), /GENERIC-CARD|GENERIC-ROW/);
  } finally { await v.close(); }
  const r = await mounted('/raise/data-room?project_id=3', { room: { ...EMPTY_ROOM, role: 'support', capabilities: ROOM_CAPS.support } });
  try {
    assert.match(r.text(r.by('dataroom-first-use')), /The venture’s owner uploads its files/);
    assert.ok(!r.by('dataroom-first-use-actions') && r.all('cycle-action').length === 0);
  } finally { await r.close(); }
});

test('a failed or refused room read draws no action and no first use', async () => {
  for (const room of [500, 403]) {
    const v = await mounted('/raise/data-room?project_id=3', { room });
    try {
      assert.equal(v.all('cycle-action').length, 0, String(room));
      assert.ok(!v.by('dataroom-first-use'), String(room));
    } finally { await v.close(); }
  }
});

test('the tool\'s tabs carry Complete data room in place of Build your deck, except Checklist itself', async () => {
  const f = await mounted('/raise/data-room/files?project_id=3');
  try {
    assert.equal(f.text(f.by('cycle-action')), COMPLETE_ACTION);
    assert.doesNotMatch(f.text(), /Build your deck/);
  } finally { await f.close(); }
  const c = await mounted('/raise/data-room/checklist?project_id=3');
  try {
    assert.equal(c.all('cycle-action').length, 0, 'none where it leads');
    assert.doesNotMatch(c.text(), /Build your deck|Not read here yet/);
  } finally { await c.close(); }
});

test('on a phone the bar carries no action, so Home draws Complete data room full width', async () => {
  const v = await mounted('/raise/data-room?project_id=3', { phone: true });
  try {
    assert.equal(v.props(v.by('phone-module'))['data-owned'], 'true');
    assert.equal(v.text(v.by('dataroom-home-action')), COMPLETE_ACTION);
    // Mutation checked: the bar's sub back to the card's caption → GENERIC-CARD in the bar.
    assert.doesNotMatch(v.text(), /GENERIC-CARD|GENERIC-ROW/, 'the bar says the tool\'s line, not the dropped card\'s caption');
    assert.match(v.text(), /Your diligence files, who can open them, and what they have opened\./);
  } finally { await v.close(); }
});

test('the wiring: no new import specifier in CycleRoute, the decision is its own part file, the route-map row says so', () => {
  const route = readFileSync('frontend/src/pages/cycles/CycleRoute.jsx', 'utf8');
  assert.match(route, /^import \{ LINE as DATA_ROOM_LINE, isDataRoomTab, isOldFileAddress, SLUG as DATA_ROOM \} from '\.\.\/raise\/dataroom\/dataRoomModel';$/m);
  assert.match(route, /dataRoomOwnsHome \? \{ sub: DATA_ROOM_LINE \}/);
  assert.doesNotMatch(route, /<DataRoomTabPage[^>]*action=\{action\}/, 'a tab draws its own action');
  const doc = readFileSync('documentation/architecture/decisions/D5081-p4.md', 'utf8');
  assert.match(doc, /^## D5081 part 4 — Raise tools own their pages: Data room \(#5081\)$/m);
});
