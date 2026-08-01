// Spin-Out Lab — Use of Funds (Week 4 tool page).
//
// Design handoff: attached_assets/Use_of_Funds.dc_*.html (same file ships in
// the StudioOS repo under spin-out-lab-pipeline/project). Mapping to REAL
// surfaces only:
//   - Allocation: the project's canonical `use_of_funds` field (JSON
//     percentages over the five fixed FUND_SECTIONS) edited through the SAME
//     shared FundAllocator the deck-side editor uses, plus `funding_needed`
//     as the raise. Saved via the real project update route — THE ASK deck
//     slide reads these fields live, so there is no "sync" button to fake.
//   - Runway modeling & scenario comparison: a client-side planning
//     calculator, clearly labeled as not stored. No burn-rate/expenses field
//     exists in either runtime, so burn is an ephemeral what-if input —
//     fabricating a persisted "current burn" would be dishonest.
//   - Milestone → capital mapping: Roadmap items carry NO cost/budget fields
//     in either runtime, so the design's per-milestone costs are fabricated.
//     We show the real Week-4 context honestly and say costs aren't tracked.
//   - Omitted (no backend): Share/Export/Copy link, "Preview as investor",
//     "Synced 2 min ago" chips, per-milestone efficiency, sync buttons.

import React, { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  ArrowLeft, PieChart, Loader2, Lock, AlertTriangle, FileText,
  Presentation, Gauge, Map as MapIcon, Calculator,
} from 'lucide-react';
import { api, spinoutLab } from '../lib/api';
import { pickLabProject } from './SpinoutLabStartupPage';
import {
  FUND_SECTIONS, FundAllocator, allocToValues, valuesToUseOfFunds, fundsTotal, fundsValid,
} from '../components/FundAllocator';

const CARD = 'rounded-2xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 p-5';
const LBL = 'text-[11px] font-bold uppercase tracking-wider text-gray-400 dark:text-gray-500';
const INPUT = 'w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-[13px] text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-violet-500/40';

// Section colors, index-aligned with FUND_SECTIONS.
const SECTION_COLORS = ['#7c3aed', '#0d9488', '#0284c7', '#d97706', '#e11d48'];
const SECTION_BG = ['bg-violet-600', 'bg-teal-600', 'bg-sky-600', 'bg-amber-600', 'bg-rose-600'];

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);

export function fmtRaise(v) {
  const n = num(v);
  if (n === null || n <= 0) return '—';
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(n % 1_000_000 ? 1 : 0)}M`;
  if (n >= 1_000) return `$${Math.round(n / 1_000)}K`;
  return `$${n}`;
}

// Runway math for the what-if calculator. Pure + exported for reuse/tests.
export function runwayMonths(raise, burn) {
  const r = num(raise);
  const b = num(burn);
  if (!r || !b || r <= 0 || b <= 0) return null;
  return r / b;
}

export function runwayBand(months, threshold) {
  if (months === null) return null;
  if (months < Number(threshold || 6)) return 'critical';
  if (months < 12) return 'tight';
  return 'healthy';
}

const BAND_STYLES = {
  healthy: { label: 'Healthy · above 12 months', cls: 'text-emerald-600 dark:text-emerald-400' },
  tight: { label: 'Tight · under 12 months', cls: 'text-amber-600 dark:text-amber-400' },
  critical: { label: 'Below your alert threshold', cls: 'text-rose-600 dark:text-rose-400' },
};

function cashOutLabel(months) {
  if (months === null) return '—';
  const d = new Date();
  d.setMonth(d.getMonth() + Math.floor(months));
  return d.toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
}

// SVG donut from the 5-slot percentage array (only non-zero slices).
function Donut({ values, centerLabel }) {
  const total = fundsTotal(values);
  const R = 42;
  const C = 2 * Math.PI * R;
  let offset = 0;
  return (
    <svg viewBox="0 0 120 120" className="w-36 h-36" role="img" aria-label="Allocation donut">
      <circle cx="60" cy="60" r={R} fill="none" stroke="currentColor" className="text-gray-100 dark:text-gray-800" strokeWidth="14" />
      {total > 0 && values.map((v, i) => {
        if (!v) return null;
        const frac = v / Math.max(total, 100);
        const dash = frac * C;
        const el = (
          <circle
            key={FUND_SECTIONS[i]}
            cx="60" cy="60" r={R} fill="none"
            stroke={SECTION_COLORS[i]} strokeWidth="14"
            strokeDasharray={`${dash} ${C - dash}`}
            strokeDashoffset={-offset}
            transform="rotate(-90 60 60)"
          />
        );
        offset += dash;
        return el;
      })}
      <text x="60" y="57" textAnchor="middle" className="fill-gray-400" style={{ fontSize: 9 }}>Deploys</text>
      <text x="60" y="70" textAnchor="middle" className="fill-gray-900 dark:fill-gray-100" style={{ fontSize: 12, fontWeight: 800 }}>{centerLabel}</text>
    </svg>
  );
}

const SCENARIOS = [
  { key: 'preseed', name: 'Pre-seed', raise: 500_000 },
  { key: 'seed', name: 'Seed', raise: 1_000_000 },
  { key: 'growth', name: 'Growth', raise: 2_000_000 },
];

export default function SpinoutLabUseOfFundsPage() {
  const navigate = useNavigate();
  const [status, setStatus] = useState('loading');
  const [state, setState] = useState(null);
  const [user, setUser] = useState(null);
  const [project, setProject] = useState(null);
  // Allocation editor state (owned here; FundAllocator is stateless).
  const [values, setValues] = useState([0, 0, 0, 0, 0]);
  const [raiseInput, setRaiseInput] = useState('');
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [savedAt, setSavedAt] = useState(null);
  // Ephemeral what-if inputs (deliberately NOT persisted — no backend field).
  const [burn, setBurn] = useState('');
  const [threshold, setThreshold] = useState(6);
  const [customRaise, setCustomRaise] = useState(null);

  useEffect(() => {
    let dead = false;
    (async () => {
      try {
        const [st, me, projects] = await Promise.all([
          spinoutLab.state(),
          api.getMe(),
          api.listProjects().catch(() => []),
        ]);
        if (dead) return;
        setState(st);
        setUser(me);
        const proj = pickLabProject(projects, me);
        setProject(proj || null);
        if (proj) {
          setValues(allocToValues(proj.use_of_funds));
          setRaiseInput(proj.funding_needed != null && Number(proj.funding_needed) > 0 ? String(proj.funding_needed) : '');
        }
        setStatus('ready');
      } catch (e) {
        console.error('[spinout-uof]', e);
        if (!dead) setStatus('error');
      }
    })();
    return () => { dead = true; };
  }, []);

  const canEdit = !!(user && project && Number(user.founder_id) === Number(project.founder_id));
  const total = fundsTotal(values);
  const valid = fundsValid(values);
  const raise = num(raiseInput);
  const effectiveRaise = raise && raise > 0 ? raise : null;

  const onSlice = (i, v) => {
    const next = [...values];
    next[i] = Math.max(0, Math.min(100, Math.round(Number(v) || 0)));
    setValues(next);
    setDirty(true);
    setSaveError('');
  };

  const save = async () => {
    if (saving || !valid) return;
    setSaving(true);
    setSaveError('');
    try {
      const body = { use_of_funds: valuesToUseOfFunds(values) || null };
      if (raiseInput !== '') body.funding_needed = Number(raiseInput);
      else body.funding_needed = null;
      await api.updateProject(project.id, body);
      const projects = await api.listProjects().catch(() => null);
      if (Array.isArray(projects)) {
        const proj = pickLabProject(projects, user);
        if (proj) {
          setProject(proj);
          setValues(allocToValues(proj.use_of_funds));
        }
      }
      setDirty(false);
      setSavedAt(new Date());
    } catch (e) {
      console.error('[spinout-uof:save]', e);
      const detail = e?.data?.detail?.error || e?.data?.error || e?.message || 'Could not save the allocation.';
      setSaveError(typeof detail === 'string' ? detail : 'Could not save the allocation.');
    } finally {
      setSaving(false);
    }
  };

  // What-if runway math (client-side only).
  const burnN = num(burn);
  const months = runwayMonths(effectiveRaise, burnN);
  const band = runwayBand(months, threshold);
  const largestIdx = values.reduce((best, v, i) => (v > values[best] ? i : best), 0);
  const scenarioRaise = customRaise ?? effectiveRaise ?? 1_000_000;

  const milestones = state?.milestones || [];

  if (status === 'loading') {
    return (
      <div className="flex items-center justify-center min-h-[60vh]" data-testid="uof-loading">
        <Loader2 className="w-6 h-6 animate-spin text-violet-500" />
      </div>
    );
  }
  if (status === 'error') {
    return (
      <div className="max-w-xl mx-auto mt-16 text-center" data-testid="uof-error">
        <AlertTriangle className="w-8 h-8 text-amber-400 mx-auto mb-3" />
        <h2 className="text-lg font-bold text-gray-900 dark:text-gray-50 mb-1">Couldn't load Use of Funds</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400">Reload the page to try again.</p>
      </div>
    );
  }
  if (!state?.active) {
    return (
      <div className="max-w-xl mx-auto mt-16 text-center" data-testid="uof-inactive">
        <Lock className="w-8 h-8 text-gray-300 dark:text-gray-600 mx-auto mb-3" />
        <h2 className="text-lg font-bold text-gray-900 dark:text-gray-50 mb-1">Spin-Out Lab is not active</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Use of Funds planning is part of the Spin-Out Lab program.{' '}
          <Link to="/spinout-lab" className="text-violet-600 hover:underline">Go to the Lab</Link>
        </p>
      </div>
    );
  }
  if (!(state?.unlocked_features || []).includes('use-of-funds')) {
    return (
      <div className="max-w-xl mx-auto mt-16 text-center" data-testid="uof-locked">
        <Lock className="w-8 h-8 text-gray-300 dark:text-gray-600 mx-auto mb-3" />
        <h2 className="text-lg font-bold text-gray-900 dark:text-gray-50 mb-1">Use of Funds unlocks in Week 4</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
          Finish your current week's deliverables to unlock capital planning.
        </p>
        <Link to="/spinout-lab" className="text-sm font-semibold text-violet-600 hover:underline">Back to Workspace</Link>
      </div>
    );
  }
  if (!project) {
    return (
      <div className="max-w-xl mx-auto mt-16 text-center" data-testid="uof-no-project">
        <FileText className="w-8 h-8 text-gray-300 dark:text-gray-600 mx-auto mb-3" />
        <h2 className="text-lg font-bold text-gray-900 dark:text-gray-50 mb-1">No startup record yet</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Create your startup in{' '}
          <Link to="/spinout-lab/startup" className="text-violet-600 hover:underline">Startups</Link>{' '}
          first — the allocation is stored on it.
        </p>
      </div>
    );
  }

  const week = num(user?.spinout_lab_week) || state?.week || 4;

  return (
    <div className="max-w-[1200px] mx-auto px-4 py-6 space-y-5" data-testid="page-spinout-uof">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => navigate('/spinout-lab')}
          data-testid="button-back-workspace"
          className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100"
        >
          <ArrowLeft size={14} /> Back to Workspace
        </button>
        <div className="flex items-center gap-2">
          <PieChart size={16} className="text-violet-500" />
          <h1 className="text-[17px] font-extrabold tracking-tight text-gray-900 dark:text-gray-50">Use of Funds</h1>
          <span className="text-[10px] font-bold uppercase tracking-wider rounded-full px-2 py-0.5 bg-emerald-50 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">Active</span>
        </div>
        <span className="ml-auto text-[11px] font-semibold text-gray-400 dark:text-gray-500">Unlocked · Wk {week}</span>
      </div>
      <p className="text-[12.5px] text-gray-500 dark:text-gray-400 -mt-2">
        Define capital allocation across the five deck categories — with what-if runway modeling. Your pitch deck's ASK slide reads this allocation live.
      </p>

      <div className="grid grid-cols-1 lg:grid-cols-[340px_1fr] gap-5 items-start">
        {/* Left column: allocation + runway + thresholds */}
        <div className="space-y-4">
          <div className={CARD} data-testid="card-allocation">
            <div className="flex items-center justify-between mb-2">
              <div className={LBL}>Allocation · {effectiveRaise ? `${fmtRaise(effectiveRaise)} raise` : 'no raise set'}</div>
              {savedAt && !dirty && (
                <span className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400" data-testid="alloc-saved">Saved</span>
              )}
            </div>
            <div className="flex justify-center mb-3">
              <Donut values={values} centerLabel={effectiveRaise ? fmtRaise(effectiveRaise) : '—'} />
            </div>
            {total > 0 && (
              <div className="space-y-1.5 mb-4" data-testid="alloc-legend">
                {FUND_SECTIONS.map((label, i) => (values[i] > 0 ? (
                  <div key={label} className="flex items-center gap-2 text-[12px]">
                    <span className={`w-2.5 h-2.5 rounded-sm ${SECTION_BG[i]} inline-block shrink-0`} />
                    <span className="flex-1 min-w-0 truncate text-gray-700 dark:text-gray-200">{label}</span>
                    {effectiveRaise && (
                      <span className="font-bold text-gray-900 dark:text-gray-50 tabular-nums">{fmtRaise((values[i] / 100) * effectiveRaise)}</span>
                    )}
                    <span className="text-gray-400 tabular-nums w-9 text-right">{values[i]}%</span>
                  </div>
                ) : null))}
              </div>
            )}
            <label className="block mb-3">
              <span className={LBL}>Raise target (USD)</span>
              <input
                type="number" min="0" step="1000" className={INPUT} value={raiseInput}
                onChange={(e) => { setRaiseInput(e.target.value); setDirty(true); setSaveError(''); }}
                placeholder="e.g. 1000000" disabled={!canEdit}
                data-testid="input-raise"
              />
            </label>
            <FundAllocator values={values} total={total} valid={valid} onChange={canEdit ? onSlice : () => {}} />
            {saveError && <div className="text-[11.5px] text-rose-600 dark:text-rose-400 mt-2" data-testid="alloc-error">{saveError}</div>}
            <button
              type="button"
              onClick={save}
              disabled={!canEdit || saving || !valid || !dirty}
              data-testid="button-save-allocation"
              className="w-full mt-3 text-[12px] font-bold text-white bg-violet-600 hover:bg-violet-700 rounded-lg px-3 py-2 disabled:opacity-40 inline-flex items-center justify-center gap-1.5"
            >
              {saving && <Loader2 size={12} className="animate-spin" />} Save allocation
            </button>
            <p className="text-[10.5px] text-gray-400 dark:text-gray-500 mt-2">
              Stored on your startup record — the same fields the deck's ASK slide and scoring memo read.
            </p>
          </div>

          <div className={CARD} data-testid="card-runway">
            <div className="flex items-center gap-1.5 mb-2">
              <div className={LBL}>Runway · what-if</div>
              <span className="text-[9.5px] font-bold uppercase tracking-wider rounded-full px-1.5 py-0.5 bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400" title="Burn rate isn't tracked anywhere yet — this calculator is a planning aid and is not saved.">
                not stored
              </span>
            </div>
            <label className="block mb-3">
              <span className={LBL}>Monthly burn (USD)</span>
              <input
                type="number" min="0" step="1000" className={INPUT} value={burn}
                onChange={(e) => setBurn(e.target.value)} placeholder="e.g. 81000"
                data-testid="input-burn"
              />
            </label>
            {months !== null ? (
              <>
                <div className="flex items-baseline gap-2">
                  <div className={`text-[30px] font-extrabold tabular-nums leading-none ${BAND_STYLES[band].cls}`} data-testid="text-runway-months">
                    {months.toFixed(1)}
                  </div>
                  <div className="text-[12px] font-bold text-gray-500 dark:text-gray-400">months</div>
                </div>
                <div className={`text-[11px] font-semibold mt-1 ${BAND_STYLES[band].cls}`} data-testid="text-runway-band">{BAND_STYLES[band].label}</div>
                <div className="grid grid-cols-3 gap-2 mt-3 text-center">
                  <div>
                    <div className="text-[12px] font-bold text-gray-900 dark:text-gray-50 tabular-nums">{fmtRaise(burnN)}</div>
                    <div className="text-[9.5px] text-gray-400">Monthly burn</div>
                  </div>
                  <div>
                    <div className="text-[12px] font-bold text-gray-900 dark:text-gray-50 truncate">{total > 0 ? FUND_SECTIONS[largestIdx].split(/[:&]/)[0].trim() : '—'}</div>
                    <div className="text-[9.5px] text-gray-400">Largest bucket</div>
                  </div>
                  <div>
                    <div className="text-[12px] font-bold text-gray-900 dark:text-gray-50">{cashOutLabel(months)}</div>
                    <div className="text-[9.5px] text-gray-400">Cash-out</div>
                  </div>
                </div>
                {/* Runway timeline vs thresholds */}
                <div className="mt-3">
                  <div className="relative h-2 rounded-full bg-gray-100 dark:bg-gray-800 overflow-hidden">
                    <div
                      className={`absolute inset-y-0 left-0 rounded-full ${band === 'critical' ? 'bg-rose-500' : band === 'tight' ? 'bg-amber-500' : 'bg-emerald-500'}`}
                      style={{ width: `${Math.min(100, (months / 36) * 100)}%` }}
                    />
                  </div>
                  <div className="flex justify-between text-[9px] text-gray-400 mt-1">
                    <span>0</span><span>12mo</span><span>24mo</span><span>36mo</span>
                  </div>
                </div>
              </>
            ) : (
              <p className="text-[11.5px] text-gray-500 dark:text-gray-400" data-testid="runway-empty">
                {effectiveRaise
                  ? 'Enter your estimated monthly burn to model runway.'
                  : 'Set a raise target and monthly burn to model runway.'}
              </p>
            )}
            <div className="flex items-center gap-2 mt-3 pt-3 border-t border-gray-100 dark:border-gray-800">
              <span className="text-[11px] text-gray-500 dark:text-gray-400">Alert when below</span>
              {[6, 3].map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setThreshold(t)}
                  data-testid={`threshold-${t}`}
                  className={`text-[11px] font-bold rounded-full px-2.5 py-1 ${threshold === t ? 'bg-violet-600 text-white' : 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300'}`}
                >
                  {t} months
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Right column: milestones honesty + scenarios + feeds into */}
        <div className="space-y-4">
          <div className={CARD} data-testid="card-milestone-mapping">
            <div className="flex items-center justify-between mb-2">
              <div className={LBL}>Milestone → capital mapping</div>
              <span className="text-[10px] text-gray-400">from Roadmap</span>
            </div>
            <div className="rounded-xl bg-amber-50 dark:bg-amber-900/20 border border-amber-100 dark:border-amber-900/40 px-3 py-2.5 mb-3" data-testid="mapping-unavailable">
              <p className="text-[11.5px] text-amber-800 dark:text-amber-300">
                Roadmap milestones don't carry cost estimates yet, so per-milestone capital mapping isn't available — there's nothing real to map dollars onto.
              </p>
            </div>
            {milestones.length > 0 && (
              <div className="space-y-1.5" data-testid="mapping-milestones">
                {milestones.map((m) => (
                  <div key={m.key} className="flex items-center gap-2 text-[12px]">
                    <span className={`w-1.5 h-1.5 rounded-full inline-block shrink-0 ${m.completed_at ? 'bg-emerald-500' : 'bg-gray-300 dark:bg-gray-600'}`} />
                    <span className="flex-1 text-gray-700 dark:text-gray-200">{m.key.replace(/_/g, ' ')}</span>
                    <span className="text-[10px] text-gray-400">Wk {m.week}</span>
                    <span className={`text-[10px] font-bold ${m.completed_at ? 'text-emerald-600 dark:text-emerald-400' : 'text-gray-400'}`}>
                      {m.completed_at ? 'done' : 'open'}
                    </span>
                  </div>
                ))}
              </div>
            )}
            <Link to="/spinout-lab/roadmap" className="inline-flex items-center gap-1.5 text-[11.5px] font-semibold text-violet-600 hover:underline mt-3" data-testid="link-roadmap">
              <MapIcon size={12} /> Open Roadmap
            </Link>
          </div>

          <div className={CARD} data-testid="card-scenarios">
            <div className="flex items-center gap-1.5 mb-1">
              <Calculator size={13} className="text-violet-500" />
              <div className={LBL}>Scenario comparison</div>
              <span className="ml-auto text-[10px] text-gray-400">
                {total === 100 ? 'same split across scenarios' : 'set a 100% split to see per-bucket dollars'}
              </span>
            </div>
            <p className="text-[10.5px] text-gray-400 dark:text-gray-500 mb-3">
              What-if only — scenarios are computed in your browser and not saved.
            </p>
            <div className="flex items-center gap-3 mb-4">
              <span className="text-[11px] text-gray-500 dark:text-gray-400 whitespace-nowrap">Custom raise</span>
              <input
                type="range" min={250000} max={3000000} step={50000}
                value={scenarioRaise}
                onChange={(e) => setCustomRaise(Number(e.target.value))}
                className="flex-1 accent-violet-500"
                data-testid="slider-custom-raise"
              />
              <span className="text-[12px] font-extrabold text-violet-700 dark:text-violet-300 tabular-nums w-14 text-right" data-testid="text-custom-raise">{fmtRaise(scenarioRaise)}</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              {[...SCENARIOS, { key: 'custom', name: 'Custom', raise: scenarioRaise }].map((s) => {
                const m = runwayMonths(s.raise, burnN);
                const isCurrent = effectiveRaise && Math.abs(s.raise - effectiveRaise) < 1;
                return (
                  <div
                    key={s.key}
                    className={`rounded-xl border p-3 ${isCurrent ? 'border-violet-400 dark:border-violet-600 ring-1 ring-violet-500/20' : 'border-gray-200 dark:border-gray-700'}`}
                    data-testid={`scenario-${s.key}`}
                  >
                    <div className="text-[11px] font-bold text-gray-500 dark:text-gray-400">{s.name}</div>
                    <div className="text-[15px] font-extrabold text-gray-900 dark:text-gray-50 tabular-nums mb-2">{fmtRaise(s.raise)}</div>
                    <div className="flex justify-between text-[11px]">
                      <span className="text-gray-400">Runway</span>
                      <span className={`font-bold tabular-nums ${m !== null ? 'text-emerald-600 dark:text-emerald-400' : 'text-gray-400'}`}>
                        {m !== null ? `${m.toFixed(1)}mo` : '—'}
                      </span>
                    </div>
                    <div className="flex justify-between text-[11px]">
                      <span className="text-gray-400">Burn/mo</span>
                      <span className="font-bold tabular-nums text-gray-700 dark:text-gray-200">{burnN ? fmtRaise(burnN) : '—'}</span>
                    </div>
                    {total === 100 && (
                      <div className="mt-2 pt-2 border-t border-gray-100 dark:border-gray-800 space-y-0.5">
                        {FUND_SECTIONS.map((label, i) => (values[i] > 0 ? (
                          <div key={label} className="flex justify-between text-[10px]">
                            <span className="text-gray-400 truncate mr-2">{label.split(/[:&]/)[0].trim()}</span>
                            <span className="tabular-nums text-gray-600 dark:text-gray-300">{fmtRaise((values[i] / 100) * s.raise)}</span>
                          </div>
                        ) : null))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            {burnN == null || burnN <= 0 ? (
              <p className="text-[11px] text-gray-400 dark:text-gray-500 mt-3" data-testid="scenarios-need-burn">
                Enter a monthly burn in the runway card to compare runway across raise sizes.
              </p>
            ) : null}
          </div>

          <div className={CARD} data-testid="card-feeds-into">
            <div className={`${LBL} mb-3`}>Feeds into · live</div>
            <div className="space-y-2">
              <Link to="/build/deck" className="flex items-center gap-2 text-[12px] font-semibold text-gray-700 dark:text-gray-200 hover:text-violet-600" data-testid="feeds-deck">
                <Presentation size={13} className="text-violet-500" /> Pitch Deck Builder <span className="text-gray-400 font-normal">· THE ASK slide reads this allocation directly</span>
              </Link>
              <Link to="/spinout-lab/scoring" className="flex items-center gap-2 text-[12px] font-semibold text-gray-700 dark:text-gray-200 hover:text-violet-600" data-testid="feeds-scoring">
                <Gauge size={13} className="text-violet-500" /> Scoring Engine <span className="text-gray-400 font-normal">· memo cites your use of funds</span>
              </Link>
            </div>
            <p className="text-[10.5px] text-gray-400 dark:text-gray-500 mt-3">
              No sync needed — both read the saved fields, so they're current the moment you save.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
