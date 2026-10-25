/** D1065: real SQLite, actual rules and HTTP gates; every fixture is synthetic. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { SignJWT } from 'jose';
import route from '../src/routes/build_plan.ts';
import { planRules, planLabel, readEvidence, preparePlan, readPlan, type PlanEvidence } from '../src/services/buildPlanner.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { tableFromBaseline } from './_baseline.mjs';
const base = readFileSync('cloudflare-worker/sql/schema_baseline.sql', 'utf8');
const sql = (f: string) => readFileSync('cloudflare-worker/sql/migrations/' + f, 'utf8');
const SECRET = 'build-plan-test-secret-0123456789-abcdef';
function fixture(seed = true) {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
  for (const t of ['users', 'projects', 'activity_logs', 'discovery_interviews', 'interview_pain_severities', 'pain_groups', 'pain_group_aliases', 'hypotheses', 'hypothesis_pain_links', 'validation_decisions', 'mvp_features', 'roadmap_okrs', 'cap_table_holders', 'competitor_analyses', 'competitor_candidates', 'competitor_signals', 'ai_usage_logs', 'project_members', 'user_company_links']) db.exec(tableFromBaseline(base, t));
  db.exec('ALTER TABLE projects ADD COLUMN icp_definition_meta TEXT');
  for (const f of ['214_validate_proposals.sql', '374_entity_obligations.sql', '440_validate_cycle_stores.sql', '460_validate_record_stores.sql', '464_verdict_decisions.sql', '441_build_cycle_stores.sql', '489_interview_findings.sql', '506_ai_rail_proposals.sql', '581_build_plans.sql']) db.exec(sql(f));
  db.exec(`INSERT INTO users(id,email,name,role,founder_id,spinout_lab_active) VALUES
    (1,'one@example.test','PRIVATE PERSON','founder',100,0),(2,'two@example.test','Other','founder',200,0),(3,'admin@example.test','Admin','admin',NULL,0),
    (4,'partner@example.test','Partner','partner',NULL,0),(5,'outside@example.test','Outside','partner',NULL,0),(6,'lab@example.test','Lab','exploring',300,1),(7,'no-lab@example.test','No Lab','exploring',400,0);
    INSERT INTO projects(id,name,founder_id,company_id) VALUES(1,'One',100,10),(2,'Two',200,20),(3,'Lab',300,30),(4,'No Lab',400,40);
    INSERT INTO user_company_links(uid,company_id,user_id) VALUES('partner-one',10,4);`);
  if (seed) {
    db.exec(`INSERT INTO pain_groups(id,project_id,title) VALUES(1,1,'Slow setup');
      INSERT INTO pain_group_aliases(project_id,group_id,phrase_norm,display_phrase) VALUES(1,1,'slow setup','Slow setup');
      INSERT INTO hypotheses(id,project_id,code,claim) VALUES(1,1,'H1','Setup in one day'),(2,1,'H2','Self service works'),(3,2,'H1','PRIVATE foreign claim');
      INSERT INTO hypothesis_pain_links(id,hypothesis_id,pain_group_id,direction) VALUES(1,1,1,'supports');
      INSERT INTO validation_decisions(id,project_id,decision,state,reasoning) VALUES(1,1,'proceed','given','PRIVATE reasoning');
      INSERT INTO validation_decision_evidence(uid,decision_id,kind,ref_id,label,direction) VALUES('de1',1,'interview','pain-1-1','PRIVATE snapshot label','supports');
      INSERT INTO validation_decision_commitments(id,uid,decision_id,project_id,text,owner_user_id,due_date) VALUES(1,'c1',1,1,'Test the pilot',1,'2027-12-31');
      INSERT INTO demand_signals(id,project_id,kind,status,signal_date,who,note,amount_cents) VALUES(1,1,'loi','confirmed','2026-10-01','PRIVATE PERSON','PRIVATE note',90000),(2,1,'would_pay','confirmed','2026-10-01','PRIVATE PERSON',NULL,500),(3,1,'loi','to_confirm','2026-10-01',NULL,NULL,NULL);
      INSERT INTO mvp_features(id,project_id,title,is_must_have,hypothesis_id) VALUES(1,1,'Existing feature',1,1);`);
    for (let id = 1; id <= 3; id++) {
      db.prepare('INSERT INTO discovery_interviews(id,project_id,interviewee_name,pains_json) VALUES(?,1,?,?)').run(id, 'PRIVATE PERSON', '["Slow setup"]');
      db.prepare("INSERT INTO interview_pain_severities(interview_id,phrase_norm,severity) VALUES(?,'slow setup','severe')").run(id);
      db.prepare("INSERT INTO interview_findings(uid,project_id,interview_id,module,kind,key_norm,payload_json,quote) VALUES(?,1,?,'demand-signals','objection','price',?,?)").run('f'+id,id,'{"about":"price","detail":"PRIVATE objection"}','PRIVATE quote');
    }
    db.exec(`INSERT INTO customer_segments(id,project_id,name,name_norm) VALUES(1,1,'Small teams','small teams');
      INSERT INTO interview_findings(uid,project_id,interview_id,module,kind,key_norm,payload_json,quote) VALUES('alt',1,1,'market-intelligence','alternative','spreadsheets','{"name":"Spreadsheets"}','PRIVATE quote');`);
    db.prepare('UPDATE projects SET icp_definition_meta = ? WHERE id = 1').run(JSON.stringify({status:'confirmed',fields:{valueProp:'Fast setup',differentiator:'Self service',tone:'Clear'}}));
  }
  return { db, env: { DB: d1Over(db), JWT_SECRET: SECRET, ENVIRONMENT: 'development' } as any };
}
const empty = (): PlanEvidence => ({ themes: [], hypotheses: [], experiments: [], signals: [], objections: [], segments: [], positioning: null, alternatives: [], features: [], commitments: [], formation: [], hasEntity: false, decision: null });
const hyp = { id: 1, claim: 'Simple setup', supporting: 1, contradicting: 0 };
const proceed = { id: 1, decision: 'proceed', state: 'given', hypothesis_id: null, pivot_hypothesis_id: null, evidence_hypotheses: [1] };
const items = (e: PlanEvidence, kind: string) => planRules(e).items.filter(i => i.kind === kind);

test('rule 1: the named threshold, severity and actual support each matter', () => {
  const e = { ...empty(), hypotheses: [hyp], themes: [{ id: 1, title: 'Slow setup', mentions: 3, severity: 'severe', hypotheses: [1] }] };
  assert.equal(items(e,'feature').length,1);
  assert.deepEqual(items(e,'feature')[0].payload,{title:'Slow setup',pain_group_id:1,hypothesis_id:1,added_value:'High'});
  assert.equal(items({...e,themes:[{...e.themes[0],severity:'real'}]},'feature')[0].payload.added_value,'Medium');
  for (const t of [{...e.themes[0],mentions:2},{...e.themes[0],severity:'mild'},{...e.themes[0],hypotheses:[]}]) assert.equal(items({...e,themes:[t]},'feature').length,0);
  assert.equal(items({...e,hypotheses:[{...hyp,supporting:0}]},'feature').length,0);
});
test('rules 2 and 3: Proceed proves a supported claim; Pivot tests its new claim, never a must-have', () => {
  const e = { ...empty(), hypotheses: [hyp], decision: proceed };
  assert.deepEqual(items(e,'must-have')[0].payload,{title:'Prove Simple setup',hypothesis_id:1});
  assert.equal(items({...e,decision:null},'must-have').length,0);
  assert.equal(items({...e,decision:{...proceed,evidence_hypotheses:[]}},'must-have').length,0);
  assert.equal(items({...empty(),hypotheses:[hyp]},'prototype-test').length,0);
  assert.equal(items({...e,decision:{...proceed,state:'withheld'}},'must-have').length,0);
  const pivot = {...e,decision:{...proceed,decision:'pivot',pivot_hypothesis_id:1}};
  assert.equal(items(pivot,'must-have').length,0); assert.equal(items(pivot,'prototype-test').length,1);
  assert.equal(items({...empty(),hypotheses:[{...hyp,supporting:0}]},'prototype-test').length,1);
  assert.equal(items({...empty(),hypotheses:[hyp],experiments:[{id:2,hypothesis_id:1,title:'Try it'}]},'prototype-test').length,1);
});
test('rule 4: only an actual prototype test gets the recorded signal count', () => {
  const e = {...empty(),hypotheses:[{...hyp,supporting:0}],signals:[{id:1,kind:'loi',source_label:'Document' as const},{id:2,kind:'would_pay',source_label:'Typed' as const}]};
  assert.equal(items(e,'prototype-test')[0].payload.target,'2 confirmed demand signals to invite');
  assert.equal(items({...e,signals:[]},'prototype-test')[0].payload.target,undefined);
  assert.equal(items({...e,hypotheses:[]},'prototype-test').length,0);
});
test('rule 5: objections and contrary evidence make count-based risks', () => {
  const e = {...empty(),objections:[{about:'price',mentions:3,refs:[1,2,3]}],hypotheses:[{...hyp,contradicting:2}]};
  assert.deepEqual(items(e,'risk').map(i=>i.payload.severity),['high','medium']);
  assert.equal(items(empty(),'risk').length,0);
});
test('rule 6: the brief retains structured keys and labels, without inventing wording', () => {
  const e = {...empty(),segments:[{id:1,label:'Teams'}],positioning:{valueProp:'Fast'},alternatives:[{id:'c1',kind:'competitor' as const,label:'Existing tool'}]};
  assert.deepEqual(planRules(e).brief,{audience:[{key:'segment-1',label:'Teams'}],problems:[],positioning:{valueProp:'Fast'},replaces:[{key:'competitor-c1',label:'Existing tool'}]});
});
test('rule 7: accepted features map to Now/Next/Later, and would-pay unlocks the KPI', () => {
  const e = {...empty(),themes:[{id:1,title:'Real',mentions:1,severity:'real',hypotheses:[]},{id:2,title:'Mild',mentions:1,severity:'mild',hypotheses:[]}],features:[{id:1,title:'Must',is_must_have:1,pain_group_id:null},{id:2,title:'Next',is_must_have:0,pain_group_id:1},{id:3,title:'Later',is_must_have:0,pain_group_id:2}],signals:[{id:1,kind:'would_pay',source_label:'Typed' as const}]};
  assert.deepEqual(items(e,'roadmap').map(i=>[i.payload.title,i.payload.lane]),[['Must','Now'],['Next','Next'],['Later','Later'],['First paying customer','Now']]);
  assert.equal(items(e,'roadmap')[3].payload.kpi_key,'paying_accounts');
  assert.equal(items({...e,signals:[],features:[]},'roadmap').length,0);
});
test('rule 8: commitments carry their label and source, never an owner or a proposed date', () => {
  const e={...empty(),commitments:[{id:7,text:'Run the pilot'}]};
  assert.deepEqual(items(e,'roadmap')[0].payload,{title:'Run the pilot',from_commitment:7});
});
test('rule 9: formation needs a given Proceed, no entity and no existing equivalent step', () => {
  const e={...empty(),decision:proceed};
  assert.deepEqual(items(e,'formation-step').map(i=>i.payload.title),['Incorporate','Assign the IP to the company']);
  assert.equal(items({...e,hasEntity:true},'formation-step').length,0);
  assert.equal(items({...e,decision:{...proceed,state:'withheld'}},'formation-step').length,0);
  assert.equal(items({...e,formation:['incorporate']},'formation-step').length,1);
});
test('rule 10 and no-evidence: connectors are doors backed by a real test, never writes or founding-team changes', () => {
  assert.deepEqual(planRules(empty()).items,[]);
  assert.deepEqual(planRules({...empty(),hypotheses:[hyp],decision:{...proceed,decision:'stop'}}).items,[]);
  const out=planRules({...empty(),hypotheses:[{...hyp,supporting:0}]}).items;
  assert.deepEqual(out.filter(i=>i.kind==='connect-door').map(i=>i.payload.href),['/build/connect?tool=github','/build/connect?tool=vercel','/build/connect?tool=posthog']);
  assert.ok(out.every(i=>i.module!=='founding-team' as any));
  assert.doesNotMatch(JSON.stringify(out),/due_date|amount_cents|cap_table|verdict/);
});

test('the evidence projection uses accepted rows and counts, never interviews, quotes, contacts, amounts or dates', async () => {
  const {db,env}=fixture();
  try {
    const e=await readEvidence(env,1);
    assert.equal(e.themes[0].mentions,3); assert.equal(e.themes[0].severity,'severe');
    assert.equal(e.hypotheses[0].supporting,3); assert.deepEqual(e.signals.map(s=>s.id),[1,2]);
    assert.deepEqual(e.objections,[{about:'price',mentions:3,refs:[1,2,3]}]);
    assert.equal(e.positioning?.valueProp,'Fast setup'); assert.equal(e.alternatives[0].label,'Spreadsheets');
    assert.doesNotMatch(JSON.stringify(e),/PRIVATE|@|90000|2027-12-31|reasoning|quote|interviewee/);
    db.exec("UPDATE projects SET icp_definition_meta = '{\"status\":\"draft\",\"fields\":{\"valueProp\":\"PRIVATE draft\"}}' WHERE id = 1");
    assert.equal((await readEvidence(env,1)).positioning,null);
  } finally { db.close(); }
});

test('preparation is atomic/idempotent, shares real source columns, and never writes a Build record', async () => {
  const {db,env}=fixture();
  try {
    const first=await preparePlan(env,1,1); const second=await preparePlan(env,1,1);
    assert.equal(first.plan?.uid,second.plan?.uid);
    const proposals:any[]=db.prepare('SELECT * FROM ai_rail_proposals').all();
    assert.ok(proposals.length>0); assert.equal(proposals.length,db.prepare('SELECT COUNT(*) n FROM build_plan_items').get()!.n);
    assert.ok(proposals.every(q=>q.kind==='proposal'&&q.source_kind==='module'&&q.source_ref&&q.source_label&&q.usage_log_id===null&&q.model===null));
    assert.equal(db.prepare('SELECT COUNT(*) n FROM build_plans').get()!.n,1);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM mvp_features').get()!.n,1);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM build_evidence_links').get()!.n,0);
    const old=proposals[0]; db.prepare("UPDATE ai_rail_proposals SET status='discarded' WHERE uid=?").run(old.uid);
    await preparePlan(env,1,1); assert.equal(db.prepare('SELECT status FROM ai_rail_proposals WHERE uid=?').get(old.uid)!.status,'discarded');
    db.exec("UPDATE hypotheses SET retired_at='2026-10-01' WHERE id=2"); await preparePlan(env,1,1);
    assert.equal(db.prepare("SELECT status FROM ai_rail_proposals WHERE payload_json LIKE '%Self service works%' LIMIT 1").get()!.status,'withdrawn');
    assert.equal(first.plan?.evidence_hash?.length,64);
  } finally { db.close(); }
});

test('paused, stopped, empty and foreign-scope plans refuse without adding rows; a read failure is not no evidence', async () => {
  const {db,env}=fixture(false);
  try {
    await assert.rejects(()=>preparePlan(env,1,1),(e:any)=>e.code==='no_evidence');
    await assert.rejects(()=>preparePlan(env,1,1,'h-999'),(e:any)=>e.code==='not_this_project');
    db.exec("INSERT INTO validation_decisions(project_id,decision,state) VALUES(1,'stop','given')");
    await assert.rejects(()=>preparePlan(env,1,1),(e:any)=>e.code==='plan_paused');
    assert.equal(db.prepare('SELECT COUNT(*) n FROM build_plans').get()!.n,0);
    db.exec('DROP TABLE discovery_interviews'); await assert.rejects(()=>readEvidence(env,1));
  } finally { db.close(); }
});

async function call(env:any,user:number|null,method='GET',project=1,scope='venture') {
  const headers:any={'Content-Type':'application/json'};
  if(user) headers.Authorization='Bearer '+await new SignJWT({user_id:user}).setProtectedHeader({alg:'HS256'}).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(SECRET));
  const r=await route.request(`/?project=${project}&scope=${scope}`,{method,headers,...(method==='POST'?{body:'{}'}:{})},env);
  return {status:r.status,body:await r.json() as any};
}
test('HTTP: owners/Lab prepare, admins only read, related partners get only landed accepted items without a decision', async () => {
  const {db,env}=fixture();
  try {
    assert.equal((await call(env,null)).status,401);
    assert.equal((await call(env,2)).status,404); assert.equal((await call(env,5)).status,404);
    assert.equal((await call(env,3,'POST')).status,404); assert.equal((await call(env,4,'POST')).status,404);
    const made=await call(env,1,'POST'); assert.equal(made.status,200); assert.ok(made.body.plan.decision_id);
    assert.equal((await call(env,3)).body.plan.uid,made.body.plan.uid);
    let p=await call(env,4); assert.deepEqual(Object.values(p.body.modules).flat(),[]); assert.equal(p.body.plan,null);
    const row:any=db.prepare("SELECT uid,proposal_uid FROM build_plan_items WHERE kind='feature' LIMIT 1").get();
    db.prepare("UPDATE ai_rail_proposals SET status='accepted' WHERE uid=?").run(row.proposal_uid);
    p=await call(env,4); assert.deepEqual(Object.values(p.body.modules).flat(),[],'accepted without a landed row is not progress');
    db.prepare("UPDATE build_plan_items SET landed_table='mvp_features',landed_id='1' WHERE uid=?").run(row.uid);
    p=await call(env,4); assert.equal(Object.values(p.body.modules).flat().length,1); assert.equal(p.body.brief,null);
    assert.doesNotMatch(JSON.stringify(p.body),/decision|Recorded Proceed|PRIVATE/);
    db.exec("UPDATE projects SET deleted_at='2026-10-01' WHERE id=1"); assert.equal((await call(env,1)).status,404);
    db.exec("INSERT INTO hypotheses(project_id,code,claim) VALUES(3,'H1','Lab idea')"); assert.equal((await call(env,6,'POST',3)).status,200);
    assert.equal((await call(env,7,'POST',4)).status,404);
  } finally { db.close(); }
});

test('concurrent preparation keeps one plan and one proposal per item; marker and evidence keys are enforced', async () => {
  const {db,env}=fixture();
  try {
    const [a,b]=await Promise.all([preparePlan(env,1,1),preparePlan(env,1,1)]);
    assert.equal(a.plan?.uid,b.plan?.uid);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM build_plans').get()!.n,1);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM ai_rail_proposals').get()!.n,db.prepare('SELECT COUNT(*) n FROM build_plan_items').get()!.n);
    const rows:any[]=db.prepare('SELECT uid,marker FROM build_plan_items ORDER BY uid LIMIT 2').all();
    assert.throws(()=>db.prepare('UPDATE build_plan_items SET marker=? WHERE uid=?').run(rows[0].marker,rows[1].uid),/UNIQUE/);
    db.exec("INSERT INTO build_evidence_links(project_id,build_table,build_id,evidence_kind,evidence_ref,label_snapshot) VALUES(1,'mvp_features','1','hypothesis','1','Claim')");
    assert.throws(()=>db.exec("INSERT INTO build_evidence_links(project_id,build_table,build_id,evidence_kind,evidence_ref,label_snapshot) VALUES(1,'mvp_features','1','hypothesis','1','Changed label')"),/UNIQUE/);
  } finally { db.close(); }
});
test('a failed batch or absent shared source schema writes neither a plan nor an orphan proposal', async () => {
  const {db,env}=fixture();
  try {
    const real=env.DB;
    const failed={...env,DB:{...real,batch:(stmts:any[])=>real.batch([...stmts,real.prepare("INSERT INTO build_plans(uid,project_id,scope,trigger,evidence_hash,created_by) VALUES('bad',1,'venture','invalid','hash',1)")])}};
    await assert.rejects(()=>preparePlan(failed,1,1));
    assert.deepEqual({...db.prepare('SELECT (SELECT COUNT(*) FROM build_plans) plans, (SELECT COUNT(*) FROM ai_rail_proposals) proposals, (SELECT COUNT(*) FROM build_plan_items) items').get()}, {plans:0,proposals:0,items:0});
    db.exec('ALTER TABLE ai_rail_proposals DROP COLUMN source_kind');
    assert.equal((await call(env,1,'POST')).status,503);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM build_plans').get()!.n,0);
  } finally { db.close(); }
});
test('a newer decision creates a new current plan; accepted and discarded items never become proposed again', async () => {
  const {db,env}=fixture();
  try {
    const a=await preparePlan(env,1,1);
    const accepted:any=db.prepare("SELECT uid,proposal_uid FROM build_plan_items WHERE kind='feature'").get();
    const discarded:any=db.prepare("SELECT proposal_uid FROM build_plan_items WHERE kind='must-have'").get();
    db.prepare("UPDATE ai_rail_proposals SET status='accepted' WHERE uid=?").run(accepted.proposal_uid);
    db.prepare("UPDATE build_plan_items SET landed_table='mvp_features',landed_id='1' WHERE uid=?").run(accepted.uid);
    db.prepare("UPDATE ai_rail_proposals SET status='discarded' WHERE uid=?").run(discarded.proposal_uid);
    db.exec("UPDATE validation_decisions SET superseded_at=CURRENT_TIMESTAMP WHERE id=1; INSERT INTO validation_decisions(id,project_id,decision,state,supersedes_id) VALUES(2,1,'proceed','given',1); INSERT INTO validation_decision_evidence(uid,decision_id,kind,ref_id,label,direction) VALUES('de2',2,'interview','pain-1-1','Claim evidence','supports')");
    const b=await preparePlan(env,1,1);
    assert.notEqual(a.plan?.uid,b.plan?.uid); assert.equal(b.plan?.decision_id,2);
    assert.equal(db.prepare('SELECT status FROM build_plans WHERE uid=?').get(a.plan!.uid)!.status,'superseded');
    assert.equal(db.prepare('SELECT status FROM ai_rail_proposals WHERE uid=?').get(discarded.proposal_uid)!.status,'discarded');
    assert.equal(Object.values(b.modules).flat().filter((i:any)=>i.kind==='feature'&&i.status==='accepted').length,1);
    assert.equal(Object.values(b.modules).flat().filter((i:any)=>i.kind==='must-have').length,0);
    db.exec("UPDATE build_plans SET status='paused' WHERE status='draft'");
    await assert.rejects(()=>preparePlan(env,1,1),(e:any)=>e.code==='plan_paused');
    assert.equal((await readPlan(env,1)).plan?.status,'paused');
  } finally { db.close(); }
});
test('hypothesis scope and a Pivot read only their claim; cross-project hypotheses are refused on read too', async () => {
  const {db,env}=fixture();
  try {
    db.exec("INSERT INTO validation_decisions(id,project_id,decision,state,hypothesis_id,pivot_hypothesis_id) VALUES(2,1,'pivot','given',1,2)");
    const e=await readEvidence(env,1,'h-1');
    assert.deepEqual(e.hypotheses.map(h=>h.id),[2]); assert.deepEqual(e.themes,[]); assert.deepEqual(e.signals,[]);
    const out=await preparePlan(env,1,1,'h-1');
    assert.equal(out.modules['prototype-mvp'].filter(i=>i.kind==='prototype-test').length,1);
    assert.equal(out.modules['prototype-mvp'].filter(i=>i.kind==='must-have').length,0);
    assert.equal((await call(env,1,'GET',1,'h-3')).status,404);
  } finally { db.close(); }
});

test('pending Validate proposals and unconfirmed evidence never seed a plan; old rail rows survive the nullable migration', async () => {
  const {db,env}=fixture(false);
  try {
    db.exec(`INSERT INTO validate_proposals(project_id,kind,payload_json,status) VALUES(1,'hypothesis','{"claim":"PRIVATE pending claim"}','pending');
      INSERT INTO demand_signals(project_id,kind,status,signal_date) VALUES(1,'loi','to_confirm','2026-10-01');`);
    await assert.rejects(()=>preparePlan(env,1,1),(e:any)=>e.code==='no_evidence');
    assert.deepEqual((await readEvidence(env,1)).hypotheses,[]);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM ai_rail_proposals').get()!.n,0);
  } finally { db.close(); }
  const legacy=new DatabaseSync(':memory:',{enableForeignKeyConstraints:false});
  try {
    legacy.exec(sql('506_ai_rail_proposals.sql'));
    legacy.exec("INSERT INTO ai_rail_proposals(uid,user_id,rail_page,rail_option,kind,payload_json) VALUES('legacy',1,'Page','Option','draft','{\"title\":\"Kept\"}')");
    legacy.exec(sql('581_build_plans.sql'));
    const r:any=legacy.prepare('SELECT payload_json,source_kind,source_ref,source_label FROM ai_rail_proposals').get();
    assert.deepEqual({...r},{payload_json:'{"title":"Kept"}',source_kind:null,source_ref:null,source_label:null});
  } finally { legacy.close(); }
});

test('carried labels remove quote, contact, link, date and currency patterns', () => {
  assert.equal(planLabel('Build "PRIVATE words" fast person@example.test https://private.example.test +1 212 555 1212 $500 2027-12-31'),'Build fast');
});
