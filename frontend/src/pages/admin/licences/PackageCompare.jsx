/**
 * D5898 (#5898, part 1 (c) of #5026) — compare Axal VC packages and price them for one licence, at
 * `/admin/licences/packages/compare`, board L30 of the Licences and Contracts v2 addendum. Read only.
 *
 * Reads (each its own state, Super Admin on HQ):
 *   - the catalogue (`licencePackagesApi.catalogue`) and each compared version's items (`version`): the program
 *     grid. L30 composes it from each version's items, since no matrix read exists;
 *   - every licence (`licenceLedgerApi.all`) for the "Price for" picker;
 *   - the chosen licence's package pricing (`licencePackagesApi.pricing`, D5023): country-adjusted price,
 *     standalone sum, bundle saving and warnings, as the Worker returns them. A licence with no country
 *     recommendation is said as that (409 `no_licence_snapshot`), not as a failed read.
 *
 * `?licence=<uid>` keeps the chosen licence. `?package=<key>&version=<n>` (a catalogue row's Preview pricing)
 * narrows the comparison to that one version, and prices that version, a draft included. Nothing here writes:
 * Review offer and Accept are L31 and L32 (#5024), and no such control is drawn.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { licencePackagesApi } from '../../../lib/api/licencePackages';
import { licenceLedgerApi } from '../../../lib/api/licenceLedger';
import { reportError } from '../../../lib/log';
import { AdminPageHeader } from '../../../ui';
import AdminBoardFrame from '../AdminBoardFrame';
import { statusWord } from './packageCatalogueModel';
import {
  COMPOSED_NOTE, NOT_RECORDED, PRICE_ROWS, columnId, compareColumns, licenceLabel, priceCells, programGrid, provenance, recFor,
} from './packageCompareModel';

const CARD = 'rounded-xl border border-gray-200 bg-white px-[18px] py-4 dark:border-gray-800 dark:bg-gray-900';
const SUB = 'text-[12px] leading-[1.45] text-gray-500 dark:text-gray-400';
const TH = 'px-3 py-2 text-left text-[10.5px] font-bold uppercase tracking-[.07em] text-gray-500 dark:text-gray-400';
const TD = 'px-3 py-2.5 align-top text-[13px] text-gray-900 dark:text-gray-100';
const ALERT = 'flex flex-wrap items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[13px] text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200';
const NOTE = 'rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[13px] text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200';
const GHOST = 'rounded-md border border-red-300 px-2 py-0.5 text-[12px] font-semibold dark:border-red-800';
const SELECT = 'ml-2 rounded-md border border-gray-300 bg-white px-2 py-1 text-[13px] text-gray-900 dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100';

function Failed({ text, onRetry, testId }) {
  return (
    <div role="alert" className={ALERT} data-testid={testId}>
      <span><b>Unreadable.</b> {text}</span>
      <button type="button" className={GHOST} onClick={onRetry}>Try again</button>
    </div>
  );
}

/** One read with its own state and a retry. `load` null leaves it idle. */
function useRead(load, deps) {
  const [read, setRead] = useState({ state: load ? 'loading' : 'idle', data: null, error: null });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!load) { setRead({ state: 'idle', data: null, error: null }); return undefined; }
    let live = true;
    setRead({ state: 'loading', data: null, error: null });
    load().then(
      (data) => { if (live) setRead({ state: 'ready', data, error: null }); },
      (e) => { reportError('licence-packages:compare', e); if (live) setRead({ state: 'error', data: null, error: e }); },
    );
    return () => { live = false; };
  }, [...deps, tick]); // eslint-disable-line react-hooks/exhaustive-deps
  return [read, useCallback(() => setTick((t) => t + 1), [])];
}

/** Each compared version's items, keyed `key:version`; a failure is that column's alone. */
function useItems(columns) {
  const [details, setDetails] = useState({});
  const wanted = columns.map(columnId).join('|');
  useEffect(() => {
    let live = true;
    for (const v of columns) {
      const id = columnId(v);
      licencePackagesApi.version(v.package_key, v.version).then(
        (r) => { if (live) setDetails((d) => ({ ...d, [id]: { state: 'ready', items: r?.package?.items || [] } })); },
        (e) => { reportError('licence-packages:version', e); if (live) setDetails((d) => ({ ...d, [id]: { state: 'error' } })); },
      );
    }
    return () => { live = false; };
  }, [wanted]); // eslint-disable-line react-hooks/exhaustive-deps
  return details;
}

const MARK = {
  included: <span className="font-bold text-emerald-700 dark:text-emerald-300" aria-label="Included">✓</span>,
  optional: <span className="text-[12px] text-gray-600 dark:text-gray-300">Optional</span>,
  none: <span className="text-gray-400 dark:text-gray-500" aria-label="Not included">—</span>,
  unreadable: <span className="font-semibold text-red-700 dark:text-red-300">! Unreadable</span>,
  loading: <span className="text-gray-400">…</span>,
};

function Value({ cell }) {
  const missing = cell.text === NOT_RECORDED;
  return (
    <div>
      <span className={missing ? 'italic text-gray-500 dark:text-gray-400' : 'font-semibold'}>{cell.text}</span>
      {cell.note ? <div className={`${SUB} mt-0.5`}>{cell.note}</div> : null}
    </div>
  );
}

function Warnings({ cell }) {
  if (!cell.list?.length) return <span className="text-gray-600 dark:text-gray-300">{cell.text}</span>;
  return (
    <ul className="m-0 list-none p-0" data-testid="package-compare-warnings">
      {cell.list.map((w) => <li key={w.code} className="text-[12px] leading-[1.45] text-amber-800 dark:text-amber-200">{w.sentence}</li>)}
    </ul>
  );
}

function PricingState({ read, onRetry, licence }) {
  if (!licence) {
    return <p className={`${SUB} m-0`} data-testid="package-compare-no-licence">Choose a licence under “Price for” to see each package at its market. The base prices and programs above do not depend on it.</p>;
  }
  if (read.state === 'loading') return <p className={`${SUB} m-0`}>Pricing for this licence…</p>;
  if (read.state === 'error' && read.error?.code === 'no_licence_snapshot') {
    return <div className={NOTE} data-testid="package-compare-no-snapshot"><b>No country recommendation yet.</b> {read.error.message || 'Make one under the licence’s Country pricing first.'}</div>;
  }
  if (read.state === 'error') return <Failed text="The package pricing for this licence could not be read. Nothing below is a price." onRetry={onRetry} testId="package-compare-pricing-unreadable" />;
  const p = provenance(read.data);
  if (!p) return null;
  return (
    <p className={`${SUB} m-0`} data-testid="package-compare-provenance">
      Priced from the licence’s country recommendation of {p.snapshot} ({p.latest}) · pricing model {p.model} · country index {p.index}
      {p.indexReason ? ` (${p.indexReason})` : ''}.
    </p>
  );
}

export function PackageCompareView() {
  const [params, setParams] = useSearchParams();
  const licence = params.get('licence') || '';
  const only = params.get('package') ? { package_key: params.get('package'), version: params.get('version') } : null;

  const [catalogue, retryCatalogue] = useRead(() => licencePackagesApi.catalogue(), []);
  const [licences, retryLicences] = useRead(() => licenceLedgerApi.all(), []);
  const columns = useMemo(() => compareColumns(catalogue.data?.packages, only), [catalogue.data, only?.package_key, only?.version]); // eslint-disable-line react-hooks/exhaustive-deps
  const details = useItems(columns);
  const grid = useMemo(() => programGrid(columns, details), [columns, details]);
  const pricingQuery = only && columns[0] ? { package: columns[0].package_key, version: columns[0].version } : {};
  const [pricing, retryPricing] = useRead(
    licence ? () => licencePackagesApi.pricing(licence, pricingQuery) : null,
    [licence, pricingQuery.package, pricingQuery.version],
  );

  const choose = (uid) => {
    const next = new URLSearchParams(params);
    if (uid) next.set('licence', uid); else next.delete('licence');
    setParams(next, { replace: true });
  };
  const chosenLicence = (licences.data?.items || []).find((l) => l.uid === licence);
  const priced = pricing.state === 'ready';

  return (
    <div className="flex flex-col gap-4">
      <AdminPageHeader
        crumb={{ label: 'Axal VC packages', to: '/admin/licences/packages', current: 'Compare' }}
        title="Compare Axal VC packages"
        pills={[{ label: 'HQ only', tone: 'hq' }]}
        line={only ? 'One Axal VC package version, priced for the licence you choose.' : 'Programs by Axal VC package, at the active version of each, priced for the licence you choose.'}
        data-testid="package-compare-header"
      />
      <section className={`${CARD} flex flex-wrap items-center gap-3`}>
        {licences.state === 'error' ? <Failed text="The licences could not be read, so none can be chosen." onRetry={retryLicences} testId="package-compare-licences-unreadable" />
          : (
            <label className="text-[13px] font-semibold text-gray-900 dark:text-gray-100">
              Price for
              <select className={SELECT} value={licence} onChange={(e) => choose(e.target.value)} disabled={licences.state !== 'ready'} data-testid="package-compare-licence">
                <option value="">{licences.state === 'ready' ? 'Choose a licence…' : 'Reading licences…'}</option>
                {(licences.data?.items || []).map((l) => <option key={l.uid} value={l.uid}>{licenceLabel(l)}</option>)}
              </select>
            </label>
          )}
        {licences.state === 'ready' && licences.data?.complete === false ? <span className={SUB}>Only the first licences are listed: the list was cut.</span> : null}
        {only ? <Link to={licence ? `/admin/licences/packages/compare?licence=${encodeURIComponent(licence)}` : '/admin/licences/packages/compare'} className="text-[13px] font-semibold text-indigo-700 hover:underline dark:text-indigo-300">Compare every active package</Link> : null}
      </section>
      <PricingState read={pricing} onRetry={retryPricing} licence={licence} />
      {catalogue.state === 'error' ? <Failed text="The Axal VC package catalogue could not be read. This is not a claim that there are none." onRetry={retryCatalogue} testId="package-compare-unreadable" />
        : catalogue.state === 'loading' ? <p className={SUB}>Reading…</p>
          : !columns.length ? (
            <section className={CARD} data-testid="package-compare-none">
              <b className="text-[14px] text-gray-900 dark:text-gray-100">{only ? 'That Axal VC package version does not exist' : 'No Axal VC package is active yet'}</b>
              <p className={`${SUB} m-0`}>{only ? 'The catalogue read holds no such version.' : 'The comparison lists active versions only. A draft is priced from its catalogue row’s Preview pricing.'}</p>
            </section>
          ) : (
            <section className={`${CARD} flex flex-col gap-2 !px-0 !pb-2`}>
              <div className="overflow-x-auto">
                <table className="w-full border-collapse" data-testid="package-compare-table">
                  <thead>
                    <tr className="border-b border-gray-200 dark:border-gray-800">
                      <th className={TH}>Program</th>
                      {columns.map((v) => (
                        <th key={columnId(v)} className={TH} data-testid="package-compare-column">
                          <span className="normal-case tracking-normal text-[13px] text-gray-900 dark:text-gray-100">{v.name}</span>{' '}
                          <span className="font-mono normal-case">v{v.version}</span>
                          {v.status !== 'active' ? <span className="ml-1 normal-case">· {statusWord(v.status)}</span> : null}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {grid.map((row) => (
                      <tr key={row.program} className="border-b border-gray-100 dark:border-gray-800" data-testid="package-compare-program">
                        <td className={`${TD} font-mono text-[12px]`}>{row.program}</td>
                        {row.cells.map((c, i) => <td key={columnId(columns[i])} className={TD}>{MARK[c]}</td>)}
                      </tr>
                    ))}
                    {PRICE_ROWS.map(([key, label]) => (
                      <tr key={key} className="border-b border-gray-100 bg-gray-50/60 last:border-0 dark:border-gray-800 dark:bg-gray-950/40" data-testid={`package-compare-${key}`}>
                        <td className={`${TD} font-semibold`}>{key === 'adjusted' && chosenLicence ? `${label} · ${licenceLabel(chosenLicence)}` : label}</td>
                        {columns.map((v) => {
                          const cells = priceCells(v, priced ? recFor(pricing.data, v) : undefined, { licenceChosen: Boolean(licence), priced });
                          return <td key={columnId(v)} className={TD}>{key === 'warnings' ? <Warnings cell={cells.warnings} /> : <Value cell={cells[key]} />}</td>;
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className={`${SUB} m-0 px-[18px]`} data-testid="package-compare-note">{COMPOSED_NOTE} ✓ included by default, Optional listed but not included, — not in that version. Standalone sum and saving count the programs included by default.</p>
            </section>
          )}
    </div>
  );
}

export default function PackageCompare() {
  return (
    <AdminBoardFrame workspace="Licences" note="Eadwyn reads the Axal VC packages and one licence’s package pricing. It changes nothing." data-testid="admin-board-package-compare">
      <PackageCompareView />
    </AdminBoardFrame>
  );
}
