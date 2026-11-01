// D1612 part A2 (#3956, of #3945) — an agent's skills, assigning a skill to
// agents, the agent's radar and values, and team coverage.
//
//   · the radar takes the highest level per axis, an axis no tag reaches is
//     null, and an agent with no skills has radar: null (never zeros);
//   · the role and tool gates on PUT, on assign and on add-agent, with A2's
//     codes (role_mismatch, tool_not_approved with the tool, skill_retired,
//     version_not_published, not_manager);
//   · assign is partial and names each refusal;
//   · a retired skill stays pinned and readable;
//   · coverage marks an axis only agents cover;
//   · nobody sees another company's agents; people are named, never by email.
//
// Real SQLite with migrations 089, 091, 712 and 759 over the baseline's tables.
// Each case names the mutations it was checked against.
//
//   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
//     --test cloudflare-worker/test/team_agent_skills_d1612.test.ts
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
import teamAgents from '../src/routes/team_agents.ts';
import { axesOf } from '../src/services/agents/skillLinks.ts';

const sql = (f: string) => readFileSync(new URL(`../sql/${f}`, import.meta.url), 'utf8');
const BASELINE = sql('schema_baseline.sql');
const MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';

const SUPER = 1, ADMIN = 2, EDITOR = 10, MEMBER = 11, STRANGER = 12, OTHER_EDITOR = 13;
const IN_CO = 7, ALONE = 8;

function world() {
  const { DB, db } = makeD1(
    ['users', 'company_profiles', 'user_company_links', 'projects'].map((t) => stripForeignKeys(tableFromBaseline(BASELINE, t))).join('\n')
    + AI_LOG_SCHEMA + sql('migrations/506_ai_rail_proposals.sql'),
  );
  addColumnsFrom(db, sql('migrations/597_company_archive_and_events.sql'), 'company_profiles');
  db.exec(sql('migrations/199_super_admin.sql'));
  db.exec(sql('migrations/089_skills_values_taxonomy.sql'));
  db.exec(sql('migrations/712_team_agents.sql'));
  db.exec(sql('migrations/759_agent_skills.sql'));
  db.exec(sql('migrations/091_user_skill_profile.sql'));
  db.exec(`CREATE TABLE project_members (id INTEGER PRIMARY KEY AUTOINCREMENT, project_id INTEGER NOT NULL, user_id INTEGER NOT NULL,
    role TEXT NOT NULL DEFAULT 'cofounder', status TEXT NOT NULL DEFAULT 'accepted', source TEXT, invited_by INTEGER, created_at TEXT, updated_at TEXT)`);
  const user = db.prepare("INSERT INTO users (id, uid, email, name, role, founder_id, subscription_tier, subscription_status) VALUES (?, ?, ?, ?, ?, ?, 'growth', 'active')");
  user.run(SUPER, 'u-super', 'super@example.test', 'Sue Super', 'admin', null);
  user.run(ADMIN, 'u-admin', 'admin@example.test', 'Ada Admin', 'admin', null);
  user.run(EDITOR, 'u-editor', 'editor@example.test', 'Eve Editor', 'founder', 100);
  user.run(MEMBER, 'u-member', 'member@example.test', 'Max Member', 'founder', 101);
  user.run(STRANGER, 'u-stranger', 'stranger@example.test', 'Sam Stranger', 'founder', 102);
  user.run(OTHER_EDITOR, 'u-other', 'other@example.test', 'Oli Other', 'founder', 103);
  db.prepare('INSERT INTO super_admins (user_id) VALUES (?)').run(SUPER);
  db.exec(`INSERT INTO company_profiles (id, uid, company_name) VALUES (1, 'co-uid-1', 'Acme'), (2, 'co-uid-2', 'Globex')`);
  const link = db.prepare('INSERT INTO user_company_links (uid, user_id, company_id, role_in_company) VALUES (?, ?, ?, ?)');
  link.run('l1', EDITOR, 1, 'Founder'); link.run('l2', MEMBER, 1, 'Member'); link.run('l3', OTHER_EDITOR, 2, 'Owner');
  db.prepare('INSERT INTO projects (id, uid, name, founder_id, company_id) VALUES (?, ?, ?, 100, ?)').run(IN_CO, 'p7', 'Rocket', 1);
  db.prepare('INSERT INTO projects (id, uid, name, founder_id, company_id) VALUES (?, ?, ?, 100, NULL)').run(ALONE, 'p8', 'Solo');
  // The /studio taxonomy, as 090 seeds it (two axes are enough).
  db.exec(`INSERT INTO skills (slug, category_slug, label) VALUES
    ('investor_reporting', 'finance_ops', 'Investor reporting'), ('fp_and_a', 'finance_ops', 'FP&A'),
    ('investor_relations', 'capital_network', 'Investor relations'), ('product_strategy', 'product', 'Product strategy')`);
  const agent = db.prepare(`INSERT INTO team_agents (uid, scope_kind, company_id, project_id, role_key, first_name, model_id, tool_grants_json, sponsor_user_id, monthly_cap_microusd, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ${EDITOR}, 5000000, ${EDITOR})`);
  agent.run('a'.repeat(32), 'company', 1, null, 'cfo', 'Carla', MODEL, '[]');
  agent.run('b'.repeat(32), 'company', 1, null, 'investor_relations', 'Ivy', MODEL, JSON.stringify([{ integration_uid: 'i1', tool: 'hubspot.read_contacts' }]));
  agent.run('c'.repeat(32), 'project', null, IN_CO, 'cfo', 'Rory', MODEL, '[]');
  agent.run('d'.repeat(32), 'project', null, ALONE, 'cfo', 'Solo', MODEL, '[]');
  agent.run('e'.repeat(32), 'company', 2, null, 'cfo', 'Gil', MODEL, '[]');
  const env: any = { DB, JWT_SECRET: 'd1612-fixture-only-secret', ENVIRONMENT: 'development', TEAM_AGENTS_ENABLED: 'true' };
  return { db, env };
}
type W = ReturnType<typeof world>;
const CFO = 'a'.repeat(32), IR = 'b'.repeat(32), PROJECT_CFO = 'c'.repeat(32), SOLO_CFO = 'd'.repeat(32), GLOBEX_CFO = 'e'.repeat(32);

function app() {
  const a = new Hono();
  a.onError((e: any, c) => {
    const status = AUTH_ERROR_STATUSES[e?.message];
    return status ? c.json({ detail: e.message }, status) : c.json({ detail: 'Internal server error', m: String(e?.message) }, 500);
  });
  a.route('/api/teams', teamSkills);
  a.route('/api/teams', teamAgents);
  return a;
}
async function call(w: W, who: number, method: string, path: string, body?: unknown, company?: number) {
  const jwt = await new SignJWT({ user_id: who }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(w.env.JWT_SECRET));
  const headers: Record<string, string> = { Authorization: `Bearer ${jwt}`, 'content-type': 'application/json' };
  if (company != null) headers['X-Company-Id'] = String(company);
  const r = await app().request(`/api/teams${path}`, { method, headers,
    body: body === undefined ? undefined : JSON.stringify(body) }, w.env);
  const text = await r.text();
  return { status: r.status, body: (text ? JSON.parse(text) : null) as any, text };
}

const update = (over: Record<string, unknown> = {}) => ({
  scope: 'hq', name: 'Draft the monthly investor update', purpose: 'From recorded metrics, a draft update for investors.',
  steps: ['Read the last three months of recorded metrics', 'Write the highlights and the asks'],
  tools: [], output_kind: 'draft', roles: ['cfo', 'investor_relations'],
  tags: [{ slug: 'investor_reporting', level: 'proficient' }, { slug: 'investor_relations', level: 'working' }], ...over,
});
async function published(w: W, body: Record<string, unknown>, who = SUPER) {
  const made = await call(w, who, 'POST', '/skills', body);
  assert.equal(made.status, 201, made.text);
  const pub = await call(w, who, 'POST', `/skills/${made.body.skill.uid}/publish`);
  assert.equal(pub.status, 200, pub.text);
  return made.body.skill.uid as string;
}


/** No answer names a person by email or a numeric user id. */
function noPrivate(text: string) {
  assert.ok(!/@example\.test/.test(text), 'an email address');
  assert.ok(!/"(email|user_id|sponsor_user_id|linked_by|created_by)"\s*:/.test(text), 'an email or numeric id key');
}
const links = (w: W) => w.db.prepare('SELECT a.uid AS agent, s.uid AS skill, l.version FROM agent_skill_links l JOIN team_agents a ON a.id = l.agent_id JOIN agent_skills s ON s.id = l.skill_id ORDER BY l.id').all() as any[];

test('A2 radar: the highest level per axis, null where no tag reaches, and radar: null with no skills', async () => {
  // Mutations checked: axesOf keeping the lowest level → the finance_ops assert fails; an untagged axis as 0 →
  // the product null assert fails; radar as eight nulls for no skills → the radar null assert fails.
  const w = world();
  const a = await published(w, update({ roles: ['cfo'], tags: [{ slug: 'investor_reporting', level: 'working' }, { slug: 'investor_relations', level: 'working' }] }));
  const b = await published(w, update({ name: 'FP&A pass', roles: ['cfo'], tags: [{ slug: 'fp_and_a', level: 'expert' }] }));
  const none = await call(w, MEMBER, 'GET', `/agents/${CFO}/skills`);
  assert.deepEqual([none.status, none.body.radar, none.body.values, none.body.skills, none.body.can_manage], [200, null, null, [], false]);
  const put = await call(w, EDITOR, 'PUT', `/agents/${CFO}/skills`, { skills: [{ uid: a, version: 1 }, { uid: b }] });
  assert.equal(put.status, 200, put.text);
  const axes = Object.fromEntries(put.body.radar.axes.map((x: any) => [x.slug, x.level]));
  assert.equal(put.body.radar.axes.length, 8);
  assert.equal(axes.finance_ops, 5, 'expert beats working on the same axis');
  assert.equal(axes.capital_network, 2);
  assert.equal(axes.product, null, 'no tag reaches it: null, never 0');
  const skill = put.body.skills[0];
  assert.deepEqual([skill.uid, skill.name, skill.pinned_version, skill.current_version, skill.status], [a, 'Draft the monthly investor update', 1, 1, 'published']);
  assert.deepEqual(skill.taxonomy[0], { slug: 'investor_reporting', label: 'Investor reporting', level: 'working' });
  assert.deepEqual(axesOf([], new Map()).map((x) => x.level), Array(8).fill(null));
  noPrivate(put.text);
});

test('A2 gates on PUT: role_mismatch, tool_not_approved with the tool, version_not_published, not_manager', async () => {
  // Mutations checked: the role check dropped → role_mismatch fails; missingTools ignored → tool_not_approved fails;
  // a version above current_version accepted → version_not_published fails.
  const w = world();
  const forIr = await published(w, update({ name: 'CRM digest', roles: ['investor_relations'], tools: ['hubspot.read_contacts'] }));
  const deals = await published(w, update({ name: 'Pipeline read', roles: ['investor_relations'], tools: ['hubspot.read_deals'] }));
  const r1 = await call(w, EDITOR, 'PUT', `/agents/${CFO}/skills`, { skills: [{ uid: forIr }] });
  assert.deepEqual([r1.status, r1.body.error, r1.body.skill_uid], [422, 'role_mismatch', forIr]);
  const r2 = await call(w, EDITOR, 'PUT', `/agents/${IR}/skills`, { skills: [{ uid: deals }] });
  assert.deepEqual([r2.status, r2.body.error, r2.body.tool], [422, 'tool_not_approved', { key: 'hubspot.read_deals', label: 'hubspot.read_deals' }]);
  const r3 = await call(w, EDITOR, 'PUT', `/agents/${IR}/skills`, { skills: [{ uid: forIr, version: 2 }] });
  assert.deepEqual([r3.status, r3.body.error], [422, 'version_not_published']);
  assert.deepEqual([(await call(w, MEMBER, 'PUT', `/agents/${IR}/skills`, { skills: [] })).status], [403]);
  assert.equal((await call(w, MEMBER, 'PUT', `/agents/${IR}/skills`, { skills: [] })).body.error, 'not_manager');
  const ok = await call(w, EDITOR, 'PUT', `/agents/${IR}/skills`, { skills: [{ uid: forIr }] });
  assert.equal(ok.status, 200);
  assert.deepEqual(ok.body.skills[0].tools, [{ key: 'hubspot.read_contacts', label: 'hubspot.read_contacts', approved: true }]);
  assert.deepEqual(links(w).map((l) => l.agent), [IR], 'nothing refused was written');
});

test('A2 available: the role\'s published skills, most used first, a missing tool shown as blocked', async () => {
  const w = world();
  const plain = await published(w, update({ name: 'CRM digest', roles: ['investor_relations'], tools: ['hubspot.read_contacts'] }));
  const deals = await published(w, update({ name: 'Pipeline read', roles: ['investor_relations'], tools: ['hubspot.read_deals'] }));
  await published(w, update({ name: 'CFO only', roles: ['cfo'] }));
  await call(w, SUPER, 'POST', '/skills', update({ name: 'Never published', roles: ['investor_relations'] }));
  await call(w, EDITOR, 'POST', `/skills/${plain}/assign`, { agent_uids: [IR] });
  const r = await call(w, MEMBER, 'GET', `/agents/${IR}/skills/available`);
  assert.equal(r.status, 200, r.text);
  assert.deepEqual(r.body.skills.map((s: any) => s.uid), [plain, deals], 'the role\'s published skills, most used first');
  assert.deepEqual([r.body.skills[0].assigned, r.body.skills[0].blocked], [true, null]);
  assert.deepEqual(r.body.skills[1].blocked, { code: 'tool_not_approved', tool: { key: 'hubspot.read_deals', label: 'hubspot.read_deals' } });
  assert.equal((await call(w, STRANGER, 'GET', `/agents/${IR}/skills/available`)).status, 404);
});

test('A2 assign is partial: each agent it can is pinned at the current version, each it cannot is named', async () => {
  // Mutations checked: assign all-or-nothing again (a 409 on any refusal) → the status and added asserts fail;
  // the role gate dropped on assign → IR is added and the refused assert fails.
  const w = world();
  const uid = await published(w, update({ roles: ['cfo'] }));
  await call(w, SUPER, 'PATCH', `/skills/${uid}`, { name: 'Draft the monthly investor update, v2' });
  await call(w, SUPER, 'POST', `/skills/${uid}/publish`);
  const r = await call(w, EDITOR, 'POST', `/skills/${uid}/assign`, { agent_uids: [CFO, PROJECT_CFO, IR, GLOBEX_CFO, 'f'.repeat(32)] });
  assert.equal(r.status, 200);
  assert.equal(r.body.added, 2);
  assert.deepEqual(r.body.refused, [
    { agent_uid: IR, code: 'role_mismatch' }, { agent_uid: GLOBEX_CFO, code: 'not_found' }, { agent_uid: 'f'.repeat(32), code: 'not_found' },
  ]);
  assert.deepEqual(links(w).map((l) => [l.agent, l.version]), [[CFO, 2], [PROJECT_CFO, 2]], 'the current published version');
  const m = await call(w, MEMBER, 'POST', `/skills/${uid}/assign`, { agent_uids: [CFO] });
  assert.deepEqual([m.status, m.body.added, m.body.refused], [200, 0, [{ agent_uid: CFO, code: 'not_manager' }]]);

  // assignable: the role's agents the caller manages, with assigned, blocked and skill_count.
  const as = await call(w, EDITOR, 'GET', `/skills/${uid}/assignable`);
  assert.deepEqual(as.body.agents.map((a: any) => [a.uid, a.assigned, a.skill_count]), [[CFO, true, 1], [PROJECT_CFO, true, 1], [SOLO_CFO, false, 0]]);
  assert.deepEqual(as.body.agents[1].scope, { kind: 'project', company_name: 'Acme', project_name: 'Rocket' });
  assert.ok(!as.text.includes(GLOBEX_CFO), 'never another company\'s agent');
  assert.deepEqual((await call(w, MEMBER, 'GET', `/skills/${uid}/assignable`)).body.agents, [], 'a member manages none');
  noPrivate(as.text);

  // The company switcher narrows the list: an editor of both companies sees Globex's agent only with no company or Globex
  // chosen, and an agent on a project with no company under every choice (projectInActiveCompany's rule).
  // Mutation checked: dropping the active-company clause → the Acme-only assert lists GLOBEX_CFO.
  w.db.prepare("INSERT INTO user_company_links (uid, user_id, company_id, role_in_company) VALUES ('l4', ?, 2, 'Founder')").run(EDITOR);
  const uids = async (company?: number) => (await call(w, EDITOR, 'GET', `/skills/${uid}/assignable`, undefined, company)).body.agents.map((a: any) => a.uid).sort();
  assert.deepEqual(await uids(), [CFO, PROJECT_CFO, SOLO_CFO, GLOBEX_CFO].sort(), 'no company chosen: every company the editor belongs to');
  assert.deepEqual(await uids(1), [CFO, PROJECT_CFO, SOLO_CFO].sort(), 'Acme chosen: no Globex agent');
  assert.deepEqual(await uids(2), [SOLO_CFO, GLOBEX_CFO].sort(), 'Globex chosen: the unassigned project\'s agent stays');
});

test('A2 a retired skill stays pinned and readable, and cannot be added again', async () => {
  // Mutation checked: attachCheck refusing a retired skill even at its pinned version → the "kept" assert fails.
  const w = world();
  const uid = await published(w, update({ roles: ['cfo'] }));
  await call(w, EDITOR, 'PUT', `/agents/${CFO}/skills`, { skills: [{ uid }] });
  await call(w, SUPER, 'PATCH', `/skills/${uid}`, { status: 'retired' });
  const read = await call(w, MEMBER, 'GET', `/agents/${CFO}/skills`);
  assert.deepEqual([read.body.skills[0].status, read.body.skills[0].pinned_version, read.body.skills[0].update_available], ['retired', 1, false]);
  assert.equal((await call(w, EDITOR, 'PUT', `/agents/${CFO}/skills`, { skills: [{ uid }] })).status, 200, 'kept at its version');
  const again = await call(w, EDITOR, 'PUT', `/agents/${PROJECT_CFO}/skills`, { skills: [{ uid }] });
  assert.deepEqual([again.status, again.body.error], [409, 'skill_retired']);
  assert.deepEqual((await call(w, EDITOR, 'POST', `/skills/${uid}/assign`, { agent_uids: [PROJECT_CFO] })).body.refused, [{ agent_uid: PROJECT_CFO, code: 'skill_retired' }]);
});

test('A2 add-agent takes skills through the same gates; a refused skill adds no agent', async () => {
  // Mutation checked: the add route skipping checkSkillList → the role_mismatch and tool asserts fail.
  const w = world();
  w.db.exec(sql('migrations/465_ai_rail_preferences.sql'));
  const ir = await published(w, update({ name: 'CRM digest', roles: ['investor_relations'], tools: ['hubspot.read_contacts'] }));
  const cfo = await published(w, update({ name: 'Close the month', roles: ['cfo'] }));
  const body = (over: Record<string, unknown>) => ({ role_key: 'cfo', model_id: MODEL, monthly_cap_microusd: 5_000_000, ...over });
  const count = () => Number((w.db.prepare('SELECT COUNT(*) AS n FROM team_agents').get() as any).n);
  const before = count();
  const wrong = await call(w, EDITOR, 'POST', '/project/' + ALONE + '/agents', body({ role_key: 'cto', skills: [{ uid: cfo }] }));
  assert.deepEqual([wrong.status, wrong.body.error], [422, 'role_mismatch']);
  const tool = await call(w, EDITOR, 'POST', '/project/' + ALONE + '/agents', body({ role_key: 'investor_relations', skills: [{ uid: ir }] }));
  assert.deepEqual([tool.status, tool.body.error, tool.body.tool?.key], [422, 'tool_not_approved', 'hubspot.read_contacts'], 'the agent is granted no tool');
  assert.equal(count(), before, 'no agent was added');
  const ok = await call(w, EDITOR, 'POST', '/project/' + ALONE + '/agents', body({ role_key: 'coo', skills: [] }));
  assert.equal(ok.status, 201, ok.text);
  const withSkill = await call(w, EDITOR, 'POST', '/project/' + ALONE + '/agents', body({ role_key: 'ceo', skills: [{ uid: cfo }] }));
  assert.equal(withSkill.body.error, 'role_mismatch');
  w.db.exec("UPDATE team_agents SET status = 'removed' WHERE uid = '" + SOLO_CFO + "'");
  const added = await call(w, EDITOR, 'POST', '/project/' + ALONE + '/agents', body({ skills: [{ uid: cfo }] }));
  assert.equal(added.status, 201, added.text);
  assert.deepEqual(links(w).map((l) => [l.skill, l.version]), [[cfo, 1]]);
});

test('A2 coverage: per axis the people\'s highest level and the agents\'; an agent-only axis has people_level null', async () => {
  // Mutations checked: people_level from 0 self-ratings (0 counted as a level) → the null assert fails;
  // the agents read across every company → Globex's axis shows and the product assert fails.
  const w = world();
  const cap = await published(w, update({ roles: ['cfo'], tags: [{ slug: 'investor_relations', level: 'advanced' }] }));
  const prod = await published(w, update({ name: 'Roadmap read', roles: ['cfo'], tags: [{ slug: 'product_strategy', level: 'expert' }] }));
  await call(w, EDITOR, 'PUT', `/agents/${CFO}/skills`, { skills: [{ uid: cap }] });
  await call(w, OTHER_EDITOR, 'PUT', `/agents/${GLOBEX_CFO}/skills`, { skills: [{ uid: prod }] });
  const skill = (slug: string) => (w.db.prepare('SELECT id FROM skills WHERE slug = ?').get(slug) as any).id;
  w.db.prepare('INSERT INTO user_skills (user_id, skill_id, self_level) VALUES (?, ?, ?)').run(EDITOR, skill('fp_and_a'), 4);
  w.db.prepare('INSERT INTO user_skills (user_id, skill_id, self_level) VALUES (?, ?, ?)').run(MEMBER, skill('investor_reporting'), 2);
  w.db.prepare('INSERT INTO user_skills (user_id, skill_id, self_level) VALUES (?, ?, ?)').run(MEMBER, skill('investor_relations'), 0);
  w.db.prepare('INSERT INTO user_skills (user_id, skill_id, self_level) VALUES (?, ?, ?)').run(STRANGER, skill('product_strategy'), 5);
  const r = await call(w, MEMBER, 'GET', '/company/co-uid-1/coverage');
  assert.equal(r.status, 200, r.text);
  const by = Object.fromEntries(r.body.axes.map((x: any) => [x.slug, [x.people_level, x.agent_level]]));
  assert.equal(r.body.axes.length, 8);
  assert.deepEqual(by.finance_ops, [4, null], 'the people\'s highest');
  assert.deepEqual(by.capital_network, [null, 4], 'People gap · covered only by agents (a 0 self-rating is no level)');
  assert.deepEqual(by.product, [null, null], 'a stranger\'s rating and another company\'s agent count for nothing');
  assert.equal((await call(w, STRANGER, 'GET', '/company/co-uid-1/coverage')).status, 403);
  assert.equal((await call(w, MEMBER, 'GET', '/company/none/coverage')).status, 404);
  // A project team: its founder's ratings and its own agents.
  w.db.prepare('INSERT INTO user_skills (user_id, skill_id, self_level) VALUES (?, ?, ?)').run(EDITOR, skill('product_strategy'), 3);
  const p = await call(w, EDITOR, 'GET', `/project/${IN_CO}/coverage`);
  assert.deepEqual(Object.fromEntries(p.body.axes.map((x: any) => [x.slug, x.people_level])).product, 3);
});

test('A2 skill agents: only the agents the member can see, with their scope, by name and never by email', async () => {
  // Mutation checked: the canRead filter dropped → Globex's agent is listed to an Acme member.
  const w = world();
  const uid = await published(w, update({ roles: ['cfo'] }));
  await call(w, EDITOR, 'POST', `/skills/${uid}/assign`, { agent_uids: [CFO, PROJECT_CFO] });
  await call(w, OTHER_EDITOR, 'POST', `/skills/${uid}/assign`, { agent_uids: [GLOBEX_CFO] });
  const acme = await call(w, EDITOR, 'GET', `/skills/${uid}/agents`);
  assert.deepEqual(acme.body.agents.map((a: any) => [a.uid, a.name, a.pinned_version, a.scope.kind, a.scope.company_name, a.scope.project_name]), [
    [CFO, 'Carla', 1, 'company', 'Acme', null], [PROJECT_CFO, 'Rory', 1, 'project', 'Acme', 'Rocket'],
  ]);
  assert.deepEqual((await call(w, OTHER_EDITOR, 'GET', `/skills/${uid}/agents`)).body.agents.map((a: any) => a.uid), [GLOBEX_CFO]);
  assert.deepEqual((await call(w, ADMIN, 'GET', `/skills/${uid}/agents`)).body.agents.length, 3, "HQ's admin sees every team");
  noPrivate(acme.text);
});
