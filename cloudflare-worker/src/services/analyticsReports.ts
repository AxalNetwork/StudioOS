/**
 * Task #3 — Analytics queries + export helpers used by
 * `routes/monitoring_analytics.ts`. Kept in a separate file so the route
 * stays focused on HTTP concerns.
 *
 * Data sources:
 *   - users + activity_logs + projects (D1) for user/cohort metrics
 *   - users.mi_subscription_* (D1) for MRR/ARR/churn (Stripe-billed locally)
 *   - system_metrics + error_logs (D1) for technical metrics
 *   - admin_audit_log (D1) for the Recent Exports panel
 */
import type { Env } from '../types';
import { getSQL } from '../db';
import {
  loadPlanPriceMap, priceFor, ensureSubscriptionPlansSchema,
  loadFxRates, convertFromUsd,
  type PlanPricing,
} from './subscriptionPlans';

// ---------- common row helpers (no `any`) ----------
type SqlRow = Record<string, unknown>;
const num = (v: unknown): number => {
  if (v === null || v === undefined) return 0;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
};
const str = (v: unknown): string => (v === null || v === undefined ? '' : String(v));
const rows = <T = SqlRow>(r: unknown): T[] => (Array.isArray(r) ? (r as T[]) : []);

// ---------- date range helpers ----------
export interface DateRange { from: string; to: string; fromIso: string; toIso: string; days: number; }

export class BadRangeError extends Error {
  constructor(msg: string) { super(msg); this.name = 'BadRangeError'; }
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function parseRange(fromQ?: string | null, toQ?: string | null, defaultDays = 30): DateRange {
  const now = new Date();
  const validate = (s: string, label: string): Date => {
    if (!ISO_DATE_RE.test(s)) throw new BadRangeError(`Invalid ${label} (expected YYYY-MM-DD)`);
    const d = new Date(s + (label === 'to' ? 'T23:59:59Z' : 'T00:00:00Z'));
    if (isNaN(d.getTime())) throw new BadRangeError(`Invalid ${label} date`);
    return d;
  };
  const to = toQ ? validate(toQ, 'to') : now;
  const from = fromQ
    ? validate(fromQ, 'from')
    : new Date(now.getTime() - defaultDays * 24 * 3600 * 1000);
  if (from.getTime() > to.getTime()) throw new BadRangeError('`from` must be on or before `to`');
  const days = Math.max(1, Math.min(366, Math.round((to.getTime() - from.getTime()) / 86400000)));
  const fromIso = from.toISOString().replace('T', ' ').slice(0, 19);
  const toIso = to.toISOString().replace('T', ' ').slice(0, 19);
  return {
    from: from.toISOString().slice(0, 10),
    to: to.toISOString().slice(0, 10),
    fromIso, toIso, days,
  };
}

// ---------- pricing (USD/month) ----------
// Plan prices live in the `subscription_plans` D1 table (Task #11). Each
// report function loads the catalog once at the top via `loadPlanPriceMap`
// and then resolves prices through `priceFor(map, plan)`. Adding a new
// Stripe plan registers automatically through the webhook, so no code
// change is needed when pricing/plans evolve.
//
// `planPrice` is retained as a thin wrapper for callers that already have
// a price map in hand.
export function planPrice(map: Map<string, PlanPricing>, plan: string | null | undefined): number {
  return priceFor(map, plan);
}

// Task #14 — Display-currency helpers. Reports keep all internal math in
// USD (so plans denominated in different currencies can roll up safely),
// then convert ONCE on the way out using the `fx_rates` table.
const ALLOWED_CURRENCIES = new Set([
  'USD', 'EUR', 'GBP', 'CAD', 'AUD', 'JPY', 'INR', 'SGD', 'CHF', 'SEK',
]);
export function normaliseCurrency(raw: string | null | undefined): string {
  const c = String(raw || 'USD').toUpperCase();
  return ALLOWED_CURRENCIES.has(c) ? c : 'USD';
}
async function displayContext(env: Env, raw: string | null | undefined) {
  const currency = normaliseCurrency(raw);
  const fx = await loadFxRates(env);
  const conv = (usd: number) => convertFromUsd(usd, currency, fx);
  return { currency, fx, conv, asOf: fx.asOf };
}

// ---------- queries ----------
export interface OverviewReport {
  range: { from: string; to: string; days: number };
  active_users: number; new_signups: number; total_users: number; paid_users: number;
  conversion_to_paid_pct: number;
  // MRR/ARR are reported in USD (always) AND in the requested display currency.
  // Frontends should prefer `mrr` + `display_currency`; `mrr_usd` is preserved
  // for back-compat with anything reading the legacy field.
  mrr_usd: number; arr_usd: number;
  mrr: number; arr: number;
  display_currency: string; fx_as_of: string | null;
  churned_subscriptions: number; churn_rate_pct: number; avg_session_minutes: number;
  p50_latency_ms: number; p95_latency_ms: number; error_rate_pct: number; total_requests: number;
  top_pages: Array<{ endpoint: string; hits: number }>;
  daily_active: Array<{ day: string; active: number }>;
  // Task #13 — `reason: 'no_data'` when the entire window has zero traffic
  // and zero signups; the UI uses this to show a clean empty pill instead
  // of a wall of zero-stat cards that look like a load failure.
  meta?: { reason: 'ok' | 'no_data' };
}

// Task #13 — fast historical read path. When the requested range ends
// before today (UTC), every day in the window is fully captured in
// `analytics_snapshots` (written by the 02:05 UTC cron). Reading from the
// snapshot table is O(days) instead of O(activity_logs rows) and is the
// only way the Overview sub-tab can stay <200ms once activity_logs grows.
// Returns null when the table is missing, the window includes today, or
// any day in the window has no snapshot row (so the live aggregate path
// runs and the result reflects the in-flight day).
async function loadOverviewFromSnapshots(
  env: Env,
  range: DateRange,
  currency?: string | null,
): Promise<OverviewReport | null> {
  const todayUtc = new Date().toISOString().slice(0, 10);
  // If `to` is today or in the future, snapshots don't cover it.
  if (range.to >= todayUtc) return null;
  const sql = getSQL(env);
  const disp = await displayContext(env, currency);
  let snaps: SqlRow[];
  try {
    snaps = rows<SqlRow>(await sql`
      SELECT snapshot_date, active_users, new_signups, total_users, paid_users,
             total_requests, errors_5xx, p50_latency_ms, p95_latency_ms,
             mrr_usd, arr_usd, churned_subscriptions
      FROM analytics_snapshots
      WHERE snapshot_date >= ${range.from} AND snapshot_date <= ${range.to}
      ORDER BY snapshot_date ASC
    `);
  } catch {
    // Table missing or malformed → fall through to live path.
    return null;
  }
  if (snaps.length === 0) return null;
  // Require contiguous coverage: every day in the window must have a row.
  const expectDays = range.days;
  if (snaps.length < expectDays) return null;

  // Aggregate the snapshots. `active_users` is a unique-count, so a daily
  // sum is an UPPER bound only — we surface the MAX day instead, which
  // matches what users see on the daily chart and avoids inflating DAU.
  let active = 0; let newSignups = 0; let totalRequests = 0; let errors5xx = 0;
  let p50sum = 0; let p95sum = 0;
  let mrrLatest = 0; let arrLatest = 0; let churned = 0;
  let totalUsersLatest = 0; let paidUsersLatest = 0;
  const dau: Array<{ day: string; active: number }> = [];
  for (const r of snaps) {
    const a = num(r.active_users);
    if (a > active) active = a;
    newSignups += num(r.new_signups);
    totalRequests += num(r.total_requests);
    errors5xx += num(r.errors_5xx);
    p50sum += num(r.p50_latency_ms);
    p95sum += num(r.p95_latency_ms);
    churned += num(r.churned_subscriptions);
    // MRR/ARR/totals are point-in-time stocks — last day in the window wins.
    mrrLatest = num(r.mrr_usd);
    arrLatest = num(r.arr_usd);
    totalUsersLatest = num(r.total_users);
    paidUsersLatest = num(r.paid_users);
    dau.push({ day: str(r.snapshot_date), active: a });
  }
  const days = snaps.length;
  const isEmpty = active === 0 && newSignups === 0 && totalRequests === 0;
  return {
    range: { from: range.from, to: range.to, days: range.days },
    active_users: active,
    new_signups: newSignups,
    total_users: totalUsersLatest,
    paid_users: paidUsersLatest,
    conversion_to_paid_pct: totalUsersLatest > 0
      ? Number(((paidUsersLatest / totalUsersLatest) * 100).toFixed(2))
      : 0,
    mrr_usd: mrrLatest,
    arr_usd: arrLatest,
    mrr: disp.conv(mrrLatest),
    arr: disp.conv(arrLatest),
    display_currency: disp.currency,
    fx_as_of: disp.asOf,
    churned_subscriptions: churned,
    churn_rate_pct: paidUsersLatest > 0
      ? Number(((churned / paidUsersLatest) * 100).toFixed(2))
      : 0,
    avg_session_minutes: 0, // not snapshotted; UI shows '—' on historical
    p50_latency_ms: Math.round(p50sum / days),
    p95_latency_ms: Math.round(p95sum / days),
    error_rate_pct: totalRequests > 0
      ? Number(((errors5xx / totalRequests) * 100).toFixed(2))
      : 0,
    total_requests: totalRequests,
    top_pages: [], // not snapshotted; intentionally empty for historical
    daily_active: dau,
    meta: isEmpty ? { reason: 'no_data' } : { reason: 'ok' },
  } as OverviewReport;
}

export async function loadOverview(
  env: Env,
  range: DateRange,
  currency?: string | null,
  opts?: { forceLive?: boolean },
): Promise<OverviewReport> {
  // Task #13 — prefer pre-computed snapshots for fully-historical windows.
  // Falls back to live aggregation when the window includes today or any
  // day is missing from `analytics_snapshots`. `forceLive` bypasses the
  // snapshot read entirely — required by writeDailySnapshot/backfill so
  // reruns recompute from source instead of re-reading stale snapshots.
  if (!opts?.forceLive) {
    const snap = await loadOverviewFromSnapshots(env, range, currency);
    if (snap) return snap;
  }
  const sql = getSQL(env);
  const priceMap = await loadPlanPriceMap(env);
  const disp = await displayContext(env, currency);
  const active = rows<SqlRow>(await sql`
    SELECT COUNT(DISTINCT user_id) AS c FROM activity_logs
    WHERE user_id IS NOT NULL AND created_at >= ${range.fromIso} AND created_at <= ${range.toIso}
  `);
  const newSignups = rows<SqlRow>(await sql`
    SELECT COUNT(*) AS c FROM users
    WHERE created_at >= ${range.fromIso} AND created_at <= ${range.toIso}
  `);
  const totalUsers = rows<SqlRow>(await sql`SELECT COUNT(*) AS c FROM users WHERE is_active = 1`);
  const paidUsers = rows<SqlRow>(await sql`
    SELECT COUNT(*) AS c FROM users u
    JOIN mi_pro_subscriptions mi ON mi.user_id = u.id
    WHERE mi.status = 'active' AND u.is_active = 1
  `);
  const paidByPlan = rows<SqlRow>(await sql`
    SELECT mi.plan AS plan, COUNT(*) AS c
    FROM users u JOIN mi_pro_subscriptions mi ON mi.user_id = u.id
    WHERE mi.status = 'active' AND mi.plan IS NOT NULL
    GROUP BY mi.plan
  `);
  const churned = rows<SqlRow>(await sql`
    SELECT COUNT(*) AS c FROM users u
    JOIN mi_pro_subscriptions mi ON mi.user_id = u.id
    WHERE mi.status IN ('canceled','past_due','unpaid')
      AND mi.period_end >= ${range.fromIso}
      AND mi.period_end <= ${range.toIso}
  `);
  const reqRollup = rows<SqlRow>(await sql`
    SELECT COUNT(*) AS total,
           AVG(json_extract(labels, '$.latency_ms')) AS avg_latency,
           SUM(CASE WHEN CAST(json_extract(labels, '$.status') AS INTEGER) >= 500 THEN 1 ELSE 0 END) AS errors_5xx
    FROM system_metrics
    WHERE metric_name = 'request' AND timestamp >= ${range.fromIso} AND timestamp <= ${range.toIso}
  `);
  const topPagesRaw = rows<SqlRow>(await sql`
    SELECT json_extract(labels, '$.endpoint') AS endpoint, COUNT(*) AS hits
    FROM system_metrics
    WHERE metric_name = 'request' AND timestamp >= ${range.fromIso} AND timestamp <= ${range.toIso}
    GROUP BY endpoint ORDER BY hits DESC LIMIT 10
  `);
  const latSample = rows<SqlRow>(await sql`
    SELECT CAST(json_extract(labels, '$.latency_ms') AS REAL) AS l
    FROM system_metrics
    WHERE metric_name = 'request' AND timestamp >= ${range.fromIso} AND timestamp <= ${range.toIso}
    ORDER BY id DESC LIMIT 5000
  `);
  const lats = latSample.map(r => num(r.l)).filter(n => n > 0).sort((a, b) => a - b);
  const pct = (arr: number[], p: number) => arr.length === 0 ? 0 : Math.round(arr[Math.min(arr.length - 1, Math.floor(arr.length * p))]);
  const dauRaw = rows<SqlRow>(await sql`
    SELECT substr(created_at, 1, 10) AS day, COUNT(DISTINCT user_id) AS active
    FROM activity_logs
    WHERE user_id IS NOT NULL AND created_at >= ${range.fromIso} AND created_at <= ${range.toIso}
    GROUP BY day ORDER BY day ASC
  `);

  const totalU = num(totalUsers[0]?.c);
  const paidU  = num(paidUsers[0]?.c);
  const conversion = totalU > 0 ? (paidU / totalU) * 100 : 0;

  let mrr = 0;
  for (const row of paidByPlan) mrr += priceFor(priceMap, str(row.plan)) * num(row.c);
  const arr = mrr * 12;

  const sessionRows = rows<SqlRow>(await sql`
    SELECT user_id, COUNT(DISTINCT substr(created_at, 1, 13)) AS hours
    FROM activity_logs
    WHERE user_id IS NOT NULL AND created_at >= ${range.fromIso} AND created_at <= ${range.toIso}
    GROUP BY user_id
  `);
  const avgSessionMin = sessionRows.length === 0
    ? 0
    : Math.round((sessionRows.reduce((a, r) => a + num(r.hours), 0) / sessionRows.length) * 30);

  const total = num(reqRollup[0]?.total);
  const errors5xx = num(reqRollup[0]?.errors_5xx);
  const churnedC = num(churned[0]?.c);
  const activeC = num(active[0]?.c);
  const newC = num(newSignups[0]?.c);
  // Task #13 — explicit no-data marker so the UI can render an empty
  // pill instead of zero-stat cards that look like a load failure.
  const isEmpty = activeC === 0 && newC === 0 && total === 0;

  return {
    range: { from: range.from, to: range.to, days: range.days },
    active_users: activeC,
    new_signups: newC,
    total_users: totalU,
    paid_users: paidU,
    conversion_to_paid_pct: Number(conversion.toFixed(2)),
    mrr_usd: mrr,
    arr_usd: arr,
    mrr: disp.conv(mrr),
    arr: disp.conv(arr),
    display_currency: disp.currency,
    fx_as_of: disp.asOf,
    churned_subscriptions: churnedC,
    churn_rate_pct: paidU > 0 ? Number(((churnedC / paidU) * 100).toFixed(2)) : 0,
    avg_session_minutes: avgSessionMin,
    p50_latency_ms: pct(lats, 0.5),
    p95_latency_ms: pct(lats, 0.95),
    error_rate_pct: total > 0 ? Number(((errors5xx / total) * 100).toFixed(2)) : 0,
    total_requests: total,
    top_pages: topPagesRaw.map(r => ({ endpoint: str(r.endpoint), hits: num(r.hits) })),
    daily_active: dauRaw.map(r => ({ day: str(r.day), active: num(r.active) })),
    meta: isEmpty ? { reason: 'no_data' } : { reason: 'ok' },
  } as OverviewReport;
}

export async function loadCohorts(env: Env, granularity: 'week' | 'month', metric: 'retention' | 'revenue') {
  const sql = getSQL(env);
  // Revenue mode joins `subscription_plans` directly in SQL (rather than
  // loading the price map into JS), so we self-heal the table here for
  // environments where migration 004 hasn't been applied yet — otherwise
  // the endpoint would 500 instead of returning $0 cohorts.
  if (metric === 'revenue') await ensureSubscriptionPlansSchema(env);
  // Build a fully-qualified version of `fmt` for the JOIN query below; the
  // unqualified `created_at` would be ambiguous once `subscription_plans`
  // (which also has its own `created_at`) is joined in.
  const fmt = granularity === 'week'
    ? "strftime('%Y-W%W', created_at)"
    : "strftime('%Y-%m', created_at)";
  const fmtU = granularity === 'week'
    ? "strftime('%Y-W%W', u.created_at)"
    : "strftime('%Y-%m', u.created_at)";
  if (metric === 'revenue') {
    const r = rows<SqlRow>(await sql.unsafe(
      `SELECT ${fmtU} AS cohort, COUNT(*) AS signups,
              SUM(CASE WHEN mi.status='active' THEN 1 ELSE 0 END) AS paying,
              SUM(CASE WHEN mi.status='active'
                       THEN COALESCE(sp.monthly_price_usd, 0) ELSE 0 END) AS mrr_usd
         FROM users u
         LEFT JOIN mi_pro_subscriptions mi ON mi.user_id = u.id
         LEFT JOIN subscription_plans sp ON sp.plan_id = mi.plan
         WHERE u.created_at >= datetime('now','-12 months')
         GROUP BY cohort ORDER BY cohort ASC`,
    ));
    return { metric, granularity, cohorts: r };
  }
  const r = rows<SqlRow>(await sql.unsafe(
    `SELECT ${fmt} AS cohort, COUNT(*) AS signups,
            SUM(CASE WHEN id IN (
                SELECT DISTINCT user_id FROM activity_logs
                 WHERE user_id IS NOT NULL AND created_at >= datetime('now','-30 days')
            ) THEN 1 ELSE 0 END) AS retained_30d
       FROM users
       WHERE created_at >= datetime('now','-12 months')
       GROUP BY cohort ORDER BY cohort ASC`,
  ));
  return { metric, granularity, cohorts: r };
}

export async function loadUsers(env: Env, opts: {
  role?: string | null; tier?: string | null; search?: string | null;
  limit: number; offset: number;
}) {
  const sql = getSQL(env);
  const filters: string[] = ['u.is_active = 1'];
  const params: Array<string | number> = [];
  if (opts.role) { filters.push('u.role = ?'); params.push(opts.role); }
  if (opts.tier) { filters.push('mi.plan = ?'); params.push(opts.tier); }
  if (opts.search) {
    filters.push('(LOWER(u.email) LIKE ? OR LOWER(u.name) LIKE ?)');
    const s = `%${opts.search.toLowerCase()}%`;
    params.push(s, s);
  }
  const where = filters.join(' AND ');
  const priceMap = await loadPlanPriceMap(env);
  const raw = rows<SqlRow>(await sql.unsafe(
    `SELECT u.id, u.email, u.name, u.role, u.created_at,
            mi.status AS sub_status,
            mi.plan   AS sub_plan,
            (SELECT MAX(last_seen_at) FROM user_sessions WHERE user_id = u.id) AS last_seen_at,
            (SELECT COUNT(*) FROM activity_logs a WHERE a.user_id = u.id
                 AND a.created_at >= datetime('now','-30 days')) AS sessions_30d,
            (SELECT COUNT(*) FROM projects p WHERE p.founder_id = u.founder_id) AS project_count
       FROM users u
       LEFT JOIN mi_pro_subscriptions mi ON mi.user_id = u.id
       WHERE ${where}
       ORDER BY u.created_at DESC
       LIMIT ? OFFSET ?`,
    [...params, opts.limit, opts.offset],
  ));
  const totalRow = rows<SqlRow>(await sql.unsafe(`SELECT COUNT(*) AS c FROM users u LEFT JOIN mi_pro_subscriptions mi ON mi.user_id = u.id WHERE ${where}`, params));
  const enriched = raw.map(r => ({
    id: num(r.id),
    email: str(r.email),
    name: str(r.name),
    role: str(r.role),
    created_at: str(r.created_at),
    sub_status: str(r.sub_status),
    sub_plan: str(r.sub_plan),
    last_seen_at: r.last_seen_at ? str(r.last_seen_at) : null,
    sessions_30d: num(r.sessions_30d),
    project_count: num(r.project_count),
    lifetime_value_usd: priceFor(priceMap, str(r.sub_plan)) * 12,
  }));
  return { users: enriched, total: num(totalRow[0]?.c), limit: opts.limit, offset: opts.offset };
}

export async function loadUser(env: Env, id: number) {
  const sql = getSQL(env);
  const priceMap = await loadPlanPriceMap(env);
  const u = rows<SqlRow>(await sql`
    SELECT u.id, u.email, u.name, u.role, u.created_at,
           mi.status AS sub_status,
           mi.plan AS sub_plan,
           mi.period_end AS sub_period_end
    FROM users u LEFT JOIN mi_pro_subscriptions mi ON mi.user_id = u.id
    WHERE u.id = ${id}
  `);
  if (u.length === 0) return null;
  const featureUsage = rows<SqlRow>(await sql`
    SELECT action, COUNT(*) AS c FROM activity_logs
    WHERE user_id = ${id} AND created_at >= datetime('now','-90 days')
    GROUP BY action ORDER BY c DESC LIMIT 25
  `);
  const errorCount = rows<SqlRow>(await sql`
    SELECT COUNT(*) AS c FROM error_logs
    WHERE user_id = ${id} AND created_at >= datetime('now','-90 days')
  `);
  const tickets = await sql`
    SELECT id, subject, status, created_at FROM tickets
    WHERE user_id = ${id} ORDER BY created_at DESC LIMIT 25
  `.then(r => rows<SqlRow>(r)).catch(() => [] as SqlRow[]);
  // Billing history: pull from subscription_events if present, else synthesize
  // a single row from current users.mi_subscription_* state.
  const billingHistory = await sql`
    SELECT event_type, plan, amount_usd, status, occurred_at
    FROM subscription_events WHERE user_id = ${id}
    ORDER BY occurred_at DESC LIMIT 50
  `.then(r => rows<SqlRow>(r)).catch(() => [] as SqlRow[]);
  const billing = billingHistory.length > 0
    ? billingHistory.map(b => ({
        event_type: str(b.event_type),
        plan: str(b.plan),
        amount_usd: num(b.amount_usd),
        status: str(b.status),
        occurred_at: str(b.occurred_at),
      }))
    : (u[0].sub_plan
        ? [{
            event_type: 'current_state',
            plan: str(u[0].sub_plan),
            amount_usd: priceFor(priceMap, str(u[0].sub_plan)),
            status: str(u[0].sub_status),
            occurred_at: str(u[0].sub_period_end || u[0].created_at),
          }]
        : []);
  return {
    user: {
      id: num(u[0].id),
      email: str(u[0].email),
      name: str(u[0].name),
      role: str(u[0].role),
      created_at: str(u[0].created_at),
      sub_status: str(u[0].sub_status),
      sub_plan: str(u[0].sub_plan),
      sub_period_end: u[0].sub_period_end ? str(u[0].sub_period_end) : null,
    },
    feature_usage: featureUsage.map(r => ({ action: str(r.action), c: num(r.c) })),
    support_tickets: tickets.map(r => ({
      id: num(r.id), subject: str(r.subject), status: str(r.status), created_at: str(r.created_at),
    })),
    billing_history: billing,
    error_count_90d: num(errorCount[0]?.c),
    lifetime_value_usd: priceFor(priceMap, str(u[0].sub_plan)) * 12,
  };
}

export interface FinancialReport {
  range: { from: string; to: string };
  // USD figures kept for back-compat; new `*_display` fields carry the
  // chosen display currency. Per-tier rows additionally surface the plan's
  // native currency (what Stripe actually charged).
  total_mrr_usd: number; arr_usd: number; new_mrr_usd: number;
  expansion_mrr_usd: number; churn_mrr_usd: number;
  total_mrr: number; arr: number; new_mrr: number; churn_mrr: number;
  display_currency: string; fx_as_of: string | null;
  mrr_breakdown_by_tier: Array<{
    plan: string; subscribers: number;
    monthly_price_usd: number; mrr_usd: number;
    monthly_price: number; mrr: number;
    native_currency: string; native_monthly_price: number; native_mrr: number;
  }>;
  ltv_by_cohort: Array<{ cohort: string; signups: number; paying: number;
    estimated_ltv_usd: number; estimated_ltv: number }>;
  // Task #5 — assistant cost rollup (optional so old serialised reports
  // without this field still type-check on the consumer side).
  assistant_cost?: AssistantCostReport;
  // Task #13 — see OverviewReport.meta.
  meta?: { reason: 'ok' | 'no_data' };
}

export async function loadFinancial(env: Env, range: DateRange, currency?: string | null): Promise<FinancialReport> {
  const sql = getSQL(env);
  // Same self-heal as `loadCohorts` revenue mode — the LTV-by-cohort query
  // below joins `subscription_plans` directly.
  await ensureSubscriptionPlansSchema(env);
  const priceMap = await loadPlanPriceMap(env);
  const disp = await displayContext(env, currency);
  const byTier = rows<SqlRow>(await sql`
    SELECT mi.plan AS plan, COUNT(*) AS subscribers
    FROM users u JOIN mi_pro_subscriptions mi ON mi.user_id = u.id
    WHERE mi.status = 'active' AND mi.plan IS NOT NULL
    GROUP BY mi.plan
  `);
  const breakdown = byTier.map(r => {
    const plan = str(r.plan);
    const subs = num(r.subscribers);
    const usdPrice = priceFor(priceMap, plan);
    const usdMrr = usdPrice * subs;
    const pricing: PlanPricing | undefined = priceMap.get(plan);
    const nativeCcy = pricing?.currency || 'USD';
    const nativePrice = pricing?.nativeAmount ?? usdPrice;
    return {
      plan,
      subscribers: subs,
      monthly_price_usd: usdPrice,
      mrr_usd: usdMrr,
      monthly_price: disp.conv(usdPrice),
      mrr: disp.conv(usdMrr),
      native_currency: nativeCcy,
      native_monthly_price: nativePrice,
      native_mrr: nativePrice * subs,
    };
  });
  const totalMrr = breakdown.reduce((a, r) => a + r.mrr_usd, 0);
  const newMrrRows = rows<SqlRow>(await sql`
    SELECT mi.plan AS plan, COUNT(*) AS c
    FROM users u JOIN mi_pro_subscriptions mi ON mi.user_id = u.id
    WHERE mi.status = 'active'
      AND mi.period_end >= ${range.fromIso}
      AND mi.period_end <= ${range.toIso}
    GROUP BY mi.plan
  `);
  const newMrr = newMrrRows.reduce((a, r) => a + priceFor(priceMap, str(r.plan)) * num(r.c), 0);
  const churnRows = rows<SqlRow>(await sql`
    SELECT mi.plan AS plan, COUNT(*) AS c
    FROM users u JOIN mi_pro_subscriptions mi ON mi.user_id = u.id
    WHERE mi.status IN ('canceled','past_due','unpaid')
      AND mi.period_end >= ${range.fromIso}
      AND mi.period_end <= ${range.toIso}
    GROUP BY mi.plan
  `);
  const churnMrr = churnRows.reduce((a, r) => a + priceFor(priceMap, str(r.plan)) * num(r.c), 0);
  // LTV by signup cohort: estimate as paying * avg_plan_price * 12 (1y proxy).
  // Joins `subscription_plans` so newly-launched plans automatically count.
  // `u.created_at` is fully qualified because `subscription_plans` also has a
  // `created_at` column.
  const cohortRows = rows<SqlRow>(await sql`
    SELECT strftime('%Y-%m', u.created_at) AS cohort, COUNT(*) AS signups,
           SUM(CASE WHEN mi.status='active' THEN 1 ELSE 0 END) AS paying,
           SUM(CASE WHEN mi.status='active'
                    THEN COALESCE(sp.monthly_price_usd, 0) ELSE 0 END) AS mrr_per_cohort
      FROM users u
      LEFT JOIN mi_pro_subscriptions mi ON mi.user_id = u.id
      LEFT JOIN subscription_plans sp ON sp.plan_id = mi.plan
      WHERE u.created_at >= datetime('now','-12 months')
      GROUP BY cohort ORDER BY cohort ASC
  `);
  const ltvByCohort = cohortRows.map(r => {
    const ltvUsd = num(r.mrr_per_cohort) * 12;
    return {
      cohort: str(r.cohort),
      signups: num(r.signups),
      paying: num(r.paying),
      estimated_ltv_usd: ltvUsd,
      estimated_ltv: disp.conv(ltvUsd),
    };
  });
  const arrUsd = totalMrr * 12;
  // Task #13 — no-data marker mirrors loadOverview so the Financial sub-tab
  // can render an empty pill instead of a wall of $0 cards.
  const isEmpty = totalMrr === 0 && newMrr === 0 && churnMrr === 0 && breakdown.length === 0;
  return {
    range: { from: range.from, to: range.to },
    total_mrr_usd: totalMrr,
    arr_usd: arrUsd,
    new_mrr_usd: newMrr,
    expansion_mrr_usd: 0,
    churn_mrr_usd: churnMrr,
    total_mrr: disp.conv(totalMrr),
    arr: disp.conv(arrUsd),
    new_mrr: disp.conv(newMrr),
    churn_mrr: disp.conv(churnMrr),
    display_currency: disp.currency,
    fx_as_of: disp.asOf,
    mrr_breakdown_by_tier: breakdown,
    ltv_by_cohort: ltvByCohort,
    assistant_cost: await loadAssistantCost(env, range, disp.conv),
    meta: isEmpty ? { reason: 'no_data' } : { reason: 'ok' },
  } as FinancialReport;
}

// Task #5 — Personal-assistant cost rollup. Surfaced inside the financial
// report (Admin Analytics → Financial sub-tab) so admins can see how much
// the assistant is actually costing per conversation / per active user.
//
// All in micro-USD on the wire (cost_usd_micros / 1e6 = USD); we expose
// rounded $ here for display, plus the display-currency conversion. The
// query is wrapped in try/catch because the assistant_conversations table
// is created lazily on first use — a brand-new dev DB might not have it yet.
export interface AssistantCostReport {
  total_conversations: number;
  total_messages: number;
  total_cost_usd: number;
  total_cost: number;        // display currency
  avg_cost_per_conversation_usd: number;
  avg_cost_per_conversation: number;
  cost_by_model: Array<{ model: string; messages: number; cost_usd: number; cost: number }>;
  top_conversations: Array<{
    uid: string; title: string; user_id: number; messages: number;
    cost_usd: number; cost: number; updated_at: string;
  }>;
}
async function loadAssistantCost(
  env: Env,
  range: DateRange,
  conv: (usd: number) => number,
): Promise<AssistantCostReport> {
  const empty: AssistantCostReport = {
    total_conversations: 0, total_messages: 0,
    total_cost_usd: 0, total_cost: 0,
    avg_cost_per_conversation_usd: 0, avg_cost_per_conversation: 0,
    cost_by_model: [], top_conversations: [],
  };
  try {
    const sql = getSQL(env);
    const totals = rows<SqlRow>(await sql`
      SELECT COUNT(*) AS conversations,
             SUM(message_count) AS messages,
             SUM(cost_usd_micros) AS cost_micros
      FROM assistant_conversations
      WHERE updated_at >= ${range.fromIso} AND updated_at <= ${range.toIso}
    `)[0] || {};
    const totalConv = num(totals.conversations);
    const totalMsg = num(totals.messages);
    const totalCostUsd = num(totals.cost_micros) / 1_000_000;
    const byModel = rows<SqlRow>(await sql`
      SELECT model, COUNT(*) AS messages, SUM(cost_usd_micros) AS cost_micros
      FROM assistant_messages
      WHERE role = 'assistant' AND model IS NOT NULL
        AND created_at >= ${range.fromIso} AND created_at <= ${range.toIso}
      GROUP BY model
      ORDER BY cost_micros DESC
    `).map(r => {
      const usd = num(r.cost_micros) / 1_000_000;
      return { model: str(r.model), messages: num(r.messages), cost_usd: usd, cost: conv(usd) };
    });
    const top = rows<SqlRow>(await sql`
      SELECT uid, title, user_id, message_count, cost_usd_micros, updated_at
      FROM assistant_conversations
      WHERE updated_at >= ${range.fromIso} AND updated_at <= ${range.toIso}
      ORDER BY cost_usd_micros DESC LIMIT 10
    `).map(r => {
      const usd = num(r.cost_usd_micros) / 1_000_000;
      return {
        uid: str(r.uid), title: str(r.title), user_id: num(r.user_id),
        messages: num(r.message_count),
        cost_usd: usd, cost: conv(usd),
        updated_at: str(r.updated_at),
      };
    });
    return {
      total_conversations: totalConv,
      total_messages: totalMsg,
      total_cost_usd: totalCostUsd,
      total_cost: conv(totalCostUsd),
      avg_cost_per_conversation_usd: totalConv > 0 ? totalCostUsd / totalConv : 0,
      avg_cost_per_conversation: totalConv > 0 ? conv(totalCostUsd / totalConv) : 0,
      cost_by_model: byModel,
      top_conversations: top,
    };
  } catch {
    return empty;
  }
}

export interface TechnicalReport {
  range: { from: string; to: string };
  by_route: Array<{
    endpoint: string; hits: number; avg_latency_ms: number;
    p50_ms: number; p95_ms: number; p99_ms: number;
    errors_5xx: number; error_rate_pct: number;
  }>;
  error_rate_by_route: Array<{ endpoint: string; error_rate_pct: number; errors_5xx: number; hits: number }>;
  slow_queries: Array<{ endpoint: string; p95_ms: number; hits: number }>;
  queue_depth: number; dlq_count: number;
  top_errors: Array<{ endpoint: string; status_code: number; message: string; c: number }>;
  // Task #13 — see OverviewReport.meta.
  meta?: { reason: 'ok' | 'no_data' };
}

// Task #13 — read true edge-level traffic + latency from Workers Analytics
// Engine when both CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_AE_API_TOKEN are
// configured. Returns null when AE is unconfigured or the query fails so
// the caller falls back to D1 `system_metrics`. Uses the SQL HTTP endpoint
// (`api.cloudflare.com/.../analytics_engine/sql`) — see wrangler.toml's
// `[[analytics_engine_datasets]]` block for the dataset name.
async function loadTechnicalFromAnalyticsEngine(
  env: Env,
  range: DateRange,
): Promise<TechnicalReport['by_route'] | null> {
  const accountId = env.CLOUDFLARE_ACCOUNT_ID;
  const token = env.CLOUDFLARE_AE_API_TOKEN;
  if (!accountId || !token) return null;
  // AE timestamps are stored in UTC; bound by range.from/to as date-only.
  const sqlText = `
    SELECT blob1 AS endpoint,
           COUNT() AS hits,
           AVG(double1) AS avg_latency_ms,
           QUANTILEMERGE(0.5, double1) AS p50,
           QUANTILEMERGE(0.95, double1) AS p95,
           QUANTILEMERGE(0.99, double1) AS p99,
           SUMIF(1, double2 >= 500) AS errors_5xx
    FROM studioos_metrics
    WHERE timestamp >= toDateTime('${range.fromIso}')
      AND timestamp <= toDateTime('${range.toIso}')
    GROUP BY blob1
    ORDER BY hits DESC
    LIMIT 25
  `.trim();
  try {
    const res = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${accountId}/analytics_engine/sql`,
      {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'text/plain' },
        body: sqlText,
      },
    );
    if (!res.ok) return null;
    const json = await res.json() as { data?: Array<Record<string, unknown>> };
    const data = Array.isArray(json.data) ? json.data : [];
    if (data.length === 0) return null;
    return data.map(r => {
      const hits = num(r.hits as number);
      const errs = num(r.errors_5xx as number);
      return {
        endpoint: str(r.endpoint as string),
        hits,
        avg_latency_ms: Math.round(num(r.avg_latency_ms as number)),
        p50_ms: Math.round(num(r.p50 as number)),
        p95_ms: Math.round(num(r.p95 as number)),
        p99_ms: Math.round(num(r.p99 as number)),
        errors_5xx: errs,
        error_rate_pct: hits > 0 ? Number(((errs / hits) * 100).toFixed(2)) : 0,
      };
    });
  } catch {
    return null;
  }
}

export async function loadTechnical(env: Env, range: DateRange): Promise<TechnicalReport> {
  const sql = getSQL(env);
  // Task #13 — try Analytics Engine first; D1 path is the fallback.
  const aeByRoute = await loadTechnicalFromAnalyticsEngine(env, range);
  const byRoute = aeByRoute ? null : rows<SqlRow>(await sql`
    SELECT json_extract(labels, '$.endpoint') AS endpoint,
           COUNT(*) AS hits,
           AVG(json_extract(labels, '$.latency_ms')) AS avg_latency,
           SUM(CASE WHEN CAST(json_extract(labels, '$.status') AS INTEGER) >= 500 THEN 1 ELSE 0 END) AS errors_5xx
    FROM system_metrics
    WHERE metric_name = 'request' AND timestamp >= ${range.fromIso} AND timestamp <= ${range.toIso}
    GROUP BY endpoint ORDER BY hits DESC LIMIT 25
  `);
  let enriched: TechnicalReport['by_route'];
  if (aeByRoute) {
    // AE already returns p50/p95/p99 via QUANTILEMERGE — no per-route
    // backfill query needed.
    enriched = aeByRoute;
  } else {
    enriched = [];
    for (const r of (byRoute as SqlRow[])) {
      const ep = str(r.endpoint);
      const lats = rows<SqlRow>(await sql`
        SELECT CAST(json_extract(labels, '$.latency_ms') AS REAL) AS l
        FROM system_metrics
        WHERE metric_name = 'request' AND json_extract(labels, '$.endpoint') = ${ep}
          AND timestamp >= ${range.fromIso} AND timestamp <= ${range.toIso}
        ORDER BY id DESC LIMIT 500
      `);
      const arr = lats.map(x => num(x.l)).filter(n => n > 0).sort((a, b) => a - b);
      const p = (q: number) => arr.length === 0 ? 0 : Math.round(arr[Math.min(arr.length - 1, Math.floor(arr.length * q))]);
      const hits = num(r.hits);
      const errs = num(r.errors_5xx);
      enriched.push({
        endpoint: ep,
        hits,
        avg_latency_ms: Math.round(num(r.avg_latency)),
        errors_5xx: errs,
        error_rate_pct: hits > 0 ? Number(((errs / hits) * 100).toFixed(2)) : 0,
        p50_ms: p(0.5), p95_ms: p(0.95), p99_ms: p(0.99),
      });
    }
  }
  const queueDepth = await sql`SELECT COUNT(*) AS c FROM queue_jobs WHERE status = 'pending'`
    .then(r => rows<SqlRow>(r)).catch(() => [{ c: 0 } as SqlRow]);
  const dlqCount = await sql`SELECT COUNT(*) AS c FROM dead_letter_queue`
    .then(r => rows<SqlRow>(r)).catch(() => [{ c: 0 } as SqlRow]);
  const topErrorsRaw = rows<SqlRow>(await sql`
    SELECT endpoint, status_code, message, COUNT(*) AS c
    FROM error_logs
    WHERE created_at >= ${range.fromIso} AND created_at <= ${range.toIso}
    GROUP BY endpoint, status_code, message
    ORDER BY c DESC LIMIT 15
  `);
  const errorRateByRoute = enriched
    .map(r => ({ endpoint: r.endpoint, error_rate_pct: r.error_rate_pct, errors_5xx: r.errors_5xx, hits: r.hits }))
    .sort((a, b) => b.error_rate_pct - a.error_rate_pct)
    .slice(0, 15);
  const slowQueries = [...enriched]
    .sort((a, b) => b.p95_ms - a.p95_ms)
    .slice(0, 10)
    .map(r => ({ endpoint: r.endpoint, p95_ms: r.p95_ms, hits: r.hits }));
  // Task #13 — no-data marker for the Technical sub-tab. Queue/DLQ depth
  // is steady-state infra so we only key on traffic + errors.
  const isEmpty = enriched.length === 0 && topErrorsRaw.length === 0;
  return {
    range: { from: range.from, to: range.to },
    by_route: enriched,
    error_rate_by_route: errorRateByRoute,
    slow_queries: slowQueries,
    queue_depth: num(queueDepth[0]?.c),
    dlq_count: num(dlqCount[0]?.c),
    top_errors: topErrorsRaw.map(r => ({
      endpoint: str(r.endpoint),
      status_code: num(r.status_code),
      message: str(r.message),
      c: num(r.c),
    })),
    meta: isEmpty ? { reason: 'no_data' } : { reason: 'ok' },
  } as TechnicalReport;
}

// ---------- CSV / HTML rendering ----------
type CsvVal = string | number | boolean | null | undefined | Record<string, unknown>;
type CsvRow = Record<string, CsvVal>;
export function toCsv(data: CsvRow[], columns?: string[]): string {
  if (!data || data.length === 0) return '';
  const cols = columns || Object.keys(data[0]);
  const esc = (v: CsvVal): string => {
    if (v === null || v === undefined) return '';
    const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
    if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  const head = cols.map(esc).join(',');
  const body = data.map(r => cols.map(c => esc(r[c])).join(',')).join('\n');
  return `${head}\n${body}\n`;
}

type ReportData = OverviewReport | FinancialReport | TechnicalReport
  | { users: ReturnType<typeof loadUsers> extends Promise<infer U> ? (U extends { users: infer X } ? X : never) : never }
  | { overview: OverviewReport; financial: FinancialReport; technical: TechnicalReport };

export function reportToCsv(report: string, data: unknown): string {
  const d = data as Record<string, unknown>;
  if (report === 'overview') {
    const o = d as unknown as OverviewReport;
    const summary: CsvRow[] = [
      { metric: 'active_users', value: o.active_users },
      { metric: 'new_signups', value: o.new_signups },
      { metric: 'total_users', value: o.total_users },
      { metric: 'paid_users', value: o.paid_users },
      { metric: 'conversion_to_paid_pct', value: o.conversion_to_paid_pct },
      { metric: 'mrr_usd', value: o.mrr_usd },
      { metric: 'arr_usd', value: o.arr_usd },
      { metric: `mrr_${(o.display_currency || 'usd').toLowerCase()}`, value: o.mrr },
      { metric: `arr_${(o.display_currency || 'usd').toLowerCase()}`, value: o.arr },
      { metric: 'fx_as_of', value: o.fx_as_of || '' },
      { metric: 'churn_rate_pct', value: o.churn_rate_pct },
      { metric: 'avg_session_minutes', value: o.avg_session_minutes },
      { metric: 'p50_latency_ms', value: o.p50_latency_ms },
      { metric: 'p95_latency_ms', value: o.p95_latency_ms },
      { metric: 'error_rate_pct', value: o.error_rate_pct },
      { metric: 'total_requests', value: o.total_requests },
    ];
    return toCsv(summary, ['metric', 'value']);
  }
  if (report === 'financial') {
    const f = d as unknown as FinancialReport;
    const header = `# display_currency=${f.display_currency || 'USD'} fx_as_of=${f.fx_as_of || ''}\n`;
    return header
      + toCsv(f.mrr_breakdown_by_tier as unknown as CsvRow[],
          ['plan', 'subscribers', 'native_currency', 'native_monthly_price', 'native_mrr',
           'monthly_price_usd', 'mrr_usd', 'monthly_price', 'mrr'])
      + '\n' + toCsv(f.ltv_by_cohort as unknown as CsvRow[],
          ['cohort', 'signups', 'paying', 'estimated_ltv_usd', 'estimated_ltv']);
  }
  if (report === 'technical') {
    const t = d as unknown as TechnicalReport;
    return toCsv(t.by_route as unknown as CsvRow[], ['endpoint', 'hits', 'avg_latency_ms', 'p50_ms', 'p95_ms', 'p99_ms', 'errors_5xx', 'error_rate_pct'])
      + '\n' + toCsv(t.slow_queries as unknown as CsvRow[], ['endpoint', 'p95_ms', 'hits']);
  }
  if (report === 'users') {
    const arr = (d.users as CsvRow[]) || [];
    return toCsv(arr, ['id', 'email', 'name', 'role', 'sub_status', 'sub_plan', 'sessions_30d', 'project_count', 'lifetime_value_usd', 'last_seen_at', 'created_at']);
  }
  // management
  const m = d as { overview?: OverviewReport; financial?: FinancialReport; technical?: TechnicalReport };
  const rowsOut: CsvRow[] = [
    { section: 'overview', metric: 'active_users', value: m.overview?.active_users ?? 0 },
    { section: 'overview', metric: 'new_signups', value: m.overview?.new_signups ?? 0 },
    { section: 'overview', metric: 'mrr_usd', value: m.overview?.mrr_usd ?? 0 },
    { section: 'overview', metric: 'arr_usd', value: m.overview?.arr_usd ?? 0 },
    { section: 'overview', metric: 'churn_rate_pct', value: m.overview?.churn_rate_pct ?? 0 },
    { section: 'financial', metric: 'new_mrr_usd', value: m.financial?.new_mrr_usd ?? 0 },
    { section: 'financial', metric: 'churn_mrr_usd', value: m.financial?.churn_mrr_usd ?? 0 },
    { section: 'technical', metric: 'queue_depth', value: m.technical?.queue_depth ?? 0 },
    { section: 'technical', metric: 'dlq_count', value: m.technical?.dlq_count ?? 0 },
  ];
  return toCsv(rowsOut, ['section', 'metric', 'value']);
}

// Task #20 — CSV export of the Plan change history panel.
// Each row is one admin_audit_log entry where action='subscription_plan_update'.
// `filters_json` is a JSON object describing the diff (created/deleted/price/etc.);
// we surface it as a single human-readable "change_summary" column AND keep the
// raw JSON so finance can re-parse if needed.
export interface PlanAuditRow {
  id: number;
  exported_at: string;
  admin_user_id: number;
  admin_email: string | null;
  admin_name: string | null;
  report_type: string | null; // plan_id
  format: string | null; // 'create' | 'patch' | 'delete'
  filters_json: string | null;
}
function describePlanPatch(raw: string | null): string {
  if (!raw) return '';
  let parsed: Record<string, unknown>;
  try { parsed = JSON.parse(raw) as Record<string, unknown>; } catch { return String(raw); }
  if (!parsed || typeof parsed !== 'object') return String(raw);
  const parts: string[] = [];
  if (parsed.deleted) {
    const label = parsed.display_name ? `"${String(parsed.display_name)}"` : '';
    parts.push(label ? `deleted (${label})` : 'deleted');
    return parts.join(' · ');
  }
  if (parsed.created) {
    parts.push('created');
    if (parsed.stripe_price_id) parts.push(`stripe → ${String(parsed.stripe_price_id)}`);
  }
  if (parsed.monthly_price_usd !== undefined && parsed.monthly_price_usd !== null) {
    parts.push(`price → $${Number(parsed.monthly_price_usd)}`);
  }
  if (parsed.display_name !== undefined) {
    const v = parsed.display_name;
    parts.push(`name → ${v == null || v === '' ? '(none)' : `"${String(v)}"`}`);
  }
  if (parsed.is_active !== undefined) {
    parts.push(parsed.is_active ? 'activated' : 'deactivated');
  }
  if (parsed.currency !== undefined && parsed.currency !== null && !parsed.created && !parsed.deleted) {
    parts.push(`currency → ${String(parsed.currency)}`);
  }
  if (parsed.native_amount !== undefined && parsed.native_amount !== null && !parsed.created && !parsed.deleted) {
    parts.push(`native → ${Number(parsed.native_amount)}`);
  }
  return parts.join(' · ');
}
export function planAuditToCsv(rows: PlanAuditRow[]): string {
  const data: CsvRow[] = rows.map(r => ({
    id: r.id,
    exported_at_utc: r.exported_at || '',
    plan_id: r.report_type || '',
    change_type: r.format || '',
    change_summary: describePlanPatch(r.filters_json),
    admin_user_id: r.admin_user_id,
    admin_email: r.admin_email || '',
    admin_name: r.admin_name || '',
    raw_diff_json: r.filters_json || '',
  }));
  return toCsv(data, [
    'id', 'exported_at_utc', 'plan_id', 'change_type', 'change_summary',
    'admin_user_id', 'admin_email', 'admin_name', 'raw_diff_json',
  ]);
}

const LOGO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="28" height="28">
  <rect x="2" y="2" width="28" height="28" rx="6" fill="#7c3aed"/>
  <text x="16" y="21" text-anchor="middle" font-family="Arial,sans-serif" font-weight="700" font-size="14" fill="#fff">A</text>
</svg>`;

function svgBarChart(rowsIn: Array<{ label: string; value: number }>, title: string): string {
  if (!rowsIn || rowsIn.length === 0) return '';
  const max = Math.max(1, ...rowsIn.map(r => r.value || 0));
  const bw = 30, gap = 10, h = 120;
  const w = rowsIn.length * (bw + gap) + gap;
  const bars = rowsIn.map((r, i) => {
    const bh = Math.round((r.value / max) * (h - 30));
    const x = gap + i * (bw + gap);
    const y = h - 20 - bh;
    return `<rect x="${x}" y="${y}" width="${bw}" height="${bh}" fill="#7c3aed" rx="2"/>
      <text x="${x + bw / 2}" y="${h - 6}" text-anchor="middle" font-size="9" fill="#555">${escXml(r.label)}</text>
      <text x="${x + bw / 2}" y="${y - 2}" text-anchor="middle" font-size="9" fill="#333">${r.value}</text>`;
  }).join('');
  return `<div class="chart"><div class="chart-title">${escXml(title)}</div>
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="100%" height="${h}">${bars}</svg></div>`;
}
function escXml(s: string): string {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

export function reportToHtml(report: string, data: unknown, range: DateRange): string {
  const d = data as Record<string, unknown>;
  const esc = escXml;
  const table = (title: string, rowsIn: Array<Record<string, unknown>>, cols: string[]) => `
    <h2>${esc(title)}</h2>
    <table>
      <thead><tr>${cols.map(c => `<th>${esc(c)}</th>`).join('')}</tr></thead>
      <tbody>${(rowsIn || []).map(r => `<tr>${cols.map(c => `<td>${esc(String(r[c] ?? ''))}</td>`).join('')}</tr>`).join('')}</tbody>
    </table>`;

  let body = '';
  // Task #14 — currency-aware money formatter (falls back to USD).
  const fmtMoney = (amount: number, code: string) => {
    try {
      return new Intl.NumberFormat('en-US', { style: 'currency', currency: code || 'USD', maximumFractionDigits: 0 }).format(amount);
    } catch { return `${code} ${amount}`; }
  };
  if (report === 'overview' || report === 'management') {
    const o = (report === 'management' ? d.overview : d) as OverviewReport;
    const ccy = o?.display_currency || 'USD';
    const asOf = o?.fx_as_of ? ` <span style="font-size:9px;color:#888">(FX as of ${esc(o.fx_as_of.slice(0, 10))})</span>` : '';
    body += `<h2>Key metrics${asOf}</h2>
      <div class="grid">
        <div class="card"><div class="lbl">Active users</div><div class="val">${esc(String(o?.active_users))}</div></div>
        <div class="card"><div class="lbl">New signups</div><div class="val">${esc(String(o?.new_signups))}</div></div>
        <div class="card"><div class="lbl">MRR (${esc(ccy)})</div><div class="val">${esc(fmtMoney(o?.mrr ?? o?.mrr_usd ?? 0, ccy))}</div></div>
        <div class="card"><div class="lbl">ARR (${esc(ccy)})</div><div class="val">${esc(fmtMoney(o?.arr ?? o?.arr_usd ?? 0, ccy))}</div></div>
        <div class="card"><div class="lbl">Conversion to paid</div><div class="val">${esc(String(o?.conversion_to_paid_pct))}%</div></div>
        <div class="card"><div class="lbl">Churn rate</div><div class="val">${esc(String(o?.churn_rate_pct))}%</div></div>
        <div class="card"><div class="lbl">P50 latency</div><div class="val">${esc(String(o?.p50_latency_ms))}ms</div></div>
        <div class="card"><div class="lbl">P95 latency</div><div class="val">${esc(String(o?.p95_latency_ms))}ms</div></div>
        <div class="card"><div class="lbl">Error rate</div><div class="val">${esc(String(o?.error_rate_pct))}%</div></div>
      </div>`;
    body += svgBarChart((o?.daily_active || []).slice(-14).map(r => ({ label: r.day.slice(5), value: r.active })), 'Daily active users (last 14 days)');
    body += table('Top pages', o?.top_pages || [], ['endpoint', 'hits']);
  }
  if (report === 'financial' || report === 'management') {
    const f = (report === 'management' ? d.financial : d) as FinancialReport;
    const ccy = f?.display_currency || 'USD';
    const asOf = f?.fx_as_of ? ` <span style="font-size:9px;color:#888">(FX as of ${esc(f.fx_as_of.slice(0, 10))})</span>` : '';
    body += `<p>Display currency: <strong>${esc(ccy)}</strong>${asOf}</p>`;
    body += `<p><strong>Total MRR:</strong> ${esc(fmtMoney(f?.total_mrr ?? f?.total_mrr_usd ?? 0, ccy))} ·
             <strong>ARR:</strong> ${esc(fmtMoney(f?.arr ?? f?.arr_usd ?? 0, ccy))} ·
             <strong>New MRR:</strong> ${esc(fmtMoney(f?.new_mrr ?? f?.new_mrr_usd ?? 0, ccy))} ·
             <strong>Churn MRR:</strong> ${esc(fmtMoney(f?.churn_mrr ?? f?.churn_mrr_usd ?? 0, ccy))}</p>`;
    body += svgBarChart((f?.mrr_breakdown_by_tier || []).map(r => ({ label: r.plan, value: r.mrr ?? r.mrr_usd })), `MRR by tier (${ccy})`);
    body += table('MRR breakdown by tier', f?.mrr_breakdown_by_tier as unknown as Array<Record<string, unknown>> || [],
      ['plan', 'subscribers', 'native_currency', 'native_monthly_price', 'native_mrr', 'monthly_price', 'mrr']);
    body += table('LTV by cohort', f?.ltv_by_cohort as unknown as Array<Record<string, unknown>> || [],
      ['cohort', 'signups', 'paying', 'estimated_ltv']);
  }
  if (report === 'technical' || report === 'management') {
    const t = (report === 'management' ? d.technical : d) as TechnicalReport;
    body += `<p><strong>Queue depth:</strong> ${esc(String(t?.queue_depth))} · <strong>DLQ:</strong> ${esc(String(t?.dlq_count))}</p>`;
    body += table('Per-route latency', t?.by_route as unknown as Array<Record<string, unknown>> || [], ['endpoint', 'hits', 'p50_ms', 'p95_ms', 'p99_ms', 'errors_5xx', 'error_rate_pct']);
    body += table('Slow queries (P95)', t?.slow_queries as unknown as Array<Record<string, unknown>> || [], ['endpoint', 'p95_ms', 'hits']);
    body += table('Top errors', t?.top_errors as unknown as Array<Record<string, unknown>> || [], ['endpoint', 'status_code', 'message', 'c']);
  }
  if (report === 'users') {
    const arr = (d.users as Array<Record<string, unknown>>) || [];
    body += table('Users', arr, ['id', 'email', 'name', 'role', 'sub_status', 'sub_plan', 'sessions_30d', 'project_count', 'lifetime_value_usd']);
  }

  return `<!doctype html>
<html><head><meta charset="utf-8"><title>Axal StudioOS — ${esc(report)} report</title>
<style>
  @page { size: A4; margin: 18mm; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; color: #111; max-width: 980px; margin: 24px auto; padding: 0 16px; }
  header { border-bottom: 2px solid #7c3aed; padding-bottom: 12px; margin-bottom: 18px; display:flex; align-items:center; justify-content:space-between; gap: 12px; }
  header .brand { display: flex; align-items: center; gap: 10px; }
  header h1 { margin: 0; font-size: 22px; color: #4c1d95; }
  header .meta { font-size: 12px; color: #555; text-align: right; }
  h2 { font-size: 15px; margin-top: 24px; color: #333; border-bottom: 1px solid #eee; padding-bottom: 4px; }
  table { width: 100%; border-collapse: collapse; font-size: 12px; margin-top: 8px; }
  th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid #eee; }
  th { background: #f8f7ff; color: #4c1d95; font-weight: 600; }
  .grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin-top: 8px; }
  .card { border: 1px solid #ece9fe; border-radius: 8px; padding: 10px 12px; background: #fbfaff; }
  .card .lbl { font-size: 10px; text-transform: uppercase; color: #7c3aed; letter-spacing: 0.04em; }
  .card .val { font-size: 18px; font-weight: 700; color: #111; margin-top: 2px; }
  .chart { margin-top: 16px; padding: 8px 10px; border: 1px solid #ece9fe; border-radius: 8px; background: #fff; }
  .chart-title { font-size: 11px; color: #4c1d95; font-weight: 600; margin-bottom: 4px; }
  footer { margin-top: 32px; font-size: 10px; color: #888; text-align: center; }
</style></head>
<body>
<header>
  <div class="brand">${LOGO_SVG}<h1>Axal StudioOS · ${esc(report)} report</h1></div>
  <div class="meta">${esc(range.from)} → ${esc(range.to)}<br/>Generated ${new Date().toISOString()}</div>
</header>
${body}
<footer>Confidential · Internal admin export · Axal Venture Studio</footer>
</body></html>`;
}

// ---------- HMAC-signed download tokens ----------
function b64url(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlDecode(s: string): Uint8Array {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
async function hmacKey(env: Env): Promise<CryptoKey> {
  const secret = env.JWT_SECRET;
  if (!secret || secret.length < 16) {
    if ((env as unknown as { ENVIRONMENT?: string }).ENVIRONMENT === 'production') {
      throw new Error('JWT_SECRET is required to sign analytics download tokens');
    }
    console.warn('[analytics] JWT_SECRET missing/short; using dev fallback');
  }
  return crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret || 'dev-secret-do-not-use'),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify'],
  );
}

export async function signDownloadToken(env: Env, storageKey: string, ttlSec: number): Promise<string> {
  const exp = Math.floor(Date.now() / 1000) + ttlSec;
  const payload = `${storageKey}|${exp}`;
  const key = await hmacKey(env);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload));
  const payloadBytes = new TextEncoder().encode(payload);
  const payloadBuf = payloadBytes.buffer.slice(payloadBytes.byteOffset, payloadBytes.byteOffset + payloadBytes.byteLength) as ArrayBuffer;
  return `${b64url(payloadBuf)}.${b64url(sig)}`;
}

export async function verifyDownloadToken(env: Env, token: string): Promise<{ key: string } | null> {
  try {
    const [pB64, sB64] = token.split('.');
    if (!pB64 || !sB64) return null;
    const payloadBytes = b64urlDecode(pB64);
    const sigBytes = b64urlDecode(sB64);
    const key = await hmacKey(env);
    const ok = await crypto.subtle.verify('HMAC', key, sigBytes, payloadBytes);
    if (!ok) return null;
    const payload = new TextDecoder().decode(payloadBytes);
    const [storageKey, expStr] = payload.split('|');
    if (!storageKey || !expStr) return null;
    if (Math.floor(Date.now() / 1000) > Number(expStr)) return null;
    return { key: storageKey };
  } catch { return null; }
}

// ---------------------------------------------------------------------------
// Task #13 — daily analytics snapshot writer.
//
// Cron entry-point: index.ts `scheduled()` calls `writeDailySnapshot(env)`
// once per day at 02:05 UTC. The function picks "yesterday" in UTC, computes
// the same Overview + Financial numbers in USD, and INSERT OR REPLACEs the
// row keyed on `snapshot_date`. Idempotent — re-runs overwrite, never dup.
//
// Read path: Overview/Financial endpoints live-compute today, but the UI
// can fetch this table directly for any historical comparison without
// re-walking activity_logs / system_metrics (which the nightly cleanup
// prunes). Backfill is a thin loop wrapper that walks N days backward.
// ---------------------------------------------------------------------------

function isoDay(d: Date): string {
  // YYYY-MM-DD in UTC. `toISOString().slice(0,10)` is exactly that.
  return d.toISOString().slice(0, 10);
}

export async function writeDailySnapshot(
  env: Env,
  forDay?: string,
  source: 'cron' | 'backfill' | 'manual' = 'cron',
): Promise<{ snapshot_date: string; written: boolean; reason?: string }> {
  // Self-heal: migration 012 might not have been applied to the remote DB
  // yet. The boot-time migration sweep doesn't include this file, so create
  // the table on first write. Idempotent — IF NOT EXISTS.
  const sql = getSQL(env);
  try {
    await sql`
      CREATE TABLE IF NOT EXISTS analytics_snapshots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        snapshot_date TEXT NOT NULL,
        active_users INTEGER NOT NULL DEFAULT 0,
        new_signups INTEGER NOT NULL DEFAULT 0,
        total_users INTEGER NOT NULL DEFAULT 0,
        paid_users INTEGER NOT NULL DEFAULT 0,
        total_requests INTEGER NOT NULL DEFAULT 0,
        errors_5xx INTEGER NOT NULL DEFAULT 0,
        p50_latency_ms INTEGER NOT NULL DEFAULT 0,
        p95_latency_ms INTEGER NOT NULL DEFAULT 0,
        mrr_usd REAL NOT NULL DEFAULT 0,
        arr_usd REAL NOT NULL DEFAULT 0,
        new_mrr_usd REAL NOT NULL DEFAULT 0,
        churn_mrr_usd REAL NOT NULL DEFAULT 0,
        churned_subscriptions INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        source TEXT NOT NULL DEFAULT 'cron',
        UNIQUE(snapshot_date)
      )
    `;
  } catch (e) {
    return { snapshot_date: forDay || '', written: false, reason: `schema:${(e as Error).message}` };
  }

  // "Yesterday" by default — today is still in flight and would skew.
  const day = forDay || isoDay(new Date(Date.now() - 86400 * 1000));
  const fromIso = `${day} 00:00:00`;
  const toIso = `${day} 23:59:59`;
  const range: DateRange = { from: day, to: day, days: 1, fromIso, toIso };

  try {
    // Task #13 — backfill MUST recompute from source rows; bypass the
    // snapshot read path or rebuilds would just re-copy stale data.
    const overview = await loadOverview(env, range, 'USD', { forceLive: true });
    const financial = await loadFinancial(env, range, 'USD');

    await sql`
      INSERT OR REPLACE INTO analytics_snapshots (
        snapshot_date,
        active_users, new_signups, total_users, paid_users,
        total_requests, errors_5xx, p50_latency_ms, p95_latency_ms,
        mrr_usd, arr_usd, new_mrr_usd, churn_mrr_usd, churned_subscriptions,
        source
      ) VALUES (
        ${day},
        ${overview.active_users}, ${overview.new_signups}, ${overview.total_users}, ${overview.paid_users},
        ${overview.total_requests},
        ${Math.round(overview.total_requests * (overview.error_rate_pct / 100))},
        ${overview.p50_latency_ms}, ${overview.p95_latency_ms},
        ${financial.total_mrr_usd}, ${financial.arr_usd}, ${financial.new_mrr_usd}, ${financial.churn_mrr_usd},
        ${overview.churned_subscriptions},
        ${source}
      )
    `;
    return { snapshot_date: day, written: true };
  } catch (e) {
    return { snapshot_date: day, written: false, reason: (e as Error).message };
  }
}

// Convenience for admin "rebuild last N days" — used by the optional
// `/api/monitoring/analytics/snapshots/backfill` route. Stops on first
// hard failure to keep the surface honest.
export async function backfillSnapshots(
  env: Env,
  days: number,
): Promise<{ written: number; skipped: number; days: string[] }> {
  const written: string[] = [];
  let skipped = 0;
  const today = new Date();
  for (let i = 1; i <= Math.max(1, Math.min(365, days)); i++) {
    const d = new Date(today.getTime() - i * 86400 * 1000);
    const r = await writeDailySnapshot(env, isoDay(d), 'backfill');
    if (r.written) written.push(r.snapshot_date); else skipped++;
  }
  return { written: written.length, skipped, days: written };
}
