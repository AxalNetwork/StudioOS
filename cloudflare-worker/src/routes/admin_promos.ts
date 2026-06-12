import { Hono } from 'hono';
import type { Env } from '../types';
import { requireAdmin, requireFactor, requireStepUp } from '../auth';
import { stripeCall } from './billing';
import { ensureAdminAuditLogTable } from './admin';
import {
  listPromos,
  mirrorPromo,
  getPromoById,
  setPromoActiveMirror,
  normalizeCode,
} from '../services/promos';

// Task #9 — Promo Code admin CRUD. Mounted at `/api/admin/promos` BEFORE the
// catch-all `/api/admin` in index.ts so the nested routes resolve here (same
// mount-precedence trick as `/api/admin/billing`). Each mutation enforces
// `requireFactor('totp')` + `requireStepUp` + `requireAdmin` — creating a
// 100%-off code is money-adjacent, so it needs a RECENT strong-factor re-auth,
// not just a long-lived admin JWT. `/api/admin/promos` is also in index.ts's
// COOL_OFF_PREFIXES so a freshly-recovered admin can't mint promos during
// cool-off.
//
// Stripe Coupons + Promotion Codes are the source of truth. Each promo =
// exactly one Coupon (percent_off XOR amount_off) + one Promotion Code (the
// redeemable string). The product allow-list is stamped BOTH natively
// (`applies_to[products][]`, which Stripe enforces on subscription/invoice
// flows) AND in `metadata.product_ids` (read by the embedded one-time checkout
// path, which redeems out-of-band). The D1 `promo_codes` mirror is for cheap
// admin lookup + usage accounting.

const adminPromos = new Hono<{ Bindings: Env }>();

interface StripeCoupon {
  id: string;
  percent_off: number | null;
  amount_off: number | null;
  currency: string | null;
  duration: string;
}
interface StripePromotionCode {
  id: string;
  code: string;
  coupon: StripeCoupon | string;
  active: boolean;
  max_redemptions: number | null;
  expires_at: number | null;
  times_redeemed?: number;
}

const CODE_RE = /^[A-Z0-9][A-Z0-9_-]{2,63}$/; // 3–64 chars, alphanumeric + _ -
const PRODUCT_RE = /^prod_[A-Za-z0-9]+$/;
const CURRENCY_RE = /^[a-z]{3}$/;

function stripeErr(e: unknown) {
  const msg = (e as Error).message || 'stripe_error';
  if (msg === 'stripe_not_configured') {
    return { body: { error: 'Stripe is not configured', code: 'stripe_not_configured' }, status: 503 as const };
  }
  const m = /^stripe_error:(\d+):([\s\S]*)$/.exec(msg);
  const upstream = m ? Number(m[1]) : 502;
  const detail = m ? m[2] : msg;
  const status: 400 | 502 = upstream >= 400 && upstream < 500 ? 400 : 502;
  return { body: { error: 'Stripe request failed', code: 'stripe_error', upstream_status: upstream, detail }, status };
}

async function audit(
  env: Env,
  adminId: number,
  action: string,
  payload: Record<string, unknown>,
): Promise<void> {
  try {
    await ensureAdminAuditLogTable(env);
    await env.DB.prepare(
      `INSERT INTO admin_audit_log (admin_user_id, action, report_type, viewed_user_id, filters_json)
       VALUES (?, ?, 'billing', NULL, ?)`,
    )
      .bind(adminId, action, JSON.stringify(payload))
      .run();
  } catch (e) {
    console.error('[admin/promos] audit insert failed', action, (e as Error).message);
  }
}

// GET /api/admin/promos — list the mirror (admin read; no step-up needed).
adminPromos.get('/', async (c) => {
  await requireAdmin(c);
  const promos = await listPromos(c.env);
  return c.json({ promos });
});

// POST /api/admin/promos — create a Coupon + Promotion Code, mirror to D1.
adminPromos.post('/', async (c) => {
  await requireFactor(c, 'totp');
  await requireStepUp(c);
  const admin = await requireAdmin(c);
  if (!c.env.STRIPE_SECRET_KEY) {
    return c.json({ error: 'Stripe is not configured', code: 'stripe_not_configured' }, 503);
  }

  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const type = typeof body.type === 'string' ? body.type.trim() : '';

  // free-trial-days is DESCOPED: Stripe coupons require percent_off XOR
  // amount_off — a $0/0% coupon cannot exist, so a trial promo can't be
  // coupon-backed. Reject explicitly rather than silently degrade.
  if (type === 'trial') {
    return c.json(
      { error: 'Free-trial-days promos are not supported', code: 'trial_not_supported' },
      400,
    );
  }
  if (type !== 'percent' && type !== 'fixed') {
    return c.json({ error: 'type must be "percent" or "fixed"', code: 'invalid_type' }, 400);
  }

  const rawCode = typeof body.code === 'string' ? normalizeCode(body.code) : '';
  if (!CODE_RE.test(rawCode)) {
    return c.json({ error: 'code must be 3–64 chars: letters, digits, _ or -', code: 'invalid_code' }, 400);
  }

  // Discount shape.
  const couponForm: Record<string, string> = {};
  let percentOff: number | null = null;
  let amountOff: number | null = null;
  let currency: string | null = null;
  if (type === 'percent') {
    const pct = Number(body.percent_off);
    if (!Number.isFinite(pct) || pct <= 0 || pct > 100) {
      return c.json({ error: 'percent_off must be in (0, 100]', code: 'invalid_percent' }, 400);
    }
    percentOff = pct;
    couponForm.percent_off = String(pct);
  } else {
    const amt = Number(body.amount_off);
    if (!Number.isInteger(amt) || amt <= 0) {
      return c.json({ error: 'amount_off must be a positive integer (minor units)', code: 'invalid_amount' }, 400);
    }
    currency = typeof body.currency === 'string' ? body.currency.trim().toLowerCase() : '';
    if (!CURRENCY_RE.test(currency)) {
      return c.json({ error: 'currency must be a 3-letter ISO code for a fixed-amount promo', code: 'invalid_currency' }, 400);
    }
    amountOff = amt;
    couponForm.amount_off = String(amt);
    couponForm.currency = currency;
  }

  // Duration (defaults to once = first invoice only on subscriptions; ignored
  // for one-time charges which are inherently single-shot).
  const duration = typeof body.duration === 'string' && ['once', 'forever', 'repeating'].includes(body.duration)
    ? body.duration
    : 'once';
  couponForm.duration = duration;
  if (duration === 'repeating') {
    const months = Number(body.duration_in_months);
    if (!Number.isInteger(months) || months <= 0) {
      return c.json({ error: 'duration_in_months required for repeating promos', code: 'invalid_duration' }, 400);
    }
    couponForm.duration_in_months = String(months);
  }

  // Product allow-list.
  const productIds = Array.isArray(body.product_ids)
    ? (body.product_ids as unknown[]).filter((x): x is string => typeof x === 'string')
    : [];
  for (const pid of productIds) {
    if (!PRODUCT_RE.test(pid)) {
      return c.json({ error: `invalid product id: ${pid}`, code: 'invalid_product' }, 400);
    }
  }
  productIds.forEach((pid, i) => {
    couponForm[`applies_to[products][${i}]`] = pid;
  });
  couponForm['metadata[product_ids]'] = JSON.stringify(productIds);
  couponForm['metadata[created_by]'] = String(admin.id);
  couponForm.name = rawCode;

  // Usage limit + expiry live on the Promotion Code.
  let maxRedemptions: number | null = null;
  if (body.max_redemptions != null) {
    const n = Number(body.max_redemptions);
    if (!Number.isInteger(n) || n <= 0) {
      return c.json({ error: 'max_redemptions must be a positive integer', code: 'invalid_max' }, 400);
    }
    maxRedemptions = n;
  }
  let expiresAtIso: string | null = null;
  let expiresAtEpoch: number | null = null;
  if (body.expires_at != null && body.expires_at !== '') {
    const t = new Date(body.expires_at as string).getTime();
    if (!Number.isFinite(t) || t <= Date.now()) {
      return c.json({ error: 'expires_at must be a future date', code: 'invalid_expiry' }, 400);
    }
    expiresAtIso = new Date(t).toISOString();
    expiresAtEpoch = Math.floor(t / 1000);
  }

  // 1) Coupon.
  let coupon: StripeCoupon;
  try {
    coupon = await stripeCall<StripeCoupon>(c.env, '/coupons', couponForm);
  } catch (e) {
    const { body: eb, status } = stripeErr(e);
    return c.json(eb, status);
  }

  // 2) Promotion Code (the redeemable string).
  const promoForm: Record<string, string> = {
    coupon: coupon.id,
    code: rawCode,
    'metadata[product_ids]': JSON.stringify(productIds),
  };
  if (maxRedemptions != null) promoForm.max_redemptions = String(maxRedemptions);
  if (expiresAtEpoch != null) promoForm.expires_at = String(expiresAtEpoch);

  let promo: StripePromotionCode;
  try {
    promo = await stripeCall<StripePromotionCode>(c.env, '/promotion_codes', promoForm);
  } catch (e) {
    // Coupon was created but the promotion code failed — clean up the orphan
    // coupon so a retry with the same code doesn't accrete dead coupons.
    try {
      await stripeCall(c.env, `/coupons/${coupon.id}`, {}, { method: 'DELETE' });
    } catch { /* best-effort */ }
    const { body: eb, status } = stripeErr(e);
    return c.json(eb, status);
  }

  await mirrorPromo(c.env, {
    id: promo.id,
    code: promo.code || rawCode,
    coupon_id: coupon.id,
    percent_off: percentOff,
    amount_off: amountOff,
    currency,
    duration,
    product_ids: productIds,
    max_redemptions: maxRedemptions,
    times_redeemed: 0,
    active: promo.active !== false,
    expires_at: expiresAtIso,
    created_by: admin.id,
  });

  await audit(c.env, admin.id, 'promo_create', {
    promo_id: promo.id,
    coupon_id: coupon.id,
    code: rawCode,
    type,
    percent_off: percentOff,
    amount_off: amountOff,
    currency,
    product_ids: productIds,
    max_redemptions: maxRedemptions,
    expires_at: expiresAtIso,
  });

  return c.json({ ok: true, promo_id: promo.id, code: rawCode });
});

// PATCH /api/admin/promos/:id — toggle active (enable/disable redemption).
adminPromos.patch('/:id', async (c) => {
  await requireFactor(c, 'totp');
  await requireStepUp(c);
  const admin = await requireAdmin(c);
  if (!c.env.STRIPE_SECRET_KEY) {
    return c.json({ error: 'Stripe is not configured', code: 'stripe_not_configured' }, 503);
  }
  const id = c.req.param('id');
  const existing = await getPromoById(c.env, id);
  if (!existing) return c.json({ error: 'Promo not found', code: 'not_found' }, 404);

  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  if (typeof body.active !== 'boolean') {
    return c.json({ error: 'active (boolean) is required', code: 'invalid_active' }, 400);
  }
  try {
    await stripeCall(c.env, `/promotion_codes/${id}`, { active: String(body.active) });
  } catch (e) {
    const { body: eb, status } = stripeErr(e);
    return c.json(eb, status);
  }
  await setPromoActiveMirror(c.env, id, body.active);
  await audit(c.env, admin.id, 'promo_update', { promo_id: id, active: body.active });
  return c.json({ ok: true, promo_id: id, active: body.active });
});

// DELETE /api/admin/promos/:id — Stripe Promotion Codes CANNOT be deleted, so
// "delete" = deactivate the promotion code AND delete the backing coupon
// (best-effort) so it can never be redeemed again.
adminPromos.delete('/:id', async (c) => {
  await requireFactor(c, 'totp');
  await requireStepUp(c);
  const admin = await requireAdmin(c);
  if (!c.env.STRIPE_SECRET_KEY) {
    return c.json({ error: 'Stripe is not configured', code: 'stripe_not_configured' }, 503);
  }
  const id = c.req.param('id');
  const existing = await getPromoById(c.env, id);
  if (!existing) return c.json({ error: 'Promo not found', code: 'not_found' }, 404);

  try {
    await stripeCall(c.env, `/promotion_codes/${id}`, { active: 'false' });
  } catch (e) {
    const { body: eb, status } = stripeErr(e);
    return c.json(eb, status);
  }
  // Deleting the coupon also disables the promotion code permanently; ignore
  // errors (already-deleted coupon, etc.) — the deactivation above is the
  // authoritative kill-switch.
  try {
    await stripeCall(c.env, `/coupons/${existing.coupon_id}`, {}, { method: 'DELETE' });
  } catch { /* best-effort coupon delete */ }
  await setPromoActiveMirror(c.env, id, false);
  await audit(c.env, admin.id, 'promo_delete', { promo_id: id, coupon_id: existing.coupon_id });
  return c.json({ ok: true, promo_id: id });
});

export default adminPromos;
