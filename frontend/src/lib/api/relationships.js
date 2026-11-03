import { request } from '../api.js';

// D1356 (#3571, part 7 of #3564) — who on my teams knows a person, on
// cloudflare-worker/src/routes/relationships.ts at /api/relationships (migration 653).
//   sharing()                      GET  /relationships/sharing → { opted_in, teams: [{ key, kind, label, shared }] }
//   setSharing(share)              PUT  /relationships/sharing { share } — every team I belong to
//   setTeamSharing(key, share)     PUT  /relationships/sharing/teams/:key { share } — one team
//   whoKnows({ person|company|fund }) GET /relationships/who-knows → { query, people: [{ ref, teammate, team, person, how }] }
//   whoKnowsRank(q, query)         POST /relationships/who-knows/rank?person=|company=|fund= { query }
//                                  → { job: 'NE1', steps, rows: [{ ref, position, line }] } (#3938; a model run)
//   requestIntro(body)             POST /relationships/intro-request { teammate, ref, note?, context_note? } → 201 { request }
//   introRequests({ team, status }) GET /relationships/intro-requests[?team=&status=] → { sent, received, follow_ups_due } (D4329)
//   decideIntro(uid, decision, note) POST /relationships/intro-requests/:uid/decide { decision: accepted | declined, note? } → { request }
//   withdrawIntro(uid)             POST /relationships/intro-requests/:uid/withdraw → { request } (the asker, while pending)
//   recordIntroOutcome(uid, outcome, note) POST /relationships/intro-requests/:uid/outcome { outcome, note? } → { request }
//   setIntroFollowUp(uid, dueOn)   PUT  /relationships/intro-requests/:uid/follow-up { due_on } → { request }
//   introFollowUpDone(uid)         POST /relationships/intro-requests/:uid/follow-up/done → { request }
//   snoozeIntroFollowUp(uid, until) POST /relationships/intro-requests/:uid/follow-up/snooze { until } → { request }
// Made is not a press: the intro is sent from the Email composer with `intro_uid` (mailAccountsApi's send), which records it.
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
  introRequests: (filter = {}) => {
    const q = new URLSearchParams(Object.entries(filter || {}).filter(([k, v]) => ['team', 'status'].includes(k) && v));
    return request(`/relationships/intro-requests${q.size ? `?${q}` : ''}`);
  },
  decideIntro: (uid, decision, note) => send('POST', `/relationships/intro-requests/${id(uid)}/decide`, { decision, ...(note ? { note } : {}) }),
  withdrawIntro: (uid) => send('POST', `/relationships/intro-requests/${id(uid)}/withdraw`),
  recordIntroOutcome: (uid, outcome, note) => send('POST', `/relationships/intro-requests/${id(uid)}/outcome`, { outcome, ...(note ? { note } : {}) }),
  setIntroFollowUp: (uid, dueOn) => send('PUT', `/relationships/intro-requests/${id(uid)}/follow-up`, { due_on: dueOn }),
  introFollowUpDone: (uid) => send('POST', `/relationships/intro-requests/${id(uid)}/follow-up/done`),
  snoozeIntroFollowUp: (uid, until) => send('POST', `/relationships/intro-requests/${id(uid)}/follow-up/snooze`, { until }),
};
