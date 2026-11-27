/**
 * D1301 (#3397) — how an account is counted, for every read that counts them.
 *
 * Admin › Insights (D893, `adminInsights.ts`) and Admin › Accounts' overview
 * (D1301, `routes/admin_accounts_overview.ts`) draw the same accounts. They
 * count them here, once, so the two pages cannot disagree on a total, a
 * profile, a new-in-30-days figure, a deactivated count or the LPs: the
 * queries below were Insights' own and moved here unchanged, and the overview
 * folds its blocks from the same rows.
 *
 * THE RULES. An account is a `users` row; a live one has `is_active = 1` and a
 * deactivated one is counted apart. A profile is `users.role` as stored (an
 * empty role reads "no role"). New in 30 days is `created_at` in the last 30
 * days. An LP is an account with an approved `lp_applications` row. Active in
 * 30 days is `users.last_active_at` (stamped by `middleware/lastActive.ts`) in
 * the last 30 days; an account never stamped is counted apart, never as idle.
 *
 * COUNTS ONLY. Every query groups or sums; no name, email or id leaves here.
 */
import type { Env } from '../types';
import type { WeekAxis } from './activeAccounts';

export const DAY_MS = 86_400_000;

/** Days without a request before an account counts as dormant (Insights), or active within (Accounts). */
export const DORMANT_DAYS = 30;

/** How long an unverified email waits before the overview calls it overdue (ACC1's "for more than 7 days"). */
export const UNVERIFIED_OVERDUE_DAYS = 7;

/** The profile figure the overview's readiness counts as complete enough ("at least 75%"). */
export const READY_PROFILE_PCT = 75;

export type AccountFilter = { role: string | null; country: string | null };

/** `YYYY-MM-DD HH:MM:SS`, SQLite's own format (D162). */
export const sqlTime = (ms: number) => new Date(ms).toISOString().slice(0, 19).replace('T', ' ');

/** A count from a row: never negative, never a fraction, a missing value is 0 only inside a read that answered. */
export const n = (v: unknown) => Math.max(0, Math.trunc(Number(v) || 0));

/** The four binds every `(? IS NULL OR u.role = ?) AND (? IS NULL OR u.country = ?)` clause takes. */
export const fb = (f: AccountFilter) => [f.role, f.role, f.country, f.country];

export const NO_FILTER: AccountFilter = Object.freeze({ role: null, country: null });

export type AccountRow = {
  role: string; tier: string; country: string; kyc: string; pct: number | null;
  n: number; new_30d: number; lp: number;
  /** D1301: sums carried on the same rows, so the overview reads them from Insights' own pass. */
  unverified: number; unverified_overdue: number; active_30d: number;
};

/**
 * One grouped pass over the live accounts. Every block about who the accounts
 * are folds from these rows, so the totals of Insights' INS2, INS4, INS6, INS7
 * and INS8 and the overview's ACC1 are the same total.
 */
export async function liveAccounts(env: Env, f: AccountFilter, nowMs: number): Promise<AccountRow[]> {
  const q = await env.DB.prepare(
    `SELECT COALESCE(NULLIF(u.role, ''), 'no role') AS role,
            COALESCE(NULLIF(u.subscription_tier, ''), 'free') AS tier,
            COALESCE(TRIM(u.country), '') AS country,
            COALESCE(NULLIF(u.kyc_status, ''), 'not_started') AS kyc,
            u.profile_completion_pct AS pct,
            COUNT(*) AS n,
            SUM(CASE WHEN datetime(u.created_at) >= datetime(?, '-30 days') THEN 1 ELSE 0 END) AS new_30d,
            0 AS lp,
            SUM(CASE WHEN COALESCE(u.email_verified, 0) = 0 THEN 1 ELSE 0 END) AS unverified,
            SUM(CASE WHEN COALESCE(u.email_verified, 0) = 0
                      AND datetime(u.created_at) < datetime(?) THEN 1 ELSE 0 END) AS unverified_overdue,
            SUM(CASE WHEN u.last_active_at IS NOT NULL
                      AND datetime(u.last_active_at) >= datetime(?) THEN 1 ELSE 0 END) AS active_30d
       FROM users u
      WHERE u.is_active = 1
        AND (? IS NULL OR u.role = ?) AND (? IS NULL OR u.country = ?)
      GROUP BY 1, 2, 3, 4, 5`,
  ).bind(
    sqlTime(nowMs),
    sqlTime(nowMs - UNVERIFIED_OVERDUE_DAYS * DAY_MS),
    sqlTime(nowMs - DORMANT_DAYS * DAY_MS),
    ...fb(f),
  ).all<AccountRow>();
  return (q.results || []).map((r) => ({
    ...r, n: n(r.n), new_30d: n(r.new_30d),
    unverified: n(r.unverified), unverified_overdue: n(r.unverified_overdue), active_30d: n(r.active_30d),
  }));
}

/** Rows summed by one key, largest first. */
export function sumBy<K extends keyof AccountRow>(rows: AccountRow[], key: K): Array<{ key: string; count: number }> {
  const by = new Map<string, number>();
  for (const r of rows) by.set(String(r[key]), (by.get(String(r[key])) ?? 0) + r.n);
  return [...by].map(([k, c]) => ({ key: k, count: c })).sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
}

/** Live accounts with an approved LP application, distinct, by the account's own profile. Throws when the table cannot be read. */
export async function lpByProfile(env: Env, f: AccountFilter): Promise<Array<{ profile: string; count: number }>> {
  const q = await env.DB.prepare(
    `SELECT COALESCE(NULLIF(u.role, ''), 'no role') AS profile, COUNT(DISTINCT l.user_id) AS n
       FROM lp_applications l JOIN users u ON u.id = l.user_id
      WHERE l.status = 'approved' AND u.is_active = 1
        AND (? IS NULL OR u.role = ?) AND (? IS NULL OR u.country = ?)
      GROUP BY 1`,
  ).bind(...fb(f)).all<{ profile: string; n: number }>();
  return (q.results || []).map((r) => ({ profile: String(r.profile), count: n(r.n) }))
    .sort((a, b) => b.count - a.count || a.profile.localeCompare(b.profile));
}

/** The LP total: an account holds one profile, so the profiles' counts add up to it. */
export async function lpTotal(env: Env, f: AccountFilter): Promise<number> {
  return (await lpByProfile(env, f)).reduce((t, r) => t + r.count, 0);
}

export async function deactivatedCount(env: Env, f: AccountFilter): Promise<number> {
  const r = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM users u
      WHERE u.is_active = 0 AND (? IS NULL OR u.role = ?) AND (? IS NULL OR u.country = ?)`,
  ).bind(...fb(f)).first<{ n: number }>();
  return n(r?.n);
}

export type GrowthWeek = { week: string; total: number; to_date: boolean; by_profile: Record<string, number> };

/** Every account created per week, deactivated included (the glance's count), by profile. */
export async function signupsByWeek(env: Env, axis: WeekAxis, f: AccountFilter): Promise<GrowthWeek[]> {
  const q = await env.DB.prepare(
    `SELECT date(u.created_at, '-6 days', 'weekday 1') AS week,
            COALESCE(NULLIF(u.role, ''), 'no role') AS role, COUNT(*) AS n
       FROM users u
      WHERE datetime(u.created_at) >= datetime(?) AND datetime(u.created_at) < datetime(?)
        AND (? IS NULL OR u.role = ?) AND (? IS NULL OR u.country = ?)
      GROUP BY 1, 2`,
  ).bind(axis.from, axis.to, ...fb(f)).all<{ week: string; role: string; n: number }>();
  const by = new Map<string, Record<string, number>>(axis.weeks.map((w) => [w, {}]));
  for (const r of q.results || []) {
    const row = by.get(String(r.week));
    if (row) row[String(r.role)] = (row[String(r.role)] ?? 0) + n(r.n);
  }
  return axis.weeks.map((w) => {
    const by_profile = by.get(w)!;
    return {
      week: w,
      total: Object.values(by_profile).reduce((t, x) => t + x, 0),
      to_date: w === axis.current,
      by_profile,
    };
  });
}

/**
 * Live accounts whose latest request is more than `DORMANT_DAYS` old, and
 * those never stamped. With the rows' `active_30d` they make the whole: every
 * live account is active, dormant or never seen.
 */
export async function dormantCount(env: Env, f: AccountFilter, nowMs: number) {
  const r = await env.DB.prepare(
    `SELECT SUM(CASE WHEN u.last_active_at IS NOT NULL
                      AND datetime(u.last_active_at) < datetime(?) THEN 1 ELSE 0 END) AS dormant,
            SUM(CASE WHEN u.last_active_at IS NULL THEN 1 ELSE 0 END) AS never_seen
       FROM users u
      WHERE u.is_active = 1
        AND (? IS NULL OR u.role = ?) AND (? IS NULL OR u.country = ?)`,
  ).bind(sqlTime(nowMs - DORMANT_DAYS * DAY_MS), ...fb(f)).first<{ dormant: number; never_seen: number }>();
  return { dormant: n(r?.dormant), never_seen: n(r?.never_seen) };
}
