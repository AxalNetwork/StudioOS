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
 *   POST   /telegram/link           a one-time code and its t.me link (rollout gated)
 *   GET    /telegram/setup          D863: the six setup steps, each done, todo or blocked, from stored rows (rollout gated)
 *   POST   /whatsapp/connect        finish Embedded Signup: { code, waba_id, phone_number_id }
 *   POST   /whatsapp/link           D754 way B (#1937): a one-time code, and the wa.me link that
 *                                   sends `LINK <code>` to Axal's own number
 *   GET    /whatsapp/link           the newest claim ('•••• 1234') and the current link, with Axal's
 *                                    public number and a plain wa.me link (#1939)
 *   POST   /whatsapp/link/:uid/confirm  Axal's half: the claimed number becomes the member's link
 *   DELETE /whatsapp/link           unlink
 *   PUT    /whatsapp/link/venture   #1939 part 3: the venture linked recordings go to, or null
 *   GET    /whatsapp/captures       way B part 2 (#1938): what the member forwarded to Axal's number
 *   POST   /whatsapp/captures/:uid/consent  { method: 'pre_agreed' | 'verbal' | 'written' } for a capture still waiting
 *   DELETE /:provider               disconnect (telegram | whatsapp)
 *   POST   /:provider/test          Telegram: a message in the member's own chat with the bot.
 *                                   WhatsApp: read the number with the member's token — a test
 *                                   never messages one of the member's customers.
 *   GET    /threads?status=         the member's conversations
 *   GET    /threads/:uid            one conversation; its pending messages, decrypted for the member only;
 *                                   a waiting voice note carries `transcription_failure` (#1586)
 *                                   and WhatsApp's derived `voice_fetch_by` (D754)
 *   POST   /threads/:uid/assign     { interview_id } | { create: { interviewee_name, interviewee_company?, project_id } },
 *                                   and quote_consent?: true (D685 §5.1.4), and consent?: { ask: true } | { method }
 *                                   (D754: a chat that waits for consent links and waits; `ask` sends the notice)
 *   POST   /threads/:uid/consent-request  Axal's consent notice in the chat (D754 §5): only when the member
 *                                   presses it, inside the window, at most twice, 24 h apart
 *   POST   /threads/:uid/consent    { method }: the member's word, once the notice was delivered (D754 §4)
 *   POST   /threads/:uid/ignore     { ignored?: boolean } (default true)
 *   POST   /threads/:uid/reply      { text, client_key }: once per client_key, within 24 h of the contact's
 *                                   last message (D756); a 429 carries the provider's retry_after
 *   POST   /threads/:uid/voice/:message/retry  a waiting voice note again, once what stopped it allows (#1586)
 *
 * Public — each verified by its provider's own secret, outside requireAuth:
 *   POST   /telegram/webhook        X-Telegram-Bot-Api-Secret-Token
 *   GET    /whatsapp/webhook        hub.verify_token challenge
 *   POST   /whatsapp/webhook        X-Hub-Signature-256 over the raw body
 *
 * D754 / D756: WHATSAPP_CHANNEL and TELEGRAM_CHANNEL default to canary,
 * Super Admins only. In off, webhooks verify then acknowledge rollout_off and
 * store nothing; Telegram checks its secret before even reading the body.
 *
 * Admin (`channelsAdmin`, super admin):
 *   GET    /telegram/webhook        the interview bot's health (D756): getMe and getWebhookInfo, as codes;
 *                                   503 not_configured with the missing secret NAMES when it is unset
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
 * A consented note, from WhatsApp (D754 W3, #1935) or Telegram (D756,
 * #1978), is kept and transcribed as the recorder's audio is: a chunk under
 * `validate-audio/`, the recorder's per-chunk stage and receipt, appended to
 * the chat's session under its side's speaker, then the engine
 * (`ingestChannelAudio`). It stays until the session is deleted. No note over
 * 5 MB, the recorder's chunk, reaches a model from either provider (D756,
 * #1896).
 *
 * AXAL'S OWN WHATSAPP NUMBER (way B, whatsappLink.ts) is answered before any
 * member connection is looked for: `LINK <code>` records a claim and gets one
 * reply; STOP from a linked sender unlinks with one reply; a linked sender's
 * recordings wait, as encrypted media ids only, until the member says everyone
 * recorded agreed (whatsappCapture.ts); an unlinked sender's messages are
 * claimed by their hashed id and ignored, with no reply and no text kept. Every
 * way-B route answers 503 until the owner sets all four WHATSAPP_AXAL_*
 * settings, and until then the webhook ignores the number.
 *
 * NOTHING FROM A CHAT IS KEPT BEFORE CONSENT where its provider asks for it
 * (D754, #1893; services/channels/consent.ts). Such a chat, assigned, links
 * and waits: its text stays pending and its voice notes are never fetched
 * until the interviewee taps Yes on Axal's notice, or replies YES to it, or
 * the member confirms once the notice was delivered. The interviewee's answer
 * arrives on the signed webhook and is claimed as a 'command' event; on
 * 'given' a `channel_followup` { kind: 'consent' } job moves what waited,
 * never the webhook itself. Client keys under `consent:` are the server's.
 * On Telegram (D756 §1.5, #1977) only the chat's NOTES wait for consent; its
 * text keeps D684's rule. The member may ask from Axal or paste the notice
 * themselves, the answer is also kept as chat text, the bot confirms a
 * counted answer in one line, and no member's word is taken.
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
import { requireAuth, requireSuperAdmin, isSuperAdmin } from '../auth';
import { canHoldValidateSource } from './_founder_validate_helpers';
import { refuse } from '../util/refusal';
import { IntakeError, activeMember } from '../services/interviewIntake';
import { MAX_CHUNK_BYTES } from '../services/interviewSessions';
import { admitAudio, audioMimeAdmitted, ingestChannelAudio } from '../services/channels/channelAudio';
import { sniffAudioContainer } from '../services/channels/providerHttp';
import {
  claimEvent, connectionOverLimit, linkAttemptOverLimit, finishEvent, finishEventStatement, readCappedBody, releaseEvent, reserveTranscription,
  type EventFields, type EventKind, type EventStatus,
} from '../services/channels/events';
import {
  availability, channelRollout, channelOpenTo, channelOpenToMember, connectionForTelegram, connectionForWhatsApp, memberConnection, providerAvailable, type ChannelConnection,
} from '../services/channels/connections';
import { createLinkCode, pendingLinkView } from '../services/channels/linkCodes';
import { beginOutbound, finishOutbound, applyDeliveryStatus, type OutboundRow } from '../services/channels/outbound';
import {
  admitConsentedThread, applyDelete, applyEdit, assignThread, forgetConnection, inInterview, intervieweeLabel, listThreads, noteVoiceTry,
  queueVoiceTranscriptions, readThread, releaseVoiceNote, replyWindowOpen, setThreadIgnored, storeInbound, storeMessage, storeVoiceNote,
  threadForChat, threadForReply, voiceNoteForJob, type AssignTarget, type ThreadRow,
} from '../services/channels/threads';
import {
  CONSENT_BUTTONS, CONSENT_KEY_PREFIX, MEMBER_METHODS, attest, consentForThread, markDelivered, markRequested, noticeRefusal,
  noticeState, noticeText, oneLine, openRequest, recordReply, type ConsentRow, type ConsentView, type MemberMethod,
} from '../services/channels/consent';
import { CONSENT_NOTICE_VERSION, consentNoticeUrl } from '../services/channels/consentNotice';
import { enqueueChannelJob, registerChannelJob, type ChannelJobPayload } from '../services/channels/jobs';
import * as zoom from '../services/channels/zoom';
import * as meet from '../services/channels/googleMeet';
import {
  VOICE_RETRY_DELAYS, VOICE_TRIES, channelTimestampMs as ms, retryVoiceNote, transcriptionFailures, voiceFetchBy,
} from '../services/channels/voiceFailures';
import {
  PROVIDER_LABEL, audioConsentRequired, consentAsked, consentRequired, memberAttestationAllowed,
  type InboundConsentReply, type InboundEvent, type InboundLink, type InboundLinkConfirm,
  type InboundManageChat, type InboundMessage, type MessagingProvider, type SendResult,
} from '../services/channels/types';
import * as telegram from '../services/channels/telegram';
import { telegramSetup } from '../services/channels/telegramSetup';
import * as whatsapp from '../services/channels/whatsapp';
import * as waLink from '../services/channels/whatsappLink';
import * as capture from '../services/channels/whatsappCapture';

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
  connection_disabled: 'The Axal bot is switched off for your Telegram Business account, so nothing was sent. Turn it back on in Telegram › Settings › Telegram Business › Chatbots.',
  unknown_provider: 'That is not a messaging channel Axal connects.',
  rate_limited: 'Too many attempts right now. Try again in a little while.',
  window_closed: 'Your contact last wrote more than 24 hours ago, so a free-form reply is closed. Nothing was sent.',
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
  axal_number: "This is Axal's own WhatsApp number. Connect your business's own number instead.",
  number_taken: 'This WhatsApp number is already connected to another Axal account.',
  capture_not_waiting: 'That recording is not waiting for an answer: it was answered, removed or has expired.',
  // #1939 part 3 — where linked recordings go.
  whatsapp_not_linked: 'Link your WhatsApp to Axal first, then choose where its recordings go.',
  venture_not_yours: 'Choose one of your own ventures.',
  number_not_in_waba: 'That number is not part of the WhatsApp Business account you connected.',
  choose_number: 'Your WhatsApp Business account has more than one number. Connect again and choose the number your customers write to.',
  code_exchange_failed: 'Meta did not accept the sign-up. Start the WhatsApp connection again.',
  waba_unreadable: 'Axal could not read your WhatsApp Business account. Start the connection again.',
  subscribe_failed: 'Axal could not subscribe to your WhatsApp Business account. Try again.',
  not_stored: 'The connection could not be saved. Try again.',
  base_url_missing: 'The public base URL is not set, so there is no webhook address to register.',
  // D754 (#1893) — consent in the chat.
  consent_not_offered: 'Axal does not ask for consent in this channel yet.',
  consent_needs_interview: 'Add this chat to an interview first: Axal\'s notice names the venture it is for.',
  already_given: 'Consent is already given in this chat.',
  consent_method_required: 'Say how the interviewee agreed: verbal, written or pre_agreed.',
  client_key_reserved: 'That client key is reserved for Axal\'s own messages.',
  notice_link_missing: 'The public base URL is not set, so Axal cannot link its notice. Nothing was sent.',
  // D756 (#1977) — consent in the Telegram chat.
  attestation_not_offered: 'In Telegram the interviewee agrees in the chat itself. Ask from Axal, or paste the notice into the chat yourself.',
  secret_format: 'TELEGRAM_CHANNEL_WEBHOOK_SECRET may use only letters, digits, _ and -, up to 256 characters.',
};
const sentence = (code: string) => SENTENCE[code] ?? 'That did not work. Try again.';

/** D754: the consent sentences that name the interviewee. `name` null reads "This contact". */
function consentSentence(code: string, name: string | null, provider: MessagingProvider): string {
  const who = name || 'This contact';
  const them = name || 'them';
  const app = PROVIDER_LABEL[provider];
  switch (code) {
    case 'window_closed': return `${who} last wrote more than 24 hours ago, and ${app} only lets Axal write within 24 hours of their last message. Ask ${them} to send you a message from your ${app} Business app, then ask again.`;
    case 'too_soon': return `Axal asked ${them} less than 24 hours ago. You can ask once more after that.`;
    case 'asked_twice': return `Axal has asked ${them} twice. Ask them in your own words, then confirm here once they agree.`;
    case 'notice_not_delivered': return `Axal's notice has not reached ${them} yet. Ask in ${app} first, and confirm once ${app} shows it delivered.`;
    case 'interviewee_declined': return `${who} declined in ${app}. Only their own Yes on Axal's notice can change that.`;
    case 'consent_withdrawn': return `${who} withdrew consent in ${app}. Only their own Yes on Axal's notice can change that.`;
    default: return sentence(code);
  }
}

const CONSENT_NAMED = new Set(['window_closed', 'too_soon', 'asked_twice', 'notice_not_delivered', 'interviewee_declined', 'consent_withdrawn']);

/** A consent refusal; a code that names the interviewee carries our sentence with their name. */
async function noConsent(c: C, status: number, code: string, thread: ThreadRow, extra: Record<string, unknown> = {}): Promise<Response> {
  const message = CONSENT_NAMED.has(code) ? consentSentence(code, await intervieweeLabel(c.env, thread), thread.provider) : sentence(code);
  return refuse(c, status, { code, message, extra: { code, ...extra } });
}

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

/**
 * D757 §2.11: every channel here (Telegram, WhatsApp, Zoom, Meet transcripts)
 * is a Validate source, listed and connectable only by a member who can hold a
 * venture. Anyone else is answered as if the channel did not exist. An
 * existing connection keeps Disconnect, its test and its threads.
 */
function venture(handler: (c: C, user: User) => Promise<Response>) {
  return member(async (c, user) => (canHoldValidateSource(user) ? handler(c, user) : no(c, 404, 'unknown_provider')));
}

const parseJson = (s: string | null): Record<string, unknown> => {
  if (!s) return {};
  try { const v = JSON.parse(s); return v && typeof v === 'object' && !Array.isArray(v) ? v : {}; } catch { return {}; }
};

// ---------------------------------------------------------------------------
// Availability and connections
// ---------------------------------------------------------------------------

channels.get('/', member(async (c, user) => {
  const env = c.env;
  // Secret NAMES help an admin set a deployment up; a member learns only "not available".
  const admin = String(user.role ?? '').toLowerCase() === 'admin';
  // D757 §2.11: no channel is offered to a member who cannot hold a venture.
  const providers = (canHoldValidateSource(user) ? availability(env) : []).map((a) => {
    const chat = a.provider === 'whatsapp' || a.provider === 'telegram';
    const available = a.available && (!chat || channelOpenTo(env, a.provider as MessagingProvider, user));
    return {
      provider: a.provider, available,
      missing: admin ? a.missing : [],
      ...(chat && isSuperAdmin(user) ? { rollout: channelRollout(env, a.provider as MessagingProvider) } : {}),
      // Public identifiers Meta's JS SDK needs in the browser to open Embedded Signup.
      ...(a.provider === 'whatsapp' && available
        ? { signup: { app_id: env.WHATSAPP_APP_ID, config_id: env.WHATSAPP_EMBEDDED_SIGNUP_CONFIG_ID, graph_version: whatsapp.GRAPH_VERSION } }
        : {}),
    };
  });

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

channels.post('/telegram/link', venture(async (c, user) => {
  if (!providerAvailable(c.env, 'telegram') || !channelOpenTo(c.env, 'telegram', user)) return no(c, 503, 'not_available');
  const ip = c.req.header('cf-connecting-ip') || (c.req.header('x-forwarded-for') || '').split(',')[0].trim() || 'unknown';
  await activeMember(c.env, user.id);
  try {
    if (await linkAttemptOverLimit(c.env, `ip:${ip}`, 20)) return no(c, 429, 'rate_limited');
  } catch { return no(c, 503, 'link_limit_unavailable'); }
  const { code, expiresAt } = await createLinkCode(c.env, user.id, 'telegram');
  const bot = String(c.env.TELEGRAM_CHANNEL_BOT_USERNAME ?? '').trim().replace(/^@/, '');
  return c.json({ code, url: `https://t.me/${encodeURIComponent(bot)}?start=${code}`, expires_at: expiresAt });
}));


channels.get('/telegram/link', venture(async (c, user) => {
  await activeMember(c.env, user.id);
  return c.json({ claim: await pendingLinkView(c.env, user.id) });
}));

/**
 * D863 (#2509): the Telegram setup, step by step, from stored rows only (no
 * Telegram call). Open to the members `POST /telegram/link` is, and refused as it is.
 */
channels.get('/telegram/setup', venture(async (c, user) => {
  if (!providerAvailable(c.env, 'telegram') || !channelOpenTo(c.env, 'telegram', user)) return no(c, 503, 'not_available');
  await activeMember(c.env, user.id);
  return c.json(await telegramSetup(c.env, user.id));
}));

channels.post('/telegram/link/:uid/confirm', venture(async (c, user) => {
  const out = await telegram.confirmAxalTelegramLink(c.env, user.id, c.req.param('uid') ?? '');
  if (!out.linked && out.reason === 'member_inactive') return no(c, 403, 'member_inactive');
  if (!out.linked && out.reason === 'identity_taken') return no(c, 409, 'identity_taken');
  if (!out.linked && out.reason === 'nothing_to_confirm') return no(c, 409, 'link_cancelled');
  return c.json({ ok: true, linked: out.linked, claim: await pendingLinkView(c.env, user.id, c.req.param('uid') ?? '') });
}));

// D754 way B (#1937): the member's own WhatsApp, linked through Axal's number.
// Codes per member per hour are counted on a hashed subject (events.ts).
const WA_LINK_CODES_PER_HOUR = 10;

/**
 * Way B is off (#1939). A Super Admin also reads which of Axal's settings are
 * unset, by name only and never a value; everyone else gets the plain refusal.
 */
function wayBOff(c: C, user: User): Response {
  const missing = waLink.axalNumberMissing(c.env);
  return no(c, 503, 'not_available', missing.length && isSuperAdmin(user) ? { missing } : {});
}

channels.post('/whatsapp/link', venture(async (c, user) => {
  if (!waLink.axalNumberReady(c.env) || !channelOpenTo(c.env, 'whatsapp', user)) return wayBOff(c, user);
  await activeMember(c.env, user.id);
  try {
    if (await linkAttemptOverLimit(c.env, `whatsapp_link:member:${user.id}`, WA_LINK_CODES_PER_HOUR)) return no(c, 429, 'rate_limited');
  } catch { return no(c, 503, 'link_limit_unavailable'); }
  const { code, expiresAt } = await createLinkCode(c.env, user.id, 'whatsapp_link');
  return c.json({ code, wa_link: waLink.waLink(c.env, code), expires_at: expiresAt });
}));

channels.get('/whatsapp/link', venture(async (c, user) => {
  if (!waLink.axalNumberReady(c.env)) return wayBOff(c, user);
  await activeMember(c.env, user.id);
  return c.json({ ...(await waLink.whatsappLinkView(c.env, user.id)), ...waLink.axalContact(c.env) });
}));

/**
 * #1939 part 3: the venture a linked member's recordings go to, or null for
 * their most recently updated one. A venture they cannot write is refused the
 * same way whether it is missing or another member's.
 */
channels.put('/whatsapp/link/venture', venture(async (c, user) => {
  if (!waLink.axalNumberReady(c.env)) return wayBOff(c, user);
  await activeMember(c.env, user.id);
  const body = await c.req.json<Record<string, unknown>>().catch(() => null);
  const raw = body && Object.hasOwn(body, 'project_id') ? body.project_id : undefined;
  if (raw !== null && !(typeof raw === 'number' && Number.isSafeInteger(raw) && raw > 0)) return no(c, 400, 'invalid_request');
  const out = await waLink.setVentureChoice(c.env, user.id, raw);
  if (!out.ok) return out.reason === 'not_linked' ? no(c, 409, 'whatsapp_not_linked') : no(c, 403, 'venture_not_yours');
  return c.json({ ok: true, venture: await waLink.ventureChoice(c.env, user.id) });
}));

channels.post('/whatsapp/link/:uid/confirm', venture(async (c, user) => {
  if (!waLink.axalNumberReady(c.env) || !channelOpenTo(c.env, 'whatsapp', user)) return wayBOff(c, user);
  await waLink.confirmWhatsAppLink(c.env, user.id, c.req.param('uid') ?? '');
  return c.json({ ok: true, linked: true, ...(await waLink.whatsappLinkView(c.env, user.id)) });
}));

channels.delete('/whatsapp/link', member(async (c, user) => {
  if (!waLink.axalNumberReady(c.env)) return wayBOff(c, user);
  return c.json({ ok: true, unlinked: await waLink.unlinkMember(c.env, user.id) });
}));

// D754 way B (#1938): what a linked member forwarded to Axal's number. No media ids leave the Worker.
channels.get('/whatsapp/captures', member(async (c, user) => {
  if (!waLink.axalNumberReady(c.env)) return wayBOff(c, user);
  await activeMember(c.env, user.id);
  return c.json({ items: await capture.listCaptures(c.env, user.id) });
}));

/** "Agreed beforehand" (or the member's other word) for a capture still waiting, from Axal. */
channels.post('/whatsapp/captures/:uid/consent', member(async (c, user) => {
  if (!waLink.axalNumberReady(c.env) || !channelOpenTo(c.env, 'whatsapp', user)) return wayBOff(c, user);
  await activeMember(c.env, user.id);
  const body = await c.req.json<Record<string, unknown>>().catch(() => ({} as Record<string, unknown>));
  const method = String(body.method ?? '');
  if (method !== 'pre_agreed' && method !== 'verbal' && method !== 'written') return no(c, 400, 'invalid_request');
  const uid = c.req.param('uid') ?? '';
  const out = await capture.answerCapture(c.env, user.id, uid, method);
  if (out.done !== 'consented') return no(c, 404, 'capture_not_waiting');
  await enqueueCaptureImport(c.env, uid);
  return c.json({ ok: true, status: 'consented' });
}));

channels.post('/whatsapp/connect', venture(async (c, user) => {
  if (!providerAvailable(c.env, 'whatsapp') || !channelOpenTo(c.env, 'whatsapp', user)) return no(c, 503, 'not_available');
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
  if (!providerAvailable(c.env, provider as MessagingProvider) || !channelOpenTo(c.env, provider as MessagingProvider, user)) return no(c, 503, 'not_available');
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
  // D754: the chat's consent, for the member. No hash and no provider id.
  const consent = await memberConsent(c.env, user.id, await threadForReply(c.env, user.id, uid));
  return c.json({ ...read, consent, messages: read.messages.map((m) => ({ ...m, transcription_failure: failures.get(m.uid) ?? null, voice_fetch_by: voiceFetchBy(read.thread.provider, m) })) });
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
  // D754: { ask: true } sends Axal's notice once linked; { method } is the member's word.
  const consentAsk = body.consent;
  let ask = false;
  let method: MemberMethod | null = null;
  if (consentAsk != null) {
    const keys = consentAsk && typeof consentAsk === 'object' && !Array.isArray(consentAsk) ? Object.keys(consentAsk) : null;
    if (keys?.length === 1 && consentAsk.ask === true) ask = true;
    else if (keys?.length === 1 && typeof consentAsk.method === 'string') {
      if (!(MEMBER_METHODS as readonly string[]).includes(consentAsk.method)) {
        return no(c, 400, 'consent_method_required', { accepted: MEMBER_METHODS });
      }
      method = consentAsk.method as MemberMethod;
    } else return no(c, 400, 'invalid_request');
  }
  const uid = c.req.param('uid') ?? '';
  const before = await threadForReply(c.env, user.id, uid);
  const waits = consentRequired(before.provider);
  if (waits && before.consent_state !== 'given') {
    // Checked before the claim, so a refusal links nothing.
    if (ask) {
      const refusal = noticeRefusal(before, await noticeState(c.env, before));
      if (refusal) return noConsent(c, 409, refusal.code, before, refusal.next_at ? { next_at: refusal.next_at } : {});
    } else if (method) {
      const pre = await memberWordRefusal(c.env, before);
      if (pre) return noConsent(c, 409, pre, before);
    }
  }
  const r = await assignThread(c.env, user.id, uid, target, { quoteConsent: body.quote_consent === true });
  const out: Record<string, unknown> = { ok: true, interview_id: r.interviewId, session_id: r.sessionId, moved: r.moved, voice_queued: r.queued };
  if (!waits) return c.json(out);
  let thread = await threadForReply(c.env, user.id, uid);
  if (thread.consent_state !== 'given' && ask) {
    const sent = await askForConsent(c.env, user.id, thread);
    out.consent_request = sent.ok === true ? { ok: true } : { ok: sent.ok, code: sent.code };
  } else if (thread.consent_state !== 'given' && method) {
    const a = await attest(c.env, user.id, thread, method);
    if (a.ok) {
      const admitted = await admitConsentedThread(c.env, user.id, thread.id);
      out.moved = admitted.moved;
      out.voice_queued = admitted.queued;
    } else out.consent_request = { ok: false, code: a.code };
  }
  thread = await threadForReply(c.env, user.id, uid);
  return c.json({ ...out, consent: await memberConsent(c.env, user.id, thread) });
}));

/** Why the member's word may not be taken on this chat now, before any link changes: the interviewee's answer wins. */
async function memberWordRefusal(env: Env, thread: ThreadRow): Promise<string | null> {
  const answered = await env.DB.prepare(
    `SELECT MAX(CASE WHEN status = 'declined' THEN 1 ELSE 0 END) AS declined, MAX(CASE WHEN status = 'withdrawn' THEN 1 ELSE 0 END) AS withdrawn
       FROM channel_consents WHERE thread_id = ?`,
  ).bind(thread.id).first<{ declined: number | null; withdrawn: number | null }>();
  if (Number(answered?.withdrawn)) return 'consent_withdrawn';
  if (Number(answered?.declined)) return 'interviewee_declined';
  if (!(await noticeState(env, thread)).delivered) return 'notice_not_delivered';
  return null;
}

type AskOutcome =
  | { ok: true; status: 200 }
  | { ok: false | null; status: number; code: string; extra?: Record<string, unknown> };

/**
 * D754 §5, D756 §1.5 (a) — Axal's notice, sent in the chat from the member's
 * own account (WhatsApp: their number, as reply buttons; Telegram: their
 * business connection, as text), with a server-built client key. The caller
 * has checked that the provider asks for consent, that a WhatsApp chat is
 * linked, and that consent is not yet given. The window and the cap are
 * checked here too, before anything is sent; a key used already answers its
 * first outcome and sends nothing. Telegram's notice is also kept as the
 * member's message in the chat.
 */
async function askForConsent(env: Env, userId: number, thread: ThreadRow): Promise<AskOutcome> {
  const conn = await memberConnection(env, userId, thread.provider);
  if (!conn || conn.integrationId !== Number(thread.integration_id)) return { ok: false, status: 409, code: 'not_connected' };
  const notices = await noticeState(env, thread);
  const refusal = noticeRefusal(thread, notices);
  if (refusal) return { ok: false, status: 409, code: refusal.code, extra: refusal.next_at ? { next_at: refusal.next_at } : {} };
  const url = consentNoticeUrl(env);
  if (!url) return { ok: false, status: 503, code: 'base_url_missing' };
  const who = await env.DB.prepare(
    `SELECT u.name AS member_name, p.name AS venture FROM users u
       LEFT JOIN discovery_interviews di ON di.id = ?
       LEFT JOIN projects p ON p.id = di.project_id
      WHERE u.id = ?`,
  ).bind(thread.interview_id, userId).first<{ member_name: string | null; venture: string | null }>();
  const firstName = oneLine(who?.member_name, 200).split(' ')[0] || null;
  const body = thread.provider === 'telegram'
    ? await telegramNotice(env, thread, url)
    : noticeText(CONSENT_NOTICE_VERSION, { firstName, venture: who?.venture ?? null, url });
  if (!body) throw new Error('consent_notice_missing');
  const row: ConsentRow = await openRequest(env, thread, { interviewId: thread.interview_id, sessionId: thread.session_id });

  let claim: { row: OutboundRow; existing: boolean };
  try {
    claim = await beginOutbound(env, thread.provider, userId, thread.id, notices.nextKey!);
  } catch (err) {
    if (err instanceof Error && err.message === 'client_key_conflict') return { ok: false, status: 409, code: 'client_key_conflict' };
    throw err;
  }
  // A concurrent press already holds this notice: its outcome, and nothing sent now.
  if (claim.existing) {
    if (claim.row.status === 'failed') return { ok: false, status: 409, code: claim.row.error_code ?? 'rejected' };
    return claim.row.status === 'pending' ? { ok: null, status: 200, code: 'send_in_flight' } : { ok: true, status: 200 };
  }
  const result: SendResult = thread.provider === 'whatsapp'
    ? await whatsapp.sendWhatsAppInteractive(env, conn, thread.external_chat_id, {
      body,
      buttons: [
        { id: `consent_yes:${row.uid}`, title: CONSENT_BUTTONS.yes },
        { id: `consent_no:${row.uid}`, title: CONSENT_BUTTONS.no },
      ],
    })
    : await telegram.sendConsentNotice(env, userId, thread.external_chat_id, body);
  try {
    await finishOutbound(env, claim.row.id, result);
    if (result.ok || result.code === 'send_unknown') {
      await markRequested(env, row.id, result.externalMessageId ?? null, thread.provider, thread.id);
    }
  } catch {
    console.error(`[channels] ${thread.provider} consent notice outcome not saved ok=${result.ok}`);
  }
  if (result.ok && thread.provider === 'telegram') {
    // D756 §1.5: the notice is the member's own message in the chat.
    await storeMessage(env, conn, {
      externalChatId: thread.external_chat_id, externalMessageId: String(result.externalMessageId), side: 'me',
      contactName: null, text: body, kind: 'text', sentAt: new Date().toISOString(), origin: 'axal',
    }).catch((err) => console.error('[channels] telegram consent notice sent but not recorded', err instanceof IntakeError ? err.code : 'error'));
  }
  if (result.ok) return { ok: true, status: 200 };
  if (result.code === 'send_unknown') return { ok: null, status: 200, code: 'send_unknown' };
  const code = result.code ?? 'rejected';
  const status = ['window_closed', 'not_connected', 'consent_not_offered', 'no_reply_right', 'connection_disabled'].includes(code) ? 409
    : code === 'rate_limited' ? 429 : result.retryable ? 503 : 502;
  return { ok: false, status, code, extra: { retryable: !!result.retryable } };
}

/**
 * D756 §1.7 — Telegram's notice, in the founder's voice, addressed to the
 * interviewee by first name. The same words whether Axal sends it or the
 * member pastes it (§1.5 (b)).
 */
async function telegramNotice(env: Env, thread: ThreadRow, url: string): Promise<string> {
  const venture = thread.interview_id
    ? (await env.DB.prepare('SELECT p.name FROM discovery_interviews di JOIN projects p ON p.id = di.project_id WHERE di.id = ?')
      .bind(thread.interview_id).first<{ name: string | null }>())?.name ?? null
    : null;
  const name = oneLine(await intervieweeLabel(env, thread), 200).split(' ')[0].slice(0, 40) || null;
  return telegram.TELEGRAM_COPY.consentNotice(name, oneLine(venture, 80) || null, url);
}

/**
 * The chat's consent for the member (`consentForThread`), and on a Telegram
 * chat that waits for a YES where Axal cannot send the notice now (no reply
 * right, or outside the 24-hour window), the notice to paste, `notice_text`
 * (D756 §1.5 (b)). Null otherwise, and while the notice page has no link.
 */
async function memberConsent(env: Env, userId: number, thread: ThreadRow): Promise<ConsentView & { notice_text?: string | null }> {
  const view = await consentForThread(env, thread);
  if (thread.provider !== 'telegram' || !view.required) return view;
  const waits = view.status === 'not_asked' || view.status === 'requested';
  const url = consentNoticeUrl(env);
  if (!waits || thread.status === 'ignored' || !url) return { ...view, notice_text: null };
  const canReply = view.window_open && !!(await telegram.activeBusinessConnection(env, userId))?.canReply;
  return { ...view, notice_text: canReply ? null : await telegramNotice(env, thread, url) };
}

/** The checks both consent routes make first, in D754's order. Null when the chat may go on. */
async function consentPreconditions(c: C, thread: ThreadRow, opts: { asking: boolean }): Promise<Response | null> {
  if (!consentAsked(thread.provider)) return no(c, 409, 'consent_not_offered');
  // D756 ruling 6: no member's word on Telegram; the interviewee answers in the chat.
  if (!opts.asking) return memberAttestationAllowed(thread.provider) ? null : no(c, 409, 'attestation_not_offered');
  // An ignored chat is never linked; saying so is the more useful answer.
  if (thread.status === 'ignored') return no(c, 409, 'thread_ignored');
  // WhatsApp's notice names the venture, so its chat is linked first; a Telegram chat may be asked while pending.
  if (consentRequired(thread.provider) && !(thread.status === 'assigned' && thread.interview_id && thread.session_id)) {
    return no(c, 409, 'consent_needs_interview');
  }
  if (thread.consent_state === 'given') return no(c, 409, 'already_given');
  return null;
}

channels.post('/threads/:uid/consent-request', member(async (c, user) => {
  const thread = await threadForReply(c.env, user.id, c.req.param('uid') ?? '');
  const pre = await consentPreconditions(c, thread, { asking: true });
  if (pre) return pre;
  const sent = await askForConsent(c.env, user.id, thread);
  const consent = await memberConsent(c.env, user.id, await threadForReply(c.env, user.id, thread.uid));
  if (sent.ok === true) return c.json({ ok: true, consent });
  if (sent.ok === null) return c.json({ ok: null, pending: true, code: sent.code, message: sentence(sent.code), consent });
  if (sent.code === 'base_url_missing') return no(c, 503, 'notice_link_missing', { code: 'base_url_missing' });
  return noConsent(c, sent.status, sent.code, thread, { ...(sent.extra ?? {}), consent });
}));

channels.post('/threads/:uid/consent', member(async (c, user) => {
  const body = await c.req.json<Record<string, unknown>>().catch(() => ({} as Record<string, unknown>));
  const thread = await threadForReply(c.env, user.id, c.req.param('uid') ?? '');
  const pre = await consentPreconditions(c, thread, { asking: false });
  if (pre) return pre;
  const method = typeof body.method === 'string' ? body.method : '';
  if (!(MEMBER_METHODS as readonly string[]).includes(method)) return no(c, 400, 'consent_method_required', { accepted: MEMBER_METHODS });
  const a = await attest(c.env, user.id, thread, method as MemberMethod);
  if (!a.ok) return noConsent(c, 409, a.code, thread);
  // Given already: nothing changes. Otherwise what waited moves now, as an assignment does.
  const admitted = a.changed ? await admitConsentedThread(c.env, user.id, thread.id) : { moved: 0, queued: 0 };
  const consent = await memberConsent(c.env, user.id, await threadForReply(c.env, user.id, thread.uid));
  return c.json({ ok: true, consent, moved: admitted.moved, voice_queued: admitted.queued });
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

/** Why a free-form reply may not go now, or null. Checked before any provider call. Both providers count from the contact's last message (D756). */
function windowRefusal(thread: ThreadRow): string | null {
  return replyWindowOpen(thread) ? null : 'window_closed';
}

channels.post('/threads/:uid/reply', member(async (c, user) => {
  const env = c.env;
  const body = await c.req.json<Record<string, unknown>>().catch(() => ({} as Record<string, unknown>));
  const text = typeof body.text === 'string' ? body.text.trim() : '';
  const clientKey = typeof body.client_key === 'string' ? body.client_key.trim() : '';
  if (!text) return no(c, 400, 'text_required');
  if (!clientKey || clientKey.length > 100) return no(c, 400, 'client_key_required');
  // D754 §4: `consent:` keys are the server's notices. A reply under one would block
  // the real notice, and its delivery report would unlock the member's word.
  if (clientKey.startsWith(CONSENT_KEY_PREFIX)) return no(c, 400, 'client_key_reserved');
  // Another member's thread is not there (404, from threads.ts).
  const thread = await threadForReply(env, user.id, c.req.param('uid') ?? '');
  if (!providerAvailable(env, thread.provider) || !channelOpenTo(env, thread.provider, user)) return no(c, 503, 'not_available');
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
    // Connected but switched off in Telegram is not "not connected" (D756).
    const bc = await telegram.telegramBusinessState(env, user.id);
    result = bc.state === 'none' ? { ok: false, code: 'not_connected' }
      : bc.state === 'disabled' ? { ok: false, code: 'connection_disabled' }
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
    const status = ['window_closed', 'no_reply_right', 'not_connected', 'connection_disabled', 'thread_ignored'].includes(code) ? 409
      : code === 'rate_limited' ? 429 : result.retryable ? 503 : 502;
    // A 429 with the provider's wait: nothing is retried here, the member's client waits (D756).
    const wait = status === 429 && result.retryAfterSec ? Math.ceil(result.retryAfterSec) : null;
    if (wait) c.header('Retry-After', String(wait));
    return no(c, status, code, { retryable: !!result.retryable, ...(wait ? { retry_after: wait } : {}) });
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
    case 'manage_chat': return 'command';
    case 'connection': return 'connection';
    case 'consent_reply': return 'command';
    case 'axal_message': return ev.button ? 'command' : ev.media ? 'voice' : 'message';
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

/**
 * Telegram's "manage this chat" button (D756): one plain answer in the member's
 * private chat, at most ten an hour per Telegram account on its own counter,
 * so it never spends a link code or a link attempt. Over the limit, or on a D1
 * error, nothing is sent.
 */
async function handleManageChat(env: Env, claim: number, ev: InboundManageChat): Promise<void> {
  try {
    if (await linkAttemptOverLimit(env, `manage:${ev.telegramUserId}`, 10)) {
      await finishEvent(env, claim, 'ignored', { error: 'rate_limited' });
      return;
    }
  } catch {
    await finishEvent(env, claim, 'ignored', { error: 'link_limit_unavailable' });
    return;
  }
  await finishEvent(env, claim, 'done');
  await tell(env, ev.chatId, telegram.TELEGRAM_COPY.manageChat);
}

/** Wrong or repeated `LINK` codes a sender may send per hour, counted on a hash of the sender. */
const WA_LINK_TRIES_PER_SENDER_HOUR = 5;

/** One reply from Axal's number, once per client key, through the outbound ledger. A failure never fails the webhook. */
/** The capture's consent question: reply buttons from Axal's number, once per client key. */
async function axalAsk(env: Env, userId: number, clientKey: string, to: string, body: string, buttons: { id: string; title: string }[]): Promise<void> {
  const { row, existing } = await beginOutbound(env, 'whatsapp', userId, null, clientKey);
  if (existing) return;
  const r = await whatsapp.sendAxalInteractive(env, to, { body, buttons }).catch(() => ({ ok: false, code: 'send_unknown' } as SendResult));
  await finishOutbound(env, row.id, r);
  if (!r.ok) console.error(`[channels] axal number question not sent code=${r.code ?? 'unknown'}`);
}

async function axalReply(env: Env, userId: number, clientKey: string, to: string, text: string): Promise<void> {
  const { row, existing } = await beginOutbound(env, 'whatsapp', userId, null, clientKey);
  if (existing) return;
  const r = await whatsapp.sendAxalText(env, to, text).catch(() => ({ ok: false, code: 'send_unknown' } as SendResult));
  await finishOutbound(env, row.id, r);
  if (!r.ok) console.error(`[channels] axal number reply not sent code=${r.code ?? 'unknown'}`);
}

/**
 * D754 way B: an event on Axal's own WhatsApp number (whatsapp.ts
 * `axalMessageEvent`). There is no member connection here; who a message is
 * from is the sender's link.
 *   LINK <code>  records the claim against the sender; one reply (#1937).
 *   STOP         from a linked sender: unlinks, drops its unanswered
 *                captures; one reply.
 *   a recording  from a linked sender: joins a capture (whatsappCapture.ts);
 *                a new capture asks once whether everyone recorded agreed.
 *   a button     the member's answer for a capture (#1938).
 *   anything else from a linked sender: one reply saying what Axal takes.
 *   anything from an unlinked sender: ignored, no reply, nothing kept but
 *                the event's hashed id.
 */
async function handleAxalNumber(
  env: Env, claim: number, ev: InboundEvent, spend: () => void,
  finish: (status: EventStatus, fields?: EventFields) => Promise<void>,
): Promise<void> {
  if (!waLink.axalNumberReady(env)) return finish('ignored', { error: 'not_available' });
  if (ev.kind === 'status') {
    const known = await applyDeliveryStatus(env, ev.externalMessageId, ev.status, ev.errorCode);
    return finish(known ? 'done' : 'ignored', { error: known ? null : 'not_ours' });
  }
  if (ev.kind !== 'axal_message') return finish('ignored', { error: 'unsupported' });
  const sender = ev.externalChatId;
  const code = waLink.linkCodeIn(ev.text);
  if (code) {
    try {
      if (await linkAttemptOverLimit(env, `whatsapp_link:sender:${sender}`, WA_LINK_TRIES_PER_SENDER_HOUR)) {
        return finish('ignored', { error: 'rate_limited' });
      }
    } catch { return finish('ignored', { error: 'link_limit_unavailable' }); }
    // The code is spent by its first attempt: from here a failure is not retried.
    spend();
    const out = await waLink.claimWhatsAppLink(env, code, sender);
    if (!out.claimed) return finish('ignored', { error: out.reason });
    await finish('done', { userId: out.userId });
    await axalReply(env, out.userId, `wblink:${out.codeUid}`, sender, waLink.WHATSAPP_LINK_COPY.claimed);
    return;
  }
  const link = await waLink.linkedSender(env, sender);
  if (!link) return finish('ignored', { error: 'unlinked_sender' });
  const userId = Number(link.user_id);
  if (waLink.isStop(ev.text)) {
    spend();
    const unlinked = await waLink.unlinkSender(env, Number(link.id));
    if (unlinked) await capture.dropWaitingCaptures(env, Number(link.id));
    await finish(unlinked ? 'done' : 'ignored', { userId, error: unlinked ? null : 'not_linked' });
    if (unlinked) await axalReply(env, userId, `wbstop:${claim}`, sender, waLink.WHATSAPP_LINK_COPY.unlinked);
    return;
  }
  // Management commands can finish in canary, as Telegram's do; captures cannot.
  if (!(await channelOpenToMember(env, 'whatsapp', Number(link.user_id)))) {
    return finish('ignored', { userId: Number(link.user_id), error: 'rollout' });
  }
  await waLink.touchLink(env, Number(link.id));
  if (!(await memberStands(env, userId))) return finish('ignored', { userId, error: 'member_inactive' });

  const press = capture.captureButton(ev.button);
  if (press) {
    spend();
    const out = await capture.answerCapture(env, userId, press.uid, press.answer);
    await finish(out.done === 'nothing' ? 'ignored' : 'done', { userId, error: out.done === 'nothing' ? 'capture_not_waiting' : null });
    // A yes queues the import (`runCaptureFollowup`); a no is answered once, and nothing was kept.
    if (out.done === 'consented') await enqueueCaptureImport(env, press.uid);
    if (out.done === 'deleted') await axalReply(env, userId, `wbcapture-no:${press.uid}`, sender, capture.CAPTURE_COPY.declined);
    return;
  }
  if (ev.media && capture.capturable(ev.media)) {
    spend();
    if (capture.declaredTooLarge(ev.media)) {
      await finish('ignored', { userId, error: 'too_large' });
      await axalReply(env, userId, `wbcapture-large:${claim}`, sender, capture.CAPTURE_COPY.tooLarge);
      return;
    }
    const added = await capture.addToCapture(env, { id: Number(link.id), user_id: userId }, ev.media);
    await finish('stored', { userId });
    if (added.created) {
      await axalAsk(env, userId, `wbcapture:${added.uid}`, sender, capture.CAPTURE_COPY.question, capture.captureButtons(added.uid));
    }
    return;
  }
  spend();
  await finish('ignored', { userId, error: 'unsupported_type' });
  await axalReply(env, userId, `wbunsupported:${claim}`, sender, capture.CAPTURE_COPY.unsupported);
}

function resolveConnection(env: Env, provider: MessagingProvider, ref: string): Promise<ChannelConnection | null> {
  return provider === 'telegram' ? connectionForTelegram(env, ref) : connectionForWhatsApp(env, ref);
}

/**
 * D754 §4 — what may be the interviewee's answer. The thread is looked up,
 * never created. An answer that counts is applied by consent.ts; one that does
 * not is stored as the ordinary message it is (`fallback`), so a typed word is
 * never lost. On 'given' a follow-up job moves what waited — ids only, never
 * text on the webhook path.
 */
async function handleConsentReply(
  env: Env, conn: ChannelConnection, ev: InboundConsentReply, claim: number,
  finish: (status: EventStatus, fields?: EventFields) => Promise<void>, markStored: () => void,
): Promise<'ok'> {
  const thread = await threadForChat(env, conn, ev.externalChatId);
  const out = thread ? await recordReply(env, thread, ev) : { outcome: 'ignored' as const, reason: 'no_notice' as const };
  if (out.outcome === 'ignored') {
    // A duplicate was an answer once already: it is not a message now.
    if (!ev.fallback || out.reason === 'duplicate') {
      await finish('ignored', { userId: conn.userId, threadId: thread?.id ?? null, error: out.reason });
      return 'ok';
    }
    const kept = await storeInbound(env, conn, ev.fallback);
    markStored();
    const ok = kept.stored === 'pending' || kept.stored === 'session';
    await finish(ok ? 'stored' : 'ignored', {
      userId: conn.userId, threadId: kept.thread?.id ?? null,
      sessionId: kept.stored === 'session' ? kept.sessionId : null,
      error: ok ? null : kept.stored === 'ignored' ? 'thread_ignored' : kept.stored,
    });
    return 'ok';
  }
  markStored();
  // D756 §1.5: on Telegram the answer is also the ordinary message it is.
  if (ev.provider === 'telegram' && ev.fallback) await storeInbound(env, conn, ev.fallback);
  await finish('done', { userId: conn.userId, threadId: thread!.id, sessionId: out.consent.session_id });
  if (out.outcome === 'given') {
    await enqueueChannelJob(env, 'channel_followup', ev.provider, `consent:${out.consent.uid}`, {
      kind: 'consent', thread: thread!.uid, consent: out.consent.uid, event: claim,
    });
  }
  if (ev.provider === 'telegram') await confirmAnswer(env, conn, thread!, out.consent, out.outcome);
  return 'ok';
}

/**
 * D756 §1.7 — the bot's one line after a counted Telegram answer: at most one
 * per answer (its own client key under `consent:`), and only with the reply
 * right. A failure is logged and never fails the webhook.
 */
async function confirmAnswer(
  env: Env, conn: ChannelConnection, thread: ThreadRow, row: ConsentRow, outcome: 'given' | 'declined' | 'withdrawn',
): Promise<void> {
  try {
    const bc = await telegram.activeBusinessConnection(env, conn.userId);
    if (!bc?.canReply) return;
    const venture = row.interview_id
      ? (await env.DB.prepare('SELECT p.name FROM discovery_interviews di JOIN projects p ON p.id = di.project_id WHERE di.id = ?')
        .bind(row.interview_id).first<{ name: string | null }>())?.name ?? null
      : null;
    const copy = telegram.TELEGRAM_COPY;
    const text = outcome === 'given' ? copy.consentYes(oneLine(venture, 80) || null) : outcome === 'declined' ? copy.consentNo : copy.consentStop;
    const claim = await beginOutbound(env, 'telegram', conn.userId, thread.id, `${CONSENT_KEY_PREFIX}${thread.uid}:answer:${row.uid}:${outcome}`);
    if (claim.existing) return;
    const sent = await telegram.sendBusinessMessage(env, bc.businessConnectionId, thread.external_chat_id, text);
    await finishOutbound(env, claim.row.id, sent);
  } catch (err) {
    console.error('[channels] telegram consent confirmation not sent', err instanceof Error ? err.name : 'error');
  }
}

/** D756 §1.5 (b): the member's own message carrying the notice page's link, at the current version. */
const PASTED_NOTICE = /\/privacy\/interviews\?n=(\d{1,3})\b/;

/**
 * The member pasted the notice into a Telegram chat themselves: that message
 * is the request, with no reply right and outside the window. A chat whose
 * consent is already given is left as it is.
 */
async function recordPastedNotice(env: Env, msg: InboundMessage, thread: ThreadRow | null): Promise<void> {
  if (!thread || msg.provider !== 'telegram' || msg.side !== 'me' || thread.consent_state === 'given') return;
  const m = PASTED_NOTICE.exec(String(msg.text ?? ''));
  if (!m || Number(m[1]) !== CONSENT_NOTICE_VERSION) return;
  const row = await openRequest(env, thread, { interviewId: thread.interview_id, sessionId: thread.session_id });
  await markRequested(env, row.id, msg.externalMessageId, 'telegram', thread.id);
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
    if (ev.kind === 'manage_chat') {
      // Marked stored before anything is sent, so a failure is never retried into a second reply.
      stored = true;
      await handleManageChat(env, claim, ev);
      return 'ok';
    }
    if (ev.kind === 'connection') {
      const { userId } = await telegram.recordBusinessConnection(env, ev);
      await finish('stored', { userId });
      // Not linked yet: tell them how. Nothing else from the connection is kept.
      if (ev.isEnabled && !userId) await tell(env, ev.userChatId, telegram.TELEGRAM_COPY.linkPrompt);
      return 'ok';
    }

    if (ev.provider === 'whatsapp' && waLink.isAxalNumber(env, ev.connectionRef)) {
      await handleAxalNumber(env, claim, ev, () => { stored = true; }, finish);
      return 'ok';
    }

    const conn = await resolveConnection(env, ev.provider as MessagingProvider, ev.connectionRef);
    if (!conn) { await finish('ignored', { error: 'unknown_connection' }); return 'ok'; }
    if (!(await memberStands(env, conn.userId))) { await finish('ignored', { userId: conn.userId, error: 'member_inactive' }); return 'ok'; }
    if (!(await channelOpenToMember(env, conn.provider, conn.userId))) {
      await finish('ignored', { userId: conn.userId, error: 'rollout' });
      return 'ok';
    }
    if (await connectionOverLimit(env, conn.integrationId)) {
      await finish('ignored', { userId: conn.userId, error: 'rate_limited' });
      return 'ok';
    }

    if (ev.kind === 'status') {
      const known = await applyDeliveryStatus(env, ev.externalMessageId, ev.status, ev.errorCode);
      // D754: a notice delivered or read unlocks the member's word on its request.
      if (known) await markDelivered(env, ev.externalMessageId, ev.status);
      await finish(known ? 'done' : 'ignored', { userId: conn.userId, error: known ? null : 'not_ours' });
      return 'ok';
    }
    if (ev.kind === 'consent_reply') return await handleConsentReply(env, conn, ev, claim, finish, () => { stored = true; });
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
    if (msg.provider === 'telegram' && msg.side === 'me' && (out.stored === 'pending' || out.stored === 'session')) {
      await recordPastedNotice(env, msg, out.thread);
    }
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
    console.error('[channels] %s %s event failed stored=%s', ev.provider, ev.kind, stored, err instanceof Error ? err.name : 'error');
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
  if (channelRollout(c.env, 'telegram') === 'off') return c.json({ ok: true, ignored: 'rollout_off' });
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
  if (channelRollout(c.env, 'whatsapp') === 'off') return c.json({ ok: true, ignored: 'rollout_off' });
  // One POST may carry many events; each is claimed on its own, and one that
  // must be retried does not stop the rest (their claims make the retry a no-op).
  let retry = false;
  for (const ev of whatsapp.normaliseWhatsAppPayload(body, c.env.WHATSAPP_AXAL_PHONE_NUMBER_ID ?? null)) {
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
 * voice note (threads.ts). Fetch the audio and keep it as the recorder's
 * (`ingestChannelAudio`: a chunk of the chat's session, the recorder's
 * per-chunk transcription on the session's final model, billed to the member
 * — a spent budget is refused there and nothing runs — one appended segment,
 * then the engine). Never a direct model call.
 *
 * What it spends, and when:
 *   - only a note on a chat in an interview — the member chose the chat —
 *     and only after the interviewee's consent in the chat;
 *   - only while this job holds the note (`transcribe_job`), and only once:
 *     the appended segment, its staged transcript and the deletion of the
 *     placeholder are one batch, with the event's record, so a retry after it
 *     finds nothing to do;
 *   - under the connection's daily cap, held in D1 and checked before the
 *     model runs — a D1 error throws, so it fails closed.
 * A note deleted at the source before its download is gone, and nothing is
 * kept; one already kept stays with the session. A refusal (the cap, the
 * budget, a download the provider refuses) gives the note back for the next
 * assignment to queue, with its code kept on the note for the thread read
 * (#1586). A provider or transcription that does not answer is tried again by
 * the job itself, VOICE_TRIES times in all (#1586); anything else that throws
 * is left to the queue's own retries.
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
  // D754 §4, D756 §1.5: no consent, no download and no model — before any other check.
  if (audioConsentRequired(provider) && note.thread.consent_state !== 'given') {
    await releaseVoiceNote(env, note.uid, job, 'no_consent');
    await end('failed', { ...fields, error: 'no_consent' });
    return;
  }
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
  // A provider's own wait (Telegram's retry_after, D756) stretches the next try, up to an hour.
  const tryAgain = async (code: 'provider_unreachable' | 'transcription_unavailable', retryAfterSec?: number) => {
    const attempt = Math.max(1, Number(p.try) || 1);
    if (attempt >= VOICE_TRIES) return giveBack('failed', code);
    await noteVoiceTry(env, note.uid, job, code);
    const scheduled = VOICE_RETRY_DELAYS[Math.min(attempt - 1, VOICE_RETRY_DELAYS.length - 1)];
    await enqueueChannelJob(env, 'channel_followup', provider, `${job}-try-${attempt + 1}`, { ...p, try: attempt + 1 }, {
      delaySeconds: Math.min(3600, Math.max(scheduled, Math.ceil(Number(retryAfterSec) || 0))),
    });
  };

  const conn = await memberConnection(env, Number(note.thread.user_id), provider);
  if (!conn || conn.integrationId !== Number(note.thread.integration_id)) return giveBack('ignored', 'unknown_connection');
  if (!(await memberStands(env, conn.userId))) return giveBack('ignored', 'member_inactive');
  if (!(await channelOpenToMember(env, conn.provider, conn.userId))) return giveBack('ignored', 'rollout');
  // The member's chat may have left its interview since the job was queued.
  if (!inInterview(note.thread)) return giveBack('ignored', 'not_assigned');
  // A bot the member switched off in Telegram fetches nothing, even for a note stored before (D756).
  if (provider === 'telegram' && (await telegram.telegramBusinessState(env, conn.userId)).state !== 'enabled') {
    return giveBack('failed', 'connection_disabled');
  }

  // D754 W3 (#1935): a declared type the recorder does not take is never downloaded.
  // A round video keeps its own reason (Telegram's fetch, D756 §1.4).
  if (note.media !== 'video_note' && note.mime && !audioMimeAdmitted(note.mime)) return giveBack('failed', 'unsupported_format');
  const audio = provider === 'telegram'
    ? await telegram.fetchTelegramVoice(env, note)
    : await whatsapp.fetchWhatsAppMedia(env, conn, note.file, note.mime);
  if (!audio.ok) {
    if (audio.retryable) {
      console.error(`[channels] voice download failed provider=${provider} code=${audio.code} try=${Number(p.try) || 1}`);
      return tryAgain('provider_unreachable', audio.retryAfterSec);
    }
    const fetchBy = voiceFetchBy(provider, { awaiting_transcription: true, sent_at: note.sentAt });
    const expired = provider === 'whatsapp' && 'lookup' in audio && audio.lookup === true
      && !['token_invalid', 'forbidden', 'not_connected'].includes(audio.code)
      && fetchBy !== null && Date.now() >= Date.parse(fetchBy);
    const code = expired ? 'expired' : audio.code;
    console.error('[channels] voice download refused provider=%s code=%s', provider, code);
    return giveBack('failed', code);
  }
  // D756 (#1896): the recorder's chunk is the memory bound; nothing larger reaches a model, or the day's cap.
  if (audio.bytes.byteLength > MAX_CHUNK_BYTES) return giveBack('failed', 'too_large');
  // D754 W3 (#1935): a file the recorder would not take spends nothing either.
  if (!admitAudio(audio.mime || null, sniffAudioContainer(audio.bytes)).ok) {
    return giveBack('failed', 'unsupported_format');
  }
  if (!(await reserveTranscription(env, conn.integrationId))) return giveBack('failed', 'transcription_cap');

  // D754 W3 (#1935), D756 (#1978): both providers' notes are kept as recorder
  // audio, transcribed by the recorder's stage, appended, then the engine.
  // The placeholder and the event's record go in the append's batch, so a
  // retry finds no note and does nothing.
  const record = event ? [finishEventStatement(env, event, 'done', fields)] : [];
  let kept: Awaited<ReturnType<typeof ingestChannelAudio>>;
  try {
    kept = await ingestChannelAudio(env, {
      sessionId: Number(note.thread.session_id), userId: conn.userId, seq: note.id, bytes: audio.bytes,
      declaredMime: audio.mime || null, mediaKind: note.media, side: note.side, provider,
      speakerLabel: note.side === 'me' ? 'Me' : (await intervieweeLabel(env, note.thread)) || 'Interviewee',
      alongside: [env.DB.prepare('DELETE FROM channel_thread_messages WHERE id = ? AND uid = ?').bind(note.id, note.uid), ...record],
    });
  } catch (err) {
    // The chat's interview or session went away while the note waited.
    if (err instanceof IntakeError && err.status === 404) return giveBack('ignored', 'not_assigned');
    throw err;
  }
  if (kept.ok) return;
  if (kept.reason !== 'transcription') return giveBack('failed', kept.reason);
  if (!kept.budget && !FINAL_REFUSAL.test(kept.refusal)) {
    console.error(`[channels] voice transcription failed provider=${provider} refusal=${kept.refusal} try=${Number(p.try) || 1}`);
    return tryAgain('transcription_unavailable');
  }
  return giveBack('failed', kept.refusal);
}

/**
 * `channel_followup` { kind: 'consent', thread, consent }: consent was given
 * in the chat (D754). Re-checked here — the row and the thread still 'given',
 * the member standing, the connection active and the thread's — then what
 * waited moves (`admitConsentedThread`, idempotent).
 */
export async function runConsentFollowup(env: Env, p: ChannelJobPayload): Promise<void> {
  const row = await env.DB.prepare('SELECT * FROM channel_consents WHERE uid = ?').bind(String(p.consent ?? '')).first<ConsentRow>();
  const thread = await env.DB.prepare('SELECT * FROM channel_threads WHERE uid = ?').bind(String(p.thread ?? '')).first<ThreadRow>();
  if (!row || !thread || row.status !== 'given' || thread.consent_state !== 'given' || Number(row.thread_id) !== Number(thread.id)) return;
  if (!(await memberStands(env, Number(thread.user_id)))) return;
  const conn = await memberConnection(env, Number(thread.user_id), thread.provider);
  if (!conn || conn.integrationId !== Number(thread.integration_id)) return;
  await admitConsentedThread(env, Number(thread.user_id), thread.id);
}

/** The import of a consented capture (D754 way B, #1938), queued once per capture. */
async function enqueueCaptureImport(env: Env, uid: string): Promise<void> {
  await enqueueChannelJob(env, 'channel_followup', 'whatsapp', `capture:${uid}`, { kind: 'capture', capture: uid, job: `capture:${uid}` });
}

/**
 * `channel_followup` { kind: 'capture', capture, job }: a capture the member
 * consented to becomes a draft interview (`whatsappCapture.importCapture`).
 * Re-checked here: Axal's number configured, the member standing, the rollout
 * open. A provider that does not answer is tried again by the job, VOICE_TRIES
 * times in all; after that the capture keeps its code until it expires. One
 * "Saved" reply from Axal's number when the import is done.
 */
export async function runCaptureFollowup(env: Env, p: ChannelJobPayload): Promise<void> {
  const uid = String(p.capture ?? '');
  const row = await env.DB.prepare('SELECT user_id, integration_id FROM whatsapp_captures WHERE uid = ?')
    .bind(uid).first<{ user_id: number; integration_id: number }>();
  if (!row || !waLink.axalNumberReady(env)) return;
  const userId = Number(row.user_id);
  if (!(await memberStands(env, userId)) || !(await channelOpenToMember(env, 'whatsapp', userId))) return;
  const attempt = Math.max(1, Number(p.try) || 1);
  const out = await capture.importCapture(env, uid, `${String(p.job ?? `capture:${uid}`)}#${attempt}`);
  if (out.done === 'retry') {
    if (attempt >= VOICE_TRIES) return;
    const delay = VOICE_RETRY_DELAYS[Math.min(attempt - 1, VOICE_RETRY_DELAYS.length - 1)];
    await enqueueChannelJob(env, 'channel_followup', 'whatsapp', `capture:${uid}-try-${attempt + 1}`, { ...p, try: attempt + 1 }, { delaySeconds: delay });
    return;
  }
  if (out.done !== 'imported') return;
  const link = await env.DB.prepare(
    "SELECT uid, credentials_enc FROM integrations WHERE id = ? AND user_id = ? AND provider_key = 'whatsapp_link' AND status = 'active'",
  ).bind(out.integrationId, userId).first<{ uid: string; credentials_enc: string | null }>();
  const to = link ? await waLink.linkedWaId(env, link) : null;
  if (to) await axalReply(env, userId, `wbcapture-saved:${uid}`, to, capture.CAPTURE_COPY.saved);
}

/** One `channel_followup` handler for both providers, by the payload's kind. */
export async function runChannelFollowup(env: Env, p: ChannelJobPayload): Promise<void> {
  if (p.kind === 'consent') return runConsentFollowup(env, p);
  if (p.kind === 'capture') return runCaptureFollowup(env, p);
  return runVoiceFollowup(env, p);
}

// Registered at module load: index.ts imports this file, so the handlers exist
// before the queue delivers anything (services/channels/jobs.ts).
registerChannelJob('channel_followup', 'telegram', runChannelFollowup);
registerChannelJob('channel_followup', 'whatsapp', runChannelFollowup);

// ---------------------------------------------------------------------------
// Admin
// ---------------------------------------------------------------------------

/** The webhook's address on this deployment, or null when there is no https base. The POST registers it; the GET checks it. */
function webhookUrl(env: Env): string | null {
  const base = String(env.PUBLIC_BASE_URL || env.APP_URL || '').trim().replace(/\/+$/, '');
  // Telegram delivers webhooks to HTTPS only.
  return /^https:\/\/[^/]+$/.test(base) ? `${base}/api/channels/telegram/webhook` : null;
}

/**
 * The interview bot's health (D756 §1.2), codes and numbers only. Unset
 * secrets: 503 with their NAMES, and no Telegram call. Otherwise 200, even
 * when Telegram does not answer: that half reads `reachable: false`.
 */
channelsAdmin.get('/telegram/webhook', async (c) => {
  await requireSuperAdmin(c);
  if (!providerAvailable(c.env, 'telegram')) {
    const missing = availability(c.env).find((a) => a.provider === 'telegram')?.missing ?? [];
    return no(c, 503, 'not_configured', { configured: false, missing });
  }
  const health = await telegram.readTelegramHealth(c.env, webhookUrl(c.env));
  return c.json({ configured: true, ...health, checked_at: new Date().toISOString() });
});

channelsAdmin.post('/telegram/webhook', async (c) => {
  await requireSuperAdmin(c);
  const url = webhookUrl(c.env);
  if (!url) return no(c, 503, 'base_url_missing');
  const r = await telegram.setTelegramWebhook(c.env, url);
  if (!r.ok) return no(c, r.code === 'not_configured' || r.code === 'secret_format' ? 503 : 502, r.code);
  return c.json({ ok: true, url, allowed_updates: [...telegram.TELEGRAM_ALLOWED_UPDATES] });
});

export default channels;
