/** D6636: mounted names-only shared-resource candidates and consent requests on the real migrated schema. Synthetic people only.
 *
 * From cloudflare-worker/test/README.md (moved by #6472): D6636: real migrated SQLite
 * authorization, consent, failure and concurrency regressions.
 */
import test from 'node:test';import assert from 'node:assert/strict';import {Hono} from 'hono';import {SignJWT} from 'jose';
import partnernet from '../src/routes/partnernet';import {AUTH_ERROR_STATUSES} from '../src/util/authErrors';import {migratedDatabase,removeMigratedDatabases} from './_storage_schema.ts';import {d1Over} from './_d1_sqlite.mjs';
test.after(removeMigratedDatabases);const secret='synthetic-6636-test-only-'.repeat(4);
function fixture(){const db=migratedDatabase();db.exec(`INSERT INTO users(id,name,email,role,is_active,founder_id) VALUES
 (1,'Viewer','viewer@example.test','investor',1,NULL),(2,'Deal person','deal@example.test','investor',1,NULL),(3,'Founder','founder@example.test','founder',1,30),(4,'Room person','room@example.test','partner',1,NULL),(5,'Unrelated','private@example.test','investor',1,NULL),(7,'Staff','staff@example.test','admin',1,NULL),(8,'Inactive','inactive@example.test','investor',0,NULL);
 INSERT INTO projects(id,uid,name,founder_id) VALUES(100,'p100','Private deal venture',30),(101,'p101','Private room venture',30);
 INSERT INTO deals(id,project_id) VALUES(200,100);INSERT INTO deal_invitations(deal_id,investor_user_id,status) VALUES(200,1,'invited'),(200,2,'invited'),(200,8,'invited');
 INSERT INTO data_room_grants(uid,project_id,investor_user_id,granted_by_user_id) VALUES('v',101,1,3),('r',101,4,3);
 INSERT INTO project_members(project_id,user_id,role,status) VALUES(101,7,'cofounder','accepted');`);
 const app=new Hono<any>().route('/api/partnernet',partnernet);app.onError((e,c)=>c.json({error:'refused'},(AUTH_ERROR_STATUSES[e.message]||500) as any));
 async function call(path='/relationships/candidates',method='GET',body?:unknown,who:number|null=1,extra={}){const token=who===null?null:await new SignJWT({user_id:who,...extra}).setProtectedHeader({alg:'HS256'}).setIssuedAt().setExpirationTime('5m').sign(new TextEncoder().encode(secret));const r=await app.request('https://unit.test/api/partnernet'+path,{method,headers:{...(token?{Authorization:`Bearer ${token}`} : {}),'Content-Type':'application/json'},...body===undefined?{}:{body:JSON.stringify(body)}},{DB:d1Over(db),JWT_SECRET:secret,ENVIRONMENT:'development'} as any);return{status:r.status,body:await r.json() as any};}
 return{db,call};}
test('only active shared-deal/room people are named; no self, global directory, emails or private resource labels',async()=>{const f=fixture();const r=await f.call();assert.equal(r.status,200,JSON.stringify(r.body));assert.deepEqual(r.body.people,[{id:2,name:'Deal person'},{id:3,name:'Founder'},{id:4,name:'Room person'}]);assert.doesNotMatch(JSON.stringify(r.body),/example.test|Private|Unrelated|Staff|Inactive/);assert.deepEqual((await f.call('/relationships/candidates','GET',undefined,5)).body.people,[]);
 f.db.exec("UPDATE data_room_grants SET status='revoked' WHERE investor_user_id=4");assert.equal((await f.call()).body.people.some((p:any)=>p.id===4),false);
});
test('accepted ties and pending requests are excluded; the existing write refuses outsiders and creates only a pending consent request',async()=>{const f=fixture();f.db.exec("INSERT INTO partner_relationships(partner_a_id,partner_b_id,relationship_type,status,requested_by) VALUES(1,2,'co_investor','accepted',1),(1,3,'advisor_founder','pending',1)");assert.deepEqual((await f.call()).body.people,[{id:4,name:'Room person'}]);
 assert.equal((await f.call('/relationships','POST',{partner_id:5,relationship_type:'co_investor'})).status,403);assert.equal((await f.call('/relationships','POST',{partner_id:2,relationship_type:'co_investor'})).status,409);
 const made=await f.call('/relationships','POST',{partner_id:4,relationship_type:'operator_partner',user_id:5});assert.equal(made.status,201,JSON.stringify(made.body));const row:any=f.db.prepare('SELECT status,requested_by,partner_a_id,partner_b_id FROM partner_relationships WHERE partner_b_id=4').get();assert.deepEqual({...row},{status:'pending',requested_by:1,partner_a_id:1,partner_b_id:4});assert.equal((await f.call()).body.people.length,0);assert.equal(Number((f.db.prepare('SELECT COUNT(*) AS n FROM network_connections').get() as any).n),0);
});
test('pagination stays within shared names, and writes can choose a shared person beyond the first page',async()=>{const f=fixture();for(let id=10;id<70;id++){f.db.prepare("INSERT INTO users(id,name,email,role,is_active) VALUES(?,?,?,'investor',1)").run(id,'Synthetic '+id,'unit-'+id+'@example.test');f.db.prepare("INSERT INTO deal_invitations(deal_id,investor_user_id,status) VALUES(200,?,'invited')").run(id);}
 const first=await f.call();assert.equal(first.body.people.length,50);assert.ok(first.body.next_cursor);const next=await f.call('/relationships/candidates?after='+first.body.next_cursor);assert.ok(next.body.people.length>0);assert.equal(new Set([...first.body.people,...next.body.people].map((p:any)=>p.id)).size,63);
 assert.equal((await f.call('/relationships','POST',{partner_id:69,relationship_type:'co_investor'})).status,201);
});
test('unreadable sources are refused, and anonymous/support/invalid callers cannot request a tie',async()=>{const f=fixture();assert.equal((await f.call('/relationships/candidates','GET',undefined,null)).status,401);assert.equal((await f.call('/relationships/candidates','GET',undefined,1,{impersonated_by:7})).status,403);assert.equal((await f.call('/relationships','POST',{partner_id:4,relationship_type:'operator_partner'},1,{impersonated_by:7})).status,403);
 assert.equal((await f.call('/relationships','POST',{partner_id:'4junk',relationship_type:'operator_partner'})).status,400);f.db.exec('DROP TABLE data_room_grants');assert.equal((await f.call()).status,503);assert.equal((await f.call('/relationships','POST',{partner_id:2,relationship_type:'co_investor'})).status,503);assert.equal(Number((f.db.prepare('SELECT COUNT(*) AS n FROM partner_relationships').get() as any).n),0);
});

test('coerced booleans, null and malformed identifiers are refused before candidate selection',async()=>{const f=fixture();for(const partner_id of [true,false,null,'4junk',''])assert.equal((await f.call('/relationships','POST',{partner_id,relationship_type:'co_investor'},3)).status,400);assert.equal((await f.call('/relationships','POST',{partner_id:'4',relationship_type:'co_investor'})).status,201);});
