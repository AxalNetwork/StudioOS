/**
 * D777 part 4 (#2102): which run filled a field and what it cost, in one line.
 *
 * The Worker answers a fill's `run` from the `ai_usage_logs` row that produced
 * it (D777 part 2, D762): `{ usage_log_id, rail_page, rail_option,
 * charged_microusd, est_cost_usd }`, or `null` when the fill names no run or the
 * row cannot be read. `null` reads "Not recorded", never a zero cost; a read
 * from before the field existed (`undefined`) says nothing at all.
 */

import { FOUNDER_OPTIONS } from './railOptions/founder.js';
import { INVESTOR_RAIL_OPTIONS } from './railOptions/investor.js';
import { ADVISOR_RAIL_OPTIONS } from './railOptions/advisor.js';
import { PARTNER_RAIL_OPTIONS } from './railOptions/partner.js';

const OPTIONS = [...FOUNDER_OPTIONS, ...INVESTOR_RAIL_OPTIONS, ...ADVISOR_RAIL_OPTIONS, ...PARTNER_RAIL_OPTIONS];

/**
 * D1324 (#3485): the words on the control a run came from, never its key. The
 * key (`form:landing`, `fill:market`) is an internal name; the member pressed
 * "Auto-fill with AI". A key on more than one page is matched by its page; a
 * key no inventory lists has no label, and the line names the page instead.
 */
export function optionLabel(page, key) {
  if (!key) return null;
  const rows = OPTIONS.filter((o) => o.key === key);
  const hit = rows.find((o) => o.page === page) || (rows.length === 1 ? rows[0] : null);
  return hit?.label || null;
}

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
  // The control's label, else the page; never the option key or a usage row's id.
  const what = optionLabel(run.rail_page, run.rail_option) || run.rail_page || 'an Eadwyn run';
  // What the member was charged, when it is settled; the estimate otherwise.
  const charged = run.charged_microusd != null ? runCost(Number(run.charged_microusd) / 1e6) : null;
  const cost = charged
    ? `charged ${charged}`
    : (runCost(run.est_cost_usd) ? `estimated ${runCost(run.est_cost_usd)}` : 'cost not recorded');
  return `Run: ${what} · ${cost}`;
}
