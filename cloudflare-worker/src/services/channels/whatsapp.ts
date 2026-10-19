/**
 * D684 (#1576) — the WhatsApp Business adapter (Cloud API, Embedded Signup).
 *
 * ONE AXAL META APP FOR EVERY MEMBER. Axal is the Tech Provider; each member
 * onboards their OWN business number through Embedded Signup (coexistence, so
 * their WhatsApp Business app keeps working). Every webhook for every member
 * arrives at one URL, signed with Axal's app secret, and the member is found
 * from `metadata.phone_number_id` — never from anything else in the payload.
 *
 * What this file does, and nothing else (types.ts):
 *   verify     the GET subscription challenge (hub.verify_token) and every
 *              POST's X-Hub-Signature-256 over the RAW body. The GET challenge
 *              never stands in for the signature.
 *   normalise  entry[].changes[]: `messages` (text, voice; `statuses`) and
 *              `smb_message_echoes` (what the member sent from the app). A
 *              contact's reply button on Axal's consent notice
 *              (`consent_yes:<uid>` / `consent_no:<uid>`), and a contact's
 *              whole message YES, NO or STOP, become a `consent_reply`
 *              (D754 §4, #1893); `consent.ts` decides whether it counts. An
 *              echo — the member's own side — never does.
 *   connect    Embedded Signup's code → business token (encrypted in
 *              integrations.credentials_enc), the number checked against the
 *              WABA, the app subscribed to the WABA
 *   talk       send text, send the consent notice as an interactive message
 *              with two reply buttons (D754 §5), download media, read the
 *              number for the test
 *
 * GRAPH API VERSION. Pinned at v23.0 (released 2025-05-29). Meta supports a
 * Graph version for at least two years after the next one ships, so v23.0 is
 * served into 2027. It is the newest version this adapter's request and
 * response shapes were checked against; the owner bumps it here, once, after
 * reading developers.facebook.com/docs/graph-api/changelog. GET /api/channels
 * hands this same version to the browser; Axal's own number/WABA cannot be
 * claimed through Embedded Signup or unsubscribed by a member (D754). Network access to
 * Meta's docs was not available when this was written (2026-10-13), so a newer
 * version may exist.
 *
 * Unverified against live docs, and said so where used: the
 * `smb_message_echoes` value's array name (`message_echoes`), and the
 * `group_id` marker on group messages.
 *
 * Nothing here logs a token, a phone number, a name or a message's text;
 * errors are codes.
 */
import type { Env } from '../../types';
import { providerJson } from './providerHttp';
import { constantTimeEqual, sha256Hex } from '../../rpc/secret';
import { decryptCredentials, encryptCredentials } from '../../integrations/secrets';
import type { ChannelConnection } from './connections';
import { forgetConnection } from './threads';
import type { AudioResult, SecretCheck } from './telegram';
import { CHANNEL_LIMITS, type InboundEvent, type InboundMessage, type MessageSide, type SendResult } from './types';

export const GRAPH_VERSION = 'v23.0';
export const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_VERSION}`;

/** A text message body takes up to 4096 characters. */
export const WHATSAPP_MAX_TEXT = 4096;

/** The Cloud API's own ceiling for audio media. */
export const WHATSAPP_MAX_AUDIO_BYTES = 16 * 1024 * 1024;

/**
 * Hosts a media URL may point at. The download carries the member's business
 * token, so a URL anywhere else is refused rather than sent the token.
 * Meta serves media from lookaside.fbsbx.com today.
 */
const MEDIA_HOSTS = ['fbsbx.com', 'facebook.com', 'fbcdn.net', 'whatsapp.net'];

// ---------------------------------------------------------------------------
// Verifying
// ---------------------------------------------------------------------------

/**
 * Meta's subscription check: `hub.mode=subscribe`, our verify token, and a
 * challenge to echo. The challenge is echoed only when it looks like one.
 */
export async function verifyWhatsAppChallenge(
  env: Env, mode: string | undefined, token: string | undefined, challenge: string | undefined,
): Promise<{ status: 200; challenge: string } | { status: 403 | 503 }> {
  const expected = String(env.WHATSAPP_VERIFY_TOKEN ?? '');
  if (!expected.trim()) return { status: 503 };
  if (mode !== 'subscribe' || !token || !challenge || !/^[A-Za-z0-9_.-]{1,256}$/.test(challenge)) return { status: 403 };
  const [a, b] = await Promise.all([sha256Hex(token), sha256Hex(expected)]);
  return constantTimeEqual(a, b) ? { status: 200, challenge } : { status: 403 };
}

async function hmacHex(secret: string, raw: ArrayBuffer): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, raw);
  return [...new Uint8Array(sig)].map((x) => x.toString(16).padStart(2, '0')).join('');
}

/**
 * `X-Hub-Signature-256: sha256=<hex HMAC-SHA256 of the raw body>`, keyed with
 * Axal's app secret. Computed over the bytes as received: Meta signs the
 * escaped-unicode payload it sends, and re-serialising the parsed JSON would
 * not reproduce it.
 */
export async function verifyWhatsAppSignature(env: Env, raw: ArrayBuffer, header: string | null | undefined): Promise<SecretCheck> {
  const secret = String(env.WHATSAPP_APP_SECRET ?? '');
  if (!secret.trim()) return 'unconfigured';
  const m = /^sha256=([0-9a-fA-F]{64})$/.exec(String(header ?? '').trim());
  if (!m) return header ? 'mismatch' : 'missing';
  return constantTimeEqual(await hmacHex(secret, raw), m[1].toLowerCase()) ? 'ok' : 'mismatch';
}

// ---------------------------------------------------------------------------
// Normalising a delivery
// ---------------------------------------------------------------------------

const obj = (v: unknown): Record<string, any> | null => (v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, any> : null);
const arr = (v: unknown): any[] => (Array.isArray(v) ? v.slice(0, 200) : []);
const idStr = (v: unknown): string | null => (typeof v === 'number' || (typeof v === 'string' && v.trim()) ? String(v).trim().slice(0, 200) : null);
const isoFromUnix = (v: unknown): string => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? new Date(n * 1000).toISOString() : new Date().toISOString();
};

/** A consent button's id: `consent_yes:<request uid>` or `consent_no:<request uid>` (consent.ts). */
const CONSENT_BUTTON_ID = /^consent_(yes|no):([0-9a-f-]{36})$/;

/** A whole message that may answer the notice: yes, no or stop, any case, closing `.` or `!` allowed. */
export function consentWord(text: string | null | undefined): 'yes' | 'no' | 'stop' | null {
  const w = String(text ?? '').trim().toLowerCase().replace(/[.!]+$/, '').trim();
  return w === 'yes' || w === 'no' || w === 'stop' ? w : null;
}

function messageEvent(m: unknown, phoneNumberId: string, side: MessageSide, names: Map<string, string>): InboundEvent | null {
  const msg = obj(m);
  const id = idStr(msg?.id);
  if (!msg || !id) return null;
  const ignored = (reason: string): InboundEvent => ({ kind: 'ignored', provider: 'whatsapp', eventId: id, reason });
  // Unverified field name: Cloud API group messages are marked with a group id.
  // A group is not a one-to-one customer conversation either way.
  if (msg.group_id != null) return ignored('not_a_private_chat');
  // The customer's wa_id: the sender of an inbound message, the recipient of an echo.
  const chat = idStr(side === 'contact' ? msg.from : msg.to);
  if (!chat) return ignored('malformed');
  const type = String(msg.type ?? '');
  const contextId = idStr(obj(msg.context)?.id);
  // D754 §4: a reply button on Axal's consent notice. Only the contact's own;
  // any other interactive message stays unsupported.
  if (type === 'interactive') {
    const reply = obj(msg.interactive)?.type === 'button_reply' ? obj(obj(msg.interactive)?.button_reply) : null;
    const button = side === 'contact' ? CONSENT_BUTTON_ID.exec(String(reply?.id ?? '')) : null;
    if (!button) return ignored('unsupported_type');
    return {
      kind: 'consent_reply', provider: 'whatsapp', eventId: id, connectionRef: phoneNumberId, externalChatId: chat,
      externalMessageId: id, side: 'contact', answer: button[1] as 'yes' | 'no', via: 'button', requestUid: button[2],
      contextMessageId: contextId, fallback: null, sentAt: isoFromUnix(msg.timestamp),
    };
  }
  const text = type === 'text' ? String(obj(msg.text)?.body ?? '').trim().slice(0, CHANNEL_LIMITS.maxTextChars) : '';
  // Voice notes are `audio` with `voice: true`; older payloads used type `voice`.
  const media = type === 'audio' || type === 'voice' ? obj(msg.audio) ?? obj(msg.voice) : null;
  const mediaId = idStr(media?.id);
  if (!text && !mediaId) return ignored('unsupported_type');
  const name = side === 'contact' ? names.get(chat) ?? null : null;
  const message: InboundMessage = {
    kind: 'message', provider: 'whatsapp', eventId: id, connectionRef: phoneNumberId, externalChatId: chat,
    externalMessageId: id, side,
    contactName: name ? name.slice(0, CHANNEL_LIMITS.maxNameChars) : null,
    text: text || null,
    voice: !text && mediaId ? { fileRef: mediaId, mime: typeof media?.mime_type === 'string' ? media.mime_type : null, durationSec: null } : null,
    sentAt: isoFromUnix(msg.timestamp),
  };
  // D754 §4: a contact's whole YES, NO or STOP may answer the notice. It keeps
  // the message it is, for consent.ts to store when it does not count.
  const word = side === 'contact' && type === 'text' ? consentWord(text) : null;
  if (word) {
    return {
      kind: 'consent_reply', provider: 'whatsapp', eventId: id, connectionRef: phoneNumberId, externalChatId: chat,
      externalMessageId: id, side: 'contact', answer: word, via: 'text', requestUid: null,
      contextMessageId: contextId, fallback: message, sentAt: message.sentAt,
    };
  }
  return message;
}

/**
 * D754 way B (#1937, #1938): a message to Axal's own number, in its own shape
 * (types.ts `InboundAxalMessage`). Read: text, a reply button's id, `audio`
 * (a voice note or a file) and `document`; anything else is `unsupported`, so
 * the capture can say once what Axal takes here.
 */
function axalMessageEvent(m: unknown, phoneNumberId: string): InboundEvent | null {
  const msg = obj(m);
  const id = idStr(msg?.id);
  if (!msg || !id) return null;
  if (msg.group_id != null) return { kind: 'ignored', provider: 'whatsapp', eventId: id, reason: 'not_a_private_chat' };
  const from = idStr(msg.from);
  if (!from) return { kind: 'ignored', provider: 'whatsapp', eventId: id, reason: 'malformed' };
  const type = String(msg.type ?? '');
  const out: InboundEvent = {
    kind: 'axal_message', provider: 'whatsapp', eventId: id, connectionRef: phoneNumberId, externalChatId: from,
    externalMessageId: id, text: null, media: null, button: null, unsupported: false, sentAt: isoFromUnix(msg.timestamp),
  };
  if (type === 'text') {
    const text = String(obj(msg.text)?.body ?? '').trim().slice(0, CHANNEL_LIMITS.maxTextChars);
    if (text) return { ...out, text };
  } else if (type === 'interactive') {
    const reply = obj(msg.interactive)?.type === 'button_reply' ? obj(obj(msg.interactive)?.button_reply) : null;
    const button = idStr(reply?.id);
    if (button) return { ...out, button };
  } else if (type === 'audio' || type === 'voice' || type === 'document') {
    const media = type === 'document' ? obj(msg.document) : obj(msg.audio) ?? obj(msg.voice);
    const mediaId = idStr(media?.id);
    const size = Number(media?.file_size);
    if (mediaId) {
      return {
        ...out,
        media: {
          mediaId, type: type === 'document' ? 'document' : 'audio',
          mime: typeof media?.mime_type === 'string' ? media.mime_type.slice(0, 100) : null,
          sizeBytes: Number.isSafeInteger(size) && size >= 0 ? size : null,
        },
      };
    }
  }
  return { ...out, unsupported: true };
}

const STATUSES = new Set(['sent', 'delivered', 'read', 'failed']);

function statusEvent(s: unknown, phoneNumberId: string): InboundEvent | null {
  const st = obj(s);
  const id = idStr(st?.id);
  if (!st || !id) return null;
  const status = String(st.status ?? '');
  if (!STATUSES.has(status)) return { kind: 'ignored', provider: 'whatsapp', eventId: `${id}:${status}`, reason: 'unsupported_status' };
  const err = obj(arr(st.errors)[0]);
  return {
    kind: 'status', provider: 'whatsapp', eventId: `${id}:${status}`, connectionRef: phoneNumberId,
    externalMessageId: id, status: status as 'sent' | 'delivered' | 'read' | 'failed',
    errorCode: err?.code != null ? String(err.code).slice(0, 40) : null,
  };
}

/**
 * One POST as its events, in order. A POST may carry several entries, each
 * with several changes, each with several messages or statuses; every one is
 * its own event, claimed on its own by the caller. Anything without a
 * provider id is dropped here: there is nothing to dedupe it by.
 */
export function normaliseWhatsAppPayload(body: unknown, axalPhoneNumberId: string | null = null): InboundEvent[] {
  const axal = String(axalPhoneNumberId ?? '').trim();
  const b = obj(body);
  if (!b || b.object !== 'whatsapp_business_account') return [];
  const out: InboundEvent[] = [];
  for (const entry of arr(b.entry)) {
    for (const change of arr(obj(entry)?.changes)) {
      const ch = obj(change);
      const value = obj(ch?.value);
      const pnid = idStr(obj(value?.metadata)?.phone_number_id);
      if (!ch || !value || !pnid) continue;
      if (ch.field === 'messages') {
        const names = new Map<string, string>();
        for (const c of arr(value.contacts)) {
          const wa = idStr(obj(c)?.wa_id);
          const name = obj(obj(c)?.profile)?.name;
          if (wa && typeof name === 'string' && name.trim()) names.set(wa, name.trim());
        }
        for (const m of arr(value.messages)) {
          // Axal's own number is never a customer chat (way B): its messages have their own shape.
          const ev = axal && pnid === axal ? axalMessageEvent(m, pnid) : messageEvent(m, pnid, 'contact', names);
          if (ev) out.push(ev);
        }
        for (const s of arr(value.statuses)) { const ev = statusEvent(s, pnid); if (ev) out.push(ev); }
      } else if (ch.field === 'smb_message_echoes') {
        // Unverified array name: coexistence echoes arrive as `message_echoes`.
        for (const m of arr(value.message_echoes)) { const ev = messageEvent(m, pnid, 'me', new Map()); if (ev) out.push(ev); }
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Talking to the Graph API
// ---------------------------------------------------------------------------

type GraphResult = { ok: true; data: any } | { ok: false; code: string; retryable: boolean };

/** Graph error codes this adapter tells apart; everything else is 'rejected'. */
function graphFailure(status: number, graphCode: number | null): { code: string; retryable: boolean } {
  if (graphCode === 131047) return { code: 'window_closed', retryable: false };
  if (graphCode != null && [4, 80007, 130429, 131048, 131056].includes(graphCode)) return { code: 'rate_limited', retryable: true };
  if (graphCode === 190) return { code: 'token_invalid', retryable: false };
  if (graphCode === 10 || graphCode === 200) return { code: 'forbidden', retryable: false };
  if (graphCode === 131026) return { code: 'undeliverable', retryable: false };
  if (status === 429) return { code: 'rate_limited', retryable: true };
  if (status >= 500 || graphCode === 131000) return { code: 'provider_unavailable', retryable: true };
  return { code: 'rejected', retryable: false };
}

async function graph(
  what: string, url: string, init: { method?: string; token?: string; json?: unknown } = {},
): Promise<GraphResult> {
  const headers: Record<string, string> = {};
  if (init.token) headers.authorization = `Bearer ${init.token}`;
  if (init.json !== undefined) headers['content-type'] = 'application/json';
  let res: Response;
  let data: any;
  try {
    ({ res, data } = await providerJson(url, { method: init.method ?? 'GET', headers, body: init.json === undefined ? undefined : JSON.stringify(init.json) }));
  } catch {
    const code = what === 'send' ? 'send_unknown' : 'network';
    console.error(`[channels] whatsapp ${what} ${code}`);
    return { ok: false, code, retryable: code !== 'send_unknown' };
  }
  if (what === 'send' && res.ok && !data) return { ok: false, code: 'send_unknown', retryable: false };
  if (res.ok && data && !data.error) return { ok: true, data };
  const graphCode = Number.isFinite(Number(data?.error?.code)) ? Number(data.error.code) : null;
  const f = graphFailure(res.status, graphCode);
  console.error(`[channels] whatsapp ${what} failed status=${res.status} graph=${graphCode ?? '-'} code=${f.code}`);
  return { ok: false, ...f };
}

/** The member's business token, decrypted the way every connector's credentials are (integrations/secrets.ts). */
export async function whatsappToken(env: Env, conn: Pick<ChannelConnection, 'integrationUid' | 'credentialsEnc'>): Promise<string | null> {
  const creds = await decryptCredentials(env, conn.integrationUid, conn.credentialsEnc);
  const t = typeof creds?.access_token === 'string' ? creds.access_token : '';
  return t || null;
}

const phoneNumberIdOf = (conn: ChannelConnection) => idStr(conn.config?.phone_number_id);

/**
 * A free-form text to a customer. Meta allows it only within 24 hours of the
 * customer's last message (the route checks first; a 131047 from Meta is the
 * same refusal). `ok` means Meta accepted it; delivery arrives later as a status.
 */
export async function sendWhatsAppText(env: Env, conn: ChannelConnection, to: string, text: string): Promise<SendResult> {
  const body = String(text ?? '').trim();
  if (!body) return { ok: false, code: 'text_required' };
  if (body.length > WHATSAPP_MAX_TEXT) return { ok: false, code: 'text_too_long' };
  const pnid = phoneNumberIdOf(conn);
  const token = await whatsappToken(env, conn);
  if (!pnid || !token) return { ok: false, code: 'not_connected' };
  const r = await graph('send', `${GRAPH_BASE}/${encodeURIComponent(pnid)}/messages`, {
    method: 'POST', token,
    json: { messaging_product: 'whatsapp', recipient_type: 'individual', to, type: 'text', text: { body, preview_url: false } },
  });
  if (!r.ok) return { ok: false, code: r.code, retryable: r.retryable };
  const id = idStr(r.data?.messages?.[0]?.id);
  return id ? { ok: true, externalMessageId: id } : { ok: false, code: 'send_unknown', retryable: false };
}

/**
 * D754 way B (#1937): a text from Axal's OWN number (`WHATSAPP_AXAL_*`), with
 * the system user's token — never a member's. Used only for the link's two
 * replies, each inside the window the sender just opened. The token is read
 * here and goes nowhere but the Authorization header.
 */
export async function sendAxalText(env: Env, to: string, text: string): Promise<SendResult> {
  const pnid = idStr(env.WHATSAPP_AXAL_PHONE_NUMBER_ID);
  const token = String(env.WHATSAPP_AXAL_ACCESS_TOKEN ?? '').trim();
  if (!pnid || !token) return { ok: false, code: 'not_configured' };
  const r = await graph('send', `${GRAPH_BASE}/${encodeURIComponent(pnid)}/messages`, {
    method: 'POST', token,
    json: { messaging_product: 'whatsapp', recipient_type: 'individual', to, type: 'text', text: { body: text, preview_url: false } },
  });
  if (!r.ok) return { ok: false, code: r.code, retryable: r.retryable };
  const id = idStr(r.data?.messages?.[0]?.id);
  return id ? { ok: true, externalMessageId: id } : { ok: false, code: 'send_unknown', retryable: false };
}

/**
 * D754 §5 — Meta's published limits for reply buttons (Interactive reply
 * buttons messages): a body of at most 1,024 characters, at most three
 * buttons, each title at most 20 characters and each id at most 256. A
 * message over any of them is refused here, before any call.
 */
export const INTERACTIVE_LIMITS = { bodyChars: 1024, buttons: 3, titleChars: 20, idChars: 256 } as const;

/**
 * An interactive message with reply buttons, from the member's own number with
 * the member's token — the consent notice (consent.ts). Like a text, Meta
 * takes it only within 24 hours of the contact's last message (131047 is
 * `window_closed`), and a lost answer stays `send_unknown`.
 */
export async function sendWhatsAppInteractive(
  env: Env, conn: ChannelConnection, to: string, msg: { body: string; buttons: { id: string; title: string }[] },
): Promise<SendResult> {
  return sendInteractive(phoneNumberIdOf(conn), await whatsappToken(env, conn), to, msg);
}

/** The same reply-button message from AXAL'S OWN number (way B, #1938), with Axal's token. */
export async function sendAxalInteractive(
  env: Env, to: string, msg: { body: string; buttons: { id: string; title: string }[] },
): Promise<SendResult> {
  const token = String(env.WHATSAPP_AXAL_ACCESS_TOKEN ?? '').trim();
  const r = await sendInteractive(idStr(env.WHATSAPP_AXAL_PHONE_NUMBER_ID), token || null, to, msg);
  return r.code === 'not_connected' ? { ok: false, code: 'not_configured' } : r;
}

async function sendInteractive(
  pnid: string | null, token: string | null, to: string, msg: { body: string; buttons: { id: string; title: string }[] },
): Promise<SendResult> {
  const body = String(msg.body ?? '').trim();
  const buttons = Array.isArray(msg.buttons) ? msg.buttons : [];
  if (!body) return { ok: false, code: 'text_required' };
  if (body.length > INTERACTIVE_LIMITS.bodyChars) return { ok: false, code: 'text_too_long' };
  if (!buttons.length || buttons.length > INTERACTIVE_LIMITS.buttons
    || buttons.some((b) => !b.id || !b.title || b.id.length > INTERACTIVE_LIMITS.idChars || b.title.length > INTERACTIVE_LIMITS.titleChars)) {
    return { ok: false, code: 'invalid_buttons' };
  }
  if (!pnid || !token) return { ok: false, code: 'not_connected' };
  const r = await graph('send', `${GRAPH_BASE}/${encodeURIComponent(pnid)}/messages`, {
    method: 'POST', token,
    json: {
      messaging_product: 'whatsapp', recipient_type: 'individual', to, type: 'interactive',
      interactive: {
        type: 'button', body: { text: body },
        action: { buttons: buttons.map((b) => ({ type: 'reply', reply: { id: b.id, title: b.title } })) },
      },
    },
  });
  if (!r.ok) return { ok: false, code: r.code, retryable: r.retryable };
  const id = idStr(r.data?.messages?.[0]?.id);
  return id ? { ok: true, externalMessageId: id } : { ok: false, code: 'send_unknown', retryable: false };
}

function mediaHostAllowed(raw: string): boolean {
  try {
    const u = new URL(raw);
    return u.protocol === 'https:' && MEDIA_HOSTS.some((h) => u.hostname === h || u.hostname.endsWith(`.${h}`));
  } catch {
    return false;
  }
}

/** A voice note's audio: `GET /{media-id}` for its URL, then the URL, both with the member's token. */
export type WhatsAppAudioResult = AudioResult & { lookup?: boolean };
export async function fetchWhatsAppMedia(env: Env, conn: ChannelConnection, mediaId: string, mimeHint: string | null = null): Promise<WhatsAppAudioResult> {
  const token = await whatsappToken(env, conn);
  if (!token) return { ok: false, code: 'not_connected', retryable: false };
  const meta = await graph('media', `${GRAPH_BASE}/${encodeURIComponent(mediaId)}`, { token });
  if (!meta.ok) return { ok: false, code: meta.code, retryable: meta.retryable, lookup: true };
  const size = Number(meta.data?.file_size);
  if (Number.isFinite(size) && size > WHATSAPP_MAX_AUDIO_BYTES) return { ok: false, code: 'too_large', retryable: false };
  const url = typeof meta.data?.url === 'string' ? meta.data.url : '';
  if (!mediaHostAllowed(url)) return { ok: false, code: 'media_host', retryable: false };
  let res: Response;
  try {
    res = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
  } catch {
    console.error('[channels] whatsapp media download network_error');
    return { ok: false, code: 'network', retryable: true };
  }
  if (!res.ok) {
    const f = graphFailure(res.status, null);
    console.error(`[channels] whatsapp media download failed status=${res.status}`);
    return { ok: false, ...f };
  }
  if (Number(res.headers.get('content-length') || 0) > WHATSAPP_MAX_AUDIO_BYTES) return { ok: false, code: 'too_large', retryable: false };
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.byteLength > WHATSAPP_MAX_AUDIO_BYTES) return { ok: false, code: 'too_large', retryable: false };
  if (!bytes.byteLength) return { ok: false, code: 'empty_file', retryable: false };
  const mime = String(mimeHint || meta.data?.mime_type || 'audio/ogg').split(';')[0].trim() || 'audio/ogg';
  return { ok: true, bytes, mime };
}

/** The test: read the number with the member's token. Sends nothing to anyone. */
export async function checkWhatsAppConnection(env: Env, conn: ChannelConnection): Promise<{ ok: true } | { ok: false; code: string }> {
  const pnid = phoneNumberIdOf(conn);
  const token = await whatsappToken(env, conn);
  if (!pnid || !token) return { ok: false, code: 'not_connected' };
  const r = await graph('check', `${GRAPH_BASE}/${encodeURIComponent(pnid)}?fields=verified_name,quality_rating,messaging_limit_tier,display_phone_number`, { token });
  if (!r.ok) return { ok: false, code: r.code };
  // #1586: the check refreshes what WhatsApp Calling would need. The number is
  // read for its calling code only and not kept.
  const calling = callingRecord(obj(r.data));
  await env.DB.prepare(
    `UPDATE integrations SET config_json = json_set(COALESCE(config_json, '{}'), '$.calling', json(?)), updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND provider_key = 'whatsapp'`,
  ).bind(JSON.stringify(calling), conn.integrationId).run();
  return { ok: true };
}

export type UnsubscribeOutcome = 'unsubscribed' | 'shared' | 'unverified' | 'failed';

/**
 * Disconnect: stop Meta sending this WABA's webhooks to Axal — unless another
 * Axal member still uses a number in it. Meta subscribes an app per WABA, not
 * per number, so `DELETE /{waba}/subscribed_apps` would silently cut off every
 * other member's number there (two co-founders on one company WABA): their
 * rows would still read 'active' while no webhook arrived.
 *
 * Leaving the subscription on is always safe — a number no member holds is
 * ignored on arrival — so this unsubscribes only when it is SURE nobody else
 * is on the WABA, and does nothing when it cannot tell:
 *   - no other active WhatsApp connection records this waba_id; and
 *   - the WABA's own number list, read with this member's token, holds this
 *     member's number (so `config.waba_id`, which the connectors' config
 *     route can rewrite, is not trusted on its own) and no number another
 *     active member holds. A list that pages beyond one page is not read as
 *     complete.
 * Best effort; the caller ignores the outcome.
 */
export async function unsubscribeApp(
  env: Env,
  conn: Pick<ChannelConnection, 'integrationId' | 'integrationUid' | 'credentialsEnc' | 'config'> & { phoneNumberId: string | null },
): Promise<UnsubscribeOutcome> {
  const waba = idStr(conn.config?.waba_id);
  // Axal's shared number is never unsubscribed by a member's disconnect.
  if (waba && waba === String(env.WHATSAPP_AXAL_WABA_ID ?? '').trim()) return 'shared';
  const own = idStr(conn.phoneNumberId);
  const token = await whatsappToken(env, conn);
  if (!waba || !own || !token) return 'unverified';
  const recorded = await env.DB.prepare(
    `SELECT 1 AS t FROM integrations
      WHERE provider_key = 'whatsapp' AND status = 'active' AND id != ?
        AND (CASE WHEN json_valid(config_json) THEN json_extract(config_json, '$.waba_id') END) = ?
      LIMIT 1`,
  ).bind(conn.integrationId, waba).first<{ t: number }>();
  if (recorded) return 'shared';

  const numbers = await graph('phone_numbers', `${GRAPH_BASE}/${encodeURIComponent(waba)}/phone_numbers?fields=id&limit=100`, { token });
  if (!numbers.ok || numbers.data?.paging?.next) return 'unverified';
  const ids = arr(numbers.data?.data).map((n) => idStr(obj(n)?.id)).filter((x): x is string => !!x);
  if (!ids.includes(own)) return 'unverified';
  const others = ids.filter((id) => id !== own);
  if (others.length) {
    const held = await env.DB.prepare(
      `SELECT 1 AS t FROM integrations
        WHERE provider_key = 'whatsapp' AND status = 'active' AND id != ?
          AND external_account_id IN (SELECT value FROM json_each(?))
        LIMIT 1`,
    ).bind(conn.integrationId, JSON.stringify(others)).first<{ t: number }>();
    if (held) return 'shared';
  }
  const r = await graph('unsubscribe', `${GRAPH_BASE}/${encodeURIComponent(waba)}/subscribed_apps`, { method: 'DELETE', token });
  return r.ok ? 'unsubscribed' : 'failed';
}

/** '•••• 1234' — the only form a WhatsApp number is shown or stored in outside the provider. */
export function maskNumber(display: unknown): string | null {
  const digits = String(display ?? '').replace(/\D/g, '');
  return digits.length >= 4 ? `•••• ${digits.slice(-4)}` : null;
}

// ---------------------------------------------------------------------------
// WhatsApp Calling: eligibility only (#1586, phase 2). No calling is built.
// ---------------------------------------------------------------------------

/** Meta's `messaging_limit_tier`, as a daily number of business-initiated conversations. Null when unknown. */
const TIER_LIMIT: Record<string, number> = {
  TIER_50: 50, TIER_250: 250, TIER_1K: 1_000, TIER_2K: 2_000, TIER_10K: 10_000, TIER_100K: 100_000, TIER_UNLIMITED: Number.POSITIVE_INFINITY,
};
export const CALLING_MIN_LIMIT = 2_000;

/**
 * Where business-initiated calls are not offered (README, Calls; Meta's list,
 * as of 2026-10-13), by the number's calling code. A +1 number may be in the
 * US or Canada, or in another NANP country; the restriction covers the first
 * two, and the sentence says "+1" rather than claiming which.
 */
const RESTRICTED_CALLING_CODES: [string, string, string][] = [
  ['234', 'NG', 'Nigeria'], ['20', 'EG', 'Egypt'], ['84', 'VN', 'Vietnam'], ['1', 'US_CA', 'the US or Canada (+1)'],
];

/**
 * The region restriction for a number, from its calling code only. The number
 * itself is never kept: this returns 'NG', 'EG', 'VN', 'US_CA', 'none' (not a
 * restricted calling code) or null when the number could not be read.
 */
export function callingRegion(display: unknown): string | null {
  const digits = String(display ?? '').replace(/\D/g, '');
  if (digits.length < 6) return null;
  const hit = RESTRICTED_CALLING_CODES.find(([code]) => digits.startsWith(code));
  return hit ? hit[1] : 'none';
}

/** What Calling would need, recorded per connected number in the integration's config (no number, no token). */
export interface CallingRecord { tier: string | null; region: string | null; checked_at: string }

export function callingRecord(number: Record<string, unknown> | null | undefined, now = new Date()): CallingRecord {
  const tier = typeof number?.messaging_limit_tier === 'string' && /^TIER_[A-Z0-9]{1,12}$/.test(number.messaging_limit_tier)
    ? number.messaging_limit_tier : null;
  return { tier, region: callingRegion(number?.display_phone_number), checked_at: now.toISOString() };
}

export interface CallingSide {
  available: false;
  reasons: { code: string; sentence: string }[];
}

export interface CallingEligibility {
  inbound: CallingSide;
  outbound: CallingSide;
  available: false;
  reasons: { code: string; sentence: string }[];
  sentence: string;
  tier: string | null;
  checked_at: string | null;
}

/**
 * The card's "Calls: not yet, because …". Always unavailable: Axal builds no
 * calling in this phase. The other reasons are this number's, from its record.
 */
export function callingEligibility(config: Record<string, unknown> | null | undefined): CallingEligibility {
  const rec = config?.calling && typeof config.calling === 'object' ? config.calling as Partial<CallingRecord> : null;
  // Each reason is a clause, so the card's line reads as one sentence.
  const clauses: [string, string, 'both' | 'outbound'][] = [['not_built', 'Axal does not answer or place WhatsApp calls yet', 'both']];
  if (!rec) {
    clauses.push(['not_checked', 'this number has not been checked yet (test the connection to check it)', 'both']);
  } else {
    const limit = rec.tier ? TIER_LIMIT[rec.tier] : undefined;
    if (limit === undefined) clauses.push(['tier_unknown', 'this number\'s messaging limit could not be read', 'both']);
    else if (limit < CALLING_MIN_LIMIT) {
      clauses.push(['tier_low', `this number can start ${limit.toLocaleString('en-US')} conversations a day, and WhatsApp Calling needs at least ${CALLING_MIN_LIMIT.toLocaleString('en-US')}`, 'both']);
    }
    const region = RESTRICTED_CALLING_CODES.find(([, key]) => key === rec.region);
    if (region) clauses.push(['region', `Meta does not offer business-initiated calls for numbers in ${region[2]}`, 'outbound']);
    else if (rec.region == null) clauses.push(['region_unknown', 'this number\'s country could not be read', 'outbound']);
  }
  const reasons = (side: 'inbound' | 'outbound'): CallingSide => ({
    available: false,
    reasons: clauses.filter(([, , audience]) => side === 'outbound' || audience === 'both')
      .map(([code, clause]) => ({ code, sentence: `${clause.charAt(0).toUpperCase()}${clause.slice(1)}.` })),
  });
  return {
    inbound: reasons('inbound'), outbound: reasons('outbound'),
    available: false,
    reasons: clauses.map(([code, clause]) => ({ code, sentence: `${clause.charAt(0).toUpperCase()}${clause.slice(1)}.` })),
    sentence: `Calls: not yet, because ${clauses.map(([, clause]) => clause).join('; ')}.`,
    tier: rec?.tier ?? null,
    checked_at: typeof rec?.checked_at === 'string' ? rec.checked_at : null,
  };
}

// ---------------------------------------------------------------------------
// Embedded Signup
// ---------------------------------------------------------------------------

export interface SignupInput { code: string; wabaId: string; phoneNumberId: string }

export type ConnectOutcome =
  | { ok: true; integrationId: number; name: string | null }
  | { ok: false; status: 400 | 409 | 502 | 503; code: string };

const hexUid = () => [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, '0')).join('');

/**
 * Finish Embedded Signup for a member:
 *   1. the code → a business token (`GET /oauth/access_token` with Axal's app
 *      id and secret — Meta's documented form for this exchange);
 *   2. the number must be one of that WABA's numbers, read WITH that token —
 *      so a member can only claim a number the token they just earned can
 *      see, and tenancy (phone_number_id → member) cannot be pointed at
 *      somebody else's number;
 *   3. Axal's app is subscribed to the WABA's webhooks;
 *   4. the row is stored: token encrypted, ids in config, the number masked.
 * Nothing is stored unless all of it succeeds. A number already active on
 * another member is refused (the partial unique index decides the race).
 */
export async function completeEmbeddedSignup(env: Env, userId: number, input: SignupInput): Promise<ConnectOutcome> {
  const appId = String(env.WHATSAPP_APP_ID ?? '').trim();
  const appSecret = String(env.WHATSAPP_APP_SECRET ?? '').trim();
  if (!appId || !appSecret) return { ok: false, status: 503, code: 'not_configured' };

  const axalNumber = String(env.WHATSAPP_AXAL_PHONE_NUMBER_ID ?? '').trim();
  const axalWaba = String(env.WHATSAPP_AXAL_WABA_ID ?? '').trim();
  const isAxal = () => !!((axalNumber && input.phoneNumberId === axalNumber) || (axalWaba && input.wabaId === axalWaba));
  if (isAxal()) return { ok: false, status: 409, code: 'axal_number' };

  const isTaken = async (phoneNumberId: string) => !!(await env.DB.prepare(
    `SELECT 1 AS t FROM integrations WHERE provider_key = 'whatsapp' AND external_account_id = ? AND status = 'active' AND user_id != ?`,
  ).bind(phoneNumberId, userId).first<{ t: number }>());
  if (input.phoneNumberId && await isTaken(input.phoneNumberId)) return { ok: false, status: 409, code: 'number_taken' };

  const q = new URLSearchParams({ client_id: appId, client_secret: appSecret, code: input.code });
  const exchanged = await graph('code_exchange', `${GRAPH_BASE}/oauth/access_token?${q}`);
  const token = exchanged.ok && typeof exchanged.data?.access_token === 'string' ? exchanged.data.access_token : '';
  // Meta refusing the code is the member's to retry with a fresh signup (400);
  // Meta unreachable, or answering without a token, is ours (502).
  if (!token) return { ok: false, status: !exchanged.ok && !exchanged.retryable ? 400 : 502, code: 'code_exchange_failed' };

  const numbers = await graph('phone_numbers',
    `${GRAPH_BASE}/${encodeURIComponent(input.wabaId)}/phone_numbers?fields=id,display_phone_number,verified_name,messaging_limit_tier`, { token });
  if (!numbers.ok) return { ok: false, status: 502, code: 'waba_unreadable' };
  const listed = arr(numbers.data?.data).map(obj).filter((n) => n && idStr(n.id));
  // No number id from the signup (coexistence may send only the WABA): a WABA
  // with exactly one number is that number; several is the member's choice.
  if (!input.phoneNumberId) {
    if (listed.length !== 1) return { ok: false, status: listed.length ? 409 : 400, code: listed.length ? 'choose_number' : 'number_not_in_waba' };
    input = { ...input, phoneNumberId: idStr(listed[0]!.id) ?? '' };
    if (isAxal()) return { ok: false, status: 409, code: 'axal_number' };
    if (await isTaken(input.phoneNumberId)) return { ok: false, status: 409, code: 'number_taken' };
  }
  const number = listed.find((n) => idStr(n?.id) === input.phoneNumberId);
  if (!number) return { ok: false, status: 400, code: 'number_not_in_waba' };

  const subscribed = await graph('subscribe', `${GRAPH_BASE}/${encodeURIComponent(input.wabaId)}/subscribed_apps`, { method: 'POST', token });
  if (!subscribed.ok || subscribed.data?.success === false) return { ok: false, status: 502, code: 'subscribe_failed' };

  const masked = maskNumber(number.display_phone_number);
  const verified = typeof number.verified_name === 'string' && number.verified_name.trim()
    ? number.verified_name.trim().slice(0, CHANNEL_LIMITS.maxNameChars) : null;
  const name = verified ?? masked;
  const config = JSON.stringify({
    waba_id: input.wabaId, phone_number_id: input.phoneNumberId, number_masked: masked, connected_at: new Date().toISOString(),
    // #1586: what WhatsApp Calling would need, for the card's "Calls: not yet". No number is kept.
    calling: callingRecord(number),
  });

  const existing = await env.DB.prepare(
    `SELECT id, uid, external_account_id FROM integrations WHERE user_id = ? AND provider_key = 'whatsapp'`,
  ).bind(userId).first<{ id: number; uid: string; external_account_id: string | null }>();
  const uid = existing?.uid || hexUid();
  const credentials = await encryptCredentials(env, uid, { access_token: token, token_type: 'bearer', obtained_at: new Date().toISOString() });
  try {
    if (existing) {
      // A different number is a different set of customers: the old one's conversations go.
      if (existing.external_account_id && String(existing.external_account_id) !== input.phoneNumberId) {
        await forgetConnection(env, Number(existing.id));
      }
      await env.DB.prepare(
        `UPDATE integrations SET status = 'active', auth_type = 'oauth2', display_name = 'WhatsApp', credentials_enc = ?, config_json = ?,
                external_account_id = ?, external_account_name = ?, last_error = NULL, last_error_at = NULL, updated_at = CURRENT_TIMESTAMP
          WHERE id = ?`,
      ).bind(credentials, config, input.phoneNumberId, name, existing.id).run();
      return { ok: true, integrationId: Number(existing.id), name };
    }
    const row = await env.DB.prepare(
      `INSERT INTO integrations (uid, user_id, provider_key, display_name, status, auth_type, credentials_enc, config_json, external_account_id, external_account_name)
       VALUES (?, ?, 'whatsapp', 'WhatsApp', 'active', 'oauth2', ?, ?, ?, ?) RETURNING id`,
    ).bind(uid, userId, credentials, config, input.phoneNumberId, name).first<{ id: number }>();
    if (!row) return { ok: false, status: 502, code: 'not_stored' };
    return { ok: true, integrationId: Number(row.id), name };
  } catch (err) {
    if (/UNIQUE constraint failed/i.test(err instanceof Error ? err.message : '')) return { ok: false, status: 409, code: 'number_taken' };
    throw err;
  }
}
