// D4117 (#4117, Roster R1 of #4116) — the 16 agent personas.
//
//   · the catalogue: 16 personas with single names and the keys #4117 gives,
//     8 women and 8 men, the 6 Axal values exactly (FIT_V2_VALUES), the top 3
//     highest, 16 distinct top-3 sets and 16 distinct profiles, risk 1–5, a
//     natural fit of 2 areas by the documented rule;
//   · immutability: frozen in code, and no route writes one;
//   · the backfill: migration 202611021724 maps every role to its default
//     persona, the same map as ROLE_PERSONA, all different;
//   · one live agent per persona per Team: 409 persona_on_team, freed by
//     removing the agent, independent between Teams, and held by the index;
//   · no job title, outlook, trade-off or Schwartz value in any DTO.
//
// Real SQLite with migrations 712 and 202611021724 over the baseline's
// tables. Each case names the mutations it was checked against.
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
import { ROLES } from '../src/services/agents/catalogue.ts';
import { FIT_V2_VALUES } from '../src/services/axalFit.ts';
import {
  AREAS, AREA_VALUES, PERSONAS, REST_SCORES, ROLE_PERSONA, TOP_SCORES, VALUE_LEGEND, naturalFit, personaDto, personaOf, valueScores,
} from '../src/services/agents/personas.ts';

const sql = (f: string) => readFileSync(new URL(`../sql/${f}`, import.meta.url), 'utf8');
const BASELINE = sql('schema_baseline.sql');
const PERSONA_MIGRATION = sql('migrations/202611021724_team_agents_persona.sql');

const MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
const CAP = 5_000_000;
const EDITOR = 10, MEMBER = 11;
const KEYS = ['vesta', 'orrin', 'ilyse', 'kade', 'sylva', 'solen', 'tessaly', 'corvane', 'juno', 'brann', 'seren', 'corin', 'ryssa', 'draxen', 'elara', 'aurel'];
const SCHWARTZ = ['self_direction', 'self-direction', 'stimulation', 'hedonism', 'achievement', 'power', 'security', 'conformity', 'tradition', 'benevolence', 'universalism'];
// Words that must never reach the client: every role's title, the old outlooks, the old fields.
const BANNED = [
  ...ROLES.map((r) => r.name), 'CTO', 'CFO', 'CEO', 'CMO', 'COO', 'CPO',
  'Guardian', 'Explorer', 'Steward', 'Technocrat', 'Builder', 'Diplomat', 'Challenger', 'Mentor',
  'philosophy', 'tradeoffs', 'first_name_persona', 'role_name',
];

function world({ migrate = true } = {}) {
  const { DB, db } = makeD1(
    ['users', 'company_profiles', 'user_company_links', 'projects', 'integrations'].map((t) => stripForeignKeys(tableFromBaseline(BASELINE, t))).join('\n')
    + AI_LOG_SCHEMA + sql('migrations/506_ai_rail_proposals.sql'),
  );
  addColumnsFrom(db, sql('migrations/597_company_archive_and_events.sql'), 'company_profiles');
  db.exec(sql('migrations/712_team_agents.sql'));
  if (migrate) db.exec(PERSONA_MIGRATION);
  db.exec(stripForeignKeys(sql('migrations/727_scope_goals_and_tasks.sql')));
  const user = db.prepare("INSERT INTO users (id, uid, email, name, role, founder_id, subscription_tier, subscription_status) VALUES (?, ?, ?, ?, ?, ?, ?, 'active')");
  user.run(EDITOR, 'u-editor', 'editor@example.test', 'Eve Editor', 'founder', 100, 'growth');
  user.run(MEMBER, 'u-member', 'member@example.test', 'Max Member', 'founder', 101, 'growth');
  db.prepare("INSERT INTO company_profiles (id, uid, company_name) VALUES (1, 'co-uid-1', 'Acme')").run();
  db.prepare("INSERT INTO company_profiles (id, uid, company_name) VALUES (2, 'co-uid-2', 'Beta')").run();
  const link = db.prepare("INSERT INTO user_company_links (uid, user_id, company_id, role_in_company) VALUES (?, ?, ?, ?)");
  link.run('l1', EDITOR, 1, 'Founder'); link.run('l2', MEMBER, 1, 'Member'); link.run('l3', EDITOR, 2, 'Founder');
  const env: any = { DB, JWT_SECRET: 'd4117-fixture-only-secret', ENVIRONMENT: 'development', TEAM_AGENTS_ENABLED: 'true' };
  return { db, env };
}
type W = ReturnType<typeof world>;

function app() {
  const a = new Hono();
  a.onError((e: any, c) => {
    const status = AUTH_ERROR_STATUSES[e?.message];
    return status ? c.json({ detail: e.message }, status) : c.json({ detail: 'Internal server error', m: String(e?.message) }, 500);
  });
  a.route('/api/teams', teamAgents);
  return a;
}
async function call(w: W, who: number, method: string, path: string, body?: unknown) {
  const jwt = await new SignJWT({ user_id: who }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(w.env.JWT_SECRET));
  const r = await app().request(`/api/teams${path}`, { method, headers: { Authorization: `Bearer ${jwt}`, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body) }, w.env);
  const text = await r.text();
  let parsed: any = null;
  try { parsed = text ? JSON.parse(text) : null; } catch { parsed = null; }
  return { status: r.status, body: parsed, text };
}
const add = (over: Record<string, unknown> = {}) => ({ role_key: 'cfo', model_id: MODEL, monthly_cap_microusd: CAP, ...over });
const CO = '/company/co-uid-1', CO2 = '/company/co-uid-2';

function noTitles(text: string, where: string) {
  // Whole words: the value Stewardship is fine, the outlook Steward is not.
  for (const w of BANNED) assert.ok(!new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}\\b`).test(text), `${where}: "${w}" reached the client`);
  for (const k of SCHWARTZ) assert.ok(!new RegExp(`"${k}"`, 'i').test(text), `${where}: Schwartz key ${k}`);
}

// 1 ───────────────────────────────────────────────────────────────────────────
test('the catalogue: 16 single-named personas, 8 women and 8 men, the 6 Axal values, top 3 highest, all distinct', () => {
  // Mutations checked: a persona given a family name → the single-word assert fails; a seventh value key added to
  // valueScores → the key-set assert fails; Kade's top 3 set equal to Ilyse's → the distinct-sets assert fails;
  // REST_SCORES[0] raised to 0.75 → the top-3-highest assert fails.
  assert.deepEqual(PERSONAS.map((p) => p.key), KEYS);
  assert.equal(new Set(PERSONAS.map((p) => p.name)).size, 16);
  for (const p of PERSONAS) {
    assert.match(p.name, /^[A-Z][a-z]+$/, `${p.key}: a single word, no family name`);
    assert.equal(p.name.toLowerCase(), p.key);
    assert.equal(p.avatar, `/agents/${p.key}.webp`);
    assert.ok([1, 2, 3, 4, 5].includes(p.risk), `${p.key} risk`);
    assert.deepEqual(Object.keys(p.values).sort(), [...FIT_V2_VALUES].sort(), `${p.key}: exactly the 6 Axal values`);
    for (const v of Object.values(p.values)) assert.ok(v >= 0 && v <= 1);
    const top = Math.min(...p.top_values.map((k) => p.values[k]));
    const rest = Math.max(...FIT_V2_VALUES.filter((k) => !p.top_values.includes(k)).map((k) => p.values[k]));
    assert.ok(top > rest, `${p.key}: the top 3 are clearly highest`);
    for (const s of [p.tagline, p.goal, p.personality, p.story]) assert.ok(s.trim().length > 0, `${p.key}: text`);
    assert.ok(p.story.includes(p.name), `${p.key}: the story names the agent`);
  }
  assert.equal(PERSONAS.filter((p) => p.gender === 'woman').length, 8);
  assert.equal(PERSONAS.filter((p) => p.gender === 'man').length, 8);
  assert.equal(new Set(PERSONAS.map((p) => [...p.top_values].sort().join('+'))).size, 16, '16 distinct top-3 sets');
  assert.equal(new Set(PERSONAS.map((p) => JSON.stringify(p.values))).size, 16, '16 pairwise different profiles');
  // #4116's table, spot-checked: the risk words and the top 3 in order.
  assert.deepEqual([personaOf('orrin')!.risk, personaOf('ilyse')!.risk, personaOf('draxen')!.risk, personaOf('solen')!.risk], [1, 5, 5, 3]);
  assert.deepEqual(personaOf('vesta')!.top_values, ['integrity', 'stewardship', 'collaboration']);
  assert.deepEqual(personaOf('draxen')!.top_values, ['ambition', 'resilience', 'integrity']);
  assert.equal(personaOf('vesta')!.tagline, 'No gate opens without its seal.');
  assert.deepEqual(valueScores(['curiosity', 'ambition', 'resilience']),
    { curiosity: TOP_SCORES[0], ambition: TOP_SCORES[1], resilience: TOP_SCORES[2], integrity: REST_SCORES[0], stewardship: REST_SCORES[1], collaboration: REST_SCORES[2] });
  // The legend is axalFit's words, not a copy.
  assert.deepEqual(VALUE_LEGEND.map((v) => v.key), [...FIT_V2_VALUES]);
  assert.match(VALUE_LEGEND.find((v) => v.key === 'integrity')!.description, /owns mistakes/);
});

// 2 ───────────────────────────────────────────────────────────────────────────
test('natural fit: two different areas, the highest value pairs, ties in the radar order', () => {
  // Mutations checked: the tie-break dropped (sort by score only, reversed input) → Vesta's finance-before-legal fails;
  // AREA_VALUES.engineering pointed at curiosity → Corvane's fit changes and fails.
  for (const p of PERSONAS) {
    assert.equal(p.natural_fit.length, 2);
    assert.notEqual(p.natural_fit[0], p.natural_fit[1]);
    for (const a of p.natural_fit) assert.ok(AREAS.includes(a), `${p.key}: ${a}`);
    const sum = (a: string) => p.values[AREA_VALUES[a as keyof typeof AREA_VALUES][0]] + p.values[AREA_VALUES[a as keyof typeof AREA_VALUES][1]];
    const best = Math.max(...AREAS.map(sum));
    assert.ok(Math.abs(sum(p.natural_fit[0]) - best) < 1e-9, `${p.key}: the first fit is a best area`);
  }
  assert.deepEqual(personaOf('vesta')!.natural_fit, ['finance', 'legal']);
  assert.deepEqual(personaOf('ilyse')!.natural_fit, ['gtm', 'capital']);
  assert.deepEqual(personaOf('kade')!.natural_fit, ['product', 'marketing']);
  assert.deepEqual(personaOf('corvane')!.natural_fit, ['engineering', 'finance']);
  assert.deepEqual(naturalFit(valueScores(['collaboration', 'stewardship', 'integrity'])), ['design', 'finance']);
});

// 3 ───────────────────────────────────────────────────────────────────────────
test('immutable: the catalogue is frozen, a DTO is a copy, and no route writes a persona', async () => {
  // Mutations checked: Object.freeze dropped from a persona's values → the throw assert fails; personaDto returning p.values
  // itself → the copy assert fails; a PUT /personas route added → the 404 assert fails.
  assert.ok(Object.isFrozen(PERSONAS));
  for (const p of PERSONAS) { assert.ok(Object.isFrozen(p)); assert.ok(Object.isFrozen(p.values)); assert.ok(Object.isFrozen(p.natural_fit)); }
  assert.throws(() => { (personaOf('vesta')!.values as any).integrity = 0; });
  const dto = personaDto(personaOf('vesta')!);
  dto.values.integrity = 0; dto.natural_fit[0] = 'gtm';
  assert.equal(personaOf('vesta')!.values.integrity, TOP_SCORES[0]);
  assert.equal(personaOf('vesta')!.natural_fit[0], 'finance');
  const w = world();
  for (const m of ['POST', 'PUT', 'PATCH', 'DELETE']) assert.equal((await call(w, EDITOR, m, '/personas', { name: 'X' })).status, 404, m);
  const r = await call(w, MEMBER, 'GET', '/personas');
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.personas.map((p: any) => p.key), KEYS);
  assert.deepEqual(r.body.values.map((v: any) => v.key), [...FIT_V2_VALUES]);
  assert.deepEqual(r.body.areas, [...AREAS]);
  // D4158 (#4158): the gallery also carries the team defaults HQ set for each persona (null until set).
  assert.deepEqual(Object.keys(r.body.personas[0]).sort(),
    ['avatar', 'defaults', 'gender', 'goal', 'key', 'name', 'natural_fit', 'personality', 'risk', 'story', 'tagline', 'top_values', 'values']);
  assert.deepEqual(r.body.personas[0].defaults, { model: null, start_cap_usd: null, max_cap_usd: null });
  noTitles(r.text, 'GET /personas');
});

// 4 ───────────────────────────────────────────────────────────────────────────
test('the backfill: every existing agent wears its role\'s persona, and the eleven are all different', () => {
  // Mutations checked: the CASE's cfo branch pointed at 'vesta' → both the map-equality and the distinct asserts fail;
  // a branch removed → that role's agent keeps NULL and the per-role assert fails.
  const values = Object.values(ROLE_PERSONA);
  assert.deepEqual(Object.keys(ROLE_PERSONA).sort(), ROLES.map((r) => r.key).sort(), 'one persona for each of the eleven roles');
  assert.equal(new Set(values).size, values.length, 'all different, so the backfill cannot put a persona twice on a Team');
  for (const v of values) assert.ok(personaOf(v), v);
  // The migration's CASE is the same map as the code's.
  const caseMap = Object.fromEntries([...PERSONA_MIGRATION.matchAll(/WHEN '([a-z_]+)' THEN '([a-z]+)'/g)].map((m) => [m[1], m[2]]));
  assert.deepEqual(caseMap, { ...ROLE_PERSONA });
  // A Team with one agent in each role, before the migration; then the migration.
  const w = world({ migrate: false });
  const ins = w.db.prepare(`INSERT INTO team_agents (uid, scope_kind, company_id, role_key, model_id, sponsor_user_id, monthly_cap_microusd, created_by)
    VALUES (?, 'company', 1, ?, ?, ?, ?, ?)`);
  ROLES.forEach((r, i) => ins.run(`a${i}`, r.key, MODEL, EDITOR, CAP, EDITOR));
  w.db.exec(PERSONA_MIGRATION);
  for (const row of w.db.prepare('SELECT role_key, persona_key FROM team_agents').all() as any[]) {
    assert.equal(row.persona_key, ROLE_PERSONA[row.role_key], row.role_key);
  }
});

// 5 ───────────────────────────────────────────────────────────────────────────
test('one live agent per persona per Team: persona_on_team, freed on removal, separate between Teams, held by the index', async () => {
  // Mutations checked: the pre-insert persona check dropped → the index still answers, and the catch must map it
  // (dropping the /persona/ branch → role_taken comes back and fails); the index's status filter dropped → the
  // re-add after removal fails; the role check moved after the persona check → the both-taken role_taken assert fails
  // (dropping it alone is equivalent: the role's own index still answers role_taken).
  const w = world();
  const first = await call(w, EDITOR, 'POST', `${CO}/agents`, add({ persona_key: 'vesta' }));
  assert.equal(first.status, 201);
  assert.equal(first.body.agent.persona.key, 'vesta');
  const again = await call(w, EDITOR, 'POST', `${CO}/agents`, add({ role_key: 'cto', persona_key: 'vesta' }));
  assert.equal(again.status, 409);
  assert.equal(again.body.error, 'persona_on_team');
  assert.equal(again.body.persona_key, 'vesta');
  // A second agent in the role is role_taken, whichever persona it would wear.
  assert.equal((await call(w, EDITOR, 'POST', `${CO}/agents`, add({ persona_key: 'orrin' }))).body.error, 'role_taken');
  // Another Team may have Vesta too.
  assert.equal((await call(w, EDITOR, 'POST', `${CO2}/agents`, add({ persona_key: 'vesta' }))).status, 201);
  // No persona_key: the role's default persona.
  const cto = await call(w, EDITOR, 'POST', `${CO}/agents`, add({ role_key: 'cto' }));
  assert.equal(cto.body.agent.persona.key, 'corvane');
  // Both taken (the CFO role by Vesta, Corvane by the CTO): the role answers first.
  assert.equal((await call(w, EDITOR, 'POST', `${CO}/agents`, add({ persona_key: 'corvane' }))).body.error, 'role_taken');
  assert.equal((await call(w, EDITOR, 'POST', `${CO}/agents`, add({ role_key: 'cmo', persona_key: 'nobody' }))).body.error, 'invalid_persona');
  // Removing Vesta frees her.
  assert.equal((await call(w, EDITOR, 'DELETE', `/agents/${first.body.agent.uid}`)).status, 200);
  assert.equal((await call(w, EDITOR, 'POST', `${CO}/agents`, add({ role_key: 'cmo', persona_key: 'vesta' }))).status, 201);
  // The index holds even past the route.
  assert.throws(() => w.db.prepare(`INSERT INTO team_agents (uid, scope_kind, company_id, role_key, persona_key, model_id, sponsor_user_id, monthly_cap_microusd, created_by)
    VALUES ('raw', 'company', 1, 'sales', 'vesta', ?, ?, ?, ?)`).run(MODEL, EDITOR, CAP, EDITOR), /UNIQUE/);
});

// 6 ───────────────────────────────────────────────────────────────────────────
test('no job title, outlook, trade-off or Schwartz value reaches the client in an agent DTO', async () => {
  // Mutations checked: role_name put back on agentDto → the list, profile and patch asserts fail; the persona DTO given
  // a `philosophy` field → the GET /personas and list asserts fail.
  const w = world();
  const a = await call(w, EDITOR, 'POST', `${CO}/agents`, add({ role_key: 'general_counsel', persona_key: 'vesta' }));
  assert.equal(a.status, 201);
  noTitles(a.text, 'POST agents');
  const list = await call(w, MEMBER, 'GET', `${CO}/agents`);
  assert.equal(list.status, 200);
  assert.deepEqual(list.body.agents.map((x: any) => x.persona.name), ['Vesta']);
  noTitles(list.text, 'GET agents');
  const one = await call(w, MEMBER, 'GET', `/agents/${a.body.agent.uid}`);
  assert.equal(one.status, 200);
  assert.equal(one.body.agent.persona.name, 'Vesta');
  noTitles(JSON.stringify(one.body.agent), 'GET agent');
  const patched = await call(w, EDITOR, 'PATCH', `/agents/${a.body.agent.uid}`, { status: 'paused' });
  assert.equal(patched.status, 200);
  noTitles(patched.text, 'PATCH agent');
});
