import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { SIDEBAR_GROUPS } from '../src/sidebarConfig.js';
import { WORKSPACES } from '../src/lib/adminPlacement.js';

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
  // D392: the destination is now /research/markets, the Research bucket's
  // comparable-readings zone — the object the Advisor Research canvas draws.
  assert.match(
    app,
    /<Route path="\/advisor\/research\/market" element=\{<Navigate to="\/research\/markets" replace \/>\} \/>/,
    'the market tab should redirect, not render a second market implementation'
  );
  // And the destination has to actually admit an advisor, which is the whole
  // reason the target changed. Pin that, not just the string.
  const markets = app.split('\n').find((l) => l.includes('path="/research/markets"'));
  assert.match(markets, /'advisor'/, '/research/markets must admit the role being redirected into it');
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
});

test('no shell offers the retired /market-intel, and every role with a Research row reaches /research', () => {
  // This held the opposite until D670: every role that had Market Intelligence
  // kept a route to it, four by a row's `match` and admin by the launcher. The
  // owner then retired the page (and its sector digest) outright, so the
  // property is now that nothing offers it, its URL only redirects, and the
  // four roles that kept a Research row still land on /research.
  const offers = Object.entries(SIDEBAR_GROUPS)
    .filter(([, groups]) => groups.some((g) => (g.items || []).some((it) =>
      it.to === '/market-intel' || (it.match || []).includes('/market-intel'))))
    .map(([role]) => role);
  assert.deepEqual(offers, [], 'a shell offers the retired /market-intel again');
  assert.ok(!WORKSPACES.some((w) => w.route === '/market-intel'), 'the admin palette offers /market-intel again');
  assert.match(read('frontend/src/App.jsx'), /<Route path="\/market-intel" element=\{<Navigate to="\/research" replace \/>\} \/>/,
    '/market-intel must redirect to /research, never 404');
  const research = Object.entries(SIDEBAR_GROUPS)
    .filter(([, groups]) => groups.some((g) => (g.items || []).some((it) => it.label === 'Research' && it.to === '/research')))
    .map(([role]) => role).sort();
  assert.deepEqual(research, ['advisor', 'founder', 'investor', 'partner']);
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
  //
  // D392: the one surface is now the advisor's canvas-built Research bucket.
  // `/research` renders `ResearchWorkspace` for an advisor under a guard that
  // names 'advisor', which is what "lands on a surface that renders" requires.
  assert.match(app, /path="\/advisor\/research" element=\{<Navigate to="\/research" replace/);
  assert.match(app, /guard\(labRoles\(\['admin', 'advisor', 'partner'\]\), <ResearchWorkspace/,
    '/research no longer admits an advisor to the bucket');
});
