import React, { useEffect, useState } from 'react';
import { capTableRecordApi } from '../../../lib/api/capTableRecord';
import { Unreadable, actionGhost } from '../../../ui';
import { Tag } from './CapTableTag';
import {
  CHANGES_PAGE, DOC_OPTIONS, EMPTY_FILTERS, HISTORY_PAGE, SOURCE_OPTIONS, TYPE_OPTIONS,
  changeRow, correctable, filterQuery, pageLine, timelineRow, voidable,
} from './historyModel';

/**
 * D1025 (#2862, CT10) — History at `/raise/cap-table/history`: the record's
 * timeline, newest first, with its toolbar (search, Type, Source, Has
 * document, a date range) and pages of 25; and "Changes to scenarios and
 * access", paged on its own. Each read answers alone: a failed one says so
 * where its block would be, and never draws "nothing yet".
 *
 * A recorded row offers Void to the owner (CT12b) and Correct to an admin
 * (CT12c); both are the page's dialogs, given as `onVoid` and `onCorrect`.
 */

const CARD = 'rounded-xl border border-axal-hairline bg-white dark:border-gray-700 dark:bg-gray-900';
const INK = 'text-axal-ink dark:text-gray-200';
const MUTED = 'text-axal-muted dark:text-gray-400';
const INPUT = 'rounded-[9px] border border-axal-hairline bg-white px-2.5 py-1.5 text-[12.5px] text-axal-ink dark:border-gray-700 dark:bg-gray-950 dark:text-gray-200';
const PILL = 'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold';
const DOC = 'border-axal-hairline bg-white text-axal-ink dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200';
const NODOC = 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-300/55 dark:bg-amber-300/10 dark:text-amber-300';
const LINK = 'text-[12px] font-semibold text-axal-violet hover:text-axal-violet-deep dark:text-violet-400';

function usePaged(load, deps) {
  const [state, setState] = useState({ status: 'loading', data: null });
  const [n, setN] = useState(0);
  useEffect(() => {
    let live = true;
    setState((s) => ({ status: 'loading', data: s.data }));
    load().then((data) => { if (live) setState({ status: 'ready', data }); },
      (e) => { if (live) setState({ status: e?.status === 403 || e?.status === 404 ? 'refused' : 'error', data: null }); });
    return () => { live = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, n]);
  return { ...state, retry: () => setN((x) => x + 1) };
}

function Pager({ page, size, total, count, onPage, testId }) {
  const last = Math.max(1, Math.ceil((total || 0) / size));
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-axal-ground px-4 py-2 dark:border-gray-700" data-testid={testId}>
      <span className={`font-mono text-[11.5px] ${MUTED}`} data-testid={`${testId}-line`}>{pageLine(page, size, total, count)}</span>
      <span className="flex gap-1.5">
        <button type="button" className={actionGhost} disabled={page <= 1} onClick={() => onPage(page - 1)} data-testid={`${testId}-prev`}>Previous</button>
        <button type="button" className={actionGhost} disabled={page >= last} onClick={() => onPage(page + 1)} data-testid={`${testId}-next`}>Next</button>
      </span>
    </div>
  );
}

function Toolbar({ value, onApply }) {
  const [draft, setDraft] = useState(value);
  const [error, setError] = useState(null);
  const set = (k) => (e) => setDraft((d) => ({ ...d, [k]: e.target.value }));
  const apply = (next) => {
    const out = filterQuery(next);
    if (out.error) { setError(out.error); return; }
    setError(null);
    onApply(next);
  };
  const select = (k, list, label) => (
    <select className={INPUT} value={draft[k]} aria-label={label} data-testid={`captable-history-${k}`}
      onChange={(e) => { const next = { ...draft, [k]: e.target.value }; setDraft(next); apply(next); }}>
      {list.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
  return (
    <form className="flex flex-wrap items-end gap-2 border-b border-axal-ground px-4 py-3 dark:border-gray-700" role="search" aria-label="Search history"
      onSubmit={(e) => { e.preventDefault(); apply(draft); }} data-testid="captable-history-toolbar">
      <input className={`${INPUT} min-w-[180px] flex-1`} value={draft.q} onChange={set('q')} placeholder="Search history" aria-label="Search history" maxLength={200} data-testid="captable-history-q" />
      {select('kind', TYPE_OPTIONS, 'Type')}
      {select('source', SOURCE_OPTIONS, 'Source')}
      {select('has_document', DOC_OPTIONS, 'Has document')}
      <label className={`flex flex-col text-[10.5px] font-bold uppercase ${MUTED}`}>From<input type="date" className={INPUT} value={draft.from} onChange={set('from')} aria-label="From" data-testid="captable-history-from" /></label>
      <label className={`flex flex-col text-[10.5px] font-bold uppercase ${MUTED}`}>To<input type="date" className={INPUT} value={draft.to} onChange={set('to')} aria-label="To" data-testid="captable-history-to" /></label>
      <button type="submit" className={actionGhost} data-testid="captable-history-apply">Search</button>
      {JSON.stringify(draft) !== JSON.stringify(EMPTY_FILTERS)
        ? <button type="button" className={actionGhost} onClick={() => { setDraft(EMPTY_FILTERS); apply(EMPTY_FILTERS); }} data-testid="captable-history-clear">Clear</button> : null}
      {error ? <p role="alert" className="m-0 w-full text-[12px] font-semibold text-red-700 dark:text-red-400" data-testid="captable-history-filter-error">{error}</p> : null}
    </form>
  );
}

function TimelineRow({ r, owner, admin, onVoid, onCorrect }) {
  return (
    <li className="flex gap-3 border-b border-axal-ground px-4 py-3 last:border-b-0 dark:border-gray-700" data-testid="captable-history-row">
      <span className="flex w-12 shrink-0 flex-col items-center font-mono leading-tight" aria-label={r.date ? `${r.date.d} ${r.date.m} ${r.date.y}` : 'Date not recorded'}>
        {r.date ? (<><span className={`text-[10.5px] font-bold ${MUTED}`}>{r.date.m}</span><span className={`text-[16px] font-extrabold ${INK}`}>{r.date.d}</span><span className={`text-[10.5px] ${MUTED}`}>{r.date.y}</span></>) : <span className={MUTED}>—</span>}
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className={`text-[13px] font-semibold leading-snug ${r.struck ? `line-through ${MUTED}` : INK}`} data-testid="captable-history-text">{r.text}</span>
        {r.by ? <span className={`text-[12px] ${MUTED}`}>{r.by}</span> : null}
        {r.reason ? <span className={`text-[12px] ${MUTED}`} data-testid="captable-history-reason">Reason: {r.reason}</span> : null}
        {r.adminReason ? <span className={`text-[12px] ${MUTED}`}>An admin’s reason: {r.adminReason}</span> : null}
        <span className="flex flex-wrap items-center gap-1.5">
          {r.document ? <span className={`${PILL} ${DOC}`} data-testid="captable-history-document">▤ {r.document}</span> : <span className={`${PILL} ${NODOC}`} data-testid="captable-history-no-document">! No document</span>}
          <span className={`${PILL} ${DOC}`}>{r.source}</span>
          {owner && onVoid && voidable(r.row) ? <button type="button" className={LINK} onClick={() => onVoid(r.row)} data-testid="captable-history-void">Void</button> : null}
          {admin && onCorrect && correctable(r.row) ? <button type="button" className={LINK} onClick={() => onCorrect(r.row)} data-testid="captable-history-correct">Correct</button> : null}
        </span>
      </span>
    </li>
  );
}

export default function HistoryTab({ projectId, record, owner = false, admin = false, reload = 0, onVoid, onCorrect }) {
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [page, setPage] = useState(1);
  const [changesPage, setChangesPage] = useState(1);
  const query = filterQuery(filters).query || {};
  const timeline = usePaged(() => capTableRecordApi.history(projectId, { section: 'record', page, pageSize: HISTORY_PAGE, filters: query }), [projectId, page, JSON.stringify(query), reload]);
  const changes = usePaged(() => capTableRecordApi.history(projectId, { section: 'changes', page: changesPage, pageSize: CHANGES_PAGE }), [projectId, changesPage, reload]);
  const recordData = record?.status === 'ready' ? record.data : null;
  const rows = timeline.status === 'ready' ? (timeline.data?.rows || []).map((e) => timelineRow(e, recordData)) : [];
  const filtered = Object.keys(query).length > 0;
  return (
    <div className="grid gap-3.5 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]" data-testid="captable-history">
      <section className={CARD} aria-labelledby="captable-history-title">
        <header className="flex flex-wrap items-center gap-2 px-4 pt-3">
          <h2 id="captable-history-title" className={`m-0 text-[15px] font-extrabold ${INK}`}>History</h2>
          <Tag kind="record" />
        </header>
        <Toolbar value={filters} onApply={(f) => { setFilters(f); setPage(1); }} />
        {timeline.status === 'loading' && !timeline.data ? <p className={`m-0 px-4 py-6 text-[12.5px] ${MUTED}`} aria-busy="true" data-testid="captable-history-reading">Reading…</p>
          : timeline.status === 'refused' ? <p className={`m-0 px-4 py-6 text-[13px] ${INK}`} data-testid="captable-history-refused">This cap table’s history is not open to you.</p>
            : timeline.status === 'error' ? <div className="px-4 py-4" data-testid="captable-history-unreadable"><Unreadable what="The history" claim="This is not a claim that nothing was recorded." onRetry={timeline.retry} /></div>
              : !rows.length ? (
                <p className={`m-0 px-4 py-6 text-[13px] ${INK}`} data-testid="captable-history-empty">
                  {filtered ? 'Nothing on the record matches these filters.' : 'Nothing is recorded yet. Each issuance you record, void or correct appears here.'}
                </p>
              ) : <ul className="m-0 list-none p-0" data-testid="captable-history-rows">{rows.map((r) => <TimelineRow key={r.uid} r={r} owner={owner} admin={admin} onVoid={onVoid} onCorrect={onCorrect} />)}</ul>}
        {timeline.status === 'ready' ? <Pager page={page} size={HISTORY_PAGE} total={timeline.data?.total} count={rows.length} onPage={setPage} testId="captable-history-pager" /> : null}
      </section>
      <section className={CARD} aria-labelledby="captable-changes-title" data-testid="captable-changes">
        <h2 id="captable-changes-title" className={`m-0 px-4 pt-3 text-[15px] font-extrabold ${INK}`}>Changes to scenarios and access</h2>
        {changes.status === 'loading' && !changes.data ? <p className={`m-0 px-4 py-6 text-[12.5px] ${MUTED}`} aria-busy="true">Reading…</p>
          : changes.status === 'refused' ? <p className={`m-0 px-4 py-6 text-[13px] ${INK}`}>These changes are not open to you.</p>
            : changes.status === 'error' ? <div className="px-4 py-4" data-testid="captable-changes-unreadable"><Unreadable what="The changes" claim="This is not a claim that nothing changed." onRetry={changes.retry} /></div>
              : !(changes.data?.rows || []).length ? <p className={`m-0 px-4 py-6 text-[13px] ${INK}`} data-testid="captable-changes-empty">No scenario or access change yet.</p>
                : (
                  <ul className="m-0 list-none p-0" data-testid="captable-changes-rows">
                    {changes.data.rows.map((e, i) => {
                      const c = changeRow(e);
                      return (
                        <li key={`${e.at}-${i}`} className="flex justify-between gap-3 border-b border-axal-ground px-4 py-2.5 last:border-b-0 dark:border-gray-700" data-testid="captable-change">
                          <span className={`text-[12.5px] ${INK}`}>{c.text}</span>
                          <span className={`shrink-0 font-mono text-[11.5px] ${MUTED}`}>{c.when}</span>
                        </li>
                      );
                    })}
                  </ul>
                )}
        {changes.status === 'ready' ? <Pager page={changesPage} size={CHANGES_PAGE} total={changes.data?.total} count={(changes.data?.rows || []).length} onPage={setChangesPage} testId="captable-changes-pager" /> : null}
      </section>
    </div>
  );
}
