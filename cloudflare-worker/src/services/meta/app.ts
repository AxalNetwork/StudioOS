import type { Env } from '../../types';

/** Shared Meta app credentials. Provider-specific settings stay with the provider. */
export function metaApp(env: Pick<Env, 'WHATSAPP_APP_ID' | 'WHATSAPP_APP_SECRET'>) {
  const rawSecret = String(env.WHATSAPP_APP_SECRET ?? '');
  return {
    appId: String(env.WHATSAPP_APP_ID ?? '').trim(),
    appSecret: rawSecret.trim(),
    // WhatsApp signature verification uses the exact configured bytes.
    webhookSecret: rawSecret,
  };
}

/** Meta Graph app secret proof and signed-request verification use HMAC-SHA256. */
export async function metaHmac(secret: string, value: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(value));
  return [...new Uint8Array(signature)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}
