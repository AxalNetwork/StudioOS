/**
 * T12 — Cap-table simulation engine. Pure-function port of
 * backend/app/services/captable.py. No I/O, no DB, fully deterministic
 * so the route handler can call this in any order it likes.
 *
 * Financing share issuance preserves the original FastAPI conventions.
 * Exit payouts correct the legacy reserve/SAFE treatment (#2446):
 *   - Shares are integers; round at every issuance step.
 *   - Pre-money SAFE convention (YC v1).
 *   - Option-pool top-ups are pre-money.
 *   - Waterfall = 1× non-participating preferred for SAFE +
 *     priced-round investors; issued common participates, unallocated pool does not.
 *
 * D1018 (#2855) adds, without changing any existing scenario's numbers:
 *   - `exit_values`: up to four exits, one waterfall each (`waterfalls`);
 *   - a round's `top_up_payer`: the pool top-up in the pre-money (founders,
 *     the default above) or after the new money (everyone);
 *   - a SAFE's `converts: false`: it stays outstanding past the round;
 *   - each round's `conversions`: every instrument's cap price, discount
 *     price, round price, which won, its shares and its % after the round;
 *   - `mfn`: for each MFN instrument, each later SAFE with a better cap or not;
 *   - `post_money_check`: what post-money caps together promise, flagged at
 *     100% or more — answered, never quietly rescaled;
 *   - `start`: a scenario begins from recorded holders (the record, D1017)
 *     instead of typed founders.
 */

import {
  convertInstruments, needsExtendedConversion,
  type ConvertibleIn, type SafeBasis, type InstrumentKind,
} from './safeConversion';

type Holder = { holder: string; type: string; shares: number; pct?: number };
type Founder = { name: string; shares: number };
/**
 * Build queue #120 — `basis`, `instrument`, `interest_rate` and
 * `issue_date` are OPTIONAL additions. A SAFE that omits them is a
 * pre-money (YC v1) SAFE and takes the original inline code path, so
 * financing share counts remain unchanged. Exit payouts exclude unallocated reserves.
 */
type SafeIn = {
  name: string; amount: number; cap?: number; discount?: number;
  basis?: SafeBasis; instrument?: InstrumentKind;
  interest_rate?: number; issue_date?: string;
  /** D1018: most-favoured-nation. Reported against later SAFEs, never applied. */
  mfn?: boolean;
  /** D1018: false keeps the instrument outstanding past the round. Default true. */
  converts?: boolean;
};
export type TopUpPayer = 'pre_money' | 'post_money';
type RoundIn = {
  name: string; pre_money: number; investment: number; post_round_pool_pct?: number;
  /** Used only for note interest accrual. */
  conversion_date?: string;
  /** D1018: who carries the pool top-up. Default 'pre_money' (founders). */
  top_up_payer?: TopUpPayer;
};
/** D1018: a recorded holder a scenario starts from. `preference` is a preferred holder's paid-in amount, null when not recorded. */
export type StartHolder = { name: string; type: 'common' | 'preferred' | 'options'; shares: number; preference?: number | null };
export type Inputs = {
  founders?: Founder[];
  option_pool_pct?: number;
  safes?: SafeIn[];
  rounds?: RoundIn[];
  exit_value?: number | null;
  /** D1018: up to four exit values, one waterfall each. */
  exit_values?: number[];
  /** D1018: start from recorded holders instead of `founders` and `option_pool_pct`. */
  start?: { holders: StartHolder[]; pool_shares?: number | null };
};

export const MAX_EXIT_VALUES = 4;
const START_TYPES = ['common', 'preferred', 'options'];

/**
 * Banker's rounding (round-half-to-even). Python 3's built-in `round()`
 * uses this; JS `Math.round` is half-away-from-zero. To stay byte-identical
 * with the FastAPI engine on `.5` boundaries (which DO occur in
 * share-issuance + waterfall payouts), we replicate the Python behaviour
 * for both integer and decimal-place rounding.
 */
function bankersRound(x: number, digits = 0): number {
  if (!Number.isFinite(x)) return x;
  const factor = Math.pow(10, digits);
  const scaled = x * factor;
  const floor = Math.floor(scaled);
  const diff = scaled - floor;
  let result: number;
  if (diff > 0.5) result = floor + 1;
  else if (diff < 0.5) result = floor;
  else result = (floor % 2 === 0) ? floor : floor + 1; // tie → even
  return result / factor;
}
function roundShares(x: number): number { return bankersRound(x, 0); }
function safeDiv(a: number, b: number): number { return b ? a / b : 0; }

function validExit(v: unknown): boolean {
  return Number.isFinite(Number(v)) && Number(v) >= 0 && Number.isSafeInteger(Math.round(Number(v) * 100));
}

export function validateInputs(inputs: Inputs): string[] {
  const errs: string[] = [];
  if (inputs.start != null) {
    // D1018: the record's holders replace typed founders and the pool percentage.
    if ((inputs.founders || []).length || inputs.option_pool_pct) errs.push('A scenario starts from the record or from typed founders, not both.');
    const holders = Array.isArray(inputs.start.holders) ? inputs.start.holders : [];
    if (!holders.some((h) => h?.type === 'common' || h?.type === 'preferred')) errs.push('The record holds no shares to start from.');
    for (const h of holders) {
      if (!h?.name) errs.push('Every recorded holder needs a name.');
      if (!START_TYPES.includes(String(h?.type))) errs.push(`Holder '${h?.name ?? '?'}' type must be common, preferred or options.`);
      if (!Number.isSafeInteger(Number(h?.shares)) || Number(h?.shares) <= 0) errs.push(`Holder '${h?.name ?? '?'}' needs whole shares > 0.`);
      if (h?.preference != null && !(Number.isFinite(Number(h.preference)) && Number(h.preference) >= 0)) errs.push(`Holder '${h?.name ?? '?'}' preference must be a non-negative amount.`);
    }
    const ps = inputs.start.pool_shares;
    if (ps != null && !(Number.isSafeInteger(Number(ps)) && Number(ps) >= 0)) errs.push('The unallocated pool must be a whole number of shares.');
  } else {
    const founders = inputs.founders || [];
    if (founders.length === 0) errs.push('At least one founder is required.');
    for (const f of founders) {
      if (!f?.name) errs.push('Every founder needs a name.');
      if (Number(f?.shares || 0) <= 0) errs.push(`Founder '${f?.name ?? '?'}' needs shares > 0.`);
    }
  }
  const pool = Number(inputs.option_pool_pct || 0);
  if (pool < 0 || pool > 80) errs.push('Option pool % must be between 0 and 80.');
  for (const s of inputs.safes || []) {
    if (!Number.isFinite(Number(s?.amount)) || Number(s?.amount || 0) <= 0) errs.push(`SAFE '${s?.name ?? '?'}' needs a finite amount > 0.`);
    if (s?.cap != null && !Number.isFinite(Number(s.cap))) errs.push(`SAFE '${s?.name ?? '?'}' cap must be finite.`);
    if (Number(s?.cap || 0) <= 0 && Number(s?.discount || 0) <= 0) {
      errs.push(`SAFE '${s?.name ?? '?'}' needs a cap or a discount.`);
    }
    const d = Number(s?.discount || 0);
    if (!(d >= 0 && d <= 0.9)) errs.push(`SAFE '${s?.name ?? '?'}' discount must be 0..0.9.`);
    // Build queue #120 — optional post-money / note fields.
    if (s?.basis != null && s.basis !== 'pre_money' && s.basis !== 'post_money') {
      errs.push(`SAFE '${s?.name ?? '?'}' basis must be 'pre_money' or 'post_money'.`);
    }
    if (s?.instrument != null && s.instrument !== 'safe' && s.instrument !== 'note') {
      errs.push(`'${s?.name ?? '?'}' instrument must be 'safe' or 'note'.`);
    }
    if (s?.interest_rate != null) {
      const r = Number(s.interest_rate);
      if (!(r >= 0 && r <= 0.5)) errs.push(`Note '${s?.name ?? '?'}' interest rate must be 0..0.5.`);
      // Interest with no start date silently accrues nothing, which
      // reads as a bug to the founder who entered a rate.
      if (r > 0 && !s.issue_date) errs.push(`Note '${s?.name ?? '?'}' has an interest rate but no issue date.`);
    }
    if (s?.issue_date != null && s.issue_date !== '' && !/^\d{4}-\d{2}-\d{2}$/.test(String(s.issue_date))) {
      errs.push(`Note '${s?.name ?? '?'}' issue date must be YYYY-MM-DD.`);
    }
    if (s?.mfn != null && typeof s.mfn !== 'boolean') errs.push(`SAFE '${s?.name ?? '?'}' mfn must be true or false.`);
    if (s?.converts != null && typeof s.converts !== 'boolean') errs.push(`SAFE '${s?.name ?? '?'}' converts must be true or false.`);
  }
  for (const r of inputs.rounds || []) {
    if (!r?.name) errs.push('Every round needs a name.');
    if (Number(r?.pre_money || 0) <= 0) errs.push(`Round '${r?.name ?? '?'}' needs pre-money > 0.`);
    if (Number(r?.investment || 0) <= 0) errs.push(`Round '${r?.name ?? '?'}' needs investment > 0.`);
    const pa = Number(r?.post_round_pool_pct || 0);
    if (pa && (pa < 0 || pa > 80)) errs.push(`Round '${r?.name ?? '?'}' pool % must be 0..80.`);
    if (r?.top_up_payer != null && r.top_up_payer !== 'pre_money' && r.top_up_payer !== 'post_money') {
      errs.push(`Round '${r?.name ?? '?'}' top-up payer must be 'pre_money' or 'post_money'.`);
    }
  }
  if (inputs.exit_value != null && !validExit(inputs.exit_value)) {
    errs.push('Exit value must be a finite non-negative amount representable in safe integer cents.');
  }
  if (inputs.exit_values != null) {
    if (!Array.isArray(inputs.exit_values) || inputs.exit_values.length > MAX_EXIT_VALUES) errs.push(`Up to ${MAX_EXIT_VALUES} exit values.`);
    else if (inputs.exit_values.some((v) => v == null || !validExit(v))) errs.push('Each exit value must be a finite non-negative amount representable in safe integer cents.');
  }
  return errs;
}

function ledgerTotal(l: Holder[]): number { return l.reduce((s, h) => s + h.shares, 0); }
function setPct(l: Holder[]): void {
  const t = ledgerTotal(l);
  for (const h of l) h.pct = bankersRound(100 * safeDiv(h.shares, t), 4);
}
function addOrMerge(l: Holder[], holder: string, type: string, shares: number): void {
  for (const h of l) if (h.holder === holder && h.type === type) { h.shares += shares; return; }
  l.push({ holder, type, shares });
}
function snapshot(l: Holder[]): Holder[] {
  const out = l.map((h) => ({ ...h }));
  setPct(out);
  return out;
}

/** D1018 (CT4): how one instrument converted, as numbers the page draws without re-deriving. */
export type ConversionDetail = {
  name: string; instrument: InstrumentKind; basis: SafeBasis; mfn: boolean;
  amount: number; accrued_interest: number; converting_amount: number;
  /** Null when the instrument has no cap, or no discount. */
  cap_price: number | null; discount_price: number | null; round_price: number;
  /** Which price won: the lower of the cap and discount prices. */
  binding: 'cap' | 'discount' | 'none';
  price_per_share: number; shares: number; pct_after_round: number;
};
/** D1018 (CT3): what post-money caps together promise. At 100% or more the terms cannot all be honoured. */
export type PostMoneyCheck = { fraction: number; pct: number; over_100: boolean };

type RoundOut = {
  name: string; pre_money: number; post_money: number; investment: number;
  price_per_share: number; shares_pre: number; shares_post: number;
  ledger: Holder[]; events: string[];
  round_meta: { investor_label: string; investment: number; safe_preferences: Record<string, number> };
  conversions: ConversionDetail[];
  post_money_check: PostMoneyCheck;
  top_up: { shares: number; payer: TopUpPayer } | null;
};

/** D1018 (CT4): an MFN instrument against each later SAFE. Reported, never applied to the conversion. */
export type MfnRead = {
  name: string;
  /** 'date' when both issue dates are recorded, else the order the instruments are listed in. */
  later: Array<{ name: string; cap: number | null; verdict: 'better_cap' | 'no_change'; ordered_by: 'date' | 'listed' }>;
};

export type SimulateResult = {
  founding?: Holder[];
  rounds: RoundOut[];
  founder_dilution: Array<{ founder: string; series: Array<{ round: string; shares: number; pct: number }> }>;
  waterfall: ReturnType<typeof waterfall> | ReturnType<typeof waterfallPreRound> | null;
  /** D1018: one entry per `exit_values` value, in order; null where it could not be calculated. */
  waterfalls?: Array<{ exit_value: number; waterfall: ReturnType<typeof waterfall> | ReturnType<typeof waterfallPreRound> | null }>;
  warnings: string[];
  totals: { shares_outstanding: number; rounds_completed: number };
  mfn?: MfnRead[];
  post_money_check?: PostMoneyCheck;
  /** D1018: instruments set not to convert, still outstanding after the last round. */
  outstanding_instruments?: string[];
  over_100?: boolean;
  errors?: string[];
};

function postMoneyCheck(safes: SafeIn[]): PostMoneyCheck {
  const fraction = safes.reduce((n, s) => n + (s.basis === 'post_money' && Number(s.cap) > 0 ? Number(s.amount) / Number(s.cap) : 0), 0);
  return { fraction: bankersRound(fraction, 6), pct: bankersRound(fraction * 100, 2), over_100: fraction >= 1 };
}

function mfnReads(safes: SafeIn[]): MfnRead[] {
  return safes.flatMap((s, i) => {
    if (s.mfn !== true) return [];
    const later = safes.flatMap((o, j) => {
      if (j === i || o.instrument === 'note') return [];
      const dated = !!s.issue_date && !!o.issue_date;
      const after = dated ? String(o.issue_date) > String(s.issue_date) : j > i;
      if (!after) return [];
      const cap = Number(o.cap) > 0 ? Number(o.cap) : null;
      const better = cap != null && (Number(s.cap) > 0 ? cap < Number(s.cap) : true);
      return [{ name: o.name, cap, verdict: better ? 'better_cap' as const : 'no_change' as const, ordered_by: dated ? 'date' as const : 'listed' as const }];
    });
    return [{ name: s.name, later }];
  });
}

export function simulate(inputs: Inputs): SimulateResult | { errors: string[] } {
  const errs = validateInputs(inputs);
  if (errs.length) return { errors: errs };
  const warnings: string[] = [];

  const ledger: Holder[] = [];
  // D1018: recorded preferred holders keep the amount they paid in as their preference.
  const startPrefs: Record<string, number | null> = {};
  let founders: Founder[];
  if (inputs.start) {
    for (const h of inputs.start.holders) {
      const type = h.type === 'common' ? 'founder' : h.type;
      addOrMerge(ledger, h.name, type, roundShares(Number(h.shares)));
      if (h.type === 'preferred') {
        const prev = startPrefs[h.name];
        startPrefs[h.name] = h.preference == null || prev === null ? null : (prev ?? 0) + Number(h.preference);
      }
    }
    const pool = Number(inputs.start.pool_shares ?? 0);
    if (pool > 0) addOrMerge(ledger, 'Option Pool', 'option_pool', pool);
    founders = inputs.start.holders.filter((h) => h.type === 'common').map((h) => ({ name: h.name, shares: h.shares }));
  } else {
    founders = inputs.founders!;
    for (const f of founders) addOrMerge(ledger, f.name, 'founder', roundShares(Number(f.shares)));
    const initialPoolPct = Number(inputs.option_pool_pct || 0);
    if (initialPoolPct > 0) {
      const founderTotal = ledgerTotal(ledger);
      const target = initialPoolPct / 100;
      const poolShares = roundShares((founderTotal * target) / Math.max(1e-9, 1 - target));
      if (poolShares > 0) addOrMerge(ledger, 'Option Pool', 'option_pool', poolShares);
    }
  }
  const founding = snapshot(ledger);
  let pendingSafes: SafeIn[] = [...(inputs.safes || [])];
  const roundsOut: RoundOut[] = [];

  for (const round of inputs.rounds || []) {
    const events: string[] = [];
    const preMoney = Number(round.pre_money);
    const investment = Number(round.investment);
    const targetPoolPost = Number(round.post_round_pool_pct || 0) / 100;
    const payer: TopUpPayer = round.top_up_payer === 'post_money' ? 'post_money' : 'pre_money';
    // D1018: an instrument set not to convert stays outstanding past this round.
    const converting = pendingSafes.filter((s) => s.converts !== false);
    const carried = pendingSafes.filter((s) => s.converts === false);
    let topUpShares = 0;

    let sharesPre = ledgerTotal(ledger);
    let pricePerShare = safeDiv(preMoney, sharesPre);

    // 1) Option pool top-up (pre-money).
    if (targetPoolPost > 0 && payer === 'pre_money') {
      let estSafeShares = 0;
      for (const s of converting) {
        const cap = Number(s.cap || 0);
        const disc = Number(s.discount || 0);
        const capPrice = cap ? safeDiv(cap, sharesPre) : Infinity;
        const discPrice = disc ? pricePerShare * (1 - disc) : Infinity;
        const conv = Math.min(capPrice, discPrice);
        if (Number.isFinite(conv) && conv > 0) estSafeShares += Number(s.amount) / conv;
      }
      const estNewInv = safeDiv(investment, pricePerShare);
      const estPostExclPool = sharesPre + estSafeShares + estNewInv;
      const currentPool = ledger.filter((h) => h.type === 'option_pool').reduce((s, h) => s + h.shares, 0);
      const t = targetPoolPost;
      const targetPoolShares = roundShares(((estPostExclPool - currentPool) * t) / Math.max(1e-9, 1 - t));
      const topUp = targetPoolShares - currentPool;
      if (topUp > 0) {
        addOrMerge(ledger, 'Option Pool', 'option_pool', topUp);
        events.push(`Option pool topped up by ${topUp.toLocaleString()} shares (target ${(targetPoolPost * 100).toFixed(1)}% post)`);
        topUpShares = topUp;
        sharesPre = ledgerTotal(ledger);
        pricePerShare = safeDiv(preMoney, sharesPre);
      }
    }

    // 2) Convert SAFEs and notes.
    //
    // The legacy inline path preserves financing share counts for plain
    // pre-money SAFEs. Exit payouts use the corrected liquidity rules below.
    // Post-money SAFEs and notes need a fixed-point solve, so they route to
    // services/safeConversion.ts instead.
    const safePrefs: Record<string, number> = {};
    const details: Array<Omit<ConversionDetail, 'pct_after_round'>> = [];
    let check: PostMoneyCheck = { fraction: 0, pct: 0, over_100: false };
    if (needsExtendedConversion(converting as ConvertibleIn[])) {
      const conv = convertInstruments(
        converting as ConvertibleIn[], sharesPre, pricePerShare, round.conversion_date,
      );
      for (const w of conv.warnings) warnings.push(w);
      for (const h of conv.holders) {
        addOrMerge(ledger, h.name, 'safe', h.shares);
        // Liquidation preference follows the money actually put in,
        // which for a note includes accrued interest.
        safePrefs[h.name] = (safePrefs[h.name] || 0) + h.converting_amount;
        const label = h.instrument === 'note' ? 'Note' : 'SAFE';
        const basisLabel = h.basis === 'post_money' ? 'post-money' : 'pre-money';
        const interest = h.accrued_interest > 0
          ? ` (incl. $${h.accrued_interest.toFixed(2)} accrued interest)` : '';
        events.push(
          `${label} '${h.name}' converted (${basisLabel}): ${h.shares.toLocaleString()} shares ` +
          `@ $${h.price_per_share.toFixed(4)} (binding: ${h.binding})${interest}`,
        );
        const src = converting.find((s) => s.name === h.name);
        details.push({
          name: h.name, instrument: h.instrument, basis: h.basis, mfn: src?.mfn === true,
          amount: bankersRound(h.converting_amount - h.accrued_interest, 2), accrued_interest: h.accrued_interest,
          converting_amount: h.converting_amount, cap_price: h.cap_price, discount_price: h.discount_price,
          round_price: bankersRound(pricePerShare, 6), binding: h.binding, price_per_share: h.price_per_share, shares: h.shares,
        });
      }
      check = { fraction: conv.post_money_fraction, pct: bankersRound(conv.post_money_fraction * 100, 2), over_100: conv.over_subscribed };
      if (conv.over_subscribed) {
        events.push(
          `WARNING: post-money caps promise ${(conv.post_money_fraction * 100).toFixed(1)}% of the company — these terms cannot all be honoured.`,
        );
      }
    } else {
      for (const s of converting) {
        const cap = Number(s.cap || 0);
        const disc = Number(s.discount || 0);
        const capPrice = cap ? safeDiv(cap, sharesPre) : Infinity;
        const discPrice = disc ? pricePerShare * (1 - disc) : Infinity;
        const conv = Math.min(capPrice, discPrice);
        const binding = capPrice <= discPrice ? 'cap' : (disc ? 'discount' : '—');
        if (!Number.isFinite(conv) || conv <= 0) {
          warnings.push(`SAFE '${s.name}' has no cap and no discount; skipped.`);
          continue;
        }
        const shares = roundShares(Number(s.amount) / conv);
        addOrMerge(ledger, s.name, 'safe', shares);
        safePrefs[s.name] = (safePrefs[s.name] || 0) + Number(s.amount);
        events.push(`SAFE '${s.name}' converted: ${shares.toLocaleString()} shares @ $${conv.toFixed(4)} (binding: ${binding})`);
        details.push({
          name: s.name, instrument: 'safe', basis: 'pre_money', mfn: s.mfn === true,
          amount: Number(s.amount), accrued_interest: 0, converting_amount: Number(s.amount),
          cap_price: Number.isFinite(capPrice) ? bankersRound(capPrice, 6) : null,
          discount_price: Number.isFinite(discPrice) ? bankersRound(discPrice, 6) : null,
          // A SAFE with neither term was skipped above, so a cap or a discount set the price.
          round_price: bankersRound(pricePerShare, 6), binding: binding === 'discount' ? 'discount' : 'cap',
          price_per_share: bankersRound(conv, 6), shares,
        });
      }
    }
    pendingSafes = carried;
    for (const s of carried) events.push(`SAFE '${s.name}' does not convert at this round; it stays outstanding.`);

    // 3) New investor.
    const newInvShares = roundShares(safeDiv(investment, pricePerShare));
    const investorLabel = `${round.name} Investors`;
    addOrMerge(ledger, investorLabel, 'preferred', newInvShares);
    events.push(`${investorLabel}: ${newInvShares.toLocaleString()} shares for $${investment.toFixed(0)} @ $${pricePerShare.toFixed(4)}/sh`);

    // 4) D1018: a post-money top-up lands after the new money, so every holder carries it.
    if (targetPoolPost > 0 && payer === 'post_money') {
      const currentPool = ledger.filter((h) => h.type === 'option_pool').reduce((n, h) => n + h.shares, 0);
      const exclPool = ledgerTotal(ledger) - currentPool;
      const t = targetPoolPost;
      const topUp = roundShares((exclPool * t) / Math.max(1e-9, 1 - t)) - currentPool;
      if (topUp > 0) {
        addOrMerge(ledger, 'Option Pool', 'option_pool', topUp);
        events.push(`Option pool topped up by ${topUp.toLocaleString()} shares (target ${(targetPoolPost * 100).toFixed(1)}% post), after the new money, so every holder carries it`);
        topUpShares = topUp;
      }
    }

    const sharesPost = ledgerTotal(ledger);
    roundsOut.push({
      name: round.name,
      pre_money: preMoney,
      post_money: preMoney + investment,
      investment,
      price_per_share: bankersRound(pricePerShare, 6),
      shares_pre: sharesPre,
      shares_post: sharesPost,
      ledger: snapshot(ledger),
      events,
      round_meta: { investor_label: investorLabel, investment, safe_preferences: safePrefs },
      conversions: details.map((d) => ({ ...d, pct_after_round: bankersRound(100 * safeDiv(d.shares, sharesPost), 4) })),
      post_money_check: check,
      top_up: targetPoolPost > 0 ? { shares: topUpShares, payer } : null,
    });
  }

  // Founder dilution series.
  const founderNames = founders.map((f) => f.name);
  const series: Record<string, Array<{ round: string; shares: number; pct: number }>> = {};
  for (const n of founderNames) series[n] = [];
  for (const n of founderNames) {
    const f0 = founding.find((h) => h.holder === n);
    series[n].push({ round: 'Founding', shares: f0?.shares || 0, pct: f0?.pct || 0 });
  }
  for (const r of roundsOut) {
    for (const n of founderNames) {
      const row = r.ledger.find((h) => h.holder === n);
      series[n].push({ round: r.name, shares: row?.shares || 0, pct: row?.pct || 0 });
    }
  }
  const founderDilution = founderNames.map((n) => ({ founder: n, series: series[n] }));

  // Waterfall.
  const promised = postMoneyCheck(inputs.safes || []);
  const over100 = promised.over_100 || roundsOut.some((r) => r.post_money_check.over_100);
  const exitAt = (exit: number) => {
    // D1018: an answer that rests on promises that cannot all be honoured is not given. Before
    // a round, #2446's pre-round rule decides: SAFEs that take cash back convert nothing.
    if (over100 && roundsOut.length) {
      warnings.push(`Exit not calculated: post-money caps promise ${promised.pct}% of the company, and these terms cannot all be honoured.`);
      return null;
    }
    if (roundsOut.length && pendingSafes.length) {
      warnings.push('Exit not calculated after the rounds: an instrument set not to convert is still outstanding.');
      return null;
    }
    if (roundsOut.length) {
      if (Object.values(startPrefs).some((v) => v === null)) {
        warnings.push('Exit not calculated: a recorded preferred holder’s paid-in amount is not recorded, so their preference is unknown.');
        return null;
      }
      return waterfall(roundsOut, exit, startPrefs as Record<string, number>);
    }
    if (Object.keys(startPrefs).length) {
      warnings.push('Pre-round exit is not calculated: recorded preferred holders’ preferences are not modelled before a round.');
      return null;
    }
    return waterfallPreRound(snapshot(ledger), pendingSafes, exit, warnings);
  };
  let wf: any = null;
  const exit = inputs.exit_value ?? (inputs.exit_values?.length ? inputs.exit_values[0] : null);
  if (exit != null) wf = exitAt(Number(exit));
  const waterfalls = inputs.exit_values?.map((v) => ({ exit_value: Number(v), waterfall: exitAt(Number(v)) }));

  return {
    founding,
    rounds: roundsOut,
    founder_dilution: founderDilution,
    waterfall: wf,
    ...(waterfalls ? { waterfalls } : {}),
    warnings: [...new Set(warnings)],
    totals: { shares_outstanding: ledgerTotal(ledger), rounds_completed: roundsOut.length },
    mfn: mfnReads(inputs.safes || []),
    post_money_check: promised,
    outstanding_instruments: pendingSafes.map((p) => p.name),
    over_100: over100,
  };
}

function waterfall(roundsOut: RoundOut[], exitValue: number, startPrefs: Record<string, number> = {}) {
  const final = snapshot(roundsOut[roundsOut.length - 1].ledger.filter(h => h.type !== 'option_pool'));
  const totalShares = final.reduce((s, h) => s + h.shares, 0);
  if (totalShares <= 0) {
    return {
      exit_value: exitValue, rows: [],
      totals: { preference_paid: 0, common_pool: 0, total_distributed: 0 },
      assumptions: ['No outstanding shares — nothing to distribute.'],
    };
  }
  const preferences: Record<string, number> = { ...startPrefs };
  for (const r of roundsOut) {
    const m = r.round_meta;
    preferences[m.investor_label] = (preferences[m.investor_label] || 0) + m.investment;
    for (const [name, amt] of Object.entries(m.safe_preferences || {})) {
      preferences[name] = (preferences[name] || 0) + amt;
    }
  }
  const takePref: Record<string, boolean> = {};
  for (const h of final) {
    if (h.type !== 'preferred' && h.type !== 'safe') { takePref[h.holder] = false; continue; }
    const proRata = (exitValue * h.shares) / totalShares;
    takePref[h.holder] = (preferences[h.holder] || 0) > proRata;
  }
  const rows: Array<{ holder: string; type: string; shares: number; pct: number; preference: number; payout: number; source: string }> = [];
  let prefPaid = 0;
  for (const h of final) {
    if (takePref[h.holder]) {
      const pref = preferences[h.holder] || 0;
      const payout = Math.min(pref, Math.max(0, exitValue - prefPaid));
      prefPaid += payout;
      rows.push({
        holder: h.holder, type: h.type, shares: h.shares, pct: h.pct ?? 0,
        preference: pref, payout: bankersRound(payout, 2),
        source: '1x non-participating preference',
      });
    }
  }
  const residual = Math.max(0, exitValue - prefPaid);
  const commonHolders = final.filter((h) => !takePref[h.holder]);
  const commonShares = commonHolders.reduce((s, h) => s + h.shares, 0);
  for (const h of commonHolders) {
    const payout = commonShares > 0 ? (residual * h.shares) / commonShares : 0;
    rows.push({
      holder: h.holder, type: h.type, shares: h.shares, pct: h.pct ?? 0,
      preference: preferences[h.holder] || 0,
      payout: bankersRound(payout, 2),
      source: (h.type === 'preferred' || h.type === 'safe')
        ? 'pro-rata (converted preferred)'
        : 'pro-rata (common)',
    });
  }
  rows.sort((a, b) => b.payout - a.payout);
  return {
    exit_value: exitValue,
    rows,
    totals: {
      preference_paid: bankersRound(prefPaid, 2),
      common_pool: bankersRound(residual, 2),
      total_distributed: bankersRound(prefPaid + residual, 2),
    },
    assumptions: [
      '1× non-participating preferred for SAFE + priced-round investors.',
      'No participation, no multiple, no seniority stack.',
      'Pro-rata across common when residual is distributed.',
      POOL_EXIT_ASSUMPTION,
    ],
  };
}

const POOL_EXIT_ASSUMPTION = 'Unallocated option pool excluded from exit proceeds. Individual option grants are not recorded in scenario inputs.';

/** Allocate integer cents without creating or losing money on rounding. */
function allocateProceeds(amount: number, weights: number[]): number[] {
  const cents = BigInt(Math.round(bankersRound(amount, 2) * 100));
  // Convert each finite share weight's decimal representation into integers
  // at one common scale, including exponent notation. Products and remainders
  // then stay exact even when a large share count would overflow a float.
  const parts = weights.map(w => {
    const [mantissa, exponent = '0'] = w.toString().split('e');
    const [whole, fraction = ''] = mantissa.split('.');
    return { digits: BigInt(whole + fraction), scale: fraction.length - Number(exponent) };
  });
  const scale = parts.reduce((n, p) => Math.max(n, p.scale), 0);
  const units = parts.map(p => p.digits * 10n ** BigInt(scale - p.scale));
  const total = units.reduce((n, w) => n + w, 0n);
  if (total <= 0n) return weights.map(() => 0);
  const products = units.map(w => cents * w);
  const paid = products.map(v => v / total);
  let remainder = cents - paid.reduce((n, v) => n + v, 0n);
  const order = products.map((v, i) => ({ i, fraction: v % total }))
    .sort((a, b) => a.fraction === b.fraction ? a.i - b.i : a.fraction > b.fraction ? -1 : 1);
  for (let i = 0; remainder > 0n; i++, remainder--) paid[order[i].i] += 1n;
  return paid.map(v => Number(v) / 100);
}

function waterfallPreRound(ledger: Holder[], safes: SafeIn[], exitValue: number, warnings: string[]) {
  // No note maturity, exit-repayment or interest date is recorded here.
  if (safes.some(s => s.instrument === 'note')) {
    warnings.push('Pre-round exit is not calculated: outstanding note repayment terms are not recorded.');
    return null;
  }
  const common = ledger.filter(h => h.type !== 'option_pool');
  const baseShares = ledgerTotal(common);
  if (!(baseShares > 0) || !Number.isFinite(baseShares)) {
    warnings.push('Pre-round exit is not calculated: no finite positive issued share total is recorded.');
    return null;
  }
  const purchase = safes.reduce((n, s) => n + Number(s.amount), 0);
  // A discount is a financing term. Without a cap or a recorded liquidity
  // price, do not invent a pre-round conversion valuation.
  if (exitValue > purchase && safes.some(s => !(Number(s.cap) > 0))) {
    warnings.push('Pre-round exit is not calculated: an outstanding SAFE has no recorded liquidity cap or price.');
    return null;
  }
  const cash = new Set<number>();
  safes.forEach((s, i) => {
    if (exitValue <= purchase || exitValue <= Number(s.cap)) cash.add(i);
  });
  let equityShares = safes.map(() => 0);
  // A cash-out SAFE is excluded from liquidity capitalization. Recompute
  // after each election; every pass adds a cash-out, so this is bounded.
  for (let pass = 0; pass <= safes.length; pass++) {
    const cashClaims = safes.reduce((n, s, i) => n + (cash.has(i) ? Number(s.amount) : 0), 0);
    const residual = Math.max(0, exitValue - cashClaims);
    const fractions = safes.map((s, i) => cash.has(i) ? 0 : Number(s.amount) / Number(s.cap));
    const postFraction = safes.reduce((n, s, i) => n + (s.basis === 'post_money' ? fractions[i] : 0), 0);
    if (postFraction >= 1) {
      warnings.push('Pre-round exit is not calculated: converting post-money SAFE caps promise 100% or more of the company.');
      return null;
    }
    const preShares = safes.reduce((n, s, i) => n + (s.basis !== 'post_money' ? fractions[i] * baseShares : 0), 0);
    const total = (baseShares + preShares) / (1 - postFraction);
    equityShares = safes.map((s, i) => fractions[i] * (s.basis === 'post_money' ? total : baseShares));
    let changed = false;
    safes.forEach((s, i) => {
      if (!cash.has(i) && residual * safeDiv(equityShares[i], total) < Number(s.amount)) {
        cash.add(i); changed = true;
      }
    });
    if (!changed) break;
  }
  const cashIndexes = safes.map((_, i) => i).filter(i => cash.has(i));
  const cashClaims = cashIndexes.reduce((n, i) => n + Number(safes[i].amount), 0);
  const prefPaid = bankersRound(Math.min(exitValue, cashClaims), 2);
  const cashPayouts = allocateProceeds(prefPaid, cashIndexes.map(i => Number(safes[i].amount)));
  const rows = cashIndexes.map((i, at) => ({
    holder: safes[i].name, type: 'safe', shares: 0, pct: 0,
    preference: bankersRound(Number(safes[i].amount), 2), payout: cashPayouts[at],
    source: 'purchase amount (SAFE liquidity)',
    // D1018 (CT4): cash back or common at the cap, whichever pays more.
    election: 'cash_back' as 'cash_back' | 'as_converted' | null,
  }));
  const converted = safes.flatMap((s, i) => cash.has(i) ? [] : [{ holder: s.name, type: 'safe', shares: equityShares[i], amount: Number(s.amount) }]);
  const equity = [...common.map(h => ({ ...h, amount: 0 })), ...converted];
  const residual = bankersRound(exitValue - prefPaid, 2);
  const payouts = allocateProceeds(residual, equity.map(h => h.shares));
  const total = ledgerTotal(equity);
  equity.forEach((h, i) => rows.push({
    holder: h.holder, type: h.type, shares: roundShares(h.shares),
    pct: bankersRound(100 * safeDiv(h.shares, total), 4),
    preference: bankersRound(h.amount, 2), payout: payouts[i],
    source: h.type === 'safe' ? 'as-converted (SAFE liquidity)' : 'pro-rata (common)',
    election: h.type === 'safe' ? 'as_converted' : null,
  }));
  rows.sort((a, b) => b.payout - a.payout);
  return {
    exit_value: exitValue, rows,
    totals: { preference_paid: prefPaid, common_pool: residual, total_distributed: bankersRound(prefPaid + residual, 2) },
    assumptions: [
      'Pre-round SAFEs receive the greater of purchase amount or as-converted proceeds, without participation.',
      'Cash-out SAFEs share insufficient proceeds pro-rata, ahead of common; cash-out securities are excluded from liquidity capitalization.',
      'Liquidity conversion uses the recorded cap and basis; discounts apply only to priced financing. No debt or seniority stack is modeled.',
      POOL_EXIT_ASSUMPTION,
    ],
  };
}

// ---------------------------------------------------------------------------
// CSV export — same column layout as the Python `to_csv`.
// ---------------------------------------------------------------------------
function csvEscape(v: unknown): string {
  if (v == null) return '';
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(result: SimulateResult): string {
  const out: string[] = [];
  const w = (...cells: unknown[]) => out.push(cells.map(csvEscape).join(','));
  w('Cap-table simulation export', 'draft, not a 409A valuation');
  w('');

  if (result.founding?.length) {
    w('Section', 'Founding cap table');
    w('Stakeholder', 'Type', 'Shares', 'Ownership %');
    for (const h of result.founding) w(h.holder, h.type, h.shares, (h.pct ?? 0).toFixed(4));
    w('');
  }
  for (const r of result.rounds || []) {
    w('Section', `Post-${r.name} cap table`);
    w('Pre-money', r.pre_money, 'Investment', r.investment, 'Post-money', r.post_money, 'PPS', r.price_per_share);
    w('Stakeholder', 'Security Type', 'Shares', 'Ownership %');
    for (const h of r.ledger) w(h.holder, h.type, h.shares, (h.pct ?? 0).toFixed(4));
    w('');
  }
  if (result.waterfall) {
    const wf = result.waterfall as any;
    w('Section', `Exit waterfall @ $${(wf.exit_value || 0).toFixed(0)}`);
    w('Stakeholder', 'Type', 'Shares', 'Ownership %', 'Liquidation preference $', 'Payout $', 'Source');
    for (const row of wf.rows || []) {
      w(row.holder, row.type, row.shares, (row.pct ?? 0).toFixed(4),
        Number(row.preference).toFixed(2), Number(row.payout).toFixed(2), row.source);
    }
    w('');
    w('Total preference paid', wf.totals.preference_paid);
    w('Common pool', wf.totals.common_pool);
    w('Total distributed', wf.totals.total_distributed);
  }
  return out.join('\n');
}
