/* ============================================================================
 *  Task #41 — Spin-Out deck DATA assembler (Worker side).
 *
 *  Prod is a Cloudflare Worker on D1; the new 10-slide deck generator
 *  (`frontend/src/decks/spinout/buildDeck.js`, Task #40) runs in the BROWSER
 *  (it needs pptxgenjs). So the Worker's job is to ASSEMBLE the new-shape
 *  `DATA` + `NOTES` + `gaps[]` and hand it to the browser, which calls
 *  `buildDeck(data, { notes, draft })` and downloads the `.pptx`.
 *
 *  We do NOT re-query D1 here: we remap the EXISTING `fillAxalSpinoutDemoDay`
 *  output (which already reads every Lab module — Customer Discovery, Market
 *  Intel, Roadmap, Scoring, Advisors/Network, Team, Incorporate/Cap Table,
 *  Capital/Compliance) into the new 10-slide contract.
 *
 *  `mapToSpinoutDeckData` is PURE (SpinoutDemoDayData -> bundle) so it can be
 *  unit-tested with fixtures and no D1 mock. `assembleSpinoutDeckData` is the
 *  thin env wrapper.
 *
 *  Field policy (per task §5 + architect review):
 *   - A slide adds a `gap` only when its backing Lab MODULE is empty/missing
 *     real data. A fully-completed project therefore produces zero gaps.
 *   - Structural/label/static-flow fields use honest defaults (no fabricated
 *     investor numbers, no gap).
 *   - Empty chart-bearing modules fall back to template figures so the slide
 *     still renders, but ALWAYS push a gap — and any gap (or programDay < 28)
 *     stamps the file metadata title "DRAFT".
 * -------------------------------------------------------------------------- */

import type { Env } from '../../types';
import { fillAxalSpinoutDemoDay, type SpinoutDemoDayData } from './axalSpinoutDemoDay';

type Status = 'done' | 'active' | 'pending';

export interface SpinoutDeckData {
  brand: { lab: string; footerRight: string; network: string };
  cover: {
    company: string; eyebrowRight: string; thesis: string;
    signalLabel: string; signalCaption: string;
    signalX: string[]; signalY: number[];
    meta: Array<[string, string]>;
  };
  problem: {
    eyebrow: string; idx: string; title: string; framing: string;
    quote: string; quoteAttr: string; barsLabel: string;
    pains: Array<[string, number, string]>;
  };
  validation: {
    eyebrow: string; idx: string; title: string;
    cards: Array<[string, string]>;
    funnelLabel: string; stages: Array<[string, number]>;
    conversion: [string, string];
  };
  market: {
    eyebrow: string; idx: string; title: string;
    rings: Array<[string, string, string]>;
    whyNowLabel: string; why: Array<[string, string]>; assumptions: string;
  };
  solution: {
    eyebrow: string; idx: string; title: string;
    steps: Array<[string, string, string]>;
    outcomeLabel: string; outcomes: Array<[string, string]>;
  };
  // Task #31 — slot 6. Sourced from the project's Product demo columns.
  productDemo: {
    eyebrow: string; idx: string; title: string;
    walkthroughLabel: string; body: string;
    videoUrl: string; liveUrl: string; screenshot: string; caption: string;
  };
  roadmap: {
    eyebrow: string; idx: string; title: string;
    days: string[]; currentDay: number;
    phases: Array<[string, string, Array<[Status, string]>]>;
  };
  team: {
    eyebrow: string; idx: string; title: string;
    // `photo` is an optional headshot URL; the renderer falls back to
    // `initials` when it is absent or fails to load.
    founder: { initials: string; name: string; role: string; bio: string; photo?: string };
    // Full founder roster (primary first). The single `founder` above stays
    // populated for back-compat (pptx export + the single-founder layout).
    founders: Array<{ initials: string; name: string; role: string; bio: string; photo?: string }>;
    // advisor tuple: [initials, name, role, photo?]
    advisorsLabel: string; advisors: Array<[string, string, string, string?]>;
    centerName: string; nodes: Array<[number, number, string, string]>;
  };
  captable: {
    eyebrow: string; idx: string; title: string;
    checklistLabel: string; items: Array<[string, Status]>;
    donutLabel: string; centerBig: string; centerSmall: string;
    segments: Array<[string, number]>;
  };
  ask: {
    eyebrow: string; idx: string; title: string;
    kpis: Array<[string, string]>;
    useLabel: string; funds: Array<[string, number]>;
    milestone: [string, string];
  };
  deal: {
    eyebrow: string; idx: string; title: string;
    diligenceLabel: string; ready: Array<[string, string]>;
    nextLabel: string; steps: Array<[string, string]>;
    closingLine: string; contact: string;
  };
}

export type SpinoutDeckNotes = Record<string, string>;

export interface SpinoutDeckBundle {
  data: SpinoutDeckData;
  notes: SpinoutDeckNotes;
  gaps: string[];
  /**
   * Index-aligned with `gaps`: the dotted `SpinoutDeckData` field each gap is
   * about, or null for gaps that no single field can answer (a missing chart
   * series, an empty roster). The manual-override layer
   * (`services/decks/spinoutDeckOverrides.ts`) uses this to drop a gap once its
   * field has been overridden — "add a one-line thesis" is a false alarm the
   * moment a thesis exists, whatever wrote it.
   */
  gapFields?: Array<string | null>;
  /**
   * Index-aligned with `gaps`: which SLIDE each gap belongs to, as a key of
   * `SpinoutDeckData` (`cover`, `problem`, `validation`, …).
   *
   * This is the Pitch Deck Builder's readiness contract. `fields` cannot carry
   * it: `flattenSpinoutDeckData` omits empty scalars, so a template FALLBACK
   * figure and a founder-authored one are indistinguishable there, and a
   * project with nothing filled in yields a field map with zero empty entries.
   * Counting filled-vs-total over `fields` therefore reports every slide
   * complete for a founder who has done no work — which is exactly what the
   * builder used to show. Readiness has to be read from the gaps instead.
   */
  gapSections?: Array<string | null>;
  draft: boolean;
  programDay: number;
  /** Task #55 — flat dotted-key field map for the editor's hydrate() contract. */
  fields: Record<string, string>;
}

/* ---------------------------------------------------------------- helpers -- */
const DASH = '—';
const PROGRAM_DAYS = 28; // Spin-Out Lab is a 28-day (4-week) program.

const has = (v: unknown): boolean =>
  !!v && String(v).trim() !== '' && String(v).trim() !== DASH;

const clamp = (n: number, lo: number, hi: number): number =>
  Math.max(lo, Math.min(hi, n));

const intOr0 = (v: unknown): number => {
  const n = parseInt(String(v ?? '').replace(/[^0-9.\-]/g, ''), 10);
  return Number.isFinite(n) ? n : 0;
};

const pctNum = (v: unknown): number => {
  const n = parseFloat(String(v ?? '').replace(/[^0-9.\-]/g, ''));
  return Number.isFinite(n) ? clamp(Math.round(n), 0, 100) : 0;
};

// Short deck-card form of a score_snapshots.tier code (classifyTier() in
// ../scoring.ts). Deliberately NOT the full tierLabel() sentence ("Tier 1 —
// Immediate Spinout") — a slide card has room for a word, not a clause. Falls
// through to the raw code for anything unrecognized rather than hiding it.
const TIER_SHORT: Record<string, string> = { TIER_1: 'Tier 1', TIER_2: 'Tier 2', REJECT: 'Reject' };

const initialsOf = (name: string): string => {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '—';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
};

/** Split a why-now line into [lead sentence, remainder] for the title/body pair. */
const splitWhy = (line: string): [string, string] => {
  const s = String(line || '').trim();
  if (!s) return ['', ''];
  const m = s.match(/^(.{8,72}?[.!?])\s+(.*)$/);
  if (m) return [m[1].trim(), m[2].trim()];
  if (s.length <= 60) return [s, ''];
  return [s.slice(0, 56).trim() + '…', s.trim()];
};

/**
 * Cumulative discovery-interview series from the cover activity log.
 * Returns null when there is no interview activity (caller falls back to the
 * template series + a gap). Samples to <= 7 points for the area chart.
 */
const buildSignalSeries = (
  log: SpinoutDemoDayData['cover']['activity_log'],
): { x: string[]; y: number[] } | null => {
  const daily = (log || []).map((e) => Math.max(0, Number(e?.modules?.interview ?? 0)));
  if (!daily.length) return null;
  let run = 0;
  const cum = daily.map((n) => (run += Number.isFinite(n) ? n : 0));
  if (cum[cum.length - 1] <= 0) return null;
  const N = cum.length;
  const want = Math.min(7, N);
  const idxs = want === 1
    ? [0]
    : Array.from({ length: want }, (_, i) => Math.round((i * (N - 1)) / (want - 1)));
  const span = Math.max(1, N - 1);
  return {
    x: idxs.map((i) => `D${Math.round((i / span) * 30)}`),
    y: idxs.map((i) => cum[i]),
  };
};

/* ----------------------------------------------------------- template gaps -- */
/**
 * Neutral per-slide fallbacks for an EMPTY module. Text fields read as
 * clearly-unfilled ('—'); chart fields carry minimal template figures so the
 * slide still renders (always paired with a gap + DRAFT watermark). These are
 * NOT the Basepoint sample copy — they never assert a real company's numbers.
 */
const FALLBACK = {
  signalX: ['D0', 'D5', 'D10', 'D15', 'D20', 'D25', 'D30'],
  signalY: [0, 1, 2, 3, 4, 5, 6],
  pains: [
    ['Primary pain', 50, DASH],
    ['Secondary pain', 38, DASH],
    ['Tertiary pain', 26, DASH],
  ] as Array<[string, number, string]>,
  cards: [
    ['0', 'Interviews completed'],
    ['0', 'Distinct pains'],
    [DASH, 'Mean solution-fit'],
    ['0', 'Design-partner LOIs'],
  ] as Array<[string, string]>,
  stages: [
    ['Interviewed', 0],
    ['Pain confirmed', 0],
    ['Solution-fit', 0],
  ] as Array<[string, number]>,
  funds: [
    ['Engineering & product', 45],
    ['Go-to-market', 25],
    ['Data & infrastructure', 20],
    ['Operations & legal', 10],
  ] as Array<[string, number]>,
  segments: [
    ['Founders', 80],
    ['Option pool', 15],
    ['Reserved', 5],
  ] as Array<[string, number]>,
};

/** Speaker notes — auto/manual field map, one per rendered slide. */
const NOTES: SpinoutDeckNotes = {
  cover: 'COVER. Focal: thesis statement; area chart is the data hero (cumulative discovery interviews over the sprint).\nAUTO: company, thesis, sector/stage/founder, lab-day counter, validation-signal series.\nMANUAL: final thesis wording.',
  problem: 'PROBLEM. Message: a few high-frequency, evidenced pains, ranked.\nAUTO: pain themes, frequency %, interview counts, pull quote.\nMANUAL: choose which quote to surface; trim labels.',
  validation: 'VALIDATION. Message: measurable signal from the sprint.\nAUTO: scorecard values, funnel stage counts, conversion rate.\nMANUAL: confirm funnel stages (outreach / LOIs) where not tracked.',
  market: 'MARKET. Message: credible bottom-up serviceable market.\nAUTO: TAM/SAM/SOM figures, why-now lines.\nMANUAL: sizing assumptions + citation basis.',
  solution: 'SOLUTION. Message: data \u2192 live score, four steps.\nAUTO: step copy from capabilities.\nMANUAL: confirm target outcome metrics vs. latest pilot.',
  productDemo: 'PRODUCT DEMO. Message: show the product, don\u2019t just describe it.\nAUTO: walkthrough copy.\nMANUAL: paste a live demo URL + short loop video link or screenshot from the project.',
  roadmap: 'ROADMAP. Message: operating plan on the 28-day cadence.\nAUTO: Now/Next/Later from OKRs + status flags.\nMANUAL: none if tracker is current.',
  team: 'TEAM & NETWORK. Message: founder inside a structured operating network.\nAUTO: founder profile, advisor roster, network nodes.\nMANUAL: advisor consent; swap initials for headshots.',
  captable: 'CAP TABLE & INCORPORATION. Message: legal + equity setup is investor-ready.\nAUTO: readiness checklist statuses, cap-table splits.\nMANUAL: none if module current.',
  ask: 'THE ASK. Message: specific raise tied to a milestone.\nAUTO: raise, runway, allocations, milestone.\nMANUAL: confirm instrument/cap + close with counsel.',
  deal: 'DEAL READINESS. Message: diligence-ready now, frictionless next step.\nAUTO: document statuses, contact.\nMANUAL: confirm live data-room link.',
};

/* ============================================================================
 *  mapToSpinoutDeckData — PURE remap of the existing fill output.
 * ========================================================================== */
export function mapToSpinoutDeckData(src: SpinoutDemoDayData): SpinoutDeckBundle {
  const gaps: string[] = [];
  // Second arg tags the gap with the dotted field it is about, so a manual
  // override of that field can retire it. Omit it for gaps no single scalar
  // can answer (missing chart data, an empty advisor roster).
  const gapFields: Array<string | null> = [];
  // Third arg is the SLIDE the gap belongs to, and it is the signal the Pitch
  // Deck Builder needs most.
  //
  // WHY. A slide whose module is empty still renders: the FALLBACK block below
  // supplies template figures so the deck is never broken mid-sprint, and every
  // one of those substitutions raises a gap. But `fields` — the flat map the
  // builder consumes — cannot carry that distinction: flattenSpinoutDeckData
  // SKIPS empty scalars, so a fallback value and a founder-authored value look
  // identical in it, and an all-empty project produced a field map with zero
  // empty entries. The builder read that as "every slide complete" and captioned
  // eleven slides of template content "Data populated from your work".
  //
  // So the gap list is the readiness contract, and it has to say WHICH SLIDE.
  // Section names match the keys of SpinoutDeckData (and SLIDE_META.prefix in
  // frontend/src/lib/pitchDeckViewModel.js) — asserted in the tests, because a
  // typo here would silently mark a slide permanently ready.
  const gapSections: Array<string | null> = [];
  const gap = (s: string, field: string | null = null, section: string | null = null) => {
    gaps.push(s);
    gapFields.push(field);
    // A field key already names its section; only tag explicitly when there is
    // no field (chart series, rosters, multi-field modules).
    gapSections.push(section || (field ? field.split('.')[0] : null));
  };

  const m = src.meta;
  const remaining = clamp(Number(m.days_remaining ?? PROGRAM_DAYS), 0, PROGRAM_DAYS);
  const programDay = clamp(PROGRAM_DAYS - remaining, 0, PROGRAM_DAYS);
  const labStatus = `Day ${programDay} / ${PROGRAM_DAYS}`;

  const projectName = has(m.project_name) ? m.project_name : 'Company';
  const sector = has(m.sector) ? m.sector : DASH;
  const founderName = has(m.founder_name) ? m.founder_name : DASH;

  /* ---- brand (structural) ---- */
  const brand: SpinoutDeckData['brand'] = {
    lab: 'AXAL VC · SPIN-OUT LAB',
    footerRight: `${projectName.toUpperCase()} · CONFIDENTIAL`,
    network: 'Axal VC',
  };

  /* ---- cover ---- */
  // Founder-AUTHORED sources only: the tagline (projects.tagline) and the
  // vision (projects.vision, via cover.sub — now empty when unwritten).
  // `problem.headline` was in this chain and is an unconditional display
  // literal in the producer ("Why this is broken today."), so it made the
  // fallback below unreachable. A slide heading is not a thesis.
  const thesisSrc = [src.brand?.tagline, src.cover?.sub].find(has);
  let thesis: string;
  if (thesisSrc) thesis = String(thesisSrc);
  else { thesis = '[draft — add a one-line thesis in the Brand module]'; gap('Cover: add a one-line thesis in the Brand module.', 'cover.thesis'); }

  const sig = buildSignalSeries(src.cover?.activity_log);
  let signalX: string[]; let signalY: number[];
  if (sig) { signalX = sig.x; signalY = sig.y; }
  else {
    // Task #65 — honest zero-state. With no logged discovery interviews the
    // cover chart must read as a flat baseline at 0 across the 28-day sprint
    // axis with a 0 total — never a fabricated rising curve. Always paired
    // with a gap + DRAFT watermark. Keeping it at the source means every
    // surface (builder preview, PPTX/PDF export, print/share) stays truthful
    // and consistent.
    signalX = FALLBACK.signalX;
    signalY = FALLBACK.signalX.map(() => 0);
    gap('Cover: log discovery interviews to build the validation-signal chart.', null, 'cover');
  }

  const cover: SpinoutDeckData['cover'] = {
    company: projectName.toUpperCase(),
    eyebrowRight: `DEMO DAY · ${labStatus}`,
    thesis,
    signalLabel: 'VALIDATION SIGNAL · 28-DAY SPRINT',
    signalCaption: 'Cumulative discovery interviews',
    signalX, signalY,
    meta: [
      ['SECTOR', sector],
      ['STAGE', 'Pre-seed'],
      ['FOUNDER', founderName],
      ['LAB STATUS', labStatus],
    ],
  };

  /* ---- validation counts (shared by problem + validation slides) ---- */
  const metrics = src.validation?.metrics || [];
  const interviewN = intOr0(metrics[0]?.value);
  const ratings = src.validation?.ratings || [];
  const ratedN = ratings.reduce((a, b) => a + (Number(b) || 0), 0);
  const fitN = (Number(ratings[4]) || 0) + (Number(ratings[5]) || 0);

  /* ---- problem ---- */
  const painThemes = src.problem?.pain_themes || [];
  let pains: Array<[string, number, string]>;
  if (painThemes.length) {
    const base = interviewN > 0 ? interviewN : Math.max(1, ...painThemes.map((t) => t.mentions || 0));
    pains = painThemes.slice(0, 4).map((t) => [
      t.theme,
      clamp(Math.round(((t.mentions || 0) / base) * 100), 0, 100),
      interviewN > 0 ? `${t.mentions || 0} / ${interviewN}` : `${t.mentions || 0}`,
    ] as [string, number, string]);
  } else { pains = FALLBACK.pains; gap('Problem: cluster discovery pains in the Customer Discovery module.', null, 'problem'); }

  const quote0 = (src.validation?.quotes || [])[0];
  let quote: string; let quoteAttr: string;
  if (quote0 && has(quote0.takeaway)) {
    quote = quote0.takeaway;
    quoteAttr = [quote0.name, quote0.role].filter(has).join(' · ') || 'Discovery interview';
  } else {
    quote = '[draft — feature a discovery quote from the Customer Discovery module]';
    quoteAttr = 'Customer Discovery';
    gap('Problem: feature a customer quote in the Customer Discovery module.', 'problem.quote');
  }

  const framing = has(src.problem?.body)
    ? src.problem.body
    : (interviewN > 0
      ? `Synthesized from ${interviewN} discovery interviews with target customers.`
      : 'Synthesized from the Customer Discovery module.');

  const problem: SpinoutDeckData['problem'] = {
    eyebrow: 'Problem', idx: '02',
    title: has(src.problem?.headline) ? src.problem.headline : 'The pains that surface in every customer conversation.',
    framing, quote, quoteAttr,
    barsLabel: 'PAIN FREQUENCY ACROSS INTERVIEWS',
    pains,
  };

  /* ---- validation ---- */
  let cards: Array<[string, string]>;
  if (metrics.length) cards = metrics.slice(0, 4).map((mc) => [String(mc.value ?? DASH), String(mc.label ?? '')] as [string, string]);
  else { cards = FALLBACK.cards; }

  // Venture score — the Scoring module's latest OFFICIAL (non-sandbox),
  // HMAC-signed result (score_snapshots, read by fillAxalSpinoutDemoDay into
  // src.venture_readiness). It is the single most rigorously verified figure
  // anywhere in the Lab, and until now reached no slide at all: this mapper
  // has 11 slides and none of them read venture_readiness. Validation is
  // where it belongs — the slide's whole job is "how validated is this
  // venture", and the platform's own scored verdict is exactly that, not a
  // twelfth thing bolted beside the interview metrics.
  //
  // Never put this behind an override. SPINOUT_OVERRIDABLE_KEYS
  // (spinoutDeckOverrides.ts) is scalars-only by design for exactly this
  // reason: a typed-in "94/100" would defeat the point of a cryptographically
  // signed one. Capped at one extra card (not appended unconditionally) —
  // the renderer lays validation.cards out at fixed x-offsets sized for
  // exactly 4 (axal_spinout_demoday_app.tsx / buildDeck.js), so a 5th card
  // would run off the right edge of the slide.
  const vrScore = src.venture_readiness?.total_score;
  const vrTier = src.venture_readiness?.tier;
  const scoreNum = has(vrScore) ? String(vrScore).match(/\d+/)?.[0] : undefined;
  let scoreCard: [string, string];
  if (scoreNum && has(vrTier)) {
    scoreCard = [scoreNum, `${TIER_SHORT[vrTier as string] || vrTier} · Axal score`];
  } else {
    scoreCard = [DASH, 'Axal score · not yet run'];
    gap('Validation: run an official venture score in the Scoring module.', null, 'validation');
  }
  cards = [...cards.slice(0, 3), scoreCard];

  let stages: Array<[string, number]>;
  let conversion: [string, string];
  if (interviewN > 0) {
    const painsN = intOr0(metrics[1]?.value);
    stages = [['Interviewed', interviewN]];
    if (painsN > 0) stages.push(['Pain confirmed', Math.min(painsN, interviewN)]);
    if (ratedN > 0) stages.push(['Solution-fit \u2265 4/5', fitN]);
    if (stages.length < 3) gap('Validation: add outreach and LOI/design-partner counts to complete the discovery funnel.', null, 'validation');
    conversion = ratedN > 0
      ? [`${Math.round((fitN / ratedN) * 100)}%`, 'rated solution-fit \u2265 4 / 5']
      : [DASH, 'solution-fit not yet rated'];
  } else {
    // No interviews logged: render an EMPTY funnel, not a fabricated one.
    //
    // This previously resolved to [['Interviewed', 1]] — FALLBACK.stages is all
    // zeros, so the `> 0` test never passed and the literal always won. A
    // founder who had logged nothing shipped a deck asserting one interview to
    // investors. The stated reason was "guarantee a positive max so the funnel
    // renderer never divides by zero", but both renderers already cope with an
    // empty list: the React slide guards with `stages.length ? … : 1`
    // (axal_spinout_demoday_app.tsx:452) and buildDeck.js does the same since
    // this change. An empty chart plus the gap below is the honest state.
    stages = [];
    conversion = [DASH, 'log discovery interviews to compute'];
    gap('Validation: log discovery interviews and ratings in the Customer Discovery module.', null, 'validation');
  }

  const validation: SpinoutDeckData['validation'] = {
    eyebrow: 'Validation', idx: '03',
    title: has(src.validation?.headline) ? src.validation.headline : 'Empirical signal from the discovery sprint.',
    cards,
    funnelLabel: 'DISCOVERY FUNNEL · INTERVIEWS \u2192 SOLUTION-FIT',
    stages, conversion,
  };

  /* ---- market ---- */
  const mk = src.market || ({} as SpinoutDemoDayData['market']);
  const marketFilled = (has(mk.tam) ? 1 : 0) + (has(mk.sam) ? 1 : 0) + (has(mk.som) ? 1 : 0);
  const rings: Array<[string, string, string]> = [
    ['TAM', has(mk.tam) ? mk.tam : DASH, 'Total addressable'],
    ['SAM', has(mk.sam) ? mk.sam : DASH, 'Serviceable available'],
    ['SOM', has(mk.som) ? mk.som : DASH, 'Serviceable obtainable'],
  ];
  if (marketFilled < 3) gap('Market: size TAM/SAM/SOM in the Market Intel module.', null, 'market');

  const whyNow = (mk.why_now || []).filter(has).slice(0, 3);
  let why: Array<[string, string]>;
  if (whyNow.length) why = whyNow.map((w) => splitWhy(w));
  else { why = [['Why now', '[draft — add why-now drivers in the Market Intel module]']]; gap('Market: add why-now drivers in the Market Intel module.', null, 'market'); }

  const market: SpinoutDeckData['market'] = {
    eyebrow: 'Market', idx: '04',
    title: has(mk.headline) ? mk.headline : 'A serviceable market, sized bottom-up.',
    rings,
    whyNowLabel: 'WHY NOW',
    why,
    assumptions: 'Sizing methodology and assumptions: see the Market Intel module.',
  };

  /* ---- solution (fixed 4 steps, baked icon keys) ---- */
  const caps = (src.solution?.capabilities || []).filter(has);
  const stepDefs: Array<[string, string, string]> = [
    ['ingest', 'Ingest', 'Connect the data sources your product depends on.'],
    ['score', 'Score', 'Turn raw inputs into a real-time, explainable output.'],
    ['monitor', 'Monitor', 'Continuously watch for change, not just at review.'],
    ['act', 'Act', 'Trigger the next action the moment signal moves.'],
  ];
  const steps = stepDefs.map((d, i) => [d[0], d[1], has(caps[i]) ? caps[i] : d[2]] as [string, string, string]);
  if (!caps.length) gap('Solution: describe your MVP capabilities in the Solution module.', null, 'solution');

  const solution: SpinoutDeckData['solution'] = {
    eyebrow: 'Solution', idx: '05',
    title: has(src.solution?.headline) ? src.solution.headline : 'From raw inputs to a live, actionable output.',
    steps,
    outcomeLabel: 'TARGET OUTCOMES',
    outcomes: [
      ['Faster', 'decisions'],
      ['Continuous', 'monitoring'],
      ['Earlier', 'signals'],
    ],
  };

  /* ---- product demo (slot 6) ---- */
  // Sourced from the project's Product demo columns (editable on the project
  // detail page). Empty media URLs are emitted as '' and dropped by the
  // flatten step, so the slide falls back to its "add a demo" placeholder
  // identically in the preview and the PPTX export.
  const pd = src.product_demo;
  const pdVideo = has(pd?.loop_url) ? pd.loop_url : '';
  const pdLive = has(pd?.live_url) ? pd.live_url : '';
  const pdShot = has(pd?.screenshot_url) ? pd.screenshot_url : '';
  const pdCaption = has(pd?.caption) ? pd.caption : '';
  const pdBody = has(pd?.body) ? pd.body : '';
  const productDemo: SpinoutDeckData['productDemo'] = {
    eyebrow: 'Product demo', idx: '06',
    title: has(pd?.headline) ? pd.headline : 'See the product in action.',
    walkthroughLabel: 'WALKTHROUGH',
    body: pdBody,
    videoUrl: pdVideo,
    liveUrl: pdLive,
    screenshot: pdShot,
    caption: pdCaption,
  };
  if (!has(pdVideo) && !has(pdLive) && !has(pdShot)) {
    gap('Product demo: add a demo video link, live demo URL, or screenshot on the project.', null, 'productDemo');
  }

  /* ---- roadmap ---- */
  const rm = src.roadmap || ({} as SpinoutDemoDayData['roadmap']);
  const nowItems = (rm.now || []).filter(has);
  const nextItems = (rm.next || []).filter(has);
  const laterItems = (rm.later || []).filter(has);
  const okrTotal = nowItems.length + nextItems.length + laterItems.length;
  let phases: SpinoutDeckData['roadmap']['phases'];
  if (okrTotal === 0) {
    phases = [
      ['NOW', 'Day 0 \u2013 30', [['active', '[draft — add 90-day OKRs in the Roadmap module]']]],
      ['NEXT', 'Day 31 \u2013 60', []],
      ['LATER', 'Day 61 \u2013 90', []],
    ];
    gap('Roadmap: add 90-day OKRs in the Roadmap module.', null, 'roadmap');
  } else {
    const nowMapped: Array<[Status, string]> = nowItems.map((t, i) =>
      [(programDay < PROGRAM_DAYS && i === nowItems.length - 1) ? 'active' : 'done', t] as [Status, string]);
    phases = [
      ['NOW', 'Day 0 \u2013 30', nowMapped],
      ['NEXT', 'Day 31 \u2013 60', nextItems.map((t) => ['pending', t] as [Status, string])],
      ['LATER', 'Day 61 \u2013 90', laterItems.map((t) => ['pending', t] as [Status, string])],
    ];
  }

  const roadmap: SpinoutDeckData['roadmap'] = {
    eyebrow: 'Roadmap', idx: '07',
    title: has(rm.headline) ? rm.headline : 'Now, next, later \u2014 on a 28-day operating clock.',
    days: ['Day 0', 'Day 30', 'Day 60', 'Day 90'],
    currentDay: programDay >= 15 ? 1 : 0,
    phases,
  };

  /* ---- team & network ---- */
  const srcFounders = (src.team?.founders || []).filter((f) => f && has(f.name));
  const profiles = src.mentor_network?.profiles || [];

  // Cap-table founders carry no photo of their own. Best-effort: reuse the
  // headshot of a published network profile whose name matches the founder
  // (case-insensitive). Falls back to the initials monogram otherwise.
  const photoByName = new Map<string, string>();
  for (const p of profiles) {
    const ph = p.photo_url || '';
    if (has(p.name) && has(ph)) photoByName.set(p.name.trim().toLowerCase(), String(ph));
  }
  const toFounderCard = (
    fr: { name: string; role?: string; bio?: string; company?: string },
  ): SpinoutDeckData['team']['founders'][number] => {
    const photo = photoByName.get(fr.name.trim().toLowerCase());
    return {
      initials: initialsOf(fr.name),
      name: fr.name,
      role: has(fr.role) ? String(fr.role) : 'Founder',
      bio: has(fr.bio) ? String(fr.bio) : (has(fr.company) ? `Founder, ${fr.company}.` : ''),
      ...(photo ? { photo } : {}),
    };
  };

  let founder: SpinoutDeckData['team']['founder'];
  let founders: SpinoutDeckData['team']['founders'];
  if (srcFounders.length) {
    founders = srcFounders.map(toFounderCard);
    founder = founders[0];
  } else {
    founder = { initials: DASH, name: 'Founder', role: 'Founder & CEO', bio: '[draft — add your founder profile in the Team module]' };
    founders = [founder];
    gap('Team: add your founder profile in the Cofounder/Team module.', null, 'team');
  }

  const advisorNames = (src.mentor_network?.mentors || []).filter(has);
  // Roster (advisors / partners). The renderer's vertical-fit logic
  // decides how many actually render, so we pass through a generous slice
  // rather than hard-capping at the old 4.
  let advisors: SpinoutDeckData['team']['advisors'];
  if (profiles.length) {
    advisors = profiles.slice(0, 8).map((p) => {
      const photo = has(p.photo_url || '') ? String(p.photo_url) : undefined;
      return [initialsOf(p.name), p.name, has(p.role) ? p.role : 'Advisor', photo] as [string, string, string, string?];
    });
  } else if (advisorNames.length) {
    advisors = advisorNames.slice(0, 8).map((n) => [initialsOf(n), n, 'Advisor'] as [string, string, string, string?]);
  } else {
    advisors = [];
    gap('Team: connect advisors in the Advisors & Network module.', null, 'team');
  }

  const team: SpinoutDeckData['team'] = {
    eyebrow: 'Team & Network', idx: '08',
    title: has(src.team?.headline) ? src.team.headline : 'A founder backed by an operating network.',
    founder,
    founders,
    advisorsLabel: 'ADVISORS & ADVISORS',
    advisors,
    centerName: projectName,
    nodes: [
      [9.35, 2.50, 'Axal VC', 'studio + capital'],
      [11.85, 4.15, 'Capital network', 'investor intros'],
      [9.35, 5.80, 'Design partners', 'pilot pipeline'],
      [6.85, 4.15, 'Advisor bench', 'operating help'],
    ],
  };

  /* ---- cap table & incorporation ---- */
  const holders = src.cap_table?.holders || [];
  const items: Array<[string, Status]> = [
    ['Entity incorporated', src.brand?.incorporated ? 'done' : 'pending'],
    ['Cap table recorded', holders.length ? 'done' : 'pending'],
    ['Founder equity issued', holders.some((h) => /found/i.test(String(h.kind || h.role || ''))) ? 'done' : 'pending'],
    ['Brand kit ready', src.brand?.brand_kit_ready ? 'done' : 'pending'],
    ['Pitch deck ready', src.brand?.pitch_deck_ready ? 'done' : 'pending'],
    ['Data room ready', src.contact?.deal_access?.data_room_ready ? 'done' : 'pending'],
  ];

  // Task #28 — prefer the project's Cap-Table Simulator segments (fully-diluted
  // ledger) over the standalone holders table; fall back to holders, then the
  // neutral placeholder. The readiness checklist above stays tied to holders.
  let segments: Array<[string, number]>;
  const simSegments = (src.cap_table?.sim_segments || [])
    .map((s) => [s[0], pctNum(s[1])] as [string, number])
    .filter((s) => has(s[0]) && s[1] > 0)
    .slice(0, 6);
  const realSegments = holders
    .map((h) => [h.name, pctNum(h.ownership_pct)] as [string, number])
    .filter((s) => has(s[0]) && s[1] > 0)
    .slice(0, 6);
  if (simSegments.length) segments = simSegments;
  else if (realSegments.length) segments = realSegments;
  else { segments = FALLBACK.segments; gap('Cap table: add holders in the Incorporate / Cap Table module.', null, 'captable'); }

  const captable: SpinoutDeckData['captable'] = {
    eyebrow: 'Cap table & incorporation', idx: '09',
    title: has(src.cap_table?.headline) ? src.cap_table.headline : 'Entity-ready: clean cap table and founder setup.',
    checklistLabel: 'FOUNDER & ENTITY SETUP',
    items,
    donutLabel: 'CAP TABLE · FULLY DILUTED',
    centerBig: '100%', centerSmall: 'fully diluted',
    segments,
  };

  /* ---- ask ---- */
  const ak = src.ask || ({} as SpinoutDemoDayData['ask']);
  const useOfFunds = (ak.use_of_funds || []).filter((u) => has(u.label));
  const nextMilestones = (ak.next_milestones || []).filter(has);
  const askEmpty = !has(ak.raise_amount) && !has(ak.runway) && useOfFunds.length === 0;

  const kpis: Array<[string, string]> = [
    [has(ak.raise_amount) ? ak.raise_amount : DASH, 'Target raise'],
    ['SAFE', 'Instrument'],
    [has(ak.runway) ? ak.runway : DASH, 'Runway'],
    ['Pre-seed', 'Stage'],
  ];

  let funds: Array<[string, number]>;
  if (useOfFunds.length) funds = useOfFunds.slice(0, 5).map((u) => [u.label, clamp(Math.round(Number(u.pct) || 0), 0, 100)] as [string, number]);
  else funds = FALLBACK.funds;

  let milestone: [string, string];
  if (nextMilestones.length) milestone = ['Gets us to:', nextMilestones[0]];
  else milestone = ['Gets us to:', '[draft — add your next funding milestone in the Capital module]'];

  if (askEmpty) gap('The ask: set raise, runway, and use-of-funds in the Capital module.', null, 'ask');
  else if (!nextMilestones.length) gap('The ask: add your next funding milestone in the Capital module.', null, 'ask');

  const ask: SpinoutDeckData['ask'] = {
    eyebrow: 'The ask', idx: '10',
    title: has(ak.headline) ? ak.headline : (has(ak.raise_amount) ? `Raising ${ak.raise_amount} to reach the next milestone.` : 'Raising a pre-seed round to reach revenue.'),
    kpis,
    useLabel: 'USE OF FUNDS',
    funds,
    milestone,
  };

  /* ---- deal readiness ---- */
  const da = src.contact?.deal_access || ({} as NonNullable<SpinoutDemoDayData['contact']>['deal_access']);
  const contactEmail = has(m.contact_email) ? m.contact_email : (has(src.contact?.contact_email) ? src.contact.contact_email : '');
  const ready: Array<[string, string]> = [
    ['Data room', da.data_room_ready ? 'Open' : 'Pending'],
    ['Financial model', 'On request'],
    ['Cap table & legal docs', holders.length ? 'Included' : 'Pending'],
    ['Customer references', interviewN > 0 ? 'On request' : 'Pending'],
    ['NDA', da.nda_required ? 'Required' : 'Not required'],
  ];
  if (!has(contactEmail)) gap('Review the deal: add a contact email / deal-room link in the Compliance module.', null, 'deal');

  const deal: SpinoutDeckData['deal'] = {
    eyebrow: 'Deal readiness', idx: '11',
    title: has(src.contact?.headline) ? src.contact.headline : 'Data room open. Ready to move.',
    diligenceLabel: 'DILIGENCE PACKAGE',
    ready,
    nextLabel: 'NEXT STEPS',
    steps: [
      ['1', '30-minute intro call'],
      ['2', 'Data room access granted same day'],
      ['3', has(da.cta_label) ? da.cta_label : 'SAFE \u2014 target close in weeks'],
    ],
    closingLine: has(src.contact?.signoff) ? src.contact.signoff : 'Open to diligence and intros this week.',
    contact: has(contactEmail) ? `${contactEmail}   ·   axal.vc` : 'axal.vc',
  };

  const data: SpinoutDeckData = {
    brand, cover, problem, validation, market, solution, productDemo, roadmap, team, captable, ask, deal,
  };

  const draft = programDay < PROGRAM_DAYS || gaps.length > 0;
  const fields = flattenSpinoutDeckData(data);
  return { data, notes: NOTES, gaps, gapFields, gapSections, draft, programDay, fields };
}

/* ============================================================================
 *  Task #55 — flatten SpinoutDeckData → dotted-key field map.
 *
 *  `hydrate()` in axal_spinout_demoday_app.tsx expects:
 *    - scalar narrative fields  → key = dotted path, value = string
 *    - structured viz fields    → key = dotted path + `_json`, value = JSON
 *
 *  We walk the nested SpinoutDeckData shape and emit exactly those keys.
 *  Scalar strings that are empty or the DASH placeholder are skipped (honest
 *  gaps — the editor falls back to sample data). Arrays and objects are always
 *  emitted (even if empty) because the slide rendering needs them to exist.
 * ========================================================================== */
export function flattenSpinoutDeckData(data: SpinoutDeckData): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (prefix: string, value: unknown): void => {
    if (value === undefined || value === null) return;
    if (typeof value === 'string') {
      if (has(value)) out[prefix] = value;
      return;
    }
    if (Array.isArray(value)) {
      out[`${prefix}_json`] = JSON.stringify(value);
      return;
    }
    if (typeof value === 'object') {
      // nested object (e.g. cover.founder, brand) — recurse with dotted path
      for (const [k, v] of Object.entries(value)) {
        if (FORBIDDEN_KEYS.has(k)) continue;
        walk(`${prefix}.${k}`, v);
      }
      return;
    }
    // primitives (number, boolean) — stringify
    out[prefix] = String(value);
  };

  const FORBIDDEN_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

  for (const [section, sectionData] of Object.entries(data)) {
    if (!SECTIONS.has(section)) continue;
    if (FORBIDDEN_KEYS.has(section)) continue;
    if (sectionData === undefined || sectionData === null) continue;
    walk(section, sectionData);
  }

  return out;
}

const SECTIONS = new Set([
  'brand', 'cover', 'problem', 'validation', 'market', 'solution',
  'productDemo', 'roadmap', 'team', 'captable', 'ask', 'deal',
]);

/* ============================================================================
 *  assembleSpinoutDeckData — env wrapper: fill from D1, then remap.
 * ========================================================================== */
export async function assembleSpinoutDeckData(
  env: Env,
  userId: number,
  projectId: number,
): Promise<SpinoutDeckBundle> {
  const src = await fillAxalSpinoutDemoDay(env, userId, projectId);
  return mapToSpinoutDeckData(src);
}
