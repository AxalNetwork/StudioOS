// D1552 (#3799, deck v2 C4) — ⋯ › Whole deck · uses AI › Fix with critique.
// Worker: routes/deck_critique.ts, mounted at /api/decks.
//   POST /api/decks/:id/critique/quote → { ai: true, cards, score, rubric, findings, fixes: { count, per_microusd, microusd },
//        vision: { available, reason, family, writer_family, cards, per_card_microusd, microusd }, hold_microusd }
//        | { ai: false, reason, message }
//   POST /api/decks/:id/critique { vision? } → { score_before, score, score_if_accepted, threshold, rubric, findings,
//        fixes: [{ proposal_uid, card, card_uid, check, before, after }], what_we_fixed, not_fixed, vision, charged_microusd }
// Each fix is a rail proposal on `deck:shorten`, offered with Accept in the Ask's "Waiting for you" sheet.
import { request } from '../api.js';

const enc = encodeURIComponent;

export const deckCritiqueApi = {
  quote: (deckId) => request(`/decks/${enc(deckId)}/critique/quote`, { method: 'POST', body: '{}' }),
  run: (deckId, { vision = true } = {}) => request(`/decks/${enc(deckId)}/critique`, { method: 'POST', body: JSON.stringify({ vision }) }),
};
