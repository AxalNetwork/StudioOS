// D6870 (#6870): an issued period freezes called, collected, deployed, NAV and the sector mix
// the fund overview chart (IF0) and quarterly history (IF5) plot.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {SignJWT} from 'jose';
import {makeD1,d1Over} from './_d1_sqlite.mjs';
import {tableFromBaseline,stripForeignKeys} from './_baseline.mjs';
import funds from '../src/routes/funds.ts';
const baseline=readFileSync(new URL('../sql/schema_baseline.sql',import.meta.url),'utf8');
const tables=['users','vc_funds','limited_partners','portfolio_positions','legal_documents','fund_report_periods','activity_logs','user_company_links','capital_calls','fund_distributions','projects'];
const schema=tables.map(t=>stripForeignKeys(tableFromBaseline(baseline,t))).join('\n')
 +'CREATE UNIQUE INDEX periods_unique ON fund_report_periods(fund_id,period);CREATE TABLE IF NOT EXISTS company_profiles (id INTEGER PRIMARY KEY, archived_at TEXT);'
 +['312_fund_call_ledger.sql','417_fund_position_valuations.sql','418_fund_ledger.sql','472_entity_bank_accounts.sql','473_fund_management_fees.sql','474_mercury_entity_connections.sql','476_fund_report_drafts.sql','483_mercury_not_ours.sql'].map(m=>readFileSync(new URL('../sql/migrations/'+m,import.meta.url),'utf8')).join('\n');
const secret='d6870-local-fixture-signing-secret';
const ADMIN=1,GP=2,LP=3,OTHER=4;
async function fixture(){
 const {DB,db}=makeD1(schema);
 const insert=db.prepare("INSERT INTO users(id,name,display_name,email,role,investor_tier,investor_subscription_status) VALUES(?,?,?,?,?,?,'active')");
 for(const [id,name,display,role,tier]of [[ADMIN,'Admin Account','Ada Admin','admin','free'],[GP,'GP Account','Grace Partner','investor','institutional'],[LP,'LP Account',null,'investor','free'],[OTHER,'Other','Other GP','investor','institutional'],[5,'Preparer',null,'admin','free']])insert.run(id,name,display,`user${id}@example.test`,role,tier);
 db.exec(`INSERT INTO vc_funds(id,name,gp_user_id,gp_name,gp_email,fund_size_cents,status) VALUES(10,'Fund A',2,'Recorded GP','gp-private@example.test',100000000,'investing'),(20,'Fund B',4,'Other GP',NULL,99999999,'investing');
 INSERT INTO limited_partners(fund_id,user_id,email,commitment_amount,invested_amount) VALUES(10,3,'user3@example.test',1234.56,100),(20,4,'user4@example.test',999999,888888);
 INSERT INTO portfolio_positions(uid,project_id,round_name,fund_id,invested_amount) VALUES('own-position',1,'Seed',10,222.22);`);
 const env={DB,JWT_SECRET:secret,ENVIRONMENT:'development'} as any;
 async function request(path:string,user=GP,method='GET',body?:any){
  const headers:Record<string,string>={'Content-Type':'application/json',Authorization:`Bearer ${await new SignJWT({user_id:user}).setProtectedHeader({alg:'HS256'}).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(secret))}`};
  const response=await funds.request(path,{method,headers,...(body===undefined?{}:{body:JSON.stringify(body)})},env);
  return {status:response.status,body:await response.json() as any};
 }
 return {db,request};
}

import {deployedAndSectors} from '../src/services/fundSnapshotFigures.ts';
import {reportFigures} from '../src/services/fundReportBuild.ts';
const draft={period:'Q2 2026',period_start:'2026-04-01',period_end:'2026-06-30',narrative:{letter:["The GP's letter."],developments:[],outlook:[],subsequent:[]}};
const BASIS="Invested amount of the fund's positions at issue, by the sector recorded on each company.";
/** Fund 10's money: two LPs' call lines either side of the period end, receipts either side, positions in three sectors. */
function seedMoney(db:any){
 db.exec(`INSERT INTO limited_partners(id,fund_id,user_id,email,commitment_amount) VALUES(11,10,NULL,'lp-b@example.test',500);
 INSERT INTO projects(id,name,sector) VALUES(1,'Own Co',NULL),(2,'Fintech Co','Fintech'),(3,'Health Co','Health'),(4,'Blank Co','  ');
 INSERT INTO portfolio_positions(uid,project_id,round_name,fund_id,invested_amount) VALUES('fin-1',2,'Seed',10,100),('fin-2',2,'A',10,50.5),('health',3,'Seed',10,200),('blank',4,'Seed',10,1),('other-fund',3,'Seed',20,9999);
 INSERT INTO capital_calls(id,limited_partner_id,amount_cents,amount,created_at) VALUES(1,1,30000,300,'2026-05-01 10:00:00'),(2,11,NULL,12.34,'2026-06-30 23:59:59'),(3,1,70000,700,'2026-07-01 00:00:00'),(4,2,88800,888,'2026-05-01');`);
 db.exec(`INSERT INTO capital_call_receipts(uid,capital_call_id,limited_partner_id,fund_id,amount_cents,received_on,recorded_by) VALUES
  ('r1',1,1,10,25000,'2026-06-30',2),('r2',2,11,10,1234,'2026-07-01',2),('r3',1,1,20,99999,'2026-05-01',2);`);
}
async function issue(f:any){
 const saved=await f.request('/10/report-periods',GP,'POST',draft);
 const issued=await f.request('/10/report-periods',GP,'POST',{...draft,id:saved.body.period.id,revision:saved.body.period.revision,issue:true});
 assert.equal(issued.status,200,JSON.stringify(issued.body));
 return saved.body.period.id;
}

test('D6870: a GP issue freezes called and collected to the period end, deployed, NAV and the sector mix',async()=>{
 const f=await fixture();seedMoney(f.db);
 const id=await issue(f);
 const r=await f.request(`/10/report-periods/${id}`,LP);
 assert.equal(r.status,200);
 const t=r.body.period.figures.totals;
 // Lines dated on or before 30 June (the last second counts; 1 July does not); amount_cents first, else dollars.
 assert.equal(t.called_cents,30000+1234);assert.equal(t.called_reason,null);
 // Receipts of this fund received on or before 30 June; another fund's receipt is not this fund's.
 assert.equal(t.collected_cents,25000);assert.equal(t.collected_reason,null);
 // Deployed stays invested_cents: the positions' invested amount, as before.
 assert.equal(t.invested_cents,22222+10000+5050+20000+100);
 // No dated valuation: NAV is not recorded, with the pack's own reason, never 0.
 assert.equal(t.nav_cents,null);assert.match(t.nav_reason,/^Not recorded: /);
 assert.deepEqual(r.body.period.figures.sector_mix,{basis:BASIS,items:[
  {sector:'Health',invested_cents:20000,position_count:1},
  {sector:'Fintech',invested_cents:15050,position_count:2},
  {sector:null,invested_cents:22222+100,position_count:2},
 ]});
 const sum=r.body.period.figures.sector_mix.items.reduce((s:number,i:any)=>s+i.invested_cents,0);
 assert.equal(sum,t.invested_cents);
});

test('D6870: issued figures are frozen; money recorded after issue moves the next period, not this one',async()=>{
 const f=await fixture();seedMoney(f.db);
 const id=await issue(f);
 const before=(await f.request(`/10/report-periods/${id}`,GP)).body.period.figures;
 f.db.exec(`INSERT INTO capital_calls(id,limited_partner_id,amount_cents,amount,created_at) VALUES(9,1,4400,44,'2026-06-01');
  INSERT INTO capital_call_receipts(uid,capital_call_id,limited_partner_id,fund_id,amount_cents,received_on,recorded_by) VALUES('late',9,1,10,4400,'2026-06-02',2);
  INSERT INTO portfolio_positions(uid,project_id,round_name,fund_id,invested_amount) VALUES('late-pos',2,'B',10,1000);`);
 assert.deepEqual((await f.request(`/10/report-periods/${id}`,GP)).body.period.figures,before);
});

test('D6870: a snapshot issued before this change keeps what it holds: no called, collected, NAV or sector mix, never zeros',async()=>{
 const f=await fixture();
 const saved=await f.request('/10/report-periods',GP,'POST',draft);const id=saved.body.period.id;
 f.db.prepare("UPDATE fund_report_periods SET status='issued',issued_at='2026-07-02',issued_by=2,snapshot_json=? WHERE id=?")
  .run(JSON.stringify({currency:'USD',totals:{committed_cents:5,committed_reason:null,invested_cents:null,invested_reason:'No complete invested amount is recorded for attributed positions.'}}),id);
 const r=await f.request(`/10/report-periods/${id}`,GP);
 assert.equal(r.status,200);
 assert.deepEqual(r.body.period.figures,{source:'issue_snapshot',currency:'USD',totals:{committed_cents:5,committed_reason:null,invested_cents:null,invested_reason:'No complete invested amount is recorded for attributed positions.'}});
});

test('D6870: a corrupt frozen figure or sector row is Unreadable, never a zero',async()=>{
 for(const bad of [
  {called_cents:-1,called_reason:null},{collected_cents:1.5,collected_reason:null},{nav_cents:null,nav_reason:null},{nav_cents:null,nav_reason:7},
 ]){
  const f=await fixture();
  const saved=await f.request('/10/report-periods',GP,'POST',draft);const id=saved.body.period.id;
  f.db.prepare("UPDATE fund_report_periods SET status='issued',issued_at='2026-07-02',issued_by=2,snapshot_json=? WHERE id=?")
   .run(JSON.stringify({currency:'USD',totals:{committed_cents:5,committed_reason:null,invested_cents:5,invested_reason:null,...bad}}),id);
  assert.equal((await f.request(`/10/report-periods/${id}`,GP)).status,503,JSON.stringify(bad));
 }
 for(const mix of [null,{basis:'b'},{basis:'b',items:[{sector:3,invested_cents:1,position_count:1}]},{basis:'b',items:[{sector:'X',invested_cents:-1,position_count:1}]},{basis:'b',items:[{sector:'X',invested_cents:1,position_count:0}]}]){
  const f=await fixture();
  const saved=await f.request('/10/report-periods',GP,'POST',draft);const id=saved.body.period.id;
  f.db.prepare("UPDATE fund_report_periods SET status='issued',issued_at='2026-07-02',issued_by=2,snapshot_json=? WHERE id=?")
   .run(JSON.stringify({currency:'USD',totals:{committed_cents:5,committed_reason:null,invested_cents:5,invested_reason:null},sector_mix:mix}),id);
  assert.equal((await f.request(`/10/report-periods/${id}`,GP)).status,503,JSON.stringify(mix));
 }
});

test('D6870: a fund with no positions deploys nothing with a reason and an empty sector mix',async()=>{
 const f=await fixture();
 f.db.exec('DELETE FROM portfolio_positions');
 assert.deepEqual(await deployedAndSectors({DB:d1Over(f.db)} as any,10),{deployed:{cents:null,reason:'No positions are attributed to this fund.'},sector_mix:{basis:BASIS,items:[]}});
 const id=await issue(f);
 const r=await f.request(`/10/report-periods/${id}`,GP);
 assert.equal(r.body.period.figures.totals.invested_cents,null);
 assert.deepEqual(r.body.period.figures.sector_mix,{basis:BASIS,items:[]});
});

test('D6870: the pack carries deployed beside its totals and the sector mix; without them it is as before',()=>{
 const p={label:'Q2 2026',start:'2026-04-01',end:'2026-06-30'};
 const figures:any={books_closed:false,expenses:{cents:null,reason:'r'},management_fee:{cents:null,reason:'r'},investment_value:{cents:1},cash:{cents:2},liabilities:{cents:3},nav:{cents:0},fee_lines:null};
 const mix={basis:BASIS,items:[{sector:'Fintech',invested_cents:9,position_count:1}]};
 const withIssued:any=reportFigures({id:10,name:'Fund A'},p,1,{commitments:5,called_to_date:4,receipts_to_date:3},figures,[],0,{deployed:{cents:9},sector_mix:mix});
 assert.deepEqual(withIssued.totals,{commitments:{cents:5},called_to_date:{cents:4},receipts_to_date:{cents:3},deployed:{cents:9}});
 assert.deepEqual(withIssued.sector_mix,mix);
 const none:any=reportFigures({id:10,name:'Fund A'},p,1,{commitments:5},figures,[],0,{deployed:{cents:null,reason:'No positions are attributed to this fund.'},sector_mix:{basis:BASIS,items:[]}});
 assert.deepEqual(none.totals.deployed,{cents:null,reason:'No positions are attributed to this fund.'});
 const before:any=reportFigures({id:10,name:'Fund A'},p,1,{commitments:5},figures,[],0);
 assert.equal('deployed' in before.totals,false);assert.equal('sector_mix' in before,false);
});
