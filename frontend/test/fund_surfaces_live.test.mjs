import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(process.cwd());
const read = (p) => readFileSync(resolve(root, p), 'utf8');

// The comment scanner from ui_assist_rail_and_sidebar.test.mjs: a regex
// stripper reads the `/*` inside a route path as a block-comment opener and
// eats the rest of the file, which silently turns these assertions into
// "no match found, therefore clean".
function scan(src) {
  let out = '';
  for (let i = 0; i < src.length; ) {
    const c = src[i], d = src[i + 1];
    if (c === '/' && d === '/') { while (i < src.length && src[i] !== '\n') i++; continue; }
    if (c === '/' && d === '*') { i += 2; while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) i++; i += 2; continue; }
    if (c === '"' || c === "'" || c === '`') {
      const q = c; out += c;
      for (i++; i < src.length; ) {
        if (src[i] === '\\') { out += src.slice(i, i + 2); i += 2; continue; }
        out += src[i];
        const end = src[i] === q; i++;
        if (end) break;
      }
      continue;
    }
    out += c; i++;
  }
  return out;
}

const FUND_PAGES = ['frontend/src/pages/FundPerformancePage.jsx', 'frontend/src/pages/FundAccountingPage.jsx'];
// Portfolio Growth is guarded for the fixture rules but not the fund-metric
// ones: it reports introductions, which have no multiples or ratios.
const PORTFOLIO_PAGES = ['frontend/src/pages/PortfolioGrowthPage.jsx'];

// --- the fixture is gone, and cannot come back ---------------------------

test('the fabricated fund fixture is deleted', () => {
  // data/fundAnalytics.js shipped four funds that do not exist, with invented
  // NAV, IRR, TVPI, RVPI and DPI, under copy calling them "LP-ready returns".
  assert.equal(existsSync(resolve(root, 'frontend/src/data/fundAnalytics.js')), false);
});

test('the fabricated portfolio fixture is deleted', () => {
  // data/portfolioAnalytics.js invented growth initiatives and industry
  // benchmarks for named portfolio companies. Neither has a table behind it.
  assert.equal(existsSync(resolve(root, 'frontend/src/data/portfolioAnalytics.js')), false);
});

test('Portfolio Growth reads the previously unserved introductions endpoint', () => {
  // GET /api/introductions/ was live with zero consumers anywhere in the app
  // — a working endpoint sitting next to a mock of itself.
  const src = scan(read(PORTFOLIO_PAGES[0]));
  assert.doesNotMatch(src, /from\s+'\.\.\/data\//, 'must read from an API, not from src/data');
  assert.match(src, /api\.listIntroductions\(/);
  assert.match(src, /api\.introductionsQuota\(/);
  // The withdrawn sections must not creep back without a table to stand on.
  assert.doesNotMatch(src, /GROWTH_INITIATIVES|GROWTH_BENCHMARKS|industryMedian/);
});

test('no fund surface imports a static data fixture', () => {
  for (const p of FUND_PAGES) {
    const src = scan(read(p));
    assert.doesNotMatch(src, /from\s+'\.\.\/data\//, `${p} must read from an API, not from src/data`);
    assert.match(src, /from\s+'\.\.\/lib\/fundAnalytics'/, `${p} must use the live analytics client`);
  }
});

// --- what the pages may not assert --------------------------------------

test('no fiduciary figure is hardcoded into a fund or portfolio page', () => {
  // A literal multiple or percentage in this file is, by construction, not a
  // number that came from D1. Cash amounts are formatted from cents, so any
  // bare 2.77x / 28.1% here would be a fabricated one.
  for (const p of [...FUND_PAGES, ...PORTFOLIO_PAGES]) {
    const src = scan(read(p));
    assert.doesNotMatch(src, /\d+\.\d+x/, `${p} hardcodes a multiple`);
    assert.doesNotMatch(src, /\b\d{1,3}\.\d%/, `${p} hardcodes a percentage`);
  }
});

test('a metric with no source is named, never blanked or zeroed', () => {
  const lib = scan(read('frontend/src/lib/fundAnalytics.js'));
  assert.match(lib, /Not recorded/, 'the absence has to be said out loud');
  // An em-dash or a 0 in place of a null reads as a measured result.
  for (const fn of ['fmtMultiple', 'fmtRate']) {
    const body = lib.slice(lib.indexOf(`export function ${fn}`));
    assert.match(body.slice(0, 220), /return null/, `${fn} must return null, not a placeholder glyph`);
  }
  for (const p of FUND_PAGES) {
    assert.match(scan(read(p)), /<Unrecorded/, `${p} must render the refusal explicitly`);
  }
});

test('every refusal carries the reason the server gave', () => {
  // "Not recorded" with no explanation sends the GP to support. The server
  // ships an `unavailable` map; the pages must actually thread it through.
  for (const p of FUND_PAGES) {
    assert.match(scan(read(p)), /reason=\{unavailable\./, `${p} must pass the server's reason`);
  }
});

// --- money ---------------------------------------------------------------

test('fund money crosses the wire as integer cents', () => {
  const lib = scan(read('frontend/src/lib/fundAnalytics.js'));
  assert.match(lib, /fmtCents/);
  // Divide by 100 for display is fine; parseFloat on a money field is not.
  for (const p of [...FUND_PAGES, ...PORTFOLIO_PAGES, 'frontend/src/lib/fundAnalytics.js']) {
    assert.doesNotMatch(scan(read(p)), /parseFloat\s*\(/, `${p} must not float-parse money`);
  }
});

// --- the pages stay reachable -------------------------------------------

test('both pages are still mounted as FundOpsWorkspace tabs', () => {
  const ws = scan(read('frontend/src/pages/FundOpsWorkspace.jsx'));
  assert.match(ws, /<FundPerformancePage embedded/);
  assert.match(ws, /<FundAccountingPage embedded/);
  const app = scan(read('frontend/src/App.jsx'));
  assert.match(app, /path="\/funds\/performance"/);
  assert.match(app, /path="\/funds\/accounting"/);
  // Portfolio Growth stays a tab; withdrawing two sections is not withdrawing
  // the surface, and the nav row must not point at a hole.
  assert.match(scan(read('frontend/src/pages/PortfolioWorkspace.jsx')), /<PortfolioGrowthPage embedded/);
  assert.match(scan(read('frontend/src/sidebarConfig.js')), /'\/portfolio\/growth'/);
});
