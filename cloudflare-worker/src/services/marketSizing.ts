/**
 * D7704 (#7704) — market sizing, formula version 2: TAM, SAM and SOM computed
 * by the Worker from the inputs saved with them. Pure functions; no store.
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
import { ASSUMPTION_COLUMNS } from './marketAssumptions';

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

  const v = (k: SizingInputKey) => (read[k] as { value: number }).value;
  const acv = v('acv');
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
    formula,
    notes,
  };
}

/** A stored version and its input rows, as `market_sizing_versions` and `market_sizing_version_inputs` hold them. */
export type StoredVersion = {
  computed_tam: number | null; tam_override: number | null; tam_override_reason: string | null;
  tam: number; sam: number; som: number; som_limit: string; reference_year: number | null; horizon_months: number;
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
  };
  for (const r of inputs) raw[r.input_key] = Number(r.value);
  let again: SizingResult;
  try { again = sizeMarket(raw); } catch { return false; }
  const same = (a: unknown, b: unknown) => (a == null && b == null) || Number(a) === Number(b);
  return same(again.computed_tam, version.computed_tam) && same(again.tam_override, version.tam_override)
    && same(again.tam, version.tam) && same(again.sam, version.sam) && same(again.som, version.som)
    && again.som_limit === version.som_limit && same(again.horizon_months, version.horizon_months);
}
