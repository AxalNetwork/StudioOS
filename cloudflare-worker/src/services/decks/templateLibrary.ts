/**
 * #3876 (deck v2, the content half of B6 #3782, D1535) — HQ's 24 Gallery
 * templates, composed from the issue's house rules and its TPL-01..24
 * prompts. Each one is a `deck_template/1` object (the issue's H14 shape):
 * structure, theme and decor with bracketed placeholders, never a venture's
 * words or figures.
 *
 * WHY COMPOSED, NOT 24 HAND-WRITTEN FILES. The prompts share almost
 * everything: the layouts' areas (H3), each card's default words and
 * bindings (H8), the order rule (H7), the eight swatches (H10) and the decor
 * placement rule (H2, H11). What differs is short: a template's tags,
 * swatch, accent, fonts, decor, art and its card list with a few area
 * overrides. So each template is one `Spec` below, transcribed from its
 * prompt, and `compose` expands it by the rules. The seed test
 * (`deck_template_library_3876.test.ts`) holds every expanded template to the
 * issue's tests and to the one-click bar (`templateProblems`, `themeProblems`
 * and `fitProblems` all `[]`; `deckRubric` at least 80 once applied).
 *
 * DECIDED SINCE THE PROMPTS (S1, 2026-11-02, and the code):
 *   · Audience tags are New deck's seven (`AUDIENCES`), not the canvas's
 *     three; every stage covers all seven, so the pick never comes back
 *     empty. `deck_audience` drives the order (H7).
 *   · A model is picked per element group, not per kind: each area names its
 *     rail group (`RAIL_GROUP`), text → Text, chart → Data, image → Images,
 *     diagram → Diagrams, records → Venture records. Records and founder
 *     areas call no model. Every text, chart and image area offers "Ask",
 *     never "Fill".
 *   · A diagram in a six-column area holds at most three steps
 *     (`fitProblems`), so the prompts' four-step integration flow and cycle
 *     are three steps, and the competition matrix (exactly four quadrants)
 *     is a three-step flow from the workaround to the change.
 *   · The 24 replace v1's 13 methods as the Gallery's tiles (Q5); the
 *     methods stay in New deck as "Use this method".
 *
 * REVIEW. `provenance.reviewed_by` is null until a designer or the owner
 * reviews a template (B6's gate); the Gallery shows them meanwhile because
 * the one-click bar is met by code.
 *
 * Pure: no binding, no model.
 */
import { CARD_CATALOGUE } from './newDeck';
import { ATTESTATION, CONTRACT, type Stage } from './templates';

// ── H10: swatches ───────────────────────────────────────────────────────────

type Palette = { ground: string; surface: string; ink: string; muted: string; hairline: string; positive: string; negative: string; chart: string[]; kind: 'neutral_light' | 'neutral_dark' };
const LIGHT = ['#1F4E79', '#B04A22', '#2F6B3E', '#6B3F8F', '#7A5C12', '#9B2C4A'];
const DARK = ['#F2C14E', '#7CC6E0', '#F4A07F', '#9FD48F', '#CDB2F0', '#F7F4EE'];
const BLUSH = ['#1F4E79', '#9A3F1C', '#2F6B3E', '#5E3780', '#6B500F', '#8A2442'];
const SAGE = ['#1F4E79', '#9A3F1C', '#245C33', '#5E3780', '#6B500F', '#8A2442'];
export const SWATCH_PALETTES: Record<string, Palette> = {
  cream: { ground: '#F4EDE0', surface: '#FBF7EF', ink: '#1F1B16', muted: '#5C5246', hairline: '#D8CDBB', positive: '#2E6B3F', negative: '#A2362B', chart: LIGHT, kind: 'neutral_light' },
  white: { ground: '#FFFFFF', surface: '#F4F5F7', ink: '#111418', muted: '#545B66', hairline: '#E1E4E8', positive: '#23703F', negative: '#B3261E', chart: LIGHT, kind: 'neutral_light' },
  near_black: { ground: '#121212', surface: '#1F1F1F', ink: '#F4F2EE', muted: '#B3AFA8', hairline: '#363636', positive: '#8FD19E', negative: '#FF8A80', chart: DARK, kind: 'neutral_dark' },
  blush: { ground: '#F6E3DD', surface: '#FBF1EE', ink: '#2A1A1A', muted: '#6A4B46', hairline: '#E2C6BE', positive: '#2E6B3F', negative: '#9E2B2B', chart: BLUSH, kind: 'neutral_light' },
  navy: { ground: '#14213D', surface: '#1C2C4F', ink: '#F5F3EE', muted: '#B9C1D1', hairline: '#2F4066', positive: '#8FD19E', negative: '#FF9A8F', chart: DARK, kind: 'neutral_dark' },
  sage: { ground: '#E3E9DD', surface: '#EFF3EA', ink: '#1B2318', muted: '#4C5848', hairline: '#C4CEBC', positive: '#245C33', negative: '#9E2B2B', chart: SAGE, kind: 'neutral_light' },
  ivory: { ground: '#FAF6EB', surface: '#FFFDF7', ink: '#22201B', muted: '#5D574B', hairline: '#E3DAC6', positive: '#2E6B3F', negative: '#A2362B', chart: LIGHT, kind: 'neutral_light' },
  white_rule: { ground: '#FFFFFF', surface: '#FAFAFA', ink: '#141414', muted: '#575757', hairline: '#BDBDBD', positive: '#23703F', negative: '#B3261E', chart: LIGHT, kind: 'neutral_light' },
};

// ── H9 / Q2: fonts, each under an open licence, each display face with a 700 weight ──

/** Every family a template names, its licence (Google Fonts METADATA.pb) and whether it ships weight 700. */
export const FONT_LICENCES: Record<string, { licence: 'OFL-1.1' | 'Apache-2.0'; bold700: boolean }> = {
  Inter: { licence: 'OFL-1.1', bold700: true }, 'Space Grotesk': { licence: 'OFL-1.1', bold700: true }, 'Roboto Mono': { licence: 'Apache-2.0', bold700: true },
  'IBM Plex Mono': { licence: 'OFL-1.1', bold700: true }, 'JetBrains Mono': { licence: 'OFL-1.1', bold700: true },
  Fraunces: { licence: 'OFL-1.1', bold700: true }, Newsreader: { licence: 'OFL-1.1', bold700: true }, Archivo: { licence: 'OFL-1.1', bold700: true },
  'Bricolage Grotesque': { licence: 'OFL-1.1', bold700: true }, 'DM Sans': { licence: 'OFL-1.1', bold700: true }, Lora: { licence: 'OFL-1.1', bold700: true },
  'Playfair Display': { licence: 'OFL-1.1', bold700: true }, 'Source Sans 3': { licence: 'OFL-1.1', bold700: true }, Syne: { licence: 'OFL-1.1', bold700: true },
  Manrope: { licence: 'OFL-1.1', bold700: true }, 'Source Serif 4': { licence: 'OFL-1.1', bold700: true }, 'Libre Caslon Text': { licence: 'OFL-1.1', bold700: true },
  'Familjen Grotesk': { licence: 'OFL-1.1', bold700: true }, Oswald: { licence: 'OFL-1.1', bold700: true }, 'IBM Plex Sans': { licence: 'OFL-1.1', bold700: true },
  'Work Sans': { licence: 'OFL-1.1', bold700: true }, Literata: { licence: 'OFL-1.1', bold700: true }, 'Cormorant Garamond': { licence: 'OFL-1.1', bold700: true },
  'Hanken Grotesk': { licence: 'OFL-1.1', bold700: true }, Unbounded: { licence: 'OFL-1.1', bold700: true }, 'Public Sans': { licence: 'OFL-1.1', bold700: true },
};
export const FALLBACK_FONTS = Object.freeze({ display: 'Space Grotesk', body: 'Inter', mono: 'Roboto Mono' });
/** Wide display faces: their placeholders keep within 60% of a budget (H9). */
export const WIDE_DISPLAY = Object.freeze(['Syne', 'Unbounded']);

// ── H3: the layouts' areas, in their preset order ───────────────────────────

type G = { c1: number; c2: number; r1: number; r2: number };
const g = (c1: number, c2: number, r1: number, r2: number): G => ({ c1, c2, r1, r2 });
/** Each layout's areas: id, range and the preset block's kind and style (`slideModel.LAYOUTS`). */
export const LAYOUT_AREAS: Record<string, Array<{ id: string; grid: G; kind: 'text' | 'metric' | 'chart' | 'image'; style?: 'heading' | 'paragraph' | 'list'; chart?: string }>> = {
  title: [{ id: 'T', grid: g(1, 12, 2, 3), kind: 'text', style: 'heading' }, { id: 'S', grid: g(1, 12, 4, 4), kind: 'text', style: 'paragraph' }],
  statement: [{ id: 'S', grid: g(2, 11, 2, 5), kind: 'text', style: 'heading' }],
  two_columns: [{ id: 'H', grid: g(1, 12, 1, 1), kind: 'text', style: 'heading' }, { id: 'L', grid: g(1, 6, 2, 6), kind: 'text', style: 'paragraph' }, { id: 'R', grid: g(7, 12, 2, 6), kind: 'text', style: 'paragraph' }],
  metric_tiles: [
    { id: 'H', grid: g(1, 12, 1, 1), kind: 'text', style: 'heading' },
    { id: 'M1', grid: g(1, 3, 2, 4), kind: 'metric' }, { id: 'M2', grid: g(4, 6, 2, 4), kind: 'metric' },
    { id: 'M3', grid: g(7, 9, 2, 4), kind: 'metric' }, { id: 'M4', grid: g(10, 12, 2, 4), kind: 'metric' },
    { id: 'P', grid: g(1, 12, 5, 6), kind: 'text', style: 'paragraph' },
  ],
  chart_text: [{ id: 'H', grid: g(1, 12, 1, 1), kind: 'text', style: 'heading' }, { id: 'C', grid: g(1, 8, 2, 6), kind: 'chart', chart: 'line' }, { id: 'L', grid: g(9, 12, 2, 6), kind: 'text', style: 'list' }],
  timeline: [{ id: 'H', grid: g(1, 12, 1, 1), kind: 'text', style: 'heading' }, { id: 'C', grid: g(1, 12, 2, 5), kind: 'chart', chart: 'timeline' }, { id: 'P', grid: g(1, 12, 6, 6), kind: 'text', style: 'paragraph' }],
  team_grid: [
    { id: 'H', grid: g(1, 12, 1, 1), kind: 'text', style: 'heading' },
    { id: 'I1', grid: g(1, 3, 2, 4), kind: 'image' }, { id: 'I2', grid: g(4, 6, 2, 4), kind: 'image' }, { id: 'I3', grid: g(7, 9, 2, 4), kind: 'image' }, { id: 'I4', grid: g(10, 12, 2, 4), kind: 'image' },
    { id: 'N1', grid: g(1, 3, 5, 6), kind: 'text', style: 'paragraph' }, { id: 'N2', grid: g(4, 6, 5, 6), kind: 'text', style: 'paragraph' },
    { id: 'N3', grid: g(7, 9, 5, 6), kind: 'text', style: 'paragraph' }, { id: 'N4', grid: g(10, 12, 5, 6), kind: 'text', style: 'paragraph' },
  ],
  quote: [{ id: 'Q', grid: g(2, 11, 2, 4), kind: 'text', style: 'heading' }, { id: 'A', grid: g(2, 11, 5, 5), kind: 'text', style: 'paragraph' }],
  comparison_table: [{ id: 'H', grid: g(1, 12, 1, 1), kind: 'text', style: 'heading' }, { id: 'C', grid: g(1, 12, 2, 6), kind: 'chart', chart: 'comparison_table' }],
  image_text: [{ id: 'I', grid: g(1, 6, 1, 6), kind: 'image' }, { id: 'H', grid: g(7, 12, 1, 1), kind: 'text', style: 'heading' }, { id: 'P', grid: g(7, 12, 2, 6), kind: 'text', style: 'paragraph' }],
  appendix_table: [{ id: 'H', grid: g(1, 12, 1, 1), kind: 'text', style: 'heading' }, { id: 'L', grid: g(1, 12, 2, 6), kind: 'text', style: 'list' }],
};

// ── Area specs ──────────────────────────────────────────────────────────────

type AreaSpec =
  | { t: 'text'; text: string; key?: string }
  | { t: 'list'; items: string[]; key?: string }
  | { t: 'metric'; label: string; key: string }
  | { t: 'chart'; type?: string; series: Array<[string, string]> }
  | { t: 'art' }
  | { t: 'shot'; alt?: string }
  | { t: 'photo'; alt?: string }
  | { t: 'diagram'; type: 'flow' | 'cycle' | 'timeline'; items: string[] }
  | { t: 'founder_quote'; text: string };
type Areas = Record<string, AreaSpec>;

const T = (text: string, key?: string): AreaSpec => ({ t: 'text', text, ...(key ? { key } : {}) });
const LIST = (...items: string[]): AreaSpec => ({ t: 'list', items });
const M = (label: string, key: string): AreaSpec => ({ t: 'metric', label, key });
const CH = (type: string | undefined, ...series: Array<[string, string]>): AreaSpec => ({ t: 'chart', ...(type ? { type } : {}), series });
const ART: AreaSpec = { t: 'art' };
const SHOT: AreaSpec = { t: 'shot' };
const DIAG = (type: 'flow' | 'cycle', ...items: string[]): AreaSpec => ({ t: 'diagram', type, items });

// H8 macros, three steps each (a six-column area holds at most three).
const INTEGRATION = DIAG('flow', '[Partner system]', '[Integration point]', '[Shared customer outcome]');
const FLOW = DIAG('flow', '[Today]', '[First step]', '[Outcome]');
const CYCLE = DIAG('cycle', '[Customer joins]', '[Value delivered]', '[Customer renews]');
/** The competition matrix, as three steps: a matrix holds exactly four and a six-column area at most three. */
const MATRIX = DIAG('flow', '[The workaround]', '[What it costs them]', '[What we change]');
const TERMS: Areas = { M4: T('[Partnership terms]'), P: T('[Pilot scope], [Commercial terms], [Exclusivity]') };

/** H8: each card's default areas, by layout. */
function defaults(card: string, layout: string): Areas {
  const k = `${card}·${layout}`;
  switch (k) {
    case 'title·title': return { T: T('[Venture name]'), S: T('[One-line pitch]') };
    case 'problem·statement': return { S: T('[The pain, said plainly]', 'validate.top_pain') };
    case 'problem·quote': return { Q: { t: 'founder_quote', text: '[The pain, in a customer’s words]' }, A: T('[Customer role], [Customer segment]') };
    case 'why_now·statement': return { S: T('[What changed that makes this the moment]') };
    case 'solution·image_text': return { H: T('[What it does]'), P: T('[How it removes the pain]', 'build.must_haves') };
    case 'solution·two_columns': return { H: T('[What it does]'), L: T('[How it removes the pain]'), R: LIST('[What the customer gets]') };
    case 'solution·statement': return { S: T('[What the product does about the pain]') };
    case 'traction·metric_tiles': return { H: T('[Growth so far]'), M1: M('[MRR]', 'grow.mrr'), M2: M('[Paying customers]', 'grow.paying_customers'), M3: M('[Revenue growth]', 'grow.mercury_growth'), M4: M('[ARR]', 'grow.arr'), P: T('[What drove it]') };
    case 'traction·chart_text': return { H: T('[Growth so far]'), C: CH('line', ['[MRR]', 'grow.mrr'], ['[Paying customers]', 'grow.paying_customers']), L: LIST('[What drove it]') };
    case 'traction·statement': return { S: T('[Growth so far, in one line]') };
    case 'validation·metric_tiles': return { H: T('[What customers told us]'), M1: M('[Interviews]', 'validate.interviews'), M2: M('[Strong-fit customers]', 'validate.strong_fit'), M3: M('[Letters of intent]', 'validate.lois'), M4: M('[Claims validated]', 'validate.claims_validated'), P: T('[What we heard most]') };
    case 'validation·chart_text': return { H: T('[What customers told us]'), C: CH('ranked_bars', ['[Interviews]', 'validate.interviews'], ['[Strong-fit customers]', 'validate.strong_fit'], ['[Letters of intent]', 'validate.lois']), L: LIST('[What we heard most]') };
    case 'product·image_text': return { I: SHOT, H: T('[The product]'), P: T('[What a user does first]') };
    case 'product·metric_tiles': return { H: T('[The product]'), M1: M('[Must-haves shipped]', 'build.must_haves'), M2: M('[Recent releases]', 'build.releases_90d'), M3: M('[Recent commits]', 'build.commits_90d'), M4: T('[What a user does first]'), P: T('[What ships next]') };
    case 'product·two_columns': return { H: T('[The product]'), L: T('[What ships first]', 'build.must_haves'), R: LIST('[What shipped recently]') };
    case 'market·comparison_table': return { H: T('[Who needs this most]'), C: CH('comparison_table', ['[Demand signals]', 'validate.demand'], ['[Alternatives]', 'validate.competitors']) };
    case 'market·statement': return { S: T('[Who needs this most, and why now]', 'validate.demand') };
    case 'competition·comparison_table': return { H: T('[How customers cope today]'), C: CH('comparison_table', ['[Alternatives]', 'validate.competitors']) };
    case 'competition·two_columns': return { H: T('[How customers cope today]'), L: T('[The workaround and its cost]'), R: MATRIX };
    case 'unit_economics·metric_tiles': return { H: T('[How the business runs]'), M1: M('[Net burn]', 'grow.net_burn'), M2: M('[Runway]', 'grow.runway'), M3: M('[Churn]', 'grow.churn'), M4: M('[Revenue]', 'grow.mercury_revenue'), P: T('[How efficiency improves]') };
    case 'unit_economics·chart_text': return { H: T('[How the business runs]'), C: CH('line', ['[Revenue]', 'grow.mercury_revenue'], ['[Net burn]', 'grow.net_burn']), L: LIST('[How efficiency improves]') };
    case 'team·team_grid': return { H: T('[Why us]'), I1: { t: 'photo' }, I2: { t: 'photo' }, I3: { t: 'photo' }, I4: { t: 'photo' },
      N1: T('[Founder name], [Role]'), N2: T('[Founder name], [Role]'), N3: T('[Founder name], [Role]'), N4: T('[Founder name], [Role]') };
    case 'team·two_columns': return { H: T('[Why us]'), L: T('[The founders and their story]'), R: { t: 'list', items: ['[What we bring]'], key: 'team.skills' } };
    case 'roadmap·timeline': return { H: T('[Where this goes next]'), C: CH('timeline', ['[Roadmap]', 'build.roadmap']), P: T('[The next milestone and what it proves]') };
    case 'round·metric_tiles': return { H: T('[The round]'), M1: M('[Round target]', 'raise.round_target'), M2: M('[Instrument]', 'raise.round_terms'), M3: M('[Target close]', 'raise.round_close'), M4: M('[Runway]', 'grow.runway'), P: T('[What this round proves]') };
    case 'round·statement': return { S: T('[The ask and what it proves]') };
    case 'use_of_funds·timeline': return { H: T('[Where the money goes]'), C: CH('timeline', ['[Use of funds]', 'raise.use_of_funds']), P: T('[The milestone it buys]') };
    case 'use_of_funds·two_columns': return { H: T('[Where the money goes]'), L: { t: 'list', items: ['[Use of funds]'], key: 'raise.use_of_funds' }, R: T('[The milestone it buys]') };
    case 'use_of_funds·statement': return { S: T('[Where the money goes, and what it buys]') };
    case 'cap_table·metric_tiles': return { H: T('[Who holds the company]'), M1: M('[Cap table]', 'raise.cap_table'), M2: M('[Vesting]', 'raise.vesting'), M3: M('[Founders]', 'team.founders'), M4: T('[What changes after the round]'), P: T('[How ownership moves]') };
    case 'cap_table·statement': return { S: T('[Who holds the company today]', 'raise.cap_table') };
    case 'every_figure·appendix_table': return { H: T('[Every figure]'), L: LIST('[Every figure, its source and grade]') };
    default: throw new Error(`no H8 default for ${k}`);
  }
}

/** H8's overlays: strategic decks and Series B+ decks reword a few headings. */
function overlay(card: string, layout: string, deckAudience: string, stage: Stage): Areas {
  const o: Areas = {};
  if (deckAudience === 'strategic') {
    if (card === 'why_now' && layout === 'statement') o.S = T('[Why this partnership, now]');
    if (card === 'solution' && layout !== 'statement') o.H = T('[The joint offer]');
    if (card === 'market' && layout === 'comparison_table') o.H = T('[Where our customers overlap]');
    if (card === 'product' && layout === 'two_columns') o.R = INTEGRATION;
    if (card === 'round' && layout === 'metric_tiles') Object.assign(o, TERMS);
  }
  if (stage === 'series_b_plus') {
    if (card === 'market' && layout === 'comparison_table') o.H = T('[Where we expand next]');
    if (card === 'roadmap') o.H = T('[Expansion milestones]');
    if (card === 'unit_economics' && layout !== 'statement') o.H = T('[Efficiency at scale]');
  }
  return o;
}

// ── H13: speaker notes, and each card's message ─────────────────────────────

const NOTES: Record<string, string> = {
  title: '[Say the name, then the one line.] [Pause before the problem.]',
  problem: '[Open with who said it.] [Then name what the pain costs them.]',
  why_now: '[Name the change.] [Say why it was not possible before.]',
  solution: '[Show how the pain goes away.] [Keep it to the first use.]',
  traction: '[Read the line, not every figure.] [Name what drove the growth.]',
  validation: '[Say who you spoke to.] [Name the signal you trust most.]',
  product: '[Show what a user does first.]',
  market: '[Say who needs this first.] [Show the demand you have seen.]',
  competition: '[Name how customers cope today.] [Say what you change.]',
  unit_economics: '[Say how the business runs.] [Name what improves next.]',
  roadmap: '[Name the next milestone.] [Say what it proves.]',
  team: '[Say why this team, for this problem.]',
  round: '[Say the ask plainly.] [Name what it proves.]',
  use_of_funds: '[Tie each use to a milestone.]',
  cap_table: '[Say who holds the company.] [Name what changes after the round.]',
  every_figure: '[Point to any figure’s source.]',
  closing: '[Close on the ask.] [Say how to reach you.]',
  business_model: '[Say who pays and why they keep paying.]',
  gtm: '[Name the first channel and why it works.]',
};
const MESSAGES: Record<string, string> = {
  title: '[What the venture does, in one line]', problem: '[The pain, in the customer’s words]', why_now: '[Why this is the moment]',
  solution: '[How the pain goes away]', traction: '[The growth the records show]', validation: '[What customers confirmed]',
  product: '[What a user does first]', market: '[Who needs this most]', competition: '[How customers cope, and what we change]',
  unit_economics: '[How the business runs]', roadmap: '[The next milestone and what it proves]', team: '[Why this team]',
  round: '[The ask and what it proves]', use_of_funds: '[What the money buys]', cap_table: '[Who holds the company]',
  every_figure: '[Each figure with its source and grade]', closing: '[The ask, and how to reach us]',
  business_model: '[Who pays, and why they stay]', gtm: '[How customers find us]',
};

// ── H7: order ───────────────────────────────────────────────────────────────

export const BASE_ORDER = ['title', 'problem', 'why_now', 'solution', 'traction', 'validation', 'product', 'market', 'competition', 'unit_economics', 'roadmap', 'team', 'round', 'use_of_funds', 'cap_table', 'every_figure'] as const;
export const LEAD_CARDS: Record<string, string[]> = {
  angel: ['problem', 'team', 'solution'], pre_seed_fund: ['problem', 'team', 'solution'], seed_fund: ['problem', 'traction', 'solution'],
  series_a_fund: ['traction', 'unit_economics', 'market'], strategic: ['product', 'market', 'solution'],
};
/** H7: BASE restricted to the cards, then the audience's lead cards moved to just after title. */
export function orderFor(cards: readonly string[], deckAudience: string): string[] {
  const set = new Set(cards);
  const base = BASE_ORDER.filter((c) => set.has(c));
  const lead = (LEAD_CARDS[deckAudience] ?? []).filter((c) => set.has(c));
  return [base[0], ...lead, ...base.slice(1).filter((c) => !lead.includes(c))];
}
export const STANDARD_TWELVE = ['title', 'problem', 'why_now', 'solution', 'traction', 'validation', 'product', 'market', 'unit_economics', 'team', 'round', 'use_of_funds'];
/** H7's pending cards per stage: kept aside until the catalogue has them (Q6 deferred). */
const PENDING: Record<Stage, Array<{ card: string; layout: string }>> = {
  pre_seed: [{ card: 'closing', layout: 'statement' }],
  seed: [{ card: 'business_model', layout: 'two_columns' }, { card: 'closing', layout: 'statement' }],
  series_a: [{ card: 'business_model', layout: 'two_columns' }, { card: 'gtm', layout: 'timeline' }, { card: 'closing', layout: 'statement' }],
  series_b_plus: [{ card: 'gtm', layout: 'timeline' }, { card: 'closing', layout: 'statement' }],
};
const PENDING_AREAS: Record<string, Areas> = {
  closing: { S: T('[The ask, and how to reach us]') },
  business_model: { H: T('[How we make money]'), L: T('[Who pays, and for what]'), R: LIST('[Why they keep paying]') },
  gtm: { H: T('[How customers find us]'), C: CH('timeline', ['[Go-to-market]', 'build.roadmap']), P: T('[The first channel, and why it works]') },
};

// ── The rail groups (spec change 3) ─────────────────────────────────────────

export const RAIL_GROUP: Record<string, string> = { text: 'text', chart: 'data', image: 'images', records: 'venture', founder: 'venture', diagram: 'diagrams' };

// ── A template's own spec, transcribed from its prompt ──────────────────────

type DecorRule =
  | { kind: 'divider'; ref: string; tone: string; where: 'headings' | 'gutter' }
  | { kind: 'texture'; ref: string; tone: string; cards: string[] }
  | { kind: 'icon'; ref: string; tone: string; cards: string[] }
  | { kind: 'shape'; ref: string; tone: string; cards: string[] }
  | { kind: 'bar'; tone: string; cards: 'statements' };
type CardLine = [card: string, layout: string, areas?: Areas];
type Spec = {
  n: string; name: string; stage: Stage; audience: string[]; deck_audience: string; style: 'editorial' | 'bold' | 'minimal';
  swatch: string; accent: string; accent_ink: string; fonts: [string, string, string]; ratio: number;
  surface: 'flat' | 'card' | 'outlined'; radius: number; image_radius: number; decor_style: string;
  decor: DecorRule[]; chrome: { slide_number: 'bottom_right'; footer_rule: boolean; venture_mark: 'top_left' | 'bottom_left' | 'none'; section_label: boolean };
  art: 'line' | 'isometric' | 'flat' | 'scene' | 'diagram'; image?: { card: string; prompt: string };
  description: string; cards: CardLine[];
};

const ch = (slide_number: 'bottom_right', footer_rule: boolean, venture_mark: 'top_left' | 'bottom_left' | 'none', section_label = false) => ({ slide_number, footer_rule, venture_mark, section_label });
const UNDER = (tone = 'muted', ref = 'line'): DecorRule => ({ kind: 'divider', ref, tone, where: 'headings' });

export const SPECS: readonly Spec[] = [
  // ── Pre-seed ──
  {
    n: '01', name: 'Pencil Margins', stage: 'pre_seed', audience: ['angel', 'pre_seed_fund'], deck_audience: 'angel', style: 'editorial',
    swatch: 'cream', accent: '#B5452A', accent_ink: '#FFFFFF', fonts: ['Fraunces', 'Inter', 'IBM Plex Mono'], ratio: 1.333, surface: 'flat', radius: 0, image_radius: 0, decor_style: 'annotated',
    decor: [UNDER(), { kind: 'divider', ref: 'accent', tone: 'accent', where: 'gutter' }, { kind: 'texture', ref: 'noise', tone: 'muted', cards: ['title', 'why_now'] }],
    chrome: ch('bottom_right', true, 'top_left'), art: 'line',
    image: { card: 'solution', prompt: 'Single continuous line drawing of a tangle of loose notes resolving into one neatly folded page, terracotta line on warm cream, wide empty margins, no text, no people, no logos' },
    description: 'An annotated founder’s letter on cream: the team’s earned insight comes third, ruled in terracotta.',
    cards: [
      ['title', 'title'], ['problem', 'quote'], ['team', 'two_columns', { R: LIST('[Earned insight]', '[Relevant past work]', '[What we have already built]') }],
      ['solution', 'image_text', { I: ART }], ['why_now', 'statement'], ['validation', 'chart_text'], ['product', 'two_columns', { R: FLOW }],
      ['market', 'comparison_table'], ['competition', 'two_columns', { R: MATRIX }], ['roadmap', 'timeline'], ['round', 'metric_tiles'], ['use_of_funds', 'two_columns'],
    ],
  },
  {
    n: '02', name: 'Field Letter', stage: 'pre_seed', audience: ['strategic', 'grant'], deck_audience: 'strategic', style: 'editorial',
    swatch: 'ivory', accent: '#1E4D5C', accent_ink: '#FFFFFF', fonts: ['Newsreader', 'Inter', 'IBM Plex Mono'], ratio: 1.333, surface: 'outlined', radius: 2, image_radius: 2, decor_style: 'field notes',
    decor: [UNDER(), { kind: 'icon', ref: 'compass', tone: 'accent', cards: ['title', 'why_now'] }],
    chrome: ch('bottom_right', true, 'top_left', true), art: 'diagram',
    image: { card: 'solution', prompt: 'Clean technical illustration of a pair of modules sliding together on a drafting grid, deep teal lines on ivory, precise and airy, no text, no people, no logos' },
    description: 'A field letter to a partner: the integration first, pilot evidence in tiles and partnership terms on the ask.',
    cards: [
      ['title', 'title', { S: T('[What we could build together]') }], ['product', 'two_columns', { R: INTEGRATION }], ['market', 'comparison_table'],
      ['solution', 'image_text', { I: ART }], ['problem', 'statement'], ['why_now', 'statement'], ['validation', 'metric_tiles', { P: T('[What a pilot would test]') }],
      ['competition', 'comparison_table', { H: T('[Alternatives the partner could choose]') }], ['roadmap', 'timeline', { H: T('[Pilot to integration]'), P: T('[The partner’s decision point]') }],
      ['team', 'two_columns', { R: LIST('[Partnership experience]') }], ['round', 'metric_tiles', TERMS], ['use_of_funds', 'two_columns', { R: T('[Integration work this covers]') }],
    ],
  },
  {
    n: '03', name: 'Lantern Ridge', stage: 'pre_seed', audience: ['pre_seed_fund', 'seed_fund', 'series_a_fund'], deck_audience: 'pre_seed_fund', style: 'bold',
    swatch: 'near_black', accent: '#F2C14E', accent_ink: '#121212', fonts: ['Archivo', 'Inter', 'JetBrains Mono'], ratio: 1.5, surface: 'card', radius: 12, image_radius: 12, decor_style: 'beacon',
    decor: [{ kind: 'bar', tone: 'accent', cards: 'statements' }, { kind: 'shape', ref: 'circle', tone: 'accent', cards: ['title'] }, { kind: 'icon', ref: 'lamp', tone: 'accent', cards: ['why_now'] }],
    chrome: ch('bottom_right', false, 'bottom_left'), art: 'flat',
    image: { card: 'solution', prompt: 'Flat illustration of a single bright lantern on a dark ridge with paths converging toward it, warm yellow on near-black, bold simple shapes, no text, no people, no logos' },
    description: 'Black and yellow at display size: statements carry the story, the founders come third and the evidence is a funnel.',
    cards: [
      ['title', 'title'], ['problem', 'statement'], ['team', 'team_grid'], ['solution', 'image_text', { I: ART }], ['why_now', 'statement'],
      ['validation', 'chart_text', { C: CH('funnel', ['[Interviews]', 'validate.interviews'], ['[Strong-fit customers]', 'validate.strong_fit'], ['[Letters of intent]', 'validate.lois']) }],
      ['product', 'metric_tiles'], ['market', 'statement'], ['competition', 'comparison_table'], ['round', 'metric_tiles'], ['use_of_funds', 'timeline'],
    ],
  },
  {
    n: '04', name: 'Shared Bench', stage: 'pre_seed', audience: ['strategic'], deck_audience: 'strategic', style: 'bold',
    swatch: 'blush', accent: '#8E2F3C', accent_ink: '#FFFFFF', fonts: ['Bricolage Grotesque', 'Inter', 'JetBrains Mono'], ratio: 1.5, surface: 'card', radius: 16, image_radius: 16, decor_style: 'rounded',
    decor: [{ kind: 'shape', ref: 'rounded', tone: 'accent', cards: ['title', 'why_now', 'problem', 'use_of_funds'] }, { kind: 'texture', ref: 'diagonal', tone: 'muted', cards: ['title'] }],
    chrome: ch('bottom_right', false, 'top_left'), art: 'isometric',
    image: { card: 'product', prompt: 'Isometric illustration of a pair of workshop benches joined by a shared conveyor carrying parcels, plum and blush tones, soft shadows, no text, no people, no logos' },
    description: 'Bold rounded shapes on blush, a shared customer’s quote and a cycle of the joint offer: a corporate pilot pitch.',
    cards: [
      ['title', 'title', { S: T('[What we could do together]') }], ['product', 'image_text', { I: ART, H: T('[How we plug in]'), P: T('[Integration point]') }],
      ['market', 'comparison_table'], ['solution', 'two_columns', { R: CYCLE }], ['problem', 'quote', { Q: { t: 'founder_quote', text: '[The gap, in a shared customer’s words]' } }],
      ['why_now', 'statement'], ['validation', 'chart_text', { C: CH('columns', ['[Interviews]', 'validate.interviews'], ['[Letters of intent]', 'validate.lois']), L: LIST('[Signals the partner can check]') }],
      ['competition', 'two_columns', { R: LIST('[Why we are the better fit]') }], ['team', 'team_grid'], ['round', 'metric_tiles', TERMS], ['use_of_funds', 'statement'],
    ],
  },
  {
    n: '05', name: 'Quiet Start', stage: 'pre_seed', audience: ['angel', 'other'], deck_audience: 'angel', style: 'minimal',
    swatch: 'white', accent: '#2747C8', accent_ink: '#FFFFFF', fonts: ['Inter', 'Inter', 'IBM Plex Mono'], ratio: 1.25, surface: 'flat', radius: 4, image_radius: 4, decor_style: 'quiet',
    decor: [UNDER('accent', 'accent')], chrome: ch('bottom_right', false, 'none'), art: 'line',
    description: 'The lowest density in the library, in Inter with one blue accent: a deck for a first coffee with an angel.',
    cards: [
      ['title', 'title'], ['problem', 'statement'], ['team', 'two_columns', { R: { t: 'list', items: ['[Why we will win this]'], key: 'team.archetypes' } }], ['solution', 'statement'],
      ['why_now', 'statement'], ['validation', 'metric_tiles', { P: T('[What surprised us]') }], ['product', 'image_text'], ['market', 'statement'], ['round', 'metric_tiles'], ['use_of_funds', 'two_columns'],
    ],
  },
  {
    n: '06', name: 'Nursery Row', stage: 'pre_seed', audience: ['strategic', 'grant'], deck_audience: 'strategic', style: 'minimal',
    swatch: 'sage', accent: '#2F5233', accent_ink: '#FFFFFF', fonts: ['DM Sans', 'DM Sans', 'IBM Plex Mono'], ratio: 1.25, surface: 'outlined', radius: 8, image_radius: 8, decor_style: 'botanical',
    decor: [{ kind: 'icon', ref: 'leaf', tone: 'accent', cards: ['title', 'why_now'] }], chrome: ch('bottom_right', true, 'top_left'), art: 'line',
    image: { card: 'solution', prompt: 'Fine line drawing of a small glasshouse with seedlings in neat rows linked to a larger building by a covered walkway, dark green lines on pale sage, no text, no people, no logos' },
    description: 'Pilot first and quiet, in sage with outlined surfaces: the smallest strategic deck.',
    cards: [
      ['title', 'title', { S: T('[What we would build with the partner]') }], ['product', 'two_columns', { R: INTEGRATION }], ['market', 'comparison_table'],
      ['solution', 'image_text', { I: ART }], ['problem', 'statement'], ['why_now', 'statement'], ['validation', 'chart_text'],
      ['team', 'two_columns', { R: LIST('[Who leads the partnership]') }], ['round', 'metric_tiles', TERMS], ['use_of_funds', 'two_columns', { R: T('[Pilot scope]') }],
    ],
  },
  // ── Seed ──
  {
    n: '07', name: 'Kitchen Table', stage: 'seed', audience: ['seed_fund', 'pre_seed_fund', 'series_a_fund'], deck_audience: 'seed_fund', style: 'editorial',
    swatch: 'cream', accent: '#2F5D50', accent_ink: '#FFFFFF', fonts: ['Lora', 'Inter', 'IBM Plex Mono'], ratio: 1.414, surface: 'flat', radius: 0, image_radius: 0, decor_style: 'magazine',
    decor: [UNDER('muted', 'double'), { kind: 'texture', ref: 'noise', tone: 'muted', cards: ['title', 'why_now'] }, { kind: 'icon', ref: 'lightbulb', tone: 'accent', cards: ['why_now'] }],
    chrome: ch('bottom_right', true, 'top_left', true), art: 'scene',
    image: { card: 'solution', prompt: 'Warm editorial scene of an empty kitchen table at dawn with a notebook, a laptop and a mug, muted green and cream, soft grain, blank covers on every object, no text, no people, no logos' },
    description: 'Traction lands third under serif headlines with a clear arc: the fullest seed story.',
    cards: [
      ['title', 'title'], ['problem', 'quote'], ['traction', 'chart_text'], ['solution', 'image_text', { I: ART }], ['why_now', 'statement'], ['validation', 'metric_tiles'],
      ['product', 'two_columns'], ['market', 'comparison_table'], ['competition', 'two_columns', { R: MATRIX }], ['roadmap', 'timeline'], ['team', 'team_grid'], ['round', 'metric_tiles'], ['use_of_funds', 'timeline'],
    ],
  },
  {
    n: '08', name: 'Nib and Trace', stage: 'seed', audience: ['strategic', 'grant'], deck_audience: 'strategic', style: 'editorial',
    swatch: 'ivory', accent: '#7A2E3A', accent_ink: '#FFFFFF', fonts: ['Playfair Display', 'Source Sans 3', 'IBM Plex Mono'], ratio: 1.333, surface: 'outlined', radius: 0, image_radius: 0, decor_style: 'memo',
    decor: [{ kind: 'divider', ref: 'line', tone: 'muted', where: 'gutter' }, { kind: 'icon', ref: 'pen-tool', tone: 'accent', cards: ['title'] }],
    chrome: ch('bottom_right', true, 'top_left', true), art: 'line',
    image: { card: 'product', prompt: 'Fine ink line drawing of a pen nib meeting a circuit trace on ivory paper, burgundy lines, generous margins, no text, no people, no logos' },
    description: 'A memo-style proposal to a strategic partner, backed by early traction tiles, with a serif display face on ivory.',
    cards: [
      ['title', 'title', { S: T('[What we offer the partner]') }], ['product', 'image_text', { I: ART, H: T('[How it plugs in]'), P: T('[Integration point]') }],
      ['market', 'comparison_table'], ['solution', 'two_columns', { R: INTEGRATION }], ['problem', 'statement'], ['why_now', 'statement'],
      ['traction', 'metric_tiles', { P: T('[What the partner would see in a pilot]') }],
      ['validation', 'chart_text', { C: CH('columns', ['[Interviews]', 'validate.interviews'], ['[Strong-fit customers]', 'validate.strong_fit'], ['[Letters of intent]', 'validate.lois']) }],
      ['competition', 'comparison_table'], ['team', 'two_columns'], ['round', 'metric_tiles', TERMS], ['use_of_funds', 'two_columns'],
    ],
  },
  {
    n: '09', name: 'Harbour Lights', stage: 'seed', audience: ['angel', 'seed_fund'], deck_audience: 'angel', style: 'bold',
    swatch: 'navy', accent: '#F4A07F', accent_ink: '#14213D', fonts: ['Space Grotesk', 'Inter', 'Roboto Mono'], ratio: 1.5, surface: 'card', radius: 12, image_radius: 12, decor_style: 'harbour',
    decor: [{ kind: 'shape', ref: 'circle', tone: 'accent', cards: ['title', 'why_now', 'problem', 'market'] }, { kind: 'icon', ref: 'anchor', tone: 'accent', cards: ['why_now'] }, { kind: 'texture', ref: 'grid', tone: 'muted', cards: ['title'] }],
    chrome: ch('bottom_right', false, 'bottom_left'), art: 'flat',
    image: { card: 'solution', prompt: 'Flat illustration of a small boat steering toward a row of harbour lights at night, coral and pale blue on deep navy, bold simple shapes, no text, no people, no logos' },
    description: 'A dark navy story deck: the founders come third, and early revenue follows the story rather than leading it.',
    cards: [
      ['title', 'title'], ['problem', 'statement'], ['team', 'team_grid'], ['solution', 'image_text', { I: ART }], ['why_now', 'statement'],
      ['traction', 'chart_text', { C: CH('columns', ['[MRR]', 'grow.mrr']) }], ['validation', 'metric_tiles'], ['product', 'image_text'], ['market', 'statement'],
      ['competition', 'comparison_table'], ['round', 'metric_tiles'], ['use_of_funds', 'timeline'],
    ],
  },
  {
    n: '10', name: 'Patch Bay', stage: 'seed', audience: ['strategic'], deck_audience: 'strategic', style: 'bold',
    swatch: 'near_black', accent: '#E8FF5A', accent_ink: '#121212', fonts: ['Syne', 'Inter', 'JetBrains Mono'], ratio: 1.618, surface: 'card', radius: 0, image_radius: 0, decor_style: 'electric',
    decor: [{ kind: 'bar', tone: 'accent', cards: 'statements' }, { kind: 'icon', ref: 'arrow-right', tone: 'accent', cards: ['why_now'] }, { kind: 'texture', ref: 'dots', tone: 'muted', cards: ['title'] }],
    chrome: ch('bottom_right', false, 'top_left'), art: 'isometric',
    image: { card: 'solution', prompt: 'Isometric illustration of a sleek module clicking into a larger platform rack, electric lime highlights on near-black, crisp edges, no text, no people, no logos' },
    description: 'A platform-integration seed pitch with an electric accent and an integration roadmap.',
    cards: [
      ['title', 'title'], ['product', 'two_columns', { R: INTEGRATION }], ['market', 'comparison_table'], ['solution', 'image_text', { I: ART }], ['problem', 'statement'],
      ['why_now', 'statement'], ['traction', 'chart_text'], ['competition', 'two_columns', { R: MATRIX }], ['roadmap', 'timeline', { H: T('[Integration milestones]') }],
      ['team', 'team_grid'], ['round', 'metric_tiles', TERMS], ['use_of_funds', 'two_columns'],
    ],
  },
  {
    n: '11', name: 'Plainspoken', stage: 'seed', audience: ['seed_fund', 'strategic', 'grant'], deck_audience: 'seed_fund', style: 'minimal',
    swatch: 'white', accent: '#0F7B6C', accent_ink: '#FFFFFF', fonts: ['Inter', 'Inter', 'Roboto Mono'], ratio: 1.25, surface: 'flat', radius: 4, image_radius: 4, decor_style: 'plain',
    decor: [UNDER('accent', 'accent')], chrome: ch('bottom_right', false, 'none'), art: 'diagram',
    description: 'The strictest records-first seed deck; its partner-fit market card also briefs a strategic investor.',
    cards: [
      ['title', 'title'], ['problem', 'statement'], ['traction', 'chart_text'], ['solution', 'two_columns', { R: FLOW }], ['why_now', 'statement'], ['validation', 'metric_tiles'],
      ['product', 'metric_tiles'], ['market', 'comparison_table', { H: T('[Who buys, and who could partner]') }], ['team', 'two_columns'], ['round', 'metric_tiles'], ['use_of_funds', 'two_columns'],
    ],
  },
  {
    n: '12', name: 'Fold and Fly', stage: 'seed', audience: ['angel', 'other'], deck_audience: 'angel', style: 'minimal',
    swatch: 'blush', accent: '#2B3A67', accent_ink: '#FFFFFF', fonts: ['Manrope', 'Manrope', 'IBM Plex Mono'], ratio: 1.25, surface: 'card', radius: 20, image_radius: 20, decor_style: 'soft',
    decor: [UNDER('accent', 'accent'), { kind: 'shape', ref: 'rounded', tone: 'accent', cards: ['title', 'why_now'] }], chrome: ch('bottom_right', false, 'none'), art: 'flat',
    image: { card: 'solution', prompt: 'Flat illustration of a paper plane lifting off a desk edge into open air, navy on soft blush, rounded shapes, no text, no people, no logos' },
    description: 'The softest palette, with rounded card surfaces and a short run of cards: an angel introduction with the first revenue in tiles.',
    cards: [
      ['title', 'title'], ['problem', 'quote'], ['team', 'team_grid'], ['solution', 'image_text', { I: ART }], ['why_now', 'statement'], ['traction', 'metric_tiles'],
      ['product', 'image_text'], ['market', 'statement'], ['round', 'metric_tiles'], ['use_of_funds', 'statement'],
    ],
  },
  // ── Series A ──
  {
    n: '13', name: 'Ledger Line', stage: 'series_a', audience: ['series_a_fund', 'seed_fund', 'pre_seed_fund'], deck_audience: 'series_a_fund', style: 'editorial',
    swatch: 'white_rule', accent: '#C2410C', accent_ink: '#FFFFFF', fonts: ['Source Serif 4', 'Inter', 'IBM Plex Mono'], ratio: 1.333, surface: 'outlined', radius: 0, image_radius: 0, decor_style: 'ledger',
    decor: [UNDER('muted'), { kind: 'divider', ref: 'line', tone: 'muted', where: 'gutter' }], chrome: ch('bottom_right', true, 'top_left', true), art: 'diagram',
    description: 'An annual-report deck: metrics lead, grey rules divide the cards and an appendix carries every figure.',
    cards: [
      ['title', 'title'], ['traction', 'chart_text', { C: CH('line', ['[ARR]', 'grow.arr'], ['[MRR]', 'grow.mrr']) }], ['unit_economics', 'metric_tiles'], ['market', 'comparison_table'],
      ['problem', 'statement'], ['why_now', 'statement'], ['solution', 'two_columns', { R: FLOW }], ['product', 'metric_tiles'], ['competition', 'comparison_table'],
      ['roadmap', 'timeline'], ['team', 'team_grid'], ['round', 'metric_tiles'], ['use_of_funds', 'timeline'], ['every_figure', 'appendix_table'],
    ],
  },
  {
    n: '14', name: 'Shared Atlas', stage: 'series_a', audience: ['strategic', 'grant'], deck_audience: 'strategic', style: 'editorial',
    swatch: 'cream', accent: '#3B4A8C', accent_ink: '#FFFFFF', fonts: ['Libre Caslon Text', 'Inter', 'IBM Plex Mono'], ratio: 1.333, surface: 'flat', radius: 0, image_radius: 0, decor_style: 'atlas',
    decor: [UNDER(), { kind: 'texture', ref: 'waves', tone: 'muted', cards: ['title', 'why_now'] }, { kind: 'icon', ref: 'compass', tone: 'accent', cards: ['title'] }],
    chrome: ch('bottom_right', true, 'top_left', true), art: 'line',
    image: { card: 'solution', prompt: 'Fine line map illustration of a pair of coastlines joined by a single bridge with shipping routes as dotted lines, indigo on cream, no labels, no text, no people, no logos' },
    description: 'An atlas motif for joint market expansion: a strategic Series A deck that still shows unit economics.',
    cards: [
      ['title', 'title', { S: T('[What we build with the partner]') }], ['product', 'two_columns', { R: INTEGRATION }], ['market', 'comparison_table', { H: T('[Markets we reach together]') }],
      ['solution', 'image_text', { I: ART }], ['problem', 'statement'], ['why_now', 'statement'], ['traction', 'chart_text', { C: CH('line', ['[ARR]', 'grow.arr']) }],
      ['competition', 'comparison_table'], ['unit_economics', 'metric_tiles'], ['roadmap', 'timeline', { H: T('[Integration and launch plan]') }],
      ['team', 'two_columns'], ['round', 'metric_tiles', TERMS], ['use_of_funds', 'two_columns'],
    ],
  },
  {
    n: '15', name: 'Sounding Line', stage: 'series_a', audience: ['series_a_fund', 'strategic'], deck_audience: 'series_a_fund', style: 'bold',
    swatch: 'navy', accent: '#7CC6E0', accent_ink: '#14213D', fonts: ['Familjen Grotesk', 'Inter', 'JetBrains Mono'], ratio: 1.5, surface: 'card', radius: 12, image_radius: 12, decor_style: 'depth',
    decor: [{ kind: 'bar', tone: 'accent', cards: 'statements' }, { kind: 'texture', ref: 'waves', tone: 'muted', cards: ['title'] }, { kind: 'icon', ref: 'target', tone: 'accent', cards: ['why_now'] }],
    chrome: ch('bottom_right', false, 'bottom_left'), art: 'flat',
    image: { card: 'solution', prompt: 'Flat illustration of a sounding line dropping through layered water bands toward a bright marker on the seabed, cyan on deep navy, no text, no people, no logos' },
    description: 'A dark metrics deck: a unit-economics waterfall sits second, and the market card names partners for a corporate co-investor.',
    cards: [
      ['title', 'title'], ['traction', 'chart_text', { C: CH('columns', ['[ARR]', 'grow.arr'], ['[MRR]', 'grow.mrr']) }],
      ['unit_economics', 'chart_text', { C: CH('waterfall', ['[Revenue]', 'grow.mercury_revenue'], ['[Net burn]', 'grow.net_burn']) }],
      ['market', 'comparison_table', { H: T('[Where we win, and who could partner]') }], ['problem', 'statement'], ['why_now', 'statement'], ['solution', 'image_text', { I: ART }],
      ['product', 'metric_tiles'], ['competition', 'comparison_table'], ['team', 'team_grid'], ['round', 'metric_tiles'], ['use_of_funds', 'timeline'], ['every_figure', 'appendix_table'],
    ],
  },
  {
    n: '16', name: 'Ember Hour', stage: 'series_a', audience: ['angel', 'other'], deck_audience: 'angel', style: 'bold',
    swatch: 'near_black', accent: '#FF7A59', accent_ink: '#121212', fonts: ['Oswald', 'Inter', 'JetBrains Mono'], ratio: 1.618, surface: 'card', radius: 8, image_radius: 8, decor_style: 'ember',
    decor: [{ kind: 'bar', tone: 'accent', cards: 'statements' }, { kind: 'shape', ref: 'ring', tone: 'accent', cards: ['title'] }, { kind: 'icon', ref: 'flame', tone: 'accent', cards: ['why_now'] }],
    chrome: ch('bottom_right', false, 'top_left'), art: 'scene',
    image: { card: 'solution', prompt: 'Moody scene of a workshop at dusk with a single forge glowing orange and tools in tidy rows, near-black surroundings, no text, no people, no logos' },
    description: 'A Series A story for angels and syndicates following on: the founders first, the metrics after, in large condensed type.',
    cards: [
      ['title', 'title'], ['problem', 'quote'], ['team', 'team_grid'], ['solution', 'image_text', { I: ART }], ['why_now', 'statement'], ['traction', 'chart_text', { C: CH('line', ['[ARR]', 'grow.arr']) }],
      ['product', 'image_text'], ['market', 'comparison_table'], ['competition', 'two_columns', { R: MATRIX }], ['unit_economics', 'metric_tiles'], ['round', 'metric_tiles'], ['use_of_funds', 'two_columns'],
    ],
  },
  {
    n: '17', name: 'Steady State', stage: 'series_a', audience: ['angel', 'seed_fund', 'grant'], deck_audience: 'angel', style: 'minimal',
    swatch: 'sage', accent: '#5A3E7A', accent_ink: '#FFFFFF', fonts: ['IBM Plex Sans', 'IBM Plex Sans', 'IBM Plex Mono'], ratio: 1.25, surface: 'outlined', radius: 6, image_radius: 6, decor_style: 'steady',
    decor: [{ kind: 'icon', ref: 'circle-check', tone: 'accent', cards: ['title'] }], chrome: ch('bottom_right', true, 'none'), art: 'diagram',
    description: 'A calm Series A deck with no images: tiles before charts and a retention cycle on the solution card.',
    cards: [
      ['title', 'title'], ['problem', 'statement'], ['team', 'two_columns'], ['solution', 'two_columns', { R: CYCLE }], ['traction', 'metric_tiles'], ['product', 'metric_tiles'],
      ['market', 'comparison_table'], ['unit_economics', 'chart_text'], ['roadmap', 'timeline'], ['round', 'metric_tiles'], ['use_of_funds', 'two_columns'], ['every_figure', 'appendix_table'],
    ],
  },
  {
    n: '18', name: 'Joinery', stage: 'series_a', audience: ['strategic'], deck_audience: 'strategic', style: 'minimal',
    swatch: 'white', accent: '#5B3FD1', accent_ink: '#FFFFFF', fonts: ['Work Sans', 'Work Sans', 'IBM Plex Mono'], ratio: 1.25, surface: 'flat', radius: 4, image_radius: 4, decor_style: 'joinery',
    decor: [{ kind: 'icon', ref: 'puzzle', tone: 'accent', cards: ['title'] }, UNDER()], chrome: ch('bottom_right', false, 'top_left'), art: 'isometric',
    image: { card: 'solution', prompt: 'Isometric illustration of a pair of wooden parts joined by a precise interlocking joint, violet edges on white, clean light, no text, no people, no logos' },
    description: 'An integration specification written as a pitch, with partnership terms on the ask.',
    cards: [
      ['title', 'title'], ['product', 'two_columns', { R: INTEGRATION }], ['market', 'comparison_table'], ['solution', 'image_text', { I: ART }], ['problem', 'statement'],
      ['traction', 'chart_text', { C: CH('line', ['[ARR]', 'grow.arr'], ['[Paying customers]', 'grow.paying_customers']) }], ['unit_economics', 'metric_tiles'],
      ['roadmap', 'timeline', { H: T('[Integration milestones]') }], ['team', 'two_columns'], ['round', 'metric_tiles', TERMS], ['use_of_funds', 'two_columns'],
    ],
  },
  // ── Series B+ ──
  {
    n: '19', name: 'Long Form', stage: 'series_b_plus', audience: ['series_a_fund', 'strategic', 'seed_fund'], deck_audience: 'series_a_fund', style: 'editorial',
    swatch: 'white_rule', accent: '#1D3557', accent_ink: '#FFFFFF', fonts: ['Literata', 'Inter', 'IBM Plex Mono'], ratio: 1.333, surface: 'outlined', radius: 0, image_radius: 0, decor_style: 'report',
    decor: [UNDER('muted'), { kind: 'divider', ref: 'line', tone: 'muted', where: 'gutter' }], chrome: ch('bottom_right', true, 'top_left', true), art: 'diagram',
    description: 'The densest editorial deck, with a cap table and a full appendix; its market card also serves a strategic co-investor.',
    cards: [
      ['title', 'title'], ['traction', 'chart_text', { C: CH('stacked', ['[ARR]', 'grow.arr'], ['[MRR]', 'grow.mrr']) }], ['unit_economics', 'metric_tiles'],
      ['market', 'comparison_table', { H: T('[Expansion markets and partners]') }], ['problem', 'statement'], ['solution', 'two_columns', { R: FLOW }], ['product', 'metric_tiles'],
      ['competition', 'comparison_table'], ['roadmap', 'timeline'], ['team', 'two_columns', { H: T('[Leadership]') }], ['round', 'metric_tiles'], ['use_of_funds', 'timeline'],
      ['cap_table', 'metric_tiles'], ['every_figure', 'appendix_table'],
    ],
  },
  {
    n: '20', name: 'Second Chapter', stage: 'series_b_plus', audience: ['angel', 'other'], deck_audience: 'angel', style: 'editorial',
    swatch: 'ivory', accent: '#8A5A12', accent_ink: '#FFFFFF', fonts: ['Cormorant Garamond', 'Inter', 'IBM Plex Mono'], ratio: 1.414, surface: 'flat', radius: 0, image_radius: 0, decor_style: 'chapters',
    decor: [{ kind: 'shape', ref: 'diamond', tone: 'accent', cards: ['market', 'cap_table'] }, { kind: 'texture', ref: 'noise', tone: 'muted', cards: ['title'] }, UNDER()],
    chrome: ch('bottom_right', true, 'top_left', true), art: 'scene',
    image: { card: 'solution', prompt: 'Editorial scene of an open book on a reading stand beside a window with morning light, amber and ivory, calm and spacious, blank pages, no text, no people, no logos' },
    description: 'A growth-stage round told as a story for angels and syndicates; every scale figure is bound to a record.',
    cards: [
      ['title', 'title'], ['problem', 'quote', { Q: { t: 'founder_quote', text: '[The pain we started with]' } }], ['team', 'team_grid'], ['solution', 'image_text', { I: ART }],
      ['traction', 'chart_text', { C: CH('line', ['[ARR]', 'grow.arr']) }], ['product', 'two_columns'], ['market', 'statement'], ['unit_economics', 'metric_tiles'],
      ['roadmap', 'timeline'], ['round', 'metric_tiles'], ['use_of_funds', 'two_columns'], ['cap_table', 'statement'], ['every_figure', 'appendix_table'],
    ],
  },
  {
    n: '21', name: 'Spring Tide', stage: 'series_b_plus', audience: ['series_a_fund', 'strategic', 'pre_seed_fund'], deck_audience: 'series_a_fund', style: 'bold',
    swatch: 'navy', accent: '#F2C14E', accent_ink: '#14213D', fonts: ['Hanken Grotesk', 'Inter', 'Roboto Mono'], ratio: 1.5, surface: 'card', radius: 16, image_radius: 16, decor_style: 'tide',
    decor: [{ kind: 'bar', tone: 'accent', cards: 'statements' }, { kind: 'divider', ref: 'wave', tone: 'accent', where: 'headings' }, { kind: 'icon', ref: 'sailboat', tone: 'accent', cards: ['title'] }],
    chrome: ch('bottom_right', false, 'bottom_left'), art: 'flat',
    image: { card: 'solution', prompt: 'Flat illustration of a rising tide lifting a fleet of small boats in formation, gold on deep navy, no text, no people, no logos' },
    description: 'A dark scale deck: the efficiency waterfall sits second, then expansion with partners.',
    cards: [
      ['title', 'title'], ['traction', 'chart_text', { C: CH('columns', ['[ARR]', 'grow.arr']) }],
      ['unit_economics', 'chart_text', { C: CH('waterfall', ['[Revenue]', 'grow.mercury_revenue'], ['[Net burn]', 'grow.net_burn']) }],
      ['market', 'comparison_table', { H: T('[Expansion markets and partners]') }], ['problem', 'statement'], ['solution', 'image_text', { I: ART }], ['product', 'metric_tiles'],
      ['competition', 'comparison_table'], ['roadmap', 'timeline'], ['team', 'team_grid'], ['round', 'metric_tiles'], ['use_of_funds', 'timeline'], ['every_figure', 'appendix_table'],
    ],
  },
  {
    n: '22', name: 'Reserved Seat', stage: 'series_b_plus', audience: ['angel'], deck_audience: 'angel', style: 'bold',
    swatch: 'blush', accent: '#A2324A', accent_ink: '#FFFFFF', fonts: ['Unbounded', 'Inter', 'JetBrains Mono'], ratio: 1.5, surface: 'card', radius: 24, image_radius: 24, decor_style: 'velvet',
    decor: [{ kind: 'shape', ref: 'rounded', tone: 'accent', cards: ['title', 'problem', 'use_of_funds'] }, UNDER('accent', 'wave')], chrome: ch('bottom_right', false, 'top_left'), art: 'flat',
    image: { card: 'solution', prompt: 'Flat illustration of a curved velvet rope between brass posts in front of an open, warmly lit doorway, crimson on blush, no text, no people, no logos' },
    description: 'An allocation-focused growth round for angels and syndicates, with bold rounded shapes.',
    cards: [
      ['title', 'title'], ['problem', 'statement'], ['team', 'team_grid'], ['solution', 'image_text', { I: ART }], ['traction', 'metric_tiles'], ['product', 'image_text'],
      ['market', 'comparison_table'], ['unit_economics', 'metric_tiles'], ['roadmap', 'timeline'], ['round', 'metric_tiles', { P: T('[Who this allocation is for]') }],
      ['use_of_funds', 'statement'], ['every_figure', 'appendix_table'],
    ],
  },
  {
    n: '23', name: 'Far Field', stage: 'series_b_plus', audience: ['series_a_fund', 'seed_fund', 'grant'], deck_audience: 'series_a_fund', style: 'minimal',
    swatch: 'sage', accent: '#1F4E79', accent_ink: '#FFFFFF', fonts: ['Public Sans', 'Public Sans', 'IBM Plex Mono'], ratio: 1.25, surface: 'flat', radius: 4, image_radius: 4, decor_style: 'horizon',
    decor: [UNDER('accent', 'accent')], chrome: ch('bottom_right', false, 'none'), art: 'line',
    description: 'The quietest growth deck: metrics first, wide whitespace and no images.',
    cards: [
      ['title', 'title'], ['traction', 'chart_text', { C: CH('line', ['[ARR]', 'grow.arr'], ['[MRR]', 'grow.mrr']) }], ['unit_economics', 'metric_tiles'], ['market', 'comparison_table'],
      ['problem', 'statement'], ['solution', 'two_columns', { R: FLOW }], ['product', 'metric_tiles'], ['roadmap', 'timeline'], ['team', 'two_columns'], ['round', 'metric_tiles'],
      ['use_of_funds', 'timeline'], ['every_figure', 'appendix_table'],
    ],
  },
  {
    n: '24', name: 'Bridgework', stage: 'series_b_plus', audience: ['strategic', 'other'], deck_audience: 'strategic', style: 'minimal',
    swatch: 'white_rule', accent: '#6B2C5F', accent_ink: '#FFFFFF', fonts: ['Inter', 'Inter', 'Roboto Mono'], ratio: 1.25, surface: 'outlined', radius: 0, image_radius: 0, decor_style: 'bridge',
    decor: [UNDER('muted'), { kind: 'shape', ref: 'corner', tone: 'accent', cards: ['title'] }], chrome: ch('bottom_right', true, 'top_left'), art: 'diagram',
    description: 'A growth-stage strategic deck built around rollout, proof of scale and partnership terms, in plum on grey rules.',
    cards: [
      ['title', 'title'], ['product', 'two_columns', { R: INTEGRATION }], ['market', 'comparison_table', { H: T('[Joint expansion markets]') }], ['solution', 'two_columns', { R: CYCLE }],
      ['problem', 'statement'], ['traction', 'chart_text', { C: CH('line', ['[ARR]', 'grow.arr']) }], ['unit_economics', 'metric_tiles'],
      ['roadmap', 'timeline', { H: T('[Integration and rollout]') }], ['team', 'two_columns'], ['round', 'metric_tiles', TERMS], ['use_of_funds', 'two_columns'],
    ],
  },
];

// ── Composition ─────────────────────────────────────────────────────────────

const snake = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
const titleOf = (card: string) => CARD_CATALOGUE.find((c) => c.card === card)?.title ?? card.replace(/_/g, ' ').replace(/^./, (x) => x.toUpperCase());
const purposeOf = (card: string) => CARD_CATALOGUE.find((c) => c.card === card)?.purpose
  ?? ({ closing: 'The ask, and how to reach the founders', business_model: 'Who pays, for what, and why they keep paying', gtm: 'How customers find the venture' } as Record<string, string>)[card] ?? '';

/** One area as a block (main's shape, H4) and as the template's area record (generation kind, rail group, art). */
function areaOf(spec: AreaSpec, def: { id: string; grid: G; kind: string; style?: string; chart?: string }, s: Spec, card: string) {
  const base = { id: def.id, grid: def.grid };
  let block: Record<string, unknown>; let element: string; let kind: string; let art: { style: string; prompt: string } | undefined;
  switch (spec.t) {
    case 'text': block = { ...base, kind: 'text', style: def.style ?? 'paragraph', text: spec.text, ...(spec.key ? { binding: { source_key: spec.key } } : {}) }; element = 'text'; kind = card === 'every_figure' ? 'records' : 'text'; break;
    case 'list': block = { ...base, kind: 'text', style: def.kind === 'text' && def.style === 'list' ? 'list' : (def.style ?? 'paragraph'), text: spec.items.join('\n'), ...(spec.key ? { binding: { source_key: spec.key } } : {}) }; element = 'text'; kind = card === 'every_figure' ? 'records' : 'text'; break;
    case 'founder_quote': block = { ...base, kind: 'text', style: def.style ?? 'heading', text: spec.text, binding: { source_key: 'validate.top_pain' } }; element = 'text'; kind = 'founder'; break;
    case 'metric': block = { ...base, kind: 'metric', label: spec.label, value: null, binding: { source_key: spec.key } }; element = 'metric'; kind = 'records'; break;
    case 'chart': block = { ...base, kind: 'chart', chart_type: spec.type ?? def.chart ?? 'line', series: spec.series.map(([label, key]) => ({ label, binding: { source_key: key } })) }; element = 'chart'; kind = 'chart'; break;
    case 'diagram': block = { ...base, kind: 'graphic', graphic: spec.type, ratio: '1x1', diagram: { v: 1, type: spec.type, items: spec.items.map((label) => ({ label })) } }; element = 'graphic'; kind = 'diagram'; break;
    case 'art': {
      if (!s.image) throw new Error(`TPL-${s.n}: an art area with no image prompt`);
      block = { ...base, kind: 'image', image_url: null, alt: '[An illustration of the idea]', tag: 'illustration' }; element = 'image'; kind = 'image';
      art = { style: s.art, prompt: s.image.prompt }; break;
    }
    case 'shot': block = { ...base, kind: 'image', image_url: null, alt: spec.alt ?? '[A screen of the product]', tag: 'screenshot' }; element = 'image'; kind = 'founder'; break;
    case 'photo': block = { ...base, kind: 'image', image_url: null, alt: spec.alt ?? '[Founder photo]', tag: 'photo' }; element = 'image'; kind = 'founder'; break;
  }
  const generation_kind = kind === 'diagram' ? 'text' : kind;
  return {
    block,
    area: { id: def.id, grid: def.grid, element, generation_kind, rail_group: RAIL_GROUP[kind], ...(art ? { art } : {}) },
  };
}

/** H2 + H11: the card's decor, placed in cells no block covers (dividers on a heading's edge or a gutter). */
function decorFor(s: Spec, card: string, layout: string): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];
  const free: Record<string, G[]> = { title: [g(10, 12, 5, 6), g(1, 3, 5, 6), g(12, 12, 1, 1)], statement: [g(12, 12, 1, 1), g(1, 1, 6, 6), g(2, 5, 6, 6)], quote: [g(12, 12, 1, 1), g(1, 1, 6, 6), g(2, 5, 6, 6)] };
  const slots = [...(free[layout] ?? [])];
  const take = () => slots.shift();
  const isStatement = layout === 'statement' || layout === 'quote';
  for (const d of s.decor) {
    if (d.kind === 'divider') {
      const head = LAYOUT_AREAS[layout].find((a) => a.id === 'H');
      if (d.where === 'headings' && head) out.push({ kind: 'divider', ref: d.ref, tone: d.tone, grid: head.grid });
      if (d.where === 'gutter' && layout === 'two_columns') out.push({ kind: 'divider', ref: d.ref, tone: d.tone, grid: g(7, 7, 2, 6) });
      continue;
    }
    if (d.kind === 'bar') {
      if (isStatement && layout === 'statement') { const at = slots.find((x) => x.r1 === 6 && x.c2 - x.c1 >= 3); if (at) { slots.splice(slots.indexOf(at), 1); out.push({ kind: 'shape', ref: 'pill', tone: d.tone, grid: at }); } }
      continue;
    }
    if (!d.cards.includes(card)) continue;
    const at = take();
    if (!at) continue;
    out.push({ kind: d.kind, ref: d.ref, tone: d.tone, grid: at, ...(d.kind === 'texture' ? { seed: Number(s.n) } : {}) });
  }
  return out.slice(0, 16);
}

function cardOf(s: Spec, card: string, layout: string, over: Areas | undefined) {
  const preset = LAYOUT_AREAS[layout];
  if (!preset) throw new Error(`TPL-${s.n}: no layout ${layout}`);
  const merged: Areas = { ...defaults(card, layout), ...overlay(card, layout, s.deck_audience, s.stage), ...(over ?? {}) };
  // The image area of an image_text solution card is the template's art when it has one, else the founder's screenshot.
  if (layout === 'image_text' && !over?.I) merged.I = s.image?.card === card ? ART : SHOT;
  const blocks: unknown[] = []; const areas: unknown[] = [];
  for (const def of preset) {
    const spec = merged[def.id];
    if (!spec) throw new Error(`TPL-${s.n}: ${card}·${layout} has no ${def.id}`);
    const { block, area } = areaOf(spec, def, s, card);
    blocks.push(block); areas.push(area);
  }
  const decor = decorFor(s, card, layout);
  return {
    card, title: titleOf(card), purpose: purposeOf(card), message: MESSAGES[card] ?? '[What this card shows]',
    layout, structure: 'custom', areas, blocks, background: null, ...(decor.length ? { decor } : {}), notes: NOTES[card] ?? '[Say what this card shows.]',
  };
}

/** One template, expanded from its spec by the house rules. */
export function compose(s: Spec): Record<string, any> {
  const p = SWATCH_PALETTES[s.swatch];
  const cards = s.cards.map(([card, layout, over]) => cardOf(s, card, layout, over));
  const last = cards[cards.length - 1].card;
  const pending = PENDING[s.stage].map(({ card, layout }) => {
    const preset = LAYOUT_AREAS[layout];
    const blocks: unknown[] = []; const areas: unknown[] = [];
    for (const def of preset) { const { block, area } = areaOf(PENDING_AREAS[card][def.id], def, s, card); blocks.push(block); areas.push(area); }
    return { card, after: card === 'closing' ? last : 'market', title: titleOf(card), purpose: purposeOf(card), message: MESSAGES[card], layout, structure: 'custom', areas, blocks, background: null, notes: NOTES[card] };
  });
  const [display, body, mono] = s.fonts;
  const families = [...new Set([display, body, mono, ...Object.values(FALLBACK_FONTS)])];
  const font_licences = Object.fromEntries(families.map((f) => [f, FONT_LICENCES[f].licence]));
  return {
    contract: CONTRACT,
    uid: `tpl_hq_${snake(s.name)}`,
    name: s.name,
    description: s.description,
    stage: s.stage,
    audience_tags: s.audience,
    deck_audience: s.deck_audience,
    style: s.style,
    swatch: s.swatch,
    length: s.cards.every(([c]) => STANDARD_TWELVE.includes(c)) ? 'standard' : 'full',
    aspect: '16:9',
    card_count: cards.length,
    theme: {
      kind: p.kind, version: 1, name: `${s.name} ${s.swatch.replace('_', ' ')}`,
      colours: { ground: p.ground, surface: p.surface, ink: p.ink, muted: p.muted, hairline: p.hairline, accent: s.accent, accent_ink: s.accent_ink, positive: p.positive, negative: p.negative },
      chart: [...p.chart],
      fonts: { display, body, mono }, fallback_fonts: { ...FALLBACK_FONTS }, font_licences,
      type_scale_ratio: s.ratio, image: { radius: s.image_radius, overlay: 'none' }, radius: s.radius,
      surface_style: s.surface, decor_style: s.decor_style, chrome: { ...s.chrome },
    },
    art_direction: { style: s.art },
    cards,
    pending_cards: pending,
    provenance: {
      origin: 'original', prompt_id: `TPL-${s.n}`, authored_by: 'build session', authored_on: '2026-11-02', reviewed_by: null,
      attestation: ATTESTATION, fonts: font_licences, icons: 'B3 #3779 set (Lucide), ISC',
    },
  };
}

/** The 24, in TPL order. */
export const LIBRARY: readonly Record<string, any>[] = Object.freeze(SPECS.map(compose));
