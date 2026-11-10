/**
 * D1205 (#2420) — the Calendar's views at their own addresses, its kinds in
 * their families (the Worker registry's since D5205), and the words of what no
 * read carries yet, from the canvas "Calendar" (CAL1–CAL21). Pure, so
 * `frontend/test/calendar_views_d1205.test.mjs` holds each rule.
 *
 * D1210: Month and Week are grids (`CalendarGrids.jsx`, rules in
 * `calendarGrid.js`) and Agenda the list grouped by day; `windowFor` takes the
 * `?date=` anchor as its `now`.
 */
import { FAMILY_LABELS, SOURCES, SOURCE_FAMILIES } from '../../../cloudflare-worker/src/services/calendar/registry.ts';

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

/**
 * D5205 (#5205) — THE WORKER'S REGISTRY IS THE ONE LIST.
 *
 * `cloudflare-worker/src/services/calendar/registry.ts` says which kinds the calendar reads, their family,
 * their module and label, and whether each is page only or pushable. This file used to carry its own copy of
 * that (eight canvas families, and a `KINDS` table in `CalendarPage.jsx`), and the copies drifted: the page said
 * cohort dates, deal closings and interview calls were not read while it was showing them. Both now come from
 * the registry itself, imported as the Worker builds it; the page and the Worker ship in one deploy, so they
 * cannot disagree. A kind added there has its chip, its family, its legend row and its count here with no edit.
 *
 * What stays in the frontend is presentation the Worker has no word for, each held to the registry by
 * `frontend/test/calendar_registry_truth_5205.test.mjs`: `CHIP_LABEL` (the canvas's shorter chip words for four
 * kinds), `EXPLORER_KINDS` (what an Explorer's calendar reads, D1210), and each kind's mark in `calendarPage.css`.
 */
/** The canvas's chip word, where it is shorter than the registry's label. Every key is a registry kind. */
export const CHIP_LABEL = Object.freeze({
  advisor_booking: 'Advisor',
  calendly_event: 'Calendly',
  compliance_due: 'Compliance',
  engagement_milestone: 'Milestone',
});

/**
 * Every kind, in the registry's order (the canvas's first five lead it): `label` is the chip's word, `from` the
 * module it comes from in plain words (never a table name), `family`, `page_only` and `pushable` the registry's.
 */
export const kindsOf = (sources, chipLabel = CHIP_LABEL) => Object.freeze(Object.entries(sources).map(([id, s]) => Object.freeze({
  id, label: chipLabel[id] || s.label, from: s.module, family: s.family, page_only: s.page_only, pushable: s.pushable,
})));
export const KINDS = kindsOf(SOURCES);

export const KIND_LABEL = Object.freeze(Object.fromEntries(KINDS.map((k) => [k.id, k.label])));

/** The kinds one event of which can be copied to Google or Outlook: the registry's, which the push route's set is held to. */
export const PUSHABLE_KINDS = Object.freeze(new Set(KINDS.filter((k) => k.pushable).map((k) => k.id)));

/** The registry's families, in its order, each with its kinds; a family with none is left out. */
export const familiesOf = (kinds, order = SOURCE_FAMILIES, labels = FAMILY_LABELS) => Object.freeze(order
  .map((key) => Object.freeze({ key, label: labels[key], kinds: Object.freeze(kinds.filter((k) => k.family === key).map((k) => k.id)) }))
  .filter((f) => f.kinds.length));
export const FAMILIES = familiesOf(KINDS);

/**
 * D1210 (CAL14): an Explorer's calendar is the events they hold and their other calendars — the same six kinds
 * it was before D5205, now named by kind rather than by a frontend family. Every one is a registry kind.
 */
export const EXPLORER_KINDS = Object.freeze(['event_ticket', 'event_hosted', 'manual', 'calendly_event', 'external_google', 'external_microsoft']);

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

/**
 * What the canvas draws that no read carries yet. Never a zero, never "none".
 *
 * D5205 (#5205): each entry names the kinds it waits for, and `waitsOf` drops any whose kinds the registry now
 * reads, so a live source can never also stand under "Not read here yet". The two sentences this held (cohort
 * dates and deal closings; interview calls) were retired: all three have been read since D1484. It is empty
 * today, and the page draws no card for an empty list.
 */
export const WAITS = Object.freeze([]);

/** The waits still true: those naming no kind the registry reads. */
export const waitsOf = (waits = WAITS, live = KINDS.map((k) => k.id)) => waits.filter((w) => !(w.kinds || []).some((k) => live.includes(k)));
