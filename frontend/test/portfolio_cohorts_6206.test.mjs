/**
 * D6206 (#6206): Performance's vintage cohorts show Invested, Distributed,
 * Carrying value, DPI and TVPI, read from the positions read's per-company
 * `distributed` (`GET /api/positions`), with a Book row that reconciles to the
 * book's totals.
 *
 *   - a cohort with nothing distributed is a measured $0 (DPI 0.00×), never Not recorded;
 *   - a failed distributions read (`distributions.available: false`) is
 *     Unavailable in Distributed, DPI and TVPI only: Invested and Carrying value still show;
 *   - a read with no distributions field (a Worker before D6206) is Not recorded, never $0;
 *   - the Book row is every listed position, undated ones too, plus the
 *     distributions of companies with no listed position;
 *   - the Positions register's rows carry the same distributed figure.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/portfolio_cohorts_6206.test.mjs
 *
 * Mutation checked, each both ways (fails with the mutation, passes without):
 *   - `distributionsOf` treating `available: false` as ok → tests 2, 5, 6;
 *   - `distributionsOf` treating a read with no field as ok → test 3;
 *   - `distributedOf` defaulting a missing figure to 0 → test 3;
 *   - TVPI computed without the carrying value → tests 1, 4, 6;
 *   - DPI computed over carrying value instead of invested → tests 1, 4, 6;
 *   - the Book row leaving out undated positions → test 4;
 *   - the Book row leaving out `unlisted` → test 4;
 *   - the cohort cell drawing an Unavailable as $0 → test 6.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import InvestorPortfolioPerformance from '../src/pages/investor/InvestorPortfolioPerformance.jsx';
import { cohortsOf, distributionsOf, registerRowsOf } from '../src/pages/portfolio/portfolioModel.js';

const h = React.createElement;
const ok = (value) => ({ state: 'ok', value });
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const ITEMS = [
  { project_id: 1, project: { uid: 'lumen', name: 'Lumen Robotics' }, total_invested: 3500000, vintage: 2025, fmv: 7600000, unmarked: false, mark_as_of: '2026-09-30', mark_basis: 'round_price', distributed: 900000 },
  { project_id: 2, project: { uid: 'northwind', name: 'Northwind Labs' }, total_invested: 2250000, vintage: 2025, fmv: 2100000, unmarked: false, mark_as_of: '2026-06-30', mark_basis: 'secondary', distributed: 100000 },
  { project_id: 3, project: { uid: 'kite', name: 'Kite Systems' }, total_invested: 1250000, vintage: 2026, fmv: 1250000, unmarked: true, mark_unavailable_reason: 'no_mark', distributed: 0 },
];
const READ = { items: ITEMS, distributions: { available: true, total: 1000000, unlisted: 0 } };
const FAILED = { items: ITEMS.map((i) => ({ ...i, distributed: null })), distributions: { available: false, reason: 'Portfolio distributions could not be read.' } };

const cells = (r) => [r.distributed.value, r.dpi.value, r.tvpi.value];

test('1. each cohort shows Invested, Distributed, Carrying value, DPI and TVPI', () => {
  const c = cohortsOf(ok(READ));
  assert.equal(c.state, 'ok');
  assert.deepEqual(c.rows.map((r) => [r.vintage, r.invested, r.carrying, ...cells(r)]), [
    // 1,000,000 ÷ 5,750,000 = 0.17; (1,000,000 + 9,700,000) ÷ 5,750,000 = 1.86
    ['2025', '$5,750,000', '$9,700,000', '$1,000,000', '0.17×', '1.86×'],
    ['2026', '$1,250,000', '$1,250,000', '$0', '0.00×', '1.00×'],
  ]);
  assert.equal(c.rows[1].distributed.state, 'ok', 'nothing distributed is a measured $0');
});

test('2. a failed distributions read is Unavailable in those columns only', () => {
  const c = cohortsOf(ok(FAILED));
  assert.equal(c.state, 'ok');
  for (const r of c.rows) {
    assert.deepEqual(cells(r), ['Unavailable', 'Unavailable', 'Unavailable']);
    assert.equal(r.dpi.state, 'unavailable');
    assert.equal(r.tvpi.reason, 'Portfolio distributions could not be read.');
  }
  assert.deepEqual(c.rows.map((r) => [r.invested, r.carrying]), [['$5,750,000', '$9,700,000'], ['$1,250,000', '$1,250,000']]);
  assert.deepEqual(cells(c.total), ['Unavailable', 'Unavailable', 'Unavailable']);
  assert.equal(c.total.invested, '$7,000,000');
});

test('3. a read with no distributions field is Not recorded, never $0', () => {
  const c = cohortsOf(ok({ items: ITEMS.map(({ distributed, ...rest }) => rest) }));
  assert.equal(distributionsOf(ok({ items: [] })).state, 'not_recorded');
  for (const r of c.rows) assert.deepEqual(cells(r), ['Not recorded', 'Not recorded', 'Not recorded']);
  const missing = cohortsOf(ok({ ...READ, items: [ITEMS[0], { ...ITEMS[1], distributed: null }] }));
  assert.deepEqual(cells(missing.rows[0]), ['Not recorded', 'Not recorded', 'Not recorded'], 'one company without a figure is not a $0');
});

test('4. the Book row reconciles to the book: undated positions and unlisted distributions included', () => {
  const read = {
    items: [...ITEMS, { project_id: 4, project: { name: 'Undated Co' }, total_invested: 500000, vintage: null, fmv: 500000, unmarked: true, distributed: 40000 }],
    distributions: { available: true, total: 1060000, unlisted: 20000 },
  };
  const c = cohortsOf(ok(read));
  assert.equal(c.undated, 1);
  assert.equal(c.unlisted, '$20,000');
  assert.deepEqual([c.total.companies, c.total.invested, c.total.carrying, ...cells(c.total)],
    // distributed = Σ rows 1,040,000 + unlisted 20,000 = the read's total; (1,060,000 + 11,450,000) ÷ 7,500,000 = 1.67
    [4, '$7,500,000', '$11,450,000', '$1,060,000', '0.14×', '1.67×']);
  assert.equal(c.total.distributed.value, '$1,060,000', 'equals distributions.total');
});

test('5. the Positions register carries each company\'s distributed figure', () => {
  const reads = { positions: ok(READ), health: { state: 'loading' }, compliance: { state: 'loading' } };
  const rows = registerRowsOf(reads, { date: null, state: 'loading' });
  const by = Object.fromEntries(rows.map((r) => [r.name, [r.distributed, r.distributedState]]));
  assert.deepEqual(by['Kite Systems'], ['$0', 'ok']);
  assert.deepEqual(by['Lumen Robotics'], ['$900,000', 'ok']);
  const failed = registerRowsOf({ ...reads, positions: ok(FAILED) }, { date: null, state: 'loading' });
  assert.deepEqual(failed.map((r) => [r.distributed, r.distributedState, r.invested != null]),
    [['Unavailable', 'unavailable', true], ['Unavailable', 'unavailable', true], ['Unavailable', 'unavailable', true]]);
});

/* ------------------------------------------------------------ the page */

const COMPLIANCE = { cadence: 'quarterly', period: '2026-Q3', as_of: '2026-11-13', period_until: '2026-09-30', period_complete: false, companies: [] };
const LATEST = {
  as_of: null, basis: 'gross', nav: 10950000, paid_in: 7000000, distributed: 1000000,
  returns: { tvpi: { state: 'ok', value: 1.71 }, dpi: { state: 'ok', value: 0.14 } },
  position_count: 3, unmarked_position_count: 1, unusable_mark_count: 0, mark_coverage: 0.67,
};

async function mount(positions) {
  const restore = installDocument();
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = new URL(String(input), 'http://localhost');
    if (url.pathname === '/api/positions') return json(positions);
    if (url.pathname === '/api/positions/kpi-compliance') return json(COMPLIANCE);
    if (url.pathname === '/api/positions/analytics') return json(LATEST);
    return json({});
  };
  const box = document.createElement('div');
  document.body.appendChild(box);
  const root = createRoot(box);
  const textOf = (node) => (node.nodeType === 3 ? node.textContent : (node.childNodes || []).map(textOf).join('') || node.textContent || '');
  const nodes = () => { const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)]; return walk(box); };
  const props = (node) => Object.entries(node).find(([key]) => key.startsWith('__reactProps$'))?.[1] || {};
  const byTestId = (id) => nodes().find((n) => props(n)['data-testid'] === id);
  await act(async () => root.render(h(MemoryRouter, { initialEntries: ['/portfolio/performance'] }, h(InvestorPortfolioPerformance))));
  for (let i = 0; i < 15; i += 1) await act(async () => { await new Promise((resolve) => setImmediate(resolve)); });
  return {
    text: (id) => (byTestId(id) ? textOf(byTestId(id)) : null),
    async close() { await act(async () => root.unmount()); globalThis.fetch = realFetch; restore(); },
  };
}

test('6. the Cohorts block draws the five figures, a measured $0, and Unavailable only where distributions failed', async () => {
  const m = await mount(READ);
  try {
    assert.match(m.text('perf-cohorts'), /Distributed.*Carrying value.*DPI.*TVPI/);
    assert.match(m.text('perf-cohort-2025'), /\$5,750,000.*\$1,000,000.*\$9,700,000.*0\.17×.*1\.86×/);
    assert.match(m.text('perf-cohort-2026'), /\$1,250,000\$0\$1,250,000.*0\.00×.*1\.00×/);
    assert.doesNotMatch(m.text('perf-cohort-2026'), /Not recorded/);
    assert.match(m.text('perf-cohort-total'), /Book3\$7,000,000\$1,000,000\$10,950,000.*0\.14×.*1\.71×/);
    assert.equal(m.text('perf-cohorts-distributions-unavailable'), null);
  } finally { await m.close(); }

  const f = await mount(FAILED);
  try {
    assert.match(f.text('perf-cohort-2025'), /\$5,750,000Unavailable\$9,700,000UnavailableUnavailable/);
    assert.doesNotMatch(f.text('perf-cohorts'), /\$0|NaN|0\.00×/);
    assert.match(f.text('perf-cohorts-distributions-unavailable'), /Portfolio distributions could not be read\. Distributed, DPI and TVPI are Unavailable; invested and carrying value are current\./);
  } finally { await f.close(); }
});
