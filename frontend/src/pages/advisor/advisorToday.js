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
 * is `17`, its calendar copy `advisor_booking:17`. Cancelled and no-show
 * items are dropped from BOTH branches. The full Calendar keeps them.
 */
import { ADVISOR_AGENDA_KINDS, calendarCoverage, mergeAgenda, upcomingActive } from '../studio/studioAgenda';
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
  const items = upcomingActive(
    mergeAgenda([{ items: bookingRows, kind: KIND }, { items: calendarRows, kind: KIND }]),
    { now, until: dayEnd },
  );

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
  return { items, openSlots, inputs, loading: named('loading'), failed: named('failed') };
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
export function todayState({ items, openSlots, loading, failed }) {
  if (items.length || openSlots.length) return 'ready';
  if (failed.length) return 'unreadable';
  if (loading.length) return 'loading';
  return 'empty';
}
