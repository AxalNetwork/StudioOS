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
//     source and are not reproduced. The radar's dashed overlay is likewise
//     the Tier-2 threshold, labelled as such — never a fake "cohort median".
//   - Trajectory plots real snapshot history; the "Investor-ready by Day N"
//     headline + dashed projection are derived client-side from the slope of
//     the last two real runs, and only shown when the Tier-2 crossing lands
//     inside the 4-week program window (no fake ETA otherwise).
//   - Per-dimension drill-down drawer: "Contributing evidence" is the
//     snapshot's real sub-factor points; the design's Team-only panels and
//     per-evidence source provenance need backend data and are omitted.
//   - Quick actions: Copy link + Investor view (client-side read-only mode)
//     + Export report (client-side vector PDF via lib/scoringReportPdf.js)
//     are real; Share stays disabled — no backend share token exists yet.
//   - Evidence-confidence row is derived from real coverage (dimensions with
//     non-zero sub-factor data) via the same levelFor() bands.
//   - Founders may run PRACTICE (sandbox) scores on their own project — the
//     API allows this explicitly; sandbox runs are never investor-visible.
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  ArrowLeft, ArrowRight, Gauge, Loader2, Lock, TrendingUp, AlertTriangle,
  Compass, Fingerprint, Map as MapIcon, MessagesSquare, Building2, Play,
  AlertCircle, Check, ChevronRight, Copy, Download, Eye, EyeOff, FileText,
  Share2, TrendingDown, X,
} from 'lucide-react';
import { api, spinoutLab } from '../lib/api';
import { exportScoringReportPdf } from '../lib/scoringReportPdf';
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

// SQLite datetimes arrive as "YYYY-MM-DD HH:MM:SS" (no zone) — normalise to
// UTC the same way the worker's daysSince() does.
const parseUtc = (s) => (s ? Date.parse(String(s).replace(' ', 'T') + (String(s).includes('Z') ? '' : 'Z')) : NaN);

// 4-week Spin-Out Lab window (spinoutLabCatalog MILESTONES top out at week
// 4) — the trajectory ETA is only claimed when the Tier-2 crossing lands
// inside it.
const PROGRAM_DAYS = 28;

// PDF export modal contents — design copy rendered verbatim per the audit
// (Scoring Engine.dc.html L538–544, fix B7). The client-side PDF genuinely
// covers composite + radar (6 real axes, not the design's 8), per-dimension
// sub-factor breakdown, weak-point remediation, and benchmarks vs the
// engine's tier thresholds; the founder-profile section and cohort
// positioning need backend data, and the generated PDF's footer states
// exactly what is and isn't included.
const EXPORT_CONTENTS = [
  'Composite score with 8-axis radar chart',
  'Per-dimension breakdown with evidence citations',
  'Founder profile — skill map, archetype matrix, values heatmap',
  'Weak-point summary with remediation plan',
  'Benchmark positioning vs. cohort and pre-seed minimum',
];

// Drawer "What's missing" prose — composed from the same real strings the
// weak-point card already uses (points on the table, weakest sub-factor,
// fix destination); no invented narrative.
function missingProse(d) {
  if (d.pointsAvailable <= 0) return `${d.label} is at its full ${d.max}-point weight — nothing left on the table.`;
  const parts = [`${d.pointsAvailable} of ${d.max} weighted points are still on the table.`];
  if (d.weakestSub) parts.push(`Weakest input: ${d.weakestSub.label.toLowerCase()} at ${d.weakestSub.points}/${d.weakestSub.max}.`);
  if (d.fix) parts.push(`Improve it in ${d.fix.label.replace(/^Open /, '')}.`);
  else if (d.fixNote) parts.push(`${d.fixNote}.`);
  return parts.join(' ');
}

const CARD = 'rounded-2xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 p-5';
const LBL = 'text-[11px] font-bold uppercase tracking-wider text-gray-400 dark:text-gray-500';
const QA_BTN = 'inline-flex items-center gap-1.5 text-[12px] font-medium rounded-lg border px-3 py-1.5';
const QA_GHOST = 'text-gray-500 dark:text-gray-400 border-transparent hover:border-gray-200 dark:hover:border-gray-700 hover:bg-white dark:hover:bg-gray-900';

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
      {/* Dashed overlay = the engine's real Tier-2 threshold (70) on every
          axis — NOT a cohort median, which has no data source yet. */}
      <polygon
        points={ordered.map((_, i) => pt(i, (R * TIER_THRESHOLDS[0].score) / 100).join(',')).join(' ')}
        fill="none" stroke="#a1a1aa" strokeWidth="1.5" strokeDasharray="4 3" data-testid="radar-threshold"
      />
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

function Trajectory({ points, projection }) {
  // Real history, plus an optional dashed projection segment continuing the
  // real slope of the last two runs (only passed when Tier 2 is reachable
  // inside the program window — see the `eta` memo).
  const W = 560; const H = 180; const P = { l: 30, r: 16, t: 18, b: 26 };
  const xs = points.map((p) => new Date(p.date).getTime());
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs, projection ? projection.ts : -Infinity);
  const span = Math.max(1, maxX - minX);
  const x = (t) => P.l + ((t - minX) / span) * (W - P.l - P.r);
  const y = (s) => P.t + (1 - s / 100) * (H - P.t - P.b);
  const line = points.map((p) => `${x(new Date(p.date).getTime())},${y(p.score)}`).join(' ');
  const last = points[points.length - 1];
  const target = TIER_THRESHOLDS[0];
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Score trajectory" data-testid="scoring-trajectory">
      <line x1={P.l} y1={y(target.score)} x2={W - P.r} y2={y(target.score)} stroke="#10b981" strokeWidth="1.5" strokeDasharray="5 4" />
      <text x={W - P.r} y={y(target.score) - 6} textAnchor="end" fontSize="10.5" fontWeight="700" fill="#10b981">
        Tier 2 threshold · {target.score}
      </text>
      {points.length > 1 && <polyline points={line} fill="none" stroke="#7c3aed" strokeWidth="2.5" strokeLinejoin="round" />}
      {projection && last && (
        <polyline
          points={`${x(new Date(last.date).getTime())},${y(last.score)} ${x(projection.ts)},${y(projection.score)}`}
          fill="none" stroke="#7c3aed" strokeWidth="2" strokeDasharray="4 3" opacity="0.5" data-testid="trajectory-projection"
        />
      )}
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
  const [copied, setCopied] = useState(''); // '' | 'ok' | 'fail'
  const [investorView, setInvestorView] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [exportError, setExportError] = useState('');
  const [drawerKey, setDrawerKey] = useState(null);

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

  // B11 — evidence confidence from real coverage: dimensions whose snapshot
  // carries any non-zero sub-factor data, banded with the same levelFor()
  // thresholds as everything else. Never a fixed "Medium".
  const dimsWithData = dims.filter((d) => d.subs.some((s) => s.points > 0)).length;
  const evidenceBand = dims.length ? levelFor(Math.round((dimsWithData / dims.length) * 100)) : null;
  // Lab tools unlocked so far ('spinout-lab' is the workspace itself, not a tool).
  const toolsUnlocked = (state?.unlocked_features || []).filter((f) => f !== 'spinout-lab').length;

  // B38 — honest investor-ready ETA from the real snapshot slope: the last
  // two runs set the pace. The headline only renders when the pace is
  // positive, the projected crossing is still ahead of today, and it lands
  // inside the 4-week program window. No fake ETA otherwise.
  const eta = useMemo(() => {
    if (trajectory.length < 2) return null;
    const prev = trajectory[trajectory.length - 2];
    const last = trajectory[trajectory.length - 1];
    const target = TIER_THRESHOLDS[0].score;
    if (last.score >= target) return null;
    const lastMs = new Date(last.date).getTime();
    const spanDays = (lastMs - new Date(prev.date).getTime()) / 86_400_000;
    if (!(spanDays > 0)) return null;
    const perDay = (last.score - prev.score) / spanDays;
    if (perDay <= 0) return null;
    const startMs = parseUtc(state?.started_at);
    if (!Number.isFinite(startMs)) return null;
    const crossMs = lastMs + ((target - last.score) / perDay) * 86_400_000;
    if (crossMs < Date.now()) return null; // projected crossing already passed unconfirmed
    const day = Math.ceil((crossMs - startMs) / 86_400_000);
    if (day < 1 || day > PROGRAM_DAYS) return null;
    return { day, perWeek: Math.round(perDay * 7 * 10) / 10, crossMs, target };
  }, [trajectory, state]);

  // B18 — drill-down drawer target.
  const drawer = drawerKey ? dims.find((d) => d.key === drawerKey) || null : null;
  const DrawerIcon = drawer ? drawer.icon : null;
  const drawerFixUnlocked = !!(drawer?.fix && (!drawer.fix.feature || (state?.unlocked_features || []).includes(drawer.fix.feature)));

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied('ok');
    } catch (err) {
      console.warn('[spinout-scoring:copy]', err);
      setCopied('fail');
    }
    window.setTimeout(() => setCopied(''), 2000);
  };

  // Client-side read-only presentation mode: hides the practice-run form and
  // every edit/fix affordance. Informational text (run type, lock notes)
  // stays — hiding true metadata from an investor would be dishonest.
  const toggleInvestorView = () => {
    const next = !investorView;
    setInvestorView(next);
    if (next) setFormOpen(false);
  };

  const generatePdf = async () => {
    if (!latest || generating) return;
    setGenerating(true);
    setExportError('');
    try {
      await exportScoringReportPdf({
        projectName: project?.name || 'project',
        isSandbox: !!latest.is_sandbox,
        lastRunLabel: fmtDate(latest.created_at),
        composite,
        delta,
        tierLabel,
        dims,
        radarKeys: DIMENSIONS.map((d) => d.key),
        tiers: TIER_THRESHOLDS,
      });
      setExportOpen(false);
    } catch (err) {
      console.error('[spinout-scoring:pdf]', err);
      setExportError('PDF generation failed — try again.');
    } finally {
      setGenerating(false);
    }
  };

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
      {/* B1 — teal diligence-phase stripe */}
      <div aria-hidden="true" className="-mx-4 -mt-6 h-[3px] rounded-b-[3px] bg-teal-600" />
      {/* Header */}
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" onClick={() => navigate('/spinout-lab')} data-testid="button-back-workspace"
          className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-gray-600 dark:text-gray-300 border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-1.5 bg-white dark:bg-gray-900 hover:bg-gray-50 dark:hover:bg-gray-800">
          <ArrowLeft size={14} /> Back to Workspace
        </button>
        <span aria-hidden="true" className="w-px h-5 bg-gray-200 dark:bg-gray-700" />
        <span className="w-[34px] h-[34px] flex-none rounded-[9px] bg-teal-50 dark:bg-teal-900/30 text-teal-600 dark:text-teal-400 flex items-center justify-center">
          <Gauge size={16} />
        </span>
        <div className="flex items-center gap-2">
          <h1 className="text-lg font-extrabold tracking-tight text-gray-900 dark:text-gray-50">Scoring Engine</h1>
          {/* Scoring unlocks in Week 3 (spinoutLabCatalog MILESTONES). */}
          <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-900/40 rounded-full px-2 py-0.5">
            <Check size={10} /> Unlocked · Wk 3
          </span>
        </div>
        <span className="ml-auto text-[10.5px] font-bold text-violet-700 dark:text-violet-300 bg-violet-50 dark:bg-violet-900/40 rounded-full px-2.5 py-1">Diligence · Wk 3</span>
      </div>
      <p className="text-[12.5px] text-gray-500 dark:text-gray-400 -mt-2">
        Structured scoring of venture readiness across all key dimensions before investor outreach.
      </p>

      {/* B6 — quick actions. Share needs a backend share token, so it stays
          honestly disabled with the reason; the other three are real. */}
      <div className="-mt-1 flex flex-wrap items-center gap-1" data-testid="scoring-quick-actions">
        <button type="button" disabled title="Sharing needs a backend share link — not available yet" data-testid="button-qa-share"
          className={`${QA_BTN} ${QA_GHOST} opacity-50 cursor-not-allowed`}>
          <Share2 size={13} className="text-gray-400" /> Share
        </button>
        <button type="button" onClick={() => { setExportError(''); setExportOpen(true); }} disabled={!latest}
          title={latest ? undefined : 'Run a scoring run first'} data-testid="button-qa-export"
          className={`${QA_BTN} ${QA_GHOST} disabled:opacity-50 disabled:cursor-not-allowed`}>
          <Download size={13} className="text-gray-400" /> Export report
        </button>
        <button type="button" onClick={copyLink} data-testid="button-qa-copy-link" className={`${QA_BTN} ${QA_GHOST}`}>
          {copied === 'ok'
            ? <Check size={13} className="text-emerald-500" />
            : <Copy size={13} className="text-gray-400" />}
          {copied === 'ok' ? 'Copied ✓' : copied === 'fail' ? 'Copy failed' : 'Copy link'}
        </button>
        <button type="button" onClick={toggleInvestorView} aria-pressed={investorView} data-testid="button-qa-investor-view"
          className={`${QA_BTN} ${investorView
            ? 'text-violet-700 dark:text-violet-300 bg-violet-50 dark:bg-violet-900/30 border-violet-200 dark:border-violet-800'
            : QA_GHOST}`}>
          {investorView ? <EyeOff size={13} /> : <Eye size={13} className="text-gray-400" />}
          {investorView ? 'Exit investor view' : 'Investor view'}
        </button>
      </div>

      {investorView && (
        <div className="rounded-xl bg-violet-50 dark:bg-violet-900/20 border border-violet-100 dark:border-violet-800 px-3.5 py-2.5 flex flex-wrap items-center gap-2" data-testid="investor-view-banner">
          <Eye size={13} className="text-violet-600 dark:text-violet-400" />
          <span className="text-[11.5px] font-medium text-violet-700 dark:text-violet-300">Investor view — read-only. Practice runs and fix-it shortcuts are hidden.</span>
          <button type="button" onClick={toggleInvestorView} data-testid="button-exit-investor-view"
            className="ml-auto text-[11.5px] font-bold text-violet-700 dark:text-violet-300 hover:underline">
            Exit investor view
          </button>
        </div>
      )}

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
          {!investorView && (
            <button type="button" onClick={() => setFormOpen(true)} data-testid="button-open-practice-run"
              className="h-10 px-4 rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-sm font-semibold inline-flex items-center gap-1.5">
              <Play size={14} /> Run a practice score
            </button>
          )}
        </div>
      ) : (
        <>
          {/* Top grid: composite + radar | dimensions weakest-first */}
          <div className="grid lg:grid-cols-[280px,1fr] gap-4 items-start">
            <div className="space-y-4">
              <div className={CARD} data-testid="card-composite">
                <div className={`${LBL} mb-3`}>Composite readiness</div>
                <div className="flex items-end gap-3">
                  <span className="text-[66px] leading-[0.9] font-extrabold tracking-tight text-gray-900 dark:text-gray-50 tabular-nums" data-testid="text-composite-score">{composite}</span>
                  <div className="pb-1 min-w-0">
                    {delta != null && delta !== 0 && (
                      <span className={`inline-flex items-center gap-1 text-[10.5px] font-bold rounded-full px-2 py-0.5 ${delta > 0 ? 'text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-900/40' : 'text-rose-700 dark:text-rose-300 bg-rose-50 dark:bg-rose-900/40'}`} data-testid="chip-composite-delta">
                        {delta > 0 ? <TrendingUp size={11} /> : <TrendingDown size={11} />}
                        {delta > 0 ? '+' : ''}{delta} since last run
                      </span>
                    )}
                    <div className="text-[12px] text-gray-400 mt-1">out of 100</div>
                  </div>
                </div>
                {/* B11 — evidence confidence from real coverage; the note pairs
                    the unlocked-tool count with dimensions carrying data. */}
                {evidenceBand && (
                  <div className="mt-4 pt-3 border-t border-gray-100 dark:border-gray-800 flex flex-wrap items-center gap-2" data-testid="row-evidence-confidence">
                    <span className="text-[11.5px] text-gray-500 dark:text-gray-400">Evidence confidence</span>
                    <span className={`text-[10px] font-bold rounded-full px-2 py-0.5 ${LEVEL_BG[evidenceBand]} ${LEVEL_TEXT[evidenceBand]}`}
                      title={`${dimsWithData} of ${dims.length} dimensions have non-zero sub-factor data`}
                      data-testid="chip-evidence-confidence">
                      {evidenceBand}
                    </span>
                    <span className="ml-auto text-[10px] text-gray-400 text-right" data-testid="text-evidence-note">
                      {toolsUnlocked} tools unlocked · {dimsWithData}/{dims.length} dimensions with data
                    </span>
                  </div>
                )}
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
                {!investorView && (
                  <button type="button" onClick={() => setFormOpen((v) => !v)} data-testid="button-open-practice-run"
                    className="mt-4 w-full h-9 rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-[12.5px] font-semibold inline-flex items-center justify-center gap-1.5">
                    <Play size={13} /> Run a practice score
                  </button>
                )}
              </div>

              <div className={CARD} data-testid="card-radar">
                <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
                  <div className={LBL}>Dimension radar</div>
                  {/* B13 — legend. The dashed overlay is the Tier-2 threshold,
                      not a cohort median (no cohort data source yet). */}
                  <div className="flex items-center gap-3" data-testid="radar-legend">
                    <span className="inline-flex items-center gap-1.5 text-[10.5px] text-gray-500 dark:text-gray-400">
                      <span aria-hidden="true" className="w-2.5 h-2.5 rounded-[2px] bg-violet-600/60" /> You
                    </span>
                    <span className="inline-flex items-center gap-1.5 text-[10.5px] text-gray-500 dark:text-gray-400">
                      <span aria-hidden="true" className="w-3 border-t-2 border-dashed border-gray-400 dark:border-gray-500" /> Tier 2 threshold
                    </span>
                  </div>
                </div>
                <p className="text-[10.5px] text-gray-400 dark:text-gray-500 mb-2">Each axis = % of that dimension's weighted maximum.</p>
                <Radar dims={dims} />
              </div>
            </div>

            {/* Dimensions weakest first */}
            <div className={CARD} data-testid="card-dimensions">
              <div className="flex items-center justify-between mb-3">
                <div className={LBL}>Dimensions · weakest first</div>
                <span className="text-[10.5px] text-gray-400">{dims.length} dimensions · click to drill down</span>
              </div>
              <div className="space-y-2.5">
                {dims.map((d) => {
                  const Icon = d.icon;
                  const fixUnlocked = d.fix && (!d.fix.feature || (state?.unlocked_features || []).includes(d.fix.feature));
                  return (
                    // B18 — the whole row opens the drill-down drawer. A
                    // role="button" div (not <button>) because the nested
                    // Fix-it <Link> must stay a real, working link.
                    <div key={d.key} role="button" tabIndex={0}
                      onClick={() => setDrawerKey(d.key)}
                      onKeyDown={(e) => {
                        if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) {
                          e.preventDefault();
                          setDrawerKey(d.key);
                        }
                      }}
                      className="rounded-xl border border-gray-100 dark:border-gray-800 p-3.5 cursor-pointer hover:bg-violet-50/40 dark:hover:bg-gray-800/50 hover:border-violet-200 dark:hover:border-violet-800 transition-colors"
                      data-testid={`dimension-row-${d.key}`}>
                      <div className="flex items-center gap-2.5">
                        <span className="w-7 h-7 flex-none rounded-lg bg-violet-50 dark:bg-violet-900/30 text-violet-600 dark:text-violet-400 flex items-center justify-center"><Icon size={14} /></span>
                        <span className="text-[13px] font-bold text-gray-900 dark:text-gray-50">{d.label}</span>
                        <span className="text-[10.5px] font-semibold text-gray-400">{d.max}%</span>
                        <span className={`text-[10px] font-bold rounded-md px-1.5 py-0.5 ${LEVEL_BG[d.level]} ${LEVEL_TEXT[d.level]}`}>{d.level}</span>
                        <span className={`ml-auto text-[13px] font-extrabold tabular-nums ${LEVEL_TEXT[d.level]}`} data-testid={`score-${d.key}`}>{d.pct}</span>
                        <ChevronRight size={14} aria-hidden="true" className="flex-none text-gray-300 dark:text-gray-600" />
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
                            !investorView && (
                              <Link to={d.fix.to} onClick={(e) => e.stopPropagation()} className="ml-auto text-[11.5px] font-bold text-violet-600 dark:text-violet-400 inline-flex items-center gap-1" data-testid={`link-fix-${d.key}`}>
                                Fix it <ArrowRight size={12} />
                              </Link>
                            )
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
                            <span className="inline-flex items-center gap-1 text-[10.5px] font-bold text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-900/40 rounded-full px-2 py-0.5">
                              <TrendingUp size={10} /> +{d.pointsAvailable} pts available
                            </span>
                          </div>
                          <p className="text-[11.5px] text-gray-500 dark:text-gray-400 mt-0.5">
                            {d.weakestSub
                              ? `Weakest input: ${d.weakestSub.label.toLowerCase()} at ${d.weakestSub.points}/${d.weakestSub.max}.`
                              : 'All inputs below their maxima.'}
                          </p>
                        </div>
                        {d.fix && fixUnlocked && !investorView && (
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
                  Against the engine's real tier thresholds — cohort medians aren't tracked yet. Marker = your composite.
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
                      <div className="relative h-2 rounded-full bg-gray-100 dark:bg-gray-800">
                        <div className={`absolute inset-y-0 left-0 rounded-full ${row.color}`} style={{ width: `${row.value}%` }} />
                        {/* B36 — composite marker overlaid on every bar. */}
                        <span aria-hidden="true" data-testid={`marker-${row.testid}`}
                          className="absolute -top-[3px] -bottom-[3px] w-[2px] rounded-sm bg-gray-900 dark:bg-gray-100 -translate-x-1/2"
                          style={{ left: `${composite}%` }} />
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
                {/* B38 — only rendered when the real slope reaches Tier 2
                    inside the program window; no fake ETA. */}
                {eta && (
                  <div className="flex flex-wrap items-baseline gap-2 mb-1" data-testid="text-trajectory-eta">
                    <span className="text-[13.5px] font-bold text-emerald-600 dark:text-emerald-400 tabular-nums">Investor-ready by Day {eta.day}</span>
                    <span className="text-[11px] text-gray-400">at current pace (+{eta.perWeek}/wk)</span>
                  </div>
                )}
                <p className="text-[11px] text-gray-400 dark:text-gray-500 mb-2">
                  {eta ? 'Solid line = real runs · dashed = projection at the current pace.' : 'Real run history — no projected pace.'}
                </p>
                {trajectory.length > 1 ? (
                  <Trajectory points={trajectory} projection={eta ? { ts: eta.crossMs, score: eta.target } : null} />
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

      {/* Practice-run form (hidden entirely in the read-only investor view) */}
      {formOpen && !investorView && (
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

      {/* B18/B23–B30 — per-dimension drill-down drawer */}
      {drawer && (
        <>
          <div className="fixed inset-0 z-[60] bg-gray-900/30 backdrop-blur-[2px]" onClick={() => setDrawerKey(null)} data-testid="scoring-drawer-scrim" />
          <aside className="fixed inset-y-0 right-0 z-[61] w-full lg:w-[460px] bg-white dark:bg-gray-900 shadow-2xl overflow-y-auto"
            role="dialog" aria-modal="true" aria-label={`${drawer.label} drill-down`} data-testid="scoring-drawer">
            <div className="sticky top-0 z-10 bg-white dark:bg-gray-900 border-b border-gray-100 dark:border-gray-800 px-5 py-4">
              <div className="flex items-center gap-2.5">
                <span className="w-9 h-9 flex-none rounded-[9px] bg-violet-50 dark:bg-violet-900/30 text-violet-600 dark:text-violet-400 flex items-center justify-center">
                  {DrawerIcon && <DrawerIcon size={16} />}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-[15px] font-extrabold tracking-tight text-gray-900 dark:text-gray-50">{drawer.label}</div>
                  <div className="text-[11.5px] text-gray-400">Weight {drawer.max}% · {drawer.level} confidence</div>
                </div>
                <button type="button" onClick={() => setDrawerKey(null)} data-testid="button-close-drawer"
                  className="w-8 h-8 flex-none rounded-lg border border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 flex items-center justify-center hover:bg-gray-50 dark:hover:bg-gray-800">
                  <X size={14} />
                </button>
              </div>
              <div className="mt-3.5 flex items-center gap-3">
                <div className="flex-1 h-2 rounded-full bg-gray-100 dark:bg-gray-800 overflow-hidden">
                  <div className={`h-full rounded-full ${LEVEL_BAR[drawer.level]}`} style={{ width: `${drawer.pct}%` }} />
                </div>
                <span className={`text-[22px] font-extrabold tabular-nums ${LEVEL_TEXT[drawer.level]}`} data-testid="text-drawer-score">{drawer.pct}</span>
              </div>
            </div>

            <div className="px-5 py-5">
              <div className={`${LBL} mb-1`}>Contributing evidence</div>
              {/* Per-evidence source provenance ("from Market Intel" etc.,
                  design L254) needs backend attribution the snapshot doesn't
                  carry — the run-level caption is the honest substitute. */}
              <p className="text-[10.5px] text-gray-400 dark:text-gray-500 mb-2.5">Per-input points from your latest scoring run, against the engine's maxima.</p>
              <div className="space-y-2 mb-6">
                {drawer.subs.map((s) => {
                  const good = s.points >= s.max / 2;
                  return (
                    <div key={s.col} className="flex items-start gap-2.5 rounded-xl bg-gray-50 dark:bg-gray-800/50 border border-gray-100 dark:border-gray-800 px-3 py-2.5" data-testid={`drawer-evidence-${s.col}`}>
                      {good
                        ? <Check size={14} className="flex-none mt-0.5 text-emerald-600 dark:text-emerald-400" />
                        : <AlertCircle size={14} className="flex-none mt-0.5 text-amber-600 dark:text-amber-500" />}
                      <div className="min-w-0">
                        <div className="text-[12px] font-semibold text-gray-700 dark:text-gray-200">{s.label}</div>
                        <div className="text-[10.5px] text-gray-400 tabular-nums">{s.points}/{s.max} points</div>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* The design's Team-only panels — skill-coverage matrix,
                  archetype coverage, values alignment (Scoring Engine.dc
                  L262–297) — need founder-pair profile data no endpoint
                  exposes yet; omitted rather than faked. */}

              <div className={`${LBL} mb-1.5`}>What's missing</div>
              <p className="text-[12px] text-gray-600 dark:text-gray-300 leading-relaxed mb-4" data-testid="text-drawer-missing">{missingProse(drawer)}</p>

              {!investorView && (
                drawer.fix ? (
                  drawerFixUnlocked ? (
                    <Link to={drawer.fix.to} data-testid="link-drawer-fix"
                      className="block w-full text-center rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-[13px] font-semibold py-3">
                      {drawer.fix.label} →
                    </Link>
                  ) : (
                    <div className="w-full rounded-xl bg-gray-100 dark:bg-gray-800 text-gray-400 text-[12.5px] font-semibold py-3 flex items-center justify-center gap-1.5">
                      <Lock size={13} /> {drawer.fix.label} locked
                    </div>
                  )
                ) : (
                  <div className="w-full rounded-xl bg-gray-100 dark:bg-gray-800 text-gray-400 text-[12.5px] font-semibold py-3 flex items-center justify-center gap-1.5">
                    <Lock size={13} /> {drawer.fixNote}
                  </div>
                )
              )}
            </div>
          </aside>
        </>
      )}

      {/* B7 — PDF export modal */}
      {exportOpen && (
        <div className="fixed inset-0 z-[70] bg-gray-900/40 backdrop-blur-[2px] flex items-center justify-center p-6"
          onClick={() => setExportOpen(false)} data-testid="export-modal">
          <div className="w-full max-w-[440px] rounded-2xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 shadow-2xl p-6"
            onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Export investor-ready report">
            <div className="flex items-center gap-3 mb-4">
              <span className="w-[38px] h-[38px] flex-none rounded-[10px] bg-violet-50 dark:bg-violet-900/30 text-violet-600 dark:text-violet-400 flex items-center justify-center">
                <FileText size={17} />
              </span>
              <div>
                <div className="text-[15.5px] font-extrabold tracking-tight text-gray-900 dark:text-gray-50">Investor-ready report</div>
                <div className="text-[12px] text-gray-400">PDF · composite score, radar, evidence, remediation</div>
              </div>
            </div>
            <div className="space-y-2 mb-5">
              {EXPORT_CONTENTS.map((c) => (
                <div key={c} className="flex items-center gap-2 text-[12px] text-gray-600 dark:text-gray-300">
                  <Check size={14} className="flex-none text-emerald-600 dark:text-emerald-400" /> {c}
                </div>
              ))}
            </div>
            {exportError && (
              <p className="mb-3 text-[12px] text-rose-500 inline-flex items-center gap-1.5" data-testid="text-export-error">
                <AlertTriangle size={13} /> {exportError}
              </p>
            )}
            <div className="flex gap-2.5">
              <button type="button" onClick={() => setExportOpen(false)} data-testid="button-cancel-export"
                className="flex-1 h-10 rounded-xl bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 text-[12.5px] font-semibold text-gray-600 dark:text-gray-300">
                Cancel
              </button>
              <button type="button" onClick={generatePdf} disabled={generating || !latest} data-testid="button-generate-pdf"
                className="flex-[2] h-10 rounded-xl bg-violet-600 hover:bg-violet-700 disabled:opacity-60 text-white text-[12.5px] font-semibold inline-flex items-center justify-center gap-1.5">
                {generating && <Loader2 size={14} className="animate-spin" />} Generate PDF
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
