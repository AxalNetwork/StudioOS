/**
 * D704 (#1666, decision 1): where the three retired Validate pages land.
 *
 * `/validate/interviews`, `/validate/pain-map` and `/validate/hypotheses`
 * stop being pages (D-b). A bookmark or an emailed link lands on the module
 * that holds the feature now, with the rest of the query and the hash kept.
 * Only the Interviews page's `?new=` opener is translated: `record` is Record
 * a session's own route, `notes` and `upload` are #1659's `?log=` opener on
 * Customer research, and any other value is dropped.
 *
 * Pure, so the table is tested without a router. PR 2 mounts it through
 * `ValidateZoneRedirect` in `App.jsx`; until then nothing calls it.
 */

/** The retired page's slug → the module that holds it now. */
export const VALIDATE_ZONE_TARGETS = Object.freeze({
  interviews: '/validate/customer-research',
  'pain-map': '/validate/problem-discovery',
  hypotheses: '/validate/experiments',
});

/** `?new=` on the Interviews page → `?log=` on Customer research (#1659). */
const LOG_OPENERS = new Set(['notes', 'upload']);

/**
 * `{ pathname, search, hash }` for a retired page, or null for a slug that is
 * not one. `search` and `hash` are the location's own, with or without their
 * leading `?` and `#`; the result carries them with theirs, or as ''.
 */
export function validateZoneTarget(zone, search = '', hash = '') {
  if (!Object.hasOwn(VALIDATE_ZONE_TARGETS, zone)) return null;
  const params = new URLSearchParams(String(search || '').replace(/^\?/, ''));
  let pathname = VALIDATE_ZONE_TARGETS[zone];
  if (zone === 'interviews' && params.has('new')) {
    const opener = params.get('new');
    params.delete('new');
    if (opener === 'record') pathname = '/validate/record';
    else if (LOG_OPENERS.has(opener)) params.set('log', opener);
  }
  const query = params.toString();
  const fragment = String(hash || '').replace(/^#/, '');
  return { pathname, search: query ? `?${query}` : '', hash: fragment ? `#${fragment}` : '' };
}
