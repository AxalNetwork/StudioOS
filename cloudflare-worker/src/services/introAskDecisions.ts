/**
 * D6261 (#6261) — what happens after an investor's quota intro ask: who may
 * answer it, and the three ways it leaves 'pending'.
 *
 * The owner chose A on #6261: the founder is told, accepts or declines, and an
 * accepted ask opens the existing Trust Center NDA step
 * (POST /api/trust/intro/request, which the investor starts with a click). An
 * acceptance is not an NDA signature and not a delivered introduction.
 *
 * The statuses `investor_introductions.status` can hold, and every one the
 * route writes:
 *
 *   pending    written by POST /request; the only status that moves.
 *   accepted   the recipient founder clicked Accept.
 *   declined   the recipient founder clicked Decline.
 *   withdrawn  the investor withdrew it while it was still pending. A slot
 *              spent in the current quarter is returned; one spent in an
 *              earlier quarter is not, because that quarter's allowance is
 *              over and the counter only counts the current one.
 *
 * Each transition is one conditional UPDATE on `status = 'pending'` that names
 * the caller (`recipient_user_id` or `investor_user_id`), so a race between a
 * withdraw and an answer has one winner, and another member's ask is not found.
 */
import type { Env } from '../types';

export const ASK_STATUSES = ['pending', 'accepted', 'declined', 'withdrawn'] as const;
export type AskStatus = typeof ASK_STATUSES[number];
export type AskDecision = 'accepted' | 'declined';

const idOf = (v: unknown): number | null => {
  const n = Number(v);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
};

/**
 * The founder account that may answer an ask, or null when there is none.
 * The precedence is the Asked view's (introAskTargets.ts): a founder account,
 * then a project's founder record, then a founder record; a record names its
 * lowest user id, as D702 resolves it. The migration backfills the same rule.
 */
export async function askRecipient(
  env: Env,
  ask: { founder_user_id?: number | null; founder_id?: number | null; project_id?: number | null },
): Promise<number | null> {
  const person = idOf(ask.founder_user_id);
  if (person) return person;
  const project = idOf(ask.project_id);
  if (project) {
    const row = await env.DB.prepare(
      `SELECT MIN(u.id) AS id FROM users u JOIN projects p ON p.founder_id = u.founder_id WHERE p.id = ?`,
    ).bind(project).first<{ id: number | null }>();
    return idOf(row?.id);
  }
  const record = idOf(ask.founder_id);
  if (record) {
    const row = await env.DB.prepare(`SELECT MIN(id) AS id FROM users WHERE founder_id = ?`)
      .bind(record).first<{ id: number | null }>();
    return idOf(row?.id);
  }
  return null;
}

type Moved = { ok: true; quarter: string } | { ok: false; reason: 'not_found' | 'already_answered'; status?: string };

async function why(env: Env, uid: string, column: 'recipient_user_id' | 'investor_user_id', userId: number): Promise<Moved> {
  const sql = column === 'recipient_user_id'
    ? `SELECT status FROM investor_introductions WHERE uid = ? AND recipient_user_id = ?`
    : `SELECT status FROM investor_introductions WHERE uid = ? AND investor_user_id = ?`;
  const row = await env.DB.prepare(sql).bind(uid, userId).first<{ status: string }>();
  return row ? { ok: false, reason: 'already_answered', status: row.status } : { ok: false, reason: 'not_found' };
}

/** The recipient founder accepts or declines a pending ask addressed to them. */
export async function decideAsk(env: Env, uid: string, founderUserId: number, decision: AskDecision): Promise<Moved & { investorUserId?: number }> {
  const res = await env.DB.prepare(
    `UPDATE investor_introductions
        SET status = ?, decided_at = CURRENT_TIMESTAMP, decided_by = ?
      WHERE uid = ? AND recipient_user_id = ? AND status = 'pending'`,
  ).bind(decision, founderUserId, uid, founderUserId).run();
  if (Number(res.meta?.changes ?? 0) !== 1) return why(env, uid, 'recipient_user_id', founderUserId);
  const row = await env.DB.prepare(
    `SELECT investor_user_id, quarter FROM investor_introductions WHERE uid = ?`,
  ).bind(uid).first<{ investor_user_id: number; quarter: string }>();
  return { ok: true, quarter: row?.quarter ?? '', investorUserId: Number(row?.investor_user_id) };
}

/**
 * The investor withdraws their own pending ask. Returns whether a slot came
 * back: only when the ask was spent in `currentQuarter`, and never below zero.
 */
export async function withdrawAsk(env: Env, uid: string, investorUserId: number, currentQuarter: string): Promise<Moved & { slotReturned?: boolean }> {
  const res = await env.DB.prepare(
    `UPDATE investor_introductions
        SET status = 'withdrawn', decided_at = CURRENT_TIMESTAMP, decided_by = ?
      WHERE uid = ? AND investor_user_id = ? AND status = 'pending'`,
  ).bind(investorUserId, uid, investorUserId).run();
  if (Number(res.meta?.changes ?? 0) !== 1) return why(env, uid, 'investor_user_id', investorUserId);
  const row = await env.DB.prepare(`SELECT quarter FROM investor_introductions WHERE uid = ?`)
    .bind(uid).first<{ quarter: string }>();
  const quarter = row?.quarter ?? '';
  let slotReturned = false;
  if (quarter && quarter === currentQuarter) {
    const back = await env.DB.prepare(
      `UPDATE users SET investor_quota_intros_used = investor_quota_intros_used - 1
        WHERE id = ? AND investor_quota_intros_quarter = ? AND investor_quota_intros_used > 0`,
    ).bind(investorUserId, quarter).run();
    slotReturned = Number(back.meta?.changes ?? 0) === 1;
  }
  return { ok: true, quarter, slotReturned };
}
