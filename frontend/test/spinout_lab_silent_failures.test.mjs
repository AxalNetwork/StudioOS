/**
 * Three actions that failed without saying so.
 *
 * WHAT THIS IS ABOUT. D115 made every catch in the Spin-Out Lab pages *report*
 * — the failure now reaches the ring buffer and the production beacon. Three of
 * those catches still set no UI state at all, so the failure was reported to us
 * and invisible to the person it happened to. All three were the same shape:
 *
 *   if (busy) return  ->  setBusy(id)  ->  try  ->  catch reports  ->  finally setBusy(null)
 *
 * `finally` clearing the busy flag is *teardown*, not an outcome, which is what
 * made the failure look exactly like the success: the spinner stopped either
 * way. A reader scanning for a bug sees a catch with a `reportError` in it and
 * moves on, which is why these three needed finding rather than noticing.
 *
 * WHY SOURCE TEXT. These are three states inside pages that load in a
 * `useEffect`, and `renderToStaticMarkup` never runs one (frontend/test/README.md
 * — the page would emit only its skeleton). The assertions are bounded to each
 * handler's own body so they cannot be satisfied by a sibling's error state.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const REVENUE = read('frontend/src/pages/SpinoutLabRevenuePage.jsx');
const CAPITAL = read('frontend/src/pages/SpinoutLabCapitalPage.jsx');

/**
 * The body of one `const <name> = async (…) => { … }` handler.
 *
 * Bounded at the next `\n  const ` so an assertion cannot pass on the NEXT
 * handler's error state — which is the one way a "does this file mention
 * setFooError" check goes wrong in a file with a dozen handlers.
 */
function handler(src, name) {
  const at = src.indexOf(`const ${name} = async (`);
  assert.ok(at > 0, `${name} is gone or was renamed — repoint this test`);
  const end = src.indexOf('\n  const ', at + 10);
  return src.slice(at, end > at ? end : at + 1200);
}

test('a failed snapshot delete says so, and says the row is still there', () => {
  const body = handler(REVENUE, 'deleteSnapshot');
  assert.match(body, /reportError\('spinout-revenue:delete'/, 'the report is the D115 half and must stay');
  assert.match(body, /setDeleteError\(/, 'the catch sets no user-visible state, so the failure is invisible');
  // The message must not claim the row went. A delete that failed left it.
  assert.match(body, /still in your log/i);
  // Cleared on the next attempt, or one stale error outlives its cause.
  assert.match(body, /setDeleteError\(''\)/, 'a retry must clear the previous failure');
  assert.ok(
    REVENUE.includes('data-testid="delete-error"'),
    'the state exists but nothing renders it',
  );
});

test('a failed stage change says so, beside the prospect it failed on', () => {
  const body = handler(CAPITAL, 'setStage');
  assert.match(body, /reportError\('spinout-capital:stage'/);
  assert.match(body, /setStageError\(\{/, 'the catch sets no user-visible state');
  assert.match(body, /id: p\.id/, 'the error must name its prospect, the way stageBusy does');
  assert.match(body, /still where it was/i, 'the message must not imply the move landed');
  assert.match(body, /setStageError\(\{ id: null, message: '' \}\)/, 'a retry must clear the previous failure');
  // Rendered against the same prospect, not as a page-level banner.
  assert.match(CAPITAL, /stageError\.id === p\.id/);
  assert.match(CAPITAL, /data-testid=\{`stage-error-\$\{p\.id\}`\}/);
});

test('a failed clipboard write changes the button, which used to read un-clicked', () => {
  // Not a `const … = async` handler — it is an inline onClick — so this one is
  // bounded by the copy flag itself rather than by `handler()`.
  assert.match(REVENUE, /setSummaryCopied\('fail'\)/, 'a refused clipboard left the button saying "Copy investor summary"');
  assert.match(REVENUE, /setSummaryCopied\('ok'\)/, 'the success arm must move to the same tri-state');
  assert.match(REVENUE, /summaryCopied === 'fail' \? 'Copy failed/, 'the state exists but the label never shows it');
  assert.doesNotMatch(REVENUE, /setSummaryCopied\(true\)/, 'the boolean form is gone — it had no failure state');
  assert.doesNotMatch(REVENUE, /setSummaryCopied\(false\)/);

  // The milestone stays INSIDE the try on purpose: the summary text is built
  // either way, but a founder whose clipboard refused does not have it, and a
  // deliverable nobody can paste is not delivered. Pin that so it is a decision
  // rather than an accident of line order.
  const onClick = REVENUE.slice(REVENUE.indexOf('const text = ['), REVENUE.indexOf('className={labBtn('));
  const tryAt = onClick.indexOf('try {');
  const catchAt = onClick.indexOf('} catch (e) {');
  const milestoneAt = onClick.indexOf("markMilestone(user, 'revenue_summary_generated')");
  assert.ok(tryAt > 0 && catchAt > tryAt && milestoneAt > tryAt && milestoneAt < catchAt,
    'the milestone must stay inside the try — a summary that could not be copied was not delivered');
});
