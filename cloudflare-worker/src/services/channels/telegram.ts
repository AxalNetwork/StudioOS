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
 *              and that account's own `/confirm` plus the member's Confirm
 *              in Axal (within the original ten minutes) joins the two; a `business_connection` is recorded
 *              against that account
 *   talk       sendMessage (business and private), getFile + download, setWebhook,
 *              and getMe + getWebhookInfo for the Super Admin's health read (D756)
 *   consent    (D756 §1.5, #1977) the contact's own whole YES, NO or STOP —
 *              from the chat's own user, never a business bot or an offline
 *              auto-reply — is normalised as a `consent_reply` that keeps
 *              the ordinary message it also is; `sendConsentNotice` sends
 *              Axal's notice on the member's business connection. Whether an
 *              answer counts is consent.ts's, not this file's.
 *
 * Bot API facts relied on (core.telegram.org/bots/api, read 2026-10-13; the
 * reply window, update ids and retry_after re-read against Bot API 10.3 on
 * 2026-10-18, D756):
 *   - BusinessConnection: id, user, user_chat_id, date, is_enabled, and since
 *     Bot API 9.0 `rights` (BusinessBotRights) in place of `can_reply`. A bot
 *     may reply only in private chats that had incoming messages in the last
 *     24 hours (BusinessBotRights.can_reply).
 *   - After a week with no updates, the next `update_id` is chosen at random,
 *     so an update is claimed on its id plus a hash of its own ids (D756).
 *   - A 429 carries `parameters.retry_after`, the seconds to wait.
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
import { claimDetails, confirmLinkClaim, consumeLinkCode, memberLinkClaim, type LinkClaim } from './linkCodes';

import {
  CHANNEL_LIMITS, consentWord, type InboundConnection, type InboundEvent, type InboundLink, type InboundLinkConfirm,
  type InboundMessage, type SendResult,
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

/** FNV-1a, 32 bits, as 8 hex characters: short, synchronous and stable. Not a secret, only a discriminator. */
function fnv1a(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

/**
 * The event key of an Update: `<update_id>:<hash of its own ids>` (D756). After
 * a quiet week Telegram restarts `update_id` at random, and claims live 90 days,
 * so a bare id could match a different, older update; a redelivery of the same
 * update has the same ids and so the same key. Null when there is no update_id.
 */
export function telegramEventId(update: unknown): string | null {
  const u = obj(update);
  const updateId = idStr(u?.update_id);
  if (!u || !updateId) return null;
  const parts: string[] = [];
  const pm = obj(u.message);
  const bc = obj(u.business_connection);
  const del = obj(u.deleted_business_messages);
  const edited = obj(u.edited_business_message);
  const msg = obj(u.business_message) ?? edited;
  if (pm) parts.push('message', idStr(obj(pm.chat)?.id) ?? '', idStr(pm.message_id) ?? '');
  else if (bc) parts.push('business_connection', idStr(bc.id) ?? '');
  else if (del) {
    const ids = Array.isArray(del.message_ids) ? del.message_ids.map(idStr).filter((x: string | null): x is string => !!x) : [];
    parts.push('deleted_business_messages', idStr(del.business_connection_id) ?? '', idStr(obj(del.chat)?.id) ?? '', ids.join(','));
  } else if (msg) {
    parts.push(edited ? 'edited_business_message' : 'business_message', idStr(msg.business_connection_id) ?? '',
      idStr(obj(msg.chat)?.id) ?? '', idStr(msg.message_id) ?? '', edited ? String(edited.edit_date ?? '') : '');
  }
  return `${updateId}:${fnv1a(parts.join('|'))}`;
}

/** Telegram's "manage this chat" button: `/start bizChat<chat id>` in the member's private chat with the bot. */
const MANAGE_CHAT_RE = /^\/start(?:@[A-Za-z0-9_]+)?\s+bizChat\d{1,20}$/;

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
  const eventId = telegramEventId(u) ?? '';
  const ignored = (reason: string): InboundEvent => ({ kind: 'ignored', provider: 'telegram', eventId, reason });
  if (!u || !eventId) return ignored('malformed');

  // `/start <code>`, then `/confirm`, in the member's own private chat with the bot.
  const pm = obj(u.message);
  if (pm) {
    const chat = obj(pm.chat);
    const from = obj(pm.from);
    if (!chat || chat.type !== 'private' || !from || from.is_bot) return ignored('not_a_private_message');
    const text = typeof pm.text === 'string' ? pm.text.trim() : '';
    const tgUser = idStr(from.id);
    const chatId = idStr(chat.id);
    // Before the link code: a real code never starts with `bizChat` (linkCodes.ts has no `i`),
    // and this press must spend neither a code nor a link attempt (D756). The managed chat's id is not kept.
    if (tgUser && chatId && MANAGE_CHAT_RE.test(text)) {
      return { kind: 'manage_chat', provider: 'telegram', eventId, telegramUserId: tgUser, chatId };
    }
    const start = /^\/start(?:@[A-Za-z0-9_]+)?\s+([A-Za-z0-9_-]{1,64})$/.exec(text);
    if (tgUser && chatId && /^\/confirm(?:@[A-Za-z0-9_]+)?$/.test(text)) {
      return { kind: 'link_confirm', provider: 'telegram', eventId, telegramUserId: tgUser, chatId, displayName: displayName(from) };
    }
    if (!start || !tgUser || !chatId) return ignored('not_a_link');
    return {
      kind: 'link', provider: 'telegram', eventId, telegramUserId: tgUser, chatId,
      displayName: displayName(from),
      accountName: [from.first_name, from.last_name].filter((s) => typeof s === 'string' && s.trim()).join(' ').trim().slice(0, CHANNEL_LIMITS.maxNameChars) || null,
      username: typeof from.username === 'string' && /^[A-Za-z0-9_]{1,32}$/.test(from.username) ? '@' + from.username : null,
      code: start[1],
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
  const msg: InboundMessage = {
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
  // D756 §1.5: a possible answer to the consent notice — the chat's own user,
  // never a business bot or an offline auto-reply. It keeps the message it is.
  const word = side === 'contact' && fromId === chatId && !byBusinessBot && message.is_from_offline !== true
    ? consentWord(text) : null;
  if (word) {
    const replyTo = idStr(obj(message.reply_to_message)?.message_id);
    return {
      kind: 'consent_reply', provider: 'telegram', eventId, connectionRef: conn, externalChatId: chatId,
      externalMessageId: ref, side: 'contact', answer: word, via: 'text', requestUid: null,
      contextMessageId: replyTo ? telegramMessageRef(chatId, replyTo) : null, fallback: msg, sentAt: msg.sentAt,
    };
  }
  return msg;
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

/**
 * The member's Telegram Business state (D756): `enabled` with the connection a
 * reply goes out on (the same row `activeBusinessConnection` picks), `disabled`
 * when every connection they have is switched off in Telegram, or `none`. The
 * voice job and the reply route both read it, so a switched-off bot is honoured
 * the same way everywhere.
 */
export type TelegramBusinessState =
  | { state: 'enabled'; businessConnectionId: string; canReply: boolean }
  | { state: 'disabled' }
  | { state: 'none' };

export async function telegramBusinessState(env: Env, userId: number): Promise<TelegramBusinessState> {
  const row = await env.DB.prepare(
    `SELECT business_connection_id, can_reply, is_enabled FROM telegram_business_connections
      WHERE user_id = ? ORDER BY is_enabled DESC, updated_at DESC, id DESC LIMIT 1`,
  ).bind(userId).first<{ business_connection_id: string; can_reply: number; is_enabled: number }>();
  if (!row) return { state: 'none' };
  if (!row.is_enabled) return { state: 'disabled' };
  return { state: 'enabled', businessConnectionId: String(row.business_connection_id), canReply: !!row.can_reply };
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
  | { linked: false; reason: 'nothing_to_confirm' | 'member_inactive' | 'identity_taken' | 'waiting_axal' | 'waiting_telegram' };

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
 * A code proves only possession: record its claimant, but activate nothing.
 * Telegram's own /confirm protects the Telegram owner; the signed-in Axal
 * member must separately approve the displayed identity, protecting their
 * existing connection and conversations if a stranger obtained the code.
 * Both confirmations are bound to this claim and its original ten-minute
 * expiry, never an extension measured from redemption.
 */
export async function claimTelegramLink(env: Env, link: InboundLink): Promise<ClaimOutcome> {
  const userId = await consumeLinkCode(env, link.code, 'telegram', link.telegramUserId,
    { display_name: link.accountName ?? link.displayName, username: link.username ?? null });
  if (!userId) return { claimed: false, reason: 'code_invalid' };
  if (!(await memberStanding(env, userId))) return { claimed: false, reason: 'member_inactive' };
  const holder = await linkedMember(env, link.telegramUserId);
  if (holder && holder !== userId) return { claimed: false, reason: 'identity_taken' };
  const row = await env.DB.prepare('SELECT email FROM users WHERE id = ?').bind(userId).first<{ email: string | null }>();
  return { claimed: true, userId, account: maskEmail(row?.email) };
}

/**
 * Both owners must agree to the SAME claim within its original lifetime.
 * Every destructive write and activation runs in ONE D1 batch. Its guard is
 * rechecked inside the transaction: another confirmation, new code,
 * disconnect, expiry, or a unique-index race cannot destroy the old chats.
 */
async function activateTelegramClaim(env: Env, claim: LinkClaim): Promise<LinkOutcome> {
  const userId = Number(claim.user_id), telegramId = String(claim.telegram_user_id ?? '');
  if (!(await memberStanding(env, userId))) return { linked: false, reason: 'member_inactive' };
  if (!claim.confirmed_at) return { linked: false, reason: 'waiting_telegram' };
  if (!claim.axal_confirmed_at) return { linked: false, reason: 'waiting_axal' };
  const details = await claimDetails(env, claim);
  if (!telegramId || !details) return { linked: false, reason: 'nothing_to_confirm' };
  const holder = await linkedMember(env, telegramId);
  if (holder && holder !== userId) return { linked: false, reason: 'identity_taken' };

  const now = new Date().toISOString();
  const guard = `EXISTS (SELECT 1 FROM channel_link_codes c JOIN users u ON u.id = c.user_id
    WHERE c.uid = ? AND c.user_id = ? AND c.telegram_user_id = ?
      AND c.confirmed_at IS NOT NULL AND c.axal_confirmed_at IS NOT NULL
      AND c.activated_at IS NULL AND c.cancelled_at IS NULL AND c.expires_at > ?
      AND COALESCE(u.is_active, 1) != 0 AND u.deletion_requested_at IS NULL)`;
  const guarded = (sql: string, values: unknown[]) => env.DB.prepare(sql).bind(...values, claim.uid, userId, telegramId, now);
  const name = details.username || details.display_name;
  try {
    await env.DB.batch([
      guarded(`DELETE FROM channel_threads WHERE integration_id IN
        (SELECT id FROM integrations WHERE user_id = ? AND provider_key = 'telegram' AND external_account_id != ?)
        AND ${guard}`, [userId, telegramId]),
      guarded(`UPDATE telegram_business_connections SET user_id = NULL, updated_at = datetime('now')
        WHERE user_id = ? AND telegram_user_id != ? AND ${guard}`, [userId, telegramId]),
      guarded(`INSERT INTO integrations (uid, user_id, provider_key, display_name, status, auth_type, config_json, external_account_id, external_account_name)
        SELECT ?, ?, 'telegram', 'Telegram', 'active', 'webhook', ?, ?, ? WHERE ${guard}
        ON CONFLICT(user_id, provider_key) DO UPDATE SET
          status = 'active', auth_type = 'webhook', display_name = 'Telegram', credentials_enc = NULL,
          external_account_id = excluded.external_account_id, external_account_name = excluded.external_account_name,
          config_json = excluded.config_json, last_error = NULL, last_error_at = NULL, updated_at = CURRENT_TIMESTAMP`,
        [hexUid(), userId, JSON.stringify({ connected_at: now }), telegramId, name]),
      guarded(`UPDATE telegram_business_connections SET user_id = ?, updated_at = datetime('now')
        WHERE telegram_user_id = ? AND ${guard}`, [userId, telegramId]),
      guarded(`UPDATE channel_link_codes SET activated_at = datetime('now'), updated_at = datetime('now')
        WHERE uid = ? AND ${guard}`, [claim.uid]),
    ]);
  } catch (err) {
    if (/UNIQUE constraint failed/i.test(err instanceof Error ? err.message : '')) return { linked: false, reason: 'identity_taken' };
    throw err;
  }
  const current = await memberLinkClaim(env, userId, claim.uid);
  const integration = await env.DB.prepare("SELECT id FROM integrations WHERE user_id = ? AND provider_key = 'telegram' AND status = 'active' AND external_account_id = ?")
    .bind(userId, telegramId).first<{ id: number }>();
  if (!current?.activated_at || !integration) return { linked: false, reason: 'nothing_to_confirm' };
  const bc = await env.DB.prepare("SELECT 1 AS ok FROM telegram_business_connections WHERE telegram_user_id = ? AND user_id = ? AND is_enabled = 1 LIMIT 1")
    .bind(telegramId, userId).first();
  return { linked: true, userId, integrationId: Number(integration.id), businessConnected: !!bc };
}

/** The private webhook proves consent only from the account that claimed it. */
export async function confirmTelegramLink(env: Env, link: InboundLinkConfirm): Promise<LinkOutcome> {
  const claim = await confirmLinkClaim(env, 'telegram', link.telegramUserId);
  if (!claim) return { linked: false, reason: 'nothing_to_confirm' };
  return activateTelegramClaim(env, claim);
}

/** The signed-in member approves the exact displayed claim, never a client-supplied identity. */
export async function confirmAxalTelegramLink(env: Env, userId: number, uid: string): Promise<LinkOutcome> {
  await activeMember(env, userId);
  const claim = await memberLinkClaim(env, userId, uid);
  if (!claim) throw new IntakeError(404, 'link_not_found', 'That Telegram link is not waiting on this Axal account.');
  if (claim.cancelled_at) throw new IntakeError(409, 'link_cancelled', 'This link was replaced or cancelled. Request a new Telegram link.');
  if (!claim.activated_at && claim.expires_at <= new Date().toISOString()) {
    throw new IntakeError(410, 'link_expired', 'Both confirmations must arrive within ten minutes. Request a new Telegram link.');
  }
  if (!claim.telegram_user_id || !(await claimDetails(env, claim))) {
    throw new IntakeError(409, 'link_not_claimed', 'Open the link in your Telegram account and check its name in Axal before confirming.');
  }
  // Idempotent even after the deadline: both owners already confirmed in time.
  if (claim.activated_at) {
    const row = await env.DB.prepare("SELECT id FROM integrations WHERE user_id = ? AND provider_key = 'telegram' AND status = 'active' AND external_account_id = ?")
      .bind(userId, claim.telegram_user_id).first<{ id: number }>();
    if (!row) return { linked: false, reason: 'nothing_to_confirm' };
    return { linked: true, userId, integrationId: Number(row.id), businessConnected: !!(await activeBusinessConnection(env, userId)) };
  }
  const updated = await env.DB.prepare(`UPDATE channel_link_codes SET axal_confirmed_at = COALESCE(axal_confirmed_at, datetime('now')), updated_at = datetime('now')
    WHERE uid = ? AND user_id = ? AND cancelled_at IS NULL AND expires_at > ? RETURNING *`)
    .bind(uid, userId, new Date().toISOString()).first<LinkClaim>();
  if (!updated) throw new IntakeError(410, 'link_expired', 'Both confirmations must arrive within ten minutes. Request a new Telegram link.');
  return activateTelegramClaim(env, updated);
}

/** What the bot says in the member's private chat. Plain sentences; never a code or a token. */
export const TELEGRAM_COPY = {
  /** Step one of linking: names the Axal account and waits for this Telegram account's own /confirm. */
  confirm: (account: string | null) => `This link would connect your Telegram account to the Axal account ${account ?? 'that made it'}. `
    + 'Axal would then receive the customer chats you let this bot see in Telegram Business. '
    + 'If that is your Axal account and you asked for this, send /confirm here within 10 minutes. '
    + 'Also confirm the claimed Telegram account in Axal › Account › Connectors within the same ten minutes. If not, ignore this message: nothing is linked.',
  waitingAxal: 'Telegram confirmed. In Axal, open Account › Connectors, check the claimed Telegram name and @username, and press Confirm before this ten-minute link expires. Nothing is linked until both owners confirm.',
  waitingTelegram: 'Confirm in Telegram by sending /confirm to the Axal bot before this ten-minute link expires.',
  linked: 'Your Telegram account is now linked to Axal. Next, in Telegram open Settings › Telegram Business › Chatbots, add this bot, and choose the chats it can see.',
  linkedConnected: 'Your Telegram account is now linked to Axal. Conversations from the chats this bot can see will wait in Axal › Interviews until you assign them.',
  nothingToConfirm: 'There is no link waiting for you to confirm, or it is more than 10 minutes old. In Axal, open Account › Connectors and press Link Telegram for a new one.',
  codeInvalid: 'That link has expired or was already used. In Axal, open Account › Connectors and press Link Telegram for a new one.',
  identityTaken: 'This Telegram account is already linked to another Axal account. Disconnect it there first, then try again.',
  memberInactive: 'The Axal account behind that link is no longer active.',
  linkPrompt: 'Axal received your Telegram Business connection, but this Telegram account is not linked to an Axal account yet. In Axal, open Account › Connectors and press Link Telegram. Nothing from your chats is stored until you do.',
  test: 'This is a test message from Axal. Your Telegram account is connected.',
  /** The answer to Telegram's "manage this chat" button (`/start bizChat<id>`), D756. */
  manageChat: 'To manage this chat, open Axal › Interviews.',
  /**
   * D756 §1.7 — the consent notice v1, in the founder's voice (it is sent on
   * behalf of the business account). New words are a new version
   * (consentNotice.ts). `name` is the interviewee's first name.
   */
  consentNotice: (name: string | null, venture: string | null, url: string) => `Hi ${name || 'there'}. `
    + `I'd like to record this chat for my customer research at ${venture || 'my venture'}. `
    + 'Your messages here, and the voice notes, audio files and round videos you have sent or send here, '
    + 'will be saved and transcribed in Axal VC, the platform I use, and kept until I delete them. '
    + `How it works: ${url} — Reply YES to agree or NO to decline. You can reply STOP at any time.`,
  /** The one line each counted answer gets, only with the reply right (§1.7). */
  consentYes: (venture: string | null) => `Thank you. This chat is now recorded for ${venture ? `${venture}'s` : 'my venture\'s'} research. Reply STOP at any time.`,
  consentNo: 'Understood. Nothing from this chat will be recorded.',
  consentStop: 'Understood. Recording has stopped for this chat. To have what was already recorded deleted, just ask me.',
} as const;

// ---------------------------------------------------------------------------
// Talking to Telegram
// ---------------------------------------------------------------------------

type CallResult =
  | { ok: true; result: any }
  | { ok: false; code: string; retryable: boolean; status: number; retryAfterSec?: number };

/** Bot API 10.3: a 429's `parameters.retry_after`, "the number of seconds left to wait". Only a positive finite number counts. */
function retryAfter(data: any): { retryAfterSec?: number } {
  const n = Number(data?.parameters?.retry_after);
  return Number.isFinite(n) && n > 0 ? { retryAfterSec: n } : {};
}

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
  return { ok: false, ...f, status, ...retryAfter(data) };
}

function sendResult(r: CallResult, chatId: string): SendResult {
  if (!r.ok) return { ok: false, code: r.code, retryable: r.retryable, ...(r.retryAfterSec ? { retryAfterSec: r.retryAfterSec } : {}) };
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

/**
 * D756 §1.5 (a) — Axal's consent notice in a customer chat, on the member's
 * business connection. Refused before any call when the bot is switched off
 * for the account (`connection_disabled`), there is none (`not_connected`),
 * or it may not reply (`no_reply_right`). The window and the cap are the
 * caller's (consent.ts).
 */
export async function sendConsentNotice(env: Env, userId: number, chatId: string, text: string): Promise<SendResult> {
  const bc = await activeBusinessConnection(env, userId);
  if (!bc) {
    const any = await env.DB.prepare('SELECT 1 AS hit FROM telegram_business_connections WHERE user_id = ? LIMIT 1').bind(userId).first();
    return { ok: false, code: any ? 'connection_disabled' : 'not_connected' };
  }
  if (!bc.canReply) return { ok: false, code: 'no_reply_right' };
  return sendBusinessMessage(env, bc.businessConnectionId, chatId, text);
}

/** A message in the member's own private chat with the bot (link prompts, confirmations, the test). */
export async function sendPrivateMessage(env: Env, chatId: string, text: string): Promise<SendResult> {
  const r = await call(env, 'sendMessage', { chat_id: chatId, text, link_preview_options: { is_disabled: true } });
  return sendResult(r, chatId);
}

export type AudioResult =
  | { ok: true; bytes: Uint8Array; mime: string }
  | { ok: false; code: string; retryable: boolean; retryAfterSec?: number };

/** A voice note's audio: getFile, then the file URL. Refused above 20 MB, before and after download. */
export async function fetchTelegramVoice(env: Env, fileId: string, mimeHint: string | null = null): Promise<AudioResult> {
  const meta = await call(env, 'getFile', { file_id: fileId });
  if (!meta.ok) return { ok: false, code: meta.code, retryable: meta.retryable, ...(meta.retryAfterSec ? { retryAfterSec: meta.retryAfterSec } : {}) };
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

// ---------------------------------------------------------------------------
// The Super Admin's health read (D756 §1.2)
// ---------------------------------------------------------------------------

/** Every code `readTelegramHealth` can raise, in the order it lists them. */
export const TELEGRAM_HEALTH_ISSUES = [
  'token_rejected', 'telegram_unreachable', 'business_mode_off', 'username_mismatch', 'same_bot_as_news',
  'base_url_missing', 'webhook_unregistered', 'webhook_elsewhere', 'updates_stale', 'delivery_error',
] as const;
export type TelegramHealthIssue = typeof TELEGRAM_HEALTH_ISSUES[number];

type Unreached = { reachable: false; error: 'token_rejected' | 'telegram_unreachable' };

export interface TelegramHealth {
  ready: boolean;
  issues: TelegramHealthIssue[];
  bot: { reachable: true; business_mode: boolean; username_matches: boolean; separate_from_news_bot: boolean } | Unreached;
  webhook: {
    reachable: true; registered: boolean; url_matches: boolean; pending_update_count: number;
    last_error_at: string | null; last_error: string | null; allowed_updates_match: boolean;
  } | Unreached;
}

/** A delivery error older than this is still shown, but does not block `ready`. */
const DELIVERY_ERROR_RECENT_MS = 24 * 60 * 60 * 1000;
const LAST_ERROR_MAX_CHARS = 200;

/** 401, 404 or 403: Telegram refused the token. Anything else that failed: it did not answer usefully. */
const unreached = (r: CallResult & { ok: false }): Unreached => ({
  reachable: false,
  error: r.status === 401 || r.status === 404 || r.status === 403 ? 'token_rejected' : 'telegram_unreachable',
});

/** A Telegram username, compared as Telegram does: no leading @, any case. */
const usernameKey = (v: unknown) => String(v ?? '').trim().replace(/^@/, '').toLowerCase();

/** The bot id in front of a token's `:`, or null. */
const botIdOf = (token: unknown) => /^(\d+):/.exec(String(token ?? '').trim())?.[1] ?? null;

/**
 * Telegram's error text as safe to show: control characters removed, the bot
 * tokens, the webhook secret and anything shaped like `bot<digits>:<token>`
 * replaced by •••, then clipped. Null when there is no text.
 */
function scrubTelegramError(env: Env, text: unknown): string | null {
  let out = String(text ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ');
  for (const secret of [env.TELEGRAM_CHANNEL_BOT_TOKEN, env.TELEGRAM_CHANNEL_WEBHOOK_SECRET, env.TELEGRAM_BOT_TOKEN]) {
    const v = String(secret ?? '').trim();
    if (v) out = out.split(v).join('•••');
  }
  out = out.replace(/bot\d+:[A-Za-z0-9_-]+/g, '•••').replace(/\d{5,}:[A-Za-z0-9_-]{20,}/g, '•••').trim();
  return out ? out.slice(0, LAST_ERROR_MAX_CHARS) : null;
}

/**
 * Whether the interview bot and its webhook are set up as Axal needs them:
 * `getMe` and `getWebhookInfo`, in parallel, through `call()` (10 s each).
 * Returns codes and numbers only: never the token, the secret, the URL
 * Telegram reports, either bot id or the bot's username. `expectedUrl` is the
 * address the admin POST registers, or null when there is none.
 */
export async function readTelegramHealth(env: Env, expectedUrl: string | null, now = Date.now()): Promise<TelegramHealth> {
  const [me, info] = await Promise.all([call(env, 'getMe', {}), call(env, 'getWebhookInfo', {})]);
  const issues = new Set<TelegramHealthIssue>();

  let bot: TelegramHealth['bot'];
  if (!me.ok) {
    bot = unreached(me);
    issues.add(bot.error);
  } else {
    const newsBot = botIdOf(env.TELEGRAM_BOT_TOKEN);
    bot = {
      reachable: true,
      business_mode: me.result?.can_connect_to_business === true,
      username_matches: !!usernameKey(me.result?.username) && usernameKey(me.result?.username) === usernameKey(env.TELEGRAM_CHANNEL_BOT_USERNAME),
      separate_from_news_bot: !newsBot || idStr(me.result?.id) !== newsBot,
    };
    if (!bot.business_mode) issues.add('business_mode_off');
    if (!bot.username_matches) issues.add('username_mismatch');
    if (!bot.separate_from_news_bot) issues.add('same_bot_as_news');
  }

  let webhook: TelegramHealth['webhook'];
  if (!info.ok) {
    webhook = unreached(info);
    issues.add(webhook.error);
  } else {
    const r = obj(info.result) ?? {};
    const url = typeof r.url === 'string' ? r.url.trim() : '';
    const allowed = Array.isArray(r.allowed_updates) ? r.allowed_updates.map(String) : null;
    const want = new Set<string>(TELEGRAM_ALLOWED_UPDATES);
    // No list means Telegram's default, which leaves out types Axal does not
    // read and includes ones it does not ask for: never a match.
    const allowedMatch = !!allowed && allowed.length === want.size && new Set(allowed).size === want.size && allowed.every((t) => want.has(t));
    const errorDate = Number(r.last_error_date);
    const lastErrorAt = Number.isFinite(errorDate) && errorDate > 0 ? new Date(errorDate * 1000).toISOString() : null;
    webhook = {
      reachable: true,
      registered: !!url,
      url_matches: !!url && !!expectedUrl && url === expectedUrl,
      pending_update_count: Number.isFinite(Number(r.pending_update_count)) ? Math.max(0, Math.trunc(Number(r.pending_update_count))) : 0,
      last_error_at: lastErrorAt,
      last_error: lastErrorAt ? scrubTelegramError(env, r.last_error_message) : null,
      allowed_updates_match: allowedMatch,
    };
    if (!expectedUrl) issues.add('base_url_missing');
    if (!url) issues.add('webhook_unregistered');
    else if (expectedUrl && url !== expectedUrl) issues.add('webhook_elsewhere');
    if (url && !allowedMatch) issues.add('updates_stale');
    if (lastErrorAt && now - errorDate * 1000 < DELIVERY_ERROR_RECENT_MS) issues.add('delivery_error');
  }

  const list = TELEGRAM_HEALTH_ISSUES.filter((i) => issues.has(i));
  return { ready: list.length === 0, issues: list, bot, webhook };
}
