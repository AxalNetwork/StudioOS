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
 * The row's rules are `packageCatalogueModel.js`.
 *
 * D5897 (#5897, part 1 (b)) — the writes, as L29 draws them:
 *   - the header's "Create draft version…": the next draft of a chosen key, starting from its newest version, or
 *     a new key's v1 (`PackageDraftEditor.jsx`);
 *   - a Draft row: Edit draft and Publish…; an Active row: Retire…; a Retired row: nothing (`rowActions`);
 *   - Publish and Retire ask a reason (3 to 500 characters, the Worker's rule) and say first what will happen
 *     (`publishConsequence`, `retireConsequence`), through `LicenceReasonDialog`.
 * After every write, success or not, the catalogue, the shown programs and the history are read again, so the page
 * shows what is recorded. A refusal is the Worker's sentence; any other failure says the outcome is not known.
 *
 * D5898 (#5898, part 1 (c)): each row's Preview pricing opens the comparison narrowed to that version, and
 * the header links the full comparison (`PackageCompare.jsx`).
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { licencePackagesApi } from '../../../lib/api/licencePackages';
import { programGrantsApi } from '../../../lib/api/programGrants';
import { reportError } from '../../../lib/log';
import { AdminPageHeader } from '../../../ui';
import AdminBoardFrame from '../AdminBoardFrame';
import PackageItemDeliveryEditor from './PackageItemDeliveryEditor';
import Lightbox from '../../../ui/Lightbox';
import { useReasonDialog } from '../LicenceReasonDialog';
import {
  CATALOGUE_COLUMNS, NOT_RECORDED, PER_LICENCE_REASON, catalogueRows, historyRows, localGrantLabel, rowCells,
} from './packageCatalogueModel';
import {
  ACTION_LABELS, NEW_PACKAGE, REASON_MAX_PACKAGES, REASON_MIN, formFrom, keyOptions, newestOf, publishConsequence,
  retireConsequence, rowActions, writeFailure,
} from './packageDraftModel';
import PackageDraftEditor from './PackageDraftEditor';
import { previewHref } from './packageCompareModel';

const CARD = 'rounded-xl border border-gray-200 bg-white px-[18px] py-4 dark:border-gray-800 dark:bg-gray-900';
const H2 = 'm-0 text-[15px] font-extrabold tracking-[-.02em] text-gray-900 dark:text-gray-100';
const SUB = 'text-[12px] leading-[1.45] text-gray-500 dark:text-gray-400';
const TH = 'px-3 py-2 text-left text-[10.5px] font-bold uppercase tracking-[.07em] text-gray-500 dark:text-gray-400';
const TD = 'px-3 py-2.5 align-top text-[13px] text-gray-900 dark:text-gray-100';
const ALERT = 'flex flex-wrap items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[13px] text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200';
const GHOST = 'rounded-md border border-red-300 px-2 py-0.5 text-[12px] font-semibold dark:border-red-800';
const PRIMARY = 'rounded-md bg-indigo-700 px-3 py-1.5 text-[13px] font-semibold text-white hover:bg-indigo-800 disabled:opacity-50';
const LINK = 'text-left text-[12px] font-semibold text-indigo-700 hover:underline disabled:opacity-50 dark:text-indigo-300';
const OK = 'rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-[13px] text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-200';
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
function useDetails(versions, reload = 0) {
  const [details, setDetails] = useState({});
  const wanted = `${reload}#${versions.map((v) => `${v.package_key}:${v.version}`).join('|')}`;
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

function RowActions({ v, busy, onAct }) {
  const acts = rowActions(v.status);
  if (!acts.length) return null;
  return (
    <span className="flex flex-col gap-1 whitespace-nowrap" data-testid="package-row-actions">
      {acts.map((a) => (
        <button key={a} type="button" className={LINK} disabled={busy} onClick={() => onAct(a, v)}
          aria-label={`${ACTION_LABELS[a].replace('…', '')} ${v.name} v${v.version}`}>
          {a === 'publish' ? <b>{ACTION_LABELS[a]}</b> : ACTION_LABELS[a]}
        </button>
      ))}
    </span>
  );
}

function CatalogueTable({ rows, details, chosen, onChoose, busy, onAct }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse" data-testid="package-catalogue-table">
        <thead><tr className="border-b border-gray-200 dark:border-gray-800">{CATALOGUE_COLUMNS.map((h) => <th key={h} className={TH}>{h}</th>)}<th className={TH}><span className="sr-only">Actions</span></th></tr></thead>
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
                <td className={TD}><span className="inline-flex flex-wrap items-center gap-3"><Link to={previewHref(v)} className="whitespace-nowrap text-[12.5px] font-semibold text-indigo-700 hover:underline dark:text-indigo-300" data-testid="package-preview-pricing">Preview pricing</Link><RowActions v={v} busy={busy} onAct={onAct} /></span></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function VersionHistoryRow({ row, packageKey, defaults, rulesState, reload: versionReload }) {
  const [read, reload] = useRead(() => licencePackagesApi.version(packageKey, row.number), [packageKey, row.number, versionReload]);
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

function VersionHistory({ packageKey, name, reload }) {
  const [read, retry] = useRead(() => licencePackagesApi.versions(packageKey), [packageKey, reload]);
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
                    defaults={defaults} rulesState={rules.state} reload={reload} />)}
                </tbody>
              </table>
            </div>
          )}
    </section>
  );
}

/** The Create draft version chooser: which key's next draft, or a new key. */
function ChooseKey({ options, onPick, onClose }) {
  const [key, setKey] = useState(options[0]?.key ?? NEW_PACKAGE);
  return (
    <Lightbox label="Create draft version" title="Create draft version" onClose={onClose} width={440} testId="package-draft-choose"
      footer={(
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-md border border-gray-300 px-3 py-1.5 text-sm dark:border-gray-700">Cancel</button>
          <button type="button" className={PRIMARY} onClick={() => onPick(key)}>Continue</button>
        </div>
      )}
    >
      <label className="block text-[12.5px] font-semibold text-gray-800 dark:text-gray-200">
        Axal VC package
        <select className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm dark:border-gray-700 dark:bg-gray-900" value={key} onChange={(e) => setKey(e.target.value)}>
          {options.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
          <option value={NEW_PACKAGE}>A new Axal VC package (v1)</option>
        </select>
        <span className="mt-0.5 block text-[11.5px] font-normal text-gray-500 dark:text-gray-400">A next version starts from that package’s newest version; nothing published changes until the draft is published.</span>
      </label>
    </Lightbox>
  );
}

export function PackageCatalogueView() {
  const [reload, setReload] = useState(0);
  const [read, retry] = useRead(() => licencePackagesApi.catalogue(), [reload]);
  const all = read.data?.packages;
  const rows = useMemo(() => catalogueRows(all), [all]);
  const details = useDetails(rows, reload);
  const [picked, setPicked] = useState(null);
  const chosen = rows.some((r) => r.package_key === picked) ? picked : rows[0]?.package_key ?? null;
  const chosenName = rows.find((r) => r.package_key === chosen)?.name;
  const [dialog, askReason] = useReasonDialog();
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState(null);
  const [choosing, setChoosing] = useState(false);
  const [editor, setEditor] = useState(null);
  const reread = () => setReload((n) => n + 1);

  /** Opens the editor once the version it starts from (with its programs) is read. */
  async function openEditor(target, from) {
    setOutcome(null);
    if (!from) { setEditor({ target, initial: formFrom(null) }); return; }
    setBusy(true);
    try {
      const r = await licencePackagesApi.version(from.package_key, from.version);
      setEditor({ target, initial: formFrom(r?.package || from, r?.package?.items) });
    } catch (e) {
      reportError('licence-packages:version', e);
      setOutcome({ ok: false, title: `${from.name} v${from.version} could not be read, so the editor did not open.`, lines: [e?.message || 'No answer from the Worker.'] });
    } finally { setBusy(false); }
  }

  function pickKey(key) {
    setChoosing(false);
    if (key === NEW_PACKAGE) { openEditor({ mode: 'new' }, null); return; }
    const newest = newestOf(all, key);
    openEditor({ mode: 'next', packageKey: key, name: newest.name, nextVersion: newest.version + 1 }, newest);
  }

  function saveFor(target) {
    if (target.mode === 'new') return (body) => licencePackagesApi.create(body);
    if (target.mode === 'next') return (body) => licencePackagesApi.draftNext(target.packageKey, body);
    return (body) => licencePackagesApi.editDraft(target.packageKey, target.version, body);
  }

  function onSaved(pkg) {
    const t = editor.target;
    setEditor(null);
    if (pkg?.package_key) setPicked(pkg.package_key); else if (t.packageKey) setPicked(t.packageKey);
    setOutcome({ ok: true, title: pkg ? `Saved. ${pkg.name} v${pkg.version} is a draft: it is not offered until it is published.` : 'Saved.' });
    reread();
  }

  async function onAct(action, v) {
    setOutcome(null);
    if (action === 'edit') { openEditor({ mode: 'edit', packageKey: v.package_key, version: v.version, name: v.name }, v); return; }
    const active = (all || []).find((x) => x.package_key === v.package_key && x.status === 'active');
    const spec = action === 'publish'
      ? { title: `Publish ${v.name} v${v.version}`, question: 'Why is this version being published? It is recorded with the change.', consequence: publishConsequence(v, active), confirm: 'Publish', tone: 'ok' }
      : { title: `Retire ${v.name} v${v.version}`, question: 'Why is this version being retired? It is recorded with the change.', consequence: retireConsequence(v), confirm: 'Retire', tone: 'danger' };
    const reason = await askReason({ ...spec, min: REASON_MIN, max: REASON_MAX_PACKAGES });
    if (!reason) return;
    setBusy(true);
    try {
      if (action === 'publish') {
        const r = await licencePackagesApi.publish(v.package_key, v.version, reason);
        const retired = r?.retired_version;
        setOutcome({ ok: true, title: `Published. ${v.name} v${v.version} is in force.${retired ? ` v${retired} was retired.` : ''}` });
      } else {
        await licencePackagesApi.retire(v.package_key, v.version, reason);
        setOutcome({ ok: true, title: `Retired. ${v.name} v${v.version} is no longer offered.` });
      }
    } catch (e) {
      reportError(`licence-packages:${action}`, e);
      const f = writeFailure(e, action === 'publish' ? 'Publish' : 'Retire');
      setOutcome({ ok: false, title: f.title, lines: f.lines });
    } finally {
      setBusy(false);
      setPicked(v.package_key);
      reread();
    }
  }

  const create = (
    <button type="button" className={PRIMARY} disabled={busy || read.state !== 'ready'} data-testid="package-create-draft"
      onClick={() => { setOutcome(null); if (rows.length) setChoosing(true); else openEditor({ mode: 'new' }, null); }}>
      Create draft version…
    </button>
  );

  return (
    <div className="flex flex-col gap-4">
      <AdminPageHeader
        crumb={{ label: 'Licences', to: '/admin/licences', current: 'Axal VC packages' }}
        title="Axal VC packages"
        pills={[{ label: 'HQ only', tone: 'hq' }]}
        actions={create}
        line="Versioned bundles of programs HQ offers to licensees. A published version is frozen; a change is a new draft version."
        data-testid="package-catalogue-header"
      />
      {outcome ? (
        <div role={outcome.ok ? 'status' : 'alert'} className={outcome.ok ? OK : ALERT} data-testid={outcome.ok ? 'package-write-done' : 'package-write-failed'}>
          <span><b>{outcome.title}</b>{outcome.lines?.length ? ' ' : ''}{(outcome.lines || []).join(' ')}</span>
        </div>
      ) : null}
      {read.state === 'error' ? <Failed text="The Axal VC package catalogue could not be read. This is not a claim that there are none." onRetry={retry} testId="package-catalogue-unreadable" />
        : read.state === 'loading' ? <p className={SUB}>Reading…</p>
          : !rows.length ? (
            <section className={CARD} data-testid="package-catalogue-none">
              <b className="text-[14px] text-gray-900 dark:text-gray-100">No Axal VC package exists yet</b>
              <p className={`${SUB} m-0`}>The read succeeded and holds no version. Create the first draft version.</p>
            </section>
          ) : (
            <>
              <section className={`${CARD} flex flex-col gap-2 !px-0 !pb-2`}>
                <CatalogueTable rows={rows} details={details} chosen={chosen} onChoose={setPicked} busy={busy} onAct={onAct} />
                <p className={`${SUB} m-0 px-[18px]`} data-testid="package-catalogue-note">Standalone sum and Bundle saving: {PER_LICENCE_REASON} <Link to="/admin/licences/packages/compare" className="font-semibold text-indigo-700 hover:underline dark:text-indigo-300">Compare Axal VC packages for one licence</Link></p>
              </section>
              {chosen ? <VersionHistory key={chosen} packageKey={chosen} name={chosenName} reload={reload} /> : null}
            </>
          )}
      {choosing ? <ChooseKey options={keyOptions(all)} onPick={pickKey} onClose={() => setChoosing(false)} /> : null}
      {editor ? <PackageDraftEditor target={editor.target} initial={editor.initial} save={saveFor(editor.target)} onSaved={onSaved} onClose={() => setEditor(null)} /> : null}
      {dialog}
    </div>
  );
}

export default function PackageCatalogue() {
  return (
    <AdminBoardFrame workspace="Licences" note="Eadwyn reads the Axal VC package catalogue. Drafting, publishing and retiring are yours." data-testid="admin-board-package-catalogue">
      <PackageCatalogueView />
    </AdminBoardFrame>
  );
}
