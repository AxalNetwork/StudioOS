/** D6430: real migrated SQLite and mounted deal activity, with each source's own privacy gates. Synthetic records only.
 *
 * From cloudflare-worker/test/README.md (moved by #6472): D6430: mounted real-SQLite data-room
 * grant/folder/tier/NDA isolation, exact-firm deck grants, anonymous signature events, bounds and
 * per-source failures.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import deals from '../src/routes/deals';
import { migratedDatabase, removeMigratedDatabases } from './_storage_schema.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors';
test.after(removeMigratedDatabases);
const secret='synthetic-6430-test-only-'.repeat(4);
function fixture(){
 const db=migratedDatabase();
 db.exec(`INSERT INTO users(id,role,name,email,is_active,founder_id) VALUES (1,'admin','Staff','staff@example.test',1,NULL),(2,'investor','Investor Alpha','a@example.test',1,NULL),(3,'investor','Investor Beta','b@example.test',1,NULL),(5,'founder','Owner','owner@example.test',1,50);
 INSERT INTO projects(id,uid,name,founder_id) VALUES(10,'p-10','Synthetic venture',50),(20,'p-20','Foreign venture',500);
 INSERT INTO deals(id,project_id) VALUES(1,10);
 INSERT INTO deal_invitations(deal_id,investor_user_id,status) VALUES(1,2,'interested'),(1,3,'invited');
 INSERT INTO data_room_folders(id,uid,project_id,name) VALUES(11,'f-11',10,'Allowed'),(12,'f-12',10,'Hidden');
 INSERT INTO data_room_files(id,uid,project_id,folder_id,name,r2_key,visibility,created_at) VALUES
 (21,'file-21',10,11,'Allowed file','synthetic/21','open','2026-11-01 10:00:00'),(22,'file-22',10,12,'Hidden file','synthetic/22','open','2026-11-02 10:00:00'),(23,'file-23',10,11,'NDA file','synthetic/23','nda','2026-11-03 10:00:00'),(24,'file-24',10,11,'Committed file','synthetic/24','open','2026-11-03 11:00:00');
 UPDATE data_room_files SET access_tier='committed' WHERE id=24;
 INSERT INTO data_room_file_versions(file_id,version,r2_key,created_at) VALUES(21,1,'synthetic/old','2026-11-04 10:00:00'),(22,1,'synthetic/hidden-old','2026-11-05 10:00:00');
 INSERT INTO data_room_grants(id,uid,project_id,investor_user_id,granted_by_user_id,folders_scoped) VALUES(31,'grant-31',10,2,5,1);
 INSERT INTO data_room_grant_folders(grant_id,folder_id) VALUES(31,11);
 INSERT INTO pitch_decks(id,project_id,version,title,is_current,slides) VALUES(41,10,2,'Synthetic deck',1,'[]');
 INSERT INTO deck_grants(uid,deal_id,deck_id,investor_user_id,granted_by,created_at) VALUES('deck-2',1,41,2,5,'2026-11-06 10:00:00');
 INSERT INTO esign_envelopes(id,envelope_uuid,document_type,document_title,document_body,body_sha256,created_by) VALUES(51,'nda-51','nda','Synthetic NDA','Synthetic text','synthetic',5),(52,'nda-52','nda','Synthetic NDA','Synthetic text','synthetic',5);
 INSERT INTO pairwise_ndas(party_a_user_id,party_b_user_id,nda_envelope_uuid,status) VALUES(5,2,'nda-51','pending'),(5,3,'nda-52','active');
 INSERT INTO esign_recipients(envelope_id,user_id,recipient_email,signing_token,token_expires_at,status,signed_at) VALUES(51,2,'a@example.test','unit-51','2099-01-01','signed','2026-11-07 10:00:00'),(52,3,'b@example.test','unit-52','2099-01-01','signed','2026-11-08 10:00:00');`);
 const app=new Hono<any>().route('/api/deals',deals);app.onError((e,c)=>c.json({error:'refused'},(AUTH_ERROR_STATUSES[e.message]||500) as any));
 async function read(who=2,extra={},headers={},binding?:any){const token=await new SignJWT({user_id:who,...extra}).setProtectedHeader({alg:'HS256'}).setIssuedAt().setExpirationTime('5m').sign(new TextEncoder().encode(secret));const r=await app.request('https://unit.test/api/deals/1/activity',{headers:{Authorization:`Bearer ${token}`,...headers}},{DB:binding??d1Over(db),JWT_SECRET:secret,ENVIRONMENT:'development'} as any);return{status:r.status,body:await r.json() as any};}
 return{db,read};
}
test('grants expose only admitted files and versions; folder, tier, NDA, expiry and revocation continue to apply',async()=>{
 const f=fixture();let r=await f.read();assert.equal(r.status,200,JSON.stringify(r.body));let text=JSON.stringify(r.body);assert.match(text,/File added: Allowed file/);assert.match(text,/New version of Allowed file/);assert.doesNotMatch(text,/Hidden file|NDA file|Committed file/);
 assert.equal((await f.read(3)).body.some((e:any)=>e.type==='file_added'||e.type==='file_version'),false);
 f.db.exec("UPDATE pairwise_ndas SET status='active' WHERE party_b_user_id=2");assert.match(JSON.stringify((await f.read()).body),/File added: NDA file/);
 f.db.exec("UPDATE data_room_files SET access_expires_at='2000-01-01' WHERE id=21");assert.doesNotMatch(JSON.stringify((await f.read()).body),/Allowed file/);
 f.db.exec("UPDATE data_room_grants SET status='revoked' WHERE id=31");assert.equal((await f.read()).body.some((e:any)=>e.type==='file_added'||e.type==='file_version'),false);
 assert.equal((await f.read(1)).body.some((e:any)=>e.type==='file_added'),false,'plain admin is not an audited room reader');
 assert.match(JSON.stringify((await f.read(5)).body),/File added: Hidden file/);
});
test('deck events require the current own firm grant; owner/admin see shared versions; NDA rows never name another investor',async()=>{
 const f=fixture();const a=await f.read();assert.equal(a.body.filter((e:any)=>e.type==='deck_shared').length,1);assert.match(JSON.stringify(a.body),/Deck version 2 shared/);assert.equal((await f.read(3)).body.some((e:any)=>e.type==='deck_shared'),false);
 assert.equal(a.body.filter((e:any)=>e.type==='nda_signed').length,1);assert.deepEqual(a.body.find((e:any)=>e.type==='nda_signed'),{type:'nda_signed',kind:'documents',label:'You signed the NDA',at:'2026-11-07 10:00:00',mine:true});
 for(const who of [1,5]){const r=await f.read(who);assert.equal(r.body.filter((e:any)=>e.type==='deck_shared').length,1);assert.equal(r.body.filter((e:any)=>e.type==='nda_signed'&&e.label==='An investor signed the NDA').length,2);assert.doesNotMatch(JSON.stringify(r.body.filter((e:any)=>e.kind==='documents')),/Investor Alpha|Investor Beta|example.test|signing_token|synthetic\/21/);}
 f.db.exec("UPDATE deck_grants SET revoked_at='2026-11-09' WHERE uid='deck-2'");assert.equal((await f.read()).body.some((e:any)=>e.type==='deck_shared'),false);
 assert.equal((await f.read(2,{impersonated_by:1})).status,403);
});
test('each failed source adds exactly its unreadable row while other sources and deal activity survive',async()=>{
 for(const [table,word] of [['data_room_grant_folders','Data room'],['data_room_file_versions','Data room'],['deck_grants','Deck version'],['esign_recipients','NDA signature']] as const){const f=fixture();f.db.exec(`DROP TABLE ${table}`);const r=await f.read();assert.equal(r.status,200);assert.equal(r.body.filter((e:any)=>e.type==='unreadable'&&e.label===word+' activity could not be read').length,1);assert.equal(r.body.some((e:any)=>e.type==='created'),true);const other=table==='deck_grants'?'nda_signed':'deck_shared';assert.equal(r.body.some((e:any)=>e.type===other),true);}
});
test('newest-N applies after access filtering and never returns another project',async()=>{
 const f=fixture();const add=f.db.prepare('INSERT INTO data_room_file_versions(file_id,version,r2_key,created_at) VALUES(?,?,?,?)');for(let i=2;i<=70;i++)add.run(21,i,'synthetic/'+i,`2026-11-${String(i%25+1).padStart(2,'0')} 12:00:00`);
 const r=await f.read();const files=r.body.filter((e:any)=>e.type==='file_added'||e.type==='file_version');assert.equal(files.length,50);assert.equal(files[0].at,'2026-11-25 12:00:00');assert.equal(files.every((e:any)=>e.kind==='documents'),true);for(let i=1;i<files.length;i++)assert.ok(Date.parse(files[i-1].at)>=Date.parse(files[i].at));
});

test('a grant for another firm never opens a deck without that firm’s deal relationship',async()=>{
 const f=fixture();f.db.exec("INSERT INTO company_profiles(id,uid,company_name) VALUES(10,'f10','One'),(20,'f20','Two'); INSERT INTO user_company_links(uid,company_id,user_id) VALUES('l10',10,2),('l20',20,2); UPDATE deal_invitations SET company_id=10 WHERE investor_user_id=2; UPDATE deck_grants SET company_id=20 WHERE uid='deck-2'");
 const wrong=await f.read(2,{}, {'X-Company-Id':'20'});assert.equal(wrong.status,200);assert.equal(wrong.body.some((e:any)=>e.type==='deck_shared'),false);
 f.db.exec("UPDATE deck_grants SET company_id=10 WHERE uid='deck-2'");assert.equal((await f.read(2,{}, {'X-Company-Id':'10'})).body.some((e:any)=>e.type==='deck_shared'),true);
 assert.equal((await f.read(2,{}, {'X-Company-Id':'999'})).body.some((e:any)=>e.type==='deck_shared'),false);
});


test('Trash hides file and version activity from admitted readers; restoration brings it back', async () => {
 const f=fixture();
 const names=async(who:number)=>JSON.stringify((await f.read(who)).body.filter((e:any)=>e.type==='file_added'||e.type==='file_version'));
 for(const who of [2,5]) assert.match(await names(who),/Allowed file/);
 f.db.exec("UPDATE data_room_files SET removed_at='2026-11-17 00:00:00' WHERE id=21");
 for(const who of [2,5]) assert.doesNotMatch(await names(who),/Allowed file/);
 f.db.exec('UPDATE data_room_files SET removed_at=NULL WHERE id=21');
 for(const who of [2,5]){const text=await names(who);assert.match(text,/File added: Allowed file/);assert.match(text,/New version of Allowed file/);}
});

test('removal after file admission still hides file and version events', async () => {
 const f=fixture(), base=d1Over(f.db);let removed=false;
 const binding={...base,prepare(sql:string){
  const wrap=(s:any):any=>({
   bind:(...args:any[])=>wrap(s.bind(...args)),
   first:(...args:any[])=>s.first(...args),run:()=>s.run(),
   all:async()=>{const result=await s.all();if(!removed&&sql.includes('SELECT id, name, visibility')){removed=true;f.db.exec("UPDATE data_room_files SET removed_at='2026-11-17 00:00:00' WHERE id=21");}return result;},
  });return wrap(base.prepare(sql));
 }};
 const result=await f.read(2,{}, {},binding);
 assert.equal(result.status,200);assert.equal(removed,true,'the removal happened between admission and event reads');
 assert.doesNotMatch(JSON.stringify(result.body),/Allowed file/);
 assert.ok(result.body.some((e:any)=>e.type==='deck_shared'),'other sources remain readable');
});
