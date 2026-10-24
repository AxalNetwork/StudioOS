/**
 * D915 (#2368) — the admin Events desk's words and derivations. Pure: no React,
 * no fetch, so the tests read them without a browser.
 *
 * The canvas is the owner's "Events Console" (EV1–EV17). The desk draws only
 * the blocks whose reads exist, each truthfully; the rest is D915 §6's seven
 * parts, and this file grows a derivation when its read lands.
 *
 * WHAT IS READ, AND FROM WHERE (D915 §2):
 *   R1 `GET /api/admin/events?status&limit=200&offset`, paged until a short
 *      page (`readEveryPage`): every event's own fields. A D1 error is a 5xx,
 *      so a failed R1 is a failed read, never an empty list.
 *   R2 `GET /api/admin/events/analytics`: only its per-event rows, joined to R1
 *      by `id` under Guard G (`analyticsJoin`). Its `summary` is not read (it
 *      is all-time, has no `rejected` bucket, and turns a failure into zeros),
 *      and its `conversion` is never drawn (it is 0 for every upcoming event).
 *   R3 `GET /api/admin/events/:id`: the event page.
 *   R5 `GET /api/events/:id/agenda`: the event page's agenda.
 * The roster (names and emails) is not read anywhere on the desk.
 *
 * THE WORDS FOR WHAT IS NOT KNOWN, kept apart (the map's A §4):
 *   "Not recorded"       no store holds it;
 *   "Not read here yet"  it is stored, but no read sums it yet;
 *   "Not held yet"       the event has not ended, so nobody could attend;
 *   "No cap"             the event has no capacity;
 *   "Not in this read"   the event is missing from R2's 200 rows (Guard G);
 *   "Could not be read"  the read failed.
 * A real zero is drawn as 0, but only where a read succeeded.
 */

import { NOT_RECORDED, titleCase } from '../../../lib/absence.js';
import { SCOPE_LABEL, SCOPE_TITLE } from '../insights/insightsModel.js';
import { parseStamp } from '../../../ui/parseStamp.js';

export { NOT_RECORDED, SCOPE_LABEL, SCOPE_TITLE };

/* ------------------------------------------------------------------ *
 * Addresses and the tabs
 * ------------------------------------------------------------------ */

export const DESK_PATH = '/admin/events';
export const REVIEW_PATH = '/admin/events/review';
export const ALL_PATH = '/admin/events/all';
/** D919 (#2702): the Calendar tab. */
export const CALENDAR_TAB_PATH = '/admin/events/calendar';
/** Community's own address since D930 (#2367); `/admin/held/community` only redirects there. */
export const COMMUNITY_PATH = '/admin/community';

export const TITLE = 'Events';
export const LINE = 'Approve public events, keep the calendar healthy and see how events perform.';

/** The tab strip (EV1). Calendar joined with D915 part 4 (D919). */
export const TABS = [
  { key: 'overview', label: 'Overview', path: DESK_PATH },
  { key: 'review', label: 'Review', path: REVIEW_PATH },
  { key: 'all', label: 'All events', path: ALL_PATH },
  { key: 'calendar', label: 'Calendar', path: CALENDAR_TAB_PATH },
];

/** The tab a path opens; `/admin/events/:id` is one event's page, which selects no tab. */
export function tabFor(pathname) {
  const path = String(pathname || '').replace(/\/+$/, '');
  const hit = TABS.find((t) => t.path === path);
  if (hit) return hit.key;
  return eventIdFor(path) === null ? 'overview' : 'event';
}

/**
 * The segment after `/admin/events/` on an event's page, or null on a tab. A
 * segment that cannot be decoded (`/admin/events/%E0`) comes back raw, so it
 * fails `isEventId` and the page says the event no longer exists.
 */
export function eventIdFor(pathname) {
  const path = String(pathname || '').replace(/\/+$/, '');
  if (TABS.some((t) => t.path === path)) return null;
  const m = /^\/admin\/events\/([^/]+)$/.exec(path);
  if (!m) return null;
  try { return decodeURIComponent(m[1]); } catch { return m[1]; }
}

/** The Worker's `intParam`: an event id is a positive whole number, and anything else is a 404. */
export const isEventId = (id) => /^[1-9]\d*$/.test(String(id ?? ''));

export const eventHref = (id) => `${DESK_PATH}/${encodeURIComponent(id)}`;

/* ------------------------------------------------------------------ *
 * Words
 * ------------------------------------------------------------------ */

export const NOT_READ_YET = 'Not read here yet';
export const NOT_HELD = 'Not held yet';
export const NO_CAP = 'No cap';
export const NOT_IN_READ = 'Not in this read';
export const COULD_NOT_READ = 'Could not be read';
export const READING = 'Reading…';

/** The canvas's status words. The stored `rejected` reads "Sent back" (D915 §2, O-NAME). */
export const STATUSES = [
  { key: 'draft', word: 'Draft', tone: 'muted' },
  { key: 'pending_review', word: 'Waiting for review', tone: 'amber' },
  { key: 'published', word: 'Published', tone: 'green' },
  { key: 'rejected', word: 'Sent back', tone: 'muted' },
  { key: 'cancelled', word: 'Cancelled', tone: 'red' },
];

export function statusWord(status) {
  const hit = STATUSES.find((s) => s.key === status);
  return hit ? hit.word : (titleCase(status) || 'Status not recorded');
}

export const statusTone = (status) => STATUSES.find((s) => s.key === status)?.tone || 'muted';

/** `?status=` on All events, when it names a status the desk draws. */
export function statusFromSearch(search) {
  const s = new URLSearchParams(search || '').get('status');
  return STATUSES.some((x) => x.key === s) ? s : null;
}

const VISIBILITY = { public: 'Public', unlisted: 'Unlisted', private: 'Private' };
export const visibilityWord = (v) => VISIBILITY[v] || titleCase(v) || 'Visibility not recorded';

const nf = (n) => Number(n).toLocaleString('en-US');
const plural = (n, one, many) => `${nf(n)} ${n === 1 ? one : many}`;
const capitalise = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

/** 'a', 'a and b', 'a, b and c'. */
export function listJoin(items) {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

/* ------------------------------------------------------------------ *
 * Time
 * ------------------------------------------------------------------ */

export const DAY_MS = 86_400_000;

/** A stored time as epoch ms: the one rule in `ui/parseStamp.js`, which D923 moved there from here. */
export { parseStamp };

/**
 * An event has ended once its `ends_at` has passed; with no `ends_at`, a day
 * after its start (D915 §2). `null` when neither time is recorded.
 */
export function hasEnded(ev, now) {
  const end = parseStamp(ev?.ends_at);
  if (end !== null) return now > end;
  const start = parseStamp(ev?.starts_at);
  if (start !== null) return now > start + DAY_MS;
  return null;
}

export function isUpcoming(ev, now) {
  const start = parseStamp(ev?.starts_at);
  return start !== null && start > now;
}

/** Starts from now to `days` ahead. */
export function startsWithin(ev, now, days) {
  const start = parseStamp(ev?.starts_at);
  return start !== null && start >= now && start < now + days * DAY_MS;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** A stored time's day, '3 Oct 2026' (UTC), or "Date not recorded". */
export function dateLabel(value) {
  const ms = parseStamp(value);
  if (ms === null) return 'Date not recorded';
  const d = new Date(ms);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** "Updated 10:42": the viewer's own clock. */
export function clockLabel(ms) {
  if (!Number.isFinite(ms)) return '';
  return new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(ms));
}

/** The event's own zone when Intl knows it, else UTC. */
export function zoneOf(ev) {
  const tz = String(ev?.timezone || '').trim();
  if (!tz) return 'UTC';
  try {
    new Intl.DateTimeFormat('en-GB', { timeZone: tz });
    return tz;
  } catch {
    return 'UTC';
  }
}

function partsIn(ms, zone) {
  const f = new Intl.DateTimeFormat('en-GB', {
    timeZone: zone, weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  });
  const p = Object.fromEntries(f.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return { day: `${p.weekday} ${p.day} ${p.month} ${p.year}`, short: `${p.weekday} ${p.day} ${p.month}`, time: `${p.hour}:${p.minute}` };
}

/** The zone's label as the event stores it. A stored zone Intl does not know is drawn in UTC, and says so. */
export const zoneLabel = (ev) => (zoneOf(ev) === 'UTC' ? 'UTC' : String(ev.timezone).trim());

/** 'Thu 14 Nov 2026, 18:30–21:00 · Europe/Lisbon', in the event's own zone. */
export function whenLine(ev) {
  const start = parseStamp(ev?.starts_at);
  if (start === null) return 'Date not recorded';
  const zone = zoneOf(ev);
  const a = partsIn(start, zone);
  const end = parseStamp(ev?.ends_at);
  let span = `${a.day}, ${a.time}`;
  if (end !== null) {
    const b = partsIn(end, zone);
    span = b.day === a.day ? `${span}–${b.time}` : `${span} – ${b.day}, ${b.time}`;
  }
  return `${span} · ${zoneLabel(ev)}`;
}

/** 'Thu 14 Nov · 18:30', for a queue row. */
export function startShort(ev) {
  const start = parseStamp(ev?.starts_at);
  if (start === null) return 'Date not recorded';
  const p = partsIn(start, zoneOf(ev));
  return `${p.short} · ${p.time}`;
}

/** '14 Nov 2026 18:30', for the table, with the zone beside it. */
export function startCell(ev) {
  const start = parseStamp(ev?.starts_at);
  if (start === null) return { text: 'Date not recorded', zone: '' };
  const p = partsIn(start, zoneOf(ev));
  return { text: `${p.day.replace(/^\w+ /, '')} ${p.time}`, zone: zoneLabel(ev) };
}

/** A time of day in the event's zone, for the agenda. */
export function timeIn(value, ev) {
  const ms = parseStamp(value);
  return ms === null ? null : partsIn(ms, zoneOf(ev)).time;
}

/* ------------------------------------------------------------------ *
 * Money: each amount in its own currency; two currencies are never added
 * ------------------------------------------------------------------ */

export function money(cents, currency) {
  const n = Number(cents);
  if (cents === null || cents === undefined || cents === '' || !Number.isFinite(n)) return NOT_RECORDED;
  if (n <= 0) return 'Free';
  const code = String(currency || '').trim().toUpperCase();
  const digits = n % 100 === 0 ? 0 : 2;
  if (!code) return `${(n / 100).toFixed(digits)} (currency not recorded)`;
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: code, minimumFractionDigits: digits, maximumFractionDigits: digits }).format(n / 100);
  } catch {
    return `${(n / 100).toFixed(digits)} ${code}`;
  }
}

/** Amounts summed per currency, in the order each currency first appears: '$55 · €40'. */
export function moneyTotals(items) {
  const sums = new Map();
  for (const it of items || []) {
    const n = Number(it?.cents);
    if (!Number.isFinite(n) || n <= 0) continue;
    const code = String(it?.currency || '').trim().toUpperCase();
    sums.set(code, (sums.get(code) || 0) + n);
  }
  if (!sums.size) return 'Free';
  return [...sums].map(([code, cents]) => money(cents, code)).join(' · ');
}

export const isPaid = (ev) => Number(ev?.price_cents) > 0;

/* ------------------------------------------------------------------ *
 * The reads
 * ------------------------------------------------------------------ */

/** R1's page size: the Worker caps `limit` at 200. */
export const PAGE_LIMIT = 200;

/**
 * Every page of R1. `fetchPage(offset)` answers `{ events: [] }`; a page
 * shorter than the limit is the last. An answer with no list is a failed
 * read, not an empty one, so it throws.
 *
 * R1 pages by OFFSET over `created_at DESC`, so an event created between two
 * page requests pushes the last row of one page onto the next. Each id is kept
 * once, so no event is counted or drawn twice; the new one is in the next read.
 */
export async function readEveryPage(fetchPage, limit = PAGE_LIMIT, maxPages = 500) {
  const out = [];
  const seen = new Set();
  for (let i = 0; i < maxPages; i += 1) {
    const reply = await fetchPage(i * limit);
    const page = reply?.events;
    if (!Array.isArray(page)) throw new Error('The events list did not come back as a list.');
    for (const ev of page) {
      const id = ev?.id === null || ev?.id === undefined ? null : String(ev.id);
      if (id !== null && seen.has(id)) continue;
      if (id !== null) seen.add(id);
      out.push(ev);
    }
    if (page.length < limit) return out;
  }
  return out;
}

/** A read's state, as the hook holds it: `{ status: 'loading' | 'ready' | 'error', data }`. */
export const readyList = (read) => (read?.status === 'ready' && Array.isArray(read.data) ? read.data : null);

/** The claim a failed read is not: `Unreadable` prints "{what} could not be read." before it. */
export const COUNTS_CLAIM = 'That is not a claim that nobody registered.';

/**
 * GUARD G (D915 §2; the map's A §0.3). R1 is truthful, but R2's per-event rows
 * are one query that answers `[]` with status 200 when it fails. So the
 * per-event counts COULD NOT BE READ when
 *   (a) R1 holds at least one event (`known`) and R2's `events` is empty;
 *   (b) R2's `events` is not a list at all (missing, null, or a `{}` reply);
 *   (c) R2 says so itself: its `unreadable` list names `'events'` (D915 part 1).
 * Otherwise the rows are joined by id, and an R1 event missing from them (R2
 * holds the 200 that start latest) reads "Not in this read", never 0.
 */
export function analyticsJoin(read, known) {
  if (!read || read.status === 'loading') return { state: 'loading' };
  if (read.status !== 'ready') return { state: 'unreadable', reason: COUNTS_CLAIM };
  const data = read.data;
  const rows = Array.isArray(data?.events) ? data.events : null;
  if (!rows) return { state: 'unreadable', reason: COUNTS_CLAIM };
  if (Array.isArray(data?.unreadable) && data.unreadable.includes('events')) return { state: 'unreadable', reason: COUNTS_CLAIM };
  if (Number(known) > 0 && rows.length === 0) return { state: 'unreadable', reason: COUNTS_CLAIM };
  return { state: 'ready', byId: new Map(rows.map((r) => [String(r?.id), r])) };
}

const count = (v) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));

/**
 * One event's counts from R2's row. Seats taken = Registered + Confirmed +
 * Attended, which is exactly R2's `registrations`.
 */
export function countsFor(join, id) {
  if (!join || join.state !== 'ready') return { state: join?.state || 'loading', reason: join?.reason };
  const row = join.byId.get(String(id));
  if (!row) return { state: 'missing' };
  return { state: 'ready', taken: count(row.registrations), attended: count(row.attended), waitlisted: count(row.waitlisted) };
}

/** A count in words when it is not known. */
export function countText(c, key) {
  if (c.state === 'loading') return READING;
  if (c.state === 'unreadable') return COULD_NOT_READ;
  if (c.state === 'missing') return NOT_IN_READ;
  const v = c[key];
  return v === null || v === undefined ? NOT_RECORDED : nf(v);
}

export const capacityText = (capacity) => (capacity === null || capacity === undefined ? NO_CAP : nf(capacity));

/** Fill = seats taken ÷ capacity; an event with no cap reads "No cap". */
export function fillText(capacity, c) {
  if (capacity === null || capacity === undefined) return NO_CAP;
  if (c.state !== 'ready' || c.taken === null) return countText(c, 'taken');
  if (Number(capacity) <= 0) return 'No seats';
  return `${Math.round((c.taken / Number(capacity)) * 100)}%`;
}

/** Attended: before an event is held and nobody has checked in, "Not held yet", never 0. */
export function attendedText(ev, c, now) {
  if (ev?.status === 'cancelled') return 'Not held';
  if (c.state === 'ready' && c.attended > 0) return nf(c.attended);
  const ended = hasEnded(ev, now);
  if (ended === null) return NOT_RECORDED;
  if (!ended) return NOT_HELD;
  return countText(c, 'attended');
}

/**
 * Show-up = Attended ÷ seats taken, for events that have ended. Before that it
 * reads "Not held yet", never 0% or a dash. R2's `conversion` is never drawn.
 */
export function showUpText(ev, c, now) {
  if (ev?.status === 'cancelled') return 'Not held';
  const ended = hasEnded(ev, now);
  if (ended === null) return NOT_RECORDED;
  if (!ended) return NOT_HELD;
  if (c.state !== 'ready' || c.taken === null || c.attended === null) return countText(c, 'attended');
  if (c.taken === 0) return 'No seats taken';
  return `${Math.round((c.attended / c.taken) * 100)}%`;
}

/* ------------------------------------------------------------------ *
 * Overview (EV1)
 * ------------------------------------------------------------------ */

/** The statuses that are on the calendar or headed for it. Drafts, sent-back and cancelled events are not counted ahead. */
export const LIVE_STATUSES = ['published', 'pending_review'];
const isLive = (ev) => LIVE_STATUSES.includes(ev?.status);

/** Every status's count from R1, the five the canvas draws first (real zeros), then any other stored status. */
export function statusCounts(events) {
  const out = STATUSES.map((s) => ({ ...s, count: 0 }));
  for (const ev of events) {
    let hit = out.find((o) => o.key === ev?.status);
    if (!hit) {
      hit = { key: ev?.status ?? '', word: statusWord(ev?.status), tone: 'muted', count: 0 };
      out.push(hit);
    }
    hit.count += 1;
  }
  return out;
}

const MISSING_REASON = 'The analytics read holds the 200 events that start latest, and some of these are older.';
export const LIST_CLAIM = 'That is not a claim that there are no events.';
export const QUEUE_CLAIM = 'That is not a claim that nothing waits.';

/** Counts summed over `evs`, or the state that stops the sum. Over no events at all, R1 alone says the sum is 0. */
function sumOver(evs, join) {
  if (!evs.length) return { state: 'ready', taken: 0, attended: 0, waitlisted: 0, rows: [] };
  if (join.state !== 'ready') return { state: join.state, reason: join.reason };
  const rows = evs.map((ev) => countsFor(join, ev.id));
  const missing = rows.filter((r) => r.state !== 'ready').length;
  if (missing) return { state: 'missing', reason: `${plural(missing, 'event is', 'events are')} ${NOT_IN_READ.toLowerCase()}. ${MISSING_REASON}` };
  const add = (k) => rows.reduce((a, r) => a + (r[k] || 0), 0);
  return { state: 'ready', taken: add('taken'), attended: add('attended'), waitlisted: add('waitlisted'), rows };
}

/**
 * The four tiles D915 §3 draws now. Each is `{ key, label, state, value, sub,
 * note }`: `state` is ready, loading, unreadable or missing; `note` is a value
 * nothing records yet, drawn as Unrecorded.
 */
export function overviewTiles({ all, queue, join, now }) {
  const tiles = [];
  const q = readyList(queue);
  tiles.push({
    key: 'waiting', label: 'Waiting for review',
    ...(q ? { state: 'ready', value: nf(q.length) } : stateOf(queue, QUEUE_CLAIM)),
    note: { text: 'Waiting time not recorded yet', reason: 'Waiting time counts from submission, which is not recorded yet.' },
  });

  const list = readyList(all);
  if (!list) {
    for (const [key, label] of [['next30', 'Next 30 days'], ['waitlists', 'On waitlists'], ['showup', 'Show-up rate']]) tiles.push({ key, label, ...stateOf(all, LIST_CLAIM) });
    return tiles;
  }

  const next = list.filter((ev) => isLive(ev) && startsWithin(ev, now, 30));
  const seats = sumOver(next, join);
  let nextSub;
  if (!next.length) nextSub = 'Published or waiting for review';
  else if (seats.state === 'ready') {
    const full = next.filter((ev, i) => ev.capacity !== null && ev.capacity !== undefined && Number(ev.capacity) > 0 && seats.rows[i].taken >= Number(ev.capacity)).length;
    nextSub = `${plural(seats.taken, 'seat', 'seats')} taken · ${nf(full)} full`;
  } else if (seats.state === 'loading') nextSub = 'Reading seats taken…';
  else if (seats.state === 'missing') nextSub = `Seats taken: ${NOT_IN_READ.toLowerCase()} for some of them`;
  else nextSub = 'Seats taken could not be read';
  tiles.push({ key: 'next30', label: 'Next 30 days', state: 'ready', value: nf(next.length), sub: nextSub });

  const upcoming = list.filter((ev) => isLive(ev) && isUpcoming(ev, now));
  const wait = sumOver(upcoming, join);
  tiles.push({
    key: 'waitlists', label: 'On waitlists',
    ...(wait.state === 'ready' ? { state: 'ready', value: nf(wait.waitlisted), sub: 'Registrations waitlisted on upcoming events' } : { state: wait.state, reason: wait.reason }),
  });

  const ended = list.filter((ev) => ev?.status !== 'cancelled' && hasEnded(ev, now) === true);
  if (!ended.length) {
    tiles.push({ key: 'showup', label: 'Show-up rate', state: 'ready', value: 'No event has ended yet', words: true });
  } else {
    const held = sumOver(ended, join);
    if (held.state !== 'ready') tiles.push({ key: 'showup', label: 'Show-up rate', state: held.state, reason: held.reason });
    else if (!held.taken) tiles.push({ key: 'showup', label: 'Show-up rate', state: 'ready', value: 'No seats taken', words: true, sub: `${plural(ended.length, 'event has', 'events have')} ended` });
    else tiles.push({ key: 'showup', label: 'Show-up rate', state: 'ready', value: `${Math.round((held.attended / held.taken) * 100)}%`, sub: `${plural(ended.length, 'event has', 'events have')} ended` });
  }
  return tiles;
}

function stateOf(read, reason) {
  if (!read || read.status === 'loading') return { state: 'loading' };
  return { state: 'unreadable', reason };
}

/** The canvas's two "Not recorded" cards, with their reasons. */
export const UNRECORDED_BLOCKS = [
  { key: 'views', title: 'Page views', reason: 'No store counts views of an event page, so the funnel starts at registration.' },
  { key: 'feedback', title: 'Feedback', reason: 'Events have no feedback form yet.' },
];

export const EMPTY_LINE = 'No events yet. Members create events from Events › New; public ones come here for review.';

/* ------------------------------------------------------------------ *
 * Review (EV3)
 * ------------------------------------------------------------------ */

export const QUEUE_SORTS = [
  { key: 'starts', label: 'Starts soonest' },
  { key: 'created', label: 'Newest created' },
];

export const NOTHING_WAITING = 'Nothing is waiting.';
export const NOTHING_WAITING_SUB = 'A public event lands here when its host submits it.';

/** The free-seat flags (`audience_rules`), and whether approving mints an invitation for each. */
export const COMP_FLAGS = [
  { key: 'comp_official_partners', label: 'official partners', invites: true },
  { key: 'comp_invested_lps', label: 'invested LPs', invites: true },
  { key: 'comp_investors', label: 'investors', invites: false },
  { key: 'comp_project_founders', label: 'founders of live ventures', invites: false },
  { key: 'comp_host_connections', label: 'the host’s contacts', invites: false },
];

const rulesOf = (ev) => (ev?.audience_rules && typeof ev.audience_rules === 'object' && !Array.isArray(ev.audience_rules) ? ev.audience_rules : {});
export const compFlags = (rules) => COMP_FLAGS.filter((f) => rules?.[f.key] === true);

/** A queue row's flags: Paid with its price, and Free seats when any free-seat flag is on. */
export function queueFlags(ev) {
  const flags = [];
  if (isPaid(ev)) flags.push(`Paid ${money(ev.price_cents, ev.currency)}`);
  if (compFlags(rulesOf(ev)).length) flags.push('Free seats');
  return flags;
}

const byStart = (a, b) => {
  const x = parseStamp(a.starts_at);
  const y = parseStamp(b.starts_at);
  if (x === null && y === null) return 0;
  if (x === null) return 1;
  if (y === null) return -1;
  return x - y;
};
const byCreatedDesc = (a, b) => (parseStamp(b.created_at) ?? -Infinity) - (parseStamp(a.created_at) ?? -Infinity);
export const titleOf = (ev) => String(ev?.title || '').trim() || 'Untitled event';

const matches = (ev, q) => {
  const needle = String(q || '').trim().toLowerCase();
  return !needle || titleOf(ev).toLowerCase().includes(needle);
};

/** The queue, searched by title and sorted by start or by creation. */
export function queueRows(events, { q = '', sort = 'starts' } = {}) {
  const rows = (events || []).filter((ev) => matches(ev, q));
  return [...rows].sort(sort === 'created' ? byCreatedDesc : byStart);
}

const ROLE_WORD = { admin: 'Admin', founder: 'Founder', partner: 'Operating Partner', investor: 'Investor', exploring: 'Explorer' };

/** A member's role in the canvas's words; a role with no word is title-cased. */
export const roleWord = (role) => ROLE_WORD[role] || titleCase(role) || NOT_RECORDED;

/** Who may register (`mode`, `roles`, `personas`; a missing mode is "everyone", as the Worker reads it). */
export function audienceLine(rules) {
  const mode = rules?.mode || 'everyone';
  if (mode === 'everyone') return 'Everyone';
  if (mode === 'invite_only') return 'By invitation only';
  if (mode !== 'selected') return titleCase(mode) || NOT_RECORDED;
  const parts = [];
  const roles = Array.isArray(rules.roles) ? rules.roles : [];
  const personas = Array.isArray(rules.personas) ? rules.personas : [];
  if (roles.length) parts.push(`Selected roles: ${roles.map((r) => ROLE_WORD[r] || titleCase(r)).join(', ')}`);
  if (personas.length) parts.push(`Personas: ${personas.map((p) => titleCase(p)).join(', ')}`);
  return parts.join(' · ') || NOT_RECORDED;
}

export function compLine(rules) {
  const flags = compFlags(rules);
  return flags.length ? capitalise(listJoin(flags.map((f) => f.label))) : 'No one';
}

export function capacityLine(ev) {
  if (ev?.capacity === null || ev?.capacity === undefined) return NO_CAP;
  return `${plural(Number(ev.capacity), 'seat', 'seats')} · waitlist ${ev.waitlist_enabled ? 'on' : 'off'}`;
}

/** The selected event's facts, from its R1 row. Submitted waits for D915 part 2's `submitted_at`. */
export function factsOf(ev) {
  return [
    { key: 'visibility', label: 'Visibility', value: visibilityWord(ev?.visibility), sub: ev?.visibility === 'public' ? 'This is why it needs review.' : null },
    { key: 'place', label: 'Place', value: String(ev?.location_text || '').trim() || NOT_RECORDED },
    { key: 'when', label: 'Starts and ends', value: whenLine(ev) },
    { key: 'capacity', label: 'Capacity', value: capacityLine(ev) },
    { key: 'registration', label: 'Registration', value: ev?.approval_required ? 'The host approves each registration' : 'Each sign-up is confirmed at once' },
    { key: 'price', label: 'Price', value: money(ev?.price_cents, ev?.currency) },
    { key: 'audience', label: 'Who may register', value: audienceLine(rulesOf(ev)) },
    { key: 'comp', label: 'Free seats for', value: compLine(rulesOf(ev)) },
    { key: 'created', label: 'Created', value: dateLabel(ev?.created_at) },
    { key: 'submitted', label: 'Submitted', unrecorded: { text: 'Not recorded yet', reason: 'The time a host submits an event is not stored yet.' } },
  ];
}

/**
 * "What approving does" (EV3, EV4). Line 3 has no counts until D915 part 3's
 * preview: it names the two sources approve invites (official partners and
 * invested LPs), and says the other three flags give a seat at sign-up and
 * send no invitation.
 */
export function approveLine3(rules) {
  const flags = compFlags(rules);
  const inv = flags.filter((f) => f.invites).map((f) => f.label);
  const seat = flags.filter((f) => !f.invites).map((f) => f.label);
  let line = inv.length ? `Sends free-seat invitations to ${listJoin(inv)} not invited yet.` : 'Sends no invitations.';
  if (seat.length) line += ` ${capitalise(listJoin(seat))} get a free seat when they sign up; no invitation is sent to them.`;
  return line;
}

export function approveLines(ev) {
  return [
    ev?.visibility === 'public'
      ? 'Puts the event on the public calendar at axal.vc/events.'
      : `Publishes the event. It is ${visibilityWord(ev?.visibility).toLowerCase()}, so it stays off the public calendar.`,
    'Tells the host it is live.',
    approveLine3(rulesOf(ev)),
  ];
}

/** The line over the list after an approve (EV4b): no toast. */
export function approvedLine(ev, { featured = false, featureError = null } = {}) {
  const base = ev?.visibility === 'public' ? `Approved. ${titleOf(ev)} is on the public calendar.` : `Approved. ${titleOf(ev)} is published.`;
  if (featureError) return `${base} It is not featured: ${refusalText(featureError, 'the feature call did not go through. Feature it from its page.')}`;
  return featured ? `${base} It is featured.` : base;
}

export const sentBackLine = (ev) => `Sent back. The host of ${titleOf(ev)} sees your reason.`;

/* ------------------------------------------------------------------ *
 * All events (EV6)
 * ------------------------------------------------------------------ */

export const ROWS_PER_PAGE = 25;

/** The canvas's default sort: upcoming soonest first, then past events latest first, then any with no start. */
export function defaultOrder(events, now) {
  const at = (ev) => parseStamp(ev?.starts_at);
  const upcoming = events.filter((ev) => at(ev) !== null && at(ev) >= now).sort((a, b) => at(a) - at(b));
  const past = events.filter((ev) => at(ev) !== null && at(ev) < now).sort((a, b) => at(b) - at(a));
  const none = events.filter((ev) => at(ev) === null);
  return [...upcoming, ...past, ...none];
}

export function allRows(events, { q = '', status = null, now }) {
  return defaultOrder((events || []).filter((ev) => matches(ev, q) && (!status || ev?.status === status)), now);
}

export function pageOf(rows, page, size = ROWS_PER_PAGE) {
  const pages = Math.max(1, Math.ceil(rows.length / size));
  const at = Math.min(Math.max(1, page), pages);
  const from = rows.length ? (at - 1) * size + 1 : 0;
  const to = Math.min(at * size, rows.length);
  return { rows: rows.slice(from ? from - 1 : 0, to), page: at, pages, from, to, total: rows.length };
}

export const rangeText = ({ from, to, total }) => (total ? `${nf(from)}–${nf(to)} of ${nf(total)}` : 'No events');

/** One table row: R1's own fields, R2's counts under Guard G. */
export function tableRow(ev, join, now) {
  const c = countsFor(join, ev.id);
  return {
    id: ev.id,
    title: titleOf(ev),
    featured: Boolean(ev.featured),
    starts: startCell(ev),
    status: ev.status,
    visibility: visibilityWord(ev.visibility),
    capacity: capacityText(ev.capacity),
    taken: countText(c, 'taken'),
    waitlisted: countText(c, 'waitlisted'),
    attended: attendedText(ev, c, now),
    fill: fillText(ev.capacity, c),
    showUp: showUpText(ev, c, now),
    price: money(ev.price_cents, ev.currency),
  };
}

/* ------------------------------------------------------------------ *
 * One event (EV7)
 * ------------------------------------------------------------------ */

/** The public feed's predicate (`events_public.ts`): public, published and approved. */
export const onPublicCalendar = (ev) => ev?.visibility === 'public' && ev?.status === 'published' && Boolean(ev?.admin_published);

/** The publish gate (EV7g): each step `{ text, tone }`, tone ok, wait, muted or last. */
export function publishGate(ev) {
  const status = { text: statusWord(ev?.status), tone: ev?.status === 'published' ? 'ok' : ev?.status === 'pending_review' ? 'wait' : 'muted' };
  if (ev?.visibility === 'public') {
    return [
      { text: 'Public', tone: 'ok' },
      status,
      ev?.admin_published ? { text: 'Approved by an admin', tone: 'ok' } : { text: 'Not approved yet', tone: 'wait' },
      { text: onPublicCalendar(ev) ? 'On the public calendar' : 'Not on the public calendar', tone: 'last' },
    ];
  }
  const reach = ev?.visibility === 'private' ? 'Reached by invitation only. ' : ev?.visibility === 'unlisted' ? 'Reached by its link only. ' : '';
  return [
    { text: visibilityWord(ev?.visibility), tone: 'muted' },
    status,
    { text: `${ev?.status === 'published' ? reach : ''}Private and unlisted events publish without review.`, tone: 'last' },
  ];
}

/** The event page's tiles, from R3's event and R2's row (Guard G). */
export function eventTiles(ev, c, now) {
  const cap = ev?.capacity;
  const taken = countText(c, 'taken');
  let takenSub = null;
  if (c.state === 'ready' && c.taken !== null && cap !== null && cap !== undefined && Number(cap) > 0) takenSub = `${fillText(cap, c)} full`;
  return [
    { key: 'capacity', label: 'Capacity', value: capacityText(cap), sub: cap === null || cap === undefined ? 'Anyone eligible can register' : 'seats' },
    { key: 'taken', label: 'Seats taken', value: taken, sub: takenSub },
    { key: 'waitlist', label: 'On the waitlist', value: countText(c, 'waitlisted'), sub: c.state === 'ready' ? 'oldest first' : null },
    { key: 'attended', label: 'Attended', value: attendedText(ev, c, now) },
    { key: 'showup', label: 'Show-up', value: showUpText(ev, c, now) },
  ].map((t) => ({ ...t, words: !isFigure(t.value) }));
}

/** A drawn value that is a number or a percentage, as opposed to words such as "Not held yet". */
export const isFigure = (value) => /^\d[\d,]*%?$/.test(String(value ?? ''));

export function agendaRows(reply, ev) {
  const list = Array.isArray(reply?.agenda) ? reply.agenda : null;
  if (!list) return null;
  return [...list]
    .sort((a, b) => (Number(a.display_order) || 0) - (Number(b.display_order) || 0) || byStart(a, b))
    .map((it) => ({
      id: it.id,
      time: timeIn(it.starts_at, ev),
      title: String(it.title || '').trim() || 'Untitled item',
      who: [it.speaker_name, it.speaker_title].map((s) => String(s || '').trim()).filter(Boolean).join(', '),
      where: String(it.location_text || '').trim(),
    }));
}

export const ROSTER_LINE = 'Names and emails are on the host’s roster.';
export const GONE = 'This event no longer exists.';

/* ------------------------------------------------------------------ *
 * The dialogs: they say only what the Worker does (the map's §2, row 12)
 * ------------------------------------------------------------------ */

export const FEATURE_LINE = 'Featured events rank higher in members’ suggested events. They are not pinned on the public calendar.';
export const SEND_BACK_NOTE = 'The host sees your reason and can edit and submit again. The event stays off the public calendar.';
export const REASON_MAX = 1000;

/** EV5's quick reasons: each fills the reason with a sentence the admin can edit. */
export const QUICK_REASONS = [
  { label: 'Add the venue', text: 'Add the venue address so people know where to go.' },
  { label: 'Fix the date or time', text: 'Check the date and time, then submit again.' },
  { label: 'Say who it is for', text: 'Say who the event is for, so people know whether to come.' },
  { label: 'Not right for the public calendar', text: 'This event is not right for the public calendar. Make it private or unlisted, or change it and submit again.' },
];

export const sendBackReady = (reason) => String(reason || '').trim().length > 0;

export const CAPACITY_ERROR = 'Use a whole number, 0 or more.';

/** "Now: 60 seats · 42 taken · 6 waiting." */
export function capacityNow(ev, c) {
  const cap = ev?.capacity === null || ev?.capacity === undefined ? 'No cap' : plural(Number(ev.capacity), 'seat', 'seats');
  if (c.state !== 'ready' || c.taken === null || c.waitlisted === null) return `Now: ${cap}. Seats taken: ${countText(c, 'taken').toLowerCase()}.`;
  return `Now: ${cap} · ${nf(c.taken)} taken · ${nf(c.waitlisted)} waiting.`;
}

const promoteLine = (n) => `${nf(n)} ${n === 1 ? 'person moves' : 'people move'} off the waitlist, oldest first. Each is told in StudioOS.`;

/**
 * What a new capacity does before it is saved (EV9). Raising moves people off
 * the waitlist, in StudioOS only (there is no email); lowering takes no seat,
 * and new sign-ups join the waitlist only when the waitlist is on.
 * Answers `{ value }` with a `line`, or `{ error }`.
 */
export function capacityPreview(ev, c, raw, noCap = false) {
  const current = ev?.capacity === null || ev?.capacity === undefined ? null : Number(ev.capacity);
  const known = c.state === 'ready' && c.taken !== null && c.waitlisted !== null;
  if (noCap) {
    if (current === null) return { value: null, line: 'Capacity stays the same: no cap.' };
    let line = 'Anyone eligible can register.';
    if (!known) line += ' Everyone on the waitlist moves off it, oldest first. Each is told in StudioOS.';
    else if (c.waitlisted > 0) line += ` ${promoteLine(c.waitlisted)}`;
    return { value: null, line };
  }
  const s = String(raw ?? '').trim();
  if (!/^\d+$/.test(s)) return { error: CAPACITY_ERROR };
  const n = Number(s);
  if (n === current) return { value: n, line: 'Capacity stays the same.' };
  const raising = current !== null && n > current;
  if (raising) {
    if (!known) return { value: n, line: 'People on the waitlist move off it, oldest first, up to the new capacity. Each is told in StudioOS.' };
    if (c.waitlisted === 0) return { value: n, line: 'No one is on the waitlist, so no one moves.' };
    const moving = Math.max(0, Math.min(n - c.taken, c.waitlisted));
    return { value: n, line: moving > 0 ? promoteLine(moving) : `${plural(c.taken, 'seat is', 'seats are')} already taken, so no one moves off the waitlist.` };
  }
  const full = ev?.waitlist_enabled ? 'New sign-ups join the waitlist.' : 'The waitlist is off, so new sign-ups are turned away while it is full.';
  if (!known) return { value: n, line: `No one loses a seat. Once it is full, ${full.charAt(0).toLowerCase()}${full.slice(1)}` };
  if (n <= c.taken) return { value: n, line: `${plural(c.taken, 'seat is', 'seats are')} already taken. No one loses a seat. ${full}` };
  return { value: n, line: `No one loses a seat. ${plural(n - c.taken, 'seat stays', 'seats stay')} open.` };
}

/** After saving: the Worker answers how many it promoted. */
export function capacitySavedLine(promoted) {
  const n = Number(promoted);
  return n > 0 ? `Capacity saved. ${plural(n, 'person', 'people')} moved off the waitlist.` : 'Capacity saved.';
}

/** The longest note the Worker keeps (D917): it trims and caps at 1,000 characters. */
export const NOTE_MAX = 1000;

/**
 * EV10, in the Worker's words: no "every calendar", and no "cannot be undone",
 * because part 2's 409 stops an approve reviving a cancelled event (D917).
 * "It leaves the public calendar" only for an event that is on it (the feed's
 * predicate), never for a draft or a waiting event. The note reaches
 * registrants with an account. The paid box comes from the summary's paid
 * count (D922): it names how many paid and how much; while the summary is
 * unreadable it falls back to the event's price, and says so.
 */
export function cancelCopy(ev, payments = { state: 'loading' }) {
  let paid = null;
  if (payments.state === 'ready') {
    const n = Number(payments.data.paid?.count || 0);
    if (n > 0) paid = `${plural(n, 'paid ticket', 'paid tickets')} (${amounts(payments.data.paid)}) ${n === 1 ? 'is' : 'are'} not refunded automatically. HQ refunds them in Revenue › Billing.`;
  } else if (isPaid(ev)) {
    paid = 'This is a paid event. Its paid tickets could not be counted here; any that were paid are not refunded automatically. HQ refunds them in Revenue › Billing.';
  }
  return {
    title: `Cancel ${titleOf(ev)}?`,
    lines: [
      onPublicCalendar(ev) ? 'It leaves the public calendar.' : 'It is marked cancelled.',
      'People with an account who hold a seat or wait for one are told in StudioOS, with your note. People who signed up with an email only are not told.',
    ],
    noteLabel: 'Note to registrants · optional',
    paid,
    confirm: 'I understand these tickets need a refund',
  };
}

/** EV11a: the host is told, with the note (D917). */
export const unpublishCopy = (ev) => ({
  title: `Take ${titleOf(ev)} off the calendar?`,
  body: 'It goes back to the host as a draft. Registrations stay. The host is told, with your note.',
  noteLabel: 'Note to the host · optional',
});

/** EV11b: Feature, or Stop featuring with the same dialog. */
export const featureCopy = (ev) => (ev?.featured
  ? { title: `Stop featuring ${titleOf(ev)}?`, body: 'It no longer ranks higher in members’ suggested events.', action: 'Stop featuring', next: false }
  : { title: `Feature ${titleOf(ev)}?`, body: FEATURE_LINE, action: 'Feature', next: true });

export const approveTitle = (ev) => `Approve ${titleOf(ev)}?`;
export const sendBackTitle = (ev) => `Send ${titleOf(ev)} back to the host?`;

/* ------------------------------------------------------------------ *
 * Refusals: one sentence under the action
 * ------------------------------------------------------------------ */

export const SUSPENDED = 'This studio’s licence is suspended, so approving and featuring are paused until HQ lifts it.';
export const FROZEN = 'That did not go through: your account is frozen. Writes are paused until you answer HQ’s notice on My licence.';

export function refusalText(err, fallback = 'That did not go through. Try again.') {
  const status = Number(err?.status);
  const code = err?.code || err?.data?.code || (typeof err?.data?.error === 'string' ? err.data.error : null);
  if (code === 'admin_frozen') return FROZEN;
  if (status === 423 || code === 'branch_suspended') return SUSPENDED;
  if (status === 404 || code === 'not_found') return GONE;
  if (code === 'invalid_capacity') return CAPACITY_ERROR;
  return fallback;
}

/* ------------------------------------------------------------------ *
 * One event, complete (D922, #2705): part 3's summary and history
 * ------------------------------------------------------------------ *
 * Every figure here is a count from `GET /api/admin/events/:id/summary`
 * (D918 §5); the roster, with its names and emails, is never read. Each of the
 * summary's blocks answers alone: `{ available: true, … }`, or
 * `{ available: false, unreadable: true, reason }`. A block that failed is
 * drawn as failed, never as zero, and the others still draw.
 */

/** One block of the summary as `{ state, data | reason }`: loading, ready, unreadable or missing. */
export function summaryBlock(read, key) {
  if (!read || read.status === 'loading') return { state: 'loading' };
  if (read.status === 'error') return { state: 'unreadable', reason: 'The event’s counts could not be read. That is not the same as none.' };
  const b = read.data?.[key];
  if (!b || typeof b !== 'object') return { state: 'unreadable', reason: 'The answer held no such block. That is not the same as none.' };
  if (b.available === false) return { state: 'unreadable', reason: String(b.reason || 'It could not be read. That is not the same as none.') };
  return { state: 'ready', data: b };
}

/** The event's type, in the canvas's words (D916's twelve), or null. */
export function typeWord(ev, types) {
  const t = (types || []).find((x) => x.id === ev?.type);
  return t ? t.label : null;
}

const FORMAT_WORD = { in_person: 'In person', virtual: 'Online', hybrid: 'Hybrid' };
/** 'In person', 'Online' or 'Hybrid', from `location_kind`; null when it is something else. */
export const formatWord = (ev) => FORMAT_WORD[ev?.location_kind] || null;

/**
 * "Hosted by [name] · [role] · [venture]". A host with no name, role or
 * venture leaves that part out; no host at all is "Host not recorded".
 * "Hosted by the studio team" waits for O-STU.
 */
export function hostLine(block) {
  if (block.state !== 'ready') return null;
  const host = block.data.host;
  if (!host) return { text: 'Host not recorded', recorded: false };
  const parts = [String(host.name || '').trim() || 'A member', host.role ? roleWord(host.role) : null, String(block.data.venture?.name || '').trim() || null].filter(Boolean);
  return { text: `Hosted by ${parts.join(' · ')}`, recorded: true };
}

const amounts = (paid) => {
  const rows = (paid?.by_currency || []).filter((r) => r.count > 0);
  if (!rows.length) return null;
  return rows.map((r) => {
    if (r.amount_not_recorded >= r.count) return `amount not recorded${r.currency ? ` (${r.currency.toUpperCase()})` : ''}`;
    const sum = money(r.amount_cents, r.currency);
    return r.amount_not_recorded ? `${sum} + ${nf(r.amount_not_recorded)} not recorded` : sum;
  }).join(' · ');
};

/** The second row of tiles (EV7): Paid tickets, Free seats, Invitations. Each from its own block. */
export function summaryTiles(read) {
  const pay = summaryBlock(read, 'payments');
  const free = summaryBlock(read, 'free_seats');
  const inv = summaryBlock(read, 'invitations');
  const tile = (key, label, block, ready) => {
    if (block.state === 'loading') return { key, label, value: READING, words: true };
    if (block.state !== 'ready') return { key, label, value: COULD_NOT_READ, words: true, sub: block.reason, failed: true };
    return { key, label, ...ready(block.data) };
  };
  return [
    tile('paid', 'Paid tickets', pay, (p) => ({ value: nf(p.paid?.count ?? 0), sub: amounts(p.paid) || (Number(p.price_cents) > 0 ? 'None paid yet' : 'A free event') })),
    tile('free', 'Free seats', free, (f) => ({ value: nf(f.count ?? 0), sub: 'From audience rules or free invitations' })),
    tile('invitations', 'Invitations', inv, (i) => ({ value: nf(i.total ?? 0), sub: `sent · ${nf(i.by_status?.accepted ?? 0)} accepted` })),
  ];
}

/**
 * Chart A, "Seats taken over time": the running total of current seat holders
 * by the day each registered. Cancellations and promotions carry no date, so
 * the label says what it counts. A capacity line, and a Today marker when today
 * falls inside the series.
 */
export const SEATS_CHART_LABEL = 'By the date each current seat holder registered. Cancellations and promotions are not dated.';
export function seatsSeries(block, ev, now) {
  if (block.state !== 'ready') return null;
  const days = Array.isArray(block.data.days) ? block.data.days : [];
  const cap = ev?.capacity === null || ev?.capacity === undefined ? null : Number(ev.capacity);
  const today = new Date(now).toISOString().slice(0, 10);
  const points = days.map((d) => ({ day: d.day, total: Number(d.total) }));
  const last = points.length ? points[points.length - 1].day : null;
  return {
    points,
    capacity: Number.isFinite(cap) ? cap : null,
    today: points.length && today >= points[0].day ? today : null,
    todayAfter: Boolean(last && today > last),
    undated: Number(block.data.registered_at_not_recorded || 0),
    alt: points.length
      ? `${nf(points[points.length - 1].total)} seats taken by ${dateLabel(last)}${cap !== null ? `, of ${nf(cap)}` : ''}.`
      : 'No seat holder has a registration date yet.',
  };
}

/**
 * Chart B, the funnel: Registered → Confirmed → Attended. Registered is every
 * current seat (registered, confirmed and attended); Confirmed is confirmed
 * plus attended, because an attendee was confirmed first. Waitlisted,
 * Cancelled and Declined sit beside it as figures, not steps. Attended before
 * the event is held reads "Not held yet", never 0.
 */
export function funnelOf(block, ev, now) {
  if (block.state !== 'ready') return null;
  const s = block.data.by_status || {};
  const n = (k) => Number(s[k] || 0);
  const registered = n('registered') + n('confirmed') + n('attended');
  const confirmed = n('confirmed') + n('attended');
  const held = ev?.status !== 'cancelled' && hasEnded(ev, now) === true;
  const steps = [
    { key: 'registered', label: 'Registered', value: registered },
    { key: 'confirmed', label: 'Confirmed', value: confirmed },
    held || n('attended') > 0
      ? { key: 'attended', label: 'Attended', value: n('attended') }
      : { key: 'attended', label: 'Attended', value: 0, text: ev?.status === 'cancelled' ? 'Not held' : NOT_HELD, dash: true },
  ];
  const beside = [['waitlisted', 'Waitlisted'], ['cancelled', 'Cancelled'], ['declined', 'Declined']].map(([k, label]) => ({ key: k, label, value: n(k) }));
  return { steps, beside, other: n('other') };
}

const PROFILE_ORDER = [
  ['founder', 'Founder'], ['investor', 'Investor'], ['advisor', 'Advisor'], ['partner', 'Operating Partner'],
  ['exploring', 'Explorer'], ['admin', 'Admin'], ['guest', 'Guest (no account)'], ['not_recorded', 'Profile not recorded'],
];
const SOURCE_ORDER = [['signed_up', 'Signed up'], ['invitation', 'Invitation'], ['free_seat', 'Free seat']];

/** Who registered (EV7): seated registrations by profile, and by how the seat was got (D915's order). */
export function registrantRows(roleBlock, sourceBlock) {
  const profile = roleBlock.state === 'ready'
    ? PROFILE_ORDER.map(([k, label]) => ({ key: k, label, value: Number(roleBlock.data.counts?.[k] || 0) })).filter((r) => r.value > 0 || ['founder', 'investor'].includes(r.key))
    : null;
  const source = sourceBlock.state === 'ready'
    ? SOURCE_ORDER.map(([k, label]) => ({ key: k, label, value: Number(sourceBlock.data.counts?.[k] || 0) }))
    : null;
  const added = sourceBlock.state === 'ready' && sourceBlock.data.added_by_admin?.recorded === false ? sourceBlock.data.added_by_admin.reason : null;
  return { profile, source, added };
}

const INVITE_SOURCES = [['manual', 'Sent by the host or an admin'], ['auto_partner', 'Official partners'], ['auto_lp', 'Invested LPs']];
/**
 * Invitations by status and by source. Only these three sources are ever
 * minted as invitations; Investors, Founders and Host's contacts are not, so
 * they are not drawn (map A, EV7).
 */
export function invitationRows(block) {
  if (block.state !== 'ready') return null;
  const st = block.data.by_status || {};
  const src = block.data.by_source || {};
  const status = [['pending', 'Pending'], ['accepted', 'Accepted'], ['declined', 'Declined'], ['revoked', 'Revoked']].map(([k, label]) => ({ key: k, label, value: Number(st[k] || 0) }));
  const source = INVITE_SOURCES.map(([k, label]) => ({ key: k, label, value: Number(src[k] || 0) }));
  if (Number(src.other || 0) > 0) source.push({ key: 'other', label: 'Another source', value: Number(src.other) });
  return { total: Number(block.data.total || 0), status, source };
}

/** Payments (EV7): price, paid and payment pending. Refunds are "Not recorded", with the canvas's line (O-REF). */
export function paymentRows(block) {
  if (block.state !== 'ready') return null;
  const p = block.data;
  const paid = p.paid || { count: 0 };
  return [
    { key: 'price', label: 'Price', value: money(p.price_cents, p.currency) },
    { key: 'paid', label: 'Paid', value: paid.count ? `${nf(paid.count)} · ${amounts(paid)}` : '0' },
    { key: 'pending', label: 'Payment pending', value: nf(p.payment_pending ?? 0) },
    { key: 'refunds', label: 'Refunds', value: NOT_RECORDED, reason: p.refunds?.reason || 'A refunded ticket is not marked here. HQ refunds a ticket’s payment in Revenue › Billing.', unrecorded: true },
  ];
}

const REMINDERS = [['reminder_24h', '24-hour reminder', 24], ['reminder_1h', '1-hour reminder', 1]];
/** Reminders: each one's due time from the event's start, and how many were sent, from the summary. */
export function reminderRows(block, ev, now) {
  if (block.state !== 'ready') return null;
  const start = parseStamp(ev?.starts_at);
  return REMINDERS.map(([kind, label, hours]) => {
    const sent = Number(block.data.by_kind?.[kind] || 0);
    const due = start === null ? null : start - hours * 3600_000;
    const when = due === null ? 'due time not recorded' : `due ${startShort({ ...ev, starts_at: new Date(due).toISOString() })}`;
    let line;
    if (sent > 0) line = `Sent to ${nf(sent)}`;
    else if (ev?.status === 'cancelled') line = 'Not sent: the event is cancelled';
    else if (due !== null && due <= now) line = `Not sent · was ${when}`;
    else line = `Not sent yet · ${when}`;
    return { key: kind, label, line, sent: sent > 0 };
  });
}

const actorWord = (a) => (a === 'host' ? 'the host' : 'an admin');
const ACTION_WORD = {
  event_submitted: (i) => `Submitted for review by ${actorWord(i.actor)}`,
  event_updated: (i) => `Edited by ${actorWord(i.actor)}${Array.isArray(i.fields) && i.fields.length ? `: ${i.fields.map((f) => String(f).replace(/_/g, ' ')).join(', ')}` : ''}`,
  event_approved: (i) => `Approved by ${actorWord(i.actor)}`,
  event_rejected: (i) => `Sent back by ${actorWord(i.actor)}${i.reason ? `: ‘${i.reason}’` : ''}`,
  event_unpublished: (i) => `Unpublished by ${actorWord(i.actor)}`,
  event_featured: (i) => (i.featured ? `Featured by ${actorWord(i.actor)}` : `No longer featured, by ${actorWord(i.actor)}`),
  event_cancelled: (i) => `Cancelled by ${actorWord(i.actor)}`,
  event_capacity_override: (i) => `Capacity set to ${i.capacity === null || i.capacity === undefined ? 'no cap' : nf(i.capacity)} by ${actorWord(i.actor)}`,
};

/**
 * History, newest first: part 3's items, then Created. Actors are "an admin"
 * or "the host", never a name. The host's change after approval
 * (`changed_after_approval_at`) is the amber row.
 */
export function historyRows(read) {
  if (!read || read.status === 'loading') return { state: 'loading' };
  if (read.status === 'error') return { state: 'unreadable', reason: 'The history could not be read. That is not a claim that nothing happened.' };
  const h = read.data?.history;
  if (!h || h.available === false) return { state: 'unreadable', reason: String(h?.reason || 'The history could not be read. That is not a claim that nothing happened.') };
  const rows = (Array.isArray(h.items) ? h.items : []).map((i, n) => ({
    key: `i${n}`, at: i.at, text: (ACTION_WORD[i.action] || ((x) => `${titleCase(String(x.action || '').replace(/^event_/, '').replace(/_/g, ' '))} by ${actorWord(x.actor)}`))(i),
  }));
  if (h.changed_after_approval_at) rows.push({ key: 'changed', at: h.changed_after_approval_at, text: 'The host changed the event after it was approved', amber: true });
  rows.sort((a, b) => (parseStamp(b.at) ?? -Infinity) - (parseStamp(a.at) ?? -Infinity));
  rows.push({ key: 'created', at: h.created_at, text: 'Created' });
  return { state: 'ready', rows: rows.map((r) => ({ ...r, date: dateLabel(r.at) })) };
}
