/**
 * Build queue #120 — post-money SAFE and convertible-note conversion.
 *
 * Pure functions. Companion to services/captable.ts, which models
 * pre-money (YC v1) SAFEs inline and must keep emitting byte-identical
 * output for existing scenarios. This module is only consulted when a
 * scenario actually uses a post-money SAFE or a note, so the legacy
 * path is untouched.
 *
 * WHY POST-MONEY IS NOT A ONE-LINER
 *
 * A pre-money SAFE's conversion price is `cap / shares_pre` — the cap
 * is divided by the share count BEFORE any SAFE converts, so each SAFE
 * dilutes the others and no holder knows their final ownership until
 * every other SAFE is known.
 *
 * A post-money SAFE (YC 2018+) instead promises a FIXED slice of the
 * company as of immediately after all SAFEs convert and before the new
 * round's money: ownership = amount / cap, full stop. That promise is
 * self-referential — each SAFE's share count depends on the total,
 * which depends on every SAFE's share count — so it needs solving, not
 * evaluating.
 *
 * The solve is closed-form, not iterative, once you know which SAFEs
 * are cap-bound. With `S` = shares before conversion, `D` = shares
 * issued to discount-bound SAFEs, and `f_i = amount_i / cap_i`:
 *
 *     T = S + D + Σ(f_i · T)   ⟹   T = (S + D) / (1 − Σf_i)
 *     shares_i = f_i · T       price_i = cap_i / T
 *
 * Only the cap-bound/discount-bound PARTITION needs iterating, because
 * a SAFE takes whichever of its cap price and discount price is lower,
 * and that comparison depends on T. The partition is monotone and
 * settles in a couple of passes; the loop is bounded regardless.
 *
 * If Σf_i ≥ 1 the SAFEs have promised the whole company or more — real,
 * and it happens when a founder stacks too many caps. We do not silently
 * clamp: the result carries an `over_subscribed` flag and the caller
 * surfaces it, because the honest answer is "these terms cannot all be
 * honoured", not a quietly rescaled cap table.
 */

export type InstrumentKind = 'safe' | 'note';
export type SafeBasis = 'pre_money' | 'post_money';

export interface ConvertibleIn {
  name: string;
  amount: number;
  cap?: number;
  discount?: number;
  /** Defaults to 'pre_money' — the legacy behaviour. */
  basis?: SafeBasis;
  /** Defaults to 'safe'. Notes accrue interest before converting. */
  instrument?: InstrumentKind;
  /** Annual simple interest, e.g. 0.08. Notes only. */
  interest_rate?: number;
  /** ISO date the note was issued. Required for accrual. */
  issue_date?: string;
}

export interface ConvertedHolder {
  name: string;
  /** Principal, or principal + accrued interest for a note. */
  converting_amount: number;
  accrued_interest: number;
  shares: number;
  price_per_share: number;
  basis: SafeBasis;
  instrument: InstrumentKind;
  /** Which term set the price. */
  binding: 'cap' | 'discount' | 'none';
}

export interface ConversionResult {
  holders: ConvertedHolder[];
  /** Total shares after conversion, before the round's new money. */
  shares_after_conversion: number;
  /** Σ ownership promised by cap-bound post-money SAFEs. */
  post_money_fraction: number;
  /** True when post-money caps promise ≥100% of the company. */
  over_subscribed: boolean;
  warnings: string[];
}

const MS_PER_DAY = 86_400_000;
const DAYS_PER_YEAR = 365;

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** Round-half-to-even, matching captable.ts so share counts agree. */
function bankersRound(x: number, digits = 0): number {
  if (!Number.isFinite(x)) return x;
  const factor = Math.pow(10, digits);
  const scaled = x * factor;
  const floor = Math.floor(scaled);
  const diff = scaled - floor;
  let result: number;
  if (diff > 0.5) result = floor + 1;
  else if (diff < 0.5) result = floor;
  else result = (floor % 2 === 0) ? floor : floor + 1;
  return result / factor;
}
const roundShares = (x: number) => bankersRound(x, 0);

/**
 * Simple (not compounding) interest accrued on a note between issue and
 * conversion. Simple interest is the market convention for seed notes,
 * and compounding without the instrument saying so would overstate the
 * balance. Returns 0 when either date is missing or the term is
 * negative — never a negative accrual.
 */
export function accruedInterest(
  principal: number,
  annualRate: number | undefined | null,
  issueDate: string | undefined | null,
  conversionDate: string | undefined | null,
): number {
  const p = num(principal);
  const r = num(annualRate);
  if (p <= 0 || r <= 0 || !issueDate || !conversionDate) return 0;
  const a = Date.parse(String(issueDate).slice(0, 10));
  const b = Date.parse(String(conversionDate).slice(0, 10));
  if (Number.isNaN(a) || Number.isNaN(b) || b <= a) return 0;
  const years = (b - a) / MS_PER_DAY / DAYS_PER_YEAR;
  return bankersRound(p * r * years, 2);
}

/**
 * Convert a mixed set of pre-money SAFEs, post-money SAFEs, and notes
 * at a priced round.
 *
 * @param instruments   everything converting at this round
 * @param sharesPre     fully-diluted shares before any conversion
 * @param pricePerShare the round's price per share (pre_money / sharesPre)
 * @param conversionDate ISO date used for note interest accrual
 */
export function convertInstruments(
  instruments: ConvertibleIn[],
  sharesPre: number,
  pricePerShare: number,
  conversionDate?: string | null,
): ConversionResult {
  const warnings: string[] = [];
  const S = Math.max(0, num(sharesPre));
  const pps = Math.max(0, num(pricePerShare));

  // Gross each instrument up to its converting balance first: a note
  // converts on principal PLUS accrued interest, and using bare
  // principal would under-issue shares to the noteholder.
  const prepared = instruments.map(inst => {
    const principal = num(inst.amount);
    const instrument: InstrumentKind = inst.instrument === 'note' ? 'note' : 'safe';
    const accrued = instrument === 'note'
      ? accruedInterest(principal, inst.interest_rate, inst.issue_date, conversionDate)
      : 0;
    return {
      inst,
      instrument,
      basis: (inst.basis === 'post_money' ? 'post_money' : 'pre_money') as SafeBasis,
      cap: num(inst.cap),
      discount: num(inst.discount),
      converting: principal + accrued,
      accrued,
    };
  });

  const discountPrice = (d: number) => (d > 0 && pps > 0 ? pps * (1 - d) : Infinity);

  // Pre-money instruments price off the PRE-conversion share count, so
  // they resolve directly — this reproduces the legacy formula exactly.
  const preMoney = prepared.filter(p => p.basis === 'pre_money');
  const postMoney = prepared.filter(p => p.basis === 'post_money');

  const preResolved = preMoney.map(p => {
    const capPrice = p.cap > 0 ? (S > 0 ? p.cap / S : Infinity) : Infinity;
    const dPrice = discountPrice(p.discount);
    const price = Math.min(capPrice, dPrice);
    const binding: ConvertedHolder['binding'] =
      !Number.isFinite(price) ? 'none' : (capPrice <= dPrice ? 'cap' : 'discount');
    return { p, price, binding };
  });
  const preShares = preResolved.reduce(
    (acc, r) => acc + (Number.isFinite(r.price) && r.price > 0 ? r.p.converting / r.price : 0), 0,
  );

  // Post-money SAFEs: partition into cap-bound (fixed ownership target)
  // and discount-bound (priced off the round), then solve. The
  // partition depends on T and T depends on the partition, so iterate —
  // bounded, and in practice it settles on the first or second pass.
  const base = S + preShares;
  let capBound = new Set<number>(postMoney.map((_, i) => i).filter(i => postMoney[i].cap > 0));
  let T = base;
  let fractionSum = 0;
  let overSubscribed = false;

  for (let pass = 0; pass < 12; pass++) {
    // Shares issued to the discount-bound side are directly computable.
    let discountShares = 0;
    for (let i = 0; i < postMoney.length; i++) {
      if (capBound.has(i)) continue;
      const price = discountPrice(postMoney[i].discount);
      if (Number.isFinite(price) && price > 0) discountShares += postMoney[i].converting / price;
    }
    fractionSum = 0;
    for (const i of capBound) {
      const p = postMoney[i];
      if (p.cap > 0) fractionSum += p.converting / p.cap;
    }
    if (fractionSum >= 1) {
      overSubscribed = true;
      // Do NOT clamp into a plausible-looking cap table. Report the
      // shortfall and let the caller refuse to present a result that
      // silently rescales what investors were promised.
      T = base + discountShares;
      break;
    }
    T = (base + discountShares) / (1 - fractionSum);

    // Re-partition: a SAFE takes whichever price is lower for it.
    const next = new Set<number>();
    for (let i = 0; i < postMoney.length; i++) {
      const p = postMoney[i];
      const capPrice = p.cap > 0 && T > 0 ? p.cap / T : Infinity;
      const dPrice = discountPrice(p.discount);
      if (Number.isFinite(capPrice) && capPrice <= dPrice) next.add(i);
    }
    const same = next.size === capBound.size && [...next].every(i => capBound.has(i));
    capBound = next;
    if (same) break;
  }

  const holders: ConvertedHolder[] = [];

  for (const { p, price, binding } of preResolved) {
    if (!Number.isFinite(price) || price <= 0) {
      warnings.push(`${p.instrument === 'note' ? 'Note' : 'SAFE'} '${p.inst.name}' has no cap and no discount; skipped.`);
      continue;
    }
    holders.push({
      name: p.inst.name,
      converting_amount: bankersRound(p.converting, 2),
      accrued_interest: p.accrued,
      shares: roundShares(p.converting / price),
      price_per_share: bankersRound(price, 6),
      basis: 'pre_money',
      instrument: p.instrument,
      binding,
    });
  }

  for (let i = 0; i < postMoney.length; i++) {
    const p = postMoney[i];
    const capPrice = p.cap > 0 && T > 0 ? p.cap / T : Infinity;
    const dPrice = discountPrice(p.discount);
    const price = Math.min(capPrice, dPrice);
    if (!Number.isFinite(price) || price <= 0) {
      warnings.push(`${p.instrument === 'note' ? 'Note' : 'SAFE'} '${p.inst.name}' has no cap and no discount; skipped.`);
      continue;
    }
    holders.push({
      name: p.inst.name,
      converting_amount: bankersRound(p.converting, 2),
      accrued_interest: p.accrued,
      shares: roundShares(p.converting / price),
      price_per_share: bankersRound(price, 6),
      basis: 'post_money',
      instrument: p.instrument,
      binding: capPrice <= dPrice ? 'cap' : 'discount',
    });
  }

  if (overSubscribed) {
    warnings.push(
      `Post-money SAFE caps promise ${(fractionSum * 100).toFixed(1)}% of the company — more than exists. ` +
      'These terms cannot all be honoured; the conversion below is not a valid cap table. Revisit the caps.',
    );
  }

  return {
    holders,
    shares_after_conversion: roundShares(T),
    post_money_fraction: bankersRound(fractionSum, 6),
    over_subscribed: overSubscribed,
    warnings,
  };
}

/**
 * True when a scenario needs this module at all. captable.ts uses it to
 * decide whether to run the legacy inline path (guaranteeing
 * byte-identical output for existing saved scenarios) or the extended
 * one.
 */
export function needsExtendedConversion(instruments: ConvertibleIn[] | undefined | null): boolean {
  for (const i of instruments || []) {
    if (i?.basis === 'post_money') return true;
    if (i?.instrument === 'note') return true;
  }
  return false;
}
