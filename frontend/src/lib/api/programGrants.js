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
// D1126 (#3006): HQ's History tab and Download CSV. Worker: routes/admin_program_grants.ts over
// services/programGrantsHistory.ts.
//   GET    /api/admin/program-grants/history[?program=&licence=&before=&limit=]
//            → { items: [{ id, at, action, action_label, program_key, program_name, licence, changed,
//                          deal_types, request, reason, by }], next_before }
//   GET    /api/admin/program-grants/export.csv            (one row per studio and program)
//   GET    /api/admin/program-grants/licences/:uid/export.csv
// A studio raises one with `licenceRequestsApi.raise` (kinds program_grant,
// program_terms_change, program_end; `request: { program, term?, asked? }`).
import { api, request } from '../api.js';

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
  // D1126 (#3006): HQ's History tab, every licence's program events, a page at a time.
  allHistory: ({ program, licence, before, limit } = {}) => {
    const q = new URLSearchParams();
    if (program) q.set('program', program);
    if (licence) q.set('licence', licence);
    if (before) q.set('before', String(before));
    if (limit) q.set('limit', String(limit));
    const qs = q.toString();
    return request(`/admin/program-grants/history${qs ? `?${qs}` : ''}`);
  },
  // D1126: Download CSV, the grid's rows (one per studio and program), or one studio's.
  exportCsv: () => api._downloadCsv('/admin/program-grants/export.csv', 'program-grants.csv'),
  exportLicenceCsv: (uid) => api._downloadCsv(`/admin/program-grants/licences/${enc(uid)}/export.csv`, 'program-grants-studio.csv'),
};
