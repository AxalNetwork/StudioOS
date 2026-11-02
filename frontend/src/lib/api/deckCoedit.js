// D1577 (#3824, deck v2 E4) — co-editing a deck.
// Worker: routes/deck_coedit.ts, mounted at /api/decks before `decks`.
//   PATCH /api/decks/:id/cards/:uid/areas/:area { base, next } → { ok, rev, saved, card? }
//         409 area_conflict { rev, server }: another member changed this area; nothing saved.
//         Two members on different areas of one card both keep their edit.
//   POST  /api/decks/:id/restore-card { card_uid } → the new current version, with
//         `restored: { card_uid, from_version, placed, index }`; every other card is left as it is.
//   GET   /api/decks/:id/presence → { deck_id, editors: [{ user_id, name, colour, card, area, cursor }] }
//         503 presence_off until the owner approves the Durable Object's cost (decision L).
//   GET   /api/decks/:id/presence/ws: the editors' socket (WebSocket, `bearer.<jwt>` subprotocol).
import { request } from '../api.js';

const deckPath = (deckId) => `/decks/${encodeURIComponent(deckId)}`;

export const deckCoeditApi = {
  saveArea: (deckId, uid, area, base, next) => request(`${deckPath(deckId)}/cards/${encodeURIComponent(uid)}/areas/${encodeURIComponent(area)}`, {
    method: 'PATCH',
    body: JSON.stringify({ base: base ?? null, next }),
  }),
  restoreCard: (versionId, cardUid) => request(`${deckPath(versionId)}/restore-card`, {
    method: 'POST',
    body: JSON.stringify({ card_uid: cardUid }),
  }),
  presence: (deckId) => request(`${deckPath(deckId)}/presence`),
};
