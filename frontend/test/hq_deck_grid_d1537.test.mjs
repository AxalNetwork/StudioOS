// D1537 (#3786, deck v2 B10) — HQ › Decks › Grid health and Funnel.
//
//   1. the model: percents, dollars, seconds and hours, each Not recorded when
//      the Worker has no figure; the grid's rows, the budget card and the KPIs;
//   2. Grid health draws the budget, the ceiling and the table; a failed read
//      says Could not be read with Try again, never an empty table;
//   3. Funnel draws the tiles, the bands and the accept rates; the tabs and
//      routes, and /admin/ai/deck-grid opening Grid health.
//
//   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/hq_deck_grid_d1537.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { installDocument } from './_contracts_dom.mjs';
import { adminDeckGridApi } from '../src/lib/api/adminDeckGrid.js';
import DeckGridTab from '../src/pages/hq/decks/DeckGridTab.jsx';
import {
  NOT_RECORDED, UNREADABLE, budgetCard, ceilingLine, gridRows, hours, kpiTiles, pct, quoteBands, secs, usd,
} from '../src/pages/hq/decks/deckGridModel.js';

const h = React.createElement;
const GRID = {
  days: 30,
  rows: [
    { element: 'title', kind: 'text', model: 'm1', model_label: 'llama-3.3', steps: 20, done: 19, failed: 1, error_rate: 0.05, p95_seconds: 19, p95_target_seconds: 5, p95_over_target: true, cost_microusd: 1900, fallbacks: 1, drift: false, eval_score: { available: false, reason: 'not_recorded' } },
    { element: 'photo', kind: 'image', model: 'gone', model_label: 'gone', steps: 1, done: 1, failed: 0, error_rate: 0, p95_seconds: null, p95_target_seconds: 10, p95_over_target: null, cost_microusd: 0, fallbacks: 0, drift: true, eval_score: { available: false, reason: 'not_recorded' } },
  ],
  budget: { window_days: 28, target_success: 0.99, finished: 400, failed: 2, success_rate: 0.995, budget_failures: 4, used_fraction: 0.5, last_hour_failed: 1, last_hour_fraction: 0.25, alerting: true },
};
const GEN = { ceiling: { ceiling_microusd: 5_000_000, spent_today_microusd: 1_250_000, percent: 25, paused: false } };
const FUNNEL = {
  days: 30,
  generations: { decks_generating: 2, decks_three_plus: 1, rate: 0.5 },
  quote_conversion: [{ label: 'Under $0.10', from_microusd: 0, shown: 2, confirmed: 1, conversion: 0.5 }, { label: '$2 and over', from_microusd: 2_000_000, shown: 0, confirmed: 0, conversion: null }],
  accept_rates: [{ element: 'title', model: 'm1', model_label: 'llama-3.3', proposals: 4, decided: 2, accept_rate: 0.5 }],
  first_share: { ventures: 1, median_hours: 12 },
  retention_4w: null,
};

test('1. the model: every missing figure is Not recorded, never 0; the rows, budget card and KPIs', () => {
  // Mutation checked: pct returning 0% for null → the Not recorded checks fail; the p95 tone ignoring over_target → the tone fails;
  // a KPI read that failed drawn as 0 → the Could not be read check fails.
  assert.deepEqual([pct(0.05), pct(0), pct(null), pct(undefined)], ['5%', '0%', NOT_RECORDED, NOT_RECORDED]);
  assert.deepEqual([usd(1_250_000), usd(1900), usd(0), usd(null)], ['$1.25', '<$0.01', '$0.00', NOT_RECORDED]);
  assert.deepEqual([secs(19), secs(null), hours(12), hours(72), hours(null)], ['19 s', NOT_RECORDED, '12 h', '3 days', NOT_RECORDED]);
  const rows = gridRows(GRID);
  assert.deepEqual(rows.map((r) => [r.errorRate, r.p95, r.p95Tone, r.target, r.evalScore, r.drift]), [
    ['5%', '19 s', 'over', '5 s', NOT_RECORDED, null],
    ['0%', NOT_RECORDED, 'none', '10 s', NOT_RECORDED, 'No longer in the catalogue'],
  ]);
  assert.equal(gridRows({ rows: null }), null, 'a failed read is not an empty grid');
  assert.deepEqual(budgetCard(GRID.budget), { empty: false, success: '99.5%', used: '50%', lastHour: '1 failed · 25% of the budget', budget: '4 failed batches of 400', alerting: true });
  assert.equal(budgetCard({ finished: 0 }).empty, true);
  assert.equal(budgetCard(null), null);
  const tiles = kpiTiles(FUNNEL);
  assert.deepEqual(tiles.map((t) => t.value), ['50%', '12 h', UNREADABLE]);
  assert.equal(tiles[0].sub, '1 of 2 decks that generated');
  assert.deepEqual(quoteBands(FUNNEL).map((b) => b.conversion), ['50%', NOT_RECORDED]);
  assert.deepEqual([ceilingLine(GEN), ceilingLine({ ceiling: { ceiling_microusd: null } }), ceilingLine(null)], ['$1.25 of $5.00 today (25%)', 'Not set', NOT_RECORDED]);
});

async function mount(view, over = {}) {
  const orig = { ...adminDeckGridApi };
  adminDeckGridApi.grid = over.grid || (async () => GRID);
  adminDeckGridApi.generation = over.generation || (async () => GEN);
  adminDeckGridApi.funnel = over.funnel || (async () => FUNNEL);
  const restore = installDocument();
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  const settle = () => act(async () => { for (let i = 0; i < 6; i += 1) await new Promise((r) => setTimeout(r, 0)); });
  await act(async () => { root.render(h(DeckGridTab, { view })); });
  await settle();
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const pr = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const nodes = () => walk(container);
  const by = (id) => nodes().find((n) => pr(n)['data-testid'] === id);
  const textOf = (n) => (!n ? '' : n.nodeType === 3 ? n.textContent || '' : n.childNodes?.length ? n.childNodes.map(textOf).join(' ') : n.textContent || '');
  const text = (n) => textOf(n).replace(/\s+/g, ' ');
  return {
    by, text, pr, settle,
    async unmount() { await act(async () => root.unmount()); restore(); Object.assign(adminDeckGridApi, orig); },
  };
}

test('2. Grid health: the budget, the ceiling and the table; a failed read says so with Try again', async () => {
  // Mutation checked: the null rows drawn as the empty line → the unreadable check fails; the ceiling line dropped → its text fails.
  let v = await mount('grid');
  try {
    assert.ok(v.by('hq-deck-grid-table'));
    assert.match(v.text(v.by('hq-deck-grid-ceiling')), /\$1\.25 of \$5\.00 today \(25%\)/);
    assert.match(v.text(v.by('hq-deck-grid-last-hour')), /1 failed · 25% of the budget/);
    assert.match(v.text(v.by('hq-deck-grid-row-photo|image|gone')), /No longer in the catalogue/);
  } finally { await v.unmount(); }
  v = await mount('grid', { grid: async () => ({ days: 30, rows: null, budget: null }) });
  try {
    assert.ok(v.by('hq-deck-grid-rows-unreadable'), 'unreadable, not an empty grid');
    assert.equal(v.by('hq-deck-grid-empty'), undefined);
    assert.ok(v.by('hq-deck-grid-budget-unreadable'));
  } finally { await v.unmount(); }
  v = await mount('grid', { grid: async () => { throw Object.assign(new Error('x'), { status: 500 }); } });
  try { assert.ok(v.by('hq-deck-grid-unreadable')); } finally { await v.unmount(); }
  v = await mount('grid', { grid: async () => { throw Object.assign(new Error('x'), { status: 403 }); } });
  try { assert.ok(v.by('hq-deck-grid-refused')); } finally { await v.unmount(); }
});

test('3. Funnel: the tiles, bands and accept rates; the tabs, routes and the plan’s address', async () => {
  // Mutation checked: the funnel view routed to Grid health → the KPI tile check fails; the redirect removed → the route check fails.
  const v = await mount('funnel');
  try {
    assert.match(v.text(v.by('hq-deck-kpi-generations')), /50% 1 of 2 decks that generated/);
    assert.match(v.text(v.by('hq-deck-kpi-retention')), /Could not be read/);
    assert.ok(v.by('hq-deck-bands'));
    assert.match(v.text(v.by('hq-deck-accept')), /llama-3\.3 4 2 50%/);
  } finally { await v.unmount(); }
  const read = (f) => readFileSync(new URL(`../src/${f}`, import.meta.url), 'utf8');
  const routes = read('routes/hqDecks.jsx');
  for (const p of ['grid', 'funnel']) assert.ok(routes.includes(`<Route path="/admin/platform/decks/${p}" element={guard(['admin'], hqOnly(<HqDecksPage />))} />`), p);
  assert.doesNotMatch(routes, /<Route path="\/admin\/ai\/deck-grid" element={<Navigate to="\/admin\/platform\/decks\/grid" replace \/>} \/>/);
  assert.match(read('pages/hq/decks/HqDecksPage.jsx'), /view === 'grid' \|\| view === 'funnel' \? <DeckGridTab view={view} \/>/);
});
