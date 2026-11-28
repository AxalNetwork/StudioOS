/** D9068 (#9068): the member side of introduction requests through Axal — readiness, the request draft, submit, receipt and withdraw — on /api/intro-requests (D7673). */
import { request } from '../api.js';

// cloudflare-worker/src/routes/intro_requests.ts, mounted at /api/intro-requests. Requester routes only; the operator
// and reviewer routes (/operator/…) belong to #9069 and are not called from here.
//   readiness()                     GET   /intro-requests/readiness → { policy: { uid, version, requirements, validity_days },
//                                         requirements: [{ key, status, valid_until, value, has_evidence_ref, reviewed_at }], ready }
//   putReadiness(key, value)        PUT   /intro-requests/readiness/:key { value } → the same shape, the row back in review
//   createProvisionalTarget(body)   POST  /intro-requests/provisional-targets { display_name, organization_text?, profile_url? } → 201 { uid, review_status }
//   list({ next_actor, state, cursor, limit }) GET /intro-requests → { total, lanes: { requester, operator, target, none }, items, next_cursor }
//   create(body)                    POST  /intro-requests { idempotency_key, target_entry_uid | target_provisional_uid, organization_entry_uid?,
//                                         purpose?, shareable_brief?, private_notes? } → 201 { request } (200 on a replayed key)
//   get(uid)                        GET   /intro-requests/:uid → { request } (the requester's own projection)
//   update(uid, body)               PATCH /intro-requests/:uid { expected_revision, …fields } → { request }
//   submit(uid, revision)           POST  /intro-requests/:uid/submit { expected_revision } → { request, readiness }
//   withdraw(uid, revision)         POST  /intro-requests/:uid/withdraw { expected_revision } → { request }
// The person search the sheet's first step runs is the shared directory's member read (#7674):
//   searchTargets({ q, kind, cursor }) GET /network/directory/entries?q=&kind=person|organization → { entries, total, next_cursor }
//   targetEntry(uid)                GET   /network/directory/entries/:uid → { entry, affiliations } (a Person Sheet's "Request an introduction")
// Nothing here sends a message: submitting only queues the request for an Axal operator.
const id = (v) => encodeURIComponent(String(v));
const send = (method, path, body) => request(path, { method, body: JSON.stringify(body ?? {}) });
const query = (params) => {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params || {})) if (v != null && v !== '') q.set(k, String(v));
  return q.size ? `?${q}` : '';
};

export const introRequestsApi = {
  readiness: () => request('/intro-requests/readiness'),
  putReadiness: (key, value) => send('PUT', `/intro-requests/readiness/${id(key)}`, { value }),
  createProvisionalTarget: (body) => send('POST', '/intro-requests/provisional-targets', body),
  list: ({ next_actor, state, cursor, limit } = {}) => request(`/intro-requests${query({ next_actor, state, cursor, limit })}`),
  create: (body) => send('POST', '/intro-requests', body),
  get: (uid) => request(`/intro-requests/${id(uid)}`),
  update: (uid, body) => send('PATCH', `/intro-requests/${id(uid)}`, body),
  submit: (uid, revision) => send('POST', `/intro-requests/${id(uid)}/submit`, { expected_revision: revision }),
  withdraw: (uid, revision) => send('POST', `/intro-requests/${id(uid)}/withdraw`, { expected_revision: revision }),
  searchTargets: ({ q, kind = 'person', cursor } = {}) => request(`/network/directory/entries${query({ q, kind, cursor })}`),
  targetEntry: (uid) => request(`/network/directory/entries/${id(uid)}`),
};
