// D4160 (#4160, H2 of #4137) — the lifecycle of Axal's own skills at
// /api/admin/ai-agents/skills, and the publish gate at /api/teams.
//
//   1. Super Admin only.
//   2. No self-approval: the author never reviews or approves their own draft.
//   3. Publish needs an approval on the CURRENT draft (409 needs_approval).
//   4. The golden-case bar: 9 of 10 runs, per case and model, through run() (409 golden_cases_failing).
//   5. Write-capable tools are refused on every save and import (400 tool_not_read_only).
//   6. Retire needs a replacement and a reason, and answers the pinned-agent count.
//   7. A reason is required; every change is audited with it; no email anywhere.
//   8. The diff, and bulk actions that are done or refused one by one.
//
//   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
//     --test cloudflare-worker/test/hq_skill_lifecycle_d4160.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SignJWT } from 'jose';
import { Hono } from 'hono';
import { makeD1 } from './_d1_sqlite.mjs';
import { addColumnsFrom, stripForeignKeys, tableFromBaseline } from './_baseline.mjs';
import { AI_LOG_SCHEMA } from './_ai_budget_fixture.mjs';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';
import teamSkills from '../src/routes/team_skills.ts';
import { agentModels } from '../src/routes/team_agents.ts';
import { mount } from '../src/routes/admin_hq_skills.ts';
import { EVAL_DEPS, diffSteps, meetsBar } from '../src/services/agents/skillLifecycle.ts';
import { isReadOnlyTool } from '../src/services/agents/skills.ts';
import { contextTokensOf } from '../src/services/agents/runCost.ts';

const sql = (f: string) => readFileSync(new URL(`../sql/${f}`, import.meta.url), 'utf8');
const BASELINE = sql('schema_baseline.sql');
const MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
const SUPER = 1, SUPER2 = 3, SUPER3 = 4, ADMIN = 2, EDITOR = 10;
const CFO = 'a'.repeat(32);
const REASON = 'Superseded by the clearer investor update skill.';
const HQ = '/api/admin/ai-agents/skills';

function world() {
  const { DB, db } = makeD1(
    ['users', 'company_profiles', 'user_company_links', 'projects', 'activity_logs'].map((t) => stripForeignKeys(tableFromBaseline(BASELINE, t))).join('\n')
    + AI_LOG_SCHEMA + sql('migrations/506_ai_rail_proposals.sql'),
  );
  addColumnsFrom(db, sql('migrations/597_company_archive_and_events.sql'), 'company_profiles');
  db.exec(sql('migrations/199_super_admin.sql'));
  db.exec(sql('migrations/089_skills_values_taxonomy.sql'));
  db.exec(sql('migrations/712_team_agents.sql'));
  db.exec(sql('migrations/759_agent_skills.sql'));
  db.exec(sql('migrations/202611022326_agent_skill_context_tokens.sql')); // D4121: publishing stores each version's context_tokens
  db.exec(sql('migrations/202611022055_agent_skill_moderation.sql')); // D4161: assign reads the moderation table
  db.exec(sql('migrations/202611022140_hq_skill_lifecycle.sql'));
  const user = db.prepare("INSERT INTO users (id, uid, email, name, role, founder_id, subscription_tier, subscription_status) VALUES (?, ?, ?, ?, ?, ?, 'growth', 'active')");
  user.run(SUPER, 'u-super', 'super@example.test', 'Sue Super', 'admin', null);
  user.run(ADMIN, 'u-admin', 'admin@example.test', 'Ada Admin', 'admin', null);
  user.run(SUPER2, 'u-super2', 'super2@example.test', 'Rex Reviewer', 'admin', null);
  user.run(SUPER3, 'u-super3', 'super3@example.test', 'Tia Third', 'admin', null);
  user.run(EDITOR, 'u-editor', 'editor@example.test', 'Eve Editor', 'founder', 100);
  for (const id of [SUPER, SUPER2, SUPER3]) db.prepare('INSERT INTO super_admins (user_id) VALUES (?)').run(id);
  db.exec(`INSERT INTO company_profiles (id, uid, company_name) VALUES (1, 'co-uid-1', 'Acme')`);
  db.prepare("INSERT INTO user_company_links (uid, user_id, company_id, role_in_company) VALUES ('l1', ?, 1, 'Founder')").run(EDITOR);
  db.exec(`INSERT INTO skills (slug, category_slug, label) VALUES ('investor_reporting', 'finance_ops', 'Investor reporting')`);
  db.prepare(`INSERT INTO team_agents (uid, scope_kind, company_id, role_key, first_name, model_id, tool_grants_json, sponsor_user_id, monthly_cap_microusd, created_by)
    VALUES (?, 'company', 1, 'cfo', 'Carla', ?, ?, ${EDITOR}, 5000000, ${EDITOR})`).run(CFO, MODEL, JSON.stringify([{ integration_uid: 'i1', tool: 'stripe.read' }]));
  const env: any = { DB, JWT_SECRET: 'd4160-fixture-only-secret', ENVIRONMENT: 'development', TEAM_AGENTS_ENABLED: 'true' };
  return { db, env };
}
type W = ReturnType<typeof world>;

function app() {
  const a = new Hono();
  a.onError((e: any, c) => {
    const status = AUTH_ERROR_STATUSES[e?.message];
    return status ? c.json({ detail: e.message }, status) : c.json({ detail: 'Internal server error', m: String(e?.message) }, 500);
  });
  a.route('/api/teams', teamSkills);
  a.route(mount.path, mount.router);
  return a;
}
async function call(w: W, who: number, method: string, path: string, body?: unknown) {
  const jwt = await new SignJWT({ user_id: who }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(w.env.JWT_SECRET));
  const r = await app().request(path, { method, headers: { Authorization: `Bearer ${jwt}`, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body) }, w.env);
  const text = await r.text();
  let parsed: any = null;
  try { parsed = text ? JSON.parse(text) : null; } catch { parsed = null; }
  return { status: r.status, body: parsed, text };
}

const draft = (over: Record<string, unknown> = {}) => ({
  scope: 'hq', name: 'Draft the monthly investor update', purpose: 'From recorded metrics, a draft update for investors.',
  steps: ['Read the recorded metrics', 'Write the highlights'], tools: ['stripe.read'], output_kind: 'draft', roles: ['cfo'],
  tags: [{ slug: 'investor_reporting', level: 'proficient' }], ...over,
});
async function newSkill(w: W, over: Record<string, unknown> = {}) {
  const r = await call(w, SUPER, 'POST', '/api/teams/skills', draft(over));
  assert.equal(r.status, 201, r.text);
  return r.body.skill.uid as string;
}
/** A case whose made-up record carries what the stubbed model will say. */
const goldenCase = (i: number, says: string) => ({
  name: `Case ${i}`, input: { records: { 'stripe.read': { mrr_usd: 41200, say: says } } },
  expect: { output: 'draft', must_include: ['41,200'], must_say_not_recorded: [], must_not_include: ['guaranteed'] },
});
/** The stubbed run(): the model says what the case's record tells it to. */
function stubRun(calls: any[] = []) {
  EVAL_DEPS.run = async (_env: any, opts: any) => {
    calls.push(opts);
    const say = /"say": "([^"]*)"/.exec(opts.messages[0].content)?.[1] ?? '';
    return { ok: true, output: say, usageLogId: null } as any;
  };
  return calls;
}
const anyModel = (w: W) => agentModels(w.env, { id: SUPER, role: 'admin', is_super_admin: 1, subscription_tier: 'growth', subscription_status: 'active' } as any).filter((m) => !m.plan_locked)[0]?.id;
async function approve(w: W, uid: string) {
  assert.equal((await call(w, SUPER, 'POST', `${HQ}/${uid}/review`, { reviewer_uid: 'u-super2' })).status, 201);
  assert.equal((await call(w, SUPER2, 'POST', `${HQ}/${uid}/review/approve`, { comment: 'Reads well.' })).status, 200);
}
async function setCases(w: W, uid: string, says: string[]) {
  const r = await call(w, SUPER, 'PUT', `${HQ}/${uid}/cases`, { reason: 'The golden cases for this skill.', cases: says.map((s, i) => goldenCase(i, s)) });
  assert.equal(r.status, 200, r.text);
}
const audits = (w: W) => {
  try { return (w.db.prepare('SELECT action, filters_json FROM admin_audit_log ORDER BY id').all() as any[]).map((r) => ({ action: r.action, details: JSON.parse(r.filters_json) })); } catch { return []; }
};

test('HQ library reads 180 skills in a fixed number of queries and keeps the detail evaluation summary', async () => {
  const w = world();
  const uid = await newSkill(w);
  await setCases(w, uid, ['first', 'second']);
  assert.equal((await call(w, SUPER, 'POST', `${HQ}/${uid}/review`, { reviewer_uid: 'u-super2' })).status, 201);
  const detail = await call(w, SUPER, 'GET', `${HQ}/${uid}`);
  assert.equal(detail.status, 200, detail.text);
  const hash = detail.body.skill.draft_hash;
  const { id } = w.db.prepare('SELECT id FROM agent_skills WHERE uid = ?').get(uid) as { id: number };
  const [live, removed] = w.db.prepare('SELECT id FROM agent_skill_cases WHERE skill_id = ? ORDER BY id').all(id) as { id: number }[];
  const record = w.db.prepare(`INSERT INTO agent_skill_eval_results (case_id, skill_id, draft_hash, model_id, result, run_by, run_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)`);
  record.run(live.id, id, hash, 'model-one', 'fail', SUPER, '2026-11-04 09:00:00');
  record.run(live.id, id, hash, 'model-one', 'pass', SUPER, '2026-11-04 10:00:00');
  record.run(removed.id, id, hash, 'model-two', 'pass', SUPER, '2026-11-04 11:00:00');
  record.run(live.id, id, '0'.repeat(64), 'stale-model', 'pass', SUPER, '2026-11-04 12:00:00');
  w.db.prepare('UPDATE agent_skill_cases SET removed_at = CURRENT_TIMESTAMP WHERE id = ?').run(removed.id);
  const updated = await call(w, SUPER, 'GET', `${HQ}/${uid}`);
  assert.equal(updated.status, 200, updated.text);

  const db = w.env.DB;
  let reads = 0;
  w.env.DB = { ...db, prepare: (query: string) => { reads++; return db.prepare(query); } };
  const small = await call(w, SUPER, 'GET', HQ);
  assert.equal(small.status, 200, small.text);
  const smallReads = reads;

  const insert = w.db.prepare(`INSERT INTO agent_skills (uid, scope, slug, name, purpose, output_kind, created_by)
    VALUES (?, 'hq', ?, ?, 'A synthetic draft.', 'draft', ?)`);
  for (let i = 1; i < 180; i++) {
    insert.run(`fixture-${i}`, `fixture-${i}`, `Fixture ${i}`, SUPER);
  }
  reads = 0;
  const large = await call(w, SUPER, 'GET', HQ);
  assert.equal(large.status, 200, large.text);
  assert.equal(large.body.skills.length, 180);
  assert.equal(large.body.next_page, null);
  assert.equal(reads, smallReads);
  const row = large.body.skills.find((skill: { uid: string }) => skill.uid === uid);
  assert.equal(row.status, 'in_review');
  assert.equal(row.status, updated.body.skill.status);
  assert.deepEqual(row.golden, { pass: 1, total: 2, meets_bar: false });
  assert.equal(row.last_eval, updated.body.evals.last_run);
  assert.equal(row.last_eval, '2026-11-04 11:00:00');

  const second = await call(w, SUPER, 'GET', `${HQ}?page=2`);
  assert.equal(second.status, 200, second.text);
  assert.deepEqual(second.body.skills, large.body.skills.slice(10, 20));
  assert.equal(second.body.next_page, 3);
});

test('D4160: Super Admin only', async () => {
  // Mutation checked: `requireSuperAdmin` → `requireAdmin` → the plain admin is let in and this fails.
  const w = world();
  const uid = await newSkill(w);
  for (const who of [ADMIN, EDITOR]) {
    for (const [method, path, body] of [['GET', HQ], ['GET', `${HQ}/${uid}`], ['GET', `${HQ}/${uid}/diff`], ['POST', `${HQ}/${uid}/review`, { reviewer_uid: 'u-super2' }],
      ['POST', `${HQ}/${uid}/retire`, { reason: REASON }], ['PUT', `${HQ}/${uid}/cases`, { reason: REASON, cases: [] }], ['POST', `${HQ}/bulk`, { action: 'evals', uids: [uid], reason: REASON }]] as const) {
      assert.equal((await call(w, who, method, path, body)).status, 403, `${who} ${method} ${path}`);
    }
  }
});

test('D4160: no self-approval — the author never reviews or approves their own draft', async () => {
  const w = world();
  const uid = await newSkill(w);
  // Mutation checked: the `reviewer_is_author` line dropped → SUPER names themselves; the CHECK refuses it and the 422 assert fails.
  assert.equal((await call(w, SUPER, 'POST', `${HQ}/${uid}/review`, { reviewer_uid: 'u-super' })).body.error, 'reviewer_is_author');
  assert.equal((await call(w, SUPER, 'POST', `${HQ}/${uid}/review`, { reviewer_uid: 'u-admin' })).body.error, 'reviewer_invalid', 'the reviewer is a Super Admin');
  const asked = await call(w, SUPER, 'POST', `${HQ}/${uid}/review`, { reviewer_uid: 'u-super2' });
  assert.equal(asked.status, 201, asked.text);
  assert.equal(asked.body.status, 'in_review');
  assert.deepEqual(asked.body.review.reviewer, { uid: 'u-super2', name: 'Rex Reviewer' });
  assert.equal((await call(w, SUPER, 'POST', `${HQ}/${uid}/review`, { reviewer_uid: 'u-super3' })).body.error, 'review_open');
  // Mutation checked: the `self_approval` line dropped → SUPER's approval reaches `not_reviewer` and the code assert fails.
  assert.equal((await call(w, SUPER, 'POST', `${HQ}/${uid}/review/approve`, {})).body.error, 'self_approval');
  assert.equal((await call(w, SUPER3, 'POST', `${HQ}/${uid}/review/approve`, {})).body.error, 'not_reviewer');
  assert.equal((await call(w, SUPER2, 'POST', `${HQ}/${uid}/review/request-changes`, { comment: 'short' })).body.error, 'comment_required');
  const ok = await call(w, SUPER2, 'POST', `${HQ}/${uid}/review/approve`, { comment: 'Reads well.' });
  assert.equal(ok.status, 200, ok.text);
  assert.equal(ok.body.review.status, 'approved');
  assert.equal((await call(w, SUPER, 'GET', `${HQ}/${uid}`)).body.review.approved, true);
  // The reviewer who then edits the draft becomes its author: they cannot approve the next review.
  await call(w, SUPER2, 'PATCH', `/api/teams/skills/${uid}`, { purpose: 'From recorded metrics, a draft monthly update for investors.' });
  assert.equal((await call(w, SUPER2, 'POST', `${HQ}/${uid}/review`, { reviewer_uid: 'u-super2' })).body.error, 'reviewer_is_author');
});

test('D4160: publish needs an approval on the current draft', async () => {
  const w = world();
  stubRun();
  const uid = await newSkill(w);
  await setCases(w, uid, Array(10).fill('MRR 41,200'));
  assert.equal((await call(w, SUPER, 'POST', `${HQ}/${uid}/evals`, { models: [anyModel(w)] })).body.evals.meets_bar, true);
  // Mutation checked: the `needs_approval` check dropped from `publishRefusal` → the unapproved draft publishes and this fails.
  const before = await call(w, SUPER, 'POST', `/api/teams/skills/${uid}/publish`);
  assert.deepEqual([before.status, before.body.error], [409, 'needs_approval']);
  await approve(w, uid);
  // An edit after the approval makes a new draft: the approval no longer counts.
  await call(w, SUPER, 'PATCH', `/api/teams/skills/${uid}`, { steps: ['Read the recorded metrics', 'Write the highlights', 'List the asks'] });
  assert.equal((await call(w, SUPER, 'POST', `/api/teams/skills/${uid}/publish`)).body.error, 'needs_approval', 'approved on another text');
  assert.equal((await call(w, SUPER2, 'POST', `${HQ}/${uid}/review/approve`, {})).body.error, 'no_review');
  await approve(w, uid);
  await call(w, SUPER, 'POST', `${HQ}/${uid}/evals`, { models: [anyModel(w)] });
  const pub = await call(w, SUPER, 'POST', `/api/teams/skills/${uid}/publish`);
  assert.equal(pub.status, 200, pub.text);
  assert.equal(pub.body.skill.version, 1);
  // A company's skill has no HQ review: its editors publish it as before.
  const co = await call(w, EDITOR, 'POST', '/api/teams/skills', draft({ scope: 'company', company: 'co-uid-1', name: 'Acme brief' }));
  assert.equal((await call(w, EDITOR, 'POST', `/api/teams/skills/${co.body.skill.uid}/publish`)).status, 200);
});

test('D4160: the golden-case bar is 9 of 10 runs, per case and model, through run()', async () => {
  const w = world();
  const calls = stubRun();
  const uid = await newSkill(w);
  await approve(w, uid);
  assert.equal((await call(w, SUPER, 'POST', `${HQ}/${uid}/evals`, { models: [anyModel(w)] })).body.error, 'no_cases');
  assert.equal((await call(w, SUPER, 'POST', `/api/teams/skills/${uid}/publish`)).body.error, 'golden_cases_failing', 'no case is below the bar');
  // 8 of 10 pass: below the bar.
  await setCases(w, uid, [...Array(8).fill('MRR 41,200'), 'MRR unknown', 'MRR 41,200, guaranteed']);
  const run1 = await call(w, SUPER, 'POST', `${HQ}/${uid}/evals`, { models: [anyModel(w)] });
  assert.equal(run1.status, 200, run1.text);
  assert.deepEqual([run1.body.evals.pass, run1.body.evals.total, run1.body.evals.meets_bar], [8, 10, false]);
  assert.equal(calls.length, 10);
  assert.deepEqual([calls[0].task, calls[0].model, calls[0].pinned, calls[0].userId], ['module_chat', anyModel(w), true, SUPER], 'through run(), pinned to the model, charged to the admin who ran it');
  const failing = run1.body.evals.cases.find((k: any) => k.results[0].result === 'fail');
  assert.match(failing.results[0].detail, /left out "41,200"|said "guaranteed"/);
  const refused = await call(w, SUPER, 'POST', `/api/teams/skills/${uid}/publish`);
  // Mutation checked: `meetsBar`'s `pass * 10 >= total * 9` → `pass * 10 >= total * 8` → 8 of 10 publishes and this fails.
  assert.deepEqual([refused.status, refused.body.error, refused.body.pass, refused.body.total], [409, 'golden_cases_failing', 8, 10]);
  // 9 of 10: at the bar.
  await setCases(w, uid, [...Array(9).fill('MRR 41,200'), 'MRR unknown']);
  await call(w, SUPER, 'POST', `${HQ}/${uid}/evals`, { models: [anyModel(w)] });
  assert.equal((await call(w, SUPER, 'POST', `/api/teams/skills/${uid}/publish`)).status, 200);
  assert.equal(meetsBar(9, 10), true);
  assert.equal(meetsBar(17, 20), false);
  assert.equal(meetsBar(0, 0), false, 'nothing run is not a pass');
  // A model that refuses is "not run", which is not a pass.
  EVAL_DEPS.run = async () => ({ ok: false, refusal: 'spend_limit' } as any);
  const notRun = await call(w, SUPER, 'POST', `${HQ}/${uid}/evals`, { models: [anyModel(w)] });
  assert.equal(notRun.body.evals.cases[0].results[0].result, 'not_run');
  assert.equal((await call(w, SUPER, 'POST', `${HQ}/${uid}/evals`, { models: ['not-a-model'] })).body.error, 'models_invalid');
});

test('D4160: a write-capable tool is refused on every save and import', async () => {
  // Mutation checked: the `tool_not_read_only` line dropped from `checkDraft` → the write tool saves and this fails.
  const w = world();
  for (const t of ['stripe.read', 'hubspot.read_contacts', 'notion.search_pages', 'drive.list_files']) assert.equal(isReadOnlyTool(t), true, t);
  for (const t of ['hubspot.update_deal', 'gmail.send', 'stripe.write', 'stripe.reader', 'nodot']) assert.equal(isReadOnlyTool(t), false, t);
  const create = await call(w, SUPER, 'POST', '/api/teams/skills', draft({ tools: ['stripe.read', 'hubspot.update_deal'] }));
  assert.deepEqual([create.status, create.body.error, create.body.tool], [400, 'tool_not_read_only', 'hubspot.update_deal']);
  const uid = await newSkill(w);
  const patch = await call(w, SUPER, 'PATCH', `/api/teams/skills/${uid}`, { tools: ['gmail.send'] });
  assert.deepEqual([patch.status, patch.body.error, patch.body.tool], [400, 'tool_not_read_only', 'gmail.send']);
  const md = ['---', 'name: "Imported"', 'description: "An imported skill."', 'output: draft', 'roles: ["cfo"]', 'tools: ["hubspot.update_deal"]',
    'taxonomy:', '  - { slug: "investor_reporting", level: working }', '---', '', '1. Read', ''].join('\n');
  const imported = await call(w, SUPER, 'POST', '/api/teams/skills', { scope: 'hq', skill_md: md });
  assert.deepEqual([imported.status, imported.body.error], [400, 'tool_not_read_only']);
  const company = await call(w, EDITOR, 'POST', '/api/teams/skills', draft({ scope: 'company', company: 'co-uid-1', tools: ['hubspot.update_deal'] }));
  assert.equal(company.body.error, 'tool_not_read_only', 'a company skill too');
});

test('D4160: retire needs a replacement and a reason, and answers the pinned-agent count', async () => {
  const w = world();
  stubRun();
  const publish = async (over: Record<string, unknown>) => {
    const uid = await newSkill(w, over);
    await setCases(w, uid, ['MRR 41,200']);
    await approve(w, uid);
    await call(w, SUPER, 'POST', `${HQ}/${uid}/evals`, { models: [anyModel(w)] });
    assert.equal((await call(w, SUPER, 'POST', `/api/teams/skills/${uid}/publish`)).status, 200);
    return uid;
  };
  const old = await publish({});
  const next = await publish({ name: 'Draft the investor update, clearer' });
  const unpublished = await newSkill(w, { name: 'Not yet published' });
  assert.equal((await call(w, EDITOR, 'POST', `/api/teams/skills/${old}/assign`, { agent_uids: [CFO] })).body.added, 1);
  // Mutation checked: `retire` accepting a missing replacement → the retire lands and this fails.
  assert.equal((await call(w, SUPER, 'POST', `${HQ}/${old}/retire`, { reason: REASON })).body.error, 'replacement_required');
  assert.equal((await call(w, SUPER, 'POST', `${HQ}/${old}/retire`, { reason: REASON, replacement_uid: old })).body.error, 'replacement_invalid');
  assert.equal((await call(w, SUPER, 'POST', `${HQ}/${old}/retire`, { reason: REASON, replacement_uid: unpublished })).body.error, 'replacement_invalid');
  assert.equal((await call(w, SUPER, 'POST', `${HQ}/${old}/retire`, { replacement_uid: next })).body.error, 'reason_required');
  assert.equal((await call(w, SUPER, 'PATCH', `/api/teams/skills/${old}`, { status: 'retired' })).body.error, 'replacement_required', 'not around HQ');
  assert.equal((w.db.prepare('SELECT status FROM agent_skills WHERE uid = ?').get(old) as any).status, 'published', 'nothing retired yet');
  const r = await call(w, SUPER, 'POST', `${HQ}/${old}/retire`, { reason: REASON, replacement_uid: next });
  assert.equal(r.status, 200, r.text);
  assert.deepEqual([r.body.status, r.body.pinned_agents, r.body.replacement.uid], ['retired', 1, next]);
  const detail = (await call(w, SUPER, 'GET', `${HQ}/${old}`)).body;
  assert.deepEqual([detail.retired.reason, detail.retired.pinned_agents, detail.retired.replacement.uid], [REASON, 1, next]);
  // The pinned agent keeps its version; nobody new is given it.
  assert.equal((await call(w, EDITOR, 'GET', `/api/teams/agents/${CFO}/skills`)).body.skills[0].pinned_version, 1);
  assert.equal((await call(w, EDITOR, 'GET', `/api/teams/agents/${CFO}/skills/available`)).body.skills.some((k: any) => k.uid === old), false);
  assert.equal((await call(w, SUPER, 'POST', `${HQ}/${old}/retire`, { reason: REASON, replacement_uid: next })).body.error, 'retired');
});

test('D4160: a reason is required, every change is audited with it, and no email is returned', async () => {
  const w = world();
  stubRun();
  const uid = await newSkill(w);
  // Mutation checked: `reasonOf` returning any text → a short reason saves the cases and this fails.
  assert.equal((await call(w, SUPER, 'PUT', `${HQ}/${uid}/cases`, { reason: 'short', cases: [goldenCase(0, 'x')] })).body.error, 'reason_required');
  assert.equal((await call(w, SUPER, 'POST', `${HQ}/bulk`, { action: 'evals', uids: [uid] })).body.error, 'reason_required');
  assert.equal(Number((w.db.prepare('SELECT COUNT(*) AS n FROM agent_skill_cases').get() as any).n), 0);
  // A golden case never holds a member's email.
  const withEmail = goldenCase(0, 'Write to eve@example.test');
  assert.equal((await call(w, SUPER, 'PUT', `${HQ}/${uid}/cases`, { reason: 'The golden cases for this skill.', cases: [withEmail] })).body.error, 'case_has_email');
  await setCases(w, uid, ['MRR 41,200']);
  await approve(w, uid);
  await call(w, SUPER, 'POST', `${HQ}/${uid}/evals`, { models: [anyModel(w)] });
  await call(w, SUPER, 'POST', `/api/teams/skills/${uid}/publish`);
  const actions = audits(w).map((a) => a.action);
  assert.deepEqual(actions, ['agent_skill_cases_set', 'agent_skill_review_requested', 'agent_skill_review_approved', 'agent_skill_evals_run', 'agent_skill_published']);
  const cases = audits(w)[0].details;
  assert.equal(cases.reason, 'The golden cases for this skill.');
  assert.deepEqual([cases.before, cases.after], [{ cases: 0 }, { cases: 1 }]);
  const pub = audits(w).at(-1)!.details;
  assert.deepEqual([pub.before, pub.after], [{ status: 'draft', version: null }, { status: 'published', version: 1 }]);
  for (const path of [HQ, `${HQ}/${uid}`, `${HQ}/${uid}/diff?from=v1&to=draft`]) {
    // A model id starts with `@cf/`; an email is name@domain.tld.
    assert.doesNotMatch((await call(w, SUPER, 'GET', path)).text, /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+\.[A-Za-z]{2,}/, `no email in ${path}`);
  }
  const list = (await call(w, SUPER, 'GET', HQ)).body.skills[0];
  // D4121 (#4121): what the published version adds to a run that uses it: its prompt, by the AI budget's estimate.
  const v1 = w.db.prepare('SELECT v.* FROM agent_skill_versions v JOIN agent_skills s ON s.id = v.skill_id WHERE s.uid = ? AND v.version = 1').get(uid) as any;
  assert.deepEqual([list.status, list.version, list.agents, list.tokens_per_run, list.area?.slug, list.level], ['published', 1, 0, contextTokensOf(v1), 'finance_ops', 'proficient']);
});

test('D4160: the diff between versions and the draft; bulk items done or refused one by one', async () => {
  const w = world();
  stubRun();
  assert.deepEqual(diffSteps(['a', 'b', 'c'], ['a', 'c', 'd']), [{ op: 'same', text: 'a' }, { op: 'removed', text: 'b' }, { op: 'same', text: 'c' }, { op: 'added', text: 'd' }]);
  const ready = await newSkill(w);
  await setCases(w, ready, ['MRR 41,200']);
  await approve(w, ready);
  const unapproved = await newSkill(w, { name: 'Unapproved one' });
  await setCases(w, unapproved, ['MRR 41,200']);
  const evals = await call(w, SUPER, 'POST', `${HQ}/bulk`, { action: 'evals', uids: [ready, unapproved, 'f'.repeat(32)], reason: 'Re-run after the model update.', models: [anyModel(w)] });
  assert.deepEqual(evals.body.results.map((r: any) => [r.ok, r.code ?? null]), [[true, null], [true, null], [false, 'not_found']]);
  // Mutation checked: bulk publish stopping at the first refusal → `ready` is not published and this fails.
  const pub = await call(w, SUPER, 'POST', `${HQ}/bulk`, { action: 'publish', uids: [unapproved, ready], reason: 'The monthly library publish.' });
  assert.deepEqual(pub.body.results.map((r: any) => [r.uid, r.ok, r.code ?? r.version]), [[unapproved, false, 'needs_approval'], [ready, true, 1]]);
  // v1 against an edited draft.
  await call(w, SUPER, 'PATCH', `/api/teams/skills/${ready}`, { name: 'Draft the monthly update', steps: ['Read the recorded metrics', 'List the asks'] });
  const d = await call(w, SUPER, 'GET', `${HQ}/${ready}/diff?from=v1&to=draft`);
  assert.equal(d.status, 200, d.text);
  assert.deepEqual(d.body.frontmatter, [{ field: 'name', from: 'Draft the monthly investor update', to: 'Draft the monthly update' }]);
  assert.deepEqual(d.body.steps, [{ op: 'same', text: 'Read the recorded metrics' }, { op: 'removed', text: 'Write the highlights' }, { op: 'added', text: 'List the asks' }]);
  assert.equal((await call(w, SUPER, 'GET', `${HQ}/${ready}/diff?from=v9`)).body.error, 'version_unknown');
  assert.equal((await call(w, SUPER, 'GET', `${HQ}/${ready}`)).body.skill.status, 'published', 'an unreviewed edit is a draft of a published skill');
});
