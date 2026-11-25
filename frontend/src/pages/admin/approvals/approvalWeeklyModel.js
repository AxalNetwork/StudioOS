/** Weekly decision totals and chart data. */
import { ageText, nf } from './approvalsFormat.js';

/** "1 d 9 h"; the Decided tile's median wait. */
export function weeklyTile(weekly) {
  if (!weekly || weekly.status === 'loading') return { state: 'loading' };
  if (weekly.status !== 'ready') return { state: 'unreadable', reason: 'The weekly series could not be read.' };
  const t = weekly.reply?.tile || {};
  if (t.decided_this_week === null || t.decided_this_week === undefined) return { state: 'unreadable', reason: t.reason || 'This week’s decisions are not known.' };
  const median = ageText(t.median_wait_hours);
  return { state: 'ready', value: nf(t.decided_this_week), sub: median ? `median wait ${median}` : 'median wait not recorded', leavesOut: t.leaves_out || [] };
}

const WEEK_DAY = (iso) => {
  const t = Date.parse(`${iso}T00:00:00Z`);
  return Number.isFinite(t) ? new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }) : iso;
};

/**
 * "Arrived and decided, last 8 weeks" (APR1): the totals as two lines, the
 * current week to date. A total that leaves lanes out says which in `foot`;
 * no total at all is a chart that is not drawn, with why.
 */
export function weekChart(reply) {
  const weeks = Array.isArray(reply?.weeks) ? reply.weeks : [];
  const t = reply?.totals || {};
  if (!weeks.length || (!t.arrived && !t.decided)) {
    return { drawable: false, reason: reply?.unreadable?.length ? `${reply.unreadable.join(', ')} could not be read.` : 'No lane records its weeks yet.' };
  }
  const labels = weeks.map((w) => WEEK_DAY(w.week_start));
  const series = [
    { label: 'Arrived', tone: 'violet', values: t.arrived || weeks.map(() => null) },
    { label: 'Decided', tone: 'sky', values: t.decided || weeks.map(() => null) },
  ];
  const last = (v) => (Array.isArray(v) ? v[v.length - 1] : null);
  const first = (v) => (Array.isArray(v) ? v[0] : null);
  const period = (n) => (n === null || n === undefined ? 'Not recorded' : nf(n));
  const sum = [
    'Items that arrived and were decided each week for eight weeks.',
    t.arrived ? `Arrivals went from ${period(first(t.arrived))} to ${period(last(t.arrived))} a week.` : 'Arrivals are not counted.',
    t.decided ? `Decisions went from ${period(first(t.decided))} to ${period(last(t.decided))}.` : 'Decisions are not counted.',
    'This week is not finished.',
  ].join(' ');
  const out = [...new Set([...(t.decided_leaves_out || [])])];
  const arrOut = (t.arrived_leaves_out || []).filter((l) => !out.includes(l));
  const foot = [
    out.length ? `${out.join(', ')} ${out.length === 1 ? 'does' : 'do'} not record when ${out.length === 1 ? 'it was' : 'they were'} decided, so ${out.length === 1 ? 'it is' : 'they are'} not in Decided.` : null,
    arrOut.length ? `${arrOut.join(', ')} ${arrOut.length === 1 ? 'is' : 'are'} not in Arrived.` : null,
  ].filter(Boolean).join(' ');
  return { drawable: true, chart: { type: 'lines', labels, series, currentIndex: labels.length - 1 }, sum, foot: foot || null };
}
