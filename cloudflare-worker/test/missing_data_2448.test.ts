import test from 'node:test';
import assert from 'node:assert/strict';
import { computeScore } from '../src/services/dueDiligence.ts';

test('2448: DD has no score or band without a scored section', () => {
  for (const sections of [[], [{weight:1, verdict:null, worst_severity:null}], [{weight:1, verdict:'n_a', worst_severity:'critical'}]]) {
    const r = computeScore(sections);
    assert.equal(r.score, null); assert.equal(r.band, null); assert.ok(r.reason);
  }
});
test('2448: DD excludes unknown sections and retains measured failure and pass', () => {
  const blank={weight:20,verdict:null,worst_severity:null};
  assert.equal(computeScore([blank,{weight:1,verdict:'fail',worst_severity:null}]).score,0);
  assert.equal(computeScore([blank,{weight:1,verdict:'pass',worst_severity:null}]).score,1);
});

import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { SignJWT } from 'jose';
import { d1Over } from './_d1_sqlite.mjs';
import { BASELINE_CUTOFF, compareMigrations, migrationNumber } from '../../scripts/lib/migrationPlan.mjs';
import { runFullScore } from '../src/services/scoring.ts';
import { REQUIRED_OFFICIAL_INPUTS } from '../src/services/scoreIntegrity.ts';
import { computeAutoLayers, mergeLayers, overallFromLayers } from '../src/services/ventureRisk.ts';
import { computeReadiness, overallReadiness, loadReadiness, RECORDS_FOR, readinessCard } from '../src/services/raiseCycle.ts';
import { rescoreReadiness } from '../src/services/raiseWriters.ts';
import trust from '../src/routes/trust.ts';
import projects from '../src/routes/projects.ts';
import pipeline from '../src/routes/pipeline.ts';
const secret = 'synthetic-2448-test-only-'.repeat(3);
const ddl = (() => {
 const db=new DatabaseSync(':memory:',{enableForeignKeyConstraints:false,enableDoubleQuotedStringLiterals:true});
 db.exec(readFileSync(new URL('../sql/schema_baseline.sql',import.meta.url),'utf8'));
 for(const n of readdirSync(new URL('../sql/migrations/',import.meta.url)).filter(n=>/^\d+_.*\.sql$/.test(n)).sort(compareMigrations))
  if(migrationNumber(n)>BASELINE_CUTOFF) db.exec(readFileSync(new URL('../sql/migrations/'+n,import.meta.url),'utf8'));
 const ddl=(db.prepare("SELECT sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 ELSE 2 END").all() as any[]).map(x=>x.sql).join(';\n');db.close();return ddl;
})();
function fixture() {
 const db=new DatabaseSync(':memory:',{enableForeignKeyConstraints:false,enableDoubleQuotedStringLiterals:true});db.exec(ddl);
 db.exec("INSERT INTO users(id,name,email,role,founder_id) VALUES(1,'Synthetic admin','admin@example.test','admin',NULL),(2,'Synthetic founder','founder@example.test','founder',20); INSERT INTO projects(id,uid,name,founder_id) VALUES(1,'synthetic-2448','Synthetic venture',20)");
 return {db,env:{DB:d1Over(db),JWT_SECRET:secret,ENVIRONMENT:'development'} as any};
}
async function request(app:any,env:any,path:string,body:any) {
 const token=await new SignJWT({user_id:1}).setProtectedHeader({alg:'HS256'}).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(secret));
 return app.request(path,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify(body)},env);
}
test('2448: incomplete scores stay null; explicit zero inputs are retained',()=>{
 const all:any=Object.fromEntries(REQUIRED_OFFICIAL_INPUTS.map(k=>[k,0]));
 assert.equal(runFullScore({}).total_score,null);assert.match(runFullScore({}).reason!,/Missing scoring inputs/);
 for(const key of REQUIRED_OFFICIAL_INPUTS) {const partial={...all};delete partial[key];assert.equal(runFullScore(partial).total_score,null,key);}
 const result=runFullScore(all);assert.equal(result.breakdown!.product.mvp_time,7);assert.equal(result.breakdown!.capital.cost_mvp,7);assert.ok(result.total_score!>0);
});
test('2448: risk excludes missing layers, keeps recorded zero, and reports coverage',()=>{
 assert.equal(computeAutoLayers({snapshot:null,project:{users_count:0,revenue:0}}).product.score,0);
 const partial=computeAutoLayers({snapshot:{market_total:10},project:null});assert.equal(partial.founder.score,null);
 const auto=computeAutoLayers({snapshot:{team_total:0},project:null});
 assert.equal(auto.market.score,null);assert.equal(auto.founder.score,0);
 const layers=mergeLayers(auto,new Map([['market',{layer_key:'market',analyst_score:100}]]));
 const o=overallFromLayers(layers);assert.equal(o.score,33.3);assert.equal(o.covered_layers,3);assert.equal(o.total_layers,10);
 const none=overallFromLayers(mergeLayers(computeAutoLayers({snapshot:null,project:null}),new Map()));assert.equal(none.score,null);assert.equal(none.band,null);assert.ok(none.reason);
});
test('2448: incomplete intake refuses before creating any records',async()=>{
 const {db,env}=fixture();try {const before=db.prepare('SELECT count(*) n FROM projects').get()!.n;
 for(const inputs of [{}, {...Object.fromEntries(REQUIRED_OFFICIAL_INPUTS.map(k=>[k,0])), market_trend:'   '}]) {
 const response=await request(projects,env,'/submit',{name:'Incomplete',founder_email:'new@example.test',...inputs});
 assert.equal(response.status,400);assert.equal((await response.json() as any).code,'missing_official_inputs');
 }
 assert.equal(db.prepare('SELECT count(*) n FROM projects').get()!.n,before);assert.equal(db.prepare('SELECT count(*) n FROM founders').get()!.n,0);
 }finally{db.close();}
});
test('2448: complete intake records zero inputs and computes a real score',async()=>{
 const {db,env}=fixture();try {
 const inputs=Object.fromEntries(REQUIRED_OFFICIAL_INPUTS.map(k=>[k,0]));
 const response=await request(projects,env,'/submit',{...inputs,name:'Zero-input venture',founder_name:'Synthetic founder',founder_email:'zero@example.test',funding_needed:0});
 const body:any=await response.json();assert.equal(response.status,200,JSON.stringify(body));assert.equal(body.score.total_score,runFullScore(inputs).total_score);
 assert.equal(body.project.tam,0);assert.equal(body.project.cost_to_mvp,0);assert.equal(body.project.funding_needed,0);
 assert.equal(db.prepare('SELECT count(*) n FROM score_snapshots').get()!.n,1);
 const blank=await request(projects,env,'/submit',{...inputs,name:'Optional blanks',founder_name:'Synthetic blank founder',founder_email:'blank@example.test',sam:'   ',funding_needed:''});
 const blankBody:any=await blank.json();assert.equal(blank.status,200,JSON.stringify(blankBody));assert.equal(blankBody.project.sam,null);assert.equal(blankBody.project.funding_needed,null);
 const count=db.prepare('SELECT count(*) n FROM projects').get()!.n;
 const invalid=await request(projects,env,'/submit',{...inputs,name:'Invalid optional',sam:'invalid'});assert.equal(invalid.status,400);assert.equal(db.prepare('SELECT count(*) n FROM projects').get()!.n,count);
 }finally{db.close();}
});
test('2448: trust batch is unscored until obligations are recorded, then preserves zero and full compliance',async()=>{
 const {db,env}=fixture();try {
 let response=await request(trust,env,'/score/batch',{user_ids:[2]});assert.equal(response.status,200);
 let score=(await response.json() as any).scores[0];assert.equal(score.score,null);assert.ok(score.reason);
 db.exec("INSERT INTO legal_obligations(user_id,obligation_key,required,status) VALUES(2,'tos_v1',1,'pending')");
 score=(await (await request(trust,env,'/score/batch',{user_ids:[2]})).json() as any).scores[0];assert.equal(score.score,0);
 db.exec("UPDATE legal_obligations SET status='satisfied'");score=(await (await request(trust,env,'/score/batch',{user_ids:[2]})).json() as any).scores[0];assert.equal(score.score,100);
 }finally{db.close();}
});
test('2448: no traction snapshot produces no decision-gate recommendation',async()=>{
 const {db,env}=fixture();try {const response=await request(pipeline,env,'/decision-gate/review',{deal_id:1});assert.equal(response.status,200);
 const body:any=await response.json();assert.equal(body.traction_score,null);assert.equal(body.recommendation,null);assert.match(body.reason,/snapshot/);
 }finally{db.close();}
});
test('2448: narrative readiness without a comparison is unscored and omitted from overall',async()=>{
 const {db,env}=fixture();try {
 let n=(await computeReadiness(env,1)).find(x=>x.key==='narrative')!;assert.equal(n.score,null);assert.equal(n.evidence,null);
 db.exec("INSERT INTO spinout_deck_overrides(project_id,field_key,value,version) VALUES(1,'traction.takeaway','No figures stated',1)");
 n=(await computeReadiness(env,1)).find(x=>x.key==='narrative')!;assert.equal(n.score,null);assert.equal(n.evidence,null);assert.equal(n.missing,'Not enough recorded');
 assert.equal(overallReadiness([{score:null}]),null);assert.equal(overallReadiness([{score:null},{score:8},{score:0}]),40);
 await rescoreReadiness(env,{projectId:1,userId:1,items:['narrative']});
 const row=db.prepare('SELECT score,evidence,missing FROM readiness_scores').get()!;assert.equal(row.score,null);assert.equal(row.evidence,null);
 assert.equal((await loadReadiness({env,projectId:1} as any)).scores[0].score,null);
 const ctx:any={env,projectId:1,today:'2026-10-24'};
 const card:any=await readinessCard(ctx);assert.equal(card.series.find(s=>s.kind==='hbar').items.find(i=>i.label==='Investor narrative').tone,'grey');
 const query:any={q:'',sort:'order',filter:{},page:1};
 const records=await RECORDS_FOR['fundraising-readiness'](ctx,query);const narrative=records.rows.find(r=>r.id==='narrative')!;assert.equal(narrative.cells.score,null);assert.equal(narrative.cells.evidence,null);
 assert.equal((await RECORDS_FOR['fundraising-readiness'](ctx,{...query,filter:{state:'scored'}})).total,0);
 assert.ok((await RECORDS_FOR['fundraising-readiness'](ctx,{...query,filter:{state:'not_scored'}})).rows.some(r=>r.id==='narrative'));
 db.exec("UPDATE spinout_deck_overrides SET value='$900 MRR'; INSERT INTO project_metrics(project_id,snapshot_date,source,mrr) VALUES(1,'2026-10-24','manual',900)");
 n=(await computeReadiness(env,1)).find(x=>x.key==='narrative')!;assert.equal(n.score,10);assert.equal(n.evidence,'measured');
 db.exec('UPDATE project_metrics SET mrr=1000');n=(await computeReadiness(env,1)).find(x=>x.key==='narrative')!;assert.equal(n.score,8);
 }finally{db.close();}
});

test('2448: migration 558 preserves rows, defaults, indexes and deleted ID high-water marks',()=>{
 for(const empty of [false,true]) {
 const db=new DatabaseSync(':memory:',{enableForeignKeyConstraints:false,enableDoubleQuotedStringLiterals:true});try{
 db.exec(readFileSync(new URL('../sql/schema_baseline.sql',import.meta.url),'utf8'));
 for(const n of readdirSync(new URL('../sql/migrations/',import.meta.url)).filter(n=>/^\d+_.*\.sql$/.test(n)).sort(compareMigrations))
  if(migrationNumber(n)>BASELINE_CUTOFF && !n.startsWith('558_')) db.exec(readFileSync(new URL('../sql/migrations/'+n,import.meta.url),'utf8'));
 db.exec("INSERT INTO users(id,name,email,role) VALUES(1,'Synthetic','migration@example.test','admin'); INSERT INTO projects(id,name) VALUES(1,'Synthetic'); INSERT INTO readiness_items(id,project_id,item_key,label) VALUES(1,1,'narrative','Narrative'); INSERT INTO readiness_scores(id,item_id,project_id,score,evidence,source,scored_by,scored_at,missing) VALUES(41,1,1,0,'stated','computed',1,'2026-09-02','Synthetic reason'),(900,1,1,10,'measured','manual',1,'2026-09-03',NULL); DELETE FROM readiness_scores WHERE id=900;");
 if(empty) db.exec('DELETE FROM readiness_scores');
 const before=db.prepare('SELECT * FROM readiness_scores').all();
 const columns=db.prepare('PRAGMA table_info(readiness_scores)').all() as any[];
 const indexes=db.prepare("SELECT name,sql FROM sqlite_master WHERE tbl_name='readiness_scores' AND type='index' ORDER BY name").all();
 db.exec(readFileSync(new URL('../sql/migrations/558_readiness_scores_nullable_score.sql',import.meta.url),'utf8'));
 assert.deepEqual(db.prepare('SELECT * FROM readiness_scores').all(),before);
 assert.deepEqual(db.prepare('PRAGMA table_info(readiness_scores)').all().map(c=>({...c})),columns.map(c=>({...c,notnull:['score','evidence'].includes(c.name)?0:c.notnull})));
 assert.deepEqual(db.prepare("SELECT name,sql FROM sqlite_master WHERE tbl_name='readiness_scores' AND type='index' ORDER BY name").all(),indexes);
 db.exec("INSERT INTO readiness_scores(item_id,project_id,score,evidence,missing) VALUES(1,1,NULL,NULL,'Not enough recorded')");
 const added=db.prepare('SELECT * FROM readiness_scores ORDER BY id DESC LIMIT 1').get()!;assert.equal(added.id,901);assert.equal(added.score,null);assert.equal(added.evidence,null);assert.equal(added.source,'manual');assert.ok(added.scored_at);
 assert.deepEqual(db.prepare('PRAGMA foreign_key_check(readiness_scores)').all(),[]);
 for(const bad of ["11,'stated'","0,'invented'","0,NULL","NULL,'pattern'"]) assert.throws(()=>db.exec(`INSERT INTO readiness_scores(item_id,project_id,score,evidence) VALUES(1,1,${bad})`),/CHECK/);
 }finally{db.close();}
 }
});
