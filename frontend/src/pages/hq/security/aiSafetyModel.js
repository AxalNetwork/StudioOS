/**
 * D4803 (#4803, canvas SE08 AI Safety, SE11f phone) — the three AI Safety
 * blocks from `/overview`'s `ai_safety`: content safety, delivery enforcement
 * and usage anomalies, each as "x of n" with its own state. Pure, for the tests.
 *
 * ALWAYS "x OF n", NEVER A BARE RATE. Two safe verdicts out of two is not
 * "100% safe"; below SMALL_SAMPLE the block says it is a small sample and not
 * a rate. Each block reads its own source and its own availability, so one
 * unreadable table never zeroes the others.
 */

/** Below this many evaluated outputs the fraction is a count, not a rate (D4800 uses the same line). */
export const SMALL_SAMPLE = 20;

const sum = (rows, k) => (rows || []).reduce((n, r) => n + (Number(r?.[k]) || 0), 0);

/** Content safety: the guard's verdicts on evaluated outputs. */
export function contentSafety(block) {
  const v = block?.verdicts;
  if (!block) return { state: 'pending' };
  if (block.available === false || !v || v.available === false) {
    return { state: 'unavailable', reason: (v && v.reason) || block.reason || 'The guard verdicts could not be read.' };
  }
  const evaluated = Number(v.evaluated) || 0;
  const unsafe = Number(v.unsafe_count) || 0;
  const safe = Number(v.safe_count) || 0;
  const rules = block.enforcement?.available ? (block.enforcement.rules || []) : null;
  return {
    // An unsafe verdict is a historical check, not an open incident (D4800): Unknown, never Healthy.
    state: evaluated === 0 ? 'no_data_yet' : unsafe > 0 ? 'unknown' : 'healthy',
    x: safe,
    n: evaluated,
    unsafe,
    small: evaluated > 0 && evaluated < SMALL_SAMPLE,
    windowDays: block.window_days,
    noVerdict: v.no_verdict_count === null || v.no_verdict_count === undefined ? null : Number(v.no_verdict_count),
    rules,
  };
}

/**
 * Delivery enforcement: what the router guard stopped, against the checks it
 * ran. `guard.by_page` is the router's own count (D4522); the legacy chat audit
 * (`enforcement`) is reported apart, because it is a different table.
 */
export function deliveryEnforcement(block) {
  if (!block) return { state: 'pending' };
  const g = block.guard;
  if (block.available === false || !g || g.available === false) {
    return { state: 'unavailable', reason: (g && g.reason) || block.reason || 'Router enforcement could not be read.' };
  }
  const checks = sum(g.by_page, 'checks');
  const blocked = sum(g.by_page, 'blocked_input');
  const withheld = sum(g.by_page, 'withheld_output');
  const e = block.enforcement;
  return {
    state: checks === 0 ? 'no_data_yet' : blocked + withheld === 0 ? 'measured_zero' : 'healthy',
    label: checks === 0 ? 'No checks yet' : blocked + withheld === 0 ? 'None' : `${blocked + withheld} enforced`,
    checks,
    blocked,
    withheld,
    unavailableGuard: sum(g.by_page, 'unavailable'),
    legacy: e?.available ? { blocked: Number(e.blocked) || 0, flagged: Number(e.flagged) || 0 } : null,
  };
}

/** Usage anomalies: accounts over the threshold, against the accounts checked. */
export function usageAnomalies(block) {
  const t = block?.token_anomalies;
  if (!block || !t) return { state: block ? 'unavailable' : 'pending', reason: block ? 'The token check did not answer.' : null };
  if (t.available === false) return { state: 'unavailable', reason: t.reason };
  const count = Number(t.count) || 0;
  const checked = Number(t.accounts_checked) || 0;
  return {
    state: count > 0 ? 'action_required' : checked === 0 ? 'no_data_yet' : 'measured_zero',
    label: count > 0 ? `${count} flagged` : checked === 0 ? 'No accounts to check' : 'None flagged',
    x: count,
    n: checked,
    multiple: t.multiple,
    baselineDays: t.baseline_days,
    windowHours: t.window_hours,
    how: t.how || null,
    rows: t.rows || [],
  };
}

const DELIVERY_WORDS = Object.freeze({
  delivered: 'Delivered',
  blocked_input: 'Blocked before the model',
  withheld_output: 'Withheld from the user',
  guard_unavailable: 'Guard unavailable',
  unknown: 'Not recorded',
});
const VERDICT_STATE = Object.freeze({
  safe: { state: 'healthy', word: 'Safe' },
  unsafe: { state: 'unknown', word: 'Unsafe' },
  no_verdict: { state: 'unknown', word: 'No verdict' },
});

/** The recent verdicts table's rows, in words; `null` rows when unreadable. */
export function recentVerdicts(block) {
  const r = block?.recent_verdicts;
  if (!block || !r) return { state: 'pending', rows: null };
  if (r.available === false) return { state: 'unavailable', reason: r.reason, rows: null };
  return {
    state: r.rows.length ? 'ready' : 'empty',
    windowDays: r.window_days,
    rows: r.rows.map((x) => ({
      at: x.at,
      feature: x.page || 'Not recorded',
      verdict: VERDICT_STATE[x.verdict] || VERDICT_STATE.no_verdict,
      delivery: DELIVERY_WORDS[x.delivery] || DELIVERY_WORDS.unknown,
    })),
  };
}

/** "6 Nov 15:02" in UTC, or null. */
export function shortWhen(at) {
  if (!at) return null;
  const s = String(at);
  const t = Date.parse(s.includes('T') ? s : `${s.replace(' ', 'T')}Z`);
  if (!Number.isFinite(t)) return null;
  const d = new Date(t);
  return `${d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })} ${d.toISOString().slice(11, 16)}`;
}
