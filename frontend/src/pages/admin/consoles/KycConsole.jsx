import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { reportError } from '../../../lib/log';
import { Link } from 'react-router-dom';
import { kycPeopleApi } from '../../../lib/api/kycPeople.js';
import { useAuth } from '../../../hooks/useAuthSync';
import { Lightbox, actionGhost, actionPrimary } from '../../../ui';
import { CONSOLE_LOADING, ConsoleUnreadable } from './shared';
import { personHref, statusWord } from '../kyc/kycModel';
import {
  CHIPS, DEFAULT_QUERY, FLAGS, ID_TYPES, PAGE_SIZES, SORTS, appliedFilters, bandBars, cardLine, chipCount, chipWord,
  emptyLine, filtersOn, flagWord, idTypeWord, initials, pageCount, pageLine, queryParams, roleWord, tiles, timeLabel,
  waitLead, waitText, weekBars, weekLead, weekTotal, dayLabel,
} from '../kyc/peopleModel';
import { AssignDialog } from '../kyc/KycDialogs';

/**
 * D648 (#1448) — the KYC / AML queue. It reads the queue only when this
 * console is open (the read writes an audit row). A failed read says so; it
 * never draws "No submissions". D938: it is the KYC & KYB page's body, at
 * /admin/kyc. D1228: People's queue, in the canvas's status words, each name
 * opening that person's case.
 *
 * D1233 (#3241, KYC1, KYC2, KYC11–KYC16) — People, complete: part 1's queue
 * read (`GET /api/kyc/admin/people`) with search, the filters the Worker reads,
 * the four sorts, paging and the count per status, and its figures
 * (`/admin/figures`). Each name opens the case, where every decision now is:
 * this list decides nothing, and its bulk bar only assigns (no bulk approve).
 * The figures and the list answer alone, so one failing never blanks the
 * other (KYC13).
 */

const CARD = 'rounded-xl border border-axal-hairline bg-white dark:border-gray-800 dark:bg-gray-900';
const EYE = 'text-[10.5px] font-bold uppercase tracking-[.07em] text-axal-muted dark:text-gray-400';
const MUTED = 'text-axal-muted dark:text-gray-400';
const BTN = 'rounded-lg border border-axal-hairline bg-white px-2.5 py-1.5 text-[12.5px] font-semibold hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:hover:bg-gray-800';

/** Each status keeps its own colour pair in the dark (KYC16). */
const PILL = {
  pending: 'bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-950 dark:text-amber-200 dark:border-amber-800',
  needs_info: 'bg-sky-50 text-sky-800 border-sky-200 dark:bg-sky-950 dark:text-sky-200 dark:border-sky-800',
  approved: 'bg-emerald-50 text-emerald-800 border-emerald-200 dark:bg-emerald-950 dark:text-emerald-200 dark:border-emerald-800',
  rejected: 'bg-red-50 text-red-800 border-red-200 dark:bg-red-950 dark:text-red-200 dark:border-red-800',
  expired: 'bg-gray-100 text-gray-700 border-gray-300 dark:bg-gray-800 dark:text-gray-200 dark:border-gray-600',
  not_started: 'bg-white text-gray-600 border-gray-300 dark:bg-gray-900 dark:text-gray-300 dark:border-gray-600',
};
export function StatusPill({ status, testId }) {
  return <span className={`inline-flex w-fit rounded-full border px-2 py-0.5 text-[11.5px] font-bold ${PILL[status] || PILL.not_started}`} data-testid={testId}>{statusWord(status)}</span>;
}

function NotRecorded({ why }) {
  return <span className={`text-[12px] ${MUTED}`} title={why}>Not recorded</span>;
}

/* ----------------------------------------------------------------- figures */

function Tile({ t, reading }) {
  return (
    <div className={`${CARD} flex flex-col gap-1 p-3`} data-testid={`kyc-tile-${t.key}`}>
      <span className={EYE}>{t.label}</span>
      {reading ? <span className={`text-[13px] ${MUTED}`}>Reading…</span>
        : t.value == null ? <NotRecorded why="Its read did not answer." />
          : <span className="font-mono text-[22px] font-bold tabular-nums">{t.value}</span>}
      {!reading && t.sub && <span className={`text-[12px] ${MUTED}`}>{t.sub}</span>}
    </div>
  );
}

function Bars({ rows, max, testId }) {
  return (
    <div className="flex h-[132px] items-end gap-2" data-testid={testId}>
      {rows.map((r) => (
        <div key={r.key} className="flex min-w-0 flex-1 flex-col items-center gap-1">
          <span className="font-mono text-[11px] tabular-nums">{r.value == null ? '' : r.value}</span>
          {r.value == null
            ? <div className="h-[96px] w-full rounded border border-dashed border-gray-300 dark:border-gray-600" data-testid={`${testId}-unrecorded`} title="Not recorded" />
            : (
              <div className="flex w-full flex-col justify-end" style={{ height: 96 }}>
                {r.parts.map((p) => (
                  <div key={p.key} className={p.cls} style={{ height: max ? `${(p.n / max) * 96}px` : 0 }} />
                ))}
              </div>
            )}
          <span className={`w-full truncate text-center text-[10.5px] ${MUTED}`}>{r.label}</span>
        </div>
      ))}
    </div>
  );
}

function ChartBlock({ title, lead, table, chart, state, onRetry, what, testId }) {
  const [asTable, setAsTable] = useState(false);
  return (
    <section className={`${CARD} flex min-w-0 flex-col gap-2 p-4`} data-testid={testId}>
      <div className="flex items-center gap-2">
        <h3 className="m-0 text-[14px] font-bold">{title}</h3>
        {state === 'ok' && <button type="button" className={`ml-auto text-[12px] font-semibold text-violet-700 underline hover:text-violet-900 dark:text-violet-300 dark:hover:text-violet-200`} onClick={() => setAsTable((v) => !v)}>{asTable ? 'View as chart' : 'View as table'}</button>}
      </div>
      {state === 'loading' && <p className={`m-0 text-[13px] ${MUTED}`}>Reading…</p>}
      {state === 'failed' && (
        <div className="flex flex-col gap-1" role="alert" data-testid={`${testId}-failed`}>
          <p className="m-0 text-[13px] font-semibold">Could not be read.</p>
          <p className={`m-0 text-[12.5px] ${MUTED}`}>{what}</p>
          <button type="button" className={`${BTN} w-fit`} onClick={onRetry}>Try again</button>
        </div>
      )}
      {state === 'ok' && (
        <>
          {lead && <p className={`m-0 text-[12.5px] ${MUTED}`} data-testid={`${testId}-lead`}>{lead}</p>}
          {asTable ? table : chart}
        </>
      )}
    </section>
  );
}

function Figures({ counts, figures, figState, reloadFigures, filtered, nowIso, reading }) {
  const t = tiles({ counts, figures: figState === 'ok' ? figures : null, filtered, nowIso });
  const weeks = figState === 'ok' ? weekBars(figures.weeks, nowIso) : [];
  const bands = figState === 'ok' ? bandBars(figures.wait_bands) : [];
  const weekMax = Math.max(1, ...weeks.map((w) => weekTotal(w) || 0));
  const bandMax = Math.max(1, ...bands.map((b) => b.n || 0));
  return (
    <div className="flex flex-col gap-3" data-testid="kyc-figures">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {t.map((x) => <Tile key={x.key} t={x} reading={reading || ((x.key === 'decided' || x.key === 'median') && figState === 'loading')} />)}
      </div>
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <ChartBlock title="How long they have waited" testId="kyc-chart-wait" state={figState} onRetry={reloadFigures}
          what="The people waiting are still in the table."
          lead={figState === 'ok' ? waitLead(figures.wait_bands) : null}
          chart={<Bars testId="kyc-chart-wait-bars" max={bandMax} rows={bands.map((b) => ({ key: b.key, label: b.label, value: b.n, parts: [{ key: 'n', n: b.n || 0, cls: b.key === 'under_1_day' ? 'rounded-t bg-violet-600 dark:bg-violet-400' : 'rounded-t bg-amber-500 dark:bg-amber-400' }] }))} />}
          table={(
            <table className="w-full text-[12.5px]"><tbody>
              {bands.map((b) => <tr key={b.key}><td className="py-1">{b.label}</td><td className="py-1 text-right font-mono">{b.n == null ? 'Not recorded' : b.n}</td></tr>)}
              {figures?.wait_bands?.not_recorded ? <tr><td className="py-1">No submission time recorded</td><td className="py-1 text-right font-mono">{figures.wait_bands.not_recorded}</td></tr> : null}
            </tbody></table>
          )} />
        <ChartBlock title="Decisions per week" testId="kyc-chart-weeks" state={figState} onRetry={reloadFigures}
          what="The decisions are still in the table."
          lead={figState === 'ok' ? weekLead(weeks) : null}
          chart={(
            <>
              <Bars testId="kyc-chart-weeks-bars" max={weekMax} rows={weeks.map((w) => ({
                key: w.week_start, label: w.current ? `${w.label} · to date` : w.label, value: weekTotal(w),
                parts: [
                  { key: 'ni', n: w.needs_info || 0, cls: 'bg-sky-400 dark:bg-sky-500' },
                  { key: 'rj', n: w.rejected || 0, cls: 'bg-red-500 dark:bg-red-400' },
                  { key: 'ap', n: w.approved || 0, cls: 'rounded-t bg-violet-600 dark:bg-violet-400' },
                ],
              }))} />
              <div className={`flex flex-wrap gap-3 text-[11.5px] ${MUTED}`}>
                <span><i className="mr-1 inline-block h-2 w-2 rounded-sm bg-violet-600 dark:bg-violet-400" />Approved</span>
                <span><i className="mr-1 inline-block h-2 w-2 rounded-sm bg-red-500 dark:bg-red-400" />Rejected</span>
                <span><i className="mr-1 inline-block h-2 w-2 rounded-sm bg-sky-400 dark:bg-sky-500" />Asked for information</span>
                <span><i className="mr-1 inline-block h-2 w-2 rounded-sm border border-dashed border-gray-400" />Not recorded</span>
              </div>
            </>
          )}
          table={(
            <table className="w-full text-[12.5px]"><thead><tr className={MUTED}><th className="text-left font-medium">Week of</th><th className="text-right font-medium">Approved</th><th className="text-right font-medium">Rejected</th><th className="text-right font-medium">Asked</th></tr></thead><tbody>
              {weeks.map((w) => (
                <tr key={w.week_start}><td className="py-1">{dayLabel(w.week_start)}</td>
                  {w.recorded ? ['approved', 'rejected', 'needs_info'].map((k) => <td key={k} className="py-1 text-right font-mono">{w[k]}</td>)
                    : <td colSpan={3} className={`py-1 text-right ${MUTED}`}>Not recorded</td>}
                </tr>
              ))}
            </tbody></table>
          )} />
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------- filters */

function Radio({ name, value, current, onChange, children, testId }) {
  return (
    <label className="flex items-center gap-2 text-[13px]">
      <input type="radio" name={name} checked={current === value} onChange={() => onChange(value)} data-testid={testId} />
      <span>{children}</span>
    </label>
  );
}

/** KYC2, KYC15b — the filters the Worker reads, applied together on Show results. */
function FiltersDialog({ query, onApply, onClose }) {
  const [draft, setDraft] = useState({ id_type: query.id_type, country: query.country, flag: query.flag, assignee: query.assignee });
  const set = (k) => (v) => setDraft((d) => ({ ...d, [k]: v }));
  return (
    <Lightbox label="Filters" title="Filters" onClose={onClose} width={520} testId="kyc-filters"
      footer={(
        <div className="flex justify-between gap-2">
          <button type="button" className={actionGhost} onClick={() => setDraft({ id_type: '', country: '', flag: '', assignee: '' })} data-testid="kyc-filters-clear">Clear all</button>
          <button type="button" className={actionPrimary} onClick={() => onApply(draft)} data-testid="kyc-filters-apply">Show results</button>
        </div>
      )}>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <fieldset className="m-0 flex flex-col gap-1.5 border-0 p-0"><legend className={EYE}>ID type</legend>
          <Radio name="kyc-f-id" value="" current={draft.id_type} onChange={set('id_type')}>Any</Radio>
          {ID_TYPES.map((t) => <Radio key={t.value} name="kyc-f-id" value={t.value} current={draft.id_type} onChange={set('id_type')} testId={`kyc-f-id-${t.value}`}>{t.label}</Radio>)}
        </fieldset>
        <fieldset className="m-0 flex flex-col gap-1.5 border-0 p-0"><legend className={EYE}>Flags</legend>
          <Radio name="kyc-f-flag" value="" current={draft.flag} onChange={set('flag')}>Any</Radio>
          {FLAGS.map((f) => <Radio key={f.value} name="kyc-f-flag" value={f.value} current={draft.flag} onChange={set('flag')} testId={`kyc-f-flag-${f.value}`}>{f.label}</Radio>)}
        </fieldset>
        <fieldset className="m-0 flex flex-col gap-1.5 border-0 p-0"><legend className={EYE}>Assigned</legend>
          {[['', 'Anyone'], ['me', 'Me'], ['none', 'No one']].map(([v, w]) => <Radio key={v || 'any'} name="kyc-f-as" value={v} current={draft.assignee} onChange={set('assignee')} testId={`kyc-f-as-${v || 'any'}`}>{w}</Radio>)}
        </fieldset>
        <label className="flex flex-col gap-1.5"><span className={EYE}>Country</span>
          <input value={draft.country} onChange={(e) => set('country')(e.target.value.toUpperCase().slice(0, 3))} placeholder="Two-letter code, e.g. PT"
            className="rounded-lg border border-axal-hairline bg-white px-3 py-2 text-[13px] dark:border-gray-700 dark:bg-gray-900" data-testid="kyc-f-country" />
        </label>
      </div>
      <p className={`mt-3 text-[12px] ${MUTED}`}>Profile, the wait band, the submitted date and who decided are not filters the queue read takes yet; sort by Decided, newest to find recent decisions.</p>
    </Lightbox>
  );
}

/* ----------------------------------------------------------------- rows */

function Avatar({ row }) {
  return <span className="inline-flex h-8 w-8 flex-none items-center justify-center rounded-full bg-violet-100 text-[11.5px] font-bold text-violet-800 dark:bg-violet-950 dark:text-violet-200">{initials(row.name, row.email)}</span>;
}

function Flags({ row }) {
  if (!row.flags?.length) return <span className={MUTED}>—</span>;
  return (
    <div className="flex flex-wrap gap-1">
      {row.flags.map((f) => <span key={f} className="rounded-full border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-[11px] font-bold text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200" data-testid={`kyc-flag-${f}`}>{flagWord(f)}</span>)}
    </div>
  );
}

function RowMenu({ row, onAssign }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button type="button" aria-label={`Actions for ${row.name || row.email}`} aria-expanded={open} onClick={() => setOpen((o) => !o)}
        className="rounded-md px-2 py-1 text-[15px] leading-none hover:bg-gray-100 dark:hover:bg-gray-800" data-testid={`kyc-row-menu-${row.id}`}>⋯</button>
      {open && (
        <div className={`${CARD} absolute right-0 top-8 z-20 flex w-44 flex-col py-1 text-left shadow-lg`} role="menu">
          <Link to={personHref(row.id)} role="menuitem" className="px-3 py-1.5 text-[13px] hover:bg-gray-50 dark:hover:bg-gray-800">Open case</Link>
          <button type="button" role="menuitem" className="px-3 py-1.5 text-left text-[13px] hover:bg-gray-50 dark:hover:bg-gray-800" onClick={() => { setOpen(false); onAssign([row]); }} data-testid={`kyc-row-assign-${row.id}`}>Assign to…</button>
        </div>
      )}
    </div>
  );
}

/* ----------------------------------------------------------------- the console */

export default function KycConsole({ me: meProp, nowIso } = {}) {
  const auth = useAuth();
  const me = meProp || auth?.user || null;
  const [query, setQuery] = useState(DEFAULT_QUERY);
  const [search, setSearch] = useState('');
  const [list, setList] = useState({ kind: 'loading', data: null, at: null });
  const [fig, setFig] = useState({ kind: 'loading', data: null });
  const [picked, setPicked] = useState([]);
  const [dialog, setDialog] = useState(null);
  const seq = useRef(0);

  const params = useMemo(() => queryParams(query), [query]);
  const loadKyc = useCallback(async () => {
    const n = ++seq.current;
    setList((l) => ({ ...l, kind: l.data ? 'refreshing' : 'loading' }));
    try {
      const data = await kycPeopleApi.people(params);
      if (n !== seq.current) return;
      setList({ kind: 'ok', data, at: new Date().toISOString() });
    } catch (e) {
      reportError('KycConsole:loadKycQueue', e);
      if (n === seq.current) setList({ kind: 'failed', data: null, at: null });
    }
  }, [params]);
  const loadFigures = useCallback(async () => {
    setFig({ kind: 'loading', data: null });
    try { setFig({ kind: 'ok', data: await kycPeopleApi.figures() }); } catch (e) {
      reportError('KycConsole:kycFigures', e);
      setFig({ kind: 'failed', data: null });
    }
  }, []);
  useEffect(() => { loadKyc(); }, [loadKyc]);
  useEffect(() => { loadFigures(); }, [loadFigures]);
  useEffect(() => { setPicked([]); }, [params]);
  useEffect(() => {
    if (search === query.q) return undefined;
    const t = setTimeout(() => setQuery((q) => ({ ...q, q: search, page: 1 })), 300);
    return () => clearTimeout(t);
  }, [search, query.q]);

  const patch = (p) => setQuery((q) => ({ ...q, ...p, page: p.page ?? 1 }));
  const data = list.data;
  const rows = data?.rows || [];
  const counts = data?.counts || null;
  const applied = appliedFilters(query);
  const pages = data ? pageCount(data.total, params.page_size) : 1;
  const pickedRows = rows.filter((r) => picked.includes(r.id));
  const reading = list.kind === 'loading';

  const pager = data && (
    <div className="flex items-center gap-1 text-[12.5px]">
      <span className={MUTED} data-testid="kyc-page-line">{pageLine(data.total, params.page, params.page_size)}</span>
      <button type="button" className={BTN} disabled={params.page <= 1} onClick={() => patch({ page: params.page - 1 })} aria-label="Previous page">‹</button>
      <span className="font-mono">{params.page}</span>
      <button type="button" className={BTN} disabled={params.page >= pages} onClick={() => patch({ page: params.page + 1 })} aria-label="Next page" data-testid="kyc-page-next">›</button>
    </div>
  );

  return (
    <div className="flex min-w-0 flex-col gap-4" data-testid="kyc-people-queue">
      <Figures counts={counts} figures={fig.data} figState={fig.kind} reloadFigures={loadFigures} filtered={filtersOn(query)} nowIso={nowIso} reading={reading} />

      <section className={`${CARD} flex min-w-0 flex-col`}>
        <div className="flex flex-wrap gap-1.5 border-b border-axal-hairline p-3 dark:border-gray-800" role="tablist" aria-label="Status">
          {CHIPS.map((k) => {
            const n = chipCount(counts, k);
            const on = query.status === k;
            return (
              <button key={k} type="button" role="tab" aria-selected={on} onClick={() => patch({ status: k })} data-testid={`kyc-chip-${k}`}
                className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[12.5px] font-semibold ${on ? 'border-violet-600 bg-violet-600 text-white hover:bg-violet-700 dark:border-violet-400 dark:bg-violet-500 dark:hover:bg-violet-400' : 'border-axal-hairline bg-white text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200 dark:hover:bg-gray-800'}`}>
                {chipWord(k)}
                {reading ? <span className="inline-block h-2.5 w-5 rounded bg-gray-200 dark:bg-gray-700" /> : n != null && <span className="font-mono text-[11.5px] tabular-nums opacity-80">{n.toLocaleString('en-GB')}</span>}
              </button>
            );
          })}
        </div>

        <div className="flex flex-wrap items-center gap-2 p-3">
          <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name or email" aria-label="Search name or email"
            className="min-w-[220px] flex-1 rounded-lg border border-axal-hairline bg-white px-3 py-1.5 text-[13px] dark:border-gray-700 dark:bg-gray-900" data-testid="kyc-search" />
          <button type="button" className={BTN} onClick={() => setDialog({ kind: 'filters' })} data-testid="kyc-filters-open">
            Filters{applied.length ? <span className="ml-1 rounded-full bg-violet-600 px-1.5 text-[11px] text-white dark:bg-violet-500">{applied.length}</span> : null}
          </button>
          <select value={query.sort} onChange={(e) => patch({ sort: e.target.value })} aria-label="Sort" className={BTN} data-testid="kyc-sort">
            {SORTS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
          </select>
          <span className={`text-[12px] ${MUTED}`}>
            {list.at ? <>Read at {timeLabel(list.at)?.split(' · ')[1]} · </> : null}
            <button type="button" className="font-semibold underline hover:text-gray-900 dark:hover:text-gray-100" onClick={loadKyc} data-testid="kyc-refresh">Refresh</button>
          </span>
          <div className="ml-auto">{pager}</div>
        </div>

        {applied.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 px-3 pb-3" data-testid="kyc-applied">
            {applied.map((f) => (
              <button key={f.key} type="button" onClick={() => patch({ [f.key]: '' })} data-testid={`kyc-applied-${f.key}`}
                className="inline-flex items-center gap-1 rounded-full border border-violet-300 bg-violet-50 px-2.5 py-0.5 text-[12px] font-semibold text-violet-800 hover:bg-violet-100 dark:border-violet-700 dark:bg-violet-950 dark:text-violet-200 dark:hover:bg-violet-900">
                {f.label} <span aria-hidden="true">×</span><span className="sr-only">Remove</span>
              </button>
            ))}
            <button type="button" className="text-[12px] font-semibold underline hover:text-gray-900 dark:hover:text-gray-100" onClick={() => patch({ id_type: '', country: '', flag: '', assignee: '' })} data-testid="kyc-applied-clear">Clear all</button>
          </div>
        )}

        {pickedRows.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 border-y border-violet-200 bg-violet-50 px-3 py-2 text-[13px] dark:border-violet-900 dark:bg-violet-950" data-testid="kyc-bulk">
            <strong>{pickedRows.length} selected</strong>
            <button type="button" className={BTN} onClick={() => setDialog({ kind: 'assign', people: pickedRows })} data-testid="kyc-bulk-assign">Assign to…</button>
            <button type="button" className="font-semibold underline hover:text-gray-900 dark:hover:text-gray-100" onClick={() => setPicked([])}>Clear</button>
            <span className={`text-[12px] ${MUTED}`}>Each case is decided on its own page; there is no bulk approve.</span>
          </div>
        )}

        {list.kind === 'failed' ? (
          <ConsoleUnreadable what="The KYC queue" onRetry={loadKyc} />
        ) : reading ? (
          <div className="py-12 text-center text-gray-600 dark:text-gray-300">{CONSOLE_LOADING}</div>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center gap-1 p-10 text-center" data-testid="kyc-empty">
            <p className="m-0 text-[14px] font-semibold">{emptyLine(query).title}</p>
            {emptyLine(query).line && <p className={`m-0 text-[12.5px] ${MUTED}`}>{emptyLine(query).line}</p>}
            {filtersOn(query) && <button type="button" className={`${BTN} mt-2`} onClick={() => { setSearch(''); patch({ q: '', id_type: '', country: '', flag: '', assignee: '' }); }} data-testid="kyc-empty-clear">Clear filters</button>}
          </div>
        ) : (
          <>
            <div className="hidden overflow-x-auto sm:block">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className={`border-b border-axal-hairline text-left dark:border-gray-800 ${EYE}`}>
                    <th className="w-8 px-3 py-2"><input type="checkbox" aria-label="Select every row on this page" checked={pickedRows.length === rows.length} onChange={(e) => setPicked(e.target.checked ? rows.map((r) => r.id) : [])} data-testid="kyc-pick-all" /></th>
                    <th className="px-3 py-2">Person</th><th className="px-3 py-2">Profile</th><th className="px-3 py-2">Status</th>
                    <th className="px-3 py-2">Waiting</th><th className="px-3 py-2">ID type · Country</th><th className="px-3 py-2">Flags</th><th className="px-3 py-2">Assigned</th><th className="px-3 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((k) => (
                    <tr key={k.id} className="border-b border-gray-100 hover:bg-gray-50 dark:border-gray-800 dark:hover:bg-gray-800/60" data-testid="kyc-row">
                      <td className="px-3 py-2.5"><input type="checkbox" aria-label={`Select ${k.name || k.email}`} checked={picked.includes(k.id)} onChange={(e) => setPicked((p) => (e.target.checked ? [...p, k.id] : p.filter((x) => x !== k.id)))} data-testid={`kyc-pick-${k.id}`} /></td>
                      <td className="px-3 py-2.5">
                        <div className="flex items-center gap-2">
                          <Avatar row={k} />
                          <div className="min-w-0">
                            <Link to={`/admin/kyc/people/${k.id}`} className="font-semibold text-gray-900 underline hover:text-violet-700 dark:text-gray-100 dark:hover:text-violet-300" data-testid={`kyc-person-${k.id}`}>{k.name || 'Name not recorded'}</Link>
                            <div className={`text-[12px] ${MUTED}`}>{k.email}</div>
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-2.5">{roleWord(k.role) || <NotRecorded why="No profile on the account." />}</td>
                      <td className="px-3 py-2.5"><StatusPill status={k.status} /></td>
                      <td className="px-3 py-2.5">
                        {waitText(k) ? <div className="font-semibold" data-testid={`kyc-wait-${k.id}`}>{waitText(k)}</div> : <span className={MUTED}>—</span>}
                        <div className={`text-[12px] ${MUTED}`}>{k.status === 'needs_info' ? 'On the member' : dayLabel(k.submitted_at) || ''}</div>
                      </td>
                      <td className="px-3 py-2.5">
                        <div>{idTypeWord(k.id_type) || <NotRecorded why="No ID type on the submission." />}</div>
                        <div className={`text-[12px] ${MUTED}`}>{k.country || ''}</div>
                      </td>
                      <td className="px-3 py-2.5"><Flags row={k} /></td>
                      <td className="px-3 py-2.5">{k.assignee ? (k.assignee.name || 'An admin') : <span className={MUTED}>Unassigned</span>}</td>
                      <td className="px-3 py-2.5 text-right"><RowMenu row={k} onAssign={(people) => setDialog({ kind: 'assign', people })} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <ul className="m-0 flex list-none flex-col divide-y divide-gray-100 p-0 sm:hidden dark:divide-gray-800" data-testid="kyc-cards">
              {rows.map((k) => (
                <li key={k.id}>
                  <Link to={personHref(k.id)} className="flex items-start gap-3 px-3 py-3 hover:bg-gray-50 dark:hover:bg-gray-800/60" data-testid={`kyc-card-${k.id}`}>
                    <Avatar row={k} />
                    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <div className="flex items-center gap-2"><span className="truncate font-semibold">{k.name || 'Name not recorded'}</span><span className="ml-auto"><StatusPill status={k.status} /></span></div>
                      <span className={`text-[12px] ${MUTED}`}>{roleWord(k.role)}</span>
                      {cardLine(k) && <span className="text-[12.5px]">{cardLine(k)}</span>}
                      <Flags row={k} />
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
            <div className="flex flex-wrap items-center justify-between gap-2 p-3 text-[12.5px]">
              <span className={MUTED}>Rows per page{' '}
                {PAGE_SIZES.map((n, i) => (
                  <React.Fragment key={n}>{i ? ' · ' : ''}<button type="button" className={`font-semibold ${params.page_size === n ? 'text-violet-700 dark:text-violet-300' : 'underline hover:text-gray-900 dark:hover:text-gray-100'}`} onClick={() => patch({ page_size: n })} data-testid={`kyc-size-${n}`}>{n}</button></React.Fragment>
                ))}
              </span>
              {pager}
            </div>
          </>
        )}
      </section>

      {dialog?.kind === 'filters' && <FiltersDialog query={query} onClose={() => setDialog(null)} onApply={(d) => { setDialog(null); patch(d); }} />}
      {dialog?.kind === 'assign' && <AssignDialog people={dialog.people} me={me} onClose={() => setDialog(null)} onDone={() => { setDialog(null); setPicked([]); loadKyc(); }} />}
    </div>
  );
}
