/**
 * D5020 (#5020, the HQ screens) — the annual pricing review queue at `/admin/licences/pricing/reviews` (addendum
 * board L27): every licence whose pricing review is due across the ledger, oldest first, whether or not a review row
 * is open for it (the queue is computed, D5020 §3), and the licences with no pricing decision recorded, apart. A row
 * opens the licence's Terms, where its Pricing & Market section is. A review never applies itself.
 */
import React from 'react';
import { useSearchParams } from 'react-router-dom';
import { licencePricingHqApi } from '../../../lib/api/licencePricingHq';
import { REVIEW_WINDOWS, reviewRow, reviewWindowFromParam } from './pricingHqModel';
import { PricingFrame, ReadState, cardClass, tdClass, thClass, usePricingRead } from './PricingShell';

const COLUMNS = ['Licence', 'Due', 'Review', 'Current pricing decision', 'Annual fee now', 'Market data'];

export default function PricingReviews({ api = licencePricingHqApi } = {}) {
  const [params, setParams] = useSearchParams();
  const win = reviewWindowFromParam(params.get('window'));
  const res = usePricingRead(() => api.reviewQueue({ within_days: win.within }), [win.within], 'review_queue');
  const q = res.data;
  const rows = (q?.items || []).map(reviewRow);
  const setWindow = (key) => setParams((prev) => { const n = new URLSearchParams(prev); if (key === REVIEW_WINDOWS[0].key) n.delete('window'); else n.set('window', key); return n; }, { replace: true });
  return (
    <PricingFrame
      tab="reviews" testId="hq-licence-pricing-reviews" title="Annual pricing reviews"
      lede="Licences whose pricing review is due, across the ledger. A due review is listed whether or not anyone opened it; opening a row goes to the licence's Pricing & Market section."
    >
      <div className="mt-3 flex flex-wrap gap-1.5" role="radiogroup" aria-label="Window">
        {REVIEW_WINDOWS.map((w) => (
          <button
            key={w.key} type="button" role="radio" aria-checked={w.key === win.key} onClick={() => setWindow(w.key)} data-testid={`pricing-window-${w.key}`}
            className={`min-h-[32px] rounded-full border px-3 text-xs font-medium ${w.key === win.key
              ? 'border-indigo-600 bg-indigo-50 text-indigo-800 dark:border-indigo-500 dark:bg-indigo-950/40 dark:text-indigo-200'
              : 'border-gray-300 text-gray-700 dark:border-gray-700 dark:text-gray-300'}`}
          >
            {w.label}{w.key === win.key && q ? ` · ${q.total}` : ''}
          </button>
        ))}
      </div>
      <ReadState res={res} what="the review queue" />
      {q && (
        <>
          {rows.length === 0 ? (
            <p className="mt-4 rounded-lg border border-dashed border-gray-300 p-6 text-center text-sm text-gray-600 dark:border-gray-700 dark:text-gray-400" data-testid="pricing-reviews-none">
              None: no licence's pricing review is due {win.within ? `in the next ${win.within} days` : 'today'}.
            </p>
          ) : (
            <section className={`mt-4 overflow-hidden ${cardClass}`} data-testid="pricing-reviews">
              <div className="hidden overflow-x-auto md:block">
                <table className="w-full border-collapse text-[12.5px]" data-testid="pricing-reviews-table">
                  <thead><tr>{COLUMNS.map((c) => <th key={c} scope="col" className={thClass}>{c}</th>)}</tr></thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.uid} className="border-b border-gray-100 last:border-0 dark:border-gray-800" data-testid="pricing-review-row" data-uid={r.uid}>
                        <td className={tdClass}>
                          <a href={`/admin/licences/${encodeURIComponent(r.uid)}/terms`} className="font-semibold text-gray-900 hover:underline dark:text-gray-100">{r.name}</a>
                          <small className="block font-mono text-[11px] text-gray-500 dark:text-gray-400">{r.ref} · {r.status}</small>
                        </td>
                        <td className={`${tdClass} font-mono ${r.overdue ? 'font-semibold text-rose-700 dark:text-rose-300' : ''}`}>{r.due}</td>
                        <td className={tdClass}>{r.review}</td>
                        <td className={tdClass}>{r.decision}</td>
                        <td className={`${tdClass} font-mono`}>{r.annual}</td>
                        <td className={tdClass}>{r.data}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <ul className="divide-y divide-gray-100 md:hidden dark:divide-gray-800" data-testid="pricing-reviews-list">
                {rows.map((r) => (
                  <li key={r.uid} className="px-4 py-3">
                    <a href={`/admin/licences/${encodeURIComponent(r.uid)}/terms`} className="font-semibold text-gray-900 hover:underline dark:text-gray-100">{r.name}</a>
                    <small className="block text-[11px] text-gray-500 dark:text-gray-400">{r.due} · {r.review}</small>
                  </li>
                ))}
              </ul>
              <div className="flex flex-wrap justify-between gap-2 border-t border-gray-100 px-4 py-2.5 font-mono text-[12px] text-gray-500 dark:border-gray-800 dark:text-gray-400">
                <span data-testid="pricing-reviews-count">{q.due} due now · {q.without_open_review} with no review open</span>
                <span>A review never applies itself</span>
              </div>
            </section>
          )}
          {(q.no_decision || []).length > 0 && (
            <section className={`mt-4 p-4 ${cardClass}`} data-testid="pricing-no-decision">
              <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">No pricing decision recorded · {q.no_decision.length}</h2>
              <p className="mt-1 text-[12px] text-gray-600 dark:text-gray-400">
                Issued before country pricing, or never priced. Their terms are the ones in the agreement; HQ records a first recommendation at their next review. Nothing is backfilled.
              </p>
              <ul className="mt-2 space-y-1 text-[12.5px]">
                {q.no_decision.map((l) => (
                  <li key={l.licence_uid}>
                    <a href={`/admin/licences/${encodeURIComponent(l.licence_uid)}/terms`} className="font-semibold text-indigo-700 hover:underline dark:text-indigo-300">{l.brand_name || l.licence_ref}</a>
                    <span className="font-mono text-[11px] text-gray-500 dark:text-gray-400"> · {l.licence_ref} · {l.status}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </PricingFrame>
  );
}
