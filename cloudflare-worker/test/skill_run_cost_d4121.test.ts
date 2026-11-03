// D4121 (#4121, Roster R5 of #4116) — what an agent's runs cost, skill by skill.
// A run carries one skill (#3954), so a skill costs its tokens on each run that
// uses it, and more skills never make one run dearer (the owner's choice, 2026-11-03).
//
//   1. context_tokens: the skill prompt a run joins, stored on publish, and
//      worked out from an older version that has no row;
//   2. each run costs the baseline plus its one skill; the agent's figure is
//      its dearest run, and add and remove move it by the right amount;
//   3. pricing that cannot be read answers { available: false }, never a 0;
//   4. the threshold: more than 6 skills names the area with the most of them
//      and an offered persona not on the team;
//   5. AG3: an agent not yet added, with its gates;
//   6. HQ's library and the team library carry each skill's tokens per run.
//
// Real SQLite with the migrations the routes read. Each case names the
// mutations it was checked against.
//
//   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
//     --test cloudflare-worker/test/skill_run_cost_d4121.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SignJWT } from 'jose';
import { Hono } from 'hono';
import { makeD1 } from './_d1_sqlite.mjs';
import { passHqGate } from './_hq_skill_gate.ts';
import { addColumnsFrom, stripForeignKeys, tableFromBaseline } from './_baseline.mjs';
import { AI_LOG_SCHEMA } from './_ai_budget_fixture.mjs';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';
import teamSkills from '../src/routes/team_skills.ts';
import teamAgents from '../src/routes/team_agents.ts';
import adminHqSkills from '../src/routes/admin_hq_skills.ts';
import { RUN_COST_CONFIG, contextTokensOf } from '../src/services/agents/runCost.ts';
import { skillPrompt } from '../src/services/agents/skillEval.ts';
import { estTokens } from '../src/services/ai/shapes.ts';

const sql = (f: string) => readFileSync(new URL(`../sql/${f}`, import.meta.url), 'utf8');
const BASELINE = sql('schema_baseline.sql');
const MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
const SUPER = 1, SECOND_SUPER = 2, EDITOR = 10, MEMBER = 11, STRANGER = 12;
const CFO = 'a'.repeat(32), UNPRICED = 'b'.repeat(32), BIG = 'c'.repeat(32);
const hex = (n: number) => n.toString(16).padStart(32, '0');

function world() {
  const { DB, db } = makeD1(
    ['users', 'company_profiles', 'user_company_links', 'projects'].map((t) => stripForeignKeys(tableFromBaseline(BASELINE, t))).join('\n')
    + AI_LOG_SCHEMA + sql('migrations/506_ai_rail_proposals.sql'),
  );
  addColumnsFrom(db, sql('migrations/597_company_archive_and_events.sql'), 'company_profiles');
  db.exec(sql('migrations/199_super_admin.sql'));
  db.exec(sql('migrations/089_skills_values_taxonomy.sql'));
  db.exec(sql('migrations/712_team_agents.sql'));
  db.exec(sql('migrations/202611021724_team_agents_persona.sql'));
  db.exec(sql('migrations/759_agent_skills.sql'));
  db.exec(sql('migrations/202611022055_agent_skill_moderation.sql'));
  db.exec(sql('migrations/202611022140_hq_skill_lifecycle.sql'));
  db.exec(sql('migrations/202611022304_ai_persona_settings.sql'));
  db.exec(sql('migrations/202611022326_agent_skill_context_tokens.sql'));
  db.exec(sql('migrations/091_user_skill_profile.sql'));
  db.exec(`CREATE TABLE project_members (id INTEGER PRIMARY KEY AUTOINCREMENT, project_id INTEGER NOT NULL, user_id INTEGER NOT NULL,
    role TEXT NOT NULL DEFAULT 'cofounder', status TEXT NOT NULL DEFAULT 'accepted', source TEXT, invited_by INTEGER, created_at TEXT, updated_at TEXT)`);
  const user = db.prepare("INSERT INTO users (id, uid, email, name, role, founder_id, subscription_tier, subscription_status) VALUES (?, ?, ?, ?, ?, ?, 'growth', 'active')");
  user.run(SUPER, 'u-super', 'super@example.test', 'Sue Super', 'admin', null);
  user.run(SECOND_SUPER, 'u-super2', 'super2@example.test', 'Sam Second', 'admin', null); // passHqGate's reviewer
  user.run(EDITOR, 'u-editor', 'editor@example.test', 'Eve Editor', 'founder', 100);
  user.run(MEMBER, 'u-member', 'member@example.test', 'Max Member', 'founder', 101);
  user.run(STRANGER, 'u-stranger', 'stranger@example.test', 'Sam Stranger', 'founder', 102);
  db.prepare('INSERT INTO super_admins (user_id) VALUES (?)').run(SUPER);
  db.exec(`INSERT INTO company_profiles (id, uid, company_name) VALUES (1, 'co-uid-1', 'Acme'), (2, 'co-uid-2', 'Globex')`);
  const link = db.prepare('INSERT INTO user_company_links (uid, user_id, company_id, role_in_company) VALUES (?, ?, ?, ?)');
  link.run('l1', EDITOR, 1, 'Founder'); link.run('l2', MEMBER, 1, 'Member');
  db.exec(`INSERT INTO skills (slug, category_slug, label) VALUES
    ('investor_reporting', 'finance_ops', 'Investor reporting'), ('fp_and_a', 'finance_ops', 'FP&A'),
    ('investor_relations', 'capital_network', 'Investor relations'), ('product_strategy', 'product', 'Product strategy')`);
  const agent = db.prepare(`INSERT INTO team_agents (id, uid, scope_kind, company_id, role_key, persona_key, first_name, model_id, tool_grants_json, sponsor_user_id, monthly_cap_microusd, created_by)
    VALUES (?, ?, 'company', 1, ?, ?, ?, ?, '[]', ${EDITOR}, 20000000, ${EDITOR})`);
  agent.run(1, CFO, 'cfo', 'vesta', 'Vesta', MODEL); // Vesta is the first persona whose natural fit is finance
  agent.run(2, UNPRICED, 'investor_relations', 'aurel', 'Aurel', 'acme/unpriced-model');
  agent.run(3, BIG, 'coo', 'tessaly', 'Tessaly', MODEL);
  const env: any = { DB, JWT_SECRET: 'd4121-fixture-only-secret', ENVIRONMENT: 'development', TEAM_AGENTS_ENABLED: 'true' };
  return { db, env };
}
type W = ReturnType<typeof world>;

/** A published HQ skill written straight into the store: one step of `chars` characters, tagged in `area`. */
function skill(w: W, id: number, chars: number, area = 'investor_reporting', { costRow = true } = {}) {
  const v = {
    version: 1, name: `Skill ${id}`, purpose: 'A purpose', steps_json: JSON.stringify(['x'.repeat(chars)]), allowed_tools_json: '[]',
    output_kind: 'draft', roles_json: '["cfo"]',
  };
  w.db.prepare(`INSERT INTO agent_skills (id, uid, scope, slug, name, purpose, steps_json, allowed_tools_json, output_kind, status, current_version, created_by)
    VALUES (?, ?, 'hq', ?, ?, 'A purpose', '[]', '[]', 'draft', 'published', 1, ${SUPER})`).run(id, hex(id), `s-${id}`, v.name);
  w.db.prepare(`INSERT INTO agent_skill_versions (skill_id, version, skill_md, name, purpose, steps_json, allowed_tools_json, output_kind, taxonomy_json, roles_json, published_by)
    VALUES (?, 1, ?, ?, 'A purpose', ?, '[]', 'draft', ?, '["cfo"]', ${SUPER})`).run(id, `---\nname: s${id}\n---\n`, v.name, v.steps_json, JSON.stringify([{ slug: area, level: 'proficient' }]));
  w.db.prepare("INSERT INTO agent_skill_tags (skill_id, taxonomy_skill_slug, level) VALUES (?, ?, 'proficient')").run(id, area);
  if (costRow) w.db.prepare('INSERT OR REPLACE INTO agent_skill_version_costs (skill_id, version, context_tokens) VALUES (?, 1, ?)').run(id, contextTokensOf(v));
  return { uid: hex(id), v, tokens: contextTokensOf(v) };
}
const pin = (w: W, agentId: number, skillId: number) => w.db.prepare(`INSERT INTO agent_skill_links (agent_id, skill_id, version, linked_by) VALUES (?, ?, 1, ${EDITOR})`).run(agentId, skillId);

function app() {
  const a = new Hono();
  a.onError((e: any, c) => {
    const status = AUTH_ERROR_STATUSES[e?.message];
    return status ? c.json({ detail: e.message }, status) : c.json({ detail: 'Internal server error', m: String(e?.message) }, 500);
  });
  a.route('/api/admin/ai-agents/skills', adminHqSkills);
  a.route('/api/teams', teamSkills);
  a.route('/api/teams', teamAgents);
  return a;
}
async function call(w: W, who: number, method: string, path: string, body?: unknown) {
  const jwt = await new SignJWT({ user_id: who }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(w.env.JWT_SECRET));
  const r = await app().request(path, { method, headers: { Authorization: `Bearer ${jwt}`, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body) }, w.env);
  const text = await r.text();
  return { status: r.status, body: (text ? JSON.parse(text) : null) as any, text };
}
const est = (w: W, agent: string, q = '', who = MEMBER) => call(w, who, 'GET', `/api/teams/agents/${agent}/cost-estimate${q}`);

test('1: context_tokens — the skill prompt a run joins, stored on publish and worked out for an older version', async () => {
  // Mutations checked: contextTokensOf measuring the SKILL.md instead of the run's prompt → the published row differs from
  // estTokens(skillPrompt) and this fails; the cost INSERT dropped from publishDraft → no row and the stored-row assert fails.
  const w = world();
  const old = skill(w, 100, 4000, 'investor_reporting', { costRow: false });
  assert.equal(old.tokens, estTokens(`\n\n${skillPrompt(old.v as any)}`), 'exactly what agentRun joins');
  assert.equal(w.db.prepare('SELECT COUNT(*) AS n FROM agent_skill_version_costs').get().n, 0, 'nothing back-filled');
  const lib = await call(w, MEMBER, 'GET', '/api/teams/skills');
  assert.equal(lib.body.hq.find((s: any) => s.uid === old.uid).context_tokens, old.tokens, 'an older version is worked out from itself');

  const made = await call(w, SUPER, 'POST', '/api/teams/skills', {
    scope: 'hq', name: 'Draft the monthly investor update', purpose: 'From recorded metrics, a draft update for investors.',
    steps: ['Read the last three months of recorded metrics', 'Write the highlights and the asks'], tools: [], output_kind: 'draft',
    roles: ['cfo'], tags: [{ slug: 'investor_reporting', level: 'proficient' }],
  });
  assert.equal(made.status, 201, made.text);
  await passHqGate(w.db, made.body.skill.uid);
  assert.equal((await call(w, SUPER, 'POST', `/api/teams/skills/${made.body.skill.uid}/publish`)).status, 200);
  const stored = w.db.prepare(`SELECT c.context_tokens, x.* FROM agent_skill_version_costs c JOIN agent_skill_versions x ON x.skill_id = c.skill_id AND x.version = c.version
    JOIN agent_skills s ON s.id = c.skill_id WHERE s.uid = ?`).get(made.body.skill.uid) as any;
  assert.ok(stored, 'the version stores its context_tokens');
  assert.equal(stored.context_tokens, estTokens(`\n\n${skillPrompt(stored)}`));
});

test('2: a run carries one skill — each run costs its own skill, and the agent\'s figure is its dearest run', async () => {
  // Mutations checked: estimate summing every skill into one run → three skills cost more than the largest alone and this fails;
  // the remove list ignored → removing the big skill leaves the dearest run unchanged and the delta assert fails.
  const w = world();
  const small = skill(w, 201, 400), mid = skill(w, 202, 4000), big = skill(w, 203, 20000);
  const none = await est(w, CFO);
  assert.equal(none.status, 200, none.text);
  assert.equal(none.body.available, true);
  assert.equal(none.body.skills, 0);
  assert.deepEqual(none.body.runs, []);
  assert.equal(none.body.tokens_per_run, none.body.baseline.tokens_per_run, 'no skill: every run is the baseline');
  assert.ok(none.body.baseline.tokens_per_run > RUN_COST_CONFIG.requestTokens + RUN_COST_CONFIG.outputTokens, 'the system prompt counts');

  const three = await est(w, CFO, `?add=${small.uid},${mid.uid}&add=${big.uid}`);
  const byUid = Object.fromEntries(three.body.runs.map((r: any) => [r.skill_uid, r]));
  assert.equal(byUid[small.uid].tokens_per_run, none.body.baseline.tokens_per_run + small.tokens, 'a run with a skill is the baseline plus that skill');
  assert.equal(byUid[big.uid].tokens_per_run, none.body.baseline.tokens_per_run + big.tokens);
  assert.ok(byUid[small.uid].est_usd_per_run < byUid[mid.uid].est_usd_per_run && byUid[mid.uid].est_usd_per_run < byUid[big.uid].est_usd_per_run, 'monotonic in the skill\'s size');
  assert.equal(three.body.tokens_per_run, byUid[big.uid].tokens_per_run, 'the dearest run');
  assert.equal(three.body.cheapest.tokens_per_run, byUid[small.uid].tokens_per_run, 'the cheapest run');
  const bigAlone = await est(w, CFO, `?add=${big.uid}`);
  assert.equal(bigAlone.body.tokens_per_run, three.body.tokens_per_run, 'more skills do not make any run dearer');
  assert.ok(three.body.monthly_at_cap < none.body.monthly_at_cap);
  assert.equal(three.body.cap_usd, 20);

  pin(w, 1, 202); pin(w, 1, 203);
  const now = await est(w, CFO);
  const off = await est(w, CFO, `?remove=${big.uid}`);
  assert.equal(now.body.skills, 2);
  assert.equal(off.body.skills, 1);
  assert.equal(off.body.tokens_per_run, none.body.baseline.tokens_per_run + mid.tokens);
  assert.equal(off.body.delta.tokens_per_run, off.body.tokens_per_run - now.body.tokens_per_run);
  assert.ok(off.body.delta.est_usd_per_run < 0);
  const addSmall = await est(w, CFO, `?add=${small.uid}`);
  assert.equal(addSmall.body.delta.tokens_per_run, 0, 'a smaller skill leaves the dearest run where it was');
  assert.equal(addSmall.body.delta.skills, 1);
  assert.equal((await est(w, CFO, `?add=${big.uid}`)).body.skills, 2, 'adding a skill it has changes nothing');
});

test('3: pricing that cannot be read is { available: false }, never a 0', async () => {
  // Mutation checked: priceMicro returning 0 for an unknown model → the unpriced agent answers $0 and this fails.
  const w = world();
  const s = skill(w, 301, 2000);
  const r = await est(w, UNPRICED, `?add=${s.uid}`);
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { available: false, reason: 'pricing_unreadable' });
  assert.doesNotMatch(r.text, /est_usd_per_run|tokens_per_run/);
  w.db.exec('DROP TABLE agent_skill_versions');
  const t = await est(w, CFO, `?add=${s.uid}`);
  assert.equal(t.body.available, false, 'unreadable skills are not a 0 either');
});

test('4: the threshold — more than 6 skills suggests a specialist for the area with the most of them', async () => {
  // Mutations checked: specialistMaxSkills 6 → 60 → seven skills give no hint and this fails;
  // the "not on the team" filter dropped → Vesta (already on the team) is suggested and the persona assert fails.
  const w = world();
  assert.equal(RUN_COST_CONFIG.specialistMaxSkills, 6);
  const uids = [401, 402, 403, 404, 405, 406, 407].map((id) => skill(w, id, 40, id === 407 ? 'investor_relations' : 'fp_and_a').uid);
  const six = await est(w, CFO, `?add=${uids.slice(0, 6).join(',')}`);
  assert.equal(six.body.hint, null, 'six skills: no hint');
  const seven = await est(w, CFO, `?add=${uids.join(',')}`);
  assert.deepEqual(seven.body.hint, { reason: 'skills', area: 'finance', areas: 2, suggest: { key: 'orrin', name: 'Orrin' } },
    'Vesta, the first finance persona, is already on this team: the next offered one is named');
  assert.deepEqual(seven.body.thresholds, { max_skills: 6 });
  // Hidden or retired personas (D4158) are never suggested.
  w.db.exec("INSERT INTO ai_persona_settings (persona_key, status) VALUES ('orrin', 'hidden')");
  assert.notEqual((await est(w, CFO, `?add=${uids.join(',')}`)).body.hint.suggest?.key, 'orrin');
});

test('5: gates — a team member reads, a stranger does not; AG3 estimates an agent not yet added', async () => {
  // Mutation checked: the scope route's canRead dropped → the stranger is answered 200 and this fails.
  const w = world();
  const s = skill(w, 501, 3000).uid;
  assert.equal((await est(w, CFO, '', STRANGER)).status, 404);
  assert.equal((await est(w, CFO, '?add=not-a-uid')).status, 400);
  assert.equal((await est(w, CFO, `?add=${hex(999)}`)).status, 404);
  const draft = (q: string, who = MEMBER) => call(w, who, 'GET', `/api/teams/company/co-uid-1/cost-estimate${q}`);
  const ok = await draft(`?model=${encodeURIComponent(MODEL)}&role=cfo&persona=sylva&skills=${s}&cap_microusd=20000000`);
  assert.equal(ok.status, 200, ok.text);
  assert.equal(ok.body.available, true);
  assert.equal(ok.body.skills, 1);
  assert.deepEqual(ok.body.delta.skills, 1);
  assert.equal(ok.body.cap_usd, 20);
  assert.equal((await draft(`?model=${encodeURIComponent(MODEL)}&role=cfo`, STRANGER)).status, 403);
  assert.equal((await draft('?model=nope&role=cfo')).body.error, 'model_not_offered');
  assert.equal((await draft(`?model=${encodeURIComponent(MODEL)}&role=nobody`)).body.error, 'role_unknown');
  const noCap = await draft(`?model=${encodeURIComponent(MODEL)}&role=cfo`);
  assert.equal(noCap.body.monthly_at_cap, null, 'no cap yet: not a 0');
  assert.doesNotMatch(ok.text, /@example\.test/);
});

test('6: HQ\'s library and the team library carry each skill\'s tokens per run', async () => {
  // Mutation checked: admin_hq_skills back to tokens_per_run: null → the HQ row reads null and this fails.
  const w = world();
  const { uid, tokens } = skill(w, 601, 4800);
  const hq = await call(w, SUPER, 'GET', '/api/admin/ai-agents/skills');
  assert.equal(hq.status, 200, hq.text);
  assert.equal(hq.body.skills.find((s: any) => s.uid === uid).tokens_per_run, tokens);
  const lib = await call(w, MEMBER, 'GET', '/api/teams/skills');
  assert.equal(lib.body.hq.find((s: any) => s.uid === uid).context_tokens, tokens);
});
