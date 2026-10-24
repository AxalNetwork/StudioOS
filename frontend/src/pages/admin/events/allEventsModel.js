/**
 * D919 (#2702) — All events made complete (EV6, EV17d): the filters, the
 * views, the sorts, rows per page and the CSV. Pure: no React, no fetch.
 *
 * EVERYTHING IS WORKED OUT IN THE BROWSER from R1 (every page) and R2's rows
 * under Guard G, as D915 reads them; no read is added. A filter or a sort that
 * needs a count it cannot trust (Guard G says the counts could not be read, or
 * an event is not in R2's rows) never guesses: the event is not counted as
 * Full, and in a count sort it goes last.
 *
 * THE ADDRESS HOLDS THE FILTERS, the view, the sort and the page size, so a
 * filtered list can be shared and the browser's back button undoes a choice:
 *   status=draft,published  visibility=public  when=upcoming|past|week|month|range
 *   from=YYYY-MM-DD  to=YYYY-MM-DD  price=free|paid  featured=yes|no
 *   host=<the host's name>
 *   view=week|full|attention|paid_cancelled  sort=starts|created|taken|fill|showup  per=25|50|100
 * The old `?status=published` (one status, the Overview strip's door) still reads.
 *
 * PART 3 (D918, #2701) gives each list row its host line (`host: { name, role }`,
 * `venture: { name }`) and `waiting_hours`, so the search also matches hosts and
 * ventures, the Host filter picks one host by name, and Needs attention lists
 * Overdue (D918 §1: waiting more than 72 hours). The list rows carry no paid
 * ticket count, so "Cancelled with paid tickets" reads the overview's
 * `needs_attention` items of kind `paid_on_cancelled` (`paidOnCancelled`).
 *
 * WHAT IS NOT HERE, AND WHY: Type and Format wait for part 1 (#2699). "Studio
 * team" as a host waits for the owner's O-STU.
 */

import {
  DAY_MS, STATUSES, countsFor, defaultOrder, hasEnded, isPaid, parseStamp, roleWord, tableRow, titleOf,
} from './eventsDeskModel.js';
import { addDays, clashMap, isDayKey, mondayOf, monthOf, placeOf, todayKey } from './calendarModel.js';

export const VISIBILITIES = [
  { key: 'public', label: 'Public' },
  { key: 'unlisted', label: 'Unlisted' },
  { key: 'private', label: 'Private' },
];
export const WHENS = [
  { key: 'upcoming', label: 'Upcoming' },
  { key: 'past', label: 'Past' },
  { key: 'week', label: 'This week' },
  { key: 'month', label: 'This month' },
  { key: 'range', label: 'Dates…' },
];
export const PRICES = [
  { key: 'free', label: 'Free' },
  { key: 'paid', label: 'Paid' },
];
export const FEATURED = [
  { key: 'yes', label: 'Featured' },
  { key: 'no', label: 'Not featured' },
];
export const LIST_VIEWS = [
  { key: 'week', label: 'This week' },
  { key: 'full', label: 'Full' },
  { key: 'attention', label: 'Needs attention' },
  { key: 'paid_cancelled', label: 'Cancelled with paid tickets' },
];
export const SORTS = [
  { key: 'starts', label: 'Starts' },
  { key: 'created', label: 'Created' },
  { key: 'taken', label: 'Seats taken' },
  { key: 'fill', label: 'Fill' },
  { key: 'showup', label: 'Show-up' },
];
export const PAGE_SIZES = [25, 50, 100];

const one = (value, list) => (list.some((x) => x.key === value) ? value : null);

/** The filters, view, sort and page size the address names; anything it does not name is the default. */
export function readQuery(search) {
  const q = new URLSearchParams(search || '');
  const statuses = [...new Set(q.getAll('status').flatMap((s) => s.split(',')))].filter((s) => STATUSES.some((x) => x.key === s));
  const when = one(q.get('when'), WHENS);
  const per = Number(q.get('per'));
  return {
    statuses,
    visibility: one(q.get('visibility'), VISIBILITIES),
    when,
    from: when === 'range' && isDayKey(q.get('from')) ? q.get('from') : null,
    to: when === 'range' && isDayKey(q.get('to')) ? q.get('to') : null,
    price: one(q.get('price'), PRICES),
    featured: one(q.get('featured'), FEATURED),
    host: String(q.get('host') || '').trim().slice(0, 200) || null,
    view: one(q.get('view'), LIST_VIEWS),
    sort: one(q.get('sort'), SORTS) || 'starts',
    per: PAGE_SIZES.includes(per) ? per : PAGE_SIZES[0],
  };
}

/**
 * The address after a change: `patch` sets a key (an array for `status`), and
 * null clears it. The defaults (sort by Starts, 25 a page) are left out.
 */
export function writeQuery(search, patch) {
  const q = new URLSearchParams(search || '');
  for (const [key, value] of Object.entries(patch)) {
    q.delete(key);
    const v = Array.isArray(value) ? value.join(',') : value;
    if (v === null || v === undefined || v === '') continue;
    if ((key === 'sort' && v === 'starts') || (key === 'per' && Number(v) === PAGE_SIZES[0])) continue;
    q.set(key, String(v));
  }
  if (q.get('when') !== 'range') { q.delete('from'); q.delete('to'); }
  const s = q.toString();
  return s ? `?${s}` : '';
}

/** How many filters are set, for the phone's "Filters · [n]". The view and the sort are not filters. */
export const filterCount = (f) => (f.statuses.length ? 1 : 0) + ['visibility', 'when', 'price', 'featured', 'host'].filter((k) => f[k]).length;

/* ------------------------------------------------------------------ *
 * The host line (D918's list rows)
 * ------------------------------------------------------------------ */

const hostName = (ev) => String(ev?.host?.name || '').trim();

/**
 * The canvas's host line under an event's title: 'Dana Ruiz · Founder ·
 * Ledger tool'. An event with no host reads "Host not recorded"; a host with
 * no name stored reads "Host's name not recorded". "Studio team" waits for O-STU.
 */
export function hostLine(ev) {
  if (!ev?.host) return 'Host not recorded';
  const name = hostName(ev) || 'Host\u2019s name not recorded';
  const role = ev.host.role ? roleWord(ev.host.role) : null;
  const venture = String(ev?.venture?.name || '').trim() || null;
  return [name, role, venture].filter(Boolean).join(' · ');
}

/** The Host filter's choices: every host name in the list, once each, in alphabetical order. */
export function hostOptions(events) {
  const names = new Set((events || []).map(hostName).filter(Boolean));
  return [...names].sort((a, b) => a.localeCompare(b)).map((n) => ({ key: n, label: n }));
}

/* ------------------------------------------------------------------ *
 * When
 * ------------------------------------------------------------------ */

/**
 * Whether an event's start falls in a When filter. Upcoming and Past compare
 * the stored instant with now; This week (Monday to Sunday), This month and a
 * range compare the event's own day (where it happens) with the viewer's
 * dates, as the Calendar places it. An event with no start matches no When.
 */
export function whenMatches(ev, when, { from = null, to = null } = {}, now) {
  if (!when) return true;
  const start = parseStamp(ev?.starts_at);
  if (start === null) return false;
  if (when === 'upcoming') return start >= now;
  if (when === 'past') return start < now;
  const day = placeOf(ev).day;
  const today = todayKey(now);
  if (when === 'week') { const monday = mondayOf(today); return day >= monday && day <= addDays(monday, 6); }
  if (when === 'month') return monthOf(day) === monthOf(today);
  if (when === 'range') return (!from || day >= from) && (!to || day <= to);
  return true;
}

/** Free is a price stored as 0; Paid is one above 0. An event with no price stored is neither. */
export function priceMatches(ev, price) {
  if (!price) return true;
  const n = Number(ev?.price_cents);
  const stored = ev?.price_cents !== null && ev?.price_cents !== undefined && ev?.price_cents !== '' && Number.isFinite(n);
  if (!stored) return false;
  return price === 'paid' ? isPaid(ev) : n <= 0;
}

/* ------------------------------------------------------------------ *
 * Seats, fill and show-up as numbers, for the views and the sorts
 * ------------------------------------------------------------------ */

const capOf = (ev) => (ev?.capacity === null || ev?.capacity === undefined || ev?.capacity === '' ? null : Number(ev.capacity));

/** Seats taken, fill (0–1) and show-up (0–1) as numbers, each null when it is not known. */
export function figures(ev, join, now) {
  const c = countsFor(join, ev.id);
  const taken = c.state === 'ready' ? c.taken : null;
  const cap = capOf(ev);
  const fill = taken !== null && cap !== null && cap > 0 ? taken / cap : null;
  const ended = ev?.status !== 'cancelled' && hasEnded(ev, now) === true;
  const showUp = ended && c.state === 'ready' && c.taken > 0 && c.attended !== null ? c.attended / c.taken : null;
  return { taken, cap, fill, showUp, counted: c.state === 'ready' };
}

/** Full: a cap above 0 and every seat taken. Null when the seats taken cannot be read. */
export function isFull(ev, join, now) {
  if (ev?.status === 'cancelled') return false;
  const f = figures(ev, join, now);
  if (f.cap === null || f.cap <= 0) return false;
  return f.taken === null ? null : f.taken >= f.cap;
}

/** D915 §2: Low sign-ups is a capped event starting within 7 days with fewer than a quarter of its seats taken. */
export function isLowSignups(ev, join, now) {
  if (ev?.status !== 'published') return false;
  const start = parseStamp(ev?.starts_at);
  if (start === null || start < now || start >= now + 7 * DAY_MS) return false;
  const f = figures(ev, join, now);
  if (f.cap === null || f.cap <= 0) return false;
  return f.taken === null ? null : f.taken < f.cap / 4;
}

/** D918 §1: a review is overdue after 72 hours (`SLA_PAST_HOURS`), counted by the Worker into `waiting_hours`. */
export const OVERDUE_HOURS = 72;

export function isOverdue(ev) {
  const h = Number(ev?.waiting_hours);
  return ev?.status === 'pending_review' && ev?.waiting_hours !== null && ev?.waiting_hours !== undefined && Number.isFinite(h) && h > OVERDUE_HOURS;
}

/**
 * Needs attention (EV6's view): the reasons the page can work out. Overdue
 * (D918's `waiting_hours`) whatever the start; then, for events that have not
 * started yet, Full and Low sign-ups, which need the seat counts, and Clash,
 * D915 §2's rule. Paid tickets on a cancelled event is its own view.
 */
export function attentionReasons(ev, { join, clashes, now }) {
  if (ev?.status === 'cancelled') return [];
  const out = isOverdue(ev) ? [{ key: 'overdue', word: 'Overdue' }] : [];
  const start = parseStamp(ev?.starts_at);
  if (start === null || start < now) return out;
  if (ev.status === 'published' && isFull(ev, join, now) === true) out.push({ key: 'full', word: 'Full' });
  if (clashes.get(String(ev.id))?.size) out.push({ key: 'clash', word: 'Clash' });
  if (isLowSignups(ev, join, now) === true) out.push({ key: 'low', word: 'Low sign-ups' });
  return out;
}

export const ATTENTION_NOTE = 'Needs attention lists overdue reviews, full events, clashes and low sign-ups. Paid tickets on cancelled events have their own view.';
export const COUNTS_NEEDED = 'Full and Low sign-ups need seat counts, which could not be read, so only overdue reviews and clashes are listed.';

/* ------------------------------------------------------------------ *
 * Cancelled with paid tickets (the overview read's needs_attention)
 * ------------------------------------------------------------------ */

export const PAID_CLAIM = 'That is not a claim that no cancelled event has paid tickets.';
export const PAID_NOTE = 'Paid tickets are not refunded automatically. HQ refunds them in Revenue › Billing.';

/**
 * Each cancelled event's paid ticket count, from `GET /api/admin/events/overview`'s
 * `needs_attention.items` of kind `paid_on_cancelled`. A failed read, or a
 * `needs_attention` block that says it is unreadable, is `unreadable`, never
 * an empty list.
 */
export function paidOnCancelled(read) {
  if (!read || read.status === 'loading') return { state: 'loading' };
  const block = read.status === 'ready' ? read.data?.needs_attention : null;
  if (!block || block.available === false || block.unreadable || !Array.isArray(block.items)) return { state: 'unreadable', reason: PAID_CLAIM };
  const byId = new Map(block.items.filter((i) => i?.kind === 'paid_on_cancelled' && Number(i.paid_tickets) > 0)
    .map((i) => [String(i.event_id), Number(i.paid_tickets)]));
  return { state: 'ready', byId };
}

export const paidTicketsText = (n) => `${Number(n).toLocaleString('en-US')} paid ${n === 1 ? 'ticket' : 'tickets'}`;

/* ------------------------------------------------------------------ *
 * The rows
 * ------------------------------------------------------------------ */

/** The search: the title, the host's name or the venture's name, as D918's `q` matches them. */
export const matchesSearch = (ev, q) => {
  const needle = String(q || '').trim().toLowerCase();
  if (!needle) return true;
  return [titleOf(ev), hostName(ev), String(ev?.venture?.name || '')].some((s) => s.toLowerCase().includes(needle));
};

/** Whether an event passes the filters: Status (any of those picked), Visibility, When, Price, Featured and Host. The Calendar uses the same test. */
export function matchesFilters(ev, f, now) {
  return (!f.statuses?.length || f.statuses.includes(ev?.status))
    && (!f.visibility || ev?.visibility === f.visibility)
    && whenMatches(ev, f.when, f, now)
    && priceMatches(ev, f.price)
    && (!f.featured || Boolean(ev?.featured) === (f.featured === 'yes'))
    && (!f.host || hostName(ev) === f.host);
}

/** Unknown last, then the default order among equals. */
function byFigure(rows, pick, now) {
  const order = new Map(defaultOrder(rows, now).map((ev, i) => [ev, i]));
  return [...rows].sort((a, b) => {
    const x = pick(a);
    const y = pick(b);
    if (x === null && y === null) return order.get(a) - order.get(b);
    if (x === null) return 1;
    if (y === null) return -1;
    return y - x || order.get(a) - order.get(b);
  });
}

/**
 * The table's rows: searched by title, filtered, narrowed by the view, then
 * sorted. Starts is the canvas's default order (upcoming soonest, then past
 * latest); Created is newest first; Seats taken, Fill and Show-up are highest
 * first, with events whose figure is not known last.
 */
export function filteredRows(events, { q = '', query, join, now, paid = null }) {
  const f = query;
  const clashes = clashMap(events);
  let rows = (events || []).filter((ev) => matchesSearch(ev, q) && matchesFilters(ev, f, now));
  if (f.view === 'week') rows = rows.filter((ev) => whenMatches(ev, 'week', {}, now));
  if (f.view === 'full') rows = rows.filter((ev) => isFull(ev, join, now) === true);
  if (f.view === 'attention') rows = rows.filter((ev) => attentionReasons(ev, { join, clashes, now }).length);
  // Not read yet, or unreadable: no rows, and the page says why; never "none".
  if (f.view === 'paid_cancelled') rows = paid?.state === 'ready' ? rows.filter((ev) => ev?.status === 'cancelled' && paid.byId.has(String(ev.id))) : [];
  const fig = (ev) => figures(ev, join, now);
  if (f.sort === 'created') return [...rows].sort((a, b) => (parseStamp(b.created_at) ?? -Infinity) - (parseStamp(a.created_at) ?? -Infinity));
  if (f.sort === 'taken') return byFigure(rows, (ev) => fig(ev).taken, now);
  if (f.sort === 'fill') return byFigure(rows, (ev) => fig(ev).fill, now);
  if (f.sort === 'showup') return byFigure(rows, (ev) => fig(ev).showUp, now);
  return defaultOrder(rows, now);
}

/** Each row's Needs attention reasons, for the rows on screen. */
export function reasonsFor(rows, events, join, now) {
  const clashes = clashMap(events);
  return new Map(rows.map((ev) => [String(ev.id), attentionReasons(ev, { join, clashes, now })]));
}

/* ------------------------------------------------------------------ *
 * The CSV: the rows on screen, counts only, made in the browser
 * ------------------------------------------------------------------ */

export const CSV_COLUMNS = ['Event', 'Featured', 'Starts', 'Time zone', 'Status', 'Visibility', 'Capacity', 'Taken', 'Waitlisted', 'Attended', 'Fill', 'Show-up', 'Price'];
export const CSV_NOTE = 'Counts only: no attendee names or emails.';

/**
 * One cell, quoted when it holds a comma, a quote or a line break. A cell
 * that a spreadsheet would read as a formula (it starts with =, +, -, @ or a
 * tab) is prefixed with an apostrophe, because event titles are typed by hosts.
 */
export function csvCell(value) {
  let s = String(value ?? '');
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** The rows on screen as the table draws them: the same words, so an unknown reads as it does on the page. */
export function csvFor(rows, join, now, { statusWord }) {
  const lines = [CSV_COLUMNS.map(csvCell).join(',')];
  for (const ev of rows) {
    const r = tableRow(ev, join, now);
    lines.push([r.title, r.featured ? 'Yes' : 'No', r.starts.text, r.starts.zone, statusWord(r.status), r.visibility, r.capacity, r.taken, r.waitlisted, r.attended, r.fill, r.showUp, r.price].map(csvCell).join(','));
  }
  return `${lines.join('\r\n')}\r\n`;
}

/** 'events-2026-10-24.csv', by the viewer's date. */
export const csvName = (now) => `events-${todayKey(now)}.csv`;
