// D1612 part D (#3954, of #3945) — skills on the agent run path, and the
// golden cases of Axal's published skills on the evaluation board.
//
//   · a run that names a skill uses the PINNED version: its steps and tool
//     allow-list are in the agent's turn; the usage rows carry skill_id and
//     skill_version; the run detail names the skill;
//   · the run gate, before any model call: skill_not_attached, skill_suspended,
//     tool_not_approved (a grant withdrawn since the skill was attached),
//     tool_not_in_skill (a read outside the allow-list);
//   · the board: every published Axal skill's starter case and live cases on
//     its current version; a pass that turns into a fail is a regression, told
//     to HQ once; not_run is neither a pass nor a regression.
//
//   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
//     --test cloudflare-worker/test/agent_skill_runs_d1612d.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { makeD1 } from './_d1_sqlite.mjs';
import { addColumnsFrom, stripForeignKeys, tableFromBaseline } from './_baseline.mjs';
import { AI_BUDGET_MIGRATION, AI_LOG_SCHEMA } from './_ai_budget_fixture.mjs';
import { withGuard } from './_guard_stub.mjs';
import { __resetForTest } from '../src/services/aiRouter.ts';
import { agentRun } from '../src/services/agents/agentRun.ts';
import { STARTER_KEY, casesOf, evaluatePublished, scopeSkillIds, skillBoard, skillOfUsage, starterCase, starterSlugs } from '../src/services/agents/skillEval.ts';

const sql = (f: string) => readFileSync(new URL(`../sql/${f}`, import.meta.url), 'utf8');
const BASELINE = sql('schema_baseline.sql');
const RUN_MODEL = '@cf/openai/gpt-oss-120b';
const GUARD = '@cf/meta/llama-guard-3-8b';
const EDITOR = 10, SUPER = 1;
const SKILL_UID = 'f'.repeat(32), OTHER_UID = '9'.repeat(32);
const STEP = { module: 'use-of-funds', option: 'draft:raise/use-of-funds-runway', record: 'project:7', prompt: 'How long is our cash horizon?' };

function world() {
  __resetForTest();
  const { DB, db } = makeD1(
    ['users', 'company_profiles', 'user_company_links', 'projects', 'integrations'].map((t) => stripForeignKeys(tableFromBaseline(BASELINE, t))).join('\n')
    + AI_LOG_SCHEMA + sql('migrations/506_ai_rail_proposals.sql'),
  );
  addColumnsFrom(db, sql('migrations/597_company_archive_and_events.sql'), 'company_profiles');
  for (const m of ['712_team_agents.sql', '202611021724_team_agents_persona.sql']) db.exec(sql(`migrations/${m}`));
  db.exec(stripForeignKeys(sql('migrations/727_scope_goals_and_tasks.sql')));
  for (const m of ['759_agent_skills.sql', '202611022326_agent_skill_context_tokens.sql', '202611022055_agent_skill_moderation.sql', '202611022140_hq_skill_lifecycle.sql']) db.exec(sql(`migrations/${m}`));
  db.exec(AI_BUDGET_MIGRATION + sql('migrations/465_ai_rail_preferences.sql') + sql('migrations/510_member_ai_pauses.sql')
    + sql('migrations/525_ai_reservation_idempotency.sql') + sql('migrations/632_ai_hold_context.sql'));
  // The migration under test, over the AI log schema's ai_usage_logs.
  db.exec(sql('migrations/202611022313_agent_skill_runs.sql'));
  const user = db.prepare("INSERT INTO users (id, uid, email, name, role, founder_id, subscription_tier, subscription_status) VALUES (?, ?, ?, ?, ?, ?, ?, 'active')");
  user.run(SUPER, 'u-super', 'super@example.test', 'Sue Super', 'admin', null, 'free');
  user.run(EDITOR, 'u-editor', 'editor@example.test', 'Eve Editor', 'founder', 100, 'growth');
  db.prepare("INSERT INTO company_profiles (id, uid, company_name) VALUES (1, 'co-uid-1', 'Acme')").run();
  db.prepare("INSERT INTO user_company_links (uid, user_id, company_id, role_in_company) VALUES ('l1', ?, 1, 'Founder')").run(EDITOR);
  db.prepare("INSERT INTO projects (id, uid, name, founder_id, company_id) VALUES (7, 'p7', 'Rocket', 100, 1)").run();
  db.prepare("INSERT INTO ai_licence_caps(licence_key,daily_microusd,monthly_microusd,recorded_by) VALUES('founder:growth',0,0,1)").run();
  db.prepare('INSERT INTO ai_topup_accounts(user_id,balance_microusd) VALUES(?,50000000)').run(EDITOR);
  db.prepare(`INSERT INTO team_agents (id, uid, scope_kind, company_id, project_id, role_key, first_name, model_id, tool_grants_json, sponsor_user_id, monthly_cap_microusd, created_by)
    VALUES (1, ?, 'company', 1, NULL, 'cfo', 'Carla', ?, ?, ?, 5000000, ?)`).run('a'.repeat(32), RUN_MODEL, JSON.stringify([{ integration_uid: 'i1', tool: 'mercury.read' }]), EDITOR, EDITOR);
  // An Axal skill at version 2, pinned at version 1; and another skill, never attached.
  const skill = db.prepare(`INSERT INTO agent_skills (id, uid, scope, slug, name, purpose, steps_json, allowed_tools_json, output_kind, status, current_version, created_by)
    VALUES (?, ?, 'hq', ?, ?, 'From recorded figures, a runway note.', ?, ?, 'brief', 'published', ?, ?)`);
  skill.run(1, SKILL_UID, 'board-meeting-brief', 'Board meeting brief', JSON.stringify(['Latest step']), '["mercury.read"]', 2, SUPER);
  skill.run(2, OTHER_UID, 'weekly-kpi-digest', 'Weekly KPI digest', JSON.stringify(['Read KPIs']), '[]', 1, SUPER);
  const version = db.prepare(`INSERT INTO agent_skill_versions (skill_id, version, skill_md, name, purpose, steps_json, allowed_tools_json, output_kind, taxonomy_json, roles_json, published_by)
    VALUES (?, ?, 'md', ?, 'From recorded figures, a runway note.', ?, ?, 'brief', '[]', '["cfo"]', ?)`);
  version.run(1, 1, 'Board meeting brief', JSON.stringify(['Read the cash balance', 'Say runway is Not recorded unless burn is recorded']), '["mercury.read"]', SUPER);
  version.run(1, 2, 'Board meeting brief v2', JSON.stringify(['A newer step the agent must not see']), '["mercury.read"]', SUPER);
  version.run(2, 1, 'Weekly KPI digest', JSON.stringify(['Read KPIs']), '[]', SUPER);
  db.prepare('INSERT INTO agent_skill_links (agent_id, skill_id, version, linked_by) VALUES (1, 1, 1, ?)').run(EDITOR);
  const prompts: string[] = [];
  const calls: string[] = [];
  const env: any = {
    DB, JWT_SECRET: 'd1612d-fixture-only-secret', ENVIRONMENT: 'development', TEAM_AGENTS_ENABLED: 'true',
    AI: withGuard({ run: async (model: string, input: any) => {
      calls.push(model);
      if (model !== GUARD) prompts.push(JSON.stringify(input.messages ?? input));
      return { response: 'Eighteen months.', usage: { prompt_tokens: 40, completion_tokens: 10 } };
    } }),
  };
  return { db, env, prompts, calls };
}
const agent = (w: ReturnType<typeof world>) => w.db.prepare('SELECT * FROM team_agents WHERE id = 1').get() as any;
const modelCalls = (w: ReturnType<typeof world>) => w.calls.filter((m) => m !== GUARD).length;

test('D1612 D: a run that names a skill uses its pinned version, in the turn and on the usage rows', async () => {
  const w = world();
  const r = await agentRun(w.env, { agent: agent(w), ...STEP, skill: SKILL_UID });
  assert.equal(r.ok, true, JSON.stringify(r));
  const sys = w.prompts.join('\n');
  // Mutation checked: the skill read at `current_version` → v2's step is in the turn and these fail.
  assert.match(sys, /You are using the skill \\"Board meeting brief\\" \(version 1\)/);
  assert.match(sys, /1\. Read the cash balance/);
  assert.match(sys, /It may read only: mercury\.read\./);
  assert.doesNotMatch(sys, /A newer step/);
  const rows = w.db.prepare('SELECT id, skill_id, skill_version, guard_for FROM ai_usage_logs ORDER BY id').all() as any[];
  assert.ok(rows.length >= 1);
  // Mutation checked: `tagUsage` dropped → skill_id NULL and this fails.
  for (const row of rows) assert.deepEqual([row.skill_id, row.skill_version], [1, 1], `usage row ${row.id}`);
  const run = rows.find((x) => x.guard_for == null);
  assert.deepEqual(await skillOfUsage(w.env, run.id), { uid: SKILL_UID, name: 'Board meeting brief', version: 1 });
  const ev = w.db.prepare("SELECT detail_json FROM team_agent_events WHERE kind = 'run'").get() as any;
  assert.deepEqual(JSON.parse(ev.detail_json).skill, { uid: SKILL_UID, version: 1 });
  // A run with no skill tags nothing.
  const plain = await agentRun(w.env, { agent: agent(w), ...STEP });
  assert.equal(plain.ok, true);
  assert.equal((w.db.prepare('SELECT skill_id FROM ai_usage_logs WHERE id = ?').get((plain as any).usageLogId) as any).skill_id, null);
  assert.equal(await skillOfUsage(w.env, (plain as any).usageLogId), null);
});

test('D1612 D: the run gate refuses before any model call — not attached, suspended, a grant withdrawn, a read outside the skill', async () => {
  const w = world();
  const code = async (over: Record<string, unknown>) => {
    const r: any = await agentRun(w.env, { agent: agent(w), ...STEP, ...over });
    return r.ok ? 'ok' : r.code;
  };
  // Mutation checked: the link check dropped → the other skill runs and this fails.
  assert.equal(await code({ skill: OTHER_UID }), 'skill_not_attached');
  assert.equal(await code({ skill: 'not-a-uid' }), 'skill_not_attached');
  // A read the sponsor granted but the skill does not list.
  w.db.prepare("UPDATE team_agents SET tool_grants_json = ? WHERE id = 1").run(JSON.stringify([{ integration_uid: 'i1', tool: 'mercury.read' }, { integration_uid: 'i2', tool: 'hubspot.read_contacts' }]));
  // Mutation checked: the allow-list check dropped → the read goes ahead and the code is not tool_not_in_skill.
  assert.equal(await code({ skill: SKILL_UID, toolReads: [{ integration_uid: 'i2', tool: 'hubspot.read_contacts' }] }), 'tool_not_in_skill');
  // The grant the skill needs, withdrawn since it was attached.
  w.db.prepare("UPDATE team_agents SET tool_grants_json = '[]' WHERE id = 1").run();
  // Mutation checked: the run-time tool check dropped → the run goes ahead and this fails.
  const r: any = await agentRun(w.env, { agent: agent(w), ...STEP, skill: SKILL_UID });
  assert.deepEqual([r.ok, r.status, r.code, r.extra?.tool?.key], [false, 422, 'tool_not_approved', 'mercury.read']);
  w.db.prepare("UPDATE team_agents SET tool_grants_json = ? WHERE id = 1").run(JSON.stringify([{ integration_uid: 'i1', tool: 'mercury.read' }]));
  w.db.prepare("INSERT INTO agent_skill_moderation (skill_id, action, version, reason, created_by) VALUES (1, 'suspend', 2, 'Suspended for a review of its steps.', ?)").run(SUPER);
  assert.equal(await code({ skill: SKILL_UID }), 'skill_suspended');
  assert.equal(modelCalls(w), 0, 'no model ran');
  const refused = w.db.prepare("SELECT COUNT(*) AS n FROM team_agent_events WHERE kind = 'refused'").get() as any;
  assert.equal(refused.n, 5, 'each refusal is an event');
});

test('D1612 D: the starter cases ship with their skills and pass the case check', () => {
  assert.equal(starterSlugs().length, 12);
  for (const slug of starterSlugs()) {
    const c = starterCase(slug);
    assert.ok(c, slug);
    assert.equal(c!.key, STARTER_KEY);
    assert.doesNotMatch(JSON.stringify(c), /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/, `${slug}: no email`);
  }
  assert.equal(starterCase('no-such-skill'), null);
});

test('D1612 D: the board runs each published Axal skill\'s cases on its current version; a pass turned fail is a regression, told once', async () => {
  const w = world();
  w.db.prepare(`INSERT INTO agent_skill_cases (uid, skill_id, name, input_json, expect_json, created_by) VALUES ('case-live-1', 1, 'Live case', ?, ?, ?)`)
    .run(JSON.stringify({ records: { 'mercury.balances': { cash_usd: 1 } } }), JSON.stringify({ output: 'brief', must_include: ['cash'], must_say_not_recorded: [], must_not_include: [] }), SUPER);
  assert.deepEqual((await casesOf(w.env, { id: 1, slug: 'board-meeting-brief' })).map((c) => c.key), [STARTER_KEY, 'case-live-1']);
  let outcome: Record<string, 'pass' | 'fail' | 'not_run'> = {};
  const seen: Array<{ version: string; key: string }> = [];
  const told: any[] = [];
  const deps = {
    runCase: async (_env: any, parts: any, _input: any, expect: any, model: string) => {
      const key = expect.must_include.includes('cash') ? 'live' : 'starter';
      seen.push({ version: parts.name, key });
      return { result: outcome[`${key}|${model}`] ?? 'pass', detail: outcome[`${key}|${model}`] === 'fail' ? 'It left out "37".' : null, usage_log_id: null };
    },
    tellHq: async (_env: any, n: any) => { told.push(n); return 1; },
  };
  const kv = new Map<string, string>();
  w.env.RATE_LIMITS = { get: async (k: string) => kv.get(k) ?? null, put: async (k: string, v: string) => { kv.set(k, v); } };

  const first = await evaluatePublished(w.env, SUPER, [RUN_MODEL], deps as any);
  assert.deepEqual([first.skills, first.results, first.regressions.length], [2, 3, 0], 'two skills: board brief (starter + live) and the KPI digest (starter)');
  // Mutation checked: the version read at the link's pin instead of `current_version` → "Board meeting brief" (v1) runs and this fails.
  assert.ok(seen.some((s) => s.version === 'Board meeting brief v2'), 'the current version');
  outcome = { [`starter|${RUN_MODEL}`]: 'fail', [`live|${RUN_MODEL}`]: 'not_run' };
  const second = await evaluatePublished(w.env, SUPER, [RUN_MODEL], deps as any, 1);
  // Mutation checked: a regression counted from not_run → the live case is a regression too and this fails.
  assert.deepEqual(second.regressions.map((r) => [r.case, r.version]), [['Starter case: board-meeting-brief', 2]]);
  assert.equal(told.length, 1);
  assert.match(told[0].title, /Board meeting brief failed a golden case it used to pass/);
  assert.doesNotMatch(JSON.stringify(told), /@example\.test/, "no email in the notice");
  // The live case: pass, then not_run, then fail. Its last result that ran was a pass, so this is a regression.
  // Mutation checked: the earlier result read with not_run included → not_run is "before" and this fails.
  outcome = { [`starter|${RUN_MODEL}`]: 'pass', [`live|${RUN_MODEL}`]: 'fail' };
  const third = await evaluatePublished(w.env, SUPER, [RUN_MODEL], deps as any, 1);
  assert.deepEqual(third.regressions.map((r) => r.case), ['Live case']);
  // Mutation checked: `firstInWindow` skipped → a second notice for the same regression and this fails.
  outcome = { [`starter|${RUN_MODEL}`]: 'fail', [`live|${RUN_MODEL}`]: 'fail' };
  await evaluatePublished(w.env, SUPER, [RUN_MODEL], deps as any, 1);
  assert.equal(told.length, 2, 'told once per skill, version, case and model');

  const board = await skillBoard(w.env, await scopeSkillIds(w.env, { kind: 'company', id: 1 }));
  assert.equal(board.length, 1, 'only the skills this scope\'s agents use');
  assert.deepEqual([board[0].skill_uid, board[0].version, board[0].pass, board[0].total, board[0].not_run], [SKILL_UID, 2, 0, 2, 0]);
  assert.deepEqual(board[0].regressed.map((r) => r.case).sort(), ['Live case', 'Starter case: board-meeting-brief']);
  const never = await skillBoard(w.env, [2]);
  assert.equal(never[0].total, 1);
  // A case that has only ever failed did not regress: it never passed.
  // Mutation checked: "passed before" read as "ran before" → this fails.
  const fail = w.db.prepare("INSERT INTO agent_skill_version_evals (skill_id, version, case_key, case_name, model_id, result, run_by) VALUES (2, 1, 'k', 'Always fails', 'm', 'fail', ?)");
  fail.run(SUPER); fail.run(SUPER);
  assert.deepEqual((await skillBoard(w.env, [2]))[0].regressed, []);
  assert.deepEqual(await skillBoard(w.env, []), []);
});
