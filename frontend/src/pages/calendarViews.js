/**
 * D1205 (#2420) — the Calendar's views at their own addresses, its kinds as the
 * canvas's five families, and the words of what no read carries yet, from the
 * canvas "Calendar" (CAL1–CAL21). Pure, so
 * `frontend/test/calendar_views_d1205.test.mjs` holds each rule.
 *
 * D1210: Month and Week are grids (`CalendarGrids.jsx`, rules in
 * `calendarGrid.js`) and Agenda the list grouped by day; `windowFor` takes the
 * `?date=` anchor as its `now`.
 */

/** The canvas's three views, in its order: Month is the default. */
export const VIEWS = Object.freeze([
  { key: 'month', label: 'Month', path: '/calendar' },
  { key: 'week', label: 'Week', path: '/calendar/week' },
  { key: 'agenda', label: 'Agenda', path: '/calendar/agenda' },
]);

/** The view an address names. Anything else under /calendar is Month. */
export function viewOf(pathname = '') {
  const p = String(pathname).replace(/\/+$/, '');
  return VIEWS.find((v) => v.key !== 'month' && v.path === p)?.key || 'month';
}

const DAY_MS = 86_400_000;

/**
 * The window each view asks the Worker for, from `now`:
 * - month: the calendar month;
 * - week: Monday to Sunday of this week (CAL2 draws 10–16 Nov), never "today plus seven";
 * - agenda: today and the next 90 days.
 * `to` is exclusive.
 */
export function windowFor(view, now = new Date()) {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  if (view === 'month') {
    return { from: new Date(start.getFullYear(), start.getMonth(), 1), to: new Date(start.getFullYear(), start.getMonth() + 1, 1) };
  }
  if (view === 'week') {
    const back = (start.getDay() + 6) % 7; // Monday is 0
    const monday = new Date(start.getFullYear(), start.getMonth(), start.getDate() - back);
    return { from: monday, to: new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 7) };
  }
  return { from: start, to: new Date(start.getTime() + 90 * DAY_MS) };
}

/** The canvas's five families, each with the kinds the Worker reads today. */
export const FAMILIES = Object.freeze([
  { key: 'events', label: 'Events', kinds: ['event_ticket', 'event_hosted', 'manual'] },
  { key: 'meetings', label: 'Meetings', kinds: ['ic_meeting', 'founder_checkin', 'investor_meeting', 'interview_call', 'bot_call'] },
  { key: 'sessions', label: 'Sessions', kinds: ['advisor_booking', 'partner_office_hour', 'expert_booking'] },
  { key: 'deadlines', label: 'Deadlines', kinds: ['compliance_due', 'cohort_date', 'deal_closing'] },
  // #3959: the member's own learning plan and registered webinars (its boards are LRN1–LRN3, CAL12).
  { key: 'learning', label: 'Learning', kinds: ['learning'] },
  // D1486 §b (#3981): Publish's sends and Grow › Distribution's planned pieces.
  { key: 'grow', label: 'Grow', kinds: ['publish_send', 'content_planned'] },
  { key: 'other', label: 'From other calendars', kinds: ['calendly_event'] },
]);

export const familyOf = (kind) => FAMILIES.find((f) => f.kinds.includes(kind))?.key || null;

/**
 * D1384 (#3692) — `?layer=` names one source by a word a link can carry, and
 * reads as `?kinds=` of that source's registered kinds. `/compliance` now
 * redirects to `?layer=compliance`. #3723's source settings can replace this
 * map without touching a link.
 */
export const LAYERS = Object.freeze({ compliance: ['compliance_due'] });

/**
 * A kind's chip count: the number in range, or a dash when its source did not
 * answer (broken item 4: a failed source's chip read 0). `null` when the list
 * itself was not read.
 */
export function chipCount(items, kind, failedKinds) {
  if (failedKinds?.has?.(kind)) return '—';
  if (!Array.isArray(items)) return null;
  return items.filter((e) => e.kind === kind).length;
}

export const NOT_YET = 'Not read here yet';

/** What the canvas draws that no read carries yet. Never a zero, never "none". */
export const WAITS = Object.freeze({
  deadlines: 'Compliance deadlines are read. Cohort week dates and deal closing dates are not read yet: each needs a reader on the calendar.',
  interviews: 'Interview calls are not on the calendar yet. They stay on Validate › Customer research until the calendar reads them.',
});
