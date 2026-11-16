/**
 * D5839 (#5839) — Google Search Console, read only, through its own Google
 * OAuth client. The connection reads nothing by itself: a founder binds one
 * property to a venture through `routes/search_console.ts`.
 *
 * Ready only when the owner has set `GOOGLE_SEARCH_CONSOLE_APPROVED=1` and the
 * client's id and secret (env or HQ › Integration keys): the Google Cloud
 * project, its consent screen and redirect URIs are the owner's to set up.
 */
import type { Env } from '../../types';
import { oauthCallbackUrl } from '../../util/url';
import { loadOauthCreds, oauthCredsReady } from '../../services/providerOauthKeys';
import { ConnectRefusal, registerProvider, type IntegrationRow, type ProviderImpl } from '../registry';
import { decryptCredentials, encryptCredentials } from '../secrets';
import { acquireRefreshLease } from '../refreshLease';
import {
  SEARCH_CONSOLE_SCOPE, SearchConsoleError,
  exchangeSearchConsoleCode, refreshSearchConsoleToken, revokeSearchConsoleToken, searchConsoleAuthorizeUrl,
} from '../searchConsoleOAuth';

export const SEARCH_CONSOLE_KEY = 'google_search_console';

export function redirectUri(env: Env): string {
  return oauthCallbackUrl(env, SEARCH_CONSOLE_KEY);
}

const unavailable = () => new ConnectRefusal(503, 'search_console_unavailable', 'Search Console is not available yet.');

async function appCredentials(env: Env) {
  const app = await loadOauthCreds(env, SEARCH_CONSOLE_KEY);
  if (!app) throw unavailable();
  return app;
}

async function approvedApp(env: Env) {
  if (env.GOOGLE_SEARCH_CONSOLE_APPROVED !== '1') throw unavailable();
  return appCredentials(env);
}

/** The scopes Google granted, split on spaces as Google writes them. */
const scopesOf = (scope: string) => scope.split(/\s+/).map((s) => s.trim()).filter(Boolean);

/**
 * A current access token for this connection, refreshed behind the lease. A
 * refresh that comes back with a different scope set is revoked and refused,
 * so a grant can never be silently broadened after the sign-in check.
 */
export async function searchConsoleAccessToken(env: Env, row: Pick<IntegrationRow, 'id' | 'uid'>): Promise<string> {
  const lease = await acquireRefreshLease(env, SEARCH_CONSOLE_KEY, row.uid);
  if (!lease.acquired) throw new SearchConsoleError('search_console_refresh_busy');
  try {
    const current = await env.DB.prepare("SELECT credentials_enc FROM integrations WHERE id = ? AND status = 'active'")
      .bind(row.id).first<{ credentials_enc: string }>();
    if (!current) throw new SearchConsoleError('search_console_not_connected');
    const credentials = await decryptCredentials(env, row.uid, current.credentials_enc);
    if (!credentials?.access_token) throw new SearchConsoleError('search_console_connection_unreadable');
    if (typeof credentials.expires_at === 'number' && credentials.expires_at > Date.now() + 60_000) {
      return credentials.access_token;
    }
    if (!credentials.refresh_token) throw new SearchConsoleError('search_console_grant_revoked');
    const tokens = await refreshSearchConsoleToken(await appCredentials(env), credentials.refresh_token);
    if (scopesOf(tokens.scope).join(' ') !== SEARCH_CONSOLE_SCOPE) {
      await revokeSearchConsoleToken(tokens.access_token);
      throw new SearchConsoleError('search_console_grant_changed');
    }
    const next = await encryptCredentials(env, row.uid, {
      ...credentials,
      access_token: tokens.access_token,
      // Google keeps the refresh token unless it rotates one.
      refresh_token: tokens.refresh_token ?? credentials.refresh_token,
      expires_at: Date.now() + tokens.expires_in * 1000,
    });
    await env.DB.prepare('UPDATE integrations SET credentials_enc = ? WHERE id = ?').bind(next, row.id).run();
    return tokens.access_token;
  } finally {
    await lease.release();
  }
}

/**
 * D5840's sync takes `deps.accessToken(env, userId)`: the selection's member's own active connection, refreshed
 * as every read here is. No connection reads as a revoked grant, which the sync records as `revoked`.
 */
export async function searchConsoleAccessTokenForUser(env: Env, userId: number): Promise<string> {
  const row = await env.DB.prepare("SELECT id, uid FROM integrations WHERE user_id = ? AND provider_key = ? AND status = 'active' AND auth_type = 'oauth2' LIMIT 1")
    .bind(userId, SEARCH_CONSOLE_KEY).first<{ id: number; uid: string }>();
  if (!row) throw new SearchConsoleError('search_console_grant_revoked');
  return searchConsoleAccessToken(env, row);
}

/** The grant's own token to revoke: the refresh token revokes the whole grant, else the access token. */
async function grantToken(env: Env, row: IntegrationRow): Promise<string | null> {
  const current = await env.DB.prepare('SELECT credentials_enc FROM integrations WHERE id = ?')
    .bind(row.id).first<{ credentials_enc: string }>();
  const credentials = await decryptCredentials(env, row.uid, current?.credentials_enc);
  return credentials?.refresh_token || credentials?.access_token || null;
}

const provider: ProviderImpl = {
  key: SEARCH_CONSOLE_KEY,
  async ready(env) {
    return env.GOOGLE_SEARCH_CONSOLE_APPROVED === '1' ? oauthCredsReady(env, SEARCH_CONSOLE_KEY) : false;
  },
  async buildAuthorizeUrl(c, _user, state) {
    const app = await approvedApp(c.env);
    return searchConsoleAuthorizeUrl(app.id, redirectUri(c.env), state);
  },
  async connect(c, _user, input) {
    if (!input.oauth_code) throw new ConnectRefusal(400, 'search_console_code_required', 'Start the Search Console sign-in first.');
    const tokens = await exchangeSearchConsoleCode(await approvedApp(c.env), input.oauth_code, redirectUri(c.env));
    // `access_type=offline` with `prompt=consent` always returns one; without it the connection could not outlive an hour.
    if (!tokens.refresh_token) {
      await revokeSearchConsoleToken(tokens.access_token).catch(() => undefined);
      throw new ConnectRefusal(502, 'search_console_offline_refused', 'Google did not grant lasting access. Try signing in again.');
    }
    return {
      credentials: {
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        scope: tokens.scope,
        expires_at: Date.now() + tokens.expires_in * 1000,
      },
      scopes: scopesOf(tokens.scope),
    };
  },
  async revokeGranted(_env, result) {
    const token = result.credentials?.refresh_token || result.credentials?.access_token;
    if (typeof token === 'string') await revokeSearchConsoleToken(token);
  },
  async disconnect(c, _user, row) {
    const token = await grantToken(c.env, row);
    if (token) await revokeSearchConsoleToken(token);
    // The member's selections go with their connection (D5840's table, which the sync reads); nothing else at Google is touched.
    await c.env.DB.prepare('DELETE FROM search_console_selections WHERE user_id = ?').bind(row.user_id).run();
  },
};

registerProvider(provider);
