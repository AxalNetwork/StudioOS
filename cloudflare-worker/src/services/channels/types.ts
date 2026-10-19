/**
 * D684 (#1575) — the contract every interview channel codes against.
 *
 * Four providers bring conversations into Validate › Interviews:
 *   telegram    — the Axal bot connected to a member's Telegram Business account
 *   whatsapp    — the member's own business number (Cloud API, Embedded Signup)
 *   zoom        — a Zoom meeting an interview scheduled; its cloud transcript
 *   google_meet — a Meet call an interview scheduled; its transcript entries
 *
 * An adapter (S19: telegram.ts, whatsapp.ts; S18: zoom.ts, googleMeet.ts) does
 * three things and nothing else: verify a request, normalise a payload into the
 * shapes below, and talk to its provider (send, fetch). Everything that touches
 * an interview goes through `services/interviewIntake.ts` and
 * `services/channels/threads.ts` (S01), which own tenancy, ownership re-checks,
 * encryption and idempotency. An adapter never writes interview tables itself.
 */

export const CHANNEL_PROVIDERS = ['telegram', 'whatsapp', 'zoom', 'google_meet'] as const;
export type ChannelProvider = typeof CHANNEL_PROVIDERS[number];
export const MESSAGING_PROVIDERS = ['telegram', 'whatsapp'] as const;
export type MessagingProvider = typeof MESSAGING_PROVIDERS[number];
export const MEETING_PROVIDERS = ['zoom', 'google_meet'] as const;
export type MeetingProvider = typeof MEETING_PROVIDERS[number];

/**
 * D754 §4 (#1893) — whether a chat on this provider keeps nothing until the
 * interviewee's consent is `given` (services/channels/consent.ts). Telegram
 * keeps D684's behaviour until D756 adds its own in-chat request and turns
 * this on. Lives here, in a file that imports nothing, so the session gate
 * and Customer research can read it without an import cycle.
 */
export const CONSENT_REQUIRED: Record<MessagingProvider, boolean> = { whatsapp: true, telegram: false };

/** False for anything that is not a messaging provider: a meeting, an assistant's client id, null. */
export function consentRequired(provider: string | null | undefined): boolean {
  return Object.prototype.hasOwnProperty.call(CONSENT_REQUIRED, String(provider ?? ''))
    && CONSENT_REQUIRED[provider as MessagingProvider] === true;
}

/** The providers whose chats wait for consent, for SQL (`json_each`). */
export const consentRequiredProviders = (): MessagingProvider[] =>
  MESSAGING_PROVIDERS.filter((p) => CONSENT_REQUIRED[p]);

/** The `submitted_via_name` an intake session shows, and the badge the UI draws. */
export const PROVIDER_LABEL: Record<ChannelProvider, string> = {
  telegram: 'Telegram',
  whatsapp: 'WhatsApp',
  zoom: 'Zoom',
  google_meet: 'Google Meet',
};

/** Limits shared by every messaging adapter (the paste-in path's own limits). */
export const CHANNEL_LIMITS = {
  /** Raw webhook body, bytes. Larger is refused before parsing. */
  maxBodyBytes: 256 * 1024,
  /** One message's text, characters (as `messagesToSegments`). */
  maxTextChars: 8000,
  /** A contact's display name, characters. */
  maxNameChars: 120,
  /** Pending (unassigned) messages are kept this long, then purged. */
  pendingDays: 30,
  /** A link code lives this long. */
  linkCodeMinutes: 10,
  /**
   * D754 way B (#1937): a member's linked WhatsApp lapses after this many
   * days without use, because phone numbers are reassigned (threads.ts purge).
   */
  senderLinkDays: 180,
  /**
   * Webhook events a single connection may deliver per minute, counted in D1
   * (`events.ts`; KV's one write per key per second could never reach it).
   */
  eventsPerMinute: 120,
  /**
   * Voice notes a single connection may have transcribed per UTC day, counted
   * in D1 and checked before the model runs: it fails closed. Only chats the
   * member assigned are transcribed at all.
   */
  transcriptionsPerDay: 50,
  /**
   * Free-form reply window, ms, counted for both providers from the contact's
   * last message (`last_inbound_at`, `replyWindowOpen` in threads.ts, D756).
   * WhatsApp: after it, only an approved template. Telegram Business: the bot
   * may reply only in chats that had incoming messages in the last 24 hours
   * (Bot API 10.3, BusinessBotRights.can_reply).
   */
  replyWindowMs: 24 * 60 * 60 * 1000,
} as const;

/**
 * Who a message is from, as the interview transcript will label it.
 *   'contact' — the member's customer (speaker label = the contact's name)
 *   'me'      — the member (speaker label 'Me'): a WhatsApp app echo, or a
 *               reply sent from Axal
 */
export type MessageSide = 'contact' | 'me';

/** One normalised message from a messaging provider. */
export interface InboundMessage {
  kind: 'message';
  provider: MessagingProvider;
  /** Unique per provider and event: the dedupe key in channel_events. */
  eventId: string;
  /**
   * The connection it arrived on, as the provider names it:
   *   telegram — the business_connection_id
   *   whatsapp — the metadata.phone_number_id
   * The intake maps it to a member; an adapter never does.
   */
  connectionRef: string;
  /** The customer conversation: Telegram chat.id, WhatsApp wa_id. */
  externalChatId: string;
  /** The provider's message id: Telegram message_id, WhatsApp wamid. */
  externalMessageId: string;
  side: MessageSide;
  /** The contact's display name, when the provider gives one. */
  contactName: string | null;
  /** Text, trimmed and capped at CHANNEL_LIMITS.maxTextChars; null for a voice note. */
  text: string | null;
  /**
   * A voice note to transcribe, when there is one. `fileRef` is what the
   * adapter's `fetchMedia` takes back (Telegram file_id, WhatsApp media id).
   */
  voice: { fileRef: string; mime: string | null; durationSec: number | null } | null;
  /** When the provider says it was sent (ISO). */
  sentAt: string;
}

/** A pending message edited at the source (Telegram edited_business_message). */
export interface InboundEdit {
  kind: 'edit';
  provider: MessagingProvider;
  eventId: string;
  connectionRef: string;
  externalChatId: string;
  externalMessageId: string;
  text: string;
}

/** Messages deleted at the source (Telegram deleted_business_messages). */
export interface InboundDelete {
  kind: 'delete';
  provider: MessagingProvider;
  eventId: string;
  connectionRef: string;
  externalChatId: string;
  externalMessageIds: string[];
}

/** A delivery report for a message Axal sent (WhatsApp statuses only). */
export interface InboundStatus {
  kind: 'status';
  provider: 'whatsapp';
  eventId: string;
  connectionRef: string;
  externalMessageId: string;
  status: 'sent' | 'delivered' | 'read' | 'failed';
  errorCode: string | null;
}

/** Telegram: the Axal bot was connected to, edited on, or removed from a business account. */
export interface InboundConnection {
  kind: 'connection';
  provider: 'telegram';
  eventId: string;
  businessConnectionId: string;
  /** The Telegram user who owns the business account. */
  telegramUserId: string;
  /** Their private chat with the bot, to message them about linking. */
  userChatId: string;
  isEnabled: boolean;
  canReply: boolean;
  rights: Record<string, boolean>;
}

/** Telegram: `/start <code>` in a private chat with the bot. */
export interface InboundLink {
  kind: 'link';
  provider: 'telegram';
  eventId: string;
  telegramUserId: string;
  /** The private chat to answer in. */
  chatId: string;
  /** Display name for the Connectors card: '@username' or first name. */
  displayName: string | null;
  /** Telegram's first/last name and username kept separately for pending consent. */
  accountName?: string | null;
  username?: string | null;
  code: string;
}

/**
 * Telegram: `/confirm` in a private chat with the bot — the Telegram account
 * that redeemed a link code agreeing to join the Axal account the bot named.
 */
export interface InboundLinkConfirm {
  kind: 'link_confirm';
  provider: 'telegram';
  eventId: string;
  telegramUserId: string;
  chatId: string;
  displayName: string | null;
}

/**
 * Telegram: the "manage this chat" button, `/start bizChat<chat id>`, in the
 * member's private chat with the bot (D756). `chatId` is that private chat, to
 * answer in; the managed chat's id is not carried.
 */
export interface InboundManageChat {
  kind: 'manage_chat';
  provider: 'telegram';
  eventId: string;
  telegramUserId: string;
  chatId: string;
}

/** Anything verified but not acted on (unsupported update types, groups, bots). */
export interface InboundIgnored {
  kind: 'ignored';
  provider: ChannelProvider;
  eventId: string;
  reason: string;
}

/**
 * D754 §4 (#1893): what may be the interviewee's answer to Axal's consent
 * notice — a reply button ('button'), or a whole message that is YES, NO or
 * STOP ('text'). Only the contact's side is ever one. Whether it counts is
 * decided by `consent.ts`, against the thread's open request and its notices;
 * a typed word that does not count is stored as the ordinary message it is
 * (`fallback`).
 */
export interface InboundConsentReply {
  kind: 'consent_reply';
  provider: MessagingProvider;
  eventId: string;
  connectionRef: string;
  externalChatId: string;
  externalMessageId: string;
  side: 'contact';
  answer: 'yes' | 'no' | 'stop';
  via: 'button' | 'text';
  /** The request uid a button carries; null for a typed word. */
  requestUid: string | null;
  /** The provider id of the message this one replies to (WhatsApp `context.id`). */
  contextMessageId: string | null;
  /** The typed message, as an ordinary message, for when the word does not count. Null for a button. */
  fallback: InboundMessage | null;
  sentAt: string;
}

export type InboundEvent =
  | InboundMessage | InboundEdit | InboundDelete | InboundStatus
  | InboundConnection | InboundLink | InboundLinkConfirm | InboundManageChat | InboundConsentReply | InboundIgnored;

/** What a send returns. `submitted` is acceptance by the provider, never delivery. */
export interface SendResult {
  ok: boolean;
  externalMessageId?: string;
  /** Machine code for a failure, e.g. 'window_closed', 'no_reply_right', 'rate_limited'. */
  code?: string;
  /** True when retrying later may succeed (429, 5xx, network). */
  retryable?: boolean;
  /** A 429's wait, in seconds, when the provider gave one (Telegram's `retry_after`, D756). */
  retryAfterSec?: number;
}

/**
 * One transcript passage from a meeting provider, already labelled. Offsets
 * are milliseconds from the start of the call when the provider gives them.
 */
export interface ImportedSegment {
  speaker: string;
  text: string;
  startMs: number | null;
  endMs: number | null;
}

/** Availability of a provider on this deployment: its platform secrets exist. */
export interface ProviderAvailability {
  provider: ChannelProvider;
  available: boolean;
  /** Missing secret NAMES (never values), for the admin; empty when available. */
  missing: string[];
}
