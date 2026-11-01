// D1524 (#3776, deck v2 A25) — the AIRail's plain usage meter for one deck.
// Worker: routes/deck_usage.ts, mounted at /api/decks.
//   GET /api/decks/:id/usage → { deck_id, project_id,
//        estimated: { available: true, value_microusd, lines } | { available: false, reason },
//        spent: { available: true, value_microusd, runs } | { available: false, reason },
//        units: { text_area_microusd, image_microusd } }
// `estimated` is the same quote lines GET …/element-models prices (#3754's estimateDeck);
// a figure that cannot be read is { available: false }, never $0.00. Read only: it runs no model.
import { request } from '../api.js';

export const deckUsageApi = {
  usage: (deckId) => request(`/decks/${encodeURIComponent(deckId)}/usage`),
};
