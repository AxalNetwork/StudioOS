// D982 (#2773, part 1 of #2376) — HQ's program grants: which programs each
// licensed studio may run, and on what terms.
// Worker: routes/admin_program_grants.ts over services/programGrants.ts and
// migration 553. Reads are Super Admin only; every write takes the money bar
// (a TOTP session, a fresh step-up, the elevation) and a reason of at least
// 10 characters, and appends one `program_changed` licence event.
//   GET    /api/admin/program-grants                       → { programs, licences, tiles, series }
//   GET    /api/admin/program-grants/defaults              → { programs }
//   PUT    /api/admin/program-grants/defaults/:program     { grantable?, terms?, reason }
//   GET    /api/admin/program-grants/licences/:uid         → { licence, grants, history }
//   GET    /api/admin/program-grants/licences/:uid/history[?program=]
//   POST   /api/admin/program-grants/licences/:uid/:program          grant  { terms?, note?, reason }
//   PATCH  /api/admin/program-grants/licences/:uid/:program          change { terms?, note?, reason }
//   POST   /api/admin/program-grants/licences/:uid/:program/pause    { reason }
//   POST   /api/admin/program-grants/licences/:uid/:program/resume   { reason }
//   POST   /api/admin/program-grants/licences/:uid/:program/end      { reason }
// A term nobody set is null and reads "Not recorded".
// D983 (#2774, part 2): the studios' program requests and HQ's answer.
// Worker: routes/admin_program_requests.ts over services/programRequests.ts.
//   GET    /api/admin/program-grants/requests[?status=open|answered|declined|withdrawn]
//            → { items: [{ uid, kind, asks_for, program_key, program_name, request, note, lane,
//                          licence, status, created_at, due_at, sla, answer, answered_at, draft }], complete }
//   POST   /api/admin/program-grants/requests/:uid/approve   { reason, terms? }   (terms on a grant only)
//   POST   /api/admin/program-grants/requests/:uid/decline   { reason }
// Both answers take the same bar and reason as a grant write. An approval
// records a draft; Grant stays the write above. `tiles.requests_waiting` and
// `series.requests_by_month` are read; null only when the requests could not be.
// A studio raises one with `licenceRequestsApi.raise` (kinds program_grant,
// program_terms_change, program_end; `request: { program, term?, asked? }`).
import { request } from '../api.js';

const enc = encodeURIComponent;
const at = (uid, program) => `/admin/program-grants/licences/${enc(uid)}/${enc(program)}`;

export const programGrantsApi = {
  grid: () => request('/admin/program-grants'),
  defaults: () => request('/admin/program-grants/defaults'),
  saveDefaults: (program, body) => request(`/admin/program-grants/defaults/${enc(program)}`, { method: 'PUT', body: JSON.stringify(body || {}) }),
  licence: (uid) => request(`/admin/program-grants/licences/${enc(uid)}`),
  history: (uid, program) => request(`/admin/program-grants/licences/${enc(uid)}/history${program ? `?program=${enc(program)}` : ''}`),
  grant: (uid, program, body) => request(at(uid, program), { method: 'POST', body: JSON.stringify(body || {}) }),
  changeTerms: (uid, program, body) => request(at(uid, program), { method: 'PATCH', body: JSON.stringify(body || {}) }),
  pause: (uid, program, body) => request(`${at(uid, program)}/pause`, { method: 'POST', body: JSON.stringify(body || {}) }),
  resume: (uid, program, body) => request(`${at(uid, program)}/resume`, { method: 'POST', body: JSON.stringify(body || {}) }),
  end: (uid, program, body) => request(`${at(uid, program)}/end`, { method: 'POST', body: JSON.stringify(body || {}) }),
  requests: (status) => request(`/admin/program-grants/requests${status ? `?status=${enc(status)}` : ''}`),
  approveRequest: (uid, body) => request(`/admin/program-grants/requests/${enc(uid)}/approve`, { method: 'POST', body: JSON.stringify(body || {}) }),
  declineRequest: (uid, body) => request(`/admin/program-grants/requests/${enc(uid)}/decline`, { method: 'POST', body: JSON.stringify(body || {}) }),
};
