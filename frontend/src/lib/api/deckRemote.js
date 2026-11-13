// D1581 (#3828, deck v2 F2) — the phone remote for Present, paired by code.
// Worker: routes/deck_remote.ts, mounted at /api/decks before `decks`; the room is DeckRemote.
//   POST   /api/decks/:id/remote/pair → { deck_id, code, expires_at }: six digits, ten minutes, one join.
//   GET    /api/decks/:id/remote      → { deck_id, code_live, paired, presenting }
//   DELETE /api/decks/:id/remote      → { ok, deck_id }
//   POST   /api/decks/remote/join     { code } → { deck_id, remote_id, expires_at }; 404 code_not_found
//   POST   /api/decks/:id/remote/step { remote_id, step } → { ok, delivered }; step is next | prev | first | last
//          or { card: n }. 409 remote_not_paired once a new code or Unpair ended this remote.
//   GET    /api/decks/:id/remote/ws: Present's socket (`bearer.<jwt>` subprotocol), frames hello · paired · unpaired · step.
// Every route is 503 remote_off on a Worker without the DECK_REMOTE binding.
// The pairing screen and the phone remote are not drawn yet (#3828, needs-design).
import { request } from '../api.js';

const deckPath = (deckId) => `/decks/${encodeURIComponent(deckId)}`;

export const deckRemoteApi = {
  pair: (deckId) => request(`${deckPath(deckId)}/remote/pair`, { method: 'POST' }),
  state: (deckId) => request(`${deckPath(deckId)}/remote`),
  unpair: (deckId) => request(`${deckPath(deckId)}/remote`, { method: 'DELETE' }),
  join: (code) => request('/decks/remote/join', { method: 'POST', body: JSON.stringify({ code }) }),
  step: (deckId, remoteId, step) => request(`${deckPath(deckId)}/remote/step`, { method: 'POST', body: JSON.stringify({ remote_id: remoteId, step }) }),
};
