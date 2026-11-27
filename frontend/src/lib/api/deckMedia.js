// D1545 (#3788, deck v2 B12) — recorded video, cross-deck paste and button clicks.
// Worker: routes/deck_media.ts (mounted at /api/decks) and deck_share_actions.ts.
//   POST /api/decks/:id/videos/upload   multipart: file (MP4, ≤ 50 MB) → { video: { provider: 'mp4', video_id, url } }
//   POST /api/decks/:id/paste           { from_deck_id, card_uids } → { cards, missing } (nothing saved)
//   GET  /api/decks/:id/button-clicks   → { buttons: [{ card_uid, block_id, clicks, viewers }] }
//   POST /api/decks/share/:token/click  { card_uid, block_id, view_id? } — a viewer pressed a button
// Read through `deckV2Adapter.media`; the share page calls `click` itself.
import { request } from '../api.js';

const enc = encodeURIComponent;

export const deckMediaApi = {
  uploadVideo: (deckId, file) => {
    const form = new FormData();
    form.append('file', file);
    return request(`/decks/${enc(deckId)}/videos/upload`, { method: 'POST', body: form });
  },
  paste: (deckId, fromDeckId, cardUids) => request(`/decks/${enc(deckId)}/paste`, {
    method: 'POST',
    body: JSON.stringify({ from_deck_id: fromDeckId, card_uids: cardUids }),
  }),
  buttonClicks: (deckId) => request(`/decks/${enc(deckId)}/button-clicks`, { method: 'GET' }),
  click: (token, { cardUid, blockId, viewId } = {}) => request(`/decks/share/${enc(token)}/click`, {
    method: 'POST',
    body: JSON.stringify({ card_uid: cardUid, block_id: blockId, ...(viewId ? { view_id: viewId } : {}) }),
  }),
};
