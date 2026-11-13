// D1274 (#3300, part 4 of Promo codes #2381) — what HQ reads about
// redemptions. Worker: routes/admin_promos.ts over services/promoUsage.ts, at
// /api/admin/promos. Super Admin only.
//
// Every block is `{ available, reason, ... }`: `reason` is `unreadable`,
// `no_redemptions` or `not_recorded` (a redemption from before migration 631
// carries no source, product or amount), never a zero in its place.
import { api, request } from '../api.js';

const enc = encodeURIComponent;
// `{ from?, to?, promo? }`: whole UTC days, YYYY-MM-DD, at most 366 apart; the
// Worker defaults to the last twelve weeks. Empty values are dropped.
const query = (params) => {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params ?? {})) if (v !== undefined && v !== null && v !== '') q.set(k, String(v));
  const s = q.toString();
  return s ? `?${s}` : '';
};

export const promoUsageApi = {
  // The Usage tab: `{ range, redemptions, discount, top_codes, products, near_end }`.
  usage: (range) => request(`/admin/promos/usage${query(range)}`),
  // One code's recorded redemptions, newest first, with Stripe's own count
  // (`stripe.times_redeemed`), which is the count to show.
  redemptions: (id) => request(`/admin/promos/${enc(id)}/redemptions`),
  // One code's create, pause, resume and end, from the audit log.
  history: (id) => request(`/admin/promos/${enc(id)}/history`),
  // The range's redemptions as a CSV; the export is audited.
  exportCsv: (range) => api._downloadCsv(`/admin/promos/export.csv${query(range)}`, 'promo-redemptions.csv'),
};
