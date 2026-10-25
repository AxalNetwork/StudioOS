/**
 * D1036 (#2877, part 6 of #2387) — the host pages' shared header (MEV12a), in
 * the canvas's words: the crumb, the event's status and visibility, one
 * primary action that fits the status, the time line, the publish gate, and
 * the tabs. `/events/new` (MEV12b) has its own header with no tabs.
 *
 * Pure, so the tests can drive every status and day without a page.
 */
import { formatWord, statusOf, visibilityWord } from './myEventsModel';
import { registrationTab } from './eventOrganiserModel';

const time = (v) => {
  if (!v) return null;
  const t = Date.parse(String(v).includes('T') || String(v).endsWith('Z') ? v : `${String(v).replace(' ', 'T')}Z`);
  return Number.isFinite(t) ? t : null;
};

/** "Europe/Berlin" → "Berlin time"; UTC is UTC. */
export function zoneWords(zone) {
  if (!zone || zone === 'UTC' || zone === 'Etc/UTC') return 'UTC';
  const city = String(zone).split('/').pop().replace(/_/g, ' ');
  return `${city} time`;
}

/** The calendar day of `ms` in `zone`, as YYYY-MM-DD. */
export function dayIn(ms, zone) {
  try {
    return new Date(ms).toLocaleDateString('en-CA', { timeZone: zone || 'UTC', year: 'numeric', month: '2-digit', day: '2-digit' });
  } catch {
    return new Date(ms).toISOString().slice(0, 10);
  }
}

/**
 * Is today, in the event's own zone, one of its days (its start day through
 * its end day)? An event with no start is never on its day.
 */
export function onEventDay(event, now = Date.now()) {
  const start = time(event?.starts_at);
  if (start == null) return false;
  const zone = event?.timezone || 'UTC';
  const end = time(event?.ends_at) ?? start;
  const today = dayIn(now, zone);
  return today >= dayIn(start, zone) && today <= dayIn(Math.max(start, end), zone);
}

const clock = (ms, zone) => {
  try { return new Date(ms).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: zone }); }
  catch { return new Date(ms).toISOString().slice(11, 16); }
};

/** "Today · 17:00–20:00 Berlin time · In person · Venue, Berlin" (MEV12a's line). */
export function whenLine(event, now = Date.now()) {
  const start = time(event?.starts_at);
  if (start == null) return 'Date not recorded';
  const zone = event?.timezone || 'UTC';
  let day;
  if (dayIn(start, zone) === dayIn(now, zone)) day = 'Today';
  else {
    try { day = new Date(start).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: zone }).replace(',', ''); }
    catch { day = new Date(start).toISOString().slice(0, 10); }
  }
  const end = time(event?.ends_at);
  const hours = end != null && end > start ? `${clock(start, zone)}–${clock(end, zone)}` : clock(start, zone);
  const parts = [day, `${hours} ${zoneWords(zone)}`];
  const format = formatWord(event?.location_kind);
  if (format) parts.push(format);
  if (event?.location_text) parts.push(event.location_text);
  return parts.join(' · ');
}

/** The publish gate (MEV12a), the canvas's four lines; none for a draft, sent-back or cancelled event. */
export const GATE = {
  pub: 'Public ✓ · Sent for review ✓ · Approved by an admin ✓ → On the public calendar',
  wait: 'Public ✓ · Waiting for review → Not on the public calendar yet. An admin reviews public events first.',
  pri: 'Private · Published → Reached by invitation only.',
  unl: 'Unlisted · Published → Anyone with the link can register. Not on the public calendar.',
};
export function gateLine(event) {
  if (event?.status === 'pending_review') return { key: 'wait', text: GATE.wait, tone: 'warn' };
  if (event?.status !== 'published') return null;
  if (event.visibility === 'public') return { key: 'pub', text: GATE.pub, tone: 'muted' };
  if (event.visibility === 'private') return { key: 'pri', text: GATE.pri, tone: 'muted' };
  if (event.visibility === 'unlisted') return { key: 'unl', text: GATE.unl, tone: 'muted' };
  return null;
}

/** The status and visibility pills, with the canvas's marks. */
const STATUS_MARK = { draft: '✎', pending_review: '◷', published: '✓', rejected: '↩', cancelled: '✕' };
const VIS_MARK = { private: '◉', unlisted: '⌁', public: '◎' };
export function pillsOf(event) {
  const s = statusOf(event);
  return [
    { key: 'status', text: `${STATUS_MARK[event?.status] || ''} ${s.label}`.trim(), tone: s.tone },
    { key: 'visibility', text: `${VIS_MARK[event?.visibility] || ''} ${visibilityWord(event?.visibility)}`.trim(), tone: 'muted' },
  ];
}

/**
 * The header's one primary action for this status, on this tab:
 * - a draft or sent-back event: on Details the editor's own publish action
 *   (D1031's `publishAction`, whose label the editor passes, so the two never
 *   disagree); elsewhere the way to Details;
 * - waiting for review: no button, the line "Waiting for an admin";
 * - published: "Check in" on the event's day (but not on Check-in itself),
 *   else "Open event page";
 * - cancelled: nothing.
 */
export function primaryOf(event, { screen = 'details', now = Date.now(), publishLabel = null } = {}) {
  const id = event?.id;
  // On Details the editor's action decides alone: it offers one only when the event can be submitted.
  if (screen === 'details' && publishLabel) return { kind: 'publish', label: publishLabel };
  switch (event?.status) {
    case 'draft':
    case 'rejected':
      if (screen === 'details') return null;
      return { kind: 'link', label: event.status === 'rejected' ? 'Edit and resend' : 'Edit details', to: `/events/${id}/edit` };
    case 'pending_review':
      return { kind: 'note', label: 'Waiting for an admin' };
    case 'published':
      if (onEventDay(event, now) && screen !== 'check-in') return { kind: 'link', label: 'Check in', to: `/events/${id}/manage/check-in` };
      return event.slug ? { kind: 'link', label: 'Open event page', to: `/events/${event.slug}` } : null;
    default:
      return null;
  }
}

/**
 * Registrations' count: the people waiting for the host's decision, the
 * manage page's Pending tab. `null` when the roster was not read: the tab then
 * shows no number, never a 0.
 */
export function pendingCount(roster, approvalRequired) {
  if (!roster || !Array.isArray(roster.registrations)) return null;
  return roster.registrations.filter((r) => registrationTab(r, approvalRequired) === 'Pending').length;
}

/** Which host page a path is. */
export function screenOf(pathname) {
  const p = String(pathname || '').replace(/\/+$/, '');
  if (p.endsWith('/edit')) return 'details';
  if (p.endsWith('/manage/registrations')) return 'registrations';
  if (p.endsWith('/manage/agenda')) return 'agenda';
  if (p.endsWith('/manage/check-in')) return 'check-in';
  return 'eligibility';
}

/** MEV12b's line under "New event". */
export const NEW_EVENT_LINE = 'Public events go to an admin for review. Unlisted and private events publish at once.';

/** MEV13's count on Hosting, from `GET /api/admin/events?status=pending_review`'s total. */
export function waitingWords(reply) {
  const n = Number(reply?.total);
  if (reply == null || reply.total == null || !Number.isFinite(n) || n < 0) return null;
  return n === 0 ? 'None waiting.' : `${n.toLocaleString('en-US')} waiting.`;
}
