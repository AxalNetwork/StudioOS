/**
 * D5043 (#5043) — HQ's record of a cross-branch account move, and the one recovery it allows.
 *
 * A move is two writes on two databases with no transaction between them
 * (D121): the source branch closes the account, then the destination branch
 * stores an invitation. When the second leg fails the account has no home
 * until the invitation lands, and before D5043 that state lived only in one
 * HTTP reply. `hq_account_moves` (migration 202611091210) holds it instead,
 * one row per move, and this module is the only code that writes that table.
 *
 * THE RECOVERY IS NARROW ON PURPOSE. "Retry invitation" takes an operation uid
 * and nothing else. The email, name and role it sends are what the SOURCE
 * answered when it closed the account, stored on the row; the destination is
 * the row's. There is no route here that invites an arbitrary address onto a
 * branch, and none may be added on top of this module.
 *
 * PROOF BEFORE RETRY. `moved_out_at` is stamped only after the source answered
 * that it closed the account. A row without it — the move was recorded and the
 * source refused, or never answered — cannot be retried: inviting a person
 * whose account may still be live on the source would give them two homes.
 *
 * ONE RETRY AT A TIME. `claimRetry` moves the row to `inviting` with a
 * conditional UPDATE, so two presses (or two tabs) cannot both call the
 * destination. A claim older than RETRY_STALE_MINUTES is treated as abandoned
 * (the Worker died mid-call) and may be claimed again; the destination's
 * `move_ref` lookup keeps that second call from writing a second invitation.
 */
import type { Env } from '../types';

export const MOVE_OP_RE = /^mvop_[0-9a-f]{20}$/;
/** A claim (or a move's own invitation call) older than this is treated as abandoned. */
export const RETRY_STALE_MINUTES = 2;
/** How long an invitation whose message did not leave stays on HQ's open list (= INVITATION_TTL_DAYS). */
export const OPEN_UNSENT_DAYS = 14;

export const newMoveOpUid = () => `mvop_${crypto.randomUUID().replace(/-/g, '').slice(0, 20)}`;

export type MoveStatus = 'started' | 'source_refused' | 'inviting' | 'invite_failed' | 'invited';
export type MoveErrorCode =
  | 'destination_unreachable' | 'destination_refused' | 'destination_active' | 'destination_not_bound';

export type MoveRow = {
  uid: string;
  from_code: string;
  to_code: string;
  branch_user_id: number;
  reason: string;
  actor_user_id: number;
  actor_name: string;
  status: MoveStatus;
  target_email: string | null;
  target_name: string | null;
  target_role: string | null;
  moved_out_at: string | null;
  attempts: number;
  last_attempt_at: string | null;
  last_error_code: MoveErrorCode | null;
  last_error: string | null;
  invite_uid: string | null;
  invite_email_sent: number | null;
  invite_email_reason: string | null;
  invited_at: string | null;
  created_at: string;
  updated_at: string;
};

/** Record a move before the source is called. Throws when it cannot be recorded: the caller refuses the move. */
export async function recordMoveStarted(env: Env, m: {
  from: string; to: string; branchUserId: number; reason: string; actorUserId: number; actorName: string;
}): Promise<string> {
  const uid = newMoveOpUid();
  await env.DB.prepare(
    `INSERT INTO hq_account_moves (uid, from_code, to_code, branch_user_id, reason, actor_user_id, actor_name, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'started')`,
  ).bind(uid, m.from, m.to, m.branchUserId, m.reason, m.actorUserId, m.actorName).run();
  return uid;
}

/** The source refused: nothing happened there. Best-effort; the reply says the same. */
export async function recordSourceRefused(env: Env, uid: string, message: string): Promise<void> {
  try {
    await env.DB.prepare(
      `UPDATE hq_account_moves SET status = 'source_refused', last_error = ?, updated_at = datetime('now')
        WHERE uid = ? AND status = 'started'`,
    ).bind(message.slice(0, 500), uid).run();
  } catch (e) {
    console.warn('[accountMoves] source refusal not recorded', (e as Error).message);
  }
}

/**
 * The source closed the account. This stamp is the proof the retry requires,
 * and the target fields are what the retry will send. Returns whether it was
 * recorded; when it was not, the move still happened and the reply says that
 * the recovery is not available from HQ.
 */
export async function recordMovedOut(env: Env, uid: string, target: {
  email: string | null; name: string | null; role: string | null;
}): Promise<boolean> {
  try {
    const r = await env.DB.prepare(
      `UPDATE hq_account_moves
          SET status = 'inviting', moved_out_at = datetime('now'), target_email = ?, target_name = ?,
              target_role = ?, attempts = 1, last_attempt_at = datetime('now'), updated_at = datetime('now')
        WHERE uid = ? AND status = 'started'`,
    ).bind(target.email, target.name, target.role, uid).run();
    return Number(r?.meta?.changes ?? 0) === 1;
  } catch (e) {
    console.warn('[accountMoves] move-out not recorded', (e as Error).message);
    return false;
  }
}

export type InviteOutcome =
  | { ok: true; invite_uid: string | null; email_sent: boolean; email_reason?: string | null }
  | { ok: false; code: MoveErrorCode; message: string };

/** What the destination answered. Best-effort; never throws into a handler whose invitation already landed. */
export async function recordInviteOutcome(env: Env, uid: string, o: InviteOutcome): Promise<boolean> {
  try {
    if (o.ok) {
      await env.DB.prepare(
        `UPDATE hq_account_moves
            SET status = 'invited', invite_uid = ?, invite_email_sent = ?, invite_email_reason = ?,
                invited_at = datetime('now'), last_error_code = NULL, last_error = NULL, updated_at = datetime('now')
          WHERE uid = ?`,
      ).bind(o.invite_uid, o.email_sent ? 1 : 0, o.email_reason ?? null, uid).run();
    } else {
      await env.DB.prepare(
        `UPDATE hq_account_moves
            SET status = 'invite_failed', last_error_code = ?, last_error = ?, updated_at = datetime('now')
          WHERE uid = ? AND status = 'inviting'`,
      ).bind(o.code, o.message.slice(0, 500), uid).run();
    }
    return true;
  } catch (e) {
    console.warn('[accountMoves] invitation outcome not recorded', (e as Error).message);
    return false;
  }
}

export async function readMove(env: Env, uid: string): Promise<MoveRow | null> {
  return env.DB.prepare('SELECT * FROM hq_account_moves WHERE uid = ?').bind(uid).first<MoveRow>();
}

/**
 * Take the row for one retry. Only a move whose source closed the account
 * (`moved_out_at`) and whose invitation failed — or whose invitation call was
 * abandoned — can be taken, and only by one caller at a time.
 */
export async function claimRetry(env: Env, uid: string): Promise<boolean> {
  const r = await env.DB.prepare(
    `UPDATE hq_account_moves
        SET status = 'inviting', attempts = attempts + 1, last_attempt_at = datetime('now'), updated_at = datetime('now')
      WHERE uid = ? AND moved_out_at IS NOT NULL
        AND (status = 'invite_failed'
             OR (status = 'inviting' AND datetime(updated_at) < datetime('now', ?)))`,
  ).bind(uid, `-${RETRY_STALE_MINUTES} minutes`).run();
  return Number(r?.meta?.changes ?? 0) === 1;
}

/**
 * The moves HQ Team still has to finish or follow up: the source closed the
 * account and the invitation did not land (or its call was abandoned), or the
 * invitation landed and its message did not leave, within the invitation's life.
 */
export async function listOpenMoves(env: Env): Promise<MoveRow[]> {
  const r = await env.DB.prepare(
    `SELECT * FROM hq_account_moves
      WHERE moved_out_at IS NOT NULL
        AND (status IN ('invite_failed', 'inviting')
             OR (status = 'invited' AND invite_email_sent = 0 AND datetime(invited_at) > datetime('now', ?)))
      ORDER BY updated_at DESC, id DESC LIMIT 100`,
  ).bind(`-${OPEN_UNSENT_DAYS} days`).all<MoveRow>();
  return (r?.results ?? []) as MoveRow[];
}

/** One sentence per state, from the row alone. */
export function moveState(row: MoveRow): string {
  if (row.status === 'invited') return row.invite_email_sent === 1 ? 'invitation_sent' : 'invitation_not_sent';
  if (row.status === 'inviting') return 'invitation_in_progress';
  if (row.status === 'invite_failed') return 'invitation_failed';
  if (row.status === 'source_refused') return 'source_refused';
  return 'not_moved_out';
}

/**
 * The row as HQ Team reads it. `target` is the source's answer; the email is
 * shown because the operator must know whom to reach when mail did not leave.
 */
export function publicMove(row: MoveRow) {
  return {
    uid: row.uid,
    from: row.from_code,
    to: row.to_code,
    branch_user_id: row.branch_user_id,
    target: { name: row.target_name, email: row.target_email, role: row.target_role },
    status: row.status,
    state: moveState(row),
    moved_out: row.moved_out_at != null,
    moved_out_at: row.moved_out_at,
    attempts: Number(row.attempts ?? 0),
    last_attempt_at: row.last_attempt_at,
    last_error_code: row.last_error_code,
    last_error: row.last_error,
    invitation: row.status === 'invited'
      ? {
        uid: row.invite_uid,
        stored: true,
        email_sent: row.invite_email_sent === 1,
        email_reason: row.invite_email_reason,
        invited_at: row.invited_at,
      }
      : null,
    created_at: row.created_at,
    updated_at: row.updated_at,
    records_note: `Projects, deals and documents stay with ${row.from_code} and are readable by HQ. `
      + 'This is a re-invite, not a record migration.',
  };
}

/** The destination's refusal for an email that is already active there (`inviteAccount`). */
export function isDestinationActiveRefusal(words: string | null): boolean {
  return words != null && /already has an active account/.test(words);
}
