/**
 * D919 (#2702) — the Calendar tab's layout (EV8 month, EV8w week, EV17e list).
 * Pure: no React, no fetch.
 *
 * WHERE AN EVENT SITS. An event is placed on the day and at the time it
 * happens where it happens: its `starts_at` read in its own zone (`zoneOf`),
 * as every other line on the desk shows it. "Today" is the viewer's own date.
 * An event with no start is on no day; the tab counts them and says so.
 *
 * THE CLASH RULE IS D915 §2's: two events clash when neither is cancelled and
 * their times overlap; an event with no `ends_at` lasts one hour for this rule.
 * The times compared are the stored instants, so two events in different zones
 * clash only when they truly overlap.
 *
 * THE ADDRESS KEEPS THE MONTH AND THE VIEW: `?view=month|week|list`,
 * `?month=YYYY-MM`, and `?week=YYYY-MM-DD` (that week's Monday) in Week. With
 * no `view`, the phone opens on List and a wider screen on Month.
 */

import { CALENDAR_TAB_PATH, countText, countsFor, parseStamp, statusWord, titleOf, zoneOf } from './eventsDeskModel.js';

export const CALENDAR_PATH = CALENDAR_TAB_PATH;
export const CAL_VIEWS = [
  { key: 'month', label: 'Month' },
  { key: 'week', label: 'Week' },
  { key: 'list', label: 'List' },
];
export const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** Chips a month day shows before "+n more". */
export const CHIPS_PER_DAY = 3;
/** D915 §2: an event with no end lasts one hour for the clash rule. */
export const CLASH_HOUR_MS = 3_600_000;

/* ------------------------------------------------------------------ *
 * Dates as 'YYYY-MM-DD' keys; the arithmetic runs on UTC midnights
 * ------------------------------------------------------------------ */

const pad = (n) => String(n).padStart(2, '0');
const keyOf = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;
const asDate = (key) => new Date(`${key}T00:00:00Z`);
const fromDate = (d) => keyOf(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());

export const isDayKey = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || '')) && fromDate(asDate(s)) === s;
export const isMonthKey = (s) => /^\d{4}-(0[1-9]|1[0-2])$/.test(String(s || ''));

export function addDays(key, n) {
  const d = asDate(key);
  d.setUTCDate(d.getUTCDate() + n);
  return fromDate(d);
}

/** 0 for Monday … 6 for Sunday. */
export const weekdayOf = (key) => (asDate(key).getUTCDay() + 6) % 7;
export const mondayOf = (key) => addDays(key, -weekdayOf(key));
export const monthOf = (key) => key.slice(0, 7);

export function addMonths(month, n) {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return fromDate(d).slice(0, 7);
}

/** 'November 2026'. */
export function monthLabel(month) {
  const [y, m] = month.split('-').map(Number);
  return `${MONTH_NAMES[m - 1]} ${y}`;
}

/** 'Week of 9 Nov'. */
export function weekLabel(monday) {
  const d = asDate(monday);
  return `Week of ${d.getUTCDate()} ${MONTH_NAMES[d.getUTCMonth()].slice(0, 3)}`;
}

/** The viewer's own date. */
export function todayKey(now) {
  const d = new Date(now);
  return keyOf(d.getFullYear(), d.getMonth() + 1, d.getDate());
}

/* ------------------------------------------------------------------ *
 * An event's place: its day and minutes in its own zone
 * ------------------------------------------------------------------ */

const FORMATS = new Map();
function partsAt(ms, zone) {
  let f = FORMATS.get(zone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-GB', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
    FORMATS.set(zone, f);
  }
  const p = Object.fromEntries(f.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return { day: `${p.year}-${p.month}-${p.day}`, minute: Number(p.hour) * 60 + Number(p.minute) };
}

/**
 * Where an event sits: its day, its start and end minute on that day (the end
 * clipped to midnight; one hour when it has no end, as the clash rule reads
 * it), and its instants for the clash rule. Null when it has no start.
 */
export function placeOf(ev) {
  const start = parseStamp(ev?.starts_at);
  if (start === null) return null;
  const zone = zoneOf(ev);
  const at = partsAt(start, zone);
  const stored = parseStamp(ev?.ends_at);
  const end = stored !== null && stored > start ? stored : start + CLASH_HOUR_MS;
  const until = partsAt(end, zone);
  const endMinute = until.day === at.day ? Math.max(until.minute, at.minute + 15) : 24 * 60;
  return { day: at.day, startMinute: at.minute, endMinute: Math.min(endMinute, 24 * 60), start, end };
}

export const timeText = (minute) => `${pad(Math.floor(minute / 60))}:${pad(minute % 60)}`;

/* ------------------------------------------------------------------ *
 * Clashes (D915 §2)
 * ------------------------------------------------------------------ */

/** Each event's id → the ids it clashes with. Cancelled events and events with no start clash with nothing. */
export function clashMap(events) {
  const spans = (events || [])
    .filter((ev) => ev?.status !== 'cancelled')
    .map((ev) => ({ id: String(ev.id), place: placeOf(ev) }))
    .filter((x) => x.place)
    .sort((a, b) => a.place.start - b.place.start);
  const out = new Map();
  const link = (a, b) => {
    if (!out.has(a)) out.set(a, new Set());
    out.get(a).add(b);
  };
  for (let i = 0; i < spans.length; i += 1) {
    for (let j = i + 1; j < spans.length && spans[j].place.start < spans[i].place.end; j += 1) {
      link(spans[i].id, spans[j].id);
      link(spans[j].id, spans[i].id);
    }
  }
  return out;
}

/** '2 overlap': how many of a day's events clash with another. */
export const overlapText = (n) => `${n} overlap`;

/* ------------------------------------------------------------------ *
 * Chips
 * ------------------------------------------------------------------ */

/**
 * A chip's look and word (EV8's legend): Published plain; Waiting for review
 * dashed amber with "Review"; Draft and Sent back muted with the word;
 * Cancelled struck through with the word. Any other stored status is muted,
 * with its own word.
 */
export function chipStyle(status) {
  if (status === 'published') return { tone: 'plain', word: '' };
  if (status === 'pending_review') return { tone: 'review', word: 'Review' };
  if (status === 'draft' || status === 'rejected') return { tone: 'muted', word: statusWord(status) };
  if (status === 'cancelled') return { tone: 'cancelled', word: 'Cancelled' };
  return { tone: 'muted', word: statusWord(status) };
}

/** The legend, in EV8's order; Draft and Sent back share a key. */
export const LEGEND = [
  { tone: 'plain', label: 'Published' },
  { tone: 'review', label: 'Waiting for review' },
  { tone: 'muted', label: 'Draft or Sent back' },
  { tone: 'cancelled', label: 'Cancelled' },
];

function entryOf(ev, clashes) {
  const place = placeOf(ev);
  return { ev, id: String(ev.id), title: titleOf(ev), place, time: timeText(place.startMinute), ...chipStyle(ev.status), clashes: clashes.get(String(ev.id))?.size || 0 };
}

/** The placed events by day, each day's in start order. */
export function byDay(events) {
  const clashes = clashMap(events);
  const days = new Map();
  let unplaced = 0;
  for (const ev of events || []) {
    if (!placeOf(ev)) { unplaced += 1; continue; }
    const e = entryOf(ev, clashes);
    if (!days.has(e.place.day)) days.set(e.place.day, []);
    days.get(e.place.day).push(e);
  }
  for (const list of days.values()) list.sort((a, b) => a.place.start - b.place.start || a.title.localeCompare(b.title));
  return { days, unplaced };
}

/** A day's events and what its cell draws: the first CHIPS_PER_DAY chips, "+n more", and the overlap count. */
function dayCell(key, days, month, today) {
  const events = days.get(key) || [];
  return {
    key,
    date: Number(key.slice(8)),
    inMonth: monthOf(key) === month,
    today: key === today,
    events,
    chips: events.slice(0, CHIPS_PER_DAY),
    more: Math.max(0, events.length - CHIPS_PER_DAY),
    overlap: events.filter((e) => e.clashes > 0).length,
  };
}

/** EV8: the month in weeks, Monday to Sunday, from the Monday on or before the 1st to the Sunday on or after the last day. */
export function monthGrid(events, month, now) {
  const { days, unplaced } = byDay(events);
  const today = todayKey(now);
  const first = `${month}-01`;
  const last = addDays(`${addMonths(month, 1)}-01`, -1);
  const weeks = [];
  for (let monday = mondayOf(first); monday <= last; monday = addDays(monday, 7)) {
    weeks.push(Array.from({ length: 7 }, (_, i) => dayCell(addDays(monday, i), days, month, today)));
  }
  return { month, label: monthLabel(month), weeks, unplaced };
}

/**
 * Side by side (EV8w): a day's events in lanes. Events that overlap in time
 * (by their minutes on the day) form a group; each takes the first lane free
 * at its start, and the group's width is split by its lane count.
 */
export function laneOut(entries) {
  const sorted = [...entries].sort((a, b) => a.place.startMinute - b.place.startMinute || a.place.endMinute - b.place.endMinute);
  const out = [];
  let group = [];
  let groupEnd = -1;
  const close = () => {
    const lanes = Math.max(1, ...group.map((g) => g.lane + 1));
    for (const g of group) out.push({ ...g, lanes });
    group = [];
  };
  for (const e of sorted) {
    if (group.length && e.place.startMinute >= groupEnd) close();
    const busy = new Set(group.filter((g) => g.place.endMinute > e.place.startMinute).map((g) => g.lane));
    let lane = 0;
    while (busy.has(lane)) lane += 1;
    group.push({ ...e, lane });
    groupEnd = Math.max(groupEnd, e.place.endMinute);
  }
  if (group.length) close();
  return out;
}

/** EV8w: seven days from `monday`, each with its laid-out events, and the hours the grid spans (08:00–20:00 at least). */
export function weekGrid(events, monday, now) {
  const { days, unplaced } = byDay(events);
  const today = todayKey(now);
  const cols = Array.from({ length: 7 }, (_, i) => {
    const key = addDays(monday, i);
    const list = days.get(key) || [];
    return { key, label: `${WEEKDAYS[i]} ${Number(key.slice(8))}`, today: key === today, events: laneOut(list), overlap: list.filter((e) => e.clashes > 0).length };
  });
  const all = cols.flatMap((c) => c.events);
  const from = Math.min(8 * 60, ...all.map((e) => Math.floor(e.place.startMinute / 60) * 60));
  const to = Math.max(20 * 60, ...all.map((e) => Math.ceil(e.place.endMinute / 60) * 60));
  const hours = [];
  for (let m = from; m <= to; m += 60) hours.push(m);
  return { monday, label: weekLabel(monday), cols, from, to, hours, unplaced };
}

/** Where a block sits in the week grid, in percent of the column. */
export function blockBox(e, grid) {
  const span = grid.to - grid.from;
  return {
    top: ((e.place.startMinute - grid.from) / span) * 100,
    height: (Math.max(15, e.place.endMinute - e.place.startMinute) / span) * 100,
    left: (e.lane / e.lanes) * 100,
    width: 100 / e.lanes,
  };
}

/** EV17e: the month's events in start order, each with its day and its overlap note. */
export function monthList(events, month) {
  const { days, unplaced } = byDay(events);
  const rows = [...days.entries()]
    .filter(([key]) => monthOf(key) === month)
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .flatMap(([key, list]) => list.map((e) => ({
      ...e,
      day: { m: MONTH_NAMES[Number(key.slice(5, 7)) - 1].slice(0, 3).toUpperCase(), d: key.slice(8), w: WEEKDAYS[weekdayOf(key)].toUpperCase() },
      line: e.clashes ? `${e.time} · ${overlapText(list.filter((x) => x.clashes > 0).length)}` : e.time,
    })));
  return { month, label: monthLabel(month), rows, unplaced };
}

/**
 * The chip card's seats line, under Guard G: 'Seats 12 / 20', '9 taken · No
 * cap', or what stops the count ("Seats taken: Not in this read").
 */
export function seatsLine(ev, join) {
  const c = countsFor(join, ev?.id);
  const cap = ev?.capacity === null || ev?.capacity === undefined ? null : Number(ev.capacity);
  if (c.state !== 'ready' || c.taken === null) return `Seats taken: ${countText(c, 'taken').toLowerCase()}`;
  const taken = c.taken.toLocaleString('en-US');
  return cap === null ? `${taken} taken · No cap` : `Seats ${taken} / ${cap.toLocaleString('en-US')}`;
}

/* ------------------------------------------------------------------ *
 * The address
 * ------------------------------------------------------------------ */

/** The view, month and week the address names, with the phone's and today's defaults for what it does not. */
export function calendarState(search, now, phone = false) {
  const q = new URLSearchParams(search || '');
  const view = CAL_VIEWS.some((v) => v.key === q.get('view')) ? q.get('view') : phone ? 'list' : 'month';
  const today = todayKey(now);
  const week = isDayKey(q.get('week')) ? mondayOf(q.get('week')) : null;
  const month = isMonthKey(q.get('month')) ? q.get('month') : week ? monthOf(week) : monthOf(today);
  const monday = week || (monthOf(today) === month ? mondayOf(today) : mondayOf(`${month}-01`));
  return { view, month, monday, today };
}

/** The address for a view, a month or a week, keeping every other parameter (the filters). */
export function calendarSearch(search, next) {
  const q = new URLSearchParams(search || '');
  if (next.view) q.set('view', next.view);
  if (next.month) { q.set('month', next.month); q.delete('week'); }
  if (next.monday) { q.set('week', next.monday); q.set('month', monthOf(next.monday)); }
  if (q.get('view') !== 'week') q.delete('week');
  const s = q.toString();
  return s ? `?${s}` : '';
}

/** "Event 1 has no start date, so it is not on the calendar." */
export function unplacedLine(n) {
  if (!n) return null;
  return n === 1 ? 'One event has no start date, so it is not on the calendar.' : `${n.toLocaleString('en-US')} events have no start date, so they are not on the calendar.`;
}
