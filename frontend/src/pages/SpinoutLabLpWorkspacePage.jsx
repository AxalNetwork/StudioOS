// Spin-Out Lab · LP & Investor Workspace — native port of the Claude Design
// export `LP Investor Workspace.dc.html`, mounted inside the investor Fund Ops
// shell rather than shipped as a detached microsite.
//
// WHAT CHANGED FROM THE DESIGN, AND WHY
// =====================================
// 1. ACCESS STATE IS DERIVED, NOT CHOSEN. The export drives every gate off
//    `st.access`, flipped by a row of buttons. Shipping that would hand any
//    logged-in viewer a control that unlocks the reporting package, the LP data
//    room and the allocation sliders by claiming "$250K committed". Here the
//    state comes from the caller's own rows in GET /api/funds/lp-portal via the
//    pure `lpAccessState()` (see lib/spinoutFundModel.js). Admins keep a preview
//    switcher because the five states are otherwise unreachable to look at, and
//    it is inert — nothing on this page writes.
// 2. FUND-LEVEL FIGURES ARE LABELLED AS OPERATOR-MAINTAINED. No endpoint reports
//    raise progress or portfolio marks, so the design's "Live program telemetry ·
//    updated daily" caption would be a false provenance claim and is not used.
// 3. NO FAKE WRITES. Application submit and allocation submit have no backing
//    endpoint, so they state that plainly instead of pretending to persist.
//
// Everything else — thesis hero, raise progress, key terms, tier matrix,
// commitment process, application form, underwriting KPIs, report archive,
// participation-rights ladder, IR, allocation gate, onboarding requirements and
// the compliance footer — is preserved.
import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Landmark, Lock, Check, Clock, ShieldCheck, FileText,
  AlertCircle, MessageSquare, RefreshCw, FileDown, Loader2,
} from 'lucide-react';
import { WorkspaceHeader } from '../components/WorkspaceTabs';
import { useAuth } from '../hooks/useAuthSync';
import { api } from '../lib/api';
import {
  fundModel, money, lpAccessState, lpHasReports, lpAllocationOpen,
  ALLOC_THRESHOLD_K, LP_STATES, FUND, PROGRAM, THESIS, fundTerms,
  TIERS, TIER_RIGHTS, PROCESS_STEPS, allocationCandidates,
} from '../lib/spinoutFundModel';

/* ---------------------------------------------------------------- primitives */

const CARD =
  'rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900';
const LBL =
  'text-[11px] font-bold uppercase tracking-[0.08em] text-gray-400 dark:text-gray-500';
const MONO = 'font-mono tabular-nums';

const TONES = {
  violet: 'bg-violet-50 dark:bg-violet-950/40 text-violet-700 dark:text-violet-300',
  amber: 'bg-amber-100 dark:bg-amber-950/40 text-amber-800 dark:text-amber-300',
  green: 'bg-green-100 dark:bg-green-950/40 text-green-700 dark:text-green-300',
  gray: 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300',
};

function Chip({ tone = 'gray', children }) {
  return (
    <span className={`inline-flex flex-none items-center rounded-full px-2.5 py-0.5 text-[10.5px] font-bold ${TONES[tone] || TONES.gray}`}>
      {children}
    </span>
  );
}

function SectionLabel({ children, right }) {
  return (
    <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
      <div className={LBL}>{children}</div>
      {right}
    </div>
  );
}

/* ------------------------------------------------------------- state banner */

// One row per access state: the message an LP sees and what it points at.
// Mirrors the design's GATE map; the `go` targets are real destinations.
const GATE = {
  visitor: {
    tone: 'gray', icon: Lock, title: 'You are viewing by invitation.',
    body: 'This workspace is limited to curated LP and investor profiles. You can review the fund thesis, key terms and cohort performance summaries — participation requires an application and individual review.',
    wrap: 'border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-900/60',
  },
  pending: {
    tone: 'amber', icon: Clock, title: 'Application submitted — review in progress.',
    body: 'The fund team reviews every application individually. Reporting previews are visible below; full documents and participation unlock on acceptance, followed by KYC/AML and subscription.',
    wrap: 'border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/30',
  },
  approved: {
    tone: 'violet', icon: Check, title: 'You are approved. Complete your commitment to activate participation.',
    body: 'Approved LPs can review full reporting. Commit capital to receive the quarterly reporting package, and reach $250K to hold allocation and decision rights.',
    wrap: 'border-violet-200 dark:border-violet-900 bg-violet-50 dark:bg-violet-950/30',
  },
  committed: {
    tone: 'violet', icon: Check, title: 'You are a committed LP.',
    body: 'You receive the full reporting package, portfolio updates and demo-day observer access. Increase your commitment to $250K to hold allocation and decision rights.',
    wrap: 'border-violet-200 dark:border-violet-900 bg-violet-50 dark:bg-violet-950/30',
  },
  voting: {
    tone: 'green', icon: ShieldCheck, title: 'Full participation active.',
    body: `You hold allocation and decision rights for Cohort 4, complete reporting access, and follow-on co-invest priority. The allocation window closes ${FUND.demoDay}.`,
    wrap: 'border-green-200 dark:border-green-900 bg-green-50 dark:bg-green-950/30',
  },
};

const PROFILE_CHIP = {
  visitor: ['gray', 'Invited guest'],
  pending: ['amber', 'Applicant · under review'],
  approved: ['violet', 'Approved LP'],
  committed: ['violet', 'Committed LP'],
  voting: ['green', 'Committed LP · full rights'],
};

/* --------------------------------------------------------------- static data */

// TIERS, TIER_RIGHTS, PROCESS_STEPS and the key-terms list used to be declared
// here. They now live in lib/spinoutFundModel.js because the downloadable fund
// brief renders the same three sections: a second copy would let the document
// an LP takes away drift from the page they read it on.

const REPORT_PKG = [
  'Quarterly portfolio report with company-level marks',
  'Audited annual financial statements',
  'K-1 tax documents issued by March 15',
  'Capital account statement each quarter',
  'Cohort telemetry dashboard access',
  'Demo-day observer access',
];

const ONBOARDING = [
  ['Accredited status', 'Rule 501 self-certification', 'Verification letter or income/net-worth evidence', '1–2 days'],
  ['KYC / AML', 'Identity + source of funds', 'Government ID, entity documents', '2–3 days'],
  ['Subscription documents', 'Countersigned by the GP', 'Executed subscription agreement', '3–5 days'],
  ['Limited partnership agreement', 'Delaware LP', 'Executed LPA counterpart', '2–3 days'],
  ['Banking + capital call setup', 'Wire instructions on file', 'Bank details, tax forms (W-9/W-8)', '1–2 days'],
];

const LADDER = [
  ['Invited', 0, 'Review the thesis, key terms and cohort summaries.'],
  ['Approved', 1, 'Full reporting archive and diligence data room.'],
  ['Committed', 2, 'Quarterly reporting package, portfolio updates, demo day.'],
  [`Allocator · $${ALLOC_THRESHOLD_K}K`, 3, 'Allocation preferences, decision rights, follow-on co-invest.'],
];

const ARCHIVE = [
  ['Q2 2026 quarterly report', 'Q2 2026', 'Jul 14, 2026', 'Quarterly'],
  ['Cohort 3 portfolio update', 'Q2 2026', 'Jun 30, 2026', 'Update'],
  ['Annual audited statements 2025', 'FY 2025', 'Mar 28, 2026', 'Audited'],
  ['K-1 tax package 2025', 'FY 2025', 'Mar 12, 2026', 'Tax'],
  ['Reserve policy memo', '—', 'Feb 09, 2026', 'Memo'],
  ['Q1 2026 quarterly report', 'Q1 2026', 'Apr 15, 2026', 'Quarterly'],
];

const ARCHIVE_FILTERS = ['all', 'Quarterly', 'Update', 'Audited', 'Tax', 'Memo'];

/* ------------------------------------------------------------------- page */

export default function SpinoutLabLpWorkspacePage({ embedded = false }) {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';

  const [portal, setPortal] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  // Admin-only preview override. Never consulted for a non-admin, so it cannot
  // be used to self-grant access; see the file header.
  const [preview, setPreview] = useState(null);
  const [archiveFilter, setArchiveFilter] = useState('all');
  // Sliders come from the shared Cohort 4 list (everything the IC has moved
  // past 'Track'), which is the same list the fund brief prints as the current
  // pipeline — so the document can never name a different cohort than the one
  // being allocated across.
  const [alloc, setAlloc] = useState(() =>
    Object.fromEntries(allocationCandidates().map((c) => [c.company, c.allocDefault ?? 0])));
  const [briefBusy, setBriefBusy] = useState(false);
  const [briefErr, setBriefErr] = useState('');

  const load = async () => {
    setLoading(true);
    setErr('');
    try {
      setPortal(await api.fundsLpPortal());
    } catch (e) {
      // A failure must not silently look like "no commitments" — that would
      // read as a downgrade of the viewer's real standing.
      setErr(e?.message || 'Could not load your LP position.');
      setPortal(null);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, []);

  const derived = useMemo(() => lpAccessState(portal), [portal]);
  const state = isAdmin && preview ? preview : derived.state;
  const M = useMemo(() => fundModel(), []);

  const gate = GATE[state] || GATE.visitor;
  const GateIcon = gate.icon;
  const [chipTone, chipText] = PROFILE_CHIP[state] || PROFILE_CHIP.visitor;
  const hasReports = lpHasReports(state);
  const allocOpen = lpAllocationOpen(state);
  const showApply = state === 'visitor';
  const showPending = state === 'pending';

  const commitLabel = derived.commitmentK > 0 ? `$${derived.commitmentK}K` : '—';
  const raisePct = Math.round((FUND.committed / FUND.target) * 100);
  const archive = archiveFilter === 'all' ? ARCHIVE : ARCHIVE.filter((r) => r[3] === archiveFilter);

  const kpis = [
    ['Gross MOIC', M.grossMoic.toFixed(2) + '×', 'Held ÷ invested'],
    ['Capital deployed', money.m(M.investedK), `${M.positions.length} positions`],
    ['Portfolio value', money.m(M.heldK), 'At latest marks'],
    ['Follow-ons', String(M.followOnCount), money.m(M.followOnK) + ' drawn'],
    ['Reserve remaining', `$${M.reserveCloseM}M`, `${Math.round(FUND.reservePolicy * 100)}% policy`],
  ];

  // The eight rows flagged `page`; the brief prints the twelve flagged `brief`
  // off the same list, so neither can be edited without the other following.
  const econ = useMemo(() => fundTerms().filter((t) => t.page), []);

  // The brief is built at click time from the model above plus the viewer's own
  // derived standing — never `state`, which an admin can preview. A previewed
  // state must not be stamped into a document as though it were real.
  const downloadBrief = async () => {
    setBriefBusy(true);
    setBriefErr('');
    try {
      const { exportFundBriefPdf } = await import('../lib/fundBriefPdf');
      await exportFundBriefPdf({
        generatedAt: new Date(),
        recipient: {
          name: user?.name,
          email: user?.email,
          standing: derived.commitmentK > 0
            ? `${PROFILE_CHIP[derived.state]?.[1] || 'Investor'} · $${derived.commitmentK}K committed`
            : PROFILE_CHIP[derived.state]?.[1],
        },
      });
    } catch (e) {
      setBriefErr(e?.message || 'Could not generate the fund brief.');
    } finally {
      setBriefBusy(false);
    }
  };

  const body = (
    <div className="space-y-6">
      {/* confidentiality */}
      <div className="flex items-center gap-2 text-[11px] text-gray-400 dark:text-gray-500">
        <Lock size={12} />
        Confidential — prepared for curated investors only. Contents are indicative and qualified in
        their entirety by the fund&apos;s legal documents.
      </div>

      {err && (
        <div className="flex items-center gap-3 rounded-xl border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/30 px-4 py-3 text-sm text-red-700 dark:text-red-300">
          <AlertCircle size={16} className="flex-none" />
          <span className="flex-1">{err}</span>
          <button type="button" onClick={load} className="inline-flex items-center gap-1.5 rounded-lg border border-red-300 dark:border-red-800 px-2.5 py-1 text-xs font-semibold">
            <RefreshCw size={12} /> Retry
          </button>
        </div>
      )}

      {/* admin preview — inert, admin-only */}
      {isAdmin && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-dashed border-violet-300 dark:border-violet-800 bg-violet-50/50 dark:bg-violet-950/20 px-3 py-2">
          <span className={LBL}>Admin preview</span>
          {[null, ...LP_STATES].map((s) => (
            <button
              key={s || 'live'}
              type="button"
              onClick={() => setPreview(s)}
              className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold ${
                (preview || null) === s
                  ? 'border-violet-600 bg-violet-100 dark:bg-violet-900/50 text-violet-700 dark:text-violet-200'
                  : 'border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400'
              }`}
            >
              {s || `Live (${derived.state})`}
            </button>
          ))}
          <span className="text-[11px] text-gray-500 dark:text-gray-400">
            Preview only — changes nothing and is never applied for non-admins.
          </span>
        </div>
      )}

      {/* gate banner */}
      <div className={`flex flex-wrap items-center gap-4 rounded-2xl border px-5 py-4 ${gate.wrap}`}>
        <div className="flex h-9 w-9 flex-none items-center justify-center rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900">
          <GateIcon size={17} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-bold text-gray-900 dark:text-gray-100">
            {gate.title}
            {state === 'committed' && derived.commitmentK > 0 && ` (${commitLabel})`}
          </div>
          <div className="mt-0.5 text-[12.5px] leading-relaxed text-gray-600 dark:text-gray-400">{gate.body}</div>
        </div>
      </div>

      {/* hero + raise progress */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1.5fr_1fr]">
        <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-[#1e1533] via-[#2d1d52] to-[#3b2470] p-8 text-white">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-green-400/15 px-2.5 py-1 text-[11px] font-bold text-green-300">
              {FUND.status}
            </span>
            <span className="text-xs text-white/60">
              Axal VC Spin-Out Fund I · {FUND.stage} · Vintage {FUND.vintage}
            </span>
          </div>
          <div className="max-w-xl text-2xl font-extrabold leading-tight tracking-tight">
            {THESIS.headline}
          </div>
          <p className="mt-3 max-w-xl text-[13.5px] leading-relaxed text-white/75">{THESIS.hero}</p>
          <div className="mt-5 flex flex-wrap gap-6 border-t border-white/10 pt-4">
            {[
              [String(PROGRAM.graduates), 'Graduates to date'],
              [`${PROGRAM.onTimeIncorpPct}%`, 'Incorporated on time'],
              [money.m(PROGRAM.alumniRaisedM * 1000), 'Raised by alumni'],
            ].map(([v, k]) => (
              <div key={k}>
                <div className={`${MONO} text-[17px] font-bold`}>{v}</div>
                <div className="text-[10.5px] font-semibold uppercase tracking-wider text-white/55">{k}</div>
              </div>
            ))}
          </div>
          <div className="mt-5 flex flex-wrap items-center gap-2.5">
            {/* dark:bg-white is deliberate, not a copy-paste slip: this button
                sits on the always-dark gradient hero, so it stays white in both
                themes. The pairing also satisfies the dark-mode guard. */}
            <Link to="/spinout-lab" className="rounded-lg bg-white dark:bg-white px-4 py-2.5 text-[13px] font-bold text-[#2d1d52]">
              Explore the Spin-Out Lab
            </Link>
            {/* Generates the one-pager from this page's own model at click time,
                so a download always carries what the page is currently showing.
                The old link went to /spinout-lab/brief — the public PROGRAM
                brochure, not a fund brief. */}
            <button
              type="button"
              onClick={downloadBrief}
              disabled={briefBusy}
              data-testid="download-fund-brief"
              className="inline-flex items-center gap-2 rounded-lg border border-white/35 px-4 py-2.5 text-[13px] font-semibold text-white disabled:opacity-60"
            >
              {briefBusy
                ? <Loader2 size={14} className="animate-spin" aria-hidden="true" />
                : <FileDown size={14} aria-hidden="true" />}
              {briefBusy ? 'Preparing…' : 'Fund brief (PDF)'}
            </button>
          </div>
          <p className="mt-2.5 text-[10.5px] leading-relaxed text-white/45">
            {briefErr
              ? briefErr
              : 'One page, generated now — raise status, structure, tiers, track record, Cohort 4 pipeline and the commitment process, as shown on this page.'}
          </p>
        </div>

        <div className={`${CARD} flex flex-col p-6`}>
          <SectionLabel right={<Chip tone="gray">First close {FUND.firstClose}</Chip>}>Raise progress</SectionLabel>
          <div className="flex items-baseline gap-2">
            <div className={`${MONO} text-3xl font-bold tracking-tight text-gray-900 dark:text-gray-100`}>
              {money.m(FUND.committed * 1000)}
            </div>
            <div className="text-[13px] text-gray-500 dark:text-gray-400">of ${FUND.target}M target</div>
          </div>
          <div className="relative mt-3 h-2 overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800">
            <div className="h-full rounded-full bg-violet-600" style={{ width: `${raisePct}%` }} />
          </div>
          <div className="mt-1.5 flex justify-between text-[10.5px] text-gray-400 dark:text-gray-500">
            <span>$0</span><span>${FUND.minCloseM}M minimum close</span><span>${FUND.target}M</span>
          </div>
          <dl className="mt-4 flex flex-1 flex-col gap-2.5 border-t border-gray-100 dark:border-gray-800 pt-4 text-xs">
            {[
              ['Soft-circled', money.m(FUND.softCircled * 1000)],
              ['Accepted LPs', String(FUND.lpCount)],
              ['Median commitment', money.k(FUND.medianTicketK)],
              ['Capacity remaining', `$${M.capacityRemainingM}M`],
            ].map(([k, v]) => (
              <div key={k} className="flex justify-between">
                <dt className="text-gray-500 dark:text-gray-400">{k}</dt>
                <dd className={`${MONO} font-bold text-gray-900 dark:text-gray-100`}>{v}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-3 text-[10.5px] leading-relaxed text-gray-400 dark:text-gray-500">
            Committed = countersigned subscription. Soft-circled amounts are indications, not
            commitments. Fund-level figures are operator-maintained, not live telemetry.
          </p>
        </div>
      </div>

      {/* key terms */}
      <div>
        <SectionLabel>Key terms</SectionLabel>
        <div className={`${CARD} grid grid-cols-1 overflow-hidden sm:grid-cols-2 lg:grid-cols-4`}>
          {econ.map((t) => (
            <div key={t.k} className="border-b border-r border-gray-100 dark:border-gray-800 p-4">
              <div className="text-[10px] font-bold uppercase tracking-wider text-gray-400 dark:text-gray-500">{t.k}</div>
              <div className={`${MONO} mt-1 text-[15px] font-bold text-gray-900 dark:text-gray-100`}>{t.v}</div>
              <div className="mt-0.5 text-[11px] leading-snug text-gray-500 dark:text-gray-400">{t.note}</div>
            </div>
          ))}
        </div>
      </div>

      {/* participation tiers */}
      <div>
        <SectionLabel right={<span className="text-[11.5px] text-gray-400 dark:text-gray-500">Rights scale with commitment · allocation rights begin at ${ALLOC_THRESHOLD_K}K</span>}>
          Participation tiers
        </SectionLabel>
        <div className={`${CARD} overflow-x-auto`}>
          <table className="w-full min-w-[760px] text-left">
            <thead>
              <tr className="border-b border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/50">
                <th className={`px-5 py-3 ${LBL}`}>Rights</th>
                {TIERS.map((t) => (
                  <th key={t.name} className={`px-3 py-3 text-center ${t.hl ? 'bg-violet-50/60 dark:bg-violet-950/20' : ''}`}>
                    <div className="text-[12.5px] font-extrabold text-gray-900 dark:text-gray-100">{t.name}</div>
                    <div className={`${MONO} text-sm font-bold text-violet-700 dark:text-violet-300`}>{t.amount}</div>
                    <div className="text-[10px] font-normal text-gray-400 dark:text-gray-500">{t.sub || ' '}</div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {TIER_RIGHTS.map((r) => (
                <tr key={r.right} className="border-b border-gray-100 dark:border-gray-800">
                  <td className="px-5 py-3">
                    <div className="text-[12.5px] font-semibold text-gray-900 dark:text-gray-100">{r.right}</div>
                    <div className="text-[11px] text-gray-400 dark:text-gray-500">{r.note}</div>
                  </td>
                  {r.c.map((c, i) => (
                    <td key={i} className={`px-3 py-3 text-center text-[13px] text-gray-700 dark:text-gray-300 ${TIERS[i].hl ? 'bg-violet-50/60 dark:bg-violet-950/20' : ''}`}>{c}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* commitment process */}
      <div>
        <SectionLabel>Commitment process</SectionLabel>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-8">
          {PROCESS_STEPS.map(([n, label, note]) => (
            <div key={n} className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-3">
              <div className={`${MONO} text-[8px] font-bold text-violet-300 dark:text-violet-700`}>{n}</div>
              <div className="mt-0.5 text-[11.5px] font-bold leading-tight text-gray-900 dark:text-gray-100">{label}</div>
              <div className="mt-0.5 text-[10px] leading-snug text-gray-400 dark:text-gray-500">{note}</div>
            </div>
          ))}
        </div>
      </div>

      {/* application */}
      {showApply && (
        <div>
          <SectionLabel>Apply to participate</SectionLabel>
          <div className={`${CARD} p-6`}>
            <p className="text-[13px] leading-relaxed text-gray-600 dark:text-gray-400">
              Participation is limited to accredited investors under Rule 501 of Regulation D.
              Applications are reviewed individually within five business days; acceptance is
              selective and capacity-limited. Submitting an application creates no obligation on
              either side.
            </p>
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <Link to="/tickets" className="rounded-lg bg-violet-600 px-4 py-2.5 text-[13px] font-bold text-white">
                Request LP access
              </Link>
              <Link to="/trust" className="rounded-lg border border-gray-200 dark:border-gray-700 px-4 py-2.5 text-[13px] font-semibold text-gray-700 dark:text-gray-300">
                Complete identity verification
              </Link>
            </div>
            <p className="mt-3 text-[11px] leading-relaxed text-gray-400 dark:text-gray-500">
              The self-serve application form from the design is not wired: no LP-application
              endpoint exists yet, so requests route through support rather than posting to an
              endpoint that would silently discard them.
            </p>
          </div>
        </div>
      )}

      {showPending && (
        <div className="flex flex-wrap items-center gap-4 rounded-2xl border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/30 px-6 py-5">
          <Clock size={20} className="flex-none text-amber-600 dark:text-amber-400" />
          <div className="min-w-0 flex-1">
            <div className="text-sm font-bold text-gray-900 dark:text-gray-100">Application under review</div>
            <div className="mt-0.5 text-[12.5px] leading-relaxed text-gray-600 dark:text-gray-400">
              Fund team review typically completes within five business days. On acceptance you
              proceed to KYC/AML and subscription documents.
            </div>
          </div>
        </div>
      )}

      {/* underwriting */}
      <div>
        <SectionLabel right={<span className="text-[11.5px] text-gray-400 dark:text-gray-500">Operator-maintained portfolio model · see lib/spinoutFundModel.js</span>}>
          Underwriting data · portfolio to date
        </SectionLabel>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          {kpis.map(([k, v, note]) => (
            <div key={k} className={`${CARD} p-4`}>
              <div className="text-[10px] font-bold uppercase tracking-wider text-gray-400 dark:text-gray-500">{k}</div>
              <div className={`${MONO} mt-1 text-lg font-bold text-gray-900 dark:text-gray-100`}>{v}</div>
              <div className="mt-0.5 text-[10px] text-gray-400 dark:text-gray-500">{note}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1.6fr_1fr]">
        {/* reporting */}
        <div>
          <SectionLabel>Fund operations &amp; reporting</SectionLabel>
          <div className={`${CARD} p-5`}>
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div className={LBL}>Report archive</div>
              <div className="flex flex-wrap gap-1">
                {ARCHIVE_FILTERS.map((f) => (
                  <button
                    key={f}
                    type="button"
                    onClick={() => setArchiveFilter(f)}
                    className={`rounded-full border px-2.5 py-1 text-[10.5px] font-semibold ${
                      archiveFilter === f
                        ? 'border-violet-600 bg-violet-50 dark:bg-violet-950/40 text-violet-700 dark:text-violet-300'
                        : 'border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400'
                    }`}
                  >
                    {f === 'all' ? 'All' : f}
                  </button>
                ))}
              </div>
            </div>
            <div className="overflow-hidden rounded-xl border border-gray-100 dark:border-gray-800">
              {archive.map(([title, period, issued, type]) => (
                <div key={title} className="grid grid-cols-[1.9fr_.7fr_.8fr_auto] items-center gap-2 border-b border-gray-100 dark:border-gray-800 px-3 py-2.5 last:border-b-0">
                  <div className="min-w-0">
                    <div className={`truncate text-xs font-semibold ${hasReports ? 'text-gray-900 dark:text-gray-100' : 'text-gray-400 dark:text-gray-500'}`}>{title}</div>
                    <div className="text-[10px] text-gray-400 dark:text-gray-500">{type}</div>
                  </div>
                  <div className={`${MONO} text-[11px] text-gray-600 dark:text-gray-400`}>{period}</div>
                  <div className={`${MONO} text-[11px] text-gray-500 dark:text-gray-400`}>{issued}</div>
                  <div>
                    {hasReports ? (
                      <Chip tone="violet">Available</Chip>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-[10.5px] font-semibold text-gray-400 dark:text-gray-500">
                        <Lock size={11} /> Locked
                      </span>
                    )}
                  </div>
                </div>
              ))}
              {archive.length === 0 && (
                <div className="px-3 py-6 text-center text-xs text-gray-400 dark:text-gray-500">No documents of this type.</div>
              )}
            </div>
            {!hasReports && (
              <p className="mt-3 text-[11.5px] text-gray-400 dark:text-gray-500">
                Archive metadata is visible to invited investors; documents unlock after acceptance.
                Committed LPs receive the complete reporting package below.
              </p>
            )}
            <div className="mt-4 rounded-xl border border-violet-200 dark:border-violet-900 bg-violet-50/60 dark:bg-violet-950/20 p-4">
              <div className="mb-2 text-[10px] font-bold uppercase tracking-wider text-violet-700 dark:text-violet-300">
                Committed LPs receive
              </div>
              <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                {REPORT_PKG.map((p) => (
                  <div key={p} className="flex gap-2 text-[11.5px] leading-snug text-gray-600 dark:text-gray-400">
                    <span className="flex-none font-bold text-violet-600 dark:text-violet-400">·</span>
                    <span>{p}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* rights ladder + IR */}
        <div className="flex flex-col gap-5">
          <div>
            <SectionLabel>Participation rights</SectionLabel>
            <div className={`${CARD} p-5`}>
              {LADDER.map(([title, need, desc], i) => {
                const on = (({ visitor: 0, pending: 0, approved: 1, committed: 2, voting: 3 })[state] ?? 0) >= need;
                return (
                  <div key={title} className="flex gap-3 pb-4 last:pb-0">
                    <div className={`flex h-6 w-6 flex-none items-center justify-center rounded-full text-[11px] font-bold ${
                      on ? 'bg-violet-600 text-white' : 'bg-gray-100 dark:bg-gray-800 text-gray-400 dark:text-gray-500'
                    }`}>
                      {on ? <Check size={13} /> : i + 1}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className={`text-[12.5px] font-bold ${on ? 'text-gray-900 dark:text-gray-100' : 'text-gray-400 dark:text-gray-500'}`}>{title}</div>
                      <div className="mt-0.5 text-[11.5px] leading-snug text-gray-500 dark:text-gray-400">{desc}</div>
                    </div>
                  </div>
                );
              })}
              <div className={`mt-1 rounded-xl px-4 py-3 ${TONES[chipTone]}`}>
                <div className="text-[10px] font-bold uppercase tracking-wider opacity-80">Your access</div>
                <div className="text-[12.5px] font-bold">
                  {chipText}
                  {derived.commitmentK > 0 && ` · ${commitLabel} committed`}
                </div>
              </div>
            </div>
          </div>

          <div>
            <SectionLabel>Investor relations</SectionLabel>
            <div className={`${CARD} p-5`}>
              <p className="text-xs leading-relaxed text-gray-600 dark:text-gray-400">
                Questions on terms, capacity, anchor commitments or the diligence data room are
                handled directly by the GP.
              </p>
              <div className="mt-3 flex gap-2">
                <Link to="/tickets" className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-gray-200 dark:border-gray-700 px-3 py-2 text-xs font-semibold text-gray-700 dark:text-gray-300">
                  <MessageSquare size={13} /> Message the GP
                </Link>
                <Link to="/lp-portal" className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-gray-200 dark:border-gray-700 px-3 py-2 text-xs font-semibold text-gray-700 dark:text-gray-300">
                  <FileText size={13} /> My LP Portal
                </Link>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* allocation gate */}
      <div>
        <SectionLabel right={<Chip tone={allocOpen ? 'green' : 'gray'}>{allocOpen ? 'Allocation open' : `Opens at $${ALLOC_THRESHOLD_K}K`}</Chip>}>
          Demo day · allocation preferences
        </SectionLabel>
        {!allocOpen ? (
          <div className={`${CARD} flex flex-col items-center justify-center px-6 py-10 text-center`}>
            <Lock size={24} className="text-gray-400 dark:text-gray-500" />
            <div className="mt-2.5 text-[15px] font-bold text-gray-900 dark:text-gray-100">
              Allocation rights begin at ${ALLOC_THRESHOLD_K}K committed
            </div>
            <div className="mt-1.5 max-w-md text-[12.5px] leading-relaxed text-gray-500 dark:text-gray-400">
              {derived.commitmentK > 0
                ? `You are committed at ${commitLabel}. Increase your commitment to $${ALLOC_THRESHOLD_K}K to express allocation preferences across graduating companies.`
                : 'Commit capital to participate in the allocation window for graduating companies.'}
            </div>
          </div>
        ) : (
          <div className={`${CARD} p-6`}>
            <div className="text-[15px] font-extrabold tracking-tight text-gray-900 dark:text-gray-100">
              Cohort 4 allocation window
            </div>
            <p className="mt-1 text-[12.5px] text-gray-500 dark:text-gray-400">
              Express allocation preferences across graduating companies. Preferences are
              commitment-weighted, pooled across LPs, and settle at close after the fund team
              confirms final terms.
            </p>
            <div className="mt-4 flex items-center gap-2 rounded-lg border border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/50 px-3 py-2.5 text-[11px] text-gray-500 dark:text-gray-400">
              <AlertCircle size={13} className="flex-none" />
              Preferences are a decision input, not an order. Final allocations are set by the fund
              within its reserve policy and confirmed in your closing statement.
            </div>
            <div className="mt-4 flex flex-col gap-3">
              {Object.entries(alloc).map(([name, pct]) => (
                <div key={name} className="rounded-xl border border-gray-200 dark:border-gray-800 p-4">
                  <div className="flex flex-wrap items-center gap-3">
                    <div className="min-w-0 flex-1 text-[13.5px] font-bold text-gray-900 dark:text-gray-100">{name}</div>
                    <input
                      type="range" min="0" max="100" step="5" value={pct}
                      onChange={(e) => setAlloc((a) => ({ ...a, [name]: Number(e.target.value) }))}
                      className="w-56 accent-violet-600"
                      aria-label={`Allocation preference for ${name}`}
                    />
                    <div className={`${MONO} w-24 text-right text-sm font-bold text-gray-900 dark:text-gray-100`}>{pct}%</div>
                  </div>
                </div>
              ))}
            </div>
            <p className="mt-4 text-[11px] leading-relaxed text-gray-400 dark:text-gray-500">
              Preferences are held in this view only — no allocation-submission endpoint exists yet,
              so nothing is transmitted to the fund team. Confirm your intended allocation with the
              GP directly until that lands.
            </p>
          </div>
        )}
      </div>

      {/* onboarding */}
      <div>
        <SectionLabel>Onboarding requirements</SectionLabel>
        <div className={`${CARD} overflow-x-auto`}>
          <table className="w-full min-w-[680px] text-left">
            <thead>
              <tr className="border-b border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/50">
                {['Requirement', 'What we collect', 'Typical time', 'Your status'].map((h) => (
                  <th key={h} className={`px-4 py-3 ${LBL}`}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ONBOARDING.map(([name, note, collect, time], i) => {
                const done = ({ visitor: 0, pending: 1, approved: 2, committed: 5, voting: 5 })[state] ?? 0;
                const status = i < done ? ['green', 'Complete'] : i === done ? ['amber', 'In progress'] : ['gray', 'Not started'];
                return (
                  <tr key={name} className="border-b border-gray-100 dark:border-gray-800 last:border-b-0">
                    <td className="px-4 py-3">
                      <div className="text-[12.5px] font-bold text-gray-900 dark:text-gray-100">{name}</div>
                      <div className="text-[10.5px] text-gray-400 dark:text-gray-500">{note}</div>
                    </td>
                    <td className="px-4 py-3 text-[11px] leading-snug text-gray-600 dark:text-gray-400">{collect}</td>
                    <td className={`${MONO} px-4 py-3 text-[11px] text-gray-500 dark:text-gray-400`}>{time}</td>
                    <td className="px-4 py-3"><Chip tone={status[0]}>{status[1]}</Chip></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="mt-2.5 text-[11px] text-gray-400 dark:text-gray-500">
          No capital moves before subscription documents are countersigned. Verification is handled
          by Parallel Markets; the fund does not store identity documents directly.
        </p>
      </div>

      {/* compliance footer */}
      <div className={`${CARD} grid grid-cols-1 gap-5 p-5 md:grid-cols-3`}>
        {[
          [ShieldCheck, 'Eligibility.', 'Participation is limited to accredited investors. KYC/AML verification is required before any capital transfer; no funds move before countersigned subscription documents.'],
          [Lock, 'Confidentiality.', 'This workspace and its contents are confidential, provided to curated investors only, and may not be redistributed.'],
          [FileText, 'No offer.', 'Nothing here is an offer to sell securities. Any offering is made solely through the fund’s subscription documents and private placement memorandum.'],
        ].map(([Icon, bold, text]) => (
          <div key={bold} className="flex gap-2.5">
            <Icon size={15} className="mt-0.5 flex-none text-gray-400 dark:text-gray-500" />
            <div className="text-[11px] leading-relaxed text-gray-500 dark:text-gray-400">
              <strong className="text-gray-700 dark:text-gray-300">{bold}</strong> {text}
            </div>
          </div>
        ))}
      </div>
    </div>
  );

  if (embedded) {
    return loading ? <LpSkeleton /> : body;
  }
  return (
    <div className="mx-auto max-w-7xl p-6">
      <WorkspaceHeader
        icon={Landmark}
        title="LP &amp; Investor Workspace"
        description="Curated capital participation in Axal VC Spin-Out Fund I — thesis, key terms, underwriting data, reporting, and commitment-gated allocation."
      />
      {loading ? <LpSkeleton /> : body}
    </div>
  );
}

function LpSkeleton() {
  return (
    <div className="space-y-4" data-testid="lp-workspace-loading">
      <div className="h-20 animate-pulse rounded-2xl bg-gray-100 dark:bg-gray-800" />
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1.5fr_1fr]">
        <div className="h-72 animate-pulse rounded-2xl bg-gray-100 dark:bg-gray-800" />
        <div className="h-72 animate-pulse rounded-2xl bg-gray-100 dark:bg-gray-800" />
      </div>
      <div className="h-40 animate-pulse rounded-2xl bg-gray-100 dark:bg-gray-800" />
    </div>
  );
}

// Re-exported so the mount point and any future test can assert the ladder
// without importing the page's React tree.
export { lpAccessState, ALLOC_THRESHOLD_K };
