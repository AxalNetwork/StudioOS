/**
 * D4813 (#4813, package 3) — the Cohorts calendar's model, with no React in it.
 *
 * What the Month, Week and Agenda views decide, as plain functions:
 *
 *   · WHAT AN EVENT IS. Week opens, deliverable deadline, Demo Day, advisor
 *     session, group mentoring session — each with a word and a shape, so a
 *     type never depends on colour alone. A group session is ONE event (the
 *     Worker collapses the bookings of one slot); its founders are inside it.
 *   · WHICH DAY. Days are the Lab's (`America/New_York`, named on the page),
 *     keyed `YYYY-MM-DD` in that zone, so an 23:59 deadline is not drawn on the
 *     next day for a reader in another zone.
 *   · WHAT CLASHES, IN WORDS. The Worker pairs conflicting events (an ongoing
 *     session included); `conflictText` says which two, when, by how long, and
 *     which one is already under way.
 *   · WHAT IS MISSING. A calendar with one half unread is drawn with the half
 *     it has and a sentence naming the half it lacks — never blank.
 *
 * Nothing here invents an event: a type the Worker did not send is derived
 * from the fields it did, and an unparseable time is left out.
 */

import { cohortLabel } from './cohortModel';

export const LAB_TZ = 'America/New_York';
const DAY = 86_400_000;

/** The five event types, in legend order. `glyph` is the shape. */
export const EVENT_TYPES = {
  week_opens: { label: 'Week opens', glyph: '◇' },
  deadline: { label: 'Deliverable deadline', glyph: '⚑' },
  demo_day: { label: 'Demo Day', glyph: '★' },
  session: { label: 'Advisor session', glyph: '●' },
  group_session: { label: 'Group mentoring', glyph: '◎' },
};
export const TYPE_ORDER = Object.keys(EVENT_TYPES);

/** The type of an event, from the Worker's `type` or, for an older payload, its kind and ref. */
export function eventType(ev) {
  if (ev && EVENT_TYPES[ev.type]) return ev.type;
  if (ev?.kind === 'demo_day') return 'demo_day';
  if (ev?.kind === 'client') return (ev.participants || []).length > 1 ? 'group_session' : 'session';
  if (/:deadline$/.test(String(ev?.ref || ''))) return 'deadline';
  return 'week_opens';
}

const ms = (iso) => {
  if (!iso) return NaN;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : NaN;
};

function parts(t, tz = LAB_TZ) {
  const out = {};
  try {
    for (const p of new Intl.DateTimeFormat('en-US', {
      timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).formatToParts(new Date(t))) out[p.type] = p.value;
  } catch {
    const d = new Date(t).toISOString();
    return { year: d.slice(0, 4), month: d.slice(5, 7), day: d.slice(8, 10), hour: d.slice(11, 13), minute: d.slice(14, 16) };
  }
  return out;
}

/** The Lab day an instant falls on, `YYYY-MM-DD`, or null. */
export function dayKey(iso, tz = LAB_TZ) {
  const t = typeof iso === 'number' ? iso : ms(iso);
  if (!Number.isFinite(t)) return null;
  const p = parts(t, tz);
  return `${p.year}-${p.month}-${p.day}`;
}

/** "14:30" in the Lab's zone. */
export function clockTime(iso, tz = LAB_TZ) {
  const t = ms(iso);
  if (!Number.isFinite(t)) return null;
  const p = parts(t, tz);
  return `${p.hour}:${p.minute}`;
}

// Calendar arithmetic on plain dates: a key is a date, not an instant, so it is
// stepped at UTC noon where no zone's offset can move it to another day.
const keyMs = (key) => Date.parse(`${key}T12:00:00Z`);
const msKey = (t) => new Date(t).toISOString().slice(0, 10);
export const addDays = (key, n) => msKey(keyMs(key) + n * DAY);
/** 0 = Monday … 6 = Sunday. */
const weekday = (key) => (new Date(keyMs(key)).getUTCDay() + 6) % 7;
export const startOfWeek = (key) => addDays(key, -weekday(key));
export const startOfMonth = (key) => `${key.slice(0, 7)}-01`;
export function addMonths(key, n) {
  const [y, m] = key.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1, 12));
  return msKey(d.getTime());
}

const WEEKDAY_FMT = { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' };
/** "Tue Mar 16" for a day key. */
export function dayTitle(key) {
  try { return new Intl.DateTimeFormat('en-US', WEEKDAY_FMT).format(new Date(keyMs(key))); } catch { return key; }
}
/** "November 2026" for a month key. */
export function monthTitle(key) {
  try { return new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'long', year: 'numeric' }).format(new Date(keyMs(key))); } catch { return key.slice(0, 7); }
}
export const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** "Nov 9 – 15, 2026" for the week starting at `key`. */
export function weekTitle(key) {
  const end = addDays(key, 6);
  const f = (k, o) => new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', ...o }).format(new Date(keyMs(k)));
  try {
    return key.slice(0, 7) === end.slice(0, 7)
      ? `${f(key, { month: 'short', day: 'numeric' })} – ${f(end, { day: 'numeric' })}, ${end.slice(0, 4)}`
      : `${f(key, { month: 'short', day: 'numeric' })} – ${f(end, { month: 'short', day: 'numeric' })}, ${end.slice(0, 4)}`;
  } catch { return `${key} – ${end}`; }
}

// ── The stream ────────────────────────────────────────────────────────────

/**
 * Every event the read returned: `events` (the whole cycle and every session
 * read) when the Worker sent it, else the 14-day `items`. Unparseable starts
 * are dropped; each carries its derived `etype` and Lab `day`.
 */
export function calendarEvents(payload) {
  if (!payload) return [];
  const list = Array.isArray(payload.events) ? payload.events : (payload.items || []);
  return list
    .filter((e) => Number.isFinite(ms(e.starts_at)))
    .map((e) => ({ ...e, etype: eventType(e), day: dayKey(e.starts_at) }))
    .sort((a, b) => ms(a.starts_at) - ms(b.starts_at) || String(a.ref).localeCompare(String(b.ref)));
}

/** Narrow by the type filter: `types` is a Set of enabled types. */
export const filterByTypes = (events, types) => (events || []).filter((e) => !types || types.has(e.etype || eventType(e)));

/** Still relevant at `now`: a ranged event that has not ended, an instant not past. */
export function isCurrentOrFuture(ev, now) {
  const s = ms(ev.starts_at);
  if (ev.ends_at == null) return s >= now;
  const e = ms(ev.ends_at);
  return Number.isFinite(e) ? e > now : s >= now;
}

/** In progress at `now`. */
export const isOngoing = (ev, now) => ev.ends_at != null && ms(ev.starts_at) <= now && ms(ev.ends_at) > now;

/**
 * The agenda: the next `days` days (14 by default), ongoing sessions included,
 * grouped by Lab day, soonest first. Days with nothing are left out.
 */
export function agendaDays(events, now = Date.now(), days = 14) {
  const until = now + days * DAY;
  const groups = new Map();
  for (const ev of events || []) {
    const s = ms(ev.starts_at);
    if (!Number.isFinite(s) || s > until || !isCurrentOrFuture(ev, now)) continue;
    // An ongoing session that began yesterday is listed today, where it is.
    const key = s < now ? dayKey(now) : (ev.day || dayKey(ev.starts_at));
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(ev);
  }
  return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([key, items]) => ({ key, title: dayTitle(key), items }));
}

/** Seven day keys from `start` with the events on each. */
export function weekColumns(events, start) {
  return Array.from({ length: 7 }, (_, i) => {
    const key = addDays(start, i);
    return { key, title: dayTitle(key), items: (events || []).filter((e) => (e.day || dayKey(e.starts_at)) === key) };
  });
}

/** The month grid for the month containing `key`: weeks of seven cells, Monday first. */
export function monthGrid(events, key) {
  const first = startOfMonth(key);
  const month = first.slice(0, 7);
  const start = startOfWeek(first);
  const weeks = [];
  for (let w = 0; w < 6; w += 1) {
    const row = [];
    for (let d = 0; d < 7; d += 1) {
      const k = addDays(start, w * 7 + d);
      row.push({ key: k, inMonth: k.slice(0, 7) === month, items: (events || []).filter((e) => (e.day || dayKey(e.starts_at)) === k) });
    }
    if (w > 3 && !row.some((c) => c.inMonth)) break;
    weeks.push(row);
  }
  return weeks;
}

/** One step back or forward in the current view. */
export function shiftAnchor(view, key, dir) {
  if (view === 'month') return addMonths(startOfMonth(key), dir);
  if (view === 'week') return addDays(startOfWeek(key), 7 * dir);
  return addDays(key, 14 * dir);
}

// ── Conflicts ─────────────────────────────────────────────────────────────

function span(ev) {
  if (!ev) return 'at a time not recorded';
  const s = clockTime(ev.starts_at);
  const e = ev.ends_at ? clockTime(ev.ends_at) : null;
  return e ? `${s}–${e}` : `at ${s}`;
}

/**
 * A conflict in words: "Fay 10:30–11:00 overlaps Flo 10:00–10:45 by 15
 * minutes", with which side is in progress, and the day. `byRef` maps refs to
 * events; a pair whose events are not in the stream says so rather than
 * inventing names.
 */
export function conflictText(c, byRef) {
  const a = byRef.get(c.a);
  const b = byRef.get(c.b);
  if (!a || !b) return 'Two events overlap, but one of them is outside what was read.';
  const day = dayTitle(dayKey(c.overlap_start || a.starts_at));
  const name = (ev) => `“${ev.title}”`;
  let text;
  const instant = c.kind === 'instant_in_session' || a.ends_at == null || b.ends_at == null;
  if (instant) {
    const point = a.ends_at == null ? a : b;
    const range = point === a ? b : a;
    text = `${day}: ${name(point)} ${span(point)} falls inside ${name(range)} ${span(range)}.`;
  } else {
    const mins = Number.isFinite(Number(c.overlap_minutes)) ? Number(c.overlap_minutes) : null;
    text = `${day}: ${name(a)} ${span(a)} overlaps ${name(b)} ${span(b)}${mins ? ` by ${mins} minute${mins === 1 ? '' : 's'}` : ''}.`;
  }
  const live = (c.ongoing || []).map((r) => byRef.get(r)).filter(Boolean);
  if (live.length) text += ` ${live.map(name).join(' and ')} ${live.length === 1 ? 'is' : 'are'} in progress now.`;
  return text;
}

/** Every conflict touching each ref, for marking events. */
export function conflictsByRef(collisions) {
  const m = new Map();
  for (const c of collisions || []) {
    for (const r of [c.a, c.b]) {
      if (!m.has(r)) m.set(r, []);
      m.get(r).push(c);
    }
  }
  return m;
}

// ── Partial sources ───────────────────────────────────────────────────────

/**
 * What the read could not supply, as sentences. An older payload without
 * `sources` reports only what `windows_recorded` says.
 */
export function missingSources(payload) {
  if (!payload) return [];
  const src = payload.sources || { lab_dates: payload.windows_recorded === false ? 'not_recorded' : 'ok', sessions: 'ok' };
  const out = [];
  if (src.lab_dates === 'error') {
    out.push({ key: 'lab_dates', text: 'Cohort dates couldn’t be loaded. Your sessions are shown; week openings and deadlines are missing until the Lab’s schedule loads.' });
  } else if (src.lab_dates === 'not_recorded') {
    out.push({ key: 'lab_dates', text: 'The Lab has no week windows recorded for this cohort, so week openings and deadlines cannot be shown. Cycles created before the Lab recorded them have none. Your sessions are shown.' });
  }
  if (src.sessions === 'error') {
    out.push({ key: 'sessions', text: 'Your sessions couldn’t be loaded. Cohort dates are shown; booked and group sessions are missing.' });
  } else if (src.sessions === 'no_profile') {
    out.push({ key: 'sessions', text: 'You have no advisor profile yet, so no session can be booked with you.' });
  }
  if (payload.sessions_truncated) {
    out.push({ key: 'truncated', text: 'Only the next 200 bookings were read; later sessions are not shown.' });
  }
  return out;
}

// ── Detail ────────────────────────────────────────────────────────────────

/** The rows an event's detail shows: title, cohort, type, start/end, zone, participants, status. */
export function eventDetail(ev, cohort, tz = LAB_TZ) {
  if (!ev) return null;
  const type = EVENT_TYPES[ev.etype || eventType(ev)];
  const when = (iso) => (iso ? `${dayTitle(dayKey(iso))}, ${clockTime(iso)}` : null);
  const participants = ev.kind === 'client'
    ? (ev.participants || []).map((p) => `${p.name || 'Founder (name not recorded)'}${p.status === 'pending' ? ' · pending' : ''}`)
    : null;
  return {
    title: ev.title,
    cohort: cohortLabel(cohort),
    type: type?.label || 'Event',
    start: when(ev.starts_at),
    end: ev.ends_at ? when(ev.ends_at) : 'No end recorded — a point in time',
    timezone: tz,
    participants: participants == null
      ? (ev.etype === 'deadline' || ev.etype === 'week_opens' ? 'Every founder in the cohort' : 'The cohort')
      : (participants.length ? participants.join(', ') : 'Not recorded'),
    status: ev.kind === 'client'
      ? (ev.status === 'confirmed' ? 'Confirmed' : ev.status === 'pending' ? 'Awaiting confirmation' : 'Not recorded')
      : 'From the Lab’s schedule',
    ongoing: Boolean(ev.ongoing),
  };
}

/**
 * The UID an export writes. The Worker's `uid` (cycle-scoped for Lab dates,
 * slot-scoped for sessions) when it sent one; else the ref with the cycle id,
 * because `week:2:unlock` is the same string in every cohort.
 */
export function exportUid(ev, cycleId) {
  if (ev?.uid) return ev.uid;
  return `cohort-${cycleId ?? 'unknown'}-${String(ev?.ref || '').replace(/:/g, '-')}`;
}
