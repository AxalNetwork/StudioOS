import { Hono, type Context } from 'hono';
import type { Env } from '../types';
import { requireAuth } from '../auth';
import { stripeCall } from './billing';
import { ensureTierSchema, type TierUser } from '../middleware/requireTier';
import { findCatalogPriceById, findCatalogProductByPriceId } from '../services/catalog';
import { ensureFeatureUnlockSchema, listActiveUnlocks } from '../services/featureUnlocks';
import {
  validatePromoForProduct,
  fulfilFreeUnlock,
  computeDiscount,
  normalizeCode,
  STRIPE_MIN_CHARGE_CENTS,
  type PromoRow,
} from '../services/promos';
import { captureAndResolveAttribution, readRefCookie } from '../services/referralAttribution';

// PaymentIntent + SetupIntent surface for the Axal-branded embedded card UI.
//
//   POST   /api/payments/intent        { price_id? , amount? , currency? , quantity? , nonce? }
//                                       → { client_secret, kind, ... }
//   POST   /api/payments/setup-intent  → { client_secret, customer }
//   GET    /api/payments/methods       → { methods: [...] }
//   DELETE /api/payments/methods/:id   → { detached: true }
//
// All four endpoints are server-side and reuse the `stripeCall` wrapper so the
// Stripe secret key never reaches the client. Card capture happens via Stripe
// Elements / PaymentIntents in the SPA (PCI scope stays SAQ A); the worker only
// ever hands back a `client_secret`.

const payments = new Hono<{ Bindings: Env }>();

// Stripe minimum charge is 50 cents (or local equivalent). We don't enforce the
// per-currency table here — Stripe rejects sub-minimum amounts itself — but we
// reject obviously-invalid (non-positive / non-integer) amounts up front.
const MAX_RAW_AMOUNT = 100_000_00; // $100k in cents — sanity cap on raw amounts.

/**
 * Resolve (creating if necessary) the Stripe customer for the authenticated
 * user, persisting the id onto `users.stripe_customer_id`. PaymentIntents,
 * SetupIntents and saved-card listing all require a customer so the card can be
 * attached and reused across the user's purchases.
 */
export async function ensurePaymentsCustomer(env: Env, user: TierUser): Promise<string> {
  if (user.stripe_customer_id) return user.stripe_customer_id;
  const customer = await stripeCall<{ id: string }>(env, '/customers', {
    email: user.email,
    name: user.name || user.email,
    'metadata[user_id]': String(user.id),
    'metadata[uid]': user.uid,
  });
  await env.DB.prepare('UPDATE users SET stripe_customer_id = ? WHERE id = ?')
    .bind(customer.id, user.id)
    .run();
  return customer.id;
}

/** Sanitise the caller-supplied nonce so it can't break the idempotency key. */
function safeNonce(raw: unknown): string {
  if (typeof raw === 'string' && raw.length > 0) {
    return raw.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64) || crypto.randomUUID();
  }
  return crypto.randomUUID();
}

interface IntentBody {
  price_id?: string;
  amount?: number;
  currency?: string;
  quantity?: number;
  nonce?: string;
  description?: string;
  promo_code?: string;
}

/**
 * Idempotency-key fragment for a promo code. Applying/removing a promo MUST
 * change the key so Stripe doesn't replay the pre-discount intent for 24h.
 */
function promoIdemPart(code?: string): string {
  if (!code) return 'none';
  return normalizeCode(code).replace(/[^A-Z0-9_-]/g, '').slice(0, 64) || 'none';
}

payments.post('/intent', async (c) => {
  const user = (await requireAuth(c)) as TierUser;
  await ensureTierSchema(c.env);
  if (!c.env.STRIPE_SECRET_KEY) return c.json({ error: 'stripe_not_configured' }, 503);

  const body = (await c.req.json().catch(() => ({}))) as IntentBody;
  const quantity = Number.isFinite(body.quantity) && (body.quantity as number) > 0
    ? Math.floor(body.quantity as number)
    : 1;
  const nonce = safeNonce(body.nonce);
  const customer = await ensurePaymentsCustomer(c.env, user);

  // ---- Price-driven path: resolve the SKU from the mirrored catalog. -------
  if (body.price_id) {
    const price = await findCatalogPriceById(c.env, body.price_id);
    if (!price || !price.active) return c.json({ error: 'invalid_price' }, 400);

    // Optional promo code — validated server-side against the product
    // allow-list (NEVER trust a client-supplied amount). On failure we return
    // the rejection reason so the SPA can render a precise message.
    const promoCode = typeof body.promo_code === 'string' ? body.promo_code.trim() : '';
    let promo: PromoRow | undefined;
    if (promoCode) {
      const found = await findCatalogProductByPriceId(c.env, price.id);
      if (!found) return c.json({ error: 'invalid_price' }, 400);
      const v = await validatePromoForProduct(
        c.env,
        promoCode,
        found.product.id,
        price.unit_amount ?? 0,
        price.currency,
      );
      if (!v.ok) return c.json({ error: 'promo_invalid', reason: v.reason }, 400);
      promo = v.promo;
    }
    const idempotencyKey = `pi:${user.id}:${price.id}:${promoIdemPart(promoCode)}:${nonce}`;

    // Recurring price → create an incomplete Subscription and hand back the
    // first invoice's PaymentIntent client_secret. The SPA confirms the card
    // against that secret; the webhook flips the subscription active.
    if (price.type === 'recurring') {
      const subParams: Record<string, string> = {
        customer,
        'items[0][price]': price.id,
        'items[0][quantity]': String(quantity),
        payment_behavior: 'default_incomplete',
        'payment_settings[save_default_payment_method]': 'on_subscription',
        'expand[0]': 'latest_invoice.payment_intent',
        'metadata[user_id]': String(user.id),
        'metadata[uid]': user.uid,
        'metadata[price_id]': price.id,
      };
      // Subscriptions redeem the promotion code NATIVELY — Stripe applies the
      // coupon per its `duration` and enforces applies_to[products] itself.
      if (promo) {
        subParams['discounts[0][promotion_code]'] = promo.id;
        subParams['metadata[promo_code_id]'] = promo.id;
      }
      try {
        const sub = await stripeCall<{
          id: string;
          status: string;
          latest_invoice?: { id?: string; payment_intent?: { client_secret?: string; id?: string } };
        }>(c.env, '/subscriptions', subParams, { idempotencyKey });
        const clientSecret = sub.latest_invoice?.payment_intent?.client_secret;
        if (!clientSecret) {
          // A 100%-off (or otherwise zero-due) first invoice has NO
          // PaymentIntent — the subscription is already active/trialing. Treat
          // it as a successful free activation rather than an error.
          if (sub.status === 'active' || sub.status === 'trialing') {
            return c.json({
              kind: 'subscription',
              free: true,
              subscription_id: sub.id,
              status: sub.status,
              customer,
              price_id: price.id,
            });
          }
          return c.json({ error: 'no_client_secret' }, 502);
        }
        return c.json({
          kind: 'subscription',
          client_secret: clientSecret,
          subscription_id: sub.id,
          status: sub.status,
          customer,
          price_id: price.id,
        });
      } catch (e) {
        return c.json({ error: 'intent_failed', detail: (e as Error).message }, 502);
      }
    }

    // One-time price → PaymentIntent for unit_amount * quantity.
    if (price.unit_amount == null) return c.json({ error: 'price_has_no_amount' }, 400);
    let amount = price.unit_amount * quantity;
    const metadata: Record<string, string> = { price_id: price.id };
    if (promo) {
      // One-time PaymentIntents can't carry a coupon — recompute the discount
      // from the catalog amount and stamp the promo id so the webhook records
      // the redemption. This generic one-time path has NO fulfilment hook, so a
      // free (sub-minimum) result has nothing to grant → reject explicitly.
      const { discountedAmount } = computeDiscount(promo, amount);
      if (discountedAmount < STRIPE_MIN_CHARGE_CENTS) {
        return c.json({ error: 'promo_amount_below_minimum', reason: 'amount_below_minimum' }, 400);
      }
      amount = discountedAmount;
      metadata.promo_code_id = promo.id;
    }
    return createPaymentIntent(c, {
      customer,
      amount,
      currency: price.currency,
      idempotencyKey,
      user,
      metadata,
      description: body.description,
    });
  }

  // ---- Raw amount path: ad-hoc one-time charge (always a PaymentIntent). ----
  // Raw amounts have no catalog product to scope a promo's allow-list against,
  // so reject any promo here rather than silently ignoring it.
  if (typeof body.promo_code === 'string' && body.promo_code.trim()) {
    return c.json({ error: 'promo_not_supported_for_raw_amount', reason: 'raw_amount' }, 400);
  }
  const rawAmount = body.amount;
  if (!Number.isInteger(rawAmount) || (rawAmount as number) <= 0) {
    return c.json({ error: 'invalid_amount' }, 400);
  }
  if ((rawAmount as number) > MAX_RAW_AMOUNT) return c.json({ error: 'amount_too_large' }, 400);
  const currency = (typeof body.currency === 'string' && body.currency.trim())
    ? body.currency.trim().toLowerCase()
    : 'usd';
  const amount = (rawAmount as number) * quantity;
  const idempotencyKey = `pi:${user.id}:raw_${amount}_${currency}:${nonce}`;
  return createPaymentIntent(c, {
    customer,
    amount,
    currency,
    idempotencyKey,
    user,
    metadata: {},
    description: body.description,
  });
});

/** Shared one-time PaymentIntent creation. */
async function createPaymentIntent(
  c: Context<{ Bindings: Env }>,
  args: {
    customer: string;
    amount: number;
    currency: string;
    idempotencyKey: string;
    user: TierUser;
    metadata: Record<string, string>;
    description?: string;
  },
) {
  const params: Record<string, string> = {
    customer: args.customer,
    amount: String(args.amount),
    currency: args.currency,
    'automatic_payment_methods[enabled]': 'true',
    setup_future_usage: 'off_session',
    'metadata[user_id]': String(args.user.id),
    'metadata[uid]': args.user.uid,
  };
  for (const [k, v] of Object.entries(args.metadata)) params[`metadata[${k}]`] = v;

  // Task #8 — universal referral attribution. Resolve the buyer's first-touch
  // referral (from the `axal_ref` cookie / prior touch) and stamp it onto the
  // PaymentIntent so the webhook can pay a commission on ANY sold SKU. This is
  // best-effort: a missing/expired/self attribution simply leaves the PI
  // unattributed and never blocks the charge.
  const attribution = await captureAndResolveAttribution(
    c.env,
    args.user.id,
    readRefCookie(c.req.header('Cookie')),
  );
  if (attribution) {
    params['metadata[referral_code]'] = attribution.referralCode;
    params['metadata[referrer_user_id]'] = String(attribution.referrerUserId);
  }
  if (args.description) params.description = args.description.slice(0, 500);
  try {
    const intent = await stripeCall<{ id: string; client_secret: string; status: string }>(
      c.env,
      '/payment_intents',
      params,
      { idempotencyKey: args.idempotencyKey },
    );
    return c.json({
      kind: 'payment',
      client_secret: intent.client_secret,
      payment_intent_id: intent.id,
      status: intent.status,
      customer: args.customer,
      amount: args.amount,
      currency: args.currency,
    });
  } catch (e) {
    return c.json({ error: 'intent_failed', detail: (e as Error).message }, 502);
  }
}

// POST /api/payments/promo/validate { code, price_id } → preview only.
// Auth'd + rate-limited (see middleware/rateLimit.ts `promo_validate` bucket)
// so the code space can't be enumerated. Returns 200 with { valid:false,
// reason } on rejection so the SPA can render a friendly message; never applies
// or reserves anything.
payments.post('/promo/validate', async (c) => {
  await requireAuth(c);
  if (!c.env.STRIPE_SECRET_KEY) return c.json({ error: 'stripe_not_configured' }, 503);
  const body = (await c.req.json().catch(() => ({}))) as { code?: string; price_id?: string };
  const code = typeof body.code === 'string' ? body.code.trim() : '';
  if (!code) return c.json({ valid: false, reason: 'not_found' });
  if (!body.price_id) return c.json({ error: 'price_id_required' }, 400);
  const found = await findCatalogProductByPriceId(c.env, body.price_id);
  if (!found || !found.price.active || !found.product.active) {
    return c.json({ error: 'invalid_price' }, 400);
  }
  const amount = found.price.unit_amount ?? 0;
  const v = await validatePromoForProduct(c.env, code, found.product.id, amount, found.price.currency);
  if (!v.ok || !v.promo) return c.json({ valid: false, reason: v.reason });
  return c.json({
    valid: true,
    code: v.promo.code,
    percent_off: v.promo.percent_off,
    amount_off: v.promo.amount_off,
    currency: v.promo.currency,
    original_amount: amount,
    discount_cents: v.discountCents,
    discounted_amount: v.discountedAmount,
    free: v.free,
  });
});

payments.post('/setup-intent', async (c) => {
  const user = (await requireAuth(c)) as TierUser;
  await ensureTierSchema(c.env);
  if (!c.env.STRIPE_SECRET_KEY) return c.json({ error: 'stripe_not_configured' }, 503);
  const customer = await ensurePaymentsCustomer(c.env, user);
  const body = (await c.req.json().catch(() => ({}))) as { nonce?: string };
  const nonce = safeNonce(body.nonce);
  try {
    const intent = await stripeCall<{ id: string; client_secret: string; status: string }>(
      c.env,
      '/setup_intents',
      {
        customer,
        usage: 'off_session',
        'payment_method_types[0]': 'card',
        'metadata[user_id]': String(user.id),
        'metadata[uid]': user.uid,
      },
      { idempotencyKey: `si:${user.id}:${nonce}` },
    );
    return c.json({
      client_secret: intent.client_secret,
      setup_intent_id: intent.id,
      status: intent.status,
      customer,
    });
  } catch (e) {
    return c.json({ error: 'setup_intent_failed', detail: (e as Error).message }, 502);
  }
});

interface StripePaymentMethod {
  id: string;
  card?: { brand?: string; last4?: string; exp_month?: number; exp_year?: number };
  created: number;
}

payments.get('/methods', async (c) => {
  const user = (await requireAuth(c)) as TierUser;
  await ensureTierSchema(c.env);
  if (!c.env.STRIPE_SECRET_KEY) return c.json({ error: 'stripe_not_configured' }, 503);
  // No customer yet → no saved cards. Don't create one just to list nothing.
  if (!user.stripe_customer_id) return c.json({ methods: [] });
  try {
    const res = await stripeCall<{ data: StripePaymentMethod[] }>(
      c.env,
      '/payment_methods',
      { customer: user.stripe_customer_id, type: 'card', limit: '100' },
      { method: 'GET' },
    );
    const methods = (res.data ?? []).map((pm) => ({
      id: pm.id,
      brand: pm.card?.brand ?? null,
      last4: pm.card?.last4 ?? null,
      exp_month: pm.card?.exp_month ?? null,
      exp_year: pm.card?.exp_year ?? null,
      created: pm.created,
    }));
    return c.json({ methods });
  } catch (e) {
    return c.json({ error: 'methods_failed', detail: (e as Error).message }, 502);
  }
});

payments.delete('/methods/:id', async (c) => {
  const user = (await requireAuth(c)) as TierUser;
  await ensureTierSchema(c.env);
  if (!c.env.STRIPE_SECRET_KEY) return c.json({ error: 'stripe_not_configured' }, 503);
  const id = c.req.param('id');
  if (!id || !/^pm_[A-Za-z0-9]+$/.test(id)) return c.json({ error: 'invalid_id' }, 400);
  if (!user.stripe_customer_id) return c.json({ error: 'not_found' }, 404);
  try {
    // Ownership check — only detach a payment method that belongs to THIS
    // user's customer, so one user can't delete another's saved card.
    const pm = await stripeCall<{ id: string; customer?: string | null }>(
      c.env,
      `/payment_methods/${id}`,
      {},
      { method: 'GET' },
    );
    if (pm.customer !== user.stripe_customer_id) return c.json({ error: 'not_found' }, 404);
    await stripeCall(c.env, `/payment_methods/${id}/detach`, {});
    return c.json({ detached: true, id });
  } catch (e) {
    return c.json({ error: 'detach_failed', detail: (e as Error).message }, 502);
  }
});

// ---------------------------------------------------------------------------
// Task #7 — À la carte feature unlocks.
//
//   POST /api/payments/alacarte/intent  { price_id, nonce? } → { client_secret, ... }
//   GET  /api/payments/alacarte/unlocks → { unlocks: [{ feature_key, expires_at }] }
//
// An à la carte SKU is a Stripe Product with metadata.kind='alacarte' and a
// metadata.feature_key (plus optional metadata.unlock_days). Buying it creates a
// one-time PaymentIntent carrying that metadata; the billing webhook
// (payment_intent.succeeded, kind='alacarte') writes the `feature_unlocks` row
// that feature gates read. No Connect transfer — these are platform-owned SKUs.
// ---------------------------------------------------------------------------
payments.post('/alacarte/intent', async (c) => {
  const user = (await requireAuth(c)) as TierUser;
  await ensureTierSchema(c.env);
  if (!c.env.STRIPE_SECRET_KEY) return c.json({ error: 'stripe_not_configured' }, 503);

  const body = (await c.req.json().catch(() => ({}))) as {
    price_id?: string;
    nonce?: string;
    promo_code?: string;
  };
  if (!body.price_id) return c.json({ error: 'price_id_required' }, 400);

  const found = await findCatalogProductByPriceId(c.env, body.price_id);
  if (!found || !found.price.active || !found.product.active) {
    return c.json({ error: 'invalid_price' }, 400);
  }
  if (found.product.kind !== 'alacarte') return c.json({ error: 'not_alacarte' }, 400);
  if (found.price.type !== 'one_time' || found.price.unit_amount == null) {
    return c.json({ error: 'price_not_one_time' }, 400);
  }
  const featureKey = (found.product.metadata.feature_key || '').trim();
  if (!featureKey) return c.json({ error: 'feature_key_missing' }, 400);
  // unlock_days: positive int → time-bounded; absent/0 → permanent.
  const rawDays = Number(found.product.metadata.unlock_days);
  const unlockDays = Number.isFinite(rawDays) && rawDays > 0 ? String(Math.floor(rawDays)) : '0';

  // Optional promo code — validated against THIS product's allow-list.
  const promoCode = typeof body.promo_code === 'string' ? body.promo_code.trim() : '';
  let promo: PromoRow | undefined;
  let amount = found.price.unit_amount;
  if (promoCode) {
    const v = await validatePromoForProduct(
      c.env,
      promoCode,
      found.product.id,
      found.price.unit_amount,
      found.price.currency,
    );
    if (!v.ok || !v.promo) return c.json({ error: 'promo_invalid', reason: v.reason }, 400);
    promo = v.promo;
    if (v.free) {
      // 100%-off / sub-minimum → no PaymentIntent. Grant the unlock directly
      // (idempotent per user, usage-capped). `false` means the global usage
      // limit was exhausted between validate and reserve.
      const granted = await fulfilFreeUnlock(c.env, {
        promo,
        userId: user.id,
        featureKey,
        unlockDays: unlockDays === '0' ? null : Number(unlockDays),
      });
      if (!granted) return c.json({ error: 'promo_invalid', reason: 'usage_limit_reached' }, 400);
      return c.json({ kind: 'payment', free: true, feature_key: featureKey });
    }
    amount = v.discountedAmount!;
  }

  const nonce = safeNonce(body.nonce);
  const customer = await ensurePaymentsCustomer(c.env, user);
  const metadata: Record<string, string> = {
    kind: 'alacarte',
    feature_key: featureKey,
    unlock_days: unlockDays,
    price_id: found.price.id,
  };
  if (promo) metadata.promo_code_id = promo.id;
  return createPaymentIntent(c, {
    customer,
    amount,
    currency: found.price.currency,
    idempotencyKey: `pi:${user.id}:alacarte_${found.price.id}:${promoIdemPart(promoCode)}:${nonce}`,
    user,
    metadata,
    description: `À la carte: ${found.product.name}`.slice(0, 500),
  });
});

payments.get('/alacarte/unlocks', async (c) => {
  const user = (await requireAuth(c)) as TierUser;
  await ensureFeatureUnlockSchema(c.env);
  const unlocks = await listActiveUnlocks(c.env, user.id);
  return c.json({ unlocks });
});

export default payments;
