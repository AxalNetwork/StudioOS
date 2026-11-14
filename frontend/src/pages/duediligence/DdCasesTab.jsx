/**
 * D1250 (#3265, part 6 of #2385) — Due diligence's Cases tab, the canvas's
 * DDL1 (DDL19 in dark): four tiles and two charts from `GET /api/dd/overview`,
 * the stage strip, the toolbar (search, filters, sort, paging, refresh) and the
 * canvas's columns from `GET /api/dd/cases`, read on the server a page at a
 * time. Each row's menu opens the case, or changes its lead, its target IC
 * date or archives it (D1246) for the case lead or an Admin; anyone else is
 * told why in one sentence. Open a case is DDL2.
 *
 * THE STATES (DDL16, DDL17). The header, the tabs and the toolbar draw at
 * once. The overview and the list are read apart: one failing never blanks
 * the other, and a failed list says so ("This is not an empty list"). A desk
 * with no case says "No diligence cases yet." with measured zeros; filters
 * that match nobody say what they asked for, with Clear filters.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { MoreHorizontal, Plus, RefreshCw, Search, SlidersHorizontal, X } from 'lucide-react';
import { ddDeskApi } from '../../lib/api/ddDesk.js';
import { reportError } from '../../lib/log';
import { useToast } from '../../components/useToast';
import ToastMessage from '../../components/ToastMessage';
import {
  ADVISOR_NOTE, CHANGE_REFUSED, LIST_FAILED, LIST_FAILED_SUB, PAGE_SIZES, SORTS, SUBJECT_TYPES,
  ageChart, canChangeCase, canOpenCase, decisionsChart, filterChips, listQuery, noMatchText, overviewTiles,
  pageCount, rangeText, rowCells, stageStrip,
} from './ddListModel.js';
import { BAND_WORD, DECISION_WORD } from './ddModel.js';
import { ChartCard } from './DdCharts.jsx';
import { ArchiveDialog, ChangeLeadDialog, OpenCaseDialog, TargetDateDialog } from './DdListDialogs.jsx';
import { Note, btnCls, cardCls, eyebrowCls, inputCls, muted, primaryCls } from './DdUi.jsx';

const STAGE_PILL = {
  not_started: 'border-gray-300 text-gray-700 dark:border-gray-600 dark:text-gray-300',
  in_review: 'border-violet-200 bg-violet-50 text-violet-700 dark:border-violet-800 dark:bg-violet-950/40 dark:text-violet-300',
  ready: 'border-amber-300 bg-amber-100 text-amber-900 dark:border-amber-700 dark:bg-amber-950/50 dark:text-amber-200',
  decided: 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300',
  archived: 'border-gray-200 bg-gray-50 text-gray-500 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400',
};
const BAND_PILL = {
  green: 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300',
  yellow: 'border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200',
  amber: 'border-orange-300 bg-orange-100 text-orange-800 dark:border-orange-700 dark:bg-orange-950/40 dark:text-orange-200',
  red: 'border-red-200 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-950/40 dark:text-red-300',
};
const SEV_PILL = {
  critical: 'bg-red-700 text-white dark:bg-red-600',
  high: 'border border-red-200 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-950/40 dark:text-red-300',
  medium: 'border border-amber-300 bg-amber-100 text-amber-900 dark:border-amber-700 dark:bg-amber-950/50 dark:text-amber-200',
  low: 'border border-gray-300 text-gray-600 dark:border-gray-600 dark:text-gray-300',
  info: 'border border-gray-300 text-gray-600 dark:border-gray-600 dark:text-gray-300',
};
const pill = 'inline-flex items-center whitespace-nowrap rounded-full border px-2 py-0.5 text-[11.5px] font-semibold';
const TONE = { bad: 'text-red-700 dark:text-red-300', warn: 'text-amber-800 dark:text-amber-300', muted: 'text-axal-muted dark:text-gray-400' };
const COLS = ['Subject', 'Type · template', 'Stage', 'Lead', 'Checklist', 'Open flags', 'Requests', 'Risk band', 'Target IC date', 'Opened', ''];

function Tile({ t }) {
  return (
    <div className={`${cardCls} px-4 py-3`} data-testid={`dd-tile-${t.key}`}>
      <div className={eyebrowCls}>{t.label}</div>
      <div className="mt-1 font-mono text-[22px] font-semibold tabular-nums text-gray-900 dark:text-gray-100">{t.value == null ? '—' : t.value.toLocaleString('en-US')}</div>
      <div className={`text-[12.5px] ${TONE[t.tone] || muted}`}>{t.sub}</div>
    </div>
  );
}

function RowMenu({ row, me, base, onPick }) {
  const [open, setOpen] = useState(false);
  const mine = canChangeCase(me, row);
  const item = 'block w-full rounded-md px-3 py-2 text-left text-[13px] text-gray-800 hover:bg-gray-50 dark:text-gray-100 dark:hover:bg-gray-800';
  return (
    <div className="relative">
      <button type="button" aria-label={`Actions for ${row.subject_label}`} aria-expanded={open} onClick={() => setOpen((v) => !v)}
        className="rounded-md p-1 text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800" data-testid={`dd-row-menu-${row.uid}`}>
        <MoreHorizontal size={16} />
      </button>
      {open ? (
        <div role="menu" className="absolute right-0 z-20 mt-1 w-56 rounded-lg border border-axal-hairline bg-white p-1 shadow-lg dark:border-gray-700 dark:bg-gray-900" data-testid={`dd-row-actions-${row.uid}`}>
          <Link role="menuitem" to={`${base}/${row.uid}`} className={`${item} font-semibold text-axal-violet dark:text-violet-300`}>Open</Link>
          {mine ? (
            <>
              <button role="menuitem" type="button" className={item} onClick={() => { setOpen(false); onPick('lead', row); }}>Change lead…</button>
              <button role="menuitem" type="button" className={item} onClick={() => { setOpen(false); onPick('target', row); }}>Set target IC date…</button>
              <div className="my-1 border-t border-axal-hairline dark:border-gray-700" />
              <button role="menuitem" type="button" className={item} onClick={() => { setOpen(false); onPick('archive', row); }}>Archive…</button>
            </>
          ) : (
            <p className={`m-0 px-3 py-2 text-[12px] ${muted}`} data-testid={`dd-row-not-yours-${row.uid}`}>{row.status === 'archived' ? 'An archived case takes no further change.' : CHANGE_REFUSED}</p>
          )}
        </div>
      ) : null}
    </div>
  );
}

function CaseRow({ row, me, base, onPick, now }) {
  const c = rowCells(row, now);
  return (
    <tr className="border-t border-axal-hairline align-top dark:border-gray-800" data-testid={`dd-row-${row.uid}`}>
      <td className="px-3 py-3">
        <Link to={`${base}/${row.uid}`} className="font-semibold text-gray-900 hover:text-axal-violet dark:text-gray-100 dark:hover:text-violet-300">{c.name}</Link>
        <div className={`font-mono text-[11px] ${muted}`}>{c.short}</div>
      </td>
      <td className="px-3 py-3 text-[13px] text-gray-800 dark:text-gray-200">{c.type}<div className={`text-[12px] ${muted}`}>{c.template}</div></td>
      <td className="px-3 py-3">
        <span className={`${pill} ${STAGE_PILL[c.stage] || STAGE_PILL.not_started}`}>{c.stageWord}</span>
        {c.decision ? <div className={`mt-1 text-[12px] ${muted}`}>{c.decision}</div> : null}
      </td>
      <td className="px-3 py-3 text-[13px] text-gray-800 dark:text-gray-200">{c.lead}</td>
      <td className="px-3 py-3">
        <div className="h-1.5 w-20 rounded-full bg-gray-100 dark:bg-gray-800"><div className="h-1.5 rounded-full bg-axal-violet dark:bg-[#a78bfa]" style={{ width: `${c.checklistPct}%` }} /></div>
        <div className="mt-1 font-mono text-[12px] text-gray-800 dark:text-gray-200">{c.checklist}</div>
      </td>
      <td className="px-3 py-3 font-mono text-[13px]">
        <span className={c.flags ? 'text-gray-900 dark:text-gray-100' : muted}>{c.flags}</span>
        {c.severity ? <span className={`ml-1.5 rounded-full px-2 py-0.5 font-sans text-[11.5px] font-semibold ${SEV_PILL[c.severityKey] || SEV_PILL.info}`}>{c.severity}</span> : null}
      </td>
      <td className={`px-3 py-3 font-mono text-[13px] ${c.requests ? 'text-gray-900 dark:text-gray-100' : muted}`}>{c.requests}</td>
      <td className="px-3 py-3"><span className={`${pill} ${BAND_PILL[c.bandKey] || 'border-dashed border-gray-300 text-gray-500 dark:border-gray-600 dark:text-gray-400'}`}>{c.band}</span></td>
      <td className="px-3 py-3 text-[12.5px]">
        <div className={`font-mono ${c.target.tone === 'muted' ? muted : 'text-gray-900 dark:text-gray-100'}`}>{c.target.day}</div>
        {c.target.sub ? <div className={`text-[12px] ${TONE[c.target.tone] || muted}`}>{c.target.sub}</div> : null}
      </td>
      <td className="whitespace-nowrap px-3 py-3 font-mono text-[12.5px] text-gray-800 dark:text-gray-200">{c.opened}</td>
      <td className="px-2 py-3"><RowMenu row={row} me={me} base={base} onPick={onPick} /></td>
    </tr>
  );
}

function FiltersPanel({ filters, me, onChange }) {
  const sel = (key, label, options) => (
    <label className="block min-w-[150px]">
      <span className={`mb-1 block text-[12px] font-semibold ${muted}`}>{label}</span>
      <select className={inputCls} value={filters[key] || ''} onChange={(e) => onChange({ ...filters, [key]: e.target.value })} aria-label={label}>
        <option value="">Any</option>
        {options.map(([v, w]) => <option key={v} value={v}>{w}</option>)}
      </select>
    </label>
  );
  return (
    <div className={`${cardCls} mb-3 flex flex-wrap items-end gap-3 p-3`} data-testid="dd-filters">
      {sel('subject_type', 'Subject type', SUBJECT_TYPES.map((t) => [t.key, t.label]))}
      {sel('risk_band', 'Risk band', [...Object.entries(BAND_WORD), ['none', 'Not scored yet']])}
      {sel('template', 'Template', [['lite', 'Lite'], ['standard', 'Standard'], ['deep', 'Deep']])}
      {sel('decision', 'Decision', [...Object.entries(DECISION_WORD), ['none', 'Not recorded']])}
      <label className="inline-flex h-9 items-center gap-2 text-[13px] text-gray-800 dark:text-gray-200">
        <input type="checkbox" checked={String(filters.lead || '') === String(me?.id)} onChange={(e) => onChange({ ...filters, lead: e.target.checked ? String(me?.id) : '' })} />
        Led by me
      </label>
      <label className="inline-flex h-9 items-center gap-2 text-[13px] text-gray-800 dark:text-gray-200">
        <input type="checkbox" checked={Boolean(filters.past_target)} onChange={(e) => onChange({ ...filters, past_target: e.target.checked ? '1' : '' })} />
        Past target IC date
      </label>
    </div>
  );
}

function Empty({ title, sub, children, testId }) {
  return (
    <div className="flex flex-col items-center gap-2.5 px-5 py-10 text-center" data-testid={testId}>
      <div className="text-[16px] font-bold text-gray-900 dark:text-gray-100">{title}</div>
      {sub ? <div className={`max-w-[520px] text-[13px] ${muted}`}>{sub}</div> : null}
      {children ? <div className="mt-1 flex gap-2">{children}</div> : null}
    </div>
  );
}

const clock = (d) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

export default function DdCasesTab({ me, now = Date.now() }) {
  const navigate = useNavigate();
  // A case link stays on the caller's base, so a member never reaches an /admin/ address.
  const { pathname } = useLocation();
  const base = pathname.startsWith('/admin') ? '/admin/due-diligence' : '/due-diligence';
  const [ov, setOv] = useState(null);
  const [list, setList] = useState(null);
  const [listState, setListState] = useState('loading');
  const [readAt, setReadAt] = useState(null);
  const [filters, setFilters] = useState({});
  const [stage, setStage] = useState('');
  const [qInput, setQInput] = useState('');
  const [q, setQ] = useState('');
  const [sort, setSort] = useState('opened');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [dialog, setDialog] = useState(null);
  const [templates, setTemplates] = useState(null);
  const { toast, success, dismissToast } = useToast();

  const loadOverview = useCallback(async () => {
    setOv(null);
    try { setOv(await ddDeskApi.overview()); } catch (e) {
      if (e?.status !== 404) reportError('DdCasesTab:overview', e);
      setOv({ failed: true, status: e?.status });
    }
  }, []);
  const query = useMemo(() => listQuery({ filters, stage, q, sort, page, pageSize }), [filters, stage, q, sort, page, pageSize]);
  const loadList = useCallback(async () => {
    setListState('loading');
    try {
      const r = await ddDeskApi.cases(query);
      setList({ items: r.items || [], total: Number(r.total ?? (r.items || []).length) });
      setListState('ok');
      setReadAt(new Date());
    } catch (e) {
      if (e?.status === 404) { setListState('unavailable'); return; }
      reportError('DdCasesTab:list', e);
      setListState('failed');
    }
  }, [query]);
  useEffect(() => { loadOverview(); }, [loadOverview]);
  useEffect(() => { loadList(); }, [loadList]);
  // A changed search reads the server from page 1; an unchanged one never moves the page.
  useEffect(() => {
    if (qInput === q) return undefined;
    const t = setTimeout(() => { setQ(qInput); setPage(1); }, 250);
    return () => clearTimeout(t);
  }, [qInput, q]);

  const refresh = () => { loadOverview(); loadList(); };
  const setF = (next) => { setFilters(next); setPage(1); };
  const clearAll = () => { setFilters({}); setStage(''); setQInput(''); setQ(''); setPage(1); };
  const chips = filterChips(filters, me);
  const narrowed = chips.length > 0 || Boolean(stage) || Boolean(q.trim());
  const openDialog = async () => {
    setDialog({ kind: 'open' });
    if (!templates || templates.failed) {
      try { setTemplates(await ddDeskApi.templates()); } catch { setTemplates({ failed: true }); }
    }
  };
  const done = (msg) => { setDialog(null); success(msg); refresh(); };
  const pages = pageCount(list?.total ?? 0, pageSize);
  const shown = list?.items.length ?? 0;
  const age = ov && !ov.failed ? ageChart(ov.ages) : null;
  const dec = ov && !ov.failed ? decisionsChart(ov.decisions) : null;
  const chartState = (c, block) => (!ov ? 'loading' : (ov.failed || block?.available === false || !c ? 'failed' : 'ok'));

  return (
    <div data-testid="dd-cases">
      <div className="mb-4 flex flex-wrap items-center justify-end gap-2">
        {canOpenCase(me?.role)
          ? <button type="button" className={primaryCls} onClick={openDialog} data-testid="dd-open-case"><Plus size={14} />Open a case</button>
          : <Note testId="dd-advisor-note">{ADVISOR_NOTE}</Note>}
      </div>

      {listState === 'unavailable' ? (
        <Note tone="warn" testId="dd-unavailable">Due diligence cases are kept by the production Worker and cannot be read in this development environment.</Note>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" data-testid="dd-tiles">
            {overviewTiles(ov).map((t) => <Tile key={t.key} t={t} />)}
          </div>
          {ov?.failed ? (
            <div className="mt-2 flex items-center gap-2 text-[12.5px]" data-testid="dd-overview-failed">
              <span className={muted}>The figures could not be read. The cases below still read.</span>
              <button type="button" onClick={loadOverview} className="font-semibold text-axal-violet hover:underline dark:text-violet-300">Try again</button>
            </div>
          ) : null}

          <div className="mt-3.5 grid gap-3.5 lg:grid-cols-2">
            <ChartCard title="Open cases by age" chart={age} state={chartState(age, ov?.ages)} onRetry={loadOverview} testId="dd-chart-age" />
            <ChartCard title="Decisions, last 12 months" chart={dec} state={chartState(dec, ov?.decisions)} onRetry={loadOverview} testId="dd-chart-decisions" />
          </div>

          <div role="group" aria-label="Filter by stage" className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-5" data-testid="dd-stage-strip">
            {stageStrip(ov).map((s) => {
              const on = stage === s.key;
              return (
                <button key={s.key} type="button" aria-pressed={on} onClick={() => { setStage(on ? '' : s.key); setPage(1); }} data-testid={`dd-stage-${s.key}`}
                  className={`rounded-xl border px-3.5 py-2.5 text-left ${on ? 'border-violet-300 bg-violet-50 dark:border-violet-700 dark:bg-violet-950/40' : 'border-axal-hairline bg-white hover:bg-gray-50 dark:border-gray-800 dark:bg-gray-900 dark:hover:bg-gray-800'}`}>
                  <span className={`block text-[12.5px] font-semibold ${on ? 'text-violet-800 dark:text-violet-200' : muted}`}>{s.label}</span>
                  <span className="block font-mono text-[20px] font-semibold text-gray-900 dark:text-gray-100">{s.n == null ? '—' : s.n}</span>
                  {s.sub ? <span className={`block text-[11.5px] ${muted}`}>{s.sub}</span> : null}
                </button>
              );
            })}
          </div>

          <div className="my-3 flex flex-wrap items-center gap-2.5" data-testid="dd-toolbar">
            <label className="relative w-full max-w-xs">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <span className="sr-only">Search cases</span>
              <input value={qInput} onChange={(e) => setQInput(e.target.value)} placeholder="Subject or case ID" className={`${inputCls} pl-8`} data-testid="dd-search" />
            </label>
            <button type="button" className={btnCls} aria-expanded={filtersOpen} onClick={() => setFiltersOpen((v) => !v)} data-testid="dd-filters-toggle">
              <SlidersHorizontal size={14} />Filters{chips.length ? <span className="rounded-full bg-violet-100 px-1.5 text-[11px] text-violet-800 dark:bg-violet-900/50 dark:text-violet-200">{chips.length}</span> : null}
            </button>
            <label className="inline-flex items-center gap-1.5">
              <span className="sr-only">Sort</span>
              <select className={`${inputCls} h-9 w-auto py-0`} value={sort} onChange={(e) => { setSort(e.target.value); setPage(1); }} aria-label="Sort" data-testid="dd-sort">
                {SORTS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
              </select>
            </label>
            <div className="ml-auto flex flex-wrap items-center gap-3 text-[12.5px]">
              {readAt ? <span className={muted}>Read at <span className="font-mono">{clock(readAt)}</span> · <button type="button" onClick={refresh} className="font-semibold text-axal-violet hover:underline dark:text-violet-300"><RefreshCw size={11} className="mr-0.5 inline" />Refresh</button></span> : null}
              {list ? <span className="font-mono text-gray-900 dark:text-gray-100" data-testid="dd-range">{rangeText(page, pageSize, shown, list.total)}</span> : null}
              <span className="inline-flex gap-1">
                <button type="button" className={`${btnCls} h-8 px-2`} aria-label="Previous page" onClick={() => setPage((p) => Math.max(1, p - 1))}>‹</button>
                <span className="inline-grid h-8 min-w-[32px] place-items-center rounded-lg border border-violet-200 bg-violet-50 font-mono text-[12px] font-bold text-violet-800 dark:border-violet-800 dark:bg-violet-950/40 dark:text-violet-200" data-testid="dd-page">{page}</span>
                <button type="button" className={`${btnCls} h-8 px-2`} aria-label="Next page" onClick={() => setPage((p) => Math.min(pages, p + 1))} data-testid="dd-next">›</button>
              </span>
            </div>
          </div>
          {filtersOpen ? <FiltersPanel filters={filters} me={me} onChange={setF} /> : null}
          {chips.length ? (
            <div className="mb-3 flex flex-wrap items-center gap-2" data-testid="dd-chips">
              {chips.map((c) => (
                <span key={c.key} className="inline-flex h-7 items-center gap-1 rounded-full border border-axal-hairline bg-white pl-3 pr-1.5 text-[12.5px] font-semibold text-gray-800 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100">
                  {c.label}
                  <button type="button" aria-label={`Remove ${c.label}`} onClick={() => setF({ ...filters, [c.key]: '' })} className="rounded-full p-0.5 hover:bg-gray-100 dark:hover:bg-gray-800"><X size={12} /></button>
                </span>
              ))}
              <button type="button" onClick={clearAll} className="text-[12.5px] font-semibold text-axal-violet hover:underline dark:text-violet-300">Clear all</button>
            </div>
          ) : null}

          <div className={`${cardCls} overflow-x-auto`}>
            {listState === 'failed' ? (
              <Empty title={LIST_FAILED} sub={LIST_FAILED_SUB} testId="dd-list-failed">
                <button type="button" className={btnCls} onClick={loadList}><RefreshCw size={14} />Try again</button>
              </Empty>
            ) : listState === 'ok' && !shown && !narrowed ? (
              <Empty title="No diligence cases yet." sub="Open one when a deal, a founder or a partner needs checking." testId="dd-empty">
                {canOpenCase(me?.role) ? <button type="button" className={btnCls} onClick={openDialog}><Plus size={14} />Open a case</button> : null}
              </Empty>
            ) : listState === 'ok' && !shown ? (
              <Empty title="No cases match these filters." sub={noMatchText({ filters, stage, q }, me)} testId="dd-no-match">
                <button type="button" className={btnCls} onClick={clearAll}>Clear filters</button>
              </Empty>
            ) : (
              <table className="w-full min-w-[1080px] border-collapse text-left">
                <thead>
                  <tr className="bg-[#faf9fc] dark:bg-gray-800/60">
                    {COLS.map((h, i) => <th key={h || i} scope="col" className={`px-3 py-2.5 ${eyebrowCls}`}>{h}</th>)}
                  </tr>
                </thead>
                <tbody data-testid="dd-rows">
                  {listState === 'loading'
                    ? [0, 1, 2, 3, 4].map((i) => (
                      <tr key={i} className="border-t border-axal-hairline dark:border-gray-800" data-testid="dd-row-skeleton">
                        {COLS.map((_, j) => <td key={j} className="px-3 py-4"><span className="block h-2.5 w-16 rounded bg-gray-100 dark:bg-gray-800" /></td>)}
                      </tr>
                    ))
                    : list.items.map((r) => <CaseRow key={r.uid} row={r} me={me} base={base} now={now} onPick={(kind, row) => setDialog({ kind, row })} />)}
                </tbody>
              </table>
            )}
            {listState === 'ok' && shown ? (
              <div className="flex items-center justify-between border-t border-axal-hairline px-4 py-3 text-[12.5px] dark:border-gray-800">
                <span className={muted}>
                  Rows per page{' '}
                  {PAGE_SIZES.map((n, i) => (
                    <React.Fragment key={n}>
                      {i ? ' · ' : ''}
                      <button type="button" aria-pressed={pageSize === n} onClick={() => { setPageSize(n); setPage(1); }}
                        className={pageSize === n ? 'font-mono font-bold text-gray-900 dark:text-gray-100' : 'hover:underline'}>{n}</button>
                    </React.Fragment>
                  ))}
                </span>
                <span className="font-mono text-gray-900 dark:text-gray-100">{rangeText(page, pageSize, shown, list.total)}</span>
              </div>
            ) : null}
          </div>
        </>
      )}

      {dialog?.kind === 'open' ? (
        <OpenCaseDialog me={me} templates={templates} onClose={() => setDialog(null)}
          onOpened={(made) => { setDialog(null); navigate(`${base}/${made.uid}`); }} />
      ) : null}
      {dialog?.kind === 'lead' ? <ChangeLeadDialog row={dialog.row} me={me} onClose={() => setDialog(null)} onDone={done} /> : null}
      {dialog?.kind === 'target' ? <TargetDateDialog row={dialog.row} onClose={() => setDialog(null)} onDone={done} /> : null}
      {dialog?.kind === 'archive' ? <ArchiveDialog row={dialog.row} onClose={() => setDialog(null)} onDone={done} /> : null}
      <ToastMessage toast={toast} onDismiss={dismissToast} />
    </div>
  );
}

