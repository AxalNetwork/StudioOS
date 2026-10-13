/** D684 / #1576. WhatsApp Cloud API and Embedded Signup adapter. */
import type { Env } from '../../types';
import { constantTimeEqual, sha256Hex } from '../../rpc/secret';
import { decryptCredentials } from '../../integrations/secrets';
import type { ChannelConnection } from './connections';
import { CHANNEL_LIMITS, type InboundEvent, type SendResult } from './types';
import { identifier, object, secret, providerJson, providerBytes, MAX_MEDIA_BYTES } from './telegram';

export const GRAPH = 'https://graph.facebook.com/v24.0';
const graphId = (v: unknown) => identifier(v, /^\d{1,30}$/);
const clip = (v: unknown, n: number): string | null => typeof v === 'string' ? v.trim().slice(0, n) || null : null;
const array = (v: unknown): Record<string, any>[] => Array.isArray(v) ? v.map(object) : [];

export async function verifyWhatsApp(env: Env, raw: Uint8Array, signature: string | null): Promise<'ok' | 'unavailable' | 'invalid'> {
  const appSecret = secret(env, 'WHATSAPP_APP_SECRET');
  if (!appSecret) return 'unavailable';
  if (!signature || !/^sha256=[a-fA-F0-9]{64}$/.test(signature)) return 'invalid';
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(appSecret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const digest = new Uint8Array(await crypto.subtle.sign('HMAC', key, raw));
  const hex = Array.from(digest, b => b.toString(16).padStart(2, '0')).join('');
  return constantTimeEqual(signature.slice(7).toLowerCase(), hex) ? 'ok' : 'invalid';
}

export async function whatsAppChallenge(env: Env, params: URLSearchParams): Promise<{ status: number; challenge: string | null }> {
  const expected = secret(env, 'WHATSAPP_VERIFY_TOKEN');
  if (!expected) return { status: 503, challenge: null };
  const token = params.get('hub.verify_token') ?? '', challenge = params.get('hub.challenge');
  const valid = params.get('hub.mode') === 'subscribe' && !!token && !!challenge && /^\d{1,100}$/.test(challenge)
    && constantTimeEqual(await sha256Hex(token), await sha256Hex(expected));
  return { status: valid ? 200 : 401, challenge: valid ? challenge : null };
}

export function normaliseWhatsApp(payload: unknown): InboundEvent[] {
  const root = object(payload);
  if (root.object !== 'whatsapp_business_account') return [];
  const events: InboundEvent[] = [];
  for (const entry of array(root.entry)) for (const change of array(entry.changes)) {
    const value = object(change.value), connectionRef = graphId(object(value.metadata).phone_number_id);
    if (!connectionRef) continue;
    const echo = change.field === 'smb_message_echoes';
    const messages = echo ? array(value.message_echoes ?? value.smb_message_echoes ?? value.messages) : array(value.messages);
    for (const m of messages) {
      const externalMessageId = identifier(m.id);
      const externalChatId = graphId(echo ? m.to : m.from);
      const stamp = Number(m.timestamp);
      if (!externalMessageId || !externalChatId || !Number.isFinite(stamp) || stamp <= 0 || stamp >= 8.64e12) continue;
      const contact = array(value.contacts).find(c => graphId(c.wa_id) === externalChatId);
      const content = m.type === 'text' ? clip(object(m.text).body, CHANNEL_LIMITS.maxTextChars) : null;
      const audio = object(m.audio), fileRef = m.type === 'audio' ? graphId(audio.id) : null;
      if (!content && !fileRef) continue;
      events.push({
        kind: 'message', provider: 'whatsapp', eventId: 'message:' + connectionRef + ':' + externalMessageId,
        connectionRef, externalChatId, externalMessageId, side: echo ? 'me' : 'contact',
        contactName: echo ? null : clip(object(contact?.profile).name, CHANNEL_LIMITS.maxNameChars),
        text: content, sentAt: new Date(stamp * 1000).toISOString(),
        voice: fileRef ? { fileRef, mime: clip(audio.mime_type, 100), durationSec: null } : null,
      });
    }
    if (!echo) for (const s of array(value.statuses)) {
      const id = identifier(s.id);
      if (!id || !['sent', 'delivered', 'read', 'failed'].includes(s.status)) continue;
      const code = array(s.errors)[0]?.code;
      events.push({
        kind: 'status', provider: 'whatsapp', eventId: 'status:' + connectionRef + ':' + id + ':' + s.status,
        connectionRef, externalMessageId: id, status: s.status,
        errorCode: code != null ? graphId(code) : null,
      });
    }
  }
  return events;
}

export function replyWindowOpen(lastInboundAt: string | null, now = Date.now()): boolean {
  const then = lastInboundAt ? Date.parse(lastInboundAt) : NaN;
  return Number.isFinite(then) && then <= now && now - then < CHANNEL_LIMITS.replyWindowMs;
}

async function accessToken(env: Env, conn: ChannelConnection): Promise<string | null> {
  const credentials = await decryptCredentials(env, conn.integrationUid, conn.credentialsEnc);
  return typeof credentials?.access_token === 'string' && credentials.access_token ? credentials.access_token : null;
}

export async function sendWhatsApp(
  env: Env, conn: ChannelConnection, phoneNumberId: string, chatId: string, content: string, lastInboundAt: string | null,
): Promise<SendResult> {
  if (!replyWindowOpen(lastInboundAt)) return { ok: false, code: 'window_closed' };
  if (!graphId(phoneNumberId) || !graphId(chatId)) return { ok: false, code: 'invalid_destination' };
  const clean = clip(content, CHANNEL_LIMITS.maxTextChars);
  if (!clean || clean.length > 4096) return { ok: false, code: 'text_too_long' };
  try {
    const token = await accessToken(env, conn);
    if (!token) return { ok: false, code: 'credentials_unreadable' };
    const r = await providerJson(GRAPH + '/' + phoneNumberId + '/messages', {
      method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ messaging_product: 'whatsapp', to: chatId, type: 'text', text: { body: clean } }),
    });
    const id = identifier(array(r.data.messages)[0]?.id);
    return r.status === 200 && id ? { ok: true, externalMessageId: id }
      : { ok: false, code: 'send_failed', retryable: r.status === 429 || r.status >= 500 };
  } catch { return { ok: false, code: 'provider_unavailable', retryable: true }; }
}

export async function fetchWhatsAppMedia(env: Env, conn: ChannelConnection, fileRef: string) {
  if (!graphId(fileRef)) throw new Error('invalid_media');
  const token = await accessToken(env, conn);
  if (!token) throw new Error('credentials_unreadable');
  const headers = { Authorization: 'Bearer ' + token };
  const r = await providerJson(GRAPH + '/' + fileRef, { headers });
  if (r.status !== 200 || Number(r.data.file_size) > MAX_MEDIA_BYTES || typeof r.data.url !== 'string') throw new Error('invalid_media');
  let url: URL;
  try { url = new URL(r.data.url); } catch { throw new Error('invalid_media'); }
  // Meta's authenticated download host. Refuse arbitrary URLs and redirects.
  if (url.protocol !== 'https:' || url.username || url.password || url.port
      || !(url.hostname === 'lookaside.fbsbx.com' || url.hostname.endsWith('.fbcdn.net'))) throw new Error('invalid_media');
  const media = await providerBytes(url.href, { headers });
  if (media.status !== 200) throw new Error('media_unavailable');
  return { ...media, mime: clip(r.data.mime_type, 100) ?? media.mime };
}

/** Verify the code's token belongs to Axal's app and to the WABA/number supplied. */
export async function exchangeWhatsAppSignup(env: Env, input: { code: string; wabaId: string; phoneNumberId: string }) {
  if (!input.code || input.code.length > 4096 || !graphId(input.wabaId) || !graphId(input.phoneNumberId)) throw new Error('invalid_signup');
  const appId = secret(env, 'WHATSAPP_APP_ID'), appSecret = secret(env, 'WHATSAPP_APP_SECRET');
  if (!graphId(appId) || !appSecret) throw new Error('provider_unavailable');
  const query = new URLSearchParams({ client_id: appId, client_secret: appSecret, code: input.code });
  const exchanged = await providerJson(GRAPH + '/oauth/access_token?' + query);
  const token = typeof exchanged.data.access_token === 'string' ? exchanged.data.access_token : '';
  if (exchanged.status !== 200 || !token) throw new Error('signup_exchange_failed');
  const inspected = await providerJson(GRAPH + '/debug_token?' + new URLSearchParams({ input_token: token }), {
    headers: { Authorization: 'Bearer ' + appId + '|' + appSecret },
  });
  const info = object(inspected.data.data);
  const granted = Array.isArray(info.scopes) ? info.scopes : [];
  const targets = array(info.granular_scopes).filter(s => s.scope === 'whatsapp_business_management')
    .flatMap(s => Array.isArray(s.target_ids) ? s.target_ids : []);
  if (inspected.status !== 200 || info.is_valid !== true || String(info.app_id) !== appId
      || !granted.includes('whatsapp_business_management') || !granted.includes('whatsapp_business_messaging')
      || !targets.includes(input.wabaId)) throw new Error('signup_scope_mismatch');
  const headers = { Authorization: 'Bearer ' + token };
  const numbers = await providerJson(GRAPH + '/' + input.wabaId + '/phone_numbers?fields=id,display_phone_number&limit=100', { headers });
  const number = array(numbers.data.data).find(n => String(n.id) === input.phoneNumberId);
  if (numbers.status !== 200 || !number) throw new Error('signup_number_mismatch');
  const subscribed = await providerJson(GRAPH + '/' + input.wabaId + '/subscribed_apps', { method: 'POST', headers });
  if (subscribed.status !== 200 || subscribed.data.success !== true) throw new Error('signup_subscription_failed');
  const digits = typeof number.display_phone_number === 'string' ? number.display_phone_number.replace(/\D/g, '') : '';
  return { accessToken: token, maskedNumber: digits ? '••••' + digits.slice(-4) : null };
}
