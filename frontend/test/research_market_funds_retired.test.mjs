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
// UPDATED for documentation/architecture/DECISIONS.md D12. This file guarded D8 (market redirected) and
// D9 (funds withdrawn). D12 then withdrew the four remaining tabs and deleted
// `pages/advisor/research/` outright, so three assertions here were reading
// `AdvisorResearchWorkspace.jsx` — a file that no longer exists.
//
// The assertions that still mean something are kept and now read the files
// that survive; the ones that only described the workspace's internals are
// dropped because the workspace is gone, not because they were inconvenient.
// D12's own guard is `research_tabs_withdrawn.test.mjs`.

test('the Research market tab redirects to a surface the advisor can open', () => {
  const app = read('frontend/src/App.jsx');
  // The destination moved from /market-intel to /signals in `724dfc9f`, and it
  // had to. /market-intel is guarded `labRoles(['admin', 'partner',
  // 'investor'])` — no advisor in the list — so this redirect sent an advisor
  // from an advisor-namespaced URL straight into a guard rejection. /signals
  // names 'advisor' in its own guard. The point of the assertion is unchanged:
  // the tab redirects instead of shipping a second market implementation.
  assert.match(
    app,
    /<Route path="\/advisor\/research\/market" element=\{<Navigate to="\/signals" replace \/>\} \/>/,
    'the market tab should redirect, not render a second market implementation'
  );
  // And the destination has to actually admit an advisor, which is the whole
  // reason the target changed. Pin that, not just the string.
  const signals = app.split('\n').find((l) => l.includes('path="/signals"'));
  assert.match(signals, /'advisor'/, '/signals must admit the role being redirected into it');
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
  //
  // Counted inside SIDEBAR_GROUPS only. The file also lists `/market-intel` in
  // INVESTOR_FULL_BLEED — a layout list, not a nav — and a whole-file count
  // read that as a sixth role linking it.
  const navs = sidebar.slice(0, sidebar.indexOf('export const FOUNDER_FULL_BLEED'));
  assert.equal((navs.match(/'\/market-intel'/g) || []).length, 5,
    'expected all five role navs to link /market-intel');
});

test('the research index lands on a surface that renders', () => {
  const app = read('frontend/src/App.jsx');
  // Was /advisor/research/companies. D12 withdrew that tab, so the index went
  // to the one research surface with a backend. An index pointing at a
  // withdrawn tab is the specific failure this assertion exists to catch —
  // it renders nothing and reads as a broken nav rather than a decision.
  //
  // D12 named /market-intel as that surface, which was right for every role
  // it checked and wrong for the one this URL belongs to: /market-intel does
  // not admit advisors. "Lands on a surface that renders" was therefore false
  // here in exactly the way the test was written to prevent. /signals renders
  // for an advisor, so the assertion now names it. See the market-tab test
  // above for the guard lists.
  assert.match(app, /path="\/advisor\/research" element=\{<Navigate to="\/signals"/);
});
