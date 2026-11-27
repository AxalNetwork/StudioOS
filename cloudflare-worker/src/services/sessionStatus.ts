/**
 * D4691 — one definition of a session's status, shared by every count and list
 * HQ · Security draws.
 *
 * Before this, the page used three different meanings of "live" for a support
 * session (any open record; an open record inside the extension ceiling; an
 * open record inside the first token's thirty minutes), and one lifetime for
 * every `user_sessions` row whatever kind of token it stood for. A tile and the
 * list beside it could therefore disagree about the same rows.
 *
 * THIS FILE OWNS THE DEFINITIONS, NOT THE ENFORCEMENT. What makes a token stop
 * working is `getCurrentUser` and the revoke and end routes; nothing here
 * changes them. What is here is how a reader classifies a stored row, so that
 * the list, its total and the overview tiles use the same words for the same
 * rows. The SQL that counts and lists rows is written out in full beside its
 * caller (scripts/check-sql-prepare.mjs forbids fragments), and the test
 * `hq_security_status_d4691.test.ts` runs those statements against the
 * functions below over a grid of rows, so the two cannot drift apart.
 *
 * ACCOUNT SESSIONS (`user_sessions`), in precedence order:
 *   revoked     `revoked_at` is set.
 *   signed_out  minted before the account's sign-out floor (`jwt_min_iat`).
 *   expired     older than its token's lifetime: `JWT_EXPIRY_HOURS`, or the
 *               branch support lifetime for a `factor = 'hq_support'` row.
 *   unknown     no readable mint time, so no claim can be made about it.
 *   active      none of the above: a token that could still open a door.
 *
 * SUPPORT SESSIONS (`impersonation_sessions`):
 *   ended       `ended_at` is set.
 *   live        open, and inside the most its tokens can last: the extension
 *               ceiling for an HQ session, the single-mint lifetime for a
 *               branch one (`admin_user_id = 0`, which has no extend path).
 *   not_closed  open, and past that limit: a record nobody closed, which no
 *               token can still answer for.
 *   unknown     open with no readable start time.
 * "Open" is `live` + `not_closed` + `unknown`: the record is not closed.
 */
import { IMPERSONATION_CEILING_MINUTES, JWT_EXPIRY_HOURS } from '../auth';

/**
 * The lifetime of a branch support token (`rpc/branchOps.ts`
 * SUPPORT_SESSION_MINUTES). Restated rather than imported so this module does
 * not pull the branch RPC surface into every reader; the test pins the two
 * equal.
 */
export const BRANCH_SUPPORT_MINUTES = 30;
/** The `user_sessions.factor` a branch support token is recorded under. */
export const BRANCH_SUPPORT_FACTOR = 'hq_support';
/** `impersonation_sessions.admin_user_id` for a branch support session. */
export const BRANCH_SUPPORT_ADMIN_ID = 0;

export const USER_SESSION_STATUSES = ['active', 'expired', 'revoked', 'signed_out', 'unknown'] as const;
export type UserSessionStatus = (typeof USER_SESSION_STATUSES)[number];
export const SUPPORT_SESSION_STATUSES = ['live', 'not_closed', 'ended', 'unknown'] as const;
export type SupportSessionStatus = (typeof SUPPORT_SESSION_STATUSES)[number];

/** The SQL binds for the two lifetimes, in the order the statements use them. */
export const USER_SESSION_LIFETIME_BINDS = [`-${BRANCH_SUPPORT_MINUTES} minutes`, `-${JWT_EXPIRY_HOURS} hours`] as const;
export const SUPPORT_SESSION_LIMIT_BINDS = [`-${BRANCH_SUPPORT_MINUTES} minutes`, `-${IMPERSONATION_CEILING_MINUTES} minutes`] as const;

/**
 * A stored timestamp as epoch ms. SQLite's 'YYYY-MM-DD HH:MM:SS' is UTC with
 * no zone; ISO with a 'T' is read as written. Anything else is NaN.
 */
export function parseStoredTs(s: unknown): number {
  if (typeof s !== 'string' || !s.trim()) return NaN;
  const t = s.trim();
  // The shapes SQLite's datetime() reads, each as UTC unless it names a zone.
  const m = /^(\d{4}-\d{2}-\d{2})(?:[ T](\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?)(Z|[+-]\d{2}:\d{2})?)?$/.exec(t);
  if (!m) return NaN;
  return Date.parse(`${m[1]}T${m[2] ?? '00:00:00'}${m[3] ?? 'Z'}`);
}

/** Minutes an account session's token can live, by the factor it was minted under. */
export function userSessionLifetimeMinutes(factor: unknown): number {
  return factor === BRANCH_SUPPORT_FACTOR ? BRANCH_SUPPORT_MINUTES : JWT_EXPIRY_HOURS * 60;
}

/** Minutes a support session's tokens can last, from its start. */
export function supportSessionLimitMinutes(adminUserId: unknown): number {
  return Number(adminUserId) === BRANCH_SUPPORT_ADMIN_ID ? BRANCH_SUPPORT_MINUTES : IMPERSONATION_CEILING_MINUTES;
}

export function userSessionStatus(
  row: { created_at?: unknown; revoked_at?: unknown; factor?: unknown; jwt_min_iat?: unknown },
  now: number = Date.now(),
): UserSessionStatus {
  if (row.revoked_at !== null && row.revoked_at !== undefined) return 'revoked'; // SQL's `revoked_at IS NULL`, exactly
  const minted = parseStoredTs(row.created_at);
  if (Number.isNaN(minted)) return 'unknown';
  const floor = Number(row.jwt_min_iat ?? 0) || 0;
  if (Math.floor(minted / 1000) < floor) return 'signed_out';
  if (minted < now - userSessionLifetimeMinutes(row.factor) * 60_000) return 'expired';
  return 'active';
}

export function supportSessionStatus(
  row: { started_at?: unknown; ended_at?: unknown; admin_user_id?: unknown },
  now: number = Date.now(),
): SupportSessionStatus {
  if (row.ended_at !== null && row.ended_at !== undefined) return 'ended'; // SQL's `ended_at IS NULL`, exactly
  const started = parseStoredTs(row.started_at);
  if (Number.isNaN(started)) return 'unknown';
  return started >= now - supportSessionLimitMinutes(row.admin_user_id) * 60_000 ? 'live' : 'not_closed';
}

/** The definitions as the page prints them, so the screen and the code use one sentence each. */
export const SESSION_STATUS_DEFINITIONS = {
  active: `Not revoked, not signed out, and inside its token's lifetime (${JWT_EXPIRY_HOURS} hours; `
    + `${BRANCH_SUPPORT_MINUTES} minutes for a branch support token).`,
  expired: 'Older than its token\'s lifetime. Not listed and not counted as active.',
  revoked: 'Revoked one by one. Not listed and not counted as active.',
  signed_out: 'Minted before the account was signed out everywhere. Not listed and not counted as active.',
  live: `A support session whose record is open and whose token could still be valid: inside `
    + `${IMPERSONATION_CEILING_MINUTES} minutes of its start at HQ, extensions included, or `
    + `${BRANCH_SUPPORT_MINUTES} minutes for a branch support session.`,
  not_closed: 'A support session record left open past that limit. No token can still answer for it; it is counted '
    + 'apart and never as live.',
  open: 'A support session record with no end time: live and not-closed together.',
} as const;
