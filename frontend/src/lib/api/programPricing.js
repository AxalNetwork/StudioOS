// D5018 (#5018) — program prices from the country index. HQ only (Super Admin; publishing takes the write bar).
// Worker: cloudflare-worker/src/routes/admin_program_pricing.ts over services/programPricing.ts.
//   GET  /api/admin/program-pricing/defaults → { programs: [{ program_key, name, active, versions, reason? }], others }
//   POST /api/admin/program-pricing/defaults/:program { currency, base_annual_fee_cents, base_initial_fee_cents?,
//        floor_multiplier_ppm?, ceiling_multiplier_ppm?, fee_rounding_cents?, effective_from, reason, expected_version } → { default }
//   GET  /api/admin/program-pricing/decisions?licence=&program= → { decisions, total }
//   GET  /api/admin/program-pricing/decisions.csv?licence=&program=
//   GET  /api/admin/licences/:uid/program-pricing → { snapshot, country_index_ppm, index_reason, model_version,
//        programs: [{ program_key, name, base, base_reason, recommendation, accepted, grant, decisions }] }
// The price itself is set by the grant and change-terms writes (programGrantsApi.grant / changeTerms) with a
// `pricing` object: { licence_snapshot_uid?, accepted_annual_fee_cents?, accepted_initial_fee_cents?,
// override_reason?, effective_from?, effective_to? }.
import { api, request } from '../api.js';

const enc = encodeURIComponent;
const query = (f = {}) => {
  const q = new URLSearchParams(Object.entries(f).filter(([, v]) => v));
  return q.toString() ? `?${q}` : '';
};

export const programPricingApi = {
  defaults: () => request('/admin/program-pricing/defaults'),
  publish: (program, body) => request(`/admin/program-pricing/defaults/${enc(program)}`, { method: 'POST', body: JSON.stringify(body || {}) }),
  decisions: (f) => request(`/admin/program-pricing/decisions${query(f)}`),
  decisionsCsv: (f) => api._downloadCsv(`/admin/program-pricing/decisions.csv${query(f)}`, 'program-pricing.csv'),
  forLicence: (uid) => request(`/admin/licences/${enc(uid)}/program-pricing`),
};
