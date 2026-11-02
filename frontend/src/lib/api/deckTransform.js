// D1560 (#3807, deck v2 C12) — AI beyond one card.
// Worker: routes/deck_transform.ts over services/decks/transform.ts.
//   POST /api/decks/:id/transform/quote  { action, cards?, language? }
//        → { action, option, ai: true, hold_microusd, model, warning? } | { action, option, ai: false, reason, message }
//   POST /api/decks/:id/transform        (same body)
//        → { proposal, action, option, cards: [{ card_uid, index, notes?: { before, after }, blocks?: [{ id, before, after }] }], dropped, warning?, cost }
// `action`: speaker_notes, proofread, fix_slide (one card) or translate (with `language`).
// A deck with no words is refused 422 `nothing_to_change`; an answer with nothing
// that may be placed is 422 `nothing_proposed`, charged for the run.
// Nothing is saved: Accept places the proposal, Save writes the version.
// `headers` on the run is the press's own rail context (`railPressHeaders`).
import { request } from '../api.js';

const enc = encodeURIComponent;
const post = (path, body, headers) => request(path, { method: 'POST', body: JSON.stringify(body), ...(headers ? { headers } : {}) });

export const deckTransformApi = {
  quote: (deckId, body) => post(`/decks/${enc(deckId)}/transform/quote`, body),
  run: (deckId, body, headers) => post(`/decks/${enc(deckId)}/transform`, body, headers),
};
