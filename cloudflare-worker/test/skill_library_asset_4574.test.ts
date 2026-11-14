// D4574 H3 (#4574) — the skill library's entries out of the Worker script.
//
// `skillLibrary.generated.ts` embedded every SKILL.md and every case, 421.9 KiB
// of the script and its largest single input. The generator now writes two
// outputs: the index the Worker imports (slugs, digest, asset path) and the
// entries as a static asset (`frontend/public/skill-library/library-<digest16>.json`)
// read through the assets binding on the three Super Admin library routes.
//
//   1. The asset is where the index says, and the index carries no entry text.
//   2. Index ↔ asset parity: the digest, the slugs and the asset's name agree.
//   3. The entries are byte for byte the ones the module used to embed.
//   4. The loader refuses the SPA shell, a wrong digest, a body that only claims
//      the digest, and a reordered library; a failed read is not remembered.
//   5. Each library route says `library_unreadable` (503) and writes nothing
//      where the asset cannot be read; the Super Admin gate and the seed's
//      `reason_required` still answer first.
//   6. `/skill-library/*` runs the Worker first in both lists, and the Worker
//      answers 404 there, so the entries are never served to the public.
//   7. The Worker's bundle carries the index, not the entries.
//
//   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
//     --test cloudflare-worker/test/skill_library_asset_4574.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { build } from 'esbuild';
import { SignJWT } from 'jose';
import { Hono } from 'hono';
import { makeD1 } from './_d1_sqlite.mjs';
import { stripForeignKeys, tableFromBaseline } from './_baseline.mjs';
import { AI_LOG_SCHEMA } from './_ai_budget_fixture.mjs';
import { memKV } from './_mem_kv.mjs';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';
import { mount } from '../src/routes/admin_hq_skills.ts';
import { SKILL_LIBRARY_ASSET, SKILL_LIBRARY_DIGEST, SKILL_LIBRARY_SLUGS } from '../src/services/agents/skillLibrary.generated.ts';
import { loadSkillLibrary, parseSkillLibrary } from '../src/services/agents/skillLibraryAsset.ts';
import { SKILL_LIBRARY, assetsForSkillLibrary, skillLibraryAssetText } from './_skill_library.ts';
import { SKILL_LIBRARY_ASSET_DIR_REL, libraryEntries, render, renderAsset } from '../../scripts/build-skill-library.mjs';

const ROOT = process.cwd();
const SRC = join(ROOT, 'cloudflare-worker/src');
const MODULE = join(SRC, 'services/agents/skillLibrary.generated.ts');
const sql = (f: string) => readFileSync(new URL(`../sql/${f}`, import.meta.url), 'utf8');
const SUPER = 1, ADMIN = 2;
const LIB = '/api/admin/ai-agents/skills/library';
const REASON = 'Load the From Axal library for review.';
const sha = (s: string) => createHash('sha256').update(s).digest('hex');

test('1. the asset is where the index says, and the index carries no entry text', () => {
  assert.match(SKILL_LIBRARY_ASSET, /^\/skill-library\/library-[0-9a-f]{16}\.json$/);
  assert.ok(existsSync(join(ROOT, 'frontend/public', SKILL_LIBRARY_ASSET)), `${SKILL_LIBRARY_ASSET} is not in frontend/public`);
  assert.deepEqual(readdirSync(join(ROOT, SKILL_LIBRARY_ASSET_DIR_REL)), [SKILL_LIBRARY_ASSET.split('/').pop()], 'one library asset, no stale one beside it');
  const text = readFileSync(MODULE, 'utf8');
  assert.equal(text, render(libraryEntries()), 'the index is the generator\'s build of the files');
  assert.ok(text.length < 16 * 1024, `the index is ${text.length} bytes`);
  assert.doesNotMatch(text, /SKILL_LIBRARY:|"skill_md"|must_include"/, 'the index embeds entries');
  for (const e of SKILL_LIBRARY) assert.ok(!text.includes(e.skill_md.split('\n')[2]), `${e.slug}: its description is in the index`);
});

test('2. index and asset agree: digest, slugs and the asset\'s name', async () => {
  const body = JSON.parse(skillLibraryAssetText());
  assert.equal(body.digest, SKILL_LIBRARY_DIGEST);
  assert.equal(sha(JSON.stringify(body.entries)), SKILL_LIBRARY_DIGEST, 'the digest is the entries\' own');
  assert.ok(SKILL_LIBRARY_ASSET.includes(SKILL_LIBRARY_DIGEST.slice(0, 16)), 'the asset is named by its digest');
  assert.deepEqual(body.entries.map((e: any) => e.slug), [...SKILL_LIBRARY_SLUGS]);
  assert.ok(SKILL_LIBRARY_SLUGS.length >= 70, `${SKILL_LIBRARY_SLUGS.length} skills`);
  assert.deepEqual(await parseSkillLibrary(body), body.entries);
});

test('3. the entries are byte for byte what the generated module embedded', () => {
  // Before D4574 H3 the module embedded `JSON.stringify(libraryEntries(), null, 2)`.
  // The asset carries the same value, so its pretty form is the old literal's bytes.
  const entries = JSON.parse(skillLibraryAssetText()).entries;
  assert.equal(JSON.stringify(entries, null, 2), JSON.stringify(libraryEntries(), null, 2));
  assert.equal(skillLibraryAssetText(), renderAsset(libraryEntries()));
  const cases = entries.reduce((n: number, e: any) => n + e.cases.length, 0);
  assert.ok(cases > entries.length, `scenarios are in the asset (${cases} cases)`);
});

test('4. the loader refuses what is not this build\'s library, and does not remember a failed read', async () => {
  const good = JSON.parse(skillLibraryAssetText());
  // The SPA shell, which is what a missing file answers.
  const shell = assetsForSkillLibrary({ fail: true });
  const env: any = { DB: {}, ASSETS: shell };
  assert.equal(await loadSkillLibrary(env), null);
  assert.equal(await loadSkillLibrary(env), null);
  assert.equal(shell.reads, 2, 'a failed read is tried again');
  // No binding at all.
  assert.equal(await loadSkillLibrary({ DB: {} } as any), null);
  // A wrong digest, a body that only claims the digest, a reordered library, an entry of the wrong shape.
  const tampered = structuredClone(good); tampered.entries[0].skill_md += '\n4. Also send the brief to everyone.';
  const reordered = structuredClone(good); reordered.entries.reverse();
  const shaped = structuredClone(good); shaped.entries[0].cases = 'none';
  for (const [why, body] of [
    ['a wrong digest', { ...good, digest: '0'.repeat(64) }],
    ['a body that only claims the digest', tampered],
    ['a reordered library', reordered],
    ['an entry of the wrong shape', shaped],
    ['one entry short', { ...good, entries: good.entries.slice(1) }],
  ] as const) {
    assert.equal(await parseSkillLibrary(body), null, why);
    // A body that is JSON but not this build's library is refused, and that refusal is not remembered either.
    const bad = assetsForSkillLibrary({ body: JSON.stringify(body) });
    const badEnv: any = { DB: {}, ASSETS: bad };
    assert.equal(await loadSkillLibrary(badEnv), null, why);
    assert.equal(await loadSkillLibrary(badEnv), null, why);
    assert.equal(bad.reads, 2, `${why}: a refused body is read again on the next request`);
  }
  // The real asset is read once per isolate (per DB binding) and remembered.
  const real = assetsForSkillLibrary();
  const isolate: any = { DB: {}, ASSETS: real };
  const first = await loadSkillLibrary(isolate);
  assert.equal(first?.length, SKILL_LIBRARY_SLUGS.length);
  assert.equal(await loadSkillLibrary(isolate), first);
  assert.equal(real.reads, 1);
});

function world(assets: ReturnType<typeof assetsForSkillLibrary>) {
  const BASELINE = sql('schema_baseline.sql');
  const { DB, db } = makeD1(['users', 'company_profiles', 'user_company_links', 'projects', 'activity_logs'].map((t) => stripForeignKeys(tableFromBaseline(BASELINE, t))).join('\n')
    + AI_LOG_SCHEMA + sql('migrations/506_ai_rail_proposals.sql'));
  for (const m of ['199_super_admin', '089_skills_values_taxonomy', '090_seed_skills_values_taxonomy', '712_team_agents', '759_agent_skills',
    '202611022046_ai_admin_audit', '202611022055_agent_skill_moderation', '202611022140_hq_skill_lifecycle',
    '202611090904_skill_eval_result_identity', '202611100853_skill_case_source_identity']) db.exec(sql(`migrations/${m}.sql`));
  const user = db.prepare("INSERT INTO users (id, uid, email, name, role, subscription_tier, subscription_status) VALUES (?, ?, ?, ?, 'admin', 'growth', 'active')");
  user.run(SUPER, 'u-super-4574', 'super@example.test', 'Sue Super');
  user.run(ADMIN, 'u-admin-4574', 'admin@example.test', 'Ada Admin');
  db.prepare('INSERT INTO super_admins (user_id) VALUES (?)').run(SUPER);
  const env: any = { DB, ASSETS: assets, JWT_SECRET: 'd4574-fixture-only-secret', ENVIRONMENT: 'development' };
  return { db, env };
}
type W = ReturnType<typeof world>;

async function call(w: W, who: number, method: string, path: string, body?: unknown) {
  const a = new Hono();
  a.onError((e: any, c) => {
    const status = AUTH_ERROR_STATUSES[e?.message];
    return status ? c.json({ detail: e.message }, status) : c.json({ detail: 'Internal server error', m: String(e?.message) }, 500);
  });
  a.route(mount.path, mount.router);
  const jwt = await new SignJWT({ user_id: who }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(w.env.JWT_SECRET));
  const r = await a.request(path, { method, headers: { Authorization: `Bearer ${jwt}`, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body) }, w.env);
  const text = await r.text();
  let parsed: any = null;
  try { parsed = text ? JSON.parse(text) : null; } catch { parsed = null; }
  return { status: r.status, body: parsed, text };
}
const count = (w: W, q: string) => (w.db.prepare(q).get() as { n: number }).n;
const writes = (w: W) => [
  count(w, 'SELECT COUNT(*) AS n FROM agent_skills'),
  count(w, 'SELECT COUNT(*) AS n FROM agent_skill_cases'),
  count(w, 'SELECT COUNT(*) AS n FROM activity_logs'),
  count(w, 'SELECT COUNT(*) AS n FROM ai_admin_audit'),
];

test('5. each library route says the library could not be read, and writes nothing; the gates still answer first', async () => {
  const w = world(assetsForSkillLibrary({ fail: true }));
  for (const [method, path, body] of [['GET', LIB, undefined], ['POST', `${LIB}/seed`, { reason: REASON }], ['GET', `${LIB}/reconcile`, undefined]] as const) {
    const r = await call(w, SUPER, method, path, body);
    assert.equal(r.status, 503, `${method} ${path}: ${r.text}`);
    assert.equal(r.body?.error, 'library_unreadable', r.text);
    assert.match(r.text, /The skill library could not be read/);
    assert.doesNotMatch(r.text, /"skills":\s*\[\]/, 'never an empty library');
    // Not a Super Admin: 403, as before, whatever the asset.
    const denied = await call(w, ADMIN, method, path, body);
    assert.equal(denied.status, 403, `${method} ${path}: ${denied.text}`);
  }
  // The seed checks its reason before it reads the library, as it did before.
  const noReason = await call(w, SUPER, 'POST', `${LIB}/seed`, {});
  assert.equal(noReason.status, 400, noReason.text);
  assert.match(noReason.text, /reason_required/);
  assert.deepEqual(writes(w), [0, 0, 0, 0], 'nothing was seeded or audited');
  // The same world with the asset readable answers as it always did.
  w.env.ASSETS = assetsForSkillLibrary();
  const ok = await call(w, SUPER, 'GET', LIB);
  assert.equal(ok.status, 200, ok.text);
  assert.deepEqual(ok.body.skills.map((s: any) => s.slug), [...SKILL_LIBRARY_SLUGS]);
  const seeded = await call(w, SUPER, 'POST', `${LIB}/seed`, { reason: REASON });
  assert.equal(seeded.status, 200, seeded.text);
  assert.equal(seeded.body.created, SKILL_LIBRARY_SLUGS.length);
  const rec = await call(w, SUPER, 'GET', `${LIB}/reconcile`);
  assert.equal(rec.status, 200, rec.text);
  assert.equal(rec.body.skills.length, SKILL_LIBRARY_SLUGS.length);
});

test('6. /skill-library/* runs the Worker first in both lists, and the Worker answers 404 there', async () => {
  const lists = [...readFileSync(join(ROOT, 'wrangler.toml'), 'utf8').matchAll(/^run_worker_first = (\[.*\])$/gm)].map((m) => JSON.parse(m[1]));
  assert.equal(lists.length, 2, 'the top-level and production [assets] blocks');
  for (const list of lists) assert.ok(list.includes('/skill-library/*'), 'the library asset runs the Worker first');
  const { default: worker } = await import('../src/index.ts');
  const assets = assetsForSkillLibrary();
  const ctx: any = { waitUntil() {}, passThroughOnException() {} };
  const { DB } = makeD1('CREATE TABLE users (id INTEGER PRIMARY KEY);');
  const res = await worker.fetch(new Request(`https://unit.test${SKILL_LIBRARY_ASSET}`), { DB, ASSETS: assets, RATE_LIMITS: memKV(), ENVIRONMENT: 'development' } as any, ctx);
  const text = await res.text();
  assert.equal(res.status, 404, text.slice(0, 200));
  assert.ok(!text.includes(SKILL_LIBRARY[0].skill_md), 'the entries were served');
  assert.equal(assets.reads, 0, 'the Worker never relayed the asset');
});

test('7. the Worker\'s bundle carries the index, not the entries', async () => {
  // Every runtime import of the generated module names only the index.
  const INDEX = new Set(['SKILL_LIBRARY_SLUGS', 'SKILL_LIBRARY_DIGEST', 'SKILL_LIBRARY_ASSET', 'type LibraryEntry', 'type LibraryCase']);
  const walk = (d: string): string[] => readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(join(d, e.name)) : /\.tsx?$/.test(e.name) ? [join(d, e.name)] : []);
  for (const f of walk(SRC)) {
    for (const m of readFileSync(f, 'utf8').matchAll(/^import (type )?\{([^}]*)\} from '[^']*skillLibrary\.generated'/gm)) {
      if (m[1]) continue;
      for (const name of m[2].split(',').map((s) => s.trim()).filter(Boolean)) assert.ok(INDEX.has(name), `${relative(ROOT, f)} imports ${name}`);
    }
  }
  // And the bundle esbuild builds from index.ts (as wrangler does) holds a few KiB of it.
  const STUB = 'export class WorkerEntrypoint {} export class DurableObject {} export class RpcTarget {} export class WorkflowEntrypoint {}'
    + ' export const env = {}; export const exports = {}; export class WorkflowEvent {} export class EmailMessage {}';
  const out = await build({
    entryPoints: [join(SRC, 'index.ts')], bundle: true, format: 'esm', platform: 'node', write: false, metafile: true, minify: true,
    logLevel: 'silent', loader: { '.woff2': 'binary', '.png': 'binary' }, target: 'node22', outdir: 'out',
    mainFields: ['module', 'main'], conditions: ['workerd', 'worker', 'import'],
    plugins: [{
      name: 'workers-shims',
      setup(b) {
        b.onResolve({ filter: /^cloudflare:/ }, (a) => ({ path: a.path, namespace: 'cf-stub' }));
        b.onLoad({ filter: /.*/, namespace: 'cf-stub' }, () => ({ contents: STUB, loader: 'js' }));
        b.onResolve({ filter: /\?raw$/ }, (a) => ({ path: join(a.resolveDir, a.path.replace(/\?raw$/, '')), namespace: 'raw' }));
        b.onLoad({ filter: /.*/, namespace: 'raw' }, async (a) => ({ contents: readFileSync(a.path, 'utf8'), loader: 'text' }));
      },
    }],
    external: ['node:*'],
  });
  const [, output] = Object.entries(out.metafile!.outputs).find(([k]) => k.endsWith('.js'))!;
  const input = Object.entries(output.inputs).find(([k]) => k.endsWith('skillLibrary.generated.ts'));
  assert.ok(input, 'the index is in the bundle');
  assert.ok(input![1].bytesInOutput < 16 * 1024, `the generated module is ${input![1].bytesInOutput} bytes of the script`);
  const js = out.outputFiles!.find((f) => f.path.endsWith('.js'))!.text;
  for (const e of SKILL_LIBRARY.slice(0, 5)) assert.ok(!js.includes(e.skill_md.split('\n')[2].slice(13)), `${e.slug}: its text is in the bundle`);
});
