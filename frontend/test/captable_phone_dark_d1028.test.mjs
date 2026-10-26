// D1028 (#2865, part 13 of #2432) — the Cap table tool on a phone (CT23a–c)
// and in dark (CT8). Every page is mounted under CycleRoute at phone width
// (`matchMedia` matching PHONE_QUERY, below 1024px) and, where the layout
// differs, at desktop width too. Fixtures follow the Worker's shapes
// (services/capTableRecord.ts, routes/captable.ts) and are worked out by hand.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import CycleRoute from '../src/pages/cycles/CycleRoute.jsx';
import { AuthProvider } from '../src/hooks/useAuthSync.jsx';
import { DARK, PHONE_HOLDERS, PHONE_ROOT } from '../src/pages/raise/captable/capTableModel.js';
import { holderCards, whoOwns } from '../src/pages/raise/captable/overviewModel.js';
import { compareRows, exitTable, swipeCards } from '../src/pages/raise/captable/scenariosModel.js';

const h = React.createElement;
const DIR = new URL('../src/pages/raise/captable/', import.meta.url);
const read = (name) => readFileSync(new URL(name, DIR), 'utf8');
const response = (body, status = 200) => ({ ok: status < 400, status, headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body) });

// ─────────────────────────────────────────────────────────── fixtures

const CLASSES = [
  { uid: 'c1', name: 'Common', kind: 'common', authorized_shares: 15000000, price_per_share_micros: 100, liquidation_multiple_bps: 10000, participating: false, conversion_ratio: 1 },
  { uid: 'c2', name: 'Series Seed Preferred', kind: 'preferred', authorized_shares: 4000000, price_per_share_micros: 1030000, liquidation_multiple_bps: 10000, participating: false, conversion_ratio: 1 },
  { uid: 'c3', name: 'Options', kind: 'option_pool', authorized_shares: 1500000, price_per_share_micros: null, liquidation_multiple_bps: 10000, participating: false, conversion_ratio: 1 },
];
const iss = (o) => ({ status: 'recorded', source: 'typed', origin: 'owner', from_holder: null, class_uid: null, shares: null, amount_cents: null, currency: 'USD', price_per_share_micros: null, issued_on: null, terms: {}, document_ref: null, correction_reason: null, void_reason: null, recorded_at: null, created_at: '2026-10-01 10:00:00', ...o });
// Outstanding 9,150,000 (common 8,150,000 + preferred 1,000,000); fully
// diluted 10,650,000 (+ 300,000 granted options + 1,200,000 unallocated).
// Seven cards fully diluted: one more than a phone shows before "Show more".
const RECORD = {
  project_id: 3,
  currency: { code: 'USD', source: 'default' },
  classes: { available: true, reason: null, rows: CLASSES },
  by_holder: { available: true, reason: null, rows: [
    { holder_id: 12, name: 'Founder A', kind: 'founder', shares: 4400000, options: 0, by_class: [{ class_uid: 'c1', shares: 4400000 }] },
    { holder_id: 13, name: 'Founder B', kind: 'founder', shares: 3600000, options: 0, by_class: [{ class_uid: 'c1', shares: 3600000 }] },
    { holder_id: 14, name: 'Bluefern Capital', kind: null, shares: 1000000, options: 0, by_class: [{ class_uid: 'c2', shares: 1000000 }] },
    { holder_id: 15, name: 'Jo Rivera', kind: 'employee', shares: 0, options: 300000, by_class: [{ class_uid: 'c3', shares: 300000 }] },
    { holder_id: null, name: 'Harbor Angel', kind: null, shares: 100000, options: 0, by_class: [{ class_uid: 'c1', shares: 100000 }] },
    { holder_id: 17, name: 'Second Angel', kind: null, shares: 50000, options: 0, by_class: [{ class_uid: 'c1', shares: 50000 }] },
  ] },
  by_class: { available: true, reason: null, rows: [
    { ...CLASSES[0], issued: 8150000, options_granted: null, options_exercised: null, unallocated: null },
    { ...CLASSES[1], issued: 1000000, options_granted: null, options_exercised: null, unallocated: null },
    { ...CLASSES[2], issued: null, options_granted: 300000, options_exercised: 0, unallocated: 1200000 },
  ] },
  outstanding: { available: true, reason: null, shares: 9150000, common: 8150000, preferred: 1000000 },
  fully_diluted: { available: true, reason: null, shares: 10650000, outstanding: 9150000, options_granted: 300000, unallocated_pool: 1200000, pool_recorded: true },
  instruments: { available: true, reason: null, rows: [
    iss({ uid: 'i9', kind: 'safe', holder: { holder_id: null, name: 'Northwind Angels' }, amount_cents: 15000000, terms: { cap_cents: 1000000000, basis: 'post_money' }, source: 'connector_mercury', origin: 'mercury' }),
  ] },
  issuances: { available: true, reason: null, rows: [
    iss({ uid: 'i1', kind: 'founding', holder: { holder_id: 12, name: 'Founder A' }, class_uid: 'c1', shares: 4400000, issued_on: '2025-01-03', source: 'signed', document_ref: 'legal_documents:4', recorded_at: '2025-01-03 10:00:00' }),
    iss({ uid: 'i2', kind: 'founding', holder: { holder_id: 13, name: 'Founder B' }, class_uid: 'c1', shares: 3600000, issued_on: '2025-01-03', source: 'signed', recorded_at: '2025-01-03 10:00:00' }),
    iss({ uid: 'i3', kind: 'priced', holder: { holder_id: 14, name: 'Bluefern Capital' }, class_uid: 'c2', shares: 1000000, price_per_share_micros: 1030000, issued_on: '2026-06-03', source: 'document', recorded_at: '2026-06-04 09:00:00' }),
    iss({ uid: 'i5', kind: 'grant', holder: { holder_id: 15, name: 'Jo Rivera' }, class_uid: 'c3', shares: 300000, issued_on: '2026-02-02', recorded_at: '2026-10-12 08:00:00' }),
    iss({ uid: 'i6', kind: 'founding', holder: { holder_id: null, name: 'Harbor Angel' }, class_uid: 'c1', shares: 100000, issued_on: '2025-05-01', recorded_at: '2025-05-01 10:00:00' }),
    iss({ uid: 'i7', kind: 'founding', holder: { holder_id: 17, name: 'Second Angel' }, class_uid: 'c1', shares: 50000, issued_on: '2025-06-01', recorded_at: '2025-06-01 10:00:00' }),
  ] },
  proposals: { available: true, reason: null, rows: [
    iss({ uid: 'p1', status: 'proposed', kind: 'safe', origin: 'mercury', source: 'connector_mercury', holder: { holder_id: null, name: 'Harbor Seed Fund' }, amount_cents: 25000000, terms: { cap_cents: 800000000, basis: 'post_money' }, created_at: '2026-10-20 10:00:00' }),
  ] },
};

// The compare page's fixtures, as D1024's suite has them: 9,000,000 shares on record.
const FOUNDING = [
  { holder: 'Ada Founder', type: 'founder', shares: 6000000, pct: 66.6667 },
  { holder: 'Ben Cofounder', type: 'founder', shares: 2000000, pct: 22.2222 },
  { holder: 'Kai Engineer', type: 'options', shares: 300000, pct: 3.3333 },
  { holder: 'Option pool', type: 'option_pool', shares: 700000, pct: 7.7778 },
];
const SEED_LEDGER = [
  { holder: 'Ada Founder', type: 'founder', shares: 6000000, pct: 46.1538 },
  { holder: 'Ben Cofounder', type: 'founder', shares: 2000000, pct: 15.3846 },
  { holder: 'Kai Engineer', type: 'options', shares: 300000, pct: 2.3077 },
  { holder: 'Option pool', type: 'option_pool', shares: 1000000, pct: 7.6923 },
  { holder: 'Bluefern Capital', type: 'safe', shares: 600000, pct: 4.6154 },
  { holder: 'Northwind Angels', type: 'safe', shares: 300000, pct: 2.3077 },
  { holder: 'Seed Investors', type: 'preferred', shares: 2800000, pct: 21.5385 },
];
const row = (holder, type, shares, payout, source, preference = 0) => ({ holder, type, shares, pct: 0, preference, payout, source });
const WF_5M = { exit_value: 5000000, rows: [
  row('Seed Investors', 'preferred', 2800000, 3000000, '1x non-participating preference', 3000000),
  row('Bluefern Capital', 'safe', 600000, 500000, '1x non-participating preference', 500000),
  row('Northwind Angels', 'safe', 300000, 150000, '1x non-participating preference', 150000),
  row('Ada Founder', 'founder', 6000000, 975903.61, 'pro-rata (common)'),
  row('Ben Cofounder', 'founder', 2000000, 325301.2, 'pro-rata (common)'),
  row('Kai Engineer', 'options', 300000, 48795.19, 'pro-rata (common)'),
], totals: { total_distributed: 5000000 } };
const WF_100M = { exit_value: 100000000, rows: [
  row('Ada Founder', 'founder', 6000000, 50000000, 'pro-rata (common)'),
  row('Seed Investors', 'preferred', 2800000, 23333333.33, 'pro-rata (converted preferred)', 3000000),
  row('Ben Cofounder', 'founder', 2000000, 16666666.67, 'pro-rata (common)'),
  row('Bluefern Capital', 'safe', 600000, 5000000, 'pro-rata (converted preferred)', 500000),
  row('Kai Engineer', 'options', 300000, 2500000, 'pro-rata (common)'),
  row('Northwind Angels', 'safe', 300000, 2500000, 'pro-rata (converted preferred)', 150000),
], totals: { total_distributed: 100000000 } };
const SEED = {
  name: 'Seed', pre_money: 12000000, post_money: 15000000, investment: 3000000, price_per_share: 1.0714, ledger: SEED_LEDGER, events: [],
  conversions: [{ name: 'Bluefern Capital', instrument: 'safe', shares: 600000, price_per_share: 0.8333 }, { name: 'Northwind Angels', instrument: 'safe', shares: 300000, price_per_share: 0.5 }],
};
const RESULT = { founding: FOUNDING, rounds: [SEED], waterfalls: [{ exit_value: 5000000, waterfall: WF_5M }, { exit_value: 100000000, waterfall: WF_100M }], warnings: [] };
const START = { holders: [{ name: 'Ada Founder', type: 'common', shares: 6000000 }, { name: 'Ben Cofounder', type: 'common', shares: 2000000 }, { name: 'Kai Engineer', type: 'options', shares: 300000 }], pool_shares: 700000 };
const TODAY = {
  project_id: 3, currency: 'USD',
  today: { available: true, reason: null, source: 'record', inputs: { start: START, safes: [] }, result: { founding: FOUNDING, rounds: [], warnings: [] }, not_modelled: [] },
  model: null, assumptions: ['1× non-participating preferred.', 'The unallocated pool takes no proceeds.'],
};
const S_TODAY = { uid: 's-today', name: 'Seed · base case', is_variant: 1, project_id: 3, inputs: { start: START, safes: [], rounds: [{ name: 'Seed', pre_money: 12000000, investment: 3000000 }], exit_values: [5000000, 100000000] }, result: RESULT };
const S_MODEL = {
  uid: 's-model', name: 'Typed bridge', is_variant: 1, project_id: 3,
  inputs: { founders: [{ name: 'Ada Founder', shares: 4000000 }, { name: 'Grace', shares: 4000000 }], option_pool_pct: 10, safes: [], rounds: [{ name: 'Bridge', pre_money: 6000000, investment: 1000000 }], exit_value: 30000000 },
};
const MODEL_RESULT = {
  founding: [{ holder: 'Ada Founder', type: 'founder', shares: 4000000, pct: 45 }, { holder: 'Grace', type: 'founder', shares: 4000000, pct: 45 }],
  rounds: [{ ...SEED, name: 'Bridge', pre_money: 6000000, post_money: 7000000, investment: 1000000, conversions: [], ledger: [
    { holder: 'Ada Founder', type: 'founder', shares: 4000000, pct: 38.57 }, { holder: 'Grace', type: 'founder', shares: 4000000, pct: 38.57 },
    { holder: 'Option pool', type: 'option_pool', shares: 888889, pct: 8.57 }, { holder: 'Bridge Investors', type: 'preferred', shares: 1481481, pct: 14.29 },
  ] }],
  waterfalls: [{ exit_value: 5000000, waterfall: null }, { exit_value: 30000000, waterfall: { exit_value: 30000000, rows: [
    row('Ada Founder', 'founder', 4000000, 12000000, 'pro-rata (common)'), row('Grace', 'founder', 4000000, 12000000, 'pro-rata (common)'),
    row('Bridge Investors', 'preferred', 1481481, 6000000, 'pro-rata (converted preferred)', 1000000),
  ], totals: { total_distributed: 30000000 } } }, { exit_value: 100000000, waterfall: null }],
  warnings: [],
};

const GRANTS = { grants: [], can_change: true, levels: {} };
const MODULE = { module: { slug: 'cap-table', name: 'Cap table', records_title: 'Holders' }, card: { state: 'empty', reason: 'No holders yet.' }, records: { cols: [], rows: [], total: 0, page: 1, page_size: 25 } };
const OWNER = { id: 2, role: 'founder', founder_id: 20, subscription_tier: 'studio', name: 'Synthetic Founder' };

function handlerFor() {
  return (url, options = {}) => {
    const method = options.method || 'GET';
    if (url.includes('/captable/scenarios/by-project/3/simulate')) return response({ source: 'record', result: RESULT });
    if (url.includes('/captable/scenarios/by-project/3/today')) return response(TODAY);
    if (url.includes('/captable/scenarios/by-project/3/compare')) return response({ canonical: null, variants: [S_TODAY, S_MODEL] });
    if (/\/captable\/simulate$/.test(url)) return response(MODEL_RESULT);
    const one = /\/captable\/scenarios\/([^/?]+)$/.exec(url);
    if (one && method === 'GET') return { 's-today': true, 's-model': true }[one[1]] ? response(one[1] === 's-today' ? S_TODAY : S_MODEL) : response({ detail: 'Scenario not found' }, 404);
    if (url.includes('/captable/record/3')) return response(RECORD);
    if (url.includes('/captable/access/3/grants')) return response(GRANTS);
    if (url.includes('/cycles/raise/modules/')) return response(MODULE);
    if (url.includes('/auth/me')) return response(OWNER);
    // Anything else answers as refused: each block says so alone, and the page still draws.
    return response({ detail: 'Not found' }, 404);
  };
}

/** The tool under CycleRoute; `phone` makes every `matchMedia` match, as below 1024px. */
async function mounted(url, { phone = true } = {}) {
  const restore = installDocument();
  const previous = { fetch: globalThis.fetch, matchMedia: globalThis.matchMedia };
  const handle = handlerFor();
  globalThis.fetch = async (u, options = {}) => handle(String(u), options);
  globalThis.matchMedia = () => ({ matches: phone, addEventListener() {}, removeEventListener() {} });
  localStorage.setItem('user', JSON.stringify(OWNER));
  const create = document.createElement.bind(document);
  document.createElement = (tag) => { const node = create(tag); node.querySelector = () => null; node.querySelectorAll = () => []; node.focus = () => {}; node.children = []; return node; };
  document.body.style = { overflow: 'auto', paddingRight: '' };
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => root.render(h(MemoryRouter, { initialEntries: [url] }, h(AuthProvider, null, h(Routes, null,
    h(Route, { path: '/raise/cap-table/proposal/:proposal', element: h(CycleRoute, { cycle: 'raise', slug: 'cap-table', capTableProposal: true }) }),
    h(Route, { path: '/raise/cap-table/instrument/:instrument', element: h(CycleRoute, { cycle: 'raise', slug: 'cap-table', capTableProposal: true }) }),
    h(Route, { path: '/raise/cap-table/scenarios/:scenario', element: h(CycleRoute, { cycle: 'raise', slug: 'cap-table', capTableScenario: true }) }),
    h(Route, { path: '/raise/:slug', element: h(CycleRoute, { cycle: 'raise' }) }),
    h(Route, { path: '/raise/:slug/new', element: h(CycleRoute, { cycle: 'raise', adding: true }) }),
    h(Route, { path: '/raise/:slug/:id', element: h(CycleRoute, { cycle: 'raise', record: true }) }),
  )))));
  const flush = () => act(async () => { for (let i = 0; i < 12; i += 1) await new Promise((r) => setTimeout(r, 0)); });
  await flush();
  const nodes = () => { const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)]; return walk(container); };
  const text = (n) => (n?.nodeType === 3 ? n.textContent : n?.childNodes?.length ? n.childNodes.map(text).join(' ') : n?.textContent || '');
  const props = (n) => Object.entries(n).find(([key]) => key.startsWith('__reactProps$'))?.[1] || {};
  const all = (id) => nodes().filter((n) => props(n)['data-testid'] === id);
  const by = (id) => all(id)[0];
  return {
    by, all, props, nodes,
    count: (id) => all(id).length,
    text: (...a) => { const n = a.length ? a[0] : container; assert.ok(n, 'no such node'); return text(n).replace(/\s+/g, ' ').trim(); },
    ids: () => nodes().map((n) => props(n)['data-testid']).filter(Boolean),
    cls: (n) => { assert.ok(n, 'no such node'); return String(props(n).className || ''); },
    /** The nearest ancestor (or the node) carrying `PHONE_ROOT`, which is where the 44px rule applies. */
    underPhoneRoot: (n) => { for (let p = n; p; p = p.parentNode) if (String(props(p).className || '').split(/\s+/).includes(PHONE_ROOT)) return true; return false; },
    sheets: () => nodes().filter((n) => props(n)['data-phone'] === 'sheet'),
    async press(node) { assert.ok(node, 'no such node'); await act(async () => { await props(node).onClick?.({ preventDefault() {}, stopPropagation() {} }); }); await flush(); },
    async close() { await act(async () => root.unmount()); Object.assign(globalThis, previous); restore(); },
  };
}

const hasClass = (cls, c) => cls.split(/\s+/).includes(c);

// ─────────────────────────────────────────────────────────── pure

test('CT23a: Who owns as cards, the share by the switch, six before Show more', () => {
  const fd = holderCards(whoOwns(RECORD, 'fd'), 'fd', PHONE_HOLDERS);
  assert.equal(fd.total, 7, 'six holders and the unallocated pool');
  assert.equal(fd.cards.length, 6);
  assert.equal(fd.foot, '1–6 of 7');
  assert.equal(fd.more, true);
  assert.equal(fd.label, '% fully diluted');
  assert.deepEqual(fd.cards.map((c) => [c.name, c.pill, c.line, c.value]), [
    ['Founder A', 'Founders', 'Common · 4,400,000 shares', '41.31%'],
    ['Founder B', 'Founders', 'Common · 3,600,000 shares', '33.80%'],
    ['Bluefern Capital', 'Investors', 'Series Seed Preferred · 1,000,000 shares', '9.39%'],
    ['Jo Rivera', 'Employees and advisors', 'Options · 300,000 options', '2.82%'],
    ['Harbor Angel', 'Other holders', 'Common · 100,000 shares', '0.94%'],
    ['Second Angel', 'Other holders', 'Common · 50,000 shares', '0.47%'],
  ]);
  assert.equal(fd.cards[0].href, '/raise/cap-table/h-12');
  assert.equal(fd.cards[4].href, null, 'a holder with no id has no page to open');
  const all = holderCards(whoOwns(RECORD, 'fd'), 'fd');
  assert.deepEqual([all.cards.length, all.more, all.cards[6].name, all.cards[6].line, all.cards[6].value], [7, false, 'Options · unallocated', 'Options · 1,200,000 options', '11.27%']);
  const out = holderCards(whoOwns(RECORD, 'out'), 'out', PHONE_HOLDERS);
  assert.equal(out.label, '% outstanding');
  assert.deepEqual(out.cards.map((c) => [c.name, c.value]), [['Founder A', '48.09%'], ['Founder B', '39.34%'], ['Bluefern Capital', '10.93%'], ['Harbor Angel', '1.09%'], ['Second Angel', '0.55%']],
    'outstanding leaves options and the pool out');
  assert.deepEqual([out.foot, out.more], ['1–5 of 5', false]);
  const none = holderCards(whoOwns({ by_holder: { available: false, reason: 'nothing_recorded', sentence: 'No issuance of shares is on record yet.' } }), 'fd', 6);
  assert.deepEqual([none.available, none.sentence, none.cards.length], [false, 'No issuance of shares is on record yet.', 0]);
});

test('CT23c: one scenario a card, a share as Today → after, a figure Today lacks alone; each exit as a table, never $0', () => {
  const cols = [
    { name: 'Seed · base case', result: RESULT, status: 'ready' },
    { name: 'Typed bridge', result: MODEL_RESULT, status: 'ready' },
  ];
  const cards = swipeCards(compareRows(TODAY.today.result, cols), cols);
  assert.deepEqual(cards.map((c) => [c.name, c.meta]), [['Seed · base case', '1 of 2 · swipe ›'], ['Typed bridge', '2 of 2 · swipe ›']]);
  const at = (c, label) => c.rows.find((r) => r.label === label)?.value;
  assert.equal(at(cards[0], 'Founders'), '88.89% → 61.54%');
  assert.equal(at(cards[1], 'Founders'), '88.89% → 77.14%');
  assert.equal(at(cards[0], 'Price per share'), '$1.0714', 'Today has no price, so the figure reads alone');
  assert.equal(at(cards[0], 'Post-money'), '$15,000,000');
  assert.equal(at(cards[0], 'Bluefern Capital · shares'), '600,000');
  assert.equal(at(cards[1], 'Bluefern Capital · shares'), 'Not converted');
  assert.equal(swipeCards(compareRows(null, cols.slice(0, 1)), cols.slice(0, 1))[0].meta, '1 of 1', 'one scenario has nothing to swipe');
  const reading = swipeCards(compareRows(TODAY.today.result, [{ name: 'Slow', result: null, status: 'loading' }]), [{ name: 'Slow', status: 'loading' }]);
  assert.equal(at(reading[0], 'Founders'), 'Reading…', 'a run still reading never draws an arrow');

  const t = exitTable(cols[0], [5000000, 30000000, 100000000]);
  assert.deepEqual(t.head, ['Exit', 'Founders', 'Investors', 'Employees and advisors']);
  assert.deepEqual(t.rows.map((r) => r.cells), [
    ['$5,000,000', '$1,301,204.81', '$3,650,000', '$48,795.19'],
    ['$30,000,000', 'Not recorded', 'Not recorded', 'Not recorded'],
    ['$100,000,000', '$66,666,666.67', '$30,833,333.33', '$2,500,000'],
  ]);
  assert.deepEqual(exitTable(cols[1], [5000000, 30000000]).rows.map((r) => r.cells), [
    ['$5,000,000', 'Not recorded', 'Not recorded', 'Not recorded'],
    ['$30,000,000', '$24,000,000', '$6,000,000', '$0'],
  ], 'an exit the engine did not calculate is never $0; one it calculated with no employees is');
  assert.deepEqual(exitTable(undefined, [5000000]).rows[0].cells, ['$5,000,000', 'Not recorded', 'Not recorded', 'Not recorded']);
});

// ─────────────────────────────────────────────────────────── CT23a: Overview

test('CT23a at phone width: the one action fills its row, then the switch, the group bar and the holders as cards', async () => {
  const v = await mounted('/raise/cap-table?project_id=3');
  try {
    assert.ok(v.by('phone-module'), 'CycleRoute\'s phone module page, its bar and Module select');
    assert.ok(hasClass(v.cls(v.by('captable-home')), PHONE_ROOT), 'every control under it is a 44px target');
    assert.ok(v.by('captable-tabs'));
    assert.ok(v.by('captable-phone-overview'));
    assert.ok(hasClass(v.cls(v.by('captable-record')), 'flex-1') && hasClass(v.cls(v.by('captable-toolbar-actions')), 'w-full'), 'Record an issuance fills the row');
    assert.ok(v.by('captable-show') && v.by('captable-basis') && v.by('captable-bars'));
    assert.equal(v.count('captable-who-owns'), 0, 'no table of holders on a phone');
    assert.equal(v.count('captable-holder-card'), 6);
    assert.equal(v.text(v.by('captable-holder-cards-foot')), '1–6 of 7 Show more');
    assert.match(v.text(v.all('captable-holder-card')[0]), /^Founders Founder A Common · 4,400,000 shares 41\.31%$/);
    assert.equal(v.props(v.all('captable-holder-card-link')[0]).href, '/raise/cap-table/h-12?project_id=3', 'a card opens its holder');
    assert.equal(v.count('captable-bars'), 1, 'the group bar is drawn once, not again in the side column');
    assert.ok(v.by('captable-tiles') && v.by('captable-instruments') && v.by('captable-409a-line'), 'the rest of the side column follows');
    await v.press(v.by('captable-holder-cards-more'));
    assert.equal(v.count('captable-holder-card'), 7);
    assert.equal(v.count('captable-holder-cards-more'), 0);
    await v.press(v.by('captable-basis-out'));
    assert.equal(v.count('captable-holder-card'), 5, 'Outstanding leaves options and the pool out');
    assert.match(v.text(v.all('captable-holder-card')[0]), /48\.09%$/);
    await v.press(v.by('captable-view-class'));
    assert.ok(v.by('captable-by-class') && v.count('captable-holder-card') === 0, 'By class keeps its table');
  } finally { await v.close(); }
});

test('CT23a at desktop width: the table, the side column with its bars, and no phone class', async () => {
  const v = await mounted('/raise/cap-table?project_id=3', { phone: false });
  try {
    assert.ok(!hasClass(v.cls(v.by('captable-home')), PHONE_ROOT));
    assert.ok(v.by('captable-who-owns'));
    assert.equal(v.count('captable-holder-card'), 0);
    assert.equal(v.count('captable-phone-overview'), 0);
    assert.equal(v.count('captable-bars'), 1);
    assert.ok(!hasClass(v.cls(v.by('captable-record')), 'flex-1'));
  } finally { await v.close(); }
});

// ─────────────────────────────────────────────────────────── CT23b: a holder

test('CT23b at phone width: a holder is a page of its own, under the bar back to the Cap table', async () => {
  const v = await mounted('/raise/cap-table/h-12?project_id=3');
  try {
    assert.ok(hasClass(v.cls(v.by('captable-holder-page')), PHONE_ROOT));
    assert.ok(v.by('captable-holder-full'));
    assert.ok(v.by('captable-holder-drawer-page'), 'the drawer drawn as a page, not over Overview');
    assert.equal(v.count('captable-holder-drawer-layer'), 0, 'no dialog layer');
    for (const id of ['captable-tabs', 'captable-toolbar', 'captable-phone-overview', 'captable-who-owns']) assert.equal(v.count(id), 0, `${id} is not drawn behind the holder`);
    assert.match(v.text(v.by('cycle-bar')), /Cap table.*Founder A/, 'Back names the Cap table; the title is the holder');
    assert.match(v.text(v.by('captable-holder-pct')), /% fully diluted 41\.31%/);
    assert.ok(v.by('captable-holder-positions') && v.by('captable-holder-issuances'));
  } finally { await v.close(); }
  const d = await mounted('/raise/cap-table/h-12?project_id=3', { phone: false });
  try {
    assert.ok(d.by('captable-holder-drawer-layer'), 'on a desktop it is the drawer over Overview');
    assert.ok(d.by('captable-overview') && d.by('captable-tabs'));
    assert.equal(d.count('captable-holder-full'), 0);
  } finally { await d.close(); }
});

// ─────────────────────────────────────────────────────────── bottom sheets

test('every dialog and drawer is a bottom sheet on a phone, inside the tool\'s 44px root', async () => {
  for (const [url, layer] of [
    ['/raise/cap-table/new?project_id=3', null],
    ['/raise/cap-table/proposal/p1?project_id=3', null],
    ['/raise/cap-table/instrument/i9?project_id=3', 'captable-instrument-layer'],
  ]) {
    const v = await mounted(url);
    try {
      const sheets = v.sheets();
      assert.equal(sheets.length, 1, `${url}: one bottom sheet`);
      if (layer) assert.equal(v.props(sheets[0])['data-testid'], layer);
      assert.ok(v.underPhoneRoot(sheets[0]), `${url}: its buttons are 44px targets`);
      assert.ok(!v.ids().some((id) => /-page$/.test(id) && /dialog|drawer|instrument$|record/.test(id.replace(/-page$/, '')) && id !== 'captable-instruments-page'), `${url}: never drawn as a page`);
    } finally { await v.close(); }
  }
});

// ─────────────────────────────────────────────────────────── each tab at phone width

test('each tab at phone width: the cycle bar, the tool\'s tabs, and its root a 44px root; none at desktop width', async () => {
  for (const tab of ['instruments', 'option-pool', 'scenarios', 'history', 'access', 'import-export']) {
    const v = await mounted(`/raise/cap-table/${tab}?project_id=3`);
    try {
      const page = v.by(`captable-${tab}-page`);
      assert.ok(page, `${tab} draws`);
      assert.ok(hasClass(v.cls(page), PHONE_ROOT), `${tab}: its controls are 44px targets`);
      assert.ok(v.by('cycle-bar'), `${tab}: the phone bar back to the Cap table`);
      assert.match(v.text(v.by('cycle-bar')), /Cap table/);
      assert.ok(v.by('captable-tabs'), `${tab}: the tabs scroll sideways under it`);
    } finally { await v.close(); }
    const d = await mounted(`/raise/cap-table/${tab}?project_id=3`, { phone: false });
    try {
      assert.ok(!hasClass(d.cls(d.by(`captable-${tab}-page`)), PHONE_ROOT), `${tab}: no phone class on a desktop`);
      assert.equal(d.count('cycle-bar'), 0);
    } finally { await d.close(); }
  }
});

test('the tab bar scrolls sideways', () => {
  assert.match(read('CapTableTool.jsx'), /<nav aria-label=\{TITLE\} className="-mb-px flex gap-1 overflow-x-auto">/);
});

// ─────────────────────────────────────────────────────────── CT23c: compare

test('CT23c at phone width: the scenarios one per card, ‹ and › to step, and the card\'s exit waterfall as a table', async () => {
  const v = await mounted('/raise/cap-table/scenarios/compare?project_id=3&ids=s-today,s-model');
  try {
    assert.ok(hasClass(v.cls(v.by('captable-scenario-page')), PHONE_ROOT));
    assert.equal(v.count('captable-compare-table'), 0, 'no wide table on a phone');
    assert.equal(v.count('captable-compare-founders'), 0);
    assert.equal(v.count('captable-compare-card'), 2);
    assert.deepEqual(v.all('captable-compare-card-meta').map((n) => v.text(n)), ['1 of 2 · swipe ›', '2 of 2 · swipe ›']);
    const first = v.text(v.all('captable-compare-card')[0]);
    assert.match(first, /^Seed · base case 1 of 2 · swipe › Founders 88\.89% → 61\.54%/);
    assert.match(first, /Price per share \$1\.0714/);
    assert.equal(v.props(v.all('captable-compare-card')[0])['aria-current'], 'true');
    assert.match(v.text(v.by('captable-compare-exit-table-block')), /^Exit waterfall · Seed · base case/);
    assert.deepEqual(v.all('captable-compare-exit-row').map((n) => v.text(n)), [
      '$5,000,000 $1,301,204.81 $3,650,000 $48,795.19',
      '$30,000,000 Not recorded Not recorded Not recorded',
      '$100,000,000 $66,666,666.67 $30,833,333.33 $2,500,000',
    ]);
    assert.equal(v.props(v.by('captable-compare-prev')).disabled, true);
    await v.press(v.by('captable-compare-next'));
    assert.equal(v.props(v.all('captable-compare-card')[1])['aria-current'], 'true');
    assert.match(v.text(v.by('captable-compare-exit-table-block')), /^Exit waterfall · Typed bridge/);
    assert.equal(v.text(v.all('captable-compare-exit-row')[1]), '$30,000,000 $24,000,000 $6,000,000 $0');
    assert.equal(v.props(v.by('captable-compare-next')).disabled, true);
    assert.match(v.text(v.by('captable-compare-exit-table-block')), /Assumptions: 1× non-participating preferred\./);
  } finally { await v.close(); }
  const d = await mounted('/raise/cap-table/scenarios/compare?project_id=3&ids=s-today,s-model', { phone: false });
  try {
    assert.ok(d.by('captable-compare-table') && d.by('captable-compare-founders'));
    assert.equal(d.count('captable-compare-card'), 0);
  } finally { await d.close(); }
});

// ─────────────────────────────────────────────────────────── 44 × 44

test('the 44 × 44px rule: every button, select, field, boxed link and checkbox label under the phone root', () => {
  const css = read('capTable.css').replace(/\/\*[\s\S]*?\*\//g, '');
  const rule = (selector) => {
    const m = new RegExp(`([^{}]*)\\{([^}]*)\\}`, 'g');
    let hit; const out = [];
    while ((hit = m.exec(css))) if (hit[1].split(',').map((s) => s.trim()).includes(selector)) out.push(hit[2]);
    return out.join(';');
  };
  for (const sel of ['.captable-phone button', '.captable-phone select', '.captable-phone textarea', '.captable-phone a', ".captable-phone input:not([type='checkbox']):not([type='radio'])"]) {
    assert.match(rule(sel), /min-height:\s*44px/, sel);
  }
  for (const sel of ['.captable-phone button', '.captable-phone select']) assert.match(rule(sel), /min-width:\s*44px/, sel);
  assert.match(rule(".captable-phone label:has(> input[type='checkbox'])"), /min-height:\s*44px/);
  assert.match(rule('.captable-phone nav a'), /display:\s*inline-flex/);
  assert.ok(!/@layer/.test(css), 'outside Tailwind\'s layers, so a smaller utility never wins');
  assert.equal(PHONE_ROOT, 'captable-phone');
  assert.match(read('CapTableTool.jsx'), /import '\.\/capTable\.css';/);
});

// ─────────────────────────────────────────────────────────── CT8: dark

const FILES = readdirSync(DIR).filter((f) => /\.(jsx|js)$/.test(f));
const classStrings = (src) => [...src.matchAll(/'([^'\n]*)'|"([^"\n]*)"|`([^`\n]*)`/g)].map((m) => m[1] ?? m[2] ?? m[3]).filter((s) => /(?:^|\s)(?:dark:|text-|bg-|border-)/.test(s));

test('CT8: violet text is #a78bfa and each status colour keeps its own pair, on every board', () => {
  assert.deepEqual(DARK, {
    violet: 'dark:text-violet-400', positive: 'dark:text-emerald-400', negative: 'dark:text-red-400', amber: 'dark:text-amber-300',
    hairline: 'dark:border-gray-700', ink: 'dark:text-gray-200', muted: 'dark:text-gray-400', card: 'dark:bg-gray-900', raised: 'dark:bg-gray-800',
    lavender: 'dark:bg-[#211f3d]', lavenderEdge: 'dark:border-[#4c3a8a]',
  });
  const RETIRED = /(?<![\w:-])dark:(?:!?text-(?:violet-(?:200|300)|emerald-(?:200|300)|red-(?:200|300)|rose-\d+|gray-100)|border-(?:gray-800|violet-(?:800|900)|emerald-(?:800|900)|red-900|amber-900|rose-\d+)|bg-(?:violet|emerald|red|amber|rose)-950(?:\/\d+)?)(?![\w/-])/;
  // A light status or violet text colour, and the dark pair CT8 gives it.
  const PAIRS = [
    [/^(?:text-axal-violet|text-violet-\d{3})$/, DARK.violet],
    [/^text-emerald-\d{3}$/, DARK.positive],
    [/^text-(?:red|rose)-\d{3}$/, DARK.negative],
    [/^text-amber-\d{3}$/, DARK.amber],
  ];
  const problems = [];
  for (const f of FILES) {
    const src = read(f);
    for (const s of classStrings(src)) {
      const hit = RETIRED.exec(s);
      if (hit) problems.push(`${f}: ${hit[0]} is not a CT8 pair`);
      // Split on quotes and braces too: a template string nests the strings it chooses between.
      const toks = s.split(/[\s'"`{}()]+/);
      for (const t of toks) {
        for (const [light, pair] of PAIRS) {
          if (light.test(t) && !toks.includes(pair)) problems.push(`${f}: ${t} has no ${pair} beside it in "${s.slice(0, 80)}"`);
        }
      }
    }
  }
  assert.deepEqual(problems, []);
});

test('check-dark-mode.mjs passes', () => {
  const root = new URL('../../', import.meta.url);
  const out = execFileSync(process.execPath, [join(root.pathname, 'scripts/check-dark-mode.mjs')], { encoding: 'utf8' });
  assert.match(out, /check-dark-mode\.mjs: OK/);
});
