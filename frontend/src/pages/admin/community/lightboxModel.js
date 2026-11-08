/**
 * D934 (#2718) — Admin › Community's four lightboxes, CM3 to CM6: Events, Job
 * postings, Circles and Recent activity. Pure: it turns a read into the rows
 * a lightbox draws, searched, filtered, sorted and paged, and never fetches.
 *
 * NOTHING IS DECIDED IN A LIGHTBOX. Every row opens its item in the console
 * that decides: the Events desk, the job board or circles.
 *
 * THE READS. Each lightbox makes its own when it opens, so it answers alone:
 *   - Events     `GET /api/admin/events`, D918's paged list (#2701): the
 *                Worker filters, sorts and pages, 25 rows a page, and each
 *                row carries its own counts. D915's Guard G is retired here.
 *   - Jobs       `GET /api/admin/community/jobs` (#4717 package 4): the
 *                Worker searches, filters, sorts and pages, 25 rows a page,
 *                with the total that matched.
 *   - Circles    `GET /api/admin/community/circles` (#4717), the same way.
 *                Members and Activity are typed by an admin, so they carry
 *                the "As entered" tag.
 *   - Activity   `GET /api/admin/community/activity` (D932), paged by the
 *                Worker, 25 rows a page. It names no member.
 * Every lightbox now reads one page; none reads a whole dataset into the
 * browser. A search waits for the typing to stop (`SEARCH_WAIT_MS`), and an
 * answer to an older query is never drawn over a newer one.
 */

import { EVENT_TYPES } from '../../../lib/eventTypes.js';
import { SENIORITY_LABELS } from '../../../lib/siteNetwork2.js';
import { ACCESS_TYPES, ACTIVITY_LEVELS, CIRCLE_TYPES } from '../../../data/network.js';
import {
  NOT_RECORDED, STATUSES as EVENT_STATUSES, attendedText, capacityText, countText, eventHref, fillText, showUpText, startCell, statusWord, titleOf,
} from '../events/eventsDeskModel.js';
import { dayLabel, jobDaysOpen, stamp } from './communityModel.js';

export { NOT_RECORDED };

/** The boxes, by the value `?open=` takes. */
export const BOXES = ['events', 'jobs', 'circles', 'activity'];
export const ROWS = 25;
/** #4717: how long a lightbox's search waits after the last keystroke before it reads. */
export const SEARCH_WAIT_MS = 300;

/** `?open=` when it names a lightbox, else null. */
export function openFrom(search) {
  const v = new URLSearchParams(search || '').get('open');
  return BOXES.includes(v) ? v : null;
}

/** The search with `?open=` set to `box`, or removed when `box` is null. Every other key is kept. */
export function searchWith(search, box) {
  const next = new URLSearchParams(search || '');
  if (box) next.set('open', box); else next.delete('open');
  const q = next.toString();
  return q ? `?${q}` : '';
}

const nf = (n) => Number(n).toLocaleString('en-US');

/** "1–25 of 41". An empty list says what it is empty of. */
export function rangeLine({ from, to, total }, none) {
  return total ? `${nf(from)}–${nf(to)} of ${nf(total)}` : none;
}

/** The filter and sort state a lightbox opens with. */
export const initialState = (spec) => ({ q: '', filters: Object.fromEntries(spec.filters.map((f) => [f.key, ''])), sort: spec.sorts[0].key, page: 1 });

/** How many filters are set: the phone page's "Filters · [n]". */
export const filtersOn = (state) => Object.values(state.filters || {}).filter(Boolean).length;

/* ------------------------------------------------------------------ *
 * CM3 · Events (D918's paged list)
 * ------------------------------------------------------------------ */

const EVENT_TYPE_LABEL = Object.fromEntries(EVENT_TYPES.map((t) => [t.id, t.label]));
export const eventTypeWord = (t) => EVENT_TYPE_LABEL[t] || 'Type not recorded';

export const EVENTS_LINE = 'Every event, as of now. A row opens it in the Events console; nothing is changed here.';

/**
 * D918's list filters, sorts and pages in the Worker, and each row carries its
 * own counts (`seats_taken`, `attended`, `waitlisted`), so D915's Guard G is
 * retired here: no analytics read is joined. The words are still D915's,
 * through its own functions, so this lightbox and the Events desk agree.
 */
export const EVENTS = {
  key: 'events',
  title: 'Events',
  placeholder: 'Search title, host or venture',
  none: 'No events',
  filters: [
    { key: 'status', label: 'Status', all: 'All statuses', options: EVENT_STATUSES.map((s) => ({ value: s.key, label: s.word })) },
    // CM3's Type ▾: the twelve stored types, filtered by the Worker (D1121).
    { key: 'type', label: 'Type', all: 'All types', options: EVENT_TYPES.map((t) => ({ value: t.id, label: t.label })) },
    { key: 'when', label: 'Starts', all: 'Starts: All', options: [
      { value: 'upcoming', label: 'Upcoming' }, { value: 'this_week', label: 'This week' }, { value: 'next_30d', label: 'Next 30 days' }, { value: 'ended', label: 'Ended' },
    ] },
    { key: 'visibility', label: 'Visibility', all: 'All visibility', options: [{ value: 'public', label: 'Public' }, { value: 'unlisted', label: 'Unlisted' }, { value: 'private', label: 'Private' }] },
    { key: 'price', label: 'Price', all: 'Free or paid', options: [{ value: 'free', label: 'Free' }, { value: 'paid', label: 'Paid' }] },
    { key: 'featured', label: 'Featured', all: 'Featured or not', options: [{ value: 'yes', label: 'Featured' }, { value: 'no', label: 'Not featured' }] },
  ],
  sorts: [
    { key: 'starts', label: 'Start date', sort: 'starts', dir: 'asc' },
    { key: 'created', label: 'Newest', sort: 'created', dir: 'desc' },
    { key: 'seats_taken', label: 'Most registered', sort: 'seats_taken', dir: 'desc' },
    { key: 'fill', label: 'Fill', sort: 'fill', dir: 'desc' },
    { key: 'show_up', label: 'Show-up', sort: 'show_up', dir: 'desc' },
  ],
};

/** One page of D918's list: the query the client sends. Only what is set travels. */
export function eventsQuery(state) {
  const page = Math.max(1, Number(state.page) || 1);
  const f = state.filters || {};
  const sort = EVENTS.sorts.find((s) => s.key === state.sort) || EVENTS.sorts[0];
  const out = { limit: ROWS, offset: (page - 1) * ROWS, sort: sort.sort, dir: sort.dir };
  for (const k of ['status', 'type', 'when', 'visibility', 'price']) if (f[k]) out[k] = f[k];
  if (f.featured) out.featured = f.featured === 'yes';
  const q = String(state.q || '').trim();
  if (q) out.q = q;
  return out;
}

const count = (v) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));

/** One row, in D915's words, from D918's own counts. The host's name is not drawn: never a member's name. */
export function eventRow(ev, now) {
  const c = { state: 'ready', taken: count(ev.seats_taken), attended: count(ev.attended), waitlisted: count(ev.waitlisted) };
  const start = startCell(ev);
  return {
    id: ev.id,
    href: eventHref(ev.id),
    title: titleOf(ev),
    featured: Boolean(ev.featured),
    type: eventTypeWord(ev.type),
    starts: start.zone ? `${start.text} ${start.zone}` : start.text,
    status: statusWord(ev.status),
    statusKey: ev.status,
    capacity: capacityText(ev.capacity),
    registered: countText(c, 'taken'),
    attended: attendedText(ev, c, now),
    waitlisted: countText(c, 'waitlisted'),
    fill: fillText(ev.capacity, c),
    showUp: showUpText(ev, c, now),
  };
}

/** D918's answer as a page, or unreadable when it is not a list with a total. */
export function eventsPage(answer, page) {
  if (!answer || !Array.isArray(answer.events) || !Number.isFinite(Number(answer.total))) return null;
  const total = Number(answer.total);
  const at = Math.max(1, Number(page) || 1);
  const from = answer.events.length ? (at - 1) * ROWS + 1 : 0;
  return { rows: answer.events, page: at, pages: Math.max(1, Math.ceil(total / ROWS)), from, to: from ? from + answer.events.length - 1 : 0, total };
}

/**
 * #4717: a Community list's answer (`{ rows, total }`) as a page, or null when
 * it is not a list with a whole-number total, so it is drawn as unreadable,
 * never as an empty list.
 */
export function listPage(answer, page) {
  const total = answer?.total;
  if (!answer || !Array.isArray(answer.rows) || typeof total !== 'number' || !Number.isInteger(total) || total < 0) return null;
  const at = Math.max(1, Number(page) || 1);
  const from = answer.rows.length ? (at - 1) * ROWS + 1 : 0;
  return { rows: answer.rows, page: at, pages: Math.max(1, Math.ceil(total / ROWS)), from, to: from ? from + answer.rows.length - 1 : 0, total };
}

/** The page, filters, sort and search a Community list sends. Only what is set travels. */
function listQuery(spec, state, keys) {
  const page = Math.max(1, Number(state.page) || 1);
  const sort = spec.sorts.find((s) => s.key === state.sort) || spec.sorts[0];
  const out = { limit: ROWS, offset: (page - 1) * ROWS, sort: sort.key };
  for (const k of keys) if (state.filters?.[k]) out[k] = state.filters[k];
  const q = String(state.q || '').trim();
  if (q) out.q = q;
  return out;
}

/* ------------------------------------------------------------------ *
 * CM4 · Job postings
 * ------------------------------------------------------------------ */

/** The job board's status words, as the Jobs card draws them. */
const JOB_STATUSES = [
  ['published', 'Published'], ['pending_review', 'Pending review'], ['draft', 'Draft'], ['closed', 'Closed'], ['rejected', 'Rejected'],
];
const JOB_WORD = Object.fromEntries(JOB_STATUSES);
export const jobStatusWord = (s) => JOB_WORD[s] || 'Status not recorded';

export const JOBS_LINE = 'Every posting, as of now. A row opens that posting on the job board; nothing is approved here.';
/** D1121: what Posted and Days open mean, and why an older posting reads Not recorded. */
export const JOBS_FOOT = 'Posted is the day an admin last approved the posting, and only a published posting has days open. A posting approved before that day was recorded reads Not recorded.';

/** Posted: the day it was last approved; "Not published" when it never was; "Not recorded" when it was, before 609. */
function postedText(j) {
  if (j.published_at) return dayLabel(j.published_at);
  return j.status === 'published' || j.status === 'closed' ? NOT_RECORDED : 'Not published';
}

function daysOpenCell(j, now) {
  const d = jobDaysOpen(j, now);
  if (d === null) return 'Not open';
  return Number.isNaN(d) ? NOT_RECORDED : nf(d);
}

const appsOf = (j) => (j.application_count === null || j.application_count === undefined || !Number.isFinite(Number(j.application_count)) ? null : Number(j.application_count));

export function jobRow(j, now = Date.now()) {
  const apps = appsOf(j);
  return {
    id: j.id,
    // D1121: the row opens its own posting on the job board.
    href: `/admin/jobs?posting=${encodeURIComponent(j.id)}`,
    title: String(j.title || '').trim() || 'Untitled posting',
    company: j.project_name || 'Company not recorded',
    status: jobStatusWord(j.status),
    statusKey: j.status,
    created: dayLabel(j.created_at),
    posted: postedText(j),
    daysOpen: daysOpenCell(j, now),
    place: j.remote ? 'Remote' : 'On-site',
    seniority: SENIORITY_LABELS[j.seniority] || 'Level not recorded',
    applications: apps === null ? NOT_RECORDED : nf(apps),
  };
}

export const JOBS = {
  key: 'jobs',
  title: 'Job postings',
  placeholder: 'Search role or company',
  none: 'No postings',
  // #4717: searched, filtered and sorted by the Worker (`services/communityLists.ts`).
  filters: [
    { key: 'status', label: 'Status', all: 'All statuses', options: JOB_STATUSES.map(([value, label]) => ({ value, label })) },
    { key: 'place', label: 'Remote or on-site', all: 'Remote or on-site', options: [{ value: 'remote', label: 'Remote' }, { value: 'onsite', label: 'On-site' }] },
    { key: 'seniority', label: 'Seniority', all: 'All levels', options: Object.entries(SENIORITY_LABELS).map(([value, label]) => ({ value, label })) },
  ],
  sorts: [
    { key: 'applications', label: 'Applications' },
    { key: 'created', label: 'Newest' },
    // D1121: longest open first; a posting not open, or not recorded, sorts last.
    { key: 'days_open', label: 'Days open' },
    { key: 'title', label: 'Role' },
  ],
};

/** One page of the Jobs list: the query the client sends (#4717). */
export const jobsQuery = (state) => listQuery(JOBS, state, ['status', 'place', 'seniority']);

/* ------------------------------------------------------------------ *
 * CM5 · Circles
 * ------------------------------------------------------------------ */

const CIRCLE_TYPE_WORD = { founder: 'Founder', investor: 'Investor', partner: 'Partner', advisor: 'Advisor', city: 'City', topic: 'Topic' };
const ACCESS_WORD = Object.fromEntries(ACCESS_TYPES.map((a) => [a.id, a.label]));
const yes = (v) => (v ? 'Yes' : 'No');

export const CIRCLES_LINE = 'Every circle, as of now. A row opens that circle; nothing is published here.';
export const AS_ENTERED_FOOT = 'Members and activity are typed by an admin on each circle, not counted from sign-ups.';

export function circleRow(c) {
  return {
    id: c.id,
    // D1121: the row opens its own circle's editor.
    href: `/admin/circles?circle=${encodeURIComponent(c.id)}`,
    title: String(c.name || '').trim() || 'Untitled circle',
    type: CIRCLE_TYPE_WORD[c.type] || 'Type not recorded',
    access: ACCESS_WORD[c.access] || 'Access not recorded',
    published: yes(c.published),
    featured: yes(c.featured),
    members: Number.isFinite(Number(c.members)) ? nf(Number(c.members)) : NOT_RECORDED,
    activity: ACTIVITY_LEVELS[c.activity]?.label || NOT_RECORDED,
  };
}

const YES_NO = [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }];

export const CIRCLES = {
  key: 'circles',
  title: 'Circles',
  placeholder: 'Search by name',
  none: 'No circles',
  // #4717: searched, filtered and sorted by the Worker (`services/communityLists.ts`).
  filters: [
    { key: 'type', label: 'Type', all: 'All types', options: CIRCLE_TYPES.map((t) => ({ value: t.id, label: CIRCLE_TYPE_WORD[t.id] || t.short })) },
    { key: 'access', label: 'Access', all: 'All access', options: ACCESS_TYPES.map((a) => ({ value: a.id, label: a.label })) },
    { key: 'published', label: 'Published', all: 'Published or not', options: YES_NO },
    { key: 'featured', label: 'Featured', all: 'Featured or not', options: YES_NO },
  ],
  sorts: [
    { key: 'name', label: 'Name' },
    { key: 'members', label: 'Members, as entered' },
  ],
};

/** One page of the Circles list: the query the client sends (#4717). */
export const circlesQuery = (state) => listQuery(CIRCLES, state, ['type', 'access', 'published', 'featured']);

/* ------------------------------------------------------------------ *
 * CM6 · Recent activity (D932's read, paged by the Worker)
 * ------------------------------------------------------------------ */

export const ACTIVITY_LINE = 'Everything that happened, newest first. No member is named; an admin’s act says An admin.';

export const ACTIVITY_KINDS = [
  { value: 'events', label: 'Events' },
  { value: 'jobs', label: 'Jobs' },
  { value: 'circles', label: 'Circles' },
  { value: 'wellbeing', label: 'Wellbeing' },
  { value: 'admin', label: 'Admin actions' },
];

/** D932 caps `offset + limit` at 1000. */
export const ACTIVITY_CAP = 1000;

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** The query for one page of the activity read. Only what is set travels; a half-typed date does not. */
export function activityQuery(state) {
  const page = Math.max(1, Number(state.page) || 1);
  const out = { limit: ROWS, offset: (page - 1) * ROWS };
  if (state.kind) out.kind = state.kind;
  if (DAY_RE.test(state.from || '')) out.from = state.from;
  if (DAY_RE.test(state.to || '')) out.to = state.to;
  const q = String(state.q || '').trim();
  if (q) out.q = q;
  return out;
}

const SOURCE_WORD = { events: 'events', jobs: 'job postings', job_postings: 'job postings', circles: 'circles', wellbeing: 'wellbeing', event_registrations: 'registrations', admin_audit_log: 'admin actions' };

/** "13:05 · 24 Oct", in UTC: the Worker dates rows in UTC. */
export function whenLabel(at) {
  const t = stamp(at);
  if (Number.isNaN(t)) return NOT_RECORDED;
  const d = new Date(t);
  const time = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' });
  return `${dayLabel(at)} · ${time} UTC`;
}

/**
 * The activity read's answer as a page. A source that failed is named, and
 * its rows and count are absent, never zero. The Worker's paging stops at
 * 1000 rows, so a longer list says where it stops.
 */
export function activityPage(answer, page) {
  if (!answer || !Array.isArray(answer.rows) || !Number.isFinite(Number(answer.total))) return { state: 'unreadable' };
  const total = Number(answer.total);
  const at = Math.max(1, Number(page) || 1);
  const reachable = Math.min(total, ACTIVITY_CAP);
  const pages = Math.max(1, Math.ceil(reachable / ROWS));
  const from = answer.rows.length ? (at - 1) * ROWS + 1 : 0;
  const to = from ? from + answer.rows.length - 1 : 0;
  const failed = (answer.unreadable || []).map((u) => SOURCE_WORD[u?.source] || 'one source');
  return {
    state: 'ready',
    page: at,
    pages,
    from,
    to,
    total,
    rows: answer.rows.map((r, i) => ({
      key: `${at}-${i}`,
      icon: r.icon || '•',
      sentence: String(r.sentence || ''),
      href: typeof r.href === 'string' && r.href.startsWith('/admin') ? r.href : null,
      when: whenLabel(r.at),
      lastChange: r.dated_by === 'last_change',
    })),
    partial: failed.length ? `Could not be read: ${[...new Set(failed)].join(', ')}. Those rows are not here and not in the count, which is not a claim that nothing happened.` : null,
    capped: total > ACTIVITY_CAP ? `Pages stop at ${nf(ACTIVITY_CAP)} rows. Narrow the kind or the dates to reach older ones.` : null,
  };
}
