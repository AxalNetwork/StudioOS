// D1541 (#3779, deck v2 B3) — the elements library a card's decor draws from.
// Worker: routes/deck_elements.ts, mounted at /api/decks.
//   GET /api/decks/elements → { licence: { id, name, version, spdx, url, copyright, derived }, decor_max,
//        icons: { total }, shapes, dividers, textures: [{ kind, ref, label, svg }], generate: { available: false, reason } }
//   GET /api/decks/elements/icons?q=&offset=&limit= → { total, offset, icons: [{ kind, ref, label, svg }], licence }
// Every svg is drawn by the Worker and has passed its sanitiser; its colours are the theme's tones.
import { request } from '../api.js';

export const deckElementsApi = {
  library: () => request('/decks/elements'),
  icons: ({ q = '', offset = 0, limit = 60, refs = null } = {}) => {
    const p = new URLSearchParams();
    if (refs) p.set('refs', refs.join(','));
    if (q) p.set('q', q);
    if (offset) p.set('offset', String(offset));
    p.set('limit', String(limit));
    return request(`/decks/elements/icons?${p.toString()}`);
  },
};
