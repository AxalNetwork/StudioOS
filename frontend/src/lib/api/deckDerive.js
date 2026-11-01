// D1583 (#3830, deck builder v2 F4) — a teaser, a one-pager and a memo from one deck version.
// Worker: routes/deck_derive.ts, mounted at /api/decks.
//   POST /api/decks/:id/derive/quote        { format, blind } → { format, option, ai, hold_microusd, model }
//                                           | { format, option, ai: false, reason, message }
//   POST /api/decks/:id/derive              { format, blind } → { proposal, format, blind, title, cards? | memo?, figures, dropped?, cost? }
//   POST /api/decks/:id/derive/:uid/accept  → { derivative }   stores it and accepts the proposal together
//   GET  /api/decks/:id/derivatives         → { derivatives: [{ uid, format, blind, title, created_at }] }
//   GET  /api/decks/derivatives/:uid        → { derivative: { …, cards | memo, figures } }
// `format` is 'teaser' | 'one_pager' | 'memo'. A press is a proposal; nothing is stored until Accept.
// The memo's model is the AIRail's pick for `derive:memo`: no request names one.
import { request } from '../api.js';

const enc = encodeURIComponent;
const post = (path, body) => request(path, { method: 'POST', body: JSON.stringify(body ?? {}) });

export const deckDeriveApi = {
  quote: (deckId, { format, blind = false }) => post(`/decks/${enc(deckId)}/derive/quote`, { format, blind: blind === true }),
  derive: (deckId, { format, blind = false }) => post(`/decks/${enc(deckId)}/derive`, { format, blind: blind === true }),
  accept: (deckId, uid) => post(`/decks/${enc(deckId)}/derive/${enc(uid)}/accept`),
  list: (deckId) => request(`/decks/${enc(deckId)}/derivatives`),
  get: (uid) => request(`/decks/derivatives/${enc(uid)}`),
};
