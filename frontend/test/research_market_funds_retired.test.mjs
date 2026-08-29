import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(process.cwd());
const read = (p) => readFileSync(resolve(root, p), 'utf8');

// Mirrors the repo's existing deletion guards (founder_portal_removed,
// spinouts_page_removed, studio_ops_removed): a removal that a later change
// could silently undo gets a test asserting it stays removed.
//
// UPDATED for DECISIONS.md D12. This file guarded D8 (market redirected) and
// D9 (funds withdrawn). D12 then withdrew the four remaining tabs and deleted
// `pages/advisor/research/` outright, so three assertions here were reading
// `AdvisorResearchWorkspace.jsx` — a file that no longer exists.
//
// The assertions that still mean something are kept and now read the files
// that survive; the ones that only described the workspace's internals are
// dropped because the workspace is gone, not because they were inconvenient.
// D12's own guard is `research_tabs_withdrawn.test.mjs`.

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

  assert.doesNotMatch(app, /path="\/advisor\/research\/funds"/);
  assert.doesNotMatch(sidebar, /'\/advisor\/research\/funds'/);
  assert.equal(existsSync(resolve(root, 'frontend/src/pages/advisor/research/FundsResearchPage.jsx')), false);
});

test('no nav still points at the retired research/market URL', () => {
  const sidebar = read('frontend/src/sidebarConfig.js');
  assert.doesNotMatch(sidebar, /'\/advisor\/research\/market'/);
  // Every role that had the tab keeps a route to the real page. D12 removed
  // twenty fixture rows and admin's emptied Research group, but deliberately
  // left all five of these standing — a role losing its one live research
  // surface would be a regression hiding inside a withdrawal.
  assert.equal((sidebar.match(/'\/market-intel'/g) || []).length, 5,
    'expected all five role navs to link /market-intel');
});

test('the research index lands on a surface that renders', () => {
  const app = read('frontend/src/App.jsx');
  // Was /advisor/research/companies. D12 withdrew that tab, so the index now
  // goes to the one research surface with a backend. An index pointing at a
  // withdrawn tab is the specific failure this assertion exists to catch —
  // it renders nothing and reads as a broken nav rather than a decision.
  assert.match(app, /path="\/advisor\/research" element=\{<Navigate to="\/market-intel"/);
});
