import React from "react";
import { Link } from "react-router-dom";
import {
  ArrowLeft, FileDown, FlaskConical, Building2, PieChart, FileCheck2,
  Presentation, LineChart, Handshake, Users, FolderOpen,
} from "lucide-react";

// Program Brief — the printable one-pager for the Spin-Out Lab (reference:
// Spin-Out Lab-print.dc.html / Spin-Out_Lab_Pipeline.pdf). "Save as PDF"
// triggers the browser print dialog; the toolbar is hidden in print output
// so the saved PDF is just the brief. Public page — it's a brochure.

const PHASES = [
  {
    n: 1, name: "Validate", days: "Days 1–5",
    accent: { num: "bg-violet-100 text-violet-700", days: "text-violet-700", bg: "bg-violet-50/60 border-violet-100" },
    items: ["Problem/solution definition workshop", "Market sizing and TAM analysis", "Competitor landscape mapping", "Go/no-go decision gate"],
  },
  {
    n: 2, name: "Structure", days: "Days 6–12",
    accent: { num: "bg-blue-100 text-blue-700", days: "text-blue-700", bg: "bg-blue-50/60 border-blue-100" },
    items: ["Delaware C-Corp incorporation", "Co-founder equity split and vesting schedule", "83(b) election filing", "IP assignment agreements"],
  },
  {
    n: 3, name: "Build", days: "Days 13–19",
    accent: { num: "bg-emerald-100 text-emerald-700", days: "text-emerald-700", bg: "bg-emerald-50/60 border-emerald-100" },
    items: ["MVP scope definition", "Prototype or landing page live", "First design sprint (3 days)", "Advisor onboarding (1–2 advisors)"],
  },
  {
    n: 4, name: "Pitch", days: "Days 20–25",
    accent: { num: "bg-amber-100 text-amber-700", days: "text-amber-700", bg: "bg-amber-50/60 border-amber-100" },
    items: ["Pitch deck (12 slides, venture-standard)", "Financial model (3-year projection)", "Cap table modeling", "Warm intro prep with partner network"],
  },
  {
    n: 5, name: "Fund", days: "Days 26–30",
    accent: { num: "bg-rose-100 text-rose-700", days: "text-rose-700", bg: "bg-rose-50/60 border-rose-100" },
    items: ["Partner pitch sessions (3–5 investors)", "Term sheet review support", "First close or bridge round", "Graduate: venture-ready company"],
  },
];

const DELIVERABLES = [
  { Icon: Building2, title: "Delaware C-Corp", body: "Fully incorporated entity with EIN and registered agent." },
  { Icon: PieChart, title: "Vesting Cap Table", body: "Founder equity with 4-year vest, 1-year cliff on Carta." },
  { Icon: FileCheck2, title: "83(b) Election", body: "Filed within the 30-day IRS window, archived in your data room." },
  { Icon: Presentation, title: "Pitch Deck", body: "12-slide venture-standard deck, designed and reviewed." },
  { Icon: LineChart, title: "Financial Model", body: "3-year P&L, revenue model, and unit economics." },
  { Icon: Handshake, title: "Warm Introductions", body: "5–10 curated intros to the Axal VC investor network." },
  { Icon: Users, title: "Advisor Network", body: "2 matched advisors with equity agreements in place." },
  { Icon: FolderOpen, title: "Data Room", body: "Organized deal room ready for investor due diligence." },
];

const STATS = [
  { value: "12", label: "companies", sub: "Built to date" },
  { value: "$2.4M", label: "Total capital raised by graduates", sub: "" },
  { value: "30 days", label: "Average time to incorporation", sub: "" },
];

const HERO_CHIPS = ["Delaware C-Corp", "Vesting Cap Table", "83(b) Filed", "Pitch Deck Ready"];

export default function SpinoutLabBriefPage() {
  return (
    <div className="min-h-screen bg-gray-100 dark:bg-gray-950 print:bg-white" data-testid="spinout-brief-page">
      <div className="max-w-[680px] mx-auto px-4 py-6 print:max-w-none print:px-0 print:py-0">

        {/* Toolbar — hidden when printing */}
        <div className="flex items-center justify-between mb-5 print:hidden">
          <Link
            to="/spinout-lab"
            className="inline-flex items-center gap-2 h-[34px] px-3 rounded-full border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 text-gray-600 dark:text-gray-300 text-[13px] font-semibold hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
          >
            <ArrowLeft size={14} aria-hidden="true" /> Back to Spin-Out Lab
          </Link>
          <button
            type="button"
            onClick={() => window.print()}
            data-testid="brief-save-pdf"
            className="inline-flex items-center gap-2 h-[36px] px-4 rounded-[10px] bg-violet-600 hover:bg-violet-700 text-white text-[13.5px] font-bold shadow-sm shadow-violet-500/30 transition-colors"
          >
            <FileDown size={15} aria-hidden="true" /> Save as PDF
          </button>
        </div>

        {/* HERO */}
        <div className="rounded-[22px] print:rounded-none p-8 sm:p-10 text-white mb-5 print:mb-6" style={{ background: "linear-gradient(150deg,#1e1b3a 0%,#2b1d55 55%,#3b1d6e 100%)" }}>
          <div className="flex items-center gap-2.5 mb-10">
            <span className="w-8 h-8 rounded-[9px] bg-white/10 border border-white/15 flex items-center justify-center">
              <FlaskConical size={15} className="text-violet-300" aria-hidden="true" />
            </span>
            <span className="text-[13px] font-bold tracking-tight text-white/90">Axal VC · Spin-Out Lab</span>
          </div>
          <h1 className="m-0 text-[44px] sm:text-[52px] leading-none font-black tracking-[-.03em]">
            Program <span className="text-violet-300">Brief</span>
          </h1>
          <p className="mt-3 mb-10 text-[15px] text-[#cbc4e8]">From idea to Delaware C-Corp, funded in 30 days.</p>
          <div className="flex flex-wrap gap-2">
            {HERO_CHIPS.map((c) => (
              <span key={c} className="px-3.5 py-1.5 rounded-full border border-white/20 bg-white/5 text-[12.5px] font-semibold text-white/90">{c}</span>
            ))}
          </div>
        </div>

        {/* THE PROGRAM */}
        <section className="bg-white dark:bg-gray-900 print:bg-white border border-gray-200 dark:border-gray-800 print:border-gray-200 rounded-[18px] p-6 sm:p-7 mb-5 print:mb-6 print:break-inside-avoid">
          <div className="text-[11px] font-bold uppercase tracking-[.12em] text-gray-400 mb-1.5">The Program</div>
          <h2 className="m-0 mb-5 text-[22px] font-extrabold tracking-[-.02em] text-gray-900 dark:text-gray-100 print:text-gray-900">The 30-day pipeline</h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 print:grid-cols-5 gap-3">
            {PHASES.map((p) => (
              <div key={p.n} className={`rounded-xl border p-3.5 ${p.accent.bg} dark:bg-gray-950/60 dark:border-gray-800 print:break-inside-avoid`}>
                <div className="flex items-center gap-1.5 mb-1">
                  <span className={`tabular-nums w-5 h-5 rounded-[6px] text-[11px] font-extrabold flex items-center justify-center ${p.accent.num}`}>{p.n}</span>
                  <span className="text-[13px] font-bold text-gray-900 dark:text-gray-100 print:text-gray-900">{p.name}</span>
                </div>
                <div className={`tabular-nums text-[12px] font-bold mb-2 ${p.accent.days}`}>{p.days}</div>
                <ul className="m-0 p-0 list-none flex flex-col gap-1.5">
                  {p.items.map((it) => (
                    <li key={it} className="text-[11.5px] leading-snug text-gray-600 dark:text-gray-400 print:text-gray-600 before:content-['·'] before:mr-1 before:text-gray-400">{it}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </section>

        {/* DELIVERABLES */}
        <section className="bg-white dark:bg-gray-900 print:bg-white border border-gray-200 dark:border-gray-800 print:border-gray-200 rounded-[18px] p-6 sm:p-7 mb-5 print:mb-6 print:break-inside-avoid">
          <div className="text-[11px] font-bold uppercase tracking-[.12em] text-gray-400 mb-1.5">Deliverables</div>
          <h2 className="m-0 mb-5 text-[22px] font-extrabold tracking-[-.02em] text-gray-900 dark:text-gray-100 print:text-gray-900">What you leave with</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 print:grid-cols-3 gap-x-6 gap-y-5">
            {DELIVERABLES.map(({ Icon, title, body }) => (
              <div key={title} className="flex gap-3 print:break-inside-avoid">
                <span className="w-8 h-8 flex-none rounded-[9px] bg-violet-50 dark:bg-violet-900/40 print:bg-violet-50 text-violet-600 dark:text-violet-300 print:text-violet-600 flex items-center justify-center">
                  <Icon size={15} aria-hidden="true" />
                </span>
                <div>
                  <div className="text-[13.5px] font-bold text-gray-900 dark:text-gray-100 print:text-gray-900">{title}</div>
                  <div className="text-[12.5px] leading-snug text-gray-500 dark:text-gray-400 print:text-gray-500 mt-0.5">{body}</div>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* TRACK RECORD */}
        <section className="bg-white dark:bg-gray-900 print:bg-white border border-gray-200 dark:border-gray-800 print:border-gray-200 rounded-[18px] p-6 sm:p-7 mb-5 print:mb-6 print:break-inside-avoid">
          <div className="text-[11px] font-bold uppercase tracking-[.12em] text-gray-400 mb-1.5">Track Record</div>
          <h2 className="m-0 mb-5 text-[22px] font-extrabold tracking-[-.02em] text-gray-900 dark:text-gray-100 print:text-gray-900">Outcomes to date</h2>
          <div className="grid grid-cols-3 gap-3">
            {STATS.map((s) => (
              <div key={s.value} className="rounded-xl border border-gray-100 dark:border-gray-800 print:border-gray-100 bg-gray-50/60 dark:bg-gray-950/60 print:bg-gray-50 p-4">
                <div className="tabular-nums text-[26px] font-black tracking-[-.02em] text-violet-700 dark:text-violet-300 print:text-violet-700">{s.value}</div>
                <div className="text-[12px] font-semibold text-gray-600 dark:text-gray-300 print:text-gray-600 leading-snug mt-0.5">{s.label}</div>
                {s.sub && <div className="text-[11.5px] text-gray-400 mt-0.5">{s.sub}</div>}
              </div>
            ))}
          </div>
        </section>

        {/* FOOTER CTA */}
        <section className="bg-white dark:bg-gray-900 print:bg-white border border-gray-200 dark:border-gray-800 print:border-gray-200 rounded-[18px] p-6 sm:p-7 flex flex-wrap items-center justify-between gap-4 print:break-inside-avoid">
          <div>
            <div className="text-[16px] font-extrabold tracking-[-.01em] text-gray-900 dark:text-gray-100 print:text-gray-900">Apply to Cohort 4</div>
            <div className="tabular-nums text-[12.5px] text-gray-500 dark:text-gray-400 print:text-gray-500 mt-0.5">Applications close August 1, 2026 · 8 spots</div>
          </div>
          <div className="text-[12.5px] text-gray-500 dark:text-gray-400 print:text-gray-500 max-w-[280px]">
            Open to all Axal VC users. Acceptance is selective. No equity taken by Axal VC.
          </div>
        </section>
      </div>
    </div>
  );
}
