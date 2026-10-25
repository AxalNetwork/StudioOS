import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { RefreshCw } from 'lucide-react';
import { api, programGrantsApi } from '../../../lib/api';
import { reportError } from '../../../lib/log';
import { AdminPageHeader, HeaderMenuItem, HeaderTab } from '../../../ui';
import AdminBoardFrame from '../AdminBoardFrame';
import {
  LEDGER_PATH, NO_STORE, NOT_RECORDED_GRANT, PROGRAMS, hqCell, programGroups, studioRows, studiosTile,
} from '../../../lib/programGrants';

/**
 * D981 (#2376) — Program grants at /admin/licences/programs, the Super
 * Admin's page for which programs each licensed studio may run, built to the
 * owner's canvas (GR1–GR15) under the shared admin page header (D936). It is
 * the Licences strip's second item, beside the ledger.
 *
 * THE INTEGRATION, NOT THE WHOLE CANVAS (D981 §3). No grant is stored yet, so
 * the grid draws every licensed studio, from the ledger's read, against every
 * program in the canvas's order, and each grantable cell says "Not recorded"
 * with why. Product testing is HQ only and two programs are not ready to
 * grant, as the canvas fixes. Nothing here writes: granting, the requests,
 * default terms and history come with D981's parts.
 */

const BTN = 'inline-flex min-h-[36px] items-center justify-center gap-2 whitespace-nowrap rounded-[9px] px-3.5 text-[12.5px] font-bold';
const DANGER = `${BTN} self-start border border-axal-destructive-edge bg-white text-axal-destructive dark:border-red-900 dark:bg-gray-900 dark:text-red-400`;
const CARD = 'rounded-[12px] border border-axal-hairline bg-white dark:border-gray-700 dark:bg-gray-900';
const EYE = 'text-[10.5px] font-bold uppercase tracking-[.07em] text-axal-muted dark:text-gray-400';
const SUB = 'text-[12px] leading-[1.45] text-axal-muted dark:text-gray-400';
const TAG = 'self-start rounded-full border border-dashed border-axal-muted px-2 py-0.5 text-[11px] font-semibold text-axal-muted dark:text-gray-400';
const H2 = 'm-0 text-[15px] font-extrabold tracking-[-.02em] text-axal-ink dark:text-gray-100';
const MONO = 'font-mono tabular-nums';
const NOT_YET = 'Not read here yet';

const CELL_TONE = {
  unrecorded: 'text-axal-muted dark:text-gray-400',
  hq: 'bg-[repeating-linear-gradient(45deg,transparent,transparent_4px,rgba(107,101,119,.12)_4px,rgba(107,101,119,.12)_8px)] text-axal-muted dark:text-gray-400',
  notready: 'text-axal-faint dark:text-gray-500',
};

function Skeleton() {
  return <span className="block h-2.5 w-[70%] rounded-full bg-axal-hairline dark:bg-gray-700" />;
}

function WaitTile({ id, label, reason }) {
  return (
    <div className={`${CARD} flex flex-col gap-1.5 px-4 py-3.5`} data-testid={`grants-tile-${id}`}>
      <span className={EYE}>{label}</span>
      <span className={TAG}>{NOT_YET}</span>
      <span className={SUB}>{reason}</span>
    </div>
  );
}

/** HQ's tabs (GR1). Requests and Default terms join with D981 part 6 (#2778). Shared with the History page. */
export function GrantsTabs() {
  return (
    <>
      <HeaderTab to="/admin/licences/programs" data-testid="grants-tab-grid">Grid</HeaderTab>
      <HeaderTab to="/admin/licences/programs/history" data-testid="grants-tab-history">History</HeaderTab>
    </>
  );
}

/**
 * D1126: Download CSV, the grid's rows from the grant store (one per studio
 * and program). A failed download says so on the page, with the Worker's
 * sentence; it is never silent.
 */
export function useCsvDownload(run) {
  const [state, setState] = useState({ busy: false, error: null });
  const start = useCallback(() => {
    setState({ busy: true, error: null });
    run().then(
      () => setState({ busy: false, error: null }),
      (e) => { reportError('program-grants:csv', e); setState({ busy: false, error: e?.message || 'The CSV could not be downloaded. Try again.' }); },
    );
  }, [run]);
  return [start, state];
}

export function CsvError({ error }) {
  if (!error) return null;
  return <p role="alert" className="m-0 text-[13px] text-axal-destructive dark:text-red-300" data-testid="grants-csv-error">The CSV could not be downloaded: {error}</p>;
}

function ProgramGrantsPage() {
  const [read, setRead] = useState({ status: 'loading', data: null });
  const [asOf, setAsOf] = useState(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    setRead({ status: 'loading', data: null });
    api.licences().then(
      (data) => { if (live) { setRead({ status: 'ready', data }); setAsOf(Date.now()); } },
      (e) => { reportError('program-grants:licences', e); if (live) setRead({ status: 'error', data: null }); },
    );
    return () => { live = false; };
  }, [tick]);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  const [downloadCsv, csv] = useCsvDownload(programGrantsApi.exportCsv);

  const items = read.data?.items;
  const rows = useMemo(() => studioRows(items), [items]);
  const tile = useMemo(() => studiosTile(items), [items]);
  const groups = programGroups();

  const actions = (
    <>
      <span className="font-mono text-[11.5px] text-axal-muted dark:text-gray-400" data-testid="grants-asof">
        {asOf ? `Updated ${new Date(asOf).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })}` : 'Reading…'}
      </span>
      <button type="button" aria-label="Refresh" onClick={reload} className="grid h-9 w-9 place-items-center rounded-[9px] border border-axal-hairline text-axal-muted dark:border-gray-700"><RefreshCw size={16} aria-hidden="true" /></button>
    </>
  );

  return (
    <div className="flex flex-col gap-5 pb-24 lg:pb-10" data-testid="program-grants">
      <AdminPageHeader
        crumb={{ label: 'Licences', to: LEDGER_PATH, current: 'Program grants' }}
        title="Program grants"
        pills={[{ label: 'HQ only', tone: 'hq' }]}
        actions={actions}
        line="Which programs each studio may run, and on what terms. Studios ask; HQ decides."
        tabs={<GrantsTabs />}
        more={<HeaderMenuItem onSelect={downloadCsv} data-testid="grants-csv">{csv.busy ? 'Downloading…' : 'Download CSV'}</HeaderMenuItem>}
        data-testid="grants-header"
      />
      <CsvError error={csv.error} />

      <div className="grid grid-cols-2 gap-3.5 lg:grid-cols-4" data-testid="grants-tiles">
        <div className={`${CARD} flex flex-col gap-1.5 px-4 py-3.5`} data-testid="grants-tile-studios">
          <span className={EYE}>Studios with a licence</span>
          {read.status === 'loading' && <><span className="font-mono text-[15px] text-axal-muted">Reading…</span><Skeleton /></>}
          {read.status === 'ready' && (
            <>
              <span className={`${MONO} text-[26px] font-medium tracking-[-.01em] text-axal-ink dark:text-gray-100`}>{tile.value.toLocaleString('en-US')}</span>
              <span className={`${SUB} ${MONO}`}>{tile.sub}</span>
            </>
          )}
          {read.status === 'error' && (
            <>
              <span className="text-[13px] font-bold text-axal-destructive dark:text-red-400">Unreadable</span>
              <span className={SUB}>The licence ledger could not be read.</span>
              <button type="button" className={DANGER} onClick={reload}>Try again</button>
            </>
          )}
        </div>
        <WaitTile id="in-force" label="Grants in force" reason={NO_STORE} />
        <WaitTile id="requests" label="Requests waiting" reason="Studios cannot ask for a program yet: the request kinds arrive with D981 part 2." />
        <WaitTile id="ending" label="Ending in 90 days" reason={NO_STORE} />
      </div>

      <section className={`${CARD} flex flex-col gap-3 px-[18px] py-4`} aria-labelledby="grants-h-grid" data-testid="grants-grid">
        <h2 id="grants-h-grid" className={H2}>Studios and programs</h2>
        {read.status === 'loading' && <><span className="font-mono text-[13px] text-axal-muted">Reading…</span><Skeleton /></>}
        {read.status === 'error' && (
          <div role="alert" className="flex flex-col gap-2.5 text-[13px] text-axal-destructive dark:text-red-300" data-testid="grants-unreadable">
            <span>Program grants could not be read. That is not the same as none.</span>
            <button type="button" className={DANGER} onClick={reload}>Try again</button>
          </div>
        )}
        {read.status === 'ready' && rows.length === 0 && (
          <p className="m-0 text-[13px] text-axal-ink dark:text-gray-100" data-testid="grants-empty">
            No studio holds a licence yet. Issue one in the <Link to="/admin/licences" className="font-bold text-axal-violet hover:text-axal-violet-deep dark:text-violet-300 dark:hover:text-violet-200">ledger</Link>, then grant programs here.
          </p>
        )}
        {read.status === 'ready' && rows.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1100px] border-collapse text-left text-[12px]">
              <thead>
                <tr className={EYE}>
                  <th scope="col" rowSpan={2} className="sticky left-0 bg-white py-1.5 pr-3 font-bold dark:bg-gray-900">Studio</th>
                  {groups.map((g) => <th key={g.group} scope="colgroup" colSpan={g.span} className="border-l border-axal-hairline px-2 py-1.5 font-bold dark:border-gray-700">{g.group}</th>)}
                </tr>
                <tr className="text-[11.5px] text-axal-ink dark:text-gray-100">
                  {PROGRAMS.map((p) => (
                    <th key={p.key} scope="col" className="border-l border-axal-hairline px-2 py-1.5 font-bold dark:border-gray-700">
                      {p.name}
                      {p.note ? <span className={`block font-normal ${SUB}`}>{p.note}</span> : null}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.uid || r.ref} className="border-t border-axal-hairline align-top dark:border-gray-700" data-testid={`grants-row-${r.ref}`}>
                    <th scope="row" className="sticky left-0 bg-white py-2 pr-3 font-normal dark:bg-gray-900">
                      <span className="block font-bold text-axal-ink dark:text-gray-100">{r.name}</span>
                      <span className={`block ${MONO} ${SUB}`}>{r.ref} · {r.territories}</span>
                      <span className={SUB}>{r.kind} · {r.status}</span>
                      {r.note ? <span className="mt-1 block text-[11.5px] text-axal-destructive dark:text-red-400">{r.note}</span> : null}
                    </th>
                    {PROGRAMS.map((p) => {
                      const c = hqCell(p);
                      return (
                        <td key={p.key} className={`border-l border-axal-hairline px-2 py-2 dark:border-gray-700 ${CELL_TONE[c.kind]}`} title={c.tip} aria-label={`${r.name}, ${p.name}, ${c.text}`}>
                          {c.text}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <span className={SUB}>{NOT_RECORDED_GRANT}: {NO_STORE} Granting, changing, pausing and ending, each with a reason and your authenticator code, come with D981's parts.</span>
      </section>

      <div className="grid grid-cols-12 gap-3.5">
        <section className={`${CARD} col-span-12 flex flex-col gap-2 px-[18px] py-4 lg:col-span-8`} data-testid="grants-wait-holding">
          <h2 className={H2}>Studios holding each program</h2>
          <span className={TAG}>{NOT_YET}</span>
          <span className={SUB}>{NO_STORE}</span>
        </section>
        <section className={`${CARD} col-span-12 flex flex-col gap-2 px-[18px] py-4 lg:col-span-4`} data-testid="grants-wait-requests">
          <h2 className={H2}>Requests by month</h2>
          <span className={TAG}>{NOT_YET}</span>
          <span className={SUB}>Program requests arrive with D981 part 2.</span>
        </section>
      </div>
    </div>
  );
}

/** The page inside its rail frame (D774); the rail is the Licences board's (D981 §1). */
export default function ProgramGrants() {
  return (
    <AdminBoardFrame workspace="Licences" note="Eadwyn reads the grants on this page. It changes nothing." data-testid="admin-board-program-grants">
      <ProgramGrantsPage />
    </AdminBoardFrame>
  );
}
