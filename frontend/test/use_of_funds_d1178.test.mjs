// D1178 (#3105) — Use of funds part 5: Scenarios (UF9), Scenarios compared
// (UF10, UF11) and Runway › Forecast (UF8), and the financial model's old
// addresses landing on Forecast with the venture.
//
// Run with:
//   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/use_of_funds_d1178.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import CycleRoute from '../src/pages/cycles/CycleRoute.jsx';
import UseOfFundsMovedRedirect from '../src/pages/raise/useoffunds/UseOfFundsMovedRedirect.jsx';
import { REDIRECT_ROUTES } from '../../cloudflare-worker/src/services/redirectRoutes.ts';
import {
  DRIVERS, compareHref, compareIds, compareTable, driverError, driverRows, driversBody, forecastGap, forecastSeries, forecastTiles,
  makeBaseView, movedNotice, movedTo, scenarioBody, scenarioCard, sensitivityRows,
} from '../src/pages/raise/useoffunds/scenariosForecastModel.js';
import { forecastHref } from '../src/pages/raise/useoffunds/useOfFundsModel.js';

const h = React.createElement;
const read = (path) => readFileSync(path, 'utf8');
const response = (body, status = 200) => ({ ok: status < 400, status, headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body) });

/* ------------------------------------------------------------------ *
 * Fixtures: the shapes `routes/financials.ts` and D1176's view() return
 * ------------------------------------------------------------------ */

const ASSUMPTIONS = {
  starting_cash: 500000, price_per_unit: 99, units_month_0: 50, monthly_growth_pct: 12, monthly_churn_pct: 4, cac: 80,
  gross_margin_pct: 70, salaries_monthly: 18000, opex_monthly: 4500, horizon_months: 24,
  _sources: { starting_cash: 'typed', price_per_unit: 'stripe', units_month_0: 'stripe' },
};
const FORECAST = {
  project_id: 3, exists: true, assumptions: ASSUMPTIONS,
  computed: {
    months: [
      { month: 0, units: 50, revenue: 4950, gross_profit: 3465, marketing: 0, fixed_cost: 22500, net: -19035, cash: 480965 },
      { month: 1, units: 54, revenue: 5346, gross_profit: 3742, marketing: 320, fixed_cost: 22500, net: -19078, cash: 461887 },
      { month: 2, units: 58, revenue: 5742, gross_profit: 4019, marketing: 320, fixed_cost: 22500, net: -18801, cash: 0 },
    ],
    runway_months: 14, runway_capped: true, avg_monthly_burn: 19000, breakeven_month: null, ending_cash: 0, ltv: 1732, ltv_cac_ratio: 21.65,
  },
  sensitivity: { deltas_pct: [-20, 0, 20], rows: [
    { driver: 'price_per_unit', label: 'Price per unit', cells: [{ delta_pct: -20, runway_months: 12.4 }, { delta_pct: 0, runway_months: 14 }, { delta_pct: 20, runway_months: 15.9 }] },
    { driver: 'cac', label: 'CAC', cells: [{ delta_pct: -20, runway_months: 14.2 }, { delta_pct: 0, runway_months: 14 }, { delta_pct: 20, runway_months: null }] },
  ] },
  capital_recompute: { total: 9, max: 10, factors: {} },
};
const lines = (shares) => ['product', 'go-to-market', 'infrastructure', 'operations', 'reserve'].map((k, i) => ({ category_key: k, share_pct: shares[i] }));
const block = (value, reason = null) => ({ source: 'Modelled', state: value == null ? 'not_recorded' : 'ok', value, reason });
const BASE = {
  id: 1, name: 'Seed plan', is_base: 1, currency: 'USD', amount_to_raise_cents: 200000000, target_runway_months: 18, updated_at: '2026-10-20T10:00:00Z',
  lines: lines([40, 30, 10, 10, 10]),
  milestones: [{ id: 11, category_key: 'product', label: 'Ship v2', cost_cents: 5000000 }, { id: 12, category_key: 'go-to-market', label: 'First AE', cost_cents: null }],
  model: {
    burn: block([{ month: '2026-11', spendCents: 9000000 }, { month: '2026-12', spendCents: 11000000 }]),
    cashPath: block([{ month: '2026-11', closingCents: 191000000 }, { month: '2026-12', closingCents: 180000000 }]),
    cashOut: block({ months: 16, withinHorizon: false }),
    runway: block({ months: 16, relation: 'exact' }),
    milestones: block([{ id: 11, state: 'Funded' }, { id: 12, state: 'Not costed' }]),
  },
};
const LEAN = {
  id: 2, name: 'Lean', is_base: 0, currency: 'USD', amount_to_raise_cents: null, target_runway_months: 18, updated_at: '2026-10-21T10:00:00Z',
  lines: [], milestones: [],
  model: { burn: block(null, 'Needs a raise and a split.'), cashPath: block(null, 'Needs a raise and a split.'), cashOut: block(null, 'Needs a raise and a split.'),
    runway: block(null, 'Needs a raise and a split.'), milestones: block([]) },
};
const SHORT = { ...BASE, id: 3, name: 'Small round', is_base: 0, model: { ...BASE.model, runway: block({ months: 12, relation: 'exact' }) } };
const TODAY = { state: 'ok', chosen: { kind: 'metrics', ref: 'm1', source: 'Typed', value: 7, cash_cents: 70000000, burn_cents: 10000000, as_of: '2026-10-01' }, candidates: [], partial: false, sources: {} };

const PROJECTS = [{ id: 3, uid: 'p3uid', name: 'Harbor Ledger' }];
function handler(url, options = {}) {
  if (/\/api\/projects(\?|$)/.test(url)) return response(PROJECTS);
  if (/\/api\/financials\/3$/.test(url)) return response(options.method === 'PUT' ? { ok: true } : FORECAST);
  if (url.includes('/use-of-funds/scenarios?')) return response(options.method === 'POST' ? { id: 9 } : { items: [BASE, LEAN, SHORT] });
  if (url.includes('/use-of-funds/compare?')) return response({ today: TODAY, scenarios: [BASE, LEAN], source: 'Modelled', reason: 'Today is the measured record.' });
  if (/\/use-of-funds\/scenarios\/\d+/.test(url)) return response({ ok: true });
  if (url.includes('/cycles/raise/modules/')) return response({ module: { slug: 'use-of-funds', name: 'Use of funds' }, card: { state: 'empty' }, records: { rows: [], cols: [] } });
  return response({});
}

let landed = null;
function Where() { const l = useLocation(); landed = `${l.pathname}${l.search}${l.hash}`; return null; }

async function mounted(url, { phone = false, handle = handler } = {}) {
  const restore = installDocument();
  const previous = { fetch: globalThis.fetch, matchMedia: globalThis.matchMedia };
  const requests = [];
  globalThis.fetch = async (u, options = {}) => { requests.push({ url: String(u), method: options.method || 'GET', body: options.body }); return handle(String(u), options); };
  globalThis.matchMedia = () => ({ matches: phone, addEventListener() {}, removeEventListener() {} });
  const create = document.createElement.bind(document);
  document.createElement = (tag) => { const node = create(tag); node.querySelector = () => null; node.querySelectorAll = () => []; node.focus = () => {}; node.children = []; return node; };
  document.body.style = { overflow: 'auto', paddingRight: '' };
  document.getElementById = () => null;
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  // The routes as App.jsx declares them for these addresses.
  await act(async () => root.render(h(MemoryRouter, { initialEntries: [url] }, h(Where), h(Routes, null,
    h(Route, { path: '/build/financials', element: h(UseOfFundsMovedRedirect) }),
    h(Route, { path: '/raise/capital/model', element: h(UseOfFundsMovedRedirect) }),
    h(Route, { path: '/raise/use-of-funds/runway/forecast', element: h(CycleRoute, { cycle: 'raise', slug: 'use-of-funds', uofSub: 'forecast' }) }),
    h(Route, { path: '/raise/use-of-funds/scenarios/compare', element: h(CycleRoute, { cycle: 'raise', slug: 'use-of-funds', uofSub: 'compare' }) }),
    h(Route, { path: '/raise/:slug', element: h(CycleRoute, { cycle: 'raise' }) }),
    h(Route, { path: '/raise/:slug/:id', element: h(CycleRoute, { cycle: 'raise', record: true }) }),
  ))));
  const flush = () => act(async () => { for (let i = 0; i < 8; i += 1) await new Promise((r) => setTimeout(r, 0)); });
  await flush();
  const nodes = () => { const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)]; return walk(container); };
  const text = (n) => (n?.nodeType === 3 ? n.textContent : n?.childNodes?.length ? n.childNodes.map(text).join('') : n?.textContent || '');
  const pr = (n) => Object.entries(n).find(([key]) => key.startsWith('__reactProps$'))?.[1] || {};
  const all = (id) => nodes().filter((n) => pr(n)['data-testid'] === id);
  const by = (id) => all(id)[0];
  return {
    requests, flush, by, all, pr, text: () => text(container), textOf: (id) => text(by(id)),
    ids: () => nodes().map((n) => pr(n)['data-testid']).filter(Boolean),
    hrefs: (under = container) => { const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)]; return walk(under).filter((n) => String(n.tagName).toUpperCase() === 'A').map((n) => pr(n).href || pr(n).to).filter(Boolean); },
    async click(node) { const n = typeof node === 'string' ? by(node) : node; assert.ok(n, `no ${node}`); await act(async () => pr(n).onClick?.({ preventDefault() {}, stopPropagation() {} })); await flush(); },
    async change(node, value) { const n = typeof node === 'string' ? by(node) : node; assert.ok(n, `no ${node}`); await act(async () => pr(n).onChange?.({ target: { value, checked: value } })); await flush(); },
    async close() { await act(async () => root.unmount()); Object.assign(globalThis, previous); restore(); },
  };
}
const writes = (v) => v.requests.filter((r) => r.method !== 'GET');

/* ------------------------------------------------------------------ *
 * The model
 * ------------------------------------------------------------------ */

test('an old address lands on Forecast with the venture, its query and the moved notice', () => {
  assert.deepEqual(movedTo('?project=7&tab=x'), { pathname: '/raise/use-of-funds/runway/forecast', search: '?tab=x&project_id=7&moved=capital-model' });
  assert.deepEqual(movedTo('?project_id=7&project=8'), { pathname: '/raise/use-of-funds/runway/forecast', search: '?project_id=7&moved=capital-model' }, 'the tool\'s own key wins');
  assert.deepEqual(movedTo(''), { pathname: '/raise/use-of-funds/runway/forecast', search: '?moved=capital-model' });
  assert.equal(movedNotice('?moved=capital-model'), 'Financial model is now Forecast, under Use of funds › Runway.');
  assert.equal(movedNotice('?moved=other'), null);
  assert.equal(forecastHref('?project_id=3&x=1'), '/raise/use-of-funds/runway/forecast?project_id=3');
  assert.equal(compareHref([1, 2], '?project_id=3&x=1'), '/raise/use-of-funds/scenarios/compare?project_id=3&ids=1%2C2');
  assert.deepEqual(compareIds('?ids=2,2,0,x,5,6,7,8'), [2, 5, 6, 7], 'one to four distinct whole ids');
  assert.deepEqual(compareIds('?ids='), []);
});

test('the ten drivers each name their source; an empty one is Not recorded and stops the forecast', () => {
  assert.equal(DRIVERS.length, 10);
  const rows = driverRows(FORECAST);
  assert.deepEqual(rows.map((r) => r.value), ['$500,000', '$99', '50', '12%', '4%', '$80', '70%', '$18,000', '$4,500', '24 months']);
  assert.deepEqual(rows.slice(0, 4).map((r) => [r.source, r.detail]), [['Typed', ''], ['Connector', 'Stripe'], ['Connector', 'Stripe'], [null, 'Source not recorded']]);
  assert.equal(forecastGap(FORECAST), null);
  const gap = { ...FORECAST, assumptions: { ...ASSUMPTIONS, cac: null } };
  assert.equal(forecastGap(gap), 'Add cac to run the forecast.');
  assert.ok(driverRows(gap).find((r) => r.key === 'cac').missing);
  assert.equal(forecastSeries(gap), null, 'no chart from an incomplete forecast');
  assert.equal(sensitivityRows(gap), null);
  for (const t of forecastTiles(gap)) assert.equal(t.value, null, `${t.key} is Not recorded, never 0`);
  assert.equal(forecastGap({ exists: false, assumptions: null }), 'No forecast is saved yet. Set the ten drivers to run it.');
});

test('the forecast\'s tiles are Modelled; breakeven outside the forecast says so; the sensitivity outlines the base', () => {
  const tiles = forecastTiles(FORECAST);
  assert.deepEqual(tiles.map((t) => t.value), ['14 months', '$19,000 a month', 'Not within 24 months', '21.7']);
  for (const t of tiles) assert.match(t.sub, /Modelled/);
  const series = forecastSeries(FORECAST);
  assert.deepEqual(series.cash.map((p) => p.cents), [48096500, 46188700, 0]);
  assert.equal(series.cashOut, 2);
  const sens = sensitivityRows(FORECAST);
  assert.deepEqual(sens.map((r) => r.label), ['Price', 'CAC']);
  assert.deepEqual(sens[0].cells.map((c) => [c.text, c.base]), [['12.4', false], ['14.0', true], ['15.9', false]]);
  assert.equal(sens[1].cells[2].text, 'Not recorded', 'a missing cell is never 0');
});

test('Edit drivers: every driver as a number, growth may shrink, the length is 3 to 60 months', () => {
  const values = Object.fromEntries(DRIVERS.map((d) => [d.key, String(ASSUMPTIONS[d.key])]));
  assert.deepEqual(driversBody(values).assumptions.starting_cash, 500000);
  assert.equal(driverError('money', ''), 'An empty driver stops the forecast.');
  assert.equal(driverError('money', '-1'), 'Type a number, 0 or more.');
  assert.equal(driverError('pct', '101'), 'A percentage is 100 at most.');
  const growth = DRIVERS.find((d) => d.key === 'monthly_growth_pct');
  assert.equal(driverError('pct', '-20', growth), null, 'the store takes negative growth');
  assert.equal(driverError('pct', '150', growth), null);
  assert.equal(driverError('pct', '201', growth), 'Type a number from -100 to 200.');
  assert.equal(driverError('months', '2'), 'The forecast runs 3 to 60 whole months.');
  assert.equal(driverError('count', '1.5'), 'Type a whole number.');
  assert.ok(driversBody({ ...values, cac: '' }).errors.cac);
});

test('a scenario card, Make this the base\'s warning, and an Edit body with no raise not recorded', () => {
  const c = scenarioCard(BASE);
  assert.equal(c.raise, '$2,000,000');
  assert.equal(c.milestones, '1 of 2 · 1 not costed');
  assert.equal(c.capTable, 'No cap-table scenario linked');
  assert.equal(scenarioCard(LEAN).raise, null);
  assert.equal(scenarioCard(LEAN).milestones, 'No milestones yet');
  assert.equal(makeBaseView(SHORT).warning, 'Small round runs 6 months short of your target.');
  assert.equal(makeBaseView(BASE).warning, 'Seed plan runs 2 months short of your target.');
  assert.equal(makeBaseView({ ...BASE, target_runway_months: 16 }).warning, null, 'meeting the target warns of nothing');
  assert.match(makeBaseView(LEAN).blocked, /complete split/);
  const shares = { product: '40', 'go-to-market': '30', infrastructure: '10', operations: '10', reserve: '10' };
  assert.deepEqual(scenarioBody({ name: ' Seed ', raise: '', target: '18', shares: {} }).body, { name: 'Seed', amount_to_raise_cents: null, target_runway_months: 18 });
  assert.equal(scenarioBody({ name: 'Seed', raise: '1,500,000', target: '18', shares }).body.amount_to_raise_cents, 150000000);
  assert.equal(scenarioBody({ name: 'Seed', raise: '1', target: '18', shares: { ...shares, reserve: '5' } }).error, 'The shares add to 95%. They must add to 100%.');
  assert.equal(scenarioBody({ name: '', raise: '1', target: '18' }).error, 'Name the scenario.');
  assert.match(scenarioBody({ name: 'x', raise: '1', target: '0' }).error, /1 to 120/);
});

test('compare: Today is the record, each scenario Modelled, and nothing unrecorded is a zero', () => {
  const t = compareTable({ today: TODAY, scenarios: [BASE, LEAN] });
  const row = (k) => t.rows.find((r) => r.key === k);
  assert.deepEqual(t.cols.map((c) => c.name), ['Seed plan · base', 'Lean']);
  assert.equal(row('runway').today.text, '7 months · runway today');
  assert.deepEqual(row('runway').cells.map((c) => c.text), ['16 months', 'Not recorded']);
  assert.deepEqual(row('raise').cells.map((c) => c.text), ['$2,000,000', 'Not recorded']);
  assert.equal(row('product').cells[0].text, '$800,000');
  assert.equal(row('burn').cells[0].text, '$100,000 a month');
  assert.equal(row('cashout').cells[0].text, 'after 2026-12');
  assert.equal(row('founders').cells[0].reason, 'No cap-table scenario linked');
  for (const r of t.rows) for (const c of r.cells) assert.ok(!/^\$0$|^0$/.test(c.text), `${r.key} draws a zero`);
});

/* ------------------------------------------------------------------ *
 * Old addresses, mounted
 * ------------------------------------------------------------------ */

test('every old address lands on Forecast with the venture, and Forecast reads that venture', async () => {
  for (const [from, to] of [
    ['/raise/capital/model?project=3', '/raise/use-of-funds/runway/forecast?project_id=3&moved=capital-model'],
    ['/raise/capital/model?project_id=3#cash', '/raise/use-of-funds/runway/forecast?project_id=3&moved=capital-model#cash'],
    ['/build/financials?project=3', '/raise/use-of-funds/runway/forecast?project_id=3&moved=capital-model'],
  ]) {
    const v = await mounted(from);
    try {
      assert.equal(landed, to, from);
      assert.ok(v.requests.some((r) => /\/api\/financials\/3$/.test(r.url)), `${from} reads the venture's forecast`);
      assert.equal(v.textOf('uof-moved').replace('Dismiss', ''), 'Financial model is now Forecast, under Use of funds › Runway.');
      await v.click('uof-moved-dismiss');
      assert.ok(!v.by('uof-moved'), 'the notice goes once dismissed');
    } finally { await v.close(); }
  }
  const listed = new Set(REDIRECT_ROUTES.map((r) => r.path));
  for (const p of ['/raise/capital/model', '/build/financials']) assert.ok(listed.has(p), `${p} joins the redirect inventory`);
});

/* ------------------------------------------------------------------ *
 * Forecast, mounted
 * ------------------------------------------------------------------ */

test('Forecast (UF8): ten drivers with sources, the tiles, two charts, the sensitivity; Modelled; no Capital score', async () => {
  const v = await mounted('/raise/use-of-funds/runway/forecast?project_id=3');
  try {
    assert.ok(v.ids().includes('uof-forecast-page') && v.ids().includes('uof-tabs'));
    assert.equal(DRIVERS.filter((d) => v.by(`uof-driver-row-${d.key}`)).length, 10);
    assert.match(v.textOf('uof-driver-row-price_per_unit'), /Connector\s?·\s?Stripe/);
    assert.match(v.textOf('uof-forecast-tile-runway'), /14 months[\s\S]*Modelled/);
    assert.ok(v.by('uof-forecast-cash-chart') && v.by('uof-forecast-revenue-chart'));
    assert.ok(v.by('uof-sensitivity-price_per_unit') && v.by('uof-sensitivity-cac'));
    for (const card of ['uof-forecast-cash', 'uof-forecast-revenue', 'uof-sensitivity']) assert.match(v.textOf(card), /Modelled/, card);
    assert.doesNotMatch(v.text(), /Capital score|capital_recompute|9 \/ 10|9 of 10/, 'no Capital score is drawn');
    assert.match(v.text(), /It is not your runway today/);
    assert.ok(v.hrefs().includes('/raise/use-of-funds/runway?project_id=3'), 'back to Runway with the venture');
    assert.ok(!v.by('uof-moved'), 'no notice on a direct visit');
  } finally { await v.close(); }
});

test('Edit drivers opens a dialog that names what changes, and saves all ten as numbers', async () => {
  const v = await mounted('/raise/use-of-funds/runway/forecast?project_id=3');
  try {
    await v.click('uof-drivers-edit');
    assert.ok(v.by('uof-drivers-dialog'));
    assert.equal(v.pr(v.by('uof-drivers-dialog')).role, 'dialog', 'D1317: Edit drivers opens as the shared Sheet');
    assert.ok(v.pr(v.by('uof-drivers-dialog'))['aria-labelledby']);
    assert.equal(v.pr(v.by('uof-drivers-dialog'))['data-width'], 560);
    assert.equal(v.pr(v.by('uof-drivers-dialog-go')).disabled, true, 'nothing changed, nothing to save');
    await v.change('uof-driver-cac', '');
    assert.equal(v.pr(v.by('uof-drivers-dialog-go')).disabled, true, 'an empty driver never saves');
    await v.change('uof-driver-cac', '95');
    assert.match(v.text(), /Saving changes cac and re-runs the forecast/);
    await v.click('uof-drivers-dialog-go');
    const put = writes(v).find((r) => r.method === 'PUT');
    assert.ok(put && /\/api\/financials\/3$/.test(put.url));
    const sent = JSON.parse(put.body).assumptions;
    assert.equal(Object.keys(sent).length, 10);
    assert.equal(sent.cac, 95);
    assert.ok(!('_sources' in sent), 'the store sets the source, never the page');
    assert.ok(!v.by('uof-drivers-dialog'), 'closed on save');
  } finally { await v.close(); }
});

test('Forecast: an unreadable store says so, never a zero; an incomplete forecast draws no chart', async () => {
  const bad = await mounted('/raise/use-of-funds/runway/forecast?project_id=3', { handle: (u, o) => (/\/financials\//.test(u) ? response({ detail: 'x' }, 500) : handler(u, o)) });
  try {
    assert.ok(bad.by('uof-forecast-unreadable'));
    assert.match(bad.text(), /This is not a zero/);
    assert.ok(!bad.by('uof-forecast-tiles'));
  } finally { await bad.close(); }
  const gap = { ...FORECAST, assumptions: { ...ASSUMPTIONS, starting_cash: null } };
  const g = await mounted('/raise/use-of-funds/runway/forecast?project_id=3', { handle: (u, o) => (/\/financials\//.test(u) ? response(gap) : handler(u, o)) });
  try {
    assert.ok(g.by('uof-forecast-cash-none') && !g.by('uof-forecast-cash-chart'));
    assert.match(g.textOf('uof-driver-row-starting_cash'), /Not recorded/);
    assert.match(g.textOf('uof-forecast-tile-runway'), /Not recorded[\s\S]*Add starting cash/);
  } finally { await g.close(); }
});

/* ------------------------------------------------------------------ *
 * Scenarios and Compare, mounted
 * ------------------------------------------------------------------ */

test('Scenarios (UF9): a card each, the base first and kept; Compare carries the picks and the venture', async () => {
  const v = await mounted('/raise/use-of-funds/scenarios?project_id=3');
  try {
    assert.ok(v.ids().includes('uof-scenarios-page'));
    assert.ok(!v.ids().includes('uof-wait-scenarios'), 'Scenarios no longer waits');
    assert.equal(v.textOf('uof-scenarios-count'), '3 scenarios');
    const cards = v.all('uof-scenario');
    assert.equal(cards.length, 3);
    assert.match(v.text(), /Seed plan[\s\S]*\$2,000,000/);
    assert.match(v.text(), /Raise not recorded/, 'no raise is never $0');
    assert.equal(v.all('uof-scenario-make-base').length, 2, 'the base has no Make this the base');
    assert.equal(v.all('uof-scenario-delete').length, 2, 'the base cannot be deleted');
    const picks = v.all('uof-scenario-pick');
    await v.change(picks[0], true);
    await v.change(picks[1], true);
    await v.click('uof-scenarios-compare');
    assert.equal(landed, '/raise/use-of-funds/scenarios/compare?project_id=3&ids=1%2C2');
    assert.ok(v.ids().includes('uof-compare-page'));
  } finally { await v.close(); }
});

test('Scenarios\' writes each open a dialog first: New, Edit, Make this the base (with its warning), Delete', async () => {
  const v = await mounted('/raise/use-of-funds/scenarios?project_id=3');
  try {
    await v.click('uof-scenarios-new');
    assert.equal(writes(v).length, 0, 'opening the dialog writes nothing');
    await v.change('uof-new-scenario-name', 'Bridge');
    assert.match(v.text(), /Bridge is added as a copy of Seed plan\. The base does not change\./);
    await v.click('uof-new-scenario-go');
    let w = writes(v).at(-1);
    assert.equal(w.method, 'POST');
    assert.deepEqual(JSON.parse(w.body), { name: 'Bridge', from_id: 1 });

    await v.click(v.all('uof-scenario-edit')[1]);
    await v.change('uof-edit-scenario-raise', '750000');
    await v.click('uof-edit-scenario-go');
    w = writes(v).at(-1);
    assert.equal(w.method, 'PATCH');
    assert.match(w.url, /\/scenarios\/2\?/);
    assert.deepEqual(JSON.parse(w.body), { name: 'Lean', amount_to_raise_cents: 75000000, target_runway_months: 18 });

    await v.click(v.all('uof-scenario-make-base')[1]);
    assert.equal(v.textOf('uof-make-base-warning'), 'Small round runs 6 months short of your target.');
    await v.click('uof-make-base-go');
    w = writes(v).at(-1);
    assert.match(w.url, /\/scenarios\/3\/make-base\?/);

    await v.click(v.all('uof-scenario-make-base')[0]);
    assert.equal(v.pr(v.by('uof-make-base-go')).disabled, true, 'a scenario with no split cannot be the base');
    await v.click(v.all('uof-scenario-delete')[0]);
    await v.click('uof-delete-scenario-go');
    w = writes(v).at(-1);
    assert.equal(w.method, 'DELETE');
    assert.match(w.url, /\/scenarios\/2\?/);
  } finally { await v.close(); }
});

test('Compare (UF10, UF11): Today and each scenario, both charts with a table; no pick says so; unreadable says so', async () => {
  const v = await mounted('/raise/use-of-funds/scenarios/compare?project_id=3&ids=1,2');
  try {
    assert.ok(v.requests.some((r) => r.url.includes('/use-of-funds/compare?') && r.url.includes('ids=1%2C2')));
    assert.match(v.textOf('uof-compare-row-runway'), /7 months · runway today[\s\S]*16 months[\s\S]*Not recorded/);
    assert.ok(v.by('uof-compare-cash-chart') && v.by('uof-compare-funded-chart') && v.by('uof-compare-funded-table'));
    assert.match(v.text(), /Seed plan lasts past 2026-12; Lean: not recorded/);
    assert.ok(v.hrefs().includes('/raise/use-of-funds/scenarios?project_id=3'));
  } finally { await v.close(); }
  const none = await mounted('/raise/use-of-funds/scenarios/compare?project_id=3');
  try {
    assert.ok(none.by('uof-compare-none'));
    assert.ok(!none.requests.some((r) => r.url.includes('/compare?')), 'nothing to compare reads nothing');
  } finally { await none.close(); }
  const bad = await mounted('/raise/use-of-funds/scenarios/compare?project_id=3&ids=1', { handle: (u, o) => (u.includes('/compare?') ? response({ detail: 'x' }, 404) : handler(u, o)) });
  try { assert.ok(bad.by('uof-compare-unreadable')); } finally { await bad.close(); }
});

test('on a phone, a page under a tab goes back to its tab', async () => {
  const v = await mounted('/raise/use-of-funds/runway/forecast?project_id=3', { phone: true });
  try {
    const bar = v.by('cycle-bar');
    assert.ok(bar, 'the phone bar');
    assert.ok(v.hrefs(bar).includes('/raise/use-of-funds/runway?project_id=3'), 'its back is Runway, not Home');
    assert.match(v.text.call(null), /Forecast/);
  } finally { await v.close(); }
});

/* ------------------------------------------------------------------ *
 * The source
 * ------------------------------------------------------------------ */

test('the wiring: the two routes, the two redirects, the links repointed, no browser pop-up, dark pairs', () => {
  const app = read('frontend/src/App.jsx');
  assert.ok(app.includes('<Route path="/raise/capital/model" element={<UseOfFundsMovedRedirect />} />'));
  assert.ok(app.includes('<Route path="/build/financials" element={<UseOfFundsMovedRedirect />} />'));
  assert.ok(app.includes('<CycleRoute cycle="raise" slug="use-of-funds" uofSub="forecast" />'));
  assert.ok(app.includes('<CycleRoute cycle="raise" slug="use-of-funds" uofSub="compare" />'));
  assert.ok(read('cloudflare-worker/src/services/raiseCycle.ts').includes("model: '/raise/use-of-funds/runway/forecast'"));
  assert.ok(read('frontend/src/workspaces/founderZoneActions.js').includes("{ label: 'Model a round', to: '/raise/use-of-funds/runway/forecast' }"));
  for (const f of ['cloudflare-worker/src/routes/assistant.ts', 'cloudflare-worker/src/services/onboardingChecklist.ts', 'frontend/src/pages/docs/guidePlacement.js']) {
    assert.ok(read(f).includes('/raise/use-of-funds/runway/forecast'), f);
    assert.ok(!read(f).includes("'/raise/capital/model'") && !read(f).includes('"/raise/capital/model"'), `${f} still links the old address`);
  }
  const src = read('frontend/src/pages/raise/useoffunds/ScenariosForecast.jsx');
  assert.doesNotMatch(src, /window\.(confirm|alert|prompt)\(|\bconfirm\(|\balert\(/);
  assert.doesNotMatch(src, /capital_recompute|Capital score:/);
  for (const m of src.matchAll(/className=(?:"([^"]*)"|\{`([^`]*)`\})/g)) {
    const cls = m[1] || m[2] || '';
    if (/\b(bg|text|border)-(white|gray|violet|amber|red|sky|emerald|axal)/.test(cls) && !/\$\{/.test(cls)) assert.match(cls, /dark:/, cls);
  }
});
