/**
 * #9024 (owner Q18=b on #3723) — who may open the Grow › Distribution pages,
 * in a module the Worker reads too.
 *
 * `routes/growDistribution.jsx` admits every `/grow/distribution/...` tab with
 * `guard(['admin', 'founder'], …)`, and `App.jsx`'s RoleGuard admits a reader
 * by `guardAdmits` (`lib/activeRole.js`, D4473): the role they browse as, or a
 * licence they hold, is in that list. The Calendar shows a venture's Grow items
 * to any accepted member, an advisor included, so the Worker gives an item a
 * link to those pages only when this same rule admits its reader; everyone
 * else still sees the item, with no link.
 *
 * The route file keeps its literal list, because the route scanners under
 * `frontend/test/` read `guard([...])` as written. `GROW_DISTRIBUTION_ROLES`
 * is that list, and `frontend/test/calendar_grow_links_9024.test.mjs` reads
 * the route file and fails if any of its guards differs from it.
 */
import { guardAdmits } from './activeRole.js';

export const GROW_DISTRIBUTION_ROLES = Object.freeze(['admin', 'founder']);

/** Whether a reader with this role and these held licences may open `/grow/distribution/...`. */
export function opensGrowDistribution(role, held = []) {
  return guardAdmits(GROW_DISTRIBUTION_ROLES, String(role || '').toLowerCase(), Array.isArray(held) ? held : []);
}
