/**
 * D772 (#2098), one section per PR — each investor board reaches its page key
 * from D768's map, draws one rail, and names each option of
 * `lib/railOptions/investor.js` while the member has it open. Providers are
 * mounted in-process; nothing reaches the Worker.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/rail_pages_investor_d772.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import { pageKeyFor } from '../src/lib/railPages.js';
import { INVESTOR_RAIL_OPTIONS } from '../src/lib/railOptions/investor.js';
import { controlOf, railOptionFor } from '../src/lib/railOptions/index.js';
import { RailPageProvider, useRailPage } from '../src/ui/railCrumbs.js';
import { api } from '../src/lib/api.js';
import ZoneDraft from '../src/workspaces/ZoneDraft.jsx';

const h = React.createElement;
const read = (f) => readFileSync(`frontend/src/${f}`, 'utf8');
const rowsOf = (section) => INVESTOR_RAIL_OPTIONS.filter((o) => o.page === `Investor · ${section}` || o.page.startsWith(`Investor · ${section} · `));

/** Each draft row's band in its file carries the row's key as `railOption`, beside the row's surface. */
function assertBandsNamed(rows) {
  for (const o of rows.filter((r) => r.handler === 'draft')) {
    // Each `<ZoneDraft … />` opening tag, found by plain string search (no regex is built from data).
    const src = read(o.source.file);
    const bands = src.split('<ZoneDraft').slice(1).map((rest) => rest.slice(0, rest.indexOf('>')));
    const band = bands.find((b) => b.includes(o.source.match));
    assert.ok(band, `${o.page}: no band ${o.source.match}`);
    assert.ok(band.includes(`railOption="${o.key}"`), `${o.page}: the band does not name ${o.key}`);
  }
}

// ------------------------------------------------------------------ Deals (I1–I5)

const DEALS = [['/deals', 'Investor · Deals'], ['/deals/pipeline', 'Investor · Deals · Pipeline'], ['/deals/screening', 'Investor · Deals · Screening'],
  ['/deals/commit', 'Investor · Deals · Commit'], ['/deals/closing', 'Investor · Deals · Closing']];

test('Deals: each board\'s route answers its page key for an investor', () => {
  for (const [route, key] of DEALS) assert.equal(pageKeyFor(route, 'investor'), key, route);
  for (const o of rowsOf('Deals')) assert.ok(DEALS.some(([, k]) => k === o.page), `${o.page} is a Deals board`);
});

test('Deals: the five boards draw exactly one rail, the routes\' shell\'s', () => {
  const routes = read('workspaces/investor/InvestorDealsRoutes.jsx');
  assert.equal((routes.match(/<WorkerRail\b/g) || []).length, 1);
  assert.match(routes, /<WorkspaceShell\b[\s\S]*?rail=\{\(\s*<WorkerRail\b/);
  for (const f of ['PipelineZone', 'ScreeningZone', 'CommitZone', 'ClosingZone']) {
    assert.doesNotMatch(read(`pages/investor/deals/${f}.jsx`), /<WorkerRail\b|<RailFrame\b/, `${f} draws a second rail`);
  }
});

test('Deals: every option of the section names itself on its band', () => {
  const rows = rowsOf('Deals');
  assert.deepEqual(rows.map((o) => o.key), ['draft:stale-deal-notes', 'draft:screening-memo', 'draft:ic-memo', 'draft:closing-cover-note']);
  assertBandsNamed(rows);
});

// ------------------------------------------------------------------ Portfolio (I6–I10)

const PORTFOLIO = [['/portfolio', 'Investor · Portfolio'], ['/portfolio/health', 'Investor · Portfolio'], ['/portfolio/positions', 'Investor · Portfolio · Positions'],
  ['/portfolio/performance', 'Investor · Portfolio · Performance'], ['/portfolio/updates', 'Investor · Portfolio · Updates'],
  ['/portfolio/value-add', 'Investor · Portfolio · Value-add']];

test('Portfolio: each board\'s route answers its page key for an investor; the retired Growth address is none of them', () => {
  for (const [route, key] of PORTFOLIO) assert.equal(pageKeyFor(route, 'investor'), key, route);
  // #2297 retired /portfolio/growth: no route, no legacy alias, so no page key of its own.
  assert.notEqual(pageKeyFor('/portfolio/growth', 'investor'), 'Investor · Portfolio · Value-add');
  for (const o of rowsOf('Portfolio')) assert.ok(PORTFOLIO.some(([, k]) => k === o.page), `${o.page} is a Portfolio board`);
});

test('Portfolio: each board draws exactly one rail of its own', () => {
  for (const f of ['pages/investor/InvestorPortfolioCanvas.jsx', 'pages/investor/InvestorPortfolioPositions.jsx', 'pages/investor/InvestorPortfolioUpdates.jsx',
    'pages/investor/InvestorPortfolioValueAdd.jsx', 'pages/PortfolioWorkspace.jsx']) {
    assert.equal((read(f).match(/<WorkerRail\b/g) || []).length, 1, f);
  }
  // Performance's one rail is PortfolioWorkspace's frame (PR 1); its page draws none of its own.
  assert.doesNotMatch(read('pages/PortfolioPerformancePage.jsx'), /<WorkerRail\b|<RailFrame\b/);
});

test('Portfolio: every option of the section names itself on its band', () => {
  const rows = rowsOf('Portfolio');
  assert.deepEqual(rows.map((o) => o.key), ['draft:multiple-narrative', 'draft:updates-read', 'draft:support-summary']);
  assertBandsNamed(rows);
});

// ------------------------------------------------------------------ Fund (I12–I17)

const FUND = [['/funds', 'Investor · Fund'], ['/funds/lps', 'Investor · Fund · LPs'], ['/funds/calls', 'Investor · Fund · Capital calls'],
  ['/funds/ledger', 'Investor · Fund · Distributions'], ['/funds/reporting', 'Investor · Fund · Reporting']];
// ['/lp-reports', …] stood here: the owner removed LP Reporting (2026-10-20).

test('Fund: each board\'s route answers its page key; Overview is Fund\'s alias and Distributions the ledger\'s', () => {
  for (const [route, key] of FUND) assert.equal(pageKeyFor(route, 'investor'), key, route);
  for (const o of rowsOf('Fund')) assert.ok(FUND.some(([, k]) => k === o.page), `${o.page} is a Fund board with a route`);
});

test('Fund: each board draws exactly one rail of its own', () => {
  for (const f of ['InvestorFundLanding', 'InvestorFundLPs', 'InvestorFundCalls', 'InvestorFundAccounting', 'InvestorFundReporting']) {
    assert.equal((read(`pages/investor/${f}.jsx`).match(/<WorkerRail\b/g) || []).length, 1, f);
  }
  assert.doesNotMatch(read('pages/investor/FundLedgerPanel.jsx'), /<WorkerRail\b|<RailFrame\b/, 'the ledger panel sits inside Accounting\'s rail');
});

test('Fund: every option of the section names itself on its band', () => {
  const rows = rowsOf('Fund');
  assert.deepEqual(rows.map((o) => o.key), ['draft:lp-reminder']);
  assertBandsNamed(rows);
});

// ------------------------------------------------------------------ Research (I22–I27)

const RESEARCH = [['/research', 'Investor · Research'], ['/research/ask', 'Investor · Research · Ask'], ['/research/diligence', 'Investor · Research · Diligence'],
  ['/research/diligence/g1', 'Investor · Research · Diligence'], ['/research/diligence/g1/files/f1', 'Investor · Research · Diligence'],
  ['/research/benchmarking', 'Investor · Research · Benchmarking'], ['/research/benchmarking/b1', 'Investor · Research · Benchmarking'],
  ['/research/markets', 'Investor · Research · Markets'], ['/research/geographies', 'Investor · Research · Markets'],
  ['/research/library', 'Investor · Research · Library']];
/** The zones three profiles' Research boards share; each names its options through `railOptionFor`. */
const SHARED = ['pages/research/AskZone.jsx', 'pages/research/LibraryZone.jsx', 'pages/research/DiligenceRoom.jsx'];
const code = (f) => read(f).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

test('Research: each board\'s route and record view answers its page key for an investor', () => {
  for (const [route, key] of RESEARCH) assert.equal(pageKeyFor(route, 'investor'), key, route);
  for (const o of rowsOf('Research')) assert.ok(RESEARCH.some(([, k]) => k === o.page), `${o.page} is a Research board`);
});

test('Research: the landing and the zones\' shell draw one rail each, the zones none, and each record view its own', () => {
  for (const f of ['pages/investor/InvestorResearchWorkspace.jsx', 'workspaces/ResearchWorkspace.jsx',
    'pages/research/DiligenceRoom.jsx', 'pages/research/DiligenceFile.jsx', 'pages/research/BenchmarkDetail.jsx', 'pages/research/MarketReading.jsx']) {
    assert.equal((read(f).match(/<WorkerRail\b/g) || []).length, 1, f);
  }
  for (const f of ['AskZone', 'DiligenceZone', 'BenchmarkingZone', 'MarketDirectoryZone', 'LibraryZone']) {
    assert.doesNotMatch(read(`pages/research/${f}.jsx`), /<WorkerRail\b|<RailFrame\b/, `${f} draws a second rail`);
  }
});

test('Research: every option is named where it lives, a shared zone\'s through railOptionFor', () => {
  const rows = rowsOf('Research');
  assert.deepEqual(rows.map((o) => o.key), ['ask:evidence', 'ask:question', 'draft:session-brief', 'draft:thin-evidence', 'upload:document', 'reindex:document', 'draft:index-gaps']);
  for (const o of rows) {
    const src = code(o.source.file);
    if (!SHARED.includes(o.source.file)) {
      assert.ok(src.includes(`useRailOption(`) && src.includes(`'${o.key}'`), `${o.page}: ${o.key} is not named`);
      continue;
    }
    const control = controlOf(o.source.match);
    assert.deepEqual(railOptionFor(o.page, { file: o.source.file, control }), { key: o.key, label: o.label }, `${o.page}: ${o.key}`);
    // A band passes the lookup as its `railOption`; any other control names the looked-up row while it runs.
    const lookup = `railOptionFor(railPage, { file: ZONE_FILE, control: '${control}' })`;
    if (control.includes('/')) {
      assert.ok(src.includes(`railOption={${lookup}?.key}`), `${o.source.file}: the ${control} band does not name its row`);
    } else {
      const name = src.split(`= ${lookup};`)[0].match(/const (\w+) $/)?.[1];
      assert.ok(name, `${o.source.file} does not look up ${control}`);
      assert.match(src, new RegExp(`useRailOption\\([^;]*\\? ${name}\\?\\.key : null, ${name}\\?\\.label\\);`), `${o.source.file}: ${control} is never named`);
    }
  }
  // Each shared zone names itself by its own path, which is what the inventories list.
  for (const f of SHARED) {
    const src = code(f);
    assert.ok(src.includes(`const ZONE_FILE = '${f}';`), `${f} does not pass its own path`);
    assert.doesNotMatch(src, /railOption="|useRailOption\(\s*[^,]*\?\s*'[a-z]+:/, `${f} still names a literal key`);
  }
});

test('Research: a shared zone\'s control resolves to each profile\'s own key, and to nothing it does not list', () => {
  const at = (profile, module, file, control) => railOptionFor(`${profile} · Research · ${module}`, { file: `pages/research/${file}.jsx`, control })?.key ?? null;
  const table = [
    ['ask', 'Ask', 'AskZone', ['ask:library', 'ask:question', 'ask:library', 'ask:library']],
    ['research/ask', 'Ask', 'AskZone', ['draft:research/ask', 'draft:session-brief', 'draft:session-brief', 'draft:session-brief']],
    ['upload', 'Library', 'LibraryZone', ['upload:document', 'upload:document', 'upload:document', 'upload:document']],
    ['reindex', 'Library', 'LibraryZone', ['upload:reindex', 'reindex:document', 'reindex:document', 'reindex:document']],
    ['research/library', 'Library', 'LibraryZone', ['draft:research/library', 'draft:index-gaps', 'draft:index-gaps', 'draft:index-gaps']],
    ['research/diligence', 'Diligence', 'DiligenceRoom', [null, 'draft:thin-evidence', null, null]],
  ];
  for (const [control, module, file, keys] of table) {
    assert.deepEqual(['Founder', 'Investor', 'Advisor', 'Operating Partner'].map((p) => at(p, module, file, control)), keys, control);
  }
  // Another page, another file or no page: nothing, so a band keeps D770's `draft:<surface>`.
  assert.equal(at('Investor', 'Library', 'AskZone', 'ask'), null);
  assert.equal(railOptionFor('Investor · Research', { file: 'pages/research/AskZone.jsx', control: 'ask' }), null);
  assert.equal(railOptionFor(null, { file: 'pages/research/AskZone.jsx', control: 'ask' }), null);
});

test('Research: each record view names its record as the rail\'s last crumb', () => {
  const views = { 'pages/research/DiligenceRoom.jsx': 'diligence-room', 'pages/research/DiligenceFile.jsx': 'diligence-file',
    'pages/research/BenchmarkDetail.jsx': 'benchmark', 'pages/research/MarketReading.jsx': 'market-reading' };
  for (const [f, type] of Object.entries(views)) {
    assert.match(code(f), new RegExp(`useRecordCrumb\\([^;]*'${type}'`), `${f} names no ${type}`);
  }
});

// ------------------------------------------------------------------ the band names its inventory key while it is open

function Probe({ seen }) {
  const page = useRailPage();
  seen.push({ page: page?.page ?? null, option: page?.option ?? null });
  return null;
}

// D770 (#2095) decides when a band is open (a run in flight, or a draft shown) and its label;
// `railOption` only replaces the registry's `draft:<surface>` with the profile's key.
test('a band names its railOption while a draft runs or is shown, and the registry key without one', async () => {
  const saved = { ...api.research };
  let stored = [];
  let release;
  api.research.zoneDrafts = async () => ({ items: stored });
  api.research.zoneDraftRun = () => new Promise((r) => { release = () => { stored = [{ uid: 'd1', body: 'Memo', accepted: false }]; r({ item: stored[0] }); }; });
  const restore = installDocument();
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  const seen = [];
  const settle = () => act(async () => { for (let i = 0; i < 5; i += 1) await new Promise((r) => setTimeout(r, 0)); });
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const props = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const button = (text) => walk(container).find((n) => n.tagName?.toLowerCase() === 'button' && (n.textContent || '').includes(text));
  const tree = (railOption) => h(MemoryRouter, { initialEntries: ['/deals/screening'] },
    h(RailPageProvider, { role: 'investor' }, h(ZoneDraft, { surface: 'deals/screening', label: 'Draft · screening memo', run: 'Draft the memo', railOption }), h(Probe, { seen })));
  const named = { key: 'draft:screening-memo', label: 'Draft · screening memo' };
  try {
    await act(async () => { root.render(tree('draft:screening-memo')); });
    await settle();
    assert.equal(seen.at(-1).page, 'Investor · Deals · Screening');
    assert.equal(seen.at(-1).option, null, 'a closed band names nothing');
    await act(async () => { props(button('Draft the memo')).onClick(); });
    await settle();
    assert.deepEqual(seen.at(-1).option, named, 'running');
    await act(async () => { release(); });
    await settle();
    assert.deepEqual(seen.at(-1).option, named, 'its draft shown');
    // Without railOption, the same band names the registry's key (D770).
    await act(async () => { root.render(tree(null)); });
    await settle();
    assert.deepEqual(seen.at(-1).option, { key: 'draft:deals/screening', label: 'Draft · screening memo' });
  } finally {
    await act(async () => root.unmount());
    restore();
    Object.assign(api.research, saved);
  }
});
