// D928 (#2724, part 5 of #2370) — the reads behind one partner deal and behind
// Referrals. Admin only; nothing here writes. Worker: routes/admin_partners_reads.ts.
import { request } from '../api.js';

const qs = (o) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(o || {})) if (v != null && v !== '') p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : '';
};

export const partnerDealReadsApi = {
  /** The row, its invitation, envelope, due-diligence case and KYB, obligations per key, and history. */
  deal: (id) => request(`/admin/partners/deals/${encodeURIComponent(id)}`),
  /** Who would lose a grant if the deal were terminated now. */
  terminatePreview: (id) => request(`/admin/partners/deals/${encodeURIComponent(id)}/terminate-preview`),
  /** Filters: `attribution`, `partner`, `deal`, `window_within`, `from`, `to`, `q`; `sort` newest, window or partner; `page`, `limit`. */
  redemptions: ({ attribution, partner, deal, window_within, from, to, q, sort, page, limit } = {}) =>
    request(`/admin/partners/redemptions${qs({ attribution, partner, deal, window_within, from, to, q, sort, page, limit })}`),
  /** Whether the Partner Services agreement can be sent (D923 §2): `{ ready, reason, fields }`. */
  agreementReady: () => request('/admin/partners/agreement-ready'),
};
