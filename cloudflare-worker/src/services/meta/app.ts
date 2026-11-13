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
