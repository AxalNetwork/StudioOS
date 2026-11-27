/**
 * D755 §8 (#1920): a refund or a dispute of a token pack takes its tokens back.
 *
 * The owner's rule, confirmed on 2026-10-18: "A refund or a lost dispute takes
 * back the refunded share of that pack's tokens, up to the member's current
 * top-up balance. What was already spent is recorded as a shortfall. The
 * member cannot buy packs while a dispute is open, or for 90 days after a
 * shortfall." Only "take back" is built.
 *
 * Called only from the verified Stripe webhook (`routes/billing.ts`), and only
 * for a charge whose PaymentIntent has an `ai_topup_purchases` row. Every other
 * charge returns `false` untouched. A case that cannot act throws, so the
 * webhook answers non-2xx and Stripe retries, as the credit does.
 *
 * NO STALE READ. The share to take, the balance it is taken from and the share
 * already reversed are all read inside the one INSERT … SELECT that writes the
 * row, so the balance CHECK (at least 0, 419) never fires and two deliveries
 * racing cannot take the same share twice. The balance and purchase updates
 * then read the row that INSERT wrote.
 *
 * THE SHARE. `ceil((credit + bonus) × amount / expected_total_cents)`, where the
 * expected total is what the member paid, VAT included. VAT is shared pro rata,
 * so a full refund takes exactly the tokens and never "reverses VAT".
 *
 * Kept apart from Perk and Introduction credits (§1): nothing here reads their ledgers.
 */
import type { Env } from '../types';
import { AI_USD_SCALE } from './aiBudget';

type Purchase = { payment_intent_id: string; user_id: number; credited_at: string | null };
const money = (micro: number) => `$${(micro / AI_USD_SCALE).toFixed(2)}`;
// Stripe ids by prefix, as literal patterns: a charge (`ch_`, or `py_` for some payment methods) or a dispute (`dp_`, or `du_`).
const STRIPE_ID = { ch: /^ch_[A-Za-z0-9]+$/, py: /^py_[A-Za-z0-9]+$/, dp: /^dp_[A-Za-z0-9]+$/, du: /^du_[A-Za-z0-9]+$/ } as const;
const safeId = (v: unknown, prefix: keyof typeof STRIPE_ID) => typeof v === 'string' && STRIPE_ID[prefix].test(v) ? v : null;
const cents = (v: unknown) => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 ? v : null;

/** The purchase a charge or dispute belongs to, or null when it is not a token pack's. Throws while it cannot act yet. */
async function purchaseFor(env: Env, paymentIntentId: unknown): Promise<Purchase | null> {
  const pi = typeof paymentIntentId === 'string' ? paymentIntentId : (paymentIntentId as any)?.id;
  if (typeof pi !== 'string' || !pi) return null;
  const row = await env.DB.prepare('SELECT payment_intent_id, user_id, credited_at FROM ai_topup_purchases WHERE payment_intent_id = ?').bind(pi).first<Purchase>();
  if (!row) return null; // not a token pack: leave it exactly as it is
  // The legacy local/dev webhook may soft-accept without a secret. It cannot move paid AI balance.
  if (!env.STRIPE_WEBHOOK_SECRET) throw new Error('AI token reversal webhook is not configured');
  // A reversal that arrives before its credit waits for it: Stripe retries.
  if (!row.credited_at) throw new Error('AI top-up tokens not added yet; reversal retried');
  return row;
}

/**
 * One reversal batch: the row (refund or dispute), the balance change and the
 * purchase's reversed share, each only if the row was written, plus the log.
 * Returns the row written, or null on a replay.
 */
async function takeBack(env: Env, input: { kind: 'refund' | 'dispute'; purchase: Purchase; amountCents: number; sourceRef: string; meta: Record<string, unknown> }) {
  const { kind, purchase, amountCents, sourceRef } = input;
  const uid = crypto.randomUUID();
  const statements = [
    env.DB.prepare('INSERT OR IGNORE INTO ai_topup_accounts(user_id) VALUES(?)').bind(purchase.user_id),
    env.DB.prepare(`INSERT OR IGNORE INTO ai_credit_ledger(uid, user_id, kind, delta_microusd, source_ref, payment_intent_id, pack_uid, shortfall_microusd, actor)
      SELECT ?, p.user_id, ?, -MIN(t.target, a.balance_microusd), ?, p.payment_intent_id, p.pack_uid, t.target - MIN(t.target, a.balance_microusd), 'payment_webhook'
      FROM ai_topup_purchases p
      JOIN ai_topup_accounts a ON a.user_id = p.user_id
      JOIN (SELECT MAX(0, ((credit_microusd + bonus_microusd) * MIN(CAST(? AS INTEGER), expected_total_cents) + expected_total_cents - 1) / expected_total_cents
                    - reversed_microusd) AS target
            FROM ai_topup_purchases WHERE payment_intent_id = ?) t
      WHERE p.payment_intent_id = ? AND t.target > 0`)
      .bind(uid, kind, sourceRef, amountCents, purchase.payment_intent_id, purchase.payment_intent_id),
    env.DB.prepare(`UPDATE ai_topup_accounts SET balance_microusd = balance_microusd + (SELECT delta_microusd FROM ai_credit_ledger WHERE uid = ?),
      updated_at = datetime('now') WHERE user_id = ? AND EXISTS(SELECT 1 FROM ai_credit_ledger WHERE uid = ?)`).bind(uid, purchase.user_id, uid),
    env.DB.prepare(`UPDATE ai_topup_purchases SET reversed_microusd = reversed_microusd
        + (SELECT shortfall_microusd - delta_microusd FROM ai_credit_ledger WHERE uid = ?), updated_at = datetime('now')
      WHERE payment_intent_id = ? AND EXISTS(SELECT 1 FROM ai_credit_ledger WHERE uid = ?)`).bind(uid, purchase.payment_intent_id, uid),
    env.DB.prepare(`INSERT INTO activity_logs(action, details, actor, user_id)
      SELECT ?, json_object('payment_intent_id', ?, 'source_ref', ?, 'taken_microusd', -delta_microusd, 'shortfall_microusd', shortfall_microusd, 'stripe', json(?)),
        'payment_webhook', user_id FROM ai_credit_ledger WHERE uid = ?`)
      .bind(`ai_topup_${kind}_reversed`, purchase.payment_intent_id, sourceRef, JSON.stringify(input.meta), uid),
  ];
  // The dispute is open whether or not it took anything: a share already reversed takes nothing more.
  // A replay, after the dispute has closed, never reopens it: its row is already there.
  if (kind === 'dispute') statements.push(env.DB.prepare(`UPDATE ai_topup_purchases SET dispute_state = 'open', updated_at = datetime('now')
    WHERE payment_intent_id = ? AND (dispute_state IS NULL OR dispute_state <> 'open')
      AND (EXISTS(SELECT 1 FROM ai_credit_ledger WHERE uid = ?) OR NOT EXISTS(SELECT 1 FROM ai_credit_ledger WHERE kind = 'dispute' AND source_ref = ?))
      AND NOT EXISTS(SELECT 1 FROM activity_logs WHERE action = 'ai_topup_dispute_opened' AND details = ?)`)
    .bind(purchase.payment_intent_id, uid, sourceRef, sourceRef),
    env.DB.prepare(`INSERT INTO activity_logs(action, details, actor, user_id)
      SELECT 'ai_topup_dispute_opened', ?, 'payment_webhook', ? WHERE NOT EXISTS(SELECT 1 FROM activity_logs WHERE action = 'ai_topup_dispute_opened' AND details = ?)`)
    .bind(sourceRef, purchase.user_id, sourceRef));
  const results = await env.DB.batch(statements);
  if (results.length !== statements.length || results.some((r) => r.success !== true)) throw new Error('AI token reversal unreadable');
  if (Number(results[1].meta.changes) !== 1) return null;
  return env.DB.prepare('SELECT delta_microusd, shortfall_microusd FROM ai_credit_ledger WHERE uid = ?').bind(uid).first<{ delta_microusd: number; shortfall_microusd: number }>();
}

async function tell(env: Env, userId: number, type: string, title: string, body: string, payload: Record<string, unknown>) {
  try {
    const { notify } = await import('./notify');
    await notify(env, { userId, type, category: 'billing', title, body, link: '/account/usage#top-ups', payload, channels: ['in_app'] });
  } catch { /* best-effort */ }
}
function takenBody(row: { delta_microusd: number; shortfall_microusd: number }, lead: string) {
  const parts = [`${lead}: ${money(-row.delta_microusd)} was taken off your top-up balance.`];
  if (row.shortfall_microusd > 0) parts.push(`${money(row.shortfall_microusd)} of these tokens had already been used.`);
  return parts.join(' ');
}

/** `charge.refunded`. The row is keyed on the cumulative amount refunded, so a replay is ignored and a second partial refund is its own row. */
export async function reverseRefund(env: Env, charge: any): Promise<boolean> {
  const purchase = await purchaseFor(env, charge?.payment_intent);
  if (!purchase) return false;
  const chargeId = safeId(charge?.id, 'ch') ?? safeId(charge?.id, 'py');
  const refunded = cents(charge?.amount_refunded);
  if (!chargeId || refunded === null || charge?.currency !== 'usd') throw new Error('AI top-up refund unreadable');
  if (refunded === 0) return true;
  const row = await takeBack(env, { kind: 'refund', purchase, amountCents: refunded, sourceRef: `rf:${chargeId}:${refunded}`,
    meta: { charge: chargeId, amount_refunded: refunded } });
  if (row) await tell(env, purchase.user_id, 'ai_tokens_refunded', `Refunded: ${money(-row.delta_microusd + row.shortfall_microusd)} of tokens`,
    takenBody(row, 'Refunded'), { payment_intent_id: purchase.payment_intent_id });
  return true;
}

/** `charge.dispute.created`: the disputed share, as a `dispute` row, and the purchase's dispute opened. */
export async function reverseDispute(env: Env, dispute: any): Promise<boolean> {
  const purchase = await purchaseFor(env, dispute?.payment_intent);
  if (!purchase) return false;
  const disputeId = safeId(dispute?.id, 'dp') ?? safeId(dispute?.id, 'du');
  const amount = cents(dispute?.amount);
  if (!disputeId || amount === null || amount === 0) throw new Error('AI top-up dispute unreadable');
  const row = await takeBack(env, { kind: 'dispute', purchase, amountCents: amount, sourceRef: `dp:${disputeId}`,
    meta: { dispute: disputeId, amount, status: typeof dispute?.status === 'string' ? dispute.status : null } });
  if (row) await tell(env, purchase.user_id, 'ai_tokens_disputed', 'Disputed payment: tokens on hold',
    `${takenBody(row, 'Disputed payment')} Token packs can be bought again once the dispute closes.`, { payment_intent_id: purchase.payment_intent_id });
  return true;
}

/**
 * `charge.dispute.closed`. Won, or a warning closed: a `dispute_won` row returns
 * exactly what the dispute row took (never its shortfall), and the dispute's
 * share of `reversed_microusd` is released. Lost: the state only. Each acts
 * only while the purchase's dispute is open, so a replay changes nothing.
 */
export async function closeDispute(env: Env, dispute: any): Promise<boolean> {
  const purchase = await purchaseFor(env, dispute?.payment_intent);
  if (!purchase) return false;
  const disputeId = safeId(dispute?.id, 'dp') ?? safeId(dispute?.id, 'du');
  const status = dispute?.status;
  if (!disputeId || typeof status !== 'string') throw new Error('AI top-up dispute unreadable');
  const won = status === 'won' || status === 'warning_closed';
  if (!won && status !== 'lost') return true; // still under review: nothing to close
  const opened = await env.DB.prepare(`SELECT
      (SELECT 1 FROM activity_logs WHERE action = 'ai_topup_dispute_opened' AND details = ?) AS recorded,
      (SELECT delta_microusd FROM ai_credit_ledger WHERE kind = 'dispute' AND source_ref = ?) AS delta_microusd`)
    .bind(`dp:${disputeId}`, `dp:${disputeId}`).first<{ recorded: number | null; delta_microusd: number | null }>();
  if (!opened?.recorded) throw new Error('AI top-up dispute closed before it was opened; retried');
  const uid = crypto.randomUUID();
  const statements = won ? [
    env.DB.prepare(`INSERT OR IGNORE INTO ai_credit_ledger(uid, user_id, kind, delta_microusd, source_ref, payment_intent_id, pack_uid, actor)
      SELECT ?, p.user_id, 'dispute_won', -d.delta_microusd, ?, p.payment_intent_id, p.pack_uid, 'payment_webhook'
      FROM ai_topup_purchases p JOIN ai_credit_ledger d ON d.kind = 'dispute' AND d.source_ref = ?
      WHERE p.payment_intent_id = ? AND p.dispute_state = 'open' AND d.delta_microusd < 0`)
      .bind(uid, `dw:${disputeId}`, `dp:${disputeId}`, purchase.payment_intent_id),
    env.DB.prepare(`UPDATE ai_topup_accounts SET balance_microusd = balance_microusd + (SELECT delta_microusd FROM ai_credit_ledger WHERE uid = ?),
      updated_at = datetime('now') WHERE user_id = ? AND EXISTS(SELECT 1 FROM ai_credit_ledger WHERE uid = ?)`).bind(uid, purchase.user_id, uid),
    env.DB.prepare(`UPDATE ai_topup_purchases SET dispute_state = 'won',
        reversed_microusd = reversed_microusd - COALESCE((SELECT shortfall_microusd - delta_microusd FROM ai_credit_ledger WHERE kind = 'dispute' AND source_ref = ?), 0),
        updated_at = datetime('now')
      WHERE payment_intent_id = ? AND dispute_state = 'open'`).bind(`dp:${disputeId}`, purchase.payment_intent_id),
  ] : [
    env.DB.prepare(`UPDATE ai_topup_purchases SET dispute_state = 'lost', updated_at = datetime('now')
      WHERE payment_intent_id = ? AND dispute_state = 'open'`).bind(purchase.payment_intent_id),
  ];
  statements.push(env.DB.prepare(`INSERT INTO activity_logs(action, details, actor, user_id)
    SELECT ?, json_object('payment_intent_id', ?, 'dispute', ?, 'status', ?), 'payment_webhook', ? WHERE changes() > 0`)
    .bind(won ? 'ai_topup_dispute_won' : 'ai_topup_dispute_lost', purchase.payment_intent_id, disputeId, status, purchase.user_id));
  const results = await env.DB.batch(statements);
  if (results.length !== statements.length || results.some((r) => r.success !== true)) throw new Error('AI token reversal unreadable');
  if (won && Number(results[0].meta.changes) === 1)
    await tell(env, purchase.user_id, 'ai_tokens_dispute_won', 'Dispute closed: tokens returned',
      `Dispute closed: ${money(-(opened.delta_microusd ?? 0))} was returned to your top-up balance.`, { payment_intent_id: purchase.payment_intent_id });
  return true;
}
