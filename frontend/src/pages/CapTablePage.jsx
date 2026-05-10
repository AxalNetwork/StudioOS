import React, { useEffect, useMemo, useState } from 'react';
import PageExplainer from '../components/PageExplainer';
import { api } from '../lib/api';
import { useToast } from '../components/useToast';
import {
  PieChart as PieIcon, Trash2, Plus, Save, Download, RefreshCw, FileText, AlertCircle,
  PencilOff, ExternalLink, CheckCircle2,
} from 'lucide-react';
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend,
  BarChart, Bar,
} from 'recharts';

const DEFAULT_INPUTS = {
  founders: [
    { name: 'Founder A', shares: 5_000_000 },
    { name: 'Founder B', shares: 5_000_000 },
  ],
  option_pool_pct: 10,
  safes: [
    { name: 'Pre-seed SAFE', amount: 500_000, cap: 8_000_000, discount: 0.20 },
  ],
  rounds: [
    { name: 'Seed', pre_money: 12_000_000, investment: 3_000_000, post_round_pool_pct: 12 },
  ],
  exit_value: 100_000_000,
};

const TYPE_COLOR = {
  founder: 'bg-violet-100 text-violet-700',
  option_pool: 'bg-amber-100 text-amber-700',
  safe: 'bg-sky-100 text-sky-700',
  preferred: 'bg-emerald-100 text-emerald-700',
};

const PALETTE = ['#7c3aed', '#10b981', '#0ea5e9', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4'];

function Section({ title, right, children }) {
  return (
    <div className="bg-white border border-gray-200 rounded-lg p-4 mb-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-semibold text-gray-900">{title}</h3>
        {right}
      </div>
      {children}
    </div>
  );
}

function NumInput({ value, onChange, ...rest }) {
  return (
    <input
      type="number"
      value={value ?? ''}
      onChange={e => onChange(e.target.value === '' ? '' : Number(e.target.value))}
      className="w-full px-2 py-1 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-violet-500 focus:border-violet-500"
      {...rest}
    />
  );
}

function TxtInput({ value, onChange, ...rest }) {
  return (
    <input
      type="text" value={value ?? ''} onChange={e => onChange(e.target.value)}
      className="w-full px-2 py-1 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-violet-500 focus:border-violet-500"
      {...rest}
    />
  );
}

export default function CapTablePage() {
  const [inputs, setInputs] = useState(DEFAULT_INPUTS);
  const [result, setResult] = useState(null);
  const [errors, setErrors] = useState([]);
  // apiError is for transport / auth / availability failures (404, 401, 5xx,
  // network). It's surfaced in its OWN banner so it doesn't get rendered
  // under the misleading "Validation errors" header — that header is reserved
  // for real 422 input-validation feedback from the simulator.
  const [apiError, setApiError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [scenarios, setScenarios] = useState([]);
  const [activeUid, setActiveUid] = useState(null);
  const [scenarioName, setScenarioName] = useState('Untitled scenario');
  // T19 — toast hook auto-clears on unmount. Replaces the inline
  // `setTimeout(() => setSavedFlash(''), 1500)` that leaked on quick navigation.
  const { toast: savedFlash, showToast: setSavedFlash } = useToast(1500);

  // Task #5 — Live cap table (Carta-synced) state. Fetched once on mount;
  // a manual "Refresh" button re-pulls. Banner shows last-sync age.
  const [live, setLive] = useState(null);
  const [liveLoading, setLiveLoading] = useState(false);
  const [liveError, setLiveError] = useState(null);

  useEffect(() => { loadScenarios(); }, []);
  useEffect(() => { runSim(); /* eslint-disable-next-line */ }, []);
  useEffect(() => { loadLive(); }, []);

  async function loadLive() {
    setLiveLoading(true); setLiveError(null);
    try {
      const r = await api.liveCapTable();
      setLive(r);
    } catch (e) {
      // 401/403 simply means "not signed in" or "no access"; don't surface
      // a noisy banner for the unauthenticated case (the rest of the page
      // handles auth). 404 means the route isn't deployed yet — silent.
      if (e?.status && e.status !== 404 && e.status !== 401 && e.status !== 403) {
        setLiveError("Couldn't load your live cap table. Please retry.");
      }
    }
    setLiveLoading(false);
  }

  async function loadScenarios() {
    try {
      const r = await api.listCapTableScenarios();
      setScenarios(r.items || []);
    } catch (e) { /* user may not have any yet */ }
  }

  async function runSim() {
    setLoading(true); setErrors([]); setApiError(null);
    try {
      const r = await api.simulateCapTable(inputs);
      setResult(r);
    } catch (e) {
      // Distinguish transport/availability problems from real input-validation
      // errors so the user doesn't see a misleading "Validation errors: Not
      // found" banner when the simulator endpoint is just unreachable.
      //
      // Backend contract (backend/app/api/routes/captable.py): genuine
      // validation failures arrive as HTTP 400 (or 422 if FastAPI's body
      // parser rejects), with the structured payload on `e.data` thanks to
      // the api.js request wrapper:
      //   e.data = { code: 'invalid_inputs', errors: [...] }
      // We rely on the presence of `e.data.errors` rather than parsing
      // `e.message` (which is a human string, not JSON).
      const status = e?.status;
      const msg = (e?.message || '').toLowerCase();
      const validationErrs = Array.isArray(e?.data?.errors) ? e.data.errors : null;
      if (validationErrs && validationErrs.length > 0) {
        setErrors(validationErrs);
      } else if (status === 404 || msg.includes('not found')) {
        setApiError("The cap-table simulator isn't reachable right now. Please retry in a moment, or contact support if it persists.");
      } else if (status === 401 || status === 403) {
        setApiError('Your session expired or you do not have access to the simulator. Please sign in again.');
      } else if (status === 400 || status === 422) {
        // 400/422 with no structured errors array — generic friendly hint.
        // Don't surface raw `e.message` here: backend validation strings can
        // include implementation detail (field paths, type names) that's not
        // useful to a founder.
        setErrors(['Some inputs are invalid. Please review the highlighted sections and try again.']);
      } else {
        setApiError('Simulation failed. Please retry in a moment, or contact support if it persists.');
      }
      setResult(null);
    }
    setLoading(false);
  }

  async function saveScenario() {
    setSavedFlash(''); setApiError(null);
    try {
      let s;
      if (activeUid) {
        s = await api.updateCapTableScenario(activeUid, { name: scenarioName, inputs });
      } else {
        s = await api.createCapTableScenario({ name: scenarioName, inputs });
        setActiveUid(s.uid);
      }
      setResult(s.result || result);
      setSavedFlash('Saved');
      loadScenarios();
    } catch (e) {
      const status = e?.status;
      const msg = (e?.message || '').toLowerCase();
      if (status === 404 || msg.includes('not found')) {
        // The scenario UID we were editing was deleted out from under us.
        // Drop the activeUid so the next save creates a fresh scenario.
        setActiveUid(null);
        setApiError("This scenario is no longer available — saving will create a new one. Click Save again to keep your changes.");
      } else if (status === 401 || status === 403) {
        setApiError('Your session expired. Please sign in again to save scenarios.');
      } else {
        setApiError('Save failed. Please retry in a moment, or contact support if it persists.');
      }
    }
  }

  async function loadScenario(uid) {
    const s = await api.getCapTableScenario(uid);
    setInputs(s.inputs);
    setResult(s.result);
    setActiveUid(uid);
    setScenarioName(s.name);
  }

  async function delScenario(uid) {
    if (!confirm('Delete this scenario?')) return;
    await api.deleteCapTableScenario(uid);
    if (uid === activeUid) {
      setActiveUid(null);
      setScenarioName('Untitled scenario');
    }
    loadScenarios();
  }

  function newScenario() {
    setInputs(DEFAULT_INPUTS);
    setActiveUid(null);
    setScenarioName('Untitled scenario');
    setResult(null);
  }

  // ---------- Founder dilution chart data
  const dilutionChart = useMemo(() => {
    if (!result?.founder_dilution?.length) return [];
    const rounds = result.founder_dilution[0].series.map(s => s.round);
    return rounds.map((round, i) => {
      const row = { round };
      for (const f of result.founder_dilution) row[f.founder] = f.series[i]?.pct || 0;
      return row;
    });
  }, [result]);

  const waterfallChart = useMemo(() => {
    if (!result?.waterfall?.rows) return [];
    return result.waterfall.rows.map(r => ({
      holder: r.holder, payout: r.payout,
    }));
  }, [result]);

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <PieIcon className="text-violet-600" /> Cap-Table Simulator
          </h1>
        <PageExplainer pageKey="captable" />
          <p className="text-sm text-gray-500">
            Model SAFE notes, priced rounds, dilution, and exit waterfalls before you sign.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <input
            value={scenarioName}
            onChange={e => setScenarioName(e.target.value)}
            className="px-3 py-1.5 text-sm border border-gray-300 rounded"
            placeholder="Scenario name"
          />
          <button onClick={newScenario}
            className="px-3 py-1.5 text-sm bg-white border border-gray-300 rounded hover:bg-gray-50 flex items-center gap-1">
            <Plus size={14} /> New
          </button>
          <button onClick={saveScenario}
            className="px-3 py-1.5 text-sm bg-violet-600 text-white rounded hover:bg-violet-700 flex items-center gap-1">
            <Save size={14} /> {activeUid ? 'Update' : 'Save'}
          </button>
          {activeUid && (
            <a
              href={api.exportCapTableCsvUrl(activeUid)}
              target="_blank" rel="noreferrer"
              className="px-3 py-1.5 text-sm bg-white border border-gray-300 rounded hover:bg-gray-50 flex items-center gap-1"
              onClick={(e) => {
                // Append the auth header by switching to fetch+blob — easier: open with token in URL hash.
                e.preventDefault();
                downloadCsv(activeUid, scenarioName);
              }}
            >
              <Download size={14} /> CSV
            </a>
          )}
        </div>
      </div>

      {savedFlash && <div className="mb-3 text-sm text-emerald-700">{savedFlash}</div>}
      {apiError && (
        <div className="mb-4 flex items-start gap-2 bg-rose-50 border border-rose-200 rounded-lg px-4 py-3 text-sm text-rose-700">
          <AlertCircle size={16} className="mt-0.5 shrink-0" />
          <span>{apiError}</span>
        </div>
      )}
      {errors.length > 0 && (
        <div className="mb-4 bg-red-50 border border-red-200 rounded p-3 text-sm text-red-700">
          <div className="flex items-center gap-1 font-semibold mb-1"><AlertCircle size={14}/> Validation errors</div>
          <ul className="list-disc pl-5">{errors.map((e, i) => <li key={i}>{e}</li>)}</ul>
        </div>
      )}

      <LiveCapTablePanel
        live={live}
        loading={liveLoading}
        error={liveError}
        onRefresh={loadLive}
      />

      <div className="grid grid-cols-12 gap-4">
        {/* -------- LEFT: inputs -------- */}
        <div className="col-span-12 lg:col-span-5">
          <Section title="Founders">
            <table className="w-full text-sm">
              <thead><tr className="text-xs text-gray-500"><th className="text-left">Name</th><th className="text-right">Shares</th><th></th></tr></thead>
              <tbody>
                {inputs.founders.map((f, i) => (
                  <tr key={i}>
                    <td className="pr-2 py-1"><TxtInput value={f.name} onChange={v => updateRow(setInputs, 'founders', i, { name: v })} /></td>
                    <td className="pr-2 py-1"><NumInput value={f.shares} onChange={v => updateRow(setInputs, 'founders', i, { shares: v })} /></td>
                    <td><button onClick={() => removeRow(setInputs, 'founders', i)} className="text-gray-400 hover:text-red-600"><Trash2 size={14}/></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
            <button onClick={() => addRow(setInputs, 'founders', { name: 'Co-founder', shares: 1_000_000 })}
              className="mt-2 text-xs text-violet-700 hover:underline flex items-center gap-1"><Plus size={12}/> Add founder</button>
          </Section>

          <Section title="Initial Option Pool">
            <label className="text-xs text-gray-500">Pool % of post-founding cap</label>
            <NumInput value={inputs.option_pool_pct} onChange={v => setInputs({ ...inputs, option_pool_pct: v })} min={0} max={80} step={0.5} />
          </Section>

          <Section title="SAFE Notes">
            <table className="w-full text-sm">
              <thead><tr className="text-xs text-gray-500"><th className="text-left">Name</th><th className="text-right">Amount $</th><th className="text-right">Cap $</th><th className="text-right">Discount</th><th></th></tr></thead>
              <tbody>
                {inputs.safes.map((s, i) => (
                  <tr key={i}>
                    <td className="pr-1 py-1"><TxtInput value={s.name} onChange={v => updateRow(setInputs, 'safes', i, { name: v })} /></td>
                    <td className="pr-1 py-1"><NumInput value={s.amount} onChange={v => updateRow(setInputs, 'safes', i, { amount: v })} /></td>
                    <td className="pr-1 py-1"><NumInput value={s.cap} onChange={v => updateRow(setInputs, 'safes', i, { cap: v })} /></td>
                    <td className="pr-1 py-1"><NumInput value={s.discount} step={0.05} max={0.9} onChange={v => updateRow(setInputs, 'safes', i, { discount: v })} /></td>
                    <td><button onClick={() => removeRow(setInputs, 'safes', i)} className="text-gray-400 hover:text-red-600"><Trash2 size={14}/></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
            <button onClick={() => addRow(setInputs, 'safes', { name: `SAFE ${inputs.safes.length + 1}`, amount: 250_000, cap: 10_000_000, discount: 0.2 })}
              className="mt-2 text-xs text-violet-700 hover:underline flex items-center gap-1"><Plus size={12}/> Add SAFE</button>
          </Section>

          <Section title="Priced Rounds">
            <table className="w-full text-sm">
              <thead><tr className="text-xs text-gray-500"><th className="text-left">Name</th><th className="text-right">Pre-$</th><th className="text-right">Invest $</th><th className="text-right">Pool % post</th><th></th></tr></thead>
              <tbody>
                {inputs.rounds.map((r, i) => (
                  <tr key={i}>
                    <td className="pr-1 py-1"><TxtInput value={r.name} onChange={v => updateRow(setInputs, 'rounds', i, { name: v })} /></td>
                    <td className="pr-1 py-1"><NumInput value={r.pre_money} onChange={v => updateRow(setInputs, 'rounds', i, { pre_money: v })} /></td>
                    <td className="pr-1 py-1"><NumInput value={r.investment} onChange={v => updateRow(setInputs, 'rounds', i, { investment: v })} /></td>
                    <td className="pr-1 py-1"><NumInput value={r.post_round_pool_pct} onChange={v => updateRow(setInputs, 'rounds', i, { post_round_pool_pct: v })} /></td>
                    <td><button onClick={() => removeRow(setInputs, 'rounds', i)} className="text-gray-400 hover:text-red-600"><Trash2 size={14}/></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
            <button onClick={() => addRow(setInputs, 'rounds', { name: `Series ${String.fromCharCode(64 + inputs.rounds.length + 1)}`, pre_money: 25_000_000, investment: 6_000_000, post_round_pool_pct: 12 })}
              className="mt-2 text-xs text-violet-700 hover:underline flex items-center gap-1"><Plus size={12}/> Add round</button>
          </Section>

          <Section title="Exit Waterfall">
            <label className="text-xs text-gray-500">Exit value $ (acquisition / IPO)</label>
            <NumInput value={inputs.exit_value} onChange={v => setInputs({ ...inputs, exit_value: v })} />
          </Section>

          <button onClick={runSim} disabled={loading}
            className="w-full px-3 py-2 bg-violet-600 text-white rounded hover:bg-violet-700 flex items-center justify-center gap-2 disabled:opacity-50">
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''}/> Run simulation
          </button>

          {scenarios.length > 0 && (
            <Section title="Saved scenarios">
              <ul className="text-sm divide-y divide-gray-100">
                {scenarios.map(s => (
                  <li key={s.uid} className="py-1.5 flex items-center justify-between">
                    <button onClick={() => loadScenario(s.uid)} className={`text-left flex-1 truncate ${activeUid === s.uid ? 'font-semibold text-violet-700' : 'text-gray-700 hover:text-violet-700'}`}>
                      {s.name}
                    </button>
                    <button onClick={() => delScenario(s.uid)} className="text-gray-400 hover:text-red-600 ml-2"><Trash2 size={14}/></button>
                  </li>
                ))}
              </ul>
            </Section>
          )}
        </div>

        {/* -------- RIGHT: outputs -------- */}
        <div className="col-span-12 lg:col-span-7">
          {result?.warnings?.length > 0 && (
            <div className="mb-3 text-xs bg-amber-50 border border-amber-200 rounded p-2 text-amber-800">
              {result.warnings.map((w, i) => <div key={i}>⚠ {w}</div>)}
            </div>
          )}

          {result?.founding && (
            <Section title="Founding cap table">
              <CapTable rows={result.founding} />
            </Section>
          )}

          {(result?.rounds || []).map((r, idx) => (
            <Section key={idx}
              title={`After ${r.name} — pre $${fmtMoney(r.pre_money)} / post $${fmtMoney(r.post_money)} / PPS $${r.price_per_share.toFixed(4)}`}>
              {r.events?.length > 0 && (
                <ul className="text-xs text-gray-600 mb-2 list-disc pl-5">
                  {r.events.map((e, i) => <li key={i}>{e}</li>)}
                </ul>
              )}
              <CapTable rows={r.ledger} />
            </Section>
          ))}

          {dilutionChart.length > 0 && (
            <Section title="Founder dilution">
              <ResponsiveContainer width="100%" height={240}>
                <LineChart data={dilutionChart}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="round" />
                  <YAxis tickFormatter={v => `${v}%`} />
                  <Tooltip formatter={v => `${v.toFixed(2)}%`} />
                  <Legend />
                  {result.founder_dilution.map((f, i) => (
                    <Line key={f.founder} type="monotone" dataKey={f.founder} stroke={PALETTE[i % PALETTE.length]} strokeWidth={2} />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </Section>
          )}

          {result?.waterfall && (
            <Section title={`Exit waterfall @ $${fmtMoney(result.waterfall.exit_value)}`}>
              <div className="grid grid-cols-3 gap-2 text-center mb-3">
                <Stat label="Preferences paid" value={`$${fmtMoney(result.waterfall.totals.preference_paid)}`} />
                <Stat label="Common pool"     value={`$${fmtMoney(result.waterfall.totals.common_pool)}`} />
                <Stat label="Total"           value={`$${fmtMoney(result.waterfall.totals.total_distributed)}`} />
              </div>
              <ResponsiveContainer width="100%" height={Math.max(200, waterfallChart.length * 32)}>
                <BarChart data={waterfallChart} layout="vertical" margin={{ left: 100 }}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis type="number" tickFormatter={v => `$${fmtMoney(v)}`} />
                  <YAxis type="category" dataKey="holder" width={120} tick={{ fontSize: 11 }} />
                  <Tooltip formatter={v => `$${fmtMoney(v)}`} />
                  <Bar dataKey="payout" fill="#7c3aed" />
                </BarChart>
              </ResponsiveContainer>
              <table className="w-full text-xs mt-3">
                <thead className="text-gray-500"><tr><th className="text-left">Holder</th><th>Type</th><th className="text-right">Shares</th><th className="text-right">Pref $</th><th className="text-right">Payout $</th><th>Source</th></tr></thead>
                <tbody>
                  {result.waterfall.rows.map((r, i) => (
                    <tr key={i} className="border-t border-gray-100">
                      <td className="py-1">{r.holder}</td>
                      <td><span className={`px-1.5 py-0.5 rounded text-[10px] ${TYPE_COLOR[r.type] || 'bg-gray-100 text-gray-700'}`}>{r.type}</span></td>
                      <td className="text-right">{r.shares.toLocaleString()}</td>
                      <td className="text-right">{r.preference ? `$${fmtMoney(r.preference)}` : '—'}</td>
                      <td className="text-right font-semibold">${fmtMoney(r.payout)}</td>
                      <td className="text-gray-500">{r.source}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="text-[11px] text-gray-500 mt-2">
                Assumptions: {result.waterfall.assumptions?.join(' · ')}
              </div>
            </Section>
          )}

          {!result && !loading && (
            <div className="bg-white border border-dashed border-gray-300 rounded p-8 text-center text-gray-500">
              <FileText className="mx-auto mb-2 text-gray-400" />
              Tweak the inputs on the left and hit <span className="font-semibold">Run simulation</span>.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function CapTable({ rows }) {
  const total = rows.reduce((s, h) => s + h.shares, 0);
  return (
    <table className="w-full text-sm">
      <thead className="text-xs text-gray-500"><tr><th className="text-left">Holder</th><th>Type</th><th className="text-right">Shares</th><th className="text-right">%</th></tr></thead>
      <tbody>
        {rows.map((h, i) => (
          <tr key={i} className="border-t border-gray-100">
            <td className="py-1">{h.holder}</td>
            <td><span className={`px-1.5 py-0.5 rounded text-[10px] ${TYPE_COLOR[h.type] || 'bg-gray-100 text-gray-700'}`}>{h.type}</span></td>
            <td className="text-right">{h.shares.toLocaleString()}</td>
            <td className="text-right">{h.pct.toFixed(2)}%</td>
          </tr>
        ))}
        <tr className="border-t border-gray-300 font-semibold">
          <td className="py-1">Total</td><td></td>
          <td className="text-right">{total.toLocaleString()}</td><td className="text-right">100.00%</td>
        </tr>
      </tbody>
    </table>
  );
}

function Stat({ label, value }) {
  return (
    <div className="border border-gray-200 rounded p-2">
      <div className="text-base font-semibold text-gray-900">{value}</div>
      <div className="text-[10px] text-gray-500 uppercase">{label}</div>
    </div>
  );
}

function fmtMoney(n) {
  if (n === null || n === undefined) return '0';
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (Math.abs(n) >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return Number(n).toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function updateRow(setter, key, idx, patch) {
  setter(prev => {
    const next = [...prev[key]];
    next[idx] = { ...next[idx], ...patch };
    return { ...prev, [key]: next };
  });
}
function addRow(setter, key, row) {
  setter(prev => ({ ...prev, [key]: [...prev[key], row] }));
}
function removeRow(setter, key, idx) {
  setter(prev => ({ ...prev, [key]: prev[key].filter((_, i) => i !== idx) }));
}

async function downloadCsv(uid, name) {
  const token = localStorage.getItem('token');
  const r = await fetch(`/api/captable/scenarios/${uid}/export.csv`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!r.ok) { alert('Export failed'); return; }
  const blob = await r.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `captable-${name || 'scenario'}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

// ───────────────────────────────────────────────────────── Task #5 — Live Cap Table

function timeAgo(iso) {
  if (!iso) return null;
  const t = Date.parse(iso.replace(' ', 'T') + (iso.endsWith('Z') ? '' : 'Z'));
  if (!Number.isFinite(t)) return null;
  const mins = Math.max(0, Math.floor((Date.now() - t) / 60000));
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} hr ago`;
  const days = Math.floor(hrs / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

function CartaLogo({ size = 14 }) {
  // Lightweight inline mark — Lucide PieChart wedge tinted Carta-orange.
  // Avoids shipping a third-party brand SVG asset.
  return (
    <span
      className="inline-flex items-center justify-center"
      title="Synced from Carta"
      aria-label="Synced from Carta"
      style={{ width: size + 4, height: size + 4 }}
    >
      <PieIcon size={size} className="text-orange-600" />
    </span>
  );
}

function SourceBadge({ source }) {
  if (source === 'carta') {
    return (
      <span
        className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-orange-50 text-orange-700 border border-orange-200 cursor-not-allowed"
        title="Edit in Carta — read-only here"
      >
        <CartaLogo size={10} /> Carta
        <PencilOff size={9} className="ml-0.5" />
      </span>
    );
  }
  return (
    <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-gray-100 text-gray-600 border border-gray-200">
      Manual
    </span>
  );
}

function LiveCapTablePanel({ live, loading, error, onRefresh }) {
  const connected = !!live?.connected;
  const holders = live?.holders || [];
  const securities = live?.securities || [];
  const cartaHolders = holders.filter(h => h.source === 'carta');
  const ago = timeAgo(live?.last_synced_at);

  // Hide entirely when there's nothing to show: not connected AND no
  // historical Carta-sourced rows (i.e. user has never used the integration).
  // Show a slim banner when connected, or when manual rows exist after a
  // disconnect (so the founder still has a "Connect Carta" upsell entry).
  if (!loading && !connected && holders.length === 0 && !error) {
    return (
      <div className="mb-4 bg-white border border-dashed border-gray-300 rounded-lg p-4 text-sm">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-start gap-2">
            <CartaLogo size={18} />
            <div>
              <div className="font-semibold text-gray-900">Live cap table</div>
              <div className="text-gray-500 text-xs mt-0.5">
                Connect Carta on the Integrations page to mirror your real cap table here.
              </div>
            </div>
          </div>
          <a
            href="/integrations"
            className="text-xs text-violet-700 hover:underline inline-flex items-center gap-1"
          >
            Connect Carta <ExternalLink size={12} />
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="mb-4 bg-white border border-gray-200 rounded-lg overflow-hidden">
      <div className={`px-4 py-3 flex items-center justify-between gap-3 ${connected ? 'bg-orange-50 border-b border-orange-100' : 'bg-gray-50 border-b border-gray-200'}`}>
        <div className="flex items-start gap-2">
          <CartaLogo size={18} />
          <div>
            <div className="font-semibold text-gray-900 flex items-center gap-2">
              Live cap table
              {connected && (
                <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-700">
                  <CheckCircle2 size={12} /> Connected
                </span>
              )}
            </div>
            <div className="text-xs text-gray-600 mt-0.5">
              {connected ? (
                <>
                  Synced from Carta{live?.issuer_name ? ` · ${live.issuer_name}` : ''}
                  {ago ? <> — last sync <span className="font-medium">{ago}</span></> : <> — awaiting first sync</>}
                </>
              ) : (
                <>Not connected — historical rows shown as manual.</>
              )}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={onRefresh}
            disabled={loading}
            className="text-xs px-2 py-1 bg-white border border-gray-300 rounded hover:bg-gray-50 inline-flex items-center gap-1 disabled:opacity-50"
          >
            <RefreshCw size={12} className={loading ? 'animate-spin' : ''} /> Refresh
          </button>
          <a
            href="/integrations"
            className="text-xs px-2 py-1 bg-white border border-gray-300 rounded hover:bg-gray-50 inline-flex items-center gap-1"
          >
            Manage <ExternalLink size={12} />
          </a>
        </div>
      </div>

      {error && (
        <div className="px-4 py-2 text-xs text-rose-700 bg-rose-50 border-b border-rose-100 flex items-center gap-1">
          <AlertCircle size={12} /> {error}
        </div>
      )}
      {connected && live?.last_error && (
        <div className="px-4 py-2 text-xs text-amber-800 bg-amber-50 border-b border-amber-100 flex items-center gap-1">
          <AlertCircle size={12} /> Last sync reported: {live.last_error}
        </div>
      )}

      {holders.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-gray-500 bg-gray-50">
                <th className="text-left px-4 py-2">Holder</th>
                <th className="text-left px-2 py-2">Class</th>
                <th className="text-right px-2 py-2">Shares</th>
                <th className="text-right px-2 py-2">Ownership %</th>
                <th className="text-left px-4 py-2">Source</th>
              </tr>
            </thead>
            <tbody>
              {holders.slice(0, 50).map((h) => (
                <tr key={h.id} className={`border-t border-gray-100 ${h.source === 'carta' ? 'bg-orange-50/30' : ''}`}>
                  <td className="px-4 py-1.5">
                    <div className="font-medium text-gray-900">{h.name}</div>
                    {h.email && <div className="text-[11px] text-gray-500">{h.email}</div>}
                  </td>
                  <td className="px-2 py-1.5 text-gray-600 text-xs">{h.security_type || '—'}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{Number(h.shares || 0).toLocaleString()}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{Number(h.ownership_pct || 0).toFixed(2)}%</td>
                  <td className="px-4 py-1.5"><SourceBadge source={h.source} /></td>
                </tr>
              ))}
            </tbody>
          </table>
          {holders.length > 50 && (
            <div className="px-4 py-2 text-xs text-gray-500 border-t border-gray-100">
              Showing 50 of {holders.length} holders.
            </div>
          )}
          {securities.length > 0 && (
            <div className="px-4 py-2 text-xs text-gray-500 border-t border-gray-100">
              {securities.length} share class{securities.length === 1 ? '' : 'es'} synced
              ({cartaHolders.length} holder row{cartaHolders.length === 1 ? '' : 's'} sourced from Carta).
            </div>
          )}
        </div>
      ) : (
        <div className="px-4 py-6 text-sm text-gray-500 text-center">
          {loading
            ? 'Loading live cap table…'
            : connected
              ? 'Syncing your cap table from Carta now — this usually completes in under a minute. Click Refresh to check.'
              : 'No holders synced yet.'}
        </div>
      )}
    </div>
  );
}
