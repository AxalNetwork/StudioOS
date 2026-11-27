/**
 * D4820 (#4820) — When Community, or one of its modules, has nothing to draw: the empty-Community rule and the zero-data collapses, so a module says what it has or what to do next instead of drawing zero charts.
 *
 * Pure: nothing here fetches. Every rule here answers "empty" only from
 * figures that were read. A block that could not be read, is still loading or
 * is not recorded is never taken for an empty one (unreadable is not zero).
 */
import { blockOf, count, countsAt } from './read.js';
import { circlesOf, rosterOf } from './people.js';
import { expertsOf } from './wellbeing.js';

const allZero = (o) => Boolean(o) && typeof o === 'object' && !Array.isArray(o)
  && Object.values(o).every((v) => count(v) === 0);

/**
 * CM04a: a genuinely empty Community. True only when the Community read
 * answered and every source below was read and holds nothing:
 *   - events: every status counted at zero (`events.by_status`), so no
 *     draft, waiting, published or cancelled event exists;
 *   - jobs: every posting status at zero (`jobs.by_status`);
 *   - circles: none (`circles.total`);
 *   - the advisors and partners roster: no active and no hidden row of any
 *     kind (`network.by_kind_state`);
 *   - wellbeing: no listed expert (`wellbeing.experts`) and no booking in
 *     this period or the one before (`wellbeing.bookings`).
 * If any of these is loading, unreadable or not recorded, the answer is false:
 * the page never claims an empty Community it could not see.
 */
export function isEmptyCommunity(reads) {
  const ev = blockOf(reads?.overview, 'events.by_status');
  const jb = blockOf(reads?.overview, 'jobs');
  const bk = blockOf(reads?.overview, 'wellbeing.bookings');
  const ci = circlesOf(reads || {});
  const ro = rosterOf(reads || {});
  const ex = expertsOf(reads?.overview);
  if ([ev, jb, bk, ci, ro, ex].some((s) => s.state !== 'ready')) return false;
  const booked = countsAt(bk.block, ['window', 'previous']);
  if (!booked) return false;
  return allZero(ev.block.counts)
    && allZero(jb.block.by_status)
    && ci.total === 0
    && ro.rows.every((r) => r.active === 0 && r.inactive === 0)
    && ex.verified + ex.unverified + ex.hidden + ex.inactive === 0
    && booked.window === 0 && booked.previous === 0;
}

/** A weekly chart with no activity: read, and every week of every series it draws is zero or not recorded. */
export function activityEmpty(activity) {
  return activity?.state === 'ready'
    && activity.chart.series.every((s) => s.values.every((v) => v === null || v === 0));
}

/** The funnel with nothing to draw: read, and no event ended in the period or none of them had a seat taken. */
export function funnelEmpty(funnel) {
  return funnel?.state === 'ready' && (funnel.events === 0 || funnel.steps[0].value === 0);
}

/**
 * The Events card with nothing at all: Next up, the funnel, the waitlists and
 * events by type were each read and each is empty. One of them unreadable is
 * not empty: that part says so instead.
 */
export function eventsEmpty(next, ev) {
  return next?.state === 'ready' && next.rows.length === 0
    && funnelEmpty(ev?.funnel)
    && ev.waitlisted?.state === 'ready' && ev.waitlisted.value === 0
    && ev.byType?.state === 'ready' && ev.byType.shown.length === 0;
}

/** The job board with no posting in any status. */
export function jobsEmpty(jobs) {
  return jobs?.state === 'ready' && jobs.total === 0;
}

/** No circle at all. */
export function circlesEmpty(circles) {
  return circles?.state === 'ready' && circles.total === 0;
}

/** No advisor, partner or investor on the roster, active or hidden. */
export function rosterEmpty(roster) {
  return roster?.state === 'ready' && roster.rows.every((r) => r.active === 0 && r.inactive === 0);
}

/** No listed wellbeing expert in any state. */
export function expertsEmpty(experts) {
  return experts?.state === 'ready' && experts.total === 0;
}

/** No expert booking in the period: the window counts none and no week holds one. */
export function bookingsEmpty(bookings) {
  return bookings?.state === 'ready' && bookings.window === 0 && bookings.rows.every((r) => !r.value);
}
