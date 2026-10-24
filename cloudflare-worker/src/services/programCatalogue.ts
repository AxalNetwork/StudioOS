/**
 * D954 (#2787) — THE PROGRAMS CATALOGUE READ: PG1 and PG2 from one request,
 * as counts. `GET /api/admin/programs?weeks=4|12|52&scope=`.
 *
 * COUNTS ONLY. No name, email or account id leaves the read, as with Insights
 * (`adminInsights.ts`) and Community (`communityOverview.ts`). Every query
 * below counts or sums; the strings that travel are program keys, statuses,
 * groups, weeks, months and the registry's own words.
 *
 * EACH BLOCK ANSWERS ALONE, in D893's three shapes and one more:
 *   · `{ available: true, ... }` — read;
 *   · `{ available: false, unreadable: true, reason }` — the read failed, which
 *     a page draws as "Could not be read". It is never a claim of zero;
 *   · `{ recorded: false, reason }` — no store holds it ("Not recorded");
 *   · `{ available: false, pending: true, reason }` — it is stored, but waits
 *     on another part's read, which a page draws as "Not read here yet" with
 *     the reason. Never 0, and never `unreadable`.
 * A failed block never reads 0 and never takes another block with it (PG18a).
 *
 * ONE DEFINITION PER FIGURE. Perk claims and the strategic-access queue are
 * part 4's (#2790, `services/perkClaims.ts` and the queue service in
 * `services/referralSubmissions.ts`). Until they are on this Worker each of
 * those figures is `pending` with `PART4_*_REASON`. The waiting queues are the
 * Approvals lanes' own SQL (`approvalSources.ts`) and its bands (`slaFor`).
 *
 * WEEKS ARE MONDAY WEEKS IN UTC, from `weekAxis`, as Insights and Community
 * draw them; the period before is `previousAxis`. The current week is to date.
 */
import type { Env } from '../types';
import { weekAxis, type WeekAxis } from './activeAccounts';
import { ownScope, previousAxis, scopeLabel } from './adminInsights';
import { SLA_PAST_HOURS, SLA_DUE_SOON_HOURS } from './approvalSources';
import { branchRead } from './branches';
import { countsOnly, insightsScopes } from './insightsScope';
import { listPrograms, type ProgramKey, type ProgramRow, PROGRAM_KEYS, PROGRAM_STATUSES } from './programRegistry';

export const PROGRAM_WEEKS = [4, 12, 52] as const;
export type ProgramWeeks = typeof PROGRAM_WEEKS[number];
/** The canvas's choice (dc:533). */
export const DEFAULT_PROGRAM_WEEKS: ProgramWeeks = 12;

export const PART4_CLAIMS_REASON =
  'Perk claims are counted by the claims service part 4 (#2790) builds (services/perkClaims.ts), which this Worker does not have yet.';
export const PART4_STRATEGIC_REASON =
  'Strategic referral access is read through the queue service part 4 (#2790) builds (services/referralSubmissions.ts), which this Worker does not have yet.';
export const HQ_READS_REASON = 'HQ reads these figures.';
export const DEACTIVATED_NOT_LEFT_OUT =
  'Deactivated accounts are not left out yet. Part 7 (#2793) serves account state on the assignment list.';
export const LAB_PEOPLE_REASON =
  'The Lab is left out until O-FND and #2374 say who a cohort\'s founders are.';
export const REFERRAL_REWARDS_REASON = 'Referral rewards are not paid in perk credits yet.';
export const PRODUCT_TESTING_HQ_ONLY = 'Runs at HQ. Its figures are for HQ only.';

/** One sentence per figure, for the page's "How is this counted?". */
export const PROGRAM_DEFINITIONS = {
  running: 'Programs running counts the registry\'s programs whose status is Live.',
  people:
    'Distinct accounts that took part in the period: an active mentor assignment, an active enrolment in a published Learning program, a Refer & Earn submission, or a perk claim. The Lab is left out until a cohort\'s founders are defined.',
  waiting:
    'Items waiting for an admin now: cohort applications, Refer & Earn reviews (including those waiting on the member), perk listings in review and office-hours hosts. Ages are in the Approvals lanes\' bands: under 24 hours, 24 to 72, and 72 or more.',
  credits:
    'Perk credits granted in the period by source, and spent, from the credit ledger. Deductions, revokes and refunds are summed apart, never netted.',
  mentors: 'Distinct people holding an active assignment whose current role is Advisor.',
  coverage:
    'Cohorts that are scheduled or running and not postponed, and how many have at least one active assignment held by a current Advisor.',
  learning: 'Published Learning programs, and the active enrolments in them. A person in two programs is two enrolments.',
} as const;

export type Viewer = { id: number; superAdmin: boolean };

type Unreadable = { available: false; unreadable: true; reason: string };
type Pending = { available: false; pending: true; reason: string };
type Read<T> = ({ available: true } & T) | Unreadable;

const HOUR = 3_600_000;
const n = (v: unknown) => Math.max(0, Math.trunc(Number(v) || 0));
const sqlTime = (ms: number) => new Date(ms).toISOString().slice(0, 19).replace('T', ' ');

const unreadable = (what: string, e: unknown): Unreadable => {
  console.error('[admin-programs]', what, typeof e === 'string' ? e : (e as Error)?.message);
  return { available: false, unreadable: true, reason: `${what} could not be read on this database. That is not the same as none.` };
};

export const pending = (reason: string): Pending => ({ available: false, pending: true, reason });

/** Runs `read`; a throw becomes that block's own `unreadable`. */
async function block<T>(what: string, read: () => Promise<T>): Promise<Read<T>> {
  try {
    return { available: true, ...(await read()) };
  } catch (e) {
    return unreadable(what, e);
  }
}

export function parseProgramWeeks(raw: string | undefined): ProgramWeeks | null {
  if (raw === undefined || raw === '') return DEFAULT_PROGRAM_WEEKS;
  const w = Number(raw);
  return (PROGRAM_WEEKS as readonly number[]).includes(w) && String(w) === raw ? (w as ProgramWeeks) : null;
}

// ---------------------------------------------------------------------------
// The queues
// ---------------------------------------------------------------------------

type QueueRow = { n: number; oldest: string | null; under_24: number; from_24: number; over_72: number; on_member?: number };

function queueOf(r: QueueRow | null, nowMs: number, aged: string) {
  const count = n(r?.n);
  const bands = { under_24: n(r?.under_24), from_24_to_72: n(r?.from_24), over_72: n(r?.over_72) };
  const oldest = r?.oldest ? Date.parse(`${String(r.oldest).replace(' ', 'T')}Z`) : NaN;
  return {
    count,
    oldest_hours: Number.isFinite(oldest) ? Math.max(0, Math.floor((nowMs - oldest) / HOUR)) : null,
    bands,
    // A stamp that will not parse is waiting with no recorded age, never 0 hours.
    age_not_recorded: Math.max(0, count - bands.under_24 - bands.from_24_to_72 - bands.over_72),
    aged,
  };
}

/** The band edges every queue binds: 24 hours and 72 hours ago, in SQLite's format. */
const edges = (nowMs: number) => {
  const d24 = sqlTime(nowMs - SLA_DUE_SOON_HOURS * HOUR);
  const d72 = sqlTime(nowMs - SLA_PAST_HOURS * HOUR);
  return [d24, d24, d72, d72];
};

/** Cohort applications: the Approvals `cohort` lane's predicate (`approvalSources.ts`). */
async function cohortQueue(env: Env, nowMs: number) {
  const r = await env.DB.prepare(
    `SELECT COUNT(*) AS n, MIN(datetime(created_at)) AS oldest,
            SUM(CASE WHEN datetime(created_at) > datetime(?) THEN 1 ELSE 0 END) AS under_24,
            SUM(CASE WHEN datetime(created_at) <= datetime(?) AND datetime(created_at) > datetime(?) THEN 1 ELSE 0 END) AS from_24,
            SUM(CASE WHEN datetime(created_at) <= datetime(?) THEN 1 ELSE 0 END) AS over_72
       FROM cohort_applicants WHERE status = 'pending'`,
  ).bind(...edges(nowMs)).first<QueueRow>();
  return queueOf(r, nowMs, 'since applied');
}

/** Refer & Earn reviews: the `referrals` lane's three statuses, `more_info_needed` counted apart. */
async function referralQueue(env: Env, nowMs: number) {
  const r = await env.DB.prepare(
    `SELECT COUNT(*) AS n, MIN(datetime(created_at)) AS oldest,
            SUM(CASE WHEN datetime(created_at) > datetime(?) THEN 1 ELSE 0 END) AS under_24,
            SUM(CASE WHEN datetime(created_at) <= datetime(?) AND datetime(created_at) > datetime(?) THEN 1 ELSE 0 END) AS from_24,
            SUM(CASE WHEN datetime(created_at) <= datetime(?) THEN 1 ELSE 0 END) AS over_72,
            SUM(CASE WHEN status = 'more_info_needed' THEN 1 ELSE 0 END) AS on_member
       FROM referral_submissions WHERE status IN ('submitted', 'under_review', 'more_info_needed')`,
  ).bind(...edges(nowMs)).first<QueueRow>();
  return { ...queueOf(r, nowMs, 'since submitted'), waiting_on_member: n(r?.on_member) };
}

/** Perk listings in review, aged from `updated_at`, "since last edit" (D953 §2). */
async function perkQueue(env: Env, nowMs: number) {
  const r = await env.DB.prepare(
    `SELECT COUNT(*) AS n, MIN(datetime(updated_at)) AS oldest,
            SUM(CASE WHEN datetime(updated_at) > datetime(?) THEN 1 ELSE 0 END) AS under_24,
            SUM(CASE WHEN datetime(updated_at) <= datetime(?) AND datetime(updated_at) > datetime(?) THEN 1 ELSE 0 END) AS from_24,
            SUM(CASE WHEN datetime(updated_at) <= datetime(?) THEN 1 ELSE 0 END) AS over_72
       FROM perks WHERE status = 'in_review'`,
  ).bind(...edges(nowMs)).first<QueueRow>();
  return queueOf(r, nowMs, 'since last edit');
}

/** Office-hours hosts waiting, every capacity (D953 S-HOST). */
async function hostQueue(env: Env, nowMs: number) {
  const r = await env.DB.prepare(
    `SELECT COUNT(*) AS n, MIN(datetime(created_at)) AS oldest,
            SUM(CASE WHEN datetime(created_at) > datetime(?) THEN 1 ELSE 0 END) AS under_24,
            SUM(CASE WHEN datetime(created_at) <= datetime(?) AND datetime(created_at) > datetime(?) THEN 1 ELSE 0 END) AS from_24,
            SUM(CASE WHEN datetime(created_at) <= datetime(?) THEN 1 ELSE 0 END) AS over_72
       FROM lab_host_applications WHERE status = 'pending'`,
  ).bind(...edges(nowMs)).first<QueueRow>();
  return queueOf(r, nowMs, 'since applied');
}

/** The queues the Waiting tile sums, and the one it names as left out. */
export const WAITING_COVERED = ['cohort', 'referrals', 'perks', 'hosts'] as const;

// ---------------------------------------------------------------------------
// Card figures
// ---------------------------------------------------------------------------

/** S-CNT: distinct people holding an active row whose current role is Advisor. */
async function activeMentors(env: Env) {
  const r = await env.DB.prepare(
    `SELECT COUNT(DISTINCT a.advisor_user_id) AS n
       FROM advisor_cohort_assignments a JOIN users u ON u.id = a.advisor_user_id
      WHERE a.is_active = 1 AND lower(COALESCE(u.role, '')) = 'advisor'`,
  ).first<{ n: number }>();
  return { count: n(r?.n), reason: DEACTIVATED_NOT_LEFT_OUT };
}

/** S-COV, over every cycle the rule takes (no cap): scheduled or running, not postponed. */
async function mentorCoverage(env: Env) {
  const r = await env.DB.prepare(
    `SELECT COUNT(*) AS cohorts,
            SUM(CASE WHEN EXISTS (
              SELECT 1 FROM advisor_cohort_assignments a JOIN users u ON u.id = a.advisor_user_id
               WHERE a.cohort_cycle_id = c.id AND a.is_active = 1 AND lower(COALESCE(u.role, '')) = 'advisor'
            ) THEN 1 ELSE 0 END) AS covered
       FROM cohort_cycles c
      WHERE c.status IN ('scheduled', 'active') AND COALESCE(c.app_status, '') <> 'postponed'`,
  ).first<{ cohorts: number; covered: number }>();
  const cohorts = n(r?.cohorts);
  const covered = n(r?.covered);
  return { cohorts, covered, uncovered: cohorts - covered };
}

/** Open rows whose holder is no longer an Advisor (a missing account counts as no longer one). */
async function openRowsNotAdvisor(env: Env) {
  const r = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM advisor_cohort_assignments a LEFT JOIN users u ON u.id = a.advisor_user_id
      WHERE a.is_active = 1 AND lower(COALESCE(u.role, '')) <> 'advisor'`,
  ).first<{ n: number }>();
  return n(r?.n);
}

/** Live listings not past their end date: `GET /api/perks/`'s rule, with no cap. */
async function livePerks(env: Env, nowMs: number) {
  const r = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM perks WHERE status = 'live' AND (ends_at IS NULL OR ends_at >= ?)`,
  ).bind(new Date(nowMs).toISOString().slice(0, 10)).first<{ n: number }>();
  return { count: n(r?.n) };
}

/** Published Learning programs in the viewer's scope, their active enrolments, and the join methods present. */
async function learningFigures(env: Env, viewer: Viewer) {
  const r = await env.DB.prepare(
    `SELECT COUNT(*) AS programs,
            COALESCE(SUM((SELECT COUNT(*) FROM learning_enrollments e WHERE e.program_id = p.id AND e.status = 'active')), 0) AS enrolments,
            SUM(CASE WHEN p.enrolment = 'open' THEN 1 ELSE 0 END) AS open,
            SUM(CASE WHEN p.enrolment = 'invite' THEN 1 ELSE 0 END) AS invite
       FROM learning_programs p
      WHERE p.status = 'published'
        AND (? = 1 OR p.id IN (SELECT program_id FROM learning_program_admins WHERE user_id = ?))`,
  ).bind(viewer.superAdmin ? 1 : 0, viewer.id).first<{ programs: number; enrolments: number; open: number; invite: number }>();
  const join_methods = [n(r?.open) ? 'open' : null, n(r?.invite) ? 'invite' : null].filter((x): x is string => !!x);
  return {
    published_programs: n(r?.programs),
    active_enrolments: n(r?.enrolments),
    join_methods,
    scope: viewer.superAdmin ? 'every' as const : 'assigned' as const,
  };
}

/** Open product-testing programs, and the applications to them not withdrawn (`services/testing.ts`). */
async function testingFigures(env: Env) {
  const r = await env.DB.prepare(
    `SELECT (SELECT COUNT(*) FROM testing_programmes WHERE status = 'open') AS open,
            (SELECT COUNT(*) FROM testing_applications a JOIN testing_programmes p ON p.id = a.programme_id
              WHERE p.status = 'open' AND a.status <> 'withdrawn') AS applied`,
  ).first<{ open: number; applied: number }>();
  return { open: n(r?.open), applications: n(r?.applied) };
}

// ---------------------------------------------------------------------------
// People taking part (S-PPL)
// ---------------------------------------------------------------------------

/** The programs People taking part covers, and the one it leaves out. */
export const PEOPLE_COVERS: readonly ProgramKey[] = ['mentor-cohorts', 'learning', 'refer-and-earn', 'perks'];

/**
 * Distinct accounts that took part in `[from, to)`: a mentor assignment active
 * at any point in it, an enrolment in a published Learning program active at
 * any point in it, a Refer & Earn submission made in it, or a perk claimed in
 * it. One UNION, so a person in two programs is one person.
 */
async function peopleIn(env: Env, from: string, to: string): Promise<number> {
  const r = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM (
       SELECT a.advisor_user_id AS who FROM advisor_cohort_assignments a
        WHERE datetime(a.assigned_at) < datetime(?)
          AND (a.is_active = 1 OR datetime(a.unassigned_at) >= datetime(?))
       UNION
       SELECT e.user_id FROM learning_enrollments e JOIN learning_programs p ON p.id = e.program_id
        WHERE p.status = 'published' AND datetime(e.enrolled_at) < datetime(?)
          AND (e.status = 'active' OR datetime(e.updated_at) >= datetime(?))
       UNION
       SELECT s.referrer_user_id FROM referral_submissions s
        WHERE datetime(s.created_at) >= datetime(?) AND datetime(s.created_at) < datetime(?)
       UNION
       SELECT c.user_id FROM perk_claims c
        WHERE datetime(c.created_at) >= datetime(?) AND datetime(c.created_at) < datetime(?)
     )`,
  ).bind(to, from, to, from, from, to, from, to).first<{ n: number }>();
  return n(r?.n);
}

// ---------------------------------------------------------------------------
// Joins per week
// ---------------------------------------------------------------------------

type Weekly = { week: string; count: number; to_date: boolean };

function weekly(axis: WeekAxis, rows: Array<{ week: unknown; n: unknown }>): Weekly[] {
  const by = new Map(rows.map((r) => [String(r.week), n(r.n)]));
  return axis.weeks.map((w) => ({ week: w, count: by.get(w) ?? 0, to_date: w === axis.current }));
}

async function referralsWeekly(env: Env, axis: WeekAxis, before: WeekAxis) {
  const [rows, prev] = await Promise.all([
    env.DB.prepare(
      `SELECT date(created_at, '-6 days', 'weekday 1') AS week, COUNT(*) AS n FROM referral_submissions
        WHERE datetime(created_at) >= datetime(?) AND datetime(created_at) < datetime(?) GROUP BY 1`,
    ).bind(axis.from, axis.to).all<{ week: string; n: number }>(),
    env.DB.prepare(
      `SELECT COUNT(*) AS n FROM referral_submissions WHERE datetime(created_at) >= datetime(?) AND datetime(created_at) < datetime(?)`,
    ).bind(before.from, before.to).first<{ n: number }>(),
  ]);
  const weeks = weekly(axis, rows.results || []);
  return { weeks, total: weeks.reduce((t, w) => t + w.count, 0), previous_total: n(prev?.n) };
}

/**
 * Learning enrolments per week and per program, from the enrolment events
 * (migration 560), in the viewer's scope: an Admin's assigned programs, as
 * `GET /api/learning/programs/mine` scopes them, or every program for a Super
 * Admin. A learner removed later still counts in the week they enrolled, and a
 * re-enrolment counts again. Shared with `GET /api/learning/programs/mine/enrolments`.
 */
export async function learningEnrolmentWeeks(env: Env, viewer: Viewer, axis: WeekAxis) {
  const res = await env.DB.prepare(
    `SELECT p.uid AS program_uid, date(ev.at, '-6 days', 'weekday 1') AS week, COUNT(*) AS n
       FROM learning_enrolment_events ev JOIN learning_programs p ON p.id = ev.program_id
      WHERE ev.kind = 'enrolled' AND datetime(ev.at) >= datetime(?) AND datetime(ev.at) < datetime(?)
        AND (? = 1 OR p.id IN (SELECT program_id FROM learning_program_admins WHERE user_id = ?))
      GROUP BY 1, 2`,
  ).bind(axis.from, axis.to, viewer.superAdmin ? 1 : 0, viewer.id).all<{ program_uid: string; week: string; n: number }>();
  const rows = res.results || [];
  const byProgram = new Map<string, Array<{ week: string; n: number }>>();
  for (const r of rows) {
    const list = byProgram.get(r.program_uid) ?? [];
    list.push(r);
    byProgram.set(r.program_uid, list);
  }
  const totals = new Map<string, number>();
  for (const r of rows) totals.set(r.week, (totals.get(r.week) ?? 0) + n(r.n));
  const weeks = weekly(axis, [...totals].map(([week, c]) => ({ week, n: c })));
  return {
    weeks,
    total: weeks.reduce((t, w) => t + w.count, 0),
    programs: [...byProgram].map(([uid, list]) => {
      const w = weekly(axis, list);
      return { uid, weeks: w, total: w.reduce((t, x) => t + x.count, 0) };
    }),
  };
}

async function learningWeekly(env: Env, viewer: Viewer, axis: WeekAxis, before: WeekAxis) {
  const [now, prev] = await Promise.all([learningEnrolmentWeeks(env, viewer, axis), learningEnrolmentWeeks(env, viewer, before)]);
  return { weeks: now.weeks, total: now.total, previous_total: prev.total, scope: viewer.superAdmin ? 'every' : 'assigned' };
}

/** Lab applications, in this read's own query, so its failure is its own block's (D953 §6). */
async function labWeekly(env: Env, axis: WeekAxis, before: WeekAxis) {
  const [rows, prev] = await Promise.all([
    env.DB.prepare(
      `SELECT date(created_at, '-6 days', 'weekday 1') AS week, COUNT(*) AS n FROM spinout_applications
        WHERE datetime(created_at) >= datetime(?) AND datetime(created_at) < datetime(?) GROUP BY 1`,
    ).bind(axis.from, axis.to).all<{ week: string; n: number }>(),
    env.DB.prepare(
      `SELECT COUNT(*) AS n FROM spinout_applications WHERE datetime(created_at) >= datetime(?) AND datetime(created_at) < datetime(?)`,
    ).bind(before.from, before.to).first<{ n: number }>(),
  ]);
  const weeks = weekly(axis, rows.results || []);
  return { weeks, total: weeks.reduce((t, w) => t + w.count, 0), previous_total: n(prev?.n) };
}

// ---------------------------------------------------------------------------
// Credits (O-MONEY: a Super Admin's figures)
// ---------------------------------------------------------------------------

export const CREDIT_SOURCES = ['lab', 'bounty', 'manual', 'referral', 'other_rule', 'no_rule'] as const;
type CreditSource = typeof CREDIT_SOURCES[number];

type Month = {
  month: string; partial: boolean;
  granted: Record<CreditSource, number | null>; granted_total: number;
  spent: number; deducted: number; refunded: number;
};

/** Every `YYYY-MM` the window touches, oldest first. */
function monthsOf(axis: WeekAxis): string[] {
  const out: string[] = [];
  const last = new Date(Date.parse(`${axis.to.replace(' ', 'T')}Z`) - 1000).toISOString().slice(0, 7);
  let [y, m] = axis.from.slice(0, 7).split('-').map(Number);
  for (let guard = 0; guard < 24; guard += 1) {
    const key = `${y}-${String(m).padStart(2, '0')}`;
    out.push(key);
    if (key >= last) break;
    m += 1;
    if (m > 12) { m = 1; y += 1; }
  }
  return out;
}

/**
 * Credits granted by source, spent, deducted (deductions and revokes, the
 * `admin_adjust` lines) and refunded, per month of the window, summed in SQL
 * from `perk_credit_ledger`. A grant with no rule key, from before migration
 * 381, is a source of its own, so the total is never short. The bounty test is
 * `isBountyRule`'s, in SQL with `substr`, as `creditGrants.ts` writes it.
 */
async function creditsByMonth(env: Env, axis: WeekAxis) {
  const [rows, rules] = await Promise.all([
    env.DB.prepare(
      `SELECT strftime('%Y-%m', datetime(created_at)) AS month, kind,
              CASE WHEN kind <> 'grant' THEN kind
                   WHEN rule_key IS NULL THEN 'no_rule'
                   WHEN substr(rule_key, 1, 4) = 'lab:' THEN 'lab'
                   WHEN substr(rule_key, 1, 4) = 'bug_' OR substr(rule_key, 1, 16) = 'feature_shipped_' OR rule_key = 'task_approved' THEN 'bounty'
                   WHEN rule_key = 'manual' THEN 'manual'
                   WHEN substr(rule_key, 1, 9) = 'referral:' THEN 'referral'
                   ELSE 'other_rule' END AS source,
              SUM(delta) AS total
         FROM perk_credit_ledger
        WHERE datetime(created_at) >= datetime(?) AND datetime(created_at) < datetime(?)
        GROUP BY 1, 2, 3`,
    ).bind(axis.from, axis.to).all<{ month: string; kind: string; source: string; total: number }>(),
    env.DB.prepare(`SELECT COUNT(*) AS n FROM credit_reward_rules WHERE substr(key, 1, 9) = 'referral:'`).first<{ n: number }>(),
  ]);
  const referralPaid = n(rules?.n) > 0;
  const firstMonthStart = `${axis.from.slice(0, 7)}-01 00:00:00`;
  const months: Month[] = monthsOf(axis).map((month, i, all) => ({
    month,
    partial: (i === 0 && axis.from !== firstMonthStart) || i === all.length - 1,
    granted: Object.fromEntries(CREDIT_SOURCES.map((s) => [s, s === 'referral' && !referralPaid ? null : 0])) as Record<CreditSource, number | null>,
    granted_total: 0, spent: 0, deducted: 0, refunded: 0,
  }));
  const at = new Map(months.map((m) => [m.month, m]));
  for (const r of rows.results || []) {
    const m = at.get(String(r.month));
    if (!m) continue;
    const t = Number(r.total) || 0;
    if (r.kind === 'grant') {
      const s = (CREDIT_SOURCES as readonly string[]).includes(r.source) ? r.source as CreditSource : 'other_rule';
      // A referral line with no referral rule cannot be paid by one; it is counted as another rule's.
      const k: CreditSource = s === 'referral' && !referralPaid ? 'other_rule' : s;
      m.granted[k] = (m.granted[k] ?? 0) + t;
      m.granted_total += t;
    } else if (r.kind === 'spend') m.spent += -t;
    else if (r.kind === 'admin_adjust') m.deducted += -t;
    else if (r.kind === 'refund') m.refunded += t;
  }
  return {
    months,
    referral: referralPaid ? { available: true as const } : { recorded: false as const, reason: REFERRAL_REWARDS_REASON },
  };
}

// ---------------------------------------------------------------------------
// The read
// ---------------------------------------------------------------------------

type Queues = {
  cohort: Read<ReturnType<typeof queueOf>>;
  referrals: Read<Awaited<ReturnType<typeof referralQueue>>>;
  perks: Read<ReturnType<typeof queueOf>>;
  hosts: Read<ReturnType<typeof queueOf>>;
};

/** A Needs-you count summed from parts; any part unreadable makes it unreadable. */
function needs(parts: Array<{ available: boolean; count?: number } & Record<string, unknown>>, what: string, extra: Record<string, unknown> = {}) {
  const bad = parts.find((p) => !p.available);
  if (bad) return { available: false as const, unreadable: true as const, reason: `${what} could not be read on this database. That is not the same as none.` };
  return { available: true as const, count: parts.reduce((t, p) => t + n(p.count), 0), ...extra };
}

function cardFigures(key: ProgramKey, viewer: Viewer, q: Queues, b: {
  mentors: Read<{ count: number; reason: string }>;
  coverage: Read<{ cohorts: number; covered: number; uncovered: number }>;
  notAdvisor: Read<{ count: number }>;
  live: Read<{ count: number }>;
  learning: Read<Awaited<ReturnType<typeof learningFigures>>>;
  testing: Read<{ open: number; applications: number }> | null;
}): { figures: Record<string, unknown> | null; needs_you: Record<string, unknown> | null } {
  switch (key) {
    case 'spinout-lab':
      return {
        figures: { cohort_applications: q.cohort.available ? { available: true, count: q.cohort.count } : q.cohort },
        needs_you: needs([q.cohort, q.hosts], 'Cohort applications or office-hours hosts',
          q.cohort.available && q.hosts.available ? { cohort_applications: q.cohort.count, hosts: q.hosts.count } : {}),
      };
    case 'mentor-cohorts': {
      const uncovered = b.coverage.available ? { available: true, count: b.coverage.uncovered } : b.coverage;
      return {
        figures: { mentors: b.mentors, coverage: b.coverage },
        needs_you: needs([uncovered as any, b.notAdvisor as any], 'Mentor coverage or assignments',
          b.coverage.available && b.notAdvisor.available
            ? { cohorts_without_mentor: b.coverage.uncovered, holders_not_advisor: b.notAdvisor.count } : {}),
      };
    }
    case 'refer-and-earn':
      return {
        figures: {
          open_referrals: q.referrals.available
            ? { available: true, count: q.referrals.count, waiting_on_member: q.referrals.waiting_on_member } : q.referrals,
        },
        needs_you: {
          ...needs([q.referrals], 'Refer & Earn reviews'),
          strategic_requests: pending(PART4_STRATEGIC_REASON),
        },
      };
    case 'perks':
      return {
        figures: { live: b.live, claims: pending(PART4_CLAIMS_REASON) },
        needs_you: needs([q.perks], 'Perk listings in review'),
      };
    case 'learning':
      return { figures: { programs: b.learning }, needs_you: null };
    case 'product-testing':
      return viewer.superAdmin && b.testing
        ? { figures: { programs: b.testing }, needs_you: null }
        : { figures: null, needs_you: null };
    default:
      return { figures: null, needs_you: null };
  }
}

function waitingTile(q: Queues) {
  const parts = WAITING_COVERED.map((k) => [k, q[k]] as const);
  const bad = parts.filter(([, v]) => !v.available).map(([k]) => k);
  const left_out = [{ queue: 'strategic', reason: PART4_STRATEGIC_REASON }];
  if (bad.length) {
    return {
      available: false as const, unreadable: true as const,
      reason: `The ${bad.join(', ')} queue could not be read, so the total would be short. That is not the same as none.`,
      covers: WAITING_COVERED, left_out,
    };
  }
  const read = parts.map(([, v]) => v as { count: number; oldest_hours: number | null });
  const ages = read.map((v) => v.oldest_hours).filter((x): x is number => x !== null);
  return {
    available: true as const,
    count: read.reduce((t, v) => t + v.count, 0),
    oldest_hours: ages.length ? Math.max(...ages) : null,
    covers: WAITING_COVERED,
    left_out,
  };
}

export async function programCatalogue(env: Env, viewer: Viewer, weeks: ProgramWeeks, nowMs: number = Date.now()) {
  const axis = weekAxis(new Date(nowMs).toISOString(), weeks);
  const before = previousAxis(axis);

  const [
    registry, cohort, referrals, perks, hosts,
    mentors, coverage, notAdvisor, live, learning, testing,
    people, joinsReferrals, joinsLearning, joinsLab, credits,
  ] = await Promise.all([
    block('The program registry', async () => ({ rows: await listPrograms(env) })),
    block('Cohort applications', () => cohortQueue(env, nowMs)),
    block('Refer & Earn reviews', () => referralQueue(env, nowMs)),
    block('Perk listings in review', () => perkQueue(env, nowMs)),
    block('Office-hours hosts', () => hostQueue(env, nowMs)),
    block('Mentor assignments', () => activeMentors(env)),
    block('Cohort coverage', () => mentorCoverage(env)),
    block('Mentor assignments', async () => ({ count: await openRowsNotAdvisor(env) })),
    block('Live perks', () => livePerks(env, nowMs)),
    block('Learning programs', () => learningFigures(env, viewer)),
    viewer.superAdmin ? block('Product testing', () => testingFigures(env)) : Promise.resolve(null),
    block('People taking part', async () => ({
      count: await peopleIn(env, axis.from, axis.to),
      previous: await peopleIn(env, before.from, before.to),
      covers: PEOPLE_COVERS,
      left_out: [{ program: 'spinout-lab', reason: LAB_PEOPLE_REASON }],
    })),
    block('Referrals per week', () => referralsWeekly(env, axis, before)),
    block('Learning enrolments per week', () => learningWeekly(env, viewer, axis, before)),
    block('Lab applications per week', () => labWeekly(env, axis, before)),
    viewer.superAdmin ? block('The credit ledger', () => creditsByMonth(env, axis)) : Promise.resolve(null),
  ]);

  const q: Queues = { cohort, referrals, perks, hosts };
  const rows: ProgramRow[] = registry.available ? registry.rows : [];

  const byStatus = Object.fromEntries(PROGRAM_STATUSES.map((s) => [s, 0])) as Record<string, number>;
  for (const r of rows) byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;

  const creditsTile = !credits
    ? pending(HQ_READS_REASON)
    : credits.available
      ? (() => {
        const sum = (f: (m: Month) => number) => credits.months.reduce((t, m) => t + f(m), 0);
        return {
          available: true as const,
          granted: sum((m) => m.granted_total),
          spent: sum((m) => m.spent),
          deducted: sum((m) => m.deducted),
          refunded: sum((m) => m.refunded),
          referral: credits.referral,
        };
      })()
      : credits;

  return {
    weeks,
    week_axis: axis.weeks,
    current_week: axis.current,
    as_of: new Date(nowMs).toISOString(),
    scope: { key: ownScope(env), label: scopeLabel(env) },
    programs: registry.available
      ? {
        available: true as const,
        rows: rows.map((r) => ({
          key: r.key, group: r.grp, name: r.name, purpose: r.purpose ?? null, who: r.who ?? null,
          join_method: r.join_method ?? null, status: r.status, position: Number(r.position),
          ...cardFigures(r.key, viewer, q, {
            mentors, coverage, notAdvisor, live, learning,
            testing: testing as Read<{ open: number; applications: number }> | null,
          }),
        })),
      }
      : registry,
    tiles: {
      running: registry.available
        ? { available: true as const, running: byStatus.live, by_status: byStatus, total: rows.length }
        : registry,
      people,
      waiting: waitingTile(q),
      credits: creditsTile,
    },
    waiting: { cohort, referrals, strategic: pending(PART4_STRATEGIC_REASON), perks, hosts },
    joins_weekly: {
      referrals: joinsReferrals,
      learning: joinsLearning,
      perks: pending(PART4_CLAIMS_REASON),
      lab: joinsLab,
    },
    credits_monthly: !credits ? pending(HQ_READS_REASON) : credits,
    definitions: PROGRAM_DEFINITIONS,
  };
}

// ---------------------------------------------------------------------------
// The per-studio form (D893's fan-out)
// ---------------------------------------------------------------------------

/** The query parameters that cross to the branch. Nothing else does. */
export const PROGRAMS_PARAM_KEYS = ['weeks'] as const;
export type ProgramsParams = Partial<Record<typeof PROGRAMS_PARAM_KEYS[number], string>>;
export type ProgramsLoader = (env: Env, params: ProgramsParams) => Promise<Record<string, unknown>>;

export function programsParams(query: Record<string, string | undefined>): ProgramsParams {
  const out: ProgramsParams = {};
  for (const k of PROGRAMS_PARAM_KEYS) {
    const v = query[k];
    if (typeof v === 'string' && v.trim()) out[k] = v.trim().slice(0, 16);
  }
  return out;
}

/** What a branch runs when HQ's Super Admin picks it: this read over its own D1, as HQ reads it. */
export const loadProgramsForBranch: ProgramsLoader = async (env, params) => {
  const weeks = parseProgramWeeks(params.weeks);
  if (!weeks) throw new Error('weeks must be 4, 12 or 52.');
  return programCatalogue(env, { id: 0, superAdmin: true }, weeks);
};

/** Every block unreadable with one reason: what a branch that did not answer shows. */
export function unreadablePrograms(scope: Record<string, unknown>, reason: string, extra: Record<string, unknown> = {}) {
  const off = () => ({ available: false, unreadable: true, reason });
  return {
    scope,
    as_of: null,
    programs: off(),
    tiles: { running: off(), people: off(), waiting: off(), credits: off() },
    waiting: { cohort: off(), referrals: off(), strategic: off(), perks: off(), hosts: off() },
    joins_weekly: { referrals: off(), learning: off(), perks: off(), lab: off() },
    credits_monthly: off(),
    definitions: PROGRAM_DEFINITIONS,
    ...extra,
  };
}

/**
 * HQ's read of one subsidiary: the branch's own answer, counts only, with
 * HQ's label on its scope and HQ's registry names on its rows (`countsOnly`
 * drops `name`, so a branch answers program keys and counts). Never throws.
 */
export async function branchScopedPrograms(env: Env, code: string, params: ProgramsParams) {
  const listed = await insightsScopes(env).then((s) => s.scopes.find((x) => x.code === code), () => undefined);
  const label = listed?.label ?? code;
  const scope = { key: code, label, kind: 'branch' as const, source: 'counts read from its own database' };
  const r = await branchRead<{ programs?: Record<string, unknown> }>(env, code, 'programs', [params]);
  const read = r.status === 'ok' && r.data?.programs && typeof r.data.programs === 'object' ? r.data.programs : null;
  if (!read) {
    const reason = r.status === 'ok'
      ? 'The branch answered without a Programs read.'
      : r.status === 'not_deployed'
        ? `${label} is not bound to this Worker yet, so its database cannot be asked. ${r.reason || ''}`.trim()
        : `${label} did not answer, so its counts are not shown: ${r.reason || 'unknown'}.`;
    return unreadablePrograms(scope, reason, { branch: { status: r.status, ...(r.timed_out ? { timed_out: true } : {}) } });
  }
  const clean = countsOnly(read) as Record<string, any>;
  const names = await listPrograms(env).then((rows) => new Map(rows.map((x) => [x.key, x.name])), () => new Map<string, string>());
  if (clean.programs?.available && Array.isArray(clean.programs.rows)) {
    clean.programs.rows = clean.programs.rows
      .filter((x: any) => (PROGRAM_KEYS as readonly string[]).includes(x?.key))
      .map((x: any) => ({ ...x, name: names.get(x.key) ?? null }));
  }
  return { ...clean, scope, as_of: r.as_of ?? clean.as_of ?? null, branch: { status: 'ok' } };
}
