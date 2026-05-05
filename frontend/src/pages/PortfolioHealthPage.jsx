import React, { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Activity, AlertTriangle, ArrowUpRight, RefreshCw, ChevronDown,
  Heart, TrendingDown, TrendingUp, Filter,
} from 'lucide-react';
import { api } from '../lib/api';

const BADGE_STYLES = {
  green:  { bg: 'bg-emerald-50', border: 'border-emerald-200', dot: 'bg-emerald-500', text: 'text-emerald-700', label: 'Healthy' },
  yellow: { bg: 'bg-amber-50',   border: 'border-amber-200',   dot: 'bg-amber-500',   text: 'text-amber-700',   label: 'Watch' },
  red:    { bg: 'bg-rose-50',    border: 'border-rose-200',    dot: 'bg-rose-500',    text: 'text-rose-700',    label: 'Critical' },
};

function BadgePill({ badge }) {
  const s = BADGE_STYLES[badge] || BADGE_STYLES.yellow;
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${s.bg} ${s.text} border ${s.border}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${s.dot}`} />
      {s.label}
    </span>
  );
}

function fmtPct(v) {
  if (v === null || v === undefined) return '—';
  return `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`;
}
function fmtMonths(v) {
  if (v === null || v === undefined) return '—';
  if (v >= 60) return '60+ mo';
  return `${v.toFixed(1)} mo`;
}
function fmtDelta(v, suffix = 'pp') {
  if (v === null || v === undefined) return '—';
  return `${v >= 0 ? '+' : ''}${v.toFixed(2)}${suffix}`;
}

function SortHeader({ label, field, sort, setSort }) {
  const active = sort.field === field;
  return (
    <button
      type="button"
      onClick={() => setSort({ field, dir: active && sort.dir === 'asc' ? 'desc' : 'asc' })}
      className={`inline-flex items-center gap-1 text-xs font-semibold uppercase tracking-wide ${active ? 'text-purple-700' : 'text-slate-500 hover:text-slate-700'}`}
    >
      {label}
      {active && <ChevronDown className={`w-3 h-3 ${sort.dir === 'asc' ? 'rotate-180' : ''}`} />}
    </button>
  );
}

function DetailDrawer({ projectUid, onClose }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);

  useEffect(() => {
    if (!projectUid) return;
    setData(null); setErr(null);
    api.portfolioHealthGet(projectUid, 30)
      .then(setData)
      .catch(e => setErr(e.message || 'Failed to load'));
  }, [projectUid]);

  if (!projectUid) return null;
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-stretch justify-end" onClick={onClose}>
      <div className="bg-white w-full max-w-xl h-full overflow-y-auto shadow-xl" onClick={e => e.stopPropagation()}>
        <div className="sticky top-0 bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">{data?.project?.name || 'Project health'}</h2>
            <p className="text-xs text-slate-500">{data?.project?.sector || ''} · {data?.project?.stage || ''}</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-2xl leading-none">×</button>
        </div>
        {err && <div className="m-6 p-4 bg-rose-50 border border-rose-200 rounded text-rose-700 text-sm">{err}</div>}
        {!data && !err && <div className="p-6 text-slate-500 text-sm">Loading…</div>}
        {data && data.latest && (
          <div className="p-6 space-y-6">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-4xl font-bold text-slate-900">{data.latest.score.toFixed(0)}<span className="text-base text-slate-400">/100</span></div>
                <div className="mt-1"><BadgePill badge={data.latest.badge} /></div>
              </div>
              <button
                onClick={async () => {
                  try {
                    const r = await api.portfolioHealthRecomputeOne(projectUid);
                    setData({ ...data, latest: r, history: [r, ...(data.history || []).filter(h => h.uid !== r.uid)] });
                  } catch (e) { setErr(e.message); }
                }}
                className="inline-flex items-center gap-1.5 px-3 py-2 text-sm border border-slate-300 rounded hover:bg-slate-50"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                Recompute
              </button>
            </div>

            {data.latest.intervention && (
              <div className="p-4 bg-rose-50 border border-rose-200 rounded">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="w-5 h-5 text-rose-600 flex-shrink-0 mt-0.5" />
                  <div>
                    <div className="font-semibold text-rose-900">Intervention recommended</div>
                    <ul className="mt-1 text-sm text-rose-700 list-disc list-inside space-y-0.5">
                      {data.latest.reasons.map((r, i) => <li key={i}>{r}</li>)}
                    </ul>
                  </div>
                </div>
              </div>
            )}

            <div>
              <h3 className="text-sm font-semibold text-slate-700 mb-3">Signals</h3>
              <div className="grid grid-cols-2 gap-3">
                <SignalCard label="Runway" value={fmtMonths(data.latest.runway_months)} component={data.latest.components?.runway} />
                <SignalCard label="Growth velocity" value={fmtPct(data.latest.growth_velocity)} component={data.latest.components?.growth} />
                <SignalCard label="Churn delta" value={fmtDelta(data.latest.churn_delta)} component={data.latest.components?.churn} />
                <SignalCard label="Sentiment delta" value={data.latest.sentiment_delta === null ? '—' : data.latest.sentiment_delta.toFixed(2)} component={data.latest.components?.sentiment} />
              </div>
            </div>

            <div>
              <h3 className="text-sm font-semibold text-slate-700 mb-3">Score history (last {data.history.length} snapshots)</h3>
              <div className="space-y-1">
                {data.history.slice(0, 14).map(h => (
                  <div key={h.uid} className="flex items-center justify-between text-sm py-1.5 border-b border-slate-100">
                    <span className="text-slate-600">{h.snapshot_date}</span>
                    <span className="flex items-center gap-2">
                      <span className="font-mono text-slate-900">{h.score.toFixed(0)}</span>
                      <BadgePill badge={h.badge} />
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
        {data && !data.latest && (
          <div className="p-6 text-slate-500 text-sm">No health snapshot for this project yet. Run a recompute to generate one.</div>
        )}
      </div>
    </div>
  );
}

function SignalCard({ label, value, component }) {
  const sub = component?.score === null || component?.score === undefined
    ? 'no signal yet'
    : `${(component.score * 100).toFixed(0)}/100 sub-score`;
  const w = component?.weight ? `${(component.weight * 100).toFixed(0)}%` : '';
  return (
    <div className="p-3 bg-slate-50 border border-slate-200 rounded">
      <div className="flex items-center justify-between text-xs text-slate-500">
        <span>{label}</span>
        {w && <span className="text-slate-400">{w}</span>}
      </div>
      <div className="mt-1 text-xl font-semibold text-slate-900">{value}</div>
      <div className="text-xs text-slate-400 mt-0.5">{sub}</div>
    </div>
  );
}

export default function PortfolioHealthPage() {
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState({ badge: '', interventionOnly: false });
  const [sort, setSort] = useState({ field: 'score', dir: 'asc' });
  const [params, setParams] = useSearchParams();
  const drawerUid = params.get('project');

  async function load() {
    setLoading(true); setErr(null);
    try {
      const r = await api.portfolioHealthList({
        badge: filter.badge || undefined,
        interventionOnly: filter.interventionOnly,
      });
      setData(r);
    } catch (e) {
      const msg = (e?.message || '').toLowerCase();
      if (e?.status === 404 || msg === 'not found') {
        setData({ items: [], totals: { green: 0, yellow: 0, red: 0, intervention: 0 }, as_of: null });
      } else {
        setErr(e.message || 'Failed to load');
      }
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [filter.badge, filter.interventionOnly]);

  const sorted = useMemo(() => {
    if (!data?.items) return [];
    const arr = [...data.items];
    arr.sort((a, b) => {
      const get = (x) => {
        switch (sort.field) {
          case 'name':    return x.project?.name?.toLowerCase() || '';
          case 'badge':   return ({ red: 0, yellow: 1, green: 2 })[x.badge] ?? 3;
          case 'score':   return x.score;
          case 'runway':  return x.runway_months ?? 999;
          case 'growth':  return x.growth_velocity ?? -999;
          case 'churn':   return x.churn_delta ?? 0;
          default:        return x.score;
        }
      };
      const A = get(a), B = get(b);
      if (A < B) return sort.dir === 'asc' ? -1 : 1;
      if (A > B) return sort.dir === 'asc' ? 1 : -1;
      return 0;
    });
    return arr;
  }, [data, sort]);

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
            <Heart className="w-6 h-6 text-purple-600" />
            Portfolio health
          </h1>
          <p className="text-sm text-slate-600 mt-1">
            Daily score per company from runway, growth, churn, and founder sentiment.
            {data?.as_of && <span className="ml-2 text-slate-400">As of {data.as_of}</span>}
          </p>
        </div>
        <button
          onClick={async () => {
            setBusy(true); setErr(null);
            try {
              await api.portfolioHealthRecomputeAll();
              await load();
            } catch (e) { setErr(e.message); }
            finally { setBusy(false); }
          }}
          disabled={busy}
          className="inline-flex items-center gap-1.5 px-3 py-2 text-sm bg-purple-600 text-white rounded hover:bg-purple-700 disabled:opacity-50"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${busy ? 'animate-spin' : ''}`} />
          Recompute all
        </button>
      </div>

      {data?.totals && (
        <div className="grid grid-cols-4 gap-3 mb-4">
          <SummaryCard label="Healthy" value={data.totals.green} icon={<TrendingUp className="w-4 h-4" />} color="emerald" />
          <SummaryCard label="Watch" value={data.totals.yellow} icon={<Activity className="w-4 h-4" />} color="amber" />
          <SummaryCard label="Critical" value={data.totals.red} icon={<TrendingDown className="w-4 h-4" />} color="rose" />
          <SummaryCard label="Intervention needed" value={data.totals.intervention} icon={<AlertTriangle className="w-4 h-4" />} color="rose" />
        </div>
      )}

      <div className="flex items-center gap-3 mb-3">
        <Filter className="w-4 h-4 text-slate-400" />
        <select
          value={filter.badge}
          onChange={(e) => setFilter({ ...filter, badge: e.target.value })}
          className="text-sm border border-slate-300 rounded px-2 py-1"
        >
          <option value="">All statuses</option>
          <option value="green">Healthy</option>
          <option value="yellow">Watch</option>
          <option value="red">Critical</option>
        </select>
        <label className="text-sm text-slate-600 inline-flex items-center gap-1.5">
          <input
            type="checkbox"
            checked={filter.interventionOnly}
            onChange={(e) => setFilter({ ...filter, interventionOnly: e.target.checked })}
          />
          Intervention only
        </label>
      </div>

      {err && <div className="p-3 mb-3 bg-rose-50 border border-rose-200 rounded text-rose-700 text-sm">{err}</div>}

      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <table className="min-w-full divide-y divide-slate-200">
          <thead className="bg-slate-50">
            <tr>
              <th className="px-4 py-2 text-left"><SortHeader label="Company" field="name" sort={sort} setSort={setSort} /></th>
              <th className="px-4 py-2 text-left"><SortHeader label="Status" field="badge" sort={sort} setSort={setSort} /></th>
              <th className="px-4 py-2 text-right"><SortHeader label="Score" field="score" sort={sort} setSort={setSort} /></th>
              <th className="px-4 py-2 text-right"><SortHeader label="Runway" field="runway" sort={sort} setSort={setSort} /></th>
              <th className="px-4 py-2 text-right"><SortHeader label="Growth" field="growth" sort={sort} setSort={setSort} /></th>
              <th className="px-4 py-2 text-right"><SortHeader label="Churn Δ" field="churn" sort={sort} setSort={setSort} /></th>
              <th className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Top reason</th>
              <th className="px-4 py-2"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading && <tr><td colSpan={8} className="px-4 py-8 text-center text-slate-400 text-sm">Loading…</td></tr>}
            {!loading && sorted.length === 0 && (
              <tr><td colSpan={8} className="px-4 py-8 text-center text-slate-400 text-sm">No snapshots yet. Click "Recompute all" to generate the first sweep.</td></tr>
            )}
            {sorted.map(it => (
              <tr key={it.uid} className={it.intervention ? 'bg-rose-50/30' : ''}>
                <td className="px-4 py-3">
                  <div className="font-medium text-slate-900">{it.project?.name || `Project #${it.project_id}`}</div>
                  <div className="text-xs text-slate-500">{it.project?.sector || ''} · {it.project?.stage || ''}</div>
                </td>
                <td className="px-4 py-3"><BadgePill badge={it.badge} /></td>
                <td className="px-4 py-3 text-right font-mono text-sm">{it.score.toFixed(0)}</td>
                <td className="px-4 py-3 text-right text-sm text-slate-600">{fmtMonths(it.runway_months)}</td>
                <td className="px-4 py-3 text-right text-sm text-slate-600">{fmtPct(it.growth_velocity)}</td>
                <td className="px-4 py-3 text-right text-sm text-slate-600">{fmtDelta(it.churn_delta)}</td>
                <td className="px-4 py-3 text-xs text-slate-500 max-w-xs truncate">{it.reasons?.[0] || ''}</td>
                <td className="px-4 py-3 text-right">
                  <button
                    onClick={() => setParams({ project: it.project?.uid || '' })}
                    className="inline-flex items-center gap-1 text-xs text-purple-700 hover:text-purple-900"
                  >
                    Details <ArrowUpRight className="w-3 h-3" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <DetailDrawer projectUid={drawerUid} onClose={() => { params.delete('project'); setParams(params); }} />
    </div>
  );
}

function SummaryCard({ label, value, icon, color }) {
  const map = {
    emerald: 'bg-emerald-50 border-emerald-200 text-emerald-800',
    amber:   'bg-amber-50 border-amber-200 text-amber-800',
    rose:    'bg-rose-50 border-rose-200 text-rose-800',
  };
  return (
    <div className={`p-4 rounded border ${map[color]}`}>
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium uppercase tracking-wide">{label}</span>
        {icon}
      </div>
      <div className="text-2xl font-bold mt-1">{value}</div>
    </div>
  );
}
