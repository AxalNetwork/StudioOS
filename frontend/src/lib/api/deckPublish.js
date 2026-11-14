// D1564 (#3811, deck builder v2 D3) — a share link published as a web page.
// The publish control is ShareDialog's only (Share ▾ › Share link…,
// `pages/raise/pitch/PublishPanel.jsx`); the email gate is the reader's
// (`ShareViewerParts.jsx` `EmailGate`). Public (un-gated) pages are off until
// counsel's wording (owner decision T), and a 506(b) round never publishes.
// Worker: routes/deck_publish.ts, no migration.
//   GET  /api/decks/:id/investor-links/:shareId/publish  → { link_id, publish, gate, public_views, note }
//   PUT  /api/decks/:id/investor-links/:shareId/publish  { on: true, exemption: '506c', gate?: 'email', embed_origins? } | { on: false } → the same
//   POST /api/decks/share/:token/email                   { email } → { ok }: this browser passes the link's email gate
import { request } from '../api.js';

const enc = encodeURIComponent;

export const deckPublishApi = {
  read: (deckId, shareId) => request(`/decks/${enc(deckId)}/investor-links/${enc(shareId)}/publish`),
  save: (deckId, shareId, body) => request(`/decks/${enc(deckId)}/investor-links/${enc(shareId)}/publish`, { method: 'PUT', body: JSON.stringify(body) }),
  gateEmail: (token, email) => request(`/decks/share/${enc(token)}/email`, { method: 'POST', body: JSON.stringify({ email }) }),
};
