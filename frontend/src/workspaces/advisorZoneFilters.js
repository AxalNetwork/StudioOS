import { makeZoneFilters } from './zoneFilterBuilder.js';

/**
 * The advisor profile's filter tables — the left half of the zone header row.
 *
 * EMPTY, AND THAT IS THE STATE RATHER THAN AN OVERSIGHT. The advisor licence
 * serves eight zones that carry a `filters:` array on a canvas —
 * `/network/{relationships,introductions,organizations}` and
 * `/research/{ask,client-prep,markets,companies,library}` — and every one of
 * them is listed in `profile_zone_filters.test.mjs`'s `excluded` set with the
 * reason it is not here yet. The table fills one bucket at a time; the guard is
 * what keeps that honest, because an exclusion cannot grow by accident and a
 * stale one cannot linger.
 *
 * WHERE THE LABELS WILL COME FROM. `design/incoming/Pages · Advisor
 * {Network,Research}.dc.html`, verbatim and in the canvas's own order. Advisor
 * and partner canvases ship from `design/incoming/` rather than
 * `design/canvases/integrated/`, which is why the guard grew a `canvasDirs`
 * hook — `profile_zone_actions.test.mjs` has carried the same one since the
 * advisor Expertise bucket landed there.
 *
 * TWO ZONES WILL NEVER BE HERE, and the reason is not the same as "not yet".
 * `network/organizations` is a dashed card whose entire body is the gap
 * statement — an advisor is 403'd from `/api/contacts` and no other store
 * carries a person-to-organisation edge, so `ORG_BACKED` in
 * `NetworkWorkspace.jsx` is `['founder', 'investor']` and there is nothing for
 * a filter to narrow. A row over that page would be four controls above a
 * sentence saying the page has no rows.
 */
export const ADVISOR_ZONE_FILTERS = {};

export const advisorZoneFilters = makeZoneFilters(ADVISOR_ZONE_FILTERS);
