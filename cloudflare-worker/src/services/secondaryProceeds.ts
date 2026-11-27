/**
 * Build queue #123 — secondary-sale net proceeds and ROFR state.
 *
 * Pure functions. A secondary sale is the one transaction where a
 * seller's expectation and their actual wire differ most: the headline
 * price is gross, and transfer fees, carry, and withholding come off it
 * in a specific order. Getting the ORDER wrong changes the number, so
 * the waterfall is explicit and each step is returned, not just the
 * total — a seller should be able to see where every dollar went.
 *
 * Deliberately NOT modelled here: taxes owed by the seller personally.
 * The platform does not know their basis, holding period, or
 * jurisdiction, and a wrong tax number is worse than none. Withholding
 * is modelled only when the caller supplies a rate, and is labelled as
 * withholding, not as tax owed.
 */

export interface ProceedsInput {
  /** Gross sale price for the block, in dollars. */
  gross: number;
  /** What the seller originally paid for these shares. */
  costBasis?: number | null;
  /** Company/platform transfer fee as a fraction (0.02 = 2%). */
  transferFeePct?: number | null;
  /** Flat administrative/legal fee in dollars. */
  flatFees?: number | null;
  /** Carried interest on the GAIN only, as a fraction (0.20 = 20%). */
  carryPct?: number | null;
  /** Statutory withholding on the gain, as a fraction. */
  withholdingPct?: number | null;
}

export interface ProceedsLine {
  key: string;
  label: string;
  /** Negative for deductions, positive for the gross line. */
  amount: number;
  /** Running balance after this line. */
  balance: number;
  note?: string;
}

export interface ProceedsResult {
  gross: number;
  net: number;
  lines: ProceedsLine[];
  /** Gain over cost basis, or null when basis is unknown. */
  gain: number | null;
  /** net / gross, 0-1. Null when gross is zero. */
  net_ratio: number | null;
  /** Multiple on the original cost, or null without a basis. */
  multiple: number | null;
  warnings: string[];
}

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
function money(n: number): number { return Math.round(n * 100) / 100; }
function frac(v: unknown): number {
  const n = num(v);
  if (n === null || n <= 0) return 0;
  // A caller passing 20 for "20%" is a common and expensive slip;
  // anything above 1 is rejected rather than silently applied as
  // 2000%, which would drive net proceeds hugely negative.
  return n > 1 ? 0 : n;
}

/**
 * Run the proceeds waterfall.
 *
 * ORDER, and why it is this order:
 *   1. gross
 *   2. transfer fee — charged on the full sale price by the company or
 *      platform effecting the transfer, before anything else
 *   3. flat fees — legal/admin, fixed regardless of size
 *   4. carry — on the GAIN over cost basis, never on gross; carry on
 *      gross would tax the seller's own returned capital
 *   5. withholding — on the gain, and only when a rate is supplied
 *
 * Deductions never drive the balance below zero: a fee structure that
 * would do so is reported as a warning with the balance floored, rather
 * than a negative wire that cannot happen.
 */
export function computeNetProceeds(input: ProceedsInput): ProceedsResult {
  const warnings: string[] = [];
  const gross = Math.max(0, num(input.gross) ?? 0);
  const basis = num(input.costBasis);
  const gain = basis === null ? null : money(gross - basis);

  const lines: ProceedsLine[] = [];
  let balance = gross;
  lines.push({ key: 'gross', label: 'Gross sale price', amount: money(gross), balance: money(gross) });

  const deduct = (key: string, label: string, raw: number, note?: string) => {
    if (raw <= 0) return;
    const applied = Math.min(raw, balance);
    if (applied < raw) {
      warnings.push(`${label} of ${money(raw)} exceeded the remaining balance; capped at ${money(applied)}.`);
    }
    balance -= applied;
    lines.push({ key, label, amount: money(-applied), balance: money(balance), note });
  };

  const transferPct = frac(input.transferFeePct);
  if (num(input.transferFeePct) !== null && transferPct === 0 && (num(input.transferFeePct) ?? 0) > 1) {
    warnings.push('Transfer fee looked like a whole number (e.g. 2 for 2%); it was ignored. Pass 0.02.');
  }
  deduct('transfer_fee', 'Transfer fee', gross * transferPct,
    transferPct ? `${(transferPct * 100).toFixed(2)}% of gross` : undefined);

  deduct('flat_fees', 'Legal and administrative fees', Math.max(0, num(input.flatFees) ?? 0));

  // Carry applies to the gain only. With no basis on file we cannot
  // compute a gain, so carry is skipped and the omission is stated —
  // silently charging carry on gross would take a cut of the seller's
  // own capital.
  const carryPct = frac(input.carryPct);
  if (carryPct > 0) {
    if (gain === null) {
      warnings.push('Carry was not applied: no cost basis on file, so the gain is unknown. Carry is charged on gain, never on gross.');
    } else if (gain > 0) {
      deduct('carry', 'Carried interest', gain * carryPct, `${(carryPct * 100).toFixed(2)}% of the ${money(gain)} gain`);
    }
  }

  const withholdPct = frac(input.withholdingPct);
  if (withholdPct > 0 && gain !== null && gain > 0) {
    deduct('withholding', 'Statutory withholding', gain * withholdPct,
      `${(withholdPct * 100).toFixed(2)}% of gain — withholding, not a final tax figure`);
  }

  const net = money(Math.max(0, balance));
  return {
    gross: money(gross),
    net,
    lines,
    gain,
    net_ratio: gross > 0 ? Math.round((net / gross) * 10000) / 10000 : null,
    multiple: basis !== null && basis > 0 ? Math.round((net / basis) * 10000) / 10000 : null,
    warnings,
  };
}

// ---------- ROFR ----------

export type RofrState =
  | 'not_started'
  | 'notice_served'
  | 'company_exercised'
  | 'investors_exercised'
  | 'partially_exercised'
  | 'waived'
  | 'expired';

export interface RofrInput {
  /** ISO date the transfer notice was served on the company. */
  notice_date?: string | null;
  /** Contractual notice window, in days. */
  window_days?: number | null;
  /** Shares offered in the notice. */
  shares_offered: number;
  /** Shares the company elected to buy. */
  company_elected?: number | null;
  /** Shares existing investors elected to buy. */
  investors_elected?: number | null;
  /** Explicit written waiver received. */
  waived?: boolean;
}

export interface RofrStatus {
  state: RofrState;
  /** Shares the seller may still transfer to the outside buyer. */
  transferable_shares: number;
  /** Shares claimed under the right. */
  claimed_shares: number;
  days_remaining: number | null;
  deadline: string | null;
  /** Plain-language status, safe to render. */
  summary: string;
  /** True when the seller may proceed with the third-party sale. */
  clear_to_transfer: boolean;
}

const MS_PER_DAY = 86_400_000;

/**
 * Where a right-of-first-refusal stands as of `today`.
 *
 * A ROFR is a gate on the whole sale: until it is waived, expired, or
 * elections are in, the seller cannot transfer the un-elected shares.
 * `clear_to_transfer` is deliberately false while a notice is live —
 * defaulting the other way would let the UI green-light a sale that
 * breaches the shareholders' agreement.
 */
export function rofrStatus(input: RofrInput, today: string): RofrStatus {
  const offered = Math.max(0, num(input.shares_offered) ?? 0);
  const company = Math.max(0, num(input.company_elected) ?? 0);
  const investors = Math.max(0, num(input.investors_elected) ?? 0);
  const claimedRaw = company + investors;
  const claimed = Math.min(offered, claimedRaw);
  const transferable = Math.max(0, offered - claimed);

  if (input.waived) {
    return {
      state: 'waived', transferable_shares: offered, claimed_shares: 0,
      days_remaining: null, deadline: null,
      summary: 'The right of first refusal was waived in writing. The full block may transfer.',
      clear_to_transfer: true,
    };
  }

  const noticeTime = input.notice_date ? Date.parse(String(input.notice_date).slice(0, 10)) : NaN;
  if (Number.isNaN(noticeTime)) {
    return {
      state: 'not_started', transferable_shares: 0, claimed_shares: 0,
      days_remaining: null, deadline: null,
      summary: 'No transfer notice served yet. The company must be given notice before any secondary transfer.',
      clear_to_transfer: false,
    };
  }

  const windowDays = Math.max(1, num(input.window_days) ?? 30);
  const deadlineTime = noticeTime + windowDays * MS_PER_DAY;
  const deadline = new Date(deadlineTime).toISOString().slice(0, 10);
  const todayTime = Date.parse(String(today).slice(0, 10));
  const daysRemaining = Number.isNaN(todayTime)
    ? null
    : Math.max(0, Math.ceil((deadlineTime - todayTime) / MS_PER_DAY));

  if (claimed >= offered && offered > 0) {
    const state: RofrState = company >= offered ? 'company_exercised'
      : investors >= offered ? 'investors_exercised' : 'partially_exercised';
    return {
      state, transferable_shares: 0, claimed_shares: claimed,
      days_remaining: daysRemaining, deadline,
      summary: 'The right was exercised in full. No shares remain for the outside buyer.',
      clear_to_transfer: false,
    };
  }

  if (claimed > 0) {
    return {
      state: 'partially_exercised', transferable_shares: transferable, claimed_shares: claimed,
      days_remaining: daysRemaining, deadline,
      summary: `${claimed.toLocaleString()} of ${offered.toLocaleString()} shares were claimed under the right; ${transferable.toLocaleString()} may transfer to the outside buyer.`,
      clear_to_transfer: transferable > 0 && daysRemaining === 0,
    };
  }

  if (daysRemaining !== null && daysRemaining === 0) {
    return {
      state: 'expired', transferable_shares: offered, claimed_shares: 0,
      days_remaining: 0, deadline,
      summary: `The notice period closed on ${deadline} with no election. The full block may transfer.`,
      clear_to_transfer: true,
    };
  }

  return {
    state: 'notice_served', transferable_shares: 0, claimed_shares: 0,
    days_remaining: daysRemaining, deadline,
    summary: `Notice served. The company and its investors have until ${deadline} to elect${daysRemaining !== null ? ` (${daysRemaining} days)` : ''}. No transfer may complete before then.`,
    clear_to_transfer: false,
  };
}
