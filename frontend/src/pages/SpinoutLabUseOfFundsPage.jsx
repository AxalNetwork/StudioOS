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
//     Donut boundary handles + auto-rebalancing sliders (design's signature
//     interaction) write into the same values state; the exact-100 validation
//     stays as a backstop for typed input.
//   - Runway modeling & scenario comparison: a client-side planning
//     calculator, clearly labeled as not stored. No burn-rate/expenses field
//     exists in either runtime, so burn is an ephemeral what-if input —
//     fabricating a persisted "current burn" would be dishonest. Months, the
//     band, the alert banner, and the largest-driver figure all derive live
//     from raise/burn/split each render; the driver split assumes monthly
//     spend follows the allocation percentages (labeled in the card).
//   - Milestone → capital mapping: Roadmap items carry NO cost/budget fields
//     in either runtime, so the design's per-milestone costs are fabricated.
//     We show per-bucket allocation dollars plus the real Week-4 milestone
//     context and say costs aren't tracked.
//   - Share + "Axal VC Spin-Out format" export: no backend for either —
//     shipped disabled with the reason. "Pitch Deck format" export is a
//     client-side JSON download of THE ASK slide data; "Copy link" is the
//     clipboard; "Preview as investor" renders the live local values only.

import React, { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  ArrowLeft, Loader2, Lock, AlertTriangle, FileText,
  Presentation, Gauge, Map as MapIcon, Calculator,
  DollarSign, Check, Share2, Download, ChevronDown, Copy, Eye, X, Layers,
} from 'lucide-react';
import { api, spinoutLab } from '../lib/api';
import { markMilestone } from '../lib/spinoutLabHooks';
import { pickLabProject } from './SpinoutLabStartupPage';
import {
  FUND_SECTIONS, FundAllocator, allocToValues, valuesToUseOfFunds, fundsTotal, fundsValid,
} from '../components/FundAllocator';

const CARD = 'rounded-2xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 p-5';
const LBL = 'text-[11px] font-bold uppercase tracking-wider text-gray-400 dark:text-gray-500';
const INPUT = 'w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-[13px] text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-violet-500/40';
const QA = 'inline-flex items-center gap-1.5 text-[12px] font-semibold text-gray-600 dark:text-gray-300 rounded-lg px-3 py-1.5 border border-transparent hover:border-gray-200 dark:hover:border-gray-700 hover:bg-white dark:hover:bg-gray-800';
const QA_DISABLED = 'inline-flex items-center gap-1.5 text-[12px] font-semibold text-gray-400 dark:text-gray-500 rounded-lg px-3 py-1.5 border border-transparent opacity-60 cursor-not-allowed';
const MENU_ITEM = 'flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left text-[12px] font-semibold text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800';

// Section colors, index-aligned with FUND_SECTIONS.
const SECTION_COLORS = ['#7c3aed', '#0d9488', '#0284c7', '#d97706', '#e11d48'];
const SECTION_BG = ['bg-violet-600', 'bg-teal-600', 'bg-sky-600', 'bg-amber-600', 'bg-rose-600'];

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);

// Short bucket name for tight slots ("GTM: sales and marketing" → "GTM").
const shortSection = (i) => FUND_SECTIONS[i].split(/[:&]/)[0].trim();

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

// Fixed health bands per the design (the alert threshold only drives the
// banner, not the band): >12 healthy, 6–12 caution, <6 critical.
export function runwayBand(months) {
  if (months === null) return null;
  if (months < 6) return 'critical';
  if (months < 12) return 'caution';
  return 'healthy';
}

// Shared band styling — runway card, timeline bar, and scenario cards all
// color runway through this one map.
const BAND_STYLES = {
  healthy: { label: 'Healthy · above 12 months', cls: 'text-emerald-600 dark:text-emerald-400', bar: 'bg-emerald-500' },
  caution: { label: 'Caution · 6–12 months', cls: 'text-amber-600 dark:text-amber-400', bar: 'bg-amber-500' },
  critical: { label: 'Critical · under 6 months', cls: 'text-rose-600 dark:text-rose-400', bar: 'bg-rose-500' },
};

function cashOutLabel(months) {
  if (months === null) return '—';
  const d = new Date();
  d.setMonth(d.getMonth() + Math.floor(months));
  return d.toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
}

// SVG donut from the 5-slot percentage array (only non-zero slices).
//
// When `onReallocate` is provided and the split totals exactly 100, boundary
// handles render between adjacent non-zero slices and pointer-drag trades
// percentage between those two buckets (the design's 2-handle math at a fixed
// pair sum, generalized to the N canonical sections) with a `minPct` floor per
// slice. The wrap boundary at 12 o'clock stays fixed, like the design.
// `dark` renders the investor-slide variant (dark track, white center label).
function Donut({ values, centerLabel, dark = false, onReallocate = null, minPct = 3 }) {
  const svgRef = useRef(null);
  const valuesRef = useRef(values);
  valuesRef.current = values;
  const [dragging, setDragging] = useState(false);
  const total = fundsTotal(values);
  const R = 42;
  const C = 2 * Math.PI * R;
  const interactive = typeof onReallocate === 'function' && total === 100;

  // Non-zero slices in canonical order with cumulative percentage bounds.
  const nz = [];
  let cum = 0;
  values.forEach((v, i) => {
    if (v > 0) nz.push({ i, v, start: cum, end: cum + v });
    cum += v;
  });
  // A handle sits at the boundary after each non-zero slice except the last;
  // it reallocates between that slice (a) and the next non-zero one (b).
  // Their outer bounds are invariant during a drag, so per-handle math only
  // needs `startA` and the fixed pair sum.
  const handles = interactive
    ? nz.slice(0, -1).map((s, j) => {
      const nxt = nz[j + 1];
      if (s.v + nxt.v < 2 * minPct) return null; // no room to trade — skip dead handle
      const frac = s.end / 100;
      return {
        key: `${s.i}-${nxt.i}`,
        x: 60 + R * Math.sin(2 * Math.PI * frac),
        y: 60 - R * Math.cos(2 * Math.PI * frac),
        a: s.i, b: nxt.i, startA: s.start, sum: s.v + nxt.v,
      };
    }).filter(Boolean)
    : [];

  const startDrag = (h) => (e) => {
    e.preventDefault();
    const svg = svgRef.current;
    if (!svg) return;
    setDragging(true);
    const move = (ev) => {
      const r = svg.getBoundingClientRect();
      if (!r.width || !r.height) return;
      const x = ((ev.clientX - r.left) / r.width) * 120 - 60;
      const y = ((ev.clientY - r.top) / r.height) * 120 - 60;
      let f = Math.atan2(x, -y) / (2 * Math.PI); // clockwise fraction from 12 o'clock
      f = ((f % 1) + 1) % 1;
      let a = Math.round(f * 100 - h.startA);
      a = Math.max(minPct, Math.min(h.sum - minPct, a));
      const next = [...valuesRef.current];
      if (next[h.a] === a) return;
      next[h.a] = a;
      next[h.b] = h.sum - a; // pair sum preserved → total stays exactly 100
      onReallocate(next);
    };
    const up = () => {
      setDragging(false);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  let offset = 0;
  return (
    <svg
      ref={svgRef}
      viewBox="0 0 120 120"
      className="w-36 h-36"
      style={{ touchAction: 'none', cursor: dragging ? 'grabbing' : undefined }}
      role="img"
      aria-label="Allocation donut"
    >
      <circle cx="60" cy="60" r={R} fill="none" stroke="currentColor" className={dark ? 'text-white/10' : 'text-gray-100 dark:text-gray-800'} strokeWidth="14" />
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
      <text x="60" y="57" textAnchor="middle" className={dark ? 'fill-gray-500' : 'fill-gray-400'} style={{ fontSize: 9 }}>Deploys</text>
      <text x="60" y="70" textAnchor="middle" className={dark ? 'fill-white' : 'fill-gray-900 dark:fill-gray-100'} style={{ fontSize: 12, fontWeight: 800 }}>{centerLabel}</text>
      {handles.map((h) => (
        <g
          key={h.key}
          className="cursor-grab"
          style={dragging ? { cursor: 'grabbing' } : undefined}
          onPointerDown={startDrag(h)}
        >
          <circle cx={h.x} cy={h.y} r="6.5" className="fill-white dark:fill-gray-200" stroke="#3f3f46" strokeWidth="1.8" />
          <circle cx={h.x} cy={h.y} r="2.2" fill="#3f3f46" />
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
  // Quick-action UI state (all client-side; nothing here talks to a backend).
  const [exportOpen, setExportOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const copyTimer = useRef(null);

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

  useEffect(() => () => { if (copyTimer.current) clearTimeout(copyTimer.current); }, []);

  const canEdit = !!(user && project && Number(user.founder_id) === Number(project.founder_id));
  const total = fundsTotal(values);
  const valid = fundsValid(values);
  const raise = num(raiseInput);
  const effectiveRaise = raise && raise > 0 ? raise : null;

  // Typed numeric input: direct set — the exact-100 validation below is the
  // backstop for values entered by keyboard.
  const onSlice = (i, v) => {
    const next = [...values];
    next[i] = Math.max(0, Math.min(100, Math.round(Number(v) || 0)));
    setValues(next);
    setDirty(true);
    setSaveError('');
  };

  // Slider moves auto-rebalance: the remainder is redistributed pro-rata
  // across the other buckets (evenly when they're all zero) so the total is
  // always exactly 100 — the design's 3-bucket setSlider math generalized to
  // the 5 canonical sections. The "must total 100%" error is unreachable
  // through sliders/handles; it remains reachable via typed input only.
  const rebalance = (i, v) => {
    const target = Math.max(0, Math.min(100, Math.round(Number(v) || 0)));
    setValues((prev) => {
      const next = [...prev];
      next[i] = target;
      const others = prev.map((_, j) => j).filter((j) => j !== i);
      let left = 100 - target;
      let pool = others.reduce((a, j) => a + (Number(prev[j]) || 0), 0);
      others.forEach((j, k) => {
        if (k === others.length - 1) { next[j] = left; return; }
        const share = pool > 0
          ? Math.round((left * (Number(prev[j]) || 0)) / pool)
          : Math.round(left / (others.length - k));
        next[j] = share;
        left -= share;
        pool -= Number(prev[j]) || 0;
      });
      return next;
    });
    setDirty(true);
    setSaveError('');
  };

  // Donut boundary-handle drags arrive as a complete, already-balanced array.
  const applyValues = (next) => {
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
      // W4 deliverable — a real allocation is saved on the company record.
      if (body.use_of_funds) markMilestone(user, 'use_of_funds_filled');
    } catch (e) {
      console.error('[spinout-uof:save]', e);
      const detail = e?.data?.detail?.error || e?.data?.error || e?.message || 'Could not save the allocation.';
      setSaveError(typeof detail === 'string' ? detail : 'Could not save the allocation.');
    } finally {
      setSaving(false);
    }
  };

  const copyLink = async () => {
    const url = window.location.href;
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      // Clipboard API unavailable (permissions/insecure context) — fall back.
      const ta = document.createElement('textarea');
      ta.value = url;
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); } catch { /* best effort */ }
      document.body.removeChild(ta);
    }
    setCopied(true);
    if (copyTimer.current) clearTimeout(copyTimer.current);
    copyTimer.current = setTimeout(() => setCopied(false), 1600);
  };

  // "Pitch Deck format" — downloads THE ASK slide's data (the same canonical
  // fields the deck assembler reads) as JSON. Client-side only; no export
  // endpoint exists, and the menu item says it's a download.
  const exportDeckJson = () => {
    const payload = {
      format: 'studioos.pitch-deck.the-ask/v1',
      generated_at: new Date().toISOString(),
      project: project?.name ?? null,
      funding_needed: effectiveRaise,
      use_of_funds: FUND_SECTIONS
        .map((label, i) => ({
          label,
          pct: values[i],
          amount: effectiveRaise ? Math.round((values[i] / 100) * effectiveRaise) : null,
        }))
        .filter((x) => x.pct > 0),
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'use-of-funds-pitch-deck.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    setExportOpen(false);
  };

  // What-if runway math (client-side only, derived fresh every render — the
  // months figure, band, banner, and driver stats all react live to the
  // allocation, raise, and burn inputs).
  const burnN = num(burn);
  const months = runwayMonths(effectiveRaise, burnN);
  const band = runwayBand(months);
  const largestIdx = values.reduce((best, v, i) => (v > values[best] ? i : best), 0);
  // Driver split assumes monthly spend follows the allocation percentages
  // (labeled in the UI) — burn itself stays a single user-entered number.
  const driverBurn = burnN && values[largestIdx] > 0 ? (values[largestIdx] / 100) * burnN : null;
  const alertActive = months !== null && months < threshold;
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
      {/* Chrome: violet topline */}
      <div className="h-[3px] -mt-6 -mx-4 rounded-b-[3px] bg-violet-600" data-testid="uof-topline" />
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
        <div className="flex items-center gap-2.5">
          <span className="w-8 h-8 rounded-[9px] bg-violet-50 dark:bg-violet-900/30 text-violet-600 dark:text-violet-400 flex items-center justify-center shrink-0">
            <DollarSign size={16} />
          </span>
          <h1 className="text-[17px] font-extrabold tracking-tight text-gray-900 dark:text-gray-50">Use of Funds</h1>
          <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider rounded-full px-2 py-0.5 bg-emerald-50 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">
            <Check size={10} /> Active
          </span>
        </div>
        <span className="ml-auto text-[11px] font-semibold text-violet-600 dark:text-violet-300 bg-violet-50 dark:bg-violet-900/30 border border-violet-200 dark:border-violet-800/60 rounded-full px-2.5 py-1">
          Unlocked · Wk {week}
        </span>
      </div>
      <p className="text-[12.5px] text-gray-500 dark:text-gray-400 -mt-2">
        Define capital allocation across the five deck categories — with what-if runway modeling. Your pitch deck's ASK slide reads this allocation live.
      </p>

      {/* Quick actions */}
      <div className="flex flex-wrap items-center gap-1 -mt-1" data-testid="uof-quick-actions">
        <button
          type="button"
          disabled
          title="Sharing isn't available yet — there's no share-link backend."
          data-testid="qa-share"
          className={QA_DISABLED}
        >
          <Share2 size={14} /> Share
        </button>
        <div className="relative">
          <button
            type="button"
            onClick={() => setExportOpen((v) => !v)}
            data-testid="qa-export"
            className={QA}
          >
            <Download size={14} className="text-gray-400" /> Export <ChevronDown size={12} className="text-gray-400" />
          </button>
          {exportOpen && (
            <>
              <div className="fixed inset-0 z-20" onClick={() => setExportOpen(false)} />
              <div className="absolute left-0 top-9 z-30 w-72 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-xl p-1.5" data-testid="export-menu">
                <button type="button" onClick={exportDeckJson} data-testid="export-deck" className={MENU_ITEM}>
                  <Presentation size={15} className="text-violet-500 shrink-0 mt-0.5" />
                  <span className="min-w-0">
                    Pitch Deck format
                    <span className="block text-[10.5px] font-normal text-gray-400 dark:text-gray-500">Downloads THE ASK slide data as JSON</span>
                  </span>
                </button>
                <button
                  type="button"
                  disabled
                  title="Requires the Axal export endpoint (not yet available)"
                  data-testid="export-axal"
                  className="flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left text-[12px] font-semibold text-gray-700 dark:text-gray-200 opacity-60 cursor-not-allowed"
                >
                  <Layers size={15} className="text-teal-600 shrink-0 mt-0.5" />
                  <span className="min-w-0">
                    Axal VC Spin-Out format
                    <span className="block text-[10.5px] font-normal text-gray-400 dark:text-gray-500">Requires the Axal export endpoint (not yet available)</span>
                  </span>
                </button>
              </div>
            </>
          )}
        </div>
        <button type="button" onClick={copyLink} data-testid="qa-copy-link" className={QA}>
          {copied
            ? <><Check size={14} className="text-emerald-500" /> Copied</>
            : <><Copy size={14} className="text-gray-400" /> Copy link</>}
        </button>
        <button
          type="button"
          onClick={() => { setPreviewOpen(true); setExportOpen(false); }}
          data-testid="qa-preview-investor"
          className={`${QA} !text-violet-600 dark:!text-violet-300`}
        >
          <Eye size={14} /> Preview as investor
        </button>
      </div>

      {/* Burn alert banner — live off the same months/threshold/largest math */}
      {alertActive && (
        <div className="flex items-center gap-3 rounded-2xl border border-rose-200 dark:border-rose-900/50 bg-rose-50 dark:bg-rose-900/20 px-4 py-3" data-testid="burn-alert">
          <AlertTriangle size={18} className="text-rose-600 dark:text-rose-400 shrink-0" />
          <p className="text-[12.5px] text-rose-800 dark:text-rose-300 leading-snug">
            <span className="font-bold">Runway below {threshold}-month threshold.</span>
            {driverBurn !== null && (
              <> {shortSection(largestIdx)} spend is your largest burn driver at {fmtRaise(driverBurn)}/mo — reallocating to lower-intensity buckets extends runway.</>
            )}
          </p>
        </div>
      )}

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
            <div className="flex justify-center mb-1.5">
              <Donut
                values={values}
                centerLabel={effectiveRaise ? fmtRaise(effectiveRaise) : '—'}
                onReallocate={canEdit ? applyValues : null}
              />
            </div>
            {canEdit && total === 100 && (
              <p className="text-[10px] text-gray-400 dark:text-gray-500 text-center mb-3">
                Drag the boundary handles to reallocate (3% minimum per bucket).
              </p>
            )}
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
            <FundAllocator
              values={values}
              total={total}
              valid={valid}
              onChange={canEdit ? onSlice : () => {}}
              onSliderChange={canEdit ? rebalance : () => {}}
            />
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

          {/* Runway card — border goes red when runway is under 6 months */}
          <div
            className={`rounded-2xl bg-white dark:bg-gray-900 border p-5 ${months !== null && months < 6 ? 'border-rose-300 dark:border-rose-800' : 'border-gray-200 dark:border-gray-700'}`}
            data-testid="card-runway"
          >
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
                    <div className="text-[12px] font-bold text-gray-900 dark:text-gray-50 truncate">{total > 0 ? shortSection(largestIdx) : '—'}</div>
                    <div className="text-[9.5px] text-gray-400">Largest driver</div>
                  </div>
                  <div>
                    <div className="text-[12px] font-bold text-gray-900 dark:text-gray-50">{cashOutLabel(months)}</div>
                    <div className="text-[9.5px] text-gray-400">Cash-out</div>
                  </div>
                </div>
                {driverBurn !== null && (
                  <p className="text-[9.5px] text-gray-400 dark:text-gray-500 mt-1.5 text-center">
                    Live — driver spend assumes burn follows your split ({shortSection(largestIdx)} ≈ {fmtRaise(driverBurn)}/mo).
                  </p>
                )}
                {/* Runway timeline vs thresholds (36-month scale, amber 6mo / red 3mo ticks) */}
                <div className="mt-3">
                  <div className="relative h-9">
                    <div className="absolute left-0 right-0 top-[13px] h-2 rounded-full bg-gray-100 dark:bg-gray-800 overflow-hidden">
                      <div
                        className={`h-full rounded-full ${BAND_STYLES[band].bar}`}
                        style={{ width: `${Math.min(100, (months / 36) * 100)}%` }}
                      />
                    </div>
                    {[
                      { mo: 6, line: 'bg-amber-500', text: 'text-amber-600 dark:text-amber-400' },
                      { mo: 3, line: 'bg-rose-500', text: 'text-rose-600 dark:text-rose-400' },
                    ].map((t) => (
                      <div key={t.mo} className="absolute top-0 -translate-x-1/2" style={{ left: `${(t.mo / 36) * 100}%` }} data-testid={`runway-tick-${t.mo}`}>
                        <div className={`w-0.5 h-6 mx-auto ${t.line}`} />
                        <div className={`font-mono tabular-nums text-[9px] font-semibold whitespace-nowrap ${t.text}`}>{t.mo}mo</div>
                      </div>
                    ))}
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
            <div className="flex items-center gap-2 mt-3 pt-3 border-t border-gray-100 dark:border-gray-800 flex-wrap">
              <span className="text-[11px] text-gray-500 dark:text-gray-400">Alert when below</span>
              {[6, 3, 12].map((t) => (
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

        {/* Right column: milestones honesty + scenarios + sync targets */}
        <div className="space-y-4">
          <div className={CARD} data-testid="card-milestone-mapping">
            <div className="flex items-center justify-between mb-2">
              <div className={LBL}>Milestone → capital mapping</div>
              <span className="text-[10px] text-gray-400">from Roadmap</span>
            </div>
            {/* Per-bucket capital headers from the live allocation (design's
                bucket rows). Dollars appear once a raise target is set. */}
            {total > 0 && (
              <div className="space-y-2 mb-3" data-testid="mapping-buckets">
                {FUND_SECTIONS.map((label, i) => (values[i] > 0 ? (
                  <div key={label} className="flex items-center justify-between pb-1.5 border-b border-gray-100 dark:border-gray-800">
                    <span className="inline-flex items-center gap-2 text-[12px] font-bold text-gray-700 dark:text-gray-200">
                      <span className={`w-2 h-2 rounded-sm ${SECTION_BG[i]} inline-block shrink-0`} />
                      {label}
                    </span>
                    <span className="text-[12px] font-bold text-gray-900 dark:text-gray-50 tabular-nums">
                      {effectiveRaise ? fmtRaise((values[i] / 100) * effectiveRaise) : `${values[i]}%`}
                    </span>
                  </div>
                ) : null))}
              </div>
            )}
            {/* The design's per-milestone rows (funded/underfunded icons, cost,
                efficiency, "Underfunded · orphaned deliverable" flags, and the
                unmapped-spend warning) need a cost/budget field on roadmap
                items. Neither spinout_lab_milestones (key/week/completed_at)
                nor roadmap_okrs (objective/KRs/status) carries one, so those
                numbers would be fabricated — the disclaimer stays until a
                cost field exists in the runtime. */}
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
              <div className="flex-1 min-w-0">
                <input
                  type="range" min={250000} max={3000000} step={50000}
                  value={scenarioRaise}
                  onChange={(e) => setCustomRaise(Number(e.target.value))}
                  className="w-full accent-violet-500"
                  data-testid="slider-custom-raise"
                />
                <div className="flex justify-between text-[9px] text-gray-400 font-mono tabular-nums -mt-0.5">
                  <span>$250K</span><span>$3M</span>
                </div>
              </div>
              <span className="text-[12px] font-extrabold text-violet-700 dark:text-violet-300 tabular-nums w-14 text-right" data-testid="text-custom-raise">{fmtRaise(scenarioRaise)}</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              {[...SCENARIOS, { key: 'custom', name: 'Custom', raise: scenarioRaise }].map((s) => {
                const m = runwayMonths(s.raise, burnN);
                const mBand = runwayBand(m);
                const isPreset = s.key !== 'custom';
                // Preset cards are buttons that set the custom raise; the
                // active card (matching the current scenario raise) gets the
                // violet border/background from the design.
                const active = isPreset
                  ? s.raise === scenarioRaise
                  : !SCENARIOS.some((p) => p.raise === scenarioRaise);
                const El = isPreset ? 'button' : 'div';
                return (
                  <El
                    key={s.key}
                    {...(isPreset ? { type: 'button', onClick: () => setCustomRaise(s.raise) } : {})}
                    className={`text-left rounded-xl border p-3 ${active
                      ? 'border-violet-400 dark:border-violet-600 bg-violet-50/60 dark:bg-violet-900/15'
                      : `border-gray-200 dark:border-gray-700 ${isPreset ? 'hover:border-violet-300 dark:hover:border-violet-700' : ''}`}`}
                    data-testid={`scenario-${s.key}`}
                  >
                    <div className="text-[11px] font-bold text-gray-500 dark:text-gray-400">{s.name}</div>
                    <div className="text-[15px] font-extrabold text-gray-900 dark:text-gray-50 tabular-nums mb-2">{fmtRaise(s.raise)}</div>
                    <div className="flex justify-between text-[11px]">
                      <span className="text-gray-400">Runway</span>
                      <span className={`font-bold tabular-nums ${m !== null ? BAND_STYLES[mBand].cls : 'text-gray-400'}`}>
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
                            <span className="text-gray-400 truncate mr-2">{shortSection(i)}</span>
                            <span className="tabular-nums text-gray-600 dark:text-gray-300">{fmtRaise((values[i] / 100) * s.raise)}</span>
                          </div>
                        ) : null))}
                      </div>
                    )}
                  </El>
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
            <div className={`${LBL} mb-3`}>Sync targets</div>
            <div className="space-y-3">
              {/* Pitch deck reads the saved fields directly — status is honest
                  ("reads live"), so the action is Open, not a fake Sync. */}
              <div className="flex items-center justify-between gap-3" data-testid="feeds-deck-row">
                <div className="flex items-center gap-2.5 min-w-0">
                  <span className="w-8 h-8 rounded-lg bg-violet-50 dark:bg-violet-900/30 text-violet-600 dark:text-violet-400 flex items-center justify-center shrink-0">
                    <Presentation size={15} />
                  </span>
                  <div className="min-w-0">
                    <div className="text-[12.5px] font-semibold text-gray-800 dark:text-gray-100">Pitch Deck · THE ASK slide</div>
                    <div className="text-[10.5px] text-gray-400 dark:text-gray-500">Reads live — allocation and ask flow into THE ASK slide automatically.</div>
                  </div>
                </div>
                <Link
                  to="/build/deck"
                  data-testid="feeds-deck"
                  className="text-[11.5px] font-bold text-white bg-violet-600 hover:bg-violet-700 rounded-lg px-3 py-1.5 whitespace-nowrap"
                >
                  Open
                </Link>
              </div>
              <div className="flex items-center justify-between gap-3" data-testid="feeds-scoring-row">
                <div className="flex items-center gap-2.5 min-w-0">
                  <span className="w-8 h-8 rounded-lg bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 flex items-center justify-center shrink-0">
                    <Gauge size={15} />
                  </span>
                  <div className="min-w-0">
                    <div className="text-[12.5px] font-semibold text-gray-800 dark:text-gray-100">Scoring Engine</div>
                    <div className="text-[10.5px] text-gray-400 dark:text-gray-500">Reads live — the scoring memo cites your saved use of funds.</div>
                  </div>
                </div>
                <Link
                  to="/spinout-lab/scoring"
                  data-testid="feeds-scoring"
                  className="text-[11.5px] font-bold text-gray-700 dark:text-gray-200 border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-1.5 whitespace-nowrap hover:border-violet-300 hover:text-violet-700 dark:hover:border-violet-700 dark:hover:text-violet-300"
                >
                  Open
                </Link>
              </div>
              {/* Axal export target — the endpoint doesn't exist yet, so the
                  button ships disabled with the reason instead of faking it. */}
              <div className="flex items-center justify-between gap-3" data-testid="feeds-axal-row">
                <div className="flex items-center gap-2.5 min-w-0">
                  <span className="w-8 h-8 rounded-lg bg-teal-50 dark:bg-teal-900/30 text-teal-600 dark:text-teal-400 flex items-center justify-center shrink-0">
                    <Layers size={15} />
                  </span>
                  <div className="min-w-0">
                    <div className="text-[12.5px] font-semibold text-gray-800 dark:text-gray-100">Axal VC 30-Day Spin-Out export</div>
                    <div className="text-[10.5px] text-gray-400 dark:text-gray-500">Not exported yet</div>
                  </div>
                </div>
                <button
                  type="button"
                  disabled
                  title="Requires the Axal export endpoint (not yet available)"
                  data-testid="button-axal-export"
                  className="text-[11.5px] font-bold text-teal-700 dark:text-teal-300 bg-teal-50 dark:bg-teal-900/30 border border-teal-200 dark:border-teal-800/60 rounded-lg px-3 py-1.5 whitespace-nowrap opacity-60 cursor-not-allowed"
                >
                  Export
                </button>
              </div>
            </div>
            <p className="text-[10.5px] text-gray-400 dark:text-gray-500 mt-3">
              Deck and scoring read the saved fields directly — no sync step. The Axal export needs a backend endpoint that doesn't exist yet.
            </p>
          </div>
        </div>
      </div>

      {/* Investor preview — renders the live local values only (no backend). */}
      {previewOpen && (
        <div
          className="fixed inset-0 z-50 bg-gray-950/50 backdrop-blur-[2px] overflow-y-auto p-4 sm:p-8"
          onClick={() => setPreviewOpen(false)}
          data-testid="investor-preview-overlay"
        >
          <div
            className="max-w-3xl mx-auto rounded-2xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 shadow-2xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
            data-testid="investor-preview-modal"
          >
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-gray-100 dark:border-gray-800">
              <div className="flex items-center gap-2 text-[13px] font-bold text-gray-900 dark:text-gray-50">
                <Eye size={14} className="text-violet-500" /> Investor preview · what an investor sees
              </div>
              <button
                type="button"
                onClick={() => setPreviewOpen(false)}
                data-testid="button-close-preview"
                className="w-7 h-7 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-500 hover:text-gray-900 dark:hover:text-gray-100 flex items-center justify-center"
              >
                <X size={14} />
              </button>
            </div>
            <div className="p-5 space-y-5">
              <div>
                <div className={`${LBL} mb-2`}>Pitch Deck · Use of Funds slide</div>
                <div className="rounded-xl bg-[#0d0d12] p-6 sm:p-8 text-white">
                  <div className="flex items-center justify-between gap-3 flex-wrap mb-6">
                    <div className="text-[20px] font-extrabold tracking-tight">Use of Funds</div>
                    <div className="text-[12px] font-mono tabular-nums text-violet-300">
                      {fmtRaise(effectiveRaise)}{months !== null ? ` · ${months.toFixed(1)}mo runway` : ''}
                    </div>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-[160px_1fr] gap-6 items-center">
                    <Donut values={values} centerLabel={effectiveRaise ? fmtRaise(effectiveRaise) : '—'} dark />
                    <div className="space-y-3.5 min-w-0">
                      {total > 0 ? FUND_SECTIONS.map((label, i) => (values[i] > 0 ? (
                        <div key={label}>
                          <div className="flex items-center justify-between gap-2 mb-1.5">
                            <span className="inline-flex items-center gap-2 text-[12.5px] font-semibold min-w-0">
                              <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: SECTION_COLORS[i] }} />
                              <span className="truncate">{label}</span>
                            </span>
                            <span className="text-[12px] font-mono tabular-nums text-gray-300 whitespace-nowrap">
                              {effectiveRaise ? `${fmtRaise((values[i] / 100) * effectiveRaise)} · ` : ''}{values[i]}%
                            </span>
                          </div>
                          <div className="h-2 rounded-full bg-white/10 overflow-hidden">
                            <div className="h-full rounded-full" style={{ width: `${values[i]}%`, background: SECTION_COLORS[i] }} />
                          </div>
                        </div>
                      ) : null)) : (
                        <p className="text-[12px] text-gray-400">No allocation set yet — investors would see an empty slide.</p>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              {/* The design's "Milestone efficiency" table is omitted: roadmap
                  milestones carry no cost fields in either runtime, so the
                  per-milestone capital figures would be fabricated. Add it
                  here once a cost/budget field exists. */}

              <div>
                <div className={`${LBL} mb-2`}>Axal VC 30-Day Spin-Out export</div>
                <div className="rounded-xl border border-teal-200 dark:border-teal-900/50 bg-teal-50 dark:bg-teal-900/20 p-4">
                  <div className="flex items-center gap-2.5 mb-3">
                    <span className="w-7 h-7 rounded-lg bg-teal-600 text-white flex items-center justify-center shrink-0">
                      <Layers size={14} />
                    </span>
                    <span className="text-[13px] font-extrabold text-teal-800 dark:text-teal-200">Capital Plan</span>
                  </div>
                  <div className="grid grid-cols-3 gap-3">
                    <div>
                      <div className="text-[10px] text-teal-700/70 dark:text-teal-300/70">Raise target</div>
                      <div className="text-[15px] font-extrabold text-teal-800 dark:text-teal-200 tabular-nums mt-0.5">{fmtRaise(effectiveRaise)}</div>
                    </div>
                    <div>
                      <div className="text-[10px] text-teal-700/70 dark:text-teal-300/70">Runway</div>
                      <div className="text-[15px] font-extrabold text-teal-800 dark:text-teal-200 tabular-nums mt-0.5">{months !== null ? `${months.toFixed(1)} mo` : '—'}</div>
                    </div>
                    <div>
                      <div className="text-[10px] text-teal-700/70 dark:text-teal-300/70">Monthly burn</div>
                      <div className="text-[15px] font-extrabold text-teal-800 dark:text-teal-200 tabular-nums mt-0.5">{burnN && burnN > 0 ? fmtRaise(burnN) : '—'}</div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
