// D1580 F1 (#3827) — rehearse a deck version, and the report.
// Worker: routes/deck_rehearsals.ts, mounted at /api/decks.
//   POST /api/decks/:id/rehearsals/quote        { pitch_seconds, model? } → { model, hold_microusd, minutes, balance }
//   POST /api/decks/:id/rehearsals              form: audio, pitch_seconds, duration_ms, marks, model? → { rehearsal }
//   GET  /api/decks/:id/rehearsals              → { deck_id, rehearsals: [summary] }
//   GET  /api/decks/:id/rehearsals/:uid         → { rehearsal }
//   PUT  /api/decks/:id/rehearsals/:uid/keep-audio { keep } → { rehearsal }; 413 storage_full when kept audio would not fit
//   POST /api/decks/:id/rehearsals/:uid/coach/quote { model? } → { model, hold_microusd, balance }   (part 2)
//   POST /api/decks/:id/rehearsals/:uid/coach       { model? } → { rehearsal } with `coaching: { points: [{ card, point }], dropped, model, charged_microusd, coached_at }`
//        409 already_coached; written once. The audio's hour then counts from the coaching.
//   POST /api/decks/:id/rehearsals/live/quote    → { model, hold_microusd, block_minutes, balance }   (part 2b)
//   GET  /api/decks/:id/rehearsals/live          WebSocket: 16 kHz PCM in, transcript events out; text never stored
// The audio is held for an hour after the report unless "Keep the audio" is on.
import { request } from '../api.js';

const at = (deckId, tail = '') => `/decks/${encodeURIComponent(deckId)}/rehearsals${tail}`;

export const deckRehearsalsApi = {
  quote: (deckId, body) => request(at(deckId, '/quote'), { method: 'POST', body: JSON.stringify(body) }),
  run: (deckId, { audio, pitchSeconds, durationMs, marks, model } = {}) => {
    const fd = new FormData();
    fd.append('audio', audio);
    fd.append('pitch_seconds', String(pitchSeconds));
    fd.append('duration_ms', String(Math.round(durationMs)));
    fd.append('marks', JSON.stringify(marks || []));
    if (model) fd.append('model', model);
    return request(at(deckId), { method: 'POST', body: fd });
  },
  list: (deckId) => request(at(deckId)),
  read: (deckId, uid) => request(at(deckId, `/${encodeURIComponent(uid)}`)),
  coachQuote: (deckId, uid, model) => request(at(deckId, `/${encodeURIComponent(uid)}/coach/quote`), { method: 'POST', body: JSON.stringify(model ? { model } : {}) }),
  coach: (deckId, uid, model) => request(at(deckId, `/${encodeURIComponent(uid)}/coach`), { method: 'POST', body: JSON.stringify(model ? { model } : {}) }),
  liveQuote: (deckId) => request(at(deckId, '/live/quote'), { method: 'POST', body: '{}' }),
  liveUrl: (deckId, loc = (typeof window !== 'undefined' ? window.location : null)) => {
    const proto = loc && loc.protocol === 'http:' ? 'ws:' : 'wss:';
    const host = loc ? loc.host : '';
    return `${proto}//${host}/api${at(deckId, '/live')}`;
  },
  keepAudio: (deckId, uid, keep) => request(at(deckId, `/${encodeURIComponent(uid)}/keep-audio`), { method: 'PUT', body: JSON.stringify({ keep: !!keep }) }),
};
