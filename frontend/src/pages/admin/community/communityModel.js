/**
 * D930 (#2367) — Admin › Community at /admin/community, built to the owner's
 * "Community overview" canvas (CM1–CM13). Pure: it turns the reads the page
 * makes into tiles and blocks, and never fetches.
 *
 * EVERY FIGURE IS IN ONE OF FOUR STATES:
 *   - `ready`: read, with its value;
 *   - `loading`: the read has not answered;
 *   - `unreadable`: the read failed, which is not a claim of zero;
 *   - `unrecorded`: no store records it (CM1's two cards, Confirmed on its
 *     own in the funnel), said in a sentence and never drawn as 0.
 * D930's `notyet` is gone: D933 reads every figure it stood for.
 *
 * THE READS (D930 §2). Each answers alone:
 *   - `glance`    GET /api/admin/studio/glance — the events and jobs lanes;
 *   - `events`    GET /api/admin/events, every page, published and waiting;
 *   - `analytics` GET /api/admin/events/analytics — its 200 rows only, under
 *                 D915's Guard G. Its `summary` is all time and is never read;
 *   - `jobs`      GET /api/admin/jobs, every page, every status;
 *   - `circles`   GET /api/admin/circles;
 *   - `roster`    GET /api/admin/network-profiles — counts only, no name;
 *   - `overview`  GET /api/admin/community/overview?weeks= — D931's counts,
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
const DAY = 86_400_000;

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

const ready = (r) => r?.status === 'ready';
const failed = (r) => r?.status === 'error';

/** A tile or block whose read has not answered or failed, or null when it is ready. */
function pending(read, reason) {
  if (!read || read.status === 'loading') return { state: 'loading' };
  if (failed(read)) return { state: 'unreadable', reason };
  return null;
}

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
 * Events that count as "next 30 days": published or waiting for review, and
 * starting from now to 30 days on. The Events desk uses the same rule (D915),
 * so the two pages cannot disagree.
 */
export function upcomingEvents(events, now) {
  return (events || [])
    .filter((e) => e.status === 'published' || e.status === 'pending_review')
    .filter((e) => { const t = stamp(e.starts_at); return t >= now && t < now + 30 * DAY; })
    .sort((a, b) => stamp(a.starts_at) - stamp(b.starts_at));
}

/**
 * D915's Guard G, for seats taken. The analytics rows are one query, capped
 * at the 200 latest starts. They can be drawn only when:
 *   - the read answered and did not list `events` as unreadable;
 *   - it carries rows whenever there are events to cover.
 * An event missing from the rows is "Not in this read", never 0.
 */
export function seatsRead(analytics, events) {
  if (!analytics || analytics.status === 'loading') return { state: 'loading' };
  const data = analytics.data;
  if (failed(analytics) || !data || !Array.isArray(data.events) || (data.unreadable || []).includes('events')) {
    return { state: 'unreadable' };
  }
  if ((events || []).length > 0 && data.events.length === 0) return { state: 'unreadable' };
  return { state: 'ready', byId: new Map(data.events.map((r) => [Number(r.id), r])) };
}

/** Seats taken on one event, as text: "42 / 60", "No cap · 12 registered", or why not. */
export function seatsText(seats, event) {
  if (seats.state === 'loading') return { text: 'Reading…' };
  if (seats.state === 'unreadable') return { text: 'Seats could not be read', unreadable: true };
  const row = seats.byId.get(Number(event.id));
  if (!row) return { text: 'Not in this read', missing: true };
  const taken = Number(row.registrations || 0);
  if (event.capacity == null) return { text: `No cap · ${nf(taken)} registered`, taken };
  const cap = Number(event.capacity);
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

/** The page's eight tiles, CM1 rows 1 and 2, in the canvas's order. */
export function buildTiles(reads, now) {
  const { glance, events, analytics, circles, roster } = reads;
  const tiles = [];

  // Waiting on you — the glance's two lanes, added.
  const wait = { key: 'waiting', label: 'Waiting on you' };
  const wp = pending(glance, 'The Studio glance could not be read, so this is not a claim that nothing waits.');
  if (wp) tiles.push({ ...wait, ...wp });
  else {
    const ev = laneOf(glance.data, 'events');
    const jb = laneOf(glance.data, 'jobs');
    if (!ev || !jb || ev.count === null || jb.count === null) {
      tiles.push({ ...wait, state: 'unreadable', reason: 'The Events or Jobs lane could not be read, so there is no total.' });
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

  // Upcoming events — next 30 days, and the seats taken on them under Guard G.
  const up = { key: 'upcoming', label: 'Upcoming events' };
  const upp = pending(events, 'The events list could not be read. That is not the same as no events.');
  if (upp) tiles.push({ ...up, ...upp });
  else {
    const list = upcomingEvents(events.data, now);
    const all = [...events.data];
    const seats = seatsRead(analytics, all);
    let reg;
    if (seats.state === 'loading') reg = 'registered: reading…';
    else if (seats.state === 'unreadable') reg = 'registered: could not be read';
    else if (list.some((e) => !seats.byId.has(Number(e.id)))) reg = 'registered: not in this read';
    else reg = `${nf(list.reduce((t, e) => t + Number(seats.byId.get(Number(e.id)).registrations || 0), 0))} registered`;
    tiles.push({ ...up, state: 'ready', value: nf(list.length), sub: `next 30 days · ${reg}` });
  }

  const weeks = reads.overview?.data?.weeks;
  const period = (key, label, path, pick) => {
    const b = blockOf(reads.overview, path);
    if (b.state !== 'ready') return { key, label, ...b };
    const { window, previous } = pick(b.block);
    return { key, label, state: 'ready', value: nf(window), sub: deltaText(window, previous, weeks) };
  };
  tiles.push(period('registrations', 'Event registrations', 'events.weekly', (b) => b.registrations));
  tiles.push(period('applications', 'Job applications', 'jobs', (b) => b.applications));
  tiles.push(showUpTile(reads.overview, weeks));

  // Published circles — "[9] of [11]".
  const pc = { key: 'circles', label: 'Published circles' };
  const pcp = pending(circles, 'The circles could not be read. That is not the same as no circles.');
  if (pcp) tiles.push({ ...pc, ...pcp });
  else {
    const list = circles.data;
    tiles.push({ ...pc, state: 'ready', value: `${nf(list.filter((c) => c.published).length)} of ${nf(list.length)}` });
  }

  // Advisors & partners — active on the roster.
  const ro = { key: 'roster', label: 'Advisors & partners' };
  const rop = pending(roster, 'The roster could not be read. That is not the same as an empty roster.');
  if (rop) tiles.push({ ...ro, ...rop });
  else tiles.push({ ...ro, state: 'ready', value: nf(roster.data.filter((p) => p.is_active).length), sub: 'active on the roster' });

  const ex = blockOf(reads.overview, 'wellbeing.experts');
  if (ex.state !== 'ready') tiles.push({ key: 'experts', label: 'Wellbeing experts', ...ex });
  else {
    const { verified, unverified, hidden, inactive } = ex.block;
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
  const ev = blockOf(overview, 'queue.events');
  const jb = blockOf(overview, 'queue.jobs');
  if (ev.state === 'loading' || jb.state === 'loading') return { text: null, overdue: false, note: null };
  const hours = [];
  const notes = [];
  let overdue = false;
  if (ev.state === 'ready') {
    if (ev.block.oldest_hours != null) hours.push(Number(ev.block.oldest_hours));
    overdue ||= Number(ev.block.overdue) > 0;
    if (Number(ev.block.waiting_from_created_at) > 0) notes.push(`${nf(ev.block.waiting_from_created_at)} events wait from when they were created; their submission was not stamped.`);
  } else notes.push('How long events have waited could not be read.');
  if (jb.state === 'ready') {
    if (jb.block.oldest_wait_hours != null) hours.push(Number(jb.block.oldest_wait_hours));
    overdue ||= Number(jb.block.overdue) > 0;
    if (Number(jb.block.wait_not_recorded) > 0) notes.push(`${nf(jb.block.wait_not_recorded)} jobs were submitted before waits were recorded, so they are not dated or marked overdue.`);
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
  const b = blockOf(overview, 'events.show_up');
  if (b.state !== 'ready') return { ...base, ...b };
  const { events, seats_taken: seats, attended, rate } = b.block;
  if (!Number(events)) return { ...base, state: 'ready', value: '—', sub: `No event ended in these ${weeks} weeks.` };
  if (rate == null || !Number(seats)) return { ...base, state: 'ready', value: '—', sub: `No seat was taken on the ${nf(events)} events that ended.` };
  return { ...base, state: 'ready', value: `${Math.round(Number(rate) * 100)}%`, sub: `${nf(attended)} of ${nf(seats)} seats · ${nf(events)} events ended` };
}

/** The Events card today: Next up, from the published events and their seats. */
export function buildNextUp(reads, now) {
  const p = pending(reads.events, 'The events list could not be read. That is not the same as no events.');
  if (p) return p;
  const all = reads.events.data;
  const seats = seatsRead(reads.analytics, all);
  const rows = upcomingEvents(all, now).filter((e) => e.status === 'published').slice(0, 3).map((e) => ({
    id: e.id,
    title: e.title,
    day: dayLabel(e.starts_at, e.timezone || 'UTC'),
    seats: seatsText(seats, e),
  }));
  return { state: 'ready', rows };
}

/** The Jobs card: postings by status (a 100% bar), and the five with most applications. */
export function buildJobs(reads) {
  const p = pending(reads.jobs, 'The job board could not be read. That is not the same as no jobs.');
  if (p) return p;
  const jobs = reads.jobs.data;
  const counts = new Map();
  for (const j of jobs) counts.set(j.status, (counts.get(j.status) || 0) + 1);
  const parts = JOB_PARTS.map(([key, label, tone]) => ({ label, tone, value: counts.get(key) || 0 }));
  const other = jobs.length - parts.reduce((t, x) => t + x.value, 0);
  if (other > 0) parts.push({ label: 'Other', tone: 'muted', value: other });
  const most = jobs
    .filter((j) => Number(j.application_count) > 0)
    .sort((a, b) => Number(b.application_count) - Number(a.application_count) || stamp(a.created_at) - stamp(b.created_at))
    .slice(0, 5)
    .map((j) => ({ id: j.id, title: j.title, company: j.project_name || null, applications: Number(j.application_count) }));
  return { state: 'ready', total: jobs.length, parts, most };
}

/** The Circles and roster card. Members are as entered; the roster is counted, never named. */
export function buildCircles(reads) {
  const out = {};
  const cp = pending(reads.circles, 'The circles could not be read. That is not the same as no circles.');
  if (cp) out.circles = cp;
  else {
    const list = reads.circles.data;
    const byType = new Map();
    for (const c of list) {
      const label = CIRCLE_TYPES[c.type] || 'Other';
      byType.set(label, (byType.get(label) || 0) + 1);
    }
    out.circles = {
      state: 'ready',
      total: list.length,
      byType: [...byType].map(([label, value]) => ({ label, value })).filter((r) => r.value > 0).sort((a, b) => b.value - a.value),
      published: list.filter((c) => c.published).length,
      draft: list.filter((c) => !c.published).length,
      featured: list.filter((c) => c.featured).length,
      membersEntered: list.reduce((t, c) => t + (Number(c.members) || 0), 0),
    };
  }
  const rp = pending(reads.roster, 'The roster could not be read. That is not the same as an empty roster.');
  if (rp) out.roster = rp;
  else {
    const rows = ROSTER_KINDS.map(([key, label]) => {
      const of = reads.roster.data.filter((p) => rosterKind(p.kind) === key);
      return { label, active: of.filter((p) => p.is_active).length, inactive: of.filter((p) => !p.is_active).length };
    });
    const known = new Set(ROSTER_KINDS.map(([k]) => k));
    const other = reads.roster.data.filter((p) => !known.has(rosterKind(p.kind)));
    if (other.length) rows.push({ label: 'Other', active: other.filter((p) => p.is_active).length, inactive: other.filter((p) => !p.is_active).length });
    out.roster = { state: 'ready', rows, active: rows.reduce((t, r) => t + r.active, 0) };
  }
  return out;
}

/**
 * Needs a decision: pending events and jobs, oldest first, at most six rows.
 * Each says how long it has waited, and is Overdue past 72 hours (D915):
 *   - an event waits from `submitted_at`, or from `created_at` when it was
 *     queued before submission was stamped, D918's rule, and it says so;
 *   - a job waits from `submitted_at` (migration 550). One submitted before
 *     that has no recorded wait, and is never Overdue or a wait of 0.
 * Nothing is decided here: Review opens the console that decides.
 */
export function buildNeeds(reads, now = Date.now()) {
  const ep = pending(reads.events, 'The events list could not be read.');
  const jp = pending(reads.jobs, 'The job board could not be read.');
  if (ep?.state === 'loading' || jp?.state === 'loading') return { state: 'loading' };
  if (ep && jp) return { state: 'unreadable', reason: 'Neither the events nor the job board could be read. That is not the same as nothing waiting.' };
  const items = [];
  const waited = (since, fromCreated) => {
    if (Number.isNaN(since)) return { wait: 'wait not recorded', overdue: false, since };
    const hours = Math.max(0, (now - since) / 3_600_000);
    return { wait: `waiting ${waitText(hours)}${fromCreated ? ' · since created' : ''}`, overdue: hours > OVERDUE_HOURS, since };
  };
  if (!ep) {
    for (const e of reads.events.data.filter((x) => x.status === 'pending_review')) {
      const sub = stamp(e.submitted_at);
      const fromCreated = Number.isNaN(sub);
      items.push({ kind: 'Event', id: `event-${e.id}`, title: e.title, sub: null, ...waited(fromCreated ? stamp(e.created_at) : sub, fromCreated) });
    }
  }
  if (!jp) {
    for (const j of reads.jobs.data.filter((x) => x.status === 'pending_review')) {
      items.push({ kind: 'Job', id: `job-${j.id}`, title: j.title, sub: j.project_name || null, ...waited(stamp(j.submitted_at), false) });
    }
  }
  // Oldest first; a wait not recorded is listed after every dated one.
  items.sort((a, b) => (Number.isNaN(a.since) ? 1 : Number.isNaN(b.since) ? -1 : a.since - b.since));
  return {
    state: 'ready',
    total: items.length,
    overdue: items.filter((i) => i.overdue).length,
    rows: items.slice(0, 6),
    partial: ep ? 'The events list could not be read, so only jobs are listed.' : jp ? 'The job board could not be read, so only events are listed.' : null,
  };
}

const ROLE_LABELS = [
  ['founder', 'Founder'], ['investor', 'Investor'], ['advisor', 'Advisor'], ['operating_partner', 'Operating partner'],
  ['explorer', 'Explorer'], ['guest', 'Guest'], ['other', 'Other'],
];
const ROLE_PLURAL = {
  founder: 'Founders', investor: 'Investors', advisor: 'Advisors', operating_partner: 'Operating partners', explorer: 'Explorers', guest: 'Guests', other: 'Other accounts',
};

/** A weekly series' counts on the read's own weeks; a week the block does not carry is null, which breaks the line. */
function onWeeks(weeks, rows, key) {
  const by = new Map((rows || []).map((r) => [String(r.week), Number(r[key])]));
  return weeks.map((w) => (by.has(w) && Number.isFinite(by.get(w)) ? by.get(w) : null));
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
  const weeks = Array.isArray(o.data?.week_starts) ? o.data.week_starts : [];
  const current = weeks.indexOf(o.data?.current_week);
  const specs = [
    { key: 'registrations', label: 'Event registrations', noun: 'event registrations', tone: 'violet', path: 'events.weekly', rows: (b) => b.weekly, field: 'registrations', totals: (b) => b.registrations },
    { key: 'applications', label: 'Job applications', noun: 'job applications', tone: 'sky', path: 'jobs', rows: (b) => b.weekly, field: 'count', totals: (b) => b.applications },
    { key: 'bookings', label: 'Expert bookings', noun: 'expert bookings', tone: 'amber', path: 'wellbeing.bookings', rows: (b) => b.weekly, field: 'count', totals: (b) => ({ window: b.window, previous: b.previous }) },
  ];
  const series = [];
  const missing = [];
  const totals = [];
  for (const sp of specs) {
    const b = blockOf(o, sp.path);
    if (b.state !== 'ready') { missing.push(sp.label); continue; }
    series.push({ label: sp.label, tone: sp.tone, dash: series.length === 1, values: onWeeks(weeks, sp.rows(b.block), sp.field) });
    const t = sp.totals(b.block) || {};
    totals.push({ noun: sp.noun, window: Number(t.window) || 0, previous: Number(t.previous) || 0 });
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
 *     (registered, confirmed and attended together), then attended. D918
 *     does not count Confirmed on its own, so that step says so;
 *   - waitlisted sits beside it, the seats waiting on upcoming events;
 *   - events by type, published or waiting, starting in the period, over the
 *     twelve stored types (`other` among them). Types with none are behind
 *     "Show all".
 */
export function buildEventsFunnel(reads) {
  const out = {};
  const su = blockOf(reads.overview, 'events.show_up');
  if (su.state !== 'ready') out.funnel = su;
  else {
    const seats = Number(su.block.seats_taken) || 0;
    const attended = Number(su.block.attended) || 0;
    out.funnel = {
      state: 'ready',
      events: Number(su.block.events) || 0,
      steps: [
        { key: 'registered', label: 'Registered', value: seats, share: seats > 0 ? 100 : 0 },
        { key: 'confirmed', label: 'Confirmed', value: null, note: 'Not counted on its own: D918 counts every seat taken together.' },
        { key: 'attended', label: 'Attended', value: attended, share: pct(attended, seats) },
      ],
    };
  }
  const wl = blockOf(reads.overview, 'events.waitlisted');
  out.waitlisted = wl.state === 'ready'
    ? { state: 'ready', value: Number(wl.block.registrations) || 0, events: Number(wl.block.events) || 0 }
    : wl;
  const bt = blockOf(reads.overview, 'events.by_type');
  if (bt.state !== 'ready') out.byType = bt;
  else {
    const counts = bt.block.counts || {};
    const rows = EVENT_TYPES.map((t) => ({ key: t.id, label: t.label, value: Number(counts[t.id]) || 0 }));
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
  const ev = blockOf(reads.overview, 'participation_by_role.events');
  const jb = blockOf(reads.overview, 'participation_by_role.jobs');
  if (ev.state === 'loading' || jb.state === 'loading') return { state: 'loading' };
  if (ev.state !== 'ready' && jb.state !== 'ready') {
    return { state: 'unreadable', reason: 'Who registered and who applied could not be read. That is not the same as no one.' };
  }
  const parts = [];
  if (ev.state === 'ready') parts.push({ key: 'events', label: 'Event registrations', tone: 'violet', by: ev.block.by_role || {} });
  if (jb.state === 'ready') parts.push({ key: 'jobs', label: 'Job applications', tone: 'sky', by: jb.block.by_role || {} });
  const rows = ROLE_LABELS.map(([key, label]) => {
    const ps = parts.map((p) => ({ key: p.key, label: p.label, tone: p.tone, value: Number(p.by[key]) || 0 }));
    return { key, label, parts: ps, total: nf(ps.reduce((t, p) => t + p.value, 0)), sum: ps.reduce((t, p) => t + p.value, 0) };
  });
  const all = rows.reduce((t, r) => t + r.sum, 0);
  const top = [...rows].sort((a, b) => b.sum - a.sum)[0];
  const what = parts.map((p) => p.label.toLowerCase()).join(' and ');
  const sentence = all === 0
    ? `No ${what} in these ${reads.overview.data.weeks} weeks.`
    : `${ROLE_PLURAL[top.key]} took the largest share: ${nf(top.sum)} of ${nf(all)} ${what} (${pct(top.sum, all)}%).`;
  const gone = ev.state === 'ready' ? Number(ev.block.not_recorded) || 0 : 0;
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
  const ex = blockOf(reads.overview, 'wellbeing.experts');
  out.experts = ex.state !== 'ready' ? ex : {
    state: 'ready',
    parts: [
      { label: 'Verified', tone: 'violet', value: Number(ex.block.verified) || 0 },
      { label: 'Unverified', tone: 'sky', value: Number(ex.block.unverified) || 0 },
      { label: 'Inactive', tone: 'amber', value: Number(ex.block.inactive) || 0 },
      { label: 'Hidden', tone: 'muted', value: Number(ex.block.hidden) || 0 },
    ],
  };
  if (out.experts.state === 'ready') out.experts.total = out.experts.parts.reduce((t, p) => t + p.value, 0);
  const bk = blockOf(reads.overview, 'wellbeing.bookings');
  if (bk.state !== 'ready') out.bookings = bk;
  else {
    const weeks = reads.overview.data.week_starts || [];
    const values = onWeeks(weeks, bk.block.weekly, 'count');
    const current = weeks.indexOf(reads.overview.data.current_week);
    out.bookings = {
      state: 'ready',
      window: Number(bk.block.window) || 0,
      rows: weeks.map((w, i) => ({ label: weekLabel(w), value: values[i] ?? 0, text: values[i] == null ? '–' : nf(values[i]), toDate: i === current })),
    };
  }
  const ci = blockOf(reads.overview, 'wellbeing.checkins');
  if (ci.state !== 'ready') out.checkins = ci;
  else if (ci.block.withheld || !ci.block.band) out.checkins = { state: 'ready', withheld: true, text: CHECKINS_WITHHELD };
  else {
    const { at_least: lo, under } = ci.block.band;
    out.checkins = { state: 'ready', withheld: false, text: `${nf(lo)} to ${nf(Number(under) - 1)} founders checked in` };
  }
  return out;
}

/** CM1 row 8: five console doors, one figure each. */
export function buildConsoles(reads) {
  const lane = (key) => {
    if (!reads.glance || reads.glance.status === 'loading') return { state: 'loading' };
    if (failed(reads.glance)) return { state: 'unreadable' };
    const l = laneOf(reads.glance.data, key);
    return l && l.count !== null ? { state: 'ready', text: `${nf(l.count)} pending` } : { state: 'unreadable' };
  };
  const from = (read, f) => {
    if (!read || read.status === 'loading') return { state: 'loading' };
    if (failed(read)) return { state: 'unreadable' };
    return { state: 'ready', text: f(read.data) };
  };
  return {
    events: lane('events'),
    jobs: lane('jobs'),
    circles: from(reads.circles, (list) => `${nf(list.filter((c) => !c.published).length)} drafts`),
    roster: from(reads.roster, (list) => `${nf(list.filter((p) => p.is_active).length)} active`),
    wellbeing: (() => {
      const ex = blockOf(reads.overview, 'wellbeing.experts');
      return ex.state === 'ready' ? { state: 'ready', text: `${nf(ex.block.unverified)} to verify` } : { state: ex.state === 'loading' ? 'loading' : 'unreadable' };
    })(),
  };
}

/** CM10 variant B: every read failed. The consoles strip still works. */
export function pageFailed(reads) {
  return ['glance', 'events', 'analytics', 'jobs', 'circles', 'roster', 'overview'].every((k) => failed(reads[k]));
}

/**
 * CM8: every read that feeds the page answered, and nothing has happened yet.
 * Zeros are real here. The events read covers only published and waiting
 * events, so the analytics rows (every status) must be empty too: a studio
 * with only drafts or cancelled events is not one where nothing happened.
 */
export function isEmptyCommunity(reads) {
  const noEvents = ready(reads.analytics) && Array.isArray(reads.analytics.data?.events) && reads.analytics.data.events.length === 0;
  return noEvents && ['events', 'jobs', 'circles'].every((k) => ready(reads[k]) && reads[k].data.length === 0);
}
