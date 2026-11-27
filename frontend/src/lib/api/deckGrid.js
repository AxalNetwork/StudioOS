// D1499 (#3749, deck v2 A2) — The Grid of one deck version.
// Worker: routes/deck_grid.ts, mounted at /api/decks.
//   GET /api/decks/:id/grid → { deck_id, version, aspect: '16:9' | '4:3', slide: { width, height },
//                               frame, cell, baseline, grid: { cols, rows },
//                               structures: [{ id, label, use, areas: [{ id, c1, c2, r1, r2, order, inset, align, role?, box }], background?, recommended? }],
//                               cards: [{ index, structure, derived, areas: [...] }] }
// A card saved before v2 reads `derived: true`: its areas come from its blocks.
// The geometry is gridModel.js's; this read says which structure and areas each card has.
import { request } from '../api.js';

export const deckGridApi = {
  grid: (deckId) => request(`/decks/${encodeURIComponent(deckId)}/grid`),
};
