/**
 * D1302 (#3399, Accounts part 3 of #2377) — an account's sub-accounts, read
 * where each already lives. There is no second store:
 *
 *   Product tester  `product_testers` and `product_tester_events` (migration
 *                   576, D1042). HQ approves, declines, pauses, resumes and
 *                   removes a tester on `/api/admin/product-testers`, which
 *                   tells the member and refuses an admin account; this file
 *                   only reads.
 *   LP              `lp_applications` (migration 165): an account is an LP of
 *                   a fund once its application there is `approved`. The GP
 *                   decides it on the LP applications page; this file only
 *                   reads.
 *
 * Every block is `{ available, reason?, … }`. A store this database does not
 * have answers `not_set_up`; a store that fails answers `unreadable`. Neither
 * is ever a 0 or an empty list, and one failing never blanks the other.
 * Nothing here returns an email, a commitment or the applicant's own note.
 */
import type { Env } from '../types';
import { TESTER_STATUSES, type TesterStatus } from './productTesters';

export const LP_STATUSES = ['pending', 'approved', 'declined', 'withdrawn'] as const;
export type LpStatus = typeof LP_STATUSES[number];

type Absent = { available: false; reason: 'not_set_up' | 'unreadable' };

const isMissingTable = (e: unknown) => /no such table/i.test(String((e as Error)?.message ?? e));

async function block<T>(run: () => Promise<T>): Promise<T | Absent> {
  try { return await run(); } catch (e) {
    if (isMissingTable(e)) return { available: false, reason: 'not_set_up' };
    console.warn('[sub-accounts] read failed');
    return { available: false, reason: 'unreadable' };
  }
}

/** The account's tester row, or null when they never applied. */
async function testerOf(env: Env, userId: number) {
  return block(async () => {
    const row = await env.DB.prepare(
      `SELECT t.id, t.status, t.applied_at, t.decided_at, t.decided_by, t.reason, t.note, t.availability,
              t.consent_email_at, t.consent_version, t.updated_at, d.name AS decided_by_name
         FROM product_testers t LEFT JOIN users d ON d.id = t.decided_by
        WHERE t.user_id = ? LIMIT 1`,
    ).bind(userId).first<any>();
    if (!row) return { available: true as const, record: null };
    const events = await env.DB.prepare(
      `SELECT e.action, e.from_status, e.to_status, e.created_at AS at, e.actor_user_id, u.name AS actor_name
         FROM product_tester_events e LEFT JOIN users u ON u.id = e.actor_user_id
        WHERE e.tester_id = ? ORDER BY e.id`,
    ).bind(row.id).all<any>();
    return {
      available: true as const,
      record: {
        id: Number(row.id),
        status: row.status as TesterStatus,
        applied_at: row.applied_at ?? null,
        decided_at: row.decided_at ?? null,
        // A decider whose account is gone keeps the date; the name reads null.
        decided_by: row.decided_by == null ? null : { id: Number(row.decided_by), name: row.decided_by_name ?? null },
        reason: row.reason ?? null,
        note: row.note ?? null,
        availability: row.availability ?? null,
        consent_email_at: row.consent_email_at ?? null,
        consent_version: row.consent_version ?? null,
        updated_at: row.updated_at ?? null,
        // The member's own apply has no actor; HQ's decisions carry theirs. Reasons and notes stay on the row.
        events: (events.results || []).map((e) => ({
          action: e.action, from: e.from_status ?? null, to: e.to_status, at: e.at,
          by: e.actor_user_id == null ? null : { id: Number(e.actor_user_id), name: e.actor_name ?? null },
        })),
      },
    };
  });
}

/** The account's LP applications, newest first; an LP of each fund it was approved for. */
async function lpOf(env: Env, userId: number) {
  return block(async () => {
    const rows = await env.DB.prepare(
      `SELECT a.id, a.fund_slug, a.status, a.created_at, a.reviewed_at, a.reviewed_by, r.name AS reviewed_by_name
         FROM lp_applications a LEFT JOIN users r ON r.id = a.reviewed_by
        WHERE a.user_id = ? ORDER BY a.created_at DESC, a.id DESC`,
    ).bind(userId).all<any>();
    const applications = (rows.results || []).map((a) => ({
      id: Number(a.id),
      fund_slug: a.fund_slug,
      status: (LP_STATUSES as readonly string[]).includes(a.status) ? (a.status as LpStatus) : null,
      applied_at: a.created_at ?? null,
      reviewed_at: a.reviewed_at ?? null,
      reviewed_by: a.reviewed_by == null ? null : { id: Number(a.reviewed_by), name: a.reviewed_by_name ?? null },
    }));
    return {
      available: true as const,
      is_lp: applications.some((a) => a.status === 'approved'),
      funds: [...new Set(applications.filter((a) => a.status === 'approved').map((a) => a.fund_slug))],
      applications,
    };
  });
}

/** One account's sub-accounts, for its record's Sub-accounts tab (ACC5). */
export async function accountSubAccounts(env: Env, userId: number) {
  const [tester, lp] = await Promise.all([testerOf(env, userId), lpOf(env, userId)]);
  return { user_id: userId, tester, lp };
}

/**
 * The Overview's two sub-account widgets (ACC1) and #2390's Product testers
 * lane count. Testers are counted per status, so `applied` is the lane's
 * pending count; LPs are accounts with an approved application to any fund,
 * counted once, and the applications still waiting.
 */
export async function subAccountCounts(env: Env) {
  const testers = await block(async () => {
    const r = await env.DB.prepare('SELECT status, COUNT(*) AS n FROM product_testers GROUP BY status').all<any>();
    const by_status = Object.fromEntries(TESTER_STATUSES.map((s) => [s, 0])) as Record<TesterStatus, number>;
    let unknown = 0;
    for (const row of r.results || []) {
      if ((TESTER_STATUSES as readonly string[]).includes(row.status)) by_status[row.status as TesterStatus] = Number(row.n);
      else unknown += Number(row.n);
    }
    return { available: true as const, by_status, active: by_status.active, pending: by_status.applied, unknown_status: unknown };
  });
  const lps = await block(async () => {
    const r = await env.DB.prepare(
      `SELECT COUNT(DISTINCT CASE WHEN status = 'approved' THEN user_id END) AS lps,
              SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending
         FROM lp_applications`,
    ).first<any>();
    return { available: true as const, active: Number(r?.lps ?? 0), pending: Number(r?.pending ?? 0) };
  });
  return { testers, lps };
}
