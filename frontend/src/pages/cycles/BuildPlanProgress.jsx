import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Lightbox, Unreadable, actionGhost } from '../../ui';
import Sheet from '../../ui/Sheet.jsx';
import { buildPlanApi } from '../../lib/api/buildPlan';
import {
  BACK_IN_FOOT, BUCKETS, BUILT_UNREAD, CHART_FOOT, MODULE_FILTERS, NOT_RECORDED_FOOT, PER_PAGE, PROGRESS_FILTERS, SORTS, STAGES, STAGE_FILTERS, STAGE_WORD,
  TOOL_FILTERS, TRAIL_FOOT, asOfLine, builtPerWeek, chartLabel, filterRows, pageRows, phoneStatus, progressRows, stageChart, stageLead, trailNodes, trailTable,
  waitingLinks, weekLine,
} from './buildProgressModel';
import { ventureSearch } from './buildPlanModel';

/**
 * D1070 (#2940) — the plan's Progress tab: VB10 (founder), VB12 (dark),
 * VB15 (an Operating Partner: accepted items only, no actions), VB16 (an
 * admin: read only) and VB22 (phone), with VB9's Back in drawer and VB11's
 * evidence trail.
 *
 * Three reads, each answering alone (`buildProgressModel.js` says what each
 * stage is read from): the plan (D1065), the sends (D1068 `/handoffs`) and
 * the links (D1068 `/links`). Only the plan's read can blank the page. A
 * failed sends or links read makes its stage "Not recorded", with the reason,
 * and says so above the chart.
 */

const CARD = 'flex min-w-0 flex-col gap-2.5 rounded-xl border border-axal-hairline bg-white px-[18px] py-4 dark:border-gray-800 dark:bg-gray-900';
const H2 = 'm-0 text-[15px] font-extrabold tracking-[-.015em] text-axal-ink dark:text-gray-100';
const MUTED = 'm-0 text-[12.5px] leading-[1.5] text-axal-muted dark:text-gray-400';
const EYE = 'text-[10.5px] font-extrabold uppercase tracking-[.07em] text-axal-muted dark:text-gray-400';
const FIELD = 'h-9 rounded-[7px] border border-axal-hairline bg-white px-2 text-[12.5px] text-axal-ink dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100';
const BTN = 'inline-flex min-h-[32px] items-center justify-center rounded-lg border border-axal-hairline bg-white px-3 text-[12px] font-bold text-axal-ink hover:bg-axal-ground disabled:opacity-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800';
const BTN_P = 'inline-flex min-h-[32px] items-center justify-center rounded-lg bg-axal-violet px-3 text-[12px] font-bold text-white hover:bg-axal-violet-deep disabled:opacity-50 dark:bg-violet-600 dark:hover:bg-violet-500';
const MONO = 'font-mono tabular-nums';

/** Each bucket's colour; Not recorded is a dashed outline, never a fill (VB10, VB12). */
const FILL = {
  accepted: 'bg-axal-violet dark:bg-violet-400',
  sent: 'bg-sky-500',
  progress: 'bg-amber-500',
  built: 'bg-emerald-500',
  notstarted: 'bg-[#6b6577]',
  unrecorded: 'border border-dashed border-axal-muted bg-transparent dark:border-gray-400',
};
const DOT = {
  done: { accepted: 'bg-axal-violet dark:bg-violet-400', sent: 'bg-sky-500', progress: 'bg-amber-500', built: 'bg-emerald-500', live: 'bg-emerald-500', tested: 'bg-emerald-500' },
  notyet: 'border-2 border-axal-muted bg-transparent dark:border-gray-500',
  na: 'bg-axal-hairline dark:bg-gray-700',
  unrecorded: 'border-[1.5px] border-dashed border-axal-muted bg-transparent dark:border-gray-400',
};
const dotClass = (stage, cell) => `inline-block h-3 w-3 shrink-0 rounded-full ${cell.state === 'done' ? DOT.done[stage] : DOT[cell.state]}`;

/** D968: every page of the states read, up to ten; one failed page fails the read (null), never a short list. */
export const STATES_PAGE = 500;
export async function readAllStates(projectId, scope, client = buildPlanApi) {
  let out = [];
  for (let page = 0; page < 10; page += 1) {
    const r = await client.states(projectId, scope, { limit: STATES_PAGE, offset: page * STATES_PAGE });
    const got = Array.isArray(r?.states) ? r.states : [];
    out = out.concat(got);
    if (!got.length || out.length >= Number(r?.total || 0)) break;
  }
  return out;
}

/** The four reads; the sends, links and states answer alone, and null means that read failed. */
function useProgress(projectId, scope) {
  const [state, setState] = useState({ status: 'loading', plan: null, handoffs: null, links: null, states: null });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!projectId) return undefined;
    let alive = true;
    Promise.allSettled([buildPlanApi.read(projectId, scope), buildPlanApi.handoffs(projectId, scope), buildPlanApi.links(projectId, scope), readAllStates(projectId, scope)]).then(([p, h, l, st]) => {
      if (!alive) return;
      if (p.status === 'rejected') {
        setState({ status: Number(p.reason?.status) === 404 ? 'refused' : 'unreadable', plan: null, handoffs: null, links: null, states: null });
        return;
      }
      setState({
        status: 'ready', plan: p.value,
        handoffs: h.status === 'fulfilled' ? h.value?.handoffs || [] : null,
        links: l.status === 'fulfilled' ? l.value?.links || [] : null,
        states: st.status === 'fulfilled' ? st.value : null,
      });
    });
    return () => { alive = false; };
  }, [projectId, scope, tick]);
  const reload = useCallback(() => setTick((n) => n + 1), []);
  return { ...state, reload };
}

/** VB10's stacked bars, one row per module; Not recorded drawn dashed. */
function StageChart({ chart, phone }) {
  const max = Math.max(1, ...chart.map((m) => m.total));
  return (
    <div className="flex flex-col gap-2" role="img" aria-label={chartLabel(chart)} data-testid="plan-progress-chart">
      {chart.map((m) => (
        <div key={m.module} className="flex items-center gap-2" data-testid={`plan-progress-bar-${m.module}`}>
          <span className={`${phone ? 'w-[112px]' : 'w-[150px]'} shrink-0 text-[12px] font-semibold text-axal-ink dark:text-gray-100`}>{m.label}</span>
          <div className="flex h-4 min-w-0 flex-1 gap-[2px]">
            {BUCKETS.filter((b) => m.counts[b.id]).map((b) => (
              <span key={b.id} title={`${m.label} · ${b.label} · ${m.counts[b.id]}`} className={`h-4 rounded-[3px] ${FILL[b.id]}`}
                style={{ width: `${(m.counts[b.id] / max) * 100}%` }} data-testid={`plan-progress-seg-${m.module}-${b.id}`} />
            ))}
          </div>
          <span className={`${MONO} w-[110px] shrink-0 text-right text-[11.5px] text-axal-muted dark:text-gray-400`}>
            {phone ? m.total : `${m.total} ${m.total === 1 ? 'item' : 'items'}${m.unrecorded ? ` · ${m.unrecorded} not recorded` : ''}`}
          </span>
        </div>
      ))}
    </div>
  );
}

function Legend() {
  return (
    <ul className="m-0 flex list-none flex-wrap gap-x-3 gap-y-1 p-0" data-testid="plan-progress-legend">
      {BUCKETS.map((b) => (
        <li key={b.id} className="flex items-center gap-1.5 text-[11.5px] text-axal-muted dark:text-gray-400">
          <span className={`inline-block h-2.5 w-3.5 rounded-[2px] ${FILL[b.id]}`} aria-hidden="true" />{b.label}
        </li>
      ))}
    </ul>
  );
}

/** One stage cell: its dot and value, and the source under it (VB10's cell grammar). */
function Cell({ stage, cell }) {
  if (cell.state === 'na') return <span className={MUTED}>Does not apply</span>;
  if (cell.state === 'notyet') {
    return <span className={`flex items-center gap-1.5 ${MONO} text-[12px] text-axal-muted dark:text-gray-400`}><span className={dotClass(stage, cell)} />Not yet</span>;
  }
  if (cell.state === 'unrecorded') {
    return (
      <span className="flex flex-col gap-0.5">
        <span className="w-fit rounded-full border border-dashed border-axal-muted px-2 py-px text-[11px] font-semibold text-axal-muted dark:border-gray-500 dark:text-gray-400">Not recorded</span>
        {cell.source ? <span className="text-[11px] text-axal-muted dark:text-gray-400">{cell.source}</span> : null}
      </span>
    );
  }
  return (
    <span className="flex flex-col gap-0.5">
      <span className={`flex items-center gap-1.5 ${MONO} text-[12px] text-axal-ink dark:text-gray-100`}><span className={dotClass(stage, cell)} />{cell.text}</span>
      <span className="text-[11px] text-axal-muted dark:text-gray-400">{cell.source}</span>
      {cell.note ? <span className="text-[11px] text-axal-muted dark:text-gray-400" data-testid="plan-progress-cell-note">{cell.note}</span> : null}
    </span>
  );
}

/** VB10's table: search, Module, Stage and Tool, the sort, and pages of 25. */
function ItemsTable({ rows, onOpen }) {
  const [f, setF] = useState(PROGRESS_FILTERS);
  const [sort, setSort] = useState('last');
  const [page, setPage] = useState(1);
  const shown = useMemo(() => filterRows(rows, f, sort), [rows, f, sort]);
  const view = pageRows(shown, page, PER_PAGE);
  const set = (k, v) => { setF((x) => ({ ...x, [k]: v })); setPage(1); };
  const pick = (k, label, options) => (
    <label className="flex items-center gap-1.5 text-[12px] text-axal-muted dark:text-gray-400">
      <span className="sr-only">{label}</span>
      <select value={f[k]} onChange={(e) => set(k, e.target.value)} className={FIELD} data-testid={`plan-progress-filter-${k}`}>
        <option value="">{label}</option>
        {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </label>
  );
  return (
    <section className={CARD} aria-labelledby="plan-progress-items" data-testid="plan-progress-table">
      <h2 id="plan-progress-items" className={H2}>Accepted items</h2>
      <div className="flex flex-wrap items-center gap-2">
        <input type="search" value={f.q} onChange={(e) => set('q', e.target.value)} placeholder="Search items" aria-label="Search items" className={`${FIELD} w-full max-w-[240px]`} data-testid="plan-progress-search" />
        {pick('module', 'Module', MODULE_FILTERS)}
        {pick('stage', 'Stage', STAGE_FILTERS)}
        {pick('tool', 'Tool', TOOL_FILTERS)}
        <label className="flex items-center gap-1.5 text-[12px] text-axal-muted dark:text-gray-400">
          Sort
          <select value={sort} onChange={(e) => { setSort(e.target.value); setPage(1); }} className={FIELD} data-testid="plan-progress-sort">
            {SORTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </label>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[1060px] border-collapse text-left text-[12.5px]">
          <thead>
            <tr className={EYE}>
              {['Item', 'Module', ...STAGES.map((s) => STAGE_WORD[s])].map((h) => <th key={h} scope="col" className="py-1.5 pr-3 font-extrabold">{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {view.rows.map((r) => (
              <tr key={r.uid} className="border-t border-axal-hairline align-top dark:border-gray-800" data-testid="plan-progress-row">
                <td className="py-2 pr-3">
                  <button type="button" onClick={() => onOpen(r)} className="text-left font-bold text-axal-ink hover:text-axal-violet dark:text-gray-100 dark:hover:text-violet-300" data-testid={`plan-progress-open-${r.uid}`}>{r.title}</button>
                  <span className="block text-[11px] text-axal-muted dark:text-gray-400">{r.kindWord}</span>
                </td>
                <td className="py-2 pr-3 text-axal-ink dark:text-gray-100">{r.moduleWord}</td>
                {STAGES.map((s) => <td key={s} className="py-2 pr-3" data-testid={`plan-progress-cell-${s}`}><Cell stage={s} cell={r.stages[s]} /></td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!shown.length ? <p className={MUTED} data-testid="plan-progress-none">{rows.length ? 'No item matches the search and filters.' : 'No item is accepted yet.'}</p> : null}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className={`${MONO} text-[12px] text-axal-muted dark:text-gray-400`} data-testid="plan-progress-range">{view.range}</span>
        <span className="flex items-center gap-1.5">
          <button type="button" aria-label="Previous page" className={BTN} disabled={view.page <= 1} onClick={() => setPage(view.page - 1)}>‹</button>
          <span className={`${MONO} text-[12px] text-axal-muted dark:text-gray-400`}>{view.page} of {view.pages}</span>
          <button type="button" aria-label="Next page" className={BTN} disabled={view.page >= view.pages} onClick={() => setPage(view.page + 1)}>›</button>
        </span>
      </div>
      <p className={MUTED}>{NOT_RECORDED_FOOT}</p>
    </section>
  );
}

/**
 * VB10's "Built per week", from each item's Built day (D968). With no source
 * reporting Built, it stays the dashed not-recorded line; an item built on a
 * day its row does not store is counted under the bars, never in a week.
 */
function BuiltPerWeek({ series }) {
  return (
    <section className={CARD} aria-labelledby="plan-progress-week" data-testid="plan-progress-week">
      <h2 id="plan-progress-week" className={H2}>Built per week</h2>
      <ul className="m-0 flex list-none flex-wrap gap-3 p-0 text-[11.5px] text-axal-muted dark:text-gray-400">
        <li className="flex items-center gap-1.5"><span aria-hidden="true" className="inline-block h-2.5 w-3.5 rounded-[2px] bg-axal-violet dark:bg-violet-400" />Since the plan began</li>
        <li className="flex items-center gap-1.5"><span aria-hidden="true" className="inline-block w-4 border-t-2 border-dashed border-axal-muted dark:border-gray-400" />Not recorded</li>
      </ul>
      {!series.reported ? (
        <>
          <div role="img" aria-label={BUILT_UNREAD} className="flex h-[96px] items-end border-b border-axal-hairline pb-2 dark:border-gray-800" data-testid="plan-progress-week-chart">
            <span className="w-full border-t-2 border-dashed border-axal-muted dark:border-gray-400" />
          </div>
          <p className={MUTED} data-testid="plan-progress-week-unread">{BUILT_UNREAD}</p>
        </>
      ) : (
        <>
          <div role="img" aria-label={weekLine(series)} className="flex h-[96px] items-end gap-1 border-b border-axal-hairline pb-0 dark:border-gray-800" data-testid="plan-progress-week-bars">
            {series.weeks.map((w) => (
              <span key={w.week} className="flex h-full min-w-0 flex-1 flex-col justify-end" title={`${w.label}${w.current ? ' (to date)' : ''}: ${w.n}`} data-testid={`plan-progress-week-${w.week}`}>
                <span className={`block w-full rounded-t-[2px] ${w.current ? 'bg-axal-violet/60 dark:bg-violet-400/60' : 'bg-axal-violet dark:bg-violet-400'}`} style={{ height: `${(w.n / series.max) * 100}%`, minHeight: w.n ? 3 : 0 }} />
              </span>
            ))}
          </div>
          <p className={MUTED} data-testid="plan-progress-week-line">{weekLine(series)}</p>
        </>
      )}
    </section>
  );
}

/** VB22a: one card per item with its six stages as dots, five at a time. */
function PhoneItems({ rows, onOpen }) {
  const [n, setN] = useState(5);
  return (
    <div className="flex flex-col gap-2.5" data-testid="plan-progress-phone">
      {rows.slice(0, n).map((r) => (
        <button key={r.uid} type="button" onClick={() => onOpen(r)} className={`${CARD} min-h-[44px] !gap-1.5 text-left hover:bg-axal-ground dark:hover:bg-gray-800`} data-testid="plan-progress-card">
          <span className={EYE}>{r.moduleWord}</span>
          <span className="text-[14px] font-bold text-axal-ink dark:text-gray-100">{r.title}</span>
          <span className={`${MONO} text-[12px] text-axal-muted dark:text-gray-400`}>{phoneStatus(r)}</span>
          <span className="flex gap-1.5" aria-label={STAGES.map((s) => `${STAGE_WORD[s]}: ${r.stages[s].text}`).join('; ')}>
            {STAGES.map((s) => <span key={s} className={dotClass(s, r.stages[s])} />)}
          </span>
        </button>
      ))}
      <p className={`${MONO} m-0 text-[12px] text-axal-muted dark:text-gray-400`}>
        {rows.length ? `1–${Math.min(n, rows.length)} of ${rows.length}` : '0 of 0'}
        {n < rows.length ? <button type="button" className="ml-2 min-h-[44px] font-bold text-axal-violet hover:text-axal-violet-deep dark:text-violet-300 dark:hover:text-violet-200" onClick={() => setN((x) => x + 5)} data-testid="plan-progress-more">· Show more</button> : null}
      </p>
    </div>
  );
}

/** VB11: one item's evidence trail, read from D1066's `GET /evidence` with the sends and links. */
export function ItemTrail({ projectId, row, handoffs, links, onClose, search = '' }) {
  const where = trailTable(row);
  const [state, setState] = useState({ status: where ? 'loading' : 'ready', trail: null });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!where) return undefined;
    let alive = true;
    setState({ status: 'loading', trail: null });
    buildPlanApi.evidence(projectId, where.table, where.id)
      .then((trail) => { if (alive) setState({ status: 'ready', trail }); })
      .catch(() => { if (alive) setState({ status: 'unreadable', trail: null }); });
    return () => { alive = false; };
  }, [projectId, where?.table, where?.id, tick]); // eslint-disable-line react-hooks/exhaustive-deps
  const nodes = state.status === 'ready' ? trailNodes(row, state.trail, handoffs, links) : [];
  return (
    <Sheet label={row.title} title={row.title} sub={`Plan item${row.marker ? ` · ${row.marker}` : ''}`} onClose={onClose} width={600} testId="plan-trail">
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap gap-1.5">
          {[row.kindWord, row.moduleWord].map((p) => <span key={p} className="rounded-full border border-axal-hairline px-2 py-0.5 text-[11px] font-semibold text-axal-ink dark:border-gray-700 dark:text-gray-100">{p}</span>)}
          <span className="rounded-full border border-emerald-300 px-2 py-0.5 text-[11px] font-semibold text-emerald-800 dark:border-emerald-800 dark:text-emerald-300">✓ Accepted</span>
        </div>
        <span className={EYE}>Evidence trail</span>
        {state.status === 'loading' ? <p className={MUTED} aria-busy="true">Reading…</p> : null}
        {state.status === 'unreadable' ? <Unreadable what="The evidence trail" claim="This is not a claim that it is empty." onRetry={() => setTick((n) => n + 1)} /> : null}
        {nodes.length ? (
          <ol className="m-0 flex list-none flex-col gap-0 p-0" data-testid="plan-trail-nodes">
            {nodes.map((n) => (
              <li key={n.key} className={`relative flex flex-col gap-0.5 border-l-2 pb-3 pl-4 ${n.tone === 'missing' ? 'border-dashed border-axal-muted dark:border-gray-500' : 'border-axal-hairline dark:border-gray-700'}`} data-testid={`plan-trail-node-${n.tone}`}>
                <span aria-hidden="true" className={`absolute -left-[8px] top-0.5 h-3.5 w-3.5 rounded-full ${{
                  evidence: 'bg-amber-500', you: 'bg-axal-violet dark:bg-violet-400', tool: 'bg-emerald-500',
                  missing: 'border-[1.5px] border-dashed border-axal-muted bg-white dark:border-gray-400 dark:bg-gray-900',
                }[n.tone]}`} />
                <span className={`text-[13px] font-bold ${n.tone === 'missing' ? 'text-axal-muted dark:text-gray-400' : 'text-axal-ink dark:text-gray-100'}`}>{n.text}</span>
                <span className={`${MONO} text-[11px] text-axal-muted dark:text-gray-400`}>{n.sub}</span>
              </li>
            ))}
          </ol>
        ) : null}
        <Link to={`/raise${ventureSearch(search)}`} className={`${actionGhost} w-fit`}>See how Raise uses it</Link>
        <p className={MUTED}>{TRAIL_FOOT}</p>
      </div>
    </Sheet>
  );
}

/** VB9: what arrived from the founder's tools, each waiting for Link or Not this one. */
function BackIn({ projectId, scope, rows, onClose, onDone }) {
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState({});
  const [decided, setDecided] = useState({});
  const act = async (uid, run, word) => {
    setBusy(uid); setError((e) => ({ ...e, [uid]: '' }));
    try { await run(); setDecided((d) => ({ ...d, [uid]: word })); onDone(); } catch (e) {
      setError((x) => ({ ...x, [uid]: e?.data?.message || e?.data?.detail || e?.message || 'It was not saved. Try again.' }));
    } finally { setBusy(null); }
  };
  return (
    <Lightbox label="Back in" title={`Arrived from your tools · ${rows.length}`} sub="Back in" onClose={onClose} width={660} testId="plan-back-in"
      footer={<div className="flex flex-wrap items-center justify-between gap-2"><span className={MUTED}>{BACK_IN_FOOT}</span><button type="button" className={actionGhost} onClick={onClose}>Close</button></div>}>
      <ul className="m-0 flex list-none flex-col gap-2.5 p-0">
        {rows.map((r) => (
          <li key={r.uid} className="flex flex-col gap-1.5 rounded-[10px] border border-axal-hairline p-3 dark:border-gray-700" data-testid="plan-back-in-row">
            <span className="w-fit rounded-full border border-axal-lavender-edge bg-axal-lavender px-2 py-px text-[11px] font-bold text-axal-violet-deep dark:border-violet-800 dark:bg-violet-900/30 dark:text-violet-300">{r.source}</span>
            <span className="text-[13px] font-semibold text-axal-ink dark:text-gray-100">{r.line}</span>
            <span className={MUTED}>{r.ask}</span>
            {decided[r.uid] ? <span className="text-[12.5px] font-semibold text-emerald-800 dark:text-emerald-300" role="status" data-testid="plan-back-in-done">{decided[r.uid]}</span> : (
              <span className="flex flex-wrap gap-2">
                <button type="button" className={BTN_P} disabled={busy === r.uid} onClick={() => act(r.uid, () => buildPlanApi.acceptLink(projectId, r.uid, scope), 'Linked.')} data-testid="plan-back-in-link">Link</button>
                <button type="button" className={BTN} disabled={busy === r.uid} onClick={() => act(r.uid, () => buildPlanApi.dismissLink(projectId, r.uid, scope), 'Not linked. It lands as its own item on the next sync and is never proposed again.')} data-testid="plan-back-in-dismiss">Not this one</button>
              </span>
            )}
            {error[r.uid] ? <span role="alert" className="text-[12.5px] text-red-700 dark:text-red-300" data-testid="plan-back-in-refused">{error[r.uid]}</span> : null}
          </li>
        ))}
      </ul>
    </Lightbox>
  );
}

/**
 * The Progress body. `actions` is the founder's: Back in's decisions. An
 * admin (VB16) and an Operating Partner (VB15) read it with none; the Worker
 * already gives a partner accepted items and links only.
 */
export default function PlanProgress({ projectId, scope = 'venture', search = '', phone = false, actions = true, nowIso = new Date().toISOString() }) {
  const p = useProgress(projectId, scope);
  const [open, setOpen] = useState(null);
  const [backIn, setBackIn] = useState(false);
  const rows = useMemo(() => (p.status === 'ready' ? progressRows(p.plan, p.handoffs, p.links, p.states) : []), [p.status, p.plan, p.handoffs, p.links, p.states]);
  const weeks = useMemo(() => builtPerWeek(rows, nowIso), [rows, nowIso]);
  const chart = useMemo(() => stageChart(rows), [rows]);
  const waiting = p.status === 'ready' && actions ? waitingLinks(p.links, p.plan) : [];

  if (p.status === 'loading') {
    return <section className={CARD} aria-busy="true" data-testid="plan-progress-loading"><span className={`${MONO} text-[12px] text-axal-muted dark:text-gray-400`}>Reading…</span></section>;
  }
  if (p.status === 'unreadable' || p.status === 'refused') {
    return <Unreadable what="The plan" claim="This is not a claim that nothing is in progress." onRetry={p.reload} />;
  }
  const tools = [...new Set(rows.flatMap((r) => r.tools))];
  return (
    <div className="flex min-w-0 flex-col gap-[14px]" data-testid="plan-progress">
      {!phone ? <p className={`${MONO} m-0 text-[12px] text-axal-muted dark:text-gray-400`} data-testid="plan-progress-asof">{asOfLine(nowIso, tools)}</p> : null}
      {p.handoffs == null ? <Unreadable what="Your sends" claim="This is not a claim that nothing was sent. Sent shows as not recorded." onRetry={p.reload} /> : null}
      {p.links == null ? <Unreadable what="What came back from your tools" claim="This is not a claim that nothing came back. In progress shows as not recorded." onRetry={p.reload} /> : null}
      {p.states == null ? <Unreadable what="Built, live and tested" claim="This is not a claim that nothing was built. Those stages show as not recorded." onRetry={p.reload} /> : null}
      {waiting.length ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-axal-lavender-edge bg-axal-lavender px-3.5 py-3 text-[13px] font-semibold text-axal-ink dark:border-violet-800 dark:bg-violet-900/30 dark:text-gray-100" data-testid="plan-back-in-door">
          <span>Arrived from your tools · {waiting.length}. Nothing is linked until you press Link.</span>
          <button type="button" className={BTN_P} onClick={() => setBackIn(true)} data-testid="plan-back-in-open">Review</button>
        </div>
      ) : null}
      <div className={`grid min-w-0 grid-cols-1 gap-[14px] ${phone ? '' : 'lg:grid-cols-3'}`}>
        <section className={`${CARD} ${phone ? '' : 'lg:col-span-2'}`} aria-labelledby="plan-progress-stage" data-testid="plan-progress-stages">
          <h2 id="plan-progress-stage" className={H2}>Plan items by stage</h2>
          <p className="m-0 text-[13px] font-semibold text-axal-ink dark:text-gray-100" data-testid="plan-progress-lead">{stageLead(rows)}</p>
          <Legend />
          {chart.length ? <StageChart chart={chart} phone={phone} /> : null}
          <p className={MUTED}>{CHART_FOOT}</p>
        </section>
        {!phone ? <BuiltPerWeek series={weeks} /> : null}
      </div>
      {phone ? <PhoneItems rows={filterRows(rows)} onOpen={setOpen} /> : <ItemsTable rows={rows} onOpen={setOpen} />}
      {open ? <ItemTrail projectId={projectId} row={open} handoffs={p.handoffs} links={p.links} search={search} onClose={() => setOpen(null)} /> : null}
      {backIn ? <BackIn projectId={projectId} scope={scope} rows={waiting} onClose={() => setBackIn(false)} onDone={p.reload} /> : null}
    </div>
  );
}
