/**
 * D794 (#2219) — is an auto-reload due? The light half, called from the
 * settlement of every run (`aiBudget.settleAiReservation`).
 *
 * It reads D1 only and, when a reload is due, queues the `ai_auto_reload`
 * job. It never calls Stripe, so a run never waits on a charge: the job does
 * that on the queue (`services/aiAutoReload.ts`). That keeps this module off
 * every path to Stripe code (D707, `fund_modules_no_stripe_d707`).
 *
 * A reload is due when auto-reload is on with a saved card, the top-up
 * balance is below the member's threshold, and this balance crossing has not
 * been reloaded yet. A crossing is named by the latest credited pack
 * (`crossingOf`): it changes only when a new pack is credited, so one crossing
 * queues at most one charge, whatever number of runs settle below the line.
 */
import type { Env } from '../types';
import { enqueueJob } from './queue';

/**
 * The balance crossing a reload would be for: the payment intent of the
 * member's latest credited pack, or 'none' before the first. Reloading moves
 * it on, once the webhook credits the reload.
 */
export async function crossingOf(env: Env, userId: number): Promise<string> {
  const row = await env.DB.prepare(`SELECT payment_intent_id FROM ai_credit_ledger
      WHERE user_id = ? AND kind = 'purchase' ORDER BY created_at DESC, rowid DESC LIMIT 1`)
    .bind(userId).first<{ payment_intent_id: string | null }>();
  return row?.payment_intent_id ?? 'none';
}

/** The settings and the balance that decide whether a reload is due, or null when auto-reload is off. */
export async function dueState(env: Env, userId: number) {
  const row = await env.DB.prepare(`SELECT a.threshold_microusd, a.last_crossing,
      COALESCE((SELECT balance_microusd FROM ai_topup_accounts WHERE user_id = a.user_id), 0) AS balance_microusd
    FROM member_ai_auto_reload a
    WHERE a.user_id = ? AND a.enabled = 1 AND a.stripe_payment_method IS NOT NULL`)
    .bind(userId).first<{ threshold_microusd: number; last_crossing: string | null; balance_microusd: number }>();
  if (!row) return null;
  if (row.balance_microusd >= row.threshold_microusd) return { due: false as const, ...row, crossing: null };
  const crossing = await crossingOf(env, userId);
  return { due: crossing !== row.last_crossing, ...row, crossing };
}

/**
 * After a run settles: queue the reload when one is due. Never throws, and
 * never delays the run beyond two D1 reads: a reload that cannot be judged now
 * is judged again at the next settlement.
 */
export async function queueAutoReloadIfDue(env: Env, userId: number): Promise<boolean> {
  try {
    if (!Number.isSafeInteger(userId) || userId <= 0) return false;
    const state = await dueState(env, userId);
    if (!state?.due) return false;
    await enqueueJob(env, 'ai_auto_reload', { user_id: userId }, {
      idempotency_key: `ai_auto_reload:${userId}:${state.crossing}`, max_retries: 1,
    });
    return true;
  } catch {
    // A database without migration 511, or a failed read: no reload this time.
    return false;
  }
}
