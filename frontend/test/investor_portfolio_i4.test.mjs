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

test('investor Portfolio uses the I4 landing page for the active role', () => {
  assert.match(app, /<PortfolioWorkspace activeRole=\{effectiveRole\} \/>/);
  assert.match(workspace, /\(activeRole \|\| role\) === 'investor' && active === 'health'/);
  assert.match(workspace, /<InvestorPortfolioCanvas \/>/);
  assert.match(shell, /key === 'portfolio' && children\) return children/);
});

test('I4 renders the requested portfolio decision surfaces', () => {
  assert.match(portfolio, /Know how my investments are doing/);
  // Every needle below is a LITERAL, so it is checked with `includes` rather
  // than compiled into a pattern. Constructing a regex out of file content and
  // hand-escaping it is the shape CodeQL and Semgrep both flag, and both are
  // right about it even where the input is a local array: `.replace('·', …)`
  // escapes a character that was never a metacharacter while leaving the ones
  // that are — `$` in '$4.2k', `.` in '1.84x' — live. `includes` has no
  // metacharacters at all, so it is exact as well as quiet. Same reasoning as
  // the line scanner in apex_route_coverage.test.mjs.
  for (const metric of ['TVPI · gross', 'MOIC · gross', 'DPI', 'RVPI']) {
    assert.ok(portfolio.includes(metric), `the canvas does not show ${metric}`);
  }
  for (const section of ['Positions', 'Updates &amp; KPI collection', 'Value-add desk']) {
    assert.ok(portfolio.includes(section), `the canvas is missing the ${section} section`);
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
    'portfolioUpdatesList',
    'listIntroductions',
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
  assert.match(portfolio, /<ZoneNav bucket=\{bucketForPath\('investor', '\/portfolio'\)\}/,
    'the canvas must take its zone row from the shell config, not hand-roll it');
  assert.ok(portfolio.includes('/portfolio/positions'),
    'the canvas keeps no door to the positions book');
  // The alias still has to resolve, or every link that predates the rename
  // 404s. Read the declaration rather than restating it, so renaming the slug
  // in one place cannot leave this test asserting a path nothing routes.
  const shell = read('frontend/src/workspaces/shellConfig.js');
  const legacy = /\{ slug: 'value-add',[^}]*legacy: '([^']+)' \}/.exec(shell);
  assert.ok(legacy, 'shellConfig no longer declares the value-add legacy path');
  assert.ok(app.includes(`path="${legacy[1]}"`),
    `${legacy[1]} is declared legacy for value-add but nothing routes it`);
  assert.match(portfolio, /Missing values stay blank rather than being estimated/);
  assert.match(portfolio, /At cost/);
  assert.match(portfolio, /mark coverage/);
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
  assert.match(styles, /\.i4-rail/);
  assert.match(styles, /\.dark \.i4-shell/);
  assert.match(styles, /@media\(max-width:1100px\)/);
  assert.match(styles, /@media\(max-width:600px\)/);
});