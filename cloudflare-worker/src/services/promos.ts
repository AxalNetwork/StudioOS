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
import { bindingKey } from '../util/schemaBootstrap';

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
  /** False when product_ids_json is not a JSON array of strings. [] is readable and means every product. */
  product_ids_readable: boolean;
  max_redemptions: number | null;
  times_redeemed: number;
  active: boolean;
  expires_at: string | null;
  created_by: number | null;
  created_at: string;
}

const SCHEMA_READY = new WeakMap<object, boolean>();

/** Idempotent schema bootstrap — mirrors migration 099_promo_codes.sql. */
export async function ensurePromoSchema(env: Env): Promise<void> {
  if (SCHEMA_READY.get(bindingKey(env))) return;
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
        "created_at TEXT NOT NULL DEFAULT (datetime('now')), " +
        // D1274 (migration 631): what the redemption was for.
        'source TEXT, product_id TEXT, price_id TEXT, billing_interval TEXT, ' +
        'amount_before_cents INTEGER, discount_cents INTEGER, currency TEXT' +
        ')',
    );
    await env.DB.exec(
      'CREATE UNIQUE INDEX IF NOT EXISTS idx_promo_redemptions_pi ON promo_redemptions(payment_intent_id)',
    );
    await env.DB.exec(
      'CREATE INDEX IF NOT EXISTS idx_promo_redemptions_promo ON promo_redemptions(promo_id)',
    );
    SCHEMA_READY.set(bindingKey(env), true);
  } catch (e) {
    console.warn('[promos] ensurePromoSchema failed:', (e as Error).message);
  }
}

/** Normalize a code for case-insensitive lookup + uniqueness. */
export function normalizeCode(code: string): string {
  return code.trim().toUpperCase();
}

/**
 * The one reading of a product allow-list.
 *
 * A JSON array of strings is readable. `[]` is readable and means every
 * product (migration 099). Anything else — bad JSON, an object, a number,
 * a mixed array — is not a list, and it is not "every product".
 */
export function readProductIds(json: string): { ok: true; ids: string[] } | { ok: false } {
  let v: unknown;
  try {
    v = JSON.parse(json);
  } catch {
    return { ok: false };
  }
  if (!Array.isArray(v) || v.some((x) => typeof x !== 'string')) return { ok: false };
  return { ok: true, ids: v };
}

export function rowToView(row: PromoRow): PromoView {
  const products = readProductIds(row.product_ids_json);
  return {
    id: row.id,
    code: row.code,
    coupon_id: row.coupon_id,
    percent_off: row.percent_off,
    amount_off: row.amount_off,
    currency: row.currency,
    duration: row.duration,
    product_ids: products.ok ? products.ids : [],
    product_ids_readable: products.ok,
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

/**
 * D213 — THE ONE DEFINITION OF EXPIRED, read by checkout, by HQ · Platform and
 * by Revenue's count. Before it, checkout checked expiry inline and Revenue
 * counted every `active = 1` code as "redeemable now", expired ones included.
 *
 * `expires_at` is written as an ISO string by `routes/admin_promos.ts`. A
 * SQL-format stamp (`YYYY-MM-DD HH:MM:SS`) is read as UTC rather than left to
 * the runtime's local zone. An expiry that does not parse is not treated as
 * expired — checkout's behaviour before this helper, kept rather than changed.
 */
export function promoExpired(expiresAt: string | null | undefined, nowMs: number): boolean {
  if (!expiresAt) return false;
  const raw = String(expiresAt).trim();
  const iso = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(raw) ? `${raw.replace(' ', 'T')}Z` : raw;
  const t = new Date(iso).getTime();
  return Number.isFinite(t) && t <= nowMs;
}

export type PromoState = 'inactive' | 'expired' | 'exhausted' | 'active';

/**
 * A code's one state, checked in this order: switched off, then past its
 * expiry, then at its cap, then active.
 *
 * `redeemed` IS THE CALLER'S COUNT AND THE CALLER SAYS WHICH. Checkout adds
 * Stripe's live counter to the mirror's (`totalRedeemed`); a page load may not
 * call Stripe, so HQ passes the mirror's `times_redeemed` alone — a lower bound,
 * because subscription redemptions are counted by Stripe and not mirrored. So
 * `exhausted` is claimed only when the mirror alone reaches the cap, which is
 * sound: a code the mirror calls exhausted is exhausted. `>=`, as checkout
 * refuses at the cap.
 */
export function promoState(
  row: { active: number | boolean; expires_at: string | null; max_redemptions: number | null },
  redeemed: number,
  nowMs: number,
): PromoState {
  if (!(row.active === 1 || row.active === true)) return 'inactive';
  if (promoExpired(row.expires_at, nowMs)) return 'expired';
  if (row.max_redemptions != null && redeemed >= row.max_redemptions) return 'exhausted';
  return 'active';
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
  | 'product_list_unreadable'
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
  if (promoExpired(promo.expires_at, Date.now())) {
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
  const allow = readProductIds(promo.product_ids_json);
  if (!allow.ok) return { ok: false, reason: 'product_list_unreadable' };
  if (allow.ids.length > 0 && !allow.ids.includes(productId)) {
    return { ok: false, reason: 'product_not_eligible' };
  }
  // D755 §5: a token pack is never discounted.
  const { isTokenPackProduct } = await import('./aiCredits');
  if (await isTokenPackProduct(env, productId)) return { ok: false, reason: 'product_not_eligible' };
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

/** D1274: how a redemption was paid (migration 631). */
export type RedemptionSource = 'cart' | 'payment' | 'free_unlock' | 'subscription';
export const REDEMPTION_SOURCES: readonly RedemptionSource[] = ['cart', 'payment', 'free_unlock', 'subscription'];

/** D1274: what one redemption was for. Every field may be unknown; unknown is stored as NULL, never 0. */
export interface RedemptionDetail {
  source: RedemptionSource;
  productId?: string | null;
  priceId?: string | null;
  interval?: string | null;
  amountBeforeCents?: number | null;
  discountCents?: number | null;
  currency?: string | null;
}

const INTERVALS = new Set(['day', 'week', 'month', 'year']);
const cents = (n: unknown): number | null => (Number.isSafeInteger(n) && (n as number) >= 0 ? (n as number) : null);
const text = (v: unknown, re: RegExp): string | null => (typeof v === 'string' && re.test(v) ? v : null);

/** The detail as the columns hold it: anything malformed is NULL. */
export function detailColumns(d: RedemptionDetail) {
  return {
    source: REDEMPTION_SOURCES.includes(d.source) ? d.source : null,
    product_id: text(d.productId, /^prod_[A-Za-z0-9]{1,64}$/),
    price_id: text(d.priceId, /^price_[A-Za-z0-9]{1,64}$/),
    billing_interval: typeof d.interval === 'string' && INTERVALS.has(d.interval) ? d.interval : null,
    amount_before_cents: cents(d.amountBeforeCents),
    discount_cents: cents(d.discountCents),
    currency: typeof d.currency === 'string' && /^[a-z]{3}$/i.test(d.currency) ? d.currency.toLowerCase() : null,
  };
}

/**
 * Stamp a redemption's detail once. Written after the redemption itself and
 * only where none is stored (`source IS NULL`), so a re-delivered webhook
 * never rewrites it. Best-effort: the redemption and its count stand even if
 * this write fails, and the reads then say Not recorded for it.
 */
async function recordDetail(env: Env, ref: string, d: RedemptionDetail | undefined): Promise<void> {
  if (!d) return;
  const v = detailColumns(d);
  if (!v.source) return;
  try {
    await env.DB.prepare(
      `UPDATE promo_redemptions
          SET source = ?, product_id = ?, price_id = ?, billing_interval = ?,
              amount_before_cents = ?, discount_cents = ?, currency = ?
        WHERE payment_intent_id = ? AND source IS NULL`,
    )
      .bind(v.source, v.product_id, v.price_id, v.billing_interval, v.amount_before_cents, v.discount_cents, v.currency, ref)
      .run();
  } catch {
    console.warn('[promos] redemption detail not recorded');
  }
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
    /** D1274: the product and price; nothing is charged, so the whole price is the discount. */
    detail?: Omit<RedemptionDetail, 'source'>;
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
  await recordDetail(env, syntheticPi, args.detail ? { ...args.detail, source: 'free_unlock' } : undefined);
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
  args: { promoId: string; userId: number; paymentIntentId: string; detail?: RedemptionDetail },
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
  await recordDetail(env, args.paymentIntentId, args.detail);
}

/**
 * D1274: record a subscription's redemption from its first paid invoice.
 *
 * Keyed `sub:<subscription id>`, so a re-delivered invoice, or a second
 * invoice of the same subscription, records nothing more. It does NOT bump
 * `promo_codes.times_redeemed`: Stripe counts a subscription redemption
 * itself, and checkout's cap adds Stripe's counter to the mirror's
 * (`totalRedeemed`), so a bump here would count it twice. One statement, so a
 * subscription row never exists without its source.
 */
export async function recordSubscriptionRedemption(
  env: Env,
  args: { promoId: string; userId: number; subscriptionId: string; detail: Omit<RedemptionDetail, 'source'> },
): Promise<boolean> {
  await ensurePromoSchema(env);
  const v = detailColumns({ ...args.detail, source: 'subscription' });
  const ins = await env.DB.prepare(
    `INSERT OR IGNORE INTO promo_redemptions
       (promo_id, user_id, payment_intent_id, source, product_id, price_id, billing_interval,
        amount_before_cents, discount_cents, currency)
     VALUES (?, ?, ?, 'subscription', ?, ?, ?, ?, ?, ?)`,
  )
    .bind(args.promoId, args.userId, `sub:${args.subscriptionId}`, v.product_id, v.price_id, v.billing_interval,
      v.amount_before_cents, v.discount_cents, v.currency)
    .run();
  return (ins.meta?.changes ?? 0) === 1;
}
