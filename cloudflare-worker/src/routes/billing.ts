import { Hono } from 'hono';
import type { Context } from 'hono';
import type { Env, User } from '../types';
import { requireAuth, requireFactor, requireStepUp } from '../auth';
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
import { priceForPlanMetadata, getCatalog } from '../services/catalog';

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

function isValidPlan(p: unknown): p is 'mi_pro_monthly' | 'mi_pro_annual' {
  return p === 'mi_pro_monthly' || p === 'mi_pro_annual';
}

export async function stripeCall<T>(
  env: Env,
  path: string,
  body: Record<string, string>,
  opts?: { idempotencyKey?: string; method?: 'GET' | 'POST' | 'DELETE' },
): Promise<T> {
  const key = env.STRIPE_SECRET_KEY;
  if (!key) throw new Error('stripe_not_configured');
  const method = opts?.method ?? 'POST';
  const params = new URLSearchParams(body);
  const headers: Record<string, string> = {
    Authorization: `Bearer ${key}`,
  };
  // Stripe replays the original response for 24h when the same Idempotency-Key
  // recurs — protects money-movement calls (e.g. /refunds) from double-submits
  // and retries. Only sent when a caller opts in (existing callers unaffected).
  if (opts?.idempotencyKey) headers['Idempotency-Key'] = opts.idempotencyKey;
  // GET (list/read) + DELETE (resource removal, e.g. /coupons/:id) carry query
  // params with no body; POST (mutations) take a form-encoded body. Catalog
  // reads use GET; all existing callers stay POST.
  let url = `https://api.stripe.com/v1${path}`;
  let reqBody: string | undefined;
  if (method === 'GET' || method === 'DELETE') {
    const qs = params.toString();
    if (qs) url += `?${qs}`;
  } else {
    headers['Content-Type'] = 'application/x-www-form-urlencoded';
    reqBody = params.toString();
  }
  const res = await fetch(url, {
    method,
    headers,
    body: reqBody,
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
  await requireStepUp(c); // BLOCK-AUTH-03 — require a RECENT TOTP, not just a TOTP-minted session
  const user = (await requireAuth(c)) as MiUser;
  await ensureMiPaywallSchema(c.env);
  const body = await c.req.json().catch(() => ({} as { plan?: string }));
  const plan = body.plan;
  if (!isValidPlan(plan)) return c.json({ error: 'invalid_plan' }, 400);

  const stripeKey = c.env.STRIPE_SECRET_KEY;
  // Resolve the SKU from the catalog (mirrored from Stripe) instead of a
  // hardcoded STRIPE_PRICE_* env var. The MI Pro product carries
  // `metadata.plan === 'mi_pro'`; the plan string encodes the interval.
  const interval = plan === 'mi_pro_annual' ? 'year' : 'month';
  const price = stripeKey ? await priceForPlanMetadata(c.env, 'plan', 'mi_pro', interval) : null;
  const priceId = price?.id;
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
  await requireStepUp(c); // BLOCK-AUTH-03 — require a RECENT TOTP, not just a TOTP-minted session
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
  // Resolve the SKU from the catalog instead of STRIPE_PRICE_GROWTH/STUDIO.
  // Each founder-tier product carries `metadata.tier === 'growth' | 'studio'`
  // and a single recurring price (interval not encoded in the tier string).
  const price = stripeKey ? await priceForPlanMetadata(c.env, 'tier', tier) : null;
  const priceId = price?.id;
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

// The investor `plan` string encodes both the tier (professional |
// institutional) and the billing interval (month | year). Each investor
// product in the catalog carries `metadata.investor_tier === cfg.tier`; the
// interval selects the matching recurring price on that product.
const INVESTOR_PLAN_TO_PRICE: Record<string, { tier: InvestorTier; interval: 'month' | 'year' }> = {
  investor_pro_monthly:  { tier: 'professional',  interval: 'month' },
  investor_pro_yearly:   { tier: 'professional',  interval: 'year'  },
  investor_inst_monthly: { tier: 'institutional', interval: 'month' },
  investor_inst_yearly:  { tier: 'institutional', interval: 'year'  },
};

function isValidInvestorPlan(p: unknown): p is keyof typeof INVESTOR_PLAN_TO_PRICE {
  return typeof p === 'string' && Object.prototype.hasOwnProperty.call(INVESTOR_PLAN_TO_PRICE, p);
}

billing.post('/investor/checkout', async (c) => {
  // Step-up to TOTP, mirrors mi-pro/checkout — billing surfaces never run on
  // SMS-only sessions.
  await requireFactor(c, 'totp');
  await requireStepUp(c); // BLOCK-AUTH-03 — require a RECENT TOTP, not just a TOTP-minted session
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
  // Resolve the SKU from the catalog instead of STRIPE_PRICE_INVESTOR_*.
  // The investor product carries `metadata.investor_tier === cfg.tier`; the
  // plan-derived interval selects the matching recurring price.
  const price = stripeKey
    ? await priceForPlanMetadata(c.env, 'investor_tier', cfg.tier, cfg.interval)
    : null;
  const priceId = price?.id;
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
  await requireStepUp(c); // BLOCK-AUTH-03 — require a RECENT TOTP, not just a TOTP-minted session
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

// ---------------------------------------------------------------------------
// Task #5 — In-app billing dashboard.
//
//   GET  /api/billing/overview?scope=founder|investor
//        → { has_customer, subscriptions, payment_methods, upcoming_invoice,
//            invoices } — everything the dashboard needs in one round trip.
//   POST /api/billing/subscription/cancel   { subscription_id, scope }
//   POST /api/billing/subscription/resume   { subscription_id, scope }
//   POST /api/billing/subscription/swap/preview  { subscription_id, price_id, scope }
//   POST /api/billing/subscription/swap/confirm  { subscription_id, price_id, scope }
//
// Replaces the Stripe Customer Portal redirect: users manage subscriptions,
// payment methods, and invoices without leaving StudioOS. All Stripe access is
// server-side via the `stripeCall` wrapper — the secret key never reaches the
// SPA. Every mutation re-fetches the subscription from Stripe and verifies it
// belongs to the caller's customer before acting.
// ---------------------------------------------------------------------------

type BillingScope = 'founder' | 'investor';

function billingScope(v: unknown): BillingScope {
  return v === 'investor' ? 'investor' : 'founder';
}

function resolveScopeCustomer(user: TierUser & InvestorUser, scope: BillingScope): string | null {
  return scope === 'investor'
    ? user.investor_stripe_customer_id ?? null
    : user.stripe_customer_id ?? null;
}

// Minimal Stripe shapes (only the fields we read / surface).
interface StripeList<T> { data: T[]; has_more?: boolean }
interface StripeSubItem {
  id: string;
  quantity?: number;
  current_period_end?: number;
  price?: {
    id: string;
    unit_amount: number | null;
    currency: string;
    nickname: string | null;
    recurring?: { interval: string; interval_count: number } | null;
    product?: string;
  };
}
interface StripeSubscription {
  id: string;
  customer: string;
  status: string;
  cancel_at_period_end?: boolean;
  current_period_end?: number;
  cancel_at?: number | null;
  canceled_at?: number | null;
  items?: { data: StripeSubItem[] };
}
interface StripePaymentMethod {
  id: string;
  card?: { brand: string; last4: string; exp_month: number; exp_year: number };
}
interface StripeCustomer {
  id: string;
  invoice_settings?: { default_payment_method?: string | null };
}
interface StripeInvoiceLine { amount: number; proration?: boolean; description?: string | null }
interface StripeInvoice {
  id?: string;
  number?: string | null;
  status?: string | null;
  currency: string;
  total?: number;
  amount_due?: number;
  amount_paid?: number;
  created?: number;
  period_start?: number;
  period_end?: number;
  next_payment_attempt?: number | null;
  hosted_invoice_url?: string | null;
  invoice_pdf?: string | null;
  lines?: { data: StripeInvoiceLine[] };
}

function subPeriodEnd(sub: StripeSubscription): string | null {
  const unix = sub.current_period_end ?? sub.items?.data?.[0]?.current_period_end ?? null;
  return unix ? new Date(unix * 1000).toISOString() : null;
}

function normSub(sub: StripeSubscription) {
  return {
    id: sub.id,
    status: sub.status,
    cancel_at_period_end: !!sub.cancel_at_period_end,
    current_period_end: subPeriodEnd(sub),
    cancel_at: sub.cancel_at ? new Date(sub.cancel_at * 1000).toISOString() : null,
    items: (sub.items?.data ?? []).map((it) => ({
      id: it.id,
      quantity: it.quantity ?? 1,
      price_id: it.price?.id ?? null,
      product_id: it.price?.product ?? null,
      amount: it.price?.unit_amount ?? null,
      currency: it.price?.currency ?? null,
      interval: it.price?.recurring?.interval ?? null,
      nickname: it.price?.nickname ?? null,
    })),
  };
}

function normInvoice(inv: StripeInvoice) {
  return {
    id: inv.id ?? null,
    number: inv.number ?? null,
    status: inv.status ?? null,
    currency: inv.currency,
    total: inv.total ?? inv.amount_due ?? 0,
    amount_paid: inv.amount_paid ?? 0,
    created: inv.created ? new Date(inv.created * 1000).toISOString() : null,
    period_end: inv.period_end ? new Date(inv.period_end * 1000).toISOString() : null,
    hosted_invoice_url: inv.hosted_invoice_url ?? null,
    invoice_pdf: inv.invoice_pdf ?? null,
  };
}

// Fetch a subscription and assert it belongs to `customer`. Throws a Response
// (403 / 404) the global handler returns as-is, so callers stay terse.
async function fetchOwnedSub(env: Env, subId: string, customer: string): Promise<StripeSubscription> {
  const sub = await stripeCall<StripeSubscription>(
    env, `/subscriptions/${subId}`, { 'expand[0]': 'items.data.price' }, { method: 'GET' },
  );
  if (!sub || sub.customer !== customer) {
    throw new Response(JSON.stringify({ error: 'subscription_not_found' }), {
      status: 404, headers: { 'content-type': 'application/json' },
    });
  }
  return sub;
}

// Validate a client-supplied Stripe price id against the mirrored catalog and
// the request scope, returning the destination tier. This is the server-side
// authorization gate for plan swaps: the client may only switch to an ACTIVE,
// RECURRING subscription price whose product carries metadata for the SAME
// scope it is acting in (founder → metadata.tier; investor →
// metadata.investor_tier). Anything else (unknown id, inactive/one-time price,
// non-subscription product, or a cross-scope price) returns null so the caller
// rejects the request BEFORE any Stripe mutation — preventing both entitlement
// drift (Stripe changed but D1 tier columns stale) and unintended switches to
// hidden/cross-scope internal prices.
async function resolveScopePrice(
  env: Env, scope: BillingScope, priceId: string,
): Promise<{ tier?: string; investorTier?: string } | null> {
  const products = await getCatalog(env);
  for (const p of products) {
    if (p.kind !== 'subscription' || p.active === false) continue;
    const price = p.prices.find((pr) => pr.id === priceId);
    if (!price) continue;
    if (price.active === false || price.type !== 'recurring') return null;
    if (scope === 'investor') {
      return p.metadata.investor_tier ? { investorTier: p.metadata.investor_tier } : null;
    }
    return p.metadata.tier ? { tier: p.metadata.tier } : null;
  }
  return null;
}

billing.get('/overview', async (c) => {
  const user = (await requireAuth(c)) as TierUser & InvestorUser;
  const scope = billingScope(c.req.query('scope'));
  const customer = resolveScopeCustomer(user, scope);
  const base = { scope, has_customer: !!customer, stripe_configured: !!c.env.STRIPE_SECRET_KEY };
  if (!customer || !c.env.STRIPE_SECRET_KEY) {
    return c.json({ ...base, subscriptions: [], payment_methods: [], upcoming_invoice: null, invoices: [] });
  }
  try {
    const [subsRes, pmRes, customerObj, invoicesRes] = await Promise.all([
      stripeCall<StripeList<StripeSubscription>>(c.env, '/subscriptions', {
        customer, status: 'all', limit: '10', 'expand[0]': 'data.items.data.price',
      }, { method: 'GET' }),
      stripeCall<StripeList<StripePaymentMethod>>(c.env, '/payment_methods', {
        customer, type: 'card', limit: '10',
      }, { method: 'GET' }),
      stripeCall<StripeCustomer>(c.env, `/customers/${customer}`, {}, { method: 'GET' }),
      stripeCall<StripeList<StripeInvoice>>(c.env, '/invoices', {
        customer, limit: '12',
      }, { method: 'GET' }),
    ]);
    // Upcoming invoice 404s when nothing is scheduled — treat as "none".
    let upcoming: StripeInvoice | null = null;
    try {
      upcoming = await stripeCall<StripeInvoice>(c.env, '/invoices/upcoming', { customer }, { method: 'GET' });
    } catch {
      upcoming = null;
    }
    const defaultPm = customerObj?.invoice_settings?.default_payment_method ?? null;
    // Surface only active-ish subscriptions in the dashboard (hide fully
    // cancelled/incomplete-expired rows) so the UI shows what the user pays for.
    const liveSubs = (subsRes.data ?? []).filter(
      (s) => !['canceled', 'incomplete_expired'].includes(s.status),
    );
    return c.json({
      ...base,
      subscriptions: liveSubs.map(normSub),
      payment_methods: (pmRes.data ?? []).map((pm) => ({
        id: pm.id,
        brand: pm.card?.brand ?? 'card',
        last4: pm.card?.last4 ?? '••••',
        exp_month: pm.card?.exp_month ?? null,
        exp_year: pm.card?.exp_year ?? null,
        is_default: pm.id === defaultPm,
      })),
      upcoming_invoice: upcoming
        ? {
            currency: upcoming.currency,
            total: upcoming.total ?? upcoming.amount_due ?? 0,
            amount_due: upcoming.amount_due ?? 0,
            next_attempt: upcoming.next_payment_attempt
              ? new Date(upcoming.next_payment_attempt * 1000).toISOString()
              : (upcoming.period_end ? new Date(upcoming.period_end * 1000).toISOString() : null),
          }
        : null,
      invoices: (invoicesRes.data ?? []).map(normInvoice),
    });
  } catch (e) {
    return c.json({ error: 'overview_failed', detail: (e as Error).message }, 502);
  }
});

async function setCancelAtPeriodEnd(c: Context<{ Bindings: Env }>, value: boolean) {
  // Billing mutations are step-up gated, mirroring the (now-removed) Stripe
  // portal endpoints — never run a subscription change on an SMS-only or stale
  // session. The SPA auto-prompts for a fresh TOTP on the 403 and retries.
  await requireFactor(c, 'totp');
  await requireStepUp(c); // BLOCK-AUTH-03 — require a RECENT TOTP, not just a TOTP-minted session
  const user = (await requireAuth(c)) as TierUser & InvestorUser;
  const body = await c.req.json().catch(() => ({} as { subscription_id?: string; scope?: string }));
  const scope = billingScope(body.scope);
  const customer = resolveScopeCustomer(user, scope);
  const subId = String(body.subscription_id || '');
  if (!customer || !subId) return c.json({ error: 'no_subscription' }, 400);
  await fetchOwnedSub(c.env, subId, customer);
  try {
    const updated = await stripeCall<StripeSubscription>(
      c.env, `/subscriptions/${subId}`,
      { cancel_at_period_end: value ? 'true' : 'false', 'expand[0]': 'items.data.price' },
    );
    return c.json({ ok: true, subscription: normSub(updated) });
  } catch (e) {
    return c.json({ error: value ? 'cancel_failed' : 'resume_failed', detail: (e as Error).message }, 502);
  }
}

// Cancel = schedule at period end (keeps access until renews_at); the
// subscription.deleted webhook flips the D1 tier→free when Stripe ends it.
billing.post('/subscription/cancel', (c) => setCancelAtPeriodEnd(c, true));
billing.post('/subscription/resume', (c) => setCancelAtPeriodEnd(c, false));

billing.post('/subscription/swap/preview', async (c) => {
  await requireFactor(c, 'totp');
  await requireStepUp(c); // BLOCK-AUTH-03 — require a RECENT TOTP, not just a TOTP-minted session
  const user = (await requireAuth(c)) as TierUser & InvestorUser;
  const body = await c.req.json().catch(() => ({} as { subscription_id?: string; price_id?: string; scope?: string }));
  const scope = billingScope(body.scope);
  const customer = resolveScopeCustomer(user, scope);
  const subId = String(body.subscription_id || '');
  const priceId = String(body.price_id || '');
  if (!customer || !subId || !priceId) return c.json({ error: 'invalid_request' }, 400);
  // Authorize the destination price for THIS scope before touching Stripe.
  if (!(await resolveScopePrice(c.env, scope, priceId))) {
    return c.json({ error: 'invalid_price' }, 400);
  }
  const sub = await fetchOwnedSub(c.env, subId, customer);
  const itemId = sub.items?.data?.[0]?.id;
  if (!itemId) return c.json({ error: 'no_subscription_item' }, 400);
  try {
    const upcoming = await stripeCall<StripeInvoice>(c.env, '/invoices/upcoming', {
      customer,
      subscription: subId,
      'subscription_items[0][id]': itemId,
      'subscription_items[0][price]': priceId,
      subscription_proration_behavior: 'create_prorations',
    }, { method: 'GET' });
    const prorationLines = (upcoming.lines?.data ?? []).filter((l) => l.proration);
    const prorationAmount = prorationLines.reduce((s, l) => s + (l.amount || 0), 0);
    return c.json({
      currency: upcoming.currency,
      proration_amount: prorationAmount, // can be negative (credit) on downgrade
      amount_due: upcoming.amount_due ?? 0,
      total: upcoming.total ?? 0,
      new_price_id: priceId,
    });
  } catch (e) {
    return c.json({ error: 'preview_failed', detail: (e as Error).message }, 502);
  }
});

billing.post('/subscription/swap/confirm', async (c) => {
  await requireFactor(c, 'totp');
  await requireStepUp(c); // BLOCK-AUTH-03 — require a RECENT TOTP, not just a TOTP-minted session
  const user = (await requireAuth(c)) as TierUser & InvestorUser;
  const body = await c.req.json().catch(() => ({} as { subscription_id?: string; price_id?: string; scope?: string }));
  const scope = billingScope(body.scope);
  const customer = resolveScopeCustomer(user, scope);
  const subId = String(body.subscription_id || '');
  const priceId = String(body.price_id || '');
  if (!customer || !subId || !priceId) return c.json({ error: 'invalid_request' }, 400);

  // Authorize the destination price for THIS scope BEFORE any Stripe mutation.
  // A valid result is required: it is both the access-control gate (only active,
  // recurring, same-scope catalog prices are switchable) AND the source for the
  // entitlement tier we tag on Stripe metadata + sync to D1. Refusing unmapped
  // prices prevents the drift where Stripe billing changes but the D1 tier
  // columns stay stale.
  const mapped = await resolveScopePrice(c.env, scope, priceId);
  if (!mapped) return c.json({ error: 'invalid_price' }, 400);

  const sub = await fetchOwnedSub(c.env, subId, customer);
  const itemId = sub.items?.data?.[0]?.id;
  if (!itemId) return c.json({ error: 'no_subscription_item' }, 400);

  const params: Record<string, string> = {
    'items[0][id]': itemId,
    'items[0][price]': priceId,
    proration_behavior: 'create_prorations',
    'expand[0]': 'items.data.price',
  };
  if (scope === 'investor' && mapped?.investorTier) {
    params['metadata[kind]'] = 'investor';
    params['metadata[investor_tier]'] = mapped.investorTier;
  } else if (scope === 'founder' && mapped?.tier) {
    params['metadata[kind]'] = 'tier';
    params['metadata[tier]'] = mapped.tier;
  }

  try {
    const updated = await stripeCall<StripeSubscription>(c.env, `/subscriptions/${subId}`, params);
    // Align D1 immediately (webhook will re-affirm). Scoped to the calling user.
    if (scope === 'investor' && mapped?.investorTier) {
      const t = mapped.investorTier as InvestorTier;
      const dealroomMax = INVESTOR_QUOTAS[t]?.dealroom_max ?? INVESTOR_QUOTAS.free.dealroom_max;
      await c.env.DB.prepare(
        `UPDATE users SET investor_tier = ?, investor_dealroom_max = ? WHERE id = ?`,
      ).bind(t, dealroomMax, user.id).run();
    } else if (scope === 'founder' && mapped?.tier) {
      await c.env.DB.prepare(
        `UPDATE users SET subscription_tier = ? WHERE id = ?`,
      ).bind(mapped.tier, user.id).run();
    }
    return c.json({ ok: true, subscription: normSub(updated) });
  } catch (e) {
    return c.json({ error: 'swap_failed', detail: (e as Error).message }, 502);
  }
});

// ---------------------------------------------------------------------------
// In-app payment-method management. Removing the Stripe Customer Portal means
// the dashboard is now the ONLY place a user can add / replace / remove a card,
// so these endpoints must exist for BOTH scopes. They reuse `stripeCall` (secret
// stays server-side) and the Stripe SetupIntent flow — raw card data is captured
// exclusively by Stripe Elements in the SPA, never touching the worker.
//
// All three MUTATE billing state and are therefore step-up gated, exactly like
// cancel/resume/swap. `resolveScopeCustomer` pins every call to the calling
// user's own founder/investor customer; default/detach additionally re-fetch the
// payment method and assert `pm.customer === customer` so a caller can never act
// on a card that isn't theirs.

// Resolve the scope customer or throw the standard JSON Response the global
// handler returns verbatim. Used by the mutating PM endpoints below.
function requireScopeCustomer(user: TierUser & InvestorUser, scope: BillingScope): string {
  const customer = resolveScopeCustomer(user, scope);
  if (!customer) {
    throw new Response(JSON.stringify({ error: 'no_customer' }), {
      status: 404, headers: { 'content-type': 'application/json' },
    });
  }
  return customer;
}

// Fetch a payment method and assert it belongs to `customer`. Throws 404 on a
// foreign / missing card so default/detach can't touch another user's card.
async function fetchOwnedPaymentMethod(
  env: Env, pmId: string, customer: string,
): Promise<{ id: string; customer?: string | null }> {
  const pm = await stripeCall<{ id: string; customer?: string | null }>(
    env, `/payment_methods/${pmId}`, {}, { method: 'GET' },
  );
  if (!pm || pm.customer !== customer) {
    throw new Response(JSON.stringify({ error: 'payment_method_not_found' }), {
      status: 404, headers: { 'content-type': 'application/json' },
    });
  }
  return pm;
}

const PM_ID_RE = /^pm_[A-Za-z0-9]+$/;

// Create a SetupIntent for the scope's customer so the SPA can collect & save a
// new card via Stripe Elements (`confirmSetup`). Returns only a client_secret.
billing.post('/payment-method/setup-intent', async (c) => {
  await requireFactor(c, 'totp');
  await requireStepUp(c); // BLOCK-AUTH-03 — recent TOTP, not just a TOTP-minted session
  const user = (await requireAuth(c)) as TierUser & InvestorUser;
  if (!c.env.STRIPE_SECRET_KEY) return c.json({ error: 'stripe_not_configured' }, 503);
  const body = await c.req.json().catch(() => ({} as { scope?: string }));
  const scope = billingScope(body.scope);
  const customer = requireScopeCustomer(user, scope);
  try {
    const intent = await stripeCall<{ id: string; client_secret: string; status: string }>(
      c.env, '/setup_intents', {
        customer,
        usage: 'off_session',
        'payment_method_types[0]': 'card',
        'metadata[user_id]': String(user.id),
        'metadata[uid]': user.uid,
        'metadata[scope]': scope,
      },
    );
    return c.json({ client_secret: intent.client_secret, setup_intent_id: intent.id, status: intent.status });
  } catch (e) {
    return c.json({ error: 'setup_intent_failed', detail: (e as Error).message }, 502);
  }
});

// Make an existing (owned) card the customer's default for future invoices, and
// re-point any live subscriptions at it so the next renewal charges the new card.
billing.post('/payment-method/default', async (c) => {
  await requireFactor(c, 'totp');
  await requireStepUp(c); // BLOCK-AUTH-03 — recent TOTP, not just a TOTP-minted session
  const user = (await requireAuth(c)) as TierUser & InvestorUser;
  if (!c.env.STRIPE_SECRET_KEY) return c.json({ error: 'stripe_not_configured' }, 503);
  const body = await c.req.json().catch(() => ({} as { scope?: string; payment_method_id?: string }));
  const scope = billingScope(body.scope);
  const customer = requireScopeCustomer(user, scope);
  const pmId = String(body.payment_method_id || '');
  if (!PM_ID_RE.test(pmId)) return c.json({ error: 'invalid_payment_method' }, 400);
  await fetchOwnedPaymentMethod(c.env, pmId, customer);
  try {
    await stripeCall(c.env, `/customers/${customer}`, {
      'invoice_settings[default_payment_method]': pmId,
    });
    // Re-point live subscriptions so the next renewal uses the new default.
    const subsRes = await stripeCall<StripeList<StripeSubscription>>(
      c.env, '/subscriptions', { customer, status: 'all', limit: '10' }, { method: 'GET' },
    );
    const liveSubs = (subsRes.data ?? []).filter(
      (s) => !['canceled', 'incomplete_expired'].includes(s.status),
    );
    for (const s of liveSubs) {
      await stripeCall(c.env, `/subscriptions/${s.id}`, { default_payment_method: pmId });
    }
    return c.json({ ok: true, default_payment_method: pmId });
  } catch (e) {
    return c.json({ error: 'set_default_failed', detail: (e as Error).message }, 502);
  }
});

// Detach an owned card. Stripe refuses to detach a subscription's only/last card
// that is still required, surfacing as a 502 the SPA shows to the user.
billing.post('/payment-method/detach', async (c) => {
  await requireFactor(c, 'totp');
  await requireStepUp(c); // BLOCK-AUTH-03 — recent TOTP, not just a TOTP-minted session
  const user = (await requireAuth(c)) as TierUser & InvestorUser;
  if (!c.env.STRIPE_SECRET_KEY) return c.json({ error: 'stripe_not_configured' }, 503);
  const body = await c.req.json().catch(() => ({} as { scope?: string; payment_method_id?: string }));
  const scope = billingScope(body.scope);
  const customer = requireScopeCustomer(user, scope);
  const pmId = String(body.payment_method_id || '');
  if (!PM_ID_RE.test(pmId)) return c.json({ error: 'invalid_payment_method' }, 400);
  await fetchOwnedPaymentMethod(c.env, pmId, customer);
  try {
    await stripeCall(c.env, `/payment_methods/${pmId}/detach`, {});
    return c.json({ ok: true, detached: pmId });
  } catch (e) {
    return c.json({ error: 'detach_failed', detail: (e as Error).message }, 502);
  }
});

// Stripe webhook. Signature verification is required when STRIPE_WEBHOOK_SECRET
// is set; in dev with no secret we accept the body as-is so local testing works.
billing.post('/stripe/webhook', async (c) => {
  await ensureMiPaywallSchema(c.env);
  await ensureTierSchema(c.env);
  await ensureInvestorPaywallSchema(c.env);
  const { ensureIncorporationsSchema } = await import('../services/incorporations');
  await ensureIncorporationsSchema(c.env);
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
  // Task #9 — Refer & Earn Connect events. Same webhook endpoint, dispatched
  // by event type. `account.updated` mirrors the Connect account flags onto
  // users.*; `transfer.paid` / `transfer.failed` close the referral_payouts
  // lifecycle.
  try {
    const ev = event as { type: string; account?: string; data: { object: Record<string, unknown> } };
    if (ev.type === 'account.updated') {
      const { applyConnectAccountUpdated } = await import('../services/referralPayouts');
      await applyConnectAccountUpdated(c.env, ev.data.object as Parameters<typeof applyConnectAccountUpdated>[1]);
      // Task #4 — mirror Connect flags onto experts.* so the directory can
      // gate paid bookings on (stripe_charges_enabled = 1).
      try {
        const acct = ev.data.object as { id?: string; charges_enabled?: boolean; payouts_enabled?: boolean };
        if (acct?.id) {
          await c.env.DB.prepare(
            `UPDATE experts SET stripe_charges_enabled = ?, stripe_payouts_enabled = ?
               WHERE stripe_account_id = ?`,
          ).bind(
            acct.charges_enabled ? 1 : 0,
            acct.payouts_enabled ? 1 : 0,
            acct.id,
          ).run();
        }
      } catch (e: any) {
        console.warn('[billing] expert connect mirror failed:', String(e?.message || e));
      }
    } else if (ev.type === 'transfer.paid') {
      const transferId = (ev.data.object as { id?: string }).id;
      if (transferId) {
        const { applyTransferPaid } = await import('../services/referralPayouts');
        await applyTransferPaid(c.env, transferId);
      }
    } else if (ev.type === 'transfer.failed' || ev.type === 'transfer.reversed') {
      const obj = ev.data.object as { id?: string; failure_message?: string; failure_code?: string };
      if (obj.id) {
        const { applyTransferFailed } = await import('../services/referralPayouts');
        await applyTransferFailed(c.env, obj.id, obj.failure_message || obj.failure_code || ev.type);
      }
    }
  } catch (e) {
    console.warn('[billing] refer-earn webhook dispatch failed:', (e as Error).message);
  }
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
  const isExpertBooking = meta.kind === 'expert_booking'
    || (typeof obj.client_reference_id === 'string' && (obj.client_reference_id as string).startsWith('expert_booking:'));
  const isIncorporation = meta.kind === 'incorporation'
    || (typeof obj.client_reference_id === 'string' && (obj.client_reference_id as string).startsWith('incorporation:'));

  switch (event.type) {
    case 'checkout.session.completed': {
      // Task #4 — wellbeing expert booking fulfilment.
      if (isExpertBooking) {
        const { confirmBookingFromStripe } = await import('../services/wellbeing/bookings');
        await confirmBookingFromStripe(env, obj);
        return;
      }
      // Task #11 — incorporation Stripe Checkout fulfilment.
      if (isIncorporation) {
        const { recordPaidIncorporation } = await import('../services/incorporations');
        await recordPaidIncorporation(env, obj as any);
        return;
      }
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
    case 'payment_intent.succeeded': {
      // Task #9 — record a promo redemption for ANY PI that carries a
      // promo_code_id (à la carte or generic one-time; subscriptions redeem
      // natively via Stripe). Idempotent on the PI id, and independent of the
      // kind dispatch below, so it runs even for kinds that return early.
      const promoCodeId = (meta.promo_code_id || '').trim();
      const promoUserId = Number(meta.user_id);
      const promoPiId = (obj.id as string | null) ?? null;
      if (promoCodeId && promoUserId && promoPiId) {
        const { recordPaidRedemption } = await import('../services/promos');
        await recordPaidRedemption(env, {
          promoId: promoCodeId,
          userId: promoUserId,
          paymentIntentId: promoPiId,
        });
      }
      // Task #7 — embedded-terminal fulfilment. Dispatch STRICTLY on
      // metadata.kind: generic PaymentIntents (no kind) are a no-op, and legacy
      // Checkout-session bookings carry metadata on the SESSION (not the PI), so
      // their PaymentIntent lacks `kind` and won't double-fulfil here.
      if (meta.kind === 'expert_booking') {
        const { confirmBookingFromPaymentIntent } = await import('../services/wellbeing/bookings');
        await confirmBookingFromPaymentIntent(env, obj);
        return;
      }
      if (meta.kind === 'alacarte') {
        const featureKey = (meta.feature_key || '').trim();
        const userId = Number(meta.user_id);
        const piId = (obj.id as string | null) ?? null;
        if (!featureKey || !userId || !piId) return;
        const { writeFeatureUnlock } = await import('../services/featureUnlocks');
        await writeFeatureUnlock(env, {
          userId,
          featureKey,
          paymentIntentId: piId,
          unlockDays: Number(meta.unlock_days),
        });
        return;
      }
      // Task #6 — embedded-terminal incorporation fee. The invoice's PI carries
      // metadata.kind='incorporation' + incorporation_id; mark the order paid and
      // advance the filing workflow (enqueues the packet pipeline). Idempotent.
      if (meta.kind === 'incorporation') {
        const { recordPaidIncorporationFromPaymentIntent } = await import('../services/incorporations');
        await recordPaidIncorporationFromPaymentIntent(env, obj as any);
        return;
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
