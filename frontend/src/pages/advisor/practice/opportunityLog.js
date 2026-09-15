/**
 * Practice · Opportunities — the decision-log derivations, as pure functions.
 *
 * WHY THIS IS ITS OWN FILE AND IMPORTS NOTHING. Every interesting claim the
 * Opportunities artboard makes is DERIVED: no `expired` status exists, no
 * `decided_at` column exists, and two of the cancellations were written by the
 * worker rather than by the advisor. A wrong derivation does not throw — it
 * reports a different number with the same confidence — so it has to be
 * directly testable. Importing the page instead pulls React and a `.css`
 * through the component tree, which the test loader cannot resolve; the same
 * split `scripts/lib/assetRetention.mjs` uses, for the same reason.
 *
 * IT TAKES THE ADAPTED VIEW, NOT THE RAW BOOKING. `bookingView`
 * (`pages/advisor/advisory/kit.jsx`) is the shared slot/booking adapter that
 * task #6 created precisely to stop each caller re-deriving `startsAt` from
 * whichever of `scheduled_start` / `slot_starts_at` the payload happened to
 * carry. Re-reading those keys here would be a second copy of the contract
 * this codebase has already been bitten by twice.
 */

/**
 * The two `cancel_reason` values the WORKER writes, as opposed to one a person
 * typed. `routes/advisors.ts` writes `slot_cancelled` when the advisor
 * withdraws a whole slot and `capacity_race` when two people reach the last
 * seat. Neither is an answer to the request, so neither is a decline.
 */
export const SYSTEM_CANCELS = new Set(['slot_cancelled', 'capacity_race']);

/**
 * One booking's place in the decision log.
 *
 * @param {{status?: string, cancel_reason?: string|null, startsAt?: string|null}} view
 *   a booking already through `bookingView`.
 * @param {number} nowMs
 * @returns {'awaiting'|'accepted'|'declined'|'expired'|'withdrawn'}
 *
 * `no_show` counts as ACCEPTED, because it is: the advisor said yes and the
 * session was booked. What happened at the session belongs to Engagements, and
 * the row carries the detail so the log does not quietly upgrade a no-show
 * into a clean accept.
 */
export function classifyBooking(view, nowMs) {
  const v = view || {};
  const startsAt = v.startsAt ? Date.parse(v.startsAt) : NaN;
  // A request with no slot time cannot be shown to have expired, so it stays
  // answerable rather than being declared dead on a missing field.
  const started = Number.isFinite(startsAt) && startsAt <= nowMs;
  const status = String(v.status || '');
  if (status === 'pending') return started ? 'expired' : 'awaiting';
  if (status === 'confirmed' || status === 'completed' || status === 'no_show') return 'accepted';
  if (status === 'cancelled') {
    return SYSTEM_CANCELS.has(String(v.cancel_reason || '')) ? 'withdrawn' : 'declined';
  }
  return 'withdrawn';
}
