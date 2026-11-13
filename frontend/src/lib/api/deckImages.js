// D903 (#2682, part 9 of #2434) — images for the deck's cards and backgrounds (PD12–PD12e).
// Worker: routes/deck_images.ts over services/decks/images.ts.
//   POST /api/decks/:id/images/quote   { use, description, style, palette, aspect, count, card?, points?, colours? }
//        → { ai: true, models, model_label, per_image_microusd, count, total_microusd, balance } | { ai: false, reason, message }
//   POST /api/decks/:id/images         (same body) → { images: [image], stopped? }
//   POST /api/decks/:id/images/upload  multipart: file, use, card?, alt?, shows_person?, consent? → { image }
//   GET  /api/decks/:id/images         the venture's kept images → { images }
//   GET  /api/decks/:id/images/plan    D903 §10, read by D1604's one-click (#3716): whether this Worker
//        can draw, the deck's one art direction, and the cards an illustration helps
//        → { capability, direction, cards: [{ index, card, description, style, palette, use }] }
//   POST /api/decks/images/:uid/keep   { use?, overlay?, ink?, alt? } → { image }
//   POST /api/decks/images/:uid/discard
//   POST /api/decks/:id/images/replace-all/quote   D1561 (#3808): every image area as one quote
//        → { ai, count, total_microusd, hold_microusd, areas, left_out, balance }
//   POST /api/decks/:id/images/replace-all         `Idempotency-Key` → { images, refused, left_out, hold_microusd, charged_microusd, stopped? }
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
  plan: (deckId) => request(`/decks/${enc(deckId)}/images/plan`),
  keep: (uid, body) => post(`/decks/images/${enc(uid)}/keep`, body),
  discard: (uid) => post(`/decks/images/${enc(uid)}/discard`),
  replaceAllQuote: (deckId, body) => post(`/decks/${enc(deckId)}/images/replace-all/quote`, body),
  replaceAll: (deckId, body, headers) => post(`/decks/${enc(deckId)}/images/replace-all`, body, headers),
  /** `fields`: { use, card?, alt?, shows_person?, consent? }; the file goes as multipart. */
  upload: (deckId, file, fields = {}) => {
    const form = new FormData();
    form.append('file', file);
    for (const [k, v] of Object.entries(fields)) if (v !== undefined && v !== null) form.append(k, typeof v === 'boolean' ? (v ? '1' : '0') : String(v));
    return request(`/decks/${enc(deckId)}/images/upload`, { method: 'POST', body: form });
  },
};
