// D4117 (#4117, Roster R1 of #4116) — the 16 agent personas and identity on team agents.
//
//   1. the catalogue: 16 personas in #4116's order, single names, eight women and eight men,
//      exactly the six Axal values (FIT_V2_VALUES) with #4116's top three, 16 distinct
//      profiles, the risk scale, natural fit derived by the documented rule;
//   2. immutability: the catalogue is frozen, and no route edits an agent's persona;
//   3. the role defaults: every role reads as its own persona, eleven distinct ones;
//   4. the routes: GET /personas; persona_key on add; 409 persona_on_team (counting an older
//      agent's role default); 400 invalid_persona; a removed agent frees its persona;
//   5. capability from skills: the union of the books of the roles its skills serve;
//   6. no job title, no Schwartz value and no trade-off in any answer.
//
//   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
//     --test cloudflare-worker/test/team_personas_d4117.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SignJWT } from 'jose';
import { Hono } from 'hono';
import { makeD1 } from './_d1_sqlite.mjs';
import { addColumnsFrom, stripForeignKeys, tableFromBaseline } from './_baseline.mjs';
import { AI_LOG_SCHEMA } from './_ai_budget_fixture.mjs';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';
import teamAgents from '../src/routes/team_agents.ts';
import { FIT_V2_VALUES } from '../src/services/axalFit.ts';
import { RADAR_AXES } from '../src/services/skillsTaxonomySchema.ts';
import { DEFAULT_PERSONA_BY_ROLE, ROLES, roleOf } from '../src/services/agents/catalogue.ts';
import {
  AREAS, FIT_RULE, PERSONAS, naturalFitOf, personaOf, personaOfAgent, personaView, valuesFromTop,
} from '../src/services/agents/personas.ts';
import { agentBook, skillRoles } from '../src/services/agents/teams.ts';

const sql = (f: string) => readFileSync(new URL(`../sql/${f}`, import.meta.url), 'utf8');
const BASELINE = sql('schema_baseline.sql');
const PERSONA_MIGRATION = sql('migrations/202611021728_team_agents_persona.sql');

const KEYS = ['vesta', 'orrin', 'ilyse', 'kade', 'sylva', 'solen', 'tessaly', 'corvane', 'juno', 'brann', 'seren', 'corin', 'ryssa', 'draxen', 'elara', 'aurel'];
// #4116, owner revision of 2026-11-02 (13:57): each agent's top three Axal values, and the risk scale.
const TOP: Record<string, [string, string, string]> = {
  vesta: ['integrity', 'stewardship', 'collaboration'], orrin: ['stewardship', 'integrity', 'resilience'],
  ilyse: ['curiosity', 'ambition', 'resilience'], kade: ['curiosity', 'collaboration', 'ambition'],
  sylva: ['stewardship', 'curiosity', 'collaboration'], solen: ['stewardship', 'collaboration', 'ambition'],
  tessaly: ['curiosity', 'integrity', 'ambition'], corvane: ['integrity', 'resilience', 'curiosity'],
  juno: ['ambition', 'resilience', 'collaboration'], brann: ['resilience', 'integrity', 'collaboration'],
  seren: ['collaboration', 'integrity', 'curiosity'], corin: ['collaboration', 'curiosity', 'resilience'],
  ryssa: ['curiosity', 'stewardship', 'ambition'], draxen: ['ambition', 'resilience', 'integrity'],
  elara: ['stewardship', 'curiosity', 'resilience'], aurel: ['stewardship', 'integrity', 'curiosity'],
};
// Most cautious 1 · Cautious 2 · Balanced 3 · Bold 4 · Boldest 5.
const RISK: Record<string, number> = { vesta: 2, orrin: 1, ilyse: 5, kade: 4, sylva: 2, solen: 3, tessaly: 3, corvane: 2, juno: 4, brann: 3, seren: 2, corin: 3, ryssa: 4, draxen: 5, elara: 2, aurel: 3 };

const SCHWARTZ = /self.?direction|stimulation|hedonism|achievement|\bpower\b|security|conformity|tradition|benevolence|universalism/i;
const JOB_TITLES = /\b(CEO|CTO|CPO|CFO|CMO|COO|Chief|Head of|General counsel|Officer|Analyst|VP)\b/;

// 1 ───────────────────────────────────────────────────────────────────────────
test('the catalogue: 16 single-named personas, eight women and eight men, in #4116\'s order', () => {
  // Mutations checked: a family name back, or a persona dropped → the name or count asserts fail.
  assert.deepEqual(PERSONAS.map((p) => p.key), KEYS);
  for (const p of PERSONAS) {
    assert.match(p.name, /^[A-Z][a-z]+$/, `${p.key}: one word, no family name`);
    assert.equal(p.key, p.name.toLowerCase());
    assert.equal(p.avatar, `/agents/${p.key}.webp`);
    for (const f of ['tagline', 'personality', 'goal', 'story'] as const) assert.ok(p[f].length > 10, `${p.key}.${f}`);
    assert.equal(p.story.includes(p.name), true, `${p.key}'s story names them by their one name`);
  }
  assert.deepEqual(PERSONAS.map((p) => p.gender).filter((g) => g === 'woman').length, 8);
  assert.equal(new Set(PERSONAS.map((p) => p.name)).size, 16);
  // The owner's #4117 note: Solen's last line is about a value, not a camp.
  assert.ok(personaOf('solen')!.story.endsWith('and he is happiest when the kind choice is also the sound one.'));
});

test('values: exactly the six Axal values, #4116\'s top three highest, 16 distinct profiles; risk as the table', () => {
  // Mutations checked: a Schwartz key added, a top three reordered, two profiles equal → each fails.
  for (const p of PERSONAS) {
    assert.deepEqual(Object.keys(p.values).sort(), [...FIT_V2_VALUES].sort(), `${p.key}: the FIT_V2_VALUES keys`);
    for (const v of Object.values(p.values)) assert.ok(v >= 0 && v <= 1);
    const ranked = Object.entries(p.values).sort((a, b) => b[1] - a[1]).map(([k]) => k);
    assert.deepEqual(ranked.slice(0, 3), TOP[p.key], `${p.key}'s top three`);
    assert.ok(p.values[TOP[p.key][2] as keyof typeof p.values] > p.values[ranked[3] as keyof typeof p.values], `${p.key}: the top three clearly highest`);
    assert.equal(p.risk, RISK[p.key], `${p.key}'s risk`);
  }
  assert.equal(new Set(PERSONAS.map((p) => TOP[p.key].join())).size, 16, '16 distinct top-three sets');
  assert.equal(new Set(PERSONAS.map((p) => JSON.stringify(p.values))).size, 16, '16 pairwise-different profiles');
  assert.deepEqual(valuesFromTop(['integrity', 'stewardship', 'collaboration']),
    { integrity: 0.92, stewardship: 0.84, collaboration: 0.76, curiosity: 0.58, resilience: 0.46, ambition: 0.34 });
});

test('natural fit: two of the eight radar areas, derived from the values by FIT_RULE', () => {
  // Mutations checked: a fit stored by hand that disagrees with the rule, or the tie order flipped → fails.
  assert.deepEqual([...AREAS], RADAR_AXES.map((a) => a.slug));
  assert.deepEqual(Object.keys(FIT_RULE).sort(), [...AREAS].sort());
  for (const p of PERSONAS) {
    assert.deepEqual([...p.natural_fit], naturalFitOf(p.values), p.key);
    assert.notEqual(p.natural_fit[0], p.natural_fit[1]);
  }
  assert.deepEqual([...personaOf('vesta')!.natural_fit], ['finance_ops', 'legal_compliance'], 'Stewardship + Integrity → Finance and Legal');
  assert.deepEqual([...personaOf('ilyse')!.natural_fit], ['gtm_sales', 'capital_network'], 'Curiosity + Ambition → GTM and Capital');
  assert.deepEqual([...personaOf('corvane')!.natural_fit], ['engineering', 'finance_ops'], 'Resilience + Integrity → Engineering first');
  assert.deepEqual([...personaOf('seren')!.natural_fit], ['product', 'marketing_brand'], 'Collaboration + Curiosity → Product and Marketing');
});

// 2 ───────────────────────────────────────────────────────────────────────────
test('immutability: the catalogue, each persona and its values are frozen', () => {
  // Mutation checked: Object.freeze dropped from `persona` → the writes succeed and these fail.
  assert.ok(Object.isFrozen(PERSONAS));
  for (const p of PERSONAS) { assert.ok(Object.isFrozen(p), p.key); assert.ok(Object.isFrozen(p.values)); assert.ok(Object.isFrozen(p.natural_fit)); }
  assert.throws(() => { (PERSONAS[0] as any).name = 'Mallory'; });
  assert.throws(() => { (PERSONAS[0].values as any).integrity = 0; });
  const view = personaView(PERSONAS[0]);
  view.values.integrity = 0;
  assert.equal(PERSONAS[0].values.integrity, 0.92, 'a view is a copy');
});

// 3 ───────────────────────────────────────────────────────────────────────────
test('role defaults: every role reads as a persona, eleven distinct; an own persona_key wins', () => {
  // Mutation checked: two roles sharing a default → the distinct count fails (a team would read two agents as one).
  assert.deepEqual(Object.keys(DEFAULT_PERSONA_BY_ROLE).sort(), ROLES.map((r) => r.key).sort());
  assert.equal(new Set(Object.values(DEFAULT_PERSONA_BY_ROLE)).size, ROLES.length);
  for (const k of Object.values(DEFAULT_PERSONA_BY_ROLE)) assert.ok(personaOf(k), k);
  assert.equal(personaOfAgent({ role_key: 'cfo', persona_key: null })!.key, 'orrin');
  assert.equal(personaOfAgent({ role_key: 'cfo', persona_key: 'kade' })!.key, 'kade');
  assert.equal(personaOfAgent({ role_key: 'cfo', persona_key: 'nobody' })!.key, 'orrin', 'an unknown key falls back to the role default');
  for (const r of ROLES) assert.doesNotMatch(r.name, JOB_TITLES, `${r.key}'s name is the work it covers`);
});

// 4 ───────────────────────────────────────────────────────────────────────────
const MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
const EDITOR = 10, MEMBER = 11;
const SKILL_TABLES = `
  CREATE TABLE agent_skill_links (agent_id INTEGER NOT NULL, skill_id INTEGER NOT NULL, version INTEGER NOT NULL);
  CREATE TABLE agent_skill_versions (skill_id INTEGER NOT NULL, version INTEGER NOT NULL, roles_json TEXT NOT NULL);`;

function world({ skills = true } = {}) {
  const { DB, db } = makeD1(
    ['users', 'company_profiles', 'user_company_links', 'projects', 'integrations'].map((t) => stripForeignKeys(tableFromBaseline(BASELINE, t))).join('\n')
    + AI_LOG_SCHEMA + sql('migrations/506_ai_rail_proposals.sql'),
  );
  addColumnsFrom(db, sql('migrations/597_company_archive_and_events.sql'), 'company_profiles');
  db.exec(sql('migrations/712_team_agents.sql'));
  db.exec(PERSONA_MIGRATION);
  if (skills) db.exec(SKILL_TABLES);
  const user = db.prepare("INSERT INTO users (id, uid, email, name, role, founder_id, subscription_tier, subscription_status) VALUES (?, ?, ?, ?, ?, ?, ?, 'active')");
  user.run(EDITOR, 'u-editor', 'editor@example.test', 'Eve Editor', 'founder', 100, 'growth');
  user.run(MEMBER, 'u-member', 'member@example.test', 'Max Member', 'founder', 101, 'growth');
  db.prepare("INSERT INTO company_profiles (id, uid, company_name) VALUES (1, 'co-uid-1', 'Acme')").run();
  const link = db.prepare('INSERT INTO user_company_links (uid, user_id, company_id, role_in_company) VALUES (?, ?, 1, ?)');
  link.run('l1', EDITOR, 'Founder'); link.run('l2', MEMBER, 'Member');
  const env: any = { DB, JWT_SECRET: 'd4117-fixture-only-secret', ENVIRONMENT: 'development', TEAM_AGENTS_ENABLED: 'true' };
  return { db, env };
}
type W = ReturnType<typeof world>;

async function call(w: W, who: number, method: string, path: string, body?: unknown) {
  const a = new Hono();
  a.onError((e: any, c) => {
    const status = AUTH_ERROR_STATUSES[e?.message];
    return status ? c.json({ detail: e.message }, status) : c.json({ detail: 'Internal server error', m: String(e?.message) }, 500);
  });
  a.route('/api/teams', teamAgents);
  const jwt = await new SignJWT({ user_id: who }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(w.env.JWT_SECRET));
  const r = await a.request(`/api/teams${path}`, { method, headers: { Authorization: `Bearer ${jwt}`, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body) }, w.env);
  const text = await r.text();
  return { status: r.status, body: (text ? JSON.parse(text) : null) as any, text };
}
const CO = '/company/co-uid-1';
const add = (w: W, over: Record<string, unknown>) => call(w, EDITOR, 'POST', `${CO}/agents`, { model_id: MODEL, monthly_cap_microusd: 5_000_000, ...over });

test('GET /personas: the 16, the six values with their words, and the eight areas; no title, no Schwartz value, no trade-off', async () => {
  const w = world();
  const r = await call(w, MEMBER, 'GET', '/personas');
  assert.equal(r.status, 200, r.text);
  assert.deepEqual(r.body.personas.map((p: any) => p.key), KEYS);
  assert.deepEqual(Object.keys(r.body.personas[0]).sort(), ['avatar', 'gender', 'goal', 'key', 'name', 'natural_fit', 'personality', 'risk', 'story', 'tagline', 'values']);
  assert.deepEqual(r.body.values.map((v: any) => v.key), [...FIT_V2_VALUES]);
  assert.ok(r.body.values.every((v: any) => v.label && v.description), 'each value has its label and words');
  assert.deepEqual(r.body.areas.map((a: any) => a.slug), [...AREAS]);
  assert.doesNotMatch(r.text, SCHWARTZ);
  assert.doesNotMatch(r.text, /philosophy|tradeoff|trade_off|first_name|last_name/);
  assert.doesNotMatch(r.text, JOB_TITLES);
});

test('add: persona_key stored; the role default when absent; one live agent per persona per Team; a removed agent frees it', async () => {
  // Mutations checked: the persona check removed → the second Orrin is 201 and this fails;
  // the role default ignored in the check → an older CFO's Orrin is not counted and this fails.
  const w = world();
  const a = await add(w, { role_key: 'cto', persona_key: 'vesta' });
  assert.equal(a.status, 201, a.text);
  assert.equal(a.body.agent.persona.key, 'vesta');
  assert.equal(a.body.agent.persona.name, 'Vesta');
  assert.equal(a.body.agent.role_name, 'Engineering', 'the work it covers, never "CTO"');
  assert.equal((w.db.prepare('SELECT persona_key FROM team_agents WHERE uid = ?').get(a.body.agent.uid) as any).persona_key, 'vesta');
  // An agent added before personas: persona_key NULL, read as its role's default (the CFO is Orrin).
  w.db.prepare(`INSERT INTO team_agents (uid, scope_kind, company_id, role_key, model_id, sponsor_user_id, monthly_cap_microusd, created_by)
    VALUES ('old-cfo', 'company', 1, 'cfo', ?, ?, 5000000, ?)`).run(MODEL, EDITOR, EDITOR);
  const list = await call(w, MEMBER, 'GET', `${CO}/agents`);
  assert.deepEqual(list.body.agents.map((x: any) => x.persona.key).sort(), ['orrin', 'vesta']);
  const twice = await add(w, { role_key: 'sales', persona_key: 'orrin' });
  assert.deepEqual([twice.status, twice.body.error], [409, 'persona_on_team'], 'Orrin is the older CFO');
  assert.match(twice.text, /Orrin is already on this team/);
  const again = await add(w, { role_key: 'sales', persona_key: 'vesta' });
  assert.deepEqual([again.status, again.body.error], [409, 'persona_on_team']);
  const bad = await add(w, { role_key: 'sales', persona_key: 'nova' });
  assert.deepEqual([bad.status, bad.body.error], [400, 'invalid_persona'], 'a retired name is not a persona');
  const byRole = await add(w, { role_key: 'sales' });
  assert.deepEqual([byRole.status, byRole.body.agent.persona.key], [201, 'ilyse'], 'no persona_key: the role default');
  const sameRole = await add(w, { role_key: 'sales', persona_key: 'kade' });
  assert.deepEqual([sameRole.status, sameRole.body.error], [409, 'role_taken'], 'a role clash still says so');
  w.db.prepare("UPDATE team_agents SET status = 'removed' WHERE uid = 'old-cfo'").run();
  const freed = await add(w, { role_key: 'investor_relations', persona_key: 'orrin' });
  assert.equal(freed.status, 201, 'a removed agent frees its persona');
});

test('immutability at the route: PATCH never changes who an agent is', async () => {
  const w = world();
  const a = await add(w, { role_key: 'cto', persona_key: 'vesta' });
  const p = await call(w, EDITOR, 'PATCH', `/agents/${a.body.agent.uid}`, { persona_key: 'kade', status: 'paused' });
  assert.equal(p.status, 200, p.text);
  assert.equal(p.body.agent.persona.key, 'vesta');
  assert.equal((w.db.prepare('SELECT persona_key FROM team_agents WHERE uid = ?').get(a.body.agent.uid) as any).persona_key, 'vesta');
});

test('the database floor: a second live row with one persona is refused by the partial index; a removed one is not', () => {
  const w = world();
  const row = w.db.prepare(`INSERT INTO team_agents (uid, scope_kind, company_id, role_key, persona_key, model_id, sponsor_user_id, monthly_cap_microusd, created_by, status)
    VALUES (?, 'company', 1, ?, 'juno', ?, ?, 5000000, ?, ?)`);
  row.run('j1', 'cto', MODEL, EDITOR, EDITOR, 'removed');
  row.run('j2', 'cpo', MODEL, EDITOR, EDITOR, 'active');
  assert.throws(() => row.run('j3', 'coo', MODEL, EDITOR, EDITOR, 'active'), /UNIQUE/);
});

// 5 ───────────────────────────────────────────────────────────────────────────
test('capability from skills: the union of the books of the roles its skills serve; none, its own role', async () => {
  // Mutations checked: agentBook reading only the agent's role → the investor-relations module is
  // refused and this fails; the fallback dropped → an agent with no skills works nowhere and this fails.
  const w = world();
  const a = await add(w, { role_key: 'cfo', persona_key: 'orrin' });
  const row: any = w.db.prepare('SELECT * FROM team_agents WHERE uid = ?').get(a.body.agent.uid);
  const scope: any = { kind: 'company', id: 1, uid: 'co-uid-1', name: 'Acme' };
  const cfo = roleOf('cfo')!.default_rules;
  const ir = roleOf('investor_relations')!.default_rules;
  const bare = await agentBook(w.env, scope, row);
  assert.deepEqual(bare.roles, ['cfo']);
  assert.deepEqual(bare.rules.works_in, cfo.works_in);
  // A skill that serves the CFO and investor relations.
  w.db.exec(`INSERT INTO agent_skill_versions VALUES (1, 1, '["cfo","investor_relations","no_such_role"]');
             INSERT INTO agent_skill_links VALUES (${row.id}, 1, 1);`);
  assert.deepEqual(await skillRoles(w.env, row), ['cfo', 'investor_relations'], 'an unknown role is ignored');
  const both = await agentBook(w.env, scope, row);
  for (const m of [...cfo.works_in, ...ir.works_in]) assert.ok(both.rules.works_in.includes(m), m);
  for (const o of ir.may_propose) assert.ok(both.rules.may_propose.includes(o), o);
  assert.equal(both.rules.mission, cfo.mission, 'its mission stays its own role\'s');
  assert.deepEqual(both.rules.may_do_automatically, []);
  // A skill only for investor relations: the CFO's own modules are no longer its.
  w.db.exec(`UPDATE agent_skill_versions SET roles_json = '["investor_relations"]'`);
  const other = await agentBook(w.env, scope, row);
  assert.deepEqual(other.roles, ['investor_relations']);
  assert.deepEqual(other.rules.works_in, ir.works_in);
  // No skill tables (a database before 757): its own role, never more.
  const old = world({ skills: false });
  assert.deepEqual(await skillRoles(old.env, row), ['cfo']);
});

// 6 ───────────────────────────────────────────────────────────────────────────
test('no answer carries a job title, a Schwartz value or a trade-off: roles, personas, list, add, profile', async () => {
  // Mutation checked: a role named "CFO" again → the roles and agent answers fail.
  const w = world();
  const a = await add(w, { role_key: 'cfo', persona_key: 'orrin' });
  const answers = [
    await call(w, MEMBER, 'GET', '/roles'),
    await call(w, MEMBER, 'GET', '/personas'),
    await call(w, MEMBER, 'GET', `${CO}/agents`),
    a,
    await call(w, MEMBER, 'GET', `/agents/${a.body.agent.uid}`),
  ];
  for (const r of answers) {
    assert.ok(r.status === 200 || r.status === 201, r.text);
    assert.doesNotMatch(r.text, JOB_TITLES);
    assert.doesNotMatch(r.text, /"(philosophy|tradeoffs)"/);
  }
  for (const r of answers.slice(1)) assert.doesNotMatch(r.text, SCHWARTZ);
});
