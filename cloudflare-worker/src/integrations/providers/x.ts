/**
 * D2403 part 2 (#2403): a founder's own X account, signed in through the
 * second HQ-owned "founders" X app (owner decision 2B), switched on per company.
 *
 * READ FIRST. "Connect X" asks for `tweet.read users.read offline.access`;
 * the start's `publish=1` (carried in the signed state, never the callback's
 * query) asks for the publish set as well. A read sign-in that came back with a
 * write scope is revoked and refused. `config_json.granted_scopes` records what
 * X granted, and `assertPublishGranted` refuses `x_publish_not_granted` without
 * `tweet.write` (part 4's publish path calls it).
 *
 * Tokens live in `integrations.credentials_enc` (row-uid AAD), never in
 * `x_accounts`. Refresh runs behind its own lease (`x_founder:refresh:<uid>`,
 * apart from HQ's `x:refresh:<id>`) and writes both rotated tokens in one
 * statement; a refused refresh marks the row `error`. Disconnect revokes both
 * tokens at X, best effort, and the route then deletes the row.
 */
import type { Context } from 'hono';
import type { Env } from '../../types';
import { oauthCallbackUrl } from '../../util/url';
import { loadOauthCreds, oauthCredsReady } from '../../services/providerOauthKeys';
import {
  buildAuthorizeUrl as xAuthorizeUrl, exchangeCodeForToken, getMe, refreshAccessToken, revokeToken,
  XError, type XAppCredentials,
} from '../../services/xClient';
import { ConnectRefusal, registerProvider, type IntegrationRow, type ProviderImpl } from '../registry';
import { decryptCredentials, encryptCredentials } from '../secrets';
import { acquireRefreshLease } from '../refreshLease';
import { X_PUBLISH_SCOPES, X_READ_SCOPES, X_WRITE_SCOPES } from '../xScopes';

export function redirectUri(env: Env): string {
  return oauthCallbackUrl(env, 'x');
}

const UNAVAILABLE = 'X is not available yet.';

async function founderApp(env: Env): Promise<XAppCredentials> {
  const app = await loadOauthCreds(env, 'x');
  if (!app) throw new ConnectRefusal(503, 'x_unavailable', UNAVAILABLE);
  return { clientId: app.id, clientSecret: app.secret };
}

/** The scopes X granted, from its space-separated `scope`. */
export function grantedScopes(scope: unknown): string[] {
  return typeof scope === 'string' ? scope.split(/\s+/).map((s) => s.trim()).filter(Boolean) : [];
}

/** Revoke each token X handed back, best effort: a revoke that fails never hides the refusal it follows. */
async function revokeAll(env: Env, tokens: Array<unknown>): Promise<void> {
  const app = await founderApp(env).catch(() => null);
  if (!app) return;
  for (const token of tokens) {
    if (typeof token !== 'string' || !token) continue;
    try { await revokeToken(app, token); } catch { /* best effort (D2403) */ }
  }
}

/** The signed state's extras, which the start wrote (`x_publish`, the PKCE `challenge`). */
async function stateExtra(c: Context<{ Bindings: Env }>, state: string): Promise<Record<string, unknown>> {
  const row = await c.env.DB.prepare('SELECT extra_json FROM oauth_state_tokens WHERE state = ?')
    .bind(state).first<{ extra_json: string | null }>();
  try { return row?.extra_json ? JSON.parse(row.extra_json) : {}; } catch { return {}; }
}

/** Refused unless X granted `tweet.write` to this connection. Part 4's publish path calls it first. */
export function assertPublishGranted(row: Pick<IntegrationRow, 'config_json'>): void {
  let scopes: unknown = null;
  try { scopes = JSON.parse(row.config_json || '{}')?.granted_scopes; } catch { /* unreadable reads as not granted */ }
  if (!Array.isArray(scopes) || !scopes.includes('tweet.write')) {
    throw new ConnectRefusal(403, 'x_publish_not_granted', 'Publishing to X is off for this connection. Turn on publishing first.');
  }
}

/** The connection's access token, refreshed behind the lease when within a minute of expiry. */
export async function xFounderAccessToken(env: Env, row: Pick<IntegrationRow, 'id' | 'uid'>): Promise<string> {
  const lease = await acquireRefreshLease(env, 'x_founder', row.uid);
  if (!lease.acquired) throw new XError('x_refresh_busy', 'Another request is renewing this X connection.');
  try {
    const current = await env.DB.prepare('SELECT credentials_enc FROM integrations WHERE id = ?')
      .bind(row.id).first<{ credentials_enc: string | null }>();
    const credentials = await decryptCredentials(env, row.uid, current?.credentials_enc ?? null);
    if (!credentials?.access_token) throw new XError('x_connection_unreadable', 'The X connection could not be read.');
    if (typeof credentials.expires_at === 'number' && credentials.expires_at > Date.now() + 60_000) {
      return credentials.access_token as string;
    }
    if (typeof credentials.refresh_token !== 'string' || !credentials.refresh_token) {
      throw new XError('x_refresh_missing', 'Sign in to X again.');
    }
    let tokens;
    try {
      tokens = await refreshAccessToken(await founderApp(env), credentials.refresh_token);
    } catch (e) {
      if (e instanceof XError && e.code === 'x_oauth_refresh_failed') {
        await env.DB.prepare(
          "UPDATE integrations SET status = 'error', last_error = 'x_refresh_refused', last_error_at = CURRENT_TIMESTAMP WHERE id = ?",
        ).bind(row.id).run();
      }
      throw e;
    }
    // X rotates the refresh token on every use: both tokens are written in one statement.
    const next = await encryptCredentials(env, row.uid, {
      ...credentials,
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token || credentials.refresh_token,
      expires_at: Date.now() + Number(tokens.expires_in || 0) * 1000,
    });
    await env.DB.prepare('UPDATE integrations SET credentials_enc = ? WHERE id = ?').bind(next, row.id).run();
    return tokens.access_token;
  } finally {
    await lease.release();
  }
}

const provider: ProviderImpl = {
  key: 'x',
  async ready(env) {
    return oauthCredsReady(env, 'x');
  },
  async buildAuthorizeUrl(c, _user, state) {
    const app = await founderApp(c.env);
    const extra = await stateExtra(c, state);
    const challenge = typeof extra.challenge === 'string' ? extra.challenge : '';
    if (!challenge) throw new ConnectRefusal(400, 'x_state_unreadable', 'Start X sign-in again.');
    return xAuthorizeUrl({
      clientId: app.clientId,
      redirectUri: redirectUri(c.env),
      state,
      codeChallenge: challenge,
      scopes: [...(extra.x_publish === true ? X_PUBLISH_SCOPES : X_READ_SCOPES)],
    });
  },
  async connect(c, user, input) {
    const verifier = input.config?.pkce_verifier;
    if (!input.oauth_code || typeof verifier !== 'string' || !verifier) {
      throw new ConnectRefusal(400, 'x_code_required', 'Start X sign-in first.');
    }
    const publish = input.config?.x_publish === true;
    const app = await founderApp(c.env);
    let tokens;
    try {
      tokens = await exchangeCodeForToken(app, { code: input.oauth_code, redirectUri: redirectUri(c.env), codeVerifier: verifier });
    } catch {
      throw new ConnectRefusal(502, 'x_sign_in_failed', 'X did not complete the sign-in. Nothing was saved. Try again.');
    }
    const scopes = grantedScopes(tokens.scope);
    if (!X_READ_SCOPES.every((s) => scopes.includes(s))) {
      await revokeAll(c.env, [tokens.access_token, tokens.refresh_token]);
      throw new ConnectRefusal(403, 'x_read_not_granted', 'X did not grant the read permissions Axal asked for. Nothing was saved.');
    }
    if (!publish && X_WRITE_SCOPES.some((s) => scopes.includes(s))) {
      await revokeAll(c.env, [tokens.access_token, tokens.refresh_token]);
      throw new ConnectRefusal(403, 'x_publish_not_requested', 'X granted posting permissions you did not turn on. The connection was refused and nothing was saved.');
    }
    let me;
    try {
      me = await getMe(tokens.access_token, `x-connect:${user.id}`);
    } catch {
      await revokeAll(c.env, [tokens.access_token, tokens.refresh_token]);
      throw new ConnectRefusal(502, 'x_account_unreadable', 'Axal could not read your X account. Nothing was saved. Try again.');
    }
    return {
      credentials: {
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token ?? null,
        scope: tokens.scope,
        expires_at: Date.now() + Number(tokens.expires_in || 0) * 1000,
      },
      scopes,
      external_account_id: me.data.id,
      external_account_name: `@${me.data.username}`,
      config: {
        x_user_id: me.data.id,
        handle: me.data.username,
        granted_scopes: scopes,
        publish_on: scopes.includes('tweet.write'),
      },
    };
  },
  async revokeGranted(env, result) {
    await revokeAll(env, [result.credentials?.access_token, result.credentials?.refresh_token]);
  },
  async disconnect(c, _user, row) {
    // Best effort (D2403): the route deletes the row whether or not X answered.
    let credentials: Record<string, unknown> | null = null;
    try { credentials = await decryptCredentials(c.env, row.uid, row.credentials_enc); } catch { /* nothing to revoke */ }
    if (credentials) await revokeAll(c.env, [credentials.access_token, credentials.refresh_token]);
  },
};

registerProvider(provider);
