/**
 * D921 (#2704) — part 6 of D915 §6: Review complete (EV3, EV4, EV4b, EV5,
 * EV15c, EV17b, EV17c). Pure: no React, no fetch.
 *
 * WHAT IS READ, AND FROM WHERE:
 *   the queue      D918's list with `status=pending_review`: each row carries
 *                  `submitted_at` (D917), `host: { name, role }`, `venture`
 *                  and `clash`;
 *   every event    D918's list, every status: the other side of a clash;
 *   the history    `GET /api/admin/events/:id/history` (D918 §6), for the
 *                  selected event only;
 *   the preview    `GET /api/admin/events/:id/comp-preview` (D918 §7), for the
 *                  selected event only: the counts approve's third line states.
 *
 * THE WAIT counts from `submitted_at`. An event queued before part 2 has none,
 * so its wait counts from `created_at`, which is D918's `waitingSince` and the
 * Approvals lane's rule, and the row says so. It is overdue after 72 hours
 * (D915 §2, `SLA_PAST_HOURS`).
 *
 * "SENT BACK" on a queue row: a send-back stores its reason in `review_note`
 * (D917) and nothing clears it, so a waiting event with a `review_note` was
 * sent back before. How many times is only in the history, which is read for
 * the selected event, so that row says "Sent back once" (or twice), and the
 * others "Sent back before".
 */

import { EVENT_TYPES } from '../../../lib/eventTypes.js';
import { NOT_RECORDED, titleCase } from '../../../lib/absence.js';
import {
  compFlags, dateLabel, factsOf, listJoin, parseStamp, queueFlags, roleWord, startShort, statusWord, titleOf, zoneOf,
} from './eventsDeskModel.js';
import { OVERDUE_HOURS, hostLine, matchesSearch } from './allEventsModel.js';
import { clashMap } from './calendarModel.js';

export { OVERDUE_HOURS, hostLine };

const HOUR_MS = 3_600_000;
const nf = (n) => Number(n).toLocaleString('en-US');
const plural = (n, one, many) => `${nf(n)} ${n === 1 ? one : many}`;
const capitalise = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

/* ------------------------------------------------------------------ *
 * Type and format (D916, part 1)
 * ------------------------------------------------------------------ */

/** The canonical type's label; a stored type the registry does not know is title-cased; none is null. */
export function typeWord(type) {
  const t = String(type ?? '').trim();
  if (!t) return null;
  return EVENT_TYPES.find((x) => x.id === t)?.label || titleCase(t);
}

const FORMAT = { virtual: 'Online', physical: 'In person', in_person: 'In person', hybrid: 'Hybrid' };

/** D918 §1's format words, from `location_kind`; the legacy `physical` is in person too. */
export const formatWord = (kind) => FORMAT[String(kind ?? '').trim()] || null;

/** "In person · a street address": the format and the place, whichever are recorded. */
export function formatPlace(ev) {
  const parts = [formatWord(ev?.location_kind), String(ev?.location_text || '').trim()].filter(Boolean);
  return parts.length ? parts.join(' · ') : NOT_RECORDED;
}

/* ------------------------------------------------------------------ *
 * The wait
 * ------------------------------------------------------------------ */

/** `{ since, from, ms }`: when the wait started, from which column, and how long it has run. */
export function waitingOf(ev, now) {
  const submitted = parseStamp(ev?.submitted_at);
  const since = submitted ?? parseStamp(ev?.created_at);
  if (since === null) return { since: null, from: null, ms: null };
  return { since, from: submitted !== null ? 'submitted' : 'created', ms: Math.max(0, now - since) };
}

/** "waiting 3 days", "waiting 5 hours", "waiting under an hour". */
export function waitingText(w) {
  if (!w || w.ms === null) return 'Waiting time not recorded';
  const hours = Math.floor(w.ms / HOUR_MS);
  if (hours < 1) return 'waiting under an hour';
  if (hours < 24) return `waiting ${plural(hours, 'hour', 'hours')}`;
  return `waiting ${plural(Math.floor(hours / 24), 'day', 'days')}`;
}

export const isOverdueWait = (w) => Boolean(w) && w.ms !== null && w.ms > OVERDUE_HOURS * HOUR_MS;

export const CREATED_FALLBACK = 'Counted from when it was created: it was submitted before submission times were stored.';

/* ------------------------------------------------------------------ *
 * The queue: search, filters, sorts
 * ------------------------------------------------------------------ */

export const REVIEW_SORTS = [
  { key: 'waiting', label: 'Waiting longest' },
  { key: 'starts', label: 'Starts soonest' },
  { key: 'created', label: 'Newest' },
];
export const DEFAULT_SORT = 'waiting';

export const PRICE_CHOICES = [
  { key: '', label: 'Free or Paid' },
  { key: 'free', label: 'Free' },
  { key: 'paid', label: 'Paid' },
];

export const STARTS_CHOICES = [
  { key: '', label: 'Any start' },
  { key: 'week', label: 'In the next 7 days' },
  { key: 'month', label: 'In the next 30 days' },
  { key: 'later', label: 'Later than 30 days' },
  { key: 'started', label: 'Already started' },
];

/** The host role filter's word for an event whose host has no role in the read. */
export const NO_ROLE = 'none';

export const EMPTY_FILTERS = { type: '', role: '', price: '', starts: '' };

export const filterCount = (f) => ['type', 'role', 'price', 'starts'].filter((k) => f?.[k]).length;

/** The Type filter's choices: the types in the queue, in the registry's order, then any it does not know. */
export function typeChoices(events) {
  const present = new Set((events || []).map((ev) => String(ev?.type ?? '').trim()).filter(Boolean));
  const known = EVENT_TYPES.filter((t) => present.has(t.id)).map((t) => ({ key: t.id, label: t.label }));
  const other = [...present].filter((t) => !EVENT_TYPES.some((x) => x.id === t)).sort().map((t) => ({ key: t, label: typeWord(t) }));
  return [{ key: '', label: 'Any type' }, ...known, ...other];
}

/** The Host role filter's choices: the roles in the queue, then "Role not recorded" when a host has none. */
export function roleChoices(events) {
  const roles = new Set();
  let none = false;
  for (const ev of events || []) {
    const r = String(ev?.host?.role ?? '').trim();
    if (r) roles.add(r);
    else none = true;
  }
  const out = [...roles].map((r) => ({ key: r, label: roleWord(r) })).sort((a, b) => a.label.localeCompare(b.label));
  return [{ key: '', label: 'Any host role' }, ...out, ...(none ? [{ key: NO_ROLE, label: 'Role not recorded' }] : [])];
}

function startsMatches(ev, starts, now) {
  if (!starts) return true;
  const at = parseStamp(ev?.starts_at);
  if (at === null) return false;
  if (starts === 'started') return at <= now;
  if (at <= now) return false;
  const days = (at - now) / 86_400_000;
  if (starts === 'week') return days <= 7;
  if (starts === 'month') return days <= 30;
  if (starts === 'later') return days > 30;
  return true;
}

function priceMatches(ev, price) {
  const paid = Number(ev?.price_cents) > 0;
  if (price === 'paid') return paid;
  if (price === 'free') return !paid;
  return true;
}

function roleMatches(ev, role) {
  if (!role) return true;
  const r = String(ev?.host?.role ?? '').trim();
  return role === NO_ROLE ? !r : r === role;
}

const typeMatches = (ev, type) => !type || String(ev?.type ?? '').trim() === type;

/** A missing value sorts last whichever way the list is ordered (D918 §4). */
function compare(a, b) {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return a - b;
}
const startOf = (ev) => parseStamp(ev?.starts_at);
const idOrder = (a, b) => Number(a?.id) - Number(b?.id);

/**
 * The queue, searched by title, host and venture (D918's `q` rule), filtered,
 * and sorted: Waiting longest (the default; the oldest wait first, then the
 * soonest start), Starts soonest, or Newest (created).
 */
export function reviewRows(events, { q = '', filters = EMPTY_FILTERS, sort = DEFAULT_SORT } = {}, now = Date.now()) {
  const f = { ...EMPTY_FILTERS, ...filters };
  const rows = (events || []).filter((ev) => matchesSearch(ev, q)
    && typeMatches(ev, f.type) && roleMatches(ev, f.role) && priceMatches(ev, f.price) && startsMatches(ev, f.starts, now));
  const order = {
    waiting: (a, b) => compare(waitingOf(a, now).since, waitingOf(b, now).since) || compare(startOf(a), startOf(b)) || idOrder(a, b),
    starts: (a, b) => compare(startOf(a), startOf(b)) || idOrder(a, b),
    created: (a, b) => compare(newestFirst(a), newestFirst(b)) || idOrder(b, a),
  };
  return [...rows].sort(order[sort] || order[DEFAULT_SORT]);
}

/** Newest first, with a missing creation time last. */
const newestFirst = (ev) => {
  const at = parseStamp(ev?.created_at);
  return at === null ? null : -at;
};

/** The selection after J/K or an arrow: one row on, clamped at the ends. */
export function stepSelection(rows, currentId, delta) {
  if (!rows?.length) return null;
  const at = rows.findIndex((r) => String(r.id) === String(currentId));
  const next = at < 0 ? 0 : Math.min(rows.length - 1, Math.max(0, at + delta));
  return rows[next].id;
}

/* ------------------------------------------------------------------ *
 * A queue row (EV3, left; EV17b)
 * ------------------------------------------------------------------ */

export function sentBackWord(n) {
  if (n === 1) return 'Sent back once';
  if (n === 2) return 'Sent back twice';
  return `Sent back ${nf(n)} times`;
}

/**
 * The row's flags: Paid, Free seats (D915), then Clash (D918's `clash`) and
 * the send-back flag. `sentBack` is the history's count for the selected
 * event; for the others the stored `review_note` says "before" (see the top).
 */
export function reviewFlags(ev, sentBack = null) {
  const flags = queueFlags(ev).map((label) => ({ label, tone: 'muted' }));
  if (ev?.clash === true) flags.push({ label: 'Clash', tone: 'amber' });
  if (Number.isFinite(sentBack) && sentBack > 0) flags.push({ label: sentBackWord(sentBack), tone: 'muted' });
  else if (sentBack === null && String(ev?.review_note ?? '').trim()) flags.push({ label: 'Sent back before', tone: 'muted' });
  return flags;
}

export function queueRowView(ev, now, sentBack = null) {
  const w = waitingOf(ev, now);
  return {
    id: ev.id,
    title: titleOf(ev),
    host: hostLine(ev),
    type: typeWord(ev?.type),
    when: startShort(ev),
    wait: waitingText(w),
    overdue: isOverdueWait(w),
    waitNote: w.from === 'created' ? CREATED_FALLBACK : null,
    flags: reviewFlags(ev, sentBack),
  };
}

/* ------------------------------------------------------------------ *
 * The preview on the public calendar (EV3, right)
 * ------------------------------------------------------------------ */

/** Only an http(s) or same-site address is drawn as the cover. */
export function coverOf(ev) {
  const url = String(ev?.cover_url || '').trim();
  return /^https?:\/\//i.test(url) || /^\/(?!\/)/.test(url) ? url : null;
}

/** The date block, in the event's own zone: `{ m: 'NOV', d: '14', w: 'THU' }`, or null with no start. */
export function dateBlock(ev) {
  const ms = parseStamp(ev?.starts_at);
  if (ms === null) return null;
  const f = new Intl.DateTimeFormat('en-GB', { timeZone: zoneOf(ev), weekday: 'short', day: 'numeric', month: 'short' });
  const p = Object.fromEntries(f.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return { m: String(p.month).toUpperCase(), d: String(p.day).padStart(2, '0'), w: String(p.weekday).toUpperCase() };
}

export const PREVIEW_EYE = 'Preview on the public calendar';
export const PREVIEW_FOOT = 'This is how it will look once approved.';

export function previewOf(ev) {
  const host = String(ev?.host?.name ?? '').trim();
  const lede = String(ev?.summary ?? '').trim();
  return {
    cover: coverOf(ev),
    date: dateBlock(ev),
    title: titleOf(ev),
    type: typeWord(ev?.type),
    place: formatPlace(ev),
    lede: lede || null,
    hostedBy: host ? `Hosted by ${host}.` : 'Host not recorded.',
  };
}

/* ------------------------------------------------------------------ *
 * The facts this part adds (EV3): Submitted and Venture
 * ------------------------------------------------------------------ */

export const SUBMITTED_UNRECORDED = {
  text: NOT_RECORDED,
  reason: 'It was submitted before submission times were stored, so its wait counts from when it was created.',
};

/** Submitted (D917's `submitted_at`), or "Not recorded" for an event queued before part 2. */
export function submittedFact(ev) {
  return parseStamp(ev?.submitted_at) === null
    ? { key: 'submitted', label: 'Submitted', unrecorded: SUBMITTED_UNRECORDED }
    : { key: 'submitted', label: 'Submitted', value: dateLabel(ev.submitted_at) };
}

/** Venture (D918's `venture`): its name, "No venture" when the event has no project, "Not recorded" when the name is gone. */
export function ventureFact(ev) {
  const name = String(ev?.venture?.name ?? '').trim();
  if (name) return { key: 'venture', label: 'Venture', value: name };
  if (ev?.project_id === null || ev?.project_id === undefined) return { key: 'venture', label: 'Venture', value: 'No venture' };
  return { key: 'venture', label: 'Venture', unrecorded: { text: NOT_RECORDED, reason: 'The event names a venture whose name is not in the read.' } };
}

export function typeFact(ev) {
  const word = typeWord(ev?.type);
  return word ? { key: 'type', label: 'Type', value: word } : { key: 'type', label: 'Type', unrecorded: { text: NOT_RECORDED } };
}

/**
 * EV3's facts: Type first, D915's facts with Place drawn as "Format and
 * place", then Venture, and Created followed by Submitted.
 */
export function reviewFacts(ev) {
  const out = [typeFact(ev)];
  for (const f of factsOf(ev)) {
    if (f.key === 'place') out.push({ key: 'place', label: 'Format and place', value: formatPlace(ev) });
    else if (f.key === 'created') out.push(ventureFact(ev), f, submittedFact(ev));
    else out.push(f);
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * Clashes (D915 §2's rule, `calendarModel.clashMap`)
 * ------------------------------------------------------------------ */

function apart(ms) {
  const m = Math.round(Math.abs(ms) / 60_000);
  if (m < 60) return plural(m, 'minute', 'minutes');
  const hrs = Math.round(m / 60);
  if (hrs < 48) return plural(hrs, 'hour', 'hours');
  return plural(Math.round(hrs / 24), 'day', 'days');
}

/** How another event's start sits against this one's: "starts 30 minutes earlier". */
export function relativeStart(other, ev) {
  const a = parseStamp(other?.starts_at);
  const b = parseStamp(ev?.starts_at);
  if (a === null || b === null) return 'overlaps it';
  if (a === b) return 'starts at the same time';
  return `starts ${apart(a - b)} ${a < b ? 'earlier' : 'later'}`;
}

export const CLASH_CLAIM = 'That is not a claim that nothing overlaps it.';
export const NO_CLASH = 'No other event overlaps it.';

/**
 * The Clashes card: the events the selected one overlaps, from the list of
 * every event. `all` is a read (`{ status, data }`); the selected event is
 * added when the list does not hold it yet.
 */
export function clashesFor(ev, all) {
  if (!ev) return { state: 'ready', items: [] };
  if (!all || all.status === 'loading') return { state: 'loading', items: [] };
  if (all.status !== 'ready' || !Array.isArray(all.data)) return { state: 'unreadable', items: [] };
  const list = all.data.some((x) => String(x?.id) === String(ev.id)) ? all.data : [...all.data, ev];
  const ids = clashMap(list).get(String(ev.id)) || new Set();
  const byId = new Map(list.map((x) => [String(x.id), x]));
  const items = [...ids].map((id) => byId.get(id)).filter(Boolean)
    .sort((a, b) => compare(startOf(a), startOf(b)))
    .map((o) => ({ id: o.id, title: titleOf(o), line: `${titleOf(o)} ${relativeStart(o, ev)}.`, sub: `${startShort(o)} · ${statusWord(o.status)}` }));
  return { state: 'ready', items };
}

/* ------------------------------------------------------------------ *
 * History (D918 §6)
 * ------------------------------------------------------------------ */

export const FIRST_TIME = 'First time in review.';
export const HISTORY_CLAIM = 'That is not a claim that it was never sent back.';

const FIELD = {
  title: 'title', summary: 'summary', description: 'description', starts_at: 'start', ends_at: 'end', timezone: 'time zone',
  location_kind: 'format', location_text: 'place', location_url: 'link', price_cents: 'price', currency: 'currency',
  capacity: 'capacity', visibility: 'visibility', cover_url: 'cover', type: 'type', audience_rules: 'who may register',
};
const fieldWord = (f) => FIELD[f] || String(f).replace(/_/g, ' ');

/** One history item in words. `submissions` is how many submissions came before it. */
function itemLine(it, submissions) {
  const on = dateLabel(it?.at);
  const by = it?.actor === 'host' ? 'the host' : 'an admin';
  switch (it?.action) {
    case 'event_submitted':
      return { glyph: '↑', text: `${submissions ? 'Submitted again' : 'Submitted'} on ${on}${it.actor === 'admin' ? ' by an admin' : ''}.` };
    case 'event_rejected': {
      const reason = String(it?.reason ?? '').trim();
      return { glyph: '↩', text: reason ? `Sent back on ${on} by an admin: ‘${reason}’` : `Sent back on ${on} by an admin.` };
    }
    case 'event_approved': return { glyph: '✓', text: `Approved on ${on} by an admin.` };
    case 'event_unpublished': return { glyph: '↓', text: `Taken off the calendar on ${on} by an admin.` };
    case 'event_featured': return { glyph: '★', text: it.featured ? `Featured on ${on} by an admin.` : `No longer featured from ${on}.` };
    case 'event_cancelled': return { glyph: '✕', text: `Cancelled on ${on} by an admin.` };
    case 'event_capacity_override':
      return { glyph: '■', text: it.capacity === null || it.capacity === undefined ? `Cap removed on ${on} by an admin.` : `Capacity set to ${nf(it.capacity)} on ${on} by an admin.` };
    case 'event_updated': {
      const fields = Array.isArray(it?.fields) ? it.fields.map(fieldWord) : [];
      return { glyph: '✎', text: fields.length ? `Edited by ${by} on ${on}: ${listJoin(fields)}.` : `Edited by ${by} on ${on}.` };
    }
    default: return { glyph: '•', text: `${capitalise(titleCase(String(it?.action || '').replace(/^event_/, '')) || 'A change')} on ${on}.` };
  }
}

/**
 * The History card from the read: `{ state, firstTime, sentBack, lines }`.
 * A failed read, or a history block that says it could not be read, is
 * unreadable: it is never drawn as "First time in review".
 */
export function historyOf(read) {
  if (!read || read.status === 'loading') return { state: 'loading', lines: [], sentBack: null };
  const block = read.status === 'ready' ? read.data?.history : null;
  if (!block || block.available !== true || !Array.isArray(block.items)) return { state: 'unreadable', lines: [], sentBack: null };
  let submissions = 0;
  const lines = block.items.map((it, i) => {
    const line = { key: `${i}:${it?.action}`, ...itemLine(it, submissions) };
    if (it?.action === 'event_submitted') submissions += 1;
    return line;
  });
  const sentBack = block.items.filter((it) => it?.action === 'event_rejected').length;
  return { state: 'ready', firstTime: sentBack === 0, sentBack, lines };
}

/* ------------------------------------------------------------------ *
 * "What approving does", line 3, with part 3's counts (EV3, EV4)
 * ------------------------------------------------------------------ */

const rulesOf = (ev) => (ev?.audience_rules && typeof ev.audience_rules === 'object' && !Array.isArray(ev.audience_rules) ? ev.audience_rules : {});

/** The free-seat preview from its read: `{ state, partners, lps }`, each `{ on, n }`. */
export function compPreviewOf(read) {
  if (!read || read.status === 'loading') return { state: 'loading' };
  const sources = read.status === 'ready' ? read.data?.sources : null;
  if (!sources || sources.available !== true) return { state: 'unreadable' };
  const tally = (s) => {
    if (!s || s.on !== true) return { on: false, n: 0 };
    const n = Number(s.would_invite);
    return Number.isFinite(n) && n >= 0 ? { on: true, n } : null;
  };
  const partners = tally(sources.official_partners);
  const lps = tally(sources.invested_lps);
  if (!partners || !lps) return { state: 'unreadable' };
  return { state: 'ready', partners, lps };
}

export const DELIVERY_LINE = 'Each invitation arrives in the member’s StudioOS inbox, and by email where Gmail is set up.';
export const COUNT_UNREAD = 'The number could not be read.';
export const COUNTING = 'Counting the invitations…';

/** The seat-at-sign-up flags' sentence: they give a seat and send nothing. */
function seatTail(rules) {
  const seat = compFlags(rules).filter((f) => !f.invites).map((f) => f.label);
  return seat.length ? ` ${capitalise(listJoin(seat))} get a free seat when they sign up; no invitation is sent to them.` : '';
}

/**
 * Line 3 and its delivery note: `{ text, delivery, state }`. The counts come
 * only from the preview; while it reads, or when it failed, the line names
 * the sources without a number and says which.
 */
export function approveLine3Counted(ev, preview) {
  const rules = rulesOf(ev);
  const invites = compFlags(rules).filter((f) => f.invites);
  const tail = seatTail(rules);
  if (!invites.length) return { text: `Sends no invitations.${tail}`, delivery: null, state: 'none' };
  if (!preview || preview.state !== 'ready') {
    const named = `Sends free-seat invitations to ${listJoin(invites.map((f) => f.label))} not invited yet.`;
    const note = preview?.state === 'unreadable' ? ` ${COUNT_UNREAD}` : '';
    return { text: `${named}${note}${tail}`, delivery: DELIVERY_LINE, state: preview?.state || 'loading' };
  }
  const parts = [];
  if (preview.partners.on) parts.push(plural(preview.partners.n, 'official partner', 'official partners'));
  if (preview.lps.on) parts.push(plural(preview.lps.n, 'invested LP', 'invested LPs'));
  const total = (preview.partners.on ? preview.partners.n : 0) + (preview.lps.on ? preview.lps.n : 0);
  if (!total) return { text: `Sends no invitations.${tail}`, delivery: null, state: 'ready' };
  return { text: `Emails ${plural(total, 'free-seat invitation', 'free-seat invitations')}: ${parts.join(', ')}.${tail}`, delivery: DELIVERY_LINE, state: 'ready' };
}

/** The three lines, with line 3 counted. `base` is D915's `approveLines(ev)`. */
export function countedApproveLines(base, ev, preview) {
  const line3 = approveLine3Counted(ev, preview);
  return { lines: [base[0], base[1], line3.text], delivery: line3.delivery };
}

