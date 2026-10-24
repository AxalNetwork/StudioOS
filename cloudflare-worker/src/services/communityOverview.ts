/**
 * D931 (#2715) — THE COMMUNITY READ: Admin › Community's period figures and
 * charts (the owner's canvas, CM1) from one request, as counts.
 *
 * COUNTS ONLY. No member's name, email or account id leaves the read. Every
 * query below groups, counts or sums; the strings that travel are statuses,
 * types, kinds, role keys, Monday weeks, and a posting's title and company.
 *
 * EACH BLOCK ANSWERS ALONE, in D893's shape:
 *   · `{ available: true, ... }` — read;
 *   · `{ available: false, unreadable: true, reason }` — its store failed, and
 *     that is not a claim of zero;
 *   · `{ recorded: false, reason }` — no store holds it.
 * `queue`, `participation_by_role` and `wellbeing` are made of parts that read
 * different stores, so each part is its own block and fails alone.
 *
 * ONE DEFINITION PER FIGURE. Every events figure (registrations, show-up, by
 * type, by role, the events queue's age) is D918's (#2701), read through its
 * events overview (`readOverview` in services/adminEventsReads.ts) so
 * Community and the Events desk cannot disagree. Each of its blocks keeps its
 * own answer here: a block D918 could not read is unreadable here too, and
 * nothing is recomputed. Only the keys are Community's.
 *
 * WELLBEING ANSWERS ARE NEVER READ. The check-in band counts distinct members
 * in `wellbeing_daily_pulses` and touches no other column, so no answer is
 * decrypted or summed. It is bucketed, and withheld below a cohort of seven.
 *
 * WEEKS ARE MONDAY WEEKS IN UTC, from `weekAxis`, as Insights draws them. The
 * window is the axis (the current week to date included); the period before is
 * the same number of weeks immediately before it.
 */
import type { Env } from '../types';
import { weekAxis, type WeekAxis } from './activeAccounts';
import { readOverview } from './adminEventsReads';
import { previousAxis } from './adminInsights';
import { JOB_STATUSES } from './jobBoardCommon';
import { SAMPLE_EXPERT_UID_PREFIX } from './wellbeing/seedExperts';

export const COMMUNITY_WEEKS = [4, 12, 52] as const;
export type CommunityWeeks = typeof COMMUNITY_WEEKS[number];

/** D915: an item waiting longer than this is Overdue. */
export const OVERDUE_HOURS = 72;
/** The fewest members a check-in band is shown for (the wellbeing aggregate's floor). */
export const MIN_CHECKIN_COHORT = 7;
/** The check-in band's width: a count is shown as the multiple of this at or below it. */
export const CHECKIN_BUCKET = 5;
/** The postings `jobs.top` lists. */
export const TOP_POSTINGS = 5;

export const DAYS_OPEN_REASON = 'No store records when a posting was published, so how long it has been open is not known.';
/** D930 §5: the corrected CM1 sentence. */
export const ACTIVE_MEMBERS_REASON =
  'Nothing records who took part in Community, apart from using the platform. Insights counts active accounts platform-wide.';
export const CIRCLE_DISCUSSIONS_REASON = 'Circles have no discussion store. The number on a circle is typed by an admin.';

/** The roles Community counts by. Explorers and guests are their own keys; every other role is `other`. */
export const PARTICIPATION_ROLES = ['founder', 'investor', 'advisor', 'operating_partner', 'explorer', 'guest', 'other'] as const;
export type ParticipationRole = typeof PARTICIPATION_ROLES[number];

type Unreadable = { available: false; unreadable: true; reason: string };
type NotRecorded = { recorded: false; reason: string };

const n = (v: unknown) => Math.max(0, Math.trunc(Number(v) || 0));
const sqlTime = (ms: number) => new Date(ms).toISOString().slice(0, 19).replace('T', ' ');

const unreadable = (what: string, e: unknown): Unreadable => {
  console.error('[admin-community]', what, typeof e === 'string' ? e : (e as Error)?.message);
  return { available: false, unreadable: true, reason: `${what} could not be read on this database. That is not the same as none.` };
};

/** Runs `read`; a throw becomes that block's own `unreadable`. */
async function block<T>(what: string, read: () => Promise<T>): Promise<({ available: true } & T) | Unreadable> {
  try {
    return { available: true, ...(await read()) };
  } catch (e) {
    return unreadable(what, e);
  }
}


/** `users.role` (or no account) as a Community role. `mentor` is an advisor, `partner` an Operating Partner. */
export function participationRole(role: unknown, hasAccount: boolean): ParticipationRole {
  if (!hasAccount) return 'guest';
  const r = String(role ?? '').trim().toLowerCase();
  if (r === 'founder' || r === 'investor') return r;
  if (r === 'advisor' || r === 'mentor') return 'advisor';
  if (r === 'partner' || r === 'operating_partner') return 'operating_partner';
  if (r === 'exploring' || r === 'explorer') return 'explorer';
  return 'other';
}

const zeroRoles = () => Object.fromEntries(PARTICIPATION_ROLES.map((r) => [r, 0])) as Record<ParticipationRole, number>;

type Weekly = { week: string; count: number; to_date: boolean };

/** Counts per Monday week of `axis`, from `(week, n)` rows; a week with no row is a measured 0. */
function weekly(axis: WeekAxis, rows: Array<{ week: unknown; n: unknown }>): Weekly[] {
  const by = new Map(rows.map((r) => [String(r.week), n(r.n)]));
  return axis.weeks.map((w) => ({ week: w, count: by.get(w) ?? 0, to_date: w === axis.current }));
}

// ---------------------------------------------------------------------------
// Jobs
// ---------------------------------------------------------------------------

/** The postings waiting for review, and how long the oldest has waited since it was submitted. */
async function jobsQueue(env: Env, nowMs: number) {
  const r = await env.DB.prepare(
    `SELECT COUNT(*) AS pending,
            SUM(CASE WHEN submitted_at IS NULL THEN 1 ELSE 0 END) AS no_submitted_at,
            SUM(CASE WHEN submitted_at IS NOT NULL AND datetime(submitted_at) < datetime(?) THEN 1 ELSE 0 END) AS overdue,
            MIN(CASE WHEN submitted_at IS NOT NULL THEN datetime(submitted_at) END) AS oldest
       FROM job_postings WHERE status = 'pending_review'`,
  ).bind(sqlTime(nowMs - OVERDUE_HOURS * 3_600_000)).first<{ pending: number; no_submitted_at: number; overdue: number; oldest: string | null }>();
  const oldest = r?.oldest ? String(r.oldest) : null;
  const waited = oldest ? Date.parse(`${oldest.replace(' ', 'T')}Z`) : NaN;
  return {
    pending: n(r?.pending),
    overdue: n(r?.overdue),
    // Submitted before migration 550: waiting, with no recorded wait. Never counted as Overdue or as 0 hours.
    wait_not_recorded: n(r?.no_submitted_at),
    oldest_submitted_at: oldest,
    oldest_wait_hours: Number.isFinite(waited) ? Math.max(0, Math.floor((nowMs - waited) / 3_600_000)) : null,
  };
}

async function jobsBlock(env: Env, axis: WeekAxis, before: WeekAxis) {
  const apps = await env.DB.prepare(
    `SELECT SUM(CASE WHEN datetime(created_at) >= datetime(?) AND datetime(created_at) < datetime(?) THEN 1 ELSE 0 END) AS window,
            SUM(CASE WHEN datetime(created_at) >= datetime(?) AND datetime(created_at) < datetime(?) THEN 1 ELSE 0 END) AS previous
       FROM job_applications`,
  ).bind(axis.from, axis.to, before.from, before.to).first<{ window: number; previous: number }>();
  const byWeek = await env.DB.prepare(
    `SELECT date(created_at, '-6 days', 'weekday 1') AS week, COUNT(*) AS n
       FROM job_applications
      WHERE datetime(created_at) >= datetime(?) AND datetime(created_at) < datetime(?)
      GROUP BY 1`,
  ).bind(axis.from, axis.to).all<{ week: string; n: number }>();
  const statuses = await env.DB.prepare(`SELECT status, COUNT(*) AS n FROM job_postings GROUP BY status`)
    .all<{ status: string; n: number }>();
  const by_status: Record<string, number> = Object.fromEntries([...JOB_STATUSES, 'other'].map((s) => [s, 0]));
  for (const r of statuses.results || []) {
    const s = (JOB_STATUSES as readonly string[]).includes(String(r.status)) ? String(r.status) : 'other';
    by_status[s] += n(r.n);
  }
  const top = await env.DB.prepare(
    `SELECT j.title AS title, p.name AS company, j.status AS status, COUNT(a.id) AS applications
       FROM job_applications a
       JOIN job_postings j ON j.id = a.posting_id
       LEFT JOIN projects p ON p.id = j.project_id
      WHERE datetime(a.created_at) >= datetime(?) AND datetime(a.created_at) < datetime(?)
      GROUP BY j.id
      ORDER BY applications DESC, j.id ASC
      LIMIT ?`,
  ).bind(axis.from, axis.to, TOP_POSTINGS).all<{ title: string; company: string | null; status: string; applications: number }>();
  return {
    applications: { window: n(apps?.window), previous: n(apps?.previous) },
    weekly: weekly(axis, byWeek.results || []),
    by_status,
    top: (top.results || []).map((r) => ({
      title: String(r.title ?? ''),
      company: r.company == null ? null : String(r.company),
      status: String(r.status ?? ''),
      applications: n(r.applications),
    })),
    days_open: { recorded: false, reason: DAYS_OPEN_REASON } as NotRecorded,
  };
}

/** Job applications in the window by the applicant's role; an application with no account is a guest's. */
async function jobsByRole(env: Env, axis: WeekAxis) {
  const q = await env.DB.prepare(
    `SELECT u.role AS role, CASE WHEN u.id IS NULL THEN 0 ELSE 1 END AS has_account, COUNT(*) AS n
       FROM job_applications a
       LEFT JOIN users u ON u.id = a.user_id
      WHERE datetime(a.created_at) >= datetime(?) AND datetime(a.created_at) < datetime(?)
      GROUP BY 1, 2`,
  ).bind(axis.from, axis.to).all<{ role: string | null; has_account: number; n: number }>();
  const by_role = zeroRoles();
  for (const r of q.results || []) by_role[participationRole(r.role, n(r.has_account) === 1)] += n(r.n);
  return { by_role };
}

// ---------------------------------------------------------------------------
// Circles, the network roster
// ---------------------------------------------------------------------------

async function circlesBlock(env: Env) {
  const t = await env.DB.prepare(
    `SELECT COUNT(*) AS total,
            SUM(CASE WHEN published = 1 THEN 1 ELSE 0 END) AS published,
            SUM(CASE WHEN featured = 1 THEN 1 ELSE 0 END) AS featured,
            SUM(members) AS members
       FROM circles`,
  ).first<{ total: number; published: number; featured: number; members: number }>();
  const group = async (col: 'type' | 'access') => {
    const q = await env.DB.prepare(
      col === 'type'
        ? `SELECT type AS k, COUNT(*) AS n FROM circles GROUP BY type`
        : `SELECT access AS k, COUNT(*) AS n FROM circles GROUP BY access`,
    ).all<{ k: string; n: number }>();
    return Object.fromEntries((q.results || []).map((r) => [String(r.k ?? ''), n(r.n)]));
  };
  const total = n(t?.total);
  const published = n(t?.published);
  return {
    total,
    published,
    draft: total - published,
    featured: n(t?.featured),
    by_type: await group('type'),
    by_access: await group('access'),
    // Typed by an admin on each circle (D930 §5): a number as entered, not a count of anyone.
    members_entered: { value: n(t?.members), typed: true },
  };
}

async function networkBlock(env: Env) {
  const q = await env.DB.prepare(
    `SELECT kind, CASE WHEN is_active = 1 THEN 1 ELSE 0 END AS active, COUNT(*) AS n
       FROM network_profiles GROUP BY 1, 2`,
  ).all<{ kind: string; active: number; n: number }>();
  const by_kind: Record<string, number> = {};
  let active = 0;
  let inactive = 0;
  for (const r of q.results || []) {
    const k = String(r.kind ?? '') === 'mentor' ? 'advisor' : String(r.kind ?? '');
    by_kind[k] = (by_kind[k] ?? 0) + n(r.n);
    if (n(r.active) === 1) active += n(r.n); else inactive += n(r.n);
  }
  return { by_kind, active, inactive };
}

// ---------------------------------------------------------------------------
// Wellbeing
// ---------------------------------------------------------------------------

/** The real experts by state: the sample experts (`SAMPLE_EXPERT_UID_PREFIX`) are never counted. */
async function expertsPart(env: Env) {
  const r = await env.DB.prepare(
    `SELECT SUM(CASE WHEN COALESCE(hidden_by_admin, 0) = 0 AND is_active = 1 AND verified = 1 THEN 1 ELSE 0 END) AS verified,
            SUM(CASE WHEN COALESCE(hidden_by_admin, 0) = 0 AND is_active = 1 AND verified = 0 THEN 1 ELSE 0 END) AS unverified,
            SUM(CASE WHEN COALESCE(hidden_by_admin, 0) = 1 THEN 1 ELSE 0 END) AS hidden,
            SUM(CASE WHEN COALESCE(hidden_by_admin, 0) = 0 AND is_active = 0 THEN 1 ELSE 0 END) AS inactive
       FROM experts WHERE substr(uid, 1, ?) <> ?`,
  ).bind(SAMPLE_EXPERT_UID_PREFIX.length, SAMPLE_EXPERT_UID_PREFIX)
    .first<{ verified: number; unverified: number; hidden: number; inactive: number }>();
  return { verified: n(r?.verified), unverified: n(r?.unverified), hidden: n(r?.hidden), inactive: n(r?.inactive) };
}

/** Bookings by when they were made, with real experts only. */
async function bookingsPart(env: Env, axis: WeekAxis, before: WeekAxis) {
  const totals = await env.DB.prepare(
    `SELECT SUM(CASE WHEN datetime(b.created_at) >= datetime(?) AND datetime(b.created_at) < datetime(?) THEN 1 ELSE 0 END) AS window,
            SUM(CASE WHEN datetime(b.created_at) >= datetime(?) AND datetime(b.created_at) < datetime(?) THEN 1 ELSE 0 END) AS previous
       FROM expert_bookings b JOIN experts e ON e.id = b.expert_id
      WHERE substr(e.uid, 1, ?) <> ?`,
  ).bind(axis.from, axis.to, before.from, before.to, SAMPLE_EXPERT_UID_PREFIX.length, SAMPLE_EXPERT_UID_PREFIX)
    .first<{ window: number; previous: number }>();
  const byWeek = await env.DB.prepare(
    `SELECT date(b.created_at, '-6 days', 'weekday 1') AS week, COUNT(*) AS n
       FROM expert_bookings b JOIN experts e ON e.id = b.expert_id
      WHERE datetime(b.created_at) >= datetime(?) AND datetime(b.created_at) < datetime(?)
        AND substr(e.uid, 1, ?) <> ?
      GROUP BY 1`,
  ).bind(axis.from, axis.to, SAMPLE_EXPERT_UID_PREFIX.length, SAMPLE_EXPERT_UID_PREFIX).all<{ week: string; n: number }>();
  return { window: n(totals?.window), previous: n(totals?.previous), weekly: weekly(axis, byWeek.results || []) };
}

/**
 * How many members checked in during the window, as a band. Reads `user_id`
 * and `day` only: no answer column is selected, so nothing is decrypted.
 * Under `MIN_CHECKIN_COHORT` the band is withheld.
 */
async function checkinsPart(env: Env, axis: WeekAxis) {
  const r = await env.DB.prepare(
    `SELECT COUNT(DISTINCT user_id) AS members FROM wellbeing_daily_pulses WHERE day >= ? AND day < ?`,
  ).bind(axis.from.slice(0, 10), axis.to.slice(0, 10)).first<{ members: number }>();
  const members = n(r?.members);
  if (members < MIN_CHECKIN_COHORT) return { withheld: true, min_cohort: MIN_CHECKIN_COHORT, band: null };
  const lo = Math.floor(members / CHECKIN_BUCKET) * CHECKIN_BUCKET;
  return { withheld: false, min_cohort: MIN_CHECKIN_COHORT, band: { at_least: lo, under: lo + CHECKIN_BUCKET } };
}

// ---------------------------------------------------------------------------
// Events: D918's blocks, in Community's keys
// ---------------------------------------------------------------------------

type D918Block = { available: true; [k: string]: any } | Unreadable;
const isRead = (b: D918Block | undefined): b is { available: true; [k: string]: any } => Boolean(b && b.available === true);

/** D918's role buckets as Community's. An account D918 cannot place stays `not_recorded`, apart from `other`. */
const D918_ROLE: Record<string, ParticipationRole> = {
  founder: 'founder', investor: 'investor', advisor: 'advisor', partner: 'operating_partner', exploring: 'explorer', guest: 'guest', admin: 'other',
};

export function eventsByRole(b: D918Block) {
  if (!isRead(b)) return b;
  const by_role = zeroRoles();
  let notRecorded = 0;
  for (const [k, v] of Object.entries(b.counts || {})) {
    const role = D918_ROLE[k];
    if (role) by_role[role] += n(v);
    else notRecorded += n(v);
  }
  return { available: true as const, by_role, not_recorded: notRecorded };
}

/** D918's weekly block on Community's week keys: `week`, and `to_date` on the current one. */
export function eventsWeekly(b: D918Block) {
  if (!isRead(b)) return b;
  const weeks = Array.isArray(b.weeks) ? b.weeks : [];
  return {
    available: true as const,
    registrations: { window: n(b.registrations?.this_period), previous: n(b.registrations?.previous_period) },
    weekly: weeks.map((w: any) => ({ week: String(w.week_start), registrations: n(w.registrations), checkins: n(w.checkins), to_date: w.to_date === true })),
  };
}

/** D918's show-up, counts only: its list of recent events stays on the Events desk. */
export function showUpCounts(b: D918Block) {
  if (!isRead(b)) return b;
  const { recent: _recent, ...counts } = b;
  return counts;
}

/**
 * The events parts of the read, from one call to D918's overview. It catches
 * inside each of its blocks, so a failed store fails only the parts it feeds.
 */
async function eventsParts(env: Env, weeks: CommunityWeeks, nowMs: number) {
  const o = await readOverview(env, weeks, nowMs);
  return {
    queue: o.queue,
    events: {
      weekly: eventsWeekly(o.weekly as D918Block),
      show_up: showUpCounts(o.show_up as D918Block),
      by_type: o.by_type,
      waitlisted: o.waitlisted,
    },
    byRole: eventsByRole(o.by_role as D918Block),
  };
}

// ---------------------------------------------------------------------------
// The read
// ---------------------------------------------------------------------------

export function parseCommunityWeeks(raw: string | undefined): CommunityWeeks | null {
  if (raw === undefined || raw === '') return 4;
  const w = Number(raw);
  return (COMMUNITY_WEEKS as readonly number[]).includes(w) && String(w) === raw ? (w as CommunityWeeks) : null;
}

export async function communityOverview(env: Env, weeks: CommunityWeeks, nowMs: number = Date.now()) {
  const axis = weekAxis(new Date(nowMs).toISOString(), weeks);
  const before = previousAxis(axis);
  const [ev, jobsQ, jobs, jobsRoles, circles, network, experts, bookings, checkins] = await Promise.all([
    eventsParts(env, weeks, nowMs),
    block('The job board queue', () => jobsQueue(env, nowMs)),
    block('The job board', () => jobsBlock(env, axis, before)),
    block('Job applications by role', () => jobsByRole(env, axis)),
    block('Circles', () => circlesBlock(env)),
    block('The network roster', () => networkBlock(env)),
    block('Wellbeing experts', () => expertsPart(env)),
    block('Expert bookings', () => bookingsPart(env, axis, before)),
    block('Wellbeing check-ins', () => checkinsPart(env, axis)),
  ]);
  return {
    weeks,
    week_starts: axis.weeks,
    current_week: axis.current,
    window: { from: axis.from, to: axis.to },
    previous: { from: before.from, to: before.to },
    as_of: new Date(nowMs).toISOString(),
    blocks: {
      queue: { events: ev.queue, jobs: jobsQ, overdue_hours: OVERDUE_HOURS },
      events: ev.events,
      jobs,
      participation_by_role: { events: ev.byRole, jobs: jobsRoles },
      circles,
      network,
      wellbeing: { experts, bookings, checkins },
      active_members: { recorded: false, reason: ACTIVE_MEMBERS_REASON } as NotRecorded,
      circle_discussions: { recorded: false, reason: CIRCLE_DISCUSSIONS_REASON } as NotRecorded,
    },
  };
}
