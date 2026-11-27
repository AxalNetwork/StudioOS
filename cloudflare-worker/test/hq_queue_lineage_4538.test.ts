// D4538 part 3 (#4538) — HQ's company-skill moderation queue shows an extension's lineage.
//
//   1. GET /api/admin/ai-agents/company-skills and GET …/:uid carry `based_on` on every company skill: on an
//      extension { skill_uid, version, name, base_readable: true }, the name being the HQ skill's name at that
//      published version; on a standalone skill null. The detail carries the company's `fork_reason`.
//   2. A base that cannot be read (a missing HQ row, a missing version, or a uid that is not an HQ skill) reads
//      { name: null, base_readable: false }: never null, which would pass the extension off as standalone.
//   3. The gate is unchanged: a plain admin, a company editor and a member get 403 on both reads.
//
//   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
//     --test cloudflare-worker/test/hq_queue_lineage_4538.test.ts
//
// Everything runs on the node:sqlite D1 fixture (the same world as skill_extensions_4538.test.ts).
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
import { mount } from '../src/routes/admin_company_skills.ts';

const sql = (f: string) => readFileSync(new URL(`../sql/${f}`, import.meta.url), 'utf8');
const BASELINE = sql('schema_baseline.sql');
const MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
const SUPER = 1, ADMIN = 2, SUPER2 = 3, EDITOR = 10, MEMBER = 11, OTHER_EDITOR = 13;
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
  user.run(ADMIN, 'u-admin', 'admin@example.test', 'Ada Admin', 'admin', null);
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
  const env: any = { DB, JWT_SECRET: 'd4538-p3-queue-fixture-only-secret', ENVIRONMENT: 'development', TEAM_AGENTS_ENABLED: 'true' };
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
const HQ = '/api/admin/ai-agents/company-skills';
const queueRow = async (w: W, uid: string) => {
  const r = await call(w, SUPER, 'GET', HQ);
  assert.equal(r.status, 200, r.text);
  return r.body.skills.find((s: any) => s.uid === uid);
};
const detailOf = async (w: W, uid: string) => {
  const r = await call(w, SUPER, 'GET', `${HQ}/${uid}`);
  assert.equal(r.status, 200, r.text);
  return r.body.skill;
};
/** A company skill written from scratch: standalone, no lineage. */
async function standalone(w: W) {
  const made = await call(w, EDITOR, 'POST', '/api/teams/skills', { ...hqDraft({ name: 'Acme board brief', tools: [] }), scope: 'company', company: 'co-uid-1' });
  assert.equal(made.status, 201, made.text);
  return made.body.skill.uid as string;
}

test('D4538 p3: the queue and the detail name an extension\'s HQ base at its version; a standalone skill reads null', async () => {
  const w = world();
  const hq = await hqSkill(w);
  // HQ renames the skill in version 2. The extension was built on version 1, and the queue names version 1.
  assert.equal((await call(w, SUPER, 'PATCH', `/api/teams/skills/${hq}`, { name: 'Investor update, renamed' })).status, 200);
  await hqPublish(w, hq);
  const made = await extend(w, hq, { version: 1, name: 'Acme investor update' });
  assert.equal(made.status, 201, made.text);
  const ext = made.body.skill.uid as string;
  const plain = await standalone(w);
  const lineage = { skill_uid: hq, version: 1, name: 'Draft the monthly investor update', base_readable: true };
  assert.deepEqual((await queueRow(w, ext)).based_on, lineage);
  const detail = await detailOf(w, ext);
  assert.deepEqual(detail.based_on, lineage);
  assert.equal(detail.fork_reason, REASON, 'the company\'s reason for the extension is shown to its moderator');
  assert.equal((await queueRow(w, plain)).based_on, null, 'a standalone company skill has no lineage');
  const plainDetail = await detailOf(w, plain);
  assert.equal(plainDetail.based_on, null);
  assert.equal(plainDetail.fork_reason, null);
  assert.doesNotMatch((await call(w, SUPER, 'GET', HQ)).text, /@/, 'still no email in the queue');
});

test('D4538 p3: a base that cannot be read is flagged, never shown as standalone', async () => {
  const w = world();
  const hq = await hqSkill(w);
  const missingRow = (await extend(w, hq, { name: 'Ext missing row' })).body.skill.uid as string;
  const missingVersion = (await extend(w, hq, { name: 'Ext missing version' })).body.skill.uid as string;
  const notHq = (await extend(w, hq, { name: 'Ext pointed at a company skill' })).body.skill.uid as string;
  const plain = await standalone(w);
  // Published, so a lookup that forgot `scope = 'hq'` would find a version 1 and read it.
  assert.equal((await call(w, EDITOR, 'POST', `/api/teams/skills/${plain}/publish`)).status, 200);
  const gone = 'e'.repeat(32);
  w.db.prepare('UPDATE agent_skills SET based_on_skill_uid = ? WHERE uid = ?').run(gone, missingRow);
  w.db.prepare('UPDATE agent_skills SET based_on_version = 9 WHERE uid = ?').run(missingVersion);
  w.db.prepare('UPDATE agent_skills SET based_on_skill_uid = ? WHERE uid = ?').run(plain, notHq);
  const cases: [string, unknown][] = [
    [missingRow, { skill_uid: gone, version: 1, name: null, base_readable: false }],
    [missingVersion, { skill_uid: hq, version: 9, name: null, base_readable: false }],
    [notHq, { skill_uid: plain, version: 1, name: null, base_readable: false }],
  ];
  for (const [uid, want] of cases) {
    assert.deepEqual((await queueRow(w, uid)).based_on, want, uid);
    assert.deepEqual((await detailOf(w, uid)).based_on, want, uid);
  }
});

test('D4538 p3: the gate is unchanged — a plain admin, a company editor and a member are refused both reads', async () => {
  const w = world();
  const hq = await hqSkill(w);
  const ext = (await extend(w, hq)).body.skill.uid as string;
  for (const who of [ADMIN, EDITOR, MEMBER]) {
    for (const path of [HQ, `${HQ}/${ext}`]) {
      const r = await call(w, who, 'GET', path);
      assert.equal(r.status, 403, `${who} ${path}: ${r.text}`);
      assert.doesNotMatch(r.text, /based_on|Draft the monthly investor update/, 'nothing of the lineage leaks in a refusal');
    }
  }
  assert.equal((await call(w, SUPER, 'GET', `${HQ}/${ext}`)).status, 200);
});
