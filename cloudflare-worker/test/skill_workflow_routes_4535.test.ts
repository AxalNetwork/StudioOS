// D4535 part 2 (#4535): /api/skill-workflows, the workflow routes that run nothing — list, draft create and save,
// read a workflow and a published version, and validate a definition or the saved draft against D1's facts.
//
//   · the owner scope comes from `?company=` resolved against the caller's own links: HQ's workflows are a Super
//     Admin's only; a company's are its editors' only (a member 403, anyone else 404, a Super Admin without an
//     editor's seat included); a workflow of another scope reads as absent;
//   · the server mints a new workflow's uid and fills the owner; a definition naming another owner is refused;
//   · validation reads the run company's agents, pins and grants and the skills' published versions, refuses a
//     cycle, a revoked grant, a suspended version and another company's skill, names the checks it cannot make
//     (`qualified_version`), and writes nothing;
//   · no publish, run or cancel route exists.
//
// Real SQLite with the migrations the routes read. Every name, uid and email is made up.
//
//   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
//     --test cloudflare-worker/test/skill_workflow_routes_4535.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { SignJWT } from 'jose';
import { Hono } from 'hono';
import { makeD1 } from './_d1_sqlite.mjs';
import { stripForeignKeys, tableFromBaseline, addColumnsFrom } from './_baseline.mjs';
import { AI_LOG_SCHEMA } from './_ai_budget_fixture.mjs';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';
import skillWorkflows, { mount } from '../src/routes/skill_workflows.ts';
import { STARTUP_ASSESSMENT_SKILLS, startupAssessment, type StartupNode } from '../src/services/agents/skillWorkflow.ts';

const sql = (f: string) => readFileSync(new URL(`../sql/${f}`, import.meta.url), 'utf8');
const STORE = readdirSync(new URL('../sql/migrations/', import.meta.url)).find((f) => f.endsWith('_skill_workflow_store.sql'))!;
const BASELINE = sql('schema_baseline.sql');

const SUPER = 1, EDITOR = 10, MEMBER = 11, STRANGER = 12, OTHER_EDITOR = 13, SUPER_NO_SEAT = 14;
const hex = (ch: string) => ch.repeat(32);
const UIDS: Record<StartupNode, string> = { market_research: hex('1'), financial_analysis: hex('2'), product_assessment: hex('3'), legal_compliance_review: hex('4') };
const GLOBEX_SKILL = hex('5');

function world() {
  const { DB, db } = makeD1(['users', 'company_profiles', 'user_company_links', 'projects', 'activity_logs']
    .map((t) => stripForeignKeys(tableFromBaseline(BASELINE, t))).join('\n') + AI_LOG_SCHEMA + sql('migrations/506_ai_rail_proposals.sql'));
  addColumnsFrom(db, sql('migrations/597_company_archive_and_events.sql'), 'company_profiles');
  db.exec(sql('migrations/199_super_admin.sql'));
  db.exec(sql('migrations/712_team_agents.sql'));
  db.exec(sql('migrations/202611021724_team_agents_persona.sql'));
  db.exec(sql('migrations/759_agent_skills.sql'));
  db.exec(sql('migrations/202611022055_agent_skill_moderation.sql'));
  db.exec(sql(`migrations/${STORE}`));
  const user = db.prepare("INSERT INTO users (id, uid, email, name, role, founder_id, subscription_tier, subscription_status) VALUES (?, ?, ?, ?, ?, ?, 'growth', 'active')");
  user.run(SUPER, 'u-super', 'super@example.test', 'Sue Super', 'admin', null);
  user.run(SUPER_NO_SEAT, 'u-super2', 'super2@example.test', 'Sid Super', 'admin', null);
  user.run(EDITOR, 'u-editor', 'editor@example.test', 'Eve Editor', 'founder', 100);
  user.run(MEMBER, 'u-member', 'member@example.test', 'Max Member', 'founder', 101);
  user.run(STRANGER, 'u-stranger', 'stranger@example.test', 'Sam Stranger', 'founder', 102);
  user.run(OTHER_EDITOR, 'u-other', 'other@example.test', 'Oli Other', 'founder', 103);
  db.prepare('INSERT INTO super_admins (user_id) VALUES (?)').run(SUPER);
  db.prepare('INSERT INTO super_admins (user_id) VALUES (?)').run(SUPER_NO_SEAT);
  db.exec(`INSERT INTO company_profiles (id, uid, company_name) VALUES (1, 'co-uid-1', 'Acme'), (2, 'co-uid-2', 'Globex')`);
  const link = db.prepare('INSERT INTO user_company_links (uid, user_id, company_id, role_in_company) VALUES (?, ?, ?, ?)');
  link.run('l1', EDITOR, 1, 'Founder'); link.run('l2', MEMBER, 1, 'Member'); link.run('l3', OTHER_EDITOR, 2, 'Owner');
  // The four HQ library skills, each published at version 1, and one Globex company skill.
  const skill = db.prepare(`INSERT INTO agent_skills (uid, scope, company_id, slug, name, purpose, steps_json, allowed_tools_json, output_kind, status, current_version, created_by)
    VALUES (?, ?, ?, ?, ?, 'A made-up purpose.', '["Read"]', ?, 'brief', 'published', 1, ${SUPER})`);
  const version = db.prepare(`INSERT INTO agent_skill_versions (skill_id, version, skill_md, name, purpose, steps_json, allowed_tools_json, output_kind, taxonomy_json, roles_json, published_by)
    VALUES (?, 1, '---', ?, 'A made-up purpose.', '["Read"]', ?, 'brief', '[]', ?, ${SUPER})`);
  for (const n of Object.keys(UIDS) as StartupNode[]) {
    const s = STARTUP_ASSESSMENT_SKILLS[n];
    const id = Number(skill.run(UIDS[n], 'hq', null, s.slug, n, JSON.stringify(s.tools)).lastInsertRowid);
    version.run(id, n, JSON.stringify(s.tools), JSON.stringify([s.role_key]));
  }
  const gid = Number(skill.run(GLOBEX_SKILL, 'company', 2, 'globex-only', 'Globex only', '[]').lastInsertRowid);
  version.run(gid, 'Globex only', '[]', JSON.stringify(['cfo']));
  // Acme's four agents, each granted its skill's tools and pinned to version 1.
  const agent = db.prepare(`INSERT INTO team_agents (uid, scope_kind, company_id, project_id, role_key, model_id, tool_grants_json, sponsor_user_id, monthly_cap_microusd, created_by)
    VALUES (?, 'company', ?, NULL, ?, 'm', ?, ${EDITOR}, 5000000, ${EDITOR})`);
  for (const [i, n] of (Object.keys(UIDS) as StartupNode[]).entries()) {
    const s = STARTUP_ASSESSMENT_SKILLS[n];
    const aid = Number(agent.run(hex(String.fromCharCode(97 + i)), 1, s.role_key, JSON.stringify(s.tools.map((tool) => ({ integration_uid: 'i1', tool })))).lastInsertRowid);
    db.prepare(`INSERT INTO agent_skill_links (agent_id, skill_id, version, linked_by) SELECT ?, id, 1, ${EDITOR} FROM agent_skills WHERE uid = ?`).run(aid, UIDS[n]);
  }
  const env: any = { DB, JWT_SECRET: 'd4535-p2-fixture-only-secret', ENVIRONMENT: 'development', TEAM_AGENTS_ENABLED: 'true' };
  return { db, env };
}
type W = ReturnType<typeof world>;

function app() {
  const a = new Hono();
  a.onError((e: any, c) => {
    const status = AUTH_ERROR_STATUSES[e?.message];
    return status ? c.json({ detail: e.message }, status) : c.json({ detail: 'Internal server error', m: String(e?.message) }, 500);
  });
  a.route(mount.path, skillWorkflows);
  return a;
}
async function call(w: W, who: number, method: string, path: string, body?: unknown) {
  const jwt = await new SignJWT({ user_id: who }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(w.env.JWT_SECRET));
  const r = await app().request(`/api/skill-workflows${path.replace(/^\/(?=\?|$)/, '')}`, {
    method, headers: { Authorization: `Bearer ${jwt}`, 'content-type': 'application/json' },
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  }, w.env);
  const text = await r.text();
  let json: any = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = null; } // Hono's own 404 is plain text
  return { status: r.status, body: json, text };
}
/** The reference definition, with no uid and no owner: the server fills both. */
function reference(over: Record<string, unknown> = {}) {
  const d: any = startupAssessment(UIDS, { uid: hex('0') });
  delete d.uid; delete d.owner;
  return { ...d, ...over };
}
const companyDraft = (over: Record<string, unknown> = {}) => reference({ slug: 'acme-assessment', provenance: { origin: 'company_authored', source_uid: null, note: null }, ...over });
const count = (w: W, table: string) => (w.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as any).n as number;

test('mounts itself at /api/skill-workflows and stays behind the team agents switch', async () => {
  assert.equal(mount.path, '/api/skill-workflows');
  const w = world();
  w.env.TEAM_AGENTS_ENABLED = 'false';
  const r = await call(w, SUPER, 'GET', '/');
  assert.equal(r.status, 404);
  assert.equal(r.body.error, 'team_agents_off');
});

test("HQ's workflows: a Super Admin creates, reads, lists and saves a draft; the server mints the uid and audits", async () => {
  const w = world();
  const made = await call(w, SUPER, 'POST', '/', { definition: { ...reference(), uid: hex('9') } });
  assert.equal(made.status, 201, made.text);
  const uid = made.body.workflow.uid;
  // Mutation checked: keep the body's uid → the client chooses the uid.
  assert.match(uid, /^[0-9a-f]{32}$/);
  assert.notEqual(uid, hex('9'));
  assert.equal(made.body.workflow.status, 'draft');
  assert.deepEqual(made.body.workflow.draft.owner, { scope: 'hq', company_id: null });
  assert.deepEqual(made.body.workflow.versions, []);
  const audit = w.db.prepare("SELECT user_id, details FROM activity_logs WHERE action = 'skill_workflow_draft_created'").get() as any;
  assert.equal(audit.user_id, SUPER);
  assert.equal(JSON.parse(audit.details).workflow_uid, uid);

  const list = await call(w, SUPER, 'GET', '/');
  assert.deepEqual(list.body.workflows.map((x: any) => [x.uid, x.name, x.has_draft]), [[uid, 'Startup Assessment', true]]);

  const saved = await call(w, SUPER, 'PUT', `/${uid}`, { definition: reference({ name: 'Startup Assessment v2' }) });
  assert.equal(saved.status, 200, saved.text);
  assert.equal(saved.body.workflow.draft.name, 'Startup Assessment v2');
  assert.equal(count(w, "activity_logs WHERE action = 'skill_workflow_draft_saved'"), 1);
  // The same draft again writes no audit row.
  assert.equal((await call(w, SUPER, 'PUT', `/${uid}`, { definition: reference({ name: 'Startup Assessment v2' }) })).status, 200);
  assert.equal(count(w, "activity_logs WHERE action = 'skill_workflow_draft_saved'"), 1);

  assert.equal((await call(w, SUPER, 'PUT', `/${uid}`, { definition: { ...reference(), uid: hex('8') } })).body.error, 'uid_mismatch');
  const slug = await call(w, SUPER, 'PUT', `/${uid}`, { definition: reference({ slug: 'renamed' }) });
  assert.deepEqual([slug.status, slug.body.error], [409, 'slug_immutable']);
  const bad = await call(w, SUPER, 'PUT', `/${uid}`, { definition: reference({ when: 'always' }) });
  assert.deepEqual([bad.status, bad.body.error], [422, 'definition_invalid']);
  assert.ok(bad.body.refusals.some((r: any) => r.code === 'condition_unsupported'));
  const pub = await call(w, SUPER, 'PUT', `/${uid}`, { definition: reference({ lifecycle: 'published' }) });
  assert.deepEqual([pub.status, pub.body.error], [422, 'not_a_draft']);
  assert.equal((await call(w, SUPER, 'PUT', `/${hex('7')}`, { definition: reference() })).status, 404);
  assert.equal((await call(w, SUPER, 'POST', '/', 'not json')).body.error, 'body_invalid');
  assert.equal((await call(w, SUPER, 'POST', '/', { definition: 'x'.repeat(70_000) })).status, 413);
});

test("roles: HQ's workflows are a Super Admin's only", async () => {
  const w = world();
  const uid = (await call(w, SUPER, 'POST', '/', { definition: reference() })).body.workflow.uid;
  // Mutation checked: drop the Super Admin check → an editor lists and writes HQ's workflows.
  for (const who of [EDITOR, MEMBER, STRANGER]) {
    for (const [method, path, body] of [['GET', '/', undefined], ['POST', '/', { definition: reference() }], ['GET', `/${uid}`, undefined],
      ['PUT', `/${uid}`, { definition: reference() }], ['POST', `/${uid}/validate?run_company=co-uid-1`, undefined]] as const) {
      const r = await call(w, who, method, path, body);
      assert.deepEqual([r.status, r.body.error], [403, 'not_super_admin'], `${who} ${method} ${path}`);
    }
  }
  assert.equal(count(w, 'agent_skill_workflows'), 1);
});

test("tenancy: a company's workflows are its editors' only, and another scope's workflow reads as absent", async () => {
  const w = world();
  const made = await call(w, EDITOR, 'POST', '/?company=co-uid-1', { definition: companyDraft() });
  assert.equal(made.status, 201, made.text);
  const uid = made.body.workflow.uid;
  assert.deepEqual(made.body.workflow.draft.owner, { scope: 'company', company_id: 1 });
  assert.equal(count(w, "activity_logs WHERE action = 'company_skill_workflow_draft_created'"), 1);
  const hqUid = (await call(w, SUPER, 'POST', '/', { definition: reference() })).body.workflow.uid;

  // Mutation checked: canEditAsMember → membership → a member writes the company's workflows.
  const member = await call(w, MEMBER, 'GET', '/?company=co-uid-1');
  assert.deepEqual([member.status, member.body.error], [403, 'not_editor']);
  assert.equal((await call(w, MEMBER, 'PUT', `/${uid}?company=co-uid-1`, { definition: companyDraft() })).status, 403);
  // Another company's editor, a stranger and a Super Admin with no seat: the company does not exist for them.
  for (const who of [OTHER_EDITOR, STRANGER, SUPER_NO_SEAT, SUPER]) {
    const r = await call(w, who, 'GET', `/${uid}?company=co-uid-1`);
    assert.deepEqual([r.status, r.body.error], [404, 'not_found'], String(who));
  }
  assert.equal((await call(w, EDITOR, 'GET', '/?company=no-such')).status, 404);
  // Mutation checked: drop the scope binding in readWorkflow → Globex's editor reads Acme's workflow.
  assert.equal((await call(w, OTHER_EDITOR, 'GET', `/${uid}?company=co-uid-2`)).status, 404);
  assert.equal((await call(w, OTHER_EDITOR, 'PUT', `/${uid}?company=co-uid-2`, { definition: companyDraft() })).status, 404);
  assert.deepEqual((await call(w, OTHER_EDITOR, 'GET', '/?company=co-uid-2')).body.workflows, []);
  // HQ's workflow is not Acme's, and Acme's is not HQ's.
  assert.equal((await call(w, EDITOR, 'GET', `/${hqUid}?company=co-uid-1`)).status, 404);
  assert.equal((await call(w, SUPER, 'GET', `/${uid}`)).status, 404);
  assert.deepEqual((await call(w, SUPER, 'GET', '/')).body.workflows.map((x: any) => x.uid), [hqUid]);

  // The owner in the body cannot move a draft into another scope.
  const moved = await call(w, OTHER_EDITOR, 'POST', '/?company=co-uid-2', { definition: companyDraft({ owner: { scope: 'company', company_id: 1 } }) });
  assert.deepEqual([moved.status, moved.body.error], [403, 'workflow_out_of_scope']);
  const asHq = await call(w, EDITOR, 'POST', '/?company=co-uid-1', { definition: companyDraft({ owner: { scope: 'hq', company_id: null } }) });
  assert.deepEqual([asHq.status, asHq.body.error], [403, 'workflow_out_of_scope']);
  // Mutation checked: drop the provenance rule → a company claims HQ's reference.
  const claim = await call(w, EDITOR, 'POST', '/?company=co-uid-1', { definition: reference({ slug: 'claims-hq' }) });
  assert.deepEqual([claim.status, claim.body.error], [422, 'provenance_invalid']);
  assert.equal(count(w, 'agent_skill_workflows'), 2);
});

test('validation reads the run company\'s facts, refuses what would not run, and writes nothing', async () => {
  const w = world();
  const uid = (await call(w, SUPER, 'POST', '/', { definition: reference() })).body.workflow.uid;
  const before = ['agent_skill_workflows', 'agent_skill_workflow_versions', 'agent_skill_workflow_runs', 'agent_skill_links', 'activity_logs'].map((t) => count(w, t));

  const ok = await call(w, SUPER, 'POST', `/${uid}/validate?run_company=co-uid-1`);
  assert.equal(ok.status, 200, ok.text);
  assert.equal(ok.body.ok, true, JSON.stringify(ok.body.refusals));
  assert.deepEqual(ok.body.order, ['market_research', 'financial_analysis', 'legal_compliance_review', 'product_assessment']);
  assert.equal(ok.body.resolved.market_research.agent_uid, hex('a'));
  assert.equal(ok.body.resolved.market_research.skill.version, 1);
  assert.equal(ok.body.run_company, 'co-uid-1');
  // Mutation checked: empty NOT_CHECKED → the reply passes off an unqualified pin as checked.
  assert.ok(ok.body.not_checked.includes('qualified_version'));

  // An HQ workflow names the company whose agents would run it.
  assert.deepEqual([(await call(w, SUPER, 'POST', `/${uid}/validate`)).body.error], ['run_company_required']);
  assert.equal((await call(w, SUPER, 'POST', `/${uid}/validate?run_company=no-such`)).status, 404);
  // Globex has no agents: every node is unavailable there.
  const globex = await call(w, SUPER, 'POST', `/${uid}/validate?run_company=co-uid-2`);
  assert.equal(globex.body.ok, false);
  assert.ok(globex.body.refusals.every((r: any) => r.code === 'agent_unavailable'));

  // A revoked grant. Mutation checked: count every tool as granted → this passes.
  w.db.prepare(`UPDATE team_agents SET tool_grants_json = '[{"integration_uid":"i1","tool":"research.read"}]' WHERE role_key = 'research_analyst'`).run();
  const revoked = await call(w, SUPER, 'POST', `/${uid}/validate?run_company=co-uid-1`);
  assert.deepEqual(revoked.body.refusals.map((r: any) => [r.code, r.node, r.detail?.tool]), [['tool_not_granted', 'market_research', 'validate.read']]);
  w.db.prepare(`UPDATE team_agents SET tool_grants_json = ? WHERE role_key = 'research_analyst'`)
    .run(JSON.stringify(['research.read', 'validate.read'].map((tool) => ({ integration_uid: 'i1', tool }))));

  // A suspended version (HQ's moderation, the run gate's rule). Mutation checked: suspended always false.
  const sid = (w.db.prepare('SELECT id FROM agent_skills WHERE uid = ?').get(UIDS.legal_compliance_review) as any).id;
  w.db.prepare(`INSERT INTO agent_skill_moderation (skill_id, version, action, reason, created_by) VALUES (?, 1, 'suspend', 'A made-up reason.', ${SUPER})`).run(sid);
  const suspended = await call(w, SUPER, 'POST', `/${uid}/validate?run_company=co-uid-1`);
  assert.deepEqual(suspended.body.refusals.map((r: any) => [r.code, r.node]), [['skill_suspended', 'legal_compliance_review']]);

  assert.deepEqual(['agent_skill_workflows', 'agent_skill_workflow_versions', 'agent_skill_workflow_runs', 'agent_skill_links', 'activity_logs'].map((t) => count(w, t)), before);
});

test("a body definition: a cycle is refused before anything runs, and another company's skill reads as not found", async () => {
  const w = world();
  const d = reference();
  d.nodes[0].depends_on = ['product_assessment'];
  const cyc = await call(w, SUPER, 'POST', '/validate?run_company=co-uid-1', { definition: d });
  assert.equal(cyc.status, 200);
  const cycle = cyc.body.refusals.find((r: any) => r.code === 'cycle');
  assert.deepEqual(cycle.detail.nodes, ['market_research', 'product_assessment']);
  // A shape failure answers the shape refusals.
  const shape = await call(w, SUPER, 'POST', '/validate?run_company=co-uid-1', { definition: reference({ when: 'x' }) });
  assert.equal(shape.body.ok, false);
  assert.ok(shape.body.refusals.some((r: any) => r.code === 'condition_unsupported'));

  // Acme's editor names Globex's skill: it does not exist for Acme.
  const theirs = companyDraft();
  theirs.nodes[1] = { ...theirs.nodes[1], skill_uid: GLOBEX_SKILL, tools: [] };
  const r = await call(w, EDITOR, 'POST', '/validate?company=co-uid-1', { definition: theirs });
  assert.deepEqual(r.body.refusals.map((x: any) => [x.code, x.node]), [['skill_not_found', 'financial_analysis']]);
  // A company workflow runs only in its own company. Mutation checked: drop the check → Acme reads Globex's agents.
  const elsewhere = await call(w, EDITOR, 'POST', '/validate?company=co-uid-1&run_company=co-uid-2', { definition: companyDraft() });
  assert.deepEqual([elsewhere.status, elsewhere.body.error], [400, 'run_company_not_allowed']);
  const own = await call(w, EDITOR, 'POST', '/validate?company=co-uid-1', { definition: companyDraft() });
  assert.equal(own.body.ok, true, JSON.stringify(own.body.refusals));
  assert.equal(own.body.run_company, 'co-uid-1');

  // The policy pin resolves to the agent's own pin, never "latest". Mutation checked: pins left empty → version_unpinned.
  w.db.prepare(`INSERT INTO agent_skill_versions (skill_id, version, skill_md, name, purpose, steps_json, allowed_tools_json, output_kind, taxonomy_json, roles_json, published_by)
    SELECT id, 2, '---', name, purpose, steps_json, allowed_tools_json, 'brief', '[]', '["research_analyst"]', ${SUPER} FROM agent_skills WHERE uid = ?`).run(UIDS.market_research);
  w.db.prepare('UPDATE agent_skills SET current_version = 2 WHERE uid = ?').run(UIDS.market_research);
  const pinned = companyDraft();
  pinned.nodes[0] = { ...pinned.nodes[0], version: { pin: 'policy', policy: 'agent_pin_at_plan' } };
  const byPin = await call(w, EDITOR, 'POST', '/validate?company=co-uid-1', { definition: pinned });
  assert.equal(byPin.body.ok, true, JSON.stringify(byPin.body.refusals));
  assert.equal(byPin.body.resolved.market_research.skill.version, 1);

  // An HQ skill nobody published: Acme's editor cannot read it (not found); a Super Admin, who writes it, sees it is
  // unpublished. Mutation checked: every skill readable → Acme's editor learns it exists.
  w.db.prepare(`INSERT INTO agent_skills (uid, scope, company_id, slug, name, purpose, steps_json, allowed_tools_json, output_kind, status, current_version, created_by)
    VALUES (?, 'hq', NULL, 'hq-draft', 'HQ draft', 'A made-up purpose.', '[]', '[]', 'brief', 'draft', 0, ${SUPER})`).run(hex('6'));
  const hidden = companyDraft();
  hidden.nodes[1] = { ...hidden.nodes[1], skill_uid: hex('6'), tools: [] };
  assert.deepEqual((await call(w, EDITOR, 'POST', '/validate?company=co-uid-1', { definition: hidden })).body.refusals.map((x: any) => x.code), ['skill_not_found']);
  const hq = reference();
  hq.nodes[1] = { ...hq.nodes[1], skill_uid: hex('6'), tools: [] };
  assert.deepEqual((await call(w, SUPER, 'POST', '/validate?run_company=co-uid-1', { definition: hq })).body.refusals.map((x: any) => x.code), ['skill_unpublished']);
  // Validation creates nothing.
  assert.equal(count(w, 'agent_skill_workflows'), 0);
});

test('a published version is read inside its scope only; no publish, run or cancel route exists', async () => {
  const w = world();
  const uid = (await call(w, SUPER, 'POST', '/', { definition: reference() })).body.workflow.uid;
  // No route publishes (D4535-p2.md): the version row is written here as the store's publishDraft would.
  const wid = (w.db.prepare('SELECT id FROM agent_skill_workflows WHERE uid = ?').get(uid) as any).id;
  w.db.prepare(`INSERT INTO agent_skill_workflow_versions (workflow_id, version, definition_json, definition_hash, policy_version, published_by)
    VALUES (?, 1, '{"schema":1}', ?, 'skill-workflow/1', ${SUPER})`).run(wid, 'f'.repeat(64));
  const v = await call(w, SUPER, 'GET', `/${uid}/versions/1`);
  assert.deepEqual([v.status, v.body.version, v.body.definition_hash], [200, 1, 'f'.repeat(64)]);
  assert.deepEqual((await call(w, SUPER, 'GET', `/${uid}`)).body.workflow.versions.map((x: any) => x.version), [1]);
  assert.equal((await call(w, SUPER, 'GET', `/${uid}/versions/2`)).status, 404);
  assert.equal((await call(w, SUPER, 'GET', `/${uid}/versions/0`)).status, 404);
  assert.equal((await call(w, EDITOR, 'GET', `/${uid}/versions/1?company=co-uid-1`)).status, 404);
  // Publishing consumes the draft; with none left there is nothing to check.
  w.db.prepare("UPDATE agent_skill_workflows SET draft_json = NULL, status = 'published', current_version = 1 WHERE id = ?").run(wid);
  const none = await call(w, SUPER, 'POST', `/${uid}/validate?run_company=co-uid-1`);
  assert.deepEqual([none.status, none.body.error], [409, 'no_draft']);
  for (const [method, path] of [['POST', `/${uid}/publish`], ['POST', `/${uid}/runs`], ['POST', `/${uid}/run`], ['GET', `/runs/${hex('e')}`], ['POST', `/runs/${hex('e')}/cancel`]]) {
    assert.equal((await call(w, SUPER, method, path, method === 'GET' ? undefined : {})).status, 404, `${method} ${path}`);
  }
  assert.equal(count(w, 'agent_skill_workflow_runs'), 0);
});
