/**
 * The owner's copy for the Firm, Platform and Administrators pages (D677,
 * #1551), from the logic script of `design/canvases/integrated/Axal VC
 * Website.dc.html` (`philosophy`, `criteria`, `platformLayers`, `dataFlows`,
 * `adminBlocks`, `adminLicences`, `adminFaq`).
 *
 * The wording is the canvas's. Where the canvas says something the code does
 * not do, the claim is dropped, not reworded, and the drop is listed in
 * `documentation/architecture/decisions/D677.md`. Two counts are read from the
 * code instead of typed, so they cannot drift from it: the scoring engine's
 * dimensions (`DIMENSIONS`) and the deck's slides (`SLIDE_META`).
 * `firm_platform_admin_d677.test.mjs` pins all of it.
 */
import { DIMENSIONS } from './scoringViewModel';
import { SLIDE_META } from './pitchDeckViewModel';
import { numberWordCap } from './numberWords';

/* ------------------------------------------------------------------ FIRM -- */

/**
 * The investment philosophy. Option B on #1551: the canvas's item 04,
 * "Concentration with reserves", carries Fund I's check sizes and reserve
 * share, which wait on the owner, so it is left out whole and the rest are
 * numbered 01–04. Option A would put it back as drawn.
 */
export const PHILOSOPHY = [
  { t: 'Formation is the highest-leverage moment', d: 'Equity, entity, and IP decisions made in month one are close to irreversible. That is where structure pays.' },
  { t: 'Evidence beats conviction', d: 'We fund what a founder has demonstrated, not what they believe. Interviews, revenue, and filings are the record.' },
  { t: 'The founder keeps every decision', d: 'We supply defaults, review, and pressure. We never take operational control or board veto at pre-seed.' },
  { t: 'Access is not the moat — process is', d: 'Anyone can meet founders. Fewer can watch them work for a month before deciding.' },
].map((p, i) => ({ ...p, n: String(i + 1).padStart(2, '0') }));

/** What we look for, in weight order. */
export const CRITERIA = [
  { w: 'Weight 1', t: 'Founder judgement', d: 'How they revise when evidence contradicts them. Visible over 28 days in a way no reference call reveals.' },
  { w: 'Weight 2', t: 'Problem durability', d: 'Would this still matter in ten years if the current technology stack changed entirely?' },
  { w: 'Weight 3', t: 'Evidence of demand', d: 'Logged discovery with severity classification, and ideally paid proof — however small.' },
  { w: 'Weight 4', t: 'Structural cleanliness', d: 'Entity, cap table, 83(b), IP assignment. Not glamorous; frequently fatal when wrong.' },
];

/* -------------------------------------------------------------- PLATFORM -- */

/**
 * The four layers. Every module names a tool that runs today, and `to` is the
 * route that opens it: the Spin-Out Lab's own page for that tool, which is the
 * page the canvas's module copy was drawn from. Those routes are
 * `guard(labRoles(['admin']))` (and `['admin', 'founder']` for Brand), so a
 * visitor signs in first and a cohort admits them.
 *
 * Dropped from the canvas, because the code does not do it:
 *   - Layer 01, "measured rather than claimed": the skills radar is the mean
 *     of the founder's own self-ratings (`SpinoutLabProfilingPage.jsx`).
 *   - Profiling, "blend with confidence bands": one archetype is stored, with
 *     no runner-up or blend, and the per-axis band is evidence coverage.
 *   - Scoring Engine, "Nine … with evidence provenance per score": the engine
 *     has `DIMENSIONS.length` weighted dimensions, and its run integrity is
 *     run provenance, which the page refuses to call evidence.
 *   - Capital, "warm-intro routing, SAFE generation": the Capital tool omits
 *     warm intros, and a SAFE is recorded terms until counsel's text is
 *     registered (D578).
 */
export const PLATFORM_LAYERS = [
  { n: 'Layer 01', t: 'Founder intelligence', d: 'Who the founder is — the input to every match downstream.',
    mods: [
      { t: 'Profiling', d: 'Skills radar, values graph, archetype', to: '/spinout-lab/profiling' },
      { t: 'Scoring Engine', d: `${numberWordCap(DIMENSIONS.length)} weighted dimensions`, to: '/spinout-lab/scoring' },
      { t: 'Startups', d: 'Company record, founding team, and data-room completeness', to: '/spinout-lab/startup' },
    ] },
  { n: 'Layer 02', t: 'Evidence capture', d: 'Everything a founder learns becomes structured, reusable, and citable.',
    mods: [
      { t: 'Customer Discovery', d: 'Interview logs, pain severity, ICP fit, deck-eligible quotes', to: '/spinout-lab/discovery' },
      { t: 'Market Intel', d: 'TAM/SAM/SOM with methodology and competitive positioning', to: '/spinout-lab/market' },
      { t: 'Revenue', d: 'Stripe sync, document import, or manual entry with proof grading', to: '/spinout-lab/revenue' },
    ] },
  { n: 'Layer 03', t: 'Execution systems', d: 'The working surfaces where founders actually build, decide, and ship.',
    mods: [
      { t: 'Roadmap', d: 'MVP prioritisation by added value, effort, and cycle assignment', to: '/spinout-lab/roadmap' },
      { t: 'Brand & Landing Pages', d: 'Audience-specific pages routing inbound leads to the right tool', to: '/spinout-lab/brand' },
      { t: 'Pitch Deck Builder', d: `${numberWordCap(SLIDE_META.length)} slides generated from the founder’s own recorded data`, to: '/spinout-lab/pitch-deck' },
    ] },
  { n: 'Layer 04', t: 'Formation & capital', d: 'The irreversible decisions, with defaults, deadlines, and expert review attached.',
    mods: [
      { t: 'Incorporate', d: 'Entity recommendation with rationale, docs, filing tracker, EIN', to: '/spinout-lab/incorporate' },
      { t: 'Cap Table', d: 'Founder stock, vesting, SAFEs, option pool, dilution simulator', to: '/spinout-lab/captable' },
      { t: 'Capital', d: 'Investor pipeline, data room', to: '/spinout-lab/capital' },
    ] },
];

/**
 * "The data model is the product." Each sentence and each flow is a link the
 * code makes. Dropped, because nothing in the code makes the link:
 *   - "Their cap table drives their 83(b) deadline" and the flow "Cap table
 *     stock issuance → 83(b) filing deadline": the deadline is computed from
 *     the transfer date the founder types on the 83(b) page
 *     (`routes/legal_83b.ts`); the cap table supplies the share count only.
 *   - "Their scoring dimensions select their advisor": the advisor match is
 *     domain overlap, values and skill complement (`routes/advisors.ts`).
 *   - "+ LP report" on the use-of-funds flow: no LP report reads it.
 *   - "Revenue proof grading → Scoring Engine traction dimension": the engine
 *     has no traction dimension and does not read the revenue ledger.
 */
export const COMPOUNDS_COPY = 'A founder’s discovery log becomes their problem slide. Their allocation model writes their use-of-funds. One entry, many consequences.';

export const DATA_FLOWS = [
  { from: 'Customer Discovery interviews', to: 'Pitch deck problem slide' },
  { from: 'Use of Funds allocation', to: 'Use-of-funds slide' },
  { from: 'Profiling skill gaps', to: 'Advisor and co-founder matching' },
];

/* -------------------------------------------------------- ADMINISTRATORS -- */

/**
 * The console's places 02–07; 01 Studio and 08 Settings are drawn on their
 * own. Contracts drops "KYB, and conflicts": the Contracts place lists
 * agreements (e-sign envelopes, signed documents, NDAs, partner deals) and
 * holds no KYB or conflict record.
 */
export const ADMIN_BLOCKS = [
  { n: '02', t: 'Accounts', d: 'Every founder, investor, partner, and advisor account in the territory, in one list.' },
  { n: '03', t: 'Approvals', d: 'Applications, listings, and introductions that wait for a human decision.' },
  { n: '04', t: 'Programs', d: 'Spin-Out Lab cohorts and territory programs, scheduled and tracked.' },
  { n: '05', t: 'Community', d: 'Members, events, and the directory that make up the territory.' },
  { n: '06', t: 'Contracts', d: 'Agreements, each with the record behind it.' },
  { n: '07', t: 'Insights', d: 'What the territory is doing, as recorded in the console.' },
];

/**
 * Settings. The canvas has the territory set "its own mark, colours, and
 * powered-by". The administrator binds the hostname (`DomainWizard`, D449);
 * the mark and colours are captured by Super Admin when the licence is issued
 * (`routes/admin_licences.ts`, D198, the branch-side editor is filed, not
 * built), and no powered-by setting exists. So only the hostname stays.
 */
export const ADMIN_SETTINGS_COPY = 'The territory binds its own hostname. Axal VC does not approve a white-label’s brand.';
export const ADMIN_SETTINGS_CHIPS = ['Hostname'];

/**
 * The two records a white-label publishes, as the Worker asks for them and
 * checks them: `CNAME_TARGET`, `TXT_PREFIX` and `recordsFor` in
 * `cloudflare-worker/src/services/licenceDomain.ts` (D197, D449). The token
 * after `axal-verify=` is minted per licence, so the page names it rather than
 * printing one. The test compares these rows with `recordsFor`.
 */
export const DNS_EXAMPLE_HOST = 'app.yourterritory.com';
export const DNS_RECORDS = [
  { type: 'CNAME', host: DNS_EXAMPLE_HOST, value: 'cname.os.axal.vc' },
  { type: 'TXT', host: `_axal-challenge.${DNS_EXAMPLE_HOST}`, value: 'axal-verify=', token: 'your licence’s token' },
];

export const ADMIN_LICENCES = [
  { t: 'Axal VC subsidiary', rows: [{ k: 'Console', v: 'Same console' }, { k: 'Platform', v: 'Supervised' }, { k: 'Brand', v: 'Axal VC' }] },
  { t: 'White-label', rows: [{ k: 'Console', v: 'Same console' }, { k: 'Platform', v: 'Supervised' }, { k: 'Brand', v: 'Unsupervised: your own' }] },
];

/** Question two drops the mark, colours and powered-by, as Settings does. */
export const ADMIN_FAQ = [
  { q: 'Is a white-label a different product?', a: 'No. It is a kind of licence on the same console. An Axal subsidiary is platform-supervised; a white-label is platform-supervised and brand-unsupervised.' },
  { q: 'Who approves our brand?', a: 'You do. The territory binds its own hostname. Axal does not approve a white-label’s brand.' },
  { q: 'What does a licence cost?', a: 'Licence fee and revenue share are agreed with Axal. Nothing is listed or sold self-serve.' },
  { q: 'Is Super Admin offered here?', a: 'No. Super Admin stays on axal.vc and app.axal.vc.' },
];

/** Where "Request a licence" goes. */
export const LICENCE_REQUEST_PATH = '/contact?topic=licence';
