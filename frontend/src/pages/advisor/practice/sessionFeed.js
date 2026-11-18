// #4832 (D4832): Practice > Sessions' operational feed, as pure functions: which
// tab a booking sits under (Upcoming / Past / Cancelled), how its price is
// classified (Free / Included / Unpriced / Priced), its separate money state,
// its time line, and what "Share booking link" can share.
import { moneyCents } from '../../../workspaces/boards/format.js';

/** The three tabs, in the canvas's order (PX-05). */
export const SESSION_TABS = Object.freeze(['upcoming', 'past', 'cancelled']);

// A session closed as held or no-show has happened, whatever its slot says.
const HAPPENED = ['completed', 'no_show'];

/**
 * The tab a booking (a `bookingView` row) belongs under.
 *
 * PAST IS TIME THAT HAS PASSED, not a wider window: a session is Past once its
 * end (or, with no end recorded, its start) is at or before `now`, or once it
 * was closed as held or no-show. A cancelled booking (including a request the
 * advisor declined) is Cancelled whenever it was. A booking with no time at all
 * stays Upcoming until it is closed, so it cannot fall out of sight.
 */
export function sessionTab(b, now) {
  if (!b) return null;
  if (b.status === 'cancelled') return 'cancelled';
  if (HAPPENED.includes(b.status)) return 'past';
  const at = Date.parse(b.endsAt || b.startsAt || '');
  if (Number.isFinite(at) && at <= now) return 'past';
  return 'upcoming';
}

const startOf = (b) => {
  const t = Date.parse(b?.startsAt || '');
  return Number.isFinite(t) ? t : null;
};

/**
 * The bookings under one tab, ordered the way a calendar reads: Upcoming
 * soonest first, Past and Cancelled most recent first. A row with no time
 * sorts last in every tab.
 */
export function sessionsFor(items, tab, now) {
  const list = (Array.isArray(items) ? items : []).filter((b) => sessionTab(b, now) === tab);
  const dir = tab === 'upcoming' ? 1 : -1;
  return list.slice().sort((a, b) => {
    const x = startOf(a);
    const y = startOf(b);
    if (x == null && y == null) return 0;
    if (x == null) return 1;
    if (y == null) return -1;
    return (x - y) * dir;
  });
}

/** How many bookings sit under each tab. */
export function sessionCounts(items, now) {
  const out = { upcoming: 0, past: 0, cancelled: 0 };
  for (const b of Array.isArray(items) ? items : []) {
    const tab = sessionTab(b, now);
    if (tab) out[tab] += 1;
  }
  return out;
}

/**
 * The booking's price, from what is RECORDED on the booking and nothing else:
 * Included (recorded as part of an engagement, D5316), Unpriced (no amount),
 * Free (a recorded $0) or Priced. A missing price is never Free.
 */
export function priceClass(b) {
  if (b?.billing_state === 'included') {
    return { key: 'included', label: 'Included', detail: 'Included in an engagement · not billed' };
  }
  const raw = b?.amount_cents;
  const cents = raw == null || raw === '' ? null : Number(raw);
  if (cents == null || !Number.isFinite(cents)) {
    return { key: 'unpriced', label: 'Unpriced', detail: 'No price recorded' };
  }
  if (cents === 0) return { key: 'free', label: 'Free', detail: '$0 recorded' };
  return { key: 'priced', label: 'Priced', detail: `${moneyCents(cents)} recorded price` };
}

/** Collected is a money state, apart from the price: what happened to the money. */
export const MONEY_STATE = Object.freeze({
  billed: { label: 'Billed', tone: 'warn' },
  collected: { label: 'Collected', tone: 'ok' },
  written_off: { label: 'Written off', tone: 'danger' },
});
export const moneyState = (b) => MONEY_STATE[b?.billing_state] || null;

/** "Strategy Session · 60 min", from the terms the booking was made on (D4715). */
export function offerText(b) {
  const offer = b?.offer;
  if (!offer || typeof offer.name !== 'string' || !offer.name.trim()) return null;
  return [offer.name.trim(), offer.duration_minutes != null ? `${offer.duration_minutes} min` : null]
    .filter(Boolean).join(' · ');
}

const sameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
const clock = (d) => d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false });

/**
 * "Today · 14:00–15:00", "Tomorrow · …", "Mon 9 Nov · …", in the reader's
 * local time. Null when no start is recorded, so the card can say so.
 */
export function whenLine(b, now) {
  const start = startOf(b);
  if (start == null) return null;
  const s = new Date(start);
  const endMs = Date.parse(b?.endsAt || '');
  const range = Number.isFinite(endMs) ? `${clock(s)}–${clock(new Date(endMs))}` : clock(s);
  const today = new Date(now);
  const tomorrow = new Date(now + 86_400_000);
  const yesterday = new Date(now - 86_400_000);
  let day;
  if (sameDay(s, today)) day = 'Today';
  else if (sameDay(s, tomorrow)) day = 'Tomorrow';
  else if (sameDay(s, yesterday)) day = 'Yesterday';
  else {
    day = s.toLocaleDateString(undefined, {
      weekday: 'short', day: 'numeric', month: 'short',
      ...(s.getFullYear() === today.getFullYear() ? {} : { year: 'numeric' }),
    });
  }
  return `${day} · ${range}`;
}

/**
 * What "Share booking link" can do with the links read: copy the one active
 * link, send the reader to the Booking links card to choose among several, say
 * there is none yet, or say the links could not be read. Never a guess.
 */
export function shareTarget(links, read) {
  if (!read) return { kind: 'unreadable' };
  const active = (Array.isArray(links) ? links : []).filter((l) => l && l.is_active && l.slug);
  if (active.length === 0) return { kind: 'none' };
  if (active.length === 1) return { kind: 'one', link: active[0] };
  return { kind: 'many', count: active.length };
}
