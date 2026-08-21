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
 */

export type CashFlowKind = 'contribution' | 'distribution';

export interface CashFlow {
  /** ISO date (YYYY-MM-DD) or anything Date can parse. */
  date: string;
  /** Positive magnitude; direction comes from `kind`, never from sign. */
  amount: number;
  kind: CashFlowKind;
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
  const parsed = flows
    .map(f => ({ t: toTime(f.date), amount: Number(f.amount) }))
    .filter(f => Number.isFinite(f.t) && Number.isFinite(f.amount) && f.amount !== 0)
    .sort((a, b) => a.t - b.t);
  if (parsed.length < 2) return null;
  const hasNeg = parsed.some(f => f.amount < 0);
  const hasPos = parsed.some(f => f.amount > 0);
  if (!hasNeg || !hasPos) return null;

  const t0 = parsed[0].t;
  const LO = -0.9999; // -99.99%: total loss floor
  const HI = 10;      // +1000%: anything above this is noise, not a return
  let lo = LO, hi = HI;
  let fLo = npvAt(lo, parsed, t0);
  let fHi = npvAt(hi, parsed, t0);
  if (!Number.isFinite(fLo) || !Number.isFinite(fHi)) return null;
  if (fLo * fHi > 0) return null; // no root bracketed in range

  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    const fMid = npvAt(mid, parsed, t0);
    if (!Number.isFinite(fMid)) return null;
    if (Math.abs(fMid) < 1e-9 || (hi - lo) < 1e-9) return round4(mid);
    if (fLo * fMid < 0) { hi = mid; fHi = fMid; }
    else { lo = mid; fLo = fMid; }
  }
  return round4((lo + hi) / 2);
}

function round4(n: number): number { return Math.round(n * 10000) / 10000; }
function ratio(numerator: number, denominator: number): number | null {
  if (!(denominator > 0)) return null;
  return Math.round((numerator / denominator) * 10000) / 10000;
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
  // inflow on the as-of date. A zero NAV is still included when there
  // are realisations, so a fully-written-off fund reports its real loss.
  let irr: number | null = null;
  if (clean.length > 0 && terminalDate) {
    const series = clean.map(f => ({
      date: f.date,
      amount: f.kind === 'contribution' ? -f.amount : f.amount,
    }));
    if (navValue > 0) series.push({ date: terminalDate, amount: navValue });
    irr = xirr(series);
  }

  return {
    paid_in: Math.round(paidIn * 100) / 100,
    distributed: Math.round(distributed * 100) / 100,
    nav: Math.round(navValue * 100) / 100,
    total_value: Math.round(totalValue * 100) / 100,
    dpi: ratio(distributed, paidIn),
    rvpi: ratio(navValue, paidIn),
    tvpi: ratio(totalValue, paidIn),
    moic: ratio(totalValue, paidIn),
    irr,
    basis: 'gross',
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
}

/**
 * Roll a single position up. When no mark exists the position carries at
 * cost — the honest default (never an invented step-up), flagged via
 * `unmarked` so the UI can say so rather than implying a valuation.
 */
export function rollUpPosition(invested: number, latestFmv: number | null | undefined): PositionRollup {
  const cost = Number.isFinite(Number(invested)) && Number(invested) > 0 ? Number(invested) : 0;
  const marked = latestFmv != null && Number.isFinite(Number(latestFmv)) && Number(latestFmv) >= 0;
  const fmv = marked ? Number(latestFmv) : cost;
  return {
    invested: Math.round(cost * 100) / 100,
    fmv: Math.round(fmv * 100) / 100,
    multiple: ratio(fmv, cost),
    marked_down: marked && fmv < cost,
    unmarked: !marked,
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
