import React from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  ArrowLeft, FileDown, FlaskConical, Building2, PieChart, FileCheck2,
  Presentation, LineChart, Handshake, Users, FolderOpen,
} from "lucide-react";
import { deliverablesFor } from "./SpinoutLabPage";
import {
  PIPELINE_PHASES, pipelineItemsFor, outcomeBadgesFor, labJurisdiction,
  useSpinoutStats, companiesLabel, openCohortCopy,
} from "../lib/spinoutLab";

// Program Brief — the printable slide deck for the Spin-Out Lab (reference:
// Spin-Out Lab-print-1vkgcux.dc.html BRIEF VIEW; print paging from
// Spin-Out Lab-print.dc.html: letter landscape, 0.5in margins, one slide
// per page). "Save as PDF" triggers the browser print dialog; the toolbar
// is hidden in print output so the saved PDF is just the brief. Public
// page — it's a brochure. An optional ?j= search param (e.g. ?j=wy) swaps
// the entity/filing strings via the shared jurisdiction metadata.

// Per-phase accent classes for the compact brief cards, keyed by the shared
// PIPELINE_PHASES color (design tones: Build teal #0d9488, Fund pink #db2777).
const PHASE_ACCENTS = {
  violet: { chip: "bg-violet-100 text-violet-700", ink: "text-violet-700", bg: "bg-violet-50/60 border-violet-100" },
  blue: { chip: "bg-blue-100 text-blue-700", ink: "text-blue-700", bg: "bg-blue-50/60 border-blue-100" },
  teal: { chip: "bg-teal-100 text-teal-700", ink: "text-teal-700", bg: "bg-teal-50/60 border-teal-100" },
  amber: { chip: "bg-amber-100 text-amber-700", ink: "text-amber-700", bg: "bg-amber-50/60 border-amber-100" },
  pink: { chip: "bg-pink-100 text-pink-700", ink: "text-pink-700", bg: "bg-pink-50/60 border-pink-100" },
};

// Lucide equivalents, by row, for the shared deliverables list (the brief
// keeps its lighter 15px icon treatment; names/descriptions come from
// deliverablesFor so the jurisdiction-derived rows stay in sync).
// Intentionally 8 icons: the shared DELIVERABLES source currently has a 9th
// "Verified Badge" row, but this brief only shows produced work-product
// deliverables. We therefore omit that conferred-status item and slice to this
// icon count on purpose.
const DELIVERABLE_ICONS = [Building2, PieChart, FileCheck2, Presentation, LineChart, Handshake, Users, FolderOpen];

export default function SpinoutLabBriefPage() {
  const [searchParams] = useSearchParams();
  const juris = labJurisdiction(searchParams.get("j"));
  // Intentional: this compact brief shows only the 8 produced deliverables with icons.
  // The final shared row ("Verified Badge") is conferred rather than produced, so it is omitted here.
  const deliverables = deliverablesFor(juris.key).slice(0, DELIVERABLE_ICONS.length);

  // The track-record slide used to be three string literals — "12 companies",
  // "$2.4M" — that no query produced and nobody updated. This is the artifact
  // most likely to be printed and forwarded to an investor, so it is the last
  // place a stale number should live. Same public endpoint and same em-dash
  // fallback as the marketing hero, so the two can never disagree. "28 days"
  // stays a literal: it is the program's length, not a measurement.
  const { companies, raised } = useSpinoutStats();
  const stats = [
    { value: companiesLabel(companies), label: "Built to date" },
    { value: raised === null ? "—" : raised, label: "Total capital raised by graduates" },
    { value: "28 days", label: "Average time to incorporation" },
  ];

  // Likewise the CTA: "Apply to Cohort 4 · closes August 1, 2026" was frozen
  // in source and had already gone past.
  const cohort = openCohortCopy();

  return (
    <div className="min-h-screen bg-gray-100 dark:bg-gray-950 print:bg-white" data-testid="spinout-brief-page">
      {/* Print paging — letter landscape, half-inch margins, one slide per
          page (pattern: PitchDeckPrintPage). */}
      <style>{`
        @page { size: letter landscape; margin: .5in; }
        [data-brief-slide] { -webkit-print-color-adjust: exact; print-color-adjust: exact; page-break-after: always; break-after: page; }
        [data-brief-slide]:last-child { page-break-after: auto; break-after: auto; }
      `}</style>
      <div className="max-w-[960px] mx-auto px-4 py-6 print:max-w-none print:px-0 print:py-0">

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

        <div className="flex flex-col gap-5">

          {/* SLIDE 1 — COVER */}
          <div data-brief-slide className="aspect-[16/9] rounded-[16px] p-12 text-white flex flex-col justify-center overflow-hidden" style={{ background: "radial-gradient(1000px 400px at 15% -10%,rgba(139,92,246,.5),transparent 60%),linear-gradient(120deg,#1e1b3a,#3b1d6e)" }}>
            <div className="flex items-center gap-2.5 mb-auto">
              <span className="w-[34px] h-[34px] rounded-[9px] bg-white/15 flex items-center justify-center">
                <FlaskConical size={16} className="text-white" aria-hidden="true" />
              </span>
              <span className="text-[15px] font-bold">Axal VC · Spin-Out Lab</span>
            </div>
            <h1 className="m-0 text-[44px] sm:text-[64px] leading-[.95] font-black tracking-[-.04em] text-transparent bg-clip-text" style={{ backgroundImage: "linear-gradient(90deg,#fff,#c4b5fd)", WebkitBackgroundClip: "text" }}>
              Program Brief
            </h1>
            <p className="mt-3.5 mb-0 text-[18px] text-[#cbc4e8] font-medium">From idea to {juris.entity}, funded in 28 days.</p>
            <div className="mt-auto flex flex-wrap gap-2">
              {outcomeBadgesFor(juris.key).map((c) => (
                <span key={c} className="px-3 py-1.5 rounded-full bg-white/10 border border-white/15 text-[12px] font-semibold text-[#ede9fe]">{c}</span>
              ))}
            </div>
          </div>

          {/* SLIDE 2 — THE PROGRAM */}
          <section data-brief-slide className="bg-white dark:bg-gray-900 print:bg-white border border-gray-200 dark:border-gray-800 print:border-gray-200 rounded-[16px] p-6 sm:p-9">
            <div className="text-[11px] font-bold uppercase tracking-[.06em] text-gray-400 mb-1.5">The program</div>
            <h2 className="m-0 mb-5 text-[26px] font-extrabold tracking-[-.02em] text-gray-900 dark:text-gray-100 print:text-gray-900">The 28-day pipeline</h2>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 print:grid-cols-4 gap-3">
              {PIPELINE_PHASES.map((p, i) => {
                const a = PHASE_ACCENTS[p.color];
                return (
                  <div key={p.name} className={`rounded-xl border p-3.5 ${a.bg} dark:bg-gray-950/60 dark:border-gray-800 print:break-inside-avoid`}>
                    <div className="flex items-center gap-1.5 mb-1.5">
                      <span className={`tabular-nums w-5 h-5 rounded-[6px] text-[11px] font-extrabold flex items-center justify-center ${a.chip}`}>{i + 1}</span>
                      <span className="text-[13px] font-bold text-gray-900 dark:text-gray-100 print:text-gray-900">{p.name}</span>
                    </div>
                    <span className={`tabular-nums inline-block whitespace-nowrap text-[10.5px] font-bold rounded-[6px] px-[7px] py-0.5 mb-2 ${a.chip}`}>{p.days}</span>
                    <ul className="m-0 p-0 list-none flex flex-col gap-1.5">
                      {pipelineItemsFor(p, juris.key).map((it) => (
                        <li key={it} className="flex gap-1.5 text-[11.5px] leading-snug text-gray-600 dark:text-gray-400 print:text-gray-600">
                          <span className={`flex-none font-bold ${a.ink}`} aria-hidden="true">·</span>
                          <span>{it}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                );
              })}
            </div>
          </section>

          {/* SLIDE 3 — DELIVERABLES */}
          <section data-brief-slide className="bg-white dark:bg-gray-900 print:bg-white border border-gray-200 dark:border-gray-800 print:border-gray-200 rounded-[16px] p-6 sm:p-9">
            <div className="text-[11px] font-bold uppercase tracking-[.06em] text-gray-400 mb-1.5">Deliverables</div>
            <h2 className="m-0 mb-5 text-[26px] font-extrabold tracking-[-.02em] text-gray-900 dark:text-gray-100 print:text-gray-900">What you leave with</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 print:grid-cols-3 gap-x-6 gap-y-5">
              {deliverables.map((d, i) => {
                const Icon = DELIVERABLE_ICONS[i];
                return (
                  <div key={d.name} className="flex gap-3 print:break-inside-avoid">
                    <span className="w-8 h-8 flex-none rounded-[9px] bg-violet-50 dark:bg-violet-900/40 print:bg-violet-50 text-violet-600 dark:text-violet-300 print:text-violet-600 flex items-center justify-center">
                      <Icon size={15} aria-hidden="true" />
                    </span>
                    <div>
                      <div className="text-[13.5px] font-bold text-gray-900 dark:text-gray-100 print:text-gray-900">{d.name}</div>
                      <div className="text-[12.5px] leading-snug text-gray-500 dark:text-gray-400 print:text-gray-500 mt-0.5">{d.desc}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          {/* SLIDE 4 — TRACK RECORD + APPLY */}
          <section data-brief-slide className="rounded-[16px] p-6 sm:p-9 text-white overflow-hidden" style={{ background: "linear-gradient(115deg,#5b21b6,#7c3aed)" }}>
            <div className="text-[11px] font-bold uppercase tracking-[.06em] text-[#d8b4fe] mb-1.5">Track record</div>
            <h2 className="m-0 mb-6 text-[26px] font-extrabold tracking-[-.02em]">Outcomes to date</h2>
            <div className="grid grid-cols-1 sm:grid-cols-3 print:grid-cols-3 gap-4 mb-8">
              {stats.map((s) => (
                <div key={s.label} className="rounded-[12px] bg-white/10 border border-white/15 p-[18px]">
                  <div className="tabular-nums text-[24px] font-extrabold">{s.value}</div>
                  <div className="text-[12px] text-[#e9d5ff] mt-0.5">{s.label}</div>
                </div>
              ))}
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3.5 border-t border-white/20 pt-6">
              <div>
                <div className="text-[18px] font-extrabold">
                  {cohort ? `Apply to Cohort ${cohort.cohortNum}` : "Apply to the next cohort"}
                </div>
                <div className="tabular-nums text-[13px] text-[#e9d5ff] mt-0.5">
                  {cohort ? `Applications close ${cohort.deadlineLabel} · 8 spots` : "Applications are now open · 8 spots"}
                </div>
              </div>
              <div className="text-[12px] text-[#c4b5fd] max-w-[280px]">
                Open to all Axal VC users. Acceptance is selective. No equity taken by Axal VC.
              </div>
            </div>
          </section>

        </div>
      </div>
    </div>
  );
}
