/**
 * Admin Stripe management routes — webhook endpoints + publishable key.
 * Mounted at /api/admin/stripe BEFORE the catch-all /api/admin in index.ts.
 *
 * Endpoints:
 *   GET  /webhook        list webhook endpoints from Stripe; annotates drift
 *   POST /webhook        register (create) or update events on an existing endpoint
 *   GET  /config         publishable key (masked) + Test/Live mode
 *   PUT  /config         set/update the publishable key (stored in KV)
 *
 * The STRIPE_WEBHOOK_SECRET Worker secret is pushed via cloudflareSecrets.setSecret
 * on successful webhook registration so it takes effect on the next isolate boot.
 *
 * D223 — WHO MAY WRITE. Registering a webhook is the one act here that writes a
 * Worker secret, onto production's own `studioos` script: the signing secret
 * every Stripe event is verified against. It sits behind
 * `requireSuperAdminWriteBar` (a TOTP session, a recent step-up, the holder).
 * Before D223 any admin could run it — and a registration also creates a live
 * endpoint on the Stripe account.
 *
 * EVERYTHING ELSE STAYS `requireAdmin`, and each for a stated reason:
 *   GET  /webhook, GET /config   read; no secret leaves (the publishable key is
 *                                masked, and is public by design anyway).
 *   POST /webhook `update`       adds this file's own fixed REQUIRED_EVENTS set
 *                                to an existing endpoint; no secret is created
 *                                or moved, and it is the repair the drift list
 *                                on the console points at.
 *   PUT  /config                 the PUBLISHABLE key, stored in KV — a value
 *                                every checkout page prints, not a secret.
 *
 * Every write is audited once through `logAdminAction` (D159), which replaced a
 * hand-written INSERT here. The `report_type='billing'` it set was read by
 * nothing.
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import { requireAdmin, requireSuperAdminWriteBar } from '../auth';
import { stripeCall } from './billing';
import { stripeMode, getPublishableKey, setPublishableKey, maskPublishableKey } from '../services/catalog';
import { setSecret } from '../services/cloudflareSecrets';
import { logAdminAction } from '../services/adminAudit';
import { refuse } from '../util/refusal';

const r = new Hono<{ Bindings: Env }>();

// The full event set our billing webhook handler depends on.
const REQUIRED_EVENTS: string[] = [
  'checkout.session.completed',
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
  'payment_intent.succeeded',
  'invoice.finalized',
  'invoice.paid',
  'charge.succeeded',
];

function webhookUrl(env: Env): string {
  const base = (env.APP_URL || 'https://axal.vc').replace(/\/$/, '');
  return `${base}/api/billing/stripe/webhook`;
}

interface StripeWebhookEndpoint {
  id: string;
  url: string;
  status: string;
  enabled_events: string[];
  secret?: string;
}

// GET /api/admin/stripe/webhook
// Lists all webhook endpoints from Stripe and annotates each with:
//   - is_ours: whether the URL matches our production webhook URL
//   - missing_events: required events not yet enabled on this endpoint
r.get('/webhook', async (c) => {
  await requireAdmin(c);
  if (!c.env.STRIPE_SECRET_KEY) return c.json({ error: 'stripe_not_configured' }, 503);
  try {
    const data = await stripeCall<{ data: StripeWebhookEndpoint[] }>(
      c.env,
      '/webhook_endpoints',
      {},
      { method: 'GET' },
    );
    const ourUrl = webhookUrl(c.env);
    const endpoints = (data.data || []).map((ep) => {
      // Stripe uses ['*'] to mean "all events"; if so there's no drift.
      const hasWildcard = ep.enabled_events.includes('*');
      const missingEvents = hasWildcard
        ? []
        : REQUIRED_EVENTS.filter((ev) => !ep.enabled_events.includes(ev));
      return {
        id: ep.id,
        url: ep.url,
        status: ep.status,
        enabled_events: ep.enabled_events,
        is_ours: ep.url === ourUrl,
        missing_events: missingEvents,
      };
    });
    return c.json({ endpoints, required_events: REQUIRED_EVENTS, our_url: ourUrl });
  } catch (e) {
    return refuse(c, 502, { code: 'stripe_call_failed', message: 'Stripe did not accept the call. Nothing changed; check the Stripe settings and try again.', raw: e, audience: 'admin' });
  }
});

// POST /api/admin/stripe/webhook
// Body: { action: 'register' | 'update', endpoint_id?: string }
//
//   register — Create a new webhook endpoint pointed at our production URL with
//              the required event set. The Stripe-returned signing secret is
//              immediately pushed as the STRIPE_WEBHOOK_SECRET Worker secret.
//              Secret is only available on creation; re-register to rotate it.
//
//   update   — Update the enabled_events on an existing endpoint (identified by
//              endpoint_id). No new signing secret is generated by Stripe; the
//              existing STRIPE_WEBHOOK_SECRET remains valid.
r.post('/webhook', async (c) => {
  let admin = await requireAdmin(c);

  let body: Record<string, unknown> = {};
  try {
    body = await c.req.json();
  } catch {
    /* empty body → default to register */
  }

  const action = String(body.action || 'register');
  // D223 — `register` writes STRIPE_WEBHOOK_SECRET onto the production Worker,
  // so it takes the holder's bar. Checked BEFORE the configuration check, so a
  // plain admin is refused for who they are, not told Stripe is unconfigured.
  if (action === 'register') admin = await requireSuperAdminWriteBar(c);
  if (!c.env.STRIPE_SECRET_KEY) return c.json({ error: 'stripe_not_configured' }, 503);
  const ourUrl = webhookUrl(c.env);

  if (action === 'register') {
    const form: Record<string, string> = { url: ourUrl };
    REQUIRED_EVENTS.forEach((ev, i) => {
      form[`enabled_events[${i}]`] = ev;
    });

    try {
      const ep = await stripeCall<StripeWebhookEndpoint>(c.env, '/webhook_endpoints', form);
      let secretStored = false;
      if (ep.secret) {
        const res = await setSecret(c.env, 'STRIPE_WEBHOOK_SECRET', ep.secret);
        secretStored = res.ok;
        if (!res.ok) {
          console.warn('[admin/stripe] STRIPE_WEBHOOK_SECRET push failed:', res.error);
        }
      }
      await logAdminAction(c.env, admin.id, admin.email, 'stripe_webhook_register', {
        endpoint_id: ep.id,
        url: ep.url,
        secret_stored: secretStored,
      });
      if (!secretStored) {
        // The signing secret is ONLY returned by Stripe at creation time. If we
        // cannot store it, the endpoint is in a partially-configured state —
        // webhooks will arrive but we cannot verify their signatures. Delete
        // the orphaned endpoint immediately so the admin can retry cleanly
        // rather than having an unverifiable endpoint linger. Callers should
        // retry the registration once the Cloudflare API credentials are valid.
        try {
          await stripeCall(c.env, `/webhook_endpoints/${encodeURIComponent(ep.id)}`, {}, { method: 'DELETE' });
        } catch (deleteErr) {
          console.warn('[admin/stripe] cleanup of orphaned webhook endpoint failed', deleteErr);
        }
        return c.json(
          {
            error: 'secret_storage_failed',
            detail:
              'Webhook registered but STRIPE_WEBHOOK_SECRET could not be stored automatically. ' +
              'The endpoint has been removed to avoid a partially-configured state. ' +
              'Ensure the Cloudflare API token has "Workers Scripts:Edit" permission and retry. ' +
              'The signing secret is never returned via the API — it will be stored automatically on the next successful registration.',
          },
          503,
        );
      }
      return c.json({
        ok: true,
        endpoint_id: ep.id,
        url: ep.url,
        secret_stored: true,
        note: 'STRIPE_WEBHOOK_SECRET stored as Worker secret. Takes effect on next isolate boot.',
      });
    } catch (e) {
      return refuse(c, 502, { code: 'stripe_call_failed', message: 'Stripe did not accept the call. Nothing changed; check the Stripe settings and try again.', raw: e, audience: 'admin' });
    }
  } else if (action === 'update') {
    const endpointId = String(body.endpoint_id || '').trim();
    if (!endpointId) return c.json({ error: 'endpoint_id_required' }, 400);

    const form: Record<string, string> = {};
    REQUIRED_EVENTS.forEach((ev, i) => {
      form[`enabled_events[${i}]`] = ev;
    });

    try {
      const ep = await stripeCall<StripeWebhookEndpoint>(
        c.env,
        `/webhook_endpoints/${encodeURIComponent(endpointId)}`,
        form,
      );
      await logAdminAction(c.env, admin.id, admin.email, 'stripe_webhook_update', {
        endpoint_id: ep.id,
        url: ep.url,
      });
      return c.json({ ok: true, endpoint_id: ep.id, url: ep.url });
    } catch (e) {
      return refuse(c, 502, { code: 'stripe_call_failed', message: 'Stripe did not accept the call. Nothing changed; check the Stripe settings and try again.', raw: e, audience: 'admin' });
    }
  } else {
    return c.json({ error: 'invalid_action', allowed: ['register', 'update'] }, 400);
  }
});

// GET /api/admin/stripe/config
// Returns the publishable key (masked: first 8 chars + ••••  + last 4) and mode.
// Never returns the raw key value or the secret key.
r.get('/config', async (c) => {
  await requireAdmin(c);
  const pk = await getPublishableKey(c.env);
  // One mask, shared with HQ · Platform (D213), so the key reads the same on both.
  const masked = maskPublishableKey(pk);
  return c.json({
    publishable_key: masked,
    mode: stripeMode(c.env),
    configured: !!pk,
  });
});

// PUT /api/admin/stripe/config
// Stores the publishable key in KV so frontend reads it at runtime without a rebuild.
r.put('/config', async (c) => {
  const admin = await requireAdmin(c);
  let body: { publishable_key?: string } = {};
  try {
    body = await c.req.json();
  } catch {
    /* empty body → 400 below */
  }
  const pk = String(body.publishable_key || '').trim();
  if (!pk) return c.json({ error: 'publishable_key_required' }, 400);
  if (!pk.startsWith('pk_')) {
    return c.json(
      { error: 'invalid_key_format', detail: 'Publishable keys must start with pk_' },
      400,
    );
  }
  if (pk.length > 256) return c.json({ error: 'key_too_long' }, 400);

  await setPublishableKey(c.env, pk);
  await logAdminAction(c.env, admin.id, admin.email, 'stripe_pk_update', {
    key_prefix: pk.slice(0, 8),
    mode: pk.startsWith('pk_live_') ? 'live' : 'test',
  });
  return c.json({ ok: true, mode: pk.startsWith('pk_live_') ? 'live' : 'test' });
});

export default r;
