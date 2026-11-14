// D5325 (#5325) — the Skill Library v2 backend (D4956): readiness in both list reads, tools in the HQ list with a
// bounded number of queries, and the draft version check on PATCH /api/teams/skills/:uid.
//
//   1. readinessOf: each of the ten states, and every fact it cannot read is `unknown`, never a passing state.
//   2. One skill walked through the lifecycle reads the same state in the HQ list and the Team list at every step.
//   3. A failed read is `unknown` in both lists; a company or retired skill is still decided from its status.
//   4. The HQ list returns each row's tools and readiness in the same number of queries for 2 skills as for 40;
//      so does the Team list.
//   5. PATCH: a stale `expected_draft_hash` is 409 `draft_conflict` and changes nothing; a current one saves and
//      answers the new `draft_hash`; none is accepted (existing callers); a malformed one is 400; a change landing
//      between the read and the write is refused by the guard inside the batch.
//
// Real SQLite, the same migrations as hq_skill_lifecycle_d4160.test.ts. Synthetic records; no model runs.
//
//   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
//     --test cloudflare-worker/test/skill_library_v2_backend_5325.test.ts
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
import { READINESS, readinessOf, type ReadinessFacts } from '../src/services/agents/skillReadiness.ts';

const sql = (f: string) => readFileSync(new URL(`../sql/${f}`, import.meta.url), 'utf8');
const BASELINE = sql('schema_baseline.sql');
const SUPER = 1, ADMIN = 2, SUPER2 = 3, EDITOR = 10, MEMBER = 11;
const HQ = '/api/admin/ai-agents/skills';
const TEAM = '/api/teams/skills';

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
  db.exec(sql('migrations/202611022326_agent_skill_context_tokens.sql'));
  db.exec(sql('migrations/202611022055_agent_skill_moderation.sql'));
  db.exec(sql('migrations/202611022140_hq_skill_lifecycle.sql'));
  db.exec(sql('migrations/202611090904_skill_eval_result_identity.sql'));
  db.exec(sql('migrations/202611081919_skill_release_evidence.sql'));
  db.exec(sql('migrations/202611092030_skill_version_release_note.sql'));
  const user = db.prepare("INSERT INTO users (id, uid, email, name, role, founder_id, subscription_tier, subscription_status) VALUES (?, ?, ?, ?, ?, ?, 'growth', 'active')");
  user.run(SUPER, 'u-super', 'super@example.test', 'Sue Super', 'admin', null);
  user.run(ADMIN, 'u-admin', 'admin@example.test', 'Ada Admin', 'admin', null);
  user.run(SUPER2, 'u-super2', 'super2@example.test', 'Rex Reviewer', 'admin', null);
  user.run(EDITOR, 'u-editor', 'editor@example.test', 'Eve Editor', 'founder', 100);
  user.run(MEMBER, 'u-member', 'member@example.test', 'Max Member', 'founder', 101);
  for (const id of [SUPER, SUPER2]) db.prepare('INSERT INTO super_admins (user_id) VALUES (?)').run(id);
  db.exec(`INSERT INTO company_profiles (id, uid, company_name) VALUES (1, 'co-uid-1', 'Acme')`);
  db.prepare("INSERT INTO user_company_links (uid, user_id, company_id, role_in_company) VALUES ('l1', ?, 1, 'Founder')").run(EDITOR);
  db.prepare("INSERT INTO user_company_links (uid, user_id, company_id, role_in_company) VALUES ('l2', ?, 1, 'Member')").run(MEMBER);
  db.exec(`INSERT INTO skills (slug, category_slug, label) VALUES ('investor_reporting', 'finance_ops', 'Investor reporting')`);
  const env: any = { DB, JWT_SECRET: 'd5325-fixture-only-secret', ENVIRONMENT: 'development', TEAM_AGENTS_ENABLED: 'true' };
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

const anyModel = (w: W) => agentModels(w.env, { id: SUPER, role: 'admin', is_super_admin: 1, subscription_tier: 'growth', subscription_status: 'active' } as any)
  .filter((m) => !m.plan_locked)[0]!.id;
const draft = (over: Record<string, unknown> = {}) => ({
  scope: 'hq', name: 'Draft the monthly investor update', purpose: 'From recorded metrics, a draft update for investors.',
  steps: ['Read the recorded metrics', 'Write the highlights'], tools: ['stripe.read'], output_kind: 'draft', roles: ['cfo'],
  tags: [{ slug: 'investor_reporting', level: 'proficient' }], ...over,
});
async function newSkill(w: W, over: Record<string, unknown> = {}) {
  const r = await call(w, over.scope === 'company' ? EDITOR : SUPER, 'POST', TEAM, draft(over));
  assert.equal(r.status, 201, r.text);
  const uid = r.body.skill.uid as string;
  if (over.scope !== 'company') assert.equal((await call(w, SUPER, 'PUT', `${HQ}/${uid}/models`, { models: [anyModel(w)], reason: 'The models this skill must pass on.' })).status, 200);
  return uid;
}
const goldenCase = (i: number) => ({
  name: `Case ${i}`, input: { records: { 'stripe.read': { mrr_usd: 41200 } } },
  expect: { output: 'draft', must_include: ['41,200'], must_say_not_recorded: [], must_not_include: ['guaranteed'] },
});
/** Results recorded on the draft's CURRENT evidence, as `POST /:uid/evals` records them, one per live case in order. */
async function record(w: W, uid: string, results: Array<'pass' | 'fail'>) {
  const detail = await call(w, SUPER, 'GET', `${HQ}/${uid}`);
  assert.equal(detail.status, 200, detail.text);
  const { id } = w.db.prepare('SELECT id FROM agent_skills WHERE uid = ?').get(uid) as { id: number };
  const cases = w.db.prepare('SELECT id FROM agent_skill_cases WHERE skill_id = ? AND removed_at IS NULL ORDER BY id').all(id) as { id: number }[];
  results.forEach((result, i) => {
    w.db.prepare(`INSERT INTO agent_skill_eval_results (case_id, skill_id, draft_hash, model_id, result, run_by, evidence_hash) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(cases[i]!.id, id, detail.body.skill.draft_hash, anyModel(w), result, SUPER, detail.body.freshness.evidence.evidence_hash);
  });
}
async function hqRow(w: W, uid: string) {
  const r = await call(w, SUPER, 'GET', HQ);
  assert.equal(r.status, 200, r.text);
  return r.body.skills.find((s: any) => s.uid === uid);
}
async function teamCard(w: W, uid: string, who = SUPER) {
  const r = await call(w, who, 'GET', `${TEAM}?company=co-uid-1`);
  assert.equal(r.status, 200, r.text);
  return [...r.body.hq, ...(r.body.company?.skills ?? [])].find((s: any) => s.uid === uid);
}
/** Both lists, asserted to agree: the server has one answer. */
async function readiness(w: W, uid: string): Promise<string> {
  const [hq, team] = await Promise.all([hqRow(w, uid), teamCard(w, uid)]);
  assert.equal(hq.readiness, team.readiness, 'the HQ list and the Team list give one readiness');
  return hq.readiness;
}

// ── 1. The decision ─────────────────────────────────────────────────────────

const facts = (over: Partial<ReadinessFacts> = {}, history: Partial<NonNullable<ReadinessFacts['history']>> = {}): ReadinessFacts => ({
  scope: 'hq', status: 'draft', live_cases: 5, models: 2, results: { recorded: 10, pass: 10, last_run: '2026-11-10 09:00:00' },
  history: { open_current: false, open_older: false, changes_requested_current: false, approved_current: false, approved_older: false, older_runs: false, ...history },
  ...over,
});

test('readinessOf: each of the ten states from its source', () => {
  // Mutation checked: each line fails when its branch in readinessOf is removed or reordered.
  assert.equal(readinessOf(facts()), 'draft');
  assert.equal(readinessOf(facts({ scope: 'company', live_cases: 0, results: null, history: null })), 'draft', 'a company draft has no cases or review');
  assert.equal(readinessOf(facts({ live_cases: 0, results: { recorded: 0, pass: 0, last_run: null } })), 'missing_cases');
  assert.equal(readinessOf(facts({ results: { recorded: 0, pass: 0, last_run: null } })), 'needs_evaluation');
  assert.equal(readinessOf(facts({ results: { recorded: 9, pass: 9, last_run: null } })), 'needs_evaluation', 'one required run without a result');
  assert.equal(readinessOf(facts({ results: { recorded: 10, pass: 8, last_run: null } })), 'failing');
  assert.equal(readinessOf(facts({ results: { recorded: 10, pass: 9, last_run: null } })), 'draft', '9 of 10 meets the bar');
  assert.equal(readinessOf(facts({ results: { recorded: 0, pass: 0, last_run: null } }, { older_runs: true })), 'stale', 'runs only on an older draft');
  assert.equal(readinessOf(facts({}, { approved_older: true })), 'stale', 'approval only on an older draft');
  assert.equal(readinessOf(facts({}, { open_older: true })), 'stale', 'a review left open on an older draft');
  assert.equal(readinessOf(facts({}, { open_current: true })), 'in_review');
  assert.equal(readinessOf(facts({ status: 'published' }, { open_current: true })), 'in_review', 'lifecycleStatus: a published skill under review');
  assert.equal(readinessOf(facts({}, { changes_requested_current: true })), 'changes_requested');
  assert.equal(readinessOf(facts({}, { approved_current: true })), 'ready_to_publish');
  assert.equal(readinessOf(facts({ results: { recorded: 10, pass: 8, last_run: null } }, { approved_current: true })), 'failing', 'an approval never lifts a failing draft');
  assert.equal(readinessOf(facts({ status: 'published' })), 'published');
  assert.equal(readinessOf(facts({ status: 'published', scope: 'company', history: null })), 'published');
  assert.equal(readinessOf(facts({ status: 'retired', history: null, results: null })), 'retired');
  assert.deepEqual([...READINESS].sort(), ['changes_requested', 'draft', 'failing', 'in_review', 'missing_cases', 'needs_evaluation', 'published', 'ready_to_publish', 'retired', 'stale', 'unknown']);
});

test('readinessOf: a fact it cannot read is unknown, never a passing state', () => {
  assert.equal(readinessOf(facts({ history: null })), 'unknown', 'reviews unread');
  assert.equal(readinessOf(facts({ status: 'published', history: null })), 'unknown', 'a published skill whose review could not be read');
  assert.equal(readinessOf(facts({ results: null })), 'unknown', 'results unread');
  assert.equal(readinessOf(facts({ results: null }, { approved_current: true })), 'unknown', 'an approval without readable results is not ready');
  assert.equal(readinessOf(facts({ models: 0 })), 'unknown', 'no required model: nothing can be evaluated');
  assert.equal(readinessOf(facts({ status: 'archived' })), 'unknown');
  assert.equal(readinessOf(facts({ scope: 'project' })), 'unknown');
});

// ── 2. The lists ────────────────────────────────────────────────────────────

test('one Axal skill through its lifecycle reads the same state in the HQ list and the Team list', async () => {
  const w = world();
  const uid = await newSkill(w);
  assert.equal(await readiness(w, uid), 'missing_cases');

  assert.equal((await call(w, SUPER, 'PUT', `${HQ}/${uid}/cases`, { reason: 'The golden cases for this skill.', cases: [goldenCase(0), goldenCase(1)] })).status, 200);
  assert.equal(await readiness(w, uid), 'needs_evaluation');
  await record(w, uid, ['pass']);
  assert.equal(await readiness(w, uid), 'needs_evaluation', 'one of two required runs');
  await record(w, uid, ['pass', 'fail']);
  assert.equal(await readiness(w, uid), 'failing', '1 of 2 is below 9 of 10');
  assert.equal((await hqRow(w, uid)).golden.meets_bar, false);
  await record(w, uid, ['pass', 'pass']);
  assert.equal(await readiness(w, uid), 'draft', 'at the bar, never sent for review');

  assert.equal((await call(w, SUPER, 'POST', `${HQ}/${uid}/review`, { reviewer_uid: 'u-super2' })).status, 201);
  assert.equal(await readiness(w, uid), 'in_review');
  assert.equal((await call(w, SUPER2, 'POST', `${HQ}/${uid}/review/request-changes`, { comment: 'Say Not recorded where a metric is missing.' })).status, 200);
  assert.equal(await readiness(w, uid), 'changes_requested');

  assert.equal((await call(w, SUPER, 'PATCH', `${TEAM}/${uid}`, { purpose: 'From recorded metrics, a draft update; Not recorded where missing.' })).status, 200);
  assert.equal(await readiness(w, uid), 'stale', 'the runs were on the earlier draft');
  await record(w, uid, ['pass', 'pass']);
  assert.equal(await readiness(w, uid), 'draft', 'changes were asked on an earlier draft: this one needs a review');

  assert.equal((await call(w, SUPER, 'POST', `${HQ}/${uid}/review`, { reviewer_uid: 'u-super2' })).status, 201);
  assert.equal((await call(w, SUPER2, 'POST', `${HQ}/${uid}/review/approve`, { comment: 'Reads well.' })).status, 200);
  assert.equal(await readiness(w, uid), 'ready_to_publish');

  assert.equal((await call(w, SUPER, 'PATCH', `${TEAM}/${uid}`, { name: 'Draft the monthly investor update (v2)' })).status, 200);
  await record(w, uid, ['pass', 'pass']);
  assert.equal(await readiness(w, uid), 'stale', 'the approval was on the earlier draft');
  assert.equal((await call(w, SUPER, 'POST', `${HQ}/${uid}/review`, { reviewer_uid: 'u-super2' })).status, 201);
  assert.equal((await call(w, SUPER2, 'POST', `${HQ}/${uid}/review/approve`, { comment: 'Reads well.' })).status, 200);
  assert.equal(await readiness(w, uid), 'ready_to_publish');

  const pub = await call(w, SUPER, 'POST', `${TEAM}/${uid}/publish`);
  assert.equal(pub.status, 200, pub.text);
  assert.equal(pub.body.skill.readiness, 'published');
  assert.equal(await readiness(w, uid), 'published');
  assert.equal((await teamCard(w, uid, MEMBER)).readiness, 'published', 'a member reads the same word');

  w.db.prepare("UPDATE agent_skills SET status = 'retired' WHERE uid = ?").run(uid);
  assert.equal(await readiness(w, uid), 'retired');
});

test('a company skill is a draft, then published, from its status; a run cost is null, never 0', async () => {
  const w = world();
  const uid = await newSkill(w, { scope: 'company', company: 'co-uid-1', name: 'Acme board brief' });
  const card = await teamCard(w, uid, EDITOR);
  assert.equal(card.readiness, 'draft');
  assert.equal(card.run_cost, null);
  assert.equal((await call(w, EDITOR, 'POST', `${TEAM}/${uid}/publish`)).status, 200);
  assert.equal((await teamCard(w, uid, MEMBER)).readiness, 'published');
  const hq = await newSkill(w);
  assert.equal((await hqRow(w, hq)).run_cost, null);
});

test('a read that fails is unknown in both lists; status-decided skills keep their state', async () => {
  const w = world();
  const hq = await newSkill(w);
  assert.equal((await call(w, SUPER, 'PUT', `${HQ}/${hq}/cases`, { reason: 'The golden cases for this skill.', cases: [goldenCase(0)] })).status, 200);
  await record(w, hq, ['pass']);
  const retired = await newSkill(w, { name: 'An older update skill' });
  w.db.prepare("UPDATE agent_skills SET status = 'retired' WHERE uid = ?").run(retired);
  const company = await newSkill(w, { scope: 'company', company: 'co-uid-1', name: 'Acme board brief' });
  assert.equal(await readiness(w, hq), 'draft');

  const db = w.env.DB;
  const failing = (marker: string) => { w.env.DB = { ...db, prepare: (q: string) => { if (q.includes(marker)) throw new Error('D1_ERROR: unreadable'); return db.prepare(q); } }; };
  // Mutation checked: `history: null` → a default history in admin_hq_skills.ts reads `draft` here and fails.
  failing('AS older_runs');
  assert.equal(await readiness(w, hq), 'unknown');
  assert.equal(await readiness(w, retired), 'retired');
  assert.equal((await teamCard(w, company, EDITOR)).readiness, 'draft');
  // The Team list's results read: unknown there (the HQ list answers 500 for it, as it did before D5325).
  failing('AS recorded');
  assert.equal((await teamCard(w, hq)).readiness, 'unknown');
  w.env.DB = db;
  assert.equal(await readiness(w, hq), 'draft');
});

test('the HQ list returns tools and readiness for 2 skills and for 40 in the same number of queries; so does the Team list', async () => {
  const w = world();
  const uid = await newSkill(w, { tools: ['stripe.read'] });
  await newSkill(w, { name: 'A second update skill', tools: [] });
  const db = w.env.DB;
  let reads = 0;
  w.env.DB = { ...db, prepare: (q: string) => { reads++; return db.prepare(q); } };
  const count = async (path: string) => {
    reads = 0;
    const r = await call(w, SUPER, 'GET', path);
    assert.equal(r.status, 200, r.text);
    return { reads, body: r.body };
  };
  const smallHq = await count(HQ);
  const smallTeam = await count(TEAM);
  assert.deepEqual(smallHq.body.skills.find((s: any) => s.uid === uid).tools, ['stripe.read']);

  const insert = w.db.prepare(`INSERT INTO agent_skills (uid, scope, slug, name, purpose, steps_json, allowed_tools_json, output_kind, created_by)
    VALUES (?, 'hq', ?, ?, 'A synthetic draft.', '["Read"]', ?, 'draft', ?)`);
  for (let i = 0; i < 38; i++) insert.run(String(i).padStart(32, 'f'), `fixture-${i}`, `Fixture ${i}`, JSON.stringify(i % 2 ? ['stripe.read'] : []), SUPER);
  const largeHq = await count(HQ);
  const largeTeam = await count(TEAM);
  assert.equal(largeHq.body.skills.length, 40);
  // Mutation checked: a per-row read (e.g. `reviewHistory` called inside the row map) makes both counts grow.
  assert.equal(largeHq.reads, smallHq.reads, 'no per-row read in the HQ list');
  assert.equal(largeTeam.reads, smallTeam.reads, 'no per-row read in the Team list');
  const row = largeHq.body.skills.find((s: any) => s.slug === 'fixture-1');
  assert.deepEqual(row.tools, ['stripe.read']);
  assert.equal(row.readiness, 'missing_cases');
  assert.ok(largeHq.body.skills.every((s: any) => Array.isArray(s.tools) && READINESS.includes(s.readiness)));
});

// ── 3. The draft version check ──────────────────────────────────────────────

test('PATCH: a stale draft_hash is refused and changes nothing; a current one saves; none is accepted', async () => {
  const w = world();
  const uid = await newSkill(w);
  const loaded = (await teamCard(w, uid)).draft_hash as string;
  assert.match(loaded, /^[a-f0-9]{64}$/);
  assert.equal(loaded, (await call(w, SUPER, 'GET', `${HQ}/${uid}`)).body.skill.draft_hash, 'the HQ detail and the Team card name one version');
  assert.equal((await teamCard(w, uid, MEMBER)), undefined, 'a member never sees an HQ draft');

  // Another Super Admin's tab saves first, from the same load.
  const first = await call(w, SUPER, 'PATCH', `${TEAM}/${uid}`, { purpose: 'From recorded metrics, the update for investors.', expected_draft_hash: loaded });
  assert.equal(first.status, 200, first.text);
  const now = first.body.skill.draft_hash as string;
  assert.notEqual(now, loaded);

  const snapshot = () => ({
    row: w.db.prepare('SELECT name, purpose, steps_json, allowed_tools_json, output_kind, updated_at FROM agent_skills WHERE uid = ?').get(uid),
    tags: w.db.prepare('SELECT taxonomy_skill_slug, level FROM agent_skill_tags t JOIN agent_skills s ON s.id = t.skill_id WHERE s.uid = ? ORDER BY t.rowid').all(uid),
    roles: w.db.prepare('SELECT role_key FROM agent_skill_roles r JOIN agent_skills s ON s.id = r.skill_id WHERE s.uid = ? ORDER BY r.rowid').all(uid),
    audits: (w.db.prepare('SELECT COUNT(*) AS n FROM admin_audit_log').get() as { n: number }).n,
  });
  const before = snapshot();
  // Mutation checked: removing the `expected !== draftHash(...)` refusal saves this edit and fails here.
  const stale = await call(w, SUPER, 'PATCH', `${TEAM}/${uid}`, { name: 'My edit', tools: [], expected_draft_hash: loaded });
  assert.equal(stale.status, 409, stale.text);
  assert.equal(stale.body.error, 'draft_conflict');
  assert.equal(stale.body.draft_hash, now);
  assert.equal(stale.body.draft.purpose, 'From recorded metrics, the update for investors.');
  assert.deepEqual(stale.body.draft.tools, ['stripe.read']);
  assert.deepEqual(stale.body.updated_by, { uid: 'u-super', name: 'Sue Super' });
  assert.equal(typeof stale.body.updated_at, 'string');
  assert.deepEqual(snapshot(), before, 'nothing of the stale write was saved');

  const current = await call(w, SUPER, 'PATCH', `${TEAM}/${uid}`, { name: 'My edit', expected_draft_hash: now });
  assert.equal(current.status, 200, current.text);
  assert.equal(current.body.skill.draft.name, 'My edit');
  assert.notEqual(current.body.skill.draft_hash, now);

  // Existing callers send no version: the save is unchecked, as before.
  const unchecked = await call(w, SUPER, 'PATCH', `${TEAM}/${uid}`, { name: 'An unchecked edit' });
  assert.equal(unchecked.status, 200, unchecked.text);
  assert.equal(unchecked.body.skill.draft.name, 'An unchecked edit');

  for (const bad of ['nope', 42, null, 'A'.repeat(64)]) {
    const r = await call(w, SUPER, 'PATCH', `${TEAM}/${uid}`, { name: 'Bad', expected_draft_hash: bad });
    assert.equal(r.status, 400, r.text);
    assert.equal(r.body.error, 'draft_hash_invalid');
  }
  assert.equal((w.db.prepare('SELECT name FROM agent_skills WHERE uid = ?').get(uid) as { name: string }).name, 'An unchecked edit');
});

test('PATCH: a change that lands between the check and the write is refused by the guard inside the batch', async () => {
  const w = world();
  const uid = await newSkill(w);
  const loaded = (await teamCard(w, uid)).draft_hash as string;
  const db = w.env.DB;
  // The other writer's save lands after this request read the draft and before its batch runs.
  w.env.DB = { ...db, batch: async (stmts: unknown[]) => {
    w.env.DB = db;
    w.db.prepare("UPDATE agent_skills SET purpose = 'Another editor saved this.', updated_by = ? WHERE uid = ?").run(SUPER2, uid);
    w.db.prepare("DELETE FROM agent_skill_roles WHERE skill_id = (SELECT id FROM agent_skills WHERE uid = ?)").run(uid);
    w.db.prepare("INSERT INTO agent_skill_roles (skill_id, role_key) SELECT id, 'investor_relations' FROM agent_skills WHERE uid = ?").run(uid);
    return db.batch(stmts);
  } };
  // Mutation checked: dropping `draftGuard(...)` from the batch saves this edit over the other writer's and fails here.
  const r = await call(w, SUPER, 'PATCH', `${TEAM}/${uid}`, { name: 'Mine', expected_draft_hash: loaded });
  assert.equal(r.status, 409, r.text);
  assert.equal(r.body.error, 'draft_conflict');
  assert.deepEqual(r.body.updated_by, { uid: 'u-super2', name: 'Rex Reviewer' });
  assert.deepEqual(r.body.draft.roles.map((x: any) => x.key), ['investor_relations']);
  const row = w.db.prepare('SELECT name, purpose FROM agent_skills WHERE uid = ?').get(uid) as { name: string; purpose: string };
  assert.deepEqual({ ...row }, { name: 'Draft the monthly investor update', purpose: 'Another editor saved this.' });
  const roles = (w.db.prepare('SELECT role_key FROM agent_skill_roles r JOIN agent_skills s ON s.id = r.skill_id WHERE s.uid = ?').all(uid) as any[]).map((x) => x.role_key);
  assert.deepEqual(roles, ['investor_relations'], 'the other writer\'s roles are kept');
});
