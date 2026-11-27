/**
 * D9025 (#9025): Network › People, the shared directory, to the approved NPD canvas (D7676), on stubbed
 * reads of `/api/network/directory`. Synthetic people only.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/network_people_directory_9025.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import {
  NOT_AVAILABLE, SUPPORT_REFUSED, entryFailure, groupAffiliations, overlayFailure, rangeLabel, readListState,
  totalLine, writeListState,
} from '../src/pages/network/directory/directoryModel.js';
import { directoryQuery, networkDirectoryApi } from '../src/lib/api/networkDirectory.js';
import { bucketsFor } from '../src/workspaces/shellConfig.js';

const h = React.createElement;
const src = (p) => readFileSync(new URL(`../src/${p}`, import.meta.url), 'utf8');

/* ------------------------------------------------------------------ the model */

test('the address keeps the search and the cursor trail, and reads a broken trail as page 1', () => {
  const s = writeListState({ q: 'ada', stack: ['eyJu', 'eyJv+/='] });
  assert.equal(s, '?q=ada&c=eyJu.eyJv%2B%2F%3D');
  assert.deepEqual(readListState(s), { q: 'ada', stack: ['eyJu', 'eyJv+/='] });
  assert.equal(writeListState({ q: '  ', stack: [] }), '', 'the bare list has no query');
  assert.deepEqual(readListState('?c=<script>'), { q: '', stack: [] });
});

test('a total is the server’s, and an unknown total never reads 0', () => {
  assert.equal(totalLine({ state: 'loading', total: null, q: '' }), 'Counting…');
  assert.equal(totalLine({ state: 'ready', total: null, q: '' }), 'Counting…');
  assert.match(totalLine({ state: 'error', total: null, q: '' }), /^Unavailable/);
  assert.equal(totalLine({ state: 'ready', total: 2418, q: '' }), '2,418 people in the shared directory');
  assert.equal(totalLine({ state: 'ready', total: 1, q: 'ada' }), '1 person match “ada”');
  assert.equal(rangeLabel(2, 50, 137), '51–100 of 137');
  assert.equal(rangeLabel(3, 37, 137), '101–137 of 137');
});

test('an undated affiliation is status not recorded, never assumed current', () => {
  const g = groupAffiliations([{ current: 'current' }, { current: 'former' }, { current: 'unknown' }, {}]);
  assert.deepEqual([g.current.length, g.former.length, g.unknown.length], [1, 1, 2]);
});

test('a support session’s refusal and a hidden person are said in plain words', () => {
  assert.deepEqual(overlayFailure({ status: 403, code: 'support_session_refused', message: 'raw' }), { kind: 'refused', text: SUPPORT_REFUSED });
  assert.equal(overlayFailure({ status: 403, code: 'forbidden' }).kind, 'unavailable', 'another 403 is not the support session sentence');
  assert.equal(overlayFailure({ status: 500 }, 'write').kind, 'unavailable');
  assert.deepEqual(entryFailure({ status: 404 }), { kind: 'not_available', text: NOT_AVAILABLE });
  assert.equal(entryFailure({ status: 500 }).kind, 'unavailable');
});

/* ------------------------------------------------------------------ the client and the shell */

test('the client calls the mounted routes, by method, with the person id encoded', async () => {
  assert.equal(directoryQuery({ kind: 'person', q: ' ada ', cursor: 'eyJu', limit: 50 }), '?q=ada&kind=person&cursor=eyJu&limit=50');
  assert.equal(directoryQuery({ kind: 'person', q: '' }), '?kind=person');
  const calls = [];
  const restore = installDocument();
  const oldFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => { calls.push([init.method || 'GET', String(url).replace(/^.*\/api/, '/api'), init.body]); return new Response(JSON.stringify({ overlay: null }), { status: 200 }); };
  try {
    await networkDirectoryApi.entry('per/1');
    await networkDirectoryApi.overlay('per-1');
    await networkDirectoryApi.saveOverlay('per-1', { saved: true });
    await networkDirectoryApi.clearOverlay('per-1');
  } finally { globalThis.fetch = oldFetch; restore(); }
  assert.deepEqual(calls, [
    ['GET', '/api/network/directory/entries/per%2F1', undefined],
    ['GET', '/api/network/directory/entries/per-1/overlay', undefined],
    ['PUT', '/api/network/directory/entries/per-1/overlay', '{"saved":true}'],
    ['DELETE', '/api/network/directory/entries/per-1/overlay', undefined],
  ]);
});

test('People is the fifth Network link, after Overview, on every licence that opens Network', () => {
  for (const role of ['founder', 'investor', 'advisor', 'partner']) {
    const network = bucketsFor(role).find((b) => b.prefix === '/network');
    assert.equal(network.zones[0].slug, 'people', role);
    assert.equal(network.zones.length, 4, `${role}: Overview plus four zones`);
  }
  assert.match(src('routes/networkPeople.jsx'), /path="\/network\/people\/:uid"/);
});

/* ------------------------------------------------------------------ the page, mounted */

const PEOPLE = [
  { uid: 'per-1', kind: 'person', name: 'Ada Example', geography: 'Example City', sectors: ['Climate'], stages: [], verification: 'unverified_source_claim', source: { name: 'Synthetic list', observed_at: '2026-11-19T12:00:00Z' } },
  { uid: 'per-2', kind: 'person', name: 'Bo Example', geography: null, sectors: [], stages: [], verification: 'unverified_source_claim', source: { name: 'Synthetic list', observed_at: null } },
];

function harness() {
  const restore = installDocument('', { focus: true });
  const old = { matchMedia: globalThis.matchMedia };
  globalThis.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  document.querySelectorAll = () => [];
  const create = document.createElement.bind(document);
  document.createElement = (tag) => { const n = create(tag); n.querySelector = () => null; n.querySelectorAll = () => []; n.offsetParent = {}; return n; };
  const box = document.createElement('div');
  document.body.appendChild(box);
  const root = createRoot(box);
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const props = (n) => Object.entries(n || {}).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const text = (n) => (n?.childNodes?.length ? n.childNodes.map(text).join('') : n?.textContent || '');
  const button = (label) => walk(box).find((n) => n.tagName === 'BUTTON' && text(n).trim() === label);
  const has = (attr) => walk(box).some((n) => props(n)[attr] !== undefined);
  return {
    box, root, walk, props, text, button, has,
    async done() { await act(async () => root.unmount()); globalThis.matchMedia = old.matchMedia; restore(); },
  };
}

let where = '';
function Where() { const l = useLocation(); where = l.pathname + l.search; return null; }

async function mount(t, api, path = '/network/people') {
  const { default: Page } = await import('../src/pages/network/NetworkPeoplePage.jsx');
  await act(async () => {
    t.root.render(h(MemoryRouter, { key: path, initialEntries: [path] }, h(Routes, null,
      h(Route, { path: '/network/people', element: h(React.Fragment, null, h(Where), h(Page, { api })) }),
      h(Route, { path: '/network/people/:uid', element: h(React.Fragment, null, h(Where), h(Page, { api })) }))));
  });
}

const settle = () => act(async () => { await new Promise((r) => setImmediate(r)); });

test('People shows the server’s total over a page, never a count of rows in hand', async () => {
  const t = harness();
  let release;
  const calls = [];
  const api = { entries: (p) => { calls.push(p); return new Promise((r) => { release = () => r({ entries: PEOPLE, total: 137, next_cursor: 'eyJuZXh0' }); }); } };
  try {
    await mount(t, api);
    assert.match(t.text(t.box), /Counting…/, 'loading reads Counting…');
    assert.doesNotMatch(t.text(t.box), /\b0 people\b/);
    await act(async () => release());
    assert.deepEqual(calls[0], { kind: 'person', q: '', cursor: null, limit: 50 });
    assert.match(t.text(t.box), /137 people in the shared directory/);
    assert.match(t.text(t.box), /1–2 of 137/);
    assert.match(t.text(t.box), /Ada Example/);
    assert.match(t.text(t.box), /Discoverable people 137/);
  } finally { await t.done(); }
});

test('a failed first read is Unavailable with Try again, never an empty directory', async () => {
  const t = harness();
  let fail = true;
  const api = { entries: async () => { if (fail) throw Object.assign(new Error('synthetic'), { status: 500 }); return { entries: PEOPLE, total: 2, next_cursor: null }; } };
  try {
    await mount(t, api);
    await settle();
    assert.ok(t.has('data-people-unreadable'));
    assert.match(t.text(t.box), /People could not be read/);
    assert.doesNotMatch(t.text(t.box), /No people yet|0 people/);
    fail = false;
    await act(async () => t.props(t.button('Try again')).onClick({}));
    await settle();
    assert.match(t.text(t.box), /Bo Example/);
    assert.ok(!t.has('data-people-unreadable'));
  } finally { await t.done(); }
});

test('an empty directory and a search with no match are their own states', async () => {
  const t = harness();
  const api = { entries: async () => ({ entries: [], total: 0, next_cursor: null }) };
  try {
    await mount(t, api);
    await settle();
    assert.ok(t.has('data-people-empty'));
    assert.match(t.text(t.box), /No people yet/);
    await mount(t, api, '/network/people?q=zed');
    await settle();
    assert.ok(t.has('data-people-no-match'));
    assert.match(t.text(t.box), /0 people match “zed”/);
  } finally { await t.done(); }
});

test('Next keeps the search and the trail in the address; a later page that fails keeps page 1 on screen', async () => {
  const t = harness();
  const api = { entries: async ({ cursor }) => { if (cursor) throw Object.assign(new Error('synthetic'), { status: 503 }); return { entries: PEOPLE, total: 137, next_cursor: 'eyJuZXh0' }; } };
  try {
    await mount(t, api, '/network/people?q=ex');
    await settle();
    await act(async () => t.props(t.button('Next ›')).onClick({}));
    await settle();
    assert.equal(where, '/network/people?q=ex&c=eyJuZXh0');
    assert.match(t.text(t.box), /Page 2 could not be read/);
    assert.match(t.text(t.box), /Ada Example/, 'the rows already shown stay');
    assert.match(t.text(t.box), /137 people match “ex”/, 'the total is still known');
    assert.ok(!t.has('data-people-unreadable'), 'not the first-read failure');
  } finally { await t.done(); }
});

const ENTRY = {
  entry: { ...PEOPLE[0] },
  affiliations: [
    { organization: { uid: 'org-1', name: 'Alpha Example Ventures' }, title: 'Partner', relation: 'employment', current: 'current', start_date: null, end_date: null, verification: 'unverified_source_claim', observed_at: '2026-11-19' },
    { organization: { uid: 'org-2', name: 'Beta Example Capital' }, title: 'Principal', relation: 'employment', current: 'unknown', start_date: null, end_date: null, verification: 'unverified_source_claim', observed_at: '2026-11-19' },
  ],
};

test('the Person Sheet reads the person by id, says a sourced profile is not verified, and saves only the viewer’s own record', async () => {
  const t = harness();
  const writes = [];
  const api = {
    entries: async () => ({ entries: PEOPLE, total: 2, next_cursor: null }),
    entry: async (uid) => { assert.equal(uid, 'per-1'); return ENTRY; },
    overlay: async () => ({ overlay: null }),
    saveOverlay: async (uid, body) => { writes.push(['PUT', uid, body]); return { overlay: { saved: true, private_note: null, updated_at: '2026-11-27 10:00:00' } }; },
    clearOverlay: async (uid) => { writes.push(['DELETE', uid]); return { overlay: null }; },
  };
  try {
    await mount(t, api, '/network/people/per-1?q=ex');
    await settle();
    const all = t.text(t.box);
    assert.match(all, /not a verified identity/);
    assert.match(all, /Partner, Alpha Example Ventures/);
    assert.match(all, /Status not recorded/, 'an undated affiliation is not drawn as current');
    assert.match(all, /No private record/);
    await act(async () => t.props(t.button('Save to my relationships')).onClick({}));
    await settle();
    assert.deepEqual(writes, [['PUT', 'per-1', { saved: true }]]);
    assert.match(t.text(t.box), /Nobody was contacted/);
    await act(async () => t.props(t.button('Clear my private record')).onClick({}));
    await settle();
    assert.deepEqual(writes[1], ['DELETE', 'per-1']);
    await act(async () => t.props(t.walk(t.box).find((n) => t.props(n)['data-testid'] === 'person-sheet-close')).onClick({}));
    assert.equal(where, '/network/people?q=ex', 'closing returns to the same list');
  } finally { await t.done(); }
});

test('a support session reads the shared profile but its private area is refused in plain words', async () => {
  const t = harness();
  const api = {
    entries: async () => ({ entries: PEOPLE, total: 2, next_cursor: null }),
    entry: async () => ENTRY,
    overlay: async () => { throw Object.assign(new Error('raw'), { status: 403, code: 'support_session_refused' }); },
  };
  try {
    await mount(t, api, '/network/people/per-1');
    await settle();
    assert.ok(t.has('data-overlay-refused'));
    assert.match(t.text(t.box), /A support session cannot read or change this member’s private relationship/);
    assert.match(t.text(t.box), /not a verified identity/, 'the shared profile still shows');
    assert.equal(t.button('Save to my relationships'), undefined, 'no control to press');
  } finally { await t.done(); }
});

test('an id that is not available reads the same words whatever the reason', async () => {
  const t = harness();
  const api = {
    entries: async () => ({ entries: PEOPLE, total: 2, next_cursor: null }),
    entry: async () => { throw Object.assign(new Error('entry_not_found'), { status: 404 }); },
  };
  try {
    await mount(t, api, '/network/people/per-hidden');
    await settle();
    assert.ok(t.has('data-person-not-available'));
    assert.match(t.text(t.box), /This person is not available to you/);
  } finally { await t.done(); }
});
