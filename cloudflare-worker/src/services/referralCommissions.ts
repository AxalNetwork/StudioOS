/**
 * Referral commission clawback on refund.
 *
 * WHY THIS FILE EXISTS. The original clawback lived in `referralPayouts.ts`
 * and worked by reversing the Stripe Connect transfer, reading the commission
 * only through a JOIN from `referral_payouts`. Removing Connect would have
 * silently deleted the business rule along with the plumbing: a refunded
 * purchase would leave its referral commission standing, so a referrer keeps
 * credit for revenue the platform gave back. Nobody asked for that, so the
 * rule is preserved here — against `commissions` alone, with no transfer to
 * reverse and no money to move.
 *
 * The reversal is still PROPORTIONAL and CUMULATIVE. Sequential partial
 * refunds each reverse their share of the commission, computed against the
 * running refunded-to-date total rather than each refund in isolation, so
 * rounding cannot drift across several partials.
 */
import type { Env } from '../types';

export interface ClawbackResult {
  // 'reversed'         — commission reduced (partial) or fully reversed.
  // 'no_commission'    — the refunded purchase never generated a commission.
  // 'already_reversed' — commission was already fully reversed (idempotent).
  // 'skipped'          — this refund's share rounds to less than a cent.
  // 'error'            — DB failure; the refund still stands, surfaced to admin.
  outcome: 'reversed' | 'no_commission' | 'already_reversed' | 'skipped' | 'error';
  commission_id?: number;
  reversed_amount_cents?: number;
  detail?: string;
}

let _ready = false;

/**
 * Dev/preview only — production owns this column via migration. Mirrors the
 * production-no-DDL rule established for the apex cutover.
 */
async function ensureClawbackColumns(env: Env): Promise<void> {
  if (_ready) return;
  if (env.ENVIRONMENT === 'production') { _ready = true; return; }
  for (const stmt of [
    `ALTER TABLE commissions ADD COLUMN reversed_amount_cents INTEGER NOT NULL DEFAULT 0`,
    `ALTER TABLE commissions ADD COLUMN reversed_at TIMESTAMP`,
  ]) {
    try { await env.DB.prepare(stmt).run(); } catch { /* already present */ }
  }
  _ready = true;
}

export async function clawbackReferralCommissionForRefund(
  env: Env,
  args: {
    paymentIntentId: string;
    /** The amount of THIS refund (minor units). */
    refundedAmountCents: number;
    /** Original charge total (minor units) — the proportional denominator. */
    chargeAmountCents?: number | null;
    /**
     * Cumulative refunded on the charge AFTER this refund (Stripe's
     * `charge.amount_refunded`). Drives the cumulative reversal target, so
     * sequential partials don't accumulate rounding error. Falls back to this
     * refund's amount when unavailable.
     */
    chargeRefundedToDateCents?: number | null;
    adminId?: number;
    refundId: string;
  },
): Promise<ClawbackResult> {
  try {
    if (!args.paymentIntentId) return { outcome: 'no_commission' };
    await ensureClawbackColumns(env);

    const row = await env.DB.prepare(
      `SELECT id, amount_cents, COALESCE(reversed_amount_cents, 0) AS reversed_amount_cents
         FROM commissions
        WHERE source_id = ? AND source_type = 'purchase'
        LIMIT 1`,
    ).bind(args.paymentIntentId).first<{
      id: number; amount_cents: number; reversed_amount_cents: number;
    }>().catch(() => null);

    if (!row) return { outcome: 'no_commission' };

    const chargeTotal = args.chargeAmountCents && args.chargeAmountCents > 0
      ? args.chargeAmountCents
      : null;
    const refundedToDate = args.chargeRefundedToDateCents ?? args.refundedAmountCents;

    // Without a charge total there is no proportion to compute, so treat any
    // refund as full — the safe direction: reverse too much rather than let a
    // commission survive a refund we cannot size.
    const targetReversed = chargeTotal
      ? Math.round((row.amount_cents * Math.min(refundedToDate, chargeTotal)) / chargeTotal)
      : row.amount_cents;

    if (row.reversed_amount_cents >= row.amount_cents) {
      return { outcome: 'already_reversed', commission_id: row.id };
    }
    const delta = targetReversed - row.reversed_amount_cents;
    if (delta <= 0) return { outcome: 'skipped', commission_id: row.id };

    const fullyReversed = targetReversed >= row.amount_cents;
    await env.DB.prepare(
      `UPDATE commissions
          SET reversed_amount_cents = ?,
              reversed_at = CASE WHEN ? = 1 THEN CURRENT_TIMESTAMP ELSE reversed_at END,
              status = CASE WHEN ? = 1 THEN 'reversed' ELSE status END
        WHERE id = ?`,
    ).bind(targetReversed, fullyReversed ? 1 : 0, fullyReversed ? 1 : 0, row.id).run();

    return {
      outcome: 'reversed',
      commission_id: row.id,
      reversed_amount_cents: delta,
    };
  } catch (e) {
    return { outcome: 'error', detail: (e as Error).message };
  }
}
