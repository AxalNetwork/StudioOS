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
 * in `ai_usage_logs` — on any page from the account read, or on one page from
 * the `?surface=` read (D552) — and the caller labels it for which it is.
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
 * The page paths the router records as a run's `surface` (D552 step 3).
 *
 * The same pattern as `SURFACE_RE` in `cloudflare-worker/src/services/
 * aiRouter.ts`, which a test holds byte-for-byte equal. A path outside it is
 * stored as NULL by the router and refused by `/api/ai/me/spend?surface=`, so
 * the rail does not ask for it: that page's runs are among the month's
 * unattributed ones, and the rail says so instead of showing a failed read.
 */
export const RECORDABLE_PAGE_RE = /^\/[A-Za-z0-9/_.-]{0,159}$/;

/** True when the router would record runs on `path` against that path. */
export function isRecordablePage(path) {
  return typeof path === 'string' && RECORDABLE_PAGE_RE.test(path);
}

/**
 * "This page this month" as one sentence, from `/api/ai/me/spend?surface=`
 * (D552). `report` is that read's body, already known to have `recorded: true`.
 *
 * "No run on this page yet" is said only when the page's last-run read came
 * back with none; with runs before this month, or a last run that could not
 * be read, "yet" would be a claim, so the month alone is said. Either way,
 * the month's runs that carry no page are named beside a zero, for D404's
 * reason: some may be this page's own, from before pages were recorded.
 */
export function pageMonthLine(report) {
  const calls = Number(report?.month?.calls) || 0;
  if (calls > 0) {
    return `This page this month: ${formatCost(report.month.spend_usd)} over ${calls} run${calls === 1 ? '' : 's'}.`;
  }
  const never = report?.last_run_recorded === true && !report?.last_run;
  let line = never ? 'No run on this page yet.' : 'No run on this page this month.';
  const n = Number(report?.unattributed?.calls) || 0;
  if (n > 0) {
    line += ` ${n} run${n === 1 ? '' : 's'} this month carr${n === 1 ? 'ies' : 'y'} no page, either from before pages were recorded or from features that do not record one.`;
  }
  return line;
}

/**
 * The month split by page, from `by_surface` (D552 step 3): the `limit`
 * costliest pages, this page among them wherever it ranks, and the remainder
 * folded into one `rest` total so the rows still add up to the month.
 *
 * The NULL group is its own row, labelled as runs with no page, and never
 * matches the current page.
 */
export function splitByPage(bySurface, pagePath, limit = 5) {
  const all = (Array.isArray(bySurface) ? bySurface : [])
    .filter((r) => r && Number(r.calls) > 0)
    .map((r) => ({
      surface: r.surface ?? null,
      label: r.surface ?? 'No page recorded',
      calls: Number(r.calls) || 0,
      spend_usd: Number(r.spend_usd) || 0,
      current: !!pagePath && r.surface === pagePath,
    }))
    .sort((a, b) => b.spend_usd - a.spend_usd || b.calls - a.calls);
  const shown = all.slice(0, limit);
  const mine = all.find((r) => r.current);
  if (mine && !shown.includes(mine)) shown.splice(shown.length - 1, 1, mine);
  const hidden = all.filter((r) => !shown.includes(r));
  const rest = hidden.length
    ? {
      pages: hidden.length,
      calls: hidden.reduce((n, r) => n + r.calls, 0),
      spend_usd: hidden.reduce((n, r) => n + r.spend_usd, 0),
    }
    : null;
  return { rows: shown, rest };
}
