import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import deals from '../src/routes/deals.ts';
import networkfx from '../src/routes/networkfx.ts';
import legalcap from '../src/routes/legalcap.ts';
import capital from '../src/routes/capital.ts';
import captable from '../src/routes/captable.ts';
import { tableFromBaseline } from './_baseline.mjs';
import { d1Over } from './_d1_sqlite.mjs';
const secret = 't'.repeat(64);
const baseline = readFileSync(new URL('../sql/schema_baseline.sql', import.meta.url), 'utf8');
function fixture() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
  for (const table of ['users', 'partners', 'projects', 'deals', 'commitments', 'deal_invitations', 'activity_logs', 'user_company_links', 'super_admins',
    'cap_table_holders', 'cap_table_securities', 'project_members', 'legal_documents', 'esign_envelopes', 'esign_recipients', 'subsidiaries', 'capital_calls', 'syndicates', 'syndicate_members',
    'shared_services_log', 'mi_pro_subscriptions']) {
    db.exec(tableFromBaseline(baseline, table));
  }
  db.exec(tableFromBaseline(readFileSync(new URL('../sql/migrations/575_cap_table_access.sql',import.meta.url),'utf8'),'cap_table_access_grants'));
  for (const [id, role] of [[1,'investor'], [2,'investor'], [3,'founder'], [4,'admin'], [5,'partner'], [6,'advisor'], [7,'exploring']]) {
    db.prepare('INSERT INTO users(id,role,email,name,founder_id,is_active,kyc_status) VALUES(?,?,?,?,?,1,?)')
      .run(id,role,`synthetic${id}@example.invalid`,'Synthetic member',id === 3 ? 30 : null,'approved');
  }
  db.exec("INSERT INTO projects(id,name,founder_id) VALUES(1,'Synthetic venture',30),(2,'Other venture',30)");
  db.exec("INSERT INTO deals(id,project_id,status,minimum_check,capital_committed) VALUES(1,1,'active',100,9999)");
  db.exec("INSERT INTO user_company_links(uid,user_id,company_id) VALUES('synthetic-1',1,10),('synthetic-2',2,20)");
  db.exec('INSERT INTO deal_invitations(deal_id,investor_user_id,company_id) VALUES(1,1,10),(1,2,20)');
  const env: any = { DB:d1Over(db), JWT_SECRET:secret, ENVIRONMENT:'development' };
  const app = new Hono<any>();
  app.route('/api/deals',deals).route('/api/networkfx',networkfx).route('/api/legalcap',legalcap)
    .route('/api/captable',captable).route('/api/capital',capital);
  app.onError((err,c) => c.json({error:err.message},AUTH_ERROR_STATUSES[err.message] || 500));
  return { db, env, app };
}
async function call(f: ReturnType<typeof fixture>, uid: number, path: string, body?: any, method='POST', headers: Record<string,string>={}) {
  const jwt = await new SignJWT({user_id:uid}).setProtectedHeader({alg:'HS256'}).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(secret));
  const res = await f.app.request(path,{method,headers:{Authorization:`Bearer ${jwt}`,'Content-Type':'application/json',...headers},body:body === undefined ? undefined : JSON.stringify(body)},f.env);
  return {status:res.status,body:await res.json().catch(()=>null)};
}


test('D1214: private syndicate list/detail; even admins never receive member emails',async()=>{
 const f=fixture();try {
  f.db.exec("INSERT INTO syndicates(id,name,target_cents,min_commitment_cents,created_by) VALUES(1,'Synthetic',10000,100,2); INSERT INTO syndicate_members(syndicate_id,user_id,commitment_cents) VALUES(1,1,10000)");
  for(const id of [1,2,4]) {
   const r=await call(f,id,'/api/networkfx/syndicates/1',undefined,'GET');assert.equal(r.status,200);assert.equal(r.body.members.length,1);assert.equal(r.body.members[0].commitment_cents,10000);assert.equal('email' in r.body.members[0],false);
   assert.equal(JSON.stringify(r.body).includes('@'),false);
  }
  assert.equal((await call(f,5,'/api/networkfx/syndicates/1',undefined,'GET')).status,403);
  assert.deepEqual((await call(f,5,'/api/networkfx/syndicates',undefined,'GET')).body,[]);
  assert.equal((await call(f,1,'/api/networkfx/syndicates',undefined,'GET')).body.length,1);
 }finally{f.db.close();}
});
test('D1214: a live person-bound holder grant returns only that holder; recorder, email and unrelated grants confer nothing',async()=>{
 const f=fixture();try {
  f.db.exec("INSERT INTO cap_table_holders(user_id,project_id,name,email,shares) VALUES(3,1,'Synthetic holder','synthetic1@example.invalid',100),(3,1,'Other holder','other@example.invalid',900); INSERT INTO cap_table_holders(user_id,project_id,name,shares) VALUES(3,2,'Synthetic holder',500); INSERT INTO cap_table_access_grants(id,project_id,user_id,holder_ref,level,granted_by) VALUES(1,1,1,'Synthetic holder','own_position',3)");
  const own=await call(f,1,'/api/captable/1',undefined,'GET');assert.equal(own.status,200);assert.deepEqual(own.body.holders.map((r:any)=>[r.name,r.shares]),[['Synthetic holder',100]]);assert.deepEqual(own.body.securities,[]);assert.equal(JSON.stringify(own.body).includes('@'),false);
  assert.equal((await call(f,2,'/api/captable/1',undefined,'GET')).status,403);
  assert.equal((await call(f,1,'/api/captable/2',undefined,'GET')).status,403);
  f.db.exec("UPDATE cap_table_access_grants SET level='none' WHERE id=1");assert.equal((await call(f,1,'/api/captable/1',undefined,'GET')).status,200);
  f.db.exec("UPDATE cap_table_access_grants SET revoked_at=CURRENT_TIMESTAMP WHERE id=1");assert.equal((await call(f,1,'/api/captable/1',undefined,'GET')).status,403);
  for(const id of [3,4]) assert.equal((await call(f,id,'/api/captable/1',undefined,'GET')).body.holders.length,2);
 }finally{f.db.close();}
});
for(const [method,path] of [['POST','/api/legalcap/capital/call'],['PATCH','/api/legalcap/capital/call/1/send'],['POST','/api/legalcap/capital/call/1/respond'],['GET','/api/legalcap/capital/lp-portal'],['GET','/api/legalcap/capital/calls'],['POST','/api/capital/capitalCall']]) test(`D1214: retired ${method} ${path} cannot read or write money`,async()=>{
 const f=fixture();try{
  for(const id of [1,2,3,4,5,6,7]) {const r=await call(f,id,path,undefined,method);assert.equal(r.status,410,JSON.stringify(r.body));assert.equal(r.body.error,'Capital calls are managed in Fund admin.');}
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM capital_calls').get()?.n,0);
  f.db.exec('DROP TABLE capital_calls');
  assert.equal((await call(f,4,path,undefined,method)).status,410);
  const anonymous=await f.app.request(path,{method},f.env);assert.equal(anonymous.status,401);
 }finally{f.db.close();}
});
test('D1214: missing legal terms stay null and Not recorded without a document, AI or capital call',async()=>{
 const f=fixture();try{
  const r=await call(f,4,'/api/legalcap/legal/generate',{deal_id:1,type:'SAFE'});assert.equal(r.status,400);assert.equal(r.body.status,'Not recorded');assert.equal(r.body.terms.amount,null);assert.equal(r.body.terms.valuation_cap,null);assert.equal(r.body.terms.discount_rate,null);assert.equal(r.body.terms.investor_name,null);
  for(const table of ['legal_documents','capital_calls','shared_services_log']) assert.equal(f.db.prepare(`SELECT COUNT(*) n FROM ${table}`).get()?.n,0);
 }finally{f.db.close();}
});
test('D1214: an approved investor can commit; every unapproved status gets the syndicate identity sentence with no writes',async()=>{
 const f=fixture();try {
  f.db.exec("INSERT INTO syndicates(id,name,min_commitment_cents,created_by) VALUES(1,'Synthetic',100,2)");
  for(const status of [null,'pending','rejected','in_review']) {
   f.db.prepare('UPDATE users SET kyc_status=? WHERE id=1').run(status);
   const deal=await call(f,1,'/api/deals/1/commitments',{amount:200});const syndicate=await call(f,1,'/api/networkfx/syndicates/1/join',{commitment_cents:100});assert.equal(deal.status,403);assert.equal(syndicate.status,403);assert.equal(deal.body.error,syndicate.body.error);assert.equal(deal.body.error,'KYC required');assert.equal(f.db.prepare('SELECT COUNT(*) n FROM commitments').get()?.n,0);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM syndicate_members').get()?.n,0);
  }
  f.db.exec("UPDATE users SET kyc_status='approved' WHERE id=1");assert.equal((await call(f,1,'/api/deals/1/commitments',{amount:200})).status,200);
 }finally{f.db.close();}
});

test('D1214: names and pledged figures stay out of syndicate and commitment audit logs',async()=>{
 const f=fixture();try {
  const created=await call(f,2,'/api/networkfx/syndicates',{name:'Private synthetic syndicate',target_cents:54321,min_commitment_cents:100});assert.equal(created.status,201);
  const below=await call(f,1,`/api/networkfx/syndicates/${created.body.id}/join`,{commitment_cents:50});assert.equal(below.status,400);assert.doesNotMatch(JSON.stringify(below.body),/100|1\.00/);
  assert.equal((await call(f,1,`/api/networkfx/syndicates/${created.body.id}/join`,{commitment_cents:54321})).status,200);
  assert.equal(f.db.prepare('SELECT status FROM syndicates').get()?.status,'open');
  assert.equal((await call(f,1,'/api/deals/1/commitments',{amount:12345})).status,200);
  const audit=f.db.prepare("SELECT details FROM activity_logs WHERE action='deal_commitment_pending' UNION ALL SELECT details FROM shared_services_log WHERE action_type IN ('syndicate_created','syndicate_joined')").all();
  assert.equal(audit.length,3);const commitment=f.db.prepare("SELECT uid FROM commitments").get();assert.equal(JSON.parse(audit[0].details as string).commitment_uid,commitment?.uid);const text=JSON.stringify(audit);assert.doesNotMatch(text,/Private synthetic syndicate|54321|12345|@/);
 }finally{f.db.close();}
});


test('D1214: duplicate or missing holder names refuse instead of disclosing an ambiguous position',async()=>{
 const f=fixture();try {
  f.db.exec("INSERT INTO cap_table_holders(user_id,project_id,name,shares) VALUES(3,1,'Same name',100),(3,1,'Same name',999); INSERT INTO cap_table_access_grants(project_id,user_id,holder_ref,level,granted_by) VALUES(1,1,'Same name','none',3)");
  const ambiguous=await call(f,1,'/api/captable/1',undefined,'GET');assert.equal(ambiguous.status,409);assert.equal('holders' in ambiguous.body,false);assert.doesNotMatch(JSON.stringify(ambiguous.body),/Same name|999|100/);
  f.db.exec("UPDATE cap_table_access_grants SET holder_ref='Missing holder'");assert.equal((await call(f,1,'/api/captable/1',undefined,'GET')).status,409);
 }finally{f.db.close();}
});
test('D1214: a non-member may join with supplied terms; private syndicate reads open only after membership',async()=>{
 const f=fixture();try {
  f.db.exec("INSERT INTO syndicates(id,name,min_commitment_cents,created_by) VALUES(1,'Synthetic',100,2)");
  assert.deepEqual((await call(f,1,'/api/networkfx/syndicates',undefined,'GET')).body,[]);
  assert.equal((await call(f,1,'/api/networkfx/syndicates/1',undefined,'GET')).status,403);
  assert.equal((await call(f,1,'/api/networkfx/syndicates/1/join',{commitment_cents:100})).status,200);
  assert.equal((await call(f,1,'/api/networkfx/syndicates/1',undefined,'GET')).status,200);
  assert.equal((await call(f,1,'/api/networkfx/syndicates',undefined,'GET')).body.length,1);
 }finally{f.db.close();}
});


test('D1214: a holder grant crosses the holder’s company selection without opening the venture register',async()=>{
 const f=fixture();try {
  f.db.exec("UPDATE users SET role='founder',founder_id=70 WHERE id=7; UPDATE projects SET company_id=100 WHERE id=1; INSERT INTO user_company_links(uid,user_id,company_id) VALUES('holder-company',7,200); INSERT INTO cap_table_holders(user_id,project_id,name,shares) VALUES(3,1,'Synthetic holder',100),(3,1,'Other holder',900); INSERT INTO cap_table_access_grants(project_id,user_id,holder_ref,level,granted_by) VALUES(1,1,'Synthetic holder','own_position',3)");
  assert.equal((await call(f,7,'/api/captable/1',undefined,'GET',{'X-Company-Id':'200'})).status,404);
  f.db.exec("UPDATE cap_table_access_grants SET user_id=7");
  const own=await call(f,7,'/api/captable/1',undefined,'GET',{'X-Company-Id':'200'});assert.equal(own.status,200);assert.deepEqual(own.body.holders.map((r:any)=>r.name),['Synthetic holder']);assert.deepEqual(own.body.securities,[]);
 }finally{f.db.close();}
});
