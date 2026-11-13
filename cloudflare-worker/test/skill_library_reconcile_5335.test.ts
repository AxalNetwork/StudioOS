// D5335 (#5335) — GET /api/admin/ai-agents/skills/library/reconcile: the read-only
// preflight D4532 §3 names, comparing the generated library with the store's HQ skills.
//
//   1. On a seeded local D1, every class: exact, source_only, persisted_only, content_drift,
//      case_drift, missing_case, duplicate_identity and invalid_reference, with the two hashes
//      and the published version, and the totals per class (zeros included).
//   2. A company skill with a library slug, or a slug of its own, is ignored.
//   3. A plain admin is refused (403); the Super Admin is let in.
//   4. No skill, tag, role, case, review, version or result row changes; the one write is the audit row.
//   5. The answer carries no draft text, no case input and no person.
//   6. `libraryManifest` (the Worker's source side) equals the CI gate's manifest on the committed library.
//   7. `scripts/check-skill-library.mjs --persisted` reads the route's JSON as its manifest.
//
//   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
//     --test cloudflare-worker/test/skill_library_reconcile_5335.test.ts
//
// Every record here is made up.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { SignJWT } from 'jose';
import { Hono } from 'hono';
import { makeD1 } from './_d1_sqlite.mjs';
import { stripForeignKeys, tableFromBaseline } from './_baseline.mjs';
import { AI_LOG_SCHEMA } from './_ai_budget_fixture.mjs';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';
import { mount } from '../src/routes/admin_hq_skills.ts';
import { SKILL_LIBRARY, assetsForSkillLibrary } from './_skill_library.ts'; // D4574 H3: the entries are a static asset
import { seedLibrary, readLibrarySkill } from '../src/services/agents/skillLibrarySeed.ts';
import { RECONCILE_CLASSES, checkSourceCatalogue, libraryManifest, persistedFromJson } from '../src/services/agents/skillCatalogue.ts';
import { readSources, taxonomyFromSeed } from '../../scripts/check-skill-library.mjs';

const sql = (f: string) => readFileSync(new URL(`../sql/${f}`, import.meta.url), 'utf8');
const BASELINE = sql('schema_baseline.sql');
const SUPER = 1, ADMIN = 2;
const PATH = '/api/admin/ai-agents/skills/library/reconcile';
const TAXONOMY = taxonomyFromSeed(sql('migrations/090_seed_skills_values_taxonomy.sql'));

function world() {
  const { DB, db } = makeD1(['users', 'company_profiles', 'user_company_links', 'projects', 'activity_logs'].map((t) => stripForeignKeys(tableFromBaseline(BASELINE, t))).join('\n')
    + AI_LOG_SCHEMA + sql('migrations/506_ai_rail_proposals.sql'));
  for (const m of ['199_super_admin', '089_skills_values_taxonomy', '090_seed_skills_values_taxonomy', '712_team_agents', '759_agent_skills',
    '202611022046_ai_admin_audit', '202611022055_agent_skill_moderation', '202611022140_hq_skill_lifecycle',
    '202611090904_skill_eval_result_identity', '202611100853_skill_case_source_identity']) db.exec(sql(`migrations/${m}.sql`));
  const user = db.prepare("INSERT INTO users (id, uid, email, name, role, subscription_tier, subscription_status) VALUES (?, ?, ?, ?, 'admin', 'growth', 'active')");
  user.run(SUPER, 'u-super-5335', 'super@example.test', 'Sue Super');
  user.run(ADMIN, 'u-admin-5335', 'admin@example.test', 'Ada Admin');
  db.prepare('INSERT INTO super_admins (user_id) VALUES (?)').run(SUPER);
  db.exec("INSERT INTO company_profiles (id, uid, company_name) VALUES (7, 'co-7', 'Acme')");
  const env: any = { DB, ASSETS: assetsForSkillLibrary(), JWT_SECRET: 'd5335-fixture-only-secret', ENVIRONMENT: 'development' };
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
async function get(w: W, who: number) {
  const jwt = await new SignJWT({ user_id: who }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(w.env.JWT_SECRET));
  const r = await app().request(PATH, { headers: { Authorization: `Bearer ${jwt}` } }, w.env);
  const text = await r.text();
  let body: any = null;
  try { body = JSON.parse(text); } catch { body = null; }
  return { status: r.status, body, text };
}

const STORE = ['agent_skills', 'agent_skill_versions', 'agent_skill_tags', 'agent_skill_roles', 'agent_skill_links', 'agent_skill_reviews', 'agent_skill_cases', 'agent_skill_eval_results', 'agent_skill_retirements'];
const counts = (w: W) => Object.fromEntries(STORE.map((t) => [t, (w.db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as any).n]));
const audits = (w: W) => (w.db.prepare("SELECT COUNT(*) AS n FROM activity_logs WHERE action = 'agent_skill_library_reconciled'").get() as any).n;
const idOf = (w: W, slug: string) => (w.db.prepare("SELECT id FROM agent_skills WHERE scope = 'hq' AND slug = ?").get(slug) as any).id;

const SEEDED = SKILL_LIBRARY.slice(0, 5);
const [EXACT, PUBLISHED, CONTENT, CASES, MISSING] = SEEDED.map((e) => e.slug);
/** A library entry whose first tag no seeded entry uses: deactivating that tag makes it (and its peers) invalid. */
const tagsOf = (md: string) => ((readLibrarySkill(md)?.tags as Array<{ slug: string }> | undefined) ?? []).map((t) => t.slug);
const seededTags = new Set(SEEDED.flatMap((e) => tagsOf(e.skill_md)));
const INVALID = SKILL_LIBRARY.slice(5).find((e) => tagsOf(e.skill_md).every((t) => !seededTags.has(t)))!;
const DEAD_TAG = tagsOf(INVALID.skill_md)[0];
const COMPANY_ONLY = 'company-only-5335';
const SECRET_STEP = 'An edited step naming Project Kestrel.';
const SECRET_INPUT = 'Kestrel synthetic runway note';

/** Seed five library skills, then give the store one line of every class. */
async function arranged() {
  const w = world();
  await seedLibrary(w.env, SUPER, 'Seed a local fixture for the reconcile route test.', SEEDED);
  // published_version: a seeded draft that has been published twice and is unchanged since.
  w.db.prepare("UPDATE agent_skills SET current_version = 2 WHERE scope = 'hq' AND slug = ?").run(PUBLISHED);
  // content_drift: an edited draft.
  w.db.prepare("UPDATE agent_skills SET steps_json = ? WHERE scope = 'hq' AND slug = ?").run(JSON.stringify([SECRET_STEP]), CONTENT);
  // case_drift: a changed case, carrying input that must never be echoed.
  w.db.prepare('UPDATE agent_skill_cases SET input_json = ? WHERE skill_id = ?').run(JSON.stringify({ records: { 'x.read': { note: SECRET_INPUT } } }), idOf(w, CASES));
  // missing_case: every case removed.
  w.db.prepare('UPDATE agent_skill_cases SET removed_at = CURRENT_TIMESTAMP WHERE skill_id = ?').run(idOf(w, MISSING));
  // persisted_only: an HQ skill the files do not have.
  const hq = w.db.prepare("INSERT INTO agent_skills (uid, scope, company_id, slug, name, purpose, output_kind, created_by) VALUES (?, 'hq', NULL, ?, 'HQ only', 'Not in the files.', 'brief', 1)");
  hq.run('a'.repeat(32), 'hq-only-5335');
  // duplicate_identity: D1's unique index forbids two rows of one identity; drop it here so the route is seen to report one, not crash.
  w.db.exec('DROP INDEX idx_agent_skills_slug');
  hq.run('b'.repeat(32), 'hq-twice-5335');
  hq.run('c'.repeat(32), 'hq-twice-5335');
  // invalid_reference: a library entry whose taxonomy tag the store no longer has.
  w.db.prepare('UPDATE skills SET is_active = 0 WHERE slug = ?').run(DEAD_TAG);
  // A company's skills: one with a library slug, one of its own. Neither is the library's.
  const co = w.db.prepare("INSERT INTO agent_skills (uid, scope, company_id, slug, name, purpose, output_kind, created_by, steps_json) VALUES (?, 'company', 7, ?, 'Company copy', 'Their own.', 'brief', 1, ?)");
  co.run('d'.repeat(32), EXACT, JSON.stringify([SECRET_STEP]));
  co.run('e'.repeat(32), COMPANY_ONLY, JSON.stringify([SECRET_STEP]));
  return w;
}

test('every class on a seeded local D1, with both hashes, the published version and the totals', async () => {
  const w = await arranged();
  const r = await get(w, SUPER);
  assert.equal(r.status, 200, r.text);
  const by = new Map<string, any[]>();
  for (const l of r.body.skills) by.set(l.slug, [...(by.get(l.slug) ?? []), l]);
  const one = (slug: string) => { const ls = by.get(slug) ?? []; assert.equal(ls.length, 1, `${slug}: one line`); return ls[0]; };

  assert.deepEqual([one(EXACT).class, one(EXACT).disposition], ['exact', 'none']);
  assert.ok(one(EXACT).source_hash && one(EXACT).source_hash === one(EXACT).persisted_hash, 'exact: the two hashes agree');
  assert.equal(one(EXACT).published_version, null, 'a draft never published has no version');
  assert.deepEqual([one(PUBLISHED).class, one(PUBLISHED).published_version], ['exact', 2]);
  assert.deepEqual([one(CONTENT).class, one(CONTENT).disposition], ['content_drift', 'report']);
  assert.ok(one(CONTENT).source_hash && one(CONTENT).persisted_hash && one(CONTENT).source_hash !== one(CONTENT).persisted_hash);
  assert.deepEqual([one(CASES).class, one(CASES).disposition], ['case_drift', 'report']);
  assert.deepEqual([one(MISSING).class, one(MISSING).disposition], ['missing_case', 'report']);
  assert.deepEqual([one('hq-only-5335').class, one('hq-only-5335').disposition, one('hq-only-5335').source_hash], ['persisted_only', 'report', null]);
  assert.deepEqual([one('hq-twice-5335').class, one('hq-twice-5335').disposition], ['duplicate_identity', 'fail']);
  assert.deepEqual([one(INVALID.slug).class, one(INVALID.slug).disposition, one(INVALID.slug).source_hash], ['invalid_reference', 'fail', null]);
  const untouched = SKILL_LIBRARY.slice(5).find((e) => !tagsOf(e.skill_md).includes(DEAD_TAG))!;
  assert.deepEqual([one(untouched.slug).class, one(untouched.slug).disposition, one(untouched.slug).persisted_hash], ['source_only', 'seed', null]);

  // The totals name every class and add up to the lines.
  assert.deepEqual(Object.keys(r.body.totals), [...RECONCILE_CLASSES]);
  for (const k of RECONCILE_CLASSES) assert.equal(r.body.totals[k], r.body.skills.filter((l: any) => l.class === k).length, k);
  assert.equal(r.body.totals.exact, 2);
  assert.equal(r.body.totals.persisted_only, 1);
  assert.equal(r.body.totals.duplicate_identity, 1);
  assert.ok(r.body.totals.invalid_reference >= 1);
  assert.equal(r.body.totals.source_only + r.body.totals.invalid_reference + 5, SKILL_LIBRARY.length, 'every library slug is one line');
  assert.equal(r.body.scope, 'hq');
  assert.equal(r.body.report_version, 1);
  assert.match(r.body.read_at, /^\d{4}-\d\d-\d\dT/);
});

test('a company skill, with a library slug or its own, is ignored', async () => {
  const w = await arranged();
  const r = await get(w, SUPER);
  assert.equal(r.status, 200, r.text);
  assert.equal(r.body.skills.filter((l: any) => l.slug === EXACT).length, 1);
  assert.equal(r.body.skills.find((l: any) => l.slug === EXACT).class, 'exact', 'the company copy is no duplicate');
  assert.ok(!r.body.skills.some((l: any) => l.slug === COMPANY_ONLY), 'a company-only slug is not persisted_only');
  assert.ok(!r.body.manifest.some((m: any) => m.uid === 'd'.repeat(32) || m.uid === 'e'.repeat(32)), 'no company row in the manifest');
});

test('a plain admin is refused; only the Super Admin reads it', async () => {
  const w = await arranged();
  const before = audits(w);
  const admin = await get(w, ADMIN);
  assert.equal(admin.status, 403, admin.text);
  assert.ok(!admin.body?.skills, 'nothing of the report');
  assert.equal(audits(w), before, 'a refusal is not audited as a read');
  assert.equal((await get(w, SUPER)).status, 200);
});

test('it writes nothing but its audit row', async () => {
  const w = await arranged();
  const before = counts(w);
  const auditBefore = audits(w);
  const r = await get(w, SUPER);
  assert.equal(r.status, 200, r.text);
  assert.deepEqual(counts(w), before, 'no store row added, changed in number or removed');
  assert.equal(audits(w), auditBefore + 1, 'one audit row');
  const row = w.db.prepare("SELECT details, user_id FROM activity_logs WHERE action = 'agent_skill_library_reconciled'").get() as any;
  assert.equal(row.user_id, SUPER);
  assert.deepEqual(JSON.parse(row.details).totals, r.body.totals, 'the audit holds the totals');
});

test('the answer carries no draft text, no case input and no person', async () => {
  const w = await arranged();
  const r = await get(w, SUPER);
  assert.equal(r.status, 200, r.text);
  for (const s of [SECRET_STEP, SECRET_INPUT, 'Kestrel', 'super@example.test', 'admin@example.test', 'Sue Super', 'Ada Admin', 'u-super-5335', 'u-admin-5335']) {
    assert.ok(!r.text.includes(s), `the answer must not carry ${s}`);
  }
  // Nor any library step or case record text: only hashes and identities.
  const seededStep = (readLibrarySkill(SEEDED[0].skill_md) as any).steps[0] as string;
  assert.ok(!r.text.includes(seededStep), 'no draft step');
  assert.ok(!r.text.includes(JSON.stringify(SEEDED[0].cases[0].input.records).slice(0, 40)), 'no case record');
  assert.deepEqual(Object.keys(r.body).sort(), ['manifest', 'read_at', 'report_version', 'scope', 'skills', 'totals']);
  for (const l of r.body.skills) assert.deepEqual(Object.keys(l).sort(), ['class', 'disposition', 'persisted_hash', 'published_version', 'slug', 'source_hash']);
  for (const m of r.body.manifest) {
    assert.deepEqual(Object.keys(m).sort(), ['cases', 'current_version', 'draft_hash', 'slug', 'status', 'uid']);
    for (const k of m.cases) assert.deepEqual(Object.keys(k).sort(), ['case_id', 'key', 'revision', 'sha256']);
  }
});

test('the Worker\'s source manifest equals the CI gate\'s on the committed library', async () => {
  const { manifest } = await checkSourceCatalogue({ ...readSources(), generated: SKILL_LIBRARY, generatedSound: true, taxonomy: TAXONOMY });
  assert.deepEqual(await libraryManifest(new Set(TAXONOMY.keys()), SKILL_LIBRARY), manifest);
});

test('check-skill-library --persisted reads the route\'s JSON as its manifest', async () => {
  const w = world();
  await seedLibrary(w.env, SUPER, 'Seed a local fixture for the reconcile route test.', SEEDED);
  w.db.prepare("UPDATE agent_skills SET steps_json = ? WHERE scope = 'hq' AND slug = ?").run(JSON.stringify([SECRET_STEP]), CONTENT);
  const r = await get(w, SUPER);
  assert.equal(r.status, 200, r.text);
  assert.equal(persistedFromJson(r.body).length, r.body.manifest.length);
  const dir = mkdtempSync(join(tmpdir(), 'skill-5335-'));
  const file = join(dir, 'reconcile.json');
  const out = join(dir, 'summary.json');
  writeFileSync(file, r.text);
  const run = (persisted: string) => spawnSync(process.execPath, ['--experimental-strip-types', '--no-warnings', '--import', './cloudflare-worker/test/_ts-loader.mjs',
    'scripts/check-skill-library.mjs', '--persisted', persisted, '--json', out], { encoding: 'utf8' });
  const ok = run(file);
  assert.equal(ok.status, 0, ok.stderr || ok.stdout);
  const s = JSON.parse(readFileSync(out, 'utf8'));
  const nonzero = Object.fromEntries(Object.entries(r.body.totals).filter(([, n]) => n));
  assert.deepEqual(s.reconciliation.classes, nonzero, 'the command reaches the route\'s totals from the route\'s manifest');
  assert.match(ok.stdout, new RegExp(`${CONTENT}: content_drift \\(report\\)`));
  // Anything else is refused, never read as an empty store.
  const bad = join(dir, 'bad.json');
  writeFileSync(bad, JSON.stringify({ totals: r.body.totals }));
  const refused = run(bad);
  assert.equal(refused.status, 1, refused.stdout);
  assert.match(refused.stderr, /no "manifest" array/);
});
