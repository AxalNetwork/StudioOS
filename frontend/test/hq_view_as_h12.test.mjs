/**
 * HQ · Viewing as one branch (Admin · Super canvas, H12, frames 1 and 2) — D153.
 *
 * WHAT THIS PINS, AND WHY IT IS A PROPERTY RATHER THAN A SPELLING. The canvas
 * states the overlay in one sentence: "The overlay is not a filter on an HQ
 * table — it is one private-link read, of one branch, rendered with every
 * action removed. Each figure carries the branch and the time it was read, so
 * nothing on the screen can be mistaken for a platform total."
 *
 * Every assertion below is one clause of that sentence:
 *   1. ONE READ, of ONE branch — the route is scoped, and the scoped path does
 *      not fan out and discard.
 *   2. NOT A FILTER — HQ's own platform payload is not fetched under the
 *      overlay, so there is nothing to have been narrowed.
 *   3. EVERY ACTION REMOVED, and ABSENT rather than DISABLED. A greyed control
 *      claims the action exists here and is momentarily unavailable; it does
 *      not exist here (D134's `still_an_admin` lesson).
 *   4. EVERY FIGURE STAMPED — the branch and the read time per tile, not once
 *      in a header a reader scrolls past.
 *   5. THE ABSENCES STAY ABSENT — the Queues zone states it has no producer,
 *      and MTD revenue renders the server's own sentence rather than a zero.
 *   6. ALL THREE BRANCH STATES — `ok`, `unreadable` and `not_deployed` are
 *      three different sentences, and an unreadable branch is never a page of
 *      zeros. A fixture with only the `ok` case cannot see that.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { codeOnly } from './_codeOnly.mjs';

const read = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const OVERLAY = codeOnly(read('frontend/src/pages/hq/HqBranchOverlay.jsx'));
const HOME = codeOnly(read('frontend/src/pages/hq/HqHomePage.jsx'));
const TEAM = codeOnly(read('frontend/src/pages/hq/HqTeamTable.jsx'));
const BAR = codeOnly(read('frontend/src/components/HqViewingAsBar.jsx'));
const APP = codeOnly(read('frontend/src/App.jsx'));
const CTX = codeOnly(read('frontend/src/contexts/ViewAsBranchContext.js'));
const HQ = codeOnly(read('cloudflare-worker/src/routes/admin_hq.ts'));
const BRANCHES = codeOnly(read('cloudflare-worker/src/services/branches.ts'));

test('the scope changes what the server READS, and the overlay does not fetch HQ\'s own payload', () => {
  // 1 — one read, of one branch.
  assert.match(OVERLAY, /api\.hqOverview\(branch\)/, 'the overlay stopped scoping its own read');
  assert.match(HQ, /const scoped = scopeOf\(c\);/, 'the route stopped reading the scope');
  assert.match(HQ, /branchRead<BranchOverview>\(env, scoped, 'overview'\)/,
    'the scoped overview fans out and discards instead of reading one branch');
  // 2 — NOT a filter. HQ Home's own fetch is skipped under the overlay, so
  // there is no platform payload sitting behind the scoped screen to have been
  // narrowed — and no licence ledger or platform account total one render away
  // from a banner saying nothing here is a platform total.
  assert.match(HOME, /if \(viewAs\) return;/, 'HQ Home still fetches its platform payload under the overlay');
  // And the scoped response genuinely omits them, rather than the page merely
  // not drawing them: the early return carries `scope`, one branch and its
  // coverage, and nothing else.
  const scopedBlock = HQ.slice(HQ.indexOf('const scoped = scopeOf(c);'), HQ.indexOf('const roles = await'));
  for (const platform of ['accounts:', 'seats_licensed', 'licences,', 'queue,', 'events:']) {
    assert.ok(!scopedBlock.includes(platform),
      `the scoped payload carries HQ's own \`${platform}\` — a platform figure under a branch banner`);
  }
});

test('the chrome is in the SHELL, above every other bar, and persists nothing', () => {
  assert.match(APP, /<SafeMount name="HqViewingAsBar">/, 'the bar is not mounted');
  // ANCHORED ON THE MOUNT, NOT THE NAME. Reading `indexOf('HqViewingAsBar')`
  // found the IMPORT line at the top of the file, which is before every mount
  // — so the comparison was true whatever the mount order was, and the
  // assertion could not fail. Caught by moving the mount below PortalSwitcher
  // and watching it pass. An assertion that cannot fail is not a guard.
  assert.ok(
    APP.indexOf('<SafeMount name="HqViewingAsBar">') < APP.indexOf('<PortalSwitcher'),
    'the bar mounts below PortalSwitcher, so the ordinary admin bar can frame a scoped view alone',
  );
  assert.match(BAR, /Read-only/, 'the bar stopped saying the view is read-only');
  assert.match(BAR, /Return to HQ view/, 'the bar lost its way out');
  // PERSISTS NOTHING — `AdminFrozenBar`'s rule. A scope a reload restores is a
  // mode somebody can forget they are in, into a session that did not enter it.
  for (const store of ['localStorage', 'sessionStorage']) {
    assert.ok(!CTX.includes(store), `the view-as scope is stored in ${store}`);
    assert.ok(!BAR.includes(store), `the bar stores the scope in ${store}`);
  }
  assert.match(APP, /const \[viewAsBranch, setViewAsBranch\] = useState\(null\)/,
    'the shell stopped holding the scope as plain React state');
});

test('every action is ABSENT under the overlay, never disabled', () => {
  // 3 — the canvas: "no approve, decline or reassign — the controls are
  // absent, not disabled", and "'Move…' is gone rather than greyed: an action
  // that cannot run from this view is not drawn in it."
  //
  // Asserted as the ABSENCE OF CONTROLS rather than as the absence of the word
  // "disabled", because a page may legitimately disable something outside the
  // overlay: the overlay body is its own file, so the scan is bounded to it.
  const controls = [...OVERLAY.matchAll(/<(button|a|form|input|select|textarea)\b/g)].map((m) => m[1]);
  assert.deepEqual(controls, [], `the overlay drew ${controls.join(', ')} — an action that cannot run from this view`);
  assert.ok(!OVERLAY.includes('disabled'), 'the overlay greyed a control instead of not drawing it');
  // Team's scoped half says the same thing in words, and skips HQ's roster
  // rather than filtering it.
  assert.match(TEAM, /api\.hqAdmins\(asked, viewAs \|\| undefined\)/, 'Team does not send the scope');
  assert.match(TEAM, /data-testid="hq-team-scoped-note"/, 'Team stopped saying what it is reading');
});

test('every figure carries the branch and the time it was read', () => {
  // 4 — per tile, because a stamp in a header is a stamp a reader scrolls past
  // and the whole overlay exists so a number here cannot be read as a total.
  assert.match(OVERLAY, /data-testid="hq-overlay-stamp"/, 'the tiles lost their stamp');
  const tiles = [...OVERLAY.matchAll(/<BranchTile\b[\s\S]*?\/>/g)].map((m) => m[0]);
  assert.equal(tiles.length, 4, `expected H12's four tiles, found ${tiles.length}`);
  for (const t of tiles) {
    assert.match(t, /branch=\{code\}/, `a tile does not name its branch: ${t.slice(0, 60)}`);
    assert.match(t, /readAt=\{readAt\}/, `a tile does not carry its read time: ${t.slice(0, 60)}`);
  }
  // The server sends both clocks, and they answer different questions: when
  // this screen was filled, and how old the branch's own figure was.
  assert.match(HQ, /read_at: new Date\(\)\.toISOString\(\)/, 'the route stopped stamping the read');
  assert.match(HQ, /as_of: one\.as_of \?\? null/, 'the route stopped passing the branch\'s own stamp');
});

test('the two absences stay absent — the Queues zone and MTD revenue', () => {
  // 5 — H12 draws a Queues zone of decisions the branch already made. Measured
  // against the RPC surface, NOTHING returns one: twelve `HqEntrypoint`
  // methods, fifteen `branchOps` exports, and none is a decision feed. So the
  // heading is drawn and the absence stated, which is what D140, D147 and D151
  // did in the same position.
  assert.match(OVERLAY, /data-testid="hq-overlay-queues-absent"/, 'the Queues absence stopped being stated');
  assert.match(OVERLAY, /No branch RPC returns a decision feed/, 'the Queues zone stopped saying why it is empty');
  // MTD revenue is null BY CONSTRUCTION (`branchOverview` returns
  // `revenue_mtd_cents: null` with its own reason), so the tile renders the
  // server's sentence. A zero here would be a claim about this branch's
  // trading that nothing measured.
  const mtd = OVERLAY.slice(OVERLAY.indexOf('label="MTD revenue"'));
  assert.match(mtd.slice(0, 400), /value=\{null\}/, 'the MTD tile invented a figure');
  assert.match(mtd.slice(0, 400), /revenue_reason/, 'the MTD tile stopped reading the server\'s reason');
  // And no figure anywhere falls back to zero — the page-wide rule.
  assert.doesNotMatch(OVERLAY, /\|\|\s*0\b/, 'a figure defaults to zero instead of saying it is absent');
  assert.doesNotMatch(OVERLAY, /\?\?\s*0\b/, 'a figure defaults to zero instead of saying it is absent');
});

test('all three branch states reach the screen, and an unreadable branch is not a page of zeros', () => {
  // 6 — `ok` / `unreadable` / `not_deployed`. The helper answers `not_deployed`
  // for an unbound code rather than `unreadable`, because the two are different
  // facts and the whole module exists because collapsing them prints the wrong
  // colour.
  assert.match(BRANCHES, /export async function branchRead</, 'the single-branch read is gone');
  assert.match(BRANCHES, /status: 'not_deployed',/, 'an unbound code stopped reading as not deployed');
  // The overlay renders the branch's own reason under every state that is not
  // `ok`, and — the part that matters — every tile then shows that reason
  // rather than a number.
  assert.match(OVERLAY, /one\.status !== 'ok'/, 'the overlay stopped distinguishing the states');
  assert.match(OVERLAY, /data-testid="hq-overlay-branch-absent"/, 'an unreadable branch renders no reason');
  assert.match(OVERLAY, /reason=\{absent \|\|/, 'a tile ignores the branch\'s own absence and falls back to its own copy');
  assert.match(OVERLAY, /data-branch-state=\{one \? one\.status : 'loading'\}/,
    'the rendered state is not visible to a test or to an operator inspecting it');
});

test('the way IN is drawn only where there is a branch behind it', () => {
  // A "view as" on a licence whose branch is unbound, or did not answer, would
  // open a screen of absences — the `still_an_admin` mistake D134 named, one
  // tier up. The way OUT is the shell bar, because the overlay frames every
  // page it covers rather than the one that entered it.
  assert.match(HOME, /\{b && b\.status === 'ok' && \(/, 'the entry control is drawn without a live branch behind it');
  assert.match(HOME, /data-testid="hq-view-as-enter"/, 'the way into the overlay is gone');
  assert.ok(!HOME.includes('Return to HQ view'), 'the way out was duplicated onto a page');
});
