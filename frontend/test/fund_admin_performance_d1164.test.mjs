// D1164 (#3071, part 7 of #2388) — Fund admin's NAV & performance (FND10,
// FND11 dark, FND12 dialogs): the NAV line, the seven tiles with each missing
// one's reason, the two quarterly charts (a quarter with no NAV is a dashed
// bridge, never a dip to 0) and the positions chart, each with "View as
// table", the positions table, Funds side by side for All funds, and Record a
// mark (a future date refused before the call) and Move to another fund. The
// figures are made up and worked out in the comments.
//
// Run with:
//   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/fund_admin_performance_d1164.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import { FundAdminConsoleView } from '../src/pages/admin/fundAdmin/FundAdminConsole.jsx';
import { FILTER_KEPT, fundFilter } from '../src/pages/admin/fundAdmin/fundAdminModel.js';
import {
  checkMark, dollarsToCents, moveOptions, navTiles, positionRows, positionsChart, quarterCharts, sideBySide,
} from '../src/pages/admin/fundAdmin/performanceModel.js';

const h = React.createElement;
const ADMIN = { id: 2, role: 'admin', is_super_admin: 0 };
const TODAY = new Date().toISOString().slice(0, 10);
const TOMORROW = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);

// ── Fixtures ──────────────────────────────────────────────────────────────────
const OVERVIEW = () => ({
  as_of: '2026-10-26',
  entities: { state: 'ok', items: [] },
  funds: { state: 'ok', items: [
    { fund_id: 7, name: 'Example Fund I', committed_cents: 800000000, called_cents: 400000000, received_cents: 400000000, outstanding_cents: 0, overdue_lines: 0, next_due_date: null },
    { fund_id: 9, name: 'Example Fund II', committed_cents: 300000000, called_cents: 75000000, received_cents: 75000000, outstanding_cents: 0, overdue_lines: 0, next_due_date: null },
  ] },
  fees: { state: 'ok', items: [] }, drafts: { state: 'ok', items: [] }, matches: { state: 'ok', items: [] },
});
const NCN = 'TVPI needs a complete NAV.';
const LIST = () => ({ as_of: TODAY, items: [
  { id: 7, name: 'Example Fund I', status: 'active', nav_cents: 690000000, paid_in_cents: 400000000, distributed_cents: 60000000, dpi: 0.15, rvpi: 1.725, tvpi: 1.875, irr: 0.214, unavailable: {} },
  { id: 9, name: 'Example Fund II', status: 'active', nav_cents: null, paid_in_cents: 75000000, distributed_cents: 0, dpi: 0, rvpi: null, tvpi: null, irr: null,
    unavailable: { nav_cents: 'No position is attributed to this fund yet.', rvpi: NCN, tvpi: NCN, irr: 'IRR needs a complete NAV.' } },
] });
// Four quarters. Q3 2025 has an unmarked position: no NAV, no TVPI. NAV passes paid-in first in Q4 2025 (2.4M > 2M).
const HISTORY = () => ({ fund_id: 7, step: 'quarter', as_of: TODAY, first_call: '2025-03-14', truncated: false, items: [
  { quarter: 'Q1 2025', quarter_end: '2025-03-31', nav_cents: 90000000, paid_in_cents: 100000000, distributed_cents: 0, tvpi: 0.9, dpi: 0, rvpi: 0.9, irr: null, unavailable: { irr: 'Too early.' } },
  { quarter: 'Q2 2025', quarter_end: '2025-06-30', nav_cents: 100000000, paid_in_cents: 100000000, distributed_cents: 0, tvpi: 1, dpi: 0, rvpi: 1, irr: null, unavailable: {} },
  { quarter: 'Q3 2025', quarter_end: '2025-09-30', nav_cents: null, paid_in_cents: 200000000, distributed_cents: 0, tvpi: null, dpi: 0, rvpi: null, irr: null,
    unavailable: { nav_cents: 'Every attributed position needs a dated valuation.', tvpi: NCN } },
  { quarter: 'Q4 2025', quarter_end: '2025-12-31', nav_cents: 240000000, paid_in_cents: 200000000, distributed_cents: 0, tvpi: 1.2, dpi: 0, rvpi: 1.2, irr: 0.18, unavailable: {} },
] });
// Company A: cost $1,500,000, marked $3,200,000 on 9 Sep 2026. Company B: cost $1,000,000, no mark.
const POSITIONS = () => ({ fund_id: 7, as_of: TODAY, unmarked: 1, items: [
  { id: 41, company_name: 'Made-up Company A', round_name: 'Series A', invested_amount: 1500000, marked: true, value_cents: 320000000, valuation_date: '2026-09-09', source: 'Series A price', recorded_by: { id: 2, name: 'Made-up Admin' }, unavailable: {} },
  { id: 42, company_name: 'Made-up Company B', round_name: 'Seed', invested_amount: 1000000, marked: false, value_cents: null, valuation_date: null, source: null, recorded_by: null, unavailable: { value_cents: 'No valuation is recorded for this position; invested cost is not its value.' } },
] });
const ACCESS = (allowed = true) => ({ super_admin: false, acts: [{ act: 'fund.valuation', allowed, sentence: allowed ? null : 'Only an admin records a mark.' }] });

// ── The model ─────────────────────────────────────────────────────────────────

test('the seven tiles: each figure, or Not recorded with the Worker\'s reason; a missing TVPI reads its reason', () => {
  // Mutation checked: a missing figure drawn as 0.00x.
  const t = Object.fromEntries(navTiles(LIST().items[0], { positions: POSITIONS(), history: HISTORY() }).map((x) => [x.key, x]));
  assert.deepEqual(Object.keys(t), ['nav', 'paid', 'dist', 'dpi', 'rvpi', 'tvpi', 'irr']);
  assert.deepEqual([t.nav.text, t.nav.note, t.tvpi.text, t.irr.text, t.irr.note], ['$6,900,000.00', 'latest marks of 1 position', '1.88x', '21.4%', 'since 14 Mar 2025']);
  const two = Object.fromEntries(navTiles(LIST().items[1]).map((x) => [x.key, x]));
  assert.deepEqual([two.tvpi.text, two.tvpi.reason], [null, NCN]);
  assert.deepEqual([two.nav.text, two.nav.reason], [null, 'No position is attributed to this fund yet.']);
  assert.equal(two.dpi.text, '0.00x', 'a measured zero is a zero');
});

test('the quarterly charts keep a quarter with no NAV as null (a bridge), say which quarter, and table it as Not recorded', () => {
  // Mutations checked: a missing NAV as 0; the "passed paid-in" quarter off by one; the gap foot dropped.
  const c = quarterCharts(HISTORY());
  assert.deepEqual(c.labels, ['Q1 2025', 'Q2 2025', 'Q3 2025', 'Q4 2025']);
  assert.deepEqual(c.money.series[2].values, [900000, 1000000, null, 2400000]);
  assert.deepEqual(c.multiples.series[0].values, [0.9, 1, null, 1.2]);
  assert.deepEqual(c.multiples.series[1].values, [0, 0, 0, 0], 'DPI needs no NAV');
  assert.equal(c.money.note, 'NAV passed paid-in in Q4 2025 and NAV stands at $2,400,000.00 in Q4 2025.');
  assert.match(c.money.foot, /^Q3 2025 has no complete NAV: .* it is not a dip to zero\.$/);
  assert.deepEqual(c.money.table.rows[2], ['Q3 2025', '$2,000,000.00', '$0.00', 'Not recorded']);
  assert.deepEqual(c.multiples.table.rows[2], ['Q3 2025', 'Not recorded', '0.00x']);
  assert.equal(c.multiples.note, 'TVPI went from 0.90x to 1.20x.');
  assert.deepEqual(quarterCharts({ items: [], reason: 'No capital call is recorded for this fund.' }), { empty: true, reason: 'No capital call is recorded for this fund.' });
});

test('positions: cost against the latest mark, a missing mark never its cost; the table newest mark first; side by side with reasons', () => {
  // Mutations checked: an unmarked position drawn at its cost; invested dollars read as cents.
  const p = positionsChart(POSITIONS());
  assert.deepEqual(p.rows.map((r) => [r.label, r.a.value, r.b.value, r.b.text]), [['Made-up Company A', 1500000, 3200000, '$3,200,000.00'], ['Made-up Company B', 1000000, null, null]]);
  assert.equal(p.note, '1 of 2 positions have no mark, so NAV is not complete.');
  assert.deepEqual(p.table.rows[1], ['Made-up Company B', '$1,000,000.00', 'No mark']);
  const allMarked = positionsChart({ items: [POSITIONS().items[0]] });
  assert.equal(allMarked.note, 'Made-up Company A’s latest mark is 2.13x its cost.');
  const rows = positionRows(POSITIONS());
  assert.deepEqual(rows.map((r) => [r.company, r.cost, r.mark, r.date]), [['Made-up Company A', '$1,500,000.00', '$3,200,000.00', '9 Sep 2026'], ['Made-up Company B', '$1,000,000.00', null, null]]);
  assert.match(rows[1].markReason, /invested cost is not its value/);
  assert.deepEqual(positionRows(POSITIONS(), { q: 'seed' }).map((r) => r.id), [42]);
  const side = sideBySide(LIST());
  assert.deepEqual(side[1].cells.map(([k, f]) => [k, f.text, f.reason]), [
    ['NAV', null, 'No position is attributed to this fund yet.'], ['Paid-in', '$750,000.00', null], ['Distributed', '$0.00', null],
    ['DPI', '0.00x', null], ['RVPI', null, NCN], ['TVPI', null, NCN], ['IRR', null, 'IRR needs a complete NAV.'],
  ]);
});

test('Record a mark is checked before the call: a date not in the future, a value in dollars (0 allowed), a source of 1 to 500', () => {
  // Mutations checked: a future date accepted; a write-off (0) refused; a blank source accepted.
  assert.deepEqual(checkMark({ date: '2026-09-30', value: '150,000.50', source: ' Series A price ' }, '2026-10-26'),
    { ok: true, body: { valuation_date: '2026-09-30', value_cents: 15000050, source: 'Series A price' } });
  assert.equal(checkMark({ date: '2026-10-27', value: '1', source: 's' }, '2026-10-26').errors.date, 'The valuation date cannot be in the future.');
  assert.equal(checkMark({ date: '2026-10-26', value: '1', source: 's' }, '2026-10-26').ok, true, 'today is not the future');
  assert.equal(checkMark({ date: '2026-02-30', value: '1', source: 's' }, '2026-10-26').errors.date, 'Enter the valuation date.');
  assert.equal(checkMark({ date: '2026-09-30', value: '0', source: 'Written off' }, '2026-10-26').body.value_cents, 0);
  assert.equal(checkMark({ date: '2026-09-30', value: '1.234', source: 's' }, '2026-10-26').errors.value, 'Enter the value in dollars, for example 150000.00.');
  assert.equal(checkMark({ date: '2026-09-30', value: '1', source: '   ' }, '2026-10-26').errors.source, 'Say where this value comes from.');
  assert.equal(checkMark({ date: '2026-09-30', value: '1', source: 'x'.repeat(501) }, '2026-10-26').errors.source, 'The source is at most 500 characters.');
  assert.equal(dollarsToCents('$1,000'), 100000);
  assert.deepEqual(moveOptions([{ id: 7, name: 'Fund I' }, { id: 9, name: 'Fund II' }], 7).map((o) => [o.label, o.current, o.id]),
    [['Fund I', true, 7], ['Fund II', false, 9], ['Firm-level (no fund)', false, null]]);
  // The filter: this tab offers All funds and reads the chosen one, so it does not say the filter is only kept.
  const funds = [{ id: 7, name: 'Fund I' }];
  assert.equal(fundFilter(funds, '?fund=7', 'performance').note, null);
  assert.equal(fundFilter(funds, '?fund=7', 'lps').note, FILTER_KEPT);
  assert.equal(fundFilter(funds, '', 'performance').pills[0].on, true, 'All funds');
});

// ── The page, mounted ─────────────────────────────────────────────────────────

function stubs({ history = HISTORY, positions = POSITIONS, access = ACCESS(true), record = null, attribute = null } = {}) {
  const calls = [];
  const rec = (name, f) => (...args) => { calls.push([name, ...args]); return f(...args); };
  return {
    calls,
    apis: {
      fundAdmin: { access: rec('access', async () => access), overview: rec('overview', async () => OVERVIEW()) },
      performance: {
        list: rec('list', async () => LIST()),
        history: rec('history', async () => history()),
        positions: rec('positions', async () => positions()),
        recordValuation: rec('recordValuation', record || (async () => ({ id: 1 }))),
        attribute: rec('attribute', attribute || (async () => ({ ok: true }))),
      },
      mercury: { connections: async () => ({ ok: true, entities: [] }), accounts: async () => ({ ok: true, items: [] }), transactions: async () => ({ ok: true, items: [] }), matches: async () => ({ ok: true, items: [] }) },
      fees: { periods: async () => ({ items: [] }), terms: async () => ({ items: [] }) },
      reporting: { list: async () => ({ items: [] }) },
      funds: { distributions: async () => ({ items: [] }) },
      capitalAttestations: { forFund: async () => ({ items: [] }) },
    },
  };
}

async function mount(url, s = stubs()) {
  const restore = installDocument();
  if (!document.documentElement?.classList) document.documentElement = { ...(document.documentElement || {}), classList: { contains: () => false } };
  globalThis.addEventListener = () => {}; globalThis.removeEventListener = () => {}; globalThis.dispatchEvent = () => true;
  globalThis.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => root.render(h(MemoryRouter, { initialEntries: [url] }, h(FundAdminConsoleView, { user: ADMIN, apis: s.apis }))));
  const flush = () => act(async () => { for (let i = 0; i < 10; i += 1) await new Promise((r) => setTimeout(r, 0)); });
  await flush();
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const pr = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const txt = (n) => (!n ? '' : n.nodeType === 3 ? n.textContent || '' : n.childNodes?.length ? n.childNodes.map(txt).join(' ') : n.textContent || '');
  const by = (id) => walk(container).find((n) => pr(n)['data-testid'] === id);
  return {
    calls: s.calls, by, flush,
    has: (id) => Boolean(by(id)),
    text: (id) => txt(id ? by(id) : container).replace(/\s+/g, ' ').trim(),
    count: (sel) => walk(container).filter((n) => sel(pr(n), n)).length,
    async choose(id) { const n = by(id); assert.ok(n, `no ${id}`); await act(async () => { pr(n).onChange?.({ target: { checked: true } }); }); await flush(); },
    async click(id) { const n = by(id); assert.ok(n, `no ${id}`); await act(async () => { pr(n).onClick?.({ preventDefault() {}, stopPropagation() {}, button: 0 }); }); await flush(); },
    async type(id, value) { const n = by(id); assert.ok(n, `no ${id}`); await act(async () => { pr(n).onChange({ target: { value } }); }); await flush(); },
    async close() { await act(async () => root.unmount()); restore(); },
  };
}
const names = (calls) => calls.map((c) => c[0]);

test('one fund: the NAV line, the tiles, the charts with a dashed bridge and View as table, the positions, and side by side', async () => {
  // Mutations checked: the bridge drawn as a dip; View as table missing on a chart; the filter ignored.
  const v = await mount('/admin/fund-admin/performance?fund=7');
  try {
    assert.ok(v.has('fund-admin-panel-performance'), 'the tab keeps its panel');
    assert.match(v.text('fund-performance-head'), /NAV & performance · Example Fund I.*NAV is investments only/s);
    assert.match(v.text('fund-performance-tile-nav'), /\$6,900,000\.00 latest marks of 1 position/);
    assert.match(v.text('fund-performance-tile-irr'), /21\.4% since 14 Mar 2025/);
    assert.ok(!v.has('fund-admin-filter-note'), 'no "the filter is only kept" note on this tab');
    assert.deepEqual(v.calls.filter((c) => c[0] === 'history' || c[0] === 'positions').map((c) => [c[0], c[1]]), [['history', 7], ['positions', 7]]);
    // The money chart bridges Q3 2025 with one dashed segment on the NAV line, and draws three NAV points, not four.
    assert.equal(v.count((p) => p['data-bridge'] === 'true'), 2, 'one bridge for NAV, one for TVPI');
    assert.match(v.text('fund-chart-money-foot'), /Q3 2025 has no complete NAV/);
    for (const id of ['fund-chart-money', 'fund-chart-multiples', 'fund-chart-positions']) {
      assert.equal(v.text(`${id}-toggle`), 'View as table', `${id} has View as table`);
      await v.click(`${id}-toggle`);
      assert.ok(v.has(`${id}-table`), `${id}'s table`);
    }
    assert.match(v.text('fund-chart-money-table'), /Q3 2025 \$2,000,000\.00 \$0\.00 Not recorded/);
    assert.match(v.text('fund-position-41'), /Made-up Company A.*\$1,500,000\.00.*\$3,200,000\.00.*9 Sep 2026.*Series A price.*Made-up Admin/s);
    assert.match(v.text('fund-position-42'), /Made-up Company B.*No mark/s);
    assert.match(v.text('fund-side-9'), /Example Fund II.*Not recorded.*\$750,000\.00/s, 'Funds side by side, with Not recorded');
  } finally { await v.close(); }
});

test('Record a mark: a future date is refused before any call; a valid mark is sent and the tab reads again', async () => {
  // Mutations checked: the check skipped (the call made with a future date); the reload after saving dropped.
  const s = stubs();
  const v = await mount('/admin/fund-admin/performance?fund=7', s);
  try {
    await v.click('fund-position-mark-42');
    assert.ok(v.has('fund-mark-dialog'));
    await v.type('fund-mark-date', TOMORROW);
    await v.type('fund-mark-value', '150000');
    await v.type('fund-mark-source', 'Series A price');
    await v.click('fund-mark-save');
    assert.equal(v.text('fund-mark-error-date'), 'The valuation date cannot be in the future.');
    assert.ok(!names(s.calls).includes('recordValuation'), 'refused before the call');
    await v.type('fund-mark-date', TODAY);
    const before = names(s.calls).filter((n) => n === 'positions').length;
    await v.click('fund-mark-save');
    const call = s.calls.find((c) => c[0] === 'recordValuation');
    assert.deepEqual(call.slice(1), [42, { valuation_date: TODAY, value_cents: 15000000, source: 'Series A price' }]);
    assert.ok(!v.has('fund-mark-dialog'), 'the dialog closes');
    assert.ok(names(s.calls).filter((n) => n === 'positions').length > before, 'the positions are read again');
  } finally { await v.close(); }
});

test('Move to another fund sends the chosen fund; a refusal stays in the dialog and changes nothing on the page', async () => {
  const fail = async () => { const e = new Error('The position changed. Reload before attributing it.'); throw e; };
  let s = stubs();
  let v = await mount('/admin/fund-admin/performance?fund=7', s);
  try {
    await v.click('fund-position-move-41');
    assert.match(v.text('fund-move-options'), /Example Fund I Where it counts now.*Example Fund II.*Firm-level \(no fund\)/s);
    await v.choose('fund-move-f-9');
    await v.click('fund-move-save');
    assert.deepEqual(s.calls.find((c) => c[0] === 'attribute').slice(1), [41, 9]);
  } finally { await v.close(); }
  s = stubs({ attribute: fail });
  v = await mount('/admin/fund-admin/performance?fund=7', s);
  try {
    await v.click('fund-position-move-41');
    await v.choose('fund-move-firm');
    await v.click('fund-move-save');
    assert.equal(s.calls.find((c) => c[0] === 'attribute')[2], null, 'firm-level is null');
    assert.match(v.text('fund-move-failed'), /The position changed/);
  } finally { await v.close(); }
});

test('the act table: a viewer refused fund.valuation reads its sentence, never a disabled button', async () => {
  const v = await mount('/admin/fund-admin/performance?fund=7', stubs({ access: ACCESS(false) }));
  try {
    assert.equal(v.text('fund-position-refused-41'), 'Only an admin records a mark.');
    assert.ok(!v.has('fund-position-mark-41'));
  } finally { await v.close(); }
});

test('All funds: the prompt and Funds side by side, no per-fund read; a failed history leaves the tiles and positions', async () => {
  // Mutations checked: a per-fund read made with no fund chosen; a failed history blanking the tab.
  let s = stubs();
  let v = await mount('/admin/fund-admin/performance', s);
  try {
    assert.match(v.text('fund-performance-pick'), /Pick a fund above/);
    assert.ok(v.has('fund-side-by-side'));
    assert.ok(!names(s.calls).includes('history') && !names(s.calls).includes('positions'));
  } finally { await v.close(); }
  s = stubs({ history: () => { throw new Error('down'); } });
  v = await mount('/admin/fund-admin/performance?fund=7', s);
  try {
    assert.match(v.text('fund-admin-performance'), /The quarterly history could not be read\. This is not a claim that the fund has no quarters\. Retry/);
    assert.ok(v.has('fund-performance-tile-nav'));
    assert.ok(v.has('fund-position-41'));
  } finally { await v.close(); }
});

test('the source: dialogs in-page, no browser pop-up, every chart through D893\'s Charts module', () => {
  const page = readFileSync('frontend/src/pages/admin/fundAdmin/PerformanceTab.jsx', 'utf8');
  assert.ok(!/\b(alert|confirm|prompt)\(/.test(page));
  assert.match(page, /<Lightbox label="Record a mark"/);
  assert.match(page, /<Lightbox label="Move to another fund"/);
  assert.match(page, /import \{ PairBars, QuarterLines, ChartTable \} from '\.\.\/\.\.\/\.\.\/ui\/Charts'/);
  assert.match(page, /act="fund\.valuation"/);
});
