import { useCallback, useEffect, useState } from 'react';
import { licenceFeeInvoicesApi } from '../../lib/api/licenceFeeInvoices';
import { Pill } from '../../ui';
import { STATUS_TONE, STATUS_WORDS, feeLine, money, paidLine, parseAmount } from './licenceFeeInvoicesModel';

/**
 * D802 (#2238) — HQ's "Annual fee invoices" on a licence: one invoice per
 * licence year, issued from the ledger's annual fee, with what was received
 * recorded by hand (D.8) and the PDF as issued. Plain controls; D801 (#2234)
 * restyles it from board L9 if needed. Issuing and recording ask for a recent
 * sign-in, which `lib/api.js` prompts for.
 */
export default function LicenceFeeInvoices({ licence, api = licenceFeeInvoicesApi }) {
  const [read, setRead] = useState({ status: 'loading', data: null, message: '' });
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState(null);
  const load = useCallback(() => {
    setRead((r) => (r.status === 'ready' ? r : { status: 'loading', data: null, message: '' }));
    return Promise.resolve().then(() => api.list(licence.uid)).then(
      (data) => setRead({ status: 'ready', data, message: '' }),
      (e) => setRead({ status: 'unreadable', data: null, message: e?.message || '' }),
    );
  }, [api, licence.uid]);
  useEffect(() => { load(); }, [load]);

  const act = async (fn, done) => {
    setBusy(true); setOutcome(null);
    try { await fn(); setOutcome({ tone: 'ok', text: done }); await load(); }
    catch (e) { setOutcome({ tone: 'error', text: e?.message || 'Nothing was saved.' }); }
    finally { setBusy(false); }
  };

  if (read.status === 'loading') return <p className="text-sm text-gray-600" data-testid="fee-invoices-loading">Reading the invoices…</p>;
  if (read.status !== 'ready') {
    return (
      <p className="text-sm text-red-700" role="alert" data-testid="fee-invoices-unreadable">
        The invoices could not be read. {read.message} <button type="button" className="underline" onClick={load}>Try again</button>
      </p>
    );
  }
  const fee = feeLine(read.data);
  const invoices = Array.isArray(read.data.invoices) ? read.data.invoices : [];
  return (
    <div data-testid="fee-invoices">
      <h3 className="text-sm font-medium text-gray-900 dark:text-gray-100">Annual fee invoices</h3>
      {fee && <p className={`mt-1 text-[12.5px] ${fee.ok ? 'text-gray-600 dark:text-gray-400' : 'text-amber-800'}`} data-testid="fee-invoices-fee">{fee.text}</p>}
      <div className="mt-3">
        <button type="button" disabled={busy || !fee?.ok} data-testid="fee-invoices-issue"
          className="rounded bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
          onClick={() => act(() => api.issue(licence.uid), 'Invoice issued.')}>
          Issue this licence year's invoice
        </button>
      </div>
      {outcome && (
        <p role={outcome.tone === 'error' ? 'alert' : 'status'} data-testid={`fee-invoices-outcome-${outcome.tone}`}
          className={`mt-2 text-[12.5px] ${outcome.tone === 'error' ? 'text-red-700' : 'text-emerald-700'}`}>{outcome.text}</p>
      )}
      {invoices.length === 0 ? (
        <p className="mt-3 text-sm text-gray-600" data-testid="fee-invoices-empty">No invoice has been issued on this licence yet.</p>
      ) : (
        <table className="mt-3 w-full text-left text-[12.5px]" data-testid="fee-invoices-table">
          <thead>
            <tr className="text-[11px] uppercase text-gray-500">
              <th className="py-1 pr-3">Licence year</th><th className="py-1 pr-3">Issued</th><th className="py-1 pr-3">Due</th>
              <th className="py-1 pr-3 text-right">Amount</th><th className="py-1 pr-3">Received</th><th className="py-1 pr-3">Status</th><th className="py-1">Actions</th>
            </tr>
          </thead>
          <tbody>
            {invoices.map((inv) => <InvoiceRow key={inv.uid} inv={inv} licence={licence} api={api} busy={busy} act={act} />)}
          </tbody>
        </table>
      )}
    </div>
  );
}

function InvoiceRow({ inv, licence, api, busy, act }) {
  const [mode, setMode] = useState(null);
  const [amount, setAmount] = useState(inv.paid_cents > 0 ? (inv.paid_cents / 100).toFixed(2) : '');
  const [note, setNote] = useState('');
  const cents = parseAmount(amount);
  const download = () => act(async () => {
    const { blob, filename } = await api.pdfBlob(licence.uid, inv.uid);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = filename; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, 'PDF downloaded.');
  return (
    <>
      <tr className="border-t border-gray-100 dark:border-gray-800" data-testid={`fee-invoice-${inv.uid}`}>
        <td className="py-1.5 pr-3">{inv.period_label}<div className="font-mono text-[11px] text-gray-500">{inv.reference}</div></td>
        <td className="py-1.5 pr-3">{inv.issued_at}</td>
        <td className="py-1.5 pr-3">{inv.due_at}</td>
        <td className="py-1.5 pr-3 text-right font-mono">{money(inv.amount_cents, inv.currency)}</td>
        <td className="py-1.5 pr-3">{paidLine(inv)}</td>
        <td className="py-1.5 pr-3"><Pill tone={STATUS_TONE[inv.status] || 'neutral'}>{STATUS_WORDS[inv.status] || inv.status}</Pill></td>
        <td className="py-1.5">
          {inv.pdf_url && <button type="button" className="mr-2 underline" disabled={busy} onClick={download} data-testid="fee-invoice-pdf">PDF</button>}
          {inv.status !== 'void' && <button type="button" className="mr-2 underline" onClick={() => setMode(mode === 'pay' ? null : 'pay')} data-testid="fee-invoice-record">Record payment</button>}
          {inv.status !== 'void' && inv.paid_cents === 0 && <button type="button" className="underline text-red-700" onClick={() => setMode(mode === 'void' ? null : 'void')} data-testid="fee-invoice-void">Void</button>}
        </td>
      </tr>
      {mode === 'pay' && (
        <tr><td colSpan={7} className="pb-2">
          <form className="flex flex-wrap items-center gap-2" data-testid="fee-invoice-pay-form"
            onSubmit={(e) => { e.preventDefault(); if (cents !== null) act(() => api.recordPayment(licence.uid, inv.uid, cents, note.trim()), 'Payment recorded.'); }}>
            <label className="text-[12px]">Total received ({inv.currency})
              <input className="ml-2 w-32 rounded border px-2 py-1 font-mono" inputMode="decimal" value={amount}
                onChange={(e) => setAmount(e.target.value)} data-testid="fee-invoice-paid" aria-invalid={cents === null ? 'true' : undefined} />
            </label>
            <input className="w-56 rounded border px-2 py-1" placeholder="Bank reference (optional)" value={note} onChange={(e) => setNote(e.target.value)} data-testid="fee-invoice-note" />
            <button type="submit" className="rounded bg-indigo-600 px-3 py-1 text-xs text-white disabled:opacity-50" disabled={busy || cents === null} data-testid="fee-invoice-save">Save</button>
            {cents === null && <span className="text-[12px] text-red-700" data-testid="fee-invoice-paid-error">Enter the total received, with at most two decimals.</span>}
          </form>
        </td></tr>
      )}
      {mode === 'void' && (
        <tr><td colSpan={7} className="pb-2">
          <form className="flex flex-wrap items-center gap-2" data-testid="fee-invoice-void-form"
            onSubmit={(e) => { e.preventDefault(); if (note.trim().length >= 10) act(() => api.voidInvoice(licence.uid, inv.uid, note.trim()), 'Invoice voided.'); }}>
            <input className="w-80 rounded border px-2 py-1" placeholder="Why it is void (at least 10 characters)" value={note} onChange={(e) => setNote(e.target.value)} data-testid="fee-invoice-void-note" />
            <button type="submit" className="rounded border border-red-300 px-3 py-1 text-xs text-red-700 disabled:opacity-50" disabled={busy || note.trim().length < 10} data-testid="fee-invoice-void-save">Void invoice</button>
          </form>
        </td></tr>
      )}
    </>
  );
}
