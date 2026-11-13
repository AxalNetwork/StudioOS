// D806 (#2245) — Billing's one invoice list: the member's paid orders (token
// packs, auto-reloads, other items) and their Stripe plan invoices, newest
// first, paged. Worker: routes/billing.ts (GET /api/billing/invoices).
import { request } from '../api.js';

export const billingInvoicesApi = {
  // → { invoices: [{ kind: 'order'|'stripe', id, date, description, amount_cents, currency,
  //     status: 'paid'|'refunded'|'partly_refunded'|'open'|'void', pdf_url }], page, per, total,
  //     degraded?: ['stripe'] } — `degraded` when Stripe could not be read; the orders still list.
  list: ({ page = 1, per = 25 } = {}) =>
    request(`/billing/invoices?page=${encodeURIComponent(page)}&per=${encodeURIComponent(per)}`),
};
