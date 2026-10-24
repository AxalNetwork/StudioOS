import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { RefreshCw } from 'lucide-react';
import { api } from '../../../lib/api';
import { reportError } from '../../../lib/log';
import { isSuperAdminUser } from '../../../lib/shellRole';
import { useAuth } from '../../../hooks/useAuthSync';
import { Lightbox, PhoneSheet, RailFrame, WorkerRail, openEadwynPanel, usePhoneWidth } from '../../../ui';
import { Chart, ChartTable, Legend } from './InsightsCharts';
import {
  DEFINITIONS, EMPTY_LINE, FILTER_WAITS, MOVED_KEY, MOVED_NOTICE, NO_PERMISSION, NO_PERMISSION_FILTER,
  PAGE_UNREADABLE, PROFILE_FILTERS, RANGES, SCOPE_LABEL, SCOPE_NOTE, SCOPE_TITLE, SOURCE_LINE,
  asOfLabel, buildBlocks, buildGroup, buildKpis, figuresCsv, groupFromSearch, isEmptyStudio, lastTwoWeeks,
  pageFailed, rangeLine, scopeState,
} from './insightsModel';

/**
 * D893 (#2366) — Admin › Insights at /admin/insights, built to the "Admin
 * Insights" canvas (INS1–INS11).
 *
 * Every figure comes from a read that already exists (see insightsModel.js);
 * a block no read counts yet says "Not recorded" with its reason, and the
 * range, profile, country and compare controls are drawn but wait for the
 * Insights read, which says so under the bar. Nothing here is a sample.
 *
 * WHO SEES WHAT. Any admin opens it (`guard(['admin'])`). The Super Admin also
 * reads HQ analytics (`requireSuperAdmin` in the Worker), which gives the
 * weekly activity line and the activation funnel, and gets the Scope select.
 * A plain Admin who opens a `?scope=` link for another studio sees INS10.
 */

const BTN = 'inline-flex min-h-[36px] items-center justify-center gap-2 whitespace-nowrap rounded-[9px] px-3.5 text-[12.5px] font-bold';
const GHOST = `${BTN} border border-axal-hairline bg-white text-axal-ink hover:bg-axal-ground dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800`;
const PRIMARY = `${BTN} bg-axal-violet text-white hover:bg-axal-violet-deep`;
const DANGER = `${BTN} self-start border border-axal-destructive-edge bg-white text-axal-destructive dark:border-red-900 dark:bg-gray-900 dark:text-red-400`;
const CARD = 'rounded-[12px] border border-axal-hairline bg-white dark:border-gray-700 dark:bg-gray-900';
const EYE = 'text-[10.5px] font-bold uppercase tracking-[.07em] text-axal-muted dark:text-gray-400';
const SUB = 'text-[12px] leading-[1.45] text-axal-muted dark:text-gray-400';
const LINK = 'text-[12px] font-bold text-axal-violet hover:text-axal-violet-deep dark:text-violet-300';
const NR = 'self-start rounded-full border border-dashed border-axal-muted px-2 py-0.5 text-[11px] font-semibold text-axal-muted dark:text-gray-400';

const idle = { status: 'loading', data: null };

/** The page's reads. Each one answers alone; `reload(key)` reads one again. */
function useInsightsReads(superAdmin) {
  const [reads, setReads] = useState({ glance: idle, cohorts: idle, overview: { last: idle, before: idle }, hq: superAdmin ? idle : null });
  const [asOf, setAsOf] = useState(null);
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);

  const run = useCallback((key) => {
    const set = (patch) => { if (alive.current) setReads((r) => ({ ...r, ...patch })); };
    const one = (label, p, place) => p.then(
      (data) => place({ status: 'ready', data }),
      (e) => { reportError(`admin-insights:${label}`, e); place({ status: 'error', data: null }); },
    );
    const jobs = [];
    if (!key || key === 'glance') {
      set({ glance: idle });
      jobs.push(one('glance', api.adminStudioGlance(), (v) => set({ glance: v })));
    }
    if (!key || key === 'cohorts') {
      set({ cohorts: idle });
      jobs.push(one('cohorts', api.analyticsCohorts('retention', 'week'), (v) => set({ cohorts: v })));
    }
    if (!key || key === 'overview') {
      const w = lastTwoWeeks(Date.now());
      setReads((r) => ({ ...r, overview: { last: idle, before: idle } }));
      const place = (slot) => (v) => { if (alive.current) setReads((r) => ({ ...r, overview: { ...r.overview, [slot]: v } })); };
      jobs.push(one('overview-last', api.analyticsOverview(w.last.from, w.last.to), place('last')));
      jobs.push(one('overview-before', api.analyticsOverview(w.before.from, w.before.to), place('before')));
    }
    if (superAdmin && (!key || key === 'hq')) {
      set({ hq: idle });
      jobs.push(one('hq', api.hqAnalytics('8w'), (v) => set({ hq: v })));
    }
    Promise.allSettled(jobs).then(() => { if (alive.current) setAsOf(Date.now()); });
  }, [superAdmin]);

  useEffect(() => { run(); }, [run]);
  return { reads, asOf, reload: run };
}

/** Which read feeds each tile and block, so Try again reads only that one. */
const READ_OF = {
  accounts: 'glance', new: 'glance', active: 'overview', activated: 'hq',
  who: 'glance', growth: 'glance', tickets: 'glance', spend: 'glance', retention: 'cohorts', activity: 'hq', activation: 'hq',
};

function Skeleton({ box }) {
  return box
    ? <div className="h-[170px] rounded-[10px] border border-axal-hairline bg-[repeating-linear-gradient(0deg,transparent_0_33px,#ececf1_33px_34px)] dark:border-gray-700 dark:bg-[repeating-linear-gradient(0deg,transparent_0_33px,#374151_33px_34px)]" />
    : <span className="block h-2.5 w-[70%] rounded-full bg-axal-hairline dark:bg-gray-700" />;
}

export function Tile({ k, onRetry }) {
  return (
    <div className={`${CARD} flex flex-col gap-1.5 px-4 py-3.5`} data-testid={`insights-kpi-${k.key}`}>
      <span className={EYE}>{k.label}</span>
      {k.state === 'loading' && <><span className="font-mono text-[15px] text-axal-muted">Reading…</span><Skeleton /></>}
      {k.state === 'ready' && (
        <>
          <span className="font-mono text-[26px] font-medium tracking-[-.01em] text-axal-ink dark:text-gray-100">
            {k.value}
            {k.tag ? <span className="ml-1.5 rounded-full border border-dashed border-axal-muted px-1.5 align-[4px] font-display text-[11px] font-bold text-axal-muted">{k.tag}</span> : null}
          </span>
          {k.sub ? <span className={SUB}>{k.sub}</span> : null}
          {k.delta ? <span className={`font-mono text-[12px] font-medium ${k.deltaTone === 'negative' ? 'text-axal-destructive dark:text-red-400' : 'text-axal-positive dark:text-emerald-400'}`}>{k.delta}</span> : null}
        </>
      )}
      {k.state === 'unrecorded' && <><span className={NR}>Not recorded</span><span className={SUB}>{k.reason}</span></>}
      {k.state === 'unreadable' && (
        <>
          <span className="text-[13px] font-bold text-axal-destructive dark:text-red-400">Could not be read.</span>
          <span className={SUB}>{k.reason}</span>
          <button type="button" className={DANGER} onClick={onRetry}>Try again</button>
        </>
      )}
    </div>
  );
}

export function Block({ b, onRetry, onCount, onSelect, onPick, phone }) {
  const [table, setTable] = useState(false);
  const span = phone ? 'col-span-12' : { 4: 'col-span-12 lg:col-span-4', 6: 'col-span-12 lg:col-span-6', 8: 'col-span-12 lg:col-span-8', 12: 'col-span-12' }[b.span] || 'col-span-12';
  const hasChart = b.state === 'ready' && Boolean(b.chart);
  return (
    <section className={`${CARD} ${span} flex min-w-0 flex-col gap-3 px-[18px] py-4`} data-testid={`insights-block-${b.key}`} aria-labelledby={`insights-h-${b.key}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2.5">
        <h2 id={`insights-h-${b.key}`} className="m-0 text-[15px] font-extrabold tracking-[-.02em] text-axal-ink dark:text-gray-100">{b.title}</h2>
        <span className="flex gap-3">
          <button type="button" className={LINK} onClick={() => onCount(b.key)} data-testid={`insights-count-${b.key}`}>How is this counted?</button>
          {hasChart ? <button type="button" className={LINK} aria-pressed={table} onClick={() => setTable((t) => !t)}>{table ? 'View as chart' : 'View as table'}</button> : null}
        </span>
      </div>
      {b.state === 'loading' && <><span className="font-mono text-[12px] text-axal-muted">Reading…</span><Skeleton box /></>}
      {b.state === 'unreadable' && (
        <div className="flex flex-col gap-2.5 rounded-[10px] border border-axal-destructive-edge bg-axal-destructive-tint p-3.5 text-[13px] leading-normal text-axal-destructive dark:border-red-900 dark:bg-red-950/40 dark:text-red-300" role="alert">
          <span>{`Could not be read. ${b.reason || ''}`.trim()}</span>
          <button type="button" className={DANGER} onClick={onRetry}>Try again</button>
        </div>
      )}
      {b.state === 'unrecorded' && <><span className={NR}>Not recorded</span><span className={SUB}>{b.reason}</span></>}
      {b.state === 'ready' && (
        <>
          {b.take ? <p className="m-0 text-[13px] leading-normal text-axal-ink dark:text-gray-100">{b.take}</p> : null}
          {b.select ? (
            <label className="flex flex-col gap-1 self-start">
              <span className="sr-only">Sign-up week</span>
              <select value={b.select.value} onChange={(e) => onPick(e.target.value)}
                className="min-h-[36px] rounded-[7px] border border-axal-hairline bg-white px-2.5 text-[12.5px] font-semibold text-axal-ink dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100">
                {b.select.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </label>
          ) : null}
          {b.big ? (
            <div className="flex flex-wrap items-baseline gap-2.5">
              <span className="font-mono text-[26px] font-medium tracking-[-.01em] text-axal-ink dark:text-gray-100">{b.big}</span>
              <span className={SUB}>{b.bigSub}</span>
            </div>
          ) : null}
          {b.chart ? (table
            ? <ChartTable chart={b.chart} caption={b.alt} />
            : <div role="img" aria-label={b.alt}><Chart chart={b.chart} onSelect={onSelect} /></div>) : null}
          {b.note ? <p className={`m-0 ${SUB}`}>{b.note}</p> : null}
          {b.chart2 ? (table
            ? <ChartTable chart={b.chart2} caption={b.alt2} />
            : <div role="img" aria-label={b.alt2}><Chart chart={b.chart2} /></div>) : null}
          {b.legend?.length ? <Legend items={b.legend} /> : null}
          {b.badges?.length ? (
            <div className="flex flex-col gap-1.5">
              {b.badges.map(([k, t]) => (
                <span key={k} className="flex items-center gap-2 text-[12.5px] text-axal-ink dark:text-gray-100">
                  <span className="whitespace-nowrap rounded-full border border-axal-muted px-2 text-[11px] font-bold">{k}</span>{t}
                </span>
              ))}
            </div>
          ) : null}
          {b.foot ? <p className={`m-0 text-[11.5px] leading-normal text-axal-muted dark:text-gray-400`}>{b.foot}</p> : null}
        </>
      )}
      {b.link && (b.state === 'ready' || b.state === 'unrecorded') ? <Link to={b.link.to} className={`${LINK} self-start`}>{b.link.label}</Link> : null}
    </section>
  );
}

/** The filter bar's controls. Only 8 weeks and All answer today; the rest say why they wait. */
function Filters({ vertical = false }) {
  return (
    <>
      {vertical && <span className={EYE}>Range</span>}
      <div role="radiogroup" aria-label="Range" className={`flex gap-[3px] rounded-[9px] bg-axal-ground p-[3px] dark:bg-gray-800 ${vertical ? 'w-full' : ''}`}>
        {RANGES.map((r) => (
          <span key={r.key} role="radio" aria-checked={r.key === '8w'} aria-disabled={!r.ready} title={r.ready ? undefined : FILTER_WAITS}
            className={`whitespace-nowrap rounded-[7px] px-2.5 py-1.5 text-[12px] font-bold ${vertical ? 'flex-1 text-center' : ''} ${r.key === '8w' ? 'bg-white text-axal-ink shadow-sm dark:bg-gray-900 dark:text-gray-100' : 'text-axal-faint'}`}>
            {r.label}
          </span>
        ))}
      </div>
      {vertical && <span className={EYE}>Profile</span>}
      <div className="flex flex-wrap gap-[7px]" role="group" aria-label="Profile">
        {PROFILE_FILTERS.map((p) => (
          <span key={p} role="button" aria-pressed={p === 'All'} aria-disabled={p !== 'All'} title={p === 'All' ? undefined : FILTER_WAITS}
            className={`whitespace-nowrap rounded-full border px-2.5 py-1 text-[12px] font-semibold ${p === 'All' ? 'border-axal-lavender-edge bg-axal-lavender text-axal-violet dark:border-violet-800 dark:bg-violet-950/50 dark:text-violet-300' : 'border-axal-hairline text-axal-faint dark:border-gray-700'}`}>
            {p}
          </span>
        ))}
      </div>
      {vertical && <span className={EYE}>Country</span>}
      <span aria-disabled="true" title={FILTER_WAITS} className="rounded-[7px] border border-axal-hairline px-2.5 py-1.5 text-[12.5px] font-semibold text-axal-faint dark:border-gray-700">All countries ▾</span>
      <span aria-disabled="true" title={FILTER_WAITS} className="flex items-center gap-2 text-[12.5px] font-semibold text-axal-faint">
        <span className="relative h-5 w-[34px] flex-none rounded-full bg-axal-hairline dark:bg-gray-700"><span className="absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white dark:bg-gray-300" /></span>
        Compare with previous period
      </span>
    </>
  );
}

function ScopeSelect() {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button type="button" aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen((o) => !o)} data-testid="insights-scope"
        className="rounded-[7px] border border-axal-lavender-edge bg-axal-lavender px-2.5 py-1.5 text-[12.5px] font-bold text-axal-violet dark:border-violet-800 dark:bg-violet-950/50 dark:text-violet-300">
        Scope · HQ-held accounts ▾
      </button>
      {open && (
        <div role="listbox" aria-label="Scope" className={`${CARD} absolute left-0 top-9 z-10 flex w-[300px] flex-col gap-0.5 p-1.5 shadow-[0_12px_30px_rgba(24,24,27,.14)]`}>
          <div role="option" aria-selected="true" className="rounded-[7px] bg-axal-lavender px-2.5 py-2 text-[13px] font-bold text-axal-violet dark:bg-violet-950/50 dark:text-violet-300">HQ-held accounts</div>
          <div className="mt-1 border-t border-axal-hairline px-2.5 pb-1 pt-2 text-[12px] leading-normal text-axal-muted dark:border-gray-700 dark:text-gray-400">{SCOPE_NOTE}</div>
        </div>
      )}
    </div>
  );
}

export default function AdminInsights() {
  const loc = useLocation();
  const navigate = useNavigate();
  const phone = usePhoneWidth();
  const superAdmin = isSuperAdminUser(useAuth()?.user);
  const { reads, asOf, reload } = useInsightsReads(superAdmin);
  const [pick, setPick] = useState(null);
  const [count, setCount] = useState(null);
  const [exporting, setExporting] = useState(false);
  const [sheet, setSheet] = useState(false);
  const [toast, setToast] = useState(null);
  const filtersBtn = useRef(null);

  const params = new URLSearchParams(loc.search);
  const moved = params.get('moved') === MOVED_KEY;
  const scope = scopeState(loc.search, superAdmin);
  const groupKey = groupFromSearch(loc.search);

  const setParam = useCallback((key, value) => {
    const next = new URLSearchParams(loc.search);
    if (value === null || value === undefined) next.delete(key); else next.set(key, value);
    const s = next.toString();
    navigate({ pathname: loc.pathname, search: s ? `?${s}` : '', hash: loc.hash }, { replace: true });
  }, [loc.search, loc.pathname, loc.hash, navigate]);

  const kpis = useMemo(() => buildKpis({ glance: reads.glance, overview: reads.overview, hq: reads.hq, superAdmin }), [reads, superAdmin]);
  const blocks = useMemo(() => buildBlocks({ glance: reads.glance, cohorts: reads.cohorts, hq: reads.hq, superAdmin, pick }), [reads, superAdmin, pick]);
  const group = useMemo(() => buildGroup(groupKey, reads.glance), [groupKey, reads.glance]);
  const failed = pageFailed(reads, superAdmin);
  const empty = isEmptyStudio(reads.glance);
  const noperm = scope.kind === 'noperm';
  const asOfText = asOf ? `As of ${asOfLabel(asOf)}` : 'Reading…';

  useEffect(() => () => { if (toast?.url) URL.revokeObjectURL(toast.url); }, [toast]);

  const doExport = () => {
    const csv = figuresCsv({ kpis, blocks, asOf: asOf ? asOfLabel(asOf) : '' });
    let url = null;
    try { url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' })); } catch (e) { reportError('admin-insights:export', e); }
    setExporting(false);
    setToast(url ? { url, name: `insights-${new Date().toISOString().slice(0, 10)}.csv` } : { error: true });
  };

  const def = count ? DEFINITIONS[count] : null;

  const rail = (
    <WorkerRail
      workspace="Insights"
      role="admin"
      stance="The accounts you manage, as counts"
      note="This rail reads HQ’s own database, the accounts HQ holds on axal.vc, and no other. No subsidiary is deployed yet."
      coverage={['Accounts by profile, sign-ups per week, open tickets and AI spend, from the Studio glance', 'Active accounts last week and retention by sign-up week, from the analytics reads']}
      coverageNote="Each figure is read alone; one that cannot be read says so and the others still answer."
      unavailable={[['Plans, countries, identity checks, completeness and dormant accounts', 'Counted once the Insights read is built.']]}
      data-testid="insights-rail"
    />
  );

  return (
    <RailFrame rail={rail} data-testid="admin-insights">
      <div className="flex flex-col gap-5 pb-24 lg:pb-10" data-testid="admin-insights-page">
        <header className="flex flex-col gap-[7px]">
          <h1 className="m-0 text-[24px] font-extrabold leading-tight tracking-[-.02em] text-axal-ink dark:text-gray-100">Insights</h1>
          <p className="m-0 text-[13.5px] leading-normal text-axal-muted dark:text-gray-400">The accounts you manage, in figures and charts.</p>
          <span title={SCOPE_TITLE} className="cursor-help self-start rounded-full border border-axal-hairline bg-white px-3 py-1 font-mono text-[11.5px] font-medium text-axal-ink dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100" data-testid="insights-scope-chip">{SCOPE_LABEL}</span>
          {moved && (
            <div role="status" className="flex items-center justify-between gap-3 rounded-[10px] border border-axal-lavender-edge bg-axal-lavender px-3 py-2 text-[13px] text-axal-ink dark:border-violet-800 dark:bg-violet-950/40 dark:text-gray-100" data-testid="insights-moved">
              <span>{MOVED_NOTICE}</span>
              <button type="button" aria-label="Dismiss" className="flex h-8 w-8 items-center justify-center text-[16px] leading-none" onClick={() => setParam('moved', null)}>×</button>
            </div>
          )}
        </header>

        {!phone ? (
          <div className={`${CARD} sticky top-0 z-[2] flex flex-col gap-2 px-3.5 py-[11px]`} data-testid="insights-filters">
            <div className="flex flex-wrap items-center gap-x-3.5 gap-y-2.5">
              <Filters />
              {superAdmin ? <ScopeSelect /> : null}
              {noperm ? <span className="text-[13.5px] text-axal-muted dark:text-gray-400">{NO_PERMISSION_FILTER}</span> : null}
              <span className="ml-auto flex flex-wrap items-center gap-2.5">
                {superAdmin ? <Link to="/admin/analytics" className="text-[12.5px] font-bold text-axal-violet dark:text-violet-300">Compare all subsidiaries on HQ Analytics</Link> : null}
                <span className="font-mono text-[11.5px] text-axal-muted dark:text-gray-400" data-testid="insights-asof">{asOfText}</span>
                <button type="button" aria-label="Refresh" onClick={() => reload()} className="grid h-8 w-8 place-items-center rounded-[9px] border border-axal-hairline text-axal-muted dark:border-gray-700"><RefreshCw size={16} aria-hidden="true" /></button>
                <button type="button" className={GHOST} onClick={() => setExporting(true)} disabled={noperm} data-testid="insights-export">Export</button>
              </span>
            </div>
            <p className="m-0 text-[11.5px] text-axal-muted dark:text-gray-400">{FILTER_WAITS}</p>
          </div>
        ) : (
          <div className="flex items-center gap-2.5">
            <button type="button" ref={filtersBtn} className={`${GHOST} min-h-[44px]`} onClick={() => setSheet(true)} data-testid="insights-filters-open">
              Filters <span className="rounded-full bg-axal-violet px-[7px] py-px font-mono text-[10.5px] font-semibold text-white">2</span>
            </button>
            <span className="font-mono text-[11.5px] text-axal-muted">{asOfText}</span>
          </div>
        )}

        {noperm ? (
          <div className={`${CARD} flex max-w-[560px] flex-col items-start gap-3 p-[30px]`} data-testid="insights-noperm">
            <span className="text-[17px] font-extrabold tracking-[-.02em] text-axal-ink dark:text-gray-100">{NO_PERMISSION}</span>
            <button type="button" className={PRIMARY} onClick={() => setParam('scope', null)}>Show my accounts</button>
          </div>
        ) : failed ? (
          <div className={`${CARD} flex flex-col items-center justify-center gap-2.5 p-10`} data-testid="insights-failed">
            <span className="text-[15px] font-extrabold text-axal-ink dark:text-gray-100">{PAGE_UNREADABLE}</span>
            <button type="button" className={DANGER} onClick={() => reload()}>Try again</button>
          </div>
        ) : (
          <>
            <div className={`grid gap-3.5 ${phone ? 'grid-cols-2' : 'grid-cols-2 lg:grid-cols-4'}`} data-testid="insights-kpis">
              {kpis.map((k) => <Tile key={k.key} k={k} onRetry={() => reload(READ_OF[k.key])} />)}
            </div>
            {empty ? (
              <>
                <div className={`${CARD} flex flex-col items-start gap-3 p-[30px]`} data-testid="insights-empty">
                  <span className="text-[17px] font-extrabold tracking-[-.02em] text-axal-ink dark:text-gray-100">{EMPTY_LINE}</span>
                  <Link to="/admin/held/accounts" className={PRIMARY}>Go to Accounts</Link>
                </div>
                <div className={`${CARD} flex flex-col gap-1.5 px-[18px] py-4`}>
                  <span className="text-[15px] font-extrabold text-axal-ink dark:text-gray-100">Activation</span>
                  <span className={NR}>Not recorded</span>
                  <span className={SUB}>No sign-up week has finished its second week yet.</span>
                </div>
              </>
            ) : (
              <div className="grid grid-cols-12 gap-3.5" data-testid="insights-blocks">
                {blocks.map((b) => (
                  <Block key={b.key} b={b} phone={phone}
                    onRetry={() => reload(READ_OF[b.key])}
                    onCount={setCount}
                    onSelect={(key) => setParam('group', key)}
                    onPick={setPick} />
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {sheet && (
        <PhoneSheet label="Filters" title="Filters" onClose={() => setSheet(false)} opener={filtersBtn}>
          <div className="flex flex-col gap-2.5 px-4 pb-6">
            <Filters vertical />
            {superAdmin ? <ScopeSelect /> : null}
            <p className={SUB}>{FILTER_WAITS}</p>
            <button type="button" className={`${PRIMARY} min-h-[44px]`} onClick={() => setSheet(false)}>Show results</button>
          </div>
        </PhoneSheet>
      )}

      {def && (
        <Lightbox label={def.title} title={def.title} onClose={() => setCount(null)} testId="insights-count-dialog">
          <div className="flex flex-col gap-3.5 px-1 pb-1">
            <p className="m-0 text-[13.5px] leading-relaxed text-axal-ink dark:text-gray-100">{def.body}</p>
            <p className={`m-0 ${SUB}`}>{SOURCE_LINE} {asOf ? <span className="font-mono">{asOfText}.</span> : null}</p>
            {def.more?.length ? (
              <div className="flex flex-col gap-2 border-t border-axal-hairline pt-3 text-[13px] leading-normal text-axal-ink dark:border-gray-700 dark:text-gray-100">
                {def.more.map(([k, t]) => <span key={k}><b>{k}:</b> {t}</span>)}
              </div>
            ) : null}
            <button type="button" className={`${GHOST} self-end`} onClick={() => setCount(null)}>Close</button>
          </div>
        </Lightbox>
      )}

      {exporting && (
        <Lightbox label="Export these figures" title="Export these figures" onClose={() => setExporting(false)} testId="insights-export-dialog">
          <div className="flex flex-col gap-3.5 px-1 pb-1">
            <fieldset className="flex flex-col gap-1.5">
              <legend className={EYE}>What</legend>
              <label className="flex items-center gap-2 text-[13.5px]"><input type="radio" name="ins-what" defaultChecked /> Figures on this page</label>
            </fieldset>
            <fieldset className="flex flex-col gap-1.5">
              <legend className={EYE}>Format</legend>
              <label className="flex items-center gap-2 text-[13.5px]"><input type="radio" name="ins-fmt" defaultChecked /> CSV</label>
            </fieldset>
            <div className="flex flex-col gap-1">
              <span className={EYE}>Range</span>
              <span className="font-mono text-[13px] text-axal-ink dark:text-gray-100">{rangeLine(reads.glance, Date.now())}</span>
            </div>
            <p className={`m-0 ${SUB}`}>The file holds counts only, never names or emails.</p>
            <div className="flex justify-end gap-2">
              <button type="button" className={GHOST} onClick={() => setExporting(false)}>Cancel</button>
              <button type="button" className={PRIMARY} onClick={doExport} data-testid="insights-export-go">Export</button>
            </div>
          </div>
        </Lightbox>
      )}

      {toast && (
        <div role="status" className="fixed bottom-6 left-1/2 z-[90] flex -translate-x-1/2 items-center gap-3.5 rounded-[12px] bg-axal-ink px-4 py-3 text-[13px] text-white shadow-[0_12px_30px_rgba(0,0,0,.25)]" data-testid="insights-toast">
          {toast.error ? <span>The export could not be made in this browser.</span> : (
            <>
              <span>Your export is ready.</span>
              <a href={toast.url} download={toast.name} className="font-bold text-violet-300">Download</a>
            </>
          )}
          <button type="button" aria-label="Close" className="text-[16px] leading-none text-white/70" onClick={() => setToast(null)}>×</button>
        </div>
      )}

      {group && !noperm && (
        <Lightbox label={`${group.label} group`} eyebrow="Group" width={760}
          title={group.count === null ? group.label : `${group.label} · ${group.count.toLocaleString('en-US')} accounts`}
          onClose={() => setParam('group', null)} testId="insights-group">
          <div className="flex flex-col gap-3.5 px-1 pb-1">
            <div className="flex flex-wrap gap-[7px]">
              {['8 weeks', group.label, 'All countries'].map((c) => (
                <span key={c} className="rounded-full border border-axal-lavender-edge bg-axal-lavender px-2.5 py-1 text-[12px] font-semibold text-axal-violet dark:border-violet-800 dark:bg-violet-950/50 dark:text-violet-300">{c}</span>
              ))}
            </div>
            <div className={`grid gap-2.5 ${phone ? 'grid-cols-2' : 'grid-cols-4'}`}>
              {group.tiles.map((t) => (
                <div key={t} className="flex flex-col gap-1 rounded-[10px] border border-axal-hairline p-[11px] dark:border-gray-700">
                  <span className={EYE}>{t}</span>
                  <span className={NR}>Not recorded</span>
                </div>
              ))}
            </div>
            <p className={`m-0 ${SUB}`}>{group.waits}</p>
            <div className="flex flex-col gap-2">
              {group.count === null ? null : (
                <Link to={group.accountsHref} className={PRIMARY}>{`Open these ${group.count.toLocaleString('en-US')} accounts in Accounts`}</Link>
              )}
              <button type="button" className={GHOST} onClick={() => openEadwynPanel(`Insights · ${group.label}`)}>Ask Eadwyn about this group</button>
            </div>
            <span className="text-[11.5px] leading-normal text-axal-muted dark:text-gray-400">Counts only. Names and emails are in Accounts.</span>
          </div>
        </Lightbox>
      )}
    </RailFrame>
  );
}

