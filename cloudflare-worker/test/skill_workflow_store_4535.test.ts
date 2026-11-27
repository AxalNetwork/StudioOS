/**
 * #4535 (slice 2): the workflow store on SQLite with the real migration — a
 * draft saved and published as an immutable version, a run admitted from the
 * plan `planRun` froze, idempotently by its run key, scope-bound reads, and a
 * cancel. Admission creates no task and runs nothing. Every uid is made up.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/skill_workflow_store_4535.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import {
  STARTUP_ASSESSMENT_SKILLS, planRun, startupAssessment,
  type AgentFact, type SkillFact, type StartupNode, type ValidationContext, type WorkflowDefinition,
} from '../src/services/agents/skillWorkflow.ts';
import {
  admitRun, publishDraft, readRun, readVersion, readWorkflow, requestCancel, saveDraft, type RunScope,
} from '../src/services/agents/skillWorkflowStore.ts';
import { d1Over } from './_d1_sqlite.mjs';

const MIGRATION = readdirSync(new URL('../sql/migrations/', import.meta.url)).find((f) => f.endsWith('_skill_workflow_store.sql'))!;
const hex = (c: string) => c.repeat(32);
const UIDS: Record<StartupNode, string> = { market_research: hex('1'), financial_analysis: hex('2'), product_assessment: hex('3'), legal_compliance_review: hex('4') };
const WF = hex('a');
const COMPANY = 41;
const OTHER_COMPANY = 42;
const ACTOR = 9;
const HQ = { scope: 'hq', company_id: null } as const;
const RUN_SCOPE: RunScope = { kind: 'project', project_id: 7 };

function fixture() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
  db.exec(readFileSync(new URL(`../sql/migrations/${MIGRATION}`, import.meta.url), 'utf8'));
  return { db, env: { DB: d1Over(db) } as any };
}
function ctx(): ValidationContext {
  const nodes = Object.keys(UIDS) as StartupNode[];
  const skills: Record<string, SkillFact> = Object.fromEntries(nodes.map((n) => {
    const s = STARTUP_ASSESSMENT_SKILLS[n];
    return [UIDS[n], { uid: UIDS[n], slug: s.slug, scope: 'hq', company_id: null, status: 'published', readable: true,
      versions: [{ version: 1, published: true, suspended: false, roles: [s.role_key], tools: [...s.tools], output_kind: 'brief', content_hash: `h-${n}` }] }];
  }));
  const agents: Record<string, AgentFact> = Object.fromEntries(nodes.map((n) => {
    const s = STARTUP_ASSESSMENT_SKILLS[n];
    return [s.role_key, { uid: `agent-${n}`, role_key: s.role_key, company_id: COMPANY, status: 'active', grants: [...s.tools], pins: { [UIDS[n]]: 1 }, model: 'm' }];
  }));
  return { scope: { company_id: COMPANY, project_id: 7 }, skills, agents };
}
const draft = (): WorkflowDefinition => startupAssessment(UIDS, { uid: WF });

async function publishedPlan(f: ReturnType<typeof fixture>, requestKey = 'request-0001') {
  assert.deepEqual(await saveDraft(f.env, ACTOR, HQ, draft()), { ok: true, uid: WF, created: true });
  const pub = await publishDraft(f.env, ACTOR, HQ, WF, ctx());
  assert.ok(pub.ok, JSON.stringify(pub));
  const v = (await readVersion(f.env, HQ, WF, 1))!;
  const p = await planRun(v.definition, ctx(), requestKey);
  assert.ok(p.ok, JSON.stringify(!p.ok && p.refusals));
  return { plan: p.plan, pub, version: v };
}

test('a draft is shape-checked, scoped to its owner, and saved again in place', async () => {
  const f = fixture();
  const bad = await saveDraft(f.env, ACTOR, HQ, { ...draft(), when: 'always' });
  assert.equal(bad.ok, false);
  assert.equal((bad as any).code, 'definition_invalid');
  // Mutation checked: drop the owner comparison → a company could write an HQ draft.
  assert.deepEqual(await saveDraft(f.env, ACTOR, { scope: 'company', company_id: COMPANY }, draft()), { ok: false, code: 'workflow_out_of_scope' });
  assert.deepEqual(await saveDraft(f.env, ACTOR, HQ, { ...draft(), lifecycle: 'published' }), { ok: false, code: 'not_a_draft' });
  assert.equal((await saveDraft(f.env, ACTOR, HQ, draft())).ok, true);
  const again = await saveDraft(f.env, ACTOR, HQ, { ...draft(), name: 'Startup Assessment (edited)' });
  assert.deepEqual(again, { ok: true, uid: WF, created: false });
  assert.match((await readWorkflow(f.env, HQ, WF))!.draft_json!, /Startup Assessment \(edited\)/);
  assert.deepEqual(await saveDraft(f.env, ACTOR, HQ, { ...draft(), slug: 'renamed' }), { ok: false, code: 'slug_immutable' });
  // Another company cannot see the HQ workflow, and cannot take its uid.
  assert.equal(await readWorkflow(f.env, { scope: 'company', company_id: COMPANY }, WF), null);
  const theirs = { ...draft(), owner: { scope: 'company', company_id: COMPANY } } as WorkflowDefinition;
  assert.deepEqual(await saveDraft(f.env, ACTOR, { scope: 'company', company_id: COMPANY }, theirs), { ok: false, code: 'uid_taken' });
});

test('publishing validates the draft in full, writes version 1 with planRun\'s hash, and the row is immutable', async () => {
  const f = fixture();
  await saveDraft(f.env, ACTOR, HQ, draft());
  // A context missing a skill fails validation: nothing is published.
  const thin = ctx(); delete thin.skills[UIDS.market_research];
  const refused = await publishDraft(f.env, ACTOR, HQ, WF, thin);
  assert.equal((refused as any).code, 'definition_invalid');
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM agent_skill_workflow_versions').get()!.n, 0);
  const pub = await publishDraft(f.env, ACTOR, HQ, WF, ctx());
  assert.ok(pub.ok);
  const v = (await readVersion(f.env, HQ, WF, 1))!;
  assert.deepEqual([v.definition.lifecycle, v.definition.version], ['published', 1]);
  const p = await planRun(v.definition, ctx(), 'request-0001');
  assert.ok(p.ok);
  // Mutation checked: hash the draft instead of the validated, published definition → the plan names another hash.
  assert.equal(p.plan.workflow.definition_hash, (pub as any).definition_hash);
  const w = (await readWorkflow(f.env, HQ, WF))!;
  assert.deepEqual([w.status, w.current_version, w.draft_json], ['published', 1, null]);
  // The published draft is consumed; a second publish has nothing to publish.
  assert.deepEqual(await publishDraft(f.env, ACTOR, HQ, WF, ctx()), { ok: false, code: 'no_draft' });
  assert.throws(() => f.db.exec(`UPDATE agent_skill_workflow_versions SET definition_hash = '${'0'.repeat(64)}'`), /immutable/);
  assert.throws(() => f.db.exec('DELETE FROM agent_skill_workflow_versions'), /immutable/);
});

test('a run is admitted once per plan: the repeat answers the same run, and nothing is started', async () => {
  const f = fixture();
  const { plan } = await publishedPlan(f);
  const first = await admitRun(f.env, ACTOR, HQ, RUN_SCOPE, plan);
  assert.ok(first.ok, JSON.stringify(first));
  assert.equal(first.replayed, false);
  assert.equal(first.run.status, 'admitted');
  const again = await admitRun(f.env, ACTOR, HQ, RUN_SCOPE, plan);
  // Mutation checked: a plain INSERT → the repeat throws on the unique run_key.
  assert.ok(again.ok);
  assert.deepEqual([again.replayed, again.run.uid], [true, first.run.uid]);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM agent_skill_workflow_runs').get()!.n, 1);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM agent_skill_workflow_run_nodes').get()!.n, 0, 'admission creates no node task');
  // The stored plan is the frozen plan, and its scope and version cannot be rewritten.
  assert.deepEqual((await readRun(f.env, RUN_SCOPE, first.run.uid))!.plan, JSON.parse(JSON.stringify(plan)));
  assert.throws(() => f.db.exec(`UPDATE agent_skill_workflow_runs SET plan_json = '{}'`), /frozen/);
  assert.throws(() => f.db.exec('UPDATE agent_skill_workflow_runs SET project_id = 8'), /frozen/);
  // A new request key is a new run.
  const other = await planRun((await readVersion(f.env, HQ, WF, 1))!.definition, ctx(), 'request-0002');
  assert.ok(other.ok);
  const second = await admitRun(f.env, ACTOR, HQ, RUN_SCOPE, other.plan);
  assert.ok(second.ok && !second.replayed && second.run.uid !== first.run.uid);
});

test('admission refuses a plan that does not match its version, its scope or its owner', async () => {
  const f = fixture();
  const { plan } = await publishedPlan(f);
  // A plan from another scope.
  assert.deepEqual(await admitRun(f.env, ACTOR, HQ, { kind: 'project', project_id: 8 }, plan), { ok: false, code: 'plan_out_of_scope' });
  // A plan whose definition hash is not the stored version's (an edited definition).
  const forged = { ...structuredClone(plan), workflow: { ...plan.workflow, definition_hash: 'f'.repeat(64) } };
  // Mutation checked: drop the hash comparison → the forged plan is admitted.
  assert.deepEqual(await admitRun(f.env, ACTOR, HQ, RUN_SCOPE, forged), { ok: false, code: 'plan_incompatible' });
  // A version that was never published.
  const v9 = { ...structuredClone(plan), workflow: { ...plan.workflow, version: 9 } };
  assert.deepEqual(await admitRun(f.env, ACTOR, HQ, RUN_SCOPE, v9), { ok: false, code: 'version_not_found' });
  // A company owner reads only its own workflows: the HQ workflow is not there for it.
  assert.deepEqual(await admitRun(f.env, ACTOR, { scope: 'company', company_id: COMPANY }, RUN_SCOPE, plan), { ok: false, code: 'version_not_found' });
  // And a company workflow runs only inside that company.
  assert.deepEqual(await admitRun(f.env, ACTOR, { scope: 'company', company_id: OTHER_COMPANY }, RUN_SCOPE, plan), { ok: false, code: 'workflow_out_of_scope' });
  assert.deepEqual(await admitRun(f.env, ACTOR, HQ, RUN_SCOPE, { ...structuredClone(plan), run_key: 'wfrun:x' }), { ok: false, code: 'plan_invalid' });
  assert.deepEqual(await admitRun(f.env, ACTOR, HQ, RUN_SCOPE, { ...structuredClone(plan), policy_version: 'skill-workflow/0' }), { ok: false, code: 'plan_incompatible' });
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM agent_skill_workflow_runs').get()!.n, 0);
});

test('a run reads only inside its own scope; a cancel ends an unstarted run and is kept once', async () => {
  const f = fixture();
  const { plan } = await publishedPlan(f);
  const a = await admitRun(f.env, ACTOR, HQ, RUN_SCOPE, plan);
  assert.ok(a.ok);
  // Mutation checked: drop the scope columns from readRun → another project reads the run.
  assert.equal(await readRun(f.env, { kind: 'project', project_id: 8 }, a.run.uid), null);
  assert.equal(await readRun(f.env, { kind: 'company', company_id: OTHER_COMPANY }, a.run.uid), null);
  assert.deepEqual(await requestCancel(f.env, { kind: 'project', project_id: 8 }, a.run.uid), { ok: false, code: 'run_not_found' });
  const c1 = await requestCancel(f.env, RUN_SCOPE, a.run.uid);
  assert.ok(c1.ok);
  assert.equal(c1.status, 'cancelled');
  assert.ok(c1.cancel_requested_at);
  const c2 = await requestCancel(f.env, RUN_SCOPE, a.run.uid);
  assert.deepEqual(c2, c1, 'a repeat changes nothing');
  // A live run keeps its status and records the request.
  f.db.exec(`UPDATE agent_skill_workflow_runs SET status = 'running', cancel_requested_at = NULL, ended_at = NULL`);
  const c3 = await requestCancel(f.env, RUN_SCOPE, a.run.uid);
  assert.ok(c3.ok);
  // Mutation checked: cancel every live status at once → a running node's run reads cancelled while it still runs.
  assert.equal(c3.status, 'running');
  assert.ok(c3.cancel_requested_at);
});

test('the migration holds the scope rules: a run is a company or a project run, never both or neither', () => {
  const f = fixture();
  const ins = (kind: string, company: number | null, project: number | null) => () => f.db.prepare(
    `INSERT INTO agent_skill_workflow_runs (uid, run_key, version_id, scope_kind, company_id, project_id, plan_json, started_by) VALUES (?, ?, 1, ?, ?, ?, '{}', 1)`,
  ).run(`u${Math.random()}`, `k${Math.random()}`, kind, company, project);
  assert.throws(ins('company', null, 7), /CHECK/);
  assert.throws(ins('project', 41, 7), /CHECK/);
  assert.doesNotThrow(ins('company', 41, null));
  assert.throws(() => f.db.exec(`INSERT INTO agent_skill_workflows (uid, scope, company_id, slug, created_by) VALUES ('${hex('b')}', 'hq', 41, 's', 1)`), /CHECK/);
});
