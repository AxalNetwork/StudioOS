// D1612 (#3951, part A of #3945) — the agent skill library at /api/teams.
//
//   1. Read: HQ skills for every member, a company's skills for its members
//      only, drafts for their writers only.
//   2. Write: HQ skills by a Super Admin only, company skills by its editors;
//      a draft is checked (taxonomy tags, roles, tools, output).
//   3. Publish: an immutable version with its SKILL.md; an agent pinned to
//      v1 stays on v1 until "Update to v2".
//   4. Attach: the agent's role, its approved tools, its company, a published
//      version, an editor of its scope; each refusal is a sentence and
//      nothing is written.
//   5. Assign one skill to several agents, all or nothing.
//   6. The agent's radar: the 8 axes on the person's 0–5 scale, "Not
//      recorded" where no skill tags an axis.
//   7. A pasted SKILL.md lands as a draft and round-trips; an unreadable one is refused.
//
// Real SQLite: the baseline's tables, 089 (the taxonomy), 199 (Super Admin),
// 597, 712 and 759.
//
//   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
//     --test cloudflare-worker/test/team_skills_d1612.test.ts
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
import { checkDraft, parseSkillMd, skillsRadar, toSkillMd, missingTools } from '../src/services/agents/skills.ts';

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
  return a;
}
async function call(w: W, who: number, method: string, path: string, body?: unknown) {
  const jwt = await new SignJWT({ user_id: who }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(w.env.JWT_SECRET));
  const r = await app().request(`/api/teams${path}`, { method, headers: { Authorization: `Bearer ${jwt}`, 'content-type': 'application/json' },
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

test('D1612: HQ skills are for every member, a company\'s for its members, drafts for their writers', async () => {
  const w = world();
  const hq = await published(w, update());
  const hqDraft = (await call(w, SUPER, 'POST', '/skills', update({ name: 'Unfinished HQ skill' }))).body.skill.uid;
  const mine = await published(w, update({ scope: 'company', company: 'co-uid-1', name: 'Acme board brief', roles: ['cfo'] }), EDITOR);
  const myDraft = (await call(w, EDITOR, 'POST', '/skills', update({ scope: 'company', company: 'co-uid-1', name: 'Acme draft' }))).body.skill.uid;

  const member = await call(w, MEMBER, 'GET', '/skills?company=co-uid-1');
  assert.equal(member.status, 200);
  assert.deepEqual(member.body.hq.map((s: any) => s.uid), [hq]);
  assert.deepEqual(member.body.company.skills.map((s: any) => s.uid), [mine]);
  assert.equal(member.body.company.can_write, false);
  assert.equal(member.body.hq[0].author, 'Axal');
  assert.equal(member.body.company.skills[0].author, 'Acme');
  assert.equal(member.body.hq[0].draft, undefined, 'a reader sees no draft');

  const editor = await call(w, EDITOR, 'GET', '/skills?company=co-uid-1');
  assert.deepEqual(editor.body.company.skills.map((s: any) => s.uid).sort(), [mine, myDraft].sort());
  assert.ok(!editor.body.hq.some((s: any) => s.uid === hqDraft), 'an HQ draft is the Super Admin\'s');
  assert.ok((await call(w, SUPER, 'GET', '/skills')).body.hq.some((s: any) => s.uid === hqDraft));

  assert.equal((await call(w, STRANGER, 'GET', '/skills?company=co-uid-1')).status, 404);
  const stranger = await call(w, STRANGER, 'GET', '/skills');
  assert.deepEqual(stranger.body.hq.map((s: any) => s.uid), [hq]);
  assert.equal(stranger.body.company, null);
  assert.equal((await call(w, STRANGER, 'GET', `/skills/${mine}`)).status, 404);
  assert.equal((await call(w, MEMBER, 'GET', `/skills/${myDraft}`)).status, 404);
  assert.equal((await call(w, OTHER_EDITOR, 'GET', `/skills/${mine}`)).status, 404);

  // Filters: role, category, search, and the role grid's counts.
  assert.deepEqual((await call(w, MEMBER, 'GET', '/skills?company=co-uid-1&role=investor_relations')).body.company.skills, []);
  assert.equal((await call(w, MEMBER, 'GET', '/skills?company=co-uid-1&category=product')).body.hq.length, 0);
  assert.equal((await call(w, MEMBER, 'GET', '/skills?company=co-uid-1&q=BOARD')).body.company.skills.length, 1);
  const cfo = member.body.roles.find((r: any) => r.key === 'cfo');
  assert.deepEqual([cfo.skills, cfo.agents], [2, 2]);
  assert.equal((await call(w, MEMBER, 'GET', '/skills?role=astronaut')).body.error, 'role_unknown');
  assert.ok(!/@example\.test|"email"/.test(member.text + editor.text));
});

test('D1612: HQ skills are written by a Super Admin, company skills by its editors, and every draft is checked', async () => {
  const w = world();
  assert.equal((await call(w, ADMIN, 'POST', '/skills', update())).status, 403, 'an admin without Super Admin');
  assert.equal((await call(w, EDITOR, 'POST', '/skills', update())).status, 403);
  assert.equal((await call(w, MEMBER, 'POST', '/skills', update({ scope: 'company', company: 'co-uid-1' }))).status, 403);
  assert.equal((await call(w, OTHER_EDITOR, 'POST', '/skills', update({ scope: 'company', company: 'co-uid-1' }))).status, 404);
  assert.equal((await call(w, EDITOR, 'POST', '/skills', update({ scope: 'company', company: 'co-uid-1' }))).status, 201);
  const refused = async (over: Record<string, unknown>) => (await call(w, SUPER, 'POST', '/skills', update(over))).body.error;
  assert.equal(await refused({ tags: [{ slug: 'astrology', level: 'expert' }] }), 'tag_unknown');
  assert.equal(await refused({ tags: [{ slug: 'fp_and_a', level: 'guru' }] }), 'tags_invalid');
  assert.equal(await refused({ tags: [] }), 'tags_invalid');
  assert.equal(await refused({ roles: [] }), 'roles_missing');
  assert.equal(await refused({ roles: ['astronaut'] }), 'role_unknown');
  assert.equal(await refused({ tools: ['DROP TABLE'] }), 'tools_invalid');
  assert.equal(await refused({ output_kind: 'email' }), 'output_invalid');
  assert.equal(await refused({ steps: [] }), 'steps_invalid');
  assert.equal(await refused({ name: '' }), 'name_missing');
  assert.equal((await call(w, SUPER, 'POST', '/skills', update())).status, 201);
  assert.equal((await call(w, SUPER, 'POST', '/skills', update())).body.error, 'slug_taken');
});

test('D1612: a published version is immutable; a pinned agent stays on it until "Update to v2"', async () => {
  const w = world();
  const uid = await published(w, update());
  const v1 = w.db.prepare('SELECT * FROM agent_skill_versions').get() as any;
  assert.equal(v1.version, 1);
  assert.match(v1.skill_md, /^---\nname: "Draft the monthly investor update"\n/);
  assert.throws(() => w.db.prepare('UPDATE agent_skill_versions SET name = ? WHERE id = ?').run('changed', v1.id), /immutable/);
  assert.equal((await call(w, EDITOR, 'PUT', `/agents/${CFO}/skills`, { skills: [uid] })).status, 200);

  // Edit and publish v2: the agent keeps v1.
  assert.equal((await call(w, SUPER, 'PATCH', `/skills/${uid}`, { steps: ['Read the metrics', 'Draft', 'List the asks'] })).status, 200);
  assert.equal((await call(w, EDITOR, 'PATCH', `/skills/${uid}`, { name: 'Taken over' })).status, 403);
  const reader = await call(w, MEMBER, 'GET', `/skills/${uid}`);
  assert.equal(reader.body.skill.steps.length, 2, 'readers see the published version, not the edit');
  assert.equal((await call(w, SUPER, 'POST', `/skills/${uid}/publish`)).body.skill.version, 2);
  let mine = await call(w, MEMBER, 'GET', `/agents/${CFO}/skills`);
  assert.equal(mine.body.skills[0].version, 1);
  assert.equal(mine.body.skills[0].latest_version, 2);
  assert.equal(mine.body.skills[0].update_available, true);
  assert.equal(mine.body.skills[0].steps.length, 2, 'the pinned version\'s steps');
  assert.equal(mine.body.can_manage, false);
  assert.equal((await call(w, EDITOR, 'PUT', `/agents/${CFO}/skills`, { skills: [{ uid, version: 2 }] })).body.skills[0].version, 2);
  mine = await call(w, EDITOR, 'GET', `/agents/${CFO}/skills`);
  assert.equal(mine.body.skills[0].update_available, false);

  const detail = await call(w, MEMBER, 'GET', `/skills/${uid}`);
  assert.deepEqual(detail.body.versions.map((v: any) => v.version), [2, 1]);
  assert.deepEqual(detail.body.versions[0].by, { uid: 'u-super', name: 'Sue Super' });
  assert.equal(detail.body.agents[0].company.name, 'Acme');
  assert.equal(detail.body.agents[0].agents[0].uid, CFO);
  assert.match(detail.body.skill.skill_md, /version: 2/);

  // Retired: it stays where it is pinned and cannot be added again.
  assert.equal((await call(w, SUPER, 'PATCH', `/skills/${uid}`, { status: 'retired' })).body.skill.status, 'retired');
  assert.equal((await call(w, EDITOR, 'PUT', `/agents/${CFO}/skills`, { skills: [uid] })).status, 200, 'kept at its version');
  assert.equal((await call(w, EDITOR, 'PUT', `/agents/${PROJECT_CFO}/skills`, { skills: [uid] })).body.error, 'skill_not_attachable');
  assert.equal((await call(w, SUPER, 'POST', `/skills/${uid}/publish`)).body.error, 'retired');
});

test('D1612: an agent gets a skill only of its role, with its approved tools, from its company, by an editor', async () => {
  const w = world();
  const forIr = await published(w, update({ name: 'Investor CRM digest', roles: ['investor_relations'], tools: ['hubspot.read_contacts'] }));
  const needsMore = await published(w, update({ name: 'Pipeline read', roles: ['investor_relations', 'cfo'], tools: ['hubspot.read_deals'] }));
  const acme = await published(w, update({ scope: 'company', company: 'co-uid-1', name: 'Acme close', roles: ['cfo'] }), EDITOR);
  const draft = (await call(w, SUPER, 'POST', '/skills', update({ name: 'Never published' }))).body.skill.uid;
  const links = () => Number((w.db.prepare('SELECT COUNT(*) AS n FROM agent_skill_links').get() as any).n);

  const role = await call(w, EDITOR, 'PUT', `/agents/${CFO}/skills`, { skills: [forIr] });
  assert.equal(role.status, 409);
  assert.match(role.body.message, /^This skill is not one of the .+ role's skills\.$/);
  const tools = await call(w, EDITOR, 'PUT', `/agents/${IR}/skills`, { skills: [needsMore] });
  assert.equal(tools.body.message, 'Needs the hubspot.read_deals tool, which this agent\'s sponsor hasn\'t approved.');
  assert.equal((await call(w, EDITOR, 'PUT', `/agents/${IR}/skills`, { skills: [forIr] })).status, 200, 'its granted tool');
  assert.equal((await call(w, OTHER_EDITOR, 'PUT', `/agents/${GLOBEX_CFO}/skills`, { skills: [acme] })).body.refusals[0].reason, 'There is no such skill.');
  assert.equal((await call(w, ADMIN, 'PUT', `/agents/${GLOBEX_CFO}/skills`, { skills: [acme] })).body.message, 'This skill belongs to another company.');
  // A project outside any company takes HQ skills only, even from its own founder.
  assert.equal((await call(w, EDITOR, 'PUT', `/agents/${SOLO_CFO}/skills`, { skills: [acme] })).body.message, 'This skill belongs to another company.');
  assert.equal((await call(w, SUPER, 'PUT', `/agents/${CFO}/skills`, { skills: [draft] })).body.message, 'This skill has not been published yet.');
  assert.equal((await call(w, MEMBER, 'PUT', `/agents/${CFO}/skills`, { skills: [acme] })).status, 403);
  assert.equal((await call(w, STRANGER, 'PUT', `/agents/${CFO}/skills`, { skills: [acme] })).status, 404);
  assert.equal(links(), 1);
  // A project agent inside Acme gets Acme's skills.
  assert.equal((await call(w, EDITOR, 'PUT', `/agents/${PROJECT_CFO}/skills`, { skills: [acme] })).status, 200);
  // Setting the list replaces it.
  assert.equal((await call(w, EDITOR, 'PUT', `/agents/${IR}/skills`, { skills: [] })).body.skills.length, 0);
  assert.equal(links(), 1);
  assert.deepEqual(missingTools(['a.b', 'c.d'], [{ integration_uid: 'x', tool: 'c.d' }]), ['a.b']);
});

test('D1612: assigning one skill to several agents is all or nothing', async () => {
  const w = world();
  const uid = await published(w, update({ roles: ['cfo'] }));
  const refused = await call(w, EDITOR, 'POST', `/skills/${uid}/assign`, { agents: [CFO, PROJECT_CFO, IR] });
  assert.equal(refused.status, 409);
  assert.deepEqual(refused.body.refusals.map((r: any) => r.agent_uid), [IR]);
  assert.equal(Number((w.db.prepare('SELECT COUNT(*) AS n FROM agent_skill_links').get() as any).n), 0);
  // Another company's agent reads as no agent; a member who is not an editor is told why.
  assert.equal((await call(w, EDITOR, 'POST', `/skills/${uid}/assign`, { agents: [CFO, GLOBEX_CFO] })).body.refusals[0].reason, 'There is no such agent.');
  assert.equal((await call(w, MEMBER, 'POST', `/skills/${uid}/assign`, { agents: [CFO] })).body.refusals[0].reason, 'Only the team\'s editors can change this agent\'s skills.');
  const ok = await call(w, EDITOR, 'POST', `/skills/${uid}/assign`, { agents: [CFO, PROJECT_CFO] });
  assert.deepEqual([ok.status, ok.body.added, ok.body.already, ok.body.used_by], [200, 2, 0, 2]);
  const again = await call(w, EDITOR, 'POST', `/skills/${uid}/assign`, { agents: [CFO] });
  assert.deepEqual([again.body.added, again.body.already], [0, 1]);
  assert.equal((await call(w, MEMBER, 'GET', '/skills?company=co-uid-1')).body.hq[0].used_by, 2);
});

test('D1612: the agent\'s radar is the 8 axes on the person\'s scale, "Not recorded" where nothing tags an axis', async () => {
  const w = world();
  const a = await published(w, update({ roles: ['cfo'], tags: [{ slug: 'investor_reporting', level: 'proficient' }, { slug: 'investor_relations', level: 'working' }] }));
  const b = await published(w, update({ name: 'FP&A pass', roles: ['cfo'], tags: [{ slug: 'fp_and_a', level: 'expert' }] }));
  const none = await call(w, MEMBER, 'GET', `/agents/${CFO}/skills`);
  assert.equal(none.body.radar.length, 8);
  assert.ok(none.body.radar.every((x: any) => x.value.available === false && x.value.reason === 'Not recorded'));
  await call(w, EDITOR, 'PUT', `/agents/${CFO}/skills`, { skills: [a, b] });
  const radar = Object.fromEntries((await call(w, MEMBER, 'GET', `/agents/${CFO}/skills`)).body.radar.map((x: any) => [x.slug, x.value]));
  assert.deepEqual(radar.finance_ops, { available: true, value: 5 }, 'the highest level on the axis');
  assert.deepEqual(radar.capital_network, { available: true, value: 2 });
  assert.deepEqual(radar.product, { available: false, reason: 'Not recorded' });
  const pure = skillsRadar([{ slug: 'x', level: 'expert' }], new Map([['x', 'design']]));
  assert.equal(pure.find((p) => p.slug === 'design')!.value.available, true);
});

test('D1612: a pasted SKILL.md lands as a draft, round-trips, and an unreadable one is refused', async () => {
  const w = world();
  const tax = { taxonomy: new Set(['investor_reporting', 'investor_relations']), roleKeys: new Set(['cfo', 'investor_relations']) };
  const d = (checkDraft(update(), tax) as any).draft;
  const md = toSkillMd(d, 3);
  const back = checkDraft(parseSkillMd(md), tax) as any;
  assert.equal(back.ok, true);
  assert.deepEqual({ ...back.draft }, { ...d });
  assert.equal(parseSkillMd('no frontmatter here'), null);
  assert.equal(parseSkillMd('---\nname: "x"\n---\n1. a'), null, 'no description');
  assert.equal(parseSkillMd('---\nname: "x"\ndescription: !!python/object "y"\n---\n'), null, 'a YAML tag is not a scalar');
  const quoted = parseSkillMd('---\nname: "A \\"quoted\\" name"\ndescription: "d"\nroles: [cfo]\ntools: []\noutput: brief\nhomepage: "ignored"\ntaxonomy:\n  - { slug: "investor_reporting", level: aware }\n---\n- Step one\n- Step two\n') as any;
  assert.equal(quoted.name, 'A "quoted" name');
  assert.deepEqual(quoted.steps, ['Step one', 'Step two']);
  assert.equal('homepage' in quoted, false);

  const made = await call(w, EDITOR, 'POST', '/skills', { scope: 'company', company: 'co-uid-1', skill_md: md });
  assert.equal(made.status, 201, made.text);
  assert.equal(made.body.skill.status, 'draft');
  assert.equal(made.body.skill.name, 'Draft the monthly investor update');
  assert.equal((await call(w, EDITOR, 'POST', '/skills', { scope: 'company', company: 'co-uid-1', skill_md: 'hello' })).body.error, 'skill_md_invalid');
  const badTool = toSkillMd({ ...d, tools: ['not a tool'] }, 1);
  assert.equal((await call(w, EDITOR, 'POST', '/skills', { scope: 'company', company: 'co-uid-1', skill_md: badTool })).body.error, 'tools_invalid', 'an import passes the same checks');
});

test('D1612: every route is off until TEAM_AGENTS_ENABLED is "true"', async () => {
  const w = world();
  w.env.TEAM_AGENTS_ENABLED = 'false';
  assert.equal((await call(w, MEMBER, 'GET', '/skills')).body.error, 'team_agents_off');
  assert.equal((await call(w, EDITOR, 'GET', `/agents/${CFO}/skills`)).status, 404);
});
