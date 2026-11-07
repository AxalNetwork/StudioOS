/**
 * D930 (#2367) — Admin › Community at /admin/community, built to the owner's
 * "Community overview" canvas (CM1–CM13). Pure: it turns the reads the page
 * makes into tiles and blocks, and never fetches.
 *
 * EVERY FIGURE IS IN ONE OF FOUR STATES:
 *   - `ready`: read, with its value;
 *   - `loading`: the read has not answered;
 *   - `unreadable`: the read failed, which is not a claim of zero;
 *   - `unrecorded`: no store records it (CM1's two cards), said in a
 *     sentence and never drawn as 0.
 * D930's `notyet` is gone: D933 reads every figure it stood for.
 *
 * THE READS (D930 §2). Each answers alone:
 *   #4717 package 2: ONE SNAPSHOT. Every figure on the page, and every
 *   row behind a figure (next up, needs a decision, most applications), is
 *   the Community read's, under one `as_of`. The page used to read the Studio
 *   glance, every page of the events list, the events analytics, every page
 *   of the job board and the circles list beside it, and recompute what the
 *   read already counted; those reads now belong to the lightboxes alone.
 *   - `overview`  GET /api/admin/community/overview?weeks= — D931's counts,
 *                 the roster's among them (#4717: counted on the server over
 *                 the whole table, archived rows out, never a capped list),
 *                 every period figure and chart (D933). Each block answers
 *                 alone: `{ available: true }`, `{ available: false, reason }`
 *                 or `{ recorded: false, reason }`;
 *   - `activity`  GET /api/admin/community/activity — D932's ten newest rows,
 *                 read by the Recent activity card itself, for its chips.
 *
 * D933 (#2717) draws every figure D930 left waiting for these reads: the
 * period control, every tile and its delta, the weekly chart and its table,
 * the funnel and events by type, who takes part, wellbeing, the waits in
 * Needs a decision, and Recent activity. No block waits for a part any more.
 */

import { SCOPE_LABEL, SCOPE_TITLE } from '../insights/insightsModel';
import { EVENT_TYPES } from '../../../lib/eventTypes.js';

export { SCOPE_LABEL, SCOPE_TITLE };

export const COMMUNITY_PATH = '/admin/community';
export const MOVED_KEY = 'held-community';
export const MOVED_NOTICE = 'Community has a new address. Update your bookmark.';
export const PAGE_LINE = 'What members did in events, jobs, circles and wellbeing, and what waits on you.';
export const PAGE_UNREADABLE = 'Community figures could not be read. Nothing here is a zero.';
export const EMPTY_LINE = 'Community starts with a first circle or event.';
export const AS_ENTERED_TIP = 'An admin types this number on each circle. It is not counted from sign-ups.';

/** The canvas's period control: weeks, in the URL as `?weeks=`. 12 when absent or not one of these. */
export const PERIODS = [
  { weeks: 4, label: '4 weeks' },
  { weeks: 12, label: '12 weeks' },
  { weeks: 52, label: '52 weeks' },
];
export const DEFAULT_WEEKS = 12;

/** The period `?weeks=` names, or the default. */
export function weeksFrom(search) {
  const raw = new URLSearchParams(search || '').get('weeks');
  const w = PERIODS.find((p) => String(p.weeks) === raw);
  return w ? w.weeks : DEFAULT_WEEKS;
}

/** The address with `?weeks=` set, every other parameter kept. */
export function searchWithWeeks(search, weeks) {
  const next = new URLSearchParams(search || '');
  next.set('weeks', String(weeks));
  return `?${next.toString()}`;
}

/** D915: an item waiting longer than this is Overdue (D931's `overdue_hours`). */
export const OVERDUE_HOURS = 72;
/** The check-in band is withheld under this many founders (D931's `min_cohort`). */
export const MIN_CHECKIN_COHORT = 7;
export const CHECKINS_WITHHELD = 'Too few check-ins to show. We show this only when seven or more founders check in.';
export const RECENT_ROWS = 10;

/** CM1's two figures no store records. The canvas's first sentence was stale (D893): see D930 §5. */
export const NOT_RECORDED = [
  {
    key: 'active-members',
    title: 'Active members',
    reason: 'Nothing records who took part in Community, apart from using the platform. Insights counts active accounts platform-wide.',
  },
  {
    key: 'circle-discussions',
    title: 'Circle discussions',
    reason: 'Circles have no discussion store. The number on a circle is typed by an admin.',
  },
];

const nf = (n) => Number(n).toLocaleString('en-US');

/** A SQL or ISO timestamp as epoch ms. An offset-free D1 stamp is UTC. NaN when absent. */
export function stamp(value) {
  if (typeof value !== 'string' || !value.trim()) return Number.NaN;
  const v = value.trim();
  return Date.parse(/(?:[zZ]|[+-]\d{2}:?\d{2})$/.test(v) ? v : `${v.replace(' ', 'T')}Z`);
}

/** "28 Oct" in the event's own time zone, or UTC when the zone is unknown. */
export function dayLabel(value, timeZone = 'UTC') {
  const t = stamp(value);
  if (Number.isNaN(t)) return 'Not recorded';
  const opts = { day: 'numeric', month: 'short' };
  try { return new Date(t).toLocaleDateString('en-GB', { ...opts, timeZone }); } catch { return new Date(t).toLocaleDateString('en-GB', { ...opts, timeZone: 'UTC' }); }
}

/**
 * D1121 (migration 609): a posting's whole days open since an admin last
 * approved it. Null when it is not published (nothing is open); NaN when it
 * is published but was approved before the day was recorded, never 0.
 */
export function jobDaysOpen(job, now) {
  if (!job || job.status !== 'published') return null;
  const t = stamp(job.published_at);
  return Number.isNaN(t) ? Number.NaN : Math.max(0, Math.floor((now - t) / 86_400_000));
}

/** "1 day open", "12 days open", "Days open not recorded", or null when the posting is not open. */
export function daysOpenText(job, now) {
  const d = jobDaysOpen(job, now);
  if (d === null) return null;
  if (Number.isNaN(d)) return 'Days open not recorded';
  return `${nf(d)} ${d === 1 ? 'day' : 'days'} open`;
}

/** "10:42", the page's Updated time. */
export function asOfLabel(ms) {
  return new Date(ms).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

/**
 * Every page of a paged list. `fetchPage(offset)` answers `{ [key]: rows }`.
 * A short page ends it. Fifty full pages (10,000 rows) is refused rather than
 * drawn as a total, because the page would then be counting part of a list.
 */
export async function readAllPages(fetchPage, key, { pageSize = 200, maxPages = 50 } = {}) {
  const out = [];
  for (let page = 0; page < maxPages; page += 1) {
    const answer = await fetchPage(page * pageSize);
    const rows = answer?.[key];
    if (!Array.isArray(rows)) throw new Error(`The ${key} list was not returned`);
    out.push(...rows);
    if (rows.length < pageSize) return out;
  }
  throw new Error(`More than ${nf(pageSize * maxPages)} ${key}; not counted here`);
}

const failed = (r) => r?.status === 'error';


/**
 * One block of the Community read (D931), at `path` under `blocks`:
 *   - `loading` while the read has not answered;
 *   - `unreadable` when the read failed, or the block says it could not be
 *     read, with the block's own sentence;
 *   - `unrecorded` when no store records it;
 *   - `ready`, with the block.
 */
export function blockOf(overview, path, failedReason = 'The Community read could not be read. That is not the same as none.') {
  if (!overview || overview.status === 'loading') return { state: 'loading' };
  if (failed(overview)) return { state: 'unreadable', reason: failedReason };
  let b = overview.data?.blocks;
  for (const k of path.split('.')) b = b?.[k];
  if (b && b.recorded === false) return { state: 'unrecorded', reason: b.reason };
  if (!b || b.available !== true) {
    return { state: 'unreadable', reason: (b && typeof b.reason === 'string' && b.reason) || 'This figure could not be read. That is not the same as none.' };
  }
  return { state: 'ready', block: b };
}

/** "the 12 weeks before", the period a delta compares with. */
export const beforeLabel = (weeks) => `the ${weeks} weeks before`;

/**
 * A period figure against the same number of weeks before it: "+12% on the
 * 12 weeks before", "−8% …", "same as …", or "none in …" when the period
 * before had none, so no percentage is invented from a zero.
 */
export function deltaText(window, previous, weeks) {
  const w = Number(window);
  const p = Number(previous);
  if (!Number.isFinite(w) || !Number.isFinite(p)) return null;
  if (p === 0) return w === 0 ? `none in this period or ${beforeLabel(weeks)}` : `none in ${beforeLabel(weeks)}`;
  const pct = Math.round(((w - p) / p) * 100);
  if (pct === 0) return `same as ${beforeLabel(weeks)}`;
  return `${pct > 0 ? '+' : '−'}${Math.abs(pct)}% on ${beforeLabel(weeks)}`;
}

/** "3 days", "5 hours", "under an hour": a wait in whole units, never rounded up into Overdue. */
export function waitText(hours) {
  const h = Math.floor(Number(hours));
  if (!Number.isFinite(h) || h < 0) return null;
  if (h < 1) return 'under an hour';
  if (h < 24) return `${h} hour${h === 1 ? '' : 's'}`;
  const d = Math.floor(h / 24);
  return `${d} day${d === 1 ? '' : 's'}`;
}

/** "19 Oct", a Monday week's label. */
export const weekLabel = (week) => dayLabel(`${week}T00:00:00Z`);

/** The glance's lane by key, or undefined. `count` is null when the lane failed. */
export function laneOf(glance, key) {
  const lanes = glance?.approvals?.lanes;
  return Array.isArray(lanes) ? lanes.find((l) => l.key === key) : undefined;
}

/**
 * Seats taken on one of Next up's events, as text: "42 / 60", "No cap · 12
 * registered". The count is D918's list row's own `seats_taken` (registered,
 * confirmed and attended together, D915's rule, D1121).
 */
export function seatsText(event) {
  // #4717 package 3: seats and a cap are whole numbers or nothing is drawn; "12" or 1.5 is not a seat count.
  const taken = count(event?.seats_taken);
  if (taken === null) return { text: 'Seats not recorded', missing: true };
  if (event.capacity == null) return { text: `No cap · ${nf(taken)} registered`, taken };
  const cap = count(event.capacity);
  if (cap === null) return { text: 'Seats not recorded', missing: true };
  return { text: `${nf(taken)} / ${nf(cap)}`, taken, fill: cap > 0 ? Math.min(1, taken / cap) : 0 };
}

const JOB_PARTS = [
  ['published', 'Published', 'violet'],
  ['pending_review', 'Pending review', 'sky'],
  ['draft', 'Draft', 'amber'],
  ['closed', 'Closed', 'emerald'],
  ['rejected', 'Rejected', 'muted'],
];

const CIRCLE_TYPES = { founder: 'Founder', investor: 'Investor', partner: 'Partner', advisor: 'Advisor', city: 'City', topic: 'Topic' };
/** The roster's kinds. A legacy `mentor` row counts as Advisor, as #2369 asks. */
const ROSTER_KINDS = [['advisor', 'Advisor'], ['partner', 'Partner'], ['investor', 'Investor']];
const rosterKind = (k) => (k === 'mentor' ? 'advisor' : k);
const ROSTER_UNREAD = 'The roster could not be read. That is not the same as an empty roster.';
const count = (v) => (typeof v === 'number' && Number.isInteger(v) && v >= 0 ? v : null);

// #4717 package 3 — THE READ'S SHAPE IS CHECKED, NEVER PATCHED. Every block's
// figures pass through these before anything is drawn. A count that is
// missing, a string, negative or fractional, and a map without a key the card
// draws, make the block unreadable: `Number(x) || 0` used to turn each of them
// into a zero that looked real.
const FIGURE_UNREAD = 'This figure could not be read. That is not the same as none.';
const isObj = (o) => Boolean(o) && typeof o === 'object' && !Array.isArray(o);
/** The counts at `keys`, or null when any of them is not a whole number. */
function countsAt(obj, keys) {
  if (!isObj(obj)) return null;
  const out = {};
  for (const k of keys) {
    const c = count(obj[k]);
    if (c === null) return null;
    out[k] = c;
  }
  return out;
}
/** A map of counts that carries every key in `keys`; null when one is missing or any value is not a whole number. */
function countMap(obj, keys) {
  if (!isObj(obj)) return null;
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    const c = count(v);
    if (c === null) return null;
    out[k] = c;
  }
  return keys.every((k) => k in out) ? out : null;
}
/** Whole hours waited: a number, or null when the read says none is recorded; undefined when it is malformed. */
const hoursOf = (v) => (v === null ? null : count(v) ?? undefined);
const isText = (v) => typeof v === 'string' && v.trim() !== '';

/**
 * #4717 — the roster, from the Community read's network block: counted on the
 * server over every row, archived rows out. The page used to count
 * `GET /api/admin/network-profiles`, which answers 200 rows unless asked for
 * more, so a larger roster was counted short with nothing said. A count that
 * is missing or not a whole number makes the roster unreadable, never 0.
 */
export function rosterOf(reads) {
  const nb = blockOf(reads.overview, 'network', ROSTER_UNREAD);
  if (nb.state === 'loading') return { state: 'loading' };
  if (nb.state !== 'ready') return { state: 'unreadable', reason: nb.reason || ROSTER_UNREAD };
  const byKind = nb.block.by_kind_state;
  if (!byKind || typeof byKind !== 'object') return { state: 'unreadable', reason: ROSTER_UNREAD };
  const known = new Set(ROSTER_KINDS.map(([k]) => k));
  const rows = ROSTER_KINDS.map(([key, label]) => ({ key, label, active: 0, inactive: 0 }));
  const other = { key: 'other', label: 'Other', active: 0, inactive: 0 };
  for (const [kind, v] of Object.entries(byKind)) {
    const active = count(v?.active);
    const hidden = count(v?.hidden);
    if (active === null || hidden === null) return { state: 'unreadable', reason: ROSTER_UNREAD };
    const k = rosterKind(kind);
    const row = known.has(k) ? rows.find((r) => r.key === k) : other;
    row.active += active;
    row.inactive += hidden;
  }
  if (other.active + other.inactive > 0) rows.push(other);
  return { state: 'ready', rows: rows.map(({ key: _k, ...r }) => r), active: rows.reduce((t, r) => t + r.active, 0) };
}

/**
 * #4717 — THE PAGE'S CLOCK. Days open, waits, Overdue and the next 30 days are
 * measured from the Community read's own `as_of`, so a Refresh moves them with
 * the rows it re-reads. Before that read answers, the moment the page's reads
 * last settled (`asOf`); before anything, now. It used to be frozen at mount.
 */
export function clockOf(reads, asOf) {
  const ov = reads?.overview;
  if (ov?.status === 'ready') {
    const t = Date.parse(ov.data?.as_of);
    if (Number.isFinite(t)) return t;
  }
  return Number.isFinite(asOf) ? asOf : Date.now();
}

/**
 * #4717 — how many wait in each review queue, from the Community read's
 * `queue` (D918's queue for events, the job board's for postings). Null for a
 * queue that could not be read, or whose count is not a whole number.
 */
function queueCounts(reads) {
  const ev = eventQueueOf(reads.overview);
  const jb = jobQueueOf(reads.overview);
  return {
    loading: ev.state === 'loading' || jb.state === 'loading',
    events: ev.state === 'ready' ? ev.count : null,
    jobs: jb.state === 'ready' ? jb.count : null,
  };
}

/**
 * #4717 package 3 — D918's events queue, checked: its count, Overdue and
 * created-at counts are whole numbers, and its oldest wait is hours or null
 * (nothing waiting, or nothing dated). Anything else is unreadable.
 */
function eventQueueOf(overview) {
  const b = blockOf(overview, 'queue.events');
  if (b.state !== 'ready') return b;
  const c = countsAt(b.block, ['count', 'overdue', 'waiting_from_created_at']);
  const oldest = hoursOf(b.block.oldest_hours);
  if (!c || oldest === undefined || c.overdue > c.count || c.waiting_from_created_at > c.count) return { state: 'unreadable', reason: FIGURE_UNREAD };
  return { state: 'ready', count: c.count, overdue: c.overdue, fromCreated: c.waiting_from_created_at, oldestHours: oldest };
}

/** The job board's queue, checked the same way: pending, Overdue and undated are whole numbers. */
function jobQueueOf(overview) {
  const b = blockOf(overview, 'queue.jobs');
  if (b.state !== 'ready') return b;
  const c = countsAt(b.block, ['pending', 'overdue', 'wait_not_recorded']);
  const oldest = hoursOf(b.block.oldest_wait_hours);
  if (!c || oldest === undefined || c.overdue > c.pending || c.wait_not_recorded > c.pending) return { state: 'unreadable', reason: FIGURE_UNREAD };
  return { state: 'ready', count: c.pending, overdue: c.overdue, notRecorded: c.wait_not_recorded, oldestHours: oldest, review: b.block.review };
}

/** The listed experts by state (D931's `wellbeing.experts`), all four whole numbers, or unreadable. */
function expertsOf(overview) {
  const b = blockOf(overview, 'wellbeing.experts');
  if (b.state !== 'ready') return b;
  const c = countsAt(b.block, ['verified', 'unverified', 'hidden', 'inactive']);
  return c ? { state: 'ready', ...c } : { state: 'unreadable', reason: FIGURE_UNREAD };
}

/**
 * D918's show-up block, checked: events, seats taken and attended are whole
 * numbers with attended within the seats; `confirmed` is a whole number within
 * the seats, or absent from an older read (then "Not in this read"); the rate
 * is a share from 0 to 1, or null when no seat was taken.
 */
function showUpOf(overview) {
  const b = blockOf(overview, 'events.show_up');
  if (b.state !== 'ready') return b;
  const c = countsAt(b.block, ['events', 'seats_taken', 'attended']);
  const confirmed = b.block.confirmed == null ? null : count(b.block.confirmed);
  const rate = b.block.rate;
  const rateOk = rate === null || rate === undefined || (typeof rate === 'number' && rate >= 0 && rate <= 1);
  if (!c || !rateOk || c.attended > c.seats_taken || (b.block.confirmed != null && (confirmed === null || confirmed > c.seats_taken))) {
    return { state: 'unreadable', reason: FIGURE_UNREAD };
  }
  return { state: 'ready', events: c.events, seats: c.seats_taken, attended: c.attended, confirmed, rate: rate ?? null };
}

/** #4717 — the circles block's counts, strictly: a missing or odd count makes the block unreadable, never 0. */
function circlesOf(reads) {
  const reason = 'The circles could not be read. That is not the same as no circles.';
  const b = blockOf(reads.overview, 'circles', reason);
  if (b.state === 'loading') return { state: 'loading' };
  if (b.state !== 'ready') return { state: 'unreadable', reason: b.reason || reason };
  const [total, published, featured] = [count(b.block.total), count(b.block.published), count(b.block.featured)];
  const members = count(b.block.members_entered?.value);
  if ([total, published, featured, members].includes(null) || published > total) return { state: 'unreadable', reason };
  const byType = new Map();
  for (const [type, v] of Object.entries(b.block.by_type || {})) {
    const c = count(v);
    if (c === null) return { state: 'unreadable', reason };
    const label = CIRCLE_TYPES[type] || 'Other';
    byType.set(label, (byType.get(label) || 0) + c);
  }
  return {
    state: 'ready', total, published, draft: total - published, featured, membersEntered: members,
    byType: [...byType].map(([label, value]) => ({ label, value })).filter((r) => r.value > 0).sort((a, b) => b.value - a.value),
  };
}

/** The server's days open (D1121) as the card's words; `{ recorded: false }` is "not recorded", never 0. */
function daysOpenWords(d) {
  if (d === null || d === undefined) return null;
  if (typeof d === 'object' && d.recorded === false) return 'Days open not recorded';
  const n = count(d);
  return n === null ? 'Days open not recorded' : `${nf(n)} ${n === 1 ? 'day' : 'days'} open`;
}

/** The page's eight tiles, CM1 rows 1 and 2, in the canvas's order. */
export function buildTiles(reads) {
  const tiles = [];

  // Waiting on you — the two review queues, added (#4717: the Community read's own counts).
  const wait = { key: 'waiting', label: 'Waiting on you' };
  const q = queueCounts(reads);
  if (q.loading) tiles.push({ ...wait, state: 'loading' });
  else {
    const ev = { count: q.events };
    const jb = { count: q.jobs };
    if (ev.count === null || jb.count === null) {
      tiles.push({ ...wait, state: 'unreadable', reason: 'The events or jobs queue could not be read, so there is no total.' });
    } else {
      const age = oldestWait(reads.overview);
      tiles.push({
        ...wait,
        state: 'ready',
        value: nf(ev.count + jb.count),
        sub: `${nf(ev.count)} events · ${nf(jb.count)} jobs${age.text ? ` · oldest ${age.text}` : ''}`,
        overdue: age.overdue,
        note: age.note,
      });
    }
  }

  // Upcoming events — D918's next 30 days (published or waiting) and their seats taken (D1121).
  const up = { key: 'upcoming', label: 'Upcoming events' };
  const ub = blockOf(reads.overview, 'events.upcoming');
  if (ub.state !== 'ready') tiles.push({ ...up, ...ub });
  else {
    const c = countsAt(ub.block, ['events', 'seats_taken']);
    tiles.push(c
      ? { ...up, state: 'ready', value: nf(c.events), sub: `next 30 days · ${nf(c.seats_taken)} registered` }
      : { ...up, state: 'unreadable', reason: FIGURE_UNREAD });
  }

  const weeks = reads.overview?.data?.weeks;
  const period = (key, label, path, pick) => {
    const b = blockOf(reads.overview, path);
    if (b.state !== 'ready') return { key, label, ...b };
    // #4717: a figure the block does not carry as whole numbers is unreadable, never 0 and never a crash.
    const fig = pick(b.block) || {};
    const window = count(fig.window);
    const previous = count(fig.previous);
    if (window === null || previous === null) return { key, label, state: 'unreadable', reason: 'This figure could not be read. That is not the same as none.' };
    return { key, label, state: 'ready', value: nf(window), sub: deltaText(window, previous, weeks) };
  };
  tiles.push(period('registrations', 'Event registrations', 'events.weekly', (b) => b.registrations));
  tiles.push(period('applications', 'Job applications', 'jobs', (b) => b.applications));
  tiles.push(showUpTile(reads.overview, weeks));

  // Published circles — "[9] of [11]".
  const pc = { key: 'circles', label: 'Published circles' };
  const ci = circlesOf(reads);
  if (ci.state !== 'ready') tiles.push({ ...pc, state: ci.state, ...(ci.reason ? { reason: ci.reason } : {}) });
  else tiles.push({ ...pc, state: 'ready', value: `${nf(ci.published)} of ${nf(ci.total)}` });

  // Advisors & partners — active on the roster.
  const ro = { key: 'roster', label: 'Advisors & partners' };
  const roster = rosterOf(reads);
  if (roster.state !== 'ready') tiles.push({ ...ro, state: roster.state, ...(roster.reason ? { reason: roster.reason } : {}) });
  else tiles.push({ ...ro, state: 'ready', value: nf(roster.active), sub: 'active on the roster' });

  const ex = expertsOf(reads.overview);
  if (ex.state !== 'ready') tiles.push({ key: 'experts', label: 'Wellbeing experts', ...ex });
  else {
    const { verified, unverified, hidden, inactive } = ex;
    const away = [hidden ? `${nf(hidden)} hidden` : null, inactive ? `${nf(inactive)} inactive` : null].filter(Boolean).join(' · ');
    tiles.push({
      key: 'experts',
      label: 'Wellbeing experts',
      state: 'ready',
      value: `${nf(verified)} verified of ${nf(verified + unverified)}`,
      sub: away ? `listed · ${away} not listed` : 'listed, sample experts not counted',
    });
  }
  return tiles;
}

/**
 * The oldest wait in the review queues (D931's `queue`), and whether anything
 * is Overdue. A queue that could not be read gives no age, and says so; one
 * whose items have no recorded submission says how many, and never dates them.
 */
export function oldestWait(overview) {
  const ev = eventQueueOf(overview);
  const jb = jobQueueOf(overview);
  if (ev.state === 'loading' || jb.state === 'loading') return { text: null, overdue: false, note: null };
  const hours = [];
  const notes = [];
  let overdue = false;
  if (ev.state === 'ready') {
    if (ev.oldestHours !== null) hours.push(ev.oldestHours);
    overdue ||= ev.overdue > 0;
    if (ev.fromCreated > 0) notes.push(`${nf(ev.fromCreated)} events wait from when they were created; their submission was not stamped.`);
  } else notes.push('How long events have waited could not be read.');
  if (jb.state === 'ready') {
    if (jb.oldestHours !== null) hours.push(jb.oldestHours);
    overdue ||= jb.overdue > 0;
    if (jb.notRecorded > 0) notes.push(`${nf(jb.notRecorded)} jobs were submitted before waits were recorded, so they are not dated or marked overdue.`);
  } else notes.push('How long jobs have waited could not be read.');
  return {
    text: hours.length ? waitText(Math.max(...hours)) : null,
    overdue,
    note: notes.length ? notes.join(' ') : null,
  };
}

/** Show-up for the events that ended in the period: attended over seats taken (D918's rule). */
function showUpTile(overview, weeks) {
  const base = { key: 'show-up', label: 'Show-up rate' };
  const b = showUpOf(overview);
  if (b.state !== 'ready') return { ...base, ...b };
  const { events, seats, attended } = b;
  if (!events) return { ...base, state: 'ready', value: '—', sub: `No event ended in these ${weeks} weeks.` };
  if (!seats) return { ...base, state: 'ready', value: '—', sub: `No seat was taken on the ${nf(events)} events that ended.` };
  // The share is counted from the checked counts, so it cannot disagree with "x of y seats".
  return { ...base, state: 'ready', value: `${Math.round((attended / seats) * 100)}%`, sub: `${nf(attended)} of ${nf(seats)} seats · ${nf(events)} events ended` };
}

/**
 * The Events card's Next up: the three soonest events in the next 30 days, the
 * Community read's `events.next_up`. They are the same events the Upcoming
 * tile counts (published or waiting, D918's rule), so the list and the number
 * cannot disagree (#4717); a waiting event says so. Seats are each event's own
 * seats taken (D915's rule, D1121).
 */
export function buildNextUp(reads) {
  const b = blockOf(reads.overview, 'events.next_up', 'The next events could not be read. That is not the same as no events.');
  if (b.state !== 'ready') return b;
  // #4717 package 3: every row names an event and its start, and there are no more rows than the total.
  const total = count(b.block.total);
  if (!Array.isArray(b.block.rows) || total === null || b.block.rows.length > total
    || !b.block.rows.every((e) => isObj(e) && isText(e.title) && isText(e.starts_at) && e.event_id != null)) {
    return { state: 'unreadable', reason: 'The next events could not be read. That is not the same as no events.' };
  }
  const rows = b.block.rows.map((e) => ({
    id: e.event_id,
    title: e.title,
    day: dayLabel(e.starts_at, e.timezone || 'UTC'),
    seats: seatsText(e),
    waiting: e.status === 'pending_review',
  }));
  return { state: 'ready', rows };
}

/**
 * The Jobs card: postings by status (a 100% bar), and the five with most
 * applications of all time, each with its days open — the Community read's
 * `jobs.by_status` and `jobs.most_applied` (#4717). A status count that is
 * missing or not a whole number makes the card unreadable, never 0.
 */
export function buildJobs(reads) {
  const reason = 'The job board could not be read. That is not the same as no jobs.';
  const b = blockOf(reads.overview, 'jobs', reason);
  if (b.state === 'loading') return b;
  if (b.state !== 'ready') return { state: 'unreadable', reason: b.reason || reason };
  // #4717 package 3: the read counts every status, zeros included; a status it leaves out is not a zero.
  const by = countMap(b.block.by_status, JOB_PARTS.map(([key]) => key));
  if (!by || !Array.isArray(b.block.most_applied)) return { state: 'unreadable', reason };
  const values = Object.entries(by);
  // #4717 package 3: each most-applied row names its posting and counts its applications in whole numbers.
  if (!b.block.most_applied.every((j) => isObj(j) && isText(j.title) && count(j.applications) !== null)) return { state: 'unreadable', reason };
  const counts = new Map(values);
  const parts = JOB_PARTS.map(([key, label, tone]) => ({ label, tone, value: counts.get(key) || 0 }));
  const total = values.reduce((t, [, v]) => t + v, 0);
  const other = total - parts.reduce((t, x) => t + x.value, 0);
  if (other > 0) parts.push({ label: 'Other', tone: 'muted', value: other });
  const most = b.block.most_applied.map((j) => ({
    id: j.posting_id, title: j.title, company: j.company || null, applications: j.applications, daysOpen: daysOpenWords(j.days_open),
  }));
  return { state: 'ready', total, parts, most };
}

/** The Circles and roster card. Members are as entered; the roster is counted, never named. */
export function buildCircles(reads) {
  return { circles: circlesOf(reads), roster: rosterOf(reads) };
}

/**
 * Needs a decision: pending events and jobs, oldest first, at most six rows,
 * from the Community read (#4717): `queue.event_rows` (D918's oldest waiting
 * events) and `queue.jobs.review` (the job board's). Each row's wait and
 * Overdue (past 72 hours, D915) are the server's, measured at its `as_of`:
 *   - an event waits from `submitted_at`, or from `created_at` when it was
 *     queued before submission was stamped, and it says so;
 *   - a job submitted before migration 550 has no recorded wait, and is never
 *     Overdue or a wait of 0.
 * `total` and `overdue` are the queues' own counts, not the rows'.
 * Nothing is decided here: Review opens the console that decides.
 */
export function buildNeeds(reads) {
  const er = blockOf(reads.overview, 'queue.event_rows');
  const eq = eventQueueOf(reads.overview);
  const jq = jobQueueOf(reads.overview);
  if ([er, eq, jq].some((b) => b.state === 'loading')) return { state: 'loading' };
  // #4717 package 3: a row is listed only when it has a title and its wait is hours or not recorded.
  const rowOk = (r, wait) => isObj(r) && isText(r.title) && hoursOf(r[wait]) !== undefined;
  const evOk = er.state === 'ready' && eq.state === 'ready' && Array.isArray(er.block.rows) && er.block.rows.every((r) => rowOk(r, 'waiting_hours'));
  const jbOk = jq.state === 'ready' && Array.isArray(jq.review) && jq.review.every((r) => rowOk(r, 'waiting_hours'));
  if (!evOk && !jbOk) return { state: 'unreadable', reason: 'Neither the events nor the job board could be read. That is not the same as nothing waiting.' };
  const wait = (hours, fromCreated) => (hours === null || hours === undefined
    ? 'wait not recorded'
    : `waiting ${waitText(Number(hours))}${fromCreated ? ' · since created' : ''}`);
  const items = [];
  if (evOk) {
    for (const e of er.block.rows) {
      items.push({ kind: 'Event', id: `event-${e.event_id}`, title: e.title, sub: null, wait: wait(e.waiting_hours, e.from_created), overdue: e.overdue === true, since: stamp(e.waiting_since) });
    }
  }
  if (jbOk) {
    for (const j of jq.review) {
      items.push({ kind: 'Job', id: `job-${j.posting_id}`, title: j.title, sub: j.company || null, wait: wait(j.waiting_hours, false), overdue: j.overdue === true, since: stamp(j.waiting_since) });
    }
  }
  // Oldest first; a wait not recorded is listed after every dated one.
  items.sort((a, b) => (Number.isNaN(a.since) ? 1 : Number.isNaN(b.since) ? -1 : a.since - b.since));
  return {
    state: 'ready',
    total: (evOk ? eq.count : 0) + (jbOk ? jq.count : 0),
    overdue: (evOk ? eq.overdue : 0) + (jbOk ? jq.overdue : 0),
    rows: items.slice(0, 6),
    partial: !evOk ? 'The events queue could not be read, so only jobs are listed.' : !jbOk ? 'The job board could not be read, so only events are listed.' : null,
  };
}

const ROLE_LABELS = [
  ['founder', 'Founder'], ['investor', 'Investor'], ['advisor', 'Advisor'], ['operating_partner', 'Operating partner'],
  ['explorer', 'Explorer'], ['guest', 'Guest'], ['other', 'Other'],
];
const ROLE_PLURAL = {
  founder: 'Founders', investor: 'Investors', advisor: 'Advisors', operating_partner: 'Operating partners', explorer: 'Explorers', guest: 'Guests', other: 'Other accounts',
};

/**
 * A weekly series' counts on the read's own weeks; a week the block does not
 * carry is null, which breaks the line. #4717 package 3: null for the whole
 * series when the rows are not a list, or a row is not on one of the read's
 * weeks, or its count is not a whole number,
 * so the series is named as unreadable instead of drawn with holes or zeros.
 */
function onWeeks(weeks, rows, key) {
  if (!Array.isArray(rows)) return null;
  const by = new Map();
  for (const r of rows) {
    const c = isObj(r) ? count(r[key]) : null;
    if (c === null || !weeks.includes(r.week)) return null;
    by.set(r.week, c);
  }
  return weeks.map((w) => (by.has(w) ? by.get(w) : null));
}

/** The read's Monday weeks, or null when they are not a list of dates. */
function weeksOf(data) {
  const w = data?.week_starts;
  return Array.isArray(w) && w.every(isText) ? w : null;
}

const pct = (part, whole) => (whole > 0 ? Math.round((part / whole) * 100) : 0);

/**
 * CM1 row 3 and CM7: registrations, applications and expert bookings by
 * Monday week, the current week hollow and "so far" in its table. A series
 * whose block could not be read is left out and named; the others draw.
 * Then the one sentence on the biggest change against the weeks before.
 */
export function buildActivity(reads) {
  const o = reads.overview;
  if (!o || o.status === 'loading') return { state: 'loading' };
  if (failed(o)) return { state: 'unreadable', reason: 'The Community read could not be read. That is not the same as no activity.' };
  const weeks = weeksOf(o.data);
  if (!weeks) return { state: 'unreadable', reason: 'The weeks of this read could not be read. That is not the same as no activity.' };
  const current = weeks.indexOf(o.data?.current_week);
  const specs = [
    { key: 'registrations', label: 'Event registrations', noun: 'event registrations', tone: 'violet', path: 'events.weekly', rows: (b) => b.weekly, field: 'registrations', totals: (b) => b.registrations, opens: 'events' },
    { key: 'applications', label: 'Job applications', noun: 'job applications', tone: 'sky', path: 'jobs', rows: (b) => b.weekly, field: 'count', totals: (b) => b.applications },
    { key: 'bookings', label: 'Expert bookings', noun: 'expert bookings', tone: 'amber', path: 'wellbeing.bookings', rows: (b) => b.weekly, field: 'count', totals: (b) => ({ window: b.window, previous: b.previous }) },
  ];
  const series = [];
  const missing = [];
  const totals = [];
  for (const sp of specs) {
    const b = blockOf(o, sp.path);
    if (b.state !== 'ready') { missing.push(sp.label); continue; }
    // #4717 package 3: a series whose weeks or totals are not whole numbers is named as missing, never drawn as zeros.
    const values = onWeeks(weeks, sp.rows(b.block), sp.field);
    const t = countsAt(sp.totals(b.block), ['window', 'previous']);
    if (!values || !t) { missing.push(sp.label); continue; }
    // D1121: a point on the events series opens CM3, the events lightbox.
    series.push({ key: sp.key, label: sp.label, tone: sp.tone, dash: series.length === 1, values, ...(sp.opens ? { clickable: true, opens: sp.opens } : {}) });
    totals.push({ noun: sp.noun, window: t.window, previous: t.previous });
  }
  if (!series.length) return { state: 'unreadable', reason: 'Registrations, applications and bookings could not be read. That is not the same as none.' };
  const labels = weeks.map(weekLabel);
  return {
    state: 'ready',
    chart: { type: 'lines', series, labels, currentIndex: current },
    missing: missing.length ? `${missing.join(', ')} could not be read, so ${missing.length === 1 ? 'it is' : 'they are'} not drawn. That is not the same as none.` : null,
    sentence: biggestChange(totals, o.data.weeks),
  };
}

/**
 * The one sentence on the biggest change, written from the numbers: the
 * series whose count moved most against the weeks before. The current week is
 * to date, which the sentence says.
 */
export function biggestChange(totals, weeks) {
  if (!totals.length) return null;
  const moved = totals.map((t) => ({ ...t, by: t.window - t.previous })).sort((a, b) => Math.abs(b.by) - Math.abs(a.by));
  const top = moved[0];
  if (top.by === 0) {
    return top.window === 0 && moved.every((t) => t.window === 0 && t.previous === 0)
      ? `Nothing was recorded in these ${weeks} weeks or ${beforeLabel(weeks)}.`
      : `Nothing changed against ${beforeLabel(weeks)}: each count is the same.`;
  }
  const word = top.by > 0 ? 'up' : 'down';
  const name = top.noun.charAt(0).toUpperCase() + top.noun.slice(1);
  return `${name} moved most: ${nf(top.window)} in these ${weeks} weeks, this week so far, ${word} from ${nf(top.previous)} in ${beforeLabel(weeks)}.`;
}

/**
 * The Events card's funnel and events by type, from D918's blocks:
 *   - the funnel is the events that ended in the period: their seats taken
 *     (registered, confirmed and attended together), then the seats past
 *     confirmation (confirmed or attended, D918's `confirmed`, D1121), then
 *     attended. A read without the count says so, never 0;
 *   - waitlisted sits beside it, the seats waiting on upcoming events;
 *   - events by type, published or waiting, starting in the period, over the
 *     twelve stored types (`other` among them). Types with none are behind
 *     "Show all".
 */
export function buildEventsFunnel(reads) {
  const out = {};
  const su = showUpOf(reads.overview);
  if (su.state !== 'ready') out.funnel = su;
  else {
    const { seats, attended, confirmed } = su;
    out.funnel = {
      state: 'ready',
      events: su.events,
      steps: [
        { key: 'registered', label: 'Registered', value: seats, share: seats > 0 ? 100 : 0 },
        confirmed == null
          ? { key: 'confirmed', label: 'Confirmed', value: null, note: 'Not in this read.' }
          : { key: 'confirmed', label: 'Confirmed', value: confirmed, share: pct(confirmed, seats) },
        { key: 'attended', label: 'Attended', value: attended, share: pct(attended, seats) },
      ],
    };
  }
  const wl = blockOf(reads.overview, 'events.waitlisted');
  const wc = wl.state === 'ready' ? countsAt(wl.block, ['registrations', 'events']) : null;
  out.waitlisted = wl.state !== 'ready' ? wl
    : wc ? { state: 'ready', value: wc.registrations, events: wc.events }
      : { state: 'unreadable', reason: FIGURE_UNREAD };
  const bt = blockOf(reads.overview, 'events.by_type');
  // #4717 package 3: the read counts all twelve types, zeros included; a type it leaves out is not a zero.
  const counts = bt.state === 'ready' ? countMap(bt.block.counts, EVENT_TYPES.map((t) => t.id)) : null;
  if (bt.state !== 'ready') out.byType = bt;
  else if (!counts) out.byType = { state: 'unreadable', reason: FIGURE_UNREAD };
  else {
    const rows = EVENT_TYPES.map((t) => ({ key: t.id, label: t.label, value: counts[t.id] }));
    const shown = rows.filter((r) => r.value > 0).sort((a, b) => b.value - a.value);
    const none = rows.filter((r) => r.value === 0);
    out.byType = { state: 'ready', shown, none, total: shown.reduce((t, r) => t + r.value, 0) };
  }
  return out;
}

/**
 * Who takes part: registrations and applications in the period, stacked by
 * profile. One part that failed is left out and named; both failing is
 * unreadable. A registration from an account that is gone is not given a
 * profile, and the card says how many.
 */
export function buildWho(reads) {
  // #4717 package 3: a part is drawn only when it counts every profile, and (events) the accounts that are gone, in whole numbers.
  const roleKeys = ROLE_LABELS.map(([k]) => k);
  const checked = (b, extra) => {
    if (b.state !== 'ready') return b;
    const by = countMap(b.block.by_role, roleKeys);
    const gone = extra ? count(b.block.not_recorded) : 0;
    return by && gone !== null ? { state: 'ready', block: { by_role: by, not_recorded: gone } } : { state: 'unreadable', reason: FIGURE_UNREAD };
  };
  const ev = checked(blockOf(reads.overview, 'participation_by_role.events'), true);
  const jb = checked(blockOf(reads.overview, 'participation_by_role.jobs'), false);
  if (ev.state === 'loading' || jb.state === 'loading') return { state: 'loading' };
  if (ev.state !== 'ready' && jb.state !== 'ready') {
    return { state: 'unreadable', reason: 'Who registered and who applied could not be read. That is not the same as no one.' };
  }
  const parts = [];
  if (ev.state === 'ready') parts.push({ key: 'events', label: 'Event registrations', tone: 'violet', by: ev.block.by_role });
  if (jb.state === 'ready') parts.push({ key: 'jobs', label: 'Job applications', tone: 'sky', by: jb.block.by_role });
  const rows = ROLE_LABELS.map(([key, label]) => {
    const ps = parts.map((p) => ({ key: p.key, label: p.label, tone: p.tone, value: p.by[key] }));
    return { key, label, parts: ps, total: nf(ps.reduce((t, p) => t + p.value, 0)), sum: ps.reduce((t, p) => t + p.value, 0) };
  });
  const all = rows.reduce((t, r) => t + r.sum, 0);
  const top = [...rows].sort((a, b) => b.sum - a.sum)[0];
  const what = parts.map((p) => p.label.toLowerCase()).join(' and ');
  const sentence = all === 0
    ? `No ${what} in these ${reads.overview.data.weeks} weeks.`
    : `${ROLE_PLURAL[top.key]} took the largest share: ${nf(top.sum)} of ${nf(all)} ${what} (${pct(top.sum, all)}%).`;
  const gone = ev.state === 'ready' ? ev.block.not_recorded : 0;
  return {
    state: 'ready',
    rows: rows.filter((r) => r.sum > 0),
    parts: parts.map(({ key, label, tone }) => ({ key, label, tone })),
    sentence,
    missing: ev.state !== 'ready' ? 'Event registrations could not be read, so only applications are drawn.'
      : jb.state !== 'ready' ? 'Job applications could not be read, so only registrations are drawn.' : null,
    gone: gone ? `${nf(gone)} registrations are from accounts that are gone, so they have no profile here.` : null,
  };
}

/**
 * The Wellbeing card: experts by state as a 100% bar, bookings by week, and
 * the check-in band. Each part answers alone. The band is a range of
 * founders, never a mood or a stress figure, and under seven it is withheld
 * with the canvas's sentence.
 */
export function buildWellbeing(reads) {
  const out = {};
  const ex = expertsOf(reads.overview);
  out.experts = ex.state !== 'ready' ? ex : {
    state: 'ready',
    parts: [
      { label: 'Verified', tone: 'violet', value: ex.verified },
      { label: 'Unverified', tone: 'sky', value: ex.unverified },
      { label: 'Inactive', tone: 'amber', value: ex.inactive },
      { label: 'Hidden', tone: 'muted', value: ex.hidden },
    ],
  };
  if (out.experts.state === 'ready') out.experts.total = out.experts.parts.reduce((t, p) => t + p.value, 0);
  const bk = blockOf(reads.overview, 'wellbeing.bookings');
  const weeks = bk.state === 'ready' ? weeksOf(reads.overview.data) : null;
  const values = weeks ? onWeeks(weeks, bk.block.weekly, 'count') : null;
  const bookedInWindow = bk.state === 'ready' ? count(bk.block.window) : null;
  if (bk.state !== 'ready') out.bookings = bk;
  else if (!values || bookedInWindow === null) out.bookings = { state: 'unreadable', reason: FIGURE_UNREAD };
  else {
    const current = weeks.indexOf(reads.overview.data.current_week);
    out.bookings = {
      state: 'ready',
      window: bookedInWindow,
      rows: weeks.map((w, i) => ({ label: weekLabel(w), value: values[i] ?? 0, text: values[i] == null ? '–' : nf(values[i]), toDate: i === current })),
    };
  }
  const ci = blockOf(reads.overview, 'wellbeing.checkins');
  // #4717 package 3: withheld is said only when the read says so; a band is shown only when both ends are whole
  // numbers and its top reaches the cohort of seven (seven founders are the band 5 to 9). Anything else is
  // unreadable, never a band and never "too few".
  const band = ci.state === 'ready' && ci.block.withheld === false ? countsAt(ci.block.band, ['at_least', 'under']) : null;
  if (ci.state !== 'ready') out.checkins = ci;
  else if (ci.block.withheld === true) out.checkins = { state: 'ready', withheld: true, text: CHECKINS_WITHHELD };
  else if (!band || band.under - 1 < MIN_CHECKIN_COHORT || band.under <= band.at_least) {
    out.checkins = { state: 'unreadable', reason: 'The check-ins could not be read. That is not the same as none.' };
  } else {
    out.checkins = { state: 'ready', withheld: false, text: `${nf(band.at_least)} to ${nf(band.under - 1)} founders checked in` };
  }
  return out;
}

/** CM1 row 8: five console doors, one figure each. */
export function buildConsoles(reads) {
  const q = queueCounts(reads);
  const lane = (key) => {
    if (q.loading) return { state: 'loading' };
    return q[key] === null ? { state: 'unreadable' } : { state: 'ready', text: `${nf(q[key])} pending` };
  };
  const ci = circlesOf(reads);
  return {
    events: lane('events'),
    jobs: lane('jobs'),
    circles: ci.state === 'ready' ? { state: 'ready', text: `${nf(ci.draft)} drafts` } : { state: ci.state },
    roster: (() => {
      const ro = rosterOf(reads);
      return ro.state === 'ready' ? { state: 'ready', text: `${nf(ro.active)} active` } : { state: ro.state === 'loading' ? 'loading' : 'unreadable' };
    })(),
    wellbeing: (() => {
      const ex = expertsOf(reads.overview);
      return ex.state === 'ready' ? { state: 'ready', text: `${nf(ex.unverified)} to verify` } : { state: ex.state === 'loading' ? 'loading' : 'unreadable' };
    })(),
  };
}

/** CM10 variant B: every read failed. The consoles strip still works. */
export function pageFailed(reads) {
  // #4717: the page has one read; when it fails, nothing is drawn.
  return failed(reads.overview);
}

/**
 * CM8: the Community read answered, and nothing has happened yet: no event in
 * any status, no posting in any status and no circle. Zeros are real here,
 * and only the read's own counts decide it (#4717); a block it could not read
 * is never taken for an empty one.
 */
export function isEmptyCommunity(reads) {
  const ev = blockOf(reads.overview, 'events.by_status');
  const jb = blockOf(reads.overview, 'jobs');
  const ci = circlesOf(reads);
  if (ev.state !== 'ready' || jb.state !== 'ready' || ci.state !== 'ready') return false;
  const zero = (o) => o && typeof o === 'object' && Object.values(o).every((v) => count(v) === 0);
  return zero(ev.block.counts) && zero(jb.block.by_status) && ci.total === 0;
}
