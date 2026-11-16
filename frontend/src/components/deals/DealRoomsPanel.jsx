import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { CheckCircle2, CircleSlash, Loader2, MoreHorizontal } from 'lucide-react';
import { api } from '../../lib/api';
import { dealFlowApi } from '../../lib/api/dealFlow';
import { Lightbox } from '../../ui';
import { ROOM_FILTERS, ROOM_REQUEST_CONFIRM, ROOM_LEAVE_CONFIRM, roomFilterCounts, roomResult } from './dealRoomCopy';
import { EMPTY_VIEW, NO_LICENCE, actionRefusal, allowanceView, flowIndex, fullRefusal, invitationsIndex, isLive, roomRow, savingLine } from './dealRoomsModel';
import { Unreadable, BTN, INPUT } from './DealRoomKit';
import { useDealroomQuota, JoinNote } from './DealRoomJoin';

/**
 * D630 (#1388), D4815, D6151 (#6151) — `/deals/rooms`, built to the Deals v2 addendum boards DE19
 * to DE24 (canvas D6141): every live deal, the rooms this investor can open, the ones they asked
 * into, and how much of their room allowance is used.
 *
 * WHERE IT LIVES. Its own route (D4815, the owner's pick B), linked from Deal flow's "Other deal
 * activity" line, with no pill lit. The shell draws the page heading.
 *
 * WHAT IT READS, each on its own (`dealRoomsModel.js`): the live list, the allowance, this firm's
 * invitations and my deal flow. A side read that fails turns its column Unreadable; it never reads
 * as "Not invited" or "Not in my deal flow".
 *
 * ACCESS keeps its three states apart (D4815): open (Open deal), refused (Request an invitation),
 * unreadable (Try again, never a request). Request and Leave are Review → Result: the dialog says
 * what the action records and what it does not, nothing is written before it is confirmed, and the
 * result names the room (the owner folded the Scope step into Review, 2026-11-16, D6141-p2).
 *
 * The three ◇ columns of DE19 (NDA, my commitment, changed since opened) are not drawn: no list read
 * serves them (D6141, owner answer A).
 */
export default function DealRoomsPanel() {
  const [dealsState, setDealsState] = useState({ loading: true, error: false, deals: null });
  const [quotaState, reloadQuota] = useDealroomQuota();
  const [invitesState, setInvites] = useState({ loading: true, error: false, data: null });
  const [flowState, setFlow] = useState({ loading: true, error: false, data: null });

  const loadDeals = useCallback(async () => {
    setDealsState((s) => ({ ...s, loading: true, error: false }));
    try {
      const rows = await api.listDeals();
      setDealsState({ loading: false, error: false, deals: Array.isArray(rows) ? rows : [] });
    } catch (e) {
      setDealsState({ loading: false, error: true, deals: null, status: e?.status ?? null });
    }
  }, []);
  const loadSide = useCallback(async (read, set) => {
    set((s) => ({ ...s, loading: true, error: false }));
    try { set({ loading: false, error: false, data: await read() }); } catch { set({ loading: false, error: true, data: null }); }
  }, []);
  const loadInvites = useCallback(() => loadSide(() => api.myDealInvitations(), setInvites), [loadSide]);
  const loadFlow = useCallback(() => loadSide(() => dealFlowApi.flow(), setFlow), [loadSide]);
  useEffect(() => { loadDeals(); loadInvites(); loadFlow(); }, [loadDeals, loadInvites, loadFlow]);

  const onChanged = useCallback(async () => { await Promise.all([loadDeals(), reloadQuota(), loadFlow()]); }, [loadDeals, reloadQuota, loadFlow]);

  return (
    <DealRoomsList
      dealsState={dealsState} quotaState={quotaState} invitesState={invitesState} flowState={flowState}
      onRetryDeals={loadDeals} onRetryQuota={reloadQuota} onRetryInvites={loadInvites} onRetryFlow={loadFlow}
      onChanged={onChanged}
    />
  );
}

const SEEN = { loading: false, error: false, data: [] };
const FLOW_SEEN = { loading: false, error: false, data: { items: [] } };

/** The page's body, from its reads. Rendered directly by the tests. */
export function DealRoomsList({
  dealsState, quotaState, invitesState = SEEN, flowState = FLOW_SEEN,
  onRetryDeals, onRetryQuota, onRetryInvites, onRetryFlow, onChanged, initialFilter = 'all',
}) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState(initialFilter);
  const [result, setResult] = useState(null);
  const live = useMemo(() => (dealsState.deals || []).filter(isLive), [dealsState.deals]);
  // Counts only from a list that was read; an unread list has no count, never 0.
  const counts = useMemo(() => (dealsState.error || !dealsState.deals ? null : roomFilterCounts(live)), [dealsState.error, dealsState.deals, live]);
  const side = useMemo(() => ({ invitations: invitationsIndex(invitesState), flow: flowIndex(flowState) }), [invitesState, flowState]);
  const view = ROOM_FILTERS.find((f) => f.key === filter) || ROOM_FILTERS[0];
  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return live.filter(view.test)
      .filter((d) => !q || `${d.project_name || ''} ${d.project_sector || ''}`.toLowerCase().includes(q))
      .map((d) => roomRow(d, side));
  }, [live, query, view, side]);
  const noLicence = dealsState.error && dealsState.status === 403;
  const allowance = allowanceView(quotaState);

  return (
    <section className="flex flex-col gap-3" aria-label="Deal rooms" data-testid="dr-pipeline">
      {!noLicence && <Allowance view={allowance} onRetry={onRetryQuota} />}
      {!noLicence && <JoinNote />}

      {result && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg bg-gray-900 px-3 py-2 text-[13px] text-white dark:bg-gray-100 dark:text-gray-900" role="status" data-testid="dr-result">
          <span>{result}</span>
          <button type="button" className="ml-auto min-h-[44px] underline md:min-h-0" onClick={() => setResult(null)}>Dismiss</button>
        </div>
      )}

      {noLicence ? (
        <div className="flex items-start gap-3 rounded-xl border border-axal-hairline bg-gray-50 p-4 text-sm dark:border-gray-800 dark:bg-gray-900" data-testid="dr-no-licence">
          <CircleSlash size={18} className="mt-0.5 shrink-0 text-gray-500" aria-hidden="true" />
          <div><p className="font-semibold text-gray-900 dark:text-gray-100">{NO_LICENCE.title}</p><p className="text-gray-600 dark:text-gray-400">{NO_LICENCE.body}</p></div>
        </div>
      ) : (
        <>
          <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
            <nav className="-mx-1 grid grid-cols-3 gap-1 overflow-x-auto rounded-xl border border-axal-hairline bg-gray-50 p-1 md:flex md:w-fit dark:border-gray-800 dark:bg-gray-900" aria-label="Show" data-testid="dr-filters">
              {ROOM_FILTERS.map((f) => (
                <button key={f.key} type="button" onClick={() => setFilter(f.key)} aria-pressed={filter === f.key}
                  className={`inline-flex min-h-[44px] shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg px-3 text-[13px] font-semibold md:min-h-0 md:py-1.5 ${filter === f.key
                    ? 'bg-white text-gray-900 shadow-sm dark:bg-gray-800 dark:text-gray-100'
                    : 'text-gray-600 dark:text-gray-400'}`}
                  data-testid={`dr-filter-${f.key}`}>
                  <span className="md:hidden">{f.short}</span><span className="hidden md:inline">{f.label}</span>
                  {counts && <span className="font-mono text-[11px] tabular-nums" data-testid={`dr-filter-${f.key}-count`}>{counts[f.key]}</span>}
                </button>
              ))}
            </nav>
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search ventures or sectors"
              className={`${INPUT} min-h-[44px] md:min-h-0 md:max-w-xs`} aria-label="Search ventures or sectors" />
          </div>

          {(invitesState.error || flowState.error) && dealsState.deals && (
            <div className="flex flex-wrap items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[13px] text-red-800 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300" role="status" data-testid="dr-side-unreadable">
              <span><b>{[invitesState.error && 'Invitations', flowState.error && 'Your deal flow'].filter(Boolean).join(' and ')} could not be read.</b> Those columns say Unreadable, not empty.</span>
              <button type="button" className="ml-auto min-h-[44px] font-semibold underline md:min-h-0" onClick={() => { if (invitesState.error) onRetryInvites?.(); if (flowState.error) onRetryFlow?.(); }}>Try again</button>
            </div>
          )}

          {dealsState.loading && !dealsState.deals ? (
            <Skeleton />
          ) : dealsState.error ? (
            <Unreadable onRetry={onRetryDeals}>Live deals could not be read. That is not the same as having none.</Unreadable>
          ) : rows.length === 0 ? (
            <EmptyView filter={query.trim() ? null : filter} onShowAll={() => { setFilter('all'); setQuery(''); }} />
          ) : (
            <>
              <RoomTable rows={rows} quota={quotaState?.quota} onRetryDeals={onRetryDeals} onChanged={onChanged} onResult={setResult} />
              <ul className="flex flex-col gap-3 md:hidden" data-testid="dr-cards">
                {rows.map((r) => <RoomCard key={r.id} row={r} quota={quotaState?.quota} onRetryDeals={onRetryDeals} onChanged={onChanged} onResult={setResult} />)}
              </ul>
              <p className="font-mono text-[11px] text-gray-500 dark:text-gray-400">{live.length} live deal{live.length === 1 ? '' : 's'} · Rejected deals are not listed</p>
            </>
          )}
        </>
      )}
    </section>
  );
}

/** DE20's allowance line: within the cap, Unlimited, full (names the next plan), or unreadable. */
function Allowance({ view, onRetry }) {
  if (view.kind === 'loading') return <p className="text-sm text-gray-500" data-testid="dr-quota">{view.text}</p>;
  if (view.kind === 'unreadable') {
    return (
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-red-200 bg-white px-4 py-3 text-sm dark:border-red-900 dark:bg-gray-900" role="alert" data-testid="dr-quota">
        <b className="text-red-700 dark:text-red-300">! {view.lead}</b><span className="text-gray-800 dark:text-gray-200">{view.text}</span>
        {onRetry && <button type="button" onClick={onRetry} className={`${BTN.ghost} ml-auto min-h-[44px] md:min-h-0`}>Try again</button>}
      </div>
    );
  }
  const full = view.kind === 'full';
  return (
    <div className={`flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border px-4 py-3 text-sm ${full
      ? 'border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/30' : 'border-axal-hairline bg-white dark:border-gray-800 dark:bg-gray-900'}`} data-testid="dr-quota">
      {view.pct != null && (
        <span className="inline-block h-1.5 w-16 rounded-full bg-gray-100 dark:bg-gray-800" aria-hidden="true">
          <span className={`block h-1.5 rounded-full ${full ? 'bg-amber-600' : 'bg-violet-600'}`} style={{ width: `${view.pct}%` }} />
        </span>
      )}
      <b className={full ? 'text-amber-900 dark:text-amber-200' : 'text-gray-900 dark:text-gray-100'}>{view.lead}</b>
      {view.plan && <span className="text-gray-700 dark:text-gray-300">· {view.plan}</span>}
      <span className={full ? 'text-amber-900 dark:text-amber-200' : 'font-mono text-[11px] text-gray-500 dark:text-gray-400'} data-testid="dr-quota-detail">{view.text}</span>
      {view.kind !== 'unlimited' && <Link to="/pricing?for=investor" className={`${BTN.link} ml-auto`}>See plans</Link>}
    </div>
  );
}

function Skeleton() {
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-axal-hairline bg-white p-4 dark:border-gray-800 dark:bg-gray-900" data-testid="dr-loading" aria-busy="true">
      {[0, 1, 2].map((i) => <div key={i} className="h-8 animate-pulse rounded-md bg-gray-100 dark:bg-gray-800" />)}
      <p className="font-mono text-[11px] text-gray-500">Loading live deals… the views carry no counts until the list is read.</p>
    </div>
  );
}

/** DE21: each view's empty board, with its one action. A search that finds nothing says so. */
function EmptyView({ filter, onShowAll }) {
  const e = filter ? EMPTY_VIEW[filter] : { text: 'No live deal matches your search.', action: 'Show all live deals', view: 'all' };
  return (
    <div className="rounded-xl border border-dashed border-gray-200 py-8 text-center text-sm text-gray-600 dark:border-gray-800 dark:text-gray-400" data-testid="dr-empty">
      <p>{e.text}</p>
      <div className="mt-3">
        {e.to ? <Link to={e.to} className={`${BTN.ghost} min-h-[44px] justify-center`}>{e.action}</Link>
          : <button type="button" onClick={onShowAll} className={`${BTN.ghost} min-h-[44px] justify-center`} data-testid="dr-empty-all">{e.action}</button>}
      </div>
    </div>
  );
}

const CHIP = 'inline-flex items-center gap-1 whitespace-nowrap rounded-md border px-1.5 py-0.5 text-[11px] font-semibold';
function Company({ text }) {
  return <span className={`${CHIP} border-gray-300 font-mono uppercase text-gray-700 dark:border-gray-600 dark:text-gray-300`} title="Company stage"><span className="text-gray-400">co</span>{text}</span>;
}
function Process({ p }) {
  if (p.kind === 'stage') return <span className={`${CHIP} rounded-full border-violet-200 bg-violet-50 text-violet-700 dark:border-violet-800 dark:bg-violet-950/40 dark:text-violet-300`} title="My investment process">● {p.text}</span>;
  if (p.kind === 'unreadable') return <span className="text-[12px] font-semibold text-red-700 dark:text-red-300">! Unreadable</span>;
  if (p.kind === 'loading') return <span className="text-[12px] text-gray-500">Reading…</span>;
  return <span className="whitespace-nowrap text-[12px] text-gray-600 dark:text-gray-400">○ {p.text}</span>;
}
/** DE19 and DE22: the ask and the instrument each say Not recorded in words, never a blank or 0. */
function Round({ r, inline = false }) {
  const NR = (what) => <span className="block italic text-gray-500 dark:text-gray-400" data-testid="dr-round-nr">— {what} not recorded</span>;
  const ask = r.ask ? <b className="font-mono text-gray-900 dark:text-gray-100">{r.ask}</b> : NR('Ask');
  const instrument = r.instrument ? <span className="text-gray-900 dark:text-gray-100">{r.instrument}</span> : NR('Instrument');
  const conf = r.confirmed != null ? <span className="font-mono text-[11px] text-gray-500 dark:text-gray-400">{r.confirmed} confirmed</span> : null;
  if (inline) return <span className="flex flex-col items-end text-right text-[13px]"><span className="flex flex-wrap justify-end gap-x-1">{ask} {instrument}</span>{conf}</span>;
  return <div className="flex flex-col text-[13px]"><span className="flex flex-wrap gap-x-1">{ask} {instrument}</span>{conf}</div>;
}
function Invitation({ inv, align = 'left' }) {
  if (inv.kind === 'unreadable') return <span className="text-[12px] font-semibold text-red-700 dark:text-red-300">! Unreadable</span>;
  if (inv.kind === 'loading') return <span className="text-[12px] text-gray-500">Reading…</span>;
  if (inv.kind === 'none') return <span className="text-[13px] text-gray-600 dark:text-gray-400">{inv.text}</span>;
  return (
    <div className={`flex flex-col text-[13px] ${align === 'right' ? 'items-end text-right' : ''}`}>
      <b className="text-gray-900 dark:text-gray-100">{inv.text}</b>
      {(inv.day || inv.note) && <span className="font-mono text-[11px] text-gray-500 dark:text-gray-400">{inv.day || inv.note}</span>}
    </div>
  );
}
function AccessWord({ access }) {
  if (access === 'open') return <span className="inline-flex items-center gap-1 text-[12px] font-semibold text-emerald-700 dark:text-emerald-300"><CheckCircle2 size={13} aria-hidden="true" /> Open</span>;
  if (access === 'refused') return <span className="inline-flex items-center gap-1 text-[12px] font-semibold text-gray-800 dark:text-gray-200" data-testid="dr-access-required"><CircleSlash size={13} aria-hidden="true" /> Invitation needed</span>;
  return <span className="text-[12px] font-semibold text-red-700 dark:text-red-300" data-testid="dr-access-required">! Access unreadable</span>;
}

/** DE19: the table, from 768px up. */
function RoomTable({ rows, ...rest }) {
  return (
    <div className="hidden overflow-hidden rounded-xl border border-axal-hairline bg-white md:block dark:border-gray-800 dark:bg-gray-900">
      <table className="w-full text-left" data-testid="dr-pipeline-rows">
        <thead className="border-b border-axal-hairline font-mono text-[10px] uppercase tracking-wider text-gray-500 dark:border-gray-800 dark:text-gray-400">
          <tr>
            <th scope="col" className="px-3 py-2 font-semibold">Venture</th>
            <th scope="col" className="px-3 py-2 font-semibold">Company</th>
            <th scope="col" className="px-3 py-2 font-semibold">My process</th>
            <th scope="col" className="px-3 py-2 font-semibold">Round · confirmed in this round, all investors</th>
            <th scope="col" className="px-3 py-2 font-semibold">Invitation</th>
            <th scope="col" className="px-3 py-2 font-semibold">Access</th>
            <th scope="col" className="w-10 px-2 py-2"><span className="sr-only">More</span></th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
          {rows.map((r) => <RoomTableRow key={r.id} row={r} {...rest} />)}
        </tbody>
      </table>
    </div>
  );
}

function RoomTableRow({ row: r, ...rest }) {
  const actions = useRoomActions(r, rest);
  return (
    <tr className="align-top" data-testid="dr-pipeline-row">
      <td className="px-3 py-3">
        {r.access === 'open'
          ? <Link to={`/deals/${r.id}`} className="font-semibold text-gray-900 hover:underline dark:text-gray-100">{r.name}</Link>
          : <span className="font-semibold text-gray-900 dark:text-gray-100">{r.name}</span>}
        <div className="text-xs text-gray-500 dark:text-gray-400">{r.sector || <span className="italic">— Sector not recorded</span>}</div>
      </td>
      <td className="px-3 py-3"><Company text={r.company} /></td>
      <td className="px-3 py-3"><Process p={r.process} /></td>
      <td className="px-3 py-3"><Round r={r.round} /></td>
      <td className="px-3 py-3"><Invitation inv={r.invitation} /></td>
      <td className="px-3 py-3">
        <div className="flex flex-col items-start gap-1.5"><AccessWord access={r.access} />{actions.primary}</div>
        {actions.notice}
      </td>
      <td className="px-2 py-3">{actions.more}</td>
    </tr>
  );
}

/** DE23 A: on a phone each row is a card, with its one action at full width and More as a menu. */
function RoomCard({ row: r, ...rest }) {
  const actions = useRoomActions(r, rest, true);
  const line = (label, value) => <div className="flex items-start justify-between gap-3 text-[13px]"><span className="text-gray-600 dark:text-gray-400">{label}</span><div className="min-w-0 text-right">{value}</div></div>;
  return (
    <li className="flex flex-col gap-2 rounded-xl border border-axal-hairline bg-white p-4 dark:border-gray-800 dark:bg-gray-900" data-testid="dr-card">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          {r.access === 'open'
            ? <Link to={`/deals/${r.id}`} className="font-semibold text-gray-900 underline-offset-2 hover:underline dark:text-gray-100">{r.name}</Link>
            : <span className="font-semibold text-gray-900 dark:text-gray-100">{r.name}</span>}
          <div className="text-xs text-gray-500 dark:text-gray-400">{r.sector || <span className="italic">— Sector not recorded</span>}</div>
        </div>
        {actions.more}
      </div>
      <div className="flex flex-wrap items-center gap-1.5"><Company text={r.company} /><Process p={r.process} /></div>
      {line('Round', <Round r={r.round} inline />)}
      {line('Invitation', <Invitation inv={r.invitation} align="right" />)}
      {line('Access', <AccessWord access={r.access} />)}
      {actions.primary}
      {actions.notice}
    </li>
  );
}

/**
 * One row's actions and their states (DE20, DE22): Open deal, Request an invitation, Leave and
 * Try again, plus Add to my deal flow in More. Request and Leave open their review first; a
 * refusal or failure stays on the row, which keeps its state, and names the room.
 */
function useRoomActions(r, { quota, onRetryDeals, onChanged, onResult }, phone = false) {
  const [busy, setBusy] = useState(null);
  const [review, setReview] = useState(null);
  const [refusal, setRefusal] = useState(null);
  const [added, setAdded] = useState(false);
  const [menu, setMenu] = useState(false);
  const wide = phone ? 'w-full justify-center' : '';

  const run = async (kind) => {
    setBusy(kind); setRefusal(null); setMenu(false);
    try {
      if (kind === 'request') await api.dealroomJoin(r.id);
      else if (kind === 'leave') await api.dealroomLeave(r.id);
      else await dealFlowApi.add({ deal_id: r.id });
      setReview(null);
      if (kind === 'add') setAdded(true);
      else onResult?.(roomResult(kind === 'leave' ? 'left' : 'requested', r.name));
      await onChanged?.();
    } catch (e) {
      if (kind === 'request' && (e?.status === 402 || e?.code === 'quota_dealrooms_exhausted')) await onChanged?.();
      setReview(null);
      setRefusal({ kind, ...actionRefusal(kind, r.name, e, quota) });
    } finally {
      setBusy(null);
    }
  };

  let primary = null;
  if (busy && busy !== 'add') primary = <span className="inline-flex min-h-[44px] items-center gap-1.5 text-[12px] text-gray-600 md:min-h-0 dark:text-gray-400" role="status"><Loader2 size={13} className="animate-spin" />{savingLine(busy, r.name)}</span>;
  else if (r.access === 'open') primary = <Link to={`/deals/${r.id}`} className={`${BTN.primary} ${wide} min-h-[44px] md:min-h-0 md:py-1.5`} data-testid="dr-open">Open deal</Link>;
  else if (r.access === 'unreadable') primary = <button type="button" onClick={onRetryDeals} className={`${BTN.ghost} ${wide} min-h-[44px] md:min-h-0 md:py-1.5`} data-testid="dr-access-retry">Try again</button>;
  else if (r.member) primary = <span className={`flex items-center gap-2 text-[13px] ${phone ? 'justify-between' : ''}`}><b className="text-gray-900 dark:text-gray-100" data-testid="dr-member">Requested</b><button type="button" onClick={() => setReview('leave')} className={`${phone ? BTN.ghost : BTN.link} min-h-[44px] md:min-h-0`} data-testid="dr-leave">Leave</button></span>;
  else primary = <button type="button" onClick={() => { if (quota?.full && !quota?.unlimited) setRefusal({ kind: 'request', ...fullRefusal(quota) }); else { setRefusal(null); setReview('request'); } }} className={`${BTN.ghost} ${wide} min-h-[44px] md:min-h-0 md:py-1.5`} data-testid="dr-join">Request an invitation</button>;
  // An open row may still be one this firm asked into: it can leave that request.
  if (!busy && r.access === 'open' && r.member) {
    primary = <span className={`flex flex-col gap-1.5 ${phone ? 'w-full' : ''}`}>{primary}<button type="button" onClick={() => setReview('leave')} className={`${BTN.link} min-h-[44px] self-start md:min-h-0`} data-testid="dr-leave">Leave the room request</button></span>;
  }

  const inFlow = r.process.kind === 'stage';
  const more = (
    <div className="relative">
      <button type="button" aria-label={`More for ${r.name}`} aria-expanded={menu} onClick={() => setMenu((m) => !m)}
        className="inline-flex h-11 w-11 items-center justify-center rounded-lg border border-axal-hairline text-gray-600 md:h-8 md:w-8 dark:border-gray-700 dark:text-gray-300" data-testid="dr-more">
        <MoreHorizontal size={16} aria-hidden="true" />
      </button>
      {menu && (
        <div className="absolute right-0 z-10 mt-1 w-56 rounded-lg border border-axal-hairline bg-white p-1 shadow-lg dark:border-gray-700 dark:bg-gray-900" role="menu">
          {inFlow || added
            ? <p className="px-3 py-2 text-[13px] text-gray-600 dark:text-gray-400">{added ? 'Added to Sourcing' : `In your deal flow · ${r.process.text}`}</p>
            : r.process.kind === 'none'
              ? <button type="button" role="menuitem" onClick={() => run('add')} disabled={busy === 'add'} className="flex min-h-[44px] w-full items-center rounded-md px-3 text-left text-[13px] font-semibold text-gray-900 hover:bg-gray-50 md:min-h-[36px] dark:text-gray-100 dark:hover:bg-gray-800" data-testid="dr-add-flow">Add to my deal flow</button>
              : <p className="px-3 py-2 text-[13px] text-gray-600 dark:text-gray-400">Your deal flow could not be read, so it cannot be added from here.</p>}
        </div>
      )}
    </div>
  );

  const tone = { warn: 'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200', bad: 'border-red-200 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300', info: 'border-gray-200 bg-gray-50 text-gray-800 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200' };
  const notice = (
    <>
      {busy === 'add' && <p className="mt-1.5 inline-flex items-center gap-1.5 text-[12px] text-gray-600 dark:text-gray-400" role="status"><Loader2 size={13} className="animate-spin" />{savingLine('add', r.name)}</p>}
      {added && <p className="mt-1.5 text-[12px] font-semibold text-emerald-700 dark:text-emerald-300" role="status" data-testid="dr-added">Added to Sourcing</p>}
      {refusal && (
        <div className={`mt-2 rounded-lg border px-3 py-2 text-[13px] ${tone[refusal.tone]}`} role="alert" data-testid="dr-row-refusal">
          <p className="font-semibold">{refusal.title}</p>
          {refusal.body && <p className="mt-0.5">{refusal.body}</p>}
          {refusal.action === 'plans' && <Link to="/pricing?for=investor" className={`${BTN.ghost} mt-2 min-h-[44px] md:min-h-0`}>See plans</Link>}
          {refusal.action === 'switch' && <p className="mt-0.5">Change firm with the company switcher at the top of the page.</p>}
          {refusal.action === 'retry' && <button type="button" onClick={() => run(refusal.kind)} className={`${BTN.link} mt-1 min-h-[44px] md:min-h-0`} data-testid="dr-row-retry">Try again</button>}
        </div>
      )}
      {review && (
        <Lightbox label={review === 'leave' ? `Leave the ${r.name} room?` : `Request an invitation to ${r.name}?`}
          title={review === 'leave' ? `Leave the ${r.name} room?` : `Request an invitation to ${r.name}?`}
          onClose={() => { if (!busy) setReview(null); }} testId="dr-request-dialog"
          footer={<div className="flex justify-end gap-2">
            <button type="button" className={`${BTN.ghost} min-h-[44px] justify-center`} disabled={Boolean(busy)} onClick={() => setReview(null)} data-testid="dr-request-back">Back</button>
            <button type="button" className={`${BTN.primary} min-h-[44px] justify-center`} disabled={Boolean(busy)} onClick={() => run(review)} data-testid="dr-request-confirm">
              {busy ? 'Recording…' : review === 'leave' ? 'Leave' : 'Request an invitation'}
            </button>
          </div>}>
          <div className="flex flex-col gap-2 px-5 py-4 text-left text-sm text-gray-700 dark:text-gray-300">
            {review === 'request' && <p><b className="text-gray-900 dark:text-gray-100">{r.name}</b>{r.sector ? ` · ${r.sector}` : ''}, for the firm you have selected.</p>}
            <p>{review === 'leave' ? ROOM_LEAVE_CONFIRM : ROOM_REQUEST_CONFIRM}</p>
          </div>
        </Lightbox>
      )}
    </>
  );
  return { primary, more, notice };
}
