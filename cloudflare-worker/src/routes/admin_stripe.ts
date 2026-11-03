/**
 * Admin Stripe management routes — webhook endpoints + publishable key.
 * Mounted at /api/admin/stripe BEFORE the catch-all /api/admin in index.ts.
 *
 * Endpoints:
 *   GET  /webhook        list webhook endpoints from Stripe; annotates drift
 *   POST /webhook        register (create) or update events on an existing endpoint
 *   GET  /config         publishable key (masked) + Test/Live mode
 *   PUT  /config         set/update the publishable key (stored in KV)
 *   GET  /cutover        D1434: what a move to the other Stripe mode would clear
 *   POST /cutover        D1434: the owner-run move from test to live (or back)
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
 * D1009 — Payments belongs to HQ: reads and the fixed-events `update` action
 * requireSuperAdmin. PUT /config changes checkout's key and now takes the same
 * write bar as register, plus a written reason included in its audit details.
 * Register keeps D223's bar; it does not require the new config-change reason.
 *
 * D1434 (#3703) — THE CUTOVER. Production ran on Stripe's sandbox, so every
 * stored customer, subscription and mirrored price is a test-mode object. POST
 * /cutover clears them in one batch (`services/stripeCutover.ts`) once the keys
 * are already in the target mode, behind the write bar, a reason and a typed
 * confirmation. Members whose sandbox plan went back to free get one notice.
 *
 * Every write is audited once through `logAdminAction` (D159), which replaced a
 * hand-written INSERT here. The `report_type='billing'` it set was read by
 * nothing.
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import { requireSuperAdmin, requireSuperAdminWriteBar } from '../auth';
import { stripeCall } from './billing';
import { stripeMode, getPublishableKey, setPublishableKey, maskPublishableKey, paymentChangeReason, syncCatalog } from '../services/catalog';
import { CUTOVER_NOTICE, CutoverUnreadable, cutoverCounts, cutoverMembers, lastCutover, runCutover, storedMode, type StripeModeName } from '../services/stripeCutover';
import { notify } from '../services/notify';
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
  'payment_intent.payment_failed',
  // D892 (#2453): a failed renewal tells the member.
  'invoice.payment_failed',
  // D1049 (#2900) subscribes to bank confirmation requests (3-D Secure);
  // D1052 (#2903) handles renewal alerts when the member must confirm.
  'invoice.payment_action_required',
  'invoice.finalized',
  'invoice.paid',
  'charge.succeeded',
  'charge.refunded',
  'charge.dispute.created',
  'charge.dispute.closed',
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
  await requireSuperAdmin(c);
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
  let admin = await requireSuperAdmin(c);

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
  await requireSuperAdmin(c);
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
  const admin = await requireSuperAdminWriteBar(c);
  let body: { publishable_key?: string; reason?: unknown } = {};
  try {
    body = await c.req.json();
  } catch {
    /* empty body → 400 below */
  }
  const reason = paymentChangeReason(body);
  if (!reason) return c.json({ error: 'reason_required', message: 'Give a reason of 1 to 500 characters for this payment change.' }, 400);
  const pk = String(body.publishable_key || '').trim();
  if (!pk) return c.json({ error: 'publishable_key_required' }, 400);
  if (!pk.startsWith('pk_')) {
    return c.json(
      { error: 'invalid_key_format', detail: 'Publishable keys must start with pk_' },
      400,
    );
  }
  if (pk.length > 256) return c.json({ error: 'key_too_long' }, 400);

  try {
    await setPublishableKey(c.env, pk);
  } catch (e) {
    return refuse(c, 503, { code: 'stripe_config_write_failed', message: 'The Stripe setting could not be saved. Try again in a moment.', raw: e, audience: 'admin' });
  }
  await logAdminAction(c.env, admin.id, admin.email, 'stripe_pk_update', {
    reason,
    key_prefix: pk.slice(0, 8),
    mode: pk.startsWith('pk_live_') ? 'live' : 'test',
  });
  return c.json({ ok: true, mode: pk.startsWith('pk_live_') ? 'live' : 'test' });
});

// --- D1434 (#3703): the move from one Stripe mode to the other -------------

const CUTOVER_UNREADABLE = { code: 'cutover_unreadable', message: 'The records this move would change could not be counted. Nothing was changed. Try again in a moment.', audience: 'admin' as const };
const CATALOG_KV = ['cache:catalog:live:test', 'cache:catalog:live:live'];

// GET /api/admin/stripe/cutover
// The keys' mode, the last cutover, and what a cutover would clear now. A count
// that cannot be read is a 503, never 0.
r.get('/cutover', async (c) => {
  await requireSuperAdmin(c);
  try {
    const [last, wouldClear] = await Promise.all([lastCutover(c.env), cutoverCounts(c.env)]);
    return c.json({ mode: stripeMode(c.env), stored_mode: storedMode(last), last_cutover: last, would_clear: wouldClear });
  } catch (e) {
    if (e instanceof CutoverUnreadable) return refuse(c, 503, { ...CUTOVER_UNREADABLE, raw: e.cause });
    throw e;
  }
});

// POST /api/admin/stripe/cutover   { to_mode: 'live', reason, confirm: 'live' }
r.post('/cutover', async (c) => {
  const admin = await requireSuperAdminWriteBar(c);
  let body: { to_mode?: unknown; confirm?: unknown; reason?: unknown } = {};
  try { body = await c.req.json(); } catch { /* empty body → 400 below */ }
  const reason = paymentChangeReason(body);
  if (!reason) return c.json({ error: 'reason_required', message: 'Give a reason of 1 to 500 characters for this payment change.' }, 400);
  const toMode = body.to_mode === 'live' || body.to_mode === 'test' ? (body.to_mode as StripeModeName) : null;
  if (!toMode) return c.json({ error: 'invalid_mode', message: 'Choose live or test.' }, 400);
  if (body.confirm !== toMode) {
    return c.json({ error: 'confirm_mismatch', message: `Type ${toMode} to confirm. Nothing was changed.` }, 400);
  }
  const keyMode = stripeMode(c.env);
  if (keyMode === 'unconfigured') {
    return c.json({ error: 'stripe_not_configured', message: 'No Stripe secret key is set. Nothing was changed.' }, 503);
  }
  // Keys go first: the stored objects are cleared only once checkout already
  // runs in the target mode, so nothing is left pointing at the old one.
  if (keyMode !== toMode) {
    return c.json({ error: 'cutover_keys_not_live', message: `The Stripe keys are in ${keyMode} mode. Set the ${toMode} keys first. Nothing was changed.`, mode: keyMode }, 409);
  }
  let last, expected, members: number[];
  try {
    [last, expected, members] = await Promise.all([lastCutover(c.env), cutoverCounts(c.env), cutoverMembers(c.env)]);
  } catch (e) {
    if (e instanceof CutoverUnreadable) return refuse(c, 503, { ...CUTOVER_UNREADABLE, raw: e.cause });
    throw e;
  }
  const fromMode = storedMode(last);
  if (fromMode === toMode) {
    return c.json({ error: 'cutover_already_done', message: `The stored Stripe records are already in ${toMode} mode. Nothing was changed.`, last_cutover: last }, 409);
  }

  let result;
  try {
    result = await runCutover(c.env, { fromMode, toMode, actorUserId: admin.id, reason, expected });
  } catch (e) {
    return refuse(c, 503, { code: 'cutover_failed', message: 'The move did not run. Nothing was changed. Try again in a moment.', raw: e, audience: 'admin' });
  }

  // The catalogue cache for both modes, then a fresh mirror in the new mode.
  for (const k of CATALOG_KV) {
    try { await c.env.RATE_LIMITS.delete(k); } catch (e) { console.warn('[cutover] catalogue cache not cleared:', (e as Error).message); }
  }
  let synced: number | null = null;
  try { synced = (await syncCatalog(c.env)).synced; } catch (e) { console.warn('[cutover] catalogue sync failed:', (e as Error).message); }

  // One notice per member whose sandbox plan went back to free (Q1 = A).
  let noticesSent = 0;
  for (const userId of members) {
    try {
      await notify(c.env, { userId, type: CUTOVER_NOTICE.type, category: CUTOVER_NOTICE.category, title: CUTOVER_NOTICE.title,
        body: CUTOVER_NOTICE.body, link: CUTOVER_NOTICE.link, payload: { cutover_id: result.id, to_mode: toMode } });
      noticesSent += 1;
    } catch (e) {
      console.warn('[cutover] member notice not sent:', (e as Error).message);
    }
  }

  await logAdminAction(c.env, admin.id, admin.email, 'stripe_mode_cutover', {
    reason, from_mode: fromMode, to_mode: toMode, cutover_id: result.id,
    customers_cleared: result.customers_cleared, subscriptions_cleared: result.subscriptions_cleared,
    plans_reset: result.plans_reset, mirror_rows_dropped: result.mirror_rows_dropped,
    cards_cleared: result.cards_cleared, alerts_closed: result.alerts_closed, packs_archived: result.packs_archived,
    members_notified: noticesSent, members_to_notify: members.length, catalog_synced: synced,
  });

  const payload = { ok: true, from_mode: fromMode, to_mode: toMode, ...result, members_notified: noticesSent, members_to_notify: members.length, catalog_synced: synced };
  if (synced === null) {
    // The cutover is recorded; the next catalogue read rebuilds the mirror.
    return c.json({ ...payload, error: 'cutover_sync_failed', message: 'The move is done, but the price list could not be read from Stripe. It refreshes on the next read.' }, 502);
  }
  return c.json(payload);
});

export default r;
