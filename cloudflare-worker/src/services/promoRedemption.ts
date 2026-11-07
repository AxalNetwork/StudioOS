/**
 * D4855 (#4855) — the one rule that decides whether a promo redemption is
 * permitted, and the one place a discount is reserved against a ceiling.
 *
 * `canRedeemPromo` answers; `reservePromo` answers and, in the same breath,
 * takes the discount out of the ceiling. Every checkout path and the preview
 * the page validates with call these two and nothing else: no route reads
 * `validatePromoForProduct` itself (the guard test reads the sources and fails
 * if one does).
 *
 * WHAT THE RULE CHECKS, cheapest first, in this order:
 *   1. the code's own terms (`validatePromoForProduct`, which stays the home of
 *      those): state, expiry, currency of an amount-off code, the products and
 *      plans it lists, the billing interval, once per member, the code's cap,
 *      first purchase only;
 *   2. the licence's ceiling, on a branch: HQ's ceiling for the current
 *      period, what the ledger already holds against it, and this discount.
 *
 * THE CEILING. A code names no licence, so the licence is the Worker: a branch
 * Worker serves one licence and holds the ceiling HQ pushed
 * (`branch_promo_ceiling`); HQ's own Worker has no ceiling and the second stage
 * does not apply to it. On a branch a discount is refused when
 *   - HQ has pushed no ceiling for this period, or one for another period: there
 *     is no ceiling to enforce and the discount is allowed until HQ sets one
 *     (owner decision, 2026-11-07, option B). That is "not recorded", which is
 *     a different fact from "could not be read", and it is never shown as 0 or
 *     as an unlimited figure. The discount is still written to the ledger, so
 *     the spend is known when a ceiling arrives (see NO CEILING, below);
 *   - the ceiling is there but cannot be read (`ceiling_unreadable`): refused.
 *     An unreadable ceiling does not wave a discount through;
 *   - the ceiling is in another currency than the sale (`currency_mismatch`):
 *     never converted;
 *   - the discount is more than what is left (`ceiling_exceeded`, with what is
 *     left, in minor units).
 *
 * ATOMIC. `reservePromo` writes one conditional INSERT: the row exists only if
 * the live total plus this discount is within the ceiling when SQLite runs it.
 * There is no read followed by a write for the ceiling, so two checkouts racing
 * for the last of it cannot both win. The reference makes a retry the same row:
 * a repeated attempt with the same reference reserves nothing more.
 *
 * NO CEILING. The ledger row is still written, with the same key and the same
 * retake rule, so `branch_promo_ceiling.issued_cents` and a ceiling HQ sets
 * later both count what was already given in the period. Nothing is being
 * enforced, so a failure to write that row does NOT block the sale: it logs a
 * count (no names, no figures) and lets it through. The cost is that such a
 * discount is missing from the spend HQ's later ceiling is measured against.
 * A write that fails while a ceiling IS in force stays a refusal.
 *
 * LIFECYCLE. A reservation is `reserved` for `RESERVATION_TTL_MS`, then stops
 * counting by itself (nothing sweeps it). The payment webhook commits it; a
 * checkout that fails before any payment releases it. A payment that succeeds
 * after its reservation lapsed is committed anyway: money taken is not undone,
 * so that one case can pass the ceiling, and the ledger then shows it.
 */
import type { Env } from '../types';
import { branchOf } from '../util/branch';
import { quarterKey } from './statements';
import {
  validatePromoForProduct,
  type PromoBuyer, type PromoRejectReason, type PromoRow, type PromoValidation,
} from './promos';

/** An abandoned checkout stops holding the ceiling after this long. */
export const RESERVATION_TTL_MS = 60 * 60 * 1000;

export type CeilingRefusal = 'ceiling_exceeded' | 'ceiling_unreadable';
export type RedeemRefusalReason = PromoRejectReason | CeilingRefusal;

/** Our sentence for each reason: what is wrong and what the member can do. */
export const REFUSAL_MESSAGES: Record<RedeemRefusalReason, string> = {
  not_found: 'That code is not valid. Check it and try again.',
  inactive: 'This code is no longer active.',
  expired: 'This code has expired.',
  product_not_eligible: 'This code does not apply to this item. Choose an item it covers, or remove the code.',
  product_list_unreadable: 'This code cannot be checked right now. Try again in a moment.',
  usage_limit_reached: 'This code has reached its limit of uses.',
  currency_mismatch: 'This code cannot be used in this currency. Pay without it, or choose an item priced in the code\'s currency.',
  interval_not_eligible: 'This code does not apply to this billing period. Choose a period it covers.',
  already_used: 'You have used this code already.',
  not_first_purchase: 'This code is for a first purchase only.',
  first_purchase_unreadable: 'We could not confirm this is your first purchase. Try again in a moment.',
  ceiling_exceeded: 'This code\'s discount is more than this licence\'s promotion budget has left. Pay without it, or ask the licence holder to ask HQ to raise the ceiling.',
  ceiling_unreadable: 'This licence\'s promotion budget could not be read, so no discount was given. Try again in a moment.',
};

export interface RedeemRequest {
  code: string;
  productId: string;
  /** The price before the code, in minor units. */
  amountCents: number;
  /** The sale's currency. Compared, never converted. */
  currency?: string;
  buyer: PromoBuyer;
  /**
   * This checkout's own reference, when it has one. A hold this reference
   * already placed is not counted against it, so a retry is asked the same
   * question the first attempt was and not "does it fit twice".
   */
  reference?: string;
}

export interface CeilingFigures {
  period: string;
  currency: string;
  ceiling_cents: number;
  spent_cents: number;
  remaining_cents: number;
}

export interface Refusal {
  ok: false;
  reason: RedeemRefusalReason;
  message: string;
  /** What the ceiling has left, when the refusal is about it and it could be read. */
  remaining_cents?: number;
  currency?: string;
}

export interface Allowed extends PromoValidation {
  ok: true;
  promo: PromoRow;
  discountedAmount: number;
  discountCents: number;
  /** The ceiling this discount sits under, or null where none applies (HQ, or no discount). */
  ceiling: CeilingFigures | null;
  /**
   * Set on a branch, for a real discount, when HQ has recorded no ceiling for
   * the current period: nothing is enforced, but the ledger still takes the row.
   */
  noCeiling: { period: string; currency: string } | null;
}

export type CanRedeem = Allowed | Refusal;
export type Reserved = Allowed & { reservation: { ref: string; reused: boolean } | null };
export type ReserveResult = Reserved | Refusal;

const refusal = (reason: RedeemRefusalReason, extra: { remaining_cents?: number; currency?: string } = {}): Refusal => ({
  ok: false, reason, message: REFUSAL_MESSAGES[reason], ...extra,
});

/** The body every checkout path returns for a refusal; the SPA reads `reason`. */
export function promoRefusalBody(r: Refusal): Record<string, unknown> {
  return {
    error: 'promo_invalid',
    reason: r.reason,
    message: r.message,
    detail: r.message,
    ...(r.remaining_cents !== undefined ? { remaining_cents: r.remaining_cents } : {}),
    ...(r.currency ? { currency: r.currency } : {}),
  };
}


// "Live" means counts against the ceiling: committed for good, or reserved until it lapses.
// The test is written out in each statement, because check-sql-prepare refuses an interpolated one:
//   (r.state = 'committed' OR (r.state = 'reserved' AND r.expires_at > ?))

/** The ceiling in force, `null` where HQ has recorded none for this period, or a refusal where it cannot be read. */
async function readCeiling(env: Env, now: number, ownRefPrefix?: string): Promise<CeilingFigures | Refusal | null> {
  // The prefix of this checkout's own hold ("<reference>#<discount>"); a sentinel no ref starts with when it has none.
  const own = ownRefPrefix === undefined ? '\u0001' : `${ownRefPrefix}#`;
  try {
    const row = await env.DB.prepare('SELECT period, ceiling_cents, currency FROM branch_promo_ceiling WHERE id = 1')
      .first<{ period: string; ceiling_cents: number; currency: string }>();
    // Not recorded: no row, or one pushed for another period, which says nothing about this one.
    if (!row || row.period !== quarterKey(new Date(now))) return null;
    const currency = String(row.currency).toUpperCase();
    const spent = await env.DB.prepare(
      `SELECT COALESCE(SUM(r.amount_cents), 0) AS cents FROM promo_ceiling_reservations r
        WHERE r.period = ? AND r.currency = ? AND (r.state = 'committed' OR (r.state = 'reserved' AND r.expires_at > ?)) AND NOT (substr(r.ref, 1, ?) = ?)`,
    ).bind(row.period, currency, new Date(now).toISOString(), own.length, own).first<{ cents: number }>();
    const ceiling = Number(row.ceiling_cents);
    const used = Number(spent?.cents);
    if (!Number.isSafeInteger(ceiling) || !Number.isSafeInteger(used)) return refusal('ceiling_unreadable');
    return { period: row.period, currency, ceiling_cents: ceiling, spent_cents: used, remaining_cents: Math.max(0, ceiling - used) };
  } catch {
    return refusal('ceiling_unreadable');
  }
}

/**
 * Is this redemption permitted? Reads only; nothing is reserved. The preview
 * the page validates with calls this, so what it says is what checkout decides.
 */
export async function canRedeemPromo(env: Env, req: RedeemRequest, nowMs: number = Date.now()): Promise<CanRedeem> {
  const v = await validatePromoForProduct(env, req.code, req.productId, req.amountCents, req.currency, req.buyer);
  if (!v.ok || !v.promo) return refusal((v.reason ?? 'not_found') as PromoRejectReason);
  const discountCents = v.discountCents ?? 0;
  const allowed = (ceiling: CeilingFigures | null, noCeiling: Allowed['noCeiling'] = null): Allowed => ({
    ...v, ok: true, promo: v.promo as PromoRow, discountedAmount: v.discountedAmount ?? req.amountCents, discountCents, ceiling, noCeiling,
  });
  // HQ has no licence and so no ceiling; a discount of nothing spends nothing.
  if (branchOf(env) === null || discountCents <= 0) return allowed(null);
  const ceiling = await readCeiling(env, nowMs, req.reference);
  if (ceiling === null) return allowed(null, { period: quarterKey(new Date(nowMs)), currency: String(req.currency ?? '').toUpperCase() });
  if ('ok' in ceiling) return ceiling;
  if (!req.currency || req.currency.toUpperCase() !== ceiling.currency) {
    return refusal('currency_mismatch', { currency: ceiling.currency });
  }
  if (discountCents > ceiling.remaining_cents) {
    return refusal('ceiling_exceeded', { remaining_cents: ceiling.remaining_cents, currency: ceiling.currency });
  }
  return allowed(ceiling);
}

/** `issued_cents` is the branch's running figure for HQ; it follows the ledger. */
const syncIssued = (env: Env, nowIso: string) => env.DB.prepare(
  `UPDATE branch_promo_ceiling SET issued_cents = (
      SELECT COALESCE(SUM(r.amount_cents), 0) FROM promo_ceiling_reservations r
       WHERE r.period = branch_promo_ceiling.period AND r.currency = upper(branch_promo_ceiling.currency) AND (r.state = 'committed' OR (r.state = 'reserved' AND r.expires_at > ?))
   ) WHERE id = 1`,
).bind(nowIso);

/**
 * Permit the redemption and take its discount out of the ceiling, atomically.
 * `reference` names this checkout (its idempotency key or order id): the same
 * reference twice is one reservation. Where no ceiling applies, nothing is
 * written and `reservation` is null.
 */
export async function reservePromo(
  env: Env, req: RedeemRequest & { reference: string }, nowMs: number = Date.now(), checked?: Allowed,
): Promise<ReserveResult> {
  // `checked`: the answer `canRedeemPromo` gave this same request earlier in the
  // handler. The code's terms are not asked twice; the write below still tests
  // the ceiling itself, so a stale figure cannot overspend.
  const can = checked ?? await canRedeemPromo(env, req, nowMs);
  if (!can.ok) return can;
  const { ceiling, promo, discountCents } = can;
  const ref = `${req.reference}#${discountCents}`;
  const nowIso = new Date(nowMs).toISOString();
  const until = new Date(nowMs + RESERVATION_TTL_MS).toISOString();
  if (!ceiling) {
    if (!can.noCeiling) return { ...can, reservation: null };
    // No ceiling to enforce: record the discount, but never let the record block the sale.
    try {
      const { period, currency } = can.noCeiling;
      if (!currency) throw new Error('no currency');
      const [insert] = await env.DB.batch([
        env.DB.prepare(
          `INSERT INTO promo_ceiling_reservations
             (ref, period, currency, amount_cents, promo_id, user_id, state, expires_at, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, 'reserved', ?, ?, ?)
           ON CONFLICT(ref) DO UPDATE SET
             state = 'reserved', period = excluded.period, currency = excluded.currency,
             amount_cents = excluded.amount_cents, promo_id = excluded.promo_id, user_id = excluded.user_id,
             expires_at = excluded.expires_at, updated_at = excluded.updated_at
           WHERE promo_ceiling_reservations.state = 'released'
              OR (promo_ceiling_reservations.state = 'reserved' AND promo_ceiling_reservations.expires_at <= ?)`,
        ).bind(ref, period, currency, discountCents, promo.id, req.buyer.userId, until, nowIso, nowIso, nowIso),
        syncIssued(env, nowIso),
      ]);
      return { ...can, reservation: { ref, reused: (insert.meta?.changes ?? 0) !== 1 } };
    } catch {
      // A count only: no names, no figures.
      console.error('[promo-ceiling] ledger write failed with no ceiling in force', { failed: 1 });
      return { ...can, reservation: null };
    }
  }

  // ONE statement decides and writes. The row is inserted only while the live
  // total plus this discount is within the ceiling; a row of the same
  // reference that is already live is left alone (a retry), and one that was
  // released or lapsed is taken again under the same test.
  let insert;
  try {
    [insert] = await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO promo_ceiling_reservations
           (ref, period, currency, amount_cents, promo_id, user_id, state, expires_at, created_at, updated_at)
         SELECT ?, ?, ?, ?, ?, ?, 'reserved', ?, ?, ?
          WHERE (SELECT COALESCE(SUM(r.amount_cents), 0) FROM promo_ceiling_reservations r
                  WHERE r.period = ? AND r.currency = ? AND (r.state = 'committed' OR (r.state = 'reserved' AND r.expires_at > ?))) + ?
                <= (SELECT c.ceiling_cents FROM branch_promo_ceiling c WHERE c.id = 1 AND c.period = ? AND upper(c.currency) = ?)
         ON CONFLICT(ref) DO UPDATE SET
           state = 'reserved', period = excluded.period, currency = excluded.currency,
           amount_cents = excluded.amount_cents, promo_id = excluded.promo_id, user_id = excluded.user_id,
           expires_at = excluded.expires_at, updated_at = excluded.updated_at
         WHERE promo_ceiling_reservations.state = 'released'
            OR (promo_ceiling_reservations.state = 'reserved' AND promo_ceiling_reservations.expires_at <= ?)`,
      ).bind(
        ref, ceiling.period, ceiling.currency, discountCents, promo.id, req.buyer.userId, until, nowIso, nowIso,
        ceiling.period, ceiling.currency, nowIso, discountCents, ceiling.period, ceiling.currency, nowIso,
      ),
      syncIssued(env, nowIso),
    ]);
  } catch {
    // A ceiling is in force and the write could not be made: not recorded is not the same as unreadable, and this is the second.
    return refusal('ceiling_unreadable');
  }
  if ((insert.meta?.changes ?? 0) === 1) return { ...can, reservation: { ref, reused: false } };

  // Nothing written: this reference already holds the discount (a retry, or the
  // same checkout twice at once), or the ceiling no longer has room for it.
  const held = await env.DB.prepare(
    `SELECT 1 AS hit FROM promo_ceiling_reservations r WHERE r.ref = ? AND r.amount_cents = ? AND r.promo_id = ? AND (r.state = 'committed' OR (r.state = 'reserved' AND r.expires_at > ?))`,
  ).bind(ref, discountCents, promo.id, nowIso).first<{ hit: number }>();
  if (held) return { ...can, reservation: { ref, reused: true } };
  const after = await readCeiling(env, nowMs);
  // A ceiling that was in force a moment ago and is now unreadable or gone: do not guess.
  if (after === null) return refusal('ceiling_unreadable');
  if ('ok' in after) return after;
  return refusal('ceiling_exceeded', { remaining_cents: after.remaining_cents, currency: after.currency });
}

/** The payment went through: the reservation counts for good, whatever state it was in. */
export async function commitPromoReservation(env: Env, ref: string | null | undefined, nowMs: number = Date.now()): Promise<void> {
  if (!ref) return;
  const nowIso = new Date(nowMs).toISOString();
  await env.DB.batch([
    env.DB.prepare("UPDATE promo_ceiling_reservations SET state = 'committed', expires_at = NULL, updated_at = ? WHERE ref = ?").bind(nowIso, ref),
    syncIssued(env, nowIso),
  ]);
}

/** The checkout failed before any payment: the discount goes back to the ceiling. */
export async function releasePromoReservation(env: Env, ref: string | null | undefined, nowMs: number = Date.now()): Promise<void> {
  if (!ref) return;
  const nowIso = new Date(nowMs).toISOString();
  await env.DB.batch([
    env.DB.prepare("UPDATE promo_ceiling_reservations SET state = 'released', expires_at = NULL, updated_at = ? WHERE ref = ? AND state = 'reserved'").bind(nowIso, ref),
    syncIssued(env, nowIso),
  ]);
}

