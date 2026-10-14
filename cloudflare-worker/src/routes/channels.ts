/**
 * D684 (#1576) — interview channels: a member's business Telegram and
 * business WhatsApp. Customer conversations arrive as threads, pending until
 * the member assigns one to an interview (services/channels/threads.ts).
 *
 * Mounted by index.ts (S01):
 *   /api/channels        → this file's default export
 *   /api/admin/channels  → `channelsAdmin`
 *
 * Signed in (requireAuth in every handler):
 *   GET    /                        availability per provider, the member's connections, pending counts
 *   POST   /telegram/link           a one-time code and its t.me link
 *   POST   /whatsapp/connect        finish Embedded Signup: { code, waba_id, phone_number_id }
 *   DELETE /:provider               disconnect (telegram | whatsapp)
 *   POST   /:provider/test          Telegram: a message in the member's own chat with the bot.
 *                                   WhatsApp: read the number with the member's token — a test
 *                                   never messages one of the member's customers.
 *   GET    /threads?status=         the member's conversations
 *   GET    /threads/:uid            one conversation; its pending messages, decrypted for the member only;
 *                                   a waiting voice note carries `transcription_failure` (#1586)
 *   POST   /threads/:uid/assign     { interview_id } | { create: { interviewee_name, interviewee_company?, project_id } },
 *                                   and quote_consent?: true (D685 §5.1.4)
 *   POST   /threads/:uid/ignore     { ignored?: boolean } (default true)
 *   POST   /threads/:uid/reply      { text, client_key }: once per client_key, inside the 24 h window
 *   POST   /threads/:uid/voice/:message/retry  a waiting voice note again, once what stopped it allows (#1586)
 *
 * Public — each verified by its provider's own secret, outside requireAuth:
 *   POST   /telegram/webhook        X-Telegram-Bot-Api-Secret-Token
 *   GET    /whatsapp/webhook        hub.verify_token challenge
 *   POST   /whatsapp/webhook        X-Hub-Signature-256 over the raw body
 *
 * Admin (`channelsAdmin`, super admin):
 *   POST   /telegram/webhook        setWebhook with secret_token and the business update types
 *
 * A WEBHOOK PERSISTS, THEN ACKNOWLEDGES (D684 §11). Verify what a header can
 * prove before reading the body (Telegram's secret) → read the body under its
 * size cap, counting bytes as they arrive → verify what needs the body
 * (WhatsApp's signature; 503 when a secret is unset: fail closed) → parse →
 * claim the event (a redelivery answers 200 and does nothing) → resolve the
 * connection (none: 'ignored', 200) → the member must still be active → the
 * per-connection limit (a D1 counter) → store → finish → 200. A failure before
 * anything was stored releases the claim and answers 500, so the provider
 * retries.
 *
 * A VOICE NOTE SPENDS NOTHING UNTIL THE MEMBER CHOSE THE CHAT. It is stored as
 * a placeholder with no text (threads.ts). Only on a chat already in an
 * interview is it queued at once (`channel_followup`, ids only); a pending
 * chat's notes are queued when the member assigns it. The job below
 * transcribes with the interview sessions' own speech-to-text, under the
 * connection's daily cap (D1, fails closed) and the member's AI budget (D640).
 * Only the text is kept; the audio is never stored.
 *
 * A TELEGRAM LINK TAKES TWO MESSAGES: `/start <code>` names the Telegram
 * account, and that account's own `/confirm` plus the member's Confirm in Axal
 * must both arrive within the original ten-minute code lifetime.
 *
 * Nothing here returns or logs message text, a phone number, a token or a
 * platform secret. Refusals carry a code and a sentence we wrote.
 */
import { Hono, type Context } from 'hono';
import type { Env, User } from '../types';
import { requireAuth, requireSuperAdmin } from '../auth';
import { refuse } from '../util/refusal';
import { run as aiRun, audioMinutesFromBytes } from '../services/aiRouter';
import { AI_SURFACE } from '../services/aiSurfaces';
import { IntakeError, activeMember } from '../services/interviewIntake';
import {
  claimEvent, connectionOverLimit, linkAttemptOverLimit, finishEvent, finishEventStatement, readCappedBody, releaseEvent, reserveTranscription,
  type EventFields, type EventKind, type EventStatus,
} from '../services/channels/events';
import {
  availability, connectionForTelegram, connectionForWhatsApp, memberConnection, providerAvailable, type ChannelConnection,
} from '../services/channels/connections';
import { createLinkCode, pendingLinkView } from '../services/channels/linkCodes';
import { beginOutbound, finishOutbound, applyDeliveryStatus, type OutboundRow } from '../services/channels/outbound';
import {
  applyDelete, applyEdit, assignThread, forgetConnection, inInterview, listThreads, noteVoiceTry, queueVoiceTranscriptions, readThread,
  releaseVoiceNote, setThreadIgnored, storeInbound, storeMessage, storeVoiceNote, storeVoiceTranscript, threadForReply,
  voiceNoteForJob, type AssignTarget, type ThreadRow,
} from '../services/channels/threads';
import { enqueueChannelJob, registerChannelJob, type ChannelJobPayload } from '../services/channels/jobs';
import * as zoom from '../services/channels/zoom';
import * as meet from '../services/channels/googleMeet';
import {
  VOICE_RETRY_DELAYS, VOICE_TRIES, retryVoiceNote, transcriptionFailures,
} from '../services/channels/voiceFailures';
import {
  CHANNEL_LIMITS, type InboundEvent, type InboundLink, type InboundLinkConfirm, type InboundMessage, type MessagingProvider,
  type SendResult,
} from '../services/channels/types';
import * as telegram from '../services/channels/telegram';
import * as whatsapp from '../services/channels/whatsapp';

const channels = new Hono<{ Bindings: Env }>();
export const channelsAdmin = new Hono<{ Bindings: Env }>();

type C = Context<{ Bindings: Env }>;

const MESSAGING = new Set<string>(['telegram', 'whatsapp']);
const THREAD_STATUSES = new Set(['pending', 'assigned', 'ignored']);

/** Our sentence for each code a route or a provider call can end in. */
const SENTENCE: Record<string, string> = {
  link_limit_unavailable: 'Axal cannot check link attempts right now. Wait a moment and try again; nothing was linked.',
  not_available: 'This channel is not available on Axal yet.',
  not_configured: 'This channel is not set up on Axal yet.',
  identity_taken: 'This Telegram account is already linked to another Axal account. Disconnect it there first.',
  link_cancelled: 'This Telegram link was replaced or cancelled. Request a new link.',
  not_connected: 'Connect this account in Account › Connectors first.',
  unknown_provider: 'That is not a messaging channel Axal connects.',
  rate_limited: 'Too many attempts right now. Try again in a little while.',
  window_closed: 'More than 24 hours have passed since this conversation was last active, so a free-form reply is closed. Templates are a later step; nothing was sent.',
  no_reply_right: 'The Axal bot is not allowed to reply on this Telegram Business account. Allow replies for the bot in Telegram › Settings › Telegram Business › Chatbots.',
  thread_ignored: 'This conversation is ignored. Stop ignoring it before replying.',
  text_required: 'Write a message first.',
  text_too_long: 'That message is too long for this channel.',
  client_key_required: 'The reply is missing its client key.',
  client_key_conflict: 'That client key was already used for another reply.',
  send_in_flight: 'This message is still being sent. Check the conversation again in a moment; pressing Send again will not send it twice.',
  send_unknown: 'Axal could not confirm whether this message went out. Check the chat in Telegram or WhatsApp before writing it again.',
  forbidden: 'The provider refused the message for this account.',
  token_invalid: 'The connection to this account has expired. Connect it again in Account › Connectors.',
  undeliverable: 'The provider could not deliver this message.',
  provider_unavailable: 'The provider did not answer. Try again in a minute.',
  network: 'The provider could not be reached. Try again in a minute.',
  rejected: 'The provider rejected the message.',
  unexpected_response: 'The provider answered in a way Axal did not expect. Nothing was recorded.',
  invalid_request: 'The request is missing a field it needs.',
  invalid_status: 'Choose pending, assigned or ignored.',
  number_taken: 'This WhatsApp number is already connected to another Axal account.',
  number_not_in_waba: 'That number is not part of the WhatsApp Business account you connected.',
  choose_number: 'Your WhatsApp Business account has more than one number. Connect again and choose the number your customers write to.',
  code_exchange_failed: 'Meta did not accept the sign-up. Start the WhatsApp connection again.',
  waba_unreadable: 'Axal could not read your WhatsApp Business account. Start the connection again.',
  subscribe_failed: 'Axal could not subscribe to your WhatsApp Business account. Try again.',
  not_stored: 'The connection could not be saved. Try again.',
  base_url_missing: 'The public base URL is not set, so there is no webhook address to register.',
  secret_format: 'TELEGRAM_CHANNEL_WEBHOOK_SECRET may use only letters, digits, _ and -, up to 256 characters.',
};
const sentence = (code: string) => SENTENCE[code] ?? 'That did not work. Try again.';

/** A refusal with our sentence; `code` travels on `error` and `code` both. */
function no(c: C, status: number, code: string, extra: Record<string, unknown> = {}): Response {
  return refuse(c, status, { code, message: sentence(code), extra: { code, ...extra } });
}

/**
 * An IntakeError carries a sentence services/ wrote (interviewIntake.ts,
 * threads.ts) — never provider or SQLite text — so it travels as is.
 */
function intakeRefusal(c: C, err: IntakeError): Response {
  const { code, message: said } = err;
  return refuse(c, err.status, { code, message: said, extra: { code } });
}

/** A signed-in route: an IntakeError becomes its own status and sentence. */
function member(handler: (c: C, user: User) => Promise<Response>) {
  return async (c: C): Promise<Response> => {
    const user = await requireAuth(c);
    try {
      return await handler(c, user);
    } catch (err) {
      if (err instanceof IntakeError) return intakeRefusal(c, err);
      throw err;
    }
  };
}

const parseJson = (s: string | null): Record<string, unknown> => {
  if (!s) return {};
  try { const v = JSON.parse(s); return v && typeof v === 'object' && !Array.isArray(v) ? v : {}; } catch { return {}; }
};

/** A D1 or ISO timestamp, in ms; NaN when unreadable. */
const ms = (s: string | null | undefined) => (s ? Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? s : `${s.replace(' ', 'T')}Z`) : NaN);

// ---------------------------------------------------------------------------
// Availability and connections
// ---------------------------------------------------------------------------

channels.get('/', member(async (c, user) => {
  const env = c.env;
  // Secret NAMES help an admin set a deployment up; a member learns only "not available".
  const admin = String(user.role ?? '').toLowerCase() === 'admin';
  const providers = availability(env).map((a) => ({
    provider: a.provider,
    available: a.available,
    missing: admin ? a.missing : [],
    // Public identifiers Meta's JS SDK needs in the browser to open Embedded Signup.
    ...(a.provider === 'whatsapp' && a.available
      ? { signup: { app_id: env.WHATSAPP_APP_ID, config_id: env.WHATSAPP_EMBEDDED_SIGNUP_CONFIG_ID } }
      : {}),
  }));

  const rows = (await env.DB.prepare(
    `SELECT provider_key, status, external_account_name, config_json, created_at FROM integrations
      WHERE user_id = ? AND provider_key IN ('telegram', 'whatsapp') AND status != 'disconnected'`,
  ).bind(user.id).all<{ provider_key: string; status: string; external_account_name: string | null; config_json: string | null; created_at: string }>()).results ?? [];
  const tg = await env.DB.prepare(
    `SELECT COUNT(*) AS n, MAX(can_reply) AS r FROM telegram_business_connections WHERE user_id = ? AND is_enabled = 1`,
  ).bind(user.id).first<{ n: number; r: number | null }>();
  const connections: Record<string, unknown> = {};
  for (const r of rows) {
    const cfg = parseJson(r.config_json);
    const base = {
      status: r.status,
      // Telegram: '@username' or a name. WhatsApp: the verified business name or '•••• 1234' — never an id.
      external_account_name: r.external_account_name,
      connected_at: typeof cfg.connected_at === 'string' ? cfg.connected_at : r.created_at,
    };
    connections[r.provider_key] = r.provider_key === 'telegram'
      // Linked is step one; the bot added in Telegram Business is step two.
      ? { ...base, can_reply: !!tg?.r, business_connected: Number(tg?.n ?? 0) > 0 }
      // #1586: what WhatsApp Calling would need for this number, and why it is not yet (no calling is built).
      : { ...base, can_reply: r.status === 'active', calls: whatsapp.callingEligibility(cfg) };
  }
  const [zoomConn, meetConn] = await Promise.all([
    zoom.zoomConnection(env, user.id), meet.googleConnection(env, user.id),
  ]);
  if (zoomConn) connections.zoom = { status: 'active' };
  if (meetConn) connections.google_meet = { status: 'active', transcript_access: meet.transcriptAccess(meetConn) };

  const counts = (await env.DB.prepare(
    `SELECT t.provider AS provider, COUNT(*) AS n FROM channel_threads t
       JOIN integrations i ON i.id = t.integration_id AND i.status = 'active'
      WHERE t.user_id = ? AND t.status = 'pending' GROUP BY t.provider`,
  ).bind(user.id).all<{ provider: string; n: number }>()).results ?? [];
  const pending = { telegram: 0, whatsapp: 0 } as Record<MessagingProvider, number>;
  for (const r of counts) if (r.provider === 'telegram' || r.provider === 'whatsapp') pending[r.provider] = Number(r.n) || 0;

  return c.json({ providers, connections, pending, telegram_link: await pendingLinkView(env, user.id) });
}));

channels.post('/telegram/link', member(async (c, user) => {
  if (!providerAvailable(c.env, 'telegram')) return no(c, 503, 'not_available');
  const ip = c.req.header('cf-connecting-ip') || (c.req.header('x-forwarded-for') || '').split(',')[0].trim() || 'unknown';
  await activeMember(c.env, user.id);
  try {
    if (await linkAttemptOverLimit(c.env, `ip:${ip}`, 20)) return no(c, 429, 'rate_limited');
  } catch { return no(c, 503, 'link_limit_unavailable'); }
  const { code, expiresAt } = await createLinkCode(c.env, user.id, 'telegram');
  const bot = String(c.env.TELEGRAM_CHANNEL_BOT_USERNAME ?? '').trim().replace(/^@/, '');
  return c.json({ code, url: `https://t.me/${encodeURIComponent(bot)}?start=${code}`, expires_at: expiresAt });
}));


channels.get('/telegram/link', member(async (c, user) => {
  await activeMember(c.env, user.id);
  return c.json({ claim: await pendingLinkView(c.env, user.id) });
}));

channels.post('/telegram/link/:uid/confirm', member(async (c, user) => {
  const out = await telegram.confirmAxalTelegramLink(c.env, user.id, c.req.param('uid') ?? '');
  if (!out.linked && out.reason === 'member_inactive') return no(c, 403, 'member_inactive');
  if (!out.linked && out.reason === 'identity_taken') return no(c, 409, 'identity_taken');
  if (!out.linked && out.reason === 'nothing_to_confirm') return no(c, 409, 'link_cancelled');
  return c.json({ ok: true, linked: out.linked, claim: await pendingLinkView(c.env, user.id, c.req.param('uid') ?? '') });
}));

channels.post('/whatsapp/connect', member(async (c, user) => {
  if (!providerAvailable(c.env, 'whatsapp')) return no(c, 503, 'not_available');
  const body = await c.req.json<Record<string, unknown>>().catch(() => ({} as Record<string, unknown>));
  const code = typeof body.code === 'string' ? body.code.trim() : '';
  const wabaId = String(body.waba_id ?? '').trim();
  // Coexistence's finish event may carry only the WABA; the number is then read from it.
  const phoneNumberId = body.phone_number_id == null ? '' : String(body.phone_number_id).trim();
  if (!code || code.length > 2048 || !/^\d{1,32}$/.test(wabaId) || (phoneNumberId && !/^\d{1,32}$/.test(phoneNumberId))) {
    return no(c, 400, 'invalid_request');
  }
  const out = await whatsapp.completeEmbeddedSignup(c.env, user.id, { code, wabaId, phoneNumberId });
  if (!out.ok) return no(c, out.status, out.code);
  return c.json({ ok: true, connection: { status: 'active', external_account_name: out.name, can_reply: true } });
}));

channels.delete('/:provider', member(async (c, user) => {
  const provider = c.req.param('provider') ?? '';
  if (!MESSAGING.has(provider)) return no(c, 404, 'unknown_provider');
  const env = c.env;
  if (provider === 'telegram') await env.DB.prepare("UPDATE channel_link_codes SET cancelled_at = datetime('now') WHERE user_id = ? AND provider = 'telegram' AND activated_at IS NULL").bind(user.id).run();
  const row = await env.DB.prepare(
    `SELECT id, uid, status, credentials_enc, config_json, external_account_id FROM integrations WHERE user_id = ? AND provider_key = ?`,
  ).bind(user.id, provider).first<{
    id: number; uid: string; status: string; credentials_enc: string | null; config_json: string | null; external_account_id: string | null;
  }>();
  if (!row || row.status === 'disconnected') return c.json({ ok: true, disconnected: false });
  if (provider === 'whatsapp') {
    // Stop Meta sending this account's webhooks to Axal — unless another
    // member's number shares the WABA (whatsapp.ts). Best effort: the row
    // below goes either way, and an unknown number is ignored on arrival.
    await whatsapp.unsubscribeApp(env, {
      integrationId: Number(row.id), integrationUid: row.uid, credentialsEnc: row.credentials_enc,
      config: parseJson(row.config_json), phoneNumberId: row.external_account_id,
    }).catch(() => 'failed');
  }
  await env.DB.prepare(
    `UPDATE integrations SET status = 'disconnected', credentials_enc = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
  ).bind(row.id).run();
  await forgetConnection(env, Number(row.id));
  if (provider === 'telegram') {
    await env.DB.prepare(
      `UPDATE telegram_business_connections SET user_id = NULL, updated_at = datetime('now') WHERE user_id = ?`,
    ).bind(user.id).run();
  }
  return c.json({ ok: true, disconnected: true });
}));

channels.post('/:provider/test', member(async (c, user) => {
  const provider = c.req.param('provider') ?? '';
  if (!MESSAGING.has(provider)) return no(c, 404, 'unknown_provider');
  const conn = await memberConnection(c.env, user.id, provider as MessagingProvider);
  if (!conn) return no(c, 409, 'not_connected');
  if (provider === 'whatsapp') {
    const r = await whatsapp.checkWhatsAppConnection(c.env, conn);
    return r.ok ? c.json({ ok: true, provider, sent: false }) : no(c, 502, r.code);
  }
  const row = await c.env.DB.prepare(
    `SELECT external_account_id FROM integrations WHERE id = ?`,
  ).bind(conn.integrationId).first<{ external_account_id: string | null }>();
  if (!row?.external_account_id) return no(c, 409, 'not_connected');
  // A private chat's id is its user's id, and the member opened it with /start.
  const r = await telegram.sendPrivateMessage(c.env, String(row.external_account_id), telegram.TELEGRAM_COPY.test);
  return r.ok ? c.json({ ok: true, provider, sent: true }) : no(c, r.retryable ? 503 : 502, r.code ?? 'rejected');
}));

// ---------------------------------------------------------------------------
// Threads
// ---------------------------------------------------------------------------

channels.get('/threads', member(async (c, user) => {
  const status = c.req.query('status');
  if (status && !THREAD_STATUSES.has(status)) return no(c, 400, 'invalid_status');
  const threads = await listThreads(c.env, user.id, { status: status as ThreadRow['status'] | undefined, limit: Number(c.req.query('limit')) || 50 });
  return c.json({ items: threads });
}));

channels.get('/threads/:uid', member(async (c, user) => {
  const uid = c.req.param('uid') ?? '';
  const read = await readThread(c.env, user.id, uid);
  // #1586: a waiting voice note that could not be transcribed says why, in our
  // words, with no message or provider text (services/channels/voiceFailures.ts).
  const failures = await transcriptionFailures(c.env, user.id, uid);
  return c.json({ ...read, messages: read.messages.map((m) => ({ ...m, transcription_failure: failures.get(m.uid) ?? null })) });
}));

/** #1586: transcribe a waiting voice note again, once what stopped it allows (the budget is checked first). */
channels.post('/threads/:uid/voice/:message/retry', member(async (c, user) => {
  const r = await retryVoiceNote(c.env, user.id, c.req.param('uid') ?? '', c.req.param('message') ?? '');
  return c.json({ ok: true, queued: r.queued });
}));

channels.post('/threads/:uid/assign', member(async (c, user) => {
  const body = await c.req.json<Record<string, any>>().catch(() => ({} as Record<string, any>));
  const create = body.create && typeof body.create === 'object' ? body.create : null;
  let target: AssignTarget;
  if (body.interview_id != null) target = { interviewId: Number(body.interview_id) };
  else if (create && Number.isInteger(Number(create.project_id))) {
    target = {
      projectId: Number(create.project_id), intervieweeName: String(create.interviewee_name ?? ''),
      // Who's company (D685 §5.3), so the lightbox's interviewee keeps it.
      intervieweeCompany: typeof create.interviewee_company === 'string' ? create.interviewee_company : null,
    };
  } else return no(c, 400, 'invalid_request');
  // Quote consent (D685 §5.1.4): only the literal true sets it.
  if (body.quote_consent != null && typeof body.quote_consent !== 'boolean') return no(c, 400, 'invalid_request');
  const r = await assignThread(c.env, user.id, c.req.param('uid') ?? '', target, { quoteConsent: body.quote_consent === true });
  return c.json({ ok: true, interview_id: r.interviewId, session_id: r.sessionId, moved: r.moved, voice_queued: r.queued });
}));

channels.post('/threads/:uid/ignore', member(async (c, user) => {
  const body = await c.req.json<Record<string, unknown>>().catch(() => ({} as Record<string, unknown>));
  const row = await setThreadIgnored(c.env, user.id, c.req.param('uid') ?? '', body.ignored !== false);
  // The row itself carries the chat id (a phone number on WhatsApp): only its status goes back.
  return c.json({ ok: true, status: row.status });
}));

const outboundView = (r: OutboundRow & { created_at?: string }) => ({
  uid: r.uid, provider: r.provider, status: r.status, error_code: r.error_code, created_at: r.created_at ?? null,
});

/** Why a free-form reply may not go now, or null. Checked before any provider call. */
function windowRefusal(thread: ThreadRow): string | null {
  // WhatsApp counts from the customer's last message; Telegram from the chat's last activity.
  const since = ms(thread.provider === 'whatsapp' ? thread.last_inbound_at : thread.last_message_at);
  return Number.isFinite(since) && Date.now() - since < CHANNEL_LIMITS.replyWindowMs ? null : 'window_closed';
}

channels.post('/threads/:uid/reply', member(async (c, user) => {
  const env = c.env;
  const body = await c.req.json<Record<string, unknown>>().catch(() => ({} as Record<string, unknown>));
  const text = typeof body.text === 'string' ? body.text.trim() : '';
  const clientKey = typeof body.client_key === 'string' ? body.client_key.trim() : '';
  if (!text) return no(c, 400, 'text_required');
  if (!clientKey || clientKey.length > 100) return no(c, 400, 'client_key_required');
  // Another member's thread is not there (404, from threads.ts).
  const thread = await threadForReply(env, user.id, c.req.param('uid') ?? '');
  const max = thread.provider === 'telegram' ? telegram.TELEGRAM_MAX_TEXT : whatsapp.WHATSAPP_MAX_TEXT;
  if (text.length > max) return no(c, 400, 'text_too_long', { max_chars: max });
  const conn = await memberConnection(env, user.id, thread.provider);
  if (!conn || conn.integrationId !== Number(thread.integration_id)) return no(c, 409, 'not_connected');

  let claim: { row: OutboundRow; existing: boolean };
  try {
    claim = await beginOutbound(env, thread.provider, user.id, thread.id, clientKey);
  } catch (err) {
    if (err instanceof Error && err.message === 'client_key_conflict') return no(c, 409, 'client_key_conflict');
    throw err;
  }
  // The same client_key again: what happened the first time, and nothing sent now.
  if (claim.existing) {
    if (claim.row.status === 'pending') {
      // The first attempt has no outcome: it is still waiting on the provider,
      // or its request was cut off before the provider answered. Nobody knows
      // it went, so it is never called sent (`ok` is neither true nor false);
      // after a minute it is reported as unknown. Nothing is sent now either.
      const age = Date.now() - ms(claim.row.created_at);
      const code = claim.row.error_code === 'send_unknown' ? 'send_unknown'
        : Number.isFinite(age) && age < 60_000 ? 'send_in_flight' : 'send_unknown';
      return c.json({ ok: null, existing: true, pending: true, code, message: sentence(code), outbound: outboundView(claim.row) });
    }
    return c.json({ ok: claim.row.status !== 'failed', existing: true, outbound: outboundView(claim.row) });
  }

  // Refused after the claim, so a retry of this client_key reads the refusal instead of sending.
  const refusal = thread.status === 'ignored' ? 'thread_ignored' : windowRefusal(thread);
  let result: SendResult;
  if (refusal) {
    result = { ok: false, code: refusal };
  } else if (thread.provider === 'telegram') {
    const bc = await telegram.activeBusinessConnection(env, user.id);
    result = !bc ? { ok: false, code: 'not_connected' }
      : !bc.canReply ? { ok: false, code: 'no_reply_right' }
      : await telegram.sendBusinessMessage(env, bc.businessConnectionId, thread.external_chat_id, text);
  } else {
    result = await whatsapp.sendWhatsAppText(env, conn, thread.external_chat_id, text);
  }
  // Once the provider has answered, nothing below may answer 5xx: the composer
  // reads a 5xx as "not sent", so a member could press Send again on a message
  // the provider already took. A failure to record the outcome is logged, and
  // a later repeat of this key reads the row as pending: never sent twice,
  // never called sent without a provider's word.
  let saved = true;
  try {
    await finishOutbound(env, claim.row.id, result);
  } catch {
    saved = false;
    console.error(`[channels] ${thread.provider} reply outcome not saved ok=${result.ok}`);
  }
  if (!result.ok && result.code === 'send_unknown') {
    // A deadline/network loss cannot tell whether the provider accepted it.
    // Return a readable unknown outcome, retaining this key and pending claim.
    return c.json({ ok: null, existing: false, pending: true, code: 'send_unknown', message: sentence('send_unknown'),
      outbound: outboundView({ ...claim.row, status: 'pending', error_code: 'send_unknown' }) });
  }
  if (!result.ok) {
    const code = result.code ?? 'rejected';
    const status = ['window_closed', 'no_reply_right', 'not_connected', 'thread_ignored'].includes(code) ? 409
      : code === 'rate_limited' ? 429 : result.retryable ? 503 : 502;
    return no(c, status, code, { retryable: !!result.retryable });
  }

  // Sent: the member's reply joins the thread (or the interview it is assigned to) as 'Me'.
  let recorded = true;
  try {
    await storeMessage(env, conn, {
      externalChatId: thread.external_chat_id, externalMessageId: String(result.externalMessageId), side: 'me',
      contactName: null, text, kind: 'text', sentAt: new Date().toISOString(), origin: 'axal',
    });
  } catch (err) {
    recorded = false;
    console.error('[channels] reply sent but not recorded', err instanceof IntakeError ? err.code : 'error');
  }
  const row = saved
    ? await env.DB.prepare('SELECT * FROM channel_outbound WHERE id = ?').bind(claim.row.id).first<OutboundRow & { created_at: string }>()
      .catch(() => null)
    : null;
  // The provider accepted it: that is 'submitted', whether or not the row could say so.
  return c.json({ ok: true, existing: false, recorded, outbound: outboundView(row ?? { ...claim.row, status: 'submitted' }) });
}));

// ---------------------------------------------------------------------------
// Webhooks
// ---------------------------------------------------------------------------

/** The raw body, or the 413 that refuses it — before anything parses it (`readCappedBody`). */
async function cappedBody(c: C): Promise<ArrayBuffer | Response> {
  const raw = await readCappedBody(c.req.raw);
  return raw ?? c.json({ error: 'payload_too_large', code: 'payload_too_large' }, 413);
}

function parseBody(raw: ArrayBuffer): unknown {
  try { return JSON.parse(new TextDecoder().decode(raw)); } catch { return undefined; }
}

function eventKind(ev: InboundEvent): EventKind {
  switch (ev.kind) {
    case 'message': return ev.voice && !ev.text ? 'voice' : ev.side === 'me' ? 'echo' : 'message';
    case 'edit': return 'edit';
    case 'delete': return 'delete';
    case 'status': return 'status';
    case 'link': case 'link_confirm': return 'link';
    case 'connection': return 'connection';
    default: return 'ignored';
  }
}

/** A message for the member's private chat with the bot. A failure is logged and never fails the webhook. */
async function tell(env: Env, chatId: string, text: string): Promise<void> {
  const r = await telegram.sendPrivateMessage(env, chatId, text).catch(() => ({ ok: false, code: 'network' } as SendResult));
  if (!r.ok) console.error(`[channels] telegram notice not sent code=${r.code ?? 'unknown'}`);
}

/**
 * `/start <code>` (step one) or `/confirm` (step two) — telegram.ts explains
 * the two steps. Attempts are limited per Telegram account: the webhook's
 * caller is Telegram, so the account, not an IP, is who is guessing.
 */
async function handleLink(env: Env, claim: number, ev: InboundLink | InboundLinkConfirm): Promise<void> {
  try {
    if (await linkAttemptOverLimit(env, `telegram:${ev.telegramUserId}`, 10)) {
      await finishEvent(env, claim, 'ignored', { error: 'rate_limited' });
      await tell(env, ev.chatId, sentence('rate_limited'));
      return;
    }
  } catch {
    await finishEvent(env, claim, 'ignored', { error: 'link_limit_unavailable' });
    await tell(env, ev.chatId, sentence('link_limit_unavailable'));
    return;
  }
  const copy = telegram.TELEGRAM_COPY;
  if (ev.kind === 'link') {
    const out = await telegram.claimTelegramLink(env, ev);
    if (out.claimed) {
      await finishEvent(env, claim, 'done', { userId: out.userId });
      await tell(env, ev.chatId, copy.confirm(out.account));
      return;
    }
    await finishEvent(env, claim, 'ignored', { error: out.reason });
    await tell(env, ev.chatId, out.reason === 'identity_taken' ? copy.identityTaken
      : out.reason === 'member_inactive' ? copy.memberInactive : copy.codeInvalid);
    return;
  }
  const out = await telegram.confirmTelegramLink(env, ev);
  if (out.linked) {
    await finishEvent(env, claim, 'done', { userId: out.userId });
    await tell(env, ev.chatId, out.businessConnected ? copy.linkedConnected : copy.linked);
    return;
  }
  if (out.reason === 'waiting_axal' || out.reason === 'waiting_telegram') {
    await finishEvent(env, claim, 'done');
    await tell(env, ev.chatId, out.reason === 'waiting_axal' ? copy.waitingAxal : copy.waitingTelegram);
    return;
  }
  await finishEvent(env, claim, 'ignored', { error: out.reason });
  await tell(env, ev.chatId, out.reason === 'identity_taken' ? copy.identityTaken
    : out.reason === 'member_inactive' ? copy.memberInactive : copy.nothingToConfirm);
}

function resolveConnection(env: Env, provider: MessagingProvider, ref: string): Promise<ChannelConnection | null> {
  return provider === 'telegram' ? connectionForTelegram(env, ref) : connectionForWhatsApp(env, ref);
}

/** The member behind a connection must still stand; an inactive one is ignored, not retried. */
async function memberStands(env: Env, userId: number): Promise<boolean> {
  try {
    await activeMember(env, userId);
    return true;
  } catch (err) {
    if (err instanceof IntakeError) return false;
    throw err;
  }
}

/**
 * One verified event, start to finish. 'retry' means nothing was stored and
 * the claim was released: the caller answers 500 so the provider sends it again.
 */
async function processEvent(env: Env, ev: InboundEvent): Promise<'ok' | 'retry'> {
  if (ev.kind === 'ignored') return 'ok';
  const claim = await claimEvent(env, ev.provider, ev.eventId, eventKind(ev));
  if (!claim) return 'ok';
  let stored = false;
  const finish = async (status: EventStatus, fields: Parameters<typeof finishEvent>[3] = {}) => {
    stored = true;
    await finishEvent(env, claim, status, fields);
  };
  try {
    if (ev.kind === 'link' || ev.kind === 'link_confirm') {
      // A link code (and its confirmation) is spent by its first attempt, so a
      // failure here is not retried (a retry could only say "expired"): the
      // member asks for a new code.
      stored = true;
      await handleLink(env, claim, ev);
      return 'ok';
    }
    if (ev.kind === 'connection') {
      const { userId } = await telegram.recordBusinessConnection(env, ev);
      await finish('stored', { userId });
      // Not linked yet: tell them how. Nothing else from the connection is kept.
      if (ev.isEnabled && !userId) await tell(env, ev.userChatId, telegram.TELEGRAM_COPY.linkPrompt);
      return 'ok';
    }

    const conn = await resolveConnection(env, ev.provider as MessagingProvider, ev.connectionRef);
    if (!conn) { await finish('ignored', { error: 'unknown_connection' }); return 'ok'; }
    if (!(await memberStands(env, conn.userId))) { await finish('ignored', { userId: conn.userId, error: 'member_inactive' }); return 'ok'; }
    if (await connectionOverLimit(env, conn.integrationId)) {
      await finish('ignored', { userId: conn.userId, error: 'rate_limited' });
      return 'ok';
    }

    if (ev.kind === 'status') {
      const known = await applyDeliveryStatus(env, ev.externalMessageId, ev.status, ev.errorCode);
      await finish(known ? 'done' : 'ignored', { userId: conn.userId, error: known ? null : 'not_ours' });
      return 'ok';
    }
    if (ev.kind === 'edit') {
      const changed = await applyEdit(env, conn, ev);
      await finish(changed ? 'done' : 'ignored', { userId: conn.userId, error: changed ? null : 'no_pending_copy' });
      return 'ok';
    }
    if (ev.kind === 'delete') {
      const removed = await applyDelete(env, conn, ev);
      await finish(removed ? 'done' : 'ignored', { userId: conn.userId, error: removed ? null : 'no_pending_copy' });
      return 'ok';
    }

    const msg = ev as InboundMessage;
    if (msg.voice && !msg.text) {
      // A placeholder now: no text, the file ref encrypted on its row. The
      // audio is fetched and transcribed later, off this request, and only for
      // a chat in an interview — a pending chat's note waits for the member to
      // assign it, so a stranger's voice note spends nothing (threads.ts).
      const out = await storeVoiceNote(env, conn, msg);
      stored = true;
      if (out.stored !== 'voice') {
        await finish('ignored', { userId: conn.userId, threadId: out.thread.id, error: out.stored === 'ignored' ? 'thread_ignored' : 'duplicate' });
        return 'ok';
      }
      await finish('stored', { userId: conn.userId, threadId: out.thread.id });
      if (inInterview(out.thread)) await queueVoiceTranscriptions(env, out.thread, { only: out.messageUid, event: claim });
      return 'ok';
    }

    const out = await storeInbound(env, conn, msg);
    stored = true;
    const kept = out.stored === 'pending' || out.stored === 'session';
    await finish(kept ? 'stored' : 'ignored', {
      userId: conn.userId, threadId: out.thread?.id ?? null,
      sessionId: out.stored === 'session' ? out.sessionId : null,
      error: kept ? null : out.stored === 'ignored' ? 'thread_ignored' : out.stored,
    });
    return 'ok';
  } catch (err) {
    if (err instanceof IntakeError && err.status < 500) {
      // A refusal from the intake (an inactive member, a malformed chat id): retrying changes nothing.
      await finishEvent(env, claim, err.status === 403 ? 'ignored' : 'failed', { error: err.code }).catch(() => {});
      return 'ok';
    }
    console.error(`[channels] ${ev.provider} ${ev.kind} event failed stored=${stored}`, err instanceof Error ? err.name : 'error');
    if (!stored) {
      await releaseEvent(env, claim).catch(() => {});
      return 'retry';
    }
    await finishEvent(env, claim, 'failed', { error: 'internal' }).catch(() => {});
    return 'ok';
  }
}

channels.post('/telegram/webhook', async (c) => {
  // The secret is a header: a caller without it is refused before one byte of the body is read.
  const check = await telegram.verifyTelegramSecret(c.env, c.req.header('X-Telegram-Bot-Api-Secret-Token'));
  if (check === 'unconfigured') return c.json({ error: 'not_configured', code: 'not_configured' }, 503);
  if (check !== 'ok') return c.json({ error: 'unauthorized', code: 'unauthorized' }, 401);
  const raw = await cappedBody(c);
  if (raw instanceof Response) return raw;
  const update = parseBody(raw);
  if (update === undefined) return c.json({ error: 'malformed', code: 'malformed' }, 400);
  const bcId = telegram.telegramBusinessConnectionId(update);
  const owner = bcId ? await telegram.businessConnectionOwner(c.env, bcId) : null;
  const verdict = await processEvent(c.env, telegram.normaliseTelegramUpdate(update, owner));
  return verdict === 'retry' ? c.json({ error: 'retry', code: 'retry' }, 500) : c.json({ ok: true });
});

channels.get('/whatsapp/webhook', async (c) => {
  const r = await whatsapp.verifyWhatsAppChallenge(c.env, c.req.query('hub.mode'), c.req.query('hub.verify_token'), c.req.query('hub.challenge'));
  if (r.status === 200) return c.text(r.challenge, 200);
  return r.status === 503
    ? c.json({ error: 'not_configured', code: 'not_configured' }, 503)
    : c.json({ error: 'forbidden', code: 'forbidden' }, 403);
});

channels.post('/whatsapp/webhook', async (c) => {
  const raw = await cappedBody(c);
  if (raw instanceof Response) return raw;
  const check = await whatsapp.verifyWhatsAppSignature(c.env, raw, c.req.header('X-Hub-Signature-256'));
  if (check === 'unconfigured') return c.json({ error: 'not_configured', code: 'not_configured' }, 503);
  if (check !== 'ok') return c.json({ error: 'unauthorized', code: 'unauthorized' }, 401);
  const body = parseBody(raw);
  if (body === undefined) return c.json({ error: 'malformed', code: 'malformed' }, 400);
  // One POST may carry many events; each is claimed on its own, and one that
  // must be retried does not stop the rest (their claims make the retry a no-op).
  let retry = false;
  for (const ev of whatsapp.normaliseWhatsAppPayload(body)) {
    if ((await processEvent(c.env, ev)) === 'retry') retry = true;
  }
  return retry ? c.json({ error: 'retry', code: 'retry' }, 500) : c.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Voice notes: the queued follow-up
// ---------------------------------------------------------------------------

/** Refusals from the router that retrying would not change: the member's budget, a review hold, the org cap. */
const FINAL_REFUSAL = /^(budget_|kill_switch|model_not_offered)/;

/**
 * `channel_followup` { kind: 'voice', message, job, event? }: one waiting
 * voice note (threads.ts). Fetch the audio, transcribe it with the interview
 * sessions' speech-to-text (aiRouter task `transcribe`, the default final
 * model, billed to the member — a spent budget is refused there and nothing
 * runs), and store only the text.
 *
 * What it spends, and when:
 *   - only a note on a chat in an interview — the member chose the chat;
 *   - only while this job holds the note (`transcribe_job`), and only once:
 *     the transcript and the deletion of the placeholder are one batch, with
 *     the event's record, so a retry after it finds nothing to do;
 *   - under the connection's daily cap, held in D1 and checked before the
 *     model runs — a D1 error throws, so it fails closed.
 * A note deleted at the source is gone before the download or before the
 * store, and nothing is kept. A refusal (the cap, the budget, a download the
 * provider refuses) gives the note back for the next assignment to queue,
 * with its code kept on the note for the thread read (#1586). A provider or
 * transcription that does not answer is tried again by the job itself,
 * VOICE_TRIES times in all (#1586); anything else that throws is left to the
 * queue's own retries.
 */
export async function runVoiceFollowup(env: Env, p: ChannelJobPayload): Promise<void> {
  if (p.kind !== 'voice') throw new Error(`unknown channel_followup kind for ${p.provider}`);
  const provider = p.provider as MessagingProvider;
  const job = String(p.job ?? '');
  const event = Number.isSafeInteger(Number(p.event)) && Number(p.event) > 0 ? Number(p.event) : null;
  const end = async (status: EventStatus, fields: EventFields) => { if (event) await finishEvent(env, event, status, fields); };

  // Transcribed already, deleted at the source, ignored, purged, or held by another job.
  const note = await voiceNoteForJob(env, String(p.message ?? ''), job);
  if (!note) return;
  const fields: EventFields = { userId: Number(note.thread.user_id), threadId: note.thread.id };
  const giveBack = async (status: EventStatus, error: string) => {
    // A failure keeps its code on the note, so the thread can say why (#1586);
    // an 'ignored' give-back (the chat left its interview, the member left) is
    // not a failure, and the note just waits.
    await releaseVoiceNote(env, note.uid, job, status === 'failed' ? error : null);
    await end(status, { ...fields, error });
  };
  // A provider or transcription that does not answer (#1586): the job keeps
  // the note and tries again itself, VOICE_TRIES times in all, so the last
  // try is known and the member is told; until then the note says it is
  // still being tried.
  const tryAgain = async (code: 'provider_unreachable' | 'transcription_unavailable') => {
    const attempt = Math.max(1, Number(p.try) || 1);
    if (attempt >= VOICE_TRIES) return giveBack('failed', code);
    await noteVoiceTry(env, note.uid, job, code);
    await enqueueChannelJob(env, 'channel_followup', provider, `${job}-try-${attempt + 1}`, { ...p, try: attempt + 1 }, {
      delaySeconds: VOICE_RETRY_DELAYS[Math.min(attempt - 1, VOICE_RETRY_DELAYS.length - 1)],
    });
  };

  const conn = await memberConnection(env, Number(note.thread.user_id), provider);
  if (!conn || conn.integrationId !== Number(note.thread.integration_id)) return giveBack('ignored', 'unknown_connection');
  if (!(await memberStands(env, conn.userId))) return giveBack('ignored', 'member_inactive');
  // The member's chat may have left its interview since the job was queued.
  if (!inInterview(note.thread)) return giveBack('ignored', 'not_assigned');

  const audio = provider === 'telegram'
    ? await telegram.fetchTelegramVoice(env, note.file, note.mime)
    : await whatsapp.fetchWhatsAppMedia(env, conn, note.file, note.mime);
  if (!audio.ok) {
    if (audio.retryable) {
      console.error(`[channels] voice download failed provider=${provider} code=${audio.code} try=${Number(p.try) || 1}`);
      return tryAgain('provider_unreachable');
    }
    return giveBack('failed', audio.code);
  }
  if (!(await reserveTranscription(env, conn.integrationId))) return giveBack('failed', 'transcription_cap');

  const r = await aiRun(env, {
    task: 'transcribe', userId: conn.userId, surface: AI_SURFACE.validateInterviews,
    audio: audio.bytes, audioMime: audio.mime, audioMinutes: audioMinutesFromBytes(audio.bytes.byteLength),
  });
  if (!r.ok) {
    const refusal = String(r.refusal || 'all_models_failed');
    if (!FINAL_REFUSAL.test(refusal)) {
      console.error(`[channels] voice transcription failed provider=${provider} refusal=${refusal} try=${Number(p.try) || 1}`);
      return tryAgain('transcription_unavailable');
    }
    return giveBack('failed', refusal);
  }
  const text = String(r.transcript?.text ?? r.output ?? '').trim();
  const record = event
    ? [finishEventStatement(env, event, text ? 'done' : 'ignored', { ...fields, error: text ? null : 'empty_transcript' })]
    : [];
  const out = await storeVoiceTranscript(env, conn, note, text, record);
  if (out === 'gone') await end('ignored', { ...fields, error: 'voice_gone' });
}

// Registered at module load: index.ts imports this file, so the handlers exist
// before the queue delivers anything (services/channels/jobs.ts).
registerChannelJob('channel_followup', 'telegram', runVoiceFollowup);
registerChannelJob('channel_followup', 'whatsapp', runVoiceFollowup);

// ---------------------------------------------------------------------------
// Admin
// ---------------------------------------------------------------------------

channelsAdmin.post('/telegram/webhook', async (c) => {
  await requireSuperAdmin(c);
  const base = String(c.env.PUBLIC_BASE_URL || c.env.APP_URL || '').trim().replace(/\/+$/, '');
  // Telegram delivers webhooks to HTTPS only.
  if (!/^https:\/\/[^/]+$/.test(base)) return no(c, 503, 'base_url_missing');
  const url = `${base}/api/channels/telegram/webhook`;
  const r = await telegram.setTelegramWebhook(c.env, url);
  if (!r.ok) return no(c, r.code === 'not_configured' || r.code === 'secret_format' ? 503 : 502, r.code);
  return c.json({ ok: true, url, allowed_updates: [...telegram.TELEGRAM_ALLOWED_UPDATES] });
});

export default channels;
