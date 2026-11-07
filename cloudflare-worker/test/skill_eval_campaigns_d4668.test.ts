// D4668 (#4668, of #4531) — a global evaluation of Axal's published skills
// reaches every eligible skill, a batch of at most SKILLS_PER_RUN per press,
// instead of re-selecting the first 20 each time.
//
//   · the defect, reproduced: two global presses of `evaluatePublished` both
//     select skills 1–20 of 25;
//   · a campaign's manifest is written at the start; presses walk it in id
//     order; the last short batch, an exact batch boundary and an empty
//     catalogue each end `complete`;
//   · a press that fails part-way leaves its skill pending, and the next press
//     runs (and charges) only the units still missing;
//   · a lease refuses a second press while one runs; cancelled is final;
//   · a skill retired, suspended or republished since the start is skipped with
//     its reason; one published since the start is not in the campaign;
//   · regression notices keep their once-per-unit rule inside a campaign.
//
//   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
//     --test cloudflare-worker/test/skill_eval_campaigns_d4668.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { makeD1 } from './_d1_sqlite.mjs';
import { stripForeignKeys, tableFromBaseline } from './_baseline.mjs';
import { AI_LOG_SCHEMA } from './_ai_budget_fixture.mjs';
import { SignJWT } from 'jose';
import { Hono } from 'hono';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';
import { mount } from '../src/routes/admin_hq_skills.ts';
import { agentModels } from '../src/routes/team_agents.ts';
import { EVAL_DEPS } from '../src/services/agents/skillLifecycle.ts';
import {
  CAMPAIGN_LEASE_MS, SKILLS_PER_RUN, campaignProgress, cancelCampaign, continueCampaign, evaluatePublished, startCampaign,
} from '../src/services/agents/skillEval.ts';

const sql = (f: string) => readFileSync(new URL(`../sql/${f}`, import.meta.url), 'utf8');
const BASELINE = sql('schema_baseline.sql');
const SUPER = 1;
const MODELS = ['@cf/model-a', '@cf/model-b'];
const T0 = new Date('2026-11-06T12:00:00.000Z');
const later = (min: number) => new Date(T0.getTime() + min * 60_000);
const UID = (n: number) => n.toString(16).padStart(32, '0');
const C1 = 'c'.repeat(32), C2 = 'd'.repeat(32);

function world(skills: number) {
  const { DB, db } = makeD1(['users', 'company_profiles', 'projects', 'activity_logs'].map((t) => stripForeignKeys(tableFromBaseline(BASELINE, t))).join('\n') + AI_LOG_SCHEMA);
  for (const m of ['759_agent_skills.sql', '202611022326_agent_skill_context_tokens.sql', '202611022055_agent_skill_moderation.sql',
    '202611022140_hq_skill_lifecycle.sql', '202611022313_agent_skill_runs.sql', '202611062149_skill_eval_campaigns.sql']) db.exec(sql(`migrations/${m}`));
  db.exec(sql('migrations/199_super_admin.sql'));
  db.prepare("INSERT INTO users (id, uid, email, name, role, subscription_tier, subscription_status) VALUES (?, 'u-super', 'super@example.test', 'Sue Super', 'admin', 'growth', 'active')").run(SUPER);
  db.prepare("INSERT INTO users (id, uid, email, name, role, subscription_tier, subscription_status) VALUES (2, 'u-admin', 'admin@example.test', 'Ada Admin', 'admin', 'growth', 'active')").run();
  db.prepare('INSERT INTO super_admins (user_id) VALUES (?)').run(SUPER);
  for (let i = 1; i <= skills; i++) addSkill(db, i);
  const kv = new Map<string, string>();
  const calls: string[] = [];
  const told: any[] = [];
  let outcome = (_skill: string, _case: string, _model: string): 'pass' | 'fail' | 'not_run' => 'pass';
  let failOn: string | null = null;
  const deps = {
    runCase: async (_env: any, parts: any, _input: any, expect: any, model: string) => {
      const unit = `${parts.name}|${expect.must_include[0]}|${model}`;
      if (unit === failOn) throw new Error('model provider unreachable');
      calls.push(unit);
      const result = outcome(parts.name, expect.must_include[0], model);
      return { result, detail: result === 'fail' ? 'It left out a figure.' : null, usage_log_id: null };
    },
    tellHq: async (_env: any, n: any) => { told.push(n); return 1; },
  };
  const env: any = { DB, JWT_SECRET: 'd4668-fixture-only-secret', ENVIRONMENT: 'development', TEAM_AGENTS_ENABLED: 'true', RATE_LIMITS: { get: async (k: string) => kv.get(k) ?? null, put: async (k: string, v: string) => { kv.set(k, v); } } };
  return {
    db, env, deps, calls, told,
    set outcome(f: typeof outcome) { outcome = f; },
    set failOn(u: string | null) { failOn = u; },
  };
}

/** Skill i: an Axal skill, published at version 1, with one live golden case (no starter: its slug ships none). */
function addSkill(db: any, i: number, version = 1) {
  db.prepare(`INSERT INTO agent_skills (id, uid, scope, slug, name, purpose, steps_json, allowed_tools_json, output_kind, status, current_version, created_by)
    VALUES (?, ?, 'hq', ?, ?, 'A note.', '["Read"]', '[]', 'brief', 'published', ?, ?)`).run(i, UID(i), `campaign-skill-${i}`, `Skill ${i}`, version, SUPER);
  addVersion(db, i, version);
  db.prepare(`INSERT INTO agent_skill_cases (uid, skill_id, name, input_json, expect_json, created_by) VALUES (?, ?, ?, ?, ?, ?)`)
    .run(`case-${i}`, i, `Case ${i}`, JSON.stringify({ records: { 'kpi.read': { n: i } } }), JSON.stringify({ output: 'brief', must_include: [`k${i}`], must_say_not_recorded: [], must_not_include: [] }), SUPER);
}
function addVersion(db: any, i: number, version: number) {
  db.prepare(`INSERT INTO agent_skill_versions (skill_id, version, skill_md, name, purpose, steps_json, allowed_tools_json, output_kind, taxonomy_json, roles_json, published_by)
    VALUES (?, ?, 'md', ?, 'A note.', '["Read"]', '[]', 'brief', '[]', '[]', ?)`).run(i, version, `Skill ${i}`, SUPER);
}

const skillsRun = (w: { calls: string[] }) => [...new Set(w.calls.map((c) => Number(c.split('|')[0].replace('Skill ', ''))))].sort((a, b) => a - b);
const range = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
const evalRows = (w: { db: any }) => (w.db.prepare('SELECT COUNT(*) AS n FROM agent_skill_version_evals').get() as any).n;

test('D4668: the defect — two global presses of evaluatePublished both select skills 1–20 of 25', async () => {
  const w = world(25);
  await evaluatePublished(w.env, SUPER, [MODELS[0]], w.deps as any);
  const first = skillsRun(w);
  w.calls.length = 0;
  await evaluatePublished(w.env, SUPER, [MODELS[0]], w.deps as any);
  assert.equal(SKILLS_PER_RUN, 20, 'the per-press bound is unchanged');
  assert.deepEqual(first, range(1, 20));
  assert.deepEqual(skillsRun(w), range(1, 20), 'skills 21–25 are never reached this way');
});

test('D4668: a campaign walks all 25 skills across two bounded presses, then is complete', async () => {
  const w = world(25);
  await startCampaign(w.env, SUPER, MODELS, C1);
  const a: any = await continueCampaign(w.env, SUPER, C1, T0, w.deps as any);
  assert.equal(a.ok, true, JSON.stringify(a));
  assert.deepEqual(skillsRun(w), range(1, 20));
  assert.deepEqual([a.skills, a.results, a.campaign.status, a.campaign.total, a.campaign.done, a.campaign.pending], [20, 40, 'running', 25, 20, 5]);
  // What it ran: each skill at its version, its cases and the campaign's models.
  assert.deepEqual(a.evaluated[0], { skill_uid: UID(1), name: 'Skill 1', version: 1, cases: [{ key: 'case-1', name: 'Case 1' }], models: MODELS, results: 2 });
  w.calls.length = 0;
  // Mutation checked: the next batch read without `state = 'pending'` → skills 1–20 again and this fails.
  const b: any = await continueCampaign(w.env, SUPER, C1, later(1), w.deps as any);
  assert.deepEqual(skillsRun(w), range(21, 25), 'the second press reaches the later skills');
  assert.deepEqual([b.skills, b.results, b.campaign.status, b.campaign.done, b.campaign.pending], [5, 10, 'complete', 25, 0]);
  assert.deepEqual(b.campaign.results, { pass: 50, fail: 0, not_run: 0 });
  assert.equal(b.campaign.finished_at, later(1).toISOString());
  // A press on a complete campaign runs nothing.
  w.calls.length = 0;
  const c: any = await continueCampaign(w.env, SUPER, C1, later(2), w.deps as any);
  assert.deepEqual([c.ok, c.skills, c.results, w.calls.length, evalRows(w)], [true, 0, 0, 0, 50]);
});

test('D4668: an exact batch boundary and an empty catalogue end complete on their first press', async () => {
  const twenty = world(20);
  await startCampaign(twenty.env, SUPER, [MODELS[0]], C1);
  const r: any = await continueCampaign(twenty.env, SUPER, C1, T0, twenty.deps as any);
  // Mutation checked: complete decided by "fewer than 20 ran" → this batch of exactly 20 stays running and this fails.
  assert.deepEqual([r.skills, r.campaign.status, r.campaign.pending], [20, 'complete', 0]);
  const none = world(0);
  await startCampaign(none.env, SUPER, [MODELS[0]], C2);
  const e: any = await continueCampaign(none.env, SUPER, C2, T0, none.deps as any);
  assert.deepEqual([e.ok, e.skills, e.campaign.status, e.campaign.total], [true, 0, 'complete', 0]);
});

test('D4668: a press that fails part-way leaves its skill pending; the next runs only the missing units, charging nothing twice', async () => {
  const w = world(3);
  await startCampaign(w.env, SUPER, MODELS, C1);
  w.failOn = `Skill 2|k2|${MODELS[1]}`;
  await assert.rejects(continueCampaign(w.env, SUPER, C1, T0, w.deps as any), /unreachable/);
  const mid = await campaignProgress(w.env, C1);
  assert.deepEqual([mid!.status, mid!.done, mid!.pending], ['running', 1, 2], 'skill 1 done; skill 2 interrupted; skill 3 not reached');
  // Mutation checked: the lease not released in `finally` → the retry is refused campaign_busy and this fails.
  assert.equal((w.db.prepare('SELECT lease_until FROM agent_skill_eval_campaigns').get() as any).lease_until, null);
  w.failOn = null;
  w.calls.length = 0;
  const r: any = await continueCampaign(w.env, SUPER, C1, later(1), w.deps as any);
  // Mutation checked: the done items not skipped → Skill 2 on model-a runs (and is charged) again and this fails.
  assert.deepEqual(w.calls, [`Skill 2|k2|${MODELS[1]}`, `Skill 3|k3|${MODELS[0]}`, `Skill 3|k3|${MODELS[1]}`]);
  assert.deepEqual([r.campaign.status, r.campaign.results.pass], ['complete', 6]);
  assert.equal(evalRows(w), 6, 'one result per skill, case and model');
  const dup = w.db.prepare('SELECT COUNT(*) AS n FROM (SELECT 1 FROM agent_skill_eval_campaign_items GROUP BY skill_id, case_key, model_id HAVING COUNT(*) > 1)').get() as any;
  assert.equal(dup.n, 0);
});

test('D4668: a unit the campaign already recorded is skipped, not run again', async () => {
  const w = world(1);
  await startCampaign(w.env, SUPER, [MODELS[0]], C1);
  // The unit is already recorded for this campaign (an earlier press wrote it): this press must neither run nor record it again.
  w.db.exec(`INSERT INTO agent_skill_version_evals (skill_id, version, case_key, case_name, model_id, result, run_by) VALUES (1, 1, 'case-1', 'Case 1', '${MODELS[0]}', 'pass', 1)`);
  w.db.exec(`INSERT INTO agent_skill_eval_campaign_items (campaign_id, skill_id, version, case_key, model_id, eval_id) VALUES (1, 1, 1, 'case-1', '${MODELS[0]}', 1)`);
  w.db.exec("UPDATE agent_skill_eval_campaign_skills SET state = 'pending'");
  const r: any = await continueCampaign(w.env, SUPER, C1, T0, w.deps as any);
  assert.deepEqual([r.results, w.calls.length, evalRows(w)], [0, 0, 1], 'the done unit is skipped, not re-run');
});

test('D4668: a second press while one holds the lease is refused; the lease expires', async () => {
  const w = world(2);
  await startCampaign(w.env, SUPER, [MODELS[0]], C1);
  w.db.prepare('UPDATE agent_skill_eval_campaigns SET lease_until = ?').run(later(10).toISOString());
  const busy: any = await continueCampaign(w.env, SUPER, C1, T0, w.deps as any);
  // Mutation checked: the lease condition dropped → the batch runs and this fails.
  assert.deepEqual([busy.ok, busy.status, busy.code, w.calls.length], [false, 409, 'campaign_busy', 0]);
  assert.equal(busy.campaign.pending, 2);
  const ok: any = await continueCampaign(w.env, SUPER, C1, later(10), w.deps as any);
  assert.deepEqual([ok.ok, ok.campaign.status], [true, 'complete']);
  assert.equal(CAMPAIGN_LEASE_MS, 15 * 60_000);
});

test('D4668: cancelled is final and visible; cancelling a complete campaign is refused', async () => {
  const w = world(25);
  await startCampaign(w.env, SUPER, [MODELS[0]], C1);
  await continueCampaign(w.env, SUPER, C1, T0, w.deps as any);
  const c: any = await cancelCampaign(w.env, SUPER, C1, later(1));
  assert.deepEqual([c.ok, c.campaign.status, c.campaign.done, c.campaign.pending, c.campaign.finished_at], [true, 'cancelled', 20, 5, later(1).toISOString()]);
  w.calls.length = 0;
  const r: any = await continueCampaign(w.env, SUPER, C1, later(2), w.deps as any);
  // Mutation checked: the cancelled check dropped → skills 21–25 run and this fails.
  assert.deepEqual([r.ok, r.status, r.code, r.campaign.status, w.calls.length], [false, 409, 'campaign_cancelled', 'cancelled', 0]);
  assert.equal((await cancelCampaign(w.env, SUPER, C1, later(3)) as any).ok, true, 'cancelling again changes nothing');
  const small = world(1);
  await startCampaign(small.env, SUPER, [MODELS[0]], C2);
  await continueCampaign(small.env, SUPER, C2, T0, small.deps as any);
  const done: any = await cancelCampaign(small.env, SUPER, C2, later(1));
  assert.deepEqual([done.ok, done.status, done.code], [false, 409, 'campaign_complete']);
  assert.deepEqual([(await continueCampaign(w.env, SUPER, 'nope', T0) as any).code, await campaignProgress(w.env, 'x'.repeat(32))], ['campaign_not_found', null]);
});

test('D4668: skills changed during the walk are skipped with a reason; one published since the start is not in it', async () => {
  const w = world(25);
  await startCampaign(w.env, SUPER, [MODELS[0]], C1);
  await continueCampaign(w.env, SUPER, C1, T0, w.deps as any);
  w.db.exec("UPDATE agent_skills SET status = 'retired' WHERE id = 21");
  addVersion(w.db, 22, 2);
  w.db.exec('UPDATE agent_skills SET current_version = 2 WHERE id = 22');
  w.db.prepare("INSERT INTO agent_skill_moderation (skill_id, action, version, reason, created_by) VALUES (23, 'suspend', 1, 'Suspended for a review of its steps.', ?)").run(SUPER);
  w.db.exec('DELETE FROM agent_skill_versions WHERE skill_id = 24');
  addSkill(w.db, 26);
  w.calls.length = 0;
  const r: any = await continueCampaign(w.env, SUPER, C1, later(1), w.deps as any);
  // Mutation checked: the version check dropped → Skill 22's version 2 runs under a campaign that started on version 1 and this fails.
  assert.deepEqual(skillsRun(w), [25], 'only the unchanged skill runs; skill 26 is not in the manifest');
  assert.deepEqual(r.campaign.skipped_skills, [
    { skill_uid: UID(21), version: 1, reason: 'not_eligible' },
    { skill_uid: UID(22), version: 1, reason: 'version_changed' },
    // Mutation checked: the suspension check dropped → Skill 23 runs and this fails.
    { skill_uid: UID(23), version: 1, reason: 'not_eligible' },
    { skill_uid: UID(24), version: 1, reason: 'version_unreadable' },
  ]);
  assert.deepEqual([r.campaign.status, r.campaign.total, r.campaign.done, r.campaign.skipped], ['complete', 25, 21, 4]);
});

test('D4668: a regression inside a campaign is told to HQ once; not_run is neither a pass nor a regression', async () => {
  const w = world(1);
  await startCampaign(w.env, SUPER, [MODELS[0]], C1);
  await continueCampaign(w.env, SUPER, C1, T0, w.deps as any);
  w.outcome = () => 'fail';
  await startCampaign(w.env, SUPER, [MODELS[0]], C2);
  const r: any = await continueCampaign(w.env, SUPER, C2, later(1), w.deps as any);
  assert.deepEqual(r.regressions.map((x: any) => [x.skill_uid, x.case, x.version, x.model]), [[UID(1), 'Case 1', 1, MODELS[0]]]);
  assert.deepEqual([w.told.length, r.campaign.results], [1, { pass: 0, fail: 1, not_run: 0 }]);
  // A third campaign: still failing, the same unit → no second notice.
  await startCampaign(w.env, SUPER, [MODELS[0]], 'e'.repeat(32));
  await continueCampaign(w.env, SUPER, 'e'.repeat(32), later(2), w.deps as any);
  assert.equal(w.told.length, 1);
  w.outcome = () => 'not_run';
  await startCampaign(w.env, SUPER, [MODELS[0]], 'f'.repeat(32));
  const nr: any = await continueCampaign(w.env, SUPER, 'f'.repeat(32), later(3), w.deps as any);
  assert.deepEqual([nr.regressions.length, nr.campaign.results], [0, { pass: 0, fail: 0, not_run: 1 }]);
});

async function call(w: ReturnType<typeof world>, who: number, method: string, path: string, body?: unknown) {
  const a = new Hono();
  a.onError((e: any, c) => {
    const status = AUTH_ERROR_STATUSES[e?.message];
    return status ? c.json({ detail: e.message }, status) : c.json({ detail: 'Internal server error', m: String(e?.message) }, 500);
  });
  a.route(mount.path, mount.router);
  const jwt = await new SignJWT({ user_id: who }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(w.env.JWT_SECRET));
  const r = await a.request(path, { method, headers: { Authorization: `Bearer ${jwt}`, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body) }, w.env);
  return { status: r.status, body: await r.json().catch(() => null) as any };
}

test('D4668: the route — a global press starts a campaign, `campaign` continues it; the single-skill press is unchanged', async () => {
  const w = world(21);
  const HQ = '/api/admin/ai-agents/skills/evals/published';
  // The model says each case's phrase, so every case passes through the real runCase and run() seam.
  EVAL_DEPS.run = async (_env: any, opts: any) => ({ ok: true, output: `k1 k2 k3 k4 k5 k6 k7 k8 k9 k10 k11 k12 k13 k14 k15 k16 k17 k18 k19 k20 k21`, usageLogId: null } as any);
  const model = agentModels(w.env, { id: SUPER, role: 'admin', is_super_admin: 1, subscription_tier: 'growth', subscription_status: 'active' } as any).filter((m) => !m.plan_locked)[0]?.id;
  assert.ok(model);
  assert.equal((await call(w, 2, 'POST', HQ, { models: [model] })).status, 403, 'Super Admin only');
  const first = await call(w, SUPER, 'POST', HQ, { models: [model] });
  assert.equal(first.status, 200, JSON.stringify(first.body));
  assert.deepEqual([first.body.skills, first.body.results, first.body.regressions, first.body.campaign.status, first.body.campaign.pending], [20, 20, [], 'running', 1]);
  const uid = first.body.campaign.uid;
  // Mutation checked: the models_fixed check dropped → the press continues on other models and this fails.
  assert.equal((await call(w, SUPER, 'POST', HQ, { campaign: uid, models: [model] })).body?.error, 'models_fixed');
  const second = await call(w, SUPER, 'POST', HQ, { campaign: uid });
  assert.deepEqual([second.body.skills, second.body.evaluated[0].skill_uid, second.body.campaign.status], [1, UID(21), 'complete']);
  const read = await call(w, SUPER, 'GET', `${HQ}/campaigns/${uid}`);
  assert.deepEqual([read.status, read.body.campaign.done, read.body.campaign.results.pass], [200, 21, 21]);
  assert.equal((await call(w, SUPER, 'POST', `${HQ}/campaigns/${uid}/cancel`)).body?.error, 'campaign_complete');
  assert.equal((await call(w, SUPER, 'GET', `${HQ}/campaigns/${'0'.repeat(32)}`)).status, 404);
  // The single-skill press: no campaign, the same three fields as before.
  const one = await call(w, SUPER, 'POST', HQ, { models: [model], uid: UID(3) });
  assert.deepEqual([one.status, Object.keys(one.body).sort(), one.body.skills], [200, ['regressions', 'results', 'skills'], 1]);
  const audits = w.db.prepare("SELECT COUNT(*) AS n FROM activity_logs WHERE action = 'agent_skill_published_evals_run'").get() as any;
  assert.equal(audits.n, 3, 'each press writes the admin audit row');
});
