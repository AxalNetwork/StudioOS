/** D628: fund administrator writes; LP summaries only. */
import { Hono } from 'hono';
import type { Env } from '../types';
import { requireAuth } from '../auth';
import { lpMembershipScope } from '../services/tenancyScope';
import { claimLpRowsByEmail } from '../services/lpClaim';
import { AUTH_ERROR_STATUSES } from '../util/authErrors';
import { refuse } from '../util/refusal';
import { LedgerRefusal,ledgerId,ledgerCents,ledgerDate,ledgerText,accountCategories,ledgerAudit,commitLedger,
  ledgerPeriod,postLedgerEntry,accrueFundFee,readFundLedger } from '../services/fundLedger';
const r = new Hono<{Bindings:Env}>();
r.onError((error,c)=>{
  if (error instanceof LedgerRefusal) return refuse(c,error.status,{code:'fund_ledger_refused',message:error.message});
  const status=AUTH_ERROR_STATUSES[error.message];
  if (status) return refuse(c,status,{code:'fund_access_refused',message:'This account cannot access the fund ledger.'});
  return refuse(c,503,{code:'fund_ledger_unreadable',message:'Fund ledger is Unreadable. Please retry.',raw:error});
});
const parseId=(raw:string)=>/^\d+$/.test(raw) && ledgerId(Number(raw)) ? Number(raw) : null;
async function funds(env:Env,user:any) {
  if (user.role==='investor') await claimLpRowsByEmail(env,Number(user.id),user.email);
  const scope=lpMembershipScope(user);
  const result=user.role==='admin'
    ? await env.DB.prepare(`SELECT id,name,fund_admin_user_id FROM vc_funds ORDER BY id`).all<any>()
    : user.role==='investor' ? await env.DB.prepare(`SELECT f.id,f.name,f.fund_admin_user_id FROM vc_funds f
      WHERE f.fund_admin_user_id=? OR EXISTS (SELECT 1 FROM limited_partners lp WHERE lp.fund_id=f.id AND ${scope.sql}) ORDER BY f.id`)
      .bind(user.id,...scope.binds).all<any>() : {success:true,results:[]};
  if (!result.success) throw new Error('Fund ledger scope unreadable');
  return result.results;
}
async function access(c:any,write=false) {
  const user=await requireAuth(c), id=parseId(c.req.param('id'));
  if (!id || !['admin','investor'].includes(user.role)) throw new LedgerRefusal('Fund not found.',404);
  const fund=(await funds(c.env,user)).find((f:any)=>f.id===id);
  if (!fund) throw new LedgerRefusal('Fund not found.',404);
  const full=user.role==='admin' || fund.fund_admin_user_id===user.id;
  if (write && !full) throw new LedgerRefusal('Only an admin or the assigned fund administrator can write this ledger.',404);
  return {user,fund,full};
}
const body=(c:any)=>c.req.json().catch(()=>null);
r.get('/',async c=>{
  const user=await requireAuth(c);
  if (!['admin','investor'].includes(user.role)) throw new LedgerRefusal('Fund not found.',404);
  const items=[];
  for (const fund of await funds(c.env,user)) items.push(await readFundLedger(c.env,fund,user.role==='admin'||fund.fund_admin_user_id===user.id));
  return c.json({items,basis:'Operational fund ledger; not the fund’s statutory books. No opening balances are inferred.'});
});
r.get('/:id',async c=>{
  const {fund,full}=await access(c);
  const raw=c.req.query('period_id'), periodId=raw===undefined ? undefined : parseId(raw);
  if (periodId===null) throw new LedgerRefusal('Choose a valid accounting period.');
  return c.json(await readFundLedger(c.env,fund,full,periodId));
});
r.put('/:id/administrator',async c=>{
  const {user,fund}=await access(c,true), data=await body(c);
  if (user.role!=='admin') throw new LedgerRefusal('Only an admin can assign the fund administrator.',404);
  if (!data || !(data.user_id===null || ledgerId(data.user_id))) throw new LedgerRefusal('Choose an active investor account or null to remove the administrator.');
  const result=await commitLedger(c.env,[c.env.DB.prepare(`UPDATE vc_funds SET fund_admin_user_id=? WHERE id=? AND fund_admin_user_id IS ?
    AND (? IS NULL OR EXISTS (SELECT 1 FROM users WHERE id=? AND is_active=1 AND role='investor'))`)
    .bind(data.user_id,fund.id,fund.fund_admin_user_id,data.user_id,data.user_id),
    ledgerAudit(c.env,user.id,'fund_ledger_administrator_assigned',{fund_id:fund.id,before_user_id:fund.fund_admin_user_id,user_id:data.user_id})]);
  return c.json({fund_id:fund.id,fund_admin_user_id:data.user_id,updated:result[0].meta.changes});
});
r.get('/:id/accounts',async c=>{
  const {fund,full}=await access(c);
  if (!full) throw new LedgerRefusal('Only the fund administrator or an admin can read the chart of accounts.',404);
  const result=await c.env.DB.prepare(`SELECT id,code,name,category FROM fund_ledger_accounts WHERE fund_id=? ORDER BY code`).bind(fund.id).all<any>();
  if (!result.success) throw new Error('Chart of accounts read failed');
  return c.json({items:result.results});
});
r.post('/:id/accounts',async c=>{
  const {user,fund}=await access(c,true), data=await body(c);
  if (!data || typeof data.code!=='string' || !/^[A-Za-z0-9_-]{1,30}$/.test(data.code) || !ledgerText(data.name,100) || !accountCategories.includes(data.category))
    throw new LedgerRefusal('Record an account code, a name of up to 100 characters, and a valid account category.');
  const uid=crypto.randomUUID();
  const result=await commitLedger(c.env,[c.env.DB.prepare(`INSERT INTO fund_ledger_accounts(uid,fund_id,code,name,category,recorded_by)
    SELECT ?,id,?,?,?,? FROM vc_funds WHERE id=? AND (?='admin' OR fund_admin_user_id=?)
    AND NOT EXISTS (SELECT 1 FROM fund_ledger_accounts WHERE fund_id=? AND code=?)`)
    .bind(uid,data.code,data.name.trim(),data.category,user.id,fund.id,user.role,user.id,fund.id,data.code),
    ledgerAudit(c.env,user.id,'fund_ledger_account_recorded',{fund_id:fund.id,uid,code:data.code,name:data.name.trim(),category:data.category})]);
  return c.json({id:result[0].meta.last_row_id,uid,recorded_by:user.id},201);
});
r.post('/:id/periods',async c=>{
  const {user,fund}=await access(c,true), data=await body(c);
  if (!data || !ledgerDate(data.start_date) || !ledgerDate(data.end_date) || data.start_date>data.end_date || !ledgerText(data.label,100))
    throw new LedgerRefusal('Record a period label and valid start and end dates in order.');
  const uid=crypto.randomUUID();
  const result=await commitLedger(c.env,[c.env.DB.prepare(`INSERT INTO fund_accounting_periods(uid,fund_id,label,start_date,end_date,recorded_by)
    SELECT ?,id,?,?,?,? FROM vc_funds WHERE id=? AND (?='admin' OR fund_admin_user_id=?)
    AND NOT EXISTS (SELECT 1 FROM fund_accounting_periods WHERE fund_id=? AND start_date<=? AND end_date>=?)`)
    .bind(uid,data.label.trim(),data.start_date,data.end_date,user.id,fund.id,user.role,user.id,fund.id,data.end_date,data.start_date),
    ledgerAudit(c.env,user.id,'fund_ledger_period_recorded',{fund_id:fund.id,uid,label:data.label.trim(),start_date:data.start_date,end_date:data.end_date})]);
  return c.json({id:result[0].meta.last_row_id,uid,recorded_by:user.id},201);
});
r.post('/:id/fee-terms',async c=>{
  const {user,fund}=await access(c,true), data=await body(c);
  if (!data || !ledgerDate(data.effective_date) || !ledgerCents(data.basis_cents) || !Number.isInteger(data.annual_bps) || data.annual_bps<0 || data.annual_bps>10000 || !ledgerText(data.source))
    throw new LedgerRefusal('Record an effective date, annual basis points from 0 to 10000, basis cents and a source of up to 500 characters.');
  const uid=crypto.randomUUID();
  const result=await commitLedger(c.env,[c.env.DB.prepare(`INSERT INTO fund_fee_terms(uid,fund_id,effective_date,annual_bps,basis_cents,source,recorded_by)
    SELECT ?,id,?,?,?,?,? FROM vc_funds WHERE id=? AND (?='admin' OR fund_admin_user_id=?)`)
    .bind(uid,data.effective_date,data.annual_bps,data.basis_cents,data.source.trim(),user.id,fund.id,user.role,user.id),
    ledgerAudit(c.env,user.id,'fund_ledger_fee_terms_recorded',{fund_id:fund.id,uid,effective_date:data.effective_date,annual_bps:data.annual_bps,basis_cents:data.basis_cents,source:data.source.trim()})]);
  return c.json({id:result[0].meta.last_row_id,uid,recorded_by:user.id},201);
});
r.post('/:id/periods/:periodId/entries',async c=>{
  const {user,fund}=await access(c,true), data=await body(c), periodId=parseId(c.req.param('periodId'));
  if (!periodId || !data) throw new LedgerRefusal('Choose a period and record the entry.');
  return c.json(await postLedgerEntry(c.env,user,fund.id,periodId,data),201);
});
r.post('/:id/periods/:periodId/fee-accrual',async c=>{
  const {user,fund}=await access(c,true), data=await body(c), periodId=parseId(c.req.param('periodId'));
  if (!periodId || !data || !ledgerId(data.expense_account_id) || !ledgerId(data.payable_account_id)) throw new LedgerRefusal('Choose a period and its fee expense and payable accounts.');
  return c.json(await accrueFundFee(c.env,user,fund.id,periodId,data.expense_account_id,data.payable_account_id),201);
});
r.post('/:id/periods/:periodId/expenses',async c=>{
  const {user,fund}=await access(c,true), data=await body(c), periodId=parseId(c.req.param('periodId'));
  if (!periodId || !data || !ledgerId(data.expense_account_id) || !ledgerId(data.credit_account_id) || !ledgerCents(data.amount_cents) || data.amount_cents===0)
    throw new LedgerRefusal('Choose fund accounts and record positive expense cents.');
  const accounts=await c.env.DB.prepare(`SELECT id,category FROM fund_ledger_accounts WHERE fund_id=?`).bind(fund.id).all<any>();
  if (!accounts.success) throw new Error('Expense account read failed');
  if (!accounts.results.some(a=>a.id===data.expense_account_id && a.category==='expense') || !accounts.results.some(a=>a.id===data.credit_account_id && ['asset','liability'].includes(a.category)))
    throw new LedgerRefusal('Choose this fund’s expense and cash or payable accounts.');
  return c.json(await postLedgerEntry(c.env,user,fund.id,periodId,{entry_date:data.entry_date,description:data.description,
    lines:[{account_id:data.expense_account_id,debit_cents:data.amount_cents,credit_cents:0},{account_id:data.credit_account_id,debit_cents:0,credit_cents:data.amount_cents}]},'expense'),201);
});
r.post('/:id/lines/:lineId/reconcile',async c=>{
  const {user,fund}=await access(c,true), data=await body(c), lineId=parseId(c.req.param('lineId'));
  if (!lineId || !data || !ledgerText(data.statement_reference,100) || !ledgerText(data.statement_line_reference,100)
    || !ledgerDate(data.statement_date) || !Number.isSafeInteger(data.statement_amount_cents)) throw new LedgerRefusal('Record a statement reference, line reference, date and signed amount in cents.');
  const result=await commitLedger(c.env,[c.env.DB.prepare(`UPDATE fund_ledger_lines SET statement_reference=?,statement_line_reference=?,statement_date=?,
    statement_amount_cents=?,reconciled_by=?,reconciled_at=datetime('now'),updated_at=datetime('now')
    WHERE fund_id=? AND id=? AND reconciled_by IS NULL AND debit_cents-credit_cents=?
    AND EXISTS (SELECT 1 FROM fund_ledger_entries e JOIN fund_accounting_periods p ON p.id=e.period_id AND p.fund_id=e.fund_id
      JOIN vc_funds f ON f.id=e.fund_id WHERE e.id=fund_ledger_lines.entry_id AND e.fund_id=fund_ledger_lines.fund_id AND e.posted=1
      AND p.closed=0 AND (?='admin' OR f.fund_admin_user_id=?))
    AND NOT EXISTS (SELECT 1 FROM fund_ledger_lines WHERE fund_id=? AND statement_reference=? AND statement_line_reference=?)`)
    .bind(data.statement_reference.trim(),data.statement_line_reference.trim(),data.statement_date,data.statement_amount_cents,user.id,fund.id,lineId,data.statement_amount_cents,user.role,user.id,
      fund.id,data.statement_reference.trim(),data.statement_line_reference.trim()),
    ledgerAudit(c.env,user.id,'fund_ledger_line_reconciled',{fund_id:fund.id,line_id:lineId,statement_reference:data.statement_reference.trim(),statement_line_reference:data.statement_line_reference.trim(),statement_date:data.statement_date,statement_amount_cents:data.statement_amount_cents})]);
  return c.json({line_id:lineId,reconciled_by:user.id,updated:result[0].meta.changes});
});
r.post('/:id/periods/:periodId/state',async c=>{
  const {user,fund}=await access(c,true), data=await body(c), periodId=parseId(c.req.param('periodId'));
  if (!periodId || !data || typeof data.closed!=='boolean' || (!data.closed && !ledgerText(data.reason)))
    throw new LedgerRefusal('Choose close or reopen; reopening requires a reason of up to 500 characters.');
  const period=await ledgerPeriod(c.env,fund.id,periodId), target=data.closed ? 1 : 0;
  if (period.closed===target) throw new LedgerRefusal('This period already has the requested state.',409);
  await commitLedger(c.env,[c.env.DB.prepare(`UPDATE fund_accounting_periods SET closed=?,version=version+1,closed_by=?,
    closed_at=CASE WHEN ?=1 THEN datetime('now') ELSE NULL END,updated_at=datetime('now')
    WHERE fund_id=? AND id=? AND closed=? AND version=?
    AND EXISTS (SELECT 1 FROM vc_funds WHERE id=? AND (?='admin' OR fund_admin_user_id=?))
    AND NOT EXISTS (SELECT 1 FROM fund_ledger_entries WHERE fund_id=? AND period_id=? AND (posted=0 OR debit_cents!=credit_cents))`)
    .bind(target,data.closed ? user.id : null,target,fund.id,periodId,period.closed,period.version,fund.id,user.role,user.id,fund.id,periodId),
    ledgerAudit(c.env,user.id,data.closed ? 'fund_ledger_period_closed' : 'fund_ledger_period_reopened',{fund_id:fund.id,period_id:periodId,reason:data.closed ? null : data.reason.trim()})]);
  return c.json({period_id:periodId,closed:data.closed,version:period.version+1});
});
export default r;
