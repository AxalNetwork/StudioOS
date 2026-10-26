/**
 * Contracts › Closings, the admin's desk (CP13, CP21 in the dark), and one
 * closing (CP14) at its own address.
 *
 * D1213 (#2424) drew the desk from the deals' deadlines until the closings
 * store landed. D1219 (#3216) reads the store (D1215): the desk is
 * `GET /api/admin/closings`, every open closing with its lines waiting, who
 * acts next and its owner; "Closed this quarter" is `GET /api/closings`. One
 * closing keeps its deal-id address (D1215 §5): the page finds the deal's open
 * closing, else its newest, and with none it draws the deal's room as D1213
 * did, with Open a closing.
 */
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { closingsApi } from '../../lib/api/closings';
import { Unreadable, Unrecorded } from '../../ui';
import AdminPageHeader from '../../ui/AdminPageHeader';
import { BTN, INPUT } from '../account/AccountCenter';
import ClosingRoom from './ClosingRoom';
import AdminClosing from './AdminClosing';
import { OpenClosingDialog } from './ClosingDialogs';
import { DESK_PATH } from './closingModel';
import {
  DESK_WAITS, NOT_YET, SOON_DAYS, SORTS, WHO_WORD, closingForDeal, closingHrefFor, deskRows, deskTiles, filterDesk, moneyCents, ownersOf,
} from './deskModel';

const CONTRACTS = { label: 'Contracts', to: '/admin/contracts' };

function useLoad(run, deps) {
  const [state, setState] = useState({ status: 'loading', data: null });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    setState({ status: 'loading', data: null });
    run().then((data) => { if (live) setState({ status: 'ok', data }); }, () => { if (live) setState({ status: 'error', data: null }); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);
  return { ...state, retry: () => setTick((n) => n + 1) };
}

const Money = ({ cents, currency }) => {
  const s = moneyCents(cents, currency);
  return s ? <span className="tabular-nums">{s}</span> : <Unrecorded reason="Not returned for this closing." />;
};

/** A block the canvas draws that no read serves yet. */
export function Gap({ id }) {
  return (
    <section className="flex flex-col gap-2 rounded-xl border border-dashed border-gray-300 bg-white p-4 dark:border-gray-700 dark:bg-gray-900" data-testid={`closings-gap-${id}`}>
      <span className="w-fit rounded-full border border-dashed border-gray-300 px-2 py-0.5 text-[11px] font-bold text-gray-500 dark:border-gray-600 dark:text-gray-400">{NOT_YET}</span>
      <p className="m-0 text-sm text-gray-600 dark:text-gray-400">{DESK_WAITS[id]}</p>
    </section>
  );
}

export function ClosingsDeskPage() {
  const navigate = useNavigate();
  const [rev, setRev] = useState(0);
  const desk = useLoad(() => closingsApi.desk(), [rev]);
  const all = useLoad(() => closingsApi.list(), [rev]);
  const [view, setView] = useState({ q: '', who: '', owner: '', sort: 'deadline' });
  const [opening, setOpening] = useState(false);
  const rows = desk.status === 'ok' ? deskRows(desk.data?.closings) : null;
  const tiles = deskTiles(rows, all.status === 'ok' ? all.data?.closings : null);
  const shown = rows ? filterDesk(rows, view) : [];
  const owners = ownersOf(rows);
  const set = (k) => (e) => setView((v) => ({ ...v, [k]: e.target.value }));
  return (
    <div className="flex min-w-0 flex-col gap-4 text-axal-ink dark:text-gray-100" data-testid="closings-desk">
      <AdminPageHeader crumb={{ ...CONTRACTS, current: 'Closings' }} title="Closings"
        line="Every round from signed terms to money received. The platform records and matches; it never moves money."
        actions={<button type="button" className={BTN.primary} onClick={() => setOpening(true)} data-testid="closings-open-btn">Open a closing</button>} />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5" data-testid="closings-tiles">
        {tiles.map((t) => {
          const failed = t.key === 'closed' ? all.status === 'error' : desk.status === 'error';
          return (
            <div key={t.key} className="flex flex-col gap-1 rounded-xl border border-gray-200 bg-white p-3 dark:border-gray-800 dark:bg-gray-900" data-testid={`closings-tile-${t.key}`}>
              <span className="text-[11px] text-gray-500 dark:text-gray-400">{t.label}</span>
              <span className="text-2xl font-bold">{t.value != null ? t.value : failed ? <span className="text-sm font-semibold text-red-700 dark:text-red-300">Unreadable</span> : <span className="inline-block h-6 w-10 animate-pulse rounded bg-gray-100 dark:bg-gray-800" />}</span>
              <span className="text-[11px] text-gray-500 dark:text-gray-400">{t.sub}</span>
            </div>
          );
        })}
      </div>
      {all.status === 'error' && <Unreadable what="Every closing" claim="Closed this quarter is not a claim that none closed." onRetry={all.retry} />}

      <Gap id="chart" />

      <section className="flex flex-col gap-3 rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900" data-testid="closings-desk-list">
        <div className="flex flex-wrap items-center gap-2">
          <input className={`${INPUT} sm:w-64`} placeholder="Search company or round" value={view.q} onChange={set('q')} aria-label="Search company or round" data-testid="closings-search" />
          <select className={`${INPUT} sm:w-48`} value={view.who} onChange={set('who')} aria-label="Waiting on" data-testid="closings-filter-who">
            <option value="">Waiting on: anyone</option>
            {Object.entries(WHO_WORD).map(([k, w]) => <option key={k} value={k}>Waiting on: {w}</option>)}
          </select>
          <select className={`${INPUT} sm:w-44`} value={view.owner} onChange={set('owner')} aria-label="Owner" data-testid="closings-filter-owner">
            <option value="">Owner: anyone</option>
            {owners.map((o) => <option key={o} value={o}>Owner: {o}</option>)}
          </select>
          <select className={`${INPUT} sm:w-44`} value={view.sort} onChange={set('sort')} aria-label="Sort" data-testid="closings-sort">
            {SORTS.map(([k, w]) => <option key={k} value={k}>Sort: {w}</option>)}
          </select>
          {rows && <span className="ml-auto text-[12px] text-gray-500 dark:text-gray-400" data-testid="closings-count">{shown.length} of {rows.length}</span>}
        </div>
        {desk.status === 'loading' && <div className="h-24 animate-pulse rounded-xl bg-gray-100 dark:bg-gray-800" data-testid="closings-desk-loading" />}
        {desk.status === 'error' && <Unreadable what="The closings" claim="This is not a claim that no closing is open." onRetry={desk.retry} />}
        {rows && (rows.length === 0
          ? <p className="m-0 text-sm text-gray-600 dark:text-gray-400" data-testid="closings-desk-empty">No closing is open. Open one for a deal to see it here.</p>
          : shown.length === 0
            ? <p className="m-0 text-sm text-gray-600 dark:text-gray-400" data-testid="closings-desk-filtered">No open closing matches these filters.</p>
            : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[880px] text-left text-[12.5px]" data-testid="closings-desk-table">
                  <thead><tr className="text-[11px] uppercase text-gray-500 dark:text-gray-400"><th className="py-1">Company</th><th>Round</th><th>Lines</th><th>Committed</th><th>Received</th><th>Waiting on</th><th>Deadline</th><th>Owner</th></tr></thead>
                  <tbody>
                    {shown.map((r) => (
                      <tr key={r.uid} className="border-t border-gray-100 align-top dark:border-gray-800" data-testid={`closings-desk-row-${r.dealId}`}>
                        <td className="py-1.5">{r.href === DESK_PATH
                          ? <span className="font-semibold">{r.company || 'Venture not recorded'}</span>
                          : <Link to={`/admin/contracts/closings/${r.dealId}`} className="font-semibold underline">{r.company || 'Venture not recorded'}</Link>}</td>
                        <td>{r.round || <Unrecorded reason="No round label is recorded on this closing." />}</td>
                        <td className="tabular-nums">{r.lines != null ? r.lines : <Unrecorded />}{r.waiting ? <span className="block text-[11px] text-gray-500 dark:text-gray-400">{r.waiting} waiting</span> : null}</td>
                        <td><Money cents={r.committed} currency={r.currency} /></td>
                        <td><Money cents={r.received} currency={r.currency} /></td>
                        <td data-testid={`closings-desk-who-${r.dealId}`}>{r.whoWord ? <><b>{r.whoWord}</b>{r.why && <span className="block text-[11px] text-gray-500 dark:text-gray-400">{r.why}</span>}</> : <Unrecorded />}</td>
                        <td data-testid={`closings-desk-deadline-${r.dealId}`}>{r.deadline ? <><span className={r.soon ? 'font-semibold' : ''}>{r.deadline}</span>{r.left != null && <span className={`block text-[11px] ${r.soon ? 'font-bold text-amber-700 dark:text-amber-300' : r.past ? 'font-bold text-red-700 dark:text-red-300' : 'text-gray-500 dark:text-gray-400'}`}>{r.past ? `${-r.left} days past` : `in ${r.left} days`}</span>}</> : <Unrecorded reason="No deadline is recorded on this closing." />}</td>
                        <td>{r.owner || <Unrecorded reason="No owner is recorded on this closing." />}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
        <p className="m-0 text-[12px] text-gray-500 dark:text-gray-400">Deadlines under {SOON_DAYS} days are marked. {DESK_WAITS.step}</p>
      </section>

      {opening && <OpenClosingDialog onClose={() => setOpening(false)} onOpened={(dealId) => { setOpening(false); setRev((n) => n + 1); navigate(closingHrefFor(dealId)); }} />}
    </div>
  );
}

export function AdminClosingPage() {
  const { dealId } = useParams();
  const ok = /^[1-9]\d*$/.test(String(dealId || ''));
  return (
    <div className="flex min-w-0 flex-col gap-4 text-axal-ink dark:text-gray-100" data-testid="admin-closing">
      {ok ? <OneClosing dealId={Number(dealId)} /> : (
        <>
          <AdminPageHeader crumb={{ label: 'Closings', to: DESK_PATH, current: 'One closing' }} title="Closing" line="One deal round: its lines, paper, routes and money." />
          <p className="m-0 text-sm" data-testid="admin-closing-missing">There is no closing at this address. <Link to={DESK_PATH} className="underline">Open Closings.</Link></p>
        </>
      )}
    </div>
  );
}

function OneClosing({ dealId }) {
  const [rev, setRev] = useState(0);
  const list = useLoad(() => closingsApi.list(), [dealId, rev]);
  const [opening, setOpening] = useState(false);
  const summary = list.status === 'ok' ? closingForDeal(list.data?.closings, dealId) : null;
  const title = summary ? `${summary.project_name || 'Venture not recorded'}${summary.round_label ? ` · ${summary.round_label}` : ''}` : 'Closing';
  return (
    <>
      <AdminPageHeader crumb={{ label: 'Closings', to: DESK_PATH, current: summary?.project_name || 'One closing' }} title={title}
        line="From signed terms to money received, for every line in this round." />
      {list.status === 'loading' && <div className="h-24 animate-pulse rounded-xl bg-gray-100 dark:bg-gray-800" data-testid="admin-closing-loading" />}
      {list.status === 'error' && <Unreadable what="The closings" claim="This is not a claim that this deal has none." onRetry={list.retry} />}
      {list.status === 'ok' && (summary ? <AdminClosing key={summary.uid} summary={summary} onChanged={() => setRev((n) => n + 1)} /> : (
        <>
          <section className="flex flex-wrap items-center gap-3 rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900" data-testid="admin-closing-none">
            <p className="m-0 text-sm text-gray-700 dark:text-gray-300">No closing is open for this deal. Below is the deal’s room as its commitments read today.</p>
            <button type="button" className={`${BTN.primary} ml-auto`} onClick={() => setOpening(true)} data-testid="admin-closing-open">Open a closing</button>
          </section>
          <ClosingRoom dealId={dealId} role="admin" />
        </>
      ))}
      {opening && <OpenClosingDialog dealId={dealId} onClose={() => setOpening(false)} onOpened={() => { setOpening(false); setRev((n) => n + 1); }} />}
    </>
  );
}
