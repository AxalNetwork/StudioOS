/** D642 — real caller-only route and SQL over the production table declarations. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import usage from '../src/routes/usage.ts';
import { readStorageUsage } from '../src/services/storageUsage.ts';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';
import { tableFromBaseline } from './_baseline.mjs';
import { d1Over } from './_d1_sqlite.mjs';

const SECRET = 'unit-test-secret-d642-012345678901234567';
const baseline = readFileSync('cloudflare-worker/sql/schema_baseline.sql', 'utf8');
const KEYS = ['data_room','diligence_files','research_library','message_attachments','interview_recordings'];
const TABLES = ['data_room_files','dd_attachments','research_documents','message_attachments','discovery_interviews'];
function fixture() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
  for (const name of ['users','super_admins','user_sessions','founders','projects','data_room_files','dd_attachments','research_documents','discovery_interviews']) {
    db.exec(tableFromBaseline(baseline, name));
  }
  db.exec(readFileSync('cloudflare-worker/sql/migrations/323_message_attachments.sql', 'utf8'));
  db.exec(`INSERT INTO founders(id,name,email) VALUES(101,'One','one@example.test'),(202,'Two','two@example.test');
    INSERT INTO users(id,role,name,email,founder_id,is_active) VALUES
      (11,'investor','One','one@example.test',101,1),(22,'founder','Two','two@example.test',202,1),
      (33,'admin','HQ','hq@example.test',NULL,1),(44,'founder','Inactive','inactive@example.test',NULL,0);
    INSERT INTO super_admins(user_id) VALUES(33);
    INSERT INTO projects(id,name,founder_id) VALUES(701,'First company',101),(702,'Second company',101),(703,'Another member',202);`);
  const room = db.prepare('INSERT INTO data_room_files(uid,project_id,name,r2_key,size_bytes,uploaded_by_user_id) VALUES(?,?,?,?,?,?)');
  room.run('room-a',701,'A','room/private-a',10,11); room.run('room-b',703,'B','room/private-b',20,11);
  room.run('room-other',701,'Other','room/private-other',1000,22);
  const dd = db.prepare('INSERT INTO dd_attachments(case_id,file_key,filename,size_bytes,uploaded_by_user_id) VALUES(1,?,?,?,?)');
  dd.run('dd/private-a','A',30,11); dd.run('dd/private-b','B',40,11); dd.run('dd/private-other','Other',1000,22);
  const research = db.prepare('INSERT INTO research_documents(uid,owner_user_id,title,r2_key,size_bytes) VALUES(?,?,?,?,?)');
  research.run('research-a',11,'A','research/private-a',50); research.run('research-other',22,'Other','research/private-other',1000);
  const message = db.prepare("INSERT INTO message_attachments(uid,thread_id,message_id,uploader_user_id,r2_key,filename,content_type,size_bytes,sha256) VALUES(?,1,1,?,?,'file','text/plain',?,'hash')");
  message.run('msg-a',11,'messages/private-a',60); message.run('msg-b',11,'messages/private-b',70); message.run('msg-other',22,'messages/private-other',1000);
  const interview = db.prepare('INSERT INTO discovery_interviews(project_id,interviewee_name,recording_r2_key,recording_size_bytes) VALUES(?,?,?,?)');
  interview.run(701,'A','validate-audio/private-a',80); interview.run(702,'B','validate-audio/private-b',90);
  interview.run(703,'Other','validate-audio/private-other',1000);
  interview.run(701,'No file',null,null); interview.run(701,'Stale size',null,500);
  interview.run(701,'Empty key','',600); interview.run(701,'Blank key','   ',700);
  interview.run(999,'Orphan project','validate-audio/orphan',1000);
  return db;
}
const app = new Hono<any>();
app.route('/api/usage', usage);
app.onError((err,c) => c.json({error:err.message}, (AUTH_ERROR_STATUSES[err.message] || 500) as any));
async function call(db: DatabaseSync, who: number | null = 11, query = '') {
  const headers: Record<string,string> = {};
  if (who !== null) headers.Authorization = `Bearer ${await new SignJWT({ user_id: who }).setProtectedHeader({alg:'HS256'}).setIssuedAt().setExpirationTime('5m').sign(new TextEncoder().encode(SECRET))}`;
  const response = await app.request(`https://unit.test/api/usage/storage${query}`, {headers}, {DB:d1Over(db),JWT_SECRET:SECRET});
  return {response,body:await response.json() as any};
}
const area = (body: any, key: string) => body.areas.find((row:any)=>row.key===key);

test('D642: every area counts only the caller, across companies, and recording ownership uses founder profile IDs', async () => {
  const db=fixture(); const {response,body}=await call(db);
  assert.equal(response.status,200); assert.equal(response.headers.get('cache-control'),'private, no-store');
  assert.deepEqual(body,{total_bytes:450,files:9,unknown_size_files:0,areas:[
    {key:'data_room',files:2,bytes:30,unknown_size_files:0,recorded:true},
    {key:'diligence_files',files:2,bytes:70,unknown_size_files:0,recorded:true},
    {key:'research_library',files:1,bytes:50,unknown_size_files:0,recorded:true},
    {key:'message_attachments',files:2,bytes:130,unknown_size_files:0,recorded:true},
    {key:'interview_recordings',files:2,bytes:170,unknown_size_files:0,recorded:true},
  ]});
  const other=await call(db,22); assert.equal(other.body.total_bytes,5000); assert.equal(other.body.files,5);
  // No names, keys, IDs, contents, or another member's credentials leave this aggregate.
  assert.deepEqual(Object.keys(body).sort(),['areas','files','total_bytes','unknown_size_files']);
  for(const row of body.areas) assert.deepEqual(Object.keys(row).sort(),['bytes','files','key','recorded','unknown_size_files']);
});

test('D642: changing or forging company, project and user selectors never changes the caller-only usage', async()=>{
  const db=fixture(); const original=(await call(db)).body;
  for(const query of ['?company_id=701','?company_id=702','?company_id=703&user_id=22&project_id=703','?user_id=33&company_id=%27%20OR%201=1--']) {
    assert.deepEqual((await call(db,11,query)).body,original,query);
  }
});

test('D642: NULL sizes in every nullable store are unknown, never zero or an exact byte total',async()=>{
  for(const [key,sql] of [
    ['data_room',"UPDATE data_room_files SET size_bytes=NULL WHERE uid='room-a'"],
    ['diligence_files',"UPDATE dd_attachments SET size_bytes=NULL WHERE file_key='dd/private-a'"],
    ['research_library',"UPDATE research_documents SET size_bytes=NULL WHERE uid='research-a'"],
    ['interview_recordings',"UPDATE discovery_interviews SET recording_size_bytes=NULL WHERE recording_r2_key='validate-audio/private-a'"],
  ]) {
    const db=fixture(); db.exec(sql); const body=(await call(db)).body;
    assert.equal(body.total_bytes,null,key); assert.equal(body.files,9,key); assert.equal(body.unknown_size_files,1,key);
    assert.equal(area(body,key).bytes,null,key); assert.equal(area(body,key).recorded,true,key);
    assert.equal(area(body,key).unknown_size_files,1,key);
    assert.equal(body.areas.filter((r:any)=>r.bytes===null).length,1,key);
  }
});

test('D642: a truly empty area is recorded zero, and an HQ admin still sees only their own files',async()=>{
  const db=fixture(); const body=(await call(db,33)).body;
  assert.equal(body.files,0); assert.equal(body.total_bytes,0); assert.equal(body.unknown_size_files,0);
  assert.deepEqual(body.areas,KEYS.map(key=>({key,files:0,bytes:0,unknown_size_files:0,recorded:true})));
  db.prepare("UPDATE data_room_files SET size_bytes=0 WHERE uid='room-a'").run();
  const changed=(await call(db)).body; assert.equal(changed.total_bytes,440); assert.equal(changed.files,9);
});

test('D642: each failed store marks only its area unreadable and leaves all other results intact',async()=>{
  for(let i=0;i<TABLES.length;i++) {
    const db=fixture(); const original=(await call(db)).body;
    db.exec(`DROP TABLE ${TABLES[i]}`); const {response,body}=await call(db);
    assert.equal(response.status,200); assert.equal(body.total_bytes,null); assert.equal(body.files,null); assert.equal(body.unknown_size_files,null);
    assert.deepEqual(area(body,KEYS[i]),{key:KEYS[i],files:null,bytes:null,unknown_size_files:null,recorded:false});
    assert.deepEqual(body.areas.filter((r:any)=>r.key!==KEYS[i]),original.areas.filter((r:any)=>r.key!==KEYS[i]));
  }
  const db=fixture(); db.exec('DROP TABLE projects'); const body=(await call(db)).body;
  assert.equal(area(body,'interview_recordings').recorded,false); assert.equal(area(body,'data_room').recorded,true);
});

test('D642: unsafe byte totals are unknown rather than rounded, and SQLite overflow is an unreadable area',async()=>{
  const db=fixture(); db.prepare("UPDATE research_documents SET size_bytes=? WHERE uid='research-a'").run(Number.MAX_SAFE_INTEGER);
  let body=await readStorageUsage(d1Over(db) as any,11);
  assert.equal(body.total_bytes,null); assert.equal(body.files,9); assert.equal(body.unknown_size_files,0);
  assert.equal(area(body,'research_library').bytes,Number.MAX_SAFE_INTEGER); assert.equal(area(body,'research_library').recorded,true);
  db.prepare("UPDATE research_documents SET size_bytes=? WHERE uid='research-a'").run(2n**62n);
  db.prepare("INSERT INTO research_documents(uid,owner_user_id,title,r2_key,size_bytes) VALUES('huge',11,'Huge','research/huge',?)").run(2n**62n);
  body=await readStorageUsage(d1Over(db) as any,11);
  assert.equal(area(body,'research_library').recorded,false); assert.equal(body.total_bytes,null);
  assert.equal(area(body,'data_room').bytes,30);
});

test('D642: no session or an inactive account cannot read usage',async()=>{
  const db=fixture();
  for(const who of [null,44]) {
    const {response,body}=await call(db,who); assert.equal(response.status,401); assert.equal(body.areas,undefined);
  }
});

test('D642: the production entrypoint mounts the tested Usage router',()=>{
  const index=readFileSync('cloudflare-worker/src/index.ts','utf8');
  assert.match(index,/import usage from '.\/routes\/usage';/);
  assert.match(index,/app\.route\('\/api\/usage', usage\);/);
});
