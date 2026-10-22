/**
 * D840 (#2346) — Sign in with Mercury, for a member's own connection.
 * Mounted at `/api/integrations/mercury/oauth`, ahead of the integrations router.
 *
 *   GET /start      { ok, authorize_url }: discovery, this host's registered
 *                   client, PKCE and the state; sets the CSRF cookie
 *   GET /callback   Mercury redirects the browser here; answers with a redirect
 *                   to `/account/connectors/mercury?oauth=ok|error&reason=…`
 *
 * WHO. Exactly who holds a personal connection (D713, D752): a founder, a partner, or an
 * investor on HQ, as their role's personal variant. A support session is
 * refused; an investor off HQ reads D752's sentence; anyone else is answered
 * 404 as if Mercury were not there. A founder needs the plan Mercury needs.
 *
 * STATE AND CSRF, both checked before the code is exchanged:
 *  - `state` is #1's signed, single-use, ten-minute token, HMAC-bound to the
 *    signed-in user and to `mercury_mcp` (`integrations/oauth.ts`). A state
 *    issued to another user, replayed, or expired is refused.
 *  - the start sets `__Host-axal_mercury_oauth`, a random value whose SHA-256
 *    rides in the state's row. The callback must carry the same cookie, so a
 *    callback URL replayed in another browser is refused even for the same user.
 *
 * THE GRANT. The code is exchanged with the PKCE verifier; a grant holding any
 * scope but `read` and `offline_access` is revoked and refused. The
 * organization and its accounts are then read through the MCP server and held
 * to D713's decision 3 (not an Axal entity's). Only then is the row written:
 * the member's one `integrations` row for `mercury`, `auth_type = 'oauth_mcp'`,
 * its tokens encrypted (`secrets.ts`). A member who had pasted a token keeps
 * the same row, now signed in. Since D881 (#2554) this is the only way to
 * connect: `/connect` refuses a token, new or a replace (`token_connect_retired`).
 *
 * NOTHING CREDENTIAL-SHAPED IS LOGGED OR RETURNED. A failure's redirect and
 * its `activity_logs` row carry a fixed reason word only.
 */
import { Hono } from 'hono';
import type { Context } from 'hono';
import type { Env, User } from '../types';
import { requireAuth } from '../auth';
import { branchOf } from '../util/branch';
import { hashEmail } from '../util/hashEmail';
import { userMeetsTier, tierUpsell } from '../middleware/requireTier';
import { activeCompanyFor } from '../middleware/activeCompany';
import { refuse } from '../util/refusal';
import { buildPkce, consumeOauthState, issueOauthState } from '../integrations/oauth';
import { audienceFor, ensureIntegrationsSchema, getDescriptor, personalHqOnlyOffHq, personalHqOnlySentence, personalMercuryFor, type IntegrationRow } from '../integrations/registry';
import { encryptCredentials, type CredentialBlob } from '../integrations/secrets';
import { entityAccountRefusal, isSupportSession, readOnlyRefusal } from '../integrations/providers/mercury';
import { canHoldValidateSource } from './_founder_validate_helpers';
import { MercuryClientError } from '../services/mercury/client';
import { authorizeUrl, discover, exchangeCode, MercuryOauthError, MERCURY_AUTH_TYPE, MERCURY_OAUTH_PROVIDER, registeredClient, revokeGrant, type McpCredentials } from '../services/mercury/oauth';
import { mcpBankReader } from '../services/mercury/reads';

type C = Context<{ Bindings: Env }>;

export const CSRF_COOKIE = '__Host-axal_mercury_oauth';
export const RETURN_PATH = '/account/connectors/mercury';
export const CALLBACK_PATH = '/api/integrations/mercury/oauth/callback';

/** The words a failed sign-in returns with; nothing else reaches the query string. */
export const CALLBACK_REASONS = [
  'access_denied', 'invalid_state', 'csrf_mismatch', 'missing_code', 'not_allowed', 'token_exchange_failed',
  'scope_refused', 'mercury_entity_account', 'bank_registry_unavailable', 'mercury_unreadable', 'discovery_failed', 'callback_failed',
] as const;
type Reason = typeof CALLBACK_REASONS[number];

const router = new Hono<{ Bindings: Env }>();

/** This host's callback URL: the sign-in returns to the host it started on, where the cookie lives. */
export function redirectUriFor(c: C): string {
  const u = new URL(c.req.url);
  return `${u.hostname === 'localhost' ? u.protocol : 'https:'}//${u.host}${CALLBACK_PATH}`;
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

/** Who may sign in: the same rule as pasting a token. A Response when refused. */
async function signInRefusal(c: C, user: User): Promise<Response | null> {
  const desc = getDescriptor('mercury');
  if (!desc) return c.json({ error: 'unknown_provider' }, 404);
  const viewer = { role: String(user.role || ''), hq: branchOf(c.env) === null, venture: canHoldValidateSource(user) };
  if (await isSupportSession(c)) return refuse(c, 403, { code: 'support_session_refused', message: 'A support session cannot connect a member\'s bank account.' });
  if (personalHqOnlyOffHq(desc, viewer)) return refuse(c, 403, { code: 'purpose_not_allowed', message: personalHqOnlySentence(desc.display_name) });
  if (audienceFor(desc, viewer) !== 'personal' || !personalMercuryFor(user.role)) return c.json({ error: 'unknown_provider', provider_key: 'mercury' }, 404);
  if (desc.tier !== 'free' && !userMeetsTier(user, desc.tier as 'growth' | 'studio')) return c.json(tierUpsell(desc.tier as 'growth' | 'studio'), 402);
  return null;
}

router.get('/start', async (c) => {
  const user = await requireAuth(c);
  const refusal = await signInRefusal(c, user);
  if (refusal) return refusal;
  let url: string;
  let state: string;
  const csrf = crypto.randomUUID() + crypto.randomUUID();
  try {
    const server = await discover();
    const client = await registeredClient(c.env, server, redirectUriFor(c));
    const pkce = await buildPkce();
    const company = await activeCompanyFor(c, user).catch(() => null);
    state = await issueOauthState(c.env, user.id, MERCURY_OAUTH_PROVIDER, pkce.verifier, {
      csrf: await sha256(csrf), client_key: client.key, company_id: company ?? null,
    });
    url = authorizeUrl(server, client, { state, challenge: pkce.challenge });
  } catch (e) {
    const code = e instanceof MercuryOauthError ? e.code : 'setup_failed';
    return refuse(c, 503, {
      code: 'mercury_sign_in_unavailable',
      message: 'Mercury\'s sign-in could not be reached, so nothing was sent to Mercury. Try again in a minute, or connect with a Read Only API token.',
      extra: { reason: code },
    });
  }
  c.header('Set-Cookie', `${CSRF_COOKIE}=${csrf}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600`);
  c.header('Cache-Control', 'no-store');
  return c.json({ ok: true, authorize_url: url });
});

const back = (c: C, outcome: 'ok' | Reason) => {
  c.header('Set-Cookie', `${CSRF_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`);
  c.header('Cache-Control', 'no-store');
  return c.redirect(outcome === 'ok' ? `${RETURN_PATH}?oauth=ok&provider=mercury` : `${RETURN_PATH}?oauth=error&provider=mercury&reason=${outcome}`);
};

function newUid(): string {
  return [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function activity(env: Env, user: User, action: string, details: Record<string, unknown>): Promise<void> {
  try {
    await env.DB.prepare('INSERT INTO activity_logs (user_id, actor, action, details) VALUES (?, ?, ?, ?)')
      .bind(user.id, await hashEmail(user.email), action, JSON.stringify({ provider_key: 'mercury', source: 'mercury_mcp_sign_in', ...details })).run();
  } catch { /* activity_logs may not exist in some schemas */ }
}

router.get('/callback', async (c) => {
  await ensureIntegrationsSchema(c.env);
  const user = await requireAuth(c);
  const state = c.req.query('state') || '';
  const code = c.req.query('code') || '';
  // The state is consumed first, whatever else the query says, so it can never be replayed.
  const consumed = state ? await consumeOauthState(c.env, user.id, MERCURY_OAUTH_PROVIDER, state) : null;
  if (!consumed) return back(c, 'invalid_state');
  const cookie = readCookie(c, CSRF_COOKIE);
  if (!cookie || typeof consumed.extra.csrf !== 'string' || (await sha256(cookie)) !== consumed.extra.csrf) return back(c, 'csrf_mismatch');
  if (c.req.query('error')) return back(c, 'access_denied');
  if (!code || !consumed.pkce_verifier) return back(c, 'missing_code');
  if (await signInRefusal(c, user)) return back(c, 'not_allowed');

  let creds: McpCredentials;
  try {
    const server = await discover();
    const client = await registeredClient(c.env, server, redirectUriFor(c));
    if (client.key !== consumed.extra.client_key) return back(c, 'invalid_state');
    creds = await exchangeCode(server, client, { code, verifier: consumed.pkce_verifier });
  } catch (e) {
    const reason: Reason = e instanceof MercuryOauthError && e.code === 'discovery_failed' ? 'discovery_failed' : 'token_exchange_failed';
    await activity(c.env, user, 'integration_oauth_failed', { reason });
    return back(c, reason);
  }

  // The scope, the organization and decision 3, before anything is stored.
  const reader = mcpBankReader({ accessToken: creds.access_token, scopes: creds.scopes });
  let failed: Reason | null = null;
  let read;
  try {
    read = await reader.readOrganization();
    const scope = readOnlyRefusal(read.permission, false);
    if (scope) failed = 'scope_refused';
    else {
      const entity = await entityAccountRefusal(c.env, read.org, read.accounts);
      if (entity) failed = entity.code === 'mercury_entity_account' ? 'mercury_entity_account' : 'bank_registry_unavailable';
    }
  } catch (e) {
    failed = e instanceof MercuryClientError && e.code === 'unauthorized' ? 'token_exchange_failed' : 'mercury_unreadable';
  }
  if (failed || !read) {
    await revokeGrant(c.env, creds);
    await activity(c.env, user, 'integration_oauth_failed', { reason: failed ?? 'mercury_unreadable' });
    return back(c, failed ?? 'mercury_unreadable');
  }

  const variant = personalMercuryFor(user.role)!;
  const existing = await c.env.DB.prepare("SELECT * FROM integrations WHERE user_id = ? AND provider_key = 'mercury'")
    .bind(user.id).first<IntegrationRow>();
  const uid = existing?.uid || newUid();
  const enc = await encryptCredentials(c.env, uid, creds as unknown as CredentialBlob);
  const config = JSON.stringify({ read_only: 'reported', via: MERCURY_AUTH_TYPE });
  if (existing) {
    await c.env.DB.prepare(
      "UPDATE integrations SET status = 'active', auth_type = ?, credentials_enc = ?, config_json = ?, capabilities_json = ?, scopes_json = ?, " +
      'external_account_id = ?, external_account_name = ?, last_error = NULL, last_error_at = NULL, updated_at = CURRENT_TIMESTAMP WHERE uid = ?',
    ).bind(MERCURY_AUTH_TYPE, enc, config, JSON.stringify(variant.capabilities), JSON.stringify(creds.scopes), read.org.id, read.org.legal_name, uid).run();
  } else {
    await c.env.DB.prepare(
      'INSERT INTO integrations (uid, user_id, provider_key, display_name, status, auth_type, credentials_enc, config_json, capabilities_json, scopes_json, external_account_id, external_account_name) ' +
      "VALUES (?, ?, 'mercury', 'Mercury', 'active', ?, ?, ?, ?, ?, ?, ?)",
    ).bind(uid, user.id, MERCURY_AUTH_TYPE, enc, config, JSON.stringify(variant.capabilities), JSON.stringify(creds.scopes), read.org.id, read.org.legal_name).run();
  }
  const row = await c.env.DB.prepare('SELECT id FROM integrations WHERE uid = ?').bind(uid).first<{ id: number }>();
  if (row) {
    const company = Number(consumed.extra.company_id);
    try {
      if (Number.isSafeInteger(company) && company > 0
        && await c.env.DB.prepare('SELECT 1 AS linked FROM user_company_links WHERE user_id = ? AND company_id = ?').bind(user.id, company).first()) {
        await c.env.DB.prepare(
          'INSERT INTO integration_companies (integration_id, company_id, enabled) VALUES (?, ?, 1) ON CONFLICT(integration_id, company_id) DO UPDATE SET enabled = 1',
        ).bind(row.id, company).run();
      }
    } catch { /* the company scope is optional for Mercury, as on the token path */ }
    await c.env.DB.prepare(
      'INSERT INTO integration_logs (integration_id, user_id, provider_key, direction, event_type, status, response_summary, external_id) ' +
      "VALUES (?, ?, 'mercury', 'inbound', 'oauth_callback', 'ok', ?, ?)",
    ).bind(row.id, user.id, existing ? 'Signed in with Mercury again.' : 'Signed in with Mercury; connection established.', read.org.id).run();
  }
  await activity(c.env, user, existing ? 'integration_reconnected' : 'integration_connected', {});
  return back(c, 'ok');
});

export default router;
