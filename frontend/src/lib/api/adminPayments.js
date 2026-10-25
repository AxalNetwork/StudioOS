// D1010 (#2829) — Payments part 2: members per plan, and one change-a-price
// write. The catalogue read itself (`adminCatalogList`, GET
// /api/admin/catalog/products) also carries the checks, the keys' modes,
// "shows on" and each price's AI allowance. Worker: routes/catalog.ts.
import { request } from '../api.js';

export const adminPaymentsApi = {
  // Live members per price, and per plan family and interval (Super Admin).
  members: () => request('/admin/catalog/members'),
  // Add the new price and archive the old (Super Admin write bar). A reason
  // of at least ten characters is required and audited; the idempotency key
  // makes a retried press one change.
  changePrice: (priceId, { unitAmount, reason, idempotencyKey, nickname }) => request(`/admin/catalog/prices/${encodeURIComponent(priceId)}/change`, {
    method: 'POST',
    body: JSON.stringify({ unit_amount: unitAmount, reason, idempotency_key: idempotencyKey, ...(nickname ? { nickname } : {}) }),
  }),
};
