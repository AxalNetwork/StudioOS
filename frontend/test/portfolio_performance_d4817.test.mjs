/**
 * D4817 part 3 (#5311, canvas PF-03 and PF-03b): Performance, NAV at each
 * quarter-end as a chart and a table of the same reads, beside the
 * methodology, in the shared Portfolio frame. The real page is mounted against
 * a stubbed `fetch` in its populated, Not recorded and Unreadable states, plus
 * the pure model it adds.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/portfolio_performance_d4817.test.mjs
 *
 * Mutation checked, each both ways (fails with the mutation, passes without):
 *   - `quarterPointOf` drawing a book with no position (`position_count: 0`)
 *     as a point → tests 1 to 5;
 *   - `chartRowsOf` giving a gap the value 0 instead of null → test 5;
 *   - `quarterShape` dropping its `as_of === date` check (an undated read
 *     drawn as a quarter-end) → tests 4 and 5;
 *   - `quarterWindowOf` ending the series at the last quarter-end before the
 *     browser's date instead of the reporting read's `period_until` → tests 3
 *     and 5;
 *   - `quarterWindowOf` keeping the oldest quarter-ends instead of the newest
 *     when it caps the series → test 5;
 *   - `quarterSeriesOf` measuring the change between the last two drawn
 *     points, across a gap → tests 3, 4 and 5;
 *   - the table leaving out its gap rows (only drawn quarters listed) → tests
 *     2 and 4;
 *   - a quarter-end's Retry calling every quarter's read → test 4;
 *   - the series drawn over a failed reporting read (a fixed end date in
 *     place of the window's Unreadable) → tests 4 and 5;
 *   - `cohortsOf` reading an at-cost position's carrying value as 0 → test 5;
 *   - `quarterWindowOf` losing the empty book's own reason → test 3;
 *   - `ZoneNav` dropping `end` on the row's Overview item (Overview marked
 *     current on Performance too) → test 1.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import InvestorPortfolioPerformance from '../src/pages/investor/InvestorPortfolioPerformance.jsx';
import {
  QUARTER_LIMIT, chartRowsOf, cohortsOf, isQuarterEnd, moneyShort, quarterEndsBetween, quarterName, quarterPointOf,
  quarterSeriesOf, quarterShape, quarterWindowOf, seriesLabel,
} from '../src/pages/portfolio/portfolioModel.js';

const h = React.createElement;
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

async function mount(answer) {
  const restore = installDocument();
  const realFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(String(input), 'http://localhost');
    calls.push(`${url.pathname}${url.search}`);
    return answer({ path: url.pathname, query: url.searchParams, method: (init.method || 'GET').toUpperCase() }) ?? json({});
  };
  const box = document.createElement('div');
  document.body.appendChild(box);
  const root = createRoot(box);
  const textOf = (node) => (node.nodeType === 3 ? node.textContent : (node.childNodes || []).map(textOf).join('') || node.textContent || '');
  const nodes = () => { const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)]; return walk(box); };
  const props = (node) => Object.entries(node).find(([key]) => key.startsWith('__reactProps$'))?.[1] || {};
  const byTestId = (id) => nodes().find((n) => props(n)['data-testid'] === id);
  const settle = async () => { for (let i = 0; i < 15; i += 1) await act(async () => { await new Promise((resolve) => setImmediate(resolve)); }); };
  await act(async () => root.render(h(MemoryRouter, { initialEntries: ['/portfolio/performance'] }, h(InvestorPortfolioPerformance))));
  await settle();
  return {
    calls,
    text: (id) => (id ? (byTestId(id) ? textOf(byTestId(id)) : null) : textOf(box)),
    attr: (id, name) => props(byTestId(id) || {})[name],
    /** Every node whose test id starts with `prefix`, as `{ id, state, text, props }`, in document order. */
    all: (prefix) => nodes().filter((n) => String(props(n)['data-testid'] || '').startsWith(prefix))
      .map((n) => ({ id: props(n)['data-testid'], state: props(n)['data-state'], text: textOf(n), props: props(n), node: n })),
    hrefs: () => nodes().filter((n) => n.tagName === 'A').map((n) => props(n).href || props(n).to),
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
    { project_id: 1, project: { uid: 'lumen', name: 'Lumen Robotics' }, total_invested: 3500000, vintage: 2025, fmv: 7600000, multiple: 2.17, unmarked: false, mark_unavailable_reason: null, mark_as_of: '2026-09-30', mark_basis: 'round_price' },
    { project_id: 2, project: { uid: 'northwind', name: 'Northwind Labs' }, total_invested: 2250000, vintage: 2025, fmv: 2100000, multiple: 0.93, unmarked: false, mark_unavailable_reason: null, mark_as_of: '2026-06-30', mark_basis: 'secondary' },
    { project_id: 3, project: { uid: 'kite', name: 'Kite Systems' }, total_invested: 1250000, vintage: 2026, fmv: 1250000, multiple: 1, unmarked: true, mark_unavailable_reason: 'no_mark', mark_unavailable: 'No valuation is recorded.', mark_as_of: null, mark_basis: null },
  ],
};

const COMPLIANCE = {
  cadence: 'quarterly', period: '2026-Q3', as_of: '2026-11-13', period_until: '2026-09-30', period_complete: true, period_in_progress: false,
  companies: [], reported_count: 0, total_count: 0,
};

/** The book as of now: no `as_of` echoed, as the Worker answers without one. */
const LATEST = {
  as_of: null, basis: 'gross', nav: 11100000, paid_in: 7000000, distributed: 900000,
  returns: { tvpi: { state: 'ok', value: 1.71 }, dpi: { state: 'ok', value: 0.13 }, rvpi: { state: 'ok', value: 1.59 }, irr: { state: 'ok', value: 0.213 } },
  position_count: 3, unmarked_position_count: 1, unusable_mark_count: 0, mark_coverage: 0.67,
};

const quarter = (asOf, nav, paidIn, distributed, tvpi, count, unmarked) => ({
  as_of: asOf, basis: 'gross', nav, paid_in: paidIn, distributed, returns: { tvpi: { state: 'ok', value: tvpi } },
  position_count: count, unmarked_position_count: unmarked, unusable_mark_count: 0,
});

/** `/api/positions/analytics?as_of=` for each quarter-end the series reads (2025-Q1 to 2026-Q3). */
const QUARTERS = {
  // Before the first cheque: the read answers, and holds no book.
  '2025-03-31': quarter('2025-03-31', 0, 0, 0, null, 0, 0),
  '2025-06-30': quarter('2025-06-30', 3500000, 3500000, 0, 1, 1, 1),
  '2025-09-30': quarter('2025-09-30', 6100000, 5750000, 0, 1.06, 2, 1),
  '2025-12-31': quarter('2025-12-31', 7900000, 5750000, 0, 1.37, 2, 0),
  // A quarter-end the read answers without a NAV for: a gap, never a point.
  '2026-03-31': { as_of: '2026-03-31', basis: 'gross', nav: null, paid_in: 7000000, distributed: 0, position_count: 3, unmarked_position_count: 1 },
  '2026-06-30': quarter('2026-06-30', 9650000, 7000000, 900000, 1.51, 3, 1),
  '2026-09-30': quarter('2026-09-30', 11100000, 7000000, 900000, 1.71, 3, 1),
};
const DATES = Object.keys(QUARTERS);

function book(overrides = {}) {
  return ({ path, query }) => {
    const hit = overrides[path];
    if (typeof hit === 'function') { const r = hit(query); if (r) return r; }
    if (path === '/api/positions') return json(POSITIONS);
    if (path === '/api/positions/kpi-compliance') return json(COMPLIANCE);
    if (path === '/api/positions/analytics') {
      const asOf = query.get('as_of');
      if (!asOf) return json(LATEST);
      return QUARTERS[asOf] ? json(QUARTERS[asOf]) : json({ detail: 'no such quarter' }, 404);
    }
    return null;
  };
}

const asOfCalls = (calls, date) => calls.filter((c) => c === `/api/positions/analytics?as_of=${date}`).length;

/* ---------------------------------------------------------------- tests */

test('populated: the summary, NAV at every quarter-end read from the Worker, the methodology and cohorts', async () => {
  const m = await mount(book());
  try {
    assert.equal(document.title, 'Performance · Portfolio · Axal VC');
    assert.equal(m.attr('link-zone-performance', 'aria-current'), 'page');
    assert.equal(m.attr('link-zone-overview', 'aria-current'), undefined, 'Overview is not also the current page');
    assert.match(m.text('metric-nav'), /\$11,100,000/);
    assert.match(m.text('metric-tvpi'), /1\.71×/);
    assert.match(m.text('metric-irr'), /21\.3%/);
    // The series ends at the reporting read's last completed quarter, never the browser's date.
    for (const d of DATES) assert.equal(asOfCalls(m.calls, d), 1, `read ${d} once`);
    assert.equal(m.calls.filter((c) => /as_of=2026-12-31|as_of=2025-12-30/.test(c)).length, 0);
    assert.match(m.text('perf-quarters'), /7 quarter-ends through the last completed quarter/);
    const points = m.all('perf-chart-point-');
    assert.deepEqual(points.map((p) => p.id.slice(-10)), DATES);
    assert.deepEqual(points.map((p) => p.state), ['not_recorded', 'ok', 'ok', 'ok', 'not_recorded', 'ok', 'ok']);
    assert.match(points[6].text, /\$11\.1m.*Q3 2026/);
    assert.match(points[4].text, /Not recorded.*Q1 2026/);
    assert.match(m.text('perf-change'), /NAV up \$1,450,000 from 30 Jun 2026 to 30 Sep 2026/);
    assert.match(m.text('perf-methodology'), /\(Distributed \+ NAV\) ÷ paid-in/);
    assert.match(m.text('perf-methodology'), /never 0%/);
    assert.match(m.text('perf-methodology'), /Gross of fees and carry/);
    assert.equal(m.attr('link-portfolio-methodology', 'href'), '#portfolio-methodology');
    assert.match(m.text('perf-cohort-2025'), /2025.*2.*\$5,750,000.*\$9,700,000.*1\.69×/);
    assert.match(m.text('perf-cohort-2026'), /\$1,250,000.*1 at cost/);
    assert.ok(m.hrefs().includes('/portfolio/waterfall'), 'Exit Waterfall stays a door from Performance');
    assert.ok(m.hrefs().includes('/portfolio/positions'));
    assert.doesNotMatch(m.text(), /Unreadable|NaN|undefined|\$0m/);
    assert.doesNotMatch(m.text(), /advis|recommend|fiduciar|#\d{3,}|D4817/i);
  } finally { await m.close(); }
});

test('chart and table: the same quarter-end points, gaps in the same places and words', async () => {
  const m = await mount(book());
  try {
    const chart = m.all('perf-chart-point-').map((p) => ({ date: p.id.slice(-10), state: p.state }));
    const label = m.attr('perf-chart', 'aria-label');
    assert.equal(m.attr('perf-chart', 'role'), 'img');
    assert.match(label, /31 Mar 2025, Not recorded; 30 Jun 2025, \$3,500,000;.*31 Mar 2026, Not recorded;.*30 Sep 2026, \$11,100,000\./);
    assert.match(m.text('perf-quarters'), /hold no recorded book and read Not recorded/);
    await m.click('button-perf-view-table');
    assert.equal(m.attr('button-perf-view-table', 'aria-pressed'), true);
    assert.equal(m.text('perf-chart'), null, 'one view at a time');
    const rows = m.all('perf-row-').map((r) => ({ date: r.id.slice(-10), state: r.state }));
    assert.deepEqual(rows, chart, 'every chart column is a table row, in order, with the same state');
    for (const r of m.all('perf-row-')) {
      const date = r.id.slice(-10);
      if (r.state === 'ok') {
        assert.ok(label.includes(r.text.match(/\$[\d,]+/)[0]), `${date}: the table's NAV is the chart's`);
      } else {
        assert.match(r.text, /Not recorded · (No position is recorded on or before this date|The read returned no NAV for this date)\./);
      }
    }
    assert.match(m.text('perf-row-2026-09-30'), /^30 Sep 2026\$11,100,000\$7,000,000\$900,0001\.71×2 of 3$/);
    assert.match(m.text('perf-row-2025-06-30'), /\$3,500,000\$3,500,000\$01\.00×0 of 1/, 'a measured zero distributed stays $0');
    await m.click('button-perf-view-chart');
    assert.deepEqual(m.all('perf-chart-point-').map((p) => ({ date: p.id.slice(-10), state: p.state })), chart);
  } finally { await m.close(); }
});

test('Not recorded: no book, no completed quarter, and a change never measured across a gap', async () => {
  const empty = await mount(book({ '/api/positions': () => json({ items: [] }), '/api/positions/analytics': (q) => (q.get('as_of') ? null : json({ ...LATEST, nav: 0, paid_in: 0, distributed: 0, position_count: 0, unmarked_position_count: 0, returns: {} })) }));
  try {
    assert.match(empty.text('perf-quarters-not-recorded'), /Not recorded · No position is recorded, so there is no quarter-end to read\./);
    assert.equal(empty.calls.filter((c) => c.includes('as_of=')).length, 0, 'no quarter-end is read for an empty book');
    assert.match(empty.text('metric-nav'), /Not recorded/);
    assert.doesNotMatch(empty.text('metric-nav'), /\$0/);
    assert.equal(empty.text('perf-chart'), null);
  } finally { await empty.close(); }

  const open = await mount(book({ '/api/positions/kpi-compliance': () => json({ ...COMPLIANCE, period_until: null, period_complete: null }) }));
  try {
    assert.match(open.text('perf-quarters-not-recorded'), /The reporting read names no completed quarter/);
    assert.equal(open.calls.filter((c) => c.includes('as_of=')).length, 0);
  } finally { await open.close(); }

  const gap = await mount(book({ '/api/positions/analytics': (q) => (q.get('as_of') === '2026-06-30' ? json(quarter('2026-06-30', 0, 0, 0, null, 0, 0)) : null) }));
  try {
    assert.equal(gap.attr('perf-chart-point-2026-06-30', 'data-state'), 'not_recorded');
    assert.equal(gap.text('perf-change'), null, 'Q3 against a Q2 that holds no book is not a change');
  } finally { await gap.close(); }
});

test('Unreadable: a failed quarter-end is a gap with its own Retry; each source fails alone', async () => {
  let failJune = true;
  const m = await mount(book({
    '/api/positions/analytics': (q) => {
      if (q.get('as_of') === '2026-06-30' && failJune) return json({ detail: 'D1_ERROR: no such column' }, 500);
      // An answer that does not speak for the date asked is not that quarter's read.
      if (q.get('as_of') === '2025-09-30') return json({ ...QUARTERS['2025-09-30'], as_of: null });
      return null;
    },
  }));
  try {
    assert.equal(m.attr('perf-chart-point-2026-06-30', 'data-state'), 'unreadable');
    assert.equal(m.attr('perf-chart-point-2025-09-30', 'data-state'), 'unreadable');
    assert.match(m.attr('perf-chart', 'aria-label'), /30 Jun 2026, Unreadable/);
    assert.match(m.text('perf-quarters-unreadable'), /2 quarter-ends could not be read; they are a gap, not a zero\./);
    assert.equal(m.text('perf-change'), null);
    assert.doesNotMatch(m.text(), /D1_ERROR|no such column/);
    await m.click('button-perf-view-table');
    assert.match(m.text('perf-row-2026-06-30'), /Unreadable · This quarter-end could not be read\. No figure is shown in its place\. Retry/);
    failJune = false;
    const before = m.calls.length;
    await m.click('button-retry-perf-2026-06-30');
    assert.deepEqual(m.calls.slice(before), ['/api/positions/analytics?as_of=2026-06-30'], 'Retry asks for that quarter-end alone');
    assert.equal(m.attr('perf-row-2026-06-30', 'data-state'), 'ok');
    assert.match(m.text('perf-row-2026-06-30'), /\$9,650,000/);
    assert.match(m.text('perf-change'), /NAV up \$1,450,000/);
  } finally { await m.close(); }

  let failCompliance = true;
  const rep = await mount(book({ '/api/positions/kpi-compliance': () => (failCompliance ? json({ detail: 'boom' }, 500) : null) }));
  try {
    assert.match(rep.text('status-perf-quarters-unreadable'), /The quarter-end series could not be read\. The last completed quarter-end comes from the reporting read, which could not be read\./);
    assert.equal(rep.calls.filter((c) => c.includes('as_of=')).length, 0, 'no series is drawn without its end date');
    assert.match(rep.text('metric-nav'), /\$11,100,000/, 'the summary beside it stands');
    assert.match(rep.text('status-investor-performance-partial'), /Reporting could not be read/);
    failCompliance = false;
    const before = rep.calls.length;
    await rep.click('button-retry-perf-window');
    assert.deepEqual(rep.calls.slice(before, before + 1), ['/api/positions/kpi-compliance?cadence=quarterly']);
    assert.equal(rep.all('perf-chart-point-').length, DATES.length);
  } finally { await rep.close(); }

  let failSummary = true;
  const sum = await mount(book({ '/api/positions/analytics': (q) => (!q.get('as_of') && failSummary ? json({ detail: 'x' }, 500) : null) }));
  try {
    assert.match(sum.text('status-portfolio-performance-unreadable'), /Performance could not be read\. No figure is shown in its place\./);
    assert.equal(sum.all('perf-chart-point-').filter((p) => p.state === 'ok').length, 5, 'the quarter-end reads stand on their own');
    failSummary = false;
    const before = sum.calls.length;
    await sum.click('button-retry-portfolio-performance');
    assert.deepEqual(sum.calls.slice(before), ['/api/positions/analytics']);
    assert.match(sum.text('metric-nav'), /\$11,100,000/);
  } finally { await sum.close(); }
});

test('model: quarter-ends, the window, points, the chart rows and cohorts', () => {
  assert.ok(isQuarterEnd('2026-09-30'));
  assert.ok(!isQuarterEnd('2026-09-29'));
  assert.equal(quarterName('2026-12-31'), 'Q4 2026');
  assert.equal(moneyShort(11100000), '$11.1m');
  assert.equal(moneyShort(9000000), '$9m');
  assert.deepEqual(quarterEndsBetween(2026, '2026-09-30'), ['2026-03-31', '2026-06-30', '2026-09-30']);
  assert.deepEqual(quarterEndsBetween(2026, '2026-09-29'), [], 'a series ends only at a quarter-end');

  const ok = (value) => ({ state: 'ok', value });
  const positions = ok({ items: [{ vintage: 2022 }, { vintage: 2025 }] });
  const win = quarterWindowOf(positions, ok(COMPLIANCE));
  assert.equal(win.state, 'ok');
  assert.equal(win.dates.length, QUARTER_LIMIT);
  assert.equal(win.dates[win.dates.length - 1], '2026-09-30', 'ends at the reporting read’s quarter');
  assert.equal(win.dates[0], '2024-12-31', 'keeps the newest quarter-ends');
  assert.equal(win.earlier, 11);
  const june = quarterWindowOf(positions, ok({ ...COMPLIANCE, period: '2026-Q2', period_until: '2026-06-30' }));
  assert.equal(june.dates[june.dates.length - 1], '2026-06-30', 'the Worker’s quarter, whatever the browser’s date');
  assert.equal(quarterWindowOf(positions, { state: 'unreadable' }).state, 'unreadable');
  assert.equal(quarterWindowOf(positions, ok({ ...COMPLIANCE, period_complete: false })).state, 'not_recorded');
  assert.equal(quarterWindowOf(ok({ items: [{ vintage: null }] }), ok(COMPLIANCE)).state, 'not_recorded');
  assert.equal(quarterWindowOf({ state: 'unreadable' }, ok(COMPLIANCE)).retry, 'positions');

  assert.equal(quarterShape('2026-09-30')({ nav: 1, as_of: '2026-09-30' }), true);
  assert.equal(quarterShape('2026-09-30')({ nav: 1, as_of: null }), false);
  assert.equal(quarterPointOf('2025-03-31', ok(QUARTERS['2025-03-31'])).state, 'not_recorded');
  assert.equal(quarterPointOf('2026-03-31', ok(QUARTERS['2026-03-31'])).state, 'not_recorded');
  assert.equal(quarterPointOf('2026-06-30', { state: 'unreadable' }).state, 'unreadable');
  const p = quarterPointOf('2026-09-30', ok(QUARTERS['2026-09-30']));
  assert.deepEqual([p.state, p.navText, p.paidIn, p.distributed, p.tvpi.value, p.coverage], ['ok', '$11,100,000', '$7,000,000', '$900,000', '1.71×', '2 of 3']);

  const reads = Object.fromEntries(DATES.map((d) => [d, ok(QUARTERS[d])]));
  const series = quarterSeriesOf(DATES, reads);
  assert.equal(series.drawn, 5);
  assert.equal(series.gaps, 2);
  const rows = chartRowsOf(series);
  assert.deepEqual(rows.map((r) => r.nav), [null, 3500000, 6100000, 7900000, null, 9650000, 11100000], 'a gap is null, never 0');
  assert.match(seriesLabel(series), /^NAV at quarter-ends, gross: 31 Mar 2025, Not recorded;/);
  assert.equal(series.change.text, 'up $1,450,000');
  const gapped = quarterSeriesOf(DATES, { ...reads, '2026-06-30': { state: 'unreadable' } });
  assert.equal(gapped.change, null, 'never across a gap');

  const cohorts = cohortsOf(ok(POSITIONS));
  assert.deepEqual(cohorts.rows.map((r) => [r.vintage, r.companies, r.invested, r.carrying, r.multiple, r.atCost]), [
    ['2025', 2, '$5,750,000', '$9,700,000', '1.69×', 0],
    ['2026', 1, '$1,250,000', '$1,250,000', '1.00×', 1],
  ]);
  assert.equal(cohortsOf(ok({ items: [] })).state, 'not_recorded');
  assert.equal(cohortsOf({ state: 'unreadable' }).state, 'unreadable');
});
