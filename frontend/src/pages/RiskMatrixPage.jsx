// Portfolio Risk Matrix — a heatmap of every active company × the 10 venture
// risk layers, for the internal deal team. Cells are band-coloured by residual
// risk; the overall Derisking Score column sorts the book from most to least
// derisked. Click a company to open its full risk panel on the project page.
import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ShieldAlert, ArrowUpDown, Loader2 } from 'lucide-react';
import { api } from '../lib/api';

const CELL = {
  low:    'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300',
  medium: 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300',
  high:   'bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300',
};
const SHORT = {
  founder: 'Founder', market: 'Market', competition: 'Compete', timing: 'Timing',
  financing: 'Finance', marketing: 'Mktg', distribution: 'Distrib',
  technology: 'Tech', product: 'Product', hiring: 'Hiring',
};

function deriskTone(score) {
  if (score == null) return 'text-gray-400';
  if (score >= 67) return 'text-emerald-600';
  if (score >= 34) return 'text-amber-600';
  return 'text-red-600';
}

export default function RiskMatrixPage() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [sortBy, setSortBy] = useState('risk'); // 'risk' | 'name'

  useEffect(() => {
    setLoading(true);
    api.getVentureRiskPortfolio()
      .then(setData)
      .catch((e) => setError(e.message || 'Failed to load portfolio risk'))
      .finally(() => setLoading(false));
  }, []);

  const rows = useMemo(() => {
    const list = [...(data?.projects || [])];
    if (sortBy === 'name') {
      list.sort((a, b) => (a.project_name || '').localeCompare(b.project_name || ''));
    } else {
      // Most derisked first; unassessed sink to the bottom.
      list.sort((a, b) => (b.derisk_score ?? -1) - (a.derisk_score ?? -1));
    }
    return list;
  }, [data, sortBy]);

  const layers = data?.layers || [];

  if (loading) {
    return <div className="flex items-center gap-2 text-gray-500 py-20 justify-center"><Loader2 className="animate-spin" size={16} /> Loading portfolio risk…</div>;
  }
  if (error) return <div className="text-red-600 text-center py-20 text-sm">{error}</div>;

  return (
    <div>
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-3 mb-5">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2 dark:text-gray-100">
            <ShieldAlert size={22} className="text-violet-600" /> Portfolio Risk Matrix
          </h1>
          <p className="text-sm text-gray-600 dark:text-gray-400">
            Residual risk per layer across the book. Every funding round removes risk — track which layers each company still needs to derisk.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 text-[11px] text-gray-500">
            <span className="px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700">low</span>
            <span className="px-1.5 py-0.5 rounded bg-amber-100 text-amber-700">medium</span>
            <span className="px-1.5 py-0.5 rounded bg-red-100 text-red-700">high</span>
          </div>
          <button
            onClick={() => setSortBy((s) => (s === 'risk' ? 'name' : 'risk'))}
            className="text-xs px-2.5 py-1.5 rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-50 inline-flex items-center gap-1 dark:border-gray-700"
          >
            <ArrowUpDown size={12} /> Sort: {sortBy === 'risk' ? 'Derisked' : 'Name'}
          </button>
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="text-sm text-gray-500 text-center py-16 border border-dashed border-gray-200 rounded-xl dark:border-gray-800">
          No active projects to assess yet.
        </div>
      ) : (
        <div className="overflow-x-auto border border-gray-200 rounded-xl dark:border-gray-800">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="bg-gray-50 dark:bg-gray-800/60">
                <th className="text-left px-3 py-2.5 text-gray-600 font-medium text-xs sticky left-0 bg-gray-50 dark:bg-gray-800/60 z-10">Company</th>
                <th className="px-2 py-2.5 text-gray-600 font-medium text-xs">Derisk</th>
                {layers.map((l) => (
                  <th key={l.key} className="px-1.5 py-2.5 text-gray-600 font-medium text-[10px] uppercase tracking-wide" title={l.label}>
                    {SHORT[l.key] || l.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => {
                const byKey = new Map((p.layers || []).map((l) => [l.key, l]));
                return (
                  <tr key={p.project_id} className="border-t border-gray-100 hover:bg-violet-50/40 dark:border-gray-800 dark:hover:bg-violet-500/5">
                    <td className="px-3 py-2 sticky left-0 bg-white hover:bg-violet-50/40 dark:bg-gray-900 z-10">
                      <Link to={`/projects/${p.project_id}`} className="text-gray-900 font-medium hover:text-violet-700 dark:text-gray-100">
                        {p.project_name}
                      </Link>
                      {!p.assessed && <span className="ml-2 text-[10px] text-gray-400">not assessed</span>}
                      {p.assessed && !p.saved && <span className="ml-2 text-[10px] text-amber-500" title="Live preview — open the company to save">preview</span>}
                    </td>
                    <td className="px-2 py-2 text-center">
                      <span className={`font-bold ${deriskTone(p.derisk_score)}`}>{p.derisk_score ?? '—'}</span>
                    </td>
                    {layers.map((meta) => {
                      const l = byKey.get(meta.key);
                      if (!l) return <td key={meta.key} className="px-1.5 py-2 text-center text-gray-300">—</td>;
                      return (
                        <td key={meta.key} className="px-1 py-1.5 text-center">
                          <span
                            className={`inline-block min-w-[26px] px-1.5 py-0.5 rounded text-[11px] font-semibold ${CELL[l.band] || ''}`}
                            title={`${meta.label}: risk ${l.risk}/100${l.status && l.status !== 'open' ? ` · ${l.status}` : ''}`}
                          >
                            {l.risk}
                          </span>
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
