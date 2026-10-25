import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import { tableFromBaseline } from './_baseline.mjs';
import { d1Over } from './_d1_sqlite.mjs';
import { recomputePmf, pmfHistory, pmfChecklist, pmfInputHash } from '../src/services/scoring/pmfStore.ts';
import { overallReadiness, loadReadiness, latestScores } from '../src/services/raiseCycle.ts';
import cycleRaise from '../src/routes/cycle_raise.ts';
import { PMF_MODEL_V1, scorePmf, type PmfResult } from '../src/services/scoring/pmf.ts';
import { collectPmfInputs } from '../src/services/scoring/pmfCollector.ts';

const TODAY='2026-10-25', SECRET='synthetic-pmf-store-test-secret-0123456789';
const read=(file:string)=>readFileSync(new URL(file,import.meta.url),'utf8');
const baseline=read('../sql/schema_baseline.sql');
const sql=(f:string)=>read('../sql/migrations/'+f);
function fixture() {
 const db=new DatabaseSync(':memory:',{enableForeignKeyConstraints:false,enableDoubleQuotedStringLiterals:true});
 for(const t of ['users','projects','activity_logs','data_room_files','raise_prospects','spinout_deck_overrides','discovery_interviews','interview_pain_severities','pain_groups','pain_group_aliases','hypotheses','hypothesis_pain_links','waitlist_signups','metric_targets','validation_decisions','roadmap_okrs','competitor_analyses','competitor_candidates','competitor_sources','competitor_signals']) db.exec(tableFromBaseline(baseline,t));
 for(const f of ['311_revenue_entries.sql','440_validate_cycle_stores.sql','464_verdict_decisions.sql','460_validate_record_stores.sql','438_interview_sessions.sql','499_github_roadmap.sql','442_raise_cycle_stores.sql','536_readiness_stated_evidence.sql','558_readiness_scores_nullable_score.sql','598_venture_scorecards.sql']) db.exec(sql(f));
 db.exec("INSERT INTO users(id,email,name,role,is_active,founder_id) VALUES (1,'owner@example.test','Synthetic founder','founder',1,101),(2,'other@example.test','Other founder','founder',1,102),(3,'admin@example.test','Synthetic admin','admin',1,NULL),(4,'partner@example.test','Synthetic partner','partner',1,NULL),(5,'investor@example.test','Synthetic investor','investor',1,NULL)");
 db.exec("INSERT INTO projects(id,name,founder_id) VALUES (1,'Synthetic venture',101),(2,'Other venture',102)");
 const env:any={DB:d1Over(db),JWT_SECRET:SECRET,ENVIRONMENT:'development'};
 return {db,env};
}
function medium(db:DatabaseSync) {
 db.exec("INSERT INTO customer_segments(id,project_id,name,name_norm,source) VALUES (1,1,'Synthetic segment','synthetic segment','manual')");
 for(let id=1;id<=5;id++) {
  db.prepare("INSERT INTO discovery_interviews(id,project_id,interviewee_name,notes,stage,done_at,icp_fit,segment_id,pains_json) VALUES (?,1,'Private person','Private quote','done','2026-10-01','strong',1,'[\"Synthetic pain\"]')").run(id);
  db.prepare("INSERT INTO interview_sessions(uid,project_id,interview_id,created_by_user_id,channel,status) VALUES (?,1,?,1,'video','recording')").run('s-'+id,id);
  db.prepare("INSERT INTO interview_pain_severities(interview_id,phrase_norm,severity) VALUES (?,'synthetic pain','severe')").run(id);
 }
 db.exec("INSERT INTO revenue_entries(uid,project_id,customer,amount_cents,revenue_type,received_on,verification) VALUES ('pilot',1,'Private customer',10000,'pilot','2026-10-01','verified')");
 db.exec("INSERT INTO demand_signals(project_id,kind,status,signal_date,who) VALUES (1,'need_to_have','confirmed','2026-10-01','Private buyer')");
 db.exec("INSERT INTO metric_targets(project_id,metric_key,target_value) VALUES (1,'waitlist_target',1)");
 db.exec("INSERT INTO waitlist_signups(project_id,email,audience,created_at) VALUES (1,'private@example.test','customer','2026-10-01')");
}
const count=(db:DatabaseSync,table:string)=>Number((db.prepare('SELECT COUNT(*) n FROM '+table).get() as any).n);
const app=new Hono<any>();app.route('/api/cycles/raise',cycleRaise);
async function call(env:any,id:number|null,path:string,method='GET',data?:unknown,operator?:number) {
 const headers:any={'Content-Type':'application/json'};
 if(id!==null)headers.Authorization='Bearer '+await new SignJWT({user_id:id,...(operator?{impersonated_by:operator}:{})}).setProtectedHeader({alg:'HS256'}).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(SECRET));
 const res=await app.request('/api/cycles/raise'+path,{method,headers,...(data===undefined?{}:{body:JSON.stringify(data)})},env);
 return {status:res.status,body:await res.json() as any};
}
test('a changed input set stores one PMF point, its model, checklist item 8 and safe audit; an unchanged read or Re-score writes nothing',async()=>{
 const {db,env}=fixture();medium(db);
 try{
  const first=await recomputePmf(env,1,1,'module_read',TODAY);
  assert.equal(first.state,'scored');assert.equal(first.confidence_word,'Medium');assert.equal(first.changed,true);assert.equal(first.value,59);assert.equal(first.confidence,0.57);
  assert.equal(count(db,'venture_scorecards'),1);assert.equal(count(db,'scoring_model_versions'),1);
  const item=db.prepare("SELECT id,position FROM readiness_items WHERE item_key='pmf'").get() as any;assert.equal(item.position,7);assert.equal(count(db,'readiness_items'),8);
  const check=db.prepare('SELECT score,evidence,source,scored_by FROM readiness_scores').get() as any;
  assert.equal(check.score,first.value!/10);assert.equal(check.source,'computed');assert.equal(check.evidence,'pattern');assert.equal(check.scored_by,1);
  const audit=db.prepare("SELECT action,details,user_id FROM activity_logs").get() as any;
  assert.equal(audit.action,'pmf_recomputed');assert.equal(audit.user_id,1);
  assert.deepEqual(JSON.parse(audit.details),{model_version:'1.0',trigger:'module_read',inputs_hash:first.inputs_hash});
  assert.doesNotMatch(audit.details,/Private|Synthetic pain|private@example|value|confidence/);
  const again=await recomputePmf(env,1,3,'rescore',TODAY);assert.equal(again.changed,false);assert.equal(again.id,first.id);
  assert.equal(count(db,'venture_scorecards'),1);assert.equal(count(db,'readiness_scores'),1);assert.equal(count(db,'activity_logs'),1);
  const tomorrow=await recomputePmf(env,1,1,'module_read','2026-10-26');assert.equal(tomorrow.changed,false);
  db.exec("UPDATE metric_targets SET target_value=2 WHERE project_id=1");
  const changed=await recomputePmf(env,1,3,'rescore',TODAY);assert.equal(changed.changed,true);assert.notEqual(changed.inputs_hash,first.inputs_hash);
  assert.equal((await pmfHistory(env,1)).items.length,2);assert.equal(count(db,'activity_logs'),2);
  assert.equal((db.prepare('SELECT id FROM scoring_model_versions').get() as any).id,1);
  assert.equal((db.prepare('SELECT computed_by FROM venture_scorecards ORDER BY id DESC LIMIT 1').get() as any).computed_by,3);
  const noLeak=db.prepare('SELECT inputs_json FROM venture_scorecards').get() as any;assert.doesNotMatch(noLeak.inputs_json,/Private person|Private quote|Private customer|Private buyer|private@example/);
 }finally{db.close();}
});
test('history preserves A to B to A, gaps, model and coverage, one point per stored result and a scoped cursor',async()=>{
 const {db,env}=fixture();medium(db);
 try{
  const a=await recomputePmf(env,1,1,'module_read',TODAY);
  db.exec('UPDATE metric_targets SET target_value=2');await recomputePmf(env,1,1,'rescore',TODAY);
  db.exec('UPDATE metric_targets SET target_value=1');const a2=await recomputePmf(env,1,1,'rescore',TODAY);
  assert.equal(a.inputs_hash,a2.inputs_hash);assert.notEqual(a.id,a2.id);
  db.exec("INSERT INTO scoring_model_versions(scope,version,model_json,published_at) VALUES ('technical','1.0','{}','2026-10-25')");
  db.exec("INSERT INTO venture_scorecards(uid,project_id,scope,value,band,confidence,coverage,inputs_json,inputs_hash,signature,model_version,trigger,computed_by) SELECT 'other-scope',project_id,'technical',value,band,confidence,coverage,inputs_json,inputs_hash,signature,model_version,trigger,computed_by FROM venture_scorecards WHERE id=1");
  const history=await pmfHistory(env,1);assert.equal(history.items.length,3);assert.deepEqual(history.items.map(x=>x.id),[1,2,3]);
  assert.equal(history.items[0].value,history.items[2].value);assert.equal(history.items[0].model,'1.0');assert.equal(history.items[0].confidence_word,'Medium');assert.equal(history.items[0].confidence,0.57);assert.equal(history.items[0].coverage.applies,9);
  const page=await pmfHistory(env,1,2);assert.equal(page.has_more,true);assert.deepEqual(page.items.map(x=>x.id),[2,3]);
  assert.deepEqual((await pmfHistory(env,1,2,page.next_cursor)).items.map(x=>x.id),[1]);assert.equal((await pmfHistory(env,2)).items.length,0);
  const empty=await recomputePmf(env,2,2,'module_read',TODAY);assert.equal(empty.state,'not_enough');assert.equal(empty.value,null);
  assert.equal((await pmfHistory(env,2)).items[0].value,null);
 }finally{db.close();}
});
test('PMF is out of the readiness mean below Medium, including a rounded 0.45 whose confidence word is Low; a recorded zero at Medium counts',()=>{
 const result={state:'scored',value:60,confidence:0.45,confidence_word:'Low'} as PmfResult;
 assert.equal(pmfChecklist(result).score,null);assert.match(pmfChecklist(result).missing!,/^Not scored:.*Medium confidence/);
 assert.equal(overallReadiness([{score:10},pmfChecklist(result)]),100);
 assert.equal(pmfChecklist({...result,confidence_word:'Medium'}).score,6);
 assert.equal(overallReadiness([{score:10},pmfChecklist({...result,confidence_word:'Medium'})]),80);
 assert.equal(pmfChecklist({...result,value:0,confidence_word:'Medium'}).score,0);
 assert.equal(pmfChecklist({...result,state:'not_enough',value:null,confidence_word:null}).score,null);
});
test('freshness changes the hash only at its boundary; an empty score replaces an older eligible checklist value',async()=>{
 const {db,env}=fixture();medium(db);
 try{
  const first=await recomputePmf(env,1,1,'module_read',TODAY);
  const facts=await collectPmfInputs(env,1,TODAY);const result=scorePmf(facts.inputs,PMF_MODEL_V1,TODAY);
  assert.equal(await pmfInputHash(facts,result),first.inputs_hash);
  assert.equal(await pmfInputHash({...facts,inputs:facts.inputs.map(f=>Object.fromEntries(Object.entries(f).reverse()) as any)},result),first.inputs_hash);
  assert.notEqual(await pmfInputHash({...facts,pivot_at:'2020-01-01'},result),first.inputs_hash);
  assert.equal(await pmfInputHash({...facts,verdict:{decision:'stop'} as any},result),first.inputs_hash);
  const weight=PMF_MODEL_V1.inputs[0].weight;try { PMF_MODEL_V1.inputs[0].weight=weight+1;assert.notEqual(await pmfInputHash(facts,result),first.inputs_hash); } finally { PMF_MODEL_V1.inputs[0].weight=weight; }
  const stale=await recomputePmf(env,1,1,'module_read','2028-01-01');assert.notEqual(stale.inputs_hash,first.inputs_hash);
  assert.equal(stale.confidence_word,'Low');
  const latest=(await loadReadiness({env,projectId:1,today:TODAY})).scores;
  assert.equal([...latestScores(latest).values()][0].score,null);
  assert.equal(overallReadiness(latestScores(latest).values()),null);
 }finally{db.close();}
});
test('the module and history use founder/admin venture scope; a broken PMF block leaves the module response available',async()=>{
 const {db,env}=fixture();medium(db);
 try{
  for(const id of [null,2,4,5]) assert.ok([401,403].includes((await call(env,id,'/pmf/history?project=1')).status));
  const read=await call(env,1,'/modules/fundraising-readiness?project=1');assert.equal(read.status,200);assert.equal(read.body.parts.pmf.state,'scored');assert.equal(read.body.records.rows.length,8);assert.equal(read.body.records.rows.find((r:any)=>r.id==='pmf').cells.score,5.9);assert.equal(read.body.card.series.find((x:any)=>x.kind==='hbar').items.find((x:any)=>x.label==='Product-market fit').value,5.9);
  assert.equal((await call(env,3,'/pmf/history?project=1')).body.items.length,1);
  assert.equal((await call(env,1,'/pmf/history?project=1&before=bad')).status,400);assert.equal((await call(env,1,'/pmf/history?project=1&limit=501')).status,400);
  db.exec('DROP TABLE discovery_interviews');const broken=await call(env,1,'/modules/fundraising-readiness?project=1');
  assert.equal(broken.status,200);assert.equal(broken.body.parts.pmf.state,'unreadable');assert.ok(broken.body.records);
  db.exec('DROP TABLE venture_scorecards');const historyError=await call(env,1,'/pmf/history?project=1');assert.equal(historyError.status,503);assert.equal(historyError.body.detail,'Product-market fit history could not be read');
 }finally{db.close();}
});

test('Re-score accepts pmf true for just this engine, refuses forged flags/manual PMF scores, and preserves the project gate',async()=>{
 const {db,env}=fixture();medium(db);
 try{
  for(const id of [null,2,4,5]) assert.ok([401,403].includes((await call(env,id,'/readiness/rescore?project=1','POST',{pmf:true,items:['pmf']})).status));
  assert.equal(count(db,'venture_scorecards'),0);
  const badFlag=await call(env,1,'/readiness/rescore?project=1','POST',{pmf:'true',items:['pmf']});assert.equal(badFlag.status,400);assert.equal(badFlag.body.detail,'pmf is a boolean');
  assert.equal((await call(env,1,'/readiness/rescore?project=1','POST',{items:['pmf']})).status,400);
  assert.equal((await call(env,1,'/readiness/pmf?project=1','PUT',{score:10,evidence:'measured'})).status,400);
  const scored=await call(env,3,'/readiness/rescore?project=1','POST',{pmf:true,items:['pmf'],score:10,inputs:{value:100}});assert.equal(scored.status,200);
  assert.deepEqual(scored.body.items,['pmf']);assert.equal(scored.body.scored,1);assert.equal(scored.body.pmf.trigger,'rescore');assert.equal(scored.body.pmf.value,59);
  const unchanged=await call(env,1,'/readiness/rescore?project=1','POST',{pmf:true,items:['pmf'],since:'last'});
  assert.equal(unchanged.status,200);assert.equal(unchanged.body.scored,0);assert.deepEqual(unchanged.body.items,[]);
  assert.equal(count(db,'venture_scorecards'),1);assert.equal(count(db,'readiness_scores'),1);
 }finally{db.close();}
});
test('racing identical collectors deduplicate the snapshot, checklist and audit together',async()=>{
 const {db,env}=fixture();medium(db);
 try{
  const results=await Promise.all([recomputePmf(env,1,1,'module_read',TODAY),recomputePmf(env,1,3,'rescore',TODAY)]);
  assert.equal(results.filter(r=>r.changed).length,1);assert.equal(results[0].id,results[1].id);
  for(const table of ['venture_scorecards','readiness_scores','activity_logs'])assert.equal(count(db,table),1,table);
  assert.equal(count(db,'scoring_model_versions'),1);
 }finally{db.close();}
});
test('a failed batch leaves no snapshot, model, checklist or audit, and the next request can succeed',async()=>{
 const {db,env}=fixture();medium(db);const real=env.DB;
 try{
  env.DB={...real,batch:(statements:any[])=>real.batch([...statements,real.prepare('INSERT INTO scoring_model_versions(scope,version,model_json,published_at) VALUES (?,?,?,?)').bind('fail','invalid','not JSON',TODAY)])};
  await assert.rejects(()=>recomputePmf(env,1,1,'rescore',TODAY));
  for(const table of ['scoring_model_versions','venture_scorecards','readiness_items','readiness_scores','activity_logs'])assert.equal(count(db,table),0,table);
  env.DB=real;assert.equal((await recomputePmf(env,1,1,'rescore',TODAY)).changed,true);
 }finally{db.close();}
});
test('snapshot tampering is refused, signatures never reach the browser, and a model version is immutable',async()=>{
 const {db,env}=fixture();medium(db);
 try{
  await recomputePmf(env,1,1,'module_read',TODAY);
  const row=db.prepare('SELECT signature FROM venture_scorecards').get() as any;assert.match(row.signature,/^[a-f0-9]{64}$/);
  assert.equal(JSON.stringify((await call(env,1,'/modules/fundraising-readiness?project=1')).body).includes(row.signature),false);
  db.exec('UPDATE venture_scorecards SET value=99');assert.equal((await call(env,1,'/pmf/history?project=1')).status,503);
  assert.equal((await call(env,1,'/modules/fundraising-readiness?project=1')).body.parts.pmf.state,'unreadable');
  db.exec('UPDATE venture_scorecards SET value=59');
  db.exec('DELETE FROM users WHERE id=1');assert.equal((await call(env,3,'/pmf/history?project=1')).status,200);
  db.exec("UPDATE scoring_model_versions SET model_json='{}'");db.exec('UPDATE metric_targets SET target_value=2');
  await assert.rejects(()=>recomputePmf(env,1,1,'module_read',TODAY),/pmf_model_mismatch/);
  assert.equal(count(db,'venture_scorecards'),1);assert.equal(count(db,'activity_logs'),1);
 }finally{db.close();}
});


test('automatic and explicit PMF recomputation records the signed-in operator during impersonation',async()=>{
 const {db,env}=fixture();medium(db);
 try{
  const read=await call(env,1,'/modules/fundraising-readiness?project=1','GET',undefined,3);assert.equal(read.status,200);
  assert.equal(read.body.parts.pmf.computed_by,3);
  assert.equal((db.prepare('SELECT user_id FROM activity_logs').get() as any).user_id,3);
  db.exec('UPDATE metric_targets SET target_value=2');
  const write=await call(env,1,'/readiness/rescore?project=1','POST',{pmf:true,items:['pmf']},3);assert.equal(write.status,200);
  assert.equal(write.body.pmf.computed_by,3);assert.equal(count(db,'venture_scorecards'),2);
 }finally{db.close();}
});
