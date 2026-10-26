import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import router from '../src/routes/deal_views.ts';
import { computeThesisFit, readFitGeography, thesisRegion, type Thesis } from '../src/services/thesisFit.ts';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';
import { tableFromBaseline, splitStatements } from './_baseline.mjs';
import { d1Over } from './_d1_sqlite.mjs';

const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8');
const baseline = read('../sql/schema_baseline.sql');
const migration = read('../sql/migrations/619_deal_saved_views.sql');
const secret = 't'.repeat(64);
function world() {
  const db = new DatabaseSync(':memory:', {enableForeignKeyConstraints:false});
  for (const t of ['users','projects','deals','deal_invitations','commitments','investor_profiles','investor_seats','company_profiles','user_company_links','activity_logs','super_admins','mi_pro_subscriptions']) db.exec(tableFromBaseline(baseline,t));
  db.exec(read('../sql/migrations/599_deal_currency.sql'));
  db.exec(tableFromBaseline(read('../sql/migrations/443_grow_stores.sql'),'markets'));
  for(const sql of splitStatements(read('../sql/migrations/462_grow_record_stores.sql'))) if (/ALTER TABLE markets/i.test(sql)) db.exec(sql);
  db.exec(read('../sql/migrations/376_research_taxonomy.sql'));
  db.exec(migration); db.exec(migration);
  for(const [id,role,tier] of [[1,'investor','institutional'],[2,'investor','institutional'],[3,'investor','institutional'],[4,'admin','institutional'],[5,'investor','professional'],[6,'investor','free'],[7,'founder','institutional'],[8,'investor','institutional']]) {
    db.prepare("INSERT INTO users(id,name,email,role,is_active,investor_tier,investor_subscription_status,kyc_status) VALUES(?,?,?,?,1,?,'active','approved')")
      .run(id,`Synthetic ${id}`,`synthetic${id}@example.invalid`,role,tier);
  }
  db.exec(`INSERT INTO company_profiles(id,uid,company_name) VALUES(11,'firm-a','Synthetic A'),(22,'firm-b','Synthetic B');
    INSERT INTO user_company_links(uid,user_id,company_id) VALUES('a',1,11),('b',3,22),('c',5,11),('d',8,11);
    INSERT INTO investor_seats(primary_user_id,seat_email,seat_user_id,accepted_at) VALUES(1,'synthetic2@example.invalid',2,CURRENT_TIMESTAMP);
    UPDATE users SET investor_seat_primary_user_id=1 WHERE id=2;
    INSERT INTO projects(id,name,sector,stage,hq) VALUES(10,'Synthetic venture','Climate','Seed','Europe'),(20,'Other venture','Consumer','Growth','Europe');
    INSERT INTO deals(id,project_id,status,target_raise,minimum_check,currency) VALUES(1,10,'active',2000000,20000,'USD'),(2,20,'active',2000000,20000,'USD');
    INSERT INTO deal_invitations(deal_id,investor_user_id) VALUES(1,1),(1,2),(2,3);
    INSERT INTO investor_profiles(user_id,sectors_json,stages_json,geos_json,ticket_min_usd,ticket_max_usd)
      VALUES(1,'["Climate"]','["Seed"]','["Europe"]',10000,50000);
    INSERT INTO markets(uid,project_id,name,state,geography_ref) VALUES('market-a',10,'Synthetic market','served','PT');`);
  const env:any = {DB:d1Over(db),JWT_SECRET:secret,ENVIRONMENT:'development'};
  const app = new Hono<any>(); app.route('/api/deals',router);
  app.onError((e,c)=>c.json({error:AUTH_ERROR_STATUSES[e.message] ? e.message : 'Unexpected failure'},AUTH_ERROR_STATUSES[e.message] || 500));
  return {db,env,app};
}
type World=ReturnType<typeof world>;
async function call(w:World,who:number|null,method='GET',path='/api/deals/views',body?:unknown,headers:Record<string,string>={},claims:Record<string,unknown>={}) {
  const auth=who == null ? {} : {Authorization:`Bearer ${await new SignJWT({user_id:who,...claims}).setProtectedHeader({alg:'HS256'}).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(secret))}`};
  const response=await w.app.request(path,{method,headers:{'Content-Type':'application/json',...auth,...headers},...(body===undefined?{}:{body:JSON.stringify(body)})},w.env);
  return {status:response.status,cache:response.headers.get('Cache-Control'),body:await response.json().catch(()=>null)};
}
const create=(w:World,who=1,extra:Record<string,unknown>={})=>call(w,who,'POST','/api/deals/views',{name:'Synthetic view',spec:{version:1,scope:'mine',view:'table',filters:{sectors:['Climate']},columns:['team','fit'],weights:{team:20}},...extra});
const url=(uid:string,version?:number)=>`/api/deals/views/${uid}${version===undefined?'':`?version=${version}`}`;
const rows=(w:World)=>w.db.prepare('SELECT * FROM deal_saved_views ORDER BY id').all();
const audits=(w:World)=>w.db.prepare("SELECT * FROM activity_logs WHERE action LIKE 'deal_view_%' ORDER BY id").all();

test('migration is re-runnable, has no fit store, and enforces one owner default per firm context',()=>{
 const w=world();try {
  assert.equal(w.db.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE type='table' AND name LIKE '%thesis_fit%'").get()?.n,0);
  const cols=w.db.prepare('PRAGMA table_info(deal_saved_views)').all().map((r:any)=>r.name);
  for(const key of ['owner_user_id','firm_owner_user_id','company_id','name','shared_with_firm','is_default','spec_json','version']) assert.ok(cols.includes(key));
  assert.throws(()=>w.db.exec("INSERT INTO deal_saved_views(uid,owner_user_id,firm_owner_user_id,name,spec_json,mutation_uid) VALUES('bad',1,1,'Synthetic','[]','bad')"));
 }finally{w.db.close();}
});
test('private is author-only; shared is read by an accepted firm seat and never another firm or a same-company outsider',async()=>{
 const w=world();try {
  const privateView=await create(w);assert.equal(privateView.status,201,JSON.stringify(privateView.body));
  assert.equal(privateView.body.company_id,11);assert.equal(privateView.body.mine,true);assert.equal(privateView.body.shared_with_firm,false);
  assert.equal((await call(w,1)).body.items.length,1);assert.equal((await call(w,1)).cache,'no-store');
  for(const who of [2,3,8]) assert.deepEqual((await call(w,who)).body.items,[]);
  const shared=await create(w,1,{name:'Shared synthetic',shared_with_firm:true,is_default:true});assert.equal(shared.status,201);
  const colleague=await call(w,2);assert.equal(colleague.status,200);assert.equal(colleague.body.items.length,1);assert.equal(colleague.body.items[0].uid,shared.body.uid);
  assert.equal(colleague.body.items[0].mine,false);assert.equal(colleague.body.items[0].is_default,false);assert.equal(colleague.body.default_uid,null);
  for(const who of [3,8]) assert.deepEqual((await call(w,who)).body.items,[]);
  assert.doesNotMatch(JSON.stringify(colleague.body),/email|example\.invalid|mutation_uid|spec_json/);
  assert.equal((await call(w,2,'PATCH',url(shared.body.uid),{name:'Changed'})).status,404);
  assert.equal((await call(w,2,'DELETE',url(shared.body.uid))).status,404);
  assert.equal((await call(w,3,'PATCH',url(shared.body.uid),{shared_with_firm:true})).status,404);
 }finally{w.db.close();}
});
test('author can edit, unshare and delete; audit holds references and never the view name, filter text or weighting figures',async()=>{
 const w=world();try {
  const made=await create(w,1,{name:'PRIVATE VIEW',shared_with_firm:true,spec:{filters:{search:'PRIVATE FILTER',minimum:1234567}}});assert.equal(made.status,201);
  const changed=await call(w,1,'PATCH',url(made.body.uid),{version:made.body.version,name:'PRIVATE RENAMED',shared_with_firm:false,spec:{scope:'all',view:'board'}});
  assert.equal(changed.status,200);assert.equal(changed.body.version,2);assert.equal(changed.body.name,'PRIVATE RENAMED');assert.deepEqual(changed.body.spec,{scope:'all',view:'board'});
  assert.deepEqual((await call(w,2)).body.items,[]);
  const removed=await call(w,1,'DELETE',url(made.body.uid,changed.body.version));assert.equal(removed.status,200);assert.equal(rows(w).length,0);
  assert.deepEqual(audits(w).map((a:any)=>[a.action,a.user_id,a.entity_id]),[['deal_view_created',1,made.body.uid],['deal_view_updated',1,made.body.uid],['deal_view_deleted',1,made.body.uid]]);
  assert.doesNotMatch(JSON.stringify(audits(w)),/PRIVATE|1234567|example\.invalid/);
 }finally{w.db.close();}
});
test('defaults stay personal and atomic, and stale edits cannot clear another default or append an audit',async()=>{
 const w=world();try {
  const a=await create(w,1,{name:'First',is_default:true});const b=await create(w,1,{name:'Second',is_default:true});
  let list=await call(w,1);assert.equal(list.body.default_uid,b.body.uid);assert.equal(list.body.items.filter((v:any)=>v.is_default).length,1);
  assert.equal((await call(w,1,'PATCH',url(a.body.uid),{is_default:false,version:list.body.items.find((v:any)=>v.uid===a.body.uid).version})).status,200);
  const before=JSON.stringify(rows(w)),count=audits(w).length;
  assert.equal((await call(w,1,'PATCH',url(a.body.uid),{is_default:true,name:'Stale',version:1})).status,409);
  assert.equal(JSON.stringify(rows(w)),before);assert.equal(audits(w).length,count);
  const colleague=await create(w,2,{is_default:true});assert.equal(colleague.status,201);
  list=await call(w,1);assert.equal(list.body.default_uid,b.body.uid);
  assert.equal((await call(w,2)).body.default_uid,colleague.body.uid);
  await Promise.all([call(w,1,'PATCH',url(a.body.uid),{is_default:true,version:3}),call(w,1,'PATCH',url(b.body.uid),{is_default:true,version:b.body.version})]);
  assert.equal((await call(w,1)).body.items.filter((v:any)=>v.is_default).length,1);
 }finally{w.db.close();}
});
test('an audit failure rolls back create, edit, default changes and deletion',async()=>{
 const w=world();try {
  const a=await create(w,1,{is_default:true});const b=await create(w);const before=JSON.stringify(rows(w));
  w.db.exec('DROP TABLE activity_logs');
  assert.equal((await create(w,1,{is_default:true})).status,503);assert.equal(JSON.stringify(rows(w)),before);
  assert.equal((await call(w,1,'PATCH',url(b.body.uid),{is_default:true,version:b.body.version})).status,503);assert.equal(JSON.stringify(rows(w)),before);
  assert.equal((await call(w,1,'DELETE',url(a.body.uid,a.body.version))).status,503);assert.equal(JSON.stringify(rows(w)),before);
 }finally{w.db.close();}
});
test('revoked, unaccepted, mismatched or lapsed seats cannot retain firm views; a company link alone grants none',async()=>{
 const w=world();try {
  await create(w,1,{shared_with_firm:true});
  for(const change of ["UPDATE investor_seats SET revoked_at=CURRENT_TIMESTAMP", "UPDATE investor_seats SET accepted_at=NULL", "UPDATE investor_seats SET seat_user_id=8", "UPDATE users SET investor_subscription_status='cancelled' WHERE id=1", "UPDATE users SET is_active=0 WHERE id=1"]) {
    w.db.exec(change);const result=await call(w,2);assert.equal(result.status,403,change);assert.doesNotMatch(JSON.stringify(result.body),/Synthetic view|filters|sectors/);
    assert.equal((await create(w,2)).status,403);
    w.db.exec("UPDATE investor_seats SET revoked_at=NULL,accepted_at=CURRENT_TIMESTAMP,seat_user_id=2; UPDATE users SET investor_subscription_status='active',is_active=1 WHERE id=1");
  }
 }finally{w.db.close();}
});
test('forged and ambiguous company selections refuse; verified company changes isolate settings without widening seat membership',async()=>{
 const w=world();try {
  await create(w,1,{shared_with_firm:true});
  assert.equal((await call(w,2,'GET','/api/deals/views',undefined,{'X-Company-Id':'22'})).status,403);
  w.db.exec("INSERT INTO user_company_links(uid,user_id,company_id) VALUES('extra',1,22)");
  assert.equal((await call(w,1)).status,409);assert.equal((await call(w,2)).status,409);
  assert.equal((await call(w,2,'GET','/api/deals/views',undefined,{'X-Company-Id':'11'})).body.items.length,1);
  assert.deepEqual((await call(w,2,'GET','/api/deals/views',undefined,{'X-Company-Id':'22'})).body.items,[]);
  const created=await call(w,2,'POST','/api/deals/views',{name:'Other firm',spec:{view:'table'},shared_with_firm:true}, {'X-Company-Id':'22'});assert.equal(created.status,201);assert.equal(created.body.company_id,22);
 }finally{w.db.close();}
});
test('unbound firm accounts share only with their seats; default uniqueness also holds with null company',async()=>{
 const w=world();try {
  w.db.exec('DELETE FROM user_company_links WHERE user_id=1');
  const a=await create(w,1,{is_default:true,shared_with_firm:true});const b=await create(w,1,{is_default:true});
  assert.equal(a.body.company_id,null);assert.equal((await call(w,2)).body.items[0].uid,a.body.uid);
  assert.equal((await call(w,1)).body.default_uid,b.body.uid);
  assert.equal(w.db.prepare('SELECT COUNT(*) n FROM deal_saved_views WHERE is_default=1').get()?.n,1);
 }finally{w.db.close();}
});
test('validation, quotas and optimistic versions refuse without reflecting user content',async()=>{
 const w=world();try {
  for(const extra of [{name:''},{name:'x'.repeat(101)},{name:'a\nb'},{shared_with_firm:'yes'},{is_default:1},{company_id:22},{owner_user_id:3},{version:0},{spec:[]},{spec:{sql:'PRIVATE SQL'}},{spec:{view:'other'}},{spec:{scope:'foreign'}},{spec:{version:2}},{spec:{filters:{constructor:'PRIVATE'}}},{spec:{filters:Object.fromEntries(Array.from({length:30},(_,i)=>[`k${i}`,'PRIVATE'.repeat(70)]))}}]) {
    const r=await create(w,1,extra);assert.equal(r.status,400,JSON.stringify(extra));assert.doesNotMatch(JSON.stringify(r.body),/PRIVATE/);assert.equal(rows(w).length,0);assert.equal(audits(w).length,0);
  }
  for(let i=0;i<100;i++)w.db.prepare("INSERT INTO deal_saved_views(uid,owner_user_id,firm_owner_user_id,company_id,name,spec_json,mutation_uid) VALUES(?,1,1,11,'Synthetic','{}',?)").run(`seed-${i}`,`seed-${i}`);
  assert.equal((await create(w)).status,409);assert.equal(rows(w).length,100);
  assert.equal((await call(w,1,'GET','/api/deals/views?limit=10')).body.has_more,true);
  assert.equal((await call(w,1,'GET','/api/deals/views?limit=101')).status,400);
  assert.equal((await call(w,1,'GET','/api/deals/views?offset=-1')).status,400);
 }finally{w.db.close();}
});
test('private reads/writes need Professional, reject staff/support sessions and do not create a new deal permission',async()=>{
 const w=world();try {
  for(const who of [4,7]) {assert.equal((await create(w,who)).status,403);assert.equal((await call(w,who)).status,403);}
  assert.equal((await call(w,null)).status,401);assert.equal((await create(w,6)).status,402);
  assert.equal((await create(w,5)).status,201);assert.equal((await create(w,5,{shared_with_firm:true})).status,403);
  assert.equal((await call(w,1,'GET','/api/deals/views',undefined,{}, {impersonated_by:4})).status,403);
  await create(w,1,{shared_with_firm:true,spec:{filters:{deal_ids:[2]}}});
  assert.equal((await call(w,1,'GET','/api/deals/fit?ids=2')).body.items[0].state,'unavailable');
  assert.equal((await call(w,2,'GET','/api/deals/fit?ids=2')).body.items[0].score,null);
  assert.equal((await call(w,6,'GET','/api/deals/fit?ids=1')).status,402);
 }finally{w.db.close();}
});

test('fit is personal, computed afresh and not persisted, with recorded geography and honest USD comparisons',async()=>{
 const w=world();try {
  let result=await call(w,1,'GET','/api/deals/fit?ids=1');assert.equal(result.status,200,JSON.stringify(result.body));
  let fit=result.body.items[0];assert.equal(fit.score,100);assert.equal(fit.confidence,1);assert.equal(fit.confidence_label,'High');assert.equal(fit.computed,true);assert.deepEqual(fit.coverage,{recorded:4,total:4});assert.ok(fit.criteria.every((c:any)=>c.state==='match'));
  const colleague=await call(w,2,'GET','/api/deals/fit?ids=1');assert.equal(colleague.body.items[0].state,'not_set');assert.equal(colleague.body.items[0].score,null);assert.equal(colleague.body.items[0].label,'Set your thesis');
  w.db.exec("UPDATE projects SET sector='Consumer' WHERE id=10");fit=(await call(w,1,'GET','/api/deals/fit?ids=1')).body.items[0];assert.equal(fit.score,75);
  w.db.exec("UPDATE deals SET currency='EUR' WHERE id=1");fit=(await call(w,1,'GET','/api/deals/fit?ids=1')).body.items[0];assert.equal(fit.confidence,0.75);assert.equal(fit.confidence_label,'High');assert.equal(fit.criteria[3].state,'not_recorded');
  assert.equal(w.db.prepare('SELECT COUNT(*) n FROM deal_saved_views').get()?.n,0);assert.equal(audits(w).length,0);
 }finally{w.db.close();}
});
test('free-text HQ never supplies geography; missing or unreadable inputs do not become zero or blank other fit rows',async()=>{
 const w=world();try {
  w.db.exec("UPDATE markets SET geography_ref=NULL WHERE project_id=10");
  let fit=(await call(w,1,'GET','/api/deals/fit?ids=1')).body.items[0];assert.equal(fit.criteria[2].state,'not_recorded');assert.equal(fit.confidence,0.75);
  w.db.exec("INSERT INTO deal_invitations(deal_id,investor_user_id) VALUES(2,1)");
  w.db.exec("INSERT INTO markets(uid,project_id,name,state,geography_ref) VALUES('other',20,'Other market','served','US')");
  let reads=0;const prepare=w.env.DB.prepare.bind(w.env.DB);w.env.DB.prepare=(sql:string)=>{const stmt=prepare(sql);const bind=stmt.bind;stmt.bind=(...values:any[])=>{const bound=bind(...values);if(sql.includes('FROM markets m')) {const all=bound.all;bound.all=async()=>{reads++;const result=await all();return {...result,results:result.results.map((row:any)=>row.project_id===10?{...row,region:{invalid:'PRIVATE provider details 1234567'}}:row)};};}return bound;};return stmt;};
  let r=await call(w,1,'GET','/api/deals/fit?ids=1,2');assert.equal(r.status,200);assert.equal(reads,1);assert.equal(r.body.items.find((i:any)=>i.deal_id===1).state,'unreadable');assert.equal(r.body.items.find((i:any)=>i.deal_id===1).score,null);assert.equal(r.body.items.find((i:any)=>i.deal_id===2).state,'recorded');assert.equal(r.body.items.find((i:any)=>i.deal_id===2).criteria[2].state,'outside');assert.doesNotMatch(JSON.stringify(r.body),/PRIVATE|1234567/);
  w.env.DB.prepare=prepare;
  w.db.exec("UPDATE investor_profiles SET sectors_json='PRIVATE INVALID' WHERE user_id=1");r=await call(w,1,'GET','/api/deals/fit?ids=1');assert.equal(r.status,503);assert.doesNotMatch(JSON.stringify(r.body),/PRIVATE/);
 }finally{w.db.close();}
});

test('fit rules preserve measured zero, exclusions, partial confidence and missing-versus-unset distinctions',()=>{
 const thesis:Thesis={sectors:['Climate'],stages:['Pre-seed'],regions:['Europe'],ticketMin:10000,ticketMax:50000,excludedSectors:[],excludedStages:[]};
 const missing={sector:null,stage:null,regions:null,minimumCheck:null,currency:null};
 const empty=computeThesisFit(null,missing);assert.equal(empty.state,'not_set');assert.equal(empty.score,null);assert.equal(empty.confidence,0);
 const none=computeThesisFit(thesis,missing);assert.equal(none.state,'not_enough_recorded');assert.equal(none.score,null);assert.equal(none.confidence,0);
 const zero=computeThesisFit(thesis,{sector:'Consumer',stage:'Growth',regions:['APAC'],minimumCheck:60000,currency:'USD'});assert.equal(zero.score,0);assert.equal(zero.confidence,1);assert.equal(zero.state,'recorded');
 const partial=computeThesisFit(thesis,{...missing,stage:'pre_seed'});assert.equal(partial.score,100);assert.equal(partial.confidence,0.25);assert.equal(partial.confidence_label,'Low');
 const medium=computeThesisFit(thesis,{...missing,stage:'pre_seed',sector:'Climate'});assert.equal(medium.confidence,0.5);assert.equal(medium.confidence_label,'Medium');
 const measuredZero=computeThesisFit({...thesis,ticketMin:0,ticketMax:0},{...missing,minimumCheck:0,currency:'USD'});assert.equal(measuredZero.score,100);
 const excluded=computeThesisFit({...thesis,excludedSectors:['Climate']},{...missing,sector:'Climate'});assert.equal(excluded.score,0);
 const unknownRegion=computeThesisFit(thesis,{...missing,regions:['APAC'],geographyIncomplete:true});assert.equal(unknownRegion.criteria[2].state,'not_recorded');
 const boundaries=computeThesisFit(thesis,{...missing,minimumCheck:50000,currency:'USD'});assert.equal(boundaries.score,100);assert.equal(computeThesisFit(thesis,{...missing,minimumCheck:50000,currency:'USD'}).score,100);
 for(const minimumCheck of [NaN,Infinity,-1])assert.equal(computeThesisFit(thesis,{...missing,minimumCheck,currency:'USD'}).score,null);
 assert.equal(thesisRegion('Asia'),'APAC');assert.equal(thesisRegion('Oceania'),'APAC');assert.equal(thesisRegion('Latin America'),'LATAM');assert.equal(thesisRegion('Middle East'),'MENA');assert.equal(thesisRegion('unknown'),null);
});
test('geographic source uses only this venture’s served/planned markets and reports unmapped references',async()=>{
 const w=world();try{
  w.db.exec("INSERT INTO markets(uid,project_id,name,state,geography_ref) VALUES('foreign',20,'Foreign','served','US'),('no',10,'Excluded','not_now','US'),('planned',10,'Planned','considering','JP'),('bad',10,'Missing','entering','ZZ')");
  const g=await readFitGeography(w.env,10);assert.deepEqual(g.regions?.sort(),['APAC','Europe']);assert.equal(g.geographyIncomplete,true);
 }finally{w.db.close();}
});

test('mixed-access fit reads keep authorized rows and disclose no facts about unknown, deleted or unrelated deals',async()=>{
 const w=world();try {
  const response=await call(w,1,'GET','/api/deals/fit?ids=2,1,999');assert.equal(response.status,200);
  const items=response.body.items;assert.deepEqual(items.map((v:any)=>v.deal_id),[2,1,999]);assert.equal(items[1].score,100);
  for(const item of [items[0],items[2]]) {assert.deepEqual(Object.keys(item).sort(),['confidence','deal_id','label','score','state']);assert.equal(item.state,'unavailable');assert.equal(item.score,null);}
  w.db.exec("UPDATE projects SET deleted_at=CURRENT_TIMESTAMP WHERE id=10");assert.equal((await call(w,1,'GET','/api/deals/fit?ids=1')).body.items[0].state,'unavailable');
  for(const query of ['', '0', '1 OR 1=1', Array.from({length:51},()=>1).join(',')]) assert.equal((await call(w,1,'GET',`/api/deals/fit?ids=${encodeURIComponent(query)}`)).status,400);
 }finally{w.db.close();}
});

test('a seat revoked after context resolution cannot write, clear a default or create a misleading audit',async()=>{
 const w=world();try {
  const a=await create(w,2,{is_default:true});const b=await create(w,2);const before=JSON.stringify(rows(w)),count=audits(w).length;
  const batch=w.env.DB.batch.bind(w.env.DB);
  w.env.DB.batch=async(statements:any[])=>{w.db.exec('UPDATE investor_seats SET revoked_at=CURRENT_TIMESTAMP');return batch(statements);};
  assert.equal((await call(w,2,'PATCH',url(b.body.uid),{is_default:true,version:b.body.version})).status,409);assert.equal(JSON.stringify(rows(w)),before);assert.equal(audits(w).length,count);
  w.db.exec('UPDATE investor_seats SET revoked_at=NULL');assert.equal((await create(w,2,{is_default:true})).status,409);assert.equal(JSON.stringify(rows(w)),before);assert.equal(audits(w).length,count);
  w.db.exec('UPDATE investor_seats SET revoked_at=NULL');assert.equal((await call(w,2,'DELETE',url(a.body.uid,a.body.version))).status,409);assert.equal(JSON.stringify(rows(w)),before);assert.equal(audits(w).length,count);
 }finally{w.db.close();}
});
test('fit no longer becomes available through a saved view, a room or a primary account’s invitation',async()=>{
 const w=world();try {
  w.db.exec('DELETE FROM deal_invitations WHERE investor_user_id=2');
  assert.equal((await call(w,2,'GET','/api/deals/fit?ids=1')).body.items[0].state,'unavailable');
  w.db.exec('INSERT INTO commitments(deal_id,investor_user_id,amount,status) VALUES(1,2,100,\'pending\')');
  assert.equal((await call(w,2,'GET','/api/deals/fit?ids=1')).body.items[0].state,'not_set');
 }finally{w.db.close();}
});

test('ticket fit uses the minimum cheque floor, never the round target or an invented allocation',async()=>{
 const w=world();try {
  w.db.exec('UPDATE deals SET target_raise=2000000,amount=9999999,minimum_check=20000 WHERE id=1');
  let fit=(await call(w,1,'GET','/api/deals/fit?ids=1')).body.items[0];assert.equal(fit.score,100);assert.equal(fit.criteria[3].source,'deals.minimum_check + deals.currency');
  w.db.exec('UPDATE deals SET minimum_check=1000 WHERE id=1');assert.equal((await call(w,1,'GET','/api/deals/fit?ids=1')).body.items[0].score,100);
  w.db.exec('UPDATE deals SET minimum_check=60000 WHERE id=1');assert.equal((await call(w,1,'GET','/api/deals/fit?ids=1')).body.items[0].criteria[3].state,'outside');
  w.db.exec('UPDATE deals SET minimum_check=NULL,target_raise=20000,amount=20000 WHERE id=1');fit=(await call(w,1,'GET','/api/deals/fit?ids=1')).body.items[0];assert.equal(fit.criteria[3].state,'not_recorded');assert.equal(fit.confidence,0.75);
  w.db.exec('UPDATE deals SET minimum_check=20000 WHERE id=1; UPDATE investor_profiles SET ticket_max_usd=NULL WHERE user_id=1');assert.equal((await call(w,1,'GET','/api/deals/fit?ids=1')).body.items[0].criteria[3].state,'not_recorded');
 }finally{w.db.close();}
});

test('edits and deletes require the rendered version; a stale or missing version changes nothing',async()=>{
 const w=world();try {
  const a=await create(w,1,{is_default:true});
  assert.equal((await call(w,1,'PATCH',url(a.body.uid),{name:'Changed'})).status,400);
  assert.equal((await call(w,1,'DELETE',url(a.body.uid))).status,400);
  const changed=await call(w,1,'PATCH',url(a.body.uid),{name:'Changed',version:1});assert.equal(changed.status,200);
  const before=JSON.stringify(rows(w)),count=audits(w).length;
  assert.equal((await call(w,1,'DELETE',url(a.body.uid,1))).status,409);assert.equal(JSON.stringify(rows(w)),before);assert.equal(audits(w).length,count);
  assert.equal((await call(w,1,'DELETE',url(a.body.uid,changed.body.version))).status,200);
 }finally{w.db.close();}
});
test('migration default uniqueness covers company and unbound contexts directly',()=>{
 const w=world();try {
  const add=w.db.prepare("INSERT INTO deal_saved_views(uid,owner_user_id,firm_owner_user_id,company_id,name,is_default,spec_json,mutation_uid) VALUES(?,1,1,?,'Synthetic',1,'{}',?)");
  add.run('company-one',11,'one');assert.throws(()=>add.run('company-two',11,'two'),/UNIQUE/);
  add.run('unbound-one',null,'three');assert.throws(()=>add.run('unbound-two',null,'four'),/UNIQUE/);
 }finally{w.db.close();}
});
test('a failed bulk geographic read is unreadable without echoing the database error',async()=>{
 const w=world();try {
  const prepare=w.env.DB.prepare.bind(w.env.DB);w.env.DB.prepare=(sql:string)=>{const stmt=prepare(sql);const bind=stmt.bind;stmt.bind=(...values:any[])=>{const bound=bind(...values);if(sql.includes('FROM markets m'))bound.all=async()=>{throw new Error('PRIVATE database failure 1234567');};return bound;};return stmt;};
  const result=await call(w,1,'GET','/api/deals/fit?ids=1');assert.equal(result.status,200);assert.equal(result.body.items[0].state,'unreadable');assert.equal(result.body.items[0].score,null);assert.doesNotMatch(JSON.stringify(result.body),/PRIVATE|1234567/);
 }finally{w.db.close();}
});

test('a malformed venture input is unreadable without blanking another authorized fit row',async()=>{
 const w=world();try {
  w.db.exec('INSERT INTO deal_invitations(deal_id,investor_user_id) VALUES(2,1)');
  const prepare=w.env.DB.prepare.bind(w.env.DB);w.env.DB.prepare=(sql:string)=>{const stmt=prepare(sql);const bind=stmt.bind;stmt.bind=(...values:any[])=>{const bound=bind(...values);if(sql.includes('JOIN projects p')) {const all=bound.all;bound.all=async()=>{const result=await all();return {...result,results:result.results.map((row:any)=>row.id===1?{...row,sector:{invalid:'PRIVATE input 1234567'}}:row)};};}return bound;};return stmt;};
  const result=await call(w,1,'GET','/api/deals/fit?ids=1,2');assert.equal(result.status,200);assert.equal(result.body.items[0].state,'unreadable');assert.equal(result.body.items[0].score,null);assert.equal(result.body.items[1].state,'recorded');assert.doesNotMatch(JSON.stringify(result.body),/PRIVATE|1234567/);
 }finally{w.db.close();}
});

test('replacing a default advances its version so a stale form cannot restore or delete it',async()=>{
 const w=world();try {
  const a=await create(w,1,{is_default:true});const untouched=await create(w);
  const b=await create(w,1,{is_default:true});const list=await call(w,1);
  const prior=list.body.items.find((v:any)=>v.uid===a.body.uid);assert.equal(prior.version,a.body.version+1);assert.equal(prior.is_default,false);
  assert.equal(list.body.items.find((v:any)=>v.uid===untouched.body.uid).version,untouched.body.version);
  const before=JSON.stringify(rows(w)),count=audits(w).length;
  assert.equal((await call(w,1,'PATCH',url(a.body.uid),{version:a.body.version,is_default:true,name:'Stale'})).status,409);
  assert.equal((await call(w,1,'DELETE',url(a.body.uid,a.body.version))).status,409);assert.equal(JSON.stringify(rows(w)),before);assert.equal(audits(w).length,count);
  assert.equal((await call(w,1)).body.default_uid,b.body.uid);
  assert.equal((await call(w,1,'PATCH',url(a.body.uid),{version:prior.version,is_default:true})).status,200);
  assert.equal((await call(w,1)).body.default_uid,a.body.uid);
 }finally{w.db.close();}
});

test('a shared view stops appearing when its author loses accepted, active firm membership',async()=>{
 const w=world();try {
  const made=await create(w,2,{shared_with_firm:true});assert.equal(made.status,201);assert.equal((await call(w,1)).body.items[0].uid,made.body.uid);
  for(const change of ["UPDATE investor_seats SET revoked_at=CURRENT_TIMESTAMP", "UPDATE investor_seats SET accepted_at=NULL", "UPDATE users SET investor_seat_primary_user_id=NULL WHERE id=2", "UPDATE users SET is_active=0 WHERE id=2"]) {
    w.db.exec(change);assert.deepEqual((await call(w,1)).body.items,[],change);
    w.db.exec('UPDATE investor_seats SET revoked_at=NULL,accepted_at=CURRENT_TIMESTAMP; UPDATE users SET investor_seat_primary_user_id=1,is_active=1 WHERE id=2');
  }
  assert.equal((await call(w,1)).body.items[0].uid,made.body.uid);
 }finally{w.db.close();}
});
test('unbound views remain explicitly accessible after linking one or multiple companies, without moving firm settings',async()=>{
 const w=world();try {
  w.db.exec('DELETE FROM user_company_links WHERE user_id=1');const a=await create(w,1,{is_default:true,shared_with_firm:true});
  w.db.exec("INSERT INTO user_company_links(uid,user_id,company_id) VALUES('new-company',1,11)");
  assert.deepEqual((await call(w,1)).body.items,[]);
  let list=await call(w,1,'GET','/api/deals/views?context=unbound',undefined,{'X-Company-Id':'11'});assert.equal(list.status,200);assert.equal(list.body.default_uid,a.body.uid);assert.equal(list.body.items[0].company_id,null);
  assert.equal((await call(w,2,'GET','/api/deals/views?context=unbound')).body.items[0].uid,a.body.uid);
  assert.deepEqual((await call(w,3,'GET','/api/deals/views?context=unbound')).body.items,[]);
  w.db.exec("INSERT INTO user_company_links(uid,user_id,company_id) VALUES('second-company',1,22)");
  assert.equal((await call(w,1)).status,409);assert.equal((await call(w,1,'GET','/api/deals/views?context=unbound')).body.items[0].uid,a.body.uid);
  const changed=await call(w,1,'PATCH',url(a.body.uid)+'?context=unbound',{version:a.body.version,name:'Updated unbound'});assert.equal(changed.status,200);
  assert.equal((await call(w,1,'DELETE',url(a.body.uid,changed.body.version)+'&context=unbound')).status,200);
  assert.equal((await call(w,1,'POST','/api/deals/views?context=unbound',{name:'Unbound',spec:{}})).status,201);
  assert.equal((await call(w,1,'GET','/api/deals/views?context=foreign')).status,400);
 }finally{w.db.close();}
});
test('a removed company link exposes only the author’s archived settings for cleanup, never editing or sharing',async()=>{
 const w=world();try {
  const a=await create(w,1,{shared_with_firm:true,is_default:true});const peer=await create(w,2,{shared_with_firm:true});
  assert.deepEqual((await call(w,1,'GET','/api/deals/views?context=archived')).body.items,[]);
  w.db.exec('DELETE FROM user_company_links WHERE user_id=1');assert.deepEqual((await call(w,1)).body.items,[]);
  const list=await call(w,1,'GET','/api/deals/views?context=archived');assert.equal(list.status,200);assert.deepEqual(list.body.items.map((v:any)=>v.uid),[a.body.uid]);assert.equal(list.body.can_share_with_firm,false);assert.equal(list.body.default_uid,null);
  assert.deepEqual((await call(w,3,'GET','/api/deals/views?context=archived')).body.items,[]);
  assert.equal((await call(w,1,'POST','/api/deals/views?context=archived',{name:'Refused',spec:{}})).status,400);
  assert.equal((await call(w,1,'PATCH',url(a.body.uid)+'?context=archived',{version:1,name:'Refused'})).status,400);
  assert.equal((await call(w,1,'DELETE',url(peer.body.uid,1)+'&context=archived')).status,404);
  assert.equal((await call(w,1,'DELETE',url(a.body.uid,1)+'&context=archived')).status,200);assert.equal(rows(w).length,1);
  assert.equal(JSON.parse(audits(w).at(-1)?.details as string).company_id,11);
  w.db.exec('UPDATE investor_seats SET revoked_at=CURRENT_TIMESTAMP');assert.equal((await call(w,2,'GET','/api/deals/views?context=archived')).status,403);
 }finally{w.db.close();}
});

test('a settings database failure returns a fixed unreadable sentence without query text',async()=>{
 const w=world();try {
  const prepare=w.env.DB.prepare.bind(w.env.DB);w.env.DB.prepare=(sql:string)=>{if(sql.includes('FROM deal_saved_views'))throw new Error('PRIVATE QUERY 1234567');return prepare(sql);};
  const result=await call(w,1);assert.equal(result.status,503);assert.match(result.body.error,/unreadable/i);assert.doesNotMatch(JSON.stringify(result.body),/PRIVATE|QUERY|1234567/);
 }finally{w.db.close();}
});

test('a primary who loses firm coverage can maintain or unshare an existing view but cannot grant a new share',async()=>{
 const w=world();try {
  const shared=await create(w,1,{shared_with_firm:true});const privateView=await create(w);
  w.db.exec("UPDATE users SET investor_tier='professional' WHERE id=1");
  assert.equal((await call(w,2)).status,403);
  const changed=await call(w,1,'PATCH',url(shared.body.uid),{version:1,name:'Still mine',is_default:true});assert.equal(changed.status,200);assert.equal(changed.body.shared_with_firm,true);
  assert.equal((await create(w,1,{shared_with_firm:true})).status,403);
  assert.equal((await call(w,1,'PATCH',url(privateView.body.uid),{version:1,shared_with_firm:true})).status,403);
  const unshared=await call(w,1,'PATCH',url(shared.body.uid),{version:changed.body.version,shared_with_firm:false});assert.equal(unshared.status,200);assert.equal(unshared.body.shared_with_firm,false);
  assert.equal((await call(w,1,'PATCH',url(shared.body.uid),{version:unshared.body.version,shared_with_firm:true})).status,403);
 }finally{w.db.close();}
});
