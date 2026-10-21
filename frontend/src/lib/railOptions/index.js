/**
 * D772 (#2098), the Research PR — the option a SHARED control names to the
 * rail, looked up per profile.
 *
 * `AskZone`, `LibraryZone` and `DiligenceRoom` render on more than one
 * profile's Research board, and each profile's inventory keys the same control
 * its own way (the investor's re-index is `reindex:document`, the founder's
 * `upload:reindex`). A shared zone cannot pass one literal, so it passes its
 * own control instead and this helper reads the key from the inventory of the
 * page the member is on (S1, 2026-10-19: option A). No inventory changes.
 *
 *   railOptionFor(pageKey, { file, control })  →  { key, label } | null
 *
 *   pageKey  D768's page key, from `useRailPage()?.page`;
 *   file     the zone, under `frontend/src/` (`pages/research/AskZone.jsx`);
 *   control  the band's `surface` (`research/ask`) for a draft band, else
 *            `ask`, `upload` or `reindex` for the API call it makes.
 *
 * Null when the profile lists no such row on that page. A draft band then
 * keeps D770's `draft:<surface>`; any other control names nothing.
 *
 * The control is read from each row's own source marker: a `surface="…"`
 * band, an `api.research.ask|upload|reindex(` call, or the advisor's and
 * partner's `type="file"` for an upload. D773 (#2099) adds the two shared
 * components the advisor and the partner reach with keys of their own: the
 * Eadwyn interview's send (`api.advisor.answer|toolAuto(`, control
 * `advisor.ask`) and Competitor analysis's runs (`api.competitors.<verb>(`,
 * control `competitors.<verb>`).
 */
import { pageKeyFor } from '../railPages.js';
import { FOUNDER_OPTIONS } from './founder.js';
import { INVESTOR_RAIL_OPTIONS } from './investor.js';
import { ADVISOR_RAIL_OPTIONS } from './advisor.js';
import { PARTNER_RAIL_OPTIONS } from './partner.js';

/** The control a source marker names, or null. */
export function controlOf(marker) {
  const m = String(marker || '');
  const surface = /surface="([^"]+)"/.exec(m)?.[1];
  if (surface) return surface;
  const call = /api\.research\.(ask|upload|reindex)\(/.exec(m)?.[1];
  if (call) return call;
  if (/api\.advisor\.(answer|toolAuto)\(/.test(m)) return 'advisor.ask';
  const competitors = /api\.competitors\.(analyze|rerun|refresh|addCandidate)\(/.exec(m)?.[1];
  if (competitors) return `competitors.${competitors}`;
  // D778 part 12: Explain is distinct from the shared Studio send control.
  if (/api\.advisor\.explainUrl\(|openTutor\(/.test(m)) return 'explain';
  return m === 'type="file"' ? 'upload' : null;
}

const fileOf = (f) => String(f || '').replace(/^frontend\/src\//, '');

/**
 * Every row of the four member inventories as `{ page, file, control, key,
 * label }`, one per place it lives. The advisor's and partner's rows name
 * their module alone, so their page key comes from their route.
 */
function flatten() {
  const rows = [];
  const add = (page, file, marker, o) => {
    const control = controlOf(marker);
    if (page && control) rows.push({ page, file: fileOf(file), control, key: o.key, label: o.label });
  };
  for (const o of FOUNDER_OPTIONS) for (const [file, marker] of o.at || []) add(o.page, file, marker, o);
  for (const o of INVESTOR_RAIL_OPTIONS) add(o.page, o.source?.file, o.source?.match, o);
  for (const [profile, list] of [['Advisor', ADVISOR_RAIL_OPTIONS], ['Operating Partner', PARTNER_RAIL_OPTIONS]]) {
    for (const o of list) {
      const [path, query] = String(o.route || '').split('?');
      add(pageKeyFor(path, profile, { search: query ? `?${query}` : '' }), o.source?.file, o.source?.marker, o);
    }
  }
  return rows;
}

let ROWS = null;

/** The row a shared control names on a page, or null. See above. */
export function railOptionFor(pageKey, { file, control } = {}) {
  if (!pageKey || !file || !control) return null;
  ROWS ||= flatten();
  const hit = ROWS.find((r) => r.page === pageKey && r.file === file && r.control === control);
  return hit ? { key: hit.key, label: hit.label } : null;
}
