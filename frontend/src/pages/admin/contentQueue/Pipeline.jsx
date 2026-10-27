/**
 * D1295 (#3391, ART1, ART2, ART13–ART15) — Pipeline: the board by stage and
 * the list with search, filters, sort, totals and paging, on D1291's queue
 * read. The view and every filter live in the address (`?view=list&q=…`), so
 * a link opens the same list; an article opens at `/admin/articles/<id>`
 * with the list's address kept behind it.
 *
 * Each block fails alone: a failed read says so with Try again, and a failed
 * counts block leaves the rows standing. Nothing here is a zero it did not
 * read.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { actionGhost, actionPrimary } from '../../../ui';
import { adminArticles as api } from '../../../lib/api';
import { reportError } from '../../../lib/log';
import { QUEUE_BASE } from '../contentQueueModel';
import { StagePill } from './ReviewDrawer';
import {
  BOARD_STAGES, LIST_STAGES, PAGE_SIZES, SORTS, STAGES, STAGE_LABEL, STATES, activeFilters, choicesOf, countOf, listStateOf,
  pageCount, queueParams, rangeText, searchOf, stageOf, waitText,
} from './pipelineModel';

const CARD = 'rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900';
const SUB = 'text-[12.5px] text-slate-500 dark:text-slate-400';
const INPUT = 'min-h-[36px] rounded-lg border border-slate-300 bg-white px-2 text-[13px] text-slate-900 dark:border-slate-600 dark:bg-slate-950 dark:text-slate-100';
const BOARD_LIMIT = 100;
const CARDS_SHOWN = 6;

/** The queue read for a state, with its own status. */
function useQueue(state) {
  const [read, setRead] = useState({ status: 'loading' });
  const params = state.view === 'list' ? queueParams(state) : { stage: 'open', sort: 'waiting', limit: BOARD_LIMIT, offset: 0 };
  const key = JSON.stringify(params);
  const load = useCallback(async () => {
    setRead((r) => (r.status === 'ready' ? { ...r, refreshing: true } : { status: 'loading' }));
    try { setRead({ status: 'ready', data: await api.queue(params) }); } catch (e) { reportError('ContentQueue:queue', e); setRead({ status: 'failed' }); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  useEffect(() => { load(); }, [load]);
  return [read, load];
}

/** The count strip above the board and list: each stage's count and oldest wait, or that the counts could not be read. */
function StageStrip({ counts, onStage }) {
  return (
    <ul className="m-0 flex list-none flex-wrap gap-2 p-0" data-testid="cq-stage-strip">
      {STAGES.map((s) => {
        const c = countOf(counts, s.key);
        return (
          <li key={s.key}>
            <button type="button" onClick={() => onStage(s.key)} className="flex min-h-[44px] flex-col items-start rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-left hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:hover:bg-slate-800" data-testid={`cq-count-${s.key}`}>
              <span className="flex items-center gap-1.5 text-[12px] text-slate-600 dark:text-slate-300"><span aria-hidden="true" className={`h-2 w-2 rounded-full ${s.dot}`} />{s.label}</span>
              {c.readable
                ? <span className="text-[13px] text-slate-900 dark:text-slate-100"><b className="font-mono">{c.count}</b>{c.oldest ? <span className="text-slate-500 dark:text-slate-400"> · {c.oldest}</span> : null}</span>
                : <span className="text-[12px] text-red-700 dark:text-red-300">{c.text}</span>}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function ArticleCard({ a, onOpen }) {
  return (
    <button type="button" onClick={() => onOpen(a.id)} className="flex min-h-[44px] w-full flex-col gap-1 rounded-lg border border-slate-200 bg-white p-2.5 text-left hover:border-violet-300 dark:border-slate-700 dark:bg-slate-900 dark:hover:border-violet-700" data-testid={`cq-card-${a.id}`}>
      <span className="text-[13px] font-semibold leading-snug text-slate-900 dark:text-slate-100">{a.title || 'Untitled'}</span>
      <span className={SUB}>{a.author_name || 'Name not recorded'}{a.sector ? ` · ${a.sector}` : ''}{a.word_count != null ? ` · ${a.word_count} words` : ''}</span>
      <span className="text-[12px] text-slate-700 dark:text-slate-300">{waitText(a)}</span>
      {(Number(a.open_comments) > 0 || Number(a.rounds) > 1) && (
        <span className="flex gap-2 text-[11.5px] text-slate-600 dark:text-slate-400">
          {Number(a.open_comments) > 0 && <span>{a.open_comments} open comments</span>}
          {Number(a.rounds) > 1 && <span>{a.rounds} rounds</span>}
        </span>
      )}
    </button>
  );
}

/** ART1: the open stages as columns. A column's count is the whole stage's, from the counts block. */
function Board({ data, onOpen, onStage }) {
  const [more, setMore] = useState({});
  const by = Object.fromEntries(BOARD_STAGES.map((k) => [k, []]));
  for (const a of data.items || []) { const s = stageOf(a); if (by[s]) by[s].push(a); }
  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-5" data-testid="cq-board">
      {BOARD_STAGES.map((k) => {
        const c = countOf(data.counts, k);
        const rows = by[k];
        const shown = more[k] ? rows : rows.slice(0, CARDS_SHOWN);
        return (
          <section key={k} className="flex min-w-0 flex-col gap-2 rounded-xl bg-slate-50 p-2 dark:bg-slate-950" data-testid={`cq-col-${k}`}>
            <header className="flex items-baseline justify-between gap-2 px-1">
              <h3 className="m-0 text-[13px] font-bold text-slate-900 dark:text-slate-100">{STAGE_LABEL[k]}</h3>
              <span className="text-[12px] text-slate-500 dark:text-slate-400">{c.readable ? <b className="font-mono text-slate-800 dark:text-slate-200">{c.count}</b> : c.text}{c.readable && c.oldest ? ` · ${c.oldest}` : ''}</span>
            </header>
            {rows.length === 0
              ? <p className={`m-0 px-1 ${SUB}`}>{c.readable && c.count > 0 ? 'Not on this page: open the list for this stage.' : 'Nothing in this stage'}</p>
              : shown.map((a) => <ArticleCard key={a.id} a={a} onOpen={onOpen} />)}
            {rows.length > CARDS_SHOWN && !more[k] && <button type="button" onClick={() => setMore({ ...more, [k]: true })} className="px-1 text-left text-[12.5px] font-semibold text-violet-700 underline dark:text-violet-300" data-testid={`cq-more-${k}`}>Show {rows.length - CARDS_SHOWN} more</button>}
            {c.readable && c.count > rows.length && rows.length > 0 && <button type="button" onClick={() => onStage(k)} className="px-1 text-left text-[12px] text-slate-600 underline dark:text-slate-400">All {c.count} in the list</button>}
          </section>
        );
      })}
    </div>
  );
}

/** ART2's toolbar: search, stage, filters, sort. Each change is a new address. */
function Toolbar({ state, choices, set, viewer }) {
  const [q, setQ] = useState(state.q);
  useEffect(() => { setQ(state.q); }, [state.q]);
  const n = activeFilters(state);
  return (
    <div className="flex flex-wrap items-end gap-2" data-testid="cq-toolbar">
      <form role="search" onSubmit={(e) => { e.preventDefault(); set({ q: q.trim() }); }} className="flex gap-1">
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search title or author" aria-label="Search title or author" className={`${INPUT} w-56`} data-testid="cq-search" />
        <button type="submit" className={actionGhost} data-testid="cq-search-go">Search</button>
      </form>
      <select value={state.stage} onChange={(e) => set({ stage: e.target.value })} aria-label="Stage" className={INPUT} data-testid="cq-filter-stage">
        {LIST_STAGES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
      </select>
      <select value={state.author} onChange={(e) => set({ author: e.target.value })} aria-label="Author" className={INPUT} data-testid="cq-filter-author">
        <option value="">Author: any</option>
        {choices.authors.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
      </select>
      <select value={state.sector} onChange={(e) => set({ sector: e.target.value })} aria-label="Sector" className={INPUT} data-testid="cq-filter-sector">
        <option value="">Sector: any</option>
        {choices.sectors.map((s) => <option key={s} value={s}>{s}</option>)}
      </select>
      {viewer?.userId && (
        <label className="flex min-h-[36px] items-center gap-1.5 text-[13px] text-slate-700 dark:text-slate-300">
          <input type="checkbox" checked={state.reviewer === String(viewer.userId)} onChange={(e) => set({ reviewer: e.target.checked ? String(viewer.userId) : '' })} data-testid="cq-filter-mine" /> Reviewer: Mine
        </label>
      )}
      <label className="flex flex-col text-[11.5px] text-slate-500 dark:text-slate-400">Submitted from
        <input type="date" value={state.submitted_from} onChange={(e) => set({ submitted_from: e.target.value })} className={INPUT} data-testid="cq-filter-from" />
      </label>
      <label className="flex flex-col text-[11.5px] text-slate-500 dark:text-slate-400">to
        <input type="date" value={state.submitted_to} onChange={(e) => set({ submitted_to: e.target.value })} className={INPUT} data-testid="cq-filter-to" />
      </label>
      <label className="flex min-h-[36px] items-center gap-1.5 text-[13px] text-slate-700 dark:text-slate-300">
        <input type="checkbox" checked={state.open_comments === '1'} onChange={(e) => set({ open_comments: e.target.checked ? '1' : '' })} data-testid="cq-filter-open-comments" /> Has open comments
      </label>
      {n > 0 && <button type="button" onClick={() => set({ author: '', sector: '', reviewer: '', submitted_from: '', submitted_to: '', open_comments: '' })} className="min-h-[36px] text-[12.5px] font-semibold text-violet-700 underline dark:text-violet-300" data-testid="cq-clear">Clear all ({n})</button>}
      <select value={state.sort} onChange={(e) => set({ sort: e.target.value })} aria-label="Sort" className={`${INPUT} ml-auto`} data-testid="cq-sort">
        {SORTS.map((s) => <option key={s.key} value={s.key}>Sort: {s.label}</option>)}
      </select>
    </div>
  );
}

/** ART2's table, totals and paging. */
function List({ data, state, set, onOpen }) {
  const pages = pageCount(data.total, state.size);
  return (
    <section className={`${CARD} flex flex-col gap-2 p-3`} data-testid="cq-list">
      <div className="overflow-x-auto">
        <table className="w-full text-left text-[13px]">
          <thead>
            <tr className="text-[11px] uppercase tracking-[0.05em] text-slate-500 dark:text-slate-400">
              {['Article', 'Author', 'Stage', 'Reviewer', 'Waiting or due', 'Words', 'Comments open', 'Rounds', 'Sector'].map((h) => <th key={h} className="whitespace-nowrap px-2 py-1.5 font-semibold">{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {(data.items || []).map((a) => (
              <tr key={a.id} className="border-t border-slate-100 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800/60" data-testid={`cq-row-${a.id}`}>
                <td className="px-2 py-2"><button type="button" onClick={() => onOpen(a.id)} className="min-h-[36px] text-left font-semibold text-slate-900 underline-offset-2 hover:underline dark:text-slate-100">{a.title || 'Untitled'}</button></td>
                <td className="px-2 py-2 text-slate-700 dark:text-slate-300">{a.author_name || 'Not recorded'}</td>
                <td className="px-2 py-2"><StagePill stage={stageOf(a)} /></td>
                <td className="px-2 py-2 text-slate-700 dark:text-slate-300">{a.reviewer_name || '—'}</td>
                <td className="px-2 py-2 text-slate-700 dark:text-slate-300">{waitText(a)}</td>
                <td className="px-2 py-2 font-mono text-slate-700 dark:text-slate-300">{a.word_count ?? '—'}</td>
                <td className="px-2 py-2 font-mono text-slate-700 dark:text-slate-300">{a.open_comments ?? '—'}</td>
                <td className="px-2 py-2 font-mono text-slate-700 dark:text-slate-300">{a.rounds ?? '—'}</td>
                <td className="px-2 py-2 text-slate-700 dark:text-slate-300">{a.sector || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-center gap-3 text-[12.5px] text-slate-600 dark:text-slate-400" data-testid="cq-paging">
        <span data-testid="cq-range">{rangeText(data.total, state)}</span>
        <label className="flex items-center gap-1">Rows per page
          <select value={state.size} onChange={(e) => set({ size: Number(e.target.value), page: 1 })} className={INPUT} data-testid="cq-size">{PAGE_SIZES.map((n) => <option key={n} value={n}>{n}</option>)}</select>
        </label>
        <span className="ml-auto">Page {Math.min(state.page, pages)} of {pages}</span>
        <button type="button" disabled={state.page <= 1} onClick={() => set({ page: state.page - 1 })} className={actionGhost} data-testid="cq-prev">Previous</button>
        <button type="button" disabled={state.page >= pages} onClick={() => set({ page: state.page + 1 })} className={actionGhost} data-testid="cq-next">Next</button>
      </div>
    </section>
  );
}

/** ART14: the shape of the page while it reads, with no number. */
function Loading() {
  return (
    <div className="flex flex-col gap-2" aria-busy="true" data-testid="cq-loading">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-5">{BOARD_STAGES.map((k) => <div key={k} className="h-40 animate-pulse rounded-xl bg-slate-100 dark:bg-slate-800" />)}</div>
      <p className={`m-0 ${SUB}`} aria-live="polite">{STATES.reading}</p>
    </div>
  );
}

/** Pipeline. `viewer` is `{ userId, superAdmin }`; `drawer` is the open article's review, drawn over the page. */
export default function Pipeline({ viewer, drawer = null, refreshKey = 0 }) {
  const navigate = useNavigate();
  const location = useLocation();
  const state = listStateOf(location.search);
  const [read, reload] = useQueue(state);
  useEffect(() => { if (refreshKey) reload(); }, [refreshKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = (change) => navigate({ pathname: location.pathname, search: searchOf({ ...state, page: 1, ...change }) });
  const go = (view) => navigate({ pathname: QUEUE_BASE, search: searchOf({ ...state, view, page: 1 }) });
  // A literal, so the admin reachability walk sees the door to `/admin/articles/:view`.
  const open = (id) => navigate({ pathname: `/admin/articles/${id}`, search: location.search });
  const toStage = (stage) => navigate({ pathname: QUEUE_BASE, search: searchOf({ ...state, view: 'list', stage, page: 1 }) });
  const data = read.status === 'ready' ? read.data : null;
  const oldest = data && state.view === 'board' ? (data.items || []).find((a) => stageOf(a) === 'submitted') : null;
  const filtered = state.view === 'list' && (state.q || activeFilters(state) > 0 || state.stage !== 'open');
  const empty = data && Number(data.total) === 0;

  let body;
  if (read.status === 'loading') body = <Loading />;
  else if (read.status === 'failed') {
    body = (
      <section className={`${CARD} flex flex-col items-start gap-2 p-6`} role="alert" data-testid="cq-failed">
        <h2 className="m-0 text-[15px] font-bold text-slate-900 dark:text-slate-100">{STATES.failed.title}</h2>
        <p className={`m-0 ${SUB}`}>{STATES.failed.line}</p>
        <button type="button" onClick={reload} className={actionPrimary} data-testid="cq-retry">{STATES.failed.retry}</button>
      </section>
    );
  } else if (empty && filtered) {
    body = (
      <section className={`${CARD} flex flex-col items-start gap-2 p-6`} data-testid="cq-no-match">
        <h2 className="m-0 text-[15px] font-bold text-slate-900 dark:text-slate-100">{STATES.noMatch.title}</h2>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => set({ q: '', author: '', sector: '', reviewer: '', submitted_from: '', submitted_to: '', open_comments: '', stage: 'open' })} className={actionGhost} data-testid="cq-no-match-clear">{STATES.noMatch.clear}</button>
          {state.stage !== 'all' && <button type="button" onClick={() => set({ stage: 'all' })} className={actionGhost} data-testid="cq-no-match-all">{STATES.noMatch.every}</button>}
        </div>
      </section>
    );
  } else if (empty && state.view === 'board' && data.counts?.available !== false && Number(data.counts?.total) === 0) {
    body = (
      <section className={`${CARD} flex flex-col items-start gap-2 p-6`} data-testid="cq-none">
        <h2 className="m-0 text-[15px] font-bold text-slate-900 dark:text-slate-100">{STATES.none.title}</h2>
        <p className={`m-0 ${SUB}`}>{STATES.none.line}</p>
      </section>
    );
  } else body = state.view === 'list' ? <List data={data} state={state} set={set} onOpen={open} /> : <Board data={data} onOpen={open} onStage={toStage} />;

  return (
    <div className="mt-4 flex flex-col gap-3" data-testid="cq-pipeline">
      <div className="flex flex-wrap items-center gap-2">
        <div role="group" aria-label="View" className="flex gap-1">
          {[['board', 'Board'], ['list', 'List']].map(([v, l]) => (
            <button key={v} type="button" aria-pressed={state.view === v} onClick={() => go(v)} className={`min-h-[36px] rounded-full px-3 text-[13px] font-semibold ${state.view === v ? 'bg-violet-50 text-violet-800 dark:bg-violet-950 dark:text-violet-200' : 'text-slate-600 dark:text-slate-400'}`} data-testid={`cq-view-${v}`}>{l}</button>
          ))}
        </div>
        {oldest && <button type="button" onClick={() => open(oldest.id)} className={`${actionPrimary} ml-auto`} data-testid="cq-next-submission">Open the next submission</button>}
        <button type="button" onClick={reload} className={`${actionGhost} ${oldest ? '' : 'ml-auto'}`} data-testid="cq-refresh">{read.refreshing ? STATES.reading : 'Refresh'}</button>
      </div>
      {data && <StageStrip counts={data.counts} onStage={toStage} />}
      {state.view === 'list' && read.status !== 'failed' && <Toolbar state={state} choices={choicesOf(data?.items)} set={set} viewer={viewer} />}
      {body}
      <p className={`m-0 ${SUB}`}>{STATES.views}</p>
      {drawer}
    </div>
  );
}
