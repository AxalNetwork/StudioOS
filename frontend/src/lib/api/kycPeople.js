// D1229 (#3237, KYC part 1) — HQ's people queue and one person's case, beside
// the older `kycAdmin*` calls in api.js that D648's console still uses:
//   GET   /api/kyc/admin/people?status=&q=&id_type=&country=&flag=&assignee=&sort=&dir=&page=&page_size=
//         → { rows, total, page, page_size, counts } (KYC1, KYC2)
//   GET   /api/kyc/admin/figures → decisions per week, the median, the wait bands (KYC3)
//   GET   /api/kyc/admin/:userId/case → assignee, history, notes, documents (KYC5)
//   PATCH /api/kyc/admin/:userId/assign { assignee_id | null }
//   POST  /api/kyc/admin/:userId/notes { body }
//   PATCH /api/kyc/admin/:userId/needs-info { message }   (step-up)
//   PATCH /api/kyc/admin/:userId/recheck { message }      (step-up)
//   PATCH /api/kyc/admin/:userId/approve { note? }        (step-up)
// Each read is logged by the Worker.
import { request } from '../api.js';

const one = (userId) => `/kyc/admin/${encodeURIComponent(userId)}`;
const QUERY_KEYS = ['status', 'q', 'id_type', 'country', 'flag', 'assignee', 'sort', 'dir', 'page', 'page_size'];

/** The queue's query string, with only the keys the Worker reads and no empty values. */
export function kycPeopleQuery(params = {}) {
  const q = new URLSearchParams();
  for (const k of QUERY_KEYS) {
    const v = params[k];
    if (v != null && String(v).trim() !== '') q.set(k, String(v));
  }
  const s = q.toString();
  return s ? `?${s}` : '';
}

export const kycPeopleApi = {
  people: (params) => request(`/kyc/admin/people${kycPeopleQuery(params)}`),
  figures: () => request('/kyc/admin/figures'),
  caseOf: (userId) => request(`${one(userId)}/case`),
  assign: (userId, assigneeId) => request(`${one(userId)}/assign`, { method: 'PATCH', body: JSON.stringify({ assignee_id: assigneeId ?? null }) }),
  addNote: (userId, body) => request(`${one(userId)}/notes`, { method: 'POST', body: JSON.stringify({ body }) }),
  needsInfo: (userId, message) => request(`${one(userId)}/needs-info`, { method: 'PATCH', body: JSON.stringify({ message }) }),
  recheck: (userId, message) => request(`${one(userId)}/recheck`, { method: 'PATCH', body: JSON.stringify({ message }) }),
  approve: (userId, note) => request(`${one(userId)}/approve`, { method: 'PATCH', body: JSON.stringify(note ? { note } : {}) }),
};
