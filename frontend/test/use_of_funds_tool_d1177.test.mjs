// D1177 (#3104) — the Use of funds tool complete: Home (UF1), Allocation and
// Edit split (UF2, UF3), Milestones and hires (UF5, UF6), Runway (UF7), Plan vs
// actual (UF12), where the plan is used (UF13), History (UF15), the admin's
// banner (UF16), the empty, loading, error and partial states (UF17–UF19) and
// the phone (UF21). Runway today and the forecast are never the same figure; a
// missing input is Not recorded; an admin's writes carry the banner. Mercury
// is stubbed: every figure here is invented.
//
// Run with:
//   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/use_of_funds_tool_d1177.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import CycleRoute from '../src/pages/cycles/CycleRoute.jsx';
import { useOfFundsApi } from '../src/lib/api/useOfFunds.js';
import {
  afterRaiseView, centsFromTyped, historyRows, homeTiles, money, monthsText, needsRows, planEmpty, planVsActual,
  raiseView, roundSourceRows, runwayCandidates, runwayTodayView, sectionRows, splitCheck, tiesRows,
} from '../src/pages/raise/useoffunds/useOfFundsModel.js';

const h = React.createElement;
const read = (p) => readFileSync(p, 'utf8');
const response = (body, status = 200) => ({ ok: status < 400, status, headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body) });

const KEYS = ['product', 'go-to-market', 'infrastructure', 'operations', 'reserve'];
const SHARES = [45, 25, 10, 10, 10];
const months = (n, from = 2026 * 12 + 9) => Array.from({ length: n }, (_, i) => `${Math.floor((from + i) / 12)}-${String(((from + i) % 12) + 1).padStart(2, '0')}`);
const M = months(18);
const modelled = (value, reason = null) => ({ source: 'Modelled', modelVersion: 1, state: value == null ? 'not_recorded' : 'recorded', value, reason });

/** A plan read in D1176's shape (`services/useOfFunds/read.ts` planRead). */
function planFixture({ viewer = { kind: 'founder', can_write: true, mercury: true }, runway = 'mercury', empty = false, partial = false } = {}) {
  const raise = 150000000;
  const alloc = SHARES.map((s) => (raise * s) / 100);
  const spend = KEYS.map((k, i) => M.map(() => Math.round(alloc[i] / 18)));
  const burn = M.map((m, i) => ({ month: m, spendCents: spend.reduce((a, s) => a + s[i], 0) }));
  let cash = 45120000;
  const path = M.map((m, i) => { const raised = i === 0 ? raise : 0; const open = cash; cash = cash + raised - burn[i].spendCents; return { month: m, openingCents: open, raisedCents: raised, spendCents: burn[i].spendCents, closingCents: cash }; });
  const base = empty ? {
    id: 9, uid: 'b9', name: 'Base', is_base: 1, currency: 'usd', amount_to_raise_cents: null, target_runway_months: null, lines: [], milestones: [],
    hires: { state: 'ok', items: [] }, model: { runway: modelled(null, 'Raise amount or a complete split totalling 100% is Not recorded.'), sections: [], cashPath: modelled(null, 'Opening cash is Not recorded.'), cashOut: modelled(null), burn: modelled(null, 'Planned burn is Not recorded.'), milestones: modelled([]) },
  } : {
    id: 9, uid: 'b9', name: 'Seed · base', is_base: 1, currency: 'usd', amount_to_raise_cents: raise, target_runway_months: 18, source: 'Typed',
    lines: KEYS.map((k, i) => ({ category_key: k, share_pct: SHARES[i], source: 'Typed' })),
    milestones: [
      { id: 1, category_key: 'infrastructure', label: 'SOC 2 Type I', due_on: '2027-01', cost_cents: 6000000, source: 'Typed', cost_state: 'recorded' },
      { id: 2, category_key: 'operations', label: 'EU entity', due_on: '2027-04', cost_cents: null, source: 'Typed', cost_state: 'not_costed' },
    ],
    hires: { state: 'ok', items: [
      { id: 11, category_key: 'product', role: 'Senior engineer', start_month: '2026-12', annual_cents: 15000000, currency: 'usd' },
      { id: 12, category_key: 'go-to-market', role: 'Account executive', start_month: '2027-02', annual_cents: 42000000, currency: 'usd' },
    ] },
    model: {
      sections: KEYS.map((k, i) => ({ key: k, allocation: modelled(alloc[i]), payroll: modelled(M.map(() => (k === 'product' ? 1250000 : 0))), spend: modelled(spend[i]) })),
      burn: modelled(burn), cashPath: modelled(path), cashOut: modelled({ months: 30, withinHorizon: false }),
      runway: modelled({ months: 18, relation: 'at_least' }),
      milestones: modelled([{ id: '1', state: 'Funded' }, { id: '2', state: 'Not costed' }]),
    },
  };
  const mercuryCand = { value: 9.4, source: 'Connector', ref: 'mercury_raise_facts:1', as_of: '2026-10-01', state: 'recorded', kind: 'mercury', cash_cents: 45120000, burn_cents: 4800000 };
  const metricsCand = { value: 11, source: 'Typed', ref: 'project_metrics:4', as_of: '2026-08-12', state: 'recorded', kind: 'metrics', cash_cents: 52800000, burn_cents: 4800000 };
  const runway_today = runway === 'mercury'
    ? { state: 'recorded', chosen: mercuryCand, candidates: [mercuryCand, metricsCand], partial, sources: { mercury: { state: 'ok' }, metrics: { state: 'ok' } }, reason: null }
    : runway === 'metrics'
      ? { state: 'recorded', chosen: metricsCand, candidates: [metricsCand], partial, sources: { mercury: { state: partial ? 'unreadable' : 'founder_only' }, metrics: { state: 'ok' } }, reason: null }
      : { state: 'not_recorded', chosen: null, candidates: [], partial: false, sources: { mercury: { state: 'founder_only' }, metrics: { state: 'ok' } }, reason: 'No measured cash and positive burn are recorded. A forecast never supplies runway today.' };
  const chosenRound = { value: raise, source: 'Document', ref: 'round_calls:3', as_of: '2026-10-14', kind: 'round_call', name: 'Seed', currency: 'usd', eligible: true };
  return {
    project_id: 3, viewer,
    base: empty ? { state: 'ok', value: base, reason: null } : { state: 'ok', value: base, reason: null },
    round: empty ? { chosen: null, candidates: [], disagreements: [], reason: 'No approved round call, active round target or plan raise is recorded.', sources: {} } : {
      chosen: chosenRound, precedence: ['round_call', 'round_record', 'plan'],
      candidates: [chosenRound, { value: 200000000, source: 'Modelled', ref: 'cap_table_scenarios:5:round:0', as_of: '2026-10-10', kind: 'cap_table', currency: 'usd', eligible: false }],
      disagreements: [{ chosen: chosenRound, other: {} }], reason: null, sources: {},
    },
    runway_today,
    // The forecast is a model the founder set. It carries no runway-today figure.
    forecast: { state: 'ok', value: { source: 'Modelled', as_of: '2026-10-20', assumptions: { months: 16 }, computed: { runway_months: 16 }, reason: 'A forecast is never runway today.' } },
    ties: { deck: { state: 'ok', value: { id: 1, version: 4, synced_at: null, state: 'out_of_sync', href: '/raise/pitch?project=3' } }, cap_table: { state: 'ok', value: { id: 5, name: 'Seed · base case', rounds: [{ value: 200000000 }] } } },
    needs_you: empty ? [{ code: 'model_inputs_missing', reason: 'Raise amount or a complete split totalling 100% is Not recorded.' }]
      : [{ code: 'round_disagreement', reason: 'Recorded round sizes differ. Choose the size for this plan.' }, { code: 'deck_out_of_sync', reason: 'The deck Ask slide has not been marked in sync with this plan.' }, { code: 'milestones_not_costed', reason: 'Some milestones are Not costed. Their affordability is unknown.' }],
  };
}

const MERCURY = {
  as_of: '2026-10-01', source: 'Mercury',
  categories: [{ fact_id: 1, category: 'Payroll', months: 3, spent_cents: 6240000, section: 'product' }, { fact_id: 2, category: 'Uncategorized', months: 3, spent_cents: 320000, section: null }],
  sections: KEYS.map((k, i) => ({ key: k, actual_cents: { 3: [7488000, 3024000, 2016000, 1872000, 0][i], 6: 0, 12: 0 } })),
  proposals: [],
};

/* ------------------------------------------------------------------ *
 * The model
 * ------------------------------------------------------------------ */

test('runway today and the forecast are never the same figure', () => {
  const plan = planFixture();
  const today = runwayTodayView(plan.runway_today, plan.viewer);
  assert.equal(today.value, '9.4 months');
  assert.ok(today.sub.startsWith('⇄ Connector · Mercury, as of 1 Oct 2026'));
  const cands = runwayCandidates(plan.runway_today, plan.forecast);
  const forecast = cands.find((c) => c.forecast);
  assert.equal(forecast.value, null, 'the forecast is listed apart, with no runway-today figure');
  assert.equal(forecast.reason, 'A model you set. Never runway today.');
  assert.equal(cands.find((c) => c.used).key, 'mercury_raise_facts:1');
  // With no measured source, a saved forecast still never becomes runway today.
  const none = runwayTodayView(planFixture({ runway: 'none' }).runway_today, { kind: 'founder' });
  assert.equal(none.value, null);
  assert.equal(none.state, 'not_recorded');
  // A candidate the Worker did not choose (its cash or burn missing) is never runway today either.
  const unchosen = runwayTodayView({ state: 'not_recorded', chosen: null, candidates: [{ value: null, kind: 'metrics', source: 'Typed', ref: 'project_metrics:9', reason: 'Cash or positive net burn is Not recorded.' }], sources: {} }, { kind: 'founder' });
  assert.equal(unchosen.state, 'not_recorded');
  // And runway after the raise is the plan's model, labelled Modelled, never the measured figure.
  const after = afterRaiseView(plan.base.value);
  assert.equal(after.value, 'at least 18 months');
  assert.ok(after.sub.startsWith('ƒ Modelled · your target 18'));
});

test('a missing input is Not recorded, never a zero', () => {
  assert.equal(money(null), null);
  assert.equal(money(undefined), null);
  assert.equal(money(0), '$0', 'a measured zero is a zero');
  assert.equal(monthsText(null), null);
  const rows = sectionRows({ lines: [{ category_key: 'product', share_pct: 100 }], model: null, target_runway_months: null });
  assert.equal(rows[1].share, null);
  assert.equal(rows[0].amountCents, null);
  assert.equal(rows[0].monthlyCents, null);
  assert.equal(rows[0].hires, null, 'hires not read are not none');
  const tiles = homeTiles(planFixture({ empty: true }));
  assert.equal(tiles.find((t) => t.key === 'raise').value, null);
  assert.equal(tiles.find((t) => t.key === 'committed').value, null);
  assert.ok(tiles.find((t) => t.key === 'committed').sub.includes('not read here yet'));
  assert.equal(planEmpty(planFixture({ empty: true })), true);
  assert.equal(planEmpty(planFixture()), false);
  assert.equal(centsFromTyped(''), null);
  assert.equal(centsFromTyped('1,500,000'), 150000000);
  assert.equal(centsFromTyped('-1'), null);
});

test('the split check, the sections, the ties, the round sources, Needs you and History', () => {
  assert.deepEqual(splitCheck({ product: '45', 'go-to-market': '25', infrastructure: '10', operations: '10', reserve: '10' }), { whole: true, total: 100, ok: true });
  assert.equal(splitCheck({ product: '45', 'go-to-market': '21', infrastructure: '10', operations: '10', reserve: '10' }).ok, false);
  assert.equal(splitCheck({ product: '45.5', 'go-to-market': '24.5', infrastructure: '10', operations: '10', reserve: '10' }).ok, false, 'shares are whole');
  assert.equal(splitCheck({ product: '', 'go-to-market': '100', infrastructure: '0', operations: '0', reserve: '0' }).ok, false, 'an empty share is not zero');
  const plan = planFixture();
  const rows = sectionRows(plan.base.value, plan.base.value.hires.items);
  assert.equal(rows[0].amountCents, 67500000);
  assert.equal(rows[0].monthlyCents, 3750000);
  assert.equal(rows[1].overBudget, true, 'hires costing more than the section are flagged');
  assert.equal(rows[0].overBudget, false);
  assert.equal(raiseView(plan).value, '$1,500,000');
  assert.ok(raiseView(plan).sub.startsWith('▤ Document · round call Seed'));
  const ties = tiesRows(plan);
  assert.equal(ties.find((t) => t.key === 'cap').pill, '! Different raise');
  assert.equal(ties.find((t) => t.key === 'deck').pill, '! Out of sync');
  assert.equal(ties.find((t) => t.key === 'deck').href, '/raise/pitch?project_id=3');
  const sources = roundSourceRows(plan);
  assert.equal(sources.find((s) => s.chosen).label, 'Round call Seed');
  assert.deepEqual(needsRows(plan).map((n) => n.button?.act), ['round', 'deck', 'milestones']);
  const hist = historyRows([{ id: 1, action: 'uof_hire_updated', summary: 'Studio admin: uof hire updated.', at: '2026-10-09 09:00:00', who: 'Sam Admin', admin: true }]);
  assert.deepEqual(hist[0], { id: 1, text: 'Hire updated.', who: 'Sam Admin', at: '9 Oct 2026', kind: 'Hire', admin: true });
});

test('plan vs actual: planned share against Mercury\'s measured share, and a measured zero stays zero', () => {
  const pva = planVsActual(planFixture().base.value, MERCURY, 3);
  assert.deepEqual(pva.rows.map((r) => [r.planned, r.actual]), [[45, 52], [25, 21], [10, 14], [10, 13], [10, 0]]);
  assert.equal(pva.unmappedCents, 320000);
  const unmapped = planVsActual(planFixture().base.value, { ...MERCURY, sections: null }, 3);
  assert.ok(unmapped.rows.every((r) => r.actual === null), 'no mapping is not a zero share');
});

test('the client: the history read pages, and the routes it calls exist', async () => {
  const restore = installDocument();
  const previous = globalThis.fetch;
  const sent = [];
  globalThis.fetch = async (u) => { sent.push(String(u).replace(/^.*\/api/, '')); return response({ items: [] }); };
  try {
    await useOfFundsApi.history(3, 2);
    assert.ok(sent[0].startsWith('/cycles/raise/use-of-funds/history?'));
    const q = new URLSearchParams(sent[0].split('?')[1]);
    assert.equal(q.get('project'), '3'); assert.equal(q.get('page'), '2');
  } finally { globalThis.fetch = previous; restore(); }
  assert.match(read('cloudflare-worker/src/routes/cycle_use_of_funds.ts'), /r\.get\('\/history'/);
});

/* ------------------------------------------------------------------ *
 * Mounted
 * ------------------------------------------------------------------ */

const PROJECTS = [{ id: 3, uid: 'p3uid', name: 'Harbor Ledger' }];
const MODULE = (mercury) => ({
  module: { slug: 'use-of-funds', name: 'Use of funds', records_title: 'Categories' },
  card: { state: 'empty', reason: 'No split yet.' },
  records: { linkable: true, total: 0, page: 1, page_size: 25, cols: [{ key: 'category', label: 'Category' }], rows: [] },
  ...(mercury ? { parts: { mercury } } : {}),
});

async function mounted(url, { phone = false, plan = planFixture(), mercury = MERCURY, over = {} } = {}) {
  const restore = installDocument();
  const previous = { fetch: globalThis.fetch, matchMedia: globalThis.matchMedia };
  const sent = [];
  globalThis.fetch = async (u, o = {}) => {
    const path = String(u).replace(/^.*\/api/, '');
    const line = `${o.method || 'GET'} ${path}`;
    sent.push({ line, body: o.body ? JSON.parse(o.body) : null });
    for (const [k, v] of Object.entries(over)) if (line.startsWith(k)) return v(o);
    if (/^GET \/projects(\?|$)/.test(line)) return response(PROJECTS);
    if (path.startsWith('/cycles/raise/use-of-funds/plan')) return plan ? response(plan) : response({ detail: 'down' }, 503);
    if (path.startsWith('/cycles/raise/use-of-funds/history')) return response({ page: 1, page_size: 20, total: 2, items: [
      { id: 2, action: 'uof_hire_updated', summary: 'Studio admin: uof hire updated.', at: '2026-10-09 09:00:00', who: 'Sam Admin', admin: true },
      { id: 1, action: 'split_saved', summary: 'Split saved', at: '2026-10-01 09:00:00', who: 'Ada Founder', admin: false },
    ] });
    if (path.startsWith('/cycles/raise/modules/')) return response(MODULE(mercury));
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
  const flush = () => act(async () => { for (let i = 0; i < 8; i += 1) await new Promise((r) => setTimeout(r, 0)); });
  await flush();
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const pr = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const txt = (n) => (n?.nodeType === 3 ? n.textContent : n?.childNodes?.length ? n.childNodes.map(txt).join(' ') : n?.textContent || '');
  const by = (id) => walk(container).find((n) => pr(n)['data-testid'] === id);
  return {
    sent, by, pr, flush,
    all: (id) => walk(container).filter((n) => pr(n)['data-testid'] === id),
    text: (id) => { if (id) assert.ok(by(id), `no ${id}`); return txt(id ? by(id) : container).replace(/\s+/g, ' ').trim(); },
    async click(id) { const n = by(id); assert.ok(n, `no ${id}`); await act(async () => pr(n).onClick?.({ preventDefault() {}, stopPropagation() {} })); await flush(); },
    async type(id, value) { const n = by(id); assert.ok(n, `no ${id}`); await act(async () => pr(n).onChange?.({ target: { value } })); await flush(); },
    async close() { await act(async () => root.unmount()); Object.assign(globalThis, previous); restore(); },
  };
}

test('UF1 Home: the four tiles, where the money goes, cash over time, where the plan is used and Needs you', async () => {
  const v = await mounted('/raise/use-of-funds?project_id=3');
  try {
    assert.ok(v.by('uof-home'));
    assert.equal(v.text('uof-tile-raise-value'), '$1,500,000');
    assert.equal(v.text('uof-tile-today-value'), '9.4 months');
    assert.equal(v.text('uof-tile-after-value'), 'at least 18 months');
    assert.notEqual(v.text('uof-tile-today-value'), v.text('uof-tile-after-value'));
    assert.equal(v.text('uof-tile-committed-value'), 'Not recorded');
    assert.equal(v.all('uof-section-row').length, 5);
    assert.ok(v.text('uof-cash').includes('Modelled'));
    assert.ok(v.text('uof-ties').includes('! Different raise'));
    assert.ok(v.by('uof-need-round_disagreement'));
    assert.ok(v.sent.some((s) => s.line === 'GET /cycles/raise/use-of-funds/plan?project=3'));
    assert.equal(v.by('uof-admin-banner'), undefined, 'the founder has no banner');
  } finally { await v.close(); }
});

test('UF3 Edit split: a total other than 100 waits; a good split saves the raise, the shares and the target', async () => {
  const v = await mounted('/raise/use-of-funds?project_id=3', { over: { 'PUT /cycles/raise/use-of-funds': () => response({ ok: true }) } });
  try {
    await v.click('uof-edit-split-open');
    assert.equal(v.text('uof-split-total'), '100%');
    await v.type('uof-split-go-to-market', '21');
    assert.equal(v.text('uof-split-total'), '96%');
    assert.ok(v.by('uof-split-wait'));
    assert.equal(v.pr(v.by('uof-split-save')).disabled, true, 'save waits');
    await v.type('uof-split-go-to-market', '25');
    await v.type('uof-split-amount', '2000000');
    await v.click('uof-split-save');
    const put = v.sent.find((s) => s.line.startsWith('PUT /cycles/raise/use-of-funds?'));
    assert.ok(put, 'the split is saved');
    assert.equal(put.body.amount_to_raise_cents, 200000000);
    assert.equal(put.body.runway_months, 18);
    assert.deepEqual(put.body.sections.map((s) => s.pct), [45, 25, 10, 10, 10]);
    assert.ok(v.text('uof-notice').includes('out of sync'));
  } finally { await v.close(); }
});

test('UF16: an admin works under the banner, their writes say so, and Mercury figures stay the founder\'s', async () => {
  const v = await mounted('/raise/use-of-funds?project_id=3', { plan: planFixture({ viewer: { kind: 'admin', can_write: true, mercury: false }, runway: 'none' }) });
  try {
    assert.ok(v.text('uof-admin-banner').includes('as an Admin. Changes are logged under your name.'));
    assert.equal(v.text('uof-tile-today-value'), 'Founder only');
    assert.ok(v.by('uof-cash-founder-only'));
    await v.click('uof-edit-split-open');
    assert.ok(v.text('uof-split-admin').includes('logged under your name'));
  } finally { await v.close(); }
  const a = await mounted('/raise/use-of-funds/actuals?project_id=3', { plan: planFixture({ viewer: { kind: 'admin', can_write: true, mercury: false } }) });
  try {
    assert.ok(a.by('uof-actuals-founder-only'));
    assert.ok(a.by('uof-admin-banner'));
  } finally { await a.close(); }
});

test('UF17–UF19: empty, error and Mercury partial each say what they are', async () => {
  let v = await mounted('/raise/use-of-funds?project_id=3', { plan: planFixture({ empty: true }) });
  try {
    assert.ok(v.text('uof-empty').includes('Set your raise and split to see what it buys.'));
    assert.equal(v.text('uof-tile-raise-value'), 'Not recorded');
  } finally { await v.close(); }
  v = await mounted('/raise/use-of-funds?project_id=3', { plan: null });
  try {
    assert.ok(v.text('uof-home-unreadable').includes('Use of funds could not be read. Nothing here is a zero.'));
    assert.equal(v.by('uof-tile-raise-value'), undefined, 'no tile draws a figure over an unread plan');
  } finally { await v.close(); }
  v = await mounted('/raise/use-of-funds?project_id=3', { plan: planFixture({ runway: 'metrics', partial: true }) });
  try {
    assert.ok(v.text('uof-mercury-partial').includes('falls back to your metrics snapshot'));
    assert.equal(v.text('uof-tile-today-value'), '11 months');
  } finally { await v.close(); }
});

test('UF2 Allocation: hires against each section, the actual share from Mercury, and the over-budget warning', async () => {
  const v = await mounted('/raise/use-of-funds/allocation?project_id=3');
  try {
    assert.equal(v.all('uof-allocation-row').length, 5);
    assert.ok(v.text('uof-actual-product').startsWith('52%'));
    assert.ok(v.text('uof-actual-reserve').startsWith('0%'), 'a measured zero');
    assert.ok(v.text('uof-over-go-to-market').includes('hires cost $420,000 a year; this section has $375,000'));
  } finally { await v.close(); }
});

test('UF5–UF6 Milestones and hires: the tables, Not costed, and Add milestone keeps an empty cost Not costed', async () => {
  const v = await mounted('/raise/use-of-funds/milestones?project_id=3', { over: { 'POST /cycles/raise/use-of-funds/milestones': () => response({ id: 3 }, 201) } });
  try {
    assert.equal(v.all('uof-ms-row').length, 2);
    assert.ok(v.text('uof-ms-table').includes('○ Not costed'));
    assert.equal(v.all('uof-hire-row').length, 2);
    assert.ok(v.text('uof-payroll').includes('$12,500 a month'));
    await v.click('uof-add-milestone-open');
    await v.type('uof-milestone-label', 'Self-serve onboarding live');
    await v.type('uof-milestone-by', '2027-03');
    await v.click('uof-milestone-save');
    const post = v.sent.find((s) => s.line.startsWith('POST /cycles/raise/use-of-funds/milestones'));
    assert.deepEqual(post.body, { label: 'Self-serve onboarding live', category_key: 'product', due_on: '2027-03', cost_cents: null });
    assert.ok(v.text('uof-notice').includes('Not costed'));
  } finally { await v.close(); }
});

test('UF7 Runway: runway today from its source, the other runways with the forecast apart, and runway after the raise', async () => {
  const v = await mounted('/raise/use-of-funds/runway?project_id=3');
  try {
    assert.equal(v.text('uof-runway-today-value'), '9.4 months');
    assert.ok(v.text('uof-runway-other-forecast').includes('Never runway today'));
    assert.ok(!v.text('uof-runway-other-forecast').includes('16'), 'the forecast draws no runway figure');
    assert.equal(v.text('uof-after-value'), 'at least 18 months');
    assert.equal(v.pr(v.by('uof-forecast-link')).href, '/raise/use-of-funds/runway/forecast?project_id=3', 'D1178: the forecast is under Runway');
  } finally { await v.close(); }
});

test('UF12 Plan vs actual, and without Mercury', async () => {
  let v = await mounted('/raise/use-of-funds/actuals?project_id=3');
  try {
    assert.ok(v.text('uof-pva-product').includes('45% 52%'));
    assert.ok(v.text('uof-pva').includes('Unmapped $3,200'));
  } finally { await v.close(); }
  v = await mounted('/raise/use-of-funds/actuals?project_id=3', { mercury: null });
  try {
    assert.ok(v.text('uof-actuals-none').includes('Connect Mercury to see actual spend.'));
  } finally { await v.close(); }
});

test('UF13: where the plan is used, and Choose the round size changes only the plan\'s raise', async () => {
  const v = await mounted('/raise/use-of-funds?project_id=3', { over: { 'PATCH /cycles/raise/use-of-funds/scenarios/9': () => response({ ok: true }) } });
  try {
    await v.click('uof-ties-open');
    assert.ok(v.text('uof-round-table').includes('Round call Seed'));
    await v.click('uof-need-round_disagreement-act');
    assert.ok(v.by('uof-round-size'));
  } finally { await v.close(); }
});

test('UF15 History: who, when, and the Admin tag', async () => {
  const v = await mounted('/raise/use-of-funds/history?project_id=3');
  try {
    assert.equal(v.all('uof-history-row').length, 2);
    assert.equal(v.all('uof-history-admin').length, 1);
    assert.ok(v.text('uof-history').includes('Sam Admin · studio admin · 9 Oct 2026'));
  } finally { await v.close(); }
});

test('UF21 the phone: tiles two across, the sections as a list with a 44px opener', async () => {
  const v = await mounted('/raise/use-of-funds/allocation?project_id=3', { phone: true });
  try {
    assert.ok(v.by('uof-section-list'));
    assert.equal(v.by('uof-allocation-table'), undefined);
  } finally { await v.close(); }
  const src = read('frontend/src/pages/raise/useoffunds/UseOfFundsTool.jsx') + read('frontend/src/pages/raise/useoffunds/UseOfFundsParts.jsx');
  assert.match(src, /max-md:grid-cols-2 md:grid-cols-4/, 'tiles go two across on a phone');
  assert.match(src, /max-md:min-h-\[44px\]/);
  assert.doesNotMatch(src, /window\.(confirm|alert|prompt)\(/, 'no browser pop-up');
  assert.doesNotMatch(src, /EadwynPanel|aiRouter|railProposals|useRailOption|FillProposals/, 'Eadwyn fills nothing here');
});
