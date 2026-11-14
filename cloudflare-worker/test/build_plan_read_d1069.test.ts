/**
 * D1069 (#2939) — what the plan page needs from D1065's read: the scope's
 * verdict (VB1's strip, VB14's Withheld and Stop), when the plan was
 * prepared, and when each item was decided. A partner gets none of them.
 * Real SQLite; every fixture is synthetic.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/build_plan_read_d1069.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { readPlan } from '../src/services/buildPlanner.ts';
import { planVerdict } from '../src/services/verdict.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { tableFromBaseline } from './_baseline.mjs';

const base = readFileSync('cloudflare-worker/sql/schema_baseline.sql', 'utf8');
const sql = (f: string) => readFileSync('cloudflare-worker/sql/migrations/' + f, 'utf8');

function fixture() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
  for (const t of ['users', 'projects', 'activity_logs', 'discovery_interviews', 'interview_pain_severities', 'pain_groups', 'pain_group_aliases', 'hypotheses', 'hypothesis_pain_links', 'validation_decisions', 'mvp_features', 'roadmap_okrs', 'cap_table_holders', 'competitor_analyses', 'competitor_candidates', 'competitor_signals', 'ai_usage_logs', 'project_members', 'user_company_links']) db.exec(tableFromBaseline(base, t));
  db.exec('ALTER TABLE projects ADD COLUMN icp_definition_meta TEXT');
  for (const f of ['214_validate_proposals.sql', '374_entity_obligations.sql', '440_validate_cycle_stores.sql', '460_validate_record_stores.sql', '464_verdict_decisions.sql', '441_build_cycle_stores.sql', '489_interview_findings.sql', '506_ai_rail_proposals.sql', '581_build_plans.sql']) db.exec(sql(f));
  db.exec(`INSERT INTO users(id,email,name,role,founder_id,spinout_lab_active) VALUES (1,'one@example.test','Invented Founder','founder',100,0);
    INSERT INTO projects(id,name,founder_id,company_id) VALUES(1,'One',100,10);
    INSERT INTO hypotheses(id,project_id,code,claim) VALUES(1,1,'H1','Setup in one day'),(2,1,'H2','Self service works');
    INSERT INTO validation_decisions(id,project_id,decision,state,decided_at,superseded_at) VALUES(1,1,'pivot','given','2026-09-03 09:00:00','2026-10-12 09:00:00');
    INSERT INTO validation_decisions(id,project_id,decision,state,decided_at) VALUES(2,1,'proceed','given','2026-10-12 09:00:00');
    INSERT INTO validation_decisions(id,project_id,hypothesis_id,decision,state,decided_at) VALUES(3,1,2,'proceed','withheld','2026-10-13 09:00:00');`);
  for (let i = 1; i <= 3; i++) db.prepare("INSERT INTO validation_decision_evidence(uid,decision_id,kind,ref_id,label,direction) VALUES(?,2,'interview',?,'An invented label','supports')").run(`e${i}`, `pain-1-${i}`);
  db.exec(`INSERT INTO validation_decision_evidence(uid,decision_id,kind,ref_id,label,direction) VALUES('w1',3,'interview','pain-1-9','An invented label','supports');`);
  return { db, env: { DB: d1Over(db) } as any };
}

test('the scope\'s newest unsuperseded decision, with its day and evidence count, never its reasoning', async () => {
  const { env } = fixture();
  assert.deepEqual(await planVerdict(env, 1, 'venture'), { id: 2, decision: 'proceed', state: 'given', decided_at: '2026-10-12 09:00:00', evidence_count: 3, bar: 5 },
    'the superseded Pivot is not the verdict');
  assert.deepEqual(await planVerdict(env, 1, 2), { id: 3, decision: 'proceed', state: 'withheld', decided_at: '2026-10-13 09:00:00', evidence_count: 1, bar: 5 },
    'a withheld decision is the verdict too: VB14 says so');
  assert.equal(await planVerdict(env, 1, 1), null, 'no decision is null, never a guessed Proceed');
});

test('the plan read carries the verdict and when the plan was prepared; a partner reads neither', async () => {
  const { db, env } = fixture();
  const none = await readPlan(env, 1, 'h-2');
  assert.equal(none.plan, null);
  assert.equal(none.verdict?.state, 'withheld', 'no plan still answers the verdict, so VB14a can say why');
  // A plan with one item, decided.
  db.exec(`INSERT INTO ai_rail_proposals(uid,user_id,rail_page,rail_option,record_ref,kind,payload_json,status,updated_at) VALUES
      ('p1',1,'Founder.Build.Plan','draft:build/plan','project:1','proposal','{"title":"Prove it"}','accepted','2026-10-12 14:30:00'),
      ('p2',1,'Founder.Build.Plan','draft:build/plan','project:1','proposal','{"title":"Test it"}','proposed','2026-10-12 14:05:00');
    INSERT INTO build_plans(id,uid,project_id,scope,trigger,decision_id,status,evidence_hash,created_by,created_at,updated_at) VALUES(1,'plan-1',1,'venture','decision',2,'open','h',1,'2026-10-12 14:05:00','2026-10-12 14:05:00');
    INSERT INTO build_plan_items(uid,plan_id,project_id,module,kind,item_key,proposal_uid,evidence_json,marker,landed_table,landed_id) VALUES
      ('i1',1,1,'prototype-mvp','must-have','prototype-mvp:must-have:h-1','p1','[]','VB-1','mvp_features','5'),
      ('i2',1,1,'prototype-mvp','prototype-test','prototype-mvp:prototype-test:h-2','p2','[]','VB-2',NULL,NULL);`);
  const r = await readPlan(env, 1, 'venture');
  assert.equal(r.plan?.prepared_at, '2026-10-12 14:05:00');
  assert.equal(r.verdict?.decision, 'proceed');
  assert.deepEqual(r.modules['prototype-mvp'].map((i: any) => [i.uid, i.decided_at]), [['i1', '2026-10-12 14:30:00'], ['i2', null]],
    'a decided item says when; a pending one has no decided time');
  const partner = await readPlan(env, 1, 'venture', true);
  assert.ok(!('verdict' in partner), 'a partner never reads a decision (D693 decision 7)');
  assert.equal(partner.plan, null);
  assert.ok(partner.modules['prototype-mvp'].every((i: any) => !('decided_at' in i)));
});
