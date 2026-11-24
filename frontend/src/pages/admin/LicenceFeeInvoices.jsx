import { useCallback, useEffect, useState } from 'react';
import { licenceFeeInvoicesApi } from '../../lib/api/licenceFeeInvoices';
import { licencePricingApi } from '../../lib/api/licencePricing.js';
import { Pill } from '../../ui';
import { useConsequenceSheet } from './LicenceConsequenceSheet';
import LicenceOutcomeCard, { useLicenceWrite } from './LicenceOutcomeCard';
import { FEE_CHANGE_NOTE, feeLine, invoiceStatus, money, paidLine, parseAmount, splitInvoices, voidLine } from './licenceFeeInvoicesModel';
import { TryAgain } from './licences/LicenceOverview';
import LicenceInitialInvoice, { PaymentForm } from './LicenceInitialInvoice';

/**
 * D802 (#2238) — HQ's "Annual fee invoices" on a licence: one invoice per
 * licence year, issued from the ledger's annual fee, with what was received
 * recorded by hand (D.8) and the PDF as issued. Plain controls; D801 (#2234)
 * restyles it from board L9 if needed. Issuing and recording ask for a recent
 * sign-in, which `lib/api.js` prompts for.
 *
 * D4819 part 12 (#5923) — board L13, Operations › Billing: "Annual licence-fee
 * invoices", each with its state, the PDF as issued and Void…, which asks for
 * a reason before it sends. A void invoice shows the reason it was voided. The
 * foot says what Void records and that an issued invoice keeps its fee. A
 * failed read says so with Try again; it is never "no invoices".
 *
 * D5956 (#5956), boards L41 to L45 — the one-off initial invoice (D5954) is its own card above the annual list, which
 * no longer lists it. The card reads the pricing decision apart (`GET /:uid/pricing`), so the two load and fail apart.
 */
// `today` (a UTC day) is the Worker's own clock for Overdue (D5036); a test passes it.
export default function LicenceFeeInvoices({ licence, api = licenceFeeInvoicesApi, pricingApi = licencePricingApi, today = new Date().toISOString().slice(0, 10) }) {
  const [read, setRead] = useState({ status: 'loading', data: null, message: '' });
  const [pricing, setPricing] = useState({ status: 'loading', data: null });
  const loadPricing = useCallback(() => {
    setPricing((p) => (p.status === 'ready' ? p : { status: 'loading', data: null }));
    return Promise.resolve().then(() => pricingApi.get(licence.uid)).then(
      (data) => setPricing({ status: 'ready', data }),
      () => setPricing({ status: 'unreadable', data: null }),
    );
  }, [pricingApi, licence.uid]);
  useEffect(() => { loadPricing(); }, [loadPricing]);
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
  // D4819 part 21 (#5928): Issue and Void go through the one consequence sheet (L17) and report in the L18 card.
  const [sheet, ask] = useConsequenceSheet();
  const write = useLicenceWrite({ onSettled: load, tag: 'licence_fee_invoices' });
  const issue = async () => {
    const out = await ask('issueInvoice', licence, { target: { amount: money(read.data?.annual_fee_cents, read.data?.currency) } });
    if (out) await write.run('issueInvoice', () => api.issue(licence.uid));
  };
  // D5956: the review sheet (L42) names the two lines and the total as the card drew them; the Worker's refusal is shown as given.
  const issueInitial = async (card) => {
    const out = await ask('issueInitialInvoice', licence, { target: { lines: card.lines, total: card.total, nrSurcharge: card.nrSurcharge } });
    if (out) await write.run('issueInitialInvoice', () => api.issueInitial(licence.uid));
  };
  const voidOne = async (inv) => {
    const out = await ask('voidInvoice', licence, { target: inv });
    if (!out?.reason) return;
    await write.run('voidInvoice', async () => {
      try { return await api.voidInvoice(licence.uid, inv.uid, out.reason, inv.revision); }
      catch (e) { if (e?.code === 'invoice_changed') await load(); throw e; } // D4694: show it as it now stands
    });
  };

  const act = async (fn, done) => {
    setBusy(true); setOutcome(null);
    try { await fn(); setOutcome({ tone: 'ok', text: done }); await load(); }
    catch (e) {
      setOutcome({ tone: 'error', text: e?.message || 'Nothing was saved.' });
      // D4694 — another write got there first: show the invoice as it now stands, so the next try starts from it.
      if (e?.code === 'invoice_changed') await load();
    }
    finally { setBusy(false); }
  };

  const download = (inv) => act(async () => {
    const { blob, filename } = await api.pdfBlob(licence.uid, inv.uid);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = filename; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, 'PDF downloaded.');
  const record = (inv, cents, note) => act(() => api.recordPayment(licence.uid, inv.uid, cents, note, inv.revision), 'Payment recorded.');
  const initialCard = (
    <LicenceInitialInvoice licence={licence} invoicesRead={read} pricingRead={pricing} today={today} busy={busy || write.busy}
      onIssue={issueInitial} onVoid={voidOne} onRecord={record} onPdf={download}
      onRetry={() => { load(); loadPricing(); }} />
  );
  if (read.status === 'loading') return <div>{initialCard}<p className="text-sm text-gray-600" data-testid="fee-invoices-loading">Reading the invoices…</p></div>;
  if (read.status !== 'ready') {
    return (
      <div>
        {initialCard}
        <p className="text-sm text-red-700" role="alert" data-testid="fee-invoices-unreadable">
          The invoices could not be read, so whether any is issued or owed is unknown — not none. {read.message}{' '}
          <TryAgain what="the invoices" onClick={() => { setRead({ status: 'loading', data: null, message: '' }); load(); }} />
        </p>
      </div>
    );
  }
  const fee = feeLine(read.data);
  const invoices = splitInvoices(read.data.invoices).annual;
  return (
    <div data-testid="fee-invoices">
      {sheet}
      {initialCard}
      <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Annual licence-fee invoices</h3>
      {fee && <p className={`mt-1 text-[12.5px] ${fee.ok ? 'text-gray-600 dark:text-gray-400' : 'text-amber-800'}`} data-testid="fee-invoices-fee">{fee.text}</p>}
      <div className="mt-3">
        <button type="button" disabled={busy || write.busy || !fee?.ok} data-testid="fee-invoices-issue"
          className="rounded bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
          onClick={issue}>
          Issue this licence year's invoice
        </button>
      </div>
      <LicenceOutcomeCard outcome={write.outcome} busy={write.busy} onReread={load} onDismiss={write.clear} testId="fee-invoices-write-outcome" />
      {outcome && (
        <p role={outcome.tone === 'error' ? 'alert' : 'status'} data-testid={`fee-invoices-outcome-${outcome.tone}`}
          className={`mt-2 text-[12.5px] ${outcome.tone === 'error' ? 'text-red-700' : 'text-emerald-700'}`}>{outcome.text}</p>
      )}
      {invoices.length === 0 ? (
        <p className="mt-3 text-sm text-gray-600" data-testid="fee-invoices-empty">No annual invoice has been issued on this licence yet.</p>
      ) : (
        <table className="mt-3 w-full text-left text-[12.5px]" data-testid="fee-invoices-table">
          <thead>
            <tr className="text-[11px] uppercase text-gray-500">
              <th className="py-1 pr-3">Invoice</th><th className="py-1 pr-3">Licence year</th><th className="py-1 pr-3 text-right">Amount</th>
              <th className="py-1 pr-3">Due</th><th className="py-1 pr-3">Received</th><th className="py-1 pr-3">State</th><th className="py-1"><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {invoices.map((inv) => <InvoiceRow key={inv.uid} inv={inv} busy={busy || write.busy} today={today} onVoid={voidOne} onPdf={download} onRecord={record} />)}
          </tbody>
        </table>
      )}
      <p className="mt-3 text-[11px] text-gray-500 dark:text-gray-400" data-testid="fee-invoices-foot">{FEE_CHANGE_NOTE}</p>
    </div>
  );
}

function InvoiceRow({ inv, busy, today, onVoid, onPdf, onRecord }) {
  const status = invoiceStatus(inv, today);
  const [mode, setMode] = useState(null);
  return (
    <>
      <tr className="border-t border-gray-100 dark:border-gray-800" data-testid={`fee-invoice-${inv.uid}`}>
        <td className="py-1.5 pr-3 font-mono text-[12px]">{inv.reference || 'Not recorded'}<div className="font-sans text-[11px] text-gray-500">Issued {inv.issued_at ? String(inv.issued_at).slice(0, 10) : 'Not recorded'}</div></td>
        <td className="py-1.5 pr-3">{inv.period_label}</td>
        <td className="py-1.5 pr-3 text-right font-mono">{money(inv.amount_cents, inv.currency)}</td>
        <td className="py-1.5 pr-3 font-mono">{inv.due_at ? String(inv.due_at).slice(0, 10) : 'Not recorded'}</td>
        <td className="py-1.5 pr-3">{paidLine(inv)}</td>
        <td className="py-1.5 pr-3"><Pill tone={status.tone}>{status.word}</Pill>{status.overdue && <div className="text-[11px] text-red-700 dark:text-red-300" data-testid="fee-invoice-overdue">{status.days} {status.days === 1 ? 'day' : 'days'} past due</div>}{inv.status === 'void' && <div className="text-[11px] text-gray-600 dark:text-gray-400" data-testid="fee-invoice-void-reason">{voidLine(inv)}</div>}</td>
        <td className="py-1.5">
          {inv.pdf_url && <button type="button" className="mr-2 underline" disabled={busy} onClick={() => onPdf(inv)} data-testid="fee-invoice-pdf">PDF</button>}
          {inv.status !== 'void' && <button type="button" className="mr-2 underline" onClick={() => setMode(mode === 'pay' ? null : 'pay')} data-testid="fee-invoice-record">Record payment</button>}
          {inv.status !== 'void' && inv.paid_cents === 0 && <button type="button" className="underline text-red-700" disabled={busy} onClick={() => onVoid(inv)} data-testid="fee-invoice-void">Void…</button>}
        </td>
      </tr>
      {mode === 'pay' && (
        <tr><td colSpan={7} className="pb-2">
          <PaymentForm inv={inv} busy={busy} cents={(t) => parseAmount(t, inv.currency)} onSave={(paid, note) => onRecord(inv, paid, note)} />
        </td></tr>
      )}
    </>
  );
}
