// Deterministic demo data for the investor deal-pipeline lifecycle pages.
// No backend calls, no Date.now()/Math.random()/zero-arg new Date(). A fixed
// TODAY anchors every derived date so the demo is stable across renders/builds.
const TODAY = new Date('2026-07-11');

function fmt(d) {
  return d.toISOString().slice(0, 10);
}
export function daysAgo(n) {
  const d = new Date(TODAY);
  d.setDate(d.getDate() - n);
  return fmt(d);
}
export function daysFromNow(n) {
  const d = new Date(TODAY);
  d.setDate(d.getDate() + n);
  return fmt(d);
}

export const TODAY_STR = fmt(TODAY);

// ── Stage 1: Screening ─────────────────────────────────────────────────────
const SCORECARD_CRITERIA = ['Market', 'Team', 'Traction', 'Thesis Fit', 'Moat', 'Timing'];

export const SCREENING_DEALS = [
  {
    id: 'scr-001',
    company: 'Helioform',
    sector: 'Climate / Energy',
    stage: 'Seed',
    source: 'Partner referral — a16z',
    dateReceived: daysAgo(3),
    thesisFitScore: 88,
    status: 'advanced',
    scorecard: [
      { criterion: 'Market', weight: 0.2, score: 90 },
      { criterion: 'Team', weight: 0.25, score: 92 },
      { criterion: 'Traction', weight: 0.2, score: 78 },
      { criterion: 'Thesis Fit', weight: 0.15, score: 95 },
      { criterion: 'Moat', weight: 0.1, score: 82 },
      { criterion: 'Timing', weight: 0.1, score: 85 },
    ],
    screeningNotes: [
      { author: 'Priya Nadar', date: daysAgo(2), note: 'Grid-scale thermal storage with a defensible materials IP position. Founder was principal scientist at NREL.' },
      { author: 'Marcus Vane', date: daysAgo(1), note: 'Two LOIs from utilities in hand. Recommend advancing to IC memo.' },
    ],
    flags: ['Strong technical team', 'Regulatory dependency'],
  },
  {
    id: 'scr-002',
    company: 'Ledgerly',
    sector: 'Fintech',
    stage: 'Pre-seed',
    source: 'Inbound — website',
    dateReceived: daysAgo(6),
    thesisFitScore: 61,
    status: 'reviewing',
    scorecard: [
      { criterion: 'Market', weight: 0.2, score: 74 },
      { criterion: 'Team', weight: 0.25, score: 58 },
      { criterion: 'Traction', weight: 0.2, score: 52 },
      { criterion: 'Thesis Fit', weight: 0.15, score: 66 },
      { criterion: 'Moat', weight: 0.1, score: 48 },
      { criterion: 'Timing', weight: 0.1, score: 70 },
    ],
    screeningNotes: [
      { author: 'Priya Nadar', date: daysAgo(4), note: 'Crowded SMB accounting space. Differentiation on real-time reconciliation is interesting but unproven.' },
    ],
    flags: ['Crowded market', 'Solo founder'],
  },
  {
    id: 'scr-003',
    company: 'Nimbus Robotics',
    sector: 'Hardware / Logistics',
    stage: 'Seed',
    source: 'Demo day — YC W26',
    dateReceived: daysAgo(9),
    thesisFitScore: 74,
    status: 'flagged',
    scorecard: [
      { criterion: 'Market', weight: 0.2, score: 80 },
      { criterion: 'Team', weight: 0.25, score: 76 },
      { criterion: 'Traction', weight: 0.2, score: 64 },
      { criterion: 'Thesis Fit', weight: 0.15, score: 70 },
      { criterion: 'Moat', weight: 0.1, score: 72 },
      { criterion: 'Timing', weight: 0.1, score: 88 },
    ],
    screeningNotes: [
      { author: 'Marcus Vane', date: daysAgo(7), note: 'Capital intensity concern — hardware margins and long deployment cycles.' },
      { author: 'Dana Cho', date: daysAgo(5), note: 'Flagged for a follow-up on unit economics before we commit partner time.' },
    ],
    flags: ['Capital intensive', 'Long sales cycle', 'Needs unit-economics review'],
  },
  {
    id: 'scr-004',
    company: 'Verdant Bio',
    sector: 'Biotech',
    stage: 'Seed',
    source: 'Scout — Dr. Ellison',
    dateReceived: daysAgo(12),
    thesisFitScore: 82,
    status: 'reviewing',
    scorecard: [
      { criterion: 'Market', weight: 0.2, score: 84 },
      { criterion: 'Team', weight: 0.25, score: 90 },
      { criterion: 'Traction', weight: 0.2, score: 60 },
      { criterion: 'Thesis Fit', weight: 0.15, score: 78 },
      { criterion: 'Moat', weight: 0.1, score: 94 },
      { criterion: 'Timing', weight: 0.1, score: 80 },
    ],
    screeningNotes: [
      { author: 'Dana Cho', date: daysAgo(10), note: 'Platform play on precision fermentation. Strong patent moat, but pre-revenue with long horizon.' },
    ],
    flags: ['Strong IP moat', 'Pre-revenue'],
  },
  {
    id: 'scr-005',
    company: 'Cadence AI',
    sector: 'AI / Dev Tools',
    stage: 'Seed',
    source: 'Founder network',
    dateReceived: daysAgo(15),
    thesisFitScore: 91,
    status: 'advanced',
    scorecard: [
      { criterion: 'Market', weight: 0.2, score: 88 },
      { criterion: 'Team', weight: 0.25, score: 94 },
      { criterion: 'Traction', weight: 0.2, score: 90 },
      { criterion: 'Thesis Fit', weight: 0.15, score: 96 },
      { criterion: 'Moat', weight: 0.1, score: 78 },
      { criterion: 'Timing', weight: 0.1, score: 92 },
    ],
    screeningNotes: [
      { author: 'Priya Nadar', date: daysAgo(13), note: 'Repeat founders, prior exit to GitHub. $40k MRR growing 22% MoM.' },
      { author: 'Marcus Vane', date: daysAgo(11), note: 'Clear thesis fit. Fast-track to IC.' },
    ],
    flags: ['Repeat founders', 'Fast growth'],
  },
  {
    id: 'scr-006',
    company: 'Portside Freight',
    sector: 'Logistics SaaS',
    stage: 'Pre-seed',
    source: 'Inbound — LinkedIn',
    dateReceived: daysAgo(20),
    thesisFitScore: 44,
    status: 'passed',
    scorecard: [
      { criterion: 'Market', weight: 0.2, score: 58 },
      { criterion: 'Team', weight: 0.25, score: 40 },
      { criterion: 'Traction', weight: 0.2, score: 30 },
      { criterion: 'Thesis Fit', weight: 0.15, score: 46 },
      { criterion: 'Moat', weight: 0.1, score: 38 },
      { criterion: 'Timing', weight: 0.1, score: 52 },
    ],
    screeningNotes: [
      { author: 'Dana Cho', date: daysAgo(18), note: 'Thin team, no differentiated wedge. Passed with a note to revisit if they land an anchor customer.' },
    ],
    flags: ['Passed — weak team'],
  },
  {
    id: 'scr-007',
    company: 'Aperture Health',
    sector: 'Digital Health',
    stage: 'Seed',
    source: 'Partner referral — Bessemer',
    dateReceived: daysAgo(4),
    thesisFitScore: 69,
    status: 'reviewing',
    scorecard: [
      { criterion: 'Market', weight: 0.2, score: 76 },
      { criterion: 'Team', weight: 0.25, score: 72 },
      { criterion: 'Traction', weight: 0.2, score: 58 },
      { criterion: 'Thesis Fit', weight: 0.15, score: 64 },
      { criterion: 'Moat', weight: 0.1, score: 60 },
      { criterion: 'Timing', weight: 0.1, score: 78 },
    ],
    screeningNotes: [
      { author: 'Priya Nadar', date: daysAgo(3), note: 'Reimbursement pathway is the key risk. Need to validate payer conversations.' },
    ],
    flags: ['Reimbursement risk'],
  },
];

// ── Stage 2: Commit (Investment Committee) ─────────────────────────────────
export const COMMIT_DEALS = [
  {
    id: 'cmt-001',
    company: 'Cadence AI',
    sector: 'AI / Dev Tools',
    checkSize: 2500000,
    valuation: 18000000,
    round: 'Seed',
    icMemoStatus: 'final',
    icDate: daysAgo(2),
    votes: [
      { member: 'Priya Nadar', vote: 'yes', note: 'Strongest team we have seen this quarter.' },
      { member: 'Marcus Vane', vote: 'yes', note: 'Thesis-defining. Lead the round.' },
      { member: 'Dana Cho', vote: 'yes', note: 'Comfortable at this valuation.' },
      { member: 'Leo Park', vote: 'abstain', note: 'Recused — angel in a competitor.' },
    ],
    decision: 'approved',
    termSheetStatus: 'signed',
    conditionsToClose: [
      { item: 'Confirm $2.5M allocation with founders', done: true },
      { item: 'Legal review of IP assignment', done: true },
      { item: 'Reference calls with two customers', done: false },
    ],
  },
  {
    id: 'cmt-002',
    company: 'Helioform',
    sector: 'Climate / Energy',
    checkSize: 3000000,
    valuation: 24000000,
    round: 'Seed',
    icMemoStatus: 'in_review',
    icDate: daysFromNow(3),
    votes: [
      { member: 'Priya Nadar', vote: 'yes', note: 'Materials moat is real.' },
      { member: 'Marcus Vane', vote: 'yes', note: 'Utility LOIs de-risk GTM.' },
      { member: 'Dana Cho', vote: 'abstain', note: 'Want the technical DD memo first.' },
    ],
    decision: 'pending',
    termSheetStatus: 'drafting',
    conditionsToClose: [
      { item: 'Third-party technical diligence', done: false },
      { item: 'Confirm utility LOIs are binding', done: false },
      { item: 'Environmental permitting review', done: false },
    ],
  },
  {
    id: 'cmt-003',
    company: 'Verdant Bio',
    sector: 'Biotech',
    checkSize: 1500000,
    valuation: 15000000,
    round: 'Seed',
    icMemoStatus: 'draft',
    icDate: daysFromNow(9),
    votes: [
      { member: 'Dana Cho', vote: 'yes', note: 'Platform optionality is compelling.' },
      { member: 'Priya Nadar', vote: 'no', note: 'Time-to-revenue too long for this fund.' },
      { member: 'Marcus Vane', vote: 'abstain', note: 'On the fence pending scientific advisor input.' },
    ],
    decision: 'pending',
    termSheetStatus: 'none',
    conditionsToClose: [
      { item: 'Scientific advisory review', done: false },
      { item: 'Patent freedom-to-operate opinion', done: false },
    ],
  },
  {
    id: 'cmt-004',
    company: 'Northwind Labs',
    sector: 'Enterprise SaaS',
    checkSize: 2000000,
    valuation: 20000000,
    round: 'Seed',
    icMemoStatus: 'final',
    icDate: daysAgo(11),
    votes: [
      { member: 'Priya Nadar', vote: 'no', note: 'Churn signals in the cohort data.' },
      { member: 'Marcus Vane', vote: 'no', note: 'Valuation ahead of traction.' },
      { member: 'Dana Cho', vote: 'yes', note: 'Liked the founder but agree on price.' },
      { member: 'Leo Park', vote: 'no', note: 'Pass at this round.' },
    ],
    decision: 'declined',
    termSheetStatus: 'none',
    conditionsToClose: [],
  },
  {
    id: 'cmt-005',
    company: 'Fathom Data',
    sector: 'Data Infrastructure',
    checkSize: 1750000,
    valuation: 16500000,
    round: 'Seed',
    icMemoStatus: 'final',
    icDate: daysAgo(5),
    votes: [
      { member: 'Priya Nadar', vote: 'yes', note: 'Clean architecture, strong design partners.' },
      { member: 'Marcus Vane', vote: 'yes', note: 'Approve — negotiate a board seat.' },
      { member: 'Dana Cho', vote: 'yes', note: 'Yes.' },
      { member: 'Leo Park', vote: 'yes', note: 'Yes.' },
    ],
    decision: 'approved',
    termSheetStatus: 'sent',
    conditionsToClose: [
      { item: 'Negotiate board observer seat', done: true },
      { item: 'Finalize pro-rata rights', done: false },
      { item: 'Confirm design-partner contracts', done: true },
    ],
  },
];

// ── Stage 3: Transactions (Closing & Wiring) ───────────────────────────────
export const TRANSACTION_DEALS = [
  {
    id: 'txn-001',
    company: 'Cadence AI',
    amount: 2500000,
    closeDate: daysAgo(1),
    wireStatus: 'confirmed',
    signatureStatus: 'complete',
    closingChecklist: [
      { item: 'Executed SAFE / stock purchase agreement', done: true, owner: 'Legal' },
      { item: 'Countersigned board consent', done: true, owner: 'Founder' },
      { item: 'Wire instructions verified (callback)', done: true, owner: 'Finance' },
      { item: 'KYC / AML on entity', done: true, owner: 'Compliance' },
    ],
    capTableUpdated: true,
    documents: [
      { name: 'Stock Purchase Agreement', status: 'executed' },
      { name: 'Board Consent', status: 'executed' },
      { name: 'Side Letter (pro-rata)', status: 'executed' },
      { name: 'Cap Table (post-close)', status: 'filed' },
    ],
    history: [
      { date: daysAgo(6), event: 'IC approved investment' },
      { date: daysAgo(4), event: 'Term sheet signed' },
      { date: daysAgo(2), event: 'Definitive documents executed' },
      { date: daysAgo(1), event: 'Wire sent and confirmed by escrow' },
    ],
  },
  {
    id: 'txn-002',
    company: 'Fathom Data',
    amount: 1750000,
    closeDate: daysFromNow(4),
    wireStatus: 'pending',
    signatureStatus: 'partial',
    closingChecklist: [
      { item: 'Executed stock purchase agreement', done: true, owner: 'Legal' },
      { item: 'Countersigned board consent', done: false, owner: 'Founder' },
      { item: 'Wire instructions verified (callback)', done: false, owner: 'Finance' },
      { item: 'KYC / AML on entity', done: true, owner: 'Compliance' },
    ],
    capTableUpdated: false,
    documents: [
      { name: 'Stock Purchase Agreement', status: 'executed' },
      { name: 'Board Consent', status: 'pending signature' },
      { name: 'Investor Rights Agreement', status: 'in review' },
    ],
    history: [
      { date: daysAgo(5), event: 'IC approved investment' },
      { date: daysAgo(3), event: 'Term sheet sent to founder' },
      { date: daysAgo(1), event: 'Founder signed term sheet' },
    ],
  },
  {
    id: 'txn-003',
    company: 'Meridian Compute',
    amount: 3200000,
    closeDate: daysAgo(3),
    wireStatus: 'sent',
    signatureStatus: 'complete',
    closingChecklist: [
      { item: 'Executed stock purchase agreement', done: true, owner: 'Legal' },
      { item: 'Countersigned board consent', done: true, owner: 'Founder' },
      { item: 'Wire instructions verified (callback)', done: true, owner: 'Finance' },
      { item: 'KYC / AML on entity', done: true, owner: 'Compliance' },
      { item: 'Escrow confirmation receipt', done: false, owner: 'Finance' },
    ],
    capTableUpdated: false,
    documents: [
      { name: 'Stock Purchase Agreement', status: 'executed' },
      { name: 'Board Consent', status: 'executed' },
      { name: 'Investor Rights Agreement', status: 'executed' },
    ],
    history: [
      { date: daysAgo(14), event: 'IC approved investment' },
      { date: daysAgo(9), event: 'Term sheet signed' },
      { date: daysAgo(5), event: 'Definitive documents executed' },
      { date: daysAgo(3), event: 'Wire initiated — awaiting confirmation' },
    ],
  },
  {
    id: 'txn-004',
    company: 'Solace Security',
    amount: 1200000,
    closeDate: daysAgo(20),
    wireStatus: 'confirmed',
    signatureStatus: 'complete',
    closingChecklist: [
      { item: 'Executed SAFE', done: true, owner: 'Legal' },
      { item: 'Board consent', done: true, owner: 'Founder' },
      { item: 'Wire instructions verified', done: true, owner: 'Finance' },
      { item: 'Cap table update filed', done: true, owner: 'Ops' },
    ],
    capTableUpdated: true,
    documents: [
      { name: 'SAFE Agreement', status: 'executed' },
      { name: 'Board Consent', status: 'executed' },
      { name: 'Cap Table (post-close)', status: 'filed' },
    ],
    history: [
      { date: daysAgo(30), event: 'IC approved investment' },
      { date: daysAgo(26), event: 'Term sheet signed' },
      { date: daysAgo(22), event: 'Documents executed' },
      { date: daysAgo(20), event: 'Wire confirmed — position live' },
    ],
  },
];
