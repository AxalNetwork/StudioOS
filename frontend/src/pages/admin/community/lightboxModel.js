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
 *   - Jobs       `GET /api/admin/jobs`, every page, every status.
 *   - Circles    `GET /api/admin/circles`. Members and Activity are typed by
 *                an admin, so they carry the "As entered" tag.
 *   - Activity   `GET /api/admin/community/activity` (D932), paged by the
 *                Worker, 25 rows a page. It names no member.
 * Jobs and Circles are read whole and paged here, 25 rows a page.
 */

import { EVENT_TYPES } from '../../../lib/eventTypes.js';
import { SENIORITY_LABELS } from '../../../lib/siteNetwork2.js';
import { ACCESS_TYPES, ACTIVITY_LEVELS, CIRCLE_TYPES } from '../../../data/network.js';
import {
  NOT_RECORDED, STATUSES as EVENT_STATUSES, attendedText, capacityText, countText, eventHref, fillText, showUpText, startCell, statusWord, titleOf,
} from '../events/eventsDeskModel.js';
import { dayLabel, stamp } from './communityModel.js';

export { NOT_RECORDED };

/** The boxes, by the value `?open=` takes. */
export const BOXES = ['events', 'jobs', 'circles', 'activity'];
export const ROWS = 25;

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
const lower = (v) => String(v ?? '').toLowerCase();
const has = (needle, ...fields) => !needle || fields.some((f) => lower(f).includes(needle));

/** "1–25 of 41". An empty list says what it is empty of. */
export function rangeLine({ from, to, total }, none) {
  return total ? `${nf(from)}–${nf(to)} of ${nf(total)}` : none;
}

/** One page of `rows`, 1-based, clamped to the pages there are. */
export function pageOf(rows, page, size = ROWS) {
  const pages = Math.max(1, Math.ceil(rows.length / size));
  const at = Math.min(Math.max(1, Number(page) || 1), pages);
  const from = rows.length ? (at - 1) * size + 1 : 0;
  const to = Math.min(at * size, rows.length);
  return { rows: rows.slice(from ? from - 1 : 0, to), page: at, pages, from, to, total: rows.length };
}

/** Numbers first, largest first; an unknown (null) sorts after every known one. */
const byCount = (a, b) => (a === null ? (b === null ? 0 : 1) : b === null ? -1 : b - a);
const byText = (a, b) => lower(a).localeCompare(lower(b));

/**
 * A list read whole: searched, filtered, sorted, then paged. `spec` is one of
 * the three below; `state` is `{ q, filters: { [key]: value }, sort }`. An
 * empty filter value is "All".
 */
export function listView(spec, rows, state, ctx = {}) {
  const needle = lower(state.q).trim();
  let out = (rows || []).filter((r) => spec.search(r, needle));
  for (const f of spec.filters) {
    const v = state.filters?.[f.key];
    if (v) out = out.filter((r) => f.test(r, v, ctx));
  }
  const sort = spec.sorts.find((s) => s.key === state.sort) || spec.sorts[0];
  out = sort.order ? sort.order(out, ctx) : [...out].sort((a, b) => sort.compare(a, b, ctx));
  return pageOf(out, state.page);
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
  for (const k of ['status', 'when', 'visibility', 'price']) if (f[k]) out[k] = f[k];
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

/* ------------------------------------------------------------------ *
 * CM4 · Job postings
 * ------------------------------------------------------------------ */

/** The job board's status words, as the Jobs card draws them. */
const JOB_STATUSES = [
  ['published', 'Published'], ['pending_review', 'Pending review'], ['draft', 'Draft'], ['closed', 'Closed'], ['rejected', 'Rejected'],
];
const JOB_WORD = Object.fromEntries(JOB_STATUSES);
export const jobStatusWord = (s) => JOB_WORD[s] || 'Status not recorded';

export const JOBS_LINE = 'Every posting, as of now. A row opens the job board; nothing is approved here.';
/** Why the canvas's Posted and Days open are not drawn (D934 §3). */
export const JOBS_FOOT = 'When a posting was published is not recorded, so Created is when its host started it, and days open is not shown.';

const appsOf = (j) => (j.application_count === null || j.application_count === undefined || !Number.isFinite(Number(j.application_count)) ? null : Number(j.application_count));

export function jobRow(j) {
  const apps = appsOf(j);
  return {
    id: j.id,
    href: '/admin/jobs',
    title: String(j.title || '').trim() || 'Untitled posting',
    company: j.project_name || 'Company not recorded',
    status: jobStatusWord(j.status),
    statusKey: j.status,
    created: dayLabel(j.created_at),
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
  search: (j, needle) => has(needle, j.title, j.project_name),
  filters: [
    { key: 'status', label: 'Status', all: 'All statuses', options: JOB_STATUSES.map(([value, label]) => ({ value, label })), test: (j, v) => j.status === v },
    { key: 'place', label: 'Remote or on-site', all: 'Remote or on-site', options: [{ value: 'remote', label: 'Remote' }, { value: 'onsite', label: 'On-site' }], test: (j, v) => Boolean(j.remote) === (v === 'remote') },
    { key: 'seniority', label: 'Seniority', all: 'All levels', options: Object.entries(SENIORITY_LABELS).map(([value, label]) => ({ value, label })), test: (j, v) => j.seniority === v },
  ],
  sorts: [
    { key: 'applications', label: 'Applications', compare: (a, b) => byCount(appsOf(a), appsOf(b)) || byText(a.title, b.title) },
    { key: 'created', label: 'Newest', compare: (a, b) => (stamp(b.created_at) || 0) - (stamp(a.created_at) || 0) },
    { key: 'title', label: 'Role', compare: (a, b) => byText(a.title, b.title) },
  ],
};

/* ------------------------------------------------------------------ *
 * CM5 · Circles
 * ------------------------------------------------------------------ */

const CIRCLE_TYPE_WORD = { founder: 'Founder', investor: 'Investor', partner: 'Partner', advisor: 'Advisor', city: 'City', topic: 'Topic' };
const ACCESS_WORD = Object.fromEntries(ACCESS_TYPES.map((a) => [a.id, a.label]));
const yes = (v) => (v ? 'Yes' : 'No');

export const CIRCLES_LINE = 'Every circle, as of now. A row opens circles; nothing is published here.';
export const AS_ENTERED_FOOT = 'Members and activity are typed by an admin on each circle, not counted from sign-ups.';

export function circleRow(c) {
  return {
    id: c.id,
    href: '/admin/circles',
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
  search: (c, needle) => has(needle, c.name),
  filters: [
    { key: 'type', label: 'Type', all: 'All types', options: CIRCLE_TYPES.map((t) => ({ value: t.id, label: CIRCLE_TYPE_WORD[t.id] || t.short })), test: (c, v) => c.type === v },
    { key: 'access', label: 'Access', all: 'All access', options: ACCESS_TYPES.map((a) => ({ value: a.id, label: a.label })), test: (c, v) => c.access === v },
    { key: 'published', label: 'Published', all: 'Published or not', options: YES_NO, test: (c, v) => Boolean(c.published) === (v === 'yes') },
    { key: 'featured', label: 'Featured', all: 'Featured or not', options: YES_NO, test: (c, v) => Boolean(c.featured) === (v === 'yes') },
  ],
  sorts: [
    { key: 'name', label: 'Name', compare: (a, b) => byText(a.name, b.name) },
    { key: 'members', label: 'Members, as entered', compare: (a, b) => byCount(Number(a.members) || 0, Number(b.members) || 0) || byText(a.name, b.name) },
  ],
};

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
