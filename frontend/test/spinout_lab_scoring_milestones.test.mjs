/**
 * Spin-Out Lab · Scoring — a milestone write may never fail the run it follows.
 *
 * WHY THIS FILE EXISTS. `runPractice` does one thing a person cares about —
 * `api.scoreStartup(payload)` — and then several things they do not: it marks a
 * Week-3 lab milestone, refreshes the history, and may mark a second milestone.
 * All of it sits inside one `try`, whose `catch` sets
 * `'Scoring run failed.'` and skips `setFormOpen(false)`.
 *
 * So anything that throws AFTER the scoring call succeeds tells a person their
 * successful run failed, and leaves the form open over a result that was saved.
 * The second call is worse than the first: by then `setSnapshots(scores)` has
 * already landed, so the red line would sit over a history that had just
 * refreshed correctly.
 *
 * `markMilestone` cannot throw today — every `await` inside it is in its own
 * `try`, its `catch` calls `reportError`, and its header states the contract:
 * "never throws into the user's primary flow". This guard is therefore about
 * the CONTRACT, not a live bug, and it is the same call `DiscoveryPage` already
 * made for the same reason ("defend against any future change to its
 * contract"). It is deliberately NOT applied to the other ~38 bare call sites:
 * there the hook's own guarantee is enough, because a throw would not be
 * reported to the person as a different operation failing.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { codeOnly } from './_codeOnly.mjs';

const read = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const PAGE = codeOnly(read('frontend/src/pages/SpinoutLabScoringPage.jsx'));
const HOOKS = read('frontend/src/lib/spinoutLabHooks.js');

/** `runPractice` alone, bounded at both ends. */
function runPractice() {
  const a = PAGE.indexOf('const runPractice = async');
  assert.ok(a > 0, 'runPractice is gone — this whole file is about that function');
  const b = PAGE.indexOf('setRunning(false);', a);
  assert.ok(b > a, 'runPractice no longer clears its running flag — recheck the bound');
  return PAGE.slice(a, b);
}

test('the premise: the run and the milestone share one catch, and it reports a failure', () => {
  // If these two facts ever stop holding, the guard below is guarding nothing
  // and should be deleted rather than left to pass for the wrong reason.
  const body = runPractice();
  assert.match(body, /await api\.scoreStartup\(payload\)/, 'the scoring call moved out of runPractice');
  assert.match(body, /Scoring run failed\./,
    'the outer catch no longer reports a failure, so a late throw is harmless now');
});

test('neither milestone write can report the scoring run as failed', () => {
  const body = runPractice();
  const calls = [...body.matchAll(/markMilestone\(/g)];
  assert.equal(calls.length, 2, 'runPractice gained or lost a milestone write');

  // EACH call is inside a `try` of its own — not merely somewhere inside the
  // function's outer one, which is what makes the difference.
  for (const m of calls) {
    const before = body.slice(Math.max(0, m.index - 220), m.index);
    // `try {` then (optionally) `await ` and nothing else — the call is the
    // first statement in its own try, not merely somewhere under the outer one.
    assert.match(before, /try \{\s*(?:await\s+)?$/,
      'a milestone write is not immediately inside its own try, so a throw would '
      + 'surface as "Scoring run failed." over a run that succeeded');
    const after = body.slice(m.index, m.index + 260);
    const c = after.indexOf('} catch {');
    assert.ok(c >= 0,
      'a milestone write opens a try that catches something narrower than everything');

    // AND NOTHING IS LOGGED IN IT. `markMilestone` already reports its own
    // failures through `reportError`; a `console.warn` beside it would
    // double-log one event and add a raw console call to a page that has three
    // too many. BOUNDED TO THIS CATCH'S OWN LINE — a wider window runs into the
    // function's outer `catch (err)`, whose `console.error` is legitimate and
    // has nothing to do with milestones. That window failed here first.
    const eol = after.indexOf('\n', c);
    const guard = after.slice(0, eol === -1 ? after.length : eol);
    assert.doesNotMatch(guard, /console\.(warn|error|log)/,
      'the milestone guard logs a failure the hook has already reported');
  }
});

test('the contract this defends is real, and is where the reporting happens', () => {
  // Read off the hook rather than trusted: if `markMilestone` ever stops
  // catching, the wraps above become load-bearing rather than defensive, and
  // this assertion is what says so.
  assert.match(HOOKS, /export async function markMilestone/, 'markMilestone moved');
  assert.match(HOOKS, /\} catch \(e\) \{\s*\n\s*reportError\(`spinoutLabHooks:\$\{key\}`, e\);/,
    'markMilestone no longer reports its own failures, so the callers above are now load-bearing');
});
