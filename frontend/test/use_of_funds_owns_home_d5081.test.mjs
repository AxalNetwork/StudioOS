// D5081 (#5081; Raise v2 boards RA-14 and RA-21 A, B) — Use of funds owns its Home. The module page draws
// no generic "at a glance", forecast door or Categories table under the tool; the header's primary action
// is Set raise & allocation, never Build your deck; Home is framed "What does this round buy us?", shows
// runway recorded against modelled, the milestones funded and each dependency marked Current, Stale,
// Unavailable or Not linked from the plan read; first use collapses to its set-up actions. Every figure
// here is invented.
//
// Run with:
//   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/use_of_funds_owns_home_d5081.test.mjs
import './_cycleSteps.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import { capsForViewer } from './_uof_capabilities.mjs';
import CycleRoute from '../src/pages/cycles/CycleRoute.jsx';
import {
  HOME_FRAME, MARK, SET_ACTION, dependencyRows, homeAction, milestonesFunded, runwayRows, setupActions,
} from '../src/pages/raise/useoffunds/useOfFundsModel.js';

const h = React.createElement;
const read = (p) => readFileSync(p, 'utf8');
const response = (body, status = 200) => ({ ok: status < 400, status, headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body) });

const KEYS = ['product', 'go-to-market', 'infrastructure', 'operations', 'reserve'];
const SHARES = [45, 25, 10, 10, 10];
const M = Array.from({ length: 18 }, (_, i) => `${2026 + Math.floor((9 + i) / 12)}-${String(((9 + i) % 12) + 1).padStart(2, '0')}`);
const modelled = (value, reason = null) => ({ source: 'Modelled', modelVersion: 1, state: value == null ? 'not_recorded' : 'recorded', value, reason });
const RAISE = 150000000;

/** A plan read in D1176's shape, with the blocks the dependency marks read. */
function plan({ viewer = { kind: 'founder', can_write: true, mercury: true }, empty = false, round = 'same', committed = null, cap = 'same', deck = 'synced', mercury = 'ok', runway = 'mercury' } = {}) {
  const alloc = SHARES.map((s) => (RAISE * s) / 100);
  const spend = M.map(() => Math.round(RAISE / 18));
  let cash = 45120000;
  const path = M.map((m, i) => { const raised = i === 0 ? RAISE : 0; cash = cash + raised - spend[i]; return { month: m, raisedCents: raised, spendCents: spend[i], closingCents: cash }; });
  const base = empty
    ? { id: 9, name: 'Base', currency: 'usd', amount_to_raise_cents: null, target_runway_months: null, lines: [], milestones: [], hires: { state: 'ok', items: [] },
      model: { runway: modelled(null, 'Raise amount or a complete split totalling 100% is Not recorded.'), sections: [], cashPath: modelled(null), cashOut: modelled(null), burn: modelled(null), milestones: modelled([]) } }
    : { id: 9, revision: 4, name: 'Seed · base', currency: 'usd', amount_to_raise_cents: RAISE, target_runway_months: 24, source: 'Typed',
      lines: KEYS.map((k, i) => ({ category_key: k, share_pct: SHARES[i], source: 'Typed' })),
      milestones: [
        { id: 2, category_key: 'go-to-market', label: '$1m ARR', due_on: '2027-10' },
        { id: 1, category_key: 'product', label: 'Launch self-serve tier', due_on: '2027-04' },
        { id: 3, category_key: 'operations', label: 'EU entity', due_on: null },
      ],
      hires: { state: 'ok', items: [] },
      model: {
        sections: KEYS.map((k, i) => ({ key: k, allocation: modelled(alloc[i]), spend: modelled(M.map(() => 0)) })),
        burn: modelled(M.map((m) => ({ month: m, spendCents: Math.round(RAISE / 18) }))), cashPath: modelled(path), cashOut: modelled({ months: 30, withinHorizon: false }),
        runway: modelled({ months: 24, relation: 'exact' }),
        milestones: modelled([{ id: '1', state: 'Funded' }, { id: '2', state: 'At risk' }, { id: '3', state: 'Not costed' }]),
      } };
  const merc = { value: 11, source: 'Connector', ref: 'mercury_raise_facts:1', as_of: '2026-11-01', state: 'recorded', kind: 'mercury', cash_cents: 45120000, burn_cents: 4100000 };
  const runway_today = runway === 'mercury'
    ? { state: 'recorded', chosen: merc, candidates: [merc], partial: false, sources: { mercury: { state: mercury }, metrics: { state: 'ok' } } }
    : { state: 'not_recorded', chosen: null, candidates: [], partial: false, sources: { mercury: { state: mercury }, metrics: { state: 'ok' } }, reason: 'No measured cash and positive burn are recorded.' };
  const chosen = { value: RAISE, source: 'Document', ref: 'round_calls:3', kind: 'round_call', name: 'Seed', currency: 'usd', eligible: true };
  return {
    // D5074 slice 5 (#6534): the page reads the viewer from the capability map the Worker sends.
    project_id: 3, viewer, capabilities: capsForViewer(viewer),
    base: { state: 'ok', value: base, reason: null },
    round: round === 'none' ? { chosen: null, candidates: [], disagreements: [], reason: 'No approved round call, active round target or plan raise is recorded.' }
      : { chosen, candidates: [chosen], disagreements: round === 'differs' ? [{ chosen, other: {} }] : [], reason: null },
    runway_today,
    ...(committed ? { committed } : {}),
    forecast: { state: 'ok', value: null },
    ties: {
      deck: deck === 'unreadable' ? { state: 'unreadable', value: null }
        : { state: 'ok', value: deck === 'none' ? { state: 'not_recorded', reason: 'No pitch deck is recorded.', synced_at: null, href: '/raise/pitch?project=3' }
          : { id: 1, version: 6, synced_at: deck === 'synced' ? '2026-11-03 10:00:00' : null, state: deck === 'synced' ? 'synced' : 'out_of_sync', href: '/raise/pitch?project=3' } },
      cap_table: cap === 'unreadable' ? { state: 'unreadable', value: null } : cap === 'none' ? { state: 'ok', value: null }
        : { state: 'ok', value: { id: 5, name: 'Seed scenario', rounds: [{ value: cap === 'differs' ? 200000000 : RAISE }] } },
    },
    needs_you: [],
  };
}
const COMMITTED_OK = { state: 'ok', source: 'Capital relationships', href: '/raise/capital-relationships/commitments?project_id=3', reason: null,
  value: { round_name: 'Seed', currency: 'usd', counted_cents: 65000000, target_cents: RAISE, amount_not_recorded: 0, remaining_cents: 85000000, received_cents: null, statuses: [{ status: 'confirmed', label: 'Confirmed', investors: 3 }] } };

/* ------------------------------------------------------------------ *
 * The model
 * ------------------------------------------------------------------ */

test('the header action: Set raise & allocation from Home\'s own read, and none where it cannot act', () => {
  assert.equal(SET_ACTION, 'Set raise & allocation');
  assert.equal(HOME_FRAME, 'What does this round buy us?');
  assert.deepEqual(homeAction({ status: 'ready', data: plan() }), { label: 'Set raise & allocation', dialog: 'split' });
  // A reload keeps the last read, so the action does not blink while it reads again.
  assert.deepEqual(homeAction({ status: 'loading', data: plan() }), { label: 'Set raise & allocation', dialog: 'split' });
  assert.equal(homeAction({ status: 'loading', data: null }), null, 'nothing before the plan reads');
  assert.equal(homeAction({ status: 'unreadable', data: null }), null, 'nothing over an unread plan');
  assert.equal(homeAction({ status: 'ready', data: plan({ viewer: { kind: 'founder', can_write: false, mercury: true } }) }), null, 'a read-only viewer is offered no write');
  assert.equal(homeAction({ status: 'ready', data: plan({ empty: true }) }), null, 'on first use the empty state\'s first action is the one primary');
  assert.equal(homeAction({ status: 'ready', data: { ...plan(), base: { state: 'unreadable', value: null } } }), null);
});

test('each dependency is marked Current, Stale, Unavailable or Not linked from the plan read', () => {
  const marks = (p) => Object.fromEntries(dependencyRows(p).map((r) => [r.key, r.word]));
  // All current: the same raise everywhere, the deck in sync, Mercury read, commitments read.
  assert.deepEqual(marks(plan({ committed: COMMITTED_OK })), { round: 'Current', committed: 'Current', cap: 'Current', deck: 'Current', mercury: 'Current' });
  // Stale: the record and the plan disagree, or the Ask slide is not marked in sync.
  assert.deepEqual(marks(plan({ round: 'differs', cap: 'differs', deck: 'stale', committed: COMMITTED_OK })), { round: 'Stale', committed: 'Current', cap: 'Stale', deck: 'Stale', mercury: 'Current' });
  // Unavailable: the block could not be read. A plan read without a committed block reads Unavailable (D6081).
  assert.deepEqual(marks(plan({ cap: 'unreadable', deck: 'unreadable', mercury: 'unreadable' })), { round: 'Current', committed: 'Unavailable', cap: 'Unavailable', deck: 'Unavailable', mercury: 'Unavailable' });
  // Not linked: nothing is recorded to depend on.
  const none = plan({ round: 'none', cap: 'none', deck: 'none', runway: 'none', committed: { state: 'not_recorded', reason: 'No active round.', href: '/raise/capital-relationships/commitments?project_id=3' } });
  assert.deepEqual(marks(none), { round: 'Not linked', committed: 'Not linked', cap: 'Not linked', deck: 'Not linked', mercury: 'Not linked' });
  assert.equal(dependencyRows(none).find((r) => r.key === 'committed').href, '/raise/capital-relationships/commitments?project_id=3');
  // A viewer the Worker refuses, and Mercury kept to the founder, say so rather than a figure.
  const admin = plan({ mercury: 'founder_only', runway: 'none', committed: { state: 'refused', reason: 'Commitments are read in Capital relationships by the venture’s founders.' } });
  assert.deepEqual([marks(admin).committed, marks(admin).mercury], ['Refused', 'Founder only']);
  // The words are RA-23's and nothing else; the cap-table row names both raises.
  assert.ok(dependencyRows(plan({ cap: 'differs' })).every((r) => Object.values(MARK).includes(r.word)));
  const cap = dependencyRows(plan({ cap: 'differs' })).find((r) => r.key === 'cap');
  assert.equal(cap.text, 'Seed scenario raises $2,000,000');
  assert.equal(cap.why, 'This plan raises $1,500,000.');
  assert.equal(dependencyRows(plan()).find((r) => r.key === 'deck').href, '/raise/pitch?project_id=3');
  assert.equal(dependencyRows(plan()).find((r) => r.key === 'mercury').why, 'Read 1 Nov 2026');
  // Readiness and a hiring plan are not in the plan read, so no row claims them (D5081's Worker follow-ups).
  assert.deepEqual(dependencyRows(plan()).map((r) => r.key), ['round', 'committed', 'cap', 'deck', 'mercury']);
});

test('runway recorded against modelled, the milestones funded, and the first-use actions', () => {
  const rows = runwayRows(plan());
  assert.deepEqual(rows.map((r) => [r.key, r.tag, r.value]), [['today', 'Recorded', '11 months'], ['after', 'Modelled', '24 months'], ['target', 'Typed', '24 months']]);
  const none = runwayRows(plan({ runway: 'none', mercury: 'founder_only', viewer: { kind: 'admin', can_write: true, mercury: false } }));
  assert.deepEqual([none[0].tag, none[0].value], ['Founder only', null], 'Founder only is a state, never a figure');
  assert.deepEqual(runwayRows(plan({ runway: 'none' }))[0].value, null, 'no measured runway is Not recorded, never the model');
  const funded = milestonesFunded(plan().base.value);
  assert.deepEqual(funded.map((m) => [m.label, m.section, m.by, m.state]), [
    ['Launch self-serve tier', 'Product & engineering', '2027-04', 'Funded'],
    ['$1m ARR', 'GTM: sales and marketing', '2027-10', 'At risk'],
    ['EU entity', 'Operations, legal & compliance', null, 'Not costed'],
  ]);
  assert.deepEqual(milestonesFunded({ milestones: [{ id: 7, category_key: 'reserve', label: 'Hire 3' }] })[0].state, null, 'no model, no word');
  // First use: one to three actions, each one the read can back.
  const first = plan({ empty: true, runway: 'none', committed: { state: 'not_recorded', href: '/raise/capital-relationships/commitments?project_id=3' } });
  assert.deepEqual(setupActions(first).map((a) => a.text), ['Set raise & allocation', 'Connect Mercury', 'Open Commitments']);
  assert.deepEqual(setupActions(plan({ empty: true })).map((a) => a.key), ['split'], 'runway measured and commitments unread: one action');
  // A viewer the Worker's map gives no `edit` (a support session) is offered no write, and no Mercury of its own (D5074).
  const readOnly = { kind: 'founder', can_write: false, mercury: true };
  assert.deepEqual(setupActions({ ...first, viewer: readOnly, capabilities: capsForViewer(readOnly) }).map((a) => a.key), ['round'], 'no write for a read-only viewer');
  assert.ok(setupActions(first).length <= 3);
});

/* ------------------------------------------------------------------ *
 * Mounted
 * ------------------------------------------------------------------ */

const MODULE = {
  module: { slug: 'use-of-funds', name: 'Use of funds', records_title: 'Categories' },
  card: { state: 'ok', name: 'Use of funds', caption: 'Next 18 months', series: [{ kind: 'rows', items: [{ label: 'Cash over 18 months', value: null }] }], next: { text: 'Edit split', href: '/raise/use-of-funds/new' } },
  records: { linkable: true, total: 1, page: 1, page_size: 25, cols: [{ key: 'category', label: 'Category' }], rows: [{ id: 'product', cells: { category: 'Product & engineering' } }], add: { text: 'Edit split', href: '/raise/use-of-funds/new' } },
};

async function mounted(url, { phone = false, read: p = plan(), slugModule = MODULE } = {}) {
  const restore = installDocument();
  const previous = { fetch: globalThis.fetch, matchMedia: globalThis.matchMedia };
  const sent = [];
  globalThis.fetch = async (u, o = {}) => {
    const path = String(u).replace(/^.*\/api/, '');
    sent.push(`${o.method || 'GET'} ${path}`);
    if (/^\/projects(\?|$)/.test(path)) return response([{ id: 3, uid: 'p3uid', name: 'Harbor Ledger' }]);
    if (path.startsWith('/cycles/raise/use-of-funds/plan')) return p ? response(p) : response({ detail: 'down' }, 503);
    if (path.startsWith('/cycles/raise/use-of-funds/history')) return response({ page: 1, page_size: 20, total: 0, items: [] });
    if (path.startsWith('/cycles/raise/modules/')) return response(slugModule);
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
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const pr = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const txt = (n) => (n?.nodeType === 3 ? n.textContent : n?.childNodes?.length ? n.childNodes.map(txt).join(' ') : n?.textContent || '');
  const by = (id) => walk(container).find((n) => pr(n)['data-testid'] === id);
  return {
    sent, by, pr,
    all: (id) => walk(container).filter((n) => pr(n)['data-testid'] === id),
    text: (id) => { if (id) assert.ok(by(id), `no ${id}`); return txt(id ? by(id) : container).replace(/\s+/g, ' ').trim(); },
    async click(id) { const n = by(id); assert.ok(n, `no ${id}`); await act(async () => pr(n).onClick?.({ preventDefault() {}, stopPropagation() {} })); await flush(); },
    async close() { await act(async () => root.unmount()); Object.assign(globalThis, previous); restore(); },
  };
}

test('RA-14: Home owns the page; the generic at a glance, forecast door and Categories table are not drawn under it', async () => {
  const v = await mounted('/raise/use-of-funds?project_id=3', { read: plan({ committed: COMMITTED_OK }) });
  try {
    assert.ok(v.by('uof-home') && v.by('uof-tabs'));
    assert.ok(v.by('cycle-module'), 'still the module page, at the same address');
    for (const id of ['cycle-module-chart', 'cycle-records', 'cycle-module-tool', 'records-add']) assert.equal(v.by(id), undefined, `${id} is not drawn under the tool`);
    assert.doesNotMatch(v.text(), /Use of funds · at a glance|Categories|Open the forecast|Records below/);
    assert.ok(v.text('cycle-header').includes(HOME_FRAME), 'the header says what Home answers');
    assert.ok(v.text('uof-money').startsWith('What the raise buys'));
    // RA-21 A: runway recorded against modelled, the dependencies marked, the milestones funded.
    assert.equal(v.text('uof-runway-today-value'), '11 months');
    assert.equal(v.text('uof-runway-after-value'), '24 months');
    assert.deepEqual(['round', 'committed', 'cap', 'deck', 'mercury'].map((k) => v.text(`uof-dep-${k}`)), ['Current', 'Current', 'Current', 'Current', 'Current']);
    assert.equal(v.all('uof-funded-row').length, 3);
    // The cash card says what it knows: no shipped "not modelled yet" line.
    assert.ok(v.text('uof-cash').includes('Without the raise, cash lasts as long as runway today: 11 months.'));
    // D6081 is reused: Remaining beside a read Committed.
    assert.ok(v.text('uof-remaining').includes('remaining $850,000'));
  } finally { await v.close(); }
});

test('RA-14 is this tool only: another Raise module keeps its generic layer', async () => {
  // D6049 (#6049) gave Fundraising readiness a Home of its own, so the module that keeps the generic layer here is Pitch deck.
  const other = { module: { slug: 'pitch-deck', name: 'Pitch deck' }, card: { state: 'empty', reason: 'Not recorded.' }, records: { total: 0, page: 1, page_size: 25, cols: [{ key: 'title', label: 'Title' }], rows: [] } };
  const v = await mounted('/raise/pitch-deck?project_id=3', { slugModule: other });
  try {
    assert.ok(v.by('cycle-module-chart'), 'its at a glance stays');
    assert.equal(v.by('uof-home'), undefined);
    assert.equal(v.text('cycle-action'), 'Build your deck', 'its primary is unchanged here');
    assert.ok(!v.sent.some((s) => s.includes('/use-of-funds/plan')), 'no Use of funds read off its page');
  } finally { await v.close(); }
});

test('the contextual action: Set raise & allocation opens Edit split on Home, opens Allocation from a tab, and is never Build your deck', async () => {
  let v = await mounted('/raise/use-of-funds?project_id=3');
  try {
    assert.equal(v.text('cycle-action'), 'Set raise & allocation');
    assert.equal(v.by('uof-edit-split'), undefined);
    await v.click('cycle-action');
    assert.ok(v.by('uof-edit-split'), 'it opens Edit split in place');
    assert.equal(v.sent.filter((s) => s.startsWith('GET /cycles/raise/use-of-funds/plan')).length, 1, 'the header and Home share one plan read');
  } finally { await v.close(); }
  v = await mounted('/raise/use-of-funds/runway?project_id=3');
  try {
    assert.equal(v.text('cycle-action'), 'Set raise & allocation');
    assert.equal(v.pr(v.by('cycle-action')).href, '/raise/use-of-funds/allocation?project_id=3');
  } finally { await v.close(); }
  v = await mounted('/raise/use-of-funds/allocation?project_id=3');
  try {
    assert.equal(v.by('cycle-action'), undefined, 'on Allocation its own Edit split is the action');
    assert.ok(v.by('uof-edit-split-open'));
  } finally { await v.close(); }
  v = await mounted('/raise/use-of-funds?project_id=3', { read: plan({ viewer: { kind: 'founder', can_write: false, mercury: true } }) });
  try {
    assert.equal(v.by('cycle-action'), undefined, 'a read-only viewer is offered no write');
    assert.equal(v.by('uof-edit-split-open'), undefined);
  } finally { await v.close(); }
  v = await mounted('/raise/use-of-funds?project_id=3', { read: null });
  try {
    assert.equal(v.by('cycle-action'), undefined, 'nothing to act on over an unread plan');
    assert.ok(v.by('uof-home-unreadable'));
  } finally { await v.close(); }
  const src = read('frontend/src/pages/cycles/defs/raise.jsx');
  assert.match(src, /'use-of-funds': \(q\) => \(\{ label: SET_ACTION, href: `\$\{HOME_PATH\}\/allocation\$\{tabSearch\(q\)\}` \}\)/);
});

test('first use collapses to its set-up actions; the empty state leads, so the header gives way', async () => {
  const v = await mounted('/raise/use-of-funds?project_id=3', { read: plan({ empty: true, round: 'none', runway: 'none', committed: { state: 'not_recorded', href: '/raise/capital-relationships/commitments?project_id=3' } }) });
  try {
    assert.ok(v.by('uof-empty'));
    assert.deepEqual(['split', 'mercury', 'round'].map((k) => v.text(`uof-setup-${k}`)), ['Set raise & allocation', 'Connect Mercury', 'Open Commitments']);
    assert.equal(v.pr(v.by('uof-setup-mercury')).href, '/account/connectors/mercury');
    for (const id of ['uof-tiles', 'uof-money', 'uof-cash', 'uof-ties', 'uof-runway-compare', 'uof-funded', 'cycle-action', 'cycle-module-chart', 'cycle-records']) assert.equal(v.by(id), undefined, `${id} waits for a split`);
    await v.click('uof-setup-split');
    assert.ok(v.by('uof-edit-split'), 'the first action opens Edit split');
  } finally { await v.close(); }
});

test('390: the phone draws Home with its action full width, and none of the generic phone layer', async () => {
  const v = await mounted('/raise/use-of-funds?project_id=3', { phone: true });
  try {
    assert.ok(v.by('phone-module') && v.by('uof-home'));
    for (const id of ['phone-module-chart', 'phone-module-next', 'phone-module-records', 'phone-module-tool', 'cycle-action']) assert.equal(v.by(id), undefined, `${id} is not drawn`);
    assert.equal(v.text('uof-edit-split-open'), 'Set raise & allocation');
    assert.match(v.pr(v.by('uof-edit-split-open')).className, /max-md:flex-1/, 'full width on a phone');
    assert.ok(v.by('uof-runway-compare'), 'runway recorded against modelled is on the phone (RA-26 C)');
    await v.click('uof-edit-split-open');
    assert.ok(v.by('uof-edit-split'));
  } finally { await v.close(); }
  // Wide tables scroll inside their own box, never the page.
  const tool = read('frontend/src/pages/raise/useoffunds/UseOfFundsTool.jsx');
  const funded = tool.slice(tool.indexOf('function MilestonesFundedCard'), tool.indexOf('function FirstUse'));
  assert.match(funded, /overflow-x-auto[\s\S]*min-w-\[420px\]/);
});

test('no shipped implementation-stage copy on the tool', () => {
  const src = ['UseOfFundsTool.jsx', 'UseOfFundsParts.jsx', 'ScenariosForecast.jsx'].map((f) => read(`frontend/src/pages/raise/useoffunds/${f}`)).join('\n');
  const shipped = src.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*\*)/.test(l)).join('\n');
  assert.doesNotMatch(shipped, /Not read here yet|not modelled yet|coming soon/i);
});
