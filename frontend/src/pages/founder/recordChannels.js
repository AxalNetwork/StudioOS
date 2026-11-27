/**
 * D1309 (#2507, #2515, #2525) — Record a session's channels, as the owner's
 * canvases draw them (`design/incoming/Record a session · WhatsApp Boards`,
 * `· Telegram Boards`, `· Calls Boards`, over `Session Channels Page.dc.html`):
 * one page per channel at its own address, sharing the chats inbox and the
 * session page that exist today.
 *
 *   /validate/record/whatsapp   WA1–WA13
 *   /validate/record/telegram   TG1–TG7
 *   /validate/record/calls      MC1–MC7
 *   /validate/inbox             the chats inbox both chat channels share (WA2, TG2)
 *   /validate/session/:id       a session's transcript (WA3, TG3, MC5)
 *
 * Pure, so the tests hold the addresses without a router.
 */

export const RECORD_BASE = '/validate/record';

export const RECORD_CHANNELS = Object.freeze([
  {
    key: 'whatsapp', label: 'WhatsApp', to: `${RECORD_BASE}/whatsapp`, connect: '/account/connectors/whatsapp', task: 2507, decision: 'D862', boards: 'WA1–WA13',
    builds: 'the guided connect, the chats inbox with consent, the transcript with its translation, conversation and venture analytics, and the data points to accept',
  },
  {
    key: 'telegram', label: 'Telegram', to: `${RECORD_BASE}/telegram`, connect: '/account/connectors/telegram', task: 2515, decision: 'D869', boards: 'TG1–TG7',
    builds: 'the Telegram connect, the shared inbox with the channel filter, round videos and edits in the transcript, analytics by channel, proposals, Send to Axal and MCP access',
  },
  {
    key: 'calls', label: 'Calls', to: `${RECORD_BASE}/calls`, connect: '/account/connectors/zoom', task: 2525, decision: 'D878', boards: 'MC1–MC7',
    builds: 'connecting Google Meet and Zoom, the next 14 days of calls, a call’s status, uploading a recording, the speaker transcript, decisions and actions, and retention',
  },
]);

/** The channel a location names, or null. */
export function channelOf(pathname) {
  const seg = String(pathname || '').replace(/\/+$/, '').slice(RECORD_BASE.length + 1);
  return RECORD_CHANNELS.find((c) => c.key === seg) || null;
}

/** The chats inbox both chat channels share. Its channel filter (TG2) is #2515's. */
export const INBOX = '/validate/inbox';

export const PAGE_LINE = 'Customer conversations on WhatsApp, Telegram and calls, turned into interview sessions once each person agrees.';
