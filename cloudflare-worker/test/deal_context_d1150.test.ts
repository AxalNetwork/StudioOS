import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import router from '../src/routes/deal_context.ts';
import { tableFromBaseline } from './_baseline.mjs';
import { d1Over } from './_d1_sqlite.mjs';
const baseline = readFileSync('cloudflare-worker/sql/schema_baseline.sql','utf8');
const migration = readFileSync('cloudflare-worker/sql/migrations/600_deal_seen_and_notes.sql','utf8');
const secret = 'unit-test-secret-deal-context-0123456789';
function world() {
  const db = new DatabaseSync(':memory:', {enableForeignKeyConstraints:false});
  for (const t of ['users','projects','deals','deal_invitations','commitments','investor_dealroom_members','company_profiles','user_company_links','dd_cases','dd_reviewers','dd_requests','ic_decisions','ic_votes','esign_envelopes','esign_recipients','documents','pitch_decks','activity_logs']) db.exec(tableFromBaseline(baseline,t));
  // Exact forward schema: 490's rebuilt table, including its expanded CHECK.
  const m = readFileSync('cloudflare-worker/sql/migrations/490_mercury_raise_receipts.sql','utf8');
  const start = m.indexOf('CREATE TABLE mercury_personal_matches_490');
  const end = m.indexOf('\n);',start)+3;
  db.exec(m.slice(start,end).replace('mercury_personal_matches_490','mercury_personal_matches'));
  db.exec(migration); db.exec(migration); // re-runnable, no historical rows
  db.exec(`INSERT INTO users(id,name,email,role,is_active) VALUES (1,'One','one@example.test','investor',1),(2,'Two','two@example.test','investor',1),(3,'Three','three@example.test','investor',1),(4,'Admin','admin@example.test','admin',1),(5,'Founder','founder@example.test','founder',1);
    INSERT INTO projects(id,name) VALUES(7,'Fixture'); INSERT INTO deals(id,project_id,status) VALUES(9,7,'active'),(10,7,'active');
    INSERT INTO company_profiles(id,uid,company_name) VALUES(11,'firm-a','Firm A'),(22,'firm-b','Firm B');
    INSERT INTO user_company_links(uid,user_id,company_id) VALUES('l1',1,11),('l2',2,11),('l3',3,22),('l4',4,11);
    INSERT INTO deal_invitations(deal_id,investor_user_id,company_id) VALUES(9,1,11),(9,2,11),(9,3,22);`);
  const raw = d1Over(db);
  // D1 batch returns SELECT results too; the shared shim's runSync handles writes only.
  const DB = {...raw, prepare(sql: string) {
    const p=raw.prepare(sql); let values: any[]=[]; const bind=p.bind;
    p.bind=(...v: any[])=>{values=v;return bind(...v);};
    if (/^SELECT\b/i.test(sql.trim())) p.runSync=()=>({success:true,results:db.prepare(sql).all(...values),meta:{changes:0,last_row_id:0}});
    return p;
  }};
  const app = new Hono(); app.route('/api/deals',router as any);
  const existing = new Hono(); existing.get('/:id/existing', c=>c.json({existing:true}));
  app.route('/api/deals',existing);
  app.onError((e,c)=>c.json({error:e.message}, e.message==='Unauthorized'?401:500));
  async function call(user=1, suffix='stage', method='GET', body?:any, company?:string, support=false) {
    const tok=await new SignJWT({user_id:user,...(support?{impersonated_by:4}:{})}).setProtectedHeader({alg:'HS256'}).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(secret));
    const response=await app.request(`/api/deals/9/${suffix}`,{method,headers:{Authorization:`Bearer ${tok}`,'Content-Type':'application/json',...(company?{'X-Company-Id':company}:{})},body:body===undefined?undefined:JSON.stringify(body)},{DB,JWT_SECRET:secret,ENVIRONMENT:'development'} as any);
    return {status:response.status,body:await response.json() as any};
  }
  return {db,call,DB};
}
for (const [stage, setup] of [
  ['Invited',''],
  ['Reviewing',"UPDATE deal_invitations SET status='interested' WHERE investor_user_id=1"],
  ['Diligence',"INSERT INTO dd_cases(uid,subject_type,subject_id,subject_label,owner_user_id) VALUES('dd','project',7,'Fixture',1)"],
  ['IC',"INSERT INTO ic_decisions(uid,deal_id,title,created_by,company_id) VALUES('ic',9,'Fixture',1,11)"],
  ['Terms',"INSERT INTO ic_decisions(uid,deal_id,title,terms_json,created_by,company_id) VALUES('ic',9,'Fixture','{\"valuation\":1}',1,11)"],
  ['Committed',"INSERT INTO commitments(deal_id,investor_user_id,company_id,amount,status) VALUES(9,1,11,100,'confirmed')"],
  ['Signed',"INSERT INTO esign_envelopes(envelope_uuid,user_id,deal_id,document_type,document_title,document_body,body_sha256,created_by,status) VALUES('env',1,9,'safe','Fixture','private','hash',5,'completed')"],
  ['Funded',"INSERT INTO commitments(id,deal_id,investor_user_id,company_id,amount,status) VALUES(71,9,1,11,100,'confirmed'); INSERT INTO mercury_personal_matches(uid,user_id,integration_id,mercury_transaction_id,account_last_four,amount_cents,posted_on,target_kind,target_id) VALUES('match',5,1,'private','1234',10000,'2026-10-25','deal_commitment',71)"],
  ['You passed',"UPDATE deal_invitations SET status='passed' WHERE investor_user_id=1"],
  ['Passed by the studio',"UPDATE deals SET status='rejected' WHERE id=9"],
] as const) test(`D1150 stage: ${stage} comes from its own stored fact`,async()=>{
  const {db,call}=world();try {if(setup)db.exec(setup);const r=await call();assert.equal(r.status,200,JSON.stringify(r.body));assert.equal(r.body.my_stage,stage);assert.ok(r.body.next_action.href);assert.equal(Object.keys(r.body).filter(k=>k==='next_action').length,1);assert.doesNotMatch(JSON.stringify(r.body),/private|1234/);} finally{db.close();}
});
test('stage recomputes; IC is Not used only for a firm without recorded IC; foreign facts do not advance me',async()=>{
  const {db,call}=world();try{
    assert.equal((await call()).body.ic.state,'not_used');
    db.exec("INSERT INTO ic_decisions(uid,deal_id,title,created_by,company_id) VALUES('foreign',9,'PRIVATE IC',3,22),('my-other-firm',9,'PRIVATE IC',1,22); INSERT INTO dd_cases(uid,subject_type,subject_id,subject_label,owner_user_id) VALUES('other','project',7,'PRIVATE DD',3); INSERT INTO commitments(deal_id,investor_user_id,company_id,amount,status) VALUES(9,3,22,100,'confirmed')");
    assert.equal((await call()).body.my_stage,'Invited');assert.equal((await call()).body.ic.state,'not_used');
    db.exec("UPDATE deal_invitations SET status='interested' WHERE investor_user_id=1");assert.equal((await call()).body.my_stage,'Reviewing');
    db.exec("INSERT INTO ic_decisions(uid,deal_id,title,created_by,company_id) VALUES('mine',10,'Fixture',1,11)");assert.equal((await call()).body.ic.state,'used');
  }finally{db.close();}
});
test('notes are firm-private, author-edited, and writes are audited without note text',async()=>{
  const {db,call}=world();try{
    const added=await call(1,'notes','POST',{tag:'risk',body:'PRIVATE NOTE'});assert.equal(added.status,201,JSON.stringify(added.body));const uid=added.body.uid;
    assert.equal((await call(2,'notes')).body.items[0].body,'PRIVATE NOTE');assert.equal((await call(3,'notes')).body.total,0);assert.deepEqual((await call(3,'notes')).body.items,[]);
    for(const verb of ['GET','POST','PUT','DELETE']){
      const path=['PUT','DELETE'].includes(verb)?`notes/${uid}`:'notes';assert.equal((await call(4,path,verb,verb==='GET'?undefined:{body:'no'})).status,403);
    }
    assert.equal((await call(2,`notes/${uid}`,'PUT',{body:'no'})).status,404);
    assert.equal((await call(3,`notes/${uid}`,'DELETE')).status,404);
    assert.equal((await call(1,`notes/${uid}`,'PUT',{tag:'team',body:'REVISED PRIVATE'})).status,200);
    assert.equal((await call(1,'notes')).body.items[0].body,'REVISED PRIVATE');
    assert.equal((await call(1,`notes/${uid}`,'DELETE')).status,200);assert.equal((await call(1,'notes')).body.total,0);
    const logs=db.prepare("SELECT user_id,action,details FROM activity_logs ORDER BY id").all() as any[];
    assert.deepEqual(logs.map(l=>l.action),['deal_note_added','deal_note_edited','deal_note_deleted']);assert.ok(logs.every(l=>l.user_id===1));assert.doesNotMatch(JSON.stringify(logs),/PRIVATE|risk|team/);
  }finally{db.close();}
});
test('invalid notes, ambiguous/forged firms and a different deal cannot write or read private notes',async()=>{
  const {db,call}=world();try{
    for(const b of [{body:''},{body:'x'.repeat(10001)},{body:'ok',tag:'x'.repeat(81)}])assert.equal((await call(1,'notes','POST',b)).status,400);
    assert.equal((await call(1,'notes','POST',{body:'no'},'22')).status,403);
    db.exec("INSERT INTO user_company_links(uid,user_id,company_id) VALUES('l5',1,22)");assert.equal((await call()).status,409);assert.equal((await call(1,'stage','GET',undefined,'11')).status,200);
    db.exec('DELETE FROM deal_invitations WHERE investor_user_id=1');assert.equal((await call(1,'notes','POST',{body:'no'},'11')).status,404);
    assert.equal((db.prepare('SELECT COUNT(*) AS n FROM deal_notes').get() as any).n,0);
  }finally{db.close();}
});
test('visit establishes baseline, consumes new facts once, and keeps users/firms separate',async()=>{
  const {db,call}=world();try{
    const first=await call(1,'whats-new');assert.equal(first.status,200,JSON.stringify(first.body));assert.equal(first.body.first_visit,true);assert.deepEqual(first.body.changes,[]);
    db.exec("UPDATE deal_seen SET last_seen_at='2020-01-01T00:00:00Z'; UPDATE deal_invitations SET status='interested',responded_at='2021-01-01 00:00:00' WHERE investor_user_id=1");
    const changed=await call(1,'whats-new');assert.ok(changed.body.changes.some((x:any)=>x.type==='invitation'));
    assert.deepEqual((await call(1,'whats-new')).body.changes,[]);assert.equal((await call(2,'whats-new')).body.first_visit,true);assert.equal((await call(3,'whats-new')).body.first_visit,true);
    assert.equal((db.prepare('SELECT COUNT(*) AS n FROM deal_seen').get() as any).n,3);
  }finally{db.close();}
});
test('unreadable source leaves visit unchanged; failed audit rolls back note write',async()=>{
  const {db,call}=world();try{
    db.exec('DROP TABLE dd_cases');assert.equal((await call(1,'whats-new')).status,503);assert.equal((db.prepare('SELECT COUNT(*) AS n FROM deal_seen').get() as any).n,0);
    db.exec('DROP TABLE activity_logs');assert.equal((await call(1,'notes','POST',{body:'PRIVATE'})).status,503);assert.equal((db.prepare('SELECT COUNT(*) AS n FROM deal_notes').get() as any).n,0);
  }finally{db.close();}
});

test('pending commitments count as Committed; an NDA never claims investment Signed',async()=>{
  const {db,call}=world();try{
    db.exec("INSERT INTO commitments(deal_id,investor_user_id,company_id,amount,status) VALUES(9,1,11,100,'pending')");assert.equal((await call()).body.my_stage,'Committed');
    db.exec("DELETE FROM commitments; INSERT INTO esign_envelopes(envelope_uuid,user_id,deal_id,document_type,document_title,document_body,body_sha256,created_by,status) VALUES('nda',1,9,'investor_nda_axal','Fixture','PRIVATE','hash',5,'completed')");assert.equal((await call()).body.my_stage,'Invited');
  }finally{db.close();}
});
test('no-firm notes remain author-only and null-company visits have one watermark',async()=>{
  const {db,call}=world();try{
    db.exec('DELETE FROM user_company_links WHERE user_id IN(1,2); UPDATE deal_invitations SET company_id=NULL WHERE investor_user_id IN(1,2)');
    const added=await call(1,'notes','POST',{body:'OWN ONLY'});assert.equal(added.status,201,JSON.stringify(added.body));assert.equal((await call(2,'notes')).body.total,0);assert.deepEqual((await call(2,'notes')).body.items,[]);
    assert.equal((await call(1,'whats-new')).body.first_visit,true);assert.equal((await call(1,'whats-new')).body.first_visit,false);
    assert.equal((db.prepare('SELECT COUNT(*) AS n FROM deal_seen').get() as any).n,1);
  }finally{db.close();}
});
test('visit exposes metadata for documents, firm notes, anonymous commitments and accessible DD answers only',async()=>{
  const {db,call}=world();try{
    await call(1,'whats-new');db.exec("UPDATE deal_seen SET last_seen_at='2020-01-01T00:00:00Z'; INSERT INTO pitch_decks(project_id,slides,created_at) VALUES(7,'PRIVATE SLIDES','2021-01-01'); INSERT INTO documents(project_id,title,content,created_at,updated_at) VALUES(7,'PRIVATE FILE','PRIVATE CONTENT','2021-01-01','2021-01-01'); INSERT INTO deal_notes(deal_id,author_user_id,company_id,body,updated_at) VALUES(9,2,11,'PRIVATE FIRM NOTE','2021-01-01'),(9,3,22,'FOREIGN NOTE','2021-01-01'); INSERT INTO commitments(deal_id,investor_user_id,company_id,amount) VALUES(9,3,22,101); INSERT INTO dd_cases(id,uid,subject_type,subject_id,subject_label,owner_user_id) VALUES(40,'dd','project',7,'PRIVATE DD',1),(41,'other','project',7,'FOREIGN DD',3); INSERT INTO dd_requests(case_id,title,responded_at) VALUES(40,'PRIVATE ANSWER','2021-01-01'),(41,'FOREIGN ANSWER','2021-01-01')");
    const r=await call(1,'whats-new');assert.equal(r.status,200);for(const type of ['deck','document','firm_note','investor_commitment','diligence_answer'])assert.ok(r.body.changes.some((c:any)=>c.type===type),type);
    assert.equal(r.body.changes.filter((c:any)=>c.type==='firm_note').length,1);assert.equal(r.body.changes.filter((c:any)=>c.type==='diligence_answer').length,1);assert.doesNotMatch(JSON.stringify(r.body),/PRIVATE|FOREIGN|example/);
    assert.deepEqual((await call(1,'whats-new')).body.changes,[]);
  }finally{db.close();}
});

test('support impersonation cannot read or write private deal context', async()=>{ const {db,call}=world();try{ assert.equal((await call(1,'notes','GET',undefined,undefined,true)).status,403); assert.equal((await call(1,'notes','POST',{body:'no'},undefined,true)).status,403); }finally{db.close();} });

test('a record created in the visit second is still new, with concurrent visits consuming it once',async()=>{
  const {db,call}=world();try{
    const baseline=await call(1,'whats-new');assert.equal(baseline.status,200);
    const second=baseline.body.seen_at.slice(0,19).replace('T',' ');
    db.prepare('INSERT INTO documents(project_id,title,created_at,updated_at) VALUES(7,?,?,?)').run('PRIVATE',second,second);
    const pair=await Promise.all([call(1,'whats-new'),call(1,'whats-new')]);
    assert.equal(pair.flatMap(r=>r.body.changes).filter((c:any)=>c.type==='document').length,1);
    assert.deepEqual((await call(1,'whats-new')).body.changes,[]);
  }finally{db.close();}
});

test('new route guards do not wrap a sibling router on the existing deal mount',async()=>{
  const {db,call}=world();try{
    assert.deepEqual(await call(1,'existing','GET',undefined,undefined,true),{status:200,body:{existing:true}});
    assert.equal((await call(1,'notes','GET',undefined,undefined,true)).status,403);
  }finally{db.close();}
});
test('a missing source timestamp remains unrecorded metadata, not a failed visit',async()=>{
  const {db,call}=world();try{
    await call(1,'whats-new');db.exec("INSERT INTO pitch_decks(project_id,slides,created_at) VALUES(7,'PRIVATE',NULL)");
    const r=await call(1,'whats-new');assert.equal(r.status,200);assert.ok(r.body.changes.some((c:any)=>c.type==='deck' && c.at===null));assert.deepEqual((await call(1,'whats-new')).body.changes,[]);
  }finally{db.close();}
});

test('a slow older visit cannot replace the newer visit snapshot',async()=>{
  const {db,call,DB}=world();try{
    await call(1,'whats-new');
    let release!:()=>void, captured!:()=>void;
    const waiting=new Promise<void>(r=>{release=r;}), started=new Promise<void>(r=>{captured=r;});
    const prepare=DB.prepare;let first=true;
    DB.prepare=(sql:string)=>{const stmt=prepare(sql);if(sql.startsWith('SELECT id, updated_at AS at FROM documents')){const all=stmt.all;stmt.all=async()=>{const rows=await all();if(first){first=false;captured();await waiting;}return rows;};}return stmt;};
    const slow=call(1,'whats-new');await started;
    db.exec("INSERT INTO documents(project_id,title) VALUES(7,'PRIVATE')");
    const fresh=await call(1,'whats-new');assert.ok(fresh.body.changes.some((c:any)=>c.type==='document'));
    release();const old=await slow;assert.deepEqual(old.body.changes,[]);
    assert.deepEqual((await call(1,'whats-new')).body.changes,[]);
  }finally{db.close();}
});
