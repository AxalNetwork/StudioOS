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

import { infraFingerprint } from './ciClassify.mjs';
import { SCAN_ALERT_TITLE } from './scanScope.mjs';

export const ALERT_KINDS = Object.freeze({
  'main-red': { title: '[alert] main is red', label: 'main CI' },
  'review-blocked': { title: '[alert] the PR reviewer is not reviewing', label: 'PR reviewer' },
  queue: { title: '[alert] the Actions queue is backed up', label: 'Actions queue' },
  'queue-stalled': { title: '[alert] merge queue stalled', label: 'Merge queue' },
  scan: { title: SCAN_ALERT_TITLE, label: 'Main scan' },
  // D5398: the nightly future-clock run is stateful too. It used to post on every failing night and keep no issue,
  // so a date-bound test was announced again each night and nothing said when it was fixed.
  'future-clock': { title: '[alert] future-clock tests failing', label: 'Future-clock tests' },
});

/** Newest completed run first. Only a green run clears an existing stall. */
export function queueStallState(runs) {
  const [latest, previous] = (runs || []).filter(r => r.event === 'merge_group' && r.status === 'completed')
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
  if (latest?.conclusion === 'success') return { active: false, fingerprint: null };
  const fingerprint = latest?.conclusion === 'failure' ? infraFingerprint(latest.jobs) : null;
  if (fingerprint && previous?.conclusion === 'failure' && latest.head_sha && previous.head_sha
      && latest.head_sha !== previous.head_sha && fingerprint === infraFingerprint(previous.jobs)) {
    return { active: true, fingerprint };
  }
  return { active: null, fingerprint: null };
}

/** Reviewer outcomes that mean no model was called because of setup, not because of the PR. */
export const REVIEW_BLOCKED_OUTCOMES = Object.freeze(['budget_refused', 'configuration_error']);
/** Reviewer outcomes that prove the reviewer works: a model answered, or this exact diff was already reviewed. */
export const REVIEW_OK_OUTCOMES = Object.freeze(['reviewed', 'duplicate']);

export const QUEUE_DEFAULTS = Object.freeze({ queued: 40, oldestMinutes: 45 });
/**
 * D5398: hysteresis. An open queue alert clears only once both figures are below this share of their thresholds, so
 * a queue hovering at the line does not open and close the alert (and post to the channel) every hour.
 */
export const QUEUE_CLEAR_RATIO = 0.5;

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
export function queueState({ queued, oldestCreatedAt, now = Date.now(), thresholds = QUEUE_DEFAULTS, issueOpen = false }) {
  const t = Date.parse(oldestCreatedAt || '');
  const waitedMin = Number.isFinite(t) ? Math.max(0, Math.round((now - t) / 60_000)) : 0;
  const count = Number(queued) || 0;
  // D5398: open at the thresholds; once open, stay open until both are under QUEUE_CLEAR_RATIO of them.
  const k = issueOpen ? QUEUE_CLEAR_RATIO : 1;
  return {
    active: count >= thresholds.queued * k || waitedMin >= thresholds.oldestMinutes * k,
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
    return `:red_circle: *main is red.* CI failed on \`${String(facts.sha || '').slice(0, 8)}\`${facts.title ? ` (${facts.title})` : ''}.${run}${issue}\nEvery PR inherits it until main is fixed. One repair PR, linked on the issue. Don't port it, merge main into open PRs or re-run for it (AGENTS.md, D5398).`;
  }
  if (kind === 'review-blocked') {
    return `:warning: *The PR reviewer called no model* (\`${facts.outcome}\`)${facts.pr ? ` on #${facts.pr}` : ''}.${run}${issue}\nIts check still passes, so PRs are going unreviewed. The step summary says why (often the monthly budget: \`CLAUDE_REVIEW_MONTHLY_BUDGET_USD\`).`;
  }
  if (kind === 'queue') {
    return `:hourglass: *The Actions queue is backed up:* ${facts.queued} runs queued, the oldest waiting ${facts.waitedMin} min.${issue}\nCI results will be slow. Until it drains: no branch updates, no bulk re-runs, no ports of a main fix (AGENTS.md, D5398).`;
  }
  if (kind === 'queue-stalled') {
    return `:warning: *Merge queue stalled.* Two different queue commits failed during ${facts.fingerprint}.${run}${issue}\nPause new queue entries until a queue CI run passes (D5604).`;
  }
  if (kind === 'scan') return `New unsuppressed scan fingerprints on main.${run}`;
  if (kind === 'future-clock') {
    const text = Number.isSafeInteger(facts.failedCount) ? `:alarm_clock: *${facts.failedCount} verified test failures with the clock ${facts.days} days ahead.*${run}` : facts.failures?.names?.length ? futureClockMessage(facts) : `:alarm_clock: *Tests fail with the clock moved ahead.*${run}`;
    return `${text}${issue}`;
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
