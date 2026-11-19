/**
 * D7171 part 2 (#7171, canvas D7036, boards RMD-01, RMD-08, RMD-11, RMD-13) —
 * where the Markets header's New market research and Edit thesis ops go.
 *
 * EXPORT VIEW IS NOT HERE. The header's Export view is D7172's scoped export
 * (`useDirectoryExport` in `MarketDirectoryZone.jsx`, `marketExport` and
 * `collectMarkets` in `listedCompaniesRead.js`): the same label, click and
 * file as the control beside the active tab's count. One export path.
 *
 * NEW MARKET RESEARCH opens My Research's existing New research form
 * (`?new=1&question=`, D5157) with the market named: the open row's market, or
 * the search when no row is open. It creates nothing by itself.
 *
 * EDIT THESIS opens Settings › My thesis, where the investor profile's thesis is
 * edited (the same place the thesis section links to).
 */

export const THESIS_EDIT = '/account/security-privacy#my-thesis';

/** `/research/projects?new=1&question=…` — the New research form, the market named. */
export function newMarketResearchHref(question) {
  const q = String(question || '').trim().slice(0, 1000);
  return `/research/projects?new=1${q ? `&question=${encodeURIComponent(q)}` : ''}`;
}

/** What New market research names: the open row's market, else the search, else nothing. */
export function researchSubject(view, items = []) {
  const open = view?.open ? (items || []).find((m) => m?.slug === view.open) : null;
  return open?.name || view?.q || '';
}
