import { readMarketQuery } from './marketDirectoryQuery.js';
import { THESIS_EDIT, newMarketResearchHref, researchSubject } from './marketDirectoryExport.js';

/**
 * D7171 part 2 (#7171, canvas D7036, RMD-01 and RMD-08 headers) — the page's
 * side of the Markets header ops. The per-licence tables declare them as
 * `kind: 'handler'`; this hook supplies them:
 *
 *   newMarketResearch  My Research's New research form, the market named (founder)
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
  const subject = researchSubject(view, read?.data?.items || []);
  const handlers = {
    newMarketResearch: {
      onClick: () => navigate(newMarketResearchHref(subject)),
      title: subject ? `Opens New research in My Research with ${subject} named.` : 'Opens New research in My Research.',
    },
    editThesis: { onClick: () => navigate(THESIS_EDIT), title: 'Opens My thesis in Settings, where your investor thesis is edited.' },
  };
  return { handlers };
}
