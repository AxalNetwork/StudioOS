/**
 * D755 (#1870, #1905) — AI credits: token packs and the top-up ledger.
 *
 * Three balances, never mixed (D755 §1):
 *   - the AI top-up balance: `ai_topup_accounts` and `ai_credit_ledger`
 *     (migration 486), bought only as Stripe token packs;
 *   - Perk credits: earned or granted, never bought;
 *   - Introduction credits: no longer sold.
 * There is no transfer, conversion or shared code path between them, and no
 * file here reads the perk or the introduction ledger.
 *
 * Every amount is integer micro-USD (`AI_USD_SCALE`), except a pack's face
 * value, which is Stripe's integer cents.
 */
import type { Env } from '../types';
import { AI_USD_SCALE } from './aiBudget';

const usd = (dollars: number) => dollars * AI_USD_SCALE;

/** The one constant block for D755 §16. */
export const TOKEN_PACK_LIMITS = Object.freeze({
  /** A pack's face value, whole dollars from $5 to $500. */
  minFaceCents: 500,
  maxFaceCents: 50_000,
  /** A pack's bonus, at most 10% of its face value. */
  maxBonusPercent: 10,
  /** Pack orders per member in any rolling 24 hours. */
  ordersPerDay: 5,
  orderWindowHours: 24,
  /** Balance + uncredited packs + this pack never goes above $1,000. */
  balanceCeilingMicrousd: usd(1_000),
  /** No pack is sold for this long after a shortfall. */
  shortfallHoldDays: 90,
  /** One adjustment moves at most $100 either way. */
  maxAdjustmentMicrousd: usd(100),
  /** At most $250 is added by adjustments per member in 30 days. */
  maxAdjustmentAddedMicrousd: usd(250),
  adjustmentWindowDays: 30,
});

/** SUM(delta_microusd) for one member: equal to their balance, for tests and CR2's reconcile read. */
export async function ledgerBalance(env: Env, userId: number): Promise<number> {
  if (!Number.isSafeInteger(userId) || userId <= 0) throw new Error('AI ledger unreadable');
  const row = await env.DB.prepare('SELECT COALESCE(SUM(delta_microusd),0) AS balance FROM ai_credit_ledger WHERE user_id = ?')
    .bind(userId).first<{ balance: number }>();
  if (!row || !Number.isSafeInteger(row.balance)) throw new Error('AI ledger unreadable');
  return row.balance;
}
