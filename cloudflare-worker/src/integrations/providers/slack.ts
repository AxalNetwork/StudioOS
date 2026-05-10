/**
 * Task #1 (2026-05-10) — Slack notifications integration (BETA, free tier).
 *
 * One-way Worker → Slack via incoming-webhook OAuth.
 *  - Scope: `incoming-webhook` (the user picks the channel during the
 *    Slack consent screen — no `channels:read` needed).
 *  - Persists the channel-bound webhook URL + channel name + team name
 *    in `integrations.credentials_enc` and surfaces them on the row's
 *    `external_account_id` / `external_account_name` for the UI.
 *  - Disconnect deletes the integrations row (which wipes the webhook)
 *    so a re-connect starts from defaults.
 *  - notify.ts loads the webhook for the recipient and renders Block
 *    Kit messages for the 5 trigger events spec'd by the brief.
 *
 * Required env: `SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET` (per env).
 *
 * IMPORTANT: imported once from index.ts so registerProvider() runs at boot.
 */
import type { Context } from 'hono';
import type { Env, User } from '../../types';
import {
  registerProvider,
  type ProviderImpl,
  type ConnectInput,
  type ConnectResult,
  type IntegrationRow,
} from '../registry';
import { decryptCredentials, type CredentialBlob } from '../secrets';

const PROVIDER_KEY = 'slack';
const AUTH_HOST = 'https://slack.com';
const SCOPES = ['incoming-webhook'];

function redirectUri(env: Env): string {
  const base = (env.APP_URL || '').replace(/\/+$/, '');
  return `${base}/api/integrations/oauth/${PROVIDER_KEY}/callback`;
}

interface SlackEnvVars {
  SLACK_CLIENT_ID?: string;
  SLACK_CLIENT_SECRET?: string;
  APP_URL?: string;
}
function ensureCreds(env: Env): { id: string; secret: string } {
  const e = env as Env & SlackEnvVars;
  if (!e.SLACK_CLIENT_ID || !e.SLACK_CLIENT_SECRET) {
    throw new Error('slack_oauth_unconfigured: SLACK_CLIENT_ID/SLACK_CLIENT_SECRET secrets must be set on the worker.');
  }
  return { id: e.SLACK_CLIENT_ID, secret: e.SLACK_CLIENT_SECRET };
}

interface SlackOauthV2AccessResponse {
  ok: boolean;
  error?: string;
  app_id?: string;
  authed_user?: { id?: string };
  team?: { id?: string; name?: string };
  enterprise?: { id?: string; name?: string } | null;
  scope?: string;
  token_type?: string;
  access_token?: string;
  bot_user_id?: string;
  incoming_webhook?: {
    channel?: string;
    channel_id?: string;
    configuration_url?: string;
    url?: string;
  };
}

async function exchangeCode(env: Env, code: string): Promise<SlackOauthV2AccessResponse> {
  const { id, secret } = ensureCreds(env);
  const body = new URLSearchParams({
    code,
    client_id: id,
    client_secret: secret,
    redirect_uri: redirectUri(env),
  });
  const res = await fetch(`${AUTH_HOST}/api/oauth.v2.access`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!res.ok) {
    throw new Error(`slack_token_exchange_http_${res.status}`);
  }
  const json = await res.json() as SlackOauthV2AccessResponse;
  if (!json.ok) {
    throw new Error(`slack_token_exchange_failed: ${json.error || 'unknown'}`);
  }
  if (!json.incoming_webhook?.url) {
    throw new Error('slack_no_webhook_returned: did the user grant the incoming-webhook scope?');
  }
  return json;
}

// ───────────────────────────────────────────────────────────── connect

async function connect(_c: Context<{ Bindings: Env }>, _user: User, input: ConnectInput): Promise<ConnectResult> {
  if (!input.oauth_code) {
    throw new Error('slack_requires_oauth_code: complete the OAuth handshake first.');
  }
  const tokens = await exchangeCode(_c.env, input.oauth_code);
  const wh = tokens.incoming_webhook!;
  const credentials: CredentialBlob = {
    webhook_url: wh.url,
    channel: wh.channel || null,
    channel_id: wh.channel_id || null,
    configuration_url: wh.configuration_url || null,
    team_id: tokens.team?.id || null,
    team_name: tokens.team?.name || null,
    scope: tokens.scope || SCOPES.join(','),
    issued_at: Date.now(),
  };
  const accountName = [tokens.team?.name, wh.channel].filter(Boolean).join(' · ') || null;
  return {
    credentials,
    scopes: SCOPES,
    external_account_id: tokens.team?.id || null,
    external_account_name: accountName,
    capabilities: ['Channel notifications', 'Block Kit messages'],
    config: {
      team_id: tokens.team?.id || null,
      team_name: tokens.team?.name || null,
      channel: wh.channel || null,
      channel_id: wh.channel_id || null,
      configuration_url: wh.configuration_url || null,
    },
  };
}

async function buildAuthorizeUrl(c: Context<{ Bindings: Env }>, _user: User, state: string): Promise<string> {
  const { id } = ensureCreds(c.env);
  const params = new URLSearchParams({
    client_id: id,
    scope: SCOPES.join(','),
    redirect_uri: redirectUri(c.env),
    state,
  });
  return `${AUTH_HOST}/oauth/v2/authorize?${params.toString()}`;
}

// ───────────────────────────────────────────────────────────── disconnect

async function disconnect(_c: Context<{ Bindings: Env }>, _user: User, _row: IntegrationRow): Promise<void> {
  // No-op. The route layer deletes the integrations row, which wipes
  // the encrypted webhook URL. Slack incoming webhooks are revoked
  // automatically when the user removes the app from their workspace;
  // there's no first-class revoke endpoint for the webhook URL itself,
  // and we don't hold a bot token (incoming-webhook-only install) to
  // call /api/apps.uninstall.
  //
  // Per-event Slack toggles in the Settings UI are persisted under the
  // shared `users.notification_prefs` map (NOT a Slack-specific column),
  // so the next connect inherits whatever toggles the user previously
  // chose — by design, matches the email/in-app pattern.
}

// ───────────────────────────────────────────────────────────── lookup helper

/**
 * Public helper used by services/notify.ts to fetch the active Slack
 * webhook for a given user. Returns null when the user has no live
 * Slack integration. NEVER throws — notify is best-effort.
 */
export async function loadSlackWebhookForUser(env: Env, userId: number): Promise<{ url: string; channel: string | null } | null> {
  try {
    const row = await env.DB.prepare(
      "SELECT uid, credentials_enc, status FROM integrations WHERE user_id = ? AND provider_key = 'slack' LIMIT 1",
    ).bind(userId).first<{ uid: string; credentials_enc: string | null; status: string }>();
    if (!row || row.status !== 'active' || !row.credentials_enc) return null;
    const creds = await decryptCredentials(env, row.uid, row.credentials_enc);
    const url = typeof creds?.webhook_url === 'string' ? creds.webhook_url : '';
    if (!url) return null;
    const channel = typeof creds?.channel === 'string' ? creds.channel : null;
    return { url, channel };
  } catch (e) {
    console.warn('[slack] loadSlackWebhookForUser failed', (e as Error).message);
    return null;
  }
}

// ───────────────────────────────────────────────────────────── side-effects

const impl: ProviderImpl = {
  key: PROVIDER_KEY,
  connect,
  disconnect,
  buildAuthorizeUrl,
};

registerProvider(impl);

export { impl as slackProvider };
