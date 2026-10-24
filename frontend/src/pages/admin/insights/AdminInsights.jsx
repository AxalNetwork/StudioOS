import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { RefreshCw } from 'lucide-react';
import { insightsApi } from '../../../lib/api/insights';
import { reportError } from '../../../lib/log';
import { isSuperAdminUser } from '../../../lib/shellRole';
import { useAuth } from '../../../hooks/useAuthSync';
import {
  Chart, ChartTable, Legend, Lightbox, PhoneSheet, RailFrame, WorkerRail, openEadwynPanel, usePhoneWidth,
} from '../../../ui';
import {
  EMPTY_LINE, MOVED_KEY, MOVED_NOTICE, NO_PERMISSION, NO_PERMISSION_FILTER,
  PAGE_UNREADABLE, PROFILE_FILTERS, RANGES, SCOPE_NOTE, SCOPE_TITLE, SOURCE_LINE,
  activeFilterCount, asOfLabel, buildBlocks, buildGroup, buildKpis, countryOptions, definitionOf,
  EXPORT_FORMATS, EXPORT_LOGGED, EXPORT_NO_GROUP, EXPORT_WHAT, exportBody, exportToast,
  filterCountries, filtersFromSearch, groupFromSearch, isEmptyStudio, pageFailed, rangeLabel, rangeLine,
  readParams, scopeChip, scopeLines, scopeParam, scopeState,
} from './insightsModel';

/**
 * D893 (#2366) — Admin › Insights at /admin/insights, built to the "Admin
 * Insights" canvas (INS1–INS11).
 *
 * ONE READ (#2660). Every tile and block comes from `GET /api/admin/insights`,
 * made with the URL's range, profile, country and compare. The group lightbox
 * makes the same read with `group=<role>`. A block whose store failed says so
 * and the others answer; nothing here is a sample.
 *
 * WHO SEES WHAT. Any admin opens it (`guard(['admin'])`) and reads the same
 * blocks. The Super Admin also gets the Scope select: HQ-held, then each
 * deployed subsidiary from `GET /api/admin/insights/scopes`. A picked
 * subsidiary is read with `scope=<code>`, from its own database (D893 S08,
 * #2662). A plain Admin who opens a `?scope=` link for another studio sees
 * INS10, and no read is made.
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

/**
 * The page's read, and the group lightbox's. Each is made again when the
 * filters it carries change; `reload()` reads both again. A read answered
 * after a newer one was asked is dropped, so a quick change of filter cannot
 * draw the older answer.
 */
function useInsightsReads(filters, groupKey, enabled, scope) {
  const [insights, setInsights] = useState(idle);
  const [group, setGroup] = useState(idle);
  const [asOf, setAsOf] = useState(null);
  const [tick, setTick] = useState(0);
  const params = JSON.stringify({ ...readParams(filters), scope });

  useEffect(() => {
    if (!enabled) return undefined;
    let live = true;
    setInsights(idle);
    insightsApi.adminInsights(JSON.parse(params)).then(
      (data) => { if (live) { setInsights({ status: 'ready', data }); setAsOf(Date.now()); } },
      (e) => { reportError('admin-insights:read', e); if (live) setInsights({ status: 'error', data: null }); },
    );
    return () => { live = false; };
  }, [params, enabled, tick]);

  useEffect(() => {
    if (!enabled || !groupKey) return undefined;
    let live = true;
    setGroup(idle);
    insightsApi.adminInsights({ ...JSON.parse(params), group: groupKey }).then(
      (data) => { if (live) setGroup({ status: 'ready', data }); },
      (e) => { reportError('admin-insights:group', e); if (live) setGroup({ status: 'error', data: null }); },
    );
    return () => { live = false; };
  }, [params, groupKey, enabled, tick]);

  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { reads: { insights, group }, asOf, reload };
}

/**
 * The Scope select's list, for a Super Admin only. `null` until it answers; a
 * read that fails leaves HQ-held alone, so the page still reads its own.
 */
function useScopes(superAdmin) {
  const [scopes, setScopes] = useState(null);
  useEffect(() => {
    if (!superAdmin) return undefined;
    let live = true;
    insightsApi.insightsScopes().then(
      (data) => { if (live) setScopes(Array.isArray(data?.scopes) ? data.scopes : []); },
      (e) => { reportError('admin-insights:scopes', e); if (live) setScopes([]); },
    );
    return () => { live = false; };
  }, [superAdmin]);
  return scopes;
}

/** The line under the filter bar: what the page is showing. */
function filterLine(f) {
  const profile = f.profile ? PROFILE_FILTERS.find((p) => p.role === f.profile)?.label : '';
  return [rangeLabel(f.range), profile, f.country, f.compare ? 'compared with the period before' : ''].filter(Boolean).join(' · ');
}

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

/** The filter bar's controls. Each one writes the URL, and the read follows it. */
function Filters({ filters, countries, onChange, vertical = false }) {
  const chip = (on) => `whitespace-nowrap rounded-full border px-2.5 py-1 text-[12px] font-semibold ${on
    ? 'border-axal-lavender-edge bg-axal-lavender text-axal-violet dark:border-violet-800 dark:bg-violet-950/50 dark:text-violet-300'
    : 'border-axal-hairline text-axal-ink hover:bg-axal-ground dark:border-gray-700 dark:text-gray-100 dark:hover:bg-gray-800'}`;
  return (
    <>
      {vertical && <span className={EYE}>Range</span>}
      <div role="radiogroup" aria-label="Range" className={`flex gap-[3px] rounded-[9px] bg-axal-ground p-[3px] dark:bg-gray-800 ${vertical ? 'w-full' : ''}`}>
        {RANGES.map((r) => (
          <button key={r.key} type="button" role="radio" aria-checked={filters.range === r.key} data-testid={`insights-range-${r.key}`}
            onClick={() => onChange({ range: r.key === '8w' ? null : r.key })}
            className={`whitespace-nowrap rounded-[7px] px-2.5 py-1.5 text-[12px] font-bold ${vertical ? 'flex-1 text-center' : ''} ${filters.range === r.key ? 'bg-white text-axal-ink shadow-sm dark:bg-gray-900 dark:text-gray-100' : 'text-axal-muted dark:text-gray-400'}`}>
            {r.label}
          </button>
        ))}
      </div>
      {vertical && <span className={EYE}>Profile</span>}
      <div className="flex flex-wrap gap-[7px]" role="group" aria-label="Profile">
        {PROFILE_FILTERS.map((p) => {
          if (p.waits) {
            return <span key={p.label} aria-disabled="true" title={p.waits} className="whitespace-nowrap rounded-full border border-dashed border-axal-hairline px-2.5 py-1 text-[12px] font-semibold text-axal-faint dark:border-gray-700">{p.label}</span>;
          }
          const on = p.role ? filters.profile === p.role : !filters.profile;
          return (
            <button key={p.label} type="button" aria-pressed={on} className={chip(on)} data-testid={`insights-profile-${p.role || 'all'}`}
              onClick={() => onChange({ profile: p.role })}>
              {p.label}
            </button>
          );
        })}
      </div>
      {vertical && <span className={EYE}>Country</span>}
      <label className="flex items-center">
        <span className="sr-only">Country</span>
        <select value={filters.country || ''} onChange={(e) => onChange({ country: e.target.value || null })} data-testid="insights-country"
          className="min-h-[32px] rounded-[7px] border border-axal-hairline bg-white px-2.5 text-[12.5px] font-semibold text-axal-ink dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100">
          <option value="">All countries</option>
          {countries.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      </label>
      <label className="flex cursor-pointer items-center gap-2 text-[12.5px] font-semibold text-axal-ink dark:text-gray-100">
        <input type="checkbox" role="switch" className="peer sr-only" checked={filters.compare} data-testid="insights-compare"
          onChange={(e) => onChange({ compare: e.target.checked ? '1' : null })} />
        <span className="relative h-5 w-[34px] flex-none rounded-full bg-axal-hairline peer-checked:bg-axal-violet peer-focus-visible:ring-2 peer-focus-visible:ring-axal-violet dark:bg-gray-700">
          <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white dark:bg-gray-300 ${filters.compare ? 'left-4' : 'left-0.5'}`} />
        </span>
        Compare with previous period
      </label>
    </>
  );
}

/** The select's open list (INS2): HQ-held, one line per subsidiary, and the note while there is none. */
export function ScopeList({ scopes, current, onPick }) {
  const lines = scopeLines(scopes);
  const picked = current?.kind === 'branch' ? current.code : 'hq';
  return (
    <div role="listbox" aria-label="Scope" className={`${CARD} absolute left-0 top-9 z-10 flex w-[300px] flex-col gap-0.5 p-1.5 shadow-[0_12px_30px_rgba(24,24,27,.14)]`} data-testid="insights-scope-list">
      {lines.map((l) => {
        const on = l.code === picked;
        return (
          <button key={l.code} type="button" role="option" aria-selected={on} onClick={() => onPick(l.code)} data-testid={`insights-scope-option-${l.code}`}
            className={`rounded-[7px] px-2.5 py-2 text-left text-[13px] font-bold ${on ? 'bg-axal-lavender text-axal-violet dark:bg-violet-950/50 dark:text-violet-300' : 'text-axal-ink hover:bg-axal-ground dark:text-gray-100 dark:hover:bg-gray-800'}`}>
            {l.label}
          </button>
        );
      })}
      {lines.some((l) => l.kind === 'branch') ? null : (
        <div className="mt-1 border-t border-axal-hairline px-2.5 pb-1 pt-2 text-[12px] leading-normal text-axal-muted dark:border-gray-700 dark:text-gray-400">{SCOPE_NOTE}</div>
      )}
    </div>
  );
}

function ScopeSelect({ scopes, current, onPick }) {
  const [open, setOpen] = useState(false);
  const label = current?.kind === 'branch' ? current.label : 'HQ-held accounts';
  return (
    <div className="relative">
      <button type="button" aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen((o) => !o)} data-testid="insights-scope"
        className="rounded-[7px] border border-axal-lavender-edge bg-axal-lavender px-2.5 py-1.5 text-[12.5px] font-bold text-axal-violet dark:border-violet-800 dark:bg-violet-950/50 dark:text-violet-300">
        Scope · {label} ▾
      </button>
      {open && <ScopeList scopes={scopes} current={current} onPick={(code) => { setOpen(false); onPick(code); }} />}
    </div>
  );
}

/**
 * The export dialog (INS5, #2661). "This group only" can be chosen while a
 * group is open; the file is made and logged by the Worker, so the dialog
 * says so before anything is made.
 */
export function ExportDialog({ group, groupLabel, rangeText, busy, initialWhat = 'page', onCancel, onExport }) {
  const [what, setWhat] = useState(group && initialWhat === 'group' ? 'group' : 'page');
  const [format, setFormat] = useState('csv');
  return (
    <Lightbox label="Export these figures" title="Export these figures" onClose={onCancel} testId="insights-export-dialog">
      <div className="flex flex-col gap-3.5 px-1 pb-1">
        <fieldset className="flex flex-col gap-1.5">
          <legend className={EYE}>What</legend>
          {EXPORT_WHAT.map((o) => {
            const off = o.key === 'group' && !group;
            return (
              <label key={o.key} className={`flex items-center gap-2 text-[13.5px] ${off ? 'text-axal-muted dark:text-gray-500' : ''}`}>
                <input type="radio" name="ins-what" value={o.key} checked={what === o.key} disabled={off} onChange={() => setWhat(o.key)} data-testid={`insights-export-what-${o.key}`} />
                {o.key === 'group' && group ? `${o.label} · ${groupLabel}` : o.label}
              </label>
            );
          })}
          {group ? null : <span className={SUB}>{EXPORT_NO_GROUP}</span>}
        </fieldset>
        <fieldset className="flex flex-col gap-1.5">
          <legend className={EYE}>Format</legend>
          {EXPORT_FORMATS.map((o) => (
            <label key={o.key} className="flex items-center gap-2 text-[13.5px]">
              <input type="radio" name="ins-fmt" value={o.key} checked={format === o.key} onChange={() => setFormat(o.key)} data-testid={`insights-export-format-${o.key}`} /> {o.label}
            </label>
          ))}
        </fieldset>
        <div className="flex flex-col gap-1">
          <span className={EYE}>Range</span>
          <span className="font-mono text-[13px] text-axal-ink dark:text-gray-100">{rangeText}</span>
        </div>
        <p className={`m-0 ${SUB}`}>The file holds counts only, never names or emails. {EXPORT_LOGGED}</p>
        <div className="flex justify-end gap-2">
          <button type="button" className={GHOST} onClick={onCancel}>Cancel</button>
          <button type="button" className={PRIMARY} onClick={() => onExport({ what, format })} disabled={busy} data-testid="insights-export-go">{busy ? 'Exporting…' : 'Export'}</button>
        </div>
      </div>
    </Lightbox>
  );
}

/** The toast an export leaves: the signed link, or the Worker's refusal. */
export function ExportToast({ toast, onClose }) {
  return (
    <div role="status" className="fixed bottom-6 left-1/2 z-[90] flex -translate-x-1/2 items-center gap-3.5 rounded-[12px] bg-axal-ink px-4 py-3 text-[13px] text-white shadow-[0_12px_30px_rgba(0,0,0,.25)]" data-testid="insights-toast">
      {toast.error ? <span>{toast.error}</span> : (
        <>
          <span>{toast.fellBack ? 'Your export is ready, as a web page: the PDF could not be made.' : 'Your export is ready.'}{toast.expires ? ' The link works for 24 hours.' : ''}</span>
          <a href={toast.url} {...(toast.url.startsWith('data:') ? { download: `insights.${toast.format}` } : { target: '_blank', rel: 'noopener noreferrer' })} className="font-bold text-violet-300" data-testid="insights-toast-download">Download</a>
        </>
      )}
      <button type="button" aria-label="Close" className="text-[16px] leading-none text-white/70" onClick={onClose}>×</button>
    </div>
  );
}

export default function AdminInsights() {
  const loc = useLocation();
  const navigate = useNavigate();
  const phone = usePhoneWidth();
  const superAdmin = isSuperAdminUser(useAuth()?.user);
  const [pick, setPick] = useState(null);
  const [count, setCount] = useState(null);
  const [exporting, setExporting] = useState(null);
  const [exportBusy, setExportBusy] = useState(false);
  const [sheet, setSheet] = useState(false);
  const [toast, setToast] = useState(null);
  const filtersBtn = useRef(null);

  const params = new URLSearchParams(loc.search);
  const moved = params.get('moved') === MOVED_KEY;
  const scopes = useScopes(superAdmin);
  const scope = scopeState(loc.search, superAdmin, scopes);
  const groupKey = groupFromSearch(loc.search);
  const filters = useMemo(() => filtersFromSearch(loc.search), [loc.search]);
  const noperm = scope.kind === 'noperm';
  const { reads, asOf, reload } = useInsightsReads(filters, groupKey, !noperm && scope.kind !== 'pending', scopeParam(scope));
  const [countryQ, setCountryQ] = useState('');

  const setParam = useCallback((key, value) => {
    const next = new URLSearchParams(loc.search);
    if (value === null || value === undefined) next.delete(key); else next.set(key, value);
    const s = next.toString();
    navigate({ pathname: loc.pathname, search: s ? `?${s}` : '', hash: loc.hash }, { replace: true });
  }, [loc.search, loc.pathname, loc.hash, navigate]);

  /** A Scope line: HQ-held removes `scope`, a subsidiary sets its code. */
  const pickScope = useCallback((code) => setParam('scope', code === 'hq' ? null : code), [setParam]);

  /** Several filters at once: `null` removes one, so the default never sits in the URL. */
  const setFilters = useCallback((patch) => {
    const next = new URLSearchParams(loc.search);
    for (const [k, v] of Object.entries(patch)) { if (v === null || v === undefined) next.delete(k); else next.set(k, v); }
    const q = next.toString();
    navigate({ pathname: loc.pathname, search: q ? `?${q}` : '', hash: loc.hash }, { replace: true });
  }, [loc.search, loc.pathname, loc.hash, navigate]);

  const kpis = useMemo(() => buildKpis({ insights: reads.insights }), [reads.insights]);
  const blocks = useMemo(() => buildBlocks({ insights: reads.insights, filters, pick }), [reads.insights, filters, pick]);
  const group = useMemo(() => buildGroup(groupKey, reads.group), [groupKey, reads.group]);
  const countries = useMemo(() => countryOptions(reads.insights, filters.country), [reads.insights, filters.country]);
  const failed = pageFailed(reads.insights);
  const empty = isEmptyStudio(reads.insights, filters);
  const asOfText = asOf ? `As of ${asOfLabel(asOf)}` : 'Reading…';

  const doExport = ({ what, format }) => {
    setExportBusy(true);
    insightsApi.insightsExport(exportBody({ what, format, filters, group: groupKey, scope: scopeParam(scope) })).then(
      (answer) => setToast(exportToast(answer)),
      (e) => { reportError('admin-insights:export', e); setToast(exportToast(null, e)); },
    ).finally(() => { setExportBusy(false); setExporting(null); });
  };

  const def = count ? definitionOf(count, reads.insights) : null;

  const rail = (
    <WorkerRail
      workspace="Insights"
      role="admin"
      stance="The accounts you manage, as counts"
      note={scope.kind === 'branch'
        ? `This rail reads ${scope.label}’s own database, asked by HQ, as counts. No account leaves it.`
        : 'This rail reads HQ’s own database, the accounts HQ holds on axal.vc, and no other.'}
      coverage={['Accounts by profile, plan, country, identity check and completeness; sign-ups, activity, activation and retention by week; dormant accounts, open tickets and AI spend, from the Insights read']}
      coverageNote="Each figure is read alone; one that cannot be read says so and the others still answer."
      unavailable={[['Product testers', 'A sub-account #2377 has not defined yet.']]}
      data-testid="insights-rail"
    />
  );

  return (
    <RailFrame rail={rail} data-testid="admin-insights">
      <div className="flex flex-col gap-5 pb-24 lg:pb-10" data-testid="admin-insights-page">
        <header className="flex flex-col gap-[7px]">
          <h1 className="m-0 text-[24px] font-extrabold leading-tight tracking-[-.02em] text-axal-ink dark:text-gray-100">Insights</h1>
          <p className="m-0 text-[13.5px] leading-normal text-axal-muted dark:text-gray-400">The accounts you manage, in figures and charts.</p>
          <span title={scope.kind === 'branch' ? `Read from ${scope.label}’s own database through HQ; counts only.` : SCOPE_TITLE} className="cursor-help self-start rounded-full border border-axal-hairline bg-white px-3 py-1 font-mono text-[11.5px] font-medium text-axal-ink dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100" data-testid="insights-scope-chip">{scopeChip(scope)}</span>
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
              <Filters filters={filters} countries={countries} onChange={setFilters} />
              {superAdmin ? <ScopeSelect scopes={scopes} current={scope} onPick={pickScope} /> : null}
              {noperm ? <span className="text-[13.5px] text-axal-muted dark:text-gray-400">{NO_PERMISSION_FILTER}</span> : null}
              <span className="ml-auto flex flex-wrap items-center gap-2.5">
                {superAdmin ? <Link to="/admin/analytics" className="text-[12.5px] font-bold text-axal-violet dark:text-violet-300">Compare all subsidiaries on HQ Analytics</Link> : null}
                <span className="font-mono text-[11.5px] text-axal-muted dark:text-gray-400" data-testid="insights-asof">{asOfText}</span>
                <button type="button" aria-label="Refresh" onClick={() => reload()} className="grid h-8 w-8 place-items-center rounded-[9px] border border-axal-hairline text-axal-muted dark:border-gray-700"><RefreshCw size={16} aria-hidden="true" /></button>
                <button type="button" className={GHOST} onClick={() => setExporting('page')} disabled={noperm} data-testid="insights-export">Export</button>
              </span>
            </div>
            <p className="m-0 text-[11.5px] text-axal-muted dark:text-gray-400" data-testid="insights-filter-line">{filterLine(filters)}</p>
          </div>
        ) : (
          <div className="flex items-center gap-2.5">
            <button type="button" ref={filtersBtn} className={`${GHOST} min-h-[44px]`} onClick={() => setSheet(true)} data-testid="insights-filters-open">
              Filters {activeFilterCount(filters) ? <span className="rounded-full bg-axal-violet px-[7px] py-px font-mono text-[10.5px] font-semibold text-white">{activeFilterCount(filters)}</span> : null}
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
              {kpis.map((k) => <Tile key={k.key} k={k} onRetry={reload} />)}
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
                    onRetry={reload}
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
            <Filters vertical filters={filters} countries={countries} onChange={setFilters} />
            {superAdmin ? <ScopeSelect scopes={scopes} current={scope} onPick={pickScope} /> : null}
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

      {group && !noperm && (
        <Lightbox label={`${group.label} group`} eyebrow="Group" width={760}
          title={group.count === null || group.count === undefined ? group.label : `${group.label} · ${group.count.toLocaleString('en-US')} accounts`}
          onClose={() => { setCountryQ(''); setParam('group', null); }} testId="insights-group">
          <div className="flex flex-col gap-3.5 px-1 pb-1">
            <div className="flex flex-wrap gap-[7px]">
              {[rangeLabel(filters.range), group.label, filters.country || 'All countries'].map((c) => (
                <span key={c} className="rounded-full border border-axal-lavender-edge bg-axal-lavender px-2.5 py-1 text-[12px] font-semibold text-axal-violet dark:border-violet-800 dark:bg-violet-950/50 dark:text-violet-300">{c}</span>
              ))}
            </div>
            {group.state === 'loading' && <><span className="font-mono text-[12px] text-axal-muted">Reading…</span><Skeleton box /></>}
            {group.state === 'unreadable' && (
              <div className="flex flex-col gap-2.5 rounded-[10px] border border-axal-destructive-edge bg-axal-destructive-tint p-3.5 text-[13px] text-axal-destructive dark:border-red-900 dark:bg-red-950/40 dark:text-red-300" role="alert">
                <span>{`Could not be read. ${group.reason || ''}`.trim()}</span>
                <button type="button" className={DANGER} onClick={reload}>Try again</button>
              </div>
            )}
            {group.state === 'unrecorded' && <><span className={NR}>Not recorded</span><span className={SUB}>{group.reason}</span></>}
            {group.state === 'ready' && (
              <>
                <div className={`grid gap-2.5 ${phone ? 'grid-cols-2' : 'grid-cols-4'}`} data-testid="insights-group-tiles">
                  {group.tiles.map(([t, v]) => (
                    <div key={t} className="flex flex-col gap-1 rounded-[10px] border border-axal-hairline p-[11px] dark:border-gray-700">
                      <span className={EYE}>{t}</span>
                      {v.missing ? <span className={NR}>Not recorded</span> : <span className="font-mono text-[20px] font-medium text-axal-ink dark:text-gray-100">{v.text}</span>}
                    </div>
                  ))}
                </div>
                <div className={`grid gap-3.5 ${phone ? 'grid-cols-1' : 'grid-cols-2'}`}>
                  <div className="flex flex-col gap-1.5">
                    <span className={EYE}>Sign-ups per week</span>
                    <div role="img" aria-label={`${group.label} sign-ups per week: ${group.signups.rows.map((r) => r.value).join(', ')}.`}><Chart chart={{ ...group.signups, height: 160 }} /></div>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <span className={EYE}>Active per week</span>
                    <div role="img" aria-label={`${group.label} active per week: ${group.active.values.map((v) => v ?? 'none').join(', ')}.`}><Chart chart={group.active} /></div>
                  </div>
                </div>
                <div className="flex flex-col gap-2">
                  <label className="flex flex-col gap-1">
                    <span className={EYE}>By country</span>
                    <input type="search" value={countryQ} onChange={(e) => setCountryQ(e.target.value)} placeholder="Search countries" data-testid="insights-group-search"
                      className="min-h-[36px] rounded-[7px] border border-axal-hairline bg-white px-2.5 text-[13px] text-axal-ink dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100" />
                  </label>
                  <table className="w-full border-collapse text-[12.5px]" data-testid="insights-group-countries">
                    <caption className="sr-only">{`${group.label} by country`}</caption>
                    <thead>
                      <tr className="bg-[#faf9fc] text-left text-[10.5px] font-bold uppercase tracking-[.06em] text-axal-muted dark:bg-gray-800 dark:text-gray-400">
                        <th scope="col" className="px-3 py-2">Country</th>
                        <th scope="col" className="px-3 py-2 text-right">Accounts</th>
                        <th scope="col" className="px-3 py-2 text-right">New in 30 days</th>
                        <th scope="col" className="px-3 py-2 text-right">Active last week</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filterCountries(group.countries, countryQ).map((r) => (
                        <tr key={r.country ?? 'none'} className="border-t border-axal-hairline text-axal-ink dark:border-gray-700 dark:text-gray-100">
                          <td className="px-3 py-2 font-semibold">{r.country ?? 'Not stated'}</td>
                          <td className="px-3 py-2 text-right font-mono tabular-nums">{r.accounts.toLocaleString('en-US')}</td>
                          <td className="px-3 py-2 text-right font-mono tabular-nums">{r.new_30d.toLocaleString('en-US')}</td>
                          <td className="px-3 py-2 text-right font-mono tabular-nums">{r.active_last_week === null ? 'not recorded' : r.active_last_week.toLocaleString('en-US')}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {group.countries.length > 0 && filterCountries(group.countries, countryQ).length === 0 ? <p className={`m-0 ${SUB}`}>No country matches.</p> : null}
                </div>
              </>
            )}
            <div className="flex flex-col gap-2">
              {group.count === null || group.count === undefined ? null : (
                <Link to={group.accountsHref} className={PRIMARY}>{`Open these ${group.count.toLocaleString('en-US')} accounts in Accounts`}</Link>
              )}
              <button type="button" className={GHOST} onClick={() => setExporting('group')} data-testid="insights-group-export">Export this group</button>
              <button type="button" className={GHOST} onClick={() => openEadwynPanel(`Insights · ${group.label}`)}>Ask Eadwyn about this group</button>
            </div>
            <span className="text-[11.5px] leading-normal text-axal-muted dark:text-gray-400">Counts only. Names and emails are in Accounts.</span>
          </div>
        </Lightbox>
      )}

      {exporting && (
        <ExportDialog group={noperm ? null : groupKey} groupLabel={group?.label || ''} rangeText={rangeLine(reads.insights, Date.now())}
          busy={exportBusy} initialWhat={exporting} onCancel={() => setExporting(null)} onExport={doExport} />
      )}

      {toast && <ExportToast toast={toast} onClose={() => setToast(null)} />}
    </RailFrame>
  );
}

