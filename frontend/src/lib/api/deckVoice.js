// D1569 (#3816, deck v2 D8) — an AI voice-over per card, always labelled "AI voice".
// Worker: routes/deck_voice.ts over services/decks/cardAudio.ts.
//   POST /api/decks/:id/cards/:card/voice/quote        → { ai, model, job, hold_microusd, chars, label, balance } | { ai: false, reason, message }
//   POST /api/decks/:id/cards/:card/voice              → { proposal: { uid }, card_uid, model, label, chars, url, hold_microusd, charged_microusd }
//   POST /api/decks/:id/voice/:proposal/accept         → { deck }: a new version whose card carries the voice
//   POST /api/decks/:id/voice/:proposal/discard        → { discarded: true }
//   GET  /api/decks/:id/voice                          → { model: { id, name, label }, cards: [{ card_uid, url }] }
// Nothing is saved on the deck until Accept.
import { request } from '../api.js';

const enc = encodeURIComponent;
const post = (path) => request(path, { method: 'POST', body: '{}' });

export const deckVoiceApi = {
  quote: (deckId, cardUid) => post(`/decks/${enc(deckId)}/cards/${enc(cardUid)}/voice/quote`),
  make: (deckId, cardUid) => post(`/decks/${enc(deckId)}/cards/${enc(cardUid)}/voice`),
  accept: (deckId, proposalUid) => post(`/decks/${enc(deckId)}/voice/${enc(proposalUid)}/accept`),
  discard: (deckId, proposalUid) => post(`/decks/${enc(deckId)}/voice/${enc(proposalUid)}/discard`),
  read: (deckId) => request(`/decks/${enc(deckId)}/voice`),
};
