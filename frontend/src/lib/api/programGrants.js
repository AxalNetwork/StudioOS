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
// A term nobody set is null and reads "Not recorded"; requests are part 2
// (#2774), so `tiles.requests_waiting` is null with a reason, never 0.
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
};
