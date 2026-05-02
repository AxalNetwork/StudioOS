import { Hono } from 'hono';
import type { Env, User } from '../types';
import { requireAuth } from '../auth';
import { ensureMiPaywallSchema, MI_PRO_PRODUCTS, userHasMiPro } from '../middleware/miAccess';

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
  const key = (env as Env & { STRIPE_SECRET_KEY?: string }).STRIPE_SECRET_KEY;
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
  const user = (await requireAuth(c)) as MiUser;
  await ensureMiPaywallSchema(c.env);
  const body = await c.req.json().catch(() => ({} as { plan?: string }));
  const plan = body.plan;
  if (!isValidPlan(plan)) return c.json({ error: 'invalid_plan' }, 400);

  const stripeKey = (c.env as Env & { STRIPE_SECRET_KEY?: string }).STRIPE_SECRET_KEY;
  const priceEnvKey = PLAN_TO_PRICE_ENV[plan];
  const priceId = (c.env as Record<string, unknown>)[priceEnvKey] as string | undefined;
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
  const stripeKey = (c.env as Env & { STRIPE_SECRET_KEY?: string }).STRIPE_SECRET_KEY;
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

// Stripe webhook. Signature verification is required when STRIPE_WEBHOOK_SECRET
// is set; in dev with no secret we accept the body as-is so local testing works.
billing.post('/stripe/webhook', async (c) => {
  await ensureMiPaywallSchema(c.env);
  const raw = await c.req.text();
  const sig = c.req.header('stripe-signature') ?? '';
  const secret = (c.env as Env & { STRIPE_WEBHOOK_SECRET?: string }).STRIPE_WEBHOOK_SECRET;
  if (secret) {
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
  switch (event.type) {
    case 'checkout.session.completed': {
      const userId = Number(((obj.metadata as Record<string, string> | undefined) ?? {}).user_id ?? obj.client_reference_id);
      const plan = ((obj.metadata as Record<string, string> | undefined) ?? {}).plan ?? null;
      const customer = obj.customer as string | null;
      const subscription = obj.subscription as string | null;
      if (!userId) return;
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
      await env.DB.prepare(
        `UPDATE users SET mi_subscription_status = ?,
                           mi_subscription_id = ?,
                           mi_subscription_period_end = ?
         WHERE mi_stripe_customer_id = ?`
      ).bind(status, obj.id as string, periodEnd, customer).run();
      return;
    }
    case 'customer.subscription.deleted': {
      const customer = obj.customer as string | null;
      if (!customer) return;
      await env.DB.prepare(
        `UPDATE users SET mi_subscription_status = 'cancelled'
         WHERE mi_stripe_customer_id = ?`
      ).bind(customer).run();
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
