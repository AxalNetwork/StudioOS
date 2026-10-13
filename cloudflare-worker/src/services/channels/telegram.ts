/**
 * D684 / #1576. Telegram Business adapter. No interview writes or payload logs.
 * Helpers below also bound the WhatsApp adapter's provider responses.
 */
import type { Env } from '../../types';
import { constantTimeEqual, sha256Hex } from '../../rpc/secret';
import { CHANNEL_LIMITS, type InboundEvent, type SendResult } from './types';

export const MAX_MEDIA_BYTES = 20 * 1024 * 1024;
export const vars = (env: Env): Record<string, unknown> => env as unknown as Record<string, unknown>;
export const secret = (env: Env, name: string): string => typeof vars(env)[name] === 'string' ? String(vars(env)[name]) : '';
export const object = (v: unknown): Record<string, any> =>
  v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, any> : {};
export const identifier = (v: unknown, pattern = /^[A-Za-z0-9_.:-]{1,180}$/): string | null => {
  const s = typeof v === 'string' || (typeof v === 'number' && Number.isSafeInteger(v)) ? String(v) : '';
  return pattern.test(s) ? s : null;
};
export const telegramMessageKey = (connectionRef: string, chatId: string, messageId: string) => connectionRef + ':' + chatId + ':' + messageId;
const numeric = (v: unknown) => identifier(v, /^-?\d{1,20}$/);
const text = (v: unknown, limit: number): string | null => typeof v === 'string' ? v.trim().slice(0, limit) || null : null;
const iso = (seconds: unknown): string | null => {
  const n = Number(seconds);
  return Number.isFinite(n) && n > 0 && n < 8.64e12 ? new Date(n * 1000).toISOString() : null;
};

/** Read no more than the cap, including chunked bodies with a lying Content-Length. */
export async function boundedBytes(response: Response, cap: number): Promise<Uint8Array> {
  const length = Number(response.headers.get('content-length'));
  if (length > cap) { await response.body?.cancel(); throw new Error('body_too_large'); }
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > cap) throw new Error('body_too_large');
      chunks.push(chunk.value);
    }
  } catch {
    await reader.cancel().catch(() => {});
    throw new Error('body_too_large');
  } finally { reader.releaseLock(); }
  const result = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.byteLength; }
  return result;
}

/** Deadlines cover both headers and body; redirects cannot forward a credential. */
export async function providerBytes(url: string, init: RequestInit = {}, cap = MAX_MEDIA_BYTES) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal, redirect: 'error' });
    const bytes = await boundedBytes(response, cap);
    return { status: response.status, bytes, mime: response.headers.get('content-type')?.split(';')[0] ?? null };
  } catch { throw new Error('provider_unavailable'); }
  finally { clearTimeout(timer); }
}
export async function providerJson(url: string, init: RequestInit = {}) {
  const r = await providerBytes(url, init, CHANNEL_LIMITS.maxBodyBytes);
  let data: Record<string, any>;
  try { data = object(JSON.parse(new TextDecoder().decode(r.bytes))); }
  catch { throw new Error('provider_invalid_response'); }
  return { status: r.status, data };
}

export async function verifyTelegram(env: Env, presented: string | null): Promise<'ok' | 'unavailable' | 'invalid'> {
  const expected = secret(env, 'TELEGRAM_CHANNEL_WEBHOOK_SECRET');
  if (!expected) return 'unavailable';
  if (!presented) return 'invalid';
  return constantTimeEqual(await sha256Hex(presented), await sha256Hex(expected)) ? 'ok' : 'invalid';
}

/** ownerId is loaded from the verified business connection, never from the message. */
export function normaliseTelegram(payload: unknown, ownerId: string | null = null): InboundEvent {
  const update = object(payload);
  const updateId = numeric(update.update_id);
  const ignored = (): InboundEvent => ({ kind: 'ignored', provider: 'telegram', eventId: updateId ?? '', reason: 'unsupported' });
  if (!updateId) return ignored();
  const privateMessage = object(update.message);
  if (Object.keys(privateMessage).length) {
    const sender = object(privateMessage.from), chat = object(privateMessage.chat);
    const id = numeric(sender.id), chatId = numeric(chat.id);
    const command = typeof privateMessage.text === 'string'
      ? /^\/start(?:@[A-Za-z0-9_]+)? ([A-Za-z0-9_-]{24})$/.exec(privateMessage.text.trim()) : null;
    if (chat.type !== 'private' || sender.is_bot || !id || !chatId || id !== chatId || !command) return ignored();
    return {
      kind: 'link', provider: 'telegram', eventId: updateId, telegramUserId: id, chatId, code: command[1],
      displayName: text(sender.username ? '@' + sender.username : sender.first_name, CHANNEL_LIMITS.maxNameChars),
    };
  }
  if (update.business_connection) {
    const bc = object(update.business_connection), user = object(bc.user), rights = object(bc.rights);
    const id = identifier(bc.id, /^[A-Za-z0-9_-]{1,64}$/), userId = numeric(user.id), chatId = numeric(bc.user_chat_id);
    if (!id || !userId || !chatId || typeof bc.is_enabled !== 'boolean' || user.is_bot) return ignored();
    const cleanRights: Record<string, boolean> = {};
    for (const [key, value] of Object.entries(rights)) {
      if (/^[a-z_]{1,80}$/.test(key) && typeof value === 'boolean') cleanRights[key] = value;
    }
    return {
      kind: 'connection', provider: 'telegram', eventId: updateId, businessConnectionId: id,
      telegramUserId: userId, userChatId: chatId, isEnabled: bc.is_enabled,
      canReply: Object.keys(rights).length ? rights.can_reply === true : bc.can_reply === true, rights: cleanRights,
    };
  }
  if (update.deleted_business_messages) {
    const d = object(update.deleted_business_messages);
    const connectionRef = identifier(d.business_connection_id, /^[A-Za-z0-9_-]{1,64}$/), externalChatId = numeric(object(d.chat).id);
    const ids = Array.isArray(d.message_ids) ? d.message_ids.map(numeric).filter((v: string | null): v is string => !!v).slice(0, 100) : [];
    return connectionRef && externalChatId && ids.length
      ? { kind: 'delete', provider: 'telegram', eventId: updateId, connectionRef, externalChatId, externalMessageIds: ids.map((id: string) => telegramMessageKey(connectionRef, externalChatId, id)) }
      : ignored();
  }
  const m = object(update.edited_business_message ?? update.business_message);
  const sender = object(m.from), chat = object(m.chat);
  const connectionRef = identifier(m.business_connection_id, /^[A-Za-z0-9_-]{1,64}$/), externalChatId = numeric(chat.id), externalMessageId = numeric(m.message_id);
  if (!connectionRef || !externalChatId || !externalMessageId || sender.is_bot || chat.type !== 'private') return ignored();
  const content = text(m.text, CHANNEL_LIMITS.maxTextChars);
  if (update.edited_business_message) {
    return content ? { kind: 'edit', provider: 'telegram', eventId: updateId, connectionRef, externalChatId, externalMessageId: telegramMessageKey(connectionRef, externalChatId, externalMessageId), text: content } : ignored();
  }
  const voice = object(m.voice), fileRef = identifier(voice.file_id);
  const sentAt = iso(m.date);
  if ((!content && !fileRef) || !sentAt) return ignored();
  const side = ownerId && numeric(sender.id) === ownerId ? 'me' : 'contact';
  return {
    kind: 'message', provider: 'telegram', eventId: updateId, connectionRef, externalChatId, externalMessageId: telegramMessageKey(connectionRef, externalChatId, externalMessageId), side,
    contactName: side === 'me' ? null : text([sender.first_name, sender.last_name].filter(v => typeof v === 'string').join(' '), CHANNEL_LIMITS.maxNameChars),
    text: content, sentAt,
    voice: fileRef ? { fileRef, mime: text(voice.mime_type, 100), durationSec: Number.isFinite(voice.duration) ? voice.duration : null } : null,
  };
}

function botUrl(env: Env, method: string): string {
  const token = secret(env, 'TELEGRAM_CHANNEL_BOT_TOKEN');
  if (!/^\d+:[A-Za-z0-9_-]+$/.test(token)) throw new Error('provider_unavailable');
  return 'https://api.telegram.org/bot' + token + '/' + method;
}

export async function sendTelegram(env: Env, businessConnectionId: string | null, chatId: string, content: string): Promise<SendResult> {
  if (!numeric(chatId) || (businessConnectionId !== null && !identifier(businessConnectionId))) return { ok: false, code: 'invalid_destination' };
  const clean = text(content, CHANNEL_LIMITS.maxTextChars);
  if (!clean || clean.length > 4096) return { ok: false, code: 'text_too_long' };
  try {
    const r = await providerJson(botUrl(env, 'sendMessage'), {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: clean, ...(businessConnectionId ? { business_connection_id: businessConnectionId } : {}) }),
    });
    const id = numeric(object(r.data.result).message_id);
    return r.status === 200 && r.data.ok === true && id
      ? { ok: true, externalMessageId: businessConnectionId ? telegramMessageKey(businessConnectionId, chatId, id) : id }
      : { ok: false, code: 'send_failed', retryable: r.status === 429 || r.status >= 500 };
  } catch { return { ok: false, code: 'provider_unavailable', retryable: true }; }
}

export async function fetchTelegramMedia(env: Env, fileRef: string) {
  if (!identifier(fileRef)) throw new Error('invalid_media');
  const r = await providerJson(botUrl(env, 'getFile'), {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ file_id: fileRef }),
  });
  const file = object(r.data.result);
  const path = typeof file.file_path === 'string' ? file.file_path : '';
  if (r.status !== 200 || r.data.ok !== true || !/^[A-Za-z0-9_./-]{1,240}$/.test(path)
      || path.startsWith('/') || path.includes('..') || Number(file.file_size) > MAX_MEDIA_BYTES) throw new Error('invalid_media');
  const token = secret(env, 'TELEGRAM_CHANNEL_BOT_TOKEN');
  const media = await providerBytes('https://api.telegram.org/file/bot' + token + '/' + path);
  if (media.status !== 200) throw new Error('media_unavailable');
  return media;
}

export async function setTelegramWebhook(env: Env, origin: string): Promise<boolean> {
  const url = new URL(origin);
  if (url.protocol !== 'https:' || url.username || url.password || !['axal.vc', 'app.axal.vc'].includes(url.hostname)) return false;
  const webhookSecret = secret(env, 'TELEGRAM_CHANNEL_WEBHOOK_SECRET');
  if (!/^[A-Za-z0-9_-]{1,256}$/.test(webhookSecret)) return false;
  const r = await providerJson(botUrl(env, 'setWebhook'), {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      url: url.origin + '/api/channels/telegram/webhook', secret_token: webhookSecret,
      allowed_updates: ['message', 'business_connection', 'business_message', 'edited_business_message', 'deleted_business_messages'],
    }),
  });
  return r.status === 200 && r.data.ok === true;
}
