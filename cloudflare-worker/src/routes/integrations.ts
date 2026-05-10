/**
 * Task #1 — Integrations foundation router.
 *
 * Replaces the previous 501-stub surface with a full implementation that
 * eight downstream provider tasks (#2..#9) plug into. Provider-agnostic
 * concerns live here:
 *   - registry & marketplace catalogue (`/available`)
 *   - per-user connection list, connect, disconnect, sync, push (`/`)
 *   - inbound webhook receiver (`/webhook/:provider/:uid`)
 *   - waitlist for coming-soon providers (`/waitlist`)
 *   - per-connection log feed (`/:uid/logs`)
 *
 * Tier gating: founders are gated by `subscription_tier`; admin/partner/
 * investor/mentor roles bypass via middleware/requireTier.ts.
 *
 * Credentials are encrypted at rest via integrations/secrets.ts (built on
 * services/columnCipher.ts). NEVER write a raw api_key/access_token/
 * refresh_token into D1.
 */
import { Hono } from 'hono';
import type { Context } from 'hono';
import type { Env, User } from '../types';
import { getSQL } from '../db';
import { requireAuth } from '../auth';
import { ensureTier, userMeetsTier, tierUpsell } from '../middleware/requireTier';
import { hashEmail } from '../util/hashEmail';
import {
  REGISTRY,
  publicDescriptor,
  ensureIntegrationsSchema,
  getDescriptor,
  getProviderImpl,
  type IntegrationRow,
} from '../integrations/registry';
import {
  encryptCredentials,
  decryptCredentials,
  encryptWebhookSecret,
  decryptWebhookSecret,
  previewApiKey,
  type CredentialBlob,
} from '../integrations/secrets';
import { buildPkce, issueOauthState, consumeOauthState } from '../integrations/oauth';

const integrations = new Hono<{ Bindings: Env }>();

const ALLOWED_ROLES = new Set(['admin', 'founder', 'partner', 'investor', 'mentor', 'operator', 'service_provider']);

function ensureRole(c: Context<{ Bindings: Env }>, user: User) {
  if (!ALLOWED_ROLES.has((user.role || '').toLowerCase())) {
    throw new Response(JSON.stringify({ error: 'forbidden', message: 'Your role cannot manage integrations.' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

function safeJson<T>(s: string | null | undefined, def: T): T {
  if (!s) return def;
  try { return JSON.parse(s) as T; } catch { return def; }
}

function newUid(): string {
  // 16-byte random hex; collision-resistant across all users without DB lookup.
  const buf = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(buf).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function logEvent(
  env: Env,
  opts: {
    integration_id: number;
    user_id: number;
    provider_key: string;
    direction: 'inbound' | 'outbound' | 'internal';
    event_type: string;
    status: 'ok' | 'error';
    http_status?: number;
    request_summary?: string;
    response_summary?: string;
    external_id?: string | null;
    payload?: unknown;
  },
): Promise<void> {
  try {
    await env.DB.prepare(
      'INSERT INTO integration_logs (integration_id, user_id, provider_key, direction, event_type, status, http_status, request_summary, response_summary, external_id, payload_json) ' +
      'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    ).bind(
      opts.integration_id,
      opts.user_id,
      opts.provider_key,
      opts.direction,
      opts.event_type,
      opts.status,
      opts.http_status ?? null,
      (opts.request_summary ?? '').slice(0, 1000),
      (opts.response_summary ?? '').slice(0, 1000),
      opts.external_id ?? null,
      opts.payload === undefined ? null : JSON.stringify(redactPayload(opts.payload)).slice(0, 4000),
    ).run();
  } catch (e) {
    // Logging failures must never abort the request itself.
    console.warn('[integrations] logEvent failed:', (e as Error).message);
  }
}

async function loadRow(env: Env, uid: string, userId: number, isAdmin: boolean): Promise<IntegrationRow | null> {
  const stmt = isAdmin
    ? env.DB.prepare('SELECT * FROM integrations WHERE uid = ?').bind(uid)
    : env.DB.prepare('SELECT * FROM integrations WHERE uid = ? AND user_id = ?').bind(uid, userId);
  const row = await stmt.first<IntegrationRow>();
  return row || null;
}

function rowToPublic(row: IntegrationRow, credPreview: string | null) {
  const desc = getDescriptor(row.provider_key);
  return {
    uid: row.uid,
    provider_key: row.provider_key,
    integration_type: desc?.integration_type ?? 'custom',
    display_name: row.display_name || desc?.display_name || row.provider_key,
    status: row.status,
    auth_type: row.auth_type,
    capabilities: safeJson<string[]>(row.capabilities_json, desc?.capabilities ?? []),
    scopes: safeJson<string[]>(row.scopes_json, []),
    config: safeJson<Record<string, unknown>>(row.config_json, {}),
    external_account_id: row.external_account_id,
    external_account_name: row.external_account_name,
    api_key_preview: credPreview,
    has_webhook_secret: !!row.webhook_secret_enc,
    last_synced_at: row.last_synced_at,
    last_error: row.last_error,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

// ───────────────────────────────────────────────────────────────────── catalogue

/**
 * GET /api/integrations/available
 * Returns the full registry plus, for the calling user, which providers are
 * tier-locked. The frontend uses this to render the three-section page
 * (Connected / Available / Coming Soon) and the tier pills.
 */
integrations.get('/available', async (c) => {
  await ensureIntegrationsSchema(c.env);
  const user = await requireAuth(c);
  ensureRole(c, user);
  const providers = REGISTRY.map(p => {
    const pub = publicDescriptor(p);
    return {
      ...pub,
      tier_locked: p.tier === 'free' ? false : !userMeetsTier(user, p.tier as 'growth' | 'studio'),
    };
  });
  return c.json({ ok: true, providers });
});

// ───────────────────────────────────────────────────────────────────── list mine

const listMine = async (c: Context<{ Bindings: Env }>) => {
  await ensureIntegrationsSchema(c.env);
  const user = await requireAuth(c);
  ensureRole(c, user);
  const sql = getSQL(c.env);
  const isAdmin = (user.role || '').toLowerCase() === 'admin';
  const rows = (isAdmin
    ? await sql`SELECT * FROM integrations ORDER BY datetime(created_at) DESC`
    : await sql`SELECT * FROM integrations WHERE user_id = ${user.id} ORDER BY datetime(created_at) DESC`
  ) as IntegrationRow[];
  // Decrypt only enough to render a 4-char preview; bulk-decrypt is fine
  // because each row's blob is small and the page lists are short.
  const items = await Promise.all(rows.map(async r => {
    const creds = await decryptCredentials(c.env, r.uid, r.credentials_enc);
    return rowToPublic(r, previewApiKey(creds));
  }));
  return c.json({ ok: true, items });
};
integrations.get('', listMine);
integrations.get('/', listMine);

// ───────────────────────────────────────────────────────────────────── connect

interface ConnectBody {
  provider_name?: string;
  provider_key?: string;
  api_key?: string;
  webhook_secret?: string;
  display_name?: string;
  config?: Record<string, unknown>;
  oauth_code?: string;
  oauth_state?: string;
}

integrations.post('/connect', async (c) => {
  await ensureIntegrationsSchema(c.env);
  const user = await requireAuth(c);
  ensureRole(c, user);

  const body = (await c.req.json().catch(() => ({}))) as ConnectBody;
  const key = String(body.provider_key || body.provider_name || '').toLowerCase().trim();
  if (!key) return c.json({ error: 'provider_key is required' }, 400);

  const desc = getDescriptor(key);
  if (!desc) return c.json({ error: 'unknown_provider', provider_key: key }, 404);

  if (desc.status === 'coming_soon') {
    return c.json({
      error: 'provider_coming_soon',
      message: `${desc.display_name} isn't available yet — join the waitlist to be notified.`,
      notify_me_url: `/api/integrations/notify-me`,
    }, 409);
  }

  // Tier gate (founders only; admin/partner/investor/mentor bypass).
  if (desc.tier !== 'free') {
    if (!userMeetsTier(user, desc.tier as 'growth' | 'studio')) {
      return c.json(tierUpsell(desc.tier as 'growth' | 'studio'), 402);
    }
  }

  const impl = getProviderImpl(key);
  if (!impl) {
    return c.json({
      error: 'provider_rolling_out',
      message: `${desc.display_name} is rolling out — please check back shortly.`,
      retry_after_seconds: 86400,
    }, 503, { 'Retry-After': '86400' });
  }

  let result;
  try {
    result = await impl.connect(c, user, {
      api_key: body.api_key,
      oauth_code: body.oauth_code,
      oauth_state: body.oauth_state,
      display_name: body.display_name,
      config: body.config,
      webhook_secret: body.webhook_secret,
    });
  } catch (e) {
    return c.json({ error: 'connect_failed', message: (e as Error).message || 'Provider rejected the credentials.' }, 400);
  }

  // Upsert. Insert with random uid, encrypt against that uid; on conflict
  // (user already has this provider) update credentials in place but keep
  // the existing uid so AAD remains valid.
  const sql = getSQL(c.env);
  const existing = await c.env.DB.prepare(
    'SELECT uid FROM integrations WHERE user_id = ? AND provider_key = ?',
  ).bind(user.id, key).first<{ uid: string }>();

  const uid = existing?.uid || newUid();
  const credsEnc = await encryptCredentials(c.env, uid, result.credentials);
  const webhookEnc = body.webhook_secret
    ? await encryptWebhookSecret(c.env, uid, body.webhook_secret)
    : null;

  if (existing) {
    await c.env.DB.prepare(
      'UPDATE integrations SET ' +
      'display_name = ?, status = \'active\', auth_type = ?, ' +
      'credentials_enc = ?, ' +
      (webhookEnc ? 'webhook_secret_enc = ?, ' : '') +
      'config_json = ?, capabilities_json = ?, scopes_json = ?, ' +
      'external_account_id = ?, external_account_name = ?, ' +
      'last_error = NULL, updated_at = CURRENT_TIMESTAMP ' +
      'WHERE uid = ?',
    ).bind(
      ...(webhookEnc
        ? [
            body.display_name || desc.display_name, desc.auth_type,
            credsEnc, webhookEnc,
            JSON.stringify(result.config ?? {}),
            JSON.stringify(result.capabilities ?? desc.capabilities),
            JSON.stringify(result.scopes ?? []),
            result.external_account_id ?? null, result.external_account_name ?? null,
            uid,
          ]
        : [
            body.display_name || desc.display_name, desc.auth_type,
            credsEnc,
            JSON.stringify(result.config ?? {}),
            JSON.stringify(result.capabilities ?? desc.capabilities),
            JSON.stringify(result.scopes ?? []),
            result.external_account_id ?? null, result.external_account_name ?? null,
            uid,
          ]),
    ).run();
  } else {
    await c.env.DB.prepare(
      'INSERT INTO integrations (uid, user_id, provider_key, display_name, status, auth_type, credentials_enc, webhook_secret_enc, config_json, capabilities_json, scopes_json, external_account_id, external_account_name) ' +
      "VALUES (?, ?, ?, ?, 'active', ?, ?, ?, ?, ?, ?, ?, ?)",
    ).bind(
      uid, user.id, key, body.display_name || desc.display_name, desc.auth_type,
      credsEnc, webhookEnc,
      JSON.stringify(result.config ?? {}),
      JSON.stringify(result.capabilities ?? desc.capabilities),
      JSON.stringify(result.scopes ?? []),
      result.external_account_id ?? null, result.external_account_name ?? null,
    ).run();
  }

  const row = await loadRow(c.env, uid, user.id, false);
  if (row) {
    await logEvent(c.env, {
      integration_id: row.id, user_id: user.id, provider_key: key,
      direction: 'outbound', event_type: existing ? 'reconnect' : 'connect', status: 'ok',
      response_summary: existing ? 'Credentials updated.' : 'Connection established.',
      external_id: result.external_account_id ?? null,
    });
    // Hash actor when writing to the global activity_logs (T22.1 convention).
    try {
      const actorHash = await hashEmail(user.email);
      await c.env.DB.prepare(
        'INSERT INTO activity_logs (user_id, actor, action, details) VALUES (?, ?, ?, ?)',
      ).bind(user.id, actorHash, existing ? 'integration_reconnected' : 'integration_connected', JSON.stringify({ provider_key: key })).run();
    } catch { /* activity_logs may not exist in some schemas */ }
  }

  await sql.end();
  return c.json({ ok: true, item: row ? rowToPublic(row, previewApiKey(result.credentials as CredentialBlob)) : null });
});

// ───────────────────────────────────────────────────────────────────── disconnect

integrations.delete('/:uid', async (c) => {
  await ensureIntegrationsSchema(c.env);
  const user = await requireAuth(c);
  ensureRole(c, user);
  const uid = c.req.param('uid');
  const isAdmin = (user.role || '').toLowerCase() === 'admin';
  const row = await loadRow(c.env, uid, user.id, isAdmin);
  if (!row) return c.json({ error: 'not_found' }, 404);

  const impl = getProviderImpl(row.provider_key);
  if (impl?.disconnect) {
    try { await impl.disconnect(c, user, row); }
    catch (e) { console.warn('[integrations] provider disconnect threw:', (e as Error).message); }
  }

  await c.env.DB.prepare('DELETE FROM integrations WHERE id = ?').bind(row.id).run();
  await logEvent(c.env, {
    integration_id: row.id, user_id: user.id, provider_key: row.provider_key,
    direction: 'internal', event_type: 'disconnect', status: 'ok',
    response_summary: 'Connection removed.',
  });
  return c.json({ ok: true });
});

// ───────────────────────────────────────────────────────────────────── sync

integrations.post('/:uid/sync', async (c) => {
  await ensureIntegrationsSchema(c.env);
  const user = await requireAuth(c);
  ensureRole(c, user);
  const uid = c.req.param('uid');
  const isAdmin = (user.role || '').toLowerCase() === 'admin';
  const row = await loadRow(c.env, uid, user.id, isAdmin);
  if (!row) return c.json({ error: 'not_found' }, 404);

  const desc = getDescriptor(row.provider_key);
  if (desc && desc.tier !== 'free') ensureTier(user, desc.tier as 'growth' | 'studio');

  const impl = getProviderImpl(row.provider_key);
  if (!impl?.sync) {
    return c.json({ error: 'sync_not_supported', message: 'This provider has no sync action.' }, 422);
  }
  try {
    const out = await impl.sync(c, user, row);
    await c.env.DB.prepare('UPDATE integrations SET last_synced_at = CURRENT_TIMESTAMP, last_error = NULL, status = \'active\' WHERE id = ?').bind(row.id).run();
    await logEvent(c.env, {
      integration_id: row.id, user_id: user.id, provider_key: row.provider_key,
      direction: 'outbound', event_type: 'sync', status: 'ok',
      response_summary: out.summary, external_id: out.external_id ?? null,
      payload: out.counts,
    });
    return c.json({ ok: true, summary: out.summary, counts: out.counts ?? {} });
  } catch (e) {
    const msg = (e as Error).message || 'sync failed';
    await c.env.DB.prepare('UPDATE integrations SET last_error = ?, status = \'error\' WHERE id = ?').bind(msg.slice(0, 500), row.id).run();
    await logEvent(c.env, {
      integration_id: row.id, user_id: user.id, provider_key: row.provider_key,
      direction: 'outbound', event_type: 'sync', status: 'error', response_summary: msg,
    });
    return c.json({ error: 'sync_failed', message: msg }, 502);
  }
});

// ───────────────────────────────────────────────────────────────────── push

integrations.post('/:uid/push', async (c) => {
  await ensureIntegrationsSchema(c.env);
  const user = await requireAuth(c);
  ensureRole(c, user);
  const uid = c.req.param('uid');
  const isAdmin = (user.role || '').toLowerCase() === 'admin';
  const row = await loadRow(c.env, uid, user.id, isAdmin);
  if (!row) return c.json({ error: 'not_found' }, 404);

  const desc = getDescriptor(row.provider_key);
  if (desc && desc.tier !== 'free') ensureTier(user, desc.tier as 'growth' | 'studio');

  const impl = getProviderImpl(row.provider_key);
  if (!impl?.push) {
    return c.json({ error: 'push_not_supported', message: 'This provider has no push action.' }, 422);
  }

  const payload = await c.req.json().catch(() => ({}));
  try {
    const out = await impl.push(c, user, row, payload);
    await logEvent(c.env, {
      integration_id: row.id, user_id: user.id, provider_key: row.provider_key,
      direction: 'outbound', event_type: 'push', status: 'ok',
      http_status: out.http_status, response_summary: out.summary,
      external_id: out.external_id ?? null, payload,
    });
    return c.json({ ok: true, summary: out.summary, external_id: out.external_id ?? null });
  } catch (e) {
    const msg = (e as Error).message || 'push failed';
    await logEvent(c.env, {
      integration_id: row.id, user_id: user.id, provider_key: row.provider_key,
      direction: 'outbound', event_type: 'push', status: 'error', response_summary: msg, payload,
    });
    return c.json({ error: 'push_failed', message: msg }, 502);
  }
});

// ───────────────────────────────────────────────────────────────────── logs

integrations.get('/:uid/logs', async (c) => {
  await ensureIntegrationsSchema(c.env);
  const user = await requireAuth(c);
  ensureRole(c, user);
  const uid = c.req.param('uid');
  const isAdmin = (user.role || '').toLowerCase() === 'admin';
  const row = await loadRow(c.env, uid, user.id, isAdmin);
  if (!row) return c.json({ error: 'not_found' }, 404);

  const limit = Math.max(1, Math.min(500, Number(c.req.query('limit') || 100)));
  const rows = await c.env.DB.prepare(
    'SELECT id, direction, event_type, status, http_status, request_summary, response_summary, external_id, payload_json, created_at ' +
    'FROM integration_logs WHERE integration_id = ? ORDER BY datetime(created_at) DESC LIMIT ?',
  ).bind(row.id, limit).all();
  interface LogRow {
    id: number;
    direction: string;
    event_type: string;
    status: string;
    http_status: number | null;
    request_summary: string | null;
    response_summary: string | null;
    external_id: string | null;
    payload_json: string | null;
    created_at: string;
  }
  const items = ((rows.results || []) as unknown as LogRow[]).map(r => ({
    id: r.id,
    direction: r.direction,
    event_type: r.event_type,
    status: r.status,
    http_status: r.http_status,
    request_summary: r.request_summary,
    response_summary: r.response_summary,
    external_id: r.external_id,
    payload: safeJson(r.payload_json, null),
    created_at: r.created_at,
  }));
  return c.json({ ok: true, items });
});

// ───────────────────────────────────────────────────────────────────── webhook

integrations.post('/webhook/:provider/:uid', async (c) => {
  await ensureIntegrationsSchema(c.env);
  const provider = c.req.param('provider').toLowerCase();
  const uid = c.req.param('uid');

  const row = await c.env.DB.prepare('SELECT * FROM integrations WHERE uid = ? AND provider_key = ?')
    .bind(uid, provider).first<IntegrationRow>();
  if (!row) return c.json({ error: 'not_found' }, 404);

  const body = await c.req.text();
  const signature = c.req.header('x-axal-signature') || c.req.header('x-hub-signature-256') || c.req.header('x-signature') || null;

  // HMAC verification when a webhook_secret is configured. We compute the
  // SHA-256 HMAC over the raw body and compare with constant-time equality.
  // A missing signature header is rejected just as firmly as a wrong one —
  // otherwise an attacker who knows the URL could replay events without
  // ever holding the secret.
  if (row.webhook_secret_enc) {
    const secret = await decryptWebhookSecret(c.env, row.uid, row.webhook_secret_enc);
    if (!secret) {
      await logEvent(c.env, {
        integration_id: row.id, user_id: row.user_id, provider_key: provider,
        direction: 'inbound', event_type: 'webhook', status: 'error',
        response_summary: 'webhook_secret_unreadable',
      });
      return c.json({ error: 'webhook_secret_unreadable' }, 500);
    }
    if (!signature) {
      await logEvent(c.env, {
        integration_id: row.id, user_id: row.user_id, provider_key: provider,
        direction: 'inbound', event_type: 'webhook', status: 'error',
        response_summary: 'missing_signature',
      });
      return c.json({ error: 'missing_signature' }, 401);
    }
    const expected = await hmacHex(secret, body);
    const provided = signature.replace(/^sha256=/i, '').trim().toLowerCase();
    if (!constantTimeEqual(provided, expected)) {
      await logEvent(c.env, {
        integration_id: row.id, user_id: row.user_id, provider_key: provider,
        direction: 'inbound', event_type: 'webhook', status: 'error',
        response_summary: 'invalid_signature',
      });
      return c.json({ error: 'invalid_signature' }, 401);
    }
  }

  const impl = getProviderImpl(provider);
  if (!impl?.webhook) {
    // Without a handler we simply ack and store the (redacted) payload so
    // ops can inspect via /:uid/logs. We deliberately do NOT 501 — the
    // foundation accepts the inbound event for later replay.
    await logEvent(c.env, {
      integration_id: row.id, user_id: row.user_id, provider_key: provider,
      direction: 'inbound', event_type: 'webhook', status: 'ok',
      response_summary: 'received (no handler yet)',
      payload: safeJson<unknown>(body, body.slice(0, 500)),
    });
    return c.json({ ok: true, accepted: true });
  }
  try {
    const out = await impl.webhook(c, row, body, signature);
    await logEvent(c.env, {
      integration_id: row.id, user_id: row.user_id, provider_key: provider,
      direction: 'inbound', event_type: 'webhook', status: 'ok',
      response_summary: out.summary,
    });
    return c.json({ ok: true });
  } catch (e) {
    const msg = (e as Error).message || 'webhook failed';
    await logEvent(c.env, {
      integration_id: row.id, user_id: row.user_id, provider_key: provider,
      direction: 'inbound', event_type: 'webhook', status: 'error', response_summary: msg,
    });
    return c.json({ error: 'webhook_failed', message: msg }, 500);
  }
});

async function hmacHex(secret: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body));
  return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('');
}

/** Constant-time equality over equal-length strings; false for length mismatch. */
function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Recursive secret-redactor for payload bodies before they hit the log
 * table. We can't trust providers to keep secrets out of webhook bodies
 * (Slack scopes, HubSpot oauth response replays, etc.) — so we match keys
 * against a denylist and replace the value with a marker before storage.
 * Also caps array/string lengths so a runaway payload can't blow up the
 * row size.
 */
const SECRET_KEY_RE = /(api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|webhook[_-]?secret|secret|password|signing[_-]?key|private[_-]?key|bearer|authorization|x-api-key|cookie|set-cookie|session)/i;
function redactPayload(value: unknown, depth = 0): unknown {
  if (depth > 6) return '[truncated]';
  if (value == null) return value;
  if (typeof value === 'string') return value.length > 2000 ? value.slice(0, 2000) + '…' : value;
  if (typeof value !== 'object') return value;
  if (Array.isArray(value)) {
    return value.slice(0, 50).map(v => redactPayload(v, depth + 1));
  }
  const out: Record<string, unknown> = {};
  let count = 0;
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (++count > 100) { out['[truncated]'] = true; break; }
    if (SECRET_KEY_RE.test(k)) { out[k] = '[redacted]'; continue; }
    out[k] = redactPayload(v, depth + 1);
  }
  return out;
}

// ───────────────────────────────────────────────────────────────────── waitlist

integrations.post('/waitlist', async (c) => {
  await ensureIntegrationsSchema(c.env);
  const user = await requireAuth(c);
  ensureRole(c, user);
  const body = await c.req.json().catch(() => ({}));
  const key = String(body?.provider_key || '').toLowerCase().trim();
  const desc = getDescriptor(key);
  if (!desc) return c.json({ error: 'unknown_provider' }, 404);
  const notes = body?.notes ? String(body.notes).slice(0, 1000) : null;
  try {
    await c.env.DB.prepare(
      'INSERT INTO integration_waitlist (user_id, provider_key, notes) VALUES (?, ?, ?) ' +
      'ON CONFLICT(user_id, provider_key) DO UPDATE SET notes = excluded.notes',
    ).bind(user.id, key, notes).run();
  } catch (e) {
    return c.json({ error: 'waitlist_failed', message: (e as Error).message }, 500);
  }
  return c.json({ ok: true, joined: true, provider_key: key });
});

integrations.get('/waitlist', async (c) => {
  await ensureIntegrationsSchema(c.env);
  const user = await requireAuth(c);
  ensureRole(c, user);
  const rows = await c.env.DB.prepare(
    'SELECT provider_key, notes, created_at, notified_at FROM integration_waitlist WHERE user_id = ? ORDER BY datetime(created_at) DESC',
  ).bind(user.id).all();
  return c.json({ ok: true, items: rows.results || [] });
});

// `notify-me` aliases — preferred public surface for the Coming Soon
// "Notify me" button. `/waitlist` remains for admin/list use.
integrations.post('/notify-me', async (c) => {
  await ensureIntegrationsSchema(c.env);
  const user = await requireAuth(c);
  ensureRole(c, user);
  const body = await c.req.json().catch(() => ({}));
  const key = String(body?.provider_key || '').toLowerCase().trim();
  const desc = getDescriptor(key);
  if (!desc) return c.json({ error: 'unknown_provider' }, 404);
  const notes = body?.notes ? String(body.notes).slice(0, 1000) : null;
  await c.env.DB.prepare(
    'INSERT INTO integration_waitlist (user_id, provider_key, notes) VALUES (?, ?, ?) ' +
    'ON CONFLICT(user_id, provider_key) DO UPDATE SET notes = excluded.notes',
  ).bind(user.id, key, notes).run();
  return c.json({ ok: true, joined: true, provider_key: key });
});

integrations.delete('/notify-me/:provider', async (c) => {
  await ensureIntegrationsSchema(c.env);
  const user = await requireAuth(c);
  ensureRole(c, user);
  const key = c.req.param('provider').toLowerCase();
  await c.env.DB.prepare('DELETE FROM integration_waitlist WHERE user_id = ? AND provider_key = ?').bind(user.id, key).run();
  return c.json({ ok: true });
});

integrations.delete('/waitlist/:provider', async (c) => {
  await ensureIntegrationsSchema(c.env);
  const user = await requireAuth(c);
  ensureRole(c, user);
  const key = c.req.param('provider').toLowerCase();
  await c.env.DB.prepare('DELETE FROM integration_waitlist WHERE user_id = ? AND provider_key = ?').bind(user.id, key).run();
  return c.json({ ok: true });
});

// ───────────────────────────────────────────────────────────────────── oauth (foundation only)

/**
 * Foundation OAuth handshake helpers. Provider impls implement
 * `buildAuthorizeUrl` to return a provider-specific URL with the embedded
 * `state`. The state is returned to the client so `/connect` can replay it
 * during the callback. Providers without OAuth return 404.
 */
integrations.get('/oauth/:provider/start', async (c) => {
  await ensureIntegrationsSchema(c.env);
  const user = await requireAuth(c);
  ensureRole(c, user);
  const provider = c.req.param('provider').toLowerCase();
  const desc = getDescriptor(provider);
  if (!desc || desc.auth_type !== 'oauth2') return c.json({ error: 'oauth_not_supported' }, 404);
  if (desc.tier !== 'free' && !userMeetsTier(user, desc.tier as 'growth' | 'studio')) {
    return c.json(tierUpsell(desc.tier as 'growth' | 'studio'), 402);
  }
  const impl = getProviderImpl(provider);
  if (!impl?.buildAuthorizeUrl) {
    return c.json({
      error: 'provider_rolling_out',
      message: `${desc.display_name} OAuth flow is rolling out — please check back shortly.`,
      retry_after_seconds: 86400,
    }, 503, { 'Retry-After': '86400' });
  }
  // PKCE + signed state. The state token is bound to (user, provider) and
  // single-use; we hand it to the provider as the OAuth `state` param so
  // the callback can replay both userId and PKCE verifier.
  const pkce = await buildPkce();
  const state = await issueOauthState(c.env, user.id, provider, pkce.verifier, { challenge: pkce.challenge });
  const url = await impl.buildAuthorizeUrl(c, user, state);
  return c.json({ ok: true, authorize_url: url, state, pkce_method: pkce.method });
});

/**
 * GET /api/integrations/oauth/:provider/callback
 * Provider redirects the browser here after consent. We verify the signed
 * state, hand the code + verifier off to /connect-style flow internally,
 * and either redirect back to the Integrations page (?integration=ok) or
 * surface an error fragment the page renders inline.
 */
integrations.get('/oauth/:provider/callback', async (c) => {
  await ensureIntegrationsSchema(c.env);
  const user = await requireAuth(c);
  ensureRole(c, user);
  const provider = c.req.param('provider').toLowerCase();
  const desc = getDescriptor(provider);
  const code = c.req.query('code') || '';
  const state = c.req.query('state') || '';
  const errorParam = c.req.query('error') || '';
  if (errorParam) {
    return c.redirect(`/integrations?oauth=error&provider=${encodeURIComponent(provider)}&reason=${encodeURIComponent(errorParam)}`);
  }
  if (!desc || desc.auth_type !== 'oauth2') {
    return c.json({ error: 'oauth_not_supported' }, 404);
  }
  if (!code || !state) {
    return c.json({ error: 'missing_code_or_state' }, 400);
  }
  const consumed = await consumeOauthState(c.env, user.id, provider, state);
  if (!consumed) {
    return c.json({ error: 'invalid_or_expired_state' }, 400);
  }
  const impl = getProviderImpl(provider);
  if (!impl) {
    return c.redirect(`/integrations?oauth=rolling_out&provider=${encodeURIComponent(provider)}`);
  }
  try {
    const result = await impl.connect(c, user, {
      oauth_code: code,
      oauth_state: state,
      config: { pkce_verifier: consumed.pkce_verifier ?? undefined },
    });
    const sql = getSQL(c.env);
    try {
      const existing = await c.env.DB.prepare(
        'SELECT uid FROM integrations WHERE user_id = ? AND provider_key = ?',
      ).bind(user.id, provider).first<{ uid: string }>();
      const uid = existing?.uid || newUid();
      const credsEnc = await encryptCredentials(c.env, uid, result.credentials);
      if (existing) {
        await c.env.DB.prepare(
          "UPDATE integrations SET status = 'active', credentials_enc = ?, " +
          'config_json = ?, capabilities_json = ?, scopes_json = ?, ' +
          'external_account_id = ?, external_account_name = ?, last_error = NULL, ' +
          'updated_at = CURRENT_TIMESTAMP WHERE uid = ?',
        ).bind(
          credsEnc,
          JSON.stringify(result.config ?? {}),
          JSON.stringify(result.capabilities ?? desc.capabilities),
          JSON.stringify(result.scopes ?? []),
          result.external_account_id ?? null, result.external_account_name ?? null,
          uid,
        ).run();
      } else {
        await c.env.DB.prepare(
          'INSERT INTO integrations (uid, user_id, provider_key, display_name, status, auth_type, credentials_enc, config_json, capabilities_json, scopes_json, external_account_id, external_account_name) ' +
          "VALUES (?, ?, ?, ?, 'active', ?, ?, ?, ?, ?, ?, ?)",
        ).bind(
          uid, user.id, provider, desc.display_name, desc.auth_type, credsEnc,
          JSON.stringify(result.config ?? {}),
          JSON.stringify(result.capabilities ?? desc.capabilities),
          JSON.stringify(result.scopes ?? []),
          result.external_account_id ?? null, result.external_account_name ?? null,
        ).run();
      }
      const row = await loadRow(c.env, uid, user.id, false);
      if (row) {
        await logEvent(c.env, {
          integration_id: row.id, user_id: user.id, provider_key: provider,
          direction: 'inbound', event_type: 'oauth_callback', status: 'ok',
          response_summary: existing ? 'OAuth re-consent succeeded.' : 'OAuth consent granted; connection established.',
          external_id: result.external_account_id ?? null,
        });
        try {
          const actorHash = await hashEmail(user.email);
          await c.env.DB.prepare(
            'INSERT INTO activity_logs (user_id, actor, action, details) VALUES (?, ?, ?, ?)',
          ).bind(user.id, actorHash, existing ? 'integration_reconnected' : 'integration_connected', JSON.stringify({ provider_key: provider, source: 'oauth_callback' })).run();
        } catch { /* activity_logs may not exist in some schemas */ }
      }
    } finally {
      await sql.end();
    }
    return c.redirect(`/integrations?oauth=ok&provider=${encodeURIComponent(provider)}`);
  } catch (e) {
    // Best-effort failure log — we may not have an integrations row to
    // attach to (the connect threw before insert), so skip integration_logs
    // and only emit a best-effort activity_logs row.
    try {
      const actorHash = await hashEmail(user.email);
      await c.env.DB.prepare(
        'INSERT INTO activity_logs (user_id, actor, action, details) VALUES (?, ?, ?, ?)',
      ).bind(user.id, actorHash, 'integration_oauth_failed', JSON.stringify({ provider_key: provider, message: (e as Error).message?.slice(0, 200) })).run();
    } catch { /* non-fatal */ }
    return c.redirect(`/integrations?oauth=error&provider=${encodeURIComponent(provider)}&reason=${encodeURIComponent((e as Error).message || 'callback_failed')}`);
  }
});

export default integrations;
