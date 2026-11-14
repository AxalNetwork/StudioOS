/**
 * D1034 (#2875, part 4 of #2387) — My events' four tabs complete, as pure
 * functions: Needs you, the month calendar and Month view, the Hosting counts,
 * filters, sorts, menu and pages, Discover's chips, filters and actions, and
 * Past's chart, filters and years. No React here, so `node --test` loads it
 * alone. D1030's rules stay in `myEventsModel.js`; this file builds on them.
 *
 * The reads (D1032, D1033):
 *   - `GET /api/events` → `hosting` (each with `counts`), `attending` (each
 *     place with `payment_status`, `amount_cents`, `currency`) and `past`
 *     (`places` with an `outcome`, and an exact `total`);
 *   - `GET /api/events/invitations` → the caller's pending invitations;
 *   - `GET /api/public/events` → Discover, with `type`, `format`, `price`,
 *     `from`, `to` and an exact `total`;
 *   - `GET /api/events/:id/eligibility` → may register, free for me, full;
 *   - `GET /api/calendar/my-events/feed` → whether Subscribe is set up.
 *
 * NEVER A ZERO FOR A MISSING VALUE. A count no read sent is `null` and the
 * page draws a dash or "Not read here yet"; a month the reads do not reach is
 * `null` on the chart, a dashed hairline, never a zero bar.
 */

import { eventTime } from './eventTime';
import { isPast, statusOf } from './myEventsModel';
import { EVENT_TYPES } from '../../lib/eventTypes';
import { money } from './eventDrawersModel';

const time = eventTime;
const n = (v) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
export const PAGE_SIZE = 25;

/* ------------------------------------------------------------------ *
 * Days, in the member's own zone
 * ------------------------------------------------------------------ */

/** "2026-11-12" for an instant, in `zone` (the member's own, by default). */
export function dayKey(t, zone) {
  if (t == null) return null;
  try {
    return new Date(t).toLocaleDateString('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', ...(zone ? { timeZone: zone } : {}) });
  } catch {
    return new Date(t).toISOString().slice(0, 10);
  }
}
const pad = (x) => String(x).padStart(2, '0');
const keyOf = (y, m, d) => `${y}-${pad(m + 1)}-${pad(d)}`;
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** The year and month (0–11) `now` falls in, in `zone`. */
export function monthOf(now, zone) {
  const [y, m] = dayKey(now, zone).split('-').map(Number);
  return { year: y, month: m - 1 };
}
export const monthTitle = ({ year, month }) => `${MONTHS[month]} ${year}`;
export function shiftMonth({ year, month }, by) {
  const t = year * 12 + month + by;
  return { year: Math.floor(t / 12), month: ((t % 12) + 12) % 12 };
}

/* ------------------------------------------------------------------ *
 * Needs you (MEV1)
 * ------------------------------------------------------------------ */

/**
 * Needs you, in the canvas's order: Pay to confirm, Sent back, each
 * invitation, Off the waitlist. At most four are drawn; `total` is how many
 * there are. A place promoted off the waitlist that still owes payment is one
 * row, "Off the waitlist" with Pay to confirm, never two.
 */
export function needsYouRows({ hosting = [], attending = [], invitations = [], now = Date.now() } = {}) {
  const live = (t) => !isPast(t, now) && t.status !== 'cancelled';
  const promoted = (attending || []).filter((t) => time(t.promoted_at) != null && live(t) && ['confirmed', 'registered'].includes(t.reg_status));
  const promotedIds = new Set(promoted.map((t) => t.registration_id || t.id));
  const pay = (attending || []).filter((t) => live(t) && t.payment_status === 'pending' && t.reg_status === 'confirmed' && !promotedIds.has(t.registration_id || t.id))
    .map((t) => {
      const amount = money(t.amount_cents, t.currency);
      return {
        key: `pay-${t.registration_id || t.id}`, kind: 'pay', pill: 'Pay to confirm', tone: 'warn',
        text: amount ? `Your seat at ${t.title || 'an event'} is held until you pay ${amount}.` : `Your seat at ${t.title || 'an event'} is held until you pay.`,
        action: { label: 'Pay now', to: `/events/${t.slug || t.id}` },
      };
    });
  const sent = (hosting || []).filter((e) => e.status === 'rejected').map((e) => ({
    key: `sent-${e.id}`, kind: 'sent', pill: 'Sent back', tone: 'bad',
    text: e.review_note ? `${e.title || 'An event'} was sent back by an admin: ‘${e.review_note}’` : `${e.title || 'An event'} was sent back by an admin.`,
    action: { label: 'Edit and resend', to: `/events/${e.id}/edit` },
  }));
  const invited = (invitations || []).filter((i) => i?.event && !isPast(i.event, now)).map((i) => ({
    key: `inv-${i.invitation_id}`, kind: 'invitation', pill: 'Invitation', tone: 'info', invitation: i,
    text: `${i.host_name || 'The host'} invited you to ${i.event.title || 'an event'}${i.comp ? ' · Free seat' : ''}.`,
  }));
  const off = promoted.map((t) => {
    const waiting = t.reg_status === 'registered', paying = t.payment_status === 'pending';
    return {
      key: `promoted-${t.registration_id || t.id}`, kind: 'promoted', pill: 'Off the waitlist', tone: 'good',
      text: `A seat opened at ${t.title || 'an event'}. ${waiting ? 'Waiting for the host.' : paying ? 'Pay to confirm your place.' : 'You’re going.'}`,
      action: { label: paying && !waiting ? 'Pay to confirm' : 'View ticket', to: `/events/${t.id}` },
    };
  });
  const all = [...pay, ...sent, ...invited, ...off];
  return { rows: all.slice(0, 4), total: all.length };
}

/** The dialog for answering an invitation: what it changes and who is told. */
export function invitationDialog(inv, action) {
  const ev = inv?.event || {};
  const title = ev.title || 'this event';
  const price = n(ev.price_cents) > 0 && !inv.comp ? money(ev.price_cents, ev.currency) : null;
  if (action === 'accept') {
    return {
      title: `Accept the invitation to ${title}?`,
      lines: [
        inv.comp ? 'You take a free seat.' : price ? `The seat costs ${price}. You pay on the event page to confirm it.` : 'You take a seat.',
        ev.approval_required ? 'The host approves your place before it is confirmed.' : 'Your place is confirmed when the seat is held.',
        `${inv.host_name || 'The host'} sees that you accepted.`,
        'If the event is full, the invitation stays open and nothing changes.',
      ],
      action: 'Accept', busy: 'Accepting…', done: `You accepted the invitation to ${title}.`,
    };
  }
  return {
    title: `Decline the invitation to ${title}?`,
    lines: ['The invitation is closed and you take no seat.', `${inv.host_name || 'The host'} sees that you declined.`],
    action: 'Decline', busy: 'Declining…', done: `You declined the invitation to ${title}.`,
  };
}

/* ------------------------------------------------------------------ *
 * The month calendar (MEV1) and Month view (MEV11)
 * ------------------------------------------------------------------ */

/** What sits on the calendar: your places, what you host and your invitations, each with its kind. */
export function calendarItems({ upcoming = [], hosting = [], invitations = [], now = Date.now() } = {}) {
  const out = [];
  for (const t of upcoming || []) {
    if (!['confirmed', 'registered', 'waitlisted', 'attended'].includes(t.reg_status)) continue;
    out.push({ key: `t-${t.id}`, kind: t.reg_status === 'waitlisted' ? 'waitlist' : 'going', event: t, id: t.id });
  }
  for (const e of hosting || []) {
    if (e.status === 'cancelled' || isPast(e, now)) continue;
    out.push({ key: `h-${e.id}`, kind: 'hosting', event: e, id: e.id });
  }
  for (const i of invitations || []) {
    if (!i?.event || isPast(i.event, now)) continue;
    out.push({ key: `i-${i.invitation_id}`, kind: 'invitation', event: i.event, id: i.event.id, invitation: i });
  }
  return out.sort((a, b) => (time(a.event.starts_at) ?? 0) - (time(b.event.starts_at) ?? 0));
}

/**
 * Six weeks of days, Monday first, around `{ year, month }`: each cell its day
 * key, its number, whether it is in the month or today, and the items on it.
 * The mini calendar dots Going and Hosting; Month view draws every kind.
 */
export function monthCells({ year, month }, items = [], now = Date.now(), zone) {
  const first = new Date(Date.UTC(year, month, 1));
  const lead = (first.getUTCDay() + 6) % 7;
  const today = dayKey(now, zone);
  const byDay = new Map();
  for (const it of items) {
    const k = dayKey(time(it.event.starts_at), zone);
    if (!k) continue;
    if (!byDay.has(k)) byDay.set(k, []);
    byDay.get(k).push(it);
  }
  const cells = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(Date.UTC(year, month, 1 - lead + i));
    const key = keyOf(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
    const on = byDay.get(key) || [];
    cells.push({
      key, day: d.getUTCDate(), inMonth: d.getUTCMonth() === month, today: key === today, items: on,
      going: on.filter((x) => x.kind === 'going').length, hosting: on.filter((x) => x.kind === 'hosting').length,
    });
  }
  return cells;
}

/** The mini calendar's words for one day, as its button reads to a screen reader. */
export function dayLabel(cell, title) {
  const parts = [cell.going ? `going to ${cell.going}` : '', cell.hosting ? `hosting ${cell.hosting}` : ''].filter(Boolean);
  const count = cell.going + cell.hosting;
  return `${cell.day} ${title}${cell.today ? ', today' : ''}: ${count ? `${count} event${count > 1 ? 's' : ''}: ${parts.join(', ')}` : 'no events'}`;
}

/** Month view's chips for one day: the first three, then "+N more", which opens the day. */
export function dayChips(cell, zone) {
  const label = (it) => {
    const t = time(it.event.starts_at);
    let hm = '';
    try { hm = t == null ? '' : new Date(t).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', ...(zone ? { timeZone: zone } : {}) }); } catch { hm = ''; }
    const tail = it.kind === 'waitlist' ? ' · Waitlist' : it.kind === 'invitation' ? ' · Invitation' : '';
    return `${hm ? `${hm} ` : ''}${it.event.title || 'Not recorded'}${tail}`;
  };
  const chips = cell.items.map((it) => ({ key: it.key, kind: it.kind, text: label(it), item: it }));
  return { chips: chips.slice(0, 3), more: chips.length > 3 ? chips.length - 3 : 0, all: chips };
}

/** The list under the mini calendar, narrowed to one day when a day is chosen. */
export const onDay = (rows, key, zone) => (key ? (rows || []).filter((t) => dayKey(time(t.starts_at), zone) === key) : rows || []);

export const CALENDAR_KINDS = [
  { key: 'going', label: 'Going' },
  { key: 'hosting', label: 'Hosting' },
  { key: 'waitlist', label: 'Waitlist' },
  { key: 'invitation', label: 'Invitation' },
];

/* ------------------------------------------------------------------ *
 * Subscribe (D1033)
 * ------------------------------------------------------------------ */

export const SUBSCRIBE = {
  title: 'Add your events to your calendar',
  note: 'Subscribe once and new tickets appear in Google or Outlook.',
  made: 'This address is shown once. Anyone who has it can read your events, with the join links for seats you hold.',
  replace: 'Making a new address stops the old one at once.',
};
/** The card's line from the subscription read: set up, not set up, or unreadable (never "not set up"). */
export function subscribeLine(read) {
  if (!read || read.status === 'loading') return null;
  if (read.status === 'error') return 'Whether you subscribed could not be read.';
  if (!read.data?.subscribed) return null;
  return read.data.last_used_at ? 'Subscribed. Your calendar last fetched it recently.' : 'Subscribed. No calendar has fetched it yet.';
}

/* ------------------------------------------------------------------ *
 * Hosting (MEV4)
 * ------------------------------------------------------------------ */

/**
 * One hosted event's counts, as the canvas words them, or `null` when the
 * read sent none: "[42] of [60] taken" with its bar, or "No cap · [14] taken";
 * then waitlist, to approve and invitations open, each only when there are
 * some. The read's 0 is a count, so "0 of 60 taken" is drawn.
 */
export function hostCounts(e) {
  const c = e?.counts;
  if (!c || typeof c !== 'object') return null;
  const taken = n(c.seats_taken);
  if (taken == null) return null;
  const cap = n(e.capacity);
  const extra = [
    n(c.waitlisted) ? `${n(c.waitlisted)} waitlist` : '',
    n(c.pending_approvals) ? `${n(c.pending_approvals)} to approve` : '',
    n(c.invitations_open) ? `${n(c.invitations_open)} invitation${n(c.invitations_open) === 1 ? '' : 's'} open` : '',
  ].filter(Boolean).join(' · ');
  return {
    taken, cap,
    pct: cap ? Math.min(100, Math.round((taken / cap) * 100)) : null,
    line: cap ? `${taken} of ${cap} taken` : `No cap · ${taken} taken`,
    extra: extra || null,
  };
}

export const HOST_STATUS = [
  { key: '', label: 'Any status' },
  { key: 'draft', label: 'Draft' },
  { key: 'pending_review', label: 'Waiting for review' },
  { key: 'published', label: 'Published' },
  { key: 'rejected', label: 'Sent back' },
  { key: 'cancelled', label: 'Cancelled' },
];
export const HOST_VISIBILITY = [
  { key: '', label: 'Any visibility' },
  { key: 'public', label: 'Public' },
  { key: 'unlisted', label: 'Unlisted' },
  { key: 'private', label: 'Private' },
];
export const HOST_WHEN = [
  { key: 'upcoming', label: 'Upcoming' },
  { key: 'past', label: 'Past' },
  { key: 'all', label: 'Any time' },
];
export const HOST_SORT = [
  { key: 'soonest', label: 'Starts soonest' },
  { key: 'latest', label: 'Starts latest' },
];
export const HOST_DEFAULTS = { q: '', status: '', visibility: '', when: 'upcoming', sort: 'soonest', page: 1 };

/** A draft or sent-back event still needs its host whatever its date, so "Upcoming" keeps it. */
const stillOpen = (e) => ['draft', 'rejected', 'pending_review'].includes(e.status);

/**
 * Hosting after its filters and sort, grouped as D1030 groups it, one page at
 * a time. The page cuts the sorted list, then the page's rows are grouped, so
 * "1–25 of [N]" counts events, not groups.
 */
export function hostingView(hosting, f = HOST_DEFAULTS, now = Date.now()) {
  const q = String(f.q || '').trim().toLowerCase();
  const list = (hosting || []).filter((e) => {
    if (q.length >= 2 && !String(e.title || '').toLowerCase().includes(q)) return false;
    if (f.status && e.status !== f.status) return false;
    if (f.visibility && e.visibility !== f.visibility) return false;
    if (f.when === 'upcoming' && isPast(e, now) && !stillOpen(e)) return false;
    if (f.when === 'past' && !isPast(e, now)) return false;
    return true;
  }).sort((a, b) => ((time(a.starts_at) ?? 0) - (time(b.starts_at) ?? 0)) * (f.sort === 'latest' ? -1 : 1));
  const page = pageOf(list, f.page);
  const needs = (e) => e.status === 'rejected' || (e.status === 'draft' && isPast({ starts_at: e.starts_at }, now));
  const groups = [
    { key: 'needs', label: 'Needs you', rows: page.rows.filter(needs) },
    { key: 'draft', label: 'Drafts', rows: page.rows.filter((e) => e.status === 'draft' && !needs(e)) },
    { key: 'review', label: 'Waiting for review', rows: page.rows.filter((e) => e.status === 'pending_review') },
    { key: 'published', label: 'Published', rows: page.rows.filter((e) => e.status === 'published') },
    { key: 'cancelled', label: 'Cancelled', rows: page.rows.filter((e) => e.status === 'cancelled') },
  ].filter((g) => g.rows.length);
  return { groups, page, filtered: f.q || f.status || f.visibility || f.when !== 'upcoming' };
}

/** A page of a list: its rows and "1–25 of [N]"; the page is held inside the list's range. */
export function pageOf(list, page = 1, size = PAGE_SIZE) {
  const total = (list || []).length;
  const pages = Math.max(1, Math.ceil(total / size));
  const p = Math.min(Math.max(1, Number(page) || 1), pages);
  const rows = (list || []).slice((p - 1) * size, p * size);
  return { rows, page: p, pages, total, label: total ? `${(p - 1) * size + 1}–${(p - 1) * size + rows.length} of ${total}` : '0 of 0' };
}

/** The ⋯ menu on a hosted event (MEV4): the host's pages, Copy link, the roster and Cancel event. */
export function hostMenu(e, now = Date.now()) {
  const items = [
    { key: 'details', label: 'Edit details', to: `/events/${e.id}/edit` },
    { key: 'who', label: 'Who may register', to: `/events/${e.id}/manage` },
    { key: 'registrations', label: 'Registrations', to: `/events/${e.id}/manage/registrations` },
    { key: 'agenda', label: 'Agenda', to: `/events/${e.id}/manage/agenda` },
  ];
  if (e.status === 'published') items.push({ key: 'copy', label: 'Copy link', copy: `/events/${e.slug || e.id}` });
  items.push({ key: 'roster', label: 'Download roster (CSV)', href: `/api/events/${e.id}/export` });
  if (e.status !== 'cancelled' && !isPast(e, now)) items.push({ key: 'cancel', label: 'Cancel event', drawer: true, danger: true });
  return items;
}

/** The ⋯ menu on one of your places (MEV1): the ticket, Add to calendar, the event page, Cancel my place. */
export function placeMenu(t) {
  return [
    { key: 'ticket', label: 'Show ticket', drawer: true },
    { key: 'calendar', label: 'Add to calendar', calendar: true },
    { key: 'page', label: 'Open event page', to: `/events/${t.slug || t.id}` },
    { key: 'cancel', label: t.reg_status === 'waitlisted' ? 'Leave the waitlist' : 'Cancel my place', drawer: true, danger: true },
  ];
}

/* ------------------------------------------------------------------ *
 * Discover (MEV8)
 * ------------------------------------------------------------------ */

/** The next three months as chips, each its own window for the public read. */
export function discoverMonths(now = Date.now(), zone, count = 3) {
  const start = monthOf(now, zone);
  return Array.from({ length: count }, (_, i) => {
    const m = shiftMonth(start, i);
    const from = i === 0 ? new Date(now).toISOString() : new Date(Date.UTC(m.year, m.month, 1)).toISOString();
    const to = new Date(Date.UTC(m.year, m.month + 1, 1) - 1).toISOString();
    return { key: `${m.year}-${pad(m.month + 1)}`, label: MONTH_SHORT[m.month], title: monthTitle(m), from, to };
  });
}

/** The type chips for what the month's read holds, each with its count; a type with none is left out. */
export function typeChips(events) {
  const counts = new Map();
  for (const ev of events || []) counts.set(ev.type || 'other', (counts.get(ev.type || 'other') || 0) + 1);
  return EVENT_TYPES.filter((t) => counts.has(t.id)).map((t) => ({ key: t.id, label: t.label, count: counts.get(t.id) }));
}
export const typeLabel = (id) => EVENT_TYPES.find((t) => t.id === id)?.label || 'Other';

export const FORMATS = [{ key: '', label: 'Any format' }, { key: 'virtual', label: 'Online' }, { key: 'in_person', label: 'In person' }, { key: 'hybrid', label: 'Hybrid' }];
export const PRICES = [{ key: '', label: 'Any price' }, { key: 'free', label: 'Free' }, { key: 'paid', label: 'Paid' }];

const COMP_SOURCE = {
  invitation: 'Invitation', official_partner: 'Official partner', invested_lp: 'Invested LP', investor: 'Investor',
  startup_founder: 'Startup founder', host_contact: 'Host contact', auto_partner: 'Official partner', auto_lp: 'Invested LP',
  auto_investor: 'Investor', auto_founder: 'Startup founder', auto_connection: 'Host contact',
};

/**
 * A Discover row's price line and its one action, from what the caller holds
 * and the eligibility read (MEV8). While eligibility is out, or when it fails,
 * the row opens the event page and says so; it never offers Register blind.
 */
export function discoverRow(ev, { held = new Set(), invitation = null, elig = null } = {}) {
  const base = n(ev.price_cents) > 0 ? money(ev.price_cents, ev.currency) : 'Free';
  if (held.has(ev.id)) return { price: base, action: { label: 'Show ticket', ticket: true } };
  if (invitation) return { price: `Invitation only · ${invitation.comp ? 'Free seat' : base}`, pill: 'Invitation only', action: { label: 'Accept', accept: invitation } };
  if (!elig || elig.status !== 'ready') {
    return { price: base, action: { label: 'Open event', to: `/events/${ev.slug || ev.id}` }, note: elig?.status === 'error' ? 'Whether you may register could not be read.' : null };
  }
  const e = elig.data || {};
  if (e.eligible === false) {
    return /invitation/i.test(String(e.reason || ''))
      ? { price: base, pill: 'Invitation only', muted: true, action: null, note: 'Invitation only' }
      : { price: 'Not open to your profile', muted: true, action: null };
  }
  const free = e.comp_eligible === true;
  const price = free ? `Free for you${COMP_SOURCE[e.comp_source] ? ` · ${COMP_SOURCE[e.comp_source]}` : ''}` : base;
  if (e.is_full) {
    return e.waitlist_enabled
      ? { price: `${price} · Full · waitlist open`, action: { label: 'Join the waitlist', register: true, waitlist: true }, free }
      : { price: `${price} · Full`, muted: true, action: null, free };
  }
  const left = n(e.capacity) != null && n(e.seats_taken) != null ? Math.max(0, n(e.capacity) - n(e.seats_taken)) : null;
  // A paid seat is taken where it is paid for: the event page carries the payment form.
  const action = n(ev.price_cents) > 0 && !free ? { label: 'Register', to: `/events/${ev.slug || ev.id}` } : { label: 'Register', register: true };
  return { price: left != null ? `${price} · ${left} left` : price, action, free };
}

/** The dialog for registering for a free seat or joining the waitlist: what it changes and who is told. */
export function registerDialog(ev, row, elig) {
  const title = ev.title || 'this event';
  const e = elig?.data || {};
  if (row.action?.waitlist) {
    return {
      title: `Join the waitlist for ${title}?`,
      lines: ['You join the waitlist. You take no seat yet.', 'If a seat opens, you are offered it and told.', 'The host sees you on the waitlist.'],
      action: 'Join the waitlist', busy: 'Joining…', done: `You joined the waitlist for ${title}.`,
    };
  }
  return {
    title: `Register for ${title}?`,
    lines: [
      row.free ? 'You take a free seat.' : 'You take a seat. It is free.',
      e.requires_approval ? 'The host approves your place before it is confirmed.' : 'Your place is confirmed when the seat is held.',
      'The host sees that you registered.',
    ],
    action: 'Register', busy: 'Registering…', done: `You registered for ${title}.`,
  };
}

/** "Free for me" keeps only the rows whose eligibility read says the seat is free for the caller. */
export const freeForMe = (rows, eligOf) => (rows || []).filter((ev) => eligOf(ev.id)?.status === 'ready' && eligOf(ev.id).data?.comp_eligible === true);

/* ------------------------------------------------------------------ *
 * Past (MEV9, MEV10)
 * ------------------------------------------------------------------ */

const OUTCOME = {
  attended: { label: 'Checked in', tone: 'good', filter: 'went' },
  ended: { label: 'Registered, not checked in', tone: 'muted', filter: 'missed' },
  cancelled: { label: 'You cancelled', tone: 'muted', filter: 'cancelled' },
  declined: { label: 'Declined by the host', tone: 'bad', filter: 'cancelled' },
  event_cancelled: { label: 'Event cancelled', tone: 'muted', filter: 'cancelled' },
};
export const PAST_FILTERS = [
  { key: 'went', label: 'Went' },
  { key: 'hosted', label: 'Hosted' },
  { key: 'missed', label: 'Missed' },
  { key: 'cancelled', label: 'Cancelled' },
];

/** A hosted event's result: "Hosted · [31] of [42] came", or "Event cancelled". */
function hostedResult(e) {
  if (e.status === 'cancelled') return { label: 'Event cancelled', tone: 'muted', filter: 'cancelled' };
  const came = n(e.counts?.checked_in), had = n(e.counts?.seats_taken);
  return { label: came != null && had != null ? `Hosted · ${came} of ${had} came` : 'Hosted', tone: 'info', filter: 'hosted' };
}

/** Past's rows: your places (with their outcome) and the events you hosted that ran or were cancelled. */
export function pastAll(places, hosting, now = Date.now()) {
  const went = (places || []).map((p) => ({ key: `p-${p.registration_id || p.id}`, event: p, kind: 'place', result: OUTCOME[p.outcome] || { label: 'Not recorded', tone: 'muted', filter: null } }));
  // D1030's rule: a hosted event joins Past once its date has passed; a cancelled one ahead stays under Hosting › Cancelled.
  const hosted = (hosting || []).filter((e) => isPast(e, now) && ['published', 'cancelled'].includes(e.status)).map((e) => ({ key: `h-${e.id}`, event: e, kind: 'hosted', result: hostedResult(e) }));
  return [...went, ...hosted].sort((a, b) => (time(b.event.starts_at) ?? 0) - (time(a.event.starts_at) ?? 0));
}

/** The years Past holds, newest first. */
export function pastYears(rows) {
  const ys = new Set();
  for (const r of rows || []) { const t = time(r.event.starts_at); if (t != null) ys.add(new Date(t).getUTCFullYear()); }
  return [...ys].sort((a, b) => b - a);
}

/** Past after its filters (any chosen, or all), its year and its search. */
export function pastView(rows, { filters = [], year = null, q = '' } = {}) {
  const s = String(q || '').trim().toLowerCase();
  return (rows || []).filter((r) => {
    if (filters.length && !filters.includes(r.result.filter)) return false;
    if (year != null) { const t = time(r.event.starts_at); if (t == null || new Date(t).getUTCFullYear() !== year) return false; }
    if (s.length >= 2 && !String(r.event.title || '').toLowerCase().includes(s)) return false;
    return true;
  });
}

/**
 * "Your events this year" (MEV9): Went and Hosted by month, for `year`.
 * The current month is drawn "so far", hatched; a month still to come is left
 * blank; a month older than the oldest place the read reached (when Past was
 * not read in full) is `null`, not recorded, never a zero.
 */
export function pastChart(rows, { year, now = Date.now(), complete = true, oldest = null } = {}) {
  const cur = new Date(now);
  const curY = cur.getUTCFullYear(), curM = cur.getUTCMonth();
  const oldestT = oldest != null ? time(oldest) : null;
  const months = MONTH_SHORT.map((label, m) => {
    const future = year > curY || (year === curY && m > curM);
    const unread = !complete && oldestT != null && Date.UTC(year, m + 1, 1) <= oldestT;
    return { label, m, future, unread, toDate: year === curY && m === curM, went: 0, hosted: 0 };
  });
  for (const r of rows || []) {
    const t = time(r.event.starts_at);
    if (t == null) continue;
    const d = new Date(t);
    if (d.getUTCFullYear() !== year) continue;
    const at = months[d.getUTCMonth()];
    if (r.kind === 'place' && r.result.filter === 'went') at.went += 1;
    if (r.kind === 'hosted' && r.result.filter === 'hosted') at.hosted += 1;
  }
  const chartRows = months.map((x) => ({
    label: x.label, toDate: x.toDate, blank: x.future,
    values: x.future ? [null, null] : x.unread ? [null, null] : [x.went, x.hosted],
  }));
  const went = months.reduce((t, x) => t + (x.future || x.unread ? 0 : x.went), 0);
  const hosted = months.reduce((t, x) => t + (x.future || x.unread ? 0 : x.hosted), 0);
  const thisYear = year === curY;
  const unreadAny = months.some((x) => x.unread);
  return {
    type: 'grouped',
    rows: chartRows,
    series: [{ label: 'Went', tone: 'violet' }, { label: 'Hosted', tone: 'sky' }],
    summary: `You went to ${went} event${went === 1 ? '' : 's'} and hosted ${hosted}${thisYear ? ' so far this year' : ` in ${year}`}.${unreadAny ? ' Months before the oldest place read here are not recorded.' : ''}`,
    foot: thisYear ? `${MONTH_SHORT[curM]} is not finished, so its bars are hatched.${curM < 11 ? ' The months still to come are left blank.' : ''}` : null,
    table: {
      head: ['Month', 'Went', 'Hosted'],
      rows: months.map((x) => [x.toDate ? `${x.label} (so far)` : x.label,
        x.future ? 'not yet' : x.unread ? 'not recorded' : String(x.went),
        x.future ? 'not yet' : x.unread ? 'not recorded' : String(x.hosted)]),
    },
  };
}

/* ------------------------------------------------------------------ *
 * The tab counts and the states (MEV14–MEV16)
 * ------------------------------------------------------------------ */

/**
 * The counts on the tabs. Each is a number from a read, or `{ value: null,
 * why }` when its read failed: MEV16a's Past dash when Past alone did not
 * come, MEV16b's dashes when the list did not come.
 */
export function tabCountsFull({ attending = [], hosting = [], past = null, ok, loading }, now = Date.now()) {
  if (loading) return { upcoming: { value: null, why: 'Reading…' }, hosting: { value: null, why: 'Reading…' }, past: { value: null, why: 'Reading…' } };
  if (!ok) {
    const why = 'Could not be read';
    return { upcoming: { value: null, why }, hosting: { value: null, why }, past: { value: null, why } };
  }
  const upcoming = (attending || []).filter((t) => !isPast(t, now)).length;
  const hostedPast = (hosting || []).filter((e) => isPast(e, now) && ['published', 'cancelled'].includes(e.status)).length;
  return {
    upcoming: { value: upcoming, why: null },
    hosting: { value: (hosting || []).length, why: null },
    past: past && n(past.total) != null ? { value: n(past.total) + hostedPast, why: null } : { value: null, why: 'Could not be read' },
  };
}

export const EMPTY = {
  upcoming: { title: 'Nothing coming up.', note: 'Find an event in Discover.', action: 'Discover events' },
  hosting: { title: 'You’re not hosting anything yet.', note: 'Host a workshop, office hours or a demo day for the people you work with.', action: 'New event' },
  past: { title: 'No past events yet.' },
};

/** A hosted row's status pill (D1030's words), re-exported for the tabs file. */
export { statusOf };
