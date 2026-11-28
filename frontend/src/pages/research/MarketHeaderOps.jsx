import { readMarketQuery } from './marketDirectoryQuery.js';
import { THESIS_EDIT, newMarketResearchHref, researchOrigin, researchSubject } from './marketDirectoryExport.js';

/**
 * D7171 part 2 (#7171, canvas D7036, RMD-01 and RMD-08 headers) — the page's
 * side of the Markets header ops. The per-licence tables declare them as
 * `kind: 'handler'`; this hook supplies them:
 *
 *   newMarketResearch  My Research's New research form, the market named (founder);
 *                      with a row open it carries the market as the study's
 *                      origin (D7729, RST-02)
 *   editThesis         Settings › My thesis (investor)
 *
 * Export view is the tables' `kind: 'export'`, which the zone header runs as
 * D7172's scoped export of the active tab (`view.scoped`), not a handler here.
 *
 * `read` is what the directory panel reports through `onRead`: its rows name
 * the open market.
 */
export function useMarketHeaderOps({ read, params, navigate }) {
  const view = readMarketQuery(params);
  const items = read?.data?.items || [];
  const subject = researchSubject(view, items);
  const origin = researchOrigin(view, items);
  const handlers = {
    newMarketResearch: {
      onClick: () => navigate(newMarketResearchHref(subject, origin)),
      title: origin ? `Opens New research in My Research, started from ${subject}.`
        : subject ? `Opens New research in My Research with ${subject} named.` : 'Opens New research in My Research.',
    },
    editThesis: { onClick: () => navigate(THESIS_EDIT), title: 'Opens My thesis in Settings, where your investor thesis is edited.' },
  };
  return { handlers };
}
