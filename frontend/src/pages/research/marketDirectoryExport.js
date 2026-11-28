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
 * D7729 (#7729, canvas D7703-p2 RST-02): with a row open it also carries the
 * market into the form as an origin, after the question: `market` (the row's
 * slug), `sector` (its tracked sector; absent when it has none) and, from the
 * Market directory tab only, the `country` codes (repeatable), `fresh` and
 * `src` in force. The form then creates the project and its study together.
 * The question stays first, so the plain link is unchanged.
 *
 * EDIT THESIS opens Settings › My thesis, where the investor profile's thesis is
 * edited (the same place the thesis section links to).
 */

export const THESIS_EDIT = '/account/security-privacy#my-thesis';

/**
 * `/research/projects?new=1&question=…` — the New research form, the market
 * named. `origin` (optional) is `{ market, sector, country, fresh, src }`; a
 * missing slug carries no origin at all.
 */
export function newMarketResearchHref(question, origin = null) {
  const q = String(question || '').trim().slice(0, 1000);
  let tail = '';
  if (origin?.market) {
    const p = new URLSearchParams();
    p.set('market', origin.market);
    if (origin.sector) p.set('sector', origin.sector);
    for (const c of origin.country || []) p.append('country', c);
    if (origin.fresh) p.set('fresh', origin.fresh);
    if (origin.src) p.set('src', origin.src);
    tail = `&${p.toString().replace(/\+/g, '%20')}`;
  }
  return `/research/projects?new=1${q ? `&question=${encodeURIComponent(q)}` : ''}${tail}`;
}

/**
 * The origin New market research carries: the open row's slug and tracked
 * sector and, on the Market directory tab only, its filters. No open row
 * carries none (the search alone names the market).
 */
export function researchOrigin(view, items = []) {
  const open = view?.open ? (items || []).find((m) => m?.slug === view.open) : null;
  if (!open?.slug) return null;
  const directory = view.tab !== 'listed';
  return {
    market: open.slug,
    sector: open.mi_sector || null,
    country: directory ? [...(view.country || [])] : [],
    fresh: directory ? view.fresh || '' : '',
    src: directory ? view.src || '' : '',
  };
}

/** What New market research names: the open row's market, else the search, else nothing. */
export function researchSubject(view, items = []) {
  const open = view?.open ? (items || []).find((m) => m?.slug === view.open) : null;
  return open?.name || view?.q || '';
}
