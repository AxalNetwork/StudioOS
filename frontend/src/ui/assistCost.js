/**
 * The one piece of arithmetic the AI rail canvases care most about.
 *
 * All 8 rail canvases (AIRail, InvRail, AdminRail, AdvRail, PartnerRail,
 * DetailRail, EmberRail, ForgeRail) ship a byte-identical
 * `const c4 = (n) => '$' + n.toFixed(4)` and six of them carry the same comment
 * insisting the pre-run ESTIMATE and the post-run RECEIPT come from one
 * calculation. Two functions drifting apart is exactly how a user is quoted one
 * price and shown another, so there is one function here and both callers use it.
 *
 * Token counts are absolute; prices are per 1M tokens, which is how every canvas
 * and every model price list states them.
 */

/** Format a cost the way every rail canvas does: 4 decimal places. */
export const formatCost = (n) => `$${Number(n ?? 0).toFixed(4)}`;

/** Format a spend meter figure — whole cents, for the monthly totals. */
export const formatSpend = (n) => `$${Number(n ?? 0).toFixed(2)}`;

/**
 * Cost of one run. `cachedIn` (a lower per-1M input price) applies to the input
 * side only — output is never cached, which is why the canvases quote it
 * separately rather than discounting the whole run.
 */
export function runCost({ tin = 0, tout = 0, pin = 0, pout = 0, cachedIn } = {}, { cached = false } = {}) {
  const inputPrice = cached && cachedIn != null ? cachedIn : pin;
  return (tin / 1_000_000) * inputPrice + (tout / 1_000_000) * pout;
}

/**
 * A batch of N runs, optionally weighted per operation. `costFactor` lets a
 * cheaper assist (a re-check, say) cost a fraction of the headline run without
 * inventing a second RunProfile for it.
 */
export function batchCost(profile, ops = []) {
  if (!ops.length) return runCost(profile);
  return ops.reduce((sum, op) => sum + runCost(profile) * (op.costFactor ?? 1), 0);
}

/**
 * Spend meter state. Returns the fraction used, clamped to [0,1] for the bar
 * width, plus the unclamped ratio so a caller can tell "at cap" from "over cap"
 * — the bar should never render past its track, but the copy should be honest.
 */
export function spendMeter(spent = 0, cap = 0) {
  const ratio = cap > 0 ? spent / cap : 0;
  return { ratio, fraction: Math.max(0, Math.min(1, ratio)), over: ratio > 1 };
}
