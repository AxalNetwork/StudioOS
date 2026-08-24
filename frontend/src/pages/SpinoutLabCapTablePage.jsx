// Spin-Out Lab — Cap Table (Week 4 tool page).
//
// Design handoff: attached_assets/Cap_Table.dc_*.html (same file ships in the
// StudioOS repo under spin-out-lab-pipeline/project). Mapping to REAL
// surfaces only:
//   - Ledger, SAFEs, option pool, rounds, dilution: the cap-table scenario
//     engine (both runtimes; POST /captable/scenarios upserts the ONE
//     canonical scenario per project, /captable/simulate previews without
//     saving). The engine models founders + pool at founding, keeps SAFEs
//     off-ledger until the first priced round, then converts them — the UI
//     says exactly that instead of faking as-converted percentages.
//   - 83(b) status: the real Section 83(b) trackers (legal/83b/trackers).
//   - Carta: /captable/live is Worker-only and user-scoped; the chip renders
//     only from a real response (hidden in dev). There is no push-to-Carta
//     backend, so no "Push to Carta" button.
//   - Omitted (no backend): vesting schedules/progress bars (vesting terms
//     live only inside the generated Co-founder Agreement — linked instead),
//     accelerator what-if, share/copy-link/investor-preview, pitch-deck
//     export. CSV export is real and kept.
//
// Scenario writes are Growth-tier on the Worker (deliberate monetization
// gate, Task #6) — api.js turns the 402 into the standard upgrade modal, so
// this page does nothing special for it. Dev has no tier gate.

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  PieChart, Loader2, Lock, AlertTriangle, FileText, Plus, X,
  Download, ExternalLink, CheckCircle2, Clock, Eye,
} from 'lucide-react';
import LabPageHeader, { labBtn, LabChip, LAB_ICON_SIZE } from '../components/spinout/LabPageHeader';
import { api, spinoutLab } from '../lib/api';
import { markMilestone } from '../lib/spinoutLabHooks';
import { pickLabProject } from './SpinoutLabStartupPage';

const CARD = 'rounded-2xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 p-5';
const LBL = 'text-[11px] font-bold uppercase tracking-wider text-gray-400 dark:text-gray-500';
const INPUT = 'w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-2.5 py-1.5 text-[12.5px] text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-violet-500/40';

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);
const fmtShares = (v) => (num(v) === null ? '—' : Number(v).toLocaleString());
export const fmtMoney = (v) => {
  const n = num(v);
  if (n === null || n <= 0) return '—';
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(n % 1_000_000 ? 1 : 0)}M`;
  if (n >= 1_000) return `$${Math.round(n / 1_000)}K`;
  return `$${n}`;
};
const fmtPct = (v) => (num(v) === null ? '—' : `${Number(v).toFixed(1)}%`);
const fmtDate = (iso) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
};

const TYPE_META = {
  founder: { label: 'Common', cls: 'text-violet-700 dark:text-violet-300', dot: '#7c3aed', group: 'Founders' },
  option_pool: { label: 'Options', cls: 'text-amber-600 dark:text-amber-400', dot: '#d97706', group: 'Option pool' },
  safe: { label: 'SAFE', cls: 'text-sky-600 dark:text-sky-400', dot: '#0284c7', group: 'Investors / SAFE' },
  preferred: { label: 'Preferred', cls: 'text-emerald-600 dark:text-emerald-400', dot: '#059669', group: 'Investors / SAFE' },
};
const FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'founder', label: 'Founders' },
  { id: 'option_pool', label: 'Pool' },
  { id: 'safe', label: 'SAFEs' },
  { id: 'preferred', label: 'Investors' },
];

const DEFAULT_INPUTS = { founders: [], option_pool_pct: 10, safes: [], rounds: [] };

/** Normalize scenario inputs into a fully-shaped editable object. */
export function normalizeInputs(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  return {
    founders: Array.isArray(src.founders) ? src.founders.map((f) => ({ name: String(f?.name || ''), shares: num(f?.shares) ?? 0 })) : [],
    option_pool_pct: num(src.option_pool_pct) ?? 10,
    safes: Array.isArray(src.safes) ? src.safes.map((s) => ({ name: String(s?.name || ''), amount: num(s?.amount) ?? 0, cap: num(s?.cap), discount: num(s?.discount) })) : [],
    rounds: Array.isArray(src.rounds) ? src.rounds.map((r) => ({ name: String(r?.name || ''), pre_money: num(r?.pre_money) ?? 0, investment: num(r?.investment) ?? 0, post_round_pool_pct: num(r?.post_round_pool_pct) })) : [],
  };
}

/** Group a ledger by TYPE_META.group → [{group, pct, dot}]. */
export function groupLedger(ledger) {
  const acc = {};
  for (const row of ledger || []) {
    const meta = TYPE_META[row.type] || TYPE_META.founder;
    acc[meta.group] = acc[meta.group] || { group: meta.group, pct: 0, shares: 0, dot: meta.dot };
    acc[meta.group].pct += Number(row.pct) || 0;
    acc[meta.group].shares += Number(row.shares) || 0;
  }
  return Object.values(acc);
}

async function downloadCsv(uid, name) {
  const token = localStorage.getItem('token');
  const r = await fetch(`/api/captable/scenarios/${uid}/export.csv`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!r.ok) return false;
  const blob = await r.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `captable-${(name || 'scenario').replace(/[^A-Za-z0-9._-]/g, '_')}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
  return true;
}

export default function SpinoutLabCapTablePage() {
  const [status, setStatus] = useState('loading');
  const [state, setState] = useState(null);
  const [user, setUser] = useState(null);
  const [project, setProject] = useState(null);
  const [scenario, setScenario] = useState(null); // saved canonical scenario (or null)
  const [inputs, setInputs] = useState(DEFAULT_INPUTS); // local editable copy
  const inputsRef = useRef(DEFAULT_INPUTS); // tracks latest edits so a slow save can't clobber them
  const [result, setResult] = useState(null); // displayed engine result
  const [previewing, setPreviewing] = useState(false); // result is an unsaved preview
  const [dirty, setDirty] = useState(false);
  const [trackers, setTrackers] = useState([]);
  const [carta, setCarta] = useState(null); // Worker-only; null when absent
  const [busy, setBusy] = useState(''); // '' | 'preview' | 'save'
  const [error, setError] = useState('');
  const [filter, setFilter] = useState('all');
  const [addModal, setAddModal] = useState(null); // {kind:'founder'|'safe'|'round', form:{}}
  const [investorPreview, setInvestorPreview] = useState(false); // client-side read-only view

  const canEdit = !!(user && project && Number(user.founder_id) === Number(project.founder_id));

  useEffect(() => {
    let dead = false;
    (async () => {
      try {
        const [st, me, projects] = await Promise.all([
          spinoutLab.state().catch(() => null),
          api.getMe(),
          api.listProjects().catch(() => []),
        ]);
        if (dead) return;
        setState(st);
        setUser(me);
        const proj = pickLabProject(projects, me);
        setProject(proj || null);
        if (proj) {
          const [capRes, tRes, liveRes] = await Promise.allSettled([
            api.getCapTableByProject(proj.id),
            api.legal83bList(proj.id),
            api.liveCapTable(), // Worker-only; 404 in dev → chip hidden
          ]);
          if (dead) return;
          const s = capRes.status === 'fulfilled' ? capRes.value?.scenario : null;
          setScenario(s || null);
          const norm = normalizeInputs(s?.inputs);
          inputsRef.current = norm;
          setInputs(norm);
          setResult(s?.result || null);
          setTrackers(tRes.status === 'fulfilled' ? (tRes.value?.trackers || []) : []);
          setCarta(liveRes.status === 'fulfilled' ? liveRes.value : null);
        }
        if (!dead) setStatus('ready');
      } catch (e) {
        console.error('[spinout-captable]', e);
        if (!dead) setStatus('error');
      }
    })();
    return () => { dead = true; };
  }, []);

  const markDirty = (next) => { inputsRef.current = next; setInputs(next); setDirty(true); };

  const runPreview = async () => {
    if (busy) return;
    setBusy('preview');
    setError('');
    try {
      const r = await api.simulateCapTable(inputs); // api.js wraps it as {inputs}
      setResult(r);
      setPreviewing(true);
    } catch (e) {
      console.error('[spinout-captable:preview]', e);
      setError(e?.data?.detail?.errors?.join('; ') || e?.data?.detail || e?.message || 'Preview failed.');
    } finally {
      setBusy('');
    }
  };

  const save = async () => {
    if (busy) return;
    setBusy('save');
    setError('');
    const snapshot = inputsRef.current;
    try {
      const saved = await api.createCapTableScenario({
        name: scenario?.name || `${project.name || 'Startup'} cap table`,
        project_id: project.id,
        inputs: snapshot,
      });
      setScenario(saved);
      setResult(saved.result || null);
      // W4 deliverables — founder stock is real once founders hold shares in
      // the saved scenario; the table is "locked" once a round is modeled.
      if ((snapshot.founders || []).some((f) => (Number(f.shares) || 0) > 0)) {
        markMilestone(user, 'founder_stock_issued');
      }
      if ((snapshot.rounds || []).length > 0) markMilestone(user, 'captable_locked');
      if (inputsRef.current === snapshot) {
        // No edits landed while the request was in flight — adopt the saved copy.
        const norm = normalizeInputs(saved.inputs);
        inputsRef.current = norm;
        setInputs(norm);
        setDirty(false);
        setPreviewing(false);
      }
      // else: the user kept editing during the save; keep their newer inputs
      // and the "unsaved changes" banner so nothing is silently lost.
    } catch (e) {
      console.error('[spinout-captable:save]', e);
      // 402 (Growth tier, prod) opens the global upgrade modal via api.js.
      if (e?.status !== 402) {
        setError(e?.data?.detail?.errors?.join('; ') || e?.data?.detail || e?.message || 'Could not save the cap table.');
      }
    } finally {
      setBusy('');
    }
  };

  // Fully-diluted view: after the last modeled round when rounds exist,
  // otherwise the founding ledger (SAFEs stay off-ledger until a priced round).
  const ledger = useMemo(() => {
    if (!result) return [];
    const rounds = Array.isArray(result.rounds) ? result.rounds : [];
    if (rounds.length) return rounds[rounds.length - 1].ledger || [];
    return Array.isArray(result.founding) ? result.founding : [];
  }, [result]);
  const visibleLedger = filter === 'all' ? ledger : ledger.filter((r) => r.type === filter);
  const composition = useMemo(() => groupLedger(ledger), [ledger]);
  const totalShares = useMemo(() => ledger.reduce((a, r) => a + (Number(r.shares) || 0), 0), [ledger]);
  const poolRow = ledger.find((r) => r.type === 'option_pool');
  const safesTotal = useMemo(() => (inputs.safes || []).reduce((a, s) => a + (Number(s.amount) || 0), 0), [inputs.safes]);
  const blendedCap = useMemo(() => {
    const withCap = (inputs.safes || []).filter((s) => num(s.cap) > 0 && num(s.amount) > 0);
    if (!withCap.length) return null;
    const w = withCap.reduce((a, s) => a + s.amount, 0);
    return w > 0 ? withCap.reduce((a, s) => a + s.cap * s.amount, 0) / w : null;
  }, [inputs.safes]);
  // SAFE conversion % — real only once a priced round is modeled.
  const safeConvPct = useMemo(() => {
    const rounds = Array.isArray(result?.rounds) ? result.rounds : [];
    if (!rounds.length) return {};
    const out = {};
    for (const row of rounds[0].ledger || []) {
      if (row.type === 'safe') out[row.holder] = row.pct;
    }
    return out;
  }, [result]);
  // Next-round founder dilution — real only when a round is modeled.
  const nextRoundDelta = useMemo(() => {
    const rounds = Array.isArray(result?.rounds) ? result.rounds : [];
    if (!rounds.length || !Array.isArray(result?.founding)) return null;
    const before = result.founding.filter((r) => r.type === 'founder').reduce((a, r) => a + r.pct, 0);
    const after = (rounds[0].ledger || []).filter((r) => r.type === 'founder').reduce((a, r) => a + r.pct, 0);
    return { before, after, round: rounds[0].name };
  }, [result]);
  // Dilution table: group pct across Founding + each round.
  const dilutionCols = useMemo(() => {
    if (!result) return [];
    const cols = [];
    if (Array.isArray(result.founding)) cols.push({ name: 'Founding', groups: groupLedger(result.founding) });
    for (const r of result.rounds || []) cols.push({ name: r.name, groups: groupLedger(r.ledger || []) });
    return cols;
  }, [result]);
  const groupNames = ['Founders', 'Option pool', 'Investors / SAFE'];

  const openAdd = (kind) => {
    setAddModal({
      kind,
      form: kind === 'founder' ? { name: '', shares: '' }
        : kind === 'safe' ? { name: '', amount: '', cap: '', discount: '' }
        : { name: '', pre_money: '', investment: '' },
    });
  };
  const submitAdd = () => {
    const { kind, form } = addModal;
    if (kind === 'founder') {
      markDirty({ ...inputs, founders: [...inputs.founders, { name: form.name.trim(), shares: num(form.shares) ?? 0 }] });
    } else if (kind === 'safe') {
      // The engine takes discount as a fraction (0..0.9); the modal collects %.
      const discPct = num(form.discount);
      markDirty({ ...inputs, safes: [...inputs.safes, { name: form.name.trim(), amount: num(form.amount) ?? 0, cap: num(form.cap), discount: discPct ? discPct / 100 : null }] });
    } else {
      markDirty({ ...inputs, rounds: [...inputs.rounds, { name: form.name.trim() || `Round ${inputs.rounds.length + 1}`, pre_money: num(form.pre_money) ?? 0, investment: num(form.investment) ?? 0 }] });
    }
    setAddModal(null);
  };

  if (status === 'loading') {
    return (
      <div className="flex items-center justify-center min-h-[60vh]" data-testid="captable-loading">
        <Loader2 className="w-6 h-6 animate-spin text-violet-500" />
      </div>
    );
  }
  if (status === 'error') {
    return (
      <div className="max-w-xl mx-auto mt-16 text-center" data-testid="captable-error">
        <AlertTriangle className="w-8 h-8 text-amber-400 mx-auto mb-3" />
        <h2 className="text-lg font-bold text-gray-900 dark:text-gray-50 mb-1">Couldn't load the Cap Table</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400">Reload the page to try again.</p>
      </div>
    );
  }
  const isAdmin = user?.role === 'admin';
  if (!state?.active && !isAdmin) {
    return (
      <div className="max-w-xl mx-auto mt-16 text-center" data-testid="captable-inactive">
        <Lock className="w-8 h-8 text-gray-300 dark:text-gray-600 mx-auto mb-3" />
        <h2 className="text-lg font-bold text-gray-900 dark:text-gray-50 mb-1">Spin-Out Lab is not active</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          The Cap Table workspace is part of the Spin-Out Lab program.{' '}
          <Link to="/spinout-lab" className="text-violet-600 hover:underline">Go to the Lab</Link>
        </p>
      </div>
    );
  }
  if (!isAdmin && !(state?.unlocked_features || []).includes('captable')) {
    return (
      <div className="max-w-xl mx-auto mt-16 text-center" data-testid="captable-locked">
        <Lock className="w-8 h-8 text-gray-300 dark:text-gray-600 mx-auto mb-3" />
        <h2 className="text-lg font-bold text-gray-900 dark:text-gray-50 mb-1">Cap Table unlocks in Week 4</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
          Finish your current week's deliverables to unlock the ownership ledger.
        </p>
        <Link to="/spinout-lab" className="text-sm font-semibold text-violet-600 hover:underline">Back to Workspace</Link>
      </div>
    );
  }
  if (!project) {
    return (
      <div className="max-w-xl mx-auto mt-16 text-center" data-testid="captable-no-project">
        <FileText className="w-8 h-8 text-gray-300 dark:text-gray-600 mx-auto mb-3" />
        <h2 className="text-lg font-bold text-gray-900 dark:text-gray-50 mb-1">No startup record yet</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Create your startup in{' '}
          <Link to="/spinout-lab/startup" className="text-violet-600 hover:underline">Startups</Link>{' '}
          first — the cap table belongs to it.
        </p>
      </div>
    );
  }

  const week = num(user?.spinout_lab_week) || state?.week || 4;

  return (
    <div className="max-w-[1200px] mx-auto px-4 py-6 space-y-5" data-testid="page-spinout-captable">
      {/* Header — canonical Lab header. The Carta chip rides in `titleExtra`
          (inert, still only rendered from a real /captable/live response); the
          two A-row actions ride in `actions`, ahead of the week pill. */}
      <LabPageHeader
        icon={PieChart}
        title="Cap Table"
        subtitle="Ownership ledger, SAFEs, option pool, and dilution modeling — computed by the cap-table engine, saved to your startup."
        status="Active"
        titleExtra={carta ? (
          <LabChip tone="muted" data-testid="chip-carta">
            {carta.connected ? `Carta synced ${carta.last_synced_at ? fmtDate(carta.last_synced_at) : ''}` : 'Carta not connected'}
          </LabChip>
        ) : null}
        weekChip={`Unlocked · Wk ${week}`}
        actions={(
          <>
            {/* Design A-row "Preview as investor": pure client-side view over the
                SAME saved scenario result — no backend, nothing fabricated. */}
            {composition.length > 0 && (
              <button
                type="button"
                onClick={() => setInvestorPreview(true)}
                data-testid="button-investor-preview"
                className={labBtn('ghost')}
              >
                <Eye size={LAB_ICON_SIZE} /> Preview as investor
              </button>
            )}
            {scenario && (
              <button
                type="button"
                onClick={() => downloadCsv(scenario.uid, scenario.name)}
                data-testid="button-export-csv"
                className={labBtn('ghost')}
              >
                <Download size={LAB_ICON_SIZE} /> Export CSV
              </button>
            )}
          </>
        )}
      />

      {/* Dirty / preview banner */}
      {(dirty || previewing) && (
        <div className={`${CARD} !p-3 flex flex-wrap items-center gap-3`} data-testid="banner-dirty">
          <Clock size={14} className="text-amber-500 shrink-0" />
          <p className="text-[12px] text-gray-600 dark:text-gray-300 flex-1">
            {previewing ? 'Previewing unsaved changes — nothing is stored until you save.' : 'Unsaved changes pending.'}
          </p>
          <button type="button" onClick={runPreview} disabled={!!busy} data-testid="button-preview" className="text-[11.5px] font-bold text-violet-600 hover:underline disabled:opacity-40">
            {busy === 'preview' ? 'Previewing…' : 'Preview'}
          </button>
          {canEdit && (
            <button type="button" onClick={save} disabled={!!busy} data-testid="button-save" className="text-[11.5px] font-bold text-white bg-violet-600 hover:bg-violet-700 rounded-lg px-3 py-1.5 disabled:opacity-40 inline-flex items-center gap-1.5">
              {busy === 'save' && <Loader2 size={11} className="animate-spin" />} Save cap table
            </button>
          )}
        </div>
      )}
      {error && <div className="text-[12px] text-rose-600 dark:text-rose-400" data-testid="text-error">{String(error)}</div>}

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_300px] gap-5 items-start">
        {/* Left column */}
        <div className="space-y-4">
          {/* Ownership ledger */}
          <div className={CARD} data-testid="card-ledger">
            <div className="flex flex-wrap items-center gap-2 mb-3">
              <div>
                <div className="text-[13.5px] font-bold text-gray-900 dark:text-gray-50">Ownership ledger · fully diluted</div>
                <div className="text-[11px] text-gray-400 dark:text-gray-500">
                  {(result?.rounds || []).length ? `After ${result.rounds[result.rounds.length - 1].name}` : 'At founding — SAFEs convert at the first priced round'}
                </div>
              </div>
              {canEdit && (
                <button type="button" onClick={() => openAdd('founder')} data-testid="button-add-stakeholder" className="ml-auto text-[11.5px] font-bold text-white bg-violet-600 hover:bg-violet-700 rounded-lg px-3 py-1.5 inline-flex items-center gap-1">
                  <Plus size={12} /> Add stakeholder
                </button>
              )}
            </div>
            <div className="flex flex-wrap gap-1 mb-3">
              {FILTERS.map((f) => (
                <button key={f.id} type="button" onClick={() => setFilter(f.id)} data-testid={`filter-${f.id}`}
                  className={`text-[11px] font-semibold rounded-full px-2.5 py-1 ${filter === f.id ? 'bg-gray-900 text-white dark:bg-gray-100 dark:text-gray-900' : 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300'}`}>
                  {f.label}
                </button>
              ))}
            </div>
            {ledger.length === 0 ? (
              <div className="text-center py-8" data-testid="ledger-empty">
                <PieChart className="w-7 h-7 text-gray-300 dark:text-gray-600 mx-auto mb-2" />
                <div className="text-[13px] font-bold text-gray-900 dark:text-gray-50 mb-1">No cap table yet</div>
                <p className="text-[11.5px] text-gray-500 dark:text-gray-400">
                  Add your founders and option pool, then save — the engine computes the ledger.
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead>
                    <tr className={LBL}>
                      <th className="py-1.5 pr-3 font-bold">Stakeholder</th>
                      <th className="py-1.5 pr-3 font-bold">Class</th>
                      <th className="py-1.5 pr-3 font-bold text-right">Shares</th>
                      <th className="py-1.5 font-bold text-right">Fully diluted</th>
                      {canEdit && <th className="py-1.5" />}
                    </tr>
                  </thead>
                  <tbody>
                    {visibleLedger.map((row, i) => {
                      const meta = TYPE_META[row.type] || TYPE_META.founder;
                      const founderIdx = row.type === 'founder' ? inputs.founders.findIndex((f) => f.name === row.holder) : -1;
                      return (
                        <tr key={`${row.holder}-${i}`} className="border-t border-gray-100 dark:border-gray-800" data-testid={`ledger-row-${i}`}>
                          <td className="py-2 pr-3">
                            <div className="flex items-center gap-2">
                              <div className="w-7 h-7 rounded-full bg-violet-100 dark:bg-violet-900/40 text-violet-700 dark:text-violet-300 flex items-center justify-center text-[10px] font-extrabold shrink-0">
                                {String(row.holder || '?').slice(0, 2).toUpperCase()}
                              </div>
                              <span className="text-[12.5px] font-semibold text-gray-900 dark:text-gray-50">{row.holder}</span>
                            </div>
                          </td>
                          <td className={`py-2 pr-3 text-[11.5px] font-bold ${meta.cls}`}>{meta.label}</td>
                          <td className="py-2 pr-3 text-[12px] text-gray-700 dark:text-gray-200 text-right tabular-nums">{fmtShares(row.shares)}</td>
                          <td className="py-2 text-[12px] font-bold text-gray-900 dark:text-gray-50 text-right tabular-nums">{fmtPct(row.pct)}</td>
                          {canEdit && (
                            <td className="py-2 pl-2 text-right">
                              {founderIdx >= 0 && (
                                <button type="button" data-testid={`button-remove-founder-${founderIdx}`}
                                  onClick={() => markDirty({ ...inputs, founders: inputs.founders.filter((_, fi) => fi !== founderIdx) })}
                                  className="text-gray-300 hover:text-rose-500" aria-label={`Remove ${row.holder}`}>
                                  <X size={13} />
                                </button>
                              )}
                            </td>
                          )}
                        </tr>
                      );
                    })}
                    {filter === 'all' && (
                      <tr className="border-t-2 border-gray-200 dark:border-gray-700">
                        <td className="py-2 pr-3 text-[12px] font-bold text-gray-900 dark:text-gray-50">Fully diluted total</td>
                        <td />
                        <td className="py-2 pr-3 text-[12px] font-bold text-right tabular-nums text-gray-900 dark:text-gray-50" data-testid="text-fd-total">{fmtShares(totalShares)}</td>
                        <td className="py-2 text-[12px] font-bold text-right tabular-nums text-gray-900 dark:text-gray-50">100.0%</td>
                        {canEdit && <td />}
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Founder stock & 83(b) */}
          <div className={CARD} data-testid="card-founders">
            <div className="text-[13.5px] font-bold text-gray-900 dark:text-gray-50 mb-1">Founder stock & 83(b)</div>
            <p className="text-[10.5px] text-gray-400 dark:text-gray-500 mb-3">
              Vesting schedules aren't tracked here — they're set in your{' '}
              <Link to="/spinout-lab/cofounder-agreement" className="text-violet-600 hover:underline">Co-founder Agreement</Link>.
              83(b) status comes from the real filing trackers.
            </p>
            {inputs.founders.length === 0 ? (
              <p className="text-[11.5px] text-gray-500 dark:text-gray-400" data-testid="founders-empty">No founders on the cap table yet.</p>
            ) : (
              <div className="space-y-2.5">
                {inputs.founders.map((f, i) => {
                  const row = ledger.find((l) => l.type === 'founder' && l.holder === f.name);
                  const tracker = trackers.find((t) => (t.taxpayer_name || '').toLowerCase() === (f.name || '').toLowerCase());
                  return (
                    <div key={`${f.name}-${i}`} className="flex flex-wrap items-center gap-2 rounded-xl border border-gray-100 dark:border-gray-800 px-3 py-2.5" data-testid={`founder-${i}`}>
                      <div className="w-8 h-8 rounded-full bg-violet-100 dark:bg-violet-900/40 text-violet-700 dark:text-violet-300 flex items-center justify-center text-[11px] font-extrabold shrink-0">
                        {String(f.name || '?').slice(0, 2).toUpperCase()}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="text-[12.5px] font-bold text-gray-900 dark:text-gray-50 truncate">{f.name || '—'}</div>
                        <div className="text-[10.5px] text-gray-400">{fmtShares(f.shares)} shares{row ? ` · ${fmtPct(row.pct)} FD` : ''}</div>
                      </div>
                      {tracker ? (
                        tracker.mailed_at || tracker.status === 'mailed' || tracker.status === 'confirmed' ? (
                          <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider rounded-full px-2 py-0.5 bg-emerald-50 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300" data-testid={`badge-83b-${i}`}>
                            <CheckCircle2 size={10} /> 83(b) filed
                          </span>
                        ) : (
                          <span className={`text-[10px] font-bold uppercase tracking-wider rounded-full px-2 py-0.5 ${tracker.overdue ? 'bg-rose-50 text-rose-600 dark:bg-rose-900/30 dark:text-rose-300' : 'bg-amber-50 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300'}`} data-testid={`badge-83b-${i}`}>
                            {tracker.overdue ? '83(b) overdue' : `83(b) due · ${tracker.days_left}d left`}
                          </span>
                        )
                      ) : (
                        <span className="text-[10px] font-bold uppercase tracking-wider rounded-full px-2 py-0.5 bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400" data-testid={`badge-83b-${i}`}>
                          No 83(b) tracker
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* SAFE / note tracker */}
          <div className={CARD} data-testid="card-safes">
            <div className="flex items-center justify-between mb-1">
              <div className="text-[13.5px] font-bold text-gray-900 dark:text-gray-50">SAFE / note tracker</div>
              {canEdit && (
                <button type="button" onClick={() => openAdd('safe')} data-testid="button-add-safe" className="text-[11.5px] font-bold text-violet-600 hover:underline inline-flex items-center gap-1">
                  <Plus size={11} /> Add SAFE
                </button>
              )}
            </div>
            <p className="text-[10.5px] text-gray-400 dark:text-gray-500 mb-3">
              {(result?.rounds || []).length ? `Converted at ${result.rounds[0].name}.` : 'Conversion % appears once a priced round is modeled below.'}
            </p>
            {inputs.safes.length === 0 ? (
              <p className="text-[11.5px] text-gray-500 dark:text-gray-400" data-testid="safes-empty">No SAFEs or notes recorded.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead>
                    <tr className={LBL}>
                      <th className="py-1.5 pr-3 font-bold">Investor</th>
                      <th className="py-1.5 pr-3 font-bold text-right">Amount</th>
                      <th className="py-1.5 pr-3 font-bold text-right">Cap</th>
                      <th className="py-1.5 pr-3 font-bold text-right">Disc.</th>
                      <th className="py-1.5 font-bold text-right">→ %</th>
                      {canEdit && <th className="py-1.5" />}
                    </tr>
                  </thead>
                  <tbody>
                    {inputs.safes.map((s, i) => (
                      <tr key={`${s.name}-${i}`} className="border-t border-gray-100 dark:border-gray-800" data-testid={`safe-row-${i}`}>
                        <td className="py-2 pr-3 text-[12.5px] font-semibold text-gray-900 dark:text-gray-50">{s.name || '—'}</td>
                        <td className="py-2 pr-3 text-[12px] text-right tabular-nums text-gray-700 dark:text-gray-200">{fmtMoney(s.amount)}</td>
                        <td className="py-2 pr-3 text-[12px] text-right tabular-nums text-gray-700 dark:text-gray-200">{fmtMoney(s.cap)}</td>
                        <td className="py-2 pr-3 text-[12px] text-right tabular-nums text-gray-700 dark:text-gray-200">{num(s.discount) ? `${Math.round(s.discount * 100)}%` : '—'}</td>
                        <td className="py-2 text-[12px] font-bold text-right tabular-nums text-gray-900 dark:text-gray-50">
                          {safeConvPct[s.name] !== undefined ? fmtPct(safeConvPct[s.name]) : '—'}
                        </td>
                        {canEdit && (
                          <td className="py-2 pl-2 text-right">
                            <button type="button" data-testid={`button-remove-safe-${i}`}
                              onClick={() => markDirty({ ...inputs, safes: inputs.safes.filter((_, si) => si !== i) })}
                              className="text-gray-300 hover:text-rose-500" aria-label={`Remove ${s.name}`}>
                              <X size={13} />
                            </button>
                          </td>
                        )}
                      </tr>
                    ))}
                    <tr className="border-t-2 border-gray-200 dark:border-gray-700">
                      <td className="py-2 pr-3 text-[11.5px] font-bold text-gray-900 dark:text-gray-50">Total outstanding <span className="font-normal text-gray-400">{fmtMoney(safesTotal)}</span></td>
                      <td colSpan={canEdit ? 5 : 4} className="py-2 text-[11.5px] text-right text-gray-400">
                        {blendedCap ? <>Blended avg cap <span className="font-bold text-gray-900 dark:text-gray-50">{fmtMoney(blendedCap)}</span> <span className="text-[10px]">(weighted by amount)</span></> : null}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Dilution simulator */}
          <div className={CARD} data-testid="card-dilution">
            <div className="flex items-center justify-between mb-1">
              <div>
                <div className="text-[13.5px] font-bold text-gray-900 dark:text-gray-50">Dilution simulator</div>
                <div className="text-[11px] text-gray-400 dark:text-gray-500">Ownership across modeled rounds — computed by the engine</div>
              </div>
              {canEdit && (
                <button type="button" onClick={() => openAdd('round')} data-testid="button-add-round" className="text-[11.5px] font-bold text-violet-600 hover:underline inline-flex items-center gap-1">
                  <Plus size={11} /> Model a round
                </button>
              )}
            </div>
            {inputs.rounds.length > 0 && (
              <div className="flex flex-wrap gap-1.5 my-2">
                {inputs.rounds.map((r, i) => (
                  <span key={`${r.name}-${i}`} className="inline-flex items-center gap-1 text-[11px] font-semibold rounded-full px-2.5 py-1 bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300" data-testid={`round-chip-${i}`}>
                    {r.name} · {fmtMoney(r.investment)} @ {fmtMoney(r.pre_money)} pre
                    {canEdit && (
                      <button type="button" data-testid={`button-remove-round-${i}`}
                        onClick={() => markDirty({ ...inputs, rounds: inputs.rounds.filter((_, ri) => ri !== i) })}
                        className="text-gray-400 hover:text-rose-500" aria-label={`Remove ${r.name}`}>
                        <X size={11} />
                      </button>
                    )}
                  </span>
                ))}
              </div>
            )}
            {dilutionCols.length <= 1 && inputs.rounds.length === 0 ? (
              <p className="text-[11.5px] text-gray-500 dark:text-gray-400 mt-2" data-testid="dilution-empty">
                No rounds modeled yet — add a priced round to see how ownership shifts and when your SAFEs convert.
              </p>
            ) : (
              <div className="overflow-x-auto mt-2">
                <table className="w-full text-left">
                  <thead>
                    <tr className={LBL}>
                      <th className="py-1.5 pr-3 font-bold">Stakeholder</th>
                      {dilutionCols.map((c) => <th key={c.name} className="py-1.5 pr-3 font-bold text-right">{c.name}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {groupNames.map((g) => (
                      <tr key={g} className="border-t border-gray-100 dark:border-gray-800" data-testid={`dilution-row-${g.replace(/[^a-z]/gi, '')}`}>
                        <td className="py-2 pr-3 text-[12px] font-semibold text-gray-900 dark:text-gray-50">{g}</td>
                        {dilutionCols.map((c) => {
                          const grp = c.groups.find((x) => x.group === g);
                          return <td key={c.name} className="py-2 pr-3 text-[12px] text-right tabular-nums text-gray-700 dark:text-gray-200">{grp ? fmtPct(grp.pct) : '0.0%'}</td>;
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="text-[10.5px] text-gray-400 dark:text-gray-500 mt-3">
              Exit waterfalls, saved variants, and scenario comparison live in{' '}
              <Link to="/build/captable" className="text-violet-600 hover:underline inline-flex items-center gap-0.5">advanced modeling <ExternalLink size={9} /></Link>.
            </p>
          </div>
        </div>

        {/* Right rail */}
        <div className="space-y-4">
          <div className={CARD} data-testid="card-composition">
            <div className={`${LBL} mb-3`}>Fully diluted</div>
            {composition.length === 0 ? (
              <p className="text-[11.5px] text-gray-500 dark:text-gray-400">
                Nothing on the ledger yet. Enter equity manually — no Carta connection needed.
              </p>
            ) : (
              <>
                <div className="flex h-3 rounded-full overflow-hidden mb-3" data-testid="composition-bar">
                  {composition.map((c) => (
                    <div key={c.group} style={{ width: `${Math.max(1, c.pct)}%`, background: c.dot }} title={`${c.group} ${fmtPct(c.pct)}`} />
                  ))}
                </div>
                <div className="space-y-1.5">
                  {composition.map((c) => (
                    <div key={c.group} className="flex items-center gap-2 text-[11.5px]">
                      <span className="w-2 h-2 rounded-full shrink-0" style={{ background: c.dot }} />
                      <span className="text-gray-600 dark:text-gray-300 flex-1">{c.group}</span>
                      <span className="font-bold tabular-nums text-gray-900 dark:text-gray-50">{fmtPct(c.pct)}</span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>

          <div className={CARD} data-testid="card-stats">
            <div className="space-y-3">
              <div>
                <div className={LBL}>Fully-diluted shares</div>
                <div className="text-[15px] font-extrabold tabular-nums text-gray-900 dark:text-gray-50" data-testid="stat-fd-shares">{fmtShares(totalShares)}</div>
                <div className="text-[10px] text-gray-400">{(result?.rounds || []).length ? 'incl. converted SAFEs' : 'common + pool — SAFEs convert at the next priced round'}</div>
              </div>
              <div>
                <div className={LBL}>Option pool</div>
                <div className="text-[15px] font-extrabold tabular-nums text-amber-600 dark:text-amber-400" data-testid="stat-pool">
                  {poolRow ? `${fmtShares(poolRow.shares)} · ${fmtPct(poolRow.pct)}` : '—'}
                </div>
                <div className="text-[10px] text-gray-400">individual grants aren't tracked here</div>
              </div>
              <div>
                <div className={LBL}>Outstanding SAFEs</div>
                <div className="text-[15px] font-extrabold tabular-nums text-sky-600 dark:text-sky-400" data-testid="stat-safes">
                  {inputs.safes.length ? `${fmtMoney(safesTotal)} · ${inputs.safes.length} instrument${inputs.safes.length === 1 ? '' : 's'}` : 'None'}
                </div>
              </div>
              <div>
                <div className={LBL}>Next-round dilution</div>
                {nextRoundDelta ? (
                  <>
                    <div className="text-[15px] font-extrabold tabular-nums text-rose-600 dark:text-rose-400" data-testid="stat-dilution">
                      {`${(nextRoundDelta.after - nextRoundDelta.before).toFixed(1)}pt`}
                    </div>
                    <div className="text-[10px] text-gray-400">founders {fmtPct(nextRoundDelta.before)} → {fmtPct(nextRoundDelta.after)} at {nextRoundDelta.round}</div>
                  </>
                ) : (
                  <div className="text-[11px] text-gray-400" data-testid="stat-dilution">model a round to see it</div>
                )}
              </div>
            </div>
          </div>

          {/* Option pool builder */}
          <div className={CARD} data-testid="card-pool">
            <div className={`${LBL} mb-2`}>Option pool</div>
            <div className="flex items-center gap-2">
              <input
                type="number" min="0" max="50" step="1"
                value={inputs.option_pool_pct}
                disabled={!canEdit}
                onChange={(e) => markDirty({ ...inputs, option_pool_pct: num(e.target.value) ?? 0 })}
                data-testid="input-pool-pct"
                className={`${INPUT} !w-20 text-right`}
              />
              <span className="text-[12px] text-gray-500 dark:text-gray-400">% at founding</span>
            </div>
            <p className="text-[10.5px] text-gray-400 dark:text-gray-500 mt-2">
              10–15% is the investor-normal range. Changing it re-computes founder dilution when you preview or save.
            </p>
          </div>
        </div>
      </div>

      {/* Add modal */}
      {addModal && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={() => setAddModal(null)}>
          <div className={`${CARD} w-full max-w-md`} onClick={(e) => e.stopPropagation()} data-testid={`modal-add-${addModal.kind}`}>
            <div className="flex items-center justify-between mb-1">
              <div className="text-[13.5px] font-bold text-gray-900 dark:text-gray-50">
                {addModal.kind === 'founder' ? 'Add stakeholder' : addModal.kind === 'safe' ? 'Add a SAFE / note' : 'Model a priced round'}
              </div>
              <button type="button" onClick={() => setAddModal(null)} data-testid="button-close-modal" className="text-gray-400 hover:text-gray-700 dark:hover:text-gray-200">
                <X size={16} />
              </button>
            </div>
            <p className="text-[10.5px] text-gray-400 dark:text-gray-500 mb-3">
              {addModal.kind === 'founder'
                ? 'Enter equity manually — founders and advisors hold common shares; the pool is set separately.'
                : addModal.kind === 'safe'
                ? 'Stays off-ledger until a priced round converts it.'
                : 'The engine converts SAFEs and recomputes ownership at this round.'}
            </p>
            <div className="space-y-3">
              <label className="block">
                <span className={LBL}>Name</span>
                <input type="text" maxLength={200} className={INPUT} value={addModal.form.name}
                  onChange={(e) => setAddModal({ ...addModal, form: { ...addModal.form, name: e.target.value } })}
                  placeholder={addModal.kind === 'round' ? 'e.g. Seed' : addModal.kind === 'safe' ? 'e.g. Fathom Seed' : 'e.g. Maya R.'}
                  data-testid="input-add-name" />
              </label>
              {addModal.kind === 'founder' && (
                <label className="block">
                  <span className={LBL}>Shares</span>
                  <input type="number" min="1" step="1000" className={INPUT} value={addModal.form.shares}
                    onChange={(e) => setAddModal({ ...addModal, form: { ...addModal.form, shares: e.target.value } })}
                    placeholder="4000000" data-testid="input-add-shares" />
                </label>
              )}
              {addModal.kind === 'safe' && (
                <div className="grid grid-cols-3 gap-3">
                  <label className="block">
                    <span className={LBL}>Amount</span>
                    <input type="number" min="0" step="1000" className={INPUT} value={addModal.form.amount}
                      onChange={(e) => setAddModal({ ...addModal, form: { ...addModal.form, amount: e.target.value } })}
                      placeholder="500000" data-testid="input-add-amount" />
                  </label>
                  <label className="block">
                    <span className={LBL}>Cap</span>
                    <input type="number" min="0" step="100000" className={INPUT} value={addModal.form.cap}
                      onChange={(e) => setAddModal({ ...addModal, form: { ...addModal.form, cap: e.target.value } })}
                      placeholder="8000000" data-testid="input-add-cap" />
                  </label>
                  <label className="block">
                    <span className={LBL}>Disc. %</span>
                    <input type="number" min="0" max="100" step="1" className={INPUT} value={addModal.form.discount}
                      onChange={(e) => setAddModal({ ...addModal, form: { ...addModal.form, discount: e.target.value } })}
                      placeholder="20" data-testid="input-add-discount" />
                  </label>
                </div>
              )}
              {addModal.kind === 'round' && (
                <div className="grid grid-cols-2 gap-3">
                  <label className="block">
                    <span className={LBL}>Pre-money</span>
                    <input type="number" min="0" step="100000" className={INPUT} value={addModal.form.pre_money}
                      onChange={(e) => setAddModal({ ...addModal, form: { ...addModal.form, pre_money: e.target.value } })}
                      placeholder="8000000" data-testid="input-add-premoney" />
                  </label>
                  <label className="block">
                    <span className={LBL}>Investment</span>
                    <input type="number" min="0" step="100000" className={INPUT} value={addModal.form.investment}
                      onChange={(e) => setAddModal({ ...addModal, form: { ...addModal.form, investment: e.target.value } })}
                      placeholder="2000000" data-testid="input-add-investment" />
                  </label>
                </div>
              )}
              <button
                type="button"
                onClick={submitAdd}
                disabled={
                  addModal.kind === 'founder' ? (!addModal.form.name.trim() || !(num(addModal.form.shares) > 0))
                  : addModal.kind === 'safe' ? (!addModal.form.name.trim() || !(num(addModal.form.amount) > 0))
                  : !(num(addModal.form.pre_money) > 0 && num(addModal.form.investment) > 0)
                }
                data-testid="button-submit-add"
                className="w-full text-[12px] font-bold text-white bg-violet-600 hover:bg-violet-700 rounded-lg px-3 py-2 disabled:opacity-40"
              >
                {addModal.kind === 'founder' ? 'Add to cap table' : addModal.kind === 'safe' ? 'Add SAFE' : 'Add round'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Investor preview — the design's "Investor preview · Cap Table &
          Ownership slide" as a read-only dark modal over the SAME saved
          composition/ledger the page already renders. Same client-side
          pattern as the Use of Funds investor preview: no backend, no
          fabricated values, closes on scrim click. */}
      {investorPreview && composition.length > 0 && (
        <div
          className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4"
          onClick={() => setInvestorPreview(false)}
          data-testid="modal-investor-preview"
        >
          <div className="w-full max-w-2xl rounded-2xl bg-gray-950 border border-gray-800 p-6 text-gray-100" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <div>
                <div className="text-[10px] font-bold uppercase tracking-widest text-violet-400">Investor preview · Cap Table &amp; Ownership</div>
                <h3 className="text-lg font-extrabold">{project?.name || 'Your company'} — fully diluted</h3>
              </div>
              <button type="button" onClick={() => setInvestorPreview(false)} data-testid="button-close-investor-preview" className="text-gray-400 hover:text-white"><X size={18} /></button>
            </div>
            <div className="flex h-3 rounded-full overflow-hidden mb-4">
              {composition.map((c) => (
                <div key={c.group} style={{ width: `${Math.max(1, c.pct)}%`, background: c.dot }} title={`${c.group} ${fmtPct(c.pct)}`} />
              ))}
            </div>
            <div className="space-y-2 mb-4">
              {composition.map((c) => (
                <div key={c.group} className="flex items-center gap-2.5 text-[12.5px]">
                  <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: c.dot }} />
                  <span className="text-gray-300 flex-1">{c.group}</span>
                  <span className="font-bold tabular-nums">{fmtPct(c.pct)}</span>
                </div>
              ))}
            </div>
            {safesTotal > 0 && (
              <p className="text-[11.5px] text-gray-400 mb-2" data-testid="preview-safes-note">
                {fmtMoney(safesTotal)} in SAFEs outstanding — off-ledger until the first priced round, exactly as the engine models them.
              </p>
            )}
            <p className="text-[10.5px] text-gray-500">
              Rendered from your saved cap-table scenario — the same numbers as the ledger above, nothing restated.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
