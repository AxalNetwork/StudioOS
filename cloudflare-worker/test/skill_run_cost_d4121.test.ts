// D4121 (#4121, Roster R5 of #4116) — what skills cost per run.
//
//   1. context_tokens: the migration back-fills every published version with
//      the AI budget's estimate, and a new version stores it as it is published;
//   2. the cost is monotonic in skills: each added skill raises tokens and
//      dollars per run, and removing one lowers them by the same amount;
//   3. pricing that cannot be read answers { available: false }, never a 0;
//   4. the thresholds: more than 6 skills, or above 2× the baseline, names the
//      area with the most skills and an offered persona not on the team;
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
import { estTokens } from '../src/services/ai/shapes.ts';

const sql = (f: string) => readFileSync(new URL(`../sql/${f}`, import.meta.url), 'utf8');
const BASELINE = sql('schema_baseline.sql');
const COSTS = sql('migrations/202611022326_agent_skill_context_tokens.sql');
const MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
const SUPER = 1, SECOND_SUPER = 2, EDITOR = 10, MEMBER = 11, STRANGER = 12;
const CFO = 'a'.repeat(32), UNPRICED = 'b'.repeat(32), BIG = 'c'.repeat(32);
const hex = (n: number) => n.toString(16).padStart(32, '0');

function world({ costs = true } = {}) {
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
  if (costs) db.exec(COSTS);
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

/** A published HQ skill written straight into the store: `chars` of SKILL.md, tagged in `area`. */
function skill(w: W, id: number, chars: number, area = 'investor_reporting', { costRow = true } = {}) {
  const md = `---\nname: s${id}\n---\n${'x'.repeat(Math.max(0, chars - 18))}`;
  w.db.prepare(`INSERT INTO agent_skills (id, uid, scope, slug, name, purpose, steps_json, allowed_tools_json, output_kind, status, current_version, created_by)
    VALUES (?, ?, 'hq', ?, ?, 'A purpose', '[]', '[]', 'draft', 'published', 1, ${SUPER})`).run(id, hex(id), `s-${id}`, `Skill ${id}`);
  w.db.prepare(`INSERT INTO agent_skill_versions (skill_id, version, skill_md, name, purpose, steps_json, allowed_tools_json, output_kind, taxonomy_json, roles_json, published_by)
    VALUES (?, 1, ?, ?, 'A purpose', '[]', '[]', 'draft', ?, '["cfo"]', ${SUPER})`).run(id, md, `Skill ${id}`, JSON.stringify([{ slug: area, level: 'proficient' }]));
  w.db.prepare("INSERT INTO agent_skill_tags (skill_id, taxonomy_skill_slug, level) VALUES (?, ?, 'proficient')").run(id, area);
  if (costRow) w.db.prepare('INSERT OR REPLACE INTO agent_skill_version_costs (skill_id, version, context_tokens) VALUES (?, 1, ?)').run(id, contextTokensOf(md));
  return { uid: hex(id), md };
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

test('1: context_tokens — the migration back-fills each version, and publishing stores it in the same batch', async () => {
  // Mutations checked: the back-fill's (length + 3) / 4 → length / 4 → the 19-character version reads 4, not 5, and this fails;
  // the cost INSERT dropped from publishDraft → the published version has no row and the stored-row assert fails.
  const w = world({ costs: false });
  const short = skill(w, 100, 10, 'investor_reporting', { costRow: false });
  assert.equal(short.md.length % 4, 3, 'a length the rounding decides');
  w.db.prepare(`INSERT INTO agent_skills (id, uid, scope, slug, name, purpose, steps_json, allowed_tools_json, output_kind, status, current_version, created_by)
    VALUES (101, ?, 'hq', 'empty', 'Empty', 'A purpose', '[]', '[]', 'draft', 'published', 1, ${SUPER})`).run(hex(101));
  w.db.prepare(`INSERT INTO agent_skill_versions (skill_id, version, skill_md, name, purpose, steps_json, allowed_tools_json, output_kind, taxonomy_json, roles_json, published_by)
    VALUES (101, 1, '', 'Empty', 'A purpose', '[]', '[]', 'draft', '[]', '["cfo"]', ${SUPER})`).run();
  w.db.exec(COSTS);
  const rows = w.db.prepare('SELECT skill_id, context_tokens FROM agent_skill_version_costs ORDER BY skill_id').all() as any[];
  assert.deepEqual(rows.map((r) => [r.skill_id, r.context_tokens]), [[100, contextTokensOf(short.md)], [101, 0]]);
  assert.equal(contextTokensOf(short.md), Math.ceil(short.md.length / 4));
  assert.equal(contextTokensOf('x'.repeat(10)), estTokens('x'.repeat(10)), 'the AI budget\'s own estimate');
  assert.equal(contextTokensOf('x'.repeat(10)), 3);

  const v = world();
  const made = await call(v, SUPER, 'POST', '/api/teams/skills', {
    scope: 'hq', name: 'Draft the monthly investor update', purpose: 'From recorded metrics, a draft update for investors.',
    steps: ['Read the last three months of recorded metrics', 'Write the highlights and the asks'], tools: [], output_kind: 'draft',
    roles: ['cfo'], tags: [{ slug: 'investor_reporting', level: 'proficient' }],
  });
  assert.equal(made.status, 201, made.text);
  await passHqGate(v.db, made.body.skill.uid);
  assert.equal((await call(v, SUPER, 'POST', `/api/teams/skills/${made.body.skill.uid}/publish`)).status, 200);
  const stored = v.db.prepare(`SELECT c.context_tokens, x.skill_md FROM agent_skill_version_costs c JOIN agent_skill_versions x ON x.skill_id = c.skill_id AND x.version = c.version
    JOIN agent_skills s ON s.id = c.skill_id WHERE s.uid = ?`).get(made.body.skill.uid) as any;
  assert.ok(stored, 'the version stores its context_tokens');
  assert.equal(stored.context_tokens, estTokens(stored.skill_md));
});

test('2: monotonic — each added skill raises tokens and dollars per run; removing one gives the same back', async () => {
  // Mutations checked: pinTokens ignoring the pins (tokens from the prompt alone) → the three estimates are equal and this fails;
  // the remove list ignored → removing skill 201 leaves the estimate unchanged and the delta assert fails.
  const w = world();
  const made = [201, 202, 203].map((id) => skill(w, id, 4000 + id));
  const zero = await est(w, CFO);
  assert.equal(zero.status, 200, zero.text);
  assert.equal(zero.body.available, true);
  assert.equal(zero.body.skills, 0);
  const one = await est(w, CFO, `?add=${hex(201)}`);
  const three = await est(w, CFO, `?add=${hex(201)},${hex(202)}&add=${hex(203)}`);
  assert.ok(one.body.tokens_per_run > zero.body.tokens_per_run);
  assert.ok(three.body.tokens_per_run > one.body.tokens_per_run);
  assert.ok(one.body.est_usd_per_run > zero.body.est_usd_per_run);
  assert.ok(three.body.est_usd_per_run > one.body.est_usd_per_run);
  assert.ok(three.body.monthly_at_cap < zero.body.monthly_at_cap, 'fewer runs fit in the cap');
  assert.equal(one.body.tokens_per_run - zero.body.tokens_per_run, contextTokensOf(made[0].md), 'exactly the skill\'s context');
  assert.deepEqual([one.body.delta.skills, one.body.delta.tokens_per_run], [1, one.body.tokens_per_run - zero.body.tokens_per_run]);
  assert.equal(one.body.cap_usd, 20);
  assert.equal(zero.body.tokens_per_run, zero.body.baseline.tokens_per_run);
  assert.ok(zero.body.tokens_per_run > RUN_COST_CONFIG.requestTokens + RUN_COST_CONFIG.outputTokens, 'the system prompt counts');

  pin(w, 1, 201); pin(w, 1, 202);
  const now = await est(w, CFO);
  const off = await est(w, CFO, `?remove=${hex(201)}`);
  assert.equal(now.body.skills, 2);
  assert.equal(off.body.skills, 1);
  assert.equal(off.body.delta.tokens_per_run, -(now.body.tokens_per_run - off.body.tokens_per_run));
  assert.ok(off.body.delta.est_usd_per_run < 0);
  assert.equal((await est(w, CFO, `?add=${hex(201)}`)).body.skills, 2, 'adding a skill it has changes nothing');
});

test('3: pricing that cannot be read is { available: false }, never a 0', async () => {
  // Mutation checked: priceMicro returning 0 for an unknown model → the unpriced agent answers $0 and this fails.
  const w = world();
  skill(w, 301, 2000);
  const r = await est(w, UNPRICED, `?add=${hex(301)}`);
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { available: false, reason: 'pricing_unreadable' });
  assert.doesNotMatch(r.text, /est_usd_per_run|tokens_per_run/);
  w.db.exec('DROP TABLE agent_skill_versions');
  const s = await est(w, CFO, `?add=${hex(301)}`);
  assert.equal(s.body.available, false, 'unreadable skills are not a 0 either');
});

test('4: the thresholds — more than 6 skills, or above 2× the baseline, suggest a specialist by area', async () => {
  // Mutations checked: specialistMaxSkills 6 → 60 → seven small skills give no hint and this fails;
  // the cost ratio test dropped → the one huge skill gives no hint and this fails;
  // the "not on the team" filter dropped → Vesta (already on the team) is suggested and the persona assert fails.
  const w = world();
  assert.deepEqual([RUN_COST_CONFIG.specialistMaxSkills, RUN_COST_CONFIG.specialistCostRatio], [6, 2]);
  const small = [401, 402, 403, 404, 405, 406, 407].map((id) => skill(w, id, 40, id === 407 ? 'investor_relations' : 'fp_and_a').uid);
  const six = await est(w, CFO, `?add=${small.slice(0, 6).join(',')}`);
  assert.equal(six.body.hint, null, 'six small skills: no hint');
  const seven = await est(w, CFO, `?add=${small.join(',')}`);
  assert.equal(seven.body.hint.reason, 'skills');
  assert.equal(seven.body.hint.area, 'finance', 'the area with the most skills');
  // Vesta, the first finance persona, is already on this team: the next offered one is named.
  assert.deepEqual(seven.body.hint.suggest, { key: 'orrin', name: 'Orrin' });
  assert.deepEqual(seven.body.thresholds, { max_skills: 6, cost_ratio: 2 });

  const huge = skill(w, 410, 60_000, 'product_strategy').uid;
  const dear = await est(w, BIG, `?add=${huge}`);
  assert.equal(dear.body.skills, 1);
  assert.ok(dear.body.est_usd_per_run > 2 * dear.body.baseline.est_usd_per_run);
  assert.equal(dear.body.hint.reason, 'cost');
  assert.equal(dear.body.hint.area, 'product');
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
  const { uid, md } = skill(w, 601, 4800);
  const hq = await call(w, SUPER, 'GET', '/api/admin/ai-agents/skills');
  assert.equal(hq.status, 200, hq.text);
  assert.equal(hq.body.skills.find((s: any) => s.uid === uid).tokens_per_run, contextTokensOf(md));
  const lib = await call(w, MEMBER, 'GET', '/api/teams/skills');
  assert.equal(lib.body.hq.find((s: any) => s.uid === uid).context_tokens, contextTokensOf(md));
});
