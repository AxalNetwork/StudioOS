// D802 (#2238) — HQ's annual licence-fee invoices to a territory licensee.
// Worker: routes/admin_licence_fee_invoices.ts (Super Admin), migration 513's
// `licence_fee_invoices`; the period and the paper are `services/licenceFeeInvoice.ts`.
//   GET   /api/admin/licences/:uid/fee-invoices → { invoices, next_period, can_issue, issue_refusal, annual_fee_cents, currency }
//   POST  /api/admin/licences/:uid/fee-invoices { period_start? } → the invoice; 409 period_invoiced, no_annual_fee,
//                                                licence_not_active; 403 step_up_required (a TOTP session and a recent step-up)
//   PATCH /api/admin/licences/:uid/fee-invoices/:invoiceUid { paid_cents, paid_note } | { status: 'void', void_reason }
//   GET   /api/admin/licences/:uid/fee-invoices/:invoiceUid/pdf (binary; 409 invoice_void, 503 when it cannot be drawn)
// The Administrator reads their own on `/api/licence/mine/statements` as `fee_invoices`.
import { request, refusalError } from '../api.js';

const enc = encodeURIComponent;

export const licenceFeeInvoicesApi = {
  list: (uid) => request(`/admin/licences/${enc(uid)}/fee-invoices`),
  issue: (uid, periodStart) => request(`/admin/licences/${enc(uid)}/fee-invoices`, {
    method: 'POST',
    body: JSON.stringify(periodStart ? { period_start: periodStart } : {}),
  }),
  recordPayment: (uid, invoiceUid, paidCents, paidNote) => request(`/admin/licences/${enc(uid)}/fee-invoices/${enc(invoiceUid)}`, {
    method: 'PATCH',
    body: JSON.stringify({ paid_cents: paidCents, paid_note: paidNote }),
  }),
  void: (uid, invoiceUid, reason) => request(`/admin/licences/${enc(uid)}/fee-invoices/${enc(invoiceUid)}`, {
    method: 'PATCH',
    body: JSON.stringify({ status: 'void', void_reason: reason }),
  }),
  // The invoice's PDF (binary endpoint, not typed drift). Returns the blob and its filename; the caller saves it.
  pdfBlob: async (uid, invoiceUid) => {
    const token = localStorage.getItem('token');
    const res = await fetch(`/api/admin/licences/${enc(uid)}/fee-invoices/${enc(invoiceUid)}/pdf`, {
      credentials: 'include',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) throw await refusalError(res, 'The invoice PDF could not be downloaded.');
    const blob = await res.blob();
    const filename = (res.headers.get('Content-Disposition') || '').match(/filename="?([^"]+)"?/)?.[1] || `invoice-${invoiceUid}.pdf`;
    return { blob, filename };
  },
};
