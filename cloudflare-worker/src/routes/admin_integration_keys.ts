/**
 * Task #7 (2026-05-10) — Admin REST API for managing per-provider
 * OAuth client credentials. Mounted at `/api/admin/integration-keys`.
 *
 *  GET    /                  → list status for every managed provider (no secrets),
 *                              each with its Worker secret names, the callback URL
 *                              to register, the connector it serves and its setup
 *                              guide (D751), plus the OAuth clients set only at
 *                              deploy (`other_oauth`: Zoom, Google, Microsoft)
 *  PUT    /:provider         → upsert {client_id, client_secret}
 *                              → pushes BOTH as Cloudflare Worker secrets
 *                                via the CF API, deletes the encrypted DB row
 *  POST   /:provider/rotate  → push a fresh client_secret as a Worker secret
 *                              (wherever the key lives — D227: the console
 *                              offers rotate and remove for a key held as a
 *                              Worker secret too, which is where a save puts it)
 *  POST   /:provider/test    → dry-run probe against the provider
 *  DELETE /:provider         → delete both Worker secrets + cascade-disconnect
 *
 * D885 (#2561) — THE INTERVIEW CHANNELS. `GET /` also carries `channels`:
 * WhatsApp (way A, members' own numbers), WhatsApp through Axal's number
 * (way B) and the Telegram interview bot (not the news bot, which is the
 * managed `telegram` row above). Each row names its Worker secrets with set or
 * not set measured from env, the webhook to register, the rollout var's value
 * (changed by a PR, so read-only here), the runbook, and whether the channel
 * is configured by the same check the Worker uses.
 *
 *  PUT    /channels/:channel          → { <SECRET_NAME>: value, ... }, that channel's names only
 *  POST   /channels/:channel/rotate   → { name, value } or { name, generate: true } for one secret;
 *                                       a generated value is returned once, to the caller only
 *  DELETE /channels/:channel          → delete every one of that channel's Worker secrets
 *
 * The same bar and audit as the provider keys: `requireSuperAdminWriteBar`,
 * one `logAdminAction` row per request naming the secrets, never a value.
 *
 * D223 — WHO MAY WRITE. PUT, rotate and DELETE write (or delete) Worker
 * secrets on production's own `studioos` script, so they sit behind
 * `requireSuperAdminWriteBar` (a TOTP session, a recent step-up, the holder):
 * the same bar as the deploy dispatch those secrets sit beside. Before D223
 * they were `requireAdmin`, so every admin, a branch's included, could
 * overwrite a provider's OAuth pair.
 *
 * THE READS ARE SUPER ADMIN TOO (the owner's ruling, 2026-10-20). D223 left
 * `GET /` and `POST /:provider/test` on `requireAdmin`, because neither
 * returns a secret or moves one and an admin triaging "Slack won't connect"
 * used both. The owner ruled that this console is the Super Admin's alone:
 * the page moved out of the Admin Console to HQ's own row
 * (`/admin/integration-keys`, `hqOnly`), and both reads take
 * `requireSuperAdmin`, so a plain admin, or any admin on a branch, is refused
 * here as well as in the shell. The writes keep D223's bar.
 *
 * Every write is audited ONCE through `logAdminAction` (D159's single
 * definition): one `activity_logs` row and one `admin_audit_log` row per
 * request, with the action names and the `provider` / `outcome` keys that
 * `readProviderKeyLastSet` (D213) matches.
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import { requireSuperAdmin, requireSuperAdminWriteBar } from '../auth';
import { logAdminAction } from '../services/adminAudit';
import {
  MANAGED_PROVIDERS,
  PROVIDER_ENV_VARS,
  type ManagedProviderKey,
  rotateOauthSecret,
  deleteOauthCredsAndDisconnect,
  deleteOauthCredsRowOnly,
  listProviderKeyStatus,
  keyHeldAsWorkerSecret,
  _clearOauthCredsCache,
} from '../services/providerOauthKeys';
import { testOauthCreds } from '../services/providerOauthTest';
import { setSecret, deleteSecret, type CfSecretResult } from '../services/cloudflareSecrets';
import { refusalBody } from '../util/refusal';
import { getDescriptor } from '../integrations/registry';
import { redirectUri as githubCallback } from '../integrations/providers/github';
import { redirectUri as slackCallback } from '../integrations/providers/slack';
import { redirectUri as hubspotCallback } from '../integrations/providers/hubspot';
import { redirectUri as calendlyCallback } from '../integrations/providers/calendly';
import { redirectUri as cartaCallback } from '../integrations/providers/carta';
import { redirectUri as docusignCallback } from '../integrations/providers/docusign';
import { redirectUri as stripeCallback } from '../integrations/providers/stripe';
import { redirectUri as salesforceCallback } from '../integrations/providers/salesforce';
import { redirectUri as zoomCallback, zoomConfigured, ZOOM_CLIENT_ENV_VARS } from '../services/channels/zoom';
import { linkedinRedirectUri } from './linkedin';
import { providerAvailable, channelRollout } from '../services/channels/connections';
import { axalNumberReady } from '../services/channels/whatsappLink';
import { TELEGRAM_SECRET_RE } from '../services/channels/telegram';
import {
  googleRedirectUri, microsoftRedirectUri, googleOAuthAvailable, microsoftOAuthAvailable,
  GOOGLE_CAL_ENV_VARS, GOOGLE_CAL_FALLBACK_ENV_VARS, MICROSOFT_CAL_ENV_VARS, MICROSOFT_CAL_FALLBACK_ENV_VARS,
} from '../services/calendar';

const r = new Hono<{ Bindings: Env }>();

function isManaged(k: string): k is ManagedProviderKey {
  return (MANAGED_PROVIDERS as readonly string[]).includes(k);
}

/**
 * The one audit write per request, through D159's `logAdminAction`.
 *
 * It replaced two hand-written INSERTs (an `activity_logs` row under one
 * action name and an `admin_audit_log` row under another), which is the drift
 * D159 consolidated. The details keep the keys D213's "last set" read matches:
 * `provider` and `outcome`, with `'failed'` for a refusal so a write Cloudflare
 * refused is never dated as a set.
 */
async function audit(
  env: Env,
  actor: { id: number; email: string },
  opts: { action: string; provider: ManagedProviderKey; envVars: string[]; outcome: 'ok' | 'failed'; cfStatus?: number; cfCode?: string; extra?: Record<string, unknown> },
): Promise<void> {
  await logAdminAction(env, actor.id, actor.email, opts.action, {
    provider: opts.provider,
    env_vars: opts.envVars,
    outcome: opts.outcome,
    cf_status: opts.cfStatus ?? null,
    cf_code: opts.cfCode ?? null,
    ...(opts.extra || {}),
  });
}

// ───────────────────────────────────────────── D751: what to register, and where

/**
 * Each managed key's callback URL, read from the provider's own function so
 * the console shows exactly what the provider sends. Exhaustive over
 * `ManagedProviderKey`: a new managed provider fails `tsc` until it is listed.
 * `null` for a key that is not an OAuth client.
 */
const CALLBACK_URL: Record<ManagedProviderKey, ((env: Env) => string) | null> = {
  slack: slackCallback,
  hubspot: hubspotCallback,
  salesforce: salesforceCallback,
  docusign: docusignCallback,
  linkedin: linkedinRedirectUri,
  calendly: calendlyCallback,
  stripe: stripeCallback,
  carta: cartaCallback,
  github: githubCallback,
  crunchbase: null,
  affinity: null,
  telegram: null,
  gcip: null,
};

/** LinkedIn connects through its own route, so it has no registry row; the page draws it as a first-party card (`frontend/src/pages/account/connectorsModel.js`). */
const FIRST_PARTY_CONNECTOR: Record<string, { display_name: string; status: string; tier: string }> = {
  linkedin: { display_name: 'LinkedIn', status: 'live', tier: 'free' },
};

const REPO_BLOB = 'https://github.com/AxalNetwork/StudioOS/blob/main/';

/**
 * Setup steps that exist, by key, as repository paths (the repository is
 * public). GitHub's is its App runbook (#1885); Zoom's steps are in
 * PRODUCTION.md's Provider setup list.
 */
export const SETUP_GUIDES: Readonly<Record<string, string>> = Object.freeze({
  github: 'documentation/operations/GITHUB_CONNECTOR_APP.md',
  zoom: 'documentation/architecture/PRODUCTION.md',
  // D885: the interview channels' runbooks.
  whatsapp: 'documentation/operations/WHATSAPP.md',
  whatsapp_axal: 'documentation/operations/WHATSAPP.md',
  telegram_channel: 'documentation/operations/TELEGRAM.md',
});

type ConnectorRef = { display_name: string; status: string; tier: string };

/** The member-facing card a key's client serves: an OAuth registry row, or LinkedIn's first-party card. Only three facts, never the descriptor. */
function connectorOf(key: string): ConnectorRef | null {
  if (Object.hasOwn(FIRST_PARTY_CONNECTOR, key)) return { ...FIRST_PARTY_CONNECTOR[key] };
  const d = getDescriptor(key);
  if (!d || d.auth_type !== 'oauth2') return null;
  return { display_name: d.display_name, status: d.status, tier: d.tier };
}

const guideHref = (key: string): string | null => (Object.hasOwn(SETUP_GUIDES, key) ? REPO_BLOB + SETUP_GUIDES[key] : null);
const urlOrNull = (fn: ((env: Env) => string) | null, env: Env): string | null => (fn ? fn(env) || null : null);

/** The four D751 fields on one managed row. Names, a public URL and three card facts: nothing secret. */
function setupFields(env: Env, key: ManagedProviderKey) {
  const names = PROVIDER_ENV_VARS[key];
  return {
    env_vars: [names.id, names.secret],
    callback_url: urlOrNull(CALLBACK_URL[key], env),
    connector: connectorOf(key),
    guide_href: guideHref(key),
  };
}

/**
 * The OAuth clients read only from Worker secrets, so the console cannot set
 * them: whether each is set up (measured from env, never unknown), the names
 * to set, the callback to register, the card it serves and its guide. No
 * client-id preview.
 */
function otherOauthClients(env: Env) {
  const row = (key: string, configured: boolean, envVars: readonly string[], fallback: readonly string[] | null, callback: (e: Env) => string) => ({
    key,
    configured,
    env_vars: [...envVars],
    fallback_env_vars: fallback ? [...fallback] : null,
    callback_url: callback(env) || null,
    connector: connectorOf(key),
    guide_href: guideHref(key),
  });
  return [
    row('zoom', zoomConfigured(env), ZOOM_CLIENT_ENV_VARS, null, zoomCallback),
    row('google_calendar', googleOAuthAvailable(env), GOOGLE_CAL_ENV_VARS, GOOGLE_CAL_FALLBACK_ENV_VARS, googleRedirectUri),
    row('microsoft_365', microsoftOAuthAvailable(env), MICROSOFT_CAL_ENV_VARS, MICROSOFT_CAL_FALLBACK_ENV_VARS, microsoftRedirectUri),
  ];
}

// ───────────────────────────────────────────── D885: the interview channels

export const CHANNEL_KEYS = ['whatsapp', 'whatsapp_axal', 'telegram_channel'] as const;
export type ChannelKey = typeof CHANNEL_KEYS[number];

interface ChannelSpec {
  label: string;
  /** The Worker secrets this console may write for the channel, and only these. */
  secrets: readonly string[];
  /** Public `wrangler.toml` vars the channel also needs, changed by a PR. */
  vars: readonly string[];
  /** The secrets the console can generate (a token Axal chooses and the owner copies into the provider). */
  generate: readonly string[];
  webhookPath: string;
  rollout: { var: 'WHATSAPP_CHANNEL' | 'TELEGRAM_CHANNEL'; provider: 'whatsapp' | 'telegram' };
  /** The admin page that registers the webhook, when Axal does it rather than the owner. */
  registerHref: string | null;
  configured: (env: Env) => boolean;
}

export const CHANNEL_SPECS: Readonly<Record<ChannelKey, ChannelSpec>> = Object.freeze({
  whatsapp: {
    label: 'WhatsApp · members\' own numbers (way A)',
    secrets: ['WHATSAPP_APP_ID', 'WHATSAPP_APP_SECRET', 'WHATSAPP_VERIFY_TOKEN', 'WHATSAPP_EMBEDDED_SIGNUP_CONFIG_ID'],
    vars: [],
    generate: ['WHATSAPP_VERIFY_TOKEN'],
    webhookPath: '/api/channels/whatsapp/webhook',
    rollout: { var: 'WHATSAPP_CHANNEL', provider: 'whatsapp' },
    registerHref: null,
    configured: (env) => providerAvailable(env, 'whatsapp'),
  },
  whatsapp_axal: {
    label: 'WhatsApp · through Axal\'s number (way B)',
    secrets: ['WHATSAPP_AXAL_ACCESS_TOKEN', 'WHATSAPP_AXAL_PHONE_NUMBER_ID', 'WHATSAPP_AXAL_WABA_ID'],
    vars: ['WHATSAPP_AXAL_DISPLAY_NUMBER'],
    generate: [],
    webhookPath: '/api/channels/whatsapp/webhook',
    rollout: { var: 'WHATSAPP_CHANNEL', provider: 'whatsapp' },
    registerHref: null,
    configured: (env) => axalNumberReady(env),
  },
  telegram_channel: {
    label: 'Telegram · interview bot (not the news bot)',
    secrets: ['TELEGRAM_CHANNEL_BOT_TOKEN', 'TELEGRAM_CHANNEL_BOT_USERNAME', 'TELEGRAM_CHANNEL_WEBHOOK_SECRET'],
    vars: [],
    generate: ['TELEGRAM_CHANNEL_WEBHOOK_SECRET'],
    webhookPath: '/api/channels/telegram/webhook',
    rollout: { var: 'TELEGRAM_CHANNEL', provider: 'telegram' },
    registerHref: '/admin/telegram',
    configured: (env) => providerAvailable(env, 'telegram'),
  },
});

const isChannelKey = (k: string): k is ChannelKey => (CHANNEL_KEYS as readonly string[]).includes(k);
const MAX_SECRET_LENGTH = 4096;

/** Set or not set, measured from env. Never a value, a length or a preview. */
function isSet(env: Env, name: string): boolean {
  const v = (env as unknown as Record<string, unknown>)[name];
  return typeof v === 'string' && v.trim() !== '';
}

/** The webhook address on this deployment, or null without an https base. */
function channelWebhookUrl(env: Env, path: string): string | null {
  const base = String(env.PUBLIC_BASE_URL || env.APP_URL || '').trim().replace(/\/+$/, '');
  return /^https:\/\/[^/]+$/.test(base) ? `${base}${path}` : null;
}

export function channelRows(env: Env) {
  return CHANNEL_KEYS.map((key) => {
    const spec = CHANNEL_SPECS[key];
    return {
      key,
      label: spec.label,
      configured: spec.configured(env),
      secrets: spec.secrets.map((name) => ({ name, set: isSet(env, name), generate: spec.generate.includes(name) })),
      vars: spec.vars.map((name) => ({ name, set: isSet(env, name), changed_by: 'pr' as const })),
      webhook_url: channelWebhookUrl(env, spec.webhookPath),
      register_webhook_href: spec.registerHref,
      rollout: { var: spec.rollout.var, value: channelRollout(env, spec.rollout.provider), changed_by: 'pr' as const },
      guide_href: guideHref(key),
    };
  });
}

/** Why a value cannot be a given secret, or null. Formats only where the Worker already checks them. */
export function channelSecretRefusal(name: string, value: string): string | null {
  if (!value) return 'value_required';
  if (value.length > MAX_SECRET_LENGTH) return 'value_too_long';
  if (/[\r\n]/.test(value)) return 'value_has_line_break';
  if (name === 'TELEGRAM_CHANNEL_WEBHOOK_SECRET' && !TELEGRAM_SECRET_RE.test(value)) return 'secret_format';
  return null;
}

const CHANNEL_REFUSALS: Record<string, string> = {
  unknown_channel: 'That is not one of the interview channels.',
  unknown_secret_name: 'Only this channel\'s own secret names can be written here.',
  nothing_to_set: 'Send at least one of this channel\'s secret names with a value.',
  value_required: 'Each secret needs a value.',
  value_too_long: 'A secret is at most 4096 characters.',
  value_has_line_break: 'A secret cannot contain a line break.',
  secret_format: 'TELEGRAM_CHANNEL_WEBHOOK_SECRET may use only letters, digits, _ and -, up to 256 characters.',
  not_generated: 'Axal does not generate this secret: paste the value the provider gave you.',
};
const channelRefusal = (c: any, status: number, code: string, extra: Record<string, unknown> = {}) =>
  c.json({ error: code, detail: CHANNEL_REFUSALS[code] ?? code, ...extra }, status);

/** A random token in Telegram's secret alphabet (base64url), which Meta's verify token also accepts. */
function generatedToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** The one audit row for a channel write: the secret NAMES, the outcome and Cloudflare's status. Never a value. */
async function channelAudit(
  env: Env, actor: { id: number; email: string }, action: string, channel: ChannelKey,
  opts: { envVars: string[]; outcome: 'ok' | 'failed'; cfStatus?: number; cfCode?: string; extra?: Record<string, unknown> },
): Promise<void> {
  await logAdminAction(env, actor.id, actor.email, action, {
    channel, env_vars: opts.envVars, outcome: opts.outcome,
    cf_status: opts.cfStatus ?? null, cf_code: opts.cfCode ?? null, ...(opts.extra || {}),
  });
}

/** Map a CF helper failure into a structured 502 JSON body. */
function cfErrorJson(c: any, res: CfSecretResult, fallback = 'cf_api_failed') {
  const code = res.code || fallback;
  // 503 for missing-token (the admin can fix it by setting the env var);
  // 502 for upstream API failures so the frontend distinguishes from 4xx
  // input validation errors.
  const httpStatus = code === 'cloudflare_api_token_missing' ? 503 : 502;
  // D278 — Cloudflare's text is the admin's to read on `upstream`.
  return c.json(refusalBody({
    code,
    message: code === 'cloudflare_api_token_missing'
      ? 'The Cloudflare API token is not set, so keys cannot be changed from here.'
      : 'Cloudflare did not accept the change. Nothing changed; the upstream field says why.',
    raw: res.error || null,
    audience: 'admin',
    extra: { cf_status: res.status },
  }), httpStatus);
}

// D227 — each key carries `state` (env | db | unset | unreadable) and the
// payload carries `db_readable`, so a table that did not answer reads as
// "unknown" on the console rather than as "not configured". `providers` keeps
// its name and every field it had. D751 adds each row's setup fields and the
// env-only clients, here and not in `listProviderKeyStatus`, so HQ's Platform
// summary (D213) reads what it always did.
r.get('/', async (c) => {
  await requireSuperAdmin(c);
  const status = await listProviderKeyStatus(c.env);
  return c.json({
    providers: status.items.map((item) => ({ ...item, ...setupFields(c.env, item.provider_key as ManagedProviderKey) })),
    other_oauth: otherOauthClients(c.env),
    channels: channelRows(c.env),
    db_readable: status.db_readable,
    ...(status.db_readable ? {} : {
      unreadable_reason:
        'The table that holds database-kept keys could not be read, so for any provider without a Worker '
        + 'secret it is unknown whether a key is kept there.',
    }),
  });
});

// D885 — the interview channels' secrets. Registered before `/:provider`
// for readability; the paths differ in depth, so neither can take the other's.
r.put('/channels/:channel', async (c) => {
  const admin = await requireSuperAdminWriteBar(c);
  const channel = c.req.param('channel');
  if (!isChannelKey(channel)) return channelRefusal(c, 404, 'unknown_channel', { allowed: CHANNEL_KEYS });
  const spec = CHANNEL_SPECS[channel];
  let body: Record<string, unknown> = {};
  try { body = await c.req.json(); } catch { /* empty body → 400 below */ }
  const names = Object.keys(body && typeof body === 'object' && !Array.isArray(body) ? body : {});
  const foreign = names.filter((n) => !spec.secrets.includes(n));
  if (foreign.length) return channelRefusal(c, 400, 'unknown_secret_name', { allowed: spec.secrets, refused: foreign });
  if (!names.length) return channelRefusal(c, 400, 'nothing_to_set', { allowed: spec.secrets });
  const values: Array<[string, string]> = [];
  for (const name of spec.secrets.filter((n) => names.includes(n))) {
    const value = typeof body[name] === 'string' ? (body[name] as string).trim() : '';
    const refused = channelSecretRefusal(name, value);
    if (refused) return channelRefusal(c, 400, refused, { name });
    values.push([name, value]);
  }
  // One at a time, stopping at the first refusal. Nothing is rolled back: a
  // secret set before the refusal held its new value, and deleting it would
  // take away a value that may have worked before. The answer says which.
  const set: string[] = [];
  for (const [name, value] of values) {
    const res = await setSecret(c.env, name, value);
    if (!res.ok) {
      await channelAudit(c.env, admin, 'channel_key_set', channel, {
        envVars: values.map(([n]) => n), outcome: 'failed', cfStatus: res.status, cfCode: res.code, extra: { set, failed_at: name },
      });
      const out = cfErrorJson(c, res);
      return set.length ? c.json({ ...(await out.json() as Record<string, unknown>), set, failed_at: name }, out.status as any) : out;
    }
    set.push(name);
  }
  await channelAudit(c.env, admin, 'channel_key_set', channel, { envVars: set, outcome: 'ok' });
  return c.json({ ok: true, channel, set });
});

r.post('/channels/:channel/rotate', async (c) => {
  const admin = await requireSuperAdminWriteBar(c);
  const channel = c.req.param('channel');
  if (!isChannelKey(channel)) return channelRefusal(c, 404, 'unknown_channel', { allowed: CHANNEL_KEYS });
  const spec = CHANNEL_SPECS[channel];
  let body: { name?: unknown; value?: unknown; generate?: unknown } = {};
  try { body = await c.req.json(); } catch { /* empty body → 400 below */ }
  const name = String(body.name ?? '');
  if (!spec.secrets.includes(name)) return channelRefusal(c, 400, 'unknown_secret_name', { allowed: spec.secrets });
  const generate = body.generate === true;
  if (generate && !spec.generate.includes(name)) return channelRefusal(c, 400, 'not_generated', { name });
  const value = generate ? generatedToken() : (typeof body.value === 'string' ? body.value.trim() : '');
  const refused = channelSecretRefusal(name, value);
  if (refused) return channelRefusal(c, 400, refused, { name });
  const res = await setSecret(c.env, name, value);
  await channelAudit(c.env, admin, 'channel_key_rotate', channel, {
    envVars: [name], outcome: res.ok ? 'ok' : 'failed', cfStatus: res.status, cfCode: res.ok ? undefined : res.code,
    extra: { generated: generate },
  });
  if (!res.ok) return cfErrorJson(c, res);
  // The generated value goes back once, to this caller, to copy into Meta's or
  // Telegram's dashboard. It is in no log, no audit row and no later read.
  return c.json({ ok: true, channel, name, rotated_at: new Date().toISOString(), ...(generate ? { generated_value: value } : {}) });
});

r.delete('/channels/:channel', async (c) => {
  const admin = await requireSuperAdminWriteBar(c);
  const channel = c.req.param('channel');
  if (!isChannelKey(channel)) return channelRefusal(c, 404, 'unknown_channel', { allowed: CHANNEL_KEYS });
  const spec = CHANNEL_SPECS[channel];
  // Each delete is idempotent (404 is ok), so a retry after a partial failure finishes the job.
  const removed: string[] = [];
  for (const name of spec.secrets) {
    const res = await deleteSecret(c.env, name);
    if (!res.ok) {
      await channelAudit(c.env, admin, 'channel_key_delete', channel, {
        envVars: [...spec.secrets], outcome: 'failed', cfStatus: res.status, cfCode: res.code, extra: { removed, failed_at: name },
      });
      const out = cfErrorJson(c, res);
      return removed.length ? c.json({ ...(await out.json() as Record<string, unknown>), removed, failed_at: name }, out.status as any) : out;
    }
    removed.push(name);
  }
  await channelAudit(c.env, admin, 'channel_key_delete', channel, { envVars: removed, outcome: 'ok' });
  return c.json({ ok: true, channel, removed, vars_kept: spec.vars });
});

r.put('/:provider', async (c) => {
  const admin = await requireSuperAdminWriteBar(c);
  const provider = c.req.param('provider');
  if (!isManaged(provider)) {
    return c.json({ error: 'unknown_provider', allowed: MANAGED_PROVIDERS }, 400);
  }
  let body: { client_id?: string; client_secret?: string } = {};
  try { body = await c.req.json(); } catch { /* empty body → 400 below */ }
  const clientId = String(body.client_id || '').trim();
  const clientSecret = String(body.client_secret || '').trim();
  if (!clientId || !clientSecret) {
    return c.json({ error: 'client_id_and_client_secret_required' }, 400);
  }
  if (clientId.length > 4096 || clientSecret.length > 4096) {
    return c.json({ error: 'value_too_long' }, 400);
  }

  const envMap = PROVIDER_ENV_VARS[provider];
  const envVars = [envMap.id, envMap.secret];

  // Push the client_id first. On failure we haven't touched anything yet.
  const idRes = await setSecret(c.env, envMap.id, clientId);
  if (!idRes.ok) {
    await audit(c.env, admin, {
      action: 'integration_key_cf_secret_push',
      provider, envVars, outcome: 'failed', cfStatus: idRes.status, cfCode: idRes.code,
    });
    return cfErrorJson(c, idRes);
  }
  // Push the client_secret. If this fails, roll back the client_id push
  // so we don't leave the pair half-set. Best-effort delete — even if
  // the rollback fails, the DB row was never written so re-trying the
  // save is still safe.
  const secretRes = await setSecret(c.env, envMap.secret, clientSecret);
  if (!secretRes.ok) {
    const rollback = await deleteSecret(c.env, envMap.id);
    await audit(c.env, admin, {
      action: 'integration_key_cf_secret_push',
      provider, envVars, outcome: 'failed', cfStatus: secretRes.status, cfCode: secretRes.code,
      extra: { rollback_ok: rollback.ok, rollback_status: rollback.status },
    });
    return cfErrorJson(c, secretRes);
  }

  // CF API push succeeded — drop any stale encrypted DB row WITHOUT
  // cascading status='disconnected' on user integrations (the
  // credentials are now live as Worker secrets, so existing OAuth
  // tokens issued under the same client_id remain valid).
  await deleteOauthCredsRowOnly(c.env, provider);
  _clearOauthCredsCache();

  await audit(c.env, admin, {
    action: 'integration_key_cf_secret_push',
    provider, envVars, outcome: 'ok', cfStatus: secretRes.status,
  });
  // `source: 'env'` is the cosmetic post-promote state — the next
  // /api/admin/integration-keys GET will reflect the live env binding
  // (CF Worker isolates pick up new secrets on next boot; existing
  // isolates keep the env they booted with, but the panel renders fresh
  // from the next request's env so the UI will flip correctly).
  return c.json({ ok: true, provider, source: 'env', env_vars: envVars });
});

// Rotate the secret. Pushes a fresh client_secret as a CF Worker
// secret (the client_id is left untouched — providers issue new
// secrets against the same client app). Also drops any stale DB row.
r.post('/:provider/rotate', async (c) => {
  const admin = await requireSuperAdminWriteBar(c);
  const provider = c.req.param('provider');
  if (!isManaged(provider)) {
    return c.json({ error: 'unknown_provider', allowed: MANAGED_PROVIDERS }, 400);
  }
  let body: { client_secret?: string } = {};
  try { body = await c.req.json(); } catch { /* empty body → 400 below */ }
  const clientSecret = String(body.client_secret || '').trim();
  if (!clientSecret) {
    return c.json({ error: 'client_secret_required' }, 400);
  }
  if (clientSecret.length > 4096) {
    return c.json({ error: 'value_too_long' }, 400);
  }
  const envMap = PROVIDER_ENV_VARS[provider];
  const envVars = [envMap.secret];

  const res = await setSecret(c.env, envMap.secret, clientSecret);
  if (!res.ok) {
    // If a legacy DB row exists, keep the old rotate path as a fallback
    // so admins aren't locked out when CF API is unreachable. This
    // mirrors the spec's "Existing rows already in `provider_oauth_keys`
    // keep working until an admin re-saves them" requirement.
    //
    // ONE AUDIT ROW WHICHEVER WAY IT ENDS (D223): the fallback's success is
    // the outcome of this request, so it is recorded once, as a rotate that
    // landed in the table, rather than as a Cloudflare refusal followed by a
    // second row saying it worked after all.
    //
    // NOT FOR A KEY HELD AS A WORKER SECRET (D227). The Worker secret wins over
    // any row (`loadOauthCreds`), so rotating a row under it would answer "ok"
    // and change nothing a user's connection reads.
    if (res.code === 'cloudflare_api_token_missing' && !keyHeldAsWorkerSecret(c.env, provider)) {
      try {
        const rotated = await rotateOauthSecret(c.env, provider, clientSecret, admin.id);
        await audit(c.env, admin, {
          action: 'integration_key_cf_secret_rotate',
          provider, envVars, outcome: 'ok', cfStatus: res.status, cfCode: res.code,
          extra: { fallback: 'db' },
        });
        return c.json({ ok: true, provider, source: 'db', ...rotated });
      } catch { /* fall through to the CF error */ }
    }
    await audit(c.env, admin, {
      action: 'integration_key_cf_secret_rotate',
      provider, envVars, outcome: 'failed', cfStatus: res.status, cfCode: res.code,
    });
    return cfErrorJson(c, res);
  }

  await deleteOauthCredsRowOnly(c.env, provider);
  _clearOauthCredsCache();
  await audit(c.env, admin, {
    action: 'integration_key_cf_secret_rotate',
    provider, envVars, outcome: 'ok', cfStatus: res.status,
  });
  return c.json({ ok: true, provider, source: 'env', rotated_at: new Date().toISOString() });
});

// Dry-run a provider auth call to verify the configured credentials.
r.post('/:provider/test', async (c) => {
  const admin = await requireSuperAdmin(c);
  const provider = c.req.param('provider');
  if (!isManaged(provider)) {
    return c.json({ error: 'unknown_provider', allowed: MANAGED_PROVIDERS }, 400);
  }
  let result;
  try {
    result = await testOauthCreds(c.env, provider);
  } catch (e: any) {
    return c.json(refusalBody({ code: 'test_failed', message: 'The key could not be tested. Try again in a moment.', raw: e, audience: 'admin' }), 500);
  }
  // A probe with production's credentials is a privileged act even though it
  // writes nothing, so it is recorded — through the same helper as the writes.
  await logAdminAction(c.env, admin.id, admin.email, 'integration_keys_tested', {
    provider, ok: result.ok, reachable: result.reachable, http_status: result.http_status ?? null,
  });
  return c.json({ provider, ...result });
});

r.delete('/:provider', async (c) => {
  const admin = await requireSuperAdminWriteBar(c);
  const provider = c.req.param('provider');
  if (!isManaged(provider)) {
    return c.json({ error: 'unknown_provider', allowed: MANAGED_PROVIDERS }, 400);
  }
  const envMap = PROVIDER_ENV_VARS[provider];
  const envVars = [envMap.id, envMap.secret];

  // Delete BOTH CF Worker secrets first. Both deletes are idempotent
  // (404 → ok). If the API token is missing we still want to clear
  // the DB row + cascade-disconnect, so we don't bail on token-missing
  // here — we just skip the CF call and rely on the existing DB delete.
  let cfId: CfSecretResult | null = null;
  let cfSecret: CfSecretResult | null = null;
  cfId = await deleteSecret(c.env, envMap.id);
  cfSecret = await deleteSecret(c.env, envMap.secret);
  const cfOk = (cfId.ok && cfSecret.ok) || cfId.code === 'cloudflare_api_token_missing';
  // If the API token is configured but the call genuinely failed
  // (4xx/5xx), surface the error rather than silently leaving the
  // Worker secret in place — admin needs to know the env vars are
  // still live.
  if (!cfOk && cfId.code !== 'cloudflare_api_token_missing') {
    const worst = !cfId.ok ? cfId : cfSecret!;
    await audit(c.env, admin, {
      action: 'integration_key_cf_secret_delete',
      provider, envVars, outcome: 'failed', cfStatus: worst.status, cfCode: worst.code,
      extra: { id_ok: cfId.ok, secret_ok: cfSecret!.ok },
    });
    return cfErrorJson(c, worst);
  }

  let result;
  try {
    result = await deleteOauthCredsAndDisconnect(c.env, provider);
  } catch (e: any) {
    return c.json(refusalBody({ code: 'delete_failed', message: 'The key could not be deleted. Nothing changed; try again in a moment.', raw: e, audience: 'admin' }), 500);
  }

  await audit(c.env, admin, {
    action: 'integration_key_cf_secret_delete',
    provider, envVars,
    outcome: cfId.code === 'cloudflare_api_token_missing' ? 'failed' : 'ok',
    cfStatus: cfSecret.status,
    cfCode: cfId.code === 'cloudflare_api_token_missing' ? cfId.code : undefined,
    extra: { disconnected_users: result.disconnected_users, removed_keys: result.removed_keys },
  });
  return c.json({ ok: true, provider, ...result, cf_token_missing: cfId.code === 'cloudflare_api_token_missing' });
});

export default r;
