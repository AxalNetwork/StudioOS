/** D1217: full-chain SQLite, authenticated routes, encrypted synthetic instructions. */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync, mkdtempSync, copyFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import accounts from '../src/routes/company_receiving_accounts.ts';
import { acceptProposal, ownCommitments } from '../src/services/mercury/investorFeeds.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { BASELINE_CUTOFF, migrationNumber } from '../../scripts/lib/migrationPlan.mjs';

const scratch=mkdtempSync(join(tmpdir(),'receiving-d1217-')), seed=join(scratch,'seed.sqlite');
const initial=new DatabaseSync(':memory:',{enableForeignKeyConstraints:false});
initial.exec(readFileSync('cloudflare-worker/sql/schema_baseline.sql','utf8'));
const dir='cloudflare-worker/sql/migrations';
for(const name of readdirSync(dir).filter(n=>/^\d+_.*\.sql$/.test(n)&&migrationNumber(n)>BASELINE_CUTOFF).sort()) initial.exec(readFileSync(`${dir}/${name}`,'utf8'));
initial.prepare('VACUUM INTO ?').run(seed);initial.close();
after(()=>rmSync(scratch,{recursive:true,force:true}));
const SECRET='x'.repeat(48), NUMBER='1234567890124821', OTHER_NUMBER='9934567890127777', ROUTING='021000021';
const input=(expected_revision=0,account_number=NUMBER)=>({expected_revision,payee_name:'Fixture Company Inc',bank_name:'Fixture bank',
 account_number,account_number_confirm:account_number,routing_number:ROUTING,currency:'USD',payment_reference:'FIXTURE-SEED'});
const originalFetch=globalThis.fetch;
after(()=>{globalThis.fetch=originalFetch;});
let serial=0;
function fixture(){
 const file=join(scratch,`${++serial}.sqlite`);copyFileSync(seed,file);
 const db=new DatabaseSync(file,{enableForeignKeyConstraints:false});
 db.exec(`INSERT INTO users(id,role,email,name,founder_id,is_active) VALUES
 (1,'founder','founder@example.test','Fixture founder',101,1),(2,'founder','other@example.test','Other founder',102,1),
 (3,'investor','investor@example.test','Fixture investor',NULL,1),(4,'investor','other-investor@example.test','Other investor',NULL,1),
 (5,'admin','admin@example.test','Fixture admin',NULL,1),(6,'investor','paid@example.test','Paid investor',NULL,1),
 (7,'investor','withdrawn@example.test','Withdrawn investor',NULL,1),(8,'founder','member@example.test','Company member',101,1),
 (9,'investor','second@example.test','Second investor',NULL,1);
 INSERT INTO company_profiles(id,uid,company_name) VALUES(100,'company-one','Fixture Company'),(200,'company-two','Other Company');
 INSERT INTO user_company_links(uid,company_id,user_id,is_primary_admin) VALUES('owner-one',100,1,1),('owner-two',200,2,1),('member',100,8,0);
 INSERT INTO projects(id,name,founder_id,company_id) VALUES(10,'Fixture venture',101,100),(11,'Another company project',101,100),(20,'Other venture',102,200);
 INSERT INTO deals(id,uid,project_id,status,currency) VALUES(1000,'deal-one',10,'active','USD'),(1100,'deal-also',11,'active','USD'),(2000,'deal-two',20,'active','USD');
 INSERT INTO commitments(id,uid,deal_id,investor_user_id,amount,status) VALUES
 (30,'line-one',1000,3,250,'pending'),(31,'line-same-investor',1100,3,100,'pending'),(40,'line-other',2000,4,250,'pending'),
 (60,'line-paid',1000,6,250,'confirmed'),(70,'line-withdrawn',1000,7,250,'withdrawn'),(90,'line-second',1100,9,300,'pending');
 INSERT INTO esign_envelopes(id,envelope_uuid,user_id,deal_id,document_type,document_title,document_body,body_sha256,status,created_by,completed_at)
 VALUES(50,'signed-investment',1,1000,'safe','Fixture SAFE','Synthetic paper','synthetic-hash','completed',1,'2026-10-01');
 INSERT INTO esign_recipients(id,envelope_id,user_id,recipient_email,signing_token,token_expires_at,status,signed_at)
 VALUES(51,50,3,'investor@example.test','synthetic-signing-token','2027-01-01','signed','2026-10-01');
 INSERT INTO safe_issuances(uid,project_id,investor_name,amount_cents,valuation_cap_cents,currency,envelope_id,created_by)
 VALUES('safe-one',10,'Fixture investor',25000,1000000,'usd',50,1);
 INSERT INTO integrations(id,uid,user_id,provider_key,status,auth_type) VALUES(80,'fixture-mercury',3,'mercury','active','oauth_mcp');
 INSERT INTO mercury_investor_proposals(id,uid,user_id,integration_id,kind,external_id,mercury_id,target_kind,target_id,amount_cents,posted_on)
 VALUES(81,'proposal-one',3,80,'closing','closing:fixture-wire','fixture-wire','deal_commitment',30,25000,'2026-10-15');`);
 const emails:string[]=[];globalThis.fetch=async(url:any,init:any={})=>{
  if(String(url)==='https://oauth2.googleapis.com/token')return new Response(JSON.stringify({access_token:'synthetic-access-token'}),{headers:{'content-type':'application/json'}});
  if(String(url).startsWith('https://gmail.googleapis.com/gmail/')){const body=JSON.parse(init.body);emails.push(Buffer.from(body.raw,'base64url').toString());return new Response(JSON.stringify({id:'fixture-message'}),{headers:{'content-type':'application/json'}});}
  throw new Error('Unexpected external transport');
 };
 const faults:{audit?:boolean;reveal?:boolean;afterSave?:boolean;beforeBatch?:(()=>void);afterBatch?:(()=>void)}={};
 const base=d1Over(db);
 const DB:any={...base,prepare(sql:string){
  if(faults.afterSave&&/^SELECT/.test(sql))throw new Error('Synthetic post-save read outage');
  const statement=base.prepare(sql);let binds:any[]=[];const bind=statement.bind;
  statement.bind=(...values:any[])=>{binds=values;bind(...values);return statement;};
  const run=statement.runSync;
  statement.runSync=()=>{
   if(faults.audit&&/INSERT INTO activity_logs/.test(sql))throw new Error('Synthetic audit outage');
   // D1 batch SELECTs return rows; preserve the shim's synchronous transaction.
   if(/^\s*SELECT/.test(sql))return {success:true,results:db.prepare(sql).all(...binds),meta:{changes:0}};
   return run();
  };
  const all=statement.all;statement.all=async()=>{if(faults.reveal&&/INSERT INTO company_receiving_account_reveals/.test(sql))throw new Error('Synthetic reveal audit outage');return all();};
  return statement;
 },async batch(statements:any[]){faults.beforeBatch?.();const result=await base.batch(statements);faults.afterBatch?.();return result;}};
 const env:any={DB,JWT_SECRET:SECRET,KEK_PII:'k'.repeat(48),ENVIRONMENT:'development',GMAIL_CLIENT_ID:'fixture',GMAIL_CLIENT_SECRET:'fixture',GMAIL_REFRESH_TOKEN:'fixture'};
 const app=new Hono<any>();app.route('/api/closings/company-receiving-accounts',accounts);
 async function call(user:number|null,method:string,path='/10',body?:any,impersonated=false){
  const headers:any={'content-type':'application/json'};
  if(user!==null)headers.authorization='Bearer '+await new SignJWT({user_id:user,...(impersonated?{impersonated_by:5}:{})}).setProtectedHeader({alg:'HS256'}).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(SECRET));
  const response=await app.request('/api/closings/company-receiving-accounts'+path,{method,headers,...(body===undefined?{}:{body:JSON.stringify(body)})},env);
  return {status:response.status,headers:response.headers,body:await response.json() as any};
 }
 const one=(sql:string,...args:any[])=>db.prepare(sql).get(...args) as any;
 const rows=(sql:string,...args:any[])=>db.prepare(sql).all(...args) as any[];
 return {db,env,call,one,rows,emails,faults,close(){db.close();globalThis.fetch=originalFetch;}};
}

async function save(f:ReturnType<typeof fixture>,revision=0,number=NUMBER){const r=await f.call(1,'PUT','/10',input(revision,number));assert.equal(r.status,200,JSON.stringify(r.body));return r;}

test('only the company-owning founder sets instructions; no unmasked number or ciphertext is returned or stored in plaintext',async()=>{
 const f=fixture();try{
  for(const user of [null,2,3,5,8]) assert.notEqual((await f.call(user,'PUT','/10',input())).status,200);
  assert.equal((await f.call(1,'GET')).body.recorded,false);
  const r=await save(f);assert.equal(r.body.account.account_number,'••••4821');assert.equal(r.body.account.revision,1);
  const stored=f.one('SELECT * FROM company_receiving_accounts');assert.ok(stored.instructions_enc.startsWith('v1.'));
  for(const raw of [NUMBER,ROUTING,'Fixture Company Inc','Fixture bank']) assert.ok(!JSON.stringify(stored).includes(raw));
  assert.equal((await f.call(4,'GET')).status,404);
  const read=await f.call(3,'GET');assert.equal(read.body.account.account_number,'••••4821');assert.ok(!JSON.stringify(read.body).includes('instructions_enc'));
  assert.match(read.headers.get('cache-control')||'',/no-store/);assert.ok(!JSON.stringify(r.body).includes(NUMBER));
  const audit=f.rows("SELECT * FROM activity_logs WHERE action='company_receiving_account_set'");assert.equal(audit.length,1);assert.equal(audit[0].user_id,1);
  assert.ok(!JSON.stringify(audit).includes(NUMBER));assert.ok(!JSON.stringify(audit).includes('Fixture Company Inc'));
 }finally{f.close();}
});

test('unsigned, unrelated, withdrawn and incomplete investment paper cannot reveal; every successful reveal has a number-free audit first',async()=>{
 const f=fixture();try{
  await save(f);
  for(const user of [null,1,2,4,5,7])assert.notEqual((await f.call(user,'POST','/10/reveal',{commitment_uid:'line-one'})).status,200);
  assert.equal((await f.call(3,'POST','/10/reveal',{commitment_uid:'line-other'})).status,403);
  for(const sql of ["UPDATE esign_envelopes SET document_type='nda' WHERE id=50", "UPDATE esign_envelopes SET status='sent' WHERE id=50", "UPDATE esign_recipients SET status='pending' WHERE id=51", "UPDATE safe_issuances SET amount_cents=10000 WHERE uid='safe-one'","UPDATE safe_issuances SET project_id=20 WHERE uid='safe-one'","UPDATE esign_envelopes SET deal_id=2000 WHERE id=50","UPDATE esign_recipients SET user_id=4 WHERE id=51"]){
   f.db.exec("UPDATE esign_envelopes SET document_type='safe',status='completed',deal_id=1000 WHERE id=50; UPDATE esign_recipients SET status='signed',user_id=3 WHERE id=51; UPDATE safe_issuances SET amount_cents=25000,project_id=10 WHERE uid='safe-one'");f.db.exec(sql);
   assert.equal((await f.call(3,'POST','/10/reveal',{commitment_uid:'line-one'})).status,403);
  }
  f.db.exec("UPDATE safe_issuances SET amount_cents=25000,project_id=10 WHERE uid='safe-one'; UPDATE esign_envelopes SET deal_id=1000 WHERE id=50; UPDATE esign_recipients SET user_id=3 WHERE id=51");
  const r=await f.call(3,'POST','/10/reveal',{commitment_uid:'line-one'});assert.equal(r.status,200,JSON.stringify(r.body));assert.equal(r.body.account.account_number,NUMBER);assert.equal(r.body.expires_in_seconds,30);
  const log=f.rows('SELECT * FROM company_receiving_account_reveals');assert.equal(log.length,1);assert.equal(log[0].actor_user_id,3);assert.equal(log[0].commitment_id,30);assert.ok(!JSON.stringify(log).includes(NUMBER));
  assert.match(r.headers.get('cache-control')||'',/no-store/);
 }finally{f.close();}
});

test('a reveal log failure returns no number, and a revoked signature before the conditional log is refused',async()=>{
 const f=fixture();try{
  await save(f);f.faults.reveal=true;
  const denied=await f.call(3,'POST','/10/reveal',{commitment_uid:'line-one'});assert.equal(denied.status,503);assert.ok(!JSON.stringify(denied.body).includes(NUMBER));assert.equal(f.one('SELECT COUNT(*) AS n FROM company_receiving_account_reveals').n,0);
  f.faults.reveal=false;f.db.exec("UPDATE esign_recipients SET signed_at=NULL WHERE id=51");
  assert.equal((await f.call(3,'POST','/10/reveal',{commitment_uid:'line-one'})).status,403);
 }finally{f.close();}
});

test('a replacement tells every distinct unpaid investor across the company, never paid, withdrawn or foreign investors',async()=>{
 const f=fixture();try{
  await save(f);assert.equal(f.one("SELECT COUNT(*) AS n FROM notifications_inbox WHERE type='company_receiving_account_changed'").n,0);
  await save(f,1,OTHER_NUMBER);
  const notes=f.rows("SELECT user_id,body,link FROM notifications_inbox WHERE type='company_receiving_account_changed' ORDER BY user_id");
  assert.deepEqual(notes.map(x=>x.user_id),[3,9]);for(const n of notes){assert.match(n.body,/changed its receiving account/);assert.match(n.body,/number you already hold before you pay/);assert.ok(!n.body.includes(OTHER_NUMBER));}
  assert.equal(f.emails.length,2);assert.ok(f.emails.some(x=>x.includes('investor@example.test')));assert.ok(f.emails.some(x=>x.includes('second@example.test')));assert.ok(f.emails.every(x=>!x.includes(OTHER_NUMBER)));
  assert.equal(f.one("SELECT status FROM commitments WHERE uid='line-one'").status,'pending');
  assert.equal(f.one('SELECT COUNT(*) AS n FROM company_receiving_accounts WHERE is_active=1').n,1);
  assert.equal((await f.call(3,'POST','/10/reveal',{commitment_uid:'line-one'})).body.account.account_number,OTHER_NUMBER);
 }finally{f.close();}
});

test('same normalized instructions are a no-op; stale revisions do not change the active account or send another notice',async()=>{
 const f=fixture();try{
  await save(f);const r=await save(f,1);assert.equal(r.body.changed,false);assert.equal(f.one('SELECT COUNT(*) AS n FROM company_receiving_accounts').n,1);
  assert.equal((await f.call(1,'PUT','/10',input(0))).status,409);
  const conflict=await f.call(1,'PUT','/10',input(0,OTHER_NUMBER));assert.equal(conflict.status,409);
  assert.equal(f.one('SELECT COUNT(*) AS n FROM company_receiving_accounts').n,1);assert.equal(f.emails.length,0);
 }finally{f.close();}
});

test('concurrent replacements have one winner and the losing write sends no second notice',async()=>{
 const f=fixture();try{
  await save(f);
  const results=await Promise.all([f.call(1,'PUT','/10',input(1,OTHER_NUMBER)),f.call(1,'PUT','/10',input(1,'8834567890128888'))]);
  assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);assert.equal(f.one('SELECT COUNT(*) AS n FROM company_receiving_accounts').n,2);assert.equal(f.emails.length,2);
  assert.equal(f.one("SELECT COUNT(*) AS n FROM activity_logs WHERE action='company_receiving_account_set'").n,2);
 }finally{f.close();}
});

test('the account and its actor record roll back together, and a concurrent owner revocation cannot write',async()=>{
 const f=fixture();try{
  await save(f);f.faults.audit=true;const failed=await f.call(1,'PUT','/10',input(1,OTHER_NUMBER));assert.equal(failed.status,503);
  assert.equal(f.one('SELECT revision FROM company_receiving_accounts WHERE is_active=1').revision,1);assert.equal(f.one('SELECT COUNT(*) AS n FROM company_receiving_accounts').n,1);assert.equal(f.emails.length,0);
  f.faults.audit=false;f.faults.beforeBatch=()=>f.db.exec("UPDATE user_company_links SET is_primary_admin=0 WHERE user_id=1");
  assert.equal((await f.call(1,'PUT','/10',input(1,OTHER_NUMBER))).status,409);assert.equal(f.one('SELECT revision FROM company_receiving_accounts WHERE is_active=1').revision,1);
 }finally{f.close();}
});

test('cut-and-paste ciphertext and a wrong key never reveal; the owner can replace unreadable instructions',async()=>{
 const f=fixture();try{
  await save(f);f.db.exec("UPDATE company_receiving_accounts SET uid='another-row-identity'");
  assert.equal((await f.call(1,'GET')).status,503);const bad=await f.call(3,'POST','/10/reveal',{commitment_uid:'line-one'});assert.equal(bad.status,503);assert.ok(!JSON.stringify(bad.body).includes(NUMBER));
  await save(f,1,OTHER_NUMBER);assert.equal((await f.call(1,'GET')).body.account.account_number,'••••7777');
  f.env.KEK_PII='z'.repeat(48);assert.equal((await f.call(1,'GET')).status,503);await save(f,2,NUMBER);assert.equal((await f.call(3,'POST','/10/reveal',{commitment_uid:'line-one'})).body.account.account_number,NUMBER);
 }finally{f.close();}
});

test('a support session cannot read or change instructions, and a deleted venture loses access',async()=>{
 const f=fixture();try{
  await save(f);assert.equal((await f.call(1,'GET','/10',undefined,true)).status,403);assert.equal((await f.call(1,'PUT','/10',input(1,OTHER_NUMBER),true)).status,403);
  assert.equal((await f.call(3,'POST','/10/reveal',{commitment_uid:'line-one'},true)).status,403);
  f.db.exec("UPDATE projects SET deleted_at='2026-10-26' WHERE id=10");assert.equal((await f.call(1,'GET')).status,404);assert.equal((await f.call(3,'POST','/10/reveal',{commitment_uid:'line-one'})).status,404);
 }finally{f.close();}
});

test('accepting the sender proposal records Sent atomically and never changes Received totals',async()=>{
 const f=fixture();try{
  const before=f.one("SELECT SUM(amount) AS total FROM commitments WHERE status='confirmed'").total;
  const proposal=f.one('SELECT * FROM mercury_investor_proposals WHERE id=81');const user=f.one('SELECT * FROM users WHERE id=3');
  assert.equal((await acceptProposal(f.env,user,proposal)).ok,true);
  const line=f.one('SELECT * FROM commitments WHERE id=30');assert.equal(line.status,'pending');assert.ok(line.sent_at);assert.equal(line.sent_on,'2026-10-15');assert.equal(line.sent_amount_cents,25000);assert.equal(line.sent_currency,'USD');assert.equal(line.sent_by_user_id,3);
  assert.equal(f.one("SELECT SUM(amount) AS total FROM commitments WHERE status='confirmed'").total,before);
  assert.equal(f.one("SELECT COUNT(*) AS n FROM activity_logs WHERE action='closing_sender_reported'").n,1);
  assert.ok(!JSON.stringify(f.rows("SELECT * FROM activity_logs WHERE action='closing_sender_reported'")).includes('25000'));
  assert.equal((await acceptProposal(f.env,user,f.one('SELECT * FROM mercury_investor_proposals WHERE id=81'))).ok,false);
  assert.deepEqual(await ownCommitments(f.env,user),[...(await ownCommitments(f.env,user)).filter((x:any)=>x.id!==30)]);
 }finally{f.close();}
});

test('stale amounts, currency, foreign owners and already received lines cannot become Sent',async()=>{
 const cases=["UPDATE commitments SET amount=500 WHERE id=30","UPDATE deals SET currency='EUR' WHERE id=1000","UPDATE commitments SET investor_user_id=4 WHERE id=30","UPDATE commitments SET status='confirmed' WHERE id=30","UPDATE commitments SET status='withdrawn' WHERE id=30"];
 for(const sql of cases){const f=fixture();try{
  f.db.exec(sql);const p=f.one('SELECT * FROM mercury_investor_proposals WHERE id=81');const result=await acceptProposal(f.env,f.one('SELECT * FROM users WHERE id=3'),p);assert.equal(result.ok,false);
  assert.equal(f.one('SELECT sent_at FROM commitments WHERE id=30').sent_at,null);assert.equal(f.one('SELECT state FROM mercury_investor_proposals WHERE id=81').state,'proposed');
 }finally{f.close();}}
});

test('an audit outage rolls back both the accepted proposal and sender report',async()=>{
 const f=fixture();try{
  f.faults.audit=true;const r=await acceptProposal(f.env,f.one('SELECT * FROM users WHERE id=3'),f.one('SELECT * FROM mercury_investor_proposals WHERE id=81'));assert.equal(r.ok,false);
  assert.equal(f.one('SELECT sent_at FROM commitments WHERE id=30').sent_at,null);assert.equal(f.one('SELECT state FROM mercury_investor_proposals WHERE id=81').state,'proposed');
 }finally{f.close();}
});


test('invalid instructions and unavailable encryption cannot create an account',async()=>{
 const f=fixture();try{
  for(const patch of [{account_number_confirm:'1234'},{routing_number:'000000000'},{routing_number:'021000022'},
   {account_number:'words',account_number_confirm:'words'},{swift_code:'bad'},{currency:''},
   {payee_name:''},{payment_reference:'x'.repeat(121)},{expected_revision:-1}]){
   const r=await f.call(1,'PUT','/10',{...input(),...patch});assert.equal(r.status,400);assert.ok(!JSON.stringify(r.body).includes(NUMBER));
  }
  f.env.ENVIRONMENT='production';delete f.env.KEK_PII;
  assert.equal((await f.call(1,'PUT','/10',input())).status,503);
  assert.equal(f.one('SELECT COUNT(*) AS n FROM company_receiving_accounts').n,0);
 }finally{f.close();}
});

test('a saved account response does not depend on a later database read',async()=>{
 const f=fixture();try{
  f.faults.afterBatch=()=>{f.faults.afterSave=true;};
  const r=await f.call(1,'PUT','/10',input());assert.equal(r.status,200);assert.equal(r.body.account.revision,1);
  assert.equal(f.one('SELECT COUNT(*) AS n FROM company_receiving_accounts').n,1);
 }finally{f.close();}
});

test('an account in another currency cannot be revealed for this line',async()=>{
 const f=fixture();try{
  assert.equal((await f.call(1,'PUT','/10',{...input(),currency:'EUR'})).status,200);
  const r=await f.call(3,'POST','/10/reveal',{commitment_uid:'line-one'});assert.equal(r.status,409);assert.ok(!JSON.stringify(r.body).includes(NUMBER));
 }finally{f.close();}
});

test('concurrent Accepts have one winner and a stale proposal snapshot cannot write a sender report',async()=>{
 const f=fixture();try{
  const user=f.one('SELECT * FROM users WHERE id=3'),p=f.one('SELECT * FROM mercury_investor_proposals WHERE id=81');
  const outcomes=await Promise.all([acceptProposal(f.env,user,p),acceptProposal(f.env,user,p)]);
  assert.deepEqual(outcomes.map(x=>x.ok).sort(),[false,true]);
  assert.equal(f.one("SELECT COUNT(*) AS n FROM activity_logs WHERE action='closing_sender_reported'").n,1);
  // An old in-memory proposed object must not resurrect an already-decided row.
  f.db.exec('UPDATE commitments SET sent_at=NULL,sent_on=NULL,sent_proposal_uid=NULL WHERE id=30');
  const stale=await acceptProposal(f.env,user,p);assert.equal(stale.ok,false);
  assert.equal(f.one('SELECT sent_at FROM commitments WHERE id=30').sent_at,null);
 }finally{f.close();}
});
