/**
 * D1210 (#3176) — the Calendar's grids, as pure rules, from the canvas
 * "Calendar" (CAL1 month, CAL2 week, CAL3 agenda, CAL6 the Kinds filter, CAL12
 * the day popover, CAL14 the Explorer). `frontend/test/calendar_grids_d1210.test.mjs`
 * holds each one.
 *
 * Everything here reads the page's one list (`inRange`); nothing counts a second
 * list, and a count the read did not give is never a 0.
 */
import { FAMILIES } from './calendarViews';

const pad = (n) => String(n).padStart(2, '0');

/** A local day as `YYYY-MM-DD`, the key every grid groups by. */
export const dayKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** `?date=YYYY-MM-DD` as a local midnight, or null when absent or not a real day. */
export function parseDay(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || ''));
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return dayKey(d) === s ? d : null;
}

/** The day a view is anchored on: `?date=`, else today. */
export function anchorOf(search = '', now = new Date()) {
  const day = parseDay(new URLSearchParams(String(search).replace(/^\?/, '')).get('date'));
  if (day) return day;
  const t = new Date(now); t.setHours(0, 0, 0, 0);
  return t;
}

/** The anchor one step back (-1) or on (+1): a month, a week, or a week of the agenda. */
export function shiftAnchor(view, anchor, dir) {
  const a = new Date(anchor);
  if (view === 'month') return new Date(a.getFullYear(), a.getMonth() + dir, 1);
  return new Date(a.getFullYear(), a.getMonth(), a.getDate() + 7 * dir);
}

const MONTH_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const WEEKDAY_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export const WEEKDAY_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** A day cell's screen-reader name: "Thursday 12 November, 3 items" (or "no items"); without a count when the list was not read. */
export function dayLabel(d, n) {
  const base = `${WEEKDAY_LONG[d.getDay()]} ${d.getDate()} ${MONTH_LONG[d.getMonth()]}`;
  if (n == null) return base;
  return `${base}, ${n === 0 ? 'no items' : n === 1 ? '1 item' : `${n} items`}`;
}

/** The month grid (CAL1): six Monday-first weeks, each day marked in or out of the month and today. */
export function monthCells(anchor, today = new Date()) {
  const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  const back = (first.getDay() + 6) % 7;
  const start = new Date(first.getFullYear(), first.getMonth(), 1 - back);
  const t = dayKey(today);
  return Array.from({ length: 42 }, (_, i) => {
    const date = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
    return { date, key: dayKey(date), inMonth: date.getMonth() === anchor.getMonth(), isToday: dayKey(date) === t };
  });
}

/** The week's seven days, Monday first (CAL2). */
export function weekDays(anchor) {
  const back = (anchor.getDay() + 6) % 7;
  return Array.from({ length: 7 }, (_, i) => new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate() - back + i));
}

const time = (v) => { const t = Date.parse(v); return Number.isFinite(t) ? t : null; };

/** An all-day item: the Worker says so, or it runs a whole day or more. */
export function isAllDay(ev) {
  if (ev?.all_day === true) return true;
  const s = time(ev?.start_at); const e = time(ev?.end_at);
  return s != null && e != null && e - s >= 86_400_000;
}

/** The list by local day of its start, each day in time order. An item with no readable start is left out and counted. */
export function byDay(items = []) {
  const out = new Map();
  let unplaced = 0;
  for (const ev of Array.isArray(items) ? items : []) {
    const s = time(ev.start_at);
    if (s == null) { unplaced += 1; continue; }
    const k = dayKey(new Date(s));
    if (!out.has(k)) out.set(k, []);
    out.get(k).push(ev);
  }
  for (const list of out.values()) list.sort((a, b) => (isAllDay(b) - isAllDay(a)) || String(a.start_at).localeCompare(String(b.start_at)));
  return { days: out, unplaced };
}

/** A month cell shows three items, then "+N more" (CAL1). */
export const MONTH_SHOWN = 3;
export function cellItems(list = [], shown = MONTH_SHOWN) {
  return { shown: list.slice(0, shown), more: Math.max(0, list.length - shown) };
}

/** The week's hours (CAL2: 07:00 to 21:00). */
export const HOURS = Object.freeze({ from: 7, to: 21 });

/**
 * One day's timed items placed on the hours: top and height as a share of the
 * day's span, and overlapping items side by side (lane of lanes). An item that
 * starts or ends outside the hours is clipped and says so (`clipped`). An item
 * with no end is drawn 30 minutes tall and says its end is not recorded.
 */
export function layoutDay(list = [], hours = HOURS) {
  const span = (hours.to - hours.from) * 60;
  const timed = list.filter((ev) => !isAllDay(ev) && time(ev.start_at) != null)
    .map((ev) => {
      const s = new Date(time(ev.start_at));
      const startMin = s.getHours() * 60 + s.getMinutes() - hours.from * 60;
      const e = time(ev.end_at);
      const noEnd = e == null || e <= time(ev.start_at);
      const endMin = noEnd ? startMin + 30 : startMin + Math.round((e - time(ev.start_at)) / 60_000);
      return { ev, startMin, endMin, noEnd };
    })
    .sort((a, b) => a.startMin - b.startMin || b.endMin - a.endMin);
  // Greedy lanes within each cluster of overlapping items.
  const placed = [];
  let cluster = []; let clusterEnd = -Infinity;
  const flush = () => { const of = Math.max(1, ...cluster.map((p) => p.lane + 1)); for (const p of cluster) p.of = of; cluster = []; };
  for (const it of timed) {
    if (it.startMin >= clusterEnd) { flush(); clusterEnd = -Infinity; }
    const used = new Set(cluster.filter((p) => p.endMin > it.startMin).map((p) => p.lane));
    let lane = 0; while (used.has(lane)) lane += 1;
    const p = { ...it, lane, of: 1 };
    cluster.push(p); placed.push(p);
    clusterEnd = Math.max(clusterEnd, it.endMin);
  }
  flush();
  return placed.map((p) => {
    const top = Math.max(0, p.startMin); const bottom = Math.min(span, p.endMin);
    return {
      ev: p.ev, lane: p.lane, of: p.of, noEnd: p.noEnd,
      clipped: p.startMin < 0 || p.endMin > span,
      hidden: bottom <= 0 || top >= span,
      top: (top / span) * 100, height: Math.max(((bottom - top) / span) * 100, 2.5),
    };
  });
}

/** The now line (CAL2): its place on the hours today, or null outside them or on another day. */
export function nowLine(day, now = new Date(), hours = HOURS) {
  if (dayKey(day) !== dayKey(now)) return null;
  const min = now.getHours() * 60 + now.getMinutes() - hours.from * 60;
  const span = (hours.to - hours.from) * 60;
  return min < 0 || min > span ? null : (min / span) * 100;
}

/**
 * Arrow keys move one day, up and down one week, Home and End to the week's
 * first and last day, within `len` cells. Any other key does not move.
 */
export function moveFocus(index, key, len, rowLen = 7) {
  const at = {
    ArrowLeft: index - 1, ArrowRight: index + 1, ArrowUp: index - rowLen, ArrowDown: index + rowLen,
    Home: index - (index % rowLen), End: index - (index % rowLen) + rowLen - 1,
  }[key];
  if (at == null) return null;
  return Math.min(len - 1, Math.max(0, at));
}

/* ------------------------------------------------------------------ *
 * The Kinds filter (CAL6), and the Explorer's calendar (CAL14)
 * ------------------------------------------------------------------ */

/** The families a profile's calendar carries: an Explorer's is Events and From other calendars (CAL14). */
export function familiesFor(role) {
  if (role === 'exploring') return FAMILIES.filter((f) => ['events', 'other'].includes(f.key));
  return FAMILIES;
}
export const kindsOfFamilies = (families) => families.flatMap((f) => f.kinds);

/** `?kinds=` as the set of kinds shown, or null for everything. Unknown words are dropped; nothing known left is everything. */
export function kindsFrom(search = '', allowed = []) {
  const raw = new URLSearchParams(String(search).replace(/^\?/, '')).get('kinds');
  if (raw == null) return null;
  const set = new Set(raw.split(',').map((s) => s.trim()).filter((k) => allowed.includes(k)));
  return set.size ? set : null;
}

/** The search with `?kinds=` set from a choice (every allowed kind is everything, so the parameter goes), keeping the rest. */
export function withKinds(search = '', chosen, allowed = []) {
  const p = new URLSearchParams(String(search).replace(/^\?/, ''));
  const all = !chosen || allowed.every((k) => chosen.has(k));
  if (all) p.delete('kinds'); else p.set('kinds', allowed.filter((k) => chosen.has(k)).join(','));
  const s = p.toString();
  return s ? `?${s}` : '';
}

/** The search with `?date=` set (today drops it). */
export function withDate(search = '', day, today = new Date()) {
  const p = new URLSearchParams(String(search).replace(/^\?/, ''));
  if (!day || dayKey(day) === dayKey(today)) p.delete('date'); else p.set('date', dayKey(day));
  const s = p.toString();
  return s ? `?${s}` : '';
}

/**
 * Each family's count for the panel: the sum of its kinds' counts, or null
 * (never 0) when the list was not read; `unread` names the kinds whose
 * source did not answer, so the family says "and one unread".
 */
export function familyCounts(families, counts) {
  return families.map((f) => {
    const vals = f.kinds.map((k) => counts?.[k]);
    const unread = f.kinds.filter((k, i) => vals[i] === '—');
    const nums = vals.filter((v) => typeof v === 'number');
    const read = vals.length > 0 && vals.some((v) => v !== null && v !== undefined);
    return { key: f.key, label: f.label, kinds: f.kinds, total: read ? nums.reduce((a, b) => a + b, 0) : null, unread };
  });
}

/** The three quick sets (CAL6). Deadlines carry no kind yet, so Hide deadlines shows every kind there is. */
export const QUICK_SETS = Object.freeze([
  { key: 'everything', label: 'Everything' },
  { key: 'needs', label: 'Only what needs me' },
  { key: 'no-deadlines', label: 'Hide deadlines' },
]);

/** An item that waits on the viewer's answer: they are invited and have not answered. */
export function needsMe(ev, myEmail) {
  if (!myEmail) return false;
  const mine = (Array.isArray(ev?.attendees) ? ev.attendees : []).find((a) => String(a.email || '').toLowerCase() === myEmail);
  return Boolean(mine) && (!mine.rsvp || mine.rsvp === 'invited');
}

/** The kinds a quick set picks (null = every kind). "Only what needs me" picks items, not kinds: it is `?needs=1`. */
export function quickKinds(key, allowed = []) {
  if (key === 'no-deadlines') return new Set(allowed.filter((k) => !(FAMILIES.find((f) => f.key === 'deadlines')?.kinds || []).includes(k)));
  return null;
}

/** `?needs=1`: only what waits on the viewer's answer. */
export const needsFrom = (search = '') => new URLSearchParams(String(search).replace(/^\?/, '')).get('needs') === '1';
export function withNeeds(search = '', on) {
  const p = new URLSearchParams(String(search).replace(/^\?/, ''));
  if (on) p.set('needs', '1'); else p.delete('needs');
  const s = p.toString();
  return s ? `?${s}` : '';
}
