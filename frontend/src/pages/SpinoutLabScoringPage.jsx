// Spin-Out Lab — Scoring Engine (design: Scoring_Engine.dc — composite
// readiness, dimension radar, weakest-first list, weak-point analysis,
// benchmark comparison, score trajectory).
//
// Real data only:
//   - Snapshots from GET /scoring/scores/:projectId?include_sandbox=1 — the
//     real venture-scoring engine (6 dimensions, not the design's fabricated
//     9): Market 25 · Team 20 · Product 15 · Capital 15 · Fit 15 ·
//     Distribution 10. Maxima sum to 100, so a dimension's max IS its weight%.
//   - Benchmark bars use the engine's real tier thresholds (Tier 2 ≥ 70,
//     Tier 1 ≥ 85) — the design's cohort median / percentile have no data
//     source and are not reproduced.
//   - Trajectory plots real snapshot history only; the design's dashed
//     future projection is not reproduced.
//   - Founders may run PRACTICE (sandbox) scores on their own project — the
//     API allows this explicitly; sandbox runs are never investor-visible.
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  ArrowLeft, ArrowRight, Gauge, Loader2, Lock, TrendingUp, AlertTriangle,
  Compass, Fingerprint, Map as MapIcon, MessagesSquare, Building2, Play,
} from 'lucide-react';
import { api, spinoutLab } from '../lib/api';
import { pickLabProject } from './SpinoutLabStartupPage';

// ---- Real engine constants (mirror backend/app/services/scoring.py and
// cloudflare-worker/src/services/scoring.ts) ----
export const TIER_THRESHOLDS = [
  { key: 'TIER_2', score: 70, label: 'Tier 2 — Conditional / Refine in Week 1' },
  { key: 'TIER_1', score: 85, label: 'Tier 1 — Immediate Spinout' },
];

export const TIER_LABELS = {
  TIER_1: 'Tier 1 — Immediate Spinout',
  TIER_2: 'Tier 2 — Conditional / Refine in Week 1',
  REJECT: 'Reject — Incubate Later',
};

// Sub-factor maxima mirror the engine's scoring functions exactly.
export const DIMENSIONS = [
  {
    key: 'market', label: 'Market', max: 25, icon: Compass,
    subs: [
      { col: 'market_size', label: 'Market size', max: 10 },
      { col: 'market_urgency', label: 'Urgency', max: 10 },
      { col: 'market_trend', label: 'Trend', max: 5 },
    ],
    fix: { to: '/spinout-lab/market', label: 'Open Market Intel', feature: 'market-intelligence' },
  },
  {
    key: 'team', label: 'Team', max: 20, icon: Fingerprint,
    subs: [
      { col: 'team_expertise', label: 'Expertise', max: 8 },
      { col: 'team_execution', label: 'Execution', max: 8 },
      { col: 'team_network', label: 'Network', max: 4 },
    ],
    fix: { to: '/spinout-lab/profiling', label: 'Open Profiling', feature: 'profiling' },
  },
  {
    key: 'product', label: 'Product', max: 15, icon: MapIcon,
    subs: [
      { col: 'product_mvp_time', label: 'MVP speed', max: 7 },
      { col: 'product_complexity', label: 'Complexity', max: 5 },
      { col: 'product_dependency', label: 'Dependencies', max: 3 },
    ],
    fix: { to: '/spinout-lab/roadmap', label: 'Open Roadmap', feature: 'roadmap' },
  },
  {
    key: 'capital', label: 'Capital', max: 15, icon: Gauge,
    subs: [
      { col: 'capital_cost_mvp', label: 'Cost to MVP', max: 7 },
      { col: 'capital_time_revenue', label: 'Time to revenue', max: 5 },
      { col: 'capital_burn_traction', label: 'Burn discipline', max: 3 },
    ],
    // No founder-facing capital surface exists yet (Week-4 tooling) — the
    // row states that instead of dead-linking.
    fix: null,
    fixNote: 'Capital tooling unlocks in Week 4',
  },
  {
    key: 'fit', label: 'Axal Fit', max: 15, icon: Building2,
    subs: [
      { col: 'fit_alignment', label: 'Strategic alignment', max: 10 },
      { col: 'fit_synergy', label: 'Partner synergy', max: 5 },
    ],
    fix: { to: '/spinout-lab/startup', label: 'Open Startups', feature: 'projects' },
  },
  {
    key: 'distribution', label: 'Distribution', max: 10, icon: MessagesSquare,
    subs: [
      { col: 'distribution_channels', label: 'Channels', max: 5 },
      { col: 'distribution_virality', label: 'Virality', max: 5 },
    ],
    fix: { to: '/spinout-lab/discovery', label: 'Open Customer Discovery', feature: 'customer-discovery' },
  },
];

// Level bands align Low/Medium/High with the engine's Tier-2 composite
// threshold (70) — Medium starts at 50 to split the sub-Tier-2 range.
export function levelFor(pct) {
  if (pct >= 70) return 'High';
  if (pct >= 50) return 'Medium';
  return 'Low';
}

const LEVEL_TEXT = { Low: 'text-rose-600 dark:text-rose-400', Medium: 'text-amber-600 dark:text-amber-500', High: 'text-emerald-600 dark:text-emerald-400' };
const LEVEL_BG = { Low: 'bg-rose-50 dark:bg-rose-900/30', Medium: 'bg-amber-50 dark:bg-amber-900/30', High: 'bg-emerald-50 dark:bg-emerald-900/30' };
const LEVEL_BAR = { Low: 'bg-rose-500', Medium: 'bg-amber-500', High: 'bg-emerald-500' };

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

// Per-dimension rows from a real snapshot, weakest first.
export function buildDimensions(snapshot) {
  if (!snapshot) return [];
  return DIMENSIONS.map((d) => {
    const total = num(snapshot[`${d.key}_total`]);
    const pct = Math.max(0, Math.min(100, Math.round((total / d.max) * 100)));
    const subs = d.subs.map((s) => ({ ...s, points: num(snapshot[s.col]) }));
    return {
      ...d,
      total,
      pct,
      level: levelFor(pct),
      pointsAvailable: Math.max(0, Math.round((d.max - total) * 10) / 10),
      subs,
      // The weakest sub-factor drives the weak-point copy — real data, not
      // the design's invented narratives.
      weakestSub: [...subs].sort((a, b) => a.points / a.max - b.points / b.max)[0] || null,
    };
  }).sort((a, b) => a.pct - b.pct);
}

// Chronological real history for the trajectory chart.
export function buildTrajectory(snapshots) {
  return (Array.isArray(snapshots) ? snapshots : [])
    .filter((s) => s && Number.isFinite(Number(s.total_score)) && s.created_at)
    .map((s) => ({
      score: Math.max(0, Math.min(100, Number(s.total_score))),
      date: s.created_at,
      sandbox: !!s.is_sandbox,
    }))
    .sort((a, b) => new Date(a.date) - new Date(b.date));
}

const fmtDate = (d) => {
  const t = new Date(d);
  return Number.isNaN(t.getTime()) ? '' : t.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
};

const CARD = 'rounded-2xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 p-5';
const LBL = 'text-[11px] font-bold uppercase tracking-wider text-gray-400 dark:text-gray-500';

function Radar({ dims }) {
  // Hexagonal radar over the 6 real dimensions (pct of each dimension max).
  const cx = 130; const cy = 120; const R = 88;
  const ordered = DIMENSIONS.map((d) => dims.find((x) => x.key === d.key)).filter(Boolean);
  const n = ordered.length;
  const pt = (i, r) => {
    const a = (Math.PI * 2 * i) / n - Math.PI / 2;
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
  };
  const ring = (f) => ordered.map((_, i) => pt(i, R * f).join(',')).join(' ');
  const poly = ordered.map((d, i) => pt(i, (R * d.pct) / 100).join(',')).join(' ');
  return (
    <svg viewBox="0 0 260 240" className="w-full" role="img" aria-label="Dimension radar" data-testid="scoring-radar">
      {[0.25, 0.5, 0.75, 1].map((f) => (
        <polygon key={f} points={ring(f)} fill="none" className="stroke-gray-200 dark:stroke-gray-700" strokeWidth="1" />
      ))}
      {ordered.map((_, i) => {
        const [x, y] = pt(i, R);
        return <line key={i} x1={cx} y1={cy} x2={x} y2={y} className="stroke-gray-200 dark:stroke-gray-700" strokeWidth="1" />;
      })}
      <polygon points={poly} fill="rgba(124,58,237,0.18)" stroke="#7c3aed" strokeWidth="2" strokeLinejoin="round" />
      {ordered.map((d, i) => {
        const [x, y] = pt(i, (R * d.pct) / 100);
        return <circle key={d.key} cx={x} cy={y} r="3" fill="#7c3aed" />;
      })}
      {ordered.map((d, i) => {
        const [x, y] = pt(i, R + 18);
        return (
          <text key={d.key} x={x} y={y} textAnchor="middle" dominantBaseline="middle" className="fill-gray-500 dark:fill-gray-400" fontSize="9.5" fontWeight="600">
            {d.label}
          </text>
        );
      })}
    </svg>
  );
}

function Trajectory({ points }) {
  // Real history only — no projected dashed future line (no data source).
  const W = 560; const H = 180; const P = { l: 30, r: 16, t: 18, b: 26 };
  const xs = points.map((p) => new Date(p.date).getTime());
  const minX = Math.min(...xs); const maxX = Math.max(...xs);
  const span = Math.max(1, maxX - minX);
  const x = (t) => P.l + ((t - minX) / span) * (W - P.l - P.r);
  const y = (s) => P.t + (1 - s / 100) * (H - P.t - P.b);
  const line = points.map((p) => `${x(new Date(p.date).getTime())},${y(p.score)}`).join(' ');
  const target = TIER_THRESHOLDS[0];
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Score trajectory" data-testid="scoring-trajectory">
      <line x1={P.l} y1={y(target.score)} x2={W - P.r} y2={y(target.score)} stroke="#10b981" strokeWidth="1.5" strokeDasharray="5 4" />
      <text x={W - P.r} y={y(target.score) - 6} textAnchor="end" fontSize="10.5" fontWeight="700" fill="#10b981">
        Tier 2 threshold · {target.score}
      </text>
      {points.length > 1 && <polyline points={line} fill="none" stroke="#7c3aed" strokeWidth="2.5" strokeLinejoin="round" />}
      {points.map((p, i) => (
        <g key={i}>
          <circle cx={x(new Date(p.date).getTime())} cy={y(p.score)} r="4.5" fill="#7c3aed" stroke="white" strokeWidth="1.5" />
          <text x={x(new Date(p.date).getTime())} y={y(p.score) - 9} textAnchor="middle" fontSize="10" fontWeight="700" className="fill-gray-700 dark:fill-gray-200">
            {p.score}
          </text>
          <text x={x(new Date(p.date).getTime())} y={H - 8} textAnchor="middle" fontSize="9.5" className="fill-gray-400">
            {fmtDate(p.date)}
          </text>
        </g>
      ))}
    </svg>
  );
}

// ---- Practice-run form (sandbox scoring — the real engine inputs) ----
const FORM_GROUPS = [
  {
    label: 'Market', fields: [
      { key: 'tam', label: 'TAM (USD)', kind: 'number', min: 0, step: 1_000_000, placeholder: 'e.g. 500000000', hint: '≥$1B scores 10 · ≥$500M scores 8 · ≥$100M scores 7' },
      { key: 'market_urgency', label: 'Problem urgency', kind: 'range', min: 0, max: 10 },
      { key: 'market_trend', label: 'Trend tailwind', kind: 'range', min: 0, max: 5 },
    ],
  },
  {
    label: 'Team', fields: [
      { key: 'team_expertise', label: 'Domain expertise', kind: 'range', min: 0, max: 8 },
      { key: 'team_execution', label: 'Execution record', kind: 'range', min: 0, max: 8 },
      { key: 'team_network', label: 'Network strength', kind: 'range', min: 0, max: 4 },
    ],
  },
  {
    label: 'Product', fields: [
      { key: 'mvp_time_days', label: 'Days to MVP', kind: 'number', min: 0, step: 1, placeholder: 'e.g. 30', hint: '≤14 days scores best' },
      { key: 'product_complexity', label: 'Build complexity (higher = riskier)', kind: 'range', min: 0, max: 5 },
      { key: 'product_dependencies', label: 'Hard external dependencies', kind: 'range', min: 0, max: 3 },
    ],
  },
  {
    label: 'Capital', fields: [
      { key: 'cost_to_mvp', label: 'Cost to MVP (USD)', kind: 'number', min: 0, step: 1000, placeholder: 'e.g. 40000', hint: '<$25k scores best' },
      { key: 'time_to_revenue_months', label: 'Months to first revenue', kind: 'number', min: 0, step: 1, placeholder: 'e.g. 6' },
      { key: 'burn_risk', label: 'Burn risk (higher = riskier)', kind: 'range', min: 0, max: 3 },
    ],
  },
  {
    label: 'Axal Fit', fields: [
      { key: 'fit_alignment', label: 'Strategic alignment', kind: 'range', min: 0, max: 10 },
      { key: 'fit_synergy', label: 'Partner synergy', kind: 'range', min: 0, max: 5 },
    ],
  },
  {
    label: 'Distribution', fields: [
      { key: 'distribution_channels', label: 'Channel access', kind: 'range', min: 0, max: 5 },
      { key: 'distribution_virality', label: 'Built-in virality', kind: 'range', min: 0, max: 5 },
    ],
  },
];

const FORM_DEFAULTS = Object.fromEntries(
  FORM_GROUPS.flatMap((g) => g.fields.map((f) => [f.key, f.kind === 'range' ? Math.round((f.max ?? 10) / 2) : ''])),
);

export default function SpinoutLabScoringPage() {
  const navigate = useNavigate();
  const [status, setStatus] = useState('loading'); // loading | ready | error
  const [state, setState] = useState(null);
  const [project, setProject] = useState(null);
  const [snapshots, setSnapshots] = useState([]);
  const [scoresError, setScoresError] = useState(false);
  const [user, setUser] = useState(null);
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState(FORM_DEFAULTS);
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState('');

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
        if (proj && (st?.unlocked_features || []).includes('scoring')) {
          // Honest states: a failed fetch is "couldn't load", never a silent
          // empty history that pretends no run happened.
          const scores = await api.getScores(proj.id, { includeSandbox: true }).catch(() => null);
          if (dead) return;
          if (Array.isArray(scores)) setSnapshots(scores);
          else setScoresError(true);
        }
        setStatus('ready');
      } catch (e) {
        console.error('[spinout-scoring]', e);
        if (!dead) setStatus('error');
      }
    })();
    return () => { dead = true; };
  }, []);

  // NOTE: computed before the early-return gates below; must not reference
  // bindings declared later (a `const isAdmin` further down caused a TDZ crash).
  const unlocked = user?.role === 'admin' || (state?.unlocked_features || []).includes('scoring');
  const latest = snapshots.length ? snapshots[0] : null; // API returns newest first
  const dims = useMemo(() => buildDimensions(latest), [latest]);
  const trajectory = useMemo(() => buildTrajectory(snapshots), [snapshots]);
  const composite = latest ? Math.max(0, Math.min(100, num(latest.total_score))) : null;
  const delta = trajectory.length > 1 ? trajectory[trajectory.length - 1].score - trajectory[trajectory.length - 2].score : null;
  const weakPoints = dims.filter((d) => d.pct < 70).slice(0, 4);
  const tierLabel = latest ? TIER_LABELS[latest.tier] || latest.tier : null;

  const runPractice = async (e) => {
    e.preventDefault();
    if (!project || running) return;
    setRunning(true);
    setRunError('');
    try {
      const payload = { project_id: project.id, is_sandbox: true, startup_name: project.name || '' };
      for (const g of FORM_GROUPS) {
        for (const f of g.fields) {
          const v = Number(form[f.key]);
          payload[f.key] = Number.isFinite(v) ? v : 0;
        }
      }
      await api.scoreStartup(payload);
      // Completing a scoring run is a Week-3 lab milestone — but lab
      // milestones are user-scoped, so only the project's own founder marks
      // it (same ownership guard as the roadmap OKR milestone).
      if (user?.founder_id && project?.founder_id && user.founder_id === project.founder_id) {
        try { await spinoutLab.complete('scoring_run_completed'); } catch (err) { console.warn('[spinout-scoring:milestone]', err); }
      }
      // If the post-run refresh fails, keep the history we already have
      // rather than wiping it to a fake empty state.
      const scores = await api.getScores(project.id, { includeSandbox: true }).catch(() => null);
      if (Array.isArray(scores)) {
        setSnapshots(scores);
        setScoresError(false);
        // Optional W3 deliverable — ≥70% confidence on 5+ of the 6 real
        // dimensions in the fresh snapshot.
        const fresh = scores[0];
        if (fresh && user?.founder_id && project?.founder_id && user.founder_id === project.founder_id) {
          const strong = buildDimensions(fresh).filter((d) => d.pct >= 70).length;
          if (strong >= 5) {
            try { await spinoutLab.complete('scoring_confidence_70'); } catch (err) { console.warn('[spinout-scoring:milestone70]', err); }
          }
        }
      }
      setFormOpen(false);
    } catch (err) {
      console.error('[spinout-scoring:run]', err);
      setRunError(err?.data?.detail || err?.message || 'Scoring run failed.');
    } finally {
      setRunning(false);
    }
  };

  if (status === 'loading') {
    return (
      <div className="flex items-center justify-center py-24" data-testid="scoring-loading">
        <Loader2 className="w-6 h-6 animate-spin text-violet-600" />
      </div>
    );
  }
  if (status === 'error') {
    return (
      <div className="max-w-3xl mx-auto px-4 py-16 text-center" data-testid="scoring-error">
        <p className="text-sm text-rose-500 mb-3">The Scoring Engine couldn't be loaded right now.</p>
        <Link to="/spinout-lab" className="text-sm font-semibold text-violet-600 dark:text-violet-400">Back to Workspace</Link>
      </div>
    );
  }
  const isAdmin = user?.role === 'admin';
  if (!state?.active && !isAdmin) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-16 text-center" data-testid="scoring-inactive">
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-3">The Scoring Engine is part of the Spin-Out Lab sprint.</p>
        <Link to="/spinout-lab" className="text-sm font-semibold text-violet-600 dark:text-violet-400">Open the Spin-Out Lab →</Link>
      </div>
    );
  }
  if (!isAdmin && !unlocked) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-16 text-center" data-testid="scoring-locked">
        <span className="inline-flex items-center justify-center w-12 h-12 rounded-2xl bg-gray-100 dark:bg-gray-800 text-gray-400 mb-4"><Lock size={20} /></span>
        <h1 className="text-lg font-bold text-gray-900 dark:text-gray-50 mb-1.5">Scoring Engine unlocks in Week 3</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
          You're in Week {state?.week || 1}. Finish your Week-{Math.max(1, (state?.week || 1))} deliverables to advance.
        </p>
        <Link to="/spinout-lab" className="text-sm font-semibold text-violet-600 dark:text-violet-400">Back to Workspace →</Link>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto px-4 py-6 space-y-4" data-testid="page-spinout-scoring">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" onClick={() => navigate('/spinout-lab')} data-testid="button-back-workspace"
          className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-gray-600 dark:text-gray-300 border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-1.5 bg-white dark:bg-gray-900 hover:bg-gray-50 dark:hover:bg-gray-800">
          <ArrowLeft size={14} /> Back to Workspace
        </button>
        <div className="flex items-center gap-2">
          <h1 className="text-lg font-extrabold tracking-tight text-gray-900 dark:text-gray-50">Scoring Engine</h1>
          <span className="text-[10px] font-bold uppercase tracking-wide text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-900/40 rounded-full px-2 py-0.5">Active</span>
        </div>
        <span className="ml-auto text-[10.5px] font-bold text-violet-700 dark:text-violet-300 bg-violet-50 dark:bg-violet-900/40 rounded-full px-2.5 py-1">Diligence · Wk 3</span>
      </div>
      <p className="text-[12.5px] text-gray-500 dark:text-gray-400 -mt-2">
        Structured scoring of venture readiness across all key dimensions before investor outreach.
      </p>

      {scoresError ? (
        <div className={`${CARD} text-center py-12`} data-testid="scoring-scores-error">
          <AlertTriangle className="w-8 h-8 text-amber-400 mx-auto mb-3" />
          <h2 className="text-[15px] font-bold text-gray-900 dark:text-gray-50 mb-1">Couldn't load your scoring history</h2>
          <p className="text-[12.5px] text-gray-500 dark:text-gray-400 max-w-md mx-auto">
            Your past runs may exist but couldn't be fetched right now. Reload the page to try again.
          </p>
        </div>
      ) : !latest ? (
        <div className={`${CARD} text-center py-12`} data-testid="scoring-empty">
          <Gauge className="w-8 h-8 text-gray-300 dark:text-gray-600 mx-auto mb-3" />
          <h2 className="text-[15px] font-bold text-gray-900 dark:text-gray-50 mb-1">No scoring run yet</h2>
          <p className="text-[12.5px] text-gray-500 dark:text-gray-400 mb-4 max-w-md mx-auto">
            Run a practice score to see your composite readiness, dimension breakdown, and how far you are from the
            Tier 2 investor threshold ({TIER_THRESHOLDS[0].score}). Practice runs are never investor-visible.
          </p>
          <button type="button" onClick={() => setFormOpen(true)} data-testid="button-open-practice-run"
            className="h-10 px-4 rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-sm font-semibold inline-flex items-center gap-1.5">
            <Play size={14} /> Run a practice score
          </button>
        </div>
      ) : (
        <>
          {/* Top grid: composite + radar | dimensions weakest-first */}
          <div className="grid lg:grid-cols-[280px,1fr] gap-4 items-start">
            <div className="space-y-4">
              <div className={CARD} data-testid="card-composite">
                <div className={`${LBL} mb-3`}>Composite readiness</div>
                <div className="flex items-end gap-2">
                  <span className="text-[44px] leading-none font-extrabold text-gray-900 dark:text-gray-50 tabular-nums" data-testid="text-composite-score">{composite}</span>
                  <span className="text-[12px] text-gray-400 mb-1.5">out of 100</span>
                  {delta != null && delta !== 0 && (
                    <span className={`mb-1.5 ml-auto text-[10.5px] font-bold rounded-full px-2 py-0.5 ${delta > 0 ? 'text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-900/40' : 'text-rose-700 dark:text-rose-300 bg-rose-50 dark:bg-rose-900/40'}`} data-testid="chip-composite-delta">
                      {delta > 0 ? '+' : ''}{delta} since last run
                    </span>
                  )}
                </div>
                <div className="mt-3 space-y-1.5 text-[11.5px]">
                  <div className="flex justify-between gap-2">
                    <span className="text-gray-400">Tier</span>
                    <span className="font-semibold text-gray-700 dark:text-gray-200 text-right" data-testid="text-tier-label">{tierLabel}</span>
                  </div>
                  <div className="flex justify-between gap-2">
                    <span className="text-gray-400">Run type</span>
                    <span className="font-semibold text-gray-700 dark:text-gray-200" data-testid="text-run-type">
                      {latest.is_sandbox ? 'Practice — not investor-visible' : 'Official — signed & audited'}
                    </span>
                  </div>
                  <div className="flex justify-between gap-2">
                    <span className="text-gray-400">Last run</span>
                    <span className="font-semibold text-gray-700 dark:text-gray-200">{fmtDate(latest.created_at)}</span>
                  </div>
                </div>
                <button type="button" onClick={() => setFormOpen((v) => !v)} data-testid="button-open-practice-run"
                  className="mt-4 w-full h-9 rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-[12.5px] font-semibold inline-flex items-center justify-center gap-1.5">
                  <Play size={13} /> Run a practice score
                </button>
              </div>

              <div className={CARD} data-testid="card-radar">
                <div className={`${LBL} mb-1`}>Dimension radar</div>
                <p className="text-[10.5px] text-gray-400 dark:text-gray-500 mb-2">Each axis = % of that dimension's weighted maximum.</p>
                <Radar dims={dims} />
              </div>
            </div>

            {/* Dimensions weakest first */}
            <div className={CARD} data-testid="card-dimensions">
              <div className="flex items-center justify-between mb-3">
                <div className={LBL}>Dimensions · weakest first</div>
                <span className="text-[10.5px] text-gray-400">{dims.length} dimensions · weights are engine maxima</span>
              </div>
              <div className="space-y-2.5">
                {dims.map((d) => {
                  const Icon = d.icon;
                  const fixUnlocked = d.fix && (!d.fix.feature || (state?.unlocked_features || []).includes(d.fix.feature));
                  return (
                    <div key={d.key} className="rounded-xl border border-gray-100 dark:border-gray-800 p-3.5" data-testid={`dimension-row-${d.key}`}>
                      <div className="flex items-center gap-2.5">
                        <span className="w-7 h-7 flex-none rounded-lg bg-violet-50 dark:bg-violet-900/30 text-violet-600 dark:text-violet-400 flex items-center justify-center"><Icon size={14} /></span>
                        <span className="text-[13px] font-bold text-gray-900 dark:text-gray-50">{d.label}</span>
                        <span className="text-[10.5px] font-semibold text-gray-400">{d.max}%</span>
                        <span className={`text-[10px] font-bold rounded-md px-1.5 py-0.5 ${LEVEL_BG[d.level]} ${LEVEL_TEXT[d.level]}`}>{d.level}</span>
                        <span className={`ml-auto text-[13px] font-extrabold tabular-nums ${LEVEL_TEXT[d.level]}`} data-testid={`score-${d.key}`}>{d.pct}</span>
                      </div>
                      <div className="mt-2 h-1.5 rounded-full bg-gray-100 dark:bg-gray-800 overflow-hidden">
                        <div className={`h-full rounded-full ${LEVEL_BAR[d.level]}`} style={{ width: `${d.pct}%` }} />
                      </div>
                      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
                        <span className="text-[11px] text-gray-500 dark:text-gray-400">
                          {d.subs.map((s) => `${s.label} ${s.points}/${s.max}`).join(' · ')}
                        </span>
                        {d.fix ? (
                          fixUnlocked ? (
                            <Link to={d.fix.to} className="ml-auto text-[11.5px] font-bold text-violet-600 dark:text-violet-400 inline-flex items-center gap-1" data-testid={`link-fix-${d.key}`}>
                              Fix it <ArrowRight size={12} />
                            </Link>
                          ) : (
                            <span className="ml-auto text-[11px] text-gray-400 inline-flex items-center gap-1"><Lock size={11} /> {d.fix.label} locked</span>
                          )
                        ) : (
                          <span className="ml-auto text-[11px] text-gray-400 inline-flex items-center gap-1"><Lock size={11} /> {d.fixNote}</span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Bottom grid: weak points | benchmark + trajectory */}
          <div className="grid lg:grid-cols-[1.2fr,1fr] gap-4 items-start">
            <div className={CARD} data-testid="card-weak-points">
              <div className={`${LBL} mb-1`}>Weak-point analysis</div>
              <p className="text-[11px] text-gray-400 dark:text-gray-500 mb-3">Points still on the table per dimension — real engine math, not estimates.</p>
              {weakPoints.length ? (
                <div className="space-y-2.5">
                  {weakPoints.map((d, i) => {
                    const fixUnlocked = d.fix && (!d.fix.feature || (state?.unlocked_features || []).includes(d.fix.feature));
                    return (
                      <div key={d.key} className="flex items-start gap-3 rounded-xl border border-gray-100 dark:border-gray-800 p-3" data-testid={`weakpoint-${d.key}`}>
                        <span className={`w-6 h-6 flex-none rounded-lg text-[11.5px] font-extrabold flex items-center justify-center ${LEVEL_BG[d.level]} ${LEVEL_TEXT[d.level]}`}>{i + 1}</span>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-[12.5px] font-bold text-gray-900 dark:text-gray-50">{d.label}</span>
                            <span className="text-[10.5px] font-bold text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-900/40 rounded-full px-2 py-0.5">+{d.pointsAvailable} pts available</span>
                          </div>
                          <p className="text-[11.5px] text-gray-500 dark:text-gray-400 mt-0.5">
                            {d.weakestSub
                              ? `Weakest input: ${d.weakestSub.label.toLowerCase()} at ${d.weakestSub.points}/${d.weakestSub.max}.`
                              : 'All inputs below their maxima.'}
                          </p>
                        </div>
                        {d.fix && fixUnlocked && (
                          <Link to={d.fix.to} className="flex-none text-[11.5px] font-bold text-violet-600 dark:text-violet-400 border border-violet-200 dark:border-violet-800 rounded-lg px-2.5 py-1.5 hover:bg-violet-50 dark:hover:bg-violet-900/30" data-testid={`link-weakpoint-${d.key}`}>
                            {d.fix.label} →
                          </Link>
                        )}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="text-[12.5px] text-gray-500 dark:text-gray-400 py-4 text-center" data-testid="weakpoints-clear">
                  Every dimension is at High level — no weak points at the current thresholds.
                </p>
              )}
            </div>

            <div className="space-y-4">
              <div className={CARD} data-testid="card-benchmark">
                <div className={`${LBL} mb-1`}>Benchmark comparison</div>
                <p className="text-[11px] text-gray-400 dark:text-gray-500 mb-3">
                  Against the engine's real tier thresholds — cohort medians aren't tracked yet.
                </p>
                <div className="space-y-3">
                  {[
                    { label: 'Your composite', value: composite, color: 'bg-violet-600', testid: 'bench-you' },
                    { label: TIER_THRESHOLDS[0].label, value: TIER_THRESHOLDS[0].score, color: 'bg-emerald-500', testid: 'bench-tier2' },
                    { label: TIER_THRESHOLDS[1].label, value: TIER_THRESHOLDS[1].score, color: 'bg-gray-400 dark:bg-gray-500', testid: 'bench-tier1' },
                  ].map((row) => (
                    <div key={row.testid} data-testid={row.testid}>
                      <div className="flex justify-between mb-1">
                        <span className="text-[11.5px] font-semibold text-gray-600 dark:text-gray-300">{row.label}</span>
                        <span className="text-[11.5px] font-bold text-gray-900 dark:text-gray-50 tabular-nums">{row.value}</span>
                      </div>
                      <div className="h-2 rounded-full bg-gray-100 dark:bg-gray-800 overflow-hidden">
                        <div className={`h-full rounded-full ${row.color}`} style={{ width: `${row.value}%` }} />
                      </div>
                    </div>
                  ))}
                </div>
                <p className="text-[10.5px] text-gray-400 dark:text-gray-500 mt-3" data-testid="text-benchmark-gap">
                  {composite >= TIER_THRESHOLDS[1].score
                    ? 'At Tier 1 — immediate spinout territory.'
                    : composite >= TIER_THRESHOLDS[0].score
                      ? `${TIER_THRESHOLDS[1].score - composite} points from Tier 1.`
                      : `${TIER_THRESHOLDS[0].score - composite} points from the Tier 2 threshold.`}
                </p>
              </div>

              <div className={CARD} data-testid="card-trajectory">
                <div className="flex items-center gap-2 mb-1">
                  <div className={LBL}>Score trajectory</div>
                  {delta != null && delta > 0 && (
                    <span className="text-[10.5px] font-bold text-emerald-600 dark:text-emerald-400 inline-flex items-center gap-1"><TrendingUp size={11} /> improving</span>
                  )}
                </div>
                <p className="text-[11px] text-gray-400 dark:text-gray-500 mb-2">Real run history — no projected pace.</p>
                {trajectory.length > 1 ? (
                  <Trajectory points={trajectory} />
                ) : (
                  <p className="text-[12px] text-gray-500 dark:text-gray-400 py-6 text-center" data-testid="trajectory-single">
                    One run so far ({trajectory[0] ? `${trajectory[0].score} on ${fmtDate(trajectory[0].date)}` : '—'}). Run again after improvements to see a trajectory.
                  </p>
                )}
              </div>
            </div>
          </div>
        </>
      )}

      {/* Practice-run form */}
      {formOpen && (
        <form onSubmit={runPractice} className={CARD} data-testid="card-practice-form">
          <div className="flex items-center justify-between mb-1">
            <div className={LBL}>Practice scoring run</div>
            <span className="text-[10.5px] font-bold text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/30 rounded-full px-2 py-0.5">Sandbox — never investor-visible</span>
          </div>
          <p className="text-[11.5px] text-gray-400 dark:text-gray-500 mb-4">
            The same inputs partners use for official diligence. Be honest — the score only helps if the inputs are real.
          </p>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-4">
            {FORM_GROUPS.map((g) => (
              <div key={g.label}>
                <div className="text-[10.5px] font-bold uppercase tracking-wide text-violet-600 dark:text-violet-400 mb-2">{g.label}</div>
                <div className="space-y-2.5">
                  {g.fields.map((f) => (
                    <label key={f.key} className="block">
                      <span className="flex justify-between text-[11px] font-semibold text-gray-600 dark:text-gray-300 mb-1">
                        {f.label}
                        {f.kind === 'range' && <span className="tabular-nums text-gray-400">{form[f.key]}/{f.max}</span>}
                      </span>
                      {f.kind === 'range' ? (
                        <input type="range" min={f.min} max={f.max} step={1} value={form[f.key]}
                          onChange={(e) => setForm((p) => ({ ...p, [f.key]: Number(e.target.value) }))}
                          className="w-full accent-violet-600" data-testid={`input-${f.key}`} />
                      ) : (
                        <input type="number" min={f.min} step={f.step} value={form[f.key]} placeholder={f.placeholder} required
                          onChange={(e) => setForm((p) => ({ ...p, [f.key]: e.target.value }))}
                          className="w-full h-9 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-2.5 text-[12.5px] text-gray-900 dark:text-gray-100"
                          data-testid={`input-${f.key}`} />
                      )}
                      {f.hint && <span className="block text-[10px] text-gray-400 mt-0.5">{f.hint}</span>}
                    </label>
                  ))}
                </div>
              </div>
            ))}
          </div>
          {runError && (
            <p className="mt-3 text-[12px] text-rose-500 inline-flex items-center gap-1.5" data-testid="text-run-error">
              <AlertTriangle size={13} /> {runError}
            </p>
          )}
          <div className="mt-4 flex gap-2.5">
            <button type="submit" disabled={running} data-testid="button-submit-practice-run"
              className="h-10 px-4 rounded-xl bg-violet-600 hover:bg-violet-700 disabled:opacity-60 text-white text-sm font-semibold inline-flex items-center gap-1.5">
              {running ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />} Score it
            </button>
            <button type="button" onClick={() => setFormOpen(false)} data-testid="button-cancel-practice-run"
              className="h-10 px-4 rounded-xl border border-gray-200 dark:border-gray-700 text-sm font-semibold text-gray-600 dark:text-gray-300">
              Cancel
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
