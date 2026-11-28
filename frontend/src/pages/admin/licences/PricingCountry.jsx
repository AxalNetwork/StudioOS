/**
 * D5020 (#5020, the HQ screens) — one market at `/admin/licences/pricing/country/:code` (addendum board L24): its
 * inputs with their source, reference and as-of date (provenance), the calculation now with every step of its trace
 * and its source digest, the observation history and the snapshots already frozen for it. A market the model cannot
 * price says why; a missing input is never read as zero. The preview writes nothing.
 *
 * D7715 (#7715, canvas LCD-02 to LCD-04, D7703): "Record observation…" opens `PricingObservationSheet` (record a
 * value, or mark a field Provisional or Not recorded), with the expected revision taken from this read. After the
 * Worker writes, the market and the consistency check are read again and the new history row is first. A value with
 * no history behind it, or one that differs from its latest history row, is flagged from the #7714 consistency read
 * (owner Q8 A); when that read did not answer nothing is flagged and nothing is called consistent.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { licencePricingHqApi } from '../../../lib/api/licencePricingHq';
import { licencePricingCatalogueApi } from '../../../lib/api/licencePricing';
import { figure, indexLabel } from './countryPricingModel';
import {
  NOT_RECORDED, calculationStanding, completenessCell, consistencyFlags, fieldLabel, findingLine, historyRow, inputRows, modelLine,
  recommendationLine, sourceFreshness, traceRows,
} from './pricingHqModel';
import { PricingFrame, ReadState, Tag, cardClass, tdClass, thClass, todayIso, usePricingRead } from './PricingShell';
import PricingObservationSheet from './PricingObservationSheet';
import { primaryBtn, useLiveRegion, utcMinute } from './PricingImportSheet';

/** The observed fields each profile input row stands for (the score row carries the rank). */
const INPUT_FIELDS = Object.freeze({
  market_size: ['population'],
  purchasing_power: ['ppp_gdp_per_capita'],
  startup_ecosystem: ['startup_ecosystem_score', 'startup_ecosystem_rank'],
});

const STANDING_TONE = {
  complete: 'border-gray-200 bg-gray-50 text-gray-800 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-200',
  provisional: 'border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200',
  incomplete: 'border-rose-200 bg-rose-50 text-rose-900 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-200',
  unavailable: 'border-rose-200 bg-rose-50 text-rose-900 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-200',
};

/**
 * D7715 part 2: a table wider than its card scrolls inside it, so the box takes Tab focus (axe scrollable-region-
 * focusable, WCAG 2.1.1) and says what it holds; a keyboard user scrolls it with the arrow keys.
 */
const scrollBox = 'overflow-x-auto rounded-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-600';

function Card({ title, children, testId }) {
  return (
    <section className={`${cardClass} p-4`} data-testid={testId}>
      <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">{title}</h2>
      <div className="mt-2">{children}</div>
    </section>
  );
}

export default function PricingCountry({ api = licencePricingHqApi, writeApi = licencePricingCatalogueApi } = {}) {
  const { code: raw } = useParams();
  const code = String(raw || '').toUpperCase();
  const [params] = useSearchParams();
  const model = params.get('model') || '';
  const res = usePricingRead(() => api.country(code, model ? { model } : {}), [code, model], 'country');
  const check = usePricingRead(() => (api.consistency ? api.consistency() : Promise.resolve(null)), [], 'consistency');
  const flags = consistencyFlags(check);
  const mine = flags.byCountry[code] || {};
  const d = res.data;
  const today = todayIso();
  const notFound = res.state === 'error' && res.status === 404;
  const title = d?.profile?.country_name || code;
  const revision = Number.isInteger(d?.profile?.revision) ? d.profile.revision : null;
  const readAt = useMemo(() => (d ? utcMinute() : null), [d]);
  const [recording, setRecording] = useState(null); // the field the sheet opens on, or null
  const [written, setWritten] = useState(null);
  const [live, announce] = useLiveRegion();
  const newest = useRef(null);
  // LCD-08: after a write, the new history row is first and focused.
  useEffect(() => { if (written && res.state === 'ok') newest.current?.focus?.(); }, [written, res.state]);
  const openSheet = (field) => setRecording(field || 'population');
  const flaggedFields = Object.keys(mine);

  return (
    <PricingFrame
      tab="catalogue" testId="hq-licence-pricing-country" title={title}
      tools={d && res.state !== 'refused' ? (
        <button type="button" className={primaryBtn} onClick={() => openSheet()} disabled={revision === null} data-testid="pricing-record-open">Record observation…</button>
      ) : null}
    >
      {live}
      {recording && d && (
        <PricingObservationSheet
          country={{ code, name: title }} profile={d.profile} readAt={readAt} api={writeApi} initialField={recording} announce={announce}
          onClose={() => setRecording(null)} onReload={res.retry}
          onWritten={(w) => { setRecording(null); setWritten(w); res.retry(); check.retry(); }}
        />
      )}
      {written && d && (
        <p className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 p-2 text-[12.5px] text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-200" role="status" data-testid="pricing-record-written">
          ✓ {written.live} The country was read again; the new history row is first.
        </p>
      )}
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
              {code} · {d.profile.currency_code || NOT_RECORDED} · {d.profile.region_code || NOT_RECORDED} · regulatory class {d.regulatory_class || NOT_RECORDED} · profile revision <span data-testid="pricing-country-revision">{revision ?? NOT_RECORDED}</span>
            </p>
            <p className="mt-1 flex flex-wrap gap-3 text-[12.5px]">
              <Tag c={completenessCell(d.data_completeness)} testId="pricing-country-completeness" />
              <Tag c={fresh} testId="pricing-country-freshness" />
            </p>
            {flaggedFields.length > 0 && (
              <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-2 text-[12.5px] text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200" role="status" data-testid="pricing-country-check">
                ! {flaggedFields.length} {flaggedFields.length === 1 ? 'value' : 'values'} to check on {title}. The consistency check compares each value with its latest history row and changes nothing.
              </p>
            )}
            {flags.state === 'unavailable' && (
              <p className="mt-2 text-[12px] text-gray-600 dark:text-gray-400" data-testid="pricing-check-unavailable">
                <Tag c={{ state: 'unavailable', label: 'Unavailable' }} /> The consistency check could not be read. No value is flagged and nothing is called consistent.{' '}
                <button type="button" className="font-bold text-indigo-700 underline dark:text-indigo-300" onClick={check.retry}>Try again</button>
              </p>
            )}
            <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
              <div className="flex min-w-0 flex-col gap-4">
                <Card title="Profile inputs" testId="pricing-country-inputs">
                  <div className={scrollBox} tabIndex={0} role="region" aria-label="Profile inputs, scrolls sideways">
                    <table className="w-full border-collapse text-[12.5px]">
                      <thead><tr>{['Input', 'Value', 'Status', 'Source', 'As of', ...(flags.state === 'ok' ? ['Check against history'] : [])].map((h) => <th key={h} scope="col" className={thClass}>{h}</th>)}</tr></thead>
                      <tbody>
                        {inputRows(d.inputs).map((r) => {
                          const found = INPUT_FIELDS[r.key].map((f) => mine[f]).filter(Boolean);
                          return (
                            <tr key={r.key} className={`border-b border-gray-100 last:border-0 dark:border-gray-800 ${found.length ? 'bg-amber-50/60 dark:bg-amber-950/20' : ''}`} data-testid="pricing-input-row" data-input={r.key} data-flagged={found.length ? 'true' : undefined}>
                              <td className={`${tdClass} font-semibold`}>{r.label}</td>
                              <td className={`${tdClass} font-mono`}>{r.value}</td>
                              <td className={tdClass}><Tag c={{ state: r.status === 'recorded' ? 'value' : r.status, label: r.statusWord }} /></td>
                              <td className={`${tdClass} text-[12px]`}>{r.source}</td>
                              <td className={`${tdClass} font-mono text-[12px]`}>{r.asOf}</td>
                              {flags.state === 'ok' && (
                                <td className={`${tdClass} text-[12px]`} data-testid="pricing-input-check">
                                  {found.length === 0 ? (
                                    <span className="text-gray-600 dark:text-gray-400">{r.status === 'not_recorded' ? '— no value to compare' : '✓ matches history'}</span>
                                  ) : found.map((f) => (
                                    <span key={f.field} className="block text-amber-800 dark:text-amber-300" data-testid="pricing-input-flag" data-field={f.field}>
                                      ⚠ {found.length > 1 || f.field === 'startup_ecosystem_rank' ? `${fieldLabel(f.field)}: ` : ''}{findingLine(f)}{' '}
                                      <button type="button" className="font-bold text-indigo-700 underline dark:text-indigo-300" onClick={() => openSheet(f.field)} disabled={revision === null} data-testid="pricing-input-flag-record">Record observation…</button>
                                    </span>
                                  ))}
                                </td>
                              )}
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </Card>
                <Card title="Snapshots" testId="pricing-country-snapshots">
                  {(d.snapshots || []).length === 0 ? (
                    <p className="text-[12.5px] text-gray-600 dark:text-gray-400">None: no snapshot has been frozen for {code}. A snapshot is taken only by Refresh recommendation on a licence.</p>
                  ) : (
                    <div className={scrollBox} tabIndex={0} role="region" aria-label="Snapshots, scrolls sideways">
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
                    <div className={scrollBox} tabIndex={0} role="region" aria-label="Observation history, scrolls sideways">
                      {/* LCD-02 and LCD-08 B: newest first, with who recorded it and why; after a write the new row is first and focused. */}
                      <table className="w-full border-collapse text-[12px]" aria-label="Observation history, newest first" data-testid="pricing-history">
                        <thead><tr>{['Recorded', 'Field', 'Value', 'Status', 'Source', 'As of', 'By', 'Reason', 'Revision'].map((h) => <th key={h} scope="col" className={thClass}>{h}</th>)}</tr></thead>
                        <tbody>
                          {d.observations.slice(0, 12).map((o, i) => {
                            const h = historyRow(o);
                            const isNew = i === 0 && written && written.revision === h.revision;
                            return (
                              <tr
                                key={h.key || i} ref={isNew ? newest : undefined} tabIndex={isNew ? -1 : undefined} data-testid="pricing-history-row" data-new={isNew ? 'true' : undefined}
                                className={`border-b border-gray-100 last:border-0 dark:border-gray-800 ${isNew ? 'bg-emerald-50 dark:bg-emerald-950/30' : ''}`}
                              >
                                <td className={`${tdClass} whitespace-nowrap font-mono`}>{h.at}</td>
                                <td className={tdClass}>{h.field}</td>
                                <td className={`${tdClass} font-mono`}>{h.value}</td>
                                <td className={tdClass}><Tag c={{ state: h.statusKey, label: h.status }} /></td>
                                <td className={tdClass}>{h.source}</td>
                                <td className={`${tdClass} font-mono`}>{h.asOf}</td>
                                <td className={tdClass}>{h.by}</td>
                                <td className={tdClass}>{h.reason}</td>
                                <td className={`${tdClass} font-mono`}>{h.revision}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
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
                  <div className={`mt-2 ${scrollBox}`} tabIndex={0} role="region" aria-label="Calculation trace, scrolls sideways">
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
