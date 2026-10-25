/**
 * D1067 (#2937, part 4 of #2426): the Verdict trigger, pause and resume, and
 * "new evidence since the plan". Real SQLite on D1065's tables, the real
 * rules and HTTP gates; every fixture is synthetic.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/build_plan_state_d1067.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import planRoute from '../src/routes/build_plan.ts';
import stateRoute from '../src/routes/build_plan_state.ts';
import cycleVerdict from '../src/routes/cycle_verdict.ts';
import { preparePlan, readPlan } from '../src/services/buildPlanner.ts';
import { evidenceSince, onDecision, pausePlan, resumePlan } from '../src/services/buildPlanState.ts';
import { evidenceFor } from '../src/services/validateEvidence.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { tableFromBaseline } from './_baseline.mjs';

const base = readFileSync('cloudflare-worker/sql/schema_baseline.sql', 'utf8');
const sql = (f: string) => readFileSync('cloudflare-worker/sql/migrations/' + f, 'utf8');
const SECRET = 'build-plan-state-test-secret-0123456789-abcdef';

/** D1065's fixture, with two signal links so five pieces of evidence can give a verdict. No decision is seeded. */
function fixture() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
  for (const t of ['users', 'projects', 'activity_logs', 'discovery_interviews', 'interview_pain_severities', 'pain_groups', 'pain_group_aliases', 'hypotheses', 'hypothesis_pain_links', 'validation_decisions', 'mvp_features', 'roadmap_okrs', 'cap_table_holders', 'competitor_analyses', 'competitor_candidates', 'competitor_signals', 'ai_usage_logs', 'project_members', 'user_company_links']) db.exec(tableFromBaseline(base, t));
  db.exec('ALTER TABLE projects ADD COLUMN icp_definition_meta TEXT');
  for (const f of ['214_validate_proposals.sql', '374_entity_obligations.sql', '440_validate_cycle_stores.sql', '460_validate_record_stores.sql', '464_verdict_decisions.sql', '441_build_cycle_stores.sql', '489_interview_findings.sql', '506_ai_rail_proposals.sql', '581_build_plans.sql']) db.exec(sql(f));
  db.exec(`INSERT INTO users(id,email,name,role,founder_id,spinout_lab_active) VALUES
    (1,'one@example.test','Founder','founder',100,0),(3,'admin@example.test','Admin','admin',NULL,0),(4,'partner@example.test','Partner','partner',NULL,0);
    INSERT INTO projects(id,name,founder_id,company_id) VALUES(1,'One',100,10);
    INSERT INTO user_company_links(uid,company_id,user_id) VALUES('partner-one',10,4);
    INSERT INTO pain_groups(id,project_id,title) VALUES(1,1,'Slow setup');
    INSERT INTO pain_group_aliases(project_id,group_id,phrase_norm,display_phrase) VALUES(1,1,'slow setup','Slow setup');
    INSERT INTO hypotheses(id,project_id,code,claim) VALUES(1,1,'H1','Setup in one day'),(2,1,'H2','Self service works');
    INSERT INTO hypothesis_pain_links(id,hypothesis_id,pain_group_id,direction) VALUES(1,1,1,'supports');
    INSERT INTO demand_signals(id,project_id,kind,status,signal_date) VALUES(1,1,'loi','confirmed','2026-10-01'),(2,1,'would_pay','confirmed','2026-10-01');
    INSERT INTO hypothesis_evidence_links(id,uid,project_id,hypothesis_id,kind,ref_id,direction) VALUES(1,'e1',1,1,'signal','signal-1','supports'),(2,'e2',1,1,'signal','signal-2','supports');`);
  for (let id = 1; id <= 3; id++) {
    db.prepare('INSERT INTO discovery_interviews(id,project_id,interviewee_name,pains_json) VALUES(?,1,?,?)').run(id, 'Synthetic', '["Slow setup"]');
    db.prepare("INSERT INTO interview_pain_severities(interview_id,phrase_norm,severity) VALUES(?,'slow setup','severe')").run(id);
  }
  return { db, env: { DB: d1Over(db), JWT_SECRET: SECRET, ENVIRONMENT: 'development' } as any };
}
const given = (db: DatabaseSync, id: number, decision: string, extra = '') => {
  db.exec(`UPDATE validation_decisions SET superseded_at = CURRENT_TIMESTAMP WHERE superseded_at IS NULL AND hypothesis_id IS NULL AND id <> ${id};
    INSERT INTO validation_decisions(id,project_id,decision,state${extra ? ',' + extra.split('=')[0] : ''}) VALUES(${id},1,'${decision}','given'${extra ? ',' + extra.split('=')[1] : ''})`);
};
const plans = (db: DatabaseSync) => db.prepare('SELECT uid, scope, status, trigger, decision_id FROM build_plans ORDER BY id').all().map((r: any) => ({ ...r }));
const items = (out: any) => Object.values(out.modules).flat() as any[];

test('1. a withheld decision prepares nothing; a given Proceed prepares a plan by rule, as the decision trigger', async () => {
  // Mutation checked: withheld not skipped → a plan exists; the trigger word lost → 'manual'.
  const { db, env } = fixture();
  try {
    db.exec("INSERT INTO validation_decisions(id,project_id,decision,state) VALUES(1,1,'proceed','withheld')");
    assert.equal(await onDecision(env, 1, 1, { kind: 'proceed', state: 'withheld', for: 'venture' }), 'withheld');
    assert.deepEqual(plans(db), [], 'a withheld decision prepared a plan');
    // "Plan anyway" is D1065's own POST, and it still works on a withheld verdict.
    const anyway = await preparePlan(env, 1, 1);
    assert.equal(anyway.plan?.trigger, 'manual');
    db.exec('DELETE FROM build_plan_items; DELETE FROM ai_rail_proposals; DELETE FROM build_plans');
    given(db, 2, 'proceed');
    assert.equal(await onDecision(env, 1, 1, { kind: 'proceed', state: 'given', for: 'venture' }), 'prepared');
    assert.deepEqual(plans(db).map((p) => [p.scope, p.status, p.trigger, p.decision_id]), [['venture', 'draft', 'decision', 2]]);
    assert.ok(db.prepare("SELECT COUNT(*) n FROM ai_rail_proposals WHERE model IS NULL AND usage_log_id IS NULL").get()!.n > 0, 'the trigger ran a model');
  } finally { db.close(); }
});

test('2. a Proceed on one hypothesis plans that claim; a Pivot plans a prototype test of the new claim, not must-haves', async () => {
  const { db, env } = fixture();
  try {
    db.exec("INSERT INTO validation_decisions(id,project_id,decision,state,hypothesis_id) VALUES(1,1,'proceed','given',1)");
    await onDecision(env, 1, 1, { kind: 'proceed', state: 'given', for: 1 });
    const one = await readPlan(env, 1, 'h-1');
    assert.equal(one.plan?.scope, 'h-1');
    assert.ok(items(one).length > 0);
    assert.doesNotMatch(JSON.stringify(one), /Self service works/, 'a claim outside the decision was planned');
    db.exec("INSERT INTO validation_decisions(id,project_id,decision,state,hypothesis_id,pivot_hypothesis_id) VALUES(2,1,'pivot','given',2,2)");
    await onDecision(env, 1, 1, { kind: 'pivot', state: 'given', for: 2 });
    const pivot = await readPlan(env, 1, 'h-2');
    assert.equal(pivot.modules['prototype-mvp'].filter((i: any) => i.kind === 'prototype-test').length, 1);
    assert.equal(pivot.modules['prototype-mvp'].filter((i: any) => i.kind === 'must-have').length, 0);
  } finally { db.close(); }
});

test('3. a given Stop pauses the open plan and keeps accepted items; a hypothesis Stop pauses only its scope', async () => {
  // Mutation checked: Stop prepares instead of pausing → status stays draft; the scope clause dropped → the venture plan pauses on a hypothesis Stop.
  const { db, env } = fixture();
  try {
    given(db, 1, 'proceed');
    await onDecision(env, 1, 1, { kind: 'proceed', state: 'given', for: 'venture' });
    db.exec("INSERT INTO validation_decisions(id,project_id,decision,state,hypothesis_id) VALUES(2,1,'proceed','given',1)");
    await onDecision(env, 1, 1, { kind: 'proceed', state: 'given', for: 1 });
    const accepted: any = db.prepare("SELECT proposal_uid FROM build_plan_items i JOIN build_plans p ON p.id = i.plan_id WHERE p.scope = 'venture' LIMIT 1").get();
    db.prepare("UPDATE ai_rail_proposals SET status='accepted' WHERE uid=?").run(accepted.proposal_uid);
    db.exec("INSERT INTO validation_decisions(id,project_id,decision,state,hypothesis_id,supersedes_id) VALUES(3,1,'stop','given',1,2)");
    db.exec('UPDATE validation_decisions SET superseded_at = CURRENT_TIMESTAMP WHERE id = 2');
    assert.equal(await onDecision(env, 1, 1, { kind: 'stop', state: 'given', for: 1 }), 'paused');
    assert.deepEqual(plans(db).map((p) => [p.scope, p.status]), [['venture', 'draft'], ['h-1', 'paused']]);
    given(db, 4, 'stop');
    await onDecision(env, 1, 1, { kind: 'stop', state: 'given', for: 'venture' });
    assert.deepEqual(plans(db).map((p) => [p.scope, p.status]), [['venture', 'paused'], ['h-1', 'paused']]);
    assert.equal(db.prepare('SELECT status FROM ai_rail_proposals WHERE uid=?').get(accepted.proposal_uid)!.status, 'accepted', 'an accepted item was undone by the Stop');
    // A paused plan prepares nothing by hand.
    await assert.rejects(() => preparePlan(env, 1, 1), (e: any) => e.code === 'plan_paused');
  } finally { db.close(); }
});

test('4. a newer given decision supersedes the plan, paused or not: undecided proposals withdraw, decided items stay', async () => {
  // Mutation checked: 'paused' left out of the supersede → the paused plan stays current and the new decision prepares nothing.
  const { db, env } = fixture();
  try {
    given(db, 1, 'proceed');
    await onDecision(env, 1, 1, { kind: 'proceed', state: 'given', for: 'venture' });
    const first = plans(db)[0];
    const rows: any[] = db.prepare('SELECT proposal_uid FROM build_plan_items ORDER BY item_key').all();
    db.prepare("UPDATE ai_rail_proposals SET status='accepted' WHERE uid=?").run(rows[0].proposal_uid);
    given(db, 2, 'stop');
    await onDecision(env, 1, 1, { kind: 'stop', state: 'given', for: 'venture' });
    assert.equal(plans(db)[0].status, 'paused');
    given(db, 3, 'proceed');
    assert.equal(await onDecision(env, 1, 1, { kind: 'proceed', state: 'given', for: 'venture' }), 'prepared');
    const all = plans(db);
    assert.deepEqual(all.map((p) => [p.uid === first.uid, p.status, p.decision_id]), [[true, 'superseded', 1], [false, 'draft', 3]]);
    assert.equal(db.prepare('SELECT status FROM ai_rail_proposals WHERE uid=?').get(rows[0].proposal_uid)!.status, 'accepted');
    assert.ok(rows.slice(1).every((r) => db.prepare('SELECT status FROM ai_rail_proposals WHERE uid=?').get(r.proposal_uid)!.status === 'withdrawn'), 'an undecided proposal of the old plan stayed proposed');
    // The same decision again changes nothing: no second plan.
    await onDecision(env, 1, 1, { kind: 'proceed', state: 'given', for: 'venture' });
    assert.equal(plans(db).length, 2);
  } finally { db.close(); }
});

test('5. resume reopens a plan the founder paused, never one a Stop paused', async () => {
  // Mutation checked: the Stop check removed → resume succeeds under a Stop; the decided check inverted → open/draft swap.
  const { db, env } = fixture();
  try {
    given(db, 1, 'proceed');
    await onDecision(env, 1, 1, { kind: 'proceed', state: 'given', for: 'venture' });
    assert.deepEqual(await pausePlan(env, 1, 'venture'), { status: 'paused' });
    assert.deepEqual(await pausePlan(env, 1, 'venture'), { status: 'paused' }, 'pausing twice is not an error');
    assert.deepEqual(await resumePlan(env, 1, 'venture'), { status: 'draft' }, 'nothing decided yet: back to draft');
    const one: any = db.prepare('SELECT proposal_uid FROM build_plan_items LIMIT 1').get();
    db.prepare("UPDATE ai_rail_proposals SET status='accepted' WHERE uid=?").run(one.proposal_uid);
    await pausePlan(env, 1, 'venture');
    assert.deepEqual(await resumePlan(env, 1, 'venture'), { status: 'open' });
    given(db, 2, 'stop');
    await onDecision(env, 1, 1, { kind: 'stop', state: 'given', for: 'venture' });
    await assert.rejects(() => resumePlan(env, 1, 'venture'), (e: any) => e.code === 'plan_stopped');
    assert.equal(plans(db)[0].status, 'paused');
    await assert.rejects(() => pausePlan(env, 1, 'h-2'), (e: any) => e.code === 'no_evidence', 'pausing a plan that does not exist');
  } finally { db.close(); }
});

test('6. new evidence since the plan: its hash against today, the new pieces and how many contradict', async () => {
  // Mutation checked: the seen list dropped → counts null; contradicting counted on every piece → 2; the hash compared to itself → changed false.
  const { db, env } = fixture();
  try {
    given(db, 1, 'proceed');
    await onDecision(env, 1, 1, { kind: 'proceed', state: 'given', for: 'venture' });
    const plan = plans(db)[0];
    assert.deepEqual(await evidenceSince(env, 1, 'venture'), { plan: plan.uid, status: 'draft', changed: false, new: 0, contradicting: 0 });
    db.exec(`INSERT INTO demand_signals(id,project_id,kind,status,signal_date) VALUES(3,1,'loi','confirmed','2026-10-02'),(4,1,'loi','confirmed','2026-10-02');
      INSERT INTO hypothesis_evidence_links(id,uid,project_id,hypothesis_id,kind,ref_id,direction) VALUES(3,'e3',1,1,'signal','signal-3','supports'),(4,'e4',1,2,'signal','signal-4','contradicts');`);
    assert.deepEqual(await evidenceSince(env, 1, 'venture'), { plan: plan.uid, status: 'draft', changed: true, new: 2, contradicting: 1 });
    // "Update the plan" never changes an accepted item by itself.
    const accepted: any = db.prepare('SELECT proposal_uid FROM build_plan_items LIMIT 1').get();
    db.prepare("UPDATE ai_rail_proposals SET status='accepted', decided_payload_json='{\"title\":\"Kept as accepted\"}' WHERE uid=?").run(accepted.proposal_uid);
    const before: any = db.prepare('SELECT payload_json, decided_payload_json, status FROM ai_rail_proposals WHERE uid=?').get(accepted.proposal_uid);
    await preparePlan(env, 1, 1, 'venture', 'update');
    assert.deepEqual({ ...db.prepare('SELECT payload_json, decided_payload_json, status FROM ai_rail_proposals WHERE uid=?').get(accepted.proposal_uid) }, { ...before });
    assert.deepEqual(await evidenceSince(env, 1, 'venture'), { plan: plan.uid, status: 'draft', changed: false, new: 0, contradicting: 0 }, 'updating did not take in the new evidence');
    // The list the plan keeps is never served.
    assert.doesNotMatch(JSON.stringify(await readPlan(env, 1)), /_seen|signal-3|evidence-3/);
    // A plan from before D1067 has no list: counts are not recorded, never 0.
    db.exec(`UPDATE build_plans SET brief_json = json_remove(brief_json, '$._seen')`);
    db.exec("INSERT INTO hypothesis_evidence_links(id,uid,project_id,hypothesis_id,kind,ref_id,direction) VALUES(5,'e5',1,1,'interview','1','supports')");
    const legacy = await evidenceSince(env, 1, 'venture');
    assert.deepEqual([legacy.new, legacy.contradicting], [null, null]);
    assert.equal(legacy.changed, true);
    assert.deepEqual(await evidenceSince(env, 1, 'h-2'), { plan: null, status: null, changed: null, new: null, contradicting: null });
  } finally { db.close(); }
});

// ----------------------------------------------------------------- HTTP

const app = new Hono<any>();
app.route('/api/cycles/build/plan', stateRoute);
app.route('/api/cycles/build/plan', planRoute);
app.route('/api/cycles/validate/decisions', cycleVerdict);
async function call(env: any, user: number, method: string, path: string, body?: unknown) {
  const token = await new SignJWT({ user_id: user }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(SECRET));
  const saved = [console.warn, console.error]; console.warn = () => {}; console.error = () => {};
  try {
    const r = await app.request(path, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, ...(body !== undefined ? { body: JSON.stringify(body) } : method === 'POST' ? { body: '{}' } : {}) }, env);
    return { status: r.status, body: await r.json().catch(() => null) as any };
  } finally { [console.warn, console.error] = saved; }
}
const FIVE = async (env: any) => (await evidenceFor({ env, projectId: 1 })).map((e) => e.id).slice(0, 5);

test('7. HTTP: the founder\'s given Proceed prepares a plan; an admin\'s does not; a withheld one does not; a plan failure never fails the decision', async () => {
  // Mutation checked: the trigger removed → no plan after the founder's Proceed; the owner check dropped → the admin's Proceed prepares one.
  const { db, env } = fixture();
  try {
    const keys = await FIVE(env);
    assert.equal(keys.length, 5, 'the fixture holds five pieces of evidence');
    const withheld = await call(env, 1, 'POST', '/api/cycles/validate/decisions?project=1', { decision: 'proceed', for: 'venture', evidence: keys.slice(0, 2) });
    assert.deepEqual([withheld.status, withheld.body.state], [201, 'withheld']);
    assert.deepEqual(plans(db), []);
    const admin = await call(env, 3, 'POST', '/api/cycles/validate/decisions?project=1', { decision: 'proceed', for: 'venture', evidence: keys });
    assert.deepEqual([admin.status, admin.body.state], [201, 'given']);
    assert.deepEqual(plans(db), [], 'an admin\'s decision prepared a plan for the founder');
    const mine = await call(env, 1, 'POST', '/api/cycles/validate/decisions?project=1', { decision: 'proceed', for: 'venture', evidence: keys });
    assert.equal(mine.status, 201);
    assert.deepEqual(plans(db).map((p) => [p.trigger, p.decision_id]), [['decision', mine.body.id]]);
    // An admin's Stop still pauses.
    const stop = await call(env, 3, 'POST', '/api/cycles/validate/decisions?project=1', { decision: 'stop', for: 'venture', evidence: keys });
    assert.equal(stop.status, 201);
    assert.equal(plans(db)[0].status, 'paused');
    // The plan store failing costs the plan, never the decision.
    db.exec('DROP TABLE build_plan_items');
    const still = await call(env, 1, 'POST', '/api/cycles/validate/decisions?project=1', { decision: 'proceed', for: 'venture', evidence: keys });
    assert.deepEqual([still.status, still.body.state], [201, 'given']);
  } finally { db.close(); }
});

test('8. HTTP: pause and resume are the founder\'s; an admin reads since, a partner reads none of it', async () => {
  // Mutation checked: the partner refusal removed → the partner reads since.
  const { db, env } = fixture();
  try {
    given(db, 1, 'proceed');
    await onDecision(env, 1, 1, { kind: 'proceed', state: 'given', for: 'venture' });
    const q = '?project=1&scope=venture';
    assert.equal((await call(env, 3, 'POST', `/api/cycles/build/plan/pause${q}`)).status, 404, 'an admin paused the founder\'s plan');
    assert.equal((await call(env, 4, 'POST', `/api/cycles/build/plan/pause${q}`)).status, 404);
    assert.deepEqual((await call(env, 1, 'POST', `/api/cycles/build/plan/pause${q}`)).body, { status: 'paused' });
    assert.equal((await call(env, 1, 'POST', `/api/cycles/build/plan${q}`)).body.code, 'plan_paused');
    assert.deepEqual((await call(env, 1, 'POST', `/api/cycles/build/plan/resume${q}`)).body, { status: 'draft' });
    assert.equal((await call(env, 3, 'GET', `/api/cycles/build/plan/since${q}`)).body.changed, false);
    assert.equal((await call(env, 4, 'GET', `/api/cycles/build/plan/since${q}`)).status, 404, 'a partner read the private plan\'s evidence');
    given(db, 2, 'stop');
    await onDecision(env, 1, 1, { kind: 'stop', state: 'given', for: 'venture' });
    const refused = await call(env, 1, 'POST', `/api/cycles/build/plan/resume${q}`);
    assert.deepEqual([refused.status, refused.body.code, refused.body.detail], [409, 'plan_stopped', 'Your verdict is Stop. Record a new decision to resume.']);
    // The GET of the plan itself still answers through D1065's router.
    assert.equal((await call(env, 1, 'GET', `/api/cycles/build/plan${q}`)).body.plan.status, 'paused');
    db.exec('DROP TABLE hypothesis_evidence_links');
    assert.equal((await call(env, 1, 'GET', `/api/cycles/build/plan/since${q}`)).status, 503, 'a failed read is drawn as no new evidence');
  } finally { db.close(); }
});
