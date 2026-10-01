/**
 * The three legacy investor pipeline paths are retired, and the two traps in
 * retiring them are held open.
 *
 * WHAT HAPPENED (D118 → D119). `/deals/*` and the legacy `/pipeline/*` trio
 * were two complete implementations of investor deal-flow over two different
 * backends. D118 called them the same job and ported what the legacy trio had
 * that the zones did not — free-text search, and counts on the chip row. D119
 * is the other half: the three sub-paths redirect and their pages are deleted.
 *
 * THE TWO TRAPS, and both would have been silent.
 *
 * 1. `/pipeline` — THE ROOT — must not redirect. It is role-forked in App.jsx:
 *    partner gets `PartnerBucketRoutes`, investor and founder keep
 *    `PipelineWorkspace`, and founder access there is deliberate. Only the
 *    investor arm was superseded, so an unconditional redirect would take the
 *    founder's board and the partner's bucket root with it.
 *
 * 2. `legacyRedirects()` must never be mounted wholesale. It is exported from
 *    shellConfig and called by NOTHING, and every row named a path App.jsx
 *    still mounts as a live route. Mounting the set would have replaced each
 *    of those pages with a redirect. D119 moved three paths by hand instead,
 *    and taught the function to skip `/pipeline` via `legacyForked` — the flag
 *    keeps the provenance (this zone did supersede that board for investors)
 *    while making the dangerous row unusable.
 *
 * THE TAB BAR IS WHY THE TABS DID NOT SIMPLY GO. `PipelineWorkspace`'s own
 * comment already recorded that its tab bar is the only inbound link an
 * investor has to those surfaces, because the shell collapsed the former
 * sidebar rows into one "Deals" row landing on `/pipeline`. Deleting the tabs
 * would have removed the door along with the page, so they now point at
 * `/deals/*`.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { legacyRedirects, ROLES_WITH_SHELL } from '../src/workspaces/shellConfig.js';

const read = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const APP = read('frontend/src/App.jsx');
const WS = read('frontend/src/pages/PipelineWorkspace.jsx');

const RETIRED = [
  ['/pipeline/screening', '/deals/screening'],
  ['/pipeline/commit', '/deals/commit'],
  ['/pipeline/transactions', '/deals/closing'],
];

test('each retired path redirects to its canonical zone', () => {
  for (const [from, to] of RETIRED) {
    const at = APP.indexOf(`path="${from}"`);
    assert.ok(at > 0, `${from} is no longer registered — an old inbound link now 404s`);
    // Bounded to this route's own element so a NEIGHBOURING route's Navigate
    // cannot satisfy it — the three sit on consecutive lines.
    const element = APP.slice(at, at + 160);
    assert.match(element, new RegExp(`<Navigate to="${to}" replace`),
      `${from} does not redirect to ${to}`);
  }
});

test('the three legacy pages are gone, and nothing imports them', () => {
  for (const page of ['PipelineScreeningPage', 'PipelineCommitPage', 'PipelineTransactionsPage']) {
    assert.equal(existsSync(resolve(process.cwd(), `frontend/src/pages/${page}.jsx`)), false,
      `${page}.jsx survives the retirement of its only route`);
    assert.ok(!WS.includes(`import ${page}`), `PipelineWorkspace still imports ${page}`);
  }
});

test('TRAP 1 — /pipeline keeps its role fork and never redirects', () => {
  const at = APP.indexOf('path="/pipeline"');
  assert.ok(at > 0, 'the /pipeline root is gone — the founder board and partner bucket root with it');
  const element = APP.slice(at, at + 220);
  assert.doesNotMatch(element, /<Navigate/, 'the /pipeline ROOT was turned into a redirect');
  // The fork itself, which is the reason it may not redirect.
  assert.match(element, /effectiveRole === 'partner' \? <PartnerBucketRoutes \/>/,
    'the partner arm of /pipeline is gone');
  assert.match(element, /<PipelineWorkspace \/>/, 'the investor/founder arm of /pipeline is gone');
  assert.match(element, /'founder'/, 'founder lost /pipeline, and that access is deliberate');
});

test('TRAP 2 — legacyRedirects never offers to redirect /pipeline', () => {
  // The flag, tested through the function rather than by reading the config:
  // a `legacyForked` row that the filter stopped honouring would still LOOK
  // right in shellConfig and would arm the trap again.
  for (const role of ROLES_WITH_SHELL) {
    const froms = legacyRedirects(role).map((r) => r.from);
    assert.ok(!froms.includes('/pipeline'),
      `legacyRedirects('${role}') offers to redirect /pipeline, which is role-forked`);
  }
  // And the three that DID retire are still described, so the ledger stays true.
  const investor = legacyRedirects('investor');
  for (const [from, to] of RETIRED) {
    const row = investor.find((r) => r.from === from);
    assert.ok(row, `legacyRedirects lost ${from}`);
    assert.equal(row.to, to, `legacyRedirects sends ${from} somewhere other than ${to}`);
  }
});

test('the workspace tab bar keeps its doors, re-pointed at /deals', () => {
  // Deleting these would remove the investor's only inbound link to the
  // surfaces, which is the failure the workspace header warns about.
  for (const to of ['/deals/screening', '/deals/commit', '/deals/closing']) {
    assert.ok(WS.includes(`to: '${to}'`), `the tab bar lost its door to ${to}`);
  }
  // No tab may point at a path that now redirects: a door to a redirect is a
  // door with an extra hop, and the next reader would not know which is real.
  for (const [from] of RETIRED) {
    assert.ok(!WS.includes(`to: '${from}'`), `a tab still points at the retired ${from}`);
  }
  // The board stays, and it is the only body this workspace can render now.
  assert.ok(WS.includes("to: '/pipeline'"), 'the Board tab is gone');
  assert.match(WS, /<PipelinePage embedded \/>/, 'the board body is gone');
  assert.doesNotMatch(WS, /active === '(screening|commit|transactions)'/,
    'a branch remains for a pathname this workspace can no longer be given');
});
