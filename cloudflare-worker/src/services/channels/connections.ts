/**
 * D684 — who a webhook event belongs to.
 *
 * Tenancy for an inbound event comes ONLY from the connection it arrived on,
 * resolved here — never from anything else in the payload:
 *   telegram  business_connection_id → telegram_business_connections (enabled,
 *             user_id set) → the member's active `integrations` row
 *   whatsapp  metadata.phone_number_id → the active `integrations` row whose
 *             external_account_id is that number id
 * A connection that resolves to no active member resolves to null, and the
 * caller stores nothing.
 *
 * `availability` reports whether a provider's platform secrets exist on this
 * deployment — names only, never values.
 */
import type { Env } from '../../types';
import type { ChannelProvider, ProviderAvailability } from './types';

export interface ChannelConnection {
  integrationId: number;
  integrationUid: string;
  userId: number;
  provider: 'telegram' | 'whatsapp';
  /** Telegram: whether the business connection lets the bot reply. WhatsApp: always true. */
  canReply: boolean;
  config: Record<string, unknown>;
  credentialsEnc: string | null;
}

interface IntegrationRow {
  id: number; uid: string; user_id: number; provider_key: string; status: string;
  config_json: string | null; credentials_enc: string | null;
}

function parseConfig(raw: string | null): Record<string, unknown> {
  if (!raw) return {};
  try { const v = JSON.parse(raw); return v && typeof v === 'object' && !Array.isArray(v) ? v : {}; } catch { return {}; }
}

/** The member's active connection row for a messaging provider. */
export async function memberConnection(env: Env, userId: number, provider: 'telegram' | 'whatsapp'): Promise<ChannelConnection | null> {
  const row = await env.DB.prepare(
    `SELECT id, uid, user_id, provider_key, status, config_json, credentials_enc FROM integrations
      WHERE user_id = ? AND provider_key = ? AND status = 'active'`,
  ).bind(userId, provider).first<IntegrationRow>();
  if (!row) return null;
  let canReply = provider === 'whatsapp';
  if (provider === 'telegram') {
    const bc = await env.DB.prepare(
      `SELECT can_reply FROM telegram_business_connections WHERE user_id = ? AND is_enabled = 1 ORDER BY updated_at DESC LIMIT 1`,
    ).bind(userId).first<{ can_reply: number }>();
    canReply = !!bc?.can_reply;
  }
  return {
    integrationId: Number(row.id), integrationUid: row.uid, userId: Number(row.user_id), provider,
    canReply, config: parseConfig(row.config_json), credentialsEnc: row.credentials_enc,
  };
}

/** Telegram: the member behind a business connection, or null (unknown, disabled, or not yet linked). */
export async function connectionForTelegram(env: Env, businessConnectionId: string): Promise<ChannelConnection | null> {
  const bc = await env.DB.prepare(
    `SELECT user_id, is_enabled, can_reply FROM telegram_business_connections WHERE business_connection_id = ?`,
  ).bind(String(businessConnectionId)).first<{ user_id: number | null; is_enabled: number; can_reply: number }>();
  if (!bc || !bc.user_id || !bc.is_enabled) return null;
  const conn = await memberConnection(env, Number(bc.user_id), 'telegram');
  return conn ? { ...conn, canReply: !!bc.can_reply } : null;
}

/** WhatsApp: the member whose business number this is, or null. */
export async function connectionForWhatsApp(env: Env, phoneNumberId: string): Promise<ChannelConnection | null> {
  const row = await env.DB.prepare(
    `SELECT id, uid, user_id, provider_key, status, config_json, credentials_enc FROM integrations
      WHERE provider_key = 'whatsapp' AND external_account_id = ? AND status = 'active'`,
  ).bind(String(phoneNumberId)).first<IntegrationRow>();
  if (!row) return null;
  return {
    integrationId: Number(row.id), integrationUid: row.uid, userId: Number(row.user_id), provider: 'whatsapp',
    canReply: true, config: parseConfig(row.config_json), credentialsEnc: row.credentials_enc,
  };
}

const REQUIRED_SECRETS: Record<ChannelProvider, string[]> = {
  telegram: ['TELEGRAM_CHANNEL_BOT_TOKEN', 'TELEGRAM_CHANNEL_BOT_USERNAME', 'TELEGRAM_CHANNEL_WEBHOOK_SECRET'],
  whatsapp: ['WHATSAPP_APP_ID', 'WHATSAPP_APP_SECRET', 'WHATSAPP_VERIFY_TOKEN', 'WHATSAPP_EMBEDDED_SIGNUP_CONFIG_ID'],
  zoom: ['ZOOM_CLIENT_ID', 'ZOOM_CLIENT_SECRET', 'ZOOM_WEBHOOK_SECRET_TOKEN'],
  google_meet: ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'],
};

/** Whether each provider's platform secrets are set here. Names of the missing ones only. */
export function availability(env: Env): ProviderAvailability[] {
  const vars = env as unknown as Record<string, unknown>;
  return (Object.keys(REQUIRED_SECRETS) as ChannelProvider[]).map((provider) => {
    const missing = REQUIRED_SECRETS[provider].filter((k) => typeof vars[k] !== 'string' || !(vars[k] as string).trim());
    return { provider, available: missing.length === 0, missing };
  });
}

export function providerAvailable(env: Env, provider: ChannelProvider): boolean {
  return availability(env).find((a) => a.provider === provider)?.available === true;
}
