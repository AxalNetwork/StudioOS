// D660 (#1473) — the pages of "Record a session", on D657's Worker routes
// (routes/founder_validate_sessions.ts, migration 438), under
// /api/founder/validate.
//   sessionModels    GET    /sessions/models            live and final models, each priced
//   open             POST   /sessions                   D685 §5.1's one setup call: the interview from Who
//                                                       (or a picked one) and its session, once per client_key
//   createSession    POST   /interviews/:id/sessions    channel, consent, models
//   listSessions     GET    /interviews/:id/sessions
//   getSession       GET    /sessions/:id               session, segments, marks, chunks
//   setConsent       PATCH  /sessions/:id/consent
//   sessionAction    POST   /sessions/:id/{start,pause,resume,stop}
//   uploadChunk      PUT    /sessions/:id/chunks/:seq   one audio chunk; a repeat is `duplicate`
//   active           GET    /sessions/active            the caller's recordings in flight, for recovery on load (D685 §5.6)
//   markMoment       POST   /sessions/:id/marks
//   tickPoint        PUT    /sessions/:id/points/:pointId  { covered } → { points, points_covered } (D685 §5.2)
//   liveSocketUrl    GET    /sessions/:id/live          WebSocket, linear16 at 16 kHz
//   transcribe       POST   /sessions/:id/transcribe
// D685 §5.9–§5.10 (#1589), on #1605's routes:
//   finish           POST   /sessions/:id/finish        { last_seq, auto } → { processing, queued }
//   process          POST   /sessions/:id/process       retry a failed or stale run → { processing }
//   summarise        POST   /sessions/:id/summarise     { model? } → { summary }
//   keepDigest       POST   /sessions/:id/digest/keep   keep the summary draft as it stands → { digest } (D757, #1924)
//   editDigest       PATCH  /sessions/:id/digest        { overview?, next_steps?, key_quotes? } → { digest }; a quote is removed, never rewritten
//   setSpeaker       PATCH  /sessions/:id/segments/:segId
//   sessionReceipt   GET    /sessions/:id/receipt
//   deleteSession    DELETE /sessions/:id
// D690 (#1692), for D697's record (#1659):
//   audio            GET    /sessions/:id/audio         { parts: [{ seq, url, mime, start_ms, expires_at }] }, one single-use signed URL per chunk
// D658 (#1494), the review step:
//   placements       GET    /sessions/:id/placements    every run's placements, and compare
//   structure        POST   /sessions/:id/structure     { model? } → a new run
//   askTranscript    POST   /sessions/:id/ask           { question } → an answer with cites, or 422 no_citation
//   acceptPlacement  POST   /placements/:id/accept      { payload? } (an edit, then accept)
//   discardPlacement POST   /placements/:id/discard
// D757 (#1925), Accept all:
//   acceptAll        POST   /sessions/:id/placements/accept  { slug } or { ids } (at most 50) → { results: [{ id, ok, error? }], accepted, remaining }
import { request } from '../api.js';

const enc = encodeURIComponent;
const P = '/founder/validate';
const ACTIONS = new Set(['start', 'pause', 'resume', 'stop']);

export const interviewSessionsApi = {
  models: () => request(`${P}/sessions/models`),
  /** The caller's recordings in flight (D685 §5.6.1): restored on app load. */
  active: () => request(`${P}/sessions/active`),
  open: (body) => request(`${P}/sessions`, { method: 'POST', body: JSON.stringify(body) }),
  create: (interviewId, data) => request(`${P}/interviews/${enc(interviewId)}/sessions`, {
    method: 'POST', body: JSON.stringify(data),
  }),
  list: (interviewId) => request(`${P}/interviews/${enc(interviewId)}/sessions`),
  get: (id) => request(`${P}/sessions/${enc(id)}`),
  setConsent: (id, status, method) => request(`${P}/sessions/${enc(id)}/consent`, {
    method: 'PATCH', body: JSON.stringify({ status, method }),
  }),
  action: (id, action) => {
    if (!ACTIONS.has(action)) throw new Error(`Unknown session action: ${action}`);
    return request(`${P}/sessions/${enc(id)}/${action}`, { method: 'POST' });
  },
  uploadChunk: (id, seq, blob, startMs) => request(`${P}/sessions/${enc(id)}/chunks/${enc(seq)}`, {
    method: 'PUT',
    body: blob,
    headers: {
      'Content-Type': (blob && blob.type) || 'audio/webm',
      ...(Number.isSafeInteger(startMs) && startMs >= 0 ? { 'x-chunk-start-ms': String(startMs) } : {}),
    },
  }),
  /** A replay with the same `client_key` is answered `duplicate`, never a second mark (§5.7). */
  mark: (id, offsetMs, label, clientKey) => request(`${P}/sessions/${enc(id)}/marks`, {
    method: 'POST',
    body: JSON.stringify({ offset_ms: Math.max(0, Math.round(Number(offsetMs) || 0)), label, ...(clientKey ? { client_key: clientKey } : {}) }),
  }),
  tickPoint: (id, pointId, covered) => request(`${P}/sessions/${enc(id)}/points/${enc(pointId)}`, {
    method: 'PUT', body: JSON.stringify({ covered: !!covered }),
  }),
  /** The live socket's address. A browser WebSocket carries the auth cookie. */
  liveUrl: (id, loc = (typeof window !== 'undefined' ? window.location : null)) => {
    const proto = loc && loc.protocol === 'http:' ? 'ws:' : 'wss:';
    const host = loc ? loc.host : '';
    return `${proto}//${host}/api${P}/sessions/${enc(id)}/live`;
  },
  // D778 part 6: `headers` is the press's own rail context (`railPressHeaders`).
  transcribe: (id, model, headers) => request(`${P}/sessions/${enc(id)}/transcribe`, {
    ...(headers ? { headers } : {}),
    method: 'POST', body: JSON.stringify(model ? { model } : {}),
  }),
  // D770 (#2095): `auto` is true only when the Stop sheet's choice is on.
  finish: (id, lastSeq, auto = false) => request(`${P}/sessions/${enc(id)}/finish`, {
    method: 'POST', body: JSON.stringify({ last_seq: lastSeq, auto: auto === true }),
  }),
  process: (id) => request(`${P}/sessions/${enc(id)}/process`, { method: 'POST', body: JSON.stringify({}) }),
  // D778 part 8: `headers` on summarise, structure and ask is the press's own rail context.
  summarise: (id, model, headers) => request(`${P}/sessions/${enc(id)}/summarise`, {
    ...(headers ? { headers } : {}),
    method: 'POST', body: JSON.stringify(model ? { model } : {}),
  }),
  keepDigest: (id) => request(`${P}/sessions/${enc(id)}/digest/keep`, { method: 'POST', body: JSON.stringify({}) }),
  editDigest: (id, edit) => request(`${P}/sessions/${enc(id)}/digest`, { method: 'PATCH', body: JSON.stringify(edit || {}) }),
  setSpeaker: (id, segmentId, speakerLabel) => request(`${P}/sessions/${enc(id)}/segments/${enc(segmentId)}`, {
    method: 'PATCH', body: JSON.stringify({ speaker_label: speakerLabel }),
  }),
  receipt: (id) => request(`${P}/sessions/${enc(id)}/receipt`),
  /** One signed, single-use download per recorded chunk (D690): fetch each once, and ask again for fresh URLs. */
  audio: (id) => request(`${P}/sessions/${enc(id)}/audio`),
  remove: (id) => request(`${P}/sessions/${enc(id)}`, { method: 'DELETE' }),
  placements: (id) => request(`${P}/sessions/${enc(id)}/placements`),
  structure: (id, model, headers) => request(`${P}/sessions/${enc(id)}/structure`, {
    ...(headers ? { headers } : {}),
    method: 'POST', body: JSON.stringify(model ? { model } : {}),
  }),
  ask: (id, question, headers) => request(`${P}/sessions/${enc(id)}/ask`, {
    ...(headers ? { headers } : {}),
    method: 'POST', body: JSON.stringify({ question }),
  }),
  accept: (placementId, payload) => request(`${P}/placements/${enc(placementId)}/accept`, {
    method: 'POST', body: JSON.stringify(payload ? { payload } : {}),
  }),
  discard: (placementId) => request(`${P}/placements/${enc(placementId)}/discard`, { method: 'POST' }),
  /** Each placement's own Accept, one by one: `target` is a module slug or a list of placement ids. */
  acceptAll: (id, target) => request(`${P}/sessions/${enc(id)}/placements/accept`, {
    method: 'POST', body: JSON.stringify(Array.isArray(target) ? { ids: target } : { slug: target }),
  }),
};
