// D534 (#1079) — `/research/companies`, built to `design/incoming/Research ·
// Companies.dc.html`. The directory is searched, filtered, sorted and paged
// on the Worker (`researchCompaniesApi.list`); this page prints the API's
// numbers — `total`, `coverage`, `facets` — and never counts rows itself.
//
// The bundled `data/companyDirectory.json` read is retired: it held a copy of
// the directory as of one export and paged it in the browser.
//
// THE SAVED ANALYSES TAB is the way back into `/research/companies/:id`. A
// founder's competitor analyses lived on this route until the directory took
// it (b9557713c); `/build/competitors` redirects here with `?tab=analyses`,
// carrying `market` and `website` so the company page's "Run competitor
// analysis" button prefills the form instead of landing on the directory.
//
// Departures from the canvas: no public top bar and no "Sign in" (the page is
// signed-in, inside `WorkspaceShell`); the app's type, not Space Grotesk; the
// coverage strip has no "as of" date because the API reports none per field.
import React, { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ChevronDown, ExternalLink, Search, SlidersHorizontal, X } from 'lucide-react';
import { Card } from '../../ui';
import ZoneToolbar from '../../workspaces/ZoneToolbar';
import { researchCompaniesApi } from '../../lib/api/researchCompanies.js';
import {
  COVERAGE_LABELS, DIRECTORY_SORTS, EMPTY_FILTERS, HAS_OPTIONS, NOT_RECORDED, PAGE_SIZES,
  activeFilters, companyHref, directoryParams, employees, lastRound, latestOnly, listState, pageList, pageWindow, withoutFilter,
} from '../../lib/companyDirectoryView.js';

const CompetitorAnalysis = lazy(() => import('../../components/CompetitorAnalysis'));

const field = 'w-full rounded-lg border border-axal-hairline bg-white px-3 py-2 text-[12.5px] text-axal-ink focus:border-violet-500 focus:outline-none dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100';
const label = 'mb-1 block text-[11px] font-bold text-axal-muted';

export { companyHref };

/** "What the directory records": each field's filled count, of the whole directory. */
export function CoverageCard({ coverage }) {
  if (!coverage) return null;
  const of = coverage.of ?? 0;
  return (
    <Card data-testid="company-coverage">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-extrabold tracking-tight text-axal-ink dark:text-gray-100">What the directory records</h2>
        <span className="text-[11px] text-axal-faint">Companies with each field filled, of {of.toLocaleString('en-US')} · research_company_directory</span>
      </div>
      <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {COVERAGE_LABELS.map(({ key, label: name }) => {
          const n = coverage.fields?.[key];
          const pct = of && n != null ? Math.round((n / of) * 100) : 0;
          return (
            <div key={key} className="space-y-1.5">
              <div className="flex items-baseline justify-between text-[12px]">
                <span className="text-axal-muted">{name}</span>
                <span><strong className="text-axal-ink dark:text-gray-100">{n == null ? NOT_RECORDED : n.toLocaleString('en-US')}</strong><span className="text-axal-faint"> / {of.toLocaleString('en-US')}</span></span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-axal-hairline dark:bg-gray-800" aria-hidden="true">
                <div className="h-full rounded-full bg-violet-600" style={{ width: `${pct}%` }} />
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

/** Search, sort and the filters. Option counts are the API's facets. */
export function DirectoryFilters({ filters, facets, onChange, open = true, onToggle }) {
  const set = (patch) => onChange({ ...filters, ...patch, page: 1 });
  const sectors = facets?.sector_labels || [];
  const countries = facets?.countries || [];
  const hint = activeFilters(filters).length;
  return (
    <Card data-testid="company-filters" className="space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <label className="min-w-0 flex-[1_1_420px]">
          <span className={label}>Search</span>
          <span className="relative block">
            <Search size={14} className="pointer-events-none absolute left-3 top-2.5 text-axal-faint" />
            <input aria-label="Search companies by name or website" value={filters.q} onChange={(e) => set({ q: e.target.value })}
              placeholder="Company name or website" className={`${field} pl-9`} />
          </span>
        </label>
        <label className="min-w-[200px] flex-[0_1_270px]">
          <span className={label}>Sort by</span>
          <select aria-label="Sort companies" value={filters.sort} onChange={(e) => set({ sort: e.target.value })} className={field}>
            {DIRECTORY_SORTS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        </label>
        <button type="button" onClick={onToggle} aria-expanded={open}
          className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-axal-hairline px-3 py-2 text-[12px] font-semibold text-axal-ink sm:hidden dark:border-gray-700 dark:text-gray-100">
          <SlidersHorizontal size={14} /> Filters{hint ? ` (${hint})` : ''} <ChevronDown size={14} className={open ? 'rotate-180' : ''} />
        </button>
      </div>
      <div className={`${open ? 'flex' : 'hidden'} flex-wrap items-end gap-3 sm:flex`}>
        <label className="min-w-0 flex-[1_1_240px]">
          <span className={label}>Sector label</span>
          <select aria-label="Filter by sector label" value={filters.sector_label} onChange={(e) => set({ sector_label: e.target.value })} className={field}>
            <option value="">All sector labels ({sectors.length})</option>
            {sectors.map((s) => <option key={s.label} value={s.label}>{s.label} ({s.count})</option>)}
            {facets?.sector_none ? <option value="none">No sector label ({facets.sector_none})</option> : null}
          </select>
        </label>
        <label className="min-w-0 flex-[1_1_220px]">
          <span className={label}>Country</span>
          <select aria-label="Filter by country" value={filters.country} onChange={(e) => set({ country: e.target.value })} className={field}>
            <option value="">All countries ({countries.length})</option>
            {countries.map((c) => <option key={c.country} value={c.country}>{c.country} ({c.count})</option>)}
          </select>
        </label>
        <fieldset className="min-w-0 flex-[1_1_280px]">
          <legend className={label}>Founded between</legend>
          <div className="flex items-center gap-2">
            <input aria-label="Founded in or after" inputMode="numeric" placeholder="From" value={filters.founded_from}
              onChange={(e) => set({ founded_from: e.target.value.replace(/\D/g, '').slice(0, 4) })} className={field} />
            <span className="text-axal-faint">–</span>
            <input aria-label="Founded in or before" inputMode="numeric" placeholder="To" value={filters.founded_to}
              onChange={(e) => set({ founded_to: e.target.value.replace(/\D/g, '').slice(0, 4) })} className={field} />
          </div>
        </fieldset>
        <fieldset className="min-w-0 flex-[1_1_100%]">
          <legend className={label}>Only companies with</legend>
          <div className="flex flex-wrap gap-2">
            {HAS_OPTIONS.map((o) => {
              const on = filters.has.includes(o.value);
              const n = facets?.has?.[o.value];
              return (
                <label key={o.value} className={`inline-flex cursor-pointer items-center gap-2 rounded-full border px-3 py-1.5 text-[12px] ${on ? 'border-violet-500 bg-violet-50 text-violet-900 dark:bg-violet-950/40 dark:text-violet-100' : 'border-axal-hairline text-axal-muted dark:border-gray-700'}`}>
                  <input type="checkbox" checked={on} className="accent-violet-700"
                    onChange={() => set({ has: on ? filters.has.filter((h) => h !== o.value) : [...filters.has, o.value] })} />
                  {o.label}{n != null ? <span className="text-axal-faint">{n}</span> : null}
                </label>
              );
            })}
          </div>
        </fieldset>
      </div>
    </Card>
  );
}

function Cell({ children, sub }) {
  return <>{children}{sub ? <div className="mt-0.5 text-[11px] text-axal-faint">{sub}</div> : null}</>;
}

const muted = <span className="text-axal-faint">{NOT_RECORDED}</span>;

/** The results table. A missing value reads "Not recorded", never a dash or a zero. */
export function DirectoryTable({ items, coverage }) {
  const navigate = useNavigate();
  return (
    <Card padding="none" className="overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[920px] text-left text-[12px]">
          <thead className="bg-axal-ground text-[10px] font-extrabold uppercase tracking-[.08em] text-axal-faint dark:bg-gray-950">
            <tr>
              <th className="px-4 py-2.5">Company</th>
              <th className="px-4 py-2.5">Sector label</th>
              <th className="px-4 py-2.5">Country</th>
              <th className="px-4 py-2.5">Founded</th>
              <th className="px-4 py-2.5">Last round{coverage ? <div className="font-semibold normal-case tracking-normal">recorded for {coverage.fields?.last_round ?? 0}</div> : null}</th>
              <th className="px-4 py-2.5">Employees{coverage ? <div className="font-semibold normal-case tracking-normal">recorded for {coverage.fields?.headcount ?? 0}</div> : null}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-axal-hairline dark:divide-gray-800">
            {items.map((x) => {
              const round = lastRound(x);
              const staff = employees(x);
              return (
                <tr key={x.uid} role="link" tabIndex={0} onClick={() => navigate(companyHref(x.uid))}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); navigate(companyHref(x.uid)); } }}
                  className="cursor-pointer hover:bg-violet-50/40 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-violet-500 dark:hover:bg-violet-950/10">
                  <td className="px-4 py-3">
                    <Link to={companyHref(x.uid)} onClick={(e) => e.stopPropagation()} className="font-semibold text-axal-violet underline dark:text-violet-300">{x.name}</Link>
                    {x.website ? <div className="mt-0.5 max-w-[320px] truncate text-[11px] text-axal-faint">{x.website}</div> : null}
                  </td>
                  <td className="px-4 py-3 text-axal-muted">{x.sector || muted}</td>
                  <td className="px-4 py-3 text-axal-muted">{x.country || muted}</td>
                  <td className="px-4 py-3 font-mono text-axal-muted">{x.founded_year ?? muted}</td>
                  <td className="px-4 py-3 text-axal-ink dark:text-gray-100">{round ? <Cell sub={round.detail}>{round.amount}</Cell> : muted}</td>
                  <td className="px-4 py-3 text-axal-ink dark:text-gray-100">{staff ? <Cell sub={staff.growth}>{staff.count}</Cell> : muted}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

/** "Page 1 of 12", previous, the page buttons and next. */
export function Pager({ total, limit, offset, onPage }) {
  const w = pageWindow(total, limit, offset);
  if (w.pages <= 1) return null;
  const btn = 'min-w-[34px] rounded-lg border px-2.5 py-1.5 text-[12px] font-semibold disabled:opacity-40';
  return (
    <nav aria-label="Pages" className="flex flex-wrap items-center justify-between gap-2">
      <span className="text-[12px] text-axal-muted">Page {w.page} of {w.pages}</span>
      <div className="flex flex-wrap gap-1.5">
        <button type="button" className={`${btn} border-axal-hairline dark:border-gray-700`} disabled={w.page <= 1} onClick={() => onPage(w.page - 1)}>‹ Previous</button>
        {pageList(w.page, w.pages).map((p, k) => p === '…'
          ? <span key={`gap-${k}`} className="px-1.5 py-1.5 text-[12px] text-axal-faint">…</span>
          : <button key={p} type="button" aria-current={p === w.page ? 'page' : undefined} onClick={() => onPage(p)}
              className={`${btn} ${p === w.page ? 'border-violet-700 bg-violet-700 text-white' : 'border-axal-hairline dark:border-gray-700'}`}>{p}</button>)}
        <button type="button" className={`${btn} border-axal-hairline dark:border-gray-700`} disabled={w.page >= w.pages} onClick={() => onPage(w.page + 1)}>Next ›</button>
      </div>
    </nav>
  );
}

/**
 * The results: loading, unreadable, no result, or the count line, table and
 * pager. Search and filters stay usable in every state.
 */
export function DirectoryResults({ state, data, filters, onChange, onRetry }) {
  if (state === 'loading') {
    return <Card data-testid="company-results-loading"><p className="text-[12.5px] text-axal-muted">Loading companies…</p><p className="mt-1 text-[11px] text-axal-faint">No count is shown until the read answers.</p></Card>;
  }
  if (state === 'unreadable') {
    return (
      <Card data-testid="company-results-unreadable" className="border-red-200 bg-red-50/60 dark:border-red-900 dark:bg-red-950/20">
        <p className="text-[13px] font-bold text-red-900 dark:text-red-100">Read failed</p>
        <p className="mt-1 text-[12.5px] text-red-900 dark:text-red-100">The company directory did not answer.</p>
        <p className="mt-1 text-[11.5px] text-red-800/80 dark:text-red-200/80">No rows and no count are shown, because a failed read is not zero companies.</p>
        <button type="button" onClick={onRetry} className="mt-3 rounded-lg border border-red-300 bg-white px-3 py-1.5 text-[12px] font-semibold text-red-900 dark:border-red-800 dark:bg-transparent dark:text-red-100">Try again</button>
      </Card>
    );
  }
  if (state === 'empty') {
    const chips = activeFilters(filters);
    return (
      <Card data-testid="company-results-empty" variant="dashed">
        <p className="text-[13px] font-bold text-axal-ink dark:text-gray-100">
          {filters.q?.trim() ? <>No company matches “{filters.q.trim()}”{chips.length ? ' with these filters' : ''}.</> : 'No company matches these filters.'}
        </p>
        {chips.length ? (
          <div className="mt-3 flex flex-wrap gap-2">
            {chips.map((c) => (
              <span key={c.key} className="inline-flex items-center gap-1.5 rounded-full border border-axal-hairline px-2.5 py-1 text-[12px] text-axal-muted dark:border-gray-700">
                {c.label}
                <button type="button" aria-label={`Remove filter: ${c.label}`} onClick={() => onChange(withoutFilter(filters, c.key))} className="text-axal-faint hover:text-axal-ink dark:hover:text-gray-100"><X size={12} /></button>
              </span>
            ))}
          </div>
        ) : null}
        <p className="mt-3 text-[12px] text-axal-muted">Remove a filter, or search by website instead of name.</p>
        <button type="button" onClick={() => onChange({ ...EMPTY_FILTERS })} className="mt-3 rounded-lg border border-axal-hairline px-3 py-1.5 text-[12px] font-semibold dark:border-gray-700">Clear all filters</button>
      </Card>
    );
  }
  const w = pageWindow(data.total, data.limit, data.offset);
  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p data-testid="company-count" className="text-[12.5px] text-axal-muted"><strong className="text-axal-ink dark:text-gray-100">{w.from}–{w.to}</strong> of <strong className="text-axal-ink dark:text-gray-100">{w.total.toLocaleString('en-US')}</strong> companies</p>
        <label className="flex items-center gap-2 text-[12px] text-axal-muted">Rows per page
          <select aria-label="Rows per page" value={filters.limit} onChange={(e) => onChange({ ...filters, limit: Number(e.target.value), page: 1 })} className="rounded-lg border border-axal-hairline bg-white px-2 py-1 text-[12px] dark:border-gray-700 dark:bg-gray-950">
            {PAGE_SIZES.map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>
      </div>
      <DirectoryTable items={data.items} coverage={data.coverage} />
      <Pager total={data.total} limit={data.limit} offset={data.offset} onPage={(page) => onChange({ ...filters, page })} />
    </section>
  );
}

function useDebounced(value, ms) {
  const [v, setV] = useState(value);
  useEffect(() => { const t = setTimeout(() => setV(value), ms); return () => clearTimeout(t); }, [value, ms]);
  return v;
}

function Directory({ role, zoneActions, initial, onTotal }) {
  const [filters, setFilters] = useState({ ...EMPTY_FILTERS, ...initial });
  const [read, setRead] = useState({ loading: true, error: null, data: null });
  const [shape, setShape] = useState(null);
  const [open, setOpen] = useState(false);
  const q = useDebounced(filters.q, 300);
  const params = useMemo(() => directoryParams({ ...filters, q }), [filters, q]);
  const key = JSON.stringify(params);

  const [reads] = useState(latestOnly);
  const load = useCallback(async () => {
    const id = reads.next();
    setRead((r) => ({ ...r, loading: true, error: null }));
    try {
      const data = await researchCompaniesApi.list(JSON.parse(key));
      if (!reads.isCurrent(id)) return;
      setRead({ loading: false, error: null, data });
      setShape({ coverage: data.coverage, facets: data.facets });
      onTotal?.(data.coverage?.of ?? null);
    } catch (error) {
      if (!reads.isCurrent(id)) return;
      setRead({ loading: false, error, data: null });
    }
  }, [key, reads, onTotal]);
  useEffect(() => { load(); }, [load]);

  const state = listState(read);
  return (
    <>
      {zoneActions ? <ZoneToolbar role={role} className="mb-3" actions={zoneActions(read.data?.items || [])} /> : null}
      <CoverageCard coverage={shape?.coverage} />
      <DirectoryFilters filters={filters} facets={shape?.facets} onChange={setFilters} open={open} onToggle={() => setOpen((o) => !o)} />
      <DirectoryResults state={state} data={read.data} filters={filters} onChange={setFilters} onRetry={load} />
    </>
  );
}

const TABS = [
  { key: 'directory', label: 'Directory' },
  { key: 'analyses', label: 'Saved analyses' },
];

/**
 * D593 (the C0 board): the Directory tab carries the directory's size, from
 * the API's `coverage.of` — every company, not the filtered page — and no
 * number at all until one has been read. On Saved analyses, where the
 * directory is not mounted, one row is read for it.
 */
export function directoryTabLabel(total) {
  return Number.isFinite(total) ? `Directory (${total.toLocaleString('en-US')})` : 'Directory';
}

export default function CompanyDirectoryZone({ role = 'founder', zoneActions = null }) {
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') === 'analyses' ? 'analyses' : 'directory';
  const [total, setTotal] = useState(null);
  const onTotal = useCallback((n) => { if (Number.isFinite(n)) setTotal(n); }, []);
  useEffect(() => {
    if (tab !== 'analyses' || total != null) return undefined;
    let live = true;
    researchCompaniesApi.list({ limit: 1 })
      .then((data) => { if (live) onTotal(data?.coverage?.of ?? null); })
      .catch(() => {});
    return () => { live = false; };
  }, [tab, total, onTotal]);
  const pick = (key) => {
    const next = new URLSearchParams(params);
    if (key === 'directory') { next.delete('tab'); next.delete('market'); next.delete('website'); } else next.set('tab', key);
    setParams(next, { replace: true });
  };
  return (
    <div data-testid="company-directory" className="space-y-4">
      <div>
        <h1 className="text-xl font-extrabold tracking-tight text-axal-ink dark:text-gray-100">Companies</h1>
        <p className="mt-1 max-w-3xl text-[12.5px] leading-relaxed text-axal-muted">
          A public discovery baseline of companies from Wikidata. Search by name or website, then narrow by sector, country and founding year.
        </p>
      </div>
      <div role="tablist" aria-label="Companies" className="flex gap-1 border-b border-axal-hairline dark:border-gray-800">
        {TABS.map((t) => (
          <button key={t.key} type="button" role="tab" aria-selected={tab === t.key} onClick={() => pick(t.key)}
            className={`-mb-px border-b-2 px-3 py-2 text-[12.5px] font-semibold ${tab === t.key ? 'border-violet-700 text-violet-800 dark:text-violet-200' : 'border-transparent text-axal-muted hover:text-axal-ink dark:hover:text-gray-100'}`}>
            {t.key === 'directory' ? directoryTabLabel(total) : t.label}
          </button>
        ))}
      </div>
      {tab === 'directory' ? (
        <>
          <Directory role={role} zoneActions={zoneActions} onTotal={onTotal}
            initial={{ sector_label: params.get('sector_label') || '', country: params.get('country') || '' }} />
          <p className="text-[11px] leading-relaxed text-axal-faint">
            <strong>Source boundary:</strong> company records come from Wikidata (CC0); website links are references. Funding, revenue, headcount and market share appear only where a named source records them, with that source and its date. What no source holds reads “Not recorded”.
            {' '}<Link to="/research/gtm" className="inline-flex items-center gap-1 font-semibold text-axal-violet underline">Go-to-market intelligence <ExternalLink size={11} /></Link>
          </p>
        </>
      ) : (
        <Suspense fallback={<Card><p className="text-[12.5px] text-axal-muted">Loading saved analyses…</p></Card>}>
          <CompetitorAnalysis chromeless role={role} linkToDossier />
        </Suspense>
      )}
    </div>
  );
}
