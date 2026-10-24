/** #2392: real CHECK constraints, cascading children and the mounted DD route. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import { makeD1 } from './_d1_sqlite.mjs';
import { tableFromBaseline } from './_baseline.mjs';
import dd from '../src/routes/dd.ts';
import { sectionsFor, checklistFor, encField, decField, type DDSubjectType } from '../src/services/dueDiligence.ts';

const BASELINE=readFileSync(new URL('../sql/schema_baseline.sql',import.meta.url),'utf8');
// S1 assigned migration 535 and decision D888 on #2392.
const REBUILD=readFileSync(new URL('../sql/migrations/535_dd_advisor_subject.sql',import.meta.url),'utf8');
const OLD_CASE=tableFromBaseline(readFileSync(new URL('../sql/migrations/008_due_diligence.sql',import.meta.url),'utf8'),'dd_cases');
const OLD_SCHEMA=BASELINE.replace(tableFromBaseline(BASELINE,'dd_cases'),OLD_CASE+"\nALTER TABLE dd_cases ADD COLUMN template_depth TEXT NOT NULL DEFAULT 'standard';");
const SUBJECTS=['project','founder','advisor','investor','partner'] as const;
const TABLES=['dd_cases','dd_sections','dd_external_sources','dd_findings','dd_attachments','dd_reviewers','dd_reports','dd_audit_log','dd_checklist_items','dd_requests','ic_decisions'] as const;
const SECRET='synthetic-dd-regression-signing-secret-0123456789';
function world(fresh=false) {
  const w=makeD1(fresh?BASELINE:OLD_SCHEMA);
  w.db.exec('PRAGMA foreign_keys=ON');
  // Applied migration 339 is present in production but not in the older baseline.
  w.db.exec(readFileSync(new URL('../sql/migrations/339_dd_section_signoff.sql',import.meta.url),'utf8'));
  w.db.prepare("INSERT INTO users(id,name,email,role,is_active) VALUES(1,'Synthetic','synthetic@example.test','admin',1)").run();
  return {...w,env:{DB:w.DB,JWT_SECRET:SECRET,ENVIRONMENT:'development'} as any};
}
function apply(w:any,sql=REBUILD) {
  // The migration file contains no transaction SQL; D1 supplies this wrapper.
  w.db.exec('BEGIN');
  try {w.db.exec(sql);w.db.exec('COMMIT');}catch(e){w.db.exec('ROLLBACK');throw e;}
}
const plain=(rows:any[])=>rows.map(r=>({...r}));
function snapshot(w:any) {
  return Object.fromEntries(TABLES.map(t=>[t,plain(w.db.prepare(`SELECT * FROM ${t} ORDER BY id`).all())]));
}
function sequences(w:any) {
  return plain(w.db.prepare("SELECT name,seq FROM sqlite_sequence WHERE name GLOB 'dd_*' ORDER BY name").all());
}
function indexes(w:any) {
  return plain(w.db.prepare("SELECT name,sql FROM sqlite_master WHERE type='index' AND tbl_name='dd_cases' ORDER BY name").all());
}
function shape(w:any) {
  return {columns:plain(w.db.prepare('PRAGMA table_info(dd_cases)').all()),foreignKeys:plain(w.db.prepare('PRAGMA foreign_key_list(dd_cases)').all())};
}
async function seed(w:any) {
  w.db.prepare("INSERT INTO dd_cases(id,uid,subject_type,subject_id,subject_label,owner_user_id) VALUES(900,'deleted-synthetic','project',1,'Synthetic',1)").run();
  w.db.prepare('DELETE FROM dd_cases WHERE id=900').run();
  w.db.prepare(`INSERT INTO dd_cases(id,uid,subject_type,subject_id,subject_label,owner_user_id,template_depth,status,risk_score,risk_band,created_at,updated_at)
    VALUES(7,'legacy-synthetic','mentor',1,'Synthetic',1,'deep','completed',0.25,'red','2026-01-01','2026-02-01')`).run();
  w.db.prepare('UPDATE dd_cases SET notes_enc=?,subject_email_enc=?,subject_email_idx=?,subject_legal_name_enc=? WHERE id=7')
    .run(await encField(w.env,'dd_cases','notes',7,'Synthetic notes'),await encField(w.env,'dd_cases','subject_email',7,'synthetic@example.test'),'synthetic-index',await encField(w.env,'dd_cases','subject_legal_name',7,'Synthetic'));
  w.db.prepare("INSERT INTO dd_sections(id,case_id,section_key,title,reviewer_notes_enc,signed_off_by) VALUES(17,7,'synthetic','Synthetic',?,1)")
    .run(await encField(w.env,'dd_sections','reviewer_notes',17,'Synthetic review'));
  w.db.prepare("INSERT INTO dd_external_sources(id,case_id,connector,raw_response_enc) VALUES(27,7,'synthetic',?)")
    .run(await encField(w.env,'dd_external_sources','raw_response',27,'Synthetic source'));
  w.db.prepare("INSERT INTO dd_findings(id,case_id,section_id,source_id,source_kind,severity,title,detail_enc) VALUES(37,7,17,27,'synthetic','high','Synthetic',?)")
    .run(await encField(w.env,'dd_findings','detail',37,'Synthetic finding'));
  w.db.prepare("INSERT INTO dd_attachments(id,case_id,section_id,file_key,filename,uploaded_by_user_id) VALUES(47,7,17,'synthetic','synthetic.bin',1)").run();
  w.db.prepare('INSERT INTO dd_reviewers(id,case_id,section_id,user_id) VALUES(57,7,17,1)').run();
  w.db.prepare("INSERT INTO dd_reports(id,case_id,format,storage_key,generated_by_user_id) VALUES(67,7,'pdf','synthetic',1)").run();
  w.db.prepare("INSERT INTO dd_audit_log(id,case_id,action,details_enc) VALUES(77,7,'synthetic',?)")
    .run(await encField(w.env,'dd_audit_log','details',77,'Synthetic audit'));
  w.db.prepare("INSERT INTO dd_checklist_items(id,case_id,section_id,item_key,title,note_enc) VALUES(87,7,17,'synthetic','Synthetic',?)")
    .run(await encField(w.env,'dd_checklist_items','note',87,'Synthetic checklist'));
  w.db.prepare("INSERT INTO dd_requests(id,case_id,section_id,title,details,response_note) VALUES(97,7,17,'Synthetic','Synthetic request','Synthetic response')").run();
  w.db.prepare("INSERT INTO ic_decisions(uid,title,dd_case_id,created_by) VALUES('synthetic-ic','Synthetic',7,1)").run();
}
function appFor(router=dd) {
  const app=new Hono();app.route('/api/dd',router as any);
  app.onError((_e,c)=>c.json({error:'Request failed'},500));
  return app;
}
async function request(w:any,method:string,path:string,body?:any,router=dd) {
  const token=await new SignJWT({user_id:1,role:'admin'}).setProtectedHeader({alg:'HS256'}).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(SECRET));
  return appFor(router).fetch(new Request('https://example.test/api/dd'+path,{method,headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)}),w.env);
}
async function creation(sql=REBUILD,router=dd,fresh=false) {
  const w=world(fresh);
  try {
    if(!fresh) apply(w,sql);
    for(const type of SUBJECTS) {
      const r=await request(w,'POST','/cases',{subject_type:type,subject_id:1,subject_label:'Synthetic',template_depth:'deep',notes:'Synthetic new notes'},router);
      assert.equal(r.status,201,type);
      const row:any=await r.json();
      assert.equal(row.subject_type,type);
      assert.equal(row.sections_seeded,sectionsFor(type).length);
      assert.equal(row.checklist_seeded,checklistFor(type,'deep').length);
      const stored=w.db.prepare('SELECT notes_enc FROM dd_cases WHERE id=?').get(row.id);
      assert.equal(await decField(w.env,'dd_cases','notes',row.id,String(stored!.notes_enc)),'Synthetic new notes');
      const read=await request(w,'GET','/cases/'+row.uid,undefined,router);assert.equal(read.status,200);
    }
    for(const type of ['mentor','unexpected',"advisor' OR 1=1 --"])
      assert.equal((await request(w,'POST','/cases',{subject_type:type,subject_id:1,subject_label:'Synthetic'},router)).status,400);
    assert.throws(()=>w.db.prepare("INSERT INTO dd_cases(uid,subject_type,subject_id,subject_label,owner_user_id) VALUES('bad','unexpected',1,'Synthetic',1)").run(),/CHECK/);
    assert.equal(w.db.prepare('PRAGMA foreign_key_check').all().length,0);
  }finally{w.db.close();}
}
async function preservation(sql=REBUILD) {
  const w=world();
  try {
    await seed(w);
    const before=snapshot(w),seq=sequences(w),idx=indexes(w),schema=shape(w);
    apply(w,sql);
    assert.deepEqual(snapshot(w),before);
    assert.deepEqual(sequences(w),seq);
    assert.deepEqual(indexes(w),idx);
    assert.deepEqual(shape(w),schema);
    assert.equal(w.db.prepare('PRAGMA foreign_key_check').all().length,0);
    assert.equal(w.db.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE name LIKE '%subject_snapshot' OR name='dd_subject_sequence_snapshot'").get()!.n,0);
    const read=await request(w,'GET','/cases/legacy-synthetic');assert.equal(read.status,200);
    const legacy:any=await read.json();assert.equal(legacy.case.subject_type,'mentor');assert.equal(legacy.case.notes,'Synthetic notes');
    // Replay is lossless too, including a deleted-highest-id database.
    apply(w,sql);assert.deepEqual(snapshot(w),before);assert.deepEqual(sequences(w),seq);
    const r=await request(w,'POST','/cases',{subject_type:'advisor',subject_id:1,subject_label:'Synthetic'});
    assert.equal(r.status,201);assert.ok((await r.json() as any).id>900);
  }finally{w.db.close();}
}

test('#2392 regression: the historical schema refuses the Worker advisor request',async()=>{
  const w=world();try{assert.equal((await request(w,'POST','/cases',{subject_type:'advisor',subject_id:1,subject_label:'Synthetic'})).status,500);assert.equal(w.db.prepare('SELECT COUNT(*) n FROM dd_cases').get()!.n,0);}finally{w.db.close();}
});
test('#2392 migrated database creates and reads all current subject types through the mounted router',()=>creation());
test('#2392 fresh baseline accepts the same case creation contract',()=>creation(REBUILD,dd,true));
test('#2392 rebuild preserves legacy mentor, child graphs, ciphertext, indexes and high-water mark',()=>preservation());

async function emptyHistory(sql=REBUILD) {
  const w=world();try{
    w.db.prepare("INSERT INTO dd_cases(id,uid,subject_type,subject_id,subject_label,owner_user_id) VALUES(900,'deleted-synthetic','mentor',1,'Synthetic',1)").run();
    w.db.prepare('DELETE FROM dd_cases').run();
    apply(w,sql);assert.equal(w.db.prepare('SELECT COUNT(*) n FROM dd_cases').get()!.n,0);
    const response=await request(w,'POST','/cases',{subject_type:'advisor',subject_id:1,subject_label:'Synthetic'});
    assert.equal(response.status,201);assert.ok((await response.json() as any).id>900);
  }finally{w.db.close();}
}
test('#2392 an empty database retains its deleted-case ID history',()=>emptyHistory());

async function constraints(sql=REBUILD) {
  const w=world();try{
    apply(w,sql);
    const insert=w.db.prepare('INSERT INTO dd_cases(uid,subject_type,subject_id,subject_label,owner_user_id,status,risk_band) VALUES(?,?,?,?,?,?,?)');
    for(const values of [
      ['bad','unexpected',1,'Synthetic',1,'open',null],
      ['bad','advisor',1,'Synthetic',1,'unexpected',null],
      ['bad','advisor',1,'Synthetic',1,'open','unexpected'],
      ['bad','advisor',1,'Synthetic',999,'open',null],
      ['bad',null,1,'Synthetic',1,'open',null],
    ]) assert.throws(()=>insert.run(...values));
    w.db.prepare("INSERT INTO dd_cases(uid,subject_type,subject_id,subject_label,owner_user_id) VALUES('unique','advisor',1,'Synthetic',1)").run();
    assert.throws(()=>w.db.prepare("INSERT INTO dd_cases(uid,subject_type,subject_id,subject_label,owner_user_id) VALUES('unique','advisor',1,'Synthetic',1)").run(),/UNIQUE/);
    const row=w.db.prepare("SELECT status,template_depth,created_at,updated_at FROM dd_cases WHERE uid='unique'").get();
    assert.equal(row!.status,'open');assert.equal(row!.template_depth,'standard');assert.ok(row!.created_at);assert.ok(row!.updated_at);
  }finally{w.db.close();}
}
test('#2392 the rebuild retains unrelated constraints and defaults',()=>constraints());

const PAGE=readFileSync(new URL('../../frontend/src/pages/AdminDueDiligencePage.jsx',import.meta.url),'utf8');
const ROUTE=readFileSync(new URL('../src/routes/dd.ts',import.meta.url),'utf8');
const tokens=(s:string)=>[...s.matchAll(/'([^']+)'/g)].map(m=>m[1]).sort();
function contract(page=PAGE,route=ROUTE,baseline=BASELINE) {
  const open=page.match(/<select value=\{form.subject_type\}[\s\S]*?<\/select>/)?.[0]??'';
  const filter=page.match(/<select value=\{filter.subject_type\}[\s\S]*?<\/select>/)?.[0]??'';
  const choices=(s:string)=>[...s.matchAll(/<option value="([^"]+)"/g)].map(m=>m[1]).sort();
  const expected=[...SUBJECTS].sort();
  assert.deepEqual(choices(open),expected);
  assert.deepEqual(choices(filter),expected);
  const accepted=route.match(/if \(!\[([^\]]+)\]\.includes\(subjectType\)\)/)?.[1]??'';
  assert.deepEqual(tokens(accepted),expected);
  const check=tableFromBaseline(baseline,'dd_cases').match(/CHECK\(subject_type IN \(([^)]+)\)\)/)?.[1]??'';
  assert.deepEqual(tokens(check),[...SUBJECTS,'mentor'].sort());
}
test('#2392 page choices, Worker validation and schema stay in step with legacy mentor read support',()=>contract());

for(const [name,page,route,baseline] of [
  ['page changes advisor to mentor',PAGE.replaceAll('value="advisor"','value="mentor"'),ROUTE,BASELINE],
  ['Worker loses advisor',PAGE,ROUTE.replace("'project','founder','advisor','investor','partner'","'project','founder','investor','partner'"),BASELINE],
  ['baseline loses advisor',PAGE,ROUTE,BASELINE.replace("'mentor','advisor','investor'","'mentor','investor'")],
] as const) test('#2392 contract mutation: '+name,()=>{
  contract();assert.throws(()=>contract(page,route,baseline),assert.AssertionError);contract();
});

test('#2392 route mutation: rejecting advisor fails actual case creation',async()=>{
  const path=new URL('../src/routes/dd.ts',import.meta.url);
  const changed=ROUTE.replace("'project','founder','advisor','investor','partner'","'project','founder','investor','partner'");
  assert.notEqual(changed,ROUTE);
  const code=stripTypeScriptTypes(changed,{mode:'strip'}).replace(/(from\s*['"])([^'"]+)(['"])/g,(_m,p,s,q)=>p+(s.startsWith('.')?new URL(s+'.ts',path).href:import.meta.resolve(s))+q);
  const mutant=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
  await creation();await assert.rejects(()=>creation(REBUILD,mutant.default));await creation();
});

test('#2392 a failed rebuild rolls back every row and schema object',async()=>{
  const w=world();try{
    await seed(w);const before=snapshot(w),seq=sequences(w),idx=indexes(w);
    const broken=REBUILD.replace('CREATE TABLE dd_cases (','CREATE TABLE dd_cases BROKEN (');assert.notEqual(broken,REBUILD);
    assert.throws(()=>apply(w,broken));assert.deepEqual(snapshot(w),before);assert.deepEqual(sequences(w),seq);assert.deepEqual(indexes(w),idx);
    assert.equal(w.db.prepare('PRAGMA foreign_key_check').all().length,0);
  }finally{w.db.close();}
});

for(const [name,before,after,scenario] of [
  ['advisor omitted',"'mentor','advisor','investor'","'mentor','investor'",creation],
  ['legacy mentor omitted',"'mentor','advisor','investor'","'advisor','investor'",preservation],
  ['findings not restored','INSERT INTO dd_findings SELECT * FROM dd_findings_subject_snapshot;','',preservation],
  ['section references lost','INSERT INTO dd_sections SELECT * FROM dd_sections_subject_snapshot;','',preservation],
  ['subject index lost','CREATE INDEX idx_dd_cases_subject ON dd_cases(subject_type, subject_id);','',preservation],
  ['high-water mark lowered',"UPDATE sqlite_sequence SET seq = MAX(seq, COALESCE((SELECT MAX(seq) FROM dd_subject_sequence_snapshot), seq)) WHERE name='dd_cases';",'',preservation],
  ['empty-case ID history lost',"UPDATE sqlite_sequence SET seq = MAX(seq, COALESCE((SELECT MAX(seq) FROM dd_subject_sequence_snapshot), seq)) WHERE name='dd_cases';",'',emptyHistory],
  ['status CHECK removed',"CHECK(status IN ('open','in_review','completed','archived'))",'',constraints],
  ['risk-band CHECK removed',"CHECK(risk_band IN ('green','yellow','amber','red'))",'',constraints],
  ['owner foreign key removed','owner_user_id INTEGER NOT NULL REFERENCES users(id)','owner_user_id INTEGER NOT NULL',constraints],
] as const) test('#2392 rebuild mutation: '+name,async()=>{
  await scenario();assert.ok(REBUILD.includes(before));await assert.rejects(()=>scenario(REBUILD.replace(before,()=>after)));await scenario();
});
