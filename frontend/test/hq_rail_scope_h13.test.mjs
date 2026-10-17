/**
 * H13 · the HQ rail's scope, its cost line and its four rules — D154.
 *
 * H13 states four rules. Two were shipped or refused before this, and the
 * other two were blocked on the same missing thing — a page that actually
 * reads in more than one scope. D153 built it, so this closes the artboard:
 *
 *   1. "Scope precedes the question" — the CHIP. D150 refused it with its
 *      reason: "the page decides what it fetched before the rail runs, so both
 *      options produce the same read", and a picker whose options cannot
 *      differ is the `still_an_admin` mistake D134 named. Under the overlay
 *      they demonstrably differ, so the chip is built — and built as the
 *      canvas describes it ("the chip is what the viewing-as banner set"),
 *      which is a REPORT, not a picker. That distinction is the decision.
 *   2. "Cost is per scope" — REFUSED, and restated rather than dropped. The
 *      canvas prices "All branches" as up to four reads and four drafts. This
 *      read-back performs ONE run at ONE price whatever its scope, because it
 *      summarises coverage lines the page already rendered and does not fan
 *      out. The multiplier is real only once the read-back itself fans out,
 *      which is a producer nothing has built.
 *   3. "Unreadable is a word in the answer" — SHIPPED in D150, as HQ Home's
 *      `branchLine`. Re-asserted here so the two halves of one rule cannot
 *      drift apart.
 *   4. "Anything about a named branch is logged" — D150 refused it because the
 *      rail read no branch, and logging it would have written a FALSE audit
 *      row. D153's overlay makes the coverage lines one branch's figures, so
 *      the premise is gone and the rule is built — narrowed to the scoped
 *      case, which is the D111 pattern for a reason that half-expires.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { codeOnly } from './_codeOnly.mjs';

const read = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const RAIL = codeOnly(read('frontend/src/ui/WorkerRail.jsx'));
const HOME = codeOnly(read('frontend/src/pages/hq/HqHomePage.jsx'));
const OVERLAY = codeOnly(read('frontend/src/pages/hq/HqBranchOverlay.jsx'));
const API = codeOnly(read('frontend/src/lib/api.js'));
const AI = codeOnly(read('cloudflare-worker/src/routes/ai.ts'));

test('rule 1 — the rail draws no scope chip, and offers no scope either', () => {
  // THE CHIP LEFT WITH THE COVERAGE BLOCK IT HEADED (owner, 2026-10-10): the
  // rail is the AIRail canvas's four blocks, and the scope the page read in is
  // the viewing-as banner's to state. What D150 refused still holds: nothing
  // on the rail may offer a scope it cannot change.
  assert.doesNotMatch(RAIL, /worker-rail-scope|\{scope && \(/, 'the scope chip is drawn again');
  assert.match(RAIL, /RETIRED_RAIL_PROPS = \[[^\]]*'scope'/, 'scope is no longer listed as retired');
  assert.doesNotMatch(RAIL, /<select\b/, 'the rail grew a picker');
});

test('rule 1 — both HQ scopes are named, and they are two different reads', () => {
  assert.match(HOME, /scope="All branches"/, 'the unscoped HQ rail stopped naming its scope');
  assert.match(OVERLAY, /scope=\{code\}/, 'the overlay rail stopped naming its branch');
  // The two are different reads, which is what makes the chip mean anything —
  // this is the exact premise D150's refusal lacked.
  assert.match(HOME, /api\.hqOverview\(\)/, 'HQ Home stopped reading the fan-out');
  assert.match(OVERLAY, /api\.hqOverview\(branch\)/, 'the overlay stopped reading one branch');
});

test('rule 2 — the cost line is per run, and the multiplier is refused with its measurement', () => {
  assert.match(OVERLAY, /A per-scope cost multiplier/, 'the refused multiplier stopped being stated');
  assert.match(OVERLAY, /One run, one price/, 'the reason for refusing it is gone');
  // And nothing multiplies: since 2026-10-10 the rail runs nothing at all —
  // its read-back left with the AIRail canvas — so it sends no request of its
  // own whatever the scope.
  const calls = [...RAIL.matchAll(/api\.(\w+)\(/g)].map((m) => m[1]);
  assert.deepEqual(calls, [], 'the rail runs a model again');
});

test('rule 3 — unreadable is a word in the answer, on both surfaces', () => {
  // HQ Home's branch line (D150) names the branches that did not answer.
  assert.match(HOME, /did not, so any total here excludes/, 'the fan-out rail stopped naming unreadable branches');
  // And the overlay says it too, rather than summarising nothing in silence:
  // a rail with no coverage and no note lets a generated answer read "none"
  // when the truth is "not read".
  assert.match(OVERLAY, /coverageNote=\{/, 'the overlay rail carries no note for a branch it could not read');
  assert.match(OVERLAY, /absent \|\| undefined/, 'the overlay rail drops the branch\'s own reason');
});

test('rule 4 — a named branch is logged, and an unscoped run still is not', () => {
  // The rail no longer runs the read-back (owner, 2026-10-10), so it sends no
  // branch; the route and the api method below keep the rule for any caller.
  assert.doesNotMatch(RAIL, /branch: scopeBranch/, 'the rail sends a branch again');
  // RE-AIMED IN D404: this pinned the parameter list as an exact tuple, so
  // adding `page` failed it while changing nothing about the branch. The
  // property is that the method ACCEPTS a branch and FORWARDS it.
  assert.match(API, /aiWorkspaceExplain: \(\{[^}]*\bbranch\b[^}]*\}\) =>/,
    'the api method stopped carrying the branch');
  assert.match(API, /aiWorkspaceExplain:[\s\S]{0,300}?JSON\.stringify\(\{[^}]*\bbranch\b[^}]*\}\)/,
    'the api method accepts a branch and drops it before the request');
  // HQ Home's fan-out rail names a scope and sends NO branch — "All branches"
  // is not a branch, and a row claiming one was read would be the false audit
  // entry D150 refused to write.
  assert.ok(!HOME.includes('scopeBranch'), 'the fan-out rail sends a branch code it did not read');

  // The route writes the row only when a branch is named, validates the code
  // rather than logging whatever arrived, and does it BEFORE the run so a
  // refused or blocked read is still recorded.
  assert.match(AI, /'ai_branch_readback'/, 'the branch read-back is no longer audited');
  assert.match(AI, /if \(branch\) \{/, 'the audit row is written for runs that named no branch');
  assert.match(AI, /BRANCH_CODE_RE\.test\(branchRaw\)/, 'the branch code reaches the audit row unvalidated');
  assert.ok(
    AI.indexOf("'ai_branch_readback'") < AI.indexOf("task: 'workspace_explain'"),
    'the audit row is written after the run, so a refused read leaves no trace of what was asked',
  );
});
