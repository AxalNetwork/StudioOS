import React, { useEffect, useMemo, useState } from 'react';
import PageExplainer from '../components/PageExplainer';
import {
  Waves, Save, AlertTriangle, Bookmark, ArrowDownToLine, Calculator,
  TrendingUp, Users, DollarSign, Percent, Sparkles, Trash2, Upload,
} from 'lucide-react';
import { api } from '../lib/api';
import { useToast } from '../components/useToast';

// Task #46 — Exit waterfall page (modernized).
// Inputs: exit value, carry, hurdle, years, GP catch-up.
// Output: tranche-by-tranche distribution + per-LP table + saved scenarios.

const fmt$ = (v) => {
  const n = Number(v || 0);
  if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (Math.abs(n) >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return `$${n.toFixed(0)}`;
};
const fmtPct = (v) => `${Number(v || 0).toFixed(2)}%`;

const isNotFound = (e) => {
  if (!e) return false;
  const msg = (e?.message || '').toLowerCase();
  return e?.status === 404 || msg === 'not found';
};

function StatCard({ label, value, hint, icon: Icon, tone = 'slate' }) {
  const tones = {
    slate: { bg: 'from-slate-50 to-white', ring: 'ring-slate-200', icon: 'text-slate-500 bg-slate-100', value: 'text-slate-900' },
    emerald: { bg: 'from-emerald-50 to-white', ring: 'ring-emerald-200', icon: 'text-emerald-600 bg-emerald-100', value: 'text-emerald-700' },
    violet: { bg: 'from-violet-50 to-white', ring: 'ring-violet-200', icon: 'text-violet-600 bg-violet-100', value: 'text-violet-700' },
    amber: { bg: 'from-amber-50 to-white', ring: 'ring-amber-200', icon: 'text-amber-600 bg-amber-100', value: 'text-amber-700' },
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
    <div className="rounded-2xl bg-white ring-1 ring-slate-200 p-4 shadow-sm dark:bg-gray-900">
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

function StackedSplitBar({ toLps, toGp }) {
  const total = (Number(toLps) || 0) + (Number(toGp) || 0);
  if (total <= 0) return null;
  const lpPct = (toLps / total) * 100;
  const gpPct = 100 - lpPct;
  return (
    <div>
      <div className="flex items-center justify-between text-xs text-slate-500 mb-1.5">
        <span className="inline-flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-emerald-500" /> LPs {lpPct.toFixed(1)}%</span>
        <span className="inline-flex items-center gap-1.5">GP {gpPct.toFixed(1)}% <span className="w-2 h-2 rounded-full bg-violet-500" /></span>
      </div>
      <div className="h-2.5 w-full rounded-full overflow-hidden bg-slate-100 flex">
        <div className="bg-emerald-500" style={{ width: `${lpPct}%` }} />
        <div className="bg-violet-500" style={{ width: `${gpPct}%` }} />
      </div>
    </div>
  );
}

export default function WaterfallPage() {
  const [funds, setFunds] = useState([]);
  const [fundId, setFundId] = useState(null);
  const [exitValueM, setExitValueM] = useState(100);
  const [carryPct, setCarryPct] = useState(20);
  const [hurdlePct, setHurdlePct] = useState(8);
  const [yearsHeld, setYearsHeld] = useState(5);
  const [gpCatchup, setGpCatchup] = useState(true);
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [scenarios, setScenarios] = useState([]);
  const [saveName, setSaveName] = useState('');
  // T19 — useToast handles cleanup on unmount; replaces inline setTimeout(setSavedMsg, 2500).
  const { toast: savedMsg, showToast: setSavedMsg } = useToast(2500);

  // Load funds. 404 means the worker doesn't have the capital routes on this
  // deployment — render an empty fund list rather than a raw red banner.
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

  // Saved scenarios for current fund — already silently swallowed on error.
  useEffect(() => {
    if (!fundId) return;
    (async () => {
      try {
        const sc = await api.fundSimScenariosList(fundId, 'waterfall');
        setScenarios(sc.items || []);
      } catch { /* ignore */ }
    })();
  }, [fundId]);

  // Live recompute as inputs change.
  useEffect(() => {
    if (!fundId) { setResult(null); return; }
    let cancelled = false;
    (async () => {
      try {
        setBusy(true); setErr('');
        const res = await api.fundSimWaterfall(fundId, {
          exit_value: Number(exitValueM) * 1_000_000,
          carry_pct: Number(carryPct) / 100,
          hurdle_rate: Number(hurdlePct) / 100,
          years_held: Number(yearsHeld),
          gp_catchup: gpCatchup,
        });
        if (!cancelled) setResult(res);
      } catch (e) {
        if (cancelled) return;
        if (isNotFound(e)) setResult(null);
        else setErr(e?.message || 'Simulation failed');
      } finally {
        if (!cancelled) setBusy(false);
      }
    })();
    return () => { cancelled = true; };
  }, [fundId, exitValueM, carryPct, hurdlePct, yearsHeld, gpCatchup]);

  const saveScenario = async () => {
    if (!fundId || !saveName.trim() || !result) return;
    try {
      setBusy(true);
      await api.fundSimScenarioCreate(fundId, {
        kind: 'waterfall',
        name: saveName.trim(),
        inputs: {
          exit_value: Number(exitValueM) * 1_000_000,
          carry_pct: Number(carryPct) / 100,
          hurdle_rate: Number(hurdlePct) / 100,
          years_held: Number(yearsHeld),
          gp_catchup: gpCatchup,
        },
        result,
      });
      setSaveName('');
      const sc = await api.fundSimScenariosList(fundId, 'waterfall');
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
    if (inp.exit_value != null) setExitValueM(inp.exit_value / 1_000_000);
    if (inp.carry_pct != null) setCarryPct(Number(inp.carry_pct) * 100);
    if (inp.hurdle_rate != null) setHurdlePct(Number(inp.hurdle_rate) * 100);
    if (inp.years_held != null) setYearsHeld(inp.years_held);
    if (inp.gp_catchup != null) setGpCatchup(!!inp.gp_catchup);
  };

  const deleteScenario = async (uid) => {
    try {
      await api.fundSimScenarioDelete(uid);
      setScenarios((prev) => prev.filter((s) => s.uid !== uid));
    } catch (e) {
      setErr(e?.message || 'Delete failed');
    }
  };

  const totals = result?.totals;
  const tranches = result?.tranches || [];
  const maxTranche = useMemo(() => Math.max(1, ...tranches.map((t) => Number(t.amount) || 0)), [tranches]);

  return (
    <div className="p-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="rounded-2xl bg-gradient-to-r from-violet-50 via-white to-blue-50 ring-1 ring-slate-200 p-5 mb-6 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-slate-900 flex items-center gap-2">
              <span className="w-9 h-9 rounded-xl bg-violet-600 text-white flex items-center justify-center shadow-sm">
                <Waves className="w-5 h-5" />
              </span>
              Exit waterfall
              {busy && <span className="text-xs font-normal text-slate-400 animate-pulse">computing…</span>}
            </h1>
        <PageExplainer pageKey="waterfall" />
            <p className="text-sm text-slate-600 mt-1.5 max-w-2xl">
              Model an exit at any value across the portfolio. European waterfall:
              <span className="text-slate-700 font-medium"> return of capital → preferred return → GP catch-up → carry split</span>.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <label className="text-xs text-slate-500 uppercase tracking-wider font-medium">Fund</label>
            <select
              className="bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm font-medium text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-violet-500/30 dark:bg-gray-900"
              value={fundId || ''}
              onChange={(e) => setFundId(Number(e.target.value))}
              disabled={!funds.length}
            >
              {funds.length === 0 && <option value="">No funds available</option>}
              {funds.map((f) => (
                <option key={f.id} value={f.id}>{f.name}</option>
              ))}
            </select>
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

      {/* Inputs */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-3 mb-6">
        <div className="rounded-2xl bg-white ring-1 ring-slate-200 p-4 shadow-sm md:col-span-2 dark:bg-gray-900">
          <div className="flex items-center justify-between">
            <label className="text-[11px] uppercase tracking-wider text-slate-500 font-medium">Exit value</label>
            <div className="text-sm text-slate-400">$M</div>
          </div>
          <div className="mt-2 flex items-baseline gap-1">
            <span className="text-2xl font-semibold text-slate-900 tabular-nums">${exitValueM}</span>
            <span className="text-sm text-slate-500">M</span>
          </div>
          <input
            type="range" min="0" max="1000" step="5"
            value={exitValueM}
            onChange={(e) => setExitValueM(Number(e.target.value))}
            className="w-full mt-2 h-1.5 accent-violet-600 cursor-pointer"
          />
          <input
            type="number" min="0" step="5"
            value={exitValueM}
            onChange={(e) => setExitValueM(Number(e.target.value))}
            className="w-full mt-2 bg-slate-50 border border-slate-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500/30"
          />
        </div>

        <SliderInput label="GP carry" value={carryPct} onChange={setCarryPct} min={0} max={40} step={1} suffix="%" accent="violet" />
        <SliderInput label="Hurdle rate" value={hurdlePct} onChange={setHurdlePct} min={0} max={20} step={0.5} suffix="%" accent="amber" />
        <SliderInput label="Years held" value={yearsHeld} onChange={setYearsHeld} min={1} max={15} step={0.5} suffix=" yrs" accent="blue" />

        <div className="rounded-2xl bg-white ring-1 ring-slate-200 p-4 shadow-sm md:col-span-2 dark:bg-gray-900">
          <label className="text-[11px] uppercase tracking-wider text-slate-500 font-medium">GP catch-up</label>
          <label className="mt-3 flex items-center gap-3 cursor-pointer select-none">
            <span className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${gpCatchup ? 'bg-violet-600' : 'bg-slate-300'}`}>
              <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${gpCatchup ? 'translate-x-4' : 'translate-x-0.5'}`} />
            </span>
            <span className="text-sm text-slate-700">Apply 100% catch-up after hurdle</span>
            <input type="checkbox" checked={gpCatchup} onChange={(e) => setGpCatchup(e.target.checked)} className="sr-only" />
          </label>
          <p className="mt-2 text-[11px] text-slate-400">When on, GP receives 100% of distributions after the hurdle until carry parity is reached.</p>
        </div>
      </div>

      {/* Stat cards */}
      {totals ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          <StatCard tone="emerald" icon={Users} label="Net to LPs" value={fmt$(totals.to_lps)} hint={`MOIC ${totals.lp_moic?.toFixed(2)}×`} />
          <StatCard tone="violet" icon={DollarSign} label="To GP" value={fmt$(totals.to_gp)} hint="Catch-up + carry" />
          <StatCard tone="slate" icon={Percent} label="LP IRR" value={fmtPct(totals.lp_irr_pct)} hint={`Over ${totals.years_held}y`} />
          <StatCard tone="amber" icon={TrendingUp} label="Total invested" value={fmt$(totals.total_invested)} hint={`Committed: ${fmt$(totals.total_committed)}`} />
        </div>
      ) : (
        <div className="rounded-2xl bg-white ring-1 ring-dashed ring-slate-300 p-8 text-center mb-6 dark:bg-gray-900">
          <Calculator className="w-8 h-8 text-slate-300 mx-auto" />
          <div className="mt-2 text-sm font-medium text-slate-700">No simulation yet</div>
          <p className="mt-1 text-xs text-slate-500">
            {funds.length === 0
              ? 'Register a fund in Capital to start modeling exits.'
              : 'Adjust the sliders above to compute a distribution.'}
          </p>
        </div>
      )}

      {/* LP vs GP split bar */}
      {totals && (
        <div className="rounded-2xl bg-white ring-1 ring-slate-200 p-4 shadow-sm mb-6 dark:bg-gray-900">
          <div className="text-[11px] uppercase tracking-wider text-slate-500 font-medium mb-2">LP / GP split of total proceeds</div>
          <StackedSplitBar toLps={totals.to_lps} toGp={totals.to_gp} />
        </div>
      )}

      {/* Distribution + Per-LP */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
        <div className="rounded-2xl bg-white ring-1 ring-slate-200 shadow-sm lg:col-span-2 overflow-hidden dark:bg-gray-900">
          <div className="px-5 py-3.5 border-b border-slate-100 flex items-center gap-2">
            <ArrowDownToLine className="w-4 h-4 text-slate-400" />
            <div className="font-medium text-sm text-slate-900">Distribution waterfall</div>
            <div className="ml-auto text-xs text-slate-400">{tranches.length} tranche{tranches.length === 1 ? '' : 's'}</div>
          </div>
          {tranches.length === 0 ? (
            <div className="p-8 text-center text-sm text-slate-500">No tranches to show yet.</div>
          ) : (
            <div className="divide-y divide-slate-100">
              {tranches.map((t, i) => {
                const pct = result?.exit_value > 0 ? (t.amount / result.exit_value) * 100 : 0;
                const widthPct = (Number(t.amount) / maxTranche) * 100;
                const isGp = t.to === 'GP';
                return (
                  <div key={i} className="px-5 py-3">
                    <div className="flex items-center gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-slate-900 truncate">{t.name}</span>
                          <span className={`text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded font-semibold ${isGp ? 'bg-violet-100 text-violet-700' : 'bg-emerald-100 text-emerald-700'}`}>
                            {t.to}
                          </span>
                        </div>
                        <div className="mt-1.5 h-1.5 w-full rounded-full bg-slate-100 overflow-hidden">
                          <div className={`h-full ${isGp ? 'bg-violet-400' : 'bg-emerald-400'}`} style={{ width: `${widthPct}%` }} />
                        </div>
                      </div>
                      <div className="text-right shrink-0 w-28">
                        <div className="text-sm font-semibold text-slate-900 tabular-nums">{fmt$(t.amount)}</div>
                        <div className="text-[11px] text-slate-500 tabular-nums">{pct.toFixed(1)}% of exit</div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          {result?.assumptions?.length > 0 && (
            <div className="px-5 py-3 border-t border-slate-100 bg-slate-50/60 text-xs text-slate-600">
              <div className="font-medium mb-1 text-slate-700">Assumptions</div>
              <ul className="list-disc list-inside space-y-0.5">
                {result.assumptions.map((a, i) => <li key={i}>{a}</li>)}
              </ul>
            </div>
          )}
        </div>

        <div className="rounded-2xl bg-white ring-1 ring-slate-200 shadow-sm overflow-hidden dark:bg-gray-900">
          <div className="px-5 py-3.5 border-b border-slate-100 flex items-center gap-2">
            <Calculator className="w-4 h-4 text-slate-400" />
            <div className="font-medium text-sm text-slate-900">Per-LP allocation</div>
          </div>
          {(result?.lp_rows || []).length === 0 ? (
            <div className="p-5 text-sm text-slate-500">
              No LPs registered to this fund. Add LPs in <code className="text-xs px-1 py-0.5 bg-slate-100 rounded">/capital</code> to see per-LP splits.
            </div>
          ) : (
            <ul className="divide-y divide-slate-100">
              {result.lp_rows.map((r, i) => (
                <li key={i} className="px-5 py-3 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-slate-900 truncate">{r.name}</div>
                    <div className="text-[11px] text-slate-500 tabular-nums">{r.share_pct.toFixed(1)}% of fund</div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-sm font-semibold text-slate-900 tabular-nums">{fmt$(r.payout)}</div>
                    <div className="text-[11px] text-slate-500 tabular-nums">{r.moic.toFixed(2)}× MOIC</div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* Save + Saved scenarios */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="rounded-2xl bg-white ring-1 ring-slate-200 shadow-sm p-5 dark:bg-gray-900">
          <h3 className="font-medium text-sm text-slate-900 flex items-center gap-2 mb-3">
            <Bookmark className="w-4 h-4 text-violet-500" /> Save scenario
          </h3>
          <div className="flex items-center gap-2">
            <input
              value={saveName}
              onChange={(e) => setSaveName(e.target.value)}
              placeholder="e.g. $250M exit base case"
              className="flex-1 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500/30 focus:bg-white"
            />
            <button
              onClick={saveScenario}
              disabled={busy || !saveName.trim() || !result}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-violet-600 hover:bg-violet-700 text-white text-sm font-medium shadow-sm disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              <Save className="w-4 h-4" /> Save
            </button>
          </div>
          <p className="mt-2 text-[11px] text-slate-400">Inputs and computed result are stored together for quick recall.</p>
        </div>
        <div className="rounded-2xl bg-white ring-1 ring-slate-200 shadow-sm p-5 dark:bg-gray-900">
          <h3 className="font-medium text-sm text-slate-900 mb-3 flex items-center gap-2">
            <Bookmark className="w-4 h-4 text-slate-400" /> Saved scenarios
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
                      Exit {fmt$(s.inputs?.exit_value)} · LP {fmt$(s.result?.totals?.to_lps)} · IRR {s.result?.totals?.lp_irr_pct?.toFixed(1)}%
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={() => loadScenario(s)}
                      className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-md border border-slate-200 hover:bg-white hover:border-violet-300 hover:text-violet-700 transition-colors"
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
