// D1590 F11 (#3837) — the recorded walkthrough: a take per card, captioned, attached to an investor link.
// Worker: routes/deck_recordings.ts, mounted at /api/decks.
//   POST   /api/decks/:id/recordings/quote           { duration_ms } → { model, hold_microusd, minutes, balance }
//   POST   /api/decks/:id/recordings                 form: card, duration_ms, media, audio?, model? → { take, walkthrough }
//   GET    /api/decks/:id/recordings                 → { deck_id, cards: [take | null], recorded, links }
//   GET    /api/decks/:id/recordings/:uid/media      → the take's file (mediaUrl)
//   DELETE /api/decks/:id/recordings/:uid            → { deleted: true }; the stored file goes with the row
//   PUT    /api/decks/:id/recordings/links/:shareId  { attach } → { links }
// A take is kept until its maker deletes it, or its deck or account goes (owner decision W = A).
import { LONG_TIMEOUT_MS, request } from '../api.js';

const at = (deckId, tail = '') => `/decks/${encodeURIComponent(deckId)}/recordings${tail}`;

export const deckRecordingsApi = {
  quote: (deckId, durationMs) => request(at(deckId, '/quote'), { method: 'POST', body: JSON.stringify({ duration_ms: Math.round(durationMs) }) }),
  record: (deckId, { card, durationMs, media, audio, model } = {}) => {
    const fd = new FormData();
    fd.append('card', String(card));
    fd.append('duration_ms', String(Math.round(durationMs)));
    fd.append('media', media);
    if (audio) fd.append('audio', audio);
    if (model) fd.append('model', model);
    return request(at(deckId), { method: 'POST', body: fd, timeoutMs: LONG_TIMEOUT_MS });
  },
  list: (deckId) => request(at(deckId)),
  mediaUrl: (deckId, uid) => `/api${at(deckId, `/${encodeURIComponent(uid)}/media`)}`,
  remove: (deckId, uid) => request(at(deckId, `/${encodeURIComponent(uid)}`), { method: 'DELETE' }),
  attach: (deckId, shareId, attach) => request(at(deckId, `/links/${encodeURIComponent(shareId)}`), { method: 'PUT', body: JSON.stringify({ attach: !!attach }) }),
};
