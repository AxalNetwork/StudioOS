// D1561 (#3808, deck v2 C13) — the ⋯ menu's whole-deck actions.
// Worker: routes/deck_actions.ts over services/decks/deckActions.ts.
//   POST /api/decks/:id/reorder-for-stage     { stage?, investor_type? }
//        → { deck, stage, stage_label, stage_source, moved, one_undo_step: true }
//          | { unchanged: true, stage, stage_label, stage_source, moved: 0 }
//   POST /api/decks/:id/check/wording/quote   → { ai: true, hold_microusd, model } | { ai: false, reason, message }
//   POST /api/decks/:id/check/wording         → { state: 'ok', findings: [{ key, kind, label, card_index, quote, message }], cost }
//                                              | { state: 'off', message }
// Reorder for stage is free and saves one new version (one undo step). Check
// wording is charged only when pressed; `headers` is the press's rail context.
import { request } from '../api.js';

const enc = encodeURIComponent;
const post = (path, body, headers) => request(path, { method: 'POST', body: JSON.stringify(body || {}), ...(headers ? { headers } : {}) });

export const deckActionsApi = {
  reorderForStage: (deckId, body) => post(`/decks/${enc(deckId)}/reorder-for-stage`, body),
  wordingQuote: (deckId) => post(`/decks/${enc(deckId)}/check/wording/quote`, {}),
  wording: (deckId, headers) => post(`/decks/${enc(deckId)}/check/wording`, {}, headers),
};
