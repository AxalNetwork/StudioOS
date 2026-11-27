/**
 * D7704 (#7704) — market sizing, formula version 2: TAM, SAM and SOM computed
 * by the Worker from the inputs saved with them. The formula is pure; the D7725
 * block at the end reads the stores an input's source names, and writes nothing.
 *
 * WHAT IT REPLACES. The sizing page computed the figures in the browser: a
 * blank or zero serviceable share became 14%, a blank win rate 8%, SOM was
 * multiplied by 2.2, a missing TAM fell back to the venture's earlier TAM,
 * and runway and sales capacity were never read. None of that is here: a
 * required input that is blank is refused by name, and nothing has a default.
 *
 * NUMBERS (owner question 3, option A). Blank is not entered; `0` is zero. A
 * stored text is read by one stated grammar (`readFigure`): an optional `$`,
 * digits with optional comma thousands groups, an optional decimal part, then
 * optionally `%` or a unit in words ('41,200 firms', '$18,000 / year'). A
 * scale word ('k', 'million', 'bn') or a second number is outside the grammar
 * and is refused by field name, never cut short. Negative and non-finite
 * values are refused; a percentage is 0 to 100.
 *
 * UNITS. The TAM override is in millions of USD, as the drawer labels it.
 * Every figure is whole USD, rounded once, from unrounded arithmetic. USD only,
 * as `projects.tam/.sam/.som` and `market_figures` are.
 *
 * THE FORMULA (owner question 1, option A).
 *   TAM = the override when one is entered (zero included; a reason is
 *         required), else eligible accounts × annual revenue per account.
 *         Both are kept.
 *   SAM = TAM × serviceable share.
 *   SOM = the lower of
 *         SAM × win rate, and
 *         deals per month × selling months × annual revenue per account × retention share,
 *         where selling months = horizon months − one sales cycle (never below 0).
 * A sales cycle as long as the horizon leaves no selling month, so SOM is 0
 * and the result says so. SOM never exceeds SAM (the win rate is at most 100%).
 *
 * Runway (owner question 4, option A) is not an input: it stays on the
 * assumptions row as context and is never read here.
 */
import type { Env } from '../types';
import { ASSUMPTION_COLUMNS } from './marketAssumptions';
import { readObservation } from './researchObservations';

export const FORMULA_VERSION = 2;
export const SIZING_CURRENCY = 'USD';

type InputKind = 'count' | 'money' | 'percent' | 'months';

/** The formula's numeric inputs, keyed as the drawer and `project_market_assumptions` key them. */
export const SIZING_INPUTS = {
  population: { label: 'Eligible accounts', unit: 'accounts', kind: 'count' },
  acv: { label: 'Annual revenue per account', unit: 'USD per year', kind: 'money' },
  tamOverride: { label: 'TAM override', unit: 'USD millions', kind: 'money' },
  samPct: { label: 'Serviceable share', unit: 'percent', kind: 'percent' },
  winRate: { label: 'Win rate', unit: 'percent', kind: 'percent' },
  capacity: { label: 'Deals per month', unit: 'deals per month', kind: 'count' },
  horizonMonths: { label: 'Time horizon', unit: 'months', kind: 'months' },
  salesCycleMonths: { label: 'Sales cycle', unit: 'months', kind: 'months' },
  retentionPct: { label: 'Retention share', unit: 'percent', kind: 'percent' },
} as const satisfies Record<string, { label: string; unit: string; kind: InputKind }>;
export type SizingInputKey = keyof typeof SIZING_INPUTS;
export const SIZING_INPUT_KEYS = Object.keys(SIZING_INPUTS) as SizingInputKey[];

/** Required under option A, in the order a missing one is reported. `population` only when TAM is not overridden. */
const REQUIRED: readonly SizingInputKey[] = ['population', 'acv', 'samPct', 'winRate', 'capacity', 'horizonMonths', 'salesCycleMonths', 'retentionPct'];

/** The field's name in a refusal code: the assumptions column (`samPct` → `sam_pct`). */
export const fieldCode = (key: string): string => ASSUMPTION_COLUMNS[key] ?? key.replace(/[A-Z]/g, (m) => `_${m.toLowerCase()}`);

/** A refused input. `sentence` is our own sentence for the refusal body, naming the field. */
export class SizingInputError extends Error {
  code: string;
  field: string;
  fields: string[];
  sentence: string;
  constructor(code: string, field: string, sentence: string, fields: string[] = [field]) {
    super(sentence); this.code = code; this.field = field; this.fields = fields; this.sentence = sentence;
  }
}

const SCALE_WORDS = new Set(['k', 'm', 'mm', 'mn', 'b', 'bn', 't', 'tn', 'thousand', 'thousands', 'million', 'millions', 'billion', 'billions', 'trillion', 'trillions']);
const FIGURE = /^(\$\s?)?(\d{1,3}(?:,\d{3})+|\d+)(\.\d+)?(.*)$/;
const UNIT_WORDS = /^(?:\/\s*)?[A-Za-z][A-Za-z ./-]*$/;

export type ReadFigure =
  | { state: 'blank' }
  | { state: 'ok'; value: number; text: string | null }
  | { state: 'malformed' | 'negative' | 'out_of_range' };

/**
 * One stored or sent value → a number, by the grammar in this file's header.
 * A JSON number is taken as it is (finite and not negative).
 */
export function readFigure(raw: unknown, kind: InputKind): ReadFigure {
  if (raw == null) return { state: 'blank' };
  if (typeof raw === 'number') {
    if (!Number.isFinite(raw)) return { state: 'malformed' };
    if (raw < 0) return { state: 'negative' };
    if (kind === 'percent' && raw > 100) return { state: 'out_of_range' };
    return { state: 'ok', value: raw, text: null };
  }
  if (typeof raw !== 'string') return { state: 'malformed' };
  const text = raw.trim();
  if (text === '') return { state: 'blank' };
  if (/^[-−–]\s*\$?\s*\d/.test(text) || /^\$\s?[-−–]\s*\d/.test(text)) return { state: 'negative' };
  const m = FIGURE.exec(text);
  if (!m) return { state: 'malformed' };
  const [, currency, int, frac = '', restRaw] = m;
  if (currency && kind !== 'money') return { state: 'malformed' };
  const rest = restRaw.trim();
  if (rest) {
    if (rest === '%') {
      if (kind !== 'percent') return { state: 'malformed' };
    } else {
      // A unit in words, separated from the number by a space or a slash.
      if (!/^\s/.test(restRaw) && !rest.startsWith('/')) return { state: 'malformed' };
      if (!UNIT_WORDS.test(rest)) return { state: 'malformed' };
      const first = rest.replace(/^\/\s*/, '').split(/[\s/]+/)[0].replace(/\.$/, '').toLowerCase();
      if (SCALE_WORDS.has(first)) return { state: 'malformed' };
    }
  }
  const value = Number(`${int.replace(/,/g, '')}${frac}`);
  if (!Number.isFinite(value)) return { state: 'malformed' };
  if (kind === 'percent' && value > 100) return { state: 'out_of_range' };
  return { state: 'ok', value, text };
}

const MESSAGES = {
  missing: (label: string) => `${label} is required to size the market. Enter it, or 0 if it is zero.`,
  malformed: (label: string) => `${label} is not a number this page can read. Type a figure such as 41,200 or $18,000 / year, without a word like "k" or "million".`,
  negative: (label: string) => `${label} cannot be negative.`,
  out_of_range: (label: string) => `${label} is a percentage, so it must be between 0 and 100.`,
};

export type SizingInput = { key: SizingInputKey; value: number; typed_text: string | null; unit: string };
export type SomLimit = 'win_rate' | 'capacity' | 'both';

export type SizingResult = {
  formula_version: number;
  currency: string;
  inputs: SizingInput[];
  computed_tam: number | null;
  tam_override: number | null;
  tam_override_reason: string | null;
  tam: number;
  sam: number;
  som: number;
  som_by_win_rate: number;
  som_by_capacity: number;
  selling_months: number;
  som_limit: SomLimit;
  reference_year: number | null;
  horizon_months: number;
  /** D7725: 'annual' or 'cumulative' as the save said; null when it did not say (read per year). */
  revenue_basis: RevenueBasis | null;
  /** The formula in words, one line per figure, with this version's numbers. */
  formula: string[];
  /** Anything the reader must be told about this result (a sales cycle that leaves no selling month). */
  notes: string[];
};

const usd = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`;
const plain = (n: number) => (Number.isInteger(n) ? n.toLocaleString('en-US') : String(n));

/**
 * Size the market from one set of inputs, or throw a `SizingInputError`
 * naming the field. `raw` is keyed as the drawer is (`samPct`, `tamOverride`,
 * `tamOverrideReason`, `targetYear`); keys this formula does not read are
 * ignored here (the route checks them against the assumptions store).
 */
export function sizeMarket(raw: Record<string, unknown>): SizingResult {
  const read: Partial<Record<SizingInputKey, { value: number; text: string | null }>> = {};
  for (const key of SIZING_INPUT_KEYS) {
    const def = SIZING_INPUTS[key];
    const r = readFigure(raw[key], def.kind);
    if (r.state === 'blank') continue;
    if (r.state !== 'ok') throw new SizingInputError(`invalid_${fieldCode(key)}`, key, MESSAGES[r.state](def.label));
    read[key] = { value: r.value, text: r.text };
  }

  const overridden = read.tamOverride !== undefined;
  const missing = REQUIRED.filter((k) => read[k] === undefined && !(k === 'population' && overridden));
  if (missing.length) {
    throw new SizingInputError(`missing_${fieldCode(missing[0])}`, missing[0], MESSAGES.missing(SIZING_INPUTS[missing[0]].label), missing);
  }
  const reasonRaw = raw.tamOverrideReason == null ? '' : String(raw.tamOverrideReason).trim();
  if (overridden && !reasonRaw) {
    throw new SizingInputError('missing_tam_override_reason', 'tamOverrideReason', 'A TAM override needs a reason. Say why it replaces eligible accounts × annual revenue per account.');
  }

  let referenceYear: number | null = null;
  const yearRaw = raw.targetYear == null ? '' : String(raw.targetYear).trim();
  if (yearRaw) {
    if (!/^\d{4}$/.test(yearRaw)) throw new SizingInputError('invalid_target_year', 'targetYear', 'The reference year must be a year such as 2027.');
    referenceYear = Number(yearRaw);
  }

  // D7725: whether revenue per account is per year or the total over the horizon. Absent (every
  // version saved before D7725, and a save in #7704's shape that does not say) reads it per year,
  // as formula version 2 always did, so those versions recompute to the same figures.
  let revenueBasis: RevenueBasis | null = null;
  if (raw.revenueBasis != null) {
    if (!(REVENUE_BASES as readonly unknown[]).includes(raw.revenueBasis)) {
      throw new SizingInputError('invalid_revenue_basis', 'revenueBasis', SCENARIO_REFUSALS.invalid_revenue_basis);
    }
    revenueBasis = raw.revenueBasis as RevenueBasis;
  }

  const v = (k: SizingInputKey) => (read[k] as { value: number }).value;
  const enteredAcv = v('acv');
  if (revenueBasis === 'cumulative' && v('horizonMonths') === 0) {
    throw new SizingInputError('cumulative_revenue_needs_horizon', 'horizonMonths', SCENARIO_REFUSALS.cumulative_revenue_needs_horizon);
  }
  const acv = revenueBasis === 'cumulative' ? (enteredAcv * 12) / v('horizonMonths') : enteredAcv;
  const computedRaw = read.population !== undefined ? read.population.value * acv : null;
  const tamRaw = overridden ? v('tamOverride') * 1e6 : (computedRaw as number);
  const share = v('samPct') / 100;
  const winShare = v('winRate') / 100;
  const retention = v('retentionPct') / 100;
  const deals = v('capacity');
  const horizon = v('horizonMonths');
  const cycle = v('salesCycleMonths');

  const samRaw = tamRaw * share;
  const somWinRaw = samRaw * winShare;
  const sellingMonths = Math.max(0, horizon - cycle);
  const somCapRaw = deals * sellingMonths * acv * retention;
  const somRaw = Math.min(somWinRaw, somCapRaw);
  const somLimit: SomLimit = somWinRaw === somCapRaw ? 'both' : somWinRaw < somCapRaw ? 'win_rate' : 'capacity';

  const tam = Math.round(tamRaw);
  const sam = Math.round(samRaw);
  const som = Math.round(somRaw);
  for (const n of [tam, sam, som, Math.round(somCapRaw)]) {
    if (!Number.isSafeInteger(n)) {
      throw new SizingInputError('market_size_out_of_range', overridden ? 'tamOverride' : 'population', 'These inputs give a figure too large to store. Check the units: the TAM override is in millions of USD.');
    }
  }

  const formula: string[] = [];
  if (revenueBasis === 'cumulative') {
    formula.push(`Annual revenue per account = revenue per account over the time horizon (${usd(enteredAcv)}) × 12 ÷ ${plain(horizon)} months = ${usd(acv)}.`);
  }
  if (overridden) {
    formula.push(`TAM = the override, ${usd(tamRaw)} (${plain(v('tamOverride'))} million USD), because: ${reasonRaw}.`
      + (computedRaw == null ? ' Eligible accounts were not entered, so no computed TAM is kept beside it.'
        : ` Eligible accounts × annual revenue per account would give ${usd(computedRaw)}.`));
  } else {
    formula.push(`TAM = eligible accounts (${plain(v('population'))}) × annual revenue per account (${usd(acv)}) = ${usd(tamRaw)}.`);
  }
  formula.push(`SAM = TAM × serviceable share (${plain(v('samPct'))}%) = ${usd(samRaw)}.`);
  formula.push(`SOM = the lower of SAM × win rate (${plain(v('winRate'))}%) = ${usd(somWinRaw)}, and deals per month (${plain(deals)}) × selling months (${plain(horizon)} − ${plain(cycle)} = ${plain(sellingMonths)}) × annual revenue per account (${usd(acv)}) × retention share (${plain(v('retentionPct'))}%) = ${usd(somCapRaw)}.`);
  formula.push(somLimit === 'win_rate' ? 'SOM is set by the win rate.'
    : somLimit === 'capacity' ? 'SOM is set by sales capacity over the time horizon.'
      : 'The win rate and sales capacity give the same SOM.');

  const notes: string[] = [];
  if (sellingMonths === 0) {
    notes.push(`The sales cycle (${plain(cycle)} months) is as long as the time horizon (${plain(horizon)} months) or longer, so no deal closes within it: SOM is 0.`);
  }

  return {
    formula_version: FORMULA_VERSION,
    currency: SIZING_CURRENCY,
    inputs: SIZING_INPUT_KEYS.filter((k) => read[k] !== undefined).map((k) => ({
      key: k, value: (read[k] as { value: number }).value, typed_text: (read[k] as { text: string | null }).text, unit: SIZING_INPUTS[k].unit,
    })),
    computed_tam: computedRaw == null ? null : Math.round(computedRaw),
    tam_override: overridden ? tam : null,
    tam_override_reason: overridden ? reasonRaw : null,
    tam, sam, som,
    som_by_win_rate: Math.round(somWinRaw),
    som_by_capacity: Math.round(somCapRaw),
    selling_months: sellingMonths,
    som_limit: somLimit,
    reference_year: referenceYear,
    horizon_months: horizon,
    revenue_basis: revenueBasis,
    formula,
    notes,
  };
}

/** A stored version and its input rows, as `market_sizing_versions` and `market_sizing_version_inputs` hold them. */
export type StoredVersion = {
  computed_tam: number | null; tam_override: number | null; tam_override_reason: string | null;
  tam: number; sam: number; som: number; som_limit: string; reference_year: number | null; horizon_months: number;
  /** D7725; absent or null on every version saved before it. */
  revenue_basis?: string | null;
};
export type StoredInput = { input_key: string; value: number };

/**
 * Recompute a stored version from its own rows. True when every stored figure
 * (computed TAM, override, TAM, SAM, SOM and the limit that set SOM) is what
 * formula version 2 gives for the stored inputs.
 */
export function recomputesToStored(version: StoredVersion, inputs: readonly StoredInput[]): boolean {
  const raw: Record<string, unknown> = {
    tamOverrideReason: version.tam_override_reason,
    targetYear: version.reference_year == null ? null : String(version.reference_year),
    revenueBasis: version.revenue_basis ?? null,
  };
  for (const r of inputs) raw[r.input_key] = Number(r.value);
  let again: SizingResult;
  try { again = sizeMarket(raw); } catch { return false; }
  const same = (a: unknown, b: unknown) => (a == null && b == null) || Number(a) === Number(b);
  return same(again.computed_tam, version.computed_tam) && same(again.tam_override, version.tam_override)
    && same(again.tam, version.tam) && same(again.sam, version.sam) && same(again.som, version.som)
    && again.som_limit === version.som_limit && same(again.horizon_months, version.horizon_months);
}

/* ------------------------------------------------------------------------------------------------
 * D7725 (#7725) — where each input came from, low/base/high scenarios, sensitivity, a top-down check
 * and evidence that a newer vintage has superseded. Additions only: formula version 2 above is
 * unchanged, and a version saved before D7725 recomputes to the same figures.
 *
 * THE LABELLED SHAPE. A save that sends `scenarios` or `top_down` must label every input, in every
 * scenario, with one of four kinds:
 *   observation    a shared row of #7716's query, by its id. Its value (times its published
 *                  scale), unit, period, vintage, currency and source name are copied at save time.
 *   market_source  one of the venture's own `market_sources` rows; another venture's is refused.
 *   eadwyn_fill    the accepted, cited `market_input` fill `fill_provenance` holds for this input.
 *   assumption     with a note saying why it applies.
 * The Worker copies titles, links and values from the stored rows, never from the client, and
 * never picks a kind for the person. A save in #7704's shape (no `scenarios`, no `top_down`) is
 * still accepted; its inputs read back as `not_labelled`.
 * ---------------------------------------------------------------------------------------------- */

export const REVENUE_BASES = ['annual', 'cumulative'] as const;
export type RevenueBasis = (typeof REVENUE_BASES)[number];
export const SOURCE_KINDS = ['observation', 'market_source', 'eadwyn_fill', 'assumption'] as const;
export type SourceKind = (typeof SOURCE_KINDS)[number];
export const SCENARIOS = ['low', 'base', 'high'] as const;
export type Scenario = (typeof SCENARIOS)[number];
/** The top-down total's key in the estimates table. Millions, as the TAM override is. */
export const TOP_DOWN_KEY = 'topDownTotal';
const MAX_ESTIMATES = 5;
const MAX_TEXT = 200;
/** An accepted Eadwyn fill exists for these inputs only (`services/fills/registry.ts`, `market_input`). */
const FILL_COLUMNS: Partial<Record<string, string>> = { population: 'population', acv: 'acv' };
const SCALE_FACTOR: Record<string, number> = { units: 1, thousands: 1e3, millions: 1e6, billions: 1e9, trillions: 1e12 };

/** Stated on every version read. */
export const SIZING_LIMITATION = 'This formula does not handle overlapping segments or organisations with several locations: an account in two segments, or one organisation with several sites, is counted more than once.';

/** One sentence per refusal code this block adds. */
export const SCENARIO_REFUSALS = {
  invalid_scenarios: 'Scenarios are base alone, or low, base and high together.',
  invalid_scenario: 'A scenario sends its inputs as an object keyed by input name.',
  unknown_sizing_input: 'That is not an input of the sizing formula.',
  inputs_sent_twice: 'This save sends its inputs in scenarios, so leave the sizing inputs and their labels out of assumptions.',
  missing_input_source: 'Every input in this save needs a source: an observation, one of this venture’s sources, an accepted Eadwyn fill, or the label assumption with a note.',
  invalid_input_source: 'An input’s source is an observation, one of this venture’s sources, an accepted Eadwyn fill or an assumption.',
  missing_assumption_note: 'An input labelled assumption needs a note saying why it applies.',
  input_note_too_long: `A note on an input is at most ${MAX_TEXT} characters.`,
  observation_not_found: 'That observation was not found.',
  observation_has_no_value: 'That observation holds no value, so it cannot be used as an input.',
  invalid_input_market_source: 'That source is not one of this venture’s sources.',
  no_eadwyn_fill: 'Eadwyn has no accepted, cited fill for this input on this venture.',
  eadwyn_fill_unreadable: 'The figure Eadwyn’s fill holds for this input is not a number this page can read.',
  value_comes_from_source: 'This input’s value, currency and year are copied from its source, so do not send different ones.',
  missing_input_value: 'This input needs its value.',
  missing_input_currency: 'A money input needs its currency.',
  invalid_input_currency: 'A currency is a three-letter code such as USD, and only a money input has one.',
  missing_currency_conversion: 'This input is not in USD, so it needs a conversion: a rate, its date, and a source or the label assumption.',
  invalid_currency_conversion: 'A conversion is a rate above 0 from the input’s currency to USD, with its date (YYYY-MM-DD) and its own source, and only an input in another currency has one.',
  missing_reference_year: 'This save needs the version’s reference year (targetYear).',
  missing_input_reference_year: 'A count or money input needs the year it describes.',
  missing_year_adjustment: 'This input describes a different year from the version, so it needs an adjustment with its source, or "used unadjusted" with a reason.',
  invalid_year_adjustment: 'An adjustment is a factor above 0 with its own source, or "used unadjusted" with a reason, and only an input from another year has one.',
  invalid_estimates: 'An input holds one to five estimates.',
  missing_used_estimate: 'An input with more than one estimate needs exactly one marked as used, with the reason.',
  missing_revenue_basis: 'Say whether revenue per account is annual or cumulative over the time horizon.',
  invalid_revenue_basis: 'Revenue per account is annual or cumulative over the time horizon.',
  cumulative_revenue_needs_horizon: 'Revenue over the time horizon cannot be made annual when the time horizon is 0 months.',
  invalid_top_down: 'A top-down check is one total, in millions, labelled as any input is.',
} as const;
export type ScenarioRefusal = keyof typeof SCENARIO_REFUSALS;

/** A refusal of the labelled shape: the code, its sentence, the field and the scenario. */
function refusal(code: ScenarioRefusal, field: string, scenario: Scenario | 'top_down' | null): SizingInputError {
  const e = new SizingInputError(code, field, SCENARIO_REFUSALS[code]);
  (e as SizingInputError & { scenario?: string | null }).scenario = scenario;
  return e;
}

/** Whether a save body is in the shape D7725 adds. */
export const isLabelledShape = (body: Record<string, unknown>): boolean => body.scenarios != null || body.top_down != null;

type Kind = InputKind | 'rate';
const KEY_KIND = (key: string): InputKind => (key === TOP_DOWN_KEY ? 'money' : SIZING_INPUTS[key as SizingInputKey].kind);
const needsYear = (kind: Kind) => kind === 'count' || kind === 'money';
const obj = (v: unknown): Record<string, any> | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, any>) : null);
const text = (v: unknown) => (v == null ? '' : String(v).trim());

/** What a source resolved to: the number, and what was copied beside it. */
export type ResolvedSource = {
  source_kind: SourceKind;
  original_value: number;
  typed_text: string | null;
  note: string | null;
  observation_id: number | null;
  market_source_id: number | null;
  fill_provenance_id: number | null;
  source_title: string | null;
  source_url: string | null;
  source_name: string | null;
  /** Copied from the stored row at save time; never rewritten. */
  evidence: Record<string, unknown> | null;
  currency: string | null;
  reference_year: number | null;
};

type Where = { scenario: Scenario | 'top_down' | null; field: string };

/** A number the client typed, read by formula version 2's grammar. */
function clientValue(raw: unknown, kind: Kind, at: Where): { value: number; text: string | null } {
  const r = readFigure(raw, kind === 'rate' ? 'count' : kind);
  if (r.state === 'blank') throw refusal('missing_input_value', at.field, at.scenario);
  if (r.state !== 'ok') {
    const label = at.field === TOP_DOWN_KEY ? 'The top-down total' : (SIZING_INPUTS as Record<string, { label: string }>)[at.field]?.label ?? 'This value';
    const e = new SizingInputError(`invalid_${fieldCode(at.field)}`, at.field, MESSAGES[r.state](label));
    (e as SizingInputError & { scenario?: string | null }).scenario = at.scenario;
    throw e;
  }
  return r;
}

/**
 * One labelled number → its value and what was copied for it. `inputKey` names the input an Eadwyn fill
 * is looked up for; a conversion rate or an adjustment factor has none, so a fill cannot label one.
 */
export async function resolveSource(env: Env, projectId: number, raw: Record<string, any>, kind: Kind, at: Where, inputKey: string | null): Promise<ResolvedSource> {
  const source = obj(raw.source);
  if (!source || source.kind == null) throw refusal('missing_input_source', at.field, at.scenario);
  const sk = source.kind;
  if (!(SOURCE_KINDS as readonly unknown[]).includes(sk)) throw refusal('invalid_input_source', at.field, at.scenario);
  const base: ResolvedSource = {
    source_kind: sk, original_value: 0, typed_text: null, note: null, observation_id: null, market_source_id: null,
    fill_provenance_id: null, source_title: null, source_url: null, source_name: null, evidence: null, currency: null, reference_year: null,
  };
  const fromStore = () => { if (raw.value != null && text(raw.value) !== '') throw refusal('value_comes_from_source', at.field, at.scenario); };

  if (sk === 'observation') {
    fromStore();
    const id = Number(source.observation_id);
    if (!Number.isSafeInteger(id) || id <= 0) throw refusal('observation_not_found', at.field, at.scenario);
    const found = await readObservation(env, id);
    if (!found) throw refusal('observation_not_found', at.field, at.scenario);
    const o = found.observation as Record<string, any>;
    if (o.value == null || !Number.isFinite(Number(o.value))) throw refusal('observation_has_no_value', at.field, at.scenario);
    const factor = o.scale == null ? 1 : SCALE_FACTOR[String(o.scale)];
    if (factor === undefined) throw refusal('observation_has_no_value', at.field, at.scenario);
    const year = /^(\d{4})/.exec(String(o.period ?? ''));
    return {
      ...base, original_value: Number(o.value) * factor, observation_id: id,
      source_title: String(found.source.name ?? ''), source_url: (found.source.source_url as string | null) ?? null,
      source_name: String(found.source.name ?? ''),
      evidence: {
        observation_id: id, value: Number(o.value), scale: o.scale ?? null, unit: o.unit ?? null, period: o.period ?? null,
        vintage: o.vintage ?? null, currency: o.currency ?? null, source_id: o.source_id ?? null, source_name: found.source.name ?? null,
        metric_key: o.metric_key ?? null, geography_code: o.geography_code ?? null,
      },
      currency: o.currency ?? null,
      reference_year: year ? Number(year[1]) : null,
    };
  }

  if (sk === 'eadwyn_fill') {
    fromStore();
    const column = inputKey ? FILL_COLUMNS[inputKey] : undefined;
    if (!column) throw refusal('no_eadwyn_fill', at.field, at.scenario);
    const wanted = source.fill_provenance_id == null ? null : Number(source.fill_provenance_id);
    const row = await env.DB.prepare(
      `SELECT fp.id, fp.written_value, fp.proposed_value, fp.edited, fp.citation_json, fp.created_at
         FROM fill_provenance fp JOIN project_market_assumptions a ON a.id = fp.target_row_id
        WHERE fp.target_table = 'project_market_assumptions' AND fp.target_column = ? AND a.project_id = ?
          AND fp.fill_class = 'sourced' AND fp.citation_json IS NOT NULL AND fp.undone_at IS NULL
          AND (? IS NULL OR fp.id = ?)
        ORDER BY fp.id DESC LIMIT 1`,
    ).bind(column, projectId, wanted, wanted).first<Record<string, any>>();
    if (!row) throw refusal('no_eadwyn_fill', at.field, at.scenario);
    let citation: Record<string, any> | null = null;
    try { citation = obj(JSON.parse(String(row.citation_json))); } catch { citation = null; }
    if (!citation) throw refusal('no_eadwyn_fill', at.field, at.scenario);
    // The accept path writes "<label>: <value>" (registry.ts); the figure is after the first colon.
    const written = String(row.written_value ?? '');
    const figure = written.includes(': ') ? written.slice(written.indexOf(': ') + 2) : written;
    const r = readFigure(figure, kind === 'rate' ? 'count' : kind);
    if (r.state !== 'ok') throw refusal('eadwyn_fill_unreadable', at.field, at.scenario);
    return {
      ...base, original_value: r.value, typed_text: r.text, fill_provenance_id: Number(row.id),
      source_title: String(citation.title ?? citation.source ?? '') || null,
      source_name: citation.kind === 'library' ? 'Founder library' : String(citation.source ?? '') || null,
      evidence: { fill_provenance_id: Number(row.id), written_value: written, proposed_value: row.proposed_value ?? null,
        edited: Number(row.edited) === 1, accepted_at: row.created_at ?? null, citation },
    };
  }

  const typed = clientValue(raw.value, kind, at);
  if (sk === 'market_source') {
    const id = Number(source.market_source_id);
    const row = Number.isSafeInteger(id) && id > 0
      ? await env.DB.prepare('SELECT id, title, url FROM market_sources WHERE id = ? AND project_id = ?')
        .bind(id, projectId).first<{ id: number; title: string; url: string | null }>()
      : null;
    if (!row) throw refusal('invalid_input_market_source', at.field, at.scenario);
    return { ...base, original_value: typed.value, typed_text: typed.text, market_source_id: Number(row.id),
      source_title: String(row.title), source_url: row.url ?? null, evidence: { market_source_id: Number(row.id), title: String(row.title), url: row.url ?? null } };
  }
  // assumption
  const note = text(source.note);
  if (!note) throw refusal('missing_assumption_note', at.field, at.scenario);
  if (note.length > MAX_TEXT) throw refusal('input_note_too_long', at.field, at.scenario);
  return { ...base, original_value: typed.value, typed_text: typed.text, note };
}

/** One estimate as it is stored: the value the formula reads (USD, the version's year), and how it got there. */
export type ResolvedEstimate = ResolvedSource & {
  input_key: string;
  value: number;
  unit: string;
  conversion: Record<string, unknown> | null;
  adjustment: Record<string, unknown> | null;
  used: boolean;
  used_reason: string | null;
};

const sourceCopy = (s: ResolvedSource) => ({
  source_kind: s.source_kind, value: s.original_value, typed_text: s.typed_text, note: s.note,
  observation_id: s.observation_id, market_source_id: s.market_source_id, source_title: s.source_title, source_url: s.source_url,
  evidence: s.evidence,
});

async function resolveEstimate(env: Env, projectId: number, key: string, raw: Record<string, any>, versionYear: number, at: Where): Promise<ResolvedEstimate> {
  const kind = KEY_KIND(key);
  const src = await resolveSource(env, projectId, raw, kind, at, key);
  const fromObs = src.source_kind === 'observation';
  // Currency: a money input has one, nothing else does. An observation's own currency is copied.
  let currency: string | null = null;
  const sentCurrency = text(raw.currency).toUpperCase() || null;
  if (kind === 'money') {
    if (fromObs && src.currency) {
      if (sentCurrency && sentCurrency !== src.currency) throw refusal('value_comes_from_source', at.field, at.scenario);
      currency = src.currency;
    } else currency = sentCurrency;
    if (!currency) throw refusal('missing_input_currency', at.field, at.scenario);
    if (!/^[A-Z]{3}$/.test(currency)) throw refusal('invalid_input_currency', at.field, at.scenario);
  } else if (sentCurrency) throw refusal('invalid_input_currency', at.field, at.scenario);

  // Reference year: a count or money input has one. An observation's period gives its own.
  let year: number | null = null;
  const sentYear = text(raw.reference_year);
  if (needsYear(kind)) {
    if (sentYear && !/^\d{4}$/.test(sentYear)) throw refusal('missing_input_reference_year', at.field, at.scenario);
    if (fromObs && src.reference_year != null) {
      if (sentYear && Number(sentYear) !== src.reference_year) throw refusal('value_comes_from_source', at.field, at.scenario);
      year = src.reference_year;
    } else year = sentYear ? Number(sentYear) : null;
    if (year == null) throw refusal('missing_input_reference_year', at.field, at.scenario);
  }

  let value = src.original_value;
  let conversion: Record<string, unknown> | null = null;
  if (currency && currency !== SIZING_CURRENCY) {
    const c = obj(raw.conversion);
    if (!c) throw refusal('missing_currency_conversion', at.field, at.scenario);
    const date = text(c.rate_date);
    const rateRaw = obj(c.rate);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !rateRaw) throw refusal('invalid_currency_conversion', at.field, at.scenario);
    const rate = await resolveSource(env, projectId, rateRaw, 'rate', at, null);
    if (!(rate.original_value > 0)) throw refusal('invalid_currency_conversion', at.field, at.scenario);
    value *= rate.original_value;
    conversion = { from: currency, to: SIZING_CURRENCY, rate: rate.original_value, rate_date: date, converted_value: value, source: sourceCopy(rate) };
  } else if (raw.conversion != null) throw refusal('invalid_currency_conversion', at.field, at.scenario);

  let adjustment: Record<string, unknown> | null = null;
  if (year != null && year !== versionYear) {
    const a = obj(raw.adjustment);
    if (!a) throw refusal('missing_year_adjustment', at.field, at.scenario);
    if (a.unadjusted === true) {
      const reason = text(a.reason);
      if (!reason) throw refusal('missing_year_adjustment', at.field, at.scenario);
      if (reason.length > MAX_TEXT) throw refusal('input_note_too_long', at.field, at.scenario);
      adjustment = { from_year: year, to_year: versionYear, unadjusted: true, reason };
    } else {
      const factorRaw = obj(a.factor);
      if (!factorRaw) throw refusal('invalid_year_adjustment', at.field, at.scenario);
      const factor = await resolveSource(env, projectId, factorRaw, 'rate', at, null);
      if (!(factor.original_value > 0)) throw refusal('invalid_year_adjustment', at.field, at.scenario);
      value *= factor.original_value;
      adjustment = { from_year: year, to_year: versionYear, unadjusted: false, factor: factor.original_value, adjusted_value: value, source: sourceCopy(factor) };
    }
  } else if (raw.adjustment != null) throw refusal('invalid_year_adjustment', at.field, at.scenario);

  return {
    ...src, currency, reference_year: year, input_key: key, value,
    unit: key === TOP_DOWN_KEY ? 'USD millions' : SIZING_INPUTS[key as SizingInputKey].unit,
    conversion, adjustment, used: true, used_reason: null,
  };
}

/** One input: a single estimate, or `{ estimates: [...], used_reason }` with exactly one marked `used: true`. */
async function resolveInput(env: Env, projectId: number, key: string, raw: unknown, versionYear: number, at: Where): Promise<ResolvedEstimate[]> {
  const input = obj(raw);
  if (!input) throw refusal('missing_input_source', at.field, at.scenario);
  if (input.estimates == null) return [await resolveEstimate(env, projectId, key, input, versionYear, at)];
  if (!Array.isArray(input.estimates) || input.estimates.length < 1 || input.estimates.length > MAX_ESTIMATES) {
    throw refusal('invalid_estimates', at.field, at.scenario);
  }
  const usedCount = input.estimates.filter((e: any) => obj(e)?.used === true).length;
  const reason = text(input.used_reason);
  if (input.estimates.length > 1 && (usedCount !== 1 || !reason)) throw refusal('missing_used_estimate', at.field, at.scenario);
  if (reason.length > MAX_TEXT) throw refusal('input_note_too_long', at.field, at.scenario);
  const out: ResolvedEstimate[] = [];
  for (const e of input.estimates) {
    const est = obj(e);
    if (!est) throw refusal('invalid_estimates', at.field, at.scenario);
    const r = await resolveEstimate(env, projectId, key, est, versionYear, at);
    const used = input.estimates.length === 1 || est.used === true;
    out.push({ ...r, used, used_reason: used ? reason || null : null });
  }
  return out;
}

export type ScenarioPlan = { scenario: Scenario; result: SizingResult; estimates: ResolvedEstimate[] };
export type LabelledPlan = {
  revenue_basis: RevenueBasis;
  reference_year: number;
  scenarios: ScenarioPlan[];
  top_down: { estimates: ResolvedEstimate[]; tam: number; gap: number } | null;
  /** The drawer's row after this save: the base scenario's used values as text. */
  assumptions: Record<string, unknown>;
  /** Base, low, then high: what a low above base or a high below base looks like. */
  order_flags: OrderFlag[];
};

/** The raw map `sizeMarket` reads, from a scenario's used estimates. */
export function scenarioRaw(used: readonly { input_key: string; value: number }[], extra: { tamOverrideReason: unknown; targetYear: unknown; revenueBasis: unknown }) {
  const raw: Record<string, unknown> = { ...extra };
  for (const e of used) raw[e.input_key] = Number(e.value);
  return raw;
}

/**
 * Check and resolve a save in the labelled shape, reading the stores it names, or throw a
 * `SizingInputError` with the refusal code. Nothing is written here.
 */
export async function resolveLabelledSave(env: Env, projectId: number, body: Record<string, any>): Promise<LabelledPlan> {
  const assumptions = obj(body.assumptions) ?? {};
  for (const key of [...SIZING_INPUT_KEYS, 'tamOverrideReason']) {
    if (assumptions[key] != null && text(assumptions[key]) !== '') throw refusal('inputs_sent_twice', key, null);
  }
  if (body.input_labels != null) throw refusal('inputs_sent_twice', 'input_labels', null);
  const basis = body.revenue_basis;
  if (basis == null || text(basis) === '') throw refusal('missing_revenue_basis', 'revenueBasis', null);
  if (!(REVENUE_BASES as readonly unknown[]).includes(basis)) throw refusal('invalid_revenue_basis', 'revenueBasis', null);
  const yearText = text(assumptions.targetYear);
  if (!/^\d{4}$/.test(yearText)) throw refusal('missing_reference_year', 'targetYear', null);
  const versionYear = Number(yearText);

  const scenariosIn = obj(body.scenarios);
  if (!scenariosIn) throw refusal('missing_input_source', 'population', 'base');
  const names = Object.keys(scenariosIn).sort();
  const valid = JSON.stringify(names) === JSON.stringify(['base']) || JSON.stringify(names) === JSON.stringify(['base', 'high', 'low']);
  if (!valid) throw refusal('invalid_scenarios', 'scenarios', null);

  const plans: ScenarioPlan[] = [];
  for (const scenario of SCENARIOS) {
    if (!scenariosIn[scenario]) continue;
    const s = obj(scenariosIn[scenario]);
    const inputs = obj(s?.inputs);
    if (!s || !inputs) throw refusal('invalid_scenario', 'inputs', scenario);
    const estimates: ResolvedEstimate[] = [];
    for (const [key, raw] of Object.entries(inputs)) {
      if (!(SIZING_INPUT_KEYS as string[]).includes(key)) throw refusal('unknown_sizing_input', key, scenario);
      estimates.push(...await resolveInput(env, projectId, key, raw, versionYear, { scenario, field: key }));
    }
    const reason = text(s.tam_override_reason);
    if (reason.length > MAX_TEXT) throw refusal('input_note_too_long', 'tamOverrideReason', scenario);
    let result: SizingResult;
    try {
      result = sizeMarket(scenarioRaw(estimates.filter((e) => e.used), { tamOverrideReason: reason || null, targetYear: yearText, revenueBasis: basis }));
    } catch (e) {
      if (e instanceof SizingInputError) (e as SizingInputError & { scenario?: string }).scenario = scenario;
      throw e;
    }
    plans.push({ scenario, result, estimates });
  }
  const base = plans.find((p) => p.scenario === 'base') as ScenarioPlan;

  let topDown: LabelledPlan['top_down'] = null;
  if (body.top_down != null) {
    const estimates = await resolveInput(env, projectId, TOP_DOWN_KEY, body.top_down, versionYear, { scenario: 'top_down', field: TOP_DOWN_KEY });
    const used = estimates.find((e) => e.used) as ResolvedEstimate;
    const tam = Math.round(used.value * 1e6);
    if (!Number.isSafeInteger(tam)) throw refusal('invalid_top_down', TOP_DOWN_KEY, 'top_down');
    topDown = { estimates, tam, gap: tam - base.result.tam };
  }

  const drawer: Record<string, unknown> = { ...assumptions };
  for (const key of SIZING_INPUT_KEYS) {
    const e = base.estimates.find((x) => x.used && x.input_key === key);
    drawer[key] = e ? (e.typed_text && e.value === e.original_value ? e.typed_text : String(e.value)) : null;
  }
  drawer.tamOverrideReason = base.result.tam_override_reason;
  return {
    revenue_basis: basis, reference_year: versionYear, scenarios: plans, top_down: topDown, assumptions: drawer,
    order_flags: orderFlags(Object.fromEntries(plans.map((p) => [p.scenario, p.result])) as Partial<Record<Scenario, Figures>>),
  };
}

type Figures = { tam: number; sam: number; som: number };
export type OrderFlag = { scenario: 'low' | 'high'; figure: 'tam' | 'sam' | 'som'; value: number; base: number; sentence: string };

/** A low result above base, or a high one below it: returned with a flag, never refused. */
export function orderFlags(s: Partial<Record<Scenario, Figures>>): OrderFlag[] {
  const flags: OrderFlag[] = [];
  if (!s.base) return flags;
  for (const figure of ['tam', 'sam', 'som'] as const) {
    const b = Number(s.base[figure]);
    if (s.low && Number(s.low[figure]) > b) {
      flags.push({ scenario: 'low', figure, value: Number(s.low[figure]), base: b, sentence: `The low scenario's ${figure.toUpperCase()} is above base.` });
    }
    if (s.high && Number(s.high[figure]) < b) {
      flags.push({ scenario: 'high', figure, value: Number(s.high[figure]), base: b, sentence: `The high scenario's ${figure.toUpperCase()} is below base.` });
    }
  }
  return flags;
}

export type Sensitivity =
  | { available: false; reason: string }
  | { available: true; base_som: number; ranked: { input_key: string; low_value: number; high_value: number; som_at_low: number; som_at_high: number; effect: number }[];
    not_moved: { input_key: string; reason: string }[] };

/**
 * Each input moved between its low and high value with the others at base, ranked by the absolute
 * effect on SOM. Computed on read from stored values; never stored. Base alone has no range.
 */
export function sensitivity(
  scenarios: Partial<Record<Scenario, { inputs: readonly { input_key: string; value: number }[]; tamOverrideReason: unknown }>>,
  extra: { targetYear: unknown; revenueBasis: unknown },
): Sensitivity {
  const { base, low, high } = scenarios;
  if (!base || !low || !high) {
    return { available: false, reason: 'This version holds the base scenario only, so no input has a low and a high value to move between.' };
  }
  const at = (inputs: readonly { input_key: string; value: number }[], key: string, value: number) => sizeMarket(scenarioRaw(
    inputs.map((i) => (i.input_key === key ? { ...i, value } : i)), { tamOverrideReason: base.tamOverrideReason, ...extra },
  )).som;
  const baseSom = sizeMarket(scenarioRaw(base.inputs, { tamOverrideReason: base.tamOverrideReason, ...extra })).som;
  const ranked: Extract<Sensitivity, { available: true }>['ranked'] = [];
  const notMoved: { input_key: string; reason: string }[] = [];
  for (const input of base.inputs) {
    const lo = low.inputs.find((i) => i.input_key === input.input_key);
    const hi = high.inputs.find((i) => i.input_key === input.input_key);
    if (!lo || !hi) { notMoved.push({ input_key: input.input_key, reason: 'The low or the high scenario does not hold this input.' }); continue; }
    let somLow: number, somHigh: number;
    try {
      somLow = at(base.inputs, input.input_key, Number(lo.value));
      somHigh = at(base.inputs, input.input_key, Number(hi.value));
    } catch {
      notMoved.push({ input_key: input.input_key, reason: 'Moving this input alone gives inputs the formula refuses.' });
      continue;
    }
    ranked.push({ input_key: input.input_key, low_value: Number(lo.value), high_value: Number(hi.value), som_at_low: somLow, som_at_high: somHigh,
      effect: Math.abs(somHigh - somLow) });
  }
  ranked.sort((a, b) => b.effect - a.effect || a.input_key.localeCompare(b.input_key));
  return { available: true, base_som: baseSom, ranked, not_moved: notMoved };
}

/** The observation ids an estimate row names: its own, and its conversion's or adjustment's source. */
export function observationIdsOf(row: { observation_id?: unknown; conversion_json?: unknown; adjustment_json?: unknown }): number[] {
  const ids: number[] = [];
  if (row.observation_id != null) ids.push(Number(row.observation_id));
  for (const j of [row.conversion_json, row.adjustment_json]) {
    if (j == null) continue;
    try {
      const id = (JSON.parse(String(j)) as { source?: { observation_id?: unknown } })?.source?.observation_id;
      if (id != null) ids.push(Number(id));
    } catch { /* an unreadable copy names no observation */ }
  }
  return ids;
}

export type Supersession = { observation_id: number; superseded: boolean; newest_observation_id: number | null; newest_vintage: string | null; newest_period: string | null };

/** For each observation id: whether a later vintage supersedes it, asked through `services/researchObservations.ts`. */
export async function observationSupersession(env: Env, ids: readonly number[]): Promise<Map<number, Supersession>> {
  const out = new Map<number, Supersession>();
  for (const id of new Set(ids)) {
    const found = await readObservation(env, id);
    if (!found) { out.set(id, { observation_id: id, superseded: false, newest_observation_id: null, newest_vintage: null, newest_period: null }); continue; }
    const newest = found.revisions[found.revisions.length - 1] as Record<string, any>;
    const superseded = !found.observation.current;
    out.set(id, {
      observation_id: id, superseded,
      newest_observation_id: superseded ? Number(newest.id) : null,
      newest_vintage: superseded ? String(newest.vintage ?? '') || null : null,
      newest_period: superseded ? String(newest.period ?? '') || null : null,
    });
  }
  return out;
}

/**
 * The versions whose evidence a later vintage has superseded: for one venture, or for every venture
 * when `projectId` is null (#7726 lists the versions affected). The saved values never change.
 */
export async function supersededSizingEvidence(env: Env, projectId: number | null) {
  const rows = (await env.DB.prepare(
    `SELECT v.uid AS version_uid, v.project_id, v.version_number, e.scenario, e.input_key, e.estimate_no, e.used,
            e.observation_id, e.conversion_json, e.adjustment_json
       FROM market_sizing_input_estimates e JOIN market_sizing_versions v ON v.id = e.version_id
      WHERE (? IS NULL OR v.project_id = ?)
        AND (e.observation_id IS NOT NULL OR e.conversion_json IS NOT NULL OR e.adjustment_json IS NOT NULL)
      ORDER BY v.project_id, v.version_number DESC, e.id`,
  ).bind(projectId, projectId).all<Record<string, any>>()).results ?? [];
  const status = await observationSupersession(env, rows.flatMap(observationIdsOf));
  const out: Array<{ version_uid: string; project_id: number; version_number: number; scenario: string; input_key: string; estimate_no: number; used: boolean } & Supersession> = [];
  for (const r of rows) {
    for (const id of observationIdsOf(r)) {
      const s = status.get(id);
      if (s?.superseded) {
        out.push({ version_uid: r.version_uid, project_id: Number(r.project_id), version_number: Number(r.version_number), scenario: r.scenario,
          input_key: r.input_key, estimate_no: Number(r.estimate_no), used: Number(r.used) === 1, ...s });
      }
    }
  }
  return out;
}
