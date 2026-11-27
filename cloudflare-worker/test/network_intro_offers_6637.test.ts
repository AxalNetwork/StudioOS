/**
 * From cloudflare-worker/test/README.md (moved by #6472): D6637: real migrated SQLite
 * authorization, consent, failure and concurrency regressions.
 */
import {mutuallyAccepted,listShares} from '../src/services/mail/shares';
/** D6637: mirrored propositions and unchanged response/credit consent, real migrated SQLite and mounted routes. Synthetic people only. */
import test from 'node:test';import assert from 'node:assert/strict';import {Hono} from 'hono';import {SignJWT} from 'jose';
import introductions from '../src/routes/introductions';import {AUTH_ERROR_STATUSES} from '../src/util/authErrors';import {migratedDatabase,removeMigratedDatabases} from './_storage_schema.ts';import {d1Over} from './_d1_sqlite.mjs';
test.after(removeMigratedDatabases);const secret='synthetic-6637-test-only-'.repeat(4);
function fixture(){const db=migratedDatabase();db.exec(`INSERT INTO users(id,name,email,role,is_active) VALUES(1,'Proposer','proposer@example.test','investor',1),(2,'Person A','a@example.test','founder',1),(3,'Person B','b@example.test','partner',1),(4,'Pending tie','pending@example.test','investor',1),(5,'Inactive tie','inactive@example.test','investor',0);
 INSERT INTO partner_relationships(partner_a_id,partner_b_id,relationship_type,status,requested_by) VALUES(1,2,'advisor_founder','accepted',1),(1,3,'operator_partner','accepted',3),(1,4,'co_investor','pending',1),(1,5,'co_investor','accepted',1);`);
 const app=new Hono<any>().route('/api/introductions',introductions);app.onError((e,c)=>c.json({error:'refused'},(AUTH_ERROR_STATUSES[e.message]||500) as any));
 async function call(path='/offers',method='POST',body:unknown={first_user_id:2,second_user_id:3},who:number|null=1,extra={}){const token=who===null?null:await new SignJWT({user_id:who,...extra}).setProtectedHeader({alg:'HS256'}).setIssuedAt().setExpirationTime('5m').sign(new TextEncoder().encode(secret));const r=await app.request('https://unit.test/api/introductions'+path,{method,headers:{...(token?{Authorization:`Bearer ${token}`} : {}),'Content-Type':'application/json'},...method==='GET'?{}:{body:JSON.stringify(body)}},{DB:d1Over(db),JWT_SECRET:secret,ENVIRONMENT:'development'} as any);return{status:r.status,body:await r.json() as any};}
 const props=()=>db.prepare('SELECT * FROM intro_propositions ORDER BY id').all() as any[];
 return{db,call,props};}
test('names-only accepted-tie picker and two atomic pending rows, actor audit, no proposer credit spend or automatic acceptance',async()=>{const f=fixture();const candidates=await f.call('/offer-candidates','GET');assert.equal(candidates.status,200,JSON.stringify(candidates.body));assert.deepEqual(candidates.body.people,[{id:2,name:'Person A'},{id:3,name:'Person B'}]);assert.doesNotMatch(JSON.stringify(candidates.body),/example.test|Pending tie|Inactive tie|Proposer/);
 const r=await f.call();assert.equal(r.status,201,JSON.stringify(r.body));assert.deepEqual(r.body,{offered:true});const rows=f.props();assert.deepEqual(rows.map(p=>[p.user_id,p.target_user_id,p.status,p.source]),[[2,3,'pending','offered'],[3,2,'pending','offered']]);assert.equal(JSON.parse(rows[0].breakdown_json).offer_uid,JSON.parse(rows[1].breakdown_json).offer_uid);assert.notEqual(rows[0].uid,rows[1].uid);
 const audit:any=f.db.prepare("SELECT user_id FROM activity_logs WHERE action='network_intro_offered'").get();assert.equal(audit.user_id,1);assert.equal(Number((f.db.prepare('SELECT COUNT(*) AS n FROM intro_credit_ledger').get() as any).n),0);
 const read=await f.call('/propositions','GET',undefined,2);assert.equal(read.status,200);const own=read.body.propositions.find((p:any)=>p.uid===rows[0].uid);assert.equal(own.counterpart_status,'pending');assert.equal(own.score,null);assert.equal(own.breakdown,null);assert.doesNotMatch(JSON.stringify(own),/offered_by|offer_uid|example.test/);
});
test('self/same/foreign/pending/inactive pairs, anonymous and support callers never create a proposition',async()=>{const f=fixture();for(const [body,status] of [[{first_user_id:2,second_user_id:2},400],[{first_user_id:1,second_user_id:2},400],[{first_user_id:2,second_user_id:4},403],[{first_user_id:2,second_user_id:5},403],[{first_user_id:2,second_user_id:99},403],[{first_user_id:'2',second_user_id:3},400]] as const)assert.equal((await f.call('/offers','POST',body)).status,status);
 assert.equal((await f.call('/offers','POST',undefined,null)).status,401);assert.equal((await f.call('/offers','POST',undefined,1,{impersonated_by:9})).status,403);assert.equal(f.props().length,0);
});
test('the open pair is refused in either order and concurrent offers cannot leave duplicates or half a pair',async()=>{const f=fixture();const r=await Promise.all([f.call(),f.call()]);assert.deepEqual(r.map(v=>v.status).sort(),[201,409]);assert.equal((await f.call('/offers','POST',{first_user_id:3,second_user_id:2})).status,409);assert.equal(f.props().length,2);assert.equal(Number((f.db.prepare("SELECT COUNT(*) AS n FROM activity_logs WHERE action='network_intro_offered'").get() as any).n),1);});
test('existing accept/decline responses retain credits and closed history; each offer reads only its own reciprocal consent',async()=>{const f=fixture();assert.equal((await f.call()).status,201);const old=f.props();f.db.exec("INSERT INTO intro_credit_ledger(user_id,delta,bucket,kind,source_ref,note) VALUES(2,5,'referral','referral_reward','unit-6637','Synthetic credits')");
 assert.equal((await f.call('/propositions/'+old[0].uid+'/accept','POST',{},2)).status,200);assert.equal((await f.call('/propositions/'+old[1].uid+'/decline','POST',{},3)).status,200);assert.equal((await f.call()).status,201);const all=f.props();assert.equal(all.length,4);assert.deepEqual(all.slice(0,2).map(p=>p.status),['accepted','declined']);
 const read=await f.call('/propositions','GET',undefined,2);assert.equal(read.body.propositions.find((p:any)=>p.uid===old[0].uid).counterpart_status,'declined');assert.equal(read.body.propositions.find((p:any)=>p.uid===all[2].uid).counterpart_status,'pending');assert.equal(Number((f.db.prepare("SELECT COUNT(*) AS n FROM intro_credit_ledger WHERE kind='spend' AND user_id=2").get() as any).n),1);
});
test('expiry and failed second-row writes preserve history and atomicity',async()=>{const f=fixture();assert.equal((await f.call()).status,201);f.db.exec("UPDATE intro_propositions SET expires_at='2000-01-01'");assert.equal((await f.call()).status,201);assert.deepEqual(f.props().map(p=>p.status),['expired','expired','pending','pending']);
 const broken=fixture();broken.db.exec("CREATE TRIGGER fail_second_offer BEFORE INSERT ON intro_propositions WHEN NEW.user_id=3 BEGIN SELECT RAISE(ABORT,'synthetic offer failure'); END");assert.equal((await broken.call()).status,503);assert.equal(broken.props().length,0);assert.equal(Number((broken.db.prepare("SELECT COUNT(*) AS n FROM activity_logs WHERE action='network_intro_offered'").get() as any).n),0);
});
test('a prior acceptance cannot complete a later offer, and notifications link to the current recipient row',async()=>{
 const f=fixture();assert.equal((await f.call()).status,201);const old=f.props();
 f.db.exec("INSERT INTO intro_credit_ledger(user_id,delta,bucket,kind,source_ref,note) VALUES(2,5,'referral','referral_reward','later-a','Synthetic'),(3,5,'referral','referral_reward','later-b','Synthetic')");
 assert.equal((await f.call('/propositions/'+old[0].uid+'/accept','POST',{},2)).status,200);
 assert.equal((await f.call('/propositions/'+old[1].uid+'/accept','POST',{},3)).status,200);
 assert.equal((await f.call()).status,201);const current=f.props().slice(2);
 f.db.exec('DELETE FROM notifications_inbox');
 assert.equal((await f.call('/propositions/'+current[0].uid+'/accept','POST',{},2)).status,200);
 const notices=f.db.prepare('SELECT user_id,type,link FROM notifications_inbox').all() as any[];
 assert.ok(notices.some(n=>n.user_id===3&&n.type==='intro_accepted'&&n.link.includes(current[1].uid)),JSON.stringify(notices));
 assert.ok(!notices.some(n=>n.type==='intro_connected'),'new offer requires its own second acceptance');
});
test('legacy pending matches block offers and current tie revocation closes the write gate',async()=>{
 const f=fixture();f.db.exec("INSERT INTO intro_propositions(uid,user_id,target_user_id,status,source) VALUES('legacy',2,3,'pending','matching')");
 assert.equal((await f.call()).status,409);assert.equal(f.props().length,1);
 f.db.exec("UPDATE partner_relationships SET status='ended' WHERE partner_b_id=3");
 assert.equal((await f.call()).status,403);assert.equal(f.props().length,1);
});

test('separate offer groups cannot combine unilateral accepts into email-sharing consent',async()=>{
 const f=fixture();f.db.exec(`INSERT INTO intro_propositions(uid,user_id,target_user_id,status,source,breakdown_json) VALUES
 ('group-a',2,3,'accepted','offered','{"offer_uid":"a"}'),('group-b',3,2,'accepted','offered','{"offer_uid":"b"}')`);
 const env={DB:d1Over(f.db)} as any;
 assert.equal(await mutuallyAccepted(env,2,3),null);
 assert.deepEqual(await listShares(env,{id:2} as any),[]);
 f.db.exec(`UPDATE intro_propositions SET breakdown_json='{"offer_uid":"a"}' WHERE uid='group-b'`);
 assert.equal(await mutuallyAccepted(env,2,3),'group-a');
 assert.equal((await listShares(env,{id:2} as any)).length,1);
});
