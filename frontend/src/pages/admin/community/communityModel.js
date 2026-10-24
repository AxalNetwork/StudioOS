/**
 * D930 (#2367) — Admin › Community at /admin/community, built to the owner's
 * "Community overview" canvas (CM1–CM13). Pure: it turns the reads the page
 * makes into tiles and blocks, and never fetches.
 *
 * EVERY FIGURE IS IN ONE OF FOUR STATES:
 *   - `ready`: read, with its value;
 *   - `loading`: the read has not answered;
 *   - `unreadable`: the read failed, which is not a claim of zero;
 *   - `notyet`: a store holds it but no read sums it yet. It says which part
 *     brings it (D930 §6), and is never drawn as 0.
 * `unrecorded` is the fifth, for what no store records (CM1's two cards).
 *
 * THE READS (D930 §2). Each answers alone:
 *   - `glance`    GET /api/admin/studio/glance — the events and jobs lanes;
 *   - `events`    GET /api/admin/events, every page, published and waiting;
 *   - `analytics` GET /api/admin/events/analytics — its 200 rows only, under
 *                 D915's Guard G. Its `summary` is all time and is never read;
 *   - `jobs`      GET /api/admin/jobs, every page, every status;
 *   - `circles`   GET /api/admin/circles;
 *   - `roster`    GET /api/admin/network-profiles — counts only, no name.
 */

import { SCOPE_LABEL, SCOPE_TITLE } from '../insights/insightsModel';

export { SCOPE_LABEL, SCOPE_TITLE };

export const COMMUNITY_PATH = '/admin/community';
export const MOVED_KEY = 'held-community';
export const MOVED_NOTICE = 'Community has a new address. Update your bookmark.';
export const PAGE_LINE = 'What members did in events, jobs, circles and wellbeing, and what waits on you.';
export const PAGE_UNREADABLE = 'Community figures could not be read. Nothing here is a zero.';
export const EMPTY_LINE = 'Community starts with a first circle or event.';
export const NOT_YET = 'Not read here yet';
export const AS_ENTERED_TIP = 'An admin types this number on each circle. It is not counted from sign-ups.';
export const WAITED_UNRECORDED = 'How long each item has waited is not recorded yet, so none is marked overdue.';

/** The canvas's period control. It waits for the Community read (part 1). */
export const PERIODS = [
  { key: '4w', label: '4 weeks' },
  { key: '12w', label: '12 weeks' },
  { key: '52w', label: '52 weeks' },
];
export const PERIOD_WAITS = 'Periods arrive with the Community read. Every figure on this page is as of now.';

/**
 * What waits, and for which part (D930 §6). One sentence each: what the
 * figure is, and why it is not on the page yet.
 */
export const WAITS = {
  registrations: 'Registrations in a period need a read of when each seat was taken. It arrives with the Community read.',
  applications: 'Applications in a period need a read of when each was sent. It arrives with the Community read.',
  showUp: 'Show-up for the events that ended in a period arrives with the Community read.',
  experts: 'The expert directory read stops at 50 experts and counts the samples, so verified experts arrive with the Community read.',
  activity: 'Registrations, applications and expert bookings by week arrive with the Community read.',
  who: 'Registrations and applications by profile arrive with the Community read.',
  wellbeing: 'Experts by status, bookings by week and the check-in band arrive with the Community read. The band is counted without reading anyone’s answers.',
  recent: 'What happened, newest first, arrives with the Community activity read.',
  funnel: 'Registered, confirmed and attended in a period arrive with the Community read.',
  byType: 'Events by type arrive with the Community read, once the twelve types are stored as chosen (#2699).',
};

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
      tiles.push({ ...wait, state: 'ready', value: nf(ev.count + jb.count), sub: `${nf(ev.count)} events · ${nf(jb.count)} jobs`, note: WAITED_UNRECORDED });
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

  tiles.push({ key: 'registrations', label: 'Event registrations', state: 'notyet', reason: WAITS.registrations });
  tiles.push({ key: 'applications', label: 'Job applications', state: 'notyet', reason: WAITS.applications });
  tiles.push({ key: 'show-up', label: 'Show-up rate', state: 'notyet', reason: WAITS.showUp });

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

  tiles.push({ key: 'experts', label: 'Wellbeing experts', state: 'notyet', reason: WAITS.experts });
  return tiles;
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
 * Needs a decision: pending events and jobs, oldest first by when each was
 * created (when it was submitted is not recorded yet), at most six rows.
 * Nothing is decided here: Review opens the console that decides.
 */
export function buildNeeds(reads) {
  const ep = pending(reads.events, 'The events list could not be read.');
  const jp = pending(reads.jobs, 'The job board could not be read.');
  if (ep?.state === 'loading' || jp?.state === 'loading') return { state: 'loading' };
  if (ep && jp) return { state: 'unreadable', reason: 'Neither the events nor the job board could be read. That is not the same as nothing waiting.' };
  const items = [];
  if (!ep) {
    for (const e of reads.events.data.filter((x) => x.status === 'pending_review')) {
      items.push({ kind: 'Event', id: `event-${e.id}`, title: e.title, sub: null, created: stamp(e.created_at) });
    }
  }
  if (!jp) {
    for (const j of reads.jobs.data.filter((x) => x.status === 'pending_review')) {
      items.push({ kind: 'Job', id: `job-${j.id}`, title: j.title, sub: j.project_name || null, created: stamp(j.created_at) });
    }
  }
  items.sort((a, b) => (Number.isNaN(a.created) ? 1 : Number.isNaN(b.created) ? -1 : a.created - b.created));
  return {
    state: 'ready',
    total: items.length,
    rows: items.slice(0, 6),
    partial: ep ? 'The events list could not be read, so only jobs are listed.' : jp ? 'The job board could not be read, so only events are listed.' : null,
  };
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
    wellbeing: { state: 'notyet', reason: WAITS.experts },
  };
}

/** CM10 variant B: every read failed. The consoles strip still works. */
export function pageFailed(reads) {
  return ['glance', 'events', 'analytics', 'jobs', 'circles', 'roster'].every((k) => failed(reads[k]));
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
