/**
 * D4817 part 2 (#5311, canvas PF-02): Positions, the investment register and
 * one company's mark history, in the shared Portfolio frame, mounted against
 * stubbed Worker reads in its populated, Not recorded and Unreadable states,
 * plus the pure model it adds.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/portfolio_positions_d4817.test.mjs
 *
 * Mutation checked, each both ways (fails with the mutation, passes without):
 *   - `markOf` reading `no_mark` as an unusable mark → tests 1 and 5;
 *   - `isStale` with `>=` (183 days is not older than two quarters) → tests 2 and 5;
 *   - `isStale` with its two-quarter bound dropped → tests 1, 2 and 5;
 *   - `markReference` falling back to the browser clock when the reporting
 *     read fails → tests 3 and 5 (stale reads Unreadable, never a count);
 *   - `registerTotalOf` leaving the at-cost positions out of the carrying
 *     total → tests 1 and 5 ($10,450,000);
 *   - the page's Needs attention predicate ignoring the attention set → test 2;
 *   - the page drawing the register and counts over a failed positions
 *     read → test 3;
 *   - the positions Retry calling `reload` (every source) → test 3;
 *   - the as-of date not reaching `/api/positions?as_of=` → test 2;
 *   - the drawer drawing an empty history for a failed detail read → test 4;
 *   - `basisLabel` defaulting a missing basis to "GP estimate" → test 5;
 *   - the stale-update rule's 30-day threshold moved to 60 → test 1 (Fjord's 45 days);
 *   - the register losing the reporting period from its column header → test 1.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import InvestorPortfolioPositions from '../src/pages/investor/InvestorPortfolioPositions.jsx';
import {
  basisLabel, isStale, markCountsOf, markHistoryOf, markOf, markReference, registerRowsOf, registerTotalOf,
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
  await act(async () => root.render(h(MemoryRouter, { initialEntries: ['/portfolio/positions'] }, h(InvestorPortfolioPositions))));
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
    async change(id, value) {
      const node = byTestId(id);
      if (!node) throw new Error(`no ${id}`);
      await act(async () => { props(node).onChange({ target: { value } }); });
      await settle();
    },
    async submit(id) {
      const node = byTestId(id);
      if (!node) throw new Error(`no ${id}`);
      await act(async () => { props(node).onSubmit({ preventDefault() {} }); });
      await settle();
    },
    async close() { await act(async () => root.unmount()); globalThis.fetch = realFetch; restore(); },
  };
}

/* ------------------------------------------------------------- the book */

const NO_MARK = 'No valuation is recorded for this position as of this date; invested cost is not its value.';
const CONFLICT = 'Two funds recorded different values for this company on the same date. Record a firm-level mark, or read the fund on its own page.';

/** Worker-shaped `/api/positions` rows (positions.ts): an unmarked row carries cost as `fmv`. */
const POSITIONS = {
  items: [
    { project_id: 1, project: { uid: 'lumen', name: 'Lumen Robotics', sector: 'robotics', stage: 'series_a' }, total_invested: 2000000, latest_ownership_pct: 8.5, latest_round: 'Series A', fmv: 5200000, multiple: 2.6, marked_down: false, unmarked: false, mark_unavailable_reason: null, mark_unavailable: null, mark_as_of: '2026-09-30', mark_basis: 'round_price' },
    { project_id: 2, project: { uid: 'northwind', name: 'Northwind Labs', sector: 'climate', stage: 'seed' }, total_invested: 1500000, latest_ownership_pct: 6.2, latest_round: 'Seed', fmv: 2400000, multiple: 1.6, marked_down: false, unmarked: false, mark_unavailable_reason: null, mark_unavailable: null, mark_as_of: '2026-03-31', mark_basis: 'round_price' },
    { project_id: 3, project: { uid: 'pelican', name: 'Pelican Pay', sector: 'fintech', stage: 'series_a' }, total_invested: 1250000, latest_ownership_pct: 5, fmv: 1100000, multiple: 0.88, marked_down: true, unmarked: false, mark_unavailable_reason: null, mark_unavailable: null, mark_as_of: '2026-09-30', mark_basis: 'secondary' },
    { project_id: 4, project: { uid: 'kite', name: 'Kite Systems', sector: 'chips', stage: 'seed' }, total_invested: 1000000, latest_ownership_pct: 4, fmv: 1000000, multiple: 1, marked_down: false, unmarked: true, mark_unavailable_reason: 'no_mark', mark_unavailable: NO_MARK, mark_as_of: null, mark_basis: null },
    { project_id: 5, project: { uid: 'fjord', name: 'Fjord Data', sector: 'data', stage: 'seed' }, total_invested: 750000, latest_ownership_pct: 3.1, fmv: 750000, multiple: 1, marked_down: false, unmarked: true, mark_unavailable_reason: 'fund_marks_conflict', mark_unavailable: CONFLICT, mark_as_of: null, mark_basis: null },
  ],
};

const HEALTH = {
  items: [
    { project_id: 1, badge: 'green', snapshot_date: '2026-11-01' },
    { project_id: 2, badge: 'red', snapshot_date: '2026-11-01', intervention: true },
    { project_id: 3, badge: 'yellow', snapshot_date: '2026-11-01' },
  ],
  not_measured: [],
};

const COMPLIANCE = {
  cadence: 'quarterly', period: '2026-Q3', as_of: '2026-11-13', period_until: '2026-09-30', period_complete: true, period_in_progress: false,
  population: { period: '2026-Q3' }, reported_count: 3, total_count: 5,
  companies: [
    { project_id: 1, reported: true, last_reported_at: '2026-11-02', days_since_report: 11 },
    { project_id: 2, reported: false, last_reported_at: '2026-07-20', days_since_report: 116 },
    { project_id: 3, reported: true, last_reported_at: '2026-10-28', days_since_report: 16 },
    { project_id: 4, reported: false, last_reported_at: null, days_since_report: null },
    { project_id: 5, reported: true, last_reported_at: '2026-09-29', days_since_report: 45 },
  ],
};

const UPDATES = { items: [{ project_id: 2, period: '2026-Q3', submitted_at: '2026-07-20T09:00:00Z', kpis: { runway_months: 4.8 } }] };

const NORTHWIND = {
  project: { uid: 'northwind', name: 'Northwind Labs' },
  marks: [
    { uid: 'mk-2', as_of_date: '2025-06-15', fmv: 1000000, post_money: 24200000, event: 'Investment', basis: 'cost', source: 'closing docs' },
    { uid: 'mk-1', as_of_date: '2026-03-31', fmv: 2400000, post_money: 38700000, event: 'Priced round', basis: 'round_price', source: 'term sheet' },
  ],
  rounds: [], distributions: [],
};

function book({ path }) {
  if (path === '/api/positions') return json(POSITIONS);
  if (path === '/api/portfolio/health') return json(HEALTH);
  if (path === '/api/portfolio/health/northwind') return json({ history: [{ badge: 'red' }, { badge: 'yellow' }] });
  if (path === '/api/positions/kpi-compliance') return json(COMPLIANCE);
  if (path === '/api/portfolio-updates/latest') return json(UPDATES);
  if (path === '/api/positions/northwind') return json(NORTHWIND);
  return undefined;
}

/* ---------------------------------------------------------------- tests */

test('populated: the register, its three mark counts, the total and the attention rules', async () => {
  const view = await mount(book);
  try {
    // The frame: the Positions title, the local navigation, a named section.
    assert.equal(document.title, 'Positions · Portfolio · Axal VC');
    assert.match(view.text('portfolio-context'), /Gross of fees and carry · latest recorded marks/);
    for (const to of ['/portfolio', '/portfolio/positions', '/portfolio/updates', '/portfolio/performance', '/portfolio/value-add']) {
      assert.ok(view.hrefs().includes(to), `the local nav lost ${to}`);
    }

    // The three counts stay separate.
    assert.match(view.text('positions-count-coverage'), /Mark coverage3 of 560% · Kite Systems, Fjord Data at cost/);
    assert.match(view.text('positions-count-stale'), /Stale marks \(older than two quarters\)1Northwind Labs · 31 Mar 2026/);
    assert.match(view.text('positions-count-unusable'), /Marks that cannot be used1Fjord Data · carried at cost/);

    // The register: largest cheque first, the name links, each mark kind in its own words.
    const words = view.text('positions-register');
    assert.match(words, /Reporting · 2026-Q3Health/, 'the period is not in the column header');
    assert.ok(words.indexOf('Lumen Robotics') < words.indexOf('Northwind Labs') && words.indexOf('Pelican Pay') < words.indexOf('Kite Systems'), 'not sorted by invested');
    assert.ok(view.hrefs().includes('/portfolio/companies/northwind'), 'the company name is not a link');
    assert.match(view.text('row-investor-position-ledger-1'), /Lumen Robotics.*\$2,000,000.*8\.5%.*\$5,200,000.*2\.60×.*30 Sep 2026.*Priced round.*Received.*Healthy/);
    assert.match(view.text('row-investor-position-ledger-2'), /31 Mar 2026Stale · 7 months old/);
    assert.match(view.text('row-investor-position-ledger-3'), /0\.88×Below cost.*Secondary.*Watch/);
    assert.match(view.text('row-investor-position-ledger-4'), /\$1,000,000.*No mark recordedAt cost for NAV.*1\.00×At cost.*Not recorded.*At cost.*Not received.*Not recorded/);
    assert.doesNotMatch(view.text('row-investor-position-ledger-4'), /Mark not usable/);
    assert.match(view.text('row-investor-position-ledger-5'), /\$750,000.*Mark not usableAt cost for NAVTwo funds recorded different values/);
    assert.equal(view.text('stale-1'), null, 'a current mark reads stale');

    // The total: the sum of the rows, with the at-cost positions named.
    assert.match(view.text('positions-total'), /Total · 5 positions\$6,500,000\$10,450,0001\.61×/);
    assert.match(view.text('positions-total-note'), /Kite Systems \(\$1,000,000\), Fjord Data \(\$750,000\) included at cost/);

    // The attention rules, each with its evidence and dates from the Worker.
    assert.match(view.text('rule-runway'), /Northwind Labs 4\.8 months · founder-reported · 2026-Q3 · 20 Jul 2026/);
    assert.match(view.text('rule-stale-update'), /Northwind Labs Last update received 20 Jul 2026 · 116 days.*Kite Systems No update received.*Fjord Data Last update received 29 Sep 2026 · 45 days/);
    assert.doesNotMatch(view.text('rule-stale-update'), /Lumen|Pelican|T09:00/);
    assert.match(view.text('rule-health-red'), /Northwind Labs Attention in the snapshot of 1 Nov 2026/);
    assert.match(view.text('rule-below-cost'), /Pelican Pay 0\.88× · Secondary · 30 Sep 2026/);
    assert.match(view.text('rule-no-evidence'), /Kite Systems.*Fjord Data/);
    assert.equal(view.text('status-investor-positions-partial'), null);
  } finally { await view.close(); }
});

test('the as-of date reaches the positions read, and the Needs attention filter is the Overview\'s rule set', async () => {
  const view = await mount(book);
  try {
    assert.ok(view.calls.includes('/api/positions'), 'the first read is the latest book');
    await view.click('button-positions-quarter-end');
    assert.ok(view.calls.includes('/api/positions?as_of=2026-09-30'), 'the as-of date did not reach the positions read');
    assert.match(view.text('portfolio-context'), /book as of 30 Sep 2026/);
    assert.match(view.text('positions-register'), /as of 30 Sep 2026/);
    assert.equal(view.calls.filter((c) => c.startsWith('/api/portfolio/health?') || c === '/api/portfolio/health').length, 1, 'the as-of date re-read health, a current read');
    // Measured at the chosen date, Northwind's mark is 183 days old: not stale.
    assert.match(view.text('positions-count-stale'), /0None older than two quarters at 30 Sep 2026/);

    // The register opens on every position (audit F-18); the filter uses the Overview's queue.
    assert.match(view.text('positions-register'), /5 of 5/);
    await view.click('filter-positions-needs-attention');
    const words = view.text('positions-register');
    assert.match(words, /Northwind Labs/);
    assert.match(words, /Kite Systems/, 'a company with no health snapshot is in the Overview queue');
    assert.doesNotMatch(words, /Lumen Robotics/, 'a healthy, current, marked company is in the attention filter');
  } finally { await view.close(); }
});

test('Unreadable: a failed positions read is never an empty book, and each source retries alone', async () => {
  let positionsUp = false;
  const view = await mount(({ path }) => {
    if (path === '/api/positions') return positionsUp ? json(POSITIONS) : json({ detail: 'D1_SECRET_INTERNAL_DETAIL' }, 500);
    if (path === '/api/positions/kpi-compliance') return json({ detail: 'down' }, 500);
    return book({ path });
  });
  try {
    const words = view.text();
    assert.match(view.text('status-investor-positions-error'), /Positions could not be read\. No empty book or zero is shown in its place\.\s*Retry/);
    assert.equal(view.text('positions-register'), null, 'a failed read drew the register');
    assert.doesNotMatch(words, /D1_SECRET_INTERNAL_DETAIL|No position is recorded|Total · 0|\$0\b/);
    assert.match(view.text('status-investor-positions-partial'), /Reporting could not be read/);
    assert.match(view.text('rule-stale-update-unreadable'), /Unreadable · Reporting could not be read\. Not a claim that nothing fired\./);
    assert.match(view.text('rule-below-cost'), /Unreadable · Positions could not be read/);

    const before = view.calls.length;
    positionsUp = true;
    await view.click('button-retry-investor-positions');
    // The one other call is the lazy 90-day history of the company now readable as Attention.
    assert.deepEqual(view.calls.slice(before).filter((c) => !c.startsWith('/api/portfolio/health/')), ['/api/positions'], 'Retry re-read more than the positions');
    // The reporting read still failed: mark age has no reference date, so stale reads Unreadable, never a count.
    assert.match(view.text('positions-count-stale'), /Unreadable.*reporting read’s date, which could not be read/);
    assert.match(view.text('positions-count-coverage'), /3 of 5/);
    assert.match(view.text('row-investor-position-ledger-1'), /Unreadable.*Healthy/, 'reporting is not Unreadable in its own column');
  } finally { await view.close(); }
});

test('Not recorded: an empty book says so; one company\'s mark history opens, and a failed one is Unreadable', async () => {
  const empty = await mount(({ path }) => (path === '/api/positions' ? json({ items: [] }) : book({ path })));
  try {
    assert.match(empty.text('positions-empty'), /No position is recorded for this investor account yet/);
    for (const id of ['coverage', 'stale', 'unusable']) {
      assert.match(empty.text(`positions-count-${id}`), /Not recordedNo position is recorded in this book\./, `${id} is not Not recorded`);
    }
    assert.equal(empty.text('positions-total'), null, 'an empty book drew a total');
    assert.doesNotMatch(empty.text(), /\$0\b|0 of 0/);
  } finally { await empty.close(); }

  let detailUp = false;
  const view = await mount(({ path }) => {
    if (path === '/api/positions/northwind') return detailUp ? json(NORTHWIND) : json({ detail: 'down' }, 500);
    if (path === '/api/positions/kite') return json({ project: { uid: 'kite' }, marks: [], rounds: [], distributions: [] });
    return book({ path });
  });
  try {
    await view.click('button-mark-history-2');
    assert.match(view.text('positions-mark-drawer-header'), /Mark historyNorthwind Labs/);
    assert.match(view.text('status-mark-drawer-unreadable'), /could not be read\. That is not a claim that no mark is recorded\./);
    assert.equal(view.text('mark-drawer-empty'), null, 'a failed read drew an empty history');
    detailUp = true;
    await view.click('button-retry-mark-drawer');
    const drawer = view.text('mark-drawer-body');
    assert.match(drawer, /Stale · latest mark 7 months old/);
    assert.ok(drawer.indexOf('31 Mar 2026') < drawer.indexOf('15 Jun 2025'), 'the history is not newest first');
    assert.match(drawer, /31 Mar 2026\$2,400,000\$38,700,000Priced roundPriced roundterm sheet/);
    assert.match(drawer, /What “stale” meansNo mark newer than two quarters, measured at 13 Nov 2026/);

    await view.click('button-mark-history-4');
    assert.match(view.text('mark-drawer-empty'), /No mark is recorded for Kite Systems\. The position carries at cost \(\$1,000,000\)/);
  } finally { await view.close(); }
});

test('the model: mark kinds, staleness, the reference date, basis words, counts and the total', () => {
  assert.deepEqual(markOf(POSITIONS.items[3]), { kind: 'none' });
  assert.equal(markOf(POSITIONS.items[4]).kind, 'unusable');
  assert.equal(markOf(POSITIONS.items[0]).kind, 'marked');

  assert.equal(isStale('2026-03-31', '2026-09-30'), false, '183 days is two quarters, not older');
  assert.equal(isStale('2026-03-31', '2026-10-01'), true);
  assert.equal(isStale(null, '2026-10-01'), null);

  assert.deepEqual(markReference('', { state: 'unreadable' }), { date: null, state: 'unreadable' });
  assert.equal(markReference('', { state: 'ok', value: { as_of: '2026-11-13' } }).date, '2026-11-13');
  assert.equal(markReference('2026-06-30', { state: 'unreadable' }).date, '2026-06-30', 'a chosen as-of date needs no other read');
  assert.equal(markReference('', { state: 'ok', value: {} }).state, 'not_recorded');

  assert.equal(basisLabel(null), null, 'a missing basis became the column default');
  assert.equal(basisLabel('round_price'), 'Priced round');
  assert.equal(basisLabel('gp_estimate'), 'GP estimate');

  const reads = { positions: { state: 'ok', value: POSITIONS }, health: { state: 'ok', value: HEALTH }, compliance: { state: 'ok', value: COMPLIANCE } };
  const rows = registerRowsOf(reads, { date: '2026-11-13', state: 'ok' });
  const counts = markCountsOf(rows, { date: '2026-11-13', state: 'ok' });
  assert.equal(counts.coverage.marked, 3);
  assert.equal(counts.stale.count, 1);
  assert.equal(counts.unusable.count, 1);
  const total = registerTotalOf(rows);
  assert.equal(total.carrying, '$10,450,000');
  assert.equal(total.atCost.length, 2);
  assert.equal(registerRowsOf({ ...reads, positions: { state: 'unreadable' } }, { date: null, state: 'ok' }), null, 'a failed read became rows');

  const history = markHistoryOf(NORTHWIND, { date: '2026-11-13' });
  assert.equal(history.rows[0].date, '31 Mar 2026');
  assert.equal(history.stale, true);
  assert.equal(markHistoryOf({ marks: [] }, { date: '2026-11-13' }).stale, null);
});
