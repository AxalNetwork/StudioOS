/**
 * D5015 (#5015) — the country-pricing engine. PURE: no database, no clock, no
 * randomness. The same model and the same profile give the same result and the
 * same digest, on any machine, forever, which is what makes a recommendation
 * reproducible from its snapshot.
 *
 * FIXED POINT, INTEGER ONLY. Every factor and the index are millionths (`ppm`,
 * 1.0 = 1000000), weights and rates are basis points, money is minor units. The
 * nonlinear steps (a base-10 logarithm, a square root) are computed with BigInt
 * integer algorithms, not `Math.log`/`Math.sqrt`, so no binary float ever
 * decides a contractual figure. Rounding is half up, and only where the trace
 * says so.
 *
 * THE FORMULA (model v1):
 *   purchasing power  factor = clamp(PPP / reference PPP)                     weight 4000 bps
 *   startup ecosystem factor = clamp(sqrt(score / reference score))           weight 3500 bps
 *   market size       factor = clamp(1 + slope × log10(population / ref pop)) weight 2500 bps
 *   index = Σ weight × factor / 10000
 *   fee   = round_to_increment(reference fee × index)
 * Raw values are never multiplied together. Each input becomes a bounded factor
 * first: the cap keeps a US-scale outlier from dominating, and the floor keeps a
 * small market from collapsing toward zero. Population counts with diminishing
 * returns (a logarithm), and the startup score with a square root.
 *
 * MISSING IS NOT LOW. An input that is not recorded is never read as 0. The
 * result is `available: false`, it names the input, and it carries no index or
 * fee. A `provisional` input is used only when the caller allows it explicitly,
 * and the result then says `complete: false` and lists it.
 */

export const PPM = 1_000_000;
const PPMn = 1_000_000n;

export type InputStatus = 'recorded' | 'provisional' | 'not_recorded';
export type RegulatoryClass = 'low' | 'medium' | 'high' | 'very_high';

/** The calculation fields of a pricing model (`pricing_models`), parsed. */
export type EngineModel = {
  uid: string;
  version: string;
  currency: string;
  reference_annual_fee_cents: number;
  reference_initial_fee_cents: number;
  default_royalty_bps: number;
  minimum_royalty_ratio_bps: number;
  weight_purchasing_power_bps: number;
  weight_startup_ecosystem_bps: number;
  weight_market_size_bps: number;
  fee_rounding_cents: number;
  normalization: unknown;
  regulatory_surcharge: unknown;
  tier_thresholds: unknown;
};

/** The market inputs of one country (`country_market_profiles`). */
export type EngineProfile = {
  country_code: string;
  population: number | null;
  population_status: InputStatus;
  population_source?: string | null;
  population_as_of?: string | null;
  ppp_gdp_per_capita: number | null;
  ppp_status: InputStatus;
  ppp_source?: string | null;
  ppp_as_of?: string | null;
  startup_ecosystem_score: number | null; // thousandths of a point
  startup_ecosystem_rank?: number | null;
  startup_score_status: InputStatus;
  startup_source?: string | null;
  startup_as_of?: string | null;
  regulatory_class: RegulatoryClass | null;
  revision?: number;
};

export type EngineOptions = { allowProvisional?: boolean };

type Clamp = { floor_ppm: number; cap_ppm: number };
export type Normalization = {
  purchasing_power: { method: 'ratio'; reference: number } & Clamp;
  startup_ecosystem: ({ method: 'sqrt'; reference_score: number } | { method: 'log10'; reference_score: number; slope_ppm: number }) & Clamp;
  market_size: ({ method: 'log10'; reference_population: number; slope_ppm: number } | { method: 'bands'; bands: Array<{ min_population: number; factor_ppm: number }> }) & Clamp;
};
export type Tier = { tier: string; min_index_ppm: number; royalty_bps?: number };

export class PricingEngineError extends Error {
  readonly code: string;
  readonly problems: string[];
  constructor(code: string, problems: string[]) {
    super(`${code}: ${problems.join('; ')}`);
    this.code = code;
    this.problems = problems;
  }
}

// ── Integer arithmetic ───────────────────────────────────────────────────────

/** a / b rounded half away from zero; b > 0. */
export function divRound(a: bigint, b: bigint): bigint {
  if (b <= 0n) throw new RangeError('divRound: divisor must be positive');
  const neg = a < 0n;
  const m = neg ? -a : a;
  const q = (2n * m + b) / (2n * b);
  return neg ? -q : q;
}

/** floor(sqrt(n)) for n ≥ 0, by Newton's method on integers. */
export function isqrt(n: bigint): bigint {
  if (n < 0n) throw new RangeError('isqrt of a negative number');
  if (n < 2n) return n;
  let x = n;
  let y = (x + 1n) >> 1n;
  while (y < x) { x = y; y = (x + n / x) >> 1n; }
  return x;
}

const FRAC_BITS = 48n;
const ONE = 1n << FRAC_BITS;
// log10(2) to 18 places: 0.301029995663981195…
const LOG10_2 = 301029995663981195n;
const LOG10_2_SCALE = 1_000_000_000_000_000_000n;

/**
 * log10(num / den) in millionths, rounded half away from zero, with an integer
 * binary-logarithm algorithm: the integer part by doubling and halving, then 48
 * fractional bits by repeated squaring. Deterministic, and well inside a ppm.
 */
export function log10Ppm(num: bigint, den: bigint): bigint {
  if (num <= 0n || den <= 0n) throw new RangeError('log10Ppm needs positive arguments');
  let n = num;
  let d = den;
  let int = 0n;
  while (n >= 2n * d) { d *= 2n; int += 1n; }
  while (n < d) { n *= 2n; int -= 1n; }
  let x = (n << FRAC_BITS) / d; // in [ONE, 2·ONE)
  let frac = 0n;
  for (let i = 1n; i <= FRAC_BITS; i += 1n) {
    x = (x * x) >> FRAC_BITS;
    if (x >= 2n * ONE) { x >>= 1n; frac |= 1n << (FRAC_BITS - i); }
  }
  const log2Fixed = (int << FRAC_BITS) + frac; // log2 × 2^48
  return divRound(log2Fixed * LOG10_2 * PPMn, ONE * LOG10_2_SCALE);
}

const clampN = (v: bigint, c: Clamp) => {
  const lo = BigInt(c.floor_ppm);
  const hi = BigInt(c.cap_ppm);
  return v < lo ? lo : v > hi ? hi : v;
};

/** Whole cents (as exact micro-cents) rounded half up to a commercial increment. */
export function roundToIncrement(microcents: bigint, incrementCents: number): bigint {
  const inc = BigInt(incrementCents);
  return divRound(microcents, inc * PPMn) * inc;
}

const toNum = (v: bigint): number => {
  if (v > BigInt(Number.MAX_SAFE_INTEGER) || v < BigInt(Number.MIN_SAFE_INTEGER)) throw new RangeError('value exceeds the safe integer range');
  return Number(v);
};

// ── Model validation ─────────────────────────────────────────────────────────

const isInt = (v: unknown, min = 0): v is number => typeof v === 'number' && Number.isInteger(v) && v >= min;
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

function clampProblems(name: string, c: Record<string, unknown>, out: string[]) {
  if (!isInt(c.floor_ppm, 1)) out.push(`${name}.floor_ppm must be a positive integer`);
  if (!isInt(c.cap_ppm, 1)) out.push(`${name}.cap_ppm must be a positive integer`);
  if (isInt(c.floor_ppm) && isInt(c.cap_ppm) && c.floor_ppm > c.cap_ppm) out.push(`${name}.floor_ppm exceeds cap_ppm`);
}

/**
 * The model's calculation fields, checked. A weight sum other than exactly
 * 10000 is refused, as is any normalization the formula needs and the model
 * does not state: the engine never fills in a configuration nobody chose.
 */
export function checkModel(model: EngineModel): { normalization: Normalization; tiers: Tier[]; surcharges: Record<string, number> } {
  const p: string[] = [];
  const weights = [model.weight_purchasing_power_bps, model.weight_startup_ecosystem_bps, model.weight_market_size_bps];
  if (!weights.every((w) => isInt(w))) p.push('weights must be non-negative integers');
  else if (weights.reduce((a, b) => a + b, 0) !== 10000) p.push(`weights sum to ${weights.reduce((a, b) => a + b, 0)}, not 10000`);
  for (const f of ['reference_annual_fee_cents', 'reference_initial_fee_cents', 'default_royalty_bps', 'minimum_royalty_ratio_bps'] as const) {
    if (!isInt(model[f])) p.push(`${f} must be a non-negative integer`);
  }
  if (!isInt(model.fee_rounding_cents, 1)) p.push('fee_rounding_cents must be a positive integer');
  const n = model.normalization;
  if (!isObj(n)) p.push('normalization is missing');
  else {
    const pp = n.purchasing_power;
    if (!isObj(pp) || pp.method !== 'ratio' || !isInt(pp.reference, 1)) p.push('normalization.purchasing_power needs method "ratio" and a positive reference');
    else clampProblems('normalization.purchasing_power', pp, p);
    const se = n.startup_ecosystem;
    if (!isObj(se) || !isInt(se.reference_score, 1) || !(se.method === 'sqrt' || (se.method === 'log10' && isInt(se.slope_ppm)))) {
      p.push('normalization.startup_ecosystem needs method "sqrt" (or "log10" with slope_ppm) and a positive reference_score');
    } else clampProblems('normalization.startup_ecosystem', se, p);
    const ms = n.market_size;
    if (!isObj(ms)) p.push('normalization.market_size is missing');
    else if (ms.method === 'log10') {
      if (!isInt(ms.reference_population, 1) || !isInt(ms.slope_ppm)) p.push('normalization.market_size "log10" needs reference_population and slope_ppm');
      clampProblems('normalization.market_size', ms, p);
    } else if (ms.method === 'bands') {
      const bands = ms.bands;
      if (!Array.isArray(bands) || !bands.length || !bands.every((b) => isObj(b) && isInt(b.min_population) && isInt(b.factor_ppm, 1))) {
        p.push('normalization.market_size "bands" needs [{ min_population, factor_ppm }]');
      } else if (!bands.some((b) => (b as { min_population: number }).min_population === 0)) p.push('normalization.market_size bands must start at min_population 0');
      clampProblems('normalization.market_size', ms, p);
    } else p.push('normalization.market_size method must be "log10" or "bands"');
  }
  const tiersRaw = model.tier_thresholds;
  if (!Array.isArray(tiersRaw) || !tiersRaw.every((t) => isObj(t) && typeof t.tier === 'string' && t.tier && isInt(t.min_index_ppm)
    && (t.royalty_bps === undefined || (isInt(t.royalty_bps) && (t.royalty_bps as number) <= 10000)))) {
    p.push('tier_thresholds must be [{ tier, min_index_ppm, royalty_bps? }]');
  } else if (tiersRaw.length && !tiersRaw.some((t) => (t as { min_index_ppm: number }).min_index_ppm === 0)) {
    p.push('tier_thresholds must include a tier at min_index_ppm 0, so every index has a tier');
  }
  const s = model.regulatory_surcharge;
  if (!isObj(s) || !Object.entries(s).every(([k, v]) => ['low', 'medium', 'high', 'very_high'].includes(k) && isInt(v))) {
    p.push('regulatory_surcharge must map low|medium|high|very_high to integer cents');
  }
  if (p.length) throw new PricingEngineError('model_invalid', p);
  const tiers = [...(tiersRaw as Tier[])].sort((a, b) => b.min_index_ppm - a.min_index_ppm);
  return { normalization: n as Normalization, tiers, surcharges: s as Record<string, number> };
}

// ── The calculation ──────────────────────────────────────────────────────────

export type InputKey = 'purchasing_power' | 'startup_ecosystem' | 'market_size';

export type Recommendation = {
  model_uid: string;
  model_version: string;
  country_code: string;
  currency: string;
  /** Every input recorded; nothing provisional. */
  complete: boolean;
  /** An index and fees could be calculated (no input missing, provisional ones allowed). */
  available: boolean;
  missing: InputKey[];
  provisional: InputKey[];
  /** Why a recommendation is unavailable, in a sentence; null when it is available. */
  unavailable_reason: string | null;
  factors: Record<InputKey, number | null>;
  country_index: number | null;
  tier: string | null;
  recommended_initial_fee_cents: number | null;
  recommended_annual_fee_cents: number | null;
  recommended_royalty_bps: number | null;
  recommended_minimum_royalty_cents: number | null;
  /** null when no regulatory class is recorded: unknown, not free. */
  recommended_regulatory_surcharge_cents: number | null;
  trace: Record<string, unknown>;
};

const STATUS_OF: Record<InputKey, (p: EngineProfile) => { value: number | null; status: InputStatus }> = {
  purchasing_power: (p) => ({ value: p.ppp_gdp_per_capita, status: p.ppp_status }),
  startup_ecosystem: (p) => ({ value: p.startup_ecosystem_score, status: p.startup_score_status }),
  market_size: (p) => ({ value: p.population, status: p.population_status }),
};
const KEYS: InputKey[] = ['purchasing_power', 'startup_ecosystem', 'market_size'];

/** The country's recommendation under this model. Throws only when the MODEL is invalid. */
export function recommend(model: EngineModel, profile: EngineProfile, opts: EngineOptions = {}): Recommendation {
  const { normalization: n, tiers, surcharges } = checkModel(model);
  const allowProvisional = opts.allowProvisional === true;
  const missing: InputKey[] = [];
  const provisional: InputKey[] = [];
  const blocked: InputKey[] = [];
  const usable: Partial<Record<InputKey, bigint>> = {};
  for (const k of KEYS) {
    const { value, status } = STATUS_OF[k](profile);
    if (value === null || value === undefined || status === 'not_recorded') { missing.push(k); continue; }
    // A value the schema could not have stored (a float, a negative, a zero population or PPP) is not an input.
    const zeroAllowed = k === 'startup_ecosystem';
    if (!Number.isInteger(value) || value < 0 || (value === 0 && !zeroAllowed)) { missing.push(k); continue; }
    if (status === 'provisional') {
      provisional.push(k);
      if (!allowProvisional) { blocked.push(k); continue; }
    }
    usable[k] = BigInt(value);
  }

  const trace: Record<string, unknown> = { allow_provisional: allowProvisional };
  const factors: Record<InputKey, number | null> = { purchasing_power: null, startup_ecosystem: null, market_size: null };

  if (usable.purchasing_power !== undefined) {
    const c = n.purchasing_power;
    const raw = divRound(usable.purchasing_power * PPMn, BigInt(c.reference));
    const f = clampN(raw, c);
    factors.purchasing_power = toNum(f);
    trace.purchasing_power = { value: toNum(usable.purchasing_power), reference: c.reference, ratio_ppm: toNum(raw), floor_ppm: c.floor_ppm, cap_ppm: c.cap_ppm, factor_ppm: toNum(f) };
  }
  if (usable.startup_ecosystem !== undefined) {
    const c = n.startup_ecosystem;
    const ref = BigInt(c.reference_score);
    let raw: bigint;
    if (c.method === 'sqrt') {
      // sqrt(score / ref) in ppm = sqrt(score · 10^12 / ref), floored to the ppm.
      raw = isqrt((usable.startup_ecosystem * PPMn * PPMn) / ref);
    } else {
      raw = usable.startup_ecosystem === 0n ? BigInt(c.floor_ppm)
        : PPMn + divRound(BigInt(c.slope_ppm) * log10Ppm(usable.startup_ecosystem, ref), PPMn);
    }
    const f = clampN(raw, c);
    factors.startup_ecosystem = toNum(f);
    trace.startup_ecosystem = { value_milli: toNum(usable.startup_ecosystem), reference_score_milli: c.reference_score, method: c.method, raw_ppm: toNum(raw), floor_ppm: c.floor_ppm, cap_ppm: c.cap_ppm, factor_ppm: toNum(f) };
  }
  if (usable.market_size !== undefined) {
    const c = n.market_size;
    let raw: bigint;
    let detail: Record<string, unknown>;
    if (c.method === 'log10') {
      const lg = log10Ppm(usable.market_size, BigInt(c.reference_population));
      raw = PPMn + divRound(BigInt(c.slope_ppm) * lg, PPMn);
      detail = { method: 'log10', reference_population: c.reference_population, log10_ratio_ppm: toNum(lg), slope_ppm: c.slope_ppm };
    } else {
      const band = [...c.bands].sort((a, b) => b.min_population - a.min_population).find((b) => BigInt(b.min_population) <= usable.market_size!)!;
      raw = BigInt(band.factor_ppm);
      detail = { method: 'bands', band_min_population: band.min_population };
    }
    const f = clampN(raw, c);
    factors.market_size = toNum(f);
    trace.market_size = { value: toNum(usable.market_size), ...detail, raw_ppm: toNum(raw), floor_ppm: c.floor_ppm, cap_ppm: c.cap_ppm, factor_ppm: toNum(f) };
  }

  const regulatoryClass = profile.regulatory_class;
  const surcharge = regulatoryClass && Object.prototype.hasOwnProperty.call(surcharges, regulatoryClass) ? surcharges[regulatoryClass] : null;
  trace.regulatory = { class: regulatoryClass, surcharge_cents: surcharge };

  const available = missing.length === 0 && blocked.length === 0;
  const complete = available && provisional.length === 0;
  const base = {
    model_uid: model.uid, model_version: model.version, country_code: profile.country_code, currency: model.currency,
    complete, available, missing, provisional, factors, trace,
    recommended_regulatory_surcharge_cents: surcharge,
  };
  if (!available) {
    const names = (ks: InputKey[]) => ks.map((k) => k.replace('_', ' ')).join(', ');
    const parts = [
      missing.length ? `${names(missing)} not recorded` : null,
      blocked.length ? `${names(blocked)} only provisional` : null,
    ].filter(Boolean);
    return {
      ...base, unavailable_reason: `No recommendation: ${parts.join('; ')}.`,
      country_index: null, tier: null, recommended_initial_fee_cents: null, recommended_annual_fee_cents: null,
      recommended_royalty_bps: null, recommended_minimum_royalty_cents: null,
    };
  }

  const w: Record<InputKey, bigint> = {
    purchasing_power: BigInt(model.weight_purchasing_power_bps),
    startup_ecosystem: BigInt(model.weight_startup_ecosystem_bps),
    market_size: BigInt(model.weight_market_size_bps),
  };
  // Σ weight(bps) × factor(ppm) is exact; dividing by 10000 is the one rounding of the index.
  const weightedSum = KEYS.reduce((t, k) => t + w[k] * BigInt(factors[k]!), 0n);
  const index = divRound(weightedSum, 10000n);
  const tierRow = tiers.find((t) => BigInt(t.min_index_ppm) <= index) ?? null;
  const royalty = tierRow?.royalty_bps ?? model.default_royalty_bps;

  // Exact fees in micro-cents (cents × ppm), then one rounding to the increment.
  const annualExact = BigInt(model.reference_annual_fee_cents) * index;
  const initialExact = BigInt(model.reference_initial_fee_cents) * index;
  const annual = roundToIncrement(annualExact, model.fee_rounding_cents);
  const initial = roundToIncrement(initialExact, model.fee_rounding_cents);
  // The minimum royalty follows the ROUNDED annual fee (the figure HQ quotes), then rounds to the increment.
  const minimumExact = annual * BigInt(model.minimum_royalty_ratio_bps) * 100n; // × ppm / 10000 bps, exactly
  const minimum = roundToIncrement(minimumExact, model.fee_rounding_cents);

  trace.index = {
    weights_bps: { purchasing_power: model.weight_purchasing_power_bps, startup_ecosystem: model.weight_startup_ecosystem_bps, market_size: model.weight_market_size_bps },
    contributions_ppm_x_bps: Object.fromEntries(KEYS.map((k) => [k, toNum(w[k] * BigInt(factors[k]!))])),
    weighted_sum_ppm_x_bps: toNum(weightedSum),
    index_ppm: toNum(index),
    tier: tierRow?.tier ?? null,
  };
  trace.fees = {
    fee_rounding_cents: model.fee_rounding_cents,
    annual: { reference_cents: model.reference_annual_fee_cents, exact_microcents: toNum(annualExact), rounded_cents: toNum(annual) },
    initial: { reference_cents: model.reference_initial_fee_cents, exact_microcents: toNum(initialExact), rounded_cents: toNum(initial) },
    minimum_royalty: { ratio_bps: model.minimum_royalty_ratio_bps, of_annual_cents: toNum(annual), exact_microcents: toNum(minimumExact), rounded_cents: toNum(minimum) },
    royalty_bps: { value: royalty, from: tierRow?.royalty_bps !== undefined ? `tier ${tierRow!.tier}` : 'model default' },
  };

  return {
    ...base, unavailable_reason: null,
    country_index: toNum(index), tier: tierRow?.tier ?? null,
    recommended_initial_fee_cents: toNum(initial), recommended_annual_fee_cents: toNum(annual),
    recommended_royalty_bps: royalty, recommended_minimum_royalty_cents: toNum(minimum),
  };
}

// ── Digest ───────────────────────────────────────────────────────────────────

/** JSON with object keys sorted at every level: the same value always serialises to the same bytes. */
export function canonicalJson(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v ?? null);
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(',')}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o).filter((k) => o[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson(o[k])}`).join(',')}}`;
}

/**
 * What a recommendation was calculated FROM: the model's identity and every
 * calculation field, every input with its status, source and as-of date, and
 * the provisional permission. Two calculations with the same source document
 * produce the same recommendation.
 */
export function sourceDocument(model: EngineModel, profile: EngineProfile, opts: EngineOptions = {}) {
  return {
    model: {
      uid: model.uid, version: model.version, currency: model.currency,
      reference_annual_fee_cents: model.reference_annual_fee_cents, reference_initial_fee_cents: model.reference_initial_fee_cents,
      default_royalty_bps: model.default_royalty_bps, minimum_royalty_ratio_bps: model.minimum_royalty_ratio_bps,
      weight_purchasing_power_bps: model.weight_purchasing_power_bps, weight_startup_ecosystem_bps: model.weight_startup_ecosystem_bps,
      weight_market_size_bps: model.weight_market_size_bps, fee_rounding_cents: model.fee_rounding_cents,
      normalization: model.normalization, regulatory_surcharge: model.regulatory_surcharge, tier_thresholds: model.tier_thresholds,
    },
    profile: {
      country_code: profile.country_code,
      population: profile.population, population_status: profile.population_status,
      population_source: profile.population_source ?? null, population_as_of: profile.population_as_of ?? null,
      ppp_gdp_per_capita: profile.ppp_gdp_per_capita, ppp_status: profile.ppp_status,
      ppp_source: profile.ppp_source ?? null, ppp_as_of: profile.ppp_as_of ?? null,
      startup_ecosystem_score: profile.startup_ecosystem_score, startup_ecosystem_rank: profile.startup_ecosystem_rank ?? null,
      startup_score_status: profile.startup_score_status,
      startup_source: profile.startup_source ?? null, startup_as_of: profile.startup_as_of ?? null,
      regulatory_class: profile.regulatory_class,
    },
    allow_provisional: opts.allowProvisional === true,
  };
}

/** `sha256:<hex>` of the canonical source document. */
export async function sourceDigest(model: EngineModel, profile: EngineProfile, opts: EngineOptions = {}): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalJson(sourceDocument(model, profile, opts)));
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return `sha256:${[...d].map((b) => b.toString(16).padStart(2, '0')).join('')}`;
}

/**
 * The v1 commercial model's configuration, as #5013 states it: reference EUR
 * 50,000 annual and initial fees, 600 bps royalty, a minimum royalty of 40% of
 * the annual fee, weights 40/35/25. The reference points are inputs HQ owns:
 * these are the starting values a v1 draft is published with, not constants the
 * engine falls back to.
 */
export const V1_MODEL_DRAFT = {
  version: 'v1',
  currency: 'EUR',
  reference_annual_fee_cents: 5_000_000,
  reference_initial_fee_cents: 5_000_000,
  default_royalty_bps: 600,
  minimum_royalty_ratio_bps: 4000,
  weight_purchasing_power_bps: 4000,
  weight_startup_ecosystem_bps: 3500,
  weight_market_size_bps: 2500,
  fee_rounding_cents: 250_000,
  normalization: {
    purchasing_power: { method: 'ratio', reference: 65_000, floor_ppm: 300_000, cap_ppm: 1_600_000 },
    startup_ecosystem: { method: 'sqrt', reference_score: 30_000, floor_ppm: 300_000, cap_ppm: 1_800_000 },
    market_size: { method: 'log10', reference_population: 50_000_000, slope_ppm: 250_000, floor_ppm: 500_000, cap_ppm: 1_500_000 },
  },
  regulatory_surcharge: { low: 0, medium: 500_000, high: 1_500_000, very_high: 3_000_000 },
  tier_thresholds: [
    { tier: 'A', min_index_ppm: 1_200_000 },
    { tier: 'B', min_index_ppm: 900_000 },
    { tier: 'C', min_index_ppm: 600_000 },
    { tier: 'D', min_index_ppm: 0 },
  ],
} as const;
