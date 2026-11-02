// D1570 (#3817, deck builder v2 D9) — comments on a deck's cards, with
// @mentions, an assignee and Resolve, and the approval a share waits for.
// The studio reads the threads through `pages/raise/pitch/deckV2Adapter.js`
// (`comments`); the sheet writes through the methods below.
// Worker: routes/deck_comments.ts, migration 741.
//   GET  /api/decks/:id/comments               → { deck_id, version, viewer, people, comments, open }
//   POST /api/decks/:id/comments               { body, card_index | card_uid, area?, parent_uid?, mentions? } → 201 { comment }
//   POST /api/decks/:id/comments/:uid/assign   { user_id | null } → { comment }
//   POST /api/decks/:id/comments/:uid/resolve  { resolved? } → { comment }
//   GET  /api/decks/:id/approval               → { deck_id, version, approvers, pending, message }
//   PUT  /api/decks/:id/approvers              { user_ids } → the approval
//   POST /api/decks/:id/approve                → the approval
import { request } from '../api.js';

const enc = encodeURIComponent;

export const deckCommentsApi = {
  list: (deckId) => request(`/decks/${enc(deckId)}/comments`),
  post: (deckId, body) => request(`/decks/${enc(deckId)}/comments`, { method: 'POST', body: JSON.stringify(body) }),
  assign: (deckId, uid, userId) => request(`/decks/${enc(deckId)}/comments/${enc(uid)}/assign`, { method: 'POST', body: JSON.stringify({ user_id: userId ?? null }) }),
  resolve: (deckId, uid, resolved = true) => request(`/decks/${enc(deckId)}/comments/${enc(uid)}/resolve`, { method: 'POST', body: JSON.stringify({ resolved }) }),
  approval: (deckId) => request(`/decks/${enc(deckId)}/approval`),
  setApprovers: (deckId, userIds) => request(`/decks/${enc(deckId)}/approvers`, { method: 'PUT', body: JSON.stringify({ user_ids: userIds }) }),
  approve: (deckId) => request(`/decks/${enc(deckId)}/approve`, { method: 'POST', body: '{}' }),
};
