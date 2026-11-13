// D1501 (#3751, deck v2 A9) — a deck version's working copy, card by card.
// Worker: routes/deck_draft.ts, mounted at /api/decks (migration 715).
//   PATCH  /api/decks/:id/cards/:uid  { card, ord? } with If-Match: <rev> (0 for a card's first copy)
//          → { ok, deck_id, card: { uid, ord, rev, updated_at, card } }
//          409 card_rev_conflict { rev, server }: another tab or member changed it; 428 without If-Match.
//   GET    /api/decks/:id/draft → { deck_id, version, rev, updated_at, cards: [{ uid, ord, rev, updated_at, card }] }
//   DELETE /api/decks/:id/draft → { ok, deck_id, discarded }
//   PUT    /api/decks/:id/draft-doc { order, theme, audience } with If-Match: <rev> (0 for the first) → { ok, deck_id, doc }
//          D4596: the cards the working copy keeps, in order, and its theme and audience. 409 doc_rev_conflict { rev, server }.
//          GET /draft carries it as `doc` (null before the first save).
// "Save as version" stays `PUT /api/decks/:id` (send `If-Match: <version>` to have a stale one refused).
import { request } from '../api.js';

const deckPath = (deckId) => `/decks/${encodeURIComponent(deckId)}`;

export const deckDraftApi = {
  saveCard: (deckId, uid, card, rev, { ord } = {}) => request(`${deckPath(deckId)}/cards/${encodeURIComponent(uid)}`, {
    method: 'PATCH',
    headers: { 'If-Match': String(rev ?? 0) },
    body: JSON.stringify({ card, ...(ord === undefined ? {} : { ord }) }),
  }),
  saveDoc: (deckId, body, rev) => request(`${deckPath(deckId)}/draft-doc`, {
    method: 'PUT',
    headers: { 'If-Match': String(rev ?? 0) },
    body: JSON.stringify(body),
  }),
  draft: (deckId) => request(`${deckPath(deckId)}/draft`),
  discard: (deckId) => request(`${deckPath(deckId)}/draft`, { method: 'DELETE' }),
};
