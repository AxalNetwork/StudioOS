/**
 * D777 part 4 (#2102): which run filled a field and what it cost, in one line.
 *
 * The Worker answers a fill's `run` from the `ai_usage_logs` row that produced
 * it (D777 part 2, D762): `{ usage_log_id, rail_page, rail_option,
 * charged_microusd, est_cost_usd }`, or `null` when the fill names no run or the
 * row cannot be read. `null` reads "Not recorded", never a zero cost; a read
 * from before the field existed (`undefined`) says nothing at all.
 */

/** A cost in dollars, with enough places that a fraction of a cent is not $0.00. */
export function runCost(dollars) {
  const n = Number(dollars);
  if (dollars == null || !Number.isFinite(n) || n < 0) return null;
  return `$${n.toFixed(n > 0 && n < 0.01 ? 4 : 2)}`;
}

/** The run's line for a fill, or null when the read carries no `run` field. */
export function fillRunLine(run) {
  if (run === undefined) return null;
  if (run === null) return 'Run: not recorded';
  const what = run.rail_option || run.rail_page || `usage row ${run.usage_log_id}`;
  // What the member was charged, when it is settled; the estimate otherwise.
  const charged = run.charged_microusd != null ? runCost(Number(run.charged_microusd) / 1e6) : null;
  const cost = charged
    ? `charged ${charged}`
    : (runCost(run.est_cost_usd) ? `estimated ${runCost(run.est_cost_usd)}` : 'cost not recorded');
  return `Run: ${what} · ${cost}`;
}
