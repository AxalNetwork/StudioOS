/** D6557: mounted activity over real migrated SQLite, participant isolation, safe projections and independent source failures. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import relationships from '../src/routes/relationships';
import { migratedDatabase, removeMigratedDatabases } from './_storage_schema.ts';
import { d1Over } from './_d1_sqlite.mjs';
test.after(removeMigratedDatabases);
const secret = 'synthetic-6557-test-only-'.repeat(4);
function fixture() {
  const db = migratedDatabase();
  db.exec(`INSERT INTO users(id,name,email,role,is_active) VALUES
    (2,'Member','member@example.test','partner',1),(3,'Other','other@example.test','partner',1),(4,'Teammate','team@example.test','partner',1);
    INSERT INTO network_connections(id,user_id,name,email,notes) VALUES (21,2,'Private name','private@example.test','Secret note'),(31,3,'Foreign','foreign@example.test','Other note');
    INSERT INTO network_contact_tasks(uid,owner_user_id,contact_id,title,done_at) VALUES
      ('done',2,21,'Private task','2026-11-15 10:00:00'),('foreign',3,31,'Foreign task','2026-11-15 12:00:00'),('pending',2,21,'Pending task',NULL);
    INSERT INTO relationship_interactions(uid,kind,requester_user_id,teammate_user_id,team_key,person_name,note,created_at) VALUES
      ('asked','intro_requested',2,4,'project:1','Private person','Private intro note','2026-11-15 09:00:00'),
      ('accepted','intro_accepted',4,2,'project:1','Private person','Private intro note','2026-11-15 11:00:00'),
      ('made','intro_made',2,4,'project:1','Private person','Private note','2026-11-15 10:30:00'),
      ('declined','intro_declined',4,2,'project:1','Private person','Private note','2026-11-15 10:15:00'),
      ('withdrawn','intro_withdrawn',2,4,'project:1','Private person','Private note','2026-11-15 17:00:00'),
      ('foreign-intro','intro_made',3,4,'project:1','Foreign person','Foreign note','2026-11-15 13:00:00');
    INSERT INTO contact_import_jobs(uid,owner_user_id,source,status,rows_created,finished_at) VALUES
      ('own',2,'linkedin_csv','done',7,'2026-11-15 08:00:00'),('foreign',3,'linkedin_csv','done',99,'2026-11-15 14:00:00'),
      ('pending',2,'linkedin_csv','running',0,NULL),('ordinary',2,'csv','done',88,'2026-11-15 15:00:00');
    INSERT INTO contact_match_reviews(uid,owner_user_id,contact_id,candidate_table,candidate_id,reason,status,decided_at) VALUES
      ('merged',2,21,'network_connections',21,'email','merged','2026-11-15 07:00:00'),
      ('foreign-review',3,31,'network_connections',31,'email','merged','2026-11-15 16:00:00'),
      ('pending',2,21,'network_connections',31,'email','pending',NULL);`);
  const env: any = { DB: d1Over(db), JWT_SECRET: secret, ENVIRONMENT: 'development' };
  const app = new Hono<any>().route('/api/relationships', relationships);
  async function call(who: number | null = 2, query = '', extra = {}) {
    const token = who === null ? null : await new SignJWT({user_id:who,...extra}).setProtectedHeader({alg:'HS256'}).setIssuedAt().setExpirationTime('5m').sign(new TextEncoder().encode(secret));
    const r = await app.request('https://unit.test/api/relationships/activity'+query,{headers:token?{Authorization:`Bearer ${token}`} : {}},env);
    return {status:r.status, body:await r.json() as any};
  }
  return {db,env,call};
}
test('recorded own events are newest first, bounded, with no contact, task, note or email contents', async () => {
  const f=fixture(); const r=await f.call();
  assert.equal(r.status,200); assert.equal(r.body.complete,true);
  assert.deepEqual(r.body.events.map((e:any)=>e.kind),['intro_accepted','intro_made','intro_declined','follow_up_completed','intro_requested','contacts_imported','duplicate_merged']);
  assert.deepEqual(r.body.events[5].label_parts,{action:'Contacts imported',count:7});
  assert.doesNotMatch(JSON.stringify(r.body),/Private|Foreign|Secret|example.test|99|88/);
  assert.equal(Object.values(r.body.sources).every((s:any)=>s.state==='readable'&&s.reason===null),true);
  assert.deepEqual((await f.call(2,'?limit=2')).body.events,r.body.events.slice(0,2));
  assert.equal((await f.call(4)).body.events.filter((e:any)=>e.kind.startsWith('intro_')).length,5);
  assert.equal((await f.call(3)).body.events.length,4);
});
test('source failures preserve available events and explicitly report unreadable, while a readable empty source stays readable', async()=>{
  const f=fixture();f.db.exec('DROP TABLE contact_import_jobs');
  const r=await f.call();assert.equal(r.status,200);assert.equal(r.body.complete,false);
  assert.deepEqual(r.body.sources.imports,{state:'unreadable',reason:'Recorded activity from this source could not be read.'});
  assert.equal(r.body.events.length,6);assert.equal(r.body.sources.follow_ups.state,'readable');
  f.db.exec('DELETE FROM network_contact_tasks');
  const empty=await f.call();assert.equal(empty.body.sources.follow_ups.state,'readable');
  assert.equal(empty.body.events.some((e:any)=>e.kind==='follow_up_completed'),false);
});
test('anonymous and support readers are refused; malformed and excessive limits are refused',async()=>{
  const f=fixture();assert.equal((await f.call(null)).status,401);assert.equal((await f.call(2,'',{impersonated_by:99})).status,403);
  for(const limit of ['','0','51','-1','1.5','wat']) assert.equal((await f.call(2,'?limit='+limit)).status,400);
  assert.equal((await f.call(2,'?limit=50')).status,200);
});
