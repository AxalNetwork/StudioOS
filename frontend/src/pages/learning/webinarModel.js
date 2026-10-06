/**
 * Webinars' pure half (D560, #1161; drawn by D562): how a time is shown to the
 * viewer, what the seats line says, why the join link is or is not there, and
 * the studio's form and body. No React and no fetch, so a test reads every
 * rule here directly.
 *
 * THE SHAPES ARE THE ROUTES' OWN (`services/learningWebinars.ts`'s
 * `memberWebinar`, `routes/learning_webinars.ts`, `routes/admin_learning_webinars.ts`):
 *
 *   member  { uid, title, abstract, host_name, starts_at, ends_at, timezone,
 *             capacity, registered_count, seats_left, status, phase,
 *             recording_item_uid, join_url, join }
 *   list    the same without `join_url`, plus `registered` and `recording`
 *   admin   the stored row plus `registered_count`, and `registrations`
 *           [{ uid, name, registered_at, attended }]
 *
 * TIMES ARE THE VIEWER'S. `starts_at` and `ends_at` are UTC instants; a page
 * shows them in the viewer's own locale and zone, with the zone named, and
 * adds the time in the webinar's own `timezone` when that reads differently.
 *
 * NULL IS NOT ZERO. `capacity: null` is "no seat limit", never 0 seats (D560);
 * `attended: null` is "not recorded", never "did not attend".
 */
import { JOIN_LEAD_MS, durationLabel, parseInstant } from './learningModel';

const clean = (value) => String(value ?? '').trim();

// ── Times, in the viewer's locale and zone ─────────────────────────────────

const WHEN = { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' };
const DAY_TIME = { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' };
const TIME = { hour: 'numeric', minute: '2-digit', timeZoneName: 'short' };
const DATE = { day: 'numeric', month: 'short', year: 'numeric' };

/**
 * An instant in `locale` and `timeZone`; both default to the viewer's own
 * (`undefined` is the browser's). Null for no instant or a zone Intl does not
 * know, so nothing renders "Invalid Date".
 */
function formatIn(value, parts, { locale, timeZone } = {}) {
  const d = parseInstant(value);
  if (!d) return null;
  try {
    return new Intl.DateTimeFormat(locale, timeZone ? { ...parts, timeZone } : parts).format(d);
  } catch {
    return null;
  }
}

/** "Tue, 20 Oct 2026, 16:00 UTC" in en-GB; "Tue, Oct 20, 2026, 12:00 PM EDT" in en-US, New York. */
export const formatWebinarWhen = (value, opts) => formatIn(value, WHEN, opts);
/** "20 Oct, 16:00 UTC": the canvas's "[DD Mon] · [HH:MM TZ]". */
export const formatWebinarDayTime = (value, opts) => formatIn(value, DAY_TIME, opts);
/** "16:00 UTC". */
export const formatWebinarTime = (value, opts) => formatIn(value, TIME, opts);
/** "5 Oct 2026". */
export const formatWebinarDate = (value, opts) => formatIn(value, DATE, opts);

/** The viewer's own IANA zone, for the scheduler's default. */
export function viewerZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

/** Whether Intl knows this IANA zone. */
export function isZone(zone) {
  if (!clean(zone)) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: clean(zone) });
    return true;
  } catch {
    return false;
  }
}

/**
 * The start in the webinar's own zone, when that reads differently from the
 * viewer's: "Set in Europe/Oslo: Tue, 20 Oct 2026, 18:00 CEST". Null when the
 * route sends no zone, or the two read the same.
 */
export function ownZoneLine(webinar, { locale, timeZone } = {}) {
  const zone = clean(webinar?.timezone);
  if (!zone || !webinar?.starts_at) return null;
  const there = formatIn(webinar.starts_at, WHEN, { locale, timeZone: zone });
  if (!there) return null;
  return there === formatIn(webinar.starts_at, WHEN, { locale, timeZone }) ? null : `Set in ${zone}: ${there}`;
}

/** "1 h 00 min" from the start and the end; null when either is not recorded. */
export function webinarLength(webinar) {
  const start = parseInstant(webinar?.starts_at);
  const end = parseInstant(webinar?.ends_at);
  return start && end ? durationLabel((end.getTime() - start.getTime()) / 1000) : null;
}

/** A timer's longest useful wait; a page open longer re-arms as its clock ticks. */
const MAX_WAIT_MS = 24 * 60 * 60 * 1000;

/**
 * When a page left open should read the webinar again: as the join window
 * opens (the route then sends the link to a registered member), at the start,
 * and at the end (the recording, and no link). Null when none is ahead, or it
 * is more than a day away.
 */
export function nextRereadAt(webinar, now) {
  if (webinar?.status !== 'published') return null;
  const start = parseInstant(webinar.starts_at)?.getTime();
  const end = parseInstant(webinar.ends_at)?.getTime();
  const t = Number(now);
  if (!Number.isFinite(start) || !Number.isFinite(end) || !Number.isFinite(t)) return null;
  const next = [start - JOIN_LEAD_MS, start, end].find((at) => at > t);
  return next !== undefined && next - t <= MAX_WAIT_MS ? next : null;
}

// ── Seats and the join link ─────────────────────────────────────────────────

const num = (v) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));

/**
 * The seats, as the route returns them. `limit` is a number, `'none'` (the
 * route's `capacity: null`, no limit) or undefined (not sent: not recorded).
 * `left` is the route's `seats_left`; a payload without it (the studio's) is
 * counted from the capacity and the registrations.
 */
export function seatsOf(webinar) {
  const limit = webinar?.capacity === null ? 'none' : num(webinar?.capacity) ?? undefined;
  const count = num(webinar?.registered_count);
  let left = null;
  if (typeof limit === 'number') {
    left = num(webinar?.seats_left) ?? (count !== null ? Math.max(0, limit - count) : null);
  }
  return { limit, count, left, full: typeof limit === 'number' && left !== null && left <= 0 };
}

/** "capacity 50", "no seat limit", or null when the route sent no capacity. */
export function capacityLabel(seats) {
  if (seats.limit === 'none') return 'no seat limit';
  return typeof seats.limit === 'number' ? `capacity ${seats.limit}` : null;
}

/** "38 seats left", "1 seat left", "no seats left"; null with no limit. */
export function seatsLeftLabel(seats) {
  if (typeof seats.limit !== 'number' || seats.left === null) return null;
  if (seats.left <= 0) return 'no seats left';
  return `${seats.left} ${seats.left === 1 ? 'seat' : 'seats'} left`;
}

/**
 * The line under the actions: where the join link is, and when it comes. The
 * route's `join` says why a link is absent (`not_registered`, `not_yet`,
 * `ended`, `cancelled`), and `open` with no link means none was set.
 */
export function webinarJoinNote({ webinar, phase, registered, canJoin }) {
  if (canJoin) return 'Joining opens the host’s room in a new tab.';
  if (!registered) return phase === 'live' ? 'Register to receive the join link.' : 'Register to receive the join link, 15 minutes before the start.';
  if (webinar?.join === 'open' && !webinar?.join_url) return 'No join link has been set for this webinar yet.';
  return phase === 'live' ? 'No join link has been sent for this webinar.' : 'The join link appears here 15 minutes before the start.';
}

// ── Lists ───────────────────────────────────────────────────────────────────

/** The webinar's page: `/learning/webinars/:slug`, whose segment carries the uid (D562 departure 8). */
export function webinarHref(uid) {
  const u = clean(uid);
  return u ? `/learning/webinars/${encodeURIComponent(u)}` : null;
}

/**
 * One row of `GET /api/learning/webinars`, kept whole, with where it opens and
 * its `.ics` link. `icsUrl` is the client's own builder
 * (`learningApi.webinarIcsHref`), passed in so this module imports no client.
 */
export function webinarRow(w, icsUrl) {
  const uid = clean(w?.uid);
  return { ...w, href: webinarHref(uid), icsHref: uid && typeof icsUrl === 'function' ? icsUrl(uid) : null };
}

/** Whether a row answers a search; the route takes no query, so the page filters what it sent. */
export function matchesWebinar(row, query) {
  const needle = clean(query).toLowerCase();
  if (!needle) return true;
  return [row?.title, row?.abstract, row?.host_name].some((v) => String(v ?? '').toLowerCase().includes(needle));
}

// ── The studio ──────────────────────────────────────────────────────────────

/** What the studio says after a status change went through. */
export const WEBINAR_STATUS_NOTICE = {
  publish: 'Published.',
  unpublish: 'Unpublished: back to draft.',
  cancel: 'Cancelled. Its registered members see it marked as cancelled.',
};

/** Where a webinar opens in the studio. */
export function studioWebinarHref(uid) {
  return `/learning/studio?webinar=${encodeURIComponent(clean(uid))}`;
}

/**
 * Webinars as rows of the studio's content table (`StudioContentTable`), as
 * the canvas lists them beside videos and courses. `programs` is null: a
 * program cannot hold a webinar yet (D560, "Not in this change").
 */
export function webinarStudioRows(webinars) {
  return (webinars || []).map((w) => ({
    kind: 'webinar', uid: w.uid, title: w.title, status: w.status, visibility: w.visibility, programs: null,
    updated_at: w.updated_at, href: studioWebinarHref(w.uid),
  }));
}

/** Registrations by attendance; `attended: null` is counted as not recorded, never as absent. */
export function attendanceCounts(registrations) {
  const list = registrations || [];
  return {
    registered: list.length,
    attended: list.filter((r) => r.attended === true).length,
    absent: list.filter((r) => r.attended === false).length,
    unrecorded: list.filter((r) => r.attended !== true && r.attended !== false).length,
  };
}

/** The zones the scheduler offers: UTC, then every zone Intl knows. */
export function zoneOptions() {
  let zones = [];
  try {
    zones = typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : [];
  } catch {
    zones = [];
  }
  return ['UTC', ...zones.filter((z) => z !== 'UTC')];
}

/** What a clock in `zone` shows at `ms`, as numbers. */
function wallParts(ms, zone) {
  const p = {};
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: zone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(new Date(ms));
  for (const part of parts) p[part.type] = part.value;
  return { year: Number(p.year), month: Number(p.month), day: Number(p.day), hour: Number(p.hour) % 24, minute: Number(p.minute), second: Number(p.second) };
}

/** How far `zone`'s clock is ahead of UTC at `ms`. */
function offsetAt(ms, zone) {
  const p = wallParts(ms, zone);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(ms / 1000) * 1000;
}

const pad = (n) => String(n).padStart(2, '0');

/** A stored instant as a clock in `zone` reads it: `{ date: 'YYYY-MM-DD', time: 'HH:MM' }`, or blanks. */
export function wallTimeOf(value, zone) {
  const d = parseInstant(value);
  if (!d) return { date: '', time: '' };
  try {
    const p = wallParts(d.getTime(), clean(zone) || 'UTC');
    return { date: `${p.year}-${pad(p.month)}-${pad(p.day)}`, time: `${pad(p.hour)}:${pad(p.minute)}` };
  } catch {
    return { date: '', time: '' };
  }
}

/**
 * A date and a time read on a clock in `zone`, as the UTC instant the route
 * stores. Throws, before anything is sent, on a date that does not exist or a
 * time that clock skips when the clocks change.
 */
export function wallTimeToInstant(date, time, zone) {
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(clean(date));
  const t = /^(\d{2}):(\d{2})(?::\d{2})?$/.exec(clean(time));
  if (!d || !t || Number(t[1]) > 23 || Number(t[2]) > 59) throw new Error('The start is a date and a time, such as 16:00.');
  const [y, mo, dd, h, mi] = [Number(d[1]), Number(d[2]), Number(d[3]), Number(t[1]), Number(t[2])];
  const day = new Date(Date.UTC(y, mo - 1, dd));
  if (day.getUTCFullYear() !== y || day.getUTCMonth() !== mo - 1 || day.getUTCDate() !== dd) throw new Error(`${clean(date)} is not a date.`);
  const wall = Date.UTC(y, mo - 1, dd, h, mi);
  let at = wall - offsetAt(wall, zone);
  at = wall - offsetAt(at, zone);
  const back = wallTimeOf(new Date(at).toISOString(), zone);
  if (back.date !== `${d[1]}-${d[2]}-${d[3]}` || back.time !== `${t[1]}:${t[2]}`) {
    throw new Error(`${t[1]}:${t[2]} on ${clean(date)} does not exist in ${zone}: the clocks change then.`);
  }
  return new Date(at).toISOString();
}

/** Whole minutes from the start to the end, as the form holds them, or '' when either is missing. */
export function lengthMinutes(startsAt, endsAt) {
  const start = parseInstant(startsAt);
  const end = parseInstant(endsAt);
  if (!start || !end || end <= start) return '';
  return String(Math.round((end.getTime() - start.getTime()) / 60000));
}

/**
 * A webinar form as the studio holds it, from a stored webinar or blank. The
 * date and time are read on the webinar's own clock (`timezone`; none is UTC,
 * as the route shows it); a new webinar starts on the viewer's zone.
 */
export function webinarForm(webinar, zone = viewerZone()) {
  const tz = webinar ? clean(webinar.timezone) : clean(zone);
  const wall = wallTimeOf(webinar?.starts_at, tz || 'UTC');
  return {
    title: webinar?.title ?? '',
    abstract: webinar?.abstract ?? '',
    host_name: webinar?.host_name ?? '',
    date: wall.date,
    time: wall.time,
    length: lengthMinutes(webinar?.starts_at, webinar?.ends_at),
    timezone: tz,
    capacity: webinar?.capacity === null || webinar?.capacity === undefined ? '' : String(webinar.capacity),
    join_url: webinar?.join_url ?? '',
    visibility: webinar?.visibility ?? 'open',
  };
}

/**
 * The body `POST /webinars` and `PATCH /webinars/:uid` take. The date and time
 * are read on the chosen zone's clock and sent as a UTC instant; the end is
 * the start plus the length. An empty capacity is no limit (null), and an
 * empty join link is none. What the page cannot convert is refused here,
 * before anything is sent; everything else is the route's to judge, in its
 * own words.
 */
export function webinarBody(form) {
  const zone = clean(form.timezone);
  if (zone && !isZone(zone)) throw new Error('timezone is an IANA zone, such as Europe/Paris.');
  const date = clean(form.date);
  const time = clean(form.time);
  const length = clean(form.length);
  let startsAt = null;
  let endsAt = null;
  if (date || time) {
    if (!date || !time) throw new Error('A start needs both its date and its time.');
    startsAt = wallTimeToInstant(date, time, zone || 'UTC');
  }
  if (length) {
    if (!/^\d+$/.test(length) || Number(length) < 1) throw new Error('Length is a whole number of minutes, such as 60.');
    if (!startsAt) throw new Error('A length needs the start’s date and time.');
    endsAt = new Date(Date.parse(startsAt) + Number(length) * 60000).toISOString();
  }
  return {
    title: form.title,
    abstract: form.abstract,
    host_name: form.host_name,
    starts_at: startsAt,
    ends_at: endsAt,
    timezone: zone || null,
    join_url: clean(form.join_url) || null,
    capacity: clean(form.capacity) || null,
    visibility: form.visibility || 'open',
  };
}
