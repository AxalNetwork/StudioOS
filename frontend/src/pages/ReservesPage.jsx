import React, { useEffect, useMemo, useState } from 'react';
import { Layers, Save, RefreshCw, AlertTriangle, TrendingUp, Target, Bookmark } from 'lucide-react';
import { api } from '../lib/api';

// Task #46 — Reserve allocation page.
// Drag-style numeric inputs across portfolio companies with a live
// fund-deployment + reserve-ratio + IRR projection summary.

const fmt$ = (v) => {
  const n = Number(v || 0);
  if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (Math.abs(n) >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return `$${n.toFixed(0)}`;
};
const fmtPct = (v) => `${Number(v || 0).toFixed(1)}%`;

function StatCard({ label, value, hint, tone = 'gray' }) {
  const tones = {
    gray: 'bg-white border-gray-200',
    green: 'bg-emerald-50 border-emerald-200',
    amber: 'bg-amber-50 border-amber-200',
    red: 'bg-red-50 border-red-200',
    blue: 'bg-blue-50 border-blue-200',
  };
  return (
    <div className={`rounded-lg border p-4 ${tones[tone]}`}>
      <div className="text-xs uppercase tracking-wide text-gray-600">{label}</div>
      <div className="mt-1 text-2xl font-semibold text-gray-900">{value}</div>
      {hint && <div className="mt-1 text-xs text-gray-500">{hint}</div>}
    </div>
  );
}

export default function ReservesPage() {
  const [funds, setFunds] = useState([]);
  const [fundId, setFundId] = useState(null);
  const [rows, setRows] = useState([]);
  const [fund, setFund] = useState(null);
  const [serverSummary, setServerSummary] = useState(null);
  const [moic, setMoic] = useState(3.0);
  const [years, setYears] = useState(5);
  const [expensePct, setExpensePct] = useState(20);
  const [livePreview, setLivePreview] = useState(null);
  const [scenarios, setScenarios] = useState([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [savedMsg, setSavedMsg] = useState('');
  const [saveName, setSaveName] = useState('');

  // Load fund list once.
  useEffect(() => {
    (async () => {
      try {
        const list = await api.capitalFundsList();
        setFunds(list || []);
        if (list && list.length && !fundId) setFundId(list[0].id);
      } catch (e) {
        setErr(e?.message || 'Failed to load funds');
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Load reserves for the selected fund.
  const loadReserves = async (id) => {
    if (!id) return;
    try {
      setBusy(true); setErr('');
      const data = await api.fundSimReservesList(id);
      setFund(data.fund);
      setRows(data.items || []);
      setServerSummary(data.summary || null);
      const sc = await api.fundSimScenariosList(id, 'reserves');
      setScenarios(sc.items || []);
    } catch (e) {
      setErr(e?.message || 'Failed to load reserves');
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
      setTimeout(() => setSavedMsg(''), 2500);
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
      setTimeout(() => setSavedMsg(''), 2500);
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

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <Layers className="w-6 h-6 text-blue-600" /> Reserve allocation
          </h1>
          <p className="text-sm text-gray-600 mt-1">
            Drag follow-on dollars across portfolio companies. Live deployment, reserve ratio, and IRR projection update as you type.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <select
            className="border rounded px-3 py-2 text-sm"
            value={fundId || ''}
            onChange={(e) => setFundId(Number(e.target.value))}
          >
            {funds.map((f) => (
              <option key={f.id} value={f.id}>{f.name}</option>
            ))}
          </select>
          <button
            onClick={persist}
            disabled={busy}
            className="inline-flex items-center gap-2 px-3 py-2 rounded bg-blue-600 hover:bg-blue-700 text-white text-sm disabled:opacity-50"
          >
            <Save className="w-4 h-4" /> Save reserves
          </button>
        </div>
      </div>

      {err && (
        <div className="mb-4 p-3 rounded bg-red-50 border border-red-200 text-sm text-red-700 flex items-center gap-2">
          <AlertTriangle className="w-4 h-4" /> {err}
        </div>
      )}
      {savedMsg && (
        <div className="mb-4 p-3 rounded bg-emerald-50 border border-emerald-200 text-sm text-emerald-800">
          {savedMsg}
        </div>
      )}

      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          <StatCard
            label="Fund commitment"
            value={fmt$(summary.total_commitment)}
            hint={`Investable: ${fmt$(summary.investable_capital)}`}
          />
          <StatCard
            label="Total deployed"
            value={fmt$(summary.total_deployed)}
            hint={`${fmtPct(summary.deployment_pct)} of investable`}
            tone={summary.over_allocated ? 'red' : 'blue'}
          />
          <StatCard
            label="Reserve ratio"
            value={fmtPct(summary.reserve_ratio_pct)}
            hint={`${fmt$(summary.reserves_planned)} planned for follow-ons`}
            tone="amber"
          />
          <StatCard
            label="Projected IRR"
            value={fmtPct(summary.projected_irr_pct)}
            hint={`MOIC ${summary.projected_moic?.toFixed(2)}× · ${summary.years_to_exit}y`}
            tone="green"
          />
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 mb-6">
        <div className="rounded border p-3 bg-white">
          <label className="text-xs uppercase text-gray-600">Default MOIC per company</label>
          <input
            type="range" min="0.5" max="10" step="0.1"
            value={moic}
            onChange={(e) => setMoic(Number(e.target.value))}
            className="w-full mt-2"
          />
          <div className="text-sm font-medium">{moic.toFixed(1)}×</div>
        </div>
        <div className="rounded border p-3 bg-white">
          <label className="text-xs uppercase text-gray-600">Years to exit</label>
          <input
            type="range" min="1" max="12" step="0.5"
            value={years}
            onChange={(e) => setYears(Number(e.target.value))}
            className="w-full mt-2"
          />
          <div className="text-sm font-medium">{years} years</div>
        </div>
        <div className="rounded border p-3 bg-white">
          <label className="text-xs uppercase text-gray-600">Fund expense drag</label>
          <input
            type="range" min="0" max="40" step="1"
            value={expensePct}
            onChange={(e) => setExpensePct(Number(e.target.value))}
            className="w-full mt-2"
          />
          <div className="text-sm font-medium">{expensePct}% of commitment</div>
        </div>
      </div>

      <div className="rounded border bg-white overflow-hidden">
        <div className="px-4 py-3 border-b bg-gray-50 flex items-center justify-between">
          <h2 className="font-medium text-sm flex items-center gap-2">
            <Target className="w-4 h-4" /> Per-company allocation
          </h2>
          <button
            onClick={() => loadReserves(fundId)}
            className="text-xs text-gray-600 hover:text-gray-900 inline-flex items-center gap-1"
          >
            <RefreshCw className="w-3 h-3" /> Refresh
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs uppercase text-gray-600">
              <tr>
                <th className="text-left px-3 py-2">Company</th>
                <th className="text-right px-3 py-2">Initial check</th>
                <th className="text-right px-3 py-2">Reserve $</th>
                <th className="text-left px-3 py-2 w-40">Drag reserve</th>
                <th className="text-left px-3 py-2">Next round</th>
                <th className="text-left px-3 py-2">Target %</th>
                <th className="text-left px-3 py-2">Confidence</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-3 py-6 text-center text-gray-500">
                    No active portfolio companies. Move projects into status <code>active</code>, <code>tier_1</code>, <code>tier_2</code>, or <code>spinout</code> to see them here.
                  </td>
                </tr>
              )}
              {rows.map((r, idx) => (
                <tr key={r.project_id} className="border-t hover:bg-gray-50">
                  <td className="px-3 py-2 font-medium">{r.project_name}</td>
                  <td className="px-3 py-2 text-right">
                    <input
                      type="number" min="0" step="50000"
                      value={r.initial_check || 0}
                      onChange={(e) => updateRow(idx, { initial_check: Number(e.target.value) })}
                      className="w-32 border rounded px-2 py-1 text-right text-sm"
                    />
                  </td>
                  <td className="px-3 py-2 text-right">
                    <input
                      type="number" min="0" step="50000"
                      value={r.reserve_amount || 0}
                      onChange={(e) => updateRow(idx, { reserve_amount: Number(e.target.value) })}
                      className="w-32 border rounded px-2 py-1 text-right text-sm"
                    />
                  </td>
                  <td className="px-3 py-2">
                    <input
                      type="range" min="0" max="5000000" step="25000"
                      value={r.reserve_amount || 0}
                      onChange={(e) => updateRow(idx, { reserve_amount: Number(e.target.value) })}
                      className="w-full"
                    />
                  </td>
                  <td className="px-3 py-2">
                    <input
                      value={r.next_round_label || ''}
                      onChange={(e) => updateRow(idx, { next_round_label: e.target.value })}
                      placeholder="Series A"
                      className="w-24 border rounded px-2 py-1 text-sm"
                    />
                  </td>
                  <td className="px-3 py-2">
                    <input
                      type="number" min="0" max="100" step="0.1"
                      value={r.target_ownership_pct ?? ''}
                      onChange={(e) => updateRow(idx, { target_ownership_pct: e.target.value === '' ? null : Number(e.target.value) })}
                      className="w-20 border rounded px-2 py-1 text-sm"
                    />
                  </td>
                  <td className="px-3 py-2">
                    <select
                      value={r.confidence || 'medium'}
                      onChange={(e) => updateRow(idx, { confidence: e.target.value })}
                      className="border rounded px-2 py-1 text-sm"
                    >
                      <option value="low">low</option>
                      <option value="medium">medium</option>
                      <option value="high">high</option>
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {summary?.over_allocated && (
          <div className="px-4 py-2 border-t bg-red-50 text-sm text-red-700 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4" />
            Total deployed ({fmt$(summary.total_deployed)}) exceeds investable capital ({fmt$(summary.investable_capital)}). Reduce reserves or revisit fund expense drag.
          </div>
        )}
        {summary && !summary.over_allocated && summary.total_deployed > 0 && (
          <div className="px-4 py-2 border-t bg-gray-50 text-xs text-gray-600">
            Reserves are {reservePctOfDeployed.toFixed(1)}% of total deployed. Industry rule of thumb: 50–60% reserves at seed, 30–40% at A.
          </div>
        )}
      </div>

      <div className="mt-6 grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="rounded border bg-white p-4">
          <h3 className="font-medium text-sm flex items-center gap-2 mb-3">
            <Bookmark className="w-4 h-4" /> Save scenario
          </h3>
          <div className="flex items-center gap-2">
            <input
              value={saveName}
              onChange={(e) => setSaveName(e.target.value)}
              placeholder="e.g. Base case Q4 26"
              className="flex-1 border rounded px-3 py-2 text-sm"
            />
            <button
              onClick={saveScenario}
              disabled={busy || !saveName.trim()}
              className="px-3 py-2 rounded bg-gray-900 hover:bg-black text-white text-sm disabled:opacity-50"
            >Save</button>
          </div>
        </div>
        <div className="rounded border bg-white p-4">
          <h3 className="font-medium text-sm flex items-center gap-2 mb-3">
            <TrendingUp className="w-4 h-4" /> Saved scenarios
          </h3>
          {scenarios.length === 0 && (
            <div className="text-xs text-gray-500">No saved scenarios yet.</div>
          )}
          <ul className="space-y-2">
            {scenarios.map((s) => (
              <li key={s.uid} className="flex items-center justify-between text-sm border rounded px-2 py-1">
                <div>
                  <div className="font-medium">{s.name}</div>
                  <div className="text-xs text-gray-500">
                    IRR {s.result?.summary?.projected_irr_pct?.toFixed(1) ?? '—'}% · MOIC {s.result?.summary?.projected_moic?.toFixed(2) ?? '—'}× · {new Date(s.created_at).toLocaleDateString()}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button onClick={() => loadScenario(s)} className="text-xs px-2 py-1 rounded border hover:bg-gray-50">Load</button>
                  <button onClick={() => deleteScenario(s.uid)} className="text-xs px-2 py-1 rounded border text-red-600 hover:bg-red-50">Delete</button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
