// D1562 (#3809, deck v2 D1) — the deck brand kit: fonts (Google Fonts under the OFL only), logo,
// palette roles, image style, reference images and an image library; and Apply brand.
// Worker: GET in routes/decks.ts, PUT and apply-brand in routes/deck_brand_kit.ts, all at /api/decks.
//   GET  /api/decks/brand-kit?project_id=  → { project_id, kit: { …, roles, font_pair, image_style, references, library, pick } | null }
//   PUT  /api/decks/brand-kit?project_id=  { fonts, logo_url, palette, image_style, library } → { project_id, kit }
//   POST /api/decks/:id/apply-brand        { cards, theme } → { deck_id, theme, cards, changed, tokens, problems, reason, adjustments }
// Apply brand runs no model and writes nothing: the editor applies its answer as one edit, one undo step.
import { request } from '../api.js';

export const deckBrandKitApi = {
  read: (projectId) => request(`/decks/brand-kit?project_id=${encodeURIComponent(projectId)}`),
  save: (projectId, kit) => request(`/decks/brand-kit?project_id=${encodeURIComponent(projectId)}`, {
    method: 'PUT',
    body: JSON.stringify(kit || {}),
  }),
  apply: (deckId, { cards, theme } = {}) => request(`/decks/${encodeURIComponent(deckId)}/apply-brand`, {
    method: 'POST',
    body: JSON.stringify(cards ? { cards, theme: theme ?? null } : {}),
  }),
};
