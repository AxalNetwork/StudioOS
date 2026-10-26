/**
 * D1236 (#2423) — Deal flow at /deals for an Investor (DLS1, DLS2, DLS6) and
 * Compare at /deals/compare (DLS8): the canvas's toolbar, the board and table
 * views and the scope switch in the address, today's deal list and
 * invitations, and "Not read here yet" on every block no read carries
 * (`dealFlowModel.WAITS`).
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../../lib/api';
import { reportError } from '../../../lib/log';
import { Unreadable, Unrecorded } from '../../../ui';
import { ScopeStrip } from '../../../components/scoring/scorecard/Scorecard';
import {
  MAX_COMPARE, NOT_YET, SCOPES, SCOPE_SWITCH, WAITS,
  compareHref, dealRow, inviteRow, opensDeal, viewHref,
} from './dealFlowModel';

const box = 'flex flex-col gap-2 rounded-xl border border-axal-hairline bg-white p-4 dark:border-gray-800 dark:bg-gray-900';
const pill = (on) => `rounded-full px-3 py-1 text-[13px] font-semibold ${on ? 'bg-violet-50 text-violet-700 dark:bg-violet-950 dark:text-violet-300' : 'text-axal-muted dark:text-gray-400'}`;

export function DealFlowWait({ id }) {
  return (
    <div className="flex flex-col gap-1" data-testid={`dealflow-wait-${id}`}>
      <span className="w-fit rounded-full border border-dashed border-gray-300 px-2 py-0.5 text-[11px] font-bold text-gray-500 dark:border-gray-600 dark:text-gray-400">{NOT_YET}</span>
      <p className="m-0 text-[12.5px] text-axal-muted dark:text-gray-400">{WAITS[id]}</p>
    </div>
  );
}

const money = (n, currency) => {
  if (n == null) return <Unrecorded reason="No ask is recorded on this round." />;
  try { return new Intl.NumberFormat('en-US', { style: 'currency', currency: currency || 'USD', notation: 'compact', maximumFractionDigits: 1 }).format(n); } catch { return String(n); }
};

/** DLS1's toolbar: the scope switch and the view switch, each an address. */
export function DealFlowToolbar({ view, scope }) {
  return (
    <div className="flex flex-wrap items-center gap-3" data-testid="dealflow-toolbar">
      <nav aria-label="Which deals" className="flex gap-1">
        {SCOPE_SWITCH.map((s) => (
          <Link key={s.key} to={viewHref({ view, scope: s.key })} aria-current={scope === s.key ? 'page' : undefined} className={pill(scope === s.key)} data-testid={`dealflow-scope-${s.key}`}>{s.label}</Link>
        ))}
      </nav>
      {scope !== 'new' && (
        <nav aria-label="View" className="flex gap-1">
          <Link to={viewHref({ view: 'board', scope })} aria-current={view === 'board' ? 'page' : undefined} className={pill(view === 'board')} data-testid="dealflow-view-board">Board</Link>
          <Link to={viewHref({ view: 'table', scope })} aria-current={view === 'table' ? 'page' : undefined} className={pill(view === 'table')} data-testid="dealflow-view-table">Table</Link>
        </nav>
      )}
    </div>
  );
}

/** DLS2 from rows already read. Scope columns wait for SCORING; a row opens its deal only under Mine. */
export function DealsTableView({ rows, scope, picked = [], onPick }) {
  if (!rows.length) {
    return <section className={box} data-testid="dealflow-empty"><p className="m-0 text-sm">{scope === 'mine' ? 'Nothing in your deal flow yet. Deals you are invited to or commit on appear here.' : 'No round is listed.'}</p></section>;
  }
  return (
    <section className={box} data-testid="dealflow-table">
      <div className="overflow-x-auto">
        <table className="w-full text-left text-[13px]">
          <thead>
            <tr className="text-[11px] uppercase text-gray-500">
              <th className="py-1"><span className="sr-only">Compare</span></th>
              <th>Venture</th><th>Round</th><th>Ask</th><th>Scorecard</th><th>Days in stage</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-gray-100 dark:border-gray-800" data-testid={`dealflow-row-${r.id}`}>
                <td className="py-1.5"><input type="checkbox" aria-label={`Compare ${r.name}`} checked={picked.includes(r.id)} disabled={!picked.includes(r.id) && picked.length >= MAX_COMPARE} onChange={() => onPick?.(r.id)} /></td>
                <td>
                  {opensDeal(scope) ? <Link to={`/deals/${r.id}`} className="font-semibold underline">{r.name}</Link> : <span className="font-semibold">{r.name}</span>}
                  {r.sector && <span className="block text-[12px] text-axal-muted">{r.sector}</span>}
                </td>
                <td><span className="rounded-full border border-axal-hairline px-2 py-0.5 text-[12px]">{r.round}</span></td>
                <td>{money(r.ask, r.currency)}</td>
                <td><ScopeStrip /></td>
                <td>{r.daysInStage == null ? <Unrecorded reason="The stage's start is not recorded." /> : r.daysInStage}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="m-0 text-[12px] text-axal-muted">Scopes, in the scoring order: {SCOPES.join(' · ')}.</p>
      <DealFlowWait id="scores" />
      {picked.length > 0 && (
        <div className="flex items-center gap-3" data-testid="dealflow-compare-bar">
          <span className="text-[13px]">{picked.length} selected</span>
          {picked.length >= 2 ? <Link to={compareHref(picked)} className="font-semibold underline" data-testid="dealflow-compare">Compare</Link> : <span className="text-[13px] text-axal-muted">Pick at least two to compare.</span>}
          <button type="button" className="text-[13px] underline" onClick={() => picked.forEach((id) => onPick?.(id))}>Clear</button>
        </div>
      )}
    </section>
  );
}

/** DLS6 from invitations already read; the other ways in wait. */
export function InvitesView({ rows }) {
  return (
    <section className={box} data-testid="dealflow-new">
      <h2 className="m-0 text-[15px] font-bold">Invited by the studio</h2>
      {rows.length === 0
        ? <p className="m-0 text-sm">No invitation is waiting for you.</p>
        : (
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {rows.map((r) => (
              <li key={`${r.id}-${r.at}`} className="flex flex-col" data-testid={`dealflow-invite-${r.id}`}>
                <Link to={`/deals/${r.id}`} className="font-semibold underline">{r.name}</Link>
                {r.message && <span className="text-[12.5px] text-axal-muted">“{r.message}”</span>}
              </li>
            ))}
          </ul>
        )}
      <DealFlowWait id="entered" />
    </section>
  );
}

function useRead(fn, deps) {
  const [state, setState] = useState({ kind: 'loading', data: null });
  const load = useCallback(async () => {
    setState({ kind: 'loading', data: null });
    try { setState({ kind: 'ok', data: await fn() }); } catch (e) { reportError('DealFlow:read', e); setState({ kind: 'unreadable', data: null }); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => { load(); }, [load]);
  return [state, load];
}

/** The /deals root for an Investor: the toolbar, then the view the address names. `board` is today's zone board. */
export default function DealFlow({ view, scope, board }) {
  const [picked, setPicked] = useState([]);
  const pick = (id) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  const wantsDeals = scope !== 'new' && view === 'table';
  const [deals, retryDeals] = useRead(() => (wantsDeals ? api.listDeals(undefined, scope === 'mine' ? 'mine' : undefined) : Promise.resolve([])), [wantsDeals, scope]);
  const [invites, retryInvites] = useRead(() => (scope === 'new' ? api.myDealInvitations() : Promise.resolve([])), [scope]);

  let body;
  if (scope === 'new') {
    body = invites.kind === 'loading' ? null
      : invites.kind === 'unreadable' ? <section className={box}><Unreadable what="Your invitations" claim="That is not the same as having none." onRetry={retryInvites} /></section>
        : <InvitesView rows={(Array.isArray(invites.data) ? invites.data : []).filter((i) => i.status === 'pending').map(inviteRow)} />;
  } else if (view === 'table') {
    body = deals.kind === 'loading' ? null
      : deals.kind === 'unreadable' ? <section className={box}><Unreadable what="Your deal flow" claim="That is not the same as having none." onRetry={retryDeals} /></section>
        : <DealsTableView rows={(Array.isArray(deals.data) ? deals.data : []).map(dealRow)} scope={scope} picked={picked} onPick={pick} />;
  } else {
    body = (
      <>
        <section className={box} data-testid="dealflow-board"><DealFlowWait id="stages" /></section>
        {board}
      </>
    );
  }
  return (
    <div className="flex min-w-0 flex-col gap-4" data-testid="dealflow">
      <DealFlowToolbar view={view} scope={scope} />
      {body}
      <section className={box} data-testid="dealflow-waits"><DealFlowWait id="views" /><DealFlowWait id="fit" /></section>
    </div>
  );
}

/** DLS8 from the picks already read: each venture, then the chart's wait. */
export function CompareView({ picks, missing = 0 }) {
  return (
    <div className="flex min-w-0 flex-col gap-4" data-testid="dealflow-compare-page">
      <Link to="/deals?view=table" className="w-fit text-[13px] font-semibold text-violet-700 underline dark:text-violet-300">‹ Deal flow</Link>
      <h2 className="m-0 text-[20px] font-extrabold">Compare · {picks.length} ventures</h2>
      {picks.length < 2
        ? <section className={box} data-testid="dealflow-compare-few"><p className="m-0 text-sm">Pick at least two ventures to compare, from the table.</p></section>
        : (
          <section className={box}>
            <ul className="m-0 grid list-none grid-cols-1 gap-2 p-0 sm:grid-cols-2 lg:grid-cols-4">
              {picks.map((r) => (
                <li key={r.id} className="rounded-lg border border-axal-hairline p-3" data-testid={`dealflow-compare-${r.id}`}>
                  <span className="font-semibold">{r.name}</span>
                  <span className="block text-[12px] text-axal-muted">{r.round} · {money(r.ask, r.currency)}</span>
                </li>
              ))}
            </ul>
          </section>
        )}
      {missing > 0 && <p className="m-0 text-[13px] text-axal-muted" data-testid="dealflow-compare-missing">{missing} of the picked ventures are not on your list.</p>}
      <section className={box}><DealFlowWait id="compare" /></section>
    </div>
  );
}

/** /deals/compare: reads the list once and keeps the picked ids that are on it. */
export function DealCompare({ ids }) {
  const [deals, retry] = useRead(() => api.listDeals(undefined, 'mine'), []);
  if (deals.kind === 'loading') return null;
  if (deals.kind === 'unreadable') return <section className={box}><Unreadable what="The ventures to compare" claim="That is not the same as having none." onRetry={retry} /></section>;
  const rows = (Array.isArray(deals.data) ? deals.data : []).map(dealRow);
  const picks = ids.map((id) => rows.find((r) => r.id === id)).filter(Boolean);
  return <CompareView picks={picks} missing={ids.length - picks.length} />;
}
