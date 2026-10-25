// D1011 (#2830, part 3 of Payments #2386) — the Payments page's change log
// (PAY7) and the webhook's deliveries by hour (PAY5). Worker:
// routes/admin_payments.ts (/api/admin/payments). Super Admin only.
import { api, request } from '../api.js';

// Drops empty filters, so the URL carries only what was chosen.
const query = (params) => {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params ?? {})) if (v !== undefined && v !== null && v !== '') q.set(k, String(v));
  const s = q.toString();
  return s ? `?${s}` : '';
};

export const paymentsApi = {
  // `{ what?, who?, product?, from?, to?, limit?, offset? }` → `{ entries, total, limit, offset, filters, kinds }`.
  changeLog: (filters) => request(`/admin/payments/change-log${query(filters)}`),
  // The same filters as a CSV; `reason` (10 to 500 characters) is recorded before the file is sent.
  changeLogCsv: (filters, reason) =>
    api._downloadCsv(`/admin/payments/change-log.csv${query({ ...filters, reason })}`, 'payments-change-log.csv'),
  // `{ deliveries, not_2xx, last, hours: [{ hour, deliveries, not_2xx }] }`; an hour the request log is silent on is null.
  webhookDeliveries: () => request('/admin/payments/webhook-deliveries'),
};
