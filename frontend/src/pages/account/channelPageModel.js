/**
 * D753 (#1958, task C1) — the rules of an interview channel's own page,
 * `/account/connectors/whatsapp` and `/account/connectors/telegram`
 * (`ChannelPage.jsx`). The channels are not registry rows, so a channel page
 * reads `GET /api/channels` (`useChannelsOverview`) and never the connectors
 * catalogue. Pure: no React, no fetch, so
 * `frontend/test/channel_pages_d753.test.mjs` holds every rule.
 *
 * The words are the Worker's `CHANNEL_PAGES` (`connectorPages.ts`), from
 * D754 §11 and D756 §1.11; `cloudflare-worker/test/connector_pages_d753.test.ts`
 * imports this file and holds the two equal.
 */
import { CARD_TITLE, MESSAGING_PROVIDERS } from './channelsModel.js';

export const CHANNEL_PAGE_KEYS = Object.freeze([...MESSAGING_PROVIDERS]);

/** The band's tagline, About's paragraphs, the sign-in and the developer docs, per channel. */
export const CHANNEL_PAGE_TEXT = Object.freeze({
  whatsapp: Object.freeze({
    tagline: 'Customers’ chats with your business number wait here for 30 days. Add one to an interview.',
    about: Object.freeze([
      'Customers’ chats with your business number wait here for 30 days. Add one to an interview, and Axal asks the customer for consent in the chat before anything is recorded.',
      'Axal sends only what you ask it to, and only within 24 hours of the customer’s last message. Messages are billed by Meta to your WhatsApp Business Account after 1,000 a month.',
      'Calls stay closed on numbers connected through the WhatsApp Business app. Axal does not answer or place WhatsApp calls; use the in-app recorder with everyone’s consent instead.',
    ]),
    signIn: 'Meta sign-up',
    docs: 'https://developers.facebook.com/docs/whatsapp/cloud-api',
  }),
  telegram: Object.freeze({
    tagline: 'Telegram Business: the customer chats you choose, and their voice notes, into Validate.',
    about: Object.freeze([
      'What it reads: only the chats you choose in Telegram Business, each waiting in Interviews until you add it to an interview. Voice notes and audio files are taken in only after the person replies YES to the recording notice, and are kept until you delete them.',
      'What it sends: only what you send from Axal (replies and the notice), plus one line confirming YES, NO or STOP, within 24 hours of the person’s last message.',
      'What it can’t do: group chats, files over 5 MB, round videos for now. For a round video, send its audio track as an audio file up to 5 MB instead. Calls: Axal does not join, place or answer Telegram calls. Forwarded recordings (Send to Axal) are built but not switched on yet. When enabled, Axal waits for you to confirm everyone agreed before it downloads or transcribes the audio.',
      'Costs: transcription and translation use AI tokens. Translation keeps the original and adds your working language when needed. Up to 50 notes a day. Needs Telegram Premium: chatbots are part of Telegram Business.',
    ]),
    signIn: 'Telegram bot link',
    docs: 'https://core.telegram.org/bots/api',
  }),
});

/** Whether a page key is a channel's. `Array.includes`, so `__proto__` and `constructor` are not. */
export const isChannelKey = (key) => CHANNEL_PAGE_KEYS.includes(key);

/**
 * What a channel page draws, from one `useChannelsOverview()` read: loading,
 * unreadable, ready when `GET /api/channels` reports the provider, or unknown
 * when it does not.
 */
export function channelEntry({ channels, key } = {}) {
  if (!isChannelKey(key)) return { state: 'unknown' };
  const overview = channels?.overview ?? null;
  if (!overview) return channels?.status === 'loading' ? { state: 'loading' } : { state: 'unreadable' };
  return Object.hasOwn(overview.providers || {}, key) ? { state: 'ready', key } : { state: 'unknown' };
}

const STATUS = { true: 'Live', false: 'Not available yet' };

/** Details for a channel: Category, Status, Plan, Sign-in and Documentation. Status unread is said, never guessed. */
export function channelDetailsRows(key, overview) {
  const text = CHANNEL_PAGE_TEXT[key];
  const available = overview?.providers?.[key]?.available;
  return [
    { label: 'Category', value: 'Customer conversations', reason: null },
    typeof available === 'boolean'
      ? { label: 'Status', value: STATUS[available], reason: null }
      : { label: 'Status', value: null, reason: 'Axal did not say whether this is switched on.' },
    { label: 'Plan', value: 'Free', reason: null },
    { label: 'Sign-in', value: text.signIn, reason: null },
    { label: 'Documentation', value: text.docs, reason: null, href: text.docs },
  ];
}

export function channelPageTitle(entry) {
  return entry?.state === 'ready' ? `${CARD_TITLE[entry.key]} · Connectors · Axal VC` : 'Connectors · Axal VC';
}
