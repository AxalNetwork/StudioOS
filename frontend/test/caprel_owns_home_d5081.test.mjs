// D5081 part 2 (#5081, RA-22) — Capital relationships' Overview owns its page: no generic "at a glance",
// This venture, stage counts or records table under the tool's blocks; the header's one primary is the
// module's own (Follow up, Find investors, Add investor), chosen from the same prospects read Overview
// draws and only for a viewer who works the tool; first use collapses to the start card and at most three
// set-up actions; and the shipped "Not read here yet" copy is gone.
//
// Run with:
//   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/caprel_owns_home_d5081.test.mjs
import './_cycleSteps.mjs'; // D4574 (#4574, H5): CycleRoute's lazy steps, loaded before it mounts
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import CycleRoute from '../src/pages/cycles/CycleRoute.jsx';
import {
  ADD_ACTION, FIND_ACTION, IMPORT_ACTION, START_READER, START_TITLE, addHref, homeAction, isFirstUse, setupActions,
} from '../src/pages/raise/caprel/capRelModel.js';

const h = React.createElement;
const response = (body, status = 200) => ({ ok: status < 400, status, headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body) });
const TODAY = '2026-10-26';
const P = (id, name, stage, o = {}) => ({ id, name, stage, updated_at: '2026-10-12', ...o });
const PROSPECTS = [
  P(41, 'Bluefern Capital', 'meeting', { next_step: 'Send the deck', next_step_due: '2026-10-20' }),
  P(42, 'Northwind Ventures', 'to_contact'),
  P(46, 'Juno Capital', 'diligence', { next_step: 'Data room', next_step_due: TODAY }),
];
const QUIET = [P(42, 'Northwind Ventures', 'to_contact'), P(47, 'Alder Seed', 'contacted', { next_step: 'Intro call', next_step_due: '2099-01-01' })];
const COMMITMENTS = {
  currency: 'USD', round: { name: 'Seed', target_cents: 200000000, currency: 'USD' }, round_reason: null,
  totals: { counted_cents: 5000000, not_counted_cents: 0, percent_of_target: 2.5, partial: false },
};
const NO_MONEY = { ...COMMITMENTS, totals: { counted_cents: 0, not_counted_cents: 0, percent_of_target: 0, partial: false } };
const PROJECTS = [{ id: 3, uid: 'p3uid', name: 'Harbor Ledger' }];
const MODULE = (works) => ({
  module: { slug: 'capital-relationships', name: 'Capital relationships', records_title: 'Investors' },
  card: { state: 'ok', caption: 'Pipeline counts', series: [] },
  records: { linkable: true, total: 1, page: 1, page_size: 25, cols: [{ key: 'investor', label: 'Investor' }], rows: [{ id: 41, cells: { investor: 'Bluefern Capital' } }] },
  parts: { calls: { state: 'ok', items: [] } },
  capabilities: works ? { work: true } : {},
});

const ready = (items) => ({ status: 'ready', items });
const commits = (data, status = 'ready') => ({ status, data });

/* ------------------------------------------------------------------ *
 * The rules
 * ------------------------------------------------------------------ */

test('first use is an answered empty pipeline with no amount recorded; an unread, failed or refused read never is', () => {
  // Mutation checked: dropping the commitments condition makes a pipeline with money "first use"; `!t.partial` dropped → a partial total collapses.
  assert.equal(isFirstUse({ prospects: ready([]), commitments: commits(NO_MONEY) }), true);
  assert.equal(isFirstUse({ prospects: ready([]), commitments: commits({ ...NO_MONEY, totals: {} }) }), true, 'no totals at all is no amount');
  assert.equal(isFirstUse({ prospects: ready(PROSPECTS), commitments: commits(NO_MONEY) }), false);
  assert.equal(isFirstUse({ prospects: ready([]), commitments: commits(COMMITMENTS) }), false, 'money counted without a prospect is not first use');
  assert.equal(isFirstUse({ prospects: ready([]), commitments: commits({ ...NO_MONEY, totals: { not_counted_cents: 100 } }) }), false);
  assert.equal(isFirstUse({ prospects: ready([]), commitments: commits({ ...NO_MONEY, totals: { partial: true } }) }), false, 'a source unread is not nothing');
  for (const status of ['loading', 'unreadable', 'refused']) {
    assert.equal(isFirstUse({ prospects: { status, items: null }, commitments: commits(NO_MONEY) }), false, `prospects ${status}`);
    assert.equal(isFirstUse({ prospects: ready([]), commitments: commits(null, status) }), false, `commitments ${status}`);
  }
});

test('the header’s one primary: none unread, none for a reader, none on first use; Follow up, Find investors or Add investor', () => {
  // Mutation checked: `!works` dropped → a reader is offered a write; the due count summing only overdue → Follow up (1).
  const home = { prospects: ready(PROSPECTS), commitments: commits(COMMITMENTS) };
  const opts = { works: true, search: '?project_id=3', today: TODAY };
  assert.deepEqual(homeAction(home, opts), { label: 'Follow up (2)', href: '/raise/capital-relationships/pipeline?project_id=3' });
  assert.equal(homeAction(home, { ...opts, works: false }), null, 'a viewer who cannot work the tool gets no action');
  assert.equal(homeAction({ prospects: { status: 'loading', items: null }, commitments: commits(COMMITMENTS) }, opts), null);
  assert.equal(homeAction({ prospects: { status: 'unreadable', items: null }, commitments: commits(COMMITMENTS) }, opts), null);
  assert.equal(homeAction({ prospects: { status: 'refused', items: null }, commitments: commits(COMMITMENTS) }, opts), null);
  assert.equal(homeAction({ prospects: ready([]), commitments: commits(NO_MONEY) }, opts), null, 'first use: the start card leads');
  assert.deepEqual(homeAction({ prospects: ready([]), commitments: commits(COMMITMENTS) }, opts), { label: FIND_ACTION, href: '/raise/capital-relationships/match?project_id=3' });
  assert.deepEqual(homeAction({ prospects: ready(QUIET), commitments: commits(COMMITMENTS) }, opts), { label: ADD_ACTION, href: '/raise/capital-relationships/pipeline?project_id=3&open=add' });
  assert.equal(addHref(''), '/raise/capital-relationships/pipeline?open=add', 'no venture, still one query string');
});

test('first use’s set-up actions: at most three, Find investors first; none for a reader', () => {
  const a = setupActions({ works: true, search: '?project_id=3' });
  assert.ok(a.length >= 1 && a.length <= 3);
  assert.deepEqual(a.map((x) => [x.label, x.href]), [
    [FIND_ACTION, '/raise/capital-relationships/match?project_id=3'],
    [ADD_ACTION, '/raise/capital-relationships/pipeline?project_id=3&open=add'],
    [IMPORT_ACTION, '/raise/capital-relationships/pipeline?project_id=3&open=import'],
  ]);
  assert.deepEqual(setupActions({ works: false, search: '?project_id=3' }), []);
});

/* ------------------------------------------------------------------ *
 * The page
 * ------------------------------------------------------------------ */

async function mounted(url, { phone = false, works = true, prospects = PROSPECTS, commitments = COMMITMENTS } = {}) {
  const restore = installDocument();
  const previous = { fetch: globalThis.fetch, matchMedia: globalThis.matchMedia };
  const calls = [];
  globalThis.fetch = async (u, options = {}) => {
    const s = String(u);
    calls.push({ url: s, method: options.method || 'GET' });
    if (/\/api\/projects(\?|$)/.test(s)) return response(PROJECTS);
    if (/\/contacts\/raise-prospects\?/.test(s)) return response({ items: prospects });
    if (/capital-relationships\/commitments/.test(s)) return response(commitments);
    if (/\/contacts\/raise-closes/.test(s)) return response({ closes: [], round: null });
    if (/\/contacts\/raise-pro-rata/.test(s)) return response({ items: [] });
    if (s.includes('/cycles/raise/modules/')) return response(MODULE(works));
    return response({});
  };
  globalThis.matchMedia = () => ({ matches: phone, addEventListener() {}, removeEventListener() {} });
  const create = document.createElement.bind(document);
  document.createElement = (tag) => { const node = create(tag); node.querySelector = () => null; node.querySelectorAll = () => []; node.focus = () => {}; node.children = []; return node; };
  document.body.style = { overflow: 'auto', paddingRight: '' };
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => root.render(h(MemoryRouter, { initialEntries: [url] }, h(Routes, null,
    h(Route, { path: '/raise/:slug', element: h(CycleRoute, { cycle: 'raise' }) }),
    h(Route, { path: '/raise/:slug/:id', element: h(CycleRoute, { cycle: 'raise', record: true }) }),
  ))));
  const flush = () => act(async () => { for (let i = 0; i < 8; i += 1) await new Promise((r) => setImmediate(r)); });
  await flush();
  const nodes = () => { const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)]; return walk(container); };
  const text = (n) => (n?.nodeType === 3 ? n.textContent : n?.childNodes?.length ? n.childNodes.map(text).join(' ') : n?.textContent || '');
  const props = (n) => Object.entries(n).find(([key]) => key.startsWith('__reactProps$'))?.[1] || {};
  const by = (id) => nodes().find((n) => props(n)['data-testid'] === id);
  return {
    calls, by, props,
    has: (id) => Boolean(by(id)),
    text: (id) => text(id ? by(id) : container).replace(/\s+/g, ' ').trim(),
    async close() { await act(async () => root.unmount()); Object.assign(globalThis, previous); restore(); },
  };
}

const HOME = '/raise/capital-relationships?project_id=3';
const GENERIC = ['cycle-module-chart', 'cycle-module-tool', 'cycle-records'];

test('Overview owns the page: the tool’s blocks and the module’s own parts, nothing generic under them; one read each', async () => {
  // Mutation checked: CycleRoute's `owned` for Capital relationships dropped → "· at a glance", the tool door and the records table return.
  const v = await mounted(HOME);
  try {
    assert.ok(v.has('caprel-overview') && v.has('caprel-ov-round') && v.has('caprel-ov-stages'));
    for (const id of GENERIC) assert.equal(v.by(id), undefined, `${id} is not drawn under the tool`);
    assert.doesNotMatch(v.text(), /Capital relationships · at a glance/);
    assert.doesNotMatch(v.text(), /not read here yet/i, 'no shipped implementation-stage copy');
    assert.equal(v.by('caprel-ov-waits'), undefined);
    assert.equal(v.calls.filter((c) => /raise-prospects/.test(c.url)).length, 1, 'the header and Overview share one prospects read');
    assert.equal(v.calls.filter((c) => /capital-relationships\/commitments/.test(c.url)).length, 1, 'and one commitments read');
  } finally { await v.close(); }
});

test('the header’s action on Overview is the module’s own, never Build your deck; none for a reader', async () => {
  const v = await mounted(HOME);
  try {
    assert.match(v.text('cycle-action'), /^Follow up \(\d+\)$/);
    assert.equal(v.props(v.by('cycle-action')).href, '/raise/capital-relationships/pipeline?project_id=3');
  } finally { await v.close(); }
  const q = await mounted(HOME, { prospects: QUIET });
  try { assert.equal(q.text('cycle-action'), ADD_ACTION); } finally { await q.close(); }
  const r = await mounted(HOME, { works: false });
  try {
    assert.equal(r.by('cycle-action'), undefined, 'a viewer who cannot work the tool is offered no write');
    assert.doesNotMatch(r.text('cycle-header'), /Build your deck/);
  } finally { await r.close(); }
});

test('first use collapses to the start card and its set-up actions, with no zero-filled block and no header action', async () => {
  // Mutation checked: Overview's `isFirstUse` branch removed → the round, Needs you and the stages draw as zeros.
  const v = await mounted(HOME, { prospects: [], commitments: NO_MONEY });
  try {
    assert.ok(v.text('caprel-ov-start').includes(START_TITLE));
    assert.deepEqual(['find', 'add', 'import'].map((k) => v.text(`caprel-ov-start-${k}`)), [FIND_ACTION, ADD_ACTION, IMPORT_ACTION]);
    for (const id of ['caprel-ov-round', 'caprel-ov-needs', 'caprel-ov-stages', 'caprel-ov-followups', 'cycle-action', ...GENERIC]) {
      assert.equal(v.by(id), undefined, `${id} waits for the first investor`);
    }
  } finally { await v.close(); }
  const r = await mounted(HOME, { prospects: [], commitments: NO_MONEY, works: false });
  try {
    assert.ok(r.text('caprel-ov-start').includes(START_READER));
    assert.equal(r.by('caprel-ov-start-find'), undefined, 'no set-up action for a reader');
  } finally { await r.close(); }
  const m = await mounted(HOME, { prospects: [], commitments: COMMITMENTS });
  try {
    assert.equal(m.by('caprel-ov-start'), undefined, 'money recorded without a prospect is not first use');
    assert.ok(m.has('caprel-ov-round'));
    assert.equal(m.text('cycle-action'), FIND_ACTION);
  } finally { await m.close(); }
});

test('Add investor and Import pipeline open Pipeline’s own dialogs on arrival', async () => {
  const v = await mounted('/raise/capital-relationships/pipeline?project_id=3&open=add');
  try { assert.ok(v.has('caprel-add-dialog'), 'Add investor opens'); } finally { await v.close(); }
  const i = await mounted('/raise/capital-relationships/pipeline?project_id=3&open=import');
  try { assert.ok(i.has('caprel-import-dialog'), 'Import opens'); } finally { await i.close(); }
});

test('on the tabs the action is Add investor for a viewer who works the tool, none on Pipeline, which has its own', async () => {
  const m = await mounted('/raise/capital-relationships/match?project_id=3');
  try {
    assert.equal(m.text('cycle-action'), ADD_ACTION);
    assert.equal(m.props(m.by('cycle-action')).href, '/raise/capital-relationships/pipeline?project_id=3&open=add');
  } finally { await m.close(); }
  const p = await mounted('/raise/capital-relationships/pipeline?project_id=3');
  try { assert.equal(p.by('cycle-action'), undefined, 'Pipeline’s own Add investor is the action'); } finally { await p.close(); }
  const r = await mounted('/raise/capital-relationships/match?project_id=3', { works: false });
  try { assert.equal(r.by('cycle-action'), undefined); } finally { await r.close(); }
});

test('on a phone the bar carries no action, so Overview draws it full width', async () => {
  const v = await mounted(HOME, { phone: true });
  try {
    assert.match(v.text('caprel-home-action'), /^Follow up \(\d+\)$/);
    assert.ok(v.by('phone-module'), 'the phone page');
    assert.equal(v.props(v.by('phone-module'))['data-owned'], 'true');
  } finally { await v.close(); }
});

test('the wiring: CycleRoute imports no new module, and the decision is its own part file', () => {
  const route = readFileSync('frontend/src/pages/cycles/CycleRoute.jsx', 'utf8');
  // D5081 part 3 adds Cap table's read to the same line; part 4 adds Data room's `owned` to the chain.
  assert.match(route, /^import \{ useCapRelHome, (?:useCapTableHome, )?useUseOfFundsHome \} from '\.\/defs\/raise\.jsx';$/m, 'through defs/raise.jsx (HUBS.md)');
  assert.doesNotMatch(route, /capRelHomeRead/);
  assert.match(route, /owned=\{uofOwnsHome \? \{ sub: UOF_FRAME \} : capRelOwnsHome \? \{ sub: CAP_REL_LINE \} : (?:capTableOwnsHome \? \{ sub: CAP_TABLE_LINE \} : )?(?:dataRoomOwnsHome \? \{ sub: DATA_ROOM_LINE \} : )?null\}/);
  const doc = readFileSync('documentation/architecture/decisions/D5081-p2.md', 'utf8');
  assert.match(doc, /^## D5081 part 2 — Raise tools own their pages: Capital relationships \(#5081\)$/m);
});
