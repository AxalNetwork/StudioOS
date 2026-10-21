/**
 * D840 (#2346) — Sign in with Mercury: OAuth 2.0 for Mercury's MCP server.
 *
 * THE FLOW, as the MCP authorization spec and Mercury describe it:
 *  1. DISCOVERY. The protected resource's metadata (RFC 9728) names the
 *     authorization server; its metadata (RFC 8414) names the endpoints. Every
 *     endpoint must be https on `mercury.com` or a subdomain, the issuer must
 *     be the one named, and S256 must be offered: anything else is refused.
 *  2. REGISTRATION (RFC 7591), once per environment and redirect URI, stored in
 *     `platform_settings` under `mercury_mcp_client:<redirect uri>`. Axal VC
 *     registers as a public client (`token_endpoint_auth_method: none`) named
 *     "Axal VC" (Mercury refuses a client name with "Mercury" in it). A secret,
 *     if Mercury issues one anyway, is stored encrypted and sent as Basic auth.
 *  3. AUTHORIZATION CODE WITH PKCE (S256), asking for `read offline_access`
 *     and naming the MCP server as the `resource` (RFC 8707).
 *  4. THE GRANT. A grant reporting any scope but `read` and `offline_access`
 *     is refused and revoked (`scopePermission`).
 *  5. REFRESH with the refresh token, behind #1903's lease, before the access
 *     token expires or after a 401. A refused refresh marks the row `error`.
 *  6. REVOKE (RFC 7009) on disconnect, best effort, then the row is deleted.
 *
 * TOKENS. The access and refresh tokens live only in the row's `credentials_enc`
 * (`secrets.ts`, AES-GCM bound to the row's uid). Nothing here logs, returns or
 * throws a token, a code, a verifier or a response body: an error is a
 * `MercuryOauthError` with a code alone.
 *
 * UNVERIFIED (mercury.com/auth.md and mcp.mercury.com unreachable from the
 * building session, 2026-10-21; D840.md): the metadata paths, that
 * registration is open, that a public client is accepted, that the token
 * endpoint reports `scope`, and that revocation is offered. The owner's first
 * live sign-in confirms them.
 */
import type { Env } from '../../types';
import type { IntegrationRow } from '../../integrations/registry';
import { decryptCredentials, encryptCredentials, type CredentialBlob } from '../../integrations/secrets';
import { acquireRefreshLease } from '../../integrations/refreshLease';
import { decryptColumn, encryptColumn } from '../columnCipher';
import { DeadlineExceeded, withDeadline } from '../../util/deadline';
import type { MercuryFetch } from './client';
import { MCP_READ_SCOPES, MERCURY_MCP_URL, type McpAccess } from './reads';

/** The MCP server, as the sign-in names it in `resource` (RFC 8707). */
export const MERCURY_MCP_RESOURCE = MERCURY_MCP_URL;
export const MERCURY_OAUTH_SCOPE = MCP_READ_SCOPES.join(' ');
/** `oauth_state_tokens.provider` for this flow, and `integrations.auth_type` for its rows. */
export const MERCURY_OAUTH_PROVIDER = 'mercury_mcp';
export const MERCURY_AUTH_TYPE = 'oauth_mcp';
export const CLIENT_NAME = 'Axal VC';
export const OAUTH_DEADLINE_MS = 10_000;
/** Refresh this long before the access token's expiry. */
export const REFRESH_EARLY_MS = 60_000;

export type MercuryOauthErrorCode =
  | 'discovery_failed' | 'metadata_refused' | 'registration_failed' | 'token_exchange_failed'
  | 'refresh_failed' | 'scope_refused' | 'timeout' | 'network_error';

/** A failed OAuth step: a code, never a body, a token or a URL with a secret in it. */
export class MercuryOauthError extends Error {
  readonly code: MercuryOauthErrorCode;
  readonly status: number | null;
  constructor(code: MercuryOauthErrorCode, status: number | null = null) {
    super(`mercury_oauth_${code}${status == null ? '' : `_${status}`}`);
    this.name = 'MercuryOauthError';
    this.code = code;
    this.status = status;
  }
}

export interface AuthServer {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  registration_endpoint: string;
  revocation_endpoint: string | null;
}

export interface RegisteredClient {
  key: string;
  issuer: string;
  client_id: string;
  client_secret: string | null;
  redirect_uri: string;
}

const obj = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : null;

/** https on mercury.com or one of its subdomains, with no credentials in the URL. */
export function isMercuryHttps(raw: unknown): raw is string {
  if (typeof raw !== 'string') return false;
  let u: URL;
  try { u = new URL(raw); } catch { return false; }
  return u.protocol === 'https:' && !u.username && !u.password && (u.hostname === 'mercury.com' || u.hostname.endsWith('.mercury.com'));
}

async function send(fetcher: MercuryFetch, url: string, init: RequestInit, onFail: MercuryOauthErrorCode): Promise<{ status: number; body: Record<string, unknown> | null }> {
  let res: Response;
  try {
    res = await withDeadline(fetcher(url, { ...init, redirect: 'manual' }), OAUTH_DEADLINE_MS, 'mercury_oauth');
  } catch (e) {
    throw new MercuryOauthError(e instanceof DeadlineExceeded ? 'timeout' : 'network_error');
  }
  if (res.status === 0 || (res.status >= 300 && res.status < 400)) throw new MercuryOauthError(onFail, res.status || null);
  let body: Record<string, unknown> | null = null;
  try { body = obj(await withDeadline(res.json(), OAUTH_DEADLINE_MS, 'mercury_oauth')); } catch { body = null; }
  return { status: res.status, body };
}

const getJson = (fetcher: MercuryFetch, url: string) =>
  send(fetcher, url, { method: 'GET', headers: { Accept: 'application/json' } }, 'discovery_failed');

/** RFC 9728's well-known URL for a resource with a path, then the host's own. */
function resourceMetadataUrls(resource: string): string[] {
  const u = new URL(resource);
  const path = u.pathname.replace(/\/+$/, '');
  return [...(path ? [`${u.origin}/.well-known/oauth-protected-resource${path}`] : []), `${u.origin}/.well-known/oauth-protected-resource`];
}

/** RFC 8414's well-known URLs for an issuer (path inserted), then OpenID's. */
function serverMetadataUrls(issuer: string): string[] {
  const u = new URL(issuer);
  const path = u.pathname.replace(/\/+$/, '');
  return [`${u.origin}/.well-known/oauth-authorization-server${path}`, `${u.origin}/.well-known/openid-configuration${path}`];
}

/** Step 1: the authorization server for Mercury's MCP server, checked. */
export async function discover(fetcher: MercuryFetch = fetch): Promise<AuthServer> {
  let issuer: string | null = null;
  for (const url of resourceMetadataUrls(MERCURY_MCP_RESOURCE)) {
    const { status, body } = await getJson(fetcher, url);
    if (status !== 200 || !body) continue;
    const servers = Array.isArray(body.authorization_servers) ? body.authorization_servers : [];
    issuer = typeof servers[0] === 'string' ? servers[0] : null;
    break;
  }
  if (!issuer) throw new MercuryOauthError('discovery_failed');
  if (!isMercuryHttps(issuer)) throw new MercuryOauthError('metadata_refused');
  for (const url of serverMetadataUrls(issuer)) {
    const { status, body } = await getJson(fetcher, url);
    if (status !== 200 || !body) continue;
    const methods = Array.isArray(body.code_challenge_methods_supported) ? body.code_challenge_methods_supported : [];
    const sameIssuer = String(body.issuer ?? '').replace(/\/+$/, '') === issuer.replace(/\/+$/, '');
    const endpoints = [body.authorization_endpoint, body.token_endpoint, body.registration_endpoint];
    if (!sameIssuer || !methods.includes('S256') || !endpoints.every(isMercuryHttps)) throw new MercuryOauthError('metadata_refused');
    if (body.revocation_endpoint != null && !isMercuryHttps(body.revocation_endpoint)) throw new MercuryOauthError('metadata_refused');
    return {
      issuer,
      authorization_endpoint: body.authorization_endpoint as string,
      token_endpoint: body.token_endpoint as string,
      registration_endpoint: body.registration_endpoint as string,
      revocation_endpoint: (body.revocation_endpoint as string | undefined) ?? null,
    };
  }
  throw new MercuryOauthError('discovery_failed');
}

const clientKey = (redirectUri: string) => `mercury_mcp_client:${redirectUri}`;

interface StoredClient { issuer: string; client_id: string; client_secret_enc: string | null; redirect_uri: string }

async function readClient(env: Env, key: string): Promise<RegisteredClient | null> {
  const row = await env.DB.prepare('SELECT value FROM platform_settings WHERE key = ?').bind(key).first<{ value: string }>();
  if (!row) return null;
  let v: StoredClient;
  try { v = JSON.parse(row.value) as StoredClient; } catch { return null; }
  if (typeof v?.client_id !== 'string' || typeof v.issuer !== 'string') return null;
  const secret = v.client_secret_enc ? await decryptColumn(env, 'platform_settings', 'value', key, v.client_secret_enc) : null;
  return { key, issuer: v.issuer, client_id: v.client_id, client_secret: secret, redirect_uri: v.redirect_uri };
}

/** Step 2: this environment's client for `redirectUri`, registered on first use. */
export async function registeredClient(env: Env, server: AuthServer, redirectUri: string, fetcher: MercuryFetch = fetch): Promise<RegisteredClient> {
  const key = clientKey(redirectUri);
  const stored = await readClient(env, key);
  if (stored && stored.issuer === server.issuer && stored.redirect_uri === redirectUri) return stored;
  const { status, body } = await send(fetcher, server.registration_endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      client_name: CLIENT_NAME,
      redirect_uris: [redirectUri],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
      scope: MERCURY_OAUTH_SCOPE,
    }),
  }, 'registration_failed');
  const clientId = typeof body?.client_id === 'string' && /^[\x21-\x7e]{1,256}$/.test(body.client_id) ? body.client_id : null;
  if ((status !== 200 && status !== 201) || !clientId) throw new MercuryOauthError('registration_failed', status);
  const secret = typeof body?.client_secret === 'string' && body.client_secret ? body.client_secret : null;
  const value: StoredClient = {
    issuer: server.issuer, client_id: clientId, redirect_uri: redirectUri,
    client_secret_enc: secret ? await encryptColumn(env, 'platform_settings', 'value', key, secret) : null,
  };
  // The first registration for a redirect URI wins a race (the read-back returns
  // it); one made with another issuer is replaced.
  if (stored) {
    await env.DB.prepare("UPDATE platform_settings SET value = ?, updated_at = CURRENT_TIMESTAMP, updated_by = 'd840_registration' WHERE key = ?")
      .bind(JSON.stringify(value), key).run();
  } else {
    await env.DB.prepare("INSERT OR IGNORE INTO platform_settings (key, value, updated_by) VALUES (?, ?, 'd840_registration')")
      .bind(key, JSON.stringify(value)).run();
  }
  return (await readClient(env, key)) ?? { key, issuer: server.issuer, client_id: clientId, client_secret: secret, redirect_uri: redirectUri };
}

/** Step 3: the URL the browser is sent to. */
export function authorizeUrl(server: AuthServer, client: RegisteredClient, p: { state: string; challenge: string }): string {
  const u = new URL(server.authorization_endpoint);
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('client_id', client.client_id);
  u.searchParams.set('redirect_uri', client.redirect_uri);
  u.searchParams.set('scope', MERCURY_OAUTH_SCOPE);
  u.searchParams.set('state', p.state);
  u.searchParams.set('code_challenge', p.challenge);
  u.searchParams.set('code_challenge_method', 'S256');
  u.searchParams.set('resource', MERCURY_MCP_RESOURCE);
  return u.toString();
}

/** The member's tokens as the row stores them, encrypted. */
export interface McpCredentials extends CredentialBlob {
  access_token: string;
  refresh_token?: string;
  /** Epoch milliseconds. */
  expires_at: number | null;
  scopes: string[];
  issuer: string;
  client_key: string;
}

function tokenHeaders(client: RegisteredClient): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' };
  if (client.client_secret) h.Authorization = `Basic ${btoa(`${encodeURIComponent(client.client_id)}:${encodeURIComponent(client.client_secret)}`)}`;
  return h;
}

function toCredentials(body: Record<string, unknown> | null, client: RegisteredClient, prior: McpCredentials | null, onFail: MercuryOauthErrorCode): McpCredentials {
  const access = typeof body?.access_token === 'string' && body.access_token ? body.access_token : null;
  if (!access) throw new MercuryOauthError(onFail);
  const expiresIn = typeof body?.expires_in === 'number' && Number.isFinite(body.expires_in) && body.expires_in > 0 ? body.expires_in : null;
  // RFC 6749 §5.1: an omitted scope is the scope requested (or, on a refresh, the scope held).
  const scopes = typeof body?.scope === 'string' ? body.scope.split(/\s+/).filter(Boolean) : prior?.scopes ?? [...MCP_READ_SCOPES];
  return {
    access_token: access,
    refresh_token: typeof body?.refresh_token === 'string' && body.refresh_token ? body.refresh_token : prior?.refresh_token,
    expires_at: expiresIn ? Date.now() + expiresIn * 1000 : null,
    token_type: 'Bearer',
    scopes,
    issuer: client.issuer,
    client_key: client.key,
  };
}

/** Step 3's second half: the code and the verifier for the member's tokens. */
export async function exchangeCode(server: AuthServer, client: RegisteredClient, p: { code: string; verifier: string }, fetcher: MercuryFetch = fetch): Promise<McpCredentials> {
  const form = new URLSearchParams({
    grant_type: 'authorization_code', code: p.code, redirect_uri: client.redirect_uri,
    client_id: client.client_id, code_verifier: p.verifier, resource: MERCURY_MCP_RESOURCE,
  });
  const { status, body } = await send(fetcher, server.token_endpoint, { method: 'POST', headers: tokenHeaders(client), body: form.toString() }, 'token_exchange_failed');
  if (status !== 200) throw new MercuryOauthError('token_exchange_failed', status);
  return toCredentials(body, client, null, 'token_exchange_failed');
}

/** Step 6, best effort: revoke one token. Never throws. */
export async function revokeToken(server: AuthServer, client: RegisteredClient, token: string, hint: 'access_token' | 'refresh_token', fetcher: MercuryFetch = fetch): Promise<boolean> {
  if (!server.revocation_endpoint || !token) return false;
  try {
    const form = new URLSearchParams({ token, token_type_hint: hint, client_id: client.client_id });
    const { status } = await send(fetcher, server.revocation_endpoint, { method: 'POST', headers: tokenHeaders(client), body: form.toString() }, 'network_error');
    return status === 200;
  } catch { return false; }
}

/** Revoke a grant's refresh and access tokens, best effort. */
export async function revokeGrant(env: Env, creds: Pick<McpCredentials, 'access_token' | 'refresh_token' | 'client_key'>, fetcher: MercuryFetch = fetch): Promise<void> {
  try {
    const client = await readClient(env, creds.client_key);
    if (!client) return;
    const server = await discover(fetcher);
    if (creds.refresh_token) await revokeToken(server, client, creds.refresh_token, 'refresh_token', fetcher);
    await revokeToken(server, client, creds.access_token, 'access_token', fetcher);
  } catch { /* the grant expires on its own; the row is deleted either way */ }
}

/** The row's credentials when they are a sign-in's, else null. */
export async function mcpCredentialsOf(env: Env, row: IntegrationRow): Promise<McpCredentials | null> {
  if (row.auth_type !== MERCURY_AUTH_TYPE) return null;
  const c = await decryptCredentials(env, row.uid, row.credentials_enc);
  if (!c || typeof c.access_token !== 'string' || typeof c.client_key !== 'string') return null;
  return c as McpCredentials;
}

async function markRefreshRefused(env: Env, row: IntegrationRow): Promise<void> {
  await env.DB.prepare(
    "UPDATE integrations SET status = 'error', last_error = 'token_rejected', last_error_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
  ).bind(row.id).run();
}

/**
 * Step 5: new tokens from the refresh token, stored before they are used.
 * Null when Mercury refuses the refresh (the row is then `error`) or there is
 * no refresh token. Behind the lease, a second caller re-reads the row instead.
 */
export async function refreshCredentials(env: Env, row: IntegrationRow, creds: McpCredentials, fetcher: MercuryFetch = fetch): Promise<McpCredentials | null> {
  if (!creds.refresh_token) return null;
  const lease = await acquireRefreshLease(env, MERCURY_OAUTH_PROVIDER, row.uid);
  try {
    if (!lease.acquired) {
      const again = await env.DB.prepare('SELECT * FROM integrations WHERE id = ?').bind(row.id).first<IntegrationRow>();
      const fresh = again ? await mcpCredentialsOf(env, again) : null;
      if (fresh && fresh.access_token !== creds.access_token) return fresh;
    }
    const client = await readClient(env, creds.client_key);
    if (!client) throw new MercuryOauthError('refresh_failed');
    const server = await discover(fetcher);
    const form = new URLSearchParams({ grant_type: 'refresh_token', refresh_token: creds.refresh_token, client_id: client.client_id, resource: MERCURY_MCP_RESOURCE });
    const { status, body } = await send(fetcher, server.token_endpoint, { method: 'POST', headers: tokenHeaders(client), body: form.toString() }, 'refresh_failed');
    if (status === 400 || status === 401) { await markRefreshRefused(env, row); return null; }
    if (status !== 200) throw new MercuryOauthError('refresh_failed', status);
    const next = toCredentials(body, client, creds, 'refresh_failed');
    if (next.scopes.some((s) => !MCP_READ_SCOPES.includes(s))) { await markRefreshRefused(env, row); return null; }
    await env.DB.prepare('UPDATE integrations SET credentials_enc = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
      .bind(await encryptCredentials(env, row.uid, next), row.id).run();
    return next;
  } finally {
    await lease.release();
  }
}

/**
 * The member's MCP access for `reads.ts`: the stored access token, refreshed
 * first when it is about to expire, and `refresh` for a 401.
 */
export async function mcpAccessFor(env: Env, row: IntegrationRow, creds: McpCredentials, fetcher?: MercuryFetch): Promise<McpAccess & { scopes: string[] }> {
  let current = creds;
  if (current.expires_at != null && current.expires_at - REFRESH_EARLY_MS <= Date.now()) {
    const fresh = await refreshCredentials(env, row, current, fetcher);
    if (fresh) current = fresh;
  }
  return {
    accessToken: current.access_token,
    scopes: current.scopes,
    fetcher,
    refresh: async () => {
      const fresh = await refreshCredentials(env, row, current, fetcher);
      if (fresh) current = fresh;
      return fresh?.access_token ?? null;
    },
  };
}

/**
 * D840 (#2346): the access a route uses to read a member's OWN Mercury through
 * the MCP server, refreshed when needed. Null when the member has no active
 * signed-in row (no row, a pasted token, `status` not `active`, or tokens
 * that cannot be read). Parts 2–4 call this, then `openMercuryReads(access)`.
 *
 * THE ROW. A member's one `integrations` row with `provider_key = 'mercury'`.
 *  - `auth_type`: `oauth_mcp` for a sign-in, `api_key` for a pasted token (D713).
 *  - `credentials_enc`: the only place the tokens live, AES-GCM bound to the
 *    row's `uid` (`secrets.ts`), as `McpCredentials`:
 *    `{ access_token, refresh_token, expires_at (epoch ms), token_type, scopes, issuer, client_key }`.
 *  - `scopes_json`: the granted scopes; `config_json`: `{ read_only: 'reported', via: 'oauth_mcp' }`;
 *    `external_account_id` / `external_account_name`: the organization's id and legal name.
 *
 * It reads only the caller's own row: `userId` is the signed-in member, never
 * a parameter from a request.
 */
export async function mercuryAccessFor(env: Env, userId: number, fetcher?: MercuryFetch): Promise<(McpAccess & { scopes: string[] }) | null> {
  const row = await env.DB.prepare("SELECT * FROM integrations WHERE user_id = ? AND provider_key = 'mercury' LIMIT 1")
    .bind(userId).first<IntegrationRow>();
  if (!row || row.status !== 'active') return null;
  let creds: McpCredentials | null = null;
  try { creds = await mcpCredentialsOf(env, row); } catch { creds = null; }
  return creds ? mcpAccessFor(env, row, creds, fetcher) : null;
}
