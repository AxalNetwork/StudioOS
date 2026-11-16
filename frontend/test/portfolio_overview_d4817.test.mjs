/**
 * D4817 part 1 (#5311, canvas PF-01): the Portfolio Overview in the shared
 * Portfolio frame, mounted against stubbed Worker reads in three states —
 * populated, Not recorded and Unreadable — plus the pure model's rules.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/portfolio_overview_d4817.test.mjs
 *
 * Mutation checked, each both ways (fails with the mutation, passes without):
 *   - `ratio()` ignoring an unavailable figure → tests 2 and 3 (IRR/TVPI lose "Unavailable");
 *   - `position_count === 0` relaxed to `!a.position_count` → test 2 (NAV of a
 *     read that omits the count reads Not recorded);
 *   - `evidenceFor` dropping the runway line, or the stale-mark rule → test 1;
 *   - `healthFor` mapping a missing snapshot to Healthy → tests 1 and 5;
 *   - `usePortfolioReads` committing a rejected read as an empty answer → test 4
 *     (and #5365's tests 1 and 2);
 *   - performance Retry calling `reload` (every source) → test 4's call count;
 *   - the table drawing an empty book for a failed positions read → test 4
 *     (and #5365's test 1);
 *   - the Reporting card drawing "0 of 0" for an empty population → test 2;
 *   - `ZoneNav` losing `row.extra` (no Performance in the local nav) → test 1;
 *   - the frame not setting the document title → test 1.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import InvestorPortfolioCanvas from '../src/pages/investor/InvestorPortfolioCanvas.jsx';
import { AttentionItem, HealthStatus, ObligationStatus } from '../src/pages/portfolio/PortfolioParts.jsx';
import {
  attentionOf, companyRowsOf, day, evidenceFor, filterRows, healthFor, money, performanceOf, rate, readOf, reportingFor, SHAPES,
} from '../src/pages/portfolio/portfolioModel.js';
import { portfolioTitle } from '../src/pages/portfolio/PortfolioFrame.jsx';

const h = React.createElement;
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

async function mount(answer) {
  const restore = installDocument();
  const realFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(String(input), 'http://localhost');
    calls.push(url.pathname);
    return answer({ path: url.pathname, query: url.search, method: (init.method || 'GET').toUpperCase() }) ?? json({});
  };
  const box = document.createElement('div');
  document.body.appendChild(box);
  const root = createRoot(box);
  const textOf = (node) => (node.nodeType === 3 ? node.textContent : (node.childNodes || []).map(textOf).join('') || node.textContent || '');
  const nodes = () => { const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)]; return walk(box); };
  const props = (node) => Object.entries(node).find(([key]) => key.startsWith('__reactProps$'))?.[1] || {};
  const byTestId = (id) => nodes().find((n) => props(n)['data-testid'] === id);
  const settle = async () => { for (let i = 0; i < 15; i += 1) await act(async () => { await new Promise((resolve) => setImmediate(resolve)); }); };
  await act(async () => root.render(h(MemoryRouter, { initialEntries: ['/portfolio'] }, h(InvestorPortfolioCanvas))));
  await settle();
  return {
    calls,
    text: (id) => (id ? (byTestId(id) ? textOf(byTestId(id)) : null) : textOf(box)),
    hrefs: () => nodes().filter((n) => n.tagName === 'A').map((n) => props(n).href),
    async click(id) {
      const node = byTestId(id);
      if (!node) throw new Error(`no ${id}`);
      await act(async () => { props(node).onClick({ preventDefault() {}, stopPropagation() {} }); });
      await settle();
    },
    async close() { await act(async () => root.unmount()); globalThis.fetch = realFetch; restore(); },
  };
}

/* ------------------------------------------------------------- the book */

const POSITIONS = {
  items: [
    { project_id: 1, project: { uid: 'lumen', name: 'Lumen Robotics', sector: 'robotics', stage: 'series_a' }, total_invested: 2000000, latest_ownership_pct: 8.5, fmv: 5200000, multiple: 2.6, unmarked: false, marked_down: false, mark_as_of: '2026-09-30', mark_basis: 'priced_round' },
    { project_id: 2, project: { uid: 'northwind', name: 'Northwind Labs', sector: 'climate', stage: 'seed' }, total_invested: 1500000, latest_ownership_pct: 6.2, fmv: 1200000, multiple: 0.8, unmarked: false, marked_down: true, mark_as_of: '2026-03-31', mark_basis: 'priced_round' },
    { project_id: 3, project: { uid: 'kite', name: 'Kite Systems', sector: 'chips', stage: 'seed' }, total_invested: 1000000, latest_ownership_pct: 4, fmv: 1000000, multiple: 1, unmarked: true, marked_down: false, mark_as_of: null },
  ],
};
const ANALYTICS = {
  paid_in: 4500000, distributed: 900000, nav: 7400000, total_value: 8300000,
  tvpi: 1.84, dpi: 0.2, rvpi: 1.64, moic: 1.84, irr: 0.213, basis: 'gross',
  returns: {
    tvpi: { value: 1.84, state: 'computed', reason: null }, dpi: { value: 0.2, state: 'computed', reason: null },
    rvpi: { value: 1.64, state: 'computed', reason: null }, moic: { value: 1.84, state: 'computed', reason: null },
    irr: { value: 0.213, state: 'computed', reason: null },
  },
  as_of: null, position_count: 3, unmarked_position_count: 1, unusable_mark_count: 0, mark_coverage: 0.67,
};
const HEALTH_READ = {
  items: [
    { project_id: 2, badge: 'red', intervention: true, snapshot_date: '2026-11-06', stale: false, age_days: 1 },
    { project_id: 1, badge: 'green', intervention: false, snapshot_date: '2026-11-06', stale: false, age_days: 1 },
  ],
  totals: { green: 1, yellow: 0, red: 1, intervention: 1, stale: 0, not_measured: 1 },
  not_measured: [{ uid: 'kite', name: 'Kite Systems', state: 'not_recorded', reason: 'Not recorded — this company has no health snapshot yet' }],
};
const COMPLIANCE = {
  cadence: 'quarterly', period: '2026-Q3', as_of: '2026-11-07', period_in_progress: false, period_complete: true,
  population: { basis: 'companies_held_in_book', period: '2026-Q3' }, reported_count: 2, total_count: 3,
  companies: [
    { project_id: 1, reported: true, last_reported_at: '2026-11-02', days_since_report: 5 },
    { project_id: 2, reported: false, last_reported_at: '2026-07-12', days_since_report: 118 },
    { project_id: 3, reported: true, last_reported_at: '2026-10-30', days_since_report: 8 },
  ],
};
const UPDATES = { items: [
  { uid: 'u1', project_id: 1, project: { name: 'Lumen Robotics' }, period: '2026-Q3', submitted_at: '2026-11-02T10:00:00Z', kpis: { runway_months: 30 } },
  { uid: 'u2', project_id: 2, project: { name: 'Northwind Labs' }, period: '2026-Q2', submitted_at: '2026-07-12T10:00:00Z', kpis: { runway_months: 4.8 } },
] };
const SUPPORT = { entries: [], untouched: [{ project_id: 3 }], totals: { delivered: 7, promised: 4, withdrawn: 0, companies_in_book: 3, companies_supported: 2 } };

const book = (over = {}) => ({ path }) => {
  const routes = {
    '/api/positions': POSITIONS, '/api/positions/analytics': ANALYTICS, '/api/portfolio/health': HEALTH_READ,
    '/api/positions/kpi-compliance': COMPLIANCE, '/api/portfolio-updates/latest': UPDATES, '/api/portfolio-support': SUPPORT,
  };
  if (path in over) return over[path];
  return path in routes ? json(routes[path]) : json({});
};

test('Needs attention names the first red snapshot within 90 days', async () => {
  const health = { ...HEALTH_READ, items: HEALTH_READ.items.map((item) => item.project_id === 2
    ? { ...item, previous_status: 'yellow', status_changed_at: '2026-10-20', age_days: 7 }
    : item) };
  const view = await mount(book({ '/api/portfolio/health': json(health) }));
  try {
    assert.match(view.text('attention-2'), /HealthHealth turned to Attention on 20 Oct 2026 · first snapshot with this status/);
  } finally { await view.close(); }
});

test('1. populated: performance with basis and as-of, evidence-backed attention, and the company table in the frame', async () => {
  const view = await mount(book());
  try {
    const all = view.text();
    // The frame: one heading, the local navigation with Performance, the document title.
    assert.match(all, /Account›PortfolioPortfolioHow the investments are doing/);
    assert.match(all, /OverviewPositionsReportsPerformanceValue-add/);
    assert.ok(view.hrefs().includes('/portfolio/performance'), 'the local nav carries Performance');
    assert.equal(document.title, 'Portfolio · Axal VC');
    // Performance: NAV with coverage, the multiples with their definitions, the basis strip.
    assert.equal(view.text('metric-nav'), '$7,400,000');
    assert.match(view.text('portfolio-mark-coverage'), /^2 of 3 positions marked \(67% mark coverage\)$/);
    assert.match(all, /1 position carries at cost because no mark is recorded/);
    assert.equal(view.text('metric-tvpi'), 'TVPI1.84×(Distributed + NAV) ÷ paid-in');
    assert.match(view.text('metric-irr'), /^IRR21\.3%XIRR on dated flows, NAV as the terminal value$/);
    assert.match(view.text('portfolio-basis'), /^Gross of fees and carryAs of the latest recorded marksNewest mark 30 Sep 2026Marks: latest per company on or before the as-of dateUnmarked positions carry at costMethodology$/);
    // Needs attention: Northwind first, its evidence dated; Kite second; Lumen absent.
    const attention = view.text('portfolio-attention');
    assert.match(attention, /2 companies · evidence-backed · most urgent first/);
    assert.ok(attention.indexOf('Northwind Labs') < attention.indexOf('Kite Systems'));
    assert.doesNotMatch(attention, /Lumen Robotics/);
    assert.equal(view.text('attention-2'), [
      'Northwind LabsAttentionHealthAttention in the snapshot of 6 Nov 2026 · flagged for interventionRunway4.8 months · founder update · 2026-Q2',
      'Report2026-Q3 not received · last reported 12 Jul 2026MarkLatest mark below cost · 0.80× · 31 Mar 2026',
      'MarkLatest mark 31 Mar 2026, older than two quartersOpen Northwind Labs',
    ].join(''));
    assert.doesNotMatch(view.text('attention-2'), /Health turned to Attention/, 'one snapshot proves no status change');
    assert.match(view.text('attention-3'), /Kite SystemsNot recordedHealthNo health snapshot is recorded for this company\..*MarkNo mark recorded · carried at cost \$1,000,000/);
    // Summaries.
    assert.match(view.text('portfolio-reporting-figures'), /^Received2 of 3Not received1Period2026-Q3Complete$/);
    assert.match(view.text('portfolio-support-figures'), /^Open commitments4.*Delivered7.*No support recorded12 of 3 companies supported$/);
    // The table: sorted by health, the name is the link, an unmarked position says so.
    const table = all.slice(all.indexOf('Portfolio companies'));
    assert.ok(table.indexOf('Northwind Labs') < table.indexOf('Kite Systems') && table.indexOf('Kite Systems') < table.indexOf('Lumen Robotics'));
    assert.match(view.text('row-investor-position-3'), /Kite Systems.*\$1,000,000No mark recordedAt cost \$1,000,000 for NAV4\.0%1\.00×At cost/);
    assert.match(view.text('row-investor-position-1'), /Lumen Robotics.*\$5,200,00030 Sep 2026.*2\.60×2026-Q3 receivedHealthy2 Nov 2026/);
    assert.ok(view.hrefs().includes('/portfolio/companies/northwind'));
    assert.doesNotMatch(view.text('investor-portfolio-canvas'), /could not be read|(?<!Health: )Unreadable/);
  } finally { await view.close(); }
});

test('2. Not recorded: an empty book draws Not recorded with its reason, never a zero NAV or an empty-book claim from a failure', async () => {
  const view = await mount(book({
    '/api/positions': json({ items: [] }),
    '/api/positions/analytics': json({
      paid_in: 0, distributed: 0, nav: 0, basis: 'gross', position_count: 0, unmarked_position_count: 0, mark_coverage: null, as_of: null,
      returns: { tvpi: { value: null, state: 'unavailable', reason: 'no_paid_in' }, dpi: { value: null, state: 'unavailable', reason: 'no_paid_in' },
        rvpi: { value: null, state: 'unavailable', reason: 'no_paid_in' }, irr: { value: null, state: 'unavailable', reason: 'no_flows' } },
    }),
    '/api/portfolio/health': json({ items: [], not_measured: [], totals: {} }),
    '/api/positions/kpi-compliance': json({ period: '2026-Q3', as_of: '2026-11-07', companies: [], reported_count: 0, total_count: 0 }),
    '/api/portfolio-updates/latest': json({ items: [] }),
  }));
  try {
    const all = view.text();
    assert.equal(view.text('metric-nav'), 'Not recorded');
    assert.match(all, /No position is recorded in this book\./);
    assert.equal(view.text('metric-irr'), 'IRRUnavailableNo dated cash flows are recorded yet.');
    assert.equal(view.text('metric-tvpi'), 'TVPIUnavailableNo paid-in capital is recorded.');
    assert.match(view.text('portfolio-no-positions'), /No position is recorded for this investor account yet/);
    assert.match(view.text('attention-empty'), /Nothing in the recorded health, reporting, runway or marks needs attention/);
    assert.match(all, /Meetings resulting from introductions: Not recorded/);
    assert.match(view.text('portfolio-reporting-empty'), /^No company is in the reporting population for 2026-Q3\.$/);
    assert.doesNotMatch(view.text('investor-portfolio-canvas'), /\$0\b|0\.00×|could not be read|0 of 0/);
  } finally { await view.close(); }
  // Analytics that omit `position_count` are not an empty book.
  const partial = await mount(book({ '/api/positions/analytics': json({ nav: 1234.56, basis: 'gross' }) }));
  try {
    assert.equal(partial.text('metric-nav'), '$1,234.56');
    assert.equal(partial.text('metric-tvpi'), 'TVPINot recordedThe performance read returned no figure.');
  } finally { await partial.close(); }
});

test('3. IRR reads Unavailable with its reason when no rate solves; the rest stays current (PF-01 C)', async () => {
  const view = await mount(book({
    '/api/positions/analytics': json({ ...ANALYTICS, irr: null, returns: { ...ANALYTICS.returns, irr: { value: null, state: 'unavailable', reason: 'outside_bracket' } } }),
  }));
  try {
    assert.equal(view.text('metric-irr'), 'IRRUnavailableNo rate solves between −99.99% and +1000% on these flows.');
    assert.equal(view.text('metric-tvpi'), 'TVPI1.84×(Distributed + NAV) ÷ paid-in');
    assert.equal(view.text('metric-nav'), '$7,400,000');
  } finally { await view.close(); }
});

test('4. Unreadable: each failed source labels its own panel, keeps its neighbours, and Retry re-reads only that source', async () => {
  const view = await mount(book({
    '/api/positions/analytics': json({ detail: 'D1_TYPE_ERROR: no such column' }, 500),
    '/api/portfolio/health': json({ detail: 'x' }, 500),
  }));
  try {
    const all = view.text();
    assert.equal(view.text('metric-nav'), 'Unreadable');
    assert.match(view.text('status-portfolio-performance-unreadable'), /^Performance could not be read\. No figure is shown in its place\..*Retry$/);
    assert.equal(view.text('metric-tvpi'), 'TVPIUnreadablePerformance could not be read.');
    assert.match(view.text('status-investor-portfolio-partial'), /^Performance, Health could not be read\./);
    // Neighbours keep their figures; health reads Unreadable per company, never Healthy.
    assert.match(view.text('portfolio-reporting-figures'), /^Received2 of 3/);
    assert.match(view.text('row-investor-position-1'), /Lumen Robotics.*Unreadable/);
    assert.doesNotMatch(view.text('row-investor-position-1'), /Healthy/);
    assert.match(view.text('attention-partial'), /The health read failed/);
    assert.doesNotMatch(all, /D1_TYPE_ERROR|\$0\b|TVPI0/);
    const portfolioReads = () => view.calls.filter((p) => /^\/api\/(positions|portfolio)/.test(p) && p !== '/api/positions/analytics').length;
    const before = view.calls.filter((p) => p === '/api/positions/analytics').length;
    const others = portfolioReads();
    await view.click('button-retry-portfolio-performance');
    assert.equal(view.calls.filter((p) => p === '/api/positions/analytics').length, before + 1, 'Retry asks for performance again');
    assert.equal(portfolioReads(), others, 'and for no other Portfolio source');
  } finally { await view.close(); }
  // Positions failing: the book is replaced by its failure, performance still stands.
  const lost = await mount(book({ '/api/positions': json({ detail: 'secret' }, 500) }));
  try {
    const all = lost.text();
    assert.match(lost.text('status-investor-portfolio-error'), /^Positions could not be read\.Retry$/);
    assert.equal(lost.text('metric-nav'), '$7,400,000');
    assert.match(all, /The queue is built from the positions, which could not be read/);
    assert.doesNotMatch(all, /No position is recorded for this investor account|0 companies|secret/);
  } finally { await lost.close(); }
});

/* ---------------------------------------------------------------- model */

test('5. the model: reads, health and reporting states, formatting, filters and the shared parts', () => {
  assert.deepEqual(readOf({ status: 'rejected', reason: new Error('x') }), { state: 'unreadable' });
  assert.deepEqual(readOf({ status: 'fulfilled', value: {} }, SHAPES.positions), { state: 'unreadable' });
  assert.equal(readOf({ status: 'fulfilled', value: { items: [] } }, SHAPES.positions).state, 'ok');
  assert.equal(money(0), '$0');
  assert.equal(money(null), null);
  assert.equal(rate(-1), '-100%');
  assert.equal(day('2026-07-02T09:00:00Z'), '2 Jul 2026');
  const pos = POSITIONS.items[0];
  assert.equal(healthFor(pos, { state: 'unreadable' }).state, 'Unreadable');
  assert.equal(healthFor(pos, { state: 'ok', value: { items: [{ project_id: 1, badge: 'yellow' }] } }).state, 'Watch');
  assert.equal(healthFor(POSITIONS.items[2], { state: 'ok', value: { items: [], not_measured: [{ uid: 'kite', state: 'insufficient_evidence' }] } }).state, 'Not enough evidence');
  assert.equal(healthFor(pos, { state: 'ok', value: { items: [] } }).state, 'Not recorded');
  assert.equal(reportingFor(pos, { state: 'ok', value: { ...COMPLIANCE, period_in_progress: true, companies: [{ project_id: 1, reported: false }] } }).state, 'Due');
  assert.equal(reportingFor(pos, { state: 'ok', value: { companies: [] } }).state, 'Not recorded');
  const total = evidenceFor({ ...pos, marked_down: false, multiple: 0, fmv: 0 }, { health: { state: 'ok', value: { items: [] } }, compliance: { state: 'unreadable' }, updates: { state: 'unreadable' } }, null);
  assert.ok(total.lines.some((l) => /below cost · 0\.00×/.test(l.text)), 'a written-off mark is evidence');
  const reads = { positions: { state: 'ok', value: POSITIONS }, health: { state: 'ok', value: HEALTH_READ }, compliance: { state: 'ok', value: COMPLIANCE }, updates: { state: 'ok', value: UPDATES } };
  assert.deepEqual(attentionOf(reads).items.map((i) => i.key), ['2', '3']);
  assert.deepEqual(attentionOf({ ...reads, positions: { state: 'unreadable' } }), { state: 'unreadable', items: [] });
  const rows = companyRowsOf(reads);
  assert.deepEqual(filterRows(rows, { health: 'Healthy' }).map((r) => r.name), ['Lumen Robotics']);
  assert.deepEqual(filterRows(rows, { query: 'kit' }).map((r) => r.name), ['Kite Systems']);
  const perf = performanceOf({ state: 'ok', value: { ...ANALYTICS, as_of: '2026-09-30' } }, reads.positions);
  assert.ok(perf.basis.includes('As of 30 Sep 2026'));
  assert.equal(portfolioTitle('positions'), 'Positions · Portfolio · Axal VC');
  assert.equal(portfolioTitle(null), 'Portfolio · Axal VC');
  // The shared parts: a word and a shape for every state, and a link that names the company.
  const html = (el) => renderToStaticMarkup(h(MemoryRouter, null, el));
  assert.match(html(h(HealthStatus, { health: { state: 'Unreadable' } })), /data-state="Unreadable".*Unreadable/);
  assert.match(html(h(ObligationStatus, { reporting: { state: 'Not received', period: '2026-Q3' } })), /2026-Q3 not received/);
  assert.match(html(h(AttentionItem, { item: { key: '2', name: 'Northwind Labs', uid: 'northwind', weight: 3, health: { state: 'Attention' }, lines: [{ label: 'Runway', text: '4.8 months' }] } })),
    /href="\/portfolio\/companies\/northwind"[^>]*>Open Northwind Labs</);
});
