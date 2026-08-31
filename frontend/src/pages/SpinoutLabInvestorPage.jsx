// Spin-Out Lab — the INVESTOR/LP entry surface, served at /spinout-lab for the
// investor role (see the route branch in App.jsx). Native port of the Claude
// Design export `Explore the Spin-Out Lab.dc.html`.
//
// WHAT THIS PAGE IS
// =================
// The conviction step of a two-page investor journey:
//
//   /spinout-lab                      → THIS PAGE. Why the Lab produces
//                                       underwritable companies, what founders
//                                       do inside it, why the model matters in
//                                       an AI-native environment, and why Axal
//                                       holds a proprietary underwriting edge.
//   /spinout-lab/investor-workspace   → Spin-Out Lab · LP & Investor Workspace:
//                                       fund terms, raise status, tiers,
//                                       reporting, allocation, and the
//                                       application / request-access flow.
//
// Every CTA here routes to the workspace — the numbers-and-apply page — so the
// journey is: understand the machine, then review the fund, then apply.
//
// WHAT CHANGED FROM THE DESIGN, AND WHY
// =====================================
// 1. NO DETACHED CHROME. The design ships its own sticky nav and a fullscreen
//    "Present" toggle; this page renders inside the authenticated app shell,
//    so both are dropped and the design's nav CTAs live in the page header.
// 2. LIVE FIGURES WHERE A SOURCE EXISTS. The hero proof tiles overlay
//    GET /api/spinout-lab/fund-metrics (same merge, same fallback semantics as
//    the LP workspace); everything else is the operator-maintained content in
//    lib/spinoutInvestorContent.js, one auditable module.
// 3. HONEST COHORT SECTION. The design presents six named "live readings".
//    No endpoint reports per-company cohort telemetry to investors, so that
//    section renders as an explicitly-captioned illustrative composite —
//    see COHORT_SNAPSHOT.provenance, which this page must (and tests do)
//    render verbatim.
// 4. REAL DOCUMENT CTA. "Fund brief (PDF)" produces the actual brief via the
//    same exportFundBriefPdf the workspace uses — not a decorative button.
import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, FileDown, Landmark, Loader2 } from 'lucide-react';
import { useAuth } from '../hooks/useAuthSync';
import { spinoutLab } from '../lib/api';
import { reportError } from '../lib/log';
import { fundModel, money } from '../lib/spinoutFundModel';
import {
  HERO, JOURNEY, STACK, WHY_NOW, EDGE, NETWORK, PROOF_STUDIO_STATIC,
  COHORT_SNAPSHOT, CASE_ITEMS, FINAL_CTA, DISCLAIMER, FUND, PROGRAM,
} from '../lib/spinoutInvestorContent';

/** The deeper LP workspace — the single destination every CTA points at. */
export const LP_WORKSPACE_PATH = '/spinout-lab/investor-workspace';

/* ---------------------------------------------------------------- primitives */

const LBL = 'text-[10.5px] font-extrabold uppercase tracking-[0.13em] text-gray-400 dark:text-gray-500';
const MONO = 'font-mono tabular-nums';
const CARD = 'rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900';

const TONE_TEXT = {
  ink: 'text-gray-900 dark:text-gray-100',
  green: 'text-green-700 dark:text-green-400',
  violet: 'text-violet-700 dark:text-violet-400',
};

const READ_CHIP = {
  green: 'bg-green-100 text-green-700 dark:bg-green-950/40 dark:text-green-300',
  amber: 'bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300',
  red: 'bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-300',
};

function SectionHead({ label, headline, sub }) {
  return (
    <div>
      <div className={LBL}>{label}</div>
      <div className="mt-3.5 mb-6 h-px bg-gradient-to-r from-violet-400/40 to-transparent" />
      <div className="grid gap-6 lg:grid-cols-[1.1fr_1fr] lg:gap-11 items-start">
        <h2 className="m-0 text-[26px] sm:text-[32px] font-extrabold tracking-tight leading-tight text-gray-900 dark:text-gray-100">{headline}</h2>
        <p className="m-0 text-[14px] leading-relaxed text-gray-600 dark:text-gray-400">{sub}</p>
      </div>
    </div>
  );
}

const btnPrimary = 'inline-flex items-center justify-center gap-2 rounded-xl bg-violet-700 px-6 py-3 text-sm font-extrabold text-white hover:bg-violet-800 transition-colors';
const btnGhost = 'inline-flex items-center justify-center gap-2 rounded-xl border border-gray-300 dark:border-gray-700 px-6 py-3 text-sm font-bold text-gray-900 dark:text-gray-100 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors';

/** "Fund brief (PDF)" — generates the real document via the shared renderer. */
function FundBriefButton({ className }) {
  const { user } = useAuth();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const onClick = async () => {
    if (busy) return;
    setBusy(true); setErr('');
    try {
      const { exportFundBriefPdf } = await import('../lib/fundBriefPdf');
      await exportFundBriefPdf({ recipient: { name: user?.name, email: user?.email } });
    } catch (e) {
      setErr(e?.message || 'Could not generate the fund brief.');
      reportError('SpinoutLabInvestorPage:brief', e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <span className="inline-flex flex-col gap-1">
      <button type="button" onClick={onClick} disabled={busy} className={className} data-testid="button-investor-fund-brief">
        {busy ? <Loader2 size={15} className="animate-spin" /> : <FileDown size={15} />}
        {busy ? 'Preparing…' : 'Fund brief (PDF)'}
      </button>
      {err && <span className="text-[11px] text-red-600 dark:text-red-400">{err}</span>}
    </span>
  );
}

/* --------------------------------------------------------------------- page */

export default function SpinoutLabInvestorPage() {
  // Live program/raise overlay — identical merge to the LP workspace: a block
  // is used only when it answers `available: true`; a failed fetch or an
  // unavailable block falls back to the operator-maintained model, and the
  // provenance caption follows the same flag so this page never claims live
  // telemetry it does not have.
  const [live, setLive] = useState(null);
  useEffect(() => {
    let alive = true;
    spinoutLab.fundMetrics()
      .then((r) => { if (alive) setLive(r); })
      .catch(() => { if (alive) setLive(null); });
    return () => { alive = false; };
  }, []);

  const M = useMemo(() => fundModel(), []);
  const liveProgram = live?.program?.available ? live.program : null;
  const liveFund = live?.fund?.available ? live.fund : null;

  const P = liveProgram
    ? {
      graduates: liveProgram.graduates,
      onTimeIncorpPct: liveProgram.on_time_pct,
      alumniRaisedM: liveProgram.alumni_raised != null ? liveProgram.alumni_raised / 1e6 : null,
    }
    : PROGRAM;

  const committedM = liveFund && Number(liveFund.committed) > 0
    ? Number(liveFund.committed) / 1e6
    : FUND.committed;
  const capacityM = Math.max(0, FUND.target - committedM);

  const heroProof = [
    { k: 'Graduates to date', v: String(P.graduates), tone: 'ink', note: 'Across three completed cohorts' },
    { k: 'Incorporated on time', v: P.onTimeIncorpPct != null ? `${P.onTimeIncorpPct}%` : '—', tone: 'green', note: 'Within the 28-day schedule' },
    { k: 'Raised post-program', v: P.alumniRaisedM != null ? `$${P.alumniRaisedM.toFixed(1)}M` : '—', tone: 'green', note: 'External capital, alumni companies' },
    { k: 'Deployed by the fund', v: money.m(M.investedK), tone: 'violet', note: `${M.positions.length} positions held` },
  ];

  // Studio throughput, tile by tile. Each takes the live value when
  // /fund-metrics reports one and falls back to the operator-maintained figure
  // in spinoutInvestorContent.js otherwise — per TILE, not per page, because
  // the endpoint can measure some of these and not others (a null percentage
  // there means "no denominator", never 0%). `liveNote` records which side a
  // tile landed on so the caption below can count them honestly.
  const pick = (liveValue, format, staticTile) => (liveValue != null
    ? { ...staticTile, v: format(liveValue), live: true }
    : { ...staticTile, live: false });
  const staticBy = Object.fromEntries(PROOF_STUDIO_STATIC.map((t) => [t.key, t]));
  const pctFmt = (n) => `${n}%`;

  const proofStudio = [
    { key: 'graduates', k: 'Graduates to date', v: String(P.graduates), tone: 'ink', note: 'Across completed cohorts', live: !!liveProgram },
    pick(liveProgram?.incorporation_pct, pctFmt, staticBy.incorporation_rate),
    { key: 'on_time', k: 'Incorporated on time', v: P.onTimeIncorpPct != null ? `${P.onTimeIncorpPct}%` : '—', tone: 'green', note: 'Inside the 28-day window', live: !!liveProgram && P.onTimeIncorpPct != null },
    pick(liveProgram?.verified_discovery_pct, pctFmt, staticBy.verified_discovery),
    pick(liveProgram?.revenue_proof_pct, pctFmt, staticBy.revenue_proof),
    { key: 'alumni', k: 'Alumni follow-on', v: P.alumniRaisedM != null ? `$${P.alumniRaisedM.toFixed(1)}M` : '—', tone: 'green', note: 'Raised externally post-program', live: !!liveProgram && P.alumniRaisedM != null },
    pick(liveProgram?.formation_velocity_days, (n) => `${n} days`, staticBy.formation_velocity),
    pick(liveProgram?.graduation_to_investment_pct, pctFmt, staticBy.graduation_investment),
  ];
  const liveTiles = proofStudio.filter((t) => t.live).length;

  return (
    <div className="mx-auto max-w-[1240px] px-5 sm:px-8 pb-20" data-testid="spinout-investor-page">

      {/* ============ HERO ============ */}
      <div className="relative overflow-hidden rounded-3xl border border-gray-200 dark:border-gray-800">
        <img src="/axal-vc-future.png" alt="" aria-hidden="true" className="absolute inset-0 h-full w-full object-cover object-[center_30%]" />
        <div className="absolute inset-0 bg-gradient-to-r from-gray-50/[.97] via-violet-50/[.94] to-violet-100/[.86] dark:from-gray-950/[.97] dark:via-gray-950/[.93] dark:to-violet-950/[.85]" />
        <div className="relative px-6 py-12 sm:px-12 sm:py-16">
          <div className={`${LBL} mb-5`}>{HERO.eyebrow}</div>
          <h1 className="m-0 max-w-[660px] text-[34px] sm:text-[48px] font-black leading-[1.06] tracking-[-.03em] text-gray-900 dark:text-gray-100">
            {HERO.headline}
          </h1>
          <p className="mt-5 max-w-[600px] text-[15px] sm:text-[16px] leading-relaxed text-gray-600 dark:text-gray-300">{HERO.sub}</p>
          <div className="mt-7 flex flex-wrap gap-3">
            <Link to={LP_WORKSPACE_PATH} data-testid="link-review-fund-hero" className={btnPrimary}>Review the fund</Link>
            <FundBriefButton className={btnGhost} />
          </div>

          {/* studio proof strip */}
          <div className="mt-12 grid grid-cols-2 lg:grid-cols-4 gap-px overflow-hidden rounded-2xl border border-gray-200 dark:border-gray-800 bg-gray-200 dark:bg-gray-800">
            {heroProof.map((p) => (
              <div key={p.k} className="bg-white dark:bg-gray-900 px-5 py-5">
                <div className={`${MONO} text-[26px] font-extrabold tracking-tight ${TONE_TEXT[p.tone]}`}>{p.v}</div>
                <div className={`${LBL} mt-1.5`}>{p.k}</div>
                <div className="mt-1 text-[11.5px] leading-snug text-gray-500 dark:text-gray-400">{p.note}</div>
              </div>
            ))}
          </div>
          <div className="mt-3 text-[11px] text-gray-400 dark:text-gray-500" data-testid="text-proof-provenance">
            {liveProgram
              ? 'Program figures are live from platform records; fund deployment reflects the operator-maintained portfolio model.'
              : 'Program and deployment figures are operator-maintained; live platform metrics substitute automatically when available.'}
          </div>
        </div>
      </div>

      {/* ============ 01 · INSIDE THE LAB ============ */}
      <section className="pt-16">
        <SectionHead
          label="01 · Inside the lab"
          headline="Founders do not pitch here. They execute against a fixed 28-day schedule."
          sub="Each week has defined deliverables, gated tools, and evidence requirements. Nothing advances on assertion — a week closes when the artifact exists in the system. That schedule is what makes founder behavior comparable across cohorts, and comparable behavior is what we underwrite."
        />
        <div className="mt-9 grid gap-3.5 sm:grid-cols-2 xl:grid-cols-4">
          {JOURNEY.map((j) => (
            <div key={j.wk} className={`${CARD} flex flex-col p-6`}>
              <div className="flex items-center gap-2.5">
                <div className={`${MONO} text-[11.5px] font-bold text-violet-700 dark:text-violet-400`}>{j.wk}</div>
                <div className="h-px flex-1 bg-violet-400/25" />
              </div>
              <div className="mt-3.5 text-[16px] font-extrabold tracking-tight text-gray-900 dark:text-gray-100">{j.t}</div>
              <p className="mt-2 flex-1 text-[12.5px] leading-relaxed text-gray-500 dark:text-gray-400 m-0">{j.body}</p>
              <div className="mt-4 border-t border-gray-200 dark:border-gray-800 pt-3.5">
                <div className={`${LBL} text-[9.5px]`}>Evidence produced</div>
                <ul className="m-0 mt-2 list-none space-y-1.5 p-0">
                  {j.out.map((o) => (
                    <li key={o} className="flex gap-2 text-[11.5px] leading-snug text-gray-700 dark:text-gray-300">
                      <span className="flex-none text-green-700 dark:text-green-400">·</span>{o}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ============ 02 · OPERATING STACK ============ */}
      <section className="pt-16">
        <SectionHead
          label="02 · Founder operating stack"
          headline="Nineteen working tools, gated by week — not a curriculum."
          sub="Founders do the work inside the system, so the system holds the record. Interview logs, pricing tests, cap tables, filings, and pitch materials are all first-class objects — which is why we can score readiness rather than take a founder's word for it."
        />
        <div className="mt-9 grid gap-3.5 sm:grid-cols-2 xl:grid-cols-3">
          {STACK.map((s) => (
            <div key={s.t} className={`${CARD} p-6`}>
              <div className="flex items-center justify-between gap-2.5">
                <div className="text-[14.5px] font-extrabold tracking-tight text-gray-900 dark:text-gray-100">{s.t}</div>
                <span className="inline-flex flex-none items-center rounded-full bg-violet-100 dark:bg-violet-950/40 px-2.5 py-0.5 text-[10px] font-bold text-violet-700 dark:text-violet-300 whitespace-nowrap">{s.week}</span>
              </div>
              <p className="m-0 mt-2 text-[12.5px] leading-relaxed text-gray-500 dark:text-gray-400">{s.body}</p>
              <div className="mt-3.5 flex flex-wrap gap-1.5">
                {s.tools.map((tl) => (
                  <span key={tl} className="rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-100 dark:bg-gray-800 px-2 py-1 text-[11px] font-semibold text-gray-700 dark:text-gray-300">{tl}</span>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ============ 03 · WHY NOW ============ */}
      <section className="mt-16 rounded-3xl border border-gray-200 dark:border-gray-800 bg-gradient-to-b from-violet-50/70 to-transparent dark:from-violet-950/25 px-6 py-12 sm:px-10">
        <SectionHead label="03 · Why this model works now" headline={WHY_NOW.headline} sub={WHY_NOW.sub} />
        <div className="mt-9 grid gap-3.5 lg:grid-cols-2">
          {WHY_NOW.items.map((w) => (
            <div key={w.n} className={`${CARD} flex gap-4 p-6`}>
              <div className={`${MONO} flex-none pt-0.5 text-[12px] font-bold text-violet-600 dark:text-violet-400`}>{w.n}</div>
              <div>
                <div className="text-[15px] font-extrabold tracking-tight text-gray-900 dark:text-gray-100">{w.t}</div>
                <p className="m-0 mt-1.5 text-[13px] leading-relaxed text-gray-500 dark:text-gray-400">{w.body}</p>
                <p className="m-0 mt-2.5 border-l-2 border-violet-400/40 pl-3 text-[12.5px] leading-relaxed text-violet-800 dark:text-violet-300">{w.so}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ============ 04 · UNDERWRITING EDGE ============ */}
      <section className="pt-16">
        <SectionHead
          label="04 · Why Axal sees more than the market"
          headline="Twenty-eight days of observed behavior beats a sixty-minute meeting."
          sub="Traditional pre-seed underwrites a narrative delivered by a prepared founder. We underwrite a record we watched accumulate — including what the founder got wrong, and how fast they corrected."
        />
        <div className={`${CARD} mt-9 overflow-hidden rounded-2xl`}>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] border-collapse text-left">
              <thead>
                <tr className="border-b border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-950/60">
                  <th className={`${LBL} px-6 py-3.5 font-extrabold`}>Signal</th>
                  <th className={`${LBL} px-4 py-3.5 font-extrabold`}>Traditional pre-seed</th>
                  <th className={`${LBL} px-4 py-3.5 font-extrabold text-violet-700 dark:text-violet-400`}>Spin-Out Lab</th>
                </tr>
              </thead>
              <tbody>
                {EDGE.map((e) => (
                  <tr key={e.k} className="border-b border-gray-100 dark:border-gray-800/60 last:border-0">
                    <td className="px-6 py-3.5 text-[13px] font-bold text-gray-900 dark:text-gray-100">{e.k}</td>
                    <td className="px-4 py-3.5 text-[12.5px] leading-snug text-gray-600 dark:text-gray-400">{e.trad}</td>
                    <td className="bg-violet-50/60 dark:bg-violet-950/25 px-4 py-3.5 text-[12.5px] leading-snug text-gray-700 dark:text-gray-300">{e.lab}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <div className="mt-3.5 grid gap-3.5 sm:grid-cols-3">
          {NETWORK.map((n) => (
            <div key={n.t} className={`${CARD} p-6`}>
              <div className={`${MONO} text-[22px] font-extrabold tracking-tight text-violet-700 dark:text-violet-400`}>{n.v}</div>
              <div className="mt-1.5 text-[14px] font-extrabold text-gray-900 dark:text-gray-100">{n.t}</div>
              <p className="m-0 mt-1.5 text-[12.5px] leading-relaxed text-gray-500 dark:text-gray-400">{n.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ============ 05 · STUDIO PROOF ============ */}
      <section className="pt-16">
        <SectionHead
          label="05 · Studio & portfolio proof"
          headline="The metrics that should move an LP — and the ones that shouldn't."
          sub="Application volume and demo-day attendance are not evidence. Formation velocity, verified discovery, revenue proof, and graduation-to-investment conversion are. Fund-level position — committed, called, deployed, marks, MOIC, reserve — lives in the LP workspace."
        />
        <div className="mt-9 grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-gray-200 dark:border-gray-800 bg-gray-200 dark:bg-gray-800 lg:grid-cols-4">
          {proofStudio.map((p) => (
            <div key={p.key} className="bg-white dark:bg-gray-900 px-5 py-5">
              <div className={`${MONO} text-[22px] font-extrabold tracking-tight ${TONE_TEXT[p.tone]}`}>{p.v}</div>
              <div className="mt-1.5 text-[11.5px] font-bold text-gray-700 dark:text-gray-300">{p.k}</div>
              <div className="mt-1 text-[11px] leading-snug text-gray-500 dark:text-gray-400">{p.note}</div>
            </div>
          ))}
        </div>
        {/* Per-tile provenance. The page never claims more measurement than it
            has: a tile is live only when the endpoint returned a value for it. */}
        <p className="m-0 mt-3 text-[11px] text-gray-400 dark:text-gray-500" data-testid="text-studio-provenance">
          {liveTiles === proofStudio.length
            ? 'All figures are live from platform records.'
            : liveTiles > 0
              ? `${liveTiles} of ${proofStudio.length} figures are live from platform records; the rest are operator-maintained until the platform can measure them.`
              : 'Figures are operator-maintained; live platform metrics substitute automatically as they become measurable.'}
        </p>
        <div className={`${CARD} mt-5 flex flex-wrap items-center gap-3.5 px-5 py-4`}>
          <span className="min-w-[260px] flex-1 text-[12.5px] leading-relaxed text-gray-600 dark:text-gray-400">
            Fund-level position — committed, called, deployed, portfolio marks, MOIC, and reserve — is maintained in the LP workspace and the quarterly reporting archive.
          </span>
          <Link to={LP_WORKSPACE_PATH} data-testid="link-fund-position" className="inline-flex flex-none items-center gap-1.5 rounded-lg bg-violet-700 hover:bg-violet-800 px-4 py-2 text-[12.5px] font-bold text-white transition-colors">
            See fund position <ArrowRight size={13} />
          </Link>
        </div>
      </section>

      {/* ============ 06 · COHORT SNAPSHOT (illustrative composite) ============ */}
      <section className="pt-16">
        <SectionHead label="06 · What moves through the system" headline={COHORT_SNAPSHOT.headline} sub={COHORT_SNAPSHOT.sub} />
        <div className="mt-9 grid gap-3.5 sm:grid-cols-2 xl:grid-cols-3">
          {COHORT_SNAPSHOT.ventures.map((v) => (
            <div key={v.sector} className={`${CARD} p-6`}>
              <div className="flex items-center gap-3">
                <div className="min-w-0 flex-1">
                  <div className="text-[13.5px] font-extrabold text-gray-900 dark:text-gray-100">{v.sector}</div>
                  <div className="mt-0.5 text-[11px] text-gray-500 dark:text-gray-400">{v.meta}</div>
                </div>
                <span className={`inline-flex flex-none items-center rounded-full px-2.5 py-0.5 text-[10px] font-bold ${READ_CHIP[v.tone]}`}>{v.read}</span>
              </div>
              <div className="my-3.5 flex gap-5">
                {v.stats.map((st) => (
                  <div key={st.k}>
                    <div className={`${MONO} text-[15px] font-bold text-gray-900 dark:text-gray-100`}>{st.v}</div>
                    <div className={`${LBL} mt-0.5 text-[9px]`}>{st.k}</div>
                  </div>
                ))}
              </div>
              <p className="m-0 border-t border-gray-200 dark:border-gray-800 pt-3 text-[12.5px] leading-relaxed text-gray-500 dark:text-gray-400">{v.note}</p>
            </div>
          ))}
        </div>
        {/* Provenance caption — REQUIRED. These are not live readings; the real
            named pipeline is workspace-gated. Tests assert this renders. */}
        <p className="m-0 mt-4 max-w-[760px] text-[11.5px] leading-relaxed text-gray-400 dark:text-gray-500" data-testid="text-cohort-provenance">
          {COHORT_SNAPSHOT.provenance}
        </p>
      </section>

      {/* ============ 07 · INVESTMENT CASE ============ */}
      <section className="pt-16">
        <div className={LBL}>07 · The investment case</div>
        <div className="mt-3.5 mb-6 h-px bg-gradient-to-r from-violet-400/40 to-transparent" />
        <div className="grid items-start gap-6 lg:grid-cols-[1.25fr_.8fr]">
          <div className="flex flex-col gap-3">
            {CASE_ITEMS.map((c) => (
              <div key={c.n} className={`${CARD} flex gap-4 p-6`}>
                <div className={`${MONO} flex-none pt-0.5 text-[12px] font-bold text-violet-600 dark:text-violet-400`}>{c.n}</div>
                <div>
                  <div className="text-[15px] font-extrabold tracking-tight text-gray-900 dark:text-gray-100">{c.t}</div>
                  <p className="m-0 mt-1.5 text-[13px] leading-relaxed text-gray-500 dark:text-gray-400">{c.body}</p>
                </div>
              </div>
            ))}
          </div>
          <div className="rounded-2xl border border-violet-300/40 dark:border-violet-800 bg-gradient-to-br from-violet-50 to-white dark:from-violet-950/40 dark:to-gray-900 p-7">
            <div className={`${LBL} mb-3 text-violet-700 dark:text-violet-400`}>Where the numbers live</div>
            <p className="m-0 text-[13.5px] leading-relaxed text-gray-700 dark:text-gray-300">
              This page explains why the pipeline is worth underwriting. Fund terms, the raise status, capital accounts, and the quarterly reporting archive are maintained in the LP workspace — one place, one source of truth.
            </p>
            <Link to={LP_WORKSPACE_PATH} data-testid="link-open-workspace" className={`${btnPrimary} mt-5 w-full`}>
              Open the LP workspace <ArrowRight size={14} />
            </Link>
            <FundBriefButton className={`${btnGhost} mt-2.5 w-full`} />
            <p className="m-0 mt-3.5 text-[11px] leading-relaxed text-gray-400 dark:text-gray-500">Full terms and capital account statements are available to approved LPs.</p>
          </div>
        </div>
      </section>

      {/* ============ 08 · FINAL CTA ============ */}
      <section className="pt-16">
        <div className="relative overflow-hidden rounded-3xl border border-violet-300/40 dark:border-violet-800 bg-gradient-to-br from-violet-100/80 to-white dark:from-violet-950/50 dark:to-gray-900 px-7 py-11 sm:px-12">
          <div className="max-w-[660px]">
            <div className={`${LBL} mb-4 text-violet-700 dark:text-violet-400`}>
              {FINAL_CTA.kicker} · ${capacityM.toFixed(1)}M capacity remaining
            </div>
            <h2 className="m-0 text-[26px] sm:text-[34px] font-black leading-[1.14] tracking-[-.03em] text-gray-900 dark:text-gray-100">{FINAL_CTA.headline}</h2>
            <p className="mt-4 text-[14.5px] leading-relaxed text-gray-600 dark:text-gray-300">{FINAL_CTA.body}</p>
            <div className="mt-7 flex flex-wrap gap-3">
              <Link to={LP_WORKSPACE_PATH} data-testid="link-request-access" className={btnPrimary}>
                <Landmark size={15} /> Request LP access
              </Link>
              <FundBriefButton className={btnGhost} />
            </div>
          </div>
        </div>
        <div className="mt-8 border-t border-gray-200 dark:border-gray-800 pt-6">
          <p className="m-0 max-w-[760px] text-[11.5px] leading-relaxed text-gray-400 dark:text-gray-500">{DISCLAIMER}</p>
        </div>
      </section>
    </div>
  );
}
