import React, { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Check, Loader2, ArrowRight, FlaskConical, Circle, Lock, FileText, BadgeCheck, ChevronDown } from "lucide-react";
import { api, spinoutLab } from "../lib/api";
import { deckReadinessState } from "../lib/deckReadiness";
import { useAuth } from "../hooks/useAuthSync";
import { reportError } from "../lib/log";
import SpinoutLabMarketingPage from "./SpinoutLabMarketingPage";
import { FEATURE_CATALOGUE, WEEK_ORDER } from "../components/SpinoutLabSidebar";

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

// Reference-design shared content (Spin-Out Lab.dc.html): graduate alumni
// cards, jurisdiction chips, and the application CTA. Shared with
// SpinoutLabMarketingPage so both surfaces stay in lockstep.
export const LAB_APPLY_HREF = '/register?lane=founder&product=spinout-lab';
export const LAB_CONTACT_HREF = 'mailto:hello@axal.vc?subject=Spin-Out%20Lab';

export const LAB_ALUMNI = [
  { initials: 'AB', bg: 'bg-violet-100 dark:bg-violet-900', ink: 'text-violet-700 dark:text-violet-200', name: 'Arborline', sector: 'Climate · MRV', cohort: 2, raised: '$450K pre-seed', outcome: 'Closed pre-seed · Now on AngelList' },
  { initials: 'PX', bg: 'bg-blue-100 dark:bg-blue-900', ink: 'text-blue-700 dark:text-blue-200', name: 'Pyxis Health', sector: 'Digital health', cohort: 2, raised: '$1.1M seed', outcome: 'Seed led by Foundry Group' },
  { initials: 'KT', bg: 'bg-teal-100 dark:bg-teal-900', ink: 'text-teal-700 dark:text-teal-200', name: 'Kettle', sector: 'Fintech · SMB', cohort: 1, raised: '$600K pre-seed', outcome: 'Pre-seed · 3 angel checks' },
  { initials: 'MR', bg: 'bg-amber-100 dark:bg-amber-900', ink: 'text-amber-700 dark:text-amber-200', name: 'Meridian Robotics', sector: 'Industrial AI', cohort: 1, raised: '$250K angel', outcome: 'Bridge round · Revenue positive' },
  { initials: 'SV', bg: 'bg-pink-100 dark:bg-pink-900', ink: 'text-pink-700 dark:text-pink-200', name: 'Solvent', sector: 'Dev tools', cohort: 1, raised: '$820K seed', outcome: 'Seed · YC W26 admit' },
  { initials: 'GL', bg: 'bg-indigo-100 dark:bg-indigo-900', ink: 'text-indigo-700 dark:text-indigo-200', name: 'Glassline', sector: 'Prop-tech', cohort: 2, raised: '$300K pre-seed', outcome: 'Pre-seed · Piloting 4 REITs' },
];

export const LAB_JURISDICTIONS = [
  { key: 'de', label: 'Delaware, USA' },
  { key: 'wy', label: 'Wyoming, USA' },
  { key: 'sg', label: 'Singapore', soon: true },
  { key: 'uk', label: 'London, UK', soon: true },
  { key: 'ee', label: 'Estonia', soon: true },
  { key: 'ae', label: 'Dubai, UAE', soon: true },
  { key: 'ca', label: 'Alberta, Canada', soon: true },
];

export function GraduatesSection() {
  return (
    <section className="mb-12">
      <div className="flex items-baseline justify-between mb-5">
        <h2 className="m-0 text-[20px] font-extrabold tracking-[-.02em]">Graduate companies.</h2>
        <span className="text-[12.5px] text-gray-400">Select a company to view its profile</span>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {LAB_ALUMNI.map((a, i) => (
          <button type="button" key={i} className="text-left bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-[16px] p-4 shadow-sm hover:border-violet-300 hover:shadow-lg dark:hover:border-violet-700 transition-all -translate-y-0 hover:-translate-y-1 block w-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 focus-visible:ring-offset-2">
            <div className="flex items-center justify-between mb-3.5">
              <div className={`w-11 h-11 rounded-[11px] font-extrabold text-[15px] flex items-center justify-center ${a.bg} ${a.ink}`}>{a.initials}</div>
              <span className="tabular-nums text-[11px] font-bold text-violet-700 dark:text-violet-300 bg-violet-50 dark:bg-violet-900/50 border border-violet-100 dark:border-violet-800/50 rounded-full px-2.5 py-1">Cohort {a.cohort}</span>
            </div>
            <div className="text-[15px] font-bold text-gray-900 dark:text-gray-100">{a.name}</div>
            <div className="text-[12px] text-gray-400 mb-3.5">{a.sector}</div>
            <div className="tabular-nums text-[19px] font-extrabold tracking-[-.01em]">{a.raised}</div>
            <div className="text-[12px] text-gray-500 mt-1 leading-[1.4]">{a.outcome}</div>
            <div className="mt-3.5 pt-3 border-t border-gray-100 dark:border-gray-800 flex items-center gap-1.5 text-[12px] font-semibold text-violet-600 dark:text-violet-400">
              View profile <span className="text-[13px]" aria-hidden="true">→</span>
            </div>
          </button>
        ))}
      </div>
    </section>
  );
}

export function ApplyCtaSection({ applyHref = LAB_APPLY_HREF }) {
  return (
    <section className="rounded-[20px] p-10 text-center relative overflow-hidden text-white" style={{ background: 'radial-gradient(900px 300px at 85% 120%,rgba(196,181,253,.35),transparent 60%),linear-gradient(115deg,#5b21b6,#7c3aed)' }}>
      <h2 className="m-0 text-[32px] font-black tracking-[-.03em]">Apply to Cohort 4.</h2>
      <p className="tabular-nums my-3 mb-6 text-[15px] text-[#e9d5ff]">Applications close August 1, 2026. 8 spots available.</p>
      <div className="flex gap-3 justify-center flex-wrap">
        <Link to={applyHref} className="h-11 px-5.5 rounded-[11px] bg-white dark:bg-gray-100 text-[#6d28d9] text-[14px] font-bold flex items-center gap-2 hover:bg-gray-50 dark:hover:bg-white transition-colors">
          Apply Now <span className="text-[16px]" aria-hidden="true">→</span>
        </Link>
        <a href={LAB_CONTACT_HREF} className="h-11 px-5.5 rounded-[11px] border border-white/40 bg-transparent text-white text-[14px] font-semibold flex items-center hover:bg-white/10 transition-colors">
          Talk to a Program Manager
        </a>
      </div>
      <p className="mt-6 text-[12px] text-[#c4b5fd]">Spin-Out Lab is open to all Meridian users. Acceptance is selective. No equity taken by Meridian.</p>
    </section>
  );
}

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

// ---------------------------------------------------------------------------
// Workspace home (design handoff: "Spin-Out Lab Workspace"). All progress
// data comes from /api/spinout-lab/state; only the copy below is static.
// Tool cards deep-link to the app's live pages via the sidebar's
// FEATURE_CATALOGUE / WEEK_ORDER so both surfaces stay in lockstep.
// ---------------------------------------------------------------------------

// Progress is counted in "completion units" mirroring the backend gates
// (backend/app/api/routes/spinout_lab.py MILESTONES): weeks 1/2/4 require all
// their milestones, week 3 requires scoring + EITHER advisor or co-founder —
// so week 3 is 2 units, not 3, and the program totals 10 units.
const WEEK3_EITHER = ["advisor_meeting_booked", "cofounder_request_sent"];
const WEEK_UNIT_TOTALS = { 1: 4, 2: 3, 3: 2, 4: 1 };
const TOTAL_UNITS = Object.values(WEEK_UNIT_TOTALS).reduce((n, c) => n + c, 0);

const WEEK_META = {
  1: {
    name: "Idea & Customer",
    accent: "#16a34a",
    summary: "Define the problem and ICP. Create your startup record. Talk to customers and log every interview.",
    ctas: [
      { label: "Open Startups", to: "/projects" },
      { label: "Open Customer Discovery", to: "/build/discovery" },
    ],
    leaveWith: "Startup record · 3 logged interviews · Validated problem",
  },
  2: {
    name: "Solution & Roadmap",
    accent: "#7c3aed",
    summary: "Scope the MVP. Set your quarter OKRs. Draft brand v1 and pitch deck v1.",
    ctas: [
      { label: "Open Roadmap", to: "/build/roadmap" },
      { label: "Open Pitch Deck", to: "/build/deck" },
    ],
    leaveWith: "Quarter OKRs · Brand basics · Pitch deck v1",
  },
  3: {
    name: "Validate & Team",
    accent: "#0d9488",
    summary: "Run the AI scoring engine. Book your first advisor meeting. Decide the co-founder track.",
    ctas: [
      { label: "Open AI Scoring", to: "/scoring" },
      { label: "Open Advisors", to: "/advisors" },
    ],
    leaveWith: "Venture-readiness score · Advisor cadence · Co-founder decision",
  },
  4: {
    name: "Incorporate & Capital",
    accent: "#d97706",
    summary: "Incorporate the entity. Set up the vesting cap table. File 83(b). Line up capital.",
    ctas: [
      { label: "Open Incorporate", to: "/incorporate" },
      { label: "Open Cap Table", to: "/build/captable" },
    ],
    leaveWith: "Delaware C-Corp · Vesting cap table · 83(b) filed",
  },
};

const MILESTONE_SHORT = {
  project_created: "Startup",
  customer_interview_logged_1: "Interview #1",
  customer_interview_logged_2: "Interview #2",
  customer_interview_logged_3: "Interview #3",
  okrs_created: "OKRs",
  brand_basics_filled: "Brand",
  pitch_deck_drafted: "Deck v1",
  scoring_run_completed: "Score",
  advisor_meeting_booked: "Advisor",
  cofounder_request_sent: "Co-founder",
  incorporation_completed: "C-Corp",
};

const MILESTONE_TOOLS = {
  project_created: { label: "Open Startups", to: "/projects" },
  customer_interview_logged_1: { label: "Open Customer Discovery", to: "/build/discovery" },
  customer_interview_logged_2: { label: "Open Customer Discovery", to: "/build/discovery" },
  customer_interview_logged_3: { label: "Open Customer Discovery", to: "/build/discovery" },
  okrs_created: { label: "Open Roadmap", to: "/build/roadmap" },
  brand_basics_filled: { label: "Open Brand Builder", to: "/build/brand" },
  pitch_deck_drafted: { label: "Open Pitch Deck", to: "/build/deck" },
  scoring_run_completed: { label: "Open AI Scoring", to: "/scoring" },
  advisor_meeting_booked: { label: "Open Advisors", to: "/advisors" },
  cofounder_request_sent: { label: "Open Co-founder Match", to: "/cofounder" },
  incorporation_completed: { label: "Open Incorporate", to: "/incorporate" },
};

const weekTools = (w) =>
  (WEEK_ORDER[w] || [])
    .filter((k) => k !== "spinout-lab" && FEATURE_CATALOGUE[k])
    .map((k) => ({ key: k, ...FEATURE_CATALOGUE[k] }));

function StatusBadge({ status }) {
  if (status === "done") {
    return (
      <span className="inline-flex items-center gap-1 text-[10.5px] font-bold rounded-full px-2 py-0.5 bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400">
        <Check size={10} strokeWidth={3} aria-hidden="true" /> Completed
      </span>
    );
  }
  if (status === "active") {
    return (
      <span className="inline-flex items-center gap-1.5 text-[10.5px] font-bold rounded-full px-2 py-0.5 bg-violet-50 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300">
        <span className="w-[5px] h-[5px] rounded-full bg-violet-600" style={{ animation: "wsPulse 2s infinite" }} aria-hidden="true" /> Active
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-[10.5px] font-bold rounded-full px-2 py-0.5 bg-gray-100 text-gray-400 dark:bg-gray-800 dark:text-gray-500">
      <Lock size={9} aria-hidden="true" /> Locked
    </span>
  );
}

function SectionLabel({ children }) {
  return <div className="text-[11px] font-bold uppercase tracking-[.06em] text-gray-400 dark:text-gray-500 mb-3">{children}</div>;
}

function Dashboard({ state, onComplete, completing, completeError }) {
  const week = Math.max(1, Math.min(4, state.week || 1));
  const milestones = state.milestones || [];
  const completedKeys = new Set(milestones.map((m) => m.key));
  const completedAtByKey = new Map(milestones.map((m) => [m.key, m.completed_at]));
  const isIncorporated = completedKeys.has("incorporation_completed") || !!state.is_incorporated;
  const unlocked = new Set(state.unlocked_features || []);
  const [openPast, setOpenPast] = useState(null);

  const statusOf = (w) => (isIncorporated || week > w ? "done" : week === w ? "active" : "locked");
  const doneUnitsIn = (w) => {
    if (w === 3) {
      return (
        (completedKeys.has("scoring_run_completed") ? 1 : 0) +
        (WEEK3_EITHER.some((k) => completedKeys.has(k)) ? 1 : 0)
      );
    }
    return WEEK_MILESTONES[w].filter((k) => completedKeys.has(k)).length;
  };

  const startedAt = state.started_at;
  const startedAtStr = startedAt ? new Date(startedAt).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }) : null;
  const daysRemaining = Number.isFinite(state.days_remaining) ? state.days_remaining : null;
  const programDay = startedAt
    ? Math.min(30, Math.max(1, Math.floor((Date.now() - new Date(startedAt).getTime()) / 86400000) + 1))
    : null;

  const completedCount = [1, 2, 3, 4].reduce((n, w) => n + doneUnitsIn(w), 0);
  const progressPct = isIncorporated ? 100 : Math.round((completedCount / TOTAL_UNITS) * 100);

  const toolsUnlockedIn = (w) => weekTools(w).filter((t) => unlocked.has(t.key)).length;
  const totalToolsUnlocked = [1, 2, 3, 4].reduce((n, w) => n + toolsUnlockedIn(w), 0);
  const totalTools = [1, 2, 3, 4].reduce((n, w) => n + weekTools(w).length, 0);

  const focusWeek = isIncorporated ? 4 : week;
  const meta = WEEK_META[focusWeek];
  const pastWeeks = [1, 2, 3, 4].filter((w) => statusOf(w) === "done");
  const futureWeeks = [1, 2, 3, 4].filter((w) => statusOf(w) === "locked");

  return (
    <div className="min-h-[100dvh] bg-[#F8F8FA] dark:bg-gray-950 font-sans text-gray-900 dark:text-gray-100">

      {/* STICKY PAGE HEADER */}
      <div className="sticky top-0 z-20 bg-[#F8F8FA]/90 dark:bg-gray-950/90 backdrop-blur-md border-b border-gray-200/80 dark:border-gray-800">
        <div className="max-w-[1180px] mx-auto px-6 pt-4">
          <div className="flex flex-wrap gap-4 items-center justify-between">
            <div className="flex items-center gap-3.5 flex-wrap">
              <div className="flex items-center gap-2.5">
                <div className="w-[34px] h-[34px] rounded-[10px] bg-violet-100 dark:bg-violet-900/40 flex items-center justify-center text-violet-600 dark:text-violet-400">
                  <FlaskConical size={18} aria-hidden="true" />
                </div>
                <h1 className="m-0 text-xl font-extrabold tracking-[-.02em]">Spin-Out Lab</h1>
              </div>
              <span className="tabular-nums text-xs font-semibold text-gray-600 dark:text-gray-300 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg px-2.5 py-[5px]">
                {state.cohort || "Cohort 3"}{startedAtStr ? ` · Started ${startedAtStr}` : ""}
              </span>
              {isIncorporated ? (
                <span className="inline-flex items-center gap-1.5 text-xs font-bold text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-100 dark:border-emerald-500/20 rounded-lg px-2.5 py-[5px]">
                  <Check size={11} strokeWidth={3} aria-hidden="true" /> Program complete
                </span>
              ) : (
                <span className="tabular-nums inline-flex items-center gap-[7px] text-xs font-bold text-violet-700 dark:text-violet-300 bg-violet-50 dark:bg-violet-900/30 border border-violet-100 dark:border-violet-800/50 rounded-lg px-2.5 py-[5px]">
                  <span className="w-1.5 h-1.5 rounded-full bg-violet-600" style={{ animation: "wsPulse 2s infinite" }} aria-hidden="true" />
                  Week {week} of 4{programDay ? ` · Day ${programDay}` : ""}
                </span>
              )}
            </div>
            <div className="flex items-center gap-4 flex-wrap">
              <div className="flex items-center gap-2.5">
                <div
                  className="w-[46px] h-[46px] rounded-full flex items-center justify-center flex-none"
                  style={{ background: `conic-gradient(#7c3aed 0% ${progressPct}%, #e5e7eb ${progressPct}% 100%)` }}
                  role="img"
                  aria-label={`${progressPct}% of milestones complete`}
                >
                  <div className="tabular-nums w-[38px] h-[38px] rounded-full bg-[#F8F8FA] dark:bg-gray-950 flex items-center justify-center text-[10.5px] font-extrabold text-violet-700 dark:text-violet-300">
                    {progressPct}%
                  </div>
                </div>
                <div className="leading-[1.15]">
                  <div className="tabular-nums text-[13px] font-bold">{completedCount} of {TOTAL_UNITS} milestones</div>
                  <div className="tabular-nums text-xs text-gray-500 dark:text-gray-400">
                    {daysRemaining != null ? `${daysRemaining} days remaining` : "30-day program"}
                  </div>
                </div>
              </div>
              <div className="w-px h-[34px] bg-gray-200 dark:bg-gray-800 hidden sm:block" />
              <div className="flex gap-2">
                <Link to="/spinout-lab/brief" data-testid="download-program-brief" className="h-9 px-3.5 rounded-[10px] border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-300 text-[12.5px] font-semibold flex items-center gap-1.5 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">
                  <FileText size={14} aria-hidden="true" /> Program Brief
                </Link>
                <Link to="/spinout-lab/apply" data-testid="apply-next-cohort" className="h-9 px-3.5 rounded-[10px] bg-violet-600 text-white text-[12.5px] font-semibold flex items-center gap-1.5 shadow-sm shadow-violet-500/30 hover:bg-violet-700 transition-colors">
                  Apply to Next Cohort <ArrowRight size={13} aria-hidden="true" />
                </Link>
              </div>
            </div>
          </div>
          {/* Segmented week progress */}
          <div className="flex gap-1.5 py-3.5">
            {[1, 2, 3, 4].map((w) => {
              const st = statusOf(w);
              const weekPct = st === "done" ? 100 : st === "active" ? Math.max(6, Math.round((doneUnitsIn(w) / WEEK_UNIT_TOTALS[w]) * 100)) : 0;
              return (
                <div key={w} className="flex-1 flex flex-col gap-[5px]">
                  <div className={`h-[7px] rounded-full relative overflow-hidden ${st === "locked" ? "bg-gray-200 dark:bg-gray-800" : "bg-violet-100 dark:bg-violet-900/40"}`}>
                    <div
                      className="absolute inset-y-0 left-0 bg-violet-600 rounded-full"
                      style={{ width: `${weekPct}%`, ...(st === "active" ? { animation: "wsPulse 2s infinite" } : {}) }}
                    />
                  </div>
                  <div className={`flex items-center gap-[5px] text-[11px] font-semibold ${st === "locked" ? "text-gray-400 dark:text-gray-500" : "text-violet-700 dark:text-violet-300"}`}>
                    {st === "active" && <span className="w-[5px] h-[5px] rounded-full bg-violet-600" style={{ animation: "wsPulse 2s infinite" }} aria-hidden="true" />}
                    Week {w}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <main className="max-w-[1180px] mx-auto px-6 py-7 pb-24">

        {/* SECTION 1 — WEEK TIMELINE */}
        <section className="mb-9">
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3.5">
            {[1, 2, 3, 4].map((w) => {
              const st = statusOf(w);
              const m = WEEK_META[w];
              return (
                <div
                  key={w}
                  className={`bg-white dark:bg-gray-900 border rounded-2xl p-4 flex flex-col shadow-sm ${st === "active" ? "border-violet-300 dark:border-violet-700" : "border-gray-200 dark:border-gray-800"}`}
                  style={st === "active" ? { animation: "wsGlow 3s infinite" } : undefined}
                >
                  <div className="flex items-center justify-between mb-2.5 gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <div className="w-[26px] h-[26px] flex-none rounded-lg text-[12px] font-extrabold flex items-center justify-center" style={{ background: `${m.accent}1a`, color: m.accent }}>{w}</div>
                      <div className="text-[14px] font-extrabold tracking-[-.01em] truncate">{m.name}</div>
                    </div>
                    <StatusBadge status={st} />
                  </div>
                  <p className="m-0 mb-3 text-[12px] leading-[1.45] text-gray-500 dark:text-gray-400">{m.summary}</p>
                  <div className="flex flex-wrap gap-1.5 mb-3">
                    {WEEK_MILESTONES[w].map((k) => {
                      const done = completedKeys.has(k);
                      return (
                        <span key={k} className={`inline-flex items-center gap-1 text-[10.5px] font-semibold rounded-md px-1.5 py-0.5 ${done ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400" : "bg-gray-100 text-gray-400 dark:bg-gray-800 dark:text-gray-500"}`}>
                          {done ? <Check size={10} strokeWidth={3} aria-hidden="true" /> : <Circle size={8} aria-hidden="true" />}
                          {MILESTONE_SHORT[k] || k}
                        </span>
                      );
                    })}
                  </div>
                  <div className="mt-auto flex flex-wrap gap-1.5 pt-2.5 border-t border-gray-100 dark:border-gray-800">
                    {weekTools(w).map((t) =>
                      unlocked.has(t.key) ? (
                        <Link key={t.key} to={t.to} className="text-[10.5px] font-semibold text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-100 dark:border-emerald-500/20 rounded-md px-2 py-[3px] hover:bg-emerald-100 dark:hover:bg-emerald-500/20 transition-colors">
                          {t.label}
                        </Link>
                      ) : (
                        <span key={t.key} className="inline-flex items-center gap-1 text-[10.5px] font-semibold text-gray-400 dark:text-gray-500 bg-gray-50 dark:bg-gray-800/60 border border-gray-100 dark:border-gray-800 rounded-md px-2 py-[3px]">
                          <Lock size={9} aria-hidden="true" />{t.label}
                        </span>
                      )
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* SECTION 2 — ACTIVE WEEK / COMPLETION PANEL */}
        {isIncorporated ? (
          <section className="mb-9">
            <div className="bg-white dark:bg-gray-900 border border-emerald-200 dark:border-emerald-900 rounded-2xl p-6 shadow-sm flex flex-wrap items-center justify-between gap-5">
              <div className="min-w-[260px] flex-1">
                <span className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[.05em] rounded-full px-2.5 py-1 mb-3 bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400">
                  <Check size={11} strokeWidth={3} aria-hidden="true" /> Program complete
                </span>
                <h2 className="m-0 text-[22px] font-extrabold tracking-[-.02em]">You're incorporated.</h2>
                <p className="mt-[7px] mb-0 text-sm text-gray-500 dark:text-gray-400 max-w-[560px]">
                  All four weeks are done — your entity is formed and every Lab tool stays unlocked for your company.
                </p>
              </div>
              <div className="flex gap-2.5 flex-wrap">
                <Link to="/incorporate" className="h-10 px-[18px] rounded-[10px] bg-violet-600 text-white text-[13.5px] font-semibold inline-flex items-center gap-[7px] shadow-sm shadow-violet-500/40 hover:bg-violet-700 transition-colors">
                  Open Incorporate <ArrowRight size={14} aria-hidden="true" />
                </Link>
                <Link to="/capital" className="h-10 px-4 rounded-[10px] border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 text-[13.5px] font-semibold inline-flex items-center gap-[7px] hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors">
                  Open Capital <ArrowRight size={14} aria-hidden="true" />
                </Link>
              </div>
            </div>
          </section>
        ) : (
          <section className="mb-9">
            <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl p-6 shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-5">
                <div className="min-w-[260px] flex-1">
                  <span className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[.05em] rounded-full px-2.5 py-1 mb-3" style={{ background: `${meta.accent}14`, color: meta.accent }}>
                    <span className="w-1.5 h-1.5 rounded-full" style={{ background: meta.accent, animation: "wsPulse 2s infinite" }} aria-hidden="true" /> This week
                  </span>
                  <h2 className="m-0 text-[22px] font-extrabold tracking-[-.02em]">Week {week} — {meta.name}</h2>
                  <p className="mt-[7px] mb-4 text-sm text-gray-500 dark:text-gray-400 max-w-[520px]">{meta.summary}</p>
                  <div className="flex flex-wrap gap-2">
                    {programDay && (
                      <span className="tabular-nums inline-flex items-center gap-1.5 text-xs font-semibold text-gray-600 dark:text-gray-300 bg-gray-50 dark:bg-gray-800/60 border border-gray-100 dark:border-gray-800 rounded-lg px-2.5 py-1.5">
                        Day {programDay} of 30
                      </span>
                    )}
                    <span className="tabular-nums inline-flex items-center gap-1.5 text-xs font-semibold text-gray-600 dark:text-gray-300 bg-gray-50 dark:bg-gray-800/60 border border-gray-100 dark:border-gray-800 rounded-lg px-2.5 py-1.5">
                      <Check size={12} className="text-violet-600 dark:text-violet-400" aria-hidden="true" />
                      {doneUnitsIn(week)} of {WEEK_UNIT_TOTALS[week]} milestones done
                    </span>
                    <span className="tabular-nums inline-flex items-center gap-1.5 text-xs font-semibold text-gray-600 dark:text-gray-300 bg-gray-50 dark:bg-gray-800/60 border border-gray-100 dark:border-gray-800 rounded-lg px-2.5 py-1.5">
                      {totalToolsUnlocked} tools unlocked
                    </span>
                  </div>
                </div>
                <div className="flex gap-2.5 flex-wrap">
                  <Link to={meta.ctas[0].to} className="h-10 px-[18px] rounded-[10px] bg-violet-600 text-white text-[13.5px] font-semibold inline-flex items-center gap-[7px] shadow-sm shadow-violet-500/40 hover:bg-violet-700 transition-colors">
                    {meta.ctas[0].label} <ArrowRight size={14} aria-hidden="true" />
                  </Link>
                  <Link to={meta.ctas[1].to} className="h-10 px-4 rounded-[10px] border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 text-[13.5px] font-semibold inline-flex items-center gap-[7px] hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors">
                    {meta.ctas[1].label} <ArrowRight size={14} aria-hidden="true" />
                  </Link>
                </div>
              </div>
            </div>
          </section>
        )}

        {/* SECTION 3 — DELIVERABLES + UNLOCKED TOOLS */}
        <section className="grid grid-cols-1 lg:grid-cols-[1fr_1.6fr] gap-5 mb-9 items-start">
          <div>
            <SectionLabel>Week {focusWeek} deliverables</SectionLabel>
            <div className="flex flex-col gap-2.5">
              {WEEK_MILESTONES[focusWeek].map((k) => {
                const done = completedKeys.has(k);
                const tool = MILESTONE_TOOLS[k];
                return (
                  <div key={k} className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-[14px] p-4 shadow-sm flex gap-3 items-start">
                    <span className={`w-5 h-5 flex-none mt-0.5 rounded-md flex items-center justify-center ${done ? "bg-emerald-500 text-white" : "bg-white dark:bg-gray-900 border-[1.5px] border-gray-300 dark:border-gray-700"}`} aria-hidden="true">
                      {done && <Check size={12} strokeWidth={3} />}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-[14px] font-semibold">{MILESTONE_LABELS[k] || k}</span>
                        <span className={`text-[10.5px] font-semibold rounded-full px-2 py-0.5 ${done ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400" : "bg-gray-100 text-gray-400 dark:bg-gray-800 dark:text-gray-500"}`}>
                          {done ? "Done" : "Not started"}
                        </span>
                        {focusWeek === 3 && WEEK3_EITHER.includes(k) && (
                          <span className="text-[10.5px] font-semibold rounded-full px-2 py-0.5 bg-violet-50 text-violet-600 dark:bg-violet-900/40 dark:text-violet-300">
                            Either counts
                          </span>
                        )}
                      </div>
                      <div className="mt-2 flex items-center gap-2 flex-wrap">
                        {!done && !isIncorporated && (
                          <button
                            type="button"
                            onClick={() => onComplete(k)}
                            disabled={completing === k}
                            className="h-7 px-2.5 rounded-lg border border-violet-200 dark:border-violet-800 bg-white dark:bg-gray-800 text-violet-700 dark:text-violet-300 text-[11.5px] font-semibold inline-flex items-center gap-1.5 hover:bg-violet-50 dark:hover:bg-gray-700 transition-colors disabled:opacity-60"
                          >
                            {completing === k ? <Loader2 size={11} className="animate-spin" aria-hidden="true" /> : <Check size={11} aria-hidden="true" />} Complete
                          </button>
                        )}
                        {tool && (
                          <Link to={tool.to} className="h-7 px-2.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-[11.5px] font-semibold text-gray-600 dark:text-gray-300 inline-flex items-center gap-1 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors">
                            {tool.label} <ArrowRight size={11} aria-hidden="true" />
                          </Link>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
            {completeError && (
              <div className="mt-3 text-sm text-red-600 bg-red-50 border border-red-200 rounded-xl p-3 px-4 dark:bg-red-950/30 dark:border-red-900 dark:text-red-400">
                {completeError}
              </div>
            )}
            <DeckReadinessCard />
          </div>

          <div>
            <SectionLabel>Your unlocked tools</SectionLabel>
            {[1, 2, 3, 4].map((w) => {
              const tools = weekTools(w).filter((t) => unlocked.has(t.key));
              if (!tools.length) return null;
              return (
                <div key={w} className="mb-4">
                  <div className="text-[11px] font-semibold text-gray-400 dark:text-gray-500 mb-2">Week {w} — {WEEK_META[w].name}</div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-2.5">
                    {tools.map((t) => {
                      const Icon = t.icon;
                      return (
                        <Link key={t.key} to={t.to} className="group bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-[13px] p-3 flex flex-col hover:border-violet-300 dark:hover:border-violet-700 hover:shadow-md transition-all">
                          <div className="w-8 h-8 rounded-[9px] bg-violet-50 dark:bg-violet-900/40 text-violet-600 dark:text-violet-400 flex items-center justify-center mb-2">
                            <Icon size={15} aria-hidden="true" />
                          </div>
                          <div className="text-[12.5px] font-bold mb-0.5">{t.label}</div>
                          <div className="text-[11px] leading-[1.35] text-gray-400 dark:text-gray-500 mb-2.5 flex-1 line-clamp-2">{t.blurb}</div>
                          <div className="flex items-center justify-between gap-1.5">
                            <span className="text-[9.5px] font-bold rounded-md px-1.5 py-0.5 bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400">Unlocked · Wk {w}</span>
                            <span className="text-[11px] font-semibold text-violet-700 dark:text-violet-300 inline-flex items-center gap-1 opacity-70 group-hover:opacity-100 transition-opacity">
                              Open <ArrowRight size={11} aria-hidden="true" />
                            </span>
                          </div>
                        </Link>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* SECTION 4 — 30-DAY SCORECARD */}
        <section className="mb-9">
          <SectionLabel>30-day scorecard</SectionLabel>
          <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl overflow-hidden shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full border-collapse min-w-[680px]">
                <thead>
                  <tr className="bg-gray-50 dark:bg-gray-800/60">
                    <th className="text-left px-4 py-3 border-b border-gray-200 dark:border-gray-800" aria-label="Metric" />
                    {[1, 2, 3, 4].map((w) => (
                      <th key={w} className="text-left text-[12px] font-bold px-4 py-3 border-b border-l border-gray-200 dark:border-gray-800">Week {w}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td className="text-[11px] font-bold uppercase tracking-[.06em] text-gray-400 dark:text-gray-500 px-4 py-3.5 border-b border-gray-100 dark:border-gray-800 whitespace-nowrap">Status</td>
                    {[1, 2, 3, 4].map((w) => (
                      <td key={w} className="px-4 py-3.5 border-b border-l border-gray-100 dark:border-gray-800 align-top">
                        <StatusBadge status={statusOf(w)} />
                      </td>
                    ))}
                  </tr>
                  <tr>
                    <td className="text-[11px] font-bold uppercase tracking-[.06em] text-gray-400 dark:text-gray-500 px-4 py-3.5 border-b border-gray-100 dark:border-gray-800 whitespace-nowrap">Deliverables</td>
                    {[1, 2, 3, 4].map((w) => {
                      const st = statusOf(w);
                      if (st === "locked") return <td key={w} className="px-4 py-3.5 border-b border-l border-gray-100 dark:border-gray-800 text-gray-300 dark:text-gray-600">—</td>;
                      const total = WEEK_UNIT_TOTALS[w];
                      const done = doneUnitsIn(w);
                      const pct = Math.round((done / total) * 100);
                      return (
                        <td key={w} className="px-4 py-3.5 border-b border-l border-gray-100 dark:border-gray-800 align-top">
                          <div className="tabular-nums text-[12px] font-semibold text-gray-700 dark:text-gray-300 mb-1.5">{done} of {total}</div>
                          <div className="h-[5px] rounded-full bg-gray-100 dark:bg-gray-800 overflow-hidden max-w-[140px]">
                            <div className="h-full rounded-full" style={{ width: `${pct}%`, background: st === "done" ? "#22c55e" : "#7c3aed" }} />
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                  <tr>
                    <td className="text-[11px] font-bold uppercase tracking-[.06em] text-gray-400 dark:text-gray-500 px-4 py-3.5 border-b border-gray-100 dark:border-gray-800 whitespace-nowrap">Tools unlocked</td>
                    {[1, 2, 3, 4].map((w) => {
                      const n = toolsUnlockedIn(w);
                      const total = weekTools(w).length;
                      return (
                        <td key={w} className={`tabular-nums px-4 py-3.5 border-b border-l border-gray-100 dark:border-gray-800 text-[12px] font-semibold ${n ? "text-gray-900 dark:text-gray-100" : "text-gray-300 dark:text-gray-600"}`}>
                          {n ? `${n} of ${total}` : "—"}
                        </td>
                      );
                    })}
                  </tr>
                  <tr>
                    <td className="text-[11px] font-bold uppercase tracking-[.06em] text-gray-400 dark:text-gray-500 px-4 py-3.5 whitespace-nowrap">Key output</td>
                    {[1, 2, 3, 4].map((w) => {
                      const st = statusOf(w);
                      return (
                        <td key={w} className={`px-4 py-3.5 border-l border-gray-100 dark:border-gray-800 text-[12px] ${st === "done" ? "text-gray-600 dark:text-gray-300" : st === "active" ? "text-violet-700 dark:text-violet-300 font-semibold" : "text-gray-300 dark:text-gray-600"}`}>
                          {st === "done" ? WEEK_META[w].leaveWith : st === "active" ? "In progress" : "—"}
                        </td>
                      );
                    })}
                  </tr>
                </tbody>
              </table>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 border-t border-gray-100 dark:border-gray-800 divide-y sm:divide-y-0 sm:divide-x divide-gray-100 dark:divide-gray-800">
              <div className="px-5 py-4">
                <div className="tabular-nums text-[20px] font-extrabold tracking-tight">{totalToolsUnlocked} of {totalTools}</div>
                <div className="text-[12px] text-gray-400 dark:text-gray-500">Tools unlocked</div>
              </div>
              <div className="px-5 py-4">
                <div className="tabular-nums text-[20px] font-extrabold tracking-tight">{completedCount} of {TOTAL_UNITS}</div>
                <div className="text-[12px] text-gray-400 dark:text-gray-500">Deliverables completed</div>
              </div>
              <div className="px-5 py-4">
                <div className="tabular-nums text-[20px] font-extrabold tracking-tight">{isIncorporated ? "Done" : daysRemaining != null ? daysRemaining : "—"}</div>
                <div className="text-[12px] text-gray-400 dark:text-gray-500">{isIncorporated ? "Program complete" : "Days remaining"}</div>
              </div>
            </div>
          </div>
          <p className="mt-3.5 mb-0 text-[12.5px] text-gray-400 dark:text-gray-500 flex items-center gap-2">
            <BadgeCheck size={16} className="flex-none text-violet-500" aria-hidden="true" />
            All Spin-Out Lab graduates receive a verified "Spin-Out Lab Alumni" badge on their founder profile.
          </p>
        </section>

        {/* SECTION 5 — COMPLETED WEEK SUMMARIES */}
        {pastWeeks.length > 0 && (
          <section className="mb-9">
            <SectionLabel>Completed weeks</SectionLabel>
            <div className="flex flex-col gap-2.5">
              {pastWeeks.map((w) => {
                const open = openPast === w;
                return (
                  <div key={w} className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl shadow-sm overflow-hidden">
                    <button
                      type="button"
                      onClick={() => setOpenPast(open ? null : w)}
                      aria-expanded={open}
                      className="w-full flex items-center justify-between gap-3 px-5 py-4 text-left"
                    >
                      <div className="flex items-center gap-3 flex-wrap">
                        <span className="w-[26px] h-[26px] rounded-lg bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 flex items-center justify-center" aria-hidden="true">
                          <Check size={13} strokeWidth={3} />
                        </span>
                        <span className="text-[14px] font-bold">Week {w} — {WEEK_META[w].name}</span>
                        <span className="tabular-nums text-[11.5px] font-semibold text-gray-400 dark:text-gray-500">{doneUnitsIn(w)} of {WEEK_UNIT_TOTALS[w]} milestones</span>
                      </div>
                      <ChevronDown size={16} className={`flex-none text-gray-400 transition-transform ${open ? "rotate-180" : ""}`} aria-hidden="true" />
                    </button>
                    {open && (
                      <div className="px-5 pb-4 border-t border-gray-100 dark:border-gray-800">
                        <ul className="m-0 mt-3 p-0 list-none flex flex-col gap-2">
                          {WEEK_MILESTONES[w].map((k) => {
                            const done = completedKeys.has(k);
                            const at = completedAtByKey.get(k);
                            return (
                              <li key={k} className="flex items-center gap-2.5 text-[12.5px]">
                                <span className={done ? "text-emerald-500" : "text-gray-300 dark:text-gray-600"} aria-hidden="true">
                                  {done ? <Check size={13} strokeWidth={3} /> : <Circle size={10} />}
                                </span>
                                <span className={done ? "text-gray-700 dark:text-gray-300" : "text-gray-400 dark:text-gray-500"}>{MILESTONE_LABELS[k] || k}</span>
                                {done && at && (
                                  <span className="tabular-nums ml-auto text-[11px] text-gray-400 dark:text-gray-500">
                                    {new Date(at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                                  </span>
                                )}
                              </li>
                            );
                          })}
                        </ul>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* SECTION 6 — LOCKED WEEK PREVIEWS */}
        {futureWeeks.length > 0 && (
          <section>
            <SectionLabel>Coming up</SectionLabel>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {futureWeeks.map((w) => {
                const m = WEEK_META[w];
                return (
                  <div key={w} className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl p-5 shadow-sm">
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <div className="text-[11px] font-bold text-gray-500 dark:text-gray-400 uppercase tracking-[.04em]">Week {w}</div>
                      <span className="inline-flex items-center gap-1 text-[10.5px] font-semibold text-gray-400 dark:text-gray-500">
                        <Lock size={10} aria-hidden="true" /> Unlocks when Week {w - 1} is complete
                      </span>
                    </div>
                    <div className="text-base font-bold mb-3">{m.name}</div>
                    <div className="flex flex-wrap gap-1.5 mb-3.5">
                      {weekTools(w).map((t) => (
                        <span key={t.key} className="text-[10.5px] font-semibold text-gray-500 dark:text-gray-400 bg-gray-50 dark:bg-gray-800/60 border border-gray-100 dark:border-gray-800 rounded-md px-2 py-[3px]">{t.label}</span>
                      ))}
                    </div>
                    <div className="text-[12px] text-gray-400 dark:text-gray-500 leading-[1.45]">
                      <span className="font-semibold text-gray-500 dark:text-gray-400">You leave with:</span> {m.leaveWith}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        )}

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
