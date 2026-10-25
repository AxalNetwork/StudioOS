/**
 * D1196 (#3146, part 1 of #2382) — Product testing's overview read, the
 * figures TST1 draws that no read carried: the weekly applications and picks
 * (②), who applies by profile (④), whether Mail can reach the picked testers
 * (⑤), and the withdrawn count. Mounted by `routes/testing.ts` at
 * `GET /api/admin/testing/overview`, `requireSuperAdmin`.
 *
 * EACH BLOCK ANSWERS ALONE. `{ available: true, … }` or `{ available: false,
 * reason }`: one failed read leaves the others answering, and a failed block
 * carries no figures, never zeros.
 *
 * AN OPEN PROGRAMME is one whose status is `open` or `testing`: it takes
 * applications or has testers at work, the set TST1's places bars draw
 * (`LIVE` in D1195's `productTestingModel.js`).
 *
 * COUNTS ONLY. No row names a member and no field carries an email address.
 * Mail reach uses the rule `testerRecipients` (`mailLinkTesters.ts`) sends to,
 * step by step: picked → agreed to email → program emails on → reachable
 * (an active account with an address, neither suppressed nor unsubscribed).
 * Delivery figures stay in Axal VC Mail.
 */
import type { Env } from '../types';

export const OVERVIEW_WEEKS = 12;
const DAY_MS = 86_400_000;
const LIVE_SQL = "('open', 'testing')";
export const PROFILES = ['founder', 'investor', 'advisor', 'partner', 'exploring'] as const;

type Unreadable = { available: false; unreadable: true; reason: string };
const unreadable = (what: string): Unreadable => ({
  available: false, unreadable: true, reason: `${what} could not be read on this database. That is not the same as none.`,
});

async function settle<T>(what: string, read: () => Promise<T>): Promise<({ available: true } & T) | Unreadable> {
  try {
    return { available: true, ...(await read()) };
  } catch (e) {
    // Counts and outcomes only: the block's name, never a value.
    console.error('[testing-overview] block unreadable', what, (e as Error)?.name || 'Error');
    return unreadable(what);
  }
}

/** `YYYY-MM-DD` of the Monday (UTC) on or before `ms`. */
export function mondayOf(ms: number): string {
  const d = new Date(ms);
  const back = (d.getUTCDay() + 6) % 7;
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - back)).toISOString().slice(0, 10);
}

const rows = <T>(r: { results?: T[] } | null | undefined): T[] => {
  if (!r || !Array.isArray(r.results)) throw new Error('rows were not returned');
  return r.results;
};

/**
 * Applications and picks per week, twelve Monday weeks, the current one to
 * date. A week that ends before the first programme opened is
 * `recorded: false`, with no counts: nothing could be applied to then. A week
 * after that with no event is a measured 0.
 */
async function weekly(env: Env, nowMs: number) {
  const first = await env.DB.prepare(`SELECT MIN(created_at) AS at FROM testing_events WHERE action = 'opened'`).first<{ at: string | null }>();
  const thisMonday = Date.parse(`${mondayOf(nowMs)}T00:00:00Z`);
  const starts = Array.from({ length: OVERVIEW_WEEKS }, (_, i) => thisMonday - (OVERVIEW_WEEKS - 1 - i) * 7 * DAY_MS);
  const from = new Date(starts[0]).toISOString().slice(0, 10);
  const days = rows(await env.DB.prepare(
    `SELECT substr(created_at, 1, 10) AS day, action, COUNT(*) AS n FROM testing_events
      WHERE action IN ('applied', 'picked') AND substr(created_at, 1, 10) >= ?
      GROUP BY substr(created_at, 1, 10), action`,
  ).bind(from).all<{ day: string; action: string; n: number }>());
  const openedMs = first?.at ? Date.parse(`${String(first.at).slice(0, 10)}T00:00:00Z`) : null;
  const weeks = starts.map((s, i) => {
    const end = s + 7 * DAY_MS;
    const toDate = i === OVERVIEW_WEEKS - 1 ? { to_date: true } : {};
    const week_start = new Date(s).toISOString().slice(0, 10);
    if (openedMs === null || !Number.isFinite(openedMs) || end <= openedMs) return { week_start, recorded: false, applications: null, picks: null, ...toDate };
    const inWeek = days.filter((d) => { const t = Date.parse(`${d.day}T00:00:00Z`); return t >= s && t < end; });
    const sum = (a: string) => inWeek.filter((d) => d.action === a).reduce((t, d) => t + Number(d.n), 0);
    return { week_start, recorded: true, applications: sum('applied'), picks: sum('picked'), ...toDate };
  });
  return {
    weeks,
    first_opened: first?.at ? String(first.at).slice(0, 10) : null,
    counted_by: 'Each application and each pick written to the program history, by the day it was written (UTC). Weeks start on Monday.',
  };
}

/** A role's profile, or `other` for any role outside the five. */
const profileOf = (role: string | null) => ((PROFILES as readonly string[]).includes(String(role)) ? String(role) : 'other');
function byProfile(list: Array<{ role: string | null; n: number }>) {
  const out: Record<string, number> = Object.fromEntries([...PROFILES, 'other'].map((p) => [p, 0]));
  for (const r of list) out[profileOf(r.role)] += Number(r.n);
  return { total: Object.values(out).reduce((t, n) => t + n, 0), by_profile: out };
}

/** The tester pool (active testers on active accounts) by profile. */
async function pool(env: Env) {
  const list = rows(await env.DB.prepare(
    `SELECT u.role AS role, COUNT(*) AS n FROM product_testers t JOIN users u ON u.id = t.user_id
      WHERE t.status = 'active' AND u.is_active = 1 GROUP BY u.role`,
  ).all<{ role: string | null; n: number }>());
  return { ...byProfile(list), definition: 'Active testers in the pool, on active accounts, by their account profile.' };
}

/** Applicants on open programmes by profile: each member once, however many programmes they applied to. */
async function applicants(env: Env) {
  const list = rows(await env.DB.prepare(
    `SELECT u.role AS role, COUNT(DISTINCT a.user_id) AS n
       FROM testing_applications a JOIN testing_programmes p ON p.id = a.programme_id JOIN users u ON u.id = a.user_id
      WHERE p.status IN ${LIVE_SQL} AND a.status <> 'withdrawn' GROUP BY u.role`,
  ).all<{ role: string | null; n: number }>());
  return { ...byProfile(list), definition: 'Members with an application on an open program that they have not withdrawn, each once, by their account profile.' };
}

/** Withdrawn applications on open programmes, in all and per programme. */
async function withdrawn(env: Env) {
  const list = rows(await env.DB.prepare(
    `SELECT p.uid AS uid, p.product_name AS product_name, p.status AS status,
            SUM(CASE WHEN a.status = 'withdrawn' THEN 1 ELSE 0 END) AS n
       FROM testing_programmes p LEFT JOIN testing_applications a ON a.programme_id = p.id
      WHERE p.status IN ${LIVE_SQL} GROUP BY p.id ORDER BY p.id`,
  ).all<{ uid: string; product_name: string; status: string; n: number | null }>());
  const programmes = list.map((r) => ({ uid: r.uid, product_name: r.product_name, status: r.status, withdrawn: Number(r.n) || 0 }));
  return { total: programmes.reduce((t, p) => t + p.withdrawn, 0), programmes };
}

/**
 * Mail reach per open programme. Each step narrows the one before it, and the
 * last is exactly `testerRecipients`' WHERE, so "reachable" is the number of
 * people a send to that programme would reach.
 */
async function mailReach(env: Env) {
  const list = rows(await env.DB.prepare(
    `SELECT p.uid AS uid, p.product_name AS product_name, p.status AS status,
            SUM(CASE WHEN a.status = 'picked' THEN 1 ELSE 0 END) AS picked,
            SUM(CASE WHEN a.status = 'picked' AND a.consent_email_at IS NOT NULL THEN 1 ELSE 0 END) AS consented,
            SUM(CASE WHEN a.status = 'picked' AND a.consent_email_at IS NOT NULL AND a.mail_enabled = 1 THEN 1 ELSE 0 END) AS emails_on,
            SUM(CASE WHEN a.status = 'picked' AND a.consent_email_at IS NOT NULL AND a.mail_enabled = 1 AND u.is_active = 1
                       AND u.email IS NOT NULL AND trim(u.email) <> ''
                       AND NOT EXISTS (SELECT 1 FROM email_suppressions z WHERE z.email = lower(trim(u.email)))
                       AND NOT EXISTS (SELECT 1 FROM newsletter_subscribers s WHERE s.email = lower(trim(u.email)) AND s.status = 'unsubscribed')
                     THEN 1 ELSE 0 END) AS reachable
       FROM testing_programmes p
       LEFT JOIN testing_applications a ON a.programme_id = p.id
       LEFT JOIN users u ON u.id = a.user_id
      WHERE p.status IN ${LIVE_SQL} GROUP BY p.id ORDER BY p.id`,
  ).all<{ uid: string; product_name: string; status: string; picked: number | null; consented: number | null; emails_on: number | null; reachable: number | null }>());
  return {
    programmes: list.map((r) => ({
      uid: r.uid, product_name: r.product_name, status: r.status,
      picked: Number(r.picked) || 0, consented: Number(r.consented) || 0, emails_on: Number(r.emails_on) || 0, reachable: Number(r.reachable) || 0,
    })),
    steps: ['Picked', 'Agreed to email', 'Program emails on', 'Reachable'],
    note: 'Counts only. Delivery figures are in Axal VC Mail.',
  };
}

export async function readTestingOverview(env: Env, nowMs: number = Date.now()) {
  const [w, p, a, wd, m] = await Promise.all([
    settle('Applications and picks per week', () => weekly(env, nowMs)),
    settle('The tester pool', () => pool(env)),
    settle('The applicants on open programs', () => applicants(env)),
    settle('The withdrawn applications', () => withdrawn(env)),
    settle('Mail reach', () => mailReach(env)),
  ]);
  return {
    as_of: new Date(nowMs).toISOString(),
    open_means: 'A program whose status is open or testing.',
    weekly: w,
    by_profile: { available: true as const, pool: p, applicants: a },
    withdrawn: wd,
    mail_reach: m,
  };
}
