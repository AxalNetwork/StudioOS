/**
 * D4620 (#4620) — the Advisor Studio's Today list, from the three reads it
 * depends on: the advisor's bookings, the unified calendar, and their slots.
 *
 * It is a function of the reads' states, kept out of AdvisorStudioHome so a
 * Node test can drive every combination (the home itself mounts the interview,
 * whose imports reach Worker modules).
 *
 * Each input is one of
 *   loading   still being read
 *   failed    the read failed, or the calendar answered 200 and reported the
 *             advisor-booking source unreadable (`calendarCoverage`)
 *   ready     answered
 *   none      there is nothing to read (a role preview, no advisor profile yet)
 *
 * and the answer never turns a `loading` or `failed` input into "nothing is
 * scheduled": the tile may show what the other inputs returned, with the
 * missing ones named, but an empty Today needs every input to have answered.
 *
 * The list is bookings first, then calendar copies of bookings; the two are
 * one list by canonical identity (kind + source id), not by raw id: the booking
 * is `17`, its calendar copy `advisor_booking:17`. No-show items are dropped
 * from BOTH branches. The full Calendar keeps them.
 *
 * D8732 (#8732, owner's option A on Q2 and Q3, 2026-11-27): a cancelled
 * booking today is kept apart in `cancelled`, never counted as a session, so
 * the tile can draw it struck through with its reason; and a session that has
 * started stays in `items` until its end (`inProgress` says which), so an
 * advisor two minutes late can still open it from Today.
 */
import { ADVISOR_AGENDA_KINDS, agendaKey, agendaStart, calendarCoverage, isActiveStatus, mergeAgenda } from '../studio/studioAgenda';
import { isBookableSlot, slotView } from './advisory/kit';

const KIND = 'advisor_booking';

const failedRead = (read) => read.state === 'unavailable' && read.failed === true;

function inputState(read, extraFailure = false) {
  if (read.state === 'loading') return 'loading';
  if (failedRead(read) || extraFailure) return 'failed';
  return read.state === 'ready' ? 'ready' : 'none';
}

export function advisorToday({ bookings, calendar, slots }, now = new Date()) {
  const dayEnd = new Date(now);
  dayEnd.setHours(23, 59, 59, 999);

  const coverage = calendar.state === 'ready' ? calendarCoverage(calendar.data, ADVISOR_AGENDA_KINDS) : null;
  const inputs = {
    bookings: inputState(bookings),
    calendar: inputState(calendar, coverage ? coverage.state !== 'ready' : false),
    slots: inputState(slots),
  };

  const bookingRows = bookings.state === 'ready' ? bookings.data : [];
  const calendarRows = coverage && coverage.state === 'ready'
    ? coverage.items.filter((event) => (event.kind || event.type) === KIND)
    : [];
  const merged = mergeAgenda([{ items: bookingRows, kind: KIND }, { items: calendarRows, kind: KIND }]);
  const items = onToday(merged.filter((item) => isActiveStatus(item?.status)), now, dayEnd);
  const cancelled = onToday(merged.filter((item) => isCancelled(item?.status)), now, dayEnd);
  // The calendar copy of each booking, by identity: it alone carries the meeting link and the founder by name.
  const copies = new Map(calendarRows.map((event) => [agendaKey(event, KIND), event]));
  // D8732 (SAV06D): an empty day names the next booking the same bookings read holds, never a guess.
  const later = onLater(bookingRows.filter((item) => isActiveStatus(item?.status)), dayEnd);

  // One implementation of "bookable", in ./advisory/kit.
  const openSlots = slots.state === 'ready'
    ? slots.data
      .filter((slot) => {
        if (!isBookableSlot(slot)) return false;
        const start = new Date(slotView(slot).startsAt);
        return start >= now && start <= dayEnd;
      })
      .sort((a, b) => new Date(slotView(a).startsAt) - new Date(slotView(b).startsAt))
    : [];

  const named = (state) => Object.keys(inputs).filter((key) => inputs[key] === state);
  return {
    items, cancelled, openSlots, copies, nextBooking: later[0] || null,
    inProgress: new Set(items.filter((item) => startedAt(item, now)).map((item) => agendaKey(item, KIND))),
    inputs, loading: named('loading'), failed: named('failed'),
  };
}

const millis = (value) => {
  if (!value) return null;
  const ms = new Date(value).getTime();
  return Number.isNaN(ms) ? null : ms;
};

/** When an item ends, across the booking (its slot's end) and the calendar copy; null when none is recorded. */
export function agendaEnd(item) {
  return millis(item?.slot_ends_at || item?.end_at || item?.ends_at || item?.scheduled_end || null);
}

/** Cancelled is history the tile still draws (option A on Q2); no-show and the rest are not. */
export const isCancelled = (status) => ['cancelled', 'canceled'].includes(String(status || '').trim().toLowerCase());

/** True when the item has started and its recorded end is still ahead (option A on Q3). */
export function startedAt(item, now = new Date()) {
  const start = millis(agendaStart(item));
  const end = agendaEnd(item);
  const t = now.getTime();
  return start !== null && end !== null && start <= t && end > t;
}

/**
 * The items still to come or still running today, soonest first: a start in
 * [now, dayEnd], or a start already past with its end still ahead. An item
 * with no readable start is left out; one with no end leaves at its start.
 */
function onToday(items, now, dayEnd) {
  const t = now.getTime();
  return items
    .map((item) => ({ item, at: millis(agendaStart(item)) }))
    .filter(({ item, at }) => at !== null && at <= dayEnd.getTime() && (at >= t || startedAt(item, now)))
    .sort((a, b) => a.at - b.at)
    .map(({ item }) => item);
}

function onLater(items, dayEnd) {
  return items
    .map((item) => ({ item, at: millis(agendaStart(item)) }))
    .filter(({ at }) => at !== null && at > dayEnd.getTime())
    .sort((a, b) => a.at - b.at)
    .map(({ item }) => item);
}

/** "bookings and slots", for a sentence. */
export function listNames(names) {
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/**
 * The Today tile's state from `advisorToday`'s answer: it is `empty` only
 * when every input has answered, `unreadable` (never empty) when nothing
 * came back and an input failed, and `ready` when ANY input returned something,
 * with the gaps named by the tile.
 */
export function todayState({ items, openSlots, cancelled = [], loading, failed }) {
  if (items.length || openSlots.length || cancelled.length) return 'ready';
  if (failed.length) return 'unreadable';
  if (loading.length) return 'loading';
  return 'empty';
}
