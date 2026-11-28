/**
 * D9072 (#9072, D6158 Q1 = A) — who opens `/deals/closing`, and which rounds
 * each reader sees there. Pure, so the zone, the workspace and their test
 * share one answer, and it agrees with the Worker's `closingWorkspaceRefusal`
 * (cloudflare-worker/src/services/dealClosingAccess.ts).
 *
 *   admin     every round at closing; acts as before.
 *   investor  the rounds they are related to, as `scope=mine` serves them; unchanged.
 *   partner   only the rounds they lead (`deals.lead_partner_id`): the list is
 *             narrowed to those, and a round led by anyone else, or by no one,
 *             opens a refusal instead of the workspace.
 *
 * The route guard admits these three roles (`CLOSING_ROLES`), and no other.
 */

/** The roles the `/deals/closing` route guard admits (App.jsx). */
export const CLOSING_ROLES = Object.freeze(['admin', 'partner', 'investor']);

/** The sentence a partner reads on a round they do not lead, the Worker's `not_your_closing`. */
export const NOT_YOUR_CLOSING = 'Only the round’s lead Operating Partner or an Admin opens this closing workspace.';

/** The partner's empty list: no round at closing is theirs to lead. */
export const NO_LED_ROUND = 'You lead no round at closing. A round you lead appears here once it reaches closing.';

/** The closing record is the studio team's read; an Operating Partner reads none (D1213, CP19). */
export const CLOSING_RECORD_NOT_READ = 'The closing record is the studio team’s. An Operating Partner does not read it, so its deadline, total, lines and close rules are not shown here.';

const id = (v) => {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
};

/** Does this user lead the round? A round with no lead is led by no one. */
export function leadsRound(user, deal) {
  const me = id(user?.id);
  const lead = id(deal?.lead_partner_id);
  return me !== null && lead !== null && me === lead;
}

/** The deals this reader's closing list shows: a partner's are the rounds they lead; anyone else's as served. */
export function closingDealsFor(user, deals) {
  if (!Array.isArray(deals)) return deals;
  if (user?.role !== 'partner') return deals;
  return deals.filter((d) => leadsRound(user, d));
}

/**
 * May this reader open the workspace for `deal`? `deal` is undefined while the
 * list is read, so the answer waits (`pending`) rather than refusing early.
 * An admin and an investor are not narrowed here: the investor's reads are
 * scoped at their routes, as before.
 */
export function closingSeat(user, deal) {
  const role = user?.role;
  if (role === 'admin') return 'admin';
  if (role === 'investor') return 'investor';
  if (role !== 'partner') return 'refused';
  if (deal === undefined) return 'pending';
  return leadsRound(user, deal) ? 'lead' : 'refused';
}
