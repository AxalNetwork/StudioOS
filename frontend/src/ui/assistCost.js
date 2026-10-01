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
 * A published UNIT RATE, at the precision it is published to.
 *
 * Neither of the two above will do. Cloudflare quotes per-1M-token rates to
 * three decimals ($0.293, $2.253, $0.030) and per-audio-minute rates to four
 * ($0.0005); `formatSpend`'s two places renders the first as $0.29 and the
 * second as $0.00, and a rate shown as $0.00 reads as free. `formatCost`'s
 * fixed four places renders $2.253 as $2.2530, which is not what the source
 * says either.
 *
 * So: three places, extended only as far as the first significant digit needs,
 * and trailing zeros beyond three trimmed so $0.00050 prints as $0.0005. The
 * rule is "print what the price list prints", not "round to something tidy".
 */
export function formatRate(n) {
  const v = Number(n ?? 0);
  if (!Number.isFinite(v) || v === 0) return '$0.000';
  // Widen until the printed figure reads back as the same number, so what is
  // shown IS the published rate and not a rounding of it. Three places is the
  // floor because that is how the per-1M-token table is written ($1.320, not
  // $1.32); beyond three, trailing zeros come off so $0.00050 prints as the
  // $0.0005 the audio table quotes.
  for (let places = Math.max(3, Math.ceil(-Math.log10(Math.abs(v))) + 1); places <= 12; places += 1) {
    const text = v.toFixed(places);
    if (Number(text) === v) return `$${places > 3 ? text.replace(/0+$/, '') : text}`;
  }
  return `$${v.toFixed(12).replace(/0+$/, '')}`;
}

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

/**
 * The lasting "Last run" receipt, as one line (D401).
 *
 * `lastRun` is `/api/ai/me/spend`'s `last_run`: the caller's most recent row
 * in `ai_usage_logs`, on ANY surface, so the caller labels it account-wide.
 * `name` is the display name for its model, if the rail has one.
 *
 * The token half says exactly what the log can support:
 *   - both counts            "812 in / 144 out"
 *   - a prompt count only    "300 in / out not recorded" (a streamed call)
 *   - neither                "tokens not recorded"
 *   - a cached answer        "cached, no model called"
 *   - a refusal              "refused, nothing run"
 * and never "0 in / 0 out", which would read as a very small run. The Worker
 * nulls every zero it cannot vouch for; a response from before that change
 * carries no token fields at all and lands on "tokens not recorded".
 *
 * Returns null for no run, so the caller decides what an absence looks like.
 */
export function lastRunReceipt(lastRun, name) {
  if (!lastRun || typeof lastRun !== 'object') return null;
  const model = name || String(lastRun.model || '').split('/').pop() || 'Unknown model';
  const isCount = (v) => typeof v === 'number' && Number.isFinite(v) && v > 0;
  let tokens;
  if (lastRun.refusal) tokens = 'refused, nothing run';
  else if (lastRun.cached) tokens = 'cached, no model called';
  else if (isCount(lastRun.prompt_tokens) && isCount(lastRun.completion_tokens)) {
    tokens = `${lastRun.prompt_tokens.toLocaleString('en-US')} in / ${lastRun.completion_tokens.toLocaleString('en-US')} out`;
  } else if (isCount(lastRun.prompt_tokens)) {
    tokens = `${lastRun.prompt_tokens.toLocaleString('en-US')} in / out not recorded`;
  } else tokens = 'tokens not recorded';
  const cost = typeof lastRun.cost_usd === 'number' && Number.isFinite(lastRun.cost_usd)
    ? formatCost(lastRun.cost_usd)
    : 'cost not recorded';
  const parts = [model, tokens, cost];
  if (lastRun.fallback_used && !lastRun.cached && !lastRun.refusal) parts.push('a smaller model answered');
  return parts.join(' · ');
}

/**
 * "This page this month" as one sentence, from `by_surface` (D404).
 *
 * `unattributed` is the month's runs with no recorded page. They are said
 * rather than left out whenever this page shows none, because some of them
 * may be this page's own runs from before migration 319 — so "nothing from
 * this page" alone would be a claim the log cannot make.
 */
export function pageSpendLine(bySurface, pagePath) {
  const rows = Array.isArray(bySurface) ? bySurface : [];
  const mine = rows.find((r) => r && r.surface === pagePath && pagePath);
  const unattributed = rows.find((r) => r && r.surface == null);
  if (mine && mine.calls > 0) {
    return `This page this month: ${formatCost(mine.spend_usd)} over ${mine.calls} run${mine.calls === 1 ? '' : 's'}.`;
  }
  if (unattributed && unattributed.calls > 0) {
    const n = unattributed.calls;
    return `No runs recorded from this page this month. ${n} run${n === 1 ? '' : 's'} this month carr${n === 1 ? 'ies' : 'y'} no page, either from before pages were recorded or from features that do not record one.`;
  }
  return 'No runs from this page this month.';
}
