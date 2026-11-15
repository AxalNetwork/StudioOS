/**
 * D5020 (#5020, the HQ screens) — the pricing model versions at `/admin/licences/pricing/models` (addendum board L25,
 * read-only half): the current version, drafts and retired versions with their weights, rounding, reference fees and
 * how much each priced, and a dated history. Active and retired versions are immutable, and that is said rather than
 * offered. Editing, impact preview per licence and activation are not built on this screen (D5020-ui §3); a draft can
 * be previewed across every market from the catalogue's model selector.
 */
import React from 'react';
import { licencePricingHqApi } from '../../../lib/api/licencePricingHq';
import { modelRows } from './pricingHqModel';
import { PricingFrame, ReadState, cardClass, tdClass, thClass, usePricingRead } from './PricingShell';

const STATE_TONE = {
  active: 'border-green-200 bg-green-50 text-green-800 dark:border-green-900 dark:bg-green-950/30 dark:text-green-200',
  draft: 'border-indigo-200 bg-indigo-50 text-indigo-800 dark:border-indigo-900 dark:bg-indigo-950/30 dark:text-indigo-200',
  retired: 'border-gray-300 bg-gray-50 text-gray-600 dark:border-gray-700 dark:bg-gray-950 dark:text-gray-400',
};
const COLUMNS = ['Version', 'State', 'Effective from', 'Activated', 'Weights · market / wealth / ecosystem', 'Reference fees', 'Rounding', 'Priced', ''];

export default function PricingModels({ api = licencePricingHqApi } = {}) {
  const res = usePricingRead(() => api.modelVersions(), [], 'model_versions');
  const mv = res.data;
  const rows = mv ? modelRows(mv) : [];
  return (
    <PricingFrame
      tab="models" testId="hq-licence-pricing-models" title="Pricing models"
      lede="The formula versions recommendations come from. Active and retired versions are immutable; every snapshot keeps the version that priced it."
    >
      <ReadState res={res} what="the pricing models" />
      {mv && (
        <>
          {!mv.current && (
            <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200" role="status" data-testid="pricing-no-active-model">
              {mv.current_reason || 'No pricing model is active.'} No licence gets a recommendation until one is activated.
            </p>
          )}
          {rows.length === 0 ? (
            <p className="mt-4 rounded-lg border border-dashed border-gray-300 p-6 text-center text-sm text-gray-600 dark:border-gray-700 dark:text-gray-400" data-testid="pricing-models-empty">
              No pricing model is recorded, not even a draft.
            </p>
          ) : (
            <section className={`mt-4 overflow-hidden ${cardClass}`} data-testid="pricing-models">
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-[12.5px]" data-testid="pricing-models-table">
                  <thead><tr>{COLUMNS.map((c) => <th key={c || 'note'} scope="col" className={thClass}>{c}</th>)}</tr></thead>
                  <tbody>
                    {rows.map((m) => (
                      <tr key={m.uid} className="border-b border-gray-100 last:border-0 dark:border-gray-800" data-testid="pricing-model-row" data-state={m.state}>
                        <td className={`${tdClass} font-mono font-bold`}>{m.version}</td>
                        <td className={tdClass}><span className={`inline-block rounded-full border px-2 py-0.5 text-[11px] font-medium ${STATE_TONE[m.state] || STATE_TONE.retired}`}>{m.state}</span></td>
                        <td className={`${tdClass} font-mono`}>{m.effectiveFrom}</td>
                        <td className={tdClass}>{m.activated}</td>
                        <td className={`${tdClass} font-mono`}>{m.weights}</td>
                        <td className={`${tdClass} font-mono`}>{m.reference}</td>
                        <td className={`${tdClass} font-mono`}>{m.rounding}</td>
                        <td className={`${tdClass} text-[12px]`}>{m.usage}</td>
                        <td className={`${tdClass} text-[12px] text-gray-500 dark:text-gray-400`}>
                          {m.state === 'draft'
                            ? <a href={`/admin/licences/pricing?model=${encodeURIComponent(m.uid)}`} className="font-semibold text-indigo-700 underline dark:text-indigo-300">Preview on the catalogue</a>
                            : m.note}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
          {(mv.history || []).length > 0 && (
            <section className={`mt-4 p-4 ${cardClass}`} data-testid="pricing-models-history">
              <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">History</h2>
              <ul className="mt-2 space-y-1 text-[12.5px] text-gray-700 dark:text-gray-300">
                {mv.history.map((h) => (
                  <li key={`${h.model_uid}-${h.event}`}>
                    <span className="font-mono">{String(h.at).slice(0, 16).replace('T', ' ')}</span> · {h.version} {h.event}{h.by ? ` by ${h.by}` : ''}
                  </li>
                ))}
              </ul>
            </section>
          )}
          <p className="mt-3 text-[12px] text-gray-500 dark:text-gray-400">
            Drafting, editing and activating a version stay with HQ's existing model writes; activation needs the write bar and a reason, and only changes what new recommendations are calculated from.
          </p>
        </>
      )}
    </PricingFrame>
  );
}
