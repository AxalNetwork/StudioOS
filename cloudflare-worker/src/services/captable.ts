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
};
type RoundIn = {
  name: string; pre_money: number; investment: number; post_round_pool_pct?: number;
  /** Used only for note interest accrual. */
  conversion_date?: string;
};
export type Inputs = {
  founders?: Founder[];
  option_pool_pct?: number;
  safes?: SafeIn[];
  rounds?: RoundIn[];
  exit_value?: number | null;
};

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

export function validateInputs(inputs: Inputs): string[] {
  const errs: string[] = [];
  const founders = inputs.founders || [];
  if (founders.length === 0) errs.push('At least one founder is required.');
  for (const f of founders) {
    if (!f?.name) errs.push('Every founder needs a name.');
    if (Number(f?.shares || 0) <= 0) errs.push(`Founder '${f?.name ?? '?'}' needs shares > 0.`);
  }
  const pool = Number(inputs.option_pool_pct || 0);
  if (pool < 0 || pool > 80) errs.push('Option pool % must be between 0 and 80.');
  for (const s of inputs.safes || []) {
    if (Number(s?.amount || 0) <= 0) errs.push(`SAFE '${s?.name ?? '?'}' needs amount > 0.`);
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
  }
  for (const r of inputs.rounds || []) {
    if (!r?.name) errs.push('Every round needs a name.');
    if (Number(r?.pre_money || 0) <= 0) errs.push(`Round '${r?.name ?? '?'}' needs pre-money > 0.`);
    if (Number(r?.investment || 0) <= 0) errs.push(`Round '${r?.name ?? '?'}' needs investment > 0.`);
    const pa = Number(r?.post_round_pool_pct || 0);
    if (pa && (pa < 0 || pa > 80)) errs.push(`Round '${r?.name ?? '?'}' pool % must be 0..80.`);
  }
  if (inputs.exit_value != null && (!Number.isFinite(Number(inputs.exit_value)) || Number(inputs.exit_value) < 0)) {
    errs.push('Exit value must be a finite non-negative amount.');
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

type RoundOut = {
  name: string; pre_money: number; post_money: number; investment: number;
  price_per_share: number; shares_pre: number; shares_post: number;
  ledger: Holder[]; events: string[];
  round_meta: { investor_label: string; investment: number; safe_preferences: Record<string, number> };
};

export type SimulateResult = {
  founding?: Holder[];
  rounds: RoundOut[];
  founder_dilution: Array<{ founder: string; series: Array<{ round: string; shares: number; pct: number }> }>;
  waterfall: ReturnType<typeof waterfall> | ReturnType<typeof waterfallPreRound> | null;
  warnings: string[];
  totals: { shares_outstanding: number; rounds_completed: number };
  errors?: string[];
};

export function simulate(inputs: Inputs): SimulateResult | { errors: string[] } {
  const errs = validateInputs(inputs);
  if (errs.length) return { errors: errs };
  const warnings: string[] = [];

  const founders = inputs.founders!;
  const ledger: Holder[] = [];
  for (const f of founders) addOrMerge(ledger, f.name, 'founder', roundShares(Number(f.shares)));
  const initialPoolPct = Number(inputs.option_pool_pct || 0);
  if (initialPoolPct > 0) {
    const founderTotal = ledgerTotal(ledger);
    const target = initialPoolPct / 100;
    const poolShares = roundShares((founderTotal * target) / Math.max(1e-9, 1 - target));
    if (poolShares > 0) addOrMerge(ledger, 'Option Pool', 'option_pool', poolShares);
  }
  const founding = snapshot(ledger);
  let pendingSafes: SafeIn[] = [...(inputs.safes || [])];
  const roundsOut: RoundOut[] = [];

  for (const round of inputs.rounds || []) {
    const events: string[] = [];
    const preMoney = Number(round.pre_money);
    const investment = Number(round.investment);
    const targetPoolPost = Number(round.post_round_pool_pct || 0) / 100;

    let sharesPre = ledgerTotal(ledger);
    let pricePerShare = safeDiv(preMoney, sharesPre);

    // 1) Option pool top-up (pre-money).
    if (targetPoolPost > 0) {
      let estSafeShares = 0;
      for (const s of pendingSafes) {
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
        sharesPre = ledgerTotal(ledger);
        pricePerShare = safeDiv(preMoney, sharesPre);
      }
    }

    // 2) Convert SAFEs and notes.
    //
    // The legacy inline path below is preserved EXACTLY for scenarios
    // that use only plain pre-money SAFEs, because saved result_json
    // financing share counts match the original FastAPI engine. Post-money SAFEs and notes need a fixed-point
    // solve that path cannot express, so they route to
    // services/safeConversion.ts instead.
    const safePrefs: Record<string, number> = {};
    if (needsExtendedConversion(pendingSafes as ConvertibleIn[])) {
      const conv = convertInstruments(
        pendingSafes as ConvertibleIn[], sharesPre, pricePerShare, round.conversion_date,
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
      }
      if (conv.over_subscribed) {
        events.push(
          `WARNING: post-money caps promise ${(conv.post_money_fraction * 100).toFixed(1)}% of the company — these terms cannot all be honoured.`,
        );
      }
    } else {
      for (const s of pendingSafes) {
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
      }
    }
    pendingSafes = [];

    // 3) New investor.
    const newInvShares = roundShares(safeDiv(investment, pricePerShare));
    const investorLabel = `${round.name} Investors`;
    addOrMerge(ledger, investorLabel, 'preferred', newInvShares);
    events.push(`${investorLabel}: ${newInvShares.toLocaleString()} shares for $${investment.toFixed(0)} @ $${pricePerShare.toFixed(4)}/sh`);

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
  let wf: any = null;
  const exit = inputs.exit_value;
  if (exit != null && roundsOut.length) wf = waterfall(roundsOut, Number(exit));
  else if (exit != null) wf = waterfallPreRound(snapshot(ledger), pendingSafes, Number(exit), warnings);

  return {
    founding,
    rounds: roundsOut,
    founder_dilution: founderDilution,
    waterfall: wf,
    warnings,
    totals: { shares_outstanding: ledgerTotal(ledger), rounds_completed: roundsOut.length },
  };
}

function waterfall(roundsOut: RoundOut[], exitValue: number) {
  const final = snapshot(roundsOut[roundsOut.length - 1].ledger.filter(h => h.type !== 'option_pool'));
  const totalShares = final.reduce((s, h) => s + h.shares, 0);
  if (totalShares <= 0) {
    return {
      exit_value: exitValue, rows: [],
      totals: { preference_paid: 0, common_pool: 0, total_distributed: 0 },
      assumptions: ['No outstanding shares — nothing to distribute.'],
    };
  }
  const preferences: Record<string, number> = {};
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
  const cents = Math.round(bankersRound(amount, 2) * 100);
  const total = weights.reduce((n, w) => n + w, 0);
  if (total <= 0) return weights.map(() => 0);
  const exact = weights.map(w => cents * w / total);
  const paid = exact.map(Math.floor);
  const remainder = cents - paid.reduce((n, v) => n + v, 0);
  const order = exact.map((v, i) => ({ i, fraction: v - paid[i] }))
    .sort((a, b) => b.fraction - a.fraction || a.i - b.i);
  for (let i = 0; i < remainder; i++) paid[order[i].i] += 1;
  return paid.map(v => v / 100);
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
