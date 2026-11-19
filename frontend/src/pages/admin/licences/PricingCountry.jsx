/**
 * D5020 (#5020, the HQ screens) — one market at `/admin/licences/pricing/country/:code` (addendum board L24): its
 * inputs with their source, reference and as-of date (provenance), the calculation now with every step of its trace
 * and its source digest, the observation history and the snapshots already frozen for it. A market the model cannot
 * price says why; a missing input is never read as zero. The preview writes nothing.
 */
import React from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { licencePricingHqApi } from '../../../lib/api/licencePricingHq';
import { figure, indexLabel } from './countryPricingModel';
import {
  NOT_RECORDED, calculationStanding, completenessCell, inputRows, modelLine, recommendationLine, sourceFreshness, traceRows,
} from './pricingHqModel';
import { PricingFrame, ReadState, Tag, cardClass, tdClass, thClass, todayIso, usePricingRead } from './PricingShell';

const STANDING_TONE = {
  complete: 'border-gray-200 bg-gray-50 text-gray-800 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-200',
  provisional: 'border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200',
  incomplete: 'border-rose-200 bg-rose-50 text-rose-900 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-200',
  unavailable: 'border-rose-200 bg-rose-50 text-rose-900 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-200',
};

function Card({ title, children, testId }) {
  return (
    <section className={`${cardClass} p-4`} data-testid={testId}>
      <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">{title}</h2>
      <div className="mt-2">{children}</div>
    </section>
  );
}

export default function PricingCountry({ api = licencePricingHqApi } = {}) {
  const { code: raw } = useParams();
  const code = String(raw || '').toUpperCase();
  const [params] = useSearchParams();
  const model = params.get('model') || '';
  const res = usePricingRead(() => api.country(code, model ? { model } : {}), [code, model], 'country');
  const d = res.data;
  const today = todayIso();
  const notFound = res.state === 'error' && res.status === 404;
  const title = d?.profile?.country_name || code;

  return (
    <PricingFrame tab="catalogue" testId="hq-licence-pricing-country" title={title}>
      {notFound ? (
        <p className="mt-6 rounded-lg border border-dashed border-gray-300 p-6 text-sm text-gray-600 dark:border-gray-700 dark:text-gray-400" data-testid="pricing-country-missing">
          No market profile is recorded for {code}. <a href="/admin/licences/pricing" className="font-semibold text-indigo-700 underline dark:text-indigo-300">Back to the catalogue</a>
        </p>
      ) : <ReadState res={res} what={`the market profile for ${code}`} />}
      {d && (() => {
        const standing = calculationStanding(d);
        const rec = d.calculation?.recommendation || null;
        const fresh = sourceFreshness(d.last_source_update, today);
        const trace = traceRows(d.calculation, d.inputs);
        return (
          <>
            <p className="mt-3 font-mono text-[12px] text-gray-600 dark:text-gray-400" data-testid="pricing-country-facts">
              {code} · {d.profile.currency_code || NOT_RECORDED} · {d.profile.region_code || NOT_RECORDED} · regulatory class {d.regulatory_class || NOT_RECORDED}
            </p>
            <p className="mt-1 flex flex-wrap gap-3 text-[12.5px]">
              <Tag c={completenessCell(d.data_completeness)} testId="pricing-country-completeness" />
              <Tag c={fresh} testId="pricing-country-freshness" />
            </p>
            <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
              <div className="flex min-w-0 flex-col gap-4">
                <Card title="Profile inputs" testId="pricing-country-inputs">
                  <div className="overflow-x-auto">
                    <table className="w-full border-collapse text-[12.5px]">
                      <thead><tr>{['Input', 'Value', 'Status', 'Source', 'As of'].map((h) => <th key={h} scope="col" className={thClass}>{h}</th>)}</tr></thead>
                      <tbody>
                        {inputRows(d.inputs).map((r) => (
                          <tr key={r.key} className="border-b border-gray-100 last:border-0 dark:border-gray-800" data-testid="pricing-input-row" data-input={r.key}>
                            <td className={`${tdClass} font-semibold`}>{r.label}</td>
                            <td className={`${tdClass} font-mono`}>{r.value}</td>
                            <td className={tdClass}><Tag c={{ state: r.status === 'recorded' ? 'value' : r.status, label: r.statusWord }} /></td>
                            <td className={`${tdClass} text-[12px]`}>{r.source}</td>
                            <td className={`${tdClass} font-mono text-[12px]`}>{r.asOf}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </Card>
                <Card title="Snapshots" testId="pricing-country-snapshots">
                  {(d.snapshots || []).length === 0 ? (
                    <p className="text-[12.5px] text-gray-600 dark:text-gray-400">None: no snapshot has been frozen for {code}. A snapshot is taken only by Refresh recommendation on a licence.</p>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full border-collapse text-[12.5px]">
                        <thead><tr>{['Taken', 'Model', 'Index', 'Annual', 'Data'].map((h) => <th key={h} scope="col" className={thClass}>{h}</th>)}</tr></thead>
                        <tbody>
                          {d.snapshots.map((s) => (
                            <tr key={s.uid} className="border-b border-gray-100 last:border-0 dark:border-gray-800">
                              <td className={`${tdClass} font-mono`}>{String(s.created_at).slice(0, 10)}</td>
                              <td className={tdClass}>{s.pricing_model_version}</td>
                              <td className={`${tdClass} font-mono`}>{indexLabel(s.country_index)}</td>
                              <td className={`${tdClass} font-mono`}>{figure(s.recommended_annual_fee_cents, 'cents', s.currency)}</td>
                              <td className={tdClass}>{s.complete ? 'Complete' : 'Provisional'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </Card>
                <Card title="Observation history" testId="pricing-country-observations">
                  {(d.observations || []).length === 0 ? (
                    <p className="text-[12.5px] text-gray-600 dark:text-gray-400">None recorded beyond the profile's current values.</p>
                  ) : (
                    <ul className="space-y-1 text-[12px] text-gray-700 dark:text-gray-300">
                      {d.observations.slice(0, 12).map((o, i) => (
                        <li key={o.uid || i}>
                          <span className="font-mono">{o.as_of || NOT_RECORDED}</span> · {String(o.field || '').replace(/_/g, ' ')} · {o.value ?? NOT_RECORDED} · {o.source || NOT_RECORDED}{o.status ? ` · ${o.status}` : ''} · revision {o.profile_revision}
                        </li>
                      ))}
                    </ul>
                  )}
                </Card>
              </div>
              <Card title={rec ? `Preview recommendation · model ${rec.model_version}` : 'Preview recommendation'} testId="pricing-country-calculation">
                <p className="text-[12px] text-gray-600 dark:text-gray-400">
                  {modelLine(d.model, d.model_reason)}. Calculated now from the inputs; a preview writes nothing.
                </p>
                <p className={`mt-2 rounded-md border p-2 text-[12.5px] ${STANDING_TONE[standing.state]}`} role="status" data-testid="pricing-country-standing">
                  {standing.label}
                </p>
                {trace.length > 0 && (
                  <div className="mt-2 overflow-x-auto">
                    <table className="w-full border-collapse text-[12.5px]" aria-label="Calculation trace" data-testid="pricing-trace">
                      <thead><tr>{['Step', 'Value', 'Weight', 'Note'].map((h) => <th key={h} scope="col" className={thClass}>{h}</th>)}</tr></thead>
                      <tbody>
                        {trace.map((t) => (
                          <tr key={t.step} className={`border-b border-gray-100 last:border-0 dark:border-gray-800 ${t.total ? 'font-semibold' : ''}`} data-testid="pricing-trace-row">
                            <td className={tdClass}>{t.step}</td>
                            <td className={`${tdClass} font-mono`}>{t.value}</td>
                            <td className={`${tdClass} font-mono`}>{t.weight}</td>
                            <td className={`${tdClass} text-[12px]`}>{t.note}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                <p className="mt-2 text-[12.5px] font-semibold text-gray-900 dark:text-gray-100" data-testid="pricing-country-summary">{recommendationLine(rec)}</p>
                {d.calculation?.source_digest && (
                  <p className="mt-1 break-all font-mono text-[11px] text-gray-500 dark:text-gray-400" data-testid="pricing-country-digest">
                    Source digest {d.calculation.source_digest}: a snapshot frozen from these inputs under this model carries the same digest.
                  </p>
                )}
              </Card>
            </div>
          </>
        );
      })()}
    </PricingFrame>
  );
}
