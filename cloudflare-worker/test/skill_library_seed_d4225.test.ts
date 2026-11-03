// D4225 (#4225) — the "From Axal" skill library, about eighty skills across the
// eight areas, seeded into the store through H2's lifecycle (D4160).
//
//   1. Every library file passes the store's own draft and case checks.
//   2. Seeding creates each skill as an hq DRAFT with its golden cases: nothing is published.
//   3. Seeding twice duplicates nothing; the second run creates nothing and writes no audit row.
//   4. A reason is required, and the seed is audited with it.
//   5. Super Admin only.
//   6. GET /library: each skill's area and level from its first tag, its check, and its place in the store.
//
//   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
//     --test cloudflare-worker/test/skill_library_seed_d4225.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SignJWT } from 'jose';
import { Hono } from 'hono';
import { makeD1 } from './_d1_sqlite.mjs';
import { stripForeignKeys, tableFromBaseline } from './_baseline.mjs';
import { AI_LOG_SCHEMA } from './_ai_budget_fixture.mjs';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';
import { mount } from '../src/routes/admin_hq_skills.ts';
import { SKILL_LIBRARY } from '../src/services/agents/skillLibrary.generated.ts';
import { checkLibrary, readLibrarySkill } from '../src/services/agents/skillLibrarySeed.ts';

const sql = (f: string) => readFileSync(new URL(`../sql/${f}`, import.meta.url), 'utf8');
const BASELINE = sql('schema_baseline.sql');
const SUPER = 1, ADMIN = 2;
const LIB = '/api/admin/ai-agents/skills/library';
const REASON = 'Load the From Axal library for review.';
const AREAS = ['product', 'engineering', 'design', 'gtm_sales', 'marketing_brand', 'finance_ops', 'legal_compliance', 'capital_network'];

function world() {
  const { DB, db } = makeD1(['users', 'company_profiles', 'user_company_links', 'projects', 'activity_logs'].map((t) => stripForeignKeys(tableFromBaseline(BASELINE, t))).join('\n')
    + AI_LOG_SCHEMA + sql('migrations/506_ai_rail_proposals.sql'));
  db.exec(sql('migrations/199_super_admin.sql'));
  db.exec(sql('migrations/089_skills_values_taxonomy.sql'));
  db.exec(sql('migrations/090_seed_skills_values_taxonomy.sql'));
  db.exec(sql('migrations/712_team_agents.sql'));
  db.exec(sql('migrations/759_agent_skills.sql'));
  db.exec(sql('migrations/202611022046_ai_admin_audit.sql'));
  db.exec(sql('migrations/202611022055_agent_skill_moderation.sql'));
  db.exec(sql('migrations/202611022140_hq_skill_lifecycle.sql'));
  const user = db.prepare("INSERT INTO users (id, uid, email, name, role, subscription_tier, subscription_status) VALUES (?, ?, ?, ?, 'admin', 'growth', 'active')");
  user.run(SUPER, 'u-super', 'super@example.test', 'Sue Super');
  user.run(ADMIN, 'u-admin', 'admin@example.test', 'Ada Admin');
  db.prepare('INSERT INTO super_admins (user_id) VALUES (?)').run(SUPER);
  const env: any = { DB, JWT_SECRET: 'd4225-fixture-only-secret', ENVIRONMENT: 'development' };
  return { db, env };
}
type W = ReturnType<typeof world>;

function app() {
  const a = new Hono();
  a.onError((e: any, c) => {
    const status = AUTH_ERROR_STATUSES[e?.message];
    return status ? c.json({ detail: e.message }, status) : c.json({ detail: 'Internal server error', m: String(e?.message) }, 500);
  });
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
const n = (w: W, q: string) => (w.db.prepare(q).get() as { n: number }).n;

test('every library file passes the store\'s own draft and case checks', () => {
  const tax = new Set(sql('migrations/090_seed_skills_values_taxonomy.sql').match(/\('([a-z_]+)',/g)!.map((m) => m.slice(2, -2)));
  assert.ok(SKILL_LIBRARY.length >= 70, `${SKILL_LIBRARY.length} skills`);
  for (const x of checkLibrary(tax)) assert.ok(x.ok, `${x.entry.slug}: ${x.ok ? '' : `${x.code} ${x.message}`}`);
  for (const e of SKILL_LIBRARY) assert.ok(readLibrarySkill(e.skill_md), `${e.slug}: does not parse`);
});

test('a broken library file is refused by the check, and the seed skips it', async () => {
  const w = world();
  const good = SKILL_LIBRARY[0];
  const writes = { ...good, slug: 'bad-write-tool', skill_md: good.skill_md.replace(/^name: .*$/m, 'name: bad-write-tool').replace(/^tools: \[(.*?)\]/m, 'tools: [stripe.create_invoice]') };
  const { seedLibrary } = await import('../src/services/agents/skillLibrarySeed.ts');
  const lines = await seedLibrary(w.env, SUPER, REASON, [writes, good]);
  assert.equal(lines[0].outcome, 'refused');
  assert.equal(lines[1].outcome, 'created');
  assert.equal(n(w, "SELECT COUNT(*) AS n FROM agent_skills WHERE slug = 'bad-write-tool'"), 0);
});

test('seeding creates every skill as an hq draft with its golden cases; nothing is published; twice duplicates nothing', async () => {
  const w = world();
  const r = await call(w, SUPER, 'POST', `${LIB}/seed`, { reason: REASON });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.body.refused, 0, JSON.stringify(r.body.seeded.filter((l: any) => l.outcome === 'refused')));
  assert.equal(r.body.created, SKILL_LIBRARY.length);
  assert.equal(n(w, "SELECT COUNT(*) AS n FROM agent_skills WHERE scope = 'hq' AND status = 'draft' AND company_id IS NULL"), SKILL_LIBRARY.length);
  assert.equal(n(w, "SELECT COUNT(*) AS n FROM agent_skills WHERE status <> 'draft'"), 0, 'the seed published something');
  assert.equal(n(w, 'SELECT COUNT(*) AS n FROM agent_skill_versions'), 0, 'the seed published a version');
  const cases = SKILL_LIBRARY.reduce((a, e) => a + e.cases.length, 0);
  assert.equal(n(w, 'SELECT COUNT(*) AS n FROM agent_skill_cases WHERE removed_at IS NULL'), cases);
  assert.equal(n(w, 'SELECT COUNT(*) AS n FROM agent_skills s WHERE NOT EXISTS (SELECT 1 FROM agent_skill_tags t WHERE t.skill_id = s.id)'), 0, 'a skill with no tag');
  assert.equal(n(w, 'SELECT COUNT(*) AS n FROM agent_skills s WHERE NOT EXISTS (SELECT 1 FROM agent_skill_roles t WHERE t.skill_id = s.id)'), 0, 'a skill with no role');
  const audit = w.db.prepare("SELECT * FROM ai_admin_audit WHERE action = 'skills.library_seed'").all() as any[];
  assert.equal(audit.length, 1);
  assert.equal(audit[0].reason, REASON);
  assert.equal(audit[0].admin_user_id, SUPER);
  assert.equal(JSON.parse(audit[0].after_json).created, SKILL_LIBRARY.length);

  const again = await call(w, SUPER, 'POST', `${LIB}/seed`, { reason: REASON });
  assert.equal(again.status, 200, again.text);
  assert.equal(again.body.created, 0);
  assert.ok(again.body.seeded.every((l: any) => l.outcome === 'present'));
  assert.equal(n(w, 'SELECT COUNT(*) AS n FROM agent_skills'), SKILL_LIBRARY.length, 'a duplicate skill');
  assert.equal(n(w, 'SELECT COUNT(*) AS n FROM agent_skill_cases'), cases, 'a duplicate case');
  assert.equal(n(w, "SELECT COUNT(*) AS n FROM ai_admin_audit WHERE action = 'skills.library_seed'"), 1, 'a no-op seed was audited');
  assert.doesNotMatch(r.text + again.text, /@/, 'an email in the answer');
});

test('a draft that lost its case gets it back; a published skill is left alone', async () => {
  const w = world();
  await call(w, SUPER, 'POST', `${LIB}/seed`, { reason: REASON });
  const [a, b] = SKILL_LIBRARY;
  w.db.prepare("UPDATE agent_skill_cases SET removed_at = CURRENT_TIMESTAMP WHERE skill_id = (SELECT id FROM agent_skills WHERE slug = ?)").run(a.slug);
  w.db.prepare("UPDATE agent_skills SET status = 'published' WHERE slug = ?").run(b.slug);
  w.db.prepare("UPDATE agent_skill_cases SET removed_at = CURRENT_TIMESTAMP WHERE skill_id = (SELECT id FROM agent_skills WHERE slug = ?)").run(b.slug);
  const r = await call(w, SUPER, 'POST', `${LIB}/seed`, { reason: REASON });
  const line = (s: string) => r.body.seeded.find((l: any) => l.slug === s);
  assert.equal(line(a.slug).outcome, 'cases_added');
  assert.equal(line(b.slug).outcome, 'present');
  assert.equal(n(w, `SELECT COUNT(*) AS n FROM agent_skill_cases WHERE removed_at IS NULL AND skill_id = (SELECT id FROM agent_skills WHERE slug = '${b.slug}')`), 0);
});

test('a reason is required, and only a Super Admin may read or seed the library', async () => {
  const w = world();
  for (const body of [{}, { reason: '   ' }]) {
    const r = await call(w, SUPER, 'POST', `${LIB}/seed`, body);
    assert.equal(r.status, 400, r.text);
    assert.match(r.text, /reason_required/);
  }
  assert.equal(n(w, 'SELECT COUNT(*) AS n FROM agent_skills'), 0);
  for (const [m, p] of [['GET', LIB], ['POST', `${LIB}/seed`]] as const) {
    const r = await call(w, ADMIN, m, p, m === 'POST' ? { reason: REASON } : undefined);
    assert.equal(r.status, 403, `${m} ${p}: ${r.text}`);
  }
  assert.equal(n(w, 'SELECT COUNT(*) AS n FROM agent_skills'), 0);
});

test('GET /library: every skill with its area and level, ten or more per area, and its place in the store', async () => {
  const w = world();
  const before = await call(w, SUPER, 'GET', LIB);
  assert.equal(before.status, 200, before.text);
  assert.equal(before.body.skills.length, SKILL_LIBRARY.length);
  const per = new Map(AREAS.map((a) => [a, 0]));
  for (const s of before.body.skills) {
    assert.ok(AREAS.includes(s.area), `${s.slug}: area ${s.area}`);
    assert.ok(s.level, `${s.slug}: no level`);
    assert.ok(s.cases >= 1, `${s.slug}: no case`);
    assert.deepEqual(s.check, { ok: true }, s.slug);
    assert.equal(s.in_store, null);
    per.set(s.area, per.get(s.area)! + 1);
  }
  for (const [a, k] of per) assert.ok(k >= 10, `${a}: ${k}`);
  await call(w, SUPER, 'POST', `${LIB}/seed`, { reason: REASON });
  const after = await call(w, SUPER, 'GET', LIB);
  assert.ok(after.body.skills.every((s: any) => s.in_store === 'draft'));
});
