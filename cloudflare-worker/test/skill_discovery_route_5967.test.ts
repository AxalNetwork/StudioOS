// D4538 part 6 (#5967, of #4538) — POST /api/teams/skills/discover: the discovery service
// (`services/agents/skillDiscovery.ts`) served for an agent the caller manages.
//
//   · only a caller who can manage the agent gets an answer; a reader who cannot manage it, another company's
//     editor and an unknown uid all get the same 404;
//   · the agent's role and tool grants come from its row; a role, tools or a record in the body is refused 400
//     `field_not_accepted` naming the field;
//   · each invalid field has its own 400 code; `workflow_context` is accepted only as null (#4535);
//   · the route writes nothing: agent_skill_links, team_agent_events and agent_skills are unchanged;
//   · `no_suitable_skill` and `ambiguous` are 200; another company's skill is in neither list; HQ's suspension
//     blocks a skill (`skill_suspended`).
//
// Real SQLite with the same migrations as team_agent_skills_d1612.test.ts. Each case names the mutations it was
// checked against.
//
//   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
//     --test cloudflare-worker/test/skill_discovery_route_5967.test.ts
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

const sql = (f: string) => readFileSync(new URL(`../sql/${f}`, import.meta.url), 'utf8');
const BASELINE = sql('schema_baseline.sql');
const MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';

const SUPER = 1, ADMIN = 2, EDITOR = 10, MEMBER = 11, STRANGER = 12, OTHER_EDITOR = 13;

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
  db.exec(sql('migrations/202611022326_agent_skill_context_tokens.sql'));
  db.exec(sql('migrations/202611022055_agent_skill_moderation.sql'));
  db.exec(sql('migrations/202611022140_hq_skill_lifecycle.sql'));
  db.exec(sql('migrations/202611090904_skill_eval_result_identity.sql'));
  db.exec(sql('migrations/202611081919_skill_release_evidence.sql'));
  db.exec(sql('migrations/202611092030_skill_version_release_note.sql'));
  db.exec(sql('migrations/202611070826_team_agent_skill_events.sql'));
  db.exec(sql('migrations/091_user_skill_profile.sql'));
  db.exec(`CREATE TABLE project_members (id INTEGER PRIMARY KEY AUTOINCREMENT, project_id INTEGER NOT NULL, user_id INTEGER NOT NULL,
    role TEXT NOT NULL DEFAULT 'cofounder', status TEXT NOT NULL DEFAULT 'accepted', source TEXT, invited_by INTEGER, created_at TEXT, updated_at TEXT)`);
  const user = db.prepare("INSERT INTO users (id, uid, email, name, role, founder_id, subscription_tier, subscription_status) VALUES (?, ?, ?, ?, ?, ?, 'growth', 'active')");
  user.run(SUPER, 'u-super', 'super@example.test', 'Sue Super', 'admin', null);
  user.run(ADMIN, 'u-admin', 'admin@example.test', 'Ada Admin', 'admin', null); // passHqGate's second reviewer
  user.run(EDITOR, 'u-editor', 'editor@example.test', 'Eve Editor', 'founder', 100);
  user.run(MEMBER, 'u-member', 'member@example.test', 'Max Member', 'founder', 101);
  user.run(STRANGER, 'u-stranger', 'stranger@example.test', 'Sam Stranger', 'founder', 102);
  user.run(OTHER_EDITOR, 'u-other', 'other@example.test', 'Oli Other', 'founder', 103);
  db.prepare('INSERT INTO super_admins (user_id) VALUES (?)').run(SUPER);
  db.exec(`INSERT INTO company_profiles (id, uid, company_name) VALUES (1, 'co-uid-1', 'Acme'), (2, 'co-uid-2', 'Globex')`);
  const link = db.prepare('INSERT INTO user_company_links (uid, user_id, company_id, role_in_company) VALUES (?, ?, ?, ?)');
  link.run('l1', EDITOR, 1, 'Founder'); link.run('l2', MEMBER, 1, 'Member'); link.run('l3', OTHER_EDITOR, 2, 'Owner');
  link.run('l4', SUPER, 1, 'Founder'); // HQ's admin with an editor's seat at Acme: manages Acme's agents, reads every company's skills
  db.exec(`INSERT INTO skills (slug, category_slug, label) VALUES
    ('investor_reporting', 'finance_ops', 'Investor reporting'), ('fp_and_a', 'finance_ops', 'FP&A'),
    ('investor_relations', 'capital_network', 'Investor relations'), ('product_strategy', 'product', 'Product strategy')`);
  const agent = db.prepare(`INSERT INTO team_agents (uid, scope_kind, company_id, project_id, role_key, first_name, model_id, tool_grants_json, sponsor_user_id, monthly_cap_microusd, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ${EDITOR}, 5000000, ${EDITOR})`);
  agent.run(CFO, 'company', 1, null, 'cfo', 'Carla', MODEL, '[]');
  agent.run(IR, 'company', 1, null, 'investor_relations', 'Ivy', MODEL, JSON.stringify([{ integration_uid: 'i1', tool: 'hubspot.read_contacts' }]));
  agent.run(GLOBEX_CFO, 'company', 2, null, 'cfo', 'Gil', MODEL, '[]');
  const env: any = { DB, JWT_SECRET: 'd5967-fixture-only-secret', ENVIRONMENT: 'development', TEAM_AGENTS_ENABLED: 'true' };
  return { db, env };
}
type W = ReturnType<typeof world>;
const CFO = 'a'.repeat(32), IR = 'b'.repeat(32), GLOBEX_CFO = 'e'.repeat(32);

function app() {
  const a = new Hono();
  a.onError((e: any, c) => {
    const status = AUTH_ERROR_STATUSES[e?.message];
    return status ? c.json({ detail: e.message }, status) : c.json({ detail: 'Internal server error', m: String(e?.message) }, 500);
  });
  // Production order (index.ts): team_agents before team_skills.
  a.route('/api/teams', teamAgents);
  a.route('/api/teams', teamSkills);
  return a;
}
async function call(w: W, who: number, method: string, path: string, body?: unknown) {
  const jwt = await new SignJWT({ user_id: who }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(w.env.JWT_SECRET));
  const r = await app().request(`/api/teams${path}`, {
    method, headers: { Authorization: `Bearer ${jwt}`, 'content-type': 'application/json' },
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  }, w.env);
  const text = await r.text();
  return { status: r.status, body: (text ? JSON.parse(text) : null) as any, text };
}
const discover = (w: W, who: number, body: unknown) => call(w, who, 'POST', '/skills/discover', body);

const skill = (over: Record<string, unknown> = {}) => ({
  scope: 'hq', name: 'Cash runway snapshot', purpose: 'Report months of runway from recorded balances and burn.',
  steps: ['Read the recorded cash balances', 'Divide by the monthly burn to report runway in months'],
  tools: [], output_kind: 'brief', roles: ['cfo'], tags: [{ slug: 'fp_and_a', level: 'proficient' }], ...over,
});
async function published(w: W, body: Record<string, unknown>, who = SUPER) {
  const made = await call(w, who, 'POST', '/skills', body);
  assert.equal(made.status, 201, made.text);
  if (body.scope === 'hq') await passHqGate(w.db, made.body.skill.uid);
  const pub = await call(w, who, 'POST', `/skills/${made.body.skill.uid}/publish`);
  assert.equal(pub.status, 200, pub.text);
  return made.body.skill.uid as string;
}

/** The library: a runway brief for cfo, a CRM digest needing a HubSpot tool, two close board briefs, Globex's own. */
async function library(w: W) {
  const runway = await published(w, skill());
  const crm = await published(w, skill({
    name: 'Investor contact digest', purpose: 'Summarise recent investor contacts and their runway questions from the CRM.',
    steps: ['Read investor contacts from the CRM', 'List who asked about runway'], tools: ['hubspot.read_contacts'],
    roles: ['cfo', 'investor_relations'], tags: [{ slug: 'investor_relations', level: 'working' }],
  }));
  const boardA = await published(w, skill({
    name: 'Board meeting brief', purpose: 'Prepare the board meeting brief from recorded metrics.',
    steps: ['Read the recorded metrics', 'Write the board meeting brief'], tags: [{ slug: 'investor_reporting', level: 'working' }],
  }));
  const boardB = await published(w, skill({
    name: 'Board meeting pack', purpose: 'Prepare the board meeting pack from recorded metrics.',
    steps: ['Read the recorded metrics', 'Write the board meeting pack'], tags: [{ slug: 'investor_reporting', level: 'working' }],
  }));
  const globex = await published(w, skill({
    scope: 'company', company: 'co-uid-2', name: 'Globex runway snapshot', purpose: 'Report months of runway from Globex balances and burn.',
  }), OTHER_EDITOR);
  return { runway, crm, boardA, boardB, globex };
}

/** Every row of the tables a write would touch, so a test can say nothing changed. */
const snapshot = (w: W) => JSON.stringify(['agent_skill_links', 'team_agent_events', 'agent_skills', 'agent_skill_versions', 'agent_skill_moderation']
  .map((t) => w.db.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all()));
const uids = (list: Array<{ skill_uid: string }>) => list.map((x) => x.skill_uid);

test('5967: a manager gets the service\'s answer for the agent, and nothing is written', async () => {
  // Mutations checked: the route returning `{ candidates: [] }` without calling the service → the recommend and
  // candidate asserts fail; an INSERT INTO agent_skill_links of the top candidate (an "attach") → the snapshot
  // assert fails; logEvent(…, 'skills_discovered') → the snapshot assert fails.
  const w = world();
  const lib = await library(w);
  w.db.prepare('INSERT INTO agent_skill_links (agent_id, skill_id, version, linked_by) SELECT a.id, s.id, 1, ? FROM team_agents a, agent_skills s WHERE a.uid = ? AND s.uid = ?')
    .run(EDITOR, CFO, lib.boardA);
  const before = snapshot(w);
  const linksBefore = w.db.prepare('SELECT * FROM agent_skill_links ORDER BY id').all();
  const r = await discover(w, EDITOR, { task: 'How many months of runway do we have from our balances and burn?', agent_uid: CFO });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.body.outcome, 'recommend');
  assert.equal(r.body.candidates[0].skill_uid, lib.runway);
  assert.equal(r.body.candidates[0].version, 1);
  assert.deepEqual(r.body.candidates[0].evaluation, { available: false, reason: 'Release evidence is not read by discovery yet (#4533).' });
  assert.equal(r.body.stages.length, 5);
  assert.equal(snapshot(w), before, 'the route wrote something');
  assert.deepEqual(w.db.prepare('SELECT * FROM agent_skill_links ORDER BY id').all(), linksBefore, 'agent_skill_links changed');
});

test('5967: only a manager gets an answer; a reader, another company\'s editor and an unknown uid all get the same 404', async () => {
  // Mutations checked: dropping `canManage` from the gate → the MEMBER (a reader) gets 200; dropping `canRead` and
  // `canManage` both → OTHER_EDITOR gets 200 for Acme's agent; 403 `not_manager` for a reader → the equality
  // with the unknown uid's body fails.
  const w = world();
  await library(w);
  const ask = { task: 'How many months of runway do we have?', agent_uid: CFO };
  const unknown = await discover(w, EDITOR, { ...ask, agent_uid: 'f'.repeat(32) });
  assert.equal(unknown.status, 404);
  assert.equal(unknown.body.error, 'not_found');
  for (const who of [MEMBER, OTHER_EDITOR, STRANGER]) {
    const r = await discover(w, who, ask);
    assert.equal(r.status, 404, `user ${who}: ${r.text}`);
    assert.deepEqual(r.body, unknown.body, `user ${who} is told something an unknown agent does not tell`);
  }
  const globex = await discover(w, EDITOR, { ...ask, agent_uid: GLOBEX_CFO });
  assert.deepEqual([globex.status, globex.body], [404, unknown.body]);
  assert.equal((await discover(w, OTHER_EDITOR, { ...ask, agent_uid: GLOBEX_CFO })).status, 200);
});

test('5967: the agent\'s role and grants come from its row; a role, tools or a record in the body is refused', async () => {
  // Mutations checked: `grantsOf` replaced by `[]` → the IR agent's digest is blocked; dropping the DISCOVER_KEYS
  // check (alone, or with grants read from `b.tools` too) → the refused-field asserts get 200.
  const w = world();
  const lib = await library(w);
  const task = 'Digest of investor contacts in the CRM who asked about runway';
  const cfo = await discover(w, EDITOR, { task, agent_uid: CFO });
  assert.equal(cfo.status, 200, cfo.text);
  assert.ok(!uids(cfo.body.candidates).includes(lib.crm), 'the CFO is offered a skill whose tool it is not granted');
  const blocked = cfo.body.blocked.find((b: any) => b.skill_uid === lib.crm);
  assert.deepEqual(blocked && { code: blocked.code, key: blocked.tool.key }, { code: 'tool_not_approved', key: 'hubspot.read_contacts' });
  const ir = await discover(w, EDITOR, { task, agent_uid: IR });
  assert.equal(ir.body.candidates[0]?.skill_uid, lib.crm, ir.text);
  for (const [field, value] of [
    ['role', 'investor_relations'], ['tools', ['hubspot.read_contacts']], ['tool_grants_json', '[]'],
    ['company_id', 2], ['records', [{ balance: 1 }]], ['connector_payload', { hubspot: [] }],
  ] as const) {
    const r = await discover(w, EDITOR, { task, agent_uid: CFO, [field]: value });
    assert.equal(r.status, 400, `${field}: ${r.text}`);
    assert.deepEqual([r.body.error, r.body.field], ['field_not_accepted', field]);
  }
});

test('5967: each invalid field is refused 400 with its own code, before the agent is looked up', async () => {
  // Mutations checked: workflow_context passed through unchecked → its assert gets 200; the taxonomy lookup
  // removed → the unknown slug gets 200; the agent_uid shape check removed → agent_uid_invalid becomes 404;
  // TASK_MAX bypassed → the 501-character task gets 200.
  const w = world();
  await library(w);
  const ok = { task: 'Months of runway', agent_uid: CFO };
  const cases: Array<[unknown, string]> = [
    ['not json', 'body_invalid'], [[ok], 'body_invalid'],
    [{ ...ok, agent_uid: undefined }, 'agent_uid_invalid'], [{ ...ok, agent_uid: 'nope' }, 'agent_uid_invalid'], [{ ...ok, agent_uid: 42 }, 'agent_uid_invalid'],
    [{ ...ok, workflow_context: { step: 'x' } }, 'workflow_context_invalid'], [{ ...ok, workflow_context: 'step-1' }, 'workflow_context_invalid'],
    [{ ...ok, task: '' }, 'task_invalid'], [{ ...ok, task: '   ' }, 'task_invalid'], [{ ...ok, task: 'x'.repeat(501) }, 'task_invalid'], [{ ...ok, task: 7 }, 'task_invalid'],
    [{ ...ok, output_kind: 'email' }, 'output_kind_invalid'],
    [{ ...ok, taxonomy_focus: ['fp_and_a', 'investor_reporting', 'investor_relations', 'product_strategy'] }, 'taxonomy_focus_invalid'],
    [{ ...ok, taxonomy_focus: 'fp_and_a' }, 'taxonomy_focus_invalid'], [{ ...ok, taxonomy_focus: ['not_a_taxonomy_slug'] }, 'taxonomy_focus_invalid'],
    [{ ...ok, limit: 0 }, 'limit_invalid'], [{ ...ok, limit: 11 }, 'limit_invalid'], [{ ...ok, limit: 2.5 }, 'limit_invalid'], [{ ...ok, limit: '5' }, 'limit_invalid'],
  ];
  for (const [body, code] of cases) {
    const r = await discover(w, EDITOR, body);
    assert.deepEqual([r.status, r.body?.error], [400, code], `${JSON.stringify(body)?.slice(0, 80)}: ${r.text}`);
  }
  // The bounds' edges are accepted: a 500-character task, three known slugs, limit 1 and 10, workflow_context null.
  for (const body of [
    { ...ok, task: `runway ${'x'.repeat(493)}` }, { ...ok, taxonomy_focus: ['fp_and_a', 'investor_reporting', 'investor_relations'] },
    { ...ok, limit: 1 }, { ...ok, limit: 10 }, { ...ok, workflow_context: null, output_kind: 'brief' },
  ]) {
    const r = await discover(w, EDITOR, body);
    assert.equal(r.status, 200, `${JSON.stringify(body).slice(0, 80)}: ${r.text}`);
  }
  const one = await discover(w, EDITOR, { task: 'Board meeting brief from recorded metrics', agent_uid: CFO, limit: 1 });
  assert.equal(one.body.candidates.length, 1);
});

test('5967: no_suitable_skill and ambiguous are 200 results; another company\'s skill is listed nowhere; HQ\'s suspension blocks', async () => {
  // Mutations checked: the catalogue query loading every company's skills AND the service's company gate removed →
  // Globex's skill appears for HQ's admin asking for Acme's CFO (either alone is caught by the other; for Acme's
  // editor `mayRead` is a third layer); `suspended` always false → the suspended runway skill stays a candidate;
  // a 422 for no_suitable_skill → its status assert fails.
  const w = world();
  const lib = await library(w);
  const email = await discover(w, EDITOR, { task: 'Send an email to our investors about runway', agent_uid: CFO });
  assert.deepEqual([email.status, email.body.outcome], [200, 'no_suitable_skill'], email.text);
  assert.match(email.body.abstain_reason, /send messages/);
  const board = await discover(w, EDITOR, { task: 'Board meeting', agent_uid: CFO });
  assert.deepEqual([board.status, board.body.outcome], [200, 'ambiguous'], board.text);
  assert.ok(board.body.clarify);
  assert.ok(board.body.candidates.every((x: any) => x.confidence === 'low'));

  const runway = await discover(w, EDITOR, { task: 'Report months of runway from balances and burn', agent_uid: CFO });
  assert.ok(!runway.text.includes(lib.globex), 'another company\'s skill is named');
  assert.ok(!runway.text.includes('Globex runway snapshot'), 'another company\'s skill is named');
  // HQ's admin (an Acme editor too) reads every company's skills, so only the agent's company keeps Globex's out.
  const asHq = await discover(w, SUPER, { task: 'Report months of runway from balances and burn', agent_uid: CFO });
  assert.equal(asHq.status, 200, asHq.text);
  assert.ok(uids(asHq.body.candidates).includes(lib.runway), asHq.text);
  assert.ok(!asHq.text.includes(lib.globex), 'another company\'s skill is named to HQ for Acme\'s agent');
  const globexOwn = await discover(w, OTHER_EDITOR, { task: 'Report months of runway from Globex balances and burn', agent_uid: GLOBEX_CFO });
  assert.ok(uids(globexOwn.body.candidates).includes(lib.globex), globexOwn.text);

  w.db.prepare(`INSERT INTO agent_skill_moderation (skill_id, action, version, reason, created_by)
    SELECT id, 'suspend', 1, 'Suspended for this test only.', ? FROM agent_skills WHERE uid = ?`).run(SUPER, lib.runway);
  const before = snapshot(w);
  const after = await discover(w, EDITOR, { task: 'Report months of runway from balances and burn', agent_uid: CFO });
  assert.equal(after.status, 200);
  assert.ok(!uids(after.body.candidates).includes(lib.runway), 'a suspended skill is offered');
  assert.equal(after.body.blocked.find((b: any) => b.skill_uid === lib.runway)?.code, 'skill_suspended', after.text);
  assert.equal(snapshot(w), before);
});
