import React, { useState, useEffect, useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine, CartesianGrid, Legend } from 'recharts';
import { Save, Download, RefreshCw, AlertCircle, TrendingUp, Target, Wallet, Activity, FolderPlus, Plus } from 'lucide-react';
import { api } from '../lib/api';

const DRIVER_LABELS = {
  starting_cash: { label: 'Starting cash', unit: '$', step: 1000 },
  price_per_unit: { label: 'Price per unit', unit: '$', step: 1 },
  units_month_0: { label: 'Units in month 0', unit: '', step: 1 },
  monthly_growth_pct: { label: 'Monthly growth', unit: '%', step: 0.5 },
  cac: { label: 'CAC (per unit)', unit: '$', step: 1 },
  monthly_churn_pct: { label: 'Monthly churn', unit: '%', step: 0.1 },
  salaries_monthly: { label: 'Salaries / month', unit: '$', step: 500 },
  opex_monthly: { label: 'Other OpEx / month', unit: '$', step: 100 },
  gross_margin_pct: { label: 'Gross margin', unit: '%', step: 1 },
  horizon_months: { label: 'Horizon (months)', unit: '', step: 1 },
};

function fmtMoney(v) {
  if (v === null || v === undefined) return '—';
  const n = Number(v);
  if (!isFinite(n)) return '—';
  if (Math.abs(n) >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (Math.abs(n) >= 1e3) return `$${(n / 1e3).toFixed(1)}k`;
  return `$${n.toFixed(0)}`;
}

function StatCard({ icon: Icon, label, value, sub, tone = 'violet' }) {
  const tones = {
    violet: 'bg-violet-50 text-violet-700',
    emerald: 'bg-emerald-50 text-emerald-700',
    amber: 'bg-amber-50 text-amber-700',
    rose: 'bg-rose-50 text-rose-700',
  };
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4">
      <div className="flex items-center gap-2 mb-2">
        <span className={`p-1.5 rounded-md ${tones[tone]}`}><Icon size={14} /></span>
        <span className="text-xs uppercase tracking-wide text-gray-500">{label}</span>
      </div>
      <div className="text-2xl font-semibold text-gray-900">{value}</div>
      {sub && <div className="text-xs text-gray-500 mt-1">{sub}</div>}
    </div>
  );
}

export default function FinancialsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [projects, setProjects] = useState([]);
  const [projectId, setProjectId] = useState(null);
  const [model, setModel] = useState(null);
  const [assumptions, setAssumptions] = useState(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  // Load projects once
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const list = await api.listProjects();
        if (cancelled) return;
        const safeList = list || [];
        setProjects(safeList);
        const fromQuery = parseInt(searchParams.get('project_id'), 10);
        if (fromQuery && safeList.find((p) => p.id === fromQuery)) {
          setProjectId(fromQuery);
        } else if (safeList.length > 0) {
          if (fromQuery) setSearchParams({}, { replace: true });
          setProjectId(safeList[0].id);
        }
      } catch (e) {
        if (cancelled) return;
        // Defensive 404 — backend may return "Not found" when the user has no
        // projects scope yet. Treat as the same "no projects" empty state
        // rendered below; don't surface a raw red banner.
        const msg = (e?.message || '').toLowerCase();
        if (e?.status === 404 || msg.includes('not found')) {
          setProjects([]);
        } else {
          setError(e.message || 'Failed to load projects.');
        }
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Load model when projectId changes
  useEffect(() => {
    if (!projectId) return;
    setSearchParams({ project_id: String(projectId) }, { replace: true });
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const data = await api.getFinancialModel(projectId);
        if (cancelled) return;
        setModel(data);
        setAssumptions(data.assumptions);
      } catch (e) {
        if (cancelled) return;
        const msg = (e?.message || '').toLowerCase();
        if (e?.status === 404 || msg.includes('not found')) {
          setModel(null);
          setAssumptions(null);
          setError(`Project #${projectId} is no longer available. Pick another project from the dropdown.`);
        } else {
          setError(e.message || 'Failed to load financial model.');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  const dirty = useMemo(() => {
    if (!model || !assumptions) return false;
    return JSON.stringify(model.assumptions) !== JSON.stringify(assumptions);
  }, [model, assumptions]);

  async function handleSave() {
    if (!projectId || !assumptions) return;
    setSaving(true);
    setError(null);
    try {
      const data = await api.saveFinancialModel(projectId, assumptions);
      setModel(data);
      setAssumptions(data.assumptions);
    } catch (e) {
      const msg = (e?.message || '').toLowerCase();
      if (e?.status === 404 || msg.includes('not found')) {
        setModel(null);
        setAssumptions(null);
        setError(`Can't save: project #${projectId} is no longer available. Pick another project from the dropdown.`);
      } else {
        setError(e.message || 'Failed to save the financial model.');
      }
    } finally {
      setSaving(false);
    }
  }

  function handleReset() {
    if (model) setAssumptions(model.assumptions);
  }

  async function handleExport() {
    if (!projectId || !model) return;
    setError(null);
    try {
      await api.downloadFinancialModelXlsx(projectId);
    } catch (e) {
      const msg = (e?.message || '').toLowerCase();
      if (e?.status === 404 || msg.includes('not found')) {
        setError(`Can't export: project #${projectId} is no longer available. Pick another project from the dropdown.`);
      } else if (msg.includes('no financial model')) {
        setError('Save the model at least once before exporting.');
      } else {
        setError(e.message || 'Export failed.');
      }
    }
  }

  function setDriver(key, raw) {
    const num = raw === '' ? 0 : Number(raw);
    setAssumptions((prev) => ({ ...prev, [key]: isNaN(num) ? 0 : num }));
  }

  const hasProjects = projects.length > 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Financial Model</h1>
          <p className="text-sm text-gray-500 mt-1">
            3-statement-style drivers feed runway, breakeven, and the capital category of the scoring engine.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={projectId || ''}
            onChange={(e) => setProjectId(parseInt(e.target.value, 10))}
            disabled={!hasProjects}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white disabled:bg-gray-50 disabled:text-gray-400"
          >
            {!hasProjects && <option value="">No projects available</option>}
            {projects.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
          <button
            onClick={handleExport}
            disabled={!projectId || !model}
            title={!model ? 'Load a project model first' : 'Download as XLSX'}
            className="flex items-center gap-2 px-3 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Download size={14} /> Export XLSX
          </button>
        </div>
      </div>

      {error && (
        <div className="flex items-start gap-2 bg-rose-50 border border-rose-200 text-rose-700 rounded-lg px-4 py-3 text-sm">
          <AlertCircle size={16} className="mt-0.5" /> {error}
        </div>
      )}

      {!hasProjects && (
        <div className="bg-white border border-dashed border-gray-300 rounded-xl p-10 text-center">
          <FolderPlus size={32} className="mx-auto text-gray-400 mb-3" />
          <h2 className="text-base font-semibold text-gray-900">No projects yet</h2>
          <p className="text-sm text-gray-500 mt-1 max-w-md mx-auto">
            The financial model is scoped to a project. Create or join one first, then come back here to set drivers and see runway, breakeven, and capital scoring.
          </p>
          <Link
            to="/projects"
            className="inline-flex items-center gap-2 mt-4 bg-violet-600 hover:bg-violet-700 text-white rounded-lg px-4 py-2 text-sm font-medium"
          >
            <Plus size={14} /> Go to Projects
          </Link>
        </div>
      )}

      {hasProjects && loading && <div className="text-gray-500 text-sm">Loading model…</div>}

      {!loading && assumptions && model && (
        <>
          {/* Top metrics */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatCard
              icon={Wallet}
              label="Runway"
              value={`${model.computed.runway_months ?? '—'} mo`}
              sub={model.computed.runway_capped ? 'Cash hits zero within horizon' : 'Estimated, ample cash'}
              tone={model.computed.runway_capped ? 'rose' : 'emerald'}
            />
            <StatCard
              icon={Activity}
              label="Avg monthly burn"
              value={fmtMoney(model.computed.avg_monthly_burn)}
              tone="amber"
            />
            <StatCard
              icon={Target}
              label="Breakeven"
              value={model.computed.breakeven_month ? `Month ${model.computed.breakeven_month}` : 'Not in horizon'}
              tone={model.computed.breakeven_month ? 'emerald' : 'rose'}
            />
            <StatCard
              icon={TrendingUp}
              label="Capital score"
              value={`${model.capital_recompute?.total ?? '—'} / 10`}
              sub={`LTV/CAC ${model.computed.ltv_cac_ratio ?? '—'}`}
              tone="violet"
            />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Drivers panel */}
            <div className="bg-white rounded-xl border border-gray-200 p-5 lg:col-span-1">
              <h2 className="text-sm font-semibold text-gray-900 mb-4">Drivers</h2>
              <div className="space-y-3">
                {Object.entries(DRIVER_LABELS).map(([key, meta]) => (
                  <div key={key}>
                    <label className="flex items-center justify-between text-xs text-gray-600 mb-1">
                      <span>{meta.label}</span>
                      {meta.unit && <span className="text-gray-400">{meta.unit}</span>}
                    </label>
                    <input
                      type="number"
                      step={meta.step}
                      value={assumptions[key]}
                      onChange={(e) => setDriver(key, e.target.value)}
                      className="w-full border border-gray-300 rounded-md px-3 py-1.5 text-sm focus:ring-2 focus:ring-violet-200 focus:border-violet-400"
                    />
                  </div>
                ))}
              </div>
              <div className="flex items-center gap-2 mt-5 pt-4 border-t border-gray-100">
                <button
                  onClick={handleSave}
                  disabled={!dirty || saving}
                  className="flex-1 flex items-center justify-center gap-2 bg-violet-600 hover:bg-violet-700 disabled:bg-violet-300 text-white rounded-lg px-3 py-2 text-sm font-medium"
                >
                  <Save size={14} /> {saving ? 'Saving…' : dirty ? 'Save & recompute' : 'Saved'}
                </button>
                <button
                  onClick={handleReset}
                  disabled={!dirty}
                  className="flex items-center gap-1 border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                  title="Discard unsaved changes"
                >
                  <RefreshCw size={14} />
                </button>
              </div>
              {model.updated_at && (
                <div className="text-[10px] text-gray-400 mt-2">
                  Last saved {new Date(model.updated_at).toLocaleString()}
                </div>
              )}
            </div>

            {/* Charts */}
            <div className="lg:col-span-2 space-y-4">
              <div className="bg-white rounded-xl border border-gray-200 p-5">
                <h2 className="text-sm font-semibold text-gray-900 mb-2">Cash trajectory</h2>
                <ResponsiveContainer width="100%" height={240}>
                  <LineChart data={model.computed.months}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                    <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => fmtMoney(v)} />
                    <Tooltip formatter={(v) => fmtMoney(v)} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <ReferenceLine y={0} stroke="#ef4444" strokeDasharray="3 3" />
                    {model.computed.breakeven_month && (
                      <ReferenceLine x={model.computed.breakeven_month} stroke="#10b981" strokeDasharray="3 3" label={{ value: 'Breakeven', position: 'top', fontSize: 10, fill: '#10b981' }} />
                    )}
                    <Line type="monotone" dataKey="cash" stroke="#7c3aed" strokeWidth={2} dot={false} name="Cash" />
                  </LineChart>
                </ResponsiveContainer>
              </div>

              <div className="bg-white rounded-xl border border-gray-200 p-5">
                <h2 className="text-sm font-semibold text-gray-900 mb-2">Revenue vs net</h2>
                <ResponsiveContainer width="100%" height={220}>
                  <LineChart data={model.computed.months}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                    <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => fmtMoney(v)} />
                    <Tooltip formatter={(v) => fmtMoney(v)} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <ReferenceLine y={0} stroke="#9ca3af" strokeDasharray="3 3" />
                    <Line type="monotone" dataKey="revenue" stroke="#0ea5e9" strokeWidth={2} dot={false} name="Revenue" />
                    <Line type="monotone" dataKey="net" stroke="#f59e0b" strokeWidth={2} dot={false} name="Net" />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>

          {/* Sensitivity */}
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <h2 className="text-sm font-semibold text-gray-900 mb-3">Sensitivity — runway months at ±20%</h2>
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="text-xs uppercase tracking-wide text-gray-500 border-b">
                    <th className="text-left py-2 px-3">Driver</th>
                    {model.sensitivity.deltas_pct.map((d) => (
                      <th key={d} className="text-right py-2 px-3">{d > 0 ? `+${d}%` : `${d}%`}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {model.sensitivity.rows.map((row) => (
                    <tr key={row.driver} className="border-b last:border-0">
                      <td className="py-2 px-3 font-medium text-gray-900">{row.label}</td>
                      {row.cells.map((c, i) => {
                        const baseline = row.cells[Math.floor(row.cells.length / 2)].runway_months;
                        const delta = c.runway_months - baseline;
                        const tone = c.delta_pct === 0
                          ? 'bg-gray-50 text-gray-700'
                          : delta > 0
                          ? 'bg-emerald-50 text-emerald-700'
                          : delta < 0
                          ? 'bg-rose-50 text-rose-700'
                          : 'bg-gray-50 text-gray-700';
                        return (
                          <td key={i} className={`text-right py-2 px-3 tabular-nums ${tone}`}>
                            {c.runway_months} mo
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-xs text-gray-500 mt-3">
              Each cell shows runway months when the driver is shifted by the given percentage; all other drivers held constant.
            </p>
          </div>

          {/* Capital score breakdown */}
          {model.capital_recompute && (
            <div className="bg-white rounded-xl border border-gray-200 p-5">
              <h2 className="text-sm font-semibold text-gray-900 mb-3">
                Capital category recompute — {model.capital_recompute.total} / {model.capital_recompute.max}
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {Object.entries(model.capital_recompute.factors).map(([key, f]) => (
                  <div key={key} className="border border-gray-100 rounded-lg p-3">
                    <div className="flex items-center justify-between text-sm">
                      <span className="font-medium text-gray-900">{f.label}</span>
                      <span className="text-violet-700 font-semibold">{f.points} / {f.max}</span>
                    </div>
                    <div className="mt-2 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                      <div className="h-full bg-violet-600" style={{ width: `${(f.points / f.max) * 100}%` }} />
                    </div>
                    <div className="text-[11px] text-gray-500 mt-1.5">
                      Slider {f.raw} / 10 · derived from {f.source}
                    </div>
                  </div>
                ))}
              </div>
              <p className="text-[11px] text-gray-500 mt-3">
                Capital category fills two scoring sliders (`burn_efficiency`, `runway`) consumed by the v2 scoring engine.
                Saving the model recomputes these values; the next official scoring run picks them up.
              </p>
            </div>
          )}
        </>
      )}
    </div>
  );
}
