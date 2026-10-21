/**
 * D852 (#2475) — a member's own remote MCP servers ("Add a custom connector").
 * Mounted at `/api/connectors/custom`, ahead of the connectors router. Every
 * route answers 404 `custom_connectors_off` unless `CUSTOM_MCP_ENABLED` is
 * `true`. The rules are `integrations/customMcp.ts`.
 *
 *   GET    /                               the member's servers: host, status, approved tools, drift
 *   POST   /start            { url }       configure: the URL checked and resolved, discovery and
 *                                          registration; { ok, uid, authorize_url } and the CSRF cookie
 *   GET    /oauth/callback                 the server's sign-in returns here; the connection is stored,
 *                                          then a redirect to `/account/connectors?custom=ok|error`
 *   GET    /:uid/tools                     what the server lists, each tool approved, changed or read-only;
 *                                          descriptions are the server's words, marked untrusted
 *   POST   /:uid/tools/:name/approve       approve one read tool, pinned to the schema shown
 *   DELETE /:uid/tools/:name/approve       withdraw it
 *   POST   /:uid/health                    one session: reachable, signed in, and drift
 *   DELETE /:uid                           revoke: the server's endpoint when it has one, then everything deleted
 *
 * WHO (#2475 option A, the issue's recommendation): a founder on a paid plan,
 * or HQ's admin. Anyone else is answered 404, as if the routes were not there.
 * A support session is refused. Nothing a member does here calls a tool: tools
 * run only for Eadwyn or a flow the member set going (`callCustomTool`).
 *
 * The state is #1's signed, single-use, ten-minute token bound to the member
 * and to `custom_mcp`, with the CSRF cookie's hash, the connection's uid, its
 * checked configuration and its client key. Nothing credential-shaped is
 * logged or returned; an activity row names the server's host, never its URL.
 */
import { Hono } from 'hono';
import type { Context } from 'hono';
import type { Env, User } from '../types';
import { requireAuth } from '../auth';
import { hashEmail } from '../util/hashEmail';
import { userMeetsTier, tierUpsell } from '../middleware/requireTier';
import { refuse } from '../util/refusal';
import { buildPkce, consumeOauthState, issueOauthState } from '../integrations/oauth';
import { ensureIntegrationsSchema, type IntegrationRow } from '../integrations/registry';
import { encryptCredentials, type CredentialBlob } from '../integrations/secrets';
import { isSupportSession } from '../integrations/providers/mercury';
import {
  approveCustomTool, authorizeMcpUrl, checkCustomHealth, completeCustomSignIn, configOf, customCount, customKey, customMcpEnabled,
  CustomMcpError, customRowFor, CUSTOM_CALLBACK_PATH, CUSTOM_LIMITS, CUSTOM_STATE_PROVIDER, listCustomTools, prepareCustomSignIn,
  revokeCustomConnection, unapproveCustomTool, MCP_AUTH_TYPE, type CustomConfig, type CustomDeps,
} from '../integrations/customMcp';

type C = Context<{ Bindings: Env }>;

export const CSRF_COOKIE = '__Host-axal_custom_mcp';
export const RETURN_PATH = '/account/connectors';
export const CALLBACK_REASONS = ['access_denied', 'invalid_state', 'csrf_mismatch', 'missing_code', 'not_allowed', 'sign_in_failed', 'too_many'] as const;
type Reason = typeof CALLBACK_REASONS[number];

/** Test seams: the DNS resolver and the fetcher the client is given. Production leaves both unset. */
export const customDepsFor = { current: (_c: C): CustomDeps => ({}) };

const router = new Hono<{ Bindings: Env }>();

const ownHost = (c: C) => new URL(c.req.url).hostname;
const deps = (c: C): CustomDeps => ({ ownHost: ownHost(c), ...customDepsFor.current(c) });

/** This host's callback URL, as Mercury's: the sign-in returns where the cookie lives. */
export function redirectUriFor(c: C): string {
  const u = new URL(c.req.url);
  return `${u.hostname === 'localhost' ? u.protocol : 'https:'}//${u.host}${CUSTOM_CALLBACK_PATH}`;
}

async function sha256(v: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(v));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function readCookie(c: C, name: string): string | null {
  for (const part of (c.req.header('Cookie') || '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return v.join('=') || null;
  }
  return null;
}

/** A tool name as the listing shows them; anything else is never logged or stored. */
const TOOL_NAME = /^[A-Za-z0-9_.\-/]{1,64}$/;
const newUid = () => [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, '0')).join('');
const hostOf = (url: string) => { try { return new URL(url).hostname; } catch { return null; } };

/** Off, or not this member's: a Response; else null. */
async function gate(c: C, user: User): Promise<Response | null> {
  if (!customMcpEnabled(c.env)) return c.json({ error: 'custom_connectors_off' }, 404);
  if (await isSupportSession(c)) return refuse(c, 403, { code: 'support_session_refused', message: 'A support session cannot connect a member\'s MCP server.' });
  const role = String(user.role || '');
  if (role !== 'founder' && role !== 'admin') return c.json({ error: 'custom_connectors_off' }, 404);
  if (!userMeetsTier(user, 'growth')) return c.json(tierUpsell('growth'), 402);
  return null;
}

const SENTENCES: Record<string, [number, string]> = {
  url_refused: [400, 'That address cannot be connected. Use the server\'s https address, on its public name, with no port, query or sign-in in it.'],
  host_private: [400, 'That server\'s name points at a private address, so it cannot be connected.'],
  host_unresolved: [400, 'That server\'s name could not be found. Check the address and try again.'],
  discovery_failed: [502, 'That server did not describe how to sign in to it, so nothing was connected.'],
  not_found: [404, 'That connection was not found.'],
  tool_not_listed: [404, 'That server does not list that tool now.'],
  tool_writes: [409, 'Only tools the server marks read-only can be approved.'],
  tool_not_approved: [409, 'That tool is not approved, or it changed since it was approved.'],
  too_many_tools: [409, `At most ${CUSTOM_LIMITS.approved} tools can be approved on one server.`],
  unreachable: [502, 'That server could not be reached. Try again in a minute.'],
  unauthorized: [409, 'The sign-in to that server has expired. Connect it again.'],
};

function refusal(c: C, e: unknown): Response {
  if (e instanceof CustomMcpError) {
    const [status, message] = SENTENCES[e.code] ?? [502, 'That server could not be reached.'];
    return refuse(c, status, { code: `custom_mcp_${e.code}`, message, extra: e.code === 'url_refused' && e.detail ? { reason: e.detail } : undefined });
  }
  return refuse(c, 502, { code: 'custom_mcp_unreachable', message: 'That server could not be reached. Try again in a minute.' });
}

async function activity(env: Env, user: User, action: string, details: Record<string, unknown>): Promise<void> {
  try {
    await env.DB.prepare('INSERT INTO activity_logs (user_id, actor, action, details) VALUES (?, ?, ?, ?)')
      .bind(user.id, await hashEmail(user.email), action, JSON.stringify({ source: 'custom_mcp', ...details })).run();
  } catch { /* activity_logs may not exist in some schemas */ }
}

function view(row: IntegrationRow) {
  const cfg = configOf(row);
  return {
    uid: row.provider_key.slice('custom:'.length),
    host: cfg ? hostOf(cfg.url) : null,
    url: cfg?.url ?? null,
    status: row.status,
    last_error: row.last_error ?? null,
    last_synced_at: row.last_synced_at ?? null,
    approved: cfg ? Object.keys(cfg.approved) : [],
    drift: cfg?.drift ?? [],
    checked_at: cfg?.checked_at ?? null,
  };
}

router.get('/', async (c) => {
  await ensureIntegrationsSchema(c.env);
  const user = await requireAuth(c);
  const blocked = await gate(c, user);
  if (blocked) return blocked;
  const res = await c.env.DB.prepare("SELECT * FROM integrations WHERE user_id = ? AND provider_key LIKE 'custom:%' ORDER BY id").bind(user.id).all<IntegrationRow>();
  return c.json({ servers: (res.results ?? []).map(view), limits: { servers: CUSTOM_LIMITS.servers, approved: CUSTOM_LIMITS.approved } });
});

router.post('/start', async (c) => {
  await ensureIntegrationsSchema(c.env);
  const user = await requireAuth(c);
  const blocked = await gate(c, user);
  if (blocked) return blocked;
  const body = await c.req.json().catch(() => null) as { url?: unknown } | null;
  const url = typeof body?.url === 'string' ? body.url.trim() : '';
  if (await customCount(c.env, user.id) >= CUSTOM_LIMITS.servers) {
    return refuse(c, 409, { code: 'custom_mcp_too_many', message: `At most ${CUSTOM_LIMITS.servers} servers can be connected. Revoke one first.` });
  }
  const uid = newUid();
  const csrf = crypto.randomUUID() + crypto.randomUUID();
  let authorize: string;
  try {
    const { provider, server, client, config } = await prepareCustomSignIn(c.env, { url, uid, redirectUri: redirectUriFor(c) }, deps(c));
    const pkce = await buildPkce();
    const state = await issueOauthState(c.env, user.id, CUSTOM_STATE_PROVIDER, pkce.verifier, {
      csrf: await sha256(csrf), uid, config, client_key: client.key,
    });
    authorize = authorizeMcpUrl(provider, server, client, { state, challenge: pkce.challenge });
  } catch (e) {
    return refusal(c, e);
  }
  c.header('Set-Cookie', `${CSRF_COOKIE}=${csrf}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600`);
  c.header('Cache-Control', 'no-store');
  return c.json({ ok: true, uid, authorize_url: authorize });
});

const back = (c: C, outcome: 'ok' | Reason, uid?: string) => {
  c.header('Set-Cookie', `${CSRF_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`);
  c.header('Cache-Control', 'no-store');
  return c.redirect(outcome === 'ok' ? `${RETURN_PATH}?custom=ok&uid=${uid}` : `${RETURN_PATH}?custom=error&reason=${outcome}`);
};

router.get('/oauth/callback', async (c) => {
  await ensureIntegrationsSchema(c.env);
  const user = await requireAuth(c);
  const state = c.req.query('state') || '';
  const code = c.req.query('code') || '';
  // The state is consumed first, so it can never be replayed.
  const consumed = state ? await consumeOauthState(c.env, user.id, CUSTOM_STATE_PROVIDER, state) : null;
  if (!consumed) return back(c, 'invalid_state');
  const cookie = readCookie(c, CSRF_COOKIE);
  if (!cookie || typeof consumed.extra.csrf !== 'string' || (await sha256(cookie)) !== consumed.extra.csrf) return back(c, 'csrf_mismatch');
  if (c.req.query('error')) return back(c, 'access_denied');
  if (!code || !consumed.pkce_verifier) return back(c, 'missing_code');
  if (await gate(c, user)) return back(c, 'not_allowed');
  const uid = String(consumed.extra.uid || '');
  const config = configOf({ config_json: JSON.stringify(consumed.extra.config ?? null) } as IntegrationRow);
  if (!/^[0-9a-f]{32}$/.test(uid) || !config || typeof consumed.extra.client_key !== 'string') return back(c, 'invalid_state');
  if (await customCount(c.env, user.id) >= CUSTOM_LIMITS.servers) return back(c, 'too_many');

  let creds;
  try {
    creds = await completeCustomSignIn(c.env, {
      uid, config, code, verifier: consumed.pkce_verifier, clientKey: consumed.extra.client_key, redirectUri: redirectUriFor(c),
    }, deps(c));
  } catch {
    await activity(c.env, user, 'custom_mcp_sign_in_failed', { host: hostOf(config.url) });
    return back(c, 'sign_in_failed');
  }
  const stored: CustomConfig = { ...config, approved: {} };
  const enc = await encryptCredentials(c.env, uid, creds as unknown as CredentialBlob);
  await c.env.DB.prepare(
    'INSERT INTO integrations (uid, user_id, provider_key, display_name, status, auth_type, credentials_enc, config_json, capabilities_json, scopes_json) ' +
    "VALUES (?, ?, ?, ?, 'active', ?, ?, ?, '[]', ?)",
  ).bind(uid, user.id, customKey(uid), hostOf(config.url), MCP_AUTH_TYPE, enc, JSON.stringify(stored), JSON.stringify(creds.scopes)).run();
  await activity(c.env, user, 'custom_mcp_connected', { host: hostOf(config.url) });
  return back(c, 'ok', uid);
});

async function ownRow(c: C, user: User): Promise<IntegrationRow | Response> {
  const row = await customRowFor(c.env, user.id, c.req.param('uid') || '');
  return row ?? refusal(c, new CustomMcpError('not_found'));
}

router.get('/:uid/tools', async (c) => {
  const user = await requireAuth(c);
  const blocked = await gate(c, user);
  if (blocked) return blocked;
  const row = await ownRow(c, user);
  if (row instanceof Response) return row;
  try {
    c.header('Cache-Control', 'no-store');
    return c.json(await listCustomTools(c.env, row, deps(c)));
  } catch (e) { return refusal(c, e); }
});

router.post('/:uid/tools/:name/approve', async (c) => {
  const user = await requireAuth(c);
  const blocked = await gate(c, user);
  if (blocked) return blocked;
  const row = await ownRow(c, user);
  if (row instanceof Response) return row;
  const name = c.req.param('name') || '';
  if (!TOOL_NAME.test(name)) return refusal(c, new CustomMcpError('tool_not_listed'));
  try {
    const cfg = await approveCustomTool(c.env, row, name, deps(c));
    await activity(c.env, user, 'custom_mcp_tool_approved', { host: hostOf(cfg.url), tool: name });
    return c.json({ ok: true, approved: Object.keys(cfg.approved) });
  } catch (e) { return refusal(c, e); }
});

router.delete('/:uid/tools/:name/approve', async (c) => {
  const user = await requireAuth(c);
  const blocked = await gate(c, user);
  if (blocked) return blocked;
  const row = await ownRow(c, user);
  if (row instanceof Response) return row;
  const name = c.req.param('name') || '';
  if (!TOOL_NAME.test(name)) return refusal(c, new CustomMcpError('tool_not_listed'));
  try {
    const cfg = await unapproveCustomTool(c.env, row, name);
    await activity(c.env, user, 'custom_mcp_tool_withdrawn', { host: hostOf(cfg.url), tool: name });
    return c.json({ ok: true, approved: Object.keys(cfg.approved) });
  } catch (e) { return refusal(c, e); }
});

router.post('/:uid/health', async (c) => {
  const user = await requireAuth(c);
  const blocked = await gate(c, user);
  if (blocked) return blocked;
  const row = await ownRow(c, user);
  if (row instanceof Response) return row;
  return c.json(await checkCustomHealth(c.env, row, deps(c)));
});

router.delete('/:uid', async (c) => {
  const user = await requireAuth(c);
  // Revoking works with the flag off too: a member can always remove a server.
  if (await isSupportSession(c)) return refuse(c, 403, { code: 'support_session_refused', message: 'A support session cannot remove a member\'s MCP server.' });
  const row = await ownRow(c, user);
  if (row instanceof Response) return row;
  const host = hostOf(configOf(row)?.url ?? '');
  const out = await revokeCustomConnection(c.env, row, deps(c));
  await activity(c.env, user, 'custom_mcp_revoked', { host, provider_revoked: out.provider_revoked });
  return c.json({ ok: true, ...out });
});

export default router;
