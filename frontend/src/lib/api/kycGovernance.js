import { request } from '../api.js';

// D1232 (#3240) — KYC & KYB part 4, on routes/kyc_governance.ts.
//   kycRenewals     GET  /kyc/admin/renewals  { filter: 'all'|'soon'|'expired', q, page }  any admin (KYC9)
//                   → { as_of, horizon, counts: { expire_30: { count, next }, expired, all,
//                       rechecks: { recorded: false, reason }, screened_over_12: { recorded: false, reason } },
//                       months: [{ month, people, businesses }], filter, total, page, page_size,
//                       items: [{ id, who: { id, name, role }, kind: 'person'|'business', check, what,
//                                 expires_at, days_left, expired, warned: [{ days, sent_at }],
//                                 obligation_status, kyc_status }] }
//   kycPeriods      GET  /kyc/admin/periods   any admin (KYC17c)
//                   → { periods: [{ key, label, months, default_months, set_by_hq, updated_at, updated_by,
//                                   applied, reason? }], can_change }
//   kycSetPeriods   PUT  /kyc/admin/periods   { periods: { kyc_v1?, kyb_v1?, accreditation_v1? } }
//                   Super Admin at HQ with a recent step-up; a new period moves no existing date
//                   → { changes: [{ key, from, to }], periods }
//   kycAudit        GET  /kyc/admin/audit     { from, to, action, admin, case, q, page }  any admin (KYC10)
//                   → { from, to, per_day: [{ day, looks, decisions }], admins, actions, total, page, page_size,
//                       items: [{ id, at, admin: { id, name }, action, word, kind, case: { id, name } | null, detail }] }
//   kycAuditExport  POST /kyc/admin/audit/export  { from, to, reason }  Super Admin at HQ (KYC17d)
//                   recorded in admin_audit_log before the file is made → { filename, rows, csv }
function query(params = {}) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') continue;
    q.set(k, String(v));
  }
  const s = q.toString();
  return s ? `?${s}` : '';
}

export const kycGovernanceApi = {
  kycRenewals: (params) => request(`/kyc/admin/renewals${query(params)}`),
  kycPeriods: () => request('/kyc/admin/periods'),
  kycSetPeriods: (periods) => request('/kyc/admin/periods', { method: 'PUT', body: JSON.stringify({ periods }) }),
  kycAudit: (params) => request(`/kyc/admin/audit${query(params)}`),
  kycAuditExport: (body) => request('/kyc/admin/audit/export', { method: 'POST', body: JSON.stringify(body) }),
};
