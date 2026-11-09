/**
 * GitHub health alerts for a Slack channel: the pure half. The CLI that does
 * the effects (GitHub API, Slack webhook) is `../github-alerts.mjs`.
 *
 * Three conditions, each found on 2026-11-09:
 *   - `main-red`      CI on a push to main failed (D5052 and D5039 broke every
 *                     PR at once, and three sessions opened duplicate fixes);
 *   - `review-blocked` the advisory reviewer called no model (budget_refused or
 *                     configuration_error), while its check still read green;
 *   - `queue`         the Actions queue backed up (dozens of PRs x 22 jobs).
 * Plus `future-clock`: the nightly run of the suites with the clock moved
 * ahead, which catches a date-bound test before its date arrives.
 *
 * STATE IS ONE ISSUE PER CONDITION, titled `[alert] <kind>`. The channel hears
 * only transitions: an alert opens the issue and posts once; repeats post
 * nothing; recovery closes it and posts once. So a red main for six hours is
 * two messages, and everyone has one place to look instead of opening fixes.
 */

export const ALERT_KINDS = Object.freeze({
  'main-red': { title: '[alert] main is red', label: 'main CI' },
  'review-blocked': { title: '[alert] the PR reviewer is not reviewing', label: 'PR reviewer' },
  queue: { title: '[alert] the Actions queue is backed up', label: 'Actions queue' },
});

/** Reviewer outcomes that mean no model was called because of setup, not because of the PR. */
export const REVIEW_BLOCKED_OUTCOMES = Object.freeze(['budget_refused', 'configuration_error']);
/** Reviewer outcomes that prove the reviewer works: a model answered, or this exact diff was already reviewed. */
export const REVIEW_OK_OUTCOMES = Object.freeze(['reviewed', 'duplicate']);

export const QUEUE_DEFAULTS = Object.freeze({ queued: 40, oldestMinutes: 45 });

/**
 * What to do given whether the condition holds now and whether its issue is
 * open: `open` (post the alert), `close` (post recovery), or `none`.
 * `active === null` means "unknown" (e.g. a run that was cancelled): never a transition.
 */
export function transition(active, issueOpen) {
  if (active === null || active === undefined) return 'none';
  if (active && !issueOpen) return 'open';
  if (!active && issueOpen) return 'close';
  return 'none';
}

/** Whether a CI run on main is red, green, or says nothing (cancelled, skipped). */
export function mainState(conclusion) {
  if (conclusion === 'failure' || conclusion === 'timed_out') return true;
  if (conclusion === 'success') return false;
  return null;
}

/** Whether the reviewer's outcome means blocked, working, or says nothing (skipped, empty diff). */
export function reviewState(outcome) {
  const o = String(outcome || '').trim();
  if (REVIEW_BLOCKED_OUTCOMES.includes(o)) return true;
  if (REVIEW_OK_OUTCOMES.includes(o)) return false;
  return null;
}

/**
 * The queue from the Actions API's queued runs: how many, and how long the
 * oldest has waited. Backed up when either is over its threshold.
 */
export function queueState({ queued, oldestCreatedAt, now = Date.now(), thresholds = QUEUE_DEFAULTS }) {
  const t = Date.parse(oldestCreatedAt || '');
  const waitedMin = Number.isFinite(t) ? Math.max(0, Math.round((now - t) / 60_000)) : 0;
  const count = Number(queued) || 0;
  return {
    active: count >= thresholds.queued || waitedMin >= thresholds.oldestMinutes,
    queued: count,
    waitedMin,
  };
}

/** The failing test names in TAP output (`not ok N - name`), de-duplicated, at most `max`. */
export function failingTests(tap, max = 15) {
  const out = [];
  for (const line of String(tap || '').split('\n')) {
    const m = /^\s*not ok \d+ - (.+?)\s*(?:#.*)?$/.exec(line);
    if (m && !/^[\w./-]+\.test\.(m?js|ts)$/.test(m[1]) && !out.includes(m[1])) out.push(m[1]);
  }
  return { names: out.slice(0, max), more: Math.max(0, out.length - max) };
}

/** Slack text for a transition. Plain mrkdwn; links are passed in, never built from user text. */
export function message(kind, action, facts = {}) {
  const k = ALERT_KINDS[kind];
  const issue = facts.issueUrl ? ` <${facts.issueUrl}|issue>` : '';
  const run = facts.runUrl ? ` <${facts.runUrl}|run>` : '';
  if (action === 'close') return `:white_check_mark: *${k.label} recovered.*${run}${issue} Closing the alert.`;
  if (kind === 'main-red') {
    return `:red_circle: *main is red.* CI failed on \`${String(facts.sha || '').slice(0, 8)}\`${facts.title ? ` (${facts.title})` : ''}.${run}${issue}\nEvery PR that merges main will fail the same way until it is fixed. One fix, on the issue; please don't open duplicates.`;
  }
  if (kind === 'review-blocked') {
    return `:warning: *The PR reviewer called no model* (\`${facts.outcome}\`)${facts.pr ? ` on #${facts.pr}` : ''}.${run}${issue}\nIts check still passes, so PRs are going unreviewed. The step summary says why (often the monthly budget: \`CLAUDE_REVIEW_MONTHLY_BUDGET_USD\`).`;
  }
  if (kind === 'queue') {
    return `:hourglass: *The Actions queue is backed up:* ${facts.queued} runs queued, the oldest waiting ${facts.waitedMin} min.${issue}\nCI results will be slow; avoid mass branch updates until it drains.`;
  }
  return '';
}

/** Slack text for the nightly future-clock run: what fails once the clock is `days` ahead. */
export function futureClockMessage({ days, failures, runUrl }) {
  if (!failures.names.length) return '';
  const list = failures.names.map((n) => `• ${n}`).join('\n');
  const more = failures.more ? `\n…and ${failures.more} more` : '';
  return `:alarm_clock: *${failures.names.length + failures.more} test(s) fail with the clock ${days} days ahead* — they will break every PR when that date comes.${runUrl ? ` <${runUrl}|run>` : ''}\n${list}${more}\nFreeze the clock in the test (\`t.mock.timers.enable({ apis: ['Date'], now })\`) or pass \`nowMs\` into the component.`;
}
