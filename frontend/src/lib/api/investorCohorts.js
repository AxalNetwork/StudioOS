// D963 (#2796, Programs part 10) — the client for part 6's admin routes for
// Investor cohort access (D959, #2792). Worker: routes/admin_investor_cohorts.ts,
// mounted at /api/admin/investor-cohorts, every route `requireAdmin`; the
// three writes also take `requireBranchNotSuspended` (423).
//   GET  /assignable   ?q=&cycle_id=&limit=&offset=   verified investors, with `has_open_grant` for a cycle
//   GET  /summary      the tiles, and `nda_template`: published, missing or unreadable
//   GET  /             ?q=&cycle_id=&nda=&state=&limit=&offset=   the grants, newest first, with `total`
//   POST /             { investor_user_id, cohort_cycle_id, ends_at, scope?, note? } → 201 { grant, founders_notified, nda_template }
//   POST /:uid/end     → { grant, founders_notified }
//   POST /:uid/nda     sends the cohort NDA → { grant, envelope }
import { request } from '../api.js';

const enc = encodeURIComponent;
const BASE = '/admin/investor-cohorts';
const query = (params) => {
  const s = new URLSearchParams(Object.entries(params || {}).filter(([, v]) => v !== '' && v != null)).toString();
  return s ? `?${s}` : '';
};
const post = (body) => ({ method: 'POST', body: JSON.stringify(body || {}) });

export const investorCohortsApi = {
  assignable: (params) => request(`${BASE}/assignable${query(params)}`),
  summary: () => request(`${BASE}/summary`),
  grants: (params) => request(`${BASE}${query(params)}`),
  give: (body) => request(BASE, post(body)),
  end: (uid) => request(`${BASE}/${enc(uid)}/end`, post({})),
  sendNda: (uid) => request(`${BASE}/${enc(uid)}/nda`, post({})),
};
