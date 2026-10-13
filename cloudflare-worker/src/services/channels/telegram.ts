/**
 * D684 (#1576) — the Telegram Business adapter.
 *
 * ONE AXAL BOT FOR EVERY MEMBER. A member with Telegram Business connects the
 * Axal bot (TELEGRAM_CHANNEL_BOT_TOKEN — a separate bot from the news bot's
 * TELEGRAM_BOT_TOKEN, so it can be revoked on its own) in Telegram › Settings ›
 * Telegram Business › Chatbots and chooses which chats it sees. Every update
 * for every member arrives at one webhook, so the member is found from the
 * `business_connection_id`, never from anything else in the payload.
 *
 * What this file does, and nothing else (types.ts):
 *   verify     X-Telegram-Bot-Api-Secret-Token against TELEGRAM_CHANNEL_WEBHOOK_SECRET
 *   normalise  an Update into one InboundEvent
 *   link       `/start <code>` names the Telegram account redeeming the code,
 *              and that account's own `/confirm` (after the bot names the Axal
 *              account) joins the two; a `business_connection` is recorded
 *              against that account
 *   talk       sendMessage (business and private), getFile + download, setWebhook
 *
 * Bot API facts relied on (core.telegram.org/bots/api, read 2026-10-13):
 *   - BusinessConnection: id, user, user_chat_id, date, is_enabled, and since
 *     Bot API 9.0 `rights` (BusinessBotRights) in place of `can_reply`. A bot
 *     may act only in chats active in the last 24 hours.
 *   - business_message / edited_business_message are Messages carrying
 *     `business_connection_id`; deleted_business_messages is
 *     BusinessMessagesDeleted { business_connection_id, chat, message_ids }.
 *   - getFile serves files up to 20 MB.
 *   - The Bot API has NO call methods: a bot cannot place or answer a call.
 *
 * MESSAGE IDS ARE `<chat id>:<message_id>`. A Telegram message_id is unique
 * only within its chat, and `channel_outbound` looks a provider id up across
 * every chat (outbound.ts, threads.ts's echo check), so a bare id from one
 * chat could match Axal's reply in another. The composite is used everywhere
 * this adapter names a message: inbound, edits, deletions and sends.
 *
 * Nothing here logs a token, a message's text or a name; errors are codes.
 */
import type { Env } from '../../types';
import { providerJson } from './providerHttp';
import { constantTimeEqual, sha256Hex } from '../../rpc/secret';
import { IntakeError, activeMember } from '../interviewIntake';
import { confirmLinkClaim, consumeLinkCode } from './linkCodes';
import { forgetConnection } from './threads';
import {
  CHANNEL_LIMITS, type InboundConnection, type InboundEvent, type InboundLink, type InboundLinkConfirm, type SendResult,
} from './types';

export const TELEGRAM_API = 'https://api.telegram.org';

/** What the webhook subscribes to — exactly the update types this file reads. */
export const TELEGRAM_ALLOWED_UPDATES = [
  'message', 'business_connection', 'business_message', 'edited_business_message', 'deleted_business_messages',
] as const;

/** getFile's own ceiling: the Bot API serves nothing larger. */
export const TELEGRAM_MAX_DOWNLOAD_BYTES = 20 * 1024 * 1024;

/** sendMessage takes 1–4096 characters. */
export const TELEGRAM_MAX_TEXT = 4096;

/** Telegram's own rule for `secret_token`: 1–256 of A–Z, a–z, 0–9, _ and -. */
export const TELEGRAM_SECRET_RE = /^[A-Za-z0-9_-]{1,256}$/;

export type SecretCheck = 'ok' | 'unconfigured' | 'missing' | 'mismatch';

/**
 * The webhook's secret header. Both sides are hashed first, so the compare
 * takes the same time whatever the lengths. Unset on this deployment →
 * 'unconfigured', which the route answers 503: fail closed.
 */
export async function verifyTelegramSecret(env: Env, presented: string | null | undefined): Promise<SecretCheck> {
  const secret = String(env.TELEGRAM_CHANNEL_WEBHOOK_SECRET ?? '');
  if (!secret.trim()) return 'unconfigured';
  if (!presented) return 'missing';
  const [a, b] = await Promise.all([sha256Hex(String(presented)), sha256Hex(secret)]);
  return constantTimeEqual(a, b) ? 'ok' : 'mismatch';
}

// ---------------------------------------------------------------------------
// Normalising an Update
// ---------------------------------------------------------------------------

const obj = (v: unknown): Record<string, any> | null => (v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, any> : null);
const idStr = (v: unknown): string | null => (typeof v === 'number' || (typeof v === 'string' && v.trim()) ? String(v).trim() : null);
const isoFromUnix = (v: unknown): string => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? new Date(n * 1000).toISOString() : new Date().toISOString();
};
const clipText = (v: unknown): string => String(v ?? '').trim().slice(0, CHANNEL_LIMITS.maxTextChars);

/** `<chat id>:<message_id>` — see the header. */
export const telegramMessageRef = (chatId: string | number, messageId: string | number) => `${chatId}:${messageId}`;

function displayName(user: Record<string, any> | null): string | null {
  if (!user) return null;
  const username = typeof user.username === 'string' && user.username.trim() ? `@${user.username.trim()}` : '';
  const first = [user.first_name, user.last_name].filter((s) => typeof s === 'string' && s.trim()).join(' ').trim();
  const name = username || first;
  return name ? name.slice(0, CHANNEL_LIMITS.maxNameChars) : null;
}

/** The business connection an update arrived on, if it is a business update. */
export function telegramBusinessConnectionId(update: unknown): string | null {
  const u = obj(update);
  if (!u) return null;
  const m = obj(u.business_message) ?? obj(u.edited_business_message) ?? obj(u.deleted_business_messages);
  return m ? idStr(m.business_connection_id) : null;
}

/**
 * One Update as one InboundEvent.
 *
 * `ownerTelegramUserId` is the Telegram user who owns the business account the
 * update arrived on (from `telegram_business_connections`); a business message
 * from them is the member's side ('me'), any other is their contact's. When it
 * is not known (the connection is new to Axal) a message in a private chat is
 * the contact's when it comes from the chat's own user — a business chat is
 * always the owner talking to one other person.
 */
export function normaliseTelegramUpdate(update: unknown, ownerTelegramUserId: string | null = null): InboundEvent {
  const u = obj(update);
  const eventId = idStr(u?.update_id) ?? '';
  const ignored = (reason: string): InboundEvent => ({ kind: 'ignored', provider: 'telegram', eventId, reason });
  if (!u || !eventId) return ignored('malformed');

  // `/start <code>`, then `/confirm`, in the member's own private chat with the bot.
  const pm = obj(u.message);
  if (pm) {
    const chat = obj(pm.chat);
    const from = obj(pm.from);
    if (!chat || chat.type !== 'private' || !from || from.is_bot) return ignored('not_a_private_message');
    const text = typeof pm.text === 'string' ? pm.text.trim() : '';
    const start = /^\/start(?:@[A-Za-z0-9_]+)?\s+([A-Za-z0-9_-]{1,64})$/.exec(text);
    const tgUser = idStr(from.id);
    const chatId = idStr(chat.id);
    if (tgUser && chatId && /^\/confirm(?:@[A-Za-z0-9_]+)?$/.test(text)) {
      return { kind: 'link_confirm', provider: 'telegram', eventId, telegramUserId: tgUser, chatId, displayName: displayName(from) };
    }
    if (!start || !tgUser || !chatId) return ignored('not_a_link');
    return {
      kind: 'link', provider: 'telegram', eventId, telegramUserId: tgUser, chatId,
      displayName: displayName(from), code: start[1],
    };
  }

  const bc = obj(u.business_connection);
  if (bc) {
    const id = idStr(bc.id);
    const user = obj(bc.user);
    const tgUser = idStr(user?.id);
    const userChatId = idStr(bc.user_chat_id);
    if (!id || !tgUser || !userChatId) return ignored('malformed');
    const rawRights = obj(bc.rights) ?? {};
    const rights: Record<string, boolean> = {};
    for (const [k, v] of Object.entries(rawRights)) if (typeof v === 'boolean') rights[k] = v;
    // Bot API 9.0 moved the reply right into `rights`; a payload from before
    // it carries the old top-level `can_reply`, so both are read.
    const canReply = rights.can_reply === true || (bc.rights === undefined && bc.can_reply === true);
    const ev: InboundConnection = {
      kind: 'connection', provider: 'telegram', eventId, businessConnectionId: id, telegramUserId: tgUser,
      userChatId, isEnabled: bc.is_enabled === true, canReply, rights,
    };
    return ev;
  }

  const del = obj(u.deleted_business_messages);
  if (del) {
    const conn = idStr(del.business_connection_id);
    const chat = obj(del.chat);
    const chatId = idStr(chat?.id);
    const ids = Array.isArray(del.message_ids) ? del.message_ids.map(idStr).filter((x: string | null): x is string => !!x) : [];
    if (!conn || !chatId || !ids.length) return ignored('malformed');
    if (chat?.type !== 'private') return ignored('not_a_private_chat');
    return {
      kind: 'delete', provider: 'telegram', eventId, connectionRef: conn, externalChatId: chatId,
      externalMessageIds: ids.slice(0, 100).map((m: string) => telegramMessageRef(chatId, m)),
    };
  }

  const edited = obj(u.edited_business_message);
  const message = obj(u.business_message) ?? edited;
  if (!message) return ignored('unsupported_update');
  const conn = idStr(message.business_connection_id);
  const chat = obj(message.chat);
  const chatId = idStr(chat?.id);
  const messageId = idStr(message.message_id);
  if (!conn || !chatId || !messageId) return ignored('malformed');
  // Telegram Business covers one-to-one chats; anything else is not a customer conversation.
  if (chat?.type !== 'private') return ignored('not_a_private_chat');
  const from = obj(message.from);
  const fromId = idStr(from?.id);
  // A bot writing on the business's behalf (`sender_business_bot`) is the
  // member's side; any other bot is not a customer.
  const byBusinessBot = !!obj(message.sender_business_bot);
  if (!fromId || (from?.is_bot && !byBusinessBot)) return ignored('not_a_person');
  const fromOwner = ownerTelegramUserId ? fromId === ownerTelegramUserId : fromId !== chatId;
  const side = (byBusinessBot || fromOwner) ? 'me' : 'contact';
  const ref = telegramMessageRef(chatId, messageId);
  const text = clipText(message.text);

  if (edited) {
    if (!text) return ignored('unsupported_type');
    return { kind: 'edit', provider: 'telegram', eventId, connectionRef: conn, externalChatId: chatId, externalMessageId: ref, text };
  }

  const voice = obj(message.voice);
  const fileId = idStr(voice?.file_id);
  if (!text && !fileId) return ignored('unsupported_type');
  return {
    kind: 'message', provider: 'telegram', eventId, connectionRef: conn, externalChatId: chatId,
    externalMessageId: ref, side,
    // The chat's own user is the contact; their name is the thread's label.
    contactName: side === 'contact' ? displayName(from) : null,
    text: text || null,
    voice: !text && fileId ? {
      fileRef: fileId,
      mime: typeof voice?.mime_type === 'string' ? voice.mime_type : null,
      durationSec: Number.isFinite(Number(voice?.duration)) ? Number(voice?.duration) : null,
    } : null,
    sentAt: isoFromUnix(message.date),
  };
}

// ---------------------------------------------------------------------------
// Business connections and linking
// ---------------------------------------------------------------------------

/** The Telegram user who owns a business connection, when Axal has seen it. */
export async function businessConnectionOwner(env: Env, businessConnectionId: string): Promise<string | null> {
  const row = await env.DB.prepare('SELECT telegram_user_id FROM telegram_business_connections WHERE business_connection_id = ?')
    .bind(String(businessConnectionId)).first<{ telegram_user_id: string }>();
  return row ? String(row.telegram_user_id) : null;
}

/** The member's newest enabled business connection: the one a reply goes out on. */
export async function activeBusinessConnection(env: Env, userId: number): Promise<{ businessConnectionId: string; canReply: boolean } | null> {
  const row = await env.DB.prepare(
    `SELECT business_connection_id, can_reply FROM telegram_business_connections
      WHERE user_id = ? AND is_enabled = 1 ORDER BY updated_at DESC, id DESC LIMIT 1`,
  ).bind(userId).first<{ business_connection_id: string; can_reply: number }>();
  return row ? { businessConnectionId: String(row.business_connection_id), canReply: !!row.can_reply } : null;
}

/** The active member a Telegram account is linked to, if any. */
async function linkedMember(env: Env, telegramUserId: string): Promise<number | null> {
  const row = await env.DB.prepare(
    `SELECT user_id FROM integrations WHERE provider_key = 'telegram' AND external_account_id = ? AND status = 'active'`,
  ).bind(telegramUserId).first<{ user_id: number }>();
  return row ? Number(row.user_id) : null;
}

/**
 * Record a `business_connection` update. The row is keyed by the connection
 * id and joined to a member only through a LINKED Telegram account; until the
 * account is linked `user_id` stays NULL and nothing from the connection is
 * stored anywhere else. A disabled connection is the same upsert with
 * `is_enabled` 0, which `connections.ts` already reads as nobody.
 */
export async function recordBusinessConnection(env: Env, ev: InboundConnection): Promise<{ userId: number | null }> {
  const userId = await linkedMember(env, ev.telegramUserId);
  await env.DB.prepare(
    `INSERT INTO telegram_business_connections
       (uid, business_connection_id, telegram_user_id, user_id, is_enabled, can_reply, rights_json)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(business_connection_id) DO UPDATE SET
       telegram_user_id = excluded.telegram_user_id, user_id = excluded.user_id, is_enabled = excluded.is_enabled,
       can_reply = excluded.can_reply, rights_json = excluded.rights_json, updated_at = datetime('now')`,
  ).bind(crypto.randomUUID(), ev.businessConnectionId, ev.telegramUserId, userId, ev.isEnabled ? 1 : 0,
    ev.canReply ? 1 : 0, JSON.stringify(ev.rights)).run();
  return { userId };
}

export type ClaimOutcome =
  | { claimed: true; userId: number; account: string | null }
  | { claimed: false; reason: 'code_invalid' | 'member_inactive' | 'identity_taken' };

export type LinkOutcome =
  | { linked: true; userId: number; integrationId: number; businessConnected: boolean }
  | { linked: false; reason: 'nothing_to_confirm' | 'member_inactive' | 'identity_taken' };

const hexUid = () => [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, '0')).join('');

/** 'm•••@example.com': enough for the owner of a Telegram account to tell their own Axal account from a stranger's. */
export function maskEmail(email: unknown): string | null {
  const m = /^([^@\s])[^@\s]*@([^@\s]+)$/.exec(String(email ?? '').trim());
  return m ? `${m[1]}•••@${m[2]}` : null;
}

async function memberStanding(env: Env, userId: number): Promise<boolean> {
  try {
    await activeMember(env, userId);
    return true;
  } catch (err) {
    if (err instanceof IntakeError) return false;
    throw err;
  }
}

/**
 * `/start <code>`, step one of two. The code names the member and the update
 * names the Telegram account, but redeeming a code proves only that someone
 * held it — and a member can hand their code to anyone. So nothing is linked
 * here: the Telegram account is recorded on the spent code, and the bot asks
 * that account to confirm, naming the Axal account (masked) it would join.
 *
 * WHY THE CONFIRMATION IS ON THE TELEGRAM SIDE. The harm the review found was
 * a member sending their link to someone else's Telegram Business account:
 * one tap on Start used to hand that account's customer chats, and any
 * business connection it already had, to the member. A confirmation in Axal
 * would be pressed by that same member. Only the owner of the Telegram
 * account can protect it, so the owner is the one asked, and told which Axal
 * account is asking; only their own `/confirm` (Telegram sets `from.id`, and
 * the webhook is secret-verified) completes it. A stranger who merely sees a
 * member's code can redeem it but cannot confirm for anyone else's account.
 */
export async function claimTelegramLink(env: Env, link: InboundLink): Promise<ClaimOutcome> {
  const userId = await consumeLinkCode(env, link.code, 'telegram', link.telegramUserId);
  if (!userId) return { claimed: false, reason: 'code_invalid' };
  if (!(await memberStanding(env, userId))) return { claimed: false, reason: 'member_inactive' };
  const holder = await linkedMember(env, link.telegramUserId);
  if (holder && holder !== userId) return { claimed: false, reason: 'identity_taken' };
  const row = await env.DB.prepare('SELECT email FROM users WHERE id = ?').bind(userId).first<{ email: string | null }>();
  return { claimed: true, userId, account: maskEmail(row?.email) };
}

/**
 * `/confirm`, step two: the Telegram account that redeemed a code in the last
 * ten minutes agrees, and the two are joined. A Telegram account already
 * active on ANOTHER member is refused — the partial unique index on
 * `integrations` enforces it too, for the race — and nothing is stored. A
 * member re-linking a different Telegram account loses the old account's
 * conversations (as a disconnect would) and its business connections are
 * detached.
 */
export async function confirmTelegramLink(env: Env, link: InboundLinkConfirm): Promise<LinkOutcome> {
  const userId = await confirmLinkClaim(env, 'telegram', link.telegramUserId);
  if (!userId) return { linked: false, reason: 'nothing_to_confirm' };
  if (!(await memberStanding(env, userId))) return { linked: false, reason: 'member_inactive' };
  const holder = await linkedMember(env, link.telegramUserId);
  if (holder && holder !== userId) return { linked: false, reason: 'identity_taken' };

  const name = (link.displayName ?? '').slice(0, CHANNEL_LIMITS.maxNameChars) || null;
  const config = JSON.stringify({ connected_at: new Date().toISOString() });
  const existing = await env.DB.prepare(
    `SELECT id, external_account_id FROM integrations WHERE user_id = ? AND provider_key = 'telegram'`,
  ).bind(userId).first<{ id: number; external_account_id: string | null }>();
  let integrationId: number;
  try {
    if (existing) {
      if (existing.external_account_id && String(existing.external_account_id) !== link.telegramUserId) {
        await forgetConnection(env, Number(existing.id));
        await env.DB.prepare(
          `UPDATE telegram_business_connections SET user_id = NULL, updated_at = datetime('now') WHERE user_id = ? AND telegram_user_id != ?`,
        ).bind(userId, link.telegramUserId).run();
      }
      await env.DB.prepare(
        `UPDATE integrations SET status = 'active', auth_type = 'webhook', display_name = 'Telegram', credentials_enc = NULL,
                external_account_id = ?, external_account_name = ?, config_json = ?, last_error = NULL, updated_at = CURRENT_TIMESTAMP
          WHERE id = ?`,
      ).bind(link.telegramUserId, name, config, existing.id).run();
      integrationId = Number(existing.id);
    } else {
      const row = await env.DB.prepare(
        `INSERT INTO integrations (uid, user_id, provider_key, display_name, status, auth_type, config_json, external_account_id, external_account_name)
         VALUES (?, ?, 'telegram', 'Telegram', 'active', 'webhook', ?, ?, ?) RETURNING id`,
      ).bind(hexUid(), userId, config, link.telegramUserId, name).first<{ id: number }>();
      if (!row) throw new Error('telegram_link_not_stored');
      integrationId = Number(row.id);
    }
  } catch (err) {
    // Another member linked the same account between the check and the write.
    if (/UNIQUE constraint failed/i.test(err instanceof Error ? err.message : '')) return { linked: false, reason: 'identity_taken' };
    throw err;
  }
  await env.DB.prepare(
    `UPDATE telegram_business_connections SET user_id = ?, updated_at = datetime('now') WHERE telegram_user_id = ?`,
  ).bind(userId, link.telegramUserId).run();
  const bc = await env.DB.prepare(
    `SELECT 1 AS ok FROM telegram_business_connections WHERE telegram_user_id = ? AND is_enabled = 1 LIMIT 1`,
  ).bind(link.telegramUserId).first<{ ok: number }>();
  return { linked: true, userId, integrationId, businessConnected: !!bc };
}

/** What the bot says in the member's private chat. Plain sentences; never a code or a token. */
export const TELEGRAM_COPY = {
  /** Step one of linking: names the Axal account and waits for this Telegram account's own /confirm. */
  confirm: (account: string | null) => `This link would connect your Telegram account to the Axal account ${account ?? 'that made it'}. `
    + 'Axal would then receive the customer chats you let this bot see in Telegram Business. '
    + 'If that is your Axal account and you asked for this, send /confirm here within 10 minutes. '
    + 'If not, ignore this message: nothing is linked.',
  linked: 'Your Telegram account is now linked to Axal. Next, in Telegram open Settings › Telegram Business › Chatbots, add this bot, and choose the chats it can see.',
  linkedConnected: 'Your Telegram account is now linked to Axal. Conversations from the chats this bot can see will wait in Axal › Interviews until you assign them.',
  nothingToConfirm: 'There is no link waiting for you to confirm, or it is more than 10 minutes old. In Axal, open Account › Connectors and press Link Telegram for a new one.',
  codeInvalid: 'That link has expired or was already used. In Axal, open Account › Connectors and press Link Telegram for a new one.',
  identityTaken: 'This Telegram account is already linked to another Axal account. Disconnect it there first, then try again.',
  memberInactive: 'The Axal account behind that link is no longer active.',
  linkPrompt: 'Axal received your Telegram Business connection, but this Telegram account is not linked to an Axal account yet. In Axal, open Account › Connectors and press Link Telegram. Nothing from your chats is stored until you do.',
  test: 'This is a test message from Axal. Your Telegram account is connected.',
} as const;

// ---------------------------------------------------------------------------
// Talking to Telegram
// ---------------------------------------------------------------------------

type CallResult = { ok: true; result: any } | { ok: false; code: string; retryable: boolean; status: number };

function failure(status: number): { code: string; retryable: boolean } {
  if (status === 429) return { code: 'rate_limited', retryable: true };
  if (status >= 500) return { code: 'provider_unavailable', retryable: true };
  if (status === 401 || status === 404) return { code: 'not_configured', retryable: false };
  if (status === 403) return { code: 'forbidden', retryable: false };
  return { code: 'rejected', retryable: false };
}

/** One Bot API call. The token is in the URL, so the URL is never logged. */
async function call(env: Env, method: string, body: Record<string, unknown>): Promise<CallResult> {
  const token = String(env.TELEGRAM_CHANNEL_BOT_TOKEN ?? '').trim();
  if (!token) return { ok: false, code: 'not_configured', retryable: false, status: 0 };
  let res: Response;
  let data: any;
  try {
    ({ res, data } = await providerJson(`${TELEGRAM_API}/bot${token}/${method}`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    }));
  } catch {
    const code = method === 'sendMessage' ? 'send_unknown' : 'network';
    console.error(`[channels] telegram ${method} ${code}`);
    return { ok: false, code, retryable: code !== 'send_unknown', status: 0 };
  }
  // Without an explicit rejection a successful HTTP response may have sent it.
  if (method === 'sendMessage' && res.ok && data?.ok !== true && data?.ok !== false) {
    return { ok: false, code: 'send_unknown', retryable: false, status: 0 };
  }
  if (res.ok && data?.ok === true) return { ok: true, result: data.result };
  const status = Number(data?.error_code) || res.status || 500;
  const f = failure(status);
  console.error(`[channels] telegram ${method} failed status=${status} code=${f.code}`);
  return { ok: false, ...f, status };
}

function sendResult(r: CallResult, chatId: string): SendResult {
  if (!r.ok) return { ok: false, code: r.code, retryable: r.retryable };
  const id = idStr(r.result?.message_id);
  // Acceptance by Telegram, never delivery (outbound.ts).
  return id ? { ok: true, externalMessageId: telegramMessageRef(chatId, id) } : { ok: false, code: 'send_unknown', retryable: false };
}

/**
 * A reply in a customer chat, on the member's business connection. Refused
 * here, before any call, when the text is empty or too long.
 */
export async function sendBusinessMessage(env: Env, businessConnectionId: string, chatId: string, text: string): Promise<SendResult> {
  const body = String(text ?? '').trim();
  if (!body) return { ok: false, code: 'text_required' };
  if (body.length > TELEGRAM_MAX_TEXT) return { ok: false, code: 'text_too_long' };
  const r = await call(env, 'sendMessage', {
    business_connection_id: businessConnectionId, chat_id: chatId, text: body,
    link_preview_options: { is_disabled: true },
  });
  return sendResult(r, chatId);
}

/** A message in the member's own private chat with the bot (link prompts, confirmations, the test). */
export async function sendPrivateMessage(env: Env, chatId: string, text: string): Promise<SendResult> {
  const r = await call(env, 'sendMessage', { chat_id: chatId, text, link_preview_options: { is_disabled: true } });
  return sendResult(r, chatId);
}

export type AudioResult =
  | { ok: true; bytes: Uint8Array; mime: string }
  | { ok: false; code: string; retryable: boolean };

/** A voice note's audio: getFile, then the file URL. Refused above 20 MB, before and after download. */
export async function fetchTelegramVoice(env: Env, fileId: string, mimeHint: string | null = null): Promise<AudioResult> {
  const meta = await call(env, 'getFile', { file_id: fileId });
  if (!meta.ok) return { ok: false, code: meta.code, retryable: meta.retryable };
  const size = Number(meta.result?.file_size);
  if (Number.isFinite(size) && size > TELEGRAM_MAX_DOWNLOAD_BYTES) return { ok: false, code: 'too_large', retryable: false };
  const path = typeof meta.result?.file_path === 'string' ? meta.result.file_path : '';
  if (!path || path.includes('..')) return { ok: false, code: 'no_file_path', retryable: false };
  const token = String(env.TELEGRAM_CHANNEL_BOT_TOKEN ?? '').trim();
  let res: Response;
  try {
    res = await fetch(`${TELEGRAM_API}/file/bot${token}/${path}`);
  } catch {
    console.error('[channels] telegram file download network_error');
    return { ok: false, code: 'network', retryable: true };
  }
  if (!res.ok) {
    const f = failure(res.status);
    console.error(`[channels] telegram file download failed status=${res.status}`);
    return { ok: false, ...f };
  }
  if (Number(res.headers.get('content-length') || 0) > TELEGRAM_MAX_DOWNLOAD_BYTES) return { ok: false, code: 'too_large', retryable: false };
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.byteLength > TELEGRAM_MAX_DOWNLOAD_BYTES) return { ok: false, code: 'too_large', retryable: false };
  if (!bytes.byteLength) return { ok: false, code: 'empty_file', retryable: false };
  // Telegram voice notes are OGG/Opus.
  const mime = (mimeHint || res.headers.get('content-type') || 'audio/ogg').split(';')[0].trim() || 'audio/ogg';
  return { ok: true, bytes, mime };
}

/**
 * Point the bot's webhook at `url`, with the secret Telegram will send back on
 * every delivery and only the update types this adapter reads. Returns codes
 * only; the token and the secret never leave this function.
 */
export async function setTelegramWebhook(env: Env, url: string): Promise<{ ok: true } | { ok: false; code: string }> {
  const secret = String(env.TELEGRAM_CHANNEL_WEBHOOK_SECRET ?? '');
  if (!secret.trim() || !String(env.TELEGRAM_CHANNEL_BOT_TOKEN ?? '').trim()) return { ok: false, code: 'not_configured' };
  if (!TELEGRAM_SECRET_RE.test(secret)) return { ok: false, code: 'secret_format' };
  const r = await call(env, 'setWebhook', {
    url, secret_token: secret, allowed_updates: [...TELEGRAM_ALLOWED_UPDATES], drop_pending_updates: false,
  });
  return r.ok ? { ok: true } : { ok: false, code: r.code };
}
