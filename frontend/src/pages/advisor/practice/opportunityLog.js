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
 * @param {{status?: string, cancel_reason?: string|null, startsAt?: string|null,
 *          advisor_decision?: string|null, cancelled_by?: string|null}} view
 *   a booking already through `bookingView`.
 * @param {number} nowMs
 * @returns {'awaiting'|'accepted'|'declined'|'expired'|'withdrawn'|'unrecorded'}
 *
 * `no_show` counts as ACCEPTED, because it is: the advisor said yes and the
 * session was booked. What happened at the session belongs to Engagements, and
 * the row carries the detail so the log does not quietly upgrade a no-show
 * into a clean accept.
 *
 * #4702 (D4702): THE ADVISOR'S ANSWER IS A FACT OF ITS OWN. `advisor_decision`
 * records it when it is given, so a client cancelling an accepted session
 * afterwards is still an ACCEPT (it was accepted), and a request the client
 * withdrew before any answer is a withdrawal, not a decline. A cancelled row
 * from before the answer was recorded, with no `advisor_decision` and no
 * system reason, is `unrecorded`: it could be either, so it is left out of the
 * rate rather than counted as a decline.
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
    if (v.advisor_decision === 'accepted') return 'accepted';
    if (v.advisor_decision === 'declined') return 'declined';
    if (SYSTEM_CANCELS.has(String(v.cancel_reason || '')) || v.cancelled_by === 'system' || v.cancelled_by === 'client') return 'withdrawn';
    return 'unrecorded';
  }
  return 'withdrawn';
}

/**
 * The advisor's acceptance rate: accepted of the requests they ANSWERED, as a
 * whole percent, or null when none has been answered. Awaiting, expired,
 * withdrawn and unrecorded rows are not answers; a later client cancellation of
 * an accepted session does not make the accept a decline (`classifyBooking`).
 */
export function acceptanceRate(counts) {
  const decided = Number(counts?.accepted ?? 0) + Number(counts?.declined ?? 0);
  return decided > 0 ? Math.round((Number(counts.accepted) / decided) * 100) : null;
}

/**
 * #4714 (D4714): WHEN A ROW IS DATED BY ITS DECISION, AND WHEN IT IS NOT.
 * `advisor_decided_at` (D4702) is written when the advisor accepts or
 * declines; `updated_at` moves on every later edit, billing included. A row
 * shows "Decided" only from the first, and "Last changed" from the second.
 *
 * @param {{advisor_decided_at?: string|null, updated_at?: string|null}} raw
 * @returns {{kind: 'decided'|'changed', at: string}|null}
 */
export function decisionMoment(raw) {
  if (raw?.advisor_decided_at) return { kind: 'decided', at: String(raw.advisor_decided_at) };
  if (raw?.updated_at) return { kind: 'changed', at: String(raw.updated_at) };
  return null;
}

/**
 * The median time from request to the advisor's answer, over the rows whose
 * answer time is recorded. Rows answered before `advisor_decided_at` existed
 * carry none, so the result says how many answers it covers out of how many
 * were given; with none recorded the median is null, not zero.
 *
 * @param {Array<{created_at?: string|null, advisor_decision?: string|null, advisor_decided_at?: string|null}>} raws
 * @returns {{ms: number|null, counted: number, answered: number}}
 */
export function medianDecision(raws) {
  const spans = [];
  let answered = 0;
  for (const r of raws || []) {
    if (r?.advisor_decision !== 'accepted' && r?.advisor_decision !== 'declined') continue;
    answered += 1;
    const from = Date.parse(String(r.created_at || ''));
    const to = Date.parse(String(r.advisor_decided_at || ''));
    if (Number.isFinite(from) && Number.isFinite(to) && to >= from) spans.push(to - from);
  }
  if (!spans.length) return { ms: null, counted: 0, answered };
  spans.sort((a, b) => a - b);
  const mid = Math.floor(spans.length / 2);
  const ms = spans.length % 2 ? spans[mid] : Math.round((spans[mid - 1] + spans[mid]) / 2);
  return { ms, counted: spans.length, answered };
}

/** A span as the tile says it: minutes under an hour, hours under two days, else days. */
export function spanText(ms) {
  if (ms == null || !Number.isFinite(ms)) return null;
  const min = ms / 60000;
  if (min < 60) return `${Math.max(1, Math.round(min))} min`;
  const h = min / 60;
  if (h < 48) return `${Math.round(h)} h`;
  return `${Math.round(h / 24)} d`;
}
