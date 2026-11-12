/** TikTok's read-only web connection (#5291). */
import type { Env } from '../../types';
import { oauthCallbackUrl } from '../../util/url';
import { loadOauthCreds, oauthCredsReady } from '../../services/providerOauthKeys';
import { ConnectRefusal, registerProvider, type ProviderImpl } from '../registry';
import { decryptCredentials, encryptCredentials } from '../secrets';
import { acquireRefreshLease } from '../refreshLease';
import { exchangeTikTokCode, refreshTikTokToken, revokeTikTokToken, tiktokAuthorizeUrl } from '../tiktokOAuth';
import type { IntegrationRow } from '../registry';

export function redirectUri(env: Env): string {
  return oauthCallbackUrl(env, 'tiktok');
}

async function appCredentials(env: Env) {
  const app = await loadOauthCreds(env, 'tiktok');
  if (!app) throw new ConnectRefusal(503, 'tiktok_unavailable', 'TikTok is not available yet.');
  return app;
}

async function approvedApp(env: Env) {
  if (env.TIKTOK_APP_APPROVED !== '1') {
    throw new ConnectRefusal(503, 'tiktok_unavailable', 'TikTok is not available yet.');
  }
  return appCredentials(env);
}

async function accessToken(env: Env, row: IntegrationRow): Promise<string> {
  const lease = await acquireRefreshLease(env, 'tiktok', row.uid);
  if (!lease.acquired) throw new Error('tiktok_refresh_busy');
  try {
    const current = await env.DB.prepare('SELECT credentials_enc FROM integrations WHERE id = ?')
      .bind(row.id).first<{ credentials_enc: string }>();
    const credentials = await decryptCredentials(env, row.uid, current?.credentials_enc);
    if (!credentials?.access_token) throw new Error('tiktok_connection_unreadable');
    if (typeof credentials.expires_at === 'number' && credentials.expires_at > Date.now() + 60_000) {
      return credentials.access_token;
    }
    if (!credentials.refresh_token) throw new Error('tiktok_refresh_missing');
    const tokens = await refreshTikTokToken(await appCredentials(env), credentials.refresh_token);
    if (tokens.open_id !== credentials.open_id || tokens.scope !== credentials.scope) {
      await revokeTikTokToken(await appCredentials(env), tokens.access_token);
      throw new Error('tiktok_grant_changed');
    }
    const next = await encryptCredentials(env, row.uid, {
      ...credentials, access_token: tokens.access_token, refresh_token: tokens.refresh_token,
      expires_at: Date.now() + tokens.expires_in * 1000,
    });
    await env.DB.prepare('UPDATE integrations SET credentials_enc = ? WHERE id = ?')
      .bind(next, row.id).run();
    return tokens.access_token;
  } finally {
    await lease.release();
  }
}

const provider: ProviderImpl = {
  key: 'tiktok',
  async ready(env) {
    return env.TIKTOK_APP_APPROVED === '1' ? oauthCredsReady(env, 'tiktok') : false;
  },
  async buildAuthorizeUrl(c, _user, state) {
    const app = await approvedApp(c.env);
    return tiktokAuthorizeUrl(app.id, redirectUri(c.env), state);
  },
  async connect(c, _user, input) {
    if (!input.oauth_code) throw new ConnectRefusal(400, 'tiktok_code_required', 'Start TikTok sign-in first.');
    const tokens = await exchangeTikTokCode(await approvedApp(c.env), input.oauth_code, redirectUri(c.env));
    return {
      credentials: {
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        open_id: tokens.open_id,
        scope: tokens.scope,
        expires_at: Date.now() + tokens.expires_in * 1000,
      },
      scopes: tokens.scope.split(',').map(scope => scope.trim()).filter(Boolean),
      external_account_id: tokens.open_id,
    };
  },
  async revokeGranted(env, result) {
    const token = result.credentials?.access_token;
    if (typeof token === 'string') await revokeTikTokToken(await appCredentials(env), token);
  },
  async disconnect(c, _user, row) {
    await revokeTikTokToken(await appCredentials(c.env), await accessToken(c.env, row));
  },
};

registerProvider(provider);
