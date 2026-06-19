import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ShieldAlert, RefreshCw, Info, ChevronDown } from 'lucide-react';
import { api } from '../lib/api';
import { reportError } from '../lib/log';
import { RISK_BAND_CELL, RISK_BAND_LABEL, shortLayerLabel } from '../lib/riskBands';

// Task #10 — portfolio Venture Risk matrix.
//
// Internal (admin/partner/investor) company × 10-layer heatmap. Rows are
// companies; columns are the ten risk layers plus an overall column. Each cell
// is a band-coloured de-risk score (0–100, higher = lower risk). Cells with no
// platform data render muted ("—") instead of a misleading red 0. Overridden
// cells carry a dot. Consumes GET /api/venture-risk/matrix.

function Cell({ cell }) {
  if (!cell || !cell.has_data) {
    return (
      <span
        className="inline-flex items-center justify-center w-10 h-8 rounded font-mono text-xs bg-slate-50 text-slate-300 dark:bg-slate-800/50 dark:text-slate-600"
        title="No data yet"
      >
        —
      </span>
    );
  }
  const cls = RISK_BAND_CELL[cell.band] || RISK_BAND_CELL.medium;
  return (
    <span
      className={`relative inline-flex items-center justify-center w-10 h-8 rounded font-mono text-xs ${cls}`}
      title={`${RISK_BAND_LABEL[cell.band] || ''}: ${cell.score}${cell.is_overridden ? ' (analyst override)' : ''}`}
    >
      {cell.score}
      {cell.is_overridden && (
        <span className="absolute top-0.5 right-0.5 w-1.5 h-1.5 rounded-full bg-violet-500" />
      )}
    </span>
  );
}

function HeaderCell({ field, label, sort, setSort, title }) {
  const active = sort.field === field;
  return (
    <th className="px-2 py-2 text-center">
      <button
        type="button"
        onClick={() => setSort({ field, dir: active && sort.dir === 'desc' ? 'asc' : 'desc' })}
        className={`inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide ${active ? 'text-violet-700 dark:text-violet-300' : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'}`}
        title={title || `Sort by ${label}`}
      >
        <span className="whitespace-nowrap">{label}</span>
        {active && <ChevronDown className={`w-3 h-3 ${sort.dir === 'asc' ? 'rotate-180' : ''}`} />}
      </button>
    </th>
  );
}

export default function RiskMatrixPage() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [unavailable, setUnavailable] = useState(false);
  const [sort, setSort] = useState({ field: 'name', dir: 'asc' });

  async function load() {
    setLoading(true);
    setErr('');
    setUnavailable(false);
    try {
      const res = await api.ventureRiskMatrix();
      setData(res);
    } catch (e) {
      if (e?.status === 404) {
        setUnavailable(true);
        setData(null);
      } else {
        reportError('RiskMatrixPage:load', e);
        setErr(e?.message || 'Failed to load risk matrix.');
      }
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, []);

  const layerMeta = data?.layer_meta || [];

  const sortedCompanies = useMemo(() => {
    const arr = [...(data?.companies || [])];
    arr.sort((a, b) => {
      let A;
      let B;
      if (sort.field === 'name') {
        A = (a.name || '').toLowerCase();
        B = (b.name || '').toLowerCase();
      } else if (sort.field === 'overall') {
        A = a.overall_score ?? 0;
        B = b.overall_score ?? 0;
      } else {
        A = a.layers?.[sort.field]?.score ?? 0;
        B = b.layers?.[sort.field]?.score ?? 0;
      }
      if (A < B) return sort.dir === 'asc' ? -1 : 1;
      if (A > B) return sort.dir === 'asc' ? 1 : -1;
      return (a.name || '').localeCompare(b.name || '');
    });
    return arr;
  }, [data, sort]);

  const colCount = layerMeta.length + 2; // company + layers + overall

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex items-start justify-between mb-6 gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
            <ShieldAlert className="w-6 h-6 text-violet-600" />
            Venture Risk Matrix
          </h1>
          <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
            Portfolio-wide de-risk confidence across the ten venture-risk layers. Each cell scores 0–100
            (higher = lower risk); a dot marks an analyst override. Click a company to open its risk panel.
          </p>
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="inline-flex items-center gap-1.5 px-3 py-2 text-sm border border-slate-300 dark:border-slate-600 rounded hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-50 dark:text-slate-200"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap items-center gap-3 mb-4 text-[11px] text-slate-500 dark:text-slate-400">
        <span className="inline-flex items-center gap-1.5">
          <span className={`w-4 h-4 rounded ${RISK_BAND_CELL.low}`} /> Low risk (67+)
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className={`w-4 h-4 rounded ${RISK_BAND_CELL.medium}`} /> Medium (34–66)
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className={`w-4 h-4 rounded ${RISK_BAND_CELL.high}`} /> High (&lt; 34)
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-violet-500" /> Analyst override
        </span>
      </div>

      {unavailable && (
        <div className="p-4 mb-4 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded flex items-start gap-2 text-amber-800 dark:text-amber-200 text-sm">
          <Info className="w-5 h-5 flex-shrink-0 mt-0.5" />
          <div>
            <div className="font-semibold">The risk matrix is unavailable in this environment.</div>
            <div>This dashboard runs on the production worker (D1). It will populate once deployed.</div>
          </div>
        </div>
      )}

      {err && (
        <div className="p-3 mb-3 bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-800 rounded text-rose-700 dark:text-rose-300 text-sm">
          {err}
        </div>
      )}

      {data && !unavailable && (
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
                {layerMeta.map((l) => (
                  <HeaderCell
                    key={l.key}
                    field={l.key}
                    label={shortLayerLabel(l.label)}
                    sort={sort}
                    setSort={setSort}
                    title={`${l.label}: ${l.thesis}`}
                  />
                ))}
                <HeaderCell field="overall" label="Overall" sort={sort} setSort={setSort} />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {loading && (
                <tr><td colSpan={colCount} className="px-4 py-8 text-center text-slate-400 text-sm">Loading…</td></tr>
              )}
              {!loading && sortedCompanies.length === 0 && (
                <tr><td colSpan={colCount} className="px-4 py-8 text-center text-slate-400 text-sm">No companies in scope.</td></tr>
              )}
              {!loading && sortedCompanies.map((co) => (
                <tr key={co.project_id}>
                  <td className="px-3 py-2 sticky left-0 bg-white dark:bg-gray-900 z-10">
                    <Link to={`/projects/${co.project_id}`} className="block group">
                      <div className="font-medium text-slate-900 dark:text-slate-100 group-hover:text-violet-600 dark:group-hover:text-violet-400">
                        {co.name}
                      </div>
                      <div className="text-[11px] text-slate-500 dark:text-slate-400">
                        {(co.sector || '—')}{co.stage ? ` · ${co.stage}` : ''}
                      </div>
                    </Link>
                  </td>
                  {layerMeta.map((l) => (
                    <td key={l.key} className="px-1 py-1 text-center">
                      <Cell cell={co.layers?.[l.key]} />
                    </td>
                  ))}
                  <td className="px-1 py-1 text-center">
                    <span
                      className={`inline-flex items-center justify-center w-10 h-8 rounded font-mono text-xs font-semibold ${RISK_BAND_CELL[co.overall_band] || RISK_BAND_CELL.medium}`}
                      title={`Overall ${RISK_BAND_LABEL[co.overall_band] || ''}: ${co.overall_score}`}
                    >
                      {co.overall_score}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
