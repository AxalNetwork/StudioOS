/**
 * Reading a metric target against a snapshot — the judgement, not the chrome.
 *
 * `metric_targets` shipped in migration 173 and had no reader and no writer
 * anywhere in the worker or the SPA for twenty-one migrations, which is the
 * orphan-table shape migration 215's header names by example. Task #194 gave it
 * both ends; this module is the half that decides what a stored target MEANS
 * beside a stored snapshot.
 *
 * WHY IT IS NOT IN THE PAGE. It was, and the page imports two stylesheets, so
 * nothing could run it — `frontend/test/_deck-loader.mjs` cannot resolve `.css`
 * and the import failed before a single assertion. A judgement this load-bearing
 * has to be testable by running it rather than by grepping the file that draws
 * it, and the two decisions below are exactly the kind a source-text assertion
 * cannot check.
 *
 * WHAT THE ROUTE OWNS INSTEAD. Which keys may carry a target, and which
 * direction each defaults to, belong to `progress.ts` — it returns them as
 * `keys` on the read so a picker cannot offer an option the write refuses.
 * Nothing here duplicates that list: a key with no label below renders as itself
 * rather than disappearing, because a target a founder set must never become
 * invisible for want of a word.
 */

/** How each metric is spelled for a reader. Copy, not contract. */
export const METRIC_LABELS = {
  mrr: 'MRR',
  arr: 'ARR',
  active_users: 'Active users',
  new_users: 'New users',
  paying_accounts: 'Paying accounts',
  ltv: 'LTV',
  nrr_pct: 'Net revenue retention',
  headcount: 'Headcount',
  cash_balance: 'Cash',
  cac: 'CAC',
  monthly_churn_pct: 'Monthly churn',
  net_burn: 'Net burn',
};

export const metricLabel = (key) => METRIC_LABELS[key] || String(key || '');

/** Percentages and headcounts are not dollars, and printing them as dollars lies. */
export const PCT_KEYS = new Set(['monthly_churn_pct', 'nrr_pct']);
export const COUNT_KEYS = new Set(['active_users', 'new_users', 'paying_accounts', 'headcount']);

/**
 * Read one target against the latest snapshot — and say nothing when it cannot.
 *
 * `direction` IS THE WHOLE REASON THIS IS NOT A `>=`. Migration 173 stores it
 * for one stated purpose: without it "the UI cannot tell whether being over the
 * number is good news, and would colour a burn overage green". On `'up'` the
 * target is met at or above the number; on `'down'` at or below it. Exactly on
 * plan is met either way — a plan hit is not a plan missed.
 *
 * `met: null` WHERE THE SNAPSHOT IS SILENT, and it must not be `false`. "Behind
 * the plan" and "nothing recorded to compare" are different facts, and a `false`
 * here would report every unmeasured metric as a miss — absent read as empty,
 * which is the failure `zoneFilterBuilder.js` opens its own docblock with.
 *
 * ZERO IS MEASURED. A churn of 0% against a target of 0% is met, so the test is
 * for a finite number rather than for truthiness; `!actual` would hide the one
 * month the plan was actually hit.
 */
export function readTarget(target, latest) {
  const actual = latest?.[target.metric_key];
  if (actual == null || actual === '' || !Number.isFinite(Number(actual))) {
    return { ...target, actual: null, met: null };
  }
  const value = Number(actual);
  return {
    ...target,
    actual: value,
    met: target.direction === 'down' ? value <= target.target_value : value >= target.target_value,
  };
}
