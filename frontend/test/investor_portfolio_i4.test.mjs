import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (path) => readFileSync(resolve(process.cwd(), path), 'utf8');
const app = read('frontend/src/App.jsx');
const workspace = read('frontend/src/pages/PortfolioWorkspace.jsx');
const shell = read('frontend/src/pages/investor/InvestorWorkspacePage.jsx');
const portfolio = read('frontend/src/pages/investor/InvestorPortfolioCanvas.jsx');
const styles = read('frontend/src/pages/investor/investorPortfolioCanvas.css');
const frame = read('frontend/src/pages/portfolio/PortfolioFrame.jsx');
const model = read('frontend/src/pages/portfolio/portfolioModel.js');
const frameStyles = read('frontend/src/pages/portfolio/portfolio.css');

test('investor Portfolio uses the I4 landing page for the active role', () => {
  assert.match(app, /<PortfolioWorkspace activeRole=\{effectiveRole\} \/>/);
  assert.match(workspace, /\(activeRole \|\| role\) === 'investor' && active === 'health'/);
  assert.match(workspace, /<InvestorPortfolioCanvas \/>/);
  assert.match(shell, /key === 'portfolio' && children\) return children/);
});

test('I4 renders the requested portfolio decision surfaces', () => {
  // D4817 part 1 (#5311, PF-01): the overview is the Portfolio v2 Overview in
  // the shared frame. Its order is the canvas's decision order: performance,
  // Needs attention, Reporting and Value-add, then the company table.
  // D4817 part 3: the performance summary is the shared `PerformanceSummary`
  // part, which Performance (PF-03) draws too.
  const order = ['<PerformanceSummary ', '<NeedsAttention ', '<ReportingCard ', '<ValueAddCard ', '<CompanyTable '].map((tag) => portfolio.indexOf(tag));
  assert.ok(order.every((at) => at > 0), 'the overview draws all five PF-01 surfaces');
  assert.deepEqual([...order].sort((a, b) => a - b), order, 'in the canvas order');
  assert.match(portfolio, /<PortfolioFrame\b/, 'inside the shared Portfolio frame');
  // Every needle below is a LITERAL, so it is checked with `includes` rather
  // than compiled into a pattern. Constructing a regex out of file content and
  // hand-escaping it is the shape CodeQL and Semgrep both flag, and both are
  // right about it even where the input is a local array: `.replace('·', …)`
  // escapes a character that was never a metacharacter while leaving the ones
  // that are — `$` in '$4.2k', `.` in '1.84x' — live. `includes` has no
  // metacharacters at all, so it is exact as well as quiet. Same reasoning as
  // the line scanner in apex_route_coverage.test.mjs.
  for (const metric of ["'TVPI'", "'DPI'", "'RVPI'", "'IRR'", "'Net asset value'"]) {
    assert.ok(model.includes(metric), `the overview does not show ${metric}`);
  }
  for (const section of ['Needs attention', 'Portfolio companies', 'Reporting', 'Value-add']) {
    assert.ok(portfolio.includes(section), `the overview is missing the ${section} section`);
  }
  // The rail is no longer written here. "Worker AI · Portfolio" used to be a
  // literal in this file, one of twelve bespoke investor rails that agreed on
  // their shape by coincidence and none of which read the spend endpoint. It
  // is now the shared component, which composes that heading from `workspace`
  // — so what this asserts is the mount, and `ui/WorkerRail.jsx` owns the
  // heading for every licence.
  assert.match(portfolio, /<WorkerRail[\s\S]*?workspace="Portfolio"[\s\S]*?role="investor"/,
    'the canvas must mount the shared Worker AI rail');
});

test('I4 is wired to real portfolio sources and preserves detailed tools', () => {
  for (const call of [
    'positionsList',
    'positionsAnalytics',
    'portfolioHealthList',
    'portfolioUpdatesLatest',
    'portfolioSupportList',
    'positionsKpiCompliance',
  ]) {
    assert.ok(portfolio.includes(`api.${call}`), `the canvas never calls api.${call}`);
  }
  // The doors the canvas must keep open to the detailed tools. The third one
  // is /portfolio/value-add, not /portfolio/growth: `shellConfig.js` declares
  // `{ slug: 'value-add', … legacy: '/portfolio/growth' }`, so value-add is
  // the canonical path and growth is its legacy alias. `724dfc9f` repointed
  // the canvas onto the canonical path — this assertion was still naming the
  // legacy one, which is the alias a canvas should be the LAST thing linking.
  // /portfolio/performance is not a zone of the Portfolio bucket, so the
  // canvas has to carry its own door to it — and does, from the rail.
  assert.ok(portfolio.includes('/portfolio/performance'),
    'the canvas keeps no door to /portfolio/performance');
  // The other three ARE zones. They used to be a hand-rolled `i4-tabs` row
  // whose "Positions" pill linked /portfolio/health — the page it was already
  // on — so the positions book was reachable only from a "View dilution" link
  // further down. They now come from ZoneNav, which composes every target from
  // shellConfig; asserting the literals again would re-pin the copy that
  // drifted. What matters is that the row is the real one.
  // D4817 part 1: the zone row is the Portfolio frame's, shared by every board.
  assert.match(frame, /<ZoneNav bucket=\{bucketForPath\('investor', '\/portfolio'\)\}/,
    'the frame must take its zone row from the shell config, not hand-roll it');
  assert.ok(portfolio.includes('/portfolio/positions'),
    'the canvas keeps no door to the positions book');
  // The /portfolio/growth alias is retired (#2297): value-add declares no
  // legacy path and nothing routes the old address. The zone itself still
  // routes, so the canvas's door to it resolves.
  const shell = read('frontend/src/workspaces/shellConfig.js');
  assert.match(shell, /\{ slug: 'value-add', label: 'Value-add', archetype: A\.FEED \}/);
  assert.ok(!app.includes('path="/portfolio/growth"'), '/portfolio/growth is routed again');
  assert.ok(app.includes('path="/portfolio/value-add"'), 'nothing routes /portfolio/value-add');
  assert.match(portfolio, /Missing values stay blank rather than being estimated/);
  assert.match(portfolio, /At cost/);
  // D4817 part 3: the summary moved to the shared parts; its coverage line is the model's.
  assert.match(portfolio, /<PerformanceSummary perf=\{perf\}/);
  assert.match(model, /% mark coverage\)/);
  assert.doesNotMatch(portfolio, /portfolioHealthRecomputeAll/);
});

test('I4 does not leak canvas sample data', () => {
  for (const sample of [
    'Novacraft',
    'Ledgerlane',
    'Mediary',
    'Northstar',
    '1.84x',
    '$4.2k',
    'Qwen',
    'Llama',
  ]) {
    assert.ok(!portfolio.toLowerCase().includes(sample.toLowerCase()),
      `the canvas still carries the sample value ${sample}`);
  }
});

test('I4 has responsive and dark-mode layouts', () => {
  // The Portfolio frame's own sheet: tokens redefined in dark mode, tablet and phone widths.
  assert.match(frameStyles, /\.dark \.pf-shell\{/);
  assert.match(frameStyles, /@media\(max-width:1100px\)/);
  assert.match(frameStyles, /@media\(max-width:600px\)/);
  // The zone pages still draw on the I4 sheet.
  assert.match(styles, /\.i4-rail/);
  assert.match(styles, /\.dark \.i4-shell/);
  assert.match(styles, /@media\(max-width:1100px\)/);
  assert.match(styles, /@media\(max-width:600px\)/);
});
