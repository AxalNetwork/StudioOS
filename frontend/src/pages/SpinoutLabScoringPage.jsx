// Spin-Out Lab — Scoring Engine (design: spin-out-lab-pipeline/project/
// "Scoring Engine.dc.html" — composite readiness, dimension radar,
// weakest-first dimension list, weak-point analysis, benchmark comparison,
// score trajectory, drill-down drawer, export modal).
//
// This file is the CONTAINER: fetching, auth/unlock gates, local state, the
// real practice-run write path, and composition. All derivation lives in
// ../lib/scoringViewModel (pure), all presentation in
// ../components/scoring/* (props in, JSX out).
//
// Real data only:
//   - Snapshots from GET /scoring/scores/:projectId?include_sandbox=1 — the
//     real venture-scoring engine's 6 dimensions (Market 25 · Team 20 ·
//     Product 15 · Capital 15 · Fit 15 · Distribution 10), not the design's
//     8 fabricated axes. Maxima sum to 100, so a dimension's max IS its
//     weight%.
//   - Benchmarks and the radar's dashed overlay use the engine's real tier
//     thresholds (Tier 2 ≥ 70, Tier 1 ≥ 85), labelled as such. The design's
//     cohort median and percentile sentence have no data source and are not
//     reproduced.
//   - "Run integrity" is run provenance (is_sandbox / integrity_valid /
//     anomaly_flags / admin_review_status / scored_by) — all real snapshot
//     columns. It is NOT called "evidence confidence": the HMAC proves the
//     stored row wasn't altered, not that the inputs are true. There is no
//     per-dimension confidence anywhere in the backend either, so each
//     dimension shows its score BAND instead, named as a band.
//   - The trajectory ETA and dashed projection derive from OFFICIAL runs only
//     (never practice/sandbox runs) and only render when every guard passes,
//     including a minimum 3-day span before any per-week pace is claimed.
//   - Quick actions: Copy link, Investor view and Export report are real;
//     Share stays disabled — no backend share token exists yet, and the
//     reason is rendered visibly, not only in a title tooltip.
//   - Founders may run PRACTICE (sandbox) scores on their own project; the
//     API permits this explicitly and sandbox runs are never investor-visible.
//
// Documented departures from the design's own values:
//   - Score bands cut at 70 / 50 (design: 70 / 40). Deliberate: levelFor() is
//     shared with lib/scoringReportPdf.js (LEVEL_RGB) and
//     SpinoutLabAdvisorsPage, and 50 splits the sub-Tier-2 range in half.
//   - 70 is labelled "Tier 2", never "investor-ready" — the engine calls it
//     "Tier 2 — Conditional / Refine in Week 1" and reserves immediate
//     spinout for 85.

import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  AlertTriangle, ArrowLeft, Check, Copy, Download, Eye, EyeOff, Gauge,
  Loader2, Lock, Minus, Play, Share2, TrendingDown, TrendingUp,
} from 'lucide-react';
import { api, spinoutLab, assessment } from '../lib/api';
import { markMilestone } from '../lib/spinoutLabHooks';
import { exportScoringReportPdf } from '../lib/scoringReportPdf';
import { pickLabProject } from './SpinoutLabStartupPage';
import {
  TIER_THRESHOLDS, TIER_LABELS, DIMENSIONS, levelFor,
  buildDimensions, buildTrajectory, buildScoringEngineViewModel,
} from '../lib/scoringViewModel';
import useCountUp from '../components/scoring/useCountUp';
import RadarChart from '../components/scoring/RadarChart';
import TrajectoryChart from '../components/scoring/TrajectoryChart';
import DimensionRow from '../components/scoring/DimensionRow';
import WeakPointList from '../components/scoring/WeakPointList';
import BenchmarkBars from '../components/scoring/BenchmarkBars';
import DimensionDrawer from '../components/scoring/DimensionDrawer';
import ExportReportModal from '../components/scoring/ExportReportModal';

// Worker-only endpoints: ONLY a 404 means "not in this environment" (the dev
// FastAPI lacks /api/radar and /api/assessment). Same convention as
// SpinoutLabAdvisorsPage.
const wkOnly = (e) => (e?.status === 404 ? { unavailable: true } : { failed: true });

// Backward-compat re-exports: SpinoutLabAdvisorsPage historically imported
// buildDimensions from this module, and tests may reach for the constants.
export {
  TIER_THRESHOLDS, TIER_LABELS, DIMENSIONS, levelFor, buildDimensions, buildTrajectory,
};

const CARD = 'rounded-2xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 p-5';
const LBL = 'text-[11px] font-bold uppercase tracking-wider text-gray-400 dark:text-gray-500';
const QA_BTN = 'inline-flex items-center gap-1.5 text-[12px] font-medium rounded-lg border px-3 py-1.5';
const QA_GHOST = 'text-gray-500 dark:text-gray-400 border-transparent hover:border-gray-200 dark:hover:border-gray-700 hover:bg-white dark:hover:bg-gray-900';

// ---- Practice-run form: the engine's real INPUT wire contract for
// POST /scoring/score (different key names from the snapshot columns). ----
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
  // Team drill-down data, fetched lazily the first time the Team drawer opens.
  // `{ loading: true }` while in flight; `{ unavailable }` / `{ failed }` /
  // `{ data }` afterwards — the panel renders a distinct state for each.
  const [skillState, setSkillState] = useState(null);
  const [archetypeState, setArchetypeState] = useState(null);

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

  // Team drawer: GET /radar/me and GET /assessment/results/me are both
  // self-scoped (radar.ts L52 is requireAuth-only — the cofounder-connection
  // guard applies to POST /radar/team, not here), so no connection is needed.
  useEffect(() => {
    if (drawerKey !== 'team' || skillState) return;
    let dead = false;
    setSkillState({ loading: true });
    setArchetypeState({ loading: true });
    (async () => {
      const [radar, res] = await Promise.all([
        api.radar.me().catch(wkOnly),
        assessment.myResults().catch(wkOnly),
      ]);
      if (dead) return;
      setSkillState(radar?.unavailable || radar?.failed ? radar : { data: radar });
      setArchetypeState(
        res?.unavailable || res?.failed ? res : { data: Array.isArray(res?.results) ? res.results : [] },
      );
    })();
    return () => { dead = true; };
  }, [drawerKey, skillState]);

  // NOTE: computed before the early-return gates below; must not reference
  // bindings declared later (a `const isAdmin` further down caused a TDZ crash).
  const unlocked = user?.role === 'admin' || (state?.unlocked_features || []).includes('scoring');
  const vm = useMemo(
    () => buildScoringEngineViewModel({ snapshots, state, project, viewerRole: user?.role }),
    [snapshots, state, project, user],
  );
  const displayScore = useCountUp(vm.composite, 850);
  const drawerDim = drawerKey ? vm.dimensions.find((d) => d.key === drawerKey) || null : null;

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
  // every edit/fix affordance. Informational text (tier, run type, lock
  // notes) stays — hiding true metadata from an investor would be dishonest.
  const toggleInvestorView = () => {
    const next = !investorView;
    setInvestorView(next);
    if (next) setFormOpen(false);
  };

  const generatePdf = async () => {
    if (generating) return;
    if (!vm.hasData) {
      setExportError('No scoring run to export yet.');
      return;
    }
    setGenerating(true);
    setExportError('');
    try {
      await exportScoringReportPdf(vm.exportMeta);
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
    if (running) return;
    // A silent `return` here made the whole form a dead control for any viewer
    // with no lab project (reachable for an admin, whom the route admits).
    if (!project) {
      setRunError('No Spin-Out Lab project is linked to this account — create one in Startups first.');
      return;
    }
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
      const owns = !!(user?.founder_id && project?.founder_id && user.founder_id === project.founder_id);
      if (owns) await markMilestone(user, 'scoring_run_completed');
      // If the post-run refresh fails, keep the history we already have
      // rather than wiping it to a fake empty state.
      const scores = await api.getScores(project.id, { includeSandbox: true }).catch(() => null);
      if (Array.isArray(scores)) {
        setSnapshots(scores);
        setScoresError(false);
        // Optional W3 deliverable — ≥70% on 5+ of the 6 real dimensions in
        // the fresh snapshot.
        const fresh = scores[0];
        if (fresh && owns && buildDimensions(fresh).filter((d) => d.pct >= 70).length >= 5) {
          await markMilestone(user, 'scoring_confidence_70');
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
        <p className="text-sm text-rose-500 dark:text-rose-400 mb-3">The Scoring Engine couldn&apos;t be loaded right now.</p>
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
        <span className="inline-flex items-center justify-center w-12 h-12 rounded-2xl bg-gray-100 dark:bg-gray-800 text-gray-400 dark:text-gray-500 mb-4"><Lock size={20} /></span>
        <h1 className="text-lg font-bold text-gray-900 dark:text-gray-50 mb-1.5">Scoring Engine unlocks in Week 3</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
          You&apos;re in Week {state?.week || 1}. Finish your Week-{Math.max(1, (state?.week || 1))} deliverables to advance.
        </p>
        <Link to="/spinout-lab" className="text-sm font-semibold text-violet-600 dark:text-violet-400">Back to Workspace →</Link>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto px-4 py-6 space-y-4" data-testid="page-spinout-scoring">
      {/* Teal diligence-phase stripe (design L34) */}
      <div aria-hidden="true" className="-mx-4 -mt-6 h-[3px] rounded-b-[3px] bg-teal-600" />

      <div className="flex flex-wrap items-center gap-3">
        <button type="button" onClick={() => navigate('/spinout-lab')} data-testid="button-back-workspace"
          className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-gray-600 dark:text-gray-300 border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-1.5 bg-white dark:bg-gray-900 hover:bg-gray-50 dark:hover:bg-gray-800">
          <ArrowLeft size={14} /> Back to Workspace
        </button>
        <span aria-hidden="true" className="w-px h-5 bg-gray-200 dark:bg-gray-700" />
        <span className="w-[34px] h-[34px] flex-none rounded-[9px] bg-teal-50 dark:bg-teal-900/30 text-teal-600 dark:text-teal-400 flex items-center justify-center">
          <Gauge size={16} />
        </span>
        <div className="flex items-center gap-2 flex-wrap">
          <h1 className="text-lg font-extrabold tracking-tight text-gray-900 dark:text-gray-50">Scoring Engine</h1>
          {/* The numbers on this page belong to a specific venture — for an
              admin pickLabProject() may resolve someone else's project, so it
              is always named. */}
          {project?.name && (
            <span className="text-[13px] font-semibold text-gray-500 dark:text-gray-400 truncate max-w-[240px]" data-testid="text-scoring-project">
              · {project.name}
            </span>
          )}
          {/* "Unlocks in Week 3" is a fact about the tool; the viewer's own
              week comes from state.week, never a hardcoded 3. */}
          <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-900/40 rounded-full px-2 py-0.5" data-testid="chip-unlocked">
            <Check size={10} /> Unlocked{state?.week ? ` · you're in Wk ${state.week}` : ''}
          </span>
        </div>
        <span className="ml-auto text-[10.5px] font-bold text-violet-700 dark:text-violet-300 bg-violet-50 dark:bg-violet-900/40 rounded-full px-2.5 py-1">Diligence · unlocks Wk 3</span>
      </div>
      <p className="text-[12.5px] text-gray-500 dark:text-gray-400 -mt-2">
        Structured scoring of venture readiness across the engine&apos;s {DIMENSIONS.length} weighted dimensions before investor outreach.
      </p>
      {isAdmin && project && (
        <p className="text-[11.5px] text-amber-600 dark:text-amber-400 -mt-2" data-testid="text-admin-project-note">
          Admin view — showing the earliest Spin-Out Lab project ({project.name || `#${project.id}`}), which may belong to another founder.
        </p>
      )}
      {!project && (
        <p className="text-[11.5px] text-amber-600 dark:text-amber-400 -mt-2" data-testid="text-no-project-note">
          No Spin-Out Lab project is linked to this account, so there is nothing to score.{' '}
          <Link to="/spinout-lab/startup" className="font-semibold underline">Create one in Startups</Link>.
        </p>
      )}

      {/* Quick actions. Share needs a backend share token, so it stays
          honestly disabled with the reason; the other three are real. */}
      <div className="-mt-1 flex flex-wrap items-center gap-1" data-testid="scoring-quick-actions">
        {/* The reason is in the visible label, not only in `title` — a
            keyboard or touch user never sees a tooltip. */}
        <button type="button" disabled title="Sharing needs a backend share link — not available yet" data-testid="button-qa-share"
          className={`${QA_BTN} ${QA_GHOST} opacity-50 cursor-not-allowed`}>
          <Share2 size={13} className="text-gray-400 dark:text-gray-500" /> Share — needs a share link
        </button>
        <button type="button" onClick={() => { setExportError(''); setExportOpen(true); }} disabled={!vm.hasData}
          title={vm.hasData ? undefined : 'Run a scoring run first'} data-testid="button-qa-export"
          className={`${QA_BTN} ${QA_GHOST} disabled:opacity-50 disabled:cursor-not-allowed`}>
          <Download size={13} className="text-gray-400 dark:text-gray-500" /> Export report
        </button>
        <button type="button" onClick={copyLink} data-testid="button-qa-copy-link" className={`${QA_BTN} ${QA_GHOST}`}>
          {copied === 'ok'
            ? <Check size={13} className="text-emerald-500" />
            : <Copy size={13} className="text-gray-400 dark:text-gray-500" />}
          {copied === 'ok' ? 'Copied ✓' : copied === 'fail' ? 'Copy failed' : 'Copy link'}
        </button>
        <button type="button" onClick={toggleInvestorView} aria-pressed={investorView} data-testid="button-qa-investor-view"
          className={`${QA_BTN} ${investorView
            ? 'text-violet-700 dark:text-violet-300 bg-violet-50 dark:bg-violet-900/30 border-violet-200 dark:border-violet-800'
            : QA_GHOST}`}>
          {investorView ? <EyeOff size={13} /> : <Eye size={13} className="text-gray-400 dark:text-gray-500" />}
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
          <AlertTriangle className="w-8 h-8 text-amber-400 dark:text-amber-500 mx-auto mb-3" />
          <h2 className="text-[15px] font-bold text-gray-900 dark:text-gray-50 mb-1">Couldn&apos;t load your scoring history</h2>
          <p className="text-[12.5px] text-gray-500 dark:text-gray-400 max-w-md mx-auto">
            Your past runs may exist but couldn&apos;t be fetched right now. Reload the page to try again.
          </p>
        </div>
      ) : !vm.hasData ? (
        <div className={`${CARD} text-center py-12`} data-testid="scoring-empty">
          <Gauge className="w-8 h-8 text-gray-300 dark:text-gray-600 mx-auto mb-3" />
          <h2 className="text-[15px] font-bold text-gray-900 dark:text-gray-50 mb-1">No scoring run yet</h2>
          <p className="text-[12.5px] text-gray-500 dark:text-gray-400 mb-4 max-w-md mx-auto">
            Run a practice score to see your composite readiness, dimension breakdown, and how far you are from the
            engine&apos;s {TIER_THRESHOLDS[0].label} ({TIER_THRESHOLDS[0].score}). Practice runs are never investor-visible.
          </p>
          {!investorView && (project ? (
            <button type="button" onClick={() => setFormOpen(true)} data-testid="button-open-practice-run"
              className="h-10 px-4 rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-sm font-semibold inline-flex items-center gap-1.5">
              <Play size={14} /> Run a practice score
            </button>
          ) : (
            // Never an enabled control that does nothing: with no project the
            // POST has no project_id and the run cannot happen.
            <div className="inline-flex flex-col items-center gap-1.5" data-testid="practice-run-blocked">
              <button type="button" disabled data-testid="button-open-practice-run-disabled"
                className="h-10 px-4 rounded-xl bg-violet-600 text-white text-sm font-semibold inline-flex items-center gap-1.5 opacity-50 cursor-not-allowed">
                <Play size={14} /> Run a practice score
              </button>
              <span className="text-[11.5px] text-gray-500 dark:text-gray-400">
                Create a startup project first —{' '}
                <Link to="/spinout-lab/startup" className="font-semibold text-violet-600 dark:text-violet-400">open Startups</Link>.
              </span>
            </div>
          ))}
        </div>
      ) : (
        <>
          {/* Top grid: composite + radar | dimensions weakest-first */}
          {/* Arbitrary grid values must use `_` as the separator — Tailwind
              rewrites `_` to a space but leaves `,` alone, so a comma emits
              `grid-template-columns:300px,1fr`, which the browser drops. */}
          <div className="grid lg:grid-cols-[300px_1fr] gap-4 items-start">
            <div className="space-y-4">
              <div className={CARD} data-testid="card-composite">
                <div className={`${LBL} mb-3`}>Composite readiness</div>
                <div className="flex items-end gap-3">
                  <span className="text-[66px] leading-[0.9] font-extrabold tracking-tight text-gray-900 dark:text-gray-50 tabular-nums" data-testid="text-composite-score">{displayScore}</span>
                  <div className="pb-1 min-w-0">
                    {/* A flat result is a result — the chip keeps its slot
                        rather than vanishing, which would read as missing
                        data. The label names a practice comparison as such. */}
                    {vm.delta != null && (
                      <span className={`inline-flex items-center gap-1 text-[10.5px] font-bold rounded-full px-2 py-0.5 ${vm.deltaDir === 'up'
                        ? 'text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-900/40'
                        : vm.deltaDir === 'down'
                          ? 'text-rose-700 dark:text-rose-300 bg-rose-50 dark:bg-rose-900/40'
                          : 'text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-gray-800'}`} data-testid="chip-composite-delta">
                        {vm.deltaDir === 'up' ? <TrendingUp size={11} /> : vm.deltaDir === 'down' ? <TrendingDown size={11} /> : <Minus size={11} />}
                        {vm.deltaLabel}
                      </span>
                    )}
                    <div className="text-[12px] text-gray-400 dark:text-gray-500 mt-1">out of 100</div>
                  </div>
                </div>

                {/* The engine clamps `dimension totals + ai_adjustment` into
                    the composite, so without this the six dimension totals
                    below can visibly fail to sum to the number above. */}
                {vm.adjustmentLine && (
                  <p className="mt-2 text-[11px] text-gray-500 dark:text-gray-400 tabular-nums" data-testid="text-ai-adjustment">
                    {vm.adjustmentLine}
                  </p>
                )}

                {/* Run integrity = run provenance (is_sandbox /
                    integrity_valid / anomaly_flags / admin_review_status /
                    scored_by), all real columns. Not "evidence confidence":
                    official-run inputs are still supplied by a human. */}
                <div className="mt-4 pt-3 border-t border-gray-100 dark:border-gray-800 flex flex-wrap items-center gap-2" data-testid="row-evidence-confidence">
                  <span className="text-[11.5px] text-gray-500 dark:text-gray-400">Run integrity</span>
                  <span className={`text-[10px] font-bold rounded-full px-2 py-0.5 ${vm.runIntegrity.style}`} data-testid="chip-evidence-confidence">
                    {vm.runIntegrity.label}
                  </span>
                  <span className="ml-auto text-[10px] text-gray-400 dark:text-gray-500 text-right" data-testid="text-evidence-note">{vm.evidenceNote}</span>
                </div>

                <div className="mt-3 space-y-1.5 text-[11.5px]">
                  <div className="flex justify-between gap-2">
                    <span className="text-gray-400 dark:text-gray-500">Tier</span>
                    <span className="font-semibold text-gray-700 dark:text-gray-200 text-right" data-testid="text-tier-label">{vm.tierLabel}</span>
                  </div>
                  <div className="flex justify-between gap-2">
                    <span className="text-gray-400 dark:text-gray-500">Run type</span>
                    <span className="font-semibold text-gray-700 dark:text-gray-200 text-right" data-testid="text-run-type">{vm.runType.label}</span>
                  </div>
                  <div className="flex justify-between gap-2">
                    <span className="text-gray-400 dark:text-gray-500">Last run</span>
                    <span className="font-semibold text-gray-700 dark:text-gray-200">{vm.lastRunLabel}</span>
                  </div>
                </div>

                {!investorView && (
                  <>
                    <button type="button" onClick={() => setFormOpen((v) => !v)} disabled={!project} data-testid="button-open-practice-run"
                      className="mt-4 w-full h-9 rounded-xl bg-violet-600 hover:bg-violet-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-[12.5px] font-semibold inline-flex items-center justify-center gap-1.5">
                      <Play size={13} /> Run a practice score
                    </button>
                    {!project && (
                      <p className="mt-1.5 text-[11px] text-gray-500 dark:text-gray-400 text-center">
                        Create a startup project first —{' '}
                        <Link to="/spinout-lab/startup" className="font-semibold text-violet-600 dark:text-violet-400">open Startups</Link>.
                      </p>
                    )}
                  </>
                )}
              </div>

              <div className={`${CARD} px-2`} data-testid="card-radar">
                <div className="flex flex-wrap items-center justify-between gap-2 mb-1 px-3">
                  <div className={LBL}>Dimension radar</div>
                  <div className="flex items-center gap-3" data-testid="radar-legend">
                    <span className="inline-flex items-center gap-1.5 text-[10.5px] text-gray-500 dark:text-gray-400">
                      <span aria-hidden="true" className="w-2.5 h-2.5 rounded-[2px] bg-violet-600/60" /> You
                    </span>
                    <span className="inline-flex items-center gap-1.5 text-[10.5px] text-gray-500 dark:text-gray-400">
                      <span aria-hidden="true" className="w-3 border-t-2 border-dashed border-gray-400 dark:border-gray-500" /> {vm.radar.benchLabel}
                    </span>
                  </div>
                </div>
                {/* Keeps the design's footnote slot doing pointer duty (design
                    L117) with the corrected fact, plus the axis scale. */}
                <p className="text-[10.5px] text-gray-400 dark:text-gray-500 mb-3 px-3 leading-relaxed" data-testid="text-radar-footnote">
                  Each axis = % of that dimension&apos;s weighted maximum. {vm.radar.benchNote}{' '}
                  Skill coverage and complementarity are scored separately from Team — open the Team dimension.
                </p>
                <div className="px-4 pb-2">
                  <RadarChart radar={vm.radar} />
                </div>
              </div>
            </div>

            <div className={CARD} data-testid="card-dimensions">
              <div className="flex items-center justify-between mb-3 gap-2">
                <div className={LBL}>Dimensions · weakest first</div>
                <span className="text-[10.5px] text-gray-400 dark:text-gray-500">{vm.dimensionCount} dimensions · click to drill down</span>
              </div>
              <div className="space-y-2.5">
                {vm.dimensions.map((d) => (
                  <DimensionRow key={d.key} dim={d} investorView={investorView} onOpen={setDrawerKey} />
                ))}
              </div>
            </div>
          </div>

          {/* Bottom grid: weak points | benchmark + trajectory */}
          <div className="grid lg:grid-cols-[1.2fr_1fr] gap-4 items-start">
            <div className={CARD} data-testid="card-weak-points">
              <div className={`${LBL} mb-1`}>Weak-point analysis</div>
              <p className="text-[11px] text-gray-400 dark:text-gray-500 mb-3">Points still on the table per dimension — real engine math, not estimates.</p>
              <WeakPointList weakPoints={vm.weakPoints} investorView={investorView} clear={vm.weakPointsClear} overflowNote={vm.weakPointOverflow} />
            </div>

            <div className="space-y-4">
              <div className={CARD} data-testid="card-benchmark">
                <div className={`${LBL} mb-1`}>Benchmark comparison</div>
                <p className="text-[11px] text-gray-400 dark:text-gray-500 mb-3">{vm.benchmarkCaption}</p>
                <BenchmarkBars benchmarks={vm.benchmarks} markerPct={vm.markerPct} gapSentence={vm.gapSentence} />
              </div>

              <div className={CARD} data-testid="card-trajectory">
                <div className="flex items-center gap-2 mb-1">
                  <div className={LBL}>Score trajectory</div>
                  {vm.deltaDir === 'up' && (
                    <span className="text-[10.5px] font-bold text-emerald-600 dark:text-emerald-400 inline-flex items-center gap-1" data-testid="chip-improving">
                      <TrendingUp size={11} /> {vm.deltaIsPractice ? 'improving (practice)' : 'improving'}
                    </span>
                  )}
                </div>
                {/* Only rendered when the real slope reaches Tier 2 inside the
                    program window; no fake ETA. */}
                {vm.trajectory.summary && (
                  <div className="flex flex-wrap items-baseline gap-2 mb-1" data-testid="text-trajectory-eta">
                    <span className="text-[13.5px] font-bold text-emerald-600 dark:text-emerald-400 tabular-nums">{vm.trajectory.summary.headline}</span>
                    <span className="text-[11px] text-gray-400 dark:text-gray-500">{vm.trajectory.summary.pace}</span>
                  </div>
                )}
                <p className="text-[11px] text-gray-400 dark:text-gray-500 mb-2">{vm.trajectory.caption}</p>
                {vm.trajectory.mode === 'chart' ? (
                  <TrajectoryChart trajectory={vm.trajectory} />
                ) : (
                  <p className="text-[12px] text-gray-500 dark:text-gray-400 py-6 text-center"
                    data-testid={vm.trajectory.mode === 'single' ? 'trajectory-single' : 'trajectory-none'}>
                    {vm.trajectory.singleText}
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
          <div className="flex items-center justify-between mb-1 gap-2">
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
                        {f.kind === 'range' && <span className="tabular-nums text-gray-400 dark:text-gray-500">{form[f.key]}/{f.max}</span>}
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
                      {f.hint && <span className="block text-[10px] text-gray-400 dark:text-gray-500 mt-0.5">{f.hint}</span>}
                    </label>
                  ))}
                </div>
              </div>
            ))}
          </div>
          {runError && (
            <p className="mt-3 text-[12px] text-rose-500 dark:text-rose-400 inline-flex items-center gap-1.5" data-testid="text-run-error">
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

      <DimensionDrawer
        dim={drawerDim}
        investorView={investorView}
        onClose={() => setDrawerKey(null)}
        skillState={skillState}
        archetypeState={archetypeState}
      />

      <ExportReportModal
        open={exportOpen}
        contents={vm.exportMeta.contents}
        generating={generating}
        canGenerate={vm.hasData}
        error={exportError}
        onCancel={() => setExportOpen(false)}
        onGenerate={generatePdf}
      />
    </div>
  );
}
