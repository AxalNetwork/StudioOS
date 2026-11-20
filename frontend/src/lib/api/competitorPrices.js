/**
 * D7723 (#7723): competitor prices on stated terms, with capture date, source and history
 * (routes/competitor_prices.ts). A hint from an analysis is a proposal, never a price:
 * `proposals` writes nothing and prefills nothing. `amount` is text exactly as the source
 * states it (`'0.0004'`), never a number; `null` is a quote with no public figure or a
 * withdrawn price. With no `project`, reads and writes cover the caller's own unattached prices.
 */
import { request } from '../api.js';

const query = (params = {}) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') p.set(k, String(v));
  }
  const s = p.toString();
  return s ? `?${s}` : '';
};

export const competitorPricesApi = {
  /** `analysisId` → `{ analysis_id, project_id, proposals: [{ candidate_id, competitor_name, competitor_domain, hints: [{ hint_text }], pages }], saved: false }`. */
  proposals: (analysisId) => request(`/competitor-prices/proposals${query({ analysis: analysisId })}`),
  /** `{ competitor, project? }` → `{ project_id, current: [price] }`. */
  current: (params) => request(`/competitor-prices${query(params)}`),
  /** `{ competitor, product, plan, project? }` → `{ project_id, series: [price] }`, oldest capture first, replaced and withdrawn rows included. */
  series: (params) => request(`/competitor-prices/series${query(params)}`),
  /** Every term stated, `source_use_confirmed: true`; `corrects` names the price a correction replaces. → `{ price }`. */
  save: (price) => request('/competitor-prices', { method: 'POST', body: JSON.stringify(price) }),
  /** → `{ price }` with no amount and no source link, and `withdrawn: { at, by, reason }`. */
  withdraw: (uid, reason) => request(`/competitor-prices/${encodeURIComponent(uid)}/withdraw`, { method: 'POST', body: JSON.stringify({ reason }) }),
};
