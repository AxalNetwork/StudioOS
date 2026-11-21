// D5791 (#5791) — the walkthrough attached to an investor's share link, as the share viewer plays it.
// Worker: routes/deck_share_walkthrough.ts, mounted at /api/decks.
//   GET /api/decks/share/:token/walkthrough             → { attached, takes: [{ uid, card, card_uid, take, duration_ms, media_mime, captions }] }
//   GET /api/decks/share/:token/walkthrough/:uid/media  → the take's file (mediaUrl; Range answered)
// Public and share-token-gated: the link's NDA and email gate, its expiry and withdrawal, and HQ's `deck:walkthrough`.
// The share page calls it itself, as it calls its other share reads; it is not a deck v2 adapter method.
import { request } from '../api.js';

const at = (token, tail = '') => `/decks/share/${encodeURIComponent(token)}/walkthrough${tail}`;

export const deckShareWalkthroughApi = {
  read: (token) => request(at(token)),
  mediaUrl: (token, uid) => `/api${at(token, `/${encodeURIComponent(uid)}/media`)}`,
};
