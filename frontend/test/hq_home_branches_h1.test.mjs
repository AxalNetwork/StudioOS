/**
 * HQ Home reads the fan-out it is sent (canvas H1 + H13 rule 3) — D150.
 *
 * THE TEST D108 NAMED AND NOBODY WROTE. PR 6's own plan listed two guards for
 * the branch fan-out: `branch_rpc_fanout.test.ts` and this file. The worker one
 * was written. **This one was not, and that is exactly why the defect survived
 * eleven decisions.**
 *
 * WHAT WAS WRONG. `GET /api/admin/hq/overview` has computed and sent `branches`
 * (every `BRANCH_*` binding, each in one of three states) and
 * `branches_coverage` (`{total, answered, complete, unreadable[]}`) since D108.
 * `HqHomePage` read **neither**. Its "Subsidiary health" zone was drawn from
 * the licence ledger alone, so Accounts and backlog rendered `<Unrecorded/>`
 * under a footnote saying they "need every account to name its licence; none
 * does yet".
 *
 * THAT REASON WAS NEVER THE BLOCKER FOR A BRANCH. U1 is a fact about HQ's own
 * database. A branch is a separate Worker over a separate D1 (D.2), so every
 * account there is that branch's by construction — which is precisely why
 * `branchOverview` can count them, why D148 could publish medians of them, and
 * why the figures were already on the wire. The page was refusing figures the
 * server was sending it.
 *
 * Same class as #252 (a table with no writer and no reader), D142
 * (`/me.branch`'s `status` and `as_of`, shipped and consumed by nothing) and
 * D149 (`revenue_share_bps`, on the row and thrown away). **Sixth instance.**
 *
 * WHY THE THREE STATES ARE ASSERTED SEPARATELY rather than sampled: `ok`,
 * `unreadable` and `not_deployed` mean three different things, and the failure
 * this architecture invites is collapsing them — reading a branch's silence as
 * a zero and quietly shrinking a total. That is D148's lesson one surface up,
 * and it is the same reason H13 states "unreadable is a word in the answer" as
 * a rule the implementation must honour.
 *
 * Run with:
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/hq_home_branches_h1.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { codeOnly } from './_codeOnly.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel) => readFileSync(resolve(root, rel), 'utf8');
const PAGE = codeOnly(read('frontend/src/pages/hq/HqHomePage.jsx'));
const ROUTE = read('cloudflare-worker/src/routes/admin_hq.ts');
const BRANCHES = read('cloudflare-worker/src/services/branches.ts');

test('the page reads both fields the overview sends, which is the whole defect', () => {
  // Asserted as READS, not as a mention: the fields were named in this file's
  // comments for eleven decisions while nothing consumed them, and a scan that
  // accepted a comment would have passed throughout.
  assert.match(PAGE, /data\.branches\b/, 'the page must read the fan-out');
  assert.match(PAGE, /data\.branches_coverage\b/, 'the page must read the coverage');
  // And the server must still be sending them, or the page reads nothing.
  assert.match(ROUTE, /\n\s*branches,/, 'the overview must return branches');
  assert.match(ROUTE, /branches_coverage: branchCoverage/, 'the overview must return its coverage');
});

test('a branch is joined to its licence by the only key that can join them', () => {
  // `licence_uid` is the join, and it did not exist on a branch entry before
  // D150: `deployedBranches` selected code, hostname and status alone, so a
  // card could not have said whose figures it was showing even if it had read
  // them. Both ends are asserted — the SELECT that projects it and the page
  // that keys on it — because either alone is a join that does not happen.
  assert.match(
    ROUTE,
    /SELECT code, hostname, status, licence_uid FROM licence_deployments/,
    'the registry must project the licence a deployment belongs to',
  );
  assert.match(BRANCHES, /licence_uid\?: string \| null/, 'a branch result must be able to carry its licence');
  assert.match(PAGE, /b\?\.licence_uid/, 'the page must key its lookup on licence_uid');
  assert.match(PAGE, /branchByLicence/, 'the join must exist');
});

test('every card declares which of the three states it is in', () => {
  // A state a reader cannot see is a state the page does not really have. The
  // attribute is what makes ok / unreadable / not_deployed / none four
  // distinguishable renders rather than one that happens to be empty.
  assert.match(PAGE, /data-branch-state=\{b \? b\.status : 'none'\}/);
});

test('a figure is rendered ONLY from a branch that answered', () => {
  // `live` is null unless status === 'ok', and every figure is gated on it.
  // This is the assertion that stops an `unreadable` branch's silence being
  // drawn as data — the failure D148 named and the reason H13 makes it a rule.
  assert.match(
    PAGE,
    /const live = b && b\.status === 'ok' \? b\.data \|\| null : null/,
    'only an answering branch supplies figures',
  );
  for (const field of ['accounts?.total', 'seats_used', 'backlog']) {
    const at = PAGE.indexOf(`live.${field.split('?')[0]}`);
    assert.ok(at > 0, `${field} must be read from the branch's own answer`);
  }
  // An absent figure never becomes a number, in either of the two spellings
  // that would do it silently.
  assert.doesNotMatch(PAGE, /\|\|\s*0\b/, 'no `|| 0` — a branch that did not answer is not a zero');
  assert.doesNotMatch(PAGE, /\?\?\s*0\b/, 'no `?? 0` either');
});

test('each of the three absent states gives a DIFFERENT reason', () => {
  // The three sentences are the point. Collapsing them would put "we could not
  // reach this branch" and "this licence has no branch" behind one dash, and
  // only the second is a fact about the licence.
  const m = /const branchReason = \(b, what\) => \{([\s\S]*?)\n\};/.exec(PAGE);
  assert.ok(m, 'the reason helper must exist');
  const body = m[1];
  assert.match(body, /if \(!b\)/, 'a licence with no branch has its own sentence');
  assert.match(body, /status === 'not_deployed'/, 'a branch with no binding has its own sentence');
  assert.match(body, /status === 'unreadable'/, 'a branch that did not answer has its own sentence');
  // The branch's OWN reason wins where it has one — the server writes a better
  // sentence than this page can, and `BranchOverview` ships one per field.
  assert.match(PAGE, /live\?\.seats_used_reason/, 'the seat count must use the branch\'s own reason');
  assert.match(PAGE, /live\?\.backlog_reason/, 'the backlog must use the branch\'s own reason');
  // An unreadable branch is NOT a claim the branch is down, and the helper
  // must not make one.
  assert.doesNotMatch(body, /is down|offline|unreachable/i);
});

test('a figure that was read carries WHEN it was read', () => {
  // A fanned-out number without its stamp is the defect D147 and D149 both
  // landed on: the reader cannot tell a fresh figure from an old one.
  assert.match(PAGE, /b\.status === 'ok' && b\.as_of/);
  assert.match(PAGE, /Read \{b\.as_of\}/);
});

/* ── H13 rule 3 · "unreadable is a word in the answer" ──────────────── */

test('the rail tells the model how many branches answered, and names those that did not', () => {
  // THE RULE, AND WHY IT IS THE ONLY ONE OF H13'S FOUR THAT IS REAL TODAY.
  // The rail summarises the coverage lines beside it — `workspace_explain`
  // runs over exactly those lines and deliberately not the rows — so a line
  // that omits an unanswered branch produces an answer that totals over the
  // rest and says nothing about the gap. `coverage()` already returns the
  // unreadable branch CODES, so the sentence names them.
  assert.match(PAGE, /branchLine/, 'the rail must carry a branch line');
  const m = /const branchLine = \(\) => \{([\s\S]*?)\n  \}\)\(\);/.exec(PAGE)
    || /const branchLine = \(\(\) => \{([\s\S]*?)\n  \}\)\(\);/.exec(PAGE);
  assert.ok(m, 'the branch line must be derived, not typed');
  const body = m[1];
  assert.match(body, /c\.unreadable/, 'the line must read the unreadable codes');
  assert.match(body, /unread\.join/, 'the line must NAME the branches that did not answer');
  assert.match(body, /c\.answered/, 'the line must say how many answered');
  assert.match(body, /c\.total/, 'the line must say out of how many');
  // With none deployed the sentence is about HQ rather than a count of zero,
  // which is the D129 / D131 / D140 / D147 / D148 pattern for a sixth time.
  assert.match(body, /No branch is deployed/);
});

test('the reasons that outlived their blockers are corrected, not reworded', () => {
  // Two of HQ Home's three "unavailable" rows named work that had since
  // shipped or been decided against. A stale reason that still reads plausibly
  // is what the next surface cites — which is how this one survived: D111
  // built the reporting call and nobody re-read the rail.
  assert.doesNotMatch(PAGE, /that call is not built/, 'D111 built reportUsage and revenueSummary');
  assert.doesNotMatch(PAGE, /\['Seat utilisation',/, 'D127 decided against a seat store');
  assert.match(PAGE, /\['Which seat id a member holds', '[^']+'\]/);
  assert.match(PAGE, /no branch has sent one yet/, 'what is missing is a report, not the call');
  // Security's row cited U1 for a view that U1 does not block. The reason the
  // SERVER sends is the one copy both surfaces render, so it is asserted there.
  const SEC = read('cloudflare-worker/src/routes/admin_security.ts');
  assert.match(SEC, /this is a view that has not been built/);
  assert.doesNotMatch(SEC, /which is U1\./, 'the overlay is unbuilt, not blocked by U1');
  // And Security's OWN rail carries a second copy of the same claim — the rail
  // rows are typed on the page, not fetched. Correcting one and not the other
  // is how the surfaces come to disagree, so both are pinned.
  const SECPAGE = codeOnly(read('frontend/src/pages/hq/SecurityPage.jsx'));
  assert.doesNotMatch(SECPAGE, /that is the same U1/, 'the rail still blames U1 for the overlay');
  assert.match(SECPAGE, /\['The "Return to HQ view" overlay', 'Not built\./);
});
