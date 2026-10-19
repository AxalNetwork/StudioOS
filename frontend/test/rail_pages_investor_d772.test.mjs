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
  ['/portfolio/value-add', 'Investor · Portfolio · Value-add'], ['/portfolio/growth', 'Investor · Portfolio · Value-add']];

test('Portfolio: each board\'s route answers its page key for an investor, the legacy Growth route Value-add\'s', () => {
  for (const [route, key] of PORTFOLIO) assert.equal(pageKeyFor(route, 'investor'), key, route);
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
  ['/funds/ledger', 'Investor · Fund · Distributions'], ['/funds/reporting', 'Investor · Fund · Reporting'], ['/lp-reports', 'Investor · Fund · Reporting']];

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
