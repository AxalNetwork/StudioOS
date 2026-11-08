/**
 * D4473 (#4473, part 2 of #3704) — ONE SIDEBAR, THE UNION OF HELD LICENCES.
 *
 * The owner's rule: there is no licence switcher. A member who holds several
 * licences sees all their sections in one left sidebar, in licence order
 * Founder, Investor, Advisor, Operating Partner. Shared sections (Studio,
 * Spin-Out Lab) appear once, at the top; Trust, Network and Research are always
 * the bottom; Portfolio and Companies never appear (they live in the Account
 * menu, D4416).
 *
 * Pure: no React, no storage. The rows are not copied. Each is taken BY `to`
 * from the per-role blocks in `sidebarConfig.js` (`SIDEBAR_GROUPS`), which stay
 * the row source, so an icon, `match` list or tier lock changed there changes
 * here. A shared row is taken from the primary licence's block when it has one,
 * then from the held licences in order, then from any licence block.
 */
import { SIDEBAR_GROUPS } from '../sidebarConfig.js';

export const LICENCE_ORDER = Object.freeze(['founder', 'investor', 'advisor', 'partner']);

/** The shared head, once, before any licence's own rows. */
const HEAD = Object.freeze(['/studio', '/spinout-lab']);
/** Each licence's own rows, by `to`, in sidebar order. */
export const LICENCE_ROWS = Object.freeze({
  founder: Object.freeze(['/validate', '/build', '/raise', '/grow']),
  investor: Object.freeze(['/deals', '/spinout-lab/investor-workspace', '/funds']),
  advisor: Object.freeze(['/practice', '/cohorts', '/expertise']),
  partner: Object.freeze(['/pipeline', '/delivery', '/offers']),
});
/** The fixed bottom, for every member. */
const FOOT = Object.freeze(['/trust/me', '/network', '/research']);
/** Never in this sidebar, for any licence (rule 4). */
const NEVER_TO = Object.freeze(['/portfolio', '/account/portfolio', '/account/companies']);
const NEVER_LABEL = Object.freeze(['Portfolio', 'Companies']);

/** Whether a value is one of the four licences. */
export const isLicence = (v) => LICENCE_ORDER.includes(v);

/** The held set, filtered to the four licences and in licence order; `[primaryRole]` when that is all there is. */
export function orderedLicences(licences, primaryRole) {
  const held = new Set((Array.isArray(licences) ? licences : []).map((l) => String(l || '').toLowerCase()));
  const out = LICENCE_ORDER.filter((l) => held.has(l));
  if (out.length) return out;
  return isLicence(primaryRole) ? [primaryRole] : [];
}

function rowsOf(role) {
  return (SIDEBAR_GROUPS[role] || []).flatMap((g) => g.items || []);
}

/**
 * `{ key: 'home', label: '', licenceShell: true, items }`, one flat group in the
 * `SIDEBAR_GROUPS` shape, or `null` when no licence is held. `licenceShell` tells
 * `withDiligenceRow` and `withInfluencerRow` to place their rows before Trust.
 */
export function buildLicenceSidebar(licences, { primaryRole } = {}) {
  const held = orderedLicences(licences, primaryRole);
  if (!held.length) return null;
  const lookup = [...new Set([...(isLicence(primaryRole) ? [primaryRole] : []), ...held, ...LICENCE_ORDER])];
  const find = (to) => {
    for (const role of lookup) {
      const row = rowsOf(role).find((r) => r.to === to);
      if (row) return row;
    }
    return null;
  };
  const wanted = [...HEAD, ...held.flatMap((l) => LICENCE_ROWS[l]), ...FOOT];
  const seen = new Set();
  const items = [];
  for (const to of wanted) {
    if (seen.has(to) || NEVER_TO.includes(to)) continue;
    const row = find(to);
    if (!row || NEVER_LABEL.includes(row.label)) continue;
    seen.add(to);
    items.push(row);
  }
  return { key: 'home', label: '', licenceShell: true, items };
}

export default buildLicenceSidebar;
