// D1022 (#2859, part 7 of #2432) — Overview complete and the holder drawer:
// Needs you, who owns by holder and by class, the tiles and bars, CT2, and the
// states (CT16, CT19–CT22, CT24). Fixtures follow the Worker's shapes
// (services/capTableRecord.ts readRecord, D1017) and are worked out by hand.
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
  AS_OF_NONE, EMPTY_TITLE, MODEL_TITLE, NEEDS_MAX, NO_ROUND, OTHER_TITLE, PLAN_LINE, SAVE_BLOCKED, UNREADABLE_LINE,
  asOf, bars, byClass, cartaChip, describe, filingsOf, groupOf, harbourChip, holderIdOf, holderView, instruments, needsYou,
  perShare, proposalsFromModel, tiles, whoOwns,
} from '../src/pages/raise/captable/overviewModel.js';

const h = React.createElement;
const read = (path) => readFileSync(path, 'utf8');
const response = (body, status = 200) => ({ ok: status < 400, status, headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body) });

const CLASSES = [
  { uid: 'c1', name: 'Common', kind: 'common', authorized_shares: 15000000, price_per_share_micros: 100, liquidation_multiple_bps: 10000, participating: false, conversion_ratio: 1 },
  { uid: 'c2', name: 'Series Seed Preferred', kind: 'preferred', authorized_shares: 4000000, price_per_share_micros: 1030000, liquidation_multiple_bps: 10000, participating: false, conversion_ratio: 1 },
  { uid: 'c3', name: 'Options', kind: 'option_pool', authorized_shares: 1500000, price_per_share_micros: null, liquidation_multiple_bps: 10000, participating: false, conversion_ratio: 1 },
];
const iss = (o) => ({ status: 'recorded', source: 'typed', origin: 'owner', from_holder: null, class_uid: null, shares: null, amount_cents: null, currency: 'USD', price_per_share_micros: null, issued_on: null, terms: {}, document_ref: null, correction_reason: null, void_reason: null, recorded_at: null, created_at: '2026-10-01 10:00:00', ...o });
// Outstanding 9,100,000 (common 8,100,000 + preferred 1,000,000); fully
// diluted 10,600,000 (+ 300,000 granted options + 1,200,000 unallocated).
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
  ] },
  by_class: { available: true, reason: null, rows: [
    { ...CLASSES[0], issued: 8100000, options_granted: null, options_exercised: null, unallocated: null },
    { ...CLASSES[1], issued: 1000000, options_granted: null, options_exercised: null, unallocated: null },
    { ...CLASSES[2], issued: null, options_granted: 300000, options_exercised: 0, unallocated: 1200000 },
  ] },
  outstanding: { available: true, reason: null, shares: 9100000, common: 8100000, preferred: 1000000 },
  fully_diluted: { available: true, reason: null, shares: 10600000, outstanding: 9100000, options_granted: 300000, unallocated_pool: 1200000, pool_recorded: true },
  instruments: { available: true, reason: null, rows: [
    iss({ uid: 'i9', kind: 'safe', holder: { holder_id: null, name: 'Northwind Angels' }, amount_cents: 15000000, terms: { cap_cents: 1000000000, basis: 'post_money' }, source: 'connector_mercury', origin: 'mercury' }),
  ] },
  issuances: { available: true, reason: null, rows: [
    iss({ uid: 'i1', kind: 'founding', holder: { holder_id: 12, name: 'Founder A' }, class_uid: 'c1', shares: 4400000, issued_on: '2025-01-03', source: 'signed', document_ref: 'legal_documents:4', recorded_at: '2025-01-03 10:00:00' }),
    iss({ uid: 'i2', kind: 'founding', holder: { holder_id: 13, name: 'Founder B' }, class_uid: 'c1', shares: 3600000, issued_on: '2025-01-03', source: 'signed', recorded_at: '2025-01-03 10:00:00' }),
    iss({ uid: 'i3', kind: 'priced', holder: { holder_id: 14, name: 'Bluefern Capital' }, class_uid: 'c2', shares: 1000000, price_per_share_micros: 1030000, issued_on: '2026-06-03', source: 'document', recorded_at: '2026-06-04 09:00:00' }),
    iss({ uid: 'i4', kind: 'priced', status: 'void', holder: { holder_id: 14, name: 'Bluefern Capital' }, class_uid: 'c2', shares: 1000000, issued_on: '2026-06-02', void_reason: 'Entered twice', recorded_at: '2026-06-02 09:00:00' }),
    iss({ uid: 'i5', kind: 'grant', holder: { holder_id: 15, name: 'Jo Rivera' }, class_uid: 'c3', shares: 300000, issued_on: '2026-02-02', recorded_at: '2026-10-12 08:00:00' }),
    iss({ uid: 'i6', kind: 'founding', holder: { holder_id: null, name: 'Harbor Angel' }, class_uid: 'c1', shares: 100000, issued_on: '2025-05-01', recorded_at: '2025-05-01 10:00:00' }),
  ] },
  proposals: { available: true, reason: null, rows: [
    iss({ uid: 'p1', status: 'proposed', kind: 'safe', origin: 'mercury', source: 'connector_mercury', holder: { holder_id: null, name: 'Harbor Seed Fund' }, amount_cents: 25000000, terms: { cap_cents: 800000000, basis: 'post_money' }, created_at: '2026-10-20 10:00:00' }),
    iss({ uid: 'p2', status: 'proposed', kind: 'grant', origin: 'cofounder', holder: { holder_id: 15, name: 'Jo Rivera' }, class_uid: 'c3', shares: 50000, created_at: '2026-10-19 10:00:00' }),
    iss({ uid: 'p3', status: 'proposed', kind: 'priced', origin: 'close', holder: { holder_id: null, name: 'Second Close LP' }, class_uid: 'c2', shares: 200000, created_at: '2026-10-18 10:00:00' }),
    iss({ uid: 'p4', status: 'proposed', kind: 'safe', origin: 'import', holder: { holder_id: null, name: 'Imported Angel' }, created_at: '2026-10-17 10:00:00' }),
    iss({ uid: 'p5', status: 'proposed', kind: 'note', origin: 'owner', holder: { holder_id: null, name: 'Oldest Note' }, created_at: '2026-10-10 10:00:00' }),
  ] },
};
const EMPTY = {
  ...RECORD,
  by_holder: { available: false, reason: 'nothing_recorded', sentence: 'No issuance of shares is on record yet.' },
  by_class: { available: false, reason: 'nothing_recorded', sentence: 'No issuance of shares is on record yet.' },
  outstanding: { available: false, reason: 'nothing_recorded', sentence: 'No issuance of shares is on record yet.' },
  fully_diluted: { available: false, reason: 'nothing_recorded', sentence: 'No issuance of shares is on record yet.' },
  instruments: { available: true, reason: null, rows: [] },
  issuances: { available: true, reason: null, rows: [] },
  proposals: { available: true, reason: null, rows: [] },
};
const CANONICAL = {
  uid: 'm1', name: 'Main', updated_at: '2026-10-12T08:00:00Z',
  inputs: {
    founders: [{ name: 'Founder A', shares: 4000000 }, { name: 'Founder B', shares: 4000000 }],
    safes: [{ name: 'Harbor Seed Fund', amount: 250000, cap: 8000000, discount: 0.15 }, { name: 'Angel Note', amount: 100000, instrument: 'note', interest_rate: 0.08, issue_date: '2025-08-01' }],
    rounds: [{ name: 'Seed', pre_money: 12000000, investment: 3000000 }],
  },
  result: { founding: [], rounds: [{ name: 'Seed', events: [], ledger: [
    { holder: 'Founder A', type: 'founder', shares: 4000000, pct: 33.3 }, { holder: 'Founder B', type: 'founder', shares: 4000000, pct: 33.3 },
    { holder: 'Seed investors', type: 'preferred', shares: 3000000, pct: 25 }, { holder: 'Harbor Seed Fund', type: 'safe', shares: 1000000, pct: 8.3 },
  ] }] },
};
const COMPARE = { canonical: CANONICAL, variants: [] };
const V409A = { ok: true, current: { valuation_date: '2026-03-03', fmv_per_share: 0.42, provider: 'Carta Valuations' }, status: { state: 'valid', expires_on: '2027-03-03', reason: 'Safe harbour in force until 2027-03-03.' } };
const INTEGRATIONS = { ok: true, items: [{ uid: 'g1', provider_key: 'carta', display_name: 'Carta', status: 'connected', last_synced_at: '2026-10-20T09:00:00Z', last_error: null }] };
const LEVELS = { investor: { label: 'Investor', sees: 'Every investor and founder position, rounds and pricing, the pool as one line, the waterfall. Not who holds options.' } };
const GRANTS = { grants: [{ id: 1, holder_ref: 'Bluefern Capital', level: 'investor', source: 'founder' }], can_change: true, levels: LEVELS };
const PLAN = { scope: { kind: 'venture', project_id: 3 }, pools: [], grants: [{ id: 7, holder_id: 15, start_date: '2026-02-02', cliff_months: 12, total_months: 48, total_shares: 300000, vested_shares: 75000 }] };
const BUILD = { records: { rows: [{ id: 'step-1', cells: {}, edit: { kind: '83b', for_holder_id: 12, state: 'done', due_date: '2025-02-02' } }, { id: 'step-2', cells: {}, edit: { kind: 'ein', state: 'done' } }] } };
const MODULE = { module: { slug: 'cap-table', name: 'Cap table', records_title: 'Holders' }, card: { state: 'empty', reason: 'No holders yet.' }, records: { cols: [], rows: [], total: 0, page: 1, page_size: 25 } };
const OWNER = { id: 2, role: 'founder', founder_id: 20, subscription_tier: 'studio', name: 'Synthetic Founder' };

/* ------------------------------------------------------------------ *
 * The model
 * ------------------------------------------------------------------ */

test('who owns, by holder: groups with subtotals, both percentages, and outstanding leaving options out', () => {
  const fd = whoOwns(RECORD, 'fd', '?project_id=3');
  assert.deepEqual(fd.groups.map((g) => [g.label, g.shares, g.pctFd, g.pctOut]), [
    ['Founders', 8000000, '75.47%', '87.91%'],
    ['Investors', 1000000, '9.43%', '10.99%'],
    ['Employees and advisors', 300000, '2.83%', '—'],
    ['Other holders', 100000, '0.94%', '1.10%'],
    ['Option pool · unallocated', 1200000, '11.32%', '—'],
  ]);
  const a = fd.groups[0].rows[0];
  assert.deepEqual([a.name, a.href, a.classes, a.pctFd, a.pctOut, a.source, a.changed], ['Founder A', '/raise/cap-table/h-12?project_id=3', 'Common', '41.51%', '48.35%', 'Signed', '3 Jan 2025']);
  assert.equal(fd.groups[3].rows[0].href, null, 'a holder named only on the issuance has no address');
  assert.equal(fd.groups[2].rows[0].pctOut, '—', 'options are not outstanding');
  assert.match(fd.foot, /^Fully diluted 10,600,000 · Outstanding 9,100,000\./);
  assert.equal(fd.grantedLine, '300,000 granted options are held by the people above.');
  const out = whoOwns(RECORD, 'out');
  assert.deepEqual(out.groups.map((g) => g.id), ['founders', 'investors', 'other'], 'outstanding drops the options-only holder and the pool');
  assert.equal(out.groups[0].shares, 8000000);
  assert.deepEqual(whoOwns(EMPTY), { available: false, reason: 'nothing_recorded', sentence: 'No issuance of shares is on record yet.' });
  const noPool = { ...RECORD, fully_diluted: { available: false, reason: 'pool_size_not_recorded', sentence: 'An option pool’s size is not recorded, so its unallocated shares cannot be counted.' } };
  const v = whoOwns(noPool);
  assert.equal(v.groups[0].pctFd, 'Not recorded', 'no fully diluted total is no percentage, never 0%');
  assert.equal(v.groups[0].pctOut, '87.91%', 'outstanding still counts');
  assert.match(v.fdSentence, /size is not recorded/);
});

test('a holder\'s group is the register\'s kind, else what they hold; never guessed from common', () => {
  const classes = new Map(CLASSES.map((c) => [c.uid, c]));
  assert.equal(groupOf({ kind: 'founder', by_class: [{ class_uid: 'c2' }] }, classes), 'founders');
  assert.equal(groupOf({ kind: null, by_class: [{ class_uid: 'c2' }] }, classes), 'investors');
  assert.equal(groupOf({ kind: 'advisor', by_class: [] }, classes), 'people');
  assert.equal(groupOf({ kind: null, by_class: [{ class_uid: 'c3' }] }, classes), 'people');
  assert.equal(groupOf({ kind: null, by_class: [{ class_uid: 'c1' }] }, classes), 'other');
});

test('by class (CT1c): authorized, issued, outstanding, price to six places, preference, ratio and holders', () => {
  const v = byClass(RECORD);
  assert.deepEqual(v.rows.map((r) => [r.name, r.authorized, r.issued, r.outstanding, r.price, r.preference, r.ratio, r.holders]), [
    ['Common', '15,000,000', '8,100,000', '8,100,000', '$0.0001', '—', '—', '3'],
    ['Series Seed Preferred', '4,000,000', '1,000,000', '1,000,000', '$1.03', '1×, non-participating', '1 : 1', '1'],
    ['Options', '1,500,000', '300,000 granted', 'Not outstanding until exercised', 'Not recorded', '—', '—', '1'],
  ]);
  assert.equal(v.foot, 'Outstanding 9,100,000 = Common 8,100,000 + Series Seed Preferred 1,000,000.');
  assert.equal(perShare(null), 'Not recorded');
  assert.equal(perShare(420000, 'EUR'), '€0.42');
  assert.equal(byClass(EMPTY).available, false);
});

test('the tiles, the three bars and the instruments; no planned round is a dashed note, never a bar', () => {
  assert.deepEqual(tiles(RECORD).map((t) => [t.label, t.value, t.sub]), [
    ['Founders', '75.47%', '8,000,000 shares'],
    ['Investors', '9.43%', '1,000,000 shares'],
    ['Pool granted', '2.83%', '300,000 options'],
    ['Pool unallocated', '11.32%', '1,200,000 options'],
    ['SAFEs and notes outstanding', '1', '$150,000 · converts in a scenario'],
  ]);
  const noPool = { ...RECORD, fully_diluted: { ...RECORD.fully_diluted, unallocated_pool: null, pool_recorded: false } };
  assert.deepEqual(tiles(noPool)[3], { label: 'Pool unallocated', value: 'Not recorded', sub: 'No pool is recorded' }, 'no pool class is not a pool of 0');
  const [fd, out, after] = bars(RECORD, COMPARE);
  assert.deepEqual(fd.parts.map((p) => [p.id, p.pct.toFixed(2)]), [['founders', '75.47'], ['investors', '9.43'], ['people', '2.83'], ['other', '0.94'], ['pool', '11.32']]);
  assert.deepEqual(out.parts.map((p) => [p.id, p.pct.toFixed(2)]), [['founders', '87.91'], ['investors', '10.99'], ['other', '1.10']]);
  assert.equal(fd.modelled, false);
  assert.equal(after.modelled, true, 'After the round is the model');
  assert.equal(after.label, 'After Seed · Cap table · model');
  assert.deepEqual(after.parts.map((p) => [p.id, p.pct.toFixed(2)]), [['founders', '66.67'], ['investors', '33.33']]);
  const none = bars(RECORD, { canonical: { ...CANONICAL, inputs: { ...CANONICAL.inputs, rounds: [] }, result: { rounds: [] } } })[2];
  assert.deepEqual([none.parts, none.note], [null, NO_ROUND]);
  assert.equal(bars(EMPTY, null)[0].parts, null);
  assert.deepEqual(instruments(RECORD), [{ uid: 'i9', holder: 'Northwind Angels', line: 'SAFE · $150,000 · cap $10,000,000 · Post-money', source: 'Mercury' }]);
});

test('the tool bar: As of the latest recorded change, Carta\'s chip, the 409A\'s, and failed reads said so', () => {
  assert.equal(asOf(RECORD), 'As of 12 Oct 2026');
  assert.equal(asOf(EMPTY), AS_OF_NONE);
  assert.deepEqual(cartaChip(INTEGRATIONS), { text: 'Carta · synced 20 Oct 2026', tone: 'good' });
  assert.equal(cartaChip({ items: [] }).text, 'Carta · Not connected');
  assert.equal(cartaChip({ items: [{ provider_key: 'carta', status: 'connected', last_error: 'token expired' }] }).text, 'Carta · last sync failed');
  assert.equal(cartaChip(null, 'error').text, 'Carta · could not be read');
  assert.deepEqual(harbourChip(V409A), { text: '409A · Valid until 3 Mar 2027', tone: 'good' });
  assert.equal(harbourChip(null, 'error').text, '409A · could not be read', 'a failed read is never "no 409A"');
});

test('Needs you: newest first, at most four, each in words with no invented figure', () => {
  const n = needsYou(RECORD);
  assert.equal(n.count, 5);
  assert.equal(n.meta, '5 proposals waiting');
  assert.equal(n.rows.length, NEEDS_MAX);
  assert.deepEqual(n.rows.map((r) => r.uid), ['p1', 'p2', 'p3', 'p4']);
  assert.equal(n.rows[0].text, 'A SAFE for Harbor Seed Fund, $250,000, post-money cap $8,000,000.');
  assert.equal(n.rows[1].lead, 'A co-founder proposed recording this.');
  assert.equal(n.rows[1].text, 'An option grant for Jo Rivera: 50,000 shares of Options.');
  assert.equal(describe(RECORD.proposals.rows[3], RECORD), 'A SAFE for Imported Angel, amount not recorded.');
});

test('"Record them from the model" proposes each founder and SAFE in the record\'s units', () => {
  assert.deepEqual(proposalsFromModel(CANONICAL), [
    { kind: 'founding', holder_name: 'Founder A', shares: 4000000, note: 'From your saved model (Cap table · model).' },
    { kind: 'founding', holder_name: 'Founder B', shares: 4000000, note: 'From your saved model (Cap table · model).' },
    { kind: 'safe', holder_name: 'Harbor Seed Fund', note: 'From your saved model (Cap table · model).', amount_cents: 25000000, cap_cents: 800000000, discount_bps: 1500 },
    { kind: 'note', holder_name: 'Angel Note', note: 'From your saved model (Cap table · model).', amount_cents: 10000000, interest_bps: 800, issued_on: '2025-08-01' },
  ]);
  assert.deepEqual(proposalsFromModel(null), []);
});

test('the holder drawer: positions, issuances with documents or "No document", vesting, 83(b) and access', () => {
  assert.equal(holderIdOf('h-12'), 12);
  assert.equal(holderIdOf('e-3'), null);
  const blue = holderView(RECORD, 14, { grants: GRANTS, plan: PLAN, filings: filingsOf(BUILD) });
  assert.equal(blue.name, 'Bluefern Capital');
  assert.equal(blue.pctFd, '9.43%');
  assert.deepEqual(blue.positions.map((p) => p.line), ['Series Seed Preferred · 1,000,000 shares']);
  assert.deepEqual(blue.issuances.map((i) => [i.void, i.document, i.sub]), [[false, null, 'Paid $1.03 a share'], [true, null, 'Void: Entered twice']]);
  assert.equal(blue.person, false);
  assert.equal(blue.vesting, null, 'an investor has no vesting block');
  assert.deepEqual(blue.access, { level: 'Investor', scope: LEVELS.investor.sees });
  const a = holderView(RECORD, 12, { grants: GRANTS, plan: PLAN, filings: filingsOf(BUILD) });
  assert.equal(a.issuances[0].document, 'legal_documents:4');
  assert.deepEqual(a.election, { text: '83(b) filed' });
  assert.deepEqual(a.vesting, [], 'no grant is recorded for this founder');
  assert.deepEqual(a.access, { level: 'Not shared', scope: 'They see nothing of the cap table until a level is granted.' });
  const jo = holderView(RECORD, 15, { grants: GRANTS, plan: PLAN, filings: [] });
  assert.equal(jo.vesting[0].vested, 'Vested 75,000 of 300,000');
  assert.equal(jo.vesting[0].pct, 25);
  assert.match(jo.vesting[0].terms, /cliff 12 months · total 48 months/);
  assert.deepEqual(jo.election, { text: '83(b) · Not recorded' });
  const blind = holderView(RECORD, 15, { grants: null, plan: null, filings: null });
  assert.deepEqual([blind.vesting, blind.election, blind.access], [{ status: 'unreadable' }, { status: 'unreadable' }, { status: 'unreadable' }], 'a failed read is never "none"');
  assert.equal(holderView(RECORD, 99).found, false);
});

/* ------------------------------------------------------------------ *
 * The page, mounted under CycleRoute on a stubbed fetch
 * ------------------------------------------------------------------ */

function handlerFor(o = {}) {
  const at = { record: RECORD, compare: COMPARE, v409a: V409A, integrations: INTEGRATIONS, grants: GRANTS, plan: PLAN, build: BUILD, user: OWNER, ...o };
  const send = (v) => (typeof v === 'number' ? response({ detail: 'refused' }, v) : response(v));
  return (url, options = {}) => {
    if (/\/captable\/record\/3\/proposals\/[^/]+\/(accept|dismiss)/.test(url)) return o.decide ? o.decide(url, options) : response({ issuance: {} });
    if (/\/captable\/record\/3\/proposals$/.test(url)) return o.propose ? o.propose(url, options) : response({ issuance: {} }, 201);
    if (url.includes('/captable/record/3')) return send(at.record);
    if (url.includes('/compare')) return send(at.compare);
    if (url.includes('/captable/409a/')) return send(at.v409a);
    if (url.includes('/captable/access/3/grants')) return send(at.grants);
    if (url.includes('/captable/equity-plan?project_id=3')) return send(at.plan);
    if (url.includes('/cycles/build/modules/company-creation')) return send(at.build);
    if (/\/integrations(\?|$)/.test(url)) return send(at.integrations);
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
  globalThis.fetch = async (u, options = {}) => { requests.push([String(u), options.method || 'GET', options.body]); return handle(String(u), options); };
  globalThis.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
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
  const flush = () => act(async () => { for (let i = 0; i < 8; i += 1) await new Promise((r) => setTimeout(r, 0)); });
  await flush();
  const nodes = () => { const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)]; return walk(container); };
  const text = (n) => (n?.nodeType === 3 ? n.textContent : n?.childNodes?.length ? n.childNodes.map(text).join(' ') : n?.textContent || '');
  const props = (n) => Object.entries(n).find(([key]) => key.startsWith('__reactProps$'))?.[1] || {};
  const all = (id) => nodes().filter((n) => props(n)['data-testid'] === id);
  const by = (id) => all(id)[0];
  return {
    requests, flush, by, all, props,
    // A missing node fails here, rather than falling back to the whole page and matching by accident.
    text: (...a) => { const n = a.length ? a[0] : container; assert.ok(n, 'no such node'); return text(n).replace(/\s+/g, ' '); },
    ids: () => nodes().map((n) => props(n)['data-testid']).filter(Boolean),
    hrefs: () => nodes().filter((n) => String(n.tagName).toUpperCase() === 'A').map((n) => props(n).href || props(n).to).filter(Boolean),
    async press(node) { assert.ok(node, 'no such node'); await act(async () => { await props(node).onClick?.({ preventDefault() {}, stopPropagation() {} }); }); await flush(); },
    async close() { await act(async () => root.unmount()); Object.assign(globalThis, previous); restore(); },
  };
}

test('Overview: the tool bar, Needs you, who owns, the tiles, the bars, the instruments and the 409A line', async () => {
  const v = await mounted('/raise/cap-table?project_id=3');
  try {
    const bar = v.text(v.by('captable-toolbar'));
    assert.match(bar, /As of 12 Oct 2026/);
    assert.match(bar, /Carta · synced 20 Oct 2026/);
    assert.match(bar, /409A · Valid until 3 Mar 2027/);
    assert.match(bar, /5 proposals waiting/);
    assert.ok(!v.by('captable-record'), 'Record an issuance waits for part 10\'s dialog');
    assert.equal(v.all('captable-need').length, 4);
    assert.match(v.text(v.by('captable-needs')), /A SAFE request from Mercury\. A SAFE for Harbor Seed Fund, \$250,000/);
    assert.equal(v.all('captable-group').length, 5);
    assert.equal(v.all('captable-holder-row').length, 6);
    assert.ok(v.hrefs().includes('/raise/cap-table/h-12?project_id=3'), 'a row opens its holder');
    assert.match(v.text(v.by('captable-who-owns-foot')), /Fully diluted 10,600,000 · Outstanding 9,100,000/);
    assert.match(v.text(v.by('captable-tiles')), /Founders 75\.47% 8,000,000 shares/);
    assert.equal(v.all('captable-bar').length, 2);
    assert.match(v.text(v.by('captable-bar-after')), /After Seed · Cap table · model Modelled/, 'the third bar carries its Modelled tag');
    assert.match(v.text(v.by('captable-instruments')), /Northwind Angels/);
    assert.match(v.text(v.by('captable-409a-line')), /Safe harbour in force until 2027-03-03\./);
    assert.ok(v.ids().includes('cycle-module'), 'the module page still draws below');
  } finally { await v.close(); }
});

test('the switches: Outstanding leaves options out, and By class draws the classes', async () => {
  const v = await mounted('/raise/cap-table?project_id=3');
  try {
    await v.press(v.by('captable-basis-out'));
    assert.equal(v.all('captable-holder-row').length, 4, 'Jo\'s options and the pool leave the outstanding view');
    await v.press(v.by('captable-view-class'));
    assert.equal(v.all('captable-class-row').length, 3);
    assert.match(v.text(v.by('captable-by-class')), /\$0\.0001.*1×, non-participating.*Not outstanding until exercised/);
    assert.match(v.text(v.by('captable-by-class-foot')), /Outstanding 9,100,000 = Common 8,100,000 \+ Series Seed Preferred 1,000,000\./);
  } finally { await v.close(); }
});

test('Needs you: the owner records a proposal from its dialog, and a refusal names what it lacks', async () => {
  let fail = false;
  const v = await mounted('/raise/cap-table?project_id=3', {
    decide: () => (fail ? response({ error: 'incomplete', message: 'Say which class it is in.', missing: ['class', 'issued_on'] }, 400) : response({ issuance: {} })),
  });
  try {
    await v.press(v.all('captable-need-review')[0]);
    assert.match(v.text(v.by('captable-proposal-says')), /puts this issuance on the record.*anyone you have granted Investor or Full see it/);
    assert.equal(v.requests.filter(([u]) => /\/accept$/.test(u)).length, 0, 'opening it writes nothing');
    await v.press(v.by('captable-proposal-accept'));
    assert.ok(v.requests.some(([u, m]) => u.endsWith('/captable/record/3/proposals/p1/accept') && m === 'POST'));
    assert.ok(!v.by('captable-proposal-dialog'), 'the dialog closes and the record reads again');
    fail = true;
    await v.press(v.all('captable-need-review')[1]);
    await v.press(v.by('captable-proposal-accept'));
    assert.match(v.text(v.by('captable-proposal-error')), /It still needs: class, issued_on\./);
  } finally { await v.close(); }
});

test('CT16: a co-founder reads the line, opens a proposal, and cannot record it', async () => {
  const v = await mounted('/raise/cap-table?project_id=3', { grants: { ...GRANTS, can_change: false } });
  try {
    assert.match(v.text(v.by('captable-cofounder')), /You are a co-founder\. Issuances you propose wait for the owner to accept\./);
    await v.press(v.all('captable-need-review')[0]);
    assert.ok(!v.by('captable-proposal-accept') && !v.by('captable-proposal-dismiss'));
    assert.match(v.text(v.by('captable-proposal-says')), /Only the owner records or dismisses/);
  } finally { await v.close(); }
});

test('CT24: below Raise + Grow the tool bar says so with See plans', async () => {
  const v = await mounted('/raise/cap-table?project_id=3', { user: { ...OWNER, subscription_tier: 'free' } });
  try {
    assert.ok(v.text(v.by('captable-plan-gate')).includes(PLAN_LINE));
    assert.ok(v.hrefs().includes('/pricing/products'));
    assert.ok(v.by('captable-who-owns'), 'reading stays open');
  } finally { await v.close(); }
});

test('CT19: nothing recorded, with the model kept as a scenario, offers to propose its rows behind a dialog', async () => {
  const proposed = [];
  const v = await mounted('/raise/cap-table?project_id=3', {
    record: EMPTY,
    propose: (u, o) => { proposed.push(JSON.parse(o.body)); return response({ issuance: {} }, 201); },
  });
  try {
    assert.ok(v.text(v.by('captable-empty-model')).includes(MODEL_TITLE));
    assert.ok(!v.by('captable-tiles'), 'no tile, so no sample number');
    await v.press(v.by('captable-from-model-open'));
    assert.match(v.text(v.by('captable-from-model-says')), /2 founders' shares and 2 SAFEs or notes from your saved model become proposals/);
    assert.equal(proposed.length, 0);
    await v.press(v.by('captable-from-model-run'));
    assert.deepEqual(proposed.map((b) => [b.kind, b.holder_name]), [['founding', 'Founder A'], ['founding', 'Founder B'], ['safe', 'Harbor Seed Fund'], ['note', 'Angel Note']]);
  } finally { await v.close(); }
  const w = await mounted('/raise/cap-table?project_id=3', { record: EMPTY, compare: { canonical: null, variants: [] } });
  try {
    assert.ok(w.text(w.by('captable-empty')).includes(EMPTY_TITLE));
  } finally { await w.close(); }
});

test('CT20–CT22: reading, a failed record read that offers no Save, a failed 409A alone, another company and an Explorer', async () => {
  const fail = await mounted('/raise/cap-table?project_id=3', { record: 500 });
  try {
    assert.ok(fail.text(fail.by('captable-record-unreadable')).includes(UNREADABLE_LINE.slice(0, 50)));
    assert.ok(fail.text(fail.by('captable-save-blocked')).includes(SAVE_BLOCKED));
    assert.match(fail.text(fail.by('captable-toolbar')), /As of · could not be read/);
    assert.ok(!fail.by('captable-who-owns') && !fail.by('captable-empty'), 'a failed read is never an empty cap table');
  } finally { await fail.close(); }
  const harbourDown = await mounted('/raise/cap-table?project_id=3', { v409a: 500 });
  try {
    assert.ok(harbourDown.by('captable-409a-line-unreadable'));
    assert.match(harbourDown.text(harbourDown.by('captable-toolbar')), /409A · could not be read/);
    assert.ok(harbourDown.by('captable-who-owns'), 'one failed block never blanks the page');
  } finally { await harbourDown.close(); }
  const other = await mounted('/raise/cap-table?project_id=3', { record: 403 });
  try {
    assert.ok(other.text(other.by('captable-other-company')).includes(OTHER_TITLE));
  } finally { await other.close(); }
  const explorer = await mounted('/raise/cap-table?project_id=3', { user: { id: 9, role: 'exploring' } });
  try {
    assert.ok(explorer.by('captable-explorer'));
    assert.ok(!explorer.requests.some(([u]) => u.includes('/captable/record/')), 'nothing is read for an Explorer');
  } finally { await explorer.close(); }
});

test('CT2: the holder drawer at /raise/cap-table/h-<n>, its reads each answering alone', async () => {
  const v = await mounted('/raise/cap-table/h-15?project_id=3');
  try {
    assert.ok(v.by('captable-holder-page') && v.by('captable-holder-drawer'));
    assert.match(v.text(v.by('captable-holder-drawer')), /Jo Rivera/);
    assert.match(v.text(v.by('captable-holder-positions')), /Options · 300,000 options/);
    assert.ok(v.by('captable-holder-no-document'), 'an issuance with no document says so');
    assert.match(v.text(v.by('captable-holder-vesting')), /Vested 75,000 of 300,000/);
    assert.match(v.text(v.by('captable-holder-83b')), /83\(b\) · Not recorded/);
    assert.match(v.text(v.by('captable-holder-level')), /Not shared/);
    assert.ok(!v.by('captable-holder-void'), 'Void waits for part 10\'s dialog');
  } finally { await v.close(); }
  const w = await mounted('/raise/cap-table/h-12?project_id=3', { plan: 500, build: 500 });
  try {
    assert.ok(w.by('captable-holder-vesting-unreadable') && w.by('captable-holder-83b-unreadable'));
    assert.match(w.text(w.by('captable-holder-positions')), /Common · 4,400,000 shares/, 'the record still draws');
    assert.ok(w.by('captable-holder-document'));
  } finally { await w.close(); }
});

test('the source: no new route, no alert or confirm, and the record and the model each carry their tag', () => {
  const app = read('frontend/src/App.jsx');
  assert.doesNotMatch(app, /path="\/raise\/cap-table\/h-/);
  for (const f of ['CapTableOverview.jsx', 'HolderDrawer.jsx', 'overviewModel.js']) {
    const src = read(`frontend/src/pages/raise/captable/${f}`);
    assert.doesNotMatch(src, /\b(window\.)?(alert|confirm)\(/, f);
    assert.doesNotMatch(src, /\[(Acme|Bluefern|Founder A)|\$500,000\]/, `${f}: no canvas sample`);
  }
  assert.match(read('frontend/src/pages/raise/captable/CapTableOverview.jsx'), /Tag kind=\{b\.modelled \? 'modelled' : 'record'\}/);
});
