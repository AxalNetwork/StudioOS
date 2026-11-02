// D4161 (#4161, H3 of #4137) — HQ moderation of company skills at
// /api/admin/ai-agents/company-skills.
//
//   1. Super Admin only: a plain admin and a company editor are refused.
//   2. The queue: every company's skills, the author by name, never an email;
//      status and q filters; 25 a page; an empty queue is an empty list.
//   3. A reason is required on flag, suspend and clear, and nothing is written without one.
//   4. Flag: the skill keeps running; the company's editors are told why; the audit has the reason.
//   5. Suspend: the run gate refuses it at once and it cannot be pinned again.
//   6. HQ never writes a company's skill: /api/teams refuses a Super Admin, and the
//      HQ router writes no skill table.
//   7. Republish clears it: the new version runs, the suspended one does not, the history stays.
//
// Real SQLite: the baseline's tables, 089, 199, 597, 712, 759 and 202611022055.
//
//   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
//     --test cloudflare-worker/test/company_skill_moderation_d4161.test.ts
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
import { mount, PER_PAGE } from '../src/routes/admin_company_skills.ts';
import { skillRunRefusal } from '../src/services/agents/skillModeration.ts';

const sql = (f: string) => readFileSync(new URL(`../sql/${f}`, import.meta.url), 'utf8');
const BASELINE = sql('schema_baseline.sql');
const MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
const SUPER = 1, ADMIN = 2, EDITOR = 10, MEMBER = 11, OTHER_EDITOR = 13;
const CFO = 'a'.repeat(32);
const REASON = 'Uses the HubSpot write tool, which skills may not request.';

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
  db.exec(sql('migrations/202611022055_agent_skill_moderation.sql'));
  const user = db.prepare("INSERT INTO users (id, uid, email, name, role, founder_id, subscription_tier, subscription_status) VALUES (?, ?, ?, ?, ?, ?, 'growth', 'active')");
  user.run(SUPER, 'u-super', 'super@example.test', 'Sue Super', 'admin', null);
  user.run(ADMIN, 'u-admin', 'admin@example.test', 'Ada Admin', 'admin', null);
  user.run(EDITOR, 'u-editor', 'editor@example.test', 'Eve Editor', 'founder', 100);
  user.run(MEMBER, 'u-member', 'member@example.test', 'Max Member', 'founder', 101);
  user.run(OTHER_EDITOR, 'u-other', 'other@example.test', 'Oli Other', 'founder', 103);
  db.prepare('INSERT INTO super_admins (user_id) VALUES (?)').run(SUPER);
  db.exec(`INSERT INTO company_profiles (id, uid, company_name) VALUES (1, 'co-uid-1', 'Acme'), (2, 'co-uid-2', 'Globex')`);
  const link = db.prepare('INSERT INTO user_company_links (uid, user_id, company_id, role_in_company) VALUES (?, ?, ?, ?)');
  link.run('l1', EDITOR, 1, 'Founder'); link.run('l2', MEMBER, 1, 'Member'); link.run('l3', OTHER_EDITOR, 2, 'Owner');
  db.exec(`INSERT INTO skills (slug, category_slug, label) VALUES
    ('investor_reporting', 'finance_ops', 'Investor reporting'), ('investor_relations', 'capital_network', 'Investor relations')`);
  db.prepare(`INSERT INTO team_agents (uid, scope_kind, company_id, role_key, first_name, model_id, tool_grants_json, sponsor_user_id, monthly_cap_microusd, created_by)
    VALUES (?, 'company', 1, 'cfo', 'Carla', ?, '[]', ${EDITOR}, 5000000, ${EDITOR})`).run(CFO, MODEL);
  db.prepare("INSERT INTO projects (id, uid, name, founder_id, company_id) VALUES (7, 'p7', 'Rocket', 100, 1)").run();
  db.prepare(`INSERT INTO team_agents (uid, scope_kind, project_id, role_key, first_name, model_id, tool_grants_json, sponsor_user_id, monthly_cap_microusd, created_by)
    VALUES (?, 'project', 7, 'cfo', 'Cody', ?, '[]', ${EDITOR}, 5000000, ${EDITOR})`).run('f'.repeat(32), MODEL);
  const env: any = { DB, JWT_SECRET: 'd4161-fixture-only-secret', ENVIRONMENT: 'development', TEAM_AGENTS_ENABLED: 'true' };
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
const HQ = '/api/admin/ai-agents/company-skills';

const skill = (over: Record<string, unknown> = {}) => ({
  scope: 'company', company: 'co-uid-1', name: 'Acme board brief', purpose: 'A board brief from recorded metrics.',
  steps: ['Read the recorded metrics', 'Write the brief'], tools: [], output_kind: 'brief', roles: ['cfo'],
  tags: [{ slug: 'investor_reporting', level: 'proficient' }], ...over,
});
async function companySkill(w: W, over: Record<string, unknown> = {}, who = EDITOR, publish = true) {
  const made = await call(w, who, 'POST', '/api/teams/skills', skill(over));
  assert.equal(made.status, 201, made.text);
  if (publish) assert.equal((await call(w, who, 'POST', `/api/teams/skills/${made.body.skill.uid}/publish`)).status, 200);
  return made.body.skill.uid as string;
}
const idOf = (w: W, uid: string) => Number((w.db.prepare('SELECT id FROM agent_skills WHERE uid = ?').get(uid) as any).id);
const count = (w: W, table: string) => Number((w.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as any).n);
const inbox = (w: W, userId: number) => {
  try { return w.db.prepare('SELECT type, title, body FROM notifications_inbox WHERE user_id = ? ORDER BY id').all(userId) as any[]; } catch { return []; }
};
const audits = (w: W) => {
  try { return (w.db.prepare('SELECT action, filters_json FROM admin_audit_log ORDER BY id').all() as any[]).map((r) => ({ action: r.action, details: JSON.parse(r.filters_json) })); } catch { return []; }
};

test('D4161: Super Admin only — a plain admin and a company editor are refused', async () => {
  // Mutation checked: `requireSuperAdmin` replaced by `requireAdmin` → the plain admin is let in and this fails.
  const w = world();
  const uid = await companySkill(w);
  for (const who of [ADMIN, EDITOR, MEMBER]) {
    for (const [method, path, body] of [['GET', HQ], ['GET', `${HQ}/${uid}`], ['POST', `${HQ}/${uid}/flag`, { reason: REASON }],
      ['POST', `${HQ}/${uid}/suspend`, { reason: REASON }], ['POST', `${HQ}/${uid}/clear`, { reason: REASON }]] as const) {
      const r = await call(w, who, method, path, body);
      assert.equal(r.status, 403, `${who} ${method} ${path}: ${r.text}`);
    }
  }
  assert.equal(count(w, 'agent_skill_moderation'), 0);
  assert.equal((await call(w, SUPER, 'GET', HQ)).status, 200);
});

test('D4161: the queue lists every company\'s skills, the author by name and never an email', async () => {
  const w = world();
  // SA9g: nothing yet is an empty list, not an error and not a zero standing for a row.
  const empty = await call(w, SUPER, 'GET', HQ);
  assert.deepEqual(empty.body, { skills: [], page: 1, per_page: PER_PAGE, total: 0 });
  const acme = await companySkill(w);
  const globex = await companySkill(w, { company: 'co-uid-2', name: 'Globex runway note' }, OTHER_EDITOR);
  const draft = await companySkill(w, { name: 'Acme unfinished' }, EDITOR, false);
  w.db.exec(`INSERT INTO agent_skills (uid, scope, company_id, slug, name, purpose, output_kind, created_by) VALUES ('${'9'.repeat(32)}', 'hq', NULL, 'hq-one', 'An Axal skill', 'Not a company skill.', 'brief', ${SUPER})`);
  const all = await call(w, SUPER, 'GET', HQ);
  assert.equal(all.status, 200, all.text);
  assert.deepEqual(all.body.skills.map((s: any) => s.uid).sort(), [acme, globex, draft].sort(), 'HQ skills are not company skills');
  const row = all.body.skills.find((s: any) => s.uid === acme);
  assert.deepEqual(row, {
    uid: acme, name: 'Acme board brief', company: { uid: 'co-uid-1', name: 'Acme' }, project: null,
    author: { uid: 'u-editor', name: 'Eve Editor' }, area: { slug: 'finance_ops', label: 'Finance / Ops' },
    tools: [], status: 'published', version: 1,
  });
  // Mutation checked: `version: s.current_version || null` → `s.current_version` makes the draft read 0 and this fails.
  assert.equal(all.body.skills.find((s: any) => s.uid === draft).version, null, 'an unpublished skill has no version, never 0');
  assert.doesNotMatch(all.text, /@/, 'no email in the queue');
  const detail = await call(w, SUPER, 'GET', `${HQ}/${acme}`);
  assert.doesNotMatch(detail.text, /@/, 'no email in the detail');
  assert.equal(detail.body.skill.read_only, true);
  assert.match(detail.body.skill.skill_md, /^---\nname: "Acme board brief"/);

  assert.deepEqual((await call(w, SUPER, 'GET', `${HQ}?q=globex`)).body.skills.map((s: any) => s.uid), [globex], 'q matches the company name');
  assert.deepEqual((await call(w, SUPER, 'GET', `${HQ}?q=unfinished`)).body.skills.map((s: any) => s.uid), [draft], 'q matches the skill name');
  assert.equal((await call(w, SUPER, 'GET', `${HQ}?status=nope`)).status, 400);
  assert.deepEqual((await call(w, SUPER, 'GET', `${HQ}?status=in_review`)).body.skills, [], 'no company skill is in HQ review');
  await call(w, SUPER, 'POST', `${HQ}/${globex}/flag`, { reason: REASON });
  // Mutation checked: the status filter dropped from the WHERE → every row comes back and this fails.
  assert.deepEqual((await call(w, SUPER, 'GET', `${HQ}?status=flagged`)).body.skills.map((s: any) => s.uid), [globex]);
  assert.deepEqual((await call(w, SUPER, 'GET', `${HQ}?status=published`)).body.skills.map((s: any) => s.uid), [acme]);
  assert.equal((await call(w, SUPER, 'GET', HQ)).body.skills[0].uid, globex, 'what needs attention comes first');
  assert.equal((await call(w, SUPER, 'GET', `${HQ}/${'0'.repeat(32)}`)).status, 404);
  assert.equal((await call(w, SUPER, 'GET', `${HQ}/${'9'.repeat(32)}`)).status, 404, 'an HQ skill is not moderated here');
});

test('D4161: 25 a page', async () => {
  const w = world();
  const ins = w.db.prepare(`INSERT INTO agent_skills (uid, scope, company_id, slug, name, purpose, output_kind, created_by) VALUES (?, 'company', 1, ?, ?, 'p', 'brief', ${EDITOR})`);
  for (let i = 0; i < 30; i += 1) ins.run(String(i).padStart(32, '0'), `s-${i}`, `Skill ${i}`);
  const one = await call(w, SUPER, 'GET', HQ);
  const two = await call(w, SUPER, 'GET', `${HQ}?page=2`);
  assert.equal(one.body.total, 30);
  assert.equal(one.body.skills.length, 25);
  assert.equal(two.body.skills.length, 5);
  assert.equal(new Set([...one.body.skills, ...two.body.skills].map((s: any) => s.uid)).size, 30);
  assert.equal((await call(w, SUPER, 'GET', `${HQ}?page=0`)).status, 400);
});

test('D4161: a reason is required, and nothing is written without one', async () => {
  // Mutation checked: `reasonOf` returning the trimmed text whatever its length → the short reason is accepted and this fails.
  const w = world();
  const uid = await companySkill(w);
  for (const action of ['flag', 'suspend']) {
    for (const body of [undefined, {}, { reason: '' }, { reason: 'too short' }, { reason: 'x'.repeat(501) }, { reason: 42 }]) {
      const r = await call(w, SUPER, 'POST', `${HQ}/${uid}/${action}`, body);
      assert.equal(r.status, 400, `${action} ${JSON.stringify(body)}`);
      assert.equal(r.body.error, 'reason_required');
    }
  }
  assert.equal(count(w, 'agent_skill_moderation'), 0);
  assert.deepEqual(audits(w), []);
  assert.deepEqual(inbox(w, EDITOR), []);
  await call(w, SUPER, 'POST', `${HQ}/${uid}/flag`, { reason: REASON });
  assert.equal((await call(w, SUPER, 'POST', `${HQ}/${uid}/clear`, { reason: 'short' })).status, 400);
  assert.equal(Number((w.db.prepare('SELECT COUNT(*) AS n FROM agent_skill_moderation WHERE cleared_at IS NULL').get() as any).n), 1, 'still flagged');
});

test('D4161: a flag keeps the skill running; the editors are told why; the audit has the reason', async () => {
  const w = world();
  const uid = await companySkill(w);
  const r = await call(w, SUPER, 'POST', `${HQ}/${uid}/flag`, { reason: REASON });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.body.status, 'flagged');
  assert.deepEqual(r.body.moderation.by, { uid: 'u-super', name: 'Sue Super' });
  assert.equal(r.body.moderation.reason, REASON);
  assert.equal(await skillRunRefusal(w.env, idOf(w, uid), 1), null, 'a flagged skill keeps running');
  assert.equal((await call(w, EDITOR, 'POST', `/api/teams/skills/${uid}/assign`, { agent_uids: [CFO] })).body.added, 1, 'and can still be pinned');
  // Mutation checked: `companyEditorIds` without its role filter → the plain member is told too and this fails.
  assert.deepEqual(inbox(w, EDITOR).map((n) => [n.type, n.body]), [['agent_skill_flagged', REASON]]);
  assert.deepEqual(inbox(w, MEMBER), [], 'a member who cannot edit is not told');
  assert.deepEqual(inbox(w, OTHER_EDITOR), [], 'another company is not told');
  const [a] = audits(w);
  assert.equal(a.action, 'agent_skill_flagged');
  assert.equal(a.details.reason, REASON);
  assert.deepEqual([a.details.before, a.details.after], [{ status: 'published' }, { status: 'flagged' }]);
  assert.equal((await call(w, SUPER, 'POST', `${HQ}/${uid}/flag`, { reason: REASON })).status, 409, 'already flagged');
});

test('D4161: a suspension stops every agent using the skill at once, at the run gate', async () => {
  const w = world();
  const uid = await companySkill(w);
  assert.equal((await call(w, EDITOR, 'POST', `/api/teams/skills/${uid}/assign`, { agent_uids: [CFO] })).body.added, 1);
  await call(w, SUPER, 'POST', `${HQ}/${uid}/flag`, { reason: REASON });
  const r = await call(w, SUPER, 'POST', `${HQ}/${uid}/suspend`, { reason: REASON });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.body.status, 'suspended');
  // Mutation checked: the gate's `action = 'suspend'` → `'flag'` makes a suspended skill run and this fails.
  assert.deepEqual(await skillRunRefusal(w.env, idOf(w, uid), 1), { code: 'skill_suspended', message: (await skillRunRefusal(w.env, idOf(w, uid), 1))!.message });
  const mine = await call(w, EDITOR, 'GET', `/api/teams/agents/${CFO}/skills`);
  assert.equal(mine.body.skills[0].suspended, true, 'the team sees it suspended');
  // Mutation checked: the `skill_suspended` line dropped from `attachCheck` → the second agent is given it and this fails.
  const again = await call(w, EDITOR, 'POST', `/api/teams/skills/${uid}/assign`, { agent_uids: ['f'.repeat(32)] });
  assert.deepEqual([again.body.added, again.body.refused[0]?.code], [0, 'skill_suspended']);
  const kept = await call(w, EDITOR, 'PUT', `/api/teams/agents/${CFO}/skills`, { skills: [{ uid }] });
  assert.equal(kept.status, 200, 'an agent that has it keeps it pinned: editing its list is not refused');
  assert.equal(Number((w.db.prepare("SELECT COUNT(*) AS n FROM agent_skill_moderation WHERE action = 'flag' AND cleared_how = 'hq'").get() as any).n), 1, 'the suspension replaced the flag');
  assert.deepEqual(inbox(w, EDITOR).map((n) => n.type), ['agent_skill_flagged', 'agent_skill_suspended']);
  assert.deepEqual(audits(w).map((a) => a.action), ['agent_skill_flagged', 'agent_skill_suspended']);
  assert.equal((await call(w, SUPER, 'POST', `${HQ}/${uid}/flag`, { reason: REASON })).status, 409, 'a suspended skill is not flagged over');
});

test('D4161: HQ never writes a company\'s skill', async () => {
  // Mutation checked: `canEditAsMember` → `canEdit` in team_skills' `mayWrite` → the Super Admin's PATCH lands and this fails.
  const w = world();
  const uid = await companySkill(w);
  const before = w.db.prepare('SELECT name, purpose, steps_json, current_version FROM agent_skills WHERE uid = ?').get(uid);
  for (const who of [SUPER, ADMIN]) {
    const patch = await call(w, who, 'PATCH', `/api/teams/skills/${uid}`, { name: 'Rewritten by HQ' });
    assert.equal(patch.status, 403, patch.text);
    assert.equal(patch.body.error, 'not_editor');
    assert.equal((await call(w, who, 'PATCH', `/api/teams/skills/${uid}`, { status: 'retired' })).status, 403);
    assert.equal((await call(w, who, 'POST', `/api/teams/skills/${uid}/publish`)).status, 403);
    assert.equal((await call(w, who, 'POST', '/api/teams/skills', skill({ name: 'Planted by HQ' }))).status, 403);
  }
  assert.deepEqual(w.db.prepare('SELECT name, purpose, steps_json, current_version FROM agent_skills WHERE uid = ?').get(uid), before);
  assert.equal(count(w, 'agent_skill_versions'), 1);
  const lib = await call(w, SUPER, 'GET', '/api/teams/skills?company=co-uid-1');
  assert.equal(lib.body.company.can_write, false, 'the library does not offer HQ the pen');
  // The HQ router has no statement that writes a skill table: moderation is its only write.
  const src = readFileSync(new URL('../src/routes/admin_company_skills.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /(INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+agent_skill(s|_versions|_tags|_roles|_links)\b/i);
  assert.match(src, /INSERT INTO agent_skill_moderation/);
});

test('D4161: a republished version starts clean; the suspended one stays off; the history stays', async () => {
  const w = world();
  const uid = await companySkill(w);
  const id = idOf(w, uid);
  await call(w, SUPER, 'POST', `${HQ}/${uid}/suspend`, { reason: REASON });
  // The company fixes it and publishes v2.
  assert.equal((await call(w, EDITOR, 'PATCH', `/api/teams/skills/${uid}`, { steps: ['Read the recorded metrics', 'Write the brief, read-only'] })).status, 200);
  assert.equal((await call(w, EDITOR, 'POST', `/api/teams/skills/${uid}/publish`)).status, 200);
  // Mutation checked: the `clearOnRepublish` line dropped from the publish batch → the skill stays suspended and this fails.
  const row = (await call(w, SUPER, 'GET', `${HQ}/${uid}`)).body;
  assert.equal(row.skill.status, 'published');
  assert.equal(row.moderation, null);
  assert.deepEqual(row.history.map((h: any) => [h.action, h.cleared?.how]), [['suspend', 'republished']], 'the history stays');
  assert.equal(await skillRunRefusal(w.env, id, 2), null, 'the new version runs');
  // Mutation checked: the gate's `version >= ?` clause dropped → the old version runs again and this fails.
  assert.equal((await skillRunRefusal(w.env, id, 1))?.code, 'skill_suspended', 'the suspended version stays off until the team moves');
  assert.equal((await call(w, SUPER, 'POST', `${HQ}/${uid}/clear`, { reason: REASON })).status, 409, 'nothing open to clear');
  assert.throws(() => w.db.exec('DELETE FROM agent_skill_moderation'), /kept/);
});

test('D4161: HQ clears a flag or suspension with a reason, and the editors are told', async () => {
  const w = world();
  const uid = await companySkill(w);
  await call(w, SUPER, 'POST', `${HQ}/${uid}/suspend`, { reason: REASON });
  const r = await call(w, SUPER, 'POST', `${HQ}/${uid}/clear`, { reason: 'The tool list was read wrong; it is read-only.' });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.body.status, 'published');
  assert.equal(await skillRunRefusal(w.env, idOf(w, uid), 1), null, 'HQ lifting it lifts it for every version');
  assert.deepEqual(inbox(w, EDITOR).map((n) => n.type), ['agent_skill_suspended', 'agent_skill_moderation_cleared']);
  const last = audits(w).at(-1)!;
  assert.deepEqual([last.action, last.details.before, last.details.after], ['agent_skill_moderation_cleared', { status: 'suspended' }, { status: 'published' }]);
});
