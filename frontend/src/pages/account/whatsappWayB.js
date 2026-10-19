// D754 way B (#1939, task fb) — "Send recordings from your WhatsApp": the
// rules for the section on WhatsApp's page and the "From WhatsApp" entry in
// Record a Session. The member links their own WhatsApp through Axal's
// number (wb1, routes/channels.ts `/channels/whatsapp/link`); nothing here
// touches way A's business number.
//
// Pure: no React, no fetch, so a test hands it each state.
import { isSuperAdminUser } from '../../lib/shellRole.js';

/** D754 §11's way-B words, and fb's (#1939). */
export const WAY_B = Object.freeze({
  heading: 'Send recordings from your WhatsApp',
  intro: 'Link the WhatsApp on your phone once. Then forward a voice note or an audio file of an interview to Axal, and it is saved to your workspace.',
  link: 'Link your WhatsApp',
  open: 'Open WhatsApp',
  confirm: 'Confirm',
  unlink: 'Unlink',
  sends: 'Axal only ever sends you the consent question and “Saved”, nothing else.',
  // The four settings wb1's `axalNumberReady` needs. Names only: a value is never drawn.
  settings: ['WHATSAPP_AXAL_ACCESS_TOKEN', 'WHATSAPP_AXAL_PHONE_NUMBER_ID', 'WHATSAPP_AXAL_WABA_ID', 'WHATSAPP_AXAL_DISPLAY_NUMBER'],
  unsetNotice: 'Send to Axal is off on this deployment. It needs all four of these settings, and at least one is not set:',
  unreadable: 'Your WhatsApp link could not be read. This is not a claim that you have none.',
});

/** fb's three steps for the "From WhatsApp" entry, in order. */
export const WHATSAPP_ENTRY_STEPS = [
  'Link your WhatsApp to Axal, once, from Connectors.',
  'Forward a voice note or an audio file of the interview to Axal on WhatsApp.',
  'Answer “Yes” in the chat when Axal asks whether everyone agreed.',
];
export const WHATSAPP_ENTRY_LIMIT = 'Up to 5 MB a recording.';
export const WHATSAPP_ENTRY_CONSENT = 'Everyone you recorded must have agreed before you recorded.';
export const WHATSAPP_PAGE_HREF = '/account/connectors/whatsapp';

const str = (v) => (typeof v === 'string' ? v.trim() : '');

/** The Worker's masked number ('•••• 1234'), or '' when it is not one. Never a full number. */
export function maskedNumber(v) {
  const s = str(v);
  return /^•••• \d{4}$/.test(s) ? s : '';
}

/** Only the Worker's own shape: wa.me, digits, `LINK <code>` typed. Anything else is not drawn. */
export function safeWaLink(href) {
  const s = str(href);
  return /^https:\/\/wa\.me\/\d{6,15}\?text=LINK%20[A-Za-z0-9]{24}$/.test(s) ? s : null;
}

/** The refusal wb1 sends when Axal's number is not set up. */
export function wayBUnavailable(error) {
  return error?.code === 'not_available' || (error?.status === 503 && !error?.code);
}

/**
 * Which way-B state the section draws, from `GET /channels/whatsapp/link`:
 *   loading      the read is under way;
 *   hidden       Axal's number is not set: the section is not drawn for a
 *                member; a Super Admin sees `notice`, the setting names;
 *   unreadable   the read failed for another reason: Retry;
 *   not_linked   **Link your WhatsApp**, with the last claim's sentence if it lapsed;
 *   linking      a code this tab made: the code, **Open WhatsApp**, its expiry;
 *   confirm      WhatsApp sent the code: "Is •••• 1234 your number?" **Confirm**;
 *   linked       the masked number, when it was last used, **Unlink**.
 * `read` is { status: 'loading' } | { status: 'ready', view } | { status: 'error', error }.
 * `code` is the POST's answer, which only this tab ever holds.
 */
export function wayBState(read, { user = null, code = null, now = Date.now() } = {}) {
  const superAdmin = isSuperAdminUser(user);
  if (!read || read.status === 'loading') return { state: 'loading' };
  if (read.status === 'error') {
    if (wayBUnavailable(read.error)) {
      return superAdmin ? { state: 'hidden', notice: `${WAY_B.unsetNotice} ${WAY_B.settings.join(', ')}.` } : { state: 'hidden', notice: '' };
    }
    return { state: 'unreadable', why: WAY_B.unreadable };
  }
  const view = read.view || {};
  const link = view.link && typeof view.link === 'object' ? view.link : null;
  const claim = view.claim && typeof view.claim === 'object' ? view.claim : null;
  if (link) {
    return {
      state: 'linked',
      number: maskedNumber(link.number_masked),
      linkedAt: str(link.linked_at),
      lastUsedAt: str(link.last_used_at),
    };
  }
  if (claim?.status === 'waiting_axal' && maskedNumber(claim.number_masked)) {
    return { state: 'confirm', uid: str(claim.uid), number: maskedNumber(claim.number_masked) };
  }
  const exp = Date.parse(str(code?.expires_at));
  const href = safeWaLink(code?.wa_link);
  if (code && href && Number.isFinite(exp) && exp > now) {
    return { state: 'linking', code: str(code.code), href, expires: expiresIn(exp - now) };
  }
  // A lapsed code this tab made says so; a lapsed or unreadable claim says its own sentence.
  const lapsed = code && Number.isFinite(exp) && exp <= now;
  const why = lapsed ? 'That code has expired. Make a new one.'
    : claim && ['expired', 'cancelled', 'unreadable'].includes(claim.status) ? str(claim.message) : '';
  return { state: 'not_linked', why };
}

/** "Expires in 10 minutes": whole minutes, rounded up, never "0 minutes". */
export function expiresIn(ms) {
  const m = Math.max(1, Math.ceil(ms / 60000));
  return `Expires in ${m} ${m === 1 ? 'minute' : 'minutes'}.`;
}

/** A refusal is the Worker's sentence; a bare code never reaches the page. */
export function wayBRefusal(e, fallback) {
  const msg = str(e?.message);
  return msg && msg !== e?.code && !/^[a-z0-9_]+$/.test(msg) ? msg : fallback;
}

/** "Last used 3 Oct" or "Not used yet", from the link's last_used_at. */
export function lastUsedLine(iso, fmt = defaultDate) {
  const t = Date.parse(str(iso));
  return Number.isFinite(t) ? `Last recording ${fmt(new Date(t))}.` : 'No recording sent yet.';
}

function defaultDate(d) {
  try { return new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' }).format(d); } catch { return d.toISOString().slice(0, 10); }
}
