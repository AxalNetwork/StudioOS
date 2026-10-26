/**
 * D1145 (#3031, RD16 B) — one Validate store that cannot be read costs only
 * the inputs it feeds. The part is drawn without them, at a lower confidence
 * and coverage, says each one "Could not be read", proposes no step for it,
 * and is never stored: no history point, no checklist item 8 score, no audit.
 * Below the floor a partial read is Unreadable, never "Not enough recorded".
 *
 * The fixture is D1144's (`pmf_store_d1144.test.ts`), copied: synthetic people only.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/pmf_partial_d1145.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import { tableFromBaseline } from './_baseline.mjs';
import { d1Over } from './_d1_sqlite.mjs';
import { recomputePmf } from '../src/services/scoring/pmfStore.ts';
import cycleRaise from '../src/routes/cycle_raise.ts';
import { PMF_MODEL_V1, computePmf, scorePmf, type PmfInputFacts } from '../src/services/scoring/pmf.ts';
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
const quiet = async <T>(f: () => Promise<T>) => { const w = console.warn; console.warn = () => {}; try { return await f(); } finally { console.warn = w; } };

test('1. the engine: an unreadable input is out of the value, lowers confidence and coverage, and gets no step', async () => {
  // Mutation checked: unreadable kept in the value → the value moves; its grade kept → confidence equal; a step for it → the step is listed.
  const { db, env } = fixture(); medium(db);
  try {
    const facts = (await collectPmfInputs(env, 1, TODAY)).inputs;
    const full = scorePmf(facts, PMF_MODEL_V1, TODAY);
    const down = facts.map((f): PmfInputFacts => (f.key === 'paying_demand' ? { ...f, unreadable: true } : f));
    const part = scorePmf(down, PMF_MODEL_V1, TODAY);
    const notRecorded = computePmf(facts.map((f) => (f.key === 'paying_demand' ? { ...f, recorded: false } : f)), PMF_MODEL_V1, TODAY);
    const row = part.inputs.find((i) => i.key === 'paying_demand')!;
    assert.equal(row.state, 'unreadable');
    assert.equal(row.value, null);
    assert.equal(row.contribution, null);
    assert.equal(row.grade, 'not_recorded');
    assert.equal(part.value, notRecorded.value, 'the value is the one without it');
    assert.ok(part.confidence < full.confidence, `confidence drops: ${part.confidence} < ${full.confidence}`);
    assert.equal(part.coverage.present, full.coverage.present - 1);
    assert.equal(part.coverage.applies, full.coverage.applies, 'it still applies');
    assert.ok(!part.steps.some((s) => s.input === 'paying_demand'), 'no step for an input that was not read');
    // An input that does not apply stays Not expected yet, read or not.
    const pull = scorePmf(facts.map((f) => (f.key === 'product_pull' ? { ...f, unreadable: true } : f)), PMF_MODEL_V1, TODAY);
    assert.equal(pull.inputs.find((i) => i.key === 'product_pull')!.state, 'not_expected');
  } finally { db.close(); }
});

test('2. one store down: the module draws the partial score, says which input could not be read, and stores nothing', async () => {
  // Mutation checked: a partial read stored → a second scorecard row; the guard removed → the part is Unreadable.
  const { db, env } = fixture(); medium(db);
  try {
    const first = await recomputePmf(env, 1, 1, 'module_read', TODAY);
    assert.equal(first.state, 'scored');
    const rows = [count(db, 'venture_scorecards'), count(db, 'readiness_scores'), count(db, 'activity_logs')];
    db.exec('DROP TABLE waitlist_signups');
    const r = await quiet(() => call(env, 1, '/modules/fundraising-readiness?project=1'));
    assert.equal(r.status, 200);
    const pmf = r.body.parts.pmf;
    assert.equal(pmf.state, 'scored');
    assert.equal(pmf.partial, true);
    assert.equal(pmf.changed, false);
    assert.equal(pmf.inputs_hash, null);
    assert.equal(pmf.id, (first as any).id, 'it names the last stored point, not a new one');
    const wl = pmf.inputs.find((i: any) => i.key === 'waitlist');
    assert.equal(wl.state, 'unreadable');
    assert.equal(wl.reason, 'Could not be read');
    assert.ok(pmf.confidence < (first as any).confidence);
    assert.ok(pmf.inputs.filter((i: any) => i.state === 'unreadable').length === 1, 'only the input that store feeds');
    assert.deepEqual([count(db, 'venture_scorecards'), count(db, 'readiness_scores'), count(db, 'activity_logs')], rows, 'nothing stored');
    assert.equal(r.body.records.rows.find((x: any) => x.id === 'pmf').cells.score, (first as any).value / 10, 'checklist item 8 keeps the last complete read');
  } finally { db.close(); }
});

test('3. below the floor a partial read is Unreadable, never Not enough recorded; the interviews feed six inputs', async () => {
  // Mutation checked: the floor rule removed → state not_enough; the interview guard dropped for would pay → would pay reads.
  const { db, env } = fixture(); medium(db);
  try {
    db.exec('DROP TABLE discovery_interviews');
    const collected = await quiet(() => collectPmfInputs(env, 1, TODAY));
    const down = collected.inputs.filter((f) => f.unreadable).map((f) => f.key).sort();
    assert.deepEqual(down, ['claims_supported', 'icp_coverage', 'icp_interviews', 'pain_frequency', 'pain_severity', 'would_pay']);
    const r = await quiet(() => recomputePmf(env, 1, 1, 'module_read', TODAY));
    assert.equal(r.state, 'unreadable');
    assert.equal(count(db, 'venture_scorecards'), 0);
  } finally { db.close(); }
});
