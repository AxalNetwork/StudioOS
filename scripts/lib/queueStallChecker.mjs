/**
 * D7125-p2 (#7125): the pure half of the stall check's own watchdog, `../queue-stall-checker.mjs`.
 *
 * The `queue-stalled` job runs `scripts/github-alerts.mjs queue-stalled`. When that step crashes
 * (2026-11-22 to 11-24 it failed four times with ERR_MODULE_NOT_FOUND, #8374) no stall alert can open, and
 * nothing said so. A later step of the same job, run with `if: always()`, counts the check step's outcomes
 * in a row and opens `[alert] merge queue stall check failing` at the second failure; the next successful
 * check closes it.
 *
 * This file imports nothing, and the watchdog imports only this file and `node:` modules, so whatever broke
 * the check's own import graph cannot break the watchdog too (`frontend/test/queue_stall_trigger_7125.test.mjs`).
 *
 * The title is not `[alert] merge queue stalled`. A broken check means the stall state is unknown, and
 * D7125 never turns unknown into a transition; that exact title closes land-pr gate 7 and the feeder
 * breaker, which match titles exactly, so this alert tells the channel without pausing the queue.
 */

export const CHECKER_ALERT_TITLE = '[alert] merge queue stall check failing';
/** Consecutive failed checks that open the alert. */
export const FAILURES_TO_OPEN = 2;
/** The check step's outcomes (`steps.<id>.outcome`). Skipped means an earlier step failed: no reading either. */
const FAILED = new Set(['failure', 'cancelled', 'skipped']);

/** The most consecutive failures a saved count may carry; a larger number is not a count this job wrote. */
const MAX_FAILURES = 10_000;
/** Only a run link of this shape and an ISO time survive a read: the cache is file data, so nothing else from it
 *  reaches the issue body. The Slack line carries no cached value at all (CodeQL js/file-access-to-http). */
const RUN_URL = /^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/actions\/runs\/\d{1,20}$/;
const ISO_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;

/** The saved count, or a fresh one when the file is missing or unreadable (a lost count only delays the alert). */
export function readCheckerState(text) {
  try {
    const v = JSON.parse(String(text ?? ''));
    if (v?.schema === 1 && Number.isSafeInteger(v.failures) && v.failures >= 0 && v.failures <= MAX_FAILURES) {
      return {
        schema: 1,
        failures: v.failures,
        since: typeof v.since === 'string' && ISO_TIME.test(v.since) ? v.since : null,
        runs: Array.isArray(v.runs) ? v.runs.filter(r => typeof r === 'string' && RUN_URL.test(r)).slice(-5) : [],
      };
    }
  } catch { /* fresh state */ }
  return { schema: 1, failures: 0, since: null, runs: [] };
}

/**
 * One observation of the check step. `outcome` is the step's outcome, `runUrl` this run, `at` an ISO time,
 * `issueOpen` whether the checker alert is open now. Returns the next state and one action:
 * `open` (second failure in a row, alert not open), `close` (a successful check while it is open), or `none`.
 */
export function checkerTransition(state, { outcome, runUrl = null, at = null, issueOpen = false }) {
  const prev = state?.schema === 1 ? state : readCheckerState('');
  if (outcome === 'success') {
    return { state: { schema: 1, failures: 0, since: null, runs: [] }, action: issueOpen ? 'close' : 'none' };
  }
  if (!FAILED.has(outcome)) throw new Error(`check_outcome_invalid: ${JSON.stringify(outcome)}`);
  const failures = prev.failures + 1;
  const runs = [...prev.runs, ...(runUrl ? [String(runUrl)] : [])].slice(-5);
  const next = { schema: 1, failures, since: prev.failures === 0 ? at : prev.since, runs };
  return { state: next, action: failures >= FAILURES_TO_OPEN && !issueOpen ? 'open' : 'none' };
}

/** The alert issue's body. */
export function checkerIssueBody(state) {
  const runs = state.runs.length ? state.runs.map(u => `- ${u}`).join('\n') : '- (no run link recorded)';
  return [
    `The merge queue stall check (\`scripts/github-alerts.mjs queue-stalled\`) has failed ${state.failures} times in a row${state.since ? `, the first at ${state.since}` : ''}.`,
    'While it fails, `[alert] merge queue stalled` cannot open, so a stalled queue goes unannounced.',
    '',
    'Failed checks (newest last):',
    runs,
    '',
    'Read the newest run\'s `queue-stalled` step log. This alert does not close land-pr gate 7 or the feeder breaker; it closes by itself at the next successful check (D7125-p2).',
  ].join('\n');
}

/** The one Slack line for an open or a close: this run's link and the issue GitHub returned, never a cached value. */
export function checkerSlackText(action, { issueUrl = null, runUrl = null } = {}) {
  const issue = issueUrl ? ` <${issueUrl}|issue>` : '';
  const run = runUrl ? ` <${runUrl}|run>` : '';
  if (action === 'close') return `:white_check_mark: *Merge queue stall check recovered.*${run}${issue} Closing the alert.`;
  return `:warning: *The merge queue stall check has failed ${FAILURES_TO_OPEN} or more times in a row.*${run}${issue}\nUntil it passes, a stalled queue opens no alert. The issue lists the runs (D7125-p2).`;
}
