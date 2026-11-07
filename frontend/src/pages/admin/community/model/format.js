/**
 * #4717 package 6 — Words from figures: times and days, waits, deltas on the period before, seats and days open. No reads.
 *
 * Split out of communityModel.js, which re-exports what the page and the
 * tests import. Pure: nothing here fetches.
 */
import { count } from './read.js';

export const nf = (n) => Number(n).toLocaleString('en-US');

/** A SQL or ISO timestamp as epoch ms. An offset-free D1 stamp is UTC. NaN when absent. */
export function stamp(value) {
  if (typeof value !== 'string' || !value.trim()) return Number.NaN;
  const v = value.trim();
  return Date.parse(/(?:[zZ]|[+-]\d{2}:?\d{2})$/.test(v) ? v : `${v.replace(' ', 'T')}Z`);
}

/** "28 Oct" in the event's own time zone, or UTC when the zone is unknown. */
export function dayLabel(value, timeZone = 'UTC') {
  const t = stamp(value);
  if (Number.isNaN(t)) return 'Not recorded';
  const opts = { day: 'numeric', month: 'short' };
  try { return new Date(t).toLocaleDateString('en-GB', { ...opts, timeZone }); } catch { return new Date(t).toLocaleDateString('en-GB', { ...opts, timeZone: 'UTC' }); }
}

/**
 * D1121 (migration 609): a posting's whole days open since an admin last
 * approved it. Null when it is not published (nothing is open); NaN when it
 * is published but was approved before the day was recorded, never 0.
 */

export function jobDaysOpen(job, now) {
  if (!job || job.status !== 'published') return null;
  const t = stamp(job.published_at);
  return Number.isNaN(t) ? Number.NaN : Math.max(0, Math.floor((now - t) / 86_400_000));
}

/** "1 day open", "12 days open", "Days open not recorded", or null when the posting is not open. */
export function daysOpenText(job, now) {
  const d = jobDaysOpen(job, now);
  if (d === null) return null;
  if (Number.isNaN(d)) return 'Days open not recorded';
  return `${nf(d)} ${d === 1 ? 'day' : 'days'} open`;
}

/** "10:42", the page's Updated time. */
export function asOfLabel(ms) {
  return new Date(ms).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

/**
 * Every page of a paged list. `fetchPage(offset)` answers `{ [key]: rows }`.
 * A short page ends it. Fifty full pages (10,000 rows) is refused rather than
 * drawn as a total, because the page would then be counting part of a list.
 */

/** "the 12 weeks before", the period a delta compares with. */
export const beforeLabel = (weeks) => `the ${weeks} weeks before`;

/**
 * A period figure against the same number of weeks before it: "+12% on the
 * 12 weeks before", "−8% …", "same as …", or "none in …" when the period
 * before had none, so no percentage is invented from a zero.
 */

export function deltaText(window, previous, weeks) {
  const w = Number(window);
  const p = Number(previous);
  if (!Number.isFinite(w) || !Number.isFinite(p)) return null;
  if (p === 0) return w === 0 ? `none in this period or ${beforeLabel(weeks)}` : `none in ${beforeLabel(weeks)}`;
  const pct = Math.round(((w - p) / p) * 100);
  if (pct === 0) return `same as ${beforeLabel(weeks)}`;
  return `${pct > 0 ? '+' : '−'}${Math.abs(pct)}% on ${beforeLabel(weeks)}`;
}

/** "3 days", "5 hours", "under an hour": a wait in whole units, never rounded up into Overdue. */
export function waitText(hours) {
  const h = Math.floor(Number(hours));
  if (!Number.isFinite(h) || h < 0) return null;
  if (h < 1) return 'under an hour';
  if (h < 24) return `${h} hour${h === 1 ? '' : 's'}`;
  const d = Math.floor(h / 24);
  return `${d} day${d === 1 ? '' : 's'}`;
}

/** "19 Oct", a Monday week's label. */
export const weekLabel = (week) => dayLabel(`${week}T00:00:00Z`);

export function seatsText(event) {
  // #4717 package 3: seats and a cap are whole numbers or nothing is drawn; "12" or 1.5 is not a seat count.
  const taken = count(event?.seats_taken);
  if (taken === null) return { text: 'Seats not recorded', missing: true };
  if (event.capacity == null) return { text: `No cap · ${nf(taken)} registered`, taken };
  const cap = count(event.capacity);
  if (cap === null) return { text: 'Seats not recorded', missing: true };
  return { text: `${nf(taken)} / ${nf(cap)}`, taken, fill: cap > 0 ? Math.min(1, taken / cap) : 0 };
}

/** The server's days open (D1121) as the card's words; `{ recorded: false }` is "not recorded", never 0. */
export function daysOpenWords(d) {
  if (d === null || d === undefined) return null;
  if (typeof d === 'object' && d.recorded === false) return 'Days open not recorded';
  const n = count(d);
  return n === null ? 'Days open not recorded' : `${nf(n)} ${n === 1 ? 'day' : 'days'} open`;
}
