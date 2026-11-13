// D5059 (#5059) — program entitlements from held user licences: eligibility, grant, legal readiness and source.
// Worker: routes/admin_program_entitlements.ts over services/programEntitlements.ts. Reads are Super Admin;
// writes take the write bar and a reason of at least 10 characters.
//   GET  /api/admin/program-entitlements[?licence_type=&holder=user:<id>&program=&q=&limit=]
//          → { on, items: [{ holder, program_key, program_name, eligible, sources, held_not_valid, grant,
//                            granted, legally_ready, in_force, in_force_via, status, blockers }], holders, truncated }
//   GET  /api/admin/program-entitlements/rules             → { on, items: [{ program_key, licence_type, in_force, scheduled, versions }] }
//   POST /api/admin/program-entitlements/rules             { program_key, licence_type, eligible, agreement_required?, effective_from, reason }
//   GET  /api/admin/program-entitlements/accounts/:id      → { on, account, licences, programs, history, actions }
//   POST /api/admin/program-entitlements/accounts/:id/programs/:program  { action, expected_revision, reason }
//   GET  /api/admin/program-entitlements/licences/:uid     → { on, licence, account, other_licences, programs }
import { request } from '../api.js';

const enc = encodeURIComponent;
const BASE = '/admin/program-entitlements';

export const programEntitlementsApi = {
  /** Program access by user licence. `filters`: { licence_type, holder, program, q, limit }; empty values are left out. */
  list: (filters = {}) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(filters || {})) if (v !== null && v !== undefined && v !== '' && v !== 'all') q.set(k, String(v));
    const s = q.toString();
    return request(`${BASE}${s ? `?${s}` : ''}`);
  },
  rules: () => request(`${BASE}/rules`),
  addRuleVersion: (body) => request(`${BASE}/rules`, { method: 'POST', body: JSON.stringify(body || {}) }),
  account: (id) => request(`${BASE}/accounts/${enc(id)}`),
  changeGrant: (id, program, body) => request(`${BASE}/accounts/${enc(id)}/programs/${enc(program)}`, { method: 'POST', body: JSON.stringify(body || {}) }),
  licence: (uid) => request(`${BASE}/licences/${enc(uid)}`),
};
