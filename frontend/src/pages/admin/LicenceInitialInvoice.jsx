/**
 * D5956 (#5956) — the "Initial invoice · one-off" card on a licence's Billing (boards L41 to L45, L49 to L51): the one
 * initial invoice a licence ever has (D5954), above the unchanged annual list. Its two lines, total and metadata;
 * Issue initial invoice… only when the reads allow it (the Worker still decides, and its refusal is shown as given);
 * Record payment and Void on the issued invoice. Not recorded, Unavailable and €0 never look alike.
 */
import { useState } from 'react';
import { Pill } from '../../ui';
import { initialFoot, initialInvoiceCard, parseAmount } from './licenceFeeInvoicesModel';
import { toMajorString } from '../../lib/money.js';

const action = 'min-h-[44px] w-full rounded-md px-3 py-2 text-sm font-medium sm:min-h-0 sm:w-auto sm:py-1.5 sm:text-xs disabled:opacity-50';
const primary = `${action} bg-indigo-600 text-white hover:bg-indigo-700`;
const quiet = `${action} border border-gray-300 text-gray-800 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-100 dark:hover:bg-gray-800`;

/** The card. `onIssue`, `onVoid`, `onRecord` and `onPdf` come from the page, which owns the writes and the reads. */
export default function LicenceInitialInvoice({ licence, invoicesRead, pricingRead, today, busy, onIssue, onVoid, onRecord, onPdf, onRetry }) {
  const card = initialInvoiceCard({ licence, invoicesRead, pricingRead, today });
  const [paying, setPaying] = useState(false);
  const termsHref = `/admin/licences/${encodeURIComponent(licence?.uid || '')}/terms`;
  const head = (
    <div className="flex flex-wrap items-center gap-2">
      <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Initial invoice · one-off</h3>
      <span data-testid="initial-invoice-chip"><Pill tone={card.chip.tone}>{card.chip.word}</Pill></span>
    </div>
  );
  const frame = (body, testState = card.state) => (
    <section className="mb-5 rounded-lg border border-gray-200 p-3 dark:border-gray-800 sm:p-4" data-testid="initial-invoice" data-state={testState} aria-label="Initial invoice">
      {head}
      {body}
    </section>
  );

  if (card.state === 'loading') {
    return frame(<p className="mt-2 text-[12.5px] text-gray-600 dark:text-gray-400" data-testid="initial-invoice-loading">Reading the initial invoice… The card and the list load separately; neither is drawn as empty or €0 while loading.</p>);
  }
  if (card.state === 'decunread') {
    return frame(
      <p className="mt-2 text-[12.5px] text-red-700 dark:text-red-300" role="alert" data-testid="initial-invoice-decunread">
        <b>Pricing decision could not be read.</b> {card.why}{' '}
        {onRetry && <button type="button" className="underline" onClick={onRetry}>Try again</button>}
      </p>,
    );
  }
  if (card.state === 'nodecision') {
    return frame(
      <div className="mt-2 text-[12.5px] text-gray-700 dark:text-gray-300" data-testid="initial-invoice-nodecision">
        <p>{card.why} The initial fee and the regulatory surcharge come from an accepted or overridden pricing decision. None exists yet.</p>
        <a href={termsHref} className={`${primary} mt-2 inline-flex items-center justify-center`} data-testid="initial-invoice-open-pricing">Open Pricing &amp; Market</a>
      </div>,
    );
  }

  const inv = card.invoice;
  const voided = card.state === 'void';
  const cents = (text) => parseAmount(text, card.currency);
  return frame(
    <>
      {card.state !== 'invunread' && (
        <table className="mt-3 w-full text-left text-[12.5px]" data-testid="initial-invoice-lines">
          <thead>
            <tr className="text-[11px] uppercase text-gray-500"><th className="py-1 pr-3">Line</th><th className="hidden py-1 pr-3 sm:table-cell">Counts</th><th className="py-1 text-right">Amount{card.currency ? ` · ${card.currency}` : ''}</th></tr>
          </thead>
          <tbody>
            {card.lines.map((l) => (
              <tr key={l.key} className="border-t border-gray-100 dark:border-gray-800" data-testid={`initial-invoice-line-${l.key}`}>
                <td className="py-1.5 pr-3">{l.label}<div className="text-[11px] text-gray-500 sm:hidden">{l.note}</div></td>
                <td className="hidden py-1.5 pr-3 text-gray-600 dark:text-gray-400 sm:table-cell">{l.note}</td>
                <td className={`py-1.5 text-right font-mono ${l.amount === 'Not recorded' ? 'text-amber-800 dark:text-amber-300' : ''}`}>{l.amount}</td>
              </tr>
            ))}
            <tr className="border-t border-gray-200 font-semibold dark:border-gray-700">
              <td className="py-1.5 pr-3">Total{voided ? ' · void, nothing owed' : ''}</td>
              <td className="hidden sm:table-cell" />
              <td className={`py-1.5 text-right font-mono ${voided ? 'line-through text-gray-500' : ''}`} data-testid="initial-invoice-total">{card.total ?? 'Total not calculated'}</td>
            </tr>
          </tbody>
        </table>
      )}
      {card.nrSurcharge && card.state !== 'invunread' && (
        <p className="mt-1 text-[12px] text-amber-800 dark:text-amber-300" data-testid="initial-invoice-nr-surcharge">Regulatory surcharge · Not recorded · not billed. No €0 line is printed.</p>
      )}
      {card.meta.length > 0 && (
        <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-[12.5px] sm:grid-cols-5" data-testid="initial-invoice-meta">
          {card.meta.map(([k, v]) => (
            <div key={k}><dt className="text-[11px] uppercase text-gray-500">{k}</dt><dd className={k === 'Reference' || k === 'PDF' ? 'font-mono text-[12px]' : ''}>{v}</dd></div>
          ))}
        </dl>
      )}
      <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        {card.issueShown && (
          <button type="button" className={primary} disabled={busy || !card.canIssue} onClick={() => onIssue(card)} data-testid="initial-invoice-issue"
            aria-describedby={card.why ? 'initial-invoice-why' : undefined}>
            Issue initial invoice…
          </button>
        )}
        {inv && !voided && inv.pdf_url && <button type="button" className={quiet} disabled={busy} onClick={() => onPdf(inv)} data-testid="initial-invoice-pdf">PDF</button>}
        {card.record && <button type="button" className={quiet} disabled={busy} onClick={() => setPaying((p) => !p)} data-testid="initial-invoice-record">Record payment…</button>}
        {card.voidable && <button type="button" className={`${quiet} text-red-700 dark:text-red-300`} disabled={busy} onClick={() => onVoid(inv)} data-testid="initial-invoice-void">Void…</button>}
      </div>
      {card.why && (
        <p id="initial-invoice-why" className={`mt-2 text-[12px] ${card.state === 'invunread' ? 'text-red-700 dark:text-red-300' : 'text-gray-700 dark:text-gray-300'}`}
          role={card.state === 'invunread' ? 'alert' : undefined} data-testid="initial-invoice-why">
          {card.why}{card.state === 'nrfee' && <> <a href={termsHref} className="underline">Open Pricing &amp; Market</a></>}
          {card.state === 'invunread' && onRetry && <> <button type="button" className="underline" onClick={onRetry}>Try again</button></>}
        </p>
      )}
      {paying && inv && (
        <PaymentForm inv={inv} busy={busy} cents={cents} onSave={async (paid, note) => { await onRecord(inv, paid, note); setPaying(false); }} />
      )}
      {card.state !== 'invunread' && <p className="mt-3 text-[11px] text-gray-500 dark:text-gray-400" data-testid="initial-invoice-foot">{initialFoot(card)}</p>}
    </>,
  );
}

/** Record the running total received on an invoice, in its own currency. Shared with the annual rows' form. */
export function PaymentForm({ inv, busy, cents, onSave }) {
  const [amount, setAmount] = useState(inv.paid_cents > 0 ? toMajorString(inv.paid_cents, inv.currency) ?? '' : '');
  const [note, setNote] = useState('');
  const value = cents(amount);
  return (
    <form className="mt-2 flex flex-wrap items-center gap-2" data-testid="fee-invoice-pay-form"
      onSubmit={(e) => { e.preventDefault(); if (value !== null) onSave(value, note.trim()); }}>
      <label className="text-[12px]">Total received ({inv.currency})
        <input className="ml-2 w-32 rounded border px-2 py-1 font-mono dark:border-gray-700 dark:bg-gray-900" inputMode="decimal" value={amount}
          onChange={(e) => setAmount(e.target.value)} data-testid="fee-invoice-paid" aria-invalid={value === null ? 'true' : undefined} />
      </label>
      <input className="w-56 rounded border px-2 py-1 dark:border-gray-700 dark:bg-gray-900" placeholder="Bank reference (optional)" value={note} onChange={(e) => setNote(e.target.value)} data-testid="fee-invoice-note" />
      <button type="submit" className="rounded bg-indigo-600 px-3 py-1 text-xs text-white disabled:opacity-50" disabled={busy || value === null} data-testid="fee-invoice-save">Save</button>
      {value === null && <span className="text-[12px] text-red-700" data-testid="fee-invoice-paid-error">Enter the total received, with at most two decimals.</span>}
    </form>
  );
}
