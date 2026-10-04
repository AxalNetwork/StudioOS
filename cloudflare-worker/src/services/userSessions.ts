/**
 * D481 — sessions as HQ can act on them: list, revoke one, end a support
 * session.
 *
 * ONE REVOKE, TWO DOORS. Until D481 the only per-session revoke lived inside
 * `routes/settings.ts` (`POST /sessions/:id/revoke`), for the caller's own
 * devices. HQ · Security needs the same act on anybody's session, so the
 * statement moved here and both routes call it: the account holder's door
 * passes `ownerId` and can reach only its own rows; HQ's door passes none and
 * is gated by the route (`requireSuperAdminWriteBar`), which also writes the
 * audit row. The revoke itself is the column `getCurrentUser` already reads —
 * `user_sessions.revoked_at` by `jti` — so a revoked row bounces its token on
 * the next request without anything in `auth.ts` changing.
 *
 * ENDING A SUPPORT SESSION IS `ended_at` AND NOTHING ELSE. The row is never
 * deleted and `admin_user_id` / `context` are never rewritten: a branch's
 * support-session reader (`routes/branch_support_sessions.ts`) selects on
 * exactly those two columns, and `routes/admin.ts` and
 * `util/supportSessionSweep.ts` close a session the same way.
 *
 * WHAT ENDING CANNOT DO, stated where it is done: an impersonation token
 * carries no `jti`, so no `user_sessions` row answers for it. Closing the
 * record stops Extend (which requires `ended_at IS NULL`) and the token dies
 * at its own expiry, at most IMPERSONATION_EXPIRY_MINUTES after it was
 * minted. To cut it sooner, sign the target account out — which ends that
 * account holder's own sessions too, and the route's message says so.
 *
 * Every statement below is a complete literal (scripts/check-sql-prepare.mjs).
 */
import type { Env } from '../types';
import { IMPERSONATION_CEILING_MINUTES } from '../auth';

/** "Active" on the list is the same bound /overview counts with. */
export const SESSION_LIST_WINDOW_DAYS = 30;
/** One page. The count beside it says how many rows the window holds. */
export const SESSION_LIST_LIMIT = 200;
/** "Revoke selected" in one request, at most. */
export const SESSION_BULK_LIMIT = 100;

export type SessionListRow = {
  id: number;
  user_id: number;
  email: string | null;
  name: string | null;
  role: string | null;
  user_agent: string | null;
  ip: string | null;
  factor: string | null;
  created_at: string | null;
  last_seen_at: string | null;
  is_current: boolean;
};

export type ImpersonationListRow = {
  id: number;
  admin_user_id: number;
  target_user_id: number;
  context: string | null;
  started_at: string;
  admin_email: string | null;
  admin_name: string | null;
  target_email: string | null;
  target_name: string | null;
};

/**
 * Active sessions, newest-seen first, with the account each belongs to.
 *
 * The `jti` is read to mark the caller's own row and is NOT returned: it is
 * the key `getCurrentUser` looks a token up by, and HQ's screen has no use
 * for it beyond `is_current`.
 *
 * THROWS when `user_sessions` cannot be read. The route turns that into an
 * unreadable answer; returning `[]` here would put "nobody is signed in" on
 * a security desk, which is the #204 defect in its worst direction.
 */
export async function listActiveSessions(
  env: Env,
  currentJti: string | null,
  windowDays: number = SESSION_LIST_WINDOW_DAYS,
  limit: number = SESSION_LIST_LIMIT,
): Promise<{ rows: SessionListRow[]; total: number }> {
  const since = `-${windowDays} days`;
  const res = await env.DB.prepare(
    `SELECT s.id, s.user_id, s.jti, s.user_agent, s.ip, s.factor, s.created_at, s.last_seen_at,
            u.email, u.name, u.role
       FROM user_sessions s
       LEFT JOIN users u ON u.id = s.user_id
      WHERE s.revoked_at IS NULL AND s.last_seen_at >= datetime('now', ?)
      ORDER BY s.last_seen_at DESC, s.id DESC
      LIMIT ?`,
  ).bind(since, limit).all<Record<string, unknown>>();
  const total = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM user_sessions
      WHERE revoked_at IS NULL AND last_seen_at >= datetime('now', ?)`,
  ).bind(since).first<{ n: number }>();
  const rows = (res.results || []).map((r) => ({
    id: Number(r.id),
    user_id: Number(r.user_id),
    email: (r.email as string) ?? null,
    name: (r.name as string) ?? null,
    role: (r.role as string) ?? null,
    user_agent: (r.user_agent as string) ?? null,
    ip: (r.ip as string) ?? null,
    factor: (r.factor as string) ?? null,
    created_at: (r.created_at as string) ?? null,
    last_seen_at: (r.last_seen_at as string) ?? null,
    is_current: !!currentJti && r.jti === currentJti,
  }));
  return { rows, total: Number(total?.n) || 0 };
}

/**
 * Support sessions whose record is open and whose token could still be valid:
 * `ended_at` is NULL and the session is inside the extension ceiling. An open
 * row older than the ceiling is a record nobody closed, not a session anybody
 * holds — no token for it can outlive `started_at + ceiling` (D248) — so it is
 * not offered as something to end, and ending it would stamp a false time.
 *
 * THROWS when the table cannot be read (it is created lazily, so a database
 * that never impersonated has none). The route reports that on its own.
 */
export async function listLiveImpersonations(env: Env): Promise<ImpersonationListRow[]> {
  const res = await env.DB.prepare(
    `SELECT i.id, i.admin_user_id, i.target_user_id, i.context, i.started_at,
            a.email AS admin_email, a.name AS admin_name, t.email AS target_email, t.name AS target_name
       FROM impersonation_sessions i
       LEFT JOIN users a ON a.id = i.admin_user_id
       LEFT JOIN users t ON t.id = i.target_user_id
      WHERE i.ended_at IS NULL AND i.started_at >= datetime('now', ?)
      ORDER BY i.started_at DESC, i.id DESC`,
  ).bind(`-${IMPERSONATION_CEILING_MINUTES} minutes`).all<ImpersonationListRow>();
  return res.results || [];
}

export type RevokeOutcome =
  | { outcome: 'revoked'; id: number; user_id: number; revoked_at: string | null }
  | { outcome: 'already_revoked'; id: number; user_id: number; revoked_at: string | null }
  | { outcome: 'not_found'; id: number };

/**
 * Revoke one `user_sessions` row.
 *
 * With `ownerId` the row must belong to that account — the account holder's
 * own door, where a session id that is somebody else's is "not found" rather
 * than "not yours", so the route cannot be used to probe which ids exist.
 * Without it the caller is HQ and the route has already gated it.
 *
 * `revoked_at IS NULL` on the UPDATE makes a second revoke a no-op instead of
 * a re-stamp: the first revoke's time is the one that bounced the token, and
 * overwriting it would put a later time on the record than the act.
 */
export async function revokeUserSession(env: Env, id: number, ownerId?: number): Promise<RevokeOutcome> {
  const row = ownerId === undefined
    ? await env.DB.prepare(
      'SELECT id, user_id, revoked_at FROM user_sessions WHERE id = ?',
    ).bind(id).first<{ id: number; user_id: number; revoked_at: string | null }>()
    : await env.DB.prepare(
      'SELECT id, user_id, revoked_at FROM user_sessions WHERE id = ? AND user_id = ?',
    ).bind(id, ownerId).first<{ id: number; user_id: number; revoked_at: string | null }>();
  if (!row) return { outcome: 'not_found', id };
  if (row.revoked_at) {
    return { outcome: 'already_revoked', id, user_id: Number(row.user_id), revoked_at: row.revoked_at };
  }
  const res = await env.DB.prepare(
    "UPDATE user_sessions SET revoked_at = datetime('now') WHERE id = ? AND revoked_at IS NULL",
  ).bind(id).run();
  const after = await env.DB.prepare(
    'SELECT revoked_at FROM user_sessions WHERE id = ?',
  ).bind(id).first<{ revoked_at: string | null }>();
  const changed = Number(res.meta?.changes ?? 0) > 0;
  return {
    // A concurrent revoke between the read and the write lands here: the row
    // is revoked, but not by this call, and the caller must not audit it twice.
    outcome: changed ? 'revoked' : 'already_revoked',
    id,
    user_id: Number(row.user_id),
    revoked_at: after?.revoked_at ?? null,
  };
}

export type EndImpersonationOutcome =
  | { outcome: 'ended'; row: { id: number; admin_user_id: number; target_user_id: number; context: string | null; started_at: string } }
  | { outcome: 'already_ended'; id: number }
  | { outcome: 'past_ceiling'; id: number }
  | { outcome: 'not_found'; id: number };

/** Close one support session's record: `ended_at`, and only `ended_at`. */
export async function endImpersonation(env: Env, id: number): Promise<EndImpersonationOutcome> {
  const row = await env.DB.prepare(
    `SELECT id, admin_user_id, target_user_id, context, started_at, ended_at,
            CASE WHEN started_at >= datetime('now', ?) THEN 1 ELSE 0 END AS inside_ceiling
       FROM impersonation_sessions WHERE id = ?`,
  ).bind(`-${IMPERSONATION_CEILING_MINUTES} minutes`, id).first<{
    id: number; admin_user_id: number; target_user_id: number; context: string | null;
    started_at: string; ended_at: string | null; inside_ceiling: number;
  }>();
  if (!row) return { outcome: 'not_found', id };
  if (row.ended_at) return { outcome: 'already_ended', id };
  if (!Number(row.inside_ceiling)) return { outcome: 'past_ceiling', id };
  const res = await env.DB.prepare(
    "UPDATE impersonation_sessions SET ended_at = datetime('now') WHERE id = ? AND ended_at IS NULL",
  ).bind(id).run();
  if (Number(res.meta?.changes ?? 0) === 0) return { outcome: 'already_ended', id };
  return {
    outcome: 'ended',
    row: {
      id: Number(row.id),
      admin_user_id: Number(row.admin_user_id),
      target_user_id: Number(row.target_user_id),
      context: row.context,
      started_at: row.started_at,
    },
  };
}
