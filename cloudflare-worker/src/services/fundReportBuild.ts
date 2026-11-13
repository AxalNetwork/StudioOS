/**
 * D712 (#1777) — the quarterly pack's builders: one `lp_capital_statement` per
 * LP of an administered fund and one `lp_quarterly_report` per fund, built
 * from the fund records (decision 8).
 *
 * Every figure is integer cents. A missing input makes its line
 * `{ cents: null, reason }`, never 0. The builder reads only the fund records;
 * it never calls a bank, never decrypts a token, and has no path that moves
 * money (decision 11). PR 2 reads #1775's stored Mercury rows through
 * `fundCashSummary.ts` (the Fund's cash and the report's unmatched count),
 * #1774's admissions and its issued fee periods.
 */
import type { Env } from '../types';
import { splitCall } from './fundCallSplit';
import { readFundPerformance } from './fundPerformance';
import { NO_FUND_ACCOUNT, fundCash } from './fundCashSummary';

export type Line = { cents: number } | { cents: null; reason: string };
export type Ratio = { value: number } | { value: null; reason: string };
export type Period = { label: string; start: string; end: string };

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pad = (n: number) => String(n).padStart(2, '0');
const lastDay = (year: number, month: number) => new Date(Date.UTC(year, month, 0)).getUTCDate();
const day = (d: Date) => d.toISOString().slice(0, 10);
const nextDay = (iso: string) => day(new Date(Date.parse(`${iso}T00:00:00Z`) + 86_400_000));
const known = (value: number): { cents: number } => ({ cents: value });
const missing = (reason: string): Line => ({ cents: null, reason });

export { NO_FUND_ACCOUNT };
export const NAV_BASIS = 'before carried interest, which is not accrued';
export const DISTRIBUTION_BASIS = 'date recorded when marked paid';
export const ADMISSION_NOT_RECORDED = 'Admission date: Not recorded';

/** `Q3 2026` → its first and last day, or null for anything else. */
export function quarterPeriod(label: unknown): Period | null {
  const m = /^Q([1-4]) (\d{4})$/.exec(String(label ?? '').trim());
  if (!m) return null;
  const q = Number(m[1]); const year = Number(m[2]);
  if (year < 2000 || year > 2999) return null;
  const firstMonth = (q - 1) * 3 + 1; const lastMonth = q * 3;
  return { label: `Q${q} ${year}`, start: `${year}-${pad(firstMonth)}-01`, end: `${year}-${pad(lastMonth)}-${pad(lastDay(year, lastMonth))}` };
}

/** `2026-09` → the month, or null. */
export function monthPeriod(label: unknown): Period | null {
  const m = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(String(label ?? '').trim());
  if (!m) return null;
  const year = Number(m[1]); const month = Number(m[2]);
  return { label: `${m[1]}-${m[2]}`, start: `${m[1]}-${m[2]}-01`, end: `${m[1]}-${m[2]}-${pad(lastDay(year, month))}` };
}

/** The quarter containing `today`'s previous quarter: the last closed one. */
export function lastClosedQuarter(today: string): Period {
  const [y, mo] = today.split('-').map(Number);
  const q = Math.floor((mo - 1) / 3) + 1;
  return q === 1 ? quarterPeriod(`Q4 ${y - 1}`)! : quarterPeriod(`Q${q - 1} ${y}`)!;
}

/** The month before `today`'s: the last closed one. */
export function lastClosedMonth(today: string): Period {
  const [y, mo] = today.split('-').map(Number);
  return mo === 1 ? monthPeriod(`${y - 1}-12`)! : monthPeriod(`${y}-${pad(mo - 1)}`)!;
}

/** A period is closed once its last day is behind `today`. */
export const isClosed = (p: Period, today: string) => p.end < today;
/** "Sep 2026", for a reader. */
export const monthWord = (iso: string) => `${MONTHS[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}`;

// ── Who the queue covers (decision 5) ────────────────────────────────────────

/** Funds whose GP of record is absent or an admin account. An outside GP's fund is theirs. */
export async function administeredFunds(env: Env): Promise<Array<{ id: number; name: string }>> {
  const res = await env.DB.prepare(
    `SELECT f.id, f.name FROM vc_funds f
      WHERE f.gp_user_id IS NULL OR EXISTS (SELECT 1 FROM users u WHERE u.id = f.gp_user_id AND u.role = 'admin')
      ORDER BY f.id`,
  ).all<{ id: number; name: string }>();
  return res.results || [];
}

export async function isAdministered(env: Env, fundId: number): Promise<boolean> {
  return !!await env.DB.prepare(
    `SELECT 1 FROM vc_funds f WHERE f.id = ?
       AND (f.gp_user_id IS NULL OR EXISTS (SELECT 1 FROM users u WHERE u.id = f.gp_user_id AND u.role = 'admin'))`,
  ).bind(fundId).first();
}

type PackLp = {
  id: number; name: string | null; commitment_amount: number; invested_amount: number | null; created_at: string;
  admitted_on: string | null;
};

/**
 * The LPs a capital call bills, with a positive commitment, admitted by the
 * quarter end. An LP with a #1774 admission row is admitted on its
 * `admitted_on`; one with none keeps PR 1's rule, the row's `created_at`, so
 * an LP whose admission is not yet recorded stays in the pack (decision 5's
 * fallback, per LP). `commitment_date` is never read.
 */
export async function packLps(env: Env, fundId: number, end: string): Promise<PackLp[]> {
  const res = await env.DB.prepare(
    `SELECT lp.id, COALESCE(u.name, lp.name) AS name, lp.commitment_amount, lp.invested_amount, lp.created_at, ad.admitted_on
       FROM limited_partners lp LEFT JOIN users u ON u.id = lp.user_id
       LEFT JOIN fund_lp_admissions ad ON ad.limited_partner_id = lp.id AND ad.fund_id = lp.fund_id
      WHERE lp.fund_id = ? AND lp.status IN ('committed', 'active') AND lp.commitment_amount > 0
        AND CASE WHEN ad.admitted_on IS NOT NULL THEN ad.admitted_on <= ? ELSE substr(lp.created_at, 1, 10) <= ? END
      ORDER BY lp.id`,
  ).bind(fundId, end, end).all<PackLp>();
  return res.results || [];
}

/** `Q3 2026` → #1774's quarter code, `2026Q3`. */
export const feeQuarterOf = (p: Period) => `${p.label.slice(3)}Q${p.label.slice(1, 2)}`;
/** `2026Q3` → `Q3 2026`, or null. */
export function quarterLabelOf(code: unknown): string | null {
  const m = /^(\d{4})Q([1-4])$/.exec(String(code ?? ''));
  return m ? `Q${m[2]} ${m[1]}` : null;
}

/**
 * #1774's fee period for the quarter, when it is issued or paid: its net and
 * each LP's net fee line. The fee is billed in advance, so it is the quarter's
 * management fee whether or not the books are closed.
 */
export async function issuedFeePeriod(env: Env, fundId: number, p: Period): Promise<{ net_cents: number; lines: Map<number, number> } | null> {
  const period = await env.DB.prepare(
    "SELECT id, net_cents FROM fund_fee_periods WHERE fund_id = ? AND quarter = ? AND status IN ('issued', 'paid')",
  ).bind(fundId, feeQuarterOf(p)).first<{ id: number; net_cents: number }>();
  if (!period) return null;
  const lines = await env.DB.prepare('SELECT limited_partner_id, net_fee_cents FROM fund_fee_lines WHERE period_id = ?')
    .bind(period.id).all<{ limited_partner_id: number; net_fee_cents: number }>();
  return { net_cents: Number(period.net_cents), lines: new Map((lines.results || []).map((l) => [Number(l.limited_partner_id), Number(l.net_fee_cents)])) };
}

const toCents = (dollars: unknown): number | null => {
  const n = Number(dollars);
  if (!Number.isFinite(n)) return null;
  const c = Math.round(n * 100);
  return Number.isSafeInteger(c) ? c : null;
};

// ── Fund-level figures ───────────────────────────────────────────────────────

/** The fund's books for the quarter are closed only when closed periods cover every day of it. */
export async function booksClosed(env: Env, fundId: number, p: Period): Promise<boolean> {
  const res = await env.DB.prepare(
    `SELECT start_date, end_date, closed FROM fund_accounting_periods
      WHERE fund_id = ? AND start_date <= ? AND end_date >= ? ORDER BY start_date, id`,
  ).bind(fundId, p.end, p.start).all<{ start_date: string; end_date: string; closed: number }>();
  let cursor = p.start;
  for (const row of res.results || []) {
    if (Number(row.closed) !== 1) return false;
    if (row.start_date > cursor) return false;
    if (row.end_date >= cursor) cursor = nextDay(row.end_date);
  }
  return cursor > p.end;
}

export type FundFigures = {
  books_closed: boolean;
  expenses: Line; management_fee: Line; investment_value: Line; cash: Line; liabilities: Line; nav: Line;
  /** Each LP's net fee, when #1774's fee period for the quarter is issued; else null and the fee is D628's. */
  fee_lines: Map<number, number> | null;
};

export async function fundFigures(env: Env, fund: { id: number; name: string; vintage_year?: unknown; status?: unknown }, p: Period): Promise<FundFigures> {
  const closed = await booksClosed(env, fund.id, p);
  const notClosed = `Not recorded: the fund's books for ${p.label} are not closed`;
  let expenses: Line = missing(notClosed); let fee: Line = missing(notClosed); let liabilities: Line = missing(notClosed);
  if (closed) {
    const sums = await env.DB.prepare(
      `SELECT COALESCE(SUM(CASE WHEN kind = 'expense' THEN debit_cents END), 0) AS expense,
              COALESCE(SUM(CASE WHEN kind = 'fee_accrual' THEN debit_cents END), 0) AS fee
         FROM fund_ledger_entries WHERE fund_id = ? AND posted = 1 AND entry_date BETWEEN ? AND ?`,
    ).bind(fund.id, p.start, p.end).first<{ expense: number; fee: number }>();
    const owed = await env.DB.prepare(
      `SELECT COALESCE(SUM(l.credit_cents - l.debit_cents), 0) AS balance
         FROM fund_ledger_lines l
         JOIN fund_ledger_entries e ON e.id = l.entry_id AND e.fund_id = l.fund_id
         JOIN fund_ledger_accounts a ON a.id = l.account_id AND a.fund_id = l.fund_id
        WHERE l.fund_id = ? AND e.posted = 1 AND e.entry_date <= ? AND a.category = 'liability'`,
    ).bind(fund.id, p.end).first<{ balance: number }>();
    expenses = known(Number(sums?.expense ?? 0)); fee = known(Number(sums?.fee ?? 0)); liabilities = known(Number(owed?.balance ?? 0));
  }
  // An issued #1774 fee period is the quarter's fee, books closed or not.
  const feePeriod = await issuedFeePeriod(env, fund.id, p);
  if (feePeriod) fee = known(feePeriod.net_cents);
  // Investment value only, as of the quarter end: its calls and distributions are not cut there.
  const perf = await readFundPerformance(env, fund, p.end);
  const investment: Line = perf.nav_cents == null
    ? missing(`Not recorded: ${perf.unavailable.nav_cents ?? 'no investment value is recorded'}`)
    : known(perf.nav_cents);
  // Only the Fund's own registered accounts (decision 9).
  const cash: Line = await fundCash(env, fund.id, p.end);
  const nav: Line = investment.cents == null ? missing(investment.reason)
    : cash.cents == null ? missing(cash.reason)
      : liabilities.cents == null ? missing(liabilities.reason)
        : known(investment.cents + cash.cents - liabilities.cents);
  return { books_closed: closed, expenses, management_fee: fee, investment_value: investment, cash, liabilities, nav, fee_lines: feePeriod?.lines ?? null };
}

/**
 * Each LP's share of a fund figure, by commitment, summing to it exactly
 * (`splitCall`'s floor-and-residual rule). A zero figure is zero for every LP;
 * a negative one is split as a positive amount and negated.
 */
export function allocate(line: Line, lps: Array<{ id: number; commitment_amount: number }>): Map<number, Line> {
  const out = new Map<number, Line>();
  if (line.cents == null) { for (const lp of lps) out.set(lp.id, missing(line.reason)); return out; }
  if (line.cents === 0) { for (const lp of lps) out.set(lp.id, known(0)); return out; }
  const sign = line.cents < 0 ? -1 : 1;
  const split = splitCall(Math.abs(line.cents), lps);
  for (const lp of lps) out.set(lp.id, known(0));
  for (const l of split.lines) out.set(l.lpId, known(sign * l.shareCents));
  return out;
}

// ── One LP's statement ──────────────────────────────────────────────────────

async function sumCents(env: Env, sql: string, ...binds: unknown[]): Promise<number> {
  const row = await env.DB.prepare(sql).bind(...binds).first<{ n: number | null }>();
  return Number(row?.n ?? 0);
}

const ratio = (num: number | null, den: number | null, what: string): Ratio =>
  num == null || den == null || den <= 0 ? { value: null, reason: `Not recorded: ${what}` } : { value: Math.round((num / den) * 10_000) / 10_000 };

export async function statementFigures(
  env: Env, fund: { id: number; name: string }, p: Period, lp: PackLp, total: number,
  shares: Record<'expenses' | 'management_fee' | 'investment_value' | 'cash' | 'liabilities', Line>,
) {
  const commitment = toCents(lp.commitment_amount) ?? 0;
  const calledToDate = await sumCents(env, `SELECT SUM(COALESCE(amount_cents, CAST(ROUND(amount * 100) AS INTEGER))) AS n FROM capital_calls
      WHERE limited_partner_id = ? AND substr(created_at, 1, 10) <= ?`, lp.id, p.end);
  const calledInQuarter = await sumCents(env, `SELECT SUM(COALESCE(amount_cents, CAST(ROUND(amount * 100) AS INTEGER))) AS n FROM capital_calls
      WHERE limited_partner_id = ? AND substr(created_at, 1, 10) BETWEEN ? AND ?`, lp.id, p.start, p.end);
  const paidIn = await sumCents(env, 'SELECT SUM(amount_cents) AS n FROM capital_call_receipts WHERE limited_partner_id = ? AND fund_id = ? AND received_on <= ?', lp.id, fund.id, p.end);
  const contributed = await sumCents(env, 'SELECT SUM(amount_cents) AS n FROM capital_call_receipts WHERE limited_partner_id = ? AND fund_id = ? AND received_on BETWEEN ? AND ?', lp.id, fund.id, p.start, p.end);
  const paidBefore = await sumCents(env, 'SELECT SUM(amount_cents) AS n FROM capital_call_receipts WHERE limited_partner_id = ? AND fund_id = ? AND received_on < ?', lp.id, fund.id, p.start);
  const distToDate = await sumCents(env, `SELECT SUM(amount_cents) AS n FROM fund_distributions
      WHERE lp_id = ? AND fund_id = ? AND status = 'paid' AND distributed_at IS NOT NULL AND substr(distributed_at, 1, 10) <= ?`, lp.id, fund.id, p.end);
  const distInQuarter = await sumCents(env, `SELECT SUM(amount_cents) AS n FROM fund_distributions
      WHERE lp_id = ? AND fund_id = ? AND status = 'paid' AND distributed_at IS NOT NULL
        AND substr(distributed_at, 1, 10) BETWEEN ? AND ?`, lp.id, fund.id, p.start, p.end);

  // D372: when receipts and the recorded invested amount disagree, say so and pick neither.
  const recorded = toCents(lp.invested_amount);
  const ties = recorded === paidIn;
  const tieReason = 'Not recorded: receipts and the recorded invested amount do not tie';
  const paidInLine: Line = ties ? known(paidIn) : missing(tieReason);
  const unfunded: Line = ties ? known(Math.max(0, commitment - paidIn)) : missing(tieReason);

  // Opening NAV: the last issued statement's closing NAV; with none, zero only
  // when nothing was paid in before the quarter started.
  const prior = await env.DB.prepare(
    `SELECT figures_json FROM fund_report_drafts
      WHERE kind = 'lp_capital_statement' AND limited_partner_id = ? AND fund_id = ? AND status = 'issued' AND period_end < ?
      ORDER BY period_end DESC, id DESC LIMIT 1`,
  ).bind(lp.id, fund.id, p.start).first<{ figures_json: string }>();
  let opening: Line;
  if (prior) {
    const nav = JSON.parse(prior.figures_json)?.nav as Line | undefined;
    opening = nav && nav.cents != null ? known(nav.cents) : missing('Not recorded: the last issued statement has no closing NAV');
  } else {
    opening = paidBefore === 0 ? known(0) : missing('Not recorded: no issued statement before this quarter');
  }
  const nav: Line = shares.investment_value.cents == null ? missing(shares.investment_value.reason)
    : shares.cash.cents == null ? missing(shares.cash.reason)
      : shares.liabilities.cents == null ? missing(shares.liabilities.reason)
        : known(shares.investment_value.cents + shares.cash.cents - shares.liabilities.cents);
  const navCents = nav.cents;
  const paid = paidInLine.cents;

  return {
    schema: 'lp_capital_statement/1',
    fund: { id: fund.id, name: fund.name },
    lp: { id: lp.id, name: lp.name ?? null },
    period: p,
    currency: 'USD',
    admission: lp.admitted_on ? { date: lp.admitted_on } : { date: null, reason: ADMISSION_NOT_RECORDED },
    commitment: known(commitment),
    percentage_interest: { commitment_cents: commitment, total_commitment_cents: total },
    called_to_date: known(calledToDate),
    called_in_quarter: known(calledInQuarter),
    contributed_in_quarter: known(contributed),
    paid_in: paidInLine,
    unfunded,
    ties: { ties, receipts_cents: paidIn, recorded_invested_cents: recorded },
    distributions_in_quarter: known(distInQuarter),
    distributions_to_date: known(distToDate),
    distributions_basis: DISTRIBUTION_BASIS,
    allocated: shares,
    nav,
    nav_basis: NAV_BASIS,
    opening_nav: opening,
    // The canvas's roll-forward prints only when both NAVs are recorded; the
    // platform records no realisations, so gains are one balancing line.
    roll_forward: opening.cents != null && navCents != null && paid != null
      ? {
        opening_cents: opening.cents,
        contributions_cents: contributed,
        distributions_cents: distInQuarter,
        fees_and_expenses_cents: (shares.expenses.cents ?? 0) + (shares.management_fee.cents ?? 0),
        change_in_value_cents: navCents - opening.cents - contributed + distInQuarter,
        closing_cents: navCents,
        change_label: 'Change in value, the balancing figure',
      }
      : null,
    ratios: {
      dpi: ratio(distToDate, paid, 'DPI needs paid-in capital'),
      rvpi: ratio(navCents, paid, 'RVPI needs NAV and paid-in capital'),
      tvpi: ratio(navCents == null ? null : navCents + distToDate, paid, 'TVPI needs NAV and paid-in capital'),
      xirr: { value: null, reason: navCents == null ? 'Not recorded: XIRR needs NAV' : 'Not recorded: XIRR needs dated flows' } as Ratio,
    },
    unmatched_count: 0,
  };
}

/** The pack's fund-level report: totals and its statements' digests, never an LP's name or figures. */
export function reportFigures(
  fund: { id: number; name: string }, p: Period, lps: number, totals: Record<string, number>, figures: FundFigures,
  statements: Array<{ uid: string; figures_sha256: string }>, unmatched = 0,
) {
  return {
    schema: 'lp_quarterly_report/1',
    fund: { id: fund.id, name: fund.name },
    period: p,
    currency: 'USD',
    lp_count: lps,
    totals: Object.fromEntries(Object.entries(totals).map(([k, v]) => [k, known(v)])),
    books_closed: figures.books_closed,
    fund_figures: {
      expenses: figures.expenses, management_fee: figures.management_fee, investment_value: figures.investment_value,
      cash: figures.cash, liabilities: figures.liabilities, nav: figures.nav,
    },
    nav_basis: NAV_BASIS,
    statements,
    unmatched_count: unmatched,
  };
}

/**
 * The fields of #1774's `statementFor` a fee statement freezes, by name. A
 * field `statementFor` gains later (#1820's `remittance`) never reaches a
 * draft, an export or `/lp-portal`'s `fee_statements`.
 */
export const FEE_STATEMENT_FIELDS = [
  'quarter', 'window', 'rate_bps', 'lpa_reference', 'basis', 'gross_fee_cents', 'catch_up_days', 'catch_up_cents',
  'offset_cents', 'net_fee_cents', 'reference_code', 'funding_call_line', 'status', 'pay_to',
] as const;

export function feeStatementFigures(
  fund: { id: number; name: string }, lp: { id: number; name: string | null }, p: Period, statement: Record<string, unknown>,
) {
  const copied = Object.fromEntries(FEE_STATEMENT_FIELDS.map((k) => [k, statement[k] ?? null]));
  return {
    schema: 'mgmt_fee_statement/1',
    fund: { id: fund.id, name: fund.name },
    lp: { id: lp.id, name: lp.name ?? null },
    period: p,
    currency: 'USD',
    ...copied,
    unmatched_count: 0,
  };
}

export { day as isoDay };
