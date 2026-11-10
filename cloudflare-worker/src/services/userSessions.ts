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
 * ENDING ENDS THE ACCESS (D4669). A support token carries its record's id
 * (`sid`), and `getCurrentUser` re-reads that row on every request
 * (auth.ts `sessionStanding`), so stamping `ended_at` refuses the token from
 * its next request. Before D4669 the token named no record and outlived the
 * end by up to IMPERSONATION_EXPIRY_MINUTES.
 *
 * Every statement below is a complete literal (scripts/check-sql-prepare.mjs).
 */
import type { Env } from '../types';
import { IMPERSONATION_CEILING_MINUTES, JWT_EXPIRY_HOURS } from '../auth';
import {
  USER_SESSION_LIFETIME_BINDS, SUPPORT_SESSION_LIMIT_BINDS, BRANCH_SUPPORT_FACTOR, userSessionStatus,
  type UserSessionStatus,
} from './sessionStatus';
import { networkOfAddress, supportIdentity, userIdentity, type Identity } from './securityIdentity';

/**
 * "ACTIVE" MEANS A TOKEN THAT COULD STILL OPEN A DOOR — the list and every
 * count use exactly this, and it is `getCurrentUser`'s own three checks:
 *
 *   1. `revoked_at IS NULL` — the per-session revoke.
 *   2. Not expired. No expiry is stored on the row, so it is `created_at` (the
 *      row is written right after the JWT is minted, so it stands for `iat`)
 *      plus `JWT_EXPIRY_HOURS`, the ordinary lifetime `createJWT` signs with.
 *      No session is minted longer (a support session is shorter), so this
 *      can only keep a row a little past its token, never drop a live one.
 *   3. Not below the account's floor: `getCurrentUser` refuses a token whose
 *      `iat` is under `users.jwt_min_iat`, which is all a sign-out-everywhere
 *      or HQ's "Sign out account" (`/force-reauth/:userId`) writes. Without
 *      this, every session of a signed-out account came straight back as
 *      active on the next reload.
 *
 * Before this the bound was `revoked_at` plus a 30-day `last_seen_at`
 * window, which listed tokens dead for weeks.
 *
 * D4691 — the definitions now live in `services/sessionStatus.ts`, which every
 * count and list on HQ · Security shares. Two corrections came with the move:
 * a branch support token (`factor = 'hq_support'`) lives its own thirty
 * minutes, not the ordinary lifetime, and `created_at` is compared through
 * `datetime()` so a stamp in another format is not compared as text.
 */
export const SESSION_TOKEN_HOURS = JWT_EXPIRY_HOURS;
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
  /**
   * D4691 — the network bucket (/24 or /48), never the address: the privacy
   * rule the security_events ledger follows, applied to HQ's cross-account
   * list. The account holder's own device list (routes/settings.ts) is not
   * this list and is unchanged.
   */
  network: string;
  factor: string | null;
  created_at: string | null;
  last_seen_at: string | null;
  is_current: boolean;
  /** D4691 — who holds the session: the account itself, or HQ support on its behalf. */
  holder: Identity;
  /** D4691 — always 'active' for a listed row; computed by the shared predicate as a cross-check. */
  status: UserSessionStatus;
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
  limit: number = SESSION_LIST_LIMIT,
  beforeId: number | null = null,
): Promise<{ rows: SessionListRow[]; total: number; next_before_id: number | null }> {
  // D4699 — a stable order and a cursor. Newest sign-in first, by `id`, which never changes:
  // `last_seen_at` moves on every request, so ordering by it moved rows between pages and reads.
  // One row past the page says whether there is more; `next_before_id` continues strictly below.
  const res = await env.DB.prepare(
    `SELECT s.id, s.user_id, s.jti, s.user_agent, s.ip, s.factor, s.created_at, s.last_seen_at, s.revoked_at,
            u.email, u.name, u.role, u.jwt_min_iat
       FROM user_sessions s
       LEFT JOIN users u ON u.id = s.user_id
      WHERE s.revoked_at IS NULL
        AND datetime(s.created_at) >= datetime('now', CASE WHEN s.factor = 'hq_support' THEN ? ELSE ? END)
        AND CAST(strftime('%s', s.created_at) AS INTEGER) >= COALESCE(u.jwt_min_iat, 0)
        AND (? IS NULL OR s.id < ?)
      ORDER BY s.id DESC
      LIMIT ?`,
  ).bind(...USER_SESSION_LIFETIME_BINDS, beforeId, beforeId, limit + 1).all<Record<string, unknown>>();
  const got = res.results || [];
  const more = got.length > limit;
  const total = await countActiveSessions(env);
  const now = Date.now();
  const rows = got.slice(0, limit).map((r) => {
    const factor = (r.factor as string) ?? null;
    const holder = factor === BRANCH_SUPPORT_FACTOR
      ? supportIdentity({ id: 0 }, { id: r.user_id, name: r.name, email: r.email })
      : userIdentity(r.user_id, r.name, r.email);
    return {
      id: Number(r.id),
      user_id: Number(r.user_id),
      email: (r.email as string) ?? null,
      name: (r.name as string) ?? null,
      role: (r.role as string) ?? null,
      user_agent: (r.user_agent as string) ?? null,
      network: networkOfAddress(r.ip),
      factor,
      created_at: (r.created_at as string) ?? null,
      last_seen_at: (r.last_seen_at as string) ?? null,
      is_current: !!currentJti && r.jti === currentJti,
      holder,
      status: userSessionStatus(r, now),
    };
  });
  return { rows, total, next_before_id: more && rows.length ? rows[rows.length - 1].id : null };
}

/**
 * How many sessions are active, by the same predicate as the list (see
 * `SESSION_TOKEN_HOURS`). /overview's tile and the list's total both read
 * this, so the two cannot disagree. THROWS when `user_sessions` cannot be
 * read; the caller says "unreadable" rather than printing a 0.
 */
export async function countActiveSessions(env: Env): Promise<number> {
  const row = await env.DB.prepare(
    `SELECT COUNT(*) AS n
       FROM user_sessions s
       LEFT JOIN users u ON u.id = s.user_id
      WHERE s.revoked_at IS NULL
        AND datetime(s.created_at) >= datetime('now', CASE WHEN s.factor = 'hq_support' THEN ? ELSE ? END)
        AND CAST(strftime('%s', s.created_at) AS INTEGER) >= COALESCE(u.jwt_min_iat, 0)`,
  ).bind(...USER_SESSION_LIFETIME_BINDS).first<{ n: number }>();
  if (!row) throw new Error('user_sessions count returned no row');
  return Number(row.n);
}

/**
 * D4616 (#4616) — the account holder's own devices, by the same definition as
 * HQ's list and count above, and never anybody else's.
 *
 * OWNER-SCOPED, ALWAYS. Both statements carry `s.user_id = ?` bound to the
 * caller; there is no unscoped variant here, so reusing the shared rule cannot
 * hand a member HQ's global list.
 *
 * HISTORY IS KEPT AND LABELLED. Unlike HQ's list, a member's list keeps the
 * rows that no longer open a door (revoked, expired, signed out everywhere),
 * newest first, each with the `status` `userSessionStatus` gives it, so the
 * page can say "Expired" or "Signed out" instead of drawing it as a device in
 * use. Only `active` rows are counted. The `jti` is read to mark the caller's
 * own row and is not returned.
 */
export type OwnSessionRow = {
  id: number;
  user_agent: string | null;
  ip: string | null;
  created_at: string | null;
  last_seen_at: string | null;
  revoked_at: string | null;
  status: UserSessionStatus;
  is_current: boolean;
};

export const OWN_SESSION_LIST_LIMIT = 100;

export async function listOwnSessions(env: Env, userId: number, currentJti: string | null): Promise<OwnSessionRow[]> {
  const res = await env.DB.prepare(
    `SELECT s.id, s.jti, s.user_agent, s.ip, s.factor, s.created_at, s.last_seen_at, s.revoked_at, u.jwt_min_iat
       FROM user_sessions s
       LEFT JOIN users u ON u.id = s.user_id
      WHERE s.user_id = ?
      ORDER BY s.last_seen_at DESC, s.id DESC
      LIMIT ?`,
  ).bind(userId, OWN_SESSION_LIST_LIMIT).all<Record<string, unknown>>();
  const now = Date.now();
  return (res.results || []).map((r) => {
    const status = userSessionStatus(r, now);
    return {
      id: Number(r.id),
      user_agent: (r.user_agent as string) ?? null,
      ip: (r.ip as string) ?? null,
      created_at: (r.created_at as string) ?? null,
      last_seen_at: (r.last_seen_at as string) ?? null,
      revoked_at: (r.revoked_at as string) ?? null,
      status,
      // A token that authenticated this request is active by definition; a row
      // that is not cannot be "this device", whatever its jti.
      is_current: status === 'active' && !!currentJti && r.jti === currentJti,
    };
  });
}

/** The account holder's active sessions: `countActiveSessions`' predicate, plus the owner. */
export async function countOwnActiveSessions(env: Env, userId: number): Promise<number> {
  const row = await env.DB.prepare(
    `SELECT COUNT(*) AS n
       FROM user_sessions s
       LEFT JOIN users u ON u.id = s.user_id
      WHERE s.user_id = ?
        AND s.revoked_at IS NULL
        AND datetime(s.created_at) >= datetime('now', CASE WHEN s.factor = 'hq_support' THEN ? ELSE ? END)
        AND CAST(strftime('%s', s.created_at) AS INTEGER) >= COALESCE(u.jwt_min_iat, 0)`,
  ).bind(userId, ...USER_SESSION_LIFETIME_BINDS).first<{ n: number }>();
  if (!row) throw new Error('user_sessions count returned no row');
  return Number(row.n);
}

/**
 * Support sessions whose record is open and whose token could still be valid:
 * `ended_at` is NULL and the session is inside the most its tokens can last
 * (`supportSessionStatus` 'live': the extension ceiling at HQ, the single-mint
 * lifetime for a branch session). An open
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
      WHERE i.ended_at IS NULL
        AND datetime(i.started_at) >= datetime('now', CASE WHEN i.admin_user_id = 0 THEN ? ELSE ? END)
      ORDER BY i.started_at DESC, i.id DESC`,
  ).bind(...SUPPORT_SESSION_LIMIT_BINDS).all<ImpersonationListRow>();
  return res.results || [];
}

/**
 * D4691 — the support-session counts the overview draws, by the same
 * predicate as `listLiveImpersonations`: `live` is exactly that list's length,
 * `not_closed` is an open record past its limit (or with no readable start),
 * and `open` is both. THROWS when the table cannot be read.
 */
export async function countSupportSessions(env: Env): Promise<{ open: number; live: number; not_closed: number }> {
  const row = await env.DB.prepare(
    `SELECT COUNT(*) AS open,
            COALESCE(SUM(CASE WHEN datetime(started_at) >= datetime('now', CASE WHEN admin_user_id = 0 THEN ? ELSE ? END)
                              THEN 1 ELSE 0 END), 0) AS live
       FROM impersonation_sessions
      WHERE ended_at IS NULL`,
  ).bind(...SUPPORT_SESSION_LIMIT_BINDS).first<{ open: number; live: number }>();
  if (!row) throw new Error('impersonation_sessions count returned no row');
  const open = Number(row.open) || 0;
  const live = Number(row.live) || 0;
  return { open, live, not_closed: open - live };
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
