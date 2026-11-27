/**
 * D749 (#1838) — "Not ours": an Admin's mark on a posted bank credit that no
 * record here should claim (a misrouted wire, another entity's deposit, a
 * duplicate). A mark is its own row in `mercury_not_ours` (migration 483),
 * never a `mercury_matches` row: a match points at a record, a mark says
 * there is none.
 *
 *  - WHAT CAN BE MARKED is exactly what can be matched: `creditByUid`'s four
 *    conditions (posted, a credit, not an internal transfer, on a registered
 *    account). Anything else is 409 `not_matchable`.
 *  - ONE LIVE MATCH OR ONE LIVE MARK, NEVER BOTH. The mark's INSERT carries
 *    both NOT EXISTS checks, and `match.ts`'s `insertMatch` carries the mark's,
 *    so a matcher run and an Admin's click cannot both win.
 *  - A MARK IS WITHDRAWN, never deleted (a trigger refuses DELETE). A sync that
 *    changes the line turns an `active` mark `needs_review` (`store.ts`).
 *  - THE COUNTS. A line with an `active` mark is no longer unmatched in
 *    `GET /transactions?match=none`, `cashSummaryFigures` and
 *    `fundUnmatchedCount`; a `needs_review` mark counts the line again. A
 *    live mark (`state <> 'withdrawn'`) blocks a match. Each reader inlines
 *    its condition, because `check-sql-prepare` keeps `${…}` out of
 *    `DB.prepare`; `mercury_not_ours_d749.test.ts` drives each one.
 *
 * NOTHING HERE MOVES MONEY OR CALLS MERCURY. The note is an Admin's own words:
 * it is returned on the Admin routes only, and never logged, audited, put in
 * a draft or exported.
 */
import type { Env, User } from '../../types';
import { creditByUid, type MatchRefusal } from './match';
import { newUid } from './store';

/** Decision 4: the keys live here; the canvas may rename the labels. */
export const NOT_OURS_REASONS = Object.freeze([
  { key: 'not_fund_transaction', label: 'Not a fund transaction' },
  { key: 'other_entity', label: 'Belongs to another entity' },
  { key: 'duplicate', label: 'Duplicate' },
  { key: 'other', label: 'Other' },
] as const);
export type NotOursReason = typeof NOT_OURS_REASONS[number]['key'];
export const NOTE_MAX = 500;
export const REASON_MIN = 10;

const refusal = (status: 400 | 404 | 409, code: string, detail: string): MatchRefusal => ({ ok: false, status, code, detail });
const isReason = (v: unknown): v is NotOursReason => NOT_OURS_REASONS.some((r) => r.key === v);

/** Mark one bank line Not ours. */
export async function markNotOurs(env: Env, user: User, transactionUid: string, body: { reason?: unknown; note?: unknown }):
  Promise<{ ok: true; uid: string } | MatchRefusal> {
  if (!isReason(body?.reason)) return refusal(400, 'invalid_reason', 'Choose why this credit is not ours.');
  const note = typeof body.note === 'string' && body.note.trim() ? body.note.trim() : null;
  if (body.reason === 'other' && (!note || note.length < REASON_MIN)) return refusal(400, 'note_required', 'Say why, in at least ten characters.');
  if (note && note.length > NOTE_MAX) return refusal(400, 'note_too_long', 'A note is at most 500 characters.');
  const credit = await creditByUid(env, transactionUid);
  if (!credit) return refusal(404, 'transaction_not_found', 'No such bank line.');
  if (!credit.eligible) return refusal(409, 'not_matchable', 'Only a posted credit on a registered account, not an internal transfer, can be marked.');
  const uid = newUid();
  // One statement: D1 runs it whole, so the two NOT EXISTS checks and the
  // insert cannot be split by a matcher run. The partial unique index backs
  // the second check.
  const r = await env.DB.prepare(
    `INSERT INTO mercury_not_ours (uid, transaction_id, reason, note, amount_cents, marked_by)
     SELECT ?, t.id, ?, ?, t.amount_cents, ? FROM mercury_transactions t
      WHERE t.id = ?
        AND NOT EXISTS (SELECT 1 FROM mercury_matches m WHERE m.transaction_id = t.id AND m.state <> 'rejected')
        AND NOT EXISTS (SELECT 1 FROM mercury_not_ours n WHERE n.transaction_id = t.id AND n.state <> 'withdrawn')`,
  ).bind(uid, body.reason, note, user.id, credit.id).run();
  if (Number(r.meta?.changes ?? 0) === 1) return { ok: true, uid };
  const match = await env.DB.prepare("SELECT 1 AS x FROM mercury_matches WHERE transaction_id = ? AND state <> 'rejected'").bind(credit.id).first();
  return match
    ? refusal(409, 'has_live_match', 'This line has a live match. Reject the match first.')
    : refusal(409, 'already_marked', 'This line is already marked Not ours.');
}

/** Withdraw a mark: the row stays, and the line is unmatched again. */
export async function withdrawNotOurs(env: Env, user: User, uid: string, reason: unknown): Promise<{ ok: true } | MatchRefusal> {
  const why = typeof reason === 'string' ? reason.trim() : '';
  if (why.length < REASON_MIN || why.length > NOTE_MAX) return refusal(400, 'reason_required', 'Give a reason of at least ten characters.');
  const mark = await env.DB.prepare('SELECT id, state FROM mercury_not_ours WHERE uid = ?').bind(uid).first<{ id: number; state: string }>();
  if (!mark) return refusal(404, 'not_found', 'No such mark.');
  if (mark.state === 'withdrawn') return refusal(409, 'mark_withdrawn', 'This mark is already withdrawn.');
  const r = await env.DB.prepare(
    `UPDATE mercury_not_ours SET state = 'withdrawn', withdrawn_by = ?, withdrawn_at = datetime('now'), withdraw_reason = ?, updated_at = datetime('now')
      WHERE id = ? AND state <> 'withdrawn'`,
  ).bind(user.id, why, mark.id).run();
  if (Number(r.meta?.changes ?? 0) !== 1) return refusal(409, 'mark_withdrawn', 'This mark is already withdrawn.');
  return { ok: true };
}
