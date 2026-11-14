/**
 * D6207 (#6207): the Overview's dated basis and the change since the last
 * completed quarter-end. Mounted against stubbed Worker reads:
 *
 *   1. populated — the basis strip says the Worker's date and read time, and
 *      "NAV up $X since 30 Sep 2026 (quarter-end)" is drawn under the hero
 *      from one extra read at kpi-compliance's `period_until`;
 *   2. gap — the quarter-end read answers and holds no book: no line;
 *   3. Unreadable — the quarter-end read fails, the hero fails, or the
 *      reporting read fails (so no quarter-end is known): no line, no number;
 *   4. the model on its own.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/portfolio_overview_nav_change_6207.test.mjs
 *
 * Mutation checked (fails with the mutation, passes without):
 *   - `navChangeOf` drawing against any settled quarter-end point (not only
 *     'ok') → tests 2, 3 and 4;
 *   - `navChangeOf` ignoring a failed hero → test 4 (on the page,
 *     `PerformanceSummary` already drops `change` when the hero failed).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import InvestorPortfolioCanvas from '../src/pages/investor/InvestorPortfolioCanvas.jsx';
import { dayTime, lastQuarterEndOf, navChangeOf, performanceOf } from '../src/pages/portfolio/portfolioModel.js';

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
  const settle = async () => { for (let i = 0; i < 20; i += 1) await act(async () => { await new Promise((resolve) => setImmediate(resolve)); }); };
  await act(async () => root.render(h(MemoryRouter, { initialEntries: ['/portfolio'] }, h(InvestorPortfolioCanvas))));
  await settle();
  return {
    calls,
    text: (id) => (id ? (byTestId(id) ? textOf(byTestId(id)) : null) : textOf(box)),
    async close() { await act(async () => root.unmount()); globalThis.fetch = realFetch; restore(); },
  };
}

const POSITIONS = { items: [
  { project_id: 1, project: { uid: 'lumen', name: 'Lumen Robotics' }, total_invested: 2000000, vintage: 2025, fmv: 5200000, multiple: 2.6, unmarked: false, mark_as_of: '2026-09-30' },
  { project_id: 2, project: { uid: 'kite', name: 'Kite Systems' }, total_invested: 1000000, vintage: 2026, fmv: 1000000, multiple: 1, unmarked: true, mark_as_of: null },
] };
const returns = { tvpi: { value: 2.07, state: 'computed', reason: null } };
const HERO = {
  paid_in: 3000000, distributed: 0, nav: 6200000, basis: 'gross', returns, position_count: 2, unmarked_position_count: 1, mark_coverage: 0.5,
  as_of: null, as_of_default: '2026-11-14', read_at: '2026-11-14T10:32:07.123Z',
};
const QUARTER = { ...HERO, nav: 4800000, as_of: '2026-09-30' };
const COMPLIANCE = {
  cadence: 'quarterly', period: '2026-Q3', as_of: '2026-11-14', period_until: '2026-09-30', period_complete: true, period_in_progress: false,
  reported_count: 0, total_count: 2, companies: [{ project_id: 1, reported: false }, { project_id: 2, reported: false }],
};

const book = ({ hero = () => json(HERO), quarter = () => json(QUARTER), compliance = () => json(COMPLIANCE) } = {}) => ({ path, query }) => {
  if (path === '/api/positions/analytics') return query ? (query === '?as_of=2026-09-30' ? quarter() : json({ detail: 'unexpected' }, 500)) : hero();
  if (path === '/api/positions') return json(POSITIONS);
  if (path === '/api/positions/kpi-compliance') return compliance();
  if (path === '/api/portfolio/health') return json({ items: [], not_measured: [], totals: {} });
  if (path === '/api/portfolio-updates/latest') return json({ items: [] });
  if (path === '/api/portfolio-support') return json({ entries: [], untouched: [], totals: {} });
  return json({});
};

test('1. populated: the basis strip says the Worker\'s date and read time; the change since the quarter-end is drawn', async () => {
  const view = await mount(book());
  try {
    assert.equal(view.text('metric-nav'), '$6,200,000');
    const basis = view.text('portfolio-basis');
    assert.match(basis, /As of 14 Nov 2026 · latest recorded marks/);
    assert.match(basis, /Read at 14 Nov 2026, 10:32 UTC/);
    assert.equal(view.text('portfolio-nav-change'), 'NAV up $1,400,000 since 30 Sep 2026 (quarter-end)');
    assert.equal(view.calls.filter((c) => c === '/api/positions/analytics?as_of=2026-09-30').length, 1, 'one extra read, at period_until');
    assert.equal(view.calls.filter((c) => c.startsWith('/api/positions/analytics')).length, 2);
  } finally { await view.close(); }
  const down = await mount(book({ quarter: () => json({ ...QUARTER, nav: 6500000 }) }));
  try {
    assert.equal(down.text('portfolio-nav-change'), 'NAV down $300,000 since 30 Sep 2026 (quarter-end)');
  } finally { await down.close(); }
});

test('2. gap: the quarter-end read answers and holds no book — no change line, no number', async () => {
  const view = await mount(book({ quarter: () => json({ ...QUARTER, nav: 0, paid_in: 0, position_count: 0, unmarked_position_count: 0 }) }));
  try {
    assert.equal(view.text('metric-nav'), '$6,200,000');
    assert.equal(view.text('portfolio-nav-change'), null);
    assert.doesNotMatch(view.text('portfolio-performance'), /since 30 Sep|NAV (up|down|unchanged)|\$6,200,000 since/);
    assert.match(view.text('portfolio-basis'), /Read at 14 Nov 2026, 10:32 UTC/, 'the dated basis stays');
  } finally { await view.close(); }
});

test('3. Unreadable: either read failing draws no change line and no number', async () => {
  // The quarter-end read fails.
  const lost = await mount(book({ quarter: () => json({ detail: 'x' }, 500) }));
  try {
    assert.equal(lost.text('metric-nav'), '$6,200,000');
    assert.equal(lost.text('portfolio-nav-change'), null);
    assert.doesNotMatch(lost.text('portfolio-performance'), /since|\$1,400,000/);
  } finally { await lost.close(); }
  // The quarter-end read answers for a different date: not that quarter's read.
  const wrong = await mount(book({ quarter: () => json({ ...QUARTER, as_of: null }) }));
  try { assert.equal(wrong.text('portfolio-nav-change'), null); } finally { await wrong.close(); }
  // The hero fails.
  const hero = await mount(book({ hero: () => json({ detail: 'x' }, 500) }));
  try {
    assert.equal(hero.text('metric-nav'), 'Unreadable');
    assert.equal(hero.text('portfolio-nav-change'), null);
    assert.doesNotMatch(hero.text(), /since 30 Sep|\$1,400,000|\$4,800,000/);
  } finally { await hero.close(); }
  // The reporting read fails: no quarter-end is known, so none is read.
  const window = await mount(book({ compliance: () => json({ detail: 'x' }, 500) }));
  try {
    assert.equal(window.text('portfolio-nav-change'), null);
    assert.equal(window.calls.filter((c) => c.startsWith('/api/positions/analytics?')).length, 0, 'no quarter-end read on a guess');
    assert.match(window.text('portfolio-basis'), /As of 14 Nov 2026 · latest recorded marks.*Read at 14 Nov 2026, 10:32 UTC/);
  } finally { await window.close(); }
});

test('4. the model: dated basis words, the last quarter-end and the change', () => {
  const ok = (value) => ({ state: 'ok', value });
  assert.equal(dayTime('2026-11-14T10:32:07.123Z'), '14 Nov 2026, 10:32 UTC');
  assert.equal(dayTime('2026-11-14'), null);
  assert.equal(dayTime('nonsense'), null);
  // Basis: explicit as_of wins; a default read names the Worker's date; an old Worker keeps D4817's words.
  assert.equal(performanceOf(ok({ ...HERO, as_of: '2026-09-30' }), { state: 'loading' }).asOf, 'As of 30 Sep 2026');
  assert.equal(performanceOf(ok(HERO), { state: 'loading' }).asOf, 'As of 14 Nov 2026 · latest recorded marks');
  const old = performanceOf(ok({ nav: 1, basis: 'gross' }), { state: 'loading' });
  assert.equal(old.asOf, 'As of the latest recorded marks');
  assert.ok(!old.basis.some((t) => t.startsWith('Read at')));
  // The last completed quarter-end comes from the reporting read, through quarterWindowOf.
  assert.equal(lastQuarterEndOf(ok(POSITIONS), ok(COMPLIANCE)), '2026-09-30');
  assert.equal(lastQuarterEndOf(ok(POSITIONS), { state: 'unreadable' }), null);
  assert.equal(lastQuarterEndOf(ok(POSITIONS), ok({ ...COMPLIANCE, period_complete: false })), null);
  assert.equal(lastQuarterEndOf({ state: 'loading' }, ok(COMPLIANCE)), null);
  // The change.
  const d = '2026-09-30';
  assert.equal(navChangeOf(ok(HERO), d, ok(QUARTER)).text, 'NAV up $1,400,000 since 30 Sep 2026 (quarter-end)');
  assert.equal(navChangeOf(ok(HERO), d, ok({ ...QUARTER, nav: 6200000 })).text, 'NAV unchanged since 30 Sep 2026 (quarter-end)');
  assert.equal(navChangeOf(ok(HERO), d, ok({ ...QUARTER, position_count: 0 })), null, 'a quarter-end with no book');
  assert.equal(navChangeOf(ok(HERO), d, ok({ ...QUARTER, nav: null })), null);
  assert.equal(navChangeOf(ok(HERO), d, { state: 'unreadable' }), null);
  assert.equal(navChangeOf(ok(HERO), d, { state: 'loading' }), null);
  assert.equal(navChangeOf({ state: 'unreadable' }, d, ok(QUARTER)), null);
  assert.equal(navChangeOf(ok({ ...HERO, position_count: 0, nav: 0 }), d, ok(QUARTER)), null, 'an empty hero book');
  assert.equal(navChangeOf(ok(HERO), null, ok(QUARTER)), null);
});
