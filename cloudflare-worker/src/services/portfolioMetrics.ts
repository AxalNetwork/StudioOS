/**
 * Build queue #125 — portfolio performance engine.
 *
 * Pure functions only: dated cash flows in, fund metrics out. No D1, no
 * env, no I/O — the route layer assembles the cash flows and calls in
 * here, and the test file pins the arithmetic against worked examples.
 *
 * Definitions follow ILPA reporting conventions:
 *
 *   Paid-in (PIC)  Σ contributions (capital actually deployed)
 *   Distributed    Σ distributions (realisations returned)
 *   NAV / RV       Σ carrying value of unrealised positions (latest mark)
 *   DPI            distributed / paid-in            "cash back"
 *   RVPI           NAV / paid-in                    "cash still on the table"
 *   TVPI           (distributed + NAV) / paid-in    = DPI + RVPI
 *   MOIC           (distributed + NAV) / paid-in, gross of fees
 *   IRR            money-weighted return on dated flows (XIRR)
 *
 * TVPI and MOIC share a formula here on purpose: the platform holds
 * gross deployed cost, not fee-and-carry-adjusted LP capital. The route
 * labels MOIC "gross" and does NOT claim TVPI is net — see the
 * `basis` field returned by computeFundMetrics.
 *
 * D4644 (#4644) — the supported domain, and what each answer means.
 *
 * A return is one of three things, and they are never collapsed into a
 * bare null:
 *
 *   computed     a real rate or ratio, zero included. Zero is a RECORDED
 *                return (capital back and no more), not a missing one.
 *   total_loss   capital was deployed and nothing came back: no
 *                distribution and no carrying value. Reported as -1
 *                (-100%), the ILPA convention, because the fund did not
 *                fail to have a return, it lost everything. The solver
 *                cannot reach it: its floor is -99.99%, and a terminal
 *                value of exactly zero has no interior root.
 *   unavailable  the inputs do not define a return. `*_reason` says which:
 *                  no_flows          nothing recorded yet
 *                  single_flow       one dated flow; a rate needs two points
 *                  no_contribution   money came back with no capital in
 *                  no_paid_in        a ratio with a zero denominator
 *                  outside_bracket   no root in [-99.99%, +1000%]
 *                  not_a_number      a flow's date or amount is unusable
 *
 * The unit does not change here: IRR stays a FRACTION (0.1 is ten per
 * cent) and `frontend/src/lib/rate.js` formats it, as D4619 settled. The
 * states are additive fields beside it, so a caller that reads only `irr`
 * behaves exactly as it did.
 */

export type CashFlowKind = 'contribution' | 'distribution';

export interface CashFlow {
  /** ISO date (YYYY-MM-DD) or anything Date can parse. */
  date: string;
  /** Positive magnitude; direction comes from `kind`, never from sign. */
  amount: number;
  kind: CashFlowKind;
}

/** D4644: which of the three answers a return metric gave. */
export type ReturnState = 'computed' | 'total_loss' | 'unavailable';

/** D4644: why a return is unavailable. Null whenever the state is not `unavailable`. */
export type ReturnReason =
  | 'no_flows'
  | 'single_flow'
  | 'no_contribution'
  | 'no_paid_in'
  | 'outside_bracket'
  | 'not_a_number';

export interface ReturnFigure {
  /** A fraction for rates, a multiple for ratios. Null only when unavailable. */
  value: number | null;
  state: ReturnState;
  reason: ReturnReason | null;
}

export interface FundMetrics {
  paid_in: number;
  distributed: number;
  nav: number;
  total_value: number;
  dpi: number | null;
  rvpi: number | null;
  tvpi: number | null;
  moic: number | null;
  irr: number | null;
  /** Honest labelling for the UI's methodology tooltip. */
  basis: 'gross';
  /**
   * D4644: the same five figures with their state and reason. The flat fields
   * above stay a fraction or a multiple and are what existing callers read;
   * these say whether a null is "nothing recorded", "a total loss" or
   * "undefined on these inputs", and why.
   */
  returns: {
    irr: ReturnFigure;
    dpi: ReturnFigure;
    rvpi: ReturnFigure;
    tvpi: ReturnFigure;
    moic: ReturnFigure;
  };
  /** Inputs that produced the numbers, so the UI can show its work. */
  flow_count: number;
  first_flow_date: string | null;
  as_of: string | null;
}

const MS_PER_DAY = 86_400_000;
const DAYS_PER_YEAR = 365;

function toTime(d: string): number {
  const t = Date.parse(d);
  return Number.isNaN(t) ? NaN : t;
}

/** Sum of flows discounted to the first flow's date at annual rate `r`. */
function npvAt(rate: number, flows: Array<{ t: number; amount: number }>, t0: number): number {
  let acc = 0;
  for (const f of flows) {
    const years = (f.t - t0) / MS_PER_DAY / DAYS_PER_YEAR;
    acc += f.amount / Math.pow(1 + rate, years);
  }
  return acc;
}

/**
 * XIRR over irregularly dated flows. Contributions are negative (money
 * out), distributions and the terminal NAV positive (money in).
 *
 * Bisection rather than Newton-Raphson: slower to converge but it cannot
 * diverge or land on a spurious root, which matters when a fund has a
 * short history and a lumpy flow schedule. Returns null when no sign
 * change exists (all-in or all-out), when the series is degenerate, or
 * when no root is bracketed inside [-99%, +1000%] — a null renders as
 * "—" rather than a fabricated rate.
 */
export function xirr(flows: Array<{ date: string; amount: number }>): number | null {
  return xirrDetail(flows).value;
}

/**
 * D4644: `xirr` with its reason. The rate is identical; this says why there
 * isn't one when there isn't, instead of returning a null that means six
 * different things. `xirr` is the thin wrapper above, so existing callers and
 * the worked examples they pin are untouched.
 *
 * Note this function never reports `total_loss`: it sees only signed flows, and
 * cannot tell "nothing came back" from "the caller left the terminal value
 * out". `computeFundMetrics` owns that judgement, because it knows the NAV.
 */
export function xirrDetail(flows: Array<{ date: string; amount: number }>): ReturnFigure {
  const supplied = flows.length;
  const parsed = flows
    .map(f => ({ t: toTime(f.date), amount: Number(f.amount) }))
    .filter(f => Number.isFinite(f.t) && Number.isFinite(f.amount) && f.amount !== 0)
    .sort((a, b) => a.t - b.t);
  if (parsed.length < 2) {
    // Told apart so a caller can say "nothing is recorded" rather than
    // "these dates are unusable", which are different problems to fix.
    if (supplied === 0) return unavailable('no_flows');
    if (supplied > parsed.length && parsed.length === 0) return unavailable('not_a_number');
    return unavailable(parsed.length === 0 ? 'no_flows' : 'single_flow');
  }
  const hasNeg = parsed.some(f => f.amount < 0);
  const hasPos = parsed.some(f => f.amount > 0);
  // No capital out: a return on nothing. No money in: the caller's business
  // (computeFundMetrics reads it as a total loss when the NAV is zero too).
  if (!hasNeg) return unavailable('no_contribution');
  if (!hasPos) return unavailable('outside_bracket');

  const t0 = parsed[0].t;
  const LO = -0.9999; // -99.99%: total loss floor
  const HI = 10;      // +1000%: anything above this is noise, not a return
  let lo = LO, hi = HI;
  let fLo = npvAt(lo, parsed, t0);
  // The upper bracket's NPV is needed only to confirm a root is bracketed
  // before the loop starts. Inside the loop the sign test is always taken
  // against fLo, so the upper value is never re-read — hence a const, and
  // no dead store when `hi` moves.
  const fHiInitial = npvAt(hi, parsed, t0);
  if (!Number.isFinite(fLo) || !Number.isFinite(fHiInitial)) return unavailable('not_a_number');
  if (fLo * fHiInitial > 0) return unavailable('outside_bracket'); // no root bracketed in range

  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    const fMid = npvAt(mid, parsed, t0);
    if (!Number.isFinite(fMid)) return unavailable('not_a_number');
    if (Math.abs(fMid) < 1e-9 || (hi - lo) < 1e-9) return computed(round4(mid));
    if (fLo * fMid < 0) hi = mid;
    else { lo = mid; fLo = fMid; }
  }
  return computed(round4((lo + hi) / 2));
}

function round4(n: number): number { return Math.round(n * 10000) / 10000; }

// D4644: the three answers, built in one place so no caller invents a fourth.
function computed(value: number): ReturnFigure { return { value, state: 'computed', reason: null }; }
function unavailable(reason: ReturnReason): ReturnFigure { return { value: null, state: 'unavailable', reason }; }
/** Capital deployed, nothing back: -100%, the ILPA convention (D4644). */
function totalLoss(): ReturnFigure { return { value: -1, state: 'total_loss', reason: null }; }

/**
 * A ratio and why it has no value. A zero numerator over a positive
 * denominator is a RECORDED zero (nothing distributed yet is a real DPI of
 * zero); only a non-positive denominator makes it undefined.
 */
function ratioFigure(numerator: number, denominator: number): ReturnFigure {
  if (!(denominator > 0)) return unavailable('no_paid_in');
  if (!Number.isFinite(numerator)) return unavailable('not_a_number');
  return computed(Math.round((numerator / denominator) * 10000) / 10000);
}
function ratio(numerator: number, denominator: number): number | null {
  return ratioFigure(numerator, denominator).value;
}

/**
 * Fund-level metrics from dated cash flows plus the current carrying
 * value of unrealised positions.
 *
 * `asOf` dates the terminal NAV for the IRR calculation; it defaults to
 * the last flow date. The caller passes today's date in production —
 * this function never reads the clock, so the same inputs always
 * produce the same output (and the tests stay deterministic).
 */
export function computeFundMetrics(
  flows: CashFlow[],
  nav: number,
  asOf?: string,
): FundMetrics {
  const clean = flows
    .filter(f => Number.isFinite(Number(f.amount)) && Number(f.amount) > 0 && Number.isFinite(toTime(f.date)))
    .map(f => ({ ...f, amount: Number(f.amount) }))
    .sort((a, b) => toTime(a.date) - toTime(b.date));

  const paidIn = clean.filter(f => f.kind === 'contribution').reduce((a, f) => a + f.amount, 0);
  const distributed = clean.filter(f => f.kind === 'distribution').reduce((a, f) => a + f.amount, 0);
  const navValue = Number.isFinite(Number(nav)) && Number(nav) > 0 ? Number(nav) : 0;
  const totalValue = distributed + navValue;

  const firstFlowDate = clean.length > 0 ? clean[0].date : null;
  const lastFlowDate = clean.length > 0 ? clean[clean.length - 1].date : null;
  const terminalDate = asOf || lastFlowDate;

  // IRR series: contributions out, distributions in, NAV as a terminal
  // inflow on the as-of date. A zero NAV adds no flow (the solver drops a
  // zero amount anyway); the total-loss case below is what reports it.
  let irrFigure: ReturnFigure = unavailable('no_flows');
  if (clean.length > 0 && terminalDate) {
    const series = clean.map(f => ({
      date: f.date,
      amount: f.kind === 'contribution' ? -f.amount : f.amount,
    }));
    if (navValue > 0) series.push({ date: terminalDate, amount: navValue });
    // D4644: at the fund level the reason names the missing INPUT, which is
    // what the reader can act on; `xirrDetail`'s own reasons describe the
    // series it was handed. So the two cases the fund knows about are decided
    // here, and only then is the solver asked.
    //   · No capital in: the same diagnosis the ratios give, `no_paid_in`.
    //     (The solver would say `single_flow` or `no_contribution`, which send
    //     the reader looking for a date rather than for the missing capital.)
    //   · Capital deployed and nothing to show for it: a total loss, -100%.
    //     The solver cannot reach it — with no inflow the NPV never crosses
    //     zero inside [-99.99%, +1000%] — so it is decided here, with the NAV.
    if (paidIn <= 0) irrFigure = unavailable('no_paid_in');
    else if (distributed === 0 && navValue === 0) irrFigure = totalLoss();
    else irrFigure = xirrDetail(series);
  }

  const dpi = ratioFigure(distributed, paidIn);
  const rvpi = ratioFigure(navValue, paidIn);
  const tvpi = ratioFigure(totalValue, paidIn);

  return {
    paid_in: Math.round(paidIn * 100) / 100,
    distributed: Math.round(distributed * 100) / 100,
    nav: Math.round(navValue * 100) / 100,
    total_value: Math.round(totalValue * 100) / 100,
    dpi: dpi.value,
    rvpi: rvpi.value,
    tvpi: tvpi.value,
    moic: tvpi.value,
    irr: irrFigure.value,
    basis: 'gross',
    // MOIC shares TVPI's figure, as the header says: the platform holds gross
    // deployed cost, so the two are the same number under this basis.
    returns: { irr: irrFigure, dpi, rvpi, tvpi, moic: tvpi },
    flow_count: clean.length,
    first_flow_date: firstFlowDate,
    as_of: terminalDate,
  };
}

// ---------- position-level helpers ----------

export interface PositionRollup {
  invested: number;
  fmv: number;
  multiple: number | null;
  /** True when the latest mark is below cost — the UI flags these. */
  marked_down: boolean;
  /** True when carrying value is cost because no mark exists yet. */
  unmarked: boolean;
  /**
   * D4644: set when a mark IS recorded but cannot be a carrying value, so the
   * position is not reported as simply unmarked. The position still carries at
   * cost, as an unmarked one does, and the reason says the figure needs fixing
   * rather than recording.
   */
  unsupported: 'negative_fmv' | null;
}

/**
 * Roll a single position up. When no mark exists the position carries at
 * cost — the honest default (never an invented step-up), flagged via
 * `unmarked` so the UI can say so rather than implying a valuation.
 */
export function rollUpPosition(invested: number, latestFmv: number | null | undefined): PositionRollup {
  const cost = Number.isFinite(Number(invested)) && Number(invested) > 0 ? Number(invested) : 0;
  const supplied = latestFmv != null && Number.isFinite(Number(latestFmv));
  // D4644: a recorded but negative value is not a carrying value. It is kept
  // apart from "no mark" so the page says which of the two it is.
  const unsupported = supplied && Number(latestFmv) < 0 ? 'negative_fmv' as const : null;
  const marked = supplied && !unsupported;
  const fmv = marked ? Number(latestFmv) : cost;
  return {
    invested: Math.round(cost * 100) / 100,
    fmv: Math.round(fmv * 100) / 100,
    multiple: ratio(fmv, cost),
    marked_down: marked && fmv < cost,
    unmarked: !marked,
    unsupported,
  };
}

// ---------- KPI reporting cadence ----------

export type KpiCadence = 'monthly' | 'quarterly';

/**
 * The period a report is due for, as of `today`. Monthly periods are
 * `YYYY-MM`; quarterly are `YYYY-Qn`. Pure: the caller supplies today.
 */
export function currentPeriod(cadence: KpiCadence, today: string): string | null {
  const t = toTime(today);
  if (!Number.isFinite(t)) return null;
  const d = new Date(t);
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() + 1;
  if (cadence === 'monthly') return `${y}-${String(m).padStart(2, '0')}`;
  return `${y}-Q${Math.floor((m - 1) / 3) + 1}`;
}

/**
 * #4647 (D4647) — the last period that has ENDED, as of `today`.
 *
 * `currentPeriod` names the period `today` falls inside, which for a reporting
 * measure is the wrong default and wrong in one direction: on 2 October, Q4 is
 * one day old, nobody can have reported on it yet, and a completion read
 * against it says every company in the book is delinquent. A reporting period
 * can only be measured once it is over, so this is what a default resolves to;
 * `currentPeriod` stays for the question "which period are we in".
 *
 * The year transition is the case to get right, and it is why this is a
 * function and not a subtraction: January's completed month is the previous
 * December, and Q1's completed quarter is the previous year's Q4.
 */
export function completedPeriod(cadence: KpiCadence, today: string): string | null {
  const t = toTime(today);
  if (!Number.isFinite(t)) return null;
  const d = new Date(t);
  const y = d.getUTCFullYear();
  if (cadence === 'monthly') {
    const m = d.getUTCMonth(); // 0-based: already the previous month's index
    return m === 0 ? `${y - 1}-12` : `${y}-${String(m).padStart(2, '0')}`;
  }
  const q = Math.floor(d.getUTCMonth() / 3) + 1;
  return q === 1 ? `${y - 1}-Q4` : `${y}-Q${q - 1}`;
}

/**
 * The first and last dates a period covers, so a response can state the window
 * it measured instead of leaving a reader to infer it from a label.
 */
export function periodBounds(cadence: KpiCadence, period: string): { from: string; until: string } | null {
  const q = /^(\d{4})-Q([1-4])$/.exec(period);
  if (cadence === 'quarterly') {
    if (!q) return null;
    const year = Number(q[1]);
    const first = (Number(q[2]) - 1) * 3 + 1;
    const last = first + 2;
    return { from: `${year}-${String(first).padStart(2, '0')}-01`, until: endOfMonth(year, last) };
  }
  const m = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(period);
  if (!m) return null;
  return { from: `${m[1]}-${m[2]}-01`, until: endOfMonth(Number(m[1]), Number(m[2])) };
}

/** The last day of a month, from the calendar rather than a table of lengths (February, leap years). */
function endOfMonth(year: number, month: number): string {
  const next = month === 12 ? Date.UTC(year + 1, 0, 1) : Date.UTC(year, month, 1);
  return new Date(next - 86_400_000).toISOString().slice(0, 10);
}

/** True when the period has ended on or before `today`, so a completion figure over it is final. */
export function periodComplete(cadence: KpiCadence, period: string, today: string): boolean | null {
  const bounds = periodBounds(cadence, period);
  if (!bounds) return null;
  const t = toTime(today);
  if (!Number.isFinite(t)) return null;
  return bounds.until <= String(today).slice(0, 10);
}

/**
 * D1057 (#2927, #2427 finding 3): whether an update's stored `period` counts
 * for the period a report is due for.
 *
 * Two writers store a period, in two shapes: the founder's KPI form stores
 * whatever was typed (`YYYY-Qn` when it follows the rule), and Grow's Share
 * an update stores the month its period starts in (`YYYY-MM`). Comparing the
 * two as strings read every Grow update as "Not reported" for a quarter.
 *   · Quarterly: `YYYY-Qn` is that quarter; a month inside it counts for it.
 *   · Monthly: months are compared; a quarter does not count for a month,
 *     because it does not say which month it reports.
 * Anything else (blank, free text) counts for nothing. Pure.
 */
export function periodCounts(cadence: KpiCadence, due: string | null, stored: string | null | undefined): boolean {
  if (!due) return false;
  const s = String(stored ?? '').trim();
  if (cadence === 'monthly') return /^\d{4}-(0[1-9]|1[0-2])$/.test(s) && s === due;
  if (s === due) return /^\d{4}-Q[1-4]$/.test(s);
  const month = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(s);
  if (!month) return false;
  return `${month[1]}-Q${Math.floor((Number(month[2]) - 1) / 3) + 1}` === due;
}

/**
 * Days since a company last reported, or null if it never has. Drives
 * the design's stale-update alert rule.
 */
export function daysSince(lastDate: string | null | undefined, today: string): number | null {
  if (!lastDate) return null;
  const a = toTime(lastDate);
  const b = toTime(today);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((b - a) / MS_PER_DAY));
}
