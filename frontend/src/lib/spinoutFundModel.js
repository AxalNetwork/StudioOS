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
};

/** Commitment (in $K) at or above which allocation + decision rights open. */
export const ALLOC_THRESHOLD_K = FUND.allocThresholdK;

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
