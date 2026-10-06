/** D549: mounted routes against the canonical Library/Ask migrations. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { SignJWT } from 'jose';
import { Hono } from 'hono';
import research from '../src/routes/research.ts';

const app = new Hono().route('/api/research', research);
app.onError((error, c) => c.json({ detail: error.message }, 500));
const SECRET = 'unit-research-secret-01234567890123456789';
const sql = (name: string) => readFileSync(new URL(`../sql/${name}`, import.meta.url), 'utf8');
function fixture() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
  const baseline = sql('schema_baseline.sql');
  db.exec(baseline.match(/CREATE TABLE users \([\s\S]*?;/)![0]);
  db.exec(baseline.match(/CREATE TABLE projects \([\s\S]*?;/)![0]);
  db.exec(baseline.match(/CREATE TABLE activity_logs \([\s\S]*?;/)![0]);
  db.exec(sql('migrations/213_research_library.sql'));
  db.exec(sql('migrations/221_research_ask_sessions.sql'));
  db.exec(sql('migrations/385_research_disposition_collections.sql'));
  db.exec("INSERT INTO users (id,email,name,role) VALUES (701,'owner@example.test','Owner','founder'),(702,'other@example.test','Other','founder')");
  db.exec("INSERT INTO research_documents (id,uid,owner_user_id,title,r2_key,index_state) VALUES (1,'own-doc',701,'Interview','r/own','indexed'),(2,'other-doc',702,'Other file','r/other','indexed')");
  db.exec("INSERT INTO research_ask_sessions (id,uid,owner_user_id) VALUES (1,'own-session',701),(2,'other-session',702)");
  db.exec("INSERT INTO research_ask_answers (uid,session_id,owner_user_id,question,answer,reason,saved) VALUES ('own-answer',1,701,'Why?','Because','answered',1),('other-answer',2,702,'Private?','Private','answered',0)");
  const statements: string[] = [];
  const DB = {
    prepare(query: string) {
      statements.push(query); let values: any[] = [];
      const statement: any = {
        bind(...params: any[]) { values = params; return statement; },
        async first(column?: string) { const row: any = db.prepare(query).get(...values) ?? null; return column ? row?.[column] ?? null : row; },
        async all() { return { results: db.prepare(query).all(...values) }; },
        async run() { const result = db.prepare(query).run(...values); return { meta: { changes: Number(result.changes), last_row_id: Number(result.lastInsertRowid) } }; },
      }; return statement;
    },
    async exec(query: string) { db.exec(query); },
  };
  return { db, statements, env: { DB, JWT_SECRET: SECRET, ENVIRONMENT: 'development' } as any };
}
async function call(f: ReturnType<typeof fixture>, method: string, path: string, body?: unknown, who = 701) {
  const token = await new SignJWT({ user_id: who, role: 'founder' }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(SECRET));
  const response = await app.request(`/api/research${path}`, {
    method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }, f.env);
  return { status: response.status, body: await response.json() as any };
}
const rows = (f: ReturnType<typeof fixture>, query: string) => f.db.prepare(query).all().map((row) => ({ ...row }));
const receipts = (f: ReturnType<typeof fixture>) => rows(f, 'SELECT action, user_id FROM activity_logs ORDER BY id');

test('D549: migration keeps nullable metadata and refuses impossible years/dispositions', () => {
  const f = fixture();
  assert.deepEqual(rows(f, "SELECT source_year FROM research_documents WHERE uid='own-doc'"), [{ source_year: null }]);
  assert.deepEqual(rows(f, "SELECT saved, discarded, use_note FROM research_ask_answers WHERE uid='own-answer'"), [{ saved: 1, discarded: 0, use_note: null }]);
  for (const year of [999, 2101, 2025.5]) assert.throws(() => f.db.prepare('UPDATE research_documents SET source_year=? WHERE id=1').run(year), /CHECK/);
  assert.throws(() => f.db.exec("UPDATE research_ask_answers SET discarded=1 WHERE uid='own-answer'"), /CHECK/);
});

test('D549: Ask set/clear transitions, notes, owner refusal and authenticated receipts', async () => {
  const f = fixture();
  const discarded = await call(f, 'PATCH', '/ask/answers/own-answer', { discarded: true, use_note: "  Used in the founder's plan  " });
  assert.deepEqual([discarded.status, discarded.body.item.saved, discarded.body.item.discarded, discarded.body.item.disposition, discarded.body.item.use_note], [200, false, true, 'discarded', "Used in the founder's plan"]);
  const saved = await call(f, 'PATCH', '/ask/answers/own-answer', { saved: true });
  assert.deepEqual([saved.body.item.saved, saved.body.item.discarded, saved.body.item.use_note], [true, false, "Used in the founder's plan"]);
  const cleared = await call(f, 'PATCH', '/ask/answers/own-answer', { saved: false, use_note: null });
  assert.deepEqual([cleared.body.item.disposition, cleared.body.item.use_note], [null, null]);
  const statuses = [];
  for (const body of [{}, { saved: 'yes' }, { discarded: 1 }, { saved: true, discarded: true }, { use_note: 7 }, { use_note: 'x'.repeat(2001) }]) statuses.push((await call(f, 'PATCH', '/ask/answers/own-answer', body)).status);
  statuses.push((await call(f, 'PATCH', '/ask/answers/other-answer', { discarded: true })).status);
  statuses.push((await call(f, 'PATCH', "/ask/answers/x'%20OR%201=1--", { discarded: true })).status);
  assert.deepEqual(statuses, [400,400,400,400,400,400,404,404]);
  assert.deepEqual(receipts(f), Array.from({ length: 3 }, () => ({ action: 'research_answer_disposition_updated', user_id: 701 })));
  assert.deepEqual(rows(f, "SELECT saved,discarded,use_note FROM research_ask_answers WHERE uid='other-answer'"), [{ saved: 0, discarded: 0, use_note: null }]);
  assert.deepEqual((await call(f,'GET','/ask/sessions?scope=all')).body.items.map((item: any) => item.uid), ['own-answer']);
});

test('D549: document metadata kinds/year/title preserve omissions and scope every write', async () => {
  const f = fixture(); const title = "Report'; DROP TABLE research_documents; --";
  const updated = await call(f,'PATCH','/documents/own-doc',{ title, kind:'report', source_year:2025 });
  assert.deepEqual([updated.status,updated.body.item.title,updated.body.item.kind,updated.body.item.source_year], [200,title,'report',2025]);
  await call(f,'PATCH','/documents/own-doc',{ kind:'primary' });
  const cleared = await call(f,'PATCH','/documents/own-doc',{ kind:'legal',source_year:null });
  assert.deepEqual([cleared.body.item.title,cleared.body.item.kind,cleared.body.item.source_year], [title,'legal',null]);
  const statuses=[];
  for (const body of [{}, {title:''},{title:7},{kind:'unknown'},{source_year:999},{source_year:new Date().getUTCFullYear()+2},{source_year:2025.1},{source_year:'2025'}]) statuses.push((await call(f,'PATCH','/documents/own-doc',body)).status);
  statuses.push((await call(f,'PATCH','/documents/other-doc',{ title:'stolen' })).status);
  assert.deepEqual(statuses,[400,400,400,400,400,400,400,400,404]);
  assert.deepEqual(receipts(f), Array.from({ length:3 },()=>({ action:'research_document_metadata_updated',user_id:701 })));
  assert.deepEqual([f.statements.some((query)=>query.includes(title)),rows(f,"SELECT title,kind,source_year FROM research_documents WHERE uid='other-doc'")], [false,[{title:'Other file',kind:'document',source_year:null}]]);
});

test('D549: collections list/create/rename/delete and membership preserve documents and actors', async () => {
  const f = fixture();
  assert.deepEqual((await call(f,'GET','/collections')).body.items, []);
  const name="Founder's collection'; DELETE FROM users; --";
  const created=await call(f,'POST','/collections',{name}); const uid=created.body.item.uid;
  assert.deepEqual([created.status,created.body.item.name,created.body.item.document_uids], [201,name,[]]);
  await call(f,'POST',`/collections/${uid}/documents`,{document_uid:'own-doc'});
  await call(f,'POST',`/collections/${uid}/documents`,{document_uid:'own-doc'});
  await call(f,'PATCH',`/collections/${uid}`,{name:'Renamed'});
  const list=(await call(f,'GET','/collections')).body.items;
  assert.deepEqual(list.map((item: any)=>[item.uid,item.name,item.document_uids]), [[uid,'Renamed',['own-doc']]]);
  assert.deepEqual(rows(f,'SELECT created_by FROM research_collections UNION ALL SELECT created_by FROM research_collection_documents'), [{created_by:701},{created_by:701}]);
  const removed=await call(f,'DELETE',`/collections/${uid}/documents/own-doc`);
  assert.deepEqual([removed.status,(await call(f,'GET','/collections')).body.items[0].document_uids], [200,[]]);
  await call(f,'POST',`/collections/${uid}/documents`,{document_uid:'own-doc'});
  f.db.exec('PRAGMA foreign_keys=ON');
  const deleted=await call(f,'DELETE',`/collections/${uid}`);
  assert.deepEqual([deleted.status,rows(f,'SELECT COUNT(*) AS n FROM research_collection_documents'),rows(f,'SELECT COUNT(*) AS n FROM research_documents')], [200,[{n:0}],[{n:2}]]);
  assert.deepEqual(receipts(f).map((row)=>[row.action,row.user_id]), ['created','document_added','document_added','renamed','document_removed','document_added','deleted'].map((action)=>[`research_collection_${action}`,701]));
  assert.equal(f.statements.some((query)=>query.includes(name)), false);
});

test('D549: every collection/member route refuses another owner and invalid writes leave no receipt', async () => {
  const f=fixture();const own=(await call(f,'POST','/collections',{name:'Own'})).body.item.uid;
  const other=(await call(f,'POST','/collections',{name:'Other'},702)).body.item.uid;
  await call(f,'POST',`/collections/${other}/documents`,{document_uid:'other-doc'},702);
  // An inconsistent legacy membership must not let this owner remove another user's file.
  f.db.prepare('INSERT INTO research_collection_documents (collection_id,document_id,created_by) SELECT id,2,701 FROM research_collections WHERE uid=?').run(own);
  const before=receipts(f);
  const attempts: [string,string,unknown?][]=[['PATCH',`/collections/${other}`,{name:'stolen'}],['DELETE',`/collections/${other}`],['POST',`/collections/${other}/documents`,{document_uid:'own-doc'}],['DELETE',`/collections/${other}/documents/other-doc`],['POST',`/collections/${own}/documents`,{document_uid:'other-doc'}],['DELETE',`/collections/${own}/documents/other-doc`],['PATCH',"/collections/x'%20OR%201=1--",{name:'stolen'}]];
  const statuses=[];for(const [method,path,body] of attempts) statuses.push((await call(f,method,path,body)).status);
  assert.deepEqual(statuses,[404,404,404,404,404,404,404]);
  const invalid=[];for(const name of ['', 'x'.repeat(121), 1]) { invalid.push((await call(f,'POST','/collections',{name})).status);invalid.push((await call(f,'PATCH',`/collections/${own}`,{name})).status); }
  invalid.push((await call(f,'POST',`/collections/${own}/documents`,{})).status);
  assert.deepEqual(invalid,[400,400,400,400,400,400,400]);
  assert.deepEqual([(await call(f,'GET','/collections')).body.items.map((item: any)=>item.uid),receipts(f)], [[own],before]);
});

test('D549: Ask stores the owned citation UID, including when its model is unavailable', async () => {
  const f=fixture();
  f.env.AI={run:async (model: string)=>model.includes('bge') ? {data:[Array(768).fill(0.01)]} : {response:'The interviews show a recurring need.'}};
  f.env.VECTORIZE={query:async()=>({matches:[{id:'research_doc:1:0',score:0.9,metadata:{type:'research_doc',entity_id:1,owner_user_id:701,title:'Interview',snippet:'Recurring need',chunk:0}},{id:'research_doc:2:0',score:0.9,metadata:{type:'research_doc',entity_id:2,owner_user_id:702,title:'Private',snippet:'Private'}},{id:'research_doc:2:1',score:0.9,metadata:{type:'research_doc',entity_id:2,owner_user_id:701,title:'Stale vector label',snippet:'Synthetic stale reference'}}]})};
  const answered=await call(f,'POST','/ask',{question:'What need?'});
  assert.deepEqual([answered.status,answered.body.reason,answered.body.citations.map((citation: any)=>citation.document_uid)], [200,'answered',['own-doc',null]]);
  f.env.AI.run=async (model: string)=>{if(model.includes('bge')) return {data:[Array(768).fill(0.01)]};throw Error('synthetic model outage');};
  const unavailable=await call(f,'POST','/ask',{question:'What else?'});
  assert.deepEqual([unavailable.status,unavailable.body.reason,unavailable.body.citations.map((citation: any)=>citation.document_uid)], [200,'model_unavailable',['own-doc',null]]);
  assert.deepEqual(rows(f,"SELECT owner_user_id,citations FROM research_ask_answers WHERE uid != 'own-answer' AND uid != 'other-answer'").map((row)=>[row.owner_user_id,JSON.parse(row.citations as string).map((citation: any)=>citation.document_uid)]), [[701,['own-doc',null]],[701,['own-doc',null]]]);
});
