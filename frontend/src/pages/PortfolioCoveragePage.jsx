import React, { useEffect, useMemo, useState } from 'react';
import { Network, RefreshCw, AlertTriangle, ChevronDown, Info } from 'lucide-react';
import PageExplainer from '../components/PageExplainer';
import { api } from '../lib/api';
import { reportError } from '../lib/log';

// Task #18 — Partner Coverage Analytics.
//
// Admin/partner-only portfolio-wide skill-gap heatmap. Rows are companies,
// columns are the 8 canonical radar axes. Each cell is the company's axis
// score (0–100); cells below the gap threshold are tinted. Companies with
// ≥3 gap axes are flagged. A footer row shows the portfolio aggregate
// (mean of per-company axis scores).

// Heatmap colour ramp keyed on a 0–100 score. Mirrors the radar gap cutoff
// (< 60 == under-covered) with a graduated scale above it.
function cellStyle(score) {
  if (score >= 80) return 'bg-emerald-100 text-emerald-900 dark:bg-emerald-900/40 dark:text-emerald-200';
  if (score >= 60) return 'bg-lime-100 text-lime-900 dark:bg-lime-900/30 dark:text-lime-200';
  if (score >= 40) return 'bg-amber-100 text-amber-900 dark:bg-amber-900/30 dark:text-amber-200';
  if (score >= 20) return 'bg-orange-100 text-orange-900 dark:bg-orange-900/30 dark:text-orange-200';
  return 'bg-rose-100 text-rose-900 dark:bg-rose-900/40 dark:text-rose-200';
}

function AxisHeader({ axis, sort, setSort }) {
  const active = sort.field === axis.slug;
  return (
    <th className="px-2 py-2 text-center">
      <button
        type="button"
        onClick={() => setSort({ field: axis.slug, dir: active && sort.dir === 'desc' ? 'asc' : 'desc' })}
        className={`inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide ${active ? 'text-violet-700 dark:text-violet-300' : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'}`}
        title={`Sort by ${axis.label}`}
      >
        <span className="whitespace-nowrap">{axis.label}</span>
        {active && <ChevronDown className={`w-3 h-3 ${sort.dir === 'asc' ? 'rotate-180' : ''}`} />}
      </button>
    </th>
  );
}

export default function PortfolioCoveragePage() {
  const [data, setData] = useState(null);
  const [funds, setFunds] = useState([]);
  const [fundId, setFundId] = useState('');
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);
  const [unavailable, setUnavailable] = useState(false);
  // True once the endpoint has answered at least once. Lets us tell apart a
  // genuine "fund not found" 404 (endpoint is live, in prod) from the dev
  // FastAPI backend simply not having the worker-only route at all.
  const [endpointLive, setEndpointLive] = useState(false);
  const [sort, setSort] = useState({ field: 'name', dir: 'asc' });

  // Fund list is best-effort — the selector just narrows the heatmap. A
  // failure here (e.g. dev backend) leaves the "All companies" view intact.
  useEffect(() => {
    api.fundsList()
      .then((res) => setFunds(res?.items || res?.funds || (Array.isArray(res) ? res : [])))
      .catch(() => setFunds([]));
  }, []);

  async function load() {
    setLoading(true); setErr(null); setUnavailable(false);
    try {
      const res = await api.portfolioCoverage(fundId || undefined);
      setEndpointLive(true);
      setData(res);
    } catch (e) {
      // The coverage endpoint is worker-only (D1); the dev FastAPI backend
      // 404s on the whole route. Only treat a 404 as "Fund not found" when we
      // KNOW the endpoint is live (it answered before) AND a fund is selected.
      // Otherwise any 404 means the route is absent (dev) → show the same
      // amber "unavailable" banner the other worker-only admin panels use.
      if (e?.status === 404 && endpointLive && fundId) {
        setErr('Fund not found.');
        setData(null);
      } else if (e?.status === 404) {
        setUnavailable(true);
        setData(null);
      } else {
        reportError('PortfolioCoveragePage:load', e);
        setErr(e.message || 'Failed to load coverage');
      }
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [fundId]);

  const axes = data?.axes || [];

  const sortedCompanies = useMemo(() => {
    const arr = [...(data?.companies || [])];
    arr.sort((a, b) => {
      let A; let B;
      if (sort.field === 'name') {
        A = (a.name || '').toLowerCase(); B = (b.name || '').toLowerCase();
      } else if (sort.field === 'gap_count') {
        A = a.gap_count; B = b.gap_count;
      } else {
        // Axis slug.
        A = a.axes?.[sort.field] ?? 0; B = b.axes?.[sort.field] ?? 0;
      }
      if (A < B) return sort.dir === 'asc' ? -1 : 1;
      if (A > B) return sort.dir === 'asc' ? 1 : -1;
      // Stable tiebreak by name.
      return (a.name || '').localeCompare(b.name || '');
    });
    return arr;
  }, [data, sort]);

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex items-start justify-between mb-6 gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
            <Network className="w-6 h-6 text-violet-600" />
            Portfolio Coverage
          </h1>
          <PageExplainer pageKey="portfolio_coverage" />
          <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
            Portfolio-wide skill coverage across the 8 radar axes. Cells below {data?.gap_threshold ?? 60} are
            under-covered; companies with 3+ gap axes are flagged for partner attention.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={fundId}
            onChange={(e) => setFundId(e.target.value)}
            className="text-sm border border-slate-300 dark:border-slate-600 rounded px-2 py-2 bg-white dark:bg-gray-900 dark:text-slate-100"
            aria-label="Filter by fund"
          >
            <option value="">All companies</option>
            {funds.map((f) => (
              <option key={f.id} value={f.id}>{f.name}</option>
            ))}
          </select>
          <button
            onClick={load}
            disabled={loading}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-sm border border-slate-300 dark:border-slate-600 rounded hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-50 dark:text-slate-200"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
      </div>

      {unavailable && (
        <div className="p-4 mb-4 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded flex items-start gap-2 text-amber-800 dark:text-amber-200 text-sm">
          <Info className="w-5 h-5 flex-shrink-0 mt-0.5" />
          <div>
            <div className="font-semibold">Coverage analytics is unavailable in this environment.</div>
            <div>This dashboard runs on the production worker (D1). It will populate once deployed.</div>
          </div>
        </div>
      )}

      {err && <div className="p-3 mb-3 bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-800 rounded text-rose-700 dark:text-rose-300 text-sm">{err}</div>}

      {data && !unavailable && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
            <SummaryCard label="Companies" value={data.company_count} />
            <SummaryCard label="Flagged (3+ gaps)" value={data.flagged_count} tone="rose" icon={<AlertTriangle className="w-4 h-4" />} />
            <SummaryCard label="Gap threshold" value={`< ${data.gap_threshold}`} />
            <SummaryCard label="Scope" value={data.fund ? data.fund.name : 'All companies'} />
          </div>

          <div className="bg-white dark:bg-gray-900 border border-slate-200 dark:border-slate-700 rounded-lg overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 dark:bg-slate-900/60 border-b border-slate-200 dark:border-slate-700">
                <tr>
                  <th className="px-3 py-2 text-left sticky left-0 bg-slate-50 dark:bg-slate-900/60 z-10">
                    <button
                      type="button"
                      onClick={() => setSort({ field: 'name', dir: sort.field === 'name' && sort.dir === 'asc' ? 'desc' : 'asc' })}
                      className={`inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide ${sort.field === 'name' ? 'text-violet-700 dark:text-violet-300' : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'}`}
                    >
                      Company
                      {sort.field === 'name' && <ChevronDown className={`w-3 h-3 ${sort.dir === 'asc' ? 'rotate-180' : ''}`} />}
                    </button>
                  </th>
                  {axes.map((axis) => (
                    <AxisHeader key={axis.slug} axis={axis} sort={sort} setSort={setSort} />
                  ))}
                  <th className="px-2 py-2 text-center">
                    <button
                      type="button"
                      onClick={() => setSort({ field: 'gap_count', dir: sort.field === 'gap_count' && sort.dir === 'desc' ? 'asc' : 'desc' })}
                      className={`inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide ${sort.field === 'gap_count' ? 'text-violet-700 dark:text-violet-300' : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'}`}
                      title="Sort by gap count"
                    >
                      Gaps
                      {sort.field === 'gap_count' && <ChevronDown className={`w-3 h-3 ${sort.dir === 'asc' ? 'rotate-180' : ''}`} />}
                    </button>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {loading && (
                  <tr><td colSpan={axes.length + 2} className="px-4 py-8 text-center text-slate-400 text-sm">Loading…</td></tr>
                )}
                {!loading && sortedCompanies.length === 0 && (
                  <tr><td colSpan={axes.length + 2} className="px-4 py-8 text-center text-slate-400 text-sm">No companies in scope.</td></tr>
                )}
                {!loading && sortedCompanies.map((co) => (
                  <tr key={co.uid} className={co.flagged ? 'bg-rose-50/40 dark:bg-rose-900/10' : ''}>
                    <td className="px-3 py-2 sticky left-0 bg-white dark:bg-gray-900 z-10">
                      <div className="flex items-center gap-2">
                        {co.flagged && <AlertTriangle className="w-3.5 h-3.5 text-rose-500 flex-shrink-0" title="3+ gap axes" />}
                        <div>
                          <div className="font-medium text-slate-900 dark:text-slate-100">{co.name}</div>
                          <div className="text-[11px] text-slate-500 dark:text-slate-400">
                            {(co.sector || '—')} · team {co.team_size}{!co.has_data && ' · no profile data'}
                          </div>
                        </div>
                      </div>
                    </td>
                    {axes.map((axis) => {
                      const score = co.axes?.[axis.slug] ?? 0;
                      const isGap = (co.gap_axes || []).includes(axis.slug);
                      return (
                        <td key={axis.slug} className="px-1 py-1 text-center">
                          <span
                            className={`inline-flex items-center justify-center w-10 h-8 rounded font-mono text-xs ${cellStyle(score)} ${isGap ? 'ring-1 ring-rose-400/60' : ''}`}
                            title={`${axis.label}: ${score}${isGap ? ' (gap)' : ''}`}
                          >
                            {score}
                          </span>
                        </td>
                      );
                    })}
                    <td className="px-2 py-2 text-center">
                      <span className={`inline-flex items-center justify-center min-w-[1.5rem] px-1.5 py-0.5 rounded-full text-xs font-semibold ${co.flagged ? 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300' : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'}`}>
                        {co.gap_count}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
              {!loading && sortedCompanies.length > 0 && data.aggregate && (
                <tfoot className="border-t-2 border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/60">
                  <tr>
                    <td className="px-3 py-2 sticky left-0 bg-slate-50 dark:bg-slate-900/60 z-10 text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">
                      Portfolio average
                    </td>
                    {axes.map((axis) => {
                      const v = data.aggregate[axis.slug] ?? 0;
                      return (
                        <td key={axis.slug} className="px-1 py-2 text-center">
                          <span className={`inline-flex items-center justify-center w-10 h-8 rounded font-mono text-xs font-semibold ${cellStyle(v)}`}>
                            {Number.isInteger(v) ? v : v.toFixed(1)}
                          </span>
                        </td>
                      );
                    })}
                    <td className="px-2 py-2" />
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </>
      )}
    </div>
  );
}

function SummaryCard({ label, value, tone, icon }) {
  const toneMap = {
    rose: 'bg-rose-50 dark:bg-rose-900/20 border-rose-200 dark:border-rose-800 text-rose-800 dark:text-rose-200',
    default: 'bg-white dark:bg-gray-900 border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-200',
  };
  return (
    <div className={`p-4 rounded border ${toneMap[tone] || toneMap.default}`}>
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">{label}</span>
        {icon}
      </div>
      <div className="text-xl font-bold mt-1 truncate">{value}</div>
    </div>
  );
}
