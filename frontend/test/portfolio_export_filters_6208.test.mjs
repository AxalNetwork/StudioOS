/**
 * D6208 (#6208, canvas PF-01, PF-03, PF-09 "Export failure", PF-10 phone):
 * the Overview's Sector, Stage and Reporting filters beside Health with a
 * sort control, and Export on the Overview and on Performance through
 * `exportView`. Both pages are mounted against a stubbed `fetch`; the file
 * the browser is handed is read back from the Blob.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/portfolio_export_filters_6208.test.mjs
 *
 * Mutation checked, each both ways (fails with the mutation, passes without);
 * the counts are in D6208.md.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import InvestorPortfolioCanvas from '../src/pages/investor/InvestorPortfolioCanvas.jsx';
import InvestorPortfolioPerformance from '../src/pages/investor/InvestorPortfolioPerformance.jsx';
import {
  NONE, cohortExportOf, companyExportOf, companyRowsOf, filterOptionsOf, filterRows, filterWordsOf, quarterExportOf,
  sortRows, tableCaptionOf,
} from '../src/pages/portfolio/portfolioModel.js';

const h = React.createElement;
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/**
 * The browser's download, stubbed: `createObjectURL` keeps the Blob, and the
 * anchor's `click()` records the file name. `broken` takes `createObjectURL`
 * away, which is how a browser that refuses the file looks to `downloadCsv`.
 */
function installDownloads() {
  const files = [];
  const realCreate = document.createElement;
  const realURL = { create: URL.createObjectURL, revoke: URL.revokeObjectURL };
  let pending = null;
  const state = { broken: false };
  URL.createObjectURL = (blob) => { if (state.broken) throw new Error('refused'); pending = blob; return 'blob:test'; };
  URL.revokeObjectURL = () => {};
  document.createElement = function create(tag) {
    const node = realCreate.call(this, tag);
    if (String(tag).toLowerCase() === 'a') {
      node.click = () => { files.push({ name: node.download, blob: pending }); };
      node.remove = () => node.parentNode?.removeChild(node);
    }
    return node;
  };
  return {
    files,
    state,
    async text(i = files.length - 1) { return (await files[i].blob.text()).replace(/^﻿/, ''); },
    restore() { document.createElement = realCreate; URL.createObjectURL = realURL.create; URL.revokeObjectURL = realURL.revoke; },
  };
}

async function mount(Page, path, answer) {
  const restore = installDocument();
  const downloads = installDownloads();
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = new URL(String(input), 'http://localhost');
    return answer({ path: url.pathname, query: url.searchParams }) ?? json({});
  };
  const box = document.createElement('div');
  document.body.appendChild(box);
  const root = createRoot(box);
  const textOf = (node) => (node.nodeType === 3 ? node.textContent : (node.childNodes || []).map(textOf).join('') || node.textContent || '');
  const nodes = () => { const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)]; return walk(box); };
  const props = (node) => Object.entries(node).find(([key]) => key.startsWith('__reactProps$'))?.[1] || {};
  const byTestId = (id) => nodes().find((n) => props(n)['data-testid'] === id);
  const settle = async () => { for (let i = 0; i < 15; i += 1) await act(async () => { await new Promise((resolve) => setImmediate(resolve)); }); };
  await act(async () => root.render(h(MemoryRouter, { initialEntries: [path] }, h(Page))));
  await settle();
  return {
    downloads,
    text: (id) => (id ? (byTestId(id) ? textOf(byTestId(id)) : null) : textOf(box)),
    attr: (id, name) => props(byTestId(id) || {})[name],
    options: (id) => (byTestId(id)?.childNodes || []).map(textOf),
    rows: () => nodes().filter((n) => /^row-investor-position-/.test(props(n)['data-testid'] || '')).map((n) => props(n)['data-testid'].slice('row-investor-position-'.length)),
    async choose(id, value) {
      const node = byTestId(id);
      if (!node) throw new Error(`no ${id}`);
      await act(async () => { props(node).onChange({ target: { value } }); });
      await settle();
    },
    async click(id) {
      const node = byTestId(id);
      if (!node) throw new Error(`no ${id}`);
      await act(async () => { props(node).onClick({ preventDefault() {}, stopPropagation() {} }); });
      await settle();
    },
    async close() { await act(async () => root.unmount()); globalThis.fetch = realFetch; downloads.restore(); restore(); },
  };
}

/* ------------------------------------------------------- the Overview book */

const POSITIONS = {
  items: [
    { project_id: 1, project: { uid: 'lumen', name: 'Lumen Robotics', sector: 'robotics', stage: 'series_a' }, total_invested: 2000000, latest_ownership_pct: 8.5, fmv: 5200000, multiple: 2.6, mark_as_of: '2026-09-30' },
    { project_id: 2, project: { uid: 'northwind', name: 'Northwind Labs', sector: 'climate', stage: 'seed' }, total_invested: 1500000, latest_ownership_pct: 6.2, fmv: 1200000, multiple: 0.8, mark_as_of: '2026-03-31' },
    { project_id: 3, project: { uid: 'kite', name: 'Kite Systems', sector: 'robotics', stage: null }, total_invested: 1000000, latest_ownership_pct: 4, fmv: 1000000, multiple: null, unmarked: true, mark_as_of: null },
    { project_id: 4, project: { uid: 'fjord', name: 'Fjord Data', sector: null, stage: 'seed' }, total_invested: null, latest_ownership_pct: null, fmv: null, multiple: null, unmarked: true, mark_as_of: null },
  ],
};
const ANALYTICS = {
  as_of: '2026-09-30', basis: 'gross', nav: 7400000, paid_in: 4500000, distributed: 0,
  returns: { tvpi: { value: 1.64, state: 'computed' } }, position_count: 4, unmarked_position_count: 2,
};
const HEALTH_READ = { items: [{ project_id: 2, badge: 'red', snapshot_date: '2026-11-06' }, { project_id: 1, badge: 'green', snapshot_date: '2026-11-06' }], not_measured: [] };
const COMPLIANCE = {
  period: '2026-Q3', as_of: '2026-11-07', period_in_progress: false,
  population: { period: '2026-Q3' },
  companies: [
    { project_id: 1, reported: true, last_reported_at: '2026-11-02' },
    { project_id: 2, reported: false, last_reported_at: '2026-07-12' },
    { project_id: 3, reported: true, last_reported_at: '2026-10-30' },
  ],
};

const overview = (over = {}) => ({ path }) => {
  const routes = {
    '/api/positions': POSITIONS, '/api/positions/analytics': ANALYTICS, '/api/portfolio/health': HEALTH_READ,
    '/api/positions/kpi-compliance': COMPLIANCE, '/api/portfolio-updates/latest': { items: [] }, '/api/portfolio-support': { entries: [], totals: {} },
  };
  if (path in over) return over[path];
  return path in routes ? json(routes[path]) : json({});
};

const csvLines = (text) => text.split('\r\n');

test('1. Overview: Sector, Stage and Reporting beside Health, a sort control, and the caption names the filters in force', async () => {
  const m = await mount(InvestorPortfolioCanvas, '/portfolio', overview());
  try {
    // The selects sit beside Health, in the canvas's order, and offer what the book carries.
    const filters = m.text('portfolio-filters');
    assert.ok(filters.indexOf('Sector: all') < filters.indexOf('Stage: all') && filters.indexOf('Stage: all') < filters.indexOf('Health: all')
      && filters.indexOf('Health: all') < filters.indexOf('Reporting: all') && filters.indexOf('Reporting: all') < filters.indexOf('Sort: Health'));
    assert.deepEqual(m.options('select-portfolio-sector'), ['Sector: all', 'Sector: Climate', 'Sector: Robotics', 'Sector: Not recorded']);
    assert.deepEqual(m.options('select-portfolio-stage'), ['Stage: all', 'Stage: Seed', 'Stage: Series A', 'Stage: Not recorded']);
    assert.deepEqual(m.options('select-portfolio-reporting'), ['Reporting: all', 'Reporting: Not received', 'Reporting: Received', 'Reporting: Not recorded']);
    assert.deepEqual(m.options('select-portfolio-sort'), ['Sort: Health', 'Sort: Invested', 'Sort: Multiple', 'Sort: Last update']);
    assert.equal(m.text('portfolio-table-caption'), '4 of 4 companies · sorted by health, then invested · values gross');
    assert.equal(m.text('portfolio-filter-chips'), null, 'no count line while nothing narrows');

    await m.choose('select-portfolio-sector', 'robotics');
    assert.deepEqual(m.rows(), ['3', '1'], 'health order: Not recorded before Healthy');
    assert.equal(m.text('portfolio-table-caption'), '2 of 4 companies · filtered by Sector: Robotics · sorted by health, then invested · values gross');
    assert.match(m.text('portfolio-filter-chips'), /^2 of 4 companiesClear filters$/);
    await m.choose('select-portfolio-reporting', 'Received');
    await m.choose('select-portfolio-sort', 'multiple');
    assert.deepEqual(m.rows(), ['1', '3'], 'Kite records no multiple and sorts last, never as 0×');
    assert.equal(m.text('portfolio-table-caption'), '2 of 4 companies · filtered by Sector: Robotics, Reporting: Received · sorted by multiple, highest first · values gross');

    // A stage nobody recorded is its own choice, and a filter that matches nothing says so.
    await m.click('button-portfolio-clear-filters');
    await m.choose('select-portfolio-stage', NONE);
    assert.deepEqual(m.rows(), ['3']);
    assert.match(m.text('portfolio-table-caption'), /filtered by Stage: Not recorded/);
    await m.choose('select-portfolio-health', 'Attention');
    assert.deepEqual(m.rows(), []);
    assert.equal(m.text('portfolio-no-match'), 'No company matches these filters.');
    assert.match(m.text('portfolio-table-caption'), /^0 of 4 companies · filtered by Stage: Not recorded, Health: Attention/);

    // Sort by invested and by last update: the unrecorded sort last.
    await m.click('button-portfolio-clear-filters');
    await m.choose('select-portfolio-sort', 'invested');
    assert.deepEqual(m.rows(), ['1', '2', '3', '4']);
    await m.choose('select-portfolio-sort', 'updated');
    assert.deepEqual(m.rows(), ['1', '3', '2', '4']);
    await m.choose('select-portfolio-sort', 'health');
    assert.deepEqual(m.rows(), ['2', '3', '4', '1']);
  } finally { await m.close(); }
});

test('2. Overview Export writes the rows shown, in their order, with the basis and as-of; a gap is a word, never 0', async () => {
  const m = await mount(InvestorPortfolioCanvas, '/portfolio', overview());
  try {
    assert.equal(m.attr('button-export-portfolio-overview', 'disabled'), false);
    await m.choose('select-portfolio-sort', 'invested');
    await m.choose('select-portfolio-sector', 'robotics');
    await m.click('button-export-portfolio-overview');
    assert.equal(m.downloads.files.length, 1);
    assert.match(m.downloads.files[0].name, /^portfolio-overview-2-rows-\d{4}-\d{2}-\d{2}\.csv$/);
    const lines = csvLines(await m.downloads.text());
    assert.equal(lines[0], 'Company,Sector,Stage,Invested,Latest FMV,Mark date,Ownership,MOIC,Reporting,Period,Health,Last update,Basis,As of');
    assert.equal(lines.length, 3, 'the header and the two rows shown, nothing else');
    assert.equal(lines[1], 'Lumen Robotics,Robotics,Series A,"$2,000,000","$5,200,000",30 Sep 2026,8.5%,2.60×,Received,2026-Q3,Healthy,2 Nov 2026,Gross of fees and carry,30 Sep 2026');
    assert.equal(lines[2], 'Kite Systems,Robotics,Not recorded,"$1,000,000",No mark recorded,"Carried at cost $1,000,000",4.0%,Not recorded,Received,2026-Q3,Not recorded,30 Oct 2026,Gross of fees and carry,30 Sep 2026');
    assert.equal(m.text('button-export-portfolio-overview-failed'), null);

    await m.click('button-portfolio-clear-filters');
    await m.click('button-export-portfolio-overview');
    const all = csvLines(await m.downloads.text());
    assert.equal(all.length, 5);
    assert.equal(all[4], 'Fjord Data,Not recorded,Seed,Not recorded,No mark recorded,Not recorded,Not recorded,Not recorded,Not recorded,2026-Q3,Not recorded,Not recorded,Gross of fees and carry,30 Sep 2026');
    assert.ok(all.slice(1).every((l) => !/(^|,)(\$?0(\.0+)?|0\.00×)?(,|$)/.test(l.replace(/"[^"]*"/g, 'x'))), 'no empty or zero cell stands in for a gap');
  } finally { await m.close(); }
});

test('3. Overview Export over nothing loaded is disabled with its reason; a refused file says Export failed, and Try again writes it', async () => {
  const lost = await mount(InvestorPortfolioCanvas, '/portfolio', overview({ '/api/positions': json({ detail: 'x' }, 500) }));
  try {
    assert.equal(lost.attr('button-export-portfolio-overview', 'disabled'), true);
    assert.equal(lost.attr('button-export-portfolio-overview', 'title'), 'Positions could not be read, so there is nothing to export.');
    assert.equal(lost.text('button-export-portfolio-overview-reason'), 'Positions could not be read, so there is nothing to export.');
    await lost.click('button-export-portfolio-overview');
    assert.equal(lost.downloads.files.length, 0);
  } finally { await lost.close(); }

  const empty = await mount(InvestorPortfolioCanvas, '/portfolio', overview({ '/api/positions': json({ items: [] }) }));
  try {
    assert.equal(empty.attr('button-export-portfolio-overview', 'title'), 'No position is recorded, so there is nothing to export.');
  } finally { await empty.close(); }

  const m = await mount(InvestorPortfolioCanvas, '/portfolio', overview());
  try {
    await m.choose('select-portfolio-health', 'Watch');
    assert.equal(m.attr('button-export-portfolio-overview', 'disabled'), true);
    assert.equal(m.attr('button-export-portfolio-overview', 'title'), 'No company matches these filters, so there is nothing to export.');
    await m.choose('select-portfolio-health', 'all');
    m.downloads.state.broken = true;
    await m.click('button-export-portfolio-overview');
    assert.equal(m.downloads.files.length, 0);
    assert.equal(m.attr('button-export-portfolio-overview-failed', 'role'), 'alert');
    assert.equal(m.text('button-export-portfolio-overview-failed'), 'Export failed. Nothing was downloaded.Try again');
    m.downloads.state.broken = false;
    await m.click('button-export-portfolio-overview-retry');
    assert.equal(m.downloads.files.length, 1);
    assert.equal(m.text('button-export-portfolio-overview-failed'), null, 'a written file clears the failure');
  } finally { await m.close(); }
});

/* ---------------------------------------------------------- Performance */

const PERF_POSITIONS = {
  items: [
    { project_id: 1, project: { name: 'Lumen Robotics' }, total_invested: 3500000, vintage: 2025, fmv: 7600000, mark_as_of: '2026-03-31' },
    { project_id: 2, project: { name: 'Kite Systems' }, total_invested: 1250000, vintage: 2026, fmv: 1250000, unmarked: true, mark_unavailable_reason: 'no_mark' },
  ],
};
const PERF_COMPLIANCE = { period: '2026-Q1', as_of: '2026-05-01', period_until: '2026-03-31', companies: [] };
const quarter = (asOf, nav, paidIn, distributed, tvpi, count, unmarked) => ({
  as_of: asOf, basis: 'gross', nav, paid_in: paidIn, distributed, returns: { tvpi: { state: 'ok', value: tvpi } }, position_count: count, unmarked_position_count: unmarked,
});
const QUARTERS = {
  '2025-03-31': quarter('2025-03-31', 0, 0, 0, null, 0, 0),
  '2025-06-30': quarter('2025-06-30', 3500000, 3500000, 0, 1, 1, 1),
  '2025-09-30': quarter('2025-09-30', 6100000, 3500000, 0, 1.74, 1, 0),
  '2025-12-31': null,
  '2026-03-31': quarter('2026-03-31', 8850000, 4750000, 0, 1.86, 2, 1),
};
const performance = (over = {}) => ({ path, query }) => {
  if (path in over) return over[path];
  if (path === '/api/positions') return json(PERF_POSITIONS);
  if (path === '/api/positions/kpi-compliance') return json(PERF_COMPLIANCE);
  if (path === '/api/positions/analytics') {
    const asOf = query.get('as_of');
    if (!asOf) return json({ ...QUARTERS['2026-03-31'], as_of: null });
    return QUARTERS[asOf] ? json(QUARTERS[asOf]) : json({ detail: 'D1_ERROR' }, 500);
  }
  return null;
};

test('4. Performance Export writes the quarter-end series with every gap as Not recorded or Unreadable, and the cohorts', async () => {
  const m = await mount(InvestorPortfolioPerformance, '/portfolio/performance', performance());
  try {
    assert.equal(m.attr('button-export-portfolio-performance', 'aria-expanded'), false);
    await m.click('button-export-portfolio-performance');
    assert.equal(m.attr('button-export-portfolio-performance', 'aria-expanded'), true);
    assert.match(m.text('button-export-portfolio-performance-menu'), /^Quarter-end seriesVintage cohorts$/);
    await m.click('button-export-portfolio-performance-quarters');
    assert.equal(m.text('button-export-portfolio-performance-menu'), null, 'choosing closes the menu');
    assert.match(m.downloads.files[0].name, /^portfolio-performance-quarter-ends-5-rows-\d{4}-\d{2}-\d{2}\.csv$/);
    const lines = csvLines(await m.downloads.text());
    assert.deepEqual(lines, [
      'Quarter-end,Quarter,NAV,Paid-in,Distributed,TVPI,Mark coverage,Note,Basis',
      '2025-03-31,Q1 2025,Not recorded,Not recorded,Not recorded,Not recorded,Not recorded,No position is recorded on or before this date.,Gross of fees and carry',
      '2025-06-30,Q2 2025,"$3,500,000","$3,500,000",$0,1.00×,0 of 1,,Gross of fees and carry',
      '2025-09-30,Q3 2025,"$6,100,000","$3,500,000",$0,1.74×,1 of 1,,Gross of fees and carry',
      '2025-12-31,Q4 2025,Unreadable,Unreadable,Unreadable,Unreadable,Unreadable,This quarter-end could not be read.,Gross of fees and carry',
      '2026-03-31,Q1 2026,"$8,850,000","$4,750,000",$0,1.86×,1 of 2,,Gross of fees and carry',
    ]);

    await m.click('button-export-portfolio-performance');
    await m.click('button-export-portfolio-performance-cohorts');
    assert.match(m.downloads.files[1].name, /^portfolio-performance-cohorts-2-rows-/);
    assert.deepEqual(csvLines(await m.downloads.text()), [
      'Vintage,Companies,Invested,Carrying value,Carried at cost,Carrying ÷ invested,Basis,As of',
      '2025,1,"$3,500,000","$7,600,000",0,2.17×,Gross of fees and carry,Latest recorded marks',
      '2026,1,"$1,250,000","$1,250,000",1,1.00×,Gross of fees and carry,Latest recorded marks',
    ]);
  } finally { await m.close(); }
});

test('5. Performance Export over nothing loaded is disabled with its reason; a refused file says Export failed', async () => {
  const m = await mount(InvestorPortfolioPerformance, '/portfolio/performance', performance({
    '/api/positions': json({ detail: 'x' }, 500),
  }));
  try {
    await m.click('button-export-portfolio-performance');
    assert.equal(m.attr('button-export-portfolio-performance-cohorts', 'disabled'), true);
    assert.equal(m.attr('button-export-portfolio-performance-cohorts', 'title'), 'Positions could not be read, so there is nothing to export.');
    assert.equal(m.attr('button-export-portfolio-performance-quarters', 'disabled'), true, 'no window without the positions');
    assert.match(m.attr('button-export-portfolio-performance-quarters', 'title'), /^The quarter-end series could not be read/);
    assert.equal(m.text('button-export-portfolio-performance-cohorts-reason'), 'Positions could not be read, so there is nothing to export.');
  } finally { await m.close(); }

  const ok = await mount(InvestorPortfolioPerformance, '/portfolio/performance', performance());
  try {
    ok.downloads.state.broken = true;
    await ok.click('button-export-portfolio-performance');
    await ok.click('button-export-portfolio-performance-cohorts');
    assert.equal(ok.text('button-export-portfolio-performance-failed'), 'Export failed. Nothing was downloaded (vintage cohorts).Try again');
    ok.downloads.state.broken = false;
    await ok.click('button-export-portfolio-performance-retry');
    assert.equal(ok.downloads.files.length, 1);
    assert.match(ok.downloads.files[0].name, /cohorts/);
  } finally { await ok.close(); }
});

/* -------------------------------------------------------------- the model */

test('6. the model: filters, options, sort and the export builders never write a gap as 0 or a file over nothing', () => {
  const reads = {
    positions: { state: 'ok', value: POSITIONS }, health: { state: 'ok', value: HEALTH_READ },
    compliance: { state: 'ok', value: COMPLIANCE }, analytics: { state: 'ok', value: ANALYTICS },
  };
  const rows = companyRowsOf(reads);
  assert.deepEqual(filterRows(rows, { sector: NONE }).map((r) => r.key), ['4']);
  assert.deepEqual(filterRows(rows, { stage: 'seed', reporting: 'Not received' }).map((r) => r.key), ['2']);
  assert.deepEqual(filterRows(rows, { reporting: 'Not recorded' }).map((r) => r.key), ['4']);
  assert.deepEqual(sortRows(rows, 'invested').map((r) => r.key), ['1', '2', '3', '4'], 'no invested figure sorts last');
  assert.deepEqual(sortRows(rows, 'multiple').map((r) => r.key), ['1', '2', '3', '4']);
  assert.deepEqual(sortRows(rows, 'health').map((r) => r.key), rows.map((r) => r.key));
  const options = filterOptionsOf(rows);
  assert.deepEqual(options.reporting.map((o) => o.value), ['Not received', 'Received', 'Not recorded']);
  const words = filterWordsOf({ query: ' kit ', sector: 'robotics', stage: 'all', health: 'all', reporting: 'all' }, options);
  assert.deepEqual(words, ['Search: “kit”', 'Sector: Robotics']);
  assert.equal(tableCaptionOf(1, 1, [], 'updated'), '1 of 1 company · sorted by last update, newest first · values gross');

  assert.match(companyExportOf({ ...reads, health: { state: 'loading' } }, rows, rows).reason, /^Health is still loading/);
  assert.match(companyExportOf({ ...reads, analytics: { state: 'unreadable' } }, rows, rows).rows[0].at(-1), /^Unreadable$/);
  assert.equal(quarterExportOf({ state: 'ok', dates: ['2026-03-31'] }, { points: [{ date: '2026-03-31', state: 'loading' }] }).reason,
    'Some quarter-ends are still loading, so there is nothing to export yet.');
  assert.match(quarterExportOf({ state: 'not_recorded', reason: 'No position is recorded in this book.' }, null).reason, /^No quarter-end is recorded/);
  assert.match(cohortExportOf({ state: 'ok', rows: [], undated: 2 }).reason, /no cohort is drawn/);
});

test('7. phone: at 390 the filters are a two-column grid of 44px controls and the Export menu fits the screen', () => {
  const css = readFileSync(new URL('../src/pages/portfolio/portfolio.css', import.meta.url), 'utf8');
  const phone = css.slice(css.indexOf('/* phone: record cards'));
  const block = phone.slice(0, phone.indexOf('\n}\n'));
  assert.match(block, /\.pf-filters\{display:grid;grid-template-columns:repeat\(2,minmax\(0,1fr\)\)\}/);
  assert.match(block, /\.pf-search,\.pf-select select,\.pf-btn,[^{]*\{min-height:44px\}/);
  assert.match(block, /\.pf-export-menu\{[^}]*min-width:min\(280px,calc\(100vw - 32px\)\)/);
  assert.match(block, /\.pf-export-choice\{min-height:44px\}/);
});
