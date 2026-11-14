// D4268 (#4268, D4254 P2a) — Script & rehearsal › Script: the whole-deck script and its notes-only save.
// Worker: routes/deck_script.ts over services/decks/script.ts.
//   POST /api/decks/:id/script/quote  { length_s?, audience?, tone?, cards? }
//        → { ai: true, hold_microusd, model, count, length_s, pace: { wpm, source, rehearsal_at, pitch_seconds }, targets }
//          | { ai: false, reason, message }
//   POST /api/decks/:id/script        (same body; `Idempotency-Key` optional)
//        → { proposal, deck_id, version, length_s, audience, tone, pace,
//            cards: [{ card_uid, index, budget_s, target_words, notes, words, model }], failed: [{ card_uid, index, reason }],
//            hold_microusd, charged_microusd, stopped? }
//   PUT  /api/decks/:id/notes-script  { notes: [{ card_uid, notes }] }  (`If-Match: <version>` optional)
//        → { deck, saved } | { unchanged: true, deck_id }; 409 deck_version_conflict
// One hold for the whole run, each card its own run under it; a card whose draft names a
// figure not on its card fails and costs nothing. Nothing is saved until Save script.
import { request } from '../api.js';

const at = (deckId, tail) => `/decks/${encodeURIComponent(deckId)}${tail}`;
const json = (method, body, headers) => ({ method, body: JSON.stringify(body), ...(headers ? { headers } : {}) });

export const deckScriptApi = {
  scriptQuote: (deckId, body) => request(at(deckId, '/script/quote'), json('POST', body)),
  script: (deckId, body, headers) => request(at(deckId, '/script'), json('POST', body, headers)),
  saveScript: (deckId, notes, version) => request(at(deckId, '/notes-script'), json('PUT', { notes }, version != null ? { 'If-Match': String(version) } : null)),
};
