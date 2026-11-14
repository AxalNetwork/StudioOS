/**
 * D5833 (#5833): a Xero `BalanceSheet` or `ProfitAndLoss` report into the
 * provider-neutral contract. Pure.
 *
 * Xero's report states neither its basis nor its currency, so both come from
 * the request: `basis` is what the caller asked for (`paymentsOnly=true` is
 * cash) or `unknown`, and `currency` is the organisation's base currency.
 * Only the first value column is read (the requested date or period); a
 * comparison column is not part of this snapshot. Xero has no group codes, so
 * a total's kind comes from its section title, in the fixed list below.
 */
import type { Basis, LineInput, LineKind, Period, SnapshotInput } from './contract';
import { StatementRefusal } from './contract';

const SECTION: Record<string, LineKind> = { Bank: 'cash_total', Income: 'revenue_total', 'Trading Income': 'revenue_total', Revenue: 'revenue_total',
  'Operating Expenses': 'expense_total', 'Less Operating Expenses': 'expense_total' };
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
/** Xero's report dates read "31 March 2026". */
export function xeroDate(text: unknown): string | null {
  const m = /^(\d{1,2}) ([A-Za-z]+) (\d{4})$/.exec(String(text ?? '').trim());
  const month = m ? MONTHS.indexOf(m[2]) + 1 : 0;
  return m && month ? `${m[3]}-${String(month).padStart(2, '0')}-${m[1].padStart(2, '0')}` : null;
}

export function fromXero(body: any, ctx: { tenant_id: string; requested: Period; basis: Basis; currency: string }): SnapshotInput {
  const r = body?.Reports?.[0];
  const kind = r?.ReportType === 'BalanceSheet' ? 'balance_sheet' : r?.ReportType === 'ProfitAndLoss' ? 'profit_and_loss' : null;
  if (!kind) throw new StatementRefusal('report_invalid');
  const lines: LineInput[] = [];
  const keys = new Map<string, number>();
  const unique = (k: string) => { const n = (keys.get(k) ?? 0) + 1; keys.set(k, n); return n === 1 ? k : `${k}#${n}`; };
  for (const section of r.Rows ?? []) {
    if (section?.RowType !== 'Section') continue;
    const title = String(section.Title ?? '');
    for (const row of section.Rows ?? []) {
      const cells = row?.Cells ?? [];
      const label = String(cells[0]?.Value ?? '');
      const account = (cells[0]?.Attributes ?? []).find((a: any) => a?.Id === 'account')?.Value;
      if (row.RowType === 'SummaryRow') {
        lines.push({ source_key: unique(`section:${title}:total`), label, section: title || null, kind: SECTION[title] ?? 'other', amount: cells[1]?.Value });
      } else if (row.RowType === 'Row') {
        const net = !title && label === 'Net Profit';
        lines.push({ source_key: unique(account ? `account:${account}` : net ? 'net_profit' : `row:${title}/${label}`), label, section: title || null,
          kind: net ? 'net_income' : SECTION[title] === 'cash_total' ? 'cash_account' : 'other', amount: cells[1]?.Value });
      }
    }
  }
  let returned: Period | null = null;
  if (kind === 'balance_sheet') { const d = xeroDate(r.ReportDate); returned = d ? { as_of: d } : null; }
  else {
    const range = /^(.+) to (.+)$/.exec(String(r.ReportTitles?.[2] ?? ''));
    const start = range && xeroDate(range[1]), end = range && xeroDate(range[2]);
    returned = start && end ? { start, end } : null;
  }
  return { provider: 'xero', entity_key: ctx.tenant_id, report: kind, basis: ctx.basis, currency: ctx.currency, requested: ctx.requested, returned, lines };
}
