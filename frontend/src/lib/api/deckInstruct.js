// D1521 (#3773, deck v2 A22) — an instruction on the grid selection: one quote, one hold, one proposal per area.
// Worker: routes/deck_instruct.ts, mounted at /api/decks. The client never sends a model, and the Worker
// refuses an instruction that names a figure (422 names_figure) before anything is quoted or held.
//   POST /api/decks/:id/areas/instruct/quote  { card, selection: [{ area_id, card_uid?, instruction? }],
//        instruction? | action? (shorten, expand, rewrite, more_visual), variants? | mode: 'compare' }
//        → the areas quote: { class, quote_uid, expires_at, hold_microusd, runs, refused, areas: [...] }
//   POST /api/decks/:id/areas/instruct        the same body + quote_uid, with an Idempotency-Key header
//        → { batch_uid, class, hold_microusd, replayed, selection, action, proposals: [proposal], refused: [...] }
//        409 quote_stale; 422 nothing_to_run. The proposals are read, accepted and discarded through deckAreasApi.
import { request } from '../api.js';

const enc = encodeURIComponent;
/** One key per press, so a retried request is the same run and is never charged twice. */
const newKey = () => `instruct-${typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;

export const deckInstructApi = {
  quote: (deckId, body) => request(`/decks/${enc(deckId)}/areas/instruct/quote`, { method: 'POST', body: JSON.stringify(body) }),
  run: (deckId, body, key = newKey()) => request(`/decks/${enc(deckId)}/areas/instruct`, { method: 'POST', body: JSON.stringify(body), headers: { 'Idempotency-Key': key } }),
};
