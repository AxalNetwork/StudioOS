import React, { useState, useEffect } from 'react';
import PageExplainer from '../components/PageExplainer';
import { Link, useSearchParams } from 'react-router-dom';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { Plus, Trash2, AlertCircle, Save, X, Download, TrendingUp, FolderPlus } from 'lucide-react';
import { api } from '../lib/api';

const FIELDS = [
  { key: 'mrr', label: 'MRR', unit: '$' },
  { key: 'arr', label: 'ARR', unit: '$', hint: 'Auto-fills as MRR×12 if blank' },
  { key: 'cac', label: 'CAC', unit: '$' },
  { key: 'ltv', label: 'LTV', unit: '$' },
  { key: 'monthly_churn_pct', label: 'Monthly churn', unit: '%' },
  { key: 'active_users', label: 'Active users', unit: '' },
  { key: 'new_users', label: 'New users (period)', unit: '' },
];

function emptySnapshot() {
  return {
    snapshot_date: new Date().toISOString().slice(0, 10),
    mrr: '', arr: '', cac: '', ltv: '', monthly_churn_pct: '', active_users: '', new_users: '', notes: '',
  };
}

function fmt(v, unit) {
  if (v === null || v === undefined || v === '') return '—';
  const n = Number(v);
  if (!isFinite(n)) return '—';
  if (unit === '$') {
    if (Math.abs(n) >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
    if (Math.abs(n) >= 1e3) return `$${(n / 1e3).toFixed(1)}k`;
    return `$${n.toFixed(0)}`;
  }
  if (unit === '%') return `${n.toFixed(1)}%`;
  return n.toLocaleString();
}

export default function MetricsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [projects, setProjects] = useState([]);
  const [projectId, setProjectId] = useState(null);
  const [snapshots, setSnapshots] = useState([]);
  const [signals, setSignals] = useState(null);
  const [adding, setAdding] = useState(null);
  const [error, setError] = useState(null);
  const [importing, setImporting] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const list = await api.listProjects();
        const safeList = list || [];
        setProjects(safeList);
        const fromQuery = parseInt(searchParams.get('project_id'), 10);
        if (fromQuery && safeList.find((p) => p.id === fromQuery)) {
          setProjectId(fromQuery);
        } else if (safeList.length > 0) {
          // Stale ?project_id in URL (project was deleted, or never visible
          // to this user) — fall back to the first available without
          // surfacing a scary error.
          if (fromQuery) setSearchParams({}, { replace: true });
          setProjectId(safeList[0].id);
        }
      } catch (e) {
        // Defensive 404 — backend may return "Not found" when the user has
        // no project scope yet. Treat as the same "no projects" empty state
        // rendered below; don't surface a raw red banner.
        const msg = (e?.message || '').toLowerCase();
        if (e?.status === 404 || msg.includes('not found')) {
          setProjects([]);
        } else {
          setError(e.message || 'Failed to load startups.');
        }
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!projectId) return;
    setSearchParams({ project_id: String(projectId) }, { replace: true });
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  async function refresh() {
    if (!projectId) return;
    try {
      setError(null);
      const [r1, r2] = await Promise.all([
        api.listMetricsSnapshots(projectId),
        api.getProgressSignals(projectId),
      ]);
      setSnapshots(r1.snapshots || []);
      setSignals(r2);
    } catch (e) {
      // 404 here means the selected project was deleted out from under us
      // (or the user lost access). Recover by clearing state — don't
      // splash a red banner over a perfectly-loadable picker.
      const msg = (e?.message || '').toLowerCase();
      if (e?.status === 404 || msg.includes('not found')) {
        setSnapshots([]);
        setSignals(null);
        setError(`Startup #${projectId} is no longer available. Pick another startup from the dropdown.`);
      } else {
        setError(e.message || 'Failed to load metrics.');
      }
    }
  }

  async function handleSave() {
    try {
      const payload = {
        snapshot_date: adding.snapshot_date,
        notes: adding.notes || null,
      };
      for (const f of FIELDS) {
        const v = adding[f.key];
        payload[f.key] = v === '' || v === null || v === undefined ? null : Number(v);
      }
      await api.createMetricsSnapshot(projectId, payload);
      setAdding(null);
      await refresh();
    } catch (e) {
      const msg = (e?.message || '').toLowerCase();
      if (e?.status === 404 || msg.includes('not found')) {
        setError(`Can't save: project #${projectId} is no longer available. Pick another project from the dropdown.`);
      } else {
        setError(e.message || 'Failed to save snapshot.');
      }
    }
  }

  async function handleDelete(id) {
    if (!confirm('Delete this snapshot?')) return;
    try {
      await api.deleteMetricsSnapshot(id);
      await refresh();
    } catch (e) {
      const msg = (e?.message || '').toLowerCase();
      if (e?.status === 404 || msg.includes('not found')) {
        // Already gone — refresh to drop it from the list, no banner needed.
        await refresh();
      } else {
        setError(e.message || 'Failed to delete snapshot.');
      }
    }
  }

  async function handleStripeImport() {
    setImporting(true);
    setError(null);
    try {
      await api.importMetricsFromStripe(projectId);
      await refresh();
    } catch (e) {
      const code = e.data?.code;
      if (code === 'stripe_not_connected') {
        setError('Stripe billing is not connected. Use manual entry below.');
      } else if (code === 'stripe_no_data') {
        setError('Stripe is connected but has no synced billing data yet.');
      } else {
        setError(e.message);
      }
    } finally { setImporting(false); }
  }

  // Build chart series (oldest first)
  const series = [...snapshots].reverse().map((s) => ({
    date: s.snapshot_date,
    mrr: s.mrr,
    active_users: s.active_users,
  }));

  const latest = snapshots[0];
  const hasProjects = projects.length > 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900 dark:text-gray-100">Metrics</h1>
          <PageExplainer pageKey="metrics" />
        </div>
        <div className="flex gap-2">
          <select
            value={projectId || ''}
            onChange={(e) => setProjectId(parseInt(e.target.value, 10))}
            disabled={!hasProjects}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white disabled:bg-gray-50 disabled:text-gray-400 dark:border-gray-700 dark:bg-gray-900"
          >
            {!hasProjects && <option value="">No startups available</option>}
            {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <button
            onClick={handleStripeImport}
            disabled={importing || !projectId}
            className="flex items-center gap-2 px-3 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700"
          >
            <Download size={14} /> {importing ? 'Importing…' : 'Import from Stripe'}
          </button>
          <button
            onClick={() => setAdding(emptySnapshot())}
            disabled={!projectId}
            className="flex items-center gap-2 bg-violet-600 hover:bg-violet-700 text-white rounded-lg px-3 py-2 text-sm font-medium disabled:opacity-50 disabled:hover:bg-violet-600"
          >
            <Plus size={14} /> Snapshot
          </button>
        </div>
      </div>

      {error && <div className="flex items-start gap-2 bg-rose-50 border border-rose-200 text-rose-700 rounded-lg px-4 py-3 text-sm"><AlertCircle size={16} className="mt-0.5" />{error}</div>}

      {!hasProjects && (
        <div className="bg-white border border-dashed border-gray-300 rounded-xl p-10 text-center dark:bg-gray-900 dark:border-gray-700">
          <FolderPlus size={32} className="mx-auto text-gray-400 mb-3" />
          <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">No startups yet</h2>
          <p className="text-sm text-gray-500 mt-1 max-w-md mx-auto">
            Metrics snapshots are scoped to a startup. Create or join one first, then come back here to start tracking MRR, CAC, LTV and churn.
          </p>
          <Link
            to="/projects"
            className="inline-flex items-center gap-2 mt-4 bg-violet-600 hover:bg-violet-700 text-white rounded-lg px-4 py-2 text-sm font-medium"
          >
            <Plus size={14} /> Go to Startups
          </Link>
        </div>
      )}

      {hasProjects && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Stat label="MRR" value={fmt(latest?.mrr, '$')} sub={latest ? `as of ${latest.snapshot_date}` : 'No data'} />
          <Stat label="Active users" value={fmt(latest?.active_users, '')} />
          <Stat label="LTV / CAC" value={latest && latest.cac && latest.ltv ? (latest.ltv / latest.cac).toFixed(2) : '—'} />
          <Stat label="Traction score" value={signals ? `${signals.total} / ${signals.max}` : '—'} sub="Feeds scoring engine" tone="violet" />
        </div>
      )}

      {series.length > 1 && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="bg-white border border-gray-200 rounded-xl p-5 dark:bg-gray-900 dark:border-gray-800">
            <h3 className="text-sm font-semibold text-gray-900 mb-2 dark:text-gray-100">MRR over time</h3>
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={series}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="date" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => fmt(v, '$')} />
                <Tooltip formatter={(v) => fmt(v, '$')} />
                <Line type="monotone" dataKey="mrr" stroke="#7c3aed" strokeWidth={2} dot />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <div className="bg-white border border-gray-200 rounded-xl p-5 dark:bg-gray-900 dark:border-gray-800">
            <h3 className="text-sm font-semibold text-gray-900 mb-2 dark:text-gray-100">Active users over time</h3>
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={series}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="date" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} />
                <Tooltip />
                <Line type="monotone" dataKey="active_users" stroke="#0ea5e9" strokeWidth={2} dot />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {hasProjects && (
      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden dark:bg-gray-900 dark:border-gray-800">
        <div className="px-5 py-3 border-b border-gray-200 flex items-center justify-between dark:border-gray-800">
          <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Snapshot history</h3>
          <span className="text-xs text-gray-500">{snapshots.length} entries</span>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="text-xs uppercase tracking-wide text-gray-500 bg-gray-50">
                <th className="text-left py-2 px-4">Date</th>
                <th className="text-left py-2 px-3">Source</th>
                {FIELDS.map((f) => <th key={f.key} className="text-right py-2 px-3">{f.label}</th>)}
                <th className="px-3"></th>
              </tr>
            </thead>
            <tbody>
              {snapshots.length === 0 && (
                <tr><td colSpan={FIELDS.length + 3} className="text-center text-gray-400 py-8 italic">No snapshots yet</td></tr>
              )}
              {snapshots.map((s) => (
                <tr key={s.id} className="border-t border-gray-100">
                  <td className="py-2 px-4 font-medium text-gray-900 dark:text-gray-100">{s.snapshot_date}</td>
                  <td className="py-2 px-3">
                    <span className={`text-[10px] px-2 py-0.5 rounded-full ${s.source === 'stripe' ? 'bg-violet-50 text-violet-700' : 'bg-gray-100 text-gray-600'}`}>
                      {s.source}
                    </span>
                  </td>
                  {FIELDS.map((f) => <td key={f.key} className="text-right py-2 px-3 tabular-nums text-gray-700 dark:text-gray-300">{fmt(s[f.key], f.unit)}</td>)}
                  <td className="px-3">
                    <button onClick={() => handleDelete(s.id)} className="text-gray-400 hover:text-rose-600"><Trash2 size={13} /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      )}

      {hasProjects && signals && (
        <div className="bg-white border border-gray-200 rounded-xl p-5 dark:bg-gray-900 dark:border-gray-800">
          <div className="flex items-center gap-2 mb-3">
            <TrendingUp size={16} className="text-violet-600" />
            <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Traction signals → scoring engine</h3>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {Object.entries(signals.factors).map(([key, f]) => (
              <div key={key} className="border border-gray-100 rounded-lg p-3">
                <div className="flex items-center justify-between text-sm">
                  <span className="font-medium text-gray-900 dark:text-gray-100">{f.label}</span>
                  <span className="text-violet-700 font-semibold">{f.points} / {f.max}</span>
                </div>
                <div className="mt-2 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                  <div className="h-full bg-violet-600" style={{ width: `${(f.points / f.max) * 100}%` }} />
                </div>
                <div className="text-[11px] text-gray-500 mt-1.5">Slider {f.raw} / 10</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {adding && <SnapshotModal value={adding} onChange={setAdding} onSave={handleSave} onClose={() => setAdding(null)} />}
    </div>
  );
}

function Stat({ label, value, sub, tone = 'gray' }) {
  const tones = { gray: 'text-gray-900', violet: 'text-violet-600' };
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4 dark:bg-gray-900 dark:border-gray-800">
      <div className="text-xs uppercase tracking-wide text-gray-500">{label}</div>
      <div className={`text-2xl font-semibold mt-1 ${tones[tone]}`}>{value}</div>
      {sub && <div className="text-xs text-gray-400 mt-1">{sub}</div>}
    </div>
  );
}

function SnapshotModal({ value, onChange, onSave, onClose }) {
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto dark:bg-gray-900" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 sticky top-0 bg-white dark:border-gray-800 dark:bg-gray-900">
          <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">New metrics snapshot</h2>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-700"><X size={18} /></button>
        </div>
        <div className="p-5 space-y-4">
          <div>
            <label className="text-xs uppercase tracking-wide text-gray-500 block mb-1">Snapshot date</label>
            <input type="date" value={value.snapshot_date} onChange={(e) => onChange({ ...value, snapshot_date: e.target.value })} className="border border-gray-300 rounded-md px-3 py-1.5 text-sm dark:border-gray-700" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            {FIELDS.map((f) => (
              <div key={f.key}>
                <label className="text-xs uppercase tracking-wide text-gray-500 block mb-1">{f.label} {f.unit && <span className="text-gray-400">({f.unit})</span>}</label>
                <input type="number" step="any" value={value[f.key]} onChange={(e) => onChange({ ...value, [f.key]: e.target.value })} className="w-full border border-gray-300 rounded-md px-3 py-1.5 text-sm dark:border-gray-700" />
                {f.hint && <div className="text-[10px] text-gray-400 mt-0.5">{f.hint}</div>}
              </div>
            ))}
          </div>
          <div>
            <label className="text-xs uppercase tracking-wide text-gray-500 block mb-1">Notes</label>
            <textarea rows={2} value={value.notes || ''} onChange={(e) => onChange({ ...value, notes: e.target.value })} className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm dark:border-gray-700" />
          </div>
        </div>
        <div className="flex justify-end gap-2 px-5 py-4 border-t border-gray-200 sticky bottom-0 bg-white dark:border-gray-800 dark:bg-gray-900">
          <button onClick={onClose} className="px-3 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 dark:border-gray-700">Cancel</button>
          <button onClick={onSave} className="px-4 py-2 text-sm bg-violet-600 hover:bg-violet-700 text-white rounded-lg flex items-center gap-2"><Save size={14} /> Save snapshot</button>
        </div>
      </div>
    </div>
  );
}
