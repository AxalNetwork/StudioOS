import React from 'react';
import { Lock, Clock, Check, ShieldCheck } from 'lucide-react';
import { FUND, ALLOC_THRESHOLD_K } from '../../../lib/spinoutFundModel';
import { formatCents } from '../fundCallsModel';

export const CARD =
  'rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900';

export const LBL =
  'text-[11px] font-bold uppercase tracking-[0.08em] text-gray-400 dark:text-gray-500';

export const MONO = 'font-mono tabular-nums';

export const TONES = {
  violet: 'bg-violet-50 dark:bg-violet-950/40 text-violet-700 dark:text-violet-300',
  amber: 'bg-amber-100 dark:bg-amber-950/40 text-amber-800 dark:text-amber-300',
  green: 'bg-green-100 dark:bg-green-950/40 text-green-700 dark:text-green-300',
  gray: 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300',
};

export function Chip({ tone = 'gray', children }) {
  return (
    <span className={`inline-flex flex-none items-center rounded-full px-2.5 py-0.5 text-[10.5px] font-bold ${TONES[tone] || TONES.gray}`}>
      {children}
    </span>
  );
}

export function SectionLabel({ children, right }) {
  return (
    <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
      <div className={LBL}>{children}</div>
      {right}
    </div>
  );
}

export const GATE = {
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
    body: 'Approved LPs can review full reporting. Commit capital to receive the quarterly reporting package.',
    wrap: 'border-violet-200 dark:border-violet-900 bg-violet-50 dark:bg-violet-950/30',
  },
  committed: {
    tone: 'violet', icon: Check, title: 'You are a committed LP.',
    body: 'You receive the full reporting package, portfolio updates and demo-day observer access.',
    wrap: 'border-violet-200 dark:border-violet-900 bg-violet-50 dark:bg-violet-950/30',
  },
  voting: {
    tone: 'green', icon: ShieldCheck, title: 'You are a committed LP.',
    body: `You receive the full reporting package, portfolio updates and demo-day observer access. Scheduled demo day: ${FUND.demoDay}.`,
    wrap: 'border-green-200 dark:border-green-900 bg-green-50 dark:bg-green-950/30',
  },
};

// D9006 (#9006): the standing chip's words are the canvas's (Axal VC Fund v2
// and LP Workspace, STAND). The canvas's "applicant" is lpAccessState()'s
// 'pending' and its "full" is 'voting'. The tones are unchanged.
export const PROFILE_CHIP = {
  visitor: ['gray', 'Visitor · viewing by invitation'],
  pending: ['amber', 'Applicant · application in review'],
  approved: ['violet', 'Approved · nothing committed yet'],
  committed: ['violet', 'Committed LP'],
  voting: ['green', 'Full rights'],
};

/** The standings whose chip carries the commitment, as the canvas draws them. */
const SHOWS_AMOUNT = new Set(['committed', 'voting']);

/**
 * The standing in words, as the chip and the fund brief print it: the canvas
 * words, then the commitment from the record for a committed standing
 * ("Committed LP · $150,000.00"). No commitment recorded prints no amount,
 * never $0.
 */
export function standingWords(state, commitmentCents) {
  const words = (PROFILE_CHIP[state] || PROFILE_CHIP.visitor)[1];
  const amount = SHOWS_AMOUNT.has(state) && Number(commitmentCents) > 0 ? formatCents(commitmentCents) : null;
  return amount ? `${words} · ${amount}` : words;
}

export const REPORT_PKG = [
  'Quarterly portfolio report with company-level marks',
  'Audited annual financial statements',
  'K-1 tax documents issued by March 15',
  'Capital account statement each quarter',
  'Cohort telemetry dashboard access',
  'Demo-day observer access',
];

export const ONBOARDING = [
  ['Accredited status', 'Rule 501 self-certification', 'Verification letter or income/net-worth evidence', '1–2 days'],
  ['KYC / AML', 'Identity + source of funds', 'Government ID, entity documents', '2–3 days'],
  ['Subscription documents', 'Countersigned by the GP', 'Executed subscription agreement', '3–5 days'],
  ['Limited partnership agreement', 'Delaware LP', 'Executed LPA counterpart', '2–3 days'],
  ['Banking + capital call setup', 'Wire instructions on file', 'Bank details, tax forms (W-9/W-8)', '1–2 days'],
];

export const LADDER = [
  ['Invited', 0, 'Review the thesis, key terms and cohort summaries.'],
  ['Approved', 1, 'Full reporting archive and diligence data room.'],
  ['Committed', 2, 'Quarterly reporting package, portfolio updates, demo day.'],
  [`Participation · $${ALLOC_THRESHOLD_K}K`, 3, 'Decision rights.'],
];

export const EXTERNAL_DOCS = [
  {
    key: 'audited',
    title: `Annual audited financial statements`,
    period: 'Annual',
    type: 'Audited',
    from: 'Issued by the fund auditor',
  },
  {
    key: 'k1',
    title: 'Schedule K-1 tax package',
    period: 'Annual',
    type: 'Tax',
    from: 'Issued by the fund administrator',
  },
];
