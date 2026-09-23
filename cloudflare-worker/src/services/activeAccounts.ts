/**
 * What an "active account" is, stated once for both tiers (D210 — H15 + S15).
 *
 * TWO SCREENS DRAW THIS NUMBER FROM TWO STORES, SO THE DEFINITION HAS TO BE
 * ONE THING. HQ's Analytics page reads Analytics Engine, the dataset every
 * Worker writes one row to per metered request; a branch's Analytics page reads
 * its own `activity_logs`, which the same middleware writes on the same
 * request. If the two used different notions of "active", HQ's line for a
 * branch and the branch's own line would disagree, and nothing on either
 * screen could say why. So:
 *
 *   · `activityLogged()` IS the rule `middleware/observability.ts` uses to
 *     decide whether a request writes an `activity_logs` row. The skip list
 *     moved here from that file, and the middleware imports it — there is no
 *     second copy to drift.
 *   · `aeLoggedRequestPredicate()` is the SAME rule written as an Analytics
 *     Engine WHERE clause, built from the same list, so an Analytics Engine row
 *     is counted exactly when the request behind it would have written a log
 *     row. A test holds the two to each other path by path.
 *
 * WHAT THE COUNT IS: distinct signed-in accounts with at least one such request
 * in a Monday-to-Sunday UTC week. Anonymous requests are read (they show when a
 * store's history begins) and never counted.
 *
 * IN `services/`, NOT `util/`: it knows what a request log, an account and a
 * branch are (`util/README.md`'s line). `okrWeeks.ts` is where the Monday
 * arithmetic already lives, and it is reused rather than restated.
 */
import type { Env } from '../types';
import { weekStartOf, recentWeeks } from './okrWeeks';

/**
 * Requests that never write an `activity_logs` row. Moved verbatim from
 * `middleware/observability.ts`, which now imports it.
 */
export const SKIP_ACTIVITY_LOG_PATHS: readonly string[] = [
  '/api/health',
  '/api/activity',                 // listing your own activity shouldn't write activity
  '/api/monitoring/',              // monitoring polls would create infinite churn
  '/api/dashboard/stats',
];

/**
 * Whether a request writes an `activity_logs` row: an `/api/` path, not on the
 * skip list, and not refused for rate. The 429 rule lives here too, because a
 * request the limiter refused was not the account doing anything.
 */
export function activityLogged(path: string, status: number): boolean {
  return path.startsWith('/api/')
    && !SKIP_ACTIVITY_LOG_PATHS.some((p) => path === p || path.startsWith(p))
    && status !== 429;
}

/**
 * The sentence both Analytics pages print under the figure. One string, so the
 * two tiers cannot describe the same number two ways.
 */
export const ACTIVE_ACCOUNT_BASIS =
  'An active account is a signed-in account that made at least one request the platform logs '
  + 'as activity during the week: every /api/ request except health checks, monitoring polls, '
  + 'reads of the activity feed and the dashboard counter, and requests refused for rate. Weeks '
  + 'run Monday to Sunday in UTC.';

/**
 * A skip path may only hold characters that mean nothing inside a LIKE pattern.
 *
 * `_` and `%` are LIKE wildcards: a path containing either would silently match
 * more than it names. Neither appears today, and the day one is added the
 * predicate refuses to build rather than guessing at an escape syntax the
 * Analytics Engine documentation does not state.
 */
const SKIP_PATH_SHAPE = /^\/api\/[a-z0-9/.-]*$/;

/**
 * `activityLogged()` as an Analytics Engine WHERE clause, over the row
 * `observability.ts` writes: blob1 the path, double2 the status.
 *
 * ONLY CONSTRUCTS THE DOCUMENTATION SHOWS. `LIKE` and `NOT LIKE` are documented
 * pattern operators; `!=` could not be confirmed from here, so "not 429" is
 * written as `< 429 OR > 429`. The AE SQL API takes `text/plain` with no
 * binding mechanism, so every value is interpolated — which is safe here only
 * because every value is a constant from this file, checked against the shape
 * above.
 *
 * `blob1 LIKE '/api/%'` also excludes the audit mirror's rows (D163), whose
 * blob1 is a sentinel that does not start with a slash.
 */
export function aeLoggedRequestPredicate(): string {
  const clauses = ["blob1 LIKE '/api/%'"];
  for (const p of SKIP_ACTIVITY_LOG_PATHS) {
    if (!SKIP_PATH_SHAPE.test(p)) {
      throw new Error(`skip path ${JSON.stringify(p)} carries a character LIKE would read as a wildcard`);
    }
    clauses.push(`blob1 NOT LIKE '${p}%'`);
  }
  clauses.push('(double2 < 429 OR double2 > 429)');
  return clauses.join(' AND ');
}

/** The three ranges H15 and S15 draw, in weeks. */
export const ANALYTICS_RANGES = { '8w': 8, quarter: 13, year: 52 } as const;
export type AnalyticsRange = keyof typeof ANALYTICS_RANGES;

/**
 * `?range=` → a known range. Absent means the default the canvases select;
 * anything else is `null`, which the routes answer with a 400 rather than
 * quietly drawing eight weeks under a label that asked for a year.
 */
export function parseAnalyticsRange(q: string | null | undefined): AnalyticsRange | null {
  if (q == null || q === '') return '8w';
  return Object.prototype.hasOwnProperty.call(ANALYTICS_RANGES, q) ? (q as AnalyticsRange) : null;
}

export type WeekAxis = {
  /** Mondays, oldest first; the last is the current, unfinished week. */
  weeks: string[];
  /** Inclusive lower bound, `YYYY-MM-DD HH:MM:SS` UTC. */
  from: string;
  /** Exclusive upper bound: the Monday after the current week. */
  to: string;
  current: string;
  /** The newest week that has ended — what a headline figure reads. */
  last_complete: string;
};

function addDays(day: string, n: number): string {
  const [y, m, d] = day.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d) + n * 86400000);
  const pad = (x: number) => String(x).padStart(2, '0');
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

/**
 * The weeks a chart draws, ending with the one `nowIso` falls in.
 *
 * THE BOUNDS ARE IN SQLITE'S OWN FORMAT, `YYYY-MM-DD HH:MM:SS`, never an ISO
 * string: `activity_logs.created_at` defaults to `datetime('now')`, and an ISO
 * bind against it drops every row dated on the bound's own day (D160, D162).
 * The same strings are what `toDateTime()` takes in Analytics Engine SQL.
 */
export function weekAxis(nowIso: string, n: number): WeekAxis {
  const newestFirst = recentWeeks(nowIso, n);
  if (newestFirst.length !== n || n < 2) throw new Error(`cannot build ${n} weeks from ${nowIso}`);
  const weeks = [...newestFirst].reverse();
  const current = weeks[weeks.length - 1];
  return {
    weeks,
    from: `${weeks[0]} 00:00:00`,
    to: `${addDays(current, 7)} 00:00:00`,
    current,
    last_complete: weeks[weeks.length - 2],
  };
}

/** One row of the Analytics Engine read: one account (or `0`), one branch, one day. */
export type AeActiveRow = {
  day?: unknown; branch?: unknown; uid?: unknown; n?: unknown; weight?: unknown;
};

export type ActiveFold = {
  /** branch → week → the accounts active in it. */
  byBranch: Map<string, Map<string, Set<string>>>;
  /** branch → its earliest day with ANY logged request, anonymous included. */
  firstDay: Map<string, string>;
  /** The earliest day in the whole read — where the store's history begins, as far as it shows. */
  floorDay: string | null;
  /** True when any row stood for more than one request (Analytics Engine sampled). */
  sampled: boolean;
};

/**
 * Daily rows → distinct accounts per branch per week.
 *
 * WHY DAILY AND NOT WEEKLY IN SQL. Analytics Engine documents `toStartOfWeek()`
 * but not which day it starts a week on, and a Sunday-anchored week would put
 * every Sunday in the wrong bucket with nothing raised anywhere. `toStartOfDay()`
 * is unambiguous, and the Monday comes from `weekStartOf()`, the same function
 * the branch's own count uses. Distinctness is taken here too: a count of
 * distinct accounts is not documented either, so the query returns one row per
 * account per day and this folds them into sets.
 *
 * A DAY THIS CANNOT PARSE REFUSES THE WHOLE READ. Skipping the row would draw
 * a plausible chart with a hole nobody could see; returning `null` lets the
 * caller say the store answered in a shape the reader does not understand.
 */
export function foldDailyActives(rows: readonly AeActiveRow[], axis: WeekAxis): ActiveFold | null {
  const inAxis = new Set(axis.weeks);
  const byBranch = new Map<string, Map<string, Set<string>>>();
  const firstDay = new Map<string, string>();
  let floorDay: string | null = null;
  let sampled = false;
  for (const r of rows) {
    const m = /^(\d{4}-\d{2}-\d{2})/.exec(String(r.day ?? ''));
    const week = m ? weekStartOf(m[1]) : null;
    if (!m || !week) return null;
    if (!inAxis.has(week)) continue;
    const day = m[1];
    const branch = String(r.branch ?? '').trim() || 'hq';
    const n = Number(r.n);
    const w = Number(r.weight);
    if (Number.isFinite(n) && Number.isFinite(w) && w > n) sampled = true;
    if (floorDay === null || day < floorDay) floorDay = day;
    const seen = firstDay.get(branch);
    if (seen === undefined || day < seen) firstDay.set(branch, day);
    // Anonymous requests carry `0`: they date the history, they are nobody.
    const uid = Number(r.uid);
    if (!Number.isFinite(uid) || uid <= 0) continue;
    let weeks = byBranch.get(branch);
    if (!weeks) byBranch.set(branch, (weeks = new Map()));
    let set = weeks.get(week);
    if (!set) weeks.set(week, (set = new Set()));
    set.add(String(Math.trunc(uid)));
  }
  return { byBranch, firstDay, floorDay, sampled };
}

/** Why a week has no value. One reason per series, in the order they bite. */
export type GapReason = 'cap' | 'before_store' | 'no_rows' | 'before_series';

/**
 * The sentence a page prints for each gap. Server-side, so the two Analytics
 * pages cannot give two reasons for one absence (D131's rule).
 */
export const GAP_SENTENCES: Record<GapReason, string> = {
  cap:
    'The read stopped at its row cap before reaching these weeks, so they are left blank rather '
    + 'than drawn short.',
  before_store:
    'The metrics store holds nothing in this range older than its first row, so the weeks before '
    + 'it are left blank: a count there would be a floor shown as a figure.',
  no_rows: 'Nothing from this series was recorded in the range.',
  before_series: 'The weeks before this series\' first recorded request are left blank, not zero.',
};

/**
 * One branch's line, and why any point on it is missing.
 *
 * A MISSING POINT IS NEVER A ZERO. Four things can leave a week without a
 * value, and each is a different claim:
 *
 *   cap           the read stopped at its row cap before reaching this week;
 *   before_store  the store's earliest row in the window falls after this week
 *                 began — the week may start before what the store keeps, so a
 *                 count would be a floor presented as a figure;
 *   no_rows       nothing from this branch was recorded in the window at all;
 *   before_series this branch's first recorded request is later than this week.
 *
 * AFTER THE BRANCH'S FIRST RECORDED REQUEST, A WEEK WITH NOBODY IN IT IS A
 * MEASURED ZERO. The store holds that branch's history from that day on, and
 * rows expire oldest-first, so a newer week with no signed-in account in it had
 * none — it is not a gap.
 */
export function seriesValues(
  fold: ActiveFold, axis: WeekAxis, code: string, capDay: string | null,
): { values: Array<number | null>; gap: GapReason | null; first_day: string | null } {
  const capWeek = capDay ? weekStartOf(capDay) : null;
  const windowStart = axis.weeks[0];
  const storeWeek = fold.floorDay && fold.floorDay > windowStart ? weekStartOf(fold.floorDay) : null;
  const first = fold.firstDay.get(code) ?? null;
  const firstWeek = first ? weekStartOf(first) : null;
  const weeks = fold.byBranch.get(code);
  let gap: GapReason | null = null;
  const values = axis.weeks.map((w) => {
    if (capWeek && w <= capWeek) { gap = gap ?? 'cap'; return null; }
    if (storeWeek && w <= storeWeek) { gap = gap ?? 'before_store'; return null; }
    if (!firstWeek) { gap = gap ?? 'no_rows'; return null; }
    if (w < firstWeek) { gap = gap ?? 'before_series'; return null; }
    return weeks?.get(w)?.size ?? 0;
  });
  return { values, gap, first_day: first };
}

export type WeeklyKpi = {
  /** The last complete week — the current one has not ended. */
  week: string;
  value: number | null;
  /** Series with a value that week, of all drawn. */
  counted: number;
  total: number;
  compare_week: string | null;
  delta: number | null;
  reason?: string;
  delta_reason?: string;
};

/**
 * The headline: the last complete week, summed over the series that have it,
 * and the change against four weeks earlier.
 *
 * THE DELTA IS ONLY DRAWN WHEN BOTH WEEKS SUM THE SAME SERIES. A branch that
 * has a value now and none four weeks ago would otherwise arrive as growth; a
 * branch that dropped out would arrive as a decline. Either is a change in who
 * is counted, not in how many are active, so the delta is refused with its
 * reason instead.
 */
export function weeklyKpi(axis: WeekAxis, series: Array<{ values: Array<number | null> }>): WeeklyKpi {
  const i = axis.weeks.length - 2;
  const j = i - 4;
  const at = (k: number) => series.map((s) => s.values[k]);
  const now = at(i);
  const counted = now.filter((v) => v !== null).length;
  const base: WeeklyKpi = {
    week: axis.weeks[i], value: null, counted, total: series.length,
    compare_week: j >= 0 ? axis.weeks[j] : null, delta: null,
  };
  if (!counted) {
    return { ...base, reason: `No series has a recorded value for the week of ${axis.weeks[i]}.` };
  }
  const value = now.reduce<number>((sum, v) => sum + (v ?? 0), 0);
  if (j < 0) return { ...base, value, delta_reason: 'The range holds no week four weeks earlier to compare with.' };
  const then = at(j);
  const sameSet = now.every((v, k) => (v === null) === (then[k] === null));
  if (!sameSet) {
    return {
      ...base, value,
      delta_reason:
        'The series recorded that week are not the ones recorded four weeks earlier, so a difference '
        + 'would compare two different populations.',
    };
  }
  const prior = then.reduce<number>((sum, v) => sum + (v ?? 0), 0);
  return { ...base, value, delta: value - prior };
}

/**
 * The earliest request this database logged, as a day — or `null` when it has
 * logged none.
 *
 * ORDER BY … LIMIT 1 AND NOT MIN(): `MIN(created_at)` under a WHERE on another
 * column scans, while an ordered walk of `idx_activity_created` stops at the
 * first middleware row, which is almost always the first row.
 */
async function firstLoggedDay(env: Env): Promise<string | null> {
  const row = await env.DB.prepare(
    `SELECT created_at FROM activity_logs
      WHERE endpoint IS NOT NULL
      ORDER BY created_at LIMIT 1`,
  ).first<{ created_at: string | null }>();
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(String(row?.created_at ?? ''));
  return m ? m[1] : null;
}

export type BranchWeeklyRead =
  | { available: false; reason: string }
  | {
    available: true;
    values: Array<number | null>;
    gap: 'no_rows' | 'before_series' | null;
    first_day: string | null;
  };

/**
 * This branch's own line: distinct signed-in accounts per week, from its own
 * `activity_logs` (S15).
 *
 * ONLY MIDDLEWARE ROWS. About forty other writers put rows in `activity_logs`
 * without an `endpoint`, and some of them are addressed to an account that did
 * nothing — a notice that "your role was changed" is filed under the person it
 * happened to. `endpoint IS NOT NULL` keeps exactly the rows `activityLogged()`
 * produced, which is what makes this the same definition HQ reads.
 *
 * THE WEEK IS `date(created_at, '-6 days', 'weekday 1')`: back six days, then
 * forward to the next Monday — which lands on the Monday of the row's own week
 * for every day of it, Sunday included. The bounds are SQL-format strings from
 * `weekAxis`, because `created_at` is `datetime('now')` and an ISO bind would
 * drop every row on the boundary day (D162).
 *
 * THERE IS NO RETENTION ON THIS TABLE, so every week after the first logged
 * request is a measurement: a week with nobody in it is 0. Weeks before it are
 * blank, because the branch was not logging then.
 */
export async function loadBranchWeeklyActives(env: Env, axis: WeekAxis): Promise<BranchWeeklyRead> {
  try {
    const first = await firstLoggedDay(env);
    const q = await env.DB.prepare(
      `SELECT date(created_at, '-6 days', 'weekday 1') AS week, COUNT(DISTINCT user_id) AS n
         FROM activity_logs
        WHERE created_at >= ? AND created_at < ?
          AND endpoint IS NOT NULL AND user_id IS NOT NULL
        GROUP BY week`,
    ).bind(axis.from, axis.to).all<{ week: string; n: number }>();
    const byWeek = new Map<string, number>();
    for (const r of q.results || []) byWeek.set(String(r.week), Math.max(0, Math.trunc(Number(r.n) || 0)));
    const firstWeek = first ? weekStartOf(first) : null;
    let gap: 'no_rows' | 'before_series' | null = null;
    const values = axis.weeks.map((w) => {
      if (!firstWeek) { gap = 'no_rows'; return null; }
      if (w < firstWeek) { gap = 'before_series'; return null; }
      return byWeek.get(w) ?? 0;
    });
    return { available: true, values, gap, first_day: first };
  } catch (e) {
    return {
      available: false,
      reason:
        'This branch\'s request log could not be read, so these are not counts of zero: '
        + `${(e as Error)?.message || 'activity_logs is unreadable'}.`,
    };
  }
}

/**
 * One week's count, for the benchmark HQ medians (D148's pipe, D210's metric).
 *
 * A WEEK THE LOG BEGAN INSIDE IS NOT OFFERED. A branch provisioned on a
 * Thursday has a real count for that week, but it is a count of four days, and
 * putting it into a median beside full weeks would drag the platform's figure
 * down for a reason that has nothing to do with activity. So it is `null` with
 * that reason, and the branch counts toward the median from its first whole
 * week.
 */
export async function activeAccountsInWeek(
  env: Env, monday: string,
): Promise<{ value: number | null; reason?: string }> {
  try {
    // The axis ending in `monday`'s week: its current week IS that week.
    const bounds = weekAxis(`${monday}T12:00:00Z`, 2);
    const from = `${bounds.current} 00:00:00`;
    const to = bounds.to;
    const first = await firstLoggedDay(env);
    if (!first) return { value: null, reason: 'This branch has logged no request yet.' };
    if (first > bounds.current) {
      // Two different claims share this branch: logging began part-way through
      // the week, or only after it had ended. Saying "inside that week" about
      // the second would put a count of days on a week that has none.
      return {
        value: null,
        reason: weekStartOf(first) === bounds.current
          ? `This branch began logging on ${first}, inside that week, so its count is not a whole week's.`
          : `This branch began logging on ${first}, after that week had ended, so it has no count for it.`,
      };
    }
    const row = await env.DB.prepare(
      `SELECT COUNT(DISTINCT user_id) AS n
         FROM activity_logs
        WHERE created_at >= ? AND created_at < ?
          AND endpoint IS NOT NULL AND user_id IS NOT NULL`,
    ).bind(from, to).first<{ n: number }>();
    return { value: Math.max(0, Math.trunc(Number(row?.n) || 0)) };
  } catch (e) {
    return { value: null, reason: `The request log could not be read: ${(e as Error)?.message || 'unknown'}.` };
  }
}
