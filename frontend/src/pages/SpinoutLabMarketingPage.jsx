import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, BadgeCheck, Check, Circle, FileText, Lock } from 'lucide-react';
import PublicNav from '../components/PublicNav';
import PublicFooter from '../components/PublicFooter';
import { PIPELINE_PHASES, PHASE_THEMES, pipelineItemsFor, deliverablesFor, outcomeBadgesFor, labJurisdiction, JurisdictionBar, HeroStatsPanel, CohortTrackerSection, GraduatesSection, ApplyCtaSection, LAB_APPLY_HREF as APPLY_HREF } from './SpinoutLabPage';

// Static status snapshot mirroring the design handoff (Spin-Out Lab.dc.html
// phaseDefs): Validate/Structure complete, Build in flight, Pitch/Fund
// still gated. Presentational only — the logged-out page has no cohort.
const PHASE_STATUS = ['done', 'done', 'active', 'future', 'future'];

export default function SpinoutLabMarketingPage() {
  // Client-state only — the selection restyles entity/filing copy across
  // the page (hero chips, pipeline Structure lines, deliverables).
  const [jurisdiction, setJurisdiction] = useState('de');
  const juris = labJurisdiction(jurisdiction);

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 text-gray-900 dark:text-gray-100">
      <PublicNav />

      <main className="max-w-[1080px] mx-auto px-6 pt-32 pb-24">

        {/* PAGE HEADER / INTRO */}
        <div className="flex flex-wrap gap-5 items-start justify-between mb-8">
          <div>
            <div className="flex items-center gap-3 mb-2.5">
              <h1 className="m-0 text-3xl font-extrabold tracking-tight">Spin-Out Lab</h1>
              <span className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-emerald-50 border border-emerald-200 text-xs font-semibold text-emerald-700 dark:bg-emerald-500/10 dark:border-emerald-500/20 dark:text-emerald-400">
                <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
                Cohort 4 · Applications Open
              </span>
            </div>
            <p className="m-0 text-[15px] text-gray-500 dark:text-gray-400">From idea to incorporated in 30 days.</p>
          </div>
          <div className="flex gap-2.5 items-center">
            <Link to="/spinout-lab/brief" className="h-10 px-4 rounded-[10px] border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-300 text-[13.5px] font-semibold flex items-center gap-2 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">
              <FileText size={15} aria-hidden="true" /> Download Program Brief
            </Link>
            <Link to={APPLY_HREF} className="h-10 px-4.5 rounded-[10px] bg-violet-600 text-white text-[13.5px] font-semibold flex items-center gap-2 shadow-sm shadow-violet-500/30 hover:bg-violet-700 transition-colors">
              Apply to Next Cohort <span className="text-[15px]" aria-hidden="true">→</span>
            </Link>
          </div>
        </div>

        {/* JURISDICTION SELECTOR */}
        <JurisdictionBar value={jurisdiction} onChange={setJurisdiction} />

        {/* HERO SECTION */}
        <section className="rounded-[20px] p-[38px] md:p-[40px] mb-12 overflow-hidden relative text-white" style={{ background: 'radial-gradient(1200px 400px at 12% -20%,rgba(139,92,246,.5),transparent 60%),linear-gradient(115deg,#1e1b3a 0%,#2a1d54 55%,#3b1d6e 100%)' }}>
          <div className="flex flex-wrap gap-10 justify-between items-center relative z-10">
            <div className="min-w-[300px] flex-1">
              <div className="tabular-nums text-[76px] leading-[0.9] font-black tracking-[-0.04em] text-transparent bg-clip-text" style={{ backgroundImage: 'linear-gradient(90deg,#fff,#c4b5fd)', WebkitBackgroundClip: 'text' }}>30 days</div>
              <p className="my-3.5 mb-5 text-[16px] text-[#cbc4e8] font-medium">Idea <span className="text-[#8b5cf6]">→</span> {juris.entity} <span className="text-[#8b5cf6]">→</span> Funded</p>
              <div className="flex flex-wrap gap-2">
                {outcomeBadgesFor(jurisdiction).map((b) => (
                  <span key={b} className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-full bg-white/10 border border-white/20 text-[12.5px] font-semibold text-[#ede9fe]">{b}</span>
                ))}
              </div>
            </div>
            <HeroStatsPanel />
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
              const t = PHASE_THEMES[p.color];
              const status = PHASE_STATUS[i];
              const statusIcon = status === 'done'
                ? <Check size={14} strokeWidth={3} className="text-white" aria-hidden="true" />
                : status === 'active'
                  ? <Circle size={14} fill="currentColor" stroke="none" style={{ animation: 'wsPulse 2s infinite' }} className={t.ink} aria-hidden="true" />
                  : <Lock size={14} className="text-gray-400" aria-hidden="true" />;
              return (
                <div key={i} className="flex items-stretch flex-1 min-w-0">
                  <div className={`flex-1 min-w-0 rounded-[16px] p-[18px] flex flex-col transition-all border hover:shadow-md ${t.bg} ${t.border} ${status === 'active' ? `ring-2 ring-offset-2 dark:ring-offset-gray-950 shadow-lg ${t.ring}` : ''}`}>
                    <div className="flex items-center justify-between mb-2.5">
                      <div className="flex items-center gap-2 min-w-0">
                        <div className={`w-[30px] h-[30px] flex-none rounded-[9px] font-extrabold text-[14px] flex items-center justify-center ${t.chip} ${t.ink}`}>{i + 1}</div>
                        <div className="text-[15px] font-extrabold tracking-[-.01em]">{p.name}</div>
                      </div>
                      <span className={`w-[24px] h-[24px] flex-none flex items-center justify-center ${status === 'done' ? 'rounded-full' : ''}`} style={status === 'done' ? { background: t.fill } : {}}>
                        {statusIcon}
                      </span>
                    </div>
                    <span className={`tabular-nums self-start whitespace-nowrap px-[9px] py-[3px] rounded-[7px] text-[11px] font-bold mb-[13px] ${t.chip} ${t.ink}`}>
                      {p.days}
                    </span>
                    <ul className="m-0 p-0 list-none flex flex-col gap-2">
                      {pipelineItemsFor(p, jurisdiction).map((d) => (
                         <li key={d} className="flex gap-2 text-[12.5px] leading-[1.35] text-gray-700 dark:text-gray-300">
                           <span className={`flex-none font-bold ${t.ink}`} aria-hidden="true">·</span>
                           <span>{d}</span>
                         </li>
                      ))}
                    </ul>
                  </div>
                  {i < PIPELINE_PHASES.length - 1 && (
                    <div className="w-[26px] flex-none hidden lg:flex items-center justify-center text-gray-300 dark:text-gray-700">
                      <ArrowRight size={18} aria-hidden="true" />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          <p className="mt-4 mb-0 text-[12.5px] text-gray-400 flex items-center gap-2">
            <BadgeCheck size={16} className="flex-none text-violet-500" aria-hidden="true" />
            All Spin-Out Lab graduates receive a verified "Spin-Out Lab Alumni" badge on their Axal VC founder profile.
          </p>
        </section>

        {/* WHAT YOU LEAVE WITH */}
        <section className="mb-12">
          <h2 className="m-0 mb-5 text-[20px] font-extrabold tracking-[-.02em]">What you leave with.</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-3 gap-4">
            {deliverablesFor(jurisdiction).map((d, i) => (
              <div key={i} className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-[16px] p-5 shadow-sm hover:shadow-md transition-shadow">
                <div className="w-10 h-10 rounded-[11px] bg-violet-50 dark:bg-violet-900/40 text-violet-600 dark:text-violet-400 flex items-center justify-center mb-3.5">
                  {d.icon}
                </div>
                <div className="text-[14.5px] font-bold mb-1.5">{d.name}</div>
                <div className="text-[12.7px] leading-[1.45] text-gray-500 dark:text-gray-400">{d.desc}</div>
              </div>
            ))}
          </div>
        </section>

        {/* ACTIVE COHORT TRACKER — live data */}
        <CohortTrackerSection />

        {/* ALUMNI */}
        <GraduatesSection />

        {/* APPLICATION CTA */}
        <ApplyCtaSection />

      </main>
      <PublicFooter />
    </div>
  );
}
