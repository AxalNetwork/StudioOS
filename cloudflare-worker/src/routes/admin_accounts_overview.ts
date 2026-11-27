/**
 * D1301 (#3397, part 2 of #2377) — Admin › Accounts' overview, one read.
 *
 *   GET /api/admin/accounts/overview
 *
 * requireAdmin. What ACC1 draws (the owner's Accounts canvas, integrated by
 * D1299): the four figures, a widget per profile with its eight weeks of
 * sign-ups, the LPs, account readiness, the Explorer split, "Waiting on you",
 * and the newest accounts and those that need attention.
 *
 * COUNTED AS INSIGHTS COUNTS. Every figure about who the accounts are folds
 * from `accountCounts.ts`'s `liveAccounts`, the pass Admin › Insights (D893)
 * reads, and the LPs, deactivated accounts, sign-up weeks and last activity
 * come from the same helpers. Insights and this page cannot show two totals.
 *
 * EACH BLOCK ANSWERS ALONE: `{ available: true, ... }`, or
 * `{ available: false, unreadable: true, reason }` when its store failed (never
 * a zero), or `{ available: false, recorded: false, reason }` when nothing on
 * this database records it. One failed block never takes another with it.
 *
 * TWO LISTS CARRY ROWS. Newest and Needs attention name the account (its id,
 * name, profile and country, never its email) so the page can open its record
 * at `/admin/accounts/all/<id>`. An administrator's record is the Super
 * Admin's (D1299), so another admin's row is listed only to a Super Admin.
 * Nothing here is logged but a block's name and its error.
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import { isSuperAdmin, requireAdmin } from '../auth';
import { mapError } from './_t13t14t15_helpers';
import { weekAxis } from '../services/activeAccounts';
import { TOS_KEY } from '../services/activationFunnel';
import { OPEN_STATUSES } from '../services/lpApplicationReview';
import { ownScope, scopeLabel } from '../services/adminInsights';
import {
  DAY_MS, DORMANT_DAYS, NO_FILTER, READY_PROFILE_PCT, UNVERIFIED_OVERDUE_DAYS, type AccountRow,
  deactivatedCount, dormantCount, liveAccounts, lpByProfile, n, signupsByWeek, sqlTime,
} from '../services/accountCounts';

/** The five profiles ACC1 draws a widget for, in its order, with `users.role`'s key for each (#2377 G1). */
export const PROFILES = Object.freeze([
  { key: 'founder', label: 'Founders' },
  { key: 'investor', label: 'Investors' },
  { key: 'advisor', label: 'Advisors' },
  { key: 'partner', label: 'Operating Partners' },
  { key: 'exploring', label: 'Explorers' },
]);

/** Weeks of sign-ups each widget draws: eight, the last to date. */
export const SIGNUP_WEEKS = 8;

/** How many rows Newest and Needs attention list. */
export const ROW_LIMIT = 5;

export const PRODUCT_TESTERS_REASON =
  'A Product tester is a sub-account D1302 adds; until its store lands nothing on this database marks one, so no figure is shown.';

export const TESTER_APPLICATIONS_REASON =
  'Applications to become a Product tester are D1302’s store, which has not landed; they are not counted here yet.';

export const LIMITED_ACCESS_REASON =
  'How long an account has had limited access is not recorded: `users.access_level` keeps the level, not when it was set.';

/** One sentence per block, for the page's "How is this counted?". Shared wording with Insights where the count is shared. */
export const OVERVIEW_DEFINITIONS = {
  accounts: 'Accounts that are not deactivated, as Insights counts them. New in 30 days counts those created in the last 30 days; deactivated are counted apart.',
  active_30d: `Accounts that are not deactivated whose latest request (users.last_active_at) is under ${DORMANT_DAYS} days old. Accounts never seen are counted apart, never as idle.`,
  unverified: `Accounts that are not deactivated whose email is not verified; overdue counts those created more than ${UNVERIFIED_OVERDUE_DAYS} days ago.`,
  waiting: 'Explorers whose binding agreement is signed and who still have no profile, and LP applications still open (pending, in review, or needing follow-up).',
  profiles: 'Accounts that are not deactivated, by profile. Each widget’s weeks count every account created that week, deactivated included, as Insights’ growth chart does; the current week is to date.',
  lps: 'Accounts that are not deactivated with an approved LP application, by their own profile, as Insights counts them. An LP record in a fund (limited_partners) is not counted (D1301).',
  readiness: `Of the accounts that are not deactivated, how many have done each step, in any order: email verified, the Terms accepted, identity check approved, a profile at least ${READY_PROFILE_PCT}% complete, active in the last ${DORMANT_DAYS} days.`,
  explorers: 'Explorers that are not deactivated, by their binding agreement: not sent, sent and not signed, or signed and ready for a profile.',
  newest: 'The five accounts created most recently that are not deactivated.',
  attention: `Accounts that are not deactivated and wait on an administrator: an email unverified for more than ${UNVERIFIED_OVERDUE_DAYS} days, an identity check waiting, an Explorer whose agreement is signed, an open LP application. Oldest first.`,
} as const;

type Unreadable = { available: false; unreadable: true; reason: string };
type NotRecorded = { available: false; recorded: false; reason: string };

const unreadable = (what: string, e: unknown): Unreadable => {
  console.error('[admin-accounts-overview]', what, typeof e === 'string' ? e : (e as Error)?.message);
  return { available: false, unreadable: true, reason: `${what} could not be read on this database. That is not the same as none.` };
};
const notRecorded = (reason: string): NotRecorded => ({ available: false, recorded: false, reason });

async function block<T extends object>(what: string, read: () => Promise<T>): Promise<({ available: true } & T) | Unreadable> {
  try {
    return { available: true, ...(await read()) };
  } catch (e) {
    return unreadable(what, e);
  }
}

// ---------------------------------------------------------------------------
// Reads this page adds. Each is one bound statement over its own store.
// ---------------------------------------------------------------------------

/** Live accounts that accepted the current Terms, by profile (the funnel's key, `TOS_KEY`). */
async function termsByProfile(env: Env): Promise<Map<string, number>> {
  const q = await env.DB.prepare(
    `SELECT COALESCE(NULLIF(u.role, ''), 'no role') AS profile, COUNT(DISTINCT l.user_id) AS n
       FROM legal_acceptances l JOIN users u ON u.id = l.user_id
      WHERE l.obligation_key = ? AND u.is_active = 1
      GROUP BY 1`,
  ).bind(TOS_KEY).all<{ profile: string; n: number }>();
  return new Map((q.results || []).map((r) => [String(r.profile), n(r.n)]));
}

/** Live Explorers by their binding agreement: the Exploring board's own states (`admin_exploring.ts`). */
async function explorerSplit(env: Env) {
  const r = await env.DB.prepare(
    `SELECT COUNT(*) AS total,
            SUM(CASE WHEN rr.binding_envelope_id IS NULL THEN 1 ELSE 0 END) AS not_sent,
            SUM(CASE WHEN rr.binding_envelope_id IS NOT NULL
                      AND lower(COALESCE(e.status, '')) <> 'completed' THEN 1 ELSE 0 END) AS sent_unsigned,
            SUM(CASE WHEN rr.binding_envelope_id IS NOT NULL
                      AND lower(COALESCE(e.status, '')) = 'completed' THEN 1 ELSE 0 END) AS signed
       FROM users u
       LEFT JOIN user_role_review rr ON rr.user_id = u.id
       LEFT JOIN esign_envelopes e ON e.id = rr.binding_envelope_id AND e.user_id = u.id
      WHERE u.is_active = 1 AND u.role = 'exploring'`,
  ).first<{ total: number; not_sent: number; sent_unsigned: number; signed: number }>();
  return { total: n(r?.total), not_sent: n(r?.not_sent), sent_unsigned: n(r?.sent_unsigned), signed_ready: n(r?.signed) };
}

/** The LP queue's open states. Three, bound to the three placeholders below (a test holds the length). */
export const OPEN_LP = OPEN_STATUSES as readonly string[];

/** Open LP applications from live accounts: what the LP applications queue still has to decide. */
async function openLpApplications(env: Env): Promise<number> {
  const r = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM lp_applications l JOIN users u ON u.id = l.user_id
      WHERE u.is_active = 1 AND l.status IN (?, ?, ?)`,
  ).bind(...OPEN_LP).first<{ n: number }>();
  return n(r?.n);
}

type Person = { id: number; name: string; profile: string; country: string | null };
type PersonRow = { id: number; name: string; role: string; country: string | null; at: string | null };
const person = (r: PersonRow): Person => ({
  id: Number(r.id), name: String(r.name ?? ''), profile: String(r.role || 'no role'),
  country: r.country && String(r.country).trim() ? String(r.country).trim() : null,
});

/** `admins` is 1 when the caller is a Super Admin: only then are other administrators listed. */
async function newestAccounts(env: Env, admins: 0 | 1) {
  const q = await env.DB.prepare(
    `SELECT u.id, u.name, u.role, u.country, u.created_at AS at
       FROM users u
      WHERE u.is_active = 1 AND (? = 1 OR u.role <> 'admin')
      ORDER BY datetime(u.created_at) DESC, u.id DESC
      LIMIT ?`,
  ).bind(admins, ROW_LIMIT).all<PersonRow>();
  return { rows: (q.results || []).map((r) => ({ ...person(r), joined_at: r.at ?? null })) };
}

type AttentionKind = 'email_unverified' | 'identity_waiting' | 'explorer_signed' | 'lp_application';

/** Each kind of "needs attention" is its own statement, so one store failing costs only its own rows. */
const ATTENTION: ReadonlyArray<{ kind: AttentionKind; what: string; sql: string; binds: (nowMs: number) => unknown[] }> = [
  {
    kind: 'email_unverified', what: 'Email verification',
    sql: `SELECT u.id, u.name, u.role, u.country, u.created_at AS at, COUNT(*) OVER () AS total
            FROM users u
           WHERE u.is_active = 1 AND COALESCE(u.email_verified, 0) = 0
             AND datetime(u.created_at) < datetime(?) AND (? = 1 OR u.role <> 'admin')
           ORDER BY datetime(u.created_at) ASC, u.id ASC LIMIT ?`,
    binds: (nowMs) => [sqlTime(nowMs - UNVERIFIED_OVERDUE_DAYS * DAY_MS)],
  },
  {
    kind: 'identity_waiting', what: 'Identity checks',
    sql: `SELECT u.id, u.name, u.role, u.country, u.kyc_submitted_at AS at, COUNT(*) OVER () AS total
            FROM users u
           WHERE u.is_active = 1 AND u.kyc_status = 'pending' AND (? = 1 OR u.role <> 'admin')
           ORDER BY u.kyc_submitted_at IS NULL, datetime(u.kyc_submitted_at) ASC, u.id ASC LIMIT ?`,
    binds: () => [],
  },
  {
    kind: 'explorer_signed', what: 'Explorer agreements',
    sql: `SELECT u.id, u.name, u.role, u.country, e.completed_at AS at, COUNT(*) OVER () AS total
            FROM users u
            JOIN user_role_review rr ON rr.user_id = u.id
            JOIN esign_envelopes e ON e.id = rr.binding_envelope_id AND e.user_id = u.id
           WHERE u.is_active = 1 AND u.role = 'exploring' AND lower(COALESCE(e.status, '')) = 'completed'
             AND (? = 1 OR u.role <> 'admin')
           ORDER BY e.completed_at IS NULL, datetime(e.completed_at) ASC, u.id ASC LIMIT ?`,
    binds: () => [],
  },
  {
    kind: 'lp_application', what: 'LP applications',
    sql: `SELECT u.id, u.name, u.role, u.country, MIN(l.created_at) AS at, COUNT(*) OVER () AS total
            FROM lp_applications l JOIN users u ON u.id = l.user_id
           WHERE u.is_active = 1 AND l.status IN (?, ?, ?) AND (? = 1 OR u.role <> 'admin')
           GROUP BY u.id
           ORDER BY datetime(MIN(l.created_at)) ASC, u.id ASC LIMIT ?`,
    binds: () => [...OPEN_LP],
  },
];

async function needsAttention(env: Env, admins: 0 | 1, nowMs: number) {
  const parts = await Promise.all(ATTENTION.map(async (a) => {
    try {
      const q = await env.DB.prepare(a.sql)
        .bind(...a.binds(nowMs), admins, ROW_LIMIT)
        .all<PersonRow & { total: number }>();
      const rows = q.results || [];
      return { kind: a.kind, ok: true as const, total: rows.length ? n(rows[0].total) : 0, rows };
    } catch (e) {
      return { kind: a.kind, ok: false as const, failure: unreadable(a.what, e) };
    }
  }));
  // No kind could be read: the list is unreadable, never an empty "nothing needs you".
  if (!parts.some((p) => p.ok)) throw new Error('no kind of attention could be read');
  const rows = parts.flatMap((p) => (p.ok ? p.rows.map((r) => ({ ...person(r), kind: p.kind, since: r.at ?? null })) : []))
    // Oldest first; a row whose start was never recorded goes last, never first.
    .sort((x, y) => (x.since === null ? 1 : 0) - (y.since === null ? 1 : 0)
      || String(x.since ?? '').localeCompare(String(y.since ?? '')) || x.id - y.id)
    .slice(0, ROW_LIMIT);
  const by_kind: Record<string, { available: true; count: number } | Unreadable> = {};
  for (const p of parts) by_kind[p.kind] = p.ok ? { available: true, count: p.total } : p.failure;
  return {
    rows,
    by_kind,
    // Two kinds the canvas draws that nothing here can read yet.
    not_recorded: {
      tester_application: TESTER_APPLICATIONS_REASON,
      limited_access: LIMITED_ACCESS_REASON,
    },
    // Rows from a kind that failed are missing, so the list says it is partial.
    partial: parts.some((p) => !p.ok),
  };
}

// ---------------------------------------------------------------------------
// Folding the shared rows.
// ---------------------------------------------------------------------------

type Steps = { email_verified: number; terms_accepted: number | null; identity_approved: number; profile_ready: number; active_30d: number };

function readinessOf(rows: AccountRow[], terms: number | null): { total: number } & Steps {
  let total = 0, unverified = 0, identity = 0, ready = 0, active = 0;
  for (const r of rows) {
    total += r.n;
    unverified += r.unverified;
    active += r.active_30d;
    if (r.kyc === 'approved') identity += r.n;
    const pct = r.pct === null || r.pct === undefined ? NaN : Number(r.pct);
    if (Number.isFinite(pct) && pct >= READY_PROFILE_PCT) ready += r.n;
  }
  return { total, email_verified: total - unverified, terms_accepted: terms, identity_approved: identity, profile_ready: ready, active_30d: active };
}

export async function accountsOverview(env: Env, opts: { nowMs?: number; includeAdmins?: boolean } = {}) {
  const nowMs = opts.nowMs ?? Date.now();
  const admins: 0 | 1 = opts.includeAdmins ? 1 : 0;
  const axis = weekAxis(new Date(nowMs).toISOString(), SIGNUP_WEEKS);

  const [accounts, deactivated, lastSeen, growth, lps, lpOpen, terms, explorers, newest, attention] = await Promise.all([
    block('The account table', async () => ({ rows: await liveAccounts(env, NO_FILTER, nowMs) })),
    block('Deactivated accounts', async () => ({ count: await deactivatedCount(env, NO_FILTER) })),
    block('Last activity', async () => dormantCount(env, NO_FILTER, nowMs)),
    block('Sign-ups', async () => ({ weeks: await signupsByWeek(env, axis, NO_FILTER) })),
    block('The LP applications', async () => ({ by_profile: await lpByProfile(env, NO_FILTER) })),
    block('Open LP applications', async () => ({ count: await openLpApplications(env) })),
    block('The Terms acceptances', async () => ({ by_profile: await termsByProfile(env) })),
    block('The Exploring board', async () => explorerSplit(env)),
    block('The newest accounts', async () => newestAccounts(env, admins)),
    block('Needs attention', async () => needsAttention(env, admins, nowMs)),
  ]);

  const rows = accounts.available ? accounts.rows : null;
  const byRole = (role: string) => (rows ? rows.filter((r) => r.role === role) : []);
  const total = rows ? rows.reduce((t, r) => t + r.n, 0) : null;
  const sum = (key: 'new_30d' | 'unverified' | 'unverified_overdue' | 'active_30d', of: AccountRow[] | null = rows) =>
    (of ? of.reduce((t, r) => t + r[key], 0) : 0);
  const termsOf = (role: string | null) => {
    if (!terms.available) return null;
    if (role !== null) return terms.by_profile.get(role) ?? 0;
    let t = 0;
    for (const v of terms.by_profile.values()) t += v;
    return t;
  };

  const lpBlock = lps.available
    ? {
      available: true as const,
      count: lps.by_profile.reduce((t, r) => t + r.count, 0),
      by_profile: lps.by_profile,
      open_applications: lpOpen.available ? lpOpen.count : null,
      ...(lpOpen.available ? {} : { open_applications_reason: lpOpen.reason }),
    }
    : lps;

  const explorersReady = explorers.available ? explorers.signed_ready : null;
  const lpWaiting = lpOpen.available ? lpOpen.count : null;

  return {
    as_of: new Date(nowMs).toISOString(),
    scope: { key: ownScope(env), label: scopeLabel(env) },
    weeks: axis.weeks,
    current_week: axis.current,
    kpis: {
      accounts: rows && total !== null && deactivated.available
        ? { available: true, total, new_30d: sum('new_30d'), deactivated: deactivated.count }
        : (!accounts.available ? accounts : deactivated),
      active_30d: rows && total !== null && lastSeen.available
        ? { available: true, count: sum('active_30d'), of: total, never_seen: lastSeen.never_seen, dormant: lastSeen.dormant }
        : (!accounts.available ? accounts : lastSeen),
      unverified: rows ? { available: true, count: sum('unverified'), overdue: sum('unverified_overdue'), overdue_days: UNVERIFIED_OVERDUE_DAYS } : accounts,
      waiting: explorersReady !== null && lpWaiting !== null
        ? {
          available: true,
          total: explorersReady + lpWaiting,
          explorers_ready: explorersReady,
          lp_applications: lpWaiting,
          tester_applications: notRecorded(TESTER_APPLICATIONS_REASON),
        }
        : (!explorers.available ? explorers : lpOpen),
    },
    profiles: rows
      ? {
        available: true,
        // ACC1's mix: the five profiles, then what is left (administrators, any other role).
        other: rows.filter((r) => !PROFILES.some((p) => p.key === r.role)).reduce((t, r) => t + r.n, 0),
        admins: byRole('admin').reduce((t, r) => t + r.n, 0),
        rows: PROFILES.map((p) => {
          const own = byRole(p.key);
          return {
            profile: p.key,
            label: p.label,
            count: own.reduce((t, r) => t + r.n, 0),
            new_30d: sum('new_30d', own),
            weeks: growth.available
              ? growth.weeks.map((w) => ({ week: w.week, count: w.by_profile[p.key] ?? 0, to_date: w.to_date }))
              : null,
            ...(growth.available ? {} : { weeks_reason: growth.reason }),
          };
        }),
      }
      : accounts,
    lps: lpBlock,
    product_testers: notRecorded(PRODUCT_TESTERS_REASON),
    readiness: rows
      ? {
        available: true,
        all: readinessOf(rows, termsOf(null)),
        by_profile: PROFILES.map((p) => ({ profile: p.key, ...readinessOf(byRole(p.key), termsOf(p.key)) })),
        ...(terms.available ? {} : { terms_reason: terms.reason }),
      }
      : accounts,
    explorers,
    newest,
    attention,
    definitions: OVERVIEW_DEFINITIONS,
  };
}

const r = new Hono<{ Bindings: Env }>();

r.get('/', async (c) => {
  try {
    const user = await requireAdmin(c);
    return c.json(await accountsOverview(c.env, { includeAdmins: isSuperAdmin(user as any) }));
  } catch (e) {
    return mapError(c, e);
  }
});

export default r;
