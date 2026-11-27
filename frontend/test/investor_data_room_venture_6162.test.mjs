/**
 * D6162 (#6162): an investor's `/raise/data-room` link keeps its venture.
 *
 *   · the investor arm of `/raise/data-room` redirects to `/research/diligence`
 *     with the query and the hash kept; the founder and admin arms are unchanged;
 *   · the rooms list reads the venture the address names (`?project_id=N`, or
 *     the legacy `?project=` forms, by the shared `ventureRef`): one live grant
 *     for it opens that room, several are each marked, none says "No room is
 *     open to you for this venture", and a failed read says nothing about it;
 *   · the investor's Deals row no longer claims `/raise/data-room`.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/investor_data_room_venture_6162.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter, Navigate, Routes, Route, useLocation } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import { routeBlock } from './_routes.mjs';
import DiligenceZone, { DiligenceBody } from '../src/pages/research/DiligenceZone.jsx';
import { NO_VENTURE_ROOM, ROOMS_PATH, roomTarget, ventureRooms } from '../src/pages/research/diligenceZoneRead.js';
import { SIDEBAR_GROUPS } from '../src/sidebarConfig.js';

const h = React.createElement;
const APP = readFileSync('frontend/src/App.jsx', 'utf8');
const NOW = Date.parse('2026-11-14T12:00:00Z');
const response = (body, status = 200) => ({ ok: status < 400, status, headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body) });

const room = (grant_uid, project_id, project_uid, project_name) => ({
  grant_uid, project_id, project_uid, project_name, file_open: 2, file_total: 3, withheld_behind_nda: 1,
  nda: { status: 'none', valid_until: null }, deals: [], deal_stage_note: 'No deal you are invited to is recorded for this company.',
  created_at: '2026-11-02 09:00:00', last_opened_at: null, expires_at: null,
});
const KELP = room('g-kelp', 7, 'p-kelp', 'Kelp');
const HARBOR = room('g-harbor', 9, 'p-harbor', 'Harbor');
const KELP_AGAIN = room('g-kelp-2', 7, 'p-kelp', 'Kelp');
const data = (items) => ({ items, requests: [], requests_unreadable: false, granted_count: items.length, partial_count: items.length });

/* ------------------------------------------------------------------ *
 * The match
 * ------------------------------------------------------------------ */

test('ventureRooms: a number matches project_id, a UID matches project_uid, the legacy key too', () => {
  const d = data([KELP, HARBOR]);
  const uids = (search) => ventureRooms(d, search).rooms.map((r) => r.grant_uid);
  assert.deepEqual([ventureRooms(d, '?project_id=7').state, uids('?project_id=7')], ['one', ['g-kelp']]);
  assert.deepEqual([ventureRooms(d, '?project=9').state, uids('?project=9')], ['one', ['g-harbor']], 'the legacy ?project=N');
  assert.deepEqual([ventureRooms(d, '?project=p-kelp').state, uids('?project=p-kelp')], ['one', ['g-kelp']], 'a project UID');
  assert.deepEqual([ventureRooms(d, '?tab=files&project_id=9').state, uids('?tab=files&project_id=9')], ['one', ['g-harbor']], 'another key beside it');
});

test('ventureRooms: none when every room was compared, many for two grants, unnamed with no venture', () => {
  assert.deepEqual(ventureRooms(data([KELP, HARBOR]), '?project_id=8'), { state: 'none', rooms: [] });
  assert.deepEqual(ventureRooms(data([]), '?project_id=8'), { state: 'none', rooms: [] }, 'no room at all is none for this venture too');
  const many = ventureRooms(data([KELP, HARBOR, KELP_AGAIN]), '?project_id=7');
  assert.deepEqual([many.state, many.rooms.map((r) => r.grant_uid)], ['many', ['g-kelp', 'g-kelp-2']]);
  assert.equal(ventureRooms(data([KELP]), '').state, 'unnamed');
  assert.equal(ventureRooms(data([KELP]), '?tab=files').state, 'unnamed');
});

test('ventureRooms: a room without the key the address used makes a miss unknown, never none', () => {
  const { project_id: _drop, ...noId } = HARBOR;
  assert.equal(ventureRooms(data([KELP, noId]), '?project_id=8').state, 'unknown', 'an older read without project_id is no claim');
  assert.equal(ventureRooms(data([KELP, noId]), '?project_id=7').state, 'one', 'a room that does carry it still matches');
  const { project_uid: _uid, ...noUid } = HARBOR;
  assert.equal(ventureRooms(data([KELP, noUid]), '?project=p-none').state, 'unknown');
});

test('roomTarget: the room by its grant, the query and the hash carried on', () => {
  assert.equal(ROOMS_PATH, '/research/diligence');
  assert.deepEqual(roomTarget('g/1', { search: '?project_id=7', hash: '#notes' }), { pathname: '/research/diligence/g%2F1', search: '?project_id=7', hash: '#notes' });
  assert.deepEqual(roomTarget('g1', null), { pathname: '/research/diligence/g1', search: '', hash: '' });
});

/* ------------------------------------------------------------------ *
 * The route
 * ------------------------------------------------------------------ */

// The investor arm's target, read from App.jsx itself, so the mounted tests below run App's own expression.
const INVESTOR_ARM = /effectiveRole === 'investor' && !holds\('founder'\)\s*\?\s*<Navigate to=\{(\{[^}]*\})\} replace \/>/;

test("App: /raise/data-room's investor arm keeps the query and hash; the founder and admin arms are unchanged", () => {
  const block = routeBlock(APP, '/raise/data-room');
  assert.match(block, /guard\(\['admin', 'founder', 'investor'\],/);
  const arm = INVESTOR_ARM.exec(block);
  assert.ok(arm, 'the investor arm is the first arm, a Navigate');
  assert.equal(arm[1], "{ pathname: '/research/diligence', search: location.search, hash: location.hash }");
  assert.doesNotMatch(block, /<Navigate to="\/research\/diligence" replace \/>/, 'the bare redirect that dropped the query and hash');
  const at = (re) => { const m = block.match(re); assert.ok(m, String(re)); return m.index; };
  const investor = at(INVESTOR_ARM);
  const moved = at(/movedKind\(location\.search\)\s*\?\s*<DataRoomMovedRedirect kind=\{movedKind\(location\.search\)\} \/>/);
  const module = at(/:\s*<CycleRoute cycle="raise" slug="data-room" \/>\)\}/);
  assert.ok(investor < moved && moved < module, 'the arms run investor, forwards, module');
});

const armTo = new Function('location', `return (${INVESTOR_ARM.exec(routeBlock(APP, '/raise/data-room'))[1]});`);
function InvestorArm() { const location = useLocation(); return h(Navigate, { to: armTo(location), replace: true }); }
function Where() { const l = useLocation(); return h('i', { 'data-testid': 'where' }, `${l.pathname}${l.search}${l.hash}`); }

async function mount(url, read) {
  const previous = { fetch: globalThis.fetch, matchMedia: globalThis.matchMedia };
  const requests = [];
  globalThis.fetch = async (u) => { requests.push(String(u)); return read(String(u)); };
  globalThis.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  const restore = installDocument();
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(h(MemoryRouter, { initialEntries: [url] },
      h(Routes, null,
        h(Route, { path: '/raise/data-room', element: h(InvestorArm) }),
        h(Route, { path: '/research/diligence', element: h(DiligenceZone, { role: 'investor', now: NOW }) }),
        h(Route, { path: '/research/diligence/:grantUid', element: h('b', { 'data-testid': 'the-room' }, 'room') }),
      ),
      h(Where)));
  });
  // Settle the list read and the room redirect: event-loop turns, no clock (check-test-clock, D5614).
  await act(async () => { for (let i = 0; i < 8; i += 1) await new Promise((r) => setImmediate(r)); });
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const pr = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const by = (id) => walk(container).filter((n) => pr(n)['data-testid'] === id);
  const txt = (n) => (!n ? '' : n.nodeType === 3 ? n.textContent || '' : n.childNodes?.length ? n.childNodes.map(txt).join('') : n.textContent || '');
  return {
    requests,
    where: () => txt(by('where')[0]),
    text: () => txt(container),
    all: by,
    async unmount() { await act(async () => root.unmount()); restore(); Object.assign(globalThis, previous); },
  };
}
const serve = (body, status = 200) => (u) => (u.includes('/research/diligence') ? response(body, status) : response({}));

test('mounted: /raise/data-room?project_id=N with one grant for it lands on that room, the query and hash kept', async () => {
  const m = await mount('/raise/data-room?project_id=7&tab=files#notes', serve(data([HARBOR, KELP])));
  try {
    assert.equal(m.where(), '/research/diligence/g-kelp?project_id=7&tab=files#notes');
    assert.equal(m.all('the-room').length, 1);
    assert.ok(m.requests.some((u) => /\/api\/research\/diligence$/.test(u)), 'the room is found on the list read');
  } finally { await m.unmount(); }
});

test('mounted: a venture no live grant is for stays on the list and says no room is open for it', async () => {
  const m = await mount('/raise/data-room?project_id=8#notes', serve(data([HARBOR, KELP])));
  try {
    assert.equal(m.where(), '/research/diligence?project_id=8#notes', 'the query and hash survive the redirect');
    assert.equal(m.all('venture-no-room').length, 1);
    assert.match(m.text(), /No room is open to you for this venture\. Only its founder can open one/);
    assert.equal(m.all('room-row').length, 2, 'the list is still the rooms that are open to you');
  } finally { await m.unmount(); }
});

test('mounted: two grants for the venture stay on the list, each marked; no venture leaves the list as it was', async () => {
  const two = await mount('/raise/data-room?project_id=7', serve(data([KELP, HARBOR, KELP_AGAIN])));
  try {
    assert.equal(two.where(), '/research/diligence?project_id=7');
    assert.match(two.text(), /2 rooms are open to you for this venture\. Each is marked below\./);
    assert.equal(two.all('room-venture-mark').length, 2);
    assert.equal(two.all('room-row').filter((n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1]?.['data-venture'] === 'match').length, 2);
  } finally { await two.unmount(); }
  const plain = await mount('/raise/data-room#top', serve(data([KELP])));
  try {
    assert.equal(plain.where(), '/research/diligence#top');
    assert.deepEqual([plain.all('venture-no-room').length, plain.all('venture-rooms').length, plain.all('venture-opening').length], [0, 0, 0]);
  } finally { await plain.unmount(); }
});

test('mounted: a failed rooms read says Unavailable and nothing about the venture', async () => {
  const m = await mount('/raise/data-room?project_id=8', serve({ detail: 'down' }, 500));
  try {
    assert.equal(m.where(), '/research/diligence?project_id=8');
    assert.equal(m.all('rooms-unavailable').length, 1);
    assert.equal(m.all('venture-no-room').length, 0, 'a failed read is never "no room"');
  } finally { await m.unmount(); }
});

test('DiligenceBody: an unknown match draws no venture line', () => {
  const { project_id: _drop, ...noId } = HARBOR;
  const d = data([KELP, noId]);
  const out = renderToStaticMarkup(h(MemoryRouter, null, h(DiligenceBody, { now: NOW, filter: 'all', onRetry: () => {}, data: d, venture: ventureRooms(d, '?project_id=8') })));
  assert.doesNotMatch(out, /venture-no-room|venture-rooms|venture-opening|room-venture-mark/);
  assert.ok(!out.includes(NO_VENTURE_ROOM));
});

/* ------------------------------------------------------------------ *
 * The sidebar
 * ------------------------------------------------------------------ */

test("the investor's Deals row no longer claims /raise/data-room; the list it lands on lights Research", () => {
  const rows = SIDEBAR_GROUPS.investor.flatMap((g) => g.items);
  const deals = rows.find((r) => r.label === 'Deals');
  assert.ok(deals && Array.isArray(deals.match), 'the Deals row has its match');
  assert.ok(!deals.match.includes('/raise/data-room'), 'an investor never stays on /raise/data-room');
  // SidebarNav's rule: a row with `match` lights for its own `to` or anything under a match entry; one without, for its `to` only.
  const lit = (path) => rows.filter((r) => (Array.isArray(r.match)
    ? path === r.to || r.match.some((p) => path === p || path.startsWith(`${p}/`))
    : path === r.to)).map((r) => r.label);
  assert.deepEqual(lit('/research/diligence'), ['Research']);
  assert.deepEqual(lit('/raise/data-room'), []);
});
