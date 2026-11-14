/**
 * D5833 (#5833): a QuickBooks Online `BalanceSheet` or `ProfitAndLoss` report
 * (JSON, one Total column) into the provider-neutral contract. Pure.
 *
 * Kinds come from the report's own `group` codes, never from a label:
 * `BankAccounts` → cash, `Income` → revenue, `Expenses` → expenses,
 * `NetIncome` → net income. An account row keys by its account id; a total
 * keys by its group; anything else by its section path.
 */
import type { Basis, LineInput, LineKind, Period, SnapshotInput } from './contract';
import { StatementRefusal } from './contract';

const TOTAL: Record<string, LineKind> = { BankAccounts: 'cash_total', Income: 'revenue_total', Expenses: 'expense_total', NetIncome: 'net_income' };
const basisOf = (v: unknown): Basis => (v === 'Cash' ? 'cash' : v === 'Accrual' ? 'accrual' : 'unknown');

export function fromQuickBooks(report: any, ctx: { realm_id: string; requested: Period }): SnapshotInput {
  const h = report?.Header;
  const name = h?.ReportName;
  const kind = name === 'BalanceSheet' ? 'balance_sheet' : name === 'ProfitAndLoss' ? 'profit_and_loss' : null;
  if (!kind) throw new StatementRefusal('report_invalid');
  const money = (report.Columns?.Column ?? []).filter((c: any) => c?.ColType === 'Money');
  if (money.length !== 1) throw new StatementRefusal('report_columns_unsupported');
  const lines: LineInput[] = [];
  const keys = new Map<string, number>();
  const unique = (k: string) => { const n = (keys.get(k) ?? 0) + 1; keys.set(k, n); return n === 1 ? k : `${k}#${n}`; };
  const walk = (rows: any[], path: string[], inCash: boolean) => {
    for (const row of rows ?? []) {
      if (row?.type === 'Section' || row?.Rows || row?.Summary) {
        const title = row.Header?.ColData?.[0]?.value ?? '';
        const group: string | undefined = row.group;
        const here = title ? [...path, title] : path;
        const cash = inCash || group === 'BankAccounts';
        walk(row.Rows?.Row ?? [], here, cash);
        const sum = row.Summary?.ColData;
        if (sum) lines.push({ source_key: unique(group ? `group:${group}` : `total:${here.join('/')}`), label: String(sum[0]?.value ?? ''),
          section: here.join(' / ') || null, kind: (group && TOTAL[group]) || 'other', amount: sum[1]?.value });
      } else if (row?.ColData) {
        const id = row.ColData[0]?.id;
        const label = String(row.ColData[0]?.value ?? '');
        lines.push({ source_key: unique(id ? `account:${id}` : `row:${path.join('/')}/${label}`), label, section: path.join(' / ') || null,
          kind: inCash ? 'cash_account' : 'other', amount: row.ColData[1]?.value });
      }
    }
  };
  const empty = (h.Option ?? []).some((o: any) => o?.Name === 'NoReportData' && o?.Value === 'true');
  if (!empty) walk(report.Rows?.Row ?? [], [], false);
  const returned: Period | null = kind === 'balance_sheet'
    ? (h.EndPeriod ? { as_of: h.EndPeriod } : null)
    : (h.StartPeriod && h.EndPeriod ? { start: h.StartPeriod, end: h.EndPeriod } : null);
  return { provider: 'quickbooks', entity_key: ctx.realm_id, report: kind, basis: basisOf(h.ReportBasis), currency: h.Currency,
    requested: ctx.requested, returned, lines };
}
