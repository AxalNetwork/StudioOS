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
const PLAN_MONTHLY_USD: Record<string, number> = {
  mi_pro_monthly: 49,
  mi_pro_annual:  39,
};
export function planPrice(plan: string | null | undefined): number {
  if (!plan) return 0;
  return PLAN_MONTHLY_USD[plan] || 0;
}

// ---------- queries ----------
export interface OverviewReport {
  range: { from: string; to: string; days: number };
  active_users: number; new_signups: number; total_users: number; paid_users: number;
  conversion_to_paid_pct: number; mrr_usd: number; arr_usd: number;
  churned_subscriptions: number; churn_rate_pct: number; avg_session_minutes: number;
  p50_latency_ms: number; p95_latency_ms: number; error_rate_pct: number; total_requests: number;
  top_pages: Array<{ endpoint: string; hits: number }>;
  daily_active: Array<{ day: string; active: number }>;
}

export async function loadOverview(env: Env, range: DateRange): Promise<OverviewReport> {
  const sql = getSQL(env);
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
    SELECT COUNT(*) AS c FROM users
    WHERE mi_subscription_status = 'active' AND is_active = 1
  `);
  const paidByPlan = rows<SqlRow>(await sql`
    SELECT mi_subscription_plan AS plan, COUNT(*) AS c
    FROM users
    WHERE mi_subscription_status = 'active' AND mi_subscription_plan IS NOT NULL
    GROUP BY mi_subscription_plan
  `);
  const churned = rows<SqlRow>(await sql`
    SELECT COUNT(*) AS c FROM users
    WHERE mi_subscription_status IN ('canceled','past_due','unpaid')
      AND mi_subscription_period_end >= ${range.fromIso}
      AND mi_subscription_period_end <= ${range.toIso}
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
  for (const row of paidByPlan) mrr += planPrice(str(row.plan)) * num(row.c);
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

  return {
    range: { from: range.from, to: range.to, days: range.days },
    active_users: num(active[0]?.c),
    new_signups: num(newSignups[0]?.c),
    total_users: totalU,
    paid_users: paidU,
    conversion_to_paid_pct: Number(conversion.toFixed(2)),
    mrr_usd: mrr,
    arr_usd: arr,
    churned_subscriptions: churnedC,
    churn_rate_pct: paidU > 0 ? Number(((churnedC / paidU) * 100).toFixed(2)) : 0,
    avg_session_minutes: avgSessionMin,
    p50_latency_ms: pct(lats, 0.5),
    p95_latency_ms: pct(lats, 0.95),
    error_rate_pct: total > 0 ? Number(((errors5xx / total) * 100).toFixed(2)) : 0,
    total_requests: total,
    top_pages: topPagesRaw.map(r => ({ endpoint: str(r.endpoint), hits: num(r.hits) })),
    daily_active: dauRaw.map(r => ({ day: str(r.day), active: num(r.active) })),
  };
}

export async function loadCohorts(env: Env, granularity: 'week' | 'month', metric: 'retention' | 'revenue') {
  const sql = getSQL(env);
  const fmt = granularity === 'week'
    ? "strftime('%Y-W%W', created_at)"
    : "strftime('%Y-%m', created_at)";
  if (metric === 'revenue') {
    const r = rows<SqlRow>(await sql.unsafe(
      `SELECT ${fmt} AS cohort, COUNT(*) AS signups,
              SUM(CASE WHEN mi_subscription_status='active' THEN 1 ELSE 0 END) AS paying,
              SUM(CASE WHEN mi_subscription_status='active' THEN
                  CASE mi_subscription_plan
                    WHEN 'mi_pro_monthly' THEN 49
                    WHEN 'mi_pro_annual'  THEN 39
                    ELSE 0 END
                  ELSE 0 END) AS mrr_usd
         FROM users
         WHERE created_at >= datetime('now','-12 months')
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
  if (opts.tier) { filters.push('u.mi_subscription_plan = ?'); params.push(opts.tier); }
  if (opts.search) {
    filters.push('(LOWER(u.email) LIKE ? OR LOWER(u.name) LIKE ?)');
    const s = `%${opts.search.toLowerCase()}%`;
    params.push(s, s);
  }
  const where = filters.join(' AND ');
  const raw = rows<SqlRow>(await sql.unsafe(
    `SELECT u.id, u.email, u.name, u.role, u.created_at,
            u.mi_subscription_status AS sub_status,
            u.mi_subscription_plan   AS sub_plan,
            (SELECT MAX(last_seen_at) FROM user_sessions WHERE user_id = u.id) AS last_seen_at,
            (SELECT COUNT(*) FROM activity_logs a WHERE a.user_id = u.id
                 AND a.created_at >= datetime('now','-30 days')) AS sessions_30d,
            (SELECT COUNT(*) FROM projects p WHERE p.founder_id = u.founder_id) AS project_count
       FROM users u
       WHERE ${where}
       ORDER BY u.created_at DESC
       LIMIT ? OFFSET ?`,
    [...params, opts.limit, opts.offset],
  ));
  const totalRow = rows<SqlRow>(await sql.unsafe(`SELECT COUNT(*) AS c FROM users u WHERE ${where}`, params));
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
    lifetime_value_usd: planPrice(str(r.sub_plan)) * 12,
  }));
  return { users: enriched, total: num(totalRow[0]?.c), limit: opts.limit, offset: opts.offset };
}

export async function loadUser(env: Env, id: number) {
  const sql = getSQL(env);
  const u = rows<SqlRow>(await sql`
    SELECT id, email, name, role, created_at,
           mi_subscription_status AS sub_status,
           mi_subscription_plan AS sub_plan,
           mi_subscription_period_end AS sub_period_end
    FROM users WHERE id = ${id}
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
            amount_usd: planPrice(str(u[0].sub_plan)),
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
    lifetime_value_usd: planPrice(str(u[0].sub_plan)) * 12,
  };
}

export interface FinancialReport {
  range: { from: string; to: string };
  total_mrr_usd: number; arr_usd: number; new_mrr_usd: number;
  expansion_mrr_usd: number; churn_mrr_usd: number;
  mrr_breakdown_by_tier: Array<{ plan: string; subscribers: number; monthly_price_usd: number; mrr_usd: number }>;
  ltv_by_cohort: Array<{ cohort: string; signups: number; paying: number; estimated_ltv_usd: number }>;
}

export async function loadFinancial(env: Env, range: DateRange): Promise<FinancialReport> {
  const sql = getSQL(env);
  const byTier = rows<SqlRow>(await sql`
    SELECT mi_subscription_plan AS plan, COUNT(*) AS subscribers
    FROM users
    WHERE mi_subscription_status = 'active' AND mi_subscription_plan IS NOT NULL
    GROUP BY mi_subscription_plan
  `);
  const breakdown = byTier.map(r => ({
    plan: str(r.plan),
    subscribers: num(r.subscribers),
    monthly_price_usd: planPrice(str(r.plan)),
    mrr_usd: planPrice(str(r.plan)) * num(r.subscribers),
  }));
  const totalMrr = breakdown.reduce((a, r) => a + r.mrr_usd, 0);
  const newMrrRows = rows<SqlRow>(await sql`
    SELECT mi_subscription_plan AS plan, COUNT(*) AS c
    FROM users
    WHERE mi_subscription_status = 'active'
      AND mi_subscription_period_end >= ${range.fromIso}
      AND mi_subscription_period_end <= ${range.toIso}
    GROUP BY mi_subscription_plan
  `);
  const newMrr = newMrrRows.reduce((a, r) => a + planPrice(str(r.plan)) * num(r.c), 0);
  const churnRows = rows<SqlRow>(await sql`
    SELECT mi_subscription_plan AS plan, COUNT(*) AS c
    FROM users
    WHERE mi_subscription_status IN ('canceled','past_due','unpaid')
      AND mi_subscription_period_end >= ${range.fromIso}
      AND mi_subscription_period_end <= ${range.toIso}
    GROUP BY mi_subscription_plan
  `);
  const churnMrr = churnRows.reduce((a, r) => a + planPrice(str(r.plan)) * num(r.c), 0);
  // LTV by signup cohort: estimate as paying * avg_plan_price * 12 (1y proxy).
  const cohortRows = rows<SqlRow>(await sql`
    SELECT strftime('%Y-%m', created_at) AS cohort, COUNT(*) AS signups,
           SUM(CASE WHEN mi_subscription_status='active' THEN 1 ELSE 0 END) AS paying,
           SUM(CASE WHEN mi_subscription_status='active' THEN
               CASE mi_subscription_plan
                 WHEN 'mi_pro_monthly' THEN 49
                 WHEN 'mi_pro_annual'  THEN 39
                 ELSE 0 END
               ELSE 0 END) AS mrr_per_cohort
      FROM users
      WHERE created_at >= datetime('now','-12 months')
      GROUP BY cohort ORDER BY cohort ASC
  `);
  const ltvByCohort = cohortRows.map(r => ({
    cohort: str(r.cohort),
    signups: num(r.signups),
    paying: num(r.paying),
    estimated_ltv_usd: num(r.mrr_per_cohort) * 12,
  }));
  return {
    range: { from: range.from, to: range.to },
    total_mrr_usd: totalMrr,
    arr_usd: totalMrr * 12,
    new_mrr_usd: newMrr,
    expansion_mrr_usd: 0,
    churn_mrr_usd: churnMrr,
    mrr_breakdown_by_tier: breakdown,
    ltv_by_cohort: ltvByCohort,
  };
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
}

export async function loadTechnical(env: Env, range: DateRange): Promise<TechnicalReport> {
  const sql = getSQL(env);
  const byRoute = rows<SqlRow>(await sql`
    SELECT json_extract(labels, '$.endpoint') AS endpoint,
           COUNT(*) AS hits,
           AVG(json_extract(labels, '$.latency_ms')) AS avg_latency,
           SUM(CASE WHEN CAST(json_extract(labels, '$.status') AS INTEGER) >= 500 THEN 1 ELSE 0 END) AS errors_5xx
    FROM system_metrics
    WHERE metric_name = 'request' AND timestamp >= ${range.fromIso} AND timestamp <= ${range.toIso}
    GROUP BY endpoint ORDER BY hits DESC LIMIT 25
  `);
  const enriched: TechnicalReport['by_route'] = [];
  for (const r of byRoute) {
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
  };
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
    return toCsv(f.mrr_breakdown_by_tier as unknown as CsvRow[], ['plan', 'subscribers', 'monthly_price_usd', 'mrr_usd'])
      + '\n' + toCsv(f.ltv_by_cohort as unknown as CsvRow[], ['cohort', 'signups', 'paying', 'estimated_ltv_usd']);
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
  if (report === 'overview' || report === 'management') {
    const o = (report === 'management' ? d.overview : d) as OverviewReport;
    body += `<h2>Key metrics</h2>
      <div class="grid">
        <div class="card"><div class="lbl">Active users</div><div class="val">${esc(String(o?.active_users))}</div></div>
        <div class="card"><div class="lbl">New signups</div><div class="val">${esc(String(o?.new_signups))}</div></div>
        <div class="card"><div class="lbl">MRR</div><div class="val">$${esc(String(o?.mrr_usd))}</div></div>
        <div class="card"><div class="lbl">ARR</div><div class="val">$${esc(String(o?.arr_usd))}</div></div>
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
    body += `<p><strong>Total MRR:</strong> $${esc(String(f?.total_mrr_usd))} · <strong>ARR:</strong> $${esc(String(f?.arr_usd))}
             · <strong>New MRR:</strong> $${esc(String(f?.new_mrr_usd))} · <strong>Churn MRR:</strong> $${esc(String(f?.churn_mrr_usd))}</p>`;
    body += svgBarChart((f?.mrr_breakdown_by_tier || []).map(r => ({ label: r.plan, value: r.mrr_usd })), 'MRR by tier');
    body += table('MRR breakdown by tier', f?.mrr_breakdown_by_tier as unknown as Array<Record<string, unknown>> || [], ['plan', 'subscribers', 'monthly_price_usd', 'mrr_usd']);
    body += table('LTV by cohort', f?.ltv_by_cohort as unknown as Array<Record<string, unknown>> || [], ['cohort', 'signups', 'paying', 'estimated_ltv_usd']);
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
