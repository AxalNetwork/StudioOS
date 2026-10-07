/** D628: integer-cent operational fund books. No HTTP or inferred opening balances. */
import type { Env } from '../types';
const LEDGER_SENTENCES = [
  "Accounting period not found.",
  "An entry needs between two and fifty account lines.",
  "Choose a period and its fee expense and payable accounts.",
  "Choose a period and record the entry.",
  "Choose a valid accounting period.",
  "Choose an active investor account or null to remove the administrator.",
  "Choose close or reopen; reopening requires a reason of up to 500 characters.",
  "Choose fund accounts and record positive expense cents.",
  "Choose this fund’s expense and cash or payable accounts.",
  "Choose this fund’s fee expense and payable accounts.",
  "Each line needs a fund account and nonnegative integer cents on only one side.",
  "Every account must belong to this fund.",
  "Fund not found.",
  "Not recorded: management fee terms are missing. No fee was posted.",
  "Only an admin can assign the fund administrator.",
  "Only an admin or the assigned fund administrator can write this ledger.",
  "Only the fund administrator or an admin can read the chart of accounts.",
  "Record a date within this period and a description of up to 500 characters.",
  "Record a period label and valid start and end dates in order.",
  "Record a statement reference, line reference, date and signed amount in cents.",
  "Record an account code, a name of up to 100 characters, and a valid account category.",
  "Record an effective date, annual basis points from 0 to 10000, basis cents and a source of up to 500 characters.",
  "Record valid fee terms and accounting dates.",
  "Split this accounting period at the recorded fee-term change before accruing its fee.",
  "The entry must balance to the cent, with equal positive debits and credits.",
  "The fee is too large to record safely in cents.",
  "The fund or period changed, or this record already exists. Reload before recording it.",
  "This accounting period is closed. Reopen it with a reason before posting.",
  "This period already has the requested state."
] as const;
export class LedgerRefusal extends Error {
  status: 400 | 404 | 409;
  readonly publicMessage: string;
  constructor(message: typeof LEDGER_SENTENCES[number], status: 400 | 404 | 409 = 400) {
    const sentence = LEDGER_SENTENCES.includes(message) ? message : "The ledger request could not be recorded.";
    super(sentence); this.status=status; this.publicMessage=sentence;
  }
}
export const ledgerId = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) > 0;
export const ledgerCents = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 0;
export function ledgerDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(value + 'T00:00:00Z');
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
export const ledgerText = (value: unknown, max = 500): value is string => typeof value === 'string' && value.trim().length > 0 && value.trim().length <= max;
export const accountCategories = ['asset','liability','equity','income','expense'];
export function feeForPeriod(basis: number, bps: number, start: string, end: string): number {
  if (!ledgerCents(basis) || !Number.isInteger(bps) || bps < 0 || bps > 10000 || !ledgerDate(start) || !ledgerDate(end) || start > end)
    throw new LedgerRefusal('Record valid fee terms and accounting dates.');
  const days = BigInt((Date.parse(end) - Date.parse(start)) / 86400000 + 1);
  const divisor = 365n * 10000n;
  const cents = Number((BigInt(basis) * BigInt(bps) * days + divisor / 2n) / divisor);
  if (!ledgerCents(cents)) throw new LedgerRefusal('The fee is too large to record safely in cents.');
  return cents;
}
export function ledgerAudit(env: Env, actor: number, action: string, details: object) {
  return env.DB.prepare(`INSERT INTO activity_logs(action,details,actor,user_id)
    SELECT ?,?,?,? WHERE changes()=1`).bind(action,JSON.stringify(details),String(actor),actor);
}
export async function commitLedger(env: Env, statements: D1PreparedStatement[]) {
  const result = await env.DB.batch(statements);
  if (result.some(r => !r.success)) throw new Error('Fund ledger transaction failed');
  if (result[0].meta.changes !== 1) throw new LedgerRefusal('The fund or period changed, or this record already exists. Reload before recording it.',409);
  return result;
}
async function rows(env: Env, sql: string, binds: (string | number)[]) {
  const result = await env.DB.prepare(sql).bind(...binds).all<any>();
  if (!result.success) throw new Error('Fund ledger read failed');
  return result.results;
}
export async function ledgerPeriod(env: Env, fundId: number, periodId: number) {
  const period = await env.DB.prepare(`SELECT * FROM fund_accounting_periods WHERE fund_id=? AND id=?`).bind(fundId,periodId).first<any>();
  if (!period) throw new LedgerRefusal('Accounting period not found.',404);
  return period;
}
export interface LedgerLine { account_id: number; debit_cents: number; credit_cents: number }
export async function postLedgerEntry(env: Env, actor: any, fundId: number, periodId: number,
  input: {entry_date: string; description: string; lines: LedgerLine[]}, kind = 'journal', termsId: number | null = null) {
  const period = await ledgerPeriod(env,fundId,periodId);
  if (period.closed) throw new LedgerRefusal('This accounting period is closed. Reopen it with a reason before posting.',409);
  if (!ledgerDate(input.entry_date) || input.entry_date < period.start_date || input.entry_date > period.end_date || !ledgerText(input.description))
    throw new LedgerRefusal('Record a date within this period and a description of up to 500 characters.');
  if (!Array.isArray(input.lines) || input.lines.length < 2 || input.lines.length > 50)
    throw new LedgerRefusal('An entry needs between two and fifty account lines.');
  let debit = 0, credit = 0;
  for (const line of input.lines) {
    if (!line || !ledgerId(line.account_id) || !ledgerCents(line.debit_cents) || !ledgerCents(line.credit_cents) || (line.debit_cents > 0 && line.credit_cents > 0))
      throw new LedgerRefusal('Each line needs a fund account and nonnegative integer cents on only one side.');
    debit += line.debit_cents; credit += line.credit_cents;
  }
  if (!ledgerCents(debit) || !ledgerCents(credit) || debit !== credit || (debit === 0 && kind !== 'fee_accrual'))
    throw new LedgerRefusal('The entry must balance to the cent, with equal positive debits and credits.');
  const accounts = await rows(env,`SELECT id,category FROM fund_ledger_accounts WHERE fund_id=?`,[fundId]);
  if (input.lines.some(line => !accounts.some(a => a.id === line.account_id))) throw new LedgerRefusal('Every account must belong to this fund.');
  const uid = crypto.randomUUID();
  const statements = [env.DB.prepare(`INSERT INTO fund_ledger_entries
      (uid,fund_id,period_id,entry_date,description,kind,fee_terms_id,recorded_by)
    SELECT ?,p.fund_id,p.id,?,?,?,?,? FROM fund_accounting_periods p JOIN vc_funds f ON f.id=p.fund_id
    WHERE p.fund_id=? AND p.id=? AND p.closed=0 AND p.version=?
      AND (?='admin' OR f.fund_admin_user_id=?)
      AND (? IS NULL OR ?=(SELECT t.id FROM fund_fee_terms t WHERE t.fund_id=p.fund_id
        AND t.effective_date<=p.end_date ORDER BY t.effective_date DESC,t.id DESC LIMIT 1))
      AND (?!='fee_accrual' OR NOT EXISTS (SELECT 1 FROM fund_ledger_entries e WHERE e.fund_id=p.fund_id AND e.period_id=p.id AND e.kind='fee_accrual'))`)
    .bind(uid,input.entry_date,input.description.trim(),kind,termsId,actor.id,fundId,periodId,period.version,actor.role,actor.id,termsId,termsId,kind)];
  for (const line of input.lines) statements.push(env.DB.prepare(`INSERT INTO fund_ledger_lines(fund_id,entry_id,account_id,debit_cents,credit_cents)
    SELECT fund_id,id,?,?,? FROM fund_ledger_entries WHERE uid=? AND posted=0`)
    .bind(line.account_id,line.debit_cents,line.credit_cents,uid));
  // The database recomputes totals from the actual inserted lines before the
  // CHECK permits publication. This and its audit are the same D1 transaction.
  statements.push(env.DB.prepare(`UPDATE fund_ledger_entries SET posted=1,
    debit_cents=(SELECT SUM(debit_cents) FROM fund_ledger_lines WHERE entry_id=fund_ledger_entries.id),
    credit_cents=(SELECT SUM(credit_cents) FROM fund_ledger_lines WHERE entry_id=fund_ledger_entries.id),
    line_count=(SELECT COUNT(*) FROM fund_ledger_lines WHERE entry_id=fund_ledger_entries.id),updated_at=datetime('now')
    WHERE uid=? AND posted=0`).bind(uid));
  statements.push(ledgerAudit(env,actor.id,'fund_ledger_entry_posted',{fund_id:fundId,period_id:periodId,entry_uid:uid,kind,fee_terms_id:termsId,
    entry_date:input.entry_date,description:input.description.trim(),lines:input.lines}));
  await commitLedger(env,statements);
  return {uid,recorded_by:actor.id,debit_cents:debit,credit_cents:credit};
}
export async function accrueFundFee(env: Env, actor: any, fundId: number, periodId: number, expenseAccount: number, payableAccount: number) {
  const period = await ledgerPeriod(env,fundId,periodId);
  const terms = await env.DB.prepare(`SELECT * FROM fund_fee_terms WHERE fund_id=? AND effective_date<=?
    ORDER BY effective_date DESC,id DESC LIMIT 1`).bind(fundId,period.end_date).first<any>();
  if (!terms) throw new LedgerRefusal('Not recorded: management fee terms are missing. No fee was posted.');
  if (terms.effective_date > period.start_date) throw new LedgerRefusal('Split this accounting period at the recorded fee-term change before accruing its fee.');
  const accounts = await rows(env,`SELECT id,category FROM fund_ledger_accounts WHERE fund_id=?`,[fundId]);
  if (!accounts.some(a=>a.id===expenseAccount && a.category==='expense') || !accounts.some(a=>a.id===payableAccount && a.category==='liability'))
    throw new LedgerRefusal('Choose this fund’s fee expense and payable accounts.');
  const fee = feeForPeriod(terms.basis_cents,terms.annual_bps,period.start_date,period.end_date);
  const result = await postLedgerEntry(env,actor,fundId,periodId,{entry_date:period.end_date,description:`Management fee: ${period.label}`,
    lines:[{account_id:expenseAccount,debit_cents:fee,credit_cents:0},{account_id:payableAccount,debit_cents:0,credit_cents:fee}]},'fee_accrual',terms.id);
  return {...result,fee_cents:fee,fee_terms_id:terms.id};
}
export async function readFundLedger(env: Env, fund: any, full: boolean, selectedPeriod?: number) {
  const periods = await rows(env,`SELECT id,label,start_date,end_date,closed,version FROM fund_accounting_periods WHERE fund_id=? ORDER BY start_date DESC,id DESC`,[fund.id]);
  const period = selectedPeriod ? periods.find(p=>p.id===selectedPeriod) : periods[0];
  if (selectedPeriod && !period) throw new LedgerRefusal('Accounting period not found.',404);
  const base = {id:fund.id,name:fund.name,can_manage:full,periods,period:period || null};
  if (!period) return {...base,summary:{entry_count:0,fee_cents:null,expense_cents:null,reconciled_lines:0},journal:[],trial_balance:[],reason:'Not recorded: no accounting period is recorded.'};
  const entries = await rows(env,`SELECT id,uid,entry_date,description,kind,recorded_by,debit_cents,credit_cents,fee_terms_id
    FROM fund_ledger_entries WHERE fund_id=? AND period_id=? AND posted=1 ORDER BY entry_date,id`,[fund.id,period.id]);
  const lines = await rows(env,`SELECT l.id,l.entry_id,l.account_id,a.code,a.name,a.category,l.debit_cents,l.credit_cents,
    l.statement_reference,l.statement_line_reference,l.statement_date,l.statement_amount_cents,l.reconciled_by,l.reconciled_at
    FROM fund_ledger_lines l JOIN fund_ledger_entries e ON e.id=l.entry_id AND e.fund_id=l.fund_id
    JOIN fund_ledger_accounts a ON a.id=l.account_id AND a.fund_id=l.fund_id
    WHERE e.fund_id=? AND e.period_id=? AND e.posted=1
      AND e.id IN (SELECT value FROM json_each(?)) ORDER BY e.entry_date,e.id,l.id`,[fund.id,period.id,JSON.stringify(entries.map(e=>e.id))]);
  if (lines.some(l=>!ledgerCents(l.debit_cents) || !ledgerCents(l.credit_cents))) throw new Error('Invalid ledger cents');
  const fees = entries.filter(e=>e.kind==='fee_accrual');
  const expenses = lines.filter(l=>l.category==='expense' && entries.find(e=>e.id===l.entry_id)?.kind!=='fee_accrual');
  const fee = fees.length ? fees.reduce((sum,e)=>sum+e.debit_cents,0) : null;
  const expense = expenses.length ? expenses.reduce((sum,l)=>sum+l.debit_cents-l.credit_cents,0) : null;
  if ((fee!==null && !ledgerCents(fee)) || (expense!==null && !Number.isSafeInteger(expense))) throw new Error('Unsafe ledger total');
  const trial = new Map<number,any>();
  for (const line of lines) {
    const row = trial.get(line.account_id) || {account_id:line.account_id,code:line.code,name:line.name,category:line.category,debit_cents:0,credit_cents:0};
    row.debit_cents+=line.debit_cents; row.credit_cents+=line.credit_cents;
    if (!ledgerCents(row.debit_cents) || !ledgerCents(row.credit_cents)) throw new Error('Unsafe trial balance');
    trial.set(line.account_id,row);
  }
  return {...base,summary:{entry_count:entries.length,fee_cents:fee,expense_cents:expense,reconciled_lines:lines.filter(l=>l.reconciled_by!==null).length},
    journal:full ? entries.map(e=>({...e,lines:lines.filter(l=>l.entry_id===e.id)})) : [],trial_balance:full ? [...trial.values()] : [],
    reason:entries.length ? null : 'Not recorded: no journal entries are posted for this period.'};
}
