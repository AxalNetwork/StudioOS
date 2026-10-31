/**
 * D1491 (#3725) — Event syndication's words and rules, pure.
 *
 * The canvas is `design/incoming/Event Syndication Page.dc.html` (boards SY0–SY8).
 * Part A's Worker core (D1490) holds the accounts, the per-event rows and the
 * log; until it ships, every screen reads `SYNDICATION_SERVICE_READY = false`
 * and says nothing posts. The status words, the skip sentences and the
 * button lines are fixed here, so wiring Part A's reads changes no copy.
 */
import { EVENT_TYPES } from '../../../lib/eventTypes.js';

/** Part A (D1490) is not on main: no account, row or log exists to read. */
export const SYNDICATION_SERVICE_READY = false;

export const CAPABILITY_LABEL = Object.freeze({
  creates_events: 'Creates events',
  posts_link: 'Posts a link',
});

/**
 * The five channels, in the canvas's order. `pendingOwner` marks the link-post
 * fallback (owner question D on #3725). `needs` is what must exist before the
 * channel can connect (owner step E, names only).
 */
export const CHANNELS = Object.freeze([
  { key: 'luma', name: 'Luma', capability: 'creates_events', pendingOwner: false,
    needs: 'Luma’s API needs a paid Luma plan and a calendar API key.' },
  { key: 'eventbrite', name: 'Eventbrite', capability: 'creates_events', pendingOwner: false,
    needs: 'Needs Axal’s Eventbrite organisation and app. Listings send people to Axal to register.' },
  { key: 'google_business', name: 'Google Business Profile', capability: 'creates_events', pendingOwner: false,
    needs: 'Needs a verified Business Profile location and Google’s API access approval.' },
  { key: 'linkedin', name: 'LinkedIn', capability: 'posts_link', pendingOwner: true,
    needs: 'Needs LinkedIn’s Community Management API approval for Axal’s Page.' },
  { key: 'facebook', name: 'Facebook', capability: 'posts_link', pendingOwner: true,
    needs: 'Needs Meta’s App Review for posting to Axal’s Page.' },
]);

export const channelOf = (key) => CHANNELS.find((c) => c.key === key) || null;

/**
 * SY1's status chip for one channel. `account` is Part A's account read, or
 * null; `serviceReady` is whether D1490's reads exist (defaults to the flag);
 * `adapterReady` is whether the channel's adapter exists.
 */
export function channelStatus(account, { serviceReady = SYNDICATION_SERVICE_READY, adapterReady = false, now = Date.now() } = {}) {
  if (!serviceReady && !account) {
    return { key: 'not_available', label: 'Not available yet', tone: 'muted', line: 'The syndication service is being built.' };
  }
  if (!account || account.status === 'disconnected') {
    return adapterReady
      ? { key: 'not_connected', label: 'Not connected', tone: 'muted', line: null }
      : { key: 'not_available', label: 'Not available yet', tone: 'muted', line: 'Waiting for the platform’s approval.' };
  }
  if (account.status === 'expired') return { key: 'expired', label: 'Expired', tone: 'red', line: 'Reconnect to keep posting.' };
  if (account.status === 'error') return { key: 'error', label: 'Error', tone: 'red', line: account.last_error || null };
  const exp = account.expires_at ? Date.parse(account.expires_at) : NaN;
  if (Number.isFinite(exp)) {
    const days = Math.ceil((exp - now) / 86_400_000);
    if (days <= 0) return { key: 'expired', label: 'Expired', tone: 'red', line: 'Reconnect to keep posting.' };
    if (days <= 14) return { key: 'expiring', label: `Expires in ${days} ${days === 1 ? 'day' : 'days'}`, tone: 'amber', line: null };
  }
  return { key: 'connected', label: 'Connected', tone: 'green', line: null };
}

/** SY3: one event's row status, in the canvas's words. */
export const ROW_STATUS = Object.freeze({
  selected: { label: 'Will post on approval', tone: 'muted' },
  pending: { label: 'Pending', tone: 'muted' },
  posted: { label: 'Posted', tone: 'green' },
  failed: { label: 'Failed', tone: 'red' },
  skipped: { label: 'Skipped', tone: 'muted' },
  cancelled: { label: 'Cancelled', tone: 'muted' },
  withdrawn: { label: 'Withdrawn', tone: 'muted' },
});

/** SY3: the line under a posted row after an edit. */
export function syncLine(row, channel) {
  const name = channelOf(channel)?.name || 'This channel';
  switch (row?.sync_state) {
    case 'in_sync': return 'Update sent';
    case 'pending': return 'Updating…';
    case 'failed': return 'Update failed · Retry';
    case 'unsupported': return `${name} can’t edit posts. Edit it on ${name} ↗`;
    default: return null;
  }
}

/** Part A's eligibility sentences (D1490), shown on a skipped row. */
export const SKIP_REASONS = Object.freeze([
  'Private event',
  'Not approved for the public calendar',
  'Event has started',
  'Account expired',
  'Host not allowed by HQ settings',
]);

/** SY5: the log's action and outcome words. */
export const LOG_ACTION = Object.freeze({
  connect: 'Connected', disconnect: 'Disconnected', select: 'Selected', unselect: 'Unselected',
  post: 'Posted', update: 'Updated', cancel: 'Cancelled', withdraw: 'Withdrawn',
  retry: 'Retried', skip: 'Skipped', import: 'Imported',
});
export const LOG_OUTCOME = Object.freeze({ ok: 'OK', failed: 'Failed', skipped: 'Skipped' });

/** SY4: a channel's registrations. A count the service did not import is "Not recorded", never 0. */
export function registrationsText(count) {
  return Number.isFinite(Number(count)) && count !== null ? String(Number(count)) : 'Not recorded';
}

/** SY2b: the approve button's sentence. */
export function approveLabel(channelsOn = 0) {
  const n = Math.max(0, Math.floor(Number(channelsOn) || 0));
  if (!n) return 'Approve and publish';
  return `Approve, publish and post to ${n} ${n === 1 ? 'channel' : 'channels'}`;
}

/**
 * SY2a: what the event editor says under Visibility. Only a public event can
 * syndicate; unlisted and private never post (Part A's eligibility rule).
 */
export function syndicateNote(visibility, { serviceReady = SYNDICATION_SERVICE_READY } = {}) {
  if (visibility !== 'public') return 'Unlisted and private events are never posted to other channels.';
  if (!serviceReady) {
    return 'Other channels: none yet. A public event is listed on axal.vc when an admin approves it. Listing it on Luma, Eventbrite, Google, LinkedIn and Facebook as well is being built.';
  }
  return 'Posts when an admin approves this event.';
}

/** SY2a: a per-channel edit's counter, "64 / 100", and whether it is over. */
export function charCount(text, limit) {
  const n = [...String(text || '')].length;
  return { text: `${n} / ${limit}`, over: Number.isFinite(limit) && n > limit };
}

/** SY6: the twelve event types, by the shared list. */
export const SETTINGS_TYPES = EVENT_TYPES;

/** SY6: the settings S1's spec proposes, pending the owner's answers A and C. */
export const PROPOSED_SETTINGS = Object.freeze({
  hosts: { value: 'approved_events', label: 'Any event an admin approves', alt: 'Events by admins only', pendingOwner: 'A' },
  hostAccounts: { value: false, label: 'Hosts may connect their own accounts', pendingOwner: 'C' },
});

/** The module's tabs, by address. */
export const TABS = Object.freeze([
  { key: 'channels', label: 'Channels', to: '/admin/platform/event-syndication' },
  { key: 'log', label: 'Activity', to: '/admin/platform/event-syndication/log' },
  { key: 'settings', label: 'Settings', to: '/admin/platform/event-syndication/settings' },
]);

export const tabFor = (pathname = '') => (/\/log\/?$/.test(pathname) ? 'log' : /\/settings\/?$/.test(pathname) ? 'settings' : 'channels');
