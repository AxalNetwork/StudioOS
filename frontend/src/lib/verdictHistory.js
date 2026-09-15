/**
 * Reading the verdict history the board now carries — in one place, because
 * three chips in two zones ask three versions of the same question.
 *
 * WHAT CHANGED UNDER THEM (#175, migration 255). A claim's verdict is derived
 * from its evidence on every request and stored nowhere, so `As of last week`,
 * `Changed this month` and `Recently moved` had nothing to stand on and were
 * registered `unbuilt`, which since #180 renders a DISABLED chip whose only
 * explanation is a hover title — inert rather than invisible, and still a
 * control that cannot answer the question it names.
 * `hypothesis_verdict_history` records each
 * observed change of the derived `{verdict, lane}` pair, and the board returns
 * it per claim as `history` plus a project-level `verdict_history_since`.
 *
 * THE TIMESTAMP NEEDS PARSING, NOT COMPARING. SQLite's `datetime('now')`
 * produces `2026-09-14 11:20:00` — a space, no zone. Comparing that to an ISO
 * string lexicographically is wrong in a way that looks right most of the time:
 * `'T'` sorts after `' '`, so `'2026-09-14 11:20:00' < '2026-09-07T00:00:00Z'`
 * is TRUE, and a window would silently include everything. The values are UTC,
 * so they are parsed as UTC here and compared as instants.
 *
 * NOTHING IS BACKFILLED, and every predicate below refuses rather than guesses
 * when the record does not reach far enough back. A claim whose history starts
 * on Tuesday cannot answer "what did this say last week"; showing today's
 * verdict under that heading would be a confident wrong answer, which is the
 * failure the `unbuilt` reason was protecting against in the first place.
 */

/** "Recently", in days, named once so the chip's label and its rule agree. */
export const RECENTLY_MOVED_DAYS = 14;

/** SQLite's `datetime('now')` is UTC with a space. Parse, never compare raw. */
export function parseObserved(value) {
  if (!value) return null;
  const s = String(value);
  const iso = s.includes('T') ? s : `${s.replace(' ', 'T')}Z`;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** `n` days before `now`, as a Date. */
export const daysBefore = (now, n) => new Date(now.getTime() - n * 86400000);

/** The first instant of `now`'s calendar month, in UTC. */
export const startOfMonth = (now) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

/**
 * True when the project's record reaches back to `at`.
 *
 * `since` is the earliest observation on record for the whole project. A window
 * that opens before it cannot be answered for any claim, and the page says so
 * rather than drawing an empty result as if it meant "nothing changed".
 */
export function historyReaches(since, at) {
  const start = parseObserved(since);
  return !!(start && start.getTime() <= at.getTime());
}

/** The observation in force at `at`, or null when the record starts later. */
export function observationAt(history, at) {
  let found = null;
  for (const o of history || []) {
    const when = parseObserved(o.observed_at);
    if (!when || when.getTime() > at.getTime()) continue;
    found = o;  // ordered oldest-first by the route, so the last match wins
  }
  return found;
}

/**
 * What this claim's verdict was at `at`.
 *
 * Returns `{ known: false }` when the claim has no observation that old — NOT
 * the current verdict. The caller's job is then to leave the claim out and say
 * why, which is the whole difference between a time-travel view and a relabelled
 * copy of today.
 */
export function verdictAsOf(claim, at) {
  const o = observationAt(claim?.history, at);
  return o ? { known: true, verdict: o.verdict ?? null, lane: o.lane } : { known: false };
}

/**
 * True when `field` changed between two consecutive observations, and the later
 * of the two is inside the window.
 *
 * NOT "differs from what it was at `since`", which is the shape this started as
 * and which quietly refuses the most interesting case: a claim first observed
 * three days ago that moved lane yesterday HAS moved this week, and asking what
 * it was a fortnight ago answers `known: false`. A change is an adjacent pair
 * that disagrees; the window is about WHEN the change happened, not about how
 * far back the record reaches.
 *
 * The first observation is never a change. It is the claim appearing on the
 * record, and counting it would report every claim as recently moved for as long
 * as the record is younger than the window.
 */
function changedWithin(claim, since, field) {
  const h = claim?.history || [];
  for (let i = 1; i < h.length; i += 1) {
    if (h[i]?.[field] === h[i - 1]?.[field]) continue;
    const when = parseObserved(h[i].observed_at);
    if (when && when.getTime() >= since.getTime()) return true;
  }
  return false;
}

/** True when the claim's verdict changed inside the window. */
export const verdictChangedSince = (claim, since) => changedWithin(claim, since, 'verdict');

/**
 * True when the claim's LANE changed inside the window.
 *
 * Lane, not verdict, and that is the point of the third chip: a claim moves from
 * `none` to `testing` the moment its first supporting interview lands, with no
 * verdict change at all. "Recently moved" is about the board's columns, so it
 * asks about columns.
 */
export const laneChangedSince = (claim, since) => changedWithin(claim, since, 'lane');
