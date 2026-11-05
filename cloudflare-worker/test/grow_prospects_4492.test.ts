/** D4492: real migrated SQLite, scoped prospects, explicit consent and HMAC-only suppression. No sending. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import router from '../src/routes/grow_prospects.ts';
import { indexHmac } from '../src/services/columnCipher.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { loadSchema } from './_schema_once.mjs';
const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';

const FOUNDER = 1; const COFOUNDER = 2; const ADVISOR = 3; const PARTNER = 4; const ADMIN = 5; const OTHER = 6;
const PA = 7; const PB = 8;

/** The baseline plus every post-cutoff migration, restored between tests. */
let pristine: DatabaseSync | undefined;
// Build every migration once; a savepoint restores the exact pristine database before each sequential test.
function build(): DatabaseSync {
  if (pristine) { pristine.exec('ROLLBACK TO campaign_fixture'); return pristine; }
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON;');
  loadSchema(db);
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
  db.exec('SAVEPOINT campaign_fixture');
  pristine = db;
  return db;
}

function seed(db: DatabaseSync) {
  db.exec(`INSERT INTO founders (id, name, email) VALUES (10, 'Founder A', 'fa@example.test'), (20, 'Founder B', 'fb@example.test');`);
  const u = db.prepare('INSERT INTO users (id, email, name, role, founder_id) VALUES (?, ?, ?, ?, ?)');
  u.run(FOUNDER, 'founder@example.test', 'Fay Founder', 'founder', 10);
  u.run(COFOUNDER, 'cofounder@example.test', 'Cal Cofounder', 'founder', null);
  u.run(ADVISOR, 'advisor@example.test', 'Ada Advisor', 'founder', null);
  u.run(PARTNER, 'partner@example.test', 'Pat Partner', 'partner', null);
  u.run(ADMIN, 'admin@example.test', 'Ari Admin', 'admin', null);
  u.run(OTHER, 'other@example.test', 'Oli Other', 'founder', 20);
  db.exec(`INSERT INTO projects (id, name, founder_id) VALUES (${PA}, 'Kestrel Labs', 10), (${PB}, 'Heron Works', 20);
    INSERT INTO project_members (project_id, user_id, role, status) VALUES (${PA}, ${COFOUNDER}, 'cofounder', 'accepted'), (${PA}, ${ADVISOR}, 'advisor', 'accepted');
    INSERT INTO roadmap_okrs (id, project_id, objective) VALUES (1, ${PA}, 'CSV export'), (2, ${PB}, 'Heron item');
    INSERT OR IGNORE INTO research_countries (code, name, region) VALUES ('ES', 'Spain', 'Europe');`);
}

function fixture() {
  const db = build();
  seed(db);
  return { db, env: { JWT_SECRET, ENVIRONMENT: 'development', DB: d1Over(db) } as any };
}

const app = new Hono<any>();
app.route('/api/grow/prospects', router);
const ROLE: Record<number, string> = { [FOUNDER]: 'founder', [COFOUNDER]: 'founder', [ADVISOR]: 'founder', [PARTNER]: 'partner', [ADMIN]: 'admin', [OTHER]: 'founder' };

async function call(f: { env: any }, who: number, method: string, path: string, body?: unknown) {
  const token = await new SignJWT({ user_id: who, role: ROLE[who] }).setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const res = await app.fetch(new Request(`http://t${path}`, {
    method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  }), f.env, { waitUntil() {}, passThroughOnException() {} } as any);
  const text = await res.text();
  try { return { status: res.status, body: JSON.parse(text) as any }; } catch { throw new Error(`${method} ${path} → ${res.status}: ${text.slice(0, 300)}`); }
}

const read=(f:any,path='',who=FOUNDER,pid=PA)=>call(f,who,'GET',`/api/grow/prospects${path}${path.includes('?')?'&':'?'}project=${pid}`);
const write=(f:any,path='',body:Record<string,unknown>={},method='POST',who=FOUNDER,pid=PA)=>call(f,who,method,`/api/grow/prospects${path}`,{project:pid,...body});
const add=(f:any,body:Record<string,unknown>={},who=FOUNDER,pid=PA)=>write(f,'',{name:'Synthetic prospect',email:'lead@example.test',basis:'none',...body},'POST',who,pid);
const get=(f:any,sql:string,...args:any[])=>f.db.prepare(sql).get(...args) as any;

test('pipeline has seven real counts, source/campaign filtering and no email in cards, even in old display fields',async()=>{
  const f=fixture();
  f.db.exec("INSERT INTO grow_campaigns(uid,project_id,name,goal,status,utm_campaign,created_by,updated_by) VALUES('campaign-a',7,'Plan','signups','draft','plan',1,1)");
  const states=['new','invited','contacted','replied','qualified','active','passed'];
  for(const status of states){const made=await add(f,{email:`${status}@example.test`,source:'import',campaign:'campaign-a'});assert.equal(made.status,201,JSON.stringify(made.body));await write(f,`/${made.body.uid}/status`,{status},'PATCH');}
  await add(f,{name:'email-in-name@example.test',company:'email-in-company@example.test',email:'manual@example.test'});
  const all=await read(f);assert.equal(all.status,200,JSON.stringify(all.body));
  assert.deepEqual(all.body.columns.map((c:any)=>c.status),states);
  assert.deepEqual(all.body.columns.map((c:any)=>c.count),[2,1,1,1,1,1,1]);assert.equal(all.body.total,8);
  assert.doesNotMatch(JSON.stringify(all.body),/@|"email"/);
  const filtered=await read(f,'?source=import&campaign=campaign-a');assert.equal(filtered.body.total,7);
  assert.equal((await read(f,'?source=manual')).body.total,1);
  const empty=await read(f,'?source=website');assert.equal(empty.body.total,0);
  assert.equal((await read(f,'?source=not-a-source')).status,400);
});

test('individual details alone expose the contact email; venture isolation and Grow writer rules apply',async()=>{
  const f=fixture();const made=await add(f);assert.equal(made.status,201);
  const uid=made.body.uid;
  assert.equal((await read(f,`/${uid}`,ADVISOR)).body.email,'lead@example.test');
  assert.equal((await read(f,`/${uid}`,OTHER,PB)).status,404);
  assert.equal((await add(f,{},ADVISOR)).status,403);
  assert.equal((await write(f,`/${uid}/status`,{status:'active'},'PATCH',ADVISOR)).status,403);
  assert.equal((await write(f,`/${uid}/consent/email`,{basis:'none'},'PUT',ADVISOR)).status,403);
  assert.equal((await add(f,{email:'cofounder@example.test'},COFOUNDER)).status,201);
  assert.equal((await add(f,{},PARTNER)).status,403);
  assert.equal((await write(f,`/${uid}/status`,{status:'unknown'},'PATCH')).status,400);
});

test('each explicit consent basis is recorded with session actor, proof and channel; invalid inputs refuse',async()=>{
  const f=fixture();const uid=(await add(f)).body.uid;
  for(const basis of ['opted_in','wrote_first','none']){
    const saved=await write(f,`/${uid}/consent/email`,{basis,proof:'Form fixture dated 1 Nov',recorded_by:OTHER},'PUT',COFOUNDER);
    assert.equal(saved.status,200,JSON.stringify(saved.body));
    const row=get(f,'SELECT * FROM contact_marketing_consents WHERE channel=?','email');
    assert.equal(row.basis,basis);assert.equal(row.recorded_by,COFOUNDER);assert.equal(row.proof,basis==='none'?null:'Form fixture dated 1 Nov');
  }
  assert.equal((await write(f,`/${uid}/consent/email`,{basis:'assumed',proof:'private-cell'},'PUT')).status,400);
  assert.equal((await write(f,`/${uid}/consent/email`,{basis:'opted_in'},'PUT')).status,400);
  assert.equal((await write(f,`/${uid}/consent/email`,{basis:'opted_in',proof:'x'.repeat(281)},'PUT')).status,400);
  assert.equal((await write(f,`/${uid}/consent/unknown`,{basis:'none'},'PUT')).status,400);
  assert.equal((await write(f,`/${uid}/consent/email`,{basis:'none'},'PUT',OTHER,PB)).status,404);
});

test('suppression stores only a venture-separated HMAC, never plaintext, and is scoped and idempotent',async()=>{
  const f=fixture();
  assert.equal((await write(f,'/suppressions',{email:'  LEAD@example.test ',reason:'opted_out'})).status,201);
  assert.equal((await write(f,'/suppressions',{email:'lead@example.test',reason:'manual'})).status,201);
  const row=get(f,'SELECT * FROM venture_suppressions WHERE project_id=?',PA);
  assert.equal(row.address_hash,await indexHmac(f.env,'venture_suppressions','address_hash',`${PA}:lead@example.test`));
  assert.match(row.address_hash,/^[a-f0-9]{64}$/);assert.doesNotMatch(JSON.stringify(row),/lead|@|example/i);
  assert.equal((await read(f,'/suppressions/count')).body.count,1);
  assert.doesNotMatch(JSON.stringify((await read(f,'/suppressions/count')).body),/@|address_hash/);
  await write(f,'/suppressions',{email:'lead@example.test'},'POST',OTHER,PB);
  assert.notEqual(get(f,'SELECT address_hash FROM venture_suppressions WHERE project_id=?',PB).address_hash,row.address_hash);
  assert.equal((await write(f,`/suppressions/${row.id}`,{},'DELETE',OTHER,PB)).status,404);
  assert.equal((await write(f,`/suppressions/${row.id}`,{},'DELETE')).status,200);
  assert.equal((await read(f,'/suppressions/count')).body.count,0);
  assert.equal((await write(f,'/suppressions',{email:'hidden@example.test',reason:'hidden@example.test'})).status,400);
  assert.doesNotMatch(JSON.stringify(get(f,"SELECT details FROM activity_logs WHERE action='grow.suppression.add' LIMIT 1")),/@/);
});

test('summary counts explicit channel permissions and no-consent separately, excludes suppression and other ventures',async()=>{
  const f=fixture();
  await add(f,{email:'opt@example.test',basis:'opted_in',proof:'Form 1'});
  const second=(await add(f,{email:'wrote@example.test',basis:'wrote_first',proof:'Inbound message 2'})).body.uid;
  await write(f,`/${second}/consent/whatsapp`,{basis:'opted_in',proof:'Form 2'},'PUT');
  await add(f,{email:'none@example.test'});
  f.db.exec("INSERT INTO contacts(uid,project_id,audience,routed_to,name,email,status) VALUES('legacy',7,'customer','discovery','Legacy','legacy@example.test','new')");
  await add(f,{email:'other@example.test',basis:'opted_in',proof:'Other form'},OTHER,PB);
  await write(f,'/suppressions',{email:'opt@example.test'});
  const summary=(await read(f,'/consent-summary')).body;
  assert.equal(summary.available,true);assert.equal(summary.email_reachable,1);assert.equal(summary.no_consent,2);
  assert.deepEqual(summary.per_channel,{email:2,whatsapp:1,telegram:0,sms:0,voice:0,linkedin:0});
  assert.equal(summary.opted_in.email,1);
  f.db.exec("INSERT INTO customer_segments(id,project_id,name,name_norm) VALUES(1,7,'Segment','segment'),(2,8,'Other','other')");
  const unknown=(await read(f,'/consent-summary?segment=1')).body;
  assert.equal(unknown.available,false);assert.equal(unknown.email_reachable,null);assert.match(unknown.reason,/Not recorded/);
  assert.equal((await read(f,'/consent-summary?segment=2')).status,404);
});

test('CSV consent is explicit per row; bad rows report number and field without values; limits refuse',async()=>{
  const f=fixture();const csv='name,email,consent_basis,consent_proof\nA,valid@example.test,opted_in,Form fixture\nPrivate,private-cell,none,\nB,b@example.test,assumed,private-proof';
  const imported=await write(f,'/import',{csv});assert.equal(imported.status,200,JSON.stringify(imported.body));
  assert.equal(imported.body.imported,1);assert.deepEqual(imported.body.errors.map((r:any)=>[r.row,r.field]),[[3,'email'],[4,'consent_basis']]);
  assert.doesNotMatch(JSON.stringify(imported.body),/@|private-cell|private-proof/);
  assert.equal(get(f,'SELECT COUNT(*) AS n FROM contacts').n,1);
  assert.equal(get(f,'SELECT basis FROM contact_marketing_consents').basis,'opted_in');
  assert.equal((await write(f,'/import',{csv:'name,email\nA,a@example.test'})).status,400);
  assert.equal((await write(f,'/import',{csv:'name,email,consent_basis\n'+Array.from({length:1001},()=> 'A,a@example.test,none').join('\n')})).status,400);
  assert.equal((await write(f,'/import',{csv:'name,email,consent_basis\n"A,a@example.test,none'})).status,400);
});

test('quiet hours are unknown until saved; validation, actor audit and failure messages are safe',async()=>{
  const f=fixture();const empty=(await read(f,'/settings')).body;assert.equal(empty.settings,null);assert.match(empty.reason,/Not recorded/);
  for(const body of [{quiet_from:'24:00',quiet_to:'08:00',tz_mode:'recipient'},{quiet_from:'20:00',quiet_to:'20:00',tz_mode:'recipient'},{quiet_from:'20:00',quiet_to:'08:00',tz_mode:'UTC'}])assert.equal((await write(f,'/settings',body,'PUT')).status,400);
  const saved=await write(f,'/settings',{quiet_from:'20:00',quiet_to:'08:00',tz_mode:'recipient'},'PUT');
  assert.equal(saved.status,200);assert.equal(saved.body.settings.quiet_from,'20:00');assert.equal(saved.body.settings.tz_mode,'recipient');
  assert.equal((await write(f,'/settings',{quiet_from:'20:00',quiet_to:'08:00',tz_mode:'recipient'},'PUT',ADVISOR)).status,403);
  assert.equal(get(f,'SELECT updated_by FROM venture_outreach_settings').updated_by,FOUNDER);
  f.db.exec('DROP TABLE contact_marketing_consents');
  const failed=await read(f,'/consent-summary');assert.equal(failed.status,503);assert.doesNotMatch(JSON.stringify(failed.body),/no such table|contact_marketing_consents|email_reachable/);
});

test('a contact and consent roll back together when the consent insert cannot commit; nothing invokes a sender',async()=>{
  const f=fixture();f.db.exec("CREATE TRIGGER test_refuse_marketing BEFORE INSERT ON contact_marketing_consents BEGIN SELECT RAISE(ABORT,'synthetic failure detail'); END");
  const result=await add(f,{basis:'opted_in',proof:'Synthetic form'});assert.equal(result.status,503);
  assert.equal(get(f,'SELECT COUNT(*) AS n FROM contacts').n,0);
  assert.doesNotMatch(JSON.stringify(result.body),/synthetic failure detail|@/);
});

test('capture, invited status, consent and suppression never call a sending provider',async()=>{
  const f=fixture();const previous=globalThis.fetch;let sent=0;
  globalThis.fetch=async()=>{sent++;throw Error('Unexpected external call');};
  try{
    const made=await add(f,{basis:'opted_in',proof:'Form fixture'});assert.equal(made.status,201);
    assert.equal((await write(f,`/${made.body.uid}/status`,{status:'invited'},'PATCH')).status,200);
    assert.equal((await write(f,`/${made.body.uid}/consent/sms`,{basis:'none'},'PUT')).status,200);
    assert.equal((await write(f,'/suppressions',{email:'lead@example.test'})).status,201);
    assert.equal(sent,0);
  }finally{globalThis.fetch=previous;}
});

test('legacy source aliases stay accurate and unvalidated task/UTM text cannot leak an email into cards',async()=>{
  const f=fixture();const made=await add(f);
  f.db.prepare('UPDATE contacts SET source=?,utm_json=? WHERE uid=?').run('linkedin',JSON.stringify({utm_campaign:'private@example.test'}),made.body.uid);
  const id=get(f,'SELECT id FROM contacts WHERE uid=?',made.body.uid).id;
  f.db.prepare('INSERT INTO contact_tasks(contact_id,title,due_date) VALUES(?,?,?)').run(id,'Follow up','private@example.test');
  const reply=await read(f,'?source=linkedin_csv');assert.equal(reply.body.total,1);
  assert.equal(reply.body.columns[0].cards[0].source,'linkedin_csv');
  assert.doesNotMatch(JSON.stringify(reply.body),/@|private/);
});

test('missing production HMAC key fails closed, and a campaign without attribution is unknown rather than empty',async()=>{
  const f=fixture();f.env.STUDIOOS_ENV='production';
  const refused=await write(f,'/suppressions',{email:'private@example.test'});assert.equal(refused.status,503);
  assert.doesNotMatch(JSON.stringify(refused.body),/@|KEK_PII|secret|key/);
  assert.equal(get(f,'SELECT COUNT(*) AS n FROM venture_suppressions').n,0);
  delete f.env.STUDIOOS_ENV;
  f.db.exec("INSERT INTO grow_campaigns(uid,project_id,name,goal,status,created_by,updated_by) VALUES('untagged',7,'Plan','demos','draft',1,1)");
  const unknown=(await read(f,'?campaign=untagged')).body;assert.equal(unknown.available,false);assert.equal(unknown.total,null);
  assert.match(unknown.reason,/Not recorded/);
  assert.equal((await add(f,{campaign:'untagged'})).status,400);
});


test('a changed HMAC key refuses reachability until the suppression key is restored',async()=>{
  const f=fixture();f.env.KEK_PII='a'.repeat(32);
  await add(f,{basis:'opted_in',proof:'Synthetic form'});
  assert.equal((await write(f,'/suppressions',{email:'lead@example.test'})).status,201);
  assert.equal((await read(f,'/consent-summary')).body.email_reachable,0);
  f.env.KEK_PII='b'.repeat(32);
  const changed=await read(f,'/consent-summary');assert.equal(changed.status,503);
  assert.doesNotMatch(JSON.stringify(changed.body),/@|email_reachable/);
  f.env.KEK_PII='a'.repeat(32);
  assert.equal((await read(f,'/consent-summary')).body.email_reachable,0);
});


test('legacy unsupported contact status makes the pipeline unknown instead of understating its total',async()=>{
  const f=fixture();const made=await add(f);
  f.db.prepare('UPDATE contacts SET status=? WHERE uid=?').run('legacy-stage',made.body.uid);
  const result=await read(f);assert.equal(result.status,200);assert.equal(result.body.available,false);
  assert.equal(result.body.total,null);assert.match(result.body.reason,/unsupported status/);
});

test('CSV batch-boundary failure keeps earlier rows complete and rolls back the entire failing row',async()=>{
  const f=fixture();
  f.db.exec("CREATE TRIGGER test_boundary BEFORE INSERT ON contact_marketing_consents WHEN (SELECT email FROM contacts WHERE id=NEW.contact_id)='boundary@example.test' BEGIN SELECT RAISE(ABORT,'private-boundary-failure'); END");
  const csv='name,email,consent_basis\n'+Array.from({length:20},(_,i)=>`Fixture ${i},fixture-${i}@example.test,none`).join('\n')+'\nBoundary,boundary@example.test,none';
  const result=await write(f,'/import',{csv});assert.equal(result.status,503);
  assert.equal(get(f,'SELECT COUNT(*) AS n FROM contacts').n,20);
  assert.equal(get(f,'SELECT COUNT(*) AS n FROM contact_marketing_consents').n,20);
  assert.equal(get(f,"SELECT COUNT(*) AS n FROM activity_logs WHERE action='grow.prospect.add'").n,20);
  assert.equal(get(f,"SELECT COUNT(*) AS n FROM contacts WHERE email='boundary@example.test'").n,0);
  assert.deepEqual(f.db.prepare('PRAGMA foreign_key_check').all(),[]);
  assert.doesNotMatch(JSON.stringify(result.body),/@|private-boundary-failure/);
});
