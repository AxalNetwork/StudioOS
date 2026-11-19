/**
 * D7743 (#7743) — Research › Funds: every source's statement about a fund, in
 * the source's own words (`research_fund_observations`, migration
 * 202611191932_7743).
 *
 * WHAT A STATEMENT IS. One row per fund, fact, list and source record. The
 * wording is always the source's text. The four money facts (initial cheque,
 * stated fund capital, manager AUM, revenue threshold) are separate facts and
 * carry a qualifier, amounts in cents and a currency only when the source
 * states one (`readAmount`). Stage and geography statements carry vocabulary
 * terms a filter can match (`normaliseStage`, `normaliseGeography`); a wording
 * no rule recognises keeps its text, gets no term and is counted.
 *
 * THE STAGE VOCABULARY is defined here and nowhere else. A round is spelled as
 * `STAGES` in companyProfileFields.ts spells it, in that order; three broad
 * terms (early_stage, late_stage, multi_stage) are never expanded into rounds.
 * Countries come from `COUNTRY_ALIASES` in researchTaxonomy.ts by exact match;
 * regions are the seven research_countries allows (migration 376) plus
 * 'global'. A region is never expanded into countries, and nothing is taken
 * from the manager's headquarters.
 *
 * ONE SERVED READ (`readFundStatements`), shared by every reader: a statement
 * is served only when its list's verdict is not 'not allowed'; a description
 * only under 'republish allowed'; facts from a fixed allow-list; a statement
 * with a period comes back apart as past; `source_record_ref` and the
 * promoting user are never returned. The rows of research_fund_vehicle_facts
 * (D7167) come back as statements under main's own gate, so the profile and
 * the directory never disagree about what is recorded.
 *
 * ONE WRITER (`observationStatements`) returns prepared statements for the
 * caller's batch, so a caller can write a run atomically. Nothing here logs
 * wording.
 */
import type { Env } from '../types';
import { STAGES } from './companyProfileFields';
import { COUNTRY_ALIASES, normalizeLabel, type Method } from './researchTaxonomy';
import type { FundSourceVerdict } from './researchFundDirectory';

// ---------------------------------------------------------------------------
// Facts and the columns the migration's CHECKs allow.
// ---------------------------------------------------------------------------

export const MONEY_FACTS = ['initial_cheque', 'stated_fund_capital', 'manager_aum', 'revenue_threshold'] as const;
export const TEXT_FACTS = [
  'manager_name', 'investment_stage', 'investment_geography', 'traction_requirement',
  'lead_preference', 'interests', 'sector_focus', 'description', 'date_last_raised',
] as const;
export type MoneyFact = typeof MONEY_FACTS[number];
export type TextFact = typeof TEXT_FACTS[number];
export type ObservationFact = MoneyFact | TextFact;
export const OBSERVATION_FACTS: readonly ObservationFact[] = [...TEXT_FACTS, ...MONEY_FACTS];

/** The facts the served read may return. Fixed: a fact added to the table is not served until it is added here. */
export const SERVED_FACTS: readonly ObservationFact[] = [
  'manager_name', 'investment_stage', 'investment_geography', 'initial_cheque', 'stated_fund_capital',
  'manager_aum', 'revenue_threshold', 'traction_requirement', 'lead_preference', 'interests',
  'sector_focus', 'description', 'date_last_raised',
];

export const QUALIFIERS = ['range', 'typical', 'average_first', 'lower_bound', 'upper_bound', 'exact', 'as_stated'] as const;
export type Qualifier = typeof QUALIFIERS[number];
export const CURRENCY_BASES = ['stated', 'symbol_only', 'heading_only', 'not_stated', 'conflicting', 'reviewed'] as const;
export type CurrencyBasis = typeof CURRENCY_BASES[number];
export const REVIEW_FLAGS = ['two_units', 'symbol_heading_conflict', 'trailing_question_mark', 'multiple_amounts'] as const;
export type ReviewFlag = typeof REVIEW_FLAGS[number];

export const WORDING_MAX = 4000;

export const isMoneyFact = (f: string): f is MoneyFact => (MONEY_FACTS as readonly string[]).includes(f);
const isFact = (f: unknown): f is ObservationFact => typeof f === 'string' && (OBSERVATION_FACTS as readonly string[]).includes(f);

// ---------------------------------------------------------------------------
// Stage vocabulary.
// ---------------------------------------------------------------------------

type CompanyStage = typeof STAGES[number];
/** The rounds, in STAGES' order and spelling: pre_seed, seed, series_a, series_b, series_c_plus, growth. */
export const ROUND_STAGES: readonly CompanyStage[] = STAGES.filter((s) => s !== 'idea' && s !== 'profitable' && s !== 'public');
/** Broad terms, never expanded into rounds. */
export const BROAD_STAGES = ['early_stage', 'late_stage', 'multi_stage'] as const;
export type StageTerm = CompanyStage | typeof BROAD_STAGES[number];
export const STAGE_TERMS: readonly StageTerm[] = [...ROUND_STAGES, ...BROAD_STAGES];

/** A normalised label (normalizeLabel) → its stage term. Exact matches only. */
const STAGE_ALIASES: Readonly<Record<string, StageTerm>> = {
  'pre seed': 'pre_seed', 'preseed': 'pre_seed', 'pre seed stage': 'pre_seed',
  'seed': 'seed', 'seed stage': 'seed',
  'series a': 'series_a',
  'series b': 'series_b',
  'series c': 'series_c_plus', 'series c+': 'series_c_plus', 'series c plus': 'series_c_plus',
  'series d': 'series_c_plus', 'series e': 'series_c_plus',
  'growth': 'growth', 'growth stage': 'growth', 'growth equity': 'growth',
  'early stage': 'early_stage', 'early': 'early_stage',
  'late stage': 'late_stage', 'later stage': 'late_stage', 'late': 'late_stage',
  'multi stage': 'multi_stage', 'multistage': 'multi_stage', 'all stages': 'multi_stage', 'stage agnostic': 'multi_stage',
};

export interface Normalised<T extends string> {
  /** Terms the wording names, each once, in vocabulary order. */
  terms: T[];
  /** Pieces of the wording no rule recognised, in their own words. */
  unmatched: string[];
}

const ITEM_SPLIT = /[,;/|&\n]|\band\b/i;
const RANGE_SPLIT = /\s+(?:to|through|thru|until)\s+|\s*[–—]\s*|\s+-\s+/i;

const stageOf = (piece: string): StageTerm | undefined => STAGE_ALIASES[normalizeLabel(piece)];
const roundIndex = (t: StageTerm) => (ROUND_STAGES as readonly string[]).indexOf(t);

/** Two ends of a range: an item split by a range word, or by one bare hyphen whose sides both resolve. */
function rangeEnds(item: string): [string, string] | null {
  const parts = item.split(RANGE_SPLIT).map((p) => p.trim());
  if (parts.length === 2 && parts[0] && parts[1]) return [parts[0], parts[1]];
  if (stageOf(item)) return null;
  for (let i = item.indexOf('-'); i > 0; i = item.indexOf('-', i + 1)) {
    const left = item.slice(0, i).trim(), right = item.slice(i + 1).trim();
    if (stageOf(left) && stageOf(right)) return [left, right];
  }
  return null;
}

/**
 * A stage wording → stage terms and the unmatched remainder. A list gives one
 * term per item; a range between two rounds gives every round between them;
 * a range with an unknown end gives the end it knows and reports the other.
 */
export function normaliseStage(wording: string | null | undefined): Normalised<StageTerm> {
  const found = new Set<StageTerm>();
  const unmatched: string[] = [];
  for (const raw of String(wording ?? '').split(ITEM_SPLIT)) {
    const item = raw.trim();
    if (!item) continue;
    const ends = rangeEnds(item);
    if (!ends) {
      const t = stageOf(item);
      if (t) found.add(t); else unmatched.push(item);
      continue;
    }
    const [a, b] = ends.map(stageOf);
    if (a && b && roundIndex(a) >= 0 && roundIndex(b) >= 0) {
      const [lo, hi] = [roundIndex(a), roundIndex(b)].sort((x, y) => x - y);
      for (let i = lo; i <= hi; i++) found.add(ROUND_STAGES[i]);
      continue;
    }
    ends.forEach((end, i) => {
      const t = i === 0 ? a : b;
      if (t) found.add(t); else unmatched.push(end);
    });
  }
  return { terms: STAGE_TERMS.filter((t) => found.has(t)), unmatched };
}

// ---------------------------------------------------------------------------
// Geography vocabulary.
// ---------------------------------------------------------------------------

/** The regions research_countries.region allows (migration 376), plus 'global'. */
export const RESEARCH_REGIONS = ['Europe', 'North America', 'Latin America', 'Asia', 'Middle East', 'Africa', 'Oceania'] as const;
export type RegionTerm = typeof RESEARCH_REGIONS[number] | 'global';
export const REGION_TERMS: readonly RegionTerm[] = [...RESEARCH_REGIONS, 'global'];

const REGION_ALIASES: Readonly<Record<string, RegionTerm>> = {
  'europe': 'Europe', 'european': 'Europe',
  'north america': 'North America',
  'latin america': 'Latin America', 'latam': 'Latin America',
  'asia': 'Asia',
  'middle east': 'Middle East',
  'africa': 'Africa',
  'oceania': 'Oceania',
  'global': 'global', 'worldwide': 'global',
};

export interface GeographyTerms { countries: string[]; regions: RegionTerm[]; unmatched: string[] }

function geographyPiece(piece: string, countries: Set<string>, regions: Set<RegionTerm>): boolean {
  const key = normalizeLabel(piece);
  const region = REGION_ALIASES[key];
  if (region) { regions.add(region); return true; }
  const code = COUNTRY_ALIASES[key];
  if (code) { countries.add(code); return true; }
  return false;
}

/** Where a vehicle invests, as country codes and regions. Exact matches only. */
export function normaliseGeography(wording: string | null | undefined): GeographyTerms {
  const value = String(wording ?? '');
  const countries = new Set<string>();
  const regions = new Set<RegionTerm>();
  const unmatched: string[] = [];
  if (!geographyPiece(value, countries, regions)) {
    for (const raw of value.replace(/\(([^)]*)\)/g, ',$1,').split(ITEM_SPLIT)) {
      const piece = raw.trim();
      if (piece && !geographyPiece(piece, countries, regions)) unmatched.push(piece);
    }
  }
  return { countries: [...countries].sort(), regions: REGION_TERMS.filter((r) => regions.has(r)), unmatched };
}

// ---------------------------------------------------------------------------
// Amounts.
// ---------------------------------------------------------------------------

export interface AmountReading {
  fact: MoneyFact;
  qualifier: Qualifier;
  min_cents: number | null;
  max_cents: number | null;
  point_cents: number | null;
  currency: string | null;
  currency_basis: CurrencyBasis;
  review_flags: ReviewFlag[] | null;
}

const UNIT = '(?:million|billion|mm|mn|bn|k|m|b)';
const MULTIPLIER: Readonly<Record<string, number>> = {
  k: 1e3, m: 1e6, mm: 1e6, mn: 1e6, million: 1e6, b: 1e9, bn: 1e9, billion: 1e9,
};
const SYMBOL_RE = /[€£$]/g;
/** Capitals beside an amount that name a metric, not a currency. */
const NOT_CURRENCY: ReadonlySet<string> = new Set(['ARR', 'MRR', 'AUM', 'GMV', 'TBD', 'TBC', 'MAX', 'MIN', 'AVG', 'EST', 'YOY', 'TTM']);
/** A unit after another unit (atomic, so "mm" is one unit, not two). */
const TWO_UNITS = new RegExp(`\\d\\s*(?=(${UNIT}))\\1\\s*${UNIT}(?![a-z])`, 'i');
const METRIC_SUFFIX = /\s*(?:arr|mrr|aum|(?:in |of )?(?:annual )?revenue|under management)$/;

const SHAPES: ReadonlyArray<[RegExp, 'range' | 'typical' | 'average_first' | 'lower_bound' | 'upper_bound' | 'exact']> = [
  [/^# ?(?:-|–|—|to) ?#$/, 'range'],
  [/^between # and #$/, 'range'],
  [/^(?:up to|upto|max(?:imum)?\.?|below|under|less than|<=?) ?#$/, 'upper_bound'],
  [/^(?:min(?:imum)?\.?|from|at least|over|above|more than|>=?) ?#$/, 'lower_bound'],
  [/^# ?\+$/, 'lower_bound'],
  [/^# (?:and above|or more|minimum|min)$/, 'lower_bound'],
  [/^typical(?:ly)?(?: (?:cheque|check|ticket)(?: size)?)?(?: of| is)? ?#$/, 'typical'],
  [/^(?:average|avg\.?) first (?:cheque|check|ticket)(?: size)?(?: of| is)? ?#$/, 'average_first'],
  [/^#$/, 'exact'],
];

/** A number as written → its value, or NaN when the separators are ambiguous. */
function numberOf(s: string): number {
  if (/^\d+$/.test(s) || /^\d+\.\d+$/.test(s)) return Number(s);
  if (/^\d{1,3}(?:,\d{3})+(?:\.\d+)?$/.test(s)) return Number(s.replace(/,/g, ''));
  if (/^\d{1,3}(?:\.\d{3}){2,}(?:,\d+)?$/.test(s)) return Number(s.replace(/\./g, '').replace(',', '.'));
  if (/^\d+,\d{1,2}$/.test(s)) return Number(s.replace(',', '.'));
  return NaN;
}

const symbolAgrees = (sym: string, mark: string) =>
  mark.length === 1 ? sym === mark : (sym === '€' ? mark === 'EUR' : sym === '£' ? mark === 'GBP' : mark.endsWith('D'));

function codesIn(text: string): string[] {
  return [...text.matchAll(/(?<![A-Za-z])([A-Z]{3})(?![A-Za-z])/g)].map((m) => m[1]).filter((c) => !NOT_CURRENCY.has(c));
}

/**
 * The amount a money statement states. `fact` comes from the caller and is
 * returned as given. A closed set of shapes is read; everything else is
 * as_stated with no amounts. A bare symbol gives no currency (basis
 * symbol_only); two units in one value, a symbol that disagrees with its
 * heading, a trailing question mark or more than one amount give as_stated
 * with the matching flag.
 */
export function readAmount(fact: MoneyFact, wording: string, heading?: string | null): AmountReading {
  if (!isMoneyFact(fact)) throw new ObservationInputError('fact_not_money');
  const text = String(wording ?? '').trim();
  const flags = new Set<ReviewFlag>();
  if (text.endsWith('?')) flags.add('trailing_question_mark');
  if (TWO_UNITS.test(text)) flags.add('two_units');

  const amounts: { value: number; unit: string | null }[] = [];
  const amountRe = new RegExp(`([€£$])?\\s*(\\d+(?:[.,]\\d+)*)\\s*(${UNIT})?(?![a-z])`, 'gi');
  const shape = text.replace(/\?+$/, '').replace(amountRe, (_m, _sym, num: string, unit: string | undefined) => {
    amounts.push({ value: numberOf(num), unit: unit ? unit.toLowerCase() : null });
    return ' # ';
  });

  // Currency marks in the wording: symbols anywhere, codes beside an amount.
  const symbols = new Set(text.match(SYMBOL_RE) ?? []);
  const codes = new Set([...shape.matchAll(/([A-Z]{3})\s*#|#\s*([A-Z]{3})(?![A-Za-z])/g)]
    .map((m) => m[1] ?? m[2]).filter((c) => !NOT_CURRENCY.has(c)));
  const headingMarks = new Set([...codesIn(String(heading ?? '')), ...(String(heading ?? '').match(SYMBOL_RE) ?? [])]);

  let currency: string | null = null;
  let basis: CurrencyBasis;
  if (codes.size > 1 || symbols.size > 1) basis = 'conflicting';
  else if (codes.size === 1) {
    const code = [...codes][0];
    const sym = [...symbols][0];
    const headingDisagrees = [...headingMarks].some((m) => (m.length === 1 ? !symbolAgrees(m, code) : m !== code));
    if ((sym && !symbolAgrees(sym, code)) || headingDisagrees) basis = 'conflicting';
    else { basis = 'stated'; currency = code; }
  } else if (symbols.size === 1) {
    const sym = [...symbols][0];
    if ([...headingMarks].some((m) => !symbolAgrees(sym, m))) { basis = 'conflicting'; flags.add('symbol_heading_conflict'); }
    else basis = 'symbol_only';
  } else basis = headingMarks.size === 1 ? 'heading_only' : headingMarks.size > 1 ? 'conflicting' : 'not_stated';

  const form = shape.replace(/[€£$]/g, ' ').replace(/(?<![A-Za-z])[A-Z]{3}(?![A-Za-z])/g, (c) => (codes.has(c) ? ' ' : c))
    .toLowerCase().replace(/\s+/g, ' ').trim().replace(/[.:]$/, '').replace(METRIC_SUFFIX, '').trim();
  const kind = SHAPES.find(([re]) => re.test(form))?.[1];
  if (amounts.length >= 2 && !(kind === 'range' && amounts.length === 2)) flags.add('multiple_amounts');

  const asStated = (): AmountReading => ({
    fact, qualifier: 'as_stated', min_cents: null, max_cents: null, point_cents: null, currency, currency_basis: basis,
    review_flags: flags.size ? REVIEW_FLAGS.filter((f) => flags.has(f)) : null,
  });
  if (flags.size || !kind || amounts.length === 0) return asStated();

  if (kind === 'range' && !amounts[0].unit) amounts[0].unit = amounts[1].unit;
  const cents = amounts.map(({ value, unit }) => Math.round(value * (unit ? MULTIPLIER[unit] : 1) * 100));
  if (cents.some((c) => !Number.isSafeInteger(c) || c < 0)) return asStated();
  const base = { fact, currency, currency_basis: basis, review_flags: null, min_cents: null, max_cents: null, point_cents: null };
  switch (kind) {
    case 'range':
      return cents[0] <= cents[1] ? { ...base, qualifier: 'range', min_cents: cents[0], max_cents: cents[1] } : asStated();
    case 'lower_bound': return { ...base, qualifier: 'lower_bound', min_cents: cents[0] };
    case 'upper_bound': return { ...base, qualifier: 'upper_bound', max_cents: cents[0] };
    default: return { ...base, qualifier: kind, point_cents: cents[0] };
  }
}

// ---------------------------------------------------------------------------
// The writer.
// ---------------------------------------------------------------------------

export class ObservationInputError extends Error {
  code: string;
  constructor(code: string) { super(code); this.code = code; this.name = 'ObservationInputError'; }
}

export interface ObservationInput {
  fund_uid: string;
  fact: ObservationFact;
  wording: string;
  source_name: string;
  source_url?: string | null;
  source_record_ref: string;
  reported_on?: string | null;
  period_start?: string | null;
  period_end?: string | null;
  imported_on: string;
  promoted_by_user_id?: number | null;
  promoted_at?: string | null;
  method: Method;
  /** The column heading the wording sat under, for a money fact's currency basis. */
  heading?: string | null;
  /** A reviewed reading of a money fact; otherwise `readAmount` reads the wording. */
  amount?: AmountReading;
}

export interface ObservationWrites {
  statements: D1PreparedStatement[];
  /** Stage and geography statements whose wording left a piece no rule recognised. */
  unmapped: { stage: number; geography: number };
}

const KEY = 'fund_uid = ? AND fact = ? AND source_name = ? AND source_record_ref = ?';

/**
 * Prepared statements that write `inputs` (one upsert per statement, then its
 * terms replaced), for the caller's batch. Throws ObservationInputError on an
 * input the table would refuse for its shape; the database refuses the rest.
 */
export function observationStatements(db: D1Database, inputs: ObservationInput[]): ObservationWrites {
  const statements: D1PreparedStatement[] = [];
  const unmapped = { stage: 0, geography: 0 };
  for (const o of inputs) {
    if (!isFact(o.fact)) throw new ObservationInputError('fact_unknown');
    const wording = typeof o.wording === 'string' ? o.wording : '';
    if (!wording.trim()) throw new ObservationInputError('wording_blank');
    if ([...wording].length > WORDING_MAX) throw new ObservationInputError('wording_too_long');
    if (!String(o.source_record_ref ?? '').trim()) throw new ObservationInputError('source_record_ref_blank');
    const money = isMoneyFact(o.fact) ? (o.amount ?? readAmount(o.fact, wording, o.heading)) : null;
    if (money && money.fact !== o.fact) throw new ObservationInputError('amount_fact_mismatch');
    const key = [o.fund_uid, o.fact, o.source_name, o.source_record_ref];
    statements.push(db.prepare(
      `INSERT INTO research_fund_observations
         (fund_uid, fact, wording, source_name, source_url, source_record_ref, reported_on, period_start, period_end,
          imported_on, promoted_by_user_id, promoted_at, method, qualifier, min_cents, max_cents, point_cents,
          currency, currency_basis, review_flags)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (fund_uid, fact, source_name, source_record_ref) DO UPDATE SET
         wording = excluded.wording, source_url = excluded.source_url, reported_on = excluded.reported_on,
         period_start = excluded.period_start, period_end = excluded.period_end, imported_on = excluded.imported_on,
         promoted_by_user_id = excluded.promoted_by_user_id, promoted_at = excluded.promoted_at, method = excluded.method,
         qualifier = excluded.qualifier, min_cents = excluded.min_cents, max_cents = excluded.max_cents,
         point_cents = excluded.point_cents, currency = excluded.currency, currency_basis = excluded.currency_basis,
         review_flags = excluded.review_flags`,
    ).bind(
      o.fund_uid, o.fact, wording, o.source_name, o.source_url ?? null, o.source_record_ref, o.reported_on ?? null,
      o.period_start ?? null, o.period_end ?? null, o.imported_on, o.promoted_by_user_id ?? null, o.promoted_at ?? null,
      o.method, money?.qualifier ?? null, money?.min_cents ?? null, money?.max_cents ?? null, money?.point_cents ?? null,
      money?.currency ?? null, money?.currency_basis ?? null, money?.review_flags ? JSON.stringify(money.review_flags) : null,
    ));
    statements.push(db.prepare(
      `DELETE FROM research_fund_observation_terms WHERE observation_id = (SELECT id FROM research_fund_observations WHERE ${KEY})`,
    ).bind(...key));
    const terms: [string, string][] = [];
    if (o.fact === 'investment_stage') {
      const s = normaliseStage(wording);
      s.terms.forEach((t) => terms.push(['stage', t]));
      if (s.unmatched.length) unmapped.stage++;
    } else if (o.fact === 'investment_geography') {
      const g = normaliseGeography(wording);
      g.countries.forEach((t) => terms.push(['country', t]));
      g.regions.forEach((t) => terms.push(['region', t]));
      if (g.unmatched.length) unmapped.geography++;
    }
    for (const [vocabulary, term] of terms) {
      statements.push(db.prepare(
        `INSERT INTO research_fund_observation_terms (observation_id, vocabulary, term)
         SELECT id, ?, ? FROM research_fund_observations WHERE ${KEY}`,
      ).bind(vocabulary, term, ...key));
    }
  }
  return { statements, unmapped };
}

// ---------------------------------------------------------------------------
// The served read.
// ---------------------------------------------------------------------------

export interface FundStatement {
  /** 'statement' from this store; 'vehicle_fact' from research_fund_vehicle_facts (D7167). */
  origin: 'statement' | 'vehicle_fact';
  fund_uid: string;
  fact: ObservationFact;
  /** The source's text. NULL only for a vehicle_fact cheque, which recorded no wording. */
  wording: string | null;
  source_name: string;
  source_url: string | null;
  verdict: FundSourceVerdict | null;
  reported_on: string | null;
  period_start: string | null;
  period_end: string | null;
  imported_on: string | null;
  method: Method | null;
  qualifier: Qualifier | null;
  min_cents: number | null;
  max_cents: number | null;
  point_cents: number | null;
  currency: string | null;
  /** NULL on a text fact, and on a vehicle_fact cheque, whose table records no basis. */
  currency_basis: CurrencyBasis | null;
  review_flags: ReviewFlag[] | null;
  terms: { vocabulary: 'stage' | 'country' | 'region'; term: string }[];
}

export interface FundStatements { current: FundStatement[]; past: FundStatement[] }

/** The order every reader shows: latest reported_on first, undated last, then latest imported_on, then list name. */
export function compareStatements(a: Pick<FundStatement, 'reported_on' | 'imported_on' | 'source_name'>,
  b: Pick<FundStatement, 'reported_on' | 'imported_on' | 'source_name'>): number {
  const desc = (x: string | null, y: string | null) => (x === y ? 0 : x == null ? 1 : y == null ? -1 : x < y ? 1 : -1);
  return desc(a.reported_on, b.reported_on) || desc(a.imported_on, b.imported_on)
    || (a.source_name === b.source_name ? 0 : a.source_name < b.source_name ? -1 : 1);
}

interface ObservationRow {
  id: number; fund_uid: string; fact: ObservationFact; wording: string; source_name: string; source_url: string | null;
  verdict: FundSourceVerdict; reported_on: string | null; period_start: string | null; period_end: string | null;
  imported_on: string; method: Method; qualifier: Qualifier | null; min_cents: number | null; max_cents: number | null;
  point_cents: number | null; currency: string | null; currency_basis: CurrencyBasis | null; review_flags: string | null;
}

interface VehicleFactRow {
  fund_uid: string; field: ObservationFact; value_text: string | null; min_cents: number | null; max_cents: number | null;
  currency: string | null; source_name: string; source_url: string | null; reported_on: string | null; imported_on: string;
  verdict: FundSourceVerdict | null;
}

function flagsOf(raw: string | null): ReviewFlag[] | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? REVIEW_FLAGS.filter((f) => v.includes(f)) : null;
  } catch { return null; }
}

function vehicleFactStatement(v: VehicleFactRow): FundStatement {
  const cheque = v.field === 'initial_cheque';
  const qualifier: Qualifier | null = !cheque ? null
    : v.min_cents != null && v.max_cents != null ? 'range' : v.min_cents != null ? 'lower_bound' : 'upper_bound';
  return {
    origin: 'vehicle_fact', fund_uid: v.fund_uid, fact: v.field, wording: cheque ? null : v.value_text,
    source_name: v.source_name, source_url: v.source_url, verdict: v.verdict, reported_on: v.reported_on,
    period_start: null, period_end: null, imported_on: v.imported_on, method: null, qualifier,
    min_cents: cheque ? v.min_cents : null, max_cents: cheque ? v.max_cents : null, point_cents: null,
    currency: cheque ? v.currency : null, currency_basis: null, review_flags: null, terms: [],
  };
}

/**
 * Every served statement about `uids`, by uid, current and past apart, each
 * list in `compareStatements` order. A statement stored under a uid that moved
 * is returned under the new uid (one hop).
 */
export async function readFundStatements(env: Env, uids: string[]): Promise<Map<string, FundStatements>> {
  const out = new Map<string, FundStatements>();
  const wanted = [...new Set(uids)];
  if (!wanted.length) return out;
  const r = await env.DB.prepare(
    `SELECT o.id, COALESCE(m.new_uid, o.fund_uid) AS fund_uid, o.fact, o.wording, o.source_name, o.source_url,
            s.verdict, o.reported_on, o.period_start, o.period_end, o.imported_on, o.method, o.qualifier,
            o.min_cents, o.max_cents, o.point_cents, o.currency, o.currency_basis, o.review_flags
       FROM research_fund_observations o
       JOIN research_fund_sources s ON s.source_name = o.source_name
       LEFT JOIN research_fund_directory_uid_moves m ON m.old_uid = o.fund_uid
      WHERE COALESCE(m.new_uid, o.fund_uid) IN (SELECT value FROM json_each(?))
        AND o.fact IN (SELECT value FROM json_each(?))
        AND s.verdict <> 'not allowed'
        AND (o.fact <> 'description' OR s.verdict = 'republish allowed')`,
  ).bind(JSON.stringify(wanted), JSON.stringify(SERVED_FACTS)).all<ObservationRow>();
  const rows = r.results || [];

  const terms = new Map<number, FundStatement['terms']>();
  if (rows.length) {
    const t = await env.DB.prepare(
      `SELECT observation_id, vocabulary, term FROM research_fund_observation_terms
        WHERE observation_id IN (SELECT value FROM json_each(?)) ORDER BY vocabulary, term`,
    ).bind(JSON.stringify(rows.map((x) => x.id))).all<{ observation_id: number; vocabulary: 'stage' | 'country' | 'region'; term: string }>();
    for (const x of t.results || []) {
      if (!terms.has(x.observation_id)) terms.set(x.observation_id, []);
      terms.get(x.observation_id)!.push({ vocabulary: x.vocabulary, term: x.term });
    }
  }

  // research_fund_vehicle_facts under main's own gate (researchFundProfile.loadVehicleFacts).
  const v = await env.DB.prepare(
    `SELECT v.fund_uid, v.field, v.value_text, v.min_cents, v.max_cents, v.currency,
            v.source_name, v.source_url, v.reported_on, v.imported_on, s.verdict
       FROM research_fund_vehicle_facts v
       LEFT JOIN research_fund_sources s ON s.source_name = v.source_name
      WHERE v.fund_uid IN (SELECT value FROM json_each(?))
        AND NOT EXISTS (SELECT 1 FROM research_fund_sources n WHERE n.source_name = v.source_name AND n.verdict = 'not allowed')`,
  ).bind(JSON.stringify(wanted)).all<VehicleFactRow>();

  const all: FundStatement[] = [
    ...rows.map((o): FundStatement => ({
      origin: 'statement', fund_uid: o.fund_uid, fact: o.fact, wording: o.wording, source_name: o.source_name,
      source_url: o.source_url, verdict: o.verdict, reported_on: o.reported_on, period_start: o.period_start,
      period_end: o.period_end, imported_on: o.imported_on, method: o.method, qualifier: o.qualifier,
      min_cents: o.min_cents, max_cents: o.max_cents, point_cents: o.point_cents, currency: o.currency,
      currency_basis: o.currency_basis, review_flags: flagsOf(o.review_flags), terms: terms.get(o.id) ?? [],
    })),
    ...(v.results || []).filter((x) => SERVED_FACTS.includes(x.field)).map(vehicleFactStatement),
  ];
  for (const s of all.sort(compareStatements)) {
    if (!out.has(s.fund_uid)) out.set(s.fund_uid, { current: [], past: [] });
    const bucket = out.get(s.fund_uid)!;
    (s.period_start != null || s.period_end != null ? bucket.past : bucket.current).push(s);
  }
  return out;
}
