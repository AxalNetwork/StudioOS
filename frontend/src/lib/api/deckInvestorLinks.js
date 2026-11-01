// D1565 (#3812, deck builder v2 D4) — one link per investor, and tailored
// variants. The studio reads these through `pages/raise/pitch/deckV2Adapter.js`
// (`investorLinks`, `withdrawInvestorLink`).
// Worker: routes/deck_investor_links.ts, migration 738.
//   GET  /api/decks/:id/investor-links                    → { deck_id, version, links: [Row] }
//   POST /api/decks/:id/investor-links                    { prospect_id | investor_label, expires_days, view_limit, nda_required, include?, variant_uid? } → 201 { link, share_path }
//   POST /api/decks/:id/investor-links/:shareId/withdraw  → { ok, link }: the link no longer opens; its analytics are kept
//   GET  /api/decks/:id/variants                          → { variants }
//   POST /api/decks/:id/variants                          { name, prospect_id?, thesis, slide_order? } → 201 { variant }
import { request } from '../api.js';

const enc = encodeURIComponent;

export const deckInvestorLinksApi = {
  investorLinks: (deckId) => request(`/decks/${enc(deckId)}/investor-links`),
  createInvestorLink: (deckId, body) => request(`/decks/${enc(deckId)}/investor-links`, { method: 'POST', body: JSON.stringify(body) }),
  withdrawInvestorLink: (deckId, shareId) => request(`/decks/${enc(deckId)}/investor-links/${enc(shareId)}/withdraw`, { method: 'POST', body: '{}' }),
  deckVariants: (deckId) => request(`/decks/${enc(deckId)}/variants`),
  createDeckVariant: (deckId, body) => request(`/decks/${enc(deckId)}/variants`, { method: 'POST', body: JSON.stringify(body) }),
};
