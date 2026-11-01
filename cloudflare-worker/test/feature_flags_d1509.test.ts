/**
 * D1509 (#3760, deck v2 A16) — The Grid's feature flags (migration 723,
 * `services/featureFlags.ts`, `/api/admin/feature-flags`), what each flag
 * does on the rail, the element-model replies, the run and the one-click
 * press, and the dry run (`scripts/deck-dry-run.mjs`) on the three sample
 * ventures.
 *
 * Synthetic data, the mounted Worker routes and the real migrated schema;
 * `env.AI` is a stub, `fetch` throws, and KV is an in-memory stub with a
 * clock the test moves.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/feature_flags_d1509.test.ts
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync, mkdtempSync, copyFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import deckElementModels from '../src/routes/deck_element_models.ts';
import deckNew from '../src/routes/deck_new.ts';
import ai from '../src/routes/ai.ts';
import adminFeatureFlags, { knownKeys } from '../src/routes/admin_feature_flags.ts';
import { __resetForTest } from '../src/services/aiRouter.ts';
import { isOffered, modelById } from '../src/services/ai/catalogue.ts';
import { choicesFor } from '../src/services/decks/elementModels.ts';
import { CACHE_KEY, NOT_SWITCHED_ON, flagsOf, keyShape, loadFlagRows, type FlagRow } from '../src/services/featureFlags.ts';
import { buildCards, standardOutline } from '../src/services/decks/newDeck.ts';
import { ensureProjectMembershipSchema } from '../src/services/projectAccess.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { withGuard, GUARD_MODEL } from './_guard_stub.mjs';
import { BASELINE_CUTOFF, migrationNumber } from '../../scripts/lib/migrationPlan.mjs';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';
import { conflictingRecords, fullRecords, sparseRecords, wordsFor } from './fixtures/pitchStoryFixtures.ts';

const LLAMA = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
const MISTRAL = '@cf/mistralai/mistral-small-3.1-24b-instruct';
const PAGE = 'Founder · Raise · Pitch deck';
const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8');
const row = (key: string, scope: FlagRow['scope'], scope_id: string, enabled: 0 | 1): FlagRow => ({ key, scope, scope_id, enabled });

// ─────────────────────────────────────────────────────────── the rules

test('the narrowest row wins (user, role, global); no row is on; the beta column answers beta keys, never a model', () => {
  // Mutations checked: the role row read before the user row, the beta column honoured for a model, the default off — each red.
  const rows = [
    row('model:x', 'global', '', 0), row('model:x', 'role', 'admin', 1), row('model:x', 'user', '5', 0),
    row('grid_generate', 'global', '', 0), row('grid_generate', 'role', 'admin', 1), row('element:body', 'global', '', 0),
  ];
  const founder = flagsOf(rows, { id: 2, role: 'founder' } as any);
  assert.equal(founder.on('model:x'), false);
  assert.equal(founder.gridGenerate, false);
  assert.deepEqual([...founder.modelsOff], ['x']);
  assert.equal(founder.on('model:y'), true, 'no row: on');
  const hq = flagsOf(rows, { id: 9, role: 'admin' } as any);
  assert.equal(hq.on('model:x'), true, 'HQ first');
  assert.equal(hq.gridGenerate, true);
  assert.equal(flagsOf(rows, { id: 5, role: 'admin' } as any).on('model:x'), false, 'a user row beats the role row');
  // The beta cohort: the column turns grid_generate and an element on, never a model.
  const beta = flagsOf(rows, { id: 2, role: 'founder' } as any, { grid_generate: true, 'element:body': true, 'model:x': true } as any);
  assert.equal(beta.gridGenerate, true);
  assert.equal(beta.elementOn('body'), true);
  assert.equal(beta.on('model:x'), false, 'a model switched off stays off for the cohort');
  assert.equal(flagsOf([], null).gridGenerate, true);
  assert.equal(keyShape('grid_generate'), 'grid'); assert.equal(keyShape('element:body'), 'element'); assert.equal(keyShape(`model:${LLAMA}`), 'model');
  assert.equal(keyShape('grid_v2_editor'), null, 'option (b): there is no editor flag');
  assert.ok(knownKeys().includes(`model:${LLAMA}`) && knownKeys().includes('element:body'));
});

test('a model switched off is not offered: `isOffered` reads MODELS_OFF, and a bare env offers it as before', () => {
  // Mutation checked: the MODELS_OFF line dropped from catalogue.isOffered → red here and in every route test below.
  const m = modelById(LLAMA)!;
  assert.equal(isOffered(m, {}), true);
  assert.equal(isOffered(m, { MODELS_OFF: new Set([LLAMA]) }), false);
});

// ─────────────────────────────────────────────────────────── the fixture

const root = new URL('../sql/', import.meta.url);
const baseline = readFileSync(new URL('schema_baseline.sql', root), 'utf8');
const migrations = readdirSync(new URL('migrations/', root)).filter((n) => /^\d+_.*\.sql$/.test(n) && migrationNumber(n) > BASELINE_CUTOFF).sort()
  .map((n) => readFileSync(new URL('migrations/' + n, root), 'utf8'));
const scratch = mkdtempSync(join(tmpdir(), 'feature-flags-d1509-'));
const seedPath = join(scratch, 'schema.sqlite');
const schema = new DatabaseSync(seedPath, { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
schema.exec(baseline); for (const sql of migrations) schema.exec(sql); schema.close();
after(() => rmSync(scratch, { recursive: true, force: true }));
let n = 0;
const JWT_SECRET = 'synthetic-d1509-only-not-a-real-credential'.repeat(2);

/** KV with expirationTtl, on a clock the test moves. */
function fakeKv() {
  let now = 0;
  const m = new Map<string, { v: string; until: number }>();
  return {
    tick: (s: number) => { now += s * 1000; },
    async get(k: string, type?: string) { const e = m.get(k); if (!e || e.until <= now) return null; return type === 'json' ? JSON.parse(e.v) : e.v; },
    async put(k: string, v: string, o?: { expirationTtl?: number }) { m.set(k, { v, until: now + (o?.expirationTtl ?? 1e9) * 1000 }); },
    async delete(k: string) { m.delete(k); },
    has: (k: string) => m.has(k),
  };
}

async function fixture() {
  __resetForTest();
  const file = join(scratch, `case-${++n}.sqlite`);
  copyFileSync(seedPath, file);
  const db = new DatabaseSync(file, { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  const insert = db.prepare('INSERT INTO users(id, role, founder_id, name, email, is_active, subscription_tier) VALUES (?, ?, ?, ?, ?, 1, ?)');
  for (const [id, role, fid, tier] of [[2, 'founder', 100, 'studio'], [9, 'admin', null, 'studio']] as const) {
    insert.run(id, role, fid, `Synthetic member ${id}`, `synthetic-${id}@example.invalid`, tier);
  }
  db.exec("INSERT INTO member_subscription_amounts(subscription_id,user_id,plan_family,amount_cents,currency,interval,interval_count,status) VALUES ('sub_synthetic_2',2,'founder',7900,'usd','month',1,'active')");
  db.exec("INSERT INTO projects(id,name,founder_id) VALUES (1,'Synthetic venture',100)");
  db.exec("INSERT INTO pitch_decks(id,project_id,version,slides,title,is_current) VALUES (7,1,1,'[]','Synthetic deck',1)");
  db.prepare('INSERT INTO ai_topup_accounts(user_id,balance_microusd) VALUES(2,5000000)').run();
  for (const key of ['founder:free', 'founder:studio']) db.prepare('INSERT OR IGNORE INTO ai_licence_caps(licence_key,daily_microusd,monthly_microusd,recorded_by) VALUES(?,0,0,1)').run(key);
  const calls: string[] = [];
  const AI = withGuard({
    run: async (model: string) => { calls.push(model); return { response: JSON.stringify({ cards: [] }), usage: { prompt_tokens: 60, completion_tokens: 40 } }; },
  });
  const kv = fakeKv();
  const env: any = { DB: d1Over(db), JWT_SECRET, ENVIRONMENT: 'development', AI, FILES: {}, TOKENS: kv };
  await ensureProjectMembershipSchema(env);
  const app = new Hono<any>().route('/api/decks', deckElementModels).route('/api/decks', deckNew).route('/api/ai', ai).route('/api/admin/feature-flags', adminFeatureFlags);
  app.onError((err, c) => c.json({ detail: err.message }, (AUTH_ERROR_STATUSES[err.message] || 500) as any));
  const real = globalThis.fetch;
  globalThis.fetch = (async () => { throw new Error('no network in this test'); }) as any;
  const close = () => { globalThis.fetch = real; db.close(); };
  const flag = (key: string, scope: string, scopeId: string, enabled: 0 | 1) =>
    db.prepare('INSERT OR REPLACE INTO feature_flags(key, scope, scope_id, enabled) VALUES (?, ?, ?, ?)').run(key, scope, scopeId, enabled);
  return { db, env, kv, app, flag, calls: () => calls.filter((m) => m !== GUARD_MODEL), close };
}
type F = Awaited<ReturnType<typeof fixture>>;

async function call(f: F, who: number, method: string, path: string, json?: unknown) {
  const jwt = await new SignJWT({ user_id: who }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const res = await f.app.request(path, { method, headers: { Authorization: `Bearer ${jwt}`, 'content-type': 'application/json' }, ...(json === undefined ? {} : { body: JSON.stringify(json) }) }, f.env);
  const text = await res.text();
  let body: any; try { body = JSON.parse(text); } catch { body = text; }
  return { status: res.status, body };
}
const URL7 = '/api/decks/7/element-models';
const RAIL = `/api/ai/rail?page=${encodeURIComponent(PAGE)}&option=${encodeURIComponent('deck:rewrite')}`;
const modelsIn = (body: any): string[] => [
  ...(body.elements || []).flatMap((e: any) => [...e.suggested, ...e.more].map((m: any) => m.id).concat(e.resolved?.model ? [e.resolved.model] : [])),
  ...(body.groups || []).flatMap((g: any) => [...(g.suggested || []), ...(g.more || [])].map((m: any) => m.id).concat(g.resolved?.model ? [g.resolved.model] : [])),
];
const railModels = (body: any): string[] => [...body.models, ...body.more, ...body.options.flatMap((o: any) => [...o.models, ...o.more])].map((m: any) => m.id);

test('migration 723: feature_flags keyed by key, scope and scope id, `enabled` 0 or 1, scopes global, role, user', () => {
  const sql = read('../sql/migrations/723_feature_flags.sql');
  assert.match(sql, /CREATE TABLE IF NOT EXISTS feature_flags/);
  assert.match(sql, /PRIMARY KEY \(key, scope, scope_id\)/);
  assert.match(sql, /CHECK \(scope IN \('global', 'role', 'user'\)\)/);
  assert.match(sql, /enabled INTEGER NOT NULL CHECK \(enabled IN \(0, 1\)\)/);
  assert.ok(!/BEGIN|COMMIT/.test(sql.replace(/^--.*$/gm, '')));
});

// ─────────────────────────────────────────────────────────── a model flag

test('turning off one model\'s flag removes it from every chip within 60 s: the rail, every element and group, and the run', async () => {
  // Mutations checked: the rail not filtering `models`/`more`, the element reply not filtering choices, the run ignoring
  // MODELS_OFF, the cache never expiring — each red.
  const f = await fixture();
  try {
    const r0 = await call(f, 2, 'GET', RAIL);
    assert.equal(r0.status, 200, JSON.stringify(r0.body));
    assert.ok(railModels(r0.body).includes(LLAMA), 'on by default');
    assert.ok(modelsIn((await call(f, 2, 'GET', URL7)).body).includes(LLAMA));
    assert.ok(f.kv.has(CACHE_KEY), 'the rows are cached');
    // HQ switches it off straight in D1: the cached rows still answer until they expire.
    f.flag(`model:${LLAMA}`, 'global', '', 0);
    assert.ok(railModels((await call(f, 2, 'GET', RAIL)).body).includes(LLAMA), 'within the 60 s the cache still answers');
    f.kv.tick(61);
    const r1 = await call(f, 2, 'GET', RAIL);
    assert.equal(railModels(r1.body).includes(LLAMA), false, 'gone from the rail');
    const e1 = await call(f, 2, 'GET', URL7);
    assert.equal(modelsIn(e1.body).includes(LLAMA), false, 'gone from every element, group and resolved chip');
    assert.equal(e1.body.elements.find((e: any) => e.element === 'body').resolved.source, 'default', 'Body falls to its next model');
    // The run never calls it.
    const built = await call(f, 2, 'POST', '/api/decks/generate', { project_id: 1 });
    assert.equal(built.status, 201, JSON.stringify(built.body));
    assert.ok(f.calls().length >= 1);
    assert.equal(f.calls().includes(LLAMA), false, `ran on ${f.calls().join(', ')}`);
    // HQ, for whom a role row keeps it on, still sees it.
    f.flag(`model:${LLAMA}`, 'role', 'admin', 1);
    f.kv.tick(61);
    assert.ok(railModels((await call(f, 9, 'GET', RAIL)).body).includes(LLAMA));
  } finally { f.close(); }
});

test('a pick of a switched-off model is kept, never cleared, and reads "<C> is unavailable. Using <B>." until it is back', async () => {
  // Mutation checked: the switched-off pick treated as stale (cleared) → the row-count assert fails.
  const f = await fixture();
  try {
    assert.equal((await call(f, 2, 'PUT', URL7, { scope: 'deck', key: 'body', model: MISTRAL })).status, 200);
    assert.equal((await call(f, 2, 'PUT', '/api/ai/rail/pick', { page: PAGE, option: 'deck:rewrite', model: MISTRAL })).status, 200);
    assert.equal((await call(f, 9, 'PUT', '/api/admin/feature-flags', { key: `model:${MISTRAL}`, scope: 'global', enabled: false })).status, 200);
    const e = await call(f, 2, 'GET', URL7);
    const body = e.body.elements.find((x: any) => x.element === 'body');
    assert.notEqual(body.resolved.model, MISTRAL);
    assert.match(body.resolved.notice, /^.+ is unavailable\. Using .+\.$/);
    const rail = await call(f, 2, 'GET', RAIL);
    assert.equal(rail.body.options.find((o: any) => o.key === 'deck:rewrite')?.pick ?? rail.body.pick, null);
    assert.match(rail.body.notice, /is unavailable\. Using /);
    assert.equal((f.db.prepare("SELECT COUNT(*) AS n FROM deck_model_picks WHERE model = ?").get(MISTRAL) as any).n, 1, 'the deck pick is kept');
    assert.equal((f.db.prepare("SELECT COUNT(*) AS n FROM ai_rail_preferences WHERE model = ?").get(MISTRAL) as any).n, 1, 'the rail pick is kept');
    // It cannot be picked while off, on either route.
    assert.equal((await call(f, 2, 'PUT', URL7, { scope: 'member', key: 'body', model: MISTRAL })).body.error, 'model_not_offered');
    assert.equal((await call(f, 2, 'PUT', '/api/ai/rail/pick', { page: PAGE, model: MISTRAL })).status, 400);
    // Back on: the pick runs again, nothing to redo.
    assert.equal((await call(f, 9, 'PUT', '/api/admin/feature-flags', { key: `model:${MISTRAL}`, scope: 'global', enabled: null })).status, 200);
    assert.equal((await call(f, 2, 'GET', URL7)).body.elements.find((x: any) => x.element === 'body').resolved.model, MISTRAL);
  } finally { f.close(); }
});

// ─────────────────────────────────────────────────────────── an element flag

test('an element switched off reads "Not switched on yet.", leaves its group, cannot be picked, and is cut from the build before the quote', async () => {
  // Mutations checked: the element still resolved, the quote still holding for Body, the build still running the words — each red.
  const f = await fixture();
  try {
    assert.equal((await call(f, 9, 'PUT', '/api/admin/feature-flags', { key: 'element:body', scope: 'global', enabled: false })).status, 200);
    const e = await call(f, 2, 'GET', URL7);
    const body = e.body.elements.find((x: any) => x.element === 'body');
    assert.deepEqual([body.switched_on, body.reason, body.resolved, body.suggested], [false, NOT_SWITCHED_ON, null, []]);
    assert.equal(e.body.groups.find((g: any) => g.group === 'text').elements.includes('body'), false);
    const put = await call(f, 2, 'PUT', URL7, { scope: 'deck', key: 'body', model: MISTRAL });
    assert.equal(put.status, 404); assert.equal(put.body.error, 'not_switched_on'); assert.equal(put.body.message, NOT_SWITCHED_ON);
    const quote = await call(f, 2, 'POST', '/api/decks/new/quote', { project_id: 1, step: 'build', audience: 'seed_fund' });
    assert.deepEqual([quote.status, quote.body.ai, quote.body.reason, quote.body.message], [200, false, 'not_switched_on', NOT_SWITCHED_ON]);
    const built = await call(f, 2, 'POST', '/api/decks/generate', { project_id: 1 });
    assert.equal(built.status, 201, JSON.stringify(built.body));
    assert.deepEqual(f.calls(), [], 'no words run, nothing held');
    assert.match(built.body.wording.reason, /not switched on yet/);
    assert.equal(built.body.cost.charged_microusd, 0);
    assert.ok(built.body.proposal.slides.length > 0 && built.body.proposal.slides.every((s: any) => String(s.title || '').length > 0), 'every card keeps its title: no empty area');
  } finally { f.close(); }
});

// ─────────────────────────────────────────────────────────── grid_generate

test('grid_generate off stops the one press (404 not_switched_on) and says so in the context; HQ and the beta cohort still run it', async () => {
  // Mutation checked: oneClickRefusal ignoring the flag → the 404 asserts fail.
  const f = await fixture();
  try {
    assert.equal((await call(f, 2, 'GET', '/api/decks/new/context?project_id=1')).body.grid_generate, true, 'on by default');
    f.flag('grid_generate', 'global', '', 0);
    f.flag('grid_generate', 'role', 'admin', 1);
    await f.kv.delete(CACHE_KEY);
    assert.equal((await call(f, 2, 'GET', '/api/decks/new/context?project_id=1')).body.grid_generate, false);
    for (const [path, body] of [['/api/decks/new/quote', { project_id: 1, step: 'build', audience: 'seed_fund', one_click: true }], ['/api/decks/generate', { project_id: 1, one_click: true }]] as const) {
      const r = await call(f, 2, 'POST', path, body);
      assert.deepEqual([r.status, r.body.error, r.body.message], [404, 'not_switched_on', NOT_SWITCHED_ON], path);
    }
    assert.deepEqual(f.calls(), [], 'refused before anything ran');
    assert.equal((await call(f, 2, 'POST', '/api/decks/generate', { project_id: 1 })).status, 201, 'New deck\'s own build is not the one press');
    // The beta cohort's column (HQ-set) turns it on for one member.
    f.db.prepare("INSERT OR REPLACE INTO user_settings(user_id, feature_flags) VALUES (2, ?)").run(JSON.stringify({ grid_generate: true }));
    assert.equal((await call(f, 2, 'GET', '/api/decks/new/context?project_id=1')).body.grid_generate, true);
    assert.equal((await call(f, 2, 'POST', '/api/decks/generate', { project_id: 1, one_click: true })).status, 201);
  } finally { f.close(); }
});

// ─────────────────────────────────────────────────────────── the admin route

test('only an admin writes a flag; an unknown key, scope or value is refused with nothing written; a write is seen at once', async () => {
  const f = await fixture();
  try {
    assert.equal((await call(f, 2, 'PUT', '/api/admin/feature-flags', { key: 'grid_generate', scope: 'global', enabled: false })).status, 403);
    assert.equal((await call(f, 2, 'GET', '/api/admin/feature-flags')).status, 403);
    for (const [body, code] of [
      [{ key: 'grid_v2_editor', scope: 'global', enabled: false }, 'invalid_key'],
      [{ key: 'model:@cf/synthetic/none', scope: 'global', enabled: false }, 'invalid_key'],
      [{ key: 'grid_generate', scope: 'org', enabled: false }, 'invalid_scope'],
      [{ key: 'grid_generate', scope: 'user', scope_id: 'someone@example.invalid', enabled: false }, 'invalid_scope_id'],
      [{ key: 'grid_generate', scope: 'global', enabled: 'no' }, 'invalid_enabled'],
    ] as const) {
      const r = await call(f, 9, 'PUT', '/api/admin/feature-flags', body);
      assert.deepEqual([r.status, r.body.error], [400, code], JSON.stringify(body));
    }
    assert.equal((f.db.prepare('SELECT COUNT(*) AS n FROM feature_flags').get() as any).n, 0);
    await call(f, 2, 'GET', '/api/decks/new/context?project_id=1'); // primes the cache
    const w = await call(f, 9, 'PUT', '/api/admin/feature-flags', { key: 'grid_generate', scope: 'user', scope_id: 2, enabled: false });
    assert.deepEqual(w.body, { ok: true, key: 'grid_generate', scope: 'user', scope_id: '2', enabled: false });
    assert.equal((await call(f, 2, 'GET', '/api/decks/new/context?project_id=1')).body.grid_generate, false, 'the write dropped the cache');
    const list = await call(f, 9, 'GET', '/api/admin/feature-flags');
    assert.equal(list.body.flags.length, 1); assert.equal(list.body.flags[0].updated_by, 9); assert.equal(list.body.cache_s, 60);
  } finally { f.close(); }
});

test('an unmigrated table reads as no flag: every flag at its default, never a refusal, and nothing cached', async () => {
  const env: any = { DB: { prepare: () => ({ all: async () => { throw new Error('no such table: feature_flags'); }, bind() { return this; } }) }, TOKENS: fakeKv() };
  assert.deepEqual(await loadFlagRows(env), []);
  assert.equal(env.TOKENS.has(CACHE_KEY), false);
});

// ─────────────────────────────────────────────────────────── option (b)

test('option (b): no grid_v2_editor gate and no ?editor=v1 anywhere in the editor; the element routes name no model', () => {
  const walk = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? walk(join(dir, d.name)) : /\.(jsx?|ts)$/.test(d.name) ? [join(dir, d.name)] : []));
  const src = [...walk(new URL('../../frontend/src/', import.meta.url).pathname), ...walk(new URL('../src/', import.meta.url).pathname)];
  for (const file of src) {
    const text = readFileSync(file, 'utf8');
    assert.equal(/grid_v2_editor|editor=v1/.test(text), false, file);
  }
  assert.equal(/@cf\//.test(read('../src/services/featureFlags.ts')), false, 'no model list beside the catalogue');
  assert.equal(choicesFor('body').suggested[0].id, LLAMA, 'the catalogue default this file tests against');
});

// ─────────────────────────────────────────────────────────── the dry run

const q = (v: unknown) => (v == null ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`);
function dumpOf(decks: Array<{ id: number; slides: unknown[] }>): string {
  return [
    'CREATE TABLE pitch_decks (id INTEGER PRIMARY KEY, project_id INTEGER, version INTEGER, slides TEXT, title TEXT, is_current INTEGER, theme_json TEXT);',
    ...decks.map((d) => `INSERT INTO pitch_decks VALUES (${d.id}, ${d.id}, 1, ${q(JSON.stringify(d.slides))}, 'Synthetic deck', 1, NULL);`),
  ].join('\n');
}

test('the dry run lists zero unexplained differences on the three sample ventures, keeps no copy, and names no word of a deck', async () => {
  // Mutation checked: the conversion dropping a field (a paragraph left out of fieldBlocks) → words_lost on every venture.
  const { dryRun } = await import('../../scripts/deck-dry-run.mjs');
  const ventures = { full: fullRecords(), sparse: sparseRecords(), conflicting: conflictingRecords() } as Record<string, any>;
  const decks = Object.values(ventures).map((rec, i) => {
    const rows = standardOutline('standard', 'seed_fund');
    const { slides, problems } = buildCards(rows, rec.items, wordsFor(rows), 'Synthetic venture', new Set(), { series: rec.series, diagrams: rec.diagrams, rows: rec.rows });
    assert.deepEqual(problems, []);
    return { id: i + 1, slides };
  });
  // A legacy deck saved with fields, as the editor's first version stored them.
  decks.push({ id: 9, slides: [{ title: 'Synthetic problem', fields: [{ kind: 'text', key: 'p', value: 'Synthetic founders lose weeks' }, { kind: 'bullets', key: 'b', value: ['One synthetic', 'Two synthetic'] }, { kind: 'text', key: 'm', label: 'Market', source: 'placeholder' }] }] });
  const before = readdirSync(tmpdir()).length;
  const report = await dryRun(dumpOf(decks));
  assert.equal(report.decks, 4);
  assert.ok(report.cards > 20, `${report.cards} cards`);
  assert.deepEqual(report.unexplained, [], JSON.stringify(report.unexplained));
  assert.ok(report.explained.converted >= 1 && report.explained.placeholder >= 1, JSON.stringify(report.explained));
  assert.equal(readdirSync(tmpdir()).length, before, 'no file written');
  assert.equal(/Synthetic|founders/.test(JSON.stringify(report)), false, 'the report holds ids, kinds and counts only');
  // An unexplained one is listed by deck, card and kind: a block over another.
  const bad = await dryRun(dumpOf([{ id: 5, slides: [{ title: 'x', blocks: [
    { id: 'a', kind: 'text', style: 'paragraph', text: 'Synthetic', grid: { c1: 1, c2: 6, r1: 1, r2: 3 } },
    { id: 'b', kind: 'text', style: 'paragraph', text: 'Synthetic', grid: { c1: 4, c2: 9, r1: 2, r2: 4 } },
  ] }] }]));
  assert.deepEqual(bad.unexplained.map((u: any) => [u.deck, u.card, u.kind]), [[5, 1, 'overlap'], [5, 1, 'overlap']]);
  assert.ok(existsSync(new URL('../../scripts/deck-dry-run.mjs', import.meta.url)));
});
