import { Hono, type Context } from 'hono';
import type { Env } from '../types';
import { requireAuth } from '../auth';
import { stripeCall } from './billing';
import { ensureTierSchema, type TierUser } from '../middleware/requireTier';
import { findCatalogPriceById } from '../services/catalog';

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
async function ensurePaymentsCustomer(env: Env, user: TierUser): Promise<string> {
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
    const idempotencyKey = `pi:${user.id}:${price.id}:${nonce}`;

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
      try {
        const sub = await stripeCall<{
          id: string;
          status: string;
          latest_invoice?: { id?: string; payment_intent?: { client_secret?: string; id?: string } };
        }>(c.env, '/subscriptions', subParams, { idempotencyKey });
        const clientSecret = sub.latest_invoice?.payment_intent?.client_secret;
        if (!clientSecret) return c.json({ error: 'no_client_secret' }, 502);
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
    const amount = price.unit_amount * quantity;
    return createPaymentIntent(c, {
      customer,
      amount,
      currency: price.currency,
      idempotencyKey,
      user,
      metadata: { price_id: price.id },
      description: body.description,
    });
  }

  // ---- Raw amount path: ad-hoc one-time charge (always a PaymentIntent). ----
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

export default payments;
