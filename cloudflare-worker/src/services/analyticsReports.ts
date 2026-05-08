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
 *
 * NOTE — billing data is sourced from local `users.mi_subscription_*`
 * columns rather than re-hitting Stripe each request. The webhook in
 * routes/billing.ts keeps these in sync, so MRR here matches Stripe in
 * steady state. If you need a real-time Stripe pull, do it out-of-band.
 */
import type { Env } from '../types';
import { getSQL } from '../db';

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
  // Clamp range to [1, 366] days to protect D1.
  let days = Math.max(1, Math.min(366, Math.round((to.getTime() - from.getTime()) / 86400000)));
  const fromIso = from.toISOString().replace('T', ' ').slice(0, 19);
  const toIso = to.toISOString().replace('T', ' ').slice(0, 19);
  return {
    from: from.toISOString().slice(0, 10),
    to: to.toISOString().slice(0, 10),
    fromIso, toIso, days,
  };
}

// ---------- pricing (USD/month) ----------
// Mirrors backend/Stripe pricing. Update here if pricing tables change.
const PLAN_MONTHLY_USD: Record<string, number> = {
  mi_pro_monthly: 49,
  mi_pro_annual:  39,   // 39/mo billed annually
};

export function planPrice(plan: string | null | undefined): number {
  if (!plan) return 0;
  return PLAN_MONTHLY_USD[plan] || 0;
}

// ---------- queries ----------
export async function loadOverview(env: Env, range: DateRange) {
  const sql = getSQL(env);
  // Active = distinct user_id in activity_logs in window. Falls back to 0
  // for rows without user_id (e.g. unauth probes).
  const active = await sql`
    SELECT COUNT(DISTINCT user_id) AS c FROM activity_logs
    WHERE user_id IS NOT NULL AND created_at >= ${range.fromIso} AND created_at <= ${range.toIso}
  `;
  const newSignups = await sql`
    SELECT COUNT(*) AS c FROM users
    WHERE created_at >= ${range.fromIso} AND created_at <= ${range.toIso}
  `;
  const totalUsers = await sql`SELECT COUNT(*) AS c FROM users WHERE is_active = 1`;
  const paidUsers = await sql`
    SELECT COUNT(*) AS c FROM users
    WHERE mi_subscription_status = 'active' AND is_active = 1
  `;
  const paidByPlan = await sql`
    SELECT mi_subscription_plan AS plan, COUNT(*) AS c
    FROM users
    WHERE mi_subscription_status = 'active' AND mi_subscription_plan IS NOT NULL
    GROUP BY mi_subscription_plan
  `;
  // Churn = subscriptions whose period_end fell in the window with status not active.
  const churned = await sql`
    SELECT COUNT(*) AS c FROM users
    WHERE mi_subscription_status IN ('canceled','past_due','unpaid')
      AND mi_subscription_period_end >= ${range.fromIso}
      AND mi_subscription_period_end <= ${range.toIso}
  `;
  // System metrics rollup over window.
  const reqRollup = await sql`
    SELECT COUNT(*) AS total,
           AVG(json_extract(labels, '$.latency_ms')) AS avg_latency,
           SUM(CASE WHEN CAST(json_extract(labels, '$.status') AS INTEGER) >= 500 THEN 1 ELSE 0 END) AS errors_5xx
    FROM system_metrics
    WHERE metric_name = 'request' AND timestamp >= ${range.fromIso} AND timestamp <= ${range.toIso}
  `;
  const topPages = await sql`
    SELECT json_extract(labels, '$.endpoint') AS endpoint, COUNT(*) AS hits
    FROM system_metrics
    WHERE metric_name = 'request' AND timestamp >= ${range.fromIso} AND timestamp <= ${range.toIso}
    GROUP BY endpoint ORDER BY hits DESC LIMIT 10
  `;
  // Approximate p50/p95 by sampling latencies. SQLite has no PERCENTILE so we
  // fetch a bounded sample and compute in-memory.
  const latSample: any[] = await sql`
    SELECT CAST(json_extract(labels, '$.latency_ms') AS REAL) AS l
    FROM system_metrics
    WHERE metric_name = 'request' AND timestamp >= ${range.fromIso} AND timestamp <= ${range.toIso}
    ORDER BY id DESC LIMIT 5000
  `;
  const lats = latSample.map(r => Number(r.l) || 0).filter(n => n > 0).sort((a, b) => a - b);
  const pct = (arr: number[], p: number) => arr.length === 0 ? 0 : Math.round(arr[Math.min(arr.length - 1, Math.floor(arr.length * p))]);

  // Daily active users series (for the cohort chart).
  const dau: any[] = await sql`
    SELECT substr(created_at, 1, 10) AS day, COUNT(DISTINCT user_id) AS active
    FROM activity_logs
    WHERE user_id IS NOT NULL AND created_at >= ${range.fromIso} AND created_at <= ${range.toIso}
    GROUP BY day ORDER BY day ASC
  `;

  const totalU = Number(totalUsers[0]?.c || 0);
  const paidU = Number(paidUsers[0]?.c || 0);
  const conversion = totalU > 0 ? (paidU / totalU) * 100 : 0;

  // MRR sum
  let mrr = 0;
  for (const row of paidByPlan) mrr += planPrice(row.plan) * Number(row.c || 0);
  const arr = mrr * 12;

  // Approximate avg session — count distinct (user_id, hour) buckets / users.
  const sessionRows: any[] = await sql`
    SELECT user_id, COUNT(DISTINCT substr(created_at, 1, 13)) AS hours
    FROM activity_logs
    WHERE user_id IS NOT NULL AND created_at >= ${range.fromIso} AND created_at <= ${range.toIso}
    GROUP BY user_id
  `;
  const avgSessionMin = sessionRows.length === 0
    ? 0
    : Math.round((sessionRows.reduce((a: number, r: any) => a + Number(r.hours || 0), 0) / sessionRows.length) * 30);

  const total = Number(reqRollup[0]?.total || 0);
  const errors5xx = Number(reqRollup[0]?.errors_5xx || 0);

  return {
    range: { from: range.from, to: range.to, days: range.days },
    active_users: Number(active[0]?.c || 0),
    new_signups: Number(newSignups[0]?.c || 0),
    total_users: totalU,
    paid_users: paidU,
    conversion_to_paid_pct: Number(conversion.toFixed(2)),
    mrr_usd: mrr,
    arr_usd: arr,
    churned_subscriptions: Number(churned[0]?.c || 0),
    churn_rate_pct: paidU > 0 ? Number(((Number(churned[0]?.c || 0) / paidU) * 100).toFixed(2)) : 0,
    avg_session_minutes: avgSessionMin,
    p50_latency_ms: pct(lats, 0.5),
    p95_latency_ms: pct(lats, 0.95),
    error_rate_pct: total > 0 ? Number(((errors5xx / total) * 100).toFixed(2)) : 0,
    total_requests: total,
    top_pages: topPages,
    daily_active: dau,
  };
}

export async function loadCohorts(env: Env, granularity: 'week' | 'month', metric: 'retention' | 'revenue') {
  const sql = getSQL(env);
  const fmt = granularity === 'week'
    ? "strftime('%Y-W%W', created_at)"
    : "strftime('%Y-%m', created_at)";
  if (metric === 'revenue') {
    // Revenue cohort: signup bucket → current paying count + plan mix.
    const rows: any[] = await sql.unsafe(
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
    );
    return { metric, granularity, cohorts: rows };
  }
  // Retention: cohort by signup, count of users active in last 30d.
  const rows: any[] = await sql.unsafe(
    `SELECT ${fmt} AS cohort, COUNT(*) AS signups,
            SUM(CASE WHEN id IN (
                SELECT DISTINCT user_id FROM activity_logs
                 WHERE user_id IS NOT NULL AND created_at >= datetime('now','-30 days')
            ) THEN 1 ELSE 0 END) AS retained_30d
       FROM users
       WHERE created_at >= datetime('now','-12 months')
       GROUP BY cohort ORDER BY cohort ASC`,
  );
  return { metric, granularity, cohorts: rows };
}

export async function loadUsers(env: Env, opts: {
  role?: string | null; tier?: string | null; search?: string | null;
  limit: number; offset: number;
}) {
  const sql = getSQL(env);
  const filters: string[] = ['u.is_active = 1'];
  const params: any[] = [];
  if (opts.role) { filters.push('u.role = ?'); params.push(opts.role); }
  if (opts.tier) { filters.push('u.mi_subscription_plan = ?'); params.push(opts.tier); }
  if (opts.search) {
    filters.push('(LOWER(u.email) LIKE ? OR LOWER(u.name) LIKE ?)');
    const s = `%${opts.search.toLowerCase()}%`;
    params.push(s, s);
  }
  const where = filters.join(' AND ');
  const rows: any[] = await sql.unsafe(
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
  );
  const totalRow: any[] = await sql.unsafe(`SELECT COUNT(*) AS c FROM users u WHERE ${where}`, params);
  const enriched = rows.map(r => ({
    ...r,
    lifetime_value_usd: planPrice(r.sub_plan) * 12, // ≈ 1y of paid; placeholder
  }));
  return { users: enriched, total: Number(totalRow[0]?.c || 0), limit: opts.limit, offset: opts.offset };
}

export async function loadUser(env: Env, id: number) {
  const sql = getSQL(env);
  const u = await sql`
    SELECT id, email, name, role, created_at,
           mi_subscription_status AS sub_status,
           mi_subscription_plan AS sub_plan,
           mi_subscription_period_end AS sub_period_end
    FROM users WHERE id = ${id}
  `;
  if (u.length === 0) return null;
  const featureUsage = await sql`
    SELECT action, COUNT(*) AS c FROM activity_logs
    WHERE user_id = ${id} AND created_at >= datetime('now','-90 days')
    GROUP BY action ORDER BY c DESC LIMIT 25
  `;
  const errorCount = await sql`
    SELECT COUNT(*) AS c FROM error_logs
    WHERE user_id = ${id} AND created_at >= datetime('now','-90 days')
  `;
  const tickets = await sql`
    SELECT id, subject, status, created_at FROM tickets
    WHERE user_id = ${id} ORDER BY created_at DESC LIMIT 25
  `.catch(() => []);
  return {
    user: u[0],
    feature_usage: featureUsage,
    support_tickets: tickets,
    error_count_90d: Number((errorCount as any)[0]?.c || 0),
    lifetime_value_usd: planPrice((u[0] as any).sub_plan) * 12,
  };
}

export async function loadFinancial(env: Env, range: DateRange) {
  const sql = getSQL(env);
  const byTier: any[] = await sql`
    SELECT mi_subscription_plan AS plan, COUNT(*) AS subscribers
    FROM users
    WHERE mi_subscription_status = 'active' AND mi_subscription_plan IS NOT NULL
    GROUP BY mi_subscription_plan
  `;
  const breakdown = byTier.map((r: any) => ({
    plan: r.plan, subscribers: Number(r.subscribers || 0),
    monthly_price_usd: planPrice(r.plan),
    mrr_usd: planPrice(r.plan) * Number(r.subscribers || 0),
  }));
  const totalMrr = breakdown.reduce((a, r) => a + r.mrr_usd, 0);
  // Approx new MRR = users whose mi row was created (joined paid) in window.
  // No created_at on subscription columns directly, so we approximate via
  // users whose period_end falls in window AND status active (just joined cycle).
  const newMrrRows: any[] = await sql`
    SELECT mi_subscription_plan AS plan, COUNT(*) AS c
    FROM users
    WHERE mi_subscription_status = 'active'
      AND mi_subscription_period_end >= ${range.fromIso}
      AND mi_subscription_period_end <= ${range.toIso}
    GROUP BY mi_subscription_plan
  `;
  const newMrr = newMrrRows.reduce((a: number, r: any) => a + planPrice(r.plan) * Number(r.c || 0), 0);
  const churnRows: any[] = await sql`
    SELECT mi_subscription_plan AS plan, COUNT(*) AS c
    FROM users
    WHERE mi_subscription_status IN ('canceled','past_due','unpaid')
      AND mi_subscription_period_end >= ${range.fromIso}
      AND mi_subscription_period_end <= ${range.toIso}
    GROUP BY mi_subscription_plan
  `;
  const churnMrr = churnRows.reduce((a: number, r: any) => a + planPrice(r.plan) * Number(r.c || 0), 0);
  return {
    range: { from: range.from, to: range.to },
    total_mrr_usd: totalMrr,
    arr_usd: totalMrr * 12,
    new_mrr_usd: newMrr,
    expansion_mrr_usd: 0, // requires plan-change history; not tracked yet
    churn_mrr_usd: churnMrr,
    mrr_breakdown_by_tier: breakdown,
  };
}

export async function loadTechnical(env: Env, range: DateRange) {
  const sql = getSQL(env);
  const byRoute: any[] = await sql`
    SELECT json_extract(labels, '$.endpoint') AS endpoint,
           COUNT(*) AS hits,
           AVG(json_extract(labels, '$.latency_ms')) AS avg_latency,
           SUM(CASE WHEN CAST(json_extract(labels, '$.status') AS INTEGER) >= 500 THEN 1 ELSE 0 END) AS errors_5xx
    FROM system_metrics
    WHERE metric_name = 'request' AND timestamp >= ${range.fromIso} AND timestamp <= ${range.toIso}
    GROUP BY endpoint ORDER BY hits DESC LIMIT 25
  `;
  // Per-route latency percentiles via bounded sample.
  const enriched: any[] = [];
  for (const r of byRoute) {
    const ep = String(r.endpoint || '');
    const lats: any[] = await sql`
      SELECT CAST(json_extract(labels, '$.latency_ms') AS REAL) AS l
      FROM system_metrics
      WHERE metric_name = 'request' AND json_extract(labels, '$.endpoint') = ${ep}
        AND timestamp >= ${range.fromIso} AND timestamp <= ${range.toIso}
      ORDER BY id DESC LIMIT 500
    `;
    const arr = lats.map((x: any) => Number(x.l) || 0).filter(n => n > 0).sort((a, b) => a - b);
    const p = (q: number) => arr.length === 0 ? 0 : Math.round(arr[Math.min(arr.length - 1, Math.floor(arr.length * q))]);
    enriched.push({
      endpoint: ep,
      hits: Number(r.hits || 0),
      avg_latency_ms: Math.round(Number(r.avg_latency) || 0),
      errors_5xx: Number(r.errors_5xx || 0),
      error_rate_pct: r.hits > 0 ? Number(((Number(r.errors_5xx) / Number(r.hits)) * 100).toFixed(2)) : 0,
      p50_ms: p(0.5), p95_ms: p(0.95), p99_ms: p(0.99),
    });
  }
  const queueDepth = await sql`SELECT COUNT(*) AS c FROM queue_jobs WHERE status = 'pending'`.catch(() => [{ c: 0 }]);
  const dlqCount = await sql`SELECT COUNT(*) AS c FROM dead_letter_queue`.catch(() => [{ c: 0 }]);
  const topErrors: any[] = await sql`
    SELECT endpoint, status_code, message, COUNT(*) AS c
    FROM error_logs
    WHERE created_at >= ${range.fromIso} AND created_at <= ${range.toIso}
    GROUP BY endpoint, status_code, message
    ORDER BY c DESC LIMIT 15
  `;
  return {
    range: { from: range.from, to: range.to },
    by_route: enriched,
    queue_depth: Number((queueDepth as any)[0]?.c || 0),
    dlq_count: Number((dlqCount as any)[0]?.c || 0),
    top_errors: topErrors,
  };
}

// ---------- CSV / HTML rendering ----------
export function toCsv(rows: any[], columns?: string[]): string {
  if (!rows || rows.length === 0) return '';
  const cols = columns || Object.keys(rows[0]);
  const esc = (v: any) => {
    if (v === null || v === undefined) return '';
    const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
    if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  const head = cols.map(esc).join(',');
  const body = rows.map(r => cols.map(c => esc(r[c])).join(',')).join('\n');
  return `${head}\n${body}\n`;
}

export function reportToCsv(report: string, data: any): string {
  if (report === 'overview') {
    const summaryRows = [
      { metric: 'active_users', value: data.active_users },
      { metric: 'new_signups', value: data.new_signups },
      { metric: 'total_users', value: data.total_users },
      { metric: 'paid_users', value: data.paid_users },
      { metric: 'conversion_to_paid_pct', value: data.conversion_to_paid_pct },
      { metric: 'mrr_usd', value: data.mrr_usd },
      { metric: 'arr_usd', value: data.arr_usd },
      { metric: 'churn_rate_pct', value: data.churn_rate_pct },
      { metric: 'avg_session_minutes', value: data.avg_session_minutes },
      { metric: 'p50_latency_ms', value: data.p50_latency_ms },
      { metric: 'p95_latency_ms', value: data.p95_latency_ms },
      { metric: 'error_rate_pct', value: data.error_rate_pct },
      { metric: 'total_requests', value: data.total_requests },
    ];
    return toCsv(summaryRows, ['metric', 'value']);
  }
  if (report === 'financial') return toCsv(data.mrr_breakdown_by_tier || [], ['plan', 'subscribers', 'monthly_price_usd', 'mrr_usd']);
  if (report === 'technical') return toCsv(data.by_route || [], ['endpoint', 'hits', 'avg_latency_ms', 'p50_ms', 'p95_ms', 'p99_ms', 'errors_5xx', 'error_rate_pct']);
  if (report === 'users') return toCsv(data.users || [], ['id', 'email', 'name', 'role', 'sub_status', 'sub_plan', 'sessions_30d', 'project_count', 'lifetime_value_usd', 'last_seen_at', 'created_at']);
  // management = roll-up of overview + financial summary
  const rows = [
    { section: 'overview', metric: 'active_users', value: data.overview?.active_users },
    { section: 'overview', metric: 'new_signups', value: data.overview?.new_signups },
    { section: 'overview', metric: 'mrr_usd', value: data.overview?.mrr_usd },
    { section: 'overview', metric: 'arr_usd', value: data.overview?.arr_usd },
    { section: 'overview', metric: 'churn_rate_pct', value: data.overview?.churn_rate_pct },
    { section: 'financial', metric: 'new_mrr_usd', value: data.financial?.new_mrr_usd },
    { section: 'financial', metric: 'churn_mrr_usd', value: data.financial?.churn_mrr_usd },
    { section: 'technical', metric: 'queue_depth', value: data.technical?.queue_depth },
    { section: 'technical', metric: 'dlq_count', value: data.technical?.dlq_count },
  ];
  return toCsv(rows, ['section', 'metric', 'value']);
}

export function reportToHtml(report: string, data: any, range: DateRange): string {
  const esc = (v: any) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
  const table = (title: string, rows: any[], cols: string[]) => `
    <h2>${esc(title)}</h2>
    <table>
      <thead><tr>${cols.map(c => `<th>${esc(c)}</th>`).join('')}</tr></thead>
      <tbody>${(rows || []).map(r => `<tr>${cols.map(c => `<td>${esc(r[c])}</td>`).join('')}</tr>`).join('')}</tbody>
    </table>`;

  let body = '';
  if (report === 'overview' || report === 'management') {
    const o = report === 'management' ? data.overview : data;
    body += `<h2>Key metrics</h2>
      <div class="grid">
        <div class="card"><div class="lbl">Active users</div><div class="val">${esc(o?.active_users)}</div></div>
        <div class="card"><div class="lbl">New signups</div><div class="val">${esc(o?.new_signups)}</div></div>
        <div class="card"><div class="lbl">MRR</div><div class="val">$${esc(o?.mrr_usd)}</div></div>
        <div class="card"><div class="lbl">ARR</div><div class="val">$${esc(o?.arr_usd)}</div></div>
        <div class="card"><div class="lbl">Conversion to paid</div><div class="val">${esc(o?.conversion_to_paid_pct)}%</div></div>
        <div class="card"><div class="lbl">Churn rate</div><div class="val">${esc(o?.churn_rate_pct)}%</div></div>
        <div class="card"><div class="lbl">P50 latency</div><div class="val">${esc(o?.p50_latency_ms)}ms</div></div>
        <div class="card"><div class="lbl">P95 latency</div><div class="val">${esc(o?.p95_latency_ms)}ms</div></div>
        <div class="card"><div class="lbl">Error rate</div><div class="val">${esc(o?.error_rate_pct)}%</div></div>
      </div>`;
    body += table('Top pages', o?.top_pages || [], ['endpoint', 'hits']);
  }
  if (report === 'financial' || report === 'management') {
    const f = report === 'management' ? data.financial : data;
    body += `<p><strong>Total MRR:</strong> $${esc(f?.total_mrr_usd)} · <strong>ARR:</strong> $${esc(f?.arr_usd)}
             · <strong>New MRR:</strong> $${esc(f?.new_mrr_usd)} · <strong>Churn MRR:</strong> $${esc(f?.churn_mrr_usd)}</p>`;
    body += table('MRR breakdown by tier', f?.mrr_breakdown_by_tier || [], ['plan', 'subscribers', 'monthly_price_usd', 'mrr_usd']);
  }
  if (report === 'technical' || report === 'management') {
    const t = report === 'management' ? data.technical : data;
    body += `<p><strong>Queue depth:</strong> ${esc(t?.queue_depth)} · <strong>DLQ:</strong> ${esc(t?.dlq_count)}</p>`;
    body += table('Per-route latency', t?.by_route || [], ['endpoint', 'hits', 'p50_ms', 'p95_ms', 'p99_ms', 'errors_5xx', 'error_rate_pct']);
    body += table('Top errors', t?.top_errors || [], ['endpoint', 'status_code', 'message', 'c']);
  }
  if (report === 'users') {
    body += table('Users', data.users || [], ['id', 'email', 'name', 'role', 'sub_status', 'sub_plan', 'sessions_30d', 'project_count', 'lifetime_value_usd']);
  }

  return `<!doctype html>
<html><head><meta charset="utf-8"><title>Axal StudioOS — ${esc(report)} report</title>
<style>
  @page { size: A4; margin: 18mm; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; color: #111; max-width: 980px; margin: 24px auto; padding: 0 16px; }
  header { border-bottom: 2px solid #7c3aed; padding-bottom: 12px; margin-bottom: 18px; display:flex; align-items:baseline; justify-content:space-between; }
  header h1 { margin: 0; font-size: 22px; color: #4c1d95; }
  header .meta { font-size: 12px; color: #555; }
  h2 { font-size: 15px; margin-top: 24px; color: #333; border-bottom: 1px solid #eee; padding-bottom: 4px; }
  table { width: 100%; border-collapse: collapse; font-size: 12px; margin-top: 8px; }
  th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid #eee; }
  th { background: #f8f7ff; color: #4c1d95; font-weight: 600; }
  .grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin-top: 8px; }
  .card { border: 1px solid #ece9fe; border-radius: 8px; padding: 10px 12px; background: #fbfaff; }
  .card .lbl { font-size: 10px; text-transform: uppercase; color: #7c3aed; letter-spacing: 0.04em; }
  .card .val { font-size: 18px; font-weight: 700; color: #111; margin-top: 2px; }
  footer { margin-top: 32px; font-size: 10px; color: #888; text-align: center; }
</style></head>
<body>
<header>
  <h1>Axal StudioOS · ${esc(report)} report</h1>
  <div class="meta">${esc(range.from)} → ${esc(range.to)}<br/>Generated ${new Date().toISOString()}</div>
</header>
${body}
<footer>Confidential · Internal admin export · Axal Venture Studio</footer>
</body></html>`;
}

// ---------- HMAC-signed download tokens ----------
// We don't issue real R2 presigned URLs (would require S3-compat creds); we
// store the report in R2 under a random key and gate fetch via a worker
// endpoint that validates an HMAC token bound to the key + expiry.
async function hmacKey(env: Env): Promise<CryptoKey> {
  const secret = env.JWT_SECRET || '';
  return crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify'],
  );
}

function b64url(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.byteLength; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function signDownloadToken(env: Env, storageKey: string, ttlSec = 86400): Promise<string> {
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
    const [payloadB64, sigB64] = token.split('.');
    if (!payloadB64 || !sigB64) return null;
    const fromB64 = (s: string) => {
      s = s.replace(/-/g, '+').replace(/_/g, '/');
      while (s.length % 4) s += '=';
      const bin = atob(s);
      const out = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
      return out;
    };
    const payloadBytes = fromB64(payloadB64);
    const sigBytes = fromB64(sigB64);
    const key = await hmacKey(env);
    const ok = await crypto.subtle.verify('HMAC', key, sigBytes, payloadBytes);
    if (!ok) return null;
    const payload = new TextDecoder().decode(payloadBytes);
    const [storageKey, expStr] = payload.split('|');
    const exp = parseInt(expStr || '0', 10);
    if (!storageKey || !Number.isFinite(exp) || exp < Math.floor(Date.now() / 1000)) return null;
    return { key: storageKey };
  } catch {
    return null;
  }
}
