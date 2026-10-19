/**
 * D760 (#2017) — what a run costs, and what a member would pay for it.
 *
 * TWO NUMBERS, ONE SOURCE. `costMicro` is Cloudflare's cost for a run, from the
 * catalogue's printed prices. `billedMicro` is that cost times a multiplier: 1
 * for the `admin` licence, `AI_MARKUP` for everyone else. `billingMode` says
 * which of the two a run is settled at, and in this task it is always 'cost':
 * D762 makes it read `AI_BILLING` in the same PR that settles at it, so no
 * screen draws a price the Worker is not charging.
 *
 * EXACT DECIMALS. A price is the string the pricing table prints, and every sum
 * here is taken over those strings as integers with a power-of-ten scale, never
 * as floats. The total is rounded UP to a whole micro-USD once per run, not once
 * per unit: FLUX.1 Schnell's tile price, 0.0000528, is 52.8 micro-USD, so
 * rounding each tile up would charge five tiles 265 micro-USD instead of 264.
 */
import { modelById, UNIT_SCALE, type PriceUnit } from './catalogue';

/** owner's canvas AIRail · every page, rail_logic.js:74 usd(); D720 (#1874) §3 */
export const AI_MARKUP = 1.25;

export type BillingMode = 'cost' | 'billed';

/** The price a run is settled at. 'cost' in this task, always; D762 reads `AI_BILLING`. */
export const billingMode = (_env?: unknown): BillingMode => 'cost';

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
 * Cloudflare's cost for a run, in USD, exactly. `tokens_in` is the provider's
 * whole input count; when it reports `tokens_cached` and the model prints a
 * cached rate, those tokens are billed at it and the rest at the input rate.
 * A model with no cached rate bills every input token at the input rate. A unit
 * the model has no price for is refused rather than counted as free.
 */
function costUsd(model: string, units: RunUnits): Dec {
  const m = modelById(model);
  if (!m || Object.keys(m.prices).length === 0) throw new Error(`model_unpriced: ${model}`);
  let total: Dec = { n: 0n, e: 0 };
  const cachedRate = m.prices.tokens_cached;
  const cached = cachedRate ? Math.min(units.tokens_cached ?? 0, units.tokens_in ?? 0) : 0;
  for (const [unit, count] of Object.entries(units) as Array<[PriceUnit, number]>) {
    if (count == null || count === 0) continue;
    let n = count;
    if (unit === 'tokens_cached') { if (!cachedRate) continue; n = cached; }
    if (unit === 'tokens_in') n = count - cached;
    const raw = m.prices[unit];
    if (raw == null) throw new Error(`model_unpriced: ${model} has no ${unit} price`);
    total = add(total, div(mul(dec(raw), decOf(n)), UNIT_SCALE[unit]));
  }
  return total;
}

/** Cloudflare's cost for a run, in micro-USD, rounded up once. */
export const costMicro = (model: string, units: RunUnits): number => ceilMicro(costUsd(model, units));

/** What a member pays for a run at `multiplier`, in micro-USD, rounded up once (never cost rounded, then multiplied). */
export const billedMicro = (model: string, units: RunUnits, multiplier: number): number =>
  ceilMicro(mul(costUsd(model, units), decOf(multiplier)));

/**
 * The unit price the Worker serves for a raw printed price: the exact product
 * as a number. `0.293 × 1.25` is served as 0.36625; `parseFloat` times 1.25
 * would give 0.36624999999999996. The frontend never multiplies.
 */
export const billedUnitPrice = (raw: string, multiplier: number): number => Number(decString(mul(dec(raw), decOf(multiplier))));
