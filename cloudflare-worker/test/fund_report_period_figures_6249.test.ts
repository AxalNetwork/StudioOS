// D6249 (#6249): GET /api/funds/:id/report-periods/:periodId returns an issued
// period's frozen figures, its issuer's display name and the period that
// corrects it. A draft reads as it did under D631.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {SignJWT} from 'jose';
import {makeD1} from './_d1_sqlite.mjs';
import {tableFromBaseline,stripForeignKeys} from './_baseline.mjs';
import funds from '../src/routes/funds.ts';
const baseline=readFileSync(new URL('../sql/schema_baseline.sql',import.meta.url),'utf8');
const tables=['users','vc_funds','limited_partners','portfolio_positions','legal_documents','fund_report_periods','activity_logs','user_company_links','capital_calls','fund_distributions','projects'];
const schema=tables.map(t=>stripForeignKeys(tableFromBaseline(baseline,t))).join('\n')
 +'CREATE UNIQUE INDEX periods_unique ON fund_report_periods(fund_id,period);CREATE TABLE IF NOT EXISTS company_profiles (id INTEGER PRIMARY KEY, archived_at TEXT);'
 +['312_fund_call_ledger.sql','417_fund_position_valuations.sql','418_fund_ledger.sql','472_entity_bank_accounts.sql','473_fund_management_fees.sql','474_mercury_entity_connections.sql','476_fund_report_drafts.sql','483_mercury_not_ours.sql'].map(m=>readFileSync(new URL('../sql/migrations/'+m,import.meta.url),'utf8')).join('\n');
const secret='d6249-local-fixture-signing-secret';
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
const draft={period:'Q2 2026',period_start:'2026-04-01',period_end:'2026-06-30',narrative:{letter:["The GP's letter."],developments:[],outlook:[],subsequent:[]}};
const D631_KEYS=['corrects_period_id','fund_id','id','issued_at','issued_by','narrative','period','period_end','period_start','revision','status','updated_at'];
const pack=(fundId=10)=>({schema:'lp_quarterly_report/1',fund:{id:fundId,name:'Fund A'},period:{label:'Q2 2026',start:'2026-04-01',end:'2026-06-30'},currency:'USD',lp_count:1,
 totals:{commitments:{cents:123456},called_to_date:{cents:5000}},books_closed:true,fund_figures:{nav:{cents:777700}},nav_basis:'Recorded basis',
 statements:[{uid:'lp-statement-uid',figures_sha256:'a'.repeat(64)}],unmatched_count:0});
/** A period issued through the reporting queue: its pack is issued and the period row carries the pack's figures as its snapshot. */
function issueThroughQueue(db:any,periodId:number,figures:any=pack(),fundId=10){
 const json=JSON.stringify(figures);
 db.prepare(`INSERT INTO fund_report_drafts(uid,kind,audience,subject_key,fund_id,report_period_id,period_label,period_start,period_end,status,figures_json,figures_sha256,prepared_by,prepared_at,issued_by,issued_at)
  VALUES(?,'lp_quarterly_report','fund_lps',?,?,?,'Q2 2026','2026-04-01','2026-06-30','issued',?,?,5,'2026-07-01',1,'2026-07-02')`).run(`pack-${periodId}-${fundId}`,`fund:${fundId}`,fundId,periodId,json,'b'.repeat(64));
 db.prepare("UPDATE fund_report_periods SET status='issued',issued_at='2026-07-02',issued_by=1,snapshot_json=? WHERE id=?").run(json,periodId);
}

test('GP-issued period: GP and LP read the whitelisted snapshot totals and the issuer display name; a draft reads as D631 did',async()=>{
 const f=await fixture();
 const saved=await f.request('/10/report-periods',GP,'POST',draft);const id=saved.body.period.id;
 const asDraft=await f.request(`/10/report-periods/${id}`,GP);
 assert.equal(asDraft.status,200);assert.deepEqual(Object.keys(asDraft.body.period).sort(),D631_KEYS);
 assert.equal((await f.request(`/10/report-periods/${id}`,LP)).status,404);
 await f.request('/10/report-periods',GP,'POST',{...draft,id,revision:saved.body.period.revision,issue:true});
 // D6870: a GP issue also freezes called, collected, NAV and the sector mix.
 const expected={source:'issue_snapshot',currency:'USD',totals:{committed_cents:123456,committed_reason:null,invested_cents:22222,invested_reason:null,
  called_cents:0,called_reason:null,collected_cents:0,collected_reason:null,
  nav_cents:null,nav_reason:'Not recorded: Every attributed position needs a dated valuation; no complete investment NAV is recorded.'},
  sector_mix:{basis:"Invested amount of the fund's positions at issue, by the sector recorded on each company.",items:[{sector:null,invested_cents:22222,position_count:1}]}};
 for(const user of [GP,LP]){
  const r=await f.request(`/10/report-periods/${id}`,user);
  assert.equal(r.status,200);
  assert.deepEqual(r.body.period.figures,expected);
  assert.deepEqual([r.body.period.figures_reason,r.body.period.issued_by_name,r.body.period.issued_by_name_reason,r.body.period.corrected_by_period_id],[null,'Grace Partner',null,null]);
  // The snapshot is the manager's page: none of its other fields leave, nor the issuer's email.
  assert.doesNotMatch(JSON.stringify(r.body.period),/can_manage|"periods"|gp-private|Recorded GP|user2@example|GP Account/);
 }
 assert.equal((await f.request(`/10/report-periods/${id}`,OTHER)).status,404);
 assert.equal((await f.request(`/20/report-periods/${id}`,OTHER)).status,404);
});

test('queue-issued period: admin and LP read the pack fund-level figures without the statements list; no pack for another fund leaks in',async()=>{
 const f=await fixture();
 const saved=await f.request('/10/report-periods',GP,'POST',draft);const id=saved.body.period.id;
 issueThroughQueue(f.db,id);
 const {statements:_statements,...fundLevel}=pack();
 for(const user of [ADMIN,LP]){
  const r=await f.request(`/10/report-periods/${id}`,user);
  assert.equal(r.status,200);
  assert.deepEqual(r.body.period.figures,{source:'report_pack',...fundLevel});
  assert.equal(r.body.period.issued_by_name,'Ada Admin');
  assert.doesNotMatch(JSON.stringify(r.body),/lp-statement-uid|statements/);
 }
 // A pack of fund 20 naming this period id is not this period's pack (two would read as Unreadable).
 f.db.prepare(`INSERT INTO fund_report_drafts(uid,kind,audience,subject_key,fund_id,report_period_id,period_label,period_start,period_end,status,figures_json,figures_sha256,prepared_by,prepared_at,issued_by,issued_at)
  VALUES('other-fund-pack','lp_quarterly_report','fund_lps','fund:20',20,?,'Q2 2026','2026-04-01','2026-06-30','issued',?,?,5,'2026-07-01',1,'2026-07-02')`).run(id,JSON.stringify(pack(20)),'c'.repeat(64));
 const r=await f.request(`/10/report-periods/${id}`,LP);
 assert.equal(r.status,200);assert.equal(r.body.period.figures.fund.id,10);
});

test('a failed pack query and a corrupt pack or snapshot are Unreadable, never empty figures or zeros',async()=>{
 const f=await fixture();
 const saved=await f.request('/10/report-periods',GP,'POST',draft);const id=saved.body.period.id;
 await f.request('/10/report-periods',GP,'POST',{...draft,id,revision:saved.body.period.revision,issue:true});
 const unreadable=async(label:string)=>{const r=await f.request(`/10/report-periods/${id}`,LP);assert.equal(r.status,503,label);assert.match(r.body.message,/Unreadable/,label);assert.equal(r.body.period,undefined,label);};
 const good=f.db.prepare('SELECT snapshot_json FROM fund_report_periods WHERE id=?').get(id).snapshot_json;
 const snap=JSON.parse(good);
 for(const [label,value] of [['truncated',good.slice(0,20)],['empty',''],['array','[]'],['no totals',JSON.stringify({...snap,totals:undefined})],
  ['text cents',JSON.stringify({...snap,totals:{...snap.totals,committed_cents:'123456'}})],['negative',JSON.stringify({...snap,totals:{...snap.totals,invested_cents:-1}})],
  ['null without reason',JSON.stringify({...snap,totals:{...snap.totals,invested_cents:null,invested_reason:null}})],
  ['orphaned pack snapshot',JSON.stringify(pack())]] as const){
  f.db.prepare('UPDATE fund_report_periods SET snapshot_json=? WHERE id=?').run(value,id);await unreadable(label);
 }
 // A recorded Not-recorded total passes through with its reason, not as zero.
 f.db.prepare('UPDATE fund_report_periods SET snapshot_json=? WHERE id=?').run(JSON.stringify({...snap,totals:{...snap.totals,invested_cents:null,invested_reason:'No complete invested amount is recorded for attributed positions.'}}),id);
 assert.deepEqual((await f.request(`/10/report-periods/${id}`,LP)).body.period.figures.totals.invested_cents,null);
 issueThroughQueue(f.db,id,{...pack(),schema:'something/2'});await unreadable('unknown pack schema');
 f.db.exec("DROP TRIGGER fund_report_drafts_block_figures;DROP TRIGGER fund_report_drafts_block_closed;UPDATE fund_report_drafts SET figures_json='{\"schema\":'");await unreadable('corrupt pack');
 // With a readable snapshot to fall back to, a failed pack query is still Unreadable: it is not "no pack".
 f.db.prepare('UPDATE fund_report_periods SET snapshot_json=? WHERE id=?').run(good,id);
 f.db.exec('DROP TABLE fund_report_drafts');await unreadable('pack query failed');
});

test('legacy issued period without a snapshot or issuer reads Not recorded with reasons',async()=>{
 const f=await fixture();
 f.db.exec(`INSERT INTO fund_report_periods(fund_id,period,period_start,period_end,notes,status,issued_at,issued_by)VALUES(10,'Legacy','2026-01-01','2026-03-31','{}','issued','2026-04-02',NULL),(10,'Gone','2026-01-01','2026-03-31','{}','issued','2026-04-02',99)`);
 const [legacy,gone]=f.db.prepare('SELECT id FROM fund_report_periods ORDER BY id').all().map((r:any)=>r.id);
 const r=(await f.request(`/10/report-periods/${legacy}`,LP)).body.period;
 assert.equal(r.figures,null);assert.match(r.figures_reason,/^Not recorded: no figures were frozen/);
 assert.equal(r.issued_by_name,null);assert.match(r.issued_by_name_reason,/^Not recorded: the issuing account was not recorded/);
 assert.match((await f.request(`/10/report-periods/${gone}`,LP)).body.period.issued_by_name_reason,/no longer exists/);
 f.db.exec(`UPDATE fund_report_periods SET issued_by=${LP} WHERE id=${legacy};UPDATE users SET name='  ' WHERE id=${LP}`);
 const unnamed=(await f.request(`/10/report-periods/${legacy}`,GP)).body.period;
 assert.deepEqual([unnamed.issued_by_name,unnamed.issued_by_name_reason],[null,'Not recorded: the issuing account has no name.']);
});

test('a corrected original names its issued correction; a draft correction does not count, and the correction itself is uncorrected',async()=>{
 const f=await fixture();
 const original=(await f.request('/10/report-periods',GP,'POST',{...draft,issue:true})).body.period.id;
 const correction=(await f.request('/10/report-periods',GP,'POST',{...draft,period:'Q2 2026 correction',corrects_period_id:original})).body.period;
 assert.equal((await f.request(`/10/report-periods/${original}`,LP)).body.period.corrected_by_period_id,null);
 await f.request('/10/report-periods',GP,'POST',{...draft,period:'Q2 2026 correction',corrects_period_id:original,id:correction.id,revision:correction.revision,issue:true});
 for(const user of [ADMIN,GP,LP])assert.equal((await f.request(`/10/report-periods/${original}`,user)).body.period.corrected_by_period_id,correction.id);
 const read=(await f.request(`/10/report-periods/${correction.id}`,LP)).body.period;
 assert.deepEqual([read.corrects_period_id,read.corrects_period,read.corrected_by_period_id],[original,'Q2 2026',null]);
 // A corrupt narrative elsewhere in the fund does not break the lookup.
 f.db.exec("INSERT INTO fund_report_periods(fund_id,period,period_start,period_end,notes,status)VALUES(10,'Broken','2026-01-01','2026-03-31','not json','issued')");
 assert.equal((await f.request(`/10/report-periods/${original}`,LP)).body.period.corrected_by_period_id,correction.id);
});
