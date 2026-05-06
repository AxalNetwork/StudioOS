import React, { useEffect, useMemo, useState } from 'react';
import {
  Layers, Save, RefreshCw, AlertTriangle, TrendingUp, Target, Bookmark,
  DollarSign, Percent, PiggyBank, Sparkles, Trash2, Upload, Building2,
} from 'lucide-react';
import { api } from '../lib/api';
import { useToast } from '../components/useToast';

// Task #46 — Reserve allocation page (modernized).
// Drag-style numeric inputs across portfolio companies with a live
// fund-deployment + reserve-ratio + IRR projection summary.

const fmt$ = (v) => {
  const n = Number(v || 0);
  if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (Math.abs(n) >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return `$${n.toFixed(0)}`;
};
const fmtPct = (v) => `${Number(v || 0).toFixed(1)}%`;

const isNotFound = (e) => {
  if (!e) return false;
  const msg = (e?.message || '').toLowerCase();
  return e?.status === 404 || msg === 'not found';
};

const CONFIDENCE_STYLES = {
  low: 'bg-rose-100 text-rose-700 ring-rose-200',
  medium: 'bg-amber-100 text-amber-700 ring-amber-200',
  high: 'bg-emerald-100 text-emerald-700 ring-emerald-200',
};

function StatCard({ label, value, hint, icon: Icon, tone = 'slate' }) {
  const tones = {
    slate: { bg: 'from-slate-50 to-white', ring: 'ring-slate-200', icon: 'text-slate-500 bg-slate-100', value: 'text-slate-900' },
    emerald: { bg: 'from-emerald-50 to-white', ring: 'ring-emerald-200', icon: 'text-emerald-600 bg-emerald-100', value: 'text-emerald-700' },
    violet: { bg: 'from-violet-50 to-white', ring: 'ring-violet-200', icon: 'text-violet-600 bg-violet-100', value: 'text-violet-700' },
    amber: { bg: 'from-amber-50 to-white', ring: 'ring-amber-200', icon: 'text-amber-600 bg-amber-100', value: 'text-amber-700' },
    blue: { bg: 'from-blue-50 to-white', ring: 'ring-blue-200', icon: 'text-blue-600 bg-blue-100', value: 'text-blue-700' },
    rose: { bg: 'from-rose-50 to-white', ring: 'ring-rose-200', icon: 'text-rose-600 bg-rose-100', value: 'text-rose-700' },
  };
  const t = tones[tone] || tones.slate;
  return (
    <div className={`rounded-2xl bg-gradient-to-br ${t.bg} ring-1 ${t.ring} p-4 shadow-sm`}>
      <div className="flex items-center justify-between">
        <div className="text-[11px] uppercase tracking-wider text-slate-500 font-medium">{label}</div>
        {Icon && (
          <div className={`w-7 h-7 rounded-lg flex items-center justify-center ${t.icon}`}>
            <Icon className="w-4 h-4" />
          </div>
        )}
      </div>
      <div className={`mt-2 text-2xl font-semibold tracking-tight ${t.value}`}>{value}</div>
      {hint && <div className="mt-1 text-xs text-slate-500">{hint}</div>}
    </div>
  );
}

function SliderInput({ label, value, onChange, min, max, step, suffix, hint, accent = 'violet' }) {
  const accents = {
    violet: 'accent-violet-600',
    emerald: 'accent-emerald-600',
    blue: 'accent-blue-600',
    amber: 'accent-amber-600',
  };
  return (
    <div className="rounded-2xl bg-white ring-1 ring-slate-200 p-4 shadow-sm">
      <div className="flex items-center justify-between">
        <label className="text-[11px] uppercase tracking-wider text-slate-500 font-medium">{label}</label>
        <div className="text-sm font-semibold text-slate-900 tabular-nums">{value}{suffix}</div>
      </div>
      <input
        type="range" min={min} max={max} step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className={`w-full mt-3 h-1.5 ${accents[accent]} cursor-pointer`}
      />
      {hint && <div className="mt-1 text-[11px] text-slate-400">{hint}</div>}
    </div>
  );
}

export default function ReservesPage() {
  const [funds, setFunds] = useState([]);
  const [fundId, setFundId] = useState(null);
  const [rows, setRows] = useState([]);
  const [, setFund] = useState(null);
  const [serverSummary, setServerSummary] = useState(null);
  const [moic, setMoic] = useState(3.0);
  const [years, setYears] = useState(5);
  const [expensePct, setExpensePct] = useState(20);
  const [livePreview, setLivePreview] = useState(null);
  const [scenarios, setScenarios] = useState([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  // T19 — useToast handles cleanup on unmount; replaces inline setTimeout(setSavedMsg, 2500).
  const { toast: savedMsg, showToast: setSavedMsg } = useToast(2500);
  const [saveName, setSaveName] = useState('');

  // Load fund list once. 404 means the worker doesn't have the capital
  // routes — render empty fund list rather than a raw red banner.
  useEffect(() => {
    (async () => {
      try {
        const list = await api.capitalFundsList();
        setFunds(list || []);
        if (list && list.length && !fundId) setFundId(list[0].id);
      } catch (e) {
        if (isNotFound(e)) setFunds([]);
        else setErr(e?.message || 'Failed to load funds');
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadReserves = async (id) => {
    if (!id) return;
    try {
      setBusy(true); setErr('');
      const data = await api.fundSimReservesList(id);
      setFund(data.fund);
      setRows(data.items || []);
      setServerSummary(data.summary || null);
      try {
        const sc = await api.fundSimScenariosList(id, 'reserves');
        setScenarios(sc.items || []);
      } catch (e) { if (!isNotFound(e)) throw e; }
    } catch (e) {
      if (isNotFound(e)) {
        setRows([]); setServerSummary(null); setScenarios([]);
      } else {
        setErr(e?.message || 'Failed to load reserves');
      }
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (fundId) loadReserves(fundId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fundId]);

  // Live simulate whenever rows / knobs change.
  useEffect(() => {
    if (!fundId || !rows.length) { setLivePreview(null); return; }
    let cancelled = false;
    (async () => {
      try {
        const res = await api.fundSimReservesSimulate(fundId, {
          allocations: rows.map((r) => ({
            project_id: r.project_id,
            reserve_amount: Number(r.reserve_amount || 0),
            initial_check: Number(r.initial_check || 0),
            target_ownership_pct: r.target_ownership_pct,
            confidence: r.confidence,
          })),
          expected_moic_per_company: Number(moic),
          years_to_exit: Number(years),
          fund_expense_pct: Number(expensePct) / 100,
        });
        if (!cancelled) setLivePreview(res);
      } catch (e) {
        if (!cancelled) setLivePreview(null);
      }
    })();
    return () => { cancelled = true; };
  }, [fundId, rows, moic, years, expensePct]);

  const updateRow = (idx, patch) => {
    setRows((prev) => prev.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  };

  const persist = async () => {
    if (!fundId) return;
    try {
      setBusy(true); setErr('');
      await api.fundSimReservesReplace(fundId, rows.map((r) => ({
        project_id: r.project_id,
        reserve_amount: Number(r.reserve_amount || 0),
        initial_check: Number(r.initial_check || 0),
        next_round_label: r.next_round_label || null,
        target_ownership_pct: r.target_ownership_pct == null ? null : Number(r.target_ownership_pct),
        confidence: r.confidence || 'medium',
        notes: r.notes || null,
      })));
      await loadReserves(fundId);
      setSavedMsg('Reserves saved.');
    } catch (e) {
      setErr(e?.message || 'Save failed');
    } finally {
      setBusy(false);
    }
  };

  const saveScenario = async () => {
    if (!fundId || !saveName.trim()) return;
    try {
      setBusy(true);
      await api.fundSimScenarioCreate(fundId, {
        kind: 'reserves',
        name: saveName.trim(),
        inputs: {
          allocations: rows.map((r) => ({
            project_id: r.project_id,
            project_name: r.project_name,
            initial_check: Number(r.initial_check || 0),
            reserve_amount: Number(r.reserve_amount || 0),
            target_ownership_pct: r.target_ownership_pct,
            confidence: r.confidence,
          })),
          expected_moic_per_company: Number(moic),
          years_to_exit: Number(years),
          fund_expense_pct: Number(expensePct) / 100,
        },
        result: livePreview || null,
      });
      setSaveName('');
      const sc = await api.fundSimScenariosList(fundId, 'reserves');
      setScenarios(sc.items || []);
      setSavedMsg('Scenario saved.');
    } catch (e) {
      setErr(e?.message || 'Save scenario failed');
    } finally {
      setBusy(false);
    }
  };

  const loadScenario = (s) => {
    const inp = s.inputs || {};
    if (inp.expected_moic_per_company != null) setMoic(inp.expected_moic_per_company);
    if (inp.years_to_exit != null) setYears(inp.years_to_exit);
    if (inp.fund_expense_pct != null) setExpensePct(Number(inp.fund_expense_pct) * 100);
    if (Array.isArray(inp.allocations) && rows.length) {
      const byPid = new Map(inp.allocations.map((a) => [a.project_id, a]));
      setRows((prev) => prev.map((r) => {
        const a = byPid.get(r.project_id);
        return a ? {
          ...r,
          initial_check: a.initial_check ?? r.initial_check,
          reserve_amount: a.reserve_amount ?? r.reserve_amount,
          target_ownership_pct: a.target_ownership_pct ?? r.target_ownership_pct,
          confidence: a.confidence || r.confidence,
        } : r;
      }));
    }
  };

  const deleteScenario = async (uid) => {
    try {
      await api.fundSimScenarioDelete(uid);
      setScenarios((prev) => prev.filter((s) => s.uid !== uid));
    } catch (e) {
      setErr(e?.message || 'Delete failed');
    }
  };

  const summary = livePreview?.summary || serverSummary;

  const reservePctOfDeployed = useMemo(() => {
    if (!summary || !summary.total_deployed) return 0;
    return (summary.reserves_planned / summary.total_deployed) * 100;
  }, [summary]);

  const maxReserve = useMemo(() => Math.max(1, ...rows.map((r) => Number(r.reserve_amount) || 0)), [rows]);

  return (
    <div className="p-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="rounded-2xl bg-gradient-to-r from-blue-50 via-white to-violet-50 ring-1 ring-slate-200 p-5 mb-6 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-slate-900 flex items-center gap-2">
              <span className="w-9 h-9 rounded-xl bg-blue-600 text-white flex items-center justify-center shadow-sm">
                <Layers className="w-5 h-5" />
              </span>
              Reserve allocation
              {busy && <span className="text-xs font-normal text-slate-400 animate-pulse">computing…</span>}
            </h1>
            <p className="text-sm text-slate-600 mt-1.5 max-w-2xl">
              Drag follow-on dollars across portfolio companies. Live deployment, reserve ratio, and
              <span className="text-slate-700 font-medium"> IRR projection update as you type</span>.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <label className="text-xs text-slate-500 uppercase tracking-wider font-medium">Fund</label>
            <select
              className="bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm font-medium text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30"
              value={fundId || ''}
              onChange={(e) => setFundId(Number(e.target.value))}
              disabled={!funds.length}
            >
              {funds.length === 0 && <option value="">No funds available</option>}
              {funds.map((f) => (
                <option key={f.id} value={f.id}>{f.name}</option>
              ))}
            </select>
            <button
              onClick={persist}
              disabled={busy || !fundId}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium shadow-sm disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              <Save className="w-4 h-4" /> Save reserves
            </button>
          </div>
        </div>
      </div>

      {err && (
        <div className="mb-4 p-3 rounded-xl bg-rose-50 ring-1 ring-rose-200 text-sm text-rose-700 flex items-center gap-2">
          <AlertTriangle className="w-4 h-4" /> {err}
        </div>
      )}
      {savedMsg && (
        <div className="mb-4 p-3 rounded-xl bg-emerald-50 ring-1 ring-emerald-200 text-sm text-emerald-800 flex items-center gap-2">
          <Sparkles className="w-4 h-4" /> {savedMsg}
        </div>
      )}

      {/* Knobs */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-6">
        <SliderInput
          label="Default MOIC per company"
          value={moic.toFixed(1)} onChange={setMoic}
          min={0.5} max={10} step={0.1} suffix="×" accent="violet"
          hint="Applied when an individual company has no override."
        />
        <SliderInput
          label="Years to exit"
          value={years} onChange={setYears}
          min={1} max={12} step={0.5} suffix=" yrs" accent="blue"
          hint="Drives the IRR back-solve from projected MOIC."
        />
        <SliderInput
          label="Fund expense drag"
          value={expensePct} onChange={setExpensePct}
          min={0} max={40} step={1} suffix="%" accent="amber"
          hint="% of commitment reserved for fees, audit, legal, etc."
        />
      </div>

      {/* Stat cards */}
      {summary ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          <StatCard
            tone="slate" icon={DollarSign}
            label="Fund commitment"
            value={fmt$(summary.total_commitment)}
            hint={`Investable: ${fmt$(summary.investable_capital)}`}
          />
          <StatCard
            tone={summary.over_allocated ? 'rose' : 'blue'} icon={TrendingUp}
            label="Total deployed"
            value={fmt$(summary.total_deployed)}
            hint={`${fmtPct(summary.deployment_pct)} of investable`}
          />
          <StatCard
            tone="amber" icon={PiggyBank}
            label="Reserve ratio"
            value={fmtPct(summary.reserve_ratio_pct)}
            hint={`${fmt$(summary.reserves_planned)} planned for follow-ons`}
          />
          <StatCard
            tone="emerald" icon={Percent}
            label="Projected IRR"
            value={fmtPct(summary.projected_irr_pct)}
            hint={`MOIC ${summary.projected_moic?.toFixed(2)}× · ${summary.years_to_exit}y`}
          />
        </div>
      ) : (
        <div className="rounded-2xl bg-white ring-1 ring-dashed ring-slate-300 p-8 text-center mb-6">
          <Target className="w-8 h-8 text-slate-300 mx-auto" />
          <div className="mt-2 text-sm font-medium text-slate-700">No simulation yet</div>
          <p className="mt-1 text-xs text-slate-500">
            {funds.length === 0
              ? 'Register a fund in Capital to start allocating reserves.'
              : 'Allocate reserves to active companies below to see live projections.'}
          </p>
        </div>
      )}

      {/* Per-company allocation */}
      <div className="rounded-2xl bg-white ring-1 ring-slate-200 shadow-sm overflow-hidden mb-6">
        <div className="px-5 py-3.5 border-b border-slate-100 flex items-center gap-2">
          <Building2 className="w-4 h-4 text-slate-400" />
          <h2 className="font-medium text-sm text-slate-900">Per-company allocation</h2>
          <span className="text-xs text-slate-400">{rows.length} compan{rows.length === 1 ? 'y' : 'ies'}</span>
          <button
            onClick={() => loadReserves(fundId)}
            disabled={!fundId}
            className="ml-auto text-xs text-slate-500 hover:text-slate-900 inline-flex items-center gap-1 px-2 py-1 rounded-md hover:bg-slate-100 transition-colors disabled:opacity-40"
          >
            <RefreshCw className="w-3 h-3" /> Refresh
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50/60 text-[11px] uppercase tracking-wider text-slate-500">
              <tr>
                <th className="text-left px-4 py-2.5 font-medium">Company</th>
                <th className="text-right px-3 py-2.5 font-medium">Initial check</th>
                <th className="text-right px-3 py-2.5 font-medium">Reserve $</th>
                <th className="text-left px-3 py-2.5 w-48 font-medium">Drag reserve</th>
                <th className="text-left px-3 py-2.5 font-medium">Next round</th>
                <th className="text-left px-3 py-2.5 font-medium">Target %</th>
                <th className="text-left px-3 py-2.5 font-medium">Confidence</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center">
                    <Building2 className="w-8 h-8 text-slate-300 mx-auto mb-2" />
                    <div className="text-sm font-medium text-slate-700">No active portfolio companies</div>
                    <p className="mt-1 text-xs text-slate-500 max-w-md mx-auto">
                      Move projects into status <code className="text-[11px] px-1 py-0.5 bg-slate-100 rounded">active</code>,{' '}
                      <code className="text-[11px] px-1 py-0.5 bg-slate-100 rounded">tier_1</code>,{' '}
                      <code className="text-[11px] px-1 py-0.5 bg-slate-100 rounded">tier_2</code>, or{' '}
                      <code className="text-[11px] px-1 py-0.5 bg-slate-100 rounded">spinout</code> to see them here.
                    </p>
                  </td>
                </tr>
              )}
              {rows.map((r, idx) => {
                const widthPct = (Number(r.reserve_amount || 0) / maxReserve) * 100;
                return (
                  <tr key={r.project_id} className="hover:bg-slate-50/60 transition-colors">
                    <td className="px-4 py-3">
                      <div className="font-medium text-slate-900">{r.project_name}</div>
                      <div className="mt-1 h-1 w-32 rounded-full bg-slate-100 overflow-hidden">
                        <div className="h-full bg-violet-400" style={{ width: `${widthPct}%` }} />
                      </div>
                    </td>
                    <td className="px-3 py-3 text-right">
                      <input
                        type="number" min="0" step="50000"
                        value={r.initial_check || 0}
                        onChange={(e) => updateRow(idx, { initial_check: Number(e.target.value) })}
                        className="w-32 bg-slate-50 border border-slate-200 rounded-md px-2 py-1 text-right text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:bg-white"
                      />
                    </td>
                    <td className="px-3 py-3 text-right">
                      <input
                        type="number" min="0" step="50000"
                        value={r.reserve_amount || 0}
                        onChange={(e) => updateRow(idx, { reserve_amount: Number(e.target.value) })}
                        className="w-32 bg-slate-50 border border-slate-200 rounded-md px-2 py-1 text-right text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-violet-500/30 focus:bg-white"
                      />
                    </td>
                    <td className="px-3 py-3">
                      <input
                        type="range" min="0" max="5000000" step="25000"
                        value={r.reserve_amount || 0}
                        onChange={(e) => updateRow(idx, { reserve_amount: Number(e.target.value) })}
                        className="w-full accent-violet-600 cursor-pointer"
                      />
                    </td>
                    <td className="px-3 py-3">
                      <input
                        value={r.next_round_label || ''}
                        onChange={(e) => updateRow(idx, { next_round_label: e.target.value })}
                        placeholder="Series A"
                        className="w-24 bg-slate-50 border border-slate-200 rounded-md px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:bg-white"
                      />
                    </td>
                    <td className="px-3 py-3">
                      <div className="relative">
                        <input
                          type="number" min="0" max="100" step="0.1"
                          value={r.target_ownership_pct ?? ''}
                          onChange={(e) => updateRow(idx, { target_ownership_pct: e.target.value === '' ? null : Number(e.target.value) })}
                          className="w-20 bg-slate-50 border border-slate-200 rounded-md pl-2 pr-5 py-1 text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:bg-white"
                        />
                        <span className="absolute right-1.5 top-1/2 -translate-y-1/2 text-[11px] text-slate-400">%</span>
                      </div>
                    </td>
                    <td className="px-3 py-3">
                      <select
                        value={r.confidence || 'medium'}
                        onChange={(e) => updateRow(idx, { confidence: e.target.value })}
                        className={`text-xs px-2 py-1 rounded-md ring-1 font-medium capitalize cursor-pointer focus:outline-none ${CONFIDENCE_STYLES[r.confidence || 'medium']}`}
                      >
                        <option value="low">low</option>
                        <option value="medium">medium</option>
                        <option value="high">high</option>
                      </select>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {summary?.over_allocated && (
          <div className="px-5 py-3 border-t border-rose-200 bg-rose-50 text-sm text-rose-700 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>
              Total deployed (<span className="font-semibold">{fmt$(summary.total_deployed)}</span>) exceeds investable capital
              (<span className="font-semibold">{fmt$(summary.investable_capital)}</span>). Reduce reserves or revisit fund expense drag.
            </span>
          </div>
        )}
        {summary && !summary.over_allocated && summary.total_deployed > 0 && (
          <div className="px-5 py-3 border-t border-slate-100 bg-slate-50/60 text-xs text-slate-600">
            Reserves are <span className="font-semibold text-slate-800">{reservePctOfDeployed.toFixed(1)}%</span> of total deployed.
            Industry rule of thumb: 50–60% reserves at seed, 30–40% at A.
          </div>
        )}
      </div>

      {/* Save + Saved scenarios */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="rounded-2xl bg-white ring-1 ring-slate-200 shadow-sm p-5">
          <h3 className="font-medium text-sm text-slate-900 flex items-center gap-2 mb-3">
            <Bookmark className="w-4 h-4 text-blue-500" /> Save scenario
          </h3>
          <div className="flex items-center gap-2">
            <input
              value={saveName}
              onChange={(e) => setSaveName(e.target.value)}
              placeholder="e.g. Base case Q4 26"
              className="flex-1 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:bg-white"
            />
            <button
              onClick={saveScenario}
              disabled={busy || !saveName.trim() || !fundId}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-slate-900 hover:bg-black text-white text-sm font-medium shadow-sm disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              <Save className="w-4 h-4" /> Save
            </button>
          </div>
          <p className="mt-2 text-[11px] text-slate-400">Snapshots current allocations + knobs together with the live projection.</p>
        </div>
        <div className="rounded-2xl bg-white ring-1 ring-slate-200 shadow-sm p-5">
          <h3 className="font-medium text-sm text-slate-900 flex items-center gap-2 mb-3">
            <TrendingUp className="w-4 h-4 text-slate-400" /> Saved scenarios
            <span className="ml-auto text-xs font-normal text-slate-400">{scenarios.length}</span>
          </h3>
          {scenarios.length === 0 ? (
            <div className="text-xs text-slate-500 py-2">No saved scenarios yet.</div>
          ) : (
            <ul className="space-y-2">
              {scenarios.map((s) => (
                <li key={s.uid} className="flex items-center justify-between gap-3 text-sm rounded-lg border border-slate-200 px-3 py-2 hover:bg-slate-50 transition-colors">
                  <div className="min-w-0 flex-1">
                    <div className="font-medium text-slate-900 truncate">{s.name}</div>
                    <div className="text-[11px] text-slate-500 tabular-nums">
                      IRR {s.result?.summary?.projected_irr_pct?.toFixed(1) ?? '—'}% · MOIC {s.result?.summary?.projected_moic?.toFixed(2) ?? '—'}× · {new Date(s.created_at).toLocaleDateString()}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={() => loadScenario(s)}
                      className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-md border border-slate-200 hover:bg-white hover:border-blue-300 hover:text-blue-700 transition-colors"
                      title="Load inputs"
                    >
                      <Upload className="w-3 h-3" /> Load
                    </button>
                    <button
                      onClick={() => deleteScenario(s.uid)}
                      className="inline-flex items-center justify-center w-7 h-7 rounded-md text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-colors"
                      title="Delete scenario"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
