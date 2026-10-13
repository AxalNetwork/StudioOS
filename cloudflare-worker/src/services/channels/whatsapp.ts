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
 *              `smb_message_echoes` (what the member sent from the app)
 *   connect    Embedded Signup's code → business token (encrypted in
 *              integrations.credentials_enc), the number checked against the
 *              WABA, the app subscribed to the WABA
 *   talk       send text, download media, read the number for the test
 *
 * GRAPH API VERSION. Pinned at v23.0 (released 2025-05-29). Meta supports a
 * Graph version for at least two years after the next one ships, so v23.0 is
 * served into 2027. It is the newest version this adapter's request and
 * response shapes were checked against; the owner bumps it here, once, after
 * reading developers.facebook.com/docs/graph-api/changelog. Network access to
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
import { constantTimeEqual, sha256Hex } from '../../rpc/secret';
import { decryptCredentials, encryptCredentials } from '../../integrations/secrets';
import type { ChannelConnection } from './connections';
import { forgetConnection } from './threads';
import type { AudioResult, SecretCheck } from './telegram';
import { CHANNEL_LIMITS, type InboundEvent, type MessageSide, type SendResult } from './types';

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
  const text = type === 'text' ? String(obj(msg.text)?.body ?? '').trim().slice(0, CHANNEL_LIMITS.maxTextChars) : '';
  // Voice notes are `audio` with `voice: true`; older payloads used type `voice`.
  const media = type === 'audio' || type === 'voice' ? obj(msg.audio) ?? obj(msg.voice) : null;
  const mediaId = idStr(media?.id);
  if (!text && !mediaId) return ignored('unsupported_type');
  const name = side === 'contact' ? names.get(chat) ?? null : null;
  return {
    kind: 'message', provider: 'whatsapp', eventId: id, connectionRef: phoneNumberId, externalChatId: chat,
    externalMessageId: id, side,
    contactName: name ? name.slice(0, CHANNEL_LIMITS.maxNameChars) : null,
    text: text || null,
    voice: !text && mediaId ? { fileRef: mediaId, mime: typeof media?.mime_type === 'string' ? media.mime_type : null, durationSec: null } : null,
    sentAt: isoFromUnix(msg.timestamp),
  };
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
export function normaliseWhatsAppPayload(body: unknown): InboundEvent[] {
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
        for (const m of arr(value.messages)) { const ev = messageEvent(m, pnid, 'contact', names); if (ev) out.push(ev); }
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
  try {
    res = await fetch(url, { method: init.method ?? 'GET', headers, body: init.json === undefined ? undefined : JSON.stringify(init.json) });
  } catch {
    console.error(`[channels] whatsapp ${what} network_error`);
    return { ok: false, code: 'network', retryable: true };
  }
  const data = await res.json().catch(() => null) as any;
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
  return id ? { ok: true, externalMessageId: id } : { ok: false, code: 'unexpected_response' };
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
export async function fetchWhatsAppMedia(env: Env, conn: ChannelConnection, mediaId: string, mimeHint: string | null = null): Promise<AudioResult> {
  const token = await whatsappToken(env, conn);
  if (!token) return { ok: false, code: 'not_connected', retryable: false };
  const meta = await graph('media', `${GRAPH_BASE}/${encodeURIComponent(mediaId)}`, { token });
  if (!meta.ok) return { ok: false, code: meta.code, retryable: meta.retryable };
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
  const r = await graph('check', `${GRAPH_BASE}/${encodeURIComponent(pnid)}?fields=verified_name,quality_rating`, { token });
  return r.ok ? { ok: true } : { ok: false, code: r.code };
}

/** Disconnect: stop Meta sending this WABA's webhooks to Axal. Best effort; the caller ignores a failure. */
export async function unsubscribeApp(env: Env, conn: Pick<ChannelConnection, 'integrationUid' | 'credentialsEnc' | 'config'>): Promise<boolean> {
  const waba = idStr(conn.config?.waba_id);
  const token = await whatsappToken(env, conn);
  if (!waba || !token) return false;
  const r = await graph('unsubscribe', `${GRAPH_BASE}/${encodeURIComponent(waba)}/subscribed_apps`, { method: 'DELETE', token });
  return r.ok;
}

/** '•••• 1234' — the only form a WhatsApp number is shown or stored in outside the provider. */
export function maskNumber(display: unknown): string | null {
  const digits = String(display ?? '').replace(/\D/g, '');
  return digits.length >= 4 ? `•••• ${digits.slice(-4)}` : null;
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
    `${GRAPH_BASE}/${encodeURIComponent(input.wabaId)}/phone_numbers?fields=id,display_phone_number,verified_name`, { token });
  if (!numbers.ok) return { ok: false, status: 502, code: 'waba_unreadable' };
  const listed = arr(numbers.data?.data).map(obj).filter((n) => n && idStr(n.id));
  // No number id from the signup (coexistence may send only the WABA): a WABA
  // with exactly one number is that number; several is the member's choice.
  if (!input.phoneNumberId) {
    if (listed.length !== 1) return { ok: false, status: listed.length ? 409 : 400, code: listed.length ? 'choose_number' : 'number_not_in_waba' };
    input = { ...input, phoneNumberId: idStr(listed[0]!.id) ?? '' };
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
                external_account_id = ?, external_account_name = ?, last_error = NULL, updated_at = CURRENT_TIMESTAMP
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
