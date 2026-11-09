// D4533 (#4533, step 3 of #4528) — the release evidence of Axal's own skills.
//
//   1. A review is asked on the whole evidence: a draft edit or a case-suite edit makes it stale.
//   2. An eval result counts only under the evidence it ran on: a definition, case, evaluator or
//      required-model change makes it stale.
//   3. A required model with no result is `not_evaluated`: listed, blocking, never a pass.
//   4. One freshness decision: the publish gate refuses on it, the refusal and the reply carry it,
//      and GET /:uid answers the same object.
//   5. A published HQ version keeps its manifest; versions, cases, results and decided reviews are
//      never rewritten or deleted, and no failed publish leaves a pointer without its version row.
//   6. A version from before D4533 has no manifest and reads null, never "passed".
//   7. The author never approves; a company skill keeps its own rules.
//
//   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
//     --test cloudflare-worker/test/hq_skill_release_evidence_d4533.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SignJWT } from 'jose';
import { Hono } from 'hono';
import { makeD1 } from './_d1_sqlite.mjs';
import { stripForeignKeys, addColumnsFrom, tableFromBaseline } from './_baseline.mjs';
import { AI_LOG_SCHEMA } from './_ai_budget_fixture.mjs';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';
import teamSkills from '../src/routes/team_skills.ts';
import { agentModels } from '../src/routes/team_agents.ts';
import { mount } from '../src/routes/admin_hq_skills.ts';
import { EVALUATOR, EVAL_DEPS, releaseDecision } from '../src/services/agents/skillLifecycle.ts';
import { JUDGE_VERSION } from '../src/services/agents/skillAssertions.ts';
import { draftPartsOf } from '../src/services/agents/skillPublish.ts';

const sql = (f: string) => readFileSync(new URL(`../sql/${f}`, import.meta.url), 'utf8');
const BASELINE = sql('schema_baseline.sql');
const SUPER = 1, SUPER2 = 3, SUPER3 = 4, EDITOR = 10;
const HQ = '/api/admin/ai-agents/skills';
const WHY = 'The release evidence for this skill.';

function world() {
  const { DB, db } = makeD1(
    ['users', 'company_profiles', 'user_company_links', 'projects', 'activity_logs'].map((t) => stripForeignKeys(tableFromBaseline(BASELINE, t))).join('\n')
    + AI_LOG_SCHEMA + sql('migrations/506_ai_rail_proposals.sql'),
  );
  addColumnsFrom(db, sql('migrations/597_company_archive_and_events.sql'), 'company_profiles');
  for (const m of ['199_super_admin', '089_skills_values_taxonomy', '712_team_agents', '759_agent_skills', '202611022326_agent_skill_context_tokens',
    '202611022055_agent_skill_moderation', '202611022140_hq_skill_lifecycle', '202611081919_skill_release_evidence']) db.exec(sql(`migrations/${m}.sql`));
    db.exec(sql('migrations/202611090904_skill_eval_result_identity.sql')); // D4531 slice 3: the evaluator (and case text) on each result row
  const user = db.prepare("INSERT INTO users (id, uid, email, name, role, founder_id, subscription_tier, subscription_status) VALUES (?, ?, ?, ?, ?, ?, 'growth', 'active')");
  user.run(SUPER, 'u-super', 'super@example.test', 'Sue Super', 'admin', null);
  user.run(SUPER2, 'u-super2', 'super2@example.test', 'Rex Reviewer', 'admin', null);
  user.run(SUPER3, 'u-super3', 'super3@example.test', 'Tia Third', 'admin', null);
  user.run(EDITOR, 'u-editor', 'editor@example.test', 'Eve Editor', 'founder', 100);
  for (const id of [SUPER, SUPER2, SUPER3]) db.prepare('INSERT INTO super_admins (user_id) VALUES (?)').run(id);
  db.exec(`INSERT INTO company_profiles (id, uid, company_name) VALUES (1, 'co-uid-1', 'Acme')`);
  db.prepare("INSERT INTO user_company_links (uid, user_id, company_id, role_in_company) VALUES ('l1', ?, 1, 'Founder')").run(EDITOR);
  db.exec(`INSERT INTO skills (slug, category_slug, label) VALUES ('investor_reporting', 'finance_ops', 'Investor reporting')`);
  const env: any = { DB, JWT_SECRET: 'd4533-fixture-only-secret', ENVIRONMENT: 'development', TEAM_AGENTS_ENABLED: 'true' };
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

const offered = (w: W): string[] => agentModels(w.env, { id: SUPER, role: 'admin' } as any).filter((m) => !m.plan_locked).map((m) => m.id);
const draft = (over: Record<string, unknown> = {}) => ({
  scope: 'hq', name: 'Draft the monthly investor update', purpose: 'From recorded metrics, a draft update for investors.',
  steps: ['Read the recorded metrics', 'Write the highlights'], tools: ['stripe.read'], output_kind: 'draft', roles: ['cfo'],
  tags: [{ slug: 'investor_reporting', level: 'proficient' }], ...over,
});
const goldenCase = (i: number, says: string) => ({
  name: `Case ${i}`, input: { records: { 'stripe.read': { mrr_usd: 41200, say: says } } },
  expect: { output: 'draft', must_include: ['41,200'], must_say_not_recorded: [], must_not_include: ['guaranteed'] },
});
function stubRun() {
  EVAL_DEPS.run = async (_env: any, opts: any) => ({ ok: true, output: /"say": "([^"]*)"/.exec(opts.messages[0].content)?.[1] ?? '', usageLogId: null } as any);
}
let made = 0;
async function newSkill(w: W, models: string[], over: Record<string, unknown> = {}) {
  made += 1;
  const r = await call(w, SUPER, 'POST', '/api/teams/skills', draft({ name: `Draft the monthly investor update ${made}`, ...over }));
  assert.equal(r.status, 201, r.text);
  const uid = r.body.skill.uid as string;
  assert.equal((await call(w, SUPER, 'PUT', `${HQ}/${uid}/models`, { models, reason: WHY })).status, 200);
  return uid;
}
async function setCases(w: W, uid: string, cases: any[]) {
  const r = await call(w, SUPER, 'PUT', `${HQ}/${uid}/cases`, { reason: WHY, cases });
  assert.equal(r.status, 200, r.text);
  return r.body;
}
const liveUids = (w: W, uid: string) => (w.db.prepare('SELECT k.uid FROM agent_skill_cases k JOIN agent_skills s ON s.id = k.skill_id WHERE s.uid = ? AND k.removed_at IS NULL ORDER BY k.id').all(uid) as any[]).map((r) => r.uid);
async function askReview(w: W, uid: string) {
  const r = await call(w, SUPER, 'POST', `${HQ}/${uid}/review`, { reviewer_uid: 'u-super2' });
  assert.equal(r.status, 201, r.text);
}
async function approve(w: W, uid: string) {
  await askReview(w, uid);
  const r = await call(w, SUPER2, 'POST', `${HQ}/${uid}/review/approve`, { comment: 'Reads well.' });
  assert.equal(r.status, 200, r.text);
}
const evals = (w: W, uid: string, models?: string[]) => call(w, SUPER, 'POST', `${HQ}/${uid}/evals`, models ? { models } : {});
const publish = (w: W, uid: string) => call(w, SUPER, 'POST', `/api/teams/skills/${uid}/publish`);
const detail = async (w: W, uid: string) => (await call(w, SUPER, 'GET', `${HQ}/${uid}`)).body;
/** A ready draft: cases, its required models, an approval and passing results on every required model. */
async function ready(w: W, models: string[], n = 2) {
  stubRun();
  const uid = await newSkill(w, models);
  await setCases(w, uid, Array.from({ length: n }, (_, i) => goldenCase(i, 'MRR 41,200')));
  await approve(w, uid);
  assert.equal((await evals(w, uid)).status, 200);
  assert.equal((await detail(w, uid)).freshness.ready, true);
  return uid;
}

test('D4533: a review goes stale after a draft edit and after a case-suite edit', async () => {
  const w = world();
  const [m1] = offered(w);
  const uid = await ready(w, [m1]);
  // Draft edit: the approval is on other evidence.
  await call(w, SUPER, 'PATCH', `/api/teams/skills/${uid}`, { steps: ['Read the recorded metrics', 'Write the highlights', 'List the asks'] });
  let f = (await detail(w, uid)).freshness;
  assert.deepEqual([f.ready, f.review.approved, f.review.changes], [false, false, { definition: true, cases: false, evaluator: false, models: false }]);
  assert.equal((await publish(w, uid)).body.error, 'needs_approval');

  // An open review goes stale when the suite changes under it.
  await askReview(w, uid);
  assert.equal((await detail(w, uid)).skill.status, 'in_review');
  // Mutation checked: the suite revision dropped from `evidenceHashOf` → the review stays current and this fails.
  await setCases(w, uid, [{ ...goldenCase(0, 'x'), uid: liveUids(w, uid)[0] }, goldenCase(7, 'MRR 41,200')]);
  const d = await detail(w, uid);
  assert.equal(d.skill.status, 'draft', 'not in review on cases it was not asked about');
  assert.deepEqual(d.review.open.changes, { definition: false, cases: true, evaluator: false, models: false });
  const stale = await call(w, SUPER2, 'POST', `${HQ}/${uid}/review/approve`, {});
  // Mutation checked: `decide` comparing `draft_hash` again → the reviewer approves cases they never saw and this fails.
  assert.deepEqual([stale.status, stale.body.error, stale.body.changes?.cases], [409, 'review_stale', true]);
  // Asking again withdraws the stale request; the same evidence twice is `review_open`.
  await askReview(w, uid);
  assert.equal((await call(w, SUPER, 'POST', `${HQ}/${uid}/review`, { reviewer_uid: 'u-super3' })).body.error, 'review_open');
  const rows = w.db.prepare("SELECT status FROM agent_skill_reviews ORDER BY id").all() as any[];
  assert.deepEqual(rows.map((r) => r.status), ['approved', 'withdrawn', 'requested']);
});

test('D4533: an evaluation goes stale after a definition, case, evaluator or model-set change', async () => {
  const w = world();
  const [m1, m2] = offered(w);
  const check = async (uid: string, why: string) => {
    const f = (await detail(w, uid)).freshness;
    assert.equal(f.ready, false, why);
    assert.ok(f.blocking.includes('evaluation_incomplete'), `${why}: ${f.blocking}`);
    assert.equal(f.evaluation.pass, 0, `${why}: no earlier result counts`);
  };
  // Definition.
  let uid = await ready(w, [m1]);
  await call(w, SUPER, 'PATCH', `/api/teams/skills/${uid}`, { purpose: 'From recorded metrics, a draft monthly update for investors.' });
  await check(uid, 'definition edit');
  // A case added, a case removed, a case changed (a changed case is a new one).
  uid = await ready(w, [m1], 2);
  const [a, b] = liveUids(w, uid);
  await setCases(w, uid, [{ ...goldenCase(0, ''), uid: a }, { ...goldenCase(1, ''), uid: b }, goldenCase(2, 'MRR 41,200')]);
  await check(uid, 'case added');
  uid = await ready(w, [m1], 2);
  await setCases(w, uid, [{ ...goldenCase(0, ''), uid: liveUids(w, uid)[0] }]);
  await check(uid, 'case removed');
  uid = await ready(w, [m1], 2);
  await setCases(w, uid, [{ ...goldenCase(0, ''), uid: liveUids(w, uid)[0] }, goldenCase(1, 'MRR 41,200 and more')]);
  await check(uid, 'case edited');
  // Evaluator version: #4531's constant moves on.
  uid = await ready(w, [m1]);
  assert.equal(EVALUATOR.version, JUDGE_VERSION, 'read through the import');
  EVALUATOR.version = JUDGE_VERSION + 1;
  try {
    // Mutation checked: the evaluator version dropped from `evidenceHashOf` → the old results still count and this fails.
    await check(uid, 'evaluator version');
    assert.deepEqual((await detail(w, uid)).freshness.review.changes, { definition: false, cases: false, evaluator: true, models: false });
  } finally { EVALUATOR.version = JUDGE_VERSION; }
  assert.equal((await detail(w, uid)).freshness.ready, true, 'back on the evaluator it was evaluated on');
  // Required models: a model added, and a model removed.
  uid = await ready(w, [m1]);
  // Mutation checked: the model set dropped from `evidenceHashOf` → the review and m1's results still count and this fails.
  assert.equal((await call(w, SUPER, 'PUT', `${HQ}/${uid}/models`, { models: [m1, m2], reason: WHY })).status, 200);
  await check(uid, 'model added');
  uid = await ready(w, [m1, m2]);
  const set = await call(w, SUPER, 'PUT', `${HQ}/${uid}/models`, { models: [m2], reason: WHY });
  assert.deepEqual(set.body.models, { required: [m2], source: 'declared' });
  await check(uid, 'model removed');
  assert.deepEqual((await detail(w, uid)).freshness.review.changes, { definition: false, cases: false, evaluator: false, models: true });
  // Back to the default set: explicit, from the offer, never from the results.
  const def = await call(w, SUPER, 'PUT', `${HQ}/${uid}/models`, { models: null, reason: WHY });
  assert.deepEqual(def.body.models, { required: [...offered(w).slice(0, 5)].sort(), source: 'default' });
  assert.equal((await call(w, SUPER, 'PUT', `${HQ}/${uid}/models`, { models: ['not-a-model'], reason: WHY })).body.error, 'models_invalid');
  assert.equal((await call(w, SUPER, 'PUT', `${HQ}/${uid}/models`, { models: [m1], reason: 'short' })).body.error, 'reason_required');
  assert.equal((await call(w, SUPER2, 'PUT', `${HQ}/${uid}/models`, { models: [m1], reason: WHY })).status, 200, 'any Super Admin');
});

test('D4533: a required model with no result is not evaluated, blocks, and never counts as a pass', async () => {
  const w = world();
  stubRun();
  // m2 is outside the first five offered models, so only the required set (not the old default) covers it.
  const [m1, , m3] = offered(w);
  const m2 = offered(w)[7];
  const uid = await newSkill(w, [m1, m2]);
  await setCases(w, uid, Array.from({ length: 10 }, (_, i) => goldenCase(i, 'MRR 41,200')));
  await approve(w, uid);
  // Every case on m1, and on a model that is not required.
  await evals(w, uid, [m1, m3]);
  // 19 of 20 cells pass, under the current evidence, and the 20th has no result: 95% by the numbers.
  const f0 = (await detail(w, uid)).freshness;
  const s = w.db.prepare('SELECT id FROM agent_skills WHERE uid = ?').get(uid) as any;
  const cases = w.db.prepare('SELECT id FROM agent_skill_cases WHERE skill_id = ? AND removed_at IS NULL ORDER BY id').all(s.id) as any[];
  for (const k of cases.slice(0, 9)) {
    w.db.prepare(`INSERT INTO agent_skill_eval_results (case_id, skill_id, draft_hash, model_id, result, run_by, evidence_hash) VALUES (?, ?, ?, ?, 'pass', ?, ?)`)
      .run(k.id, s.id, f0.evidence.definition_hash, m2, SUPER, f0.evidence.evidence_hash);
  }
  const d = await detail(w, uid);
  const cell = d.evals.cases[9].results.find((r: any) => r.model === m2);
  // Mutation checked: `summarise` giving a missing cell 'pass' → the cell reads pass and this fails.
  assert.deepEqual([cell.result, cell.run_at], ['not_evaluated', null]);
  assert.deepEqual(d.evals.models, [m1, m2], 'the required set, not the models with results');
  assert.deepEqual([d.evals.pass, d.evals.total, d.evals.not_evaluated, d.evals.meets_bar], [19, 20, 1, false]);
  assert.deepEqual(d.freshness.blocking, ['evaluation_incomplete']);
  const refused = await publish(w, uid);
  // Mutation checked: the `evaluation_incomplete` check dropped from `releaseEvidence` → 19 of 20 publishes and this fails.
  assert.deepEqual([refused.status, refused.body.error, refused.body.not_evaluated, refused.body.total], [409, 'evaluation_incomplete', 1, 20]);
  const list = (await call(w, SUPER, 'GET', HQ)).body.skills.find((k: any) => k.uid === uid);
  assert.deepEqual(list.golden, { pass: 19, total: 20, not_evaluated: 1, meets_bar: false }, 'the library agrees');
  // Mutation checked: Re-run evals without a choice running the old default five → m2 stays not evaluated and this fails.
  await evals(w, uid);
  assert.equal((await publish(w, uid)).status, 200);
});

test('D4533: the freshness decision in the publish reply is the one that gates publish', async () => {
  const w = world();
  stubRun();
  const [m1] = offered(w);
  const uid = await newSkill(w, [m1]);
  await setCases(w, uid, [goldenCase(0, 'MRR 41,200'), goldenCase(1, 'MRR unknown')]);
  const s = () => w.db.prepare('SELECT * FROM agent_skills WHERE uid = ?').get(uid) as any;
  const gate = async () => releaseDecision(w.env, s(), await draftPartsOf(w.env, s()));
  for (const step of ['unapproved', 'not evaluated', 'below the bar'] as const) {
    if (step === 'not evaluated') await approve(w, uid);
    if (step === 'below the bar') await evals(w, uid);
    const refused = await publish(w, uid);
    assert.equal(refused.status, 409, step);
    // Mutation checked: `freshness` dropped from `publishRefusalOf`'s extra → undefined here and this fails.
    assert.deepEqual(refused.body.freshness, JSON.parse(JSON.stringify(await gate())), `${step}: the refusal carries the gate's decision`);
    assert.deepEqual(refused.body.freshness, (await detail(w, uid)).freshness, `${step}: and GET /:uid answers the same`);
    assert.equal(refused.body.error, refused.body.freshness.blocking[0], step);
  }
  await setCases(w, uid, [{ ...goldenCase(0, ''), uid: liveUids(w, uid)[0] }]);
  await approve(w, uid);
  await evals(w, uid);
  const before = (await detail(w, uid)).freshness;
  const ok = await publish(w, uid);
  assert.equal(ok.status, 200, ok.text);
  assert.deepEqual([ok.body.freshness, ok.body.freshness.ready], [before, true]);
});

test('D4533: the published version keeps its manifest, and the diff shows case-suite and model changes', async () => {
  const w = world();
  const [m1, m2] = offered(w);
  const uid = await ready(w, [m1], 2);
  const f = (await detail(w, uid)).freshness;
  assert.equal((await publish(w, uid)).status, 200);
  const v1 = w.db.prepare('SELECT v.* FROM agent_skill_versions v JOIN agent_skills s ON s.id = v.skill_id WHERE s.uid = ? AND v.version = 1').get(uid) as any;
  // Mutation checked: `manifest` not written by `publishDraft` → evidence_json is null and this fails.
  const m = JSON.parse(v1.evidence_json);
  assert.deepEqual([m.manifest, m.version, m.definition_hash, m.evidence_hash, m.suite, m.evaluator_version, m.models],
    [1, 1, f.evidence.definition_hash, f.evidence.evidence_hash, f.evidence.suite, JUDGE_VERSION, { required: [m1], source: 'declared' }]);
  assert.deepEqual(m.results.map((r: any) => [r.case_uid, r.model, r.result]), liveUids(w, uid).map((k) => [k, m1, 'pass']));
  const ids = (w.db.prepare("SELECT id FROM agent_skill_eval_results WHERE result = 'pass' ORDER BY id").all() as any[]).map((r) => r.id);
  assert.ok(m.results.every((r: any) => ids.includes(r.result_id)), 'each counted result is named by its row');
  const review = w.db.prepare("SELECT id, reviewer_id FROM agent_skill_reviews WHERE status = 'approved'").get() as any;
  assert.deepEqual([m.review.review_id, m.review.reviewer_id, m.bar.pass, m.bar.total], [review.id, SUPER2, 2, 2]);
  const shown = (await detail(w, uid)).versions[0].evidence;
  assert.deepEqual([shown.evidence_hash, shown.review.reviewer], [f.evidence.evidence_hash, { uid: 'u-super2', name: 'Rex Reviewer' }]);
  assert.doesNotMatch(JSON.stringify(shown), /@example\.test/);

  // The next draft: one case replaced, a model added. The reviewer sees both beside the definition.
  const [a, b] = liveUids(w, uid);
  await setCases(w, uid, [{ ...goldenCase(0, ''), uid: a }, goldenCase(5, 'MRR 41,200')]);
  await call(w, SUPER, 'PUT', `${HQ}/${uid}/models`, { models: [m1, m2], reason: WHY });
  const d = await call(w, SUPER, 'GET', `${HQ}/${uid}/diff?from=v1&to=draft`);
  assert.equal(d.status, 200, d.text);
  const added = liveUids(w, uid)[1];
  // Mutation checked: `diffEvidence`'s added and removed swapped → this fails.
  assert.deepEqual(d.body.evidence.cases.added, [{ uid: added, name: 'Case 5' }]);
  assert.deepEqual(d.body.evidence.cases.removed, [{ uid: b, name: 'Case 1' }]);
  assert.deepEqual(d.body.evidence.models, { from: [m1], to: [m1, m2].sort(), added: [m2], removed: [] });
  assert.deepEqual([d.body.evidence.recorded, d.body.evidence.evaluator], [{ from: true, to: true }, { from: JUDGE_VERSION, to: JUDGE_VERSION }]);
  assert.deepEqual([d.body.frontmatter, d.body.steps.every((x: any) => x.op === 'same')], [[], true], 'the definition did not change');
  // The v1 row is exactly as published.
  assert.deepEqual(w.db.prepare('SELECT * FROM agent_skill_versions WHERE id = ?').get(v1.id), v1);
});

test('D4533: a historical release has no manifest: it stays published and pinned, reads null, and the next one needs full evidence', async () => {
  const w = world();
  stubRun();
  const [m1] = offered(w);
  const uid = await newSkill(w, [m1]);
  await setCases(w, uid, [goldenCase(0, 'MRR 41,200')]);
  const s = w.db.prepare('SELECT * FROM agent_skills WHERE uid = ?').get(uid) as any;
  const parts = await draftPartsOf(w.env, s);
  // As D4160 left it: v1 with no evidence, an approval and a result bound only to the draft hash.
  w.db.prepare(`INSERT INTO agent_skill_versions (skill_id, version, skill_md, name, purpose, steps_json, allowed_tools_json, output_kind, taxonomy_json, roles_json, published_by)
    VALUES (?, 1, '---', ?, ?, ?, ?, 'draft', '[]', '["cfo"]', ?)`).run(s.id, s.name, s.purpose, s.steps_json, s.allowed_tools_json, SUPER);
  w.db.prepare("UPDATE agent_skills SET status = 'published', current_version = 1 WHERE id = ?").run(s.id);
  const hash = (await releaseDecision(w.env, s, parts)).evidence.definition_hash;
  w.db.prepare("INSERT INTO agent_skill_reviews (skill_id, draft_hash, requested_by, reviewer_id, status, decided_at) VALUES (?, ?, ?, ?, 'approved', CURRENT_TIMESTAMP)").run(s.id, hash, SUPER, SUPER2);
  const k = w.db.prepare('SELECT id FROM agent_skill_cases WHERE skill_id = ?').get(s.id) as any;
  w.db.prepare("INSERT INTO agent_skill_eval_results (case_id, skill_id, draft_hash, model_id, result, run_by) VALUES (?, ?, ?, ?, 'pass', ?)").run(k.id, s.id, hash, m1, SUPER);

  const d = await detail(w, uid);
  assert.deepEqual([d.skill.status, d.skill.version, d.versions[0].evidence], ['published', 1, null], 'no manifest is null, never a pass');
  assert.deepEqual(d.review.history[0].changes, { definition: false, cases: null, evaluator: null, models: null }, 'what the old review saw is not recorded');
  const diff = await call(w, SUPER, 'GET', `${HQ}/${uid}/diff?from=v1&to=draft`);
  assert.deepEqual([diff.body.evidence.recorded, diff.body.evidence.cases, diff.body.evidence.models, diff.body.evidence.evaluator],
    [{ from: false, to: true }, null, null, { from: null, to: JUDGE_VERSION }]);
  // Mutation checked: `approvalFor` back on `draft_hash` → the old approval counts and this is `evaluation_incomplete`.
  assert.deepEqual(d.freshness.blocking, ['needs_approval', 'evaluation_incomplete', 'golden_cases_failing'], 'the old approval and result count for nothing new');
  assert.equal((await publish(w, uid)).body.error, 'needs_approval');
  await approve(w, uid);
  await evals(w, uid);
  const v2 = await publish(w, uid);
  assert.equal(v2.status, 200, v2.text);
  const rows = w.db.prepare('SELECT version, evidence_json FROM agent_skill_versions WHERE skill_id = ? ORDER BY version').all(s.id) as any[];
  assert.deepEqual(rows.map((r) => [r.version, r.evidence_json == null]), [[1, true], [2, false]], 'v1 untouched, v2 with its manifest');
  assert.equal(Number((w.db.prepare('SELECT COUNT(*) AS n FROM agent_skill_eval_results WHERE evidence_hash IS NULL').get() as any).n), 1, 'the old result is kept');
});

test('D4533: versions, cases, results and decided reviews are never rewritten or deleted', async () => {
  const w = world();
  const [m1] = offered(w);
  const uid = await ready(w, [m1]);
  assert.equal((await publish(w, uid)).status, 200);
  const db = w.db;
  // Mutation checked (each): the migration's trigger dropped → that write lands and its assert fails.
  assert.throws(() => db.exec("UPDATE agent_skill_versions SET name = 'changed'"), /immutable/);
  assert.throws(() => db.exec("UPDATE agent_skill_versions SET evidence_json = NULL"), /immutable/);
  assert.throws(() => db.exec('DELETE FROM agent_skill_versions'), /kept/);
  assert.throws(() => db.exec("UPDATE agent_skill_eval_results SET result = 'fail'"), /immutable/);
  assert.throws(() => db.exec('DELETE FROM agent_skill_eval_results'), /kept/);
  assert.throws(() => db.exec(`UPDATE agent_skill_cases SET expect_json = '{}'`), /immutable/);
  assert.throws(() => db.exec('DELETE FROM agent_skill_cases'), /kept/);
  assert.throws(() => db.exec("UPDATE agent_skill_reviews SET comment = 'rewritten'"), /final/);
  await askReview(w, uid);
  assert.throws(() => db.exec(`UPDATE agent_skill_reviews SET evidence_hash = '${'0'.repeat(64)}' WHERE status = 'requested'`), /keep what they were asked on/);
  assert.throws(() => db.exec(`UPDATE agent_skill_reviews SET draft_hash = '${'0'.repeat(64)}' WHERE status = 'requested'`), /keep what they were asked on/);
  // A case's one change: removed, once.
  const k = db.prepare('SELECT id FROM agent_skill_cases ORDER BY id LIMIT 1').get() as any;
  db.prepare('UPDATE agent_skill_cases SET removed_at = CURRENT_TIMESTAMP WHERE id = ?').run(k.id);
  assert.throws(() => db.prepare('UPDATE agent_skill_cases SET removed_at = NULL WHERE id = ?').run(k.id), /immutable/);
  assert.equal(Number((db.prepare('SELECT COUNT(*) AS n FROM agent_skill_versions').get() as any).n), 1);
});

test('D4533: a simultaneous publish, and no failed publish leaves a pointer without its version row', async () => {
  const w = world();
  const [m1] = offered(w);
  const pointerWithoutRow = () => Number((w.db.prepare(`SELECT COUNT(*) AS n FROM agent_skills s WHERE s.current_version > 0
    AND NOT EXISTS (SELECT 1 FROM agent_skill_versions v WHERE v.skill_id = s.id AND v.version = s.current_version)`).get() as any).n);
  // Two presses at once: one version, one conflict.
  const uid = await ready(w, [m1]);
  const both = await Promise.all([publish(w, uid), publish(w, uid)]);
  assert.deepEqual(both.map((r) => r.status).sort(), [200, 409]);
  assert.equal(both.find((r) => r.status === 409)!.body.error, 'publish_conflict');
  assert.equal(Number((w.db.prepare('SELECT COUNT(*) AS n FROM agent_skill_versions').get() as any).n), 1);

  // The version row cannot be written: the pointer stays where it was.
  const next = await ready(w, [m1], 1);
  w.db.exec(`CREATE TEMP TRIGGER fail_version BEFORE INSERT ON agent_skill_versions BEGIN SELECT RAISE(ABORT, 'disk full'); END;`);
  const failed = await publish(w, next);
  w.db.exec('DROP TRIGGER fail_version');
  assert.deepEqual([failed.status, failed.body.error], [409, 'publish_conflict']);
  const row = w.db.prepare('SELECT status, current_version FROM agent_skills WHERE uid = ?').get(next) as any;
  // Mutation checked: the pointer UPDATE run on its own before the batch → it lands without its row and this fails.
  assert.deepEqual([row.status, row.current_version], ['draft', 0]);
  assert.equal(pointerWithoutRow(), 0);
  assert.equal((await publish(w, next)).status, 200, 'the next press publishes v1');
  assert.equal(pointerWithoutRow(), 0);
});

test('D4533: the HQ author never approves their own draft, on any evidence', async () => {
  const w = world();
  stubRun();
  const [m1] = offered(w);
  const uid = await newSkill(w, [m1]);
  await setCases(w, uid, [goldenCase(0, 'MRR 41,200')]);
  await askReview(w, uid);
  // Mutation checked: the `self_approval` line dropped → SUPER reaches `not_reviewer` and this fails.
  assert.equal((await call(w, SUPER, 'POST', `${HQ}/${uid}/review/approve`, {})).body.error, 'self_approval');
  assert.equal((await call(w, SUPER3, 'POST', `${HQ}/${uid}/review/approve`, {})).body.error, 'not_reviewer');
  // The reviewer who edits the draft becomes its author.
  await call(w, SUPER2, 'PATCH', `/api/teams/skills/${uid}`, { purpose: 'From recorded metrics, a draft monthly update for investors.' });
  assert.equal((await call(w, SUPER2, 'POST', `${HQ}/${uid}/review`, { reviewer_uid: 'u-super2' })).body.error, 'reviewer_is_author');
  const r = await call(w, SUPER, 'POST', `${HQ}/${uid}/review`, { reviewer_uid: 'u-super2' });
  assert.equal(r.body.error, 'reviewer_is_author');
  assert.equal(Number((w.db.prepare("SELECT COUNT(*) AS n FROM agent_skill_reviews WHERE status = 'approved'").get() as any).n), 0);
});

test('D4533: a company skill keeps its own rules: no HQ review, evaluation or manifest', async () => {
  const w = world();
  const co = await call(w, EDITOR, 'POST', '/api/teams/skills', draft({ scope: 'company', company: 'co-uid-1', name: 'Acme brief' }));
  assert.equal(co.status, 201, co.text);
  const uid = co.body.skill.uid;
  // Mutation checked: `publishDraft`'s `s.scope === 'hq'` gate applied to every skill → this is 409 needs_approval and fails.
  const pub = await call(w, EDITOR, 'POST', `/api/teams/skills/${uid}/publish`);
  assert.deepEqual([pub.status, pub.body.freshness], [200, null]);
  const v = w.db.prepare('SELECT v.evidence_json FROM agent_skill_versions v JOIN agent_skills s ON s.id = v.skill_id WHERE s.uid = ?').get(uid) as any;
  assert.equal(v.evidence_json, null);
  // HQ's lifecycle routes do not reach a company skill, and a company editor cannot reach HQ's.
  assert.equal((await call(w, SUPER, 'PUT', `${HQ}/${uid}/models`, { models: [offered(w)[0]], reason: WHY })).status, 404);
  assert.equal((await call(w, EDITOR, 'PUT', `${HQ}/${uid}/models`, { models: [offered(w)[0]], reason: WHY })).status, 403);
  // Its own editor publishes the next version too; a Super Admin who is not its editor does not.
  await call(w, EDITOR, 'PATCH', `/api/teams/skills/${uid}`, { purpose: 'A brief for Acme, monthly.' });
  assert.equal((await call(w, EDITOR, 'POST', `/api/teams/skills/${uid}/publish`)).status, 200);
});
