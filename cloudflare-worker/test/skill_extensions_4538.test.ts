// D4538 part 2 (#4538, Skill Library session 10) — company extensions: forks with provenance.
//
//   1. POST /api/teams/skills/:uid/extend makes a company DRAFT from one exact published HQ version, records
//      `based_on_skill_uid`, `based_on_version` and the reason, and audits it as a company skill write.
//   2. The HQ skill is only read: its row, draft, tags, roles and versions are byte-for-byte unchanged.
//   3. Who: a company editor of that company only. Another company's editor, a plain member, and HQ's Super
//      Admin (who moderates and never writes, D4161) are refused; a company skill cannot be a base.
//   4. Eligibility: a retired or suspended HQ base, an unpublished version and a missing reason are refused,
//      and nothing is written.
//   5. GET /skills/:uid/base: `base_update_available` is false at the base's version and true once HQ
//      publishes a newer one; nothing is applied, the extension's versions and an agent's pin stay as they
//      were; the three-way comparison names a conflict. Another company cannot read it.
//   6. An extension's tools stay within its base's (`tool_not_in_base`); publishing records the base on the
//      version row.
//   7. Existing company skills are unchanged: standalone, `based_on: null`, `lineage: null`, and POST /skills
//      cannot set lineage.
//   8. The migration's CHECK: the three lineage columns are all set or all NULL, and only on a company skill.
//
//   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
//     --test cloudflare-worker/test/skill_extensions_4538.test.ts
//
// No production skill or company record is touched: everything runs on the node:sqlite D1 fixture.
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
import { passHqGate } from './_hq_skill_gate.ts';

const sql = (f: string) => readFileSync(new URL(`../sql/${f}`, import.meta.url), 'utf8');
const BASELINE = sql('schema_baseline.sql');
const MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
const SUPER = 1, SUPER2 = 3, EDITOR = 10, MEMBER = 11, OTHER_EDITOR = 13;
const CFO = 'a'.repeat(32);
const REASON = 'Our board wants the update in the order of our own KPIs.';

function world() {
  const { DB, db } = makeD1(
    ['users', 'company_profiles', 'user_company_links', 'projects', 'activity_logs'].map((t) => stripForeignKeys(tableFromBaseline(BASELINE, t))).join('\n')
    + AI_LOG_SCHEMA + sql('migrations/506_ai_rail_proposals.sql'),
  );
  addColumnsFrom(db, sql('migrations/597_company_archive_and_events.sql'), 'company_profiles');
  for (const m of ['199_super_admin', '089_skills_values_taxonomy', '712_team_agents', '759_agent_skills', '202611022326_agent_skill_context_tokens',
    '202611022055_agent_skill_moderation', '202611022140_hq_skill_lifecycle', '202611081919_skill_release_evidence',
    '202611090904_skill_eval_result_identity', '202611092030_skill_version_release_note', '202611130253_4538_skill_extension_lineage']) db.exec(sql(`migrations/${m}.sql`));
  const user = db.prepare("INSERT INTO users (id, uid, email, name, role, founder_id, subscription_tier, subscription_status) VALUES (?, ?, ?, ?, ?, ?, 'growth', 'active')");
  user.run(SUPER, 'u-super', 'super@example.test', 'Sue Super', 'admin', null);
  user.run(SUPER2, 'u-super2', 'super2@example.test', 'Rex Reviewer', 'admin', null);
  user.run(EDITOR, 'u-editor', 'editor@example.test', 'Eve Editor', 'founder', 100);
  user.run(MEMBER, 'u-member', 'member@example.test', 'Max Member', 'founder', 101);
  user.run(OTHER_EDITOR, 'u-other', 'other@example.test', 'Oli Other', 'founder', 103);
  for (const id of [SUPER, SUPER2]) db.prepare('INSERT INTO super_admins (user_id) VALUES (?)').run(id);
  db.exec(`INSERT INTO company_profiles (id, uid, company_name) VALUES (1, 'co-uid-1', 'Acme'), (2, 'co-uid-2', 'Globex')`);
  const link = db.prepare('INSERT INTO user_company_links (uid, user_id, company_id, role_in_company) VALUES (?, ?, ?, ?)');
  link.run('l1', EDITOR, 1, 'Founder'); link.run('l2', MEMBER, 1, 'Member'); link.run('l3', OTHER_EDITOR, 2, 'Owner');
  db.exec(`INSERT INTO skills (slug, category_slug, label) VALUES ('investor_reporting', 'finance_ops', 'Investor reporting')`);
  db.prepare(`INSERT INTO team_agents (uid, scope_kind, company_id, role_key, first_name, model_id, tool_grants_json, sponsor_user_id, monthly_cap_microusd, created_by)
    VALUES (?, 'company', 1, 'cfo', 'Carla', ?, '[]', ${EDITOR}, 5000000, ${EDITOR})`).run(CFO, MODEL);
  const env: any = { DB, JWT_SECRET: 'd4538-extensions-fixture-only-secret', ENVIRONMENT: 'development', TEAM_AGENTS_ENABLED: 'true' };
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
const codeOf = (r: { body: any }) => r.body?.code ?? r.body?.error;

const hqDraft = (over: Record<string, unknown> = {}) => ({
  scope: 'hq', name: 'Draft the monthly investor update', purpose: 'From recorded metrics, a draft update for investors.',
  steps: ['Read the recorded metrics', 'Write the highlights'], tools: ['stripe.read', 'hubspot.read'], output_kind: 'draft', roles: ['cfo'],
  tags: [{ slug: 'investor_reporting', level: 'proficient' }], ...over,
});
/** An HQ skill, published once through the real gate and publish route. */
async function hqSkill(w: W, over: Record<string, unknown> = {}) {
  const made = await call(w, SUPER, 'POST', '/api/teams/skills', hqDraft(over));
  assert.equal(made.status, 201, made.text);
  const uid = made.body.skill.uid as string;
  await hqPublish(w, uid);
  return uid;
}
async function hqPublish(w: W, uid: string) {
  await passHqGate(w.db, uid, SUPER2, SUPER);
  const r = await call(w, SUPER, 'POST', `/api/teams/skills/${uid}/publish`);
  assert.equal(r.status, 200, r.text);
}
const extend = (w: W, uid: string, body: Record<string, unknown> = {}, who = EDITOR) =>
  call(w, who, 'POST', `/api/teams/skills/${uid}/extend`, { company: 'co-uid-1', reason: REASON, ...body });
const row = (w: W, uid: string) => w.db.prepare('SELECT * FROM agent_skills WHERE uid = ?').get(uid) as any;
const count = (w: W, table: string) => Number((w.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as any).n);
/** Everything the HQ skill is: its row, draft tags and roles, and its versions. */
function hqSnapshot(w: W, uid: string) {
  const s = row(w, uid);
  return JSON.stringify({
    s,
    tags: w.db.prepare('SELECT * FROM agent_skill_tags WHERE skill_id = ? ORDER BY rowid').all(s.id),
    roles: w.db.prepare('SELECT * FROM agent_skill_roles WHERE skill_id = ? ORDER BY rowid').all(s.id),
    versions: w.db.prepare('SELECT * FROM agent_skill_versions WHERE skill_id = ? ORDER BY version').all(s.id),
  });
}

test('D4538 p2: a company editor extends a published HQ version; provenance is recorded and audited; HQ is untouched', async () => {
  const w = world();
  const hq = await hqSkill(w);
  const before = hqSnapshot(w, hq);
  const r = await extend(w, hq, { name: 'Acme investor update' });
  assert.equal(r.status, 201, r.text);
  const ext = r.body.skill;
  assert.equal(ext.scope, 'company');
  assert.equal(ext.status, 'draft');
  assert.equal(ext.version, null, 'an extension starts as a draft: nothing is published for the company');
  assert.deepEqual(ext.based_on, { skill_uid: hq, version: 1 });
  assert.deepEqual(r.body.base, { uid: hq, name: 'Draft the monthly investor update', version: 1, current_version: 1 });
  // The copy is the exact version's parts, under the company's own name.
  assert.equal(ext.draft.name, 'Acme investor update');
  assert.equal(ext.draft.purpose, 'From recorded metrics, a draft update for investors.');
  assert.deepEqual(ext.draft.steps, ['Read the recorded metrics', 'Write the highlights']);
  assert.deepEqual(ext.draft.tools, ['stripe.read', 'hubspot.read']);
  assert.deepEqual(ext.draft.roles.map((x: any) => x.key), ['cfo']);
  assert.deepEqual(ext.draft.tags.map((t: any) => [t.slug, t.level]), [['investor_reporting', 'proficient']]);

  const s = row(w, ext.uid);
  assert.deepEqual([s.scope, s.company_id, s.based_on_skill_uid, s.based_on_version, s.fork_reason, s.created_by, s.current_version],
    ['company', 1, hq, 1, REASON, EDITOR, 0]);
  assert.notEqual(s.uid, hq, 'the extension is its own object');
  assert.equal(hqSnapshot(w, hq), before, 'the HQ skill, its draft and its versions are unchanged');

  // The existing company-skill write audit, with where the draft came from and why.
  const audit = w.db.prepare("SELECT user_id, details FROM activity_logs WHERE action = 'company_skill_draft_created'").all() as any[];
  assert.equal(audit.length, 1);
  const d = JSON.parse(audit[0].details);
  assert.equal(audit[0].user_id, EDITOR);
  assert.deepEqual([d.skill_uid, d.company_id, d.based_on, d.fork_reason], [ext.uid, 1, { skill_uid: hq, version: 1 }, REASON]);
  assert.equal(typeof d.after.definition_hash, 'string');

  // A second extension of the same HQ skill needs its own name.
  const again = await extend(w, hq, { name: 'Acme investor update' });
  assert.equal(again.status, 409, again.text);
  assert.equal(codeOf(again), 'slug_taken');
  assert.equal((await extend(w, hq, { name: 'Acme lender update' })).status, 201);
});

test('D4538 p2: an older published HQ version can be the base, and that exact version is copied', async () => {
  const w = world();
  const hq = await hqSkill(w);
  assert.equal((await call(w, SUPER, 'PATCH', `/api/teams/skills/${hq}`, { purpose: 'Version two: a shorter update for investors.' })).status, 200);
  await hqPublish(w, hq);
  const r = await extend(w, hq, { version: 1 });
  assert.equal(r.status, 201, r.text);
  assert.deepEqual(r.body.skill.based_on, { skill_uid: hq, version: 1 });
  assert.equal(r.body.skill.draft.purpose, 'From recorded metrics, a draft update for investors.');
  for (const bad of [0, -1, 1.5, '1', null]) {
    const no = await extend(w, hq, { version: bad, name: `Bad ${String(bad)}` });
    assert.equal(no.status, 400, `${bad}: ${no.text}`);
    assert.equal(codeOf(no), 'version_invalid');
  }
  const future = await extend(w, hq, { version: 3, name: 'Future' });
  assert.equal(future.status, 422, future.text);
  assert.equal(codeOf(future), 'version_not_published');
});

test('D4538 p2: cross-company, plain members, HQ admins and company bases are refused, writing nothing', async () => {
  const w = world();
  const hq = await hqSkill(w);
  const skillsBefore = count(w, 'agent_skills');
  // Globex's editor cannot write into Acme: Acme is not theirs to see.
  const cross = await extend(w, hq, { company: 'co-uid-1' }, OTHER_EDITOR);
  assert.equal(cross.status, 404, cross.text);
  assert.equal(codeOf(cross), 'not_found');
  const member = await extend(w, hq, {}, MEMBER);
  assert.equal(member.status, 403, member.text);
  assert.equal(codeOf(member), 'not_editor');
  // HQ moderates a company's skills and never writes one (D4161).
  const superAdmin = await extend(w, hq, {}, SUPER);
  assert.equal(superAdmin.status, 403, superAdmin.text);
  assert.equal(codeOf(superAdmin), 'not_editor');
  assert.equal((await extend(w, hq, { company: 'co-uid-404' })).status, 404);
  for (const reason of [undefined, '', '   ', 42, 'x'.repeat(301)]) {
    const no = await extend(w, hq, { reason });
    assert.equal(no.status, 400, `${String(reason).slice(0, 10)}: ${no.text}`);
    assert.equal(codeOf(no), 'fork_reason_invalid');
  }
  assert.equal(count(w, 'agent_skills'), skillsBefore, 'no refusal wrote a skill');

  // A company skill is never a base: its own company gets 422, another company cannot see it at all.
  const ext = (await extend(w, hq)).body.skill.uid;
  assert.equal((await call(w, EDITOR, 'POST', `/api/teams/skills/${ext}/publish`)).status, 200);
  const own = await extend(w, ext, { name: 'Fork of a fork' });
  assert.equal(own.status, 422, own.text);
  assert.equal(codeOf(own), 'base_not_hq');
  const other = await extend(w, ext, { company: 'co-uid-2', name: 'Stolen' }, OTHER_EDITOR);
  assert.equal(other.status, 404, other.text);
  assert.equal(codeOf(other), 'not_found');
  // And Globex can read neither the extension nor its lineage.
  assert.equal((await call(w, OTHER_EDITOR, 'GET', `/api/teams/skills/${ext}/base`)).status, 404);
  assert.equal((await call(w, OTHER_EDITOR, 'GET', `/api/teams/skills/${ext}`)).status, 404);
});

test('D4538 p2: a retired or suspended HQ base, or one never published, cannot be extended', async () => {
  const w = world();
  const retired = await hqSkill(w);
  w.db.prepare(`UPDATE agent_skills SET status = 'retired' WHERE uid = ?`).run(retired);
  const r = await extend(w, retired);
  assert.equal(r.status, 409, r.text);
  assert.equal(codeOf(r), 'base_retired');

  const suspended = await hqSkill(w, { name: 'Summarise the pipeline' });
  w.db.prepare(`INSERT INTO agent_skill_moderation (skill_id, action, version, reason, created_by) VALUES (?, 'suspend', 1, 'Suspended for the fixture only.', ?)`)
    .run(row(w, suspended).id, SUPER);
  const s = await extend(w, suspended);
  assert.equal(s.status, 409, s.text);
  assert.equal(codeOf(s), 'base_suspended');

  // Never published: not readable to a company at all.
  const draft = await call(w, SUPER, 'POST', '/api/teams/skills', hqDraft({ name: 'An unpublished draft' }));
  assert.equal((await extend(w, draft.body.skill.uid)).status, 404);
  assert.equal(count(w, "agent_skills WHERE scope = 'company'"), 0, 'nothing was written');
});

test('D4538 p2: base update available is false at the base version, true after HQ publishes; nothing is applied and pins stay', async () => {
  const w = world();
  const hq = await hqSkill(w);
  const ext = (await extend(w, hq, { name: 'Acme investor update' })).body.skill.uid;
  // The company changes its steps, publishes, and an agent pins its v1.
  assert.equal((await call(w, EDITOR, 'PATCH', `/api/teams/skills/${ext}`, { steps: ['Read the recorded metrics', 'Order by our KPIs', 'Write the highlights'] })).status, 200);
  assert.equal((await call(w, EDITOR, 'POST', `/api/teams/skills/${ext}/publish`)).status, 200);
  const extId = row(w, ext).id;
  w.db.prepare(`INSERT INTO agent_skill_links (agent_id, skill_id, version, linked_by) SELECT id, ?, 1, ? FROM team_agents WHERE uid = ?`).run(extId, EDITOR, CFO);

  const at = await call(w, MEMBER, 'GET', `/api/teams/skills/${ext}/base`);
  assert.equal(at.status, 200, at.text);
  const l = at.body.lineage;
  assert.equal(l.base_update_available, false);
  assert.deepEqual(l.based_on, { skill_uid: hq, version: 1 });
  assert.equal(l.reason, REASON);
  assert.deepEqual([l.base.uid, l.base.current_version, l.base.retired, l.base.suspended, l.base.version.version, l.base.newest], [hq, 1, false, false, 1, null]);
  assert.deepEqual(l.company, { side: 'version', version: 1 });
  assert.deepEqual(l.versions, [{ version: 1, based_on_version: 1 }], 'the published company version records its base');
  assert.deepEqual(l.fields.filter((f: any) => f.company_changed).map((f: any) => f.field), ['name', 'steps']);
  assert.equal(l.fields.some((f: any) => f.base_changed || f.conflict), false);

  // HQ publishes v2, changing the steps too.
  const versionsBefore = JSON.stringify(w.db.prepare('SELECT * FROM agent_skill_versions WHERE skill_id = ?').all(extId));
  const draftBefore = JSON.stringify(row(w, ext));
  assert.equal((await call(w, SUPER, 'PATCH', `/api/teams/skills/${hq}`, { steps: ['Read the recorded metrics', 'Write the highlights', 'List the asks'] })).status, 200);
  await hqPublish(w, hq);

  const after = await call(w, EDITOR, 'GET', `/api/teams/skills/${ext}/base`);
  assert.equal(after.status, 200, after.text);
  const n = after.body.lineage;
  assert.equal(n.base_update_available, true);
  assert.deepEqual([n.based_on.version, n.base.current_version, n.base.version.version, n.base.newest.version], [1, 2, 1, 2]);
  assert.deepEqual(n.base.newest.steps, ['Read the recorded metrics', 'Write the highlights', 'List the asks']);
  const steps = n.fields.find((f: any) => f.field === 'steps');
  assert.deepEqual(steps, { field: 'steps', company_changed: true, base_changed: true, conflict: true });
  const name = n.fields.find((f: any) => f.field === 'name');
  assert.deepEqual(name, { field: 'name', company_changed: true, base_changed: false, conflict: false });

  // Nothing was applied: the extension's draft, versions and the agent's pin are as they were.
  assert.equal(JSON.stringify(row(w, ext)), draftBefore);
  assert.equal(JSON.stringify(w.db.prepare('SELECT * FROM agent_skill_versions WHERE skill_id = ?').all(extId)), versionsBefore);
  assert.deepEqual(w.db.prepare('SELECT version FROM agent_skill_links WHERE skill_id = ?').all(extId).map((x: any) => x.version), [1]);
  // The card still names the base it was forked from.
  assert.deepEqual((await call(w, EDITOR, 'GET', `/api/teams/skills/${ext}`)).body.skill.based_on, { skill_uid: hq, version: 1 });

  // A base HQ retires reads retired, and no update is offered from it.
  w.db.prepare(`UPDATE agent_skills SET status = 'retired' WHERE uid = ?`).run(hq);
  const gone = (await call(w, EDITOR, 'GET', `/api/teams/skills/${ext}/base`)).body.lineage;
  assert.deepEqual([gone.base.retired, gone.base_update_available, row(w, ext).status], [true, false, 'published']);
});

test('D4538 p2: an extension cannot widen its tools past its base; it can narrow them', async () => {
  const w = world();
  const hq = await hqSkill(w);
  const ext = (await extend(w, hq)).body.skill.uid;
  const wide = await call(w, EDITOR, 'PATCH', `/api/teams/skills/${ext}`, { tools: ['stripe.read', 'xero.read'] });
  assert.equal(wide.status, 422, wide.text);
  assert.equal(codeOf(wide), 'tool_not_in_base');
  assert.equal(wide.body.tool.key, 'xero.read');
  assert.deepEqual(JSON.parse(row(w, ext).allowed_tools_json), ['stripe.read', 'hubspot.read'], 'nothing was saved');
  const narrow = await call(w, EDITOR, 'PATCH', `/api/teams/skills/${ext}`, { tools: ['stripe.read'] });
  assert.equal(narrow.status, 200, narrow.text);
  assert.deepEqual(JSON.parse(row(w, ext).allowed_tools_json), ['stripe.read']);
  // A standalone company skill keeps today's rule: any read-only tool.
  const own = await call(w, EDITOR, 'POST', '/api/teams/skills', { ...hqDraft({ name: 'Acme own brief' }), scope: 'company', company: 'co-uid-1' });
  assert.equal(own.status, 201, own.text);
  assert.equal((await call(w, EDITOR, 'PATCH', `/api/teams/skills/${own.body.skill.uid}`, { tools: ['xero.read'] })).status, 200);
});

test('D4538 p2: existing company skills stay standalone, and POST /skills cannot set lineage', async () => {
  const w = world();
  const hq = await hqSkill(w);
  const r = await call(w, EDITOR, 'POST', '/api/teams/skills', {
    ...hqDraft({ name: 'Acme standalone' }), scope: 'company', company: 'co-uid-1',
    based_on_skill_uid: hq, based_on_version: 1, fork_reason: 'Trying to claim a base.',
  });
  assert.equal(r.status, 201, r.text);
  assert.equal(r.body.skill.based_on, null);
  const s = row(w, r.body.skill.uid);
  assert.deepEqual([s.based_on_skill_uid, s.based_on_version, s.fork_reason], [null, null, null]);
  assert.equal((await call(w, EDITOR, 'POST', `/api/teams/skills/${s.uid}/publish`)).status, 200);
  assert.deepEqual((await call(w, EDITOR, 'GET', `/api/teams/skills/${s.uid}/base`)).body, { lineage: null });
  assert.deepEqual(w.db.prepare('SELECT based_on_version FROM agent_skill_versions WHERE skill_id = ?').all(s.id).map((x: any) => x.based_on_version), [null]);
  // An HQ skill has no base either, and its card says so.
  assert.deepEqual((await call(w, EDITOR, 'GET', `/api/teams/skills/${hq}/base`)).body, { lineage: null });
  const list = await call(w, EDITOR, 'GET', '/api/teams/skills?company=co-uid-1');
  assert.equal(list.status, 200, list.text);
  assert.deepEqual([...list.body.hq, ...list.body.company.skills].map((k: any) => k.based_on), [null, null]);
});

test('D4538 p2: the lineage columns are all set or all NULL, and only on a company skill', () => {
  const w = world();
  w.db.exec(`INSERT INTO agent_skills (uid, scope, slug, name, purpose, output_kind, created_by) VALUES ('${'b'.repeat(32)}', 'hq', 'hq-one', 'HQ', 'An HQ skill.', 'brief', ${SUPER})`);
  const put = (scope: string, uid: string | null, version: number | null, reason: string | null) => {
    try {
      w.db.prepare(`INSERT INTO agent_skills (uid, scope, company_id, slug, name, purpose, output_kind, created_by, based_on_skill_uid, based_on_version, fork_reason)
        VALUES (lower(hex(randomblob(16))), ?, ?, lower(hex(randomblob(4))), 'N', 'P.', 'brief', ?, ?, ?, ?)`).run(scope, scope === 'hq' ? null : 1, EDITOR, uid, version, reason);
      return 'ok';
    } catch { return 'refused'; }
  };
  const U = 'b'.repeat(32);
  assert.equal(put('company', U, 1, 'A reason.'), 'ok');
  assert.equal(put('company', null, null, null), 'ok');
  assert.equal(put('hq', U, 1, 'A reason.'), 'refused', 'an HQ skill has no base');
  assert.equal(put('company', U, null, 'A reason.'), 'refused');
  assert.equal(put('company', U, 1, null), 'refused');
  assert.equal(put('company', null, 1, null), 'refused');
  assert.equal(put('company', U, 0, 'A reason.'), 'refused');
  assert.equal(put('company', U, 1, '   '), 'refused');
  assert.equal(put('company', U, 1, 'x'.repeat(301)), 'refused');
  assert.equal(put('company', 'short', 1, 'A reason.'), 'refused');
});
