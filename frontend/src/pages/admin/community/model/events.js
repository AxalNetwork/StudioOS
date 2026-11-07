/**
 * #4717 package 6 — The Events card: show-up, Next up, the funnel, the waitlists and events by type.
 *
 * Split out of communityModel.js, which re-exports what the page and the
 * tests import. Pure: nothing here fetches.
 */
import { EVENT_TYPES } from '../../../../lib/eventTypes.js';
import { dayLabel, nf, seatsText } from './format.js';
import { FIGURE_UNREAD, blockOf, count, countMap, countsAt, isObj, isText, pct } from './read.js';

export function showUpOf(overview) {
  const b = blockOf(overview, 'events.show_up');
  if (b.state !== 'ready') return b;
  const c = countsAt(b.block, ['events', 'seats_taken', 'attended']);
  const confirmed = b.block.confirmed == null ? null : count(b.block.confirmed);
  const rate = b.block.rate;
  const rateOk = rate === null || rate === undefined || (typeof rate === 'number' && rate >= 0 && rate <= 1);
  if (!c || !rateOk || c.attended > c.seats_taken || (b.block.confirmed != null && (confirmed === null || confirmed > c.seats_taken))) {
    return { state: 'unreadable', reason: FIGURE_UNREAD };
  }
  return { state: 'ready', events: c.events, seats: c.seats_taken, attended: c.attended, confirmed, rate: rate ?? null };
}

/** Show-up for the events that ended in the period: attended over seats taken (D918's rule). */
export function showUpTile(overview, weeks) {
  const base = { key: 'show-up', label: 'Show-up rate' };
  const b = showUpOf(overview);
  if (b.state !== 'ready') return { ...base, ...b };
  const { events, seats, attended } = b;
  if (!events) return { ...base, state: 'ready', value: '—', sub: `No event ended in these ${weeks} weeks.` };
  if (!seats) return { ...base, state: 'ready', value: '—', sub: `No seat was taken on the ${nf(events)} events that ended.` };
  // The share is counted from the checked counts, so it cannot disagree with "x of y seats".
  return { ...base, state: 'ready', value: `${Math.round((attended / seats) * 100)}%`, sub: `${nf(attended)} of ${nf(seats)} seats · ${nf(events)} events ended` };
}

/**
 * The Events card's Next up: the three soonest events in the next 30 days, the
 * Community read's `events.next_up`. They are the same events the Upcoming
 * tile counts (published or waiting, D918's rule), so the list and the number
 * cannot disagree (#4717); a waiting event says so. Seats are each event's own
 * seats taken (D915's rule, D1121).
 */

export function buildNextUp(reads) {
  const b = blockOf(reads.overview, 'events.next_up', 'The next events could not be read. That is not the same as no events.');
  if (b.state !== 'ready') return b;
  // #4717 package 3: every row names an event and its start, and there are no more rows than the total.
  const total = count(b.block.total);
  if (!Array.isArray(b.block.rows) || total === null || b.block.rows.length > total
    || !b.block.rows.every((e) => isObj(e) && isText(e.title) && isText(e.starts_at) && e.event_id != null)) {
    return { state: 'unreadable', reason: 'The next events could not be read. That is not the same as no events.' };
  }
  const rows = b.block.rows.map((e) => ({
    id: e.event_id,
    title: e.title,
    day: dayLabel(e.starts_at, e.timezone || 'UTC'),
    seats: seatsText(e),
    waiting: e.status === 'pending_review',
  }));
  return { state: 'ready', rows };
}

/**
 * The Jobs card: postings by status (a 100% bar), and the five with most
 * applications of all time, each with its days open — the Community read's
 * `jobs.by_status` and `jobs.most_applied` (#4717). A status count that is
 * missing or not a whole number makes the card unreadable, never 0.
 */

export function buildEventsFunnel(reads) {
  const out = {};
  const su = showUpOf(reads.overview);
  if (su.state !== 'ready') out.funnel = su;
  else {
    const { seats, attended, confirmed } = su;
    out.funnel = {
      state: 'ready',
      events: su.events,
      steps: [
        { key: 'registered', label: 'Registered', value: seats, share: seats > 0 ? 100 : 0 },
        confirmed == null
          ? { key: 'confirmed', label: 'Confirmed', value: null, note: 'Not in this read.' }
          : { key: 'confirmed', label: 'Confirmed', value: confirmed, share: pct(confirmed, seats) },
        { key: 'attended', label: 'Attended', value: attended, share: pct(attended, seats) },
      ],
    };
  }
  const wl = blockOf(reads.overview, 'events.waitlisted');
  const wc = wl.state === 'ready' ? countsAt(wl.block, ['registrations', 'events']) : null;
  out.waitlisted = wl.state !== 'ready' ? wl
    : wc ? { state: 'ready', value: wc.registrations, events: wc.events }
      : { state: 'unreadable', reason: FIGURE_UNREAD };
  const bt = blockOf(reads.overview, 'events.by_type');
  // #4717 package 3: the read counts all twelve types, zeros included; a type it leaves out is not a zero.
  const counts = bt.state === 'ready' ? countMap(bt.block.counts, EVENT_TYPES.map((t) => t.id)) : null;
  if (bt.state !== 'ready') out.byType = bt;
  else if (!counts) out.byType = { state: 'unreadable', reason: FIGURE_UNREAD };
  else {
    const rows = EVENT_TYPES.map((t) => ({ key: t.id, label: t.label, value: counts[t.id] }));
    const shown = rows.filter((r) => r.value > 0).sort((a, b) => b.value - a.value);
    const none = rows.filter((r) => r.value === 0);
    out.byType = { state: 'ready', shown, none, total: shown.reduce((t, r) => t + r.value, 0) };
  }
  return out;
}

/**
 * Who takes part: registrations and applications in the period, stacked by
 * profile. One part that failed is left out and named; both failing is
 * unreadable. A registration from an account that is gone is not given a
 * profile, and the card says how many.
 */
