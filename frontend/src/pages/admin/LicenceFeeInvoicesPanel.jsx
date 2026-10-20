/**
 * D802 (#2238) — "Annual fee invoices" on HQ's licence page (canvas board L4's
 * Statements zone): each fee year's invoice with its period, date, amount,
 * status and PDF, and the two writes HQ makes, Issue and Record payment.
 *
 * PLAIN CONTROLS, ON PURPOSE. D801 restyles this from board L9 if needed; what
 * matters here is that each write goes to the money bar
 * (`/api/admin/licences/:uid/fee-invoices`, a TOTP session and a recent
 * step-up) and that a refusal is shown as the server's sentence, never as a
 * silent nothing.
 *
 * AMOUNTS ARE INTEGER MINOR UNITS throughout. `parseMinor` reads what an
 * operator typed ("12,500.00") into cents without a float, and refuses rather
 * than rounds anything it cannot read exactly.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { licenceFeeInvoicesApi } from '../../lib/api/licenceFeeInvoices';
import { reportError } from '../../lib/log';

const inputCls = 'w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm dark:border-gray-700 dark:bg-gray-900';
const btnCls = 'rounded-md border border-gray-300 px-2 py-1 text-[11px] font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800';

export const STATUS_LABEL = { issued: 'Issued', paid: 'Paid', void: 'Void' };

/** Integer minor units as "EUR 12,500.00", never through a float. */
export function money(cents, currency) {
  const n = Number(cents);
  if (!Number.isSafeInteger(n)) return '—';
  const abs = Math.abs(n);
  const whole = Math.floor(abs / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${n < 0 ? '-' : ''}${String(currency || '').toUpperCase()} ${whole}.${String(abs % 100).padStart(2, '0')}`;
}

/** "12,500.00" or "12500" → 1250000; anything else (three decimals, letters, negative) → null. */
export function parseMinor(text) {
  const t = String(text ?? '').replace(/,/g, '').trim();
  const m = /^(\d+)(?:\.(\d{1,2}))?$/.exec(t);
  if (!m) return null;
  const cents = Number(m[1]) * 100 + Number((m[2] || '').padEnd(2, '0'));
  return Number.isSafeInteger(cents) ? cents : null;
}

/** The server's refusal as a sentence. */
export function writeError(e, fallback) {
  if (e?.code === 'step_up_required') return 'Your step-up has lapsed. Confirm with your authenticator, then try again. Nothing was saved.';
  return e?.message || fallback;
}

function saveBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function PaymentForm({ invoice, onRecord, onVoid }) {
  const [amount, setAmount] = useState(() => (Number(invoice.paid_cents) ? '' : (Number(invoice.amount_cents) / 100).toFixed(2)));
  const [note, setNote] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const run = async (fn, fallback) => {
    setBusy(true); setError('');
    try { await fn(); } catch (e) { setError(writeError(e, fallback)); } finally { setBusy(false); }
  };
  const record = () => {
    const cents = parseMinor(amount);
    if (cents === null) { setError('Give the amount received as a number with at most two decimals.'); return; }
    run(() => onRecord(cents, note.trim()), 'The payment could not be recorded. Nothing was changed.');
  };
  return (
    <div className="mt-2 space-y-2 rounded-md border border-gray-200 p-2 dark:border-gray-800" data-testid={`fee-invoice-form-${invoice.uid}`}>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <label className="text-[11px] text-gray-600 dark:text-gray-400">
          Amount received in total ({invoice.currency})
          <input className={inputCls} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} aria-label="Amount received" />
        </label>
        <label className="text-[11px] text-gray-600 dark:text-gray-400">
          Reference or note
          <input className={inputCls} value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} aria-label="Payment note" />
        </label>
      </div>
      <button type="button" className={btnCls} disabled={busy} onClick={record}>Record payment</button>
      {!Number(invoice.paid_cents) && (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <label className="flex-1 text-[11px] text-gray-600 dark:text-gray-400">
            Why void it (ten characters or more)
            <input className={inputCls} value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} aria-label="Void reason" />
          </label>
          <button type="button" className={btnCls} disabled={busy || reason.trim().length < 10}
            onClick={() => run(() => onVoid(reason.trim()), 'The invoice could not be voided. Nothing was changed.')}>Void invoice</button>
        </div>
      )}
      {error && <p className="text-[11px] text-red-700 dark:text-red-400" role="alert">{error}</p>}
    </div>
  );
}

/** The list and its controls, given the read. Separate from the loader so a test can draw it. */
export function FeeInvoicesList({ data, onIssue, onRecord, onVoid, onPdf }) {
  const [open, setOpen] = useState(null);
  const [issueError, setIssueError] = useState('');
  const [busy, setBusy] = useState(false);
  const invoices = data?.invoices || [];
  const issue = async () => {
    setBusy(true); setIssueError('');
    try { await onIssue(); } catch (e) { setIssueError(writeError(e, 'The invoice could not be issued. Nothing was saved.')); } finally { setBusy(false); }
  };
  return (
    <div data-testid="fee-invoices-panel">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Annual fee invoices</h3>
        <button type="button" className={btnCls} disabled={busy || !data?.can_issue} onClick={issue} data-testid="fee-invoice-issue">
          {data?.next_period ? `Issue ${data.next_period.period_label}` : 'Issue'}
        </button>
      </div>
      {data?.issue_refusal && <p className="mt-1 text-[11px] text-gray-500 dark:text-gray-400" data-testid="fee-invoice-issue-refusal">{data.issue_refusal}</p>}
      {issueError && <p className="mt-1 text-[11px] text-red-700 dark:text-red-400" role="alert">{issueError}</p>}
      {invoices.length === 0 ? (
        <p className="mt-2 text-[12px] text-gray-500 dark:text-gray-400" data-testid="fee-invoices-empty">No fee invoice has been issued for this licence.</p>
      ) : (
        <ul className="mt-2 divide-y divide-gray-100 dark:divide-gray-800">
          {invoices.map((inv) => (
            <li key={inv.uid} className="py-2 text-[12px]" data-testid={`fee-invoice-${inv.uid}`}>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="font-medium text-gray-900 dark:text-gray-100">{inv.period_label}</span>
                <span className="text-gray-500 dark:text-gray-400">{String(inv.issued_at || '').slice(0, 10)}</span>
                <span className="font-mono text-gray-800 dark:text-gray-200">{money(inv.amount_cents, inv.currency)}</span>
                <span className="text-gray-700 dark:text-gray-300" data-testid={`fee-invoice-status-${inv.uid}`}>
                  {STATUS_LABEL[inv.status] || inv.status}
                  {inv.status === 'issued' && Number(inv.paid_cents) > 0 ? ` · ${money(inv.paid_cents, inv.currency)} received` : ''}
                </span>
                <span className="text-gray-500 dark:text-gray-400">Due {String(inv.due_at || '').slice(0, 10)}</span>
                {inv.pdf_url && <button type="button" className={btnCls} onClick={() => onPdf(inv)}>PDF</button>}
                {inv.status === 'issued' && (
                  <button type="button" className={btnCls} onClick={() => setOpen(open === inv.uid ? null : inv.uid)}>
                    {open === inv.uid ? 'Close' : 'Record payment'}
                  </button>
                )}
              </div>
              {inv.status === 'void' && inv.void_reason && <div className="mt-1 text-[11px] text-gray-500 dark:text-gray-400">Voided: {inv.void_reason}</div>}
              {open === inv.uid && inv.status === 'issued' && (
                <PaymentForm
                  invoice={inv}
                  onRecord={async (cents, note) => { await onRecord(inv, cents, note); setOpen(null); }}
                  onVoid={async (reason) => { await onVoid(inv, reason); setOpen(null); }}
                />
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function LicenceFeeInvoicesPanel({ licence, api = licenceFeeInvoicesApi, save = saveBlob }) {
  const uid = licence?.uid;
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [pdfError, setPdfError] = useState('');
  const load = useCallback(async () => {
    if (!uid) return;
    try { setData(await api.list(uid)); setError(''); } catch (e) {
      reportError('licence_fee_invoices_load', e);
      setError('The fee invoices could not be read just now.');
    }
  }, [uid, api]);
  useEffect(() => { load(); }, [load]);
  return (
    <div className="mt-4 rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
      {error ? <p className="text-[12px] text-red-700 dark:text-red-400" role="alert">{error}</p> : (
        <FeeInvoicesList
          data={data}
          onIssue={async () => { await api.issue(uid); await load(); }}
          onRecord={async (inv, cents, note) => { await api.recordPayment(uid, inv.uid, cents, note); await load(); }}
          onVoid={async (inv, reason) => { await api.void(uid, inv.uid, reason); await load(); }}
          onPdf={async (inv) => {
            setPdfError('');
            try { const { blob, filename } = await api.pdfBlob(uid, inv.uid); save(blob, filename); } catch (e) {
              reportError('licence_fee_invoice_pdf', e);
              setPdfError(writeError(e, 'The invoice PDF could not be downloaded.'));
            }
          }}
        />
      )}
      {pdfError && <p className="mt-2 text-[11px] text-red-700 dark:text-red-400" role="alert">{pdfError}</p>}
    </div>
  );
}
