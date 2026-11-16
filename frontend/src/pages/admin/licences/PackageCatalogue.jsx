/**
 * D5896 (#5896, part 1 (a) of #5026) — HQ's Axal VC package catalogue at `/admin/licences/packages`, board L29 of
 * the Licences and Contracts v2 addendum. The catalogue table and one package’s version history.
 *
 * Reads (`lib/api/licencePackages.js`, Super Admin on HQ):
 *   - the catalogue, every version (`?all=1`): one block state. A failed read is Unreadable with Try again and
 *     never an empty catalogue; an empty read is None;
 *   - each shown version's detail, for its programs: its own cell state, so one failed detail leaves the table;
 *   - the chosen package's versions, for the history card: its own block state.
 *
 * The row rules live in packageCatalogueModel.js. HQ can edit delivery terms on eligible draft items.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { licencePackagesApi } from '../../../lib/api/licencePackages';
import { programGrantsApi } from '../../../lib/api/programGrants';
import { reportError } from '../../../lib/log';
import { AdminPageHeader } from '../../../ui';
import AdminBoardFrame from '../AdminBoardFrame';
import PackageItemDeliveryEditor from './PackageItemDeliveryEditor';
import {
  CATALOGUE_COLUMNS, NOT_RECORDED, PER_LICENCE_REASON, catalogueRows, historyRows, localGrantLabel, rowCells,
} from './packageCatalogueModel';

const CARD = 'rounded-xl border border-gray-200 bg-white px-[18px] py-4 dark:border-gray-800 dark:bg-gray-900';
const H2 = 'm-0 text-[15px] font-extrabold tracking-[-.02em] text-gray-900 dark:text-gray-100';
const SUB = 'text-[12px] leading-[1.45] text-gray-500 dark:text-gray-400';
const TH = 'px-3 py-2 text-left text-[10.5px] font-bold uppercase tracking-[.07em] text-gray-500 dark:text-gray-400';
const TD = 'px-3 py-2.5 align-top text-[13px] text-gray-900 dark:text-gray-100';
const ALERT = 'flex flex-wrap items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[13px] text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200';
const GHOST = 'rounded-md border border-red-300 px-2 py-0.5 text-[12px] font-semibold dark:border-red-800';
const PILL = {
  Active: 'bg-emerald-50 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200',
  Draft: 'bg-amber-50 text-amber-800 dark:bg-amber-950 dark:text-amber-200',
  Retired: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300',
};

function Pill({ word }) {
  return <span className={`inline-block rounded-full px-2 py-0.5 text-[11.5px] font-bold ${PILL[word] || PILL.Retired}`}>{word}</span>;
}

function Failed({ text, onRetry, testId }) {
  return (
    <div role="alert" className={ALERT} data-testid={testId}>
      <span><b>Unreadable.</b> {text}</span>
      <button type="button" className={GHOST} onClick={onRetry}>Try again</button>
    </div>
  );
}

const absent = (word) => word === NOT_RECORDED || word === 'Unreadable';
function Cell({ word, mono = false }) {
  if (word === 'Unreadable') return <span className="font-semibold text-red-700 dark:text-red-300">! Unreadable</span>;
  if (absent(word)) return <span className="italic text-gray-500 dark:text-gray-400">{word}</span>;
  return <span className={mono ? 'font-mono text-[12.5px]' : ''}>{word}</span>;
}

/** One read with its own state and a retry. */
function useRead(load, deps) {
  const [read, setRead] = useState({ state: 'loading', data: null });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    setRead({ state: 'loading', data: null });
    load().then(
      (data) => { if (live) setRead({ state: 'ready', data }); },
      (e) => { reportError('licence-packages:read', e); if (live) setRead({ state: 'error', data: null }); },
    );
    return () => { live = false; };
  }, [...deps, tick]); // eslint-disable-line react-hooks/exhaustive-deps
  return [read, useCallback(() => setTick((t) => t + 1), [])];
}

/** Each listed version's detail (its programs), keyed `key:version`; a failure is that version's alone. */
function useDetails(versions) {
  const [details, setDetails] = useState({});
  const wanted = versions.map((v) => `${v.package_key}:${v.version}`).join('|');
  useEffect(() => {
    let live = true;
    for (const v of versions) {
      const id = `${v.package_key}:${v.version}`;
      licencePackagesApi.version(v.package_key, v.version).then(
        (r) => { if (live) setDetails((d) => ({ ...d, [id]: { state: 'ready', items: r?.package?.items || [] } })); },
        (e) => { reportError('licence-packages:version', e); if (live) setDetails((d) => ({ ...d, [id]: { state: 'error' } })); },
      );
    }
    return () => { live = false; };
  }, [wanted]); // eslint-disable-line react-hooks/exhaustive-deps
  return details;
}

function CatalogueTable({ rows, details, chosen, onChoose }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse" data-testid="package-catalogue-table">
        <thead><tr className="border-b border-gray-200 dark:border-gray-800">{CATALOGUE_COLUMNS.map((h) => <th key={h} className={TH}>{h}</th>)}</tr></thead>
        <tbody>
          {rows.map((v) => {
            const c = rowCells(v, details[`${v.package_key}:${v.version}`]);
            return (
              <tr key={`${v.package_key}:${v.version}`} className={`border-b border-gray-100 last:border-0 dark:border-gray-800 ${chosen === v.package_key ? 'bg-indigo-50/60 dark:bg-indigo-950/40' : ''}`} data-testid="package-row">
                <td className={TD}>
                  <button type="button" className="text-left font-bold text-indigo-700 hover:underline dark:text-indigo-300" onClick={() => onChoose(v.package_key)} aria-pressed={chosen === v.package_key}>{c.name}</button>
                </td>
                <td className={TD}><Cell word={c.version} mono /></td>
                <td className={TD}><Pill word={c.status} /></td>
                <td className={TD}><Cell word={c.programs} /></td>
                <td className={TD}><Cell word={c.base} /></td>
                <td className={TD}><Cell word={c.guidance} /></td>
                <td className={TD}><Cell word={c.standalone} /></td>
                <td className={TD}><Cell word={c.saving} /></td>
                <td className={TD}><Cell word={c.effective} mono={!absent(c.effective) && c.effective !== 'Not in force'} /></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function VersionHistoryRow({ row, packageKey, defaults, rulesState }) {
  const [read, reload] = useRead(() => licencePackagesApi.version(packageKey, row.number), [packageKey, row.number]);
  const [editing, setEditing] = useState(null);
  const [notice, setNotice] = useState('');
  const detail = read.data?.package;
  const latest = detail?.status ? historyRows([detail])[0] : row;
  const items = detail?.items;
  const refresh = (message) => {
    setEditing(null);
    setNotice(message);
    reload();
  };

  return (
    <tr className="border-b border-gray-100 last:border-0 dark:border-gray-800" data-testid="package-history-row">
      <td className={TD}><Cell word={row.version} mono /></td>
      <td className={TD}><Pill word={latest.status} /></td>
      <td className={`${TD} text-[12px]`}>
        {Array.isArray(items) && items.length ? (
          <ul className="m-0 list-none space-y-1 p-0">
            {items.map((item) => {
              const rule = Array.isArray(defaults) ? defaults.find((p) => p.program_key === item.program_key) : null;
              const name = rule?.name || item.program_key;
              const availability = Array.isArray(defaults) ? localGrantLabel(rule)
                : rulesState === 'loading' ? 'Reading availability…' : 'Availability unreadable';
              return <li key={item.program_key}>
                <b>{name}</b>{' · '}
                {item.delivery?.kind === 'hq_service'
                  ? <>HQ service · {item.delivery.description}</>
                  : <>Studio operation · {availability}</>}
                {item.included_by_default === false ? ' · Optional' : ''}
                {detail.status === 'draft' && rule?.readiness === 'hq' && (editing === item.program_key
                  ? <PackageItemDeliveryEditor packageKey={packageKey} version={row.number} item={item} name={name}
                      onCancel={() => setEditing(null)} onSaved={() => refresh(`Saved delivery for ${name}.`)} onReload={() => refresh('')} />
                  : <button type="button" className="ml-2 font-semibold text-indigo-700 hover:underline disabled:opacity-50 dark:text-indigo-300"
                      disabled={Boolean(editing)} aria-label={`Edit delivery for ${name}, ${row.version}`}
                      onClick={() => { setNotice(''); setEditing(item.program_key); }}>Edit delivery</button>)}
              </li>;
            })}
          </ul>
        ) : read.state === 'error' || (read.state === 'ready' && !Array.isArray(items))
          ? <Failed text="This version’s items could not be read." onRetry={reload} />
          : <Cell word={read.state === 'loading' ? '…' : 'None'} />}
        {notice && <p role="status" className={SUB}>{notice}</p>}
      </td>
      <td className={TD}><Cell word={latest.effective} /></td>
      <td className={TD}><Cell word={latest.created} /></td>
    </tr>
  );
}

function VersionHistory({ packageKey, name }) {
  const [read, retry] = useRead(() => licencePackagesApi.versions(packageKey), [packageKey]);
  const versions = read.data?.versions || [];
  const [rules, retryRules] = useRead(() => programGrantsApi.defaults(), []);
  const defaults = rules.data?.programs;
  return (
    <section className={`${CARD} flex flex-col gap-2`} data-testid="package-history">
      <h2 className={H2}>Version history · {name}</h2>
      <p className={SUB}>HQ services list the work HQ provides. Studio operation requires a compatible existing grant or eligibility for a new grant.</p>
      {rules.state === 'error' ? <Failed text="Current availability for new studio grants could not be read." onRetry={retryRules} testId="package-delivery-unreadable" /> : null}
      {read.state === 'error' ? <Failed text="The versions of this Axal VC package could not be read." onRetry={retry} testId="package-history-unreadable" />
        : read.state === 'loading' ? <p className={SUB}>Reading…</p>
          : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse">
                <thead><tr className="border-b border-gray-200 dark:border-gray-800">{['Version', 'Status', 'Programs', 'Effective', 'Created'].map((h) => <th key={h} className={TH}>{h}</th>)}</tr></thead>
                <tbody>
                  {historyRows(versions).map((row) => <VersionHistoryRow key={row.key} row={row} packageKey={packageKey}
                    defaults={defaults} rulesState={rules.state} />)}
                </tbody>
              </table>
            </div>
          )}
    </section>
  );
}

export function PackageCatalogueView() {
  const [read, retry] = useRead(() => licencePackagesApi.catalogue(), []);
  const rows = useMemo(() => catalogueRows(read.data?.packages), [read.data]);
  const details = useDetails(rows);
  const [picked, setPicked] = useState(null);
  const chosen = rows.some((r) => r.package_key === picked) ? picked : rows[0]?.package_key ?? null;
  const chosenName = rows.find((r) => r.package_key === chosen)?.name;
  return (
    <div className="flex flex-col gap-4">
      <AdminPageHeader
        crumb={{ label: 'Licences', to: '/admin/licences', current: 'Axal VC packages' }}
        title="Axal VC packages"
        pills={[{ label: 'HQ only', tone: 'hq' }]}
        line="Versioned bundles of programs HQ offers to licensees. A published version is frozen; a change is a new draft version."
        data-testid="package-catalogue-header"
      />
      {read.state === 'error' ? <Failed text="The Axal VC package catalogue could not be read. This is not a claim that there are none." onRetry={retry} testId="package-catalogue-unreadable" />
        : read.state === 'loading' ? <p className={SUB}>Reading…</p>
          : !rows.length ? (
            <section className={CARD} data-testid="package-catalogue-none">
              <b className="text-[14px] text-gray-900 dark:text-gray-100">No Axal VC package exists yet</b>
              <p className={`${SUB} m-0`}>The read succeeded and holds no version. Drafting the first one is part of the next release of this page.</p>
            </section>
          ) : (
            <>
              <section className={`${CARD} flex flex-col gap-2 !px-0 !pb-2`}>
                <CatalogueTable rows={rows} details={details} chosen={chosen} onChoose={setPicked} />
                <p className={`${SUB} m-0 px-[18px]`} data-testid="package-catalogue-note">Standalone sum and Bundle saving: {PER_LICENCE_REASON}</p>
              </section>
              {chosen ? <VersionHistory key={chosen} packageKey={chosen} name={chosenName} /> : null}
            </>
          )}
    </div>
  );
}

export default function PackageCatalogue() {
  return (
    <AdminBoardFrame workspace="Licences" note="Review version history and draft delivery terms." data-testid="admin-board-package-catalogue">
      <PackageCatalogueView />
    </AdminBoardFrame>
  );
}
