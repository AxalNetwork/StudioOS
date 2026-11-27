/**
 * D8993 (#8993): the daily portfolio check. A missed report, or a founder-reported
 * runway under six months, raises the Needs-attention notice of D6218.
 *
 * Owner answer A on #6218 (2026-11-27): neither is a health input. A daily
 * scheduled check (`index.ts` `scheduled()`, 05:45 UTC, after Reporting's daily
 * step) raises the same notice type, `portfolio_needs_attention`, with its own
 * evidence line for each reason. The rules are the Portfolio Overview's own
 * Needs-attention lines (`frontend/src/pages/portfolio/portfolioModel.js`
 * `evidenceFor`), read here from the stored rows:
 *
 *   - Missed report: the company is in the holder's reporting population (a
 *     `portfolio_positions` row), its report for the last completed quarter has
 *     not arrived (no submitted update whose period counts for it, D1057), and
 *     its due day has passed (`reportDue`, D6204): the holder's own active
 *     `after_end` quarterly duty on it, else the own rule set of a fund holding
 *     it that the holder runs as GP of record (institutional tier), else the
 *     firm default of 30 days. The Overview's "Report … overdue" line.
 *   - Short runway: the newest submitted founder update the holder may read
 *     (the investor grant of D889) carries a runway figure (`runway_months`,
 *     else `runway`) under six months. The Overview's "Runway" line.
 *
 * Recipients are the holders of D6218 (`portfolioAttentionAlerts.ts`), found
 * holder by holder: the seat owners with a confirmed commitment and the active
 * members of their seats, each with the companies `investorHeldProjectIds`
 * (D1057) gives them.
 *
 * Once: `portfolio_attention_checks` keeps one row per company, holder, reason
 * and evidence (the period for a missed report, the update's uid for a runway).
 * A notice goes out only when its row is new, so a second run the same day, or
 * a later day that finds the same evidence, raises nothing. A new period, or a
 * new update still under six months, is new evidence and notifies again.
 * Nothing is cleared: a notice is an inbox row, and a report that arrives or a
 * runway back over six months simply raises nothing more.
 *
 * Unreadable: a source that fails raises nothing for what it covers, and is
 * never read as "nothing missed". It is named in `unreadable`, and the cron
 * marks the task failed so the run's row reads `partial`.
 */
import type { Env, User } from '../types';
import { notify } from './notify';
import { heldLicences } from './accountLicences';
import { investorHeldProjectIds } from '../routes/_investorProjectScope';
import { updateFigures } from './portfolioUpdateFigures';
import { ATTENTION_TYPE } from './portfolioAttentionAlerts';
import { completedPeriod, periodBounds, periodCounts, reportDue } from './portfolioMetrics';
import { readReportingRules } from './portfolioReportingRules';
import { userMeetsInvestorTier } from '../middleware/requireInvestorTier';

/** The Overview's `RUNWAY_FLOOR`: a runway under this many months needs attention. */
export const RUNWAY_FLOOR_MONTHS = 6;
/** The Overview's `RUNWAY_KEYS`, in its order. */
const RUNWAY_KEYS = ['runway_months', 'runway'] as const;
/** The Overview reads compliance at its default cadence. */
const CADENCE = 'quarterly' as const;

export type CheckReason = 'missed_report' | 'short_runway';
export type CheckResult = {
  day: string;
  period: string | null;
  holders: number;
  missed_report: number;
  short_runway: number;
  /** Each source that could not be read, and for whom; nothing was raised from it. */
  unreadable: Array<{ source: string; user_id?: number }>;
};

type Company = { id: number; uid: string; name: string };
type Holder = { user: User & { id: number }; held: number[] };
type Reports = { positioned: Set<number>; reported: Set<number>; last: Map<number, string> };

/** The Overview's `isNum`: a number, or a numeric string, never blank or a boolean. */
const isNum = (v: unknown) => v !== null && v !== undefined && v !== '' && typeof v !== 'boolean' && Number.isFinite(Number(v));
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

async function rows<T>(stmt: any): Promise<T[]> {
  const res = await stmt.all();
  if (!res || res.success !== true) throw new Error('read failed');
  return (res.results || []) as T[];
}

/** Every holder and the companies they hold: D6218's recipients, found holder by holder. */
async function holderBook(env: Env, unreadable: CheckResult['unreadable']): Promise<Holder[]> {
  // Every seat owner with a confirmed commitment is a candidate; `investorHeldProjectIds` then says which
  // companies, if any, each one holds, so the candidates need no join to the deals here.
  const owners = await rows<{ id: number }>(env.DB.prepare(
    `SELECT DISTINCT investor_user_id AS id FROM commitments WHERE status = 'confirmed'`,
  ));
  const ids = owners.map((r) => Number(r.id)).filter(Number.isSafeInteger);
  if (!ids.length) return [];
  const users = await rows<any>(env.DB.prepare(
    `SELECT id, role, is_active, investor_seat_primary_user_id, investor_tier, investor_subscription_status,
            investor_subscription_renews_at, investor_trial_ends_at
       FROM users
      WHERE is_active = 1 AND (id IN (SELECT value FROM json_each(?))
         OR investor_seat_primary_user_id IN (SELECT value FROM json_each(?)))
      ORDER BY id`,
  ).bind(JSON.stringify(ids), JSON.stringify(ids)));
  const out: Holder[] = [];
  for (const row of users) {
    try {
      const user = { ...row, licences: await heldLicences(env.DB, { id: row.id, role: row.role } as any) } as any;
      const held = await investorHeldProjectIds(env, user, null);
      if (held && held.length) out.push({ user, held: [...new Set(held.map(Number))] });
    } catch {
      unreadable.push({ source: 'holdings', user_id: Number(row.id) });
    }
  }
  return out;
}

/** Whether each company is in a reporting population, has reported for `period`, and when it last did. */
async function companyReports(env: Env, ids: number[], period: string): Promise<Reports> {
  const list = JSON.stringify(ids);
  const [positions, updates] = await Promise.all([
    rows<{ project_id: number }>(env.DB.prepare(
      `SELECT DISTINCT project_id FROM portfolio_positions WHERE project_id IN (SELECT value FROM json_each(?))`,
    ).bind(list)),
    // The rows `GET /api/positions/kpi-compliance` measures: submitted updates, any audience.
    rows<{ project_id: number; period: string | null; last_at: string | null }>(env.DB.prepare(
      `SELECT project_id, period, MAX(COALESCE(submitted_at, updated_at)) AS last_at
         FROM portfolio_updates
        WHERE status = 'submitted' AND project_id IN (SELECT value FROM json_each(?))
        GROUP BY project_id, period`,
    ).bind(list)),
  ]);
  const reported = new Set<number>();
  const last = new Map<number, string>();
  for (const u of updates) {
    const pid = Number(u.project_id);
    if (periodCounts(CADENCE, period, u.period)) reported.add(pid);
    const at = String(u.last_at || '').slice(0, 10);
    if (at && (!last.has(pid) || at > last.get(pid)!)) last.set(pid, at);
  }
  return { positioned: new Set(positions.map((p) => Number(p.project_id))), reported, last };
}

/**
 * The holder's due term per company, as `kpi-compliance` works it out for them:
 * their own duty, else the own rule sets of the funds they run as GP of record.
 * A company absent from the map takes the firm default. Throws on a failed read.
 */
async function dueTerms(env: Env, user: Holder['user'], ids: number[], period: string): Promise<Map<number, number>> {
  const terms = new Map<number, number>();
  const list = JSON.stringify(ids);
  const duties = await rows<{ project_id: number; due_days: number | null }>(env.DB.prepare(
    `SELECT project_id, MIN(due_days) AS due_days
       FROM reporting_duties
      WHERE status = 'active' AND due_rule = 'after_end' AND cadence = ? AND holder_user_id = ?
        AND project_id IN (SELECT value FROM json_each(?))
      GROUP BY project_id`,
  ).bind(CADENCE, user.id, list));
  for (const d of duties) {
    const n = Number(d.due_days);
    if (d.due_days != null && Number.isInteger(n) && n >= 0) terms.set(Number(d.project_id), n);
  }
  if (!userMeetsInvestorTier(user, 'institutional')) return terms;
  const funds = await rows<{ project_id: number; fund_id: number }>(env.DB.prepare(
    `SELECT DISTINCT p.project_id, p.fund_id
       FROM portfolio_positions p JOIN vc_funds f ON f.id = p.fund_id
      WHERE f.gp_user_id = ? AND p.project_id IN (SELECT value FROM json_each(?))`,
  ).bind(user.id, list));
  const byProject = new Map<number, number[]>();
  for (const f of funds) {
    const pid = Number(f.project_id);
    byProject.set(pid, [...(byProject.get(pid) || []), Number(f.fund_id)]);
  }
  const sets = new Map<number, Awaited<ReturnType<typeof readReportingRules>>>();
  for (const [pid, fundIds] of byProject) {
    if (terms.has(pid)) continue;
    for (const id of fundIds) if (!sets.has(id)) sets.set(id, await readReportingRules(env, id, CADENCE, period));
    const own = fundIds.map((id) => sets.get(id)!);
    // kpi-compliance's rule: with an own set among them, the earliest due day of the company's sets.
    if (own.some((s) => !s.inherited)) terms.set(pid, Math.min(...own.map((s) => Number(s.due_days))));
  }
  return terms;
}

/** The ledger row first; the notice only when the row is new. */
async function raise(
  env: Env, user: Holder['user'], company: Company, reason: CheckReason, key: string, day: string,
  body: string, payload: Record<string, unknown>,
): Promise<boolean> {
  const row = await env.DB.prepare(
    `INSERT OR IGNORE INTO portfolio_attention_checks (project_id, user_id, reason, evidence_key, checked_on) VALUES (?, ?, ?, ?, ?)`,
  ).bind(company.id, user.id, reason, key, day).run();
  if (Number(row?.meta?.changes || 0) !== 1) return false;
  await notify(env, {
    userId: Number(user.id),
    type: ATTENTION_TYPE,
    category: 'scoring',
    channels: ['in_app', 'email'],
    title: `${company.name} needs attention`,
    body,
    link: `/portfolio/companies/${company.uid}`,
    payload: { project_uid: company.uid, reason, checked_on: day, ...payload },
  });
  return true;
}

async function missedReports(
  env: Env, holder: Holder, companies: Map<number, Company>, reports: Reports,
  period: string, until: string, day: string, out: CheckResult,
): Promise<void> {
  const owed = holder.held.filter((id) => companies.has(id) && reports.positioned.has(id) && !reports.reported.has(id));
  if (!owed.length) return;
  const terms = await dueTerms(env, holder.user, owed, period);
  for (const pid of owed) {
    const due = reportDue(until, terms.has(pid) ? terms.get(pid)! : null, false, day);
    // `reportDue` sets `overdue` only with a due day and a whole number of days past it.
    if (!due.overdue) continue;
    const days = due.days_overdue!;
    const last = reports.last.get(pid) || null;
    const body = `Report for ${period} overdue by ${plural(days, 'day')}: due ${due.due_date}, ${last ? `last reported ${last}` : 'never reported'}. Source: Reporting.`;
    if (await raise(env, holder.user, companies.get(pid)!, 'missed_report', period, day, body,
      { period, due_date: due.due_date, days_overdue: days, due_basis: due.due_basis, last_reported_at: last })) out.missed_report += 1;
  }
}

async function shortRunways(env: Env, holder: Holder, companies: Map<number, Company>, day: string, out: CheckResult): Promise<void> {
  const ids = holder.held.filter((id) => companies.has(id));
  if (!ids.length) return;
  // `GET /api/portfolio-updates/latest` for this holder: the newest submitted update per company that the
  // founder shared with them. The last condition is the route's `INVESTOR_GRANT` (D889), written out so no
  // query text is assembled; the test pins it to the route's text. The table is not aliased, because it names it.
  const latest = await rows<any>(env.DB.prepare(
    `SELECT * FROM (SELECT portfolio_updates.uid, portfolio_updates.project_id, portfolio_updates.period,
                           portfolio_updates.kpis_json, portfolio_updates.metrics_json, portfolio_updates.submitted_at,
                           ROW_NUMBER() OVER (
                             PARTITION BY portfolio_updates.project_id
                             ORDER BY COALESCE(portfolio_updates.submitted_at, portfolio_updates.updated_at) DESC,
                                      portfolio_updates.id DESC) AS rn
                      FROM portfolio_updates
                     WHERE portfolio_updates.status = 'submitted'
                       AND portfolio_updates.project_id IN (SELECT value FROM json_each(?))
                       AND (EXISTS (SELECT 1 FROM update_recipients ur WHERE ur.update_id = portfolio_updates.id AND ur.user_id = ? AND ur.audience = 'investor')
  OR (CASE WHEN json_valid(portfolio_updates.audience_json) THEN json_type(portfolio_updates.audience_json, '$.investors') END) = 'true'))
      WHERE rn = 1`,
  ).bind(JSON.stringify(ids), holder.user.id));
  for (const u of latest) {
    const { kpis } = updateFigures(u);
    const key = RUNWAY_KEYS.find((k) => isNum(kpis[k]));
    if (!key) continue;
    const months = Number(kpis[key]);
    if (!(months < RUNWAY_FLOOR_MONTHS)) continue;
    const submitted = u.submitted_at ? String(u.submitted_at).slice(0, 10) : null;
    const body = `Runway of ${plural(months, 'month')} in the founder update${u.period ? ` for ${u.period}` : ''}${submitted ? `, submitted ${submitted}` : ''}: under six months. Source: Founder updates.`;
    if (await raise(env, holder.user, companies.get(Number(u.project_id))!, 'short_runway', String(u.uid), day, body,
      { update_uid: u.uid, runway_months: months, period: u.period ?? null, submitted_at: submitted })) out.short_runway += 1;
  }
}

/**
 * Run the check for the UTC day of `nowMs`. Throws only when the holders or the
 * companies cannot be read at all; every other failed read is in `unreadable`.
 */
export async function runPortfolioAttentionCheck(env: Env, nowMs: number): Promise<CheckResult> {
  const day = new Date(nowMs).toISOString().slice(0, 10);
  const period = completedPeriod(CADENCE, day);
  const until = period ? periodBounds(CADENCE, period)?.until ?? null : null;
  const out: CheckResult = { day, period, holders: 0, missed_report: 0, short_runway: 0, unreadable: [] };
  const book = await holderBook(env, out.unreadable);
  out.holders = book.length;
  if (!book.length) return out;

  const ids = [...new Set(book.flatMap((b) => b.held))];
  const companies = new Map<number, Company>();
  for (const p of await rows<Company>(env.DB.prepare(
    `SELECT id, uid, name FROM projects WHERE deleted_at IS NULL AND id IN (SELECT value FROM json_each(?))`,
  ).bind(JSON.stringify(ids)))) companies.set(Number(p.id), { id: Number(p.id), uid: p.uid, name: p.name });

  let reports: Reports | null = null;
  if (period && until) {
    try { reports = await companyReports(env, ids, period); } catch { out.unreadable.push({ source: 'reports' }); }
  } else out.unreadable.push({ source: 'period' });

  for (const holder of book) {
    if (reports && period && until) {
      try { await missedReports(env, holder, companies, reports, period, until, day, out); }
      catch { out.unreadable.push({ source: 'report_terms', user_id: holder.user.id }); }
    }
    try { await shortRunways(env, holder, companies, day, out); }
    catch { out.unreadable.push({ source: 'founder_updates', user_id: holder.user.id }); }
  }
  return out;
}
