// D4538 part 5 (#5965): real SQLite route tests for explicit company-extension rebasing. Synthetic records only.
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

const paths = (ext: string) => `/api/teams/skills/${ext}`;
const skill = async (w: W, uid: string) => (await call(w, EDITOR, 'GET', paths(uid))).body.skill;
async function rebase(w: W, ext: string, resolutions: any = {}, options: Record<string, unknown> = {}, who = EDITOR) {
  return call(w, who, 'POST', `${paths(ext)}/rebase`, { version: 2, expected_draft_hash: (await skill(w, ext)).draft_hash, resolutions, ...options });
}
async function scenario(options: { conflicts?: boolean; publish?: boolean } = {}) {
  const w = world(), hq = await hqSkill(w);
  const ext = (await extend(w, hq, { name: 'Acme investor update' })).body.skill.uid;
  assert.equal((await call(w, EDITOR, 'PATCH', paths(ext), { steps: ['Our company steps'], tools: ['stripe.read'] })).status, 200);
  if (options.publish !== false) {
    assert.equal((await call(w, EDITOR, 'POST', `${paths(ext)}/publish`)).status, 200);
    w.db.prepare('INSERT INTO agent_skill_links (agent_id, skill_id, version, linked_by) SELECT id, ?, 1, ? FROM team_agents WHERE uid = ?').run(row(w, ext).id, EDITOR, CFO);
  }
  assert.equal((await call(w, SUPER, 'PATCH', paths(hq), { purpose: 'The new Axal purpose.', ...(options.conflicts ? { steps: ['The new Axal steps'], tools: ['hubspot.read', 'xero.read'] } : {}) })).status, 200);
  await hqPublish(w, hq);
  return { w, hq, ext };
}
function companySnapshot(w: W, ext: string) {
  const s = row(w, ext);
  return JSON.stringify({ s, tags: w.db.prepare('SELECT * FROM agent_skill_tags WHERE skill_id = ? ORDER BY rowid').all(s.id),
    roles: w.db.prepare('SELECT * FROM agent_skill_roles WHERE skill_id = ? ORDER BY rowid').all(s.id),
    versions: w.db.prepare('SELECT * FROM agent_skill_versions WHERE skill_id = ? ORDER BY version').all(s.id),
    pins: w.db.prepare('SELECT * FROM agent_skill_links WHERE skill_id = ?').all(s.id),
    audit: w.db.prepare('SELECT * FROM activity_logs ORDER BY id').all() });
}
function immutable(w: W, hq: string, ext: string) {
  const id = row(w, ext).id;
  return JSON.stringify({ hq: hqSnapshot(w, hq), versions: w.db.prepare('SELECT * FROM agent_skill_versions WHERE skill_id = ? ORDER BY version').all(id),
    pins: w.db.prepare('SELECT * FROM agent_skill_links WHERE skill_id = ?').all(id) });
}

test('5965: automatic nonconflicting parts create only a draft; published history, Axal and pins stay; publish records new base', async () => {
  const { w, hq, ext } = await scenario();
  // A comparison excludes these unpublished edits; the supplied hash explicitly protects them from stale replacement.
  await call(w, EDITOR, 'PATCH', paths(ext), { purpose: 'Unpublished purpose', steps: ['Unpublished steps'] });
  const before = immutable(w, hq, ext), beforeHash = (await skill(w, ext)).draft_hash;
  const result = await rebase(w, ext);
  assert.equal(result.status, 200, result.text);
  assert.equal(immutable(w, hq, ext), before);
  assert.deepEqual(result.body.base, { uid: hq, version: 2 });
  assert.deepEqual([row(w, ext).status, row(w, ext).current_version, row(w, ext).based_on_version, row(w, ext).fork_reason], ['published', 1, 2, REASON]);
  assert.deepEqual(result.body.skill.based_on, { skill_uid: hq, version: 2 });
  assert.deepEqual([result.body.skill.draft.name, result.body.skill.draft.purpose, result.body.skill.draft.steps, result.body.skill.draft.tools],
    ['Acme investor update', 'The new Axal purpose.', ['Our company steps'], ['stripe.read']]);
  assert.deepEqual([result.body.skill.purpose, result.body.skill.steps], ['From recorded metrics, a draft update for investors.', ['Our company steps']], 'published card still shows v1');
  const audit = w.db.prepare("SELECT user_id, details FROM activity_logs WHERE action = 'company_skill_draft_saved' ORDER BY id DESC LIMIT 1").get() as any;
  const details = JSON.parse(audit.details);
  assert.equal(audit.user_id, EDITOR);
  assert.deepEqual(details.rebase, { from: { skill_uid: hq, version: 1 }, to: { skill_uid: hq, version: 2 }, company_version: 1, choices: {} });
  assert.equal(details.before.definition_hash, beforeHash);
  assert.equal(details.after.definition_hash, result.body.skill.draft_hash);
  assert.equal(row(w, ext).updated_by, EDITOR);
  assert.equal((await call(w, EDITOR, 'POST', `${paths(ext)}/publish`)).status, 200);
  const lineage = (await call(w, EDITOR, 'GET', `${paths(ext)}/base`)).body.lineage;
  assert.equal(lineage.base_update_available, false);
  assert.deepEqual(lineage.versions, [{ version: 2, based_on_version: 2 }, { version: 1, based_on_version: 1 }]);
  assert.deepEqual(w.db.prepare('SELECT version FROM agent_skill_links WHERE skill_id = ?').all(row(w, ext).id).map((r: any) => r.version), [1]);
});

test('5965: each conflict is required and named; malformed/nonconflicting choices refuse without any write', async () => {
  const { w, hq, ext } = await scenario({ conflicts: true });
  const before = companySnapshot(w, ext), hqBefore = hqSnapshot(w, hq);
  for (const [resolutions, options, status, code, part] of [
    [{}, {}, 422, 'conflict_unresolved', 'steps'],
    [{ steps: { choice: 'mine' } }, {}, 422, 'conflict_unresolved', 'tools'],
    [{ steps: { choice: ['mine'] } }, {}, 400, 'resolution_invalid', 'steps'],
    [{ steps: { choice: 'merge' } }, {}, 400, 'resolution_invalid', 'steps'],
    [{ steps: { choice: 'edit' } }, {}, 400, 'resolution_invalid', 'steps'],
    [{ steps: { choice: 'mine', value: ['unreviewed'] } }, {}, 400, 'resolution_invalid', 'steps'],
    [{ steps: [], tools: { choice: 'axal' } }, {}, 400, 'resolution_invalid', 'steps'],
    [{ purpose: { choice: 'mine' } }, {}, 400, 'resolution_invalid', 'purpose'],
    [{ unknown: { choice: 'mine' } }, {}, 400, 'resolution_invalid', 'unknown'],
    [[], {}, 400, 'resolutions_invalid', undefined],
    [null, {}, 400, 'resolutions_invalid', undefined],
  ] as any[]) {
    const r = await rebase(w, ext, resolutions, options);
    assert.equal(r.status, status, r.text); assert.equal(codeOf(r), code, r.text);
    if (part) assert.equal(r.body.part, part);
    assert.equal(companySnapshot(w, ext), before); assert.equal(hqSnapshot(w, hq), hqBefore);
  }
});

test('5965: mine, Axal and manual choices work; manual values use normal draft validation', async () => {
  for (const [choice, steps] of [['mine', ['Our company steps']], ['axal', ['The new Axal steps']], ['edit', ['Combine the reviewed steps']]] as const) {
    const { w, hq, ext } = await scenario({ conflicts: true });
    const before = immutable(w, hq, ext);
    const r = await rebase(w, ext, { steps: { choice, ...(choice === 'edit' ? { value: [...steps] } : {}) }, tools: { choice: 'axal' } });
    assert.equal(r.status, 200, r.text);
    assert.deepEqual(r.body.skill.draft.steps, [...steps]);
    assert.deepEqual(r.body.skill.draft.tools, ['hubspot.read', 'xero.read'], 'new-base tools are permitted');
    assert.equal(immutable(w, hq, ext), before);
  }
  const { w, ext } = await scenario({ conflicts: true });
  const before = companySnapshot(w, ext);
  const bad = await rebase(w, ext, { steps: { choice: 'edit', value: [] }, tools: { choice: 'axal' } });
  assert.equal(bad.status, 400, bad.text);
  assert.equal(companySnapshot(w, ext), before);
});

test('5965: keeping removed tools or manually widening tools is refused against the new base', async () => {
  const { w, ext } = await scenario({ conflicts: true });
  const before = companySnapshot(w, ext);
  for (const tools of [{ choice: 'mine' }, { choice: 'edit', value: ['stripe.read'] }]) {
    const no = await rebase(w, ext, { steps: { choice: 'mine' }, tools });
    assert.equal(no.status, 422, no.text); assert.equal(codeOf(no), 'tool_not_in_base');
    assert.equal(no.body.tool.key, 'stripe.read'); assert.equal(no.body.part, 'tools');
    assert.equal(companySnapshot(w, ext), before);
  }
  const yes = await rebase(w, ext, { steps: { choice: 'mine' }, tools: { choice: 'edit', value: ['hubspot.read'] } });
  assert.equal(yes.status, 200, yes.text);
  assert.deepEqual(yes.body.skill.draft.tools, ['hubspot.read']);
});

test('5965: only same-company editors write; other tenant, members, HQ including HQ with an editor seat, unauthenticated users refuse', async () => {
  const { w, ext } = await scenario();
  w.db.prepare("INSERT INTO user_company_links (uid, user_id, company_id, role_in_company) VALUES ('hq-seat', ?, 1, 'Owner')").run(SUPER);
  const before = companySnapshot(w, ext);
  for (const [who, status, code] of [[OTHER_EDITOR, 404, 'not_found'], [MEMBER, 403, 'not_editor'], [SUPER, 403, 'not_editor']] as const) {
    const r = await rebase(w, ext, {}, {}, who);
    assert.equal(r.status, status, r.text); assert.equal(codeOf(r), code);
    assert.equal(companySnapshot(w, ext), before);
  }
  const no = await app().request(`${paths(ext)}/rebase`, { method: 'POST' }, w.env);
  assert.equal(no.status, 401); assert.equal(companySnapshot(w, ext), before);
});

test('5965: no update, retired base, suspended newest and unreadable old/new base refuse with no write', async () => {
  for (const state of ['up-to-date', 'retired-base', 'suspended', 'old-version-missing', 'new-version-missing', 'base-missing', 'company-version-missing', 'archived', 'retired-extension']) {
    const { w, hq, ext } = await scenario();
    const id = row(w, hq).id;
    // Deliberately corrupt synthetic history only, bypassing its deletion/FK protection.
    if (state.includes('missing')) w.db.exec('PRAGMA foreign_keys = OFF');
    for (const trigger of w.db.prepare("SELECT name FROM sqlite_master WHERE type = 'trigger' AND tbl_name = 'agent_skill_versions' AND lower(sql) LIKE '%before delete%'").all() as any[]) w.db.exec(`DROP TRIGGER ${trigger.name}`);
    if (state === 'up-to-date') w.db.prepare('UPDATE agent_skills SET current_version = 1 WHERE id = ?').run(id);
    if (state === 'retired-base') w.db.prepare("UPDATE agent_skills SET status = 'retired' WHERE id = ?").run(id);
    if (state === 'suspended') w.db.prepare("INSERT INTO agent_skill_moderation (skill_id, action, version, reason, created_by) VALUES (?, 'suspend', 2, 'Synthetic refusal', ?)").run(id, SUPER);
    if (state === 'old-version-missing' || state === 'new-version-missing') w.db.prepare('DELETE FROM agent_skill_versions WHERE skill_id = ? AND version = ?').run(id, state === 'old-version-missing' ? 1 : 2);
    if (state === 'base-missing') w.db.prepare('DELETE FROM agent_skills WHERE id = ?').run(id);
    if (state === 'company-version-missing') w.db.prepare('DELETE FROM agent_skill_versions WHERE skill_id = ?').run(row(w, ext).id);
    if (state === 'archived') w.db.exec("UPDATE company_profiles SET archived_at = CURRENT_TIMESTAMP WHERE id = 1");
    if (state === 'retired-extension') w.db.prepare("UPDATE agent_skills SET status = 'retired' WHERE uid = ?").run(ext);
    const before = companySnapshot(w, ext);
    const no = await rebase(w, ext);
    assert.equal(no.status, 409, `${state}: ${no.text}`);
    assert.equal(codeOf(no), ({ 'up-to-date': 'no_base_update', 'retired-base': 'base_retired', suspended: 'base_suspended',
      'company-version-missing': 'company_version_unreadable', archived: 'company_archived', 'retired-extension': 'retired' } as any)[state] ?? 'base_unreadable', no.text);
    assert.equal(companySnapshot(w, ext), before);
  }
});

test('5965: expected hash is mandatory, stale draft and stale comparison refuse without overwriting', async () => {
  const { w, ext } = await scenario();
  const loaded = (await skill(w, ext)).draft_hash;
  await call(w, EDITOR, 'PATCH', paths(ext), { steps: ['Another editor saved this'] });
  const before = companySnapshot(w, ext);
  for (const hash of [null, 42, 'invalid', undefined]) {
    const no = await rebase(w, ext, {}, { expected_draft_hash: hash });
    assert.equal(no.status, 400, no.text); assert.equal(codeOf(no), 'draft_hash_invalid');
    assert.equal(companySnapshot(w, ext), before);
  }
  const stale = await rebase(w, ext, {}, { expected_draft_hash: loaded });
  assert.equal(stale.status, 409, stale.text); assert.equal(codeOf(stale), 'draft_conflict');
  assert.deepEqual(stale.body.draft.steps, ['Another editor saved this']);
  assert.equal(stale.body.draft_hash, (await skill(w, ext)).draft_hash);
  assert.equal(companySnapshot(w, ext), before);
  const oldTarget = await rebase(w, ext, {}, { version: 1 });
  assert.equal(oldTarget.status, 409, oldTarget.text); assert.equal(codeOf(oldTarget), 'rebase_conflict');
  for (const version of [0, '2', 2.5, null, undefined]) {
    const no = await rebase(w, ext, {}, { version });
    assert.equal(no.status, 400, no.text); assert.equal(codeOf(no), 'version_invalid');
  }
  assert.equal(companySnapshot(w, ext), before);
});

test('5965: a never-published extension uses its draft; equal changes need no resolution and base-only changes are audited', async () => {
  const { w, hq, ext } = await scenario({ publish: false });
  const before = immutable(w, hq, ext);
  const result = await rebase(w, ext);
  assert.equal(result.status, 200, result.text);
  assert.deepEqual(result.body.skill.draft.steps, ['Our company steps']);
  assert.deepEqual([result.body.skill.status, result.body.skill.version, result.body.skill.based_on.version], ['draft', null, 2]);
  assert.equal(immutable(w, hq, ext), before);
  // A third HQ version has an identical definition to v2: no automatic changes and no conflicts.
  await hqPublish(w, hq);
  const hash = (await skill(w, ext)).draft_hash;
  const again = await rebase(w, ext, {}, { version: 3 });
  assert.equal(again.status, 200, again.text);
  assert.equal(again.body.skill.draft_hash, hash);
  const a = w.db.prepare("SELECT details FROM activity_logs WHERE action = 'company_skill_draft_saved' ORDER BY id DESC LIMIT 1").get() as any;
  const d = JSON.parse(a.details);
  assert.equal(d.before.definition_hash, d.after.definition_hash);
  assert.equal(d.rebase.to.version, 3);
});

/** Change state just before the actual D1 batch; real SQLite then executes the guard and rollback. */
function beforeBatch(w: W, change: () => void) {
  const batch = w.env.DB.batch.bind(w.env.DB);
  w.env.DB = { ...w.env.DB, batch: async (statements: any[]) => { change(); return batch(statements); } };
}
test('5965: concurrent draft edit is preserved by the transactional guard, including tag/role writes', async () => {
  const { w, ext } = await scenario();
  const auditBefore = count(w, 'activity_logs');
  beforeBatch(w, () => { w.db.prepare("UPDATE agent_skills SET purpose = 'Concurrent saved purpose' WHERE uid = ?").run(ext); });
  const no = await rebase(w, ext);
  assert.equal(no.status, 409, no.text); assert.equal(codeOf(no), 'draft_conflict');
  assert.equal(row(w, ext).purpose, 'Concurrent saved purpose');
  assert.equal(row(w, ext).based_on_version, 1);
  assert.equal(count(w, 'activity_logs'), auditBefore);
});
test('5965: concurrent base publish, suspension, lineage-only change or company publish refuses atomically', async () => {
  for (const change of ['base-publish', 'suspend', 'lineage', 'company-publish']) {
    const { w, hq, ext } = await scenario();
    const original = row(w, ext), before = immutable(w, hq, ext), auditBefore = count(w, 'activity_logs');
    beforeBatch(w, () => {
      if (change === 'base-publish') w.db.prepare('UPDATE agent_skills SET current_version = 3 WHERE uid = ?').run(hq);
      if (change === 'suspend') w.db.prepare("INSERT INTO agent_skill_moderation (skill_id, action, version, reason, created_by) VALUES (?, 'suspend', 2, 'Concurrent suspension', ?)").run(row(w, hq).id, SUPER);
      if (change === 'lineage') w.db.prepare('UPDATE agent_skills SET based_on_version = 2 WHERE uid = ?').run(ext);
      if (change === 'company-publish') w.db.prepare('UPDATE agent_skills SET current_version = 2 WHERE uid = ?').run(ext);
    });
    const no = await rebase(w, ext);
    assert.equal(no.status, 409, `${change}: ${no.text}`); assert.equal(codeOf(no), 'rebase_conflict');
    assert.deepEqual([row(w, ext).name, row(w, ext).purpose, row(w, ext).steps_json, row(w, ext).updated_by], [original.name, original.purpose, original.steps_json, original.updated_by]);
    assert.equal(count(w, 'activity_logs'), auditBefore);
    if (change !== 'base-publish') assert.equal(immutable(w, hq, ext), before);
  }
});

test('5965: standalone skills and malformed JSON bodies cannot be rebased', async () => {
  const { w, ext } = await scenario();
  const own = await call(w, EDITOR, 'POST', '/api/teams/skills', { ...hqDraft({ name: 'Standalone' }), scope: 'company', company: 'co-uid-1' });
  const no = await rebase(w, own.body.skill.uid);
  assert.equal(no.status, 422, no.text); assert.equal(codeOf(no), 'not_extension');
  const before = companySnapshot(w, ext);
  for (const body of [null, [], 'invalid']) {
    const bad = await call(w, EDITOR, 'POST', `${paths(ext)}/rebase`, body);
    assert.equal(bad.status, 400, bad.text); assert.equal(codeOf(bad), 'body_invalid');
    assert.equal(companySnapshot(w, ext), before);
  }
});

test('5965: every one of the seven parts needs its own conflict choice, including scalar, tags and roles', async () => {
  const w = world(), hq = await hqSkill(w);
  const ext = (await extend(w, hq, { name: 'Company name' })).body.skill.uid;
  const company = { purpose: 'Company purpose.', steps: ['Company steps'], tools: ['stripe.read'], output_kind: 'brief', roles: ['ceo'], tags: [{ slug: 'investor_reporting', level: 'advanced' }] };
  const axal = { name: 'New Axal name', purpose: 'New Axal purpose.', steps: ['Axal steps'], tools: ['xero.read'], output_kind: 'record_change', roles: ['coo'], tags: [{ slug: 'investor_reporting', level: 'expert' }] };
  assert.equal((await call(w, EDITOR, 'PATCH', paths(ext), company)).status, 200);
  assert.equal((await call(w, EDITOR, 'POST', `${paths(ext)}/publish`)).status, 200);
  assert.equal((await call(w, SUPER, 'PATCH', paths(hq), axal)).status, 200);
  await hqPublish(w, hq);
  const fields = ['name', 'purpose', 'steps', 'tools', 'output_kind', 'tags', 'roles'];
  const lineage = (await call(w, EDITOR, 'GET', `${paths(ext)}/base`)).body.lineage;
  assert.deepEqual(lineage.fields.filter((f: any) => f.conflict).map((f: any) => f.field), fields);
  const choices = Object.fromEntries(fields.map(f => [f, { choice: 'axal' }]));
  const before = companySnapshot(w, ext);
  for (const part of fields) {
    const subset = { ...choices }; delete subset[part];
    const no = await rebase(w, ext, subset);
    assert.equal(no.status, 422, no.text); assert.equal(codeOf(no), 'conflict_unresolved'); assert.equal(no.body.part, part);
    assert.equal(companySnapshot(w, ext), before);
  }
  const yes = await rebase(w, ext, choices);
  assert.equal(yes.status, 200, yes.text);
  assert.equal(yes.body.skill.draft.name, axal.name);
  assert.equal(yes.body.skill.draft.output_kind, axal.output_kind);
  assert.deepEqual(yes.body.skill.draft.roles.map((r: any) => r.key), axal.roles);
  assert.deepEqual(yes.body.skill.draft.tags.map((t: any) => ({ slug: t.slug, level: t.level })), axal.tags);
});

test('5965: an identical change by both sides is not a conflict', async () => {
  const { w, ext } = await scenario();
  await call(w, EDITOR, 'PATCH', paths(ext), { purpose: 'The new Axal purpose.' });
  await call(w, EDITOR, 'POST', `${paths(ext)}/publish`);
  const fields = (await call(w, EDITOR, 'GET', `${paths(ext)}/base`)).body.lineage.fields;
  assert.deepEqual(fields.find((f: any) => f.field === 'purpose'), { field: 'purpose', company_changed: true, base_changed: true, conflict: false });
  const r = await rebase(w, ext);
  assert.equal(r.status, 200, r.text); assert.equal(r.body.skill.draft.purpose, 'The new Axal purpose.');
});
