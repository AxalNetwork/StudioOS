import { request } from '../api.js';

/** #4709 (D4709): Delivery's paged lists, and the amendment a sent report takes (partner_delivery.ts).
 * Each page read takes `{ cursor, limit }` and answers the list's usual body plus
 * `page: { limit, returned, total, next_cursor, complete }`; the figures beside the rows are the whole book's.
 * amendPartnerStatusReport(id, note) -> the sent report, unchanged, with `amendments` (who, when, what).
 */
function pageQuery(o) {
  const p = new URLSearchParams();
  if (o?.cursor) p.set('cursor', o.cursor);
  if (o?.limit) p.set('limit', String(o.limit));
  const s = p.toString();
  return s ? `?${s}` : '';
}

export const partnerDeliveryHistoryApi = {
  partnerDeliveryBoardPage: (o) => request(`/partner/delivery/board${pageQuery(o)}`),
  partnerDeliveryHealthPage: (o) => request(`/partner/delivery/health${pageQuery(o)}`),
  partnerDeliverablesPage: (o) => request(`/partner/delivery/deliverables${pageQuery(o)}`),
  partnerStatusReportsPage: (o) => request(`/partner/delivery/status-reports${pageQuery(o)}`),
  amendPartnerStatusReport: (id, note) =>
    request(`/partner/delivery/status-reports/${encodeURIComponent(id)}/amendments`, {
      method: 'POST', body: JSON.stringify({ note }),
    }),
};
