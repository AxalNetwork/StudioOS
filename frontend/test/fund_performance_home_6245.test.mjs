/**
 * #6245 (owner: C): /funds/performance is an LP's read of the funds they are in and a GP's read of the funds they run.
 *
 * It was an unlinked page passed `embedded`, so it drew no title, crumb, zone row or rail, and its gate (the
 * Institutional tier) refused LPs the Worker serves (GET /api/fund-performance asks only the Investor licence).
 * Now the page gate is the Worker's, the page draws its own Fund chrome, and the Fund landing links to it.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/fund_performance_home_6245.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { FundPerformanceView } from '../src/pages/FundPerformancePage.jsx';
import FundPerformanceShell from '../src/pages/investor/FundPerformanceShell.jsx';

const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
const fund = { id: 10, name: 'Fixture Fund A', vintage_year: 2021, status: 'active', as_of: '2026-11-15', nav_basis: 'Investments only.', nav_cents: 12101, paid_in_cents: 10000, distributed_cents: 1000, rvpi: 1.2, tvpi: 1.3, dpi: 0.1, irr: 0.15, unavailable: {} };
const page = ({ state = { items: [fund], loading: false, error: null }, ...props }) => renderToStaticMarkup(React.createElement(MemoryRouter, { initialEntries: ['/funds/performance'] },
  React.createElement(FundPerformanceShell, { state, ...props }, React.createElement(FundPerformanceView, state))));

test('the page has an h1, the Fund crumb and the rail', () => {
  const html = page({ fundUnlocked: true });
  assert.match(html, /<h1>[\s\S]*?Fund performance<\/h1>/);
  assert.match(html, /class="i6-breadcrumb">Fund <span>‹<\/span> <b>Performance<\/b>/);
  assert.match(html, /i6-rail/, 'the Fund rail is drawn');
  assert.match(html, /Fixture Fund A/);
});

test('an Institutional reader gets the Fund zone row; an LP without the tier does not', () => {
  assert.match(page({ fundUnlocked: true }), /href="\/funds\/lps"/);
  const lp = page({ fundUnlocked: false });
  assert.doesNotMatch(lp, /href="\/funds\/lps"|href="\/funds\/calls"/, 'GP zones would only show an LP the locked notice');
  assert.match(lp, /Fixture Fund A/, 'and the LP still reads their fund');
});

test('a locked visitor sees the locked notice, never an empty list', () => {
  const html = page({ locked: true, state: { items: [], loading: false, error: null } });
  // D6233 (#6233): the one locked Fund surface, asking the Investor licence (no tier).
  assert.match(html, /data-testid="investor-fund-locked" data-zone="performance" data-need="licence"/);
  assert.doesNotMatch(html, /no funds are available|No funds match/);
  assert.doesNotMatch(html, /Refresh fund performance/);
});

test('the page gate is the Worker gate: the Investor licence, no tier; an admin outside investor view still forwards', () => {
  const app = read('frontend/src/App.jsx');
  const route = app.slice(app.indexOf('<Route path="/funds/performance"'), app.indexOf('/>\n', app.indexOf('<Route path="/funds/performance"')));
  assert.match(route, /holds\('investor'\) \? <FundPerformancePage fundUnlocked=\{hasInvestorTier\(user, 'institutional'\)\} \/>/);
  assert.match(route, /effectiveRole !== 'admin' \? <FundPerformancePage locked \/> : <FundOpsRedirect \/>/);
  assert.doesNotMatch(route, /investorFundWorkspace|embedded/, 'the tier gate and the bare body are gone');
  const worker = read('cloudflare-worker/src/routes/fund_performance.ts');
  // #6246 (D6246): the Worker also lets the GP of record read their own funds; it still asks no tier of an LP.
  assert.match(worker, /if \(user\.role !== 'admin' && !holdsLicence\(user, 'investor'\) && !funds\.length\) return notFound\(\);/, 'the Worker asks the licence, not the tier');
});

test('the Fund landing links to the page, and the rail row stays one alias', () => {
  assert.match(read('frontend/src/pages/FundPerformancePage.jsx'), /<FundPerformanceShell fundUnlocked=\{fundUnlocked\} locked=\{locked\}[\s\S]*?<FundPerformanceView/, 'the page draws its figures inside the shell');
  assert.match(read('frontend/src/pages/investor/InvestorFundLanding.jsx'), /<Link to="\/funds\/performance" className="i6-perf-link" data-testid="link-fund-performance">/);
  const rows = read('frontend/src/lib/railPages.js').match(/'\/funds\/performance'/g) || [];
  assert.equal(rows.length, 1);
});
