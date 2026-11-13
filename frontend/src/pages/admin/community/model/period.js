/**
 * #4717 package 6 — The period control: 4, 12 or 52 weeks, in the URL as `?weeks=`, 12 by default (the Community read's default too, #4717 package 6).
 *
 * Split out of communityModel.js, which re-exports what the page and the
 * tests import. Pure: nothing here fetches.
 */

/** The canvas's period control: weeks, in the URL as `?weeks=`. 12 when absent or not one of these. */
export const PERIODS = [
  { weeks: 4, label: '4 weeks' },
  { weeks: 12, label: '12 weeks' },
  { weeks: 52, label: '52 weeks' },
];

export const DEFAULT_WEEKS = 12;

/** The period `?weeks=` names, or the default. */
export function weeksFrom(search) {
  const raw = new URLSearchParams(search || '').get('weeks');
  const w = PERIODS.find((p) => String(p.weeks) === raw);
  return w ? w.weeks : DEFAULT_WEEKS;
}

/** The address with `?weeks=` set, every other parameter kept. */
export function searchWithWeeks(search, weeks) {
  const next = new URLSearchParams(search || '');
  next.set('weeks', String(weeks));
  return `?${next.toString()}`;
}
