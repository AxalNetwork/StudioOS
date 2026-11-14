/**
 * D5833 (#5833): the provider-neutral contract for read-only balance-sheet and
 * profit-and-loss snapshots. Pure: no database, no provider call, no clock.
 *
 * Amounts are exact: a canonical signed decimal string at the snapshot's
 * reporting precision plus its minor units as a decimal integer string, so
 * nothing passes through a float. A line is `value`, `zero`, `absent` (the
 * provider left the cell empty) or `unreadable` (the cell held something that
 * is not an amount at this precision); the four never collapse into one.
 */
import { exponentOf } from '../../../../frontend/src/lib/money.js';

export const PROVIDERS = ['quickbooks', 'xero'] as const;
export const REPORTS = ['balance_sheet', 'profit_and_loss'] as const;
export const BASES = ['cash', 'accrual', 'unknown'] as const;
/** What a line is, from the provider's own structure. Only these kinds may support a figure (SUPPORT). */
export const LINE_KINDS = ['cash_total', 'cash_account', 'revenue_total', 'expense_total', 'net_income', 'other'] as const;
export type Provider = typeof PROVIDERS[number];
export type Report = typeof REPORTS[number];
export type Basis = typeof BASES[number];
export type LineKind = typeof LINE_KINDS[number];
export type LineState = 'value' | 'zero' | 'absent' | 'unreadable';

export class StatementRefusal extends Error {
  code: string;
  status: 400 | 403 | 404 | 409;
  constructor(code: string, status: 400 | 403 | 404 | 409 = 400) { super(code); this.code = code; this.status = status; }
}

/** What an adapter hands the store. `amount` is the provider's raw cell; the contract parses it. */
export type LineInput = { source_key: string; label: string; section: string | null; kind: LineKind; amount: unknown };
export type Period = { start: string; end: string } | { as_of: string };
export type SnapshotInput = {
  provider: Provider; entity_key: string; report: Report; basis: Basis; currency: string;
  /** Decimal places the provider reported to. Defaults to the currency's minor-unit exponent. */
  precision?: number;
  requested: Period; returned: Period | null; lines: LineInput[];
};
export type Line = {
  position: number; source_key: string; label: string; section: string | null; kind: LineKind;
  state: LineState; amount: string | null; amount_minor: string | null; reason: string | null;
};
export type Snapshot = Omit<SnapshotInput, 'lines' | 'precision'> & {
  precision: number; window_key: string; period_mismatch: boolean; lines: Line[];
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const validDate = (d: unknown): d is string => typeof d === 'string' && ISO_DATE.test(d) && !Number.isNaN(Date.parse(d + 'T00:00:00Z'))
  && new Date(d + 'T00:00:00Z').toISOString().slice(0, 10) === d;

/**
 * Parses one provider cell at `precision` decimals. Never rounds: a cell with a
 * non-zero digit past the precision is `unreadable`, so a figure is never
 * silently changed. Accepts `-1.5`, `+1.5` and the accounting `(1.50)`.
 */
export function parseAmount(raw: unknown, precision: number): Pick<Line, 'state' | 'amount' | 'amount_minor' | 'reason'> {
  if (raw === null || raw === undefined || (typeof raw === 'string' && raw.trim() === '')) {
    return { state: 'absent', amount: null, amount_minor: null, reason: 'The source reports no amount on this line.' };
  }
  const unreadable = (reason: string) => ({ state: 'unreadable' as const, amount: null, amount_minor: null, reason });
  // A JSON number has already passed through a float; only an integer is exact.
  let text: string;
  if (typeof raw === 'number') {
    if (!Number.isSafeInteger(raw)) return unreadable('The source sent a non-integer number, which cannot be read exactly.');
    text = String(raw);
  } else if (typeof raw === 'string') text = raw.trim();
  else return unreadable('The source sent something that is not an amount.');
  let negative = false;
  const paren = /^\((.*)\)$/.exec(text);
  if (paren) { negative = true; text = paren[1].trim(); }
  const m = /^([+-]?)(\d+)(?:\.(\d+))?$/.exec(text);
  if (!m || (paren && m[1])) return unreadable('The source sent something that is not an amount.');
  if (m[1] === '-') negative = true;
  const whole = m[2].replace(/^0+(?=\d)/, ''); const frac = m[3] ?? '';
  if (frac.length > precision && /[1-9]/.test(frac.slice(precision))) {
    return unreadable('The source reports more decimal places than this statement\'s precision; it is not rounded.');
  }
  const digits = frac.slice(0, precision).padEnd(precision, '0');
  const minor = BigInt(whole + digits);
  if (minor === 0n) return { state: 'zero', amount: precision ? `0.${'0'.repeat(precision)}` : '0', amount_minor: '0', reason: null };
  const sign = negative ? '-' : '';
  return { state: 'value', amount: `${sign}${whole}${precision ? '.' + digits : ''}`, amount_minor: `${sign}${minor}`, reason: null };
}

const windowKey = (p: Period) => ('as_of' in p ? `as_of:${p.as_of}` : `period:${p.start}..${p.end}`);
function checkPeriod(report: Report, p: unknown, field: string): Period {
  if (!p || typeof p !== 'object') throw new StatementRefusal(`${field}_invalid`);
  const q = p as Record<string, unknown>;
  if (report === 'balance_sheet') {
    if (!validDate(q.as_of) || 'start' in q) throw new StatementRefusal(`${field}_invalid`);
    return { as_of: q.as_of };
  }
  if (!validDate(q.start) || !validDate(q.end) || q.start > q.end || 'as_of' in q) throw new StatementRefusal(`${field}_invalid`);
  return { start: q.start, end: q.end };
}

/** Validates an adapter's output and parses every amount. Throws `StatementRefusal` on a malformed snapshot. */
export function canonicalize(input: SnapshotInput): Snapshot {
  if (!PROVIDERS.includes(input?.provider)) throw new StatementRefusal('provider_invalid');
  if (!REPORTS.includes(input.report)) throw new StatementRefusal('report_invalid');
  if (!BASES.includes(input.basis)) throw new StatementRefusal('basis_invalid');
  if (typeof input.entity_key !== 'string' || !/^[A-Za-z0-9_.:-]{1,128}$/.test(input.entity_key)) throw new StatementRefusal('entity_invalid');
  const currency = typeof input.currency === 'string' ? input.currency.toUpperCase() : '';
  const exponent = /^[A-Z]{3}$/.test(currency) ? exponentOf(currency) : null;
  if (exponent === null) throw new StatementRefusal('currency_invalid');
  const precision = input.precision ?? exponent;
  if (!Number.isInteger(precision) || precision < 0 || precision > 4) throw new StatementRefusal('precision_invalid');
  const requested = checkPeriod(input.report, input.requested, 'requested_period');
  const returned = input.returned == null ? null : checkPeriod(input.report, input.returned, 'returned_period');
  if (!Array.isArray(input.lines) || input.lines.length > 2000) throw new StatementRefusal('lines_invalid');
  const seen = new Set<string>();
  const lines = input.lines.map((l, position): Line => {
    if (!l || typeof l.source_key !== 'string' || !l.source_key || l.source_key.length > 200) throw new StatementRefusal('line_key_invalid');
    if (seen.has(l.source_key)) throw new StatementRefusal('line_key_duplicate');
    seen.add(l.source_key);
    if (!LINE_KINDS.includes(l.kind)) throw new StatementRefusal('line_kind_invalid');
    if (typeof l.label !== 'string' || l.label.length > 300) throw new StatementRefusal('line_label_invalid');
    if (l.section != null && (typeof l.section !== 'string' || l.section.length > 300)) throw new StatementRefusal('line_label_invalid');
    return { position, source_key: l.source_key, label: l.label, section: l.section ?? null, kind: l.kind, ...parseAmount(l.amount, precision) };
  });
  return {
    provider: input.provider, entity_key: input.entity_key, report: input.report, basis: input.basis, currency, precision,
    requested, returned, window_key: windowKey(requested),
    period_mismatch: returned !== null && windowKey(returned) !== windowKey(requested), lines,
  };
}

/** The content a revision is compared on: everything the source said, nothing about when or by whom it was read. */
export async function fingerprint(s: Snapshot): Promise<string> {
  const content = JSON.stringify([s.basis, s.currency, s.precision, s.returned ? windowKey(s.returned) : null,
    s.lines.map(l => [l.source_key, l.label, l.section, l.kind, l.state, l.amount_minor])]);
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(content));
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Which lines may support which figure. A figure is read from the provider's
 * own total, never summed by Axal from accounts, and never derived across
 * reports: a profit-and-loss net loss is not net cash burn, and nothing here
 * produces runway.
 */
export const SUPPORT = {
  cash_balance: { report: 'balance_sheet', kind: 'cash_total' },
  revenue: { report: 'profit_and_loss', kind: 'revenue_total' },
  profit: { report: 'profit_and_loss', kind: 'net_income' },
} as const;
export type Figure = keyof typeof SUPPORT;

type Readable = { report: Report; basis: Basis; currency: string; requested: Period; returned: Period | null; lines: Pick<Line, 'kind' | 'state' | 'amount' | 'amount_minor' | 'source_key' | 'label'>[] };
export function supportedFigure(s: Readable, figure: Figure) {
  const rule = SUPPORT[figure];
  if (s.report !== rule.report) return { state: 'not_supported' as const, reason: `A ${s.report.replaceAll('_', ' ')} does not support ${figure.replace('_', ' ')}.` };
  const line = s.lines.find(l => l.kind === rule.kind);
  if (!line) return { state: 'not_recorded' as const, reason: 'The source report has no line for this figure.' };
  if (line.state === 'absent' || line.state === 'unreadable') return { state: line.state, reason: line.state === 'absent' ? 'Not recorded in the source report.' : 'Unreadable in the source report.', source_key: line.source_key };
  return { state: 'recorded' as const, amount: line.amount!, amount_minor: line.amount_minor!, currency: s.currency, basis: s.basis,
    period: s.returned ?? s.requested, source_key: line.source_key, label: line.label };
}

/** Net cash burn is never read from a profit-and-loss. Only a change in reported cash between two balance sheets supports it. */
export function cashChange(earlier: Readable & { provider: Provider; entity_key: string; precision: number }, later: typeof earlier) {
  const refuse = (reason: string) => ({ state: 'not_supported' as const, reason });
  if (earlier.report !== 'balance_sheet' || later.report !== 'balance_sheet') return refuse('Net cash burn needs two balance sheets; a profit-and-loss result is not cash burn.');
  if (earlier.provider !== later.provider || earlier.entity_key !== later.entity_key || earlier.currency !== later.currency || earlier.precision !== later.precision || earlier.basis !== later.basis) {
    return refuse('The two balance sheets are not from the same entity, basis and currency.');
  }
  const a = supportedFigure(earlier, 'cash_balance'), b = supportedFigure(later, 'cash_balance');
  if (a.state !== 'recorded' || b.state !== 'recorded') return { state: 'not_recorded' as const, reason: 'Cash is not recorded on both balance sheets.' };
  const from = (a.period as { as_of: string }).as_of, to = (b.period as { as_of: string }).as_of;
  if (from >= to) return refuse('The earlier balance sheet must be dated before the later one.');
  return { state: 'recorded' as const, from, to, currency: later.currency, change_minor: (BigInt(b.amount_minor) - BigInt(a.amount_minor)).toString(),
    label: 'Change in reported cash between two balance sheets' };
}

/**
 * Sets a ledger figure beside other sources (Stripe receipts, Mercury movements,
 * a typed value). It never totals them. A difference is given only when the
 * currency and period match; otherwise the row says why it is not comparable.
 */
export type OtherSource = { source: string; label: string; amount_minor: string | null; currency: string; period: Period };
export function sideBySide(ledger: { label: string; amount_minor: string; currency: string; period: Period }, others: OtherSource[]) {
  const same = (p: Period, q: Period) => windowKey(p) === windowKey(q);
  return {
    ledger: { source: 'ledger', ...ledger },
    others: others.map(o => {
      if (o.amount_minor === null) return { ...o, comparable: false, difference_minor: null, reason: 'Not recorded in this source.' };
      if (o.currency.toUpperCase() !== ledger.currency.toUpperCase()) return { ...o, comparable: false, difference_minor: null, reason: 'Different currency; not converted.' };
      if (!same(o.period, ledger.period)) return { ...o, comparable: false, difference_minor: null, reason: 'Different period.' };
      return { ...o, comparable: true, difference_minor: (BigInt(o.amount_minor) - BigInt(ledger.amount_minor)).toString(), reason: null };
    }),
  };
}
