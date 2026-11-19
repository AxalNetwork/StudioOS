// D5081 part 3 (#5081, RA-20) — Cap table's Overview owns its page: no generic Planned round card or Holders
// list under the tool's blocks; the header's one primary is the module's own (Record an issuance, a co-founder's
// Propose an issuance), chosen from the same record read Overview draws and only for a viewer its capability map
// lets write; first use collapses to the empty card and at most three set-up actions.
//
// Run with:
//   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/captable_owns_home_d5081.test.mjs
import { withCapabilities } from './_cap_table_capabilities.mjs';
import './_cycleSteps.mjs'; // D4574 (#4574, H5): CycleRoute's lazy steps, loaded before it mounts
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import CycleRoute from '../src/pages/cycles/CycleRoute.jsx';
import { AuthProvider } from '../src/hooks/useAuthSync.jsx';
import {
  HOME_NOTE, IMPORT_ACTION, MODEL_ACTION, OWNED_NOTE, PROPOSE_ACTION, RECORD_ACTION, SETUP_ACTION,
  homeAction, isFirstUse, setupActions,
} from '../src/pages/raise/captable/capTableModel.js';

const h = React.createElement;
const response = (body, status = 200) => ({ ok: status < 400, status, headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body) });

const CLASSES = [{ uid: 'c1', name: 'Common', kind: 'common', authorized_shares: 10000000, price_per_share_micros: 100, liquidation_multiple_bps: 10000, participating: false, conversion_ratio: 1 }];
const RECORDED = {
  project_id: 3, currency: { code: 'USD', source: 'default' },
  classes: { available: true, reason: null, rows: CLASSES },
  by_holder: { available: true, reason: null, rows: [{ holder_id: 12, name: 'Founder A', kind: 'founder', shares: 6000000, options: 0, by_class: [{ class_uid: 'c1', shares: 6000000 }] }] },
  by_class: { available: true, reason: null, rows: [{ ...CLASSES[0], issued: 6000000, options_granted: null, options_exercised: null, unallocated: null }] },
  outstanding: { available: true, reason: null, shares: 6000000, common: 6000000, preferred: 0 },
  fully_diluted: { available: true, reason: null, shares: 6000000, outstanding: 6000000, options_granted: 0, unallocated_pool: 0, pool_recorded: false },
  instruments: { available: true, reason: null, rows: [] },
  issuances: { available: true, reason: null, rows: [] },
  proposals: { available: true, reason: null, rows: [] },
};
const NOTHING = { available: false, reason: 'nothing_recorded', sentence: 'No issuance of shares is on record yet.' };
const EMPTY = { ...RECORDED, by_holder: NOTHING, by_class: NOTHING, outstanding: NOTHING, fully_diluted: NOTHING };
const OWNER = { id: 2, role: 'founder', founder_id: 20, subscription_tier: 'studio', name: 'Synthetic Founder' };
const OWNS = { grants: [], can_change: true, levels: [] };
const COFOUNDS = { grants: [], can_change: false, levels: [] };
const MODULE = {
  module: { slug: 'cap-table', name: 'Cap table', records_title: 'Holders' },
  card: { state: 'ok', range: 'Planned round', caption: 'Planned round', series: [{ label: 'Founders', value: 1 }] },
  records: { linkable: true, total: 1, page: 1, page_size: 25, cols: [{ key: 'holder', label: 'Holder' }], rows: [{ id: 'e-3', cells: { holder: 'Founder A (model)' } }] },
};

/* ------------------------------------------------------------------ *
 * The rules
 * ------------------------------------------------------------------ */

const ready = (data, grants = OWNS, user = OWNER) => ({ status: 'ready', data: withCapabilities(data, user, grants) });
const caps = (data, capabilities) => ({ status: 'ready', data: { ...data, capabilities } });

test('first use is an answered record with nothing recorded; an unread, failed or refused read never is', () => {
  // Mutation checked: `status === 'ready'` dropped → a failed read with no data is "first use".
  assert.equal(isFirstUse(ready(EMPTY)), true);
  assert.equal(isFirstUse(ready(RECORDED)), false);
  for (const status of ['loading', 'error', 'refused']) assert.equal(isFirstUse({ status, data: EMPTY }), false, status);
  assert.equal(isFirstUse(null), false);
});

test('the header\'s primary is Record an issuance for the owner and Propose for a co-founder, opening /new with the venture', () => {
  // Mutation checked: `!s.writes` dropped → a reader gets Record; the first-use check dropped → the empty card's action is drawn twice.
  assert.deepEqual(homeAction(ready(RECORDED), { search: '?project_id=3&x=1' }), { label: RECORD_ACTION, href: '/raise/cap-table/new?project_id=3' });
  assert.deepEqual(homeAction(ready(RECORDED, COFOUNDS), { search: '?project_id=3' }), { label: PROPOSE_ACTION, href: '/raise/cap-table/new?project_id=3' });
  assert.equal(homeAction(ready(EMPTY), { search: '?project_id=3' }), null, 'first use: the empty card carries the page\'s one primary (D5076)');
  for (const status of ['loading', 'error', 'refused']) assert.equal(homeAction({ status, data: RECORDED }), null, status);
  assert.equal(homeAction(caps(RECORDED, {})), null, 'no capability map allows nothing');
  assert.equal(homeAction(caps(RECORDED, { propose: true, record: true, plan: false })), null, 'no plan, no write');
  assert.equal(homeAction(caps(RECORDED, { propose: true, record: true, correct: true, admin_reason_required: true, plan: true })), null, 'an admin who corrects reads only');
});

test('first use offers at most three set-up actions, the first the page\'s primary; none for a reader or without the plan', () => {
  const owner = setupActions(ready(EMPTY), { search: '?project_id=3' });
  assert.deepEqual(owner.map((a) => a.label), [SETUP_ACTION, IMPORT_ACTION, MODEL_ACTION]);
  assert.deepEqual(owner.map((a) => a.href), ['/raise/cap-table/new?project_id=3', '/raise/cap-table/import-export?project_id=3', '/raise/cap-table/scenarios?project_id=3']);
  assert.deepEqual(setupActions(ready(EMPTY, COFOUNDS)).map((a) => a.label), [PROPOSE_ACTION, IMPORT_ACTION, MODEL_ACTION]);
  assert.deepEqual(setupActions(caps(EMPTY, { propose: true, plan: true })).map((a) => a.key), ['propose', 'model'], 'no import without the map\'s import');
  assert.deepEqual(setupActions(caps(EMPTY, { export: true, plan: true })), [], 'a reader is given none');
  assert.deepEqual(setupActions(caps(EMPTY, { propose: true, record: true, import: true, plan: false })), [], 'nor is anyone without the plan');
  assert.deepEqual(setupActions({ status: 'error', data: null }), []);
});

/* ------------------------------------------------------------------ *
 * The page
 * ------------------------------------------------------------------ */

function handlerFor(o = {}) {
  const at = { record: RECORDED, grants: OWNS, user: OWNER, ...o };
  const send = (v) => (typeof v === 'number' ? response({ detail: 'refused' }, v) : response(v));
  return (url) => {
    if (url.includes('/captable/record/3')) return send(withCapabilities(at.record, at.user, at.grants));
    if (url.includes('/compare')) return response({ canonical: null, variants: [] });
    if (url.includes('/captable/409a/')) return response({ ok: true, current: null, status: { state: 'none', reason: 'No 409A is recorded.' } });
    if (url.includes('/captable/access/3/grants')) return send(at.grants);
    if (/\/integrations(\?|$)/.test(url)) return response({ ok: true, items: [] });
    if (url.includes('/auth/me')) return response(at.user);
    if (url.includes('/cycles/raise/modules/')) return response(MODULE);
    return response({});
  };
}

async function mounted(url, o = {}) {
  const restore = installDocument();
  const previous = { fetch: globalThis.fetch, matchMedia: globalThis.matchMedia };
  const requests = [];
  const handle = handlerFor(o);
  globalThis.fetch = async (u) => { requests.push(String(u)); return handle(String(u)); };
  globalThis.matchMedia = () => ({ matches: !!o.phone, addEventListener() {}, removeEventListener() {} });
  localStorage.setItem('user', JSON.stringify(o.user || OWNER));
  const create = document.createElement.bind(document);
  document.createElement = (tag) => { const node = create(tag); node.querySelector = () => null; node.querySelectorAll = () => []; node.focus = () => {}; node.children = []; return node; };
  document.body.style = { overflow: 'auto', paddingRight: '' };
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => root.render(h(MemoryRouter, { initialEntries: [url] }, h(AuthProvider, null, h(Routes, null,
    h(Route, { path: '/raise/:slug', element: h(CycleRoute, { cycle: 'raise' }) }),
    h(Route, { path: '/raise/:slug/:id', element: h(CycleRoute, { cycle: 'raise', record: true }) }),
  )))));
  const flush = () => act(async () => { for (let i = 0; i < 10; i += 1) await new Promise((r) => setImmediate(r)); });
  await flush();
  const nodes = () => { const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)]; return walk(container); };
  const text = (n) => (n?.nodeType === 3 ? n.textContent : n?.childNodes?.length ? n.childNodes.map(text).join(' ') : n?.textContent || '');
  const props = (n) => Object.entries(n).find(([key]) => key.startsWith('__reactProps$'))?.[1] || {};
  const all = (id) => nodes().filter((n) => props(n)['data-testid'] === id);
  return {
    requests, props, all, by: (id) => all(id)[0],
    text: (n = container) => text(n).replace(/\s+/g, ' '),
    async close() { await act(async () => root.unmount()); Object.assign(globalThis, previous); restore(); },
  };
}

const recordReads = (v) => v.requests.filter((u) => /\/captable\/record\/3(\?|$)/.test(u)).length;

test('Overview owns the page: the tool\'s blocks, no generic card or Holders list, and one Record an issuance in the header', async () => {
  const v = await mounted('/raise/cap-table?project_id=3');
  try {
    assert.ok(v.by('captable-overview') && v.by('captable-who-owns'), 'the tool\'s blocks');
    // Mutation checked: `owned` not passed on Cap table → the generic card and the Holders table come back.
    assert.ok(!v.by('cycle-module-chart'), 'no generic Planned round card');
    assert.doesNotMatch(v.text(), /· at a glance|Founder A \(model\)/, 'no generic records table');
    assert.match(v.text(), /Who owns the company, what was issued, and what the next round does to it\./, "the header's line is the tool's");
    assert.doesNotMatch(v.text(), /Records below; the tabs above move between modules\./);
    assert.equal(v.text(v.by('cycle-action')), RECORD_ACTION);
    assert.equal(v.props(v.by('cycle-action')).href, '/raise/cap-table/new?project_id=3');
    assert.ok(!v.by('captable-record'), 'the tool bar does not draw it again');
    assert.match(v.text(v.by('captable-home-note')), new RegExp(OWNED_NOTE.slice(0, 60)));
    assert.doesNotMatch(v.text(), new RegExp(HOME_NOTE.slice(-60).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), 'the line names no block that is not drawn');
    assert.doesNotMatch(v.text(), /Build your deck/);
    // Mutation checked: Overview's own record read restored beside the shared one → two reads.
    assert.equal(recordReads(v), 1, 'the header and the blocks draw from one record read');
  } finally { await v.close(); }
});

test('a co-founder\'s header proposes; a reader\'s header has no action', async () => {
  const c = await mounted('/raise/cap-table?project_id=3', { grants: COFOUNDS });
  try {
    assert.equal(c.text(c.by('cycle-action')), PROPOSE_ACTION);
    assert.ok(!c.by('captable-propose'));
  } finally { await c.close(); }
  const r = await mounted('/raise/cap-table?project_id=3', { record: { ...RECORDED, capabilities: { export: true, plan: true } } });
  try {
    assert.ok(!r.by('cycle-action'), 'a reader is offered no write');
    assert.ok(r.by('captable-who-owns'));
  } finally { await r.close(); }
});

test('first use: the empty card and its three set-up actions are the page\'s actions; the header has none', async () => {
  const v = await mounted('/raise/cap-table?project_id=3', { record: EMPTY });
  try {
    assert.ok(v.by('captable-empty'));
    assert.ok(!v.by('cycle-action'), 'one primary on the page (D5076)');
    assert.ok(!v.by('captable-record'), 'and not a second in the tool bar');
    assert.deepEqual(['setup', 'import', 'model'].map((k) => v.text(v.by(`captable-setup-${k}`))), [SETUP_ACTION, IMPORT_ACTION, MODEL_ACTION]);
    assert.equal(v.props(v.by('captable-setup-setup')).href, '/raise/cap-table/new?project_id=3');
  } finally { await v.close(); }
});

test('a refused or failed record read gives the header no action', async () => {
  for (const record of [403, 500]) {
    const v = await mounted('/raise/cap-table?project_id=3', { record });
    try {
      assert.ok(!v.by('cycle-action'), String(record));
      assert.ok(!v.by('captable-setup-setup'), `${record}: a read nobody answered is never first use`);
    } finally { await v.close(); }
  }
});

test('on a phone the bar carries no action, so Record an issuance stays in the tool bar, full width', async () => {
  const v = await mounted('/raise/cap-table?project_id=3', { phone: true });
  try {
    assert.equal(v.props(v.by('phone-module'))['data-owned'], 'true');
    assert.ok(!v.by('cycle-action'));
    assert.ok(v.by('captable-record'), 'the one action on a phone');
    assert.ok(!v.by('cycle-module-chart'));
  } finally { await v.close(); }
  const e = await mounted('/raise/cap-table?project_id=3', { phone: true, record: EMPTY });
  try {
    assert.ok(!e.by('captable-record'), 'on first use the empty card\'s Set up cap table is the one action');
    assert.ok(e.by('captable-setup-setup'));
  } finally { await e.close(); }
});

test('the tool\'s tabs carry Record an issuance in place of Build your deck; a record row keeps the cycle\'s page', async () => {
  const v = await mounted('/raise/cap-table/history?project_id=3');
  try {
    assert.equal(v.text(v.by('cycle-action')), RECORD_ACTION);
    assert.doesNotMatch(v.text(), /Build your deck/);
  } finally { await v.close(); }
  const holder = await mounted('/raise/cap-table/h-12?project_id=3');
  try {
    assert.equal(recordReads(holder), 1, 'the holder drawer over Overview reads the shared record');
  } finally { await holder.close(); }
});

test('the wiring: CycleRoute imports no new module, and the decision is its own part file', () => {
  const route = readFileSync('frontend/src/pages/cycles/CycleRoute.jsx', 'utf8');
  assert.match(route, /^import \{ useCapRelHome, useCapTableHome, useUseOfFundsHome \} from '\.\/defs\/raise\.jsx';$/m, 'through defs/raise.jsx (HUBS.md)');
  assert.doesNotMatch(route, /capTableHomeRead/);
  assert.match(route, /capTableOwnsHome \? \{ sub: CAP_TABLE_LINE \}/);
  assert.match(readFileSync('frontend/src/pages/cycles/defs/raise.jsx', 'utf8'), /export \{ useCapTableHome \} from '\.\.\/\.\.\/raise\/captable\/capTableHomeRead\.js';/);
  const doc = readFileSync('documentation/architecture/decisions/D5081-p3.md', 'utf8');
  assert.match(doc, /^## D5081 part 3 — Raise tools own their pages: Cap table \(#5081\)$/m);
});
