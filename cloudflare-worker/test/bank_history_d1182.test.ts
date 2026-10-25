import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { format } from 'node:util';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import bankAccounts from '../src/routes/admin_bank_accounts.ts';
import { retireAccount, activeRowsCarrying, masked } from '../src/services/entityBankAccounts.ts';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';
import { tableFromBaseline } from './_baseline.mjs';
import { d1Over } from './_d1_sqlite.mjs';

const KEY='synthetic-bank-history-signing-key'.repeat(2), FULL='55112233444821';
const UID='aaaaaaa1-0000-4000-8000-000000000001', UID2='aaaaaaa2-0000-4000-8000-000000000002';
const baseline=readFileSync(new URL('../sql/schema_baseline.sql',import.meta.url),'utf8');
const realFetch=globalThis.fetch;let external=0;
const captured:string[]=[];const originals=new Map();
for(const key of ['log','warn','error','info','debug']as const){originals.set(key,console[key]);console[key]=(...args:any[])=>{captured.push(format(...args));};}
test.before(()=>{globalThis.fetch=async()=>{external++;throw Error('unexpected_provider_call');};});
test.after(()=>{globalThis.fetch=realFetch;for(const [key,value]of originals)(console as any)[key]=value;assert.equal(external,0,'no Mercury/provider requests');for(const secret of [FULL,'synthetic-private-token','synthetic-private-store-error'])assert.ok(!captured.join(' ').includes(secret),'logs contain no private content');});
function fixture(empty=false){
 const db=new DatabaseSync(':memory:',{enableForeignKeyConstraints:false});
 for(const t of ['users','super_admins','user_sessions','activity_logs','admin_audit_log','vc_funds'])db.exec(tableFromBaseline(baseline,t));
 db.exec(readFileSync(new URL('../sql/migrations/472_entity_bank_accounts.sql',import.meta.url),'utf8'));
 db.exec("INSERT INTO users(id,name,email,role) VALUES (1,'Holder','holder@example.test','admin'),(2,'Plain admin','plain@example.test','admin'),(3,'An LP','lp@example.test','investor');INSERT INTO super_admins(user_id) VALUES (1)");
 if(!empty){
 const account=db.prepare(`INSERT INTO entity_bank_accounts(uid,entity_key,label,bank_name,bank_address,beneficiary_name,beneficiary_address,account_kind,account_number_enc,account_last4,routing_number,recorded_by) VALUES (?,?,?,'Synthetic bank','Synthetic address','Synthetic beneficiary','Synthetic address','checking','v1.synthetic-cipher',?,'121145433',?)`);
 account.run(UID,'gp','Operating','4821',1);account.run(UID2,'fund','Fund account','9482',999);
 db.prepare("INSERT INTO entity_bank_account_reveals(uid,account_id,actor_user_id,context,context_ref,created_at) VALUES ('r1',1,1,'admin_reveal',?,'2026-01-03 10:00:00')").run('Confirm '+FULL);
 db.exec("INSERT INTO entity_bank_account_reveals(uid,account_id,actor_user_id,context,context_ref,created_at) VALUES ('r2',2,3,'capital_call_line','123456','2026-01-03 10:00:00')");
 const audit=db.prepare('INSERT INTO admin_audit_log(admin_user_id,action,filters_json,exported_at) VALUES (?,?,?,?)');
 for(const [actor,action,entity,uid,time]of [
  [1,'bank_account_added','gp',UID,'2026-01-02 10:00:00'],[2,'bank_account_label_changed','gp',UID,'2026-01-02 10:00:00'],[999,'bank_account_retired','fund',UID2,'2026-01-01 10:00:00'],
  [1,'mercury_connected','fund',null,'2026-01-02 11:00:00'],[2,'mercury_token_replaced','gp',null,'2026-01-02 12:00:00'],[1,'mercury_disconnected','gp',null,'2026-01-01 12:00:00'],
  [1,'bank_account_revealed','gp',UID,'2026-01-03 10:00:00']])audit.run(actor,action,JSON.stringify({entity_key:entity,account_uid:uid,account_number:FULL,token:'synthetic-private-token',reason:FULL}),time);
 audit.run(1,'unrelated','not-json','2026-01-03 10:00:00');
 }
 const native=d1Over(db),log:string[]=[];let failure:RegExp|null=null;let noAudit=0;
 const env:any={ENVIRONMENT:'development',JWT_SECRET:KEY,DB:{prepare(sql:string){log.push(sql);if(failure?.test(sql))throw Error('synthetic-private-store-error');if(noAudit&&sql.includes('INSERT INTO admin_audit_log'))return {bind(){return this;},async run(){return {success:noAudit!==2,meta:{changes:noAudit===2?1:0}};}};return native.prepare(sql);},batch:(s:any[])=>native.batch(s)}};
 const app=new Hono<any>();app.route('/',bankAccounts);app.onError((e:any,c)=>c.json({code:'auth_refused'},(AUTH_ERROR_STATUSES[e.message]||500)as any));
 async function call(path='/history',actor=1){const token=await new SignJWT({user_id:actor}).setProtectedHeader({alg:'HS256'}).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(KEY));const r=await app.request(path,{headers:{Authorization:'Bearer '+token}},env);return {status:r.status,body:await r.json()as any,headers:r.headers};}
 return {db,env,log,call,fail:(re:RegExp)=>{failure=re;},noopAudit:(failed=false)=>{noAudit=failed?2:1;}};
}

test('D1182: HQ Super Admin only; denied reads do not audit or inspect history',async()=>{
 const f=fixture();try{for(const actor of [2,3])assert.equal((await f.call('/history',actor)).status,403);f.env.BRANCH_CODE='quebec';assert.equal((await f.call()).status,403);assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM admin_audit_log WHERE action='bank_accounts_history_read'").get()!.n,0);assert.ok(!f.log.some(s=>s.includes('WITH history')));}finally{f.db.close();}
});
test('D1182: ledger and changes are masked, LP reveals included, audit mirrors have distinct source tags',async()=>{
 const f=fixture();try{const r=await f.call();assert.equal(r.status,200);assert.equal(r.headers.get('cache-control'),'no-store');assert.equal(r.body.total,9);assert.deepEqual(r.body.rows.map((x:any)=>x.kind),['reveal','reveal','bank_account','mercury','mercury','bank_account','bank_account','mercury','bank_account']);assert.equal(r.body.rows[0].time,'2026-01-03T10:00:00.000Z');assert.equal(r.body.rows[0].source,'reveal_ledger');assert.equal(r.body.rows[2].source,'admin_audit');assert.equal(r.body.rows[0].context,'capital_call_line');assert.equal(r.body.rows[0].context_ref,'123456');assert.equal(r.body.rows[0].actor_name,'An LP');assert.equal(r.body.rows[2].actor_name,'Holder');assert.equal(r.body.rows.find((x:any)=>x.actor_ref==='actor:2').actor_name,'Plain admin');for(const row of r.body.rows){assert.equal(row.email,undefined);assert.equal(row.actor_email,undefined);}assert.equal(r.body.rows[0].account_masked,'••••9482');assert.equal(r.body.rows[1].context_ref,'Confirm [redacted]');assert.equal(r.body.rows[1].account_masked,'••••4821');const connection=r.body.rows.find((x:any)=>x.kind==='mercury');assert.equal(connection.account_masked,null);assert.equal(connection.account_uid,null);assert.equal(r.body.rows.at(-1).actor_name,null);const text=JSON.stringify(r.body);for(const secret of [FULL,'synthetic-private-token','account_number_enc','filters_json','routing_number','v1.synthetic-cipher'])assert.ok(!text.includes(secret),secret);const gate=f.log.findIndex(s=>s.includes('INSERT INTO admin_audit_log'));assert.ok(gate>=0);assert.ok(f.log.every((s,i)=>!(/FROM (entity_bank_account_reveals|admin_audit_log)/.test(s))||i>gate));}finally{f.db.close();}
});
test('D1182: filters and literal search; UTC range includes the end date',async()=>{
 const f=fixture();try{for(const [q,n]of [['kind=reveal',2],['kind=bank_account',4],['kind=mercury',3],['entity=fund',3],['actor=actor%3A3',1],['q=Operating',4],['from=2026-01-02&to=2026-01-02',4],['q=%25',0],['q=%27%20OR%201%3D1--',0],['q='+FULL,0]]){const r=await f.call('/history?'+q);assert.equal(r.status,200,q);assert.equal(r.body.total,n,q);}for(const q of ['kind=no','entity=no','actor=x','from=2026-02-30','to=9999-12-31','from=2026-02-02&to=2026-01-01','per=101','page=0','snapshot=bad','snapshot=1.2.3.4','snapshot=9999999999999999.2.1767225600000','range=1d','range=7d&from=2026-01-01'])assert.equal((await f.call('/history?'+q)).status,400,q);assert.equal((await f.call('/history?range=7d')).body.total,0);}finally{f.db.close();}
});
test('D1182: insertion-stable pages retain a deterministic cross-store order',async()=>{
 const f=fixture();try{const first=(await f.call('/history?per=2')).body;assert.deepEqual(first.rows.map((r:any)=>r.id),['reveal:2','reveal:1']);f.db.exec("INSERT INTO entity_bank_account_reveals(uid,account_id,actor_user_id,context,created_at) VALUES ('late',1,1,'admin_reveal','2026-01-03 10:00:00')");let ids=first.rows.map((r:any)=>r.id);for(let page=2;page<=5;page++){const r=(await f.call(`/history?per=2&page=${page}&snapshot=${first.snapshot}`)).body;assert.equal(r.total,9);ids.push(...r.rows.map((x:any)=>x.id));}assert.equal(new Set(ids).size,9);assert.equal(ids.length,9);const fresh=(await f.call('/history?per=2')).body;assert.equal(fresh.total,10);assert.equal(fresh.rows[0].id,'reveal:3');f.db.exec("INSERT INTO entity_bank_account_reveals(uid,account_id,actor_user_id,context,created_at) VALUES ('fraction-a',1,1,'admin_reveal','2026-01-03T10:00:00.500Z'),('fraction-b',1,1,'admin_reveal','2026-01-03T10:00:00.250Z')");assert.deepEqual((await f.call('/history?per=2')).body.rows.map((r:any)=>r.id),['reveal:4','reveal:5']);}finally{f.db.close();}
});
test('D1182: an audit failure gates the read; missing/corrupt stores are unreadable',async()=>{
 for(const fail of [/INSERT INTO admin_audit_log/,/WITH history/,/COALESCE\(MAX\(id\),0\) FROM entity_bank_account_reveals/]){const f=fixture();try{f.fail(fail);const r=await f.call();assert.equal(r.status,503);assert.equal(r.body.code,fail.source.startsWith('INSERT')?'audit_unavailable':'history_unreadable');assert.equal(r.body.rows,undefined);assert.equal(r.body.total,undefined);assert.ok(!JSON.stringify(r.body).includes('synthetic-private-store-error'));if(fail.source.startsWith('INSERT'))assert.ok(!f.log.some(s=>s.includes('WITH history')));}finally{f.db.close();}}
 for(const payload of ['not-json','[]','"text"']){const f=fixture();try{f.db.prepare("INSERT INTO admin_audit_log(admin_user_id,action,filters_json) VALUES (1,'mercury_connected',?)").run(payload);assert.equal((await f.call()).status,503);}finally{f.db.close();}}
});
test('D1182: account recorder is a name, never an id or an invented deleted-user name',async()=>{
 const f=fixture();try{const r=await f.call('/');assert.equal(r.status,200);const a=r.body.accounts.find((x:any)=>x.uid===UID),missing=r.body.accounts.find((x:any)=>x.uid===UID2);assert.equal(a.recorded_by_name,'Holder');f.db.prepare('UPDATE entity_bank_accounts SET purposes_json=? WHERE uid=?').run(JSON.stringify(['management_fee']),UID);const candidates=await activeRowsCarrying(f.env,'management_fee');assert.equal(candidates.length,1);const instruction=masked(candidates[0]);assert.equal(instruction.recorded_by_name,'Holder');assert.equal((instruction as any).recorded_by,undefined);assert.equal(missing.recorded_by_name,null);assert.equal(a.recorded_by,undefined);assert.equal(missing.recorded_by,undefined);const retired=await retireAccount(f.env,UID2,'Former recorder is gone');assert.equal(retired.recorded_by_name,null);assert.equal(retired.uid,UID2);assert.equal(retired.status,'retired');assert.ok(!JSON.stringify(r.body).includes(FULL));}finally{f.db.close();}
});

test('D1182: an empty recorded history is empty; a zero-row audit is refused',async()=>{
 const f=fixture(true);try{const r=await f.call();assert.equal(r.status,200);assert.equal(r.body.total,0);assert.deepEqual(r.body.rows,[]);for(const failed of [false,true]){f.noopAudit(failed);const denied=await f.call();assert.equal(denied.status,503);assert.equal(denied.body.code,'audit_unavailable');assert.equal(denied.body.rows,undefined);}}finally{f.db.close();}
});

test('D1182: a relative date range stays anchored across snapshot pages',async()=>{
 const f=fixture(),real=Date.now;Date.now=()=>Date.parse('2026-01-09T00:00:00Z');
 try{const first=(await f.call('/history?range=7d&per=2')).body;assert.equal(first.total,7);Date.now=()=>Date.parse('2026-01-11T00:00:00Z');const next=await f.call('/history?range=7d&per=2&page=2&snapshot='+first.snapshot);assert.equal(next.status,200);assert.equal(next.body.total,7);assert.equal(next.body.rows.length,2);}finally{Date.now=real;f.db.close();}
});

test('D1182: formatted account numbers in reveal reasons are redacted',async()=>{
 const f=fixture();try{f.db.prepare("INSERT INTO entity_bank_account_reveals(uid,account_id,actor_user_id,context,context_ref,created_at) VALUES ('formatted',1,1,'admin_reveal',?,'2026-01-04 10:00:00')").run('Check 55 11-22.33/44+48_21');const r=await f.call('/history?kind=reveal');assert.equal(r.status,200);assert.equal(r.body.rows[0].context_ref,'Check [redacted]');}finally{f.db.close();}
});

test('D1182: a reveal remains visible when its actor no longer has a user row',async()=>{
 const f=fixture();try{f.db.exec("INSERT INTO entity_bank_account_reveals(uid,account_id,actor_user_id,context,created_at) VALUES ('former-actor',1,999,'admin_reveal','2026-01-04 10:00:00')");const r=await f.call('/history?kind=reveal');assert.equal(r.status,200);assert.equal(r.body.total,3);assert.equal(r.body.rows[0].actor_name,null);assert.equal(r.body.rows[0].actor_ref,'actor:999');}finally{f.db.close();}
});
