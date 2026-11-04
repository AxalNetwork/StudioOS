/**
 * D4373 (#4373) — HQ refunds a deck generation run: every settled charge of
 * one batch goes back to the founder's AI tokens, in one press.
 *
 * WHAT IS REFUNDED. A run holds once (D1502) and settles that hold once, at
 * the sum of its steps' charges. A "settled charge" is a step with
 * `charged_microusd > 0` on a run whose hold is `settled`. Nothing else is: a
 * hold still `pending` or in `review`, or one already `refunded`, charged the
 * member nothing yet (or the review queue owns it), so the press refunds 0 and
 * says why. The refunds never add up to more than the hold actually settled
 * (`actual_included_microusd + actual_topup_microusd`).
 *
 * HOW. Each charge is one `adjustment` row in `ai_credit_ledger`, its balance
 * change and one `admin_audit_log` row, in one D1 batch, as `recordAdjustment`
 * writes them. Its `source_ref` is `adj:deck-refund:<batch uid>:<seq>`, and
 * `UNIQUE(kind, source_ref)` makes the press idempotent: a second press (or a
 * concurrent twin) writes nothing and counts the charge `already_refunded`.
 * These are not goodwill adjustments, so `recordAdjustment`'s $100 and
 * $250-in-30-days bounds do not apply (the charge is the bound) and its window
 * leaves them out. The member gets one notice per press, with the amount and
 * never the reason.
 */
import type { Env } from '../../types';
import { AI_USD_SCALE } from '../aiBudget';

export const REFUND_REF_PREFIX = 'adj:deck-refund:';
export const refundRef = (batchUid: string, seq: number) => `${REFUND_REF_PREFIX}${batchUid}:${seq}`;
export const REASON_MIN = 10, REASON_MAX = 400;

export type RefundCharge = { seq: number; charged_microusd: number; refunded_microusd: number; outcome: 'refunded' | 'already_refunded' | 'over_settled' };
export type RefundOutcome =
  | { ok: false; error: 'batch_not_found' | 'reason_required' }
  | { ok: true; batch_uid: string; member_id: number; hold_status: string | null; refunded_count: number; refunded_microusd: number;
      already_refunded_count: number; already_refunded_microusd: number; charges: RefundCharge[]; nothing_settled: boolean; message: string };

const NOTHING: Record<string, string> = {
  none: 'Nothing to refund: this run took no hold.',
  pending: 'Nothing to refund: this run\'s hold has not settled, so it charged nothing yet.',
  review: 'Nothing to refund yet: this run\'s hold is in HQ\'s review queue. Decide it there.',
  refunded: 'Nothing to refund: this run\'s hold was released in full, so it charged nothing.',
  settled: 'Nothing to refund: this run settled without a charge.',
};

export async function refundBatch(env: Env, input: { batchUid: string; actorId: number; reason: string }): Promise<RefundOutcome> {
  const reason = typeof input.reason === 'string' ? input.reason.trim() : '';
  if (reason.length < REASON_MIN || reason.length > REASON_MAX) return { ok: false, error: 'reason_required' };
  const b = await env.DB.prepare(`SELECT b.uid, b.created_by, b.reservation_uid, r.status, r.user_id,
      COALESCE(r.actual_included_microusd, 0) + COALESCE(r.actual_topup_microusd, 0) AS settled
      FROM deck_area_batches b LEFT JOIN ai_budget_reservations r ON r.uid = b.reservation_uid WHERE b.uid = ?1`)
    .bind(input.batchUid).first<{ uid: string; created_by: number; reservation_uid: string | null; status: string | null; user_id: number | null; settled: number }>();
  if (!b) return { ok: false, error: 'batch_not_found' };
  const member = Number(b.user_id ?? b.created_by);
  const base = { ok: true as const, batch_uid: b.uid, member_id: member, hold_status: b.status ?? null };
  const steps = b.status === 'settled'
    ? ((await env.DB.prepare('SELECT seq, charged_microusd FROM deck_area_batch_steps WHERE batch_uid = ?1 AND charged_microusd > 0 ORDER BY seq')
      .bind(b.uid).all<{ seq: number; charged_microusd: number }>()).results || [])
    : [];
  if (!steps.length) {
    return { ...base, refunded_count: 0, refunded_microusd: 0, already_refunded_count: 0, already_refunded_microusd: 0, charges: [],
      nothing_settled: true, message: NOTHING[b.status ?? 'none'] ?? NOTHING.none };
  }
  const { ensureAdminAuditLogTable } = await import('../../routes/admin');
  await ensureAdminAuditLogTable(env);
  const charges: RefundCharge[] = [];
  const out = { refunded_count: 0, refunded_microusd: 0, already_refunded_count: 0, already_refunded_microusd: 0 };
  for (const s of steps) {
    const ref = refundRef(b.uid, s.seq);
    const charged = Number(s.charged_microusd);
    const prior = await env.DB.prepare("SELECT delta_microusd FROM ai_credit_ledger WHERE kind = 'adjustment' AND source_ref = ?1").bind(ref).first<{ delta_microusd: number }>();
    if (prior) {
      out.already_refunded_count += 1; out.already_refunded_microusd += Number(prior.delta_microusd);
      charges.push({ seq: s.seq, charged_microusd: charged, refunded_microusd: 0, outcome: 'already_refunded' });
      continue;
    }
    // What is still refundable: what the hold settled, less every refund of this run so far.
    const done = await env.DB.prepare("SELECT COALESCE(SUM(delta_microusd), 0) AS n FROM ai_credit_ledger WHERE kind = 'adjustment' AND source_ref LIKE ?1")
      .bind(`${REFUND_REF_PREFIX}${b.uid}:%`).first<{ n: number }>();
    const amount = Math.min(charged, Math.max(0, Number(b.settled) - Number(done?.n || 0)));
    if (amount <= 0) { charges.push({ seq: s.seq, charged_microusd: charged, refunded_microusd: 0, outcome: 'over_settled' }); continue; }
    const uid = crypto.randomUUID();
    const why = `Deck batch ${b.uid} step ${s.seq}: ${reason}`;
    const results = await env.DB.batch([
      env.DB.prepare('INSERT OR IGNORE INTO ai_topup_accounts(user_id) VALUES(?)').bind(member),
      env.DB.prepare(`INSERT OR IGNORE INTO ai_credit_ledger(uid, user_id, kind, delta_microusd, source_ref, actor, reason, reservation_uid)
        VALUES (?, ?, 'adjustment', ?, ?, ?, ?, ?)`).bind(uid, member, amount, ref, String(input.actorId), why, b.reservation_uid),
      env.DB.prepare(`UPDATE ai_topup_accounts SET balance_microusd = balance_microusd + ?, updated_at = datetime('now')
        WHERE user_id = ? AND EXISTS(SELECT 1 FROM ai_credit_ledger WHERE uid = ?)`).bind(amount, member, uid),
      env.DB.prepare(`INSERT INTO admin_audit_log (admin_user_id, action, report_type, viewed_user_id, filters_json)
        SELECT ?, 'deck_batch_refund', 'billing', ?, ? WHERE EXISTS(SELECT 1 FROM ai_credit_ledger WHERE uid = ?)`)
        .bind(input.actorId, member, JSON.stringify({ member_id: member, batch_uid: b.uid, seq: s.seq, delta_microusd: amount, reason, source_ref: ref }), uid),
    ]);
    if (results.length !== 4 || results.some((x) => x.success !== true)) throw new Error('Deck batch refund unreadable');
    if (Number(results[1].meta.changes) === 1) {
      out.refunded_count += 1; out.refunded_microusd += amount;
      charges.push({ seq: s.seq, charged_microusd: charged, refunded_microusd: amount, outcome: 'refunded' });
    } else {
      // A concurrent press wrote this charge's row first.
      out.already_refunded_count += 1; out.already_refunded_microusd += amount;
      charges.push({ seq: s.seq, charged_microusd: charged, refunded_microusd: 0, outcome: 'already_refunded' });
    }
  }
  if (out.refunded_microusd > 0) {
    try {
      const { notify } = await import('../notify');
      const amount = `$${(out.refunded_microusd / AI_USD_SCALE).toFixed(2)}`;
      await notify(env, { userId: member, type: 'ai_balance_adjusted', category: 'billing', title: `${amount} added to your AI top-up balance`,
        body: 'Axal refunded a deck build. Your Usage page lists every change.', link: '/account/usage#top-ups',
        payload: { delta_microusd: out.refunded_microusd }, channels: ['in_app'] });
    } catch { /* best-effort */ }
  }
  const message = out.refunded_count
    ? `Refunded ${out.refunded_count} charge${out.refunded_count === 1 ? '' : 's'} to the member's AI tokens.`
    : 'Nothing new to refund: every charge of this run was refunded before.';
  return { ...base, ...out, charges, nothing_settled: false, message };
}
