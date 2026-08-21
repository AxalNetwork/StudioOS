/**
 * T12 — Cap-table simulation engine. Pure-function port of
 * backend/app/services/captable.py. No I/O, no DB, fully deterministic
 * so the route handler can call this in any order it likes.
 *
 * Conventions match the FastAPI source verbatim so the saved
 * `result_json` blobs and CSV exports stay byte-identical:
 *   - Shares are integers; round at every issuance step.
 *   - Pre-money SAFE convention (YC v1).
 *   - Option-pool top-ups are pre-money.
 *   - Waterfall = 1× non-participating preferred for SAFE +
 *     priced-round investors; founders / option pool = common.
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
 * every saved `result_json` blob stays byte-identical.
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
    // blobs and CSV exports are contractually byte-identical with the
    // FastAPI engine. Post-money SAFEs and notes need a fixed-point
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
  else if (exit != null) wf = waterfallPreRound(snapshot(ledger), Number(exit));

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
  const final = roundsOut[roundsOut.length - 1].ledger;
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
    ],
  };
}

function waterfallPreRound(ledger: Holder[], exitValue: number) {
  const total = ledger.reduce((s, h) => s + h.shares, 0);
  const rows = ledger.map((h) => ({
    holder: h.holder, type: h.type, shares: h.shares, pct: h.pct ?? 0,
    preference: 0,
    payout: total ? bankersRound((exitValue * h.shares) / total, 2) : 0,
    source: 'pro-rata (common)',
  }));
  rows.sort((a, b) => b.payout - a.payout);
  return {
    exit_value: exitValue, rows,
    totals: { preference_paid: 0, common_pool: exitValue, total_distributed: exitValue },
    assumptions: ['Pre-round exit — all common, pro-rata.'],
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
