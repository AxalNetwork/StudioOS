/**
 * The Programme Brief's CONTENT — the programme describing itself (D141).
 *
 * WHY THIS IS A MODULE AND NOT A TABLE. The brief's design carries 76 bindings,
 * and exactly six of them are values the platform measures: the cohort's name,
 * its start, when applications close, how many places it has, the year and the
 * time the brief was generated. Those six come from
 * `GET /api/spinout-lab/brief`. **Everything in this file is the other
 * seventy** — the weeks, the gates, the jurisdictions, the deliverables, the
 * terms — and none of it is a measurement of anything. It is the programme's
 * own description: prose somebody wrote, changed by editing it, reviewed in a
 * diff.
 *
 * Giving it a D1 table would be a store invented so a page could look dynamic,
 * holding values nobody measures and nobody edits — the seat store D129 deleted
 * and the adjustable dates D140 deleted, a third time. The canvas says the same
 * thing in its own header: *"Live values stay as fields — a generated PDF fills
 * them from the platform, never from this file."*
 *
 * WHAT IS DELIBERATELY NOT HERE. The three tracks, the five groups and the
 * nineteen tools. Those already live in `spinoutLabArsenal.js`, which the Lab
 * pages read, and the brief reads the same export — because a brief that
 * described a different set of tools from the product would be worse than no
 * brief. `leadsWith` is not stored either: `leadsWithFor()` already derives it
 * from each track's tool ids, so it cannot drift from the cards.
 */

/** The four week windows. Derived from the month, which is why no route sets them. */
export const WEEKS = [
  { n: '1', days: 'Days 1–7' },
  { n: '2', days: 'Days 8–14' },
  { n: '3', days: 'Days 15–21' },
  { n: '4', days: 'Days 22–28' },
];

/**
 * The four gates, per track, keyed by the id `LAB_TRACKS` uses.
 *
 * Every track passes the same four gates and each gate opens on evidence rather
 * than attendance; what FILLS a week is the track's. A Form founder's formation
 * week is a Find-fit founder's interview week, which is the whole reason this is
 * keyed by track rather than being one shared list.
 */
export const TRACK_GATES = {
  form: [
    { name: 'Validate', items: ['Problem and buyer defined', '≥5 interviews logged', 'Founder profile complete'], gate: 'discovery evidence reviewed' },
    { name: 'Structure', items: ['Co-founder decision or solo declaration', 'Equity split and vesting drafted', 'Jurisdiction chosen'], gate: 'a cap table that holds' },
    { name: 'Form', items: ['Entity filed', '83(b) window opened and counted', 'Co-founder agreement signed'], gate: 'entity, equity, filing complete' },
    { name: 'Fund', items: ['Deck from recorded data', 'Use of funds locked', 'Three warm introductions'], gate: 'a raise the record supports' },
  ],
  fit: [
    { name: 'Interview', items: ['ICP hypothesis written down', '≥5 interviews logged with severity', 'Pain map ranked'], gate: 'a pain someone will pay to remove' },
    { name: 'Size', items: ['TAM/SAM with citations', 'Competitive map', 'Venture score, nine dimensions'], gate: 'a market the score can defend' },
    { name: 'Prove', items: ['Pricing tested', 'Revenue proof by source', 'Two advisors matched to the weak dimensions'], gate: 'paid evidence, however small' },
    { name: 'Fund', items: ['Deck rebuilt on the evidence', 'Use of funds locked', 'Three warm introductions'], gate: 'a raise the record supports' },
  ],
  line: [
    { name: 'Discover', items: ['Segment for the new line named', '≥5 interviews logged', 'Pain map for this line only'], gate: 'a distinct pain, not the old one' },
    { name: 'Scope', items: ['MVP scope, value-rated', '90-day OKRs locked', 'Landing page live'], gate: 'a page collecting real leads' },
    { name: 'Prove', items: ['First paid pilot recorded', 'Revenue proof by source', 'Advisor read on the line'], gate: 'paid evidence for the line' },
    { name: 'Fund', items: ['Deck for the line', 'Use of funds locked', 'Three warm introductions'], gate: 'a raise the record supports' },
  ],
};

/**
 * The terms card.
 *
 * `Places` carries `live: 'places'` rather than a number: it is one of the six
 * the platform answers, so the page fills it from the route and renders its own
 * stated absence if that read fails. A literal here would be a number nobody
 * measured, sitting in a row of terms a founder is asked to rely on.
 */
export const TERMS = [
  { k: 'Length', v: '28 days · four weeks' },
  { k: 'Cohort', v: 'Calendar month · 1st' },
  { k: 'Applications close', v: '7 days before · 23:59 ET' },
  { k: 'Equity taken', v: 'None' },
  { k: 'Admission', v: 'By application' },
  { k: 'Places', live: 'places' },
  { k: 'Decision', v: 'Studio team' },
];

/** Where an entity can be formed. `soon` is drawn as unavailable, never hidden. */
export const JURISDICTIONS = [
  { name: 'Delaware C-Corp', sub: 'United States · live', filing: '83(b) Election', capTable: 'Vesting cap table on Carta', soon: false },
  { name: 'Wyoming C-Corp', sub: 'United States · live', filing: '83(b) Election', capTable: 'Vesting cap table on Carta', soon: false },
  { name: 'Singapore Pte Ltd', sub: 'Singapore · coming soon', filing: 'ACRA Share Allotment', capTable: 'Vesting cap table, ACRA-registered', soon: true },
  { name: 'UK Ltd', sub: 'England & Wales · coming soon', filing: 'SH01 Return of Allotment', capTable: 'Vesting cap table, Companies House', soon: true },
];

/** What a founder leaves with. */
export const DELIVERABLES = [
  'Incorporated entity', 'Vesting cap table', 'Equity filing', '12-slide pitch deck',
  '3-year financial model', '5–10 warm introductions', '2 matched advisors', 'Data room',
  'Alumni badge',
];

export const COMMUNITY = [
  { k: 'Cohort directory', v: 'Who else is building this month, by track and gate.' },
  { k: 'Shipping feed', v: 'What the cohort cleared, gate by gate, with the tool that produced it.' },
  { k: 'Founder asks', v: 'Questions to the cohort, answered in the open and kept.' },
];

export const SUPPORT = [
  { k: 'Advisors', v: 'Two, matched against the nine-dimension score' },
  { k: 'Office hours', v: 'Partner organisations, booked with a pre-session brief' },
  { k: 'Introductions', v: 'Five to ten warm, through the Axal VC network' },
  { k: 'Investors', v: 'Fund I invests exclusively in graduates' },
];

export const FIT = [
  'A thesis you can state and a buyer you can name — formed or not',
  'Willing to log interviews, price a pilot and be scored on the record',
  'Solo founders, co-founding pairs, university and corporate spin-outs',
  'Available for the four weeks; the gates do not wait',
];

export const NOT_FIT = [
  'A company that already has product-market fit and a running raise',
  'A consulting or services business with no product line to test',
  'Founders who want a network without producing evidence',
  'Anyone unable to commit the four weeks',
];

/**
 * ────────────────────────────────────────────────────────────────────────────
 * EXAMPLE readings for nine of the nineteen tools — and the word "example" is
 * load-bearing, not a hedge.
 *
 * These numbers are INVENTED. The design's own comment calls them *"a
 * simplified reading of their real screen … so a founder who later opens the
 * tool recognises the picture"* — they show the SHAPE a tool draws, not a
 * measurement of anything. And the brief is a public page read by somebody who
 * has no account yet, so there is no founder's data that could go here even in
 * principle.
 *
 * Rendered unlabelled they would be the most convincing wrong thing on the
 * page: a chart with a figure under it reads as measured. **They ship labelled
 * as examples or they do not ship** — the rule D129, D131 and D140 each applied
 * to a promise, applied here to a picture.
 * ────────────────────────────────────────────────────────────────────────────
 */
const V = '#6d28d9';
const VL = '#c4b5fd';
const VT = '#ede9fe';
const G = '#047857';

export const TOOL_EXAMPLE_READS = {
  disc: { read: '9 interviews · 6 need-to-have', bars: [{ k: 'Need', pct: 67, c: V }, { k: 'Good', pct: 22, c: VL }, { k: 'Nice', pct: 11, c: VT }] },
  roadmap: { read: '3 OKRs · MVP scope value-rated', okrs: [{ c: G, v: 'done' }, { c: V, v: '62%' }, { c: '#e8e6ee', v: '—' }] },
  market: { read: '$2.4B · $340M · $34M · cited', rings: [{ size: 28, left: 0, c: VT }, { size: 17, left: 5, c: VL }, { size: 8, left: 10, c: V }] },
  revenue: { read: '6 months · verified by source', cols: [{ pct: 18, c: VL }, { pct: 26, c: VL }, { pct: 34, c: VL }, { pct: 48, c: V }, { pct: 66, c: V }, { pct: 100, c: V }] },
  brand: { read: '2 pages live · leads routed', tiles: [{ c: VT }, { c: VL }, { c: VT }] },
  deck: { read: '12 slides from recorded data', tiles: [{ c: '#141118' }, { c: VT }, { c: VT }, { c: VT }, { c: VL }] },
  raise: { read: '$1.5M target · 30% committed', segs: [{ k: 'Wired', pct: 12, c: G }, { k: 'Signed', pct: 18, c: V }, { k: 'Open', pct: 70, c: '#f0eff3' }] },
  uof: { read: '18 months of runway', segs: [{ k: 'Eng', pct: 55, c: V }, { k: 'GTM', pct: 30, c: VL }, { k: 'Ops', pct: 15, c: VT }] },
  office: { read: '2 booked · partner sessions', slots: [VT, VT, V, VT, VT, VT, V, VT, VT, VT].map((c) => ({ c })) },
};

/**
 * The one sentence every example read is rendered beside. Exported so the page
 * cannot draw one of these charts without it, and so the test can assert that
 * — a label defined next to the data it qualifies is harder to drop than one
 * typed into a component.
 */
export const EXAMPLE_LABEL = 'Example — the shape this tool draws, not your data';
