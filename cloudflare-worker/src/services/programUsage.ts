/** D1156: branch-owned monthly program aggregates, reported to HQ; no personal data. */
import type { Env } from '../types';
import { authenticateBranch } from '../rpc/hqOps';
import { branchOf } from '../util/branch';
import { withDeadline } from '../util/deadline';
import { parseProgramCopy } from './licencePrograms';
import { isRegistryKey } from './programRegistry';

export const PROGRAM_METRICS = ['people', 'cohorts', 'referrals', 'claims'] as const;
type Metric = typeof PROGRAM_METRICS[number];
export type ProgramFigure = { program_key: string; people: number | null; cohorts: number | null; referrals: number | null; claims: number | null; unreadable: number };
export const PROGRAM_NOT_REPORTED = 'This studio has not reported program figures yet.';
export const PROGRAM_REPORT_DEADLINE_MS = 5000;
export const PROGRAM_REPORT_STALE_MS = 48 * 3600_000;
const ERROR = 'program_usage_report_invalid';
const validCount = (v: unknown) => v === null || (typeof v === 'number' && Number.isSafeInteger(v) && v >= 0);
const keysAre = (v: object, keys: readonly string[]) => Object.keys(v).every(k => keys.includes(k)) && keys.every(k => Object.hasOwn(v, k));

/** Authentication resolves the studio; the caller can never supply a licence uid. */
export async function recordProgramUsage(env: Env, callerCode: string, secret: string, period: string, reportedAt: string, figures: ProgramFigure[], now = new Date()) {
  let who;
  try { who = await authenticateBranch(env, callerCode, secret); } catch { throw new Error('program_usage_auth_refused'); }
  if (typeof period !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(period)
    || typeof reportedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(reportedAt)
    || !Number.isFinite(Date.parse(reportedAt)) || new Date(reportedAt).toISOString() !== reportedAt
    || reportedAt.slice(0, 7) !== period || Date.parse(reportedAt) > now.getTime() + 300_000
    || !Array.isArray(figures) || figures.length > 200) throw new Error(ERROR);
  let grantRows: Array<{ program_key: string }>;
  try { grantRows = (await env.DB.prepare("SELECT g.program_key FROM program_grants g JOIN territory_licences l ON l.id = g.licence_id WHERE l.uid = ? AND g.state IN ('granted', 'paused')")
    .bind(who.licence_uid).all<{ program_key: string }>()).results || [];
  } catch { throw new Error('program_usage_unreadable'); }
  const granted = new Set(grantRows.map(g => g.program_key));
  const seen = new Set<string>();
  for (const f of figures) {
    if (!f || typeof f !== 'object' || !keysAre(f, ['program_key', ...PROGRAM_METRICS, 'unreadable'])
      || !isRegistryKey(f.program_key) || !granted.has(f.program_key) || seen.has(f.program_key)
      || !PROGRAM_METRICS.every(k => validCount(f[k])) || !Number.isInteger(f.unreadable) || f.unreadable < 0 || f.unreadable > 15
      || PROGRAM_METRICS.some((k, i) => (f.unreadable & (1 << i)) !== 0 && f[k] !== null)) throw new Error(ERROR);
    seen.add(f.program_key);
  }
  try { if (figures.length) await env.DB.batch(figures.map(f => env.DB.prepare(
    `INSERT INTO program_usage_reports (licence_uid, program_key, branch_code, period, people, cohorts, referrals, claims, unreadable, reported_at, received_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(licence_uid, program_key) DO UPDATE SET branch_code = excluded.branch_code, period = excluded.period,
       people = excluded.people, cohorts = excluded.cohorts, referrals = excluded.referrals, claims = excluded.claims,
       unreadable = excluded.unreadable, reported_at = excluded.reported_at, received_at = excluded.received_at
     WHERE excluded.reported_at > program_usage_reports.reported_at`)
    .bind(who.licence_uid, f.program_key, who.code, period, f.people, f.cohorts, f.referrals, f.claims, f.unreadable, reportedAt, now.toISOString())));
  } catch { throw new Error('program_usage_unreadable'); }
  return { ok: true, programs: figures.length };
}

/** Per-grant absence is explicit; a stale report remains dated evidence. */
export async function readProgramUsage(env: Env, licenceId: number, licenceUid: string, now = new Date()) {
  const rows = (await env.DB.prepare(
    `SELECT g.program_key, u.period, u.people, u.cohorts, u.referrals, u.claims, u.unreadable, u.reported_at
       FROM program_grants g LEFT JOIN program_usage_reports u ON u.licence_uid = ? AND u.program_key = g.program_key
      WHERE g.licence_id = ? AND g.state IN ('granted', 'paused') ORDER BY g.id`)
    .bind(licenceUid, licenceId).all<Record<string, any>>()).results || [];
  return { licence_uid: licenceUid, programs: rows.map(row => {
    if (!row.reported_at) return { program_key: row.program_key, state: 'not_reported', reason: PROGRAM_NOT_REPORTED, period: null, reported_at: null, counts: null };
    return { program_key: row.program_key, state: 'reported', period: row.period, reported_at: row.reported_at,
      age_seconds: Math.max(0, Math.floor((now.getTime() - Date.parse(row.reported_at)) / 1000)),
      stale: now.getTime() - Date.parse(row.reported_at) > PROGRAM_REPORT_STALE_MS,
      counts: Object.fromEntries(PROGRAM_METRICS.map((k, i) => [k, { value: row[k],
        state: row.unreadable & (1 << i) ? 'unreadable' : row[k] == null ? 'not_recorded' : 'recorded',
        reason: row.unreadable & (1 << i) ? 'This studio could not read this program figure. Try again after its next report.'
          : row[k] == null ? 'This studio has no recorded measure for this program figure.' : null }])) };
  }) };
}

/** Static SQL: monthly participation overlaps; referrals/claims are events in the UTC month to date. */
const SOURCES: Record<string, Partial<Record<Metric, string>>> = {
  'spinout-lab': {
    cohorts: "SELECT COUNT(*) AS n FROM cohort_cycles WHERE datetime(start_at) < datetime(?) AND datetime(end_at) >= datetime(?) AND COALESCE(app_status, '') <> 'postponed'",
    people: "SELECT COUNT(DISTINCT a.user_id) AS n FROM cohort_applicants a JOIN cohort_cycles c ON c.id = a.cohort_cycle_id WHERE a.status = 'activated' AND datetime(c.start_at) < datetime(?) AND datetime(c.end_at) >= datetime(?) AND COALESCE(c.app_status, '') <> 'postponed'",
  },
  'mentor-cohorts': {
    people: "SELECT COUNT(DISTINCT advisor_user_id) AS n FROM advisor_cohort_assignments WHERE datetime(assigned_at) < datetime(?) AND (is_active = 1 OR datetime(unassigned_at) >= datetime(?))",
    cohorts: "SELECT COUNT(DISTINCT cohort_cycle_id) AS n FROM advisor_cohort_assignments WHERE datetime(assigned_at) < datetime(?) AND (is_active = 1 OR datetime(unassigned_at) >= datetime(?))",
  },
  learning: {
    people: "SELECT COUNT(DISTINCT e.user_id) AS n FROM learning_enrollments e JOIN learning_programs p ON p.id = e.program_id WHERE p.status = 'published' AND datetime(e.enrolled_at) < datetime(?) AND (e.status = 'active' OR datetime(e.updated_at) >= datetime(?))",
  },
  'refer-and-earn': {
    people: "SELECT COUNT(DISTINCT referrer_user_id) AS n FROM referral_submissions WHERE datetime(created_at) < datetime(?) AND datetime(created_at) >= datetime(?) AND status <> 'draft'",
    referrals: "SELECT COUNT(*) AS n FROM referral_submissions WHERE datetime(created_at) < datetime(?) AND datetime(created_at) >= datetime(?) AND status <> 'draft'",
  },
  'referral-partners': {
    people: "SELECT COUNT(DISTINCT redeemed_by_user_id) AS n FROM partner_referral_redemptions WHERE attribution_kind = 'referral' AND datetime(redeemed_at) < datetime(?) AND datetime(redeemed_at) >= datetime(?)",
    referrals: "SELECT COUNT(*) AS n FROM partner_referral_redemptions WHERE attribution_kind = 'referral' AND datetime(redeemed_at) < datetime(?) AND datetime(redeemed_at) >= datetime(?)",
  },
  perks: {
    people: "SELECT COUNT(DISTINCT user_id) AS n FROM perk_claims WHERE datetime(created_at) < datetime(?) AND datetime(created_at) >= datetime(?)",
    claims: "SELECT COUNT(*) AS n FROM perk_claims WHERE datetime(created_at) < datetime(?) AND datetime(created_at) >= datetime(?)",
  },
};

export async function collectProgramUsage(env: Env, now: Date) {
  if (!branchOf(env)) throw new Error('program_usage_branch_only');
  const copyRow = await env.DB.prepare('SELECT program_grants_json FROM branch_licence WHERE id = ?').bind(1).first<{ program_grants_json: string | null }>();
  const copy = copyRow?.program_grants_json ? parseProgramCopy(copyRow.program_grants_json) : null;
  if (!copy) throw new Error('program_usage_copy_unreadable');
  const period = now.toISOString().slice(0, 7), from = `${period}-01T00:00:00.000Z`, to = now.toISOString();
  const figures: ProgramFigure[] = [];
  for (const grant of copy.grants) {
    if (!['granted', 'paused'].includes(String(grant.state))) continue;
    const key = grant.program_key;
    if (!isRegistryKey(key) || figures.some(f => f.program_key === key) || figures.length >= 200) throw new Error(ERROR);
    const f: ProgramFigure = { program_key: key, people: null, cohorts: null, referrals: null, claims: null, unreadable: 0 };
    for (const [i, metric] of PROGRAM_METRICS.entries()) {
      const query = SOURCES[key]?.[metric];
      if (!query) continue;
      try {
        const row = await env.DB.prepare(query).bind(to, from).first<{ n: number }>();
        if (!row || !validCount(row.n) || row.n === null) throw new Error(ERROR);
        f[metric] = row.n;
      } catch { f.unreadable |= 1 << i; }
    }
    figures.push(f);
  }
  return { period, reported_at: to, figures };
}

type HqReport = { reportProgramUsage?: (callerCode: string, secret: string, period: string, reportedAt: string, figures: ProgramFigure[]) => Promise<unknown> };
function reportRefusal(env: Env) {
  if (!branchOf(env)) return 'Only a studio deployment reports program figures to HQ.';
  if (!env.RPC_SECRET?.trim() || typeof (env as { HQ?: HqReport }).HQ?.reportProgramUsage !== 'function') return 'This studio cannot report program figures because its HQ connection is not configured.';
  return null;
}
export async function pushProgramUsage(env: Env, now = new Date(), deadlineMs = PROGRAM_REPORT_DEADLINE_MS) {
  const refused = reportRefusal(env);
  if (refused) return { sent: false as const, reason: refused };
  try {
    const report = await collectProgramUsage(env, now);
    const hq = (env as unknown as { HQ: Required<HqReport> }).HQ;
    const answer = await withDeadline(hq.reportProgramUsage(branchOf(env)!, env.RPC_SECRET!.trim(), report.period, report.reported_at, report.figures), deadlineMs, 'program-usage-report');
    if (!answer || typeof answer !== 'object' || (answer as any).ok !== true || (answer as any).programs !== report.figures.length) throw new Error(ERROR);
    return { sent: true as const, programs: report.figures.length };
  } catch { return { sent: false as const, reason: 'Program figures could not be reported to HQ. Try again.' }; }
}

/** Same fail-closed five-minute throttle as the existing licence Send now. */
export async function sendProgramUsageNow(env: Env, now = new Date()) {
  const refused = reportRefusal(env);
  if (refused) return { sent: false as const, status: 502 as const, reason: refused };
  if (!env.RATE_LIMITS) return { sent: false as const, status: 503 as const, reason: 'The report limit could not be checked. Try again.' };
  try {
    const key = `program_usage_send:${branchOf(env)}`;
    if (await withDeadline(env.RATE_LIMITS.get(key), 2000, 'program-usage-limit')) return { sent: false as const, status: 429 as const, reason: 'This studio can send program figures once every five minutes.' };
    await withDeadline(env.RATE_LIMITS.put(key, '1', { expirationTtl: 300 }), 2000, 'program-usage-limit');
  } catch { return { sent: false as const, status: 503 as const, reason: 'The report limit could not be checked. Try again.' }; }
  const out = await pushProgramUsage(env, now);
  return { ...out, status: out.sent ? 200 as const : 502 as const };
}
