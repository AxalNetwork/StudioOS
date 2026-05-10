import { Hono } from 'hono';
import type { Env, User } from '../types';
import { requireAuth, requireFactor } from '../auth';
import { ensureMiPaywallSchema, MI_PRO_PRODUCTS, userHasMiPro } from '../middleware/miAccess';
import { ensureTierSchema, type TierUser } from '../middleware/requireTier';
import {
  ensureInvestorPaywallSchema,
  effectiveInvestorTier,
  INVESTOR_QUOTAS,
  type InvestorTier,
  type InvestorUser,
} from '../middleware/requireInvestorTier';
import { upsertPlanFromStripeSubscription } from '../services/subscriptionPlans';

// Epic 6 — Market Intel Pro billing surface.
//
//   POST /api/billing/mi-pro/checkout   { plan: 'mi_pro_monthly' | 'mi_pro_annual' }
//   POST /api/billing/mi-pro/portal     → Stripe Customer Portal session
//   GET  /api/billing/mi-pro/status     → { status, plan, period_end, products }
//   POST /api/billing/mi-pro/dev-upgrade { plan }   (dev-only — no Stripe key)
//   POST /api/billing/stripe/webhook    Stripe event sink (no auth)
//
// In dev / when STRIPE_SECRET_KEY is unset, /checkout returns a dev URL that
// hits /dev-upgrade so the frontend flow is testable without real Stripe.

const billing = new Hono<{ Bindings: Env }>();

interface MiUserCols {
  mi_subscription_status?: string | null;
  mi_subscription_id?: string | null;
  mi_subscription_plan?: string | null;
  mi_subscription_period_end?: string | null;
  mi_stripe_customer_id?: string | null;
}
type MiUser = User & MiUserCols;

const PLAN_TO_PRICE_ENV: Record<string, keyof Env> = {
  mi_pro_monthly: 'STRIPE_PRICE_MI_PRO_MONTHLY' as keyof Env,
  mi_pro_annual:  'STRIPE_PRICE_MI_PRO_ANNUAL'  as keyof Env,
};

function isValidPlan(p: unknown): p is 'mi_pro_monthly' | 'mi_pro_annual' {
  return p === 'mi_pro_monthly' || p === 'mi_pro_annual';
}

async function stripeCall<T>(env: Env, path: string, body: Record<string, string>): Promise<T> {
  const key = env.STRIPE_SECRET_KEY;
  if (!key) throw new Error('stripe_not_configured');
  const form = new URLSearchParams(body);
  const res = await fetch(`https://api.stripe.com/v1${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: form.toString(),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`stripe_error:${res.status}:${text.slice(0, 200)}`);
  }
  return (await res.json()) as T;
}

billing.post('/mi-pro/checkout', async (c) => {
  // Task #6 — billing changes are step-up: SMS-only sessions are denied
  // and must re-authenticate with TOTP before they can mint a Stripe
  // Checkout session.
  await requireFactor(c, 'totp');
  const user = (await requireAuth(c)) as MiUser;
  await ensureMiPaywallSchema(c.env);
  const body = await c.req.json().catch(() => ({} as { plan?: string }));
  const plan = body.plan;
  if (!isValidPlan(plan)) return c.json({ error: 'invalid_plan' }, 400);

  const stripeKey = c.env.STRIPE_SECRET_KEY;
  const priceEnvKey = PLAN_TO_PRICE_ENV[plan];
  // Cast through `unknown` because the `Env` type doesn't carry an index
  // signature for these dynamically-named price-id vars (STRIPE_PRICE_*).
  // Going via `unknown` is the TS-recommended escape hatch when two types
  // don't sufficiently overlap. (Epic 11 — needed to keep `tsc --noEmit`
  // green so the new CI lint gate stays green on day 1.)
  const priceId = (c.env as unknown as Record<string, unknown>)[priceEnvKey] as string | undefined;
  const appUrl = c.env.APP_URL || 'http://localhost:5000';

  // Dev fallback — no Stripe configured. Return a URL to the dev-upgrade
  // endpoint so the UI flow is testable without real payment rails.
  if (!stripeKey || !priceId) {
    return c.json({
      url: `${appUrl}/api/billing/mi-pro/dev-upgrade?plan=${plan}`,
      dev: true,
    });
  }

  const params: Record<string, string> = {
    mode: 'subscription',
    'line_items[0][price]': priceId,
    'line_items[0][quantity]': '1',
    success_url: `${appUrl}/market-intel?upgraded=1`,
    cancel_url: `${appUrl}/market-intel?upgrade_cancelled=1`,
    'metadata[user_id]': String(user.id),
    'metadata[plan]': plan,
    client_reference_id: String(user.id),
  };
  if (user.mi_stripe_customer_id) {
    params.customer = user.mi_stripe_customer_id;
  } else {
    params.customer_email = user.email;
  }

  try {
    const session = await stripeCall<{ url: string; id: string }>(c.env, '/checkout/sessions', params);
    return c.json({ url: session.url, session_id: session.id });
  } catch (e) {
    return c.json({ error: 'checkout_failed', detail: (e as Error).message }, 502);
  }
});

billing.post('/mi-pro/portal', async (c) => {
  // Task #6 — Stripe Customer Portal is the cancel/upgrade surface; gate
  // it on TOTP step-up so a stolen SMS factor can never reach billing.
  await requireFactor(c, 'totp');
  const user = (await requireAuth(c)) as MiUser;
  if (!user.mi_stripe_customer_id) return c.json({ error: 'no_subscription' }, 400);
  const appUrl = c.env.APP_URL || 'http://localhost:5000';
  try {
    const session = await stripeCall<{ url: string }>(c.env, '/billing_portal/sessions', {
      customer: user.mi_stripe_customer_id,
      return_url: `${appUrl}/market-intel`,
    });
    return c.json({ url: session.url });
  } catch (e) {
    return c.json({ error: 'portal_failed', detail: (e as Error).message }, 502);
  }
});

billing.get('/mi-pro/status', async (c) => {
  const user = (await requireAuth(c)) as MiUser;
  await ensureMiPaywallSchema(c.env);
  return c.json({
    status: user.mi_subscription_status ?? 'free',
    plan: user.mi_subscription_plan ?? null,
    period_end: user.mi_subscription_period_end ?? null,
    is_pro: userHasMiPro(user),
    products: MI_PRO_PRODUCTS,
  });
});

// Dev-only: flip the user to active Pro without a real Stripe round-trip.
// 404s when STRIPE_SECRET_KEY is set so prod can't accidentally expose this.
billing.all('/mi-pro/dev-upgrade', async (c) => {
  const stripeKey = c.env.STRIPE_SECRET_KEY;
  if (stripeKey) return c.json({ error: 'not_found' }, 404);
  const user = (await requireAuth(c)) as MiUser;
  await ensureMiPaywallSchema(c.env);
  const url = new URL(c.req.url);
  const plan = url.searchParams.get('plan') ?? 'mi_pro_monthly';
  if (!isValidPlan(plan)) return c.json({ error: 'invalid_plan' }, 400);
  const periodEnd = new Date(Date.now() + 30 * 86400 * 1000).toISOString();
  await c.env.DB.prepare(
    `UPDATE users SET mi_subscription_status = 'active',
                       mi_subscription_plan = ?,
                       mi_subscription_period_end = ?
     WHERE id = ?`
  ).bind(plan, periodEnd, user.id).run();
  // For browser-initiated flows (the dev checkout URL is opened in a new tab),
  // redirect back to the app instead of returning JSON.
  if (c.req.method === 'GET') {
    const appUrl = c.env.APP_URL || 'http://localhost:5000';
    return c.redirect(`${appUrl}/market-intel?upgraded=1`);
  }
  return c.json({ ok: true, status: 'active', plan, period_end: periodEnd });
});

// ---------------------------------------------------------------------------
// Task #6 — Founder subscription tier checkout / portal / dev-upgrade.
// Distinct customer + subscription columns from MI Pro so a founder can hold
// both a Tier sub (Growth/Studio) and an MI Pro sub side-by-side.
// ---------------------------------------------------------------------------

const TIER_PRICE_ENV: Record<string, keyof Env> = {
  growth: 'STRIPE_PRICE_GROWTH' as keyof Env,
  studio: 'STRIPE_PRICE_STUDIO' as keyof Env,
};

function isValidTier(t: unknown): t is 'growth' | 'studio' {
  return t === 'growth' || t === 'studio';
}

billing.post('/tier/checkout', async (c) => {
  const user = (await requireAuth(c)) as TierUser;
  await ensureTierSchema(c.env);
  const body = await c.req.json().catch(() => ({} as { tier?: string }));
  const tier = body.tier;
  if (!isValidTier(tier)) return c.json({ error: 'invalid_tier' }, 400);

  const stripeKey = c.env.STRIPE_SECRET_KEY;
  const priceEnvKey = TIER_PRICE_ENV[tier];
  const priceId = (c.env as unknown as Record<string, unknown>)[priceEnvKey] as string | undefined;
  const appUrl = c.env.APP_URL || 'http://localhost:5000';

  // Dev fallback — no Stripe configured. Mirrors mi-pro/dev-upgrade.
  if (!stripeKey || !priceId) {
    return c.json({
      url: `${appUrl}/api/billing/tier/dev-upgrade?tier=${tier}`,
      dev: true,
    });
  }

  const params: Record<string, string> = {
    mode: 'subscription',
    'line_items[0][price]': priceId,
    'line_items[0][quantity]': '1',
    success_url: `${appUrl}/settings?tab=billing&upgraded=1`,
    cancel_url: `${appUrl}/settings?tab=billing&upgrade_cancelled=1`,
    'metadata[user_id]': String(user.id),
    'metadata[tier]': tier,
    'metadata[kind]': 'tier',                     // disambiguates from MI Pro in webhook
    client_reference_id: `tier:${user.id}`,
  };
  if (user.stripe_customer_id) {
    params.customer = user.stripe_customer_id;
  } else {
    params.customer_email = user.email;
  }

  try {
    const session = await stripeCall<{ url: string; id: string }>(c.env, '/checkout/sessions', params);
    return c.json({ url: session.url, session_id: session.id });
  } catch (e) {
    return c.json({ error: 'checkout_failed', detail: (e as Error).message }, 502);
  }
});

billing.post('/tier/portal', async (c) => {
  const user = (await requireAuth(c)) as TierUser;
  if (!user.stripe_customer_id) return c.json({ error: 'no_subscription' }, 400);
  const appUrl = c.env.APP_URL || 'http://localhost:5000';
  try {
    const session = await stripeCall<{ url: string }>(c.env, '/billing_portal/sessions', {
      customer: user.stripe_customer_id,
      return_url: `${appUrl}/settings?tab=billing`,
    });
    return c.json({ url: session.url });
  } catch (e) {
    return c.json({ error: 'portal_failed', detail: (e as Error).message }, 502);
  }
});

billing.get('/tier/status', async (c) => {
  const user = (await requireAuth(c)) as TierUser;
  await ensureTierSchema(c.env);
  return c.json({
    tier: user.subscription_tier || 'free',
    status: user.subscription_status || 'active',
    renews_at: user.subscription_renews_at || null,
    has_customer: !!user.stripe_customer_id,
  });
});

billing.all('/tier/dev-upgrade', async (c) => {
  if (c.env.STRIPE_SECRET_KEY) return c.json({ error: 'not_found' }, 404);
  const user = (await requireAuth(c)) as TierUser;
  await ensureTierSchema(c.env);
  const url = new URL(c.req.url);
  const tier = url.searchParams.get('tier') ?? 'growth';
  if (!isValidTier(tier)) return c.json({ error: 'invalid_tier' }, 400);
  const renewsAt = new Date(Date.now() + 30 * 86400 * 1000).toISOString();
  await c.env.DB.prepare(
    `UPDATE users SET subscription_tier = ?, subscription_status = 'active',
                       subscription_renews_at = ?
     WHERE id = ?`,
  ).bind(tier, renewsAt, user.id).run();
  if (c.req.method === 'GET') {
    const appUrl = c.env.APP_URL || 'http://localhost:5000';
    return c.redirect(`${appUrl}/settings?tab=billing&upgraded=1`);
  }
  return c.json({ ok: true, tier, renews_at: renewsAt });
});

// ---------------------------------------------------------------------------
// Task #6 (W-1) — Investor paywall checkout / portal / status / dev-upgrade.
// Distinct customer + subscription columns from MI Pro and from founder-tier
// so an investor can carry independent billing state. Free → Professional
// ($149/mo or yearly) → Institutional ($599/mo or yearly).
// ---------------------------------------------------------------------------

const INVESTOR_PLAN_TO_PRICE: Record<string, { tier: InvestorTier; envKey: keyof Env }> = {
  investor_pro_monthly:  { tier: 'professional',  envKey: 'STRIPE_PRICE_INVESTOR_PRO_MONTHLY'  as keyof Env },
  investor_pro_yearly:   { tier: 'professional',  envKey: 'STRIPE_PRICE_INVESTOR_PRO_YEARLY'   as keyof Env },
  investor_inst_monthly: { tier: 'institutional', envKey: 'STRIPE_PRICE_INVESTOR_INST_MONTHLY' as keyof Env },
  investor_inst_yearly:  { tier: 'institutional', envKey: 'STRIPE_PRICE_INVESTOR_INST_YEARLY'  as keyof Env },
};

function isValidInvestorPlan(p: unknown): p is keyof typeof INVESTOR_PLAN_TO_PRICE {
  return typeof p === 'string' && Object.prototype.hasOwnProperty.call(INVESTOR_PLAN_TO_PRICE, p);
}

billing.post('/investor/checkout', async (c) => {
  // Step-up to TOTP, mirrors mi-pro/checkout — billing surfaces never run on
  // SMS-only sessions.
  await requireFactor(c, 'totp');
  const user = (await requireAuth(c)) as InvestorUser;
  await ensureInvestorPaywallSchema(c.env);
  if (user.role !== 'investor' && user.role !== 'admin') {
    return c.json({ error: 'investor_only' }, 403);
  }
  const body = await c.req.json().catch(() => ({} as { plan?: string }));
  const plan = body.plan;
  if (!isValidInvestorPlan(plan)) return c.json({ error: 'invalid_plan' }, 400);

  const cfg = INVESTOR_PLAN_TO_PRICE[plan];
  const stripeKey = c.env.STRIPE_SECRET_KEY;
  const priceId = (c.env as unknown as Record<string, unknown>)[cfg.envKey] as string | undefined;
  const appUrl = c.env.APP_URL || 'http://localhost:5000';

  // Dev fallback — flips the user into the requested tier without Stripe.
  if (!stripeKey || !priceId) {
    return c.json({
      url: `${appUrl}/api/billing/investor/dev-upgrade?plan=${plan}`,
      dev: true,
    });
  }

  const params: Record<string, string> = {
    mode: 'subscription',
    'line_items[0][price]': priceId,
    'line_items[0][quantity]': '1',
    success_url: `${appUrl}/settings?tab=billing&investor_upgraded=1`,
    cancel_url: `${appUrl}/settings?tab=billing&investor_cancelled=1`,
    'metadata[user_id]': String(user.id),
    'metadata[plan]': plan,
    'metadata[investor_tier]': cfg.tier,
    'metadata[kind]': 'investor',
    // Stripe Checkout metadata does NOT cascade to the underlying
    // Subscription unless we also pass it via subscription_data[metadata].
    // Webhook events for subscription.created/updated/deleted carry the
    // Subscription object; without this, our `isInvestor`/`investor_tier`
    // routing on those events silently no-ops.
    'subscription_data[metadata][kind]': 'investor',
    'subscription_data[metadata][user_id]': String(user.id),
    'subscription_data[metadata][investor_tier]': cfg.tier,
    'subscription_data[metadata][plan]': plan,
    client_reference_id: `investor:${user.id}`,
  };
  // Institutional supports invoice billing — let Stripe collect a card OR an
  // invoice address depending on the price config; we don't force a payment
  // method here.
  if (cfg.tier === 'institutional') {
    params['payment_method_collection'] = 'if_required';
  }
  if (user.investor_stripe_customer_id) {
    params.customer = user.investor_stripe_customer_id;
  } else {
    params.customer_email = user.email;
  }

  try {
    const session = await stripeCall<{ url: string; id: string }>(c.env, '/checkout/sessions', params);
    return c.json({ url: session.url, session_id: session.id });
  } catch (e) {
    return c.json({ error: 'checkout_failed', detail: (e as Error).message }, 502);
  }
});

billing.post('/investor/portal', async (c) => {
  await requireFactor(c, 'totp');
  const user = (await requireAuth(c)) as InvestorUser;
  if (!user.investor_stripe_customer_id) return c.json({ error: 'no_subscription' }, 400);
  const appUrl = c.env.APP_URL || 'http://localhost:5000';
  try {
    const session = await stripeCall<{ url: string }>(c.env, '/billing_portal/sessions', {
      customer: user.investor_stripe_customer_id,
      return_url: `${appUrl}/settings?tab=billing`,
    });
    return c.json({ url: session.url });
  } catch (e) {
    return c.json({ error: 'portal_failed', detail: (e as Error).message }, 502);
  }
});

billing.get('/investor/status', async (c) => {
  const user = (await requireAuth(c)) as InvestorUser;
  await ensureInvestorPaywallSchema(c.env);
  const tier = effectiveInvestorTier(user);
  const quotas = INVESTOR_QUOTAS[tier];
  // Task #7 (W-2) — surface live deal-room usage so the frontend quota bar
  // can render used/cap. Source of truth is the same table the
  // `/api/deals/:id/dealroom/join` endpoint counts against.
  const dealroomRow = await c.env.DB.prepare(
    `SELECT COUNT(*) AS n FROM investor_dealroom_members WHERE investor_user_id = ?`
  ).bind(user.id).first<{ n: number }>().catch(() => null);
  const dealroomUsed = Number(dealroomRow?.n ?? 0);
  return c.json({
    tier,
    raw_tier: user.investor_tier ?? 'free',
    status: user.investor_subscription_status ?? 'free',
    trial_ends_at: user.investor_trial_ends_at ?? null,
    renews_at: user.investor_subscription_renews_at ?? null,
    has_customer: !!user.investor_stripe_customer_id,
    quotas: {
      intros_per_quarter: quotas.intros_per_quarter,
      intros_used: user.investor_quota_intros_used ?? 0,
      dealroom_max: quotas.dealroom_max,
      dealroom_used: dealroomUsed,
      seats: quotas.seats,
      seat_count: user.investor_seat_count ?? 0,
    },
  });
});

billing.all('/investor/dev-upgrade', async (c) => {
  if (c.env.STRIPE_SECRET_KEY) return c.json({ error: 'not_found' }, 404);
  const user = (await requireAuth(c)) as InvestorUser;
  await ensureInvestorPaywallSchema(c.env);
  const url = new URL(c.req.url);
  const plan = url.searchParams.get('plan') ?? 'investor_pro_monthly';
  if (!isValidInvestorPlan(plan)) return c.json({ error: 'invalid_plan' }, 400);
  const cfg = INVESTOR_PLAN_TO_PRICE[plan];
  const renewsAt = new Date(Date.now() + 30 * 86400 * 1000).toISOString();
  await c.env.DB.prepare(
    `UPDATE users SET investor_tier = ?,
                       investor_subscription_status = 'active',
                       investor_subscription_renews_at = ?,
                       investor_dealroom_max = ?
     WHERE id = ?`,
  ).bind(cfg.tier, renewsAt, INVESTOR_QUOTAS[cfg.tier].dealroom_max, user.id).run();
  if (c.req.method === 'GET') {
    const appUrl = c.env.APP_URL || 'http://localhost:5000';
    return c.redirect(`${appUrl}/settings?tab=billing&investor_upgraded=1`);
  }
  return c.json({ ok: true, tier: cfg.tier, renews_at: renewsAt });
});

// Stripe webhook. Signature verification is required when STRIPE_WEBHOOK_SECRET
// is set; in dev with no secret we accept the body as-is so local testing works.
billing.post('/stripe/webhook', async (c) => {
  await ensureMiPaywallSchema(c.env);
  await ensureTierSchema(c.env);
  await ensureInvestorPaywallSchema(c.env);
  const raw = await c.req.text();
  const sig = c.req.header('stripe-signature') ?? '';
  const secret = c.env.STRIPE_WEBHOOK_SECRET;
  // Task #1 (security hardening) — fail-closed for the Stripe webhook.
  // Historically this route accepted unsigned payloads whenever
  // STRIPE_WEBHOOK_SECRET was unset, which gave any unauth caller the
  // ability to forge subscription state changes. We now ONLY soft-accept
  // when the worker is explicitly running in a local/dev/test/preview
  // environment AND the secret is unset; every other config (including the
  // dangerous "ENVIRONMENT variable typo / unset" case) hard-rejects with
  // 503 so the misconfiguration is loud rather than silently exploitable.
  const envName = String((c.env as { ENVIRONMENT?: string }).ENVIRONMENT || '').toLowerCase();
  const SOFT_ACCEPT_ENVS = new Set(['development', 'dev', 'test', 'local', 'preview']);
  if (!secret) {
    if (!SOFT_ACCEPT_ENVS.has(envName)) {
      return c.json({ error: 'webhook_misconfigured' }, 503);
    }
  } else {
    const ok = await verifyStripeSignature(raw, sig, secret);
    if (!ok) return c.json({ error: 'invalid_signature' }, 400);
  }
  let event: { type: string; data: { object: Record<string, unknown> } };
  try {
    event = JSON.parse(raw);
  } catch {
    return c.json({ error: 'invalid_payload' }, 400);
  }
  await handleStripeEvent(c.env, event);
  return c.json({ received: true });
});

async function handleStripeEvent(
  env: Env,
  event: { type: string; data: { object: Record<string, unknown> } },
): Promise<void> {
  const obj = event.data.object;
  // Task #6 — `metadata.kind === 'tier'` routes the event into the founder
  // tier columns (subscription_tier / stripe_customer_id) instead of the MI
  // Pro columns. Both pipes share the same Stripe webhook because Stripe
  // only delivers to one endpoint per env.
  const meta = (obj.metadata as Record<string, string> | undefined) ?? {};
  const isTier = meta.kind === 'tier'
    || (typeof obj.client_reference_id === 'string' && (obj.client_reference_id as string).startsWith('tier:'));
  const isInvestor = meta.kind === 'investor'
    || (typeof obj.client_reference_id === 'string' && (obj.client_reference_id as string).startsWith('investor:'));

  switch (event.type) {
    case 'checkout.session.completed': {
      const userId = Number(meta.user_id ??
        (typeof obj.client_reference_id === 'string'
          ? (obj.client_reference_id as string).replace(/^(tier|investor):/, '')
          : obj.client_reference_id));
      const customer = obj.customer as string | null;
      const subscription = obj.subscription as string | null;
      if (!userId) return;
      if (isInvestor) {
        const investorTier: InvestorTier = (meta.investor_tier === 'institutional')
          ? 'institutional' : 'professional';
        const dealroomMax = INVESTOR_QUOTAS[investorTier].dealroom_max;
        await env.DB.prepare(
          `UPDATE users SET investor_tier = ?,
                             investor_subscription_status = 'active',
                             investor_dealroom_max = ?,
                             investor_stripe_customer_id = COALESCE(?, investor_stripe_customer_id),
                             investor_stripe_subscription_id = COALESCE(?, investor_stripe_subscription_id)
           WHERE id = ?`,
        ).bind(investorTier, dealroomMax, customer, subscription, userId).run();
        return;
      }
      if (isTier) {
        const tier = (meta.tier === 'growth' || meta.tier === 'studio') ? meta.tier : 'growth';
        await env.DB.prepare(
          `UPDATE users SET subscription_tier = ?,
                             subscription_status = 'active',
                             stripe_customer_id = COALESCE(?, stripe_customer_id),
                             stripe_subscription_id = COALESCE(?, stripe_subscription_id)
           WHERE id = ?`,
        ).bind(tier, customer, subscription, userId).run();
        return;
      }
      const plan = meta.plan ?? null;
      await env.DB.prepare(
        `UPDATE users SET mi_subscription_status = 'active',
                           mi_stripe_customer_id = COALESCE(?, mi_stripe_customer_id),
                           mi_subscription_id = COALESCE(?, mi_subscription_id),
                           mi_subscription_plan = COALESCE(?, mi_subscription_plan)
         WHERE id = ?`
      ).bind(customer, subscription, plan, userId).run();
      return;
    }
    case 'customer.subscription.updated':
    case 'customer.subscription.created': {
      const customer = obj.customer as string | null;
      const status = (obj.status as string) ?? 'active';
      const periodEnd = obj.current_period_end
        ? new Date(Number(obj.current_period_end) * 1000).toISOString()
        : null;
      if (!customer) return;
      // Investor mirror — only touches users whose investor_stripe_customer_id matches.
      const invTier: InvestorTier | null = isInvestor && meta.investor_tier === 'institutional'
        ? 'institutional'
        : isInvestor && meta.investor_tier === 'professional'
          ? 'professional'
          : null;
      if (invTier) {
        await env.DB.prepare(
          `UPDATE users SET investor_tier = ?,
                             investor_subscription_status = ?,
                             investor_subscription_renews_at = ?,
                             investor_dealroom_max = ?,
                             investor_stripe_subscription_id = ?
           WHERE investor_stripe_customer_id = ?`,
        ).bind(invTier, status, periodEnd, INVESTOR_QUOTAS[invTier].dealroom_max, obj.id as string, customer).run();
        // Cascade tier change to accepted seat colleagues.
        await env.DB.prepare(
          `UPDATE users SET investor_tier = ?, investor_subscription_status = ?
           WHERE investor_seat_primary_user_id IN (
             SELECT id FROM users WHERE investor_stripe_customer_id = ?
           )`,
        ).bind(invTier, status, customer).run();
      } else if (isInvestor) {
        // Investor sub event without explicit metadata.tier — only run when
        // we know it's an investor event (avoid clobbering rows that share
        // a stripe_customer_id with an unrelated founder subscription).
        await env.DB.prepare(
          `UPDATE users SET investor_subscription_status = ?,
                             investor_subscription_renews_at = ?,
                             investor_stripe_subscription_id = ?
           WHERE investor_stripe_customer_id = ?`,
        ).bind(status, periodEnd, obj.id as string, customer).run();
      }
      // Tier-side update: only touches users whose stripe_customer_id matches.
      // Tier metadata may be on the subscription's `metadata.tier`; if absent
      // we leave subscription_tier alone (keeps the value set by checkout).
      const subTier = isTier && (meta.tier === 'growth' || meta.tier === 'studio')
        ? meta.tier
        : null;
      if (subTier) {
        await env.DB.prepare(
          `UPDATE users SET subscription_tier = ?,
                             subscription_status = ?,
                             subscription_renews_at = ?,
                             stripe_subscription_id = ?
           WHERE stripe_customer_id = ?`,
        ).bind(subTier, status, periodEnd, obj.id as string, customer).run();
      } else {
        // Status / renewal updates on a tier sub without explicit metadata.
        await env.DB.prepare(
          `UPDATE users SET subscription_status = ?,
                             subscription_renews_at = ?,
                             stripe_subscription_id = ?
           WHERE stripe_customer_id = ?`,
        ).bind(status, periodEnd, obj.id as string, customer).run();
      }
      // MI Pro mirror — unchanged behaviour for callers on mi_stripe_customer_id.
      await env.DB.prepare(
        `UPDATE users SET mi_subscription_status = ?,
                           mi_subscription_id = ?,
                           mi_subscription_period_end = ?
         WHERE mi_stripe_customer_id = ?`
      ).bind(status, obj.id as string, periodEnd, customer).run();
      // Task #11 — auto-register the plan in `subscription_plans` so MRR/ARR
      // analytics include any plan launched in Stripe without a code change.
      // We pass the user's existing `mi_subscription_plan` as the preferred
      // catalog key so the catalog row stays aligned with what's stored on
      // the user (otherwise we could end up with users keyed on
      // `mi_pro_monthly` while the catalog upsert keys on the Stripe
      // `price.id`, leaving MRR at $0 for that user). When the user has no
      // plan yet (subscription event arriving before checkout.session.completed
      // for some reason), we backfill `users.mi_subscription_plan` with the
      // resolved plan_id so user + catalog stay in lockstep.
      // Wrapped because pricing-catalog upserts must never block billing state.
      try {
        const userRow = await env.DB.prepare(
          'SELECT mi_subscription_plan FROM users WHERE mi_stripe_customer_id = ? LIMIT 1'
        ).bind(customer).first<{ mi_subscription_plan: string | null }>();
        const existingPlan = userRow?.mi_subscription_plan ?? null;
        // If Stripe is sending a price.id that doesn't match what the user's
        // existing catalog row was last seen with, treat it as a plan change
        // (e.g. upgrade/downgrade from the customer portal) — drop the
        // preferred-plan-id hint so the upsert keys on the new price.id and
        // we re-align `users.mi_subscription_plan` below.
        let preferred: string | null = existingPlan;
        const itemPriceId = (((obj.items as { data?: Array<{ price?: { id?: string } }> } | undefined)?.data?.[0]?.price?.id)
          ?? ((obj.plan as { id?: string } | undefined)?.id)
          ?? null) as string | null;
        if (existingPlan && itemPriceId) {
          const catalogRow = await env.DB.prepare(
            'SELECT stripe_price_id FROM subscription_plans WHERE plan_id = ? LIMIT 1'
          ).bind(existingPlan).first<{ stripe_price_id: string | null }>().catch(() => null);
          const storedPriceId = catalogRow?.stripe_price_id ?? null;
          if (storedPriceId && storedPriceId !== itemPriceId) preferred = null;
        }
        const resolvedPlan = await upsertPlanFromStripeSubscription(
          env,
          obj as Parameters<typeof upsertPlanFromStripeSubscription>[1],
          preferred,
        );
        // Backfill / re-align the user's plan id whenever Stripe disagrees
        // with what we previously stored — covers both the "no plan yet"
        // case and the "user upgraded/downgraded to a new Stripe price"
        // case (where Stripe doesn't echo our checkout metadata.plan, so
        // the resolved plan_id falls back to the new price.id).
        if (resolvedPlan && resolvedPlan !== existingPlan) {
          await env.DB.prepare(
            'UPDATE users SET mi_subscription_plan = ? WHERE mi_stripe_customer_id = ?'
          ).bind(resolvedPlan, customer).run();
        }
      } catch (e) {
        console.warn('[billing] plan catalog upsert failed:', (e as Error).message);
      }
      return;
    }
    case 'customer.subscription.deleted': {
      const customer = obj.customer as string | null;
      const subId = obj.id as string | null;
      if (!customer || !subId) return;
      // Disambiguate by subscription_id so a customer with multiple Stripe
      // subscriptions (e.g. MI Pro + Investor Pro on the same customer)
      // only loses the entitlement that was actually cancelled.
      await env.DB.prepare(
        `UPDATE users SET mi_subscription_status = 'cancelled'
         WHERE mi_stripe_customer_id = ? AND mi_subscription_id = ?`
      ).bind(customer, subId).run();
      // Task #6 — drop the founder tier back to free when the tier sub ends.
      await env.DB.prepare(
        `UPDATE users SET subscription_tier = 'free',
                           subscription_status = 'cancelled',
                           stripe_subscription_id = NULL
         WHERE stripe_customer_id = ? AND stripe_subscription_id = ?`,
      ).bind(customer, subId).run();
      // Task #6 (W-1) — drop investor tier back to free on sub deletion,
      // including any accepted seat colleagues. Scoped by sub id so a
      // founder-tier deletion doesn't clobber an active investor sub.
      const downgraded = await env.DB.prepare(
        `UPDATE users SET investor_tier = 'free',
                           investor_subscription_status = 'cancelled',
                           investor_dealroom_max = ?,
                           investor_stripe_subscription_id = NULL
         WHERE investor_stripe_customer_id = ? AND investor_stripe_subscription_id = ?`,
      ).bind(INVESTOR_QUOTAS.free.dealroom_max, customer, subId).run();
      // Cascade to seat colleagues only when the investor sub itself was
      // the one cancelled (downgraded.meta.changes > 0).
      const changes = (downgraded?.meta?.changes ?? 0) as number;
      if (changes > 0) {
        await env.DB.prepare(
          `UPDATE users SET investor_tier = 'free', investor_subscription_status = 'cancelled'
           WHERE investor_seat_primary_user_id IN (
             SELECT id FROM users WHERE investor_stripe_customer_id = ?
           )`,
        ).bind(customer).run();
      }
      return;
    }
    default:
      return;
  }
}

// Stripe sends `t=...,v1=<hex>`. We HMAC-SHA256 over `${t}.${body}` with the
// webhook secret and compare in constant time. No Stripe SDK in the worker.
async function verifyStripeSignature(body: string, header: string, secret: string): Promise<boolean> {
  const parts: Record<string, string> = {};
  for (const seg of header.split(',')) {
    const [k, v] = seg.split('=');
    if (k && v) parts[k.trim()] = v.trim();
  }
  const t = parts['t'];
  const v1 = parts['v1'];
  if (!t || !v1) return false;
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(`${t}.${body}`));
  const hex = Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, '0')).join('');
  if (hex.length !== v1.length) return false;
  let diff = 0;
  for (let i = 0; i < hex.length; i++) diff |= hex.charCodeAt(i) ^ v1.charCodeAt(i);
  return diff === 0;
}

export default billing;
