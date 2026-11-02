// D1553 (#3800, deck v2 C5) — Remix: four layouts for one card, and pd5's remove-a-block reflow.
// Worker: routes/deck_remix.ts, mounted at /api/decks.
//   POST /api/decks/:id/remix { card, remove? }
//     → { deck_id, current, card, options: [{ structure, label, line, card }] }
// No model, no hold, no charge: it answers with AI paused. It writes nothing; the editor applies an option.
// Read through `deckV2Adapter.remix`; no screen calls it directly.
import { request } from '../api.js';

export const deckRemixApi = {
  remix: (deckId, card, { remove } = {}) => request(`/decks/${encodeURIComponent(deckId)}/remix`, {
    method: 'POST',
    body: JSON.stringify(remove ? { card, remove } : { card }),
  }),
};
