/**
 * D1296 (#3392) — Content queue › Calendar, the rules behind ART7 (month),
 * ART8 (week, with a move) and ART13c (nothing scheduled). No React and no
 * fetch, so `frontend/test/content_calendar_d1296.test.mjs` holds each rule.
 *
 * WHAT IT READS. D1291's queue read with a date range:
 *   GET /admin/articles/queue?stage=calendar&from&to   scheduled and published articles,
 *       with `goes_out` (publish_at while scheduled, published_at once out) and,
 *       because a range is given, `publications`: Publications' issued rows.
 *   GET /admin/articles/queue?stage=ready              approved, with no time yet.
 * `from` and `to` are whole UTC days, at most 92 apart.
 *
 * TIME. Every time is stored in UTC. A chip sits on the day it goes out in
 * the READER's zone, and says its time there; the Move… dialog shows the
 * same instant in UTC beside it, so two admins in two zones agree. The zone
 * is passed in, so a test can pin one across a daylight-saving change.
 *
 * THINGS THIS FILE MUST NEVER DO: put a chip on its UTC day when the
 * reader's day differs; offer Move… on a published article or a
 * Publication; or read an empty range as anything but "nothing scheduled".
 */

const DAY = 86400000;
const pad = (n) => String(n).padStart(2, '0');

/** The reader's own zone, as the browser names it; UTC when it cannot say. */
export function readerZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

/** A day key `YYYY-MM-DD` from a calendar date held at UTC midnight. */
const keyOf = (d) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
const dateOf = (key) => new Date(`${key}T00:00:00Z`);
export const addDays = (key, n) => keyOf(new Date(dateOf(key).getTime() + n * DAY));

/**
 * An instant's date and time in a zone: `{ day: 'YYYY-MM-DD', time: 'HH:MM', hour }`,
 * or null when it does not parse.
 */
export function zoned(iso, zone) {
  const ms = Date.parse(String(iso ?? ''));
  if (!Number.isFinite(ms)) return null;
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(ms)).map((p) => [p.type, p.value]));
  return { day: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}`, hour: Number(parts.hour) };
}

/** `HH:MM UTC · Fri 23 Oct 2026` for an instant. */
export function utcLine(iso) {
  const ms = Date.parse(String(iso ?? ''));
  if (!Number.isFinite(ms)) return '';
  const d = new Date(ms);
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} UTC · ${dayLabel(keyOf(d), { year: true })}`;
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DOWS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
export const WEEKDAYS = DOWS;

/** "Fri 23 Oct" (or "Fri 23 Oct 2026" with `year`). */
export function dayLabel(key, { year = false } = {}) {
  const d = dateOf(key);
  const dow = DOWS[(d.getUTCDay() + 6) % 7];
  return `${dow} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()].slice(0, 3)}${year ? ` ${d.getUTCFullYear()}` : ''}`;
}

/** "October 2026" for a month cursor `{ y, m }` (m 1–12). */
export const monthTitle = ({ y, m }) => `${MONTHS[m - 1]} ${y}`;

/** The Monday on or before a day. */
export const mondayOf = (key) => addDays(key, -((dateOf(key).getUTCDay() + 6) % 7));

/** A month's grid: six weeks of seven days from the Monday on or before the 1st. */
export function monthGrid({ y, m }) {
  const start = mondayOf(`${y}-${pad(m)}-01`);
  return Array.from({ length: 6 }, (_, w) => Array.from({ length: 7 }, (_, i) => {
    const key = addDays(start, w * 7 + i);
    return { key, n: Number(key.slice(8)), inMonth: Number(key.slice(5, 7)) === m };
  }));
}

/** A week's seven days, Monday first, holding `key`. */
export const weekDays = (key) => Array.from({ length: 7 }, (_, i) => addDays(mondayOf(key), i));

/** The month after or before a cursor. */
export function shiftMonth({ y, m }, by) {
  const t = y * 12 + (m - 1) + by;
  return { y: Math.floor(t / 12), m: (t % 12) + 1 };
}

/**
 * The UTC days to read for a set of shown days. One day is added either
 * side, so a time that is the next or previous day in UTC than in the
 * reader's zone is still read. The read takes at most 92 days.
 */
export function readRange(keys) {
  const from = addDays(keys[0], -1);
  const to = addDays(keys[keys.length - 1], 1);
  if ((dateOf(to) - dateOf(from)) / DAY > 92) throw new Error('A calendar read spans at most 92 days.');
  return { from, to };
}

/**
 * The chips per day in the reader's zone. A scheduled article is `sch` and
 * carries Move…; a published one is `pub`, opens its article and does not
 * move; an issued Publication is `pn`, read only, and shown only when asked.
 * Within a day, chips run by time. Two scheduled at the same minute note it.
 */
export function chipsByDay(items, publications, zone, { showPublications = true } = {}) {
  const byDay = new Map();
  const add = (day, chip) => byDay.set(day, [...(byDay.get(day) || []), chip]);
  for (const a of Array.isArray(items) ? items : []) {
    const scheduled = a.stage === 'scheduled' || (a.status === 'approved' && a.publish_at);
    const published = a.status === 'published' || a.stage === 'published';
    const at = scheduled ? a.publish_at : published ? a.published_at : null;
    const z = zoned(at ?? a.goes_out, zone);
    if (!z || (!scheduled && !published)) continue;
    add(z.day, { kind: scheduled ? 'sch' : 'pub', id: a.id, title: String(a.title || '').trim() || 'Untitled', time: z.time, hour: z.hour, at: at ?? a.goes_out, move: !!scheduled });
  }
  if (showPublications && publications?.available !== false) {
    for (const p of Array.isArray(publications?.items) ? publications.items : []) {
      const z = zoned(p.published_at, zone);
      if (z) add(z.day, { kind: 'pn', id: `pn-${p.id}`, title: `Publication · ${String(p.title || '').trim() || 'Untitled'}`, time: z.time, hour: z.hour, at: p.published_at, move: false });
    }
  }
  for (const [day, list] of byDay) {
    list.sort((a, b) => a.time.localeCompare(b.time) || String(a.title).localeCompare(String(b.title)));
    byDay.set(day, list);
  }
  return byDay;
}

/** "2 at 09:00" when two scheduled articles share a minute that day, else ''. */
export function sameTimeNote(chips) {
  const seen = new Map();
  for (const c of chips || []) if (c.kind === 'sch') seen.set(c.time, (seen.get(c.time) || 0) + 1);
  const hit = [...seen].find(([, n]) => n > 1);
  return hit ? `${hit[1]} at ${hit[0]}` : '';
}

/** Whether nothing is scheduled among the shown days (ART13c). */
export function nothingScheduled(byDay, keys) {
  return !keys.some((k) => (byDay.get(k) || []).some((c) => c.kind === 'sch'));
}

/** Whether the shown days hold nothing at all: no article and no Publication. */
export function nothingShown(byDay, keys) {
  return !keys.some((k) => (byDay.get(k) || []).length);
}

/** The week's hour rows: the working day, widened to any hour a chip sits in. */
export function weekHours(byDay, keys) {
  const hours = keys.flatMap((k) => (byDay.get(k) || []).map((c) => c.hour));
  const lo = Math.min(8, ...hours);
  const hi = Math.max(18, ...hours);
  return Array.from({ length: hi - lo + 1 }, (_, i) => lo + i);
}

/** The latest a time may be set: a year from now, as the dialog says. */
export const YEAR_MS = 366 * DAY;

/**
 * Whether a new time (an ISO UTC string) may be sent, and if not why, in
 * the dialog's words. It must be in the future and within a year.
 */
export function moveProblem(iso, now = Date.now()) {
  const ms = Date.parse(String(iso ?? ''));
  if (!Number.isFinite(ms)) return 'Pick a date and a time.';
  if (ms <= now) return 'Pick a time in the future.';
  if (ms > now + YEAR_MS) return 'Pick a time within a year.';
  return null;
}

/** The other articles going out on a day, for the dialog's "Also going out that day". */
export function alsoThatDay(byDay, day, exceptId) {
  return (byDay.get(day) || []).filter((c) => c.kind === 'sch' && c.id !== exceptId).map((c) => `“${c.title}” at ${c.time}`);
}
