import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SignJWT } from 'jose';
import { makeD1 } from './_d1_sqlite.mjs';
import route from '../src/routes/fund_ledger.ts';
import { feeForPeriod,ledgerDate,postLedgerEntry,readFundLedger } from '../src/services/fundLedger.ts';
const migration=readFileSync(new URL('../sql/migrations/418_fund_ledger.sql',import.meta.url),'utf8');
const schema=`PRAGMA foreign_keys=ON;
CREATE TABLE users(id INTEGER PRIMARY KEY,email TEXT,name TEXT,role TEXT,is_active INTEGER);
INSERT INTO users VALUES(1,'admin@example.test','Admin','admin',1),(2,'operator@example.test','Operator','investor',1),
 (3,'lp@example.test','LP','investor',1),(4,'other@example.test','Other','investor',1),(5,'founder@example.test','Founder','founder',1),
 (6,'gp@example.test','GP','investor',1),(7,'legacy@example.test','Legacy','investor',1),(8,'inactive@example.test','Inactive','investor',0);
CREATE TABLE vc_funds(id INTEGER PRIMARY KEY,name TEXT,fund_admin TEXT,gp_user_id INTEGER,management_fee REAL DEFAULT .02);
INSERT INTO vc_funds(id,name,fund_admin,gp_user_id) VALUES(10,'Fund A','GP',6),(20,'Fund B','Other',4);
CREATE TABLE limited_partners(id INTEGER PRIMARY KEY,fund_id INTEGER,user_id INTEGER,email TEXT);
INSERT INTO limited_partners VALUES(101,10,3,'lp@example.test'),(102,20,4,'other@example.test'),(103,10,NULL,'LEGACY@example.test'),(104,20,4,'legacy@example.test');
CREATE TABLE activity_logs(id INTEGER PRIMARY KEY,action TEXT,details TEXT,actor TEXT,user_id INTEGER);`;
const secret='d628-fixture-only-signing-secret';
async function fixture(terms=true) {
  const {DB,db}=makeD1(schema+migration);
  db.exec('UPDATE vc_funds SET fund_admin_user_id=2 WHERE id=10; UPDATE vc_funds SET fund_admin_user_id=4 WHERE id=20;');
  const env={DB,JWT_SECRET:secret,ENVIRONMENT:'development'} as any;
  async function request(path:string,user=2,method='GET',data?:any) {
    const jwt=await new SignJWT({user_id:user}).setProtectedHeader({alg:'HS256'}).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(secret));
    return route.request(path,{method,headers:{Authorization:`Bearer ${jwt}`,'Content-Type':'application/json'},...(data===undefined?{}:{body:JSON.stringify(data)})},env);
  }
  for (const [code,name,category] of [['FEE','Management fee','expense'],['PAY','Fee payable','liability'],['CASH','Cash','asset'],['EXP','Legal expense','expense']]) {
    const response=await request('/10/accounts',2,'POST',{code,name,category});
    if (response.status!==201) throw new Error(await response.text());
  }
  const p=await request('/10/periods',2,'POST',{label:'Q1 2024',start_date:'2024-01-01',end_date:'2024-03-31'});
  if (p.status!==201) throw new Error(await p.text());
  if (terms) {
    const t=await request('/10/fee-terms',2,'POST',{effective_date:'2024-01-01',annual_bps:200,basis_cents:100000000,source:' LPA § 8 '});
    if (t.status!==201) throw new Error(await t.text());
  }
  return {DB,db,env,request};
}
const entry={entry_date:'2024-02-01',description:' Opening cash ',lines:[{account_id:3,debit_cents:1000000,credit_cents:0},{account_id:2,debit_cents:0,credit_cents:1000000}]};
const fee={expense_account_id:1,payable_account_id:2};
const expense={entry_date:'2024-02-02',description:' Legal invoice 001 ',expense_account_id:4,credit_account_id:3,amount_cents:12345};
const reconcile={statement_reference:' Bank Q1 ',statement_line_reference:' row 9 ',statement_date:'2024-02-02',statement_amount_cents:1000000};
const count=(db:any,table:string)=>db.prepare(`SELECT COUNT(*) n FROM ${table}`).get().n;
test('fee arithmetic uses inclusive actual days/365, integer rounding, explicit zero and safe limits',()=>{
  assert.equal(feeForPeriod(100000000,200,'2024-01-01','2024-03-31'),498630);
  assert.equal(feeForPeriod(36500,100,'2024-02-29','2024-02-29'),1);
  assert.equal(feeForPeriod(18250,100,'2024-02-29','2024-02-29'),1);
  assert.equal(feeForPeriod(100,0,'2024-01-01','2024-12-31'),0);
  for(const args of [[-1,200,'2024-01-01','2024-03-31'],[1.5,200,'2024-01-01','2024-03-31'],[100,10001,'2024-01-01','2024-03-31'],[100,1.5,'2024-01-01','2024-03-31'],[100,200,'2024-02-30','2024-03-31'],[100,200,'2024-04-01','2024-03-31'],[Number.MAX_SAFE_INTEGER,10000,'2020-01-01','2024-01-01']] as any[])
    assert.throws(()=>feeForPeriod(...args as [number,number,string,string]),args[0]===Number.MAX_SAFE_INTEGER ? /too large/ : /Record valid fee terms/);
  assert.throws(()=>feeForPeriod(1,-1,'2024-01-01','2024-01-01'),/Record valid fee terms/);
  assert.equal(ledgerDate('2024-02-29'),true);
  for(const date of ['2023-02-29','2024-02-30','2024-13-01','2024-01-01T00:00:00Z',null,2]) assert.equal(ledgerDate(date),false);
});
test('worked fee and expense post balanced entries; journal and trial balance preserve cents and period scope',async()=>{
  const f=await fixture(); try {
    const accrued=await f.request('/10/periods/1/fee-accrual',2,'POST',fee);
    assert.equal(accrued.status,201);
    const paid=await accrued.json() as any;
    assert.equal(paid.fee_cents,498630);
    assert.equal(paid.fee_terms_id,1);
    assert.equal((await f.request('/10/periods/1/entries',2,'POST',entry)).status,201);
    assert.equal((await f.request('/10/periods/1/expenses',2,'POST',expense)).status,201);
    const book=await (await f.request('/10')).json() as any;
    assert.deepEqual(book.summary,{entry_count:3,fee_cents:498630,expense_cents:12345,reconciled_lines:0});
    assert.equal(book.can_manage,true);
    assert.equal(book.reason,null);
    assert.equal(book.period.label,'Q1 2024');
    assert.deepEqual(book.journal.map((e:any)=>[e.kind,e.debit_cents,e.credit_cents,e.recorded_by]),[['journal',1000000,1000000,2],['expense',12345,12345,2],['fee_accrual',498630,498630,2]]);
    assert.equal(book.journal[0].description,'Opening cash');
    assert.equal(book.journal[1].description,'Legal invoice 001');
    assert.deepEqual(f.db.prepare('SELECT line_count FROM fund_ledger_entries ORDER BY id').all().map((e:any)=>e.line_count),[2,2,2]);
    assert.deepEqual(book.journal[1].lines.map((l:any)=>[l.account_id,l.debit_cents,l.credit_cents]),[[4,12345,0],[3,0,12345]]);
    assert.deepEqual(book.trial_balance.map((a:any)=>[a.code,a.debit_cents,a.credit_cents]).sort(),[['CASH',1000000,12345],['EXP',12345,0],['FEE',498630,0],['PAY',0,1498630]]);
    assert.equal((await f.request('/10/periods/1/fee-accrual',2,'POST',fee)).status,409);
    assert.equal(count(f.db,'fund_ledger_entries'),3);
    assert.equal((await f.request('/10?period_id=99')).status,404);
    assert.equal((await f.request('/10?period_id=1x')).status,400);
    assert.equal((await f.request('/10/accounts')).status,200);
    const next=await f.request('/10/periods',2,'POST',{label:'Q2',start_date:'2024-04-01',end_date:'2024-06-30'});
    assert.equal(next.status,201);
    const empty=await (await f.request('/10?period_id=2')).json() as any;
    assert.deepEqual(empty.summary,{entry_count:0,fee_cents:null,expense_cents:null,reconciled_lines:0});
    assert.deepEqual(empty.journal,[]); assert.deepEqual(empty.trial_balance,[]);
    assert.match(empty.reason,/Not recorded/);
  } finally {f.db.close();}
});
test('every write records its actor and complete provenance; close/reopen and reconcile retain statement facts',async()=>{
  const f=await fixture();try {
    assert.equal((await f.request('/10/administrator',1,'PUT',{user_id:2})).status,200);
    assert.equal((await f.request('/10/periods/1/entries',2,'POST',entry)).status,201);
    assert.equal((await f.request('/10/periods/1/fee-accrual',2,'POST',fee)).status,201);
    assert.equal((await f.request('/10/periods/1/expenses',2,'POST',expense)).status,201);
    assert.equal((await f.request('/10/lines/1/reconcile',2,'POST',reconcile)).status,200);
    assert.deepEqual({...f.db.prepare('SELECT statement_reference,statement_line_reference,statement_date,statement_amount_cents,reconciled_by FROM fund_ledger_lines WHERE id=1').get()},
      {statement_reference:'Bank Q1',statement_line_reference:'row 9',statement_date:'2024-02-02',statement_amount_cents:1000000,reconciled_by:2});
    assert.ok(f.db.prepare('SELECT reconciled_at FROM fund_ledger_lines WHERE id=1').get().reconciled_at);
    assert.equal((await f.request('/10/periods/1/state',2,'POST',{closed:true})).status,200);
    assert.deepEqual({...f.db.prepare('SELECT closed,closed_by,version FROM fund_accounting_periods WHERE id=1').get()},{closed:1,closed_by:2,version:1});
    assert.equal((await f.request('/10/periods/1/state',2,'POST',{closed:false,reason:' Statement correction '})).status,200);
    assert.deepEqual({...f.db.prepare('SELECT closed,closed_by,closed_at,version FROM fund_accounting_periods WHERE id=1').get()},{closed:0,closed_by:null,closed_at:null,version:2});
    const logs=f.db.prepare('SELECT action,actor,user_id,details FROM activity_logs ORDER BY id').all();
    assert.deepEqual(logs.map((l:any)=>[l.action,l.actor,l.user_id]),[
      ...Array(4).fill(['fund_ledger_account_recorded','2',2]),['fund_ledger_period_recorded','2',2],['fund_ledger_fee_terms_recorded','2',2],
      ['fund_ledger_administrator_assigned','1',1],...Array(3).fill(['fund_ledger_entry_posted','2',2]),['fund_ledger_line_reconciled','2',2],['fund_ledger_period_closed','2',2],['fund_ledger_period_reopened','2',2]]);
    assert.deepEqual(JSON.parse(logs[5].details),{fund_id:10,uid:JSON.parse(logs[5].details).uid,effective_date:'2024-01-01',annual_bps:200,basis_cents:100000000,source:'LPA § 8'});
    assert.deepEqual(JSON.parse(logs[6].details),{fund_id:10,before_user_id:2,user_id:2});
    assert.deepEqual(JSON.parse(logs[7].details),{fund_id:10,period_id:1,entry_uid:JSON.parse(logs[7].details).entry_uid,kind:'journal',fee_terms_id:null,entry_date:'2024-02-01',description:'Opening cash',lines:entry.lines});
    assert.deepEqual(JSON.parse(logs[10].details),{fund_id:10,line_id:1,statement_reference:'Bank Q1',statement_line_reference:'row 9',statement_date:'2024-02-02',statement_amount_cents:1000000});
    assert.deepEqual(JSON.parse(logs[12].details),{fund_id:10,period_id:1,reason:'Statement correction'});
    assert.equal((await (await f.request('/10')).json() as any).summary.reconciled_lines,1);
  }finally{f.db.close();}
});
test('LP summaries disclose no journal, chart or other fund; named GP is not the assigned administrator',async()=>{
  const f=await fixture();try{
    await f.request('/10/periods/1/fee-accrual',2,'POST',fee);
    const lp=await (await f.request('/10',3)).json() as any;
    assert.equal(lp.can_manage,false); assert.equal(lp.summary.fee_cents,498630);
    assert.deepEqual(lp.journal,[]); assert.deepEqual(lp.trial_balance,[]);
    assert.doesNotMatch(JSON.stringify(lp),/LPA § 8|statement_reference|recorded_by/);
    assert.deepEqual((await (await f.request('/',3)).json() as any).items.map((a:any)=>a.id),[10]);
    assert.deepEqual((await (await f.request('/',1)).json() as any).items.map((a:any)=>a.id),[10,20]);
    assert.deepEqual((await (await f.request('/',2)).json() as any).items.map((a:any)=>a.id),[10]);
    for(const [path,user] of [['/20',3],['/10',4],['/10',5],['/10',6],['/10/accounts',3],['/',5],['/99',1],['/10x',1]] as const) assert.equal((await f.request(path,user)).status,404);
    assert.equal((await f.request('/10',8)).status,401);
    assert.equal((await route.request('/10',{},f.env)).status,401);
    assert.equal((await f.request('/10',7)).status,200);
    assert.equal(f.db.prepare('SELECT user_id FROM limited_partners WHERE id=103').get().user_id,7);
    assert.equal(f.db.prepare('SELECT user_id FROM limited_partners WHERE id=104').get().user_id,4);
    for(const [path,method,data] of [['accounts','POST',{code:'Z',name:'No',category:'asset'}],['periods','POST',{label:'X',start_date:'2025-01-01',end_date:'2025-02-01'}],['fee-terms','POST',{effective_date:'2024-01-01',annual_bps:100,basis_cents:100,source:'No'}],['periods/1/entries','POST',entry],['periods/1/fee-accrual','POST',fee],['periods/1/expenses','POST',expense],['lines/1/reconcile','POST',reconcile],['periods/1/state','POST',{closed:true}],['administrator','PUT',{user_id:3}]] as any[])
      assert.equal((await f.request('/10/'+path,3,method,data)).status,404);
    assert.equal((await f.request('/10/administrator',2,'PUT',{user_id:3})).status,404);
    assert.equal((await f.request('/10/administrator',1,'PUT',{user_id:8})).status,409);
    assert.equal((await f.request('/10/administrator',1,'PUT',{user_id:5})).status,409);
    assert.equal((await f.request('/10/administrator',1,'PUT',{user_id:null})).status,200);
    assert.equal((await f.request('/10',2)).status,404);
  }finally{f.db.close();}
});
test('unbalanced and malformed entries refuse without data or audit; cross-fund accounts cannot post',async()=>{
  const f=await fixture();try{
    f.db.exec("INSERT INTO fund_ledger_accounts(fund_id,code,name,category,recorded_by) VALUES(20,'OTHER','Other cash','asset',4);");
    const before=count(f.db,'activity_logs');
    for(const data of [null,{...entry,lines:[{account_id:3,debit_cents:100,credit_cents:0},{account_id:2,debit_cents:0,credit_cents:99}]},
      {...entry,lines:[]},{...entry,lines:[entry.lines[0]]},{...entry,lines:Array(51).fill(entry.lines[0])},
      {...entry,lines:[{account_id:3,debit_cents:1,credit_cents:1},entry.lines[1]]},
      {...entry,lines:[{account_id:3,debit_cents:101,credit_cents:1},{account_id:2,debit_cents:0,credit_cents:100}]},
      {...entry,lines:Array.from({length:52},(_,i)=>({account_id:i%2?2:3,debit_cents:i%2?0:1,credit_cents:i%2?1:0}))},
      ...[-1,1.5,'100',Number.MAX_SAFE_INTEGER+1].map(n=>({...entry,lines:[{account_id:3,debit_cents:n,credit_cents:0},entry.lines[1]]})),
      {...entry,lines:[{account_id:5,debit_cents:1000000,credit_cents:0},entry.lines[1]]},
      {...entry,entry_date:'2023-12-31'},{...entry,entry_date:'2024-04-01'},{...entry,entry_date:'2024-02-30'},
      {...entry,description:' '},{...entry,description:'x'.repeat(501)},{...entry,lines:[{account_id:3,debit_cents:0,credit_cents:0},{account_id:2,debit_cents:0,credit_cents:0}]},
      {...entry,lines:[{account_id:3,debit_cents:Number.MAX_SAFE_INTEGER,credit_cents:0},{account_id:3,debit_cents:1,credit_cents:0},{account_id:2,debit_cents:0,credit_cents:Number.MAX_SAFE_INTEGER}]}]) {
      const response=await f.request('/10/periods/1/entries',2,'POST',data);
      assert.equal(response.status,400); assert.ok((await response.json() as any).message.length>15);
    }
    assert.equal((await f.request('/10/periods/99/entries',2,'POST',entry)).status,404);
    assert.equal(count(f.db,'fund_ledger_entries'),0); assert.equal(count(f.db,'fund_ledger_lines'),0);
    assert.equal(count(f.db,'activity_logs'),before);
    await assert.rejects(()=>postLedgerEntry(f.env,{id:2,role:'investor'},10,1,{...entry,lines:[{account_id:3,debit_cents:0,credit_cents:0}]},'fee_accrual'),/between two and fifty/);
  }finally{f.db.close();}
});
test('missing and mid-period fee terms refuse; explicit recorded zero remains a zero fee',async()=>{
  const f=await fixture(false);try{
    const absent=await f.request('/10/periods/1/fee-accrual',2,'POST',fee);
    assert.equal(absent.status,400); assert.match((await absent.json() as any).message,/Not recorded.*terms.*No fee/);
    assert.equal(count(f.db,'fund_ledger_entries'),0);
    await f.request('/10/fee-terms',2,'POST',{effective_date:'2024-02-01',annual_bps:200,basis_cents:100000000,source:'Mid-period'});
    const mid=await f.request('/10/periods/1/fee-accrual',2,'POST',fee);
    assert.equal(mid.status,400); assert.match((await mid.json() as any).message,/Split/);
    assert.equal(count(f.db,'fund_ledger_entries'),0);
    f.db.exec('DELETE FROM fund_fee_terms');
    await f.request('/10/fee-terms',2,'POST',{effective_date:'2024-01-01',annual_bps:0,basis_cents:100000000,source:'No management fee'});
    assert.equal((await f.request('/10/periods/1/fee-accrual',2,'POST',fee)).status,201);
    assert.equal((await (await f.request('/10')).json() as any).summary.fee_cents,0);
  }finally{f.db.close();}
});
test('closed periods refuse every posting/reconciliation; reopen needs a reason and duplicate transitions refuse',async()=>{
  const f=await fixture();try{
    await f.request('/10/periods/1/entries',2,'POST',entry);
    assert.equal((await f.request('/10/periods/1/state',2,'POST',{closed:true})).status,200);
    const before=count(f.db,'activity_logs');
    for(const [path,data] of [['entries',entry],['expenses',expense],['fee-accrual',fee]]) {
      const response=await f.request('/10/periods/1/'+path,2,'POST',data);
      assert.equal(response.status,409); assert.match((await response.json() as any).message,/closed/);
    }
    assert.equal((await f.request('/10/lines/1/reconcile',2,'POST',reconcile)).status,409);
    assert.equal((await f.request('/10/lines/1/reconcile',2,'POST',{...reconcile,statement_line_reference:'replacement'})).status,409);
    assert.equal((await f.request('/10/periods/1/state',2,'POST',{closed:true})).status,409);
    for(const data of [{closed:false},{closed:false,reason:' '},{closed:false,reason:'x'.repeat(501)},{closed:'false',reason:'Correction'}]) assert.equal((await f.request('/10/periods/1/state',2,'POST',data)).status,400);
    assert.equal(count(f.db,'fund_ledger_entries'),1); assert.equal(count(f.db,'activity_logs'),before);
    assert.equal((await f.request('/10/periods/1/state',2,'POST',{closed:false,reason:'Correction'})).status,200);
    assert.equal((await f.request('/10/periods/1/expenses',2,'POST',expense)).status,201);
  }finally{f.db.close();}
});
test('statement reconciliation matches the signed line amount and prevents duplicate statement lines',async()=>{
  const f=await fixture();try{
    await f.request('/10/periods/1/entries',2,'POST',entry);
    await f.request('/10/periods/1/entries',2,'POST',entry);
    const before=count(f.db,'activity_logs');
    assert.equal((await f.request('/10/lines/1/reconcile',2,'POST',{...reconcile,statement_amount_cents:999999})).status,409);
    assert.equal((await f.request('/10/lines/1/reconcile',2,'POST',{...reconcile,statement_amount_cents:1.5})).status,400);
    assert.equal((await f.request('/10/lines/1/reconcile',2,'POST',{...reconcile,statement_date:'2024-02-30'})).status,400);
    assert.equal((await f.request('/10/lines/1/reconcile',2,'POST',{...reconcile,statement_reference:' '})).status,400);
    assert.equal(count(f.db,'activity_logs'),before);
    assert.equal((await f.request('/10/lines/1/reconcile',2,'POST',reconcile)).status,200);
    assert.equal((await f.request('/10/lines/1/reconcile',2,'POST',reconcile)).status,409);
    assert.equal((await f.request('/10/lines/1/reconcile',2,'POST',{...reconcile,statement_line_reference:'replacement'})).status,409);
    assert.equal((await f.request('/10/lines/3/reconcile',2,'POST',reconcile)).status,409);
    assert.equal((await f.request('/10/lines/2/reconcile',2,'POST',{...reconcile,statement_line_reference:'row 10',statement_amount_cents:-1000000})).status,200);
    assert.equal((await f.request('/20/lines/1/reconcile',4,'POST',reconcile)).status,409);
    assert.equal(count(f.db,'activity_logs'),before+2);
  }finally{f.db.close();}
});
test('chart, period, term and expense inputs reject invalid values and overlapping periods',async()=>{
  const f=await fixture();try{
    const before=count(f.db,'activity_logs');
    for(const data of [{code:'a b',name:'Cash',category:'asset'},{code:'A',name:' ',category:'asset'},{code:'A',name:'x'.repeat(101),category:'asset'},{code:'A',name:'Cash',category:'wrong'}]) assert.equal((await f.request('/10/accounts',2,'POST',data)).status,400);
    assert.equal((await f.request('/10/accounts',2,'POST',{code:'CASH',name:'Cash',category:'asset'})).status,409);
    for(const data of [{label:' ',start_date:'2024-04-01',end_date:'2024-06-30'},{label:'X',start_date:'2024-02-30',end_date:'2024-06-30'},{label:'X',start_date:'2024-06-30',end_date:'2024-04-01'}]) assert.equal((await f.request('/10/periods',2,'POST',data)).status,400);
    for(const [start_date,end_date] of [['2024-03-31','2024-06-30'],['2023-12-01','2024-01-01'],['2024-01-02','2024-01-03'],['2023-01-01','2025-01-01']]) assert.equal((await f.request('/10/periods',2,'POST',{label:'Overlap',start_date,end_date})).status,409);
    const term={effective_date:'2024-01-01',annual_bps:200,basis_cents:100,source:'LPA'};
    for(const data of [{...term,basis_cents:-1},{...term,basis_cents:1.5},{...term,annual_bps:10001},{...term,annual_bps:-1},{...term,annual_bps:1.5},{...term,effective_date:'2023-02-29'},{...term,source:' '},{...term,source:'x'.repeat(501)}]) assert.equal((await f.request('/10/fee-terms',2,'POST',data)).status,400);
    for(const data of [{...expense,amount_cents:0},{...expense,amount_cents:1.5},{...expense,expense_account_id:3},{...expense,credit_account_id:1}]) assert.equal((await f.request('/10/periods/1/expenses',2,'POST',data)).status,400);
    assert.equal((await f.request('/10/periods/1/fee-accrual',2,'POST',{expense_account_id:3,payable_account_id:2})).status,400);
    assert.equal((await f.request('/10/periods/1/fee-accrual',2,'POST',{expense_account_id:1,payable_account_id:3})).status,400);
    assert.equal(count(f.db,'activity_logs'),before);
  }finally{f.db.close();}
});
test('audit failure rolls back each write; failed reads are sanitized Unreadable, never partial totals',async()=>{
  for(const [path,method,data] of [['administrator','PUT',{user_id:3}],['accounts','POST',{code:'NEW',name:'New',category:'asset'}],['periods','POST',{label:'Q2',start_date:'2024-04-01',end_date:'2024-06-30'}],['fee-terms','POST',{effective_date:'2024-01-01',annual_bps:300,basis_cents:100,source:'New'}],['periods/1/entries','POST',entry],['periods/1/fee-accrual','POST',fee],['periods/1/expenses','POST',expense],['lines/1/reconcile','POST',reconcile],['periods/1/state','POST',{closed:true}]] as any[]) {
    const f=await fixture();try{
      await f.request('/10/periods/1/entries',2,'POST',entry);
      const before=['fund_ledger_accounts','fund_accounting_periods','fund_fee_terms','fund_ledger_entries','fund_ledger_lines'].map(t=>count(f.db,t));
      f.db.exec('DROP TABLE activity_logs');
      const response=await f.request('/10/'+path,path==='administrator'?1:2,method,data);
      assert.equal(response.status,503); assert.match((await response.json() as any).message,/Unreadable/);
      assert.deepEqual(['fund_ledger_accounts','fund_accounting_periods','fund_fee_terms','fund_ledger_entries','fund_ledger_lines'].map(t=>count(f.db,t)),before);
      assert.equal(f.db.prepare('SELECT fund_admin_user_id FROM vc_funds WHERE id=10').get().fund_admin_user_id,2);
      assert.equal(f.db.prepare('SELECT closed FROM fund_accounting_periods WHERE id=1').get().closed,0);
      assert.equal(f.db.prepare('SELECT reconciled_by FROM fund_ledger_lines WHERE id=1').get().reconciled_by,null);
      assert.doesNotMatch(JSON.stringify(await (await f.request('/10/'+path,path==='administrator'?1:2,method,data)).json()),/activity_logs|SQLITE|no such table/);
    }finally{f.db.close();}
  }
  const f=await fixture();try{
    f.db.exec('DROP TABLE fund_ledger_lines');
    const response=await f.request('/10');assert.equal(response.status,503);assert.match(await response.text(),/Unreadable/);
  }finally{f.db.close();}
});
test('database recomputation rejects unbalanced publication and foreign-fund lines',async()=>{
  const f=await fixture();try{
    f.db.exec("INSERT INTO fund_ledger_entries(uid,fund_id,period_id,entry_date,description,kind,recorded_by) VALUES('draft',10,1,'2024-01-01','Draft','journal',2);");
    assert.throws(()=>f.db.exec("INSERT INTO fund_ledger_lines(fund_id,entry_id,account_id,debit_cents,credit_cents) VALUES(10,1,3,-1,0);"));
    assert.throws(()=>f.db.exec("INSERT INTO fund_ledger_lines(fund_id,entry_id,account_id,debit_cents,credit_cents) VALUES(10,1,3,1.5,0);"));
    assert.throws(()=>f.db.exec("INSERT INTO fund_ledger_lines(fund_id,entry_id,account_id,debit_cents,credit_cents) VALUES(10,1,3,1,1);"));
    f.db.exec("INSERT INTO fund_ledger_lines(fund_id,entry_id,account_id,debit_cents,credit_cents) VALUES(10,1,3,100,0),(10,1,2,0,99);");
    assert.throws(()=>f.db.exec('UPDATE fund_ledger_entries SET posted=1,debit_cents=100,credit_cents=99,line_count=2 WHERE id=1'));
    assert.throws(()=>f.db.exec('UPDATE fund_ledger_entries SET posted=1,debit_cents=100,credit_cents=100,line_count=1 WHERE id=1'));
    assert.throws(()=>f.db.exec('UPDATE fund_ledger_entries SET posted=1,debit_cents=100,credit_cents=100,line_count=NULL WHERE id=1'));
    assert.throws(()=>f.db.exec("UPDATE fund_ledger_lines SET statement_reference='Bank',statement_line_reference='9',statement_date='2024-01-01',reconciled_by=2,reconciled_at='2024-01-01' WHERE id=1"));
    assert.throws(()=>f.db.exec("INSERT INTO fund_ledger_lines(fund_id,entry_id,account_id,debit_cents,credit_cents) VALUES(20,1,3,100,0);"));
    f.db.exec("INSERT INTO fund_accounting_periods(fund_id,label,start_date,end_date,recorded_by) VALUES(20,'Other','2024-01-01','2024-03-31',4); INSERT INTO fund_ledger_entries(uid,fund_id,period_id,entry_date,description,kind,recorded_by) VALUES('other',20,2,'2024-01-01','Other','journal',4);");
    assert.throws(()=>f.db.exec("INSERT INTO fund_ledger_lines(fund_id,entry_id,account_id,debit_cents,credit_cents) VALUES(20,2,3,100,0);"));
  }finally{f.db.close();}
});
test('posting rechecks concurrent close, administrator revocation and changed fee terms inside the batch',async()=>{
  for(const change of ['UPDATE fund_accounting_periods SET closed=1,version=version+1 WHERE id=1','UPDATE fund_accounting_periods SET version=version+1 WHERE id=1','UPDATE vc_funds SET fund_admin_user_id=4 WHERE id=10',"INSERT INTO fund_fee_terms(fund_id,effective_date,annual_bps,basis_cents,source,recorded_by) VALUES(10,'2024-01-01',300,100000000,'Changed',1)"]) {
    const f=await fixture();try{
      const batch=f.DB.batch.bind(f.DB), before=count(f.db,'activity_logs');
      f.DB.batch=async(stmts:any[])=>{f.db.exec(change);return batch(stmts);};
      assert.equal((await f.request('/10/periods/1/fee-accrual',2,'POST',fee)).status,409);
      assert.equal(count(f.db,'fund_ledger_entries'),0);assert.equal(count(f.db,'fund_ledger_lines'),0);assert.equal(count(f.db,'activity_logs'),before);
    }finally{f.db.close();}
  }
});
test('reported D1 read/write failure does not return success',async()=>{
  const f=await fixture();try{
    const prepare=f.DB.prepare.bind(f.DB);
    f.DB.prepare=(sql:string)=>{const stmt=prepare(sql);const all=stmt.all.bind(stmt);stmt.all=async()=>({...await all(),success:false});return stmt;};
    assert.equal((await f.request('/10')).status,503);
    await assert.rejects(()=>readFundLedger(f.env,{id:10,name:'Fund A'},true));
    f.DB.prepare=prepare;
    const batch=f.DB.batch.bind(f.DB);f.DB.batch=async(stmts:any[])=>{const result=await batch(stmts);return result.map((r:any)=>({...r,success:false}));};
    await assert.rejects(()=>postLedgerEntry(f.env,{id:2,role:'investor'},10,1,entry));
  }finally{f.db.close();}
});
