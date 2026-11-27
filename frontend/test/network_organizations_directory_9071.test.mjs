/**
 * D9071 (#9071): Network › Organizations, people first, to the approved canvas (D7680), on stubbed reads of
 * `/api/network/directory`. Synthetic organizations and people only.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/network_organizations_directory_9071.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import { TYPE_NOT_RECORDED, filterPeople, peopleAt, peopleLine } from '../src/pages/network/directory/orgModel.js';
import { networkDirectoryApi } from '../src/lib/api/networkDirectory.js';

const h = React.createElement;
const src = (p) => readFileSync(new URL(`../src/${p}`, import.meta.url), 'utf8');

/* ------------------------------------------------------------------ the model */

test('a people count is the Worker’s, and an unknown is never 0', () => {
  assert.deepEqual(peopleLine(undefined), { state: 'loading', text: 'Counting…' });
  assert.equal(peopleLine(null).state, 'unavailable');
  assert.deepEqual(peopleLine({ people: 0, current: 0, former: 0, unknown: 0 }), { state: 'none', text: '○ No people recorded' });
  assert.equal(peopleLine({ people: 4, current: 2, former: 1, unknown: 1 }).text, '4 people · 2 current · 1 former · 1 status not recorded');
  assert.equal(peopleLine({ people: 1, current: 1, former: 0, unknown: 0 }).text, '1 person · 1 current');
});

test('one row per person, current over former over not recorded, as the Worker counts', () => {
  const rows = peopleAt([
    { person: { uid: 'p2', name: 'Bo' }, current: 'former' },
    { person: { uid: 'p2', name: 'Bo' }, current: 'current' },
    { person: { uid: 'p1', name: 'Ada' }, current: 'unknown' },
    { person: { uid: 'p3', name: 'Cy' }, current: 'former' },
  ]);
  assert.deepEqual(rows.map((r) => [r.person.uid, r.current]), [['p1', 'unknown'], ['p2', 'current'], ['p3', 'former']]);
  assert.deepEqual(filterPeople(rows, 'former').map((r) => r.person.uid), ['p3']);
  assert.equal(filterPeople(rows, 'all').length, 3);
});

test('the client asks for counts on the mounted route, the list encoded', async () => {
  const restore = installDocument();
  const old = globalThis.fetch;
  const seen = [];
  globalThis.fetch = async (url, init) => { seen.push([init.method || 'GET', String(url).replace(/^.*\/api/, '/api')]); return new Response('{"counts":{}}', { status: 200 }); };
  try { await networkDirectoryApi.peopleCounts(['org-1', 'org 2']); } finally { globalThis.fetch = old; restore(); }
  assert.deepEqual(seen, [['GET', '/api/network/directory/organizations/people-counts?uids=org-1%2Corg%202']]);
});

test('the zone opens on the shared directory; ?scope=mine keeps each licence’s own body', () => {
  const ws = src('workspaces/NetworkWorkspace.jsx');
  assert.match(ws, /get\('scope'\) === 'mine' \? 'mine' : 'shared'/);
  assert.match(ws, /if \(slug === 'organizations' && orgScope === 'shared'\) \{\s*return <Suspense fallback=\{<Loading \/>\}><NetworkOrganizationsDirectory \/>/);
  assert.match(src('routes/networkOrganizations.jsx'), /path="\/network\/organizations\/:uid\/people\/:personUid"/);
});

test('no organization page calls an organization a fund', () => {
  for (const f of ['pages/network/NetworkOrganizationsDirectory.jsx', 'pages/network/NetworkOrganizationPage.jsx']) {
    const code = src(f).replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, '');
    assert.doesNotMatch(code, /Fund vehicle|fund manager|Managed fund|Vintage/i, f);
  }
});

/* ------------------------------------------------------------------ mounted */

const O = (uid, name) => ({ uid, kind: 'organization', name, website: null, geography: 'Example City', sectors: ['Climate'], stages: ['Seed'], verification: 'unverified_source_claim', source: { name: 'Synthetic list', observed_at: '2026-11-19T12:00:00Z' } });
const ORGS = [O('org-1', 'Alpha Example Ventures'), O('org-2', 'Beta Example Capital')];

function harness() {
  const restore = installDocument('', { focus: true });
  const old = globalThis.matchMedia;
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
  const attr = (name) => walk(box).filter((n) => props(n)[name] !== undefined).map((n) => props(n)[name]);
  const button = (label) => walk(box).find((n) => n.tagName === 'BUTTON' && text(n).trim() === label);
  return { box, root, walk, props, text, attr, button, async done() { await act(async () => root.unmount()); globalThis.matchMedia = old; restore(); } };
}

let where = '';
function Where() { const l = useLocation(); where = l.pathname + l.search; return null; }
const settle = () => act(async () => { await new Promise((r) => setImmediate(r)); });

async function mountList(t, api, path = '/network/organizations') {
  const { default: Page } = await import('../src/pages/network/NetworkOrganizationsDirectory.jsx');
  await act(async () => { t.root.render(h(MemoryRouter, { key: path, initialEntries: [path] }, h(Routes, null, h(Route, { path: '/network/organizations', element: h(React.Fragment, null, h(Where), h(Page, { api })) })))); });
}
async function mountOrg(t, api, path) {
  const { default: Page } = await import('../src/pages/network/NetworkOrganizationPage.jsx');
  const el = h(React.Fragment, null, h(Where), h(Page, { api }));
  await act(async () => { t.root.render(h(MemoryRouter, { key: path, initialEntries: [path] }, h(Routes, null,
    h(Route, { path: '/network/organizations/:uid', element: el }),
    h(Route, { path: '/network/organizations/:uid/people/:personUid', element: el })))); });
}

test('the directory lists organizations with the Worker’s total and its distinct-person counts', async () => {
  const t = harness();
  let release;
  const asked = [];
  const api = {
    entries: async (p) => { asked.push(p); return { entries: ORGS, total: 1284, next_cursor: null }; },
    peopleCounts: (uids) => { asked.push(uids); return new Promise((r) => { release = () => r({ counts: { 'org-1': { people: 3, current: 2, former: 1, unknown: 0 } } }); }); },
  };
  try {
    await mountList(t, api);
    await settle();
    assert.deepEqual(asked[0], { kind: 'organization', q: '', cursor: null, limit: 50 });
    assert.deepEqual(asked[1], ['org-1', 'org-2']);
    assert.match(t.text(t.box), /1,284 organizations in the shared directory/);
    assert.deepEqual(t.attr('data-people-count'), ['loading', 'loading'], 'Counting… until the counts answer');
    await act(async () => release());
    assert.match(t.text(t.box), /3 people · 2 current · 1 former/);
    assert.deepEqual(t.attr('data-people-count'), [3, 'unavailable'], 'an organization the Worker left out is not 0');
    assert.match(t.text(t.box), new RegExp(TYPE_NOT_RECORDED));
  } finally { await t.done(); }
});

test('counts that fail to load read Unavailable with Count again; the organizations stay', async () => {
  const t = harness();
  let fail = true;
  const api = {
    entries: async () => ({ entries: ORGS, total: 2, next_cursor: null }),
    peopleCounts: async () => { if (fail) throw Object.assign(new Error('synthetic'), { status: 503 }); return { counts: { 'org-1': { people: 0, current: 0, former: 0, unknown: 0 }, 'org-2': { people: 1, current: 1, former: 0, unknown: 0 } } }; },
  };
  try {
    await mountList(t, api);
    await settle();
    assert.ok(t.attr('data-counts-unreadable').length);
    assert.match(t.text(t.box), /Alpha Example Ventures/);
    assert.doesNotMatch(t.text(t.box), /No people recorded/);
    fail = false;
    await act(async () => t.props(t.button('Count again')).onClick({}));
    await settle();
    assert.match(t.text(t.box), /○ No people recorded/);
    assert.match(t.text(t.box), /1 person · 1 current/);
  } finally { await t.done(); }
});

const ORG_ENTRY = {
  entry: ORGS[0],
  affiliations: [
    { person: { uid: 'p-1', name: 'Ada Example' }, title: 'Partner', current: 'current', start_date: null, end_date: null, verification: 'unverified_source_claim', observed_at: '2026-11-12' },
    { person: { uid: 'p-2', name: 'Bo Example' }, title: 'Principal', current: 'former', start_date: '2019-01', end_date: '2024-06', verification: 'unverified_source_claim', observed_at: '2026-09-30' },
    { person: { uid: 'p-3', name: 'Cy Example' }, title: null, current: 'unknown', start_date: null, end_date: null, verification: 'unverified_source_claim', observed_at: '2026-09-30' },
  ],
};

test('an organization opens on its people, grouped by status, and opens a person with the organization as context', async () => {
  const t = harness();
  const api = {
    entry: async (uid) => (uid === 'org-1' ? ORG_ENTRY : { entry: { uid, kind: 'person', name: 'Ada Example', sectors: [], stages: [], verification: 'unverified_source_claim', source: {} }, affiliations: [] }),
    peopleCounts: async () => ({ counts: { 'org-1': { people: 3, current: 1, former: 1, unknown: 1 } } }),
    overlay: async () => ({ overlay: null }),
  };
  try {
    await mountOrg(t, api, '/network/organizations/org-1?q=alpha');
    await settle();
    const all = t.text(t.box);
    assert.match(all, /3 people · 1 current · 1 former · 1 status not recorded/);
    assert.match(all, /2019-01–2024-06/);
    assert.match(all, /Type not recorded/);
    assert.ok(t.button('● Current · 1') && t.button('○ Former · 1') && t.button('? Status not recorded · 1'));
    await act(async () => t.props(t.button('○ Former · 1')).onClick({}));
    assert.doesNotMatch(t.text(t.box), /Ada Example/);
    assert.match(t.text(t.box), /Bo Example/);
    assert.equal(t.button('Request introduction').disabled ?? t.props(t.button('Request introduction')).disabled, true, 'nothing that contacts anyone yet');
    await mountOrg(t, api, '/network/organizations/org-1/people/p-1?q=alpha');
    await settle();
    assert.ok(t.attr('data-context-bar').length, 'the sheet carries the organization as context');
    assert.match(t.text(t.box), /Opened from Alpha Example Ventures · Partner · current/);
    await act(async () => t.props(t.walk(t.box).find((n) => t.props(n)['data-testid'] === 'person-sheet-close')).onClick({}));
    assert.equal(where, '/network/organizations/org-1?q=alpha');
  } finally { await t.done(); }
});

test('an organization with no people recorded says so and offers nothing that contacts anyone', async () => {
  const t = harness();
  const api = {
    entry: async () => ({ entry: ORGS[1], affiliations: [] }),
    peopleCounts: async () => ({ counts: { 'org-2': { people: 0, current: 0, former: 0, unknown: 0 } } }),
  };
  try {
    await mountOrg(t, api, '/network/organizations/org-2');
    await settle();
    assert.ok(t.attr('data-org-no-people').length);
    assert.match(t.text(t.box), /No people are recorded at Beta Example Capital/);
    assert.match(t.text(t.box), /An introduction needs a named person/);
  } finally { await t.done(); }
});

test('an organization that is not available reads the same words; a failed read is Unavailable', async () => {
  const t = harness();
  try {
    await mountOrg(t, { entry: async () => { throw Object.assign(new Error('x'), { status: 404 }); }, peopleCounts: async () => ({ counts: {} }) }, '/network/organizations/org-x');
    await settle();
    assert.ok(t.attr('data-org-not-available').length);
    await mountOrg(t, { entry: async () => { throw Object.assign(new Error('x'), { status: 500 }); }, peopleCounts: async () => ({ counts: {} }) }, '/network/organizations/org-y');
    await settle();
    assert.equal(t.attr('data-org-not-available').length, 0);
    assert.match(t.text(t.box), /This organization could not be read/);
  } finally { await t.done(); }
});
