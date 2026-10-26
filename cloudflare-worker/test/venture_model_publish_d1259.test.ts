/**
 * D1259 (#3282, part 6 of #2428) — model versions and Publish, and the
 * country indices after the licence check.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/venture_model_publish_d1259.test.ts
 *
 * The full schema (the baseline and every migration), synthetic records only,
 * and a stubbed World Bank: no test reaches the network.
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import { d1Over } from './_d1_sqlite.mjs';
import { BASELINE_CUTOFF, compareMigrations, migrationNumber } from '../../scripts/lib/migrationPlan.mjs';
import { AUTH_ERROR_STATUSES, stepUpRefusalBody } from '../src/util/authErrors.ts';
import ventureScoreModels from '../src/routes/venture_score_models.ts';
import { SCORED_SCOPES, VENTURE_MODEL_V1, VENTURE_MODEL_V1_1, VENTURE_MODELS } from '../src/services/ventureScoring/model.ts';
import { INDEX_SOURCES, importList, importWgi, recordedSources } from '../src/services/ventureScoring/countryIndex.ts';
import { continuePublication, modelChanges } from '../src/services/ventureScoring/publish.ts';
import { STATEMENTS } from '../src/services/ventureScoring/collectors.ts';
import { liveModel, scoreVenture } from '../src/services/ventureScoring/store.ts';

const realFetch = globalThis.fetch;
globalThis.fetch = async () => { throw new Error('Network disabled in D1259 fixtures'); };
after(() => { globalThis.fetch = realFetch; });

const SECRET = 'synthetic-d1259-only-'.repeat(3);
const TODAY = '2026-10-26';
const HOLDER = 901, PLAIN = 902;
const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8');

const ddl = (() => {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  db.exec(read('../sql/schema_baseline.sql'));
  for (const name of readdirSync(new URL('../sql/migrations/', import.meta.url)).filter((n) => /^\d+_.*\.sql$/.test(n)).sort(compareMigrations)) {
    if (migrationNumber(name) > BASELINE_CUTOFF) db.exec(read(`../sql/migrations/${name}`));
  }
  const sql = (db.prepare("SELECT sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 ELSE 2 END").all() as any[]).map((r) => r.sql).join(';\n');
  db.close();
  return sql;
})();

function fixture() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  db.exec(ddl);
  db.exec(`INSERT INTO users(id,email,name,role,founder_id,is_active) VALUES
      (1,'founder@example.test','Synthetic founder','founder',20,1),
      (${HOLDER},'holder@example.test','Synthetic holder','admin',NULL,1),
      (${PLAIN},'admin@example.test','Synthetic admin','admin',NULL,1);
    INSERT INTO super_admins(user_id) VALUES (${HOLDER});
    INSERT INTO user_sessions(user_id,jti,factor,created_at) VALUES
      (${HOLDER},'fresh','totp',datetime('now')),(${PLAIN},'plain','totp',datetime('now')),(1,'founder','totp',datetime('now')),(${HOLDER},'stale','totp',datetime('now','-2 days'));
    INSERT INTO projects(id,name,founder_id,status,stage,lifecycle_stage) VALUES
      (10,'Synthetic venture',20,'active','seed','build'),(20,'Empty venture',NULL,'active','idea','idea');
    INSERT INTO research_countries(code,name,region) VALUES ('DE','Germany','Europe'),('FR','France','Europe'),('IR','Iran','Middle East'),('US','United States','North America');
    INSERT INTO markets(uid,project_id,name,state,geography_ref) VALUES
      ('m1',10,'Synthetic market A','entering','DE'),('m2',10,'Synthetic market B','considering','IR'),
      ('m3',10,'Synthetic market C','served',NULL),('m4',10,'Synthetic market D','not_now','FR'),('m5',10,'Synthetic market E','served','US');`);
  const env = { DB: d1Over(db), JWT_SECRET: SECRET, SCORING_HMAC_SECRET: SECRET, ENVIRONMENT: 'development' } as any;
  const app = new Hono<any>();
  app.route('/api/venture-scores', ventureScoreModels);
  app.onError((err, c) => {
    const status = AUTH_ERROR_STATUSES[err.message];
    if (!status) throw err;
    return c.json(err.message === 'step_up_required' ? stepUpRefusalBody(err) : { detail: err.message }, status);
  });
  async function call(method: string, path: string, { id = HOLDER, jti = 'fresh', body }: { id?: number; jti?: string; body?: unknown } = {}) {
    const token = await new SignJWT({ user_id: id, jti }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
      .sign(new TextEncoder().encode(SECRET));
    const res = await app.request(`/api/venture-scores${path}`, {
      method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}),
    }, env);
    return { status: res.status, body: await res.json() as any };
  }
  return { db, env, call };
}
const count = (db: DatabaseSync, table: string, where = '1=1') => Number((db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${where}`).get() as any).n);

/** The World Bank, stubbed: each indicator's percentile ranks, an aggregate, an economy outside the directory and a missing figure. */
const RANKS: Record<string, Record<string, number>> = {
  'GE.PER.RNK': { DE: 90, FR: 80, IR: 10 }, 'RL.PER.RNK': { DE: 92, FR: 84, IR: 12 },
  'PV.PER.RNK': { DE: 70, FR: 60, IR: 5 }, 'RQ.PER.RNK': { DE: 88, FR: 82, IR: 8 },
};
function worldBank(seen: string[] = [], fail?: string): typeof fetch {
  return (async (url: string) => {
    seen.push(String(url));
    const indicator = /indicator\/([^?]+)/.exec(String(url))![1];
    const rows = [
      ...Object.entries(RANKS[indicator]).map(([id, value]) => ({ country: { id }, value })),
      { country: { id: '1W' }, value: 50 }, { country: { id: 'ZZ' }, value: 40 }, { country: { id: 'US' }, value: null },
    ];
    // A failing indicator answers 503 with a body that parses: a status that is not OK is never read as figures.
    return new Response(JSON.stringify([{ page: 1 }, rows]), { status: indicator === fail ? 503 : 200, headers: { 'Content-Type': 'application/json' } });
  }) as any;
}

// ── The model ────────────────────────────────────────────────────────────────

test('model v1.1 is v1 with the three country inputs given a store; nothing else moves', () => {
  assert.deepEqual(VENTURE_MODELS.map((m) => m.version), ['1.0', '1.1']);
  for (const scope of SCORED_SCOPES) assert.equal(VENTURE_MODEL_V1_1.scopes[scope].inputs.reduce((a, i) => a + i.weight, 0), 100, scope);
  const changes = modelChanges(VENTURE_MODEL_V1, VENTURE_MODEL_V1_1);
  assert.deepEqual(changes.map((c) => `${c.scope}:${c.input}`).sort(),
    ['geographic:Country environment', 'political:High-risk jurisdiction lists', 'political:Political stability and regulatory quality']);
  for (const c of changes) {
    assert.equal(c.from!.source, null, `${c.input}: v1 has no source`);
    assert.match(String(c.to!.source), /^country_index_values/);
    assert.equal(c.from!.weight, c.to!.weight, 'no weight changes');
  }
  assert.equal(VENTURE_MODEL_V1.scopes.geographic.inputs[1].source, null, 'v1 itself is never edited');
});

test('the licence check: FATF has no recorded licence; the WGI and the EU list do', () => {
  assert.equal(INDEX_SOURCES.fatf.licence, null);
  assert.equal(INDEX_SOURCES.wgi.licence, 'CC BY 4.0');
  assert.ok(INDEX_SOURCES.eu_high_risk.licence);
  assert.deepEqual(recordedSources(), ['wgi', 'eu_high_risk']);
  const doc = read('../../documentation/architecture/decisions/D1259.md');
  for (const s of Object.values(INDEX_SOURCES)) {
    assert.ok(doc.includes(s.licence ?? 'Not recorded'), `D1259 records ${s.key}'s licence as the registry has it`);
  }
});

test('every index statement is bound and reads no never-input', () => {
  const src = read('../src/services/ventureScoring/countryIndex.ts');
  for (const sql of Object.values(STATEMENTS.indices)) assert.doesNotMatch(sql, /kyc|nationality|residence|date_of_birth|email|\bname\b/);
  assert.doesNotMatch(src, /\$\{[^}]*\}[^`]*\b(FROM|WHERE|INTO)\b/, 'no interpolated SQL');
});

// ── The import ───────────────────────────────────────────────────────────────

test('a WGI edition stores each directory country\'s ranks with its licence, never an aggregate, a stranger or a missing figure', async () => {
  const { db, env } = fixture();
  const seen: string[] = [];
  const out = await importWgi(env, { edition: '2024', published_on: '2025-09-30' }, HOLDER, worldBank(seen));
  assert.deepEqual(out, { source: 'wgi', edition: '2024', published_on: '2025-09-30', value_count: 12, countries: 3 });
  assert.equal(seen.length, 4);
  assert.ok(seen.every((u) => u.startsWith('https://api.worldbank.org/v2/country/all/indicator/') && u.includes('date=2024')));
  assert.deepEqual(db.prepare("SELECT DISTINCT country FROM country_index_values ORDER BY country").all().map((r: any) => r.country), ['DE', 'FR', 'IR']);
  assert.equal(count(db, 'country_index_values', "licence = 'CC BY 4.0' AND as_of = '2025-09-30'"), 12);
  assert.equal(count(db, 'country_index_editions', "source = 'wgi' AND licence_decision = 'D1259' AND imported_by = 901"), 1);

  await assert.rejects(importWgi(env, { edition: '2024', published_on: '2025-09-30' }, HOLDER, worldBank()), { code: 'edition_imported', status: 409 });
  await assert.rejects(importWgi(env, { edition: '2023', published_on: '2024-09-30' }, HOLDER, worldBank([], 'RQ.PER.RNK')), { code: 'index_unreadable', status: 502 });
  assert.equal(count(db, 'country_index_editions', "edition = '2023'"), 0, 'one unreadable indicator writes nothing');
  await assert.rejects(importWgi(env, { edition: '24', published_on: '2025-09-30' }, HOLDER, worldBank()), { code: 'invalid_edition' });
  await assert.rejects(importWgi(env, { edition: '2022', published_on: '30/09/2025' }, HOLDER, worldBank()), { code: 'invalid_published_on' });
});

test('a list without a recorded licence is refused before anything is read or written; the EU list is stored as named', async () => {
  const { db, env } = fixture();
  await assert.rejects(importList(env, 'fatf', { edition: 'October 2026', published_on: '2026-10-24', countries: { call_for_action: ['IR'] } }, HOLDER),
    { code: 'licence_not_recorded', status: 409 });
  assert.equal(count(db, 'country_index_editions'), 0);
  const out = await importList(env, 'eu_high_risk', { edition: '2025-1', published_on: '2025-06-10', countries: { listed: ['ir', 'IR'] } }, HOLDER);
  assert.equal(out.value_count, 1, 'codes are upper-cased and de-duplicated');
  await assert.rejects(importList(env, 'eu_high_risk', { edition: '2025-2', published_on: '2025-07-10', countries: { listed: ['XX'] } }, HOLDER), { code: 'unknown_country' });
  await assert.rejects(importList(env, 'eu_high_risk', { edition: '2025-3', published_on: '2025-07-10', countries: { other: ['IR'] } }, HOLDER), { code: 'invalid_countries' });
  await assert.rejects(importList(env, 'wgi', { edition: '2025', published_on: '2025-07-10', countries: {} }, HOLDER), { code: 'not_a_list' });
});

// ── The reader, through the scorecard ────────────────────────────────────────

test('v1 never reads an index; v1.1 reads only editions under a recorded licence, per market country', async () => {
  const { db, env } = fixture();
  await importWgi(env, { edition: '2024', published_on: '2025-09-30' }, HOLDER, worldBank());
  await importList(env, 'eu_high_risk', { edition: '2025-1', published_on: '2025-06-10', countries: { listed: ['IR'] } }, HOLDER);
  // A FATF edition and an older WGI edition planted directly: neither licence is the one recorded now.
  db.exec(`INSERT INTO country_index_editions(source,edition,licence,licence_decision,published_on,citation_url,value_count,imported_by,imported_at)
      VALUES ('fatf','Oct 2026','planted','D1259','2026-10-24','https://example.test',1,901,'2026-10-24'),
             ('wgi','2099','an earlier licence','D1259','2099-01-01','https://example.test',2,901,'2099-01-01');
    INSERT INTO country_index_values(source,edition,licence,country,indicator,value,as_of) VALUES
      ('fatf','Oct 2026','planted','DE','call_for_action',100,'2026-10-24'),
      ('wgi','2099','an earlier licence','DE','GE.PER.RNK',1,'2099-01-01'),('wgi','2099','an earlier licence','DE','RL.PER.RNK',1,'2099-01-01');`);

  const v1 = await scoreVenture(env, 10, { actorId: 1, trigger: 'read', today: TODAY });
  assert.equal(v1.model, '1.0');
  const geo1 = (v1.scopes.find((s: any) => s.scope === 'geographic') as any).inputs.find((i: any) => i.key === 'country_environment');
  assert.equal(geo1.state, 'not_recorded', 'v1 holds the index with no source');

  db.exec(`INSERT INTO venture_model_publications(version,published_by,published_at,ventures_total) VALUES ('1.1',901,'2026-10-26T10:00:00Z',2)`);
  const v11 = await scoreVenture(env, 10, { actorId: 1, trigger: 'read', today: TODAY });
  assert.equal(v11.model, '1.1');
  const input = (scope: string, key: string) => (v11.scopes.find((s: any) => s.scope === scope) as any).inputs.find((i: any) => i.key === key);
  const env1 = input('geographic', 'country_environment');
  assert.equal(env1.state, 'recorded');
  assert.equal(env1.value, 51, 'DE (90+92)/2 and IR (10+12)/2, averaged; FR is not_now and US has no figure; the 2099 edition is not read');
  assert.equal(env1.grade, 'sourced');
  assert.match(env1.words, /2 market countries · World Bank WGI 2024/);
  assert.equal(input('political', 'stability').value, 43, 'DE (70+88)/2 and IR (5+8)/2: 42.75');
  const lists = input('political', 'high_risk_lists');
  assert.equal(lists.value, 67, 'DE, IR and US are market countries; only IR is on the EU list; DE\'s planted FATF row is not read');
  assert.match(lists.words, /2 of 3 market countries on no list · European Commission 2025-1 · FATF not counted: no licence recorded/);
});

test('v1.1 with nothing imported says why, never a 0', async () => {
  const { db, env } = fixture();
  db.exec(`INSERT INTO venture_model_publications(version,published_by,published_at,ventures_total) VALUES ('1.1',901,'2026-10-26T10:00:00Z',2)`);
  const card = await scoreVenture(env, 10, { actorId: 1, trigger: 'read', today: TODAY });
  const geo = (card.scopes.find((s: any) => s.scope === 'geographic') as any).inputs.find((i: any) => i.key === 'country_environment');
  assert.equal(geo.state, 'not_recorded');
  assert.equal(geo.value, null);
  assert.match(geo.reason, /No World Bank governance edition is imported/);
  const empty = await scoreVenture(env, 20, { actorId: 1, trigger: 'read', today: TODAY });
  const lists = (empty.scopes.find((s: any) => s.scope === 'political') as any).inputs.find((i: any) => i.key === 'high_risk_lists');
  assert.match(lists.reason, /No market has a country attached/);
});

// ── Publish, and the recompute ───────────────────────────────────────────────

test('only a Super Admin with a fresh authenticator step-up publishes; once, never backwards', async () => {
  const { db, call } = fixture();
  assert.equal((await call('POST', '/models/1.1/publish', { id: PLAIN, jti: 'plain' })).status, 403, 'an admin is not a Super Admin');
  const stale = await call('POST', '/models/1.1/publish', { jti: 'stale' });
  assert.equal(stale.status, 403);
  assert.equal(stale.body.code, 'step_up_required');
  assert.equal(count(db, 'venture_model_publications'), 0, 'a refusal writes nothing');

  const ok = await call('POST', '/models/1.1/publish');
  assert.equal(ok.status, 200);
  assert.equal(ok.body.ventures_total, 2);
  assert.equal(count(db, 'venture_model_publications', "version = '1.1' AND published_by = 901 AND cursor_project_id = 0 AND finished_at IS NULL"), 1);
  assert.equal(count(db, 'activity_logs', "action = 'venture_model.published' AND details = '{\"version\":\"1.1\",\"ventures_total\":2}'"), 1);

  assert.equal((await call('POST', '/models/1.1/publish')).body.error, 'model_not_newer', 'a published version is never published again');
  assert.equal((await call('POST', '/models/1.0/publish')).body.error, 'model_not_newer', 'the live model never moves back');
  assert.equal((await call('POST', '/models/9.9/publish')).status, 404);
  assert.equal((await call('POST', '/models/x/publish')).status, 404);
  assert.equal(count(db, 'venture_model_publications'), 1);
});

test('the HQ reads: an admin reads versions and sources; v1 is live by default, v1.1 the draft with its changes', async () => {
  const { call } = fixture();
  const models = await call('GET', '/hq/models', { id: PLAIN, jti: 'plain' });
  assert.equal(models.status, 200);
  assert.equal(models.body.live, '1.0');
  assert.deepEqual(models.body.versions.map((v: any) => [v.version, v.state, v.default_live, v.published_by]), [['1.1', 'draft', false, null], ['1.0', 'live', true, null]]);
  assert.equal(models.body.draft.version, '1.1');
  assert.equal(models.body.draft.changes.length, 3);
  assert.deepEqual([models.body.draft.ventures, models.body.draft.minutes], [2, 1]);
  const indices = await call('GET', '/hq/indices', { id: PLAIN, jti: 'plain' });
  assert.deepEqual(indices.body.sources.map((s: any) => [s.key, s.licence === null]), [['wgi', false], ['fatf', true], ['eu_high_risk', false]]);
  const stranger = await call('GET', '/hq/models', { id: 1, jti: 'founder' });
  assert.equal(stranger.status, 403, 'a founder reads nothing here');
});

test('the import route: Super Admin and step-up only; an unrecorded licence is refused with its code', async () => {
  const { db, call } = fixture();
  const body = { edition: 'Oct 2026', published_on: '2026-10-24', countries: { call_for_action: ['IR'] } };
  assert.equal((await call('POST', '/hq/indices/eu_high_risk/import', { id: PLAIN, jti: 'plain', body })).status, 403);
  assert.equal((await call('POST', '/hq/indices/eu_high_risk/import', { jti: 'stale', body })).status, 403);
  const fatf = await call('POST', '/hq/indices/fatf/import', { body });
  assert.deepEqual([fatf.status, fatf.body.error], [409, 'licence_not_recorded']);
  assert.equal((await call('POST', '/hq/indices/nope/import', { body })).status, 404);
  const eu = await call('POST', '/hq/indices/eu_high_risk/import', { body: { edition: '2025-1', published_on: '2025-06-10', countries: { listed: ['IR'] } } });
  assert.deepEqual([eu.status, eu.body.value_count], [200, 1]);
  assert.equal(count(db, 'activity_logs', "action = 'country_index.imported'"), 1);
  assert.equal(count(db, 'country_index_editions', "source = 'fatf'"), 0);
});

test('a publication recomputes every venture in claimed batches, and the rows of v1.0 stay', async () => {
  const { db, env, call } = fixture();
  await scoreVenture(env, 10, { actorId: 1, trigger: 'read', today: TODAY });
  const before = count(db, 'venture_scorecards', "project_id = 10 AND model_version = '1.0'");
  assert.ok(before > 0);
  assert.deepEqual(await continuePublication(env, TODAY), { open: false, scored: 0, failed: 0 }, 'no publication, no work');

  await call('POST', '/models/1.1/publish');
  assert.equal((await liveModel(env)).version, '1.1');
  const one = await continuePublication(env, TODAY, 1);
  assert.deepEqual(one, { open: true, scored: 1, failed: 0 });
  assert.ok(count(db, 'venture_scorecards', "project_id = 10 AND model_version = '1.1' AND trigger = 'publish'") > 0, 'venture 10 has v1.1 rows');
  assert.equal(count(db, 'venture_scorecards', "project_id = 10 AND model_version = '1.0'"), before, 'v1.0\'s rows are never touched');
  assert.equal(count(db, 'venture_scorecards', 'project_id = 20'), 0, 'the batch was one venture');
  await continuePublication(env, TODAY, 1);
  assert.ok(count(db, 'venture_scorecards', "project_id = 20 AND model_version = '1.1'") > 0);
  await continuePublication(env, TODAY, 1);
  const pub = db.prepare("SELECT ventures_done, ventures_failed, cursor_project_id, finished_at FROM venture_model_publications WHERE version = '1.1'").get() as any;
  assert.deepEqual([pub.ventures_done, pub.ventures_failed, pub.cursor_project_id], [2, 0, 20]);
  assert.ok(pub.finished_at, 'the recompute finishes when no venture is left');

  const models = await call('GET', '/hq/models');
  assert.deepEqual(models.body.versions.map((v: any) => [v.version, v.state]), [['1.1', 'live'], ['1.0', 'retired']]);
  assert.equal(models.body.draft, null);
  assert.equal(models.body.versions[0].published_by, 'Synthetic holder');
  assert.deepEqual(models.body.versions[0].recompute, { total: 2, done: 2, failed: 0, finished_at: pub.finished_at });
});

test('a batch already claimed is not scored twice', async () => {
  const { db, env, call } = fixture();
  await call('POST', '/models/1.1/publish');
  // Another run moved the cursor between this run's read and its claim.
  const realPrepare = env.DB.prepare.bind(env.DB);
  let moved = false;
  env.DB.prepare = (sql: string) => {
    if (!moved && sql.startsWith('UPDATE venture_model_publications SET cursor_project_id')) {
      moved = true;
      db.exec("UPDATE venture_model_publications SET cursor_project_id = 10");
    }
    return realPrepare(sql);
  };
  const r = await continuePublication(env, TODAY, 1);
  assert.deepEqual(r, { open: true, scored: 0, failed: 0 });
  assert.equal(count(db, 'venture_scorecards', "trigger = 'publish'"), 0);
});

test('the every-minute job runs the recompute at HQ, and the route is mounted', () => {
  const index = read('../src/index.ts');
  assert.match(index, /app\.route\('\/api\/venture-scores', ventureScoreModels\)/);
  const block = index.slice(index.indexOf('// D1259: a published venture model'), index.indexOf('// D886 B10'));
  assert.match(block, /if \(hqCadences\)/);
  assert.match(block, /continuePublication\(env, now\.toISOString\(\)\.slice\(0, 10\)\)/);
});
