/**
 * Task #3 — Calendly provider implementation (Live, Free tier).
 *
 * Two ways to connect:
 *   1. OAuth2 authorization-code flow against api.calendly.com (preferred).
 *   2. Personal Access Token (PAT) — Calendly issues long-lived bearer
 *      tokens from their UI; pasted into the Connect modal's API-key field
 *      and validated by hitting `/users/me`.
 *
 * Both paths converge on the same credential blob shape:
 *   {
 *     access_token: string,
 *     refresh_token?: string,        // OAuth only
 *     expires_at?: number,           // OAuth only (epoch ms)
 *     token_type: 'Bearer',
 *     auth_method: 'oauth' | 'pat',
 *     user_uri: string,              // e.g. https://api.calendly.com/users/<uuid>
 *     organization_uri: string,
 *     webhook_uri?: string,          // Calendly subscription URI we registered
 *   }
 *
 * `webhook_secret_enc` on the integration row stores the per-subscription
 * `signing_key` Calendly returns from POST /webhook_subscriptions. The
 * generic webhook receiver in routes/integrations.ts HMAC-verifies inbound
 * bodies against this key (Calendly sends `Calendly-Webhook-Signature`).
 *
 * Authoritative store for synced events is the `calendar_events` table
 * (migration 018). The unified `/api/calendar` aggregator (services/
 * calendar.ts) reads from this table for `kind='calendly_event'`.
 */
import type { Context } from 'hono';
import { stripTrailingSlashes } from '../../util/url';
import type { Env, User } from '../../types';
import {
  registerProvider,
  type ProviderImpl,
  type ConnectInput,
  type ConnectResult,
  type IntegrationRow,
  type SyncResult,
} from '../registry';
import {
  decryptCredentials,
  encryptCredentials,
  encryptWebhookSecret,
  type CredentialBlob,
} from '../secrets';

const PROVIDER_KEY = 'calendly';
const CL_API = 'https://api.calendly.com';
const CL_AUTH = 'https://auth.calendly.com';

function redirectUri(env: Env): string {
  const base = stripTrailingSlashes(env.APP_URL || '');
  return `${base}/api/integrations/oauth/${PROVIDER_KEY}/callback`;
}

async function ensureCreds(env: Env): Promise<{ id: string; secret: string }> {
  // Env-first via `loadOauthCreds`, falls back to admin-managed
  // `provider_oauth_keys` row. Mirrors the slack/hubspot pattern.
  const { loadOauthCreds } = await import('../../services/providerOauthKeys');
  const c = await loadOauthCreds(env, 'calendly');
  if (!c) {
    throw new Error('calendly_oauth_unconfigured: set CALENDLY_CLIENT_ID/CALENDLY_CLIENT_SECRET as secrets, or configure them in Admin → Integration Keys.');
  }
  return { id: c.id, secret: c.secret };
}

// ───────────────────────────────────────────────────────────── token mgmt

interface TokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  token_type: string;
  scope?: string;
  owner?: string;            // user URI
  organization?: string;
}

async function exchangeCode(env: Env, code: string): Promise<TokenResponse> {
  const { id, secret } = await ensureCreds(env);
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: id,
    client_secret: secret,
    redirect_uri: redirectUri(env),
    code,
  });
  const res = await fetch(`${CL_AUTH}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`calendly_token_exchange_failed: ${res.status} ${txt.slice(0, 300)}`);
  }
  return await res.json() as TokenResponse;
}

async function refreshAccessToken(env: Env, refreshToken: string): Promise<TokenResponse> {
  const { id, secret } = await ensureCreds(env);
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: id,
    client_secret: secret,
    refresh_token: refreshToken,
  });
  const res = await fetch(`${CL_AUTH}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`calendly_refresh_failed: ${res.status} ${txt.slice(0, 300)}`);
  }
  return await res.json() as TokenResponse;
}

/**
 * Resolve a usable bearer for the row. PAT credentials are long-lived and
 * returned as-is. OAuth credentials are refreshed (with KV lease against
 * concurrent isolates) when the access token is within 60 s of expiry.
 */
async function getActiveAccessToken(env: Env, row: IntegrationRow): Promise<string> {
  const skewMs = 60 * 1000;

  const readCreds = async (): Promise<CredentialBlob | null> => {
    const fresh = await env.DB.prepare('SELECT credentials_enc FROM integrations WHERE id = ?')
      .bind(row.id).first<{ credentials_enc: string }>();
    if (!fresh?.credentials_enc) throw new Error('calendly_credentials_missing');
    return await decryptCredentials(env, row.uid, fresh.credentials_enc);
  };
  const isLive = (creds: CredentialBlob | null): string => {
    const at = typeof creds?.access_token === 'string' ? creds!.access_token as string : '';
    if (!at) return '';
    if (creds?.auth_method === 'pat') return at;
    const exp = typeof creds?.expires_at === 'number'
      ? creds!.expires_at as number
      : (typeof creds?.expires_at === 'string' ? Date.parse(creds!.expires_at as string) : 0);
    return exp && exp - Date.now() > skewMs ? at : '';
  };

  let creds = await decryptCredentials(env, row.uid, row.credentials_enc);
  if (!creds) throw new Error('calendly_credentials_missing');
  const live = isLive(creds);
  if (live) return live;
  if (creds.auth_method === 'pat') {
    // PAT but no access_token? Treat as missing.
    throw new Error('calendly_credentials_missing');
  }

  const lockKey = `calendly:refresh:${row.uid}`;
  const holder = crypto.randomUUID();
  let acquired = false;
  try {
    const cur = await env.RATE_LIMITS.get(lockKey);
    if (!cur) {
      await env.RATE_LIMITS.put(lockKey, holder, { expirationTtl: 30 });
      const verify = await env.RATE_LIMITS.get(lockKey);
      acquired = verify === holder;
    }
  } catch { /* lease infra failure → single-flight not guaranteed */ }

  if (!acquired) {
    for (let i = 0; i < 6; i++) {
      await new Promise(r => setTimeout(r, 500));
      const after = await readCreds();
      const liveAfter = isLive(after);
      if (liveAfter) return liveAfter;
    }
  } else {
    const fresh = await readCreds();
    const liveFresh = isLive(fresh);
    if (liveFresh) {
      try { if (acquired) await env.RATE_LIMITS.delete(lockKey); } catch {}
      return liveFresh;
    }
    creds = fresh;
  }

  const refreshToken = typeof creds?.refresh_token === 'string' ? creds!.refresh_token as string : '';
  if (!refreshToken) {
    try { if (acquired) await env.RATE_LIMITS.delete(lockKey); } catch {}
    throw new Error('calendly_refresh_token_missing');
  }
  try {
    const refreshed = await refreshAccessToken(env, refreshToken);
    const newCreds: CredentialBlob = {
      ...creds,
      access_token: refreshed.access_token,
      refresh_token: refreshed.refresh_token || refreshToken,
      token_type: 'Bearer',
      expires_at: Date.now() + refreshed.expires_in * 1000,
    } as CredentialBlob;
    const enc = await encryptCredentials(env, row.uid, newCreds);
    await env.DB.prepare(
      'UPDATE integrations SET credentials_enc = ?, last_error = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
    ).bind(enc, row.id).run();
    return refreshed.access_token;
  } finally {
    try { if (acquired) await env.RATE_LIMITS.delete(lockKey); } catch {}
  }
}

async function clFetch(env: Env, row: IntegrationRow, path: string, init: RequestInit = {}): Promise<Response> {
  const token = await getActiveAccessToken(env, row);
  const headers = new Headers(init.headers || {});
  headers.set('Authorization', `Bearer ${token}`);
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  return fetch(`${CL_API}${path}`, { ...init, headers });
}

// Bare bearer call used during connect (no row exists yet).
async function clBearerFetch(token: string, path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers || {});
  headers.set('Authorization', `Bearer ${token}`);
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  return fetch(`${CL_API}${path}`, { ...init, headers });
}

interface CalendlyMeUser {
  resource: {
    uri: string;
    name: string;
    email: string;
    scheduling_url: string;
    current_organization: string;
  };
}

async function fetchMe(token: string): Promise<CalendlyMeUser> {
  const r = await clBearerFetch(token, '/users/me');
  if (!r.ok) {
    const txt = await r.text();
    throw new Error(`calendly_users_me_failed: ${r.status} ${txt.slice(0, 200)}`);
  }
  return await r.json() as CalendlyMeUser;
}

// ───────────────────────────────────────────────────────────── webhook subscription

async function createWebhookSubscription(
  env: Env, token: string, callbackUrl: string, organization: string, scope_user: string,
): Promise<{ uri: string; signing_key: string } | null> {
  const body = JSON.stringify({
    url: callbackUrl,
    events: ['invitee.created', 'invitee.canceled'],
    organization,
    scope: 'user',
    user: scope_user,
  });
  const r = await fetch(`${CL_API}/webhook_subscriptions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body,
  });
  if (!r.ok) {
    // Don't fail the whole connect — sync + cron still work without webhooks.
    const txt = await r.text();
    console.warn(`[calendly] webhook subscribe failed: ${r.status} ${txt.slice(0, 200)}`);
    return null;
  }
  const out = await r.json() as { resource?: { uri?: string; signing_key?: string } };
  if (!out.resource?.uri || !out.resource?.signing_key) return null;
  return { uri: out.resource.uri, signing_key: out.resource.signing_key };
}

async function deleteWebhookSubscription(token: string, subscriptionUri: string): Promise<void> {
  // subscriptionUri is the full URL; extract the trailing id.
  try {
    const uri = subscriptionUri.startsWith('http') ? subscriptionUri : `${CL_API}${subscriptionUri}`;
    await fetch(uri, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
  } catch (e) {
    console.warn('[calendly] webhook delete failed (non-fatal):', (e as Error).message);
  }
}

// ───────────────────────────────────────────────────────────── connect

interface ExtendedConnectInput extends ConnectInput {}

async function connect(c: Context<{ Bindings: Env }>, _user: User, input: ExtendedConnectInput): Promise<ConnectResult> {
  let accessToken = '';
  let refreshToken: string | undefined;
  let expiresAt: number | undefined;
  let authMethod: 'oauth' | 'pat';

  if (input.oauth_code) {
    const tok = await exchangeCode(c.env, input.oauth_code);
    accessToken = tok.access_token;
    refreshToken = tok.refresh_token;
    expiresAt = Date.now() + tok.expires_in * 1000;
    authMethod = 'oauth';
  } else if (input.api_key) {
    // PAT path: validate against /users/me and reject anything else.
    accessToken = String(input.api_key).trim();
    if (!accessToken) throw new Error('calendly_pat_required');
    authMethod = 'pat';
  } else {
    throw new Error('calendly_requires_oauth_or_pat: provide oauth_code or api_key.');
  }

  const me = await fetchMe(accessToken);

  const credentials: CredentialBlob = {
    access_token: accessToken,
    token_type: 'Bearer',
    auth_method: authMethod,
    user_uri: me.resource.uri,
    organization_uri: me.resource.current_organization,
    scheduling_url: me.resource.scheduling_url,
    refresh_token: refreshToken,
    expires_at: expiresAt,
  } as CredentialBlob;

  // Webhook subscription is registered on the next sync() run (where
  // row.uid is available); the registry foundation has no post-connect
  // hook so we can't subscribe here. The signing key is persisted in
  // the credential blob and exposed via webhook_secret_enc on the
  // route's monkey-patch. (Previously computed `callbackBase` here for
  // the eventual `/webhook/:provider/:uid` URL — removed because the
  // value was unused; sync() recomputes it via stripTrailingSlashes
  // when the uid is known.)

  return {
    credentials,
    scopes: ['default'],
    external_account_id: me.resource.uri,
    external_account_name: me.resource.name || me.resource.email,
    capabilities: ['Embed scheduling', 'Pull bookings', 'Cancellation sync'],
    config: {
      scheduling_url: me.resource.scheduling_url,
      organization_uri: me.resource.current_organization,
      booking_url: me.resource.scheduling_url, // user-overridable via PATCH /:uid/config
      auth_method: authMethod,
    },
  };
}

// ───────────────────────────────────────────────────────────── authorize URL

async function buildAuthorizeUrl(c: Context<{ Bindings: Env }>, _user: User, state: string): Promise<string> {
  const { id } = await ensureCreds(c.env);
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: id,
    redirect_uri: redirectUri(c.env),
    state,
  });
  return `${CL_AUTH}/oauth/authorize?${params.toString()}`;
}

// ───────────────────────────────────────────────────────────── webhook ensure

/**
 * Idempotently make sure this integration has a Calendly webhook
 * subscription pointed at our worker. Stores the per-subscription
 * `signing_key` in the row's `webhook_secret_enc` column — the generic
 * webhook receiver verifies HMAC-SHA256 against it.
 */
async function ensureWebhookSubscription(env: Env, row: IntegrationRow): Promise<void> {
  // Re-read fresh row state — `row` may be stale if a concurrent isolate
  // already persisted webhook_secret_enc.
  const fresh = await env.DB.prepare('SELECT * FROM integrations WHERE id = ?')
    .bind(row.id).first<IntegrationRow>();
  if (!fresh || fresh.webhook_secret_enc) return;

  // KV-leased single-flight: prevents two concurrent syncs from both
  // calling Calendly's `POST /webhook_subscriptions` and creating
  // duplicate subscriptions (which then deliver every event twice).
  const lockKey = `calendly:wh_provision:${row.uid}`;
  const holder = crypto.randomUUID();
  let acquired = false;
  try {
    const cur = await env.RATE_LIMITS.get(lockKey);
    if (!cur) {
      await env.RATE_LIMITS.put(lockKey, holder, { expirationTtl: 60 });
      const verify = await env.RATE_LIMITS.get(lockKey);
      acquired = verify === holder;
    }
  } catch { /* lease infra failure → best-effort, single-flight not guaranteed */ }
  if (!acquired) return; // loser bails — winner persists, next sync sees it

  try {
    // Re-check under the lock — winner may have already persisted between
    // our first read and lock acquisition.
    const recheck = await env.DB.prepare('SELECT webhook_secret_enc, credentials_enc FROM integrations WHERE id = ?')
      .bind(row.id).first<{ webhook_secret_enc: string | null; credentials_enc: string }>();
    if (recheck?.webhook_secret_enc) return;

    const creds = await decryptCredentials(env, row.uid, recheck?.credentials_enc || row.credentials_enc);
    if (!creds) return;
    const userUri = typeof creds.user_uri === 'string' ? creds.user_uri as string : '';
    const orgUri = typeof creds.organization_uri === 'string' ? creds.organization_uri as string : '';
    if (!userUri || !orgUri) return;
    const callback = `${stripTrailingSlashes(env.APP_URL || '')}/api/integrations/webhook/${PROVIDER_KEY}/${row.uid}`;
    if (!callback.startsWith('http')) return;
    const token = await getActiveAccessToken(env, { ...row, credentials_enc: recheck?.credentials_enc || row.credentials_enc });
    const sub = await createWebhookSubscription(env, token, callback, orgUri, userUri);
    if (!sub) return;
    const enc = await encryptWebhookSecret(env, row.uid, sub.signing_key);
    const newCreds: CredentialBlob = { ...creds, webhook_uri: sub.uri } as CredentialBlob;
    const credEnc = await encryptCredentials(env, row.uid, newCreds);
    await env.DB.prepare(
      'UPDATE integrations SET webhook_secret_enc = ?, credentials_enc = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
    ).bind(enc, credEnc, row.id).run();
  } finally {
    try { await env.RATE_LIMITS.delete(lockKey); } catch {}
  }
}

// ───────────────────────────────────────────────────────────── sync

interface CalendlyEventResource {
  uri: string;
  name: string;
  status: string;       // 'active' | 'canceled'
  start_time: string;
  end_time: string;
  location?: { type?: string; location?: string; join_url?: string };
  event_memberships?: Array<{ user: string; user_email?: string; user_name?: string }>;
}

interface CalendlyInviteeResource {
  uri: string;
  email: string;
  name: string;
  status: string;
  cancel_url?: string;
  reschedule_url?: string;
}

async function listScheduledEvents(env: Env, row: IntegrationRow, userUri: string, fromIso: string, toIso: string): Promise<CalendlyEventResource[]> {
  const out: CalendlyEventResource[] = [];
  let url: string | null =
    `/scheduled_events?user=${encodeURIComponent(userUri)}` +
    `&min_start_time=${encodeURIComponent(fromIso)}&max_start_time=${encodeURIComponent(toIso)}` +
    `&count=100&sort=start_time:asc`;
  let pages = 0;
  while (url && pages < 10) {
    const r = await clFetch(env, row, url);
    if (!r.ok) {
      const txt = await r.text();
      throw new Error(`calendly_list_events_failed: ${r.status} ${txt.slice(0, 200)}`);
    }
    const body = await r.json() as { collection: CalendlyEventResource[]; pagination?: { next_page?: string } };
    out.push(...(body.collection || []));
    const next = body.pagination?.next_page || '';
    url = next ? next.replace(CL_API, '') : null;
    pages++;
  }
  return out;
}

async function fetchInviteeForEvent(env: Env, row: IntegrationRow, eventUri: string): Promise<CalendlyInviteeResource | null> {
  // eventUri is full URL ending in /scheduled_events/<uuid>
  const tail = eventUri.replace(CL_API, '');
  const r = await clFetch(env, row, `${tail}/invitees?count=1`);
  if (!r.ok) return null;
  const body = await r.json() as { collection: CalendlyInviteeResource[] };
  return body.collection?.[0] || null;
}

async function upsertCalendarEvent(
  env: Env, userId: number, ev: CalendlyEventResource, invitee: CalendlyInviteeResource | null,
): Promise<void> {
  const status = (ev.status || '').toLowerCase() === 'canceled' ? 'cancelled' : 'scheduled';
  const loc = ev.location || {};
  const locKind = loc.type === 'physical' ? 'in_person'
    : loc.type === 'phone_call' || loc.type === 'outbound_call' || loc.type === 'inbound_call' ? 'phone'
    : (loc.join_url || /zoom|meet|teams|webex/i.test(loc.location || '')) ? 'video'
    : 'custom';
  const locUri = loc.join_url || loc.location || null;
  const organizer = ev.event_memberships?.[0]?.user_email || null;
  const uid = `cl_${ev.uri.split('/').pop() || crypto.randomUUID()}`.slice(0, 64);
  const raw = JSON.stringify({ ev, invitee }).slice(0, 8000);
  await env.DB.prepare(
    'INSERT INTO calendar_events (uid, user_id, source, external_uri, external_id, title, start_at, end_at, status, location_kind, location_uri, organizer_email, invitee_email, invitee_name, notes, raw_json) ' +
    "VALUES (?, ?, 'calendly', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) " +
    'ON CONFLICT(source, external_uri) DO UPDATE SET ' +
    'title=excluded.title, start_at=excluded.start_at, end_at=excluded.end_at, status=excluded.status, ' +
    'location_kind=excluded.location_kind, location_uri=excluded.location_uri, organizer_email=excluded.organizer_email, ' +
    'invitee_email=excluded.invitee_email, invitee_name=excluded.invitee_name, raw_json=excluded.raw_json, ' +
    'updated_at=CURRENT_TIMESTAMP',
  ).bind(
    uid, userId, ev.uri, ev.uri.split('/').pop() || null, ev.name || 'Calendly meeting',
    ev.start_time, ev.end_time, status, locKind, locUri, organizer,
    invitee?.email || null, invitee?.name || null, null, raw,
  ).run();
}

async function sync(c: Context<{ Bindings: Env }>, _user: User, row: IntegrationRow): Promise<SyncResult> {
  // Provision webhook on first successful sync — gives the Calendly side time
  // to enable webhooks for new portals without blocking connect.
  try { await ensureWebhookSubscription(c.env, row); } catch (e) {
    console.warn('[calendly] ensureWebhookSubscription failed:', (e as Error).message);
  }
  const creds = await decryptCredentials(c.env, row.uid, row.credentials_enc);
  if (!creds) throw new Error('calendly_credentials_missing');
  const userUri = typeof creds.user_uri === 'string' ? creds.user_uri as string : '';
  if (!userUri) throw new Error('calendly_user_uri_missing');

  // Window: ~24h back through 60d forward. The cron-driven 15-min reconcile
  // therefore self-heals any webhook miss within 15 minutes for the future
  // and keeps recently-cancelled events flagged.
  const now = Date.now();
  const fromIso = new Date(now - 24 * 60 * 60 * 1000).toISOString();
  const toIso = new Date(now + 60 * 24 * 60 * 60 * 1000).toISOString();
  const events = await listScheduledEvents(c.env, row, userUri, fromIso, toIso);
  let upserts = 0;
  for (const ev of events) {
    let invitee: CalendlyInviteeResource | null = null;
    try { invitee = await fetchInviteeForEvent(c.env, row, ev.uri); }
    catch { /* invitee fetch is best-effort */ }
    await upsertCalendarEvent(c.env, row.user_id, ev, invitee);
    upserts++;
  }
  return { summary: `events=${events.length} upserts=${upserts}`, counts: { events: events.length } };
}

// ───────────────────────────────────────────────────────────── webhook

interface CalendlyWebhookEvent {
  event: 'invitee.created' | 'invitee.canceled' | string;
  payload?: {
    event?: string;          // event URI
    uri?: string;            // invitee URI
    email?: string;
    name?: string;
    status?: string;
    cancel_reason?: string;
  };
}

async function webhook(
  c: Context<{ Bindings: Env }>, row: IntegrationRow, body: string, _signature: string | null,
): Promise<{ summary: string }> {
  // Signature verification is handled centrally in routes/integrations.ts
  // against `webhook_secret_enc` (Calendly's per-subscription signing key).
  const evt = JSON.parse(body) as CalendlyWebhookEvent;
  const eventUri = evt.payload?.event;
  if (!eventUri) return { summary: `noop event=${evt.event}` };

  // Pull the canonical event resource so our row matches what /sync would write.
  const tail = eventUri.replace(CL_API, '');
  const r = await clFetch(c.env, row, tail);
  if (!r.ok) {
    return { summary: `event_fetch_failed status=${r.status}` };
  }
  const ev = (await r.json() as { resource: CalendlyEventResource }).resource;
  let invitee: CalendlyInviteeResource | null = null;
  try { invitee = await fetchInviteeForEvent(c.env, row, ev.uri); } catch {}
  await upsertCalendarEvent(c.env, row.user_id, ev, invitee);
  return { summary: `${evt.event} ${ev.uri.split('/').pop()}` };
}

// ───────────────────────────────────────────────────────────── disconnect

async function disconnect(c: Context<{ Bindings: Env }>, _user: User, row: IntegrationRow): Promise<void> {
  const creds = await decryptCredentials(c.env, row.uid, row.credentials_enc);
  if (!creds) return;
  const webhookUri = typeof creds.webhook_uri === 'string' ? creds.webhook_uri as string : '';
  // Best-effort: revoke webhook subscription. We don't revoke OAuth tokens
  // because Calendly doesn't expose a revoke endpoint; the user can revoke
  // from their Calendly account settings.
  if (webhookUri) {
    try {
      const token = await getActiveAccessToken(c.env, row);
      await deleteWebhookSubscription(token, webhookUri);
    } catch (e) {
      console.warn('[calendly] disconnect webhook revoke failed:', (e as Error).message);
    }
  }
  // Delete the projected events so they disappear from /api/calendar.
  try {
    await c.env.DB.prepare("DELETE FROM calendar_events WHERE user_id = ? AND source = 'calendly'")
      .bind(row.user_id).run();
  } catch { /* table may not exist on bare deploys */ }
}

// ───────────────────────────────────────────────────────────── action / config

async function action(c: Context<{ Bindings: Env }>, _user: User, row: IntegrationRow, name: string, _body: unknown): Promise<unknown> {
  if (name === 'list_event_types') {
    const creds = await decryptCredentials(c.env, row.uid, row.credentials_enc);
    if (!creds) throw new Error('calendly_credentials_missing');
    const userUri = typeof creds.user_uri === 'string' ? creds.user_uri as string : '';
    if (!userUri) throw new Error('calendly_user_uri_missing');
    const r = await clFetch(c.env, row, `/event_types?user=${encodeURIComponent(userUri)}&active=true&count=50`);
    if (!r.ok) throw new Error(`calendly_event_types_failed: ${r.status}`);
    const out = await r.json() as { collection: Array<{ uri: string; name: string; scheduling_url: string; duration: number; active: boolean; slug: string }> };
    return {
      event_types: (out.collection || []).map(et => ({
        uri: et.uri, name: et.name, scheduling_url: et.scheduling_url,
        duration_min: et.duration, active: et.active, slug: et.slug,
      })),
    };
  }
  throw new Error(`unknown_action: ${name}`);
}

function validateConfig(
  patch: Record<string, unknown>,
  _existing: Record<string, unknown>,
): { ok: true; patch: Record<string, unknown> } | { ok: false; error: string } {
  const ALLOWED = new Set(['booking_url', 'default_event_type_uri', 'default_event_type_name']);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(patch)) {
    if (!ALLOWED.has(k)) return { ok: false, error: `unknown_config_key: ${k}` };
    if (v === null) { out[k] = null; continue; }
    if (typeof v !== 'string') return { ok: false, error: `${k}_must_be_string` };
    if (v.length > 500) return { ok: false, error: `${k}_too_long` };
    if (k === 'booking_url' || k === 'default_event_type_uri') {
      if (!/^https?:\/\//.test(v)) return { ok: false, error: `${k}_must_be_url` };
    }
    out[k] = v;
  }
  return { ok: true, patch: out };
}

// ───────────────────────────────────────────────────────────── webhook signature
//
// Calendly's `Calendly-Webhook-Signature` header is Stripe-style:
//   t=<unix_seconds>,v1=<hex_hmac>
// The HMAC body is the literal string `<t>.<raw_body>` keyed off the
// per-subscription signing_key. We also enforce a 5-minute timestamp
// freshness window to defeat replay.
async function verifyWebhook(secret: string, body: string, headers: Headers): Promise<boolean> {
  const header = headers.get('calendly-webhook-signature') || headers.get('Calendly-Webhook-Signature') || '';
  if (!header) return false;
  let t = '', sig = '';
  for (const part of header.split(',')) {
    const [k, v] = part.split('=');
    const key = (k || '').trim().toLowerCase();
    const val = (v || '').trim();
    if (key === 't') t = val;
    else if (key === 'v1') sig = val;
  }
  if (!t || !sig) return false;
  const ts = Number(t);
  if (!Number.isFinite(ts)) return false;
  // 5-minute replay window.
  if (Math.abs(Date.now() / 1000 - ts) > 300) return false;
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const mac = await crypto.subtle.sign('HMAC', key, enc.encode(`${t}.${body}`));
  const hex = Array.from(new Uint8Array(mac)).map(b => b.toString(16).padStart(2, '0')).join('');
  // constant-time compare
  if (hex.length !== sig.length) return false;
  let diff = 0;
  for (let i = 0; i < hex.length; i++) diff |= hex.charCodeAt(i) ^ sig.charCodeAt(i);
  return diff === 0;
}

// ───────────────────────────────────────────────────────────── postConnect

/**
 * Fire-and-forget hook the integrations route invokes via `waitUntil`
 * after a fresh connect. Eliminates the 15-minute "dead period" by
 * provisioning the webhook subscription + running a first sync
 * immediately. Errors are non-fatal — the cron will retry.
 */
async function postConnect(c: Context<{ Bindings: Env }>, user: User, row: IntegrationRow): Promise<void> {
  try { await ensureWebhookSubscription(c.env, row); }
  catch (e) { console.warn('[calendly] postConnect ensureWebhookSubscription:', (e as Error).message); }
  try {
    // Re-load row to pick up the freshly-persisted webhook_secret_enc.
    const fresh = await c.env.DB.prepare('SELECT * FROM integrations WHERE id = ?')
      .bind(row.id).first<IntegrationRow>();
    if (fresh) await sync(c, user, fresh);
  } catch (e) {
    console.warn('[calendly] postConnect first sync:', (e as Error).message);
  }
}

const impl: ProviderImpl = {
  key: PROVIDER_KEY,
  connect,
  buildAuthorizeUrl,
  sync,
  webhook,
  disconnect,
  action,
  validateConfig,
  verifyWebhook,
  postConnect,
};
registerProvider(impl);

/**
 * Cron entry-point. Iterates every active Calendly integration and runs
 * `sync` against it. Webhooks cover real-time delivery; this 15-minute
 * reconcile is the safety-net for portals where webhooks are disabled or
 * dropped. Per-integration error isolation (one failure must not stop the
 * scan).
 */
export async function syncAllCalendlyIntegrations(env: Env): Promise<{ scanned: number; ok: number; failed: number }> {
  let scanned = 0, ok = 0, failed = 0;
  let rows: { results: IntegrationRow[] };
  try {
    rows = await env.DB.prepare(
      "SELECT * FROM integrations WHERE provider_key = 'calendly' AND status = 'active' LIMIT 200",
    ).all<IntegrationRow>() as unknown as { results: IntegrationRow[] };
  } catch {
    return { scanned: 0, ok: 0, failed: 0 };
  }
  for (const row of (rows.results || [])) {
    scanned++;
    try {
      const stubCtx = { env } as unknown as Context<{ Bindings: Env }>;
      const stubUser = { id: row.user_id } as User;
      const out = await sync(stubCtx, stubUser, row);
      await env.DB.prepare(
        'UPDATE integrations SET last_synced_at = CURRENT_TIMESTAMP, last_error = NULL WHERE id = ?',
      ).bind(row.id).run();
      ok++;
      console.info(`[calendly] cron sync ok integration=${row.id}: ${out.summary}`);
    } catch (e) {
      failed++;
      const msg = (e as Error).message?.slice(0, 500) || 'sync failed';
      try {
        await env.DB.prepare(
          "UPDATE integrations SET last_error = ?, status = CASE WHEN ? LIKE '%refresh%' THEN 'error' ELSE status END WHERE id = ?",
        ).bind(msg, msg, row.id).run();
      } catch { /* non-fatal */ }
      console.error(`[calendly] cron sync failed integration=${row.id}: ${msg}`);
    }
  }
  return { scanned, ok, failed };
}
