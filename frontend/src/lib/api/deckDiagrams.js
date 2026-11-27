// D1542 (#3780, deck v2 B4) — a diagram on a card, checked in code when a founder edits its nodes on the canvas.
// Worker: routes/deck_diagrams.ts, mounted at /api/decks. Free: no model runs and nothing is saved.
//   POST /api/decks/:id/diagrams/check  { diagram, grid, card? }
//        → { diagram, type, fits, problems: [{ kind, message }], figures, steps: { min, max } | null }
// Generating a diagram (Flow, Cycle, Matrix) is the `grid_diagram` job, run through Generate into areas
// (`deckAreas.js`, D1512) and proposed until Accept.
import { request } from '../api.js';

const enc = encodeURIComponent;

export const deckDiagramsApi = {
  check: (deckId, { diagram, grid, card } = {}) => request(`/decks/${enc(deckId)}/diagrams/check`, {
    method: 'POST', body: JSON.stringify({ diagram, grid, ...(Number.isInteger(card) ? { card } : {}) }),
  }),
};
