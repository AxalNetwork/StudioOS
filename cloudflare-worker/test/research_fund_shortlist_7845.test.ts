/** D7845 (#7845): atomic, private and replay-safe shortlist saves over the fully migrated SQLite schema and mounted Worker routes. */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import shortlist from '../src/routes/research_fund_shortlist.ts';
import research from '../src/routes/research.ts';
import { saveFundShortlist } from '../src/services/researchMyFunds.ts';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';
import { migratedDatabase, removeMigratedDatabases } from './_storage_schema.ts';
import { d1Over } from './_d1_sqlite.mjs';
after(removeMigratedDatabases);
const SECRET = 'synthetic-7845-only-not-a-real-secret'.repeat(2);
const app = new Hono<any>().route('/api/research/fund-shortlist', shortlist).route('/api/research', research);
app.onError((error, c) => c.json({ detail: error.message }, (AUTH_ERROR_STATUSES[error.message] || 500) as any));
function fixture() {
  const db = migratedDatabase();
  db.exec("INSERT INTO users(id,name,email,role) VALUES (1,'Synthetic Owner','owner@example.invalid','founder'),(2,'Synthetic Other','other@example.invalid','founder')");
  db.exec(`INSERT INTO research_fund_sources(source_name,title,published_url,terms_status,terms_quote,evidence_url,evidence,verdict,verdict_reason,reviewed_on)
    VALUES ('Synthetic allowed','Allowed list','https://allowed.example.invalid','found','Synthetic allowed terms','https://allowed.example.invalid/terms','synthetic','republish allowed','Allowed','2026-11-20'),
           ('Synthetic withdrawn','Withdrawn list','https://withdrawn.example.invalid','found','Synthetic withdrawn terms','https://withdrawn.example.invalid/terms','synthetic','not allowed','Withheld','2026-11-20')`);
  const insert = db.prepare('INSERT INTO research_fund_directory(uid,name,hq,fund_size_cents,source_name,source_url,as_of) VALUES (?,?,?,?,?,?,?)');
  for (let n = 1; n <= 50; n++) insert.run('catalogue-'+n, 'Synthetic fund '+n, 'Synthetic HQ', 7654321, 'Synthetic allowed', 'https://fact.example.invalid', '2026-11-20');
  insert.run('withdrawn-record','WITHHELD_NAME_MUST_NOT_ESCAPE','WITHHELD_HQ',987654321,'Synthetic withdrawn','https://withheld-row.example.invalid','2026-11-20');
  db.exec("INSERT INTO research_fund_directory_uid_moves(old_uid,new_uid,moved_on) VALUES ('retired-record','catalogue-1','2026-11-20'),('retired-withdrawn','withdrawn-record','2026-11-20')");
  return { db, env: { DB: d1Over(db), JWT_SECRET: SECRET, ENVIRONMENT: 'development' } as any };
}
type Fixture = ReturnType<typeof fixture>;
async function call(f: Fixture, method: string, path = '', body?: any, owner: number | null = 1) {
  const token = owner === null ? null : await new SignJWT({user_id:owner,role:'founder'}).setProtectedHeader({alg:'HS256'}).setExpirationTime('1h').sign(new TextEncoder().encode(SECRET));
  const r = await app.request('/api/research/fund-shortlist'+path, {method,headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:body===undefined?undefined:JSON.stringify(body)}, f.env);
  return {status:r.status,body:await r.json() as any};
}
const ids = (n=10) => Array.from({length:n},(_,i)=>'catalogue-'+(i+1));
const post = (f:Fixture, list:unknown=ids(), request='request-0001', extra={}) => call(f,'POST','',{catalogue_ids:list,request_id:request,...extra});
const count = (f:Fixture, table:string) => Number(f.db.prepare('SELECT COUNT(*) AS n FROM '+table).get()!.n);

test('ten records save atomically, only served names and links enter private fields, and the ledger stores no public copy', async()=>{
 const f=fixture();try{
  const r=await post(f,ids(), 'request-0001',{name:'CLIENT_NAME_IGNORED',owner_user_id:2,note:'CLIENT_FACT_IGNORED'});
  assert.equal(r.status,201,JSON.stringify(r.body));assert.equal(r.body.repeat,false);assert.equal(r.body.saved.length,10);assert.deepEqual(r.body.already_saved,[]);
  const rows=f.db.prepare('SELECT * FROM research_funds ORDER BY id').all();assert.equal(rows.length,10);
  for(const row of rows){assert.equal(row.owner_user_id,1);assert.match(String(row.name),/^Synthetic fund /);for(const field of ['project_id','note','thesis','source_url','cheque_min_cents','cheque_max_cents','intended_allocation_cents'])assert.equal(row[field],null,field);assert.ok(row.catalogue_uid);}
  const columns=f.db.prepare('PRAGMA table_info(research_fund_save_requests)').all();
  assert.deepEqual(columns.map(c=>c.name),['owner_user_id','request_id','ids_digest','created_dossier_ids','already_dossier_ids']);
  const ledger=f.db.prepare('SELECT * FROM research_fund_save_requests').get()!;assert.match(String(ledger.ids_digest),/^[0-9a-f]{64}$/);
  assert.deepEqual(JSON.parse(String(ledger.created_dossier_ids)),rows.map(r=>r.id));assert.deepEqual(JSON.parse(String(ledger.already_dossier_ids)),[]);
  assert.doesNotMatch(JSON.stringify(ledger),/catalogue-|Synthetic fund|CLIENT_/);
 }finally{f.db.close();}
});
test('sorted input digest deduplicates ids; replay keeps the first classifications and reads current dossiers without resurrecting deletion',async()=>{
 const f=fixture();try{
  f.db.exec("INSERT INTO research_funds(uid,owner_user_id,name,catalogue_uid) VALUES ('already-owned',1,'Private existing name','catalogue-1')");
  const first=await post(f,['catalogue-2','catalogue-1','catalogue-2']);assert.equal(first.status,201);assert.equal(first.body.saved.length,1);assert.equal(first.body.already_saved.length,1);
  f.db.prepare('UPDATE research_funds SET name = ? WHERE id = ?').run('Private edited name',first.body.saved[0].id);
  const repeated=await post(f,['catalogue-1','catalogue-2']);assert.equal(repeated.status,200);assert.equal(repeated.body.repeat,true);assert.equal(repeated.body.saved[0].name,'Private edited name');assert.equal(repeated.body.already_saved[0].uid,'already-owned');
  f.db.prepare('DELETE FROM research_funds WHERE id = ?').run(first.body.saved[0].id);
  const after=await post(f,['catalogue-2','catalogue-1']);assert.deepEqual(after.body.saved,[{id:first.body.saved[0].id,state:'no_longer_held'}]);assert.equal(count(f,'research_funds'),1);
  const read=await call(f,'GET','/requests/request-0001');assert.deepEqual(read.body.saved,after.body.saved);assert.equal(read.body.state,'saved');
  const mismatch=await post(f,['catalogue-3']);assert.equal(mismatch.status,409);assert.equal(mismatch.body.error,'request_id_reused');assert.equal(count(f,'research_funds'),1);
 }finally{f.db.close();}
});
test('request reads and dossier writes stay owner-private; unknown requests and another owner\'s request are indistinguishable',async()=>{
 const f=fixture();try{
  const first=await post(f,['catalogue-1']);assert.equal(first.status,201);
  const other=await call(f,'GET','/requests/request-0001',undefined,2),missing=await call(f,'GET','/requests/request-9999',undefined,2);
  assert.equal(other.status,200);assert.equal(other.body.state,'not_found');assert.equal(missing.body.state,'not_found');assert.equal(other.body.saved,undefined);
  const second=await call(f,'POST','',{catalogue_ids:['catalogue-1'],request_id:'request-0001'},2);assert.equal(second.status,201);assert.notEqual(second.body.saved[0].uid,first.body.saved[0].uid);
  assert.equal(count(f,'research_funds'),2);assert.equal(count(f,'research_fund_save_requests'),2);
 }finally{f.db.close();}
});
test('withdrawn lists refuse the whole selection, including retired aliases, naming original ids and citation only',async()=>{
 const f=fixture();try{
  const r=await post(f,[...ids(),'retired-withdrawn']);assert.equal(r.status,410);assert.equal(r.body.error,'source_withdrawn');
  assert.deepEqual(r.body.withdrawals[0].ids,['retired-withdrawn']);assert.equal(r.body.withdrawals[0].removed.name,'Synthetic withdrawn');
  assert.doesNotMatch(JSON.stringify(r.body),/WITHHELD_NAME|WITHHELD_HQ|987654321|withheld-row/);
  assert.equal(count(f,'research_funds'),0);assert.equal(count(f,'research_fund_save_requests'),0);
 }finally{f.db.close();}
});
test('unknown ids refuse without a ledger row; the same request id is judged afresh after the record arrives; moves follow their current target',async()=>{
 const f=fixture();try{
  const bad=await post(f,['never-held']);assert.equal(bad.status,404);assert.equal(count(f,'research_fund_save_requests'),0);
  f.db.exec("INSERT INTO research_fund_directory(uid,name,source_name,source_url,as_of) VALUES ('never-held','Synthetic later fund','Synthetic allowed','https://later.example.invalid','2026-11-20')");
  const good=await post(f,['never-held']);assert.equal(good.status,201);
  const moved=await post(f,['retired-record','catalogue-1'],'request-0002');assert.equal(moved.status,201);assert.equal(moved.body.saved.length,1);
  assert.equal(f.db.prepare('SELECT catalogue_uid FROM research_funds WHERE id = ?').get(moved.body.saved[0].id)!.catalogue_uid,'catalogue-1');
 }finally{f.db.close();}
});
test('a mid-batch failure rolls back every dossier and the request; retry with that id can save',async()=>{
 const f=fixture();try{
  const base=f.env.DB;
  f.env.DB={...base,batch:async(statements:any[])=>base.batch([statements[0],base.prepare('INSERT INTO research_funds(uid,owner_user_id,name) VALUES (NULL,1,?)').bind('Synthetic fault'),...statements.slice(1)])};
  const failed=await post(f);assert.equal(failed.status,503);assert.equal(failed.body.error,'save_failed');assert.equal(failed.body.rolled_back,true);
  assert.equal(count(f,'research_funds'),0);assert.equal(count(f,'research_fund_save_requests'),0);
  f.env.DB=base;assert.equal((await post(f)).status,201);assert.equal(count(f,'research_funds'),10);
 }finally{f.db.close();}
});
test('runtime withdrawal between preflight and batch refuses all rows and leaves no request',async()=>{
 const f=fixture();try{
  const base=f.env.DB;f.env.DB={...base,batch:async(statements:any[])=>{f.db.exec("UPDATE research_fund_sources SET verdict='not allowed' WHERE source_name='Synthetic allowed'");return base.batch(statements);}};
  const failed=await post(f);assert.equal(failed.status,410);assert.equal(failed.body.error,'source_withdrawn');assert.equal(failed.body.withdrawals[0].ids.length,10);
  assert.equal(count(f,'research_funds'),0);assert.equal(count(f,'research_fund_save_requests'),0);
 }finally{f.db.close();}
});
test('a lost batch response reconciles the committed request, and concurrent repeats create no duplicate',async()=>{
 const f=fixture();try{
  const base=f.env.DB;f.env.DB={...base,batch:async(statements:any[])=>{await base.batch(statements);throw Error('Synthetic response lost');}};
  const recovered=await post(f);assert.equal(recovered.status,200);assert.equal(recovered.body.repeat,true);assert.equal(recovered.body.saved.length,10);
  f.env.DB=base;const results=await Promise.all([post(f,ids(2),'request-0002'),post(f,ids(2).reverse(),'request-0002')]);
  assert.equal(results.filter(r=>r.status===201).length,1);assert.equal(results.filter(r=>r.status===200).length,1);assert.equal(count(f,'research_funds'),10);
  assert.deepEqual(results[0].body.saved,results[1].body.saved);assert.deepEqual(results[0].body.already_saved,results[1].body.already_saved);
 }finally{f.db.close();}
});
test('all served kinds save under pick A; optional future restrictions read the stored kind, not a supplied kind',async()=>{
 const f=fixture();try{
  const hasKind=f.db.prepare('PRAGMA table_info(research_fund_directory)').all().some(r=>r.name==='kind');if(!hasKind)f.db.exec('ALTER TABLE research_fund_directory ADD COLUMN kind TEXT');
  f.db.exec("UPDATE research_fund_directory SET kind='manager' WHERE uid='catalogue-1'; UPDATE research_fund_directory SET kind='resource' WHERE uid='catalogue-2'");
  assert.equal((await post(f,ids(2),'request-0001',{kind:'fund_vehicle'})).status,201);
  await assert.rejects(saveFundShortlist(f.env,1,['catalogue-2'],'request-0002',['fund_vehicle','manager']),error=>(error as any).code==='record_kind_refused');
  assert.equal(count(f,'research_fund_save_requests'),1);
 }finally{f.db.close();}
});
test('validation is bounded and the authentication gate matches the single-fund save',async()=>{
 const f=fixture();try{
  for(const value of [[],Array(51).fill('catalogue-1'),['bad/id'],[null],null])assert.equal((await post(f,value)).status,400);
  for(const value of ['',null,'bad_id','x'.repeat(65)])assert.equal((await post(f,['catalogue-1'],value as any)).status,400);
  const denied=await call(f,'POST','',{catalogue_ids:['catalogue-1'],request_id:'request-0001'},null);assert.equal(denied.status,401);
  assert.equal(count(f,'research_funds'),0);assert.equal(count(f,'research_fund_save_requests'),0);
  const maximum=await post(f,ids(50));assert.equal(maximum.status,201);assert.equal(maximum.body.saved.length,50);
 }finally{f.db.close();}
});

test('an unreadable outcome never promises rollback; a caller can reconcile once reads recover',async()=>{
 const f=fixture();try{
  const base=f.env.DB;let committed=false;
  f.env.DB={...base,prepare:(sql:string)=>{if(committed&&sql.includes('FROM research_fund_save_requests'))throw Error('Synthetic unreadable outcome');return base.prepare(sql);},batch:async(statements:any[])=>{await base.batch(statements);committed=true;throw Error('Synthetic response lost');}};
  const uncertain=await post(f);assert.equal(uncertain.status,503);assert.equal(uncertain.body.error,'save_outcome_unknown');assert.equal(uncertain.body.rolled_back,undefined);
  f.env.DB=base;const recovered=await call(f,'GET','/requests/request-0001');assert.equal(recovered.body.saved.length,10);assert.equal(count(f,'research_funds'),10);
 }finally{f.db.close();}
});
test('concurrent different selections sharing a request id cannot add a second selection',async()=>{
 const f=fixture();try{
  const results=await Promise.all([post(f,['catalogue-1']),post(f,['catalogue-2'])]);
  assert.deepEqual(results.map(r=>r.status).sort(),[201,409]);assert.equal(count(f,'research_funds'),1);assert.equal(count(f,'research_fund_save_requests'),1);
 }finally{f.db.close();}
});
