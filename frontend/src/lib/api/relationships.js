import { request } from '../api.js';

// D1356 (#3571, part 7 of #3564) — who on my teams knows a person, on
// cloudflare-worker/src/routes/relationships.ts at /api/relationships (migration 653).
//   sharing()                      GET  /relationships/sharing → { opted_in, teams: [{ key, kind, label, shared }] }
//   setSharing(share)              PUT  /relationships/sharing { share } — every team I belong to
//   setTeamSharing(key, share)     PUT  /relationships/sharing/teams/:key { share } — one team
//   whoKnows({ person|company|fund }) GET /relationships/who-knows → { query, people: [{ ref, teammate, team, person, how }] }
//   whoKnowsRank(q, query)         POST /relationships/who-knows/rank?person=|company=|fund= { query }
//                                  → { job: 'NE1', steps, rows: [{ ref, position, line }] } (#3938; a model run)
//   requestIntro(body)             POST /relationships/intro-request { teammate, ref, note? } → 201 { request }
//   introRequests()                GET  /relationships/intro-requests → { sent, received }
//   decideIntro(uid, decision)     POST /relationships/intro-requests/:uid/decide { decision: made | declined } → { request }
// Private by default. A shared reply has a name, company and title, never an email, phone, notes or URL.
const id = (v) => encodeURIComponent(String(v));
/** `?person=…` (or company, fund): the one thing a who-knows read asks about. */
const askOf = (q) => {
  const [kind, value] = Object.entries(q || {}).find(([k, v]) => ['person', 'company', 'fund'].includes(k) && v) || [];
  return kind ? `?${kind}=${id(value)}` : '';
};
const send = (method, path, body) => request(path, { method, body: JSON.stringify(body ?? {}) });
export const relationshipsApi = {
  sharing: () => request('/relationships/sharing'),
  setSharing: (share) => send('PUT', '/relationships/sharing', { share }),
  setTeamSharing: (key, share) => send('PUT', `/relationships/sharing/teams/${id(key)}`, { share }),
  whoKnows: (q) => request(`/relationships/who-knows${askOf(q)}`),
  // #3938 NE1: ranks the people that same read answers; a model run, so the 30s default would abort it.
  whoKnowsRank: (q, query) => request(`/relationships/who-knows/rank${askOf(q)}`, { method: 'POST', timeoutMs: 60_000, body: JSON.stringify({ query }) }),
  requestIntro: (body) => send('POST', '/relationships/intro-request', body),
  introRequests: () => request('/relationships/intro-requests'),
  decideIntro: (uid, decision) => send('POST', `/relationships/intro-requests/${id(uid)}/decide`, { decision }),
};
