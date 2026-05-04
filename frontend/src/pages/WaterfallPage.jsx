import React, { useEffect, useState } from 'react';
import { Waves, Save, AlertTriangle, Bookmark, ArrowDownToLine, Calculator } from 'lucide-react';
import { api } from '../lib/api';

// Task #46 — Exit waterfall page.
// Inputs: exit value, carry, hurdle, years, GP catch-up.
// Output: tranche-by-tranche distribution + per-LP table.

const fmt$ = (v) => {
  const n = Number(v || 0);
  if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (Math.abs(n) >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return `$${n.toFixed(0)}`;
};
const fmtPct = (v) => `${Number(v || 0).toFixed(2)}%`;

function Stat({ label, value, hint, tone = 'gray' }) {
  const tones = {
    gray: 'bg-white border-gray-200',
    green: 'bg-emerald-50 border-emerald-200',
    blue: 'bg-blue-50 border-blue-200',
    amber: 'bg-amber-50 border-amber-200',
  };
  return (
    <div className={`rounded-lg border p-4 ${tones[tone]}`}>
      <div className="text-xs uppercase tracking-wide text-gray-600">{label}</div>
      <div className="mt-1 text-2xl font-semibold">{value}</div>
      {hint && <div className="mt-1 text-xs text-gray-500">{hint}</div>}
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
  const [savedMsg, setSavedMsg] = useState('');

  // Load funds + initial scenarios.
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
    if (!fundId) return;
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
        if (!cancelled) setErr(e?.message || 'Simulation failed');
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
      setTimeout(() => setSavedMsg(''), 2500);
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

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <Waves className="w-6 h-6 text-blue-600" /> Exit waterfall
          </h1>
          <p className="text-sm text-gray-600 mt-1">
            Model an exit at $X across the portfolio. European waterfall: return of capital → preferred return → GP catch-up → carry split.
          </p>
        </div>
        <select
          className="border rounded px-3 py-2 text-sm"
          value={fundId || ''}
          onChange={(e) => setFundId(Number(e.target.value))}
        >
          {funds.map((f) => (
            <option key={f.id} value={f.id}>{f.name}</option>
          ))}
        </select>
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

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-3 mb-6">
        <div className="rounded border p-3 bg-white col-span-2">
          <label className="text-xs uppercase text-gray-600">Exit value ($M)</label>
          <input
            type="number" min="0" step="5"
            value={exitValueM}
            onChange={(e) => setExitValueM(Number(e.target.value))}
            className="w-full mt-1 border rounded px-3 py-2"
          />
          <input
            type="range" min="0" max="1000" step="5"
            value={exitValueM}
            onChange={(e) => setExitValueM(Number(e.target.value))}
            className="w-full mt-2"
          />
        </div>
        <div className="rounded border p-3 bg-white">
          <label className="text-xs uppercase text-gray-600">GP carry</label>
          <input type="range" min="0" max="40" step="1" value={carryPct} onChange={(e) => setCarryPct(Number(e.target.value))} className="w-full mt-2" />
          <div className="text-sm font-medium">{carryPct}%</div>
        </div>
        <div className="rounded border p-3 bg-white">
          <label className="text-xs uppercase text-gray-600">Hurdle rate</label>
          <input type="range" min="0" max="20" step="0.5" value={hurdlePct} onChange={(e) => setHurdlePct(Number(e.target.value))} className="w-full mt-2" />
          <div className="text-sm font-medium">{hurdlePct}%</div>
        </div>
        <div className="rounded border p-3 bg-white">
          <label className="text-xs uppercase text-gray-600">Years held</label>
          <input type="range" min="1" max="15" step="0.5" value={yearsHeld} onChange={(e) => setYearsHeld(Number(e.target.value))} className="w-full mt-2" />
          <div className="text-sm font-medium">{yearsHeld} yrs</div>
        </div>
        <div className="rounded border p-3 bg-white col-span-2">
          <label className="text-xs uppercase text-gray-600 mb-2 block">GP catch-up</label>
          <label className="inline-flex items-center gap-2 text-sm">
            <input type="checkbox" checked={gpCatchup} onChange={(e) => setGpCatchup(e.target.checked)} />
            Apply 100% catch-up after hurdle
          </label>
        </div>
      </div>

      {totals && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          <Stat label="Net to LPs" value={fmt$(totals.to_lps)} hint={`MOIC ${totals.lp_moic.toFixed(2)}×`} tone="green" />
          <Stat label="To GP" value={fmt$(totals.to_gp)} hint="Catch-up + carry" tone="blue" />
          <Stat label="LP IRR" value={fmtPct(totals.lp_irr_pct)} hint={`Over ${totals.years_held}y`} />
          <Stat label="Total invested" value={fmt$(totals.total_invested)} hint={`Committed: ${fmt$(totals.total_committed)}`} tone="amber" />
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
        <div className="rounded border bg-white lg:col-span-2">
          <div className="px-4 py-3 border-b bg-gray-50 font-medium text-sm flex items-center gap-2">
            <ArrowDownToLine className="w-4 h-4" /> Distribution waterfall
          </div>
          <table className="w-full text-sm">
            <thead className="text-xs uppercase text-gray-600 bg-gray-50">
              <tr>
                <th className="text-left px-3 py-2">Tranche</th>
                <th className="text-left px-3 py-2">To</th>
                <th className="text-right px-3 py-2">Amount</th>
                <th className="text-right px-3 py-2">% of exit</th>
              </tr>
            </thead>
            <tbody>
              {(result?.tranches || []).map((t, i) => (
                <tr key={i} className="border-t">
                  <td className="px-3 py-2">{t.name}</td>
                  <td className="px-3 py-2">
                    <span className={`text-xs px-2 py-0.5 rounded ${t.to === 'GP' ? 'bg-blue-100 text-blue-800' : 'bg-emerald-100 text-emerald-800'}`}>{t.to}</span>
                  </td>
                  <td className="px-3 py-2 text-right font-medium">{fmt$(t.amount)}</td>
                  <td className="px-3 py-2 text-right text-xs text-gray-500">
                    {result?.exit_value > 0 ? `${(t.amount / result.exit_value * 100).toFixed(1)}%` : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {result?.assumptions?.length > 0 && (
            <div className="px-4 py-3 border-t bg-gray-50 text-xs text-gray-600">
              <div className="font-medium mb-1">Assumptions</div>
              <ul className="list-disc list-inside space-y-0.5">
                {result.assumptions.map((a, i) => <li key={i}>{a}</li>)}
              </ul>
            </div>
          )}
        </div>

        <div className="rounded border bg-white">
          <div className="px-4 py-3 border-b bg-gray-50 font-medium text-sm flex items-center gap-2">
            <Calculator className="w-4 h-4" /> Per-LP allocation
          </div>
          {(result?.lp_rows || []).length === 0 ? (
            <div className="p-4 text-sm text-gray-500">No LPs registered to this fund. Add LPs in <code>/capital</code> to see per-LP splits.</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-xs uppercase text-gray-600 bg-gray-50">
                <tr>
                  <th className="text-left px-3 py-2">LP</th>
                  <th className="text-right px-3 py-2">Payout</th>
                  <th className="text-right px-3 py-2">MOIC</th>
                </tr>
              </thead>
              <tbody>
                {result.lp_rows.map((r, i) => (
                  <tr key={i} className="border-t">
                    <td className="px-3 py-2">
                      <div className="font-medium">{r.name}</div>
                      <div className="text-xs text-gray-500">{r.share_pct.toFixed(1)}% of fund</div>
                    </td>
                    <td className="px-3 py-2 text-right font-medium">{fmt$(r.payout)}</td>
                    <td className="px-3 py-2 text-right">{r.moic.toFixed(2)}×</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="rounded border bg-white p-4">
          <h3 className="font-medium text-sm flex items-center gap-2 mb-3">
            <Bookmark className="w-4 h-4" /> Save scenario
          </h3>
          <div className="flex items-center gap-2">
            <input
              value={saveName}
              onChange={(e) => setSaveName(e.target.value)}
              placeholder="e.g. $250M exit base case"
              className="flex-1 border rounded px-3 py-2 text-sm"
            />
            <button
              onClick={saveScenario}
              disabled={busy || !saveName.trim() || !result}
              className="inline-flex items-center gap-2 px-3 py-2 rounded bg-gray-900 hover:bg-black text-white text-sm disabled:opacity-50"
            >
              <Save className="w-4 h-4" /> Save
            </button>
          </div>
        </div>
        <div className="rounded border bg-white p-4">
          <h3 className="font-medium text-sm mb-3">Saved scenarios</h3>
          {scenarios.length === 0 && <div className="text-xs text-gray-500">No saved scenarios yet.</div>}
          <ul className="space-y-2">
            {scenarios.map((s) => (
              <li key={s.uid} className="flex items-center justify-between text-sm border rounded px-2 py-1">
                <div>
                  <div className="font-medium">{s.name}</div>
                  <div className="text-xs text-gray-500">
                    Exit {fmt$(s.inputs?.exit_value)} · LP {fmt$(s.result?.totals?.to_lps)} · IRR {s.result?.totals?.lp_irr_pct?.toFixed(1)}%
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
