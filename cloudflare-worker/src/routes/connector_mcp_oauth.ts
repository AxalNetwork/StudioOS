/**
 * D1080 (#2945, #2404 part 2) — Sign in with <Provider>, for any record in
 * `MCP_PROVIDERS` whose callback is the generic one. Mounted at
 * `/api/integrations/mcp`, ahead of the integrations router.
 *
 *   GET /:key/start        { ok, authorize_url }: discovery, this host's client,
 *                          PKCE and the state; sets the CSRF cookie
 *   GET /:key/callback     the provider redirects the browser here; answers with
 *                          a redirect to the connector page carrying an outcome
 *                          word only (`?oauth=ok|error&provider=<key>&reason=…`)
 *   GET /:key/client.json  the client ID metadata document, public, for a record
 *                          whose `cimd_url` is this route on axal.vc
 *
 * `:key` is looked up in the frozen records (`genericMcpProvider`), never
 * interpolated: an unknown key, and Mercury (which keeps `mercury_oauth.ts`
 * until #2404 part 3), are answered 404.
 *
 * WHO STARTS. Signed in; the provider's descriptor visible to the caller
 * (`audienceFor`, D757); not a support session; an active company when the
 * provider writes project data; not coming soon; the plan the descriptor
 * names; and D751's readiness (`mcpReadiness`): a record that needs a
 * pre-registered client HQ does not hold is refused before any state.
 *
 * THE CALLBACK, in this order, each before anything is stored:
 *  1. the state: #1's signed, single-use, ten-minute token, HMAC-bound to the
 *     user and to the record's `state_provider`; it carries the PKCE verifier,
 *     the issuer and resource discovered at start, the client's key, the
 *     company and the page to return to;
 *  2. the CSRF cookie, whose SHA-256 rides in the state;
 *  3. `iss` (RFC 9207): the server is discovered again and must name the same
 *     issuer; `iss` is required when the server says it sends one, and when
 *     present must be that issuer. On a mismatch nothing is acted on, the
 *     provider's own `error` included;
 *  4. the provider's `error`, a missing code, and the start's refusals again;
 *  5. the code exchange; a grant holding any scope off `accepted_scopes` is
 *     revoked and refused (`exchangeMcpCode`);
 *  6. the provider's own `verifySignIn`, when it has one; a failure revokes;
 *  7. one `integrations` row for the member and provider, `auth_type =
 *     'oauth_mcp'`, its tokens encrypted against its uid (`secrets.ts`).
 *
 * NOTHING CREDENTIAL-SHAPED IS LOGGED OR RETURNED. A redirect and an
 * `activity_logs` row carry a fixed reason word only.
 */
import { Hono } from 'hono';
import type { Context } from 'hono';
import type { Env, User } from '../types';
import { requireAuth, selectJwt } from '../auth';
import { branchOf } from '../util/branch';
import { hashEmail } from '../util/hashEmail';
import { userMeetsTier, tierUpsell } from '../middleware/requireTier';
import { activeCompanyFor } from '../middleware/activeCompany';
import { refuse } from '../util/refusal';
import { buildPkce, consumeOauthState, issueOauthState } from '../integrations/oauth';
import { audienceFor, ensureIntegrationsSchema, getDescriptor, type IntegrationRow, type ProviderDescriptor } from '../integrations/registry';
import { encryptCredentials, type CredentialBlob } from '../integrations/secrets';
import { writesProjectData as writesProjectDataDefault } from '../integrations/companyScope';
import { canHoldValidateSource } from './_founder_validate_helpers';
import { MCP_PROVIDERS, type McpProvider } from '../integrations/mcpProviders';
import {
  authorizeMcpUrl, discoverMcp, exchangeMcpCode, issuerAccepted, mcpClientFor, McpOauthError, MCP_AUTH_TYPE, resolveMcpClient, revokeMcpTokens,
  type McpCredentials, type McpFetch, type McpPreregistered,
} from '../integrations/mcpClient';
import { genericMcpProvider, mcpCallbackPath, mcpCimdUrl, mcpPreregisteredFor, mcpReadiness } from '../integrations/mcpSignIn';

type C = Context<{ Bindings: Env }>;

export const CSRF_COOKIE = '__Host-axal_mcp_oauth';

/** The words a failed sign-in returns with; nothing else reaches the query string. */
export const CALLBACK_REASONS = [
  'invalid_state', 'csrf_mismatch', 'issuer_mismatch', 'access_denied', 'missing_code', 'not_allowed',
  'discovery_failed', 'token_exchange_failed', 'scope_refused', 'sign_in_refused', 'callback_failed',
] as const;
type Reason = typeof CALLBACK_REASONS[number];

/** What a provider's own check of a fresh sign-in answers; the account's id and name label the connection. */
export type McpSignInCheck = { ok: true; external_account_id?: string | null; external_account_name?: string | null } | { ok: false };
export type McpVerifySignIn = (env: Env, access: { accessToken: string; scopes: string[]; resource: string; fetcher?: McpFetch }) => Promise<McpSignInCheck>;

export interface McpOauthDeps {
  providers?: Readonly<Record<string, McpProvider>>;
  descriptor?: (key: string) => ProviderDescriptor | null;
  writesProjectData?: (key: string) => boolean;
  /** Provider checks, by record key (D1080 §4). None today: a provider's issue adds its own. */
  verifySignIn?: Readonly<Record<string, McpVerifySignIn>>;
  fetcher?: McpFetch;
  /** A pre-registered client's loader; HQ › Integration keys' (`mcpPreregisteredFor`) when omitted. */
  preregistered?: (record: McpProvider) => McpPreregistered | undefined;
}

const RETURN_MAX = 200;

/** The page a sign-in returns to: a path on this site, or the connector's own page. */
export function returnPath(raw: unknown, key: string): string {
  const fallback = `/account/connectors/${key}`;
  if (typeof raw !== 'string' || !raw || raw.length > RETURN_MAX) return fallback;
  if (!raw.startsWith('/') || raw.startsWith('//') || /[\\\s]/.test(raw) || raw.includes('://')) return fallback;
  return raw;
}

/** This host's callback URL: the sign-in returns to the host it started on, where the cookie lives. */
export function redirectUriFor(c: C, record: McpProvider): string {
  const u = new URL(c.req.url);
  return `${u.hostname === 'localhost' ? u.protocol : 'https:'}//${u.host}${mcpCallbackPath(record.key)}`;
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

function newUid(): string {
  return [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function createMcpOauthRouter(deps: McpOauthDeps = {}) {
  const providers = deps.providers ?? MCP_PROVIDERS;
  const descriptorOf = deps.descriptor ?? getDescriptor;
  const writesProjectData = deps.writesProjectData ?? writesProjectDataDefault;
  const router = new Hono<{ Bindings: Env }>();

  const lookup = (c: C) => {
    const record = genericMcpProvider(providers, c.req.param('key') || '');
    const desc = record ? descriptorOf(record.key) : null;
    return record && desc ? { record, desc } : null;
  };

  /** Who may sign in. A Response when refused; `company` is checked at start only (the callback has the state's). */
  async function signInRefusal(c: C, user: User, record: McpProvider, desc: ProviderDescriptor, company: boolean): Promise<Response | null> {
    const viewer = { role: String(user.role || ''), hq: branchOf(c.env) === null, venture: canHoldValidateSource(user) };
    const audience = audienceFor(desc, viewer);
    if (audience !== 'open' && audience !== 'personal') return c.json({ error: 'unknown_provider', provider_key: record.key }, 404);
    if ((await selectJwt(c))?.payload.impersonated_by) {
      return refuse(c, 403, { code: 'support_session_refused', message: `A support session cannot connect a member’s ${desc.display_name} account.` });
    }
    if (company && writesProjectData(record.key) && !(await activeCompanyFor(c, user))) return c.json({ error: 'active_company_required' }, 400);
    if (desc.status === 'coming_soon') {
      return c.json({ error: 'coming_soon', message: `${desc.display_name} isn't available yet — join the waitlist to be notified.` }, 503, { 'Retry-After': '86400' });
    }
    if (desc.tier !== 'free' && !userMeetsTier(user, desc.tier as 'growth' | 'studio')) return c.json(tierUpsell(desc.tier as 'growth' | 'studio'), 402);
    return null;
  }

  const loaderFor = (c: C, record: McpProvider) => (deps.preregistered ? deps.preregistered(record) : mcpPreregisteredFor(c.env, record));
  const opts = (c: C, record: McpProvider) => ({ fetcher: deps.fetcher, preregistered: loaderFor(c, record) });

  router.get('/:key/start', async (c) => {
    const user = await requireAuth(c);
    const found = lookup(c);
    if (!found) return c.json({ error: 'unknown_provider' }, 404);
    const { record, desc } = found;
    const refusal = await signInRefusal(c, user, record, desc, true);
    if (refusal) return refusal;
    const ready = await mcpReadiness(c.env, record, deps.preregistered ? deps.preregistered(record) : undefined);
    if (ready !== true) {
      c.header('Retry-After', '60');
      return refuse(c, 503, ready === false
        ? { code: 'oauth_unconfigured', message: `${desc.display_name} isn't set up on Axal yet, so it can't be connected. Nothing was sent to ${desc.display_name}.`, extra: { provider: record.key } }
        : { code: 'oauth_setup_unreadable', message: `Axal couldn't check whether ${desc.display_name} is set up, so it can't be connected right now. Nothing was sent to ${desc.display_name}. Try again in a minute.`, extra: { provider: record.key } });
    }
    const csrf = crypto.randomUUID() + crypto.randomUUID();
    let url: string;
    try {
      const server = await discoverMcp(record, { fetcher: deps.fetcher });
      const client = await mcpClientFor(c.env, record, server, redirectUriFor(c, record), opts(c, record));
      const pkce = await buildPkce();
      const company = await activeCompanyFor(c, user).catch(() => null);
      const state = await issueOauthState(c.env, user.id, record.state_provider, pkce.verifier, {
        csrf: await sha256(csrf), client_key: client.key, issuer: server.issuer, resource: server.resource,
        company_id: company ?? null, return_to: returnPath(c.req.query('return_to'), record.key),
      });
      url = authorizeMcpUrl(record, server, client, { state, challenge: pkce.challenge });
    } catch (e) {
      return refuse(c, 503, {
        code: 'mcp_sign_in_unavailable',
        message: `${desc.display_name}'s sign-in could not be reached, so nothing was sent to ${desc.display_name}. Try again in a minute.`,
        extra: { provider: record.key, reason: e instanceof McpOauthError ? e.code : 'setup_failed' },
      });
    }
    c.header('Set-Cookie', `${CSRF_COOKIE}=${csrf}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600`);
    c.header('Cache-Control', 'no-store');
    return c.json({ ok: true, authorize_url: url });
  });

  const back = (c: C, key: string, returnTo: string, outcome: 'ok' | Reason) => {
    c.header('Set-Cookie', `${CSRF_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`);
    c.header('Cache-Control', 'no-store');
    const u = new URL(returnTo, 'https://axal.invalid');
    u.searchParams.set('oauth', outcome === 'ok' ? 'ok' : 'error');
    u.searchParams.set('provider', key);
    if (outcome !== 'ok') u.searchParams.set('reason', outcome);
    return c.redirect(`${u.pathname}${u.search}`);
  };

  async function activity(env: Env, user: User, key: string, action: string, details: Record<string, unknown>): Promise<void> {
    try {
      await env.DB.prepare('INSERT INTO activity_logs (user_id, actor, action, details) VALUES (?, ?, ?, ?)')
        .bind(user.id, await hashEmail(user.email), action, JSON.stringify({ provider_key: key, source: 'mcp_sign_in', ...details })).run();
    } catch { /* activity_logs may not exist in some schemas */ }
  }

  router.get('/:key/callback', async (c) => {
    await ensureIntegrationsSchema(c.env);
    const user = await requireAuth(c);
    const found = lookup(c);
    if (!found) return c.json({ error: 'unknown_provider' }, 404);
    const { record, desc } = found;
    const fallback = returnPath(null, record.key);
    const state = c.req.query('state') || '';
    // 1. The state is consumed first, whatever else the query says, so it can never be replayed.
    const consumed = state ? await consumeOauthState(c.env, user.id, record.state_provider, state) : null;
    if (!consumed) return back(c, record.key, fallback, 'invalid_state');
    const extra = consumed.extra;
    const returnTo = returnPath(extra.return_to, record.key);
    const fail = async (reason: Reason) => {
      await activity(c.env, user, record.key, 'integration_oauth_failed', { reason });
      return back(c, record.key, returnTo, reason);
    };
    // 2. The cookie this browser was given at start.
    const cookie = readCookie(c, CSRF_COOKIE);
    if (!cookie || typeof extra.csrf !== 'string' || (await sha256(cookie)) !== extra.csrf) return back(c, record.key, returnTo, 'csrf_mismatch');
    if (typeof extra.issuer !== 'string' || typeof extra.resource !== 'string' || typeof extra.client_key !== 'string') return back(c, record.key, returnTo, 'invalid_state');

    // 3. RFC 9207, against the issuer recorded at start.
    let server;
    try { server = await discoverMcp(record, { fetcher: deps.fetcher, resource: extra.resource }); }
    catch { return fail('discovery_failed'); }
    if (server.issuer !== extra.issuer || !issuerAccepted(server, extra.issuer, c.req.query('iss'))) return fail('issuer_mismatch');

    // 4. The provider's answer, then who may still sign in.
    if (c.req.query('error')) return back(c, record.key, returnTo, 'access_denied');
    const code = c.req.query('code') || '';
    if (!code || !consumed.pkce_verifier) return back(c, record.key, returnTo, 'missing_code');
    if (await signInRefusal(c, user, record, desc, false)) return back(c, record.key, returnTo, 'not_allowed');

    // 5. The exchange; an overreaching grant is revoked inside `exchangeMcpCode`.
    const resolved = await resolveMcpClient(c.env, record, server, extra.client_key, opts(c, record)).catch(() => null);
    if (!resolved) return back(c, record.key, returnTo, 'invalid_state');
    const client = { ...resolved, redirect_uri: redirectUriFor(c, record) };
    let creds: McpCredentials;
    try {
      creds = await exchangeMcpCode(record, server, client, { code, verifier: consumed.pkce_verifier }, deps.fetcher);
    } catch (e) {
      return fail(e instanceof McpOauthError && e.code === 'scope_refused' ? 'scope_refused' : 'token_exchange_failed');
    }

    // 6. The provider's own check, revoked when it fails.
    let account: { id: string | null; name: string | null } = { id: null, name: null };
    const verify = deps.verifySignIn && Object.hasOwn(deps.verifySignIn, record.key) ? deps.verifySignIn[record.key] : null;
    if (verify) {
      let check: McpSignInCheck;
      try { check = await verify(c.env, { accessToken: creds.access_token, scopes: creds.scopes, resource: server.resource, fetcher: deps.fetcher }); }
      catch { check = { ok: false }; }
      if (!check.ok) {
        await revokeMcpTokens(server, client, creds, deps.fetcher);
        return fail('sign_in_refused');
      }
      account = { id: check.external_account_id ?? null, name: check.external_account_name ?? null };
    }

    // 7. One row for the member and provider.
    try {
      const existing = await c.env.DB.prepare('SELECT * FROM integrations WHERE user_id = ? AND provider_key = ?')
        .bind(user.id, record.key).first<IntegrationRow>();
      const uid = existing?.uid || newUid();
      const enc = await encryptCredentials(c.env, uid, creds as unknown as CredentialBlob);
      const config = JSON.stringify({ via: MCP_AUTH_TYPE, resource: server.resource });
      const caps = JSON.stringify(desc.capabilities);
      const scopes = JSON.stringify(creds.scopes);
      if (existing) {
        await c.env.DB.prepare(
          "UPDATE integrations SET status = 'active', auth_type = ?, credentials_enc = ?, config_json = ?, capabilities_json = ?, scopes_json = ?, " +
          'external_account_id = ?, external_account_name = ?, last_error = NULL, last_error_at = NULL, updated_at = CURRENT_TIMESTAMP WHERE uid = ?',
        ).bind(MCP_AUTH_TYPE, enc, config, caps, scopes, account.id, account.name, uid).run();
      } else {
        await c.env.DB.prepare(
          'INSERT INTO integrations (uid, user_id, provider_key, display_name, status, auth_type, credentials_enc, config_json, capabilities_json, scopes_json, external_account_id, external_account_name) ' +
          "VALUES (?, ?, ?, ?, 'active', ?, ?, ?, ?, ?, ?, ?)",
        ).bind(uid, user.id, record.key, desc.display_name, MCP_AUTH_TYPE, enc, config, caps, scopes, account.id, account.name).run();
      }
      const row = await c.env.DB.prepare('SELECT id FROM integrations WHERE uid = ?').bind(uid).first<{ id: number }>();
      if (row) {
        const company = Number(extra.company_id);
        if (Number.isSafeInteger(company) && company > 0
          && await c.env.DB.prepare('SELECT 1 AS linked FROM user_company_links WHERE user_id = ? AND company_id = ?').bind(user.id, company).first()) {
          await c.env.DB.prepare(
            'INSERT INTO integration_companies (integration_id, company_id, enabled) VALUES (?, ?, 1) ON CONFLICT(integration_id, company_id) DO UPDATE SET enabled = 1',
          ).bind(row.id, company).run();
        }
        await c.env.DB.prepare(
          'INSERT INTO integration_logs (integration_id, user_id, provider_key, direction, event_type, status, response_summary, external_id) ' +
          "VALUES (?, ?, ?, 'inbound', 'oauth_callback', 'ok', ?, ?)",
        ).bind(row.id, user.id, record.key, existing ? `Signed in with ${desc.display_name} again.` : `Signed in with ${desc.display_name}; connection established.`, account.id).run();
      }
      await activity(c.env, user, record.key, existing ? 'integration_reconnected' : 'integration_connected', {});
    } catch {
      // Nothing half-stored is left holding a live grant.
      await revokeMcpTokens(server, client, creds, deps.fetcher);
      return fail('callback_failed');
    }
    return back(c, record.key, returnTo, 'ok');
  });

  /** The client ID metadata document: public, no secret, for a record that publishes one here. */
  router.get('/:key/client.json', (c) => {
    const key = c.req.param('key') || '';
    const record = Object.hasOwn(providers, key) ? providers[key] : null;
    if (!record || record.key !== key || !record.registration.includes('cimd') || record.cimd_url !== mcpCimdUrl(key)) return c.json({ error: 'not_found' }, 404);
    const callback = record.callback_path;
    c.header('Cache-Control', 'public, max-age=3600');
    return c.json({
      client_id: record.cimd_url,
      client_name: 'Axal VC',
      client_uri: 'https://axal.vc',
      redirect_uris: [`https://axal.vc${callback}`, `https://app.axal.vc${callback}`],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
      scope: record.scopes.join(' '),
    });
  });

  return router;
}

export default createMcpOauthRouter();
