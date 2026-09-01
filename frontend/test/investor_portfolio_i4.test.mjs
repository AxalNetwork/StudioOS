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
  assert.match(workspace, /<InvestorPortfolioCanvas active=\{active\} \/>/);
  assert.match(shell, /key === 'portfolio' && children\) return children/);
});

test('I4 renders the requested portfolio decision surfaces', () => {
  assert.match(portfolio, /Know how my investments are doing/);
  for (const metric of ['TVPI · gross', 'MOIC · gross', 'DPI', 'RVPI']) {
    assert.match(portfolio, new RegExp(metric.replace('·', '\\·')));
  }
  for (const section of ['Positions', 'Updates &amp; KPI collection', 'Value-add desk', 'Worker AI · Portfolio']) {
    assert.match(portfolio, new RegExp(section));
  }
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
    assert.match(portfolio, new RegExp(`api\\.${call}`));
  }
  // The doors the canvas must keep open to the detailed tools. The third one
  // is /portfolio/value-add, not /portfolio/growth: `shellConfig.js` declares
  // `{ slug: 'value-add', … legacy: '/portfolio/growth' }`, so value-add is
  // the canonical path and growth is its legacy alias. `724dfc9f` repointed
  // the canvas onto the canonical path — this assertion was still naming the
  // legacy one, which is the alias a canvas should be the LAST thing linking.
  for (const route of ['/portfolio/positions', '/portfolio/updates', '/portfolio/value-add', '/portfolio/performance']) {
    assert.match(portfolio, new RegExp(route.replaceAll('/', '\\/')));
  }
  // The alias still has to resolve, or every link that predates the rename
  // 404s. Read the declaration rather than restating it, so renaming the slug
  // in one place cannot leave this test asserting a path nothing routes.
  const shell = read('frontend/src/workspaces/shellConfig.js');
  const legacy = /\{ slug: 'value-add',[^}]*legacy: '([^']+)' \}/.exec(shell);
  assert.ok(legacy, 'shellConfig no longer declares the value-add legacy path');
  assert.match(app, new RegExp(`path="${legacy[1].replaceAll('/', '\\/')}"`),
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
    assert.doesNotMatch(portfolio, new RegExp(sample, 'i'));
  }
});

test('I4 has responsive and dark-mode layouts', () => {
  assert.match(styles, /\.i4-rail/);
  assert.match(styles, /\.dark \.i4-shell/);
  assert.match(styles, /@media\(max-width:1100px\)/);
  assert.match(styles, /@media\(max-width:600px\)/);
});