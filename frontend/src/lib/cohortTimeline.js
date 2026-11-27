/**
 * Reading `GET /api/admin/cohort/timeline` — shared by the two branch pages
 * that draw the cohort calendar (S4 Programs) and its week gates (S15
 * Analytics, D210).
 *
 * LIFTED OUT OF `pages/branch/BranchPrograms.jsx`, WHERE THE FIRST TWO WERE
 * WRITTEN, when S15 became their second caller: importing one page's export
 * from another page is worse than a shared module, and this folder's README
 * states the rule (a helper in two places goes here once, rather than a third
 * time). The two lifted functions are unchanged, and the test that pinned them
 * (`branch_programs_s4.test.mjs`) re-points its import with its assertions
 * untouched — which is what proves the move is a move.
 */
import { toUtcInstant } from './notices';

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/**
 * A cycle's human name. `month` is 1-based in `cohort_cycles`.
 *
 * THE EMPTY VALUES ARE REJECTED BEFORE THE NUMERIC CHECK, and that ordering is
 * the whole guard: `Number(null)` is `0` and `Number('')` is `0`, both finite,
 * so a `Number.isFinite` test alone lets a missing year through and the page
 * renders "October null". Caught by its own test before it shipped.
 */
export function cycleLabel(year, month) {
  if (year === null || year === undefined || year === '') return null;
  const y = Number(year);
  const m = Number(month);
  if (!Number.isFinite(y) || !Number.isInteger(m)) return null;
  const name = MONTHS[m - 1];
  if (!name) return null;
  return `${name} ${y}`;
}

/**
 * The per-week status counts, folded from the payload's flat rows.
 *
 * `status_counts` arrives as `[{week_number, status, n}]` — one row per
 * (week, status) pair — and a week with no rows at all is a week nobody has
 * been judged in, which is different from a week where everyone passed. The
 * map therefore has no entry for that week rather than an object of zeroes.
 *
 * A COUNT THAT IS NOT A COUNT IS `null`, NEVER 0 (D211). D210 wrote
 * `Number(r.n) || 0`, so a row whose `n` arrived unreadable became "0 failed"
 * — a week gate claiming nobody failed on the strength of a value nobody
 * could read. `tallyReadable` is how a reader asks.
 */
export function statusesByWeek(rows) {
  const out = new Map();
  for (const r of rows || []) {
    const wk = Number(r.week_number);
    if (!Number.isFinite(wk)) continue;
    const bucket = out.get(wk) || {};
    const n = r.n === null || r.n === undefined || r.n === '' ? Number.NaN : Number(r.n);
    bucket[String(r.status)] = Number.isInteger(n) && n >= 0 ? n : null;
    out.set(wk, bucket);
  }
  return out;
}

/** Whether every count in one week's tally could be read. */
export function tallyReadable(tally) {
  return Object.values(tally || {}).every((n) => n !== null);
}

/** An instant the server sent, in milliseconds, or NaN. Both stamp formats the store writes are read. */
function instantMs(v) {
  const norm = toUtcInstant(v);
  return norm ? new Date(norm).getTime() : Number.NaN;
}

/**
 * The cycle a "this cohort" card reads: the newest cycle that has started by
 * the SERVER's clock.
 *
 * The timeline lists cycles newest first, and the newest is usually next
 * month's, materialised ahead of time and not yet begun. Reading its gates
 * would show four weeks "not yet due" for a cohort nobody is in. The server's
 * `server_time` decides rather than this browser's clock, so a laptop with a
 * wrong clock cannot pick a different cohort from the one the server judges.
 */
export function currentCycle(cycles, serverTime) {
  const now = instantMs(serverTime);
  if (!Number.isFinite(now)) return null;
  for (const c of cycles || []) {
    const start = instantMs(c?.start_at);
    if (Number.isFinite(start) && start <= now) return c;
  }
  return null;
}

/**
 * Whether a cycle has ended by the server's clock — `null` when its end or the
 * clock cannot be read.
 *
 * `currentCycle` returns the newest cycle that has STARTED, which is the right
 * cycle to gate even after it finishes; what it cannot say is whether that
 * cycle is still running. D210's card called it "the cycle under way" either
 * way (D211), so a cohort that ended last week read as live.
 */
export function cycleEnded(cycle, serverTime) {
  const now = instantMs(serverTime);
  const end = instantMs(cycle?.end_at);
  if (!Number.isFinite(now) || !Number.isFinite(end)) return null;
  return end <= now;
}

/** The four statuses `company_week_status` writes, in the order a card prints them. */
export const WEEK_STATUSES = ['passed', 'failed', 'grace', 'pending'];

/**
 * One week gate, against the server's clock.
 *
 *   not_yet_due  its deadline has not come. The canvas's own note says why this
 *                is not a zero: a cohort in its third week would otherwise read
 *                as twelve failures in week four;
 *   no_outcome   the deadline passed and nobody has a status for the week —
 *                nothing was judged, which is not everyone passing;
 *   counted      the statuses as the store holds them;
 *   unreadable   the deadline or the server's clock could not be read
 *                (`what: 'deadline'`), or the deadline has passed and a count
 *                in the tally could not be (`what: 'tally'`) — which is not a
 *                week with no outcome, and never "0 failed".
 *
 * COUNTS, NEVER A RATE. The timeline's `participant_count` is the accounts
 * active in the Lab NOW that started inside the cycle, so a rate over it would
 * divide this week's outcomes by today's membership.
 */
export function weekOutcome(window, tally, serverTime) {
  const now = instantMs(serverTime);
  const deadline = instantMs(window?.deadline_at);
  if (!Number.isFinite(now) || !Number.isFinite(deadline)) return { state: 'unreadable', what: 'deadline' };
  if (deadline > now) return { state: 'not_yet_due', deadline_at: window.deadline_at };
  const entries = Object.entries(tally || {});
  if (!entries.length) return { state: 'no_outcome' };
  if (!tallyReadable(tally)) return { state: 'unreadable', what: 'tally' };
  const counts = {};
  for (const s of WEEK_STATUSES) counts[s] = tally[s] ?? null;
  const other = entries.filter(([k]) => !WEEK_STATUSES.includes(k));
  return { state: 'counted', counts, ...(other.length ? { other: Object.fromEntries(other) } : {}) };
}
