/**
 * #4717 package 6 — The Wellbeing card: experts by state, bookings by week and the check-in band, a range of founders withheld under seven.
 *
 * Split out of communityModel.js, which re-exports what the page and the
 * tests import. Pure: nothing here fetches.
 */
import { CHECKINS_WITHHELD, MIN_CHECKIN_COHORT } from './constants.js';
import { nf, weekLabel } from './format.js';
import { FIGURE_UNREAD, blockOf, count, countsAt, onWeeks, weeksOf } from './read.js';

/** The listed experts by state (D931's `wellbeing.experts`), all four whole numbers, or unreadable. */
export function expertsOf(overview) {
  const b = blockOf(overview, 'wellbeing.experts');
  if (b.state !== 'ready') return b;
  const c = countsAt(b.block, ['verified', 'unverified', 'hidden', 'inactive']);
  return c ? { state: 'ready', ...c } : { state: 'unreadable', reason: FIGURE_UNREAD };
}

/**
 * D918's show-up block, checked: events, seats taken and attended are whole
 * numbers with attended within the seats; `confirmed` is a whole number within
 * the seats, or absent from an older read (then "Not in this read"); the rate
 * is a share from 0 to 1, or null when no seat was taken.
 */

export function buildWellbeing(reads) {
  const out = {};
  const ex = expertsOf(reads.overview);
  out.experts = ex.state !== 'ready' ? ex : {
    state: 'ready',
    parts: [
      { label: 'Verified', tone: 'violet', value: ex.verified },
      { label: 'Unverified', tone: 'sky', value: ex.unverified },
      { label: 'Inactive', tone: 'amber', value: ex.inactive },
      { label: 'Hidden', tone: 'muted', value: ex.hidden },
    ],
  };
  if (out.experts.state === 'ready') out.experts.total = out.experts.parts.reduce((t, p) => t + p.value, 0);
  const bk = blockOf(reads.overview, 'wellbeing.bookings');
  const weeks = bk.state === 'ready' ? weeksOf(reads.overview.data) : null;
  const values = weeks ? onWeeks(weeks, bk.block.weekly, 'count') : null;
  const bookedInWindow = bk.state === 'ready' ? count(bk.block.window) : null;
  if (bk.state !== 'ready') out.bookings = bk;
  else if (!values || bookedInWindow === null) out.bookings = { state: 'unreadable', reason: FIGURE_UNREAD };
  else {
    const current = weeks.indexOf(reads.overview.data.current_week);
    out.bookings = {
      state: 'ready',
      window: bookedInWindow,
      rows: weeks.map((w, i) => ({ label: weekLabel(w), value: values[i] ?? 0, text: values[i] == null ? '–' : nf(values[i]), toDate: i === current })),
    };
  }
  const ci = blockOf(reads.overview, 'wellbeing.checkins');
  // #4717 package 3: withheld is said only when the read says so; a band is shown only when both ends are whole
  // numbers and its top reaches the cohort of seven (seven founders are the band 5 to 9). Anything else is
  // unreadable, never a band and never "too few".
  const band = ci.state === 'ready' && ci.block.withheld === false ? countsAt(ci.block.band, ['at_least', 'under']) : null;
  if (ci.state !== 'ready') out.checkins = ci;
  else if (ci.block.withheld === true) out.checkins = { state: 'ready', withheld: true, text: CHECKINS_WITHHELD };
  else if (!band || band.under - 1 < MIN_CHECKIN_COHORT || band.under <= band.at_least) {
    out.checkins = { state: 'unreadable', reason: 'The check-ins could not be read. That is not the same as none.' };
  } else {
    out.checkins = { state: 'ready', withheld: false, text: `${nf(band.at_least)} to ${nf(band.under - 1)} founders checked in` };
  }
  return out;
}
