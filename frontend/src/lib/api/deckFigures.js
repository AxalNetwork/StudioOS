// D1523 (#3775, deck v2 A24) — the provenance of every figure on a deck version.
// Worker: routes/deck_figures.ts, mounted at /api/decks.
//   GET /api/decks/:id/figures → { deck_id, figures: [{ card, block_id, kind, label, at, state, value, source, figures? }],
//                                 counts: { linked, stated, uncited, not_recorded } }
// The editor's alone: Present, share links and exports never call it. A missing figure is not_recorded, never 0.
import { request } from '../api.js';

export const deckFiguresApi = {
  list: (deckId) => request(`/decks/${encodeURIComponent(deckId)}/figures`),
};
