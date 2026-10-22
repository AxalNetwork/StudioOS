/**
 * D760 (#2017) — what a run costs, and what a member would pay for it.
 *
 * TWO NUMBERS, ONE SOURCE. `costMicro` is Cloudflare's cost for a run, from the
 * catalogue's neuron prices. `billedMicro` is that cost times a multiplier: 1
 * for the `admin` licence, `AI_MARKUP` for everyone else. `billingMode` says
 * which of the two a run is settled at: 'billed' once the owner sets
 * `AI_BILLING = "charged"` (D762, #2123), else 'cost'. The quote, the hold, the
 * settlement and the price reads all follow it, so no screen draws a price the
 * Worker is not charging.
 *
 * NEURONS (S1 on #2017). Cloudflare bills in neurons at $0.011 per 1,000, so a
 * unit's price is its printed neuron count × `USD_PER_NEURON`, exactly: the
 * 70B's 26668 neurons per 1M input tokens are $0.293348. The dollar column the
 * catalogue also holds is that figure rounded for display, and is never billed.
 *
 * EXACT DECIMALS. Every sum here is taken over the printed neuron strings as integers
 * with a power-of-ten scale, never as floats. The total is rounded UP to a
 * whole micro-USD once per run, not once per unit: FLUX.1 Schnell's tile is 4.80
 * neurons, $0.0000528, 52.8 micro-USD, so rounding each tile up would charge
 * five tiles 265 micro-USD instead of 264.
 */
import { modelById, UNIT_SCALE, type PriceUnit } from './catalogue';

/** Cloudflare's rate: $0.011 per 1,000 neurons (the pricing page, 2026-10-15). */
export const USD_PER_NEURON = '0.000011';

/** owner's canvas AIRail · every page, rail_logic.js:74 usd(); D720 (#1874) §3 */
export const AI_MARKUP = 1.25;

export type BillingMode = 'cost' | 'billed';

/**
 * The price a run is settled at (D762 §2). Only the exact value `charged` turns
 * the markup on; unset, empty or any other value is cost, so a typo never bills.
 */
export const billingMode = (env?: unknown): BillingMode =>
  ((env as { AI_BILLING?: unknown } | null | undefined)?.AI_BILLING === 'charged' ? 'billed' : 'cost');

/**
 * What a run is settled at over its cost, for this licence: 1 while billing is
 * on cost, else `multiplierFor(licence)` (the `admin` licence still pays cost).
 */
export const chargeMultiplier = (env: unknown, licence: string): number =>
  (billingMode(env) === 'billed' ? multiplierFor(licence) : 1);

/** The multiplier a licence pays over cost. The `admin` licence (`aiLicenceKey`) always pays cost. */
export const multiplierFor = (licence: string): number => (licence === 'admin' ? 1 : AI_MARKUP);

/** A count the Worker measured for a run, keyed by the catalogue's unit names. */
export type RunUnits = Partial<Record<PriceUnit, number>>;

// ─────────────────────────────────────────────────────────── exact decimals

/** value = n / 10^e */
interface Dec { n: bigint; e: number }

const DECIMAL_RE = /^\d+(?:\.\d+)?$/;

function dec(raw: string): Dec {
  if (!DECIMAL_RE.test(raw)) throw new Error(`price unreadable: ${raw}`);
  const [whole, frac = ''] = raw.split('.');
  return { n: BigInt(whole + frac), e: frac.length };
}

/** A measured count or a multiplier as an exact decimal. Its shortest round-trip form is what the number is. */
function decOf(x: number): Dec {
  if (!Number.isFinite(x) || x < 0) throw new Error(`amount unreadable: ${x}`);
  if (Number.isInteger(x)) return { n: BigInt(x), e: 0 };
  const s = String(x);
  return dec(/e/i.test(s) ? x.toFixed(20).replace(/0+$/, '') : s);
}

const TEN = (k: number): bigint => 10n ** BigInt(k);
const mul = (a: Dec, b: Dec): Dec => ({ n: a.n * b.n, e: a.e + b.e });
/** Divide by a unit scale, which is always a power of ten (1, 1,000 or 1,000,000). */
function div(a: Dec, scale: number): Dec {
  const k = String(scale).length - 1;
  if (scale !== 10 ** k) throw new Error(`unit scale is not a power of ten: ${scale}`);
  return { n: a.n, e: a.e + k };
}
function add(a: Dec, b: Dec): Dec {
  const e = Math.max(a.e, b.e);
  return { n: a.n * TEN(e - a.e) + b.n * TEN(e - b.e), e };
}

/** USD as micro-USD, rounded up once. */
function ceilMicro(usd: Dec): number {
  const scaled = usd.n * 1_000_000n;
  const d = TEN(usd.e);
  const micro = scaled / d + (scaled % d === 0n ? 0n : 1n);
  return Number(micro);
}

function decString(d: Dec): string {
  const s = d.n.toString().padStart(d.e + 1, '0');
  const whole = s.slice(0, s.length - d.e);
  const frac = s.slice(s.length - d.e).replace(/0+$/, '');
  return frac ? `${whole}.${frac}` : whole;
}

// ─────────────────────────────────────────────────────────── a run's cost

/**
 * A model's price for one unit, per `UNIT_SCALE[unit]`, as an exact decimal
 * string: its neurons × `USD_PER_NEURON`. Null where the model has no neuron
 * figure for that unit.
 */
export function unitPrice(model: string, unit: PriceUnit): string | null {
  const raw = modelById(model)?.neurons?.[unit];
  return raw == null ? null : decString(mul(dec(raw), dec(USD_PER_NEURON)));
}

/**
 * Cloudflare's cost for a run, in USD, exactly. `tokens_in` is the provider's
 * whole input count; when it reports `tokens_cached` and the model prints a
 * cached rate, those tokens are billed at it and the rest at the input rate.
 * A model with no cached rate bills every input token at the input rate. A unit
 * the model has no price for is refused rather than counted as free.
 */
function costUsd(model: string, units: RunUnits): Dec {
  const m = modelById(model);
  const neurons = m?.neurons;
  if (!neurons || Object.keys(neurons).length === 0) throw new Error(`model_unpriced: ${model}`);
  let total: Dec = { n: 0n, e: 0 };
  const cachedRate = neurons.tokens_cached;
  const cached = cachedRate ? Math.min(units.tokens_cached ?? 0, units.tokens_in ?? 0) : 0;
  for (const [unit, count] of Object.entries(units) as Array<[PriceUnit, number]>) {
    if (count == null || count === 0) continue;
    let n = count;
    if (unit === 'tokens_cached') { if (!cachedRate) continue; n = cached; }
    if (unit === 'tokens_in') n = count - cached;
    const raw = neurons[unit];
    if (raw == null) throw new Error(`model_unpriced: ${model} has no ${unit} price`);
    total = add(total, div(mul(mul(dec(raw), dec(USD_PER_NEURON)), decOf(n)), UNIT_SCALE[unit]));
  }
  return total;
}

/** Cloudflare's cost for a run, in micro-USD, rounded up once. */
export const costMicro = (model: string, units: RunUnits): number => ceilMicro(costUsd(model, units));

/** What a member pays for a run at `multiplier`, in micro-USD, rounded up once (never cost rounded, then multiplied). */
export const billedMicro = (model: string, units: RunUnits, multiplier: number): number =>
  ceilMicro(mul(costUsd(model, units), decOf(multiplier)));

/**
 * D851 (#2474): what a member pays for a run on a provider that prices in USD
 * rather than neurons (`ai/providers/`), in micro-USD, rounded up once. `rates`
 * are USD per 1M of each unit, as decimal strings exactly as the provider
 * prints them; `counts` are the provider's own reported counts. A counted unit
 * with no rate is refused rather than billed as free.
 */
export function usdRatesBilledMicro(rates: Readonly<Record<string, string>>, counts: Readonly<Record<string, number>>, multiplier: number): number {
  let total: Dec = { n: 0n, e: 0 };
  for (const [unit, count] of Object.entries(counts)) {
    if (count == null || count === 0) continue;
    const raw = rates[unit];
    if (raw == null) throw new Error(`provider_unpriced: no ${unit} price`);
    total = add(total, div(mul(dec(raw), decOf(count)), 1_000_000));
  }
  return ceilMicro(mul(total, decOf(multiplier)));
}

/**
 * The unit price the Worker serves for an exact decimal price (`unitPrice`):
 * the exact product as a number. 0.293348 × 1.25 is served as 0.366685, where
 * float arithmetic can land a digit off (0.293 × 1.25 is 0.36624999999999996).
 * The frontend never multiplies.
 */
export const billedUnitPrice = (raw: string, multiplier: number): number => Number(decString(mul(dec(raw), decOf(multiplier))));
