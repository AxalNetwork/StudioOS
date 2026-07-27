import React, { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Check, Loader2, ArrowRight, FlaskConical, Globe, Circle, Lock } from "lucide-react";
import { api, spinoutLab } from "../lib/api";
import { deckReadinessState } from "../lib/deckReadiness";
import { useAuth } from "../hooks/useAuthSync";
import { reportError } from "../lib/log";
import SpinoutLabMarketingPage from "./SpinoutLabMarketingPage";

const WEEK_MILESTONES = {
  1: ["project_created", "customer_interview_logged_1", "customer_interview_logged_2", "customer_interview_logged_3"],
  2: ["okrs_created", "brand_basics_filled", "pitch_deck_drafted"],
  3: ["scoring_run_completed", "advisor_meeting_booked", "cofounder_request_sent"],
  4: ["incorporation_completed"],
};

export const MILESTONE_LABELS = {
  project_created: "Create your first startup",
  customer_interview_logged_1: "Log customer interview #1",
  customer_interview_logged_2: "Log customer interview #2",
  customer_interview_logged_3: "Log customer interview #3",
  okrs_created: "Set your quarter OKRs",
  brand_basics_filled: "Fill in brand basics",
  pitch_deck_drafted: "Draft your pitch deck",
  scoring_run_completed: "Run the AI scoring engine",
  advisor_meeting_booked: "Book an advisor meeting",
  cofounder_request_sent: "Send a co-founder request",
  incorporation_completed: "Complete incorporation",
};

export const PIPELINE_PHASES = [
  {
    name: "Validate", days: "Days 1–7",
    backendWeek: 1,
    milestones: WEEK_MILESTONES[1],
    tools: [ { label: "Startups", to: "/projects" }, { label: "Customer Discovery", to: "/customer-discovery" }, { label: "Market Intelligence", to: "/market-intel" } ],
    color: "violet"
  },
  {
    name: "Structure", days: "Days 8–14",
    backendWeek: 2,
    milestones: WEEK_MILESTONES[2],
    tools: [ { label: "Roadmap & MVP", to: "/build/roadmap" }, { label: "Brand Builder", to: "/build/brand" }, { label: "Pitch Deck Builder", to: "/build/deck" } ],
    color: "blue"
  },
  {
    name: "Build", days: "Days 15–21",
    backendWeek: 3,
    milestones: WEEK_MILESTONES[3],
    tools: [ { label: "Scoring", to: "/scoring" }, { label: "Advisors", to: "/advisors" }, { label: "Office Hours", to: "/office-hours" }, { label: "Co-founder Match", to: "/cofounder" } ],
    color: "teal"
  },
  {
    name: "Pitch", days: "Days 22–26",
    backendWeek: 4,
    milestones: [],
    tools: [ { label: "Capital", to: "/capital" } ],
    color: "amber"
  },
  {
    name: "Fund", days: "Days 27–30",
    backendWeek: 4,
    milestones: WEEK_MILESTONES[4],
    tools: [ { label: "Incorporate", to: "/incorporate" }, { label: "Cap Table", to: "/build/captable" }, { label: "Section 83(b)", to: "/incorporate/83b" }, { label: "Cofounder Agreement", to: "/incorporate/cofounder-agreement" }, { label: "Compliance", to: "/compliance" }, { label: "KYC", to: "/kyc" } ],
    color: "pink"
  }
];

export const PHASE_THEMES = {
  violet: {
    bg: "bg-violet-50/50 dark:bg-violet-950/20", border: "border-violet-200 dark:border-violet-900/50",
    chip: "bg-violet-100 dark:bg-violet-900/60", ink: "text-violet-700 dark:text-violet-300",
    ring: "ring-violet-400 dark:ring-violet-500 shadow-violet-500/20", fill: "#8b5cf6"
  },
  blue: {
    bg: "bg-blue-50/50 dark:bg-blue-950/20", border: "border-blue-200 dark:border-blue-900/50",
    chip: "bg-blue-100 dark:bg-blue-900/60", ink: "text-blue-700 dark:text-blue-300",
    ring: "ring-blue-400 dark:ring-blue-500 shadow-blue-500/20", fill: "#3b82f6"
  },
  teal: {
    bg: "bg-teal-50/50 dark:bg-teal-950/20", border: "border-teal-200 dark:border-teal-900/50",
    chip: "bg-teal-100 dark:bg-teal-900/60", ink: "text-teal-700 dark:text-teal-300",
    ring: "ring-teal-400 dark:ring-teal-500 shadow-teal-500/20", fill: "#0d9488"
  },
  amber: {
    bg: "bg-amber-50/50 dark:bg-amber-950/20", border: "border-amber-200 dark:border-amber-900/50",
    chip: "bg-amber-100 dark:bg-amber-900/60", ink: "text-amber-700 dark:text-amber-300",
    ring: "ring-amber-400 dark:ring-amber-500 shadow-amber-500/20", fill: "#d97706"
  },
  pink: {
    bg: "bg-pink-50/50 dark:bg-pink-950/20", border: "border-pink-200 dark:border-pink-900/50",
    chip: "bg-pink-100 dark:bg-pink-900/60", ink: "text-pink-700 dark:text-pink-300",
    ring: "ring-pink-400 dark:ring-pink-500 shadow-pink-500/20", fill: "#db2777"
  }
};

const DIconCorp = () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 21V8l8-5 8 5v13"/><path d="M9 21v-6h6v6"/><path d="M9 11h.01M15 11h.01"/></svg>;
const DIconCap = () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 3v9l6 4"/></svg>;
const DIconFile83 = () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/><path d="M9 15l2 2 4-4"/></svg>;
const DIconDeck = () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="12" rx="2"/><path d="M12 16v4M8 20h8"/></svg>;
const DIconModel = () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 3v18h18"/><path d="M7 15l3-4 3 3 5-7"/></svg>;
const DIconIntro = () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="9" cy="8" r="3.2"/><path d="M3 20c0-3.3 2.7-5 6-5s6 1.7 6 5"/><path d="M16 11a3 3 0 0 0 0-6"/><path d="M21 20c0-2.5-1.3-4-3.5-4.6"/></svg>;
const DIconAdvisor = () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3l2.5 5 5.5.8-4 3.9.9 5.5L12 21l-4.9-2.6.9-5.5-4-3.9L9.5 8z"/></svg>;
const DIconDataroom = () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>;
const DIconBadge = () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="9" r="6"/><path d="M9 14.5 8 22l4-2 4 2-1-7.5"/></svg>;

export const DELIVERABLES = [
  { icon: <DIconCorp />, name: "Delaware C-Corp", desc: "Delaware C-Corp formation handled and filed." },
  { icon: <DIconCap />, name: "Vesting Cap Table", desc: "Founder equity with 4-year vest, 1-year cliff on Carta." },
  { icon: <DIconFile83 />, name: "83(b) Election", desc: "Section 83(b) election generated, tracked, and filed." },
  { icon: <DIconDeck />, name: "Pitch Deck", desc: "12-slide venture-standard deck, designed and reviewed." },
  { icon: <DIconModel />, name: "Financial Model", desc: "3-year P&L, revenue model, and unit economics." },
  { icon: <DIconIntro />, name: "Warm Introductions", desc: "5–10 curated intros to the Meridian investor network." },
  { icon: <DIconAdvisor />, name: "Advisor Network", desc: "2 matched advisors with equity agreements in place." },
  { icon: <DIconDataroom />, name: "Data Room", desc: "Organized deal room ready for investor due diligence." },
  { icon: <DIconBadge />, name: "Verified Badge", desc: "Spin-Out Lab Alumni badge for your profile." }
];

export const TRACKER_BOARD = [
  { name: 'VALIDATE', count: 1, accent: 'border-violet-500', tint: 'bg-violet-100 text-violet-700 dark:bg-violet-900/50 dark:text-violet-300', cards: [
    { initials: 'HL', name: 'Halyard', desc: 'Ops copilot for shipyards', day: 'Day 4', bg: 'bg-violet-200 dark:bg-violet-900', ink: 'text-violet-800 dark:text-violet-200', advisor: 'Rae Osei', advInit: 'RO' }
  ] },
  { name: 'STRUCTURE', count: 1, accent: 'border-blue-500', tint: 'bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300', cards: [
    { initials: 'CS', name: 'Cindershift', desc: 'Wildfire risk models', day: 'Day 9', bg: 'bg-blue-200 dark:bg-blue-900', ink: 'text-blue-800 dark:text-blue-200', advisor: 'Marcus Lin', advInit: 'ML' }
  ] },
  { name: 'BUILD', count: 2, accent: 'border-teal-500', tint: 'bg-teal-100 text-teal-700 dark:bg-teal-900/50 dark:text-teal-300', cards: [
    { initials: 'TS', name: 'Tessella', desc: 'Composable data grids', day: 'Day 14', bg: 'bg-teal-200 dark:bg-teal-900', ink: 'text-teal-800 dark:text-teal-200', advisor: 'Priya Nair', advInit: 'PN' },
    { initials: 'NB', name: 'Northbeam', desc: 'Grid-scale battery ops', day: 'Day 16', bg: 'bg-emerald-200 dark:bg-emerald-900', ink: 'text-emerald-800 dark:text-emerald-200', advisor: 'Sam Ortiz', advInit: 'SO' }
  ] },
  { name: 'PITCH', count: 1, accent: 'border-amber-500', tint: 'bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-300', cards: [
    { initials: 'QL', name: 'Quill', desc: 'AI contract review', day: 'Day 22', bg: 'bg-amber-200 dark:bg-amber-900', ink: 'text-amber-800 dark:text-amber-200', advisor: 'Dana Whit', advInit: 'DW' }
  ] },
  { name: 'FUNDED', count: 1, accent: 'border-pink-500', tint: 'bg-pink-100 text-pink-700 dark:bg-pink-900/50 dark:text-pink-300', cards: [
    { initials: 'VD', name: 'Verda', desc: 'Clinical trial matching', day: 'Day 29', bg: 'bg-pink-200 dark:bg-pink-900', ink: 'text-pink-800 dark:text-pink-200', advisor: 'Leo Park', advInit: 'LP' }
  ] }
];

function DeckReadinessCard() {
  const [preview, setPreview] = useState(null);
  const [previewLoading, setPreviewLoading] = useState(true);

  const fetchPreview = useCallback((isAlive, { showLoading = false } = {}) => {
    if (showLoading) setPreviewLoading(true);
    return api
      .listProjects()
      .then((r) => {
        const list = Array.isArray(r) ? r : r?.projects || [];
        const projectId = list[0]?.id;
        if (!projectId) throw Object.assign(new Error("no-project"), { silent: true });
        return api.spinoutDeckPreview(projectId);
      })
      .then((r) => {
        if (!isAlive()) return;
        setPreview({ gaps: Array.isArray(r?.gaps) ? r.gaps : [], draft: !!r?.draft, programDay: Number.isFinite(r?.program_day) ? r.program_day : null });
      })
      .catch((e) => {
        if (!isAlive()) return;
        setPreview(null);
        if (e?.status !== 402 && !e?.silent) reportError("spinout-lab:deck-preview", e);
      })
      .finally(() => { if (isAlive() && showLoading) setPreviewLoading(false); });
  }, []);

  useEffect(() => {
    let alive = true;
    fetchPreview(() => alive, { showLoading: true }).finally(() => { if (alive) setPreviewLoading(false); });
    return () => { alive = false; };
  }, [fetchPreview]);

  useEffect(() => {
    let alive = true;
    let inFlight = false;
    const refreshPreview = () => {
      if (!alive || inFlight) return;
      inFlight = true;
      fetchPreview(() => alive).finally(() => { inFlight = false; });
    };
    window.addEventListener("spinout-lab:advanced", refreshPreview);
    window.addEventListener("focus", refreshPreview);
    return () => {
      alive = false;
      window.removeEventListener("spinout-lab:advanced", refreshPreview);
      window.removeEventListener("focus", refreshPreview);
    };
  }, [fetchPreview]);

  const readiness = deckReadinessState({ previewLoading, deckPreview: preview });
  if (readiness === "hidden") return null;

  const dayLabel = preview?.programDay != null ? `Day ${preview.programDay} of 28` : null;

  if (readiness === "loading") {
    return (
      <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400 mt-4">
        <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> Checking Demo Day deck…
      </div>
    );
  }
  if (readiness === "gaps") {
    return (
      <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4 dark:bg-amber-950/30 dark:border-amber-900">
        <div className="text-sm font-semibold text-amber-900 dark:text-amber-200 mb-1">
          Demo Day deck is {preview.gaps.length} items from ready
        </div>
        <ul className="space-y-1 mb-2">
          {preview.gaps.slice(0, 3).map((g, i) => (
            <li key={i} className="text-xs text-amber-800 dark:text-amber-300 flex gap-2"><span aria-hidden="true">•</span><span>{g}</span></li>
          ))}
          {preview.gaps.length > 3 && <li className="text-[11px] text-amber-700/70 dark:text-amber-400/70">+{preview.gaps.length - 3} more</li>}
        </ul>
        <Link to="/build/deck?method_id=axal_spinout_demoday" className="text-xs font-semibold text-amber-700 hover:text-amber-900 dark:text-amber-400">Open deck builder →</Link>
      </div>
    );
  }
  if (readiness === "draft") {
    return (
      <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4 dark:bg-amber-950/30 dark:border-amber-900">
        <div className="flex items-center justify-between gap-3 flex-wrap mb-1">
          <div className="flex items-center gap-2 text-sm font-semibold text-amber-900 dark:text-amber-200">
            <Check className="w-4 h-4" aria-hidden="true" /> Every deck section is filled
          </div>
          <span className="text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded bg-amber-200/70 text-amber-800 dark:bg-amber-900/60 dark:text-amber-200">
            Draft
          </span>
        </div>
        <div className="text-[11px] text-amber-700/80 dark:text-amber-400/80">
          {dayLabel
            ? `Still in the Lab (${dayLabel}), so exports are marked as a draft until you finish the 28-day program.`
            : "Your program isn’t complete yet, so exports are marked as a draft."}
        </div>
      </div>
    );
  }
  return (
    <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 p-4 dark:bg-emerald-950/30 dark:border-emerald-900 flex items-center gap-2 text-sm font-semibold text-emerald-900 dark:text-emerald-200">
      <Check className="w-4 h-4" aria-hidden="true" /> Demo Day deck is ready
    </div>
  );
}

// Task #7 — "You're in" celebration for admitted-but-not-started founders.
// Rendered on /spinout-lab (sidebar stays); the CTA calls the existing
// start endpoint and hands over to the workspace Dashboard.
function CongratulationsScreen({ cohort, onStart, starting, startError }) {
  return (
    <div className="min-h-[100dvh] bg-[#F8F8FA] dark:bg-gray-950 font-sans text-gray-900 dark:text-gray-100 flex items-center justify-center px-6 py-16">
      <div className="max-w-[620px] w-full text-center">
        <div className="rounded-[24px] p-10 md:p-14 text-white relative overflow-hidden mb-6" style={{ background: 'radial-gradient(1200px 400px at 12% -20%,rgba(139,92,246,.5),transparent 60%),linear-gradient(115deg,#1e1b3a 0%,#2a1d54 55%,#3b1d6e 100%)' }}>
          <div className="relative z-10">
            <div className="w-16 h-16 mx-auto mb-5 rounded-2xl bg-white/10 border border-white/20 flex items-center justify-center">
              <FlaskConical size={30} className="text-violet-300" />
            </div>
            <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-white/10 border border-white/20 text-[12.5px] font-semibold text-[#ede9fe] mb-4">
              Spin-Out Lab · {cohort || 'Next cohort'}
            </div>
            <h1 className="m-0 text-[40px] leading-[1.05] font-black tracking-[-0.03em] text-transparent bg-clip-text" style={{ backgroundImage: 'linear-gradient(90deg,#fff,#c4b5fd)', WebkitBackgroundClip: 'text' }}>
              Congratulations — you're in.
            </h1>
            <p className="mt-4 mb-8 text-[16px] text-[#cbc4e8] font-medium leading-relaxed">
              You've been admitted to the Spin-Out Lab. Over the next 30 days you'll go
              from idea to incorporated — customer discovery, MVP scope,
              venture-readiness scoring, and Delaware C-Corp formation.
            </p>
            <button
              type="button"
              onClick={onStart}
              disabled={starting}
              className="inline-flex items-center gap-2 bg-white dark:bg-gray-100 text-violet-900 font-bold text-[16px] px-8 py-4 rounded-2xl hover:bg-violet-50 dark:hover:bg-white transition-colors disabled:opacity-60"
            >
              {starting ? <Loader2 size={18} className="animate-spin" aria-hidden="true" /> : <ArrowRight size={18} aria-hidden="true" />}
              Start Week 1
            </button>
          </div>
        </div>
        {startError && (
          <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-xl p-3 px-4 dark:bg-red-950/30 dark:border-red-900 dark:text-red-400">
            {startError}
          </div>
        )}
        <p className="text-[13px] text-gray-500 dark:text-gray-400">
          Week 1 opens your founder workspace: the 4-week program timeline, your
          deliverables checklist, and every Lab tool as it unlocks.
        </p>
      </div>
    </div>
  );
}

function Dashboard({ state, onComplete, completing, completeError }) {
  const week = Math.max(1, Math.min(4, state.week || 1));
  const completedKeys = new Set((state.milestones || []).map((m) => m.key));
  const isIncorporated = completedKeys.has("incorporation_completed");
  
  const startedAt = state.started_at;
  const startedAtStr = startedAt ? new Date(startedAt).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }) : "Recently";

  return (
    <div className="min-h-[100dvh] bg-[#F8F8FA] dark:bg-gray-950 font-sans text-gray-900 dark:text-gray-100 flex flex-col">
      <main className="flex-1 w-full max-w-[1080px] mx-auto px-6 py-8 pb-20">
        
        {/* HEADER */}
        <div className="flex flex-wrap gap-5 items-start justify-between mb-6">
          <div>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-violet-100 dark:bg-violet-900/30 flex items-center justify-center text-violet-600 dark:text-violet-400">
                 <FlaskConical size={20} />
              </div>
              <h1 className="m-0 text-3xl font-extrabold tracking-tight">Spin-Out Lab</h1>
              <span className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-emerald-50 border border-emerald-200 text-xs font-semibold text-emerald-700 dark:bg-emerald-500/10 dark:border-emerald-500/20 dark:text-emerald-400">
                <span className="w-2 h-2 rounded-full bg-emerald-500" style={{animation: 'wsPulse 2s infinite'}}></span>
                {state.cohort || 'Cohort 3'} · Active
              </span>
            </div>
            <p className="mt-2.5 ml-[52px] text-[15px] text-gray-500 dark:text-gray-400">From idea to incorporated in 30 days. Started {startedAtStr}.</p>
          </div>
        </div>

        {/* JURISDICTION SELECTOR */}
        <div className="flex flex-wrap items-center gap-3 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-[14px] p-3 px-4 mb-8 shadow-sm">
          <div className="flex items-center gap-2">
            <Globe className="w-4 h-4 text-violet-600 dark:text-violet-400" />
            <span className="text-[13px] font-bold text-gray-900 dark:text-gray-100">Incorporation jurisdiction</span>
          </div>
          <div className="flex gap-1.5 flex-wrap">
            <button className="h-[34px] px-3 rounded-lg bg-violet-50 dark:bg-violet-500/10 text-violet-700 dark:text-violet-400 border border-violet-200 dark:border-violet-500/30 text-[13px] font-semibold">Delaware C-Corp</button>
            <button disabled className="h-[34px] px-3 rounded-lg bg-white dark:bg-gray-900 text-gray-500 dark:text-gray-400 border border-gray-200 dark:border-gray-800 text-[13px] font-semibold opacity-60 flex items-center gap-1.5">
              UK Ltd <span className="text-[9px] font-bold uppercase tracking-wider bg-gray-100 dark:bg-gray-800 text-gray-400 dark:text-gray-500 rounded px-1.5 py-0.5">Soon</span>
            </button>
            <button disabled className="h-[34px] px-3 rounded-lg bg-white dark:bg-gray-900 text-gray-500 dark:text-gray-400 border border-gray-200 dark:border-gray-800 text-[13px] font-semibold opacity-60 flex items-center gap-1.5">
              French SAS <span className="text-[9px] font-bold uppercase tracking-wider bg-gray-100 dark:bg-gray-800 text-gray-400 dark:text-gray-500 rounded px-1.5 py-0.5">Soon</span>
            </button>
          </div>
          <span className="text-xs text-gray-400 dark:text-gray-500 ml-auto hidden md:inline">Entity & equity filing update across the program →</span>
        </div>

        {/* HERO SECTION */}
        <section className="rounded-[20px] p-[38px] md:p-[40px] mb-10 overflow-hidden relative text-white" style={{ background: 'radial-gradient(1200px 400px at 12% -20%,rgba(139,92,246,.5),transparent 60%),linear-gradient(115deg,#1e1b3a 0%,#2a1d54 55%,#3b1d6e 100%)' }}>
          <div className="flex flex-wrap gap-10 justify-between items-center relative z-10">
            <div className="min-w-[300px] flex-1">
              <div className="tabular-nums text-[76px] leading-[0.9] font-black tracking-[-0.04em] text-transparent bg-clip-text" style={{ backgroundImage: 'linear-gradient(90deg,#fff,#c4b5fd)', WebkitBackgroundClip: 'text' }}>30 days</div>
              <p className="my-3.5 mb-5 text-[16px] text-[#cbc4e8] font-medium">Idea <span className="text-[#8b5cf6]">→</span> Delaware C-Corp <span className="text-[#8b5cf6]">→</span> Funded</p>
              <div className="flex flex-wrap gap-2">
                <span className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-full bg-white/10 border border-white/20 text-[12.5px] font-semibold text-[#ede9fe]">3 warm introductions</span>
                <span className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-full bg-white/10 border border-white/20 text-[12.5px] font-semibold text-[#ede9fe]">Pitch deck</span>
                <span className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-full bg-white/10 border border-white/20 text-[12.5px] font-semibold text-[#ede9fe]">Vesting cap table</span>
              </div>
            </div>
            <div className="flex flex-col gap-[1px] min-w-[230px] bg-white/10 border border-white/20 rounded-[16px] overflow-hidden">
              <div className="p-4 px-5 flex flex-col gap-0.5">
                <div className="tabular-nums text-[26px] font-extrabold tracking-tight">12 companies</div>
                <div className="text-[12.5px] text-[#a89fce]">Built to date</div>
              </div>
              <div className="p-4 px-5 flex flex-col gap-0.5 border-t border-white/10">
                <div className="tabular-nums text-[26px] font-extrabold tracking-tight">$2.4M</div>
                <div className="text-[12.5px] text-[#a89fce]">Total capital raised by graduates</div>
              </div>
              <div className="p-4 px-5 flex flex-col gap-0.5 border-t border-white/10">
                <div className="tabular-nums text-[26px] font-extrabold tracking-tight">30 days</div>
                <div className="text-[12.5px] text-[#a89fce]">Average time to incorporation</div>
              </div>
            </div>
          </div>
        </section>

        {/* 30-DAY PIPELINE */}
        <section className="mb-12">
          <div className="flex items-baseline justify-between mb-1.5">
            <h2 className="m-0 text-[20px] font-extrabold tracking-[-.02em]">The 30-day pipeline</h2>
            <span className="text-[12.5px] text-gray-400">5 phases · sequential gates</span>
          </div>
          <p className="m-0 mb-5 text-[13.5px] text-gray-500">Each phase ends at a gate. Companies advance only on completion.</p>

          <div className="flex flex-col lg:flex-row items-stretch gap-3 lg:gap-0">
            {PIPELINE_PHASES.map((p, i) => {
              const isDone = isIncorporated || week > p.backendWeek;
              const isActive = !isDone && week === p.backendWeek;
              const t = PHASE_THEMES[p.color];
              
              const statusIcon = isDone ? <Check size={14} strokeWidth={3} className="text-white" aria-hidden="true" /> : isActive ? <Circle size={14} fill="currentColor" stroke="none" style={{ animation: "wsPulse 2s infinite" }} className={t.ink} aria-hidden="true" /> : <Lock size={14} className="text-gray-400" aria-hidden="true" />;
              
              return (
                <div key={i} className="flex items-stretch flex-1 min-w-0">
                  <div className={`flex-1 min-w-0 rounded-[16px] p-[18px] flex flex-col transition-all border ${t.bg} ${t.border} ${isActive ? `ring-2 ring-offset-2 dark:ring-offset-gray-950 shadow-lg ${t.ring}` : ''}`}>
                    <div className="flex items-center justify-between mb-2.5">
                      <div className="flex items-center gap-2 min-w-0">
                        <div className={`w-[30px] h-[30px] flex-none rounded-[9px] font-extrabold text-[14px] flex items-center justify-center ${t.chip} ${t.ink}`}>{i + 1}</div>
                        <div className="text-[15px] font-extrabold tracking-[-.01em]">{p.name}</div>
                      </div>
                      <span className={`w-[24px] h-[24px] flex-none flex items-center justify-center ${isDone ? 'rounded-full' : ''}`} style={isDone ? { background: t.fill } : {}}>
                        {statusIcon}
                      </span>
                    </div>
                    <span className={`tabular-nums self-start whitespace-nowrap px-[9px] py-[3px] rounded-[7px] text-[11px] font-bold mb-[13px] ${t.chip} ${t.ink}`}>
                      {p.days}
                    </span>
                    <ul className="m-0 p-0 list-none flex flex-col gap-2 mb-4">
                      {p.milestones.map((m) => {
                         const done = completedKeys.has(m);
                         return (
                           <li key={m} className="flex gap-2 text-[12.5px] leading-[1.35] text-gray-700 dark:text-gray-300">
                             <span className={`flex-none font-bold ${t.ink}`} aria-hidden="true">·</span>
                             <span className="flex-1 flex flex-col gap-1.5">
                               <span className={done ? "line-through opacity-60" : ""}>{MILESTONE_LABELS[m] || m}</span>
                               {isActive && !done && (
                                 <button type="button" onClick={() => onComplete(m)} disabled={completing === m} className={`self-start text-[11px] font-semibold px-2.5 py-1 rounded-md border bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors flex items-center gap-1.5 ${t.ink} ${t.border} disabled:opacity-60`}>
                                    {completing === m ? <Loader2 size={12} className="animate-spin" aria-hidden="true" /> : <Check size={12} aria-hidden="true" />} Complete
                                 </button>
                               )}
                             </span>
                           </li>
                         );
                      })}
                    </ul>
                    <div className={`mt-auto flex flex-col gap-1.5 border-t pt-3 ${t.border}`}>
                       {p.tools.map((tool) => (
                         <Link key={tool.label} to={tool.to} className={`flex items-center justify-between text-[11.5px] font-semibold px-2.5 py-2 rounded-lg transition-colors bg-white/60 dark:bg-gray-900/50 hover:bg-white dark:hover:bg-gray-800 border ${t.border} ${t.ink}`}>
                            <span>{tool.label}</span>
                            <ArrowRight size={12} aria-hidden="true" />
                         </Link>
                       ))}
                    </div>
                  </div>
                  {i < PIPELINE_PHASES.length - 1 && (
                    <div className="w-[26px] flex-none hidden lg:flex items-center justify-center text-violet-300 dark:text-violet-800">
                      <ArrowRight size={18} aria-hidden="true" />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          {completeError && (
            <div className="mt-4 text-sm text-red-600 bg-red-50 border border-red-200 rounded-xl p-3 px-4 dark:bg-red-950/30 dark:border-red-900 dark:text-red-400">
              {completeError}
            </div>
          )}
          
          <DeckReadinessCard />

        </section>

        {/* WHAT YOU LEAVE WITH */}
        <section className="mb-12">
          <h2 className="m-0 mb-5 text-[20px] font-extrabold tracking-[-.02em]">What you leave with.</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-3 gap-4">
            {DELIVERABLES.map((d, i) => (
              <div key={i} className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-[16px] p-5 shadow-sm">
                <div className="w-10 h-10 rounded-[11px] bg-violet-50 dark:bg-violet-900/40 text-violet-600 dark:text-violet-400 flex items-center justify-center mb-3.5">
                  {d.icon}
                </div>
                <div className="text-[14.5px] font-bold mb-1.5">{d.name}</div>
                <div className="text-[12.7px] leading-[1.45] text-gray-500 dark:text-gray-400">{d.desc}</div>
              </div>
            ))}
          </div>
        </section>

        {/* ACTIVE COHORT TRACKER */}
        <section className="mb-12">
          <div className="flex items-baseline justify-between flex-wrap gap-2 mb-1">
            <h2 className="m-0 text-[20px] font-extrabold tracking-[-.02em]">Active cohort.</h2>
            <span className="inline-flex items-center gap-1.5 text-[12.5px] text-gray-500">
              <span className="w-2 h-2 rounded-full bg-emerald-500" style={{animation: 'wsPulse 2s infinite'}}></span>Live tracker
            </span>
          </div>
          <p className="m-0 mb-4 text-[13.5px] text-gray-500 tabular-nums">Cohort 3 · Started July 1, 2026 · 6 companies</p>

          <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-[16px] p-4 shadow-sm">
            <div className="overflow-x-auto no-scrollbar">
              <div className="grid grid-cols-5 gap-3.5 min-w-[820px]">
                {TRACKER_BOARD.map((col, i) => (
                  <div key={i}>
                    <div className={`flex items-center justify-between px-1 pb-2.5 border-b-2 mb-3 ${col.accent}`}>
                      <span className="text-[12.5px] font-bold text-gray-700 dark:text-gray-300 uppercase tracking-wider">{col.name}</span>
                      <span className="tabular-nums text-[11.5px] font-bold text-gray-400 bg-gray-100 dark:bg-gray-800 dark:text-gray-500 rounded-md px-2 py-0.5">{col.count}</span>
                    </div>
                    <div className="flex flex-col gap-2.5 min-h-[40px]">
                      {col.cards.map((c, ci) => (
                        <div key={ci} className="bg-gray-50 dark:bg-gray-800/50 border border-gray-100 dark:border-gray-800 rounded-xl p-3">
                          <div className="flex items-center gap-2 mb-2">
                            <div className={`w-8 h-8 rounded-lg flex-none font-extrabold text-[12px] flex items-center justify-center ${c.bg} ${c.ink}`}>
                              {c.initials}
                            </div>
                            <div className="min-w-0">
                              <div className="text-[13px] font-bold whitespace-nowrap overflow-hidden text-ellipsis">{c.name}</div>
                              <div className="text-[11px] text-gray-400 whitespace-nowrap overflow-hidden text-ellipsis">{c.desc}</div>
                            </div>
                          </div>
                          <div className="flex items-center justify-between">
                            <span className={`tabular-nums text-[11px] font-bold rounded-md px-2 py-1 ${col.tint}`}>
                              {c.day}
                            </span>
                            <div className="flex items-center gap-1.5">
                              <span className="text-[10.5px] text-gray-400">Lead</span>
                              <div title={c.advisor} className="w-[22px] h-[22px] rounded-full bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-300 font-bold text-[9.5px] flex items-center justify-center">
                                {c.advInit}
                              </div>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

      </main>
    </div>
  );
}

export default function SpinoutLabPage() {
  const { user, refresh } = useAuth();
  const [state, setState] = useState(null);
  const [loading, setLoading] = useState(true);
  const [completing, setCompleting] = useState(null);
  const [completeError, setCompleteError] = useState("");
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState("");

  const load = useCallback(async () => {
    try {
      const next = await spinoutLab.state();
      setState(next);
    } catch (e) {
      reportError("spinout-lab:state", e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (user) load();
    else setLoading(false);
  }, [user, load]);

  useEffect(() => {
    const onAdvanced = () => {
      load();
    };
    window.addEventListener("spinout-lab:advanced", onAdvanced);
    return () => window.removeEventListener("spinout-lab:advanced", onAdvanced);
  }, [load]);

  if (!user) return <SpinoutLabMarketingPage />;

  if (loading) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center text-gray-500">
        <Loader2 className="animate-spin mr-2" size={18} /> Loading your sprint…
      </div>
    );
  }

  // Task #7 — admitted-but-not-started founders see the "You're in"
  // celebration; Start Week 1 flips the lab on via the existing endpoint.
  if (state && !state.active && state.admitted && !state.is_incorporated) {
    const onStart = async () => {
      setStarting(true);
      setStartError("");
      try {
        const next = await spinoutLab.start();
        setState(next);
        try { await refresh({ force: true }); } catch { /* no-op */ }
      } catch (e) {
        setStartError(e?.message || "Could not start the Lab — please try again");
        reportError("spinout-lab:start", e);
      } finally {
        setStarting(false);
      }
    };
    return (
      <CongratulationsScreen
        cohort={state.cohort}
        onStart={onStart}
        starting={starting}
        startError={startError}
      />
    );
  }

  // Handle active logic (incorporation finish, etc) internally if needed
  // In the real app, user is redirected once incorporated, but we keep rendering Dashboard 
  // since it handles both states visually.

  const onComplete = async (key) => {
    setCompleting(key);
    setCompleteError("");
    try {
      const next = await spinoutLab.complete(key);
      setState(next);
      try {
        window.dispatchEvent(
          new CustomEvent("spinout-lab:advanced", {
            detail: { state: next, milestoneKey: key },
          }),
        );
      } catch {
        /* no-op */
      }
      if (!next.active) {
        try {
          await refresh({ force: true });
        } catch {
          /* no-op */
        }
      }
    } catch (e) {
      setCompleteError(e?.message || "Could not mark milestone complete");
      reportError("spinout-lab:complete", e);
    } finally {
      setCompleting(null);
    }
  };

  return (
    <Dashboard
      state={state || {}}
      onComplete={onComplete}
      completing={completing}
      completeError={completeError}
    />
  );
}
