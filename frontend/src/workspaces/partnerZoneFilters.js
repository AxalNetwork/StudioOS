import { makeZoneFilters } from './zoneFilterBuilder.js';

/**
 * The partner profile's filter tables — the left half of the zone header row.
 *
 * EMPTY, AND THAT IS THE STATE RATHER THAN AN OVERSIGHT, for the same reason
 * `advisorZoneFilters.js` is: the seven partner zones that carry a `filters:`
 * array on a canvas are each listed in `profile_zone_filters.test.mjs`'s
 * `excluded` set with a reason, and move into this table one bucket at a time.
 *
 * WHERE THE LABELS WILL COME FROM. `design/incoming/Pages · Partner
 * {Network,Research}.dc.html`, verbatim and in the canvas's own order. Note
 * that the Research canvas names `/research/market` where the router and
 * `shellConfig.js` both say `markets`; the guard's `live()` hook does that
 * translation and already carries this exact mapping for the ops half.
 *
 * `network/organizations` will never be here. `NetworkPage` catches a slug it
 * has no tab for and suppresses every body, so that route already renders its
 * own heading above a card stating the gap — a filter row would be four
 * controls above a sentence explaining that there is nothing to filter.
 */
export const PARTNER_ZONE_FILTERS = {};

export const partnerZoneFilters = makeZoneFilters(PARTNER_ZONE_FILTERS);
