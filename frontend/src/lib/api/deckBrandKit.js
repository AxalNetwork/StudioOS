// D1562 (#3809, deck v2 D1) — the deck brand kit's writer and Apply brand.
// Worker: routes/deck_brand_kit.ts over services/decks/brandKit.ts. The kit
// itself is read through deckEditorApi.brandKit (GET /api/decks/brand-kit),
// which carries these fields under `kit.deck`, the fonts a kit may name as
// `font_options`, and the one-click `pick`.
//   PUT  /api/decks/brand-kit?project_id=   { fonts: { display, body }, palette: { ground, ink, accent, secondary, highlight },
//        image_style: 'photo' | 'illustration' | 'screenshot', references: [image uid ≤3], logo_uid }
//        → { project_id, deck }   422 font_not_offered · 422 image_not_kept { image_uid }
//   POST /api/decks/:id/apply-brand
//        → { deck, adjustments: [sentence], one_undo_step: true }   409 no_brand_kit · 409 contrast · 503 unreadable
import { request } from '../api.js';

export const deckBrandKitApi = {
  save: (projectId, kit) => request(`/decks/brand-kit?project_id=${encodeURIComponent(projectId)}`, { method: 'PUT', body: JSON.stringify(kit) }),
  applyBrand: (deckId) => request(`/decks/${encodeURIComponent(deckId)}/apply-brand`, { method: 'POST' }),
};
