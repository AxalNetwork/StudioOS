/** D1115: the mounted host writer stores an instant in the event's zone. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {SignJWT} from 'jose';
import events from '../src/routes/events.ts';
import adminEvents from '../src/routes/admin_events.ts';
import {makeD1} from './_d1_sqlite.mjs';
function fixture(){
 const ddl=['109_events_core.sql','392_event_organiser.sql','546_events_review_columns.sql'].map(n=>readFileSync(new URL('../sql/migrations/'+n,import.meta.url),'utf8')).join('\n');
 const f=makeD1(ddl+`CREATE TABLE users(id INTEGER PRIMARY KEY,uid TEXT,email TEXT,name TEXT,role TEXT,is_active INTEGER DEFAULT 1,display_name TEXT);
 CREATE TABLE projects(id INTEGER PRIMARY KEY,name TEXT);
 CREATE TABLE activity_logs(user_id INTEGER,action TEXT,details TEXT,actor TEXT);
 CREATE TABLE admin_audit_log(admin_user_id INTEGER,action TEXT,report_type TEXT,filters_json TEXT,actor TEXT);
 INSERT INTO users VALUES(1,'host','host@example.invalid','Synthetic host','founder',1,NULL),(2,'other','other@example.invalid','Synthetic other','founder',1,NULL);`);
 const secret=randomBytes(32);const env:any={DB:f.DB,ENVIRONMENT:'development',JWT_SECRET:secret.toString('hex')};
 return {...f,async request(path:string,body:any,method='POST',user=1,router:any=events){
  const token=await new SignJWT({user_id:user}).setProtectedHeader({alg:'HS256'}).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(env.JWT_SECRET));
  return router.request(path,{method,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify(body)},env);
 }};
}
test('create and edit round-trip selected-zone wall times, retaining explicit instants',async()=>{
 const f=fixture();try{
  const r=await f.request('/',{title:'Synthetic zoned event',starts_at:'2026-07-12T18:30',ends_at:'2026-07-12T20:00',timezone:'Europe/Lisbon'});
  assert.equal(r.status,201);const e=(await r.json()).event;
  assert.equal(e.starts_at,'2026-07-12T17:30:00.000Z');assert.equal(e.ends_at,'2026-07-12T19:00:00.000Z');
  const edited=await f.request('/'+e.id,{starts_at:'2026-12-12T18:30',ends_at:null},'PATCH');
  assert.equal(edited.status,200);const next=(await edited.json()).event;
  assert.equal(next.starts_at,'2026-12-12T18:30:00.000Z');assert.equal(next.ends_at,null);
  const explicit=await f.request('/'+e.id,{starts_at:'2026-11-01T01:30:00-05:00',timezone:'America/New_York'},'PATCH');
  assert.equal(explicit.status,200);assert.equal((await explicit.json()).event.starts_at,'2026-11-01T06:30:00.000Z');
  const zoneOnly=await f.request('/'+e.id,{timezone:'Asia/Kathmandu'},'PATCH');assert.equal(zoneOnly.status,200);assert.equal((await zoneOnly.json()).event.starts_at,'2026-11-01T06:30:00.000Z');
  const invalidEdit=await f.request('/'+e.id,{starts_at:'bad'},'PATCH');assert.equal(invalidEdit.status,400);
  assert.equal((await f.request('/'+e.id,{starts_at:'2026-12-12T19:30'},'PATCH',2)).status,403);
  assert.equal(f.db.prepare('SELECT starts_at FROM events WHERE id=?').get(e.id).starts_at,'2026-11-01T06:30:00.000Z');
 }finally{f.db.close();}
});
test('invalid zones, dates and DST gaps/folds refuse before creating an event',async()=>{
 const f=fixture();try{
  for(const [starts_at,timezone,code] of [
   ['2026-07-12T18:30','Invalid/Zone','invalid_timezone'],['2026-02-30T18:30','UTC','invalid_event_time'],
   ['2026-03-08T02:30','America/New_York','nonexistent_event_time'],['2026-11-01T01:30','America/New_York','ambiguous_event_time'],
  ]){const r=await f.request('/',{title:'Synthetic invalid time',starts_at,timezone});assert.equal(r.status,400);assert.equal((await r.json()).error,code);}
  assert.equal(f.db.prepare('SELECT count(*) n FROM events').get().n,0);
 }finally{f.db.close();}
});
test('format-only time normalization does not flag an approved event; a real time change does',async()=>{
 const f=fixture();try{
  const r=await f.request('/',{title:'Synthetic approved schedule',starts_at:'2026-07-12T17:30:00Z',ends_at:'2026-07-12T19:00:00Z',timezone:'Europe/Lisbon'});assert.equal(r.status,201);const e=(await r.json()).event;
  f.db.prepare("UPDATE events SET starts_at='2026-07-12T17:30:00Z',ends_at='2026-07-12 19:00:00',admin_published=1,status='published',approved_at='2026-01-01T00:00:00Z' WHERE id=?").run(e.id);
  const same=await f.request('/'+e.id,{starts_at:'2026-07-12T17:30:00.000Z',ends_at:'2026-07-12T19:00:00Z'},'PATCH');assert.equal(same.status,200);
  assert.equal(f.db.prepare('SELECT changed_after_approval_at FROM events WHERE id=?').get(e.id).changed_after_approval_at,null);
  const changed=await f.request('/'+e.id,{starts_at:'2026-07-12T19:00'},'PATCH');assert.equal(changed.status,200);const next=(await changed.json()).event;
  assert.equal(next.status,'published');assert.ok(next.changed_after_approval_at);assert.equal(next.starts_at,'2026-07-12T18:00:00.000Z');
 }finally{f.db.close();}
});

test('the mounted paged desk read carries counts for the oldest event beyond the first 200',async()=>{
 const f=fixture();try{
  f.db.prepare("UPDATE users SET role='admin' WHERE id=1").run();
  const insert=f.db.prepare("INSERT INTO events(id,slug,host_user_id,title,starts_at,status) VALUES(?,?,1,?,'2099-01-12T17:30:00Z','published')");
  for(let id=1;id<=205;id++)insert.run(id,'synthetic-'+id,'Synthetic event '+id);
  for(const [i,status] of ['registered','confirmed','attended','waitlisted'].entries())f.db.prepare('INSERT INTO event_registrations(event_id,email,status) VALUES(1,?,?)').run('synthetic-'+i+'@example.invalid',status);
  const a=await f.request('/?limit=200&offset=0',undefined,'GET',1,adminEvents);const b=await f.request('/?limit=200&offset=200',undefined,'GET',1,adminEvents);
  assert.equal(a.status,200);assert.equal(b.status,200);const first=await a.json(),second=await b.json();
  assert.equal(first.events.length,200);assert.equal(second.events.length,5);assert.equal(first.total,205);
  assert.equal(new Set([...first.events,...second.events].map((e:any)=>e.id)).size,205);
  const oldest=second.events.find((e:any)=>e.id===1);assert.ok(oldest);assert.equal(oldest.seats_taken,3);assert.equal(oldest.attended,1);assert.equal(oldest.waitlisted,1);
 }finally{f.db.close();}
});
