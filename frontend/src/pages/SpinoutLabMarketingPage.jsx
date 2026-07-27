import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Check, Rocket, Circle, Lock } from 'lucide-react';
import PublicNav from '../components/PublicNav';
import PublicFooter from '../components/PublicFooter';
import { PIPELINE_PHASES, PHASE_THEMES, DELIVERABLES, TRACKER_BOARD, MILESTONE_LABELS as LAB_MILESTONE_LABELS } from './SpinoutLabPage';

const APPLY_HREF = '/register?lane=founder&product=spinout-lab';
const CONTACT_HREF = 'mailto:hello@axal.vc?subject=Spin-Out%20Lab';

const ALUMNI = [
  { initials: 'AB', bg: 'bg-violet-100 dark:bg-violet-900', ink: 'text-violet-700 dark:text-violet-200', name: 'Arborline', sector: 'Climate · MRV', cohort: 2, raised: '$450K pre-seed', outcome: 'Closed pre-seed · Now on AngelList' },
  { initials: 'PX', bg: 'bg-blue-100 dark:bg-blue-900', ink: 'text-blue-700 dark:text-blue-200', name: 'Pyxis Health', sector: 'Digital health', cohort: 2, raised: '$1.1M seed', outcome: 'Seed led by Foundry Group' },
  { initials: 'KT', bg: 'bg-teal-100 dark:bg-teal-900', ink: 'text-teal-700 dark:text-teal-200', name: 'Kettle', sector: 'Fintech · SMB', cohort: 1, raised: '$600K pre-seed', outcome: 'Pre-seed · 3 angel checks' },
  { initials: 'MR', bg: 'bg-amber-100 dark:bg-amber-900', ink: 'text-amber-700 dark:text-amber-200', name: 'Meridian Robotics', sector: 'Industrial AI', cohort: 1, raised: '$250K angel', outcome: 'Bridge round · Revenue positive' },
];

export default function SpinoutLabMarketingPage() {
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
            <a href={CONTACT_HREF} className="h-10 px-4 rounded-[10px] border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-300 text-[13.5px] font-semibold flex items-center gap-2 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">
              Talk to a Manager
            </a>
            <Link to={APPLY_HREF} className="h-10 px-4.5 rounded-[10px] bg-violet-600 text-white text-[13.5px] font-semibold flex items-center gap-2 shadow-sm shadow-violet-500/30 hover:bg-violet-700 transition-colors">
              Apply to Next Cohort <span className="text-[15px]" aria-hidden="true">→</span>
            </Link>
          </div>
        </div>

        {/* HERO SECTION */}
        <section className="rounded-[20px] p-[38px] md:p-[40px] mb-12 overflow-hidden relative text-white" style={{ background: 'radial-gradient(1200px 400px at 12% -20%,rgba(139,92,246,.5),transparent 60%),linear-gradient(115deg,#1e1b3a 0%,#2a1d54 55%,#3b1d6e 100%)' }}>
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
              const t = PHASE_THEMES[p.color];
              // Marketing view shows all static logic, no active rings
              return (
                <div key={i} className="flex items-stretch flex-1 min-w-0">
                  <div className={`flex-1 min-w-0 rounded-[16px] p-[18px] flex flex-col transition-all bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 hover:shadow-md`}>
                    <div className="flex items-center justify-between mb-2.5">
                      <div className="flex items-center gap-2 min-w-0">
                        <div className={`w-[30px] h-[30px] flex-none rounded-[9px] font-extrabold text-[14px] flex items-center justify-center ${t.chip} ${t.ink}`}>{i + 1}</div>
                        <div className="text-[15px] font-extrabold tracking-[-.01em]">{p.name}</div>
                      </div>
                      <span className={`w-[24px] h-[24px] flex-none flex items-center justify-center text-gray-400`} aria-label="Locked">
                        <Lock size={14} aria-hidden="true" />
                      </span>
                    </div>
                    <span className={`tabular-nums self-start whitespace-nowrap px-[9px] py-[3px] rounded-[7px] text-[11px] font-bold mb-[13px] ${t.chip} ${t.ink}`}>
                      {p.days}
                    </span>
                    <ul className="m-0 p-0 list-none flex flex-col gap-2 mb-4">
                      {p.milestones.map((m) => (
                         <li key={m} className="flex gap-2 text-[12.5px] leading-[1.35] text-gray-700 dark:text-gray-300">
                           <span className={`flex-none font-bold ${t.ink}`} aria-hidden="true">·</span>
                           <span className="flex-1 flex flex-col gap-1.5">{LAB_MILESTONE_LABELS[m] || m.replace(/_/g, ' ')}</span>
                         </li>
                      ))}
                    </ul>
                    {p.tools && p.tools.length > 0 && (
                      <div className={`mt-auto flex flex-col gap-1.5 border-t pt-3 border-gray-100 dark:border-gray-800`}>
                         {p.tools.map((tool) => (
                           <Link key={tool.label} to={tool.to} className={`flex items-center justify-between text-[11.5px] font-semibold px-2.5 py-2 rounded-lg transition-colors bg-gray-50/50 dark:bg-gray-800/30 hover:bg-gray-100 dark:hover:bg-gray-800 border border-gray-100 dark:border-gray-800 text-gray-600 dark:text-gray-400`}>
                              <span>{tool.label}</span>
                              <ArrowRight size={12} aria-hidden="true" />
                           </Link>
                         ))}
                      </div>
                    )}
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
        </section>

        {/* WHAT YOU LEAVE WITH */}
        <section className="mb-12">
          <h2 className="m-0 mb-5 text-[20px] font-extrabold tracking-[-.02em]">What you leave with.</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-3 gap-4">
            {DELIVERABLES.map((d, i) => (
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
                        <div key={ci} className="bg-gray-50 dark:bg-gray-800/50 border border-gray-100 dark:border-gray-800 rounded-xl p-3 hover:bg-white dark:hover:bg-gray-800 hover:shadow-sm transition-all cursor-pointer">
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

        {/* ALUMNI */}
        <section className="mb-12">
          <div className="flex items-baseline justify-between mb-5">
            <h2 className="m-0 text-[20px] font-extrabold tracking-[-.02em]">Graduate companies.</h2>
            <span className="text-[12.5px] text-gray-400">Select a company to view its profile</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {ALUMNI.map((a, i) => (
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

        {/* APPLICATION CTA */}
        <section className="rounded-[20px] p-10 text-center relative overflow-hidden text-white" style={{ background: 'radial-gradient(900px 300px at 85% 120%,rgba(196,181,253,.35),transparent 60%),linear-gradient(115deg,#5b21b6,#7c3aed)' }}>
          <h2 className="m-0 text-[32px] font-black tracking-[-.03em]">Apply to Cohort 4.</h2>
          <p className="tabular-nums my-3 mb-6 text-[15px] text-[#e9d5ff]">Applications close August 1, 2026. 8 spots available.</p>
          <div className="flex gap-3 justify-center flex-wrap">
            <Link to={APPLY_HREF} className="h-11 px-5.5 rounded-[11px] bg-white text-[#6d28d9] text-[14px] font-bold flex items-center gap-2 hover:bg-gray-50 transition-colors">
              Apply Now <span className="text-[16px]" aria-hidden="true">→</span>
            </Link>
            <a href={CONTACT_HREF} className="h-11 px-5.5 rounded-[11px] border border-white/40 bg-transparent text-white text-[14px] font-semibold flex items-center hover:bg-white/10 transition-colors">
              Talk to a Program Manager
            </a>
          </div>
          <p className="mt-6 text-[12px] text-[#c4b5fd]">Spin-Out Lab is open to all Meridian users. Acceptance is selective. No equity taken by Meridian.</p>
        </section>

      </main>
      <PublicFooter />
    </div>
  );
}
