import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {SignJWT} from 'jose';
import {makeD1} from './_d1_sqlite.mjs';
import {tableFromBaseline,stripForeignKeys} from './_baseline.mjs';
import funds from '../src/routes/funds.ts';
import {FundReportRefusal,reportId} from '../src/services/fundReports.ts';
import {sendFundReportNotices} from '../src/services/fundReportNotices.ts';
const baseline=readFileSync(new URL('../sql/schema_baseline.sql',import.meta.url),'utf8');
const tables=['users','vc_funds','limited_partners','portfolio_positions','legal_documents','fund_report_periods','activity_logs','user_company_links','capital_calls','fund_distributions','projects','notifications_inbox'];
const schema=tables.map(t=>stripForeignKeys(tableFromBaseline(baseline,t))).join('\n')+`CREATE UNIQUE INDEX periods_unique ON fund_report_periods(fund_id,period);CREATE TABLE IF NOT EXISTS company_profiles (id INTEGER PRIMARY KEY, archived_at TEXT);` // D1137: migration 597's archive flag
 +['312_fund_call_ledger.sql','417_fund_position_valuations.sql','418_fund_ledger.sql','472_entity_bank_accounts.sql','473_fund_management_fees.sql','474_mercury_entity_connections.sql','476_fund_report_drafts.sql','483_mercury_not_ours.sql'].map(m=>readFileSync(new URL('../sql/migrations/'+m,import.meta.url),'utf8')).join('\n'); // D6249: an issued period's read looks up its pack
const secret='d631-local-fixture-signing-secret';
async function fixture(){
 const migration=['202611151259_6255_fund_report_notice_delivery.sql','202611270442_6240_fund_report_lp_delivery.sql'].map(m=>readFileSync(new URL('../sql/migrations/'+m,import.meta.url),'utf8')).join('\n');
 const {DB,db}=makeD1(schema+migration);
 const insert=db.prepare("INSERT INTO users(id,name,email,role,investor_tier,investor_subscription_status) VALUES(?,?,?,?,?,'active')");
 for(const [id,name,role,tier]of [[1,'Admin','admin','free'],[2,'GP','investor','institutional'],[3,'LP','investor','free'],[4,'Other','investor','institutional'],[5,'Founder','founder','free'],[6,'Legacy','investor','free']])insert.run(id,name,`${name}@example.test`,role,tier);
 db.exec(`INSERT INTO vc_funds(id,name,gp_user_id,gp_name,gp_entity,fund_size_cents,fund_admin,status) VALUES
  (10,'Fund A',2,'Recorded GP','GP entity',100000000,'Recorded administrator','investing'),(20,'Fund B',4,'Other GP','Other entity',99999999,NULL,'investing');
 INSERT INTO limited_partners(fund_id,user_id,email,commitment_amount,invested_amount) VALUES(10,3,'LP@example.test',1234.56,100),(20,4,'Other@example.test',999999,888888),(10,NULL,'LEGACY@example.test',765.44,100);
 INSERT INTO portfolio_positions(uid,project_id,round_name,fund_id,invested_amount) VALUES('own-position',1,'Seed',10,222.22),('other-position',2,'Seed',20,999999);`);
 const env={DB,JWT_SECRET:secret,ENVIRONMENT:'development'} as any;
 async function request(path:string,user=2,method='GET',body?:any,extra:Record<string,string>={}){
  const headers:Record<string,string>={'Content-Type':'application/json',...extra};
  if(user)headers.Authorization=`Bearer ${await new SignJWT({user_id:user}).setProtectedHeader({alg:'HS256'}).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(secret))}`;
  const response=await funds.request(path,{method,headers,...(body===undefined?{}:{body:JSON.stringify(body)})},env);
  return {status:response.status,body:await response.json() as any};
 }
 return {DB,db,env,request};
}
const draft={period:'Q2 2026',period_start:'2026-04-01',period_end:'2026-06-30',narrative:{letter:["The GP's letter."],developments:[{date:'2026-05-12',title:'Milestone',body:'Recorded development.'}],outlook:['Next quarter.'],subsequent:[{d:'2026-07-08',e:'Recorded later event.'}]}};
const receipts=(db:any)=>db.prepare("SELECT action,actor,user_id FROM activity_logs WHERE action LIKE 'fund_report_%' ORDER BY id").all().map((r:any)=>({...r}));
test('D631 exact identifiers and business sentences cannot carry raw internal text',()=>{
 for(const value of ['0','-1','1x','1.0','9007199254740992',1,null])assert.equal(reportId(value),null);
 assert.equal(reportId('10'),10);
 assert.equal(new FundReportRefusal('SQLITE private internals' as any).publicMessage,'The report request could not be recorded.');
});
test('fund page counts LPs live, reads attributed investments, whitelist facts and no invented provider',async()=>{
 const f=await fixture();f.db.exec('UPDATE vc_funds SET lp_count=999,total_commitment=888888,deployed_capital=777777 WHERE id=10');
 const r=await f.request('/10/page');assert.equal(r.status,200);
 assert.deepEqual([r.body.fund.name,r.body.fund.lp_count,r.body.totals.committed_cents,r.body.totals.invested_cents,r.body.fund.size_cents],[ 'Fund A',2,200000,22222,100000000]);
 assert.deepEqual(r.body.fund.gp,{name:'Recorded GP',title:null,entity:'GP entity',email:null});
 assert.deepEqual(r.body.fund.providers,{fund_admin:'Recorded administrator',auditor:null,legal_counsel:null,custodian:null,valuation_policy:null});
 assert.deepEqual([r.body.lpa,r.body.can_manage,r.body.currency],[null,true,'USD']);
 assert.equal('management_fee' in r.body.fund,false);
 f.db.exec("INSERT INTO limited_partners(fund_id,user_id,commitment_amount)VALUES(10,3,10)");
 assert.equal((await f.request('/10/page')).body.fund.lp_count,3);
 f.db.exec("INSERT INTO legal_documents(id,deal_id,type,status,version,content,updated_at)VALUES(8,1,'LPA','signed',3,'Private agreement body','2026-07-01');UPDATE vc_funds SET lpa_doc_id=8 WHERE id=10");
 assert.deepEqual((await f.request('/10/page',3)).body.lpa,{status:'signed',version:3,updated_at:'2026-07-01'});
});
test('fund-page GP capability respects active company and tier while an LP membership remains a read',async()=>{
 const f=await fixture();f.db.exec("UPDATE vc_funds SET company_id=21 WHERE id=10;INSERT INTO user_company_links(uid,user_id,company_id)VALUES('gp-a',2,21),('gp-b',2,22),('lp-b',3,22)");
 const statuses=[];for(const [actor,company]of [[2,21],[2,22],[1,22],[3,22]])statuses.push((await f.request('/10/page',actor,'GET',undefined,{'X-Company-Id':String(company)})).status);
 assert.deepEqual(statuses,[200,404,200,200]);assert.equal((await f.request('/10/page',3,'GET',undefined,{'X-Company-Id':'22'})).body.can_manage,false);
 f.db.exec("UPDATE users SET investor_tier='free' WHERE id=2");assert.equal((await f.request('/10/page')).status,402);
});
test('LP reads only own fund, legacy membership does not override a bound other owner, founders/anonymous refused',async()=>{
 const f=await fixture();const statuses=[];
 for(const [path,user]of [['/10/page',3],['/20/page',3],['/10/page',4],['/10/page',5],['/10/page',0],['/10x/page',2],['/10/page',6]]){const r=await f.request(path as string,user as number);statuses.push(r.status);if(user===3&&path==='/10/page')assert.equal(r.body.can_manage,false);}
 assert.deepEqual(statuses,[200,404,404,404,401,404,200]);
 f.db.exec("UPDATE limited_partners SET user_id=4 WHERE email='LEGACY@example.test'");assert.equal((await f.request('/10/page',6)).status,404);
 f.db.exec("INSERT INTO limited_partners(fund_id,user_id,commitment_amount)VALUES(10,5,0)");assert.equal((await f.request('/10/page',5)).status,404);
});
test('missing fund values stay null, no positions is not zero, failed reads are Unreadable',async()=>{
 const f=await fixture();f.db.exec('DELETE FROM portfolio_positions WHERE fund_id=10;DELETE FROM limited_partners WHERE fund_id=10;UPDATE vc_funds SET fund_size_cents=0 WHERE id=10');
 const r=await f.request('/10/page');assert.deepEqual([r.body.fund.size_cents,r.body.fund.lp_count,r.body.totals.committed_cents,r.body.totals.invested_cents],[null,0,0,null]);assert.match(r.body.totals.invested_reason,/No complete invested amount/);
 f.db.exec('DROP TABLE portfolio_positions');const failed=await f.request('/10/page');assert.equal(failed.status,503);assert.match(failed.body.message,/Unreadable/);assert.doesNotMatch(JSON.stringify(failed.body),/no such table/);
});
test('save/issue audit actors, exact narrative and server snapshot; issued period refuses every edit and LP cannot draft',async()=>{
 const f=await fixture();const saved=await f.request('/10/report-periods',2,'POST',draft);assert.equal(saved.status,201);
 assert.deepEqual(saved.body.period.narrative,draft.narrative);assert.equal(saved.body.period.status,'draft');assert.equal(saved.body.period.corrects_period_id,null);assert.equal(typeof saved.body.period.revision,'string');
 assert.deepEqual([saved.body.period.period,saved.body.period.period_start,saved.body.period.period_end],[draft.period,draft.period_start,draft.period_end]);
 const id=saved.body.period.id;
 assert.deepEqual((await f.request('/10/page',3)).body.periods,[]);
 assert.deepEqual((await f.request('/10/page',2)).body.periods.map((p:any)=>[p.id,p.status]),[[id,'draft']]);
 assert.deepEqual([(await f.request(`/10/report-periods/${id}`,3)).status,(await f.request(`/20/report-periods/${id}`,4)).status],[404,404]);
 assert.equal((await f.request('/10/report-periods',3,'POST',draft)).status,402);
 assert.equal((await f.request('/10/report-periods',4,'POST',draft)).status,404);
 // D712 decision 6: an admin issues only through the reporting queue, and its refusal writes nothing; an admin's draft save still succeeds.
 const before=receipts(f.db);
 const byAdmin=await f.request('/10/report-periods',1,'POST',{...draft,id,revision:saved.body.period.revision,issue:true});
 assert.deepEqual([byAdmin.status,byAdmin.body.error],[409,'issue_from_reporting_queue']);
 assert.deepEqual([f.db.prepare('SELECT status FROM fund_report_periods WHERE id=?').get(id).status,receipts(f.db)],['draft',before]);
 const adminSave=await f.request('/10/report-periods',1,'POST',{...draft,id,revision:saved.body.period.revision});assert.equal(adminSave.status,200);
 const issued=await f.request('/10/report-periods',2,'POST',{...draft,id,revision:adminSave.body.period.revision,issue:true,snapshot:{invented:999999}});
 assert.deepEqual([issued.status,issued.body.period.status,issued.body.period.issued_by],[200,'issued',2]);assert.ok(issued.body.period.issued_at);
 const snapshot=JSON.parse(f.db.prepare('SELECT snapshot_json FROM fund_report_periods WHERE id=?').get(id).snapshot_json);assert.equal(snapshot.totals?.invested_cents,22222);assert.equal(snapshot.invented,undefined);
 assert.deepEqual((await f.request(`/10/report-periods/${id}`,3)).body.period.narrative,draft.narrative);
 assert.deepEqual((await f.request('/10/page',3)).body.periods.map((p:any)=>[p.id,p.status]),[[id,'issued']]);
 const refused=await f.request('/10/report-periods',2,'POST',{...draft,issue:false,narrative:{letter:['Changed']}});assert.equal(refused.status,409);assert.match(refused.body.message,/cannot be edited/);
 assert.deepEqual(receipts(f.db),[{action:'fund_report_draft_saved',actor:'2',user_id:2},{action:'fund_report_draft_saved',actor:'1',user_id:1},{action:'fund_report_period_issued',actor:'2',user_id:2}]);
});
test('correction lineage only points to this fund issued report and cannot be erased',async()=>{
 const f=await fixture();const original=await f.request('/10/report-periods',2,'POST',{...draft,issue:true});const id=original.body.period.id;
 const corrected=await f.request('/10/report-periods',2,'POST',{...draft,period:'Q2 2026 correction',corrects_period_id:id});assert.equal(corrected.status,201);assert.equal(corrected.body.period.corrects_period_id,id);
 const read=await f.request(`/10/report-periods/${corrected.body.period.id}`);assert.equal(read.body.period.corrects_period,'Q2 2026');
 const statuses=[];for(const body of [{...draft,period:'Bad',corrects_period_id:corrected.body.period.id},{...draft,period:'Cross fund',corrects_period_id:id}])statuses.push((await f.request(body.period==='Cross fund'?'/20/report-periods':'/10/report-periods',body.period==='Cross fund'?4:2,'POST',body)).status);
 statuses.push((await f.request('/10/report-periods',2,'POST',{...draft,period:'Q2 2026 correction',corrects_period_id:null})).status);assert.deepEqual(statuses,[400,400,400]);
 assert.equal((await f.request(`/10/report-periods/${id}`)).body.period.status,'issued');
});
test('validation and stale revisions refuse without altering content or audit',async()=>{
 const f=await fixture();const saved=await f.request('/10/report-periods',2,'POST',draft);const before=receipts(f.db);
 const statuses=[];for(const body of [{...draft,period:''},{...draft,period_start:'2026-01-01',period_end:'2026-02-30'},{...draft,period_end:'2026-13-01'},{...draft,period_end:'2026-03-31'},{...draft,narrative:{letter:['x'.repeat(10001)]}},{...draft,narrative:{developments:[{date:'bad',title:'A',body:'B'}]}},{...draft,narrative:{subsequent:[{d:'2026-07-01',e:4}]}},{...draft,issue:'yes'},{...draft,id:999},{...draft,revision:'stale'}])statuses.push((await f.request('/10/report-periods',2,'POST',body)).status);
 assert.deepEqual(statuses,[400,400,400,400,400,400,400,400,409,409]);assert.deepEqual(receipts(f.db),before);assert.deepEqual((await f.request(`/10/report-periods/${saved.body.period.id}`)).body.period.narrative,draft.narrative);
});
test('atomic audit failure rolls back save and issue; concurrent issue and save cannot rewrite issued content',async()=>{
 const f=await fixture();f.db.exec("CREATE TRIGGER reject_report_audit BEFORE INSERT ON activity_logs WHEN NEW.action LIKE 'fund_report_%' BEGIN SELECT RAISE(ABORT,'audit fixture failure'); END;");
 assert.equal((await f.request('/10/report-periods',2,'POST',draft)).status,503);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM fund_report_periods').get().n,0);
 f.db.exec('DROP TRIGGER reject_report_audit');const saved=await f.request('/10/report-periods',2,'POST',draft);
 f.db.exec("CREATE TRIGGER reject_issue_audit BEFORE INSERT ON activity_logs WHEN NEW.action='fund_report_period_issued' BEGIN SELECT RAISE(ABORT,'audit fixture failure'); END;");
 assert.equal((await f.request('/10/report-periods',2,'POST',{...draft,id:saved.body.period.id,revision:saved.body.period.revision,issue:true})).status,503);
 assert.deepEqual([f.db.prepare('SELECT status,issued_at,snapshot_json FROM fund_report_periods').get().status,receipts(f.db).length],['draft',1]);
 assert.equal(f.db.prepare('SELECT issued_at FROM fund_report_periods').get().issued_at,null);assert.equal(f.db.prepare('SELECT snapshot_json FROM fund_report_periods').get().snapshot_json,null);
 f.db.exec('DROP TRIGGER reject_issue_audit');
 // Hold the stale draft immediately before its batch, then issue against the
 // same revision. The late draft must not change the now-issued row.
 const originalBatch=f.DB.batch.bind(f.DB);let release:any,arrived:any,hold=true;
 const atBatch=new Promise(resolve=>{arrived=resolve;});const gate=new Promise(resolve=>{release=resolve;});
 f.DB.batch=async(stmts:any)=>{if(hold){hold=false;arrived();await gate;}return originalBatch(stmts);};
 const stale=f.request('/10/report-periods',2,'POST',{...draft,id:saved.body.period.id,revision:saved.body.period.revision,narrative:{letter:['Racing draft']}});
 await atBatch;const issued=await f.request('/10/report-periods',2,'POST',{...draft,id:saved.body.period.id,revision:saved.body.period.revision,issue:true});release();const results=[issued,await stale];
 assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);const row=f.db.prepare('SELECT status,notes FROM fund_report_periods').get();assert.equal(row.status,'issued');assert.deepEqual(JSON.parse(row.notes).letter,draft.narrative.letter);assert.equal(receipts(f.db).length,2);
});
test('failed report reads and corrupt recorded narrative are Unreadable, not empty or validation refusals',async()=>{
 const f=await fixture();const saved=await f.request('/10/report-periods',2,'POST',draft);const id=saved.body.period.id;
 f.db.prepare('UPDATE fund_report_periods SET notes=? WHERE id=?').run(JSON.stringify({letter:[4]}),id);
 const corrupt=await f.request(`/10/report-periods/${id}`);assert.equal(corrupt.status,503);assert.match(corrupt.body.message,/Unreadable/);
 f.db.exec('DROP TABLE fund_report_periods');
 for(const path of ['/10/page','/10/report-periods',`/10/report-periods/${id}`]){const result=await f.request(path);assert.equal(result.status,503);assert.match(result.body.message,/Unreadable/);assert.equal(result.body.items,undefined);}
});
test('legacy unset report dates stay unset instead of invented dates',async()=>{
 const f=await fixture();f.db.exec("INSERT INTO fund_report_periods(fund_id,period,period_start,period_end,notes)VALUES(10,'Legacy','','','{}')");
 const id=f.db.prepare('SELECT id FROM fund_report_periods').get().id;const result=await f.request(`/10/report-periods/${id}`);
 assert.equal(result.status,200);assert.deepEqual([result.body.period.period_start,result.body.period.period_end],['','']);
 assert.deepEqual(result.body.period.narrative,{letter:[],developments:[],outlook:[],subsequent:[]});
});

test('draft deletion requires the matching GP and revision, refuses linked packs and issued periods, and audits once', async () => {
 const f = await fixture();
 for (const migration of ['476_fund_report_drafts.sql', '522_mercury_investor_feeds.sql']) {
  f.db.exec(readFileSync(new URL('../sql/migrations/'+migration,import.meta.url),'utf8'));
 }
 const { body: { period }} = await f.request('/10/report-periods', 2, 'POST', draft);
 const path = `/10/report-periods/${period.id}`;
 const del = (user: number, revision: string) => f.request(path, user, 'DELETE', { revision });
 assert.equal((await del(4, period.revision)).status, 404);
 assert.equal((await del(2, 'stale')).status, 409);
 f.db.prepare(`INSERT INTO mercury_investor_proposals(uid,user_id,integration_id,kind,external_id,mercury_id,target_kind,target_id,fund_id)
  VALUES('statement',2,1,'statement','ext','doc','fund_report_period',?,10)`).run(period.id);
 assert.match((await del(2, period.revision)).body.message, /linked bank statement/);
 f.db.exec("UPDATE mercury_investor_proposals SET state='dismissed'");
 const pack = await f.request('/10/report-periods', 2, 'POST', {...draft, period:'Pack draft'});
 f.db.prepare(`INSERT INTO fund_report_drafts(uid,kind,audience,subject_key,fund_id,report_period_id,period_label,period_start,period_end,status,figures_json,figures_sha256)
  VALUES('pack','lp_quarterly_report','fund_lps','fund:10',10,?,'Pack draft','2026-04-01','2026-06-30','superseded','{}',?)`).run(pack.body.period.id,'0'.repeat(64));
 const packed = await f.request('/10/report-periods/'+pack.body.period.id, 2, 'DELETE', { revision:pack.body.period.revision });
 assert.equal(packed.status,409);
 assert.match(packed.body.message, /linked to a reporting pack and cannot be deleted/);
 assert.equal((await del(2, period.revision)).status, 200);
 assert.equal((await del(2, period.revision)).status, 404);
 assert.deepEqual(receipts(f.db).filter((r: any) => r.action === 'fund_report_draft_deleted'),
  [{ action: 'fund_report_draft_deleted', actor: '2', user_id: 2 }]);
 const receipt = f.db.prepare("SELECT details FROM activity_logs WHERE action='fund_report_draft_deleted'").get();
 assert.deepEqual(JSON.parse(String(receipt?.details)), {
  fund_id:10, period_id:period.id, period:draft.period, corrects_period_id:null, revision:period.revision,
 });
 const issued = await f.request('/10/report-periods', 2, 'POST', {...draft, issue:true});
 assert.equal(issued.status, 201);
 assert.equal((await f.request(`/10/report-periods/${issued.body.period.id}`, 2, 'DELETE', { revision: issued.body.period.revision })).status, 409);
});


test('D6255: only a committed issue sends scoped, deduplicated in-app notices', async () => {
 const f=await fixture();
 f.db.exec("INSERT INTO limited_partners(fund_id,user_id) VALUES (10,3),(10,6)");
 f.db.exec("INSERT INTO limited_partners(fund_id,user_id,status) VALUES (10,4,'withdrawn')");
 const saved=await f.request('/10/report-periods',2,'POST',draft);
 const id=saved.body.period.id;
 await sendFundReportNotices(f.env,10,id);
 assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM notifications_inbox').get().n,0);
 const posted=await f.request('/10/report-periods',2,'POST',{...draft,issue:true});
 assert.equal(posted.status,200);
 assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM notifications_inbox').get().n,2,'the issue path publishes before a retry');
 await Promise.all([sendFundReportNotices(f.env,10,id),sendFundReportNotices(f.env,10,id)]);
 const notices=f.db.prepare('SELECT user_id,type,channel,link FROM notifications_inbox ORDER BY user_id').all().map(row=>({...row}));
 assert.deepEqual(notices,[3,6].map(user_id=>({user_id,type:'fund_report_issued',channel:'in_app',link:`/funds/10/reporting/${id}`})));
 const detail=(await f.request(`/10/report-periods/${id}`)).body.period;
 assert.deepEqual([detail.delivery_status,detail.delivered_count,detail.undelivered_count],['partial',2,1]);
 assert.ok(detail.lps_notified_at);
 const list=(await f.request('/10/report-periods')).body.items;
 assert.equal(list[0].lps_notified_at,detail.lps_notified_at);
 assert.equal((await f.request(`/10/report-periods/${id}`,3)).body.period.delivery_status,undefined);
 f.db.exec('DELETE FROM notifications_inbox');
 await sendFundReportNotices(f.env,10,id);
 assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM notifications_inbox').get().n,0,'dismissal must not reset the delivery receipt');
});

test('D6255: a failed inbox write rolls back fan-out and records the failure after issue', async () => {
 const f=await fixture();
 f.db.exec("INSERT INTO limited_partners(fund_id,user_id) VALUES (10,6)");
 f.db.exec("CREATE TRIGGER fail_notice BEFORE INSERT ON notifications_inbox WHEN NEW.user_id=6 BEGIN SELECT RAISE(ABORT,'test refusal'); END");
 const posted=await f.request('/10/report-periods',2,'POST',{...draft,issue:true});
 assert.equal(posted.status,201);
 assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM notifications_inbox').get().n,0);
 const id=posted.body.period.id;
 const detail=(await f.request(`/10/report-periods/${id}`)).body.period;
 assert.deepEqual([detail.status,detail.delivery_status,detail.lps_notified_at],['issued','failed',null]);
 assert.equal((await f.request('/10/report-periods')).body.items[0].delivery_status,'failed');
 f.db.exec('DROP TABLE fund_report_notice_delivery');
 const unreadable=await f.request(`/10/report-periods/${id}`);
 assert.deepEqual([unreadable.status,unreadable.body.period.delivery_status],[200,'unreadable']);
});

const lpRows=(db:any,period:number)=>db.prepare('SELECT lp_id,user_id,state,made_available_at IS NOT NULL AS available,opened_at IS NOT NULL AS opened FROM fund_report_lp_delivery WHERE period_id=? ORDER BY lp_id').all(period).map((r:any)=>({...r}));

test('D6240: issuing records one row per LP; counts and the per-LP list are for the GP only, and an LP opening is recorded once', async () => {
 const f=await fixture();
 // LP rows: 1 → user 3, 3 → no account (fixture); 4 → user 6, 5 → user 3 again, 6 → withdrawn, 7 → an inactive account.
 f.db.exec("INSERT INTO limited_partners(id,fund_id,user_id,name) VALUES (4,10,6,'Sample LP Six'),(5,10,3,NULL)");
 f.db.exec("INSERT INTO limited_partners(id,fund_id,user_id,status) VALUES (6,10,4,'withdrawn')");
 f.db.exec("INSERT INTO users(id,name,email,role,is_active) VALUES (7,'Inactive','inactive@example.test','investor',0);INSERT INTO limited_partners(id,fund_id,user_id) VALUES (7,10,7)");
 const posted=await f.request('/10/report-periods',2,'POST',{...draft,issue:true});
 assert.equal(posted.status,201);
 const id=posted.body.period.id;
 assert.deepEqual(lpRows(f.db,id),[
  {lp_id:1,user_id:3,state:'made_available',available:1,opened:0},
  {lp_id:3,user_id:null,state:'not_sent',available:0,opened:0},
  {lp_id:4,user_id:6,state:'made_available',available:1,opened:0},
  {lp_id:5,user_id:3,state:'made_available',available:1,opened:0},
  {lp_id:7,user_id:null,state:'not_sent',available:0,opened:0},
 ]);
 const counts=()=>f.request('/10/report-periods').then(r=>r.body.items[0].lp_delivery);
 assert.deepEqual(await counts(),{state:'recorded',delivered:3,total:5,opened:0,failed:0,no_account:2});
 // A retry with a complete receipt writes nothing.
 await sendFundReportNotices(f.env,10,id);
 assert.equal(lpRows(f.db,id).length,5);
 // The LP's read is served, then recorded on both of their rows; a second read keeps the first time.
 const read=await f.request(`/10/report-periods/${id}`,3);
 assert.equal(read.status,200);
 assert.equal(read.body.period.lp_deliveries,undefined,'an LP never receives the per-LP list');
 assert.equal(read.body.period.lp_delivery,undefined,'an LP never receives the counts');
 const first=f.db.prepare('SELECT opened_at FROM fund_report_lp_delivery WHERE period_id=? AND lp_id=1').get(id).opened_at;
 assert.ok(first);
 f.db.prepare("UPDATE fund_report_lp_delivery SET opened_at='2026-01-01T00:00:00.000Z' WHERE period_id=? AND lp_id IN (1,5)").run(id);
 await f.request(`/10/report-periods/${id}`,3);
 assert.deepEqual(lpRows(f.db,id).map((r:any)=>r.state),['opened','not_sent','made_available','opened','not_sent']);
 assert.equal(f.db.prepare('SELECT opened_at FROM fund_report_lp_delivery WHERE period_id=? AND lp_id=1').get(id).opened_at,'2026-01-01T00:00:00.000Z');
 // The GP's own read records no opening.
 const gp=(await f.request(`/10/report-periods/${id}`)).body.period;
 assert.deepEqual(await counts(),{state:'recorded',delivered:3,total:5,opened:2,failed:0,no_account:2});
 assert.deepEqual(gp.lp_delivery,await counts());
 assert.equal(gp.lp_deliveries_reason,null);
 assert.deepEqual(gp.lp_deliveries.map((r:any)=>[r.lp_id,r.name,r.state]),[
  [3,'LEGACY@example.test','not_sent'],[7,'Inactive','not_sent'],[4,'Sample LP Six','made_available'],[1,'LP','opened'],[5,'LP','opened']]);
 // Another fund's GP is refused by requireFundGp and reads no row.
 assert.equal((await f.request('/10/report-periods',4)).status,404);
});

test('D6240: a period issued before per-LP rows reads Not recorded, never 0 of m; an empty fund reads 0 of 0', async () => {
 const f=await fixture();
 const posted=await f.request('/10/report-periods',2,'POST',{...draft,issue:true});
 const id=posted.body.period.id;
 // Legacy: issued with a D6255 receipt and no per-LP rows (the receipt counted 1 LP and 1 without an account).
 f.db.prepare('DELETE FROM fund_report_lp_delivery WHERE period_id=?').run(id);
 const items=(await f.request('/10/report-periods')).body.items;
 assert.deepEqual(items[0].lp_delivery,{state:'not_recorded',delivered:null,total:null,opened:null,failed:null,no_account:null});
 const detail=(await f.request(`/10/report-periods/${id}`)).body.period;
 assert.equal(detail.lp_deliveries,null);
 assert.match(detail.lp_deliveries_reason,/^Not recorded: this period was issued before/);
 // Legacy before D6255 too: no receipt either.
 f.db.prepare('DELETE FROM fund_report_notice_delivery WHERE period_id=?').run(id);
 assert.equal((await f.request('/10/report-periods')).body.items[0].lp_delivery.state,'not_recorded');
 // A draft carries no counts.
 await f.request('/10/report-periods',2,'POST',{...draft,period:'Q3 2026',period_start:'2026-07-01',period_end:'2026-09-30'});
 assert.equal((await f.request('/10/report-periods')).body.items[0].lp_delivery,undefined);
 // A fund with no LP at issue: a complete receipt that counted nobody is 0 of 0.
 const g=await fixture();
 g.db.exec('DELETE FROM limited_partners WHERE fund_id=10');
 const empty=(await g.request('/10/report-periods',2,'POST',{...draft,issue:true})).body.period.id;
 assert.equal(lpRows(g.db,empty).length,0);
 assert.deepEqual((await g.request('/10/report-periods')).body.items[0].lp_delivery,{state:'recorded',delivered:0,total:0,opened:0,failed:0,no_account:0});
 // An unreadable per-LP table reads Unreadable, and the report stays readable.
 g.db.exec('DROP TABLE fund_report_lp_delivery');
 const unreadable=await g.request(`/10/report-periods/${empty}`);
 assert.equal(unreadable.status,200);
 assert.deepEqual([unreadable.body.period.lp_delivery.state,unreadable.body.period.lp_deliveries],['unreadable',null]);
 assert.match(unreadable.body.period.lp_deliveries_reason,/^Unreadable/);
 g.db.exec('INSERT INTO limited_partners(fund_id,user_id) VALUES (10,3)');
 assert.equal((await g.request(`/10/report-periods/${empty}`,3)).status,200,'an LP read survives a failed opening write');
});

test('D6240: a failed notice transaction records failed per LP, and a successful retry replaces those rows', async () => {
 const f=await fixture();
 f.db.exec("INSERT INTO limited_partners(id,fund_id,user_id) VALUES (4,10,6)");
 f.db.exec("CREATE TRIGGER fail_notice BEFORE INSERT ON notifications_inbox WHEN NEW.user_id=6 BEGIN SELECT RAISE(ABORT,'test refusal'); END");
 const id=(await f.request('/10/report-periods',2,'POST',{...draft,issue:true})).body.period.id;
 assert.deepEqual(lpRows(f.db,id).map((r:any)=>[r.lp_id,r.state]),[[1,'failed'],[3,'not_sent'],[4,'failed']]);
 assert.deepEqual((await f.request('/10/report-periods')).body.items[0].lp_delivery,{state:'recorded',delivered:0,total:3,opened:0,failed:2,no_account:1});
 // An LP reading the report does not turn a failed notice into an opening.
 await f.request(`/10/report-periods/${id}`,3);
 assert.equal(lpRows(f.db,id)[0].state,'failed');
 f.db.exec('DROP TRIGGER fail_notice');
 await sendFundReportNotices(f.env,10,id);
 assert.deepEqual(lpRows(f.db,id).map((r:any)=>[r.lp_id,r.state]),[[1,'made_available'],[3,'not_sent'],[4,'made_available']]);
 assert.deepEqual((await f.request('/10/report-periods')).body.items[0].lp_delivery,{state:'recorded',delivered:2,total:3,opened:0,failed:0,no_account:1});
});
