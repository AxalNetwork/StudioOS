// D5020 (#5020) — HQ's country-pricing reads across the ledger: the 49-market catalogue, one market's calculation
// with its sources, the model versions, the annual review queue and the ledger's Needs HQ pricing signals.
// Worker: cloudflare-worker/src/routes/admin_licence_pricing_hq.ts over services/licencePricingHq.ts (Super Admin,
// HQ only). Every route reads; nothing here writes.
//   GET /api/admin/licence-pricing/catalogue?q=&incomplete=1&model=<uid>&allow_provisional=1
//        → { model, model_reason, model_problem, allow_provisional, stored: false, countries, total, counts }
//   GET /api/admin/licence-pricing/catalogue/:code?model=<uid>&allow_provisional=1
//        → { profile, inputs, data_completeness, last_source_update, regulatory_class, model, model_reason,
//            calculation | null, calculation_reason, observations, snapshots }
//   GET /api/admin/licence-pricing/model-versions → { current, current_reason, drafts, retired, history }
//   GET /api/admin/licence-pricing/review-queue?within_days=0..366
//        → { today, within_days, horizon, items, total, due, without_open_review, no_decision, sweep }
//   GET /api/admin/licence-pricing/signals?needs=<signal,…>&licence=<uid,…>
//        → { today, needs, items: [{ licence_uid, signals, reasons, … }], total, counts, signals }
import { request } from '../api.js';

const enc = encodeURIComponent;

function qs(params = {}) {
  const s = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '' && v !== false) s.set(k, v === true ? '1' : String(v));
  const t = s.toString();
  return t ? `?${t}` : '';
}

export const licencePricingHqApi = {
  catalogue: (params = {}) => request(`/admin/licence-pricing/catalogue${qs(params)}`),
  country: (code, params = {}) => request(`/admin/licence-pricing/catalogue/${enc(code)}${qs(params)}`),
  modelVersions: () => request('/admin/licence-pricing/model-versions'),
  reviewQueue: (params = {}) => request(`/admin/licence-pricing/review-queue${qs(params)}`),
  signals: (params = {}) => request(`/admin/licence-pricing/signals${qs(params)}`),
};
