/** D1491 (#3725) — event syndication words and rules for the mounted D1490 core. */
import { EVENT_TYPES } from '../../../lib/eventTypes.js';

/** Core reads are live; adapter availability comes from the Worker. */
export const SYNDICATION_SERVICE_READY = true;

export const CAPABILITY_LABEL = Object.freeze({
  creates_events: 'Creates events',
  posts_link: 'Posts a link',
});

/** Owner choices on #3725: HQ accounts, no Luma, link posts for LinkedIn/Facebook. */
export const CHANNELS = Object.freeze([
  { key: 'eventbrite', name: 'Eventbrite', capability: 'creates_events', pendingOwner: false,
    needs: 'Needs Axal’s Eventbrite organisation and app. Listings send people to Axal to register.' },
  { key: 'google_business', name: 'Google Business Profile', capability: 'creates_events', pendingOwner: false,
    needs: 'Needs a verified Business Profile location and Google’s API access approval.' },
  { key: 'linkedin', name: 'LinkedIn', capability: 'posts_link', pendingOwner: false,
    needs: 'Needs LinkedIn’s Community Management API approval for Axal’s Page.' },
  { key: 'facebook', name: 'Facebook', capability: 'posts_link', pendingOwner: false,
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
    return { key: 'not_available', label: 'Not available yet', tone: 'muted', line: 'The syndication service is unavailable.' };
  }
  if (!account || account.status === 'disconnected') {
    return adapterReady
      ? { key: 'not_connected', label: 'Not connected', tone: 'muted', line: null }
      : { key: 'not_available', label: 'Not available yet', tone: 'muted', line: 'Waiting for account approval and a posting connector.' };
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
  return typeof count === 'number' && Number.isFinite(count) && count >= 0 ? String(count) : 'Not recorded';
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
    return 'Channel choices are unavailable. Nothing is sent from this screen.';
  }
  return 'Posts when an admin approves this event.';
}

/** SY2a: a per-channel edit's counter, "64 / 100", and whether it is over. */
export function charCount(text, limit) {
  const n = String(text || '').length; // Same UTF-16 bounds as the Worker writer.
  return { text: `${n} / ${limit}`, over: Number.isFinite(limit) && n > limit };
}

/** SY6: the twelve event types, by the shared list. */
export const SETTINGS_TYPES = EVENT_TYPES;

/** The module's tabs, by address. */
export const TABS = Object.freeze([
  { key: 'channels', label: 'Channels', to: '/admin/platform/event-syndication' },
  { key: 'log', label: 'Activity', to: '/admin/platform/event-syndication/log' },
  { key: 'settings', label: 'Settings', to: '/admin/platform/event-syndication/settings' },
]);

export const tabFor = (pathname = '') => (/\/log\/?$/.test(pathname) ? 'log' : /\/settings\/?$/.test(pathname) ? 'settings' : 'channels');

/** Only https external destinations can be opened from provider responses. */
export function safeExternal(value) {
  try { const u = new URL(value); return u.protocol === 'https:' && !u.username && !u.password ? u.href : null; } catch { return null; }
}
export const eventReadValid = (v) => !!v && typeof v.eligible === 'boolean' && typeof v.approved === 'boolean' && Array.isArray(v.rows) && v.rows.every((r) => typeof r.account_uid === 'string' && typeof r.on === 'boolean' && typeof r.adapter_ready === 'boolean' && r.overrides && typeof r.overrides === 'object');
/** Each changed choice keeps all saved copy; posted rows are managed by Withdraw. */
export const copyOf = (overrides) => Object.fromEntries(Object.entries(overrides).filter(([, v]) => typeof v === 'string' && v.trim()));
export const choicesOf = (rows) => rows.filter((r) => r.status !== 'posted' && r.adapter_ready && CHANNELS.some((c) => c.key === r.channel)).map((r) => ({ account_uid: r.account_uid, on: r.on, overrides: copyOf(r.overrides) }));
export const copyInvalid = (row) => charCount(row.overrides.title, row.title_limit).over || charCount(row.overrides.description, row.text_limit).over || (!!row.overrides.ticket_url && (!safeExternal(row.overrides.ticket_url) || row.overrides.ticket_url.length > 2000));
/** A separate first write: a failed choice must never be followed by Approve. */
export async function approveWithChannels(api, admin, id, channels) {
  if (channels.length) await api.choose(id, channels);
  return admin.approve(id);
}
