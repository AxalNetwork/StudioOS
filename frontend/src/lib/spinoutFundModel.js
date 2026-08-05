// Shared fund model for Axal VC Spin-Out Fund I — port of the Claude Design
// `fund-model.js` that both `LP Investor Workspace.dc.html` and
// `Quarterly Report.dc.html` read, so positions, deployment, MOIC, follow-ons
// and reserve cannot drift between surfaces.
//
// WHAT THESE NUMBERS ARE — read before using them anywhere else.
// ==============================================================
// These are OPERATOR-MAINTAINED fund facts, not live telemetry. There is no
// fundraising API behind them: the worker exposes `/api/funds/lp-portal` (a
// viewer's OWN commitments, calls and distributions) but nothing that reports
// fund-level raise progress, cohort pipeline or portfolio marks. Until such an
// endpoint exists this module IS the source of truth, and changing a figure
// means editing it here.
//
// Because of that, the LP workspace deliberately does NOT repeat the design's
// "Live program telemetry · updated daily" caption over these values — it would
// be a false claim about provenance. Anything describing the VIEWER's own
// position comes from the real endpoint instead; see lpAccessState() below.

// `initial` is the stored first check. `invested` is ALWAYS initial + follow-on,
// derived below, so an implausible initial cannot arise silently.
const POSITIONS = [
  { company: 'NovaCraft AI', sector: 'Workflow automation', cohort: 'C3', initial: 150, held: 225, status: 'Outperforming' },
  { company: 'MeridianIQ', sector: 'Deal intelligence', cohort: 'C3', initial: 150, held: 210, status: 'Outperforming' },
  { company: 'LoopSense', sector: 'Sensor analytics', cohort: 'C3', initial: 125, held: 150, status: 'On plan' },
  { company: 'Foundry Legal', sector: 'Contract operations', cohort: 'C3', initial: 100, held: 110, status: 'On plan' },
  { company: 'Arcline', sector: 'Financial infrastructure', cohort: 'C2', initial: 150, held: 325, status: 'Outperforming', followOn: 100 },
  { company: 'Kelp Bio', sector: 'Materials science', cohort: 'C2', initial: 150, held: 150, status: 'Monitor' },
  { company: 'Verity Health', sector: 'Clinical operations', cohort: 'C2', initial: 150, held: 195, status: 'On plan' },
  { company: 'Northwind Data', sector: 'Data infrastructure', cohort: 'C2', initial: 200, held: 240, status: 'On plan' },
  { company: 'Cadence Robotics', sector: 'Robotics', cohort: 'C1', initial: 135, held: 400, status: 'Outperforming', followOn: 115 },
  { company: 'Solvent Climate', sector: 'Climate tech', cohort: 'C1', initial: 200, held: 200, status: 'Monitor' },
  { company: 'Halyard Security', sector: 'Cybersecurity', cohort: 'C1', initial: 175, held: 195, status: 'Early' },
];

export const FUND = {
  target: 20,
  hardCap: 25,
  committed: 6.8,
  called: 2.4,
  softCircled: 1.4,
  lpCount: 31,
  minTicketK: 50,
  allocThresholdK: 250,
  medianTicketK: 150,
  reservePolicy: 0.40, // ceiling on commitments; follow-ons are the only draw
  firstClose: 'Sep 15, 2026',
  minCloseM: 5,
  demoDay: 'Aug 21, 2026',
  // The fields below feed the workspace hero and "Key terms" grid, and the fund
  // brief's masthead and "Fund structure" block (through fundTerms()), so a
  // change here reaches every surface and every brief downloaded afterwards.
  status: 'Open · raising toward first close',
  stage: 'Pre-seed',
  vintage: 2026,
  domicile: 'Delaware LP',
  termYears: 10,
  checkLowK: 100,
  checkHighK: 150,
  convictionCheckK: 250,
  portfolioLow: 25,
  portfolioHigh: 40,
  reserveLowPct: 30,
  reserveHighPct: 40, // must equal reservePolicy × 100 — asserted in the tests
  mgmtFeePct: 2,
  carryPct: 20,
  auditDate: 'Mar 31',
  k1Date: 'Mar 15',
};

/** Commitment (in $K) at or above which allocation + decision rights open. */
export const ALLOC_THRESHOLD_K = FUND.allocThresholdK;

/**
 * Program-level track record shown in the workspace hero and repeated on the
 * fund brief.
 *
 * NOTE ON A PRE-EXISTING CONFLICT: pages/SpinoutLabBriefPage.jsx (the public
 * *program* brochure, a different document) states "12 companies built to date"
 * and "$2.4M total capital raised by graduates". Those numbers disagree with
 * these and predate this module. The LP workspace is the stated authority for
 * the fund brief, so the brief follows these; reconciling the brochure is a
 * separate decision for whoever owns that page.
 */
export const PROGRAM = {
  graduates: 37,
  onTimeIncorpPct: 86,
  alumniRaisedM: 8.6,
};

/** Narrative copy. Shared so the hero and the brief cannot say different things. */
export const THESIS = {
  headline: 'Back companies at the moment they become companies.',
  hero:
    'The fund invests exclusively in Spin-Out Lab graduates — incorporated, 83(b)-filed, '
    + 'cap-table-clean companies with verified customer discovery and revenue proof. Every '
    + 'investment is underwritten by 28 days of observed execution data, not a pitch.',
  brief:
    'Back companies at the moment they become companies. The fund invests exclusively in '
    + 'Spin-Out Lab graduates — incorporated, 83(b)-filed, cap-table-clean, with verified '
    + 'customer discovery and revenue proof.',
  body:
    'Every investment is underwritten by 28 days of observed execution data, not a pitch. The '
    + 'Spin-Out Lab runs founders through structured customer discovery, incorporation, '
    + 'cap-table formation, and first revenue — producing a verified evidence base before any '
    + 'check is written. The fund sees the work, not the narrative.',
};

/**
 * Fund terms, in one list, derived from FUND.
 *
 * `page` marks the eight rows the workspace "Key terms" grid shows (with their
 * notes); `brief` marks the twelve the one-pager's "Fund structure" block shows.
 * Target/hard cap is page-only because the brief already carries it in the raise
 * strip and would otherwise state it twice.
 */
export function fundTerms() {
  const k = (n) => `$${n}K`;
  return [
    { k: 'Target / hard cap', v: `$${FUND.target}M / $${FUND.hardCap}M`, note: `${FUND.domicile} · ${FUND.termYears}-yr term`, page: true },
    { k: 'Stage', v: FUND.stage, note: 'Lab graduates only', page: true, brief: true },
    { k: 'Sourcing', v: 'Lab graduates only', brief: true },
    { k: 'Portfolio', v: `${FUND.portfolioLow}–${FUND.portfolioHigh} companies`, note: 'Across cohorts', page: true, brief: true },
    { k: 'Initial check', v: `$${FUND.checkLowK}–${FUND.checkHighK}K`, note: `Up to ${k(FUND.convictionCheckK)} high conviction`, page: true, brief: true },
    { k: 'High conviction', v: `up to ${k(FUND.convictionCheckK)}`, brief: true },
    { k: 'Reserve policy', v: `${FUND.reserveLowPct}–${FUND.reserveHighPct}%`, note: 'Follow-ons only', page: true, brief: true },
    { k: 'Minimum ticket', v: k(FUND.minTicketK), note: `Allocation rights from ${k(FUND.allocThresholdK)}`, page: true, brief: true },
    { k: 'Allocation rights', v: `from ${k(FUND.allocThresholdK)}`, brief: true },
    { k: 'Management fee', v: `${FUND.mgmtFeePct}%`, note: `Carried interest ${FUND.carryPct}%`, page: true, brief: true },
    { k: 'Carried interest', v: `${FUND.carryPct}%`, brief: true },
    { k: 'Reporting', v: 'Quarterly', note: `Annual audit · ${FUND.auditDate}`, page: true, brief: true },
    { k: 'Audit', v: `Annual · ${FUND.auditDate}`, brief: true },
  ];
}

/** Participation tiers. `rights` is the brief's prose form of the matrix below. */
export const TIERS = [
  { name: 'Supporter', amountK: 50, amount: '$50K', sub: 'Minimum ticket',
    rights: 'Quarterly reports, audited statement, cohort dashboard, demo-day livestream.' },
  { name: 'Member', amountK: 100, amount: '$100K', sub: '',
    rights: 'Adds in-person demo day, portfolio deep-dives, founder introductions.' },
  { name: 'Allocator', amountK: 250, amount: '$250K', sub: 'Allocation rights', hl: true,
    rights: 'Adds commitment-weighted allocation preferences, voting, follow-on co-invest.' },
  { name: 'Anchor', amountK: 500, amount: '$500K+', sub: 'By discussion',
    rights: 'Adds co-invest priority and LPAC seat eligibility. Terms by discussion.' },
];

/** The rights matrix. One cell per tier, in TIERS order. */
export const TIER_RIGHTS = [
  { right: 'Quarterly reports', note: 'Audited statement + portfolio marks', c: ['✓', '✓', '✓', '✓'] },
  { right: 'Cohort dashboard', note: 'Live readiness + revenue telemetry', c: ['✓', '✓', '✓', '✓'] },
  { right: 'Demo day', note: 'Livestream at Supporter; in person above', c: ['Stream', 'In person', 'In person', 'In person'] },
  { right: 'Portfolio deep-dives', note: 'Company-level diligence sessions', c: ['—', '✓', '✓', '✓'] },
  { right: 'Allocation preferences', note: `Commitment-weighted, from $${FUND.allocThresholdK}K`, c: ['—', '—', '✓', '✓'] },
  { right: 'Follow-on co-invest', note: 'Priority at Anchor', c: ['—', '—', '✓', 'Priority'] },
  { right: 'LPAC seat eligibility', note: 'Three seats at first close', c: ['—', '—', '—', '✓'] },
];

/** Commitment process, invitation through funding. */
export const PROCESS_STEPS = [
  ['01', 'Invited', 'Curated introduction'],
  ['02', 'Applied', 'Type, size, preferences'],
  ['03', 'Under review', 'Within 5 business days'],
  ['04', 'Accepted', 'Capacity-limited'],
  ['05', 'KYC / AML', 'Parallel Markets'],
  ['06', 'Soft commit', 'Indication of size'],
  ['07', 'Legal docs', 'Subscription + LPA'],
  ['08', 'Funded', 'Capital call schedule'],
];

/**
 * Cohort 4 — the companies graduating into the current allocation window.
 * Operator-maintained like the rest of this module: `score` is the readiness
 * score at last review and `revenueK` the observed first revenue in $K.
 *
 * This list feeds BOTH the brief's pipeline table and the workspace's
 * allocation sliders (see allocationCandidates), so the document can never name
 * a different cohort than the one an LP is allocating across.
 */
export const COHORT_4 = [
  { company: 'NovaCraft AI', sector: 'Async workflow automation', score: 71, revenueK: 12.8, ic: 'Advance', allocDefault: 30 },
  { company: 'MeridianIQ', sector: 'Deal intelligence', score: 68, revenueK: 9.2, ic: 'Advance', allocDefault: 25 },
  { company: 'LoopSense', sector: 'Sensor analytics', score: 62, revenueK: 6.1, ic: 'Watch', allocDefault: 20 },
  { company: 'Foundry Legal', sector: 'Contract operations', score: 59, revenueK: 4.9, ic: 'Watch', allocDefault: 10 },
  { company: 'Arcline', sector: 'Financial infrastructure', score: 49, revenueK: 5.4, ic: 'Track' },
  { company: 'Kelp Bio', sector: 'Materials science', score: 51, revenueK: null, ic: 'Track' },
];

/**
 * The subset of Cohort 4 open to allocation preferences: everything the IC has
 * moved past 'Track'. Returns fresh objects so a caller's slider state cannot
 * mutate the shared list.
 */
export function allocationCandidates() {
  return COHORT_4.filter((c) => c.ic !== 'Track').map((c) => ({ ...c }));
}

/**
 * Governance and service providers named on the fund brief.
 *
 * ⚠ THESE CAME FROM THE DESIGN MOCK AND NAME REAL THIRD-PARTY FIRMS. The brief
 * is a distributable document, so an unedited value here asserts a commercial
 * relationship that may not exist ('Ashurst Perkins Coie' is visibly two
 * separate real firms merged by the mock). Confirm each line with the GP before
 * the brief is circulated.
 */
export const SERVICE_PROVIDERS = [
  { k: 'Fund administrator', v: 'Carta Fund Admin' },
  { k: 'Legal counsel', v: 'Ashurst Perkins Coie' },
  { k: 'Auditor', v: 'Deloitte LLP' },
  { k: 'Custody / banking', v: 'Mercury · First Republic' },
  { k: 'Governance', v: 'LPAC · 3 seats at first close' },
  { k: 'Tax documents', v: `K-1 issued by ${FUND.k1Date}` },
];

const r2 = (n) => Math.round(n * 100) / 100;

// All amounts in $K unless the name ends in M.
export function fundModel() {
  const positions = POSITIONS.map((p) => ({ ...p, invested: p.initial + (p.followOn || 0) }));
  const sum = (f) => positions.reduce((a, p) => a + (f(p) || 0), 0);
  const investedK = sum((p) => p.invested);
  const heldK = sum((p) => p.held);
  const followOnK = sum((p) => p.followOn);
  const reserveOpenM = r2(FUND.committed * FUND.reservePolicy);
  const reserveDrawM = r2(followOnK / 1000);
  return {
    ok: true,
    positions,
    fund: FUND,
    investedK,
    heldK,
    followOnK,
    followOnCount: positions.filter((p) => p.followOn).length,
    grossMoic: heldK / investedK,
    capacityRemainingM: r2(FUND.target - FUND.committed),
    reserveOpenM,
    reserveDrawM,
    reserveCloseM: r2(reserveOpenM - reserveDrawM),
    byCohort: (code, field) =>
      positions.filter((p) => p.cohort === code).reduce((a, p) => a + (p[field] || 0), 0),
  };
}

export const money = {
  m: (k) => '$' + (k / 1000).toFixed(2).replace(/0$/, '') + 'M',
  m2: (k) => '$' + (k / 1000).toFixed(2) + 'M',
  k: (k) => '$' + k + 'K',
  usd: (k) => '$' + Math.round(k * 1000).toLocaleString('en-US'),
};

// ---------------------------------------------------------------------------
// LP ACCESS STATE — the security-relevant part of this module.
//
// The Claude Design export drives every gate off `st.access`, a component-state
// string flipped by a row of buttons (`onClick={() => this.set('access', s.k)}`).
// That is the right way to demo five states in a design file and exactly the
// wrong way to ship one: the same control that previews "Committed LP · $250K ·
// full rights" would ALSO unlock the LP data room, the reporting package and the
// allocation sliders for any logged-in viewer who clicked it.
//
// So the shipped state is DERIVED, never chosen. It reads the caller's own rows
// from GET /api/funds/lp-portal — the canonical limited_partners store — and is
// a pure function of them so it can be checked without a browser.
//
// Ladder (mirrors the design's tierRank):
//   visitor   — no LP row at all: browsing by invitation
//   pending   — an LP row exists but no countersigned LPA: under review
//   approved  — LPA countersigned, nothing committed yet
//   committed — commitment > 0 but under the allocation threshold
//   voting    — commitment >= $250K: allocation + decision rights
// ---------------------------------------------------------------------------

export const LP_STATES = ['visitor', 'pending', 'approved', 'committed', 'voting'];

/** Rank used for "does this state unlock X" comparisons. Mirrors the design. */
export const LP_STATE_RANK = { visitor: 0, pending: 0, approved: 1, committed: 2, voting: 3 };

/**
 * Derive the LP access state from a GET /api/funds/lp-portal payload.
 *
 * Deliberately conservative: anything it cannot positively establish degrades
 * DOWN the ladder, never up. A malformed payload yields 'visitor', which shows
 * the public thesis and nothing gated.
 *
 * @param {object|null} portal  the raw DTO: { lp_holdings, performance, ... }
 * @returns {{ state: string, commitmentK: number, lpaSigned: boolean, holdings: number }}
 */
export function lpAccessState(portal) {
  const rows = Array.isArray(portal?.performance) ? portal.performance : [];
  const holdings = Array.isArray(portal?.lp_holdings) ? portal.lp_holdings.length : rows.length;

  if (!holdings) return { state: 'visitor', commitmentK: 0, lpaSigned: false, holdings: 0 };

  // `commitment` is dollars in the worker DTO (funds.ts:61); the design's whole
  // threshold vocabulary is $K, so convert once here rather than at each site.
  const commitmentDollars = rows.reduce((sum, r) => {
    const n = Number(r?.commitment);
    return sum + (Number.isFinite(n) && n > 0 ? n : 0);
  }, 0);
  // Compare in DOLLARS and floor only for display. Rounding first would let
  // $249,999 become 250 and clear a $250K rights threshold it does not meet —
  // a display concern silently granting allocation and decision rights.
  const commitmentK = Math.floor(commitmentDollars / 1000);
  const lpaSigned = rows.some((r) => !!r?.lpa_signed);

  let state;
  if (commitmentDollars >= ALLOC_THRESHOLD_K * 1000) state = 'voting';
  else if (commitmentDollars > 0) state = 'committed';
  else if (lpaSigned) state = 'approved';
  else state = 'pending';

  return { state, commitmentK, lpaSigned, holdings };
}

/** Full reporting archive + package unlock. Mirrors the design's `hasReports`. */
export function lpHasReports(state) {
  return LP_STATE_RANK[state] >= LP_STATE_RANK.approved;
}

/** Allocation + decision rights. Mirrors the design's `allocOpen`. */
export function lpAllocationOpen(state) {
  return state === 'voting';
}
