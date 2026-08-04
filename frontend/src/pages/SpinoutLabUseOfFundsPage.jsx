// Spin-Out Lab — Use of Funds (Week 4 tool page).
//
// Rebuilt to the Claude Design handoff (attached_assets/Use_of_Funds.dc_*.html)
// on REAL persisted data:
//   - Allocation: 3 buckets (Engineering / GTM / Operations) mapped onto the
//     canonical FUND_SECTIONS labels stored in `projects.use_of_funds` —
//     Engineering → 'Product & engineering', GTM → 'GTM: sales and marketing',
//     Operations → 'Operations, legal & compliance'. On load, legacy 5-slot
//     allocations collapse deterministically (Infrastructure→Engineering,
//     Hiring/runway→Operations). The deck ASK slide + scoring read the same
//     stored fields live.
//   - Raise: `projects.funding_needed`.
//   - Planning metadata (`projects.use_of_funds_meta`, JSON — Worker D1
//     migration 158 / dev ensure): alert threshold, per-milestone cost/bucket
//     mapping, deck/Axal sync timestamps.
//   - Milestones: real Roadmap OKRs (GET /progress/roadmap/:projectId); costs
//     live in meta because OKRs carry no cost field.
//   - Burn model (from the design): burn = eng%·$700 + gtm%·$1,200 + ops%·$450
//     per month — an allocation-intensity model, not a stored burn field.
//
// Persistence pattern: debounced autosave of allocation + raise + meta via the
// real project update route; "Sync to deck" / "Axal export" stamp timestamps
// in meta. Any allocation/raise change marks the deck sync stale.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  ArrowLeft, DollarSign, Loader2, Lock, AlertTriangle, FileText,
  Presentation, Map as MapIcon, Calculator, Share2, Download, Link2, Eye,
  Check, ChevronDown, X, RefreshCw,
} from 'lucide-react';
import { api, spinoutLab } from '../lib/api';
import { markMilestone } from '../lib/spinoutLabHooks';
import { pickLabProject } from './SpinoutLabStartupPage';
import { FUND_SECTIONS } from '../components/FundAllocator';

const CARD = 'rounded-2xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 p-5';
const LBL = 'text-[11px] font-bold uppercase tracking-wider text-gray-400 dark:text-gray-500';

// ---------------------------------------------------------------------------
// Bucket model (design: 3 segments)
// ---------------------------------------------------------------------------

export const BUCKETS = [
  { key: 'eng', name: 'Engineering', color: '#4f46e5', intensity: 700, section: 'Product & engineering' },
  { key: 'gtm', name: 'GTM', color: '#0891b2', intensity: 1200, section: 'GTM: sales and marketing' },
  { key: 'ops', name: 'Operations', color: '#7c3aed', intensity: 450, section: 'Operations, legal & compliance' },
];

// Collapse a stored use_of_funds value into [eng, gtm, ops] percentages.
export function allocToBuckets(raw) {
  const out = [0, 0, 0];
  const s = (raw ?? '').toString().trim();
  if (!s.startsWith('[')) return out;
  try {
    const arr = JSON.parse(s);
    if (!Array.isArray(arr)) return out;
    for (const x of arr) {
      const label = String(x?.label ?? '').trim();
      const pct = Math.max(0, Math.min(100, Math.round(Number(x?.pct) || 0)));
      if (label === FUND_SECTIONS[0] || label === FUND_SECTIONS[2]) out[0] += pct; // product + infra → eng
      else if (label === FUND_SECTIONS[1]) out[1] += pct; // gtm
      else if (label === FUND_SECTIONS[3] || label === FUND_SECTIONS[4]) out[2] += pct; // ops + hiring → ops
    }
  } catch { /* legacy free-text → zeros */ }
  return out;
}

export function bucketsToUseOfFunds(pcts) {
  const alloc = BUCKETS
    .map((b, i) => ({ label: b.section, pct: Math.round(Number(pcts[i]) || 0) }))
    .filter((x) => x.pct > 0);
  return alloc.length ? JSON.stringify(alloc) : '';
}

// Rebalance the other two buckets proportionally so the total stays 100.
export function rebalance(pcts, idx, value) {
  const MIN = 3;
  const v = Math.max(MIN, Math.min(100 - 2 * MIN, Math.round(value)));
  const others = [0, 1, 2].filter((i) => i !== idx);
  const rest = 100 - v;
  const otherSum = pcts[others[0]] + pcts[others[1]];
  let a;
  if (otherSum <= 0) a = Math.round(rest / 2);
  else a = Math.round((pcts[others[0]] / otherSum) * rest);
  a = Math.max(MIN, Math.min(rest - MIN, a));
  const next = [...pcts];
  next[idx] = v;
  next[others[0]] = a;
  next[others[1]] = rest - a;
  return next;
}

// Force a near-100 bucket split to EXACTLY 100 (server validation requires
// it): clamp to the 3% minimum, then absorb the rounding remainder into the
// largest bucket. Returns null when the input isn't a usable allocation.
export function normalizeBuckets(pcts) {
  const total = pcts[0] + pcts[1] + pcts[2];
  if (total < 95 || total > 105) return null;
  const MIN = 3;
  const next = pcts.map((p) => Math.max(MIN, Math.round(p)));
  let diff = 100 - (next[0] + next[1] + next[2]);
  // Absorb the remainder into the largest bucket (it can always take ±5
  // without violating the minimum given the 95–105 input band).
  const largest = next.reduce((b, p, i) => (p > next[b] ? i : b), 0);
  next[largest] += diff;
  if (next[largest] < MIN) return null;
  return next;
}

// Design burn model: $ / month per allocation point.
export function modelBurn(pcts) {
  return Math.round(pcts[0] * BUCKETS[0].intensity + pcts[1] * BUCKETS[1].intensity + pcts[2] * BUCKETS[2].intensity);
}

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);

export function fmtMoney(v) {
  const n = num(v);
  if (n === null || n <= 0) return '—';
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(n % 1_000_000 ? 1 : 0)}M`;
  if (n >= 1_000) return `$${Math.round(n / 1_000)}K`;
  return `$${Math.round(n)}`;
}

export function runwayMonths(raise, burn) {
  const r = num(raise); const b = num(burn);
  if (!r || !b || r <= 0 || b <= 0) return null;
  return r / b;
}

function cashOutLabel(months) {
  if (months === null) return '—';
  const d = new Date();
  d.setMonth(d.getMonth() + Math.floor(months));
  return d.toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
}

function agoLabel(iso) {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return null;
  const s = Math.max(0, Math.floor((Date.now() - t) / 1000));
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

// Default a Roadmap milestone into a bucket by keyword.
export function guessBucket(objective) {
  const s = (objective || '').toLowerCase();
  if (/(sell|sale|market|launch|customer|revenue|pipeline|outreach|brand|growth|demo day|pilot|deal)/.test(s)) return 'gtm';
  if (/(hire|legal|ops|operat|incorporat|compliance|finance|admin|payroll)/.test(s)) return 'ops';
  return 'eng';
}

// ---------------------------------------------------------------------------
// Interactive donut with draggable boundary handles
// ---------------------------------------------------------------------------

function Donut({ pcts, centerLabel, onChange, editable, size = 200 }) {
  const svgRef = useRef(null);
  const dragRef = useRef(null); // boundary index being dragged
  const R = 42; const C = 2 * Math.PI * R;

  // Boundaries (fractions 0..1): b0 = end of eng, b1 = end of gtm.
  const f = pcts.map((p) => p / 100);
  const bounds = [f[0], f[0] + f[1]]; // third boundary fixed at 12 o'clock

  const angleToFrac = (e) => {
    const rect = svgRef.current.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const ang = Math.atan2(e.clientY - cy, e.clientX - cx); // -π..π, 0 = 3 o'clock
    let frac = (ang + Math.PI / 2) / (2 * Math.PI); // 0 at 12 o'clock, clockwise
    if (frac < 0) frac += 1;
    return frac;
  };

  const applyDrag = useCallback((boundary, frac) => {
    const MIN = 0.03;
    let b0 = bounds[0]; let b1 = bounds[1];
    if (boundary === 0) b0 = Math.max(MIN, Math.min(b1 - MIN, frac));
    else b1 = Math.max(b0 + MIN, Math.min(1 - MIN, frac));
    const eng = Math.round(b0 * 100);
    const gtm = Math.round((b1 - b0) * 100);
    const ops = 100 - eng - gtm;
    if (eng >= 3 && gtm >= 3 && ops >= 3) onChange([eng, gtm, ops]);
  }, [bounds, onChange]);

  useEffect(() => {
    if (!editable) return undefined;
    const move = (e) => { if (dragRef.current !== null) { e.preventDefault(); applyDrag(dragRef.current, angleToFrac(e.touches ? e.touches[0] : e)); } };
    const up = () => { dragRef.current = null; };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    return () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
  }, [editable, applyDrag]);

  let offset = 0;
  const handles = [bounds[0], bounds[1]].map((b, i) => {
    const ang = b * 2 * Math.PI - Math.PI / 2;
    return { i, x: 60 + R * Math.cos(ang), y: 60 + R * Math.sin(ang) };
  });

  return (
    <svg
      ref={svgRef} viewBox="0 0 120 120" style={{ width: size, height: size, touchAction: 'none' }}
      role="img" aria-label="Allocation donut" data-testid="uof-donut"
    >
      <circle cx="60" cy="60" r={R} fill="none" stroke="currentColor" className="text-gray-100 dark:text-gray-800" strokeWidth="14" />
      {pcts.map((p, i) => {
        if (!p) return null;
        const dash = (p / 100) * C;
        const el = (
          <circle
            key={BUCKETS[i].key} cx="60" cy="60" r={R} fill="none"
            stroke={BUCKETS[i].color} strokeWidth="14"
            strokeDasharray={`${dash} ${C - dash}`} strokeDashoffset={-offset}
            transform="rotate(-90 60 60)" strokeLinecap="butt"
          />
        );
        offset += dash;
        return el;
      })}
      <text x="60" y="56" textAnchor="middle" className="fill-gray-400" style={{ fontSize: 8 }}>Deploys</text>
      <text x="60" y="70" textAnchor="middle" className="fill-gray-900 dark:fill-gray-100" style={{ fontSize: 13, fontWeight: 800, fontFamily: 'ui-monospace, monospace' }}>{centerLabel}</text>
      {editable && handles.map((h) => (
        <g key={h.i}>
          <circle
            cx={h.x} cy={h.y} r="7" fill="transparent" style={{ cursor: 'grab' }}
            onPointerDown={(e) => { e.preventDefault(); dragRef.current = h.i; }}
            data-testid={`donut-handle-${h.i}`}
          />
          <circle cx={h.x} cy={h.y} r="4" fill="white" stroke="#6b7280" strokeWidth="1.5" pointerEvents="none" className="dark:stroke-gray-400" />
        </g>
      ))}
    </svg>
  );
}

const SCENARIOS = [
  { key: 'preseed', name: 'Pre-seed', raise: 500_000 },
  { key: 'seed', name: 'Seed', raise: 1_000_000 },
  { key: 'growth', name: 'Growth', raise: 2_000_000 },
];

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function SpinoutLabUseOfFundsPage() {
  const navigate = useNavigate();
  const [status, setStatus] = useState('loading');
  const [state, setState] = useState(null);
  const [user, setUser] = useState(null);
  const [project, setProject] = useState(null);
  const [okrs, setOkrs] = useState([]);

  const [pcts, setPcts] = useState([40, 35, 25]);
  const [raise, setRaise] = useState(1_000_000);
  const [meta, setMeta] = useState({});
  const [hasAlloc, setHasAlloc] = useState(false);

  const [saveState, setSaveState] = useState('idle'); // idle | saving | saved | error
  const [saveError, setSaveError] = useState('');
  const [exportOpen, setExportOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [, forceTick] = useState(0);

  const saveTimer = useRef(null);
  const pendingRef = useRef(null);
  const projectRef = useRef(null);
  const userRef = useRef(null);
  // Autosave ordering: PUTs are serialized through a promise chain (so an
  // older request can never land after a newer one), and each save carries a
  // sequence id so only the latest one updates the status UI.
  const saveSeqRef = useRef(0);
  const saveChainRef = useRef(Promise.resolve());

  useEffect(() => {
    let dead = false;
    (async () => {
      try {
        const [st, me, projects] = await Promise.all([
          spinoutLab.state(), api.getMe(), api.listProjects().catch(() => []),
        ]);
        if (dead) return;
        setState(st); setUser(me); userRef.current = me;
        const proj = pickLabProject(projects, me);
        setProject(proj || null); projectRef.current = proj || null;
        if (proj) {
          // Legacy/rounded allocations may not total exactly 100; normalize
          // before they can reach any save path (server requires exact 100).
          const b = normalizeBuckets(allocToBuckets(proj.use_of_funds));
          if (b) { setPcts(b); setHasAlloc(true); }
          const fn = num(proj.funding_needed);
          if (fn && fn > 0) setRaise(fn);
          try { setMeta(proj.use_of_funds_meta ? JSON.parse(proj.use_of_funds_meta) : {}); } catch { setMeta({}); }
          try {
            const rd = await api.listOkrs(proj.id);
            if (!dead) setOkrs(Array.isArray(rd?.okrs) ? rd.okrs : (Array.isArray(rd) ? rd : []));
          } catch { /* roadmap optional */ }
        }
        setStatus('ready');
      } catch (e) {
        console.error('[spinout-uof]', e);
        if (!dead) setStatus('error');
      }
    })();
    return () => { dead = true; };
  }, []);

  // Re-render "Synced X ago" labels each minute.
  useEffect(() => {
    const t = setInterval(() => forceTick((n) => n + 1), 60_000);
    return () => clearInterval(t);
  }, []);

  const canEdit = !!(user && project && Number(user.founder_id) === Number(project.founder_id));

  // ---- persistence (debounced autosave of alloc + raise + meta) ----
  // All PUTs go through a serialized promise chain; only the newest sequence
  // id may update the status UI, so a slow older request can neither land
  // after nor visually mask a newer one.
  const runSave = useCallback((payload) => {
    const seq = ++saveSeqRef.current;
    const proj = projectRef.current;
    if (!proj) return Promise.resolve();
    saveChainRef.current = saveChainRef.current
      .then(async () => {
        if (seq !== saveSeqRef.current) return; // superseded — skip this write
        try {
          await api.updateProject(proj.id, payload);
          if (seq !== saveSeqRef.current) return;
          setSaveState('saved'); setSaveError('');
          markMilestone(userRef.current, 'use_of_funds_filled');
        } catch (e) {
          if (seq !== saveSeqRef.current) return;
          console.error('[spinout-uof:save]', e);
          const detail = e?.data?.detail?.error || e?.data?.error || e?.message || 'Could not save.';
          setSaveState('error');
          setSaveError(typeof detail === 'string' ? detail : 'Could not save.');
        }
      });
    return saveChainRef.current;
  }, []);

  const scheduleSave = useCallback((nextPcts, nextRaise, nextMeta) => {
    pendingRef.current = { pcts: nextPcts, raise: nextRaise, meta: nextMeta };
    if (saveTimer.current) clearTimeout(saveTimer.current);
    setSaveState('saving');
    saveTimer.current = setTimeout(() => {
      const p = pendingRef.current;
      if (!p) return;
      runSave({
        use_of_funds: bucketsToUseOfFunds(p.pcts) || null,
        funding_needed: p.raise > 0 ? p.raise : null,
        use_of_funds_meta: JSON.stringify(p.meta || {}),
      });
    }, 800);
  }, [runSave]);

  useEffect(() => () => { if (saveTimer.current) clearTimeout(saveTimer.current); }, []);

  const applyAlloc = (next) => {
    if (!canEdit) return;
    setPcts(next); setHasAlloc(true);
    const m = { ...meta, deck_synced_at: null }; // allocation change → deck out of sync
    setMeta(m);
    scheduleSave(next, raise, m);
  };
  const applyRaise = (r) => {
    if (!canEdit) return;
    const v = Math.max(0, Math.round(Number(r) || 0));
    setRaise(v);
    const m = { ...meta, deck_synced_at: null };
    setMeta(m);
    scheduleSave(pcts, v, m);
  };
  const applyMeta = (patch) => {
    if (!canEdit) return;
    const m = { ...meta, ...patch };
    setMeta(m);
    scheduleSave(pcts, raise, m);
  };

  const saveNow = async (patch) => {
    if (!canEdit) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    const m = { ...meta, ...patch };
    setMeta(m); setSaveState('saving');
    await runSave({
      use_of_funds: bucketsToUseOfFunds(pcts) || null,
      funding_needed: raise > 0 ? raise : null,
      use_of_funds_meta: JSON.stringify(m),
    });
  };

  const syncDeck = () => saveNow({ deck_synced_at: new Date().toISOString() });
  const exportAxal = () => saveNow({ axal_exported_at: new Date().toISOString() });

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* clipboard blocked */ }
  };

  // ---- derived model ----
  const burn = modelBurn(pcts);
  const months = runwayMonths(raise, burn);
  const threshold = Number(meta.alert_threshold_months) || 6;
  const band = months === null ? null : (months > 12 ? 'healthy' : months >= 6 ? 'tight' : 'critical');
  const belowAlert = months !== null && months < threshold;
  const driverIdx = pcts.reduce((best, p, i) => (p * BUCKETS[i].intensity > pcts[best] * BUCKETS[best].intensity ? i : best), 0);

  const milestoneCosts = meta.milestone_costs || {};
  const mappedMilestones = useMemo(() => okrs.map((o) => {
    const mc = milestoneCosts[o.id] || {};
    const bucket = mc.bucket || guessBucket(o.objective);
    const cost = num(mc.cost) ?? 0;
    return { id: o.id, name: o.objective, done: o.kanban_status === 'done', bucket, cost };
  }), [okrs, milestoneCosts]);

  const bucketDollars = (i, r = raise) => (pcts[i] / 100) * r;
  const bucketMapping = BUCKETS.map((b, i) => {
    const items = mappedMilestones.filter((m) => m.bucket === b.key);
    const mapped = items.reduce((a, m) => a + m.cost, 0);
    const dollars = bucketDollars(i);
    return { ...b, i, items, mapped, dollars, unmapped: Math.max(0, dollars - mapped), over: mapped > dollars };
  });
  const milestonesCovered = (r) => {
    // How many milestones are fully funded at raise r with the current split.
    let covered = 0;
    for (const b of BUCKETS.map((bk, i) => ({ key: bk.key, budget: (pcts[i] / 100) * r }))) {
      let left = b.budget;
      for (const m of mappedMilestones.filter((x) => x.bucket === b.key)) {
        if (m.cost <= left) { covered += 1; left -= m.cost; }
      }
    }
    return covered;
  };

  const scenarioRaise = Number(meta.custom_scenario_raise) || raise || 1_000_000;
  const setMilestone = (id, patch) => {
    const next = { ...milestoneCosts, [id]: { ...(milestoneCosts[id] || {}), ...patch } };
    applyMeta({ milestone_costs: next });
  };

  const syncStale = !meta.deck_synced_at;

  // ---- gates ----
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
  const isAdmin = user?.role === 'admin';
  if (!state?.active && !isAdmin) {
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
  if (!isAdmin && !(state?.unlocked_features || []).includes('use-of-funds')) {
    return (
      <div className="max-w-xl mx-auto mt-16 text-center" data-testid="uof-locked">
        <Lock className="w-8 h-8 text-gray-300 dark:text-gray-600 mx-auto mb-3" />
        <h2 className="text-lg font-bold text-gray-900 dark:text-gray-50 mb-1">Use of Funds unlocks in Week 4</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">Finish your current week's deliverables to unlock capital planning.</p>
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
          Create your startup in <Link to="/spinout-lab/startup" className="text-violet-600 hover:underline">Startups</Link> first — the allocation is stored on it.
        </p>
      </div>
    );
  }

  const week = num(user?.spinout_lab_week) || state?.week || 4;
  const BAND_TEXT = {
    healthy: ['Healthy · above 12 months', 'text-emerald-600 dark:text-emerald-400'],
    tight: ['Tight · 6–12 months', 'text-amber-600 dark:text-amber-400'],
    critical: ['Critical · under 6 months', 'text-rose-600 dark:text-rose-400'],
  };

  return (
    <div className="max-w-[1200px] mx-auto px-4 py-6 space-y-5" data-testid="page-spinout-uof">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button" onClick={() => navigate('/spinout-lab')} data-testid="button-back-workspace"
          className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100"
        >
          <ArrowLeft size={14} /> Back to Workspace
        </button>
        <div className="flex items-center gap-2">
          <span className="w-7 h-7 rounded-lg bg-violet-600 text-white inline-flex items-center justify-center"><DollarSign size={14} /></span>
          <h1 className="text-[17px] font-extrabold tracking-tight text-gray-900 dark:text-gray-50">Use of Funds</h1>
          <span className="text-[10px] font-bold uppercase tracking-wider rounded-full px-2 py-0.5 bg-emerald-50 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">Active</span>
        </div>
        <span className="ml-auto text-[11px] font-semibold text-gray-400 dark:text-gray-500">Unlocked · Wk {week}</span>
      </div>
      <div className="flex flex-wrap items-center gap-2 -mt-2">
        <p className="text-[12.5px] text-gray-500 dark:text-gray-400 flex-1 min-w-[200px]">
          Allocate your raise, model runway, and map capital to milestones. Your pitch deck's ASK slide reads this allocation live.
        </p>
        {/* Quick actions */}
        <div className="flex items-center gap-1.5 relative">
          <button type="button" onClick={copyLink} data-testid="button-share" className="inline-flex items-center gap-1 text-[11.5px] font-semibold text-gray-600 dark:text-gray-300 rounded-lg border border-gray-200 dark:border-gray-700 px-2.5 py-1.5 hover:border-violet-400">
            <Share2 size={12} /> Share
          </button>
          <div className="relative">
            <button type="button" onClick={() => setExportOpen((v) => !v)} data-testid="button-export" className="inline-flex items-center gap-1 text-[11.5px] font-semibold text-gray-600 dark:text-gray-300 rounded-lg border border-gray-200 dark:border-gray-700 px-2.5 py-1.5 hover:border-violet-400">
              <Download size={12} /> Export <ChevronDown size={11} />
            </button>
            {exportOpen && (
              <div className="absolute right-0 top-full mt-1 z-20 w-56 rounded-xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 shadow-lg p-1" data-testid="export-menu">
                <button type="button" disabled={!canEdit} onClick={() => { setExportOpen(false); syncDeck(); }} data-testid="export-deck" className="w-full text-left text-[12px] font-semibold text-gray-700 dark:text-gray-200 rounded-lg px-3 py-2 hover:bg-violet-50 dark:hover:bg-violet-900/20 disabled:opacity-40">
                  Pitch Deck format <span className="block text-[10px] font-normal text-gray-400">Syncs THE ASK slide data</span>
                </button>
                <button type="button" disabled={!canEdit} onClick={() => { setExportOpen(false); exportAxal(); }} data-testid="export-axal" className="w-full text-left text-[12px] font-semibold text-gray-700 dark:text-gray-200 rounded-lg px-3 py-2 hover:bg-violet-50 dark:hover:bg-violet-900/20 disabled:opacity-40">
                  Axal VC Spin-Out format <span className="block text-[10px] font-normal text-gray-400">28-day program export</span>
                </button>
              </div>
            )}
          </div>
          <button type="button" onClick={copyLink} data-testid="button-copy-link" className="inline-flex items-center gap-1 text-[11.5px] font-semibold text-gray-600 dark:text-gray-300 rounded-lg border border-gray-200 dark:border-gray-700 px-2.5 py-1.5 hover:border-violet-400">
            {copied ? <Check size={12} className="text-emerald-500" /> : <Link2 size={12} />} {copied ? 'Copied' : 'Copy link'}
          </button>
          <button type="button" onClick={() => setPreviewOpen(true)} data-testid="button-investor-preview" className="inline-flex items-center gap-1 text-[11.5px] font-bold text-white bg-violet-600 hover:bg-violet-700 rounded-lg px-2.5 py-1.5">
            <Eye size={12} /> Preview as investor
          </button>
        </div>
      </div>

      {/* Burn alert banner */}
      {belowAlert && (
        <div className="rounded-xl bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-900/50 px-4 py-3 flex items-start gap-2.5" data-testid="banner-burn-alert">
          <AlertTriangle size={16} className="text-rose-500 shrink-0 mt-0.5" />
          <p className="text-[12.5px] text-rose-800 dark:text-rose-300">
            <span className="font-bold">Runway below your {threshold}-month alert.</span>{' '}
            At this allocation you'd burn {fmtMoney(burn)}/mo — {BUCKETS[driverIdx].name} is the largest burn driver
            ({pcts[driverIdx]}% at ${BUCKETS[driverIdx].intensity}/point). Trim it or raise more.
          </p>
        </div>
      )}
      {saveState === 'error' && (
        <div className="rounded-xl bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-900/50 px-4 py-2.5 text-[12px] text-rose-700 dark:text-rose-300" data-testid="save-error">{saveError}</div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[360px_1fr] gap-5 items-start">
        {/* Left column */}
        <div className="space-y-4">
          {/* Allocation */}
          <div className={CARD} data-testid="card-allocation">
            <div className="flex items-center justify-between mb-2">
              <div className={LBL}>Allocation · {fmtMoney(raise)} raise</div>
              <span
                className={`text-[10px] font-bold rounded-full px-2 py-0.5 ${syncStale ? 'bg-amber-50 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300' : 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300'}`}
                data-testid="pill-sync-status"
              >
                {saveState === 'saving' ? 'Saving…' : syncStale ? 'Out of sync' : `Synced ${agoLabel(meta.deck_synced_at) || ''}`}
              </span>
            </div>
            <div className="flex justify-center mb-3">
              <Donut pcts={pcts} centerLabel={fmtMoney(raise)} onChange={applyAlloc} editable={canEdit} size={190} />
            </div>
            <p className="text-[10px] text-gray-400 text-center mb-3">{canEdit ? 'Drag the handles on the ring, or use the sliders.' : 'Read-only — you don\'t own this startup record.'}</p>
            <div className="space-y-3 mb-4">
              {BUCKETS.map((b, i) => (
                <div key={b.key} data-testid={`slider-row-${b.key}`}>
                  <div className="flex items-center gap-2 text-[12px] mb-1">
                    <span className="w-2.5 h-2.5 rounded-sm inline-block shrink-0" style={{ background: b.color }} />
                    <span className="flex-1 font-semibold text-gray-700 dark:text-gray-200">{b.name}</span>
                    <span className="font-bold text-gray-900 dark:text-gray-50 tabular-nums">{fmtMoney(bucketDollars(i))}</span>
                    <span className="text-gray-400 tabular-nums w-9 text-right">{pcts[i]}%</span>
                  </div>
                  <input
                    type="range" min={3} max={94} value={pcts[i]} disabled={!canEdit}
                    onChange={(e) => applyAlloc(rebalance(pcts, i, Number(e.target.value)))}
                    className="w-full" style={{ accentColor: b.color }}
                    data-testid={`slider-${b.key}`}
                  />
                </div>
              ))}
            </div>
            <label className="block">
              <span className={LBL}>Raise target (USD)</span>
              <input
                type="number" min="0" step="50000" value={raise || ''} disabled={!canEdit}
                onChange={(e) => applyRaise(e.target.value)}
                className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-[13px] text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-violet-500/40"
                data-testid="input-raise"
              />
            </label>
            <p className="text-[10.5px] text-gray-400 dark:text-gray-500 mt-2">
              Saved to your startup record automatically — the deck's ASK slide and scoring memo read the same fields.
            </p>
          </div>

          {/* Runway */}
          <div className={CARD} data-testid="card-runway">
            <div className={`${LBL} mb-2`}>Runway at current burn</div>
            {months !== null ? (
              <>
                <div className="flex items-baseline gap-2">
                  <div className={`text-[34px] font-extrabold tabular-nums leading-none font-mono ${BAND_TEXT[band][1]}`} data-testid="text-runway-months">{months.toFixed(1)}</div>
                  <div className="text-[12px] font-bold text-gray-500 dark:text-gray-400">months</div>
                </div>
                <div className={`text-[11px] font-semibold mt-1 ${BAND_TEXT[band][1]}`} data-testid="text-runway-band">{BAND_TEXT[band][0]}</div>
                <div className="grid grid-cols-3 gap-2 mt-3 text-center">
                  <div>
                    <div className="text-[12px] font-bold text-gray-900 dark:text-gray-50 tabular-nums" data-testid="text-burn">{fmtMoney(burn)}</div>
                    <div className="text-[9.5px] text-gray-400">Monthly burn</div>
                  </div>
                  <div>
                    <div className="text-[12px] font-bold text-gray-900 dark:text-gray-50" data-testid="text-burn-driver">{BUCKETS[driverIdx].name}</div>
                    <div className="text-[9.5px] text-gray-400">Largest driver</div>
                  </div>
                  <div>
                    <div className="text-[12px] font-bold text-gray-900 dark:text-gray-50">{cashOutLabel(months)}</div>
                    <div className="text-[9.5px] text-gray-400">Cash-out</div>
                  </div>
                </div>
                <p className="text-[9.5px] text-gray-400 mt-2">
                  Modeled from allocation intensity: Eng $700 · GTM $1,200 · Ops $450 per point / month.
                </p>
              </>
            ) : (
              <p className="text-[11.5px] text-gray-500 dark:text-gray-400" data-testid="runway-empty">Set a raise target to model runway.</p>
            )}
          </div>

          {/* Runway timeline + thresholds */}
          <div className={CARD} data-testid="card-timeline">
            <div className={`${LBL} mb-3`}>Runway timeline · alert thresholds</div>
            <div className="relative h-2.5 rounded-full bg-gray-100 dark:bg-gray-800">
              {months !== null && (
                <div
                  className={`absolute inset-y-0 left-0 rounded-full ${band === 'critical' ? 'bg-rose-500' : band === 'tight' ? 'bg-amber-500' : 'bg-emerald-500'}`}
                  style={{ width: `${Math.min(100, ((months || 0) / 36) * 100)}%` }}
                />
              )}
              {[3, 6, 12].map((t) => (
                <div key={t} className="absolute -top-1 bottom-[-4px] w-px bg-gray-300 dark:bg-gray-600" style={{ left: `${(t / 36) * 100}%` }}>
                  <span className="absolute -top-3.5 -translate-x-1/2 text-[8.5px] text-gray-400">{t}m</span>
                </div>
              ))}
            </div>
            <div className="flex justify-between text-[9px] text-gray-400 mt-1.5"><span>0</span><span>12mo</span><span>24mo</span><span>36mo</span></div>
            <div className="flex items-center gap-2 mt-3 pt-3 border-t border-gray-100 dark:border-gray-800 flex-wrap">
              <span className="text-[11px] text-gray-500 dark:text-gray-400">Alert when below</span>
              {[3, 6, 12].map((t) => (
                <button
                  key={t} type="button" disabled={!canEdit}
                  onClick={() => applyMeta({ alert_threshold_months: t })}
                  data-testid={`threshold-${t}`}
                  className={`text-[11px] font-bold rounded-full px-2.5 py-1 disabled:opacity-50 ${threshold === t ? 'bg-violet-600 text-white' : 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300'}`}
                >
                  {t} months
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Right column */}
        <div className="space-y-4">
          {/* Milestone → capital mapping */}
          <div className={CARD} data-testid="card-milestone-mapping">
            <div className="flex items-center justify-between mb-1">
              <div className={LBL}>Milestone → capital mapping</div>
              <Link to="/spinout-lab/roadmap" className="inline-flex items-center gap-1 text-[11px] font-semibold text-violet-600 hover:underline" data-testid="link-roadmap">
                <MapIcon size={11} /> Roadmap
              </Link>
            </div>
            {/* The design's sub-label. Costs are entered here rather than on the
                objective because Roadmap OKRs carry no cost field. */}
            <div className="text-[11px] text-gray-400 dark:text-gray-500 mb-3">Cost per milestone · from Roadmap</div>
            {mappedMilestones.length === 0 ? (
              <p className="text-[11.5px] text-gray-500 dark:text-gray-400" data-testid="mapping-empty">
                No Roadmap milestones yet — add objectives in the{' '}
                <Link to="/spinout-lab/roadmap" className="text-violet-600 hover:underline">Roadmap</Link>{' '}
                and cost them here to map capital to milestones.
              </p>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                {bucketMapping.map((b) => (
                  <div key={b.key} className="rounded-xl border border-gray-200 dark:border-gray-700 p-3" data-testid={`mapping-${b.key}`}>
                    <div className="flex items-center gap-1.5 mb-2">
                      <span className="w-2 h-2 rounded-sm" style={{ background: b.color }} />
                      <span className="text-[11px] font-bold text-gray-700 dark:text-gray-200">{b.name}</span>
                      <span className="ml-auto text-[10px] font-bold tabular-nums text-gray-500">{fmtMoney(b.dollars)}</span>
                    </div>
                    <div className="space-y-1.5">
                      {b.items.map((m) => (
                        <div key={m.id} className="flex items-center gap-1.5 text-[11px]" data-testid={`milestone-${m.id}`}>
                          {m.cost > 0 && m.mapped <= b.dollars
                            ? <Check size={11} className="text-emerald-500 shrink-0" />
                            : m.cost > 0
                              ? <AlertTriangle size={11} className="text-amber-500 shrink-0" />
                              : <span className="w-[11px] shrink-0" />}
                          <span className={`flex-1 min-w-0 truncate ${m.done ? 'text-gray-400 line-through' : 'text-gray-700 dark:text-gray-200'}`} title={m.name}>{m.name}</span>
                          {canEdit ? (
                            <input
                              type="number" min="0" step="5000" value={m.cost || ''}
                              placeholder="$"
                              onChange={(e) => setMilestone(m.id, { cost: Number(e.target.value) || 0, bucket: m.bucket })}
                              className="w-[68px] rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-1.5 py-0.5 text-[10.5px] text-right tabular-nums text-gray-900 dark:text-gray-100"
                              data-testid={`input-cost-${m.id}`}
                            />
                          ) : (
                            <span className="tabular-nums text-gray-500">{m.cost ? fmtMoney(m.cost) : '—'}</span>
                          )}
                          {canEdit && (
                            <select
                              value={m.bucket}
                              onChange={(e) => setMilestone(m.id, { bucket: e.target.value, cost: m.cost })}
                              className="rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-[10px] text-gray-500 py-0.5"
                              data-testid={`select-bucket-${m.id}`}
                            >
                              {BUCKETS.map((bk) => <option key={bk.key} value={bk.key}>{bk.name}</option>)}
                            </select>
                          )}
                        </div>
                      ))}
                      {b.items.length === 0 && <div className="text-[10.5px] text-gray-400">No milestones in this bucket.</div>}
                    </div>
                    <div className={`mt-2 pt-2 border-t border-gray-100 dark:border-gray-800 text-[10.5px] font-semibold ${b.over ? 'text-rose-600 dark:text-rose-400' : 'text-gray-400'}`} data-testid={`unmapped-${b.key}`}>
                      {b.over
                        ? `${fmtMoney(b.mapped - b.dollars)} underfunded`
                        : b.unmapped > 0
                          ? `${fmtMoney(b.unmapped)} unmapped`
                          : 'Fully mapped'}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Scenario comparison */}
          <div className={CARD} data-testid="card-scenarios">
            <div className="flex items-center gap-1.5 mb-1">
              <Calculator size={13} className="text-violet-500" />
              <div className={LBL}>Scenario comparison</div>
              <span className="ml-auto text-[10px] text-gray-400">same split · click a card to set your raise</span>
            </div>
            <div className="flex items-center gap-3 my-3">
              <span className="text-[11px] text-gray-500 dark:text-gray-400 whitespace-nowrap">Custom raise</span>
              <input
                type="range" min={250000} max={3000000} step={50000}
                value={Math.min(3000000, Math.max(250000, scenarioRaise))}
                onChange={(e) => applyMeta({ custom_scenario_raise: Number(e.target.value) })}
                disabled={!canEdit}
                className="flex-1 accent-violet-500" data-testid="slider-custom-raise"
              />
              <span className="text-[12px] font-extrabold text-violet-700 dark:text-violet-300 tabular-nums w-16 text-right" data-testid="text-custom-raise">{fmtMoney(scenarioRaise)}</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              {[...SCENARIOS, { key: 'custom', name: 'Custom', raise: scenarioRaise }].map((s) => {
                const m = runwayMonths(s.raise, burn);
                const isCurrent = raise && Math.abs(s.raise - raise) < 1;
                return (
                  <button
                    type="button" key={s.key} disabled={!canEdit}
                    onClick={() => applyRaise(s.raise)}
                    className={`text-left rounded-xl border p-3 transition-colors ${isCurrent ? 'border-violet-400 dark:border-violet-600 ring-1 ring-violet-500/20' : 'border-gray-200 dark:border-gray-700 hover:border-violet-300'}`}
                    data-testid={`scenario-${s.key}`}
                  >
                    <div className="text-[11px] font-bold text-gray-500 dark:text-gray-400">{s.name}{isCurrent ? ' · current' : ''}</div>
                    <div className="text-[15px] font-extrabold text-gray-900 dark:text-gray-50 tabular-nums mb-2">{fmtMoney(s.raise)}</div>
                    <div className="flex justify-between text-[11px]">
                      <span className="text-gray-400">Runway</span>
                      <span className={`font-bold tabular-nums ${m !== null && m > 12 ? 'text-emerald-600 dark:text-emerald-400' : m !== null && m >= 6 ? 'text-amber-600 dark:text-amber-400' : 'text-rose-600 dark:text-rose-400'}`}>
                        {m !== null ? `${m.toFixed(1)}mo` : '—'}
                      </span>
                    </div>
                    <div className="flex justify-between text-[11px]">
                      <span className="text-gray-400">Burn/mo</span>
                      <span className="font-bold tabular-nums text-gray-700 dark:text-gray-200">{fmtMoney(burn)}</span>
                    </div>
                    <div className="flex justify-between text-[11px]">
                      <span className="text-gray-400">Milestones</span>
                      <span className="font-bold tabular-nums text-gray-700 dark:text-gray-200">{milestonesCovered(s.raise)}/{mappedMilestones.length}</span>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Sync targets */}
          <div className={CARD} data-testid="card-sync-targets">
            <div className={`${LBL} mb-3`}>Sync targets</div>
            <div className="space-y-3">
              <div className="flex items-center gap-3 rounded-xl border border-gray-200 dark:border-gray-700 px-3 py-2.5" data-testid="sync-deck">
                <Presentation size={15} className="text-violet-500 shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="text-[12px] font-bold text-gray-800 dark:text-gray-100">Pitch Deck · THE ASK slide</div>
                  <div className="text-[10.5px] text-gray-400">
                    {meta.deck_synced_at ? `Last synced ${agoLabel(meta.deck_synced_at)}` : 'Not synced since last change'}
                    {' · '}<Link to="/build/deck" className="text-violet-600 hover:underline">open deck</Link>
                  </div>
                </div>
                <button type="button" disabled={!canEdit || saveState === 'saving'} onClick={syncDeck} data-testid="button-sync-deck" className="inline-flex items-center gap-1 text-[11px] font-bold text-white bg-violet-600 hover:bg-violet-700 rounded-lg px-2.5 py-1.5 disabled:opacity-40">
                  <RefreshCw size={11} /> Sync
                </button>
              </div>
              <div className="flex items-center gap-3 rounded-xl border border-gray-200 dark:border-gray-700 px-3 py-2.5" data-testid="sync-axal">
                <FileText size={15} className="text-teal-500 shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="text-[12px] font-bold text-gray-800 dark:text-gray-100">Axal VC · 28-day Spin-Out export</div>
                  <div className="text-[10.5px] text-gray-400">{meta.axal_exported_at ? `Last exported ${agoLabel(meta.axal_exported_at)}` : 'Not exported yet'}</div>
                </div>
                <button type="button" disabled={!canEdit || saveState === 'saving'} onClick={exportAxal} data-testid="button-export-axal" className="inline-flex items-center gap-1 text-[11px] font-bold text-white bg-teal-600 hover:bg-teal-700 rounded-lg px-2.5 py-1.5 disabled:opacity-40">
                  <Download size={11} /> Export
                </button>
              </div>
            </div>
            <p className="text-[10.5px] text-gray-400 dark:text-gray-500 mt-3">
              The deck and scoring memo read the saved allocation directly; syncing stamps the record so you know they're current.
            </p>
          </div>
        </div>
      </div>

      {/* Investor preview modal */}
      {previewOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={() => setPreviewOpen(false)} data-testid="modal-investor-preview">
          <div className="w-full max-w-2xl rounded-2xl bg-gray-950 border border-gray-800 p-6 text-gray-100" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <div>
                <div className="text-[10px] font-bold uppercase tracking-widest text-violet-400">The Ask · investor view</div>
                <h3 className="text-lg font-extrabold">{project.name} — {fmtMoney(raise)} raise</h3>
              </div>
              <button type="button" onClick={() => setPreviewOpen(false)} data-testid="button-close-preview" className="text-gray-400 hover:text-white"><X size={18} /></button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-[180px_1fr] gap-5 items-center mb-5">
              <div className="justify-self-center"><Donut pcts={pcts} centerLabel={fmtMoney(raise)} editable={false} size={160} /></div>
              <div className="space-y-2.5">
                {BUCKETS.map((b, i) => (
                  <div key={b.key}>
                    <div className="flex justify-between text-[11.5px] mb-1">
                      <span className="font-semibold">{b.name}</span>
                      <span className="tabular-nums text-gray-300">{fmtMoney(bucketDollars(i))} · {pcts[i]}%</span>
                    </div>
                    <div className="h-1.5 rounded-full bg-gray-800"><div className="h-full rounded-full" style={{ width: `${pcts[i]}%`, background: b.color }} /></div>
                  </div>
                ))}
                <div className="text-[11px] text-gray-400 pt-1">
                  {months !== null ? `${months.toFixed(1)} months runway at ${fmtMoney(burn)}/mo modeled burn · cash-out ${cashOutLabel(months)}` : 'Set a raise to model runway.'}
                </div>
              </div>
            </div>
            {mappedMilestones.some((m) => m.cost > 0) && (
              <div className="mb-5">
                <div className="text-[10px] font-bold uppercase tracking-widest text-gray-500 mb-2">Milestone efficiency</div>
                <div className="rounded-xl border border-gray-800 divide-y divide-gray-800">
                  {mappedMilestones.filter((m) => m.cost > 0).slice(0, 6).map((m) => (
                    <div key={m.id} className="flex items-center gap-2 px-3 py-1.5 text-[11.5px]">
                      <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: BUCKETS.find((b) => b.key === m.bucket)?.color }} />
                      <span className="flex-1 truncate">{m.name}</span>
                      <span className="tabular-nums text-gray-300">{fmtMoney(m.cost)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            <div className="rounded-xl bg-teal-900/30 border border-teal-800/60 px-4 py-3 text-[11.5px] text-teal-200" data-testid="preview-axal-block">
              <span className="font-bold">Axal VC Spin-Out summary:</span>{' '}
              {fmtMoney(raise)} across {BUCKETS.map((b, i) => `${b.name} ${pcts[i]}%`).join(' · ')} — {months !== null ? `${months.toFixed(1)}mo runway` : 'runway TBD'}, {milestonesCovered(raise)}/{mappedMilestones.length || 0} milestones funded.
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
