/**
 * #8523 — idempotency keys for the Stripe calls that move money without the customer's next action.
 *
 * Stripe replays the first response for 24 hours when the same `Idempotency-Key` arrives again, so a retry or a
 * second press of a button cannot run the call twice. A key must come from ids that are the same on the retry:
 * the order, the invoice, the user, the price. Never from a random value or the clock alone, which would be
 * different on the retry and protect nothing.
 *
 * Two shapes:
 *   · an id that names the thing being created (`incorporationKey`): the key is the same for as long as that
 *     thing exists.
 *   · a change that can legitimately be made again later (`windowKey`): a plan swap A→B, then B→A, then A→B is
 *     three real changes, and a key that never moved would replay the first answer for the third. The key
 *     carries the window the call was made in, so a retry inside the window repeats it and a deliberate change
 *     later does not.
 *
 * Every key is built here and unit-tested (cloudflare-worker/test/stripe_keys_d8523.test.ts); the inventory
 * (scripts/build-stripe-inventory.mjs) fails a money-moving POST that does not send one.
 */

/** The window a repeated press is treated as the same request in: ten minutes. */
export const KEY_WINDOW_MS = 10 * 60 * 1000;

/** `parts` joined into a key, with the window `now` falls in appended. Same parts and same window, same key. */
export function windowKey(parts: ReadonlyArray<string | number>, now: number = Date.now(), windowMs: number = KEY_WINDOW_MS): string {
  return `${parts.join(':')}:w${Math.floor(now / windowMs)}`;
}

/** A plan subscription started from the plan page: one per user and price per window. */
export const planSubscriptionKey = (userUid: string, priceId: string, now?: number): string =>
  windowKey(['plan-sub', userUid, priceId], now);

/** A plan swap on a held subscription, from one price to another. */
export const planSwapKey = (userId: number, subscriptionId: string, fromPriceId: string, toPriceId: string, now?: number): string =>
  windowKey(['plan-swap', userId, subscriptionId, fromPriceId, toPriceId], now);

/** One step of an incorporation fee invoice. The pending order's id names it, so every retry sends the same key. */
export const incorporationKey = (incorporationId: number | string, step: 'invoice' | 'item' | 'finalize'): string =>
  `incorporation:${incorporationId}:${step}`;
