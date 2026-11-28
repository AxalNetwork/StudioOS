/**
 * D5020 (#5020, the HQ screens) — the country pricing catalogue at `/admin/licences/pricing` (addendum board L23,
 * phone L38, states L39): every market profile with its completeness, source freshness, regulatory class and what
 * the chosen model recommends now, searchable and filtered by data, region, class and currency. The model selector
 * reads `?model=` (a draft previews across every market); nothing here changes a licence's terms.
 *
 * D7715 (#7715, canvas LCD-01 and LCD-04, D7703): "Import country data…" opens `PricingImportSheet`, the one write
 * this page sends; after the Worker writes, the catalogue and the consistency check are read again. Each row carries
 * its profile revision, which the import file names. The consistency read (#7714) flags the markets with a value
 * to check (owner Q8 A): a chip and a Check column when it finds something, the countries and fields it checked
 * when it finds nothing, and Unavailable (never "all consistent") when it did not answer.
 */
import React, { useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { licencePricingHqApi } from '../../../lib/api/licencePricingHq';
import { licencePricingCatalogueApi } from '../../../lib/api/licencePricing';
import {
  NOT_RECORDED, catalogueFacets, catalogueRow, consistencyClearLine, consistencyFlags, filterCatalogue, modelLine, modelRows,
} from './pricingHqModel';
import { PricingFrame, ReadState, Tag, cardClass, tdClass, thClass, todayIso, usePricingRead } from './PricingShell';
import PricingImportSheet, { primaryBtn, useLiveRegion, utcMinute } from './PricingImportSheet';

const select = 'min-h-[32px] rounded-md border border-gray-300 bg-white px-2 text-xs font-semibold text-gray-800 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200';
const COLUMNS = ['Country', 'Region', 'Currency', 'Data completeness', 'Last source update', 'Revision', 'Regulatory class', 'Tier · index', 'Recommended annual', 'Initial fee'];
const chip = (on) => `min-h-[32px] rounded-full border px-3 text-xs font-medium ${on
  ? 'border-indigo-600 bg-indigo-50 text-indigo-800 dark:border-indigo-500 dark:bg-indigo-950/40 dark:text-indigo-200'
  : 'border-gray-300 text-gray-700 dark:border-gray-700 dark:text-gray-300'}`;

export default function PricingCatalogue({ api = licencePricingHqApi, writeApi = licencePricingCatalogueApi } = {}) {
  const [params, setParams] = useSearchParams();
  const set = (k, v) => setParams((prev) => { const n = new URLSearchParams(prev); if (v) n.set(k, v); else n.delete(k); return n; }, { replace: true });
  const model = params.get('model') || '';
  const q = params.get('q') || '';
  const data = params.get('data') || '';
  const incomplete = data === 'incomplete';
  const region = params.get('region') || '';
  const regulatory = params.get('class') || '';
  const currency = params.get('currency') || '';
  const cat = usePricingRead(() => api.catalogue(model ? { model } : {}), [model], 'catalogue');
  const versions = usePricingRead(() => api.modelVersions(), [], 'model_versions');
  const check = usePricingRead(() => (api.consistency ? api.consistency() : Promise.resolve(null)), [], 'consistency');
  const flags = consistencyFlags(check);
  const toCheck = flags.state === 'ok' && flags.total > 0;
  const [importing, setImporting] = useState(false);
  const [reread, setReread] = useState(null);
  const spent = useRef(new Set());
  const [live, announce] = useLiveRegion();
  const today = todayIso();
  const rows = useMemo(() => (cat.data?.countries || []).map((r) => catalogueRow(r, today)), [cat.data, today]);
  const facets = catalogueFacets(rows);
  const filtered = filterCatalogue(rows, { q, incomplete, region, regulatory, currency });
  const shown = data === 'check' && toCheck ? filtered.filter((r) => flags.byCountry[r.code]) : filtered;
  const notComplete = rows.filter((r) => r.completeness.state !== 'complete').length;
  const options = versions.state === 'ok' ? modelRows(versions.data) : [];
  const columns = toCheck ? [...COLUMNS, 'Check'] : COLUMNS;
  const readAgain = () => { cat.retry(); check.retry(); };
  const flagCell = (code) => {
    const n = Object.keys(flags.byCountry[code] || {}).length;
    return n ? <span className="font-semibold text-amber-800 dark:text-amber-300" data-testid="pricing-cell-check">⚠ {n} to check</span> : <span className="text-gray-500 dark:text-gray-400">—</span>;
  };

  const modelSelect = (
    <label className="flex items-center gap-2 text-xs font-semibold text-gray-600 dark:text-gray-400">
      Model
      <select className={select} value={model} onChange={(e) => set('model', e.target.value)} aria-label="Pricing model" data-testid="pricing-model-select">
        <option value="">Active model</option>
        {options.map((m) => <option key={m.uid} value={m.uid}>{m.version} · {m.state}</option>)}
      </select>
    </label>
  );

  return (
    <PricingFrame
      tab="catalogue" testId="hq-licence-pricing-page" title="Country pricing"
      lede="The markets HQ prices licences in, the data behind each recommendation, and how fresh it is. A figure here is calculated now and stored nowhere; nothing here changes a licence's terms."
      tools={(
        <>
          {modelSelect}
          {cat.state !== 'refused' && (
            <button type="button" className={primaryBtn} onClick={() => setImporting(true)} data-testid="pricing-import-open">Import country data…</button>
          )}
        </>
      )}
    >
      {live}
      <ReadState res={cat} what="the country catalogue" />
      {reread && cat.data && (
        <p className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 p-2 text-[12.5px] text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-200" role="status" data-testid="pricing-import-reread-note">
          ✓ {reread.line} The catalogue was read again at {reread.at} UTC after the import; the revisions below are the ones now held.
        </p>
      )}
      {importing && (
        <PricingImportSheet
          send={writeApi.importCountries} spent={spent.current} onSent={(text) => spent.current.add(text)}
          readable={cat.state === 'ok' && Boolean(cat.data)} announce={announce}
          onWritten={(o) => { readAgain(); setReread({ line: o.line, at: utcMinute() }); }}
          onReread={readAgain} onClose={() => setImporting(false)}
        />
      )}
      {cat.data && (
        <>
          <p className="mt-3 text-[12.5px] text-gray-700 dark:text-gray-300" data-testid="pricing-model-line">
            {modelLine(cat.data.model, cat.data.model_reason)}
            {cat.data.model?.status === 'draft' ? ' · preview of a draft: no licence is priced on it' : ''}
          </p>
          {cat.data.model_problem && (
            <p className="mt-2 rounded-lg border border-rose-200 bg-rose-50 p-2 text-[12.5px] text-rose-800 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-200" role="status" data-testid="pricing-model-problem">
              {cat.data.model_problem.reason}
            </p>
          )}
          <div className="mt-3 flex flex-wrap items-center gap-2" data-testid="pricing-catalogue-tools">
            <input
              type="search" value={q} onChange={(e) => set('q', e.target.value)} placeholder={`Search ${rows.length} markets`}
              aria-label="Search markets" data-testid="pricing-search"
              className="min-h-[32px] w-full max-w-xs rounded-md border border-gray-300 px-3 text-sm dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
            />
            <div className="flex gap-1.5" role="radiogroup" aria-label="Data">
              {[['', 'All markets'], ['incomplete', `Incomplete data · ${notComplete}`], ...(toCheck ? [['check', `⚠ Values to check · ${flags.total}`]] : [])].map(([k, label]) => {
                const on = k === (incomplete || (data === 'check' && toCheck) ? data : '');
                return (
                  <button
                    key={k || 'all'} type="button" role="radio" aria-checked={on}
                    onClick={() => set('data', k)} data-testid={`pricing-data-${k || 'all'}`} className={chip(on)}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
            {[['region', 'Region', facets.regions, region], ['class', 'Regulatory class', facets.classes, regulatory], ['currency', 'Currency', facets.currencies, currency]].map(([k, label, values, value]) => (
              <select key={k} className={select} value={value} onChange={(e) => set(k, e.target.value)} aria-label={label} data-testid={`pricing-filter-${k}`}>
                <option value="">{`Every ${label.toLowerCase()}`}</option>
                {values.map((v) => <option key={v} value={v}>{v}</option>)}
              </select>
            ))}
          </div>
          {/* LCD-04 B to D: the check's own line, apart from the catalogue's (#7714, owner Q8 A). */}
          {flags.state === 'unavailable' && (
            <p className="mt-2 text-[12px] text-gray-600 dark:text-gray-400" data-testid="pricing-check-unavailable">
              <Tag c={{ state: 'unavailable', label: 'Unavailable' }} /> The consistency check could not be read. No value is flagged and nothing is called consistent: the check did not answer.{' '}
              <button type="button" className="font-bold text-indigo-700 underline dark:text-indigo-300" onClick={check.retry} data-testid="pricing-check-retry">Try again</button>
            </p>
          )}
          {consistencyClearLine(flags) && <p className="mt-2 text-[12px] text-gray-600 dark:text-gray-400" data-testid="pricing-check-clear">✓ {consistencyClearLine(flags)}</p>}
          {toCheck && (
            <p className="mt-2 text-[12px] text-amber-800 dark:text-amber-300" data-testid="pricing-check-line">
              ⚠ {flags.total} {flags.total === 1 ? 'value' : 'values'} to check in {flags.countries.length} {flags.countries.length === 1 ? 'market' : 'markets'}: the consistency check compares each value with its latest history row and changes nothing.
            </p>
          )}

          {rows.length === 0 ? (
            <p className="mt-4 rounded-lg border border-dashed border-gray-300 p-6 text-center text-sm text-gray-600 dark:border-gray-700 dark:text-gray-400" data-testid="pricing-catalogue-empty">
              No market profile is recorded yet. Import the country data to price a market; until then no licence has a recommendation.
            </p>
          ) : (
            <section className={`mt-4 overflow-hidden ${cardClass}`} data-testid="pricing-catalogue">
              <div className="hidden overflow-x-auto md:block">
                <table className="w-full border-collapse text-[12.5px]" data-testid="pricing-catalogue-table">
                  <thead><tr>{columns.map((c) => <th key={c} scope="col" className={thClass}>{c}</th>)}</tr></thead>
                  <tbody>
                    {shown.map((r) => (
                      <tr key={r.code} className="border-b border-gray-100 last:border-0 dark:border-gray-800" data-testid="pricing-country-row" data-code={r.code}>
                        <td className={tdClass}>
                          <a href={`/admin/licences/pricing/country/${encodeURIComponent(r.code)}`} className="font-semibold text-gray-900 hover:underline dark:text-gray-100">{r.name}</a>
                          <small className="block font-mono text-[11px] text-gray-500 dark:text-gray-400">{r.code}</small>
                        </td>
                        <td className={tdClass}>{r.region}</td>
                        <td className={`${tdClass} font-mono`}>{r.currency}</td>
                        <td className={tdClass}><Tag c={r.completeness} testId="pricing-cell-completeness" /></td>
                        <td className={`${tdClass} font-mono text-[11.5px]`}><Tag c={r.freshness} testId="pricing-cell-freshness" /></td>
                        <td className={`${tdClass} font-mono`} data-testid="pricing-cell-revision">{r.revision ?? NOT_RECORDED}</td>
                        <td className={tdClass}>{r.regulatory === NOT_RECORDED ? <Tag c={{ state: 'not_recorded', label: NOT_RECORDED }} /> : r.regulatory}</td>
                        <td className={tdClass}><Tag c={r.tierIndex} testId="pricing-cell-tier" /></td>
                        <td className={`${tdClass} font-mono`}><Tag c={r.annual} testId="pricing-cell-annual" /></td>
                        <td className={`${tdClass} font-mono`}><Tag c={r.initial} testId="pricing-cell-initial" /></td>
                        {toCheck && <td className={tdClass}>{flagCell(r.code)}</td>}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {/* L38: a phone has no room for nine columns; each market is one row with its fee and its data state. */}
              <ul className="divide-y divide-gray-100 md:hidden dark:divide-gray-800" data-testid="pricing-catalogue-list">
                {shown.map((r) => (
                  <li key={r.code} className="flex items-start justify-between gap-3 px-4 py-3">
                    <div className="min-w-0">
                      <a href={`/admin/licences/pricing/country/${encodeURIComponent(r.code)}`} className="font-semibold text-gray-900 hover:underline dark:text-gray-100">{r.name}</a>
                      <small className="block text-[11px] text-gray-500 dark:text-gray-400"><Tag c={r.completeness} /> · <Tag c={r.freshness} /> · revision {r.revision ?? NOT_RECORDED}</small>
                      {toCheck && flags.byCountry[r.code] && <small className="block text-[11px]">{flagCell(r.code)}</small>}
                    </div>
                    <span className="shrink-0 font-mono text-[12px]"><Tag c={r.annual} /></span>
                  </li>
                ))}
              </ul>
              <div className="flex flex-wrap justify-between gap-2 border-t border-gray-100 px-4 py-2.5 font-mono text-[12px] text-gray-500 dark:border-gray-800 dark:text-gray-400">
                <span data-testid="pricing-catalogue-count">Showing {shown.length} of {rows.length} markets</span>
                <span>{Number.isFinite(cat.data.counts?.priced) ? `${cat.data.counts.priced} priced by this model · ` : ''}calculated now, stored nowhere</span>
              </div>
            </section>
          )}
        </>
      )}
    </PricingFrame>
  );
}
