import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(process.cwd());
const read = (p) => readFileSync(resolve(root, p), 'utf8');

// Mirrors the repo's existing deletion guards (founder_portal_removed,
// spinouts_page_removed, studio_ops_removed): a removal that a later change
// could silently undo gets a test asserting it stays removed.

test('the Research market tab redirects to /market-intel rather than duplicating it', () => {
  const app = read('frontend/src/App.jsx');
  assert.match(
    app,
    /<Route path="\/advisor\/research\/market" element=\{<Navigate to="\/market-intel" replace \/>\} \/>/,
    'the market tab should redirect, not render a second market implementation'
  );
  assert.equal(existsSync(resolve(root, 'frontend/src/pages/advisor/research/MarketPage.jsx')), false);
});

test('the Funds research tab is withdrawn everywhere', () => {
  const app = read('frontend/src/App.jsx');
  const sidebar = read('frontend/src/sidebarConfig.js');
  const workspace = read('frontend/src/pages/advisor/research/AdvisorResearchWorkspace.jsx');

  assert.doesNotMatch(app, /path="\/advisor\/research\/funds"/);
  assert.doesNotMatch(sidebar, /'\/advisor\/research\/funds'/);
  assert.doesNotMatch(workspace, /FundsResearchPage/);
  assert.equal(existsSync(resolve(root, 'frontend/src/pages/advisor/research/FundsResearchPage.jsx')), false);
});

test('no nav still points at the retired research/market URL', () => {
  const sidebar = read('frontend/src/sidebarConfig.js');
  const workspace = read('frontend/src/pages/advisor/research/AdvisorResearchWorkspace.jsx');
  assert.doesNotMatch(sidebar, /'\/advisor\/research\/market'/);
  assert.doesNotMatch(workspace, /'\/advisor\/research\/market'/);
  // Every role that had the tab keeps a route to the real page.
  assert.equal((sidebar.match(/'\/market-intel'/g) || []).length, 5,
    'expected all five role navs to link /market-intel');
});

test('the research index lands on a tab that renders', () => {
  const app = read('frontend/src/App.jsx');
  const workspace = read('frontend/src/pages/advisor/research/AdvisorResearchWorkspace.jsx');
  // Index used to redirect to /market, which no longer renders anything here.
  assert.match(app, /path="\/advisor\/research" element=\{<Navigate to="\/advisor\/research\/companies"/);
  // And the tab-derivation fallback must agree with that target, or an
  // unrecognised subpath renders an empty workspace.
  assert.match(workspace, /:\s*'companies';/);
  for (const dead of ["'market'", "'funds'"]) {
    assert.doesNotMatch(workspace, new RegExp(`active === ${dead}`),
      `workspace still branches on a tab that no longer exists: ${dead}`);
  }
});
