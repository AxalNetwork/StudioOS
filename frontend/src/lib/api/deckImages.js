// D903 (#2682, part 9 of #2434) — images for the deck's cards and backgrounds (PD12–PD12e).
// Worker: routes/deck_images.ts over services/decks/images.ts.
//   POST /api/decks/:id/images/quote   { use, description, style, palette, aspect, count, card?, points?, colours? }
//        → { ai: true, models, model_label, per_image_microusd, count, total_microusd, balance } | { ai: false, reason, message }
//   POST /api/decks/:id/images         (same body) → { images: [image], stopped? }
//   POST /api/decks/:id/images/upload  multipart: file, use, card?, alt?, shows_person?, consent? → { image }
//   GET  /api/decks/:id/images         the venture's kept images → { images }
//   POST /api/decks/images/:uid/keep   { use?, overlay?, ink?, alt? } → { image }
//   POST /api/decks/images/:uid/discard
// A real person (422 `real_person`), a figure and a chart are refused before
// anything is quoted or held; the balance before the hold (402). Nothing
// reaches a card until Keep places it and Save writes the version.
// `headers` on the run is the press's own rail context (`railPressHeaders`).
import { request } from '../api.js';

const enc = encodeURIComponent;
const post = (path, body, headers) => request(path, { method: 'POST', body: JSON.stringify(body ?? {}), ...(headers ? { headers } : {}) });

export const deckImagesApi = {
  quote: (deckId, body) => post(`/decks/${enc(deckId)}/images/quote`, body),
  generate: (deckId, body, headers) => post(`/decks/${enc(deckId)}/images`, body, headers),
  list: (deckId) => request(`/decks/${enc(deckId)}/images`),
  keep: (uid, body) => post(`/decks/images/${enc(uid)}/keep`, body),
  discard: (uid) => post(`/decks/images/${enc(uid)}/discard`),
  /** `fields`: { use, card?, alt?, shows_person?, consent? }; the file goes as multipart. */
  upload: (deckId, file, fields = {}) => {
    const form = new FormData();
    form.append('file', file);
    for (const [k, v] of Object.entries(fields)) if (v !== undefined && v !== null) form.append(k, typeof v === 'boolean' ? (v ? '1' : '0') : String(v));
    return request(`/decks/${enc(deckId)}/images/upload`, { method: 'POST', body: form });
  },
};
