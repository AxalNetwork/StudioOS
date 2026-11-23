// D6695 (#6695, E10 of #6680) — the founder's formation case requests, the
// Worker's routes/formation_requests.ts at /api/formation/case-requests: the
// requests HQ or a partner asked of the founder, the founder's answer, and the
// case timeline the founder may read (visibility `all` only). A document answer
// names a document already uploaded to the venture or company; an identity
// request takes no file. No screen uses this yet.
import { request } from '../api.js';

const enc = encodeURIComponent;

export const formationRequestsApi = {
  /** {caseUid?} → {requests: [{uid, case_uid, kind, title, body, due_on, state, asked_by, …}]} */
  list: ({ caseUid } = {}) => request(`/formation/case-requests${caseUid ? `?case=${enc(caseUid)}` : ''}`),
  /** One request → {request} */
  get: (uid) => request(`/formation/case-requests/${enc(uid)}`),
  /** {text?, document_id?, sha256?} → {request} */
  answer: (uid, body) => request(`/formation/case-requests/${enc(uid)}/answer`, { method: 'POST', body: JSON.stringify(body ?? {}) }),
  /** The case timeline the founder may read → {case_uid, events: [{id, at, party, kind, detail, …}]} */
  timeline: (caseUid) => request(`/formation/case-requests/cases/${enc(caseUid)}/timeline`),
};
