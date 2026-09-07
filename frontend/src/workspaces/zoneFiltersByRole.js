import { founderZoneFilters } from './founderZoneFilters';
import { investorZoneFilters } from './investorZoneFilters';
import { partnerZoneFilters } from './partnerZoneFilters';
import { advisorZoneFilters } from './advisorZoneFilters';

/**
 * The zone FILTER row for a surface that serves more than one licence — the
 * left half of the row `zoneActionsByRole.js` fills the right half of.
 *
 * `/network/*` and `/research/*` are two components answering four roles, and
 * the canvases prove the labels are per licence rather than shared:
 * `/network/relationships` is `Everyone · Investors · Advisors · Going cold`
 * for a founder and `Everyone · Founders · Co-investors · LPs · Going cold` for
 * an investor. `/network/introductions` is the sharper case — the SAME four
 * labels in a different order — so even a zone where the licences agree on
 * vocabulary cannot share one table without breaking the canvas-order rule the
 * guard enforces.
 *
 * AN UNKNOWN ROLE GETS AN EMPTY LIST, NEVER A DEFAULT PROFILE'S. Its sibling
 * makes this argument for actions and it is stronger here. A founder's
 * `Investors / Advisors` segmentation shown to an advisor reading their own
 * book would not merely be a dead control: it would be a claim about how their
 * relationships are classified, made in the product's own voice, over rows that
 * are classified some other way. `ZoneToolbar` already defaults `role` to
 * `'founder'` for the accent chip, which is the same leak in miniature and is
 * why every non-founder mount has to name its licence.
 *
 * WHY THE BODY CALLS THIS AND NOT THE WORKSPACE. Actions reach a shared body as
 * a one-argument render prop, because an action needs only the rows on screen.
 * A filter needs `value` and `onChange`, which are the body's own state, so the
 * workspace passes a BOUND BUILDER — `zoneFilters={(opts) =>
 * zoneFiltersFor(role, 'research/markets', opts)}` — and the body calls it with
 * its state. The zone key stays with the workspace, which knows the route; the
 * predicate stays with the body, which knows the rows.
 */
const BY_ROLE = {
  founder: founderZoneFilters,
  investor: investorZoneFilters,
  partner: partnerZoneFilters,
  advisor: advisorZoneFilters,
};

export function zoneFiltersFor(role, key, opts) {
  const fn = BY_ROLE[role];
  return fn ? fn(key, opts) : [];
}
