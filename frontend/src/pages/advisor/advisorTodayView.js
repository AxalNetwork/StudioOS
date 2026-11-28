/**
 * D8732 (#8732) — what the Advisor Studio's Today card says, from
 * `advisorToday`'s answer: the day line, one row per booked session (a link to
 * its Calendar item), one group per open slot (its own label and action), the
 * read time and the Stale line. Built to boards SAV00 to SAV09 of
 * `design/incoming/Studio Home Advisor Page.dc.html`.
 *
 * Pure: the clock, the zone and the read time are handed in, so a Node test
 * can drive every row and every word (`advisor_today_sessions_8732.test.mjs`).
 * Times are written in one zone, the viewer's, named once on the day line, in
 * the 24-hour form the Calendar drawer's `whenLine` uses, so a row and the
 * drawer it opens say the same time.
 */
import { agendaKey, agendaStart } from '../studio/studioAgenda';
import { itemPath, zoneLabel } from '../calendarItemModel';
import { AWAITING_DECISION, slotView } from './advisory/kit';
import { agendaEnd, listNames } from './advisorToday';

const KIND = 'advisor_booking';

/** Today is Stale once its read is this old (SAV06F). */
export const STALE_AFTER_MS = 30 * 60_000;
/** Where an open slot's one action goes (SAV04 B). */
export const MANAGE_AVAILABILITY = '/practice/sessions';
/** The focus key a booked row carries out and back (`state.focus`). */
export const FOCUS_PREFIX = 'today-row-';

const millis = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const ms = new Date(value).getTime();
  return Number.isNaN(ms) ? null : ms;
};

function parts(ms, zone, options) {
  try {
    const f = new Intl.DateTimeFormat('en-GB', { timeZone: zone || undefined, ...options });
    return Object.fromEntries(f.formatToParts(new Date(ms)).map((p) => [p.type, p.value]));
  } catch {
    return null;
  }
}

/** "09:10", in the zone given. */
export function clock(ms, zone) {
  const o = parts(ms, zone, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  return o ? `${o.hour}:${o.minute}` : '';
}

/** "Thu 26 Nov 2026", or "Thu 26 Nov" without the year. */
export function dayWords(ms, zone, { year = true } = {}) {
  const o = parts(ms, zone, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
  if (!o) return '';
  return year ? `${o.weekday} ${o.day} ${o.month} ${o.year}` : `${o.weekday} ${o.day} ${o.month}`;
}

/** "2026-11-26", the Calendar's `?date=`. */
export function isoDay(ms, zone) {
  try {
    const f = new Intl.DateTimeFormat('en-CA', { timeZone: zone || undefined, year: 'numeric', month: '2-digit', day: '2-digit' });
    const o = Object.fromEntries(f.formatToParts(new Date(ms)).map((p) => [p.type, p.value]));
    return `${o.year}-${o.month}-${o.day}`;
  } catch {
    return '';
  }
}

/** The day in Calendar, anchored (`calendarGrid.anchorOf` reads `?date=`). */
export const dayHref = (iso) => (iso ? `/calendar/agenda?date=${iso}` : '/calendar');

/** "10:00–10:45" and its spoken form; a missing end omits the length rather than guessing it. */
export function span(startMs, endMs, zone) {
  if (startMs === null) return { time: 'Time not recorded', spoken: 'time not recorded', minutes: null };
  const s = clock(startMs, zone);
  if (endMs === null || endMs <= startMs) return { time: s, spoken: s, minutes: null };
  const e = clock(endMs, zone);
  return { time: `${s}–${e}`, spoken: `${s} to ${e}`, minutes: Math.round((endMs - startMs) / 60_000) };
}

/** "35 min ago", "2 h 5 min ago". */
export function ageWords(ms) {
  const mins = Math.max(0, Math.floor(ms / 60_000));
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const h = Math.floor(mins / 60), m = mins % 60;
  return m ? `${h} h ${m} min ago` : `${h} h ago`;
}

/** The client by name, never by email (D1419); the calendar copy's founder when only it answered. */
export function whoOf(item, copy) {
  const mentee = [item, copy].flatMap((x) => (Array.isArray(x?.attendees) ? x.attendees : []))
    .find((a) => a && a.role === 'mentee' && a.name);
  return item?.client_name || item?.founder_name || item?.user_name || mentee?.name || 'Client not recorded';
}

/** The booking's topic, or its calendar copy's title without the kind. */
export function topicOf(item, copy) {
  const title = String(item?.title || copy?.title || '').replace(/^Advisor session\s*—\s*/, '').trim();
  return item?.topic || copy?.topic || title || 'Topic not recorded';
}

/** "Video link recorded" or "No place recorded", only where a calendar copy was read; null when nothing says. */
export function placeOf(item, copy) {
  const read = copy || (item?.kind === KIND ? item : null);
  if (!read) return null;
  return read.location_uri ? 'Video link recorded' : 'No place recorded';
}

/** The status word and glyph of a booked row (SAV04's label table). Colour is never the only signal. */
export function statusOf(item, inProgress, endMs, zone) {
  if (inProgress) return { word: endMs !== null ? `In progress · until ${clock(endMs, zone)}` : 'In progress', glyph: '◉', tone: 'now' };
  const s = String(item?.status || '').trim().toLowerCase();
  if (s === 'confirmed') return { word: 'Confirmed', glyph: '✓', tone: 'good' };
  if (AWAITING_DECISION.includes(s)) return { word: 'Awaiting your answer', glyph: '◷', tone: 'wait' };
  if (s === 'completed') return { word: 'Completed', glyph: '✓', tone: 'neutral' };
  if (s === 'cancelled' || s === 'canceled') return { word: 'Cancelled', glyph: '✕', tone: 'out' };
  return { word: 'Status not recorded', glyph: '○', tone: 'neutral' };
}

const BY = { client: 'Cancelled by the founder', advisor: 'Cancelled by you', admin: 'Cancelled by an administrator', system: 'Cancelled with its slot' };
/** "Cancelled by the founder · ‘Travel clash’"; a machine reason code is not quoted. */
export function cancelLine(item) {
  const by = BY[String(item?.cancelled_by || '').toLowerCase()] || 'Cancelled';
  const reason = String(item?.cancel_reason || '').trim();
  return reason && reason !== 'slot_cancelled' ? `${by} · ‘${reason}’` : by;
}

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const idOf = (item) => {
  const key = agendaKey(item, KIND);
  const id = key ? key.slice(KIND.length + 1) : '';
  return /^\d+$/.test(id) ? id : null;
};

/**
 * The card's content. `today` is `advisorToday`'s answer; `readAt` when its
 * reads were asked; `now` the clock; `zone` the viewer's IANA zone.
 */
export function todayView(today, { now = new Date(), readAt = null, zone } = {}) {
  const t = now.getTime();
  const read = readAt ? readAt.getTime() : t;
  const day = dayWords(read, zone);
  const dayShort = dayWords(read, zone, { year: false });
  const date = isoDay(read, zone);
  const readClock = clock(read, zone);
  const { items = [], cancelled = [], openSlots = [], copies = new Map(), inProgress = new Set(), inputs = {}, loading = [], failed = [] } = today;

  const booked = (item, gone) => {
    const copy = copies.get(agendaKey(item, KIND)) || null;
    const startMs = millis(agendaStart(item));
    const endMs = agendaEnd(item);
    const when = span(startMs, endMs, zone);
    const id = idOf(item);
    const who = whoOf(item, copy);
    const topic = topicOf(item, copy);
    const status = gone ? statusOf({ status: 'cancelled' }, false, endMs, zone) : statusOf(item, inProgress.has(agendaKey(item, KIND)), endMs, zone);
    const action = gone ? 'View' : 'Open session';
    return {
      key: id ? `${KIND}:${id}` : `${when.time}-${who}`,
      id,
      state: gone ? 'cancelled' : 'booked',
      focus: id ? `${FOCUS_PREFIX}${id}` : null,
      href: id ? itemPath(KIND, id) : null,
      time: when.time,
      minutes: when.minutes,
      who,
      topic,
      detail: gone ? cancelLine(item) : [topic, 'Advisor session', placeOf(item, copy)].filter(Boolean).join(' · '),
      status,
      action,
      label: gone
        ? `View cancelled session: ${when.spoken}, ${who}, ${topic}, Cancelled`
        : `Open session: ${when.spoken}, ${who}, ${topic}, ${status.word}`,
      // What the drawer may show when it cannot read the item itself (SAV05A, SAV05B) and compare against (SAV05C).
      snapshot: { who, time: when.time, day: dayShort, date, readAt: readClock, status: gone ? 'cancelled' : String(item?.status || ''), statusWord: status.word, back: 'Back to Studio' },
      at: startMs,
    };
  };
  const rows = [...items.map((item) => booked(item, false)), ...cancelled.map((item) => booked(item, true))]
    .sort((a, b) => (a.at ?? Infinity) - (b.at ?? Infinity));

  const slots = openSlots.map((slot, index) => {
    const v = slotView(slot);
    const when = span(millis(v.startsAt), millis(v.endsAt), zone);
    return {
      key: `slot-${slot.id ?? index}`,
      time: when.time,
      minutes: when.minutes,
      label: `Open slot, ${when.spoken}, not booked`,
      detail: 'Date-specific · bookable from your public profile',
      href: MANAGE_AVAILABILITY,
    };
  });

  const sessions = items.length;
  const note = [
    sessions ? plural(sessions, 'session', 'sessions') : null,
    cancelled.length ? `${cancelled.length} cancelled` : null,
    loading.includes('slots') ? 'slots still reading' : slots.length ? plural(slots.length, 'open slot', 'open slots') : null,
  ].filter(Boolean).join(' · ') || 'Nothing scheduled';

  const answered = ['bookings', 'calendar', 'slots'].filter((k) => inputs[k] === 'ready');
  const age = t - read;
  const stale = readAt && age >= STALE_AFTER_MS ? { ago: ageWords(age), since: readClock } : null;
  const readLine = stale ? `Read ${readClock} · ${stale.ago}` : `Read ${readClock}${answered.length ? ` · ${listNames(answered)}` : ''}`;

  const next = today.nextBooking ? millis(agendaStart(today.nextBooking)) : null;
  return {
    day, dayShort, date, dayHref: dayHref(date),
    from: `From ${readClock}`,
    zone: zoneLabel(zone, new Date(read)) || '',
    note,
    rows,
    slots,
    readLine,
    stale,
    nextLine: next !== null ? `Your next booking is on ${dayWords(next, zone, { year: false })}.` : '',
    pending: loading,
    failed,
  };
}

/** The tile's sentence when nothing came back and a source failed (SAV06E): never an empty day. */
export function unavailableLine(failed) {
  const all = ['bookings', 'calendar', 'slots'].every((k) => failed.includes(k));
  return all
    ? 'Today could not be read. Your bookings, calendar and slots all failed. This is not the same as an empty day.'
    : `Today could not be read. Your ${listNames(failed)} could not be read, and the rest returned nothing. This is not the same as an empty day.`;
}

/** `state.focus` and `state.scroll` as Studio may trust them on return, or nulls. */
export function returnOf(state) {
  const focus = typeof state?.focus === 'string' && new RegExp(`^${FOCUS_PREFIX}\\d+$`).test(state.focus) ? state.focus : null;
  const scroll = Number.isFinite(state?.scroll) && state.scroll >= 0 ? state.scroll : null;
  return { focus, scroll };
}

/** The state a booked row's link carries to the Calendar drawer: where to go back to, what to focus, what Today read. */
export function rowState(row, from, scroll = null) {
  return { from, focus: row.focus, ...(Number.isFinite(scroll) ? { scroll } : {}), today: row.snapshot };
}
