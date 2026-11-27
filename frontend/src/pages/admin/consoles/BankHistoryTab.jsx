/**
 * D1186 (#3115) — Bank accounts › History (BNK5, BNK8b and its states):
 * every reveal and every change, newest first, from part 1's read (D1182),
 * with search, Event, Entity and Dates, and pages that keep the first page's
 * snapshot. A reveal opens to its full reason. The words come from
 * `bankHistoryModel.js`; this file only draws them.
 */
import React, { useEffect, useRef, useState } from 'react';
import { Unreadable } from '../../../ui';
import { BTN, INPUT, LoadingRows } from '../../account/AccountCenter';
import { Note, Panel } from '../fundAdmin/parts';
import { failedClaim } from './bankCashModel';
import {
  ENTITIES, HISTORY_EMPTY, HISTORY_FOOT, HISTORY_NO_MATCH, KINDS, Q_MAX, RANGES, countText, filtered, pagesOf, queryOf, rowOf,
} from './bankHistoryModel';

const MUTED = 'text-axal-muted dark:text-gray-400';
const SELECT = `${INPUT} w-auto min-w-[150px]`;
const GRID = 'sm:grid-cols-[1.15fr_1fr_.8fr_.8fr_1fr_2.4fr]';
const PILL = 'inline-flex w-fit items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-bold';
const PILL_REVEAL = `${PILL} border-axal-lavender-edge bg-axal-lavender text-axal-violet-deep dark:border-violet-800 dark:bg-violet-950/40 dark:text-violet-200`;
const PILL_PLAIN = `${PILL} border-axal-hairline bg-white text-axal-ink dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100`;
const BLANK = { q: '', kind: '', entity: '', range: 'all' };

function Row({ r }) {
  const [open, setOpen] = useState(false);
  return (
    <div role="row" className="border-b border-axal-hairline last:border-b-0 dark:border-gray-800" data-testid="bank-history-row">
      <div className={`grid grid-cols-1 gap-1 px-4 py-2.5 text-[12px] sm:items-baseline sm:gap-2.5 sm:px-5 ${GRID}`}>
        <span role="cell" className="font-mono text-zinc-700 dark:text-gray-200">{r.when}</span>
        <span role="cell"><span className={r.reveal ? PILL_REVEAL : PILL_PLAIN}>{r.reveal ? '◉' : '•'} {r.event}</span></span>
        <span role="cell" className="text-zinc-700 dark:text-gray-200">{r.entity}</span>
        <span role="cell" className="font-mono text-zinc-700 dark:text-gray-200">{r.account}</span>
        <span role="cell" className="text-zinc-700 dark:text-gray-200">{r.by}</span>
        <span role="cell" className="min-w-0 text-[12.5px] leading-snug text-zinc-700 dark:text-gray-200">
          {r.reason
            ? <button type="button" aria-expanded={open} className="text-left font-semibold text-axal-violet-deep hover:underline dark:text-violet-300" onClick={() => setOpen((o) => !o)} data-testid="bank-history-reason-toggle">{open ? '▴ Hide the reason' : '▾ Full reason'}</button>
            : <span className={r.detail.startsWith('The detail') ? MUTED : ''}>{r.detail}</span>}
        </span>
      </div>
      {r.reason && open && (
        <p className="m-0 bg-axal-lavender px-4 pb-3 pt-1 text-[12.5px] leading-relaxed text-axal-ink sm:px-5 dark:bg-violet-950/30 dark:text-gray-100" data-testid="bank-history-reason">
          {r.detail} The number was shown for 30 seconds.
        </p>
      )}
    </div>
  );
}

export default function BankHistoryTab({ api }) {
  const [draft, setDraft] = useState('');
  const [f, setF] = useState(BLANK);
  const [page, setPage] = useState(1);
  const [state, setState] = useState({ status: 'loading', data: null, error: null });
  const snapshot = useRef(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let live = true;
    setState((s) => ({ ...s, status: 'loading' }));
    api.history(queryOf(f, page, snapshot.current))
      .then((data) => { if (!live) return; if (page === 1) snapshot.current = data?.snapshot || null; setState({ status: 'ready', data, error: null }); })
      .catch((error) => { if (live) setState({ status: 'unreadable', data: null, error }); });
    return () => { live = false; };
  }, [api, f, page, tick]);

  // A new search or filter starts again from page 1 with a new snapshot.
  const change = (patch) => { snapshot.current = null; setPage(1); setF((x) => ({ ...x, ...patch })); };
  const rows = Array.isArray(state.data?.rows) ? state.data.rows.map(rowOf) : [];
  const pages = pagesOf(state.data);
  const narrowed = filtered(f);
  const firstEmpty = state.status === 'ready' && rows.length === 0 && !narrowed && Number(state.data?.total) === 0;

  if (firstEmpty) {
    return (
      <section className="mx-auto mt-6 flex w-full max-w-[620px] flex-col items-center gap-2 rounded-axal-lg border border-axal-hairline bg-white px-7 py-9 text-center dark:border-gray-800 dark:bg-gray-900" data-testid="bank-history-empty">
        <span aria-hidden="true" className={`text-[22px] ${MUTED}`}>○</span>
        <h3 className="m-0 text-[16px] font-extrabold text-axal-ink dark:text-gray-100">{HISTORY_EMPTY.title}</h3>
        <p className={`m-0 text-[12.5px] ${MUTED}`}>{HISTORY_EMPTY.line}</p>
      </section>
    );
  }

  return (
    <div className="flex flex-col gap-3" data-testid="bank-history">
      <Panel label="Reveals and changes" testId="bank-history-panel"
        sub={state.status === 'ready' ? <span data-testid="bank-history-count">{countText(state.data)}</span> : null}
        aside={state.status === 'ready' && pages > 1 ? (
          <span className="flex gap-2">
            <button type="button" className={BTN.ghost} disabled={page <= 1} onClick={() => setPage(page - 1)} data-testid="bank-history-prev">Previous</button>
            <button type="button" className={BTN.ghost} disabled={page >= pages} onClick={() => setPage(page + 1)} data-testid="bank-history-next">Next</button>
          </span>
        ) : null}>
        <form className="flex flex-wrap items-end gap-2 border-b border-axal-hairline px-4 py-3 sm:px-5 dark:border-gray-800" role="search"
          onSubmit={(e) => { e.preventDefault(); change({ q: draft }); }} data-testid="bank-history-filters">
          <label className="flex min-w-[220px] flex-1 flex-col gap-1 text-[11.5px] font-semibold text-zinc-700 dark:text-gray-200">
            Search
            <input className={INPUT} type="search" maxLength={Q_MAX} value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Search ending, person, account or reason" data-testid="bank-history-q" />
          </label>
          {[['Event', 'kind', KINDS], ['Entity', 'entity', ENTITIES], ['Dates', 'range', RANGES]].map(([label, key, options]) => (
            <label key={key} className="flex flex-col gap-1 text-[11.5px] font-semibold text-zinc-700 dark:text-gray-200">
              {label}
              <select className={SELECT} value={f[key]} onChange={(e) => change({ [key]: e.target.value })} data-testid={`bank-history-${key}`}>
                {options.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
              </select>
            </label>
          ))}
          <button type="submit" className={BTN.ghost} data-testid="bank-history-search">Search</button>
          {narrowed && <button type="button" className={BTN.link} onClick={() => { setDraft(''); change(BLANK); }} data-testid="bank-history-clear">Clear</button>}
        </form>
        {state.status === 'loading' ? <div className="px-4 py-3 sm:px-5"><LoadingRows lines={5} /></div>
          : state.status === 'unreadable' ? (
            <div className="px-4 py-3 sm:px-5" data-testid="bank-history-unreadable">
              <Unreadable what="The history" claim={state.error?.status === 400 ? 'Those filters were refused. Clear them and try again.' : failedClaim(state.error, 'This is not a claim that nothing happened.')} onRetry={() => setTick((t) => t + 1)} />
            </div>
          )
            : rows.length === 0 ? <Note testId="bank-history-no-match">{HISTORY_NO_MATCH}</Note>
              : (
                <div role="table" aria-label="Reveals and changes" data-testid="bank-history-table">
                  <div role="row" className={`hidden gap-2.5 border-b border-axal-hairline px-5 py-2 text-[10px] font-extrabold uppercase tracking-[.09em] dark:border-gray-800 sm:grid ${GRID} ${MUTED}`}>
                    {['When', 'Event', 'Entity', 'Account', 'By', 'Detail'].map((t) => <span key={t} role="columnheader">{t}</span>)}
                  </div>
                  {rows.map((r) => <Row key={r.id} r={r} />)}
                </div>
              )}
      </Panel>
      <p className={`m-0 text-[11.5px] ${MUTED}`} data-testid="bank-history-foot">{HISTORY_FOOT}</p>
    </div>
  );
}
