// Spin-Out Lab workspace — the page an ACTIVE lab founder sees at /spinout-lab.
// Mirrors the workspace design handoff
// (attached_assets/Spin-Out_Lab_Workspace.dc_*.html): sticky program header
// with cohort + week/day chips and a segmented progress bar, a 4-card
// program timeline, the selected week's deliverables checklist, and the
// "Your unlocked tools" grid. Everything is driven by the live
// GET /spinout-lab/state payload (week, days_remaining, milestones,
// unlocked_features, cohort) — no simulated data outside the admin preview,
// which passes `previewAllUnlocked` to make every week browsable.
//
// Tools live INSIDE this page (per the design) — the app sidebar stays the
// user's normal navigation and is never replaced by lab-specific links.
import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  ArrowRight,
  Banknote,
  Building2,
  CalendarCheck,
  Check,
  Fingerprint,
  ChevronDown,
  ClipboardCheck,
  Compass,
  DollarSign,
  FileSignature,
  FileText,
  FlaskConical,
  Gauge,
  Landmark,
  Lock,
  Map as MapIcon,
  MessagesSquare,
  Palette,
  PieChart,
  Presentation,
  Radar,
  Rocket,
  ShieldCheck,
  Users,
} from 'lucide-react';

const SPRINT_DAYS = 28;

// Feature keys mirror the backend catalog (backend/app/api/routes/
// spinout_lab.py MILESTONES / Worker spinoutLabCatalog.ts). Routes reuse the
// same in-app destinations the old lab sidebar linked to.
export const TOOL_INFO = {
  // The lab-facing company record page (design: workspace tool pages); the
  // raw /projects list stays reachable from it via "Edit record".
  projects: { label: 'Startups', to: '/spinout-lab/startup', desc: 'Your company record and founding team', icon: Building2 },
  // Lab-facing discovery dashboard (design: workspace tool pages); the raw
  // interview-logging tool at /build/discovery stays reachable from it.
  'customer-discovery': { label: 'Customer Discovery', to: '/spinout-lab/discovery', desc: 'Interview log and ICP tracker', icon: MessagesSquare },
  // Lab-facing market page (design: workspace tool pages); the platform-wide
  // investor/partner MI dashboard stays at /market-intel.
  'market-intelligence': { label: 'Market Intel', to: '/spinout-lab/market', desc: 'TAM / SAM research and sizing', icon: Compass },
  // Week-3 investor-signals surface. The design shows "MI — Investor Signals"
  // as its own Week-3 card; the app consolidated it into the Market Intel
  // page's investor-fit section, so it links there. `uncounted` keeps it out of
  // the scorecard's per-week tool totals (the design's own scorecard excludes
  // it — Week 3 reads "5 of 5"), and `unlockWeek` gates it to Week 3 since it
  // has no standalone backend feature flag.
  misignals: { label: 'MI — Investor Signals', to: '/spinout-lab/market', desc: 'Scored investor-fit signals from your profiling', icon: Radar, uncounted: true, unlockWeek: 3 },
  // Lab-facing founder profiling report (design: workspace tool pages);
  // reads the Studio-built skills/values/archetype profile.
  profiling: { label: 'Profiling', to: '/spinout-lab/profiling', desc: 'Skills, values, and archetype report', icon: Fingerprint },
  // Lab-facing roadmap page (design: workspace tool pages); the raw kanban
  // stays reachable at /build/roadmap via the page's "Kanban view" button.
  roadmap: { label: 'Roadmap', to: '/spinout-lab/roadmap', desc: 'OKRs, milestones, and MVP scope', icon: MapIcon },
  'brand-builder': { label: 'Brand & Landing Pages', to: '/spinout-lab/brand', desc: 'Create landing pages for your audience', icon: Palette },
  'pitch-deck': { label: 'Pitch Deck Builder', to: '/spinout-lab/pitch-deck', desc: 'Auto-assemble your venture pitch deck', icon: Presentation },
  // Lab-facing readiness report + practice runs (design: workspace tool
  // pages); the partner/admin scoring console stays at /scoring.
  scoring: { label: 'Scoring Engine', to: '/spinout-lab/scoring', desc: 'Venture-readiness diligence', icon: Gauge },
  // Lab-facing matching + booking page; the full directory stays at /advisors.
  advisors: { label: 'Advisors', to: '/spinout-lab/advisors', desc: 'Matched advisor network', icon: Users },
  // Revenue capture + traction proof (metrics snapshots + project proof fields).
  revenue: { label: 'Revenue', to: '/spinout-lab/revenue', desc: 'Capture revenue & traction proof', icon: DollarSign },
  // Capital allocation + runway modeling; edits the SAME canonical
  // use_of_funds/funding_needed fields THE ASK deck slide reads.
  'use-of-funds': { label: 'Use of Funds', to: '/spinout-lab/use-of-funds', desc: 'Capital allocation & runway modeling', icon: PieChart },
  // Lab-facing partner session booking (design: Office Hours tool page);
  // /office-hours stays the advisor-side ops console.
  'office-hours': { label: 'Office Hours', to: '/spinout-lab/office-hours', desc: 'Book partner sessions', icon: CalendarCheck },
  'cofounder-match': { label: 'Co-founder Match', to: '/cofounder', desc: 'Co-founder sourcing', icon: Users },
  incorporate: { label: 'Incorporate', to: '/incorporate', desc: 'Entity formation', icon: Landmark },
  captable: { label: 'Cap Table', to: '/spinout-lab/captable', desc: 'Ownership ledger & dilution modeling', icon: PieChart },
  'section-83b': { label: '83(b) Election', to: '/incorporate/83b', desc: 'File within 30 days of your stock grant', icon: FileText },
  'cofounder-agreement': { label: 'Co-founder Agreement', to: '/spinout-lab/cofounder-agreement', desc: 'Founding team terms', icon: FileSignature },
  // No founder-facing capital surface exists yet (/capital is the investor
  // console) — card shows as coming soon until the lab version ships.
  // Lab-facing raise workspace (round + investor pipeline + data-room
  // readiness). The founder-persona workspace at /raise/capital stays intact.
  capital: { label: 'Capital', to: '/spinout-lab/capital', desc: 'Run your raise & data room', icon: Banknote },
  compliance: { label: 'Compliance', to: '/compliance', desc: 'Filing calendar & obligations', icon: ShieldCheck },
  // Studio Ops is a studio-wide surface, not a lab-gated feature — `ungated`
  // keeps its deliverable button visible without touching unlocked_features.
  // Founders reach it via the command center tab (/studio-ops redirects there).
  'studio-ops': { label: 'Studio Ops', to: '/build/command-center?tab=studio-ops', desc: 'Studio operating cadence', icon: CalendarCheck, ungated: true },
};

// Four program weeks. `chips` are the timeline summary chips (done derives
// from milestone keys when present, else from the week being complete);
// `deliverables` are the checklist rows for the selected-week panel.
export const WEEK_DEFS = [
  {
    num: 1,
    name: 'Idea & Customer',
    summary: 'Define the problem and ICP. Run market sizing seed research. Talk to customers and log every interview.',
    accentText: 'text-emerald-600 dark:text-emerald-400',
    accentBar: 'bg-emerald-500',
    activeRing: 'border-emerald-300 dark:border-emerald-700 ring-2 ring-emerald-500/20',
    chips: [
      { label: '1 Startup', keys: ['project_created'] },
      { label: '3 interviews', keys: ['customer_interview_logged_1', 'customer_interview_logged_2', 'customer_interview_logged_3'] },
      { label: 'TAM sized', keys: ['market_sizing_completed'] },
    ],
    features: ['projects', 'customer-discovery', 'market-intelligence', 'profiling'],
    leaveWith: 'Startup record · 3 customer interviews · TAM/SAM sized',
    deliverables: [
      { label: 'Create startup record', keys: ['project_created'], tool: 'projects' },
      { label: 'Log 5 customer interviews', keys: ['customer_interview_logged_1', 'customer_interview_logged_2', 'customer_interview_logged_3', 'customer_interview_logged_4', 'customer_interview_logged_5'], tool: 'customer-discovery' },
      { label: 'Size TAM / SAM with citations', keys: ['market_sizing_completed'], tool: 'market-intelligence' },
      { label: 'Complete skills, values & archetype assessment', keys: ['profiling_completed'], tool: 'profiling' },
      { label: 'Finalize ICP definition and validation criteria', keys: ['icp_defined'], tool: 'customer-discovery' },
      { label: 'Export or share initial Market Intel research', keys: ['market_research_shared'], tool: 'market-intelligence' },
    ],
  },
  {
    num: 2,
    name: 'Solution & Roadmap',
    summary: 'Scope the MVP. Set 90-day OKRs. Draft brand v1. Draft pitch deck v1.',
    accentText: 'text-violet-600 dark:text-violet-400',
    accentBar: 'bg-violet-600',
    activeRing: 'border-violet-300 dark:border-violet-700 ring-2 ring-violet-500/20',
    chips: [
      { label: '3+ OKRs', keys: ['okrs_created'] },
      { label: 'Brand basics', keys: ['brand_basics_filled'] },
      { label: 'Pitch deck v1', keys: ['pitch_deck_drafted'] },
    ],
    features: ['roadmap', 'brand-builder', 'pitch-deck', 'studio-ops'],
    leaveWith: 'MVP scope · 90-day OKRs · Brand v1 · Pitch deck v1',
    deliverables: [
      { label: 'Scope the MVP', keys: ['mvp_scoped'], tool: 'roadmap' },
      { label: 'Set 3+ OKRs (90-day)', keys: ['okrs_created'], tool: 'roadmap' },
      { label: 'Design landing pages', keys: ['landing_page_created'], tool: 'brand-builder' },
      { label: 'Draft pitch deck v1', keys: ['pitch_deck_drafted'], tool: 'pitch-deck' },
      { label: 'Studio Ops cadence set', keys: ['studio_ops_cadence_set'], tool: 'studio-ops' },
      { label: 'Draft Brand v1 (tagline, value prop, visual direction)', keys: ['brand_basics_filled'], tool: 'brand-builder' },
      { label: 'Map first 3 customer discovery follow-ups', keys: ['discovery_followups_mapped'], tool: 'customer-discovery' },
    ],
  },
  {
    num: 3,
    name: 'Validate & Team',
    summary: 'Run your first venture-readiness score. Match with advisors. Decide the co-founder track.',
    accentText: 'text-teal-600 dark:text-teal-400',
    accentBar: 'bg-teal-500',
    activeRing: 'border-teal-300 dark:border-teal-700 ring-2 ring-teal-500/20',
    chips: [
      { label: 'Score', keys: ['scoring_run_completed'] },
      { label: 'Advisor cadence', keys: ['advisor_meeting_booked'] },
      { label: 'Co-founder', keys: ['cofounder_request_sent'] },
    ],
    features: ['scoring', 'advisors', 'office-hours', 'cofounder-match', 'misignals', 'revenue'],
    leaveWith: 'Venture-readiness score · Advisor cadence · Co-founder decision',
    deliverables: [
      { label: 'Run venture-readiness score', keys: ['scoring_run_completed'], tool: 'scoring' },
      // The backend's week-3 gate is scoring PLUS EITHER of these two —
      // `altGroup` makes them count as ONE unit in every progress count,
      // or a validly completed week 3 could never read as fully done.
      { label: 'Establish advisor cadence', keys: ['advisor_meeting_booked'], tool: 'advisors', altGroup: 'validate-path' },
      { label: 'Decide co-founder track', keys: ['cofounder_request_sent'], tool: 'cofounder-match', altGroup: 'validate-path' },
      { label: 'Book a session in Office Hours', keys: ['office_hours_booked'], tool: 'office-hours' },
      { label: 'Bring revenue proof', keys: ['revenue_proof_added'], tool: 'revenue' },
      { label: 'Generate investor-ready revenue summary', keys: ['revenue_summary_generated'], tool: 'revenue' },
      { label: 'Score ≥70% confidence across 5+ dimensions', keys: ['scoring_confidence_70'], tool: 'scoring', optional: true },
    ],
  },
  {
    num: 4,
    name: 'Incorporate & Capital',
    summary: 'Incorporate the entity. Issue founder stock with vesting. File 83(b). Sign the co-founder agreement.',
    accentText: 'text-violet-600 dark:text-violet-400',
    accentBar: 'bg-violet-600',
    activeRing: 'border-violet-300 dark:border-violet-700 ring-2 ring-violet-500/20',
    chips: [
      { label: 'C-Corp', keys: ['incorporation_completed'] },
      { label: 'Cap table', keys: ['founder_stock_issued'] },
      { label: '83(b)', keys: ['section83b_filed'] },
    ],
    features: ['incorporate', 'captable', 'section-83b', 'cofounder-agreement', 'capital', 'compliance', 'use-of-funds'],
    leaveWith: 'Delaware C-Corp · Vesting cap table · 83(b) filed · Co-founder agreement',
    deliverables: [
      { label: 'Incorporate the entity', keys: ['incorporation_completed'], tool: 'incorporate' },
      { label: 'File incorporation docs and receive EIN', keys: ['ein_received'], tool: 'incorporate' },
      { label: 'Issue founder stock with vesting', keys: ['founder_stock_issued'], tool: 'captable' },
      { label: 'File 83(b) election', keys: ['section83b_filed'], tool: 'section-83b' },
      { label: 'Sign co-founder agreement (or solo declaration)', keys: ['cofounder_agreement_signed'], tool: 'cofounder-agreement' },
      { label: 'Lock the fundraise ask', keys: ['fundraise_ask_locked'], tool: 'capital' },
      { label: 'Fill in Use of Funds', keys: ['use_of_funds_filled'], tool: 'use-of-funds' },
      // Warm intros & the data room live on the Capital raise workspace —
      // there is no founder-facing "Investor Signals" surface.
      { label: 'Secure ≥3 warm investor intros', keys: ['investor_intros_secured'], tool: 'capital' },
      { label: 'Lock cap table with dilution modeling', keys: ['captable_locked'], tool: 'captable' },
      { label: 'Build data room with ≥8 key artifacts', keys: ['data_room_built'], tool: 'capital' },
    ],
  },
];

// Deliverable progress with either/or awareness: rows sharing an `altGroup`
// count as a single unit that is done when ANY member is done (mirrors the
// backend's `required_any` week-3 gate — see MILESTONES in spinout_lab.py).
export function countDeliverables(week, isRowDone) {
  const groupDone = new Map();
  let total = 0;
  let done = 0;
  week.deliverables.forEach((d) => {
    if (d.optional) return; // bonus rows never gate or count toward progress
    const rowDone = isRowDone(d);
    if (d.altGroup) {
      if (!groupDone.has(d.altGroup)) {
        groupDone.set(d.altGroup, rowDone);
        total += 1;
      } else if (rowDone) {
        groupDone.set(d.altGroup, true);
      }
    } else {
      total += 1;
      if (rowDone) done += 1;
    }
  });
  groupDone.forEach((v) => { if (v) done += 1; });
  return { done, total };
}

export function milestoneKeySet(milestones) {
  const out = new Set();
  (milestones || []).forEach((m) => {
    if (typeof m === 'string') out.add(m);
    else if (m && (m.key || m.milestone_key)) out.add(m.key || m.milestone_key);
  });
  return out;
}

function formatStartDate(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' });
}

export default function SpinoutLabWorkspace({ state, previewAllUnlocked = false }) {
  const navigate = useNavigate();
  const graduated = Boolean(state?.is_incorporated);
  const currentWeek = graduated ? 4 : Math.min(4, Math.max(1, Number(state?.week) || 1));
  const daysRemaining = Math.max(0, Number(state?.days_remaining) || 0);
  const dayNum = Math.min(SPRINT_DAYS, Math.max(1, SPRINT_DAYS - daysRemaining + 1));
  const done = useMemo(() => milestoneKeySet(state?.milestones), [state?.milestones]);
  const unlockedFeatures = useMemo(() => new Set(state?.unlocked_features || []), [state?.unlocked_features]);
  const startedLabel = formatStartDate(state?.started_at);
  const cohort = state?.cohort || null;
  const companyName = state?.application?.company_name || null;

  const [selected, setSelected] = useState(currentWeek);
  // Which completed-week summary panel is expanded (week num or null).
  const [openSummary, setOpenSummary] = useState(null);

  const weekStatus = (num) => {
    if (graduated || num < currentWeek) return 'done';
    if (num === currentWeek) return 'active';
    return previewAllUnlocked ? 'unlocked' : 'locked';
  };
  const weekBrowsable = (num) => weekStatus(num) !== 'locked';
  const featureUnlocked = (key) =>
    previewAllUnlocked || graduated || unlockedFeatures.has(key) || Boolean(TOOL_INFO[key]?.ungated) ||
    // Tools with no standalone backend flag (e.g. MI — Investor Signals) unlock
    // by program week instead of an `unlocked_features` entry.
    (TOOL_INFO[key]?.unlockWeek != null && currentWeek >= TOOL_INFO[key].unlockWeek);
  const chipDone = (weekNum, keys) =>
    keys.length > 0 ? keys.every((k) => done.has(k)) : weekStatus(weekNum) === 'done';

  const selectedDef = WEEK_DEFS.find((w) => w.num === selected) || WEEK_DEFS[0];
  const selectedStatus = weekStatus(selectedDef.num);
  const selectedCounts = countDeliverables(selectedDef, (d) => chipDone(selectedDef.num, d.keys));
  const deliverablesDone = selectedCounts.done;
  const progressPct = graduated ? 100 : Math.min(100, Math.round((dayNum / SPRINT_DAYS) * 100));

  const openTool = (key) => {
    const tool = TOOL_INFO[key];
    if (tool && featureUnlocked(key) && !tool.comingSoon) navigate(tool.to);
  };

  const ctaTools = selectedDef.features
    .filter((k) => featureUnlocked(k) && !TOOL_INFO[k]?.comingSoon)
    .slice(0, 2);

  // ---- 30-day scorecard (design section 3) — all derived from live state ----
  const weekStats = WEEK_DEFS.map((w) => {
    const status = weekStatus(w.num);
    const { done: dDone, total: dTotal } = countDeliverables(w, (d) => chipDone(w.num, d.keys));
    // `uncounted` tools show as cards but never count toward the scorecard's
    // per-week tool totals — mirrors the design, whose scorecard excludes them.
    const counted = w.features.filter((k) => !TOOL_INFO[k]?.uncounted);
    const tTotal = counted.length;
    const tUnlocked = counted.filter((k) => featureUnlocked(k)).length;
    const keyOutput = w.chips.filter((c) => chipDone(w.num, c.keys)).map((c) => c.label).join(' · ');
    return { def: w, status, dTotal, dDone, tTotal, tUnlocked, keyOutput };
  });
  const totalTools = weekStats.reduce((n, s) => n + s.tTotal, 0);
  const totalToolsUnlocked = weekStats.reduce((n, s) => n + s.tUnlocked, 0);
  const totalDeliverables = weekStats.reduce((n, s) => n + s.dTotal, 0);
  const totalDeliverablesDone = weekStats.reduce((n, s) => n + s.dDone, 0);

  const completedWeeks = weekStats.filter((s) => s.status === 'done');
  const upcomingWeeks = graduated ? [] : weekStats.filter((s) => s.def.num > currentWeek);
  const upcomingNums = upcomingWeeks.map((s) => s.def.num);
  const upcomingTitle =
    upcomingNums.length === 1
      ? `Week ${upcomingNums[0]}`
      : `Weeks ${upcomingNums.slice(0, -1).join(', ')} & ${upcomingNums[upcomingNums.length - 1]}`;

  const viewWeek = (num) => {
    setSelected(num);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const STATUS_BADGE = {
    done: { label: 'Completed', cls: 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300' },
    active: { label: 'Active', cls: 'bg-violet-100 dark:bg-violet-900/40 text-violet-700 dark:text-violet-300' },
    unlocked: { label: 'Unlocked', cls: 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300' },
    locked: { label: 'Locked', cls: 'bg-gray-100 dark:bg-gray-800 text-gray-400 dark:text-gray-500' },
  };

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 pb-24" data-testid="spinout-workspace">
      {/* ---- Program header ---- */}
      <div className="border-b border-gray-200 dark:border-gray-800 pb-4 mb-8">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-xl bg-violet-100 dark:bg-violet-900/40 flex items-center justify-center text-violet-600 dark:text-violet-300">
                <FlaskConical size={18} />
              </div>
              <h1 className="text-xl font-extrabold tracking-tight text-gray-900 dark:text-gray-50">Spin-Out Lab</h1>
              <span className="text-[11px] font-bold text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-900/30 border border-emerald-200 dark:border-emerald-800 rounded-md px-2 py-0.5">
                {graduated ? 'Graduated' : 'Accepted'}
              </span>
            </div>
            {(cohort || startedLabel) && (
              <span className="text-xs font-semibold text-gray-600 dark:text-gray-300 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg px-2.5 py-1.5" data-testid="workspace-cohort-chip">
                {[cohort, startedLabel ? `Started ${startedLabel}` : null].filter(Boolean).join(' · ')}
              </span>
            )}
            {!graduated && (
              <span className="inline-flex items-center gap-2 text-xs font-bold text-violet-700 dark:text-violet-300 bg-violet-50 dark:bg-violet-900/30 border border-violet-100 dark:border-violet-800 rounded-lg px-2.5 py-1.5" data-testid="workspace-week-chip">
                <span className="w-1.5 h-1.5 rounded-full bg-violet-600 dark:bg-violet-400 animate-pulse" />
                Week {currentWeek} of 4 · Day {dayNum}
              </span>
            )}
            {companyName && (
              <span className="text-xs font-semibold text-gray-500 dark:text-gray-400" data-testid="workspace-company-name">
                {companyName}
              </span>
            )}
          </div>
          <div className="flex items-center gap-3">
            <div
              className="w-12 h-12 rounded-full flex items-center justify-center flex-none"
              style={{ background: `conic-gradient(#7c3aed 0% ${progressPct}%, #e5e7eb ${progressPct}% 100%)` }}
              aria-hidden
            >
              <div className="w-9 h-9 rounded-full bg-white dark:bg-gray-950 flex items-center justify-center text-[10px] font-extrabold text-violet-700 dark:text-violet-300">
                {progressPct}%
              </div>
            </div>
            <div className="leading-tight">
              {previewAllUnlocked ? (
                <div className="text-sm font-bold text-gray-900 dark:text-gray-50" data-testid="preview-all-weeks-badge">
                  All weeks unlocked · {daysRemaining} days remaining
                </div>
              ) : (
                <>
                  <div className="text-sm font-bold text-gray-900 dark:text-gray-50">
                    {graduated ? 'Program complete' : `Week ${currentWeek} of 4`}
                  </div>
                  <div className="text-xs text-gray-500 dark:text-gray-400" data-testid="workspace-days-remaining">
                    {graduated ? 'Incorporated' : `${daysRemaining} days remaining`}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
        {/* Segmented week progress bar */}
        <div className="flex gap-1.5 pt-4">
          {WEEK_DEFS.map((w) => {
            const st = weekStatus(w.num);
            return (
              <div key={w.num} className="flex-1 flex flex-col gap-1">
                <div className="h-1.5 rounded-full overflow-hidden bg-gray-200 dark:bg-gray-800">
                  <div
                    className={`h-full rounded-full ${st === 'done' ? 'bg-emerald-500 w-full' : st === 'active' ? `${w.accentBar} animate-pulse` : 'w-0'}`}
                    style={st === 'active' ? { width: `${Math.min(100, Math.round((((dayNum - 1) % 7) + 1) / 7 * 100))}%` } : undefined}
                  />
                </div>
                <span className={`text-[11px] font-semibold ${st === 'active' ? w.accentText : st === 'done' ? 'text-emerald-600 dark:text-emerald-400' : 'text-gray-400 dark:text-gray-500'}`}>
                  Week {w.num}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* ---- Section 1: Program timeline ---- */}
      <section className="mb-9">
        <div className="text-[11px] font-bold uppercase tracking-wider text-gray-400 dark:text-gray-500 mb-3">Program timeline</div>
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3.5">
          {WEEK_DEFS.map((w) => {
            const st = weekStatus(w.num);
            const isSelected = selected === w.num;
            const clickable = weekBrowsable(w.num);
            return (
              <button
                key={w.num}
                type="button"
                data-testid={`workspace-week-card-${w.num}`}
                onClick={() => clickable && setSelected(w.num)}
                disabled={!clickable}
                className={`text-left rounded-2xl bg-white dark:bg-gray-900 border p-4 flex flex-col transition-shadow ${
                  isSelected ? w.activeRing : 'border-gray-200 dark:border-gray-800'
                } ${clickable ? 'cursor-pointer hover:shadow-md' : 'opacity-60 cursor-not-allowed'}`}
              >
                <div className="flex items-start justify-between gap-2 mb-2.5">
                  <div>
                    <div className={`text-[11px] font-bold uppercase tracking-wide ${w.accentText}`}>Week {w.num}</div>
                    <div className="text-[15px] font-bold text-gray-900 dark:text-gray-50">{w.name}</div>
                  </div>
                  {st === 'done' && (
                    <span className="inline-flex items-center gap-1 flex-none text-[10.5px] font-bold rounded-full px-2 py-0.5 bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300">
                      <Check size={11} /> Completed
                    </span>
                  )}
                  {st === 'active' && (
                    <span className="inline-flex items-center gap-1 flex-none text-[10.5px] font-bold rounded-full px-2 py-0.5 bg-violet-50 dark:bg-violet-900/40 text-violet-700 dark:text-violet-300">
                      <span className="w-1.5 h-1.5 rounded-full bg-violet-600 dark:bg-violet-400" /> Active · D{dayNum}
                    </span>
                  )}
                  {st === 'unlocked' && (
                    <span className="inline-flex items-center gap-1 flex-none text-[10.5px] font-bold rounded-full px-2 py-0.5 bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300">
                      <Check size={11} /> Unlocked
                    </span>
                  )}
                  {st === 'locked' && (
                    <span className="inline-flex items-center gap-1 flex-none text-[10.5px] font-bold rounded-full px-2 py-0.5 bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400">
                      <Lock size={10} /> Locked
                    </span>
                  )}
                </div>
                <p className="text-xs leading-snug text-gray-500 dark:text-gray-400 mb-3 line-clamp-2">{w.summary}</p>
                <div className="flex flex-wrap gap-1.5 mb-2.5">
                  {w.chips.map((c) => {
                    const cDone = chipDone(w.num, c.keys);
                    return (
                      <span
                        key={c.label}
                        className={`inline-flex items-center gap-1 text-[10.5px] font-semibold rounded-md px-1.5 py-0.5 ${
                          cDone
                            ? 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300'
                            : 'bg-gray-100 dark:bg-gray-800 text-gray-400 dark:text-gray-500'
                        }`}
                      >
                        {cDone ? <Check size={10} /> : <span className="w-2 h-2 rounded-full border border-current" />}
                        {c.label}
                      </span>
                    );
                  })}
                </div>
                <div className="mt-auto flex flex-wrap gap-1.5 pt-2.5 border-t border-gray-100 dark:border-gray-800">
                  {w.features.map((f) => {
                    const info = TOOL_INFO[f];
                    if (!info) return null;
                    const isUnlocked = featureUnlocked(f);
                    return (
                      <span
                        key={f}
                        className={`inline-flex items-center gap-1 text-[10px] font-semibold rounded-md px-1.5 py-0.5 border ${
                          isUnlocked
                            ? 'bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300 border-emerald-100 dark:border-emerald-800'
                            : 'bg-gray-50 dark:bg-gray-800/60 text-gray-400 dark:text-gray-500 border-gray-100 dark:border-gray-800'
                        }`}
                      >
                        {!isUnlocked && <Lock size={9} />}
                        {info.label}
                      </span>
                    );
                  })}
                </div>
              </button>
            );
          })}
        </div>
      </section>

      {/* ---- Section 2A: selected week header ---- */}
      <section className="mb-5">
        <div className="relative overflow-hidden rounded-2xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 p-6">
          <div className={`absolute top-0 left-0 bottom-0 w-1 ${selectedDef.accentBar}`} />
          <div className="flex flex-wrap gap-5 justify-between items-start">
            <div className="min-w-[260px]">
              <div className="flex items-center gap-2 mb-1.5">
                <span className={`inline-flex items-center gap-1.5 text-[10.5px] font-bold rounded-full px-2.5 py-0.5 ${
                  selectedStatus === 'active'
                    ? 'bg-violet-50 dark:bg-violet-900/40 text-violet-700 dark:text-violet-300'
                    : selectedStatus === 'done'
                      ? 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300'
                      : 'bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400'
                }`}>
                  {selectedStatus === 'active' && <span className="w-1.5 h-1.5 rounded-full bg-violet-600 dark:bg-violet-400 animate-pulse" />}
                  {selectedStatus === 'active'
                    ? 'Active this week — complete all modules to advance'
                    : selectedStatus === 'done'
                      ? 'Week complete'
                      : 'Browsing ahead'}
                </span>
              </div>
              <h2 className="text-2xl font-extrabold tracking-tight text-gray-900 dark:text-gray-50" data-testid="workspace-active-week-title">
                Week {selectedDef.num} — {selectedDef.name}
              </h2>
              <p className="mt-1.5 mb-4 text-sm text-gray-500 dark:text-gray-400 max-w-lg">{selectedDef.summary}</p>
              <div className="flex flex-wrap gap-2">
                {selectedDef.num === currentWeek && !graduated && (
                  <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-gray-700 dark:text-gray-200 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg px-2.5 py-1.5">
                    <Rocket size={13} className="text-violet-600 dark:text-violet-400" /> Day {dayNum} of {selectedDef.num * 7}
                  </span>
                )}
                <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-gray-700 dark:text-gray-200 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg px-2.5 py-1.5">
                  <ClipboardCheck size={13} className="text-violet-600 dark:text-violet-400" /> {deliverablesDone} of {selectedCounts.total} tasks done
                </span>
                <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-gray-700 dark:text-gray-200 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg px-2.5 py-1.5">
                  <Check size={13} className="text-violet-600 dark:text-violet-400" /> {selectedDef.features.filter((f) => featureUnlocked(f) && !TOOL_INFO[f]?.uncounted).length} tools unlocked
                </span>
              </div>
            </div>
            <div className="flex gap-2.5 flex-wrap">
              {ctaTools.map((key, i) => {
                const info = TOOL_INFO[key];
                return (
                  <Link
                    key={key}
                    to={info.to}
                    data-testid={`workspace-cta-${key}`}
                    className={
                      i === 0
                        ? 'h-10 px-4 rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-sm font-semibold inline-flex items-center gap-1.5 shadow-sm'
                        : 'h-10 px-4 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800 text-sm font-semibold inline-flex items-center gap-1.5'
                    }
                  >
                    Open {info.label} <ArrowRight size={14} />
                  </Link>
                );
              })}
            </div>
          </div>
        </div>
      </section>

      {/* ---- Section 2B + 2C: deliverables & tools ---- */}
      <section className="grid grid-cols-1 lg:grid-cols-[2fr,3fr] gap-5 items-start">
        <div>
          <div className="text-[11px] font-bold uppercase tracking-wider text-gray-400 dark:text-gray-500 mb-3">
            Week {selectedDef.num} deliverables
          </div>
          <div className="flex flex-col gap-2.5">
            {selectedDef.deliverables.map((d) => {
              const dDone = chipDone(selectedDef.num, d.keys);
              const keysDone = d.keys.filter((k) => done.has(k)).length;
              const partial = !dDone && d.keys.length > 1 && keysDone > 0;
              const info = TOOL_INFO[d.tool];
              const unlocked = featureUnlocked(d.tool);
              return (
                <div
                  key={d.label}
                  data-testid={`workspace-deliverable-${d.label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`}
                  className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl px-4 py-3.5 flex gap-3 items-start"
                >
                  <span
                    className={`w-5 h-5 flex-none mt-0.5 rounded-md flex items-center justify-center ${
                      dDone ? 'bg-emerald-500 text-white' : 'bg-white dark:bg-gray-900 border-2 border-gray-300 dark:border-gray-600'
                    }`}
                  >
                    {dDone && <Check size={12} />}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-semibold text-gray-900 dark:text-gray-50">{d.label}</span>
                      {d.altGroup && (
                        <span className="text-[10px] font-semibold rounded-full px-2 py-0.5 bg-violet-50 dark:bg-violet-900/30 text-violet-600 dark:text-violet-300 border border-violet-100 dark:border-violet-800">
                          either / or
                        </span>
                      )}
                      <span
                        className={`text-[10.5px] font-semibold rounded-full px-2 py-0.5 ${
                          dDone
                            ? 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300'
                            : partial
                              ? 'bg-violet-100 dark:bg-violet-900/40 text-violet-700 dark:text-violet-300'
                              : d.optional
                                ? 'bg-amber-50 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300'
                                : 'bg-gray-100 dark:bg-gray-800 text-gray-400 dark:text-gray-500'
                        }`}
                      >
                        {dDone ? 'Done' : partial ? 'In Progress' : d.optional ? 'Optional · boosts readiness' : 'Not started'}
                      </span>
                    </div>
                    {partial && (
                      <div className="mt-2 h-1.5 w-40 max-w-full rounded-full bg-gray-100 dark:bg-gray-800 overflow-hidden">
                        <div
                          className="h-full rounded-full bg-violet-600"
                          style={{ width: `${Math.round((keysDone / d.keys.length) * 100)}%` }}
                        />
                      </div>
                    )}
                  </div>
                  {info && unlocked && !info.comingSoon && (
                    <Link
                      to={info.to}
                      className="flex-none h-8 px-3 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-violet-700 dark:text-violet-300 hover:bg-violet-50 dark:hover:bg-violet-900/30 text-xs font-semibold inline-flex items-center gap-1 whitespace-nowrap"
                    >
                      Open {info.label} <ArrowRight size={12} />
                    </Link>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        <div>
          <div className="text-[11px] font-bold uppercase tracking-wider text-gray-400 dark:text-gray-500 mb-3">Your unlocked tools</div>
          {WEEK_DEFS.map((w) => {
            const st = weekStatus(w.num);
            const heading =
              w.num < currentWeek || graduated
                ? `Active — carried from Week ${w.num}`
                : w.num === currentWeek
                  ? `Active — Week ${w.num} unlocks`
                  : st === 'unlocked'
                    ? `Unlocked — Week ${w.num}`
                    : `Locked — unlocks in Week ${w.num}`;
            return (
              <div key={w.num} className="mb-4">
                <div className="text-[11px] font-semibold text-gray-400 dark:text-gray-500 mb-2">{heading}</div>
                <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-2.5">
                  {w.features.map((key) => {
                    const info = TOOL_INFO[key];
                    if (!info) return null;
                    const unlocked = featureUnlocked(key);
                    const clickable = unlocked && !info.comingSoon;
                    const Icon = info.icon;
                    return (
                      <div
                        key={key}
                        data-testid={`workspace-tool-${key}`}
                        onClick={() => openTool(key)}
                        role={clickable ? 'link' : undefined}
                        tabIndex={clickable ? 0 : undefined}
                        onKeyDown={(e) => { if (clickable && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); openTool(key); } }}
                        className={`rounded-xl p-3.5 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 flex flex-col ${
                          clickable ? 'cursor-pointer hover:shadow-md transition-shadow' : unlocked ? '' : 'opacity-60'
                        }`}
                      >
                        <div className="flex items-center justify-between mb-2">
                          <div className="w-8 h-8 rounded-lg bg-violet-50 dark:bg-violet-900/40 text-violet-600 dark:text-violet-300 flex items-center justify-center">
                            <Icon size={16} />
                          </div>
                          {!unlocked && <Lock size={13} className="text-gray-400 dark:text-gray-500" />}
                        </div>
                        <div className="text-[12.5px] font-bold text-gray-900 dark:text-gray-50 mb-0.5">{info.label}</div>
                        <div className="text-[11px] leading-snug text-gray-400 dark:text-gray-500 mb-2.5 flex-1">{info.desc}</div>
                        <div className="flex items-center justify-between gap-1.5">
                          <span
                            className={`text-[9.5px] font-bold rounded-md px-1.5 py-0.5 ${
                              unlocked
                                ? 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300'
                                : 'bg-gray-100 dark:bg-gray-800 text-gray-400 dark:text-gray-500'
                            }`}
                          >
                            {unlocked ? (w.num <= currentWeek || graduated ? 'Active' : `Unlocked · Wk ${w.num}`) : `Unlocks Wk ${w.num}`}
                          </span>
                          {clickable && (
                            <span className="text-[11px] font-semibold text-violet-700 dark:text-violet-300 inline-flex items-center gap-0.5">
                              Open <ArrowRight size={11} />
                            </span>
                          )}
                          {unlocked && info.comingSoon && (
                            <span className="text-[10px] font-semibold text-gray-400 dark:text-gray-500">Coming soon</span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* ---- Section 3: 30-day scorecard ---- */}
      <section className="mt-10" data-testid="workspace-scorecard">
        <div className="text-[11px] font-bold uppercase tracking-wider text-gray-400 dark:text-gray-500 mb-3">
          30-day scorecard
        </div>
        <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl overflow-hidden shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse min-w-[720px]">
              <thead>
                <tr className="bg-gray-50 dark:bg-gray-800/60">
                  <th className="text-left text-[11px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500 px-4 py-3 border-b border-gray-200 dark:border-gray-800" />
                  {weekStats.map((s) => (
                    <th
                      key={s.def.num}
                      className="text-left text-xs font-bold text-gray-900 dark:text-gray-50 px-4 py-3 border-b border-gray-200 dark:border-gray-800 border-l border-l-gray-100 dark:border-l-gray-800"
                    >
                      Week {s.def.num}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td className="text-[11px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500 px-4 py-3 border-b border-gray-100 dark:border-gray-800 whitespace-nowrap">Status</td>
                  {weekStats.map((s) => (
                    <td key={s.def.num} className="px-4 py-3 border-b border-gray-100 dark:border-gray-800" data-testid={`scorecard-status-w${s.def.num}`}>
                      <span className={`inline-flex items-center gap-1 text-[10.5px] font-bold rounded-full px-2 py-0.5 ${STATUS_BADGE[s.status].cls}`}>
                        {s.status === 'done' || s.status === 'unlocked' ? <Check size={11} /> : s.status === 'locked' ? <Lock size={10} /> : <span className="w-1.5 h-1.5 rounded-full bg-current" />}
                        {STATUS_BADGE[s.status].label}
                      </span>
                    </td>
                  ))}
                </tr>
                <tr>
                  <td className="text-[11px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500 px-4 py-3 border-b border-gray-100 dark:border-gray-800 whitespace-nowrap">Deliverables</td>
                  {weekStats.map((s) => (
                    <td key={s.def.num} className="px-4 py-3 border-b border-gray-100 dark:border-gray-800">
                      {s.status === 'done' || s.status === 'active' ? (
                        <div>
                          <div className="text-[12.5px] font-medium text-gray-700 dark:text-gray-200 mb-1">{s.dDone} of {s.dTotal}</div>
                          <div className="h-1.5 rounded-full bg-gray-100 dark:bg-gray-800 overflow-hidden max-w-[120px]">
                            <div
                              className={`h-full rounded-full ${s.dDone >= s.dTotal ? 'bg-emerald-500' : 'bg-violet-600'}`}
                              style={{ width: `${s.dTotal ? Math.round((s.dDone / s.dTotal) * 100) : 0}%` }}
                            />
                          </div>
                        </div>
                      ) : (
                        <span className="text-[12.5px] text-gray-300 dark:text-gray-600">—</span>
                      )}
                    </td>
                  ))}
                </tr>
                <tr>
                  <td className="text-[11px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500 px-4 py-3 border-b border-gray-100 dark:border-gray-800 whitespace-nowrap">Tools unlocked</td>
                  {weekStats.map((s) => (
                    <td key={s.def.num} className="px-4 py-3 border-b border-gray-100 dark:border-gray-800">
                      {s.tUnlocked > 0 ? (
                        <span className="text-[12.5px] font-semibold text-gray-900 dark:text-gray-50">{s.tUnlocked} of {s.tTotal}</span>
                      ) : (
                        <span className="text-[12.5px] text-gray-300 dark:text-gray-600">—</span>
                      )}
                    </td>
                  ))}
                </tr>
                <tr>
                  <td className="text-[11px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500 px-4 py-3 whitespace-nowrap">Key output</td>
                  {weekStats.map((s) => (
                    <td key={s.def.num} className="px-4 py-3">
                      {s.keyOutput ? (
                        <span className="text-[12.5px] text-gray-600 dark:text-gray-300">{s.keyOutput}</span>
                      ) : (
                        <span className="text-[12.5px] text-gray-300 dark:text-gray-600">—</span>
                      )}
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5 mt-3.5">
          {[
            { label: 'Total tools unlocked', value: `${totalToolsUnlocked} of ${totalTools}`, testid: 'workspace-kpi-tools' },
            { label: 'Deliverables completed', value: `${totalDeliverablesDone} of ${totalDeliverables}`, testid: 'workspace-kpi-deliverables' },
            { label: 'Days remaining', value: `${graduated ? 0 : daysRemaining}`, testid: 'workspace-kpi-days' },
          ].map((k) => (
            <div key={k.label} data-testid={k.testid} className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl px-4.5 py-4 shadow-sm">
              <div className="text-[11px] font-bold uppercase tracking-wider text-gray-400 dark:text-gray-500 mb-1.5">{k.label}</div>
              <div className="text-xl font-semibold text-gray-900 dark:text-gray-50 tracking-tight">{k.value}</div>
            </div>
          ))}
        </div>
      </section>

      {/* ---- Section 4: completed week summaries ---- */}
      {completedWeeks.length > 0 && (
        <section className="mt-10">
          <div className="flex flex-col gap-3">
            {completedWeeks.map((s) => {
              const open = openSummary === s.def.num;
              return (
                <div
                  key={s.def.num}
                  data-testid={`workspace-week-summary-${s.def.num}`}
                  className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl shadow-sm overflow-hidden"
                >
                  <button
                    type="button"
                    onClick={() => setOpenSummary(open ? null : s.def.num)}
                    className="w-full flex items-center justify-between gap-3 px-5 py-4 text-left"
                  >
                    <span className="flex items-center gap-2.5">
                      <span className="w-[22px] h-[22px] rounded-full bg-emerald-100 dark:bg-emerald-900/40 text-emerald-600 dark:text-emerald-400 flex items-center justify-center">
                        <Check size={13} />
                      </span>
                      <span className="text-[14.5px] font-bold text-gray-900 dark:text-gray-50">Week {s.def.num} Summary</span>
                      <span className="text-xs text-gray-400 dark:text-gray-500">Completed · {s.dDone} of {s.dTotal} deliverables</span>
                    </span>
                    <ChevronDown size={18} className={`text-gray-400 dark:text-gray-500 transition-transform ${open ? 'rotate-180' : ''}`} />
                  </button>
                  {open && (
                    <div className="px-5 pb-5 pt-1 border-t border-gray-100 dark:border-gray-800">
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 mt-4">
                        <div>
                          <div className="text-[11px] font-bold uppercase tracking-wider text-gray-400 dark:text-gray-500 mb-2">Deliverables</div>
                          <div className="flex flex-col gap-1.5">
                            {s.def.deliverables.map((d) => {
                              const dDone = chipDone(s.def.num, d.keys);
                              return (
                                <div key={d.label} className="flex items-center gap-2 text-[12.5px] text-gray-700 dark:text-gray-200">
                                  <span className={`w-4 h-4 flex-none rounded flex items-center justify-center ${dDone ? 'bg-emerald-500 text-white' : 'border-2 border-gray-300 dark:border-gray-600'}`}>
                                    {dDone && <Check size={10} />}
                                  </span>
                                  {d.label}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                        <div>
                          <div className="text-[11px] font-bold uppercase tracking-wider text-gray-400 dark:text-gray-500 mb-2">Tools from this week</div>
                          <div className="flex flex-wrap gap-1.5">
                            {s.def.features.map((k) => {
                              const info = TOOL_INFO[k];
                              if (!info) return null;
                              const clickable = featureUnlocked(k) && !info.comingSoon;
                              return clickable ? (
                                <Link
                                  key={k}
                                  to={info.to}
                                  className="text-[11px] font-semibold text-violet-700 dark:text-violet-300 bg-violet-50 dark:bg-violet-900/30 border border-violet-100 dark:border-violet-800 rounded-md px-2 py-1 hover:bg-violet-100 dark:hover:bg-violet-900/50"
                                >
                                  {info.label}
                                </Link>
                              ) : (
                                <span key={k} className="text-[11px] font-semibold text-gray-400 dark:text-gray-500 bg-gray-50 dark:bg-gray-800 border border-gray-100 dark:border-gray-700 rounded-md px-2 py-1">
                                  {info.label}
                                </span>
                              );
                            })}
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* ---- Section 6: upcoming week previews ---- */}
      {upcomingWeeks.length > 0 && (
        <section className="mt-10">
          <div className="text-[11px] font-bold uppercase tracking-wider text-gray-400 dark:text-gray-500 mb-3">
            Available — {upcomingTitle}
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {upcomingWeeks.map((s) => (
              <button
                key={s.def.num}
                type="button"
                data-testid={`workspace-preview-week-${s.def.num}`}
                onClick={() => viewWeek(s.def.num)}
                className="text-left rounded-2xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 p-5 hover:shadow-md transition-shadow"
              >
                <div className="text-[11px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">Week {s.def.num}</div>
                <div className="text-base font-bold text-gray-900 dark:text-gray-50 mb-3">{s.def.name}</div>
                <div className="flex flex-wrap gap-1.5 mb-3.5">
                  {s.def.features.map((k) => {
                    const info = TOOL_INFO[k];
                    return info ? (
                      <span
                        key={k}
                        className="text-[10.5px] font-semibold text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-900/30 border border-emerald-100 dark:border-emerald-800 rounded-md px-2 py-0.5"
                      >
                        {info.label}
                      </span>
                    ) : null;
                  })}
                </div>
                <div className="text-xs text-gray-400 dark:text-gray-500 leading-relaxed">
                  <span className="font-semibold text-gray-500 dark:text-gray-400">You leave with:</span> {s.def.leaveWith}
                </div>
                <div className="mt-3.5 text-xs font-semibold text-violet-700 dark:text-violet-300">View week →</div>
              </button>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
