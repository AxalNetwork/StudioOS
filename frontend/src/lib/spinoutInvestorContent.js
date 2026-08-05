// LP sales narrative for the investor-facing Spin-Out Lab page — the content
// behind pages/SpinoutLabInvestorPage.jsx, ported from the Claude Design
// export `Explore the Spin-Out Lab.dc.html`.
//
// WHY THIS FILE EXISTS (read before adding a number anywhere else)
// ================================================================
// The sales page is dense with claims: program metrics, network counts, cohort
// snapshots, comparison rows. Scattering those through JSX makes them
// impossible to audit and easy to fork from the figures the LP workspace and
// the fund brief state. So:
//
//   - Anything that is ALSO stated by the workspace or the brief is imported
//     from lib/spinoutFundModel.js (FUND, PROGRAM, THESIS) — one source, no
//     drift. The three hero proof tiles literally render PROGRAM.
//   - Everything narrative-only lives HERE, in one auditable place, and is
//     OPERATOR-MAINTAINED: there is no endpoint behind the stack cards, the
//     why-now argument, the edge table, or the cohort snapshots. Where a
//     future endpoint could replace a block, the note on that block says so.
//   - The page overlays live figures from GET /api/spinout-lab/fund-metrics
//     where they exist (same merge the LP workspace performs); these statics
//     are its fallback, never its override.
//
// The cohort snapshot section deserves its own warning: the design presents
// six named live readings ("day 11 of 28", readiness scores, revenue). No
// endpoint reports per-company cohort telemetry to investors, and inventing
// per-company numbers would be exactly the fake-provenance trap the workspace
// header warns about. The snapshots are therefore labelled as an ILLUSTRATIVE
// composite in the section caption (`COHORT_SNAPSHOT.provenance`) — the page
// must render that caption, and the test suite asserts it does.

import { FUND, PROGRAM, THESIS } from './spinoutFundModel';

export { FUND, PROGRAM, THESIS };

/** Hero copy. Headline is THESIS.headline so the sales page, the workspace
 *  hero and the fund brief can never disagree on the one sentence that
 *  matters most. */
export const HERO = {
  eyebrow: `AXAL VC SPIN-OUT LAB FUND I · ${FUND.stage.toUpperCase()} · VINTAGE ${FUND.vintage}`,
  headline: THESIS.headline,
  sub:
    'The Spin-Out Lab is a 28-day company-formation environment. Founders enter with an idea and '
    + 'leave incorporated, 83(b)-filed, cap-table-clean, with verified customer discovery and revenue '
    + 'proof — and Axal VC underwrites them on observed execution, not a pitch.',
};

/** Week-by-week founder journey (design section 01). Mirrors the four real
 *  program weeks in pages/SpinoutLabPage.jsx PIPELINE_PHASES; wording here is
 *  the investor-facing cut (what evidence each week produces). */
export const JOURNEY = [
  {
    wk: 'Week 1', t: 'Validate',
    body: 'Problem definition, ICP, and market sizing — then at least five logged customer interviews with pain severity and willingness-to-pay captured per contact.',
    out: ['≥5 structured interview records', 'Sized TAM/SAM with citations', 'Founder profiling assessment'],
  },
  {
    wk: 'Week 2', t: 'Solution & roadmap',
    body: 'MVP scope, 90-day OKRs, brand and landing pages live, pitch deck v1 drafted. Distribution gets tested, not assumed.',
    out: ['Priced offer with WTP evidence', 'Live landing page + inbound leads', 'Pitch deck v1'],
  },
  {
    wk: 'Week 3', t: 'Validate & team',
    body: 'Venture-readiness scoring against nine weighted dimensions, advisor matching on skill-gap coverage, co-founder decision, and first revenue proof.',
    out: ['Evidence-confidence score', 'Advisor cadence established', 'Revenue proof: Stripe, import, or manual'],
  },
  {
    wk: 'Week 4', t: 'Incorporate & capital',
    body: 'Entity formed, founder stock issued with vesting, 83(b) filed inside the IRS window, co-founder agreement executed, use of funds and data room built.',
    out: ['Delaware C-Corp + EIN', 'Vesting cap table, 83(b) filed', 'Investor-ready data room'],
  },
];

/** Founder operating stack (design section 02). Tool names match the real
 *  Lab tool pages so the claim is checkable against the product. */
export const STACK = [
  { t: 'Company formation', week: 'Week 4', body: 'Entity recommendation by activity and financing path, generated filings, agent setup, EIN, and university IP assignment where relevant.', tools: ['Incorporate', 'Cap Table', '83(b) Tracker', 'Co-founder Agreement', 'Compliance'] },
  { t: 'Customer discovery', week: 'Week 1', body: 'Structured interview capture with pain severity, ICP fit scoring, quote extraction, and inbound lead routing from published pages.', tools: ['Customer Discovery', 'Market Intel', 'Brand & Landing Pages'] },
  { t: 'Product & iteration', week: 'Week 2', body: 'MVP prioritization by added value and effort, OKR locking, and an execution loop that pulls the highest-value scope into the active cycle.', tools: ['Roadmap', 'MVP Priorities', 'Studio Ops'] },
  { t: 'Revenue discipline', week: 'Week 3', body: 'Revenue captured via Stripe sync, document import, or manual entry — each entry carries a verification state, so claimed traction and proven traction stay distinct.', tools: ['Revenue', 'Proof vault', 'Data Room'] },
  { t: 'Investor readiness', week: 'Week 3–4', body: 'Nine-dimension readiness scoring with evidence-confidence bands, weak-point remediation, and a deck assembled from system data rather than written from scratch.', tools: ['Scoring Engine', 'Pitch Deck Builder', 'Capital', 'Use of Funds'] },
  { t: 'Expert & network access', week: 'All weeks', body: 'Matched advisors on skills, values, and archetype complementarity, plus booked sessions with operators, investors, and counsel from the Axal partner network.', tools: ['Advisors', 'Office Hours', 'Co-founder Match', 'Profiling'] },
];

/** Why the model works in an AI-native environment (design section 03).
 *  Each item: the market shift, then `so` — what the Lab does about it. */
export const WHY_NOW = {
  headline: 'AI collapsed the cost of building. It did not collapse the cost of being wrong.',
  sub: 'When anyone can ship a working product in a weekend, a demo stops being evidence. The scarce signal moves from build capability to validation discipline — and that is precisely what an unstructured pre-seed process cannot observe.',
  items: [
    { n: '01', t: 'Build cost fell; noise rose', body: 'A working product is no longer a filter. Cohorts now arrive with functioning software in week one, which means the differentiator has moved upstream to whether anyone will pay.', so: 'We score willingness-to-pay evidence, not product completeness.' },
    { n: '02', t: 'Speed rewards learners, not shippers', body: 'Faster iteration only compounds if each cycle produces a corrected belief. Founders who ship quickly without validating simply reach the wrong answer sooner.', so: 'The 28-day schedule forces a documented learning loop per week.' },
    { n: '03', t: 'Formation errors are still permanent', body: 'AI has not made a broken cap table, a missed 83(b) window, or an unassigned university IP claim any easier to unwind. These kill otherwise fundable companies at seed.', so: 'Formation is a gated workflow with deadline tracking, not founder homework.' },
    { n: '04', t: 'Pitch quality decoupled from company quality', body: 'Generated decks and polished narratives are now free. A strong pitch says less about the underlying business than it did three years ago.', so: 'Every deck slide here is populated from system data with source citations.' },
  ],
};

/** Underwriting-edge comparison table (design section 04). */
export const EDGE = [
  { k: 'What we observe', trad: 'A prepared narrative in a scheduled meeting', lab: '28 days of logged behavior across 19 tools' },
  { k: 'Customer evidence', trad: 'Founder-reported interview counts', lab: 'Structured interview records with quotes and severity' },
  { k: 'Revenue claims', trad: 'A number on a slide', lab: 'Verification state per entry — Stripe-synced, document-backed, or manual' },
  { k: 'Team assessment', trad: 'Résumés and reference calls', lab: 'Skills, values, and archetype profiling with coverage gaps flagged' },
  { k: 'Formation risk', trad: 'Discovered in seed diligence', lab: 'Resolved before graduation, or the company does not graduate' },
  { k: 'Correction speed', trad: 'Not observable pre-investment', lab: 'Week-over-week readiness deltas and weak-point closure rates' },
  { k: 'Access to allocation', trad: 'Competitive round, priced by market', lab: 'Proprietary — first look at graduates before external outreach' },
];

/** Network stat cards under the edge table. Operator-maintained. */
export const NETWORK = [
  { v: '38', t: 'Matched advisors', body: 'Operators, investors, and subject-matter experts assigned on complementarity, holding equity agreements and a tracked cadence.' },
  { v: '6', t: 'Jurisdictions supported', body: 'Delaware and Wyoming live; Singapore, London, Estonia, Dubai and Alberta staged — so a founder’s domicile is a choice, not a constraint.' },
  { v: '19', t: 'Working tools', body: 'One operating environment, so evidence produced in week one is still the same object underwriting the investment in week four.' },
];

/**
 * Studio-throughput proof tiles (design section 05).
 *
 * The first three (graduates / on-time / alumni raised) come from PROGRAM and
 * are overlaid with live values from /api/spinout-lab/fund-metrics when the
 * program block answers `available` — the page handles that merge. The rest
 * are operator-maintained cohort statistics with no live source yet; each
 * `note` states its basis so a reader can interrogate the number.
 */
export const PROOF_STUDIO_STATIC = [
  { key: 'incorporation_rate', k: 'Incorporation rate', v: '92%', tone: 'ink', note: '34 of 37 graduates' },
  { key: 'verified_discovery', k: 'Verified discovery', v: '89%', tone: 'green', note: '≥5 structured interviews logged' },
  { key: 'revenue_proof', k: 'Revenue proof at exit', v: '62%', tone: 'violet', note: 'Stripe-synced or document-backed' },
  { key: 'formation_velocity', k: 'Formation velocity', v: '24 days', tone: 'ink', note: 'Median idea → incorporated' },
  { key: 'graduation_investment', k: 'Graduation → investment', v: '30%', tone: 'violet', note: '11 of 37 graduates backed' },
];

/**
 * Cohort snapshot cards (design section 06) — an ILLUSTRATIVE COMPOSITE.
 *
 * No endpoint reports per-company cohort telemetry to investors, and these six
 * cards must never read as live readings of real companies. `provenance` is
 * the caption the page is REQUIRED to render with the section; the nav test
 * asserts its presence. Sector-level, anonymised, weak signals shown beside
 * strong ones — because showing both is the sales argument.
 */
export const COHORT_SNAPSHOT = {
  headline: 'What the system lets us see — illustrated on a composite cohort.',
  sub: 'Sector-level snapshots in the shape the instrumentation actually produces: readiness score, interview count, verified revenue, and the open risk. The weak signals sit beside the strong ones, because seeing both early is the point.',
  provenance: 'Illustrative composite drawn from patterns across completed cohorts — not live readings of current companies. Approved LPs see the real, named pipeline in the LP workspace.',
  ventures: [
    { sector: 'Workflow automation', meta: 'Solo founder · technical · Week 2', read: 'Strong', tone: 'green', stats: [{ k: 'Readiness', v: '71' }, { k: 'Interviews', v: '18' }, { k: 'Revenue', v: '$12.8K' }], note: 'Pain confirmed in 14 of 18 interviews with a consistent $500–800/mo WTP band. Priced offer published; champion converted to paid pilot.' },
    { sector: 'Sensor analytics', meta: 'Solo founder · Week 3', read: 'Watch', tone: 'amber', stats: [{ k: 'Readiness', v: '62' }, { k: 'Interviews', v: '14' }, { k: 'Revenue', v: '$6.1K' }], note: 'Two paying pilots, but 62% of revenue sits with one customer and discovery has drifted toward friendly segments. Concentration flagged in week 3.' },
    { sector: 'Materials science', meta: 'University spin-out · Week 4', read: 'At risk', tone: 'red', stats: [{ k: 'Readiness', v: '49' }, { k: 'Interviews', v: '9' }, { k: 'Revenue', v: '—' }], note: 'IP assignment unresolved with the tech-transfer office, blocking a clean cap table. Seven of nine interviews are academic peers, not buyers.' },
    { sector: 'Clinical operations', meta: 'Two founders · Week 3', read: 'Solid', tone: 'green', stats: [{ k: 'Readiness', v: '68' }, { k: 'Interviews', v: '16' }, { k: 'Revenue', v: '$3.4K' }], note: 'Complementary founding team with full archetype coverage. Regulated-market pace is slower; pricing evidence is the open dimension.' },
    { sector: 'Data infrastructure', meta: 'Two founders · Week 2', read: 'Strong', tone: 'green', stats: [{ k: 'Readiness', v: '74' }, { k: 'Interviews', v: '21' }, { k: 'Revenue', v: '$9.2K' }], note: 'Highest interview volume in the cohort and the fastest weak-point closure rate. Two design partners signed before week 2 closed.' },
    { sector: 'Cybersecurity', meta: 'Solo founder · technical · Week 2', read: 'Watch', tone: 'amber', stats: [{ k: 'Readiness', v: '58' }, { k: 'Interviews', v: '11' }, { k: 'Revenue', v: '—' }], note: 'Product depth is strong, commercial coverage is absent. Advisor matched on enterprise GTM; the next two weeks determine trajectory.' },
  ],
};

/** The investment case (design section 07). */
export const CASE_ITEMS = [
  { n: '01', t: 'Proprietary access, not a competitive round', body: 'We see graduates before any external outreach and price the first check without an auction. Allocation is a function of program access, not deal-flow luck.' },
  { n: '02', t: 'Selection on evidence, not narrative', body: 'Every investment decision references artifacts the founder produced under observation — interview records, verified revenue, readiness deltas. The base rate of pleasant surprises falls, and so does the base rate of unpleasant ones.' },
  { n: '03', t: 'Repeatable by construction', body: 'A fixed 28-day schedule with fixed deliverables makes cohorts comparable. That is what turns founder support into an underwriting process that improves with each cohort rather than resetting.' },
  { n: '04', t: 'Formation risk priced out before entry', body: 'Companies arrive incorporated, 83(b)-filed, and cap-table-clean. The diligence failures that typically surface at seed are resolved as a graduation condition.' },
  { n: '05', t: 'Reserve discipline against observed winners', body: `A ${FUND.reserveLowPct}–${FUND.reserveHighPct}% reserve is deployed into graduates whose post-program execution data justifies more exposure — follow-on conviction is informed by the same instrumentation, not a board deck.` },
];

/** Closing CTA copy. Figures derive from FUND so they track the workspace. */
export const FINAL_CTA = {
  kicker: `First close · ${FUND.firstClose}`,
  headline: 'This is not pre-seed exposure. It is a formation system with an underwriting record.',
  body: `Access is curated and application-based. Approved LPs see the full pipeline, capital accounts, and quarterly reporting; commitments at $${FUND.allocThresholdK}K carry allocation and decision rights on cohort demo days.`,
};

export const DISCLAIMER =
  'Confidential — prepared for curated investors only. This page is a summary for discussion, does not '
  + 'constitute an offer to sell or a solicitation to buy any security, and is qualified in its entirety '
  + "by the fund's legal documents. Past cohort outcomes are not indicative of future results.";
