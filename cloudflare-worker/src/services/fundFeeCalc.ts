/**
 * D709 (#1774) — the 2% management fee, worked out per LP and quarter.
 *
 * PURE. No D1, no `fetch`, no clock: today is an argument, so a test pins it.
 * `services/fundFees.ts` reads the stores, calls `computePeriod()` and saves
 * what it returns.
 *
 * THE ARITHMETIC (decision 4). Actual days, inclusive, over 365, as in D628.
 * Each amount is one exact BigInt fraction rounded once, half to even, to whole
 * cents: a quarter that straddles the investment-period end is one sum of its
 * two segments, rounded once. Half to even because half up drifts in the GP's
 * favour across many lines; D628's `feeForPeriod` rounds half up, so the two
 * can differ by a cent on a line. Anything above `Number.MAX_SAFE_INTEGER`
 * cents is refused.
 */
import { ledgerDate } from './fundLedger';
import { commitmentCents } from './fundCallSplit';

/** Every refusal the calculator gives, as fixed sentences (as D628's `LEDGER_SENTENCES`). */
export const FEE_CALC_SENTENCES = {
  badQuarter: 'Choose a quarter written like 2026Q4.',
  beforeStart: 'This quarter ends before the fee start date. Nothing is billed for it.',
  noTerms: 'Not recorded: no confirmed fee terms are in force for this quarter.',
  noAdmission: 'Not recorded: an LP billed this quarter has no admission date.',
  noNetInvested: 'Not recorded: no net invested capital is recorded on or before the first day after the investment period.',
  catchUpAcrossEnd: 'A catch-up span crosses the investment-period end. A later closing after the investment period is not modelled.',
  catchUpAcrossTerms: 'A catch-up span crosses a change of fee terms.',
  unsafe: 'The fee is too large to record safely in cents.',
  noLps: 'No LP is billable for this quarter.',
} as const;
export type FeeRefusal = typeof FEE_CALC_SENTENCES[keyof typeof FEE_CALC_SENTENCES];

const DAY = 86_400_000;
const YEAR_BPS = 365n * 10_000n;
const toTime = (d: string) => Date.parse(`${d}T00:00:00Z`);
const toDay = (t: number) => new Date(t).toISOString().slice(0, 10);
export const addDays = (d: string, n: number) => toDay(toTime(d) + n * DAY);
/** Days from `start` to `end`, both included; 0 when `end` is before `start`. */
export const daysInclusive = (start: string, end: string) => (end < start ? 0 : Math.round((toTime(end) - toTime(start)) / DAY) + 1);
const later = (a: string, b: string) => (a > b ? a : b);
const earlier = (a: string, b: string) => (a < b ? a : b);

/** `num / den` rounded once, half to even, to a whole number. Both are non-negative. */
export function roundHalfEven(num: bigint, den: bigint): bigint {
  if (den <= 0n || num < 0n) throw new RangeError('roundHalfEven takes a non-negative fraction');
  const q = num / den, r = num % den;
  if (r * 2n > den || (r * 2n === den && q % 2n === 1n)) return q + 1n;
  return q;
}
function safeCents(v: bigint): number | null {
  return v <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(v) : null;
}

export type Quarter = { year: number; q: 1 | 2 | 3 | 4; first: string; last: string };
/** `2026Q4` as its calendar dates, or null. */
export function parseQuarter(raw: unknown): Quarter | null {
  const m = typeof raw === 'string' ? /^(\d{4})Q([1-4])$/.exec(raw) : null;
  if (!m) return null;
  const year = Number(m[1]), q = Number(m[2]) as 1 | 2 | 3 | 4;
  const month = (q - 1) * 3;
  const first = toDay(Date.UTC(year, month, 1)), last = toDay(Date.UTC(year, month + 3, 0));
  return { year, q, first, last };
}
export const quarterOf = (day: string) => `${day.slice(0, 4)}Q${Math.floor((Number(day.slice(5, 7)) - 1) / 3) + 1}`;
export function previousQuarter(quarter: string): string {
  const p = parseQuarter(quarter)!;
  return p.q === 1 ? `${p.year - 1}Q4` : `${p.year}Q${p.q - 1}`;
}

/**
 * Decision 5: a quarter's window runs from the later of its first day and the
 * fee start date to its last day. Null when the quarter ends before the fee start.
 */
export function quarterWindow(quarter: string, feeStart: string): { start: string; end: string; days: number } | null {
  const q = parseQuarter(quarter);
  if (!q || !ledgerDate(feeStart) || q.last < feeStart) return null;
  const start = later(q.first, feeStart);
  return { start, end: q.last, days: daysInclusive(start, q.last) };
}

export type FeeTerms = {
  id: number;
  annual_bps: number;
  basis_after: 'net_invested' | 'committed';
  offset_bps: number;
  fee_start_date: string;
  investment_period_end: string;
  effective_from: string;
};
/** The confirmed version in force on `day`: the latest whose `effective_from` is on or before it. */
export function termsAt(terms: FeeTerms[], day: string): FeeTerms | null {
  return [...terms].filter(t => t.effective_from <= day).sort((a, b) => (a.effective_from < b.effective_from ? 1 : -1))[0] ?? null;
}

export type Segments = { committedDays: number; investedDays: number };
/** The window's days on each side of the investment-period end. */
export function segmentsOf(start: string, end: string, ipEnd: string): Segments {
  return { committedDays: daysInclusive(start, earlier(end, ipEnd)), investedDays: daysInclusive(later(start, addDays(ipEnd, 1)), end) };
}

/**
 * Decision 3 and 4: one LP's fee for a window, as one fraction rounded once.
 * During the investment period the basis is the commitment. After it, it is
 * `netInvested × commitment ÷ totalCommitment` (or the commitment again, when
 * the terms say `committed`).
 */
export function lineFee(input: {
  bps: number; commitmentCents: number; segments: Segments;
  basisAfter: 'net_invested' | 'committed'; netInvestedCents?: number | null; totalCommitmentCents?: number;
}): { feeCents: number; investedShareCents: number | null } | FeeRefusal {
  const bps = BigInt(input.bps), commit = BigInt(input.commitmentCents);
  const { committedDays, investedDays } = input.segments;
  let num: bigint, den: bigint, share: number | null = null;
  if (investedDays > 0 && input.basisAfter === 'net_invested') {
    if (input.netInvestedCents == null) return FEE_CALC_SENTENCES.noNetInvested;
    const total = BigInt(input.totalCommitmentCents ?? 0);
    if (total <= 0n) return FEE_CALC_SENTENCES.noLps;
    const net = BigInt(input.netInvestedCents);
    num = bps * (commit * BigInt(committedDays) * total + net * commit * BigInt(investedDays));
    den = YEAR_BPS * total;
    share = safeCents(roundHalfEven(net * commit, total));
    if (share == null) return FEE_CALC_SENTENCES.unsafe;
  } else {
    num = bps * commit * BigInt(committedDays + investedDays);
    den = YEAR_BPS;
  }
  const fee = safeCents(roundHalfEven(num, den));
  return fee == null ? FEE_CALC_SENTENCES.unsafe : { feeCents: fee, investedShareCents: share };
}

/**
 * Decision 5: the fee on a commitment from the fee start date to the day
 * before the window, as if the LP had joined at the initial closing, with no
 * interest. The span may not cross the investment-period end or a change of
 * terms version.
 */
export function catchUp(input: { terms: FeeTerms[]; feeStart: string; windowStart: string; commitmentCents: number }):
  { days: number; cents: number } | FeeRefusal {
  const end = addDays(input.windowStart, -1);
  if (end < input.feeStart) return { days: 0, cents: 0 };
  const version = termsAt(input.terms, input.feeStart);
  if (!version) return FEE_CALC_SENTENCES.noTerms;
  if (end > version.investment_period_end) return FEE_CALC_SENTENCES.catchUpAcrossEnd;
  if (input.terms.some(t => t.id !== version.id && t.effective_from > input.feeStart && t.effective_from <= end)) return FEE_CALC_SENTENCES.catchUpAcrossTerms;
  const days = daysInclusive(input.feeStart, end);
  const cents = safeCents(roundHalfEven(BigInt(version.annual_bps) * BigInt(input.commitmentCents) * BigInt(days), YEAR_BPS));
  return cents == null ? FEE_CALC_SENTENCES.unsafe : { days, cents };
}

/**
 * Decision 6: split `applied` across lines in proportion to each line's base
 * (gross plus catch-up), shares floored, the residual to the largest line
 * (lowest id on a tie) as D371 splits a call. No line passes its base; a cent
 * that would goes to the next line in that order. Sums exactly to `applied`.
 */
export function allocateOffset(applied: number, lines: Array<{ id: number; base: number }>): Map<number, number> {
  const out = new Map(lines.map(l => [l.id, 0]));
  const total = lines.reduce((s, l) => s + l.base, 0);
  if (applied <= 0 || total <= 0) return out;
  if (applied > total) throw new RangeError('an offset applied cannot pass the lines it offsets');
  let given = 0;
  for (const l of lines) {
    const share = Number((BigInt(applied) * BigInt(l.base)) / BigInt(total));
    out.set(l.id, share); given += share;
  }
  let residual = applied - given;
  const order = [...lines].sort((a, b) => b.base - a.base || a.id - b.id);
  for (const l of order) {
    if (residual <= 0) break;
    const add = Math.min(residual, l.base - out.get(l.id)!);
    if (add > 0) { out.set(l.id, out.get(l.id)! + add); residual -= add; }
  }
  return out;
}

export type FeeLpInput = {
  id: number;
  /** `limited_partners.commitment_amount`: REAL dollars, read through `commitmentCents`. */
  commitment_amount: unknown;
  status: string;
  admitted_on: string | null;
  admission_id: number | null;
  /** Whether the LP has an issued (or paid) line in any earlier period: no catch-up then. */
  has_prior_line: boolean;
};
export type NetInvestedRecord = { id: number; as_of: string; net_invested_cents: number };
export type OffsetInput = { id: number; amount_cents: number; received_on: string };
export type PeriodInputs = {
  quarter: string;
  today: string;
  /** Confirmed versions only. */
  terms: FeeTerms[];
  lps: FeeLpInput[];
  netInvested: NetInvestedRecord[];
  /** Offsets not yet counted in any period. */
  offsets: OffsetInput[];
  previous: { id: number; carried_cents: number } | null;
};
export type FeeLine = {
  limited_partner_id: number; commitment_cents: number; committed_days: number; invested_days: number;
  invested_share_cents: number | null; gross_fee_cents: number; catch_up_days: number; catch_up_cents: number;
  offset_cents: number; net_fee_cents: number;
};
export type PeriodResult = {
  quarter: string;
  window: { start: string; end: string; days: number } | null;
  terms_id: number | null;
  net_invested_id: number | null;
  lines: FeeLine[];
  totals: { gross_cents: number; catch_up_cents: number; offset_pool_cents: number; applied_cents: number; carried_cents: number; net_cents: number };
  inputs: { terms_id: number | null; admission_ids: number[]; net_invested_id: number | null; offset_ids: number[]; previous_period_id: number | null };
  refusals: FeeRefusal[];
};

const BILLABLE = new Set(['committed', 'active']);

/**
 * Decisions 3 to 6 for one quarter. Billable LPs are those the call preview
 * bills (committed or active, a positive commitment), admitted on or before
 * the earlier of the quarter's last day and today. An LP with no admission
 * date is a refusal, never a guess. Refusals leave the lines empty.
 */
export function computePeriod(inputs: PeriodInputs): PeriodResult {
  const empty = (refusals: FeeRefusal[], extra: Partial<PeriodResult> = {}): PeriodResult => ({
    quarter: inputs.quarter, window: null, terms_id: null, net_invested_id: null, lines: [],
    totals: { gross_cents: 0, catch_up_cents: 0, offset_pool_cents: 0, applied_cents: 0, carried_cents: 0, net_cents: 0 },
    inputs: { terms_id: null, admission_ids: [], net_invested_id: null, offset_ids: [], previous_period_id: inputs.previous?.id ?? null },
    refusals, ...extra,
  });
  const q = parseQuarter(inputs.quarter);
  if (!q) return empty([FEE_CALC_SENTENCES.badQuarter]);
  const first = [...inputs.terms].sort((a, b) => (a.effective_from < b.effective_from ? -1 : 1))[0];
  if (!first) return empty([FEE_CALC_SENTENCES.noTerms]);
  const window = quarterWindow(inputs.quarter, first.fee_start_date);
  if (!window) return empty([FEE_CALC_SENTENCES.beforeStart]);
  const terms = termsAt(inputs.terms, window.start);
  if (!terms) return empty([FEE_CALC_SENTENCES.noTerms], { window });

  const refusals = new Set<FeeRefusal>();
  const cutoff = earlier(q.last, inputs.today);
  const billable: Array<FeeLpInput & { cents: number }> = [];
  for (const lp of inputs.lps) {
    const cents = commitmentCents(lp.commitment_amount);
    if (!BILLABLE.has(lp.status) || cents == null) continue;
    if (!lp.admitted_on) { refusals.add(FEE_CALC_SENTENCES.noAdmission); continue; }
    if (lp.admitted_on <= cutoff) billable.push({ ...lp, cents });
  }
  billable.sort((a, b) => a.id - b.id);
  if (!refusals.size && !billable.length) refusals.add(FEE_CALC_SENTENCES.noLps);

  const segments = segmentsOf(window.start, window.end, terms.investment_period_end);
  const totalCommitment = billable.reduce((s, l) => s + l.cents, 0);
  let netRecord: NetInvestedRecord | null = null;
  if (segments.investedDays > 0 && terms.basis_after === 'net_invested') {
    const from = later(window.start, addDays(terms.investment_period_end, 1));
    netRecord = [...inputs.netInvested].filter(n => n.as_of <= from)
      .sort((a, b) => (a.as_of < b.as_of ? 1 : a.as_of > b.as_of ? -1 : b.id - a.id))[0] ?? null;
    if (!netRecord) refusals.add(FEE_CALC_SENTENCES.noNetInvested);
  }

  const lines: FeeLine[] = [];
  if (!refusals.size) {
    for (const lp of billable) {
      const fee = lineFee({ bps: terms.annual_bps, commitmentCents: lp.cents, segments, basisAfter: terms.basis_after,
        netInvestedCents: netRecord?.net_invested_cents ?? null, totalCommitmentCents: totalCommitment });
      if (typeof fee === 'string') { refusals.add(fee); continue; }
      const owes = !lp.has_prior_line && window.start > first.fee_start_date
        ? catchUp({ terms: inputs.terms, feeStart: first.fee_start_date, windowStart: window.start, commitmentCents: lp.cents })
        : { days: 0, cents: 0 };
      if (typeof owes === 'string') { refusals.add(owes); continue; }
      lines.push({ limited_partner_id: lp.id, commitment_cents: lp.cents, committed_days: segments.committedDays, invested_days: segments.investedDays,
        invested_share_cents: segments.investedDays > 0 ? fee.investedShareCents ?? lp.cents : null,
        gross_fee_cents: fee.feeCents, catch_up_days: owes.days, catch_up_cents: owes.cents, offset_cents: 0, net_fee_cents: 0 });
    }
  }
  if (refusals.size) return empty([...refusals], { window, terms_id: terms.id, net_invested_id: netRecord?.id ?? null });

  // Decision 6: each uncounted offset received before the window counts now, at the terms' offset rate.
  const counted = inputs.offsets.filter(o => o.received_on < window.start).sort((a, b) => a.id - b.id);
  let newly = 0n;
  for (const o of counted) newly += roundHalfEven(BigInt(o.amount_cents) * BigInt(terms.offset_bps), 10_000n);
  const pool = BigInt(inputs.previous?.carried_cents ?? 0) + newly;
  const base = lines.reduce((s, l) => s + BigInt(l.gross_fee_cents + l.catch_up_cents), 0n);
  const applied = pool < base ? pool : base;
  const sums = [pool, base, applied].map(safeCents);
  if (sums.some(v => v == null)) return empty([FEE_CALC_SENTENCES.unsafe], { window, terms_id: terms.id });
  const split = allocateOffset(Number(applied), lines.map(l => ({ id: l.limited_partner_id, base: l.gross_fee_cents + l.catch_up_cents })));
  for (const l of lines) {
    l.offset_cents = split.get(l.limited_partner_id) ?? 0;
    l.net_fee_cents = l.gross_fee_cents + l.catch_up_cents - l.offset_cents;
  }
  const sum = (k: keyof FeeLine) => lines.reduce((s, l) => s + Number(l[k] ?? 0), 0);
  return {
    quarter: inputs.quarter, window, terms_id: terms.id, net_invested_id: netRecord?.id ?? null, lines,
    totals: { gross_cents: sum('gross_fee_cents'), catch_up_cents: sum('catch_up_cents'), offset_pool_cents: Number(pool),
      applied_cents: Number(applied), carried_cents: Number(pool - applied), net_cents: sum('net_fee_cents') },
    inputs: { terms_id: terms.id, admission_ids: billable.map(l => l.admission_id).filter((v): v is number => v != null).sort((a, b) => a - b),
      net_invested_id: netRecord?.id ?? null, offset_ids: counted.map(o => o.id), previous_period_id: inputs.previous?.id ?? null },
    refusals: [],
  };
}
