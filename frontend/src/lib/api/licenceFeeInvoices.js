// D802 (#2238) — HQ's annual licence-fee invoices to a territory licensee:
// list, issue this licence year's, record what was received or void, and the
// PDF. Worker: routes/admin_licences.ts (/api/admin/licences/:uid/fee-invoices),
// Super Admin; issuing and recording ask for a recent sign-in. The
// Administrator's own invoices arrive on licenceAccountApi.statements().
import { request, refusalError } from '../api.js';

const enc = encodeURIComponent;

/** A PDF as a blob and its filename (binary endpoint, not typed drift). */
async function pdfBlob(path, fallbackName) {
  const token = localStorage.getItem('token');
  const res = await fetch(`/api${path}`, { credentials: 'include', headers: token ? { Authorization: `Bearer ${token}` } : {} });
  if (!res.ok) throw await refusalError(res, 'The invoice PDF could not be downloaded.');
  const blob = await res.blob();
  const filename = (res.headers.get('Content-Disposition') || '').match(/filename="?([^"]+)"?/)?.[1] || fallbackName;
  return { blob, filename };
}

export const licenceFeeInvoicesApi = {
  /** `{ invoices, annual_fee_cents, currency, starts_on }`, newest licence year first. */
  list: (licenceUid) => request(`/admin/licences/${enc(licenceUid)}/fee-invoices`),
  /** Issue the invoice for the licence year that holds today. */
  issue: (licenceUid) => request(`/admin/licences/${enc(licenceUid)}/fee-invoices`, { method: 'POST' }),
  /**
   * The running total received, in cents, with an optional note. `expectedRevision` is the invoice's
   * `revision` as the screen read it (D4694): a 409 `invoice_changed` means another write got there first.
   */
  recordPayment: (licenceUid, invoiceUid, paidCents, paidNote, expectedRevision) => request(`/admin/licences/${enc(licenceUid)}/fee-invoices/${enc(invoiceUid)}`, {
    method: 'PATCH', body: JSON.stringify({ paid_cents: paidCents, ...(paidNote ? { paid_note: paidNote } : {}), expected_revision: expectedRevision }),
  }),
  /** Void an invoice with nothing paid on it; the reason is required, and so is the revision the screen read. */
  voidInvoice: (licenceUid, invoiceUid, voidNote, expectedRevision) => request(`/admin/licences/${enc(licenceUid)}/fee-invoices/${enc(invoiceUid)}`, {
    method: 'PATCH', body: JSON.stringify({ status: 'void', void_note: voidNote, expected_revision: expectedRevision }),
  }),
  pdfBlob: (licenceUid, invoiceUid) => pdfBlob(`/admin/licences/${enc(licenceUid)}/fee-invoices/${enc(invoiceUid)}/pdf`, `invoice-${invoiceUid}.pdf`),
  /** The Administrator's copy of one of their own invoices. */
  minePdfBlob: (invoiceUid) => pdfBlob(`/licence/mine/fee-invoices/${enc(invoiceUid)}/pdf`, `invoice-${invoiceUid}.pdf`),
};
