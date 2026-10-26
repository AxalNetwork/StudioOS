/** D1208: actual reader SQL on the baseline plus every post-cutoff migration. */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync, mkdtempSync, copyFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BASELINE_CUTOFF, migrationNumber } from '../../scripts/lib/migrationPlan.mjs';
import { d1Over } from './_d1_sqlite.mjs';
import { interviewCallEvents, complianceDueEvents, dealClosingEvents, cohortDateEvents } from '../src/services/calendar/sourceReaders.ts';

const root = mkdtempSync(join(tmpdir(), 'calendar-d1208-'));
const seed = join(root, 'seed.sqlite');
const initial = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
initial.exec(readFileSync('cloudflare-worker/sql/schema_baseline.sql','utf8'));
const dir = 'cloudflare-worker/sql/migrations';
for (const n of readdirSync(dir).filter(n=>/^\d+_.*\.sql$/.test(n) && migrationNumber(n)>BASELINE_CUTOFF).sort()) initial.exec(readFileSync(`${dir}/${n}`,'utf8'));
initial.prepare('VACUUM INTO ?').run(seed);initial.close();
after(()=>rmSync(root,{recursive:true,force:true}));
let serial=0;
const FROM='2026-11-01T00:00:00.000Z', TO='2026-12-01T00:00:00.000Z';
function fixture() {
 const path=join(root,`${++serial}.sqlite`);copyFileSync(seed,path);
 const db=new DatabaseSync(path,{enableForeignKeyConstraints:false});
 db.exec(`INSERT INTO users(id,role,name,email,founder_id,is_active) VALUES
  (1,'founder','Fixture founder','one@example.test',101,1),(2,'founder','Other founder','two@example.test',102,1),
  (3,'advisor','Fixture advisor','three@example.test',NULL,1),(4,'investor','Fixture investor','four@example.test',NULL,1),
  (5,'admin','Fixture admin','five@example.test',101,1),(6,'investor','Other investor','six@example.test',NULL,1),
  (7,'advisor','Other advisor','seven@example.test',NULL,1),(8,'exploring','Fixture Lab member','eight@example.test',108,1);
 INSERT INTO projects(id,name,founder_id) VALUES(10,'Fixture venture',101),(20,'Other venture',102);
 INSERT INTO deals(id,uid,project_id,closing_deadline) VALUES(100,'deal-one',10,'2026-11-15'),(200,'deal-two',20,'2026-11-16');
 INSERT INTO investor_dealroom_members(investor_user_id,deal_id) VALUES(4,100),(6,200);
 INSERT INTO cohort_cycles(id,year,month,start_at,end_at,status) VALUES
 (10,2026,11,'2026-11-01T04:00:00Z','2026-11-30T05:00:00Z','active'),
 (20,2026,12,'2026-12-01T05:00:00Z','2026-12-31T05:00:00Z','scheduled');
 INSERT INTO week_windows(cohort_cycle_id,week_number,unlock_at,deadline_at) VALUES
 (10,1,'2026-11-01T04:00:00Z','2026-11-08T04:59:00Z'),(10,2,'2026-11-08T05:00:00Z','2026-11-15T04:59:00Z'),
 (20,1,'2026-12-01T05:00:00Z','2026-12-08T04:59:00Z');
 INSERT INTO advisor_cohort_assignments(uid,advisor_user_id,cohort_cycle_id,is_active) VALUES('assignment-one',3,10,1),('assignment-two',7,20,1);
 UPDATE users SET spinout_lab_active=1,spinout_lab_started_at='2026-11-02T10:00:00Z' WHERE id IN(1,8);
 INSERT INTO compliance_events(uid,project_id,jurisdiction,event_type,title,due_date) VALUES
 ('filing-one',10,'US','annual_report','Fixture annual filing','2026-11-10'),('filing-two',20,'US','annual_report','Other annual filing','2026-11-11');
 INSERT INTO discovery_interviews(id,project_id,interviewee_name) VALUES(11,10,'Fixture person'),(21,20,'Other person');
 INSERT INTO interview_sessions(id,uid,interview_id,project_id,created_by_user_id,channel) VALUES
 (11,'session-one',11,10,1,'video'),(21,'session-two',21,20,2,'video');
 INSERT INTO interview_channel_refs(id,uid,provider,external_ref,session_id,interview_id,user_id,join_url,starts_at,ends_at) VALUES
 (11,'call-one','zoom','synthetic-one',11,11,1,'https://example.test/one','2026-11-03 12:00:00','2026-11-03 12:30:00'),
 (21,'call-two','google_meet','synthetic-two',21,21,2,'https://example.test/two','2026-11-04T12:00:00Z','2026-11-04T12:30:00Z');`);
 const env:any={DB:d1Over(db)};return {db,env};
}
const read=(reader:any,env:any,user:number,from=FROM,to=TO)=>reader(env,user,from,to);

test('interview calls belong only to their recorded owner, with normalized UTC time and names, never another admin calendar',async()=>{
 const {db,env}=fixture();try{
  const events=await read(interviewCallEvents,env,1);assert.equal(events.length,1);assert.equal(events[0].source_uid,'call-one');
  assert.equal(events[0].title,'Interview · Fixture person');assert.equal(events[0].start_at,'2026-11-03T12:00:00.000Z');assert.equal(events[0].end_at,'2026-11-03T12:30:00.000Z');
  assert.equal(events[0].location_uri,'https://example.test/one');assert.equal(events[0].all_day,false);assert.deepEqual(events[0].attendees,[]);
  assert.deepEqual(await read(interviewCallEvents,env,5),[]);assert.equal((await read(interviewCallEvents,env,2))[0].source_uid,'call-two');
  db.exec("UPDATE interview_channel_refs SET status='cancelled' WHERE id=11");assert.deepEqual(await read(interviewCallEvents,env,1),[]);
 }finally{db.close();}
});

test('interview boundaries normalize SQLite timestamps, exclude the upper boundary, inactive owners and deleted ventures',async()=>{
 const {db,env}=fixture();try{
  assert.equal((await read(interviewCallEvents,env,1,'2026-11-03T12:00:00Z','2026-11-03T12:01:00Z')).length,1);
  assert.deepEqual(await read(interviewCallEvents,env,1,FROM,'2026-11-03T12:00:00Z'),[]);
  db.exec('UPDATE users SET is_active=0 WHERE id=1');assert.deepEqual(await read(interviewCallEvents,env,1),[]);
  db.exec("UPDATE users SET is_active=1 WHERE id=1; UPDATE projects SET deleted_at='2026-11-01' WHERE id=10");assert.deepEqual(await read(interviewCallEvents,env,1),[]);
 }finally{db.close();}
});

test('filings are the founder-owned venture deadlines, dated all day with exclusive ends; completed and foreign filings stay out',async()=>{
 const {db,env}=fixture();try{
  const e=await read(complianceDueEvents,env,1);assert.deepEqual(e.map((x:any)=>[x.source_uid,x.start_at,x.end_at,x.all_day,x.project_id]),[['filing-one','2026-11-10','2026-11-11',true,10]]);
  assert.deepEqual(await read(complianceDueEvents,env,5),[]);assert.deepEqual(await read(complianceDueEvents,env,3),[]);
  assert.equal((await read(complianceDueEvents,env,2))[0].source_uid,'filing-two');
  assert.deepEqual(await read(complianceDueEvents,env,1,FROM,'2026-11-10T00:00:00Z'),[]);
  assert.deepEqual(await read(complianceDueEvents,env,1,'2026-11-11T00:00:00Z',TO),[]);
  db.exec("UPDATE compliance_events SET completion_status='completed' WHERE uid='filing-one'");assert.deepEqual(await read(complianceDueEvents,env,1),[]);
 }finally{db.close();}
});

test('closings require this investor deal-room membership and cannot be inherited through a staff role',async()=>{
 const {db,env}=fixture();try{
  const e=await read(dealClosingEvents,env,4);assert.deepEqual(e.map((x:any)=>[x.source_uid,x.start_at,x.all_day,x.deal_id]),[['deal-one','2026-11-15',true,100]]);
  assert.equal((await read(dealClosingEvents,env,6))[0].source_uid,'deal-two');assert.deepEqual(await read(dealClosingEvents,env,5),[]);
  db.exec("UPDATE users SET role='admin' WHERE id=4");assert.deepEqual(await read(dealClosingEvents,env,4),[]);
  db.exec("UPDATE users SET role='investor' WHERE id=4; DELETE FROM investor_dealroom_members WHERE investor_user_id=4");assert.deepEqual(await read(dealClosingEvents,env,4),[]);
 }finally{db.close();}
});

test('cohort dates follow the Lab gate and assigned advisor scope, include opens/deadlines/end once, with stable unique IDs',async()=>{
 const {db,env}=fixture();try{
  const e=await read(cohortDateEvents,env,3);assert.equal(e.length,5);assert.equal(new Set(e.map((x:any)=>x.id)).size,5);
  assert.deepEqual(e.map((x:any)=>x.start_at),['2026-11-01','2026-11-07','2026-11-08','2026-11-14','2026-11-30']);
  assert.ok(e.every((x:any)=>x.all_day&&x.attendees.length===0));assert.deepEqual((await read(cohortDateEvents,env,1)).map((x:any)=>x.id),e.map((x:any)=>x.id));
  assert.equal((await read(cohortDateEvents,env,8)).length,5,'admitted Lab members need not have the founder role');
  assert.deepEqual(await read(cohortDateEvents,env,7),[]);assert.deepEqual(await read(cohortDateEvents,env,5),[]);
  db.exec('UPDATE advisor_cohort_assignments SET is_active=0 WHERE advisor_user_id=3');assert.deepEqual(await read(cohortDateEvents,env,3),[]);
  db.exec("UPDATE advisor_cohort_assignments SET is_active=1 WHERE advisor_user_id=3; UPDATE users SET role='investor' WHERE id=3");assert.deepEqual(await read(cohortDateEvents,env,3),[]);
 }finally{db.close();}
});

test('cohort range selects each all-day obligation individually, never the cycle entire window',async()=>{
 const {db,env}=fixture();try{
  const e=await read(cohortDateEvents,env,3,'2026-11-07T00:00:00Z','2026-11-08T00:00:00Z');assert.equal(e.length,1);assert.match(e[0].title,/Week 1 due/);
  assert.deepEqual(await read(cohortDateEvents,env,3,'2026-11-20T00:00:00Z','2026-11-21T00:00:00Z'),[]);
 }finally{db.close();}
});

test('missing tables and malformed query results fail visibly rather than returning a fabricated empty source',async()=>{
 const {db,env}=fixture();try{
  db.exec('DROP TABLE compliance_events');await assert.rejects(read(complianceDueEvents,env,1));
  const missing:any={DB:{prepare(){return {bind(){return this;},async all(){return {};}};}}};
  for(const reader of [interviewCallEvents,complianceDueEvents,dealClosingEvents,cohortDateEvents]) await assert.rejects(read(reader,missing,1),/calendar_source_unreadable/);
 }finally{db.close();}
});

test('every source excludes an inactive or deletion-requested member',async()=>{
 const {db,env}=fixture();try{
  for(const [reader,user] of [[interviewCallEvents,1],[complianceDueEvents,1],[dealClosingEvents,4],[cohortDateEvents,3]] as const){
   assert.ok((await read(reader,env,user)).length>0);
   db.prepare('UPDATE users SET is_active=0 WHERE id=?').run(user);assert.deepEqual(await read(reader,env,user),[]);
   db.prepare("UPDATE users SET is_active=1,deletion_requested_at='2026-11-01' WHERE id=?").run(user);assert.deepEqual(await read(reader,env,user),[]);
   db.prepare('UPDATE users SET deletion_requested_at=NULL WHERE id=?').run(user);
  }
 }finally{db.close();}
});


test('funded and rejected deals have no outstanding closing deadline',async()=>{
 const {db,env}=fixture();try{
  for(const status of ['applied','scored','active','funded','rejected']) {
   db.prepare('UPDATE deals SET status=? WHERE id=100').run(status);
   assert.equal((await read(dealClosingEvents,env,4)).length,['funded','rejected'].includes(status)?0:1,status);
  }
 }finally{db.close();}
});

test('cohort due days use New York across DST, even when UTC has moved to the next day',async()=>{
 const {db,env}=fixture();try{
  const e=await read(cohortDateEvents,env,3,'2026-11-07T00:00:00Z','2026-11-08T00:00:00Z');
  assert.deepEqual(e.map((x:any)=>[x.start_at,x.end_at]),[['2026-11-07','2026-11-08']]);
  const end=await read(cohortDateEvents,env,3,'2026-11-29T00:00:00Z','2026-12-01T00:00:00Z');
  assert.deepEqual(end.map((x:any)=>x.start_at),['2026-11-30']);
 }finally{db.close();}
});

test('call offsets normalize to UTC and an absent end adds no invented duration',async()=>{
 const {db,env}=fixture();try{
  db.exec("UPDATE interview_channel_refs SET starts_at='2026-11-03T14:00:00+02:00',ends_at=NULL WHERE id=11");
  const e=await read(interviewCallEvents,env,1);
  assert.equal(e[0].start_at,'2026-11-03T12:00:00.000Z');assert.equal(e[0].end_at,e[0].start_at);
 }finally{db.close();}
});
