import { request } from '../api.js';

// D1356 (#3571, part 7 of #3564) — who on my teams knows a person, on
// cloudflare-worker/src/routes/relationships.ts at /api/relationships (migration 653).
//   sharing()                      GET  /relationships/sharing → { opted_in, teams: [{ key, kind, label, shared }] }
//   setSharing(share)              PUT  /relationships/sharing { share } — every team I belong to
//   setTeamSharing(key, share)     PUT  /relationships/sharing/teams/:key { share } — one team
//   whoKnows({ person|company|fund }) GET /relationships/who-knows → { query, people: [{ ref, teammate, team, person, how }] }
//   requestIntro(body)             POST /relationships/intro-request { teammate, ref, note? } → 201 { request }
//   introRequests()                GET  /relationships/intro-requests → { sent, received }
//   decideIntro(uid, decision)     POST /relationships/intro-requests/:uid/decide { decision: made | declined } → { request }
// Private by default. A shared reply has a name, company and title, never an email, phone, notes or URL.
const id = (v) => encodeURIComponent(String(v));
const send = (method, path, body) => request(path, { method, body: JSON.stringify(body ?? {}) });
export const relationshipsApi = {
  sharing: () => request('/relationships/sharing'),
  setSharing: (share) => send('PUT', '/relationships/sharing', { share }),
  setTeamSharing: (key, share) => send('PUT', `/relationships/sharing/teams/${id(key)}`, { share }),
  whoKnows: (q) => {
    const [kind, value] = Object.entries(q || {}).find(([k, v]) => ['person', 'company', 'fund'].includes(k) && v) || [];
    return request(`/relationships/who-knows${kind ? `?${kind}=${id(value)}` : ''}`);
  },
  requestIntro: (body) => send('POST', '/relationships/intro-request', body),
  introRequests: () => request('/relationships/intro-requests'),
  decideIntro: (uid, decision) => send('POST', `/relationships/intro-requests/${id(uid)}/decide`, { decision }),
};
