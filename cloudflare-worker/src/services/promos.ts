/**
 * Task #9 — Promo Code service.
 *
 * D1 mirror + validation/redemption logic for promo codes. Stripe Coupons +
 * Promotion Codes are the source of truth (created via /api/admin/promos); this
 * service mirrors them into `promo_codes` (migration 099) and owns the
 * out-of-band redemption accounting that Stripe can't do for embedded one-time
 * PaymentIntents.
 *
 * KEY FACTS that shape this module:
 *   - One-time PaymentIntents do NOT natively redeem coupons/promotion codes —
 *     coupons only apply to Invoice/Subscription/Checkout. So for embedded
 *     one-time purchases we recompute the discount from the mirrored catalog
 *     amount (NEVER trust the client) and track redemptions ourselves.
 *   - usage_limit is therefore enforced via `promo_redemptions` (UNIQUE on
 *     payment_intent_id) + a denormalized `times_redeemed` mirror counter that
 *     only bumps when a redemption row is genuinely inserted.
 *   - Subscription redemptions go through Stripe natively (discounts[0]
 *     [promotion_code]) and bump Stripe's own times_redeemed; validation sums
 *     the live Stripe counter + our mirror counter against max_redemptions.
 */
import type { Env } from '../types';
import { stripeCall } from '../routes/billing';
import { writeFeatureUnlock } from './featureUnlocks';

// Stripe rejects PaymentIntents below the per-currency minimum (~50 cents for
// USD). A discount that drops a one-time charge below this is treated as "free"
// where a fulfilment hook exists (à la carte) and rejected otherwise.
export const STRIPE_MIN_CHARGE_CENTS = 50;

export interface PromoRow {
  id: string;
  code: string;
  code_normalized: string;
  coupon_id: string;
  percent_off: number | null;
  amount_off: number | null;
  currency: string | null;
  duration: string;
  product_ids_json: string;
  max_redemptions: number | null;
  times_redeemed: number;
  active: number;
  expires_at: string | null;
  created_by: number | null;
  created_at: string;
  synced_at: string;
}

export interface PromoView {
  id: string;
  code: string;
  coupon_id: string;
  percent_off: number | null;
  amount_off: number | null;
  currency: string | null;
  duration: string;
  product_ids: string[];
  max_redemptions: number | null;
  times_redeemed: number;
  active: boolean;
  expires_at: string | null;
  created_by: number | null;
  created_at: string;
}

let _schemaReady = false;

/** Idempotent schema bootstrap — mirrors migration 099_promo_codes.sql. */
export async function ensurePromoSchema(env: Env): Promise<void> {
  if (_schemaReady) return;
  try {
    await env.DB.exec(
      'CREATE TABLE IF NOT EXISTS promo_codes (' +
        'id TEXT PRIMARY KEY, ' +
        'code TEXT NOT NULL, ' +
        'code_normalized TEXT NOT NULL, ' +
        'coupon_id TEXT NOT NULL, ' +
        'percent_off REAL, ' +
        'amount_off INTEGER, ' +
        'currency TEXT, ' +
        "duration TEXT NOT NULL DEFAULT 'once', " +
        "product_ids_json TEXT NOT NULL DEFAULT '[]', " +
        'max_redemptions INTEGER, ' +
        'times_redeemed INTEGER NOT NULL DEFAULT 0, ' +
        'active INTEGER NOT NULL DEFAULT 1, ' +
        'expires_at TEXT, ' +
        'created_by INTEGER, ' +
        "created_at TEXT NOT NULL DEFAULT (datetime('now')), " +
        "synced_at TEXT NOT NULL DEFAULT (datetime('now'))" +
        ')',
    );
    await env.DB.exec(
      'CREATE UNIQUE INDEX IF NOT EXISTS idx_promo_codes_normalized ON promo_codes(code_normalized)',
    );
    await env.DB.exec('CREATE INDEX IF NOT EXISTS idx_promo_codes_active ON promo_codes(active)');
    await env.DB.exec(
      'CREATE TABLE IF NOT EXISTS promo_redemptions (' +
        'id INTEGER PRIMARY KEY AUTOINCREMENT, ' +
        'promo_id TEXT NOT NULL, ' +
        'user_id INTEGER NOT NULL, ' +
        'payment_intent_id TEXT NOT NULL, ' +
        "created_at TEXT NOT NULL DEFAULT (datetime('now'))" +
        ')',
    );
    await env.DB.exec(
      'CREATE UNIQUE INDEX IF NOT EXISTS idx_promo_redemptions_pi ON promo_redemptions(payment_intent_id)',
    );
    await env.DB.exec(
      'CREATE INDEX IF NOT EXISTS idx_promo_redemptions_promo ON promo_redemptions(promo_id)',
    );
    _schemaReady = true;
  } catch (e) {
    console.warn('[promos] ensurePromoSchema failed:', (e as Error).message);
  }
}

/** Normalize a code for case-insensitive lookup + uniqueness. */
export function normalizeCode(code: string): string {
  return code.trim().toUpperCase();
}

function parseProductIds(json: string): string[] {
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

export function rowToView(row: PromoRow): PromoView {
  return {
    id: row.id,
    code: row.code,
    coupon_id: row.coupon_id,
    percent_off: row.percent_off,
    amount_off: row.amount_off,
    currency: row.currency,
    duration: row.duration,
    product_ids: parseProductIds(row.product_ids_json),
    max_redemptions: row.max_redemptions,
    times_redeemed: row.times_redeemed,
    active: row.active === 1,
    expires_at: row.expires_at,
    created_by: row.created_by,
    created_at: row.created_at,
  };
}

/** Upsert a promo into the mirror (Stripe remains the source of truth). */
export async function mirrorPromo(
  env: Env,
  p: {
    id: string;
    code: string;
    coupon_id: string;
    percent_off: number | null;
    amount_off: number | null;
    currency: string | null;
    duration: string;
    product_ids: string[];
    max_redemptions: number | null;
    times_redeemed?: number;
    active: boolean;
    expires_at: string | null;
    created_by: number | null;
  },
): Promise<void> {
  await ensurePromoSchema(env);
  await env.DB.prepare(
    `INSERT INTO promo_codes
       (id, code, code_normalized, coupon_id, percent_off, amount_off, currency,
        duration, product_ids_json, max_redemptions, times_redeemed, active,
        expires_at, created_by, synced_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(id) DO UPDATE SET
       code = excluded.code,
       code_normalized = excluded.code_normalized,
       coupon_id = excluded.coupon_id,
       percent_off = excluded.percent_off,
       amount_off = excluded.amount_off,
       currency = excluded.currency,
       duration = excluded.duration,
       product_ids_json = excluded.product_ids_json,
       max_redemptions = excluded.max_redemptions,
       active = excluded.active,
       expires_at = excluded.expires_at,
       synced_at = datetime('now')`,
  )
    .bind(
      p.id,
      p.code,
      normalizeCode(p.code),
      p.coupon_id,
      p.percent_off,
      p.amount_off,
      p.currency,
      p.duration,
      JSON.stringify(p.product_ids),
      p.max_redemptions,
      p.times_redeemed ?? 0,
      p.active ? 1 : 0,
      p.expires_at,
      p.created_by,
    )
    .run();
}

export async function listPromos(env: Env): Promise<PromoView[]> {
  await ensurePromoSchema(env);
  const res = await env.DB.prepare(
    'SELECT * FROM promo_codes ORDER BY created_at DESC',
  ).all<PromoRow>();
  return (res.results ?? []).map(rowToView);
}

export async function getPromoById(env: Env, id: string): Promise<PromoRow | null> {
  await ensurePromoSchema(env);
  return env.DB.prepare('SELECT * FROM promo_codes WHERE id = ?').bind(id).first<PromoRow>();
}

export async function getPromoByCode(env: Env, code: string): Promise<PromoRow | null> {
  await ensurePromoSchema(env);
  return env.DB
    .prepare('SELECT * FROM promo_codes WHERE code_normalized = ?')
    .bind(normalizeCode(code))
    .first<PromoRow>();
}

/** Reflect an active toggle into the mirror. */
export async function setPromoActiveMirror(env: Env, id: string, active: boolean): Promise<void> {
  await ensurePromoSchema(env);
  await env.DB.prepare(
    "UPDATE promo_codes SET active = ?, synced_at = datetime('now') WHERE id = ?",
  )
    .bind(active ? 1 : 0, id)
    .run();
}

/**
 * Compute the discounted total (minor units) for a base amount under a promo.
 * percent_off rounds to the nearest cent; amount_off is capped at the base so
 * the total never goes negative. Returns both the new total and the saved
 * amount for UI display.
 */
export function computeDiscount(
  promo: Pick<PromoRow, 'percent_off' | 'amount_off'>,
  amountCents: number,
): { discountedAmount: number; discountCents: number } {
  let discount = 0;
  if (promo.percent_off != null) {
    discount = Math.round((amountCents * promo.percent_off) / 100);
  } else if (promo.amount_off != null) {
    discount = Math.min(promo.amount_off, amountCents);
  }
  discount = Math.max(0, Math.min(discount, amountCents));
  return { discountedAmount: amountCents - discount, discountCents: discount };
}

export type PromoRejectReason =
  | 'not_found'
  | 'inactive'
  | 'expired'
  | 'product_not_eligible'
  | 'usage_limit_reached'
  | 'currency_mismatch';

export interface PromoValidation {
  ok: boolean;
  reason?: PromoRejectReason;
  promo?: PromoRow;
  discountedAmount?: number;
  discountCents?: number;
  /** True when the discounted total is 0 or below Stripe's chargeable minimum. */
  free?: boolean;
}

/**
 * Live redemption count = Stripe's native counter (subscription/checkout
 * redemptions) + our out-of-band mirror counter (embedded one-time + free
 * grants). Best-effort: if the live fetch fails, fall back to the mirror.
 */
async function totalRedeemed(env: Env, promo: PromoRow): Promise<number> {
  let stripeCount = 0;
  try {
    const pc = await stripeCall<{ times_redeemed?: number }>(
      env,
      `/promotion_codes/${promo.id}`,
      {},
      { method: 'GET' },
    );
    stripeCount = Number(pc.times_redeemed) || 0;
  } catch {
    /* live fetch failed → mirror-only count */
  }
  return stripeCount + promo.times_redeemed;
}

/**
 * Validate a code for a specific product + base amount. Recomputes the discount
 * server-side (never trusts a client-supplied amount). Returns the rejection
 * reason on failure so the UI can render a precise message.
 */
export async function validatePromoForProduct(
  env: Env,
  code: string,
  productId: string,
  amountCents: number,
  currency?: string,
): Promise<PromoValidation> {
  const promo = await getPromoByCode(env, code);
  if (!promo) return { ok: false, reason: 'not_found' };
  if (promo.active !== 1) return { ok: false, reason: 'inactive' };
  if (promo.expires_at && new Date(promo.expires_at).getTime() <= Date.now()) {
    return { ok: false, reason: 'expired' };
  }
  // amount_off coupons are currency-scoped; a USD coupon can't discount a EUR
  // price. percent_off is currency-agnostic.
  if (
    promo.amount_off != null &&
    promo.currency &&
    currency &&
    promo.currency.toLowerCase() !== currency.toLowerCase()
  ) {
    return { ok: false, reason: 'currency_mismatch' };
  }
  const allow = parseProductIds(promo.product_ids_json);
  if (allow.length > 0 && !allow.includes(productId)) {
    return { ok: false, reason: 'product_not_eligible' };
  }
  if (promo.max_redemptions != null) {
    const used = await totalRedeemed(env, promo);
    if (used >= promo.max_redemptions) return { ok: false, reason: 'usage_limit_reached' };
  }
  const { discountedAmount, discountCents } = computeDiscount(promo, amountCents);
  return {
    ok: true,
    promo,
    discountedAmount,
    discountCents,
    free: discountedAmount <= 0 || discountedAmount < STRIPE_MIN_CHARGE_CENTS,
  };
}

/**
 * Free (100%-off / sub-minimum) fulfilment for an à la carte unlock — there's
 * no PaymentIntent to charge, so we grant access directly. Idempotent per user
 * via the synthetic redemption id; enforces the global usage cap atomically.
 * Returns false (without granting) when the usage limit is already reached.
 */
export async function fulfilFreeUnlock(
  env: Env,
  args: {
    promo: PromoRow;
    userId: number;
    featureKey: string;
    unlockDays?: number | null;
  },
): Promise<boolean> {
  await ensurePromoSchema(env);
  const syntheticPi = `promo:${args.promo.id}:${args.userId}`;
  // Reserve this user's slot. INSERT OR IGNORE is the idempotency anchor:
  // a re-entry (changes=0) means the user already redeemed — re-ensure the
  // unlock without double-counting.
  const ins = await env.DB.prepare(
    `INSERT OR IGNORE INTO promo_redemptions (promo_id, user_id, payment_intent_id)
     VALUES (?, ?, ?)`,
  )
    .bind(args.promo.id, args.userId, syntheticPi)
    .run();
  const inserted = (ins.meta?.changes ?? 0) === 1;
  if (inserted && args.promo.max_redemptions != null) {
    // Atomic global cap: only succeeds while under the limit.
    const upd = await env.DB.prepare(
      `UPDATE promo_codes SET times_redeemed = times_redeemed + 1
        WHERE id = ? AND (max_redemptions IS NULL OR times_redeemed < max_redemptions)`,
    )
      .bind(args.promo.id)
      .run();
    if ((upd.meta?.changes ?? 0) !== 1) {
      // Limit hit between validate and reserve — roll back the slot.
      await env.DB.prepare('DELETE FROM promo_redemptions WHERE payment_intent_id = ?')
        .bind(syntheticPi)
        .run();
      return false;
    }
  } else if (inserted) {
    // Unlimited promo — still keep the mirror counter meaningful.
    await env.DB.prepare(
      'UPDATE promo_codes SET times_redeemed = times_redeemed + 1 WHERE id = ?',
    )
      .bind(args.promo.id)
      .run();
  }
  await writeFeatureUnlock(env, {
    userId: args.userId,
    featureKey: args.featureKey,
    paymentIntentId: syntheticPi,
    unlockDays: args.unlockDays ?? null,
  });
  return true;
}

/**
 * Record a paid redemption from the billing webhook. Idempotent on the
 * PaymentIntent id; bumps the mirror counter only when a row is genuinely
 * inserted (so re-delivered webhooks don't over-count).
 */
export async function recordPaidRedemption(
  env: Env,
  args: { promoId: string; userId: number; paymentIntentId: string },
): Promise<void> {
  await ensurePromoSchema(env);
  const ins = await env.DB.prepare(
    `INSERT OR IGNORE INTO promo_redemptions (promo_id, user_id, payment_intent_id)
     VALUES (?, ?, ?)`,
  )
    .bind(args.promoId, args.userId, args.paymentIntentId)
    .run();
  if ((ins.meta?.changes ?? 0) === 1) {
    await env.DB.prepare(
      'UPDATE promo_codes SET times_redeemed = times_redeemed + 1 WHERE id = ?',
    )
      .bind(args.promoId)
      .run();
  }
}
