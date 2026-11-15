/**
 * D5840 (#5840) — Search Console weeks: Pacific Time provider dates, Monday-start weeks and the weekly
 * property totals, summed only from stored byProperty daily rows (never from top-page detail).
 *
 * Pure: no env, no I/O. `searchConsoleSync.ts` writes the rows these functions read.
 */

/** Search Console reports every date in Pacific Time; dates here are never converted to UTC. */
export const PROVIDER_TIMEZONE = 'America/Los_Angeles';
export const UNITS = Object.freeze({ clicks: 'count', impressions: 'count', ctr: 'ratio', position: 'average_rank' });
/** Google's page rows are top rows only: some pages are never listed, so a page list is never complete. */
export const TOP_ROWS_NOTE = 'Top landing pages are the rows Google returned for the week, not every page; they are never summed into property totals.';

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
export function validDay(day: unknown): day is string {
  if (typeof day !== 'string' || !DAY_RE.test(day)) return false;
  const d = new Date(day + 'T00:00:00Z');
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === day;
}
export function addDays(day: string, n: number): string {
  const d = new Date(day + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
/** Whole days from a to b (b - a). */
export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000);
}
/** The calendar date in Pacific Time at `now` (DST included, through Intl). */
export function pacificDate(now: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: PROVIDER_TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}
/** The Monday that starts the week holding `day` (weeks run Monday to Sunday, in provider dates). */
export function weekStartOf(day: string): string {
  const dow = new Date(day + 'T00:00:00Z').getUTCDay(); // 0 = Sunday
  return addDays(day, -((dow + 6) % 7));
}
export function weekStartsBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let w = weekStartOf(from); w <= to; w = addDays(w, 7)) out.push(w);
  return out;
}

export type DayRow = { data_date: string; row_state: 'reported' | 'not_returned'; clicks: number | null; impressions: number | null };
export type WeekTotals = {
  week_start: string; week_end: string;
  clicks: number | null; impressions: number | null; ctr: number | null;
  clicks_reason: string | null; ctr_reason: string | null;
  days_reported: number; days_not_returned: number; days_not_fetched: number;
  complete: boolean; incomplete_reason: string | null;
};

/**
 * One week's property totals. Eligible days are the fetched final dates Google reported a row for; a
 * `not_returned` date (missing or suppressed) is counted as such and adds nothing, and a date never fetched
 * (after `fetched_through`, before the initial window, or a failed fetch) makes the week incomplete.
 * CTR is total clicks over total impressions; with no impressions it is undefined (null), never 0.
 */
export function weekTotals(weekStart: string, days: readonly DayRow[], opts: { fetchedThrough: string | null; initialFrom: string | null; failure?: string | null }): WeekTotals {
  const weekEnd = addDays(weekStart, 6);
  const byDate = new Map(days.map((d) => [d.data_date, d]));
  let clicks = 0, impressions = 0, reported = 0, notReturned = 0, notFetched = 0;
  for (let i = 0; i < 7; i++) {
    const day = addDays(weekStart, i);
    const row = byDate.get(day);
    if (!row) { notFetched++; continue; }
    if (row.row_state === 'not_returned') { notReturned++; continue; }
    reported++; clicks += row.clicks ?? 0; impressions += row.impressions ?? 0;
  }
  const none = reported === 0;
  let incomplete: string | null = null;
  if (notFetched) {
    if (opts.failure) incomplete = `Unreadable: the last sync failed (${opts.failure}); ${notFetched} of 7 days not fetched`;
    else if (!opts.fetchedThrough || weekEnd > opts.fetchedThrough) incomplete = `Not final yet: fetched through ${opts.fetchedThrough ?? 'no date'}`;
    else if (opts.initialFrom && weekStart < opts.initialFrom) incomplete = `Before the synced window (from ${opts.initialFrom})`;
    else incomplete = `${notFetched} of 7 days not fetched`;
  }
  const ctrReason = none ? 'Not recorded: Google returned no rows for this week'
    : impressions === 0 ? 'No impressions: CTR is undefined' : null;
  return {
    week_start: weekStart, week_end: weekEnd,
    clicks: none ? null : clicks, impressions: none ? null : impressions,
    ctr: ctrReason ? null : clicks / impressions,
    clicks_reason: none ? (notFetched === 7 ? incomplete : 'Not recorded: Google returned no rows for this week') : null,
    ctr_reason: ctrReason,
    days_reported: reported, days_not_returned: notReturned, days_not_fetched: notFetched,
    complete: notFetched === 0, incomplete_reason: incomplete,
  };
}
