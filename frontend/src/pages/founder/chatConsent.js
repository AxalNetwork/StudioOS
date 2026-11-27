/**
 * D754 (#1980) — a chat's recording consent, as Record a Session, the inbox
 * and the session page draw it. Pure: no React and no fetch, so
 * `frontend/test/record_consent_d754.test.mjs` holds every rule.
 *
 * THE WORKER DECIDES (#1893). A thread's `consent` (`GET /channels/threads/:uid`,
 * and the session read's `channel_consent`) says whether the chat waits for
 * consent, its status, and whether Axal may write in the chat now. A thread
 * from the list carries only `consent_status` and `reply_window_open`, which
 * `chatConsentOf` reads the same way. Nothing here guesses a state the
 * Worker did not send.
 *
 * Consent comes one of two ways (D754 §4): the interviewee's own Yes on
 * Axal's notice, asked in the chat, or the member's word, which the Worker
 * accepts only once the notice reached the chat.
 *
 * TELEGRAM (D756 §1.5, #1981). Only the interviewee's own YES counts: there
 * is no member's word (ruling 6). The member asks from Axal, which needs the
 * bot's reply right and the 24-hour window, or copies the notice into the
 * chat themselves; the Worker builds that notice (`notice_text`), never this file.
 */

const APP = { whatsapp: 'WhatsApp', telegram: 'Telegram' };
export const appName = (provider) => APP[provider] || 'the chat';

/** D756 ruling 6: the member's word stands in for the interviewee's on WhatsApp only. */
export const memberWordAllowed = (provider) => provider === 'whatsapp';

/** The member's word: the recorder's methods without "In the app" (`MEMBER_CONSENT_METHODS`). */
export const CHAT_CONSENT_METHODS = [
  ['verbal', 'Said yes out loud'],
  ['written', 'In writing'],
  ['pre_agreed', 'Agreed beforehand'],
];
const METHOD_WORD = Object.fromEntries(CHAT_CONSENT_METHODS);
const STATUSES = new Set(['not_asked', 'requested', 'given', 'declined', 'withdrawn']);

/**
 * The consent a thread carries: the detail read's `consent`, else the list
 * row's fields. `{ required: false }` for a chat that asks none (Telegram until D756).
 */
export function chatConsentOf(thread) {
  const c = thread?.consent;
  if (c && typeof c === 'object') {
    if (!c.required) return { required: false };
    return {
      required: true,
      status: STATUSES.has(c.status) ? c.status : 'not_asked',
      window_open: c.window_open === true,
      can_request: c.can_request === true,
      method: typeof c.method === 'string' ? c.method : null,
      source: typeof c.source === 'string' ? c.source : null,
      delivered_at: c.delivered_at || null,
      answered_at: c.answered_at || null,
      withdrawn_at: c.withdrawn_at || null,
      requested_at: c.requested_at || null,
      // D756 §1.5 (b): the notice the member may paste, as the Worker wrote it; null when it sends none.
      notice_text: typeof c.notice_text === 'string' && c.notice_text.trim() ? c.notice_text : null,
    };
  }
  if (thread?.consent_status == null) return { required: false };
  // The list's `awaiting` is a chat linked while it waits; the detail read names it `requested` or `not_asked`.
  const s = thread.consent_status === 'awaiting' ? 'not_asked' : thread.consent_status;
  return {
    required: true, status: STATUSES.has(s) ? s : 'not_asked', window_open: thread.reply_window_open === true,
    can_request: false, method: null, source: null, delivered_at: null, answered_at: null, withdrawn_at: null,
    requested_at: null, notice_text: null,
  };
}

/** D754 §5's sentence when Axal may not write in the chat. Nothing is sent. */
export function windowClosedSentence(name, provider = 'whatsapp') {
  const who = String(name || '').trim() || 'Your contact';
  const them = String(name || '').trim() || 'them';
  const app = appName(provider);
  return `${who} last wrote more than 24 hours ago, and ${app} only lets Axal write within 24 hours of their last message. Ask ${them} to send you a message from your ${app} Business app, then ask again.`;
}

/**
 * The two ways in Record a Session, with their words. `ask` is offered only
 * with the window open. Telegram has no "already agreed" (ruling 6).
 */
export function consentChoices(name, provider = 'whatsapp') {
  const who = String(name || '').trim() || 'They';
  if (provider === 'telegram') return { ask: { value: 'ask', label: 'Ask for consent in Telegram' }, agreed: null };
  return {
    ask: { value: 'ask', label: `Ask ${String(name || '').trim() || 'them'} in ${appName(provider)}` },
    agreed: { label: `${who} already agreed`, methods: CHAT_CONSENT_METHODS.map(([value, label]) => ({ value, label })) },
  };
}

/**
 * D756 §1.5: why Axal cannot send its notice in a Telegram chat now, so the
 * member copies it instead. Null when it can.
 */
export function noticeBlocked(thread, consent) {
  if (thread?.can_reply === false) return "The bot isn't allowed to reply in this chat";
  if (!consent?.window_open) return 'The person last wrote more than 24 hours ago';
  return null;
}

/** What the assign body carries for a choice (`channelsApi.assign`'s `consent`); null for none. */
export function consentTarget(choice) {
  if (choice === 'ask') return { ask: true };
  return Object.hasOwn(METHOD_WORD, choice || '') ? { method: choice } : null;
}

/**
 * May Start be pressed on this chat (D754 §11)? A chat that asks consent
 * and has none needs a choice: Ask, which needs the window open, or the
 * member's word. Null when Start may go on; else the sentence the footer shows.
 */
export function chatConsentBlock(consent, choice, name, provider = 'whatsapp') {
  if (!consent?.required || consent.status === 'given') return null;
  if (provider === 'telegram') {
    // D756 §1.5: Start waits for the interviewee's own YES in the chat; nothing else stands in for it.
    const who = String(name || '').trim() || 'your contact';
    if (consent.status === 'declined') return `${who[0].toUpperCase()}${who.slice(1)} said NO in Telegram, so their notes are not recorded.`;
    if (consent.status === 'withdrawn') return `${who[0].toUpperCase()}${who.slice(1)} replied STOP in Telegram.`;
    return consent.status === 'requested' ? `Start waits for ${who}'s YES in Telegram.` : `Ask ${who} for consent in Telegram first.`;
  }
  if (consent.status === 'declined') return `${String(name || '').trim() || 'Your contact'} declined. Nothing from this chat was kept.`;
  if (consent.status === 'withdrawn') return `${String(name || '').trim() || 'Your contact'} withdrew consent in ${appName(provider)}.`;
  if (choice === 'ask') return consent.window_open ? null : windowClosedSentence(name, provider);
  if (consentTarget(choice)) return null;
  const app = appName(provider);
  return `Ask ${String(name || '').trim() || 'them'} in ${app}, or say they already agreed.`;
}

/**
 * The session page's consent line (D754 §4, §11). `kind` tells the page what
 * else to draw: `withdrawn` offers the discard. `when` formats a time.
 */
export function consentLine(consent, name, { provider = 'whatsapp', when = shortTime } = {}) {
  if (!consent?.required) return null;
  const who = String(name || '').trim() || 'Your contact';
  const app = appName(provider);
  if (provider === 'telegram') {
    // D756 §1.5's five states: not asked, asked at <time>, YES at <time>, NO, or stopped.
    const at = (iso) => (iso ? when(iso) : null);
    switch (consent.status) {
      case 'given': return { kind: 'given', text: at(consent.answered_at) ? `YES at ${at(consent.answered_at)}` : 'YES' };
      case 'declined': return { kind: 'declined', text: 'NO' };
      case 'withdrawn': return { kind: 'withdrawn', text: 'Stopped' };
      case 'requested': return { kind: 'waiting', text: at(consent.requested_at) ? `Asked at ${at(consent.requested_at)}` : 'Asked' };
      default: return { kind: 'waiting', text: 'Not asked yet' };
    }
  }
  switch (consent.status) {
    case 'given': {
      const at = consent.answered_at ? when(consent.answered_at) : null;
      if (consent.source === 'member_attested' && Object.hasOwn(METHOD_WORD, consent.method || '')) {
        return { kind: 'given', text: `${who} already agreed: ${METHOD_WORD[consent.method]}${at ? `, recorded at ${at}` : ''}` };
      }
      return { kind: 'given', text: at ? `Agreed in ${app} at ${at}` : `Agreed in ${app}` };
    }
    case 'declined': return { kind: 'declined', text: `Declined in ${app}` };
    case 'withdrawn': return { kind: 'withdrawn', text: `${who} withdrew consent` };
    default: return { kind: 'waiting', text: `Waiting for ${who} to agree` };
  }
}

/** The member's word may be given once Axal's notice reached the chat (D754 §4). */
export const canAttest = (consent, provider = 'whatsapp') =>
  memberWordAllowed(provider) && !!consent?.required && consent.status === 'requested' && !!consent.delivered_at;

/** "18 Oct, 14:05": the day and the time, in the reader's own zone. */
export function shortTime(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}
