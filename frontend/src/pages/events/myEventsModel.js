/**
 * D1030 (#2387) — My events as pure functions: the tabs and their addresses,
 * who sees which, and every block built from the reads that exist today. No
 * React here, so `node --test` loads it alone.
 *
 * The reads (D1030 §2):
 *   - `GET /api/events` → `hosting` (every event the caller hosts, newest
 *     first) and `attending` (registered, confirmed, attended and waitlisted
 *     places, with `reg_status`, `reg_waitlist_position`, `comp` and
 *     `checkin_code`, the code only for a confirmed seat that is paid);
 *   - `GET /api/events/suggested` → up to eight upcoming events with a reason;
 *   - `GET /api/public/events` → the public calendar, for Discover.
 * Cancelled and declined places, invitations, per-event counts and the
 * review note are not in any read yet; the tab that would draw them says so.
 */

export const PATH = '/my/events';
export const TITLE = 'Events';
export const LINE = 'Events you’re going to, events you host, and what’s coming up.';
export const EXPLORER_LINE = 'Hosting opens once your profile is set.';
export const REPLAY_LINE = 'Events have no recording link yet.';
export const NOT_READ = 'Not read here yet';

export const TABS = [
  { key: 'upcoming', label: 'Upcoming', path: '' },
  { key: 'hosting', label: 'Hosting', path: '/hosting' },
  { key: 'discover', label: 'Discover', path: '/discover' },
  { key: 'past', label: 'Past', path: '/past' },
];
export const tabHref = (t) => `${PATH}${t.path}`;

export function tabOf(pathname) {
  const p = String(pathname || '').replace(/\/+$/, '');
  const t = TABS.find((x) => `${PATH}${x.path}` === p);
  return t ? t.key : 'upcoming';
}

/** An Explorer has no Hosting tab and no New event (MEV2). */
export const isExplorer = (user) => String(user?.role || '').toLowerCase() === 'exploring';
export const tabsFor = (user) => (isExplorer(user) ? TABS.filter((t) => t.key !== 'hosting') : TABS);

const time = (s) => {
  const t = new Date(s || '').getTime();
  return Number.isNaN(t) ? null : t;
};
/** An event is past once it has ended, or started when it has no end. */
export function isPast(e, now = Date.now()) {
  const end = time(e?.ends_at) ?? time(e?.starts_at);
  return end != null && end < now;
}

/** Your place at an event, in the canvas's words. */
export function placeOf(t) {
  switch (t?.reg_status) {
    case 'confirmed': return { key: 'going', label: 'Going', tone: 'good' };
    case 'registered': return { key: 'host', label: 'Waiting for the host', tone: 'warn' };
    case 'waitlisted': {
      const n = Number(t.reg_waitlist_position);
      return { key: 'waitlist', label: Number.isInteger(n) && n > 0 ? `Waitlist · #${n}` : 'Waitlist', tone: 'warn' };
    }
    case 'attended': return { key: 'checked', label: 'Checked in', tone: 'good' };
    default: return { key: 'other', label: 'Not recorded', tone: 'muted' };
  }
}

/** A hosted event's status, in the canvas's words; `rejected` is how the desk stores "Sent back". */
const STATUS = {
  draft: { label: 'Draft', tone: 'muted' },
  pending_review: { label: 'Waiting for review', tone: 'warn' },
  published: { label: 'Published', tone: 'good' },
  rejected: { label: 'Sent back', tone: 'bad' },
  cancelled: { label: 'Cancelled', tone: 'muted' },
};
export const statusOf = (e) => STATUS[e?.status] || { label: 'Not recorded', tone: 'muted' };

const VISIBILITY = { public: 'Public', unlisted: 'Unlisted', private: 'Private' };
export const visibilityWord = (v) => VISIBILITY[v] || 'Not recorded';
const FORMAT = { virtual: 'Online', online: 'Online', physical: 'In person', in_person: 'In person', hybrid: 'Hybrid' };
export const formatWord = (k) => FORMAT[k] || null;
export const whereOf = (e) => e?.location_text || formatWord(e?.location_kind) || 'Not recorded';

/** The 58px date tile: "NOV" over "14" over "THU", in the event's own zone when it has one. */
export function dateBlock(e) {
  const t = time(e?.starts_at);
  if (t == null) return null;
  const opt = (o) => {
    try { return new Date(t).toLocaleString('en-GB', { ...o, ...(e?.timezone ? { timeZone: e.timezone } : {}) }); }
    catch { return new Date(t).toLocaleString('en-GB', o); }
  };
  return { month: opt({ month: 'short' }).toUpperCase(), day: opt({ day: 'numeric' }), weekday: opt({ weekday: 'short' }).toUpperCase() };
}

/** "Thu 14 Nov · 18:30 · Europe/Lisbon"; the member's own time follows when the zone differs. */
export function timeLine(e, viewerZone) {
  const t = time(e?.starts_at);
  if (t == null) return 'Date not recorded';
  const zone = e?.timezone || 'UTC';
  const fmt = (z) => {
    try { return new Date(t).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: z }); }
    catch { return new Date(t).toISOString(); }
  };
  const own = fmt(zone);
  if (!viewerZone || viewerZone === zone) return `${own} · ${zone}`;
  let mine = '';
  try { mine = new Date(t).toLocaleString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: viewerZone }); } catch { mine = ''; }
  return mine ? `${own} · ${zone} · your time ${mine}` : `${own} · ${zone}`;
}

/** The tickets split by when, each list in date order: Upcoming soonest first, Past newest first. */
export function splitTickets(attending, now = Date.now()) {
  const list = (Array.isArray(attending) ? attending : []).slice().sort((a, b) => (time(a.starts_at) ?? 0) - (time(b.starts_at) ?? 0));
  return { upcoming: list.filter((t) => !isPast(t, now)), past: list.filter((t) => isPast(t, now)).reverse() };
}

/** Your next event is the soonest upcoming place that holds a seat or waits on the host (MEV1). */
export function nextEvent(upcoming) {
  return (upcoming || []).find((t) => ['confirmed', 'registered'].includes(t.reg_status)) || null;
}

/** The Going list's groups (MEV1): This week, Later this month, Later; an empty group is left out. */
export function goingGroups(rest, now = Date.now()) {
  const d = new Date(now);
  const week = now + 7 * 864e5;
  const monthEnd = new Date(d.getFullYear(), d.getMonth() + 1, 1).getTime();
  const groups = [
    { key: 'week', label: 'This week', rows: [] },
    { key: 'month', label: 'Later this month', rows: [] },
    { key: 'later', label: 'Later', rows: [] },
  ];
  for (const t of rest || []) {
    const s = time(t.starts_at) ?? Infinity;
    (s < week ? groups[0] : s < monthEnd ? groups[1] : groups[2]).rows.push(t);
  }
  return groups.filter((g) => g.rows.length);
}

/**
 * Needs you (MEV1) from what the reads hold: a hosted event an admin sent back.
 * Pay to confirm, invitations and off-the-waitlist need fields no read sends yet.
 */
export function needsYou(hosting) {
  return (hosting || []).filter((e) => e.status === 'rejected').map((e) => ({
    key: `sent-${e.id}`, pill: 'Sent back', text: `${e.title || 'An event'} was sent back by an admin.`, action: { label: 'Edit and resend', to: `/events/${e.id}/edit` },
  }));
}

/** Hosting soon (MEV1): the next two hosted events that have not ended and are not cancelled. */
export function hostingSoon(hosting, now = Date.now()) {
  return (hosting || []).filter((e) => !isPast(e, now) && e.status !== 'cancelled')
    .sort((a, b) => (time(a.starts_at) ?? 0) - (time(b.starts_at) ?? 0)).slice(0, 2);
}

/** Hosting's groups (MEV4), in the canvas's order; an empty group is hidden. */
export function hostingGroups(hosting, now = Date.now(), q = '') {
  const s = String(q || '').trim().toLowerCase();
  const list = (hosting || []).filter((e) => s.length < 2 || String(e.title || '').toLowerCase().includes(s))
    .slice().sort((a, b) => (time(a.starts_at) ?? 0) - (time(b.starts_at) ?? 0));
  const needs = (e) => e.status === 'rejected' || (e.status === 'draft' && isPast({ starts_at: e.starts_at }, now));
  const groups = [
    { key: 'needs', label: 'Needs you', rows: list.filter(needs) },
    { key: 'draft', label: 'Drafts', rows: list.filter((e) => e.status === 'draft' && !needs(e)) },
    { key: 'review', label: 'Waiting for review', rows: list.filter((e) => e.status === 'pending_review') },
    { key: 'published', label: 'Published', rows: list.filter((e) => e.status === 'published') },
    { key: 'cancelled', label: 'Cancelled', rows: list.filter((e) => e.status === 'cancelled') },
  ];
  return groups.filter((g) => g.rows.length);
}

/**
 * The one action that fits a hosted event's status (MEV4). Publishing and
 * sending for review open part 5's dialogs; until then they open the editor.
 */
export function hostAction(e) {
  if (e.status === 'rejected') return { label: 'Edit and resend', to: `/events/${e.id}/edit` };
  if (e.status === 'draft') return { label: 'Edit details', to: `/events/${e.id}/edit` };
  if (e.status === 'pending_review') return { label: null, note: 'Waiting for an admin' };
  if (e.status === 'published') return { label: 'Manage', to: `/events/${e.id}/manage` };
  return { label: null, note: null };
}

/** A hosted event belongs on Past once it ran or was cancelled; a draft that never ran stays on Hosting. */
export const pastHosted = (hosting, now = Date.now()) => (hosting || []).filter((e) => isPast(e, now) && ['published', 'cancelled'].includes(e.status));

/** Past's rows (MEV9): your past places and the events you hosted, newest first, each with its result. */
export function pastRows(attendingPast, hosting, now = Date.now()) {
  const went = (attendingPast || []).map((t) => ({
    key: `t-${t.id}`, event: t,
    result: t.reg_status === 'attended' ? 'Checked in' : t.reg_status === 'waitlisted' ? 'Waitlisted, no seat' : 'Registered, not checked in',
  }));
  const hosted = pastHosted(hosting, now).map((e) => ({
    key: `h-${e.id}`, event: e, result: e.status === 'cancelled' ? 'Event cancelled' : 'Hosted',
  }));
  return [...went, ...hosted].sort((a, b) => (time(b.event.starts_at) ?? 0) - (time(a.event.starts_at) ?? 0));
}

/** The counts on the tabs: each a number from a read, or null while it is out. */
export function tabCounts({ attending, hosting, ok }, now = Date.now()) {
  if (!ok) return { upcoming: null, hosting: null, past: null };
  const { upcoming, past } = splitTickets(attending, now);
  return { upcoming: upcoming.length, hosting: (hosting || []).length, past: past.length + pastHosted(hosting, now).length };
}

/** Discover's row action (MEV8), from what the caller already holds. */
export function discoverAction(ev, held) {
  if (held.has(ev.id)) return { label: 'Going', to: `/events/${ev.id}` };
  return { label: 'Open event', to: `/events/${ev.slug || ev.id}` };
}

/** A money figure in the event's own currency; free is "Free". */
export function priceOf(ev) {
  const cents = Number(ev?.price_cents);
  if (!Number.isFinite(cents) || cents <= 0) return 'Free';
  const code = /^[A-Za-z]{3}$/.test(String(ev?.currency || '')) ? String(ev.currency).toUpperCase() : 'USD';
  try { return (cents / 100).toLocaleString('en-US', { style: 'currency', currency: code, maximumFractionDigits: cents % 100 ? 2 : 0 }); }
  catch { return `${cents / 100} ${code}`; }
}
