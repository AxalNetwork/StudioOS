/* ============================================================================
 *  AXAL VC — SPIN-OUT DEMO DAY DECK — SHARED DATA MODULE
 *
 *  Data-only home for the deck's THEME (colour + fonts), the `fmt` number/money
 *  helpers, the bundled BASEPOINT `SAMPLE_DATA` fixture, and the per-slide
 *  `SAMPLE_NOTES`. Extracted out of `buildDeck.js` so BOTH the browser PPTX
 *  generator (`buildDeck.js`, which pulls in `pptxgenjs`) AND the in-app React
 *  renderer (`templates/axal_spinout_demoday_app.tsx`) can share a single
 *  source of truth without the React bundle importing `pptxgenjs`.
 *
 *  This module has NO runtime dependencies — keep it that way.
 *  status values used below: "done" | "active" | "pending".
 * ========================================================================== */

/* ----------------------------------------------------------------------------
 *  THEME — restrained editorial VC system (white/black/grayscale + 1 accent)
 *  Colours are bare hex (pptxgenjs convention — never inject '#').
 * -------------------------------------------------------------------------- */
export const THEME = {
  fileName: 'Basepoint_SpinOut_DemoDay.pptx',
  fonts: { head: 'Arial', body: 'Arial' },
  color: {
    ink: '12151C', body: '4B5563', muted: '8A93A0', faint: 'AEB6C0',
    line: 'E4E7EC', panel: 'F6F7F9', panel2: 'EEF0F3', white: 'FFFFFF',
    accent: '2C4BE0', accentSoft: 'E7EBFD', accentMid: 'B9C4F6',
    dbg: '0E1116', dpanel: '171C25', dline: '2A313D',
    dmuted: '9099A6', dfaint: '5C6573', accentLt: '6E86FF',
    done: '1F9D6B', active: 'D98A2B', pending: '9AA3AF',
  },
};

/* ----------------------------------------------------------------------------
 *  fmt — single home for money/number formatting. The render engine consumes
 *  pre-formatted strings from DATA; computed values (percentages, and the
 *  money/number helpers the autofill layer uses to build DATA) go through here
 *  so formatting never drifts between slides. Never injects placeholder text.
 * -------------------------------------------------------------------------- */
export const fmt = {
  pct(n) {
    const v = Number(n);
    return Number.isFinite(v) ? `${v}%` : '';
  },
  int(n) {
    const v = Number(n);
    return Number.isFinite(v) ? v.toLocaleString('en-US') : '';
  },
  money(n) {
    const v = Number(n);
    return Number.isFinite(v) ? `$${Math.round(v).toLocaleString('en-US')}` : '';
  },
  // Compact currency: 750000 -> "$750K", 3_200_000_000 -> "$3.2B".
  compactMoney(n) {
    const v = Number(n);
    if (!Number.isFinite(v)) return '';
    const abs = Math.abs(v);
    const sign = v < 0 ? '-' : '';
    const fix = (x) => {
      const s = x.toFixed(1);
      return s.endsWith('.0') ? s.slice(0, -2) : s;
    };
    if (abs >= 1e9) return `${sign}$${fix(abs / 1e9)}B`;
    if (abs >= 1e6) return `${sign}$${fix(abs / 1e6)}M`;
    if (abs >= 1e3) return `${sign}$${fix(abs / 1e3)}K`;
    return `${sign}$${Math.round(abs).toLocaleString('en-US')}`;
  },
};

/* ----------------------------------------------------------------------------
 *  SAMPLE_DATA — the template's structured fields, retained as a fixture.
 *  Real spin-out data (same shape) is threaded in by the wiring layer.
 *  status values: "done" | "active" | "pending"
 * -------------------------------------------------------------------------- */
/* Self-contained SVG headshot (data URI) so the sample deck exercises the
 * photo-rendering path offline / CSP-safe. Live decks use real /api photo
 * endpoints; entries left without a `photo` demonstrate the initials fallback. */
const _avatar = (bg, fg) =>
  'data:image/svg+xml;utf8,' + encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="160">` +
    `<rect width="160" height="160" fill="${bg}"/>` +
    `<circle cx="80" cy="60" r="30" fill="${fg}"/>` +
    `<path d="M28 156a52 52 0 0 1 104 0z" fill="${fg}"/></svg>`,
  );

export const SAMPLE_DATA = {
  brand: {
    lab: 'AXAL VC · SPIN-OUT LAB',
    footerRight: 'BASEPOINT · CONFIDENTIAL',
    network: 'Axal VC',
  },

  cover: {
    company: 'BASEPOINT',
    eyebrowRight: 'DEMO DAY · DAY 30 / 30',
    thesis: 'Private-market lenders still price risk on weeks-old data. Basepoint scores it in real time.',
    signalLabel: 'VALIDATION SIGNAL · 28-DAY SPRINT',
    signalCaption: 'Cumulative discovery interviews',
    signalX: ['D0', 'D5', 'D10', 'D15', 'D20', 'D25', 'D30'],
    signalY: [6, 14, 22, 29, 35, 39, 42],
    meta: [
      ['SECTOR', 'Fintech / AI'],
      ['STAGE', 'Pre-seed'],
      ['FOUNDER', 'Maya Osei'],
      ['LAB STATUS', 'Day 30 / 30'],
    ],
  },

  problem: {
    eyebrow: 'Problem', idx: '02',
    title: 'Three pains surface in every lender conversation.',
    framing: 'Synthesized from 42 discovery interviews with credit and risk teams at mid-market private lenders.',
    quote: "We re-underwrite on data that's already three weeks old. By then the borrower has moved.",
    quoteAttr: 'Head of Credit · mid-market direct lender',
    barsLabel: 'PAIN FREQUENCY ACROSS INTERVIEWS',
    pains: [
      ['Stale data at decision time', 86, '36 / 42'],
      ['Manual, slow review cycles', 71, '30 / 42'],
      ['Thin coverage of private borrowers', 64, '27 / 42'],
      ['No continuous monitoring', 52, '22 / 42'],
    ],
  },

  validation: {
    eyebrow: 'Validation', idx: '03',
    title: 'Empirical signal from a 28-day discovery sprint.',
    cards: [
      ['42', 'Interviews completed'],
      ['31', 'Distinct pains captured'],
      ['8.1', 'Mean solution-fit (/10)'],
      ['9', 'Design-partner LOIs'],
    ],
    funnelLabel: 'DISCOVERY FUNNEL · OUTREACH \u2192 COMMITTED',
    stages: [
      ['Reached out', 180],
      ['Interviewed', 42],
      ['Pain confirmed', 36],
      ['Solution-fit \u2265 7', 24],
      ['LOI / design partner', 9],
    ],
    conversion: ['21%', 'interview \u2192 LOI conversion'],
  },

  market: {
    eyebrow: 'Market', idx: '04',
    title: 'A $3.2B serviceable market, expanding with private credit.',
    // [shortLabel, value, description] — outer to inner
    rings: [
      ['TAM', '$14B', 'Private-credit risk tooling'],
      ['SAM', '$3.2B', 'Mid-market private lenders'],
      ['SOM', '$180M', 'Early-target segment, 3-yr'],
    ],
    whyNowLabel: 'WHY NOW',
    why: [
      ['Private credit has scaled fast.', 'AUM has roughly doubled since 2020, outpacing the tooling underwriters rely on.'],
      ["Data infra is in, risk tooling isn't.", 'Lenders now warehouse loan data but still score risk on manual, periodic reviews.'],
      ['Monitoring pressure is rising.', 'LPs and regulators increasingly expect continuous, auditable risk reporting.'],
    ],
    assumptions: 'Assumptions: bottom-up from ~2,400 addressable mid-market lenders \u00D7 $75K ACV; SOM = ~8% reached in 3 years.',
  },

  solution: {
    eyebrow: 'Solution', idx: '05',
    title: 'From raw borrower data to a live risk score.',
    // [iconKey, label, description] — iconKey maps to ICONS
    steps: [
      ['ingest', 'Ingest', 'Connect loan tapes, bank feeds, and filings in minutes.'],
      ['score', 'Score', 'Generate a real-time risk score with explainable drivers.'],
      ['monitor', 'Monitor', 'Continuously watch every borrower, not just at review.'],
      ['act', 'Act', 'Trigger alerts and repricing the moment risk moves.'],
    ],
    outcomeLabel: 'OUTCOME',
    outcomes: [
      ['40%', 'faster credit decisions'],
      ['Continuous', 'monitoring vs. quarterly reviews'],
      ['Earlier', 'default and covenant signals'],
    ],
  },

  productDemo: {
    eyebrow: 'Product demo', idx: '06',
    title: 'See the live risk score in action.',
    walkthroughLabel: 'WALKTHROUGH',
    body: 'A 90-second walkthrough: connect a loan tape, generate a real-time risk score, and watch continuous monitoring flag risk the moment it moves.',
    // Demo media — a link (or uploaded asset URL) to a short product loop, the
    // live product URL, and a still screenshot. Empty by default so the slide
    // shows its "add a demo" placeholder identically in preview and export.
    videoUrl: '',
    liveUrl: '',
    screenshot: '',
    caption: 'Real-time scoring dashboard \u2014 explainable risk drivers update as new borrower data lands.',
  },

  roadmap: {
    eyebrow: 'Roadmap', idx: '07',
    title: 'Now, next, later \u2014 on a 28-day operating clock.',
    days: ['Day 0', 'Day 30', 'Day 60', 'Day 90'],
    currentDay: 1, // index into days marked as "today"
    phases: [
      ['NOW', 'Day 0 \u2013 30', [
        ['done', '42 discovery interviews completed'],
        ['done', 'Working risk-score prototype'],
        ['active', '9 design partners signed'],
      ]],
      ['NEXT', 'Day 31 \u2013 60', [
        ['pending', 'Live pilot with 3 design partners'],
        ['pending', 'Scoring API v1 in production'],
        ['pending', 'First paid contract signed'],
      ]],
      ['LATER', 'Day 61 \u2013 90', [
        ['pending', 'SOC 2 Type I underway'],
        ['pending', '10 paying lenders onboarded'],
        ['pending', 'Seed round opened'],
      ]],
    ],
  },

  team: {
    eyebrow: 'Team & Network', idx: '08',
    title: 'A founder backed by an operating network.',
    founder: {
      initials: 'MO', name: 'Maya Osei', role: 'Founder & CEO',
      bio: 'Ex-credit-risk lead; built underwriting models across a $2B private-credit book.',
      photo: _avatar('#2C4BE0', '#FFFFFF'),
    },
    // Founder roster (primary first). With a co-founder present the renderer
    // switches the founder block to compact cards to keep the roster on-slide.
    founders: [
      {
        initials: 'MO', name: 'Maya Osei', role: 'Founder & CEO',
        bio: 'Ex-credit-risk lead; built underwriting models across a $2B private-credit book.',
        photo: _avatar('#2C4BE0', '#FFFFFF'),
      },
      {
        initials: 'SR', name: 'Sofia Reyes', role: 'Co-founder & CTO',
        bio: 'Ex-staff ML engineer; shipped real-time risk infra at scale.',
        photo: _avatar('#1F9D6B', '#FFFFFF'),
      },
    ],
    advisorsLabel: 'ADVISORS & ADVISORS',
    // [initials, name, role, photo?] — some carry headshots, others fall back
    // to the initials monogram.
    advisors: [
      ['DK', 'Daniel Kerr', 'Former CRO, regional bank', _avatar('#8A93A0', '#FFFFFF')],
      ['RP', 'Rina Patel', 'Fintech GTM, 2 exits'],
      ['AV', 'Alex Voss', 'ML lead, risk modeling', _avatar('#D98A2B', '#FFFFFF')],
      ['JL', 'Jordan Lee', 'Advisor · credit markets'],
      ['NC', 'Nadia Cho', 'Partner · design partner intros', _avatar('#6E86FF', '#FFFFFF')],
      ['TM', 'Tomas Mraz', 'Advisor · compliance & legal'],
    ],
    centerName: 'Basepoint',
    // [xIn, yIn, name, sub] — positions on the 13.33x7.5 canvas
    nodes: [
      [9.35, 2.50, 'Axal VC', 'studio + capital'],
      [11.85, 4.15, 'Capital network', 'intro pipeline'],
      [9.35, 5.80, 'Design partners', '9 lenders'],
      [6.85, 4.15, 'Advisor bench', 'credit + GTM'],
    ],
  },

  captable: {
    eyebrow: 'Cap table & incorporation', idx: '09',
    title: 'Entity-ready: clean cap table and founder setup.',
    checklistLabel: 'FOUNDER & ENTITY SETUP',
    items: [
      ['Delaware C-corp formed', 'done'],
      ['Founder equity issued', 'done'],
      ['4-yr vesting, 1-yr cliff', 'done'],
      ['83(b) elections filed', 'done'],
      ['IP assignment executed', 'done'],
      ['Option pool reserved (15%)', 'done'],
      ['SAFE template prepared', 'active'],
    ],
    donutLabel: 'CAP TABLE · FULLY DILUTED',
    centerBig: '100%', centerSmall: 'post-formation',
    // [label, value] — value is a percentage number
    segments: [
      ['Founders', 80],
      ['Option pool', 15],
      ['SAFE (reserved)', 5],
    ],
  },

  ask: {
    eyebrow: 'The ask', idx: '10',
    title: 'Raising $750K pre-seed to reach revenue.',
    kpis: [
      ['$750K', 'Target raise'],
      ['SAFE', 'Instrument · $6M cap'],
      ['18 mo', 'Runway'],
      ['8 wks', 'Target close'],
    ],
    useLabel: 'USE OF FUNDS · 18-MONTH PLAN',
    funds: [
      ['Engineering & product', 45],
      ['Go-to-market', 25],
      ['Data & infrastructure', 20],
      ['Operations & legal', 10],
    ],
    milestone: ['Gets us to:', '10 paying lenders and seed-ready metrics.'],
  },

  deal: {
    eyebrow: 'Deal readiness', idx: '11',
    title: 'Data room open. Ready to move.',
    diligenceLabel: 'DILIGENCE PACKAGE',
    ready: [
      ['Data room', 'Open'],
      ['Financial model', 'Included'],
      ['Cap table & legal docs', 'Included'],
      ['Customer references', 'On request'],
      ['NDA', 'Not required'],
    ],
    nextLabel: 'NEXT STEPS',
    steps: [
      ['1', '30-minute intro call'],
      ['2', 'Data room access granted same day'],
      ['3', 'SAFE \u2014 target close in 8 weeks'],
    ],
    closingLine: 'Open to diligence and intros this week.',
    contact: 'maya@basepoint.xyz   ·   axal.vc',
  },
};

/* ----------------------------------------------------------------------------
 *  SAMPLE_NOTES — speaker-note field map (auto vs manual), kept per slide.
 * -------------------------------------------------------------------------- */
export const SAMPLE_NOTES = {
  cover: 'COVER. Focal: thesis statement; area chart is the data hero (cumulative discovery interviews over the sprint).\nAUTO: company, thesis, sector/stage/founder, lab-day counter, validation-signal series.\nMANUAL: final thesis wording.',
  problem: 'PROBLEM. Message: a few high-frequency, evidenced pains, ranked.\nAUTO: pain themes, frequency %, interview counts, pull quote.\nMANUAL: choose which quote to surface; trim labels.',
  validation: 'VALIDATION. Message: measurable signal from the sprint.\nAUTO: scorecard values, funnel stage counts, conversion rate.\nMANUAL: none (computed).',
  market: 'MARKET. Message: credible bottom-up serviceable market.\nAUTO: TAM/SAM/SOM figures, ACV + lender-count assumptions.\nMANUAL: the three why-now lines.',
  solution: 'SOLUTION. Message: data \u2192 live score, four steps.\nAUTO: step copy, outcome metrics.\nMANUAL: confirm outcome numbers vs. latest pilot.',
  productDemo: 'PRODUCT DEMO. Message: show the product, do not just describe it.\nAUTO: walkthrough copy.\nMANUAL: paste a live demo URL + short loop video link or screenshot from the project.',
  roadmap: 'ROADMAP. Message: operating plan on the 28-day cadence.\nAUTO: milestones + status flags (milestone tracker).\nMANUAL: none if tracker is current.',
  team: 'TEAM & NETWORK. Message: founder inside a structured operating network.\nAUTO: profiles, network node labels (people graph).\nMANUAL: advisor consent; swap initials for headshots.',
  captable: 'CAP TABLE & INCORPORATION. Message: legal + equity setup is investor-ready.\nAUTO: checklist statuses, cap-table splits (data-room module).\nMANUAL: none if module current.',
  ask: 'THE ASK. Message: specific raise tied to a milestone.\nAUTO: raise, instrument/cap, runway, close, allocations.\nMANUAL: confirm cap + close with counsel.',
  deal: 'DEAL READINESS. Message: diligence-ready now, frictionless next step.\nAUTO: document statuses, timeline, contact.\nMANUAL: confirm contact + live data-room link.',
};
