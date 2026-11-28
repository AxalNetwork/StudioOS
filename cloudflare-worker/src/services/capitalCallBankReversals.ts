/**
 * D9017 (#9017) — a capital-call line's "bank reversed" state, which a person
 * resolves (D8534 owner answer b, migration 202611272146).
 *
 * WHEN IT IS RECORDED. The Mercury sync reads a bank line that already holds a
 * confirmed capital-call match with its receipt, and the line now reads
 * `failed` or `cancelled`, or its amount changed (`upsertTransaction`). In the
 * same batch that turns the match `needs_review`, `recordStatement` writes one
 * `capital_call_bank_reversals` row for that receipt. The receipt is unique on
 * the table, so a replayed sync, or a second change to the same bank line,
 * records nothing more.
 *
 * WHAT IT CHANGES. Nothing in the money. The receipt, the line's paid state,
 * the LP's paid-in, the fund's deployed capital and DPI stand: answer (b) is
 * "no automatic reversal". The row keeps the reversal visible on the GP's call
 * read and on the investor's own lp-portal line until a person resolves it.
 * Rejecting the `needs_review` match does not touch it.
 *
 * WHO RESOLVES IT. The GP of record or an Admin, with a note of ten characters
 * or more (`POST /api/funds/:id/capital-calls/bank-reversals/:uid/resolve`,
 * act `capital_call.bank_reversal`, so a support session is refused). The
 * resolution is written on the row (who, when, the note), sealed by the
 * migration's triggers, with an `activity_logs` row in the same batch.
 *
 * Money is integer cents.
 */
import type { Env } from '../types';

export type BankReversalCause = 'failed' | 'cancelled' | 'restated';

/** What the sync read for the bank line that changed. */
export interface BankLineChange { status: string | null; amount_cents: number }

/**
 * The cause of a change to a receipted bank line: the voided status it now
 * reads, else `restated` when only its amount moved, else null (no reversal).
 */
export function reversalCause(change: BankLineChange, priorCents: number, voided: readonly string[]): BankReversalCause | null {
  const status = String(change.status ?? '').toLowerCase();
  if (voided.includes(status)) return status === 'cancelled' ? 'cancelled' : 'failed';
  return Number(priorCents) !== change.amount_cents ? 'restated' : null;
}

/**
 * The INSERT that records a reversal for the receipt a bank line's live
 * capital-call match holds. Run it in the batch that flags the match: it reads
 * the match while it is still `confirmed` (or already `needs_review` from an
 * earlier change), and `ON CONFLICT (receipt_id) DO NOTHING` keeps it once.
 */
export function recordStatement(env: Env, input: {
  uid: string; transactionId: number; cause: BankReversalCause; change: BankLineChange;
}): D1PreparedStatement {
  return env.DB.prepare(
    `INSERT INTO capital_call_bank_reversals
       (uid, fund_id, capital_call_id, receipt_id, match_id, transaction_id, cause, bank_status, bank_amount_cents, receipt_cents)
     SELECT ?, r.fund_id, r.capital_call_id, r.id, m.id, m.transaction_id, ?, ?, ?, r.amount_cents
       FROM mercury_matches m
       JOIN capital_call_receipts r ON r.id = m.receipt_id
      WHERE m.transaction_id = ? AND m.target_kind = 'capital_call_line'
        AND m.state IN ('confirmed', 'needs_review') AND m.receipt_id IS NOT NULL
     ON CONFLICT (receipt_id) DO NOTHING`,
  ).bind(input.uid, input.cause, input.change.status, input.change.amount_cents, input.transactionId);
}

/** One reversal as the GP's call read shows it. */
export interface BankReversalRow {
  uid: string;
  capital_call_id: number;
  receipt_id: number;
  cause: BankReversalCause;
  bank_status: string | null;
  bank_amount_cents: number;
  receipt_cents: number;
  detected_at: string;
  resolved_at: string | null;
  resolved_by_name: string | null;
  resolution_note: string | null;
}

/** Every reversal on the given lines, open ones first, then newest. */
export async function reversalsForLines(env: Env, lineIds: number[]): Promise<BankReversalRow[]> {
  const ids = [...new Set(lineIds.map(Number).filter((n) => Number.isSafeInteger(n) && n > 0))];
  if (!ids.length) return [];
  const r = await env.DB.prepare(
    `SELECT b.uid, b.capital_call_id, b.receipt_id, b.cause, b.bank_status, b.bank_amount_cents, b.receipt_cents,
            b.detected_at, b.resolved_at, u.name AS resolved_by_name, b.resolution_note
       FROM capital_call_bank_reversals b
       LEFT JOIN users u ON u.id = b.resolved_by
      WHERE b.capital_call_id IN (SELECT value FROM json_each(?))
      ORDER BY (b.resolved_at IS NULL) DESC, b.detected_at DESC, b.id DESC`,
  ).bind(JSON.stringify(ids)).all<any>();
  return (r.results || []).map((row: any) => ({
    uid: row.uid,
    capital_call_id: Number(row.capital_call_id),
    receipt_id: Number(row.receipt_id),
    cause: row.cause,
    bank_status: row.bank_status ?? null,
    bank_amount_cents: Number(row.bank_amount_cents),
    receipt_cents: Number(row.receipt_cents),
    detected_at: row.detected_at,
    resolved_at: row.resolved_at ?? null,
    resolved_by_name: row.resolved_by_name ?? null,
    resolution_note: row.resolution_note ?? null,
  }));
}

/**
 * A line's `bank_reversed`: null when the bank never reversed a receipt on it,
 * else the open reversal (or, all resolved, the newest) as `{ detected_at,
 * resolved_at }`. `rows` comes from `reversalsForLines`, already ordered.
 */
export function lineBankReversed(rows: BankReversalRow[], lineId: number): { detected_at: string; resolved_at: string | null } | null {
  const first = rows.find((r) => r.capital_call_id === Number(lineId));
  return first ? { detected_at: first.detected_at, resolved_at: first.resolved_at } : null;
}

export type ResolveOutcome =
  | { kind: 'resolved'; reversal: BankReversalRow }
  | { kind: 'not_found' }
  | { kind: 'already_resolved'; reversal: BankReversalRow };

async function byUid(env: Env, fundId: number, uid: string): Promise<BankReversalRow | null> {
  const row = await env.DB.prepare('SELECT capital_call_id FROM capital_call_bank_reversals WHERE uid = ? AND fund_id = ?')
    .bind(uid, fundId).first<{ capital_call_id: number }>();
  if (!row) return null;
  return (await reversalsForLines(env, [Number(row.capital_call_id)])).find((r) => r.uid === uid) ?? null;
}

/**
 * Resolve one open reversal on this fund: who, when and the note go on the
 * row, and an `activity_logs` row lands in the same batch only when the row
 * changed. A reversal on another fund is the same not_found as none at all.
 */
export async function resolveReversal(env: Env, input: { fundId: number; uid: string; userId: number; note: string }): Promise<ResolveOutcome> {
  const results = await env.DB.batch([
    env.DB.prepare(
      `UPDATE capital_call_bank_reversals
          SET resolved_at = datetime('now'), resolved_by = ?, resolution_note = ?
        WHERE uid = ? AND fund_id = ? AND resolved_at IS NULL`,
    ).bind(input.userId, input.note, input.uid, input.fundId),
    // No note text in the audit row: the reversal and the person are enough to find it.
    env.DB.prepare(
      `INSERT INTO activity_logs (action, details, actor, user_id)
       SELECT 'capital_call_bank_reversal_resolved', ?, ?, ? WHERE changes() = 1`,
    ).bind(JSON.stringify({ fund_id: input.fundId, reversal_uid: input.uid }), String(input.userId), input.userId),
  ]);
  const changed = Number(results[0]?.meta?.changes ?? 0) === 1;
  const row = await byUid(env, input.fundId, input.uid);
  if (!row) return { kind: 'not_found' };
  return changed ? { kind: 'resolved', reversal: row } : { kind: 'already_resolved', reversal: row };
}
