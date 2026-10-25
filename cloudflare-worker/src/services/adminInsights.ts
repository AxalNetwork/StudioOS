/**
 * D893 (#2660) — THE INSIGHTS READ: every block of Admin › Insights from one
 * request, as counts.
 *
 * The page (#2366, the owner's canvas INS1–INS11) used to stitch four reads
 * together and drew nine figures as "Not recorded" because none of them held
 * the count. This read holds them all, for every admin, on whichever D1 this
 * Worker has: HQ's own accounts on HQ, the branch's on a branch.
 *
 * COUNTS ONLY. No name, email or account id leaves the read, as the glance
 * does (`studioGlance.ts`). Every query below groups or sums; the only strings
 * that travel are role keys, plan tiers, countries as stored and statuses.
 *
 * EACH BLOCK ANSWERS ALONE. A block is one of three things:
 *   · `{ available: true, ... }` — read;
 *   · `{ available: false, unreadable: true, reason }` — its store failed, and
 *     that is not a claim of zero;
 *   · `{ recorded: false, reason }` — nothing on this database records it.
 * A failed block never becomes a zero, and never takes another block with it.
 *
 * THE FILTERS NARROW THE ACCOUNTS, NOT THE WEEKS. `profile` is `users.role`
 * and `country` is `users.country` as stored; both apply to every block that
 * is about accounts, through `(? IS NULL OR …)` so the SQL is fixed and an
 * absent filter matches everyone. `range` is the weeks the charts draw.
 *
 * WEEKS ARE MONDAY WEEKS IN UTC, built by `weekAxis` — the same axis HQ and
 * branch Analytics draw — so a week here is a week there.
 */
import type { Env } from '../types';
import { branchOf } from '../util/branch';
import {
  ACTIVE_ACCOUNT_BASIS, ANALYTICS_RANGES, type AnalyticsRange, firstLoggedDay, weekAxis, type WeekAxis,
} from './activeAccounts';
import { activationFunnel, type ActivationCohort } from './activationFunnel';
import { weekStartOf } from './okrWeeks';
import { HQ_SCOPE_LABEL } from './studioGlance';
import { OPEN_TICKET_STATUSES, ticketBacklog } from './supportQueues';

const DAY_MS = 86_400_000;

/** Days without a request before an account counts as dormant. */
export const DORMANT_DAYS = 30;

/** The plan tier that is not paid. Every other tier is. */
export const FREE_TIER = 'free';

/** INS7's four bands over `users.profile_completion_pct`. */
export const COMPLETENESS_BANDS: ReadonlyArray<{ band: string; lo: number; hi: number }> = [
  { band: '0–25', lo: 0, hi: 25 },
  { band: '26–50', lo: 26, hi: 50 },
  { band: '51–75', lo: 51, hi: 75 },
  { band: '76–100', lo: 76, hi: 100 },
];

/** The identity-check states the page names, with #2384's words beside them. */
export const IDENTITY_STATES = ['not_started', 'pending', 'approved', 'rejected'] as const;

export const PRODUCT_TESTERS_REASON =
  'A Product tester is a sub-account that #2377 and #2318 have not defined yet, so nothing on this database marks one.';

export const DORMANT_LAST_MONTH_REASON =
  'Only the latest request is kept per account (`users.last_active_at`), so how many were dormant a month ago cannot be read back.';

/** One sentence per block, for the page's "How is this counted?" dialog. */
export const INSIGHTS_DEFINITIONS = {
  accounts:
    'Accounts that are not deactivated. New in 30 days counts those created in the last 30 days; deactivated are counted apart.',
  new_this_week: 'Accounts created this Monday-to-Sunday UTC week so far, against the whole of last week.',
  active: ACTIVE_ACCOUNT_BASIS,
  activated:
    'Of the accounts created in the weeks drawn whose second week has ended, the share with any logged request on days 8 to 14 after they were created.',
  who: 'Accounts that are not deactivated, by profile. LPs are accounts with an approved LP application.',
  plan: 'Accounts that are not deactivated, by plan tier. Every tier except free is counted as paid.',
  growth:
    'Every account created in each week, deactivated ones included, split by profile. The current week is to date.',
  activity: ACTIVE_ACCOUNT_BASIS,
  activation:
    'Accounts grouped by the week they were created, and how many signed in, accepted the Terms and were active in their second week.',
  retention:
    'Accounts grouped by the week they were created, and how many made a logged request in the last 30 days.',
  countries: 'Accounts that are not deactivated, by the country on their profile, as written. Not stated counts the blank ones.',
  identity: 'Accounts that are not deactivated, by identity check: Not started, Waiting, Approved, Rejected.',
  completeness:
    'Accounts that are not deactivated, by how complete their profile is, in four bands. Accounts with no figure are counted apart.',
  dormant: `Accounts that are not deactivated and whose latest request is more than ${DORMANT_DAYS} days old.`,
  tickets: 'Support tickets still open or in progress, and every ticket by status.',
  spend: 'AI spend this calendar month (UTC), from the AI usage log, by the profile of the account that spent it.',
} as const;

export type InsightsFilter = { role: string | null; country: string | null };

export type InsightsQuery = InsightsFilter & {
  range: AnalyticsRange;
  compare: boolean;
  group: string | null;
};

type Unreadable = { available: false; unreadable: true; reason: string };
type NotRecorded = { recorded: false; reason: string };

const unreadable = (what: string, e: unknown): Unreadable => {
  console.error('[admin-insights]', what, typeof e === 'string' ? e : (e as Error)?.message);
  return {
    available: false,
    unreadable: true,
    reason: `${what} could not be read on this database. That is not the same as none.`,
  };
};

/** `YYYY-MM-DD HH:MM:SS`, SQLite's own format (D162). */
const sqlTime = (ms: number) => new Date(ms).toISOString().slice(0, 19).replace('T', ' ');

const n = (v: unknown) => Math.max(0, Math.trunc(Number(v) || 0));

/** The four binds every `(? IS NULL OR u.role = ?) AND (? IS NULL OR u.country = ?)` clause takes. */
const fb = (f: InsightsFilter) => [f.role, f.role, f.country, f.country];

/** The weeks immediately before `axis`, the same length: what `compare=1` draws. */
export function previousAxis(axis: WeekAxis): WeekAxis {
  const [y, m, d] = axis.weeks[0].split('-').map(Number);
  const before = new Date(Date.UTC(y, m - 1, d) - DAY_MS).toISOString();
  return weekAxis(before, axis.weeks.length);
}

// ---------------------------------------------------------------------------
// The account table: totals, profiles, plans, countries, checks, bands.
// ---------------------------------------------------------------------------

type AccountRow = {
  role: string; tier: string; country: string; kyc: string; pct: number | null;
  n: number; new_30d: number; lp: number;
};

/**
 * One grouped pass over the live accounts. Every block about who the accounts
 * are folds from these rows, so the totals of INS2, INS4, INS6, INS7 and INS8
 * are the same total.
 */
async function liveAccounts(env: Env, f: InsightsFilter, nowMs: number): Promise<AccountRow[]> {
  const q = await env.DB.prepare(
    `SELECT COALESCE(NULLIF(u.role, ''), 'no role') AS role,
            COALESCE(NULLIF(u.subscription_tier, ''), 'free') AS tier,
            COALESCE(TRIM(u.country), '') AS country,
            COALESCE(NULLIF(u.kyc_status, ''), 'not_started') AS kyc,
            u.profile_completion_pct AS pct,
            COUNT(*) AS n,
            SUM(CASE WHEN datetime(u.created_at) >= datetime(?, '-30 days') THEN 1 ELSE 0 END) AS new_30d,
            0 AS lp
       FROM users u
      WHERE u.is_active = 1
        AND (? IS NULL OR u.role = ?) AND (? IS NULL OR u.country = ?)
      GROUP BY 1, 2, 3, 4, 5`,
  ).bind(sqlTime(nowMs), ...fb(f)).all<AccountRow>();
  return (q.results || []).map((r) => ({ ...r, n: n(r.n), new_30d: n(r.new_30d) }));
}

function sumBy<K extends keyof AccountRow>(rows: AccountRow[], key: K): Array<{ key: string; count: number }> {
  const by = new Map<string, number>();
  for (const r of rows) by.set(String(r[key]), (by.get(String(r[key])) ?? 0) + r.n);
  return [...by].map(([k, c]) => ({ key: k, count: c })).sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
}

async function lpCount(env: Env, f: InsightsFilter) {
  try {
    const r = await env.DB.prepare(
      `SELECT COUNT(DISTINCT l.user_id) AS n
         FROM lp_applications l JOIN users u ON u.id = l.user_id
        WHERE l.status = 'approved' AND u.is_active = 1
          AND (? IS NULL OR u.role = ?) AND (? IS NULL OR u.country = ?)`,
    ).bind(...fb(f)).first<{ n: number }>();
    return { available: true as const, count: n(r?.n) };
  } catch (e) {
    return unreadable('The LP applications', e);
  }
}

async function deactivatedCount(env: Env, f: InsightsFilter) {
  const r = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM users u
      WHERE u.is_active = 0 AND (? IS NULL OR u.role = ?) AND (? IS NULL OR u.country = ?)`,
  ).bind(...fb(f)).first<{ n: number }>();
  return n(r?.n);
}

// ---------------------------------------------------------------------------
// Weekly lines: sign-ups by profile, distinct active accounts.
// ---------------------------------------------------------------------------

type GrowthWeek = { week: string; total: number; to_date: boolean; by_profile: Record<string, number> };

/** Every account created per week, deactivated included (the glance's count), by profile. */
async function signupsByWeek(env: Env, axis: WeekAxis, f: InsightsFilter): Promise<GrowthWeek[]> {
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
 * Distinct signed-in accounts per week on `ACTIVE_ACCOUNT_BASIS`, in ONE
 * grouped query: middleware rows only (`endpoint IS NOT NULL`), the rule
 * `loadBranchWeeklyActives` reads. The join to `users` is what lets a profile
 * or a country narrow it.
 *
 * A WEEK BEFORE THE LOG BEGAN IS BLANK, NOT ZERO — `null`, as the branch line
 * draws it. After the first logged request a week with nobody in it is a 0.
 */
async function activeByWeek(
  env: Env, axis: WeekAxis, f: InsightsFilter, firstDay: string | null,
): Promise<Array<number | null>> {
  const q = await env.DB.prepare(
    `SELECT date(a.created_at, '-6 days', 'weekday 1') AS week, COUNT(DISTINCT a.user_id) AS n
       FROM activity_logs a JOIN users u ON u.id = a.user_id
      WHERE a.created_at >= ? AND a.created_at < ?
        AND a.endpoint IS NOT NULL AND a.user_id IS NOT NULL
        AND (? IS NULL OR u.role = ?) AND (? IS NULL OR u.country = ?)
      GROUP BY week`,
  ).bind(axis.from, axis.to, ...fb(f)).all<{ week: string; n: number }>();
  const by = new Map((q.results || []).map((r) => [String(r.week), n(r.n)]));
  const firstWeek = firstDay ? weekStartOf(firstDay) : null;
  return axis.weeks.map((w) => (!firstWeek || w < firstWeek ? null : (by.get(w) ?? 0)));
}

/** Distinct accounts active in one week, by country — the group lightbox's table. */
async function activeInWeekByCountry(env: Env, monday: string, f: InsightsFilter) {
  const bounds = weekAxis(`${monday}T12:00:00Z`, 2);
  const q = await env.DB.prepare(
    `SELECT COALESCE(TRIM(u.country), '') AS country, COUNT(DISTINCT a.user_id) AS n
       FROM activity_logs a JOIN users u ON u.id = a.user_id
      WHERE a.created_at >= ? AND a.created_at < ?
        AND a.endpoint IS NOT NULL AND a.user_id IS NOT NULL
        AND (? IS NULL OR u.role = ?) AND (? IS NULL OR u.country = ?)
      GROUP BY 1`,
  ).bind(`${bounds.current} 00:00:00`, bounds.to, ...fb(f)).all<{ country: string; n: number }>();
  return new Map((q.results || []).map((r) => [String(r.country), n(r.n)]));
}

// ---------------------------------------------------------------------------
// Retention, dormancy, tickets, spend.
// ---------------------------------------------------------------------------

async function retentionCohorts(env: Env, axis: WeekAxis, f: InsightsFilter, nowMs: number) {
  const q = await env.DB.prepare(
    `SELECT date(u.created_at, '-6 days', 'weekday 1') AS week, COUNT(*) AS signups,
            SUM(CASE WHEN EXISTS (
                  SELECT 1 FROM activity_logs a
                   WHERE a.user_id = u.id AND a.endpoint IS NOT NULL
                     AND a.created_at >= ?
                ) THEN 1 ELSE 0 END) AS retained
       FROM users u
      WHERE datetime(u.created_at) >= datetime(?) AND datetime(u.created_at) < datetime(?)
        AND (? IS NULL OR u.role = ?) AND (? IS NULL OR u.country = ?)
      GROUP BY 1`,
  ).bind(sqlTime(nowMs - 30 * DAY_MS), axis.from, axis.to, ...fb(f))
    .all<{ week: string; signups: number; retained: number }>();
  const by = new Map((q.results || []).map((r) => [String(r.week), r]));
  return axis.weeks.map((w) => ({ week: w, signups: n(by.get(w)?.signups), retained_30d: n(by.get(w)?.retained) }));
}

/**
 * `users.last_active_at` is stamped by `middleware/lastActive.ts` on every
 * signed-in request. An account it has never stamped is counted apart
 * (`never_seen`): it may predate the stamp, so it is not called dormant.
 */
async function dormantCount(env: Env, f: InsightsFilter, nowMs: number) {
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

async function tickets(env: Env, f: InsightsFilter) {
  if (f.role === null && f.country === null) {
    const b = await ticketBacklog(env);
    return { open: b.open, by_status: b.by_status };
  }
  const q = await env.DB.prepare(
    `SELECT t.status AS status, COUNT(*) AS n
       FROM tickets t JOIN users u ON u.id = t.user_id
      WHERE (? IS NULL OR u.role = ?) AND (? IS NULL OR u.country = ?)
      GROUP BY t.status`,
  ).bind(...fb(f)).all<{ status: string; n: number }>();
  const by_status: Record<string, number> = {};
  for (const r of q.results || []) by_status[String(r.status)] = n(r.n);
  let open = 0;
  for (const s of OPEN_TICKET_STATUSES) open += by_status[s] || 0;
  return { open, by_status };
}

/** This calendar month, UTC — the predicate the glance's spend uses — by the spender's profile. */
async function spendThisMonth(env: Env, f: InsightsFilter, nowMs: number) {
  const month = new Date(nowMs).toISOString().slice(0, 7);
  const q = await env.DB.prepare(
    `SELECT COALESCE(NULLIF(u.role, ''), 'no account') AS profile,
            COUNT(*) AS calls, COALESCE(SUM(l.est_cost_usd), 0) AS usd
       FROM ai_usage_logs l LEFT JOIN users u ON u.id = l.user_id
      WHERE substr(l.created_at, 1, 7) = ?
        AND (? IS NULL OR u.role = ?) AND (? IS NULL OR u.country = ?)
      GROUP BY 1`,
  ).bind(month, ...fb(f)).all<{ profile: string; calls: number; usd: number }>();
  const by_profile = (q.results || [])
    .map((r) => ({ profile: String(r.profile), usd: Number(r.usd) || 0, calls: n(r.calls) }))
    .sort((a, b) => b.usd - a.usd || a.profile.localeCompare(b.profile));
  return {
    month,
    usd: by_profile.reduce((t, r) => t + r.usd, 0),
    calls: by_profile.reduce((t, r) => t + r.calls, 0),
    by_profile,
  };
}

// ---------------------------------------------------------------------------
// Activation: the funnel, and the rate the KPI shows.
// ---------------------------------------------------------------------------

/** The share active in week two, over the cohorts whose week two has ended. `null` when none has. */
export function activatedRate(cohorts: readonly ActivationCohort[]) {
  const closed = cohorts.filter((c) => c.active_week_two !== null && c.created > 0);
  const created = closed.reduce((t, c) => t + c.created, 0);
  const active = closed.reduce((t, c) => t + (c.active_week_two ?? 0), 0);
  return { rate_pct: created ? Math.round((active / created) * 1000) / 10 : null, cohorts_counted: closed.length };
}

// ---------------------------------------------------------------------------
// The read.
// ---------------------------------------------------------------------------

/** Runs `read`; a throw becomes that block's own `unreadable`. */
async function block<T>(what: string, read: () => Promise<T>): Promise<({ available: true } & T) | Unreadable> {
  try {
    return { available: true, ...(await read()) };
  } catch (e) {
    return unreadable(what, e);
  }
}

/** The scope this deployment answers for: `hq`, or the branch code. */
export function ownScope(env: Env): string {
  return branchOf(env) ?? 'hq';
}

export function scopeLabel(env: Env): string {
  const code = branchOf(env);
  return code ? `${code} accounts` : HQ_SCOPE_LABEL;
}

async function groupBlock(env: Env, q: InsightsQuery, axis: WeekAxis, firstDay: string | null, nowMs: number) {
  const g: InsightsFilter = { role: q.group, country: null };
  const [rows, signups, active, funnel, dormant, countryActive] = await Promise.all([
    liveAccounts(env, g, nowMs),
    signupsByWeek(env, axis, g),
    activeByWeek(env, axis, g, firstDay),
    activationFunnel(env, nowMs, { weeks: axis.weeks.length, role: g.role }),
    dormantCount(env, g, nowMs),
    activeInWeekByCountry(env, axis.last_complete, g),
  ]);
  const countries = new Map<string, { accounts: number; new_30d: number }>();
  for (const r of rows) {
    const c = countries.get(r.country) ?? { accounts: 0, new_30d: 0 };
    c.accounts += r.n;
    c.new_30d += r.new_30d;
    countries.set(r.country, c);
  }
  const i = axis.weeks.indexOf(axis.last_complete);
  return {
    profile: q.group,
    count: rows.reduce((t, r) => t + r.n, 0),
    new_30d: rows.reduce((t, r) => t + r.new_30d, 0),
    active_last_week: active[i] ?? null,
    activated_pct: funnel.available ? activatedRate(funnel.cohorts).rate_pct : null,
    dormant: dormant.dormant,
    signups_by_week: signups.map((w) => ({ week: w.week, count: w.total, to_date: w.to_date })),
    active_by_week: axis.weeks.map((w, k) => ({ week: w, count: active[k] })),
    by_country: [...countries]
      .map(([country, c]) => ({
        country: country || null,
        accounts: c.accounts,
        new_30d: c.new_30d,
        active_last_week: firstDay ? (countryActive.get(country) ?? 0) : null,
      }))
      .sort((a, b) => b.accounts - a.accounts || String(a.country ?? '').localeCompare(String(b.country ?? ''))),
  };
}

export async function adminInsights(env: Env, q: InsightsQuery, nowMs: number = Date.now()) {
  const f: InsightsFilter = { role: q.role, country: q.country };
  const axis = weekAxis(new Date(nowMs).toISOString(), ANALYTICS_RANGES[q.range]);
  const iLast = axis.weeks.indexOf(axis.last_complete);

  // The log's first day dates every activity line; failing it fails activity only.
  const first = await firstLoggedDay(env).then((d) => ({ ok: true as const, d }), (e) => ({ ok: false as const, e }));

  const [accounts, deactivated, lps, growth, activity, previous, funnel, retention, dormant, tix, spend, group] =
    await Promise.all([
      block('The account table', async () => ({ rows: await liveAccounts(env, f, nowMs) })),
      block('Deactivated accounts', async () => ({ count: await deactivatedCount(env, f) })),
      lpCount(env, f),
      block('Sign-ups', async () => ({ weeks: await signupsByWeek(env, axis, f) })),
      first.ok
        ? block('The request log', async () => ({ values: await activeByWeek(env, axis, f, first.d) }))
        : Promise.resolve(unreadable('The request log', first.e)),
      q.compare && first.ok
        ? activeByWeek(env, previousAxis(axis), f, first.d).catch(() => null)
        : Promise.resolve(null),
      activationFunnel(env, nowMs, { weeks: axis.weeks.length, role: f.role, country: f.country }),
      block('Retention', async () => ({ cohorts: await retentionCohorts(env, axis, f, nowMs) })),
      block('Last activity', async () => dormantCount(env, f, nowMs)),
      block('The support ticket table', async () => tickets(env, f)),
      block('The AI usage log', async () => spendThisMonth(env, f, nowMs)),
      !q.group ? Promise.resolve(null)
        : first.ok ? block('The group', async () => groupBlock(env, q, axis, first.d, nowMs))
          : Promise.resolve(unreadable('The request log', first.e)),
    ]);

  const rows = accounts.available ? accounts.rows : null;
  const total = rows ? rows.reduce((t, r) => t + r.n, 0) : null;
  const accountBlock = <T>(build: (r: AccountRow[], t: number) => T): ({ available: true } & T) | Unreadable =>
    rows && total !== null ? { available: true, ...build(rows, total) } : (accounts as Unreadable);

  const growthWeeks = growth.available ? growth.weeks : null;
  const funnelCohorts = funnel.available ? funnel.cohorts : null;
  // The funnel's own reasons quote the database's error; the page gets a sentence instead.
  const funnelBlock = funnel.available
    ? {
      available: true as const, weeks: funnel.weeks, cohorts: funnel.cohorts,
      steps: {
        terms_accepted: funnel.steps.terms_accepted.available ? funnel.steps.terms_accepted
          : unreadable('The Terms acceptances', funnel.steps.terms_accepted.reason),
        invited: funnel.steps.invited.available ? funnel.steps.invited
          : unreadable('The invitations', funnel.steps.invited.reason),
      },
    }
    : unreadable('The accounts or the request log', funnel.reason);

  return {
    range: q.range,
    weeks: axis.weeks,
    current_week: axis.current,
    last_complete_week: axis.last_complete,
    as_of: new Date(nowMs).toISOString(),
    scope: { key: ownScope(env), label: scopeLabel(env) },
    filters: { profile: q.role, country: q.country, compare: q.compare, group: q.group },
    kpis: {
      accounts: rows && total !== null && deactivated.available
        ? { available: true, total, new_30d: rows.reduce((t, r) => t + r.new_30d, 0), deactivated: deactivated.count }
        : (!accounts.available ? accounts : deactivated),
      new_this_week: growthWeeks
        ? { available: true, count: growthWeeks[growthWeeks.length - 1].total, last_week: growthWeeks[growthWeeks.length - 2].total }
        : growth,
      active_last_week: activity.available
        ? { available: true, week: axis.last_complete, value: activity.values[iLast], week_before: activity.values[iLast - 1] ?? null }
        : activity,
      activated: funnelCohorts ? { available: true, ...activatedRate(funnelCohorts) } : funnelBlock,
    },
    blocks: {
      who: accountBlock((r, t) => ({
        total: t,
        by_profile: sumBy(r, 'role').map((x) => ({ profile: x.key, count: x.count })),
        lps: lps.available ? lps.count : null,
        ...(lps.available ? {} : { lps_reason: lps.reason }),
        product_testers: { recorded: false, reason: PRODUCT_TESTERS_REASON } as NotRecorded,
      })),
      plan: accountBlock((r, t) => {
        const by_tier = sumBy(r, 'tier').map((x) => ({ tier: x.key, count: x.count }));
        const paid = by_tier.filter((x) => x.tier !== FREE_TIER).reduce((s, x) => s + x.count, 0);
        return { by_tier, paid, paid_pct: t ? Math.round((paid / t) * 1000) / 10 : null };
      }),
      growth: growth.available ? { available: true, weeks: growth.weeks } : growth,
      activity: activity.available
        ? { available: true, weeks: axis.weeks, values: activity.values, previous: q.compare ? previous : null }
        : activity,
      activation: funnelBlock,
      retention,
      countries: accountBlock((r) => {
        const all = sumBy(r, 'country');
        return {
          rows: all.filter((x) => x.key !== '').map((x) => ({ country: x.key, count: x.count })),
          not_stated: all.find((x) => x.key === '')?.count ?? 0,
        };
      }),
      identity: accountBlock((r) => {
        const out: Record<string, number> = { not_started: 0, pending: 0, approved: 0, rejected: 0, other: 0 };
        for (const x of sumBy(r, 'kyc')) {
          const k = (IDENTITY_STATES as readonly string[]).includes(x.key) ? x.key : 'other';
          out[k] += x.count;
        }
        return out;
      }),
      completeness: accountBlock((r) => {
        const bands = COMPLETENESS_BANDS.map((b) => ({ band: b.band, count: 0 }));
        let not_recorded = 0;
        for (const x of r) {
          const pct = x.pct === null || x.pct === undefined ? NaN : Number(x.pct);
          const k = Number.isFinite(pct) ? COMPLETENESS_BANDS.findIndex((b) => pct <= b.hi) : -1;
          if (k < 0) not_recorded += x.n;
          else bands[k].count += x.n;
        }
        return { bands, not_recorded };
      }),
      dormant: dormant.available
        ? {
          available: true, days: DORMANT_DAYS, count: dormant.dormant, never_seen: dormant.never_seen,
          last_month: null, last_month_reason: DORMANT_LAST_MONTH_REASON,
        }
        : dormant,
      tickets: tix,
      spend,
    },
    ...(group ? { group } : {}),
    definitions: INSIGHTS_DEFINITIONS,
  };
}
