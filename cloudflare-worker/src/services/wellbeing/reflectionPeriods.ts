/**
 * D7118 (#7118): the periods a Wellness reflection belongs to, in the
 * member's own calendar. Pure: no database, no clock except the `now` passed.
 *
 *   day    one calendar date in the member's time zone
 *   week   Monday to Sunday, named by its Monday
 *   month  the calendar month, named by its first day
 *
 * The time zone rule. "Today", "this week" and "this month" are worked out in
 * the IANA zone the member's device sends with the request. A saved row keeps
 * the zone it was first saved in and its own dates for ever: moving from Paris
 * to New York never moves a past reflection to another day, and a day that
 * already has a reflection is edited, not duplicated, whatever zone the edit
 * comes from.
 */

export const CADENCES = ['day', 'week', 'month'] as const;
export type Cadence = typeof CADENCES[number];

/** Nothing is filed before this date: older dates are a typo, not a journal. */
export const EARLIEST_PERIOD = '2020-01-01';
export const TIMEZONE_MAX = 64;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isCadence(v: unknown): v is Cadence {
  return typeof v === 'string' && (CADENCES as readonly string[]).includes(v);
}

/** A real calendar date written YYYY-MM-DD (2026-02-30 is not one). */
export function isDate(v: unknown): v is string {
  if (typeof v !== 'string' || !DATE_RE.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

/** An IANA zone the runtime knows, e.g. `Europe/Paris` or `UTC`. */
export function isTimezone(v: unknown): v is string {
  if (typeof v !== 'string' || !v || v.length > TIMEZONE_MAX) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: v });
    return true;
  } catch {
    return false;
  }
}

/** The calendar date `now` falls on in `tz`. */
export function localDay(now: Date, tz: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

function shift(day: string, days: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

/** The first and last date of the period of `cadence` that `day` falls in. */
export function periodOf(cadence: Cadence, day: string): { start: string; end: string } {
  if (cadence === 'day') return { start: day, end: day };
  if (cadence === 'week') {
    const back = (new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7;
    const start = shift(day, -back);
    return { start, end: shift(start, 6) };
  }
  const start = `${day.slice(0, 7)}-01`;
  const [y, m] = day.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { start, end: `${day.slice(0, 7)}-${String(last).padStart(2, '0')}` };
}

/** Today's day, week and month for a member in `tz`. */
export function currentPeriods(now: Date, tz: string) {
  const today = localDay(now, tz);
  return {
    today,
    day: periodOf('day', today),
    week: periodOf('week', today),
    month: periodOf('month', today),
  };
}

/**
 * Whether `start` names a period of `cadence` a member may write: a real
 * date, the period's own first day, not before EARLIEST_PERIOD and not after
 * the member's today. A refusal says which, as a code.
 */
export function periodProblem(cadence: Cadence, start: unknown, today: string):
  | null
  | { code: 'invalid_period' | 'period_not_aligned' | 'period_too_early' | 'period_in_future'; message: string } {
  if (!isDate(start)) return { code: 'invalid_period', message: 'The period must be a date written YYYY-MM-DD.' };
  if (periodOf(cadence, start).start !== start) {
    return {
      code: 'period_not_aligned',
      message: cadence === 'week' ? 'A week is named by its Monday.' : 'A month is named by its first day.',
    };
  }
  if (start < EARLIEST_PERIOD) return { code: 'period_too_early', message: `Reflections start from ${EARLIEST_PERIOD}.` };
  if (start > today) return { code: 'period_in_future', message: 'A reflection cannot be written for a period that has not started.' };
  return null;
}

/** Every date from `start` to `end`, both included. */
export function datesBetween(start: string, end: string): string[] {
  const out: string[] = [];
  for (let d = start; d <= end; d = shift(d, 1)) out.push(d);
  return out;
}
