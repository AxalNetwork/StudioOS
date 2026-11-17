/**
 * D7103 (#7103, Raise v2 RA-14 and RA-17) — Investor narrative owns its Home, and its header action is Save
 * version: the states (`narrativeHomeModel.js`), the action from the part's capability map, one write per press,
 * a refused save that keeps the dialog's choices, and the Home body rendered in each state at desktop and phone.
 *
 * Every name and figure is a fixture.
 *
 * Run: node --import ./frontend/test/_deck-loader.mjs --test frontend/test/narrative_owns_home_7103.test.mjs
 */
import './_cycleSteps.mjs'; // D4574: CycleRoute's lazy steps, loaded before it mounts
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import NarrativeOwnedHome from '../src/pages/raise/narrative/NarrativeOwnedHome.jsx';
import CycleRoute from '../src/pages/cycles/CycleRoute.jsx';
import {
  NOT_RECORDED_REASON, OLDER_NOT_CHECKED, SAVE_ACTION, SAVE_FAILED, SAVE_READ_ONLY, SETUP_READER, SETUP_TITLE,
  audienceKey, homeView, isSaveOpen, saveBody, saveDraft, saveHref, saveLine, saveReducer, saveStart, saveVersionAction,
  setupActions, singleFlight, stateLine, versionRows,
} from '../src/pages/raise/narrative/narrativeHomeModel.js';
import { narrativeStanding } from '../src/pages/raise/narrative/narrativeModel.js';
import { ADMIN_CAPS, COFOUNDER_CAPS, FOUNDER_CAPS } from './_narrative_capabilities.mjs';

const h = React.createElement;
const response = (body, status = 200) => ({ ok: status < 400, status, headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body) });

// GET /api/cycles/raise/modules/investor-narrative → parts.narrative (raiseCycle.ts narrativeHome, with D5074's map)
const PART = {
  state: 'ok',
  versions: [
    { version: 4, audience: 'Seed fund', based_on: 'v3', saved: '2026-11-03', by: 'Fay Founder', read_by: { deck_version: 6, cards: [1, 2] } },
    { version: 3, audience: 'Angel', based_on: null, saved: '2026-10-20', by: null, read_by: null },
  ],
  newest: { version: 4, compared: 3, mismatches: [{ figure: 'MRR', sentence: 'MRR differs' }] },
  deck: { version: 6, reads_narrative: true },
  spinout: false,
  objections: { state: 'ok', items: [], capped: false, answers: [] },
  claims: { state: 'ok', version: 4, total: 5, backed: 3, checked_at: null, mismatch_sections: ['traction'] },
  capabilities: FOUNDER_CAPS,
};
const data = (part) => ({ parts: { narrative: part } });
const EMPTY = { ...PART, versions: [], newest: null, claims: null };

/* ------------------------------------------------------------------ *
 * The model
 * ------------------------------------------------------------------ */

test('Home is in one #5129 state: loading, not recorded, unavailable, empty (first use) or ready', () => {
  // Mutation checked: the unreadable branch dropped → a failed read is drawn as first use; the length check dropped → no version reads as ready.
  assert.equal(homeView(null).state, 'loading', 'no read yet is loading, never empty');
  assert.equal(homeView({ parts: {} }).state, 'not_recorded', 'a read with no narrative part is Not recorded');
  assert.equal(homeView(data({ state: 'unreadable', reason: 'x', capabilities: FOUNDER_CAPS })).state, 'unavailable');
  assert.equal(homeView(data(EMPTY)).state, 'empty');
  assert.equal(homeView(data(PART)).state, 'ready');
  assert.equal(homeView(data({ state: 'ok', capabilities: FOUNDER_CAPS })).state, 'not_recorded', 'a part with no version list is not "none saved"');
});

test('the header\'s action is Save version for a writer; disabled with a reason for a reader; none while unread, failed or on first use', () => {
  // Mutation checked: the `edit` check dropped → an admin gets a live Save version; the ready check dropped → first use gets a second primary.
  assert.deepEqual(saveVersionAction(data(PART), { search: '?project_id=3&x=1' }), { label: SAVE_ACTION, href: '/raise/investor-narrative?project_id=3&save=version' });
  assert.deepEqual(saveVersionAction(data(PART), { projectId: 3 }), { label: SAVE_ACTION, href: '/raise/investor-narrative?project_id=3&save=version' }, 'the cycle context hands only the venture id');
  assert.equal(saveVersionAction(data({ ...PART, capabilities: COFOUNDER_CAPS }), { projectId: 3 }).href, '/raise/investor-narrative?project_id=3&save=version', 'a co-founder writes');
  const admin = saveVersionAction(data({ ...PART, capabilities: ADMIN_CAPS }), { projectId: 3 });
  assert.equal(admin.disabled, true);
  assert.equal(admin.reason, SAVE_READ_ONLY);
  assert.equal(admin.href, undefined, 'a disabled action links nowhere');
  assert.equal(saveVersionAction(data({ ...PART, capabilities: undefined }), { projectId: 3 }).disabled, true, 'no capability map allows nothing');
  assert.equal(saveVersionAction(null), null);
  assert.equal(saveVersionAction(data({ state: 'unreadable', capabilities: FOUNDER_CAPS })), null);
  assert.equal(saveVersionAction({ parts: {} }), null);
  assert.equal(saveVersionAction(data(EMPTY)), null, 'first use: the set-up card carries the one primary (D5076)');
  assert.equal(isSaveOpen('?project_id=3&save=version'), true);
  assert.equal(isSaveOpen('?project_id=3'), false);
  assert.equal(saveHref(''), '/raise/investor-narrative?save=version');
});

test('Save version writes the store\'s own body: the next version, from the newest, for the audience chosen', () => {
  const draft = saveDraft(PART);
  assert.deepEqual(draft, { from: 4, audience: 'seed_fund' });
  assert.deepEqual(saveBody(draft), { investor_type: 'seed_fund', start_from: 'version', based_on_version: 4 });
  assert.equal(saveLine(draft, PART), 'Saves v5 for Seed fund, a copy of v4 as it stands now, and checks it against your records. Nothing in v4 changes.');
  assert.equal(saveDraft({ versions: [{ version: 2, audience: null }, { version: 7, audience: 'Grant' }] }).from, 7, 'the newest is the highest number, not the first row');
  assert.equal(audienceKey('Unknown'), '', 'an audience the store does not take is not guessed');
});

test('one save per press: a press while saving starts nothing, and a refused save keeps the draft as it was', () => {
  // Mutation checked: the saving guard in `press` dropped → a second press re-enters saving; 'refused' resetting the draft → the choice is lost.
  let s = saveStart(PART);
  s = saveReducer(s, { type: 'edit', patch: { audience: 'angel' } });
  s = saveReducer(s, { type: 'press' });
  assert.equal(s.status, 'saving');
  assert.equal(saveReducer(s, { type: 'press' }), s, 'a second press while saving is the same state: no second write');
  assert.equal(saveReducer(s, { type: 'edit', patch: { audience: 'grant' } }), s, 'the draft does not move while saving');
  const refused = saveReducer(s, { type: 'refused', message: 'You can read this narrative, not change it.' });
  assert.equal(refused.status, 'refused');
  assert.deepEqual(refused.draft, { from: 4, audience: 'angel' }, 'the draft is intact');
  assert.equal(refused.error, 'You can read this narrative, not change it.');
  assert.equal(saveReducer(s, { type: 'failed' }).error, SAVE_FAILED);
  const incomplete = saveReducer(saveStart({ versions: [{ version: 2, audience: 'Unknown' }] }), { type: 'press' });
  assert.equal(incomplete.status, 'idle', 'no audience, no write');
  assert.match(incomplete.error, /Choose who/);
  const saved = saveReducer(s, { type: 'saved', version: 5 });
  assert.equal(saveReducer(saved, { type: 'press' }), saved, 'a saved dialog does not save again');
});

test('singleFlight: two calls in flight run the write once and share its answer', async () => {
  // Mutation checked: `if (pending) return pending` dropped → two writes.
  let calls = 0;
  let release;
  const run = singleFlight(() => { calls += 1; return new Promise((r) => { release = r; }); });
  const a = run();
  const b = run();
  await Promise.resolve();
  assert.equal(calls, 1);
  release({ version: 5 });
  assert.deepEqual(await a, { version: 5 });
  assert.equal(await b, await a);
  const c = run();
  await Promise.resolve();
  assert.equal(calls, 2, 'once answered, the next press writes again');
  release(null);
  await c;
});

test('the state line and the Versions rows are the part\'s, each in a #5129 state, never a made-up value', () => {
  // Mutation checked: older rows given the newest's check → v3 reads "1 mismatch".
  assert.deepEqual(stateLine(PART).map((x) => [x.key, x.kind, x.label]), [
    ['saved', 'value', 'v4 · Seed fund · saved 2026-11-03'],
    ['check', 'value', '1 mismatch in v4'],
    ['claims', 'value', '1 section needs attention'],
    ['pitch', 'value', 'Pitch deck v6 reads it'],
  ]);
  const uncompared = stateLine({ ...PART, newest: { version: 4, compared: 0, mismatches: [] }, claims: { state: 'unreadable' }, deck: null });
  assert.deepEqual(uncompared.slice(1).map((x) => x.kind), ['not_recorded', 'unavailable', 'not_applicable']);
  const rows = versionRows(PART);
  assert.deepEqual(rows.map((r) => [r.version, r.current, r.by, r.basedOn, r.usedBy, r.consistency.label]), [
    ['v4 · Seed fund', true, 'Fay Founder', 'v3', 'Pitch deck v6 · cards 1, 2', '1 mismatch'],
    ['v3 · Angel', false, 'Not recorded', 'Not recorded', 'None', 'Not recorded'],
  ]);
  assert.equal(rows[1].consistency.reason, OLDER_NOT_CHECKED);
  assert.deepEqual(setupActions(narrativeStanding(FOUNDER_CAPS), '?project_id=3').map((a) => [a.label, a.href, !!a.primary]), [
    ['New version', '/raise/investor-narrative/new?project_id=3', true],
    ['Write your positioning', '/raise/investor-narrative/positioning?project_id=3', false],
  ]);
  assert.deepEqual(setupActions(narrativeStanding(ADMIN_CAPS)), [], 'a reader is given no set-up action');
});

/* ------------------------------------------------------------------ *
 * The Home body
 * ------------------------------------------------------------------ */

const render = (props, url = '/raise/investor-narrative?project_id=3') => renderToStaticMarkup(h(MemoryRouter, { initialEntries: [url] }, h(NarrativeOwnedHome, { projectId: 3, search: '?project_id=3', ...props })));

test('Home renders loading, Unavailable, Not recorded and first use, each in its own words, never a zero', () => {
  // Mutation checked: the unavailable branch rendering the set-up card → the failed read claims nothing is saved.
  assert.match(render({ data: null }), /data-platform-state="loading"/);
  const bad = render({ data: data({ state: 'unreadable', capabilities: FOUNDER_CAPS }), onRetry: () => {} });
  assert.match(bad, /data-testid="narrative-home-unavailable"/);
  assert.match(bad, /Your narrative versions could not be read\./);
  assert.match(bad, /Retry/);
  assert.doesNotMatch(bad, /Start your investor narrative/);
  const none = render({ data: { parts: {} } });
  assert.match(none, /Not recorded/);
  assert.ok(none.includes(NOT_RECORDED_REASON));
  const first = render({ data: data(EMPTY) });
  assert.match(first, new RegExp(SETUP_TITLE));
  assert.match(first, /href="\/raise\/investor-narrative\/new\?project_id=3"/);
  assert.doesNotMatch(first, /narrative-home-versions|narrative-tile-/, 'first use draws no tile and no table');
  const reader = render({ data: data({ ...EMPTY, capabilities: ADMIN_CAPS }) });
  assert.match(reader, new RegExp(SETUP_READER));
  assert.doesNotMatch(reader, /<a /, 'a reader is given no action');
});

test('Home, ready: the state line, the tiles, and RA-17\'s Versions table; a reader reads why Save version is off', () => {
  const html = render({ data: data(PART) });
  assert.match(html, /data-testid="narrative-state-line"/);
  assert.match(html, /1 mismatch in v4/);
  assert.match(html, /data-testid="narrative-tile-versions"/);
  assert.match(html, /<table/);
  assert.match(html, /v4 · Seed fund · Current/);
  assert.doesNotMatch(html, /narrative-save-readonly/);
  assert.doesNotMatch(html, /narrative-save-dialog/, 'the dialog opens only from ?save=version');
  const admin = render({ data: data({ ...PART, capabilities: ADMIN_CAPS }) });
  assert.ok(admin.includes(SAVE_READ_ONLY));
  // Phone (390): no table, one stacked row per version, and Save version full width since the bar has no action.
  const phone = render({ data: data(PART), phone: true });
  assert.doesNotMatch(phone, /<table/);
  assert.match(phone, /data-testid="narrative-save-phone"/);
  assert.match(phone, /href="\/raise\/investor-narrative\?project_id=3&amp;save=version"/);
  assert.match(render({ data: data({ ...PART, capabilities: ADMIN_CAPS }), phone: true }), /<button type="button"[^>]*disabled=""[^>]*data-testid="narrative-save-phone"/);
});

/* ------------------------------------------------------------------ *
 * Save version, mounted
 * ------------------------------------------------------------------ */

async function mounted(url, handle, props = {}) {
  const restore = installDocument();
  const previous = { fetch: globalThis.fetch, matchMedia: globalThis.matchMedia };
  const requests = [];
  globalThis.fetch = async (u, options = {}) => { requests.push([String(u), options.method || 'GET', options.body]); return handle(String(u), options); };
  globalThis.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  const create = document.createElement.bind(document);
  document.createElement = (tag) => { const node = create(tag); node.querySelector = () => null; node.querySelectorAll = () => []; node.focus = () => {}; node.children = []; return node; };
  document.body.style = { overflow: 'auto', paddingRight: '' };
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => root.render(h(MemoryRouter, { initialEntries: [url] }, h(Routes, null,
    h(Route, { path: '/raise/investor-narrative', element: h(NarrativeOwnedHome, { projectId: 3, search: '?project_id=3', ...props }) }),
  ))));
  const flush = () => act(async () => { for (let i = 0; i < 6; i += 1) await new Promise((r) => setImmediate(r)); });
  await flush();
  const nodes = () => { const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)]; return walk(container); };
  const text = (n) => (n?.nodeType === 3 ? n.textContent : n?.childNodes?.length ? n.childNodes.map(text).join('') : n?.textContent || '');
  const props2 = (n) => Object.entries(n).find(([key]) => key.startsWith('__reactProps$'))?.[1] || {};
  const byId = (id) => nodes().filter((n) => props2(n)['data-testid'] === id);
  return {
    requests, flush, text: () => text(container), byId, props: props2,
    posts: () => requests.filter(([u, m]) => m === 'POST' && u.includes('/narrative-versions')),
    async close() { await act(async () => root.unmount()); Object.assign(globalThis, previous); restore(); },
  };
}

const reads = (u) => (u.includes('/narrative/reads') ? response({ reads: [], mine: null, viewer: { kind: 'founder' } }) : response({}));

test('a refused Save version writes once for two presses and leaves the draft intact, with the Worker\'s sentence', async () => {
  // Mutation checked: the ref lock in `press` dropped and singleFlight bypassed → two POSTs; 'refused' closing the dialog → no sentence.
  let release;
  const view = await mounted('/raise/investor-narrative?project_id=3&save=version', (u, o) => {
    if (u.includes('/narrative-versions') && o.method === 'POST') return new Promise((r) => { release = () => r(response({ detail: 'The version could not be saved: the narrative is read only for you.', code: 'admin_read_only' }, 403)); });
    return reads(u);
  }, { data: data(PART), reload: () => assert.fail('a refused save re-reads nothing') });
  try {
    const select = view.byId('narrative-save-audience')[0];
    assert.equal(view.props(select).value, 'seed_fund', 'the newest version\'s audience is chosen');
    await act(async () => view.props(select).onChange({ target: { value: 'angel' } }));
    const confirm = () => view.props(view.byId('narrative-save-confirm')[0]);
    await act(async () => { confirm().onClick(); confirm().onClick(); });
    await act(async () => { confirm().onClick(); });
    await view.flush();
    assert.equal(view.posts().length, 1, 'three presses while saving: one write');
    assert.deepEqual(JSON.parse(view.posts()[0][2]), { investor_type: 'angel', start_from: 'version', based_on_version: 4 });
    release();
    await view.flush();
    assert.equal(view.byId('narrative-save-dialog').length, 1, 'the dialog stays open');
    assert.equal(view.props(view.byId('narrative-save-audience')[0]).value, 'angel', 'the choice is kept');
    assert.match(view.text(), /read only for you/);
    assert.equal(view.byId('narrative-save-error').length, 1);
  } finally { await view.close(); }
});

test('a saved version closes the dialog and re-reads Home once', async () => {
  let reloads = 0;
  const view = await mounted('/raise/investor-narrative?project_id=3&save=version', (u, o) => (u.includes('/narrative-versions') && o.method === 'POST'
    ? response({ version: 5, mismatches: [] }, 201) : reads(u)), { data: data(PART), reload: () => { reloads += 1; } });
  try {
    await act(async () => { view.props(view.byId('narrative-save-confirm')[0]).onClick(); });
    await view.flush();
    assert.equal(view.posts().length, 1);
    assert.equal(reloads, 1);
    assert.equal(view.byId('narrative-save-dialog').length, 0, 'closed: the address drops ?save=version');
  } finally { await view.close(); }
});

test('a reader never gets the dialog, even from the address', async () => {
  const view = await mounted('/raise/investor-narrative?project_id=3&save=version', reads, { data: data({ ...PART, capabilities: ADMIN_CAPS }) });
  try {
    assert.equal(view.byId('narrative-save-dialog').length, 0);
    assert.equal(view.byId('narrative-save-readonly').length, 1);
  } finally { await view.close(); }
});

/* ------------------------------------------------------------------ *
 * The module page, wired (`CYCLE_DEFS.raise.homes`)
 * ------------------------------------------------------------------ */

// The generic layer's module read: a card and a records table a non-owned page would draw.
const MODULE = (part) => ({
  module: { slug: 'investor-narrative', name: 'Investor narrative', records_title: 'Versions' },
  card: { slug: 'investor-narrative', name: 'Investor narrative', state: 'ok', series: [{ kind: 'rows', items: [{ label: 'Versions', value: 2 }] }], next: null, reason: null, caption: 'GENERIC-CARD' },
  records: { cols: [{ key: 'version', label: 'Version' }], rows: [{ id: 4, cells: { version: 'GENERIC-ROW' } }], total: 1, page: 1, page_size: 25 },
  parts: { narrative: part },
});

async function routed(part) {
  const restore = installDocument();
  const previous = { fetch: globalThis.fetch, matchMedia: globalThis.matchMedia };
  globalThis.fetch = async (u) => {
    const url = String(u);
    if (url.includes('/cycles/raise/modules/investor-narrative?')) return response(MODULE(part));
    if (url.includes('/projects')) return response([{ id: 3, name: 'Fixture venture', role: 'owner' }]);
    return reads(url);
  };
  globalThis.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  const create = document.createElement.bind(document);
  document.createElement = (tag) => { const node = create(tag); node.querySelector = () => null; node.querySelectorAll = () => []; node.focus = () => {}; node.children = []; return node; };
  document.body.style = { overflow: 'auto', paddingRight: '' };
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => root.render(h(MemoryRouter, { initialEntries: ['/raise/investor-narrative?project_id=3'] }, h(Routes, null,
    h(Route, { path: '/raise/:slug', element: h(CycleRoute, { cycle: 'raise' }) }),
  ))));
  await act(async () => { for (let i = 0; i < 8; i += 1) await new Promise((r) => setImmediate(r)); });
  const nodes = () => { const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)]; return walk(container); };
  const text = (n) => (n?.nodeType === 3 ? n.textContent : n?.childNodes?.length ? n.childNodes.map(text).join('') : n?.textContent || '');
  const props = (n) => Object.entries(n).find(([key]) => key.startsWith('__reactProps$'))?.[1] || {};
  const byId = (id) => nodes().filter((n) => props(n)['data-testid'] === id);
  return { text: () => text(container), byId, props, async close() { await act(async () => root.unmount()); Object.assign(globalThis, previous); restore(); } };
}

test('wired: the module page draws Home in place of the generic layer, with Save version as the header\'s action', async () => {
  // Mutation checked: the `homes` entry removed → the generic card and row return and the action is Build your deck.
  const view = await routed(PART);
  try {
    assert.equal(view.byId('narrative-owned-home').length, 1);
    assert.doesNotMatch(view.text(), /GENERIC-ROW|GENERIC-CARD|at a glance|Build your deck/);
    const action = view.byId('cycle-action')[0];
    assert.ok(view.text().includes(SAVE_ACTION));
    assert.equal(view.props(action).href, '/raise/investor-narrative?project_id=3&save=version');
  } finally { await view.close(); }
  const reader = await routed({ ...PART, capabilities: ADMIN_CAPS });
  try {
    assert.equal(reader.props(reader.byId('cycle-action')[0]).disabled, true, 'a reader sees it disabled');
    assert.ok(reader.text().includes(SAVE_READ_ONLY));
  } finally { await reader.close(); }
  const first = await routed(EMPTY);
  try {
    assert.equal(first.byId('cycle-action').length, 0, 'first use: the set-up card carries the one primary');
    assert.equal(first.byId('narrative-setup').length, 1);
  } finally { await first.close(); }
});
